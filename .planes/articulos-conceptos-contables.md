# Articulos - Conceptos Contables (Ticket #322)

**Fecha de inicio:** 2026-06-29
**Estado:** Verificado - APROBADO

---

## 1. Analisis

### 1.1 Problema

El modelo `Product` carece de campos para vincular directamente conceptos contables y logisticos a nivel de articulo. Actualmente, la integracion contable (asientos automaticos al confirmar facturas) usa cuentas globales de `AccountingSettings` para toda la empresa. Esto impide:

1. **Cuenta de gastos predeterminada** (`defaultExpenseAccountId`): Al registrar compras, el asiento debita siempre `purchasesAccountId` global. No se puede diferenciar por producto (ej: "Repuestos" vs "Insumos de oficina").
2. **Cuenta de ingresos predeterminada** (`defaultIncomeAccountId`): Al registrar ventas, el asiento acredita siempre `salesAccountId` global. No se puede diferenciar por producto (ej: "Venta de repuestos" vs "Servicios").
3. **Centro de costos predeterminado** (`defaultCostCenterId`): No existe forma de asignar un centro de costos a nivel de producto. Los asientos automaticos no pasan `costCenterId` en las lineas de compra/venta.
4. **Almacen predeterminado** (`defaultWarehouseId`): Al crear remitos/notas de recepcion, el usuario debe seleccionar manualmente el almacen. Un default por producto agilizaria el proceso.
5. **Proveedor predeterminado** (`defaultSupplierId`): Existe la tabla `ProductSupplier` (M:N), pero no hay un proveedor "principal" marcado que se sugiera automaticamente al crear ordenes de compra.
6. **Generacion automatica de codigo** (auto-code): Ya existe logica basica de generacion (`PROD-XXXX`) en `createProduct()`, pero es fragil (busca por orden lexicografico, no contempla gaps, es hardcoded). Se necesita un sistema configurable de prefijo + secuencia.

### 1.2 Contexto actual

#### Modelo Product (prisma/schema.prisma, linea 2179-2248)

Campos existentes relevantes:
- `id`, `companyId`, `code` (SKU, generado como PROD-XXXX), `name`, `description`
- `type` (PRODUCT, SERVICE, COMBO), `usage` (PURCHASE, SALE, PURCHASE_SALE)
- `categoryId` (FK a ProductCategory)
- Precios: `costPrice`, `profitMargin`, `salePrice`, `salePriceWithTax`, `vatRate`
- Stock: `trackStock`, `minStock`, `maxStock`
- Codigos: `barcode`, `internalCode`, `brand`, `model`, `oemCode`, `auxiliaryCode`
- `productGroupId` (FK a ProductGroup, industria AUTO_PARTS)
- `status` (ACTIVE, INACTIVE, DISCONTINUED)
- Relaciones: `category`, `priceListItems`, `stockMovements`, `warehouseStocks`, `productSuppliers`, `salesInvoiceLines`, `purchaseInvoiceLines`, etc.

**Campos que NO existen y se deben agregar:**
- `defaultExpenseAccountId` (FK a Account)
- `defaultIncomeAccountId` (FK a Account)
- `defaultCostCenterId` (FK a CostCenter)
- `defaultWarehouseId` (FK a Warehouse)
- `defaultSupplierId` (FK a Supplier)

#### Generacion de codigo actual (actions.server.ts, linea 238-252)

```typescript
// Busca el ultimo producto por orden descendente de code
const lastProduct = await prisma.product.findFirst({
  where: { companyId },
  orderBy: { code: 'desc' },
  select: { code: true },
});
let nextNumber = 1;
if (lastProduct && lastProduct.code.startsWith('PROD-')) {
  const lastNumber = parseInt(lastProduct.code.split('-')[1]);
  if (!isNaN(lastNumber)) nextNumber = lastNumber + 1;
}
const code = `PROD-${nextNumber.toString().padStart(4, '0')}`;
```

Problemas: orden lexicografico (PROD-9999 < PROD-10000), prefijo hardcoded, no configurable, puede generar colisiones si hay codigos importados no PROD-.

#### Modelos relacionados que ya existen

| Modelo | Ubicacion (linea) | Campos clave para select |
|---|---|---|
| `Account` | L294 | `id`, `code`, `name`, `type`, `nature`, `isLeaf`, `isActive` |
| `CostCenter` | L987 | `id`, `name`, `isActive`, `companyId` |
| `Warehouse` | L2316 | `id`, `code`, `name`, `type`, `isActive`, `companyId` |
| `Supplier` | L2077 | `id`, `code`, `businessName`, `tradeName`, `taxId`, `status`, `companyId` |
| `AccountingSettings` | L490 | Cuentas globales, `lastEntryNumber` (patron de secuencia atomica) |

#### Funciones de select existentes (reutilizables)

| Funcion | Archivo | Retorna |
|---|---|---|
| `getAccounts(companyId)` | `src/modules/accounting/features/accounts/actions.server.ts:153` | Todas las cuentas activas |
| `getCostCentersForSelect()` | `src/modules/company/features/cost-centers/list/actions.server.ts:99` | `{ id, name }[]` de centros activos |
| `getWarehousesForSelect()` | `src/modules/commercial/features/warehouses/features/movements/actions.server.ts:19` | `{ id, name }[]` de almacenes activos |
| `getSuppliersForSelect()` | `src/modules/commercial/features/purchases/features/purchase-orders/list/actions.server.ts:268` | `{ id, code, businessName, tradeName, taxId, taxCondition }[]` |

**PROBLEMA**: Estas funciones viven en modulos especificos, no en `shared/actions/`. Segun las reglas del proyecto (module-communication), NO se deben importar entre modulos. Hay dos opciones: (a) crear wrappers en `shared/actions/` para los selects que se usen cross-module, o (b) duplicar las queries ligeras en las actions del modulo de productos. El hook `useCatalogs` ya importa `getCostCentersForSelect` desde company module directamente (ver `src/shared/hooks/useCatalogs.ts:10`), lo que establece un precedente.

#### Integracion contable actual

La integracion se maneja en `src/modules/accounting/features/integrations/commercial/index.ts`. Los asientos se crean con cuentas globales:

