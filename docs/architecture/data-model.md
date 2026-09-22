# Modelo de Datos

Referencia: `prisma/schema.prisma`

Regenerar tipos: `npm run db:generate`

---

## Modelos por Dominio

### Geografia

| Modelo | Descripcion | Campos clave |
|--------|-------------|--------------|
| `Country` | Paises | name, code (ISO 3166-1) |
| `Province` | Provincias | name |
| `City` | Ciudades | name, provinceId |

Relacion: Country ← Province ← City (jerarquica)

---

### Core (Empresas y Acceso)

| Modelo | Descripcion | Campos clave |
|--------|-------------|--------------|
| `Company` | Empresa (tenant) | name, slug, taxId, taxStatus, isSingleCompany |
| `CompanyMember` | Miembro de empresa | companyId, userId, isActive, isOwner, roleId |
| `CompanyInvitation` | Invitacion pendiente | email, companyId, roleId, token, expiresAt |
| `UserPreference` | Preferencias de usuario | userId, activeCompanyId |

**Relaciones clave:**
- Company 1←N CompanyMember (usuarios en la empresa)
- CompanyMember N→1 CompanyRole (cada miembro tiene un rol)
- UserPreference almacena la empresa activa del usuario

---

### RBAC (Permisos)

| Modelo | Descripcion | Campos clave |
|--------|-------------|--------------|
| `Route` | Rutas del sistema | path, module |
| `Action` | Acciones (view/create/update/delete) | slug |
| `CompanyRole` | Rol personalizado | name, slug, companyId, isSystem |
| `CompanyRolePermission` | Permiso de un rol | roleId, module, action |
| `CompanyMemberPermission` | Override individual | memberId, module, action, isGranted |
| `PermissionAuditLog` | Log de auditoria | action, details, performedBy |

**Jerarquia de permisos:**
```
CompanyRole
  └── CompanyRolePermission (permisos base del rol)

CompanyMember
  └── CompanyMemberPermission (overrides: isGranted true/false)
```

Resolucion: Owner/Developer → acceso total. Otros → rol base + overrides individuales.

---

### Empleados

| Modelo | Descripcion | Campos clave |
|--------|-------------|--------------|
| `Employee` | Empleado | firstName, lastName, dni, status, hireDate, contractType, jobPosition, union, etc. |

**Enums de Employee:**
- `EmployeeStatus`: ACTIVE, INACTIVE, TERMINATED, ON_LEAVE, SUSPENDED
- `Gender`: MALE, FEMALE, OTHER
- `MaritalStatus`: SINGLE, MARRIED, DIVORCED, WIDOWED
- `TerminationReason`: RESIGNATION, DISMISSAL, RETIREMENT, etc.

---

### Equipamiento

| Modelo | Descripcion | Campos clave |
|--------|-------------|--------------|
| `Vehicle` | Vehiculo/equipo | plate, brand, model, year, status, condition, titularityType, vehicleTypeId. Sin cuentas contables propias: van en `VehicleType` (por tipo) y `VehicleDepreciation` (override), TSK-724c |

**Enums:**
- `VehicleStatus`: ACTIVE, INACTIVE, MAINTENANCE, RETIRED
- `VehicleCondition`: EXCELLENT, GOOD, FAIR, POOR
- `VehicleTitularityType`: OWN, LEASED, THIRD_PARTY

### Depreciacion de Equipos

| Modelo | Descripcion | Campos clave |
|--------|-------------|--------------|
| `VehicleDepreciation` | Config depreciacion | vehicleId, method, grossValue, salvageValue, usefulLifeMonths, status, **fixedAssetAccountId?, accumulatedDepreciationAccountId?, depreciationExpenseAccountId?** (override de las cuentas del tipo/por defecto, FK `SetNull`, TSK-724c) |
| `DepreciationScheduleEntry` | Periodo del schedule | depreciationId, periodNumber, scheduledDate, amount, accumulatedAmount, bookValueAfter, journalEntryId? |
| `AssetValueAdjustment` | Ajuste de valor | vehicleId, date, previousValue, newValue, reason, journalEntryId? |

**Enums:**
- `DepreciationMethod`: STRAIGHT_LINE, DECLINING_BALANCE
- `DepreciationStatus`: ACTIVE, COMPLETED, SUSPENDED

