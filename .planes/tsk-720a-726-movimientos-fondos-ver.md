# TSK-720a + TSK-726 — Movimientos de Fondos: ver en solo lectura, sin columna de asiento, modal responsive

**Fecha de inicio:** 2026-10-06
**Estado:** Implementación en progreso (Fase 7 de 8 completada)

---

## 1. Análisis

### 1.1 Problema

Tres pedidos sobre **Tesorería → Movimientos de Fondos** (`/dashboard/commercial/treasury/fund-movements`):

1. **TSK-720a — Quitar la columna "Asiento"** del listado. Hoy muestra `N° {journalEntryNumber}` o "—" (`list/columns.tsx:111-121`, `id: 'asiento'`).
2. **TSK-720a — Acción "Ver"** en el menú de cada fila, para **cualquier estado** (Borrador, Confirmado, Anulado), que abra **el mismo formulario del modal** de alta/edición con todos los campos en solo lectura. Hoy un movimiento confirmado o anulado no tiene ninguna acción: el menú solo existe en borradores (`list/columns.tsx:129-130`) y la columna de acciones ni siquiera se agrega si el usuario no tiene `update` ni `delete` (`list/columns.tsx:124`). Es decir, hoy no hay forma de consultar los conceptos de un gasto bancario confirmado ni el socio/fondos de un movimiento ya cerrado salvo por las columnas del listado.
3. **TSK-726 — Modal desbordado en celular.** A 375 px el `DialogContent` del modal mide 411 px: la X de cerrar queda fuera de pantalla y hay scroll horizontal, con cualquiera de los 4 tipos.

**Criterio de aceptación de TSK-726:** a 375 px, con los 4 tipos (`PARTNER_CONTRIBUTION`, `PARTNER_WITHDRAWAL`, `ACCOUNT_TRANSFER`, `BANK_CHARGES`), el `DialogContent` cumple `bbox.x ≥ 0` y `x + width ≤ 375`, no hay scroll horizontal y la X es visible.

**Fuera de alcance (explícito):** tipos de movimiento configurables y el vínculo/alimentación de movimientos de fondos desde movimientos bancarios — eso es **TSK-720b**, pendiente de respuesta de la clienta.

### 1.2 Contexto actual

#### Listado y menú de acciones

- `list/FundMovementsList.tsx:11-15` (Server Component) trae en paralelo `getFundMovements`, `getModulePermissions('commercial.treasury.fund-movements')` y `getFundMovementCatalogs`, y envuelve todo en `PermissionGuard module="commercial.treasury.fund-movements" action="view" redirect` (`:18`). Cualquiera que ve la tabla ya tiene `view`.
- `list/columns.tsx:46-170` — `getColumns({ onEdit, onConfirm, onDelete, permissions })`. Columnas: Fecha, Tipo, Descripción, Origen (`fundOutLabel`), Destino (`fundInLabel`), Socio (`partnerName`), Monto, Estado, **Asiento** (`:111-121`) y, condicionalmente, acciones (`:124-167`): `if (!isDraft) return null` (`:130`), Confirmar/Editar con `canUpdate`, Eliminar con `canDelete`.
- `list/components/_FundMovementsTable.tsx` (197 líneas): estados `createOpen`, `editing`, `confirming`, `deleting` (`:57-61`); `getColumns` memoizado (`:65-74`); monta **dos instancias** del modal: alta (`:130-139`) y edición con `movement={editing}` (`:142-152`); dos `AlertDialog` para confirmar/eliminar.

#### El modal (`list/components/_CreateFundMovementModal.tsx`, 541 líneas)

- Props (`:63-75`): `open`, `onOpenChange`, catálogos (`banks`, `cashRegisters`, `partners`), cuentas por defecto (`defaultContributionsAccount`, `defaultBankChargesAccount`), `movement?` ("presente = modo edición") y `onSuccess`. El modo se deriva solo de `isEdit = Boolean(movement)` (`:93`).
- `useForm` + `zodResolver(fundMovementSchema)` (`:96-108`).
- Conceptos: `useQuery(['fund-movement-detail', id], getFundMovementById)` **solo si** `open && movement?.type === 'BANK_CHARGES'` (`:113-117`). Cuentas de conceptos: `useQuery(['fund-movement-line-accounts', ids], getFundMovementLineAccounts(ids))` siempre que esté abierto (`:125-130`); `includeIds` preserva cuentas guardadas aunque ya no sean imputables.
- `useEffect` de precarga con guarda `appliedDetailRef` para no pisar lo tecleado (`:144-191`), y otro `useEffect` que limpia campos que dejan de aplicar al cambiar el tipo (`:224-237`).
- `persist`/`submit` (`:239-279`) — crear, actualizar, confirmar.
- `renderFundOptions` (`:281-304`) — `SelectGroup` Bancos/Cajas a partir de los catálogos.
- JSX (`:306-540`): `DialogContent className="sm:max-w-[560px] max-h-[90vh] overflow-y-auto"` (`:308`); título "Editar…/Nuevo…" (`:310-312`); descripción fija "Se guarda como borrador editable…" (`:313-316`); `<form className="min-w-0 space-y-4">` (`:320`); campos: Tipo (`:321-344`), aviso "no hay cuentas/cajas" (`:346-354`), Fecha (+ Monto en grid `md:grid-cols-2` salvo BANK_CHARGES, `:356-406`), Destino (`:408-431`), Origen (`:433-456`), `_FundMovementLinesField` (`:458-463`), Socio (`:465-490`), `_PartnerAccountNotice` (`:492-497`), Descripción (`:499-511`); footer Cancelar / Guardar / Guardar y Confirmar (`:513-535`).
- Subcomponentes:
  - `_FundMovementLinesField.tsx` (143 líneas): `useFieldArray('lines')`; botón "Agregar concepto" (`:63-71`); fila por concepto `flex items-start gap-2` con `AccountCombobox className="flex-1"` + `Input flex-1` + `MoneyInput w-36 shrink-0` + botón tacho (`:83-124`); total (`:130-132`); `_BankChargesDefaultNotice` siempre visible (`:137-140`).
  - `_BankChargesDefaultNotice.tsx` (77 líneas): 3 estados sobre la cuenta por defecto de **conceptos nuevos**; texto en futuro ("Los conceptos nuevos se imputan a…").
  - `_PartnerAccountNotice.tsx` (95 líneas): anticipa a qué cuenta **se imputará** el asiento según el socio; texto en futuro y con "No vas a poder confirmar".

#### Datos disponibles (`list/actions.server.ts`)

- `getFundMovements` (`:48-77`): `findMany` **sin `select`** → devuelve todos los escalares del modelo: `status`, `date`, `type`, `amount` (convertido con `Number()`, `:69`), `description`, `fundOutKind/Id/Label`, `fundInKind/Id/Label`, `partnerId`, `partnerName`, `journalEntryId`, `journalEntryNumber`, `confirmedAt`, `createdBy`, `createdAt`, `updatedAt`. `FundMovementListItem` (`:977`) ya trae **todo lo que la vista necesita**, salvo los conceptos. `Date` se serializa sin problema a Client Components; el único `Decimal` (`amount`) ya está convertido.
- `getFundMovementById` (`:79-95`): `include: { lines }` ordenadas por `position`, con `amount` de cabecera y de líneas convertidos a `Number()`. Las líneas traen `accountId` pero **no** código/nombre de la cuenta (se resuelven contra `lineAccounts` en el combobox). Tiene `checkPermission(..., 'view')`: sirve tal cual para "Ver".
- `getFundMovementCatalogs` (`:101-157`): bancos `status: 'ACTIVE'`, **cajas solo con sesión `OPEN`** (`:112-116`), socios `isActive: true`. Para un movimiento viejo, el banco/caja/socio puede **no estar en el catálogo** → el `Select` muestra el placeholder "Seleccionar banco o caja"/"Seleccionar socio" aunque el movimiento lo tenga. Por eso el modelo guarda los **snapshots** `fundOutLabel`, `fundInLabel`, `partnerName` (`prisma/schema.prisma:4378, 4382, 4385`), que el listado ya usa.
- `getFundMovementLineAccounts(includeIds)` (`:167-189`): imputables de egreso/activo + las ya guardadas (`OR`), pero aplica `filterExpenseAccounts` **después** del `OR` (`:186`): una cuenta guardada que hoy no sea de egreso/activo quedaría afuera (caso borde).
- Modelo `FundMovement` (`prisma/schema.prisma:4366-4400`): `confirmedAt` y `journalEntryNumber` se setean al confirmar (`actions.server.ts:931-934`). No hay campo de "anulado por"/"fecha de anulación".

#### Permisos

- Módulo: `'commercial.treasury.fund-movements'` (`src/shared/lib/permissions/constants.ts:49`). Todas las actions lo usan: `view` en queries (`actions.server.ts:49, 80, 102, 168`), `create` (`:622`), `update` en editar y confirmar (`:687, :755`), `delete` (`:953`).
- `ModulePermissions` expone `canView` (`src/shared/lib/permissions/getModulePermissions.server.ts:19`).
- No se crea módulo nuevo → no aplica `.claude/rules/modules.md` (registro en `ACTIVATABLE_MODULES`).

#### Precedentes en el proyecto

- No existe ningún formulario reutilizado en modo solo lectura (`grep readOnly|fieldset` en `src/modules` solo encuentra `auth/features/sign-up/components/_SignUpForm.tsx`, que no es el caso).
- Otros listados de Tesorería tienen "Ver Detalle" con `Eye` (`treasury/features/receipts/list/columns.tsx:4, 95-96`), pero navegan a una página de detalle; acá se pidió reusar el modal.
- No hay página de detalle de asiento (`src/app/(core)/dashboard/company/accounting/entries/` solo tiene `page.tsx`), así que el N° de asiento en la vista sería texto, sin link.

#### TSK-726 — Causa del desborde (verificada en navegador)

Verificado con Playwright contra el dev server (`:3010`) en dos modos de emulación a 375×812:

| Modo | `innerWidth` | `documentElement.scrollWidth` | `DialogContent` x / width / right | X (right) |
|---|---|---|---|---|
| Viewport 375, `isMobile: false` | 375 | **443** | 16 / 343 / 359 | 342 ✅ |
| Viewport 375, `isMobile: true` (celular real) | **443** | **443** | 16 / **411** / **427** ❌ | 410 ❌ |
| `isMobile: true` + paginación con `flex-wrap` (CSS inyectado) | 375 | 375 | 16 / 343 / 359 ✅ | 342 ✅ |

Los 4 tipos dan exactamente los mismos números; **el contenido del modal no desborda** en ningún caso (`dialog.scrollWidth === dialog.clientWidth`, ningún hijo excede el ancho interno salvo el propio botón X absoluto).

**Causa raíz:** la **página de fondo** es más ancha que el viewport: `documentElement.scrollWidth = 443`. El único elemento que desborda sin un ancestro que lo recorte es la barra de paginación de la `DataTable` compartida: `src/shared/components/common/DataTable/DataTablePagination.tsx:65` (`flex items-center space-x-6 lg:space-x-8`, ~350 px de ancho fijo: "Filas por página" + select `w-[70px]` + "Página 1 de 1" `w-[100px]` (`:89`) + botones), dentro de `:50` (`flex items-center justify-between px-2`, sin `flex-wrap`), al lado del texto "Mostrando X a Y de Z registros". Termina en `right = 443`. En un navegador móvil (emulación `isMobile` o un teléfono real), cuando el contenido es más ancho que `device-width` el navegador ensancha el *layout viewport* hasta el ancho del contenido (443) para el zoom mínimo; los elementos `position: fixed` como el `DialogContent` se dimensionan contra ese viewport: `max-w-[calc(100%-2rem)]` = 443 − 32 = **411 px**, y `left: 50%` lo centra en 221,5 px → la X cae en 394-410, fuera de los 375 visibles.

- Con viewport de escritorio angosto (`isMobile: false`) **no se reproduce**: el layout viewport queda en 375 y el modal mide 343. Por eso el ticket sospechaba "la emulación": no es un falso positivo, es el comportamiento real de un celular.
- `src/app/layout.tsx` **no** exporta `viewport`, pero Next.js inyecta el default: verificado en el DOM `<meta name="viewport" content="width=device-width, initial-scale=1">`. El meta viewport está bien; no es la causa.
- El contenedor del dashboard no recorta el desborde: `src/shared/components/layout/DashboardLayout.tsx:55` (`flex flex-1 flex-col gap-4 p-4`, sin `min-w-0` ni `overflow-x-clip`).
- Ningún arreglo **dentro del modal** alcanza: aunque el `DialogContent` se achicara, `left: 50%` lo sigue centrando en un viewport de 443 px. Hay que eliminar el desborde de la página.
- El mismo desborde aparece en otras pantallas (medido): **Socios** (`/treasury/partners`, 443 px: paginación + toolbar "Filtros | Nuevo Socio" a 383 px) y el **Dashboard** (491 px: selector de mes y gráficos). Cualquier modal abierto sobre una `DataTable` en celular sufre lo mismo. Arreglar la paginación compartida (usada por las 108 tablas de `src/modules`) corrige todas las tablas; el Dashboard queda fuera de alcance.

**Hallazgo secundario de usabilidad (no desborda, pero a 343 px no se puede usar):** la fila de conceptos de BANK_CHARGES (`_FundMovementLinesField.tsx:83-124`) no hace wrap: con `MoneyInput w-36 shrink-0` (144 px) + tacho, el `AccountCombobox` queda en ~40 px (solo se ve el chevron) y la descripción en ~45 px ("De"). (Observado en una captura de la sesión de análisis, en el scratchpad temporal; se rehará con el script de capturas.) Conviene apilar la fila en mobile (ej. `flex-wrap` o `grid grid-cols-[1fr_auto] sm:flex`, cuenta a ancho completo arriba) — es parte natural de "modal responsive".

### 1.3 Archivos involucrados

**Modificar**

| Archivo | Cambio |
|---|---|
| `src/modules/commercial/features/treasury/features/fund-movements/list/columns.tsx` | Quitar columna `asiento` (`:111-121`); agregar `onView` a `ColumnsProps` (`:39-44`); columna de acciones siempre presente (o con `canView`) en vez de `canUpdate || canDelete` (`:124`); "Ver" (`Eye`) para todo estado y Confirmar/Editar/Eliminar solo en DRAFT (`:129-130`). Agregar `Eye` al import de `lucide-react` (`:4`). |
| `.../list/components/_FundMovementsTable.tsx` | Estado `viewing` (o unificar `editing`+`viewing` en `{ movement, mode }`), pasar `onView` a `getColumns`, montar el modal en modo vista. |
| `.../list/components/_CreateFundMovementModal.tsx` | Prop `mode: 'create' \| 'edit' \| 'view'` (reemplaza a derivar el modo de `movement`); campos deshabilitados, título/descripción por modo, avisos ocultos en vista, footer "Cerrar", carga de conceptos también en vista, snapshot de fondos/socio; ya excede 200 líneas → extraer partes (ver 1.5 y 1.6-D5). |
| `.../list/components/_FundMovementLinesField.tsx` | Prop `readOnly`/`disabled`: ocultar "Agregar concepto" y tachos, deshabilitar `AccountCombobox`/`Input`/`MoneyInput`, ocultar `_BankChargesDefaultNotice`; fila responsive (wrap en mobile). |
| `src/shared/components/common/DataTable/DataTablePagination.tsx` | Causa raíz de TSK-726: `:50` y `:65` con `flex-wrap` (o `flex-col sm:flex-row`), y opcionalmente ocultar "Filas por página" (`:68`) en mobile. Impacta a todas las tablas. |
| `src/modules/help/features/guide/components/_TreasuryGuide.tsx` | Sección "Movimientos de Fondos" (`:907` en adelante; el párrafo "Desde el listado podés Editar, Confirmar o Eliminar un borrador…" está en `:1005-1007` aprox.): documentar "Ver" para cualquier estado y que el N° de asiento ahora se consulta en Ver. |
| `docs/modules/commercial.md` | Sección "Socios y Movimientos de Fondos" (`:258`): acción Ver / modo solo lectura del modal. |
| `src/shared/components/common/DataTable/DOCS.md` | Si cambia el layout de la paginación, anotarlo (responsive). |

**Crear (sugerido, a confirmar en Diseño)**

| Archivo | Para qué |
|---|---|
| `.../list/components/_FundMovementViewSummary.tsx` | Bloque de solo lectura para modo vista: Estado (badge), fecha de confirmación (`confirmedAt`), Asiento N° (`journalEntryNumber`). |
| `.../list/components/_FundSelectField.tsx` (o similar) | Select de banco/caja reutilizado por Origen y Destino (hoy duplicado en `:408-456`), con fallback al snapshot cuando el valor no está en el catálogo. |
| `.../shared/view-mode.ts` + `view-mode.test.ts` | Lógica pura testeable con Vitest (entorno `node`, solo `*.test.ts`, sin Testing Library): acciones visibles por estado/permiso, opciones con snapshot, valores del form a partir del movimiento. |
| `scripts/guia-presentacion/capturas-tsk720a-726.mjs` | Capturas y verificación en navegador: menú con Ver en los 3 estados, vista de cada tipo, criterio de aceptación de TSK-726 con `isMobile: true` a 375 px para los 4 tipos. |
| `scripts/guia-presentacion/tsk-720a-726.html` | Guía de presentación para la clienta (patrón `tsk-583.html`, PDF con `generar-pdf.mjs`). |

**Solo lectura / referencia**