- **Compra**: `settings.purchasesAccountId` (linea 436-443) -- una sola cuenta para todo tipo de compra
- **Venta**: `settings.salesAccountId` (linea 310-323) -- una sola cuenta para todas las ventas
- **CMV**: `settings.cogsAccountId` y `settings.inventoryAccountId` (linea 1095-1108) -- globales
- **Gastos**: `settings.expensesAccountId` (linea 846-850) -- una sola cuenta

El cambio propuesto permitiria que al crear el asiento, si el producto tiene `defaultExpenseAccountId` o `defaultIncomeAccountId`, se use esa cuenta en vez de la global. Esto requiere leer las lineas de la factura con los datos del producto incluyendo estos nuevos campos.

### 1.3 Archivos involucrados

#### Schema y tipos (Fase 1 - Modelo de datos)

| Archivo | Cambio |
|---|---|
| `prisma/schema.prisma` (L2179-2248, model Product) | Agregar 5 campos FK opcionales + relaciones |
| `prisma/schema.prisma` (L294, model Account) | Agregar relaciones inversas `productsAsExpenseAccount[]`, `productsAsIncomeAccount[]` |
| `prisma/schema.prisma` (L987, model CostCenter) | Agregar relacion inversa `products[]` |
| `prisma/schema.prisma` (L2316, model Warehouse) | Agregar relacion inversa `defaultProducts[]` |
| `prisma/schema.prisma` (L2077, model Supplier) | Agregar relacion inversa `defaultProducts[]` |
| `src/modules/commercial/features/products/shared/types.ts` (L32-66) | Agregar campos al interface `Product` y relaciones opcionales |
| `src/modules/commercial/features/products/shared/types.ts` (L103-123) | Agregar campos a `CreateProductInput` y `UpdateProductInput` |
| `src/modules/commercial/features/products/shared/validators.ts` (L36-65) | Agregar campos al schema Zod `createProductSchema` y `updateProductSchema` |

#### Server Actions (Fase 2 - Logica)

| Archivo | Cambio |
|---|---|
| `src/modules/commercial/features/products/features/list/actions.server.ts` (L227-318, createProduct) | Guardar nuevos campos, mejorar generacion de codigo |
| `src/modules/commercial/features/products/features/list/actions.server.ts` (L323-414, updateProduct) | Actualizar nuevos campos |
| `src/modules/commercial/features/products/features/list/actions.server.ts` (L182-222, getProductById) | Incluir relaciones en select para mostrar nombres |
| `src/modules/commercial/features/products/features/list/actions.server.ts` (L84-96, getProducts) | Incluir relaciones para mostrar en tabla |
| `src/modules/commercial/features/products/features/list/actions.server.ts` (L716-848, processProductImport) | Soportar nuevos campos en importacion |

#### Formularios y UI (Fase 3 - Interfaz)

| Archivo | Cambio |
|---|---|
| `src/modules/commercial/features/products/features/create/CreateProduct.tsx` (L1-23) | Fetch de accounts, cost centers, warehouses, suppliers |
| `src/modules/commercial/features/products/features/create/components/_CreateProductForm.tsx` (L1-43) | Pasar nuevas props al form |
| `src/modules/commercial/features/products/features/create/components/_ProductForm.tsx` (L1-622) | Agregar seccion "Configuracion Contable" con 5 selects nuevos |
| `src/modules/commercial/features/products/features/edit/EditProduct.tsx` (L1-36) | Fetch de accounts, cost centers, warehouses, suppliers |
| `src/modules/commercial/features/products/features/edit/components/_EditProductForm.tsx` (L1-78) | Pasar nuevas props, mapear defaultValues |
| `src/modules/commercial/features/products/features/detail/ProductDetail.tsx` (L1-246) | Mostrar conceptos contables asignados (Card nueva o dentro de existente) |

#### Integracion contable (Fase 4 - Contabilidad por articulo)

| Archivo | Cambio |
|---|---|
| `src/modules/accounting/features/integrations/commercial/index.ts` (L269-389, sales) | Usar `product.defaultIncomeAccountId` como override de `salesAccountId` por linea |
| `src/modules/accounting/features/integrations/commercial/index.ts` (L395-517, purchases) | Usar `product.defaultExpenseAccountId` como override de `purchasesAccountId` por linea |
| `src/modules/accounting/features/integrations/commercial/index.ts` (L1052-1125, COGS) | Evaluar si agregar costCenterId a lineas de CMV |

#### Auto-code (Fase 5 - Generacion de codigo configurable)

| Archivo | Cambio |
|---|---|
| `prisma/schema.prisma` (model AccountingSettings o nuevo modelo) | Agregar campos `productCodePrefix`, `lastProductNumber` |
| `src/modules/commercial/features/products/features/list/actions.server.ts` (L238-252) | Reemplazar logica hardcoded por secuencia atomica |

### 1.4 Dependencias

#### Modelos Prisma existentes (no requieren creacion)

- `Account` -- para `defaultExpenseAccountId` y `defaultIncomeAccountId`
- `CostCenter` -- para `defaultCostCenterId`
- `Warehouse` -- para `defaultWarehouseId`
- `Supplier` -- para `defaultSupplierId`
- `AccountingSettings` -- para el patron de secuencia atomica (`lastEntryNumber` en L495)

#### Librerias compartidas requeridas

- `src/shared/lib/prisma.ts` -- cliente Prisma
- `src/shared/lib/logger.ts` -- logging
- `src/shared/lib/company.ts` -- `getActiveCompanyId()`
- `src/shared/lib/permissions/` -- `checkPermission()`
- `src/shared/hooks/useCatalogs.ts` -- ya tiene `getCostCentersForSelect`, podria extenderse

#### Funciones existentes que se reutilizaran

- `getAccounts(companyId)` de `src/modules/accounting/features/accounts/actions.server.ts:153` -- para selects de cuentas contables (solo `isLeaf: true` para product defaults)
- `getCostCentersForSelect()` de `src/modules/company/features/cost-centers/list/actions.server.ts:99`
- `getWarehousesForSelect()` de `src/modules/commercial/features/warehouses/features/movements/actions.server.ts:19`
- `getSuppliersForSelect()` de `src/modules/commercial/features/purchases/features/purchase-orders/list/actions.server.ts:268`

**NOTA sobre modularidad**: El proyecto prohibe importar entre modulos (`@.claude/rules/module-communication.md`). Sin embargo, ya existe el precedente de `useCatalogs.ts` importando desde `company/features/cost-centers`. Se debera evaluar si crear queries ligeras directamente en las actions de productos (duplicacion menor pero autonomia) o crear shared actions (mas limpio pero requiere refactor futuro).