**Relaciones clave:**
- Vehicle 1→1 VehicleDepreciation (config de depreciacion)
- VehicleDepreciation 1←N DepreciationScheduleEntry (periodos del schedule)
- Vehicle 1←N AssetValueAdjustment (historial de ajustes)
- DepreciationScheduleEntry N→1 JournalEntry (asiento contable al contabilizar)
- AssetValueAdjustment N→1 JournalEntry (asiento del ajuste; desde TSK-724c siempre se genera)
- VehicleDepreciation N→1 Account ×3 (`DepreciationFixedAssetAccount`, `DepreciationAccumulatedDepreciationAccount`, `DepreciationDepreciationExpenseAccount`; inversas en `Account`, TSK-724c)
- VehicleType N→1 Account ×3 (`VehicleTypeFixedAssetAccount`, `VehicleTypeAccumulatedDepreciationAccount`, `VehicleTypeDepreciationExpenseAccount`, TSK-724c)

**Resolucion de cuentas de Bienes de Uso** (helper puro `equipment/shared/asset-accounts.ts`): para cada
una de las tres cuentas, `VehicleDepreciation` → `VehicleType` → `AccountingSettings` (por defecto). La
cuenta de resultado por venta/baja sigue solo en `AccountingSettings`. Migracion
`20260919121736_tsk_724c_asset_accounts_by_type`: 6 columnas nullable, 6 indices, 6 FK `ON DELETE SET
NULL`, sin backfill (los asientos historicos quedan en las cuentas con las que se generaron).

---

### Documentos

| Modelo | Descripcion |
|--------|-------------|
| `DocumentType` | Tipo de documento (aplica a employee/equipment/company) |
| `EmployeeDocument` | Documento de empleado |
| `EmployeeDocumentHistory` | Historial de versiones |
| `EquipmentDocument` | Documento de equipo |
| `EquipmentDocumentHistory` | Historial de versiones |
| `CompanyDocument` | Documento de empresa |

**Filtros de DocumentType** (modelos pivote):
- `DocumentTypeJobPosition`, `DocumentTypeContractType`, `DocumentTypeJobCategory`
- `DocumentTypeUnion`, `DocumentTypeCollectiveAgreement`
- `DocumentTypeVehicleBrand`, `DocumentTypeVehicleType`

**Enums:**
- `DocumentAppliesTo`: EMPLOYEE, EQUIPMENT, COMPANY
- `DocumentState`: PENDING, APPROVED, REJECTED, EXPIRED

---

### Catalogos RRHH

| Modelo | Descripcion |
|--------|-------------|
| `ContractType` | Tipos de contrato |
| `JobPosition` | Puestos de trabajo |
| `Union` | Sindicatos |
| `CollectiveAgreement` | Convenios colectivos |
| `JobCategory` | Categorias laborales (→ CollectiveAgreement) |
| `CostCenter` | Centros de costo |
| `Sector` | Sectores |
| `TypeOperative` | Tipos operativos |

### Catalogos de Equipos

| Modelo | Descripcion |
|--------|-------------|
| `VehicleBrand` | Marcas (→ VehicleModel) |
| `VehicleModel` | Modelos de vehiculo |
| `VehicleType` | Tipos de equipo + cuentas de Bienes de Uso del tipo (`fixedAssetAccountId?`, `accumulatedDepreciationAccountId?`, `depreciationExpenseAccountId?`, FK `SetNull`, TSK-724c) |
| `TypeOfVehicle` | Clasificaciones de vehiculo |
| `EquipmentOwner` | Titulares de equipo |
| `Contractor` | Contratistas |

---

### CRM (Comercial)

| Modelo | Descripcion | Campos clave |
|--------|-------------|--------------|
| `Lead` | Lead de ventas | name, email, status, source |
| `Contact` | Contacto | name, email, phone |
| `Quote` | Cotizacion | number, status, total |

---

### Productos

| Modelo | Descripcion | Campos clave |
|--------|-------------|--------------|
| `ProductCategory` | Categoria (arbol) | name, parentId (self-referential) |
| `Product` | Producto/servicio | name, code, barcode, type, salePrice, purchasePrice, trackStock, defaultExpenseAccountId?, defaultIncomeAccountId?, defaultCostCenterId?, defaultWarehouseId?, defaultSupplierId? |
| `Supplier` | Proveedor | businessName, taxId, taxCondition, status |
| `PriceList` | Lista de precios | name, isDefault |
| `PriceListItem` | Item de lista | priceListId, productId, price |

**Enums:**
- `ProductType`: PRODUCT, SERVICE
- `ProductStatus`: ACTIVE, INACTIVE
- `SupplierTaxCondition`: MONOTRIBUTISTA, RESPONSABLE_INSCRIPTO, EXENTO, CONSUMIDOR_FINAL, NO_RESPONSABLE
- `SupplierStatus`: ACTIVE, INACTIVE

