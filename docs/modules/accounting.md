# Modulo Contabilidad

**Rutas:** `/dashboard/company/accounting/*`
**Archivos:** `src/modules/accounting/`

---

## Plan de Cuentas

**Ruta:** `/company/accounting/accounts`
**Archivos:** `features/accounts/`

Estructura jerarquica (arbol) donde cada cuenta puede tener cuentas hijas (`parentId` self-referential).

### Tipos de Cuenta

| Tipo | Naturaleza | Descripcion |
|------|-----------|-------------|
| ASSET | DEBIT | Activo |
| LIABILITY | CREDIT | Pasivo |
| EQUITY | CREDIT | Patrimonio Neto |
| REVENUE | CREDIT | Ingresos |
| EXPENSE | DEBIT | Egresos |

### Reglas

- Codigo unico por empresa
- Naturaleza debe coincidir con el tipo (fija, no configurable)
- No se puede eliminar si tiene sub-cuentas o lineas de asiento
- Eliminacion soft (isActive = false)

---

## Asientos Contables

**Ruta:** `/company/accounting/entries`
**Archivos:** `features/entries/`

### Ciclo de Vida

```
DRAFT ──(post)──> POSTED ──(reverse)──> REVERSED
  └──(deleteDraftJournalEntry: solo borradores manuales, TSK-760)──> (borrado)
```

### Reglas de Validacion

