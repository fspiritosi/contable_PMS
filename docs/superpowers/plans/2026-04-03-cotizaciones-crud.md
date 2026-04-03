# Cotizaciones CRUD + Estados + PDF — Plan de Implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementar módulo completo de cotizaciones/presupuestos con CRUD, flujo de estados, vencimiento automático y generación de PDF.

**Architecture:** Nuevo modelo QuoteLine reemplaza items JSON en Quote. Módulo sigue patrón de invoices (list/create/edit/detail/shared). Formulario reutiliza layout tabular de facturas con descuentos. PDF similar a facturas pero sin datos fiscales.

**Tech Stack:** Prisma 7, React 19, React Hook Form + Zod, shadcn/ui, TanStack Query, @react-pdf/renderer

**Spec:** `docs/superpowers/specs/2026-04-03-cotizaciones-crud-design.md`

---

## Task 1: Schema Prisma — QuoteLine + cambios en Quote

**Files:** `prisma/schema.prisma`

- [ ] Agregar `COMPLETED` al enum `QuoteStatus`
- [ ] Eliminar campo `items Json` y `tax Decimal?` del modelo Quote
- [ ] Agregar campos a Quote: `customerId UUID?` (FK Customer/Contractor), `vatAmount Decimal(12,2)`, `globalDiscountPercent Decimal(5,2)?`, `globalDiscountAmount Decimal(12,2)?`, `totalBeforeDiscount Decimal(12,2) default 0`, `discountTotal Decimal(12,2) default 0`, `conditions String?`, `createdBy String`
- [ ] Agregar relación `leadId` con `@relation` real a Lead (actualmente campo sin relación)
- [ ] Agregar relación `customer Contractor?` con `customerId`
- [ ] Agregar relación `lines QuoteLine[]`
- [ ] Crear modelo `QuoteLine` con: id, quoteId (FK), productId (FK), description, quantity Decimal(12,3), unitPrice Decimal(12,2), vatRate Decimal(5,2), discountPercent Decimal(5,2)?, discountAmount Decimal(12,2)?, subtotal Decimal(12,2), vatAmount Decimal(12,2), total Decimal(12,2), deliveredQty Decimal(12,3) default 0, invoicedQty Decimal(12,3) default 0
- [ ] Ejecutar `npm run db:push && npm run db:generate`
- [ ] Commit: `feat(commercial): add QuoteLine model and update Quote schema`

---

## Task 2: Shared — Validators + tipos

**Files:**
- Create: `src/modules/commercial/features/quotes/shared/validators.ts`
- Create: `src/modules/commercial/features/quotes/shared/types.ts`

### validators.ts
- `quoteLineSchema` (client): productId, description, quantity (string), unitPrice (string), vatRate (string), discountPercent (string optional), discountAmount (string optional)
- `quoteFormSchema` (client): recipientType ('customer' | 'lead'), customerId (optional), leadId (optional), issueDate, expirationDate (optional), currency (ARS/USD/EUR/GBP), notes (optional), conditions (optional), globalDiscountPercent (optional), globalDiscountAmount (optional), lines array min 1
- `createQuoteSchema` (server): transforms string→number para quantity/unitPrice/vatRate/discounts, transforms dates
- `QUOTE_STATUS_LABELS`: Record con labels en español para cada estado

### types.ts
- Tipos inferidos de las queries (exports de los tipos de retorno)

- [ ] Commit: `feat(commercial): add quote validators and types`

---

## Task 3: Server Actions — CRUD + estados

**Files:**
- Create: `src/modules/commercial/features/quotes/list/actions.server.ts`

### Funciones:
- `getQuotesPaginated(searchParams)` — lista paginada con búsqueda y filtro por estado. Incluye customer/lead name. Convierte Decimals a Number().
- `getQuoteById(id)` — detalle completo con lines, customer, lead, product info. Convierte Decimals.
- `getNextQuoteNumber()` — siguiente número secuencial por empresa (formato Q-XXXX)
- `createQuote(data)` — valida con createQuoteSchema, calcula totales con descuentos (misma lógica que invoices), genera número, crea con lines nested
- `updateQuote(id, data)` — solo DRAFT. Elimina lines y recrea.
- `deleteQuote(id)` — solo DRAFT
- `updateQuoteStatus(id, status)` — transiciones validadas: DRAFT→SENT (requiere cliente/lead + líneas), SENT→ACCEPTED, SENT→REJECTED
- `duplicateQuote(id)` — crea copia en DRAFT desde cualquier estado
- `checkExpiredQuotes()` — actualiza SENT/ACCEPTED vencidos a EXPIRED. Se llama desde getQuotesPaginated.

