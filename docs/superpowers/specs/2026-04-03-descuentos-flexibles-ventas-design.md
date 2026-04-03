# Spec: Descuentos Flexibles en Ventas

## Contexto

Baxer-N no tiene ningún sistema de descuentos. En casas de repuestos (y en general), el vendedor negocia descuentos constantemente en mostrador. Se necesita:
- Descuentos por línea (% o $)
- Descuento global sobre la factura (% o $)
- Catálogo de descuentos predefinidos como atajos rápidos
- IVA calculado sobre la base ya descontada (correcto fiscalmente en Argentina)

Feature **universal** — disponible para todas las empresas, no restringida por industria.

---

## 1. Modelo de datos

### 1.1 Cambios en SalesInvoiceLine

Agregar campos:

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `discountPercent` | `Decimal(5,2)?` | Descuento porcentual (0-100) |
| `discountAmount` | `Decimal(12,2)?` | Descuento fijo en $ |

Mutuamente excluyentes por línea. Si ambos tienen valor, prevalece `discountPercent`.

### 1.2 Cambios en SalesInvoice

Agregar campos:

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `globalDiscountPercent` | `Decimal(5,2)?` | Descuento global % |
| `globalDiscountAmount` | `Decimal(12,2)?` | Descuento global $ |
| `totalBeforeDiscount` | `Decimal(12,2)` | Suma subtotales antes de dto global (default 0) |
| `discountTotal` | `Decimal(12,2)` | Total descontado (líneas + global, default 0) |

### 1.3 Nuevo modelo: DiscountPreset

```prisma
model DiscountPreset {
  id         String   @id @default(uuid())
  companyId  String
  name       String   // ej: "Mecánico", "Mayorista"
  percentage Decimal  @db.Decimal(5, 2)
  isActive   Boolean  @default(true)
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt

  company Company @relation(fields: [companyId], references: [id])

  @@unique([companyId, name])
  @@index([companyId])
}
```

Relación en Company: `discountPresets DiscountPreset[]`

---

## 2. Lógica de cálculo

### 2.1 Nivel línea

```
baseAmount = quantity × unitPrice

if discountPercent:
  discountValue = baseAmount × (discountPercent / 100)
else if discountAmount:
  discountValue = min(discountAmount, baseAmount)
else:
  discountValue = 0

subtotal = baseAmount - discountValue        ← base imponible
vatAmount = subtotal × (vatRate / 100)
total = subtotal + vatAmount
```

### 2.2 Nivel factura (descuento global)

El descuento global se aplica antes de IVA, distribuido proporcionalmente entre líneas por peso en el subtotal (necesario porque cada línea puede tener distinta alícuota de IVA).

```
sumLineSubtotals = Σ líneas.subtotal (ya descontadas individualmente)

if globalDiscountPercent:
  globalDiscount = sumLineSubtotals × (globalDiscountPercent / 100)
else if globalDiscountAmount:
  globalDiscount = min(globalDiscountAmount, sumLineSubtotals)
else:
  globalDiscount = 0

// Distribución proporcional para recalcular IVA por alícuota
for cada línea:
  peso = línea.subtotal / sumLineSubtotals
  descuentoProporcion = globalDiscount × peso
  baseDescontada = línea.subtotal - descuentoProporcion
  ivaDescontado = baseDescontada × (línea.vatRate / 100)

invoiceSubtotal = sumLineSubtotals - globalDiscount
invoiceVatAmount = Σ ivaDescontado
invoiceTotal = invoiceSubtotal + invoiceVatAmount

// Valores guardados
totalBeforeDiscount = sumLineSubtotals
discountTotal = Σ descuentos de líneas + globalDiscount
```

### 2.3 Valores guardados en BD

- **Línea**: `discountPercent`/`discountAmount` originales + `subtotal` ya descontado + `vatAmount` sobre el descontado
- **Factura**: `globalDiscountPercent`/`globalDiscountAmount`, `totalBeforeDiscount`, `discountTotal`, `subtotal` (post-descuento global), `vatAmount`, `total`
- La distribución proporcional del descuento global NO se persiste por línea — se recalcula para PDF/reportes