- `list/actions.server.ts:48-95` (`getFundMovements`, `getFundMovementById`) — alcanzan sin cambios.
- `list/FundMovementsList.tsx` — sin cambios (ya pasa `permissions`).
- `src/shared/components/ui/dialog.tsx:55` — base `grid w-full max-w-[calc(100%-2rem)] … overflow-auto sm:max-w-lg`; no necesita cambios para TSK-726.
- `src/shared/components/common/AccountCombobox.tsx:34, 80` — ya acepta `disabled` (lo pasa al `Button` trigger del `Popover`).
- `src/shared/components/ui/money-input.tsx:60-72` — reenvía `...props` al `Input` → acepta `disabled`/`readOnly`.
- `src/shared/components/ui/select.tsx:27-44` — `SelectTrigger` con `disabled:opacity-50`; Radix `Select` acepta `disabled` en el Root.
- `src/shared/components/ui/input.tsx` — `min-w-0`, `disabled:opacity-50`.

### 1.4 Dependencias

- **Sin cambios de schema ni migraciones.** Todo lo que necesita la vista ya está en `FundMovementListItem` + `getFundMovementById`.
- **Sin dependencias nuevas.** `lucide-react` ya tiene `Eye`.
- Depende de TSK-585 (conceptos `FundMovementLine`), TSK-717 (`_PartnerAccountNotice`) y TSK-718 (`_BankChargesDefaultNotice`): ya están en `main`.
- `DataTablePagination` es compartido por todas las `DataTable` (108 archivos en `src/modules` usan `<DataTable`): el cambio de TSK-726 se ve en todo el sistema. No tiene tests propios.
- Verificación en navegador: dev server en `:3010` con `NEXT_PUBLIC_APP_URL=http://localhost:3010`; requiere el contenedor `contable-pms-db` arriba (estaba detenido; se levantó con `docker start contable-pms-db` durante el análisis). Para reproducir TSK-726 **hay que** usar `isMobile: true` en el contexto de Playwright; con solo `viewport: 375` no se reproduce.
- TSK-720b (fuera de alcance) tocará probablemente el mismo modal (tipos configurables): conviene que la prop `mode` y las extracciones de este ticket no asuman los 4 tipos fijos más de lo que ya lo hacen.

### 1.5 Restricciones y reglas

- **Client Components con prefijo `_`** (CLAUDE.md, regla de oro 4): los nuevos componentes del modal van como `_*.tsx` dentro de `list/components/`.
- **Componentes < 200 líneas** (checklist de CLAUDE.md): `_CreateFundMovementModal.tsx` ya tiene 541 líneas y el modo vista suma más. Este ticket es una buena oportunidad de extraer al menos: el select de banco/caja duplicado (`:408-456`), el footer por modo, el resumen de vista y, si el diseño lo permite, la lógica de precarga/limpieza a un hook (`useFundMovementForm`). No es obligatorio dejarlo bajo 200 en este ticket (sería un refactor grande con riesgo sobre las guardas de TSK-585), pero no debe crecer sin extraer.
- **Permisos en 3 niveles** (regla de oro 11): las actions ya tienen `checkPermission('commercial.treasury.fund-movements', 'view')`; la página tiene `PermissionGuard … view redirect`; en cliente, "Ver" se muestra con `permissions.canView` (el patrón del archivo es recibir `ModulePermissions` por props, no `usePermissions()`). Confirmar/Editar siguen con `canUpdate`, Eliminar con `canDelete`.
- **React Query, nunca `useEffect`+`useState` para fetch** (regla 3): reusar el `useQuery(['fund-movement-detail', id])` existente, ampliando su `enabled` al modo vista.
- **Decimal → `Number()`** (regla 9): ya resuelto en `getFundMovements` y `getFundMovementById`; si se agrega alguna query nueva, mantenerlo.
- **moment.js** para fechas (regla 1): `confirmedAt` con `moment(...).format('DD/MM/YYYY HH:mm')` o `formatFundMovementDate` (ojo: `date` está anclada a mediodía UTC, TSK-483; `confirmedAt` es un timestamp real y se lee en local).
- **AlertDialog, nunca `confirm()`** — no aplica a la vista; los AlertDialog existentes se mantienen.
- **Logger, no `console.*`**; **no `:any`**; tipos inferidos (`FundMovementListItem`, `FundMovementRecord`).
- **`app/` solo rutas**: no hay cambios en `src/app/`.
- **Testing real = Vitest** (`npm run test`, `vitest.config.ts`: `environment: 'node'`, `include: src/**/*.test.ts`). No hay Testing Library ni jsdom → lo testeable es lógica pura extraída (acciones por estado/permiso, opciones con snapshot, mapeo movimiento → valores del form). La UI se verifica con el script Playwright de capturas. No existe `cypress/`.
- **Guía de usuario in-app** (regla 10): actualizar `_TreasuryGuide.tsx`, sección Movimientos de Fondos.
- **Docs** (regla 8): `docs/modules/commercial.md`; `DataTable/DOCS.md` si cambia la paginación.
- **Guía de presentación para la clienta**: `scripts/guia-presentacion/tsk-720a-726.html` + capturas en `scripts/guia-presentacion/assets/` con un `capturas-*.mjs`.
- **Responsive** (`ui-shadcn`): el modo vista y la fila de conceptos deben funcionar a 375 px.
- Nota: el CLAUDE.md referencia `.claude/rules/ui-shadcn.md`, `server-components.md`, `permissions.md`, `forms.md`, etc., pero en este repo `.claude/rules/` solo contiene `modules.md`; las reglas se tomaron de CLAUDE.md.

### 1.6 Riesgos identificados

**Riesgos**

1. **Cambio global en la paginación (TSK-726).** `DataTablePagination` lo usan todas las tablas; un `flex-wrap` mal pensado podría desalinear la paginación en escritorio. Mitigación: aplicar wrap solo bajo `sm` (o `flex-col sm:flex-row`) y verificar visualmente 2-3 tablas en escritorio y mobile.
2. **El modal desborda en otras pantallas por causas distintas** (toolbar de Socios a 383 px, Dashboard a 491 px). Este ticket arregla la causa en Movimientos de Fondos (y de paso todas las tablas cuya única causa es la paginación); el resto queda fuera de alcance. Dejarlo anotado para un ticket aparte.
3. **`<fieldset disabled>` y componentes Radix.** El `fieldset disabled` deshabilita nativamente `input`, `textarea` y `button` descendientes (y `:disabled` aplica los estilos), pero Radix `Select` y el `Popover` de `AccountCombobox` deciden abrir por su propio estado (`disabled` del Root / del trigger): no hay que confiar en el fieldset solo para ellos. Además **`<fieldset>` tiene `min-inline-size: min-content` por defecto**: sin `min-w-0` puede volver a provocar desborde horizontal en mobile (justo lo que arregla TSK-726).
4. **Snapshot vs. catálogo.** En vista, un banco dado de baja, una caja sin sesión abierta (`getFundMovementCatalogs` solo trae cajas `OPEN`, `actions.server.ts:112-116`) o un socio inactivo hacen que el `Select` muestre el placeholder aunque el movimiento lo tenga. Muy probable en movimientos confirmados viejos (las cajas se cierran a diario).
5. **Avisos con texto en futuro.** `_PartnerAccountNotice` ("se imputará…", "No vas a poder confirmar") y `_BankChargesDefaultNotice` ("Los conceptos nuevos se imputan a…") describen lo que va a pasar al guardar; en un movimiento confirmado/anulado son engañosos (la cuenta usada pudo cambiar después).
6. **Efectos de limpieza en vista.** El `useEffect` de `:224-237` hace `setValue` según el tipo; en vista no debería correr (no cambia nada hoy porque los datos son consistentes, pero un movimiento viejo con `sourceFund` en un aporte quedaría "limpiado" en pantalla y mostraría menos de lo guardado). Guardarlo con `if (mode === 'view') return`.
7. **Caché de `fund-movement-detail`.** La guarda `appliedDetailRef` (`:144-191`) está pensada para edición; al pasar de Ver a Editar el mismo movimiento (si se agrega ese atajo) hay que asegurarse de que el reset vuelva a aplicarse (cambia el modo, no el id).
8. **`getFundMovementLineAccounts` filtra después del `OR`** (`actions.server.ts:186`): una cuenta guardada que hoy no sea de egreso/activo no aparece y el combobox de ese concepto se ve vacío en vista. Caso borde preexistente; evaluar si en vista conviene traer código/nombre de la cuenta junto con las líneas (`include: { lines: { include: { account: { select: { code, name } } } } }`).
9. **Legibilidad en solo lectura.** `disabled:opacity-50` en `Input`/`SelectTrigger` deja el texto a media opacidad: puede quedar poco legible justo cuando el objetivo es leer.
10. **Tamaño del modal.** Agregar el modo vista sin extraer lleva el archivo a ~600 líneas; refactorizar demasiado arriesga las guardas de TSK-585 (cubiertas por tests de integración de actions, no del componente).

**Decisiones abiertas (con recomendación)**

- **D1 — Cómo implementar la solo lectura.** Opciones: (a) prop `mode: 'create' | 'edit' | 'view'` y `disabled` explícito en cada control; (b) envolver los campos en `<fieldset disabled={isView}>`; (c) componente de vista separado (no cumple "el mismo formulario").
  **Recomendación:** (a)+(b) combinados: prop `mode` como fuente de verdad, `<fieldset disabled={isView} className="min-w-0 space-y-4">` alrededor de los campos (cubre `Input`, `Textarea`, `MoneyInput` y botones) **más** `disabled={isView}` explícito en los tres `Select` de Radix y en `AccountCombobox`. El footer queda fuera del fieldset. Reemplazar `isEdit = Boolean(movement)` por `mode`.
- **D2 — Estilo de los campos en vista.** `disabled` (opacidad 50 %) vs. `readOnly` (no aplica a Radix Select ni al combobox).
  **Recomendación:** usar `disabled` por consistencia y accesibilidad (no enfocables, no editables), pero neutralizar la opacidad en vista con una clase en el contenedor (ej. `[&_:disabled]:opacity-100 [&_:disabled]:cursor-default`) para que se lea bien. Validar en las capturas.
- **D3 — Datos extra en la vista.** ¿Mostrar estado, fecha de confirmación, N° de asiento?
  **Recomendación:** sí, en un bloque de solo lectura arriba de los campos (`_FundMovementViewSummary`): Estado (mismo badge que la tabla), "Confirmado el" (`confirmedAt`, solo si existe) y "Asiento N°" (`journalEntryNumber`, solo si existe; texto sin link porque no hay página de detalle de asiento). Es indispensable porque se quita la columna del listado y no habría otro lugar donde consultarlo. No mostrar `createdBy` (es un id, no un nombre).
- **D4 — Snapshot de fondos y socio en vista.** Opciones: (a) agregar al `Select` una opción "fantasma" con el snapshot (`fundOutLabel`/`fundInLabel`/`partnerName`) cuando el valor no está en el catálogo; (b) en vista reemplazar los `Select` por `Input` deshabilitado con el snapshot.
  **Recomendación:** (a), con un helper puro testeable (ej. `withSnapshotOption(options, value, label)`), dentro de un `_FundSelectField` que además elimina la duplicación Origen/Destino. Mantiene "el mismo formulario" y muestra lo que realmente se guardó. Aplicarlo solo en vista (en edición, ofrecer un fondo que ya no es válido llevaría a un error del servidor al guardar; eso es otro problema).
- **D5 — Avisos en vista.** **Recomendación:** ocultar en vista `_PartnerAccountNotice`, `_BankChargesDefaultNotice` y el aviso "No hay cuentas bancarias ni cajas…" (`:346-354`); ocultar también "Agregar concepto" y los tachos. Mantener el total de conceptos.
- **D6 — Título, descripción y footer en vista.** **Recomendación:** título "Movimiento de Fondos" (o "Ver Movimiento de Fondos"), descripción según estado (ej. borrador: "Borrador: todavía no movió saldos ni generó asiento"; confirmado: "Confirmado: ya actualizó el saldo y generó su asiento"; anulado: "Anulado"), footer con un único botón "Cerrar".
- **D7 — ¿Atajo "Editar" desde la vista de un borrador?** **Recomendación:** no en este ticket. El menú ya ofrece Editar en borradores; agregar el cambio de modo dentro del modal suma complejidad con la guarda `appliedDetailRef` (riesgo 7) sin que la clienta lo haya pedido.
- **D8 — Una, dos o tres instancias del modal.** **Recomendación:** unificar edición y vista en una sola instancia con estado `selected: { movement, mode: 'edit' | 'view' } | null`, y mantener la de alta aparte. Si el diseño prefiere menos cambios, una tercera instancia `viewing` también es válida (las queries solo corren con `open`).
- **D9 — Visibilidad de la columna de acciones.** Hoy se agrega solo con `canUpdate || canDelete` (`columns.tsx:124`). **Recomendación:** agregarla con `canView || canUpdate || canDelete` (en la práctica, siempre, porque la página exige `view`), con "Ver" primero (`Eye`), separador, y Confirmar/Editar/Eliminar solo en `DRAFT`. Extraer la regla "qué acciones ve esta fila" a una función pura testeada.
- **D10 — Alcance del arreglo de TSK-726.** Opciones: (a) arreglar `DataTablePagination` (causa raíz, global); (b) red de seguridad en `DashboardLayout.tsx:55` con `min-w-0 overflow-x-clip` para que ningún desborde de página ensanche el layout viewport; (c) ambas.
  **Recomendación:** (a) obligatorio — es la causa verificada y beneficia a todas las tablas. (b) como red de seguridad es tentadora (arreglaría también Socios y Dashboard) pero puede recortar contenido que hoy se ve con scroll (gráficos del Dashboard, toolbars) y su impacto es mucho más amplio: dejarla como decisión explícita del usuario o para un ticket aparte. Usar `overflow-x-clip` y no `overflow-x-hidden` si se adopta (hidden crea un contenedor de scroll y rompe `position: sticky`).
- **D11 — Fila de conceptos en mobile.** **Recomendación:** incluirlo en este ticket (es "modal responsive"): en `< sm` la cuenta ocupa toda la fila y debajo van descripción + importe + tacho (`flex-wrap` con `basis-full sm:basis-auto` en el combobox, o grid). Verificarlo en la misma pasada de capturas.
- **D12 — Cuenta de cada concepto en vista (riesgo 8).** **Recomendación:** no cambiar la query en este ticket salvo que aparezca en las capturas; documentarlo como caso borde. Si el diseño lo quiere cubrir, agregar `account: { select: { code, name } }` a las líneas de `getFundMovementById` y usarlo como snapshot del combobox, igual que D4.

---

## 2. Planificación

Ocho fases que van de lo puro a lo visible: helpers puros con TDD → arreglo de la causa raíz de
TSK-726 en la paginación compartida (y la fila de conceptos) → refactor del modal **sin cambio
de comportamiento** para bajarlo de 541 a < 200 líneas → modo vista → listado (sin columna
"Asiento", con "Ver") → verificación en navegador con capturas → documentación y presentación →
verificación final. Sin cambios de schema, migraciones ni actions del servidor.

Rutas abreviadas: `FM/` = `src/modules/commercial/features/treasury/features/fund-movements/`.

### 2.0 Decisiones adoptadas

Se adoptan **todas** las recomendaciones del análisis (1.6), con la precisión del líder en D10.

| # | Decisión adoptada |
|---|---|
| D1 | Prop `mode: 'create' \| 'edit' \| 'view'` como única fuente de verdad (reemplaza `isEdit = Boolean(movement)`). Los campos van dentro de `<fieldset disabled={isView} className="min-w-0 space-y-4">` (cubre `Input`, `Textarea`, `MoneyInput`, botones) **y además** `disabled={isView}` explícito en los tres `Select` de Radix (Tipo, fondos, Socio) y en cada `AccountCombobox`. El footer queda **fuera** del fieldset. |
| D2 | `disabled` (no `readOnly`). En vista, el contenedor neutraliza la opacidad: `[&_:disabled]:opacity-100 [&_:disabled]:cursor-default`. **Precisión (ambigüedad de especificidad):** `.x :disabled` y `.disabled\:opacity-50:disabled` empatan en especificidad y gana el orden del CSS generado; si en la captura el texto sigue al 50 %, usar la variante con `!` (`[&_:disabled]:opacity-100!`). Se valida en la Fase 6. |
| D3 | Bloque de solo lectura `_FundMovementViewSummary` arriba de los campos: Estado (mismo badge que la tabla), "Confirmado el" (`confirmedAt`, `moment(...).format('DD/MM/YYYY HH:mm')`, solo si existe) y "Asiento N°" (`journalEntryNumber`, solo si existe, texto sin link). No se muestra `createdBy`. |
| D4 | Opción "fantasma" con el snapshot (`fundOutLabel` / `fundInLabel` / `partnerName`) cuando el valor guardado no está en el catálogo, vía helper puro `withSnapshotOption`. **Solo en modo vista.** Se implementa dentro de `_FundSelectField` (que también elimina la duplicación Origen/Destino) y de `_PartnerSelectField`. |
| D5 | En vista se ocultan `_PartnerAccountNotice`, `_BankChargesDefaultNotice`, el aviso "No hay cuentas bancarias ni cajas…", "Agregar concepto" y los tachos. Se mantiene el total de conceptos. |
| D6 | Vista: título "Movimiento de Fondos"; descripción por estado — Borrador: "Borrador: todavía no movió saldos ni generó asiento."; Confirmado: "Confirmado: ya actualizó el saldo del banco/caja y generó su asiento."; Anulado: "Anulado: el movimiento quedó sin efecto."; footer con un único botón "Cerrar". **Precisión:** se elige el texto literal de arriba (el análisis daba ejemplos) y vive en el helper puro `getModalCopy`. |
| D7 | Sin atajo "Editar" dentro de la vista en este ticket. |
| D8 | Una instancia para edición + vista con estado `selected: { movement, mode: 'edit' \| 'view' } \| null`, y la de alta aparte. **Precisión (más simple y sin parpadeo):** un `open` booleano aparte; al cerrar solo se pone `open=false` y `selected` se conserva, para que la animación de cierre no cambie título ni campos. |
| D9 | Columna de acciones con `canView \|\| canUpdate \|\| canDelete`; "Ver" (`Eye`) primero para todo estado; separador; Confirmar/Editar (`canUpdate`) y Eliminar (`canDelete`) solo en `DRAFT`. La regla vive en la función pura `getRowActions` testeada. |
| D10 | **Solo** se arregla `DataTablePagination.tsx` (layout responsive con `flex-wrap` y `gap` en vez de `space-x`). **No** se agrega `min-w-0 overflow-x-clip` en `DashboardLayout.tsx`. Socios (toolbar a 383 px) y Dashboard (491 px) se miden para asegurar que **no empeoran** y quedan como seguimiento (2.4). |
| D11 | Fila de conceptos responsive en este ticket: en `< sm` la cuenta ocupa toda la fila y debajo van descripción + importe + tacho. |
| D12 | No se cambia `getFundMovementLineAccounts` ni `getFundMovementById`. Se documenta como caso borde; solo se reabre si aparece en las capturas de la Fase 6. |

