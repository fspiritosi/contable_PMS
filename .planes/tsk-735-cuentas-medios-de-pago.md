# TSK-735 Cuentas para cheques, tarjetas y cuenta corriente — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que recibos y OP pagados con cheque o tarjeta generen el asiento completo, que el ciclo de vida del cheque se contabilice, y que lo histórico quede regularizado o listado.

**Architecture:**
- La regla de "qué cuenta lleva cada pago" sigue en un único lugar: `commercial/shared/payment-accounts.ts`, puro.
  - Ahora recibe el tipo de documento.
  - Resuelve cheques y tarjetas contra las cuentas nuevas de Configuración.
  - `omitted` queda solo para ACCOUNT.
- Cada cheque y cada cuota de tarjeta guarda en una columna (`accountId`) la cuenta donde quedó registrado. Con eso, depósito, endoso, débito, anulación y devolución al socio descargan la cuenta correcta. Si la columna está en null (históricos), descargan contra Deudores/Proveedores del tercero.
- Los asientos del ciclo del cheque se arman con una función pura (`check-entry-lines.ts`) y se persisten con `createJournalEntryTx` dentro de la tx de cada acción.

**Tech Stack:** Next.js 16 server actions, Prisma 7, Vitest (unit + integración contra la DB de dev), React Hook Form + Zod, shadcn.

**Spec:** `docs/superpowers/specs/2026-10-31-tsk-735-cuentas-medios-de-pago-design.md`

## Global Constraints

- **Migración:** SQL escrita a mano en `prisma/migrations/20261031120000_tsk_735_cuentas_cheques_tarjetas/migration.sql`, aplicada con `npx prisma migrate deploy` y luego `npx prisma generate`.
  - NUNCA `migrate reset`, `migrate dev` ni `db push`.
- **Errores de negocio:** `BusinessError` y `ActionResult`; nunca `throw new Error` con un mensaje para el usuario, porque Next lo redacta en producción.
  - Las acciones de cheques que cambian pasan a devolver `ActionResult<{ warnings: string[] }>` y sus modales muestran `result.error` y los avisos con toast.
- **Fechas de negocio:** día de Argentina (`todayBusinessDay`). Nunca `new Date()` como fecha del asiento.
- **Asientos automáticos:** nacen en DRAFT con `createdBy: 'system'` y respetan período cerrado vía `createJournalEntryTx`. Si el asiento falla, la acción entera se revierte.
- **Etiquetas exactas en Configuración y en los mensajes:**
  - `checksReceivedAccountId`: "Valores a depositar"
  - `checksRejectedAccountId`: "Cheques rechazados"
  - `checksPayableAccountId`: "Valores diferidos a pagar"
  - `creditCardsPayableAccountId`: "Tarjetas de crédito a pagar"
  - `partnerDebtsAccountId`: "Deudas con socios"
- **Mensaje de rechazo de ACCOUNT, literal:** `El medio "Cuenta Corriente" ya no se usa: elegí otro medio o registrá una nota de crédito/débito`
- **Convenciones del proyecto:**
  - No `:any`.
  - `logger` en vez de `console`.
  - `checkPermission` en cada action. "Debitar" usa `commercial.treasury.checks` con acción `approve`, como Acreditar.
  - Decimal → `Number()` antes de cliente.
  - Componentes de menos de 200 líneas.
- **Commits:** en la rama `feat/tsk-735-cuentas-medios-de-pago`, con el trailer de la sesión. No se commitean `docs/inversione.txt`, `AGENTS.md`, `diag-antes.txt`, `prisma/scripts/verificacion-post-deploy.sh` ni los PDF de `scripts/guia-presentacion`.

## Review Focus

1. **Corrección TSK-792 de un RC u OP confirmado con cheque:** reescribir el asiento y reaplicar efectos no debe duplicar ni perder el `accountId` del cheque recreado. Test en Task 3.
2. **Cheque cargado a mano** (sin `receiptPaymentId` ni `paymentOrderPaymentId`, `accountId` null): depositarlo no debe acreditar Deudores sin tercero. Va sin asiento y con aviso. Test en Task 4.
3. **Depositar con el mes cerrado:** error legible; el cheque sigue en cartera y el banco no se mueve. Test en Task 4.
4. **OP de devolución a socio con cuotas mezcladas** (una con `accountId`, otra histórica): el asiento cuadra con una línea por origen. Test en Task 3.
5. **Editar un borrador histórico que tiene "Cuenta Corriente":** guardar lo rechaza con el mensaje literal; confirmarlo sin editar sigue funcionando (omitido con aviso). Test en Task 5.

