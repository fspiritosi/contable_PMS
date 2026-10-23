# TSK-792 — Asientos y anulaciones (corrección en cadena): plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Editar, eliminar y anular FC, FV no AFIP, OP, RC y MF confirmados mientras el período esté abierto, con una propuesta de corrección de toda la cadena que se aplica con un solo "Confirmar", y volver a borrador un asiento Registrado desde Asientos.

**Architecture:**
- **Efectos de cada comprobante.** Se extraen de cada `confirm*` a funciones `apply…EffectsTx` y se escriben sus inversas `revert…EffectsTx`. Viven en `src/modules/commercial/shared/effects/`, y `confirm*` pasa a usarlas sin cambiar su comportamiento.
- **Motor de corrección** (`src/modules/commercial/shared/correction/`). Arma un plan (qué se edita, elimina o anula en el origen y en los dependientes). Lo ejecuta dentro de una transacción en este orden: revertir efectos, escribir datos, reaplicar efectos, recalcular estados.
- **Propuesta.** Se toma una foto de los registros afectados antes y después, y se compara. En la vista previa la transacción se descarta (rollback). Al aplicar, se ejecuta de nuevo y solo se confirma si la huella (fingerprint) coincide con la que vio el usuario.
- **Asiento del comprobante.** Se reescribe conservando su número, con `rewriteDraftJournalEntryTx`.