**Indices de precios (TSK-621):**

| Modelo | Descripcion | Campos clave |
|--------|-------------|--------------|
| `PriceIndex` | Indice de precios (IPC, etc.), por empresa | name, description?, isActive, unique(companyId, name) |
| `PriceIndexValue` | Valor del indice para un periodo | indexId, period (fecha, dia 1 del mes), percentage (Decimal 6,3), unique(indexId, period) |
| `PriceListAdjustment` | Historial de aplicaciones de un indice a una lista | priceListId, indexId, indexValueId, percentage (Decimal 6,3, el efectivamente aplicado), itemsAffected, appliedAt, appliedBy |

- `percentage` admite negativos (un indice puede dar baja) y se guarda con 3 decimales; en
  TypeScript es `number`.
- `PriceListAdjustment.percentage` es redundante a proposito respecto de `PriceIndexValue`: si
  el valor del indice se corrige despues, el historial tiene que seguir diciendo que porcentaje
  se aplico realmente ese dia.
- **Calculo:** `price` nuevo = `price` actual x (1 + `percentage` / 100), redondeado a 2
  decimales. `priceWithTax` **se recalcula desde el `price` ya ajustado** con la alicuota de IVA
  del item (`price x (1 + vatRate / 100)`, tambien redondeado a 2 decimales) — no se le aplica el
  porcentaje del indice por separado, porque los dos caminos divergen por redondeo y
  desincronizan los campos. Logica pura en
  `modules/commercial/features/products/features/price-lists/shared/price-index-calc.ts`
  (`applyPercentage`, `adjustItem`, `adjustItems`), sin dependencias de Prisma.
- La aplicacion de un indice a una lista corre en una transaccion (todos los items o ninguno) y
  no tiene deshacer: revertir exigiria guardar el precio anterior de cada item y resolver que
  pasa si el precio actual ya cambio por otro motivo (edicion manual, otro indice aplicado
  encima). El historial (`PriceListAdjustment`) es lo que permite reconstruir que paso.
- Doble aplicacion del mismo indice y periodo a la misma lista: se detecta y se avisa, pero no
  se bloquea.

**Conceptos contables por producto (Product):**
- `defaultExpenseAccountId` → Account (tipos admitidos `EXPENSE` | `ASSET`, cuentas hoja, TSK-579). Es la cuenta de la linea en el asiento de compra; si es `null` cae en `purchasesAccountId` de AccountingSettings ("Cuenta de compras por defecto") y si tampoco hay, la confirmacion se rechaza nombrando la linea (TSK-721). Se valida imputable al confirmar: si esta dada de baja no hay fallback a la global.
- `defaultIncomeAccountId` → Account (tipos admitidos `REVENUE` | `ASSET`, cuentas hoja, TSK-579). Idem para ventas, con `salesAccountId` ("Cuenta de ventas por defecto") como respaldo; esa global puede ser `null` si todos los items de venta tienen la suya.
- `defaultCostCenterId` → CostCenter. Se asigna a las lineas del asiento contable del producto.
- `defaultWarehouseId` → Warehouse. Almacen predeterminado para operaciones del producto.
- `defaultSupplierId` → Supplier. Proveedor habitual del producto.

Cuando se confirma una factura (venta o compra), la integracion contable agrupa las lineas por cuenta contable: la cuenta del producto (`defaultIncomeAccountId` / `defaultExpenseAccountId`) manda; si no tiene, se usa la cuenta por defecto de AccountingSettings; si no hay ninguna, la factura **no se confirma** (`BusinessError` que nombra la linea; `commercial/shared/line-accounts.ts`, TSK-721). Las lineas de compra sin producto solo pueden usar `purchasesAccountId`.

---

### Almacenes y Stock

| Modelo | Descripcion | Campos clave |
|--------|-------------|--------------|
| `Warehouse` | Almacen | name, type, address |
| `WarehouseStock` | Stock por producto/almacen | warehouseId, productId, quantity |
| `StockMovement` | Movimiento de stock | type, quantity, productId, warehouseId |

**Enums:**
- `StockMovementType`: IN, OUT, ADJUSTMENT, TRANSFER_IN, TRANSFER_OUT, SALE, PURCHASE, RETURN

---

### Ventas