---

### Task 1: Cuentas nuevas en el schema y en Contabilidad → Configuración

**Files:**
- Modify: `prisma/schema.prisma`
  - `AccountingSettings`: los 3 campos nuevos y sus relaciones.
  - `Check`: `accountId`, `depositEntryId`, `rejectionEntryId`, `debitEntryId` y `voidEntryId`, cada uno con FK `onDelete: SetNull`.
  - `PaymentOrderInstallment`: `accountId`.
  - Back-relations en `Account` y `JournalEntry`, con nombres de relación únicos (`ChecksPayableAccount`, `CreditCardsPayableAccount`, `PartnerDebtsAccount`, `CheckAccount`, `CheckDepositEntry`, `CheckRejectionEntry`, `CheckDebitEntry`, `CheckVoidEntry`, `InstallmentAccount`).
- Create: `prisma/migrations/20261031120000_tsk_735_cuentas_cheques_tarjetas/migration.sql`
- Modify: `src/shared/lib/accounts/settings-account-labels.ts` (agregar los 5 campos con las etiquetas de Global Constraints).
- Modify: `src/modules/accounting/features/settings/validators.ts` (`commercialIntegrationSchema`: los 5 campos, uuid opcional/nullable como los vecinos).
- Modify: `src/modules/accounting/features/settings/actions.server.ts` (select y guardado de los 5 campos).
- Modify: `src/modules/accounting/features/settings/components/_CommercialIntegrationForm.tsx` (sección "Cheques y tarjetas" con los 5 selectores, mismo componente de cuenta que los vecinos). Si el form pasa de 200 líneas, extraer la sección a `_ChecksAndCardsAccountsSection.tsx`.
- Test: `src/modules/accounting/features/settings/validators.test.ts` (ya verifica que cada `*AccountId` tenga label) y `accounting-settings.integration.test.ts`.

**Interfaces:**
- Produces:
  - Prisma: `AccountingSettings.checksPayableAccountId`, `.creditCardsPayableAccountId` y `.partnerDebtsAccountId` (más los existentes `checksReceivedAccountId` y `checksRejectedAccountId`).
  - Prisma: `Check.accountId`, `.depositEntryId`, `.rejectionEntryId`, `.debitEntryId` y `.voidEntryId`; `PaymentOrderInstallment.accountId`. Todos `String?` uuid.
  - Los 5 campos en `ACCOUNTING_SETTINGS_ACCOUNT_FIELDS` (`settingsAccountLabel('checksPayableAccountId') === 'Valores diferidos a pagar'`).

- [ ] **Step 1:** En `accounting-settings.integration.test.ts`, test `guarda y devuelve las cuentas de cheques y tarjetas (TSK-735)`:
  - Guarda los 5 campos con 5 cuentas imputables.
  - Relee la configuración y espera los 5 ids.
  - Correrlo con `npx vitest run src/modules/accounting/features/settings`: falla porque los campos no existen.
- [ ] **Step 2:** Schema y migración.
  - SQL: `ALTER TABLE accounting_settings ADD COLUMN checks_payable_account_id uuid REFERENCES accounts(id)`, y lo mismo para `credit_cards_payable_account_id` y `partner_debts_account_id`.
  - `ALTER TABLE checks ADD COLUMN account_id uuid REFERENCES accounts(id) ON DELETE SET NULL`, y `deposit_entry_id`, `rejection_entry_id`, `debit_entry_id` y `void_entry_id` como `REFERENCES journal_entries(id) ON DELETE SET NULL`.
  - `ALTER TABLE payment_order_installments ADD COLUMN account_id uuid REFERENCES accounts(id) ON DELETE SET NULL`.
  - Copiar el estilo de FK de una migración vecina (nombres de constraint `<tabla>_<columna>_fkey`).
  - Aplicar con `npx prisma migrate deploy && npx prisma generate`.