Otras decisiones de esta planificación:

- **Helpers puros** en `FM/shared/view-mode.ts` (junto a `validators.ts` y `lines-calc.ts`, que
  ya siguen el patrón `shared/*.ts` + `*.test.ts`). Para no importar desde un archivo
  `'use server'`, los helpers declaran tipos estructurales mínimos (`Pick<…>` sobre
  `FundMovementListItem` vía `import type`, que se borra al compilar) o reciben primitivos.
- **Hook de formulario** en `FM/list/hooks/useFundMovementForm.ts` (sin `_`: no es componente;
  la estructura de módulos admite `hooks/`). Concentra `useForm`, las dos `useQuery`, la guarda
  `appliedDetailRef`, los dos `useEffect` y `persist`/`submit`, sin tocar su lógica.
- **Línea base de tipos y lint:** el repo ya tiene errores de `check-types` preexistentes
  (en TSK-728 la línea base era 219). Se mide al empezar la Fase 1 y el criterio es "no sube".

### 2.1 Fases de implementación

#### Fase 1: Helpers puros del modo vista y de las acciones por fila (TDD)

- **Objetivo:** dejar toda la lógica decidible sin UI en un `.ts` testeado con Vitest antes de
  tocar componentes.
- **Tareas:**
  - [x] Medir línea base: `npm run check-types 2>&1 | grep -c "error TS"` y `npm run lint`;
        anotarlas en la sección 4.
  - [x] Crear `FM/shared/view-mode.test.ts` primero (rojo) y después `FM/shared/view-mode.ts` con:
    - `FundMovementModalMode = 'create' | 'edit' | 'view'`.
    - `FUND_MOVEMENT_STATUS_LABELS` (`DRAFT`→Borrador, `CONFIRMED`→Confirmado,
      `CANCELLED`→Anulado) y `fundMovementStatusVariant(status)` (`'default' | 'outline' |
      'secondary'`), movidos desde `FM/list/columns.tsx:33-37, 107` para que tabla y resumen
      de vista usen el mismo badge.
    - `getRowActions(status, { canView, canUpdate, canDelete })` →
      `{ view, confirm, edit, delete }` booleanos: `view` = `canView` en cualquier estado;
      `confirm`/`edit` = `DRAFT && canUpdate`; `delete` = `DRAFT && canDelete`. Y
      `hasAnyRowAction(perms)` = `canView || canUpdate || canDelete` (visibilidad de la columna).
    - `withSnapshotOption(options, value, snapshotLabel)` → si `value` no vacío no está entre los
      `value` de las opciones y hay `snapshotLabel`, devuelve las opciones más
      `{ value, label: snapshotLabel, isSnapshot: true }`; si no, las devuelve intactas.
    - `fundRefFrom(kind, id)` (movido desde `_CreateFundMovementModal.tsx:77-79`),
      `EMPTY_FUND_MOVEMENT_FORM_VALUES()` (con `moment().format('YYYY-MM-DD')`) y
      `formValuesFromMovement(movement, lines)` (el objeto del `form.reset` de `:160-177`, con
      `formatFundMovementDate(…, 'YYYY-MM-DD')` por TSK-483).
    - `getModalCopy(mode, status?)` → `{ title, description }` con los textos de create/edit
      actuales (`:310-316`) y los de vista por estado (D6).
    - `shouldCleanupFieldsOnTypeChange(mode)` → `mode !== 'view'` (riesgo 6) y
      `needsMovementDetail(mode, type)` → `mode !== 'create' && type === 'BANK_CHARGES'`.
  - [x] Casos de test: las 3 × 8 combinaciones relevantes de `getRowActions` (al menos: DRAFT con
        todo, CONFIRMED con todo → solo view, CANCELLED solo view, DRAFT sin update, DRAFT solo
        view); `withSnapshotOption` (valor en catálogo, fuera de catálogo con label, sin label,
        valor vacío); `formValuesFromMovement` (los 4 tipos, fecha anclada a mediodía UTC que no
        se corre un día, `partnerId` null → `''`, líneas con `amount` a string);
        `getModalCopy` para los 3 modos y 3 estados.
  - [x] `npm run test -- FM/shared/view-mode` en verde.
- **Archivos:** `FM/shared/view-mode.ts` (nuevo), `FM/shared/view-mode.test.ts` (nuevo).
- **Criterio de completitud:** tests nuevos en verde; nada de UI tocado todavía; commit
  `feat(treasury): helpers puros del modo vista de movimientos de fondos (TSK-720/726, fase 1)`.

#### Fase 2: Causa raíz de TSK-726 — paginación compartida y fila de conceptos responsive

- **Objetivo:** que ninguna `DataTable` ensanche la página en celular (layout viewport = 375) y
  que los conceptos de BANK_CHARGES se puedan usar a 343 px.
- **Tareas:**
  - [x] `src/shared/components/common/DataTable/DataTablePagination.tsx`:
    - `:50` → `flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-2`.
    - `:52` → agregar `min-w-0` al bloque "Mostrando X a Y de Z registros" (que pueda partir línea
      sin empujar).
    - `:65` → `flex flex-wrap items-center gap-x-6 gap-y-2 lg:gap-x-8` (reemplaza `space-x-6
      lg:space-x-8`, que con wrap deja márgenes colgados) y `ml-auto` para que en escritorio
      siga pegado a la derecha.
    - `:67` y `:94` → `gap-2` en vez de `space-x-2`.
    - `:89` → `w-[100px]` pasa a `min-w-[100px]` (no forzar ancho fijo).
    - En escritorio (≥ `lg`) el resultado visual debe ser idéntico al actual.
  - [x] `FM/list/components/_FundMovementLinesField.tsx:83-124`: fila con
        `flex flex-wrap items-start gap-2 sm:flex-nowrap`; `AccountCombobox` con
        `className="basis-full sm:basis-auto sm:flex-1 min-w-0"`; `Input` descripción
        `flex-1 min-w-0`; `MoneyInput` `w-32 sm:w-36 shrink-0`; tacho `shrink-0`.
  - [x] Chequeo rápido en navegador (Playwright, `isMobile: true`, 375×812) de Movimientos de
        Fondos: `documentElement.scrollWidth === 375`; y a 1440 px que la paginación de 2 tablas
        (Movimientos de Fondos y, por ejemplo, Facturas de venta) se ve igual que antes.
- **Archivos:** `src/shared/components/common/DataTable/DataTablePagination.tsx`,
  `FM/list/components/_FundMovementLinesField.tsx`.
- **Criterio de completitud:** a 375 con `isMobile: true` la página de Movimientos de Fondos no
  tiene scroll horizontal y el modal de alta mide ≤ 343 px; escritorio sin cambios visibles;
  commit `fix(datatable): la paginación ya no ensancha la página en celular; conceptos de gastos
  bancarios apilados en mobile (TSK-720/726, fase 2)`.

#### Fase 3: Refactor del modal sin cambio de comportamiento (< 200 líneas)

- **Objetivo:** partir `_CreateFundMovementModal.tsx` (541 líneas) en piezas < 200 líneas e
  introducir la prop `mode`, **sin** cambiar lo que hacen alta y edición (guardas de TSK-585
  intactas).
- **Tareas:**
  - [x] `FM/list/hooks/useFundMovementForm.ts` (nuevo): recibe `{ open, mode, movement,
        onOpenChange, onSuccess }` y devuelve `{ form, lineAccounts, movementDetail, type,
        isContribution, isWithdrawal, isTransfer, isBankCharges, isPartnerMovement, isSubmitting,
        submit }`. Mueve tal cual `useForm` (`:96-108`, con `EMPTY_FUND_MOVEMENT_FORM_VALUES()`),
        las dos `useQuery` (`:113-130`, `enabled` del detalle con `open && movement &&
        needsMovementDetail(mode, movement.type)`), `appliedDetailRef` + efecto de precarga
        (`:144-191`, con `formValuesFromMovement`; la clave de la guarda pasa a
        `${mode}:${movement.id}` por el riesgo 7), el efecto de limpieza (`:224-237`, con
        `if (!shouldCleanupFieldsOnTypeChange(mode)) return;`) y `persist`/`submit`
        (`:239-279`, con `mode === 'edit'` en lugar de `isEdit`). Conservar los comentarios de
        TSK-585/717 que explican las guardas.
  - [x] `FM/list/components/_FundSelectField.tsx` (nuevo): `FormField` + `Select` de banco/caja
        con props `name: 'sourceFund' | 'destinationFund'`, `label`, `banks`, `cashRegisters`,
        `disabled`, `snapshotLabel?`; contiene `renderFundOptions` (`:281-304`) y reemplaza los
        bloques duplicados `:408-456`.
  - [x] `FM/list/components/_PartnerSelectField.tsx` (nuevo): el `Select` de socio (`:465-490`)
        con `disabled` y `snapshotLabel?`.
  - [x] `FM/list/components/_FundMovementTypeField.tsx` (nuevo): el `Select` de tipo
        (`:321-344`) con `disabled`.
  - [x] `FM/list/components/_FundMovementAmountDateFields.tsx` (nuevo): Fecha sola en
        BANK_CHARGES o grid Monto + Fecha (`:356-406`).
  - [x] `FM/list/components/_FundMovementFormFooter.tsx` (nuevo): footer por modo — create/edit:
        Cancelar / Guardar / Guardar y Confirmar (`:513-535`); view: "Cerrar" (se usa en la
        Fase 4, pero el componente ya nace con la rama).
  - [x] `_CreateFundMovementModal.tsx`: prop `mode: FundMovementModalMode` obligatoria (la
        instancia de alta pasa `mode="create"`, la de edición `mode="edit"` en
        `_FundMovementsTable.tsx:130-152`); título/descripción desde `getModalCopy`; el componente
        queda como composición de las piezas anteriores. Objetivo < 200 líneas.
  - [x] Verificar a mano en `:3010` que alta y edición de los 4 tipos siguen igual (incluido
        reabrir un borrador BANK_CHARGES recién editado: conceptos frescos, sin pisar lo
        tecleado) y `npm run test` (incluye los `*.integration.test.ts` de fund-movements).
- **Archivos:** `FM/list/hooks/useFundMovementForm.ts`, `FM/list/components/_FundSelectField.tsx`,
  `_PartnerSelectField.tsx`, `_FundMovementTypeField.tsx`, `_FundMovementAmountDateFields.tsx`,
  `_FundMovementFormFooter.tsx` (nuevos); `_CreateFundMovementModal.tsx`,
  `_FundMovementsTable.tsx` (modificados).
- **Criterio de completitud:** `wc -l` de cada archivo tocado/nuevo < 200; alta y edición se
  comportan como antes; tests en verde; tipos sin subir de la línea base; commit
  `refactor(treasury): el modal de movimientos de fondos se parte en piezas y recibe el modo
  (TSK-720/726, fase 3)`.

#### Fase 4: Modo vista del modal

- **Objetivo:** el mismo formulario, con los datos guardados, en solo lectura y legible, para
  cualquier estado y los 4 tipos.
- **Tareas:**
  - [x] `_CreateFundMovementModal.tsx`: `const isView = mode === 'view'`; envolver los campos en
        `<fieldset disabled={isView} className={cn('min-w-0 space-y-4', isView &&
        '[&_:disabled]:opacity-100 [&_:disabled]:cursor-default')}>` (D1/D2); el `<form>` deja de
        llevar `space-y-4` propio si hace falta y el footer queda fuera del fieldset.
  - [x] Pasar `disabled={isView}` a `_FundMovementTypeField`, `_FundSelectField` (×2),
        `_PartnerSelectField` (en el `Select` Root, no solo en el trigger) y
        `snapshotLabel` = `movement.fundOutLabel` / `fundInLabel` / `partnerName` **solo** cuando
        `isView` (D4); dentro de los fields, `withSnapshotOption` sobre las opciones del catálogo
        (la opción fantasma va en un `SelectGroup` sin label o al final).
  - [x] Ocultar en vista: aviso `noFundAccounts` (`:346-354`), `_PartnerAccountNotice`
        (`:492-497`) (D5).
  - [x] `_FundMovementLinesField.tsx`: prop `readOnly?: boolean` → oculta "Agregar concepto"
        (`:63-71`), los tachos y `_BankChargesDefaultNotice` (`:137-140`); pasa
        `disabled={readOnly}` a cada `AccountCombobox` (`:83-124`); mantiene el total.
  - [x] `FM/list/components/_FundMovementViewSummary.tsx` (nuevo): bloque `rounded-md border
        p-3 text-sm` con badge de estado (`FUND_MOVEMENT_STATUS_LABELS` +
        `fundMovementStatusVariant`), "Confirmado el …" y "Asiento N° …" (D3), en grilla
        `grid gap-2 sm:grid-cols-3`; se monta arriba del fieldset solo en vista.
  - [x] `_FundMovementFormFooter` en vista: un único botón "Cerrar" (`variant="outline"`).
  - [x] `useFundMovementForm`: en vista no se llama a `persist` (el footer no lo ofrece) y el
        efecto de limpieza ya está desactivado (Fase 1/3).
- **Archivos:** `_CreateFundMovementModal.tsx`, `_FundMovementLinesField.tsx`,
  `_FundSelectField.tsx`, `_PartnerSelectField.tsx`, `_FundMovementTypeField.tsx`,
  `_FundMovementFormFooter.tsx` (modificados); `_FundMovementViewSummary.tsx` (nuevo).
- **Criterio de completitud:** con `mode="view"` (probado temporalmente desde la tabla) los 4
  tipos muestran todos sus datos, nada es editable ni abre (Select, combobox, inputs), el texto
  se lee al 100 %, un movimiento con caja cerrada o socio inactivo muestra el snapshot y no el
  placeholder; todos los archivos < 200 líneas; commit `feat(treasury): modo vista de solo
  lectura del modal de movimientos de fondos (TSK-720/726, fase 4)`.

#### Fase 5: Listado — sin columna "Asiento" y con acción "Ver"

- **Objetivo:** cumplir TSK-720a en el listado.
- **Tareas:**
  - [x] `FM/list/columns.tsx`: borrar la columna `id: 'asiento'` (`:111-121`); `ColumnsProps`
        suma `onView`; importar `Eye`; `STATUS_LABELS` y el variant del badge pasan a
        `FUND_MOVEMENT_STATUS_LABELS`/`fundMovementStatusVariant` de `view-mode.ts`; la columna
        de acciones se agrega con `hasAnyRowAction(permissions)` (`:124`) y su `cell` usa
        `getRowActions(m.status, permissions)`: "Ver" primero, `DropdownMenuSeparator` solo si
        hay acciones de borrador, luego Confirmar/Editar y Eliminar (se quita el `if (!isDraft)
        return null`, `:130`).
  - [x] `FM/list/components/_FundMovementsTable.tsx`: reemplazar `editing` por
        `selected: { movement: FundMovementListItem; mode: 'edit' | 'view' } | null` +
        `detailOpen: boolean` (D8); `onEdit` → `{ movement, mode: 'edit' }`, `onView` →
        `{ movement, mode: 'view' }`; una sola instancia del modal para edición/vista con
        `open={detailOpen}`, `onOpenChange={setDetailOpen}`, `mode={selected?.mode ?? 'view'}`,
        `movement={selected?.movement ?? null}`. Mantener el archivo < 200 líneas (hoy 197: si
        se pasa, extraer los dos `AlertDialog` a `_FundMovementConfirmDialogs.tsx`).
  - [x] Revisar que `tableId="commercial-fund-movements"` no rompa con la visibilidad de columnas
        guardada que aún mencione `asiento` (debe ignorarse sola; verificar en navegador).
- **Archivos:** `FM/list/columns.tsx`, `FM/list/components/_FundMovementsTable.tsx`
  (y eventualmente `_FundMovementConfirmDialogs.tsx`).
- **Criterio de completitud:** el listado no tiene "Asiento"; cada fila (Borrador, Confirmado,
  Anulado) tiene menú con "Ver"; los borradores además Confirmar/Editar/Eliminar según permisos;
  un rol con solo `view` ve únicamente "Ver"; commit `feat(treasury): acción Ver en movimientos
  de fondos de cualquier estado y sin columna de asiento (TSK-720/726, fase 5)`.

#### Fase 6: Verificación en navegador y capturas

- **Objetivo:** evidencia de TSK-720a y del criterio de aceptación de TSK-726, y capturas para la
  presentación.
