# TSK-782 — Practicidad para cargar facturas de compra

Ticket: TSK-782 (Contable PMS). Reportado por Elizabeth Perez (PMS) desde el widget, 2026-10-19.
Rama: `fix/tsk-782-practicidad-carga-fc`.

## 1. Análisis

### 1.1 Problema

En palabras de la cliente:

> Estoy poniéndome al día con la carga de facturas y podría tener un botón de "nueva factura" o algo así
> y no volver de cero a entrar a facturas compra, "nueva factura". Y también, algo que siempre no anda
> bien, es la fecha. Pones el día, bien, pones mes, y la fecha se pone DD. Después la podés corregir
> pero SIEMPRE :)

Son dos pedidos independientes:

1. **Atajo para cargar la siguiente factura.** Al guardar, el formulario lleva al detalle
   (`_PurchaseInvoiceForm.tsx:394`); para cargar otra hay que volver al listado. En la captura marcó el
   encabezado del detalle, a la izquierda de "Descargar PDF".
2. **La fecha se borra al tipearla.** Siempre, no de forma intermitente.

### 1.2 Reproducción y causa raíz (fecha)

Reproducido en dev (`:3010`, Chrome, `locale: es-AR`) con un script de Playwright que tipea `15062026`
en "Fecha de Emisión" de *Nueva factura de compra* y registra cada evento `input`:

```
valor inicial: 2026-10-20
tecla 1 → "2026-10-01"
tecla 5 → "2026-10-15"   ← día bien
tecla 0 → ""             ← mes a medio tipear: el navegador manda ""
tecla 6 → ""   …         ← el input quedó en dd/06/2026
```

Causa (`_PurchaseInvoiceForm.tsx:681-682`):

```tsx
value={moment(field.value).format('YYYY-MM-DD')}
onChange={(e) => field.onChange(new Date(e.target.value + 'T12:00:00'))}
```

Mientras un segmento está incompleto, `<input type="date">` reporta `value === ''`. El `onChange` arma
`new Date('T12:00:00')` (fecha inválida), `moment(…).format()` devuelve `"Invalid date"`, React lo
asigna al input y el navegador lo vacía, conservando solo el segmento que se está tipeando. El valor que
llega al formulario es un `Date` inválido.

### 1.3 Alcance del patrón

De los 54 archivos con `type="date"`, los que asignan el string tal cual o contemplan el vacío
(`e.target.value ? … : null` con `value={field.value ? … : ''}`) no tienen el problema. Sí lo tienen
(convierten `''` en fecha inválida):

| # | Archivo | Campo | Convención |
|---|---------|-------|------------|
| 1 | `purchases/features/invoices/create/components/_PurchaseInvoiceForm.tsx:681` | `issueDate` | mediodía local |
| 2 | `sales/features/invoices/create/components/_InvoiceForm.tsx:1065` | `issueDate` | mediodía local |
| 3 | `quotes/create/components/_QuoteForm.tsx:812` | `issueDate` | mediodía local |
| 4 | `treasury/features/receipts/list/components/_CreateReceiptModal.tsx:252` | `date` | mediodía local |
| 5 | `treasury/features/payment-orders/list/components/_CreatePaymentOrderModal.tsx:549` | `date` | mediodía local |
| 6 | `treasury/features/partners/features/detail/components/_PartnerRepaymentDialog.tsx:428` | `date` | mediodía local |
| 7-8 | `sales/features/reports/components/_ReportSelector.tsx:75,85` | `startDate`, `endDate` (estado) | mediodía local |
| 9-10 | `purchases/features/reports/components/_ReportSelector.tsx:104,114` | `startDate`, `endDate` (estado) | mediodía local |
| 11 | `accounting/features/entries/components/_CreateEntryModal.tsx:127` | `date` (asiento manual) | **00:00 UTC** (D8, TSK-760) |

Rutas relativas a `src/modules/commercial/features/` salvo la 11. El 11 es más grave: arma el valor con
`toISOString()`, que con una fecha inválida lanza `RangeError` al tipear el mes.

### 1.4 Restricciones

- Fechas con `moment` (nunca date-fns). Client components con prefijo `_`.
- El asiento manual usa la convención D8 de TSK-760 (día calendario a las 00:00 UTC, ver
  `accounting/shared/utils/utc-month.ts`). El resto usa mediodía local (`'T12:00:00'`). **El arreglo no
  cambia la fecha que se guarda en ningún sitio**, solo cómo se tipea.
- Testing real: Vitest en entorno `node`, sin testing-library. La lógica pura se prueba con Vitest; el
  tipeo, en el navegador con Playwright.

## 2. Planificación

### 2.0 Decisiones adoptadas (con el usuario, 2026-10-20)

- **D1.** Se arreglan los 11 sitios de la tabla (los 4 inputs de reportes cuentan por separado: 12
  inputs) con un componente compartido `_DateInput`. Los ~40 inputs que ya funcionan no se tocan.
- **D2.** El atajo es un botón **"Nueva Factura"** en el encabezado del detalle de la factura de compra,
  a la izquierda de "Descargar PDF", con el permiso `commercial.purchases` / `create`. No se agrega
  "Guardar y cargar otra" al formulario.
