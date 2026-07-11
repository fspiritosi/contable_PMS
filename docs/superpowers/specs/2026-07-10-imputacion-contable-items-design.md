# Imputación contable de ítems desde el listado (TSK-409)

**Fecha:** 2026-07-10
**Ticket:** #409 "[Comercial] No puedo cargar productos, que serían items" (reabierto)
**Tipo:** Mejora de UX

## Problema

La cliente (Elizabeth) reabrió el ticket: el alta de ítems permite poner
cualquier descripción "pero no imputa a nada contable". Pide poder darles la
imputación contable desde el **listado de ítems**, para que el asiento de las
facturas no quede a medias.

## Diagnóstico

La imputación por artículo **ya existe y ya se usa**: el modelo `Product` tiene
`defaultIncomeAccountId`, `defaultExpenseAccountId` y `defaultCostCenterId`
(TSK-322), y el asiento de factura toma la cuenta del producto con fallback a la
cuenta global (`createJournalEntryForSalesInvoice` / `...PurchaseInvoice`).

El gap es de **acceso**: los campos son opcionales y la única forma de
asignarlos es entrando a editar cada artículo (el bulk-edit tampoco los incluye).
Si se cargan sin cuenta, todo colapsa a la cuenta genérica de Ventas/Compras.

## Solución

Alcance acordado: (a) editar la imputación desde el listado, (b) incluirla en el
bulk-edit.

### Backend — `products/features/list/actions.server.ts`

- `getProducts`: agregar al `include` las relaciones `defaultIncomeAccount`,
  `defaultExpenseAccount` y `defaultCostCenter` (`{ id, code, name }`) para
  mostrar el estado de imputación en el listado.
- Nueva action `updateProductImputation(id, imputation)` acotada: actualiza solo
  `defaultIncomeAccountId`, `defaultExpenseAccountId`, `defaultCostCenterId`
  (sin recalcular precios). `checkPermission('commercial.products', 'update')`.
- Extender `bulkUpdateProducts` para aceptar esos 3 campos contables.

### UI — listado de artículos

- `ProductsList.tsx` (server): cargar `accounts` y `costCenters` con
  `getAccountsForProductSelect()` / `getCostCentersForProductSelect()` y pasarlos
  a `_ProductsTable`.
- Nueva **columna "Imputación"** en `columns.tsx`: badges con los códigos de las
  cuentas asignadas, o badge **"Sin imputar"** cuando faltan.
- Nuevo ítem en el menú de acciones de cada fila: **"Imputación contable"** →
  abre `_ImputationModal` (nuevo) con 3 selects (ingreso / egreso / centro de
  costo) → guarda con `updateProductImputation`.
- `_BulkEditModal.tsx`: agregar 3 toggles+selects (recibe `accounts` y
  `costCenters` como props).

### Cuentas

Las cuentas de ingreso se filtran por `nature === 'CREDIT'` y las de egreso por
`nature === 'DEBIT'`, igual que en `_AccountingDefaultsSection`.

## Archivos afectados

- `products/features/list/actions.server.ts` (getProducts, updateProductImputation, bulkUpdateProducts)
- `products/features/list/ProductsList.tsx`
- `products/features/list/columns.tsx`
- `products/features/list/components/_ProductsTable.tsx`
- `products/features/list/components/_ImputationModal.tsx` (nuevo)
- `products/features/list/components/_BulkEditModal.tsx`

## Verificación

- `npm run check-types` y `npm run lint`.
- Script contra la DB local: asignar imputación individual y masiva, confirmar
  persistencia de los 3 campos.

## Fuera de alcance

- No se cambia el modelo de datos (sin migración).
- No se agrega cuenta por línea de comprobante (los ítems con producto ya
  imputan; las líneas de compra con descripción libre siguen usando la cuenta
  global — posible mejora futura).