| Modelo | Descripcion | Campos clave |
|--------|-------------|--------------|
| `SalesPointOfSale` | Punto de venta | name, number |
| `SalesInvoice` | Factura de venta | voucherType, number, status, subtotal, taxAmount, total, clientId |
| `SalesInvoiceLine` | Linea de factura | productId, quantity, unitPrice, taxRate, total |
| `SalesInvoiceLineCostCenter` | Reparto de la linea entre centros de costo (TSK-583) | lineId, costCenterId, percentage (Decimal 5,2), unique(lineId, costCenterId) |
| `SalesInvoicePerception` | Percepcion del comprobante (TSK-644) | invoiceId, type (IVA/IIBB/MUNICIPAL), jurisdiction, rate (Decimal 6,3), baseAmount, amount |
| `SalesCreditNoteApplication` | Aplicacion de NC a factura | creditNoteId, invoiceId, amount |

**Enums:**
- `VoucherType`: FACTURA_A, FACTURA_B, FACTURA_C, NOTA_CREDITO_A/B/C, NOTA_DEBITO_A/B/C, RECIBO_X
- `SalesInvoiceStatus`: DRAFT, CONFIRMED, CANCELLED

**Flujo:** DRAFT → CONFIRMED (genera asiento contable, actualiza stock) → CANCELLED (reversa)

---

### Compras

| Modelo | Descripcion | Campos clave |
|--------|-------------|--------------|
| `PurchaseInvoice` | Factura de compra | voucherType, number, status, supplierId, internalTaxes, otherTaxes |
| `PurchaseInvoiceLine` | Linea de compra | productId, quantity, unitCost |
| `PurchaseInvoiceLineCostCenter` | Reparto de la linea entre centros de costo (TSK-583) | lineId, costCenterId, percentage (Decimal 5,2), unique(lineId, costCenterId) |
| `PurchaseInvoicePerception` | Percepcion del comprobante (TSK-644) | invoiceId, type (IVA/IIBB/MUNICIPAL), jurisdiction, rate (Decimal 6,3), baseAmount, amount |
| `PurchaseCreditNoteApplication` | Aplicacion de NC | creditNoteId, invoiceId, amount |

**Tributos del comprobante (TSK-644):** `SalesInvoice` y `PurchaseInvoice` comparten el mismo
esquema de tributos no-IVA:
- `otherTaxes` es un **agregado derivado**: `suma de percepciones + internalTaxes`. Es lo que
  AFIP entiende por "Otros Tributos" (incluye las percepciones), y es lo que la emision
  electronica informa como `ImpTrib`. Nunca se captura a mano: lo calcula el server action.
- `internalTaxes` guarda los impuestos internos discriminados, cargados como monto de cabecera.
- El desglose de percepciones vive en `*_invoice_perceptions`. `rate` se **deriva** de
  `amount / baseAmount` (no se le pide al usuario) y se persiste porque ARCA la exige en `alic`.
- `total = subtotal + vatAmount + otherTaxes`.
- Consecuencia para reportes: un consumidor **no puede** sumar `otherTaxes` y las percepciones
  a la vez sin contar dos veces. El Libro IVA informa las percepciones en su columna y
  `internalTaxes` (no `otherTaxes`) en la de impuestos internos.

**Enums:**
- `PurchaseInvoiceStatus`: DRAFT, CONFIRMED, CANCELLED

**Centro de costo por linea (TSK-583):** `PurchaseInvoiceLine.costCenterId` (columna unica) se
reemplazo por `PurchaseInvoiceLineCostCenter` / `SalesInvoiceLineCostCenter`, dos tablas
gemelas que permiten repartir el subtotal (neto) de una linea entre N centros por porcentaje.
Reglas:
- Un reparto **suma exactamente 100.00 o esta vacio** (`percentage` es `Decimal(5,2)`, `number`
  en TypeScript). Vacio cae en `Product.defaultCostCenterId` (comportamiento previo).
- Solo aplica a lineas cuyo item se imputa a una cuenta `REVENUE` o `EXPENSE`. Las cuentas
  patrimoniales (`ASSET`, `LIABILITY`, `EQUITY`) no admiten centro de costo: comprar/vender un
  activo no consume presupuesto de ningun centro.
- Solo se reparte el `subtotal` (neto). El IVA nunca se reparte: va siempre a la cuenta de IVA,
  que no es de resultado.
- **Prorrateo:** cada monto se redondea a 2 decimales y **el ultimo centro del reparto absorbe
  la diferencia**, para que la suma de las partes sea exacta y el asiento no descuadre (ej.
  33/33/34% sobre un monto no divisible exacto). Logica centralizada en
  `modules/commercial/shared/cost-center.ts` (`prorateAmount`, `expandByCostCenter`).
