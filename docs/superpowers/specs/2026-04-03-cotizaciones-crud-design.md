# Spec A: Cotizaciones/Presupuestos — CRUD + Estados + PDF

## Contexto

Baxer-N necesita un módulo de cotizaciones/presupuestos para que los vendedores puedan presupuestar antes de vender. El modelo Quote ya existe en Prisma pero con items como JSON y sin implementación funcional. Esta spec cubre el módulo base: CRUD, flujo de estados, vencimiento automático y PDF. La conversión a factura/remito se implementa en la Spec B.

Feature **universal** — disponible para todas las empresas.

---

## 1. Modelo de datos

### 1.1 Nuevo modelo QuoteLine

Reemplaza el campo `items Json` por una tabla normalizada (consistente con SalesInvoiceLine):

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `id` | UUID | PK |
| `quoteId` | UUID | FK a Quote |
| `productId` | UUID | FK a Product |
| `description` | String | Descripción editable |
| `quantity` | Decimal(12,3) | Cantidad |
| `unitPrice` | Decimal(12,2) | Precio unitario |
| `vatRate` | Decimal(5,2) | Alícuota IVA |
| `discountPercent` | Decimal(5,2)? | Descuento % |
| `discountAmount` | Decimal(12,2)? | Descuento $ |
| `subtotal` | Decimal(12,2) | Base imponible (después de dto) |
| `vatAmount` | Decimal(12,2) | Monto IVA |
| `total` | Decimal(12,2) | Subtotal + IVA |
| `deliveredQty` | Decimal(12,3) default 0 | Cantidad entregada (para Spec B) |
| `invoicedQty` | Decimal(12,3) default 0 | Cantidad facturada (para Spec B) |

### 1.2 Cambios en Quote

| Cambio | Detalle |
|--------|---------|
| Eliminar | `items Json` |
| Eliminar | `tax Decimal?` (se calcula como vatAmount) |
| Agregar | `customerId UUID?` — FK a Customer |
| Agregar | `leadId` con relación real a Lead (campo existe pero sin @relation) |
| Agregar | `vatAmount Decimal(12,2)` — reemplaza `tax` |
| Agregar | `globalDiscountPercent Decimal(5,2)?` |
| Agregar | `globalDiscountAmount Decimal(12,2)?` |
| Agregar | `totalBeforeDiscount Decimal(12,2) default 0` |
| Agregar | `discountTotal Decimal(12,2) default 0` |
| Agregar | `conditions String?` — condiciones de la cotización (textarea) |
| Agregar | `createdBy String` — userId de Clerk |
| Agregar | Relación `lines QuoteLine[]` |
| Agregar | Relación `customer Customer?` |

### 1.3 Cambios en QuoteStatus enum

Agregar: `COMPLETED` (cuando todas las líneas están 100% facturadas — usado en Spec B).

### 1.4 Validación de asociación

Una cotización debe tener `customerId` O `leadId` (al menos uno). Ambos pueden estar vacíos en DRAFT, pero se requiere uno al pasar a SENT.

---

## 2. Flujo de estados

```
DRAFT → SENT → ACCEPTED → (COMPLETED en Spec B)
  ↓       ↓       ↓
REJECTED REJECTED EXPIRED (automático)
```

### Transiciones permitidas

| Desde | Hacia | Acción | Condición |
|-------|-------|--------|-----------|
| DRAFT | SENT | "Marcar como Enviado" | Debe tener cliente o lead, al menos 1 línea |
| DRAFT | — | Editar/Eliminar | Libre |
| SENT | ACCEPTED | "Aceptar" | — |
| SENT | REJECTED | "Rechazar" | — |
| ACCEPTED | EXPIRED | Automático | `expirationDate < hoy` |
| REJECTED | — | Duplicar | Crea nueva cotización en DRAFT |
| EXPIRED | — | Duplicar | Crea nueva cotización en DRAFT |

### Vencimiento automático

Al listar o abrir una cotización, si `status` es SENT o ACCEPTED y `expirationDate < hoy`, se actualiza a EXPIRED automáticamente.

---

## 3. Interfaz de usuario

### 3.1 Lista de cotizaciones

DataTable con columnas:
- **Número**: monospace
- **Fecha**: DD/MM/YYYY
- **Cliente/Lead**: nombre (con indicador de si es lead o cliente)
- **Vencimiento**: DD/MM/YYYY (con color rojo si próximo a vencer o vencido)
- **Total**: monospace, formato argentino
- **Estado**: Badge con colores:
  - DRAFT: secondary (gris)
  - SENT: default (azul)
  - ACCEPTED: default verde (custom)
  - COMPLETED: default verde oscuro
  - REJECTED: destructive (rojo)
  - EXPIRED: outline naranja
- **Acciones**: dropdown según estado