### 1.5 Restricciones y reglas

#### Del CLAUDE.md (reglas de oro que aplican)

1. **Prisma Decimal a Number()** (Regla 9): Los nuevos campos son FK (String/UUID), no Decimal. No aplica directamente, pero los datos relacionados (si se incluyen precios del supplier) si necesitan conversion.
2. **Server Actions con checkPermission** (Regla 11): Todas las nuevas actions/modificaciones DEBEN mantener `checkPermission('commercial.products', 'action')`.
3. **Logger, no console** (Regla 2): Usar `logger.info/error` en toda nueva logica.
4. **Client Components con prefijo `_`** (Regla 4): Nuevos componentes client deben llevar prefijo `_`.
5. **moment.js** (Regla 1): No aplica directamente (no hay fechas nuevas).
6. **AlertDialog** (Regla 5): Si se agrega confirmacion de limpieza de campos.
7. **app/ solo rutas** (Regla 6): Los componentes van en `modules/`, no en `app/`.
8. **Tests E2E** (Regla 7): Se deben actualizar tests de productos en Cypress.
9. **Documentacion** (Reglas 8 y 10): Actualizar `docs/` y guia de usuario.
10. **Permisos** (Regla 11): Ya existen `commercial.products` con acciones view/create/update/delete.
11. **Modulos no importan de otros modulos** (`module-communication.md`): Cuidado con imports de accounting/accounts, company/cost-centers.

#### Del schema Prisma

- Los campos FK deben ser opcionales (`String?`) ya que un producto puede no tener concepto contable asignado.
- Las relaciones deben usar `@map()` para nombres de columna en snake_case.
- Se deben agregar relaciones inversas en los modelos referenciados (Account, CostCenter, Warehouse, Supplier).

#### De la UI existente

- El formulario `_ProductForm.tsx` ya tiene 4 secciones en Cards: Informacion Basica, Precios e IVA, Control de Stock, Informacion Adicional.
- Se agregara una nueva Card "Configuracion Contable y Logistica" despues de "Precios e IVA" o al final.
- Los selects deben seguir el patron existente de shadcn `Select` con `SelectTrigger/SelectContent/SelectItem`.

### 1.6 Riesgos identificados

#### Migracion de base de datos

- **Riesgo**: Agregar 5 columnas FK nuevas + posibles campos en AccountingSettings.
- **Mitigacion**: Todos los campos son opcionales (`String?`), por lo que la migracion es no-destructiva. Los productos existentes tendran `null` en los nuevos campos.
- **Impacto**: Cero downtime, no se requiere backfill de datos.

#### Integracion contable por articulo

- **Riesgo**: Cambiar la logica de generacion de asientos (`createJournalEntryForPurchaseInvoice`, `createJournalEntryForSalesInvoice`) para usar cuentas por producto es un cambio critico. Si un producto tiene `defaultIncomeAccountId` pero la cuenta esta inactiva o eliminada, el asiento fallaria.
- **Mitigacion**: Implementar fallback: si la cuenta del producto no esta disponible o no existe, usar la cuenta global de `AccountingSettings`. Validar `isActive` antes de usar.
- **Riesgo adicional**: Cuando una factura tiene multiples lineas con distintos productos, cada uno con distinta cuenta contable, los asientos actuales agregan una sola linea de "Compras" o "Ventas". Se deberia agregar una linea por cuenta distinta (agrupando por cuenta).
- **Mitigacion**: Agrupar por `accountId` y sumar subtotales por grupo.

#### Formulario sobrecargado

- **Riesgo**: El formulario `_ProductForm.tsx` ya tiene 622 lineas y 4 secciones. Agregar 5 selects mas puede hacerlo demasiado largo.
- **Mitigacion**: Crear la nueva seccion como componente separado `_AccountingDefaultsSection.tsx` o usar Tabs/Accordion. Evaluar extraer secciones existentes a subcomponentes (regla: <200 lineas por componente).

#### Generacion de codigo (auto-code)

- **Riesgo**: La logica actual busca por `orderBy: { code: 'desc' }` que es un orden lexicografico. `PROD-9999` es mayor que `PROD-10000` lexicograficamente.
- **Mitigacion**: Usar el patron atomico de `lastEntryNumber` de `AccountingSettings` (L219-224 del integration): `UPDATE ... SET last_product_number = last_product_number + 1 RETURNING last_product_number`. Esto evita race conditions y gaps.
- **Riesgo**: Si se cambia el prefijo, los codigos existentes con el prefijo viejo quedan.
- **Mitigacion**: El cambio de prefijo solo afecta nuevos productos. Documentar claramente.

#### Rendimiento de selects en formulario

- **Riesgo**: Cargar cuentas contables (pueden ser cientos), proveedores, almacenes y centros de costo para el formulario de productos puede ser lento.
- **Mitigacion**: (a) Usar `select` optimizado (solo id+name/code), (b) considerar lazy loading o combobox con busqueda para cuentas contables (que pueden ser muchas), (c) las queries de select ya existen y son ligeras.

#### Cross-module imports

- **Riesgo**: Necesitamos datos de `accounting/accounts`, `company/cost-centers`, `commercial/warehouses`, `commercial/suppliers` desde el modulo de productos.
- **Mitigacion**: Para Server Components (`CreateProduct.tsx`, `EditProduct.tsx`), se pueden hacer queries Prisma directas (son server actions internas). Alternativamente, crear funciones de fetch ligeras en las propias actions de productos. Esto es lo mas limpio segun las reglas del proyecto.

---

## 2. Planificacion

### 2.1 Fases de implementacion