- La migracion copia el `costCenterId` existente como un reparto al 100% antes de eliminar la
  columna (`INSERT ... SELECT` + `DROP COLUMN`), sin perder datos de la entrega anterior.

---

### Ordenes de Compra

| Modelo | Descripcion | Campos clave |
|--------|-------------|--------------|
| `PurchaseOrder` | Orden de compra | number (OC-XXXXX), status, supplierId, issueDate, expectedDeliveryDate, subtotal, taxAmount, total, approvedById, rejectionReason |
| `PurchaseOrderLine` | Linea de orden | purchaseOrderId, productId, quantity, receivedQuantity, unitPrice, taxRate, taxAmount, total |
| `PurchaseOrderInstallment` | Cuota/entrega de OC | orderId, number, dueDate, amount, status, purchaseInvoiceId |

**Relaciones:**
- PurchaseOrder N→1 Supplier (proveedor)
- PurchaseOrder N→1 Company (empresa/tenant)
- PurchaseOrder 1←N PurchaseOrderLine (lineas de detalle)
- PurchaseOrder 1←N PurchaseOrderInstallment (cuotas)
- PurchaseOrderLine N→1 Product (producto)
- PurchaseOrderInstallment N→1 PurchaseInvoice (factura vinculada, opcional)

**Enums:**
- `PurchaseOrderStatus`: DRAFT, PENDING_APPROVAL, APPROVED, PARTIALLY_RECEIVED, COMPLETED, CANCELLED
- `PurchaseOrderInstallmentStatus`: PENDING, INVOICED, PAID

**Flujo:** DRAFT → PENDING_APPROVAL → APPROVED → PARTIALLY_RECEIVED → COMPLETED. Cancelacion posible desde cualquier estado excepto COMPLETED.

---

### Remitos de Recepcion

| Modelo | Descripcion | Campos clave |
|--------|-------------|--------------|
| `ReceivingNote` | Remito de recepcion | fullNumber (RR-XXXXX), status, supplierId, warehouseId, purchaseOrderId?, purchaseInvoiceId? |
| `ReceivingNoteLine` | Linea de remito | productId, quantity, purchaseOrderLineId? |

**Relaciones:**
- ReceivingNote N→1 Supplier (proveedor)
- ReceivingNote N→1 Warehouse (almacen destino)
- ReceivingNote N→1 PurchaseOrder (OC vinculada, opcional)
- ReceivingNote N→1 PurchaseInvoice (FC vinculada, opcional)
- ReceivingNote 1←N ReceivingNoteLine (lineas de detalle)
- ReceivingNoteLine N→1 Product (producto)
- ReceivingNoteLine N→1 PurchaseOrderLine (linea de OC, opcional)

**Enums:**
- `ReceivingNoteStatus`: DRAFT, CONFIRMED, CANCELLED

**Flujo:** DRAFT → CONFIRMED (actualiza stock, receivedQty) → CANCELLED (reversa stock, re-evalua OC)

---

### Tesoreria

| Modelo | Descripcion |
|--------|-------------|
| `BankAccount` | Cuenta bancaria (type, status, balance) |
| `BankMovement` | Movimiento bancario (type: DEBIT/CREDIT, amount) |
| `Receipt` | Recibo de cobro (clientId, status, total) |
| `ReceiptItem` | Facturas aplicadas al recibo |
| `ReceiptPayment` | Medios de pago del recibo |
| `ReceiptWithholding` | Retenciones del recibo |
| `PaymentOrder` | Orden de pago (supplierId, status, total) |
| `PaymentOrderItem` | Facturas aplicadas a la OP |
| `PaymentOrderPayment` | Medios de pago de la OP |
| `PaymentOrderWithholding` | Retenciones de la OP |
| `CashRegister` | Caja registradora |
| `CashRegisterSession` | Sesion de caja (apertura/cierre) |
| `CashMovement` | Movimiento de caja |
| `Partner` | Socio de la empresa (titular de tarjetas, cuenta corriente y cuenta de aportes) | name, taxId, isActive, contributionsAccountId → Account (TSK-717, relación `PartnerOwnContributionsAccount`, `onDelete: SetNull`) |
| `PartnerAccountMovement` | Cuenta corriente de tesorería del socio (OWED/REPAYMENT/ADJUSTMENT): lo que la empresa le debe por gastos pagados con su tarjeta personal. Sin relación con la contabilidad ni con los aportes | partnerId, type, amount |
| `FundMovement` | Movimiento de fondos (aporte/retiro de socio, transferencia entre cuentas, gastos e impuestos bancarios) | type, status, date, amount (total), fundOutKind/fundOutId/fundOutLabel, fundInKind/fundInId/fundInLabel, partnerId (obligatorio en aporte/retiro desde TSK-717, sin FK), partnerName, journalEntryId |
| `FundMovementLine` | Concepto de un movimiento de tipo BANK_CHARGES (TSK-585) | movementId, accountId, description, amount (Decimal 15,2), position |