Todas con `checkPermission('commercial.quotes', action)` y `getActiveCompanyId()`.

Lógica de cálculo: reutilizar el mismo patrón de `calculateLineAmounts()` de invoices (con descuentos por línea y global).

- [ ] Commit: `feat(commercial): add quote CRUD server actions with state management`

---

## Task 4: Lista de cotizaciones

**Files:**
- Replace: `src/modules/commercial/features/quotes/list/QuotesList.tsx`
- Create: `src/modules/commercial/features/quotes/list/columns.tsx`
- Create: `src/modules/commercial/features/quotes/list/components/_QuotesTable.tsx`
- Delete: `src/modules/commercial/features/quotes/list/components/_QuotesComingSoon.tsx`
- Update: `src/modules/commercial/features/quotes/list/index.ts`
- Update: `src/modules/commercial/features/quotes/index.ts`
- Update: `src/app/(core)/dashboard/company/commercial/quotes/page.tsx` — pasar searchParams

### QuotesList.tsx (Server Component)
- PermissionGuard module="commercial.quotes" action="view" redirect
- Llama getQuotesPaginated, pasa data a _QuotesTable

### columns.tsx
- Columnas: number (monospace), issueDate (DD/MM/YYYY), customer/lead name (con badge indicando tipo), expirationDate (rojo si vencida), total (monospace currency), status (Badge con colores por estado), actions dropdown
- Actions por estado: Ver (siempre), Editar (DRAFT), Duplicar (siempre), Enviar (DRAFT), Aceptar/Rechazar (SENT), Descargar PDF (siempre excepto DRAFT), Eliminar (DRAFT)

### _QuotesTable.tsx (Client Component)
- DataTable con filtro de estado (select), búsqueda, toolbar con botón "Nueva Cotización"
- Maneja mutations para updateStatus, delete, duplicate
- AlertDialog para confirmar eliminación y cambios de estado

- [ ] Commit: `feat(commercial): implement quotes list with DataTable and status management`

---

## Task 5: Formulario de cotización

**Files:**
- Create: `src/modules/commercial/features/quotes/create/CreateQuote.tsx`
- Create: `src/modules/commercial/features/quotes/create/helpers.server.ts`
- Create: `src/modules/commercial/features/quotes/create/components/_QuoteForm.tsx`
- Create: `src/modules/commercial/features/quotes/create/index.ts`
- Create: `src/app/(core)/dashboard/company/commercial/quotes/new/page.tsx`

### CreateQuote.tsx (Server Component)
- Patrón idéntico a CreateInvoice: PermissionGuard + fetch data en paralelo (customers, leads, products)

### helpers.server.ts
- `getActiveCustomersForQuote()` — clientes activos (id, name, taxId)
- `getActiveLeadsForQuote()` — leads activos no convertidos (id, name, email, phone)
- `getActiveProductsForQuote()` — productos activos con salePrice, vatRate, code, unitOfMeasure

### _QuoteForm.tsx (Client Component)
- Layout tabular idéntico al de facturas (reutilizar patrón _InvoiceLineRow)
- Toggle "Cliente" / "Lead" que muestra el selector correspondiente
- Campos: fecha emisión, fecha vencimiento, moneda
- Líneas con producto, descripción, cantidad, precio, dto, IVA, totales calculados
- Descuento global con presets
- Totales con desglose
- Card "Condiciones y Notas": textarea conditions + textarea notes
- Submit llama createQuote o updateQuote según mode

- [ ] Commit: `feat(commercial): implement quote creation form with discount support`

---

## Task 6: Detalle + Edición de cotización

**Files:**
- Create: `src/modules/commercial/features/quotes/detail/QuoteDetail.tsx`
- Create: `src/modules/commercial/features/quotes/detail/components/_QuoteStatusActions.tsx`
- Create: `src/modules/commercial/features/quotes/detail/index.ts`
- Create: `src/modules/commercial/features/quotes/edit/EditQuote.tsx`
- Create: `src/modules/commercial/features/quotes/edit/index.ts`
- Create: `src/app/(core)/dashboard/company/commercial/quotes/[id]/page.tsx`
- Create: `src/app/(core)/dashboard/company/commercial/quotes/[id]/edit/page.tsx`