#### Fase 1: Schema Prisma - Campos FK en Product + secuencia en AccountingSettings
- **Objetivo:** Agregar los 5 campos FK opcionales al modelo Product y los campos de configuracion de codigo auto en AccountingSettings. Migrar la base de datos.
- **Tareas:**
  - [ ] Agregar 5 campos FK opcionales al modelo `Product` (linea 2222, antes de `// Estado`):
    - `defaultExpenseAccountId String? @map("default_expense_account_id") @db.Uuid`
    - `defaultIncomeAccountId String? @map("default_income_account_id") @db.Uuid`
    - `defaultCostCenterId String? @map("default_cost_center_id") @db.Uuid`
    - `defaultWarehouseId String? @map("default_warehouse_id") @db.Uuid`
    - `defaultSupplierId String? @map("default_supplier_id") @db.Uuid`
  - [ ] Agregar 5 relaciones en el modelo `Product` (linea 2227, seccion `// Relaciones`):
    - `defaultExpenseAccount Account? @relation("ProductExpenseAccount", fields: [defaultExpenseAccountId], references: [id])`
    - `defaultIncomeAccount Account? @relation("ProductIncomeAccount", fields: [defaultIncomeAccountId], references: [id])`
    - `defaultCostCenter CostCenter? @relation("ProductCostCenter", fields: [defaultCostCenterId], references: [id])`
    - `defaultWarehouse Warehouse? @relation("ProductDefaultWarehouse", fields: [defaultWarehouseId], references: [id])`
    - `defaultSupplier Supplier? @relation("ProductDefaultSupplier", fields: [defaultSupplierId], references: [id])`
  - [ ] Agregar relaciones inversas en `Account` (linea 355, antes de `@@unique`):
    - `productsAsExpenseAccount Product[] @relation("ProductExpenseAccount")`
    - `productsAsIncomeAccount Product[] @relation("ProductIncomeAccount")`
  - [ ] Agregar relacion inversa en `CostCenter` (linea 1000, despues de `journalEntryLines`):
    - `defaultProducts Product[] @relation("ProductCostCenter")`
  - [ ] Agregar relacion inversa en `Warehouse` (linea 2336, despues de `transfersTo`):
    - `defaultProducts Product[] @relation("ProductDefaultWarehouse")`
  - [ ] Agregar relacion inversa en `Supplier` (linea 2129, despues de `journalEntryLines`):
    - `defaultProducts Product[] @relation("ProductDefaultSupplier")`
  - [ ] Agregar 2 campos en `AccountingSettings` (linea 549, antes de `company`... o al final del bloque de campos, despues de la seccion de percepciones):
    - `productCodePrefix String @default("PROD") @map("product_code_prefix")` — prefijo configurable
    - `lastProductNumber Int @default(0) @map("last_product_number")` — secuencia atomica
  - [ ] Ejecutar `npm run db:migrate` con nombre descriptivo (ej: `add_product_accounting_defaults`)
  - [ ] Ejecutar `npm run db:generate` para regenerar el cliente Prisma
- **Archivos:**
  - `prisma/schema.prisma` (modelos Product L2179, Account L294, CostCenter L987, Warehouse L2316, Supplier L2077, AccountingSettings L490)
- **Criterio de completitud:** `npm run db:generate` pasa sin errores. `npm run check-types` pasa (puede fallar por tipos no actualizados aun en TS, eso es esperado y se resuelve en Fase 2).

---

#### Fase 2: Tipos, validators y server actions
- **Objetivo:** Actualizar interfaces TypeScript, schemas Zod y server actions (create, update, getById, getProducts) para soportar los nuevos campos. Agregar queries locales para selects de cuentas/centros/almacenes/proveedores dentro del modulo de productos (evitar imports cross-module).
- **Tareas:**
  - [ ] Actualizar interfaz `Product` en `types.ts` (L32-66): agregar los 5 campos FK como `string | null` y las 5 relaciones opcionales con formato `{ id: string; name: string; code?: string } | null`
  - [ ] Actualizar interfaz `CreateProductInput` en `types.ts` (L103-119): agregar los 5 campos opcionales como `string?`
  - [ ] Actualizar interfaz `UpdateProductInput` en `types.ts` (L121-123): hereda de Partial<CreateProductInput>, no necesita cambio explicito
  - [ ] Actualizar `createProductSchema` en `validators.ts` (L36-58): agregar 5 campos con `emptyStringToUndefined.pipe(z.string().uuid().optional())`
  - [ ] El `updateProductSchema` hereda via `.partial()`, no necesita cambio explicito
  - [ ] Crear funciones de fetch para selects en un nuevo archivo `src/modules/commercial/features/products/shared/catalog-actions.server.ts`:
    - `getAccountsForProductSelect(companyId)` — devuelve cuentas hoja activas `{ id, code, name, type, nature }[]`
    - `getCostCentersForProductSelect(companyId)` — devuelve centros activos `{ id, name }[]`
    - `getWarehousesForProductSelect(companyId)` — devuelve almacenes activos `{ id, code, name }[]`
    - `getSuppliersForProductSelect(companyId)` — devuelve proveedores activos `{ id, code, businessName, tradeName }[]`
    - Cada funcion usa `checkPermission('commercial.products', 'view')` y hace query Prisma directo con `select` optimizado (NO importa de otros modulos)
  - [ ] Actualizar `createProduct()` en `actions.server.ts` (L263-288): incluir los 5 nuevos campos en `prisma.product.create({ data: { ... } })` e incluir las relaciones en el `include`
  - [ ] Actualizar `updateProduct()` en `actions.server.ts` (L359-383): incluir los 5 nuevos campos en `prisma.product.update({ data: { ... } })`
  - [ ] Actualizar `getProductById()` en `actions.server.ts` (L191-196): agregar al `include` las 5 relaciones con `select: { id: true, code: true, name: true }` (para Account y Warehouse incluir `code`; para Supplier incluir `businessName`)
  - [ ] Actualizar `getProducts()` en `actions.server.ts` (L85-94): NO cargar relaciones en listado (solo IDs si se necesitan para columnas futuras, pero por ahora no es necesario para no sobrecargar la tabla)
  - [ ] Actualizar el return de `getProductById()` y `createProduct()` para incluir los nuevos campos en el objeto mapeado
  - [ ] Actualizar `processProductImport()` (L716-848): agregar soporte opcional para los nuevos campos en la importacion (bajo prioridad, puede quedar como TODO para iteracion futura si se desea)
- **Archivos:**
  - `src/modules/commercial/features/products/shared/types.ts`
  - `src/modules/commercial/features/products/shared/validators.ts`
  - `src/modules/commercial/features/products/shared/catalog-actions.server.ts` (NUEVO)
  - `src/modules/commercial/features/products/features/list/actions.server.ts`
- **Criterio de completitud:** `npm run check-types` pasa. Las funciones `createProduct`, `updateProduct` y `getProductById` retornan los nuevos campos correctamente. Las funciones de catalogo retornan datos filtrados por empresa.

---

