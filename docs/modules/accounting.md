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
- Facturas de venta/compra
- Recibos de cobro
- Ordenes de pago
- Gastos

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
| Confirmar factura/recibo/OP/gasto | Documento se confirma, asiento automatico se omite con warning |
| Contabilizar depreciacion | Error: periodo bloqueado |
| Cierre fiscal | Auto-bloquea todos los meses del ejercicio |

### Mapeo de Cuentas

Cuentas contables asignadas a funciones del sistema:

| Campo | Funcion |
|-------|---------|
| `salesAccountId` | Ventas |
| `purchasesAccountId` | Compras |
| `receivablesAccountId` | Cuentas por Cobrar |
| `payablesAccountId` | Cuentas por Pagar |
| `vatDebitAccountId` | IVA Debito Fiscal |
| `vatCreditAccountId` | IVA Credito Fiscal |
| `defaultCashAccountId` | Caja (default) |
| `defaultBankAccountId` | Banco (default) |
| `expensesAccountId` | Gastos Operativos |
| `resultAccountId` | Resultado del Ejercicio |

### Cuentas de Retenciones (8 campos)

- Emitidas: IVA, Ganancias, IIBB, SUSS
- Sufridas: IVA, Ganancias, IIBB, SUSS

### Cuentas de Activos Fijos (4 campos)

| Campo | Funcion | Tipo Cuenta |
|-------|---------|-------------|
| `fixedAssetAccountId` | Bienes de Uso | ASSET |
| `accumulatedDepreciationAccountId` | Depreciacion Acumulada | ASSET |
| `depreciationExpenseAccountId` | Gasto de Depreciacion | EXPENSE |
| `assetDisposalGainLossAccountId` | Resultado Venta/Baja | REVENUE/EXPENSE |

Sin estas cuentas configuradas, los asientos de depreciacion y baja de activos no se generan (degradacion suave).

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
