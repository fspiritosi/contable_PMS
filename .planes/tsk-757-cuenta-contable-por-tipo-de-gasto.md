# TSK-757 — Cuenta contable por tipo de gasto

**Fecha de inicio:** 2026-10-06
**Estado:** Planificación completada

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
  - [ ] Medir línea base: `npm run check-types 2>&1 | grep -c "error TS"` (esperado 219) y
        `npm run test` (anotar cuántos pasan); registrarlas en la sección 4.
  - [ ] `prisma/schema.prisma:3645-3659` (`model ExpenseCategory`), después de `isActive`:
        ```prisma
        // TSK-757: cuenta contable de la categoría; null = usa la cuenta de egresos por defecto de AccountingSettings
        accountId   String?  @map("account_id") @db.Uuid
        ```
        relación `account Account? @relation("ExpenseCategoryAccount", fields: [accountId],
        references: [id], onDelete: SetNull)` junto a `company`/`expenses`, y
        `@@index([accountId])` antes de `@@map`.
  - [ ] `prisma/schema.prisma` (`model Account`, después de `depreciationsAsDepreciationExpense`,
        ~:360): inversa `expenseCategories ExpenseCategory[] @relation("ExpenseCategoryAccount")`
        con comentario `// TSK-757`.
  - [ ] Con el docker `contable-pms-db` arriba: `npm run db:migrate -- --name
        tsk_757_expense_category_account`. Verificar que
        `prisma/migrations/<timestamp>_tsk_757_expense_category_account/migration.sql` tenga
        **solo** 1 `ALTER TABLE "expense_categories" ADD COLUMN "account_id" UUID`, 1
        `CREATE INDEX` y 1 `ADD CONSTRAINT … FOREIGN KEY ("account_id") REFERENCES
        "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE`. Sin `UPDATE`, sin backfill (D8).
        Si `migrate dev` detecta drift ajeno, no resetear: `npx prisma migrate status`.
  - [ ] `npm run db:generate`; `npm run check-types` sigue en 219.
  - [ ] Anotar en la sección 4 que en producción la aplica el `docker-entrypoint.sh` al deployar
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
  - [ ] Crear `src/modules/commercial/shared/expense-accounts.test.ts` primero (rojo) y después
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
  - [ ] Casos: categoría con cuenta y default vacía → categoría; categoría sin cuenta → default;
        ninguna → null; `''` como vacío; `requiredExpenseSettingsFields` en ambos casos; mensajes
        con y sin cuenta existente; `buildExpenseDebitLine` (importe, crédito 0, descripción, sin
        `costCenterId`).
  - [ ] `EXP/validators.ts`: `expenseCategoryFormSchema` suma
        `accountId: z.string().uuid().nullable().optional()`. Crear `EXP/validators.test.ts`: nombre
        vacío falla; `accountId` null/undefined/uuid válidos; string no-uuid falla.
  - [ ] `npm run test -- expense-accounts validators` en verde.
- **Archivos:** `src/modules/commercial/shared/expense-accounts.ts` y `.test.ts` (nuevos);
  `EXP/validators.ts` (modificado); `EXP/validators.test.ts` (nuevo).
- **Criterio de completitud:** tests nuevos en verde; sin cambios de UI ni actions; commit
  `feat(commercial): regla de la cuenta del egreso por categoría con fallback (TSK-757, fase 2)`.

#### Fase 3: ABM de categorías en el servidor (cuenta + `ActionResult`)

- **Objetivo:** las actions de categorías guardan/leen la cuenta y sus errores de negocio llegan
  legibles en producción.
