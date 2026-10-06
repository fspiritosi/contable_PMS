# TSK-757 — Cuenta contable por tipo de gasto

**Fecha de inicio:** 2026-10-06
**Estado:** Implementación en progreso (Fase 5 de 9 completada)

---

## 1. Análisis

### 1.1 Problema

Pedido textual (TSK-757, título "Gastos e Impuestos"): *"Tenemos que tener la opción de asignar
tipo de gastos a cuentas contables"*.

Hoy cada egreso (`Expense`, Comercial → Egresos) lleva una **categoría** obligatoria
(`ExpenseCategory`: "Alquiler", "Servicios", "Viáticos"…), pero la categoría **no influye en la
contabilidad**: al confirmar, el asiento va **siempre** a la misma cuenta, "Cuenta de Gastos
Operativos" (`AccountingSettings.expensesAccountId`) contra "Cuentas por Pagar". Resultado: el
Estado de Resultados y el Mayor muestran todos los egresos amontonados en una sola cuenta, y la
contadora tiene que reclasificarlos a mano con asientos manuales.

Esta limitación ya estaba registrada como **deuda conocida** en
`.planes/tsk-585a-conceptos-en-movimientos-de-fondos.md` §3 (líneas 42-52: "hoy todos los gastos
van a la misma cuenta contable, sin importar su categoría") y §12 (línea 178: "merece su propio
ticket"). TSK-757 es ese ticket.

**Qué se quiere lograr**: que cada categoría de gasto pueda tener su **propia cuenta contable**, y
que al confirmar un egreso el Debe vaya a la cuenta de su categoría; si la categoría no tiene
cuenta, se usa la cuenta por defecto de Ajustes (comportamiento actual, sin romper nada).

**Sobre "Impuestos" en el título**: ver §1.2.6. Conclusión: el egreso **no tiene IVA ni
percepciones** (es un importe único sin discriminar); "Gastos e Impuestos" parece aludir al uso
de categorías para tasas/impuestos no recuperables (ABL, patentes, IIBB, sellos, impuesto al
cheque), que con este ticket podrán ir cada una a su cuenta. El crédito fiscal (IVA) no entra:
los comprobantes con IVA discriminado se cargan como factura de compra. Se recomienda confirmarlo
con la clienta (decisión abierta D1).

### 1.2 Contexto actual

#### 1.2.1 Modelo de datos

- `ExpenseCategory` (`prisma/schema.prisma:3645-3659`): `id`, `name`, `description?`,
  `companyId`, `isActive`, timestamps. Único `[companyId, name]`. **Sin `accountId`**. Relación
  `expenses Expense[]`.
- `Expense` (`prisma/schema.prisma:3661-3694`): `description`, `amount Decimal(15,2)` (importe
  único), `date`, `dueDate?`, `status`, `notes?`, `categoryId` (**obligatorio**), `supplierId?`,
  `journalEntryId?`. **Sin campos de impuestos, sin `accountId` propio, sin `costCenterId`**.
- `AccountingSettings.expensesAccountId` (`prisma/schema.prisma:542`, relación `ExpensesAccount`
  :572) y `payablesAccountId` (:532, :566).
- `Account` concentra las relaciones inversas (`prisma/schema.prisma:~320-365`); el patrón de
  TSK-724c agregó ahí `vehicleTypesAsFixedAsset` etc. (:355-357). Hará falta una inversa nueva
  (p. ej. `expenseCategories ExpenseCategory[] @relation("ExpenseCategoryAccount")`).
- `Budget` (`prisma/schema.prisma:477-489`): un presupuesto por `accountId` + `fiscalYear`.

#### 1.2.2 Asiento del egreso

`createJournalEntryForExpense` (`src/modules/accounting/features/integrations/commercial/index.ts:962-1033`):

- Lee el gasto (`select` en :970-977) **sin la categoría**.
- Exige `expensesAccountId` y `payablesAccountId` (:987-993, defensa en profundidad, TSK-728).
- Líneas: Debe `settings.expensesAccountId` (:999-1004) / Haber `settings.payablesAccountId` con
  `supplierId` (:1005-1011). Ninguna línea lleva `costCenterId` (el tipo
  `JournalEntryLineInput` ya lo admite, :87).

Pre-validación en `confirmExpense` (`src/modules/commercial/features/expenses/actions.server.ts:538-622`):

- `EXPENSE_ENTRY_FIELDS` = `['expensesAccountId','payablesAccountId']` (:487).
- `assertExpenseEntryAccounts` (:494-530): ambas cargadas **e imputables**
  (`buildImputableAccountsWhere`), con `BusinessError` que nombra el label del campo y la ruta
  `ACCOUNTING_SETTINGS_PATH`.
- `confirmExpense` lee `categoryId` (:551) pero no lo usa; lee settings (:556-559) y llama a
  `assertExpenseEntryAccounts` (:565).
- **Control presupuestario** (:568-586): `checkBudgetForExpense(settings.expensesAccountId, …)`
  (definido en `integrations/commercial/index.ts:1049+`), busca un `Budget` ACTIVE de **esa**
  cuenta. No bloqueante.
- Transacción (:588-601): pasa a `CONFIRMED` y crea el asiento.

Con la cuenta por categoría hay que cambiar **las tres piezas**: la pre-validación (¿qué cuenta
se valida?), el control presupuestario (¿contra qué cuenta?) y el asiento.

#### 1.2.3 ABM de categorías (inline, dentro del alta de egreso)

- Actions en `expenses/actions.server.ts`: `getExpenseCategories` (:50, activas, para el combo),
  `getAllExpenseCategories` (:70, todas + `_count.expenses`), `createExpenseCategory` (:91),
  `updateExpenseCategory` (:124), `toggleExpenseCategory` (:160). Permisos:
  `commercial.expenses` view/create/update.
- Estas actions **lanzan `Error`** (p. ej. P2002 "Ya existe una categoría con ese nombre",
  :114-116 y :147-149). Según el patrón de `ActionResult`/`BusinessError` del repo, Next **redacta
  los `throw` en producción**: hoy en prod el usuario ve un error genérico. Conviene migrarlas a
  `ActionResult` ya que se tocan.
- Validador `expenseCategoryFormSchema` (`expenses/validators.ts:32-37`): `name`, `description`.
- UI: `src/modules/commercial/features/expenses/components/_CategoryManagementModal.tsx`
  (311 líneas, **ya excede las 200**): form de alta arriba (nombre + descripción) y lista con
  edición inline (dos `Input` por fila) y botón activar/desactivar.
- El modal **solo se abre desde** `_CreateExpenseModal.tsx:223-231` (botón "Gestionar" junto al
  combo Categoría, :215-254). No hay pantalla propia ni ruta.
- Otro consumidor de categorías: `src/modules/dashboard/actions.server.ts:390-409`
  (`getExpenseCategories` del dashboard, gráfico `_ProfitabilityChart.tsx`) — agrupa por
  categoría, no por cuenta: **no se ve afectado**.

#### 1.2.4 Patrones existentes "cuenta propia con fallback a la por defecto"

| Ticket | Entidad | Campo(s) | Fallback | Dónde se resuelve |
|---|---|---|---|---|
| TSK-724c | `VehicleType` (`schema.prisma:1106-1130`) | 3 FK `Account?` con `onDelete: SetNull` | `AccountingSettings` (bienes de uso) | amortización/baja |
| TSK-717 | `Partner.contributionsAccountId` | 1 FK | `partnerContributionsAccountId` | `resolvePartnerCapitalAccount` (`treasury/features/fund-movements/list/actions.server.ts:231-275`) |
| TSK-579/721 | `Product` (cuenta de egresos/ingresos) | FK por ítem | `purchasesAccountId`/`salesAccountId` | asiento de facturas |

Piezas reutilizables:

- `AccountCombobox` (`src/shared/components/common/AccountCombobox.tsx:25-37`): `accounts`,
  `value`, `onChange`, `clearLabel` (opción "Sin asignar (usar la cuenta por defecto)").
- Consulta de cuentas imputables con `includeIds` para no perder una cuenta guardada que dejó de
  ser imputable: `getVehicleTypeAssetAccounts` (`company/features/vehicle-types/list/actions.server.ts:176-200`).
- `assertAccountBelongsToCompany` / `resolveAccountsInput` (mismo archivo, :229-256): validación al
  guardar.
- `_VehicleTypeAccountsFields.tsx` separado del modal para respetar las 200 líneas.
- Semántica de la resolución de TSK-717 (comentario :231-246): **si la entidad tiene cuenta
  propia y no es imputable → error; nunca caer en silencio a la por defecto**. Sin propia → por
  defecto; sin ninguna → error que nombra la entidad y dónde configurarla.
- Semántica "por defecto" de TSK-721: label "… por defecto" + ayuda que dice cuándo se usa
  (`settings-account-labels.ts:54-63`; `_CommercialIntegrationForm.tsx:62-79`). Hoy
  `expensesAccountId` se llama **"Cuenta de Gastos Operativos"** (:56) con ayuda "Se usa al
  confirmar gastos operativos (Debe)" (`_CommercialIntegrationForm.tsx:78`): hay que pasarla a
  "Cuenta de egresos por defecto" con ayuda tipo "Se usa al confirmar egresos cuya categoría no
  tiene cuenta propia…".

#### 1.2.5 Tipos de cuenta admitidos

- `filterExpenseAccounts` (`src/modules/commercial/features/products/shared/account-filters.ts:21-28`)
  admite `['EXPENSE','ASSET']` porque un ítem comprado puede ser un bien de uso. Está en
  `products/shared`, no en `shared/`, así que **no se puede importar desde expenses** sin violar
  la regla de comunicación entre features si se considera otro dominio (mismo módulo commercial:
  sí se puede, pero mejor filtrar en la query con `buildImputableAccountsWhere({ types })`).
- Ajustes filtra `expensesAccountId` a `['EXPENSE']` (`_CommercialIntegrationForm.tsx:77`).
- Para una categoría de gasto el caso natural es **EXPENSE**. ASSET serviría para anticipos,
  gastos pagados por adelantado (seguros anuales) o impuestos a favor (p. ej. anticipos de
  Ganancias/IIBB), que algunos estudios cargan como "egreso". Ver decisión D2.

#### 1.2.6 "Impuestos": ¿qué ignora hoy el asiento del egreso?

- `Expense` no tiene IVA, neto, percepciones ni retenciones: solo `amount`
  (`schema.prisma:3666`). El form (`expenses/validators.ts:20-28` y `_CreateExpenseModal.tsx`)
  tampoco los pide. El asiento es Debe gasto = Haber proveedor por el mismo importe.
- Es decir, **el asiento no "ignora" un impuesto cargado: el egreso no lo modela**. Un servicio con
  factura A cargado como egreso hoy manda el IVA al gasto (pérdida del crédito fiscal en la
  contabilidad). El circuito correcto para eso ya existe: **factura de compra sin ítem**, que usa
  `purchasesAccountId`, `vatCreditAccountId` y percepciones sufridas
  (`_CommercialIntegrationForm.tsx:69-73`).
- Agregar IVA/percepciones al egreso duplicaría la factura de compra y toca libro IVA Compras /
  AFIP: **merece alcance aparte** (o directamente orientar a la clienta a usar factura de compra).
  Recomendación en D1.
- Lo que sí aplica a "impuestos" con este ticket: categorías como "Impuesto inmobiliario",
  "Patentes", "Tasas municipales", "IIBB" podrán imputar a su cuenta de impuestos (EXPENSE).

#### 1.2.7 Otros flujos tocados por el egreso

- **Orden de pago** sobre un egreso: debita `payablesAccountId` → no cambia.
- **Anular** (`cancelExpense`, `actions.server.ts:624-668`): pasa a `CANCELLED` **sin revertir el
  asiento** aunque esté `CONFIRMED`. Es un hueco preexistente, ajeno a este ticket; se anota en
  riesgos (R7) y no se resuelve acá.
- **Editar** (`updateExpense`, :446) solo en DRAFT: el usuario puede cambiar la categoría hasta
  confirmar; la cuenta se resuelve **al confirmar**, no se guarda en el egreso.
- **Detalle** (`_ExpenseDetailModal.tsx:184`) muestra el nombre de la categoría; podría mostrar
  "Se imputará a: 5.2.03 Alquileres" en borradores (mejora opcional, D6).
- **Validación de auxiliares**: `validateAuxiliaries` vive en
  `accounting/features/entries/validators/index.ts:95-120` y solo la usa el asiento manual; los
  asientos automáticos no la aplican. Si una cuenta de categoría tiene
  `requiresAuxiliary='COST_CENTER'`, el asiento del egreso no lo exigirá (igual que hoy). Ver R5 y
  la relación con TSK-738.

#### 1.2.8 Tests existentes

`src/modules/commercial/features/expenses/expense-journal-entry.integration.test.ts` (319 líneas,
Vitest, `describe.skipIf(!dbAvailable)`): 7 casos de TSK-728 (asiento OK, cuentas faltantes,
cuenta inactiva, budgetWarning, período cerrado, doble confirmación). Crea su categoría en :153.
Es la base natural para los casos nuevos (categoría con cuenta, sin cuenta, cuenta de categoría
no imputable, presupuesto de la cuenta de la categoría).
`src/modules/commercial/shared/settings-accounts.test.ts` referencia el label "Gastos Operativos":
se ajusta si se renombra.

### 1.3 Archivos involucrados

**Esquema y migración**
- `prisma/schema.prisma` — `ExpenseCategory.accountId String? @db.Uuid` + relación
  `account Account? @relation("ExpenseCategoryAccount", …, onDelete: SetNull)` + `@@index`
  opcional; inversa en `Account` (~:355).
- `prisma/migrations/<fecha>_tsk_757_expense_category_account/` — `ALTER TABLE
  expense_categories ADD COLUMN account_id uuid NULL` + FK. Aditiva, **sin backfill**.

**Categorías (ABM)**
- `src/modules/commercial/features/expenses/validators.ts` — `accountId` opcional/nullable en
  `expenseCategoryFormSchema` (+ test unitario).
- `src/modules/commercial/features/expenses/actions.server.ts` — select de `account` en
  `getAllExpenseCategories`; `accountId` en create/update con validación de pertenencia a la
  empresa e imputabilidad; nueva `getExpenseCategoryAccounts(includeIds?)`; migrar a
  `ActionResult`.
- `src/modules/commercial/features/expenses/components/_CategoryManagementModal.tsx` — partir
  (ya 311 líneas): p. ej. `_CategoryCreateForm.tsx`, `_CategoryRow.tsx` y un campo
  `_CategoryAccountField.tsx` con `AccountCombobox`. O pantalla nueva (D4).

**Confirmación y asiento**
- `src/modules/commercial/features/expenses/actions.server.ts` — `confirmExpense` /
  `assertExpenseEntryAccounts`: resolver cuenta de Debe (categoría ?? por defecto), validar
  imputabilidad de la que se use, presupuesto contra la cuenta resuelta.
- `src/modules/accounting/features/integrations/commercial/index.ts` (:962-1033) —
  `createJournalEntryForExpense` lee `category.account` y usa la misma regla de resolución; el
  `expensesAccountId` de Ajustes deja de ser obligatorio cuando la categoría tiene cuenta.
- `src/modules/commercial/shared/settings-accounts.ts` — si la regla "faltante" cambia a
  condicional.

**Ajustes contables**
- `src/shared/lib/accounts/settings-account-labels.ts:56` — renombrar a "Cuenta de egresos por
  defecto" (o similar).
- `src/modules/accounting/features/settings/components/_CommercialIntegrationForm.tsx:74-79` —
  ayuda nueva.

**Visualización (opcional)**
- `src/modules/commercial/features/expenses/list/components/_ExpenseDetailModal.tsx` — cuenta a
  la que imputa / imputó.
- `src/modules/commercial/features/expenses/list/components/_CreateExpenseModal.tsx` — mostrar la
  cuenta de la categoría bajo el combo (ayuda visual).

**Tests**
- `src/modules/commercial/features/expenses/expense-journal-entry.integration.test.ts` — casos
  nuevos.
- `src/modules/commercial/features/expenses/validators.test.ts` (nuevo) — schema de categoría.
- `src/modules/commercial/shared/settings-accounts.test.ts` — label renombrado.

**Documentación**
- `docs/modules/commercial.md` (:631-638 "Confirmar Gasto", :740 tabla de asientos, :947-948
  requisitos, :991) y `docs/modules/accounting.md` (mención de "Gastos Operativos").
- `docs/architecture/data-model.md:451` — `ExpenseCategory` con `accountId`.
- `src/modules/help/features/guide/components/_CommercialGuide.tsx` (sección Egresos
  :1125-1230; "Qué revisa el sistema al confirmar" y "categorías de gasto" :1220).
- `src/modules/help/features/guide/components/_AccountingGuide.tsx` — menciona "Gastos
  Operativos".
- `scripts/guia-presentacion/tsk-757.html` + `capturas-tsk757.mjs` → PDF con `generar-pdf.mjs`.
- (No se editan) `scripts/guia-presentacion/tsk-728.*`: históricos.

### 1.4 Dependencias

- **TSK-728** (ya en main): pre-validación del asiento del egreso y errores `ActionResult`. Este
  ticket la extiende; mantener sus 7 casos verdes.
- **TSK-721**: semántica y redacción de las cuentas "por defecto".
- **TSK-717 / TSK-724c**: patrón de FK opcional + fallback + combo con `includeIds`.
- **TSK-738 (hermano, pendiente)**: agregará `costCenterId` a `Expense` y lo pasará a la línea
  de Debe del mismo asiento (`createJournalEntryForExpense`). Ambos tickets tocan **la misma
  línea del asiento y el mismo `confirmExpense`**. Oportunidades: (a) implementar 757 primero y
  dejar la línea de Debe armada en un helper (`buildExpenseDebitLine`) que 738 solo complete con
  `costCenterId`; (b) si 738 se hace antes, 757 debe respetar el centro. Con la cuenta por
  categoría, 738 gana sentido: una categoría con cuenta `requiresAuxiliary='COST_CENTER'` podría
  exigir centro (hoy los asientos automáticos no validan auxiliares). Coordinar orden en
  Planificación; no bloquea.
- **Presupuestos** (`accounting.budgets`): el control de `checkBudgetForExpense` depende de la
  cuenta resuelta.
- No requiere registrar módulos (`ACTIVATABLE_MODULES`) ni permisos nuevos si el ABM sigue en
  `commercial.expenses`.

### 1.5 Restricciones y reglas

- **Prisma** (CLAUDE.md, regla 9): `select` explícito; `getActiveCompanyId()`; columna nueva
  **nullable** y migración aditiva; no hay Decimals nuevos.
- **Multiempresa**: validar al guardar que `accountId` pertenece a la empresa activa (como
  `assertAccountBelongsToCompany`, vehicle-types :229-241).
- **Imputabilidad**: el combo ofrece solo cuentas imputables (`buildImputableAccountsWhere`,
  `src/shared/lib/accounts/imputable-accounts.ts`), preservando la guardada vía `includeIds`; al
  confirmar se revalida (puede haberse desactivado entre medio).
- **Sin fallback silencioso** (criterio de TSK-717): si la categoría tiene cuenta y no es
  imputable, **bloquear** con mensaje que nombre la categoría, la cuenta y dónde corregirla; no
  caer a la por defecto.
- **Errores de negocio**: `BusinessError` + `ActionResult` (Next redacta los `throw` en prod).
- **Permisos** (regla 11): ABM de categorías con `commercial.expenses` create/update (actual).
  Elegir la cuenta es una decisión contable: evaluar exigir además `accounting.settings` update
  para cambiar `accountId` (D5). En UI, `usePermissions().hasPermission` para mostrar el combo
  editable. `PermissionGuard` ya está en `ExpensesList.tsx:31`.
- **Componentes < 200 líneas**, client components con prefijo `_`, `AccountCombobox` (no `Select`)
  para planes de cuentas largos.
- **Egresos ya confirmados no se tocan**: su asiento queda como está. Sin backfill ni
  reclasificación automática; si la clienta quiere reclasificar el histórico, es asiento manual.
- **Retrocompatibilidad**: categorías sin cuenta → comportamiento idéntico al actual.
- **Testing**: Vitest (`npm run test`, `*.integration.test.ts`), no Cypress.
- **Entregables**: docs/, guía in-app (`_CommercialGuide.tsx`, `_AccountingGuide.tsx`) y guía de
  presentación PDF (`scripts/guia-presentacion/`).
- moment.js, logger, AlertDialog — sin novedades aquí.

### 1.6 Riesgos identificados

**Riesgos**

- **R1 — Presupuestos dejan de "ver" egresos.** Si hoy hay un `Budget` sobre la cuenta por
  defecto y se asignan cuentas por categoría, esos egresos ya no consumen ese presupuesto (ni en
  el aviso ni en la ejecución, que se calcula por asientos). Es el comportamiento contable correcto,
  pero hay que avisarlo en la guía/PDF. Mitigación: `checkBudgetForExpense` con la **cuenta
  resuelta**; test de integración con presupuesto en la cuenta de la categoría.
- **R2 — Cuenta de categoría inactiva/no imputable al confirmar.** Mitigación: revalidación en
  `confirmExpense` con `BusinessError` claro; el egreso queda en borrador.
- **R3 — Pre-validación demasiado estricta.** Hoy `expensesAccountId` es obligatorio siempre
  (:487, :987-993). Si todas las categorías usadas tienen cuenta, exigir la por defecto bloquearía
  sin motivo. Mitigación: exigirla solo cuando la categoría no tiene cuenta (mismo criterio que
  `purchasesAccountId` en TSK-721).
- **R4 — Borrar una cuenta usada por una categoría.** Con `onDelete: SetNull` la categoría vuelve
  a "por defecto" sin aviso. Aceptable (igual que VehicleType); documentarlo.
- **R5 — Auxiliares.** Una cuenta de categoría con `requiresAuxiliary` (COST_CENTER, SUPPLIER) no
  se valida en el asiento automático; SUPPLIER no aplica al Debe. Queda para TSK-738; no empeora
  lo actual.
- **R6 — Duplicación de lógica de resolución** entre `confirmExpense` (pre-validación) y
  `createJournalEntryForExpense` (asiento). Mitigación: helper puro compartido
  (`resolveExpenseDebitAccount(category, settings)`) con test unitario.
- **R7 — Preexistente, fuera de alcance:** `cancelExpense` (:624-668) anula un egreso confirmado
  sin revertir el asiento. No lo agrava este ticket; conviene abrir ticket aparte.
- **R8 — Modal ya excedido (311 líneas)**: agregar el combo obliga a refactorizar; riesgo de
  regresión en el ABM. Mitigación: partir en componentes y probar manualmente alta/edición/toggle.

**Decisiones abiertas (con recomendación)**

- **D1 — Alcance de "Impuestos".** ¿Agregar IVA/percepciones al egreso? **Recomendación: no.**
  Este ticket = cuenta por categoría (que ya permite categorías de impuestos/tasas no
  recuperables a su cuenta). Comprobantes con IVA discriminado → factura de compra sin ítem.
  Explicarlo en el PDF y preguntar a la clienta si "Impuestos" se refería a otra cosa (p. ej. los
  "Gastos e impuestos bancarios" de movimientos de fondos, que ya tienen cuenta por concepto desde
  TSK-585a/718).
- **D2 — Tipos de cuenta admitidos.** **Recomendación: EXPENSE solamente** (como Ajustes). Si la
  clienta necesita anticipos/impuestos a favor, ampliar a `['EXPENSE','ASSET']` es trivial
  (`types` del where); preguntarlo en el PDF.
- **D3 — Comportamiento sin cuenta en la categoría.** **Recomendación: fallback a la por defecto**
  (renombrada "Cuenta de egresos por defecto"), como 717/724c/721; sin ninguna de las dos →
  `BusinessError` que nombra la categoría y las dos formas de resolverlo. Alternativa descartada:
  hacer obligatoria la cuenta en la categoría (rompe empresas existentes).
- **D4 — ¿ABM inline o pantalla de configuración?** **Recomendación: mantener el modal** (es donde
  la clienta ya gestiona categorías) refactorizado en componentes, agregando la columna "Cuenta
  contable" y, además, un acceso "Gestionar categorías" en la cabecera de `ExpensesList.tsx`
  para no depender del alta de un egreso. Una pantalla aparte en Empresa
  (`/dashboard/company/...`, junto a Tipos de Equipo) sería más coherente con 724c pero agrega
  ruta, permiso y sidebar: dejarlo como alternativa si la Planificación lo prefiere.
- **D5 — Permiso para asignar la cuenta.** **Recomendación: `commercial.expenses` update** (sin
  permiso nuevo), como en 717/724c donde la cuenta se edita con el permiso de la entidad. Opción
  más estricta: mostrar el combo solo con `accounting.settings` update.
- **D6 — Mostrar la cuenta en el egreso.** **Recomendación: sí, liviano**: en el detalle, "Cuenta
  contable: X (de la categoría)" o "(por defecto)" para borradores; para confirmados, la del
  asiento. No guardar la cuenta en `Expense` (el asiento es el registro).
- **D7 — Orden con TSK-738.** **Recomendación:** hacer 757 primero y dejar la línea de Debe en un
  helper al que 738 agregue `costCenterId`; ambos comparten test de integración.
- **D8 — Egresos ya confirmados.** **Recomendación: no se tocan** (sin backfill, sin
  reclasificación automática); decirlo explícito en guía y PDF.

---

## 2. Planificación

Nueve fases que van del dato a la superficie: esquema → helpers puros con TDD → ABM de
categorías en el servidor (con `ActionResult`) → confirmación y asiento con la cuenta resuelta →
UI de categorías (modal partido en piezas < 200 líneas y acceso desde el listado) → cuenta visible
en el egreso → verificación en navegador con capturas → documentación y presentación →
verificación final. Una migración aditiva; ningún permiso ni módulo nuevo.

Rutas abreviadas: `EXP/` = `src/modules/commercial/features/expenses/`;
`INT/` = `src/modules/accounting/features/integrations/commercial/`.

### 2.0 Decisiones adoptadas

Se adoptan **todas** las recomendaciones del análisis (1.6). D1 queda fuera de alcance y se le
pregunta a la clienta por separado.

| # | Decisión adoptada |
|---|---|
| D1 | **Fuera de alcance.** El egreso sigue sin IVA/percepciones. Comprobantes con IVA discriminado → factura de compra sin ítem. La presentación lo explica y deja la pregunta abierta a la clienta ("¿'Impuestos' se refería a otra cosa?"); se registra en 2.4. |
| D2 | La cuenta de la categoría admite solo cuentas **`EXPENSE`** imputables (como Ajustes). Ampliar a `ASSET` queda como pregunta a la clienta en el PDF. |
| D3 | **Fallback a la por defecto**: categoría con cuenta → esa; sin cuenta → `expensesAccountId` de Ajustes, renombrada **"Cuenta de egresos por defecto"**; sin ninguna → `BusinessError` que nombra la categoría y las dos formas de resolverlo. Si la categoría tiene cuenta y no es imputable → **bloquea** (nunca cae en silencio a la por defecto, criterio de TSK-717). |
| D4 | Se mantiene el **modal** de categorías, partido en componentes, con la columna "Cuenta contable"; además se agrega un botón **"Categorías"** en la barra del listado de Egresos (no depende de abrir el alta de un egreso). Sin pantalla nueva en Empresa. |
| D5 | Asignar/cambiar la cuenta usa el permiso existente **`commercial.expenses`** (`create` en el alta, `update` en la edición). Sin permiso nuevo. |
| D6 | Cuenta visible y liviana: bajo el combo de categoría del alta ("Se imputa a: 5.2.03 Alquileres" / "Cuenta de egresos por defecto"); en el detalle, "Cuenta contable" con origen — borrador: "(de la categoría)" o "(por defecto)"; confirmado: la cuenta del Debe del asiento. **No** se guarda la cuenta en `Expense`. |
| D7 | 757 va primero. La línea de Debe se arma en un helper puro `buildExpenseDebitLine` (`src/modules/commercial/shared/expense-accounts.ts`) cuyo input es un objeto al que TSK-738 sumará `costCenterId` sin cambiar a los llamadores; el test de integración queda preparado para que 738 agregue sus casos. |
| D8 | Egresos ya confirmados **no se tocan**: sin backfill ni reclasificación; dicho explícitamente en guía in-app y PDF. |

Otras decisiones de esta planificación:

- **Dónde vive la resolución**: helper puro en `src/modules/commercial/shared/expense-accounts.ts`
  (sin Prisma). Lo importan `EXP/actions.server.ts` (pre-validación, presupuesto, detalle) e
  `INT/index.ts` (asiento), que ya importa de `@/modules/commercial/shared/*`
  (`cost-center`, `perceptions`, `settings-accounts`): no se crea una dependencia nueva entre
  módulos. Mitiga R6 (lógica duplicada).
- **Cuentas de Ajustes exigidas según la categoría** (R3): `payablesAccountId` siempre;
  `expensesAccountId` solo si la categoría no tiene cuenta. Así los mensajes de TSK-728 (casos 2 y
  3) se conservan cuando la categoría no tiene cuenta, con el label renombrado.
- **Errores de las actions de categorías** (memoria `errores-negocio-server-actions`): las tres
  mutaciones (`createExpenseCategory`, `updateExpenseCategory`,
  `toggleExpenseCategory`) pasan a `Promise<ActionResult<…>>` con `BusinessError` para P2002
  ("Ya existe una categoría con ese nombre"), "Categoría no encontrada" y "La cuenta contable
  seleccionada no pertenece a la empresa"; el `catch` devuelve `toActionResult(error, '…')`. Las
  lecturas (`getExpenseCategories`, `getAllExpenseCategories`, `getExpenseCategoryAccounts`) siguen
  lanzando: solo fallan por errores técnicos. "No autenticado"/"No hay empresa activa" quedan como
  `throw` (no son de negocio, igual que `confirmExpense`).
- **`updateExpenseCategory`**: `accountId: undefined` = no tocar; `null` = volver a "por defecto";
  string = validar pertenencia a la empresa (no imputabilidad: el combo ya filtra y la cuenta
  guardada se conserva con `includeIds`; la que rechaza es la confirmación — patrón 724c).
- **Combo de cuentas**: action nueva `getExpenseCategoryAccounts(includeIds?: string[])` (molde
  `getVehicleTypeAssetAccounts`, `company/features/vehicle-types/list/actions.server.ts:176-200`)
  con `buildImputableAccountsWhere({ companyId, types: ['EXPENSE'] })` + `includeIds`, permiso
  `commercial.expenses` view. Se usa `AccountCombobox` con
  `clearLabel="Sin asignar (usar la cuenta de egresos por defecto)"`.
- **Archivos ya excedidos que se tocan** (`_CreateExpenseModal.tsx` 340, `_ExpenseDetailModal.tsx`
  400, `_ExpensesTable.tsx` 301): no se refactorizan enteros en este ticket (riesgo de regresión
  ajeno al objetivo); lo nuevo entra como componentes chicos aparte y esos archivos **no crecen**
  más de 3-4 líneas (import + uso). El refactor queda en 2.4. El modal de categorías sí se parte
  (D4/R8), porque se reescribe.
- **Testing**: Vitest (`npm run test`). Tests puros del helper y del validador (TDD) y casos nuevos
  en `EXP/expense-journal-entry.integration.test.ts` contra la DB local (`contable-pms-db`). Los
  `.tsx` no se testean. **No Cypress.**
- **Línea base**: `npm run check-types` da **219** errores preexistentes; criterio "no sube".
  `eslint` sin errores en archivos tocados.

### 2.1 Fases de implementación

#### Fase 1: Esquema y migración

- **Objetivo:** `ExpenseCategory` con cuenta contable opcional; migración aditiva; cliente
  regenerado. Sin cambio de comportamiento.
- **Tareas:**
  - [x] Medir línea base: `npm run check-types 2>&1 | grep -c "error TS"` (esperado 219) y
        `npm run test` (anotar cuántos pasan); registrarlas en la sección 4.
  - [x] `prisma/schema.prisma:3645-3659` (`model ExpenseCategory`), después de `isActive`:
        ```prisma
        // TSK-757: cuenta contable de la categoría; null = usa la cuenta de egresos por defecto de AccountingSettings
        accountId   String?  @map("account_id") @db.Uuid
        ```
        relación `account Account? @relation("ExpenseCategoryAccount", fields: [accountId],
        references: [id], onDelete: SetNull)` junto a `company`/`expenses`, y
        `@@index([accountId])` antes de `@@map`.
  - [x] `prisma/schema.prisma` (`model Account`, después de `depreciationsAsDepreciationExpense`,
        ~:360): inversa `expenseCategories ExpenseCategory[] @relation("ExpenseCategoryAccount")`
        con comentario `// TSK-757`.
  - [x] Con el docker `contable-pms-db` arriba: `npm run db:migrate -- --name
        tsk_757_expense_category_account`. Verificar que
        `prisma/migrations/<timestamp>_tsk_757_expense_category_account/migration.sql` tenga
        **solo** 1 `ALTER TABLE "expense_categories" ADD COLUMN "account_id" UUID`, 1
        `CREATE INDEX` y 1 `ADD CONSTRAINT … FOREIGN KEY ("account_id") REFERENCES
        "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE`. Sin `UPDATE`, sin backfill (D8).
        Si `migrate dev` detecta drift ajeno, no resetear: `npx prisma migrate status`.
  - [x] `npm run db:generate`; `npm run check-types` sigue en 219.
  - [x] Anotar en la sección 4 que en producción la aplica el `docker-entrypoint.sh` al deployar
        (memoria `produccion-dokploy-scripts-db`) y que es aditiva (no afecta categorías
        existentes: quedan "por defecto").
- **Archivos:** `prisma/schema.prisma` (modificar);
  `prisma/migrations/<timestamp>_tsk_757_expense_category_account/migration.sql` (nuevo).
- **Criterio de completitud:** `npx prisma migrate status` en verde; `ExpenseCategory.accountId`
  / `account` en `src/generated/prisma`; tipos en 219; commit
  `feat(commercial): la categoría de gasto puede tener cuenta contable (TSK-757, fase 1)`.

#### Fase 2: Helpers puros de resolución y validador (TDD)

- **Objetivo:** toda la regla "qué cuenta va al Debe" y sus mensajes en funciones puras testeadas,
  antes de tocar actions.
- **Tareas:**
  - [x] Crear `src/modules/commercial/shared/expense-accounts.test.ts` primero (rojo) y después
        `src/modules/commercial/shared/expense-accounts.ts` con:
    - `type ExpenseDebitSource = 'category' | 'default'`.
    - `resolveExpenseDebitAccount({ categoryAccountId, defaultAccountId })` →
      `{ accountId: string; source: ExpenseDebitSource } | null` (categoría gana; `''` cuenta
      como vacío, igual que `findMissingSettingsAccounts`).
    - `requiredExpenseSettingsFields(categoryAccountId)` → `['payablesAccountId']` si la
      categoría tiene cuenta, si no `['expensesAccountId', 'payablesAccountId']`
      (`AccountingSettingsAccountField[]`, conserva el orden de TSK-728).
    - `buildCategoryAccountNotImputableMessage(documentLabel, categoryName, accountLabel | null)`
      → "No se puede confirmar el gasto G-0001: la cuenta 5.2.03 - Alquileres de la categoría
      "Alquiler" no está activa o no es imputable. Corregila en Comercial → Egresos →
      Categorías." (variante "ya no existe en el plan de cuentas" si `accountLabel` es null).
    - Constante `EXPENSE_CATEGORIES_PATH = 'Comercial → Egresos → Categorías'`.
    - `type ExpenseDebitLine = { accountId: string; debit: number; credit: 0; description: string;
      costCenterId?: string }` y `buildExpenseDebitLine({ accountId, amount, fullNumber,
      description })` → la línea actual de `INT/index.ts:999-1004` (`Gasto ${fullNumber} -
      ${description}`). JSDoc: "TSK-738 suma `costCenterId` al input y lo copia a la línea".
    - `describeExpenseDebitSource(source)` → "de la categoría" / "por defecto" (texto de D6).
  - [x] Casos: categoría con cuenta y default vacía → categoría; categoría sin cuenta → default;
        ninguna → null; `''` como vacío; `requiredExpenseSettingsFields` en ambos casos; mensajes
        con y sin cuenta existente; `buildExpenseDebitLine` (importe, crédito 0, descripción, sin
        `costCenterId`).
  - [x] `EXP/validators.ts`: `expenseCategoryFormSchema` suma
        `accountId: z.string().uuid().nullable().optional()`. Crear `EXP/validators.test.ts`: nombre
        vacío falla; `accountId` null/undefined/uuid válidos; string no-uuid falla.
  - [x] `npm run test -- expense-accounts validators` en verde.
- **Archivos:** `src/modules/commercial/shared/expense-accounts.ts` y `.test.ts` (nuevos);
  `EXP/validators.ts` (modificado); `EXP/validators.test.ts` (nuevo).
- **Criterio de completitud:** tests nuevos en verde; sin cambios de UI ni actions; commit
  `feat(commercial): regla de la cuenta del egreso por categoría con fallback (TSK-757, fase 2)`.

#### Fase 3: ABM de categorías en el servidor (cuenta + `ActionResult`)

- **Objetivo:** las actions de categorías guardan/leen la cuenta y sus errores de negocio llegan
  legibles en producción.
- **Tareas:**
  - [x] `EXP/actions.server.ts` `getExpenseCategories` (:50): sumar al `select`
        `account: { select: { id: true, code: true, name: true } }` (lo usa el hint del alta, D6).
  - [x] `getAllExpenseCategories` (:70): sumar `accountId` y el mismo `account`.
  - [x] Nueva `getExpenseCategoryAccounts(includeIds?: string[])`: `checkPermission(
        'commercial.expenses', 'view', { redirect: true })`, `getActiveCompanyId()`,
        `buildImputableAccountsWhere({ companyId, types: ['EXPENSE'] })` envuelto en `OR` con
        `{ companyId, id: { in: includeIds } }` (molde vehicle-types :176-200), `select { id, code,
        name }`, `orderBy code`.
  - [x] Helper privado `assertCategoryAccountBelongsToCompany(accountId, companyId)` →
        `BusinessError('La cuenta contable seleccionada no pertenece a la empresa')` (molde
        vehicle-types :229-241, pero con `BusinessError`).
  - [x] `createExpenseCategory` (:91) → `Promise<ActionResult<{ id: string }>>`: valida
        `accountId` si viene, persiste `accountId ?? null`; P2002 → `BusinessError('Ya existe una
        categoría con ese nombre')`; `catch` → `toActionResult(error, 'Error al crear categoría de
        gasto')`; `logger.warn` para `BusinessError`, `logger.error` para lo demás.
  - [x] `updateExpenseCategory` (:124) → `Promise<ActionResult>`: `accountId` con la semántica
        undefined/null/string de 2.0; `count === 0` → `BusinessError('Categoría no encontrada')`.
  - [x] `toggleExpenseCategory` (:160) → `Promise<ActionResult<{ isActive: boolean }>>`.
  - [x] Ajustar los consumidores mínimos para que compile (el refactor visual es la Fase 5):
        `EXP/components/_CategoryManagementModal.tsx` (`if (!result.success) toast.error(
        result.error)` en lugar de `catch`).
  - [x] Tests de integración en `EXP/expense-journal-entry.integration.test.ts` (nuevo
        `describe` "categorías con cuenta (TSK-757)" reutilizando el andamiaje de empresa/cuentas
        de :52-187): crear con cuenta propia → `accountId` guardado; crear con cuenta de **otra
        empresa** → `{ success: false }` con el mensaje; nombre duplicado → `{ success: false,
        error: 'Ya existe una categoría con ese nombre' }`; update con `accountId: null` → vuelve a
        null; update sin `accountId` → no lo toca; `getExpenseCategoryAccounts([idInactiva])`
        incluye la inactiva guardada y excluye las `ASSET`.
- **Archivos:** `EXP/actions.server.ts`, `EXP/components/_CategoryManagementModal.tsx`,
  `EXP/expense-journal-entry.integration.test.ts`.
- **Criterio de completitud:** tests en verde; tipos ≤ 219; commit
  `feat(commercial): las categorías de gasto guardan su cuenta y devuelven errores legibles
  (TSK-757, fase 3)`.

#### Fase 4: Confirmación y asiento con la cuenta resuelta

- **Objetivo:** al confirmar, el Debe va a la cuenta de la categoría o a la por defecto; la
  pre-validación, el presupuesto y el asiento usan la **misma** cuenta resuelta.
- **Tareas:**
  - [x] `EXP/actions.server.ts` `confirmExpense` (:538): el `select` del egreso suma
        `category: { select: { name: true, accountId: true } }`.
  - [x] Reemplazar `EXPENSE_ENTRY_FIELDS` / `assertExpenseEntryAccounts` (:486-530) por
        `assertExpenseEntryAccounts(companyId, documentLabel, settings, category)` que:
        (1) faltantes con `findMissingSettingsAccounts(settings,
        requiredExpenseSettingsFields(category.accountId))` → mensaje de TSK-728; si falta
        `expensesAccountId`, el mensaje además nombra la categoría y la alternativa ("o asignale
        una cuenta a la categoría "X" en Comercial → Egresos → Categorías"); (2) resuelve con
        `resolveExpenseDebitAccount`; (3) valida imputabilidad de la cuenta resuelta y de
        `payablesAccountId` en una sola consulta (como hoy); si falla la de la categoría →
        `buildCategoryAccountNotImputableMessage`; si falla una de Ajustes → mensaje actual.
        Devuelve `{ debitAccountId }`.
  - [x] Presupuesto (:568-586): `checkBudgetForExpense(debitAccountId, …)` (R1). Actualizar el
        JSDoc de `checkBudgetForExpense` (`INT/index.ts` ~:1043) — "cuenta resuelta del egreso".
  - [x] `INT/index.ts` `createJournalEntryForExpense` (:962-1033): `select` suma
        `category: { select: { name: true, accountId: true } }`; defensa en profundidad con
        `requiredExpenseSettingsFields` + `resolveExpenseDebitAccount` (si null → `BusinessError`
        con el mismo mensaje); la línea de Debe sale de `buildExpenseDebitLine(…)`; actualizar el
        comentario de cabecera (:38 "Debe: Gastos Operativos" → "Debe: cuenta de la categoría o
        de egresos por defecto").
  - [x] `src/shared/lib/accounts/settings-account-labels.ts:56`: `expensesAccountId` →
        `'Cuenta de egresos por defecto'`.
  - [x] `src/modules/accounting/features/settings/components/_CommercialIntegrationForm.tsx:78`:
        ayuda → "Se usa al confirmar egresos cuya categoría no tiene cuenta contable propia
        (Comercial → Egresos → Categorías). Si alguna categoría no tiene cuenta, tiene que estar
        asignada."
  - [x] `src/modules/commercial/shared/settings-accounts.test.ts:101`: label renombrado.
  - [x] `EXP/expense-journal-entry.integration.test.ts`: actualizar casos 2, 3 y 4 al label nuevo
        (:206-256, cabecera :5) sin cambiar su semántica (categoría sin cuenta). Casos nuevos:
    - **8** categoría con cuenta propia y **sin** cuenta por defecto en Ajustes → confirma; Debe
      en la cuenta de la categoría, Haber Cuentas por Pagar con proveedor.
    - **9** categoría con cuenta propia y con cuenta por defecto → el Debe va a la de la
      categoría (no a la por defecto).
    - **10** cuenta de la categoría inactiva → bloqueado nombrando categoría y cuenta; **no** cae
      a la por defecto; sigue en borrador y sin asiento.
    - **11** ninguna de las dos → mensaje que nombra la categoría y las dos formas de resolverlo.
    - **12** presupuesto chico sobre la cuenta de la **categoría** → `budgetWarning`; presupuesto
      sobre la cuenta por defecto no dispara aviso para ese egreso.
    - **13** se borra (o se desvincula) la cuenta de la categoría → `onDelete: SetNull` deja la
      categoría en null y el egreso usa la por defecto (R4). Si borrar la cuenta en el test choca
      con otras FK, cubrirlo con `UPDATE` directo a null y anotarlo.
  - [x] `npm run test` (todo, incluidos los 7 casos de TSK-728).
- **Archivos:** `EXP/actions.server.ts`, `INT/index.ts`,
  `src/shared/lib/accounts/settings-account-labels.ts`,
  `src/modules/accounting/features/settings/components/_CommercialIntegrationForm.tsx`,
  `src/modules/commercial/shared/settings-accounts.test.ts`,
  `EXP/expense-journal-entry.integration.test.ts`.
- **Criterio de completitud:** 13 casos de integración en verde; tipos ≤ 219; commit
  `feat(commercial): el egreso se imputa a la cuenta de su categoría o a la de egresos por defecto
  (TSK-757, fase 4)`.

#### Fase 5: UI de categorías — modal partido y acceso desde el listado

- **Objetivo:** gestionar la cuenta de cada categoría desde un modal < 200 líneas por archivo,
  alcanzable desde el listado y desde el alta del egreso.
- **Tareas:**
  - [x] `EXP/hooks/useExpenseCategoryMutations.ts` (nuevo, sin `_`): `useMutation` de create /
        update / toggle sobre las actions `ActionResult` (`if (!result.success)
        toast.error(result.error)`), `toast.success` e invalidación de
        `['allExpenseCategories']`, `['expenseCategories']` y `['expenseCategoryAccounts']`
        (sale de `_CategoryManagementModal.tsx:59-111`).
  - [x] `EXP/components/_CategoryAccountField.tsx` (nuevo): `useQuery(['expenseCategoryAccounts',
        includeIds], () => getExpenseCategoryAccounts(includeIds))` + `AccountCombobox` con
        `clearLabel` de 2.0, prop `disabled`.
  - [x] `EXP/components/_CategoryCreateForm.tsx` (nuevo): RHF + `zodResolver(
        expenseCategoryFormSchema)` con nombre, descripción y `_CategoryAccountField`; se muestra
        solo con `hasPermission('commercial.expenses', 'create')`.
  - [x] `EXP/components/_CategoryRow.tsx` (nuevo): fila con nombre, descripción, cuenta
        (`code - name` o "Por defecto" en `text-muted-foreground`), badge "Inactiva", conteo de
        egresos; edición inline (nombre, descripción, cuenta) y toggle solo con
        `hasPermission('commercial.expenses', 'update')`. Layout responsive: en `< sm` la cuenta
        baja a su propia línea (`flex-wrap`, `min-w-0`).
  - [x] `EXP/components/_CategoryManagementModal.tsx`: queda como `Dialog` + `useQuery
        (['allExpenseCategories'])` + composición; título "Categorías de egreso" y descripción
        "Cada categoría puede tener su cuenta contable; si no tiene, el egreso usa la cuenta de
        egresos por defecto". `DialogContent` `sm:max-w-2xl` para que entre la cuenta.
  - [x] Acceso desde el listado: `EXP/list/components/_ExpensesToolbarActions.tsx` (nuevo) con el
        botón "Categorías" (icono `Tags`, `variant="outline"`, trigger del modal; visible con
        `view`) + `_CreateExpenseModal` (con `create`); `_ExpensesTable.tsx:211` pasa a
        `toolbarActions={<_ExpensesToolbarActions … />}` (sin crecer).
  - [x] Verificar a mano en `:3010`: alta con y sin cuenta, edición (asignar, cambiar, limpiar),
        toggle, nombre duplicado (toast con el mensaje), y que el combo del alta de egreso se
        refresca al cerrar el modal.
- **Archivos:** `EXP/hooks/useExpenseCategoryMutations.ts`, `EXP/components/_CategoryAccountField.tsx`,
  `_CategoryCreateForm.tsx`, `_CategoryRow.tsx`, `EXP/list/components/_ExpensesToolbarActions.tsx`
  (nuevos); `EXP/components/_CategoryManagementModal.tsx`, `EXP/list/components/_ExpensesTable.tsx`
  (modificados).
- **Criterio de completitud:** `wc -l` de cada archivo nuevo/reescrito < 200; `_ExpensesTable.tsx`
  no crece; flujo manual OK; commit `feat(commercial): cuenta contable en el ABM de categorías de
  egreso y acceso desde el listado (TSK-757, fase 5)`.

#### Fase 6: La cuenta visible en el egreso (D6)

- **Objetivo:** que el usuario sepa a qué cuenta va (o fue) cada egreso sin abrir Contabilidad.
- **Tareas:**
  - [ ] `EXP/list/components/_ExpenseAccountHint.tsx` (nuevo): recibe la categoría elegida
        (`account?: { code, name } | null`) y muestra "Se imputa a: 5.2.03 - Alquileres" o "Se
        imputa a la cuenta de egresos por defecto" (`text-xs text-muted-foreground`).
        `_CreateExpenseModal.tsx` lo monta bajo el combo de categoría (~:215-254) buscando la
        categoría en la lista que ya tiene; el archivo crece ≤ 4 líneas.
  - [ ] `EXP/actions.server.ts` `getExpenseById` (:313): `category.select` suma `accountId` y
        `account { code, name }`; `select` suma `journalEntry: { select: { number: true, lines:
        { where: { debit: { gt: 0 } }, select: { account: { select: { code, name } } }, take: 1 } } }`
        (verificar nombres reales de `JournalEntry`/`JournalEntryLine` en el schema) y lee
        `expensesAccountId` de settings cuando la categoría no tiene cuenta. Devuelve
        `debitAccount: { label: string; source: 'entry' | 'category' | 'default' } | null`
        calculado con `resolveExpenseDebitAccount` (sin `Decimal` nuevos: el `debit` no se
        devuelve).
  - [ ] `EXP/list/components/_ExpenseDebitAccountInfo.tsx` (nuevo): "Cuenta contable" + label +
        origen ("del asiento", "de la categoría", "por defecto"; `null` → "Sin cuenta: configurala
        antes de confirmar"). `_ExpenseDetailModal.tsx:183-184` lo monta junto a "Categoría"
        (crece ≤ 4 líneas).
- **Archivos:** `_ExpenseAccountHint.tsx`, `_ExpenseDebitAccountInfo.tsx` (nuevos);
  `_CreateExpenseModal.tsx`, `_ExpenseDetailModal.tsx`, `EXP/actions.server.ts` (modificados).
- **Criterio de completitud:** borrador muestra la cuenta prevista con su origen, confirmado la
  del asiento; archivos nuevos < 200; tipos ≤ 219; commit `feat(commercial): el egreso muestra la
  cuenta contable a la que imputa (TSK-757, fase 6)`.

#### Fase 7: Verificación en navegador y capturas

- **Objetivo:** evidencia del flujo completo en la app real y capturas para la presentación.
- **Tareas:**
  - [ ] `scripts/guia-presentacion/capturas-tsk757.mjs` (nuevo, patrón `capturas-tsk728.mjs`):
        `chromium.launch().catch(() => chromium.launch({ channel: 'chrome' }))`; login
        `fspiritosi@codecontrol.com.ar` / `Contable2026!` contra `http://localhost:3010` (dev con
        `NEXT_PUBLIC_APP_URL` en ese puerto, memoria `dev-local-capturas-y-login`); siembra por SQL
        categorías/egresos marcados `TSK757-demo%` y limpia al terminar (también ante error).
  - [ ] Capturas a 1440: 01 listado con botón "Categorías"; 02 modal con columna de cuenta (una
        con cuenta, una "Por defecto"); 03 edición de una categoría con el combo abierto; 04 alta
        de egreso con el hint "Se imputa a…"; 05 detalle de un borrador (de la categoría); 06
        confirmación OK y detalle de un confirmado (del asiento); 07 asiento en Contabilidad →
        Asientos/Mayor con la cuenta de la categoría; 08 error al confirmar con cuenta de
        categoría inactiva (toast legible); 09 Ajustes con "Cuenta de egresos por defecto" y su
        ayuda.
  - [ ] Mobile 375×812 (`isMobile: true`): 10 modal de categorías sin scroll horizontal
        (`documentElement.scrollWidth ≤ 375`, `[role="dialog"]` dentro del viewport).
- **Archivos:** `scripts/guia-presentacion/capturas-tsk757.mjs` (nuevo),
  `scripts/guia-presentacion/assets/tsk757-*.png` (nuevas).
- **Criterio de completitud:** el script corre de punta a punta y deja la DB limpia; capturas
  generadas; si aparece un bug, se corrige y se commitea `fix(commercial): … (TSK-757, fase 7)`.

#### Fase 8: Documentación — guía in-app, docs y presentación

- **Objetivo:** entregables obligatorios del ticket.
- **Tareas:**
  - [ ] `src/modules/help/features/guide/components/_CommercialGuide.tsx` (Egresos :1125-1230):
        nueva sub-sección "Categorías y cuenta contable" (botón "Categorías", asignar/limpiar la
        cuenta, regla categoría → por defecto, el hint del alta y la cuenta en el detalle);
        actualizar "Qué revisa el sistema al confirmar" (:1202, :1214) con la cuenta resuelta, el
        bloqueo si la cuenta de la categoría no es imputable, y que el control presupuestario mira
        esa cuenta (R1); aclarar que los egresos ya confirmados no cambian (D8) y que los
        comprobantes con IVA van como factura de compra (D1).
  - [ ] `src/modules/help/features/guide/components/_AccountingGuide.tsx:252, :336`: label
        "Cuenta de egresos por defecto" y cuándo se usa.
  - [ ] `docs/modules/commercial.md` (:631-638 "Confirmar Gasto", :740 tabla de asientos,
        :947-948 requisitos, tabla de archivos ~:991): resolución, `expense-accounts.ts`, nuevas
        piezas del modal, actions con `ActionResult`, `getExpenseCategoryAccounts`, nota para
        TSK-738 (`buildExpenseDebitLine`).
  - [ ] `docs/modules/accounting.md:259, :271`: label y semántica "por defecto"; presupuestos por
        cuenta resuelta.
  - [ ] `docs/architecture/data-model.md:451`: `ExpenseCategory.accountId` (FK `Account`,
        `SET NULL`) e inversa `Account.expenseCategories`.
  - [ ] `scripts/guia-presentacion/tsk-757.html` (nuevo, patrón `tsk-728.html`/`tsk-724c.html`):
        qué pidió la clienta, qué cambió (antes/después), paso a paso con ejemplo (Alquiler →
        5.2.03), configuración necesaria, qué **no** cambia (egresos confirmados, IVA), avisos
        (presupuestos sobre la cuenta por defecto dejan de ver esos egresos) y las preguntas
        abiertas a la clienta (D1 "Impuestos", D2 cuentas de activo).
  - [ ] PDF: `node scripts/guia-presentacion/generar-pdf.mjs scripts/guia-presentacion/tsk-757.html
        docs/presentaciones/TSK-757-cuenta-por-tipo-de-gasto.pdf`; abrirlo y revisar capturas.
- **Archivos:** `_CommercialGuide.tsx`, `_AccountingGuide.tsx`, `docs/modules/commercial.md`,
  `docs/modules/accounting.md`, `docs/architecture/data-model.md` (modificados);
  `scripts/guia-presentacion/tsk-757.html`, `docs/presentaciones/TSK-757-cuenta-por-tipo-de-gasto.pdf`
  (nuevos).
- **Criterio de completitud:** guía, docs y PDF reflejan la UI final; commit `docs(commercial):
  guías, docs y presentación de la cuenta por categoría de egreso (TSK-757, fase 8)`.

#### Fase 9: Verificación final

- **Objetivo:** cerrar con calidad y build de producción.
- **Tareas:**
  - [ ] `npm run check-types` → ≤ 219.
  - [ ] `npm run lint` → sin errores en archivos tocados (sin `console.*`, sin `:any`, sin
        `date-fns`).
  - [ ] `npm run test` → en verde (puros + integración de egresos y del resto).
  - [ ] `npm run build` → OK; `npm run start -- -p 3011` (con `NEXT_PUBLIC_APP_URL` en 3011) y
        disparar en el navegador "nombre duplicado" y "cuenta de categoría inactiva" para ver el
        **toast real** en producción (memoria `errores-negocio-server-actions`).
  - [ ] `wc -l` de los componentes nuevos/reescritos < 200; los preexistentes excedidos no
        crecieron más de lo previsto.
  - [ ] Completar la sección 5 con resultados.
- **Archivos:** este documento (sección 5).
- **Criterio de completitud:** los cuatro comandos pasan y la sección 5 está completa; si hubo
  ajustes, commit `fix(commercial): … (TSK-757, fase 9)`.

### 2.2 Orden de ejecución

1. **Fase 1** primero: todo lo demás usa `ExpenseCategory.accountId`.
2. **Fase 2** antes que 3 y 4: ambas consumen el helper y el validador.
3. **Fase 3** antes que la 4 (los tests de la 4 crean categorías con cuenta vía las actions) y
   que la 5 (la UI consume el contrato `ActionResult`).
4. **Fase 4** y **Fase 5** pueden ir en paralelo una vez cerrada la 3; la 6 necesita la 4
   (`getExpenseById` usa la resolución) y la 5 (lista de categorías con cuenta).
5. **Fase 7** cuando 4-6 están listas → **Fase 8** (usa las capturas) → **Fase 9**.
6. **TSK-738** arranca después de la Fase 4 mergeada: suma `costCenterId` a
   `buildExpenseDebitLine` y sus casos al mismo test de integración.

### 2.3 Estimación de complejidad

| Fase | Complejidad | Motivo |
|---|---|---|
| 1 | Baja | Una columna nullable con FK; migración aditiva. |
| 2 | Baja | Funciones puras chicas con tests. |
| 3 | Media | Cambio de contrato (`throw` → `ActionResult`) en tres actions + validación multiempresa. |
| 4 | **Media-Alta** | Pre-validación, presupuesto y asiento deben coincidir; mantener verdes los 7 casos de TSK-728 y sumar 6. Riesgo principal del ticket. |
| 5 | Media | Partir un modal de 311 líneas con edición inline (R8) y sumar el combo. |
| 6 | Baja-Media | Dos componentes chicos y un `select` con el asiento. |
| 7 | Media | Siembra/limpieza de datos y capturas desktop + mobile. |
| 8 | Media | Dos guías in-app, tres docs y presentación con PDF. |
| 9 | Baja | Comandos, build y prueba del toast en prod. |

Total estimado: **media**.

### 2.4 Seguimientos fuera de alcance

1. **D1 — "Impuestos"**: pregunta a la clienta (¿IVA en egresos? ¿gastos e impuestos bancarios?).
   Si pide IVA en el egreso, es ticket aparte (libro IVA Compras / AFIP).
2. **D2 — cuentas `ASSET`** en categorías (anticipos, impuestos a favor): ampliar `types` si la
   clienta lo pide.
3. **R7 — `cancelExpense`** (`EXP/actions.server.ts:624-668`) anula un egreso confirmado sin
   revertir el asiento: ticket aparte.
4. **R5 / TSK-738** — auxiliares (`requiresAuxiliary='COST_CENTER'`) no se validan en asientos
   automáticos; 738 suma `costCenterId` sobre `buildExpenseDebitLine`.
5. **Componentes > 200 líneas preexistentes** en egresos: `_CreateExpenseModal.tsx` (340),
   `_ExpenseDetailModal.tsx` (400), `_ExpensesTable.tsx` (301), `_ExpenseAttachments.tsx` (250),
   `list/columns.tsx` (207): refactor en ticket aparte.
6. **Listado de Egresos en móvil (preexistente)**: a 375 px el `DataTable` desborda (paginación
   `space-x-6` y barra derecha del toolbar sin wrap) → `scrollWidth` ≈ 443. Afecta a todos los
   listados con `DataTable`; ticket aparte (detectado en la prueba de la Fase 5).


## 3. Diseño

Rutas abreviadas (como en §2): `EXP/` = `src/modules/commercial/features/expenses/`;
`INT/` = `src/modules/accounting/features/integrations/commercial/`; `CSH/` =
`src/modules/commercial/shared/`. Los números de línea son los de `4a6f826` (rama
`feat/tsk-757-cuenta-por-tipo-de-gasto`, antes de implementar).

### 3.1 Arquitectura de la solución

Una sola regla — "¿a qué cuenta va el Debe del egreso?" — escrita una vez en un helper puro y
consumida por los cuatro lugares que hoy la resuelven por su cuenta o no la resuelven:

```
                         CSH/expense-accounts.ts  (puro: sin Prisma, sin React)
                         ├─ resolveExpenseDebitAccount()      categoría ?? por defecto ?? null
                         ├─ requiredExpenseSettingsFields()   qué campos de Ajustes exigir
                         ├─ build*Message()                   textos de error (TSK-728 + categoría)
                         ├─ buildExpenseDebitLine()           línea de Debe (punto de extensión TSK-738)
                         └─ buildExpenseDebitAccountView()    "cuenta contable" del detalle (D6)
                                    ▲                ▲                 ▲
          ┌─────────────────────────┘                │                 └──────────────┐
EXP/actions.server.ts                       INT/index.ts                     EXP/actions.server.ts
confirmExpense                              createJournalEntryForExpense      getExpenseById
 ├ assertExpenseEntryAccounts(…, category)   (defensa en profundidad +         (borrador: cuenta prevista;
 │   → { debitAccountId }                     línea de Debe)                    confirmado: la del asiento)
 ├ checkBudgetForExpense(debitAccountId, …)
 └ $transaction → createJournalEntryForExpense
```

- **Dato**: `ExpenseCategory.accountId` (FK opcional a `Account`, `SET NULL`). La cuenta **no**
  se guarda en `Expense` (D6): se resuelve al confirmar y queda registrada en el asiento.
- **Resolución** (D3): categoría con cuenta → esa (si no es imputable, **bloquea**); sin cuenta →
  "Cuenta de egresos por defecto" de Ajustes; ninguna → `BusinessError` que nombra la categoría y
  las dos salidas. `payablesAccountId` siempre obligatoria.
- **Dependencias entre módulos**: `INT/index.ts` ya importa de `@/modules/commercial/shared/*`
  (`cost-center`, `perceptions`, `line-accounts`, `payment-accounts`, `settings-accounts`,
  `INT/index.ts:50-67`). `expense-accounts.ts` vive en el mismo lugar y solo importa de
  `CSH/settings-accounts.ts`, `CSH/line-accounts.ts` (`formatAccountLabel`) y
  `@/shared/lib/accounts/settings-account-labels`. Ninguna dependencia nueva entre módulos.
- **ABM de categorías**: mismas actions (`EXP/actions.server.ts`), con `accountId` y contrato
  `ActionResult` en las tres mutaciones. UI: el modal actual se parte en 4 componentes + 1 hook,
  y se abre también desde la barra del listado (D4).
- **Errores**: `BusinessError` → `toActionResult` → `toast.error(result.error)` (memoria
  `errores-negocio-server-actions`; Next redacta los `throw` en producción).
- **Sin permisos ni módulos nuevos** (D5): `commercial.expenses` view/create/update/approve.

### 3.2 Modelos de datos

#### Diff de `prisma/schema.prisma`

```diff
@@ model Account (prisma/schema.prisma:360, después de depreciationsAsDepreciationExpense)
   depreciationsAsDepreciationExpense VehicleDepreciation[]  @relation("DepreciationDepreciationExpenseAccount")
+  // TSK-757: categorías de egreso que imputan a esta cuenta
+  expenseCategories                  ExpenseCategory[]      @relation("ExpenseCategoryAccount")
   settingsAsPercIvaCollected         AccountingSettings[]   @relation("PercIvaCollectedAccount")

@@ model ExpenseCategory (prisma/schema.prisma:3645-3659)
 model ExpenseCategory {
   id          String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
   name        String
   description String?
   companyId   String   @map("company_id") @db.Uuid
   isActive    Boolean  @default(true) @map("is_active")
+  // TSK-757: cuenta contable de la categoría; null = usa la cuenta de egresos por defecto de AccountingSettings
+  accountId   String?  @map("account_id") @db.Uuid
   createdAt   DateTime @default(now()) @map("created_at")
   updatedAt   DateTime @updatedAt @map("updated_at")

   company  Company   @relation(fields: [companyId], references: [id])
+  account  Account?  @relation("ExpenseCategoryAccount", fields: [accountId], references: [id], onDelete: SetNull)
   expenses Expense[]

   @@unique([companyId, name])
+  @@index([accountId])
   @@map("expense_categories")
 }
```

`Expense`, `AccountingSettings` y `JournalEntryLine` **no cambian** (`JournalEntryLine.costCenterId`
ya existe, `schema.prisma:453`, para TSK-738).

#### Migración esperada

`prisma/migrations/<timestamp>_tsk_757_expense_category_account/migration.sql` (generada con
`npm run db:migrate -- --name tsk_757_expense_category_account`; debe quedar **exactamente** así,
mismo formato que `20260919121736_tsk_724c_asset_accounts_by_type`):

```sql
-- AlterTable
ALTER TABLE "expense_categories" ADD COLUMN     "account_id" UUID;

-- CreateIndex
CREATE INDEX "expense_categories_account_id_idx" ON "expense_categories"("account_id");

-- AddForeignKey
ALTER TABLE "expense_categories" ADD CONSTRAINT "expense_categories_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
```

Aditiva, sin `UPDATE` ni backfill (D8): toda categoría existente queda en `NULL` = "por
defecto" → comportamiento idéntico al actual. En producción la aplica `docker-entrypoint.sh` al
deployar (`prisma migrate deploy`).

#### Tipos derivados (sin `any`)

```typescript
// EXP/actions.server.ts — select reutilizado por las tres lecturas
const CATEGORY_ACCOUNT_SELECT = { id: true, code: true, name: true } as const satisfies Prisma.AccountSelect;

// Consumidores (cliente): inferidos del retorno de las actions, como hoy
type CategoryItem = Awaited<ReturnType<typeof getAllExpenseCategories>>[number];
//   → { id; name; description; isActive; accountId: string | null;
//       account: { id; code; name } | null; _count: { expenses: number } }
type CategoryOption = Awaited<ReturnType<typeof getExpenseCategories>>[number];
//   → { id; name; description; isActive; account: { id; code; name } | null }
type ExpenseAccountOption = Awaited<ReturnType<typeof getExpenseCategoryAccounts>>[number];
//   → { id; code; name }  (compatible con AccountOption de AccountCombobox)
```

### 3.3 Funciones y métodos

#### 3.3.1 `CSH/expense-accounts.ts` (nuevo, puro) — ~110 líneas

```typescript
import {
  ACCOUNTING_SETTINGS_PATH,
  type AccountingSettingsAccountField,
} from '@/shared/lib/accounts/settings-account-labels';
import { buildMissingSettingsAccountsMessage } from './settings-accounts';

/** Campos de Ajustes que intervienen en el asiento del egreso. */
export type ExpenseEntryField = Extract<AccountingSettingsAccountField, 'expensesAccountId' | 'payablesAccountId'>;

/** De dónde sale la cuenta del Debe al confirmar. */
export type ExpenseDebitSource = 'category' | 'default';

/** Origen que muestra el detalle: la del asiento (confirmado) o la prevista (borrador). */
export type ExpenseDebitAccountOrigin = ExpenseDebitSource | 'entry';

/** Dónde se gestionan las categorías (el "dónde" de los mensajes). */
export const EXPENSE_CATEGORIES_PATH = 'Comercial → Egresos → Categorías';

export interface ResolveExpenseDebitAccountInput {
  /** `ExpenseCategory.accountId` del egreso. */
  categoryAccountId: string | null | undefined;
  /** `AccountingSettings.expensesAccountId` ("Cuenta de egresos por defecto"). */
  defaultAccountId: string | null | undefined;
}

export interface ResolvedExpenseDebitAccount {
  accountId: string;
  source: ExpenseDebitSource;
}

/**
 * Cuenta del Debe: la de la categoría; si no tiene, la por defecto; si tampoco, null.
 * `''` cuenta como vacío (mismo criterio `||` que `findMissingSettingsAccounts`).
 * No decide imputabilidad: si la de la categoría no es imputable, el llamador BLOQUEA
 * (criterio TSK-717: nunca caer en silencio a la por defecto).
 */
export function resolveExpenseDebitAccount(
  input: ResolveExpenseDebitAccountInput
): ResolvedExpenseDebitAccount | null;

/**
 * Campos de Ajustes que el asiento exige según la categoría (R3), en el orden de TSK-728:
 * con cuenta propia → ['payablesAccountId']; sin cuenta → ['expensesAccountId', 'payablesAccountId'].
 */
export function requiredExpenseSettingsFields(
  categoryAccountId: string | null | undefined
): ExpenseEntryField[];

/**
 * Mensaje de faltantes de TSK-728 ("No se puede confirmar el gasto GTO-00001: falta
 * configurar "Cuenta de egresos por defecto" en Contabilidad → Configuración.") y, si falta
 * `expensesAccountId`, la segunda salida: reemplaza el punto final por
 * `, o asignale una cuenta contable a la categoría "Alquiler" en Comercial → Egresos → Categorías.`
 * Con `missing` = ['payablesAccountId'] devuelve exactamente el mensaje de TSK-728.
 */
export function buildMissingExpenseAccountsMessage(
  documentLabel: string,
  missing: readonly AccountingSettingsAccountField[],
  categoryName: string
): string;

/**
 * La cuenta propia de la categoría existe pero no es imputable (o ya no existe):
 * "No se puede confirmar el gasto GTO-00001: la cuenta 5.2.03 - Alquileres de la categoría
 *  "Alquiler" no está activa o no es imputable. Corregila en Comercial → Egresos → Categorías."
 * `accountLabel` null → "…: la cuenta contable de la categoría "Alquiler" ya no existe en el plan
 *  de cuentas. Corregila en Comercial → Egresos → Categorías."
 */
export function buildCategoryAccountNotImputableMessage(
  documentLabel: string,
  categoryName: string,
  accountLabel: string | null
): string;

/** Texto del origen para la UI (D6). */
export function describeExpenseDebitSource(origin: ExpenseDebitAccountOrigin): string;
// 'entry' → 'del asiento' · 'category' → 'de la categoría' · 'default' → 'por defecto'

/**
 * Input de la línea de Debe. PUNTO DE EXTENSIÓN TSK-738: sumará `costCenterId?: string`
 * acá y en `ExpenseDebitLine`, y `buildExpenseDebitLine` lo copiará a la línea; los
 * llamadores (`createJournalEntryForExpense`) no cambian de forma.
 */
export interface ExpenseDebitLineInput {
  accountId: string;
  amount: number;
  fullNumber: string;
  description: string;
}

/** Estructuralmente compatible con `JournalEntryLineInput` (INT/index.ts:80-91). */
export interface ExpenseDebitLine {
  accountId: string;
  debit: number;
  credit: 0;
  description: string;
  costCenterId?: string;
}

/** Hoy: `{ accountId, debit: amount, credit: 0, description: `Gasto ${fullNumber} - ${description}` }`
 *  (idéntica a INT/index.ts:999-1004). */
export function buildExpenseDebitLine(input: ExpenseDebitLineInput): ExpenseDebitLine;

/** Lo que muestra "Cuenta contable" en el detalle del egreso (D6). */
export type ExpenseDebitAccountView =
  | { origin: ExpenseDebitAccountOrigin; label: string }
  | { origin: 'missing'; label: null };

export interface BuildExpenseDebitAccountViewInput {
  /** `code - name` de la línea de Debe del asiento (egreso confirmado), o null. */
  entryAccountLabel: string | null;
  /** `code - name` de la cuenta de la categoría, o null si no tiene. */
  categoryAccountLabel: string | null;
  /** `code - name` de la cuenta de egresos por defecto, o null si no está configurada. */
  defaultAccountLabel: string | null;
}

/** Asiento > categoría > por defecto > 'missing' (borrador sin ninguna cuenta). */
export function buildExpenseDebitAccountView(input: BuildExpenseDebitAccountViewInput): ExpenseDebitAccountView;
```

#### 3.3.2 Validador (`EXP/validators.ts:32-37`)

```diff
 export const expenseCategoryFormSchema = z.object({
   name: z.string().min(1, 'El nombre es requerido'),
   description: z.string().optional().nullable(),
+  /** TSK-757: cuenta contable propia. undefined = no tocar (update); null = usar la por defecto. */
+  accountId: z.string().uuid('Cuenta contable inválida').nullable().optional(),
 });

 export type ExpenseCategoryFormInput = z.infer<typeof expenseCategoryFormSchema>;
+// → { name: string; description?: string | null; accountId?: string | null }
```

Zod 4.3 (`package.json`): `z.string().uuid()` sigue vigente y valida RFC 9562; los UUID de test
tienen que ser v4 reales (p. ej. `'3f2504e0-4f89-41d3-9a0c-0305e82c3301'`).

#### 3.3.3 Actions de categorías (`EXP/actions.server.ts`)

| Action | Hoy | Después |
|---|---|---|
| `getExpenseCategories()` (:50) | `select { id, name, description, isActive }` | + `account: { select: CATEGORY_ACCOUNT_SELECT }`. Sigue lanzando (lectura). |
| `getAllExpenseCategories()` (:70) | + `_count.expenses` | + `accountId: true`, `account: { select: CATEGORY_ACCOUNT_SELECT }`. |
| `getExpenseCategoryAccounts(includeIds?)` | — | **nueva**, ver abajo. |
| `createExpenseCategory(data)` (:91) | `{ success, id }` / `throw` | `Promise<ActionResult<{ id: string }>>` |
| `updateExpenseCategory(id, data)` (:124) | `{ success }` / `throw` | `Promise<ActionResult>` |
| `toggleExpenseCategory(id)` (:160) | `{ success }` / `throw` | `Promise<ActionResult<{ isActive: boolean }>>` |

```typescript
/**
 * Cuentas ofrecidas en el combo de la categoría: imputables de tipo EXPENSE (D2) +
 * las ya guardadas aunque hoy no sean imputables (`includeIds`, patrón
 * `getVehicleTypeAssetAccounts`, company/features/vehicle-types/list/actions.server.ts:176-200).
 */
export async function getExpenseCategoryAccounts(
  includeIds?: string[]
): Promise<{ id: string; code: string; name: string }[]> {
  await checkPermission('commercial.expenses', 'view', { redirect: true });
  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');
  const imputable = buildImputableAccountsWhere({ companyId, types: ['EXPENSE'] });
  return prisma.account.findMany({
    where: includeIds && includeIds.length > 0
      ? { OR: [imputable, { companyId, id: { in: includeIds } }] }
      : imputable,
    select: CATEGORY_ACCOUNT_SELECT,
    orderBy: { code: 'asc' },
  });
}

/** La cuenta elegida es de la empresa activa. No exige imputabilidad (la rechaza la confirmación). */
async function assertCategoryAccountBelongsToCompany(accountId: string, companyId: string): Promise<void>;
// → BusinessError('La cuenta contable seleccionada no pertenece a la empresa')

/** Primer mensaje de Zod como BusinessError (las actions no confían en el cliente). */
function parseCategoryInput(data: ExpenseCategoryFormInput): ExpenseCategoryFormInput;
// expenseCategoryFormSchema.safeParse(data); !success → BusinessError(error.issues[0].message)

export async function createExpenseCategory(
  data: ExpenseCategoryFormInput
): Promise<ActionResult<{ id: string }>>;
// checkPermission('commercial.expenses','create') · userId/companyId → throw (no son de negocio)
// try { parse; if (accountId) assertCategoryAccountBelongsToCompany;
//       create { companyId, name, description: description || null, accountId: accountId ?? null };
//       logger.info; revalidatePath; return { success: true, id } }
// catch { P2002 → { success:false, error:'Ya existe una categoría con ese nombre' };
//         BusinessError → logger.warn; return toActionResult(error, 'Error al crear categoría de gasto') }

export async function updateExpenseCategory(
  id: string,
  data: ExpenseCategoryFormInput
): Promise<ActionResult>;
// checkPermission('commercial.expenses','update')
// accountId: undefined → no se incluye en `data` (no tocar); null → null; string → assert + id
// updateMany({ where: { id, companyId }, data: { name, description, ...(accountId !== undefined && { accountId }) } })
// count === 0 → BusinessError('Categoría no encontrada'); P2002 → mensaje de duplicado.

export async function toggleExpenseCategory(id: string): Promise<ActionResult<{ isActive: boolean }>>;
// 'Categoría no encontrada' → BusinessError; devuelve el estado nuevo.
```

Mapeo de P2002: helper privado
`function toCategoryActionFailure(error: unknown, contexto: string): ActionFailure` que traduce
`Prisma.PrismaClientKnownRequestError` con `code === 'P2002'` a `BusinessError('Ya existe una
categoría con ese nombre')`, loguea `warn` si es `BusinessError` y delega en `toActionResult`.
(`ActionFailure` se importa de `@/shared/lib/action-result`.)

#### 3.3.4 Confirmación (`EXP/actions.server.ts:486-619`) — diff conceptual

```diff
-/** Cuentas de Ajustes que usa el asiento del gasto: Debe Gastos Operativos / Haber Cuentas por Pagar. */
-const EXPENSE_ENTRY_FIELDS = ['expensesAccountId', 'payablesAccountId'] as const satisfies …;
-type ExpenseEntryField = (typeof EXPENSE_ENTRY_FIELDS)[number];
+interface ExpenseCategoryForEntry { name: string; accountId: string | null }

-async function assertExpenseEntryAccounts(companyId, documentLabel, settings): Promise<void>
+/**
+ * Pre-validación del asiento (TSK-728 + TSK-757). Devuelve la cuenta del Debe que van a usar
+ * el presupuesto y el asiento, para que las tres piezas coincidan.
+ */
+async function assertExpenseEntryAccounts(
+  companyId: string,
+  documentLabel: string,
+  settings: { expensesAccountId: string | null; payablesAccountId: string | null },
+  category: ExpenseCategoryForEntry
+): Promise<{ debitAccountId: string }> {
+  // (1) faltantes condicionales
+  const missing = findMissingSettingsAccounts(settings, requiredExpenseSettingsFields(category.accountId));
+  if (missing.length > 0) throw new BusinessError(buildMissingExpenseAccountsMessage(documentLabel, missing, category.name));
+  // (2) resolución
+  const debit = resolveExpenseDebitAccount({ categoryAccountId: category.accountId, defaultAccountId: settings.expensesAccountId });
+  //   (no puede ser null tras (1); igual se chequea y lanza el mismo mensaje)
+  // (3) imputabilidad: Debe resuelto + payables, UNA consulta imputable + una de labels (como hoy :510-516)
+  //   toCheck: [{ kind: debit.source === 'category' ? 'category' : 'expensesAccountId', accountId: debit.accountId },
+  //             { kind: 'payablesAccountId', accountId: settings.payablesAccountId }]
+  //   falla 'category' → buildCategoryAccountNotImputableMessage(documentLabel, category.name, info ? formatAccountLabel(info) : null)
+  //   falla un campo de Ajustes → mensaje actual (:521-527) con settingsAccountLabel(field)
+  return { debitAccountId: debit.accountId };
+}
```

`findMissingSettingsAccounts` devuelve `AccountingSettingsAccountField[]`; por eso
`buildMissingExpenseAccountsMessage` acepta `readonly AccountingSettingsAccountField[]` y no hace
falta ningún cast.

```diff
 export async function confirmExpense(id: string)
   : Promise<ActionResult<{ budgetWarning?: { message: string; executedPercent: number } }>> {   // firma SIN cambios
   …
   const expense = await prisma.expense.findFirst({
     where: { id, companyId, status: 'DRAFT' },
-    select: { id: true, fullNumber: true, description: true, amount: true, categoryId: true, date: true },
+    select: { id: true, fullNumber: true, description: true, amount: true, date: true,
+              category: { select: { name: true, accountId: true } } },
   });
   …
-  await assertExpenseEntryAccounts(companyId, `el gasto ${expense.fullNumber}`, settings);
+  const { debitAccountId } = await assertExpenseEntryAccounts(
+    companyId, `el gasto ${expense.fullNumber}`, settings, expense.category);

   // Verificación presupuestaria (no bloqueante) — R1: contra la cuenta RESUELTA
-  if (settings.expensesAccountId) {
-    const check = await checkBudgetForExpense(settings.expensesAccountId, …);
+  const check = await checkBudgetForExpense(debitAccountId, Number(expense.amount), companyId, expense.date);
   …                                         // try/catch no bloqueante y $transaction sin cambios
```

`categoryId` se quita del `select` (no se usaba). El `$transaction` (:591-605) y el `catch`
(:611-618) no cambian.

#### 3.3.5 Asiento (`INT/index.ts:962-1033`) — diff conceptual

```diff
  * 5. Gasto (confirmado):                                                     (cabecera :37-40)
- *    - Debe: Gastos Operativos
+ *    - Debe: cuenta de la categoría del egreso, o "Cuenta de egresos por defecto" (TSK-757)
  *    - Haber: Cuentas por Pagar

 export async function createJournalEntryForExpense(expenseId, companyId, tx): Promise<string> {   // firma SIN cambios
   const expense = await tx.expense.findUnique({
     where: { id: expenseId },
     select: { supplierId: true, fullNumber: true, description: true, date: true, amount: true,
               supplier: { select: { businessName: true } },
+              category: { select: { name: true, accountId: true } },
     },
   });
   …
   const settings = await getAccountingSettings(companyId, tx);
-  const missingSettings = findMissingSettingsAccounts(settings, ['expensesAccountId', 'payablesAccountId']);
-  if (missingSettings.length > 0 || !settings.expensesAccountId || !settings.payablesAccountId) {
-    throw new BusinessError(buildMissingSettingsAccountsMessage(`el gasto ${expense.fullNumber}`, missingSettings));
+  const documentLabel = `el gasto ${expense.fullNumber}`;
+  const missingSettings = findMissingSettingsAccounts(settings, requiredExpenseSettingsFields(expense.category.accountId));
+  const debit = resolveExpenseDebitAccount({ categoryAccountId: expense.category.accountId,
+                                             defaultAccountId: settings.expensesAccountId });
+  if (missingSettings.length > 0 || !debit || !settings.payablesAccountId) {
+    throw new BusinessError(buildMissingExpenseAccountsMessage(documentLabel, missingSettings, expense.category.name));
   }
   const lines: JournalEntryLineInput[] = [
-    { accountId: settings.expensesAccountId, debit: amount, credit: 0, description: `Gasto ${…} - ${…}` },
+    buildExpenseDebitLine({ accountId: debit.accountId, amount, fullNumber: expense.fullNumber,
+                            description: expense.description }),
     { accountId: settings.payablesAccountId, … supplierId … },                 // Haber SIN cambios
   ];
```

Imputabilidad: no se re-chequea acá (hoy tampoco para Ajustes); la defensa es solo de
"faltantes". `buildMissingSettingsAccountsMessage` deja de importarse en `INT/index.ts` si no
queda otro uso (verificar con grep; hoy lo usan también recibos/OP → probablemente se queda).

JSDoc de `checkBudgetForExpense` (`INT/index.ts:1042`):
`@param accountId - Cuenta del Debe del egreso ya resuelta (la de su categoría o la de egresos por defecto, TSK-757)`.

#### 3.3.6 Detalle (`EXP/actions.server.ts` `getExpenseById`, :313-389)

```diff
       category: {
-        select: { id: true, name: true },
+        select: { id: true, name: true, account: { select: { code: true, name: true } } },
       },
+      journalEntry: {
+        select: {
+          lines: { where: { debit: { gt: 0 } }, select: { account: { select: { code: true, name: true } } }, take: 1 },
+        },
+      },
```

Después del `findFirst`, solo si `status === 'DRAFT'` y la categoría no tiene cuenta:
`prisma.accountingSettings.findUnique({ where: { companyId }, select: { expensesAccount: { select: { code: true, name: true } } } })`.
Retorno: se agrega

```typescript
debitAccount: ExpenseDebitAccountView | null
// null = no aplica (egreso anulado sin asiento): el componente no se renderiza.
// Confirmado / pagado / parcial → origin 'entry' (label del asiento);
// Borrador → buildExpenseDebitAccountView({ entryAccountLabel: null, categoryAccountLabel, defaultAccountLabel }).
```

y se **quita** `journalEntry` del objeto devuelto (`const { journalEntry, ...rest } = expense`)
para no exponer relaciones de más. Sin `Decimal` nuevos: `debit` no se selecciona.
`_CreateExpenseModal.tsx:86` sigue usando `data.category.id` (compatible).

### 3.4 Interfaces de usuario

#### 3.4.1 Hook `EXP/hooks/useExpenseCategoryMutations.ts` (nuevo, ~75 líneas)

```typescript
'use client';
export interface ExpenseCategoryMutations {
  /** true si se creó (el form se resetea solo en ese caso). */
  createCategory: (data: ExpenseCategoryFormInput) => Promise<boolean>;
  updateCategory: (id: string, data: ExpenseCategoryFormInput) => Promise<boolean>;
  toggleCategory: (category: { id: string; isActive: boolean }) => Promise<boolean>;
  isCreating: boolean;
  /** Categoría con un update/toggle en curso (deshabilita sus botones). */
  pendingId: string | null;
}
export function useExpenseCategoryMutations(): ExpenseCategoryMutations;
```

Tres `useMutation` sobre las actions `ActionResult`; en `onSuccess(result)`:
`if (!result.success) { toast.error(result.error); return; }` → `toast.success(…)` ('Categoría
creada', 'Categoría actualizada', 'Categoría desactivada'/'activada') e invalidación de
`['allExpenseCategories']`, `['expenseCategories']` y `['expenseCategoryAccounts']`. `onError`
(fallo técnico/red) → `logger.error` + `toast.error(UNEXPECTED_ERROR_MESSAGE)`.

#### 3.4.2 Componentes nuevos / reescritos

| Archivo | Tipo | Props | Líneas est. |
|---|---|---|---|
| `EXP/components/_CategoryManagementModal.tsx` (reescrito) | Dialog contenedor | `{ trigger?: ReactNode; onClose?: () => void }` (**sin cambios**: `_CreateExpenseModal.tsx:223-231` sigue igual) | ~95 |
| `EXP/components/_CategoryCreateForm.tsx` | form de alta | `{ onCreate: (data: ExpenseCategoryFormInput) => Promise<boolean>; isCreating: boolean }` | ~110 |
| `EXP/components/_CategoryRow.tsx` | fila vista/edición | `{ category: CategoryItem; canUpdate: boolean; isPending: boolean; onSave: (id: string, data: ExpenseCategoryFormInput) => Promise<boolean>; onToggle: (c: { id: string; isActive: boolean }) => Promise<boolean> }` | ~165 |
| `EXP/components/_CategoryAccountField.tsx` | combo de cuenta | `{ value: string \| null \| undefined; onChange: (accountId: string \| null) => void; savedAccountId?: string \| null; disabled?: boolean; id?: string }` | ~45 |
| `EXP/list/components/_ExpensesToolbarActions.tsx` | barra del listado | `{ canCreate: boolean; onCreated: () => void }` | ~40 |
| `EXP/list/components/_ExpenseAccountHint.tsx` | hint del alta | `{ category: { account: { code: string; name: string } \| null } \| undefined }` | ~30 |
| `EXP/list/components/_ExpenseDebitAccountInfo.tsx` | dato del detalle | `{ debitAccount: ExpenseDebitAccountView \| null }` | ~40 |

Detalle de cada uno:

- **`_CategoryManagementModal`**: `Dialog` + `useQuery({ queryKey: ['allExpenseCategories'],
  queryFn: getAllExpenseCategories, enabled: open })` + `useExpenseCategoryMutations()` +
  `usePermissions()`. Título "Categorías de egreso"; `DialogDescription` "Cada categoría puede
  tener su cuenta contable; si no tiene, el egreso usa la cuenta de egresos por defecto
  (Contabilidad → Configuración)." `DialogContent className="sm:max-w-2xl max-h-[85vh]
  overflow-y-auto"`. Compone: `_CategoryCreateForm` (solo con `hasPermission('commercial.expenses',
  'create')`), `Separator`, lista (skeleton / vacío / `_CategoryRow` por categoría). Estado de
  edición: **solo** `editingId: string | null` en el modal (una fila en edición a la vez); el
  borrador de los inputs vive en la fila.
- **`_CategoryCreateForm`**: RHF + `zodResolver(expenseCategoryFormSchema)`, `defaultValues {
  name: '', description: '', accountId: null }`; campos Nombre *, Descripción (opcional),
  "Cuenta contable (opcional)" con `_CategoryAccountField` + `FormDescription` "Si la dejás vacía,
  se usa la cuenta de egresos por defecto." Submit: `if (await onCreate(data)) form.reset()`.
- **`_CategoryRow`**: vista — nombre + badge "Inactiva", descripción, línea de cuenta
  (`5.2.03 - Alquileres` o "Por defecto" en `text-muted-foreground`, `data-testid="category-account"`),
  conteo de egresos; botones Editar/Activar solo con `canUpdate`. Edición — `useState<{ name;
  description; accountId }>` inicializado desde la categoría, dos `Input` + `_CategoryAccountField`
  (`savedAccountId={category.accountId}`), Guardar → `onSave(category.id, { name, description:
  description || null, accountId })` (siempre manda `accountId`, null = por defecto); Cancelar.
  Responsive: contenedor `flex flex-wrap gap-2 min-w-0`; la cuenta en `basis-full sm:basis-auto
  truncate`.
- **`_CategoryAccountField`**: `includeIds = savedAccountId ? [savedAccountId] : []`;
  `useQuery({ queryKey: ['expenseCategoryAccounts', includeIds], queryFn: () =>
  getExpenseCategoryAccounts(includeIds.length ? includeIds : undefined) })`;
  `<AccountCombobox accounts={data ?? []} value={value} onChange={onChange}
  clearLabel="Sin asignar (usar la cuenta de egresos por defecto)" placeholder="Por defecto"
  disabled={disabled || isLoading} />`.
- **`_ExpensesToolbarActions`**: `<div className="flex flex-wrap gap-2">` con
  `<_CategoryManagementModal trigger={<Button variant="outline" size="sm"><Tags …/>Categorías</Button>} onClose={onCreated} />`
  (visible con `view`: el listado ya está bajo `PermissionGuard` view, `ExpensesList.tsx:31`) y
  `{canCreate && <_CreateExpenseModal onSuccess={onCreated} />}`. `onClose` → `router.refresh()`
  para que los filtros facetados del listado vean categorías nuevas.
- **`_ExpenseAccountHint`**: nada si `category` es `undefined`; si no, `<p className="text-xs
  text-muted-foreground" data-testid="expense-account-hint">` "Se imputa a: 5.2.03 - Alquileres"
  o "Se imputa a la cuenta de egresos por defecto".
- **`_ExpenseDebitAccountInfo`**: nada si `null`; `<div>` con `<p className="text-sm
  text-muted-foreground">Cuenta contable</p>` y `<p className="font-medium">{label}</p>` +
  `<span className="text-xs text-muted-foreground">({describeExpenseDebitSource(origin)})</span>`;
  `origin === 'missing'` → texto ámbar "Sin cuenta: configurala antes de confirmar".

#### 3.4.3 Archivos existentes que se tocan (crecimiento acotado)

| Archivo | Cambio | Δ líneas |
|---|---|---|
| `EXP/list/components/_ExpensesTable.tsx:211` | `toolbarActions={<_ExpensesToolbarActions canCreate={canCreate} onCreated={() => router.refresh()} />}`; import `_ExpensesToolbarActions` reemplaza el de `_CreateExpenseModal` | 0 |
| `EXP/list/components/_CreateExpenseModal.tsx:~247` (antes de `<FormMessage />` del campo Categoría) | `<_ExpenseAccountHint category={categories.find((c) => c.id === field.value)} />` + import | +2 |
| `EXP/list/components/_ExpenseDetailModal.tsx:183-185` (después del bloque "Categoría", dentro del `grid-cols-2`) | `<_ExpenseDebitAccountInfo debitAccount={expense.debitAccount} />` + import | +2 |
| `src/shared/lib/accounts/settings-account-labels.ts:56` | `expensesAccountId: 'Cuenta de egresos por defecto'` | 0 |
| `src/modules/accounting/features/settings/components/_CommercialIntegrationForm.tsx:78` | `help: 'Se usa al confirmar egresos cuya categoría no tiene cuenta contable propia (Comercial → Egresos → Categorías). Si alguna categoría no tiene cuenta, tiene que estar asignada.'` | 0 |

Textos visibles (en español rioplatense, como el resto): botón "Categorías"; título "Categorías de
egreso"; columna "Por defecto"; `clearLabel` "Sin asignar (usar la cuenta de egresos por
defecto)"; hint "Se imputa a: …"; detalle "Cuenta contable … (de la categoría | por defecto | del
asiento)".

### 3.5 Rutas y navegación

No aplica: sin rutas nuevas ni cambios de sidebar. El modal de categorías se abre desde el botón
"Categorías" de la barra del listado `/dashboard/commercial/expenses` y, como hoy, desde
"Gestionar" en el alta/edición de un egreso.

### 3.6 APIs / Endpoints

No aplica: solo Server Actions (§3.3.3–3.3.6). Sin API routes.

### 3.7 Consideraciones técnicas

#### Árbol de archivos

```
prisma/
├── schema.prisma                                                     (M) ExpenseCategory.accountId + inversa en Account
└── migrations/<ts>_tsk_757_expense_category_account/migration.sql    (N)
src/modules/commercial/shared/
├── expense-accounts.ts                                               (N) helper puro
├── expense-accounts.test.ts                                          (N)
└── settings-accounts.test.ts                                         (M) label renombrado (:101)
src/modules/commercial/features/expenses/
├── actions.server.ts                                                 (M) categorías + confirmExpense + getExpenseById
├── validators.ts                                                     (M) accountId
├── validators.test.ts                                                (N)
├── expense-journal-entry.integration.test.ts                         (M) casos 2-4 al label nuevo + 8-13 + describe categorías
├── hooks/useExpenseCategoryMutations.ts                              (N)
├── components/
│   ├── _CategoryManagementModal.tsx                                  (R) 311 → ~95
│   ├── _CategoryCreateForm.tsx                                       (N)
│   ├── _CategoryRow.tsx                                              (N)
│   └── _CategoryAccountField.tsx                                     (N)
└── list/components/
    ├── _ExpensesToolbarActions.tsx                                   (N)
    ├── _ExpenseAccountHint.tsx                                       (N)
    ├── _ExpenseDebitAccountInfo.tsx                                  (N)
    ├── _ExpensesTable.tsx                                            (M) ±0
    ├── _CreateExpenseModal.tsx                                       (M) +2
    └── _ExpenseDetailModal.tsx                                       (M) +2
src/modules/accounting/features/
├── integrations/commercial/index.ts                                  (M) createJournalEntryForExpense + cabecera + JSDoc
└── settings/components/_CommercialIntegrationForm.tsx                (M) ayuda
src/shared/lib/accounts/settings-account-labels.ts                    (M) label
src/modules/help/features/guide/components/_CommercialGuide.tsx       (M) Fase 8
src/modules/help/features/guide/components/_AccountingGuide.tsx       (M) Fase 8 (:252, :336)
docs/modules/commercial.md, docs/modules/accounting.md, docs/architecture/data-model.md   (M) Fase 8
scripts/guia-presentacion/capturas-tsk757.mjs, tsk-757.html, assets/tsk757-*.png         (N) Fases 7-8
docs/presentaciones/TSK-757-cuenta-por-tipo-de-gasto.pdf                                 (N) Fase 8
```

#### Casos de test

**Puros — `CSH/expense-accounts.test.ts`** (Fase 2, TDD):

| # | Función | Caso | Esperado |
|---|---|---|---|
| P1 | `resolveExpenseDebitAccount` | categoría `'c'`, default `null` | `{ accountId: 'c', source: 'category' }` |
| P2 | idem | categoría `'c'`, default `'d'` | categoría gana |
| P3 | idem | categoría `null`, default `'d'` | `{ 'd', 'default' }` |
| P4 | idem | ambas `null` / `undefined` | `null` |
| P5 | idem | categoría `''`, default `'d'` | `'default'` (`''` = vacío) |
| P6 | `requiredExpenseSettingsFields` | con cuenta / sin cuenta / `''` | `['payablesAccountId']` / `['expensesAccountId','payablesAccountId']` / la de 2 |
| P7 | `buildMissingExpenseAccountsMessage` | faltan las dos, categoría "Alquiler" | contiene `falta configurar "Cuenta de egresos por defecto" y "Cuentas por Pagar" en Contabilidad → Configuración` y `o asignale una cuenta contable a la categoría "Alquiler" en Comercial → Egresos → Categorías.` |
| P8 | idem | falta solo `payablesAccountId` | **igual** a `buildMissingSettingsAccountsMessage` (sin mención de la categoría) |
| P9 | `buildCategoryAccountNotImputableMessage` | con label | `la cuenta 5.2.03 - Alquileres de la categoría "Alquiler" no está activa o no es imputable. Corregila en Comercial → Egresos → Categorías.` |
| P10 | idem | `accountLabel` null | `ya no existe en el plan de cuentas` |
| P11 | `buildExpenseDebitLine` | `{ accountId, amount: 1000, fullNumber: 'GTO-00001', description: 'Alquiler' }` | `{ accountId, debit: 1000, credit: 0, description: 'Gasto GTO-00001 - Alquiler' }`, sin clave `costCenterId` |
| P12 | `buildExpenseDebitAccountView` | entry + categoría + default | `{ origin: 'entry', … }` |
| P13 | idem | sin entry, categoría / sin categoría con default / nada | `'category'` / `'default'` / `{ origin: 'missing', label: null }` |
| P14 | `describeExpenseDebitSource` | los tres orígenes | 'del asiento' / 'de la categoría' / 'por defecto' |

**Puros — `EXP/validators.test.ts`**: V1 nombre vacío → falla con "El nombre es requerido";
V2 `accountId` ausente → OK; V3 `null` → OK; V4 UUID v4 válido → OK; V5 `'abc'` → falla
"Cuenta contable inválida". **`CSH/settings-accounts.test.ts:101`**: label nuevo.

**Integración — `EXP/expense-journal-entry.integration.test.ts`** (DB local; mismo andamiaje
:52-187; se agregan cuentas `T757-ALQ` (EXPENSE, imputable), `T757-ALQ-VIEJA` (EXPENSE) y
`T757-ACTIVO` (ASSET), y una segunda empresa `PREFIX + 'Otra'` con una cuenta EXPENSE; el
`afterAll` limpia ambas empresas):

| # | Caso | Verifica |
|---|---|---|
| 1, 5, 6, 7 | TSK-728 sin cambios | siguen verdes tal cual |
| 2, 3, 4 | TSK-728 con label nuevo | `"Cuenta de egresos por defecto"` en lugar de `"Cuenta de Gastos Operativos"` (:206-256 y cabecera :5); el 2 además contiene la salida por categoría |
| C1 | crear categoría con cuenta propia | `{ success: true, id }`; `accountId` guardado |
| C2 | crear con cuenta de **otra empresa** | `{ success: false, error: 'La cuenta contable seleccionada no pertenece a la empresa' }`; no se crea |
| C3 | nombre duplicado | `{ success: false, error: 'Ya existe una categoría con ese nombre' }` |
| C4 | `update` con `accountId: null` / sin `accountId` | vuelve a `null` / no lo toca |
| C5 | `toggle` | `{ success: true, isActive: false }`; id inexistente → `'Categoría no encontrada'` |
| C6 | `getExpenseCategoryAccounts([idInactiva])` | incluye la inactiva guardada; excluye `T757-ACTIVO` (ASSET) y cuentas de la otra empresa |
| 8 | categoría con cuenta y **sin** default en Ajustes | confirma; Debe `T757-ALQ` 1000, Haber Pagar 1000 con proveedor |
| 9 | categoría con cuenta y con default | Debe en `T757-ALQ`, no en `gastosId` |
| 10 | cuenta de la categoría inactiva | `success: false`; mensaje con `T757-ALQ-VIEJA - …`, `de la categoría "…"` y `Comercial → Egresos → Categorías`; **no** cae a la por defecto; `DRAFT`, `journalEntryId` null |
| 11 | categoría sin cuenta y sin default | mensaje con `"Cuenta de egresos por defecto"` y `asignale una cuenta contable a la categoría "…"` |
| 12 | presupuesto chico sobre `T757-ALQ` | egreso de esa categoría → `budgetWarning`; egreso de categoría **sin** cuenta con el presupuesto del caso 5 sobre `gastosId` sigue avisando, y uno de la categoría con cuenta no consume el de `gastosId` (sin aviso si `T757-ALQ` no tiene presupuesto en ese momento — ordenar: primero sin presupuesto, después con) |
| 13 | desvincular la cuenta (`prisma.account.delete` de una cuenta sin movimientos creada para el caso; si choca con FK, `UPDATE` a null y anotarlo) | `accountId` queda `null` por `SET NULL`; el egreso confirma contra `gastosId` |
| D1 | `getExpenseById` | borrador con categoría con cuenta → `{ origin: 'category' }`; sin cuenta → `'default'`; confirmado → `'entry'` con el label del Debe |

Cada caso que cambia Ajustes o cuentas restaura en `finally` (patrón de los casos 2-4). Las
categorías del describe nuevo usan el prefijo `PREFIX` para la limpieza.

#### Script `scripts/guia-presentacion/capturas-tsk757.mjs` (Fase 7)

Molde `capturas-tsk728.mjs` (playwright, `psql` vía `docker exec contable-pms-db`, mismas
constantes `COMPANY_ID`, `USER_ID`, `SUPPLIER_ID`, `EMAIL`/`PASSWORD`, `BASE` por defecto
`http://localhost:3010`, `chromium.launch().catch(() => chromium.launch({ channel: 'chrome' }))`).

- **Marca y siembra** (`seed()`, idempotente: primero `cleanup()`):
  - `MARK = 'TSK757-demo'` en `expenses.notes` de los egresos sembrados.
  - Categorías con nombres realistas en la constante `DEMO_CATEGORIES = ['Alquiler de oficina',
    'Tasas municipales', 'Viáticos de obra']` y `description = 'Ejemplo TSK-757'`. Si ya existe
    una con ese nombre **sin** esa descripción (dato real), el script aborta sin tocarla.
  - Cuentas: `Alquiler de oficina` → una cuenta EXPENSE imputable existente distinta de
    `expenses_account_id` (elegida por SQL: `type='EXPENSE' and is_leaf and is_active and
    name ilike '%alquiler%'`, si no la primera por código); `Tasas municipales` → otra EXPENSE
    (`ilike '%impuesto%' or '%tasa%'`); `Viáticos de obra` → `NULL` (por defecto).
  - Cuenta temporal raíz `code='TSK757-DEMO'`, `name='Gastos varios (dada de baja)'`, EXPENSE,
    `is_active=false`, `parent_id NULL` (no altera `is_leaf` de nadie) para el escenario de
    error; se le asigna temporalmente a `Tasas municipales`.
  - Egresos en borrador (números `max+1…`): "Alquiler octubre" (Alquiler de oficina),
    "ABL octubre" (Tasas municipales), "Viáticos obra Neuquén" (Viáticos de obra).
- **Escenarios / capturas** (1440×900, `scripts/guia-presentacion/assets/tsk757-NN-*.png`):
  01 listado con botón "Categorías"; 02 modal con las tres categorías (dos con cuenta, una "Por
  defecto"); 03 edición de "Viáticos de obra" con el combo abierto y búsqueda "viát";
  04 alta de egreso con categoría "Alquiler de oficina" y el hint "Se imputa a: …"; 05 detalle
  del borrador "Alquiler octubre" ("de la categoría"); 06 confirmación OK (toast) y detalle del
  confirmado ("del asiento"); 07 asiento en Contabilidad → Asientos (y SQL `entryLines('Gasto
  GTO-%Alquiler octubre%')` impreso); 08 confirmar "ABL octubre" con la cuenta temporal inactiva →
  toast rojo con categoría y cuenta, sigue en Borrador; 09 Contabilidad → Configuración con
  "Cuenta de egresos por defecto" y su ayuda.
- **Mobile** (375×812, `isMobile: true`): 10 modal de categorías; assert
  `document.documentElement.scrollWidth <= 375` y el `[role="dialog"]` dentro del viewport;
  falla el script si no.
- **Limpieza** (`cleanup()`, en `finally` y también al inicio): borra asientos (`journal_entries`
  de los egresos con `notes=MARK`, sus líneas caen por cascade), los egresos `MARK`, las
  categorías `DEMO_CATEGORIES` con descripción `'Ejemplo TSK-757'` y la cuenta `TSK757-DEMO`.
  Imprime conteos finales en 0. `--restore` corre solo la limpieza.

#### Invariantes (no se deben romper)

| Invariante | Dónde vive hoy | Cómo se preserva |
|---|---|---|
| **TSK-728 — sin confirmación silenciosa**: pre-validación fuera de la transacción; si el asiento falla, se revierte el confirm | `EXP/actions.server.ts:556-566` (pre-validación), `:591-605` (`$transaction` con `createJournalEntryForExpense`) | Misma estructura; solo cambia qué cuentas se exigen. Casos 1-7 verdes. |
| **TSK-728 — errores legibles** (`ActionResult`, `BusinessError`) | `EXP/actions.server.ts:538-540` (firma), `:611-618` (`toActionResult`); `INT/index.ts:983-993` (defensa); período cerrado `INT/index.ts:217-219`; cliente `_ExpensesTable.tsx:54-77`, `_ExpenseDetailModal.tsx:97-110` | Firma de `confirmExpense` sin cambios; mensajes nuevos también `BusinessError`; mutaciones de categorías pasan a `ActionResult` (mismo contrato). Verificar toast en `npm run build && npm run start -- -p 3011`. |
| **TSK-728 — label exacto del campo en el mensaje** | `settings-account-labels.ts:54-63`, `settings-accounts.ts` (`buildMissingSettingsAccountsMessage`) | El label renombrado sale de la misma constante; Ajustes y mensajes siguen leyendo el mismo texto. |
| **TSK-721 — semántica "por defecto"** (label "… por defecto" + ayuda que dice cuándo se usa) | `settings-account-labels.ts:54-63`; `_CommercialIntegrationForm.tsx:62-79` | `expensesAccountId` adopta la misma forma ("Cuenta de egresos por defecto" + ayuda condicional). |
| **TSK-717 — sin fallback silencioso** | `treasury/features/fund-movements/list/actions.server.ts:231-275` | Cuenta de categoría no imputable → bloquea (caso 10). |
| **Presupuesto no bloqueante** | `EXP/actions.server.ts:568-589` (try/catch + `logger.warn`); `INT/index.ts:1048+` | Igual, con `debitAccountId` (casos 5 y 12). Aviso de R1 en guía y PDF. |
| **Egresos confirmados intactos** (D8) | sin backfill; `updateExpense` solo `DRAFT` `EXP/actions.server.ts:455-460`; `cancelExpense` `:624-668` sin cambios | Migración sin `UPDATE`; la cuenta se resuelve solo al confirmar; el detalle de un confirmado lee la cuenta del asiento, no la de la categoría actual. |
| **Retrocompatibilidad** | categorías existentes con `account_id NULL` | Mismo asiento que hoy (Debe `expensesAccountId`). |
| **Multiempresa** | `getActiveCompanyId()` en todas las actions | `assertCategoryAccountBelongsToCompany`; `includeIds` filtrado por `companyId` (C2, C6). |
| **Dashboard por categoría** | `src/modules/dashboard/actions.server.ts:390-409` | No se toca (agrupa por categoría, no por cuenta). |

#### Otras consideraciones

- **Orden de validación en el confirm**: faltantes → resolución → imputabilidad (una consulta
  imputable + una de labels, como hoy). Si la categoría tiene cuenta, `expensesAccountId` vacío
  **no** bloquea (R3).
- **Borrador con cuenta de categoría no imputable**: el detalle la muestra igual ("de la
  categoría"); quien bloquea es la confirmación (caso 10). No se agrega aviso previo (fuera de
  alcance, evita otra consulta en el detalle).
- **Carrera** entre pre-validación y transacción (alguien cambia la cuenta de la categoría en el
  medio): el asiento vuelve a resolver dentro de la transacción; en el peor caso usa la cuenta
  nueva o falla la defensa con `BusinessError` y se revierte. Aceptable (mismo nivel que TSK-728).
- **Auxiliares (R5)**: `requiresAuxiliary` de la cuenta de la categoría no se valida (igual que
  hoy). TSK-738 sumará `costCenterId` en `ExpenseDebitLineInput`/`ExpenseDebitLine`.
- **Componentes**: todos los nuevos < 200 líneas; los preexistentes excedidos crecen ≤ 2 líneas
  (2.4-5). Client components con prefijo `_`; el hook sin prefijo (no es componente).
- **Consultas**: `select` explícito en todas; `getExpenseById` agrega una sola consulta extra y
  solo para borradores sin cuenta de categoría.
- **Sin Decimals nuevos** hacia el cliente (`debit` no se selecciona en el detalle).
- **Línea base**: `check-types` ≤ 219 errores; `eslint` sin errores en archivos tocados.

## 4. Implementación

### Fase 1: Esquema y migración
- **Estado:** Completada
- **Archivos modificados:**
  - `prisma/schema.prisma` — `ExpenseCategory.accountId` (`account_id`, uuid nullable), relación
    `account` (`ExpenseCategoryAccount`, `onDelete: SetNull`), `@@index([accountId])`; inversa
    `Account.expenseCategories`.
  - `prisma/migrations/20261006214031_tsk_757_expense_category_account/migration.sql` (nuevo).
- **Notas:**
  - Línea base medida antes de tocar nada: `check-types` = 219 errores; `npx vitest run` = 48
    archivos / 601 tests en verde.
  - La migración se generó con `prisma migrate dev --create-only` (para revisar el SQL antes de
    aplicarla) y después `prisma migrate dev`. El SQL coincide **exactamente** con el esperado en
    3.2 (ADD COLUMN, CREATE INDEX, FK `ON DELETE SET NULL ON UPDATE CASCADE`); sin drift ajeno, sin
    `UPDATE` ni backfill. `prisma migrate status`: "Database schema is up to date!".
  - Cliente regenerado (`npm run db:generate`); `check-types` sigue en 219. Dev server de :3010
    reiniciado para tomar el cliente nuevo.
  - Producción: la aplica `docker-entrypoint.sh` al deployar (`prisma migrate deploy`). Es aditiva:
    las categorías existentes quedan con `account_id NULL` = "por defecto", mismo asiento que hoy.

### Fase 2: Helpers puros de resolución y validador (TDD)
- **Estado:** Completada
- **Archivos modificados:**
  - `src/modules/commercial/shared/expense-accounts.ts` (nuevo) — `resolveExpenseDebitAccount`,
    `requiredExpenseSettingsFields`, `buildMissingExpenseAccountsMessage`,
    `buildCategoryAccountNotImputableMessage`, `describeExpenseDebitSource`,
    `buildExpenseDebitLine` (punto de extensión TSK-738), `buildExpenseDebitAccountView`,
    `EXPENSE_CATEGORIES_PATH` y tipos (`ExpenseEntryField`, `ExpenseDebitSource`,
    `ExpenseDebitAccountOrigin`, `ExpenseDebitLine*`, `ExpenseDebitAccountView`).
  - `src/modules/commercial/shared/expense-accounts.test.ts` (nuevo) — P1–P14 (14 tests).
  - `src/modules/commercial/features/expenses/validators.ts` — `accountId`
    `z.string().uuid('Cuenta contable inválida').nullable().optional()` en `expenseCategoryFormSchema`.
  - `src/modules/commercial/features/expenses/validators.test.ts` (nuevo) — V1–V5.
- **Notas:**
  - TDD: los tests se escribieron primero y fallaron (módulo inexistente; V3–V5 en rojo); después
    la implementación → 19/19 en verde. `check-types` 219; eslint sin errores.
  - Ajuste mínimo: P7 compara el label de `expensesAccountId` vía `settingsAccountLabel(...)` en vez
    del literal "Cuenta de egresos por defecto", porque el renombre del label es tarea de la Fase 4;
    el literal se verifica allí (`settings-accounts.test.ts` y casos 2-4/11 de integración).
  - `expense-accounts.ts` no importa `ACCOUNTING_SETTINGS_PATH` ni `formatAccountLabel` (el diseño
    los listaba, pero el helper recibe los labels ya armados y el path de Ajustes lo aporta
    `buildMissingSettingsAccountsMessage`): así no quedan imports sin uso.

### Fase 3: ABM de categorías en el servidor (cuenta + `ActionResult`)
- **Estado:** Completada
- **Archivos modificados:**
  - `src/modules/commercial/features/expenses/actions.server.ts` — `CATEGORY_ACCOUNT_SELECT`;
    `getExpenseCategories` y `getAllExpenseCategories` suman `account` (la segunda también
    `accountId`); nueva `getExpenseCategoryAccounts(includeIds?)`; helpers privados
    `assertCategoryAccountBelongsToCompany`, `parseCategoryInput` y `toCategoryActionFailure`;
    `createExpenseCategory` → `ActionResult<{ id }>`, `updateExpenseCategory` → `ActionResult`
    (semántica undefined/null/string de `accountId`), `toggleExpenseCategory` →
    `ActionResult<{ isActive }>`.
  - `src/modules/commercial/features/expenses/components/_CategoryManagementModal.tsx` — los tres
    handlers hacen `if (!result.success) { toast.error(result.error); return; }` (ajuste mínimo; la
    partición del modal es la Fase 5). La edición sigue sin mandar `accountId` → no lo toca.
  - `src/modules/commercial/features/expenses/expense-journal-entry.integration.test.ts` — import de
    las actions de categorías y `describe` anidado "categorías con cuenta (TSK-757)" con C1–C6
    (cuentas `T757-ALQ`, `T757-ALQ-VIEJA`, `T757-ACTIVO` en la empresa del test y una segunda
    empresa `PREFIX + 'Otra'` con su cuenta EXPENSE, limpiada en su `afterAll`).
- **Notas:**
  - Tests: `npx vitest run` completo → 50 archivos / 626 tests en verde (601 de la línea base + 19
    puros de la Fase 2 + 6 de integración C1–C6); los 7 casos de TSK-728 siguen verdes. Los de
    integración corren de verdad contra `contable-pms-db` (no se saltean) y el `afterAll` verifica
    que no quede nada con el prefijo.
  - `check-types` 219; eslint sin errores en los tres archivos.
  - `toCategoryActionFailure` recibe además un `logData` opcional (id / nombre) para el
    `logger.warn`; el resto como en 3.3.3. P2002 también se traduce en `updateExpenseCategory`
    (C3 lo cubre en alta y edición).
  - C4 y C5 suman, además de lo pedido, la cuenta de otra empresa en la edición y
    `updateExpenseCategory` con id inexistente ("Categoría no encontrada"); C6 verifica también que
    un `includeIds` de otra empresa no se cuela.
  - Las lecturas siguen lanzando (errores técnicos); "No autenticado"/"No hay empresa activa"
    quedan como `throw`, según 2.0.

### Fase 4: Confirmación y asiento con la cuenta resuelta
- **Estado:** Completada
- **Archivos modificados:**
  - `src/modules/commercial/features/expenses/actions.server.ts` — `EXPENSE_ENTRY_FIELDS` reemplazado
    por `ExpenseCategoryForEntry` + `ExpenseAccountToCheck`; `assertExpenseEntryAccounts(companyId,
    documentLabel, settings, category)` exige los campos de `requiredExpenseSettingsFields`, resuelve con
    `resolveExpenseDebitAccount`, valida imputabilidad del Debe resuelto + Cuentas por Pagar en una
    consulta (más la de labels, como antes) y devuelve `{ debitAccountId }`; cuenta de categoría no
    imputable → `buildCategoryAccountNotImputableMessage` (bloquea, no cae a la por defecto).
    `confirmExpense`: `select` con `category { name, accountId }` (sin `categoryId`), presupuesto con
    `checkBudgetForExpense(debitAccountId, …)` siempre (ya no depende de `expensesAccountId`); firma,
    `$transaction` y `catch` sin cambios. Imports: fuera `buildMissingSettingsAccountsMessage` y
    `AccountingSettingsAccountField` (sin uso).
  - `src/modules/accounting/features/integrations/commercial/index.ts` — cabecera "Debe: cuenta de la
    categoría del egreso, o "Cuenta de egresos por defecto""; `createJournalEntryForExpense` selecciona
    `category { name, accountId }`, defensa con `requiredExpenseSettingsFields` +
    `resolveExpenseDebitAccount` → `BusinessError(buildMissingExpenseAccountsMessage(…))`; la línea de
    Debe sale de `buildExpenseDebitLine` (punto de extensión TSK-738); Haber sin cambios. JSDoc de
    `checkBudgetForExpense` → "cuenta del Debe ya resuelta". `buildMissingSettingsAccountsMessage` se
    queda (lo usan recibos/OP).
  - `src/shared/lib/accounts/settings-account-labels.ts` — `expensesAccountId` → "Cuenta de egresos por
    defecto".
  - `src/modules/accounting/features/settings/components/_CommercialIntegrationForm.tsx` — ayuda nueva
    (cuándo se usa y cuándo tiene que estar asignada).
  - `src/modules/commercial/shared/settings-accounts.test.ts` — label renombrado.
  - `src/modules/commercial/features/expenses/expense-journal-entry.integration.test.ts` — cabecera;
    `createDraft(description, categoryId?)`; casos 2–4 con el label nuevo (el 2 además verifica la salida
    "o asignale una cuenta contable a la categoría … en Comercial → Egresos → Categorías."); casos 8–13
    dentro del `describe` "categorías con cuenta (TSK-757)" (reutilizan `T757-ALQ`/`T757-ALQ-VIEJA`).
- **Notas:**
  - Tests: integración 19/19 en verde en verbose (7 de TSK-728 + C1–C6 + 8–13; ninguno salteado);
    `npm run test` completo → 50 archivos / 632 tests en verde. `check-types` 219. eslint sin errores
    en los 6 archivos (2 warnings preexistentes en `INT/index.ts`: `fiscalYearStart`/`fiscalYearEnd`).
  - Caso 13: `prisma.account.delete` de una cuenta temporal sin movimientos funcionó sin chocar con FK;
    no hizo falta el `UPDATE` a null.
  - Caso 12: el orden lo garantiza la ejecución secuencial del archivo; el presupuesto del caso 5 (sobre
    `gastosId`) sigue activo, así que además se verifica que un egreso de categoría sin cuenta sigue
    avisando y uno con cuenta sin presupuesto propio no. Caso 9 también afirma `budgetWarning`
    undefined por la misma razón.
  - Desvío menor: la pre-validación chequea `!debit || !settings.payablesAccountId` junto a
    `missing.length` (no puede pasar tras faltantes vacíos, pero así TypeScript estrecha sin `!`).
  - `getExpenseById` (3.3.6) no se tocó: es de la Fase 6 (D6).
  - "Cuenta de Gastos Operativos" queda para la **Fase 8** en: `_CommercialGuide.tsx:1202,1214`,
    `_AccountingGuide.tsx:252,336`, `docs/modules/commercial.md:635,638,740,948`,
    `docs/modules/accounting.md:259,271`. `scripts/guia-presentacion/tsk-728.html` y
    `capturas-tsk728.mjs` son históricos de TSK-728 (no se tocan). El nombre de la cuenta del test
    `T728G-GASTOS` "Gastos Operativos" es dato de prueba, no el label.
  - **Prueba en navegador** (Playwright contra :3010, script temporal borrado; empresa "Empresa de
    Prueba 01 SA"). En dev `expenses_account_id` estaba en NULL: se respetó y se restauró a NULL al final.
    Categorías sembradas por SQL con marca `TSK757-F4`; egresos creados desde el alta de la UI ($1234,
    `notes='TSK757-F4'`) y confirmados desde el menú de la fila:
    - A — categoría "TSK757-F4 Con cuenta" → 4.2.1/02/03 Energía - Explotación, **sin** cuenta por
      defecto: toast "Egreso confirmado correctamente"; GTO-00004, asiento **38**: Debe 4.2.1/02/03 1234
      / Haber 2.1.1/02/01 Acreedores Locales 1234.
    - B — categoría "TSK757-F4 Sin cuenta", por defecto temporal 4.2.1/03/10 Gastos Varios -
      Administración: GTO-00005, asiento **39**: Debe 4.2.1/03/10 1234 / Haber 2.1.1/02/01 1234.
    - C — categoría "TSK757-F4 Cuenta inactiva" → cuenta raíz temporal `TSK757-F4` inactiva (con por
      defecto configurada): toast rojo "No se puede confirmar el gasto GTO-00006: la cuenta TSK757-F4 -
      Cuenta dada de baja TSK757-F4 de la categoría "TSK757-F4 Cuenta inactiva" no está activa o no es
      imputable. Corregila en Comercial → Egresos → Categorías."; quedó DRAFT sin asiento (no cayó a la
      por defecto). Se eliminó desde la UI ("Egreso eliminado correctamente").
    - Limpieza: borradas la categoría "Cuenta inactiva" y la cuenta `TSK757-F4`. **Quedan** (no se
      pueden borrar por UI): egresos `70f98beb-d6e5-4cd0-bf73-9ce3e742dd57` (GTO-00004, asiento 38,
      `96e97680-a964-4a93-91cf-a1b0f90dd65b`) y `d87b35ea-e8d4-4754-976a-e44b008b6866` (GTO-00005,
      asiento 39, `ccc599a8-4e1a-4cd1-a41c-8587c02e039a`), ambos `notes='TSK757-F4'`; y las categorías
      **desactivadas** `4c6e48b8-40ab-4958-941c-52a560d82c2c` ("TSK757-F4 Con cuenta") y
      `48d83ffc-2f7d-4d00-8949-ee888d4794f6` ("TSK757-F4 Sin cuenta"), referenciadas por esos egresos.
    - El toast se vio en `npm run dev`; la verificación con build de producción (mensaje no redactado)
      queda para la Fase 7/9, como indica la memoria `errores-negocio-server-actions` (el camino es el
      mismo `BusinessError` → `toActionResult` de TSK-728).

### Fase 5: UI de categorías — modal partido y acceso desde el listado
- **Estado:** Completada
- **Archivos modificados:**
  - `EXP/hooks/useExpenseCategoryMutations.ts` (nuevo, 103 líneas) — tres `useMutation` sobre las actions
    `ActionResult`: `!result.success` → `toast.error(result.error)`; éxito → `toast.success` e
    invalidación de `['allExpenseCategories']`, `['expenseCategories']`, `['expenseCategoryAccounts']`;
    `onError` (fallo técnico) → `logger.error` + `UNEXPECTED_ERROR_MESSAGE`. Devuelve
    `createCategory`/`updateCategory`/`toggleCategory` (→ `Promise<boolean>`), `isCreating`, `pendingId`.
  - `EXP/components/_CategoryAccountField.tsx` (nuevo, 48) — `useQuery(['expenseCategoryAccounts',
    includeIds])` + `AccountCombobox` con `clearLabel` "Sin asignar (usar la cuenta de egresos por
    defecto)" y `placeholder` "Por defecto".
  - `EXP/components/_CategoryCreateForm.tsx` (nuevo, 103) — RHF + `zodResolver`, nombre / cuenta (grid de
    2 columnas desde `sm`) / descripción, `FormDescription` "Si la dejás vacía, se usa la cuenta de
    egresos por defecto."; se resetea solo si se creó.
  - `EXP/components/_CategoryRow.tsx` (nuevo, 187) — vista con cuenta (`code - name` o "Por defecto",
    `data-testid="category-account"`), badge "Inactiva", conteo; edición inline (nombre, cuenta con
    `savedAccountId`, descripción) que siempre manda `accountId` (null = por defecto); Editar/Activar solo
    con `canUpdate`; `flex-wrap`/`min-w-0`/`basis-full sm:basis-auto` para móvil.
  - `EXP/components/_CategoryManagementModal.tsx` (reescrito, 311 → 125) — `Dialog` + `useQuery
    (['allExpenseCategories'])` + `usePermissions` + composición; título "Categorías de egreso",
    `DialogDescription` del diseño; `sm:max-w-2xl max-h-[85vh] overflow-y-auto`. Props sin cambios.
  - `EXP/list/components/_ExpensesToolbarActions.tsx` (nuevo, 36) — botón "Categorías" (`Tags`, outline)
    + `_CreateExpenseModal` con `canCreate`; `onClose`/`onSuccess` → `router.refresh()`.
  - `EXP/list/components/_ExpensesTable.tsx` (301 → 302) — `toolbarActions={<_ExpensesToolbarActions …/>}`.
- **Notas / desvíos:**
  - `_CategoryRow` suma las props `isEditing` y `onEdit(id | null)` (el diseño deja `editingId` en el
    modal, así que la fila necesita saber si está en edición y avisar al entrar/salir).
  - Los permisos de edición/alta se resuelven en el modal (`hasPermission('commercial.expenses',
    'create' | 'update')`), no en `_CategoryCreateForm`: el form solo se monta con `create`.
  - `_ExpensesTable.tsx` crece **1** línea (no 0): el import de `_CreateExpenseModal` se queda porque
    la tabla lo usa también para el modal de edición; se suma el de `_ExpensesToolbarActions`.
  - En móvil (`< sm`) el botón "Categorías" muestra solo el ícono (`aria-label`/`title` "Categorías"):
    la barra derecha del `DataTable` (`flex items-center space-x-2`) no hace wrap.
  - Calidad: `npm run test` 50 archivos / 632 tests en verde; `check-types` 219; eslint sin errores en
    los 7 archivos; todos los componentes nuevos/reescritos < 200 líneas.
  - **Prueba en navegador** (Playwright contra :3010, script temporal borrado, marca `TSK757-F56`):
    - Botón "Categorías" del listado abre el modal "Categorías de egreso".
    - Combo del alta: 78 opciones = 78 cuentas EXPENSE imputables de la empresa (SQL con la regla de
      `buildImputableAccountsWhere`), todas de tipo EXPENSE, más "Sin asignar (usar la cuenta de
      egresos por defecto)".
    - Alta "TSK757-F56 Alquiler" con 4.2.1/02/18 Alquiler inmuebles → toast "Categoría creada
      correctamente", fila con la cuenta, DB guardada, form reseteado.
    - Cambio a 4.2.1/02/03 Energía - Explotación → "Categoría actualizada correctamente" y fila nueva.
    - Quitar ("Sin asignar…") → fila "Por defecto", `account_id` NULL.
    - Desactivar → toast + badge "Inactiva"; Activar → toast.
    - Nombre duplicado → toast "Ya existe una categoría con ese nombre"; el form conserva el nombre.
    - Cuenta guardada no imputable (cuenta raíz temporal `TSK757-F56` inactiva asignada por SQL): la fila
      la muestra, el combo de edición la muestra seleccionada y figura entre las opciones (79 =
      78 + `includeIds`). Cuenta temporal borrada al final.
    - "Gestionar" del alta de egreso abre el mismo modal nuevo.
    - Móvil 375×812 `isMobile`: el modal no tiene overflow propio (`scrollWidth == clientWidth`, también
      con una fila en edición) y con el desborde ajeno neutralizado queda `documentElement.scrollWidth
      = 375` y el dialog en x=16, ancho 343. **Preexistente (no de este ticket):** el listado de
      Egresos en 375 ya tiene `scrollWidth` 443–451 por la paginación del `DataTable`
      (`flex items-center space-x-6 lg:space-x-8`) y por la barra derecha del toolbar (`right=405`
      también sin este cambio, medido con `git stash`); con eso el layout viewport se ensancha y el
      dialog (`max-w-[calc(100%-2rem)]`) también. Queda anotado para Fase 7/2.4.
    - Datos que quedan: categoría activa "TSK757-F56 Alquiler" sin cuenta (se usa en la Fase 6).

### Fase 6: La cuenta visible en el egreso (D6)
- **Estado:** Pendiente

### Fase 7: Verificación en navegador y capturas
- **Estado:** Pendiente

### Fase 8: Documentación — guía in-app, docs y presentación
- **Estado:** Pendiente

### Fase 9: Verificación final
- **Estado:** Pendiente

## 5. Verificación
_Pendiente - ejecutar `/verificar tsk-757-cuenta-contable-por-tipo-de-gasto`_
