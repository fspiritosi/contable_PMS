# TSK-793 — Inversiones: brokers y tenencias — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** brokers como cuentas de Tesorería, tenencias de instrumentos atadas a un banco o broker, compra y venta de inversiones como Movimientos de Fondos con asiento y resultado por tenencia, y valuación al cierre del ejercicio.

**Architecture:**
- **Broker.** Es un `BankAccountType` nuevo (`BROKER`): hereda saldo, cuenta contable, transferencias y corrección.
- **Tenencia.** `InvestmentHolding` guarda solo los datos fijos. Su posición (valor en libros y nominales) es la suma de sus `InvestmentMovement` con fecha ≤ D, así que es función de la fecha. Hay tres clases de movimiento:
  - compra: `bookDelta` +;
  - venta: `bookDelta` − costo;
  - valuación: `bookDelta` = valor al cierre − valor en libros al cierre.
- **Compra y venta.** Son dos `FundMovementType` nuevos (`INVESTMENT_PURCHASE`, `INVESTMENT_SALE`):
  - el lado banco/caja usa `fundOut*` / `fundIn*` como siempre;
  - la tenencia va en `FundMovement.holdingId`;
  - los efectos crean y borran el `InvestmentMovement` ligado por `fundMovementId`.
  - Así heredan borrador/confirmación, asiento, anulación y corrección en cadena (TSK-792).
- **Valuación.** `InvestmentValuation` es una por ejercicio. Genera movimientos `VALUATION` y un asiento en borrador con `process: INVESTMENT_VALUATION`.