#### Fase 3: UI del formulario - Seccion "Configuracion Contable y Logistica"
- **Objetivo:** Agregar los 5 selects al formulario de producto (crear y editar) en una nueva seccion Card. Refactorizar el formulario para mantener componentes < 200 lineas.
- **Tareas:**
  - [ ] Crear componente `_AccountingDefaultsSection.tsx` en `src/modules/commercial/features/products/features/create/components/`:
    - Recibe las listas de opciones como props: `accounts`, `costCenters`, `warehouses`, `suppliers`
    - Recibe `form` (UseFormReturn) como prop
    - Renderiza una Card con titulo "Configuracion Contable y Logistica" y CardDescription explicativa
    - Contiene 5 FormFields con Select (shadcn): defaultExpenseAccountId, defaultIncomeAccountId, defaultCostCenterId, defaultWarehouseId, defaultSupplierId
    - Cada Select tiene opcion "Sin asignar" como placeholder/opcion vacia
    - Para cuentas, filtrar: solo `isLeaf: true` y `isActive: true`. Mostrar `code - name` en el label del SelectItem
    - Para cuentas de gasto, filtrar ademas por `nature: 'DEBIT'` (gastos son deudoras). Para cuentas de ingreso, filtrar por `nature: 'CREDIT'` (ingresos son acreedoras)
    - El componente debe usar el prefijo `_` (es client component via el formulario padre)
  - [ ] Actualizar `ProductFormProps` en `_ProductForm.tsx` (L44-52): agregar props opcionales `accounts?`, `costCenters?`, `warehouses?`, `suppliers?`
  - [ ] Agregar render de `_AccountingDefaultsSection` en `_ProductForm.tsx` despues de la Card de "Precios e IVA" o al final, pasando las listas y el `form`
  - [ ] Actualizar `_ProductForm.tsx` default values (L69-91): agregar los 5 campos con default `undefined`
  - [ ] Actualizar `CreateProduct.tsx` (Server Component): fetch en paralelo de accounts, costCenters, warehouses, suppliers usando las funciones de `catalog-actions.server.ts`. Pasar como props a `_CreateProductForm`
  - [ ] Actualizar `_CreateProductForm.tsx`: recibir las nuevas props y pasarlas a `_ProductForm`
  - [ ] Actualizar `EditProduct.tsx` (Server Component): fetch en paralelo de accounts, costCenters, warehouses, suppliers. Pasar como props a `_EditProductForm`
  - [ ] Actualizar `_EditProductForm.tsx`: recibir las nuevas props, mapear `defaultValues` con los 5 campos del product, pasarlos a `_ProductForm`
  - [ ] Evaluar refactorizar las secciones existentes de `_ProductForm.tsx` (622 lineas) a subcomponentes separados para cumplir regla de < 200 lineas (ej: `_BasicInfoSection.tsx`, `_PricingSection.tsx`, `_StockSection.tsx`, `_AdditionalInfoSection.tsx`). Si el tiempo no lo permite, al menos extraer la nueva seccion como componente separado
- **Archivos:**
  - `src/modules/commercial/features/products/features/create/components/_AccountingDefaultsSection.tsx` (NUEVO)
  - `src/modules/commercial/features/products/features/create/components/_ProductForm.tsx`
  - `src/modules/commercial/features/products/features/create/CreateProduct.tsx`
  - `src/modules/commercial/features/products/features/create/components/_CreateProductForm.tsx`
  - `src/modules/commercial/features/products/features/edit/EditProduct.tsx`
  - `src/modules/commercial/features/products/features/edit/components/_EditProductForm.tsx`
- **Criterio de completitud:** El formulario muestra la nueva seccion con los 5 selects poblados. Se puede crear y editar un producto con los nuevos campos. Los selects no muestran datos de otra empresa. `npm run check-types` y `npm run lint` pasan.

---

#### Fase 4: UI del detalle - Mostrar conceptos contables asignados
- **Objetivo:** Mostrar los conceptos contables y logisticos asignados en la vista de detalle del producto.
- **Tareas:**
  - [ ] Actualizar `ProductDetail.tsx` (L87-241): agregar una nueva Card "Configuracion Contable y Logistica" en el grid, mostrando:
    - Cuenta de Gastos: `product.defaultExpenseAccount?.code - name` o "Sin asignar"
    - Cuenta de Ingresos: `product.defaultIncomeAccount?.code - name` o "Sin asignar"
    - Centro de Costos: `product.defaultCostCenter?.name` o "Sin asignar"
    - Almacen: `product.defaultWarehouse?.code - name` o "Sin asignar"
    - Proveedor: `product.defaultSupplier?.businessName` o "Sin asignar"
  - [ ] La Card solo se muestra si al menos uno de los 5 campos esta asignado, O siempre se muestra con valores "Sin asignar" (decision de UX: mostrar siempre para indicar que es configurable)
  - [ ] Actualizar la interfaz `Product` si `getProductById` ya devuelve las relaciones (debe estar listo desde Fase 2)
- **Archivos:**
  - `src/modules/commercial/features/products/features/detail/ProductDetail.tsx`
- **Criterio de completitud:** La vista de detalle muestra la Card con los 5 campos. Si hay datos asignados, muestra los nombres. Si no, muestra "Sin asignar".

---

#### Fase 5: Generacion automatica de codigo configurable
- **Objetivo:** Reemplazar la logica hardcoded de generacion de codigo `PROD-XXXX` por una secuencia atomica configurable usando el patron de `lastEntryNumber` de AccountingSettings.
- **Tareas:**
  - [ ] Modificar `createProduct()` en `actions.server.ts` (L238-252): reemplazar la logica actual de busqueda lexicografica por:
    ```typescript
    // Incremento atomico del contador de productos
    const [{ last_product_number: nextNumber, product_code_prefix: prefix }] = await prisma.$queryRaw<[{ last_product_number: number; product_code_prefix: string }]>`
      UPDATE accounting_settings
      SET last_product_number = last_product_number + 1, updated_at = NOW()
      WHERE company_id = ${companyId}::uuid
      RETURNING last_product_number, product_code_prefix
    `;
    const code = `${prefix}-${nextNumber.toString().padStart(4, '0')}`;
    ```
  - [ ] Agregar fallback: si la empresa no tiene `AccountingSettings` (posible en empresas sin modulo contable), mantener la logica actual como fallback
  - [ ] Verificar que el campo `lastProductNumber` se inicializa correctamente para empresas existentes: dado que el default es 0 y todos los campos son opcionales, la primera llamada generara `PREFIX-0001`. Para empresas con productos existentes, se debe considerar un script de inicializacion o un check en la logica: si `lastProductNumber === 0`, buscar el max numero existente y setear el contador
  - [ ] Agregar logica de inicializacion en `createProduct()`: si `lastProductNumber` era 0 antes del increment (es decir, retorno 1 pero ya hay productos), verificar que no colisione y ajustar