- **Tareas:**
  - [x] `scripts/guia-presentacion/capturas-tsk720a-726.mjs` (nuevo, patrón
        `capturas-tsk728.mjs`): `chromium.launch().catch(() => chromium.launch({ channel:
        'chrome' }))`; login con `fspiritosi@codecontrol.com.ar` / `Contable2026!` contra
        `http://localhost:3010`; siembra por SQL (si no existen) movimientos marcados
        `description LIKE 'TSK720A-demo%'` de los 4 tipos, al menos uno Confirmado (con asiento),
        uno Anulado y uno cuyo socio esté inactivo o cuya caja no tenga sesión abierta (para el
        snapshot); limpia al terminar (también ante error).
  - [x] Capturas de escritorio (1440): 01 listado sin "Asiento"; 02 menú de un confirmado (solo
        "Ver"); 03 menú de un borrador (Ver + Confirmar/Editar/Eliminar); 04-07 vista de los 4
        tipos (BANK_CHARGES con conceptos y total, aporte con resumen Estado/Confirmado
        el/Asiento N°); 08 vista con snapshot de caja/socio; 09 vista de un anulado.
  - [x] Criterio TSK-726 (contexto `isMobile: true`, `hasTouch: true`, viewport 375×812) para
        **cada uno de los 4 tipos** en el modal de alta (cambiando el tipo) y en la vista: medir
        `bbox` del `[role="dialog"]` → `x ≥ 0` y `x + width ≤ 375`;
        `document.documentElement.scrollWidth ≤ window.innerWidth` y `innerWidth === 375`; la X
        (`[data-slot="dialog-close"]` o el botón "Close" del dialog) con `bbox.x + width ≤ 375` y
        visible. Imprimir tabla de resultados y fallar el script si alguno no cumple. Capturas
        mobile 10-13 (los 4 tipos) incluida la fila de conceptos apilada.
  - [x] Medir en mobile `scrollWidth` de `/dashboard/commercial/treasury/partners` (antes 443) y
        `/dashboard` (antes 491) y verificar que **no empeoran** (Socios debería bajar a ~383 por
        la toolbar; queda como seguimiento 2.4).
  - [x] Escritorio: captura de la paginación de Movimientos de Fondos y de otra tabla a 1440 para
        confirmar que no cambió; si D2 no neutraliza la opacidad, aplicar la variante con `!` y
        repetir.
  - [x] Probar un rol con solo `view` (si hay uno en dev; si no, anotar que se cubre con el test
        de `getRowActions`).
- **Archivos:** `scripts/guia-presentacion/capturas-tsk720a-726.mjs` (nuevo),
  `scripts/guia-presentacion/assets/tsk720a-726-*.png` (nuevas).
- **Criterio de completitud:** el script termina en verde con los 4 tipos cumpliendo el criterio
  de TSK-726; Socios/Dashboard no empeoran; resultados anotados en la sección 5; commit
  `test(treasury): capturas y verificación en celular de movimientos de fondos (TSK-720/726,
  fase 6)`.

#### Fase 7: Documentación — guía in-app, docs y presentación para la clienta