- [ ] **Step 3:** Labels, validator, action y sección del form.
- [ ] **Step 4:** `npx vitest run src/modules/accounting/features/settings` en verde, y `npx tsc --noEmit -p .` sin errores nuevos en los archivos tocados.
- [ ] **Step 5:** Commit `feat(accounting): cuentas de cheques y tarjetas en Configuración (TSK-735)`.

### Task 2: Resolución pura de la cuenta de cada pago

**Files:**
- Modify: `src/modules/commercial/shared/payment-accounts.ts`
- Test: `src/modules/commercial/shared/payment-accounts.test.ts`

**Interfaces:**
- Consumes: los campos de Task 1.
- Produces:
  - `PaymentAccountSettings`: suma `checksReceivedAccountId?`, `checksPayableAccountId?`, `creditCardsPayableAccountId?` y `partnerDebtsAccountId?`, además de `receivablesAccountId?` y `payablesAccountId?` (para endosos y cuotas históricos).
  - `PaymentAccountCheck`: suma `endorsedCheck?: { accountId: string | null; customerId: string | null; isElectronic: boolean; bankAccount: { accountId: string | null } | null } | null`.
  - `resolvePaymentAccount(payment, settings, kind: EntryDocumentKind)` y `classifyPayments(payments, settings, kind)`. `kind` es obligatorio.
  - Resolución: `{ kind: 'resolved'; accountId; source; customerId?: string | null }`.
  - `ResolvedPaymentSource` suma `'checksReceived' | 'checksPayable' | 'endorsedCheck' | 'endorsedLegacyReceivable' | 'creditCardsPayable' | 'partnerDebts'`.
  - `MissingPaymentAccountVia` suma `'settings:checksReceivedAccountId' | 'settings:checksPayableAccountId' | 'settings:creditCardsPayableAccountId' | 'settings:partnerDebtsAccountId' | 'settings:receivablesAccountId'`.
  - `OmittedPaymentReason` queda en `'ACCOUNT'`.
  - `buildMissingPaymentAccountMessage` para `settings:<campo>`, literal: `No se puede confirmar <doc>: <Medio> por <importe> necesita la cuenta "<label>". Configurala en <ACCOUNTING_SETTINGS_PATH>.`

**Orden de resolución** (decide la semántica; va antes de la cadena caja/banco actual):

| # | Condición | Resultado |
|---|---|---|
| 1 | Tarjeta de socio | `partnerDebtsAccountId` → `partnerDebts`; si no está configurada, missing de ese setting |
| 2 | CHECK/ECHEQ con `kind==='receipt'` | `checksReceivedAccountId` → `checksReceived`; ignora el banco elegido |
| 3 | CHECK/ECHEQ con `endorsedCheckId` en OP, con `endorsedCheck.accountId` | `endorsedCheck` sobre ese id |
| 4 | Ídem, sin `accountId`, no electrónico | `receivablesAccountId` → `endorsedLegacyReceivable` con `customerId` del cheque |
| 5 | Ídem, sin `accountId`, electrónico | cuenta del banco del cheque → `defaultBankAccountId` → missing `noBankAccount` |
| 6 | CHECK propio en OP | `checksPayableAccountId` → `checksPayable` |
| 7 | ECHEQ propio en OP | cadena de banco actual, sin cambio |
| 8 | CREDIT_CARD de la empresa | `creditCardsPayableAccountId` → `creditCardsPayable` |
| 9 | ACCOUNT | omitted |
| 10 | Resto | cadena caja/banco actual |

- [ ] **Step 1:** Reescribir los casos del test que hoy esperan `omitted` y sumar uno por fila de la tabla. Ejemplos de asserts:
  - `resolvePaymentAccount({paymentMethod:'ECHEQ', amount:100, cashRegisterId:null, bankAccountId:'b1', bankAccount:{…accountId:'bankAcc'}}, {checksReceivedAccountId:'vad'}, 'receipt')` → `{kind:'resolved', accountId:'vad', source:'checksReceived'}`.
  - Endoso histórico físico → `{kind:'resolved', accountId:'cobrar', source:'endorsedLegacyReceivable', customerId:'c1'}`.
  - CREDIT_CARD de la empresa sin setting → `{kind:'missing', via:'settings:creditCardsPayableAccountId'}`, y su mensaje contiene `"Tarjetas de crédito a pagar"`.
  - `classifyPayments([...cheque, ...ACCOUNT], s, 'receipt').omittedAmount` es solo el importe de ACCOUNT.