### QuoteDetail.tsx
- Header: número, badge de estado, fechas (emisión + vencimiento)
- Info cliente/lead
- Tabla de líneas (mismo formato que detalle de facturas, con columna Dto.)
- Totales con desglose de descuentos
- Condiciones (si tiene)
- Notas (si tiene)
- _QuoteStatusActions según estado actual
- Botón "Descargar PDF"
- Botón "Duplicar"

### _QuoteStatusActions.tsx
- Renderiza botones de acción según estado:
  - DRAFT: "Marcar como Enviado" + "Editar" + "Eliminar"
  - SENT: "Aceptar" + "Rechazar"
  - ACCEPTED: (sin acciones en Spec A, las conversiones van en Spec B)
  - REJECTED/EXPIRED/COMPLETED: solo "Duplicar"
- Usa AlertDialog para confirmar transiciones
- Mutations con React Query + invalidación

### EditQuote.tsx
- Solo permite editar DRAFT (redirect si no)
- Carga datos con getQuoteById, mapea a initialData para _QuoteForm en mode="edit"

- [ ] Commit: `feat(commercial): implement quote detail view and edit functionality`

---

## Task 7: PDF de presupuesto

**Files:**
- Create: `src/modules/commercial/features/quotes/shared/pdf/types.ts`
- Create: `src/modules/commercial/features/quotes/shared/pdf/styles.ts`
- Create: `src/modules/commercial/features/quotes/shared/pdf/QuoteTemplate.tsx`
- Create: `src/modules/commercial/features/quotes/shared/pdf/data-mapper.ts`
- Add PDF generation action in `list/actions.server.ts`

### types.ts — QuotePDFData
- company: name, taxId, taxCondition, address, phone?, email?
- quote: number, issueDate, expirationDate?
- recipient: name, taxId?, address?, phone?, email?, type ('customer'|'lead')
- lines: code, description, quantity, unitOfMeasure, unitPrice, vatRate, subtotal, vatAmount, total, discountPercent?, discountAmount?
- totals: subtotal, vatAmount, total, vatByRate?, totalBeforeDiscount?, discountTotal?
- conditions?, notes?

### styles.ts
- Copiar de invoices pero sin headerCenter (tipo A/B/C), sin caeSection
- Agregar estilo para condiciones (similar a notes)
- Header simplificado: empresa a la izquierda, "PRESUPUESTO" + número a la derecha

### QuoteTemplate.tsx
- Header: datos empresa + "PRESUPUESTO N° Q-XXXX"
- Datos destinatario (sin condición fiscal ya que no es fiscal)
- Fecha emisión + vencimiento
- Tabla de productos (mismo formato que facturas, con Dto. condicional, números formateados con separador de miles)
- Totales con descuentos
- Condiciones (si tiene)
- Notas (si tiene)

### data-mapper.ts
- `mapQuoteDataForPDF(quote, company)` — convierte datos de BD a QuotePDFData

- [ ] Commit: `feat(commercial): implement quote PDF generation`

---

## Task 8: Sidebar + rutas + integración final

**Files:**
- Modify: `src/shared/components/layout/_AppSidebar.tsx` — quitar `disabled: true` de Cotizaciones
- Update: `src/modules/commercial/features/quotes/index.ts` — exportar todos los features
- Update: `src/modules/commercial/index.ts` — si existe, agregar exports

- [ ] Verificar `npm run check-types` sin errores nuevos
- [ ] Verificar `npm run lint` sin errores nuevos
- [ ] Commit: `feat(commercial): enable quotes module in sidebar navigation`

---

## Task 9: Verificación final

- [ ] check-types
- [ ] lint
- [ ] Test manual: crear cotización con líneas y descuentos
- [ ] Test manual: flujo DRAFT → SENT → ACCEPTED
- [ ] Test manual: vencimiento automático
- [ ] Test manual: duplicar cotización
- [ ] Test manual: descargar PDF
- [ ] Test manual: editar cotización en DRAFT
- [ ] Commit final si hay fixes pendientes
