# Plan de implementación — Tickets abiertos Contable PMS

**Fecha:** 2026-08-12
**Fuente:** cc-tickets, proyecto *Contable PMS* (id 13) — 7 tareas pendientes, 0 vencidas
**Rama base analizada:** `main` (efcf817)

---

## 1. Inventario de tickets abiertos

| # | Título | Prioridad | Estado | Tipo |
|---|--------|-----------|--------|------|
| 463 | Renombrar Artículos a Items | **high** | Pendiente | Refactor UI |
| 492 | [Contabilidad] No busca ni guarda | medium | Programada | Bug |
| 483 | [Otro] no me deja guardar la fecha | medium | Programada | Bug |
| 481 | [Contabilidad] Error raro | medium | Pend. Planificación | Bug |
| 464 | Buscador en Selectores de Cuentas | medium | Pendiente | Mejora UI |
| 349 | Conectar el sistema con AFIP | none | Pendiente | Feature |
| 319 | Conectar dominio personalizado | none | Pendiente | Infra |

Los tres bugs (492, 483, 481) los reportó Elizabeth Perez (`eperez@perezmarzo.com.ar`) desde el widget, con capturas.

---

## 2. Hallazgo bloqueante: trabajo terminado sin mergear

Tres ramas tienen trabajo completo que **nunca llegó a `main`**:

| Rama | Commits | Contenido |
|------|---------|-----------|
| `feat/tsk-413-movimientos-fondos` | 5 | Módulo Movimientos de Fondos + Gastos→Egresos + MoneyInput + cuenta contable en banco/caja |
| `feat/tsk-409-imputacion-items` | 2 | Imputación contable de items desde listado y bulk-edit |
| `fix/tsk-410-invitaciones-usuarios` | 2 | Reutiliza invitaciones expiradas, evita P2002 al reinvitar |

**Esto condiciona todo el plan:** los bugs 481 y 483 son bugs *dentro* de `feat/tsk-413-movimientos-fondos`. El código que falla no existe en `main`. Corregirlos en `main` es imposible; hay que hacerlo sobre esa rama y recién ahí integrar.

`dev` está 4 commits detrás de `main` y las tres ramas salen de `main`.

---

## 3. Diagnóstico por ticket

### 🔴 TSK-483 — La fecha se guarda un día antes

**Reproducción:** el usuario carga 20/02/2026 en un Movimiento de Fondos y el sistema muestra 19/02/2026.

**Causa raíz — confirmada en código:** la rama TSK-413 rompió el patrón de fechas del proyecto. Guarda y lee en hora **local**; con el servidor en UTC y el cliente en UTC-3, la fecha retrocede un día.

| Punto | Archivo | Código actual |
|-------|---------|---------------|
| Guardar (create) | `fund-movements/list/actions.server.ts:324` | `moment(data.date, 'YYYY-MM-DD').toDate()` |
| Guardar (update) | `fund-movements/list/actions.server.ts:386` | `moment(data.date, 'YYYY-MM-DD').toDate()` |
| Precargar en modal | `_CreateFundMovementModal.tsx:103` | `moment(movement.date).format('YYYY-MM-DD')` |
| Mostrar en tabla | `fund-movements/list/columns.tsx:49` | `moment(row.original.date).format('DD/MM/YYYY')` |

**El resto del proyecto ya lo hace bien:** 54 usos de `moment.utc(...)`, con el patrón `moment.utc(x).startOf('day').toDate()` al guardar y `moment.utc(x).format('DD/MM/YYYY')` al leer (ej. `purchase-orders/list/actions.server.ts:403`, `columns.tsx:77`). El módulo de egresos incluso normaliza a mediodía UTC (`expenses/actions.server.ts:24`), que es la variante más robusta.

**Fix:** alinear los 4 puntos al patrón `moment.utc`. No requiere migración de datos salvo que ya existan movimientos cargados con la fecha corrida (verificar en la base del cliente).

**Riesgo latente (fuera del ticket):** `shared/utils/formatters.ts:44` — `formatDate()` usa `moment()` local. Con fechas guardadas a medianoche UTC, cualquier pantalla que use ese helper para fechas "puras" muestra el día anterior. Vale auditarlo aparte; no cambiarlo a ciegas porque también se usa con timestamps reales (`createdAt`).

---

### 🔴 TSK-492 — Ajustes contables: "no busca ni guarda"

Son **dos problemas distintos** en la misma pantalla (`/dashboard/accounting/settings` → Integración Comercial).

#### 492.1 — "No busca por palabras"
Los ~22 selectores de cuentas usan `Select` de shadcn, que no tiene búsqueda. Con un plan de cuentas completo la lista es inmanejable. **Es el mismo problema que TSK-464** → se resuelven juntos (ver Fase 2).