**Enums:**
- `BankAccountType`: CHECKING, SAVINGS
- `BankMovementType`: DEBIT, CREDIT
- `PaymentMethod`: CASH, TRANSFER, CHECK, CREDIT_CARD, DEBIT_CARD, ECHEQ, OTHER
- `ReceiptStatus` / `PaymentOrderStatus`: DRAFT, CONFIRMED, CANCELLED
- `WithholdingTaxType`: IVA, GANANCIAS, IIBB, SUSS
- `FundMovementType`: PARTNER_CONTRIBUTION, PARTNER_WITHDRAWAL, ACCOUNT_TRANSFER, BANK_CHARGES (TSK-585)
- `FundMovementStatus`: DRAFT, CONFIRMED, CANCELLED

**Movimiento de fondos y sus conceptos (TSK-585):**
- `FundMovement` cubre movimientos de dinero que no son factura, cobro ni pago: aporte/retiro de
  socio, transferencia entre cuentas propias y, desde TSK-585, gastos e impuestos bancarios
  **sin IVA** (Sircreb, impuesto a los débitos y créditos, comisiones sin discriminar). El gasto
  bancario **con** IVA no pasa por acá: se carga como `PurchaseInvoice` con el banco como
  proveedor y el tipo de comprobante "Gastos Bancarios" (parte B del mismo ticket).
- `FundMovement.amount` guarda siempre el **total** del movimiento. Para `BANK_CHARGES` ese total
  no se tipea: se calcula en el servidor como la suma de `FundMovementLine.amount`, para que nunca
  quede desincronizado del desglose.
- Solo `BANK_CHARGES` usa `FundMovementLine` (al menos una); los otros tres tipos siguen sin
  líneas, exactamente igual que antes de TSK-585.
- Las cuentas de `FundMovementLine.accountId` deben ser imputables (hoja, activas) y de tipo
  `EXPENSE` o `ASSET` — igual criterio que las líneas de compra/venta desde TSK-579. `LIABILITY` y
  `EQUITY` quedan afuera: no son contrapartida de un débito bancario.
- `AccountingSettings.bankChargesAccountId` ("Gastos bancarios por defecto", TSK-718) es **solo
  preselección de UI**: el modal la propone como cuenta de cada concepto nuevo de `BANK_CHARGES`
  y el usuario puede cambiarla fila por fila. `FundMovementLine.accountId` sigue siendo NOT NULL y
  es lo que lee el asiento; la global no participa en `createJournalEntryForFundMovement`.
- **El asiento generado tiene N+1 líneas para `BANK_CHARGES`** (un débito por cada concepto, a su
  propia cuenta, más un crédito único al banco/caja de origen por el total), mientras que
  `PARTNER_CONTRIBUTION`, `PARTNER_WITHDRAWAL` y `ACCOUNT_TRANSFER` siguen generando su asiento de
  **2 líneas** de siempre. `createJournalEntryForFundMovement` se generalizó para aceptar N débitos
  contra un crédito sin cambiar el comportamiento de esos tres tipos existentes.

**Cuenta de aportes por socio (TSK-717):**
- `Partner.contributionsAccountId` (nullable, `@db.Uuid`, índice propio) apunta a la cuenta del
  plan a la que se imputan los aportes y retiros de ese socio. La relación se llama
  `PartnerOwnContributionsAccount` porque `AccountingSettings.partnerContributionsAccount` ya usa
  el nombre `PartnerContributionsAccount`. Inversa: `Account.partners Partner[]`.
- **Resolución de la cuenta de capital al confirmar** (`resolvePartnerCapitalAccount`, dentro de
  la transacción de `confirmFundMovement`):
  `partner.contributionsAccountId ?? settings.partnerContributionsAccountId`. En aporte la cuenta
  va al **Haber** (contra el banco/caja de destino en el Debe); en retiro va al **Debe** (contra
  el banco/caja de origen en el Haber).
- **Sin fallback si la cuenta propia no es imputable.** Si el socio tiene cuenta asignada pero
  esa cuenta ya no es hoja, está inactiva o tiene corte por ejercicio vigente
  (`buildImputableAccountsWhere`), la confirmación falla con un `BusinessError` que nombra al
  socio y a la cuenta. No cae a la global: sería imputar en silencio a otra cuenta, que es lo que
  motivó los tickets 413/706. Solo cae a la global cuando el socio **no tiene** cuenta propia; si
  tampoco hay global, error que nombra al socio y dice dónde configurarla.