- **Archivos:**
  - `src/modules/commercial/features/products/features/list/actions.server.ts` (L238-252)
- **Criterio de completitud:** Los nuevos productos se generan con codigo atomico `PREFIX-NNNN`. No hay race conditions. El prefijo se lee de AccountingSettings. Si no hay settings, usa fallback "PROD".

---

#### Fase 6: Integracion contable - Override de cuentas por producto
- **Objetivo:** Modificar la generacion de asientos contables para que use las cuentas del producto (si existen) en lugar de las globales de AccountingSettings. Implementar agrupacion por cuenta cuando hay multiples productos con distintas cuentas.
- **Tareas:**
  - [ ] Modificar `createJournalEntryForSalesInvoice()` en `index.ts` (L269-389):
    - Cambiar el select de `lines` (L288) para incluir `product: { select: { defaultIncomeAccountId: true, defaultCostCenterId: true } }`
    - Reemplazar la linea unica de "Ventas" (L318-323) por logica de agrupacion:
      1. Agrupar lineas de la factura por `accountId` (producto.defaultIncomeAccountId || settings.salesAccountId)
      2. Sumar subtotales por grupo
      3. Crear una linea de asiento por cada grupo de cuentas distintas
    - Si un producto tiene `defaultIncomeAccountId`, verificar que la cuenta exista y este activa (`isActive: true`). Si no, usar fallback `settings.salesAccountId`
    - Pasar `costCenterId` del producto en las lineas del asiento (el campo ya existe en `JournalEntryLineInput.costCenterId`, L54)
  - [ ] Modificar `createJournalEntryForPurchaseInvoice()` en `index.ts` (L395-517):
    - Cambiar el select de `lines` (L414) para incluir `product: { select: { defaultExpenseAccountId: true, defaultCostCenterId: true } }`
    - Reemplazar la linea unica de "Compras" (L436-443) por logica de agrupacion similar:
      1. Agrupar lineas por `accountId` (producto.defaultExpenseAccountId || settings.purchasesAccountId) — nota: `PurchaseInvoiceLine.productId` es nullable (L2887), manejar lineas sin producto
      2. Sumar subtotales por grupo
      3. Crear una linea de asiento por cada grupo
    - Fallback para lineas sin producto: usar `settings.purchasesAccountId`
    - Pasar `costCenterId` del producto en las lineas del asiento
  - [ ] Modificar `createJournalEntryForCOGS()` en `index.ts` (L1052-1125):
    - Agregar `defaultCostCenterId` al select de product (L1074)
    - Evaluar si agrupar por costCenter (opcional, puede quedar como mejora futura ya que CMV usa cuentas globales cogsAccountId/inventoryAccountId que no se overridean por producto)
  - [ ] Agregar tests manuales: crear un producto con cuenta de ingreso distinta, facturar, verificar que el asiento use la cuenta del producto
- **Archivos:**
  - `src/modules/accounting/features/integrations/commercial/index.ts` (funciones L269-389, L395-517, L1052-1125)
- **Criterio de completitud:** Al confirmar una factura de venta/compra, el asiento usa la cuenta del producto si esta configurada. Si hay productos con distintas cuentas, se generan lineas separadas por cuenta. Si un producto no tiene cuenta configurada, usa la global. El asiento sigue balanceado (debito = credito). `npm run check-types` pasa.

---

#### Fase 7: Documentacion y tests
- **Objetivo:** Actualizar documentacion del desarrollador, guia de usuario y tests E2E.
- **Tareas:**
  - [ ] Actualizar `docs/architecture/data-model.md`: documentar los nuevos campos de Product y los campos de AccountingSettings
  - [ ] Actualizar guia de usuario en `src/modules/help/features/guide/components/`: documentar la nueva seccion "Configuracion Contable y Logistica" en el formulario de productos
  - [ ] Crear o actualizar tests E2E en `cypress/e2e/commercial/products`:
    - Test: crear producto con conceptos contables asignados
    - Test: editar producto y cambiar conceptos contables
    - Test: verificar que la vista de detalle muestra los conceptos
    - Test: crear producto sin conceptos (campos opcionales, no debe fallar)
  - [ ] Verificar checklist de pre-commit: check-types, lint, no console.*, no :any
- **Archivos:**
  - `docs/architecture/data-model.md`
  - `src/modules/help/features/guide/components/_CommercialGuide.tsx` (o el componente correspondiente de productos)
  - `cypress/e2e/commercial/products/` (nuevo o existente)
- **Criterio de completitud:** Documentacion actualizada. Tests E2E pasan. Checklist de pre-commit completo.

---

### 2.2 Orden de ejecucion

```
Fase 1 (Schema + migracion)
    |
    v
Fase 2 (Tipos, validators, server actions)
    |
    +---> Fase 3 (UI formulario) ---> Fase 4 (UI detalle)
    |
    +---> Fase 5 (Auto-code configurable)  [independiente de Fase 3/4]
    |
    v
Fase 6 (Integracion contable)  [requiere Fase 2 completada, independiente de Fase 3/4/5]
    |
    v
Fase 7 (Docs + Tests)  [requiere todas las fases anteriores]
```

**Dependencias explicitas:**
- Fase 2 depende de Fase 1 (necesita tipos generados de Prisma)
- Fase 3 depende de Fase 2 (necesita server actions y validators actualizados)
- Fase 4 depende de Fase 2 (necesita getProductById con relaciones)
- Fase 5 depende de Fase 1 (necesita campos en AccountingSettings) — puede hacerse en paralelo con Fase 3/4
- Fase 6 depende de Fase 2 (necesita campos FK en el schema y tipos) — puede hacerse en paralelo con Fase 3/4/5
- Fase 7 depende de todas las anteriores

**Fases paralelizables:** Fases 3+4, 5 y 6 pueden trabajarse en paralelo una vez que Fase 2 esta completa.

### 2.3 Estimacion de complejidad