- [ ] **Step 2:** `npx vitest run src/modules/commercial/shared/payment-accounts.test.ts`: falla.
- [ ] **Step 3:** Implementar.
  - Actualizar `OMITTED_REASON_TEXT` (solo ACCOUNT).
  - Actualizar `SUGGESTED_PAYMENTS`: RC "un pago en efectivo, transferencia o cheque"; OP "un pago en efectivo, transferencia, cheque o tarjeta".
  - Actualizar el docblock del archivo.
- [ ] **Step 4:** El test en verde. `tsc` va a marcar los llamadores (`entry-preflight.ts` y `integrations/commercial/index.ts`): se arreglan en Task 3, y este commit queda dentro de la misma rama.
- [ ] **Step 5:** Commit `feat(commercial): cuenta contable de cheques y tarjetas en recibos y OP (TSK-735)`.

### Task 3: Asientos de RC y OP, efectos y OP de devolución a socio

**Files:**
- Modify: `src/modules/accounting/features/integrations/commercial/index.ts`
  - `getAccountingSettings` trae los campos nuevos.
  - `createJournalEntryForReceipt` y `createJournalEntryForPaymentOrder` seleccionan `endorsedCheck` (vía `PaymentOrderPayment.endorsedCheckId`: buscar los cheques por id en una query) y `card`, y pasan `kind`.
  - Las descripciones de línea van por `source`:
    - `checksReceived`: "Cheque recibido - RC-…"
    - `checksPayable`: "Cheque propio entregado - OP-…"
    - `endorsedCheck`/`endorsedLegacyReceivable`: "Cheque endosado - OP-…", con `customerId` cuando venga.
    - `creditCardsPayable`: "Tarjeta de crédito - OP-…"
    - `partnerDebts`: "Tarjeta de socio - OP-…"
  - Nuevo `createJournalEntryForPartnerRepayment(paymentOrderId, companyId, tx, opts?)`:
    - Debe: por cada cuota con `settledByPaymentOrderId = id`, la `accountId` de la cuota; si es null, `payablesAccountId` con el `supplierId` de la OP de origen. Agrupar por (cuenta, proveedor).
    - Haber: los pagos resueltos con `classifyPayments(..., 'paymentOrder')`.
    - Descripción: `Devolución a socio <nombre> - OP-…`.
- Modify: `src/modules/commercial/shared/effects/receipt.server.ts`: después de crear los cheques, `tx.check.updateMany({ where: { receiptPaymentId: { in: ids de pagos CHECK/ECHEQ } }, data: { accountId: settings.checksReceivedAccountId } })`. Leer el setting en el efecto.
- Modify: `src/modules/commercial/shared/effects/payment-order.server.ts`:
  - El cheque propio físico creado lleva `accountId = checksPayableAccountId`. El e-cheq propio lleva null: va por banco.
  - La cuota de tarjeta de socio lleva `partnerDebtsAccountId`; la de crédito de la empresa, `creditCardsPayableAccountId`.
  - Rama `paymentOrder.partnerId`: llamar a `createJournalEntryForPartnerRepayment` y guardar `journalEntryId` en la OP, en lugar de `return { journalEntryId: null }`.
- Modify: `src/modules/commercial/features/treasury/shared/entry-preflight.ts`:
  - Selecciona los settings nuevos más receivables/payables, y `endorsedCheck`.
  - Pasa `kind`.
  - Las OP a socio pasan a `generatesEntry: true`, sin `buildPartnerOrderWarning`. Esa función se borra de `payment-accounts.ts` si queda sin uso.