#### 492.2 — "Igual las elijo pero no guarda"
**Causa raíz — confirmada en código:** el formulario falla la validación en silencio y nunca llega al submit.

- `_CommercialIntegrationForm.tsx:44-48` declara 4 campos de Activos Fijos en el schema Zod como `z.string().nullable()` — es decir, **exige `string` o `null`, y rechaza `undefined`**:
  `fixedAssetAccountId`, `accumulatedDepreciationAccountId`, `depreciationExpenseAccountId`, `assetDisposalGainLossAccountId`.
- `AccountingSettings.tsx:76-95` arma `defaultValues` y **no incluye ninguno de esos 4 campos**.

Resultado: los 4 campos llegan como `undefined`, Zod los marca como *Required*, `form.handleSubmit()` aborta y jamás invoca `handleSubmit`. Como el formulario usa `<Label>` plano en lugar de `FormField`/`FormMessage`, **no se muestra ningún error**: el botón "Guardar Configuración" simplemente no hace nada.

**Fix (tres capas, las tres necesarias):**
1. Agregar los 4 campos a `defaultValues` en `AccountingSettings.tsx` (más `partnerContributionsAccountId`, que la rama TSK-413 ya agrega).
2. Cambiar el schema a `.nullish()` para tolerar `undefined` y que un campo nuevo no vuelva a romper el guardado.
3. Pasar un handler `onInvalid` a `form.handleSubmit(onValid, onInvalid)` que muestre un toast con los campos inválidos — así ningún fallo de validación vuelve a ser invisible.

El server action `saveAccountingSettings` **ya soporta** los 4 campos (`actions.server.ts:57-61`); el problema es puramente del cliente.

---

### 🔴 TSK-481 — "Error raro" (Server Components render)

**Dos cosas en la captura:**

1. El aviso naranja *"Para confirmar aportes o retiros, configurá primero la Cuenta de aportes de socios"* — es **correcto y esperado** (`_CreateFundMovementModal.tsx:225-233`). No es un bug. Además queda desbloqueado al arreglar TSK-492.2, que es lo que impide guardar esa cuenta.
2. El toast *"An error occurred in the Server Components render… A digest property is included"* — **sí es el bug**.

**Causa raíz:** los server actions de fund-movements lanzan `throw new Error('mensaje de negocio')` para condiciones esperables (`actions.server.ts:439`, `:169`, `:206`, `:254`, entre otras). En builds de producción Next.js **redacta el mensaje** de cualquier error lanzado desde un Server Action y devuelve un digest genérico. El `catch` del cliente (`_CreateFundMovementModal.tsx:143`) recibe ese texto críptico y lo muestra tal cual.

**Fix:** que los errores de negocio no viajen como excepciones. Los server actions deben devolver `{ success: false, error: 'mensaje' }` y el modal renderizar `result.error`. Reservar `throw` sólo para fallos realmente inesperados.

**Alcance:** revisar si el patrón `throw` se repite en otros server actions consumidos desde el cliente — si es transversal, conviene un helper compartido (`actionResult`/`safeAction`) antes de replicar el arreglo caso por caso.

---

### 🟡 TSK-464 — Buscador en selectores de cuentas

**Buena noticia: el patrón ya existe y está probado en el repo.** `accounting/features/budgets/components/_CreateBudgetModal.tsx:173-199` implementa exactamente lo pedido — `Popover` + `Command` con `CommandInput placeholder="Buscar por codigo o nombre..."`. Los primitivos `command.tsx` y `popover.tsx` ya están instalados.

No hay que diseñar nada: hay que **extraer ese patrón a un componente compartido y propagarlo**.

**Selectores de cuentas a migrar (8 en `main` + 2 en ramas sin mergear):**

- `accounting/features/settings/components/_CommercialIntegrationForm.tsx` ← **el del ticket, ~22 selects**
- `accounting/features/accounts/components/_CreateAccountModal.tsx`
- `accounting/features/accounts/components/_EditAccountModal.tsx`
- `accounting/features/entries/components/_CreateEntryModal.tsx`
- `accounting/features/recurring-entries/components/_CreateRecurringEntryDialog.tsx`
- `accounting/features/reports/components/_BudgetVarianceReport.tsx`
- `commercial/features/products/features/create/components/_AccountingDefaultsSection.tsx`
- `commercial/features/treasury/features/bank-accounts/detail/components/_CreateBankMovementDialog.tsx`
- (rama TSK-409) `products/features/list/components/_ImputationModal.tsx`
- (rama TSK-413) `_BankAccountFormModal.tsx`, `_CashRegisterFormModal.tsx`

---

### 🟠 TSK-463 — Renombrar Artículos → Items (prioridad alta)

**Superficie medida:** 44 archivos, ~161 ocurrencias de texto visible (`Artículo` 31, `Artículos` 20, `artículo` 62, `artículos` 48).