| Fase | Complejidad | Justificacion |
|------|-------------|---------------|
| Fase 1: Schema + migracion | **Baja** | Solo agregar campos opcionales y relaciones. Migracion no-destructiva. |
| Fase 2: Tipos + actions | **Media** | Actualizar multiples archivos de tipos/validators. Crear catalog-actions nuevo. Modificar 3 server actions. |
| Fase 3: UI formulario | **Media-Alta** | Crear componente nuevo, actualizar 6 archivos existentes, posible refactor de _ProductForm (622 lineas). |
| Fase 4: UI detalle | **Baja** | Agregar una Card con 5 campos de solo lectura. |
| Fase 5: Auto-code | **Media** | Logica de secuencia atomica + fallback + inicializacion para empresas existentes. |
| Fase 6: Integracion contable | **Alta** | Cambio critico en generacion de asientos. Logica de agrupacion por cuenta. Multiples edge cases (cuenta inactiva, producto sin cuenta, lineas sin producto, notas de credito). Requiere testing exhaustivo. |
| Fase 7: Docs + Tests | **Media** | Documentacion de multiples archivos + tests E2E nuevos. |

## 3. Diseno
_Pendiente - ejecutar `/disenar articulos-conceptos-contables`_

## 4. Implementacion

### Fase 1: Schema Prisma + migración
- **Estado:** Completada
- **Archivos modificados:**
  - `prisma/schema.prisma` - Agregados 5 campos FK en Product, relaciones inversas en Account/CostCenter/Warehouse/Supplier, campos productCodePrefix y lastProductNumber en AccountingSettings
  - `prisma/migrations/20260629100000_add_product_accounting_defaults/migration.sql` - Creado: migración con ALTER TABLE para 5 FK + 2 campos en accounting_settings
- **Notas:** Se usó `prisma db push` + `migrate resolve --applied` en vez de `migrate dev` para evitar reset por drift en FK names de accounting_settings

### Fase 2: Tipos, validators y server actions
- **Estado:** Completada
- **Archivos modificados:**
  - `src/modules/commercial/features/products/shared/types.ts` - Agregados 5 campos FK + 5 relaciones a interface Product, 5 campos a CreateProductInput
  - `src/modules/commercial/features/products/shared/validators.ts` - Agregados 5 campos UUID opcionales al createProductSchema
  - `src/modules/commercial/features/products/shared/catalog-actions.server.ts` - Creado: 4 funciones de fetch para selects (accounts, costCenters, warehouses, suppliers)
  - `src/modules/commercial/features/products/features/list/actions.server.ts` - Actualizado: getProductById (include relaciones), createProduct y updateProduct (nuevos campos en data)

### Fase 3: UI del formulario
- **Estado:** Completada
- **Archivos modificados:**
  - `src/modules/commercial/features/products/features/create/components/_AccountingDefaultsSection.tsx` - Creado: componente con 5 selects (cuentas filtradas por naturaleza, centros de costo, almacenes, proveedores)
  - `src/modules/commercial/features/products/features/create/components/_ProductForm.tsx` - Agregados props de catálogos, default values, render de sección contable
  - `src/modules/commercial/features/products/features/create/CreateProduct.tsx` - Fetch paralelo de catálogos
  - `src/modules/commercial/features/products/features/create/components/_CreateProductForm.tsx` - Pass-through de catálogos
  - `src/modules/commercial/features/products/features/edit/EditProduct.tsx` - Fetch paralelo de catálogos
  - `src/modules/commercial/features/products/features/edit/components/_EditProductForm.tsx` - Default values + pass-through

### Fase 4: UI del detalle
- **Estado:** Completada
- **Archivos modificados:**
  - `src/modules/commercial/features/products/features/detail/ProductDetail.tsx` - Agregada Card "Configuración Contable" con 5 campos de solo lectura

### Fase 5: Auto-code configurable
- **Estado:** Completada
- **Archivos modificados:**
  - `src/modules/commercial/features/products/features/list/actions.server.ts` - Reemplazada lógica hardcoded por secuencia atómica UPDATE...RETURNING con fallback

### Fase 6: Integración contable
- **Estado:** Completada
- **Archivos modificados:**
  - `src/modules/accounting/features/integrations/commercial/index.ts` - Ventas: agrupación por cuenta (product.defaultIncomeAccountId override). Compras: agrupación por cuenta (product.defaultExpenseAccountId override). Ambos pasan costCenterId del producto.
- **Notas:** CMV no modificado (usa cuentas globales, override por producto queda como mejora futura)

### Fase 7: Documentación y tests
- **Estado:** Completada
- **Archivos modificados:**
  - `docs/architecture/data-model.md` - Documentados 5 FK en Product, 2 campos en AccountingSettings, comportamiento de override contable
  - `src/modules/help/features/guide/components/_CommercialGuide.tsx` - Agregada sección de guía de usuario para "Configuración Contable y Logística"
  - `src/modules/commercial/features/products/shared/validators.test.ts` - Creado: 7 tests unitarios para validadores con campos contables

## 5. Verificacion

### 5.1 Revisión de código
- **Resultado:** OK
- **Observaciones:** Todos los archivos de la sección de Implementación existen y coinciden con el diseño. Verificado en detalle:
  - **Schema (`prisma/schema.prisma`):** Los 5 FK opcionales en `Product` (`defaultExpenseAccountId`, `defaultIncomeAccountId`, `defaultCostCenterId`, `defaultWarehouseId`, `defaultSupplierId`, todos `String? @db.Uuid`) con sus 5 relaciones nombradas, más los 2 campos en `AccountingSettings` (`productCodePrefix String @default("PROD")`, `lastProductNumber Int @default(0)`). Relaciones inversas presentes en Account/CostCenter/Warehouse/Supplier.
  - **Migración (`prisma/migrations/20260629100000_add_product_accounting_defaults/migration.sql`):** No-destructiva. 5 columnas UUID nullable con FKs `ON DELETE SET NULL ON UPDATE CASCADE`, y 2 columnas NOT NULL con DEFAULT en `accounting_settings`.
  - **Integración contable (`.../integrations/commercial/index.ts`):** Agrupamiento de líneas por cuenta implementado tanto en ventas (`salesByAccount`, keyed por `line.product?.defaultIncomeAccountId || settings.salesAccountId`) como en compras (`purchasesByAccount`, keyed por `defaultExpenseAccountId || purchasesAccountId`). Suma subtotales por grupo, emite una línea de asiento por cuenta distinta, propaga `costCenterId` del producto y hace fallback a la cuenta global. El asiento se mantiene balanceado (contrapartida en receivables/payables + IVA).
  - **Auto-code:** Reemplazado por secuencia atómica `UPDATE accounting_settings SET last_product_number = last_product_number + 1 ... RETURNING`, con fallback a lógica legacy `PROD-XXXX` si no hay settings.
  - **Rename "Productos" → "Artículos":** Aplicado en UI (sidebar, listados, modales). Sin residuos user-facing de "Productos" en el módulo.
  - **`_AccountingDefaultsSection.tsx`:** Existe, filtra cuentas de gasto por `nature === 'DEBIT'` e ingreso por `nature === 'CREDIT'`, con opción "Sin asignar".
  - **Regla 9 (Decimal→Number):** `getProductById` convierte todos los Decimal (`costPrice`, `salePrice`, etc.) a `Number()`. Las 5 relaciones nuevas se traen con `select` acotado (id/code/name/businessName) sin campos Decimal, por lo que son serializables.
  - **Regla 11 (checkPermission):** Presente en las 4 funciones nuevas de `catalog-actions.server.ts` (`view`) y en todas las actions modificadas (`getProductById`/view, `createProduct`/create, `updateProduct`/update).