- **Tipos admitidos**: la cuenta del socio puede ser `ASSET`, `LIABILITY` o `EQUITY` imputable
  (`PARTNER_CONTRIBUTION_ACCOUNT_TYPES` en `partners/shared/types.ts`, usada tanto por el combo del
  form como por la validación al confirmar). La global de `AccountingSettings` sigue siendo solo
  `EQUITY` y se renombró en la UI a "Cuenta de aportes de socios por defecto".
- **`onDelete: SetNull`**: mismo criterio que `BankAccount.account` y `CashRegister.account`. La baja
  de cuentas es soft delete (`isActive: false`), así que la FK casi nunca se dispara; el caso real
  (cuenta dada de baja pero todavía asignada) lo cubre la validación de imputabilidad al confirmar,
  y el combo del form preserva la cuenta guardada vía `includeIds` para que se vea qué tiene
  asignado el socio.
- **`FundMovement.partnerId` pasa a ser obligatorio** en `PARTNER_CONTRIBUTION` y
  `PARTNER_WITHDRAWAL` (regla en el `superRefine` del validator, mensaje "Seleccioná el socio").
  Sigue sin FK a `partners`; `deletePartner` bloquea el borrado de socios con movimientos de fondos
  (cualquier estado) y la confirmación valida que el socio exista. Un borrador anterior a TSK-717
  sin socio no se puede confirmar hasta editarlo.
- **El asiento sigue naciendo en `DRAFT`** (como el resto de las integraciones): el Mayor y el
  Balance solo suman `POSTED`, así que el desglose por socio aparece en los reportes recién cuando
  el asiento se registra desde Contabilidad → Asientos.
- Migración aditiva `20260918153728_tsk_717_partner_contributions_account`: `ADD COLUMN` +
  `CREATE INDEX` + FK. Sin backfill: los aportes ya confirmados con la global no se reasignan.

---

### Gastos

| Modelo | Descripcion |
|--------|-------------|
| `ExpenseCategory` | Categoria de gasto |
| `Expense` | Gasto (description, amount, date, status, supplierId?) |
| `ExpenseAttachment` | Adjunto de gasto |

**Enums:**
- `ExpenseStatus`: PENDING, PAID, CANCELLED

---

### Contabilidad

| Modelo | Descripcion | Campos clave |
|--------|-------------|--------------|
| `Account` | Cuenta contable (arbol) | code (formato x.x.x/xx/xx), name, type, nature, parentId, isLeaf, isActive, disabledFrom, disabledFromFiscalYearId |
| `JournalEntry` | Asiento contable | number, date, description, status, isAutomatic, reversedById |
| `JournalEntryLine` | Linea de asiento | accountId, debit, credit, description, y los auxiliares opcionales customerId?, supplierId?, costCenterId?. Indices: `@@index([costCenterId])` y `@@index([entryId])` (TSK-719) |
| `AccountingSettings` | Config contable | salesAccountId, purchasesAccountId (cuentas de ventas/compras **por defecto**: solo para lineas cuyo item no tiene cuenta propia, TSK-721), bankChargesAccountId? (gastos bancarios por defecto, FK SetNull, TSK-718), vatAccountId, fixedAssetAccountId, accumulatedDepreciationAccountId, depreciationExpenseAccountId (cuentas de Bienes de Uso **por defecto**: respaldo de `VehicleDepreciation` → `VehicleType`, TSK-724c), assetDisposalGainLossAccountId (resultado por venta/baja, unica), lockedUntilDate, productCodePrefix (default "PROD"), lastProductNumber (default 0), requireCostCenter (Boolean, default false, TSK-583), etc. |
| `RecurringEntry` | Asiento recurrente | frequency, nextExecution, templateLines |
| `RecurringEntryLine` | Linea de asiento recurrente | accountId, debitAmount, creditAmount |

**Enums:**
- `AccountType`: ASSET, LIABILITY, EQUITY, INCOME, EXPENSE
- `AccountNature`: DEBIT, CREDIT
- `JournalEntryStatus`: DRAFT, POSTED, REVERSED
- `RecurringFrequency`: DAILY, WEEKLY, MONTHLY, QUARTERLY, YEARLY