- Test (modify):
  - `receipts/receipt-journal-entry.integration.test.ts`:
    - Caso 6: cheque + efectivo, sin avisos; Debe Valores a depositar 400 + Caja 600 / Haber Cobrar 1000; el cheque en cartera con `accountId` = Valores a depositar.
    - Caso 7: solo cheque confirma con dos líneas.
    - Nuevo: e-cheq a banco → Valores a depositar, banco sin movimiento.
    - Nuevo: sin "Valores a depositar" configurada → bloqueado con la etiqueta.
  - `payment-orders/payment-order-journal-entry.integration.test.ts`:
    - Caso 5: cheque propio → Haber Valores diferidos a pagar; cheque OWN con `accountId`.
    - Caso 6: endoso de un cheque con `accountId` → Haber Valores a depositar.
    - Nuevo: endoso histórico → Haber Cobrar con `customerId`.
    - Caso 7: crédito de la empresa en 3 cuotas → Haber Tarjetas a pagar; 3 cuotas con `accountId`.
    - Caso 8: débito de socio → Haber Deudas con socios.
    - Caso 10: devolución a socio → asiento Debe Deudas con socios / Haber Caja; la cuota PAID.
    - Nuevo (Review Focus 4): devolución con una cuota histórica más una nueva → dos líneas Debe, una contra Proveedores con `supplierId`.
    - Caso 14: la vista previa ya no muestra el aviso del cheque.
  - Nuevo caso (Review Focus 1), en el test de RC: corregir con el motor TSK-792 un RC confirmado con cheque (molde: los tests de corrección existentes en `src/modules/commercial/shared/correction/`). Después de la corrección hay un solo cheque y tiene `accountId`.
  - Los settings del `beforeAll` de ambos tests cargan las cuentas nuevas. Crearlas como cuentas hoja con códigos `T735-VAD`, `T735-VDP`, `T735-TCP` y `T735-DSO`.

- [ ] **Step 1:** Actualizar o escribir los casos de arriba y correr `npx vitest run src/modules/commercial/features/treasury/features/receipts src/modules/commercial/features/treasury/features/payment-orders`: fallan.
- [ ] **Step 2:** Implementar asientos, efectos y pre-validación.
- [ ] **Step 3:** Los dos tests en verde y `npx vitest run src/modules/commercial/shared` en verde (corrección y efectos).
- [ ] **Step 4:** Commit `feat(commercial): asiento completo de recibos y OP con cheques y tarjetas, y de la devolución a socio (TSK-735)`.

### Task 4: Asientos del ciclo de vida del cheque y acción "Debitar"

**Files:**
- Create: `src/modules/commercial/shared/check-entry-lines.ts` (puro) y `check-entry-lines.test.ts`.
- Create: `src/modules/commercial/shared/effects/check.server.ts`, con `applyCheckEventTx`.
- Modify: `src/modules/commercial/features/treasury/features/checks/actions.server.ts`.
  - `depositCheck`, `rejectCheck` y `voidCheck` devuelven `ActionResult<{ warnings: string[] }>`, con `toActionResult` en el catch.
  - Nuevo `debitCheck(data: { checkId: string; date: Date; bankAccountId: string })`, de DELIVERED a CASHED. Si el cheque no tiene `bankAccountId`, el modal lo pide.
  - Al debitar se crea un `bankMovement` de tipo `CHECK` con el importe negativo, como el pago bancario de OP; se copia el patrón de `payment-order.server.ts`: tipo y decremento del saldo.
- Modify: `src/modules/commercial/features/treasury/shared/validators.ts`: `debitCheckSchema` con checkId, date y bankAccountId.
- Modify UI:
  - `_DepositCheckModal.tsx` y `_CheckDetailModal.tsx`: manejar `ActionResult` y mostrar los avisos.
  - `list/columns.tsx`: ítem "Debitar" para OWN + DELIVERED, gated por `hasPermission('commercial.treasury.checks','approve')`.
  - Nuevo `_DebitCheckModal.tsx`, copiando la estructura de `_DepositCheckModal.tsx`: fecha (default `todayBusinessDay`) y cuenta bancaria (default la del cheque).
- Test: `src/modules/commercial/features/treasury/features/checks/check-entries.integration.test.ts` (nuevo, molde de `receipt-journal-entry.integration.test.ts`).

