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
| `Vehicle` | Vehiculo/equipo | plate, brand, model, year, status, condition, titularityType |

**Enums:**
- `VehicleStatus`: ACTIVE, INACTIVE, MAINTENANCE, RETIRED
- `VehicleCondition`: EXCELLENT, GOOD, FAIR, POOR
- `VehicleTitularityType`: OWN, LEASED, THIRD_PARTY

### Depreciacion de Equipos

| Modelo | Descripcion | Campos clave |
|--------|-------------|--------------|
| `VehicleDepreciation` | Config depreciacion | vehicleId, method, grossValue, salvageValue, usefulLifeMonths, status |
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
- AssetValueAdjustment N→1 JournalEntry (asiento del ajuste, opcional)

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
| `VehicleType` | Tipos de vehiculo |
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

**Conceptos contables por producto (Product):**
- `defaultExpenseAccountId` → Account (naturaleza DEBIT, cuentas hoja). Sobrescribe `purchasesAccountId` de AccountingSettings al generar asientos de compra.
- `defaultIncomeAccountId` → Account (naturaleza CREDIT, cuentas hoja). Sobrescribe `salesAccountId` de AccountingSettings al generar asientos de venta.
- `defaultCostCenterId` → CostCenter. Se asigna a las lineas del asiento contable del producto.
- `defaultWarehouseId` → Warehouse. Almacen predeterminado para operaciones del producto.
- `defaultSupplierId` → Supplier. Proveedor habitual del producto.

Cuando se confirma una factura (venta o compra), la integracion contable agrupa las lineas por cuenta contable: si un producto tiene override (defaultIncomeAccountId o defaultExpenseAccountId), se usa ese; sino, se usa la cuenta global de AccountingSettings.

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
| `SalesCreditNoteApplication` | Aplicacion de NC a factura | creditNoteId, invoiceId, amount |

**Enums:**
- `VoucherType`: FACTURA_A, FACTURA_B, FACTURA_C, NOTA_CREDITO_A/B/C, NOTA_DEBITO_A/B/C, RECIBO_X
- `SalesInvoiceStatus`: DRAFT, CONFIRMED, CANCELLED

**Flujo:** DRAFT → CONFIRMED (genera asiento contable, actualiza stock) → CANCELLED (reversa)

---

### Compras

| Modelo | Descripcion | Campos clave |
|--------|-------------|--------------|
| `PurchaseInvoice` | Factura de compra | voucherType, number, status, supplierId |
| `PurchaseInvoiceLine` | Linea de compra | productId, quantity, unitPrice |
| `PurchaseCreditNoteApplication` | Aplicacion de NC | creditNoteId, invoiceId, amount |

**Enums:**
- `PurchaseInvoiceStatus`: DRAFT, CONFIRMED, CANCELLED

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

**Enums:**
- `BankAccountType`: CHECKING, SAVINGS
- `BankMovementType`: DEBIT, CREDIT
- `PaymentMethod`: CASH, TRANSFER, CHECK, CREDIT_CARD, DEBIT_CARD, ECHEQ, OTHER
- `ReceiptStatus` / `PaymentOrderStatus`: DRAFT, CONFIRMED, CANCELLED
- `WithholdingTaxType`: IVA, GANANCIAS, IIBB, SUSS

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
| `JournalEntryLine` | Linea de asiento | accountId, debit, credit, description |
| `AccountingSettings` | Config contable | salesAccountId, purchasesAccountId, vatAccountId, fixedAssetAccountId, depreciationExpenseAccountId, lockedUntilDate, productCodePrefix (default "PROD"), lastProductNumber (default 0), etc. |
| `RecurringEntry` | Asiento recurrente | frequency, nextExecution, templateLines |
| `RecurringEntryLine` | Linea de asiento recurrente | accountId, debitAmount, creditAmount |

**Enums:**
- `AccountType`: ASSET, LIABILITY, EQUITY, INCOME, EXPENSE
- `AccountNature`: DEBIT, CREDIT
- `JournalEntryStatus`: DRAFT, POSTED, REVERSED
- `RecurringFrequency`: DAILY, WEEKLY, MONTHLY, QUARTERLY, YEARLY

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
