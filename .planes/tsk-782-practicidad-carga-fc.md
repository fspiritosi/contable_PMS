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

## 4. Verificación (2026-10-20)

| Chequeo | Resultado |
|---------|-----------|
| Vitest (`npm run test`) | 71 archivos, 988 tests en verde (8 nuevos en `date-input.test.ts`, también con `TZ=UTC`) |
| `tsc --noEmit` | 93 errores en `main` y 93 en la rama: ninguno nuevo |
| ESLint sobre los 15 archivos `src/` de la rama | 6 errores previos (comillas sin escapar y `any` en líneas no tocadas), ninguno nuevo |
| `npm run build` | OK |
| Regresión en navegador (tipear 15/06/2026 tecla por tecla) | 10/10 sitios con datos en `2026-06-15`. Control sobre `main`: los 10 fallan y el asiento manual cae en "Algo salió mal — Invalid time value" |
| Devolución a socio | **Sin verificar en navegador**: dev no tiene socios con saldo adeudado y el campo solo aparece con cuotas pendientes. Mismo cableado (`<_DateInput {...field} />` + `z.date`) que recibos y OP, que sí pasaron |
| Fecha incompleta al guardar | "La fecha de emisión es requerida" y no se guarda |
| Botón Nueva Factura | Navega a `/dashboard/commercial/purchases/new`. Sin desborde a 1440, 1100 y 375 px (antes, 690 px a 375) |

Las capturas y chequeos del PDF se reproducen con `node scripts/guia-presentacion/capturas-tsk782.mjs`.

### Seguimientos detectados (fuera de alcance)

- `PurchaseInvoicesList.tsx:35`: el "Nueva Factura" del listado no está dentro de un `PermissionGuard` de `create`.
- ~~`_CreateEntryModal.tsx`: fecha por defecto `new Date()`~~ → resuelto en la sección 5.

## 5. Fecha por defecto en hora de Argentina (2026-10-20)

### 5.1 Problema

Pedido del usuario al revisar la verificación: *"el tema de horario no es aceptable, debe respetar hora
argentina"*.

Las fechas por defecto de los formularios eran `new Date()`, o sea el instante actual con hora. Producción
corre en UTC y el núcleo contable lee el día en UTC (D8). Desde las 21:00 de Argentina, ese instante ya cae
en el día siguiente en UTC:

- **Asiento manual**: `_DateInput mode="utc"` mostraba directamente el día siguiente (verificado: a las
  22:40 AR del 20/10 mostraba `2026-10-21`).
- **Formularios comerciales**: en pantalla se veía el día correcto (el navegador formatea en hora local),
  pero se guardaba `2026-10-21T01:40Z`. La integración contable usa `invoice.issueDate` como fecha del
  asiento, así que el asiento quedaba del 21 y, el último día del mes, en el período siguiente.
- **Servidor**: la factura que se genera desde un remito (`issueDate: new Date()`) y la referencia de "hoy"
  de `getCurrentFiscalYear` / `buildImputableAccountsWhere`. Los ejercicios terminan a las
  `23:59:59.999Z`: el 31/12 desde las 21 h, el "ejercicio en curso" pasaba a ser el siguiente.

### 5.2 Decisión

- **D5.** "Hoy" es el día calendario de Argentina. `BUSINESS_TIME_ZONE` y `todayBusinessDay()` pasan de
  `accounting/shared/utils/utc-month.ts` a `src/shared/utils/business-day.ts` (comercial no puede importar
  de accounting), y `utc-month.ts` los reexporta. Siguen teniendo una sola fuente.
- `businessToday(mode)` en `date-input.ts` devuelve ese día con la convención del modo: `'local'` = 12:00
  (cae el mismo día en Argentina y en UTC) y `'utc'` = 00:00Z (D8).
- Se reemplaza en todas las fechas de negocio por defecto: los 14 formularios con `_DateInput` u otros
  inputs de fecha, más remitos, recepciones, endoso y depósito de cheques, cuotas de OC y los diálogos de
  amortización de equipos. También en el servidor: la factura desde remito, `getCurrentFiscalYear` y
  `buildImputableAccountsWhere`.
- **No** se tocan las marcas de tiempo de un evento (`createdAt`, `date` de `stockMovement`, `postedDate`,
  `terminationDate`): son instantes y están bien como tales.

### 5.3 Verificación

| Chequeo | Resultado |
|---------|-----------|
| `date-input.test.ts` | 3 tests nuevos de `businessToday`: 22:40 AR, 00:00 AR y 31/10 23:30 AR, en modo local y utc |
| Vitest completo | 71 archivos, 991 tests en verde, también con `TZ=UTC` y `TZ=America/Argentina/Buenos_Aires` (`utc-month`) |
| `tsc --noEmit` | 219 líneas de error, idénticas antes y después del cambio: ninguna nueva |
| ESLint sobre los archivos tocados | 9 errores, los mismos que antes (`any` y comillas en líneas no tocadas) |
| Navegador con el reloj en 20/10 22:40 AR (`timezoneId` AR) | Asiento manual `2026-10-20` (control con el código previo: `2026-10-21`). Factura de compra `2026-10-20` |