**Interfaces:**
- Produces:
  - `type CheckEvent = 'DEPOSIT' | 'REJECT' | 'DEBIT' | 'VOID'`
  - `buildCheckEventLines(input: CheckEventInput): { lines: CheckEntryLine[] } | { skip: true; warning: string } | { missing: AccountingSettingsAccountField | 'bank' }`, donde:
    - `CheckEventInput = { event; check: { type: 'OWN' | 'THIRD_PARTY'; status; amount: number; isElectronic: boolean; accountId: string | null; customerId: string | null; supplierId: string | null; fromDocument: boolean; checkNumber: string }; bankAccountId: string | null (cuenta contable del banco ya resuelta); settings: { receivablesAccountId; payablesAccountId; checksRejectedAccountId } }`
    - `CheckEntryLine = { accountId; debit; credit; description; customerId?; supplierId? }`
    - `fromDocument` es `Boolean(receiptPaymentId || paymentOrderPaymentId)`.
  - `applyCheckEventTx(tx, ctx: EffectsCtx, input: { checkId; event; date; bankAccountId?: string }): Promise<{ entryId: string | null; warnings: string[] }>`:
    - Resuelve la cuenta contable del banco (la propia o "Banco por Defecto"; si no hay, `BusinessError` con el mensaje de `buildMissingPaymentAccountMessage` vía `bankAccount`).
    - Arma las líneas, crea el asiento con `createJournalEntryTx` (DRAFT, system) y guarda el id en la columna del evento.

**Reglas de `buildCheckEventLines`.** Cuenta del cheque = `accountId`, o el legado si es null:

| Evento | Cheque | Asiento |
|---|---|---|
| DEPOSIT | tercero con `accountId` | Debe banco / Haber `accountId` |
| DEPOSIT | tercero sin `accountId`, de documento, físico | Debe banco / Haber receivables (`customerId`) |
| DEPOSIT | tercero sin `accountId`, de documento, electrónico | skip: `"El e-cheq N° X ya se registró en el banco al confirmar el recibo: el depósito no genera asiento."` |
| DEPOSIT, DEBIT o VOID | sin `accountId` ni documento | skip: `"El cheque N° X se cargó a mano: registrá el asiento en Contabilidad si corresponde."` |
| REJECT | — | Debe `checksRejectedAccountId` (`customerId`) / Haber banco; sin setting → `missing: 'checksRejectedAccountId'` |
| DEBIT | propio con `accountId` | Debe `accountId` / Haber banco |
| DEBIT | propio sin `accountId`, de documento | Debe payables (`supplierId`) / Haber banco |
| VOID | PORTFOLIO | Debe receivables (`customerId`) / Haber cuenta del cheque. Legado físico: no hay asiento (Deudores ya estaba abierto) → skip con aviso |
| VOID | DELIVERED | Debe cuenta del cheque / Haber payables (`supplierId`). Legado: skip |
| VOID | DEPOSITED | Primero revierte el depósito: `deleteDraftJournalEntryTx` si está en borrador, `reverseJournalEntryTx` si está registrado. Después aplica la regla de PORTFOLIO |

Endoso manual: sin cambio.

- [ ] **Step 1:** Test unitario con un caso por fila de la tabla. Ejemplo: DEPOSIT de un tercero con `accountId:'vad'` y banco `'bco'` por 500 → `lines` = `[{accountId:'bco', debit:500, credit:0}, {accountId:'vad', debit:0, credit:500}]`.
- [ ] **Step 2:** Integración, entrando por las actions reales:
  - Depositar un cheque recibido por RC: asiento Banco / Valores a depositar y `depositEntryId` cargado.
  - Rechazar ese cheque: Cheques rechazados / Banco.
  - Debitar un cheque propio de OP: Valores diferidos / Banco, CASHED, y el saldo bancario baja.
  - Anular un depositado: el borrador del depósito se borra y queda el asiento de anulación.
  - Review Focus 2: cheque creado a mano → depósito OK con aviso y sin asiento.
  - Review Focus 3: mes cerrado (`closeMonthForTest`) → `result.error` legible; sigue en PORTFOLIO y el saldo bancario no cambia.
- [ ] **Step 3:** Correr los dos tests: fallan. Implementar. Correrlos: verdes.
- [ ] **Step 4:** Commit `feat(commercial): asientos de depósito, rechazo, débito y anulación de cheques (TSK-735)`.

### Task 5: Quitar "Cuenta Corriente" de recibos y OP nuevos

