# TSK-757 — Cuenta contable por tipo de gasto

**Fecha de inicio:** 2026-10-06
**Estado:** Análisis completado

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
_Pendiente - ejecutar `/planificar tsk-757-cuenta-contable-por-tipo-de-gasto`_

## 3. Diseño
_Pendiente - ejecutar `/disenar tsk-757-cuenta-contable-por-tipo-de-gasto`_

## 4. Implementación
_Pendiente - ejecutar `/implementar tsk-757-cuenta-contable-por-tipo-de-gasto`_

## 5. Verificación
_Pendiente - ejecutar `/verificar tsk-757-cuenta-contable-por-tipo-de-gasto`_