- **Tareas:**
  - [ ] `EXP/actions.server.ts` `getExpenseCategories` (:50): sumar al `select`
        `account: { select: { id: true, code: true, name: true } }` (lo usa el hint del alta, D6).
  - [ ] `getAllExpenseCategories` (:70): sumar `accountId` y el mismo `account`.
  - [ ] Nueva `getExpenseCategoryAccounts(includeIds?: string[])`: `checkPermission(
        'commercial.expenses', 'view', { redirect: true })`, `getActiveCompanyId()`,
        `buildImputableAccountsWhere({ companyId, types: ['EXPENSE'] })` envuelto en `OR` con
        `{ companyId, id: { in: includeIds } }` (molde vehicle-types :176-200), `select { id, code,
        name }`, `orderBy code`.
  - [ ] Helper privado `assertCategoryAccountBelongsToCompany(accountId, companyId)` →
        `BusinessError('La cuenta contable seleccionada no pertenece a la empresa')` (molde
        vehicle-types :229-241, pero con `BusinessError`).
  - [ ] `createExpenseCategory` (:91) → `Promise<ActionResult<{ id: string }>>`: valida
        `accountId` si viene, persiste `accountId ?? null`; P2002 → `BusinessError('Ya existe una
        categoría con ese nombre')`; `catch` → `toActionResult(error, 'Error al crear categoría de
        gasto')`; `logger.warn` para `BusinessError`, `logger.error` para lo demás.
  - [ ] `updateExpenseCategory` (:124) → `Promise<ActionResult>`: `accountId` con la semántica
        undefined/null/string de 2.0; `count === 0` → `BusinessError('Categoría no encontrada')`.
  - [ ] `toggleExpenseCategory` (:160) → `Promise<ActionResult<{ isActive: boolean }>>`.
  - [ ] Ajustar los consumidores mínimos para que compile (el refactor visual es la Fase 5):
        `EXP/components/_CategoryManagementModal.tsx` (`if (!result.success) toast.error(
        result.error)` en lugar de `catch`).
  - [ ] Tests de integración en `EXP/expense-journal-entry.integration.test.ts` (nuevo
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
  - [ ] `EXP/actions.server.ts` `confirmExpense` (:538): el `select` del egreso suma
        `category: { select: { name: true, accountId: true } }`.
  - [ ] Reemplazar `EXPENSE_ENTRY_FIELDS` / `assertExpenseEntryAccounts` (:486-530) por
        `assertExpenseEntryAccounts(companyId, documentLabel, settings, category)` que:
        (1) faltantes con `findMissingSettingsAccounts(settings,
        requiredExpenseSettingsFields(category.accountId))` → mensaje de TSK-728; si falta
        `expensesAccountId`, el mensaje además nombra la categoría y la alternativa ("o asignale
        una cuenta a la categoría "X" en Comercial → Egresos → Categorías"); (2) resuelve con
        `resolveExpenseDebitAccount`; (3) valida imputabilidad de la cuenta resuelta y de
        `payablesAccountId` en una sola consulta (como hoy); si falla la de la categoría →
        `buildCategoryAccountNotImputableMessage`; si falla una de Ajustes → mensaje actual.
        Devuelve `{ debitAccountId }`.
  - [ ] Presupuesto (:568-586): `checkBudgetForExpense(debitAccountId, …)` (R1). Actualizar el
        JSDoc de `checkBudgetForExpense` (`INT/index.ts` ~:1043) — "cuenta resuelta del egreso".
  - [ ] `INT/index.ts` `createJournalEntryForExpense` (:962-1033): `select` suma
        `category: { select: { name: true, accountId: true } }`; defensa en profundidad con
        `requiredExpenseSettingsFields` + `resolveExpenseDebitAccount` (si null → `BusinessError`
        con el mismo mensaje); la línea de Debe sale de `buildExpenseDebitLine(…)`; actualizar el
        comentario de cabecera (:38 "Debe: Gastos Operativos" → "Debe: cuenta de la categoría o
        de egresos por defecto").
  - [ ] `src/shared/lib/accounts/settings-account-labels.ts:56`: `expensesAccountId` →
        `'Cuenta de egresos por defecto'`.
  - [ ] `src/modules/accounting/features/settings/components/_CommercialIntegrationForm.tsx:78`:
        ayuda → "Se usa al confirmar egresos cuya categoría no tiene cuenta contable propia
        (Comercial → Egresos → Categorías). Si alguna categoría no tiene cuenta, tiene que estar
        asignada."
  - [ ] `src/modules/commercial/shared/settings-accounts.test.ts:101`: label renombrado.
  - [ ] `EXP/expense-journal-entry.integration.test.ts`: actualizar casos 2, 3 y 4 al label nuevo
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
  - [ ] `npm run test` (todo, incluidos los 7 casos de TSK-728).
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
  - [ ] `EXP/hooks/useExpenseCategoryMutations.ts` (nuevo, sin `_`): `useMutation` de create /
        update / toggle sobre las actions `ActionResult` (`if (!result.success)
        toast.error(result.error)`), `toast.success` e invalidación de
        `['allExpenseCategories']`, `['expenseCategories']` y `['expenseCategoryAccounts']`
        (sale de `_CategoryManagementModal.tsx:59-111`).
  - [ ] `EXP/components/_CategoryAccountField.tsx` (nuevo): `useQuery(['expenseCategoryAccounts',
        includeIds], () => getExpenseCategoryAccounts(includeIds))` + `AccountCombobox` con
        `clearLabel` de 2.0, prop `disabled`.
  - [ ] `EXP/components/_CategoryCreateForm.tsx` (nuevo): RHF + `zodResolver(
        expenseCategoryFormSchema)` con nombre, descripción y `_CategoryAccountField`; se muestra
        solo con `hasPermission('commercial.expenses', 'create')`.
  - [ ] `EXP/components/_CategoryRow.tsx` (nuevo): fila con nombre, descripción, cuenta
        (`code - name` o "Por defecto" en `text-muted-foreground`), badge "Inactiva", conteo de
        egresos; edición inline (nombre, descripción, cuenta) y toggle solo con
        `hasPermission('commercial.expenses', 'update')`. Layout responsive: en `< sm` la cuenta
        baja a su propia línea (`flex-wrap`, `min-w-0`).
  - [ ] `EXP/components/_CategoryManagementModal.tsx`: queda como `Dialog` + `useQuery
        (['allExpenseCategories'])` + composición; título "Categorías de egreso" y descripción
        "Cada categoría puede tener su cuenta contable; si no tiene, el egreso usa la cuenta de
        egresos por defecto". `DialogContent` `sm:max-w-2xl` para que entre la cuenta.
  - [ ] Acceso desde el listado: `EXP/list/components/_ExpensesToolbarActions.tsx` (nuevo) con el
        botón "Categorías" (icono `Tags`, `variant="outline"`, trigger del modal; visible con
        `view`) + `_CreateExpenseModal` (con `create`); `_ExpensesTable.tsx:211` pasa a
        `toolbarActions={<_ExpensesToolbarActions … />}` (sin crecer).
  - [ ] Verificar a mano en `:3010`: alta con y sin cuenta, edición (asignar, cambiar, limpiar),
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


## 3. Diseño
_Pendiente - ejecutar `/disenar tsk-757-cuenta-contable-por-tipo-de-gasto`_

## 4. Implementación
_Pendiente - ejecutar `/implementar tsk-757-cuenta-contable-por-tipo-de-gasto`_

## 5. Verificación
_Pendiente - ejecutar `/verificar tsk-757-cuenta-contable-por-tipo-de-gasto`_
