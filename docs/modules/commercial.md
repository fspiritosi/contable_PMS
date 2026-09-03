# Módulo Commercial - Documentación Completa

**Rutas:** `/dashboard/commercial/*`
**Archivos:** `src/modules/commercial/`

El módulo más extenso. Cubre el ciclo completo de ventas (order-to-cash) y compras (procure-to-pay) con cumplimiento fiscal argentino (AFIP).

---

## Índice

1. [Sub-módulos y Estructura](#sub-módulos)
2. [Modelo de Datos](#modelo-de-datos)
3. [Ciclo de Vida de Entidades](#ciclo-de-vida-de-entidades)
4. [Flujos de Negocio](#flujos-de-negocio)
5. [Efectos Secundarios por Entidad](#efectos-secundarios-por-entidad)
6. [Impacto en Stock](#impacto-en-stock)
7. [Cuenta Corriente (Cliente / Proveedor)](#cuenta-corriente)
8. [Compensación Automática de NC](#compensación-automática-de-nc)
9. [Integración Contable](#integración-contable)
10. [Retenciones](#retenciones)
11. [Reglas de Validación](#reglas-de-validación)
12. [Tabla Resumen de Efectos](#tabla-resumen-de-efectos)
13. [Archivos Clave](#archivos-clave)

---

## Sub-módulos

### CRM

| Feature | Ruta | Descripción |
|---------|------|-------------|
| Clientes | `/company/commercial/clients` | CRUD, cuenta corriente |
| Leads | `/company/commercial/leads` | Pipeline de ventas |
| Contactos | `/company/commercial/contacts` | Directorio de contactos |
| Cotizaciones | `/company/commercial/quotes` | Presupuestos |

### Productos

| Feature | Ruta | Descripción |
|---------|------|-------------|
| Productos | `/commercial/products` | CRUD, tipo PRODUCT/SERVICE/COMBO, barcode |
| Categorías | `/commercial/categories` | Árbol jerárquico (parentId) |
| Listas de Precios | `/commercial/price-lists` | Precios por producto, lista default |

### Proveedores

| Feature | Ruta | Descripción |
|---------|------|-------------|
| Proveedores | `/commercial/suppliers` | CRUD con condición fiscal, cuenta corriente |

### Estructura de Carpetas

```
commercial/
├── clients/                        # Gestión de clientes
│   ├── list/                       # Listado + formulario
│   └── detail/                     # Detalle + Cuenta Corriente
│
├── suppliers/                      # Gestión de proveedores
│   └── features/
│       ├── list/                   # Listado + formulario
│       ├── detail/                 # Detalle + Cuenta Corriente
│       └── shared/
│
├── products/                       # Catálogo de productos
│   └── features/
│       ├── list/ | create/ | detail/ | edit/
│       ├── categories/             # Categorías (rubros)
│       ├── price-lists/            # Listas de precios
│       ├── search/                 # Búsqueda global
│       └── shared/
│
├── purchases/                      # Módulo de Compras
│   └── features/
│       ├── purchase-orders/        # Órdenes de Compra (OC)
│       ├── receiving-notes/        # Remitos de Recepción
│       ├── invoices/               # Facturas de Compra
│       └── reports/                # Reportes de compras
│
├── sales/                          # Módulo de Ventas
│   └── features/
│       ├── invoices/               # Facturas de Venta
│       ├── points-of-sale/         # Puntos de Venta AFIP
│       └── reports/                # Reportes de ventas
│
├── treasury/                       # Tesorería
│   └── features/
│       ├── receipts/               # Recibos de Cobro
│       ├── payment-orders/         # Órdenes de Pago
│       ├── bank-accounts/          # Cuentas Bancarias
│       ├── bank-movements/         # Movimientos Bancarios
│       ├── cash-registers/         # Cajas Registradoras
│       ├── sessions/               # Sesiones de Caja
│       ├── movements/              # Movimientos de Caja
│       ├── checks/                 # Cheques
│       ├── cashflow/               # Análisis de Cashflow
│       └── cashflow-projections/   # Proyecciones de Flujo
│
├── warehouses/                     # Inventario
│   └── features/
│       ├── list/                   # Depósitos CRUD
│       ├── stock/                  # Stock por depósito/producto
│       ├── movements/              # Ajustes y Transferencias
│       └── shared/
│
├── expenses/                       # Gastos
├── leads/                          # Leads comerciales
├── quotes/                         # Presupuestos
├── contacts/                       # Contactos
└── overview/                       # Dashboard comercial
```

---

## Modelo de Datos

### Flujo de Compras

```
PurchaseOrder (OC)
│  status: DRAFT → PENDING_APPROVAL → APPROVED → PARTIALLY_RECEIVED → COMPLETED / CANCELLED
│  invoicingStatus: NOT_INVOICED → PARTIALLY_INVOICED → FULLY_INVOICED
│
├── PurchaseOrderLine[]
│   ├── quantity          # Cantidad pedida
│   ├── receivedQty       # Cantidad recibida (via Remitos)
│   └── invoicedQty       # Cantidad facturada (via Facturas)
│
├── PurchaseOrderInstallment[]   # Cuotas de pago (opcional)
│   └── purchaseInvoiceId        # Link a factura que cubre la cuota
│
├── ReceivingNote[]              # Remitos (1 OC → N Remitos)
│   ├── purchaseOrderId
│   ├── purchaseInvoiceId?       # Link opcional a factura
│   └── ReceivingNoteLine[]
│       └── purchaseOrderLineId  # Link a línea de OC
│
└── PurchaseInvoice[]            # Facturas (1 OC → N Facturas)
    ├── purchaseOrderId?         # Link opcional a OC
    ├── PurchaseInvoiceLine[]
    │   └── purchaseOrderLineId? # Link a línea de OC
    └── status: DRAFT → CONFIRMED → PAID / PARTIAL_PAID / CANCELLED
```

### Flujo de Ventas

```
SalesInvoice (FC)
│  status: DRAFT → CONFIRMED → PAID / PARTIAL_PAID / CANCELLED
│  voucherType: FACTURA_A/B/C, NOTA_CREDITO_A/B/C, NOTA_DEBITO_A/B/C
│
├── SalesInvoiceLine[]
├── pointOfSaleId           # Punto de Venta AFIP
├── customerId
├── originalInvoiceId?      # Para NC/ND: factura original
│
├── ReceiptItem[]           # Pagos recibidos
│   ├── amount
│   └── receiptId
│
└── SalesCreditNoteApplication[]  # NC aplicadas
    ├── creditNoteId
    └── amount
```

### Tesorería - Recibos de Cobro

```
Receipt (Recibo)
│  status: DRAFT → CONFIRMED
│  customerId
│
├── ReceiptItem[]               # Facturas que se pagan
│   ├── invoiceId (SalesInvoice)
│   └── amount
│
├── ReceiptPayment[]            # Medios de pago
│   ├── paymentMethod: CASH / TRANSFER / CHECK / CARD
│   ├── cashRegisterId?         # Si paga en efectivo
│   ├── bankAccountId?          # Si paga por transferencia
│   └── amount
│
├── ReceiptWithholding[]        # Retenciones sufridas
│   ├── taxType: GANANCIAS / IVA / IIBB / SUSS
│   ├── rate
│   └── amount
│
└── journalEntryId              # Asiento contable generado
```

### Tesorería - Órdenes de Pago

```
PaymentOrder (OP)
│  status: DRAFT → CONFIRMED
│  supplierId?
│
├── PaymentOrderItem[]          # Facturas/Gastos que se pagan
│   ├── invoiceId? (PurchaseInvoice)
│   ├── expenseId?
│   └── amount
│
├── PaymentOrderPayment[]       # Medios de pago
│   ├── paymentMethod: CASH / TRANSFER / CHECK / CARD
│   ├── cashRegisterId?
│   ├── bankAccountId?
│   └── amount
│
├── PaymentOrderWithholding[]   # Retenciones emitidas
│   ├── taxType
│   ├── rate
│   └── amount
│
└── journalEntryId
```

### Bancos

```
BankAccount
├── balance: Decimal            # Saldo actual
├── status: ACTIVE / INACTIVE
├── accountId?                  # Cuenta contable vinculada
│
└── BankMovement[]
    ├── type: DEPOSIT / WITHDRAWAL / TRANSFER_IN / TRANSFER_OUT
    │         CHECK / DEBIT / FEE / INTEREST
    ├── amount
    ├── reconciled: Boolean
    ├── receiptId?              # Link a Recibo
    └── paymentOrderId?         # Link a OP
```

### Cajas

```
CashRegister
├── code, name, location
├── isDefault: Boolean
│
└── CashRegisterSession[]
    ├── status: OPEN / CLOSED
    ├── openingBalance
    ├── expectedBalance         # Calculado por movimientos
    ├── actualBalance           # Conteo físico al cerrar
    ├── difference              # actualBalance - expectedBalance
    │
    └── CashMovement[]
        ├── type: OPENING / INCOME / EXPENSE / CLOSING / ADJUSTMENT
        ├── amount
        └── reference           # Número de Recibo/OP
```

### Inventario

```
Warehouse
├── type: MAIN / SECONDARY / TRANSIT
│
└── WarehouseStock[]
    ├── productId
    ├── quantity                 # Stock actual
    ├── reservedQty             # Reservado
    └── availableQty = quantity - reservedQty

StockMovement
├── type: PURCHASE / SALE / RETURN / ADJUSTMENT
│         TRANSFER_IN / TRANSFER_OUT / LOSS
├── quantity                    # Con signo: + entrada, - salida
├── referenceType               # purchase_invoice, sale_invoice, etc.
└── referenceId
```

---

## Ciclo de Vida de Entidades

### Orden de Compra (PurchaseOrder)

```
DRAFT ──→ PENDING_APPROVAL ──→ APPROVED ──→ PARTIALLY_RECEIVED ──→ COMPLETED
  │            │                   │
  │            ↓                   │
  │         DRAFT (reject)         │
  │                                │
  ↓            ↓                   ↓
CANCELLED ←────────────────────────

invoicingStatus (independiente del status de recepción):
NOT_INVOICED → PARTIALLY_INVOICED → FULLY_INVOICED
```

**Transiciones manuales:**
- `submitForApproval()`: DRAFT → PENDING_APPROVAL
- `approvePurchaseOrder()`: PENDING_APPROVAL → APPROVED (setea `approvedBy`, `approvedAt`)
- `rejectPurchaseOrder()`: PENDING_APPROVAL → DRAFT
- `cancelPurchaseOrder()`: Cualquier estado (excepto CANCELLED/COMPLETED) → CANCELLED
- `deletePurchaseOrder()`: Solo si DRAFT

**Transiciones automáticas (por Remitos):**
- APPROVED → PARTIALLY_RECEIVED (cuando se confirma un remito parcial)
- PARTIALLY_RECEIVED → COMPLETED (cuando todo fue recibido: receivedQty >= quantity en todas las líneas)

**Transiciones automáticas (por Facturas):**
- NOT_INVOICED → PARTIALLY_INVOICED (cuando se confirma primera factura vinculada)
- PARTIALLY_INVOICED → FULLY_INVOICED (cuando invoicedQty >= quantity en todas las líneas)

### Remito de Recepción (ReceivingNote)

```
DRAFT ──→ CONFIRMED ──→ CANCELLED (revierte stock)
```

### Factura de Compra (PurchaseInvoice)

```
DRAFT ──→ CONFIRMED ──→ PAID
              │             ↑
              │         PARTIAL_PAID
              │
              ↓
         CANCELLED (solo si no PAID/PARTIAL_PAID, revierte stock + invoicedQty)
```

### Factura de Venta (SalesInvoice)

```
DRAFT ──→ CONFIRMED ──→ PAID
              │             ↑
              │         PARTIAL_PAID
              │
              ↓
         CANCELLED (solo si no PAID/PARTIAL_PAID, revierte stock)
```

### Percepciones e Impuestos Internos (TSK-644)

Facturas de compra y de venta pueden registrar tributos no-IVA que el comprobante discrimina:

| Concepto | Dónde vive | Notas |
|----------|-----------|-------|
| Percepciones | `*_invoice_perceptions` (N filas) | `type` IVA/IIBB/MUNICIPAL, `jurisdiction`, `baseAmount`, `amount`. La `rate` se **deriva** de monto/base, no se pide al usuario |
| Impuestos internos | `internalTaxes` (cabecera) | Monto único, cargado a mano |
| Agregado | `otherTaxes` (cabecera) | **Calculado**: percepciones + impuestos internos. Nunca se captura |

`total = subtotal + vatAmount + otherTaxes`.

**Por qué `otherTaxes` incluye las percepciones:** es la definición de AFIP para "Otros
Tributos", y es lo que la emisión electrónica informa como `ImpTrib` — AFIP valida
`ImpTrib == Σ Tributos.Importe`, así que percepciones e impuestos internos deben viajar juntos
en ese array y en ese total. Es también la semántica que ya usaba la importación de comprobantes
recibidos (`otrosTributos`).

**Cuidado al consumir:** sumar `otherTaxes` y las percepciones a la vez cuenta doble. El Libro
IVA informa las percepciones en su columna y `internalTaxes` (no `otherTaxes`) en la de
impuestos internos; el Libro IVA Digital llena los campos específicos del diseño de registro y
deja `otrosTributos` en cero.

Helpers compartidos: `@/modules/commercial/shared/perceptions` (`calculateOtherTaxes`,
`derivePerceptionRate`, `toPerceptionRecords`, `perceptionLabel`,
`findMissingTributeAccounts`). El formulario y el server action usan los mismos, así que el
total que ve el usuario mientras carga y el que se persiste no pueden divergir.

Componente de carga: `@/modules/commercial/shared/components/_PerceptionsField`, montado tanto
en `_PurchaseInvoiceForm` como en `_InvoiceForm`.

### Tipos de Comprobante (VoucherType)

| Tipo | Uso |
|------|-----|
| FACTURA_A | RI a RI |
| FACTURA_B | RI a MT/EX/CF |
| FACTURA_C | MT a cualquiera |
| NOTA_CREDITO_A/B/C | Nota de crédito (devolución/ajuste) |
| NOTA_DEBITO_A/B/C | Nota de débito (recargo) |
| RECIBO | Consumidor Final/MT |

### Matriz AFIP

| Emisor (empresa) | Receptor | Comprobantes permitidos |
|-------------------|----------|------------------------|
| RESPONSABLE_INSCRIPTO | RESPONSABLE_INSCRIPTO | FA, NC_A, ND_A |
| RESPONSABLE_INSCRIPTO | MT/EX/CF | FB, NC_B, ND_B |
| MONOTRIBUTISTA | Cualquiera | FC, NC_C, ND_C, RECIBO |
| EXENTO | Cualquiera | FB, NC_B, ND_B |

### Recibo / Orden de Pago

```
DRAFT ──→ CONFIRMED (no se cancela)
```

### Gasto (Expense)

```
PENDING ──→ PAID / PARTIAL_PAID (via OP) ──→ CANCELLED
```

---

## Flujos de Negocio

### Flujo Completo de Compra

```
1. Crear OC (DRAFT)
   ↓
2. Enviar a Aprobación → PENDING_APPROVAL
   ↓
3. Aprobar → APPROVED
   ↓
4a. Crear Remito de Recepción → Confirmar
    ├── Stock: +cantidad en depósito destino
    ├── OC.status: PARTIALLY_RECEIVED / COMPLETED
    └── OC.lines[].receivedQty: +cantidad
   ↓
4b. Crear Factura de Compra (linkeada a OC) → Confirmar
    ├── Stock: +cantidad (SOLO si no hay remitos confirmados)
    ├── OC.invoicingStatus: PARTIALLY_INVOICED / FULLY_INVOICED
    ├── OC.lines[].invoicedQty: +cantidad
    └── Asiento Contable: creado
   ↓
5. Crear Orden de Pago → Confirmar
   ├── Factura.status: PAID / PARTIAL_PAID
   ├── BankMovement / CashMovement: creado
   └── Asiento Contable: creado
```

### Flujo Completo de Venta

```
1. Crear Factura de Venta (DRAFT)
   ↓
2. Confirmar Factura
   ├── Stock: -cantidad (descontado del depósito principal)
   └── Asiento Contable: creado
   ↓
3. Crear Recibo de Cobro → Confirmar
   ├── Factura.status: PAID / PARTIAL_PAID
   ├── BankMovement / CashMovement: creado
   └── Asiento Contable: creado
```

### Flujo de Nota de Crédito

```
1. Crear NC (DRAFT) — puede linkear a factura original vía originalInvoiceId
   ↓
2. Confirmar NC
   ├── Stock: RESTAURADO (ventas: +qty / compras: -qty)
   ├── Asiento Contable: creado
   └── Auto-compensación: NC se aplica contra facturas pendientes (FIFO)
       ├── Factura.status → PARTIAL_PAID / PAID
       └── NC.status → PARTIAL_PAID / PAID
```

### Facturación Parcial de OC

```
OC con 3 líneas:
  Línea A: qty=100, invoicedQty=0
  Línea B: qty=50,  invoicedQty=0
  Línea C: qty=200, invoicedQty=0

→ Factura #1 (parcial): Línea A: 60, Línea B: 50
  OC.invoicingStatus = PARTIALLY_INVOICED
  Línea A: invoicedQty=60 (pendiente: 40)
  Línea B: invoicedQty=50 (completada)

→ Factura #2 (resto): Línea A: 40, Línea C: 200
  OC.invoicingStatus = FULLY_INVOICED
  Todas las líneas completadas
```

---

## Efectos Secundarios por Entidad

### Confirmar Factura de Compra

| Efecto | Condición | Detalle |
|--------|-----------|---------|
| Stock +qty | Si NO hay remitos confirmados Y no es ND | Incrementa stock en depósito principal |
| Stock -qty | Si es NC | Decrementa stock (devolución al proveedor) |
| OC.invoicedQty | Si está linkeada a OC | Incrementa `invoicedQty` en líneas de OC |
| OC.invoicingStatus | Si está linkeada a OC | Recalcula: NOT_INVOICED / PARTIALLY / FULLY |
| Asiento Contable | Siempre | Dr: Compras + IVA CF + percepciones sufridas + imp. internos → Cr: Ctas por Pagar |
| Validación de cuentas de tributos | Si tiene percepciones o imp. internos | Aborta la confirmación si falta alguna cuenta configurada (TSK-644) |
| Auto-compensación NC | Si es NC | Aplica NC contra facturas pendientes |

### Cancelar Factura de Compra

| Efecto | Condición | Detalle |
|--------|-----------|---------|
| Stock -qty | Si estaba CONFIRMED y tiene productos | Revierte el stock (ADJUSTMENT) |
| OC.invoicedQty | Si está linkeada a OC | Decrementa `invoicedQty` |
| OC.invoicingStatus | Si está linkeada a OC | Recalcula status |
| Validación | Siempre | No permite si PAID o PARTIAL_PAID |
| Validación | Stock | Verifica que haya stock suficiente para revertir |

### Confirmar Remito de Recepción

| Efecto | Condición | Detalle |
|--------|-----------|---------|
| Stock +qty | Siempre (productos con stock) | Incrementa en depósito del remito |
| StockMovement | Siempre | Crea movimiento tipo PURCHASE |
| OC.receivedQty | Si linkeado a OC | Incrementa `receivedQty` en líneas |
| OC.status | Si linkeado a OC | APPROVED → PARTIALLY_RECEIVED → COMPLETED |

### Confirmar Factura de Venta

| Efecto | Condición | Detalle |
|--------|-----------|---------|
| Stock -qty | Si no es ND | Decrementa stock del depósito principal |
| Stock +qty | Si es NC | Restaura stock (devolución del cliente) |
| Asiento Contable | Siempre | Dr: Ctas por Cobrar → Cr: Ventas + IVA DF |
| Auto-compensación NC | Si es NC | Aplica NC contra facturas pendientes |

### Confirmar Recibo de Cobro

| Efecto | Condición | Detalle |
|--------|-----------|---------|
| SalesInvoice.status | Siempre | Actualiza a PAID / PARTIAL_PAID |
| CashMovement (INCOME) | Si pago en efectivo | Crea movimiento, incrementa expectedBalance |
| BankMovement (DEPOSIT) | Si pago por transferencia | Crea movimiento, incrementa balance bancario |
| Check (THIRD_PARTY) | Si pago con cheque | Crea cheque en estado PORTFOLIO |
| Asiento Contable | Siempre | Dr: Caja/Banco + Ret. Sufridas → Cr: Ctas por Cobrar |

### Confirmar Orden de Pago

| Efecto | Condición | Detalle |
|--------|-----------|---------|
| PurchaseInvoice.status | Si tiene facturas | Actualiza a PAID / PARTIAL_PAID |
| Expense.status | Si tiene gastos | Actualiza a PAID / PARTIAL_PAID |
| CashMovement (EXPENSE) | Si pago en efectivo | Crea movimiento, decrementa expectedBalance |
| BankMovement (WITHDRAWAL) | Si pago por transferencia | Crea movimiento, decrementa balance bancario |
| Check (OWN) | Si pago con cheque | Crea cheque propio estado DELIVERED |
| Asiento Contable | Siempre | Dr: Ctas por Pagar → Cr: Caja/Banco + Ret. Emitidas |

---

## Impacto en Stock

### Resumen por Tipo de Comprobante

| Acción | Factura Regular | Nota de Crédito | Nota de Débito |
|--------|----------------|-----------------|----------------|
| **Confirmar Venta** | Stock -qty (SALE) | Stock +qty (RETURN) | Sin impacto |
| **Cancelar Venta** | Stock +qty (ADJUSTMENT) | Stock -qty (ADJUSTMENT) | Sin impacto |
| **Confirmar Compra** | Stock +qty (PURCHASE)* | Stock -qty (RETURN) | Sin impacto |
| **Cancelar Compra** | Stock -qty (ADJUSTMENT) | Stock +qty (ADJUSTMENT) | Sin impacto |

*\* Solo si NO existen remitos de recepción confirmados. Si hay remitos, el stock ya fue gestionado por ellos.*

### Depósito utilizado

- **Compras**: Depósito principal (type === MAIN)
- **Ventas**: Depósito principal (type === MAIN)
- **Remitos**: Depósito especificado en el remito
- **Ajustes/Transferencias**: Depósitos seleccionados por el usuario

---

## Cuenta Corriente

### Cuenta Corriente de Cliente

**Facturas mostradas:** status = CONFIRMED, PAID, PARTIAL_PAID

**Cálculo de saldo por factura (regular):**
```
total_cobrado = SUM(receipts.amount) + SUM(nc_aplicadas.amount)
saldo = total - total_cobrado
```

**Cálculo de saldo por NC:**
```
nc_aplicada = SUM(aplicaciones_desde_esta_nc.amount)
saldo = -(total - nc_aplicada)   // Negativo = crédito disponible
```

**Métricas resumen:**
```
Total Facturado = SUM(facturas regulares + ND)
Total Cobrado   = SUM(cobros sobre facturas regulares + ND)
Saldo Total     = Total Facturado - Total Cobrado
```

### Cuenta Corriente de Proveedor

**Facturas mostradas:** status = CONFIRMED, PAID, PARTIAL_PAID

**Cálculo de saldo por factura (regular):**
```
total_pagado = SUM(payment_orders.amount) + SUM(nc_aplicadas.amount)
saldo = total - total_pagado
```

**Métricas resumen:**
```
Total Facturado = SUM(facturas regulares + ND)
Total Pagado    = SUM(pagos sobre facturas regulares + ND)
Saldo Total     = Total Facturado - Total Pagado
```

---

## Compensación Automática de NC

Cuando una **Nota de Crédito** se confirma, se ejecuta auto-compensación:

1. Obtiene todas las facturas/ND pendientes del mismo cliente/proveedor (CONFIRMED o PARTIAL_PAID)
2. Calcula pendiente por factura:
   ```
   pendiente = total - cobrado/pagado - nc_aplicadas_explícitas - nc_aplicadas_fallback
   ```
3. Ordena FIFO (más antigua primero), prioriza factura original si está linkeada vía `originalInvoiceId`
4. Aplica NC secuencialmente:
   - Crea registro `SalesCreditNoteApplication` / `PurchaseCreditNoteApplication`
   - Actualiza factura: PARTIAL_PAID o PAID
   - Decrementa saldo restante de NC
5. Marca NC como: PAID (si totalmente aplicada) o PARTIAL_PAID

---

## Integración Contable

**Archivo:** `src/modules/accounting/features/integrations/commercial/index.ts`

Cada documento comercial confirmado genera un asiento contable automático:

| Documento | Debe | Haber |
|-----------|------|-------|
| Factura Venta | Ctas por Cobrar | Ventas + IVA Débito |
| NC Venta | Ventas + IVA Débito | Ctas por Cobrar |
| Factura Compra | Compras + IVA Crédito | Ctas por Pagar |
| NC Compra | Ctas por Pagar | Compras + IVA Crédito |
| Recibo | Caja/Banco + Ret. Sufridas | Ctas por Cobrar |
| Orden de Pago | Ctas por Pagar | Caja/Banco + Ret. Emitidas |
| Gasto | Gastos Operativos | Ctas por Pagar |
| Mov. Bancario Manual | Según tipo (DEPOSIT/WITHDRAWAL) | Contraparte seleccionada |

**Mapeos de cuentas** (configurados en AccountingSettings):
- `receivablesAccount`: Cuentas por Cobrar
- `payablesAccount`: Cuentas por Pagar
- `defaultCashAccount`: Cuenta de Caja
- `defaultBankAccount`: Cuenta de Banco
- Cuentas de retenciones (emitidas y sufridas)

**Comportamiento ante errores**: La creación del asiento contable es **no-bloqueante**. Si falla o no están configuradas las cuentas, logea warning pero la operación comercial continúa.

### Reparto por Centro de Costo (TSK-583)

Cada línea de factura (compra o venta) puede repartirse entre varios centros de costo por
porcentaje, en vez de un único centro fijo. Reglas:

- Solo aplica a líneas cuyo ítem se imputa a una cuenta de tipo `REVENUE` o `EXPENSE`. Una
  cuenta patrimonial (`ASSET`, `LIABILITY`, `EQUITY`) no admite reparto: comprar o vender un
  activo no consume presupuesto de ningún centro.
- Un reparto suma exactamente 100% o está vacío; vacío cae en `Product.defaultCostCenterId`.
- Solo se reparte el `subtotal` (neto) de la línea. El IVA nunca se reparte: siempre va a la
  cuenta de IVA (crédito o débito fiscal), que no es de resultado.
- Al generar el asiento, `expandByCostCenter()` (en
  `modules/commercial/shared/cost-center.ts`) expande cada línea en tantas imputaciones como
  centros tenga, **agrupando por `cuenta + centro`** — antes se agrupaba solo por cuenta, lo
  que en ventas colapsaba el reparto en un único centro (bug corregido en esta entrega).
- **Prorrateo:** cada monto se redondea a 2 decimales y el último centro del reparto absorbe
  la diferencia, para que la suma de las partes sea exacta y el asiento no descuadre.
- **Obligatoriedad configurable** (`AccountingSettings.requireCostCenter`): con el flag
  activo, al **confirmar** una factura toda línea imputada a cuenta de resultado debe tener
  reparto completo; si falta, la confirmación se rechaza nombrando las líneas incompletas
  (`findLinesMissingCostCenter` / `buildMissingCostCenterMessage`). La confirmación masiva
  omite esas facturas, sigue con el resto e informa el motivo. Con el flag apagado (default),
  el comportamiento es el previo a esta entrega.
- Facturas ya confirmadas no se revalidan: la regla corre solo al confirmar.

Modelo de datos: `PurchaseInvoiceLineCostCenter` y `SalesInvoiceLineCostCenter` (ver
[data-model.md](../architecture/data-model.md)).

---

## Retenciones

Tanto Recibos como Órdenes de Pago soportan retenciones impositivas:

| Campo | Tipo | Descripción |
|-------|------|-------------|
| taxType | GANANCIAS / IVA / IIBB / SUSS | Tipo de impuesto |
| rate | Decimal | Porcentaje |
| amount | Decimal | Monto retenido |
| certificateNumber | String? | Número de certificado |

**En Recibos** (Retenciones Sufridas - Crédito Fiscal):
- El cliente retiene al cobrar
- Reduce el monto efectivo de cobro
- Genera débito en cuenta de retenciones sufridas

**En Órdenes de Pago** (Retenciones Emitidas):
- La empresa retiene al pagar al proveedor
- Reduce el monto efectivo del pago
- Genera crédito en cuenta de retenciones emitidas

---

## Reglas de Validación

### Orden de Compra
- Solo editar si status = DRAFT
- Solo cancelar si status != COMPLETED / CANCELLED
- Cuotas: sum(monto) == total de la OC
- Mínimo 2 cuotas si se usan

### Factura de Compra
- No duplicar fullNumber por proveedor
- Solo editar si DRAFT
- No cancelar si PAID o PARTIAL_PAID
- Si tiene remitos confirmados, stock ya manejado
- Requiere depósito principal activo para stock
- Al vincular con OC: no puede exceder cantidad pendiente por línea
- Con `AccountingSettings.requireCostCenter` activo: al confirmar, toda línea imputada a
  cuenta de resultado debe tener reparto de centro de costo completo (TSK-583)

### Factura de Venta
- voucherType válido según reglas AFIP (matriz emisor/receptor)
- Punto de venta autorizado AFIP (si habilitado)
- Solo editar si DRAFT
- No cancelar si PAID o PARTIAL_PAID
- Con `AccountingSettings.requireCostCenter` activo: al confirmar, toda línea imputada a
  cuenta de resultado debe tener reparto de centro de costo completo (TSK-583)

### Recibo / Orden de Pago
- Requiere sesión de caja ABIERTA si paga en efectivo
- Medios de pago deben tener campos requeridos (bankAccountId, cashRegisterId)
- totalAmount == sum(items)
- sum(payments) + sum(withholdings) == totalAmount

### Stock
- Ajustes EXIT/LOSS: verificar stock suficiente
- Transferencias: verificar stock en depósito origen
- availableQty = quantity - reservedQty

---

## Tabla Resumen de Efectos

| Evento | Stock | Factura Status | OC Status | OC InvoicingStatus | Banco/Caja | Asiento |
|--------|-------|----------------|-----------|-------------------|------------|---------|
| Confirmar FC Compra | +qty* | CONFIRMED | — | PARTIALLY/FULLY | — | Si |
| Cancelar FC Compra | -qty | CANCELLED | — | Recalcula | — | — |
| Confirmar NC Compra | -qty | CONFIRMED | — | — | — | Si |
| Confirmar ND Compra | — | CONFIRMED | — | — | — | Si |
| Confirmar Remito | +qty | — | PARTIALLY/COMPLETED | — | — | — |
| Confirmar FC Venta | -qty | CONFIRMED | — | — | — | Si |
| Cancelar FC Venta | +qty | CANCELLED | — | — | — | — |
| Confirmar NC Venta | +qty | CONFIRMED | — | — | — | Si |
| Confirmar ND Venta | — | CONFIRMED | — | — | — | Si |
| Confirmar Recibo | — | PAID/PARTIAL | — | — | +balance | Si |
| Confirmar OP | — | PAID/PARTIAL | — | — | -balance | Si |

*\* Solo si no hay remitos confirmados*

---

## Archivos Clave

### Server Actions

| Feature | Path |
|---------|------|
| Órdenes de Compra | `modules/commercial/features/purchases/features/purchase-orders/list/actions.server.ts` |
| Facturas de Compra | `modules/commercial/features/purchases/features/invoices/list/actions.server.ts` |
| Remitos de Recepción | `modules/commercial/features/purchases/features/receiving-notes/list/actions.server.ts` |
| Facturas de Venta | `modules/commercial/features/sales/features/invoices/list/actions.server.ts` |
| Recibos de Cobro | `modules/commercial/features/treasury/features/receipts/actions.server.ts` |
| Órdenes de Pago | `modules/commercial/features/treasury/features/payment-orders/actions.server.ts` |
| Movimientos Bancarios | `modules/commercial/features/treasury/features/bank-movements/actions.server.ts` |
| Sesiones de Caja | `modules/commercial/features/treasury/features/sessions/actions.server.ts` |
| Movimientos de Stock | `modules/commercial/features/warehouses/features/movements/actions.server.ts` |
| CC Cliente | `modules/commercial/features/clients/detail/actions.server.ts` |
| CC Proveedor | `modules/commercial/features/suppliers/features/detail/actions.server.ts` |

### Integración Contable

| Feature | Path |
|---------|------|
| Generación de asientos | `modules/accounting/features/integrations/commercial/index.ts` |

### Validators y Tipos

| Feature | Path |
|---------|------|
| Facturas Compra | `modules/commercial/features/purchases/features/invoices/shared/validators.ts` |
| Facturas Venta | `modules/commercial/features/sales/features/invoices/shared/validators.ts` |
| OC | `modules/commercial/features/purchases/features/purchase-orders/shared/validators.ts` |
| Tesorería | `modules/commercial/features/treasury/shared/validators.ts` |
| Tipos Tesorería | `modules/commercial/features/treasury/shared/types.ts` |

### Utilidades Compartidas

| Archivo | Descripción |
|---------|-------------|
| `modules/commercial/shared/voucher-utils.ts` | `isCreditNote()`, `isDebitNote()`, constantes de tipos |
| `modules/commercial/shared/credit-note-compensation.ts` | Auto-compensación FIFO de NC contra facturas abiertas |
| `modules/commercial/shared/components/_DocumentAttachment.tsx` | UI de adjuntos |

### Reportes

| Reporte | Ruta |
|---------|------|
| Reporte de Ventas | `/commercial/reports` |
| Reporte de Compras | `/commercial/purchase-reports` |
