# Remitos de Entrega (RE)

## Descripcion
Gestion de remitos de entrega de materiales/productos a clientes. Los remitos documentan la salida fisica de mercaderia, descuentan stock del almacen y permiten facturacion multiple desde remitos aceptados.

## Modelo de Datos

### DeliveryNote
| Campo | Tipo | Descripcion |
|-------|------|-------------|
| id | String (uuid) | Identificador unico |
| companyId | String (uuid) | Empresa (tenant) |
| customerId | String (uuid) | Cliente (Contractor) |
| warehouseId | String (uuid) | Almacen origen |
| number | Int | Secuencial por empresa |
| fullNumber | String | Formato RE-XXXXX |
| salesInvoiceId | String? (uuid) | Factura de venta asociada (al facturar) |
| deliveryDate | DateTime (Date) | Fecha de entrega |
| notes | String? | Observaciones |
| status | DeliveryNoteStatus | PENDING_DELIVERY, ACCEPTED, INVOICED, CANCELLED |
| createdBy | String | Usuario que creo |
| createdAt | DateTime | Fecha de creacion |
| updatedAt | DateTime | Fecha de actualizacion |

### DeliveryNoteLine
| Campo | Tipo | Descripcion |
|-------|------|-------------|
| id | String (uuid) | Identificador unico |
| deliveryNoteId | String (uuid) | Remito padre |
| productId | String (uuid) | Producto |
| description | String | Descripcion |
| quantity | Decimal(12,3) | Cantidad entregada |
| notes | String? | Observaciones de linea |

### Relaciones
- DeliveryNote N→1 Contractor (cliente)
- DeliveryNote N→1 Warehouse (almacen origen)
- DeliveryNote N→1 Company (empresa/tenant)
- DeliveryNote N→1 SalesInvoice (factura, opcional)
- DeliveryNote 1→N DeliveryNoteLine (lineas)
- DeliveryNoteLine N→1 Product (producto)

## Flujo de Estados

```
PENDING_DELIVERY (creacion, stock descontado)
  ├→ ACCEPTED (cliente acepta la mercaderia)
  │    ├→ INVOICED (se genera factura de venta)
  │    └→ CANCELLED (se revierte stock)
  └→ CANCELLED (se revierte stock)
```

### Diferencias con Remitos de Recepcion
| Aspecto | Recepcion (RR) | Entrega (RE) |
|---------|---------------|--------------|
| Stock | Se suma al confirmar | Se descuenta al crear |
| Edicion | Solo en DRAFT | Solo en PENDING_DELIVERY (recalcula stock) |
| Facturacion | No tiene | Multiples remitos ACCEPTED → 1 Factura DRAFT |
| Movimiento stock | PURCHASE (positivo) | SALE (negativo) |
| Cancelacion revierte | ADJUSTMENT (negativo) | RETURN (positivo) |

## Gestion de Stock

### Al crear remito
1. Verifica stock disponible (availableQty) por producto con trackStock=true
2. Crea movimientos de stock tipo SALE con cantidad negativa
3. Decrementa quantity y availableQty en WarehouseStock
4. Productos sin trackStock se agregan al remito sin restriccion

### Al editar remito (PENDING_DELIVERY)
1. Revierte stock de lineas anteriores (incrementa quantity/availableQty)
2. Elimina movimientos de stock anteriores
3. Verifica stock para nuevas lineas
4. Crea nuevos movimientos y decrementa stock

### Al cancelar remito
1. Crea movimientos de stock tipo RETURN con cantidad positiva
2. Incrementa quantity y availableQty en WarehouseStock

### Al eliminar remito (PENDING_DELIVERY)
1. Revierte stock (incrementa quantity/availableQty)
2. Elimina movimientos de stock
3. Elimina el remito y sus lineas

## Facturacion desde Remitos

### Flujo
1. Usuario selecciona remitos en estado ACCEPTED del mismo cliente
2. Sistema crea SalesInvoice en DRAFT con lineas combinadas
3. Precio unitario y tasa IVA se toman del producto
4. Tipo de comprobante se determina por condicion fiscal del cliente
5. Los remitos pasan a INVOICED con referencia a la factura

### Validaciones
- Todos los remitos deben ser del mismo cliente
- Todos deben estar en estado ACCEPTED
- Debe existir al menos un punto de venta activo

## Estructura de Archivos

```
src/modules/commercial/features/sales/features/delivery-notes/
├── shared/
│   └── validators.ts          # Zod schemas, status labels
├── list/
│   ├── DeliveryNotesList.tsx   # Server Component (listado)
│   ├── actions.server.ts      # CRUD + stock + facturacion
│   ├── columns.tsx            # Columnas DataTable
│   ├── components/
│   │   ├── _DeliveryNotesTable.tsx         # Client DataTable
│   │   └── _InvoiceDeliveryNotesDialog.tsx # Dialog facturacion
│   └── index.ts
├── create/
│   ├── CreateDeliveryNote.tsx  # Server Component
│   ├── components/
│   │   └── _DeliveryNoteForm.tsx  # Formulario (create/edit)
│   └── index.ts
├── detail/
│   ├── DeliveryNoteDetail.tsx  # Server Component
│   ├── components/
│   │   └── _DeliveryNoteActions.tsx  # Botones de accion
│   └── index.ts
├── edit/
│   ├── EditDeliveryNote.tsx    # Server Component
│   └── index.ts
└── index.ts
```

## Rutas

| Ruta | Descripcion |
|------|-------------|
| /dashboard/commercial/delivery-notes | Listado |
| /dashboard/commercial/delivery-notes/new | Crear |
| /dashboard/commercial/delivery-notes/[id] | Detalle |
| /dashboard/commercial/delivery-notes/[id]/edit | Editar |

## Permisos

Modulo: `commercial.delivery-notes`

| Accion | Uso |
|--------|-----|
| view | Ver listado y detalle |
| create | Crear remito |
| update | Editar remito (PENDING_DELIVERY) |
| delete | Eliminar/anular remito |
| approve | Aceptar remito (PENDING_DELIVERY → ACCEPTED) |

La facturacion usa permiso `commercial.invoices` con accion `create`.

## Integracion con Clientes

En la vista de detalle de cliente (Comercial → Clientes → [Cliente]) se agrego una tab "Remitos" que muestra todos los remitos de entrega del cliente con su estado y factura asociada.