Incluye: sidebar (`_AppSidebar.tsx`), 7 páginas de `app/`, todo `commercial/features/products/**` (listado, alta, edición, detalle, categorías, equivalencias, listas de precios, importación, etiquetas), remitos, y las guías de usuario (`_CommercialGuide.tsx`, `_AccountingGuide.tsx`).

**Decisión de alcance pendiente** (ver §6). Recomendación: **solo capa visible** en la primera pasada.

| Capa | Incluir | Motivo |
|------|---------|--------|
| Textos de UI, títulos, labels, toasts, `meta.title` | ✅ Sí | Es lo que pide el ticket y lo que ve el usuario |
| Guías de usuario en `modules/help` | ✅ Sí | Regla 10 de CLAUDE.md |
| Rutas `/dashboard/commercial/products` → `/items` | ⚠️ A decidir | Rompe links guardados; exige redirects y tocar tests Cypress |
| Modelo Prisma `Product` → `Item` | ❌ No | Migración de alto riesgo, sin beneficio para el usuario |

---

### 🟢 TSK-349 — Conectar el sistema con AFIP

**Estado real: el motor está construido, pero no está enchufado a nada.**

Implementado y funcional:
- `arca/services/wsaa.server.ts` — autenticación WSAA (`getTokenSign`)
- `arca/services/wsfe.server.ts` — `feCAESolicitar`, `feCompUltimoAutorizado`
- `arca/actions.server.ts` — `requestCAE`, `getLastAuthorizedNumber`, `getArcaRequests`
- `arca/features/credentials/actions.server.ts` — alta/baja de credenciales con certificado **cifrado** (`encrypt`/`decrypt`)
- Prisma: modelos `ArcaCredential` (4308) y `ArcaRequest` (4329); campo `cae` en facturas (2729, 2856); `showCae` en plantillas de impresión (4128)
- Complementos ya operativos: importación de comprobantes AFIP en compras, validación AFIP en ventas, puntos de venta, exportaciones fiscales (SIRE, Libro IVA Digital)

Lo que falta — **todo lo que lo vuelve usable**:
- ❌ **Cero consumidores**: ningún archivo fuera de `arca/` importa `requestCAE` ni `getArcaCredentials` (verificado por grep en todo `src/`)
- ❌ **Sin UI**: no existe ninguna ruta bajo `src/app` para ARCA ni para credenciales; no hay forma de cargar el certificado ni la clave privada
- ❌ Sin botón "Solicitar CAE" en el detalle/listado de facturas de venta
- ❌ Sin persistencia del CAE devuelto en la factura, ni de su vencimiento
- ❌ Sin CAE ni código QR en el PDF (aunque `showCae` ya existe en la plantilla)
- ❌ Sin numeración sincronizada contra `feCompUltimoAutorizado`
- ❌ Sin pantalla de historial/reintentos sobre `ArcaRequest`
- ❌ Sin selector homologación / producción visible

Es la tarea más grande del backlog, pero arranca con ventaja: la parte difícil (WSAA, firma, SOAP) ya está resuelta.

---

### ⚪ TSK-319 — Conectar dominio personalizado

Infraestructura, fuera del código: crear subdominio de PMS, apuntar DNS a la VPS, certificado TLS y variables de entorno de la app (`NEXT_PUBLIC_APP_URL`, callbacks de Clerk). No depende de ninguna de las fases anteriores; puede ejecutarse en paralelo.

---

## 4. Plan de implementación

### Fase 0 — Consolidar ramas (bloqueante) · ~2-3 h
1. Verificar que `feat/tsk-409-imputacion-items` y `fix/tsk-410-invitaciones-usuarios` estén completas y mergearlas a `dev` → `main`.
2. Rebasar `feat/tsk-413-movimientos-fondos` sobre `main` actualizado y **no mergearla todavía** — recibe los fixes de la Fase 1 primero.
3. Alinear `dev` con `main` (hoy está 4 commits atrás).

> Sin esta fase, los tickets 481 y 483 no se pueden ni reproducir en `main`.

### Fase 1 — Bugs reportados por el cliente · ~4-6 h
Orden deliberado: 492.2 primero, porque desbloquea la validación funcional de 481.

1. **TSK-492.2** — `defaultValues` completos + schema `.nullish()` + `onInvalid` con toast. *(~1,5 h)*
2. **TSK-483** — `moment.utc` en los 4 puntos de fund-movements. Verificar si hay datos ya corridos en la base del cliente. *(~1 h)*
3. **TSK-481** — server actions de fund-movements devuelven `{success, error}` en vez de lanzar; el modal muestra el mensaje. Evaluar helper compartido si el patrón se repite. *(~2 h)*
4. Tests Cypress de los tres flujos + actualizar guía de usuario si cambia algún texto.