- **Objetivo:** entregables obligatorios del ticket.
- **Tareas:**
  - [x] `src/modules/help/features/guide/components/_TreasuryGuide.tsx` (sección "Movimientos
        de Fondos", `:907` en adelante; párrafo de acciones ~`:1005-1007`): documentar "Ver" en
        cualquier estado (qué muestra, que es de solo lectura, dónde se consulta ahora el N° de
        asiento y la fecha de confirmación) y que el listado ya no tiene la columna "Asiento".
  - [x] `docs/modules/commercial.md` (sección "Socios y Movimientos de Fondos", `:258`): modo
        `mode` del modal, acción Ver, helpers de `shared/view-mode.ts`, nuevas piezas del modal
        y el hook; agregar `view-mode.ts` a la tabla de archivos (~`:1029`); caso borde D12.
  - [x] `src/shared/components/common/DataTable/DOCS.md`: nota de que la paginación es
        responsive (wrap en mobile) y por qué (layout viewport en celulares, TSK-726).
  - [x] `scripts/guia-presentacion/tsk-720a-726.html` (nuevo, patrón `tsk-583.html`): qué
        cambió, cómo usar "Ver", dónde quedó el N° de asiento, el modal en celular antes/después;
        con las capturas de la Fase 6; generar el PDF con `generar-pdf.mjs`
        (`scripts/guia-presentacion/tsk-720a-726.pdf`).
- **Archivos:** `_TreasuryGuide.tsx`, `docs/modules/commercial.md`,
  `src/shared/components/common/DataTable/DOCS.md`, `scripts/guia-presentacion/tsk-720a-726.html`
  y `.pdf` (nuevos).
- **Criterio de completitud:** guía, docs y presentación reflejan la UI final; el PDF abre y
  muestra las capturas; commit `docs(treasury): guías, docs y presentación de Ver en movimientos
  de fondos y modal en celular (TSK-720/726, fase 7)`.

#### Fase 8: Verificación final

- **Objetivo:** cerrar con calidad y build de producción.
- **Tareas:**
  - [ ] `npm run check-types` → no sube de la línea base de la Fase 1.
  - [ ] `npm run lint` → sin errores nuevos en los archivos tocados (sin `console.*`, sin `:any`).
  - [ ] `npm run test` → en verde (unitarios nuevos + integración de fund-movements sin regresión).
  - [ ] `npm run build` → OK.
  - [ ] `wc -l` de todos los componentes nuevos/modificados del modal < 200.
  - [ ] Completar la sección 5 con los números de la Fase 6 y los resultados de esta.
- **Archivos:** este documento (sección 5).
- **Criterio de completitud:** los cuatro comandos pasan y la sección 5 está completa; si quedó
  algo por arreglar, commit `fix(treasury): … (TSK-720/726, fase 8)`.

### 2.2 Orden de ejecución

1. **Fase 1** primero: las fases 3-5 consumen sus helpers.
2. **Fase 2** es independiente (archivo compartido + fila de conceptos); va temprano para poder
   medir TSK-726 durante el resto del trabajo. Puede hacerse en paralelo con la 1.
3. **Fase 3** antes que la 4: el refactor se valida con el comportamiento actual antes de sumar
   el modo vista (riesgo 10).
4. **Fase 4** antes que la 5: la acción "Ver" del listado necesita el modo vista.
5. **Fase 5** → **Fase 6** (las capturas necesitan listado + vista + paginación final) →
   **Fase 7** (usa las capturas) → **Fase 8**.

### 2.3 Estimación de complejidad

| Fase | Complejidad | Motivo |
|---|---|---|
| 1 | Baja | Funciones puras chicas con tests. |
| 2 | Baja-Media | Pocas clases, pero archivo compartido por todas las tablas: hay que mirar escritorio. |
| 3 | **Alta** | Refactor de 541 líneas con guardas sutiles de TSK-585 (`appliedDetailRef`, limpieza por tipo, invalidación de caché). Riesgo principal del ticket. |
| 4 | Media | `fieldset` + Radix + snapshot + opacidad; validación visual. |
| 5 | Baja | Columnas y estado de la tabla. |
| 6 | Media | Siembra de datos y mediciones mobile con `isMobile: true`. |
| 7 | Media | Tres documentos + presentación con PDF. |
| 8 | Baja | Comandos y build. |

Total estimado: **media**. Sin cambios de base de datos ni del servidor.

### 2.4 Seguimientos fuera de alcance

1. **Socios** (`/treasury/partners`): la toolbar "Filtros | Nuevo Socio" sigue ensanchando la
   página a ~383 px en celular → ticket aparte (toolbar de `DataTable` responsive).
2. **Dashboard** (491 px: selector de mes y gráficos) → ticket aparte.
3. Red de seguridad `overflow-x-clip` en `DashboardLayout` descartada por el líder (D10);
   reconsiderar solo si los dos anteriores no se resuelven en origen.
4. D12: cuentas de conceptos que hoy no son de egreso/activo no aparecen en el combobox de la
   vista (`getFundMovementLineAccounts`, `actions.server.ts:186`).
5. **TSK-720b** (tipos configurables y vínculo con movimientos bancarios): pendiente de la
   clienta; la prop `mode` y las piezas extraídas no asumen los 4 tipos más que hoy.

## 3. Diseño

Rutas abreviadas: `FM/` = `src/modules/commercial/features/treasury/features/fund-movements/`.
Las referencias `archivo:línea` son del código **actual** (rama al iniciar el diseño).

### 3.1 Arquitectura de la solución

```
FundMovementsList (RSC, sin cambios)
  └─ _FundMovementsTable (client)
       ├─ DataTable ── getColumns({ onView, onEdit, onConfirm, onDelete, permissions })
       │                 └─ getRowActions / hasAnyRowAction / fundMovementStatusVariant  ◄── shared/view-mode.ts
       │               └─ DataTablePagination (shared, responsive: causa raíz TSK-726)
       ├─ _CreateFundMovementModal mode="create"              (instancia de alta)
       ├─ _CreateFundMovementModal mode={selected.mode}       (instancia única edición/vista, D8)
       │    ├─ useFundMovementForm ── useForm + useQuery×2 + precarga + limpieza por tipo
       │    │    └─ useFundMovementSubmit ── persist/submit (create/update/confirm)
       │    ├─ _FundMovementViewSummary          (solo view)
       │    └─ <fieldset disabled={isView}>
       │         ├─ _FundMovementTypeField
       │         ├─ _FundMovementAmountDateFields
       │         ├─ _FundSelectField ×2 (destino / origen) ── buildFundOptions + withSnapshotOption
       │         ├─ _FundMovementLinesField (readOnly en view)
       │         ├─ _PartnerSelectField ── withSnapshotOption
       │         ├─ _PartnerAccountNotice (oculto en view)
       │         └─ Descripción (inline)
       │       _FundMovementFormFooter (fuera del fieldset)
       └─ _FundMovementConfirmDialogs (los dos AlertDialog extraídos)
```

- **Capa pura** (`FM/shared/view-mode.ts`): toda decisión que no necesita React (acciones por fila,
  textos por modo/estado, opciones con snapshot, valores del formulario, clave de la guarda de
  reset). Sin `'use server'` ni imports de runtime del servidor: solo `import type` desde
  `../list/actions.server` y `@/generated/prisma/enums` (precedente:
  `src/shared/lib/accounts/imputable-accounts.ts:1`), más `moment` y `./validators` (puros).
- **Capa de estado** (`FM/list/hooks/`): el hook concentra la lógica del modal **moviéndola sin
  reescribirla** (fase 3); el submit va en un hook aparte para que ambos queden < 200 líneas.
- **Capa de presentación** (`FM/list/components/_*.tsx`): piezas sin lógica de negocio; leen el
  formulario con `useFormContext<FundMovementFormInput>()` (están dentro de `<Form {...form}>`).
- **Server actions: sin cambios.** `getFundMovements` (`actions.server.ts:48-77`) ya trae todos los
  escalares (`status`, `confirmedAt`, `journalEntryNumber`, snapshots) y `getFundMovementById`
  (`:79-95`) ya tiene `checkPermission(..., 'view')` y convierte los `Decimal`. Ninguna action
  se agrega, modifica ni cambia su tipo de retorno; `FundMovementListItem` y
  `FundMovementRecord` (`:977-978`) siguen siendo las fuentes de tipos.
- **Permisos:** servidor ya cubierto (`view` en queries, `update`/`delete` en mutaciones);
  página con `PermissionGuard … view redirect` (`FundMovementsList.tsx:18`); cliente vía
  `permissions: ModulePermissions` por props (patrón del archivo, no `usePermissions()`), ahora
  usando también `canView`.
- **TSK-726:** el arreglo es de layout en `DataTablePagination.tsx` (causa raíz) y en la fila de
  conceptos; `dialog.tsx` y `DashboardLayout.tsx` **no se tocan** (D10).

### 3.2 Modelos de datos

No aplica: sin cambios de schema, migraciones ni queries (D12 se mantiene como caso borde).

### 3.3 Funciones y métodos

#### 3.3.1 `FM/shared/view-mode.ts` (nuevo, ~150 líneas, sin `'use client'`)

```ts
import moment from 'moment';

import type { FundMovementStatus } from '@/generated/prisma/enums';
import type { ModulePermissions } from '@/shared/lib/permissions';

import type {
  FundMovementListItem,
  FundMovementRecord,
  FundOption,
} from '../list/actions.server';
import {
  formatFundMovementDate,
  type FundMovementFormInput,
  type FundMovementTypeValue,
  type FundSourceKind,
} from './validators';

// ---------------------------------------------------------------- modos
export type FundMovementModalMode = 'create' | 'edit' | 'view';
/** Modos que trabajan sobre un movimiento existente (instancia única de la tabla, D8). */
export type FundMovementDetailMode = Exclude<FundMovementModalMode, 'create'>;

// ---------------------------------------------------------------- estado (movido de columns.tsx:33-37, 107)
export const FUND_MOVEMENT_STATUS_LABELS: Record<FundMovementStatus, string> = {
  DRAFT: 'Borrador',
  CONFIRMED: 'Confirmado',
  CANCELLED: 'Anulado',
};
export type FundMovementStatusBadgeVariant = 'default' | 'outline' | 'secondary';
/** CONFIRMED → 'default', DRAFT → 'outline', CANCELLED → 'secondary' (igual que hoy). */
export function fundMovementStatusVariant(status: FundMovementStatus): FundMovementStatusBadgeVariant;

// ---------------------------------------------------------------- acciones por fila (D9)
export type RowActionPermissions = Pick<ModulePermissions, 'canView' | 'canUpdate' | 'canDelete'>;
export interface FundMovementRowActions {
  view: boolean;    // canView, cualquier estado
  confirm: boolean; // DRAFT && canUpdate
  edit: boolean;    // DRAFT && canUpdate
  delete: boolean;  // DRAFT && canDelete
}
export function getRowActions(
  status: FundMovementStatus,
  permissions: RowActionPermissions
): FundMovementRowActions;
/** Visibilidad de la columna de acciones: canView || canUpdate || canDelete. */
export function hasAnyRowAction(permissions: RowActionPermissions): boolean;
/** confirm || edit || delete — decide el separador después de "Ver". */
export function hasDraftActions(actions: FundMovementRowActions): boolean;

// ---------------------------------------------------------------- opciones con snapshot (D4)
export interface SelectOptionLike { value: string; label: string }
export interface SnapshotOption extends SelectOptionLike { isSnapshot: true }
export interface FundSelectOption extends SelectOptionLike { group: FundSourceKind }

/** Bancos primero (`BANK:<id>`), cajas después (`CASH:<id>`), en el orden recibido. */
export function buildFundOptions(
  banks: readonly FundOption[],
  cashRegisters: readonly FundOption[]
): FundSelectOption[];

/**
 * Si `value` no está vacío, no está entre las opciones y hay `snapshotLabel` no vacío,
 * devuelve una copia con `{ value, label: snapshotLabel, isSnapshot: true }` al final.
 * En cualquier otro caso devuelve **la misma referencia** `options` (sin copiar ni mutar).
 */
export function withSnapshotOption<T extends SelectOptionLike>(
  options: readonly T[],
  value: string | null | undefined,
  snapshotLabel: string | null | undefined
): ReadonlyArray<T | SnapshotOption>;

export function isSnapshotOption(option: SelectOptionLike): option is SnapshotOption;

// ---------------------------------------------------------------- valores del formulario
/** Movido de _CreateFundMovementModal.tsx:77-79. */
export function fundRefFrom(kind: string | null, id: string | null): string;

/**
 * Valores vacíos del alta (hoy duplicados en :98-107 y :180-189).
 * `today` se inyecta para testear; por defecto `moment().format('YYYY-MM-DD')`.
 * Devuelve un objeto nuevo en cada llamada (`lines: []` no compartido).
 */
export function emptyFundMovementFormValues(today?: string): FundMovementFormInput;

export type FundMovementFormSource = Pick<
  FundMovementListItem,
  | 'type' | 'date' | 'amount' | 'description'
  | 'fundOutKind' | 'fundOutId' | 'fundInKind' | 'fundInId' | 'partnerId'
>;
export type FundMovementLineSource = Pick<
  FundMovementRecord['lines'][number],
  'accountId' | 'description' | 'amount'
>;

/**
 * El objeto del `form.reset` de :160-177, idéntico:
 * date con formatFundMovementDate(…, 'YYYY-MM-DD') (UTC, TSK-483), amount String(),
 * sourceFund/destinationFund con fundRefFrom, partnerId ?? '', y `lines` mapeadas
 * (amount → String) **solo** si type === 'BANK_CHARGES' y `lines` no es null/undefined;
 * si no, [].
 */
export function formValuesFromMovement(
  movement: FundMovementFormSource,
  lines: readonly FundMovementLineSource[] | null | undefined
): FundMovementFormInput;

// ---------------------------------------------------------------- textos (D6)
export interface FundMovementModalCopy { title: string; description: string }
/**
 * create → 'Nuevo Movimiento de Fondos'; edit → 'Editar Movimiento de Fondos'; ambos con la
 * descripción actual (:313-316) "Se guarda como borrador editable. Al confirmarlo, actualiza el
 * saldo del banco/caja y genera el asiento contable."
 * view → 'Movimiento de Fondos' + por estado:
 *   DRAFT     'Borrador: todavía no movió saldos ni generó asiento.'
 *   CONFIRMED 'Confirmado: ya actualizó el saldo del banco/caja y generó su asiento.'
 *   CANCELLED 'Anulado: el movimiento quedó sin efecto.'
 *   sin estado (null/undefined) 'Consulta de solo lectura.'
 */
export function getModalCopy(
  mode: FundMovementModalMode,
  status?: FundMovementStatus | null
): FundMovementModalCopy;

// ---------------------------------------------------------------- guardas del hook
/** mode !== 'view' (riesgo 6). */
export function shouldCleanupFieldsOnTypeChange(mode: FundMovementModalMode): boolean;
/** mode !== 'create' && type === 'BANK_CHARGES'. */
export function needsMovementDetail(
  mode: FundMovementModalMode,
  type: FundMovementTypeValue | null | undefined
): boolean;
/** Clave de `appliedDetailRef`: create → 'new'; edit/view → `${mode}:${movementId}` (riesgo 7). */
export function formResetKey(
  mode: FundMovementModalMode,
  movementId: string | null | undefined
): string;

// ---------------------------------------------------------------- resumen de vista (D3)
export interface ViewSummaryFact {
  key: 'confirmedAt' | 'journalEntry';
  label: string; // 'Confirmado el' | 'Asiento N°'
  value: string; // moment(confirmedAt).format('DD/MM/YYYY HH:mm') (local: es timestamp real) | String(n)
}
/** Solo los hechos presentes (`!= null`), en ese orden. El estado va aparte (badge). */
export function getViewSummaryFacts(
  movement: Pick<FundMovementListItem, 'confirmedAt' | 'journalEntryNumber'>
): ViewSummaryFact[];
```

Notas:
- **Precisión sobre la planificación:** `EMPTY_FUND_MOVEMENT_FORM_VALUES()` se llama
  `emptyFundMovementFormValues(today?)` (es una función, no una constante; el parámetro la
  hace determinista en el test). `FundMovementListItem['type']` es el enum Prisma
  `FundMovementType`, que es estructuralmente igual a `FundMovementTypeValue`: no hace falta
  cast en `formValuesFromMovement`; si TypeScript lo pidiera, un único `as FundMovementTypeValue`
  como hoy (`:161`).
- `columns.tsx` deja de declarar `STATUS_LABELS` (`:33-37`) y el ternario del variant (`:107`).

#### 3.3.2 `FM/list/hooks/useFundMovementForm.ts` (nuevo, ~150 líneas, sin directiva)

```ts
import type { UseFormReturn } from 'react-hook-form';
import type { AccountOption } from '@/shared/components/common/AccountCombobox';

export interface UseFundMovementFormParams {
  open: boolean;
  mode: FundMovementModalMode;
  /** Obligatorio en edit/view; ignorado en create. */
  movement: FundMovementListItem | null | undefined;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

export interface UseFundMovementFormResult {
  form: UseFormReturn<FundMovementFormInput>;
  lineAccounts: AccountOption[];               // Awaited<ReturnType<typeof getFundMovementLineAccounts>>
  movementDetail: FundMovementRecord | null | undefined;
  type: FundMovementTypeValue;
  isContribution: boolean;
  isWithdrawal: boolean;
  isTransfer: boolean;
  isBankCharges: boolean;
  isPartnerMovement: boolean;
  isSubmitting: boolean;
  submit: (confirm: boolean) => Promise<void>;
}

export function useFundMovementForm(params: UseFundMovementFormParams): UseFundMovementFormResult;
```

Contenido (movido tal cual, con los comentarios de TSK-585/717 intactos):
1. `useForm<FundMovementFormInput>({ resolver: zodResolver(fundMovementSchema), defaultValues: emptyFundMovementFormValues() })` (hoy `:96-108`).
2. `useQuery(['fund-movement-detail', movement?.id])` con
   `enabled: open && Boolean(movement) && needsMovementDetail(mode, movement?.type)` (hoy `:113-117`;
   la única diferencia de comportamiento es que también corre en `view`).
3. `detailAccountIds` + `useQuery(['fund-movement-line-accounts', detailAccountIds])`, `enabled: open` (hoy `:125-130`, sin cambios).
4. `appliedDetailRef` + efecto de precarga (hoy `:144-191`), reescrito solo en la forma:
   ```ts
   useEffect(() => {
     if (!open) { appliedDetailRef.current = null; return; }
     const key = formResetKey(mode, movement?.id);
     if (mode !== 'create') {
       if (!movement) return;                                     // edit/view sin movimiento: no hace nada
       const needsDetail = needsMovementDetail(mode, movement.type as FundMovementTypeValue);
       if (needsDetail && !movementDetail) return;               // esperar conceptos (aunque sea de cache)
       if (appliedDetailRef.current === key) return;             // una vez por apertura
       appliedDetailRef.current = key;
       form.reset(formValuesFromMovement(movement, needsDetail ? movementDetail?.lines : null));
     } else if (appliedDetailRef.current !== key) {
       appliedDetailRef.current = key;
       form.reset(emptyFundMovementFormValues());
     }
   }, [open, mode, movement, movementDetail, form]);
   ```
5. `type = form.watch('type')` y los cinco booleanos (hoy `:193-198`).
6. Efecto de limpieza por tipo (hoy `:224-237`) con primera línea
   `if (!shouldCleanupFieldsOnTypeChange(mode)) return;` y `mode` agregado a las deps. **No toca
   `amount`** (comentario `:209-217`).
7. `const { isSubmitting, submit } = useFundMovementSubmit({ form, mode, movement, onOpenChange, onSuccess });`

#### 3.3.3 `FM/list/hooks/useFundMovementSubmit.ts` (nuevo, ~75 líneas)

```ts
export interface UseFundMovementSubmitParams {
  form: UseFormReturn<FundMovementFormInput>;
  mode: FundMovementModalMode;
  movement: FundMovementListItem | null | undefined;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}
export interface UseFundMovementSubmitResult {
  isSubmitting: boolean;
  submit: (confirm: boolean) => Promise<void>;
}
export function useFundMovementSubmit(params: UseFundMovementSubmitParams): UseFundMovementSubmitResult;
```

`persist` y `submit` movidos de `:239-279`; `isEdit` se reemplaza por
`const isEdit = mode === 'edit' && Boolean(movement)`; guarda defensiva al inicio de `persist`:
`if (mode === 'view') return;`. `useQueryClient()` vive acá (invalidación de `:265-267`).

#### 3.3.4 Server actions

Sin cambios (confirmado contra `actions.server.ts`): `getFundMovements`, `getFundMovementById`,
`getFundMovementCatalogs`, `getFundMovementLineAccounts`, `createFundMovement`,
`updateFundMovement`, `confirmFundMovement`, `deleteFundMovement` y los tipos exportados
(`:976-984`) quedan idénticos.

### 3.4 Interfaces de usuario

#### 3.4.1 Modal `_CreateFundMovementModal.tsx` (modificado, 541 → ~150 líneas)

```ts
interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  banks: FundOption[];
  cashRegisters: FundOption[];
  partners: FundMovementPartnerOption[];
  defaultContributionsAccount: FundMovementAccountRef | null;
  defaultBankChargesAccount: FundMovementAccountRef | null;
  /** Fuente de verdad del modo (reemplaza `isEdit = Boolean(movement)`, :93). */
  mode: FundMovementModalMode;
  /** Requerido en 'edit' y 'view'. */
  movement?: FundMovementListItem | null;
  onSuccess: () => void;
}
```

Estructura:

```tsx
const isView = mode === 'view';
const copy = getModalCopy(mode, movement?.status);
const { form, lineAccounts, isContribution, isWithdrawal, isTransfer, isBankCharges,
        isPartnerMovement, isSubmitting, submit } = useFundMovementForm({ open, mode, movement, onOpenChange, onSuccess });
const noFundAccounts = banks.length === 0 && cashRegisters.length === 0;
const partnerId = form.watch('partnerId');
const selectedPartner = partners.find((p) => p.id === partnerId);
const snapshot = (label: string | null | undefined) => (isView ? label : null); // D4: solo vista

<Dialog open={open} onOpenChange={onOpenChange}>
  <DialogContent className="sm:max-w-[560px] max-h-[90vh] overflow-y-auto">   {/* sin cambios */}
    <DialogHeader>
      <DialogTitle>{copy.title}</DialogTitle>
      <DialogDescription>{copy.description}</DialogDescription>
    </DialogHeader>
    <Form {...form}>
      <form className="min-w-0 space-y-4">
        {isView && movement && <_FundMovementViewSummary movement={movement} />}
        <fieldset disabled={isView} className={cn('min-w-0 space-y-4', isView && READ_ONLY_FIELDSET)}>
          <_FundMovementTypeField disabled={isView} />
          {!isView && noFundAccounts && (/* aviso naranja de :346-354, inline */)}
          <_FundMovementAmountDateFields showAmount={!isBankCharges} />
          {(isContribution || isTransfer) && (
            <_FundSelectField name="destinationFund"
              label={isContribution ? 'Banco/caja donde ingresan los fondos *' : 'Banco/caja destino *'}
              banks={banks} cashRegisters={cashRegisters}
              disabled={isView} snapshotLabel={snapshot(movement?.fundInLabel)} />)}
          {(isWithdrawal || isTransfer || isBankCharges) && (
            <_FundSelectField name="sourceFund"
              label={isWithdrawal || isBankCharges ? 'Banco/caja de donde salen los fondos *' : 'Banco/caja origen *'}
              banks={banks} cashRegisters={cashRegisters}
              disabled={isView} snapshotLabel={snapshot(movement?.fundOutLabel)} />)}
          {isBankCharges && (
            <_FundMovementLinesField accounts={lineAccounts}
              defaultAccount={defaultBankChargesAccount} readOnly={isView} />)}
          {isPartnerMovement && (
            <_PartnerSelectField partners={partners} disabled={isView}
              snapshotLabel={snapshot(movement?.partnerName)} />)}
          {isPartnerMovement && !isView && (
            <_PartnerAccountNotice partner={selectedPartner} defaultAccount={defaultContributionsAccount} />)}
          {/* Descripción: FormField + Textarea de :499-511, inline */}
        </fieldset>
        <_FundMovementFormFooter mode={mode} isSubmitting={isSubmitting}
          onCancel={() => onOpenChange(false)} onSubmit={(confirm) => void submit(confirm)} />
      </form>
    </Form>
  </DialogContent>
</Dialog>
```

```ts
/** D2: en vista el texto se lee al 100 %. Se usa directamente la variante con `!`
 *  (Tailwind v4) para no depender del orden del CSS generado: `.x :disabled` y
 *  `.disabled\:opacity-50:disabled` empatan en especificidad (0,2,0). */
const READ_ONLY_FIELDSET = '[&_:disabled]:opacity-100! [&_:disabled]:cursor-default!';
```

*Precisión sobre D2:* la planificación permitía arrancar sin `!` y pasar a `!` si la captura
lo mostraba al 50 %. Se adopta `!` desde el inicio: el empate de especificidad es real y la
variante con `!` es determinista. La Fase 6 lo confirma igual con captura.

#### 3.4.2 Componentes nuevos (todos `'use client'`, en `FM/list/components/`)

```ts
// _FundMovementTypeField.tsx (~45 líneas) — Select de tipo (hoy :321-344)
interface FundMovementTypeFieldProps {
  /** Pasado al Root de Radix `Select` (el fieldset no alcanza para Radix, riesgo 3). */
  disabled?: boolean;
}
export function _FundMovementTypeField(props: FundMovementTypeFieldProps): JSX.Element;

// _FundMovementAmountDateFields.tsx (~65 líneas) — hoy :356-406
interface FundMovementAmountDateFieldsProps {
  /** false en BANK_CHARGES: solo Fecha (el importe sale de los conceptos). */
  showAmount: boolean;
}
// Con showAmount: grid `grid gap-4 md:grid-cols-2` Monto (MoneyInput) + Fecha; sin: Fecha sola.
// No recibe `disabled`: Input y MoneyInput son <input> nativos y los deshabilita el fieldset.

// _FundSelectField.tsx (~80 líneas) — reemplaza :408-456 y renderFundOptions :281-304
interface FundSelectFieldProps {
  name: 'sourceFund' | 'destinationFund';
  label: string;
  banks: FundOption[];
  cashRegisters: FundOption[];
  disabled?: boolean;
  /** Solo en vista (D4): fundOutLabel / fundInLabel guardado. */
  snapshotLabel?: string | null;
}
// render: const options = withSnapshotOption(buildFundOptions(banks, cashRegisters), field.value, snapshotLabel);
// SelectGroup "Bancos" (group==='BANK' && !isSnapshotOption), SelectGroup "Cajas" (group==='CASH'),
// y la opción snapshot en un SelectGroup sin label al final.
// <Select onValueChange={field.onChange} value={field.value || undefined} disabled={disabled}>

// _PartnerSelectField.tsx (~60 líneas) — hoy :465-490
interface PartnerSelectFieldProps {
  partners: FundMovementPartnerOption[];
  disabled?: boolean;
  /** Solo en vista (D4): partnerName guardado. */
  snapshotLabel?: string | null;
}
// options = withSnapshotOption(partners.map((p) => ({ value: p.id, label: p.name })), field.value, snapshotLabel)

// _FundMovementFormFooter.tsx (~55 líneas) — hoy :513-535
interface FundMovementFormFooterProps {
  mode: FundMovementModalMode;
  isSubmitting: boolean;
  /** Cancelar (create/edit) o Cerrar (view). */
  onCancel: () => void;
  /** Solo create/edit: false = Guardar, true = Guardar y Confirmar. */
  onSubmit: (confirm: boolean) => void;
}
// view: <DialogFooter><Button type="button" variant="outline" onClick={onCancel}>Cerrar</Button></DialogFooter>
// create/edit: los tres botones actuales con Loader2, `className="gap-2 sm:gap-2"` igual que hoy.

// _FundMovementViewSummary.tsx (~50 líneas) — D3
interface FundMovementViewSummaryProps {
  movement: Pick<FundMovementListItem, 'status' | 'confirmedAt' | 'journalEntryNumber'>;
}
// <dl className="grid gap-3 rounded-md border bg-muted/40 p-3 text-sm sm:grid-cols-3">
//   <div><dt className="text-xs text-muted-foreground">Estado</dt>
//        <dd><Badge variant={fundMovementStatusVariant(status)}>{FUND_MOVEMENT_STATUS_LABELS[status]}</Badge></dd></div>
//   {getViewSummaryFacts(movement).map((f) => <div key={f.key}><dt …>{f.label}</dt>
//        <dd className={f.key === 'journalEntry' ? 'font-mono' : undefined}>{f.value}</dd></div>)}
// </dl>
// Asiento N° es texto, sin link (no hay página de detalle de asiento).
```

#### 3.4.3 `_FundMovementLinesField.tsx` (modificado, 143 → ~155 líneas)

```ts
interface FundMovementLinesFieldProps {
  accounts: AccountOption[];
  defaultAccount?: FundMovementAccountRef | null;
  /** Modo vista: sin "Agregar concepto", sin tachos, sin aviso de cuenta por defecto,
   *  AccountCombobox deshabilitado; mantiene el total. */
  readOnly?: boolean; // default false
}
```

- `:63-71` "Agregar concepto" → `{!readOnly && (…)}`. El rótulo pasa a `Conceptos` sin `*` en vista
  (`Conceptos{readOnly ? '' : ' *'}`).
- `:74-75` texto vacío: `readOnly ? 'Sin conceptos cargados' : 'Agregá al menos un concepto'`.
- `:84-96` `AccountCombobox` recibe `disabled={readOnly}` (el fieldset ya deshabilita el `<button>`
  trigger, pero el estado `open` del Popover es propio: se pasa explícito, riesgo 3).
- `:115-123` tacho → `{!readOnly && (…)}`.
- `:137-140` `_BankChargesDefaultNotice` → `{!readOnly && (…)}`.
- `Input` y `MoneyInput` quedan deshabilitados por el fieldset (no hace falta prop).

**Cambio exacto de clases de la fila (D11, Fase 2):**

| Línea actual | Antes | Después |
|---|---|---|
| `:83` fila | `flex items-start gap-2` | `flex flex-wrap items-start gap-2 sm:flex-nowrap` |
| `:94` AccountCombobox | `flex-1` | `min-w-0 basis-full sm:basis-auto sm:flex-1` |
| `:100` Input descripción | `flex-1` | `min-w-0 flex-1` |
| `:107` MoneyInput | `w-36 shrink-0` | `w-32 shrink-0 sm:w-36` |
| `:119` tacho | `shrink-0` | `shrink-0` (sin cambio) |

A 375 px (contenido del modal ≈ 295 px): fila 1 = cuenta a ancho completo; fila 2 = descripción
(~115 px) + importe (128) + tacho (36). En ≥ `sm` todo vuelve a una sola fila como hoy.

#### 3.4.4 `DataTablePagination.tsx` (modificado, causa raíz de TSK-726)

| Línea | Antes | Después |
|---|---|---|
| `:50` contenedor | `flex items-center justify-between px-2` | `flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-2` |
| `:52` rango | `flex-1 text-sm text-muted-foreground` | `min-w-0 flex-1 text-sm text-muted-foreground` |
| `:65` controles | `flex items-center space-x-6 lg:space-x-8` | `ml-auto flex flex-wrap items-center gap-x-6 gap-y-2 lg:gap-x-8` |
| `:67` filas por página | `flex items-center space-x-2` | `flex items-center gap-2` |
| `:89` "Página X de Y" | `flex w-[100px] items-center justify-center text-sm font-medium` | `flex min-w-[100px] items-center justify-center text-sm font-medium` |
| `:94` botones | `flex items-center space-x-2` | `flex items-center gap-2` |

Cómo resuelve: el rango (`min-w-0 flex-1`, base 0) nunca fuerza el corte; si los controles
(~350 px) no entran, bajan a su propia línea (`ml-auto` los deja a la derecha) y, como su
`min-content` (~170 px) es menor que el ancho disponible, se encogen y **parten internamente**
(`flex-wrap`). Resultado: ningún hijo excede el ancho de la página → `documentElement.scrollWidth`
= 375 → el layout viewport del celular no se ensancha → `DialogContent` vuelve a 343 px.
En escritorio (todo entra en una línea) `gap-x-6/8` = `space-x-6/8`, así que el resultado visual
es idéntico.

#### 3.4.5 Listado: `columns.tsx` y `_FundMovementsTable.tsx`

`columns.tsx` (170 → ~165 líneas):

```ts
interface ColumnsProps {
  onView: (m: FundMovementListItem) => void;   // nuevo
  onEdit: (m: FundMovementListItem) => void;
  onConfirm: (m: FundMovementListItem) => void;
  onDelete: (m: FundMovementListItem) => void;
  permissions: ModulePermissions;
}
```

- Import `Eye` de `lucide-react` (`:4`).
- Borrar `STATUS_LABELS` (`:33-37`) y la columna `id: 'asiento'` (`:111-121`).
- Estado (`:105-109`): `<Badge variant={fundMovementStatusVariant(status)}>{FUND_MOVEMENT_STATUS_LABELS[status]}</Badge>`.
- Acciones (`:124-167`): `if (hasAnyRowAction(permissions))`; en `cell`:
  ```tsx
  const actions = getRowActions(m.status, permissions);
  const draft = hasDraftActions(actions);
  if (!actions.view && !draft) return null;
  // DropdownMenuLabel "Acciones"
  // {actions.view && <Item onClick={() => onView(m)}><Eye className="mr-2 h-4 w-4" />Ver</Item>}
  // {actions.view && draft && <DropdownMenuSeparator />}
  // {actions.confirm && Confirmar (CheckCircle2)} {actions.edit && Editar (Pencil)}
  // {actions.delete && <>{(actions.confirm || actions.edit) && <DropdownMenuSeparator />}Eliminar</>}
  ```
  Mismo trigger/estilo que hoy y que `clients/list/columns.tsx:176-181` (`Eye` `mr-2 h-4 w-4`,
  rótulo "Ver" según el ticket).

`_FundMovementsTable.tsx` (197 → ~115 líneas):

```ts
type DetailSelection = { movement: FundMovementListItem; mode: FundMovementDetailMode };

const [createOpen, setCreateOpen] = useState(false);
const [selected, setSelected] = useState<DetailSelection | null>(null);
const [detailOpen, setDetailOpen] = useState(false);       // D8: al cerrar solo se baja `open`
const [confirming, setConfirming] = useState<FundMovementListItem | null>(null);
const [deleting, setDeleting] = useState<FundMovementListItem | null>(null);

const columns = useMemo(() => {
  const openDetail = (movement: FundMovementListItem, mode: FundMovementDetailMode) => {
    setSelected({ movement, mode });
    setDetailOpen(true);
  };
  return getColumns({
    onView: (m) => openDetail(m, 'view'),
    onEdit: (m) => openDetail(m, 'edit'),
    onConfirm: setConfirming,
    onDelete: setDeleting,
    permissions,
  });
}, [permissions]);
```

- Alta: `<_CreateFundMovementModal mode="create" open={createOpen} … />` (sin `movement`).
- Edición/vista: una instancia con `open={detailOpen}`, `onOpenChange={setDetailOpen}`,
  `mode={selected?.mode ?? 'view'}`, `movement={selected?.movement ?? null}`.
- `handleConfirm`/`handleDelete`, `isBusy` y los dos `AlertDialog` (`:76-108`, `:154-194`) se mueven
  **sin cambios de texto ni lógica** a `_FundMovementConfirmDialogs.tsx` (decidido de antemano: con
  la tercera vía el archivo superaba 200 líneas):

```ts
// _FundMovementConfirmDialogs.tsx (~110 líneas)
interface FundMovementConfirmDialogsProps {
  confirming: FundMovementListItem | null;
  deleting: FundMovementListItem | null;
  onCloseConfirm: () => void;   // setConfirming(null)
  onCloseDelete: () => void;    // setDeleting(null)
  onSuccess: () => void;        // router.refresh()
}
```

#### 3.4.6 Mapa por modo

| Elemento | `create` | `edit` | `view` |
|---|---|---|---|
| Título | Nuevo Movimiento de Fondos | Editar Movimiento de Fondos | Movimiento de Fondos |
| Descripción | "Se guarda como borrador editable…" | ídem | por estado (D6) |
| `_FundMovementViewSummary` | oculto | oculto | **visible** (Estado, Confirmado el, Asiento N°) |
| Tipo | editable | editable | deshabilitado (`disabled` en Root) |
| Aviso "No hay cuentas bancarias ni cajas…" | si `noFundAccounts` | si `noFundAccounts` | **oculto** |
| Monto / Fecha | editable | editable | deshabilitado (fieldset) |
| Destino / Origen | catálogo | catálogo | deshabilitado + opción snapshot si falta en catálogo |
| Conceptos: combobox / descripción / importe | editable | editable | deshabilitado |
| "Agregar concepto", tachos | visibles | visibles | **ocultos** |
| Total de conceptos | visible | visible | visible |
| `_BankChargesDefaultNotice` | visible | visible | **oculto** |
| Socio | catálogo | catálogo | deshabilitado + snapshot |
| `_PartnerAccountNotice` | visible | visible | **oculto** |
| Descripción | editable | editable | deshabilitada |
| Footer | Cancelar / Guardar / Guardar y Confirmar | ídem | **Cerrar** |
| Opacidad de controles | normal | normal | 100 % (`READ_ONLY_FIELDSET`) |
| Query `fund-movement-detail` | no | si BANK_CHARGES | si BANK_CHARGES |
| Query `fund-movement-line-accounts` | `open` | `open` | `open` (sin cambio) |
| Reset del form (clave guarda) | vacío (`'new'`) | desde movimiento (`edit:<id>`) | desde movimiento (`view:<id>`) |
| Limpieza al cambiar tipo | sí | sí | **no** |
| `persist` | create | update (+confirm) | nunca (guarda defensiva) |

#### 3.4.7 Árbol de archivos resultante

```
src/shared/components/common/DataTable/
├── DataTablePagination.tsx                    M  139 → ~139  (solo clases)
└── DOCS.md                                    M  nota paginación responsive (Fase 7)

FM/
├── shared/
│   ├── validators.ts                          =  208
│   ├── lines-calc.ts                          =   70
│   ├── view-mode.ts                           N  ~150
│   └── view-mode.test.ts                      N  ~230 (test, no aplica el límite de componentes)
└── list/
    ├── actions.server.ts                      =  984 (sin cambios)
    ├── FundMovementsList.tsx                  =   43
    ├── columns.tsx                            M  170 → ~165
    ├── hooks/
    │   ├── useFundMovementForm.ts             N  ~150
    │   └── useFundMovementSubmit.ts           N  ~75
    └── components/
        ├── _CreateFundMovementModal.tsx       M  541 → ~150
        ├── _FundMovementsTable.tsx            M  197 → ~115
        ├── _FundMovementConfirmDialogs.tsx    N  ~110
        ├── _FundMovementTypeField.tsx         N  ~45
        ├── _FundMovementAmountDateFields.tsx  N  ~65
        ├── _FundSelectField.tsx               N  ~80
        ├── _PartnerSelectField.tsx            N  ~60
        ├── _FundMovementFormFooter.tsx        N  ~55
        ├── _FundMovementViewSummary.tsx       N  ~50
        ├── _FundMovementLinesField.tsx        M  143 → ~155
        ├── _PartnerAccountNotice.tsx          =   95
        └── _BankChargesDefaultNotice.tsx      =   77

scripts/guia-presentacion/
├── capturas-tsk720a-726.mjs                   N  ~350
├── tsk-720a-726.html / .pdf                   N  (Fase 7)
└── assets/tsk720a-726-*.png                   N

src/modules/help/features/guide/components/_TreasuryGuide.tsx   M  (párrafo :1004-1008 + Ver)
docs/modules/commercial.md                                       M  (:258 y tabla ~:1029)
```

#### 3.4.8 Casos de test Vitest (`FM/shared/view-mode.test.ts`, entorno `node`)

| Helper | Casos |
|---|---|
| `getRowActions` | DRAFT + todos los permisos → los 4 en `true`; CONFIRMED + todos → solo `view`; CANCELLED + todos → solo `view`; DRAFT solo `canView` → solo `view`; DRAFT `canView+canDelete` → `view`+`delete`; DRAFT `canUpdate` sin `canView` → `confirm`+`edit`, `view` false; CONFIRMED sin permisos → todo `false`. |
| `hasAnyRowAction` | todo `false` → `false`; cada permiso solo (`it.each` ×3) → `true`. |
| `hasDraftActions` | solo `view` → `false`; con `delete` → `true`; con `edit` → `true`. |
| `FUND_MOVEMENT_STATUS_LABELS` / `fundMovementStatusVariant` | `it.each` de los 3 estados: Borrador/`outline`, Confirmado/`default`, Anulado/`secondary`. |
| `buildFundOptions` | bancos antes que cajas con `BANK:<id>`/`CASH:<id>` y `group`; arrays vacíos → `[]`. |
| `withSnapshotOption` | valor en catálogo → misma referencia (`toBe`); fuera de catálogo con label → copia con la opción `isSnapshot` al final; fuera de catálogo con label `null`/`''`/`undefined` → misma referencia; valor `''`/`null`/`undefined` → misma referencia; no muta el array de entrada. |
| `isSnapshotOption` | `true` para la opción agregada; `false` para una de catálogo. |
| `fundRefFrom` | `('BANK', id)` → `BANK:id`; kind `null` → `''`; id `null` → `''`. |
| `emptyFundMovementFormValues` | con `today` explícito: tipo `PARTNER_CONTRIBUTION`, fecha = today, resto `''`, `lines: []`; dos llamadas devuelven `lines` distintos (`not.toBe`); sin argumento usa `moment().format('YYYY-MM-DD')`. |
| `formValuesFromMovement` | aporte (destino desde `fundIn*`, origen `''`, socio); retiro (origen desde `fundOut*`, socio); transferencia (origen y destino, `partnerId: null` → `''`); gastos bancarios con 2 líneas (`amount` 1234.5 → `'1234.5'`, orden respetado); gastos con `lines` `null` → `[]`; aporte con `lines` pasadas → `[]`; `date` `2026-03-01T12:00:00Z` → `'2026-03-01'` (TSK-483; correr también con `process.env.TZ` irrelevante porque usa UTC); `amount` 1500 → `'1500'`. |
| `getModalCopy` | create y edit (títulos distintos, misma descripción literal); view × DRAFT/CONFIRMED/CANCELLED con los textos literales de D6; view sin estado → 'Consulta de solo lectura.'. |
| `shouldCleanupFieldsOnTypeChange` | create `true`, edit `true`, view `false`. |
| `needsMovementDetail` | create+BANK_CHARGES `false`; edit+BANK_CHARGES `true`; view+BANK_CHARGES `true`; edit+PARTNER_CONTRIBUTION `false`; view+`undefined` `false`. |
| `formResetKey` | create con o sin id → `'new'`; edit → `'edit:<id>'`; view → `'view:<id>'`; edit ≠ view para el mismo id. |
| `getViewSummaryFacts` | borrador (ambos `null`) → `[]`; confirmado → `[confirmedAt, journalEntry]` con `value` = `moment(d).format('DD/MM/YYYY HH:mm')` y `'123'`; `confirmedAt` presente sin número → solo `confirmedAt`. |

Fixtures: construir `FundMovementFormSource` con `satisfies` y fechas `new Date('…Z')`; tipos
importados con `import type` (se borran al compilar, no cargan el archivo `'use server'`).

### 3.5 Rutas y navegación

Sin rutas nuevas ni cambios en `src/app/`. La vista se abre como modal desde el menú de la fila
en `/dashboard/commercial/treasury/fund-movements`; el estado del modal no va a la URL (igual
que la edición actual). La columna `asiento` desaparece del `tableId="commercial-fund-movements"`:
TanStack ignora ids de columna inexistentes en la visibilidad guardada en `localStorage`
(`DataTable/useDataTable.ts:36-46`); se verifica en la Fase 5.

### 3.6 APIs / Endpoints

No aplica: sin endpoints nuevos y sin cambios en server actions (ver 3.3.4).

### 3.7 Consideraciones técnicas

#### 3.7.1 Invariantes que el refactor NO debe romper

| # | Invariante | Dónde está hoy | Dónde queda |
|---|---|---|---|
| I1 | El reset con los datos del movimiento se aplica **una sola vez por apertura** (guarda `appliedDetailRef`), para que un refetch en segundo plano de `movementDetail` no pise lo tecleado (TSK-585). | `_CreateFundMovementModal.tsx:132-144, 157-158` | `useFundMovementForm` (clave `formResetKey`) |
| I2 | Al cerrar el modal la guarda vuelve a `null` (reabrir el mismo movimiento resetea de nuevo). | `:148-150` | ídem |
| I3 | Para BANK_CHARGES el reset **espera** a `movementDetail` (aunque sea de cache) antes de cargar conceptos. | `:153-156` | ídem, vía `needsMovementDetail` |
| I4 | La fecha se lee con `formatFundMovementDate(…, 'YYYY-MM-DD')` (UTC, mediodía; TSK-483), nunca `moment(date)`. | `:162-163` | `formValuesFromMovement` |
| I5 | Query de conceptos con clave `['fund-movement-detail', id]` (compartida por edit y view). | `:113-117` | hook; `enabled` amplía a view |
| I6 | Cuentas de conceptos: `getFundMovementLineAccounts(detailAccountIds)` con `includeIds` para no vaciar el combo de cuentas dadas de baja; clave con los ids; `enabled: open`. | `:119-130` | hook, sin cambios |
| I7 | Limpieza por tipo: `lines` se vacía fuera de BANK_CHARGES, `destinationFund` en BANK_CHARGES, `partnerId` fuera de aporte/retiro (TSK-717), `sourceFund` en aporte; **`amount` nunca se toca**. | `:203-237` | hook, + `if (!shouldCleanupFieldsOnTypeChange(mode)) return;` |
| I8 | Edición: `updateFundMovement` y, si se pidió, `confirmFundMovement`; alta: `createFundMovement(data, confirm)`. Errores como dato (`result.success`/`result.error` → `toast.error`), sin `throw` (TSK-481/721). | `:239-258` | `useFundMovementSubmit` |
| I9 | Tras editar, `invalidateQueries(['fund-movement-detail', id])` porque `router.refresh()` no toca React Query (TSK-585). | `:260-267` | `useFundMovementSubmit` |
| I10 | Toasts "Movimiento confirmado" / "Borrador actualizado" / "Borrador guardado"; luego `onOpenChange(false)` y `onSuccess()` en ese orden. | `:269-273` | `useFundMovementSubmit` |
| I11 | Concepto nuevo preselecciona la cuenta de gastos bancarios por defecto solo si sigue imputable (`pickDefaultLineAccount`, TSK-718); el reset en edición conserva las cuentas guardadas. | `_FundMovementLinesField.tsx:46-49, 67` | sin cambios |
| I12 | Errores de línea leídos a mano desde `errors.lines[index].message` (el `superRefine` los cuelga de la raíz de la línea). | `_FundMovementLinesField.tsx:54-57, 79, 125` | sin cambios |
| I13 | `_BankChargesDefaultNotice` siempre visible en create/edit (con y sin conceptos). | `_FundMovementLinesField.tsx:136-140` | solo se oculta en view |
| I14 | `_PartnerAccountNotice` recibe el socio **del catálogo** elegido en el form y la cuenta por defecto (TSK-717). | `_CreateFundMovementModal.tsx:200-201, 492-497` | modal, solo create/edit |
| I15 | Aviso naranja si no hay bancos ni cajas con sesión abierta. | `:199, 346-354` | modal, solo create/edit |
| I16 | Monto oculto en BANK_CHARGES (el servidor suma conceptos); rótulos de origen/destino por tipo. | `:356-456` | `_FundMovementAmountDateFields`, props `label` |
| I17 | Confirmar/Eliminar desde el listado: `AlertDialog` (nunca `confirm()`), resultado como dato, `router.refresh()`; textos sin cambios. | `_FundMovementsTable.tsx:63, 76-108, 154-194` | `_FundMovementConfirmDialogs` |

Verificación del refactor (Fase 3): `npm run test` (incluye
`fund-movement-lines.integration.test.ts` y `fund-movement-partner-account.integration.test.ts`)
y prueba manual en `:3010` de alta/edición de los 4 tipos, incluido reabrir un BANK_CHARGES
recién editado.

#### 3.7.2 Otras consideraciones

- **D8 sin parpadeo:** al cerrar, solo `detailOpen=false`; `selected` se conserva hasta la próxima
  apertura, así la animación de salida no cambia título ni campos. Pasar de vista a edición del
  mismo movimiento siempre pasa por un cierre (`open=false` → guarda en `null`), y además la
  clave incluye el modo.
- **Efecto de limpieza al cambiar de modo en la instancia compartida:** al reabrir en `edit` tras
  una vista, el efecto puede correr una vez sobre los valores de la vista anterior antes del
  reset; es inocuo porque el reset de I1 reescribe **todos** los campos. No agregar lógica que
  dependa del orden entre ambos efectos.
- **Radix + fieldset (riesgo 3):** `disabled` explícito en los tres `Select` (Root) y en cada
  `AccountCombobox`; el fieldset cubre `Input`, `Textarea`, `MoneyInput` y botones nativos.
  `fieldset` lleva `min-w-0` (su `min-inline-size: min-content` por defecto podría reintroducir
  desborde en mobile). Los inputs registrados con `register` (descripción de concepto) muestran
  el valor del reset aunque estén deshabilitados; como en vista no se envía el form, no importa
  que RHF ignore campos deshabilitados al validar.
- **Snapshot (D4):** solo en vista; la `SelectItem` fantasma debe estar dentro de `SelectContent`
  para que `SelectValue` muestre su texto con el select cerrado. En edición un fondo fuera de
  catálogo sigue mostrando el placeholder (comportamiento actual).
- **D12 (caso borde preexistente):** una cuenta guardada que hoy no sea de egreso/activo se ve
  vacía en el combobox de la vista (`actions.server.ts:186`). No se cambia; se reabre solo si
  aparece en las capturas.
- **Fechas:** `date` con `formatFundMovementDate` (UTC); `confirmedAt` con
  `moment(...).format('DD/MM/YYYY HH:mm')` en local (timestamp real).
- **Línea base:** medir `npm run check-types 2>&1 | grep -c "error TS"` y `npm run lint` al
  inicio de la Fase 1; criterio "no sube".
- **Logger/tipos:** sin `console.*` en `src/` (el script `.mjs` sí usa `console`, como los demás
  de `scripts/guia-presentacion/`); sin `:any`.

#### 3.7.3 Script de capturas `scripts/guia-presentacion/capturas-tsk720a-726.mjs`

Patrón de `capturas-tsk728.mjs` (constantes `COMPANY_ID`, `USER_ID`, `EMAIL`, `PASSWORD`, helper
`psql` vía `docker exec contable-pms-db`, `try/finally` con limpieza).

- **Uso:** `node scripts/guia-presentacion/capturas-tsk720a-726.mjs [baseUrl] [--solo-movil] [--antes] [--cleanup]`
  (`baseUrl` por defecto `http://localhost:3010`). `--antes` se corre **antes de aplicar la
  Fase 2** (sobre el código sin arreglo): solo mediciones y capturas mobile con sufijo
  `-antes`, sin fallar, para la comparación antes/después de la presentación. `--cleanup` solo
  borra la siembra.
- **Navegador:** `chromium.launch().catch(() => chromium.launch({ channel: 'chrome' }))`.
  Contexto escritorio `{ viewport: { width: 1440, height: 900 } }`; login una vez y se reusa
  `storageState` para el contexto mobile
  `{ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }`
  (**`isMobile: true` es obligatorio** para reproducir TSK-726).
- **Siembra** (marca `description LIKE 'TSK720A-demo%'`; borra restos de una corrida anterior
  antes de sembrar):
  - M1 `TSK720A-demo aporte`: PARTNER_CONTRIBUTION en DRAFT → destino banco `BANK_ID` (Santander,
    con cuenta contable), socio activo con cuenta de aportes (o cuenta por defecto en Ajustes);
    se **confirma por UI** (menú → Confirmar → AlertDialog) para tener asiento real.
  - M2 `TSK720A-demo retiro`: PARTNER_WITHDRAWAL en DRAFT (origen banco, socio activo).
  - M3 `TSK720A-demo transferencia`: ACCOUNT_TRANSFER en CANCELLED por SQL (banco → caja).
  - M4 `TSK720A-demo gastos`: BANK_CHARGES en DRAFT con 2 `fund_movement_lines` (dos cuentas de
    egreso imputables, p. ej. `4.2.1/03/10`) y `amount` = suma.
  - M5 `TSK720A-demo snapshot`: PARTNER_WITHDRAWAL en CANCELLED con `fund_out_kind='CASH'` de una
    caja **sin sesión abierta** creada por el script y `partner_id` de un socio **inactivo** creado
    por el script; `fund_out_label`/`partner_name` con sus nombres.
  - Si falta un dato base (banco, socio con cuenta, cuentas de egreso) el script aborta con un
    mensaje claro antes de abrir el navegador.
- **Limpieza (`finally`, también ante error):** para M1, revertir lo que hizo
  `confirmFundMovement` (`actions.server.ts:360-425`): `bank_accounts.balance` menos el
  `bank_movements.amount` de descripción `TSK720A-demo%` y borrar esos `bank_movements` (y
  `cash_movements`/`expected_balance` si hubiera caja), borrar `journal_entry_lines` y
  `journal_entries` por `fund_movements.journal_entry_id`; luego borrar `fund_movement_lines`,
  `fund_movements`, la caja y el socio demo.
- **Capturas** (`scripts/guia-presentacion/assets/`, prefijo `tsk720a-726-`):

| Archivo | Contexto | Contenido |
|---|---|---|
| `01-listado-sin-asiento.png` | 1440 | listado sin columna Asiento (assert: no hay header "Asiento") |
| `02-menu-confirmado.png` | 1440 | menú de M1 confirmado: solo "Ver" (assert) |
| `03-menu-borrador.png` | 1440 | menú de M2: Ver + Confirmar/Editar/Eliminar |
| `04-ver-aporte-confirmado.png` | 1440 | vista M1: resumen Estado/Confirmado el/Asiento N° |
| `05-ver-retiro-borrador.png` | 1440 | vista M2 |
| `06-ver-transferencia-anulada.png` | 1440 | vista M3, descripción "Anulado: …" |
| `07-ver-gastos-bancarios.png` | 1440 | vista M4: conceptos sin "Agregar"/tachos, total |
| `08-ver-snapshot-caja-socio.png` | 1440 | vista M5: caja y socio por snapshot, no placeholder (assert texto del trigger) |
| `09-paginacion-escritorio.png` | 1440 | barra de paginación de Movimientos de Fondos |
| `09b-paginacion-escritorio-socios.png` | 1440 | barra de paginación de Socios (no cambió) |
| `10..13-movil-alta-{aporte,retiro,transferencia,gastos}.png` | 375 mobile | modal de alta con cada tipo (en gastos, con un concepto agregado: fila apilada) |
| `14..17-movil-ver-{aporte,retiro,transferencia,gastos}.png` | 375 mobile | vista de M1..M4 |
| `18-movil-listado.png` | 375 mobile | listado con la paginación partida en dos líneas |
| `*-antes.png` | 375 mobile | con `--antes`: `10-movil-alta-aporte-antes.png` y `18-movil-listado-antes.png` |

- **Mediciones** (función `measureDialog(page, escenario)` para cada escenario mobile 10-17):
  ```js
  const dlg = page.getByRole('dialog');
  const b = await dlg.boundingBox();
  const close = dlg.locator('[data-slot="dialog-close"]');
  const cb = await close.boundingBox();
  const m = await page.evaluate(() => {
    const d = document.querySelector('[data-slot="dialog-content"]');
    const fs = d?.querySelector('fieldset');
    return {
      innerWidth: window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      dialogOverflow: d ? d.scrollWidth - d.clientWidth : null,
      fieldsetOverflow: fs ? fs.scrollWidth - fs.clientWidth : 0,
    };
  });
  ok = b.x >= 0 && b.x + b.width <= 375 && m.innerWidth === 375 && m.scrollWidth <= m.innerWidth
    && cb && cb.x >= 0 && cb.x + cb.width <= 375 && (await close.isVisible())
    && m.dialogOverflow <= 0 && m.fieldsetOverflow <= 0;
  ```
  Además, sin modal: `scrollWidth` de `/dashboard/commercial/treasury/fund-movements` (esperado
  375), `/dashboard/commercial/treasury/partners` (antes 443; debe ser ≤ 443, se espera ~383) y
  `/dashboard` (antes 491; debe ser ≤ 491). Se imprime `console.table` con escenario, x, width,
  right, closeRight, innerWidth, scrollWidth, ok; si algún escenario 10-17 o el listado de
  Movimientos de Fondos falla, `process.exitCode = 1` (salvo con `--antes`).
- **Vista no editable** (en 07 y 15): assert de que el trigger del `Select` de tipo y el del
  `AccountCombobox` están `disabled` y que un click no abre listbox/popover; y
  `getComputedStyle(input).opacity === '1'` para validar D2.

## 4. Implementación

### Fase 1: Helpers puros del modo vista y de las acciones por fila (TDD)
- **Estado:** Completada
- **Archivos modificados:**
  - `src/modules/commercial/features/treasury/features/fund-movements/shared/view-mode.ts` - nuevo: modos del modal, rótulos/variante de estado, `getRowActions`/`hasAnyRowAction`/`hasDraftActions`, `buildFundOptions`/`withSnapshotOption`/`isSnapshotOption`, `fundRefFrom`/`emptyFundMovementFormValues`/`formValuesFromMovement`, `getModalCopy`, guardas del hook (`shouldCleanupFieldsOnTypeChange`, `needsMovementDetail`, `formResetKey`) y `getViewSummaryFacts`, con las firmas de 3.3.1.
  - `src/modules/commercial/features/treasury/features/fund-movements/shared/view-mode.test.ts` - nuevo: 54 tests Vitest con los casos de 3.4.8 (escrito primero, en rojo).
- **Notas:**
  - Línea base medida al empezar: `npm run check-types 2>&1 | grep -c "error TS"` = **219**; `npm run lint` = **336 problemas (153 errores, 183 warnings)**, todos preexistentes. Tras la fase: 219 errores de tipos (no sube) y `eslint` sin problemas en los dos archivos nuevos.
  - `npx vitest run .../shared/view-mode.test.ts`: 54/54 en verde.
  - Sin desvíos de firmas. Precisiones de implementación: `formResetKey` con `movementId` null/undefined en edit/view devuelve `'<modo>:'` (caso no especificado; el hook nunca lo usa sin movimiento). `formValuesFromMovement` no necesitó cast: `FundMovementType` de Prisma asigna directo a `FundMovementTypeValue`.
  - Todavía no se tocó UI: `columns.tsx` y `_CreateFundMovementModal.tsx` siguen con sus copias de `STATUS_LABELS` y `fundRefFrom`; se reemplazan en las fases 3 y 5.

### Fase 2: Causa raíz de TSK-726 — paginación compartida y fila de conceptos responsive
- **Estado:** Completada
- **Archivos modificados:**
  - `src/shared/components/common/DataTable/DataTablePagination.tsx` - contenedor y bloque de controles con `flex-wrap` + `gap` (en lugar de `space-x-*`), rango con `min-w-0`, controles con `ml-auto`, "Página X de Y" con `min-w-[100px]`. Clases exactas de la tabla de 3.4.4.
  - `src/modules/commercial/features/treasury/features/fund-movements/list/components/_FundMovementLinesField.tsx` - fila de conceptos apilada en mobile (`flex-wrap … sm:flex-nowrap`, cuenta `basis-full` arriba, descripción `min-w-0 flex-1`, importe `w-32 sm:w-36`). Clases exactas de la tabla de 3.4.3.
- **Notas:**
  - Mediciones con Playwright contra `:3010` (`isMobile: true`, 375×812), antes → después:
    - `documentElement.scrollWidth`: Movimientos de Fondos **443 → 375**; Socios **443 → 383** (mejora; los 8 px restantes son la toolbar "Filtros | Nuevo Socio", fuera de alcance, ver 1.2); Dashboard **491 → 491** (sin cambio, fuera de alcance).
    - Modal "Nuevo movimiento", los 4 tipos (PARTNER_CONTRIBUTION, PARTNER_WITHDRAWAL, ACCOUNT_TRANSFER, BANK_CHARGES): antes `DialogContent` w=411 con right 401-427 y X en right 384-410 (fuera de los 375); después **x=16, w=343, right=359** y **X 326-342** en los 4 tipos (dentro del viewport).
    - Fila de conceptos de BANK_CHARGES (anchos de hijos): antes cuenta 79 / descripción 79 / importe 144 / tacho 36 en una sola línea; después cuenta **293** (ancho completo) y debajo descripción 113 / importe 128 / tacho 36.
  - Escritorio 1440 (Movimientos de Fondos y Facturas de venta): altura de la barra 36 px antes y después; todos los controles en las mismas coordenadas (x=918…1384). Lo único que cambia es el ancho del bloque "Mostrando…" (638 → 622, por el `gap-x-4`), que no se ve. Capturas antes/después en el scratchpad de la sesión (`tsk726-{antes,despues}-*.png`).
  - En celular la paginación ocupa 3 líneas: rango; "Filas por página" + "Página 1 de 1"; botones (alineados a la izquierda por el wrap interno). Es lo que se esperaba del diseño y se usa bien.
  - `npm run check-types` = 219 errores (sin cambio); `eslint` sin problemas en los 2 archivos; `vitest` de fund-movements 125/125 en verde.
  - Sin desvíos del diseño.

### Fase 3: Refactor del modal sin cambio de comportamiento (< 200 líneas)
- **Estado:** Completada
- **Archivos modificados** (`FM/list/`, líneas con `wc -l`):
  - `hooks/useFundMovementForm.ts` (190) - nuevo: `useForm` con `emptyFundMovementFormValues()`, las dos `useQuery`, `appliedDetailRef` + precarga con `formResetKey`/`formValuesFromMovement`, limpieza por tipo con `shouldCleanupFieldsOnTypeChange`; comentarios de TSK-585/717 movidos tal cual.
  - `hooks/useFundMovementSubmit.ts` (86) - nuevo: `persist`/`submit` movidos tal cual, `isEdit = mode === 'edit' && Boolean(movement)`, guarda `if (mode === 'view') return`.
  - `components/_FundMovementTypeField.tsx` (61), `_FundMovementAmountDateFields.tsx` (72), `_FundSelectField.tsx` (115), `_PartnerSelectField.tsx` (74), `_FundMovementFormFooter.tsx` (56) - nuevos, con las props del diseño 3.4.2.
  - `components/_CreateFundMovementModal.tsx` (541 → 173) - prop `mode` obligatoria, título/descripción con `getModalCopy`, composición de las piezas. Se borraron las copias locales `fundRefFrom` y los valores vacíos duplicados (ahora de `shared/view-mode.ts`).
  - `components/_FundMovementsTable.tsx` (197 → 199) - solo `mode="create"` / `mode="edit"` en las dos instancias.
- **Notas — invariantes (3.7.1):**
  - I1/I2/I3 → `useFundMovementForm`, mismo efecto con clave `formResetKey(mode, id)` (`'new'` / `'edit:<id>'`); `null` al cerrar; espera a `movementDetail` vía `needsMovementDetail`. Navegador: en los 4 tipos, tras reabrir, lo tecleado sigue igual 3 s después (I1) y reabrir tras Cancelar recarga lo guardado (I2); BANK_CHARGES reabierto trae sus conceptos (I3).
  - I4 → `formValuesFromMovement` (UTC). Navegador: la fecha 2026-10-05 se precarga igual en los 4 tipos (no se corre un día).
  - I5/I6 → hook; claves `['fund-movement-detail', id]` y `['fund-movement-line-accounts', ids]` idénticas; `enabled` del detalle = `open && movement && needsMovementDetail(mode, type)` (igual a hoy en create/edit). Navegador: los dos conceptos se precargan con su cuenta (`4.2.1/03/09`, `4.2.1/03/10`).
  - I7 → hook, mismo efecto + guarda de modo; `amount` no se toca. Navegador (alta nueva): aporte→transferencia limpia el socio, transferencia→aporte limpia el origen, gastos→transferencia limpia el destino, salir de gastos vacía los conceptos; el monto (500) queda intacto en todos los pasos.
  - I8/I10 → `useFundMovementSubmit`, mismo código. Navegador: toasts "Borrador guardado" (alta ×4) y "Borrador actualizado" (edición ×4), modal cerrado y listado refrescado. No se probó "Guardar y Confirmar" (consigna: no confirmar).
  - I9 → `useFundMovementSubmit` (`invalidateQueries`). Navegador: BANK_CHARGES editado (importe 100→150 y concepto nuevo "Sellado") y reabierto enseguida muestra los 3 conceptos frescos.
  - I11/I12/I13 → `_FundMovementLinesField.tsx` sin tocar. Navegador: "Agregar concepto" preselecciona `4.2.1/03/09 - Gastos Bancarios - Administración` en alta y en edición; el aviso de cuenta por defecto se ve en edición.
  - I14/I15 → modal, mismo cálculo de `selectedPartner` y `noFundAccounts` y mismo JSX (en esta fase se muestran en todos los modos; se ocultan en vista en la Fase 4).
  - I16 → `_FundMovementAmountDateFields` (`showAmount={!isBankCharges}`) y `label` por tipo en `_FundSelectField`. Navegador: Monto presente en 3 tipos y ausente en gastos; los rótulos usados por `getByLabel` son los literales de antes.
  - I17 → `_FundMovementsTable.tsx` sin cambios en confirmar/eliminar (la extracción a `_FundMovementConfirmDialogs` queda para la Fase 5, como dice el plan). Navegador: los 4 borradores de prueba se eliminaron desde el menú → AlertDialog → "Eliminar" ("Borrador eliminado").
- **Verificación:** script Playwright temporal (escritorio 1440, `:3010`): 97/97 chequeos OK, sin errores de página; borradores `TSK720A-F3-test …` creados, editados y **eliminados por la UI** (0 restos en `fund_movements`). `npx vitest run FM` 125/125; `check-types` 219 (sin cambio); `eslint` de los archivos tocados: 0 errores, 1 warning `react-hooks/incompatible-library` por `form.watch` en el hook (informativo; el React Compiler no está activado en `next.config.ts`, y es la misma llamada que tenía el modal).
- **Desvíos / precisiones:**
  - Reparto con la Fase 4: los campos ya aceptan `disabled` y `snapshotLabel` (y `_FundSelectField`/`_PartnerSelectField` ya aplican `withSnapshotOption`, inerte sin `snapshotLabel`), y el footer nace con la rama "Cerrar"; pero el modal todavía **no** los pasa ni tiene fieldset, resumen ni avisos ocultos: eso es la Fase 4. Con los props sin pasar, el render es idéntico al anterior.
  - `_FundSelectField` arma los grupos Bancos/Cajas desde `buildFundOptions` (mismas claves/valores `BANK:<id>`/`CASH:<id>` y mismo orden); un grupo vacío no se renderiza, igual que antes.

### Fase 4: Modo vista del modal
- **Estado:** Completada
- **Archivos modificados** (`FM/list/components/`, líneas con `wc -l`):
  - `_CreateFundMovementModal.tsx` (173 → 191) - `isView`; `_FundMovementViewSummary` arriba; campos dentro de `<fieldset disabled={isView} className={cn('min-w-0 space-y-4', isView && READ_ONLY_FIELDSET)}>` con `READ_ONLY_FIELDSET = '[&_:disabled]:opacity-100! [&_:disabled]:cursor-default!'` (variante con `!` desde el inicio, como fija 3.4.1); `disabled={isView}` en Tipo, los dos `_FundSelectField` y `_PartnerSelectField`; `snapshotLabel` = `fundInLabel`/`fundOutLabel`/`partnerName` solo en vista; aviso "No hay cuentas bancarias ni cajas…" y `_PartnerAccountNotice` ocultos en vista; footer fuera del fieldset.
  - `_FundMovementLinesField.tsx` (143 → 160) - prop `readOnly`: oculta "Agregar concepto", tachos y `_BankChargesDefaultNotice`; `AccountCombobox disabled={readOnly}`; rótulo "Conceptos" sin `*` y "Sin conceptos cargados" en vista; se mantiene el total.
  - `_FundMovementViewSummary.tsx` (43) - nuevo: `<dl>` con badge de estado (`FUND_MOVEMENT_STATUS_LABELS` + `fundMovementStatusVariant`) y los hechos de `getViewSummaryFacts` ("Confirmado el" con moment `DD/MM/YYYY HH:mm` en hora local, "Asiento N°" en `font-mono`, texto sin link).
  - `_FundMovementDescriptionField.tsx` (38) - nuevo: el `FormField` + `Textarea` de Descripción, extraído del modal **para que entre en < 200 líneas** (con el fieldset, el resumen y los props de vista llegaba a 210).
  - Sin cambios: `_FundSelectField`, `_PartnerSelectField`, `_FundMovementTypeField`, `_FundMovementFormFooter` (ya traían `disabled`/`snapshotLabel` y la rama "Cerrar" desde la Fase 3) y `useFundMovementSubmit` (ya tenía la guarda `if (mode === 'view') return`).
- **Notas:**
  - Verificación en navegador hecha junto con la Fase 5 (la vista solo se abre desde el menú "Ver" del listado): ver los resultados en la entrada de la Fase 5.
  - `npx vitest run FM` 125/125; `check-types` 219 (sin cambio); `eslint` de los archivos tocados sin errores.
- **Desvíos / precisiones:**
  - Archivo extra `_FundMovementDescriptionField.tsx` (no estaba en 3.4.7) para cumplir < 200 líneas en el modal.
  - Snapshot en **edición** (fuera de alcance, D4): un fondo/socio fuera de catálogo muestra el trigger **vacío** (Radix no pinta el placeholder si el `value` no tiene `SelectItem`), no el placeholder como decía 3.7.2. Es el comportamiento previo, sin cambios.

### Fase 5: Listado — sin columna "Asiento" y con acción "Ver"
- **Estado:** Completada
- **Archivos modificados** (`FM/list/`, líneas con `wc -l`):
  - `columns.tsx` (170 → 175) - sin la columna `asiento`; `onView` en `ColumnsProps`; `Eye`; badge de estado con `FUND_MOVEMENT_STATUS_LABELS`/`fundMovementStatusVariant` (se borra `STATUS_LABELS`); columna de acciones con `hasAnyRowAction(permissions)` y menú con `getRowActions`/`hasDraftActions`: "Ver" primero, separador solo si hay acciones de borrador, Confirmar/Editar (`canUpdate`) y Eliminar (`canDelete`) solo en DRAFT.
  - `components/_FundMovementsTable.tsx` (199 → 127) - `selected: { movement, mode: 'edit' | 'view' } | null` + `detailOpen` (D8: al cerrar solo baja `open`); una instancia del modal para edición/vista y otra para alta; props comunes en `modalProps`.
  - `components/_FundMovementConfirmDialogs.tsx` (125) - nuevo: los dos `AlertDialog`, `handleConfirm`/`handleDelete` e `isBusy` movidos sin cambios de texto ni lógica (I17).
  - `hooks/useFundMovementForm.ts` (190 → 198) - **desvío, ver abajo**: el efecto de limpieza por tipo lee el tipo con `form.getValues('type')` y depende de `[mode, type, form]`.
- **Verificación en navegador (Fases 4 + 5)** — script Playwright temporal contra `:3010` (escritorio 1440 + móvil 375 `isMobile: true`), 108/109 chequeos OK (el único FAIL era una expectativa mal escrita del script sobre el snapshot en edición, ver desvíos de la Fase 4), sin errores de página:
  - Listado: encabezados `Fecha | Tipo | Descripción | Origen | Destino | Socio | Monto | Estado | (acciones)`, sin "Asiento". La visibilidad de columnas no se persiste (`dt-state:<tableId>` solo guarda `pageSize`/orden/filtros), así que no hay estado viejo con `asiento` que romper.
  - Menú: borradores (los 4 tipos y uno sembrado por SQL) → `Ver | Confirmar | Editar | Eliminar`; confirmados (los 2 nuevos y 2 viejos de la base, `Aporte inicial de capital` y `dato`) → solo `Ver`.
  - Vista de los 4 tipos en borrador y de los 2 confirmados: título "Movimiento de Fondos" y descripción por estado; **todos** los controles del fieldset `:disabled` (6 en aporte/retiro/transferencia, 10 y 13 en gastos) con `opacity` computada **1** (D2 con `!` confirmado); fuera del fieldset solo "Cerrar" + X; sin "Agregar concepto", sin tachos, sin avisos de cuenta, sin Guardar/Cancelar; click en el Select de tipo no abre listbox y en el combobox de cuenta no abre popover; conceptos cargados en gastos con total visible. Capturas a 100 % legibles.
  - Resumen vs. base: aporte confirmado → `Confirmado el 06/10/2026 16:54`, `Asiento N° 36`; gastos confirmado → `06/10/2026 16:54`, `Asiento N° 37`; ambos coinciden con `fund_movements.confirmed_at` (UTC 19:54 → local -03) y con `journal_entries.number` del `journal_entry_id`.
  - Snapshot (probado en navegador, no solo con el test unitario): dos borradores sembrados por SQL con fondo/socio inexistentes en el catálogo → la vista muestra `Banco Galicia - 4455-7 (baja)`, `Socio Dado De Baja` y `Caja Chica - CAJA-02 (cerrada)` (caso "caja con sesión cerrada": `fund_out_kind='CASH'` con un id fuera de las cajas con sesión `OPEN`) en lugar del placeholder.
  - Editar ↔ Ver (instancia compartida): Ver gastos → Editar aporte, Ver transferencia → Editar aporte, Ver aporte → Editar transferencia, Ver aporte → Editar retiro: todos los campos del movimiento editado intactos y habilitados, con el aviso de cuenta del socio; Editar gastos → Ver gastos → Editar gastos: conceptos iguales, en vista sin botones de edición y en edición con "Agregar concepto" y 2 tachos.
  - **I8–I10 (pendientes de la Fase 3):** alta con "Guardar y Confirmar" (aporte 1.234,56) → toast "Movimiento confirmado", modal cerrado, fila "Confirmado"; edición de un borrador de gastos (importe 1.500 → 1.600 y concepto nuevo "Sellado") con "Guardar y Confirmar" → `updateFundMovement` + `confirmFundMovement`, toast "Movimiento confirmado", modal cerrado, fila "Confirmado"; **I9**: reabrir ese movimiento en Ver sin recargar muestra los 3 conceptos frescos (1.600 / 315 / 50). Altas de borrador → "Borrador guardado". El camino de error como dato también se vio (ver dato de dev abajo): toast con el mensaje genérico, modal abierto, sin `throw`.
  - I7 tras el cambio del hook (alta nueva): aporte→transferencia limpia el socio, transferencia→aporte limpia el origen, gastos→transferencia limpia el destino, salir de gastos vacía los conceptos, el monto (500) queda intacto.
  - Móvil 375 `isMobile: true`, vista de gastos confirmado, aporte confirmado y transferencia borrador: `DialogContent` x=16, w=343, right=359; X 326–342; `innerWidth` = `scrollWidth` = 375; sin desborde del diálogo ni del fieldset.
  - Limpieza: los borradores `TSK720A-F45-test …` se eliminaron desde la UI (menú → Eliminar → "Borrador eliminado"). **Quedan dos confirmados para la Fase 6** (no se pueden borrar desde la UI): `c2250ab9-00ba-4304-bc44-46f7cf526685` (aporte, `TSK720A-F45-test aporte confirmado`, Banco Santander, María López, $ 1.234,56, asiento N° 36, `journal_entry_id f658d76e-47d8-4c07-9fb6-0e31c7f934c9`) y `f6411cea-9d20-4559-b4c3-85373e88b14d` (gastos bancarios, `TSK720A-F45-test gastos confirmado`, Banco Santander, 3 conceptos $ 1.965, asiento N° 37, `journal_entry_id adb7dc11-0e56-4105-a0d8-8441ac36a9e3`). Movieron el saldo del Banco Santander de dev.
  - `npx vitest run FM` 125/125; `check-types` 219 (sin cambio); `eslint` de los archivos tocados: 0 errores, 1 warning preexistente (`react-hooks/incompatible-library` por `form.watch`).
- **Desvíos / precisiones:**
  - **Bug latente de 3.7.2 corregido en el hook.** El diseño daba por inocuo que el efecto de limpieza corriera al cambiar de modo en la instancia compartida "porque el reset reescribe todo"; en realidad los dos efectos corren en el **mismo commit**, primero el reset y después la limpieza, y la limpieza usaba los flags (`isBankCharges`, `isContribution`, `isPartnerMovement`) del render anterior, es decir, del movimiento visto antes. Reproducido en navegador con el hook anterior: Ver gastos → Editar aporte dejaba el aporte **sin destino ni socio**, y Ver transferencia → Editar aporte lo dejaba sin socio (al guardar se perdían). Arreglo: el efecto deriva el tipo de `form.getValues('type')` (ya reseteado) y depende de `[mode, type, form]`; con eso los 4 cruces dan los datos intactos y I7 sigue igual.
  - **Dato de dev corregido:** `accounting_settings.last_entry_number` de la empresa de prueba estaba en 29 mientras que `journal_entries` llegaba a 35 (asientos `TSK719-demo …` sembrados por SQL sin mover el contador) → toda confirmación fallaba con `P2002` en `journal_entries_company_id_number_key` (mensaje genérico en el toast). Se llevó el contador a 35 (se ignoró el asiento de depuración `999999`). No es un problema del código de este ticket; conviene que los scripts de siembra muevan el contador.
  - `_FundMovementConfirmDialogs.tsx` se creó como estaba previsto en 3.4.5 (el plan lo dejaba "eventual").

### Fase 6: Verificación en navegador y capturas
- **Estado:** Completada
- **Archivos modificados:**
  - `scripts/guia-presentacion/capturas-tsk720a-726.mjs` - nuevo: siembra, recorrido escritorio + celular, mediciones de TSK-726 con `console.table`, 35 chequeos; `process.exitCode = 1` si alguno falla. Opciones `--solo-movil` (10-18 y mediciones) y `--cleanup` (solo borra la siembra).
  - `scripts/guia-presentacion/assets/tsk720a-726-*.png` - 22 capturas: 01-09b escritorio, 10-18 celular y tres `-antes` (10 alta aporte, 13 alta gastos, 18 listado).
- **Resultado** (`node scripts/guia-presentacion/capturas-tsk720a-726.mjs`, dev `:3010`): **35/35 chequeos OK, código de salida 0** (y `--solo-movil`: 9/9).
  - Celular 375×812 `isMobile: true`, los 8 escenarios de diálogo (alta de los 4 tipos y Ver de los 4): `DialogContent` **x=16, width=343, right=359**, X de cerrar **right=342** y visible, `innerWidth` = `scrollWidth` = **375**, desborde diálogo/fieldset **0/0**. Criterio de TSK-726 cumplido en los 4 tipos, en alta y en vista.
  - Fila de conceptos en el celular (anchos de hijos): cuenta **293** (fila completa) y debajo descripción 113 / importe 128 / tacho 36.
  - Sin modal: Movimientos de Fondos **375** (antes 443); Socios **383** (antes 443, no empeora; los 8 px son la toolbar, seguimiento 2.4); Dashboard **491** (antes 491, sin cambio, seguimiento 2.4).
  - Escritorio: listado sin encabezado "Asiento"; menú de confirmado = `Ver`; menú de borrador = `Ver | Confirmar | Editar | Eliminar`; vistas 04-08 con el texto esperado (estado, "Confirmado el", "Asiento N° 36/37", conceptos), sin Guardar ni "Agregar concepto", con "Cerrar"; en 07 el Select de tipo y los 5 combobox del fieldset están `disabled`, un click no abre listbox ni popover y la opacidad computada de los controles deshabilitados es **1** (D2 confirmado); en 08 los triggers muestran `Caja Chica` y `Carlos Gómez` (snapshot, no placeholder). Barra de paginación a 1440 en una línea (alto 36 px) en Movimientos de Fondos y Socios.
- **Desvíos / precisiones:**
  - **Datos:** en vez de sembrar y confirmar por UI un aporte (y revertir saldo/asiento al limpiar), el script **reutiliza los dos confirmados de las fases 4/5** (`c2250ab9-…` aporte, asiento N° 36; `f6411cea-…` gastos, asiento N° 37) y solo les pone una descripción legible ("Aporte de capital de María López", "Comisiones e impuestos del banco"); no los borra. Más simple y sin volver a mover el saldo del banco ni la numeración en cada corrida. Si faltan, el script aborta con un mensaje claro.
  - **Marca de la siembra:** `created_by = 'TSK720A-demo'` en lugar de `description LIKE 'TSK720A-demo%'`, para que las descripciones de las capturas de la clienta queden limpias (`created_by` no se muestra en ninguna pantalla). Se siembran 3: retiro en borrador (Juan Perez), transferencia anulada (banco → Caja Principal) y retiro anulado con snapshot (ids inexistentes con `fund_out_label='Caja Chica'` y `partner_name='Carlos Gómez'`, como en la Fase 5, en vez de crear una caja y un socio reales). Se borran en `finally`.
  - **Capturas "antes":** no las genera el script; son las que se tomaron en la Fase 2 sobre el código previo al arreglo con el mismo contexto móvil (`tsk726-antes-*.png` del scratchpad), copiadas a `assets/` con el prefijo del ticket.
  - **Hallazgo (fuera de alcance):** a **1440 px de escritorio** el listado de Movimientos de Fondos también desborda en horizontal (`scrollWidth` 1537-1612 según el largo de las descripciones; la tabla mide ~1250 px dentro de un panel de ~1150). Es previo a este ticket (antes, con la columna "Asiento", era más ancho) y no afecta al modal en escritorio (no se usa `isMobile`). Las capturas 01-03 se toman a 1600 para que se vea la tabla entera; las de diálogos y paginación, a 1440. Candidato a seguimiento junto con 2.4.
  - **Rol con solo `view`:** no hay uno en dev; queda cubierto por los tests de `getRowActions`/`hasAnyRowAction` (Fase 1).

### Fase 7: Documentación — guía in-app, docs y presentación para la clienta
- **Estado:** Completada
- **Archivos modificados:**
  - `src/modules/help/features/guide/components/_TreasuryGuide.tsx` - sección Movimientos de Fondos: el paso de acciones ahora habla del menú ⋯ (Ver en cualquier estado; Confirmar/Editar/Eliminar solo en borrador); nueva lista "Ver un movimiento (cualquier estado)" (mismo formulario bloqueado, recuadro Estado / Confirmado el / Asiento N°, nombre guardado si la caja o el socio ya no están, Cerrar/X); `Alert` "¿Dónde está el número de asiento?"; párrafo "Desde el celular" (modal completo con la X, conceptos apilados, tabla que se desliza, paginación en varias líneas).
  - `docs/modules/commercial.md` - "Socios y Movimientos de Fondos": `CANCELLED` en el árbol (sin acción que lo produzca), `journalEntryNumber`/`confirmedAt`; bloque "Ver en solo lectura y modal responsive (TSK-720a / TSK-726)" (listado y `getRowActions`, prop `mode`, fieldset + `disabled` en Radix y la opacidad con `!`, resumen, snapshot, piezas y hooks, la corrección del efecto de limpieza, causa de TSK-726 y el script de capturas, caso borde D12); `view-mode.ts` en la tabla de archivos.
  - `src/shared/components/common/DataTable/DOCS.md` - troubleshooting "En el celular la página se ensancha o un modal se sale de la pantalla" (layout viewport, clases de la paginación responsive, medir con `isMobile`, pendientes Socios/Dashboard) y la característica "Responsive" actualizada.
  - `scripts/guia-presentacion/tsk-720a-726.html` - nuevo, mismo CSS que `tsk-728.html`: 1 qué se pidió (cita literal del 720; el 726 lo detectamos nosotros), 2 tabla sin Asiento y menú, 3 Ver paso a paso con ejemplo (gastos bancarios y aporte confirmados, borrador, anulado, snapshot), 4 celular antes/después (modal, conceptos, Ver, listado), 5 qué no cambió, 6 qué queda para la segunda parte del 720 (tipos configurables y vínculo con movimientos del banco, esperando su respuesta).
  - `docs/presentaciones/TSK-720-726-ver-movimientos-de-fondos.pdf` - nuevo, 9 páginas A4, generado con `generar-pdf.mjs` (cae a Chrome del sistema).
- **Notas:**
  - PDF revisado página por página como imagen: las 20 capturas se ven y los bloques título + imágenes no se parten (se agregaron cortes de sección para que "Los conceptos…" y "La tabla en el celular" no queden huérfanos).
  - El ticket 726 es interno (lo creamos en la verificación de TSK-717); la presentación lo dice así en vez de atribuírselo a la clienta. La presentación no promete "anular": ninguna acción de la UI produce `CANCELLED` hoy; solo se muestra que un anulado se puede ver.
  - `check-types` 219 (sin cambio); `eslint` de `_TreasuryGuide.tsx` sin problemas.
  - Como en TSK-719/728, el PDF va en `docs/presentaciones/` y las PNG se commitearon con el script (Fase 6).

### Fase 8: Verificación final
- **Estado:** Pendiente

## 5. Verificación
_Pendiente - ejecutar `/verificar tsk-720a-726-movimientos-fondos-ver`_