Toolbar: búsqueda por número/cliente, filtro por estado, botón "Nueva Cotización".

### 3.2 Formulario crear/editar

Layout similar al formulario de facturas rediseñado:

**Card "Datos de la Cotización":**
- Tipo de destinatario: toggle "Cliente" / "Lead"
- Selector de Cliente (si toggle = Cliente) o Selector de Lead (si toggle = Lead)
- Fecha de emisión
- Fecha de vencimiento (opcional)
- Moneda (ARS por defecto, permitir USD/EUR)

**Card "Detalle de Productos/Servicios":**
- Mismo layout tabular que facturas: headers de columna + filas con inputs inline
- Columnas: Producto/Descripción, Cant., P.Unit., Dto., IVA%, Subtotal, IVA, Total, ×
- Descripción editable debajo de cada línea
- Selector de presets de descuento

**Card "Descuento Global":**
- Dto% y Dto$ (mutuamente excluyentes) con presets

**Card "Totales":**
- Desglose con descuentos (mismo patrón que facturas)

**Card "Condiciones y Notas":**
- Textarea "Condiciones" (condiciones de la cotización, plazos de entrega, validez, etc.)
- Textarea "Notas" (notas adicionales visibles en el PDF)

### 3.3 Detalle de cotización

- Header: número, estado (badge), fechas
- Info cliente/lead
- Tabla de líneas (sin columnas entregado/facturado — esas van en Spec B)
- Totales con descuentos
- Condiciones y notas
- Acciones según estado (botones de transición)
- Botón "Descargar PDF"
- Botón "Duplicar" (para cualquier estado)

### 3.4 PDF

- Header: "PRESUPUESTO" (no tipo de comprobante fiscal)
- Datos empresa emisora
- Datos destinatario (cliente o lead)
- Número y fecha
- Fecha de vencimiento (si tiene)
- Tabla de líneas (mismo formato que facturas, con Dto. si aplica)
- Totales con descuentos
- Condiciones (si tiene)
- Notas (si tiene)
- Sin datos fiscales (sin CAE, sin punto de venta)

---

## 4. Archivos a crear/modificar

### Schema
- `prisma/schema.prisma` — QuoteLine, cambios en Quote, COMPLETED en QuoteStatus

### Módulo quotes (nuevo, reemplaza el stub)
- `src/modules/commercial/features/quotes/shared/validators.ts` — Zod schemas
- `src/modules/commercial/features/quotes/shared/types.ts` — tipos TypeScript
- `src/modules/commercial/features/quotes/list/actions.server.ts` — CRUD + transiciones de estado
- `src/modules/commercial/features/quotes/list/columns.tsx` — columnas DataTable
- `src/modules/commercial/features/quotes/list/QuotesList.tsx` — Server Component
- `src/modules/commercial/features/quotes/list/components/_QuotesTable.tsx` — Client DataTable
- `src/modules/commercial/features/quotes/create/CreateQuote.tsx` — Server Component
- `src/modules/commercial/features/quotes/create/actions.server.ts` — helpers server
- `src/modules/commercial/features/quotes/create/components/_QuoteForm.tsx` — Formulario
- `src/modules/commercial/features/quotes/edit/EditQuote.tsx`
- `src/modules/commercial/features/quotes/detail/QuoteDetail.tsx`
- `src/modules/commercial/features/quotes/detail/components/_QuoteStatusActions.tsx` — botones de transición
- `src/modules/commercial/features/quotes/index.ts`

### PDF
- `src/modules/commercial/features/quotes/shared/pdf/types.ts`
- `src/modules/commercial/features/quotes/shared/pdf/styles.ts`
- `src/modules/commercial/features/quotes/shared/pdf/QuoteTemplate.tsx`
- `src/modules/commercial/features/quotes/shared/pdf/data-mapper.ts`

### Rutas
- `src/app/(core)/dashboard/company/commercial/quotes/page.tsx` — actualizar existente
- `src/app/(core)/dashboard/company/commercial/quotes/new/page.tsx`
- `src/app/(core)/dashboard/company/commercial/quotes/[id]/page.tsx`
- `src/app/(core)/dashboard/company/commercial/quotes/[id]/edit/page.tsx`

### Sidebar
- `src/shared/components/layout/_AppSidebar.tsx` — habilitar nav item (quitar `disabled: true`)

### Documentación
- `src/modules/help/features/guide/components/_CommercialGuide.tsx` — documentar cotizaciones

---

## 5. Qué NO incluye (Spec B)

- Conversión cotización → factura (parcial/total)
- Conversión cotización → remito (parcial/total)
- Lead → Customer automático al facturar
- Tracking de `deliveredQty` / `invoicedQty` (campos se crean pero no se usan)
- Documentos vinculados en el detalle
- Estado COMPLETED (se agrega al enum pero la transición es de Spec B)
