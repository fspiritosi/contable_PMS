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
```

### Reglas de Validacion

1. Minimo 2 lineas
2. Debe = Haber (tolerancia ±0.01)
3. Cada linea tiene Debe XOR Haber (no ambos, no ninguno)
4. Montos positivos
5. Fecha dentro del ejercicio fiscal
6. Cuentas deben existir, estar activas y pertenecer a la empresa

### Asientos Automaticos

Se generan al confirmar documentos comerciales (ver [Modulo Comercial](commercial.md#integracion-contable)):
- Facturas de venta/compra (incluyen una linea por percepcion y otra por impuestos internos, TSK-644;
  la cuenta de cada linea es la del item o la "por defecto" de configuracion, y si falta la
  confirmacion se bloquea, TSK-721 — ver [Resolucion de la cuenta de linea](#resolucion-de-la-cuenta-de-linea-tsk-721))
- Recibos de cobro
- Ordenes de pago
- Gastos

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

### Reversion

Solo asientos POSTED pueden reversarse. La reversion:
1. Crea un nuevo asiento con Debe/Haber invertidos
2. Marca el original como REVERSED con `reversalEntryId`
3. El nuevo asiento se crea como POSTED directamente

### Numeracion

Secuencial por empresa, gestionada por `AccountingSettings.lastEntryNumber`. Se incrementa atomicamente dentro de `$transaction`.

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
**Archivos:** `features/fiscal-year-close/`

### Flujo

1. **Preview:** Calcula las lineas de cierre sin comprometer
2. **Cerrar:** Crea un asiento POSTED que:
   - Para cada cuenta de REVENUE y EXPENSE con saldo no-cero, crea una linea que la lleva a cero
   - Crea una linea en la cuenta de Resultado que captura el neto (ganancia en Haber, perdida en Debe)

### Requisitos

- `AccountingSettings.resultAccountId` debe estar configurado
- No se puede cerrar dos veces (detecta asiento de cierre existente)
- El asiento se fecha al `fiscalYearEnd`

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

Todos los reportes solo consideran asientos POSTED.

---

## Configuracion

**Ruta:** `/company/accounting/settings`
**Archivos:** `features/settings/`

### Ejercicio Fiscal

- Fecha de inicio y fin (maximo 366 dias)

### Bloqueo de Periodos

Permite bloquear periodos contables mensuales para evitar la creacion o modificacion de asientos. El bloqueo es secuencial: no se puede bloquear un mes sin bloquear los anteriores.

**Campo:** `AccountingSettings.lockedUntilDate` (DateTime nullable)

- Almacena la fecha de fin del ultimo mes bloqueado
- Cualquier asiento con fecha <= `lockedUntilDate` es rechazado
- UI muestra grid de 12 meses del ejercicio fiscal con iconos Lock/LockOpen
- Solo el primer mes desbloqueado (para bloquear) y el ultimo mes bloqueado (para desbloquear) son interactivos

**Impacto en el sistema:**

| Operacion | Comportamiento en periodo bloqueado |
|-----------|-------------------------------------|
| Crear asiento manual | Error: periodo bloqueado |
| Registrar (post) asiento borrador | Error: periodo bloqueado |
| Revertir asiento | Error: periodo bloqueado |
| Confirmar factura de venta/compra | La confirmacion falla con mensaje legible y se revierte: la factura sigue en `DRAFT` sin asiento (TSK-721: cualquier error del asiento bloquea) |
| Confirmar recibo/OP/gasto | Documento se confirma, asiento automatico se omite con warning (pendiente de alinear con TSK-721) |
| Contabilizar depreciacion | Error: periodo bloqueado |
| Cierre fiscal | Auto-bloquea todos los meses del ejercicio |

### Mapeo de Cuentas

Cuentas contables asignadas a funciones del sistema:

| Campo | Funcion |
|-------|---------|
| `salesAccountId` | Ventas **por defecto**: solo las lineas de venta cuyo item no tiene `defaultIncomeAccountId`. Puede ser `null` si todos los items de venta tienen la suya (TSK-721) |
| `purchasesAccountId` | Compras **por defecto**: items sin `defaultExpenseAccountId` y **lineas sin item** (gastos no inventariables, comprobantes importados de AFIP). Requerida mientras se carguen compras sin item (TSK-721) |
| `receivablesAccountId` | Cuentas por Cobrar (requerida por el asiento de venta) |
| `payablesAccountId` | Cuentas por Pagar (requerida por el asiento de compra) |
| `vatDebitAccountId` | IVA Debito Fiscal |
| `vatCreditAccountId` | IVA Credito Fiscal |
| `defaultCashAccountId` | Caja (default) |
| `defaultBankAccountId` | Banco (default) |
| `bankChargesAccountId` | Gastos bancarios **por defecto** (TSK-718): preseleccion de la cuenta de cada concepto nuevo de un movimiento de fondos `BANK_CHARGES`. Es solo UI: el asiento usa `FundMovementLine.accountId`, no esta cuenta |
| `expensesAccountId` | Gastos Operativos |
| `resultAccountId` | Resultado del Ejercicio |

Labels en `_CommercialIntegrationForm.tsx`: "Cuenta de ventas por defecto", "Cuenta de compras por
defecto" (seccion Cuentas de Resultado) y "Gastos bancarios por defecto" (seccion Cuentas de
Tesoreria, tipo `EXPENSE`). Las ayudas dicen cuando se usa cada una; la de compras avisa que tiene
que estar asignada si se cargan compras sin item.

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
  lista las historicas.

**Visibilidad de items sin cuenta**: `getItemsWithoutAccountCounts(companyId)` en
`features/settings/actions.server.ts` (`checkPermission('accounting.settings','view')`, dos
`prisma.product.count` sobre items `ACTIVE` con `usage` de venta/compra y cuenta `null`; Prisma
directo, sin importar de `commercial`). `AccountingSettings.tsx` lo carga en `Promise.all` con las
cuentas y renderiza `ItemsWithoutAccountNotice` (Server Component, bloque naranja `role="status"`)
arriba del formulario: una fila por conteo > 0 con enlace «→ Ver» a
`/dashboard/commercial/products?imputation=noIncome|noExpense&status=ACTIVE` (el enlace se oculta
sin permiso `commercial.products.view`). Con ambos conteos en 0 no renderiza nada.

### Cuentas de Retenciones (8 campos)

- Emitidas: IVA, Ganancias, IIBB, SUSS
- Sufridas: IVA, Ganancias, IIBB, SUSS

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

- Crea un JournalEntry con status POSTED, fecha = fiscalYearStart
- El usuario ingresa el saldo (Debe o Haber) para cada cuenta con saldo inicial
- La diferencia se balancea automaticamente con una cuenta "Apertura" de tipo EQUITY
- La cuenta Apertura se auto-crea (codigo 3.0.1) si no existe
- El asiento se puede editar/actualizar (reemplaza lineas, no genera reversal)
- Bypass de validacion de periodo bloqueado (la fecha puede estar en un periodo ya bloqueado)
- Deteccion de asiento existente: `description='Asiento de Apertura' AND date=fiscalYearStart AND status=POSTED`

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