**Files:**
- Modify: `src/modules/commercial/features/treasury/shared/validators.ts`:
  - El enum de pago (línea ~379) deja ACCOUNT solo por compatibilidad: `.refine(m => m !== 'ACCOUNT', { message: <literal de Global Constraints> })` en los esquemas de alta y edición de RC y OP.
  - Nueva constante `SELECTABLE_PAYMENT_METHOD_LABELS` = `PAYMENT_METHOD_LABELS` sin ACCOUNT.
- Modify: `_ReceiptPaymentRow.tsx` y `_CreatePaymentOrderModal.tsx` (y el editor de OP si itera `PAYMENT_METHOD_LABELS`) para usar `SELECTABLE_PAYMENT_METHOD_LABELS`. El detalle sigue con `PAYMENT_METHOD_LABELS`.
- Test: el test del validator de tesorería (crear `validators.test.ts` junto al archivo si no existe):
  - `createReceiptSchema.safeParse` con un pago ACCOUNT → error con el literal.
  - Con CASH → ok.
  - Review Focus 5: confirmar un RC en borrador que ya tiene ACCOUNT (insertado con Prisma) → confirma con el aviso de omitido. Ese caso va en el test de integración de RC.

- [ ] **Step 1:** Tests; correrlos: fallan.
- [ ] **Step 2:** Implementar; tests verdes.
- [ ] **Step 3:** Commit `feat(commercial): "Cuenta Corriente" deja de ofrecerse en recibos y OP (TSK-735)`.

### Task 6: Diagnóstico de regularización

**Files:**
- Create: `prisma/scripts/tsk735-diagnostico-medios-sin-cuenta.sql`, solo lectura, con la estructura de `tsk792-diagnostico-trazabilidad.sql`.
  1. Detalle: RC/OP CONFIRMED con pagos CHECK/ECHEQ/CREDIT_CARD/ACCOUNT o con tarjeta de socio. Columnas: empresa, comprobante, fecha, tercero, medio, importe y destino. El destino es:
     - `se regulariza al depositar` (cheque de tercero en PORTFOLIO, físico)
     - `se regulariza al endosar o depositar` (ídem)
     - `se regulariza al debitar` (OWN DELIVERED)
     - `se regulariza al devolver al socio` (cuota de socio PENDING)
     - `e-cheq ya en banco: sin saldo abierto` (ECHEQ recibido con banco)
     - `regularizar a mano` (cheque ya depositado, endosado o cobrado; tarjeta de la empresa; cuota de socio ya PAID)
     - `cuenta corriente: regularizar con NC/ND`
  2. Totales por empresa, tercero y destino.
- [ ] **Step 1:** Correrlo contra la DB de dev: `docker exec -i contable-pms-db psql -U postgres -d contable_pms < prisma/scripts/tsk735-diagnostico-medios-sin-cuenta.sql`. Debe dar filas coherentes (la OP con cheque propio del demo).
- [ ] **Step 2:** Commit `chore(scripts): diagnóstico de pagos sin cuenta para regularizar (TSK-735)`.

### Task 7: Documentación, guía in-app, guía de presentación y verificación

**Files:**
- Modify: `docs/modules/commercial.md` (tesorería: tabla de cuentas por medio, ciclo del cheque, devolución a socio, Cuenta Corriente) y `docs/architecture/data-model.md` (columnas nuevas).
- Modify: `src/modules/help/features/guide/components/_TreasuryGuide.tsx` (cheques: Depositar/Rechazar/Debitar/Anular y qué asiento generan; tarjetas; devolución a socio) y la guía de Contabilidad que documenta Configuración (sección "Cheques y tarjetas").
- Create: `scripts/guia-presentacion/tsk-735.html`, más el PDF y las capturas con `capturas-tsk735.mjs`, molde de `capturas-tsk813.mjs`. Capturas:
  - Configuración → Cheques y tarjetas.
  - Asiento de un RC con cheque.
  - Acción Debitar.
  - Asiento de la devolución a socio.
- [ ] **Step 1:** Docs y guía.
- [ ] **Step 2:** Suite completa `npx vitest run`, `npm run lint` y `npx tsc --noEmit` sin errores nuevos contra el baseline de main.
- [ ] **Step 3:** Capturas en el dev server del puerto 3010 y PDF.
- [ ] **Step 4:** Commit `docs: TSK-735 cuentas de cheques y tarjetas`.