**Tech Stack:** Next.js 16 (App Router, Server Actions), Prisma 7 + PostgreSQL, React Hook Form + Zod, TanStack Query, shadcn/ui, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-28-tsk-793-inversiones-design.md`. Leerlo antes de cada tarea.

**Rama:** `feat/tsk-793-inversiones`, que sale de `feat/tsk-791-conceptos` (ya incluye el TSK-792).

## Global Constraints

**Reglas del repo (`CLAUDE.md`, `.claude/rules/`)**
- Permisos en 3 niveles: `checkPermission` en cada action, `PermissionGuard` en páginas y `usePermissions` en el client.
- Client components con prefijo `_` y menos de 200 líneas.
- Sin `:any`. Los enums se importan de `@/generated/prisma/enums`.
- `Decimal` → `Number()` antes de mandarlo al client.
- Logger, nunca `console.*`. moment.js para fechas.
- Fecha de negocio = día de Argentina.
  - Las fechas de Movimientos de Fondos usan `parseFundMovementDate` (mediodía UTC) y se leen con `moment.utc`.
- Errores de negocio con `BusinessError`. Las actions devuelven `ActionResult` (`toActionResult`).
- `modules/commercial` usa contabilidad **solo** vía `@/modules/accounting/features/integrations/core`, que exporta `createJournalEntryTx`, `deleteDraftJournalEntryTx`, `rewriteDraftJournalEntryTx`, `assertPeriodOpen` y `findMonthlyProcessEntriesTx`.
- `modules/accounting` no importa de `commercial` salvo `commercial/shared/*`.

**Tests**
- Vitest (`npm run test`). No hay Cypress.
- Los de integración siguen el molde de `src/modules/commercial/features/treasury/features/fund-movements/list/fund-movement-lines.integration.test.ts`:
  - `describe.skipIf(!dbAvailable)`;
  - `vi.mock` de `server-only`, `@/shared/lib/current-user`, `@/shared/lib/company`, `@/shared/lib/permissions` y `next/cache`;
  - limpieza en `afterAll`;
  - prefijo único por archivo `TSK793-<X>-`.

**Base de datos**
- Nunca `prisma migrate reset` ni `db push` sobre la base de dev.
- Migración aditiva con `npx prisma migrate dev --name tsk_793_inversiones --create-only`. Si detecta drift, se genera con shadow DB temporal como en el TSK-791 y TSK-792.

**Línea base**
- `npm run check-types` da **194** errores preexistentes. Ninguna tarea puede subirlo.
- `npm run test` da 1310 tests verdes.

**Valores fijados por el spec**
- Cuentas de resultado sugeridas: 4.1.1/03/02 (positivo) y 4.2.1/05/11 (negativo). Se configuran como ajustes, no se buscan por código.
- Comisión: gasto aparte.
  - Compra: sale del origen bruto + comisión.
  - Venta: entra al destino bruto − comisión.
  - Resultado = bruto − costo.
- Moneda de la tenencia: `'ARS'` fijo.
- Sin posiciones cortas: la posición (valor en libros y nominales) nunca puede quedar negativa en ningún punto de la historia.

**Rulings tomados al planificar (desvíos menores del spec, ya anotados)**
- **P1. Permiso.** El módulo es `commercial.treasury.investments`, siguiendo la nomenclatura de Tesorería, no `commercial.investments`. Cae igual en el prefijo `commercial.*` del mapeo de módulos activables.
- **P2. Conceptos.** Compra y venta de inversión **no usan conceptos**: `fundMovementUsage` devuelve `null`, como en la transferencia. El spec decía "opcional e informativo". Sin cuenta asociada aportaba poco y obligaba a sumar usos nuevos.
- **P3. Venta parcial.** Se implementa la recomendación del spec, aislada en `computeSaleCost`:
  - con nominales, el costo es proporcional;
  - sin nominales, el costo es igual al cobrado bruto y no hay resultado.
- **P4. Ventas posteriores.** Corregir o anular un movimiento de una tenencia que tiene una **venta posterior** es un impedimento MANUAL ("anulá primero la venta posterior"). El costo de una venta queda fijo al confirmarse, y si cambia lo anterior ese costo deja de ser coherente.
- **P5. Asiento de la valuación.** Se genera en **borrador**. Deshacer la valuación lo borra con `deleteDraftJournalEntryTx`. Si ya está Registrado, primero hay que volverlo a borrador (TSK-792).

## Review Focus

1. **Venta retroactiva** con fecha anterior a otra venta ya confirmada que deja la posición negativa en algún punto → se rechaza (Tarea 4, `assertHoldingNeverNegative`).
2. **Comisión de venta ≥ importe bruto** → error claro, nunca un depósito ≤ 0 en el banco (Tarea 3 schema + Tarea 4).
3. **Anular la venta total** que cerró una tenencia → la tenencia vuelve a estar abierta con su valor en libros previo (Tarea 5, test del motor).
4. **Valuar una tenencia con una venta confirmada posterior al cierre** → la valuación entera se rechaza y nombra esa venta (Tarea 8).
5. **Cambiar la cuenta contable de una tenencia con movimientos confirmados** → se rechaza, porque dejaría asientos viejos contra otra cuenta (Tarea 6).

---

### Tarea 1: Modelo de datos y migración

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_tsk_793_inversiones/migration.sql`

**Interfaces — Produces** (nombres exactos que usan todas las tareas):
- `BankAccountType` += `BROKER`.
- `FundMovementType` += `INVESTMENT_PURCHASE`, `INVESTMENT_SALE`.
- `JournalEntryProcess` += `INVESTMENT_VALUATION`.
- `enum InvestmentInstrumentType`: `STOCK`, `CEDEAR`, `BOND`, `OPTION`, `LETTER`, `FUTURE`, `TENDER`, `CORPORATE_BOND`, `MUTUAL_FUND`, `TRUST`, `REPO`, `FIXED_TERM` (mapea, en orden, Acciones, CEDEARs, Bonos, Opciones, Letras, Futuros, Licitaciones, ON, Fondos (FCI), Fideicomisos, Cauciones, Plazo fijo).
- `enum InvestmentHoldingStatus`: `OPEN`, `CLOSED`.
- `enum InvestmentMovementKind`: `PURCHASE`, `SALE`, `VALUATION`.
- `model InvestmentHolding` (`investment_holdings`):
  - `id`, `companyId`, `bankAccountId` (custodia, FK `BankAccount`), `instrumentType`, `name` (String), `maturityDate DateTime? @db.Date`, `accountId` (FK `Account`, obligatoria), `currency String @default("ARS")`, `status InvestmentHoldingStatus @default(OPEN)`, `createdBy`, `createdAt`, `updatedAt`;
  - relaciones `movements InvestmentMovement[]`, `fundMovements FundMovement[]`;
  - `@@index([companyId])`, `@@index([bankAccountId])`.
- `model InvestmentMovement` (`investment_movements`):
  - `id`, `companyId`, `holdingId` (FK, `onDelete: Cascade`), `kind`, `date @db.Date`;
  - `bookDelta Decimal(15,2)` (con signo) y `nominalsDelta Decimal(18,6)?` (con signo);
  - `proceeds Decimal(15,2)?` (bruto cobrado, solo SALE) y `result Decimal(15,2)?` (solo SALE);
  - `closesHolding Boolean @default(false)`;
  - `valuedAmount Decimal(15,2)?` y `unitPrice Decimal(18,6)?` (solo VALUATION);
  - `fundMovementId String? @db.Uuid` (FK `FundMovement`, `onDelete: Cascade`) y `valuationId String? @db.Uuid` (FK `InvestmentValuation`, `onDelete: Cascade`);
  - `createdAt`;
  - `@@index([holdingId, date])`.
- `model InvestmentValuation` (`investment_valuations`):
  - `id`, `companyId`, `fiscalYearId` (FK `FiscalYear`), `closingDate @db.Date`, `journalEntryId String? @db.Uuid`, `journalEntryNumber Int?`, `createdBy`, `createdAt`;
  - `movements InvestmentMovement[]`;
  - `@@unique([companyId, fiscalYearId])`.
- `FundMovement` += `holdingId String? @db.Uuid` (FK `InvestmentHolding`, `onDelete: Restrict`), `nominals Decimal(18,6)?`, `unitPrice Decimal(18,6)?`, `commission Decimal(15,2)?`, `isFullSale Boolean @default(false)`, `investmentMovements InvestmentMovement[]`.
- `AccountingSettings` += `holdingGainAccountId`, `holdingLossAccountId`, `investmentFeesAccountId` (String? uuid, con relación a `Account` como las demás).

- [ ] **Step 1:** Editar `schema.prisma` con lo de arriba. Comentarios en español en el estilo del archivo, con `/// TSK-793` en los modelos.
- [ ] **Step 2:** Generar la migración `--create-only`. Revisar que el SQL sea solo aditivo (`ALTER TYPE … ADD VALUE`, `CREATE TABLE`, `ALTER TABLE … ADD COLUMN`) y aplicarla con `npx prisma migrate dev`.
- [ ] **Step 3:** `npm run db:generate && npm run check-types`.
  - Esperado: errores en los `Record<FundMovementType, …>` exhaustivos (`FUND_MOVEMENT_TYPE_LABELS`, `FUND_USAGE_BY_TYPE`, etc.).
  - Arreglarlos **solo con las etiquetas**: "Compra de inversión" / "Venta de inversión", y `null` en `FUND_USAGE_BY_TYPE` (ruling P2).
  - El `never` de `applySidesAndBuildEntryLinesTx` se cubre con una rama `INVESTMENT_PURCHASE | INVESTMENT_SALE` que lanza `BusinessError('Tipo de movimiento no soportado todavía')`. La Tarea 4 la reemplaza.
  - Agregar `BROKER` donde un `Record<BankAccountType,…>` lo exija.
  - Resultado esperado: 194.
- [ ] **Step 4:** Commit `feat(treasury): modelo de tenencias, valuaciones e inversiones en movimientos de fondos (TSK-793)`.

### Tarea 2: Broker como tipo de cuenta y ajustes contables de inversiones

**Files:**
- Modify: `src/modules/commercial/features/treasury/shared/validators.ts` (`NON_BANK_TYPES` y el `z.enum` de `accountType`, `:119` y `:133`) y su test `validators.test.ts`.
- Modify: el form `bank-accounts/list/components/_BankAccountFormModal.tsx` y donde estén las etiquetas de tipo de cuenta (buscar `VIRTUAL_WALLET` en `src/`).
- Modify: `src/shared/components/layout/_AppSidebar.tsx:228`, `src/shared/lib/permissions/constants.ts` (`MODULE_LABELS['commercial.treasury.bank-accounts']`), y metadata y título de `src/app/(core)/dashboard/commercial/treasury/bank-accounts/page.tsx`.
- Modify: `src/modules/accounting/features/settings/validators.ts`, `AccountingSettings.tsx`, `components/_CommercialIntegrationForm.tsx`, `src/shared/lib/accounts/settings-account-labels.ts` y el action `saveAccountingSettings`, si lista campos.

**Interfaces — Produces:** los ajustes `holdingGainAccountId`, `holdingLossAccountId` y `investmentFeesAccountId` se pueden editar desde Ajustes contables.

**Valores exactos:**
- Etiqueta del tipo: `BROKER: 'Broker'`.
- Título "Cuentas Bancarias y Brokers" (sidebar, `MODULE_LABELS` y página).
- Etiquetas de los ajustes:
  - `holdingGainAccountId: 'Resultado por tenencia positivo (inversiones)'`;
  - `holdingLossAccountId: 'Resultado por tenencia negativo (inversiones)'`;
  - `investmentFeesAccountId: 'Comisiones de inversiones'`.

- [ ] **Step 1 (test):** en `validators.test.ts`, `bankAccountSchema` acepta `{ accountType: 'BROKER', bankName: 'Balanz', accountNumber: '123' }` sin CBU ni alias. En el test de settings, el schema acepta los tres ids nuevos como uuid o null.
- [ ] **Step 2:** correr y ver el FAIL.
- [ ] **Step 3:** implementar. En el form de ajustes, los tres campos van en la sección de tesorería, junto a "Gastos bancarios por defecto".
- [ ] **Step 4:** `npx vitest run src/modules/commercial/features/treasury/shared/validators.test.ts src/modules/accounting/features/settings/validators.test.ts` → PASS. check-types en 194.
- [ ] **Step 5:** Commit `feat(treasury): brokers como tipo de cuenta y cuentas contables de inversiones en ajustes (TSK-793)`.

### Tarea 3: Posición de la tenencia, política de venta y schema del movimiento

**Files:**
- Create: `src/modules/commercial/features/treasury/features/investments/shared/position.ts` (puro) y `position.test.ts`.
- Create: `src/modules/commercial/features/treasury/features/investments/shared/types.ts` con las etiquetas y atributos de los tipos de instrumento.
- Modify: `src/modules/commercial/features/treasury/features/fund-movements/shared/validators.ts` y `validators.test.ts`.

**Interfaces — Produces:**
- `INSTRUMENT_TYPE_LABELS: Record<InvestmentInstrumentType, string>`.
- `INSTRUMENT_TYPE_TRAITS: Record<InvestmentInstrumentType, { hasUnits: boolean; hasMaturity: boolean }>`, con la tabla del spec. Con unidades: STOCK, CEDEAR, BOND, OPTION, LETTER, FUTURE, TENDER, CORPORATE_BOND. Con vencimiento: BOND, OPTION, LETTER, FUTURE, TENDER, CORPORATE_BOND, REPO, FIXED_TERM.
- `interface PositionMovement { kind: InvestmentMovementKind; date: Date; bookDelta: number; nominalsDelta: number | null; createdAt: Date }`.
- `positionAt(movements: PositionMovement[], asOf?: Date): { bookValue: number; nominals: number | null }`:
  - suma los movimientos con fecha ≤ `asOf` (todos si no viene);
  - `nominals` es `null` si ningún movimiento tiene `nominalsDelta`;
  - redondea a 2 y 6 decimales.
- `firstNegativePoint(movements: PositionMovement[]): PositionMovement | null`:
  - ordena por fecha; a igual fecha, primero PURCHASE, después SALE, después VALUATION, y a igual clase por `createdAt`;
  - devuelve el primer movimiento tras el cual el valor en libros es < 0 o los nominales son < 0.
- `computeSaleCost(input: { bookValue: number; nominals: number | null; soldNominals: number | null; proceeds: number; isFullSale: boolean }): { cost: number; nominalsDelta: number | null; result: number; closesHolding: boolean }` aplica el ruling P3, en este orden:
  - `isFullSale`: cost = bookValue; nominalsDelta = −nominals; result = proceeds − bookValue; closesHolding = true.
  - Con `soldNominals` y `nominals > 0`:
    - `soldNominals > nominals` → `BusinessError('No podés vender más nominales de los que tiene la tenencia')`;
    - `soldNominals === nominals` se trata como venta total;
    - si no: cost = round2(bookValue × soldNominals / nominals); nominalsDelta = −soldNominals; result = proceeds − cost.
  - Sin nominales vendidos:
    - `proceeds > bookValue` → `BusinessError('El importe supera el valor en libros de la tenencia. Si vendés todo, marcá "Venta total".')`;
    - si no: cost = proceeds; result = 0; closesHolding = false.
- `fundMovementSchema` += `holdingId` (uuid opcional o ''), `nominals`, `unitPrice` y `commission` (strings opcionales con el formato de `amount`; nominals y precio hasta 6 decimales), `isFullSale` (boolean opcional). El `superRefine` agrega estas reglas:
  - `INVESTMENT_PURCHASE`:
    - `sourceFund` válido, si no: "Seleccioná el banco, broker o caja de donde sale la plata";
    - `holdingId` requerido: "Seleccioná la tenencia";
    - si vienen `nominals` y `unitPrice`, `amount` debe ser igual a round2(nominals × unitPrice): "El importe no coincide con nominales × precio".
  - `INVESTMENT_SALE`:
    - `destinationFund` válido: "Seleccioná el banco, broker o caja donde entra la plata";
    - `holdingId` requerido;
    - `commission`, si viene, debe ser < `amount`: "La comisión no puede ser mayor o igual al importe".
  - En los dos tipos, `commission`, si viene, ≥ 0.

- [ ] **Step 1 (tests):**
  - `position.test.ts`:
    - compra 1000 (100 nominales) + venta parcial de 40 nominales cobrando 500 → `computeSaleCost` da cost 400, result 100;
    - `positionAt` después de esa venta da `{ bookValue: 600, nominals: 60 }`;
    - venta total cobrando 900 sobre libros 1000 → result −100, closesHolding true;
    - sin nominales, cobrar 1200 sobre 1000 sin venta total → lanza el BusinessError exacto;
    - `firstNegativePoint` de [compra 1000 el 10/3, venta parcial costo 800 el 5/3] devuelve la venta del 5/3;
    - `positionAt(asOf = 31/12)` ignora una compra del 2/1 siguiente;
    - una VALUATION el 31/12 se suma después de una SALE del mismo día.
  - `validators.test.ts`: un caso por cada mensaje nuevo, y un caso válido de compra y otro de venta.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** implementar.
- [ ] **Step 4:** `npx vitest run src/modules/commercial/features/treasury/features/investments src/modules/commercial/features/treasury/features/fund-movements/shared` → PASS.
- [ ] **Step 5:** Commit `feat(treasury): posición de la tenencia y política de venta (TSK-793)`.

### Tarea 4: Efectos de la compra y la venta de inversión

**Files:**
- Create: `src/modules/commercial/shared/effects/investment.server.ts`.
- Modify: `src/modules/commercial/shared/effects/fund-movement.server.ts`: `fundMovementSides` (`:65`), la rama exhaustiva de `applySidesAndBuildEntryLinesTx` (`:526`), `applyFundMovementEffectsTx` (sumar los 3 ajustes nuevos al `select`) y `revertFundMovementEffectsTx` (`:798`).
- Modify: `src/modules/commercial/shared/effects/fund-movement-data.server.ts` (`resolveFundMovementDataTx`).
- Test: `src/modules/commercial/features/treasury/features/investments/investment-fund-movements.integration.test.ts` (prefijo `TSK793-FM-`).

**Interfaces:**
- Consumes: `positionAt`, `firstNegativePoint` y `computeSaleCost` (Tarea 3); los enums y columnas de la Tarea 1.
- Produces, en `investment.server.ts`:
  - `loadHoldingMovementsTx(tx: Tx, holdingId: string): Promise<PositionMovement[]>`;
  - `assertHoldingNeverNegativeTx(tx: Tx, holdingId: string): Promise<void>` → `BusinessError('La operación deja la tenencia «<name>» con saldo negativo al <DD/MM/YYYY>')`;
  - `assertHoldingNotValuedTx(tx: Tx, holdingId: string, date: Date): Promise<void>` → si hay un movimiento VALUATION de esa tenencia con fecha ≥ `date`: `BusinessError('La tenencia «<name>» ya tiene valuación al cierre del <DD/MM/YYYY>. Deshacé esa valuación para registrar movimientos anteriores.')`;
  - `applyInvestmentSideTx(tx, ctx: EffectsCtx, movement: { id; type; date; amount; holdingId; nominals; commission; isFullSale }): Promise<{ holdingAccountId: string; cost: number; result: number }>`, que crea el `InvestmentMovement`.

**Comportamiento:**
- `fundMovementSides`:
  - `INVESTMENT_PURCHASE` usa solo `out`;
  - `INVESTMENT_SALE` usa solo `in`, así que `usesOut` lo excluye.
- La tenencia tiene que ser de la empresa y estar `OPEN`. Si no: "La tenencia seleccionada no es válida o está cerrada".
- Se valida antes de mover saldos: `assertHoldingNotValuedTx(holdingId, movement.date)`.
- Ajustes faltantes:
  - comisión > 0 sin `investmentFeesAccountId` → "Configurá la cuenta de comisiones de inversiones en Ajustes contables";
  - resultado > 0 sin `holdingGainAccountId` (o < 0 sin `holdingLossAccountId`) → el mensaje equivalente con la etiqueta del ajuste.
- **Compra.**
  - `applyFundSide(out)` mueve bruto + comisión.
  - Se crea `InvestmentMovement{kind: PURCHASE, bookDelta: +bruto, nominalsDelta: +nominals | null}`.
  - Líneas: Debe cuenta de la tenencia (bruto); Debe comisiones (comisión, si > 0); Haber banco/caja (bruto + comisión).
- **Venta.**
  - `computeSaleCost` corre con la posición a la fecha de la venta.
  - `applyFundSide(in)` mueve bruto − comisión.
  - Se crea `InvestmentMovement{kind: SALE, bookDelta: −cost, nominalsDelta, proceeds: bruto, result, closesHolding}`. Si `closesHolding`, la tenencia pasa a `CLOSED`.
  - Líneas: Debe banco/caja (neto); Debe comisiones; Haber tenencia (cost); resultado > 0 → Haber ganancia; < 0 → Debe pérdida.
- Después de crear el movimiento: `assertHoldingNeverNegativeTx`.
- `revert`:
  - borra los `InvestmentMovement` con ese `fundMovementId`;
  - si alguno tenía `closesHolding`, la tenencia vuelve a `OPEN`;
  - después corre lo de banco y caja que ya existía. El monto del `BankMovement` ya es el neto o el total, así que se revierte bien.
- `resolveFundMovementDataTx` guarda `holdingId`, `nominals`, `unitPrice`, `commission` e `isFullSale` solo en los dos tipos nuevos (`null`/`false` en el resto). Valida que la tenencia sea de la empresa (abierta o no; el estado se valida al confirmar).

- [ ] **Step 1 (tests de integración), con banco con saldo y cuentas configuradas:**
  - (a) Compra de 100 nominales × 10 con comisión 5 → saldo del banco −1005; asiento con Debe tenencia 1000 + Debe comisiones 5 / Haber banco 1005; posición `{1000, 100}`.
  - (b) Venta parcial de 40 nominales cobrando 500 con comisión 2 → banco +498; asiento con Haber tenencia 400, Haber ganancia 100, Debe comisiones 2, Debe banco 498.
  - (c) Venta total cobrando 500 de lo restante (libros 600) → Debe pérdida 100; tenencia `CLOSED`.
  - (d) Venta con fecha anterior a la compra → BusinessError de saldo negativo, y saldo del banco sin cambios.
  - (e) Compra con comisión sin cuenta de comisiones configurada → mensaje exacto.
  - (f) Compra con fecha ≤ una valuación existente (insertada a mano en el test) → mensaje exacto de `assertHoldingNotValuedTx`.
  - (g) Venta con comisión ≥ importe → la rechaza el schema.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** implementar.
- [ ] **Step 4:** `npx vitest run src/modules/commercial/features/treasury/features/investments src/modules/commercial/features/treasury/features/fund-movements` → PASS, incluidos los tests viejos de movimientos de fondos.
- [ ] **Step 5:** Commit `feat(treasury): compra y venta de inversiones con asiento y resultado por tenencia (TSK-793)`.

### Tarea 5: Corrección en cadena de compras y ventas de inversión

**Files:**
- Modify: `src/modules/commercial/shared/correction/impediments.ts` y `types.ts` (`ImpedimentCode`).
- Modify: `src/modules/commercial/shared/effects/fund-movement.server.ts` (`fundMovementEffectImpedimentsTx`).
- Modify: `src/modules/commercial/shared/correction/snapshot.server.ts` (`addFundMovement`, `:951`).
- Test: agregar un `describe` en `src/modules/commercial/features/treasury/features/investments/investment-correction.integration.test.ts` (prefijo `TSK793-CO-`), con `previewDocumentCorrection`/`applyDocumentCorrection` como en `engine.integration.test.ts`. Lleva `vi.setConfig({ testTimeout: 30_000 })`.

**Interfaces — Produces:**
- `impediments.investmentLaterSale(holdingName: string, saleLabel: string)` → `{ code: 'INVESTMENT_LATER_SALE', severity: 'MANUAL', message: 'La tenencia «<holdingName>» tiene una venta posterior (<saleLabel>).', action: 'Anulá primero esa venta, corregí este movimiento y volvé a cargarla.' }`.
- `impediments.investmentValued(holdingName: string, closingDate: string)` → `{ code: 'INVESTMENT_VALUED', severity: 'MANUAL', message: 'La tenencia «<holdingName>» ya tiene valuación al cierre del <closingDate>.', action: 'Deshacé esa valuación desde Tesorería › Inversiones › Valuación y reintentá.', href: '/dashboard/commercial/treasury/investments/valuation' }`.

**Comportamiento:**
- `fundMovementEffectImpedimentsTx`, si el MF tiene `holdingId` y está confirmado:
  - `INVESTMENT_VALUED` si hay una VALUATION de la tenencia con fecha ≥ la del MF;
  - `INVESTMENT_LATER_SALE` si hay otro `InvestmentMovement` SALE de la tenencia con fecha > la del MF (o la misma fecha y `createdAt` posterior), excluido el propio (ruling P4).
- Foto de la propuesta: si el MF tiene tenencia, `addFundMovement` agrega una tarjeta `INVESTMENT_HOLDING:<id>` titulada "Tenencia <name>". Campos: `Valor en libros` (`money`), `Nominales` (o "—") y `Estado` (Abierta/Cerrada). Así la propuesta muestra el cambio de la tenencia. Los campos del MF suman `Tenencia`, `Nominales`, `Comisión` y `Venta total` (Sí/No).

- [ ] **Step 1 (tests):**
  - (a) Editar el importe de una compra confirmada sin ventas posteriores → aplica; la posición refleja el nuevo importe; la propuesta tiene la tarjeta de la tenencia con antes/después del valor en libros.
  - (b) Anular la venta total de (Tarea 4 c) → tenencia `OPEN`, posición `{600, 60}`.
  - (c) Editar la compra de una tenencia con venta posterior → impedimento `INVESTMENT_LATER_SALE`, sin aplicar.
  - (d) Anular una compra con una VALUATION posterior → `INVESTMENT_VALUED`.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** implementar.
- [ ] **Step 4:** `npx vitest run src/modules/commercial/features/treasury/features/investments src/modules/commercial/shared/correction` → PASS.
- [ ] **Step 5:** Commit `feat(treasury): corrección en cadena de compras y ventas de inversión (TSK-793)`.

### Tarea 6: Tenencias — permisos, actions, listado, detalle y alta

**Files:**
- Modify: `src/shared/lib/permissions/constants.ts`: `MODULES`, `MODULE_LABELS` ('Inversiones') y `MODULE_GROUPS`, con `'commercial.treasury.investments'` después de `fund-movements`.
- Modify: `src/shared/components/layout/_AppSidebar.tsx`: ítem "Inversiones" → `/dashboard/commercial/treasury/investments`, después de "Movimientos de Fondos".
- Create: `prisma/scripts/tsk793-otorgar-permiso-inversiones.sql`, copia del script del TSK-791 con módulo `commercial.treasury.investments` y acciones `view`, `create`, `update`, `delete` y `approve` (verificación con 5).
- Create: `src/modules/commercial/features/treasury/features/investments/`:
  - `index.ts`;
  - `list/` (`InvestmentsList.tsx`, `actions.server.ts`, `columns.tsx`, `components/_InvestmentsTable.tsx`, `components/_HoldingFormModal.tsx`);
  - `detail/` (`InvestmentHoldingDetail.tsx`, `components/_HoldingMovementsTable.tsx`).
- Create: `src/app/(core)/dashboard/commercial/treasury/investments/page.tsx` y `[id]/page.tsx` (delgadas).
- Modify: el detalle de cuenta bancaria (`bank-accounts/detail/BankAccountDetail.tsx`) suma una sección "Tenencias" con las de esa cuenta, que reusa la tabla de tenencias.
- Test: `src/modules/commercial/features/treasury/features/investments/list/holdings.integration.test.ts` (prefijo `TSK793-HO-`).

**Interfaces — Produces** (en `list/actions.server.ts`, `'use server'`):
- `getInvestmentHoldings(filters?: { bankAccountId?: string; status?: InvestmentHoldingStatus })`. Devuelve filas con `{ id, name, instrumentType, bankAccountId, bankAccountLabel, maturityDate, status, account: {code,name}, bookValue: number, nominals: number | null, averagePrice: number | null }`, con la posición actual de `positionAt` y `averagePrice = bookValue / nominals`.
- `getInvestmentHoldingById(id)` → la fila + `movements` (fecha, clase, importe con signo, nominales, resultado, link al MF o a la valuación).
- `createInvestmentHolding(input: HoldingFormInput): Promise<ActionResult<{ id: string }>>`.
- `updateInvestmentHolding(id, input)`.
- `deleteInvestmentHolding(id)`.
- `holdingFormSchema` en `investments/shared/validators.ts`: `bankAccountId` (uuid), `instrumentType`, `name` (2–100), `maturityDate` (`YYYY-MM-DD` opcional; solo se admite si el tipo tiene vencimiento) y `accountId` (uuid).

**Reglas:**
- La cuenta de custodia es de la empresa y está activa.
- La cuenta contable es imputable y de tipo `ASSET`. Usar `buildImputableAccountsWhere`, como hace `fund-movement.server.ts`.
- `update` no puede cambiar `accountId` ni `bankAccountId` si la tenencia tiene `InvestmentMovement`s: "La tenencia ya tiene movimientos: no se puede cambiar su cuenta".
- `delete` solo funciona sin movimientos ni MF que la referencien: "La tenencia tiene movimientos y no se puede eliminar".
- Permisos: `view` / `create` / `update` / `delete` sobre `commercial.treasury.investments`.

- [ ] **Step 1 (tests):** crear tenencia válida; rechazo de una cuenta que no es de activo; rechazo del cambio de cuenta con movimientos (Review Focus 5); rechazo del borrado con movimientos; `getInvestmentHoldings` devuelve `bookValue` y `averagePrice` correctos después de una compra confirmada.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** implementar actions y UI siguiendo `fund-movements/list`. La tabla se agrupa o filtra por cuenta; badge de estado; el botón "Nueva tenencia" va con `PermissionGuard`.
- [ ] **Step 4:** tests PASS; check-types en 194; `npm run lint` sin errores nuevos en los archivos tocados.
- [ ] **Step 5:** Commit `feat(treasury): tenencias de inversiones con listado, detalle y alta (TSK-793)`.

### Tarea 7: Compra y venta en el formulario de Movimientos de Fondos

**Files:**
- Modify: `fund-movements/list/actions.server.ts` (`getFundMovementCatalogs`, `:115`) para sumar `holdings` abiertas con `{ id, label: '<name> · <custodia>', hasUnits, bookValue, nominals }`.
- Modify: `fund-movements/list/hooks/useFundMovementForm.ts`, `components/_CreateFundMovementModal.tsx` y `components/_FundMovementTypeField.tsx`.
- Create: `fund-movements/list/components/_FundMovementInvestmentSection.tsx`, de menos de 200 líneas. Si el bloque crece, separar `_InvestmentAmountFields.tsx`.
- Modify: `fund-movements/shared/view-mode.ts` y `columns.tsx`, para mostrar tenencia, nominales y comisión en la vista del movimiento.

**Comportamiento:**
- Con "Compra de inversión":
  - origen banco/broker/caja (el `_FundSelectField` existente);
  - tenencia;
  - nominales y precio, si `hasUnits` (el importe se calcula y queda solo lectura) o importe directo;
  - comisión opcional.
- Con "Venta de inversión":
  - tenencia, con su valor en libros y nominales actuales como ayuda;
  - destino;
  - nominales vendidos (si `hasUnits`), importe cobrado bruto, comisión y casilla "Venta total (cierra la tenencia)".
- Los dos tipos ocultan socio y concepto.
- El permiso de la action sigue siendo el de movimientos de fondos. Para elegir tenencias no hace falta el de inversiones, porque el catálogo lo lee el action de movimientos.

- [ ] **Step 1 (test):** en `view-mode.test.ts`, la vista de una compra de inversión incluye "Tenencia", "Nominales" y "Comisión"; la de un aporte de socio no.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** implementar.
- [ ] **Step 4:** PASS. Verificación en el navegador (puerto 3010, ver memoria `dev-local-capturas-y-login`):
  - crear una compra con nominales y confirmarla;
  - el saldo del banco y la tenencia se actualizan.
- [ ] **Step 5:** Commit `feat(treasury): compra y venta de inversiones en el formulario de movimientos de fondos (TSK-793)`.

### Tarea 8: Valuación al cierre — lógica de servidor

**Files:**
- Create: `src/modules/commercial/features/treasury/features/investments/valuation/actions.server.ts`.
- Create: `src/modules/commercial/features/treasury/features/investments/valuation/valuation.server.ts`, con la lógica `…Tx` fuera del archivo `'use server'` (lección R7 del TSK-792).
- Create: `investments/valuation/validators.ts` y `.test.ts`.
- Test: `src/modules/commercial/features/treasury/features/investments/valuation/valuation.integration.test.ts` (prefijo `TSK793-VAL-`).

**Interfaces — Produces:**
- `getValuationCandidates(fiscalYearId: string)` → `{ fiscalYear: { id, number, endDate, isClosed }, existing: { id, journalEntryNumber, createdAt } | null, holdings: { id, name, instrumentType, custody, accountCode, bookValue, nominals, laterSales: string[] }[] }`.
  - Incluye las tenencias con posición ≠ 0 a `endDate`.
  - `laterSales` son las etiquetas de los MF de venta confirmados con fecha > `endDate`.
  - Permiso `view`.
- `valuationSchema`: `{ fiscalYearId: uuid, lines: { holdingId: uuid, valuedAmount?: string, unitPrice?: string }[] }`. Cada línea exige exactamente uno de los dos: "Cargá el valor al cierre o el precio por nominal".
- `generateInvestmentValuation(input): Promise<ActionResult<{ id: string; journalEntryNumber: number | null }>>`, con permiso `approve`.
- `undoInvestmentValuation(valuationId: string): Promise<ActionResult<void>>`, con permiso `approve`.
- `generateInvestmentValuationTx(tx, ctx, input)` y `undoInvestmentValuationTx(tx, ctx, valuationId)` en `valuation.server.ts`.

**Reglas de `generate`:**
- Validaciones, en orden:
  - el ejercicio es de la empresa y no está cerrado: "El ejercicio ya está cerrado: no se puede valuar";
  - no hay otra valuación para ese ejercicio: "Ya hay una valuación para este ejercicio. Deshacela para volver a generarla";
  - todas las tenencias candidatas tienen línea: "Faltan valores para: <nombres>";
  - ninguna tenencia tiene `laterSales`: "No se puede valuar: <tenencia> tiene ventas posteriores al cierre (<etiquetas>). Anulalas, valuá y volvé a cargarlas.";
  - `unitPrice` solo se admite en tenencias con nominales > 0.
- Por cada línea:
  - valor = `valuedAmount` o round2(nominals × unitPrice);
  - diferencia = valor − bookValue a `endDate`;
  - se crea `InvestmentMovement{kind: VALUATION, date: endDate, bookDelta: diferencia, valuedAmount, unitPrice, valuationId}`, aunque la diferencia sea 0.
- Asiento:
  - en `DRAFT` (ruling P5), fecha `endDate`, descripción `Valuación de inversiones al <DD/MM/YYYY>`, `process: 'INVESTMENT_VALUATION'`, `source: 'investment-valuation:<id>'`;
  - por tenencia con diferencia > 0: Debe cuenta de la tenencia / Haber `holdingGainAccountId`;
  - con diferencia < 0: Debe `holdingLossAccountId` / Haber cuenta de la tenencia;
  - sin diferencias ≠ 0 no hay asiento (`journalEntryId` null);
  - faltan las cuentas de resultado necesarias → mensaje con la etiqueta del ajuste.

**Reglas de `undo`:**
- el ejercicio no está cerrado;
- el asiento, si existe, está en `DRAFT`: "El asiento N° <n> está Registrado. Volvelo a borrador desde Contabilidad › Asientos";
- ninguna tenencia valuada tiene ventas confirmadas posteriores al cierre (mismo mensaje que en `generate`);
- borra el asiento con `deleteDraftJournalEntryTx` y después la valuación, cuyos movimientos caen en cascada.

- [ ] **Step 1 (tests):**
  - (a) Tenencia con libros 1000 valuada en 1200 → asiento Debe tenencia 200 / Haber ganancia 200; posición al día siguiente 1200.
  - (b) Con nominales 100 y `unitPrice` 9 → valor 900 y asiento con pérdida 100.
  - (c) Venta confirmada posterior al cierre → rechazo con el mensaje exacto (Review Focus 4).
  - (d) Segunda valuación del mismo ejercicio → rechazo.
  - (e) `undo` → asiento borrado y posición de vuelta a 1000.
  - (f) `undo` con el asiento POSTED → rechazo.
  - (g) Una compra con fecha posterior al cierre no impide valuar ni entra en el valor en libros al cierre.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** implementar.
- [ ] **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat(treasury): valuación de inversiones al cierre con resultado por tenencia (TSK-793)`.

### Tarea 9: Valuación al cierre — pantalla

**Files:**
- Create: `investments/valuation/InvestmentValuation.tsx` (server, con `PermissionGuard` `view`), `components/_ValuationForm.tsx`, `components/_ValuationEntryPreview.tsx` y `components/_UndoValuationButton.tsx`.
- Create: `src/app/(core)/dashboard/commercial/treasury/investments/valuation/page.tsx`.
- Modify: `InvestmentsList.tsx`, para sumar un botón "Valuación al cierre" visible con `approve`.

**Comportamiento:**
- Selector de ejercicio, con los no cerrados primero.
- Tabla de candidatas con valor en libros, nominales, input (valor o precio por nominal, según tenga nominales), valor resultante y diferencia con color.
- Las tenencias con `laterSales` se muestran con alerta y bloquean el botón.
- Vista previa del asiento: totales de ganancia y pérdida y líneas.
- "Generar valuación" pide confirmación con `AlertDialog`.
- Si el ejercicio ya tiene valuación: se muestra el resumen y el botón "Deshacer" (con `AlertDialog`).
- Formulario con RHF + Zod (`valuationSchema`) y useQuery/useMutation. Nada de `useEffect` para cargar datos.

- [ ] **Step 1:** implementar.
- [ ] **Step 2:** check-types en 194; lint sin errores nuevos.
- [ ] **Step 3:** verificación en el navegador:
  - valuar una tenencia de prueba;
  - ver el asiento en Contabilidad › Asientos;
  - deshacer.
- [ ] **Step 4:** Commit `feat(treasury): pantalla de valuación de inversiones al cierre (TSK-793)`.

### Tarea 10: Documentación, guía de usuario y guía de presentación

**Files:**
- Modify/Create: `docs/modules/` (tesorería, o un `investments.md` nuevo) y `docs/architecture/data-model.md` (modelos nuevos).
- Modify: `src/modules/help/features/guide/components/`, la guía de Tesorería. Agregar las secciones Brokers, Tenencias, Compra/Venta de inversión y Valuación al cierre.
- Create: `scripts/guia-presentacion/` con la guía del TSK-793 en el formato de las del 791/792, con capturas en `scripts/guia-presentacion/assets/tsk793-*.png` (ver memoria `guia-presentacion-cliente-por-ticket`).
- Modify: el spec, para anotar los rulings P1 y P2 en "Decisiones mías".

- [ ] **Step 1:** escribir los documentos.
- [ ] **Step 2:** capturas con Playwright (puerto 3010): listado de tenencias, compra con nominales, propuesta de anulación de venta, valuación con vista previa.
- [ ] **Step 3:** Commit `docs(treasury): inversiones en docs, guía de usuario y guía de presentación (TSK-793)`.