1. Minimo 2 lineas
2. Debe = Haber (tolerancia ±0.01)
3. Cada linea tiene Debe XOR Haber (no ambos, no ninguno)
4. Montos positivos
5. Fecha en un mes abierto de un ejercicio abierto (`assertPeriodOpen`, ver [Nucleo de asientos](#nucleo-de-asientos-tsk-760))
6. Cuentas deben existir, ser imputables (hoja) y pertenecer a la empresa (`assertAccountsUsableTx`)
7. El balance se valida tambien en DRAFT (desde TSK-760, C5)

### Asientos Automaticos

Se generan al confirmar documentos comerciales (ver [Modulo Comercial](commercial.md#integracion-contable)):
- Facturas de venta/compra (incluyen una linea por percepcion y otra por impuestos internos, TSK-644;
  la cuenta de cada linea es la del item o la "por defecto" de configuracion, y si falta la
  confirmacion se bloquea, TSK-721 — ver [Resolucion de la cuenta de linea](#resolucion-de-la-cuenta-de-linea-tsk-721))
- Recibos de cobro, ordenes de pago y gastos (desde TSK-728 la confirmacion se bloquea si falta
  una cuenta; los medios de pago sin cuenta se omiten con aviso — ver
  [Asientos de recibos, OP y gastos](#asientos-de-recibos-op-y-gastos-tsk-728))

Y desde el modulo Equipos (ver [Integracion Contable de Equipamiento](equipment.md#integracion-contable)):
- Amortizacion mensual (`equipment/features/depreciation/actions.server.ts`, individual y masiva)
- Ajuste de valor (`createValueAdjustment`)
- Baja por venta / perdida total / devolucion (`features/integrations/equipment/index.ts`,
  `createJournalEntryForAssetSale` / `createJournalEntryForAssetDisposal`; las cuentas las resuelve el
  llamador y llegan como `AssetDisposalAccounts`)

**No existe asiento de alta / capitalizacion de equipos**: el bien entra a Bienes de Uso por la factura
de compra (cuenta ASSET del item). `getEquipmentAccountingSettings` y el `payablesAccountId` que se
guardaba para eso se eliminaron en TSK-724c.

Creados como `isAutomatic = true`, `createdBy = 'system'`.

### Reversion (anular)

`reverseJournalEntry({ entryId })` (permiso `accounting.entries` `approve`, `ActionResult`):

1. Si el asiento pertenece a un documento (`getEntryDocumentLink`: factura de venta o compra, recibo,
   OP, egreso, movimiento de fondos, depreciacion, revaluo, refundicion o apertura de ejercicio) se
   rechaza con "Este asiento pertenece a … y no se puede anular desde Asientos: anulá el
   comprobante." El dialogo lo consulta antes (`getReversalCheck`) y deshabilita el boton.
2. Los asientos `createdBy = 'system'` sin vinculo persistido (bancos, transferencias, baja de
   equipo, IVA, inflacion) se anulan con aviso: no revierte el saldo bancario ni el estado del
   equipo.
3. `reverseJournalEntryTx` crea la reversion con **fecha de hoy en Argentina**
   (`todayBusinessDayUtc()`), valida el periodo del original **y** el de hoy, copia todas las
   columnas de linea invertidas (auxiliares, centro de costo, moneda, `originalAmount`,
   `exchangeRate`) y pasa el original a REVERSED con `reversalEntryId` en un solo `UPDATE`
   (trigger de inmutabilidad).

`deleteDraftJournalEntry(entryId)` (permiso `accounting.entries` `delete`): borra un DRAFT manual de
la empresa activa sin documento y no `'system'`. No valida periodo: su fin es destrabar el cierre
de un mes con un borrador imposible de registrar. El numero queda como hueco.

### Numeracion

Secuencial por empresa, gestionada por `AccountingSettings.lastEntryNumber`. Solo la asigna
`nextEntryNumberTx` (`UPDATE … SET last_entry_number = last_entry_number + 1 RETURNING`, que ademas
saltea numeros ya ocupados). `@@unique([companyId, number])` es la red final.

### Nucleo de asientos (TSK-760)

Todo asiento, de cualquier origen (manual, comprobantes, tesoreria, equipos, recurrentes, saldos
de apertura, IVA, diferencia de cambio, inflacion, cierre anual), se crea con
`createJournalEntryTx`. No hay otro `journalEntry.create` en `src/modules` (convencion:
[docs/conventions/coding-standards.md](../conventions/coding-standards.md#asientos-contables-createjournalentrytx)).

Archivos en `src/modules/accounting/shared/utils/` (los `server-only` se reexportan para
`commercial/` y `equipment/` por `features/integrations/core/index.ts`):

| Archivo | Funciones | Notas |
|---|---|---|
| `period-lock.ts` (`server-only`) | `lockAccountingSettingsTx`, `assertPeriodOpen`, `ensureFiscalYearTx`, `createFiscalYearWithPeriodsTx`, `ensurePeriodsTx`, `listMonthlyPeriodsTx`, `syncLockedUntilDateTx` | Una sola definicion de periodo cerrado |
| `journal-entry-tx.ts` (`server-only`) | `nextEntryNumberTx`, `createJournalEntryTx`, `postJournalEntryTx`, `reverseJournalEntryTx`, `assertAccountsUsableTx` | Sin `checkPermission` ni `$transaction` propios: reciben el `tx` del llamador |
| `journal-entry-lines.ts` (puro) | `validateEntryLines`, `invertLines` | Decimal; sin lineas 0/0, balance ±0,01 |
| `period-closure.ts` (puro) | `evaluatePeriodClosure`, `buildPeriodClosedMessage` | Textos de la tabla de abajo |
| `utc-month.ts` (puro) | `monthKeyUtc`, `startOfMonthUtc`, `endOfMonthUtc`, `toUtcDay`, `formatDayUtc`, `todayBusinessDay(Utc)`, `BUSINESS_TIME_ZONE` | Convencion de dias, ver abajo |
| `entry-document-link.ts` (`server-only`) | `getEntryDocumentLink`, `entriesWithoutDocumentWhere`, `buildDocumentLinkedMessage` | Vinculo asiento ↔ documento |
| `closing-entries.ts` | `NOT_CLOSE_GENERATED_OPENING_SQL`, `NOT_CLOSING_ENTRY_SQL` y sus `*Where` Prisma | Exclusion en reportes, ver Cierre de Ejercicio |

**`assertPeriodOpen(tx, companyId, date, { periodType?, subject? })`** → `{ fiscalYearId,
fiscalYearNumber, periodId }`:

1. Toma el lock de la fila de `accounting_settings` (`SELECT … FOR UPDATE`). Es la misma fila que
   actualiza `nextEntryNumberTx` y que bloquean el cierre de mes y el cierre anual: crear un asiento
   y cerrar su mes quedan serializados por empresa.
2. Busca el ejercicio de la fecha; si no existe lo crea **hacia adelante** (`ensureFiscalYearTx`,
   solo el inmediato siguiente al ultimo, con OPENING + un MONTHLY por mes + CLOSING). Fecha
   anterior al primer ejercicio → "…anterior al inicio del primer ejercicio…; cargala como saldo
   de apertura". Mas de un ejercicio adelante → rechazo.
3. Evalua en OR: ejercicio cerrado, mes (`AccountingPeriod` MONTHLY) cerrado, o
   `fecha <= lockedUntilDate` (por dia UTC). Con `periodType: 'OPENING' | 'CLOSING'` (solo el
   cierre anual y los saldos de apertura) mira el ejercicio y el periodo de ese tipo.

Mensajes (siempre contienen "el período está cerrado"):

| Causa | Mensaje |
|---|---|
| Mes cerrado | `No se puede registrar con fecha 10/03/2026: el período está cerrado (mes 03/2026 cerrado). Para operar, reabrilo desde Contabilidad → Configuración → Bloqueo de Períodos.` |
| Ejercicio cerrado | `No se puede registrar con fecha 10/03/2026: el período está cerrado (ejercicio N° 1 cerrado).` |
| `lockedUntilDate` | `… el período está cerrado (bloqueado hasta 31/03/2026). Para operar, reabrilo desde …` |
| Apertura / cierre | `… (apertura del ejercicio N° 2 cerrada).` / `… (cierre del ejercicio N° 1 cerrado).` |
| Anulacion (`subject`) | `No se puede anular el asiento N° 12 (fecha 10/03/2026): el período está cerrado (…)` |

**`createJournalEntryTx(tx, { companyId, date, description, lines, status, createdBy, periodType?,
originalEntryId?, source? })`**: `assertPeriodOpen` → `validateEntryLines` (balance tambien en
DRAFT) → `assertAccountsUsableTx` (empresa + hoja) → `nextEntryNumberTx` → crea cabecera y lineas
con todas sus columnas, `fiscalYearId` y `periodId`. Un rechazo no consume numero (la tx se
revierte). `postJournalEntryTx` registra un DRAFT con las mismas validaciones (incluido ejercicio
cerrado, B4); lo usan "Registrar" y "Registrar los N borradores y cerrar".

**Errores:** los rechazos son `BusinessError`; las actions los devuelven como `ActionResult`
(`{ success: false, error }`) para que el texto llegue en produccion (Next redacta los `throw`).
Ningun creador devuelve `null` ni calla un error. Unica excepcion conservada: bancos sin Ajustes
contables no generan asiento.

**Convencion de dias (D8) y "hoy" (D5 revisado):**

- Un asiento se fecha con un **dia calendario**, guardado como ese dia a las 00:00:00.000Z, y todo
  calculo de mes o rango se hace en UTC (`moment.utc`, `utc-month.ts`). No depende de la zona del
  servidor: produccion (UTC) y desarrollo (UTC-3) imputan igual.
- Los meses de cierre se piden como `{ year, month }`; el servidor deriva el fin de mes. Ningun
  fin de mes se arma en el navegador.
- Ejercicios: `startDate` = 00:00:00.000Z del primer dia, `endDate` = 23:59:59.999Z del ultimo.
- **"Hoy"** del servidor (fecha de la anulacion, de la baja de equipo, vencimiento de recurrentes)
  es el dia calendario en `America/Argentina/Buenos_Aires` (`todayBusinessDayUtc()`), no el dia UTC:
  a las 22:40 de Argentina sigue siendo hoy. La zona esta en una sola constante,
  `BUSINESS_TIME_ZONE`.

---

## Asientos Recurrentes

**Ruta:** `/company/accounting/recurring-entries`
**Archivos:** `features/recurring-entries/`

Templates de asientos que se generan periodicamente.

### Frecuencias

MONTHLY, BIMONTHLY, QUARTERLY, SEMIANNUAL, ANNUAL

### Flujo

1. Crear template con lineas (mismas reglas de balance)
2. Configurar frecuencia y fecha de inicio/fin
3. Generar: crea un asiento DRAFT desde el template
4. El asiento generado debe postearse manualmente
5. `nextDueDate` avanza segun la frecuencia
6. `generateAllPendingRecurringEntries()` genera todos los pendientes en batch

---

## Cierre de Ejercicio Fiscal

**Ruta:** `/company/accounting/fiscal-year-close`
**Archivos:** `features/fiscal-year-close/` (`fiscal-year-close.ts` con la logica transaccional,
`actions.server.ts` envoltorios con `ActionResult`), `shared/utils/fiscal-year-close-math.ts`

### Requisitos (TSK-760)

Se cierra siempre el **ejercicio abierto mas antiguo** (por id, no por fechas de Ajustes):

- `AccountingSettings.resultAccountId` configurado.
- **Todos sus meses cerrados** (B1); si no, el mensaje y la pantalla listan los abiertos con link a
  Bloqueo de Periodos.
- **Ningun borrador** con fecha en el ejercicio (A5/B4); se listan por mes con los primeros numeros.
- Algun saldo de resultado registrado (B20): si no, "no hay asientos registrados con resultado en
  el ejercicio N° X: registrá los borradores".

### Flujo (`closeFiscalYear({ fiscalYearId })`, permiso `accounting.fiscal-year-close` `approve`)

Una transaccion (`timeout: 30_000`): lock de Ajustes → validaciones → vista previa **dentro** de la
tx (`computeClosePreviewTx`, la misma que muestra `previewFiscalYearClose`) → **refundicion** POSTED
en el periodo CLOSING, fechada el ultimo dia (saldos de resultado acumulados al fin del ejercicio,
incluidas cuentas inactivas; sin linea de Resultado si el neto es 0) → ejercicio siguiente con
`ensureFiscalYearTx` (lo **reutiliza** si ya existia, B24) → **apertura** POSTED en su periodo
OPENING, calculada **despues** de la refundicion y verificada balanceada (B21) → ejercicio y todos
sus periodos cerrados, `closingEntryId`/`openingEntryId`, OPENING del siguiente cerrado (C7) →
`syncLockedUntilDateTx` → Ajustes pasan al ejercicio abierto mas antiguo. No se puede deshacer.

### Reportes despues del cierre (exclusion, D7)

El sistema calcula saldos acumulando todo lo POSTED hasta una fecha. Para no duplicar ni anular:

- La **apertura generada por el cierre** (`fiscal_years.opening_entry_id`) se excluye de todo saldo
  acumulado y movimiento por mes (Balance, Sumas y Saldos, Mayor, plan de cuentas, IVA, diferencia
  de cambio, inflacion, el propio cierre). Se ve solo en el Libro Diario (B18).
- La **refundicion** (`closing_entry_id`) se excluye del Estado de Resultados, Presupuesto vs. real,
  control de presupuesto de egresos y movimientos por centro de costo (B19).
- Invariante: `openingEntryId` solo lo escribe el cierre. El saldo de apertura cargado a mano no lo
  usa y cuenta como cualquier asiento.

Fragmentos compartidos en `shared/utils/closing-entries.ts`. Defecto previo, fuera de alcance:
`getBalanceSheet.isBalanced` compara activo (+) con pasivo y patrimonio (−) y muestra "no está
equilibrado" en toda empresa con pasivo o patrimonio.

---

## Reportes

**Ruta:** `/company/accounting/reports`
**Archivos:** `features/reports/`

### Reportes Financieros

| Reporte | Descripcion |
|---------|-------------|
| Balance de Sumas y Saldos | Debe/Haber/Saldo por cuenta, con verificacion de ecuacion contable |
| Balance General | Activo = Pasivo + PN (solo cuentas ASSET, LIABILITY, EQUITY) |
| Estado de Resultados | Ingresos - Egresos = Resultado Neto |
| Libro Diario | Todos los asientos POSTED en rango de fecha |
| Libro Mayor | Movimientos por cuenta con saldo acumulado |
| Movimientos por Centro de Costo | Entradas, salidas y saldo por centro (TSK-719); comparativa de todos los centros expandible al detalle |

#### Movimientos por Centro de Costo (TSK-719)

**Archivos:** `features/reports/actions.server.ts` (actions), `features/reports/components/_CostCenterMovementsReport.tsx` + `_CostCenterMovementsFilters/_CostCenterMovementsSummary/_CostCenterMovementsTable.tsx` + `cost-center-movements-excel.ts` (UI), `shared/utils/cost-center-movements.ts` (helper puro, con `cost-center-movements.test.ts` al lado).

**Regla de signo — por `Account.nature`, no por tipo de cuenta ni por Debe/Haber a secas:**

```
nature = CREDIT (REVENUE, y LIABILITY/EQUITY si llegaran)
    entrada = credit - debit     → la NC de venta debita Ventas y RESTA de las entradas
nature = DEBIT  (EXPENSE, y ASSET)
    salida  = debit - credit     → la NC de compra acredita el gasto y RESTA de las salidas

saldo del grupo = Σ entradas − Σ salidas
```

Clasificar solo por `Account.type` haria que las notas de credito **sumaran** en vez de restar; firmar solo por Debe/Haber llamaria "salida" a cualquier Debe, incluso el de un activo. Verificado contra el Libro Mayor: para cada cuenta de resultado, `Mayor = Σ centros + (Sin centro de costo)`.

**Actions:**

| Action | Firma | Payload |
|--------|-------|---------|
| `getCostCenterMovements` | `(companyId, { costCenterId: string \| 'all' \| 'none', fromDate, toDate, includeDrafts })` | `{ groups: CostCenterMovementGroup[], totals: { entradas, salidas, saldo }, draftsExcluded: { entryCount, saldo }, includeDrafts }` |
| `getCostCentersForMovementsReport` | `(companyId)` | `{ id, name, isActive }[]` — activos **mas** inactivos con movimientos (el borrado es logico; si no, el historico de un centro dado de baja queda inalcanzable) |

`groups` es **siempre** un array, aun para un centro puntual (array de 1): la comparativa de "Todos", el detalle de un centro, el aplanado a Excel y los tests comparten forma. Cada grupo trae sus `rows` con `entrada`, `salida` y `saldo` acumulado ya calculados; el Client Component no recalcula nada (una sola fuente de verdad del saldo).

**Filtro `costCenterId`:**

- Un UUID → solo ese centro, **sin** filtrar por tipo de cuenta (si un asiento manual imputa un activo a un centro, tiene que verse).
- `'all'` → un grupo por centro **mas** el bucket `(Sin centro de costo)`.
- `'none'` → solo el bucket sin imputar.

El bucket **"(Sin centro de costo)" se restringe a cuentas de resultado** (`REVENUE`/`EXPENSE`), tanto elegido explicitamente como dentro de `'all'`: sin esa restriccion caeria adentro toda linea de caja, banco, IVA y cuentas corrientes y el informe seria ilegible.

**Borradores (una sola query, corte en memoria).** La query trae siempre `status IN (DRAFT, POSTED)` y el corte por estado se hace en memoria: las POSTED arman el reporte y las DRAFT el aviso. Asi los numeros del aviso **no pueden discrepar** de los de la tabla, y activar el switch "Incluir borradores" no dispara otra consulta. `REVERSED` nunca entra. Con el switch apagado (default) el informe muestra solo POSTED y `draftsExcluded` alimenta el aviso *"Hay N asientos en borrador con movimientos … que no estan incluidos"*; con el switch encendido se suman las DRAFT y aparece la columna Estado.

**Permisos y alcance.** Las dos actions hacen `checkPermission('accounting.reports', 'view', { redirect: true })` y **validan `companyId` contra `getActiveCompanyId()`** (los 12 reportes viejos no lo hacen: agujero anotado como seguimiento, no corregido aca).

**Acceso.** Ademas del selector de Informes, se abre por deep-link desde **Empresa → Centros de Costo → Ver movimientos** (`?report=cost-center-movements&costCenterId=<uuid>`): `_ReportsContent` **lee** esos parametros de `useSearchParams()` con fallback `'trial-balance'`, y no los escribe al cambiar de informe. Requiere `<Suspense>` alrededor de `_ReportsContent` o el build falla.

**Que imputa centro de costo hoy:** solo las lineas de facturas de **venta** y de **compra** (reparto por porcentaje de TSK-583 o `Product.defaultCostCenterId`) y los asientos manuales que lo lleven. **No** lo imputan los movimientos de fondos, las amortizaciones de equipos, los recibos, las ordenes de pago, los egresos ni el CMV; `Employee.costCenterId` y `Vehicle.costCenterId` son informativos y no llegan al asiento.

**Excel:** `exportToExcel` con las columnas Centro, Fecha, Asiento, Codigo, Cuenta, Descripcion, **Debe, Haber**, Entrada, Salida, Saldo (+ Estado si se incluyeron borradores) y fila `TOTAL` por centro. Debe y Haber van solo al Excel — no entran en la tabla — porque es donde el contador cruza contra el Libro Mayor.

### Reportes de Bienes de Uso

| Reporte | Descripcion |
|---------|-------------|
| Registro de Bienes de Uso | Listado de activos fijos con valor bruto, depreciacion acumulada, valor neto y progreso |
| Depreciaciones del Periodo | Periodos de depreciacion contabilizados en un rango de fechas con montos y asientos |

### Reportes de Auditoria

| Reporte | Descripcion |
|---------|-------------|
| Asientos sin Respaldo | Asientos no vinculados a documentos comerciales |
| Registro de Reversiones | Asientos REVERSED con metadata de reversion |
| Trazabilidad Doc-Asiento | Cruce entre documentos comerciales y sus asientos |

Todos los reportes solo consideran asientos POSTED, salvo **Movimientos por Centro de Costo**, que puede
incluir borradores a pedido (switch apagado por defecto) y avisa cuantos excluye y por que importe.

---

## Configuracion

**Ruta:** `/company/accounting/settings`
**Archivos:** `features/settings/`

### Ejercicio Fiscal

- `saveFiscalYearSettings({ startDay, endDay })` (`'YYYY-MM-DD'`): meses completos (dia 1 a fin de
  mes), hasta 12 meses. La primera vez crea Ajustes y el **ejercicio N° 1** con sus periodos (B23).
- Las fechas son editables solo si la empresa no tiene asientos, meses ni ejercicios cerrados (C3);
  en ese caso se regeneran los periodos. Si no, la pantalla las muestra **de solo lectura** ("Las
  fechas salen del ejercicio N° X; cambian solas al cerrar el ejercicio") y salen del ejercicio
  abierto mas antiguo (D11).
- `saveAccountingSettings` guarda solo cuentas (ya no recibe fechas, H6).

### Bloqueo de Periodos (cierre de meses, TSK-760)

Cada mes es un `AccountingPeriod` MONTHLY con estado propio (`isClosed`, `closedAt`, `closedBy`).
Se cierra **solo el primer mes abierto** y se reabre **solo el ultimo cerrado**; nunca un mes de un
ejercicio cerrado (piso, B5). `AccountingSettings.lockedUntilDate` es **derivado**: fin del ultimo
mes cerrado en forma contigua, recalculado en la misma tx (`syncLockedUntilDateTx`).

**Actions** (`features/settings/actions.server.ts`, logica en `period-closing.ts`):

| Action | Permiso | Notas |
|---|---|---|
| `getPeriodLockStatus()` | `accounting.settings` `view` | Meses del ejercicio abierto mas antiguo y del siguiente si existe, con `isClosed`, `draftCount` y `action` (`close`/`reopen`/`null`) |
| `closeAccountingPeriod({ year, month, postDrafts })` | `accounting.settings` `update` (+ `accounting.entries` `approve` si `postDrafts`) | Con borradores y sin `postDrafts` → rechazo con cantidad y numeros. Con `postDrafts` → `postJournalEntryTx` de cada uno; si uno falla, **no se registra ninguno** y el mes sigue abierto ("No se cerró 03/2025: el borrador N° 12 no se puede registrar. <causa>", + sugerencia de eliminarlo si es manual) |
| `reopenAccountingPeriod({ year, month })` | `accounting.settings` `update` | "Solo se puede reabrir el último mes cerrado: MM/YYYY." / "No se puede reabrir MM/YYYY: pertenece al ejercicio N° X, que está cerrado." |

Fuera de orden (p. ej. otra pestaña desactualizada): "Solo se puede cerrar el primer mes abierto:
MM/YYYY.". UI: `_PeriodLockingPanel`, `_PeriodMonthCell`, `_ClosePeriodDialog`, `_ReopenPeriodDialog`,
`hooks/usePeriodLockMutations.ts`; la card tiene `id="bloqueo-periodos"` (destino de los links).

**Impacto en el sistema** (una sola regla para todos: `assertPeriodOpen` dentro de la tx):

| Operacion | Mes cerrado / ejercicio cerrado |
|---|---|
| Crear asiento manual, registrar borrador | Rechazo con el mensaje de periodo cerrado; no se crea ni se registra |
| Anular asiento | Se validan el mes del original **y** el de hoy |
| Confirmar factura de venta/compra, recibo, OP, egreso, movimiento de fondos | La confirmacion falla y se revierte: el comprobante sigue en `DRAFT` sin asiento |
| Movimiento bancario manual, transferencias banco ↔ banco / caja | Rechazo; no se crea el movimiento ni cambia el saldo |
| Contabilizar depreciacion, revaluo, baja de equipo | Rechazo; la masiva lista el periodo en `errors[]` y contabiliza los demas |
| Generar asiento recurrente | Rechazo; la plantilla queda pendiente hasta reabrir |
| Saldos de apertura | Van al periodo OPENING; el de un ejercicio creado por un cierre esta cerrado (C7) |
| IVA, diferencia de cambio, inflacion (sin UI) | Rechazo |

### Mapeo de Cuentas

Cuentas contables asignadas a funciones del sistema:

| Campo | Funcion |
|-------|---------|
| `salesAccountId` | Ventas **por defecto**: solo las lineas de venta cuyo item no tiene `defaultIncomeAccountId`. Puede ser `null` si todos los items de venta tienen la suya (TSK-721) |
| `purchasesAccountId` | Compras **por defecto**: items sin `defaultExpenseAccountId` y **lineas sin item** (gastos no inventariables, comprobantes importados de AFIP). Requerida mientras se carguen compras sin item (TSK-721) |
| `receivablesAccountId` | Cuentas por Cobrar (requerida por el asiento de venta y de recibo) |
| `payablesAccountId` | Cuentas por Pagar (requerida por el asiento de compra, de OP y de gasto) |
| `vatDebitAccountId` | IVA Debito Fiscal |
| `vatCreditAccountId` | IVA Credito Fiscal |
| `defaultCashAccountId` | Caja **por defecto**: respaldo cuando la caja de un pago no tiene `CashRegister.accountId` (TSK-728) |
| `defaultBankAccountId` | Banco **por defecto**: respaldo cuando la cuenta bancaria de un pago no tiene `BankAccount.accountId` (TSK-728) |
| `bankChargesAccountId` | Gastos bancarios **por defecto** (TSK-718): preseleccion de la cuenta de cada concepto nuevo de un movimiento de fondos `BANK_CHARGES`. Es solo UI: el asiento usa `FundMovementLine.accountId`, no esta cuenta |
| `expensesAccountId` | Gastos Operativos (requerida por el asiento del gasto, TSK-728) |
| `resultAccountId` | Resultado del Ejercicio |

**Labels**: la fuente unica es `src/shared/lib/accounts/settings-account-labels.ts`
(`ACCOUNTING_SETTINGS_ACCOUNT_FIELDS`, 31 campos; `ACCOUNTING_SETTINGS_ACCOUNT_LABELS`;
`ACCOUNTING_SETTINGS_PATH = 'Contabilidad → Configuración'`; `settingsAccountLabel(field)`).
`_CommercialIntegrationForm.tsx` lee de ahi los `label` de `SECTIONS`, y los mensajes de error de
`commercial` los citan textualmente («falta configurar "Cuentas por Cobrar" en Contabilidad →
Configuración»); un test de `settings/validators.test.ts` verifica que cada `*AccountId` del
schema tenga label (TSK-728). Ejemplos: "Cuenta de ventas por defecto", "Cuenta de compras por
defecto" (seccion Cuentas de Resultado), "Cuentas por Cobrar", "Cuentas por Pagar", "Caja por
Defecto", "Banco por Defecto", "Gastos bancarios por defecto" (seccion Cuentas de Tesoreria),
"Cuenta de Gastos Operativos", "Ret. IVA Sufrida". Las ayudas dicen cuando se usa cada una; la de
compras avisa que tiene que estar asignada si se cargan compras sin item.

### Resolucion de la cuenta de linea (TSK-721)

La cuenta contable de cada linea de factura la define el **item**; la global es un respaldo.
Regla: `item → por defecto → error que nombra la linea`.

| Origen | Ventas (Haber) | Compras (Debe) |
|--------|----------------|----------------|
| Item con cuenta | `Product.defaultIncomeAccountId` | `Product.defaultExpenseAccountId` |
| Item sin cuenta | `salesAccountId` | `purchasesAccountId` |
| Linea sin item | no existe en ventas | `purchasesAccountId` (unica opcion) |
| Ninguna | `BusinessError` con la linea nombrada | idem |

Implementacion:

- **Helper puro** `src/modules/commercial/shared/line-accounts.ts` (0 imports, cubierto por
  `line-accounts.test.ts`): `resolveLineAccount`, `findLinesMissingAccount`,
  `buildMissingLineAccountsMessage`, `findLinesWithUnavailableAccount`,
  `buildUnavailableLineAccountsMessage`, `formatAccountLabel`. Los textos que ve el usuario viven
  ahi: «No se puede confirmar el comprobante: la linea «X» no tiene cuenta contable. Asignale una
  Cuenta de Egresos al item (Items → Imputacion contable) o configura la "Cuenta de compras por
  defecto" en Contabilidad → Configuracion.» (con «(sin item)» y una frase extra cuando la linea
  no tiene item).
- **Pre-validacion en el confirm** (`confirmInvoice` / `confirmPurchaseInvoice`, antes de abrir la
  transaccion, mismo patron que tributos y centro de costo): (1) lineas que no resuelven cuenta;
  (2) lineas cuya cuenta efectiva existe pero **no es imputable hoy** (inactiva, no hoja, de otra
  empresa) usando `buildImputableAccountsWhere` + `findLinesWithUnavailableAccount`, con un mensaje
  que distingue si la cuenta viene del item o de la configuracion. No hay fallback silencioso a la
  global cuando la del item esta dada de baja.
- **Asiento** (`features/integrations/commercial/index.ts`): `createJournalEntryForSalesInvoice` /
  `ForPurchaseInvoice` repiten `findLinesMissingAccount` como defensa en profundidad y usan
  `resolveLineAccount` por linea. El guard de configuracion ya no hace `return null`: lanza
  `BusinessError('No se puede generar el asiento: falta configurar "Cuentas por Cobrar/Pagar" en
  Contabilidad → Configuracion.')`. Las alicuotas de IVA sin cuenta (`vatDebit/CreditAccountId` o
  `AccountingVatAccount`) tambien lanzan `BusinessError` en vez de `warn + continue`.
  `createJournalEntry` pasa a devolver `Promise<string>` (antes `string | null`), y "No se
  encontro configuracion contable" / "periodo cerrado" son `BusinessError`.
- **Sin `catch` que trague**: los confirm de facturas ya no envuelven el asiento en un `try/catch`
  con `logger.warn`. Cualquier error del asiento aborta la transaccion y llega al usuario como
  `{ success: false, error }` (ver [Errores de negocio en Server Actions](../conventions/coding-standards.md#errores-de-negocio-en-server-actions)).
  Antes de TSK-721 una factura con linea sin cuenta quedaba `CONFIRMED` con `journalEntryId = null`
  en silencio; `prisma/scripts/diagnose-invoices-without-entry.ts` (solo lectura, SQL en el header)
  lista las historicas (y desde TSK-728 tambien recibos, OP y gastos sin asiento, mas el uso de
  medios de pago).

**Visibilidad de items sin cuenta**: `getItemsWithoutAccountCounts(companyId)` en
`features/settings/actions.server.ts` (`checkPermission('accounting.settings','view')`, dos
`prisma.product.count` sobre items `ACTIVE` con `usage` de venta/compra y cuenta `null`; Prisma
directo, sin importar de `commercial`). `AccountingSettings.tsx` lo carga en `Promise.all` con las
cuentas y renderiza `ItemsWithoutAccountNotice` (Server Component, bloque naranja `role="status"`)
arriba del formulario: una fila por conteo > 0 con enlace «→ Ver» a
`/dashboard/commercial/products?imputation=noIncome|noExpense&status=ACTIVE` (el enlace se oculta
sin permiso `commercial.products.view`). Con ambos conteos en 0 no renderiza nada.

### Asientos de recibos, OP y gastos (TSK-728)

Hasta TSK-728 `createJournalEntryForReceipt` / `ForPaymentOrder` / `ForExpense` devolvian `null`
si faltaba una cuenta global y hacian `continue` sobre los pagos o retenciones sin cuenta (asiento
descuadrado que `validateBalance` rechazaba), y los tres confirm tragaban el error con
`logger.warn`: el comprobante quedaba `CONFIRMED` con `journalEntryId = null`. Ahora:

- Las tres devuelven `Promise<string>` y lanzan `BusinessError` donde antes habia `return null` o
  `continue`. `getAccountingSettings` tambien lanza `BusinessError('No se encontró configuración
  contable para la empresa. Configurala en Contabilidad → Configuración.')`; `getWithholdingAccountId`
  resuelve el campo con `withholdingSettingsField(taxType, 'suffered' | 'emitted')`.
- Recibo: Debe caja/banco de cada pago resuelto + Ret. Sufridas → Haber Cuentas por Cobrar **por el
  importe contabilizable** (`total − omittedAmount`). OP: espejo con Cuentas por Pagar y Ret.
  Emitidas; las OP a socio (`partnerId`) no generan asiento (sin cambio). Gasto: Debe Gastos
  Operativos → Haber Cuentas por Pagar.
- Los **medios de pago sin cuenta** (cheque fisico/propio/endosado, tarjeta de credito, tarjeta de
  socio, "Cuenta Corriente") se clasifican como `omitted` (`classifyPayments`,
  `commercial/shared/payment-accounts.ts`) y no generan linea; el confirm los devuelve en
  `warnings[]` y el usuario los ve antes (dialogo) y despues (toast). Si ningun pago genera linea y
  no hay retenciones, la pre-validacion bloquea (asiento de una sola linea). Cadena de resolucion
  de caja/banco: cuenta propia → "Caja/Banco por Defecto" → `BusinessError` que nombra la caja o el
  banco y donde configurarlo. Detalle y tabla por medio en
  [Modulo Comercial](commercial.md#cuentas-de-medios-de-pago-tsk-728).
- La pre-validacion corre **antes** de `prisma.$transaction` en `confirmReceipt` /
  `confirmPaymentOrder` (`treasury/shared/entry-preflight.ts`, la misma funcion alimenta
  `getReceiptEntryPreview` / `getPaymentOrderEntryPreview` para la vista previa del dialogo) y en
  `confirmExpense` (`assertExpenseEntryAccounts`); el asiento repite los chequeos como defensa en
  profundidad. Sin `try/catch` que trague: cualquier error aborta la transaccion y llega como
  `{ success: false, error }`.
- Seguimientos (`.planes/tsk-728-…md` 2.4): dar cuenta a cheques/tarjetas/socios
  (`checksReceivedAccountId` existe sin UI), movimientos bancarios manuales y transferencias (siguen
  no bloqueantes; TSK-760 los hizo rechazar el período cerrado). `integrations/treasury/index.ts` y
  `createJournalEntryForCOGS` (sin llamadores, callaban errores) se borraron en TSK-760 (fase 11).

### Cuentas de Retenciones (8 campos)

- Emitidas: IVA, Ganancias, IIBB, SUSS ("Ret. IVA Emitida", …): las usan las OP
- Sufridas: IVA, Ganancias, IIBB, SUSS ("Ret. IVA Sufrida", …): las usan los recibos

Si un recibo u OP lleva una retencion cuyo tipo no tiene cuenta, la confirmacion se bloquea con el
label del campo (TSK-728).

### Cuentas de Percepciones e Impuestos Internos (7 campos, TSK-644)

| Campo | Funcion | Tipo Cuenta |
|-------|---------|-------------|
| `perceptionIvaCollectedAccountId` | Perc. IVA cobrada (a depositar) | LIABILITY |
| `perceptionIibbCollectedAccountId` | Perc. IIBB cobrada | LIABILITY |
| `perceptionMunicipalCollectedAccountId` | Perc. Municipal cobrada | LIABILITY |
| `perceptionIvaSufferedAccountId` | Perc. IVA sufrida (credito fiscal) | ASSET |
| `perceptionIibbSufferedAccountId` | Perc. IIBB sufrida | ASSET |
| `perceptionMunicipalSufferedAccountId` | Perc. Municipal sufrida | ASSET |
| `internalTaxesAccountId` | Impuestos internos | EXPENSE (compras) / LIABILITY (ventas) |

Las cuatro de IVA/IIBB existian en el modelo desde antes y el asiento ya las usaba, pero **nunca
se expusieron en la UI de configuracion**: eran inconfigurables. TSK-644 las expone junto a las
tres nuevas (municipales e impuestos internos).

**Sin degradacion suave (como en Bienes de Uso desde TSK-724c):** si una factura tiene un tributo cuya
cuenta no esta configurada, `confirmPurchaseInvoice` / `confirmInvoice` **abortan la confirmacion**
con un mensaje que nombra la cuenta faltante. El motivo: el total del comprobante ya incluye ese
tributo, asi que omitir su linea produce un asiento descuadrado que `validateBalance` rechaza
dentro de un `catch` que lo degradaba a `logger.warn` — la factura terminaba confirmada y sin
asiento, en silencio. La validacion corre **antes** de abrir la transaccion.

### Cuentas de Bienes de Uso (4 campos, 3 de ellos por defecto) — TSK-724c

Seccion del form: **"Bienes de Uso (cuentas por defecto)"** (`_CommercialIntegrationForm.tsx`).

| Campo | Label en pantalla | Tipo Cuenta | Respaldo de |
|-------|-------------------|-------------|-------------|
| `fixedAssetAccountId` | Cuenta de Bienes de Uso por defecto | ASSET | `VehicleDepreciation.fixedAssetAccountId` → `VehicleType.fixedAssetAccountId` |
| `accumulatedDepreciationAccountId` | Amortizacion acumulada por defecto | ASSET | `VehicleDepreciation.accumulatedDepreciationAccountId` → `VehicleType.accumulatedDepreciationAccountId` |
| `depreciationExpenseAccountId` | Gasto de amortizacion por defecto | EXPENSE | `VehicleDepreciation.depreciationExpenseAccountId` → `VehicleType.depreciationExpenseAccountId` |
| `assetDisposalGainLossAccountId` | Resultado por venta/baja de Bienes de Uso | REVENUE/EXPENSE | — (unica para todos los equipos) |

Las tres primeras son **"por defecto"** con la misma semantica que ventas/compras (TSK-721) y aportes de
socios (TSK-717): la cuenta la define el **Tipo de Equipo** (Empresa → Tipos de Equipo), cada equipo puede
sobreescribirla en su pestaña Depreciacion, y estas se usan solo cuando ninguna de las dos esta cargada.
Cada cuenta se resuelve por separado. Los labels de la tabla son los que usa
`ASSET_ACCOUNT_LABELS[*].settingLabel` (`src/shared/lib/assets/asset-account-labels.ts`) para que el
mensaje de error nombre el campo exacto.

**Sin cuenta resoluble la operacion se rechaza** con `ActionResult` que nombra el equipo, la cuenta y los
tres lugares donde cargarla (TSK-724c); **no hay degradacion suave**. Antes, `softDeleteVehicle` y
`createValueAdjustment` salteaban el asiento en silencio si faltaban cuentas. Detalle de la cadena, las
operaciones y la politica de errores en [Modulo Equipamiento](equipment.md#integracion-contable).

### Centro de Costo Obligatorio (TSK-583)

**Campo:** `AccountingSettings.requireCostCenter` (Boolean, default `false`)

Switch "Exigir centro de costo" en el formulario de Integracion Comercial. Con el flag activo,
al confirmar una factura de compra o de venta, toda linea imputada a una cuenta `REVENUE` o
`EXPENSE` debe tener su reparto por centro de costo completo (suma 100%); si falta, la
confirmacion se rechaza nombrando las lineas incompletas, y la confirmacion masiva omite esas
facturas informando el motivo. Con el flag apagado (default), el reparto sigue siendo
opcional y cae en `Product.defaultCostCenterId` cuando esta vacio. El asiento generado agrupa
las imputaciones por `cuenta + centro`; ver [Modulo Comercial](commercial.md#reparto-por-centro-de-costo-tsk-583).

---

## Presupuestos y Control Presupuestario

**Ruta:** `/company/accounting/budgets`
**Archivos:** `features/budgets/`

Permite definir presupuestos por cuenta contable y ano fiscal, comparar lo planificado con lo ejecutado (asientos POSTED), y crear revisiones formales con trazabilidad.

### Modelos

| Modelo | Descripcion |
|--------|-------------|
| `Budget` | Presupuesto por cuenta y ano fiscal. Campos: `monthlyAmounts` (Json, array de 12 numeros), `totalAmount` (Decimal), `status` (BudgetStatus), `fiscalYear` (Int). Constraint unico: `[companyId, accountId, fiscalYear]`. |
| `BudgetRevision` | Historial de revisiones formales. Guarda `previousAmounts`, `newAmounts`, `reason` (obligatorio). Cascade delete desde Budget. |

### Ciclo de Vida

```
DRAFT ──(activateBudget)──> ACTIVE ──(closeBudget)──> CLOSED
  │                           │
  │ (updateBudget)            │ (createBudgetRevision)
  │ (deleteBudget)            │
  └───────────────────────────┘
```

- **DRAFT**: Editable libremente. Se puede eliminar.
- **ACTIVE**: Solo revisiones formales (con motivo obligatorio). Se puede cerrar.
- **CLOSED**: Solo lectura.

### Funcionalidades

- **CRUD**: Crear presupuesto seleccionando una cuenta hoja de tipo EXPENSE o REVENUE, asignar montos por mes fiscal (12 campos). Distribucion uniforme disponible.
- **Alineacion fiscal**: Los 12 meses se alinean con `fiscalYearStart` de `AccountingSettings`, no con el calendario.
- **Comparacion mensual**: Detalle con tabla de 12 meses mostrando Presupuestado, Ejecutado, Desvio ($) y Desvio (%). Ejecutado calculado con query optimizada (`$queryRaw` con `GROUP BY`).
- **Coloreo de desvios**: Verde (< 80%), amarillo (80-100%), rojo (> 100%). Para REVENUE la logica se invierte (mas ejecucion es favorable).
- **Revisiones formales**: Al revisar un presupuesto ACTIVE se guarda snapshot de montos anteriores y nuevos con motivo. Historial visible en el detalle.
- **Cuentas hoja**: Solo se asignan presupuestos a cuentas sin hijos (`children: { none: {} }`).

### Permisos

Modulo `accounting.budgets` con acciones: view, create, update, delete, approve.

### Server Actions

| Funcion | Descripcion |
|---------|-------------|
| `getBudgetsPageData()` | Datos iniciales (settings, cuentas de resultado) |
| `getBudgets(fiscalYear?)` | Lista presupuestos con info de cuenta y revisiones |
| `getBudgetDetail(budgetId)` | Detalle con ejecutado mensual, desvios y revisiones |
| `getBudgetableAccounts(fiscalYear)` | Cuentas hoja EXPENSE/REVENUE disponibles |
| `getAvailableFiscalYears()` | Anos fiscales con presupuestos existentes |
| `createBudget(input)` | Crear presupuesto DRAFT |
| `updateBudget(id, input)` | Actualizar presupuesto DRAFT |
| `activateBudget(id)` | Pasar de DRAFT a ACTIVE (requiere totalAmount > 0) |
| `createBudgetRevision(input)` | Revision formal de presupuesto ACTIVE (transaccion) |
| `closeBudget(id)` | Pasar de ACTIVE a CLOSED |
| `deleteBudget(id)` | Eliminar presupuesto DRAFT (cascade) |

### Integracion con Gastos

Al confirmar un gasto (`confirmExpense()`), se invoca `checkBudgetForExpense()` desde `integrations/commercial/index.ts`. Si el ejecutado del mes supera el 80% del presupuestado, se retorna un warning (toast). La confirmacion del gasto nunca se bloquea.

### Reporte de Variacion Presupuestaria

Disponible en `/company/accounting/reports` como tipo `budget-variance`. Compara todas las cuentas presupuestadas (ACTIVE/CLOSED) con su ejecucion real. Separado en secciones Ingresos y Gastos con resultado neto. Exportable a Excel.

---

## Saldos de Apertura

**Ruta:** `/company/accounting/opening-balances`
**Archivos:** `features/opening-balances/`

Wizard para migrar saldos iniciales de empresas que vienen de otro sistema contable. Se divide en tres secciones (tabs):

### Asiento de Apertura

- Crea un JournalEntry POSTED con `createJournalEntryTx(…, periodType: 'OPENING')`, fecha = inicio del
  ejercicio abierto mas antiguo (TSK-760)
- El usuario ingresa el saldo (Debe o Haber) para cada cuenta con saldo inicial
- La diferencia se balancea automaticamente con una cuenta "Apertura" de tipo EQUITY
- La cuenta Apertura se auto-crea (codigo 3.0.1) si no existe
- **Editar** = anular el asiento vigente (`reverseJournalEntryTx` con su misma fecha, en OPENING) y
  crear uno nuevo (B25: la edicion anterior borraba lineas de un POSTED y el trigger la rechazaba)
- Respeta el periodo OPENING: el de un ejercicio creado por un cierre anual esta cerrado, asi que
  en ejercicios N° 2 en adelante no se cargan saldos manuales (C7)
- Deteccion de asiento existente: `fiscalYearId` del ejercicio + `description='Asiento de Apertura'` +
  POSTED (H3)

### Facturas de Venta Pendientes

- Formulario simplificado: cliente, tipo comprobante, numero, fecha, vencimiento, total
- Import masivo desde Excel (ExcelJS)
- Crea SalesInvoice con `status=CONFIRMED, journalEntryId=null, internalNotes='opening-balance'`
- Sin lineas de detalle de productos (una linea sintetica con total)
- Aparecen automaticamente en cashflow como cuentas por cobrar

### Facturas de Compra Pendientes

- Mismo patron que facturas de venta pero con proveedores
- Crea PurchaseInvoice con `status=CONFIRMED, journalEntryId=null, internalNotes='opening-balance'`
- Aparecen automaticamente en cashflow como cuentas por pagar

### Notas Tecnicas

- **No requiere modelo nuevo**: usa JournalEntry, SalesInvoice y PurchaseInvoice existentes
- **Marcador**: facturas de apertura se identifican por `internalNotes='opening-balance'`
- **Prerequisitos**: requiere ejercicio fiscal configurado y plan de cuentas creado
- **Permisos**: modulo `accounting.opening-balances`