**Indices de `journal_entry_lines` (TSK-719):** la tabla que mas crece del modulo tenia **solo la PK**. Se agregaron dos indices aditivos (migracion `20260922112920_tsk_719_journal_entry_lines_indexes`, dos `CREATE INDEX`, sin backfill):
- `@@index([costCenterId])` — sin el, filtrar lineas por centro de costo (informe de Movimientos por Centro de Costo y el `EXISTS` del selector de centros con historia) es un seq scan sobre todas las lineas de la base.
- `@@index([entryId])` — la FK a `JournalEntry` es `onDelete: Cascade` y **no tenia indice**: cada borrado de asiento (reversiones, borrado de borradores) obligaba a escanear la tabla hija entera. Ademas es el join de `include: { lines: true }` que usan Libro Diario, Libro Mayor, Estado de Resultados y Variacion Presupuestaria.
- `@@index([accountId])` se dejo **afuera** a proposito: ninguna consulta filtra lineas por cuenta en SQL (el Mayor filtra en memoria) y las cuentas se dan de baja de forma logica. Cada indice se paga en cada escritura de asiento.

**Cuentas imputables vs. de sumatoria (TSK-376):**
- `isLeaf = true` → cuenta **imputable** (hoja): recibe movimientos de asientos y tiene saldo propio. Se mantiene automáticamente: una cuenta pasa a `isLeaf = false` al adquirir hijas.
- `isLeaf = false` → cuenta **de sumatoria**: agrupa a sus hijas; su saldo se calcula por roll-up (suma de las imputables descendientes). No es imputable.
- Solo las imputables aparecen en los selects de imputación (asientos, movimientos bancarios, config contable, artículos, saldos de apertura), vía el filtro compartido `buildImputableAccountsWhere` en `src/shared/lib/accounts/`.
- El `code` sigue el formato `x.x.x/xx/xx` (segmentos vacíos = 0, primer segmento ≠ 0); se valida/normaliza con `validateAccountCodeFormat`.

**Deshabilitación por ejercicio (TSK-376):**
- `disabledFrom` (fecha de corte) + `disabledFromFiscalYearId` (FK a `FiscalYear`): la cuenta queda vigente mientras `!disabledFrom || fiscalYearStart < disabledFrom`.
- Regla: saldo 0 → corte en el ejercicio en curso; con saldo → corte en el próximo ejercicio; deshabilitar una cuenta de sumatoria cascadea a sus hijas.
- `isActive = false` es la baja global inmediata (distinta de la baja programada por ejercicio).

**Relaciones clave:**
- Account es self-referential (parentId → arbol jerarquico)
- Account.disabledFromFiscalYear → FiscalYear (ejercicio desde el que rige la baja)
- JournalEntry puede ser automatico (generado por comercial) o manual
- JournalEntry puede ser reversado (reversedById → otro entry)
- AccountingSettings mapea cuentas contables a funciones (ventas, compras, IVA, bancos, etc.)
- `productCodePrefix` + `lastProductNumber`: generacion automatica de codigos de producto. Al crear un producto se ejecuta un `UPDATE...SET last_product_number = last_product_number + 1 RETURNING` atomico y se genera el codigo `{prefix}-{number:04d}`.
- Saldos de Apertura: implementado como JournalEntry (description='Asiento de Apertura', status=POSTED) sin modelo nuevo. Facturas de apertura se identifican por internalNotes='opening-balance' y journalEntryId=null.

### Presupuestos

| Modelo | Descripcion | Campos clave |
|--------|-------------|--------------|
| `Budget` | Presupuesto por cuenta y ano fiscal | companyId, accountId, fiscalYear, status, monthlyAmounts (Json, number[12]), totalAmount (Decimal 12,2), notes, createdBy |
| `BudgetRevision` | Revision formal de presupuesto | budgetId, previousAmounts (Json), newAmounts (Json), previousTotal (Decimal 12,2), newTotal (Decimal 12,2), reason, createdBy |

**Enums:**
- `BudgetStatus`: DRAFT, ACTIVE, CLOSED

**Relaciones clave:**
- Budget N→1 Company (empresa/tenant, onDelete Cascade)
- Budget N→1 Account (cuenta contable)
- Budget 1←N BudgetRevision (historial de revisiones, onDelete Cascade)

**Constraints:**
- `Budget @@unique([companyId, accountId, fiscalYear])`: un solo presupuesto por cuenta y ano fiscal
- `monthlyAmounts` almacena un array Json de 12 numeros alineados al inicio del ejercicio fiscal (indice 0 = primer mes fiscal)
- Solo cuentas hoja (sin hijos) de tipo EXPENSE o REVENUE pueden tener presupuesto

---