**Tech Stack:** Next.js 16 (App Router, Server Actions), Prisma 7 + PostgreSQL (triggers PL/pgSQL), React Hook Form + Zod, TanStack Query, shadcn/ui, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-23-tsk-792-asientos-y-anulaciones-design.md`. Leerlo antes de cada tarea. Las secciones que se citan como §N son de ese documento.

Rama: `feat/tsk-792-correccion-en-cadena`. Sale de `feat/tsk-791-conceptos` (PR #38).

## Global Constraints

**Reglas de `CLAUDE.md` y `.claude/rules/`**
- Permisos en 3 niveles: `checkPermission` en cada action, `PermissionGuard` en páginas y `usePermissions` en el client.
- `_` en los client components y menos de 200 líneas por componente.
- Sin `:any`. Los enums se importan de `@/generated/prisma/enums`.
- `Decimal` se pasa a `Number()` antes de mandarlo al client.
- Logger, nunca `console.*`. moment.js para fechas.
- La fecha de negocio es el día de Argentina (`todayBusinessDay*`); nunca `new Date()` como fecha de negocio.

**Errores**
- Errores de negocio con `BusinessError`. Las actions devuelven `ActionResult` (`@/shared/lib/action-result`, `toActionResult`).
- Nada de `throw new Error` con mensajes para el usuario.

**Dependencias entre módulos**
- `modules/commercial` usa contabilidad **solo** a través de `@/modules/accounting/features/integrations/core` y `…/integrations/commercial`, que es el patrón existente.
- `modules/accounting` no importa de `commercial` salvo `commercial/shared/*`, como ya hace hoy.

**Tests**
- Vitest (`npm run test`). No hay Cypress.
- Los tests de integración siguen el molde de `src/modules/commercial/features/treasury/features/payment-orders/payment-order-journal-entry.integration.test.ts`:
  - `describe.skipIf(!dbAvailable)`.
  - Prefijo único por archivo `TSK792-<X>-`.
  - `vi.mock` de `server-only`, `@/shared/lib/current-user`, `@/shared/lib/company`, `@/shared/lib/permissions` (`checkPermission` resuelto) y `next/cache`.
  - Limpieza con `cleanupAccountingCompany` en `afterAll`.

**Base de datos**
- Nunca `prisma migrate reset` ni `db push` sobre la base de dev.
- Las migraciones se generan aditivas, con shadow DB temporal como en el TSK-791 si `migrate dev` detecta drift.
- El SQL a mano (trigger y backfill) va en su propia migración.

**Línea base**
- `npm run check-types` da **216** errores preexistentes. Ninguna tarea puede subirlo.
- `npm run test` da 76 archivos y 1044 tests verdes antes de empezar.

**Reglas de negocio fijadas en el spec (copiar tal cual)**
- **Propagación de importes.**
  - Si el monto baja, el pago o cobro baja.
  - Si sube, no se toca y el comprobante queda "Pago parcial".
  - Si se elimina o anula: el pago o cobro que solo cancelaba ese comprobante se elimina; si cancelaba varios, pierde esa imputación (§4.3).
- **Reparto de la diferencia.**
  - Entre varias cancelaciones del mismo comprobante, se descuenta de la más reciente a la más antigua.
  - Dentro de una OP o RC con un solo medio de pago, se ajusta ese medio. Con varios, elige el usuario.
  - Las retenciones no se recalculan. Si la diferencia no alcanza a cubrirse sin tocarlas, es un impedimento MANUAL (§4.3).
- **Profundidad de la cadena.** Origen → OP/RC/NC que lo cancelan → sus efectos. No hay más profundidad (§4.3).
- **Impedimentos.**
  - Si hay al menos uno, no se aplica nada.
  - Severidad `MANUAL` (etiqueta "Podés resolverlo") o `BLOCKED` (etiqueta "No se puede") (§3).
- **Asiento editado.** Se reescribe y conserva su número.
- **Eliminar** exige el asiento en DRAFT.
- **Anular** con el asiento POSTED genera el contraasiento **con la fecha del comprobante** (§5.3).
- **Permisos.**
  - Editar requiere `update` del módulo del comprobante. Eliminar y Anular requieren `delete`.
  - Volver a borrador requiere `accounting.entries`/`approve` (§8).
  - Módulos: `commercial.purchases`, `commercial.invoices`, `commercial.treasury.payment-orders`, `commercial.treasury.receipts`, `commercial.treasury.fund-movements`.
- **Campos fijos de la FV no AFIP** (§4.2): punto de venta, tipo de comprobante y número.
- **Rótulos de acción** en las tarjetas: `Se modifica`, `Se reescribe`, `Se elimina`, `Se anula`, `Contraasiento`, `Vuelve a cartera`, `Se desvincula`, `Se recalcula`.

**Ruling de este plan (no está en el spec)**
- El estado de facturas y gastos (CONFIRMED / PARTIAL_PAID / PAID) se recalcula contando **solo** OP/RC en estado `CONFIRMED` y NC aplicadas que no estén anuladas.
- Hoy se cuentan también los borradores; es el mismo problema del TSK-797.
- `confirmPaymentOrder` y `confirmReceipt` pasan a usar el helper nuevo.

## Review Focus

1. **Factura que la OP paga junto con otras.**
   - Al bajar el monto, solo cambia la imputación de esa factura.
   - Las otras facturas de la OP mantienen importe y estado.
   - Test: Tarea 12, `FC pagada por una OP de varias facturas: solo baja su imputación`.
2. **La vista previa no deja rastro.** Previsualizar no modifica ningún registro ni consume número de asiento (`lastEntryNumber` igual antes y después). Test: Tarea 12, `preview no cambia nada ni consume numeración`.
3. **Otro usuario cambia algo entre la vista previa y el Confirmar.**
   - No se aplica nada.
   - La action devuelve la propuesta nueva con `stale: true`.
   - Test: Tarea 12, `apply con huella vieja no aplica y devuelve propuesta nueva`.
4. **Edición que no toca importes** (solo el número de factura).
   - La OP vinculada no aparece como modificada.
   - El asiento conserva su número.
   - Test: Tarea 12, `cambiar solo el número no toca la OP y conserva el número de asiento`.
5. **Pago en efectivo de una sesión de caja ya cerrada.**
   - Impedimento `BLOCKED`.
   - El banco, la caja, los cheques y los asientos quedan intactos.
   - Test: Tarea 12, `caja cerrada bloquea y no aplica nada`.

---

### Tarea 1: Modelo, trigger y backfill de trazabilidad

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<ts>_tsk_792_correction_traceability/migration.sql`. Generada; solo DDL aditivo.
- Create: `prisma/migrations/<ts+1>_tsk_792_trigger_and_backfill/migration.sql`. A mano.
- Create: `prisma/scripts/tsk792-diagnostico-trazabilidad.sql`. Solo lectura; cuenta lo que quedó sin vincular, para correr en prod después del deploy.
- Test: `src/modules/accounting/shared/utils/journal-entry-trigger.integration.test.ts`

**Interfaces:**
- Produces (Prisma):
  ```prisma
  enum JournalEntryProcess { VAT_SETTLEMENT INFLATION_ADJUSTMENT EXCHANGE_DIFFERENCE  @@map("journal_entry_process") }
  enum BankMovementDocumentLink { CREATED_BY_DOCUMENT MANUAL_LINK  @@map("bank_movement_document_link") }
  // JournalEntry
  process            JournalEntryProcess? @map("process")
  revertedToDraftAt  DateTime?            @map("reverted_to_draft_at")
  revertedToDraftBy  String?              @map("reverted_to_draft_by")
  // BankMovement
  fundMovementId String?                   @map("fund_movement_id") @db.Uuid   // FK FundMovement, onDelete SetNull, @@index
  documentLink   BankMovementDocumentLink? @map("document_link")
  // CashMovement (FK onDelete SetNull + @@index cada una)
  receiptId      String? @map("receipt_id") @db.Uuid
  paymentOrderId String? @map("payment_order_id") @db.Uuid
  fundMovementId String? @map("fund_movement_id") @db.Uuid
  // CashflowProjection
  paymentOrderInstallmentId String? @unique @map("payment_order_installment_id") @db.Uuid // FK onDelete SetNull
  ```
  `FundMovement` gana las relaciones inversas `bankMovements` y `cashMovements`. Hoy `FundMovement.journalEntryId` no tiene relación y queda así.
- Produces (SQL), con `CREATE OR REPLACE FUNCTION prevent_posted_entry_modification()`:
  - Mientras `OLD.status = 'POSTED'`, permite además el UPDATE a `NEW.status = 'DRAFT'` siempre que `number`, `date`, `description`, `company_id`, `original_entry_id` y `reversal_entry_id` no cambien.
  - Todo lo demás queda igual que en la migración `20260624100000_accounting_constraints`.
  - El trigger de líneas no se toca: las líneas se pueden editar recién cuando el asiento ya es DRAFT.

- [ ] **Step 1: Escribir los tests del trigger (fallan)**

  ```ts
  it('permite POSTED → DRAFT sin tocar el contenido', async () => {
    await prisma.journalEntry.update({ where: { id: posted.id }, data: { status: 'DRAFT', postDate: null, revertedToDraftAt: NOW, revertedToDraftBy: USER } });
    expect((await prisma.journalEntry.findUnique({ where: { id: posted.id } }))?.status).toBe('DRAFT');
  });
  it('sigue rechazando POSTED → DRAFT si cambia la descripción', async () => {
    await expect(prisma.journalEntry.update({ where: { id: posted2.id }, data: { status: 'DRAFT', description: 'otra' } })).rejects.toThrow(/registrado/);
  });
  it('sigue rechazando DELETE de un POSTED y cualquier cambio de un REVERSED', async () => { /* … */ });
  it('sigue rechazando editar líneas de un POSTED', async () => { /* … */ });
  ```

- [ ] **Step 2: Correr y ver que fallan.** `npx vitest run src/modules/accounting/shared/utils/journal-entry-trigger.integration.test.ts`. Esperado: FAIL en el primer caso, con el mensaje del trigger.

- [ ] **Step 3: Cambios de schema y migración DDL generada** (`npm run db:migrate -- --name tsk_792_correction_traceability`)

- [ ] **Step 4: Migración a mano con el trigger y el backfill**

  Todas las condiciones son de "coincidencia única". Ante la duda, no se vincula.
  - `journal_entries.process`: solo `created_by <> 'system'` y `original_entry_id IS NULL`.
    - `VAT_SETTLEMENT` si la descripción empieza con `'Liquidación IVA '`.
    - `INFLATION_ADJUSTMENT` si empieza con `'Ajuste por inflación — RECPAM'`.
    - `EXCHANGE_DIFFERENCE` si empieza con `'Diferencia de cambio al '`.
  - `bank_movements.document_link`, para filas con `receipt_id` o `payment_order_id`:
    - `CREATED_BY_DOCUMENT` si `reference` = `full_number` del comprobante **y** `|created_at − confirmed_at| < 1 minuto`.
    - Si no, `MANUAL_LINK`.
  - `cash_movements.receipt_id`: `reference` = `receipts.full_number` de la misma empresa, `type = 'INCOME'` y la descripción empieza con `'Cobro de '`.
  - `cash_movements.payment_order_id`: ídem con `payment_orders`, `type = 'EXPENSE'` y `'Pago de '`.
  - `bank_movements.fund_movement_id` y `cash_movements.fund_movement_id`: para cada MF `CONFIRMED`, por cada lado del MF, la única fila de la misma empresa que coincide en cuenta o caja, `date`, `amount`, tipo y `description` = `fund_movements.description`, y que no esté ya vinculada a otro MF.
  - `cashflow_projections.payment_order_installment_id`: la única proyección `EXPENSE` con la descripción que arma `confirmPaymentOrder` (`'Cuota {n}/{N} {OP} — …'` o `'{OP} — …'`), la misma `date = due_date` y el mismo `amount`.

- [ ] **Step 5: Aplicar las migraciones y regenerar el cliente.** `npm run db:migrate` y después `npm run db:generate`.

- [ ] **Step 6: Correr los tests del Step 1.** Esperado: PASS.

- [ ] **Step 7: Script de diagnóstico.** Una consulta por regla del Step 4 que cuente las filas que quedaron sin vincular. Correrlo en dev y anotar los resultados en el reporte.

- [ ] **Step 8: Verificar.** `npm run check-types` no supera 216 y `npm run test` queda verde.

- [ ] **Step 9: Commit.** `feat(db): trazabilidad de efectos y transición de asiento a borrador (TSK-792)`

---

### Tarea 2: Guardar los vínculos nuevos al crear los efectos

**Files:**
- Modify: `src/modules/commercial/features/treasury/features/payment-orders/actions.server.ts` (`confirmPaymentOrder`: caja ~l.555-591, banco ~l.592-624, proyecciones ~l.698-760)
- Modify: `src/modules/commercial/features/treasury/features/receipts/actions.server.ts` (`confirmReceipt`: caja ~l.322-359, banco ~l.360-392)
- Modify: `src/modules/commercial/features/treasury/features/fund-movements/list/actions.server.ts` (`applyFundSide` ~l.462-577: recibe `fundMovementId`)
- Modify: `src/modules/commercial/features/treasury/features/bank-movements/actions.server.ts` (`linkBankMovementToDocument` ~l.878 y `unlinkBankMovementFromDocument` ~l.930)
- Modify: `src/modules/accounting/features/vat-settlement/actions.server.ts` (~l.190), `inflation-adjustment/actions.server.ts` (~l.322) y `exchange-rates/actions.server.ts` (~l.342). Pasan `process`.
- Modify: `src/modules/accounting/shared/utils/journal-entry-tx.ts`. `CreateJournalEntryTxInput` suma `process?: JournalEntryProcess` y lo persiste.
- Test: suma casos a los integration tests existentes de OP, RC, MF y conciliación (ver Step 1).

**Interfaces:**
- Produces:
  - `CashMovement.receiptId` y `CashMovement.paymentOrderId` en los movimientos que crean el RC y la OP.
  - `BankMovement.documentLink`:
    - `CREATED_BY_DOCUMENT` cuando lo crea el RC o la OP.
    - `MANUAL_LINK` cuando se vincula a mano.
    - `null` al desvincular.
  - `fundMovementId` en los movimientos de banco y caja de un MF.
  - `paymentOrderInstallmentId` en cada proyección de cuota.
  - `JournalEntry.process` en los tres procesos mensuales.

- [ ] **Step 1: Tests (fallan)**
  - En `payment-order-journal-entry.integration.test.ts` agregar `vincula caja, banco y proyecciones a la OP`. Afirma `cashMovement.paymentOrderId === op.id`, `bankMovement.documentLink === 'CREATED_BY_DOCUMENT'` y una proyección por cuota con `paymentOrderInstallmentId`.
  - En `receipt-journal-entry.integration.test.ts` agregar `vincula caja y banco al recibo`.
  - En `fund-movement-lines.integration.test.ts` agregar `los movimientos de banco/caja del MF guardan fundMovementId`.
  - En el test de vínculo manual de `bank-movements` agregar `vincular marca MANUAL_LINK y desvincular lo limpia`.
  - Para la liquidación de IVA, un test que afirme `process === 'VAT_SETTLEMENT'` en el asiento generado. Si ya hay integration test de vat-settlement se suma ahí; si no, va en `journal-entry-trigger.integration.test.ts` llamando a `createJournalEntryTx` con `process`.

- [ ] **Step 2: Correr los tests del Step 1.** Esperado: FAIL.

- [ ] **Step 3: Implementar.** Una línea en cada `create` o `update` de los listados en Files.

- [ ] **Step 4: Correr de nuevo y verificar** que pasan, que no supera 216 y que la suite completa queda verde.

- [ ] **Step 5: Commit.** `feat(commercial): vincular efectos de OP, RC y MF a su comprobante (TSK-792)`

---

### Tarea 3: Volver un asiento Registrado a borrador

**Files:**
- Modify: `src/modules/accounting/shared/utils/journal-entry-tx.ts` (función nueva)
- Modify: `src/modules/accounting/features/integrations/core/index.ts` (export)
- Modify: `src/modules/accounting/features/entries/actions.server.ts`
- Create: `src/modules/accounting/features/entries/components/_RevertEntryToDraftDialog.tsx`
- Modify: `src/modules/accounting/features/entries/components/_EntryActionsMenu.tsx`
- Modify: `src/modules/help/features/guide/components/_AccountingGuide.tsx` (sección Asientos)
- Test: `src/modules/accounting/features/entries/revert-to-draft.integration.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // journal-entry-tx.ts
  export interface RevertToDraftTxInput { companyId: string; entryId: string; userId: string }
  export async function revertJournalEntryToDraftTx(tx: Tx, input: RevertToDraftTxInput): Promise<{ id: string; number: number }>;
  // entries/actions.server.ts
  export interface RevertToDraftCheck { link: EntryDocumentLink | null; blockedMessage: string | null }
  export async function getRevertToDraftCheck(entryId: string): Promise<ActionResult<RevertToDraftCheck>>;
  export async function revertJournalEntryToDraft(entryId: string): Promise<ActionResult<{ number: number }>>;
  ```
- Reglas de `revertJournalEntryToDraftTx`, en este orden. Cada rechazo es un `BusinessError`.
  1. Existe en la empresa.
  2. `status === 'POSTED'`. Mensaje: `El asiento N° {n} no está registrado.`
  3. No es la refundición ni la apertura de un ejercicio (`FiscalYear.closingEntryId` / `openingEntryId`). Mensaje: `El asiento N° {n} es del cierre de ejercicio y no se puede volver a borrador.`
  4. `originalEntryId == null` (no es un contraasiento). Mensaje: `El asiento N° {n} es la anulación de otro asiento y no se puede volver a borrador.`
  5. `assertPeriodOpen(tx, companyId, entry.date, { periodType, subject: 'No se puede volver a borrador el asiento N° {n} (fecha {dd/mm/aaaa})' })`.
  6. `updateMany({ where: { id, status: 'POSTED' }, data: { status: 'DRAFT', postDate: null, revertedToDraftAt: new Date(), revertedToDraftBy: userId } })`. Si `count === 0`, se rechaza.
- Detalles de la action y la UI:
  - La action verifica `checkPermission('accounting.entries', 'approve', { redirect: true })`, corre la función en `$transaction`, hace `logger.info` y `revalidateAccountingRoutes`.
  - El diálogo muestra el aviso: `Al volver a borrador, el asiento deja de contar en el mayor y los balances hasta que lo registres de nuevo.`
  - Si hay vínculo, el diálogo agrega: `{Label con mayúscula inicial} queda editable desde su pantalla.`
  - La opción del menú aparece con `canApprove && status === POSTED`, con el texto `Volver a borrador`.

- [ ] **Step 1: Tests (fallan)**: `vuelve a borrador un asiento registrado y conserva número y líneas` (afirma estado DRAFT, mismo `number`, `postDate` null y `revertedToDraftBy` = USER); `rechaza período cerrado` (`closeMonthForTest`, mensaje con `No se puede volver a borrador`); `rechaza refundición/apertura`; `rechaza contraasiento y asiento anulado`; `rechaza otra empresa`; `getRevertToDraftCheck devuelve el vínculo del documento`.
- [ ] **Step 2: Correrlos y ver que fallan.**
- [ ] **Step 3: Implementar la función, la action, el diálogo y el menú, siguiendo el molde de `_PostEntryDialog.tsx` y `postJournalEntry`.**
- [ ] **Step 4: Tests en verde, `check-types` ≤ 216 y verificación en navegador** (puerto 3010): registrar un asiento manual, volverlo a borrador y ver que lo ofrece el menú.
- [ ] **Step 5: Actualizar la guía de Asientos** con la acción, sus condiciones y su relación con la corrección de comprobantes.
- [ ] **Step 6: Commit** `feat(accounting): volver un asiento registrado a borrador (TSK-792)`

---

### Tarea 4: Núcleo contable para reescribir y eliminar asientos de comprobantes

**Files:**
- Modify: `src/modules/accounting/shared/utils/journal-entry-tx.ts`
- Create: `src/modules/accounting/shared/utils/monthly-processes.ts`
- Modify: `src/modules/accounting/features/integrations/core/index.ts`
- Modify: `src/modules/accounting/features/integrations/commercial/index.ts` (helper local `createJournalEntry` ~l.202 y las cuatro `createJournalEntryFor{SalesInvoice,PurchaseInvoice,Receipt,PaymentOrder}`)
- Modify: `src/modules/commercial/features/treasury/features/fund-movements/list/actions.server.ts` (`createJournalEntryForFundMovement` ~l.575-625)
- Test: `src/modules/accounting/shared/utils/journal-entry-rewrite.integration.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface RewriteDraftEntryTxInput {
    companyId: string; entryId: string; date: Date; description: string;
    lines: readonly JournalEntryLineDraft[]; source?: string;
  }
  /** DRAFT only: validateEntryLines → assertAccountsUsableTx → assertPeriodOpen(date) → reemplaza líneas, fecha,
   *  descripción, fiscalYearId y periodId. Conserva id y number. */
  export async function rewriteDraftJournalEntryTx(tx: Tx, input: RewriteDraftEntryTxInput): Promise<{ id: string; number: number }>;
  /** DRAFT only (deleteMany where status DRAFT; count 0 → BusinessError "El asiento N° {n} ya no está en borrador."). */
  export async function deleteDraftJournalEntryTx(tx: Tx, input: { companyId: string; entryId: string }): Promise<{ number: number }>;
  // monthly-processes.ts
  export interface MonthlyProcessEntry { id: string; number: number; process: JournalEntryProcess; date: Date; description: string }
  /** Asientos POSTED con `process` no nulo, de la empresa, cuyo mes (UTC día de negocio) coincide con alguno de `dates`. */
  export async function findMonthlyProcessEntriesTx(tx: Tx, companyId: string, dates: readonly Date[]): Promise<MonthlyProcessEntry[]>;
  // integrations/commercial/index.ts — firma nueva (parámetro opcional, compatible)
  export interface DocumentEntryOptions { rewriteEntryId?: string }
  export async function createJournalEntryForPurchaseInvoice(invoiceId: string, companyId: string, tx: PrismaTransactionClient, opts?: DocumentEntryOptions): Promise<string>;
  // ídem SalesInvoice, Receipt, PaymentOrder; y en MF: createJournalEntryForFundMovement(..., opts?: DocumentEntryOptions)
  ```
  Con `opts.rewriteEntryId`, el helper `createJournalEntry` llama a `rewriteDraftJournalEntryTx` en lugar de `createJournalEntryTx` y devuelve el mismo id.
  Todo se exporta por `integrations/core`.

- [ ] **Step 1: Tests (fallan)**
  - `rewrite conserva id y número, reemplaza líneas y no avanza lastEntryNumber`. Afirma el mismo `number`, las líneas nuevas y `readLastEntryNumber` sin cambio.
  - `rewrite rechaza POSTED`.
  - `rewrite rechaza fecha nueva en mes cerrado`.
  - `rewrite valida balance`.
  - `deleteDraft borra un DRAFT y rechaza un POSTED`.
  - `findMonthlyProcessEntriesTx encuentra la liquidación de IVA del mes y no la de otro mes ni las anuladas`.
  - `createJournalEntryForPurchaseInvoice con rewriteEntryId reescribe el asiento existente`.
- [ ] **Step 2: Correrlos y ver que fallan.**
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Tests en verde.** La suite completa también, incluidos los integration de facturas, OP y RC, que no deben cambiar. `check-types` ≤ 216.
- [ ] **Step 5: Commit** `feat(accounting): reescribir y eliminar asientos en borrador de comprobantes (TSK-792)`

---

### Tarea 5: Recalcular el estado de facturas y gastos

**Files:**
- Create: `src/modules/commercial/shared/effects/document-status.server.ts`
- Modify: `payment-orders/actions.server.ts` (~l.510-546) y `receipts/actions.server.ts` (~l.295-317). El cálculo inline se reemplaza por el helper.
- Test: `src/modules/commercial/shared/effects/document-status.integration.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export async function recomputePurchaseInvoiceStatusTx(tx: Tx, invoiceId: string): Promise<PurchaseInvoiceStatus>;
  export async function recomputeSalesInvoiceStatusTx(tx: Tx, invoiceId: string): Promise<SalesInvoiceStatus>;
  export async function recomputeExpenseStatusTx(tx: Tx, expenseId: string): Promise<ExpenseStatus>;
  ```
- Reglas:
  - No toca comprobantes en `DRAFT` ni `CANCELLED`; devuelve su estado tal cual.
  - En una factura que no es NC: `cancelado = Σ ítems de OP/RC en CONFIRMED + Σ NC aplicadas (con la NC no anulada)`.
    - `cancelado >= total − 0,005` → `PAID`.
    - `cancelado > 0,005` → `PARTIAL_PAID`.
    - Si no, `CONFIRMED`.
  - En una NC se aplica lo mismo sobre las aplicaciones que **dio** (`creditNoteId = id`).
  - Para gastos, se suman los ítems de OP en CONFIRMED.

- [ ] **Step 1: Tests (fallan)**: `vuelve a CONFIRMED cuando ya no hay pagos`; `PARTIAL_PAID con pago parcial confirmado`; `ignora OP en borrador y anuladas` (ruling, ver Global Constraints); `NC aplicada cuenta`; `no toca DRAFT ni CANCELLED`; `gasto pagado por OP confirmada`.
- [ ] **Step 2: Correrlos y ver que fallan.**
- [ ] **Step 3: Implementar y reemplazar el cálculo inline de los dos confirm.**
- [ ] **Step 4: Tests nuevos y los integration de OP y RC en verde. `check-types` ≤ 216.**
- [ ] **Step 5: Commit** `refactor(commercial): helper único de estado de facturas y gastos (TSK-792)`

---

### Tarea 6: Tipos puros del motor, reparto y diferencias

**Files:**
- Create: `src/modules/commercial/shared/correction/types.ts`
- Create: `src/modules/commercial/shared/correction/allocation.ts` + `allocation.test.ts`
- Create: `src/modules/commercial/shared/correction/describe-changes.ts` + `describe-changes.test.ts`
- Create: `src/modules/commercial/shared/correction/impediments.ts` + `impediments.test.ts`
- Create: `src/modules/commercial/shared/correction/fingerprint.ts` + `fingerprint.test.ts`

**Interfaces:**
- Produces (`types.ts`):
  ```ts
  export type CorrectableKind = 'PURCHASE_INVOICE' | 'SALES_INVOICE' | 'PAYMENT_ORDER' | 'RECEIPT' | 'FUND_MOVEMENT';
  export type CorrectionMode = 'EDIT' | 'DELETE' | 'CANCEL';
  export interface DocRef { kind: CorrectableKind; id: string }
  /** documentId (OP/RC) → paymentId elegido para absorber la reducción. */
  export type PaymentChoices = Record<string, string>;
  export type CorrectionRequest =
    | { mode: 'EDIT'; ref: DocRef; data: unknown; choices?: PaymentChoices }
    | { mode: 'DELETE' | 'CANCEL'; ref: DocRef; choices?: PaymentChoices };
  export type CardAction = 'MODIFY' | 'REWRITE' | 'DELETE' | 'CANCEL' | 'REVERSE' | 'BACK_TO_PORTFOLIO' | 'UNLINK' | 'RECALCULATE';
  export interface CardRow { label: string; before: string | null; after: string | null }
  export interface PaymentChoice { documentId: string; documentLabel: string; options: { paymentId: string; label: string }[]; selected: string | null }
  export interface ProposalCard { key: string; title: string; action: CardAction; rows: CardRow[]; warning?: string }
  export type ImpedimentSeverity = 'MANUAL' | 'BLOCKED';
  export type ImpedimentCode =
    | 'PERIOD_CLOSED' | 'ENTRY_POSTED' | 'AFIP_CAE' | 'MONTHLY_PROCESS' | 'PARTY_CHANGED_WITH_PAYMENTS'
    | 'WITHHOLDINGS_INSUFFICIENT' | 'CASH_SESSION_CLOSED' | 'CHECK_USED' | 'CHECK_ENDORSED_IN_OTHER_OP'
    | 'INSTALLMENT_PAID' | 'BANK_MOVEMENT_MANUAL_LINK' | 'FUND_BANK_MOVEMENT_RECONCILED' | 'UNTRACEABLE_EFFECT'
    | 'REFERENCED_BY_NOTE' | 'INVALID_STATE' | 'SIMULATION_ERROR';
  export interface Impediment { code: ImpedimentCode; severity: ImpedimentSeverity; message: string; action?: string; href?: string }
  export interface CorrectionProposal {
    mode: CorrectionMode; origin: DocRef; cards: ProposalCard[]; impediments: Impediment[];
    pendingChoices: PaymentChoice[]; fingerprint: string;
  }
  ```
- Produces (`allocation.ts`). Montos en centavos enteros internamente; la salida va redondeada a 2 decimales.
  ```ts
  export interface Cancellation { itemId: string; documentId: string; source: 'PAYMENT_ORDER' | 'RECEIPT' | 'CREDIT_NOTE'; amount: number; date: Date; createdAt: Date }
  export interface CancellationAdjustment { itemId: string; documentId: string; source: Cancellation['source']; before: number; after: number }
  /** Reparte `reduction` desde la cancelación más reciente (date desc, createdAt desc) hacia la más antigua. */
  export function allocateReduction(cancellations: readonly Cancellation[], reduction: number): CancellationAdjustment[];
  export interface PaymentLine { id: string; amount: number; label: string }
  export type PaymentReduction =
    | { kind: 'OK'; paymentId: string; after: number }
    | { kind: 'NEEDS_CHOICE' }
    | { kind: 'INSUFFICIENT' };
  /** Un solo medio: ese. Varios: el de `choice` (si no hay → NEEDS_CHOICE). Si el medio no alcanza → INSUFFICIENT. */
  export function planPaymentReduction(payments: readonly PaymentLine[], reduction: number, choice?: string): PaymentReduction;
  ```
- Produces (`describe-changes.ts`). Función pura que compara dos fotos y arma las tarjetas.
  ```ts
  export interface SnapshotEntity {
    key: string;            // clave natural estable entre fotos (p. ej. 'PURCHASE_INVOICE:<id>', 'ENTRY:<number>', 'BANK:<accountId>:<docId>', 'CHECK:<bank>:<number>')
    order: number;          // orden de la cadena (0 origen, 1 su asiento, 2.. dependientes y efectos)
    title: string;          // "FC A 0003-00001234 · Lubricantes SA"
    fields: Record<string, string>; // etiqueta → valor ya formateado (moneda AR, fechas DD/MM/YYYY, estados en castellano)
    status?: string;        // para distinguir CANCEL/REVERSE/BACK_TO_PORTFOLIO
  }
  export interface ChainSnapshot { entities: SnapshotEntity[] }
  export function describeChanges(before: ChainSnapshot, after: ChainSnapshot): ProposalCard[];
  ```
  Una entidad que está solo en `before` se marca `DELETE`. Si el estado pasa a Anulada se marca `CANCEL`, y si pasa a `Anulado` con contraasiento, `REVERSE`. Un cheque que pasa de Endosado a En cartera se marca `BACK_TO_PORTFOLIO`. Un asiento que existe en las dos fotos con líneas distintas se marca `REWRITE`. Cualquier otro cambio de campos se marca `MODIFY`, y si solo cambió el estado, `RECALCULATE`. Una entidad sin cambios **no** genera tarjeta. Las filas de cada tarjeta son solo los campos que cambiaron, con antes y después.
- Produces (`impediments.ts`). Constructores con el texto ya armado; cada uno devuelve `Impediment`.
  ```ts
  export const impediments: {
    entryPosted(entryNumber: number, docLabel: string): Impediment;        // MANUAL, href '/dashboard/company/accounting/entries'
    periodClosed(message: string): Impediment;                              // BLOCKED (message de assertPeriodOpen)
    afipCae(docLabel: string): Impediment;                                  // BLOCKED
    monthlyProcess(entry: { number: number; description: string }): Impediment; // MANUAL
    partyChanged(paymentLabels: string[]): Impediment;                      // MANUAL
    withholdingsInsufficient(docLabel: string): Impediment;                 // MANUAL
    cashSessionClosed(registerName: string, docLabel: string): Impediment;  // BLOCKED
    checkUsed(checkLabel: string, statusLabel: string): Impediment;         // BLOCKED
    checkEndorsedInOtherOp(checkLabel: string, opLabel: string): Impediment; // MANUAL
    installmentPaid(docLabel: string): Impediment;                          // BLOCKED
    bankMovementManualLink(docLabel: string): Impediment;                   // MANUAL
    fundBankMovementReconciled(docLabel: string): Impediment;               // MANUAL
    untraceable(docLabel: string): Impediment;                              // BLOCKED
    referencedByNote(noteLabel: string): Impediment;                        // MANUAL
    invalidState(message: string): Impediment;                              // BLOCKED
    simulationError(message: string): Impediment;                           // BLOCKED
  };
  ```
  Textos de referencia, en el tono de la variante A:
  - `entryPosted`: `El asiento N° {n} de {docLabel} está Registrado.` / acción `Volvelo a borrador desde Contabilidad › Asientos y reintentá.`
  - `monthlyProcess`: `Ya se generó «{description}» (asiento N° {n}) para este mes.` / acción `Anulá ese asiento desde Contabilidad › Asientos, corregí el comprobante y volvé a generarlo.`
  - `untraceable`: `Un movimiento de {docLabel} es anterior a la trazabilidad y no se puede corregir automáticamente.`
- Produces (`fingerprint.ts`): `export function fingerprintProposal(cards: readonly ProposalCard[], choices: PaymentChoices): string`. Es un sha256 (`node:crypto`) de un JSON estable: claves ordenadas, `cards` en el orden dado y `choices` ordenadas por clave.

- [ ] **Step 1: Tests (fallan)**
  - `allocation.test.ts`:
    - `reparte desde la más reciente`: [OP1 600 (01/10), OP2 400 (05/10)] con reducción 200 da OP2 400→200.
    - `consume varias`: reducción 500 da OP2 400→0 y OP1 600→500.
    - `reducción 0 no ajusta nada`.
    - `reducción mayor al total deja todo en 0`.
    - `redondea a centavos sin perder 0,01`: tres cancelaciones de 33,33 con reducción 99,99.
    - `planPaymentReduction: un medio OK`, `varios sin choice → NEEDS_CHOICE`, `varios con choice OK`, `medio insuficiente → INSUFFICIENT`.
  - `describe-changes.test.ts`:
    - `sin cambios no hay tarjetas`.
    - `monto cambiado → MODIFY con fila antes/después`.
    - `entidad que desaparece → DELETE`.
    - `asiento con líneas distintas → REWRITE`.
    - `cheque ENDOSADO→EN CARTERA → BACK_TO_PORTFOLIO`.
    - `tarjetas en orden de cadena`.
  - `impediments.test.ts`: `severidades por constructor` (tabla con los 16).
  - `fingerprint.test.ts`: `misma propuesta → misma huella`, `cambia un importe → cambia la huella`, `orden de choices no importa`.
- [ ] **Step 2: Correrlos y ver que fallan.**
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Tests en verde y `check-types` ≤ 216.**
- [ ] **Step 5: Commit** `feat(commercial): núcleo puro de la corrección en cadena (TSK-792)`

---

### Tarea 7: Efectos de la Orden de Pago (aplicar y revertir)

**Files:**
- Create: `src/modules/commercial/shared/effects/types.ts`
- Create: `src/modules/commercial/shared/effects/payment-order.server.ts`
- Modify: `payment-orders/actions.server.ts`. `confirmPaymentOrder` queda en: guard, preflight, `update` de estado y `applyPaymentOrderEffectsTx`.
- Test: `src/modules/commercial/shared/effects/payment-order-effects.integration.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // effects/types.ts
  export interface EffectsCtx { companyId: string; userId: string }
  export interface EffectsResult { journalEntryId: string | null }
  // effects/payment-order.server.ts
  /** Lo que hoy hace confirmPaymentOrder dentro de la tx salvo el update de estado (pasos 2–3d + asiento),
   *  incluidos los vínculos de la Tarea 2. Con opts.rewriteEntryId reescribe ese asiento en vez de crear uno. */
  export async function applyPaymentOrderEffectsTx(tx: Tx, ctx: EffectsCtx, paymentOrderId: string, opts?: DocumentEntryOptions): Promise<EffectsResult>;
  /** Inversa exacta, sin tocar el asiento ni el estado de la OP: */
  export async function revertPaymentOrderEffectsTx(tx: Tx, ctx: EffectsCtx, paymentOrderId: string): Promise<void>;
  /** Impedimentos propios de los efectos de la OP (sin mirar asiento ni período): */
  export async function paymentOrderEffectImpedimentsTx(tx: Tx, paymentOrderId: string, docLabel: string): Promise<Impediment[]>;
  ```
- Qué revierte `revertPaymentOrderEffectsTx`:
  - **Banco.** Borra los movimientos `paymentOrderId = op` con `documentLink = CREATED_BY_DOCUMENT` y les devuelve el saldo: suma el WITHDRAWAL a `BankAccount.balance`.
  - **Caja.** Borra los movimientos `paymentOrderId = op` y suma su importe al `expectedBalance` de la sesión.
  - **Cheques.**
    - Borra el cheque OWN `DELIVERED` del pago.
    - Al endosado (`ENDORSED`) lo devuelve a `PORTFOLIO` y limpia `endorsedToName`, `endorsedToTaxId`, `endorsedAt`, `supplierId` y `paymentOrderPaymentId`.
  - **Cuotas.** Borra las de origen `PENDING` y sus proyecciones (`paymentOrderInstallmentId`).
  - **OP de socio.** Las cuotas `settledByPaymentOrderId = op` en `PAID` vuelven a `PENDING` con `paidAt = null`.
  - **Al final.** Recalcula el estado de cada factura y gasto imputado (Tarea 5).
- Qué devuelve `paymentOrderEffectImpedimentsTx`:

  | Situación | Impedimento |
  |---|---|
  | Sesión de caja de un movimiento `CLOSED` | `cashSessionClosed` |
  | Cheque OWN fuera de `DELIVERED` | `checkUsed` |
  | Cheque endosado fuera de `ENDORSED` | `checkUsed` |
  | Cuota de origen `PAID` | `installmentPaid` |
  | Proyección de cuota con `ProjectionDocumentLink` o con estado distinto de `PENDING` | `installmentPaid` |
  | Movimiento bancario con `paymentOrderId` y `documentLink = MANUAL_LINK` | `bankMovementManualLink` |
  | Movimiento bancario con `paymentOrderId` y `documentLink = null` | `untraceable` |
  | Pago de caja de la OP CONFIRMED sin `CashMovement` vinculado | `untraceable` |

- [ ] **Step 1: Tests (fallan)**
  - `revert(apply) deja saldos de banco y caja, cheques y cuotas como antes`. Es una OP con transferencia, efectivo, cheque propio, cheque endosado y tarjeta en 3 cuotas. Afirma el saldo de banco, el `expectedBalance`, que el cheque propio no existe, que el endosado está `PORTFOLIO` sin datos de endoso, y que no hay cuotas ni proyecciones.
  - `revert recalcula la factura a CONFIRMED`.
  - `OP de socio: revert devuelve las cuotas saldadas a PENDING`.
  - `apply con rewriteEntryId conserva el número de asiento`.
  - `impedimentos`: caja cerrada, cheque propio `CASHED`, cuota `PAID`, banco `MANUAL_LINK` y movimiento sin `documentLink`.
  - Los tests de `payment-order-journal-entry.integration.test.ts` siguen verdes, sin tocarlos salvo lo agregado en la Tarea 2.
- [ ] **Step 2: Correrlos y ver que fallan.**
- [ ] **Step 3: Implementar, moviendo el cuerpo de la tx de `confirmPaymentOrder` sin cambiar comportamiento.**
- [ ] **Step 4: Tests en verde, suite completa y `check-types` ≤ 216.**
- [ ] **Step 5: Commit** `refactor(commercial): efectos de la OP aplicables y reversibles (TSK-792)`

---

### Tarea 8: Efectos del Recibo y edición del Recibo

**Files:**
- Create: `src/modules/commercial/shared/effects/receipt.server.ts`
- Modify: `receipts/actions.server.ts`:
  - `confirmReceipt` pasa a usar `applyReceiptEffectsTx`.
  - Nuevas `updateReceipt` (solo DRAFT) y `writeReceiptDataTx`.
- Modify: `receipts/list/components/_CreateReceiptModal.tsx`. Suma modo edición: recibe `editReceiptId?: string`, carga con `getReceipt` y guarda con `updateReceipt`. Seguir el molde de `_CreatePaymentOrderModal.tsx` con `editPaymentOrderId`.
- Modify: `receipts/list/components/_EditReceiptModal.tsx`. Hoy es un placeholder; pasa a envolver el modal en modo edición.
- Modify: `receipts/list/columns.tsx`. Suma "Editar" en DRAFT.
- Test: `src/modules/commercial/shared/effects/receipt-effects.integration.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export async function applyReceiptEffectsTx(tx: Tx, ctx: EffectsCtx, receiptId: string, opts?: DocumentEntryOptions): Promise<EffectsResult>;
  export async function revertReceiptEffectsTx(tx: Tx, ctx: EffectsCtx, receiptId: string): Promise<void>;
  export async function receiptEffectImpedimentsTx(tx: Tx, receiptId: string, docLabel: string): Promise<Impediment[]>;
  // receipts/actions.server.ts
  export async function writeReceiptDataTx(tx: Tx, companyId: string, receiptId: string, input: CreateReceiptInput): Promise<void>; // reemplaza items/payments/withholdings y totales
  export async function updateReceipt(id: string, input: CreateReceiptInput): Promise<ActionResult<{ id: string }>>; // checkPermission('commercial.treasury.receipts','update'); solo DRAFT
  ```
  `CreateReceiptInput` es el tipo que ya usa `createReceipt`. Usar el mismo nombre que exporta su validator.
- Qué revierte `revertReceiptEffectsTx`:
  - **Banco.** Borra los DEPOSIT `CREATED_BY_DOCUMENT` y les resta el saldo.
  - **Caja.** Borra los INCOME vinculados y les resta el importe al `expectedBalance`.
  - **Cheques.** Borra los THIRD_PARTY que siguen en `PORTFOLIO`.
  - **Al final.** Recalcula las facturas.
- Qué devuelve `receiptEffectImpedimentsTx`:

  | Situación | Impedimento |
  |---|---|
  | Caja cerrada | `cashSessionClosed` |
  | Cheque `ENDORSED` con `paymentOrderPaymentId` | `checkEndorsedInOtherOp`, con el número de esa OP |
  | Cheque `DEPOSITED`, `CLEARED`, `REJECTED` o `VOIDED` | `checkUsed` |
  | Movimiento bancario `MANUAL_LINK` | `bankMovementManualLink` |
  | Sin trazabilidad | `untraceable` |

- [ ] **Step 1: Tests (fallan)**:
  - `revert(apply) restaura banco, caja y cheques`.
  - `cheque depositado → checkUsed`.
  - `cheque endosado en OP → checkEndorsedInOtherOp con el número de OP`.
  - `updateReceipt edita un borrador y rechaza un confirmado`.
  - Los integration de RC existentes siguen verdes.
- [ ] **Step 2: Correrlos y ver que fallan.**
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Tests en verde. `check-types` ≤ 216. Verificar en el navegador la edición de un RC borrador.**
- [ ] **Step 5: Commit** `feat(commercial): efectos del recibo reversibles y edición de recibos en borrador (TSK-792)`

---

### Tarea 9: Efectos de la Factura de Compra

**Files:**
- Create: `src/modules/commercial/shared/effects/purchase-invoice.server.ts`
- Modify: `src/modules/commercial/shared/credit-note-compensation.ts`. Suma `unapplyPurchaseCreditNoteTx` y `unapplySalesCreditNoteTx`.
- Modify: `purchases/features/invoices/list/actions.server.ts`. Hace estos cambios:
  - `confirmPurchaseInvoice` usa `applyPurchaseInvoiceEffectsTx`.
  - La validación previa (~l.1263-1432, sin el guard de DRAFT) se extrae a `validatePurchaseInvoiceForConfirmation`.
  - La escritura de `updatePurchaseInvoice` (~l.1099-1209, sin el guard) se extrae a `writePurchaseInvoiceDataTx`.
  - `updatePurchaseOrderInvoicingStatus` (~l.1830-1860) se mueve al archivo de efectos y se exporta.
- Test: `src/modules/commercial/shared/effects/purchase-invoice-effects.integration.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export async function applyPurchaseInvoiceEffectsTx(tx: Tx, ctx: EffectsCtx, invoiceId: string, opts?: DocumentEntryOptions): Promise<EffectsResult>;
  // stock de NC (RETURN, almacén MAIN), invoicedQty de OC + updatePurchaseOrderInvoicingStatus, asiento, applyPurchaseCreditNote (NC)
  export async function revertPurchaseInvoiceEffectsTx(tx: Tx, ctx: EffectsCtx, invoiceId: string): Promise<void>;
  // NC: revierte cada StockMovement referenceType 'purchase_invoice' referenceId=id (mismo almacén, cantidad inversa) y los borra;
  // OC: decrementa invoicedQty por línea y recalcula; NC: unapplyPurchaseCreditNoteTx
  export async function unapplyPurchaseCreditNoteTx(tx: Tx, creditNoteId: string): Promise<string[]>; // borra aplicaciones dadas, recalcula y devuelve ids de facturas afectadas
  export async function validatePurchaseInvoiceForConfirmation(invoiceId: string, companyId: string): Promise<void>; // BusinessError
  export async function writePurchaseInvoiceDataTx(tx: Tx, companyId: string, invoiceId: string, input: PurchaseInvoiceFormInput): Promise<void>;
  export async function updatePurchaseOrderInvoicingStatus(tx: Tx, purchaseOrderId: string): Promise<void>;
  ```
- Al **eliminar** la FC, el motor (Tarea 12) desvincula estos registros, que no son efectos:
  - `ReceivingNote.purchaseInvoiceId = null`
  - `PurchaseOrderInstallment.purchaseInvoiceId = null`
  - Los `ProjectionDocumentLink` de la factura se borran.

- [ ] **Step 1: Tests (fallan)**:
  - `revert(apply) de FC con OC deja invoicedQty y estado de la OC como antes`.
  - `revert(apply) de NC devuelve stock y borra aplicaciones; la factura compensada vuelve a CONFIRMED`.
  - `writePurchaseInvoiceDataTx cambia líneas y totales de una FC confirmada`.
  - `confirmar sigue igual`: los integration `purchase-invoice-*` existentes siguen verdes.
- [ ] **Step 2: Correrlos y ver que fallan.**
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Tests en verde, suite completa y `check-types` ≤ 216.**
- [ ] **Step 5: Commit** `refactor(commercial): efectos de la factura de compra reversibles (TSK-792)`

---

### Tarea 10: Efectos de la Factura de Venta

**Files:**
- Create: `src/modules/commercial/shared/effects/sales-invoice.server.ts`
- Modify: `sales/features/invoices/list/actions.server.ts`. Tres cambios:
  - `confirmInvoice` usa `applySalesInvoiceEffectsTx`.
  - Se extraen `validateSalesInvoiceForConfirmation` (~l.884-1054, sin el guard) y `writeSalesInvoiceDataTx` (~l.1290-1380, sin el guard).
  - `writeSalesInvoiceDataTx` rechaza cambios de `pointOfSaleId`, `voucherType` o `number` con el error de negocio `El punto de venta, el tipo y el número de una factura de venta no se pueden modificar.`
- Test: `src/modules/commercial/shared/effects/sales-invoice-effects.integration.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export async function applySalesInvoiceEffectsTx(tx: Tx, ctx: EffectsCtx, invoiceId: string, opts?: DocumentEntryOptions): Promise<EffectsResult>;
  // stock SALE/RETURN (igual que confirmInvoice), asiento, applySalesCreditNote (NC)
  export async function revertSalesInvoiceEffectsTx(tx: Tx, ctx: EffectsCtx, invoiceId: string): Promise<void>;
  // revierte TODOS los StockMovement referenceType 'sales_invoice' referenceId=id en su propio almacén (cantidad inversa) y los borra; NC: unapplySalesCreditNoteTx
  export async function validateSalesInvoiceForConfirmation(invoiceId: string, companyId: string): Promise<void>;
  export async function writeSalesInvoiceDataTx(tx: Tx, companyId: string, invoiceId: string, input: CreateInvoiceInput): Promise<void>;
  export function isAfipLocked(invoice: { cae: string | null; pointOfSale: { afipEnabled: boolean } }): boolean;
  ```
  `CreateInvoiceInput` = `z.infer<typeof createInvoiceSchema>` (`sales/features/invoices/shared/validators.ts:62`); si ya hay un tipo exportado con otro nombre, usar ese.
- Al **eliminar o anular** la FV, el motor vuelve los remitos a `ACCEPTED` con `salesInvoiceId = null`.

- [ ] **Step 1: Tests (fallan)**
  - `revert(apply) de factura con dos líneas del mismo producto restaura todo el stock`.
  - `revert(apply) de NC de venta resta lo que sumó`.
  - `writeSalesInvoiceDataTx rechaza cambiar el número`.
  - `isAfipLocked`, que es unit.
  - Los integration `sales-invoice-*` existentes siguen verdes.
- [ ] **Step 2: Correrlos y ver que fallan.**
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Tests en verde, suite completa y `check-types` ≤ 216.**
- [ ] **Step 5: Commit** `refactor(commercial): efectos de la factura de venta reversibles (TSK-792)`

---

### Tarea 11: Efectos del Movimiento de Fondo

**Files:**
- Create: `src/modules/commercial/shared/effects/fund-movement.server.ts`. Recibe `applyFundSide`, `resolveMovementCapitalAccount`, la armada de líneas y `createJournalEntryForFundMovement`, todos movidos desde `fund-movements/list/actions.server.ts`.
- Modify: `fund-movements/list/actions.server.ts`:
  - `confirmFundMovement` usa `applyFundMovementEffectsTx`.
  - La escritura de `updateFundMovement` (sin el guard) se extrae a `writeFundMovementDataTx`.
- Test: `src/modules/commercial/shared/effects/fund-movement-effects.integration.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export async function applyFundMovementEffectsTx(tx: Tx, ctx: EffectsCtx, fundMovementId: string, opts?: DocumentEntryOptions): Promise<EffectsResult>;
  export async function revertFundMovementEffectsTx(tx: Tx, ctx: EffectsCtx, fundMovementId: string): Promise<void>; // por fundMovementId; saldos inversos
  export async function fundMovementEffectImpedimentsTx(tx: Tx, fundMovementId: string, docLabel: string): Promise<Impediment[]>;
  // banco reconciled → fundBankMovementReconciled; caja CLOSED → cashSessionClosed; MF CONFIRMED sin movimientos vinculados → untraceable
  export async function writeFundMovementDataTx(tx: Tx, companyId: string, fundMovementId: string, input: FundMovementInput): Promise<void>;
  ```
  `FundMovementInput` es el tipo que ya usa `updateFundMovement`, con las líneas de concepto del TSK-791.
  `applyFundMovementEffectsTx` también deja en el MF `journalEntryId`, `journalEntryNumber` y `conceptName`, como hace hoy el confirm.

- [ ] **Step 1: Tests (fallan)**:
  - `revert(apply) en los cuatro tipos deja saldos como antes`.
  - `banco conciliado → impedimento MANUAL`.
  - `MF viejo sin vínculos → untraceable`.
  - Los integration `fund-movement-*` existentes siguen verdes.
- [ ] **Step 2: Correrlos y ver que fallan.**
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Tests en verde, suite completa y `check-types` ≤ 216.**
- [ ] **Step 5: Commit** `refactor(commercial): efectos del movimiento de fondo reversibles (TSK-792)`

---

### Tarea 12: Motor de corrección: cadena, ejecución, vista previa y aplicación

**Files:**
- Create: `src/modules/commercial/shared/correction/chain.server.ts`. Arma el plan de la cadena.
- Create: `src/modules/commercial/shared/correction/snapshot.server.ts`. Foto de las entidades afectadas.
- Create: `src/modules/commercial/shared/correction/engine.server.ts`. Ejecución, vista previa y aplicación.
- Create: `src/modules/commercial/shared/correction/registry.server.ts`. Por tipo: efectos, escritura, validación, etiqueta, permisos y schema de edición.
- Test: `src/modules/commercial/shared/correction/engine.integration.test.ts`

**Interfaces:**
- Consumes: todo lo de las Tareas 4 a 11.
- Produces:
  ```ts
  // registry.server.ts
  export interface KindHandler {
    permissionModule: PermissionModule;            // ver Global Constraints
    editSchema: ZodType;                           // schema del form de edición de ese tipo
    label(tx: Tx, id: string): Promise<string>;    // "la FC A 0003-00001234"
    apply: typeof applyPaymentOrderEffectsTx;      // misma firma en los 5
    revert: (tx: Tx, ctx: EffectsCtx, id: string) => Promise<void>;
    effectImpediments: (tx: Tx, id: string, docLabel: string) => Promise<Impediment[]>;
    write: (tx: Tx, companyId: string, id: string, input: unknown) => Promise<void>;
    validateForConfirmation?: (id: string, companyId: string) => Promise<void>;
  }
  export const CORRECTION_HANDLERS: Record<CorrectableKind, KindHandler>;
  // chain.server.ts
  export interface DependentChange { ref: DocRef; mode: 'ADJUST' | 'DELETE'; itemChanges: { itemId: string; after: number }[]; payment?: { paymentId: string; after: number } }
  export interface CorrectionPlan { request: CorrectionRequest; dependents: DependentChange[]; impediments: Impediment[]; pendingChoices: PaymentChoice[]; datesToCheck: Date[] }
  export async function planCorrectionTx(tx: Tx, ctx: EffectsCtx, request: CorrectionRequest): Promise<CorrectionPlan>;
  // snapshot.server.ts
  export async function loadChainSnapshotTx(tx: Tx, companyId: string, refs: readonly DocRef[]): Promise<ChainSnapshot>;
  // engine.server.ts
  export async function previewCorrection(ctx: EffectsCtx, request: CorrectionRequest): Promise<CorrectionProposal>;
  export type ApplyResult = { applied: true } | { applied: false; stale: true; proposal: CorrectionProposal };
  export async function applyCorrection(ctx: EffectsCtx, request: CorrectionRequest, fingerprint: string): Promise<ApplyResult>;
  ```
- `planCorrectionTx` arma la cadena (§4.3) para orígenes FC y FV:
  - **Cancelaciones.** Las toma de los ítems de OP/RC en CONFIRMED y de las NC aplicadas a la factura.
  - **Reducción.** Al editar, `max(0, cancelado − totalNuevo)`. Al eliminar o anular, el total cancelado.
  - **Reparto.** Pasa por `allocateReduction`.
  - **Por cada OP/RC tocada:**
    - Si **todas** sus imputaciones quedan en 0 → `DELETE`.
    - Si no → `ADJUST`: baja `itemChanges` y aplica `planPaymentReduction` con `request.choices[documentId]`.
      - `NEEDS_CHOICE` → la agrega a `pendingChoices`.
      - `INSUFFICIENT` → `withholdingsInsufficient`.
  - **NC aplicada con monto a bajar** → reduce o borra la aplicación.
- Impedimentos que agrega el plan además de los de efectos de cada documento:
  - Estado inválido del origen, por ejemplo ya anulado: `invalidState`.
  - `ENTRY_POSTED`:
    - origen en EDIT o DELETE con asiento POSTED;
    - dependientes con asiento POSTED, en cualquier modo.
  - `AFIP_CAE`.
  - `PARTY_CHANGED_WITH_PAYMENTS`: el proveedor o cliente cambia y hay cancelaciones.
  - `REFERENCED_BY_NOTE`, en DELETE: una NC/ND referencia la factura (`originalInvoiceId`) y no está anulada.
  - `MONTHLY_PROCESS`, con `findMonthlyProcessEntriesTx(datesToCheck)`:
    - `VAT_SETTLEMENT` solo si hay una FC o FV en la cadena;
    - los otros procesos, siempre.
  - `PERIOD_CLOSED`: `assertPeriodOpen` sobre cada fecha de `datesToCheck` (fechas viejas y nuevas de origen y dependientes), con el error capturado.
- Orden de ejecución dentro de la tx (`executePlanTx`, privada):
  1. `revert` de cada dependiente.
  2. `revert` del origen.
  3. Origen:
     - **EDIT:** `write` con los datos validados por `editSchema`, después `validateForConfirmation` y después `apply(rewriteEntryId = journalEntryId)`.
     - **DELETE:** desvincular los no-efectos (Tareas 9 y 10), `deleteDraftJournalEntryTx` y borrar el comprobante.
     - **CANCEL:** con asiento DRAFT, `deleteDraftJournalEntryTx` y `journalEntryId = null`. Con asiento POSTED, `reverseJournalEntryTx` con la `date` del comprobante (ver el ruling de abajo). Después, estado `CANCELLED`.
  4. Dependientes:
     - **ADJUST:** escribir los importes nuevos de ítems y del medio, recalcular el total y `apply(rewriteEntryId)`.
     - **DELETE:** `deleteDraftJournalEntryTx` y borrar el comprobante.
  5. `recompute*StatusTx` de todas las facturas y gastos tocados.
- `previewCorrection`:
  1. Abre `prisma.$transaction`.
  2. Planifica.
  3. Si hay impedimentos o `pendingChoices`, devuelve la propuesta sin ejecutar: `cards = []` y huella vacía cuando hay impedimentos. Si solo faltan elecciones, la propuesta lleva las tarjetas de la ejecución con el primer medio, por cada pendiente, solo para mostrar.
  4. Si no: toma la foto `before`, ejecuta, toma la foto `after` y calcula `cards = describeChanges(...)` y la huella.
  5. Lanza un `RollbackSignal` privado para descartar todo y devuelve la propuesta.
  6. Un `BusinessError` que ocurra mientras ejecuta se devuelve como `simulationError(message)`.
- `applyCorrection` repite lo mismo y hace `commit` solo si no hay impedimentos ni elecciones pendientes **y** la huella coincide. Si no coincide, hace rollback y devuelve `{ applied: false, stale: true, proposal }`.
- Ruling: `reverseJournalEntryTx` hoy recibe `date` como fecha del contraasiento y valida el período del original y el de esa fecha. Al pasar la fecha del comprobante se cumple §5.3 sin tocar la función.

- [ ] **Step 1: Tests de integración (fallan)**, todos con la base real:
  1. `FC 1.000.000 → 800.000 pagada por OP de transferencia: OP, banco y asientos bajan; números de asiento iguales`. Es el ejemplo del spec, §4.3 y §7.
  2. `FC pagada por una OP de varias facturas: solo baja su imputación` (Review Focus 1).
  3. `subir el monto no toca la OP y la FC queda PARTIAL_PAID`.
  4. `eliminar FC cuya OP solo la pagaba elimina la OP y devuelve el saldo del banco`.
  5. `anular FC con asiento POSTED genera contraasiento con la fecha de la FC y la deja CANCELLED`.
  6. `preview no cambia nada ni consume numeración` (Review Focus 2). Compara una foto completa de la empresa y `readLastEntryNumber` antes y después.
  7. `apply con huella vieja no aplica y devuelve propuesta nueva` (Review Focus 3). Entre la vista previa y la aplicación cambia la fecha de la OP por fuera.
  8. `cambiar solo el número no toca la OP y conserva el número de asiento` (Review Focus 4).
  9. `caja cerrada bloquea y no aplica nada` (Review Focus 5).
  10. `OP con dos medios pide elección; con choice aplica sobre ese medio`.
  11. `asiento de la OP registrado → ENTRY_POSTED MANUAL con href a Asientos`.
  12. `liquidación de IVA del mes → MONTHLY_PROCESS`.
  13. `FV con CAE → AFIP_CAE`.
  14. `cambiar proveedor con OP vinculada → PARTY_CHANGED_WITH_PAYMENTS`.
  15. `eliminar RC con cheque en cartera borra el cheque; con cheque endosado → impedimento`.
  16. `editar MF de gastos bancarios cambia el banco y reescribe el asiento`.
  17. `anular OP confirmada la deja CANCELLED y la factura vuelve a CONFIRMED`.
- [ ] **Step 2: Correrlos y ver que fallan.**
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Tests en verde, suite completa y `check-types` ≤ 216.**
- [ ] **Step 5: Commit** `feat(commercial): motor de corrección en cadena con vista previa y aplicación atómica (TSK-792)`

---

### Tarea 13: Actions y diálogo de propuesta (variante A)

**Files:**
- Create: `src/modules/commercial/shared/actions/document-correction.server.ts` (`'use server'`)
- Create: `src/modules/commercial/shared/components/_CorrectionProposalDialog.tsx`
- Create: `src/modules/commercial/shared/components/_CorrectionCard.tsx`
- Create: `src/modules/commercial/shared/components/_CorrectionImpediments.tsx`
- Create: `src/modules/commercial/shared/hooks/useDocumentCorrection.ts`
- Test: `src/modules/commercial/shared/actions/document-correction.integration.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // actions
  export async function previewDocumentCorrection(request: CorrectionRequest): Promise<ActionResult<{ proposal: CorrectionProposal }>>;
  export async function applyDocumentCorrection(request: CorrectionRequest, fingerprint: string): Promise<ActionResult<{ applied: boolean; proposal?: CorrectionProposal }>>;
  // permiso: checkPermission(CORRECTION_HANDLERS[kind].permissionModule, mode === 'EDIT' ? 'update' : 'delete', { redirect: true });
  // tras aplicar: revalidatePath de las rutas de compras, ventas, tesorería y contabilidad afectadas + logger.info con request y cards
  // hook
  export function useDocumentCorrection(opts: { onApplied: () => void }): {
    open: (request: CorrectionRequest) => void;   // pide preview y abre el diálogo
    dialog: React.ReactNode;                      // <_CorrectionProposalDialog …/>
    isPending: boolean;
  };
  ```
- Diálogo, según el §7 del spec y la variante A del boceto:
  - **Título.** Según el modo: `Revisá los cambios antes de guardar`, `…antes de eliminar` o `…antes de anular`.
  - **Resumen.** `Esta corrección modifica {N} registros. Se aplican todos juntos al confirmar; si algo falla, no se aplica ninguno.`
  - **Una `_CorrectionCard` por tarjeta.** Lleva el título, una etiqueta con el rótulo de la acción (Global Constraints) y filas con la etiqueta, el valor de antes tachado y el de después.
  - **Elecciones pendientes.** Un `Select` "¿De qué medio de pago se descuenta?" en la tarjeta de esa OP o RC. Al cambiarlo se vuelve a pedir la vista previa con `choices`.
  - **Impedimentos.**
    - Aviso: `Hay {N} impedimentos. Hasta resolverlos no se aplica ningún cambio. Tus datos editados quedan en el formulario.`
    - Una fila por impedimento con la etiqueta `Podés resolverlo` o `No se puede`, el mensaje, la acción y un enlace si hay `href`.
    - Confirmar queda deshabilitado.
  - **Botones.** `Volver a editar` en EDIT, `Cancelar` en los otros modos, y `Confirmar corrección`.
  - **Respuesta `stale`.** Reemplaza la propuesta y muestra el toast `Algo cambió mientras revisabas. Revisá la propuesta actualizada.`
  - Cada componente queda por debajo de 200 líneas. Responsive: el diálogo ocupa la pantalla completa en mobile.

- [ ] **Step 1: Tests (fallan)**:
  - `preview sin permiso update rechaza`: `checkPermission` mockeado para rechazar en la combinación indicada.
  - `apply devuelve applied:true y deja los cambios`.
  - `apply stale devuelve propuesta nueva`.
- [ ] **Step 2: Correrlos y ver que fallan.**
- [ ] **Step 3: Implementar las actions, el hook y los componentes.**
- [ ] **Step 4: Tests en verde y `check-types` ≤ 216.**
- [ ] **Step 5: Commit** `feat(commercial): actions y diálogo de propuesta de corrección (TSK-792)`

---

### Tarea 14: Editar, eliminar y anular FC y FV desde la UI

**Files:**
- Modify: `purchases/features/edit/EditPurchaseInvoice.tsx` (~l.29) y `sales/features/edit/EditInvoice.tsx` (~l.31). Admiten CONFIRMED, PAID y PARTIAL_PAID además de DRAFT. Para una FV con CAE se mantiene el redirect.
- Modify: el form de edición de cada uno, el que llama a `updatePurchaseInvoice` / `updateInvoice`. Si el comprobante no es DRAFT, el submit llama a `open({ mode: 'EDIT', ref, data })` de `useDocumentCorrection` y no guarda directo. Al aplicar, navega al detalle.
- Modify: `purchases/features/invoices/list/columns.tsx` (~l.147-190) y `_PurchaseInvoicesTable.tsx` (~l.141-157, 209, 230+). Mismos cambios en `sales/features/invoices/list/columns.tsx` (~l.148-190) y `_InvoicesTable.tsx` (~l.73-86, 140-143, 192-217). Cambios:
  - **Editar** sale también en los confirmados, con el permiso `update` (`canCorrect`).
  - **Eliminar**, nuevo, para confirmados con el permiso `delete`.
  - **Anular** abre el diálogo de corrección (modo `CANCEL`) en vez del AlertDialog actual.
  - En una FV con CAE no se muestran.
- Modify: `purchases/features/invoices/detail/PurchaseInvoiceDetail.tsx` (header ~l.100-135) y `sales/features/invoices/detail/InvoiceDetail.tsx` (~l.65-71). Botones Editar, Eliminar y Anular con las mismas condiciones.
- Delete/replace: `cancelPurchaseInvoice` y `cancelInvoice` (anular viejo).
  - Si no se usan más, se eliminan.
  - Si los usa otro lugar (por ejemplo, una acción masiva), se reimplementan delegando en `applyCorrection` con el modo `CANCEL`.
  - Ruling: no puede quedar un camino de anulación que deje el asiento vivo.
- Modify: `_CommercialGuide.tsx`. Cubre editar o eliminar una factura confirmada, anular, la propuesta de corrección y los impedimentos.

- [ ] **Step 1: Verificar en el navegador** (puerto 3010, datos demo). Escenarios:
  - FC pagada con OP por transferencia: bajar el total → la propuesta muestra FC, asiento, OP, movimiento bancario y asiento de la OP → confirmar → verificar los saldos.
  - Cambiar solo el número de la FC.
  - Eliminar una FC sin pagos.
  - Anular una FV no AFIP cobrada.
  - Ver que Editar, Eliminar y Anular están ocultos en una FV con CAE.
  - Impedimento: asiento de la OP registrado → aparece "Podés resolverlo" con el enlace.
- [ ] **Step 2: Implementar.**
- [ ] **Step 3: Repetir la verificación del Step 1. `npm run test` verde, `check-types` ≤ 216, `npm run lint` sin errores nuevos en los archivos tocados.**
- [ ] **Step 4: Commit** `feat(commercial): editar, eliminar y anular facturas confirmadas con corrección en cadena (TSK-792)`

---

### Tarea 15: Editar, eliminar y anular OP, RC y MF desde la UI

**Files:**
- Modify: `payment-orders/list/columns.tsx` (~l.111-130), `_PaymentOrdersTable.tsx`, `_EditPaymentOrderModal.tsx` (~l.83: admite CONFIRMED) y `_CreatePaymentOrderModal.tsx` (~l.310: si es CONFIRMED, el submit va por `useDocumentCorrection`).
- Modify: `receipts/list/columns.tsx` (~l.108-127), `_ReceiptsTable.tsx`, `_EditReceiptModal.tsx` y `_CreateReceiptModal.tsx`. El modo edición de la Tarea 8 suma la rama de confirmados.
- Modify: `fund-movements/shared/view-mode.ts` (`getRowActions`: Editar, Eliminar y Anular en CONFIRMED), `fund-movements/list/columns.tsx` (~l.146-165) y `_CreateFundMovementModal.tsx` (modo edit en confirmados va por `useDocumentCorrection`).
- Modify: los badges de estado de las tres listas muestran `Anulada` / `Anulado` para CANCELLED, si hoy no lo hacen.
- Modify: `_TreasuryGuide.tsx`.

- [ ] **Step 1: Verificar en el navegador.** Escenarios:
  - Editar el importe de una OP confirmada con un solo medio.
  - Una OP con dos medios: elegir el medio.
  - Anular una OP: la factura vuelve a Confirmada.
  - Eliminar un RC con cheque en cartera.
  - Un RC con cheque depositado: impedimento "No se puede".
  - Editar un MF de gastos bancarios.
  - Anular un MF de aporte.
- [ ] **Step 2: Implementar.**
- [ ] **Step 3: Repetir la verificación. `npm run test` verde, `check-types` ≤ 216 y lint sin errores nuevos.**
- [ ] **Step 4: Commit** `feat(commercial): editar, eliminar y anular OP, recibos y movimientos de fondo (TSK-792)`

---

### Tarea 16: Documentación y presentación al cliente

**Files:**
- Modify: `docs/modules/accounting.md`. Cubre volver a borrador, el trigger, `process` y `rewriteDraftJournalEntryTx`.
- Modify: `docs/modules/commercial.md`. Cubre la corrección en cadena: efectos, motor, impedimentos y permisos.
- Modify: `docs/architecture/data-model.md`. Lista los campos y enums nuevos.
- Modify: `docs/architecture/project-structure.md`. Lista `commercial/shared/effects` y `commercial/shared/correction`.
- Create: `scripts/guia-presentacion/capturas-tsk792.mjs`. Usa el molde de `capturas-tsk791.mjs`: `--only=`, una descripción única por corrida y el indicador de Next oculto.
- Create: `scripts/guia-presentacion/tsk-792.html`
- Create: `docs/presentaciones/TSK-792-correccion-en-cadena.pdf`, generado con `scripts/guia-presentacion/generar-pdf.mjs`.

- [ ] **Step 1: Docs.** Además, una sección **Deploy** en `commercial.md` con estos puntos:
  - Las migraciones llevan backfill.
  - Después de deployar hay que correr `prisma/scripts/tsk792-diagnostico-trazabilidad.sql` en prod y revisar cuántos movimientos quedaron sin vincular. Esos no se podrán corregir automáticamente.
  - Las facturas anuladas antes de este cambio que tienen el asiento vivo no se migran.
- [ ] **Step 2: Capturas.**
  - Lista de asientos con "Volver a borrador".
  - Propuesta de la FC del ejemplo (variante A).
  - Propuesta con impedimentos.
  - Elección de medio de pago.
  - Anular una OP.
  - Factura editada con su estado final.
- [ ] **Step 3: HTML y PDF.**
  - Lenguaje de cliente: qué cambia, cómo se usa y qué no se puede.
  - Un recuadro "Importante" con:
    - el período cerrado;
    - la FV con CAE;
    - que, si ya se generó la liquidación de IVA del mes, primero hay que anularla.
- [ ] **Step 4: Commit** `docs: guías, docs y presentación de la corrección en cadena (TSK-792)`