- **D3.** Mientras la fecha está incompleta, `_DateInput` emite `null`. Si se guarda así, el
  formulario muestra el mensaje de "fecha requerida" que ya existe, en lugar de guardar en silencio la
  fecha anterior. Los reportes desactivan "Generar" hasta que ambas fechas estén completas.
- **D4.** `_DateInput` guarda localmente el texto que se está tipeando, para que el formulario pueda
  recibir `null` (o ignorarlo) sin que React pise lo que el usuario escribe.

### 2.1 Fases

#### Fase 1: Conversión pura string ↔ fecha (TDD)
`src/shared/utils/date-input.ts` + `date-input.test.ts`. Casos: vacío, incompleto, inválido
(`2026-02-30`), año de 4 dígitos en curso (`0002-06-15`), modo local (mediodía) y modo UTC (00:00Z), y
el viaje de ida y vuelta en ambos modos sin correr el día.

#### Fase 2: Componente `_DateInput`
`src/shared/components/common/_DateInput.tsx`. Envuelve `Input` de shadcn y acepta todas sus props
salvo `type`/`value`/`onChange`/`defaultValue`.

#### Fase 3: Reemplazo en los 11 sitios
Uno por archivo, sin otros cambios. En los reportes, el estado pasa a `Date | null` y "Generar" se
desactiva con fechas incompletas. En el asiento manual, el input pasa por `Controller` (el modal no
usa `FormField`) y `journalEntrySchema.date` recibe el mensaje `'La fecha es requerida'`.

#### Fase 4: Botón "Nueva Factura" en el detalle
`PurchaseInvoiceDetail.tsx`: `Link` a `/dashboard/commercial/purchases/new` dentro de
`PermissionGuard` `create`. El encabezado tiene que seguir entrando a 375 px.

#### Fase 5: Verificación en navegador y capturas
Script de Playwright que tipea día → mes → año en los sitios de la tabla y verifica el valor final,
más las capturas para la presentación (antes/después de la fecha, botón en desktop y móvil).

#### Fase 6: Documentación
Guía in-app (`_CommercialGuide.tsx`, sección Facturas de Compra), `docs/architecture/project-structure.md`
(nuevo componente compartido), `docs/conventions/` (usar `_DateInput` para fechas tipeables) y la
presentación al cliente (`scripts/guia-presentacion/tsk-782.html` → PDF en `docs/presentaciones/`).

#### Fase 7: Verificación final
`npm run check-types`, `npm run lint`, `npm run test`, `npm run build`.

### 2.2 Fuera de alcance

- El "Nueva Factura" del listado de facturas de compra no está dentro de un `PermissionGuard` de
  `create` (`PurchaseInvoicesList.tsx:35`). Se anota; no se cambia acá.

## 3. Diseño

### 3.1 `src/shared/utils/date-input.ts` (puro)

```ts
export type DateInputMode = 'local' | 'utc';

/** Fecha → 'YYYY-MM-DD' para `<input type="date">`; '' si no hay fecha o es inválida. */
export function toDateInputValue(date: Date | null | undefined, mode: DateInputMode = 'local'): string;

/**
 * 'YYYY-MM-DD' del input → fecha. null si está vacío o incompleto (el navegador reporta '') o no es
 * un día real. 'local' = ese día a las 12:00 locales (convención comercial); 'utc' = 00:00:00.000Z (D8).
 */
export function fromDateInputValue(value: string, mode: DateInputMode = 'local'): Date | null;
```

Parseo estricto con `moment(value, 'YYYY-MM-DD', true)` / `moment.utc(…)`.

### 3.2 `src/shared/components/common/_DateInput.tsx`

```tsx
'use client';
type Props = Omit<React.ComponentProps<'input'>, 'type' | 'value' | 'defaultValue' | 'onChange'> & {
  value: Date | null | undefined;
  onChange: (date: Date | null) => void;
  mode?: DateInputMode; // 'local' por defecto
};
```

Estado: `text` (lo que muestra el input) y `synced` (último valor externo visto). Si el valor externo
cambia (reset del formulario, carga en edición), se copia a `text` durante el render (patrón "ajustar
estado cuando cambia una prop", sin `useEffect`). En cada `change`: `setText(raw)` y
`onChange(fromDateInputValue(raw, mode))`. Como `text` refleja lo que el navegador ya tiene, React
nunca reescribe el input a mitad del tipeo, emita lo que emita el formulario.

### 3.3 Sitios (diff conceptual)

```tsx
// antes
<Input type="date" value={moment(field.value).format('YYYY-MM-DD')}
       onChange={(e) => field.onChange(new Date(e.target.value + 'T12:00:00'))} />
// después
<_DateInput value={field.value} onChange={field.onChange} />
```

Asiento manual: `<Controller name="date" … render={({ field }) => <_DateInput mode="utc" … />} />`.

### 3.4 Botón en el detalle

```tsx
<PermissionGuard module="commercial.purchases" action="create">
  <Button variant="outline" asChild>
    <Link href="/dashboard/commercial/purchases/new"><Plus className="mr-2 h-4 w-4" />Nueva Factura</Link>
  </Button>
</PermissionGuard>
```