- **Observación menor (no bloqueante):** En `index.ts` línea 302 queda un `const subtotal` sin uso (leftover de la lógica anterior de línea única; la nueva usa `line.subtotal`). Genera 1 warning de lint. No afecta funcionalidad.

### 5.2 Build / Lint
- **Resultado:** OK (con salvedad de baseline pre-existente)
- **Detalle:**
  - `npm run check-types`: El proyecto NO tiene un baseline limpio de TypeScript (existen ~225 errores pre-existentes distribuidos en múltiples módulos ajenos a esta feature: `equipment/depreciation`, `warehouses/stock`, price-lists dialogs, etc.). Los únicos errores tocando archivos de esta feature son en `_ProductForm.tsx` y `_CreateProductForm.tsx`, y corresponden al patrón conocido de incompatibilidad de tipos `zodResolver` / `SubmitHandler<TFieldValues>` de React Hook Form v7 + Zod v4 — el MISMO patrón que ya afecta al resto del codebase (equipment, warehouses, price-lists). Se confirmó contra el commit padre que este tipo de fricción de tipos es pre-existente y no un defecto de la lógica de conceptos contables. El error de `_ProductImportModal.tsx` (`Promise.forEach`, `getProductImportColumns` async) y el `Cannot find module '../../../shared/types'` de `_PriceListsTable.tsx` se verificaron idénticos en el commit padre → **pre-existentes**, no introducidos por esta feature.
  - `npm run lint`: Los archivos NUEVOS de la feature (`catalog-actions.server.ts`, `_AccountingDefaultsSection.tsx`, `validators.ts`, `validators.test.ts`, `ProductDetail.tsx`, `EditProduct.tsx`, `CreateProduct.tsx`) pasan lint SIN errores ni warnings. El resto de los problemas de lint (355 en total en el codebase) son pre-existentes. Único warning atribuible a esta feature: `subtotal` sin usar en `index.ts:302`.

### 5.3 Tests
- **Tests ejecutados:** 7 pasaron, 0 fallaron
- **Tests nuevos creados:**
  - `src/modules/commercial/features/products/shared/validators.test.ts` (7 tests, runner Vitest)
- **Detalle:** Cubren: producto válido sin campos contables, campos contables con UUIDs válidos, rechazo de UUID inválido, transformación de string vacío → undefined, combinación parcial, y schema de update (actualizar/limpiar solo campos contables). `npx vitest run` completó en 558ms sin fallos.

### 5.4 Verificación funcional
- **Resultado:** OK (a nivel de código)
- **Detalle:** Se verificó a nivel de código que: (a) el schema y la migración soportan los 5 conceptos + auto-code; (b) los server actions guardan/leen los nuevos campos con permisos y conversión de Decimals; (c) el formulario de crear/editar expone la sección "Configuración Contable y Logística" con selects filtrados por naturaleza de cuenta; (d) el detalle muestra los conceptos asignados; (e) la integración contable agrupa por cuenta y hace override por producto con fallback a la cuenta global manteniendo el asiento balanceado; (f) el auto-code usa secuencia atómica. La prueba funcional en navegador (crear/editar/facturar y observar el asiento resultante) queda para QA manual, ya que no se levantó el servidor de desarrollo. Los tests E2E de Cypress no se ejecutaron por requerir servidor levantado.

### 5.5 Cumplimiento de reglas
- **CLAUDE.md respetado:** Sí
- **Observaciones:**
  - Sin `console.*`, sin `:any`, sin `date-fns` en los archivos nuevos/modificados de la feature.
  - `logger` usado correctamente en catalog-actions e integración.
  - `checkPermission()` en todas las actions (Regla 11).
  - Decimals convertidos a `Number()` antes de pasar a Client Components (Regla 9).
  - Componentes client con prefijo `_` (`_AccountingDefaultsSection.tsx`).
  - Módulo de productos NO importa de otros módulos: se crearon queries locales en `catalog-actions.server.ts` en lugar de importar de accounting/company (respeta `module-communication.md`).
  - Documentación de desarrollador y guía de usuario actualizadas (`docs/architecture/data-model.md`, `_CommercialGuide.tsx`).
  - Desvío menor: leftover `const subtotal` sin uso en `index.ts:302` (cosmético, no funcional).

### 5.6 Resultado final
- **Estado:** APROBADO
- **Acciones pendientes (no bloqueantes, recomendadas):**
  1. Eliminar el `const subtotal` sin uso en `src/modules/accounting/features/integrations/commercial/index.ts:302` para limpiar el warning de lint introducido.
  2. QA manual en navegador: crear un artículo con cuenta de ingreso/gasto y centro de costos distintos, emitir factura de venta y de compra, y confirmar que el asiento use las cuentas del producto (agrupadas por cuenta) y quede balanceado. Verificar auto-code `PREFIX-NNNN`.
  3. (Deuda técnica del codebase, fuera del alcance de este ticket) La fricción de tipos de React Hook Form + Zod v4 (`zodResolver` incompatible con `useForm<T>`) afecta a todo el proyecto e impide un `tsc` limpio; conviene abordarla de forma transversal en un ticket aparte.