### Fase 2 — Selectores de cuentas con búsqueda · ~5-7 h
1. Crear `shared/components/common/AccountCombobox.tsx` extrayendo el patrón de `_CreateBudgetModal.tsx`. API: `accounts`, `value`, `onChange`, `filter` por tipo, opción "Sin asignar", `disabled`. *(~2 h)*
2. Migrar **primero** `_CommercialIntegrationForm.tsx` (~22 selects) — cierra TSK-492.1. *(~1,5 h)*
3. Migrar los 7 selectores restantes de `main`. *(~2 h)*
4. Migrar los de las ramas TSK-409/413 al integrarlas. *(~1 h)*
5. Cierra **TSK-464 y TSK-492.1**.

### Fase 3 — Renombrado Artículos → Items · ~4-6 h
1. Confirmar alcance (§6) antes de empezar.
2. Reemplazo controlado archivo por archivo en los 44 archivos, respetando género y número (`el artículo` → `el item`, `los artículos` → `los items`).
3. Sidebar, títulos de página, `meta.title` de columnas, mensajes de toast, textos de importación/exportación.
4. Guías de usuario (`_CommercialGuide.tsx`, `_AccountingGuide.tsx`) — regla 10 de CLAUDE.md.
5. Actualizar assertions de los specs Cypress que buscan "Artículos".
6. Si se aprueban rutas: renombrar + `redirects` en `next.config` para no romper links.

### Fase 4 — Facturación electrónica AFIP/ARCA · ~24-32 h
Entregable por sub-fase, cada una utilizable por sí sola.

- **4a — Pantalla de credenciales** *(~6 h)*: ruta `app/(core)/dashboard/commercial/arca/`, módulo `arca/features/credentials/list`, carga de certificado + clave privada, selector homologación/producción, prueba de conexión contra WSAA, permisos (`checkPermission` + `PermissionGuard` + registro en `PERMISSION_MODULE_MAP`).
- **4b — Emisión de CAE** *(~10 h)*: botón "Solicitar CAE" en detalle de factura de venta, cableado de `requestCAE`, persistencia de CAE + vencimiento, estados (pendiente / autorizada / rechazada), manejo de errores de AFIP legibles, numeración sincronizada con `feCompUltimoAutorizado`.
- **4c — Comprobante impreso** *(~5 h)*: CAE, vencimiento y código QR de AFIP en el PDF; activar `showCae`.
- **4d — Historial y reintentos** *(~5 h)*: listado de `ArcaRequest` con request/response, reintento de comprobantes rechazados.

> Estimación sujeta a validar credenciales de homologación disponibles y a probar contra el ambiente de testing de ARCA.

### Fase 5 — Dominio personalizado · ~1-2 h (paralelizable)
DNS, TLS, variables de entorno, callbacks de Clerk. Independiente del resto.

---

## 5. Orden recomendado

```
Fase 0 (ramas)  ──┬── Fase 1 (bugs cliente)   ← máxima urgencia: hay un usuario bloqueado
                  ├── Fase 2 (combobox)       ← alto impacto/costo bajo, patrón ya existe
                  ├── Fase 3 (renombrado)     ← prioridad high del ticket, sin dependencias
                  └── Fase 4 (AFIP)           ← el grande, arranca con el motor ya hecho

Fase 5 (dominio) ──────────────────────────── en paralelo, no depende de nada
```

**Total estimado sin AFIP:** ~15-22 h · **Con AFIP:** ~40-55 h

---

## 6. Decisión tomada

**Alcance del renombrado Artículos → Items (TSK-463): opción A — solo textos visibles.**
Confirmado por Fabricio el 12/08/2026.

- ✅ **Incluye:** textos de UI, títulos, labels, toasts, `meta.title` de columnas, sidebar, guías de usuario en `modules/help`, assertions de Cypress.
- ❌ **No incluye:** renombrado de rutas (`/dashboard/commercial/products` se mantiene) ni del modelo Prisma `Product`.

Descartadas: **B** (textos + rutas — agrega redirects, actualización de todos los `Link` y retoque de specs Cypress) y **C** (además el modelo Prisma — migración de alto riesgo, invisible para el usuario).

---

## 7. Notas de ejecución

- `npm run check-types` **no está en verde en `main`** (errores preexistentes). Filtrar la salida por los archivos tocados en cada fase, no asumir verde global.
- Regla 7 de CLAUDE.md: tests Cypress con cada cambio (`npm run cy:run:accounting`, `:commercial`).
- Regla 10: actualizar guía de usuario ante cualquier cambio visible.
- Regla 11: `checkPermission` en actions + `PermissionGuard` en páginas + `usePermissions` en cliente — aplica especialmente al módulo ARCA nuevo (Fase 4a).
- Regla 13: registrar el módulo ARCA en `ACTIVATABLE_MODULES` y `PERMISSION_MODULE_MAP` si se expone como módulo de primer nivel.