---

## 3. Interfaz de usuario

### 3.1 Formulario de factura (crear/editar)

**Línea de producto** — agregar Dto% y Dto$ después de Precio Unit.:

```
[Producto ▼] [Cantidad] [P. Unit.] [Dto% ___] [Dto$ ___] [IVA ▼] | Neto: $X  IVA: $X  Total: $X
```

- Dto% y Dto$ son mutuamente excluyentes: al escribir en uno, se limpia el otro
- Botón/ícono junto a Dto% para abrir selector de preset. Al seleccionar, autocompleta Dto%
- Totales de línea se recalculan en tiempo real mostrando neto ya descontado

**Descuento global** — nueva sección debajo de las líneas, antes de los totales:

```
Descuento global: [% ___] ó [$ ___]  [Predefinido ▼]
```

- Misma exclusión mutua (% o $)
- Mismo selector de presets

**Resumen de totales** — actualizar sección existente:

```
Subtotal (antes dto):  $XX.XXX
Descuento líneas:     -$XX.XXX
Descuento global:     -$XX.XXX
Base imponible:        $XX.XXX
IVA 21%:               $XX.XXX
IVA 10.5%:             $XX.XXX
Total:                 $XX.XXX
```

Las filas de descuento solo se muestran cuando hay algún descuento aplicado.

### 3.2 Detalle de factura (vista lectura)

- Tabla de líneas: nueva columna "Dto." que muestra "10%" o "$500" según aplique
- Totales: desglose de descuentos cuando existen

### 3.3 PDF

- Tabla: columna "Dto." entre Precio Unit. e IVA (solo se muestra si alguna línea tiene descuento)
- Totales: descuentos desglosados cuando existen

### 3.4 CRUD de Descuentos Predefinidos

Nueva pantalla en **Configuración de Empresa**, sección comercial.

- **Tabla**: Nombre, Porcentaje, Estado (activo/inactivo), acciones
- **Modal crear/editar**: campos Nombre y Porcentaje
- **Eliminar**: con AlertDialog de confirmación
- **Permisos**: módulo `company.discount-presets` con acciones view/create/update/delete

---

## 4. Archivos a modificar/crear

### Schema y migración
- `prisma/schema.prisma` — campos en SalesInvoiceLine, SalesInvoice, nuevo modelo DiscountPreset

### CRUD Descuentos Predefinidos (nuevo módulo)
- `src/modules/company/features/discount-presets/` — list, components (_Form, _Table), actions.server.ts, index.ts
- `src/app/(core)/dashboard/company/config/discount-presets/page.tsx` — ruta
- `src/shared/lib/permissions/constants.ts` — registrar módulo `company.discount-presets`
- `src/shared/components/layout/_AppSidebar.tsx` — nav item en config empresa

### Lógica de facturación
- `src/modules/commercial/features/sales/features/invoices/shared/validators.ts` — campos de descuento en schemas Zod
- `src/modules/commercial/features/sales/features/invoices/list/actions.server.ts` — actualizar `calculateLineAmounts()`, `createInvoice()`, `updateInvoice()`
- `src/modules/commercial/features/sales/features/invoices/create/components/_InvoiceForm.tsx` — campos de descuento por línea + global
- `src/modules/commercial/features/sales/features/invoices/detail/InvoiceDetail.tsx` — columna descuento + totales

### PDF
- `src/modules/commercial/features/sales/shared/pdf/InvoiceTemplate.tsx` — columna dto + totales
- `src/modules/commercial/features/sales/shared/pdf/types.ts` — tipos actualizados

### Documentación y tests
- `cypress/e2e/commercial/sales-invoices.cy.ts` — tests de descuentos
- `src/modules/help/features/guide/components/_CommercialGuide.tsx` — documentar descuentos
- `docs/modules/commercial.md` — documentar feature

---

## 5. Qué NO incluye

- Descuento por defecto asociado a cliente
- Descuentos en facturas de compra
- Reportes de descuentos otorgados
- Descuentos en cotizaciones (se implementa con el módulo quotes)
