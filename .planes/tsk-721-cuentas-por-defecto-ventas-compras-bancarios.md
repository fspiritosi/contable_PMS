# TSK-721/718: Cuentas contables por defecto para ventas, compras y gastos bancarios

**Fecha de inicio:** 2026-09-18
**Tickets:** [724-a/b] "Configuración de Cuentas Contables" · [721] "Cuentas Contables de los items" · [718] "Tipo de Movimiento: Gastos Bancarios"
**Origen:** reunión con Elizabeth Perez del 16-17/09 (tareas internas)
**Estado:** Implementación en progreso (Fase 1 de 8 completada)

---

## 1. Análisis

### 1.1 Problema

En Contabilidad → Configuración → Integración Comercial hay dos campos llamados **"Cuenta de
Ventas"** y **"Cuenta de Compras"** con ayudas "Se usa al confirmar facturas de venta (Haber)" /
"Se usa al confirmar facturas de compra (Debe)"
(`src/modules/accounting/features/settings/components/_CommercialIntegrationForm.tsx:60-71`). La
clienta los lee como "la cuenta de **todas** las ventas / compras", y eso contradice cómo
quiere llevar la contabilidad: **la cuenta la define el ítem**, y la de configuración tiene que
ser solo un **respaldo** para lo que no tiene cuenta propia.

Las tres tareas internas dicen lo mismo desde tres ángulos:

- **TSK-724 (a y b)**: "Cuenta de Ventas ⇒ se determina por la cuenta contable del ítem de
  venta, no puede ser una para todas las ventas. Cuenta de Compras ⇒ lo mismo que para las
  ventas."
- **TSK-721**: "Si el ítem tiene cuentas contables de ingreso o de egreso, esos son los de
  asientos contables."
- **TSK-718**: "Tipo de Movimiento: Gastos Bancarios — también se debe configurar la cuenta
  desde configuración contable." ("Tipo de movimiento *" es el label del modal de Movimientos
  de Fondos, `fund-movements/list/components/_CreateFundMovementModal.tsx:323`; el tipo es
  `BANK_CHARGES`, "Gastos e impuestos bancarios", TSK-585.)

Lo paradójico es que **el asiento ya prioriza la cuenta del ítem** (ver 1.2.1): el problema real
es (a) que la configuración lo **exige** igual y lo **nombra** como si fuera la única cuenta,
(b) que cuando falta la global el sistema **no avisa** y deja la factura confirmada sin asiento,
y (c) que gastos bancarios no tiene ninguna cuenta por defecto y obliga a elegir la cuenta
concepto por concepto. Es exactamente el patrón que se acaba de resolver en **TSK-717** para la
cuenta de aportes de socios (label "… por defecto", ayuda que dice cuándo se usa, error que
nombra a quién le falta la cuenta), y hay que replicarlo.

### 1.2 Contexto actual

#### 1.2.1 El asiento de ventas y compras hoy

Archivo: `src/modules/accounting/features/integrations/commercial/index.ts` (1228 líneas).

**Factura de venta** — `createJournalEntryForSalesInvoice` (`:273-441`):

- Carga `settings` con `include` de todas las cuentas (`getAccountingSettings`, `:73-97`) y la
  factura con `lines.product { defaultIncomeAccountId, defaultCostCenterId }` (`:282-301`). El
  `select` del producto **no** trae la cuenta como relación ni su `isActive`/`isLeaf`/
  `disabledFrom`: solo el id.
- **Exige la global**: `if (!settings.receivablesAccountId || !settings.salesAccountId)` →
  `logger.warn('No se puede crear asiento…: cuentas no configuradas')` y **`return null`**
  (`:311-316`). No lanza error.
- **Cuenta de cada línea**: `line.product?.defaultIncomeAccountId || settings.salesAccountId!`
  (`:339`), agrupada por cuenta + centro con `expandByCostCenter` (`:337-347`). Es decir, **la
  cuenta del ítem ya gana**; la global solo entra si el ítem no tiene. **No se valida** que la
  cuenta del ítem exista, sea de la empresa, esté activa ni sea imputable.
- **Notas de crédito y débito**: misma función. `isNC = isCreditNote(voucherType)` (`:309`;
  `commercial/shared/voucher-utils.ts:6-8`) invierte Debe/Haber; las ND se tratan como
  factura (no hay rama `isDebitNote` en el asiento). Lo mismo en compra (`:484`).
- **Activos (TSK-579)**: si el ítem tiene `defaultIncomeAccountId` de tipo ASSET (un rodado que
  se vende) el asiento lo usa igual, sin mirar el tipo. El único lugar que mira el tipo es la
  regla de centro de costo (`effectiveAccountType`, `commercial/shared/cost-center.ts:37-42`).

**Factura de compra** — `createJournalEntryForPurchaseInvoice` (`:448-618`): espejo exacto.
Exige `payablesAccountId || purchasesAccountId` con `warn` + `return null` (`:486-491`); cuenta
de línea `line.product?.defaultExpenseAccountId || settings.purchasesAccountId!` (`:504`).

**Qué pasa con el `return null` en los llamadores**: `confirmInvoice`
(`sales/features/invoices/list/actions.server.ts:1077-1099`) y `confirmPurchaseInvoice`
(`purchases/features/invoices/list/actions.server.ts:1432-1454`) envuelven la llamada en un
`try/catch` que **solo re-lanza** si el mensaje incluye `'período está cerrado'`; cualquier
otro error se degrada a `logger.warn('No se pudo generar asiento contable…')`. Y si la función
devuelve `null`, simplemente no se guarda `journalEntryId`. Resultado hoy: **una empresa sin
"Cuenta de Ventas" configurada confirma facturas sin asiento y nadie se entera.** Este es el
mismo agujero que TSK-644 tapó para percepciones e impuestos internos con una
**pre-validación antes de la transacción** (`findMissingTributeAccounts` +
`buildMissingTributeAccountsMessage`, `sales/.../actions.server.ts:900-926`,
`purchases/.../actions.server.ts:1274-1304`; helpers en
`commercial/shared/perceptions.ts:179-193`). Ese es el mecanismo a reutilizar: el `throw` dentro
de `createJournalEntryFor…` **no llega al usuario**, la pre-validación sí.

**Líneas sin producto — dónde la global sigue siendo imprescindible**:

- **Ventas**: `SalesInvoiceLine.productId String` es **obligatorio** (`prisma/schema.prisma:2885`,
  `product Product @relation` `:2905`; Zod `productId: z.string().uuid('Ítem inválido')`,
  `sales/features/invoices/shared/validators.ts:10`). Toda línea de venta tiene ítem, así que
  la global de ventas **solo** se usa cuando el ítem no tiene `defaultIncomeAccountId`.
- **Compras**: `PurchaseInvoiceLine.productId String?` es **opcional** ("Opcional si es un gasto
  no inventariable", `schema.prisma:3013`, `product Product?` `:3031`; Zod
  `purchases/features/invoices/shared/validators.ts:42`). El formulario lo muestra como "Ítem"
  con placeholder **"Opcional"** (`_PurchaseInvoiceForm.tsx:782-799`). Y la **importación
  AFIP** crea comprobantes **en `DRAFT`** con líneas genéricas **sin ítem** ("Compra según
  comprobante AFIP (IVA 21%)", "No gravado", "Operaciones exentas",
  `purchases/features/invoices/list/lib/afip-import.server.ts:319-372`, `status: 'DRAFT'`
  `:407`). Para todas esas líneas la única cuenta posible hoy es `purchasesAccountId`.
  Conclusión: **la global de compras no se puede eliminar** sin agregar selección de cuenta por
  línea (fuera de alcance).
- `Supplier.defaultAccountId` existe en el schema ("Datos contables", `schema.prisma:2147`,
  `:2165`) pero **ningún asiento lo lee** (`grep defaultAccountId` solo da clientes y socios).
  Sería un fallback intermedio natural para líneas sin ítem (cuenta del proveedor → global),
  pero no está pedido; se deja como pregunta abierta (1.7).

**Otros asientos del mismo archivo** que no cambian: recibo (`:626`), orden de pago (`:767`),
gasto (`:913`, usa `expensesAccountId`), CMV (`:1155`, usa `cogsAccountId`/`inventoryAccountId`
y devuelve `null` si faltan, `:1164-1166`).

#### 1.2.2 Configuración contable hoy

`src/modules/accounting/features/settings/`:

- **Form** `_CommercialIntegrationForm.tsx`: grilla declarativa `SECTIONS` (`:56-238`). Sección
  "Cuentas de Resultado" con `salesAccountId` (label "Cuenta de Ventas", `types: ['REVENUE']`,
  `:60-64`), `purchasesAccountId` ("Cuenta de Compras", `types: ['EXPENSE']`, `:66-70`) y
  `expensesAccountId` ("Cuenta de Gastos Operativos", `:72-76`). Sección "Cuentas de Tesorería
  (Opcional)" con caja y banco por defecto, cuyas ayudas ya usan la semántica correcta: "Se usa
  si la caja no tiene cuenta específica asignada" (`:116-129`). TSK-717 dejó
  `partnerContributionsAccountId` como "Cuenta de aportes de socios por defecto" con ayuda
  larga que explica el fallback y dice "Si todos los socios tienen la suya, este campo puede
  quedar sin asignar" (`:140-145`). El filtro por tipo se aplica en el cliente con `accountsFor`
  (`:310-311`) sobre las cuentas que trae `getActiveAccounts` (imputables + las ya configuradas,
  `actions.server.ts:199-228`, `AccountingSettings.tsx:12-19`).
- **Zod** `validators.ts`: **todos** los campos de cuenta ya son opcionales (`accountField` =
  `z.string().nullish().transform(→ null)`, `:12-15`; `commercialIntegrationSchema` `:18-59`).
  **No hace falta tocar el schema para que las globales sean opcionales: ya lo son.** Lo único
  que las "exige" es el asiento (1.2.1).
- **Action** `saveAccountingSettings(companyId, input)` con la lista explícita de campos
  (`actions.server.ts:33-75`) y `upsert` (`:92-99`). Cada campo nuevo se agrega a esa firma.
- **Página** `AccountingSettings.tsx:70-121` pasa `defaultValues` campo por campo (tipado con la
  forma de salida a propósito, para que no se olvide ninguno — TSK-492,
  `_CommercialIntegrationForm.tsx:244-249`).
- **Indicador de "configuración incompleta"**: **no existe**. `grep -rn "Completeness|incompleta"`
  en `src/` no devuelve nada. El único aviso de configuración faltante es puntual: la alerta del
  modal de fondos para aportes (`_PartnerAccountNotice.tsx`, TSK-717).
- **Patrón de campo nuevo** (TSK-644, 7 cuentas de percepciones + impuestos internos): columna
  en `AccountingSettings` + relación con nombre único + inversa en `Account`
  (`schema.prisma:583-602`, `Account` `:358-364` "settingsAsPerc…"); migración aditiva
  `prisma/migrations/20260903183104_tsk_644_percepciones_impuestos_internos/migration.sql`
  (`ADD COLUMN … UUID` + `FOREIGN KEY … ON DELETE SET NULL`); `accountField` en
  `validators.ts:39-46`; entrada en `SECTIONS` (`_CommercialIntegrationForm.tsx:195-233`);
  firma de `saveAccountingSettings` (`actions.server.ts:59-66`); `defaultValues` en
  `AccountingSettings.tsx:100-106`; `include` en `getAccountingSettings` del asiento solo si el
  asiento la usa. Test: `validators.test.ts:35-71`.

#### 1.2.3 Ítems y sus cuentas

- **Modelo**: `Product.defaultExpenseAccountId` / `defaultIncomeAccountId` (`String?`,
  `schema.prisma:2268-2269`), relaciones `"ProductExpenseAccount"` / `"ProductIncomeAccount"`
  (`:2280-2281`), inversas en `Account` (`:370-371`). Comentario del bloque: "Conceptos
  contables y logísticos por defecto".
- **Form del ítem**: `_AccountingDefaultsSection.tsx` (card "Configuración Contable y
  Logística"), campos "Cuenta de Egresos" (ayuda "Cuenta contable para registrar la compra del
  ítem", `:93-115`) y "Cuenta de Ingresos" ("…la venta del ítem", `:117-139`), con
  `AccountCombobox` (TSK-464) y filtros de tipo de TSK-579:
  `filterExpenseAccounts` = EXPENSE|ASSET, `filterIncomeAccounts` = REVENUE|ASSET
  (`products/shared/account-filters.ts:22-31`). Las opciones vienen de
  `getAccountsForProductSelect` (`isActive && isLeaf`, **sin** `disabledFrom`,
  `products/shared/catalog-actions.server.ts:7-17`).
- **Validación server**: Zod solo exige uuid (`products/shared/validators.ts:59-60`);
  `createProduct`/`updateProduct` guardan `|| null` (`list/actions.server.ts:315-316`,
  `:415-416`); `updateProductImputation` (`:954-990`) y `bulkUpdateProducts` (`:907-923`) tampoco
  verifican que la cuenta sea de la empresa ni imputable. Es decir: **hoy nada garantiza que la
  cuenta guardada en el ítem siga siendo válida cuando se confirma la factura** (una cuenta con
  hijas nuevas, dada de baja o con corte de ejercicio se usa igual en el asiento).
- **Imputación desde el listado**: existe y es la base de TSK-409: `_ImputationModal.tsx` (por
  ítem, "Cuenta de Ingresos (ventas)" / "Cuenta de Egresos (compras)", `:114-124`) y
  `_BulkEditModal.tsx` (masivo, `:276-314`) → `bulkUpdateProducts`. Columna **"Imputación"** en
  `list/columns.tsx:237-273`: muestra `Ing:`/`Egr:` con los códigos, y un badge naranja **"Sin
  imputar"** solo cuando **faltan las dos** (`if (!income && !expense)`, `:246`). Un ítem con
  cuenta de egreso pero sin la de ingreso **no se marca**.
- **Filtro / conteo de "ítems sin cuenta"**: **no existe**. `getProducts` filtra por `type`,
  `status`, `name`, `code`, `category`, `stockLevel` (`list/actions.server.ts:38-77`);
  `getProductFacetCounts` cuenta solo `type` y `status` (`:158-181`). No hay forma de saber
  "cuántos ítems caerían en la global" sin recorrer el listado a mano. Cuántos hay en producción
  no se puede saber desde este análisis (requiere `psql` en Dokploy, memoria
  `produccion-dokploy-scripts-db.md`); consulta para antes de planificar:

  ```sql
  SELECT usage,
         count(*) FILTER (WHERE default_income_account_id IS NULL)  AS sin_ingreso,
         count(*) FILTER (WHERE default_expense_account_id IS NULL) AS sin_egreso,
         count(*) AS total
  FROM products WHERE company_id = '<PMS>' AND status = 'ACTIVE' GROUP BY 1;
  ```

#### 1.2.4 Gastos bancarios hoy (TSK-585)

`src/modules/commercial/features/treasury/features/fund-movements/`:

- **Modelo**: `FundMovementType.BANK_CHARGES` (`schema.prisma:4312`), líneas
  `FundMovementLine { accountId String (NOT NULL), description, amount, position }`
  (`:4366-4382`). **Cada concepto tiene cuenta obligatoria a nivel de base.**
- **Modal**: el tipo "Gastos e impuestos bancarios" oculta Monto y muestra
  `_FundMovementLinesField` (`_CreateFundMovementModal.tsx:455`). Cada fila nueva se agrega con
  `append({ accountId: '', description: '', amount: '' })` (`_FundMovementLinesField.tsx:51`) y
  tiene un `AccountCombobox` con `clearLabel={null}` y placeholder "Cuenta contable"
  (`:74-85`). Las opciones son `lineAccounts` = `getFundMovementLineAccounts(includeIds)`
  (`_CreateFundMovementModal.tsx:122-127`): imputables (`buildImputableAccountsWhere`) filtradas
  por `filterExpenseAccounts` (EXPENSE|ASSET, porque Sircreb es activo)
  (`list/actions.server.ts:181-201`). Devuelve solo `{ id, code, name }`.
- **Validación**: `validateLines` → `MISSING_ACCOUNT` "Elegí la cuenta contable del concepto"
  (`shared/lines-calc.ts:34-51`), aplicada en el `superRefine` (`shared/validators.ts:189-196`)
  y en el server (`assertLineAccounts`: de la empresa, imputables, EXPENSE|ASSET, con
  `BusinessError`, `list/actions.server.ts:603-614`), llamada en `createFundMovement` (`:647`) y
  `updateFundMovement` (`:719`).
- **Asiento** (`confirmFundMovement`, rama `BANK_CHARGES`, `:875-901`): un Debe por concepto
  (`line.accountId`) y un Haber al banco/caja por el total. **No lee ninguna cuenta de
  `AccountingSettings`** para los conceptos; el `select` de settings (`:786-793`) trae solo
  aportes, banco y caja por defecto.
- **Catálogos**: `getFundMovementCatalogs` (`:122-164`) ya devuelve
  `defaultContributionsAccount { id, code, name } | null` para el aviso de TSK-717; es el lugar
  natural para devolver también la cuenta de gastos bancarios por defecto. El flujo hacia el
  modal es `FundMovementsList.tsx:12-37` → `_FundMovementsTable.tsx:41,133-145` →
  `_CreateFundMovementModal.tsx:70,85`.
- **Flujos vecinos que también son "gastos bancarios"** (para no confundir alcance):
  (1) movimiento bancario manual tipo `FEE` "Comisión" con `accountId` obligatorio por
  movimiento (`treasury/shared/validators.ts:172-193`, asiento en
  `bank-movements/actions.server.ts:161-249`); (2) comprobante de compra `GASTOS_BANCARIOS`
  (el resumen con IVA, `purchases/features/invoices/shared/validators.ts:31-33`). TSK-718 habla
  del "Tipo de Movimiento", o sea (0) fund-movements. (1) podría reutilizar la misma cuenta
  por defecto como preselección con costo mínimo; se propone como opcional en 1.7.

**Qué significa "cuenta por defecto" acá.** Dos lecturas posibles:

- **(i) Preseleccionar** la cuenta en cada concepto nuevo del modal (el usuario puede
  cambiarla). La línea siempre viaja y se guarda con cuenta; `validateLines`,
  `assertLineAccounts`, el modelo y el asiento **no cambian**. Cero migración sobre
  `fund_movement_lines`.
- **(ii) Permitir conceptos sin cuenta** que caen a la global al confirmar. Requiere
  `FundMovementLine.accountId` nullable (migración sobre una tabla con datos), relajar
  `validateLines` y el `superRefine`, un `resolveBankChargeLineAccount` en `confirmFundMovement`
  con `BusinessError` "El concepto «X» no tiene cuenta y no hay cuenta de gastos bancarios por
  defecto…", y el borrador pierde la trazabilidad de "qué cuenta eligió el usuario" (el
  concepto se imputa recién al confirmar, con la global **de ese momento**).

**Recomendación: (i) preselección + aviso**, con el mismo criterio de TSK-717 de "nunca imputar
en silencio": el modal muestra debajo de la tabla de conceptos un aviso neutro "Los conceptos
nuevos se imputan a **1.x.x - Gastos bancarios** (por defecto); podés cambiar la cuenta en cada
fila", o naranja informativo "No hay cuenta de gastos bancarios por defecto: elegí la cuenta en
cada concepto (o configurala en Ajustes contables)" — sin bloquear, porque hoy ya se opera sin
ella. La (ii) queda como pregunta abierta 1.7-1: agrega una migración de datos y complejidad que
no está pedida en 718 ("se debe configurar la cuenta desde configuración contable", no "poder
dejar el concepto sin cuenta").

Nuevo campo: **`AccountingSettings.bankChargesAccountId String? @db.Uuid`** +
`bankChargesAccount Account? @relation("BankChargesAccount")` + inversa
`settingsAsBankCharges AccountingSettings[]` en `Account`. Tipo del combo: **`['EXPENSE']`**
(es la cuenta por defecto de un *gasto*; los conceptos que son activo —Sircreb— se eligen a
mano, como hoy). Ubicación en el form: la sección **"Cuentas de Tesorería (Opcional)"**
(`_CommercialIntegrationForm.tsx:115-130`), junto a caja y banco por defecto, con label
"Gastos bancarios por defecto" y ayuda "Se preselecciona en cada concepto de un movimiento
'Gastos e impuestos bancarios'. Podés cambiarla concepto por concepto".

#### 1.2.5 Consumidores de las globales fuera del asiento

`grep -rn "salesAccountId|purchasesAccountId|salesAccount\b|purchasesAccount\b"` fuera de
`src/generated`:

| Consumidor | Archivo | ¿Rompe con `null`? |
|---|---|---|
| Asiento de venta/compra | `integrations/commercial/index.ts:311,339,486,504` | **Sí, en silencio**: `return null` → factura sin asiento (1.2.1). Es lo que hay que arreglar. |
| `getSalesDefaultAccountType` (TSK-583) | `sales/features/invoices/list/actions.server.ts:620-628` | No: `settings?.salesAccount?.type ?? null`. |
| `getPurchasesDefaultAccount` (TSK-583/618) | `purchases/features/invoices/list/actions.server.ts:601-615` | No: `?? null` / `?? false`. |
| Pre-chequeo de centro de costo en `confirmInvoice` / `confirmPurchaseInvoice` | `sales/...:891,934`; `purchases/...:1271,1312` | No: `effectiveAccountType(itemType, settings.salesAccount?.type)` devuelve `null` → `allowsCostCenter(null)` = no exige. Coherente: una línea sin ninguna cuenta no puede exigir reparto; pero con la pre-validación nueva esa línea ya no llega a confirmarse. |
| `effectiveAccountType` / `effectiveIsFixedAsset` | `commercial/shared/cost-center.ts:37-42`, `fixed-asset.ts:30-35` | No, funciones puras con `?? null`. Sus comentarios describen el fallback y habrá que actualizarlos. |
| Formularios de factura (`_LineCostCenterField` de venta y compra) | `_PurchaseInvoiceForm.tsx:96-119` y equivalente en `_InvoiceForm.tsx` | No: reciben `defaultAccountType: string | null`. |
| Settings (form, page, validators, action) | 1.2.2 | No: ya nullish. |
| Tests de integración | `cost-center.integration.test.ts:128-161`, `perceptions.integration.test.ts:115-157`, `purchase-invoice-tributes.integration.test.ts:106` | No rompen (siempre configuran la global). Faltan casos "sin global" (1.3). |
| Reportes contables (`accounting/features/reports`), exportaciones fiscales (SIRE, Libro IVA), presupuestos, `model-chart-of-accounts.ts`, seeds `rbac-init` | — | **No la leen** (`grep` sin resultados). Los reportes agrupan por `Account`, así que el desglose por cuenta de ítem aparece solo. |
| Docs | `docs/modules/accounting.md:190-191`, `docs/architecture/data-model.md:211-212,455` | Texto a actualizar: "Sobrescribe `purchasesAccountId`" ya describe el fallback; falta decir que la global es opcional. |

Conclusión: **ningún consumidor se rompe con la global en `null` salvo el propio asiento**, y ese
hoy ya se comporta mal (silencio). No hay reporte ni export que dependa de ella.

#### 1.2.6 Alternativas comparadas y recomendación

**A) Solo semántica + resolución explícita.** Renombrar labels/ayudas a "por defecto"; dejar las
globales opcionales (ya lo son en Zod); en el asiento reemplazar el `if (!settings.salesAccountId)
return null` por un `resolveLineAccount(line, settings)` que devuelve la cuenta del ítem o la
global y **lanza un error que nombra la línea** cuando no hay ninguna; y, sobre todo,
**pre-validar en `confirmInvoice` / `confirmPurchaseInvoice` antes de la transacción** (patrón
TSK-644) para que el error llegue al usuario. Para gastos bancarios: campo nuevo + preselección
+ aviso.

- Pros: cubre 724-a/b y 721 literalmente ("la cuenta la determina el ítem"; la global pasa a
  ser respaldo declarado); cubre 718 con un campo aditivo; **cero migración para
  ventas/compras**; arregla de paso el silencio de `return null` (riesgo contable real: facturas
  confirmadas sin asiento); no rompe a ninguna empresa que hoy dependa de la global (sigue
  funcionando igual, solo cambia el texto); reutiliza `findMissingTributeAccounts`/
  `buildMissingTributeAccountsMessage` o un helper hermano en `commercial/shared/`.
- Contras: la clienta no tiene forma de saber si puede vaciar la global (¿cuántos ítems caerían
  en ella?), salvo revisando el listado con el badge "Sin imputar" que además solo marca a los
  que no tienen **ninguna** de las dos cuentas (`columns.tsx:246`).

**B) A + visibilidad de "ítems sin cuenta".** Agregar en el listado de ítems un filtro
"Imputación: sin cuenta de ingresos / sin cuenta de egresos" (facet en `getProductFacetCounts`
+ `where` en `getProducts`), corregir el badge para que marque **cada** cuenta faltante
("Sin ingreso" / "Sin egreso"), y en Configuración contable, debajo de las dos globales, una
línea "N ítems activos de venta sin cuenta de ingresos → ver" / "M ítems de compra sin cuenta de
egresos → ver" con link al listado filtrado (conteo con `prisma.product.count` directo desde
`settings/actions.server.ts`, sin importar del módulo `commercial`, respetando
`.claude/rules/module-communication.md`).

- Pros: convierte "por defecto" en algo verificable: la clienta ve si la global se está usando y
  puede imputar en masa con `_BulkEditModal` (ya existe) hasta llegar a cero; es lo que hace
  falta para que 721 ("si el ítem tiene cuentas… esos son los de asientos") sea operativo y no
  solo declarativo; sin migración (son queries).
- Contras: ~4 archivos más que A (facets, columna, filtro, aviso en settings); el conteo no
  cubre líneas de compra sin ítem (AFIP), que siempre van a la global — el aviso lo debe decir.

**C) Eliminar las globales de ventas/compras (solo cuenta por ítem).**

- Pros: imposible imputar "por error" a la global.
- Contras decisivos: (1) **compras tiene líneas sin ítem** por diseño (`productId String?`,
  formulario "Opcional") y la **importación AFIP** crea comprobantes enteros con líneas
  genéricas (`afip-import.server.ts:319-372`): sin global, ninguno de esos podría confirmarse
  sin que el usuario edite cada línea y le asigne un ítem (que además tendría que existir como
  "gasto genérico" con cuenta); (2) obliga a migración destructiva de dos columnas + dos
  relaciones + `settingsAsSalesAccount`/`settingsAsPurchasesAccount` + validators + tests +
  `getSalesDefaultAccountType`/`getPurchasesDefaultAccount` + toda la lógica de centro de costo
  y bien de uso que hoy mira la cuenta efectiva; (3) contradice el patrón caja/banco/aportes ya
  aprendido por la usuaria ("por defecto = se usa si no hay específica"); (4) rompe a toda
  empresa que hoy factura con ítems sin cuenta. Lo único rescatable de C es el **error
  explícito que nombra la línea**, que A ya incorpora.

**Recomendación: B** (A es el núcleo; la visibilidad de B es lo que hace que "dejar la global
vacía" sea una decisión informada). Precisiones:

1. **Labels/ayudas** (`_CommercialIntegrationForm.tsx:60-71`): "Cuenta de ventas por defecto" —
   "Se usa en las líneas de facturas de venta cuyo ítem no tiene Cuenta de Ingresos propia. Si
   todos los ítems de venta tienen la suya, puede quedar sin asignar." / "Cuenta de compras por
   defecto" — "Se usa en las líneas de facturas de compra cuyo ítem no tiene Cuenta de Egresos
   propia y en las líneas sin ítem (gastos no inventariables, comprobantes importados de AFIP).
   Si cargás compras sin ítem, tiene que estar asignada." Mover ambas de "Cuentas de Resultado"
   a una sección "Cuentas por defecto de ventas y compras" o dejar la sección y cambiar su
   descripción; decisión de diseño, no de análisis.
2. **Helper puro compartido** en `src/modules/commercial/shared/` (hermano de `cost-center.ts` y
   `perceptions.ts`): `findLinesMissingAccount(lines: { description, itemAccountId, defaultAccountId }[])`
   + `buildMissingLineAccountsMessage(missing, kind: 'income' | 'expense')` con texto tipo:
   "No se puede confirmar el comprobante: las líneas «Aceite 10W40», «Filtro» no tienen cuenta
   contable. Asignale una Cuenta de Ingresos al ítem (Ítems → Imputación) o configurá la 'Cuenta
   de ventas por defecto' en Contabilidad → Configuración." Con test unitario (Vitest) como
   `perceptions.test.ts`.
3. **Pre-validación** en `confirmInvoice` (`sales/.../actions.server.ts:842-947`) y
   `confirmPurchaseInvoice` (`purchases/.../actions.server.ts:1220-1318`), al lado del chequeo de
   tributos (`:900-926` / `:1274-1304`), antes de `prisma.$transaction`. Los `include` ya traen
   `product.defaultIncomeAccount { type }` / `defaultExpenseAccount { type }`
   (`:860-871`, `:1232-1243`): sumar `id`, o mejor, verificar imputabilidad con una query
   `account.findMany({ where: { ...buildImputableAccountsWhere({ companyId }), id: { in } } })`
   (patrón `resolvePartnerCapitalAccount`, `fund-movements/list/actions.server.ts:291-305`, y
   `assertLineAccounts` `:603-614`). Una cuenta de ítem **no imputable** → error que nombra el
   ítem y la cuenta; **nunca** caer a la global en silencio (mismo principio que TSK-717 punto 3).
4. **Asiento** (`integrations/commercial/index.ts`): `resolveLineAccount` reemplaza el `||` de
   `:339`/`:504`; el guard de `:311-316`/`:486-491` pasa a exigir **solo** `receivablesAccountId`
   / `payablesAccountId` y a **lanzar** (no `return null`) con mensaje claro. Aunque el llamador
   lo degrade a `warn`, la pre-validación del punto 3 ya lo impidió; el `throw` queda como
   defensa en profundidad y para los tests de integración que llaman la función directo.
   Considerar además ampliar la condición de re-lanzado del `catch`
   (`sales/...:1092`, `purchases/...:1447`) para que "cuentas no configuradas" también llegue al
   usuario — decisión de diseño (riesgo 1.6-2).
5. **Gastos bancarios**: `bankChargesAccountId` (1.2.4) en schema + migración aditiva +
   validators + form (sección Tesorería) + `saveAccountingSettings` + `AccountingSettings.tsx`;
   `getFundMovementCatalogs` devuelve `defaultBankChargesAccount`; `_FundMovementLinesField`
   recibe `defaultAccountId` y lo usa en `append` (`:51`); aviso debajo de la tabla (componente
   chico, patrón `_PartnerAccountNotice.tsx`). Si la cuenta por defecto dejó de ser imputable,
   `getFundMovementLineAccounts` no la ofrece y la preselección debe omitirse (verificar que el
   id esté en `lineAccounts` antes de preseleccionar).
6. **Visibilidad (B)**: filtro y facet "imputación" en ítems; badge por cuenta; aviso con conteo
   y link en settings. La cuenta se cuenta por `usage` (`PURCHASE`/`SALE`/`PURCHASE_SALE`,
   `schema.prisma:2231`): ítems solo de compra sin cuenta de ingresos **no** son un problema.

### 1.3 Archivos involucrados

**A crear**

- `prisma/migrations/<timestamp>_tsk_718_bank_charges_account/migration.sql` — `ALTER TABLE
  accounting_settings ADD COLUMN bank_charges_account_id UUID` + FK `ON DELETE SET NULL` (molde
  `20260903183104_tsk_644_percepciones_impuestos_internos/migration.sql`).
- `src/modules/commercial/shared/line-accounts.ts` (+ `line-accounts.test.ts`) —
  `resolveLineAccount`, `findLinesMissingAccount`, `buildMissingLineAccountsMessage` (puros;
  molde `perceptions.ts:179-193` y `cost-center.ts`).
- `src/modules/commercial/features/treasury/features/fund-movements/list/components/_BankChargesDefaultNotice.tsx`
  — aviso de cuenta por defecto de conceptos (molde `_PartnerAccountNotice.tsx`).
- `src/modules/accounting/features/integrations/commercial/line-accounts.integration.test.ts` —
  casos: venta con ítem con cuenta y global vacía → asiento a la cuenta del ítem; venta con ítem
  sin cuenta y sin global → error nombrando el ítem (vía `confirmInvoice`); compra con línea sin
  ítem y global → global; compra con línea sin ítem y sin global → error nombrando la línea;
  ítem con cuenta no imputable → error nombrando ítem y cuenta; NC de venta invierte lados con
  la cuenta del ítem. Molde `cost-center.integration.test.ts:1-60` (`describe.skipIf` sin
  `DATABASE_URL`, prefijo `TSK721-TEST-`, limpieza en `afterAll`).
- `docs/presentaciones/TSK-721-cuentas-por-defecto.pdf` (memoria
  `guia-presentacion-cliente-por-ticket.md`; scripts en `scripts/guia-presentacion/`, entorno
  según `dev-local-capturas-y-login.md`).

**A modificar**

- `prisma/schema.prisma:508-640` (`AccountingSettings`: `bankChargesAccountId` + relación) y
  `:296-377` (`Account`: inversa `settingsAsBankCharges`).
- `src/modules/accounting/features/settings/validators.ts:18-59` (`bankChargesAccountId:
  accountField`) y `validators.test.ts:35-71` (caso nuevo).
- `src/modules/accounting/features/settings/actions.server.ts:33-75` (firma de
  `saveAccountingSettings`).
- `src/modules/accounting/features/settings/AccountingSettings.tsx:70-121` (`defaultValues`;
  aviso con conteo de ítems sin cuenta, alternativa B) y `actions.server.ts` (nueva
  `getItemsWithoutAccountCounts()` con `prisma.product.count`, permiso `accounting.settings`
  `view`).
- `src/modules/accounting/features/settings/components/_CommercialIntegrationForm.tsx:56-76`
  (labels/ayudas de ventas y compras), `:115-130` (campo `bankChargesAccountId` en Tesorería).
- `src/modules/accounting/features/integrations/commercial/index.ts:73-97` (`include`
  `bankChargesAccount` **no** hace falta: el asiento de fondos vive en otro módulo), `:282-301`
  y `:457-476` (`select` de `product`), `:311-316` y `:486-491` (guard: solo
  receivables/payables, `throw`), `:339` y `:504` (`resolveLineAccount`); encabezado `:1-28`
  (esquema de asientos: "Haber: cuenta del ítem o Ventas por defecto").
- `src/modules/commercial/features/sales/features/invoices/list/actions.server.ts:842-947`
  (`confirmInvoice`: pre-validación de cuentas de línea; `select` de settings `:883-898` suma
  `salesAccountId`) y `:608-628` (comentario de `getSalesDefaultAccountType`).
- `src/modules/commercial/features/purchases/features/invoices/list/actions.server.ts:1220-1318`
  (`confirmPurchaseInvoice`: ídem, con líneas sin ítem) y `:583-615` (comentario).
- `src/modules/commercial/shared/cost-center.ts:25-42` y `fixed-asset.ts:14-35` (comentarios que
  describen el fallback: ahora nombran la "cuenta por defecto" y el error explícito).
- `src/modules/commercial/features/products/features/list/actions.server.ts:28-77`
  (`getProducts`: filtro `imputation`), `:158-181` (`getProductFacetCounts`: conteos sin
  ingreso/egreso), `list/columns.tsx:237-273` (badge por cuenta faltante) y
  `components/_ProductsTable.tsx` (filtro en la toolbar) — alternativa B.
- `src/modules/commercial/features/treasury/features/fund-movements/list/actions.server.ts:122-164`
  (`getFundMovementCatalogs`: `defaultBankChargesAccount`), `:181-201` (sin cambios salvo
  devolver `type` si el aviso lo necesita).
- `.../fund-movements/list/FundMovementsList.tsx:12-37`, `components/_FundMovementsTable.tsx:41-52,133-145`,
  `components/_CreateFundMovementModal.tsx:70-85,455` (prop nueva hasta el campo de líneas),
  `components/_FundMovementLinesField.tsx:15-18,51` (`defaultAccountId` en `append` + aviso).
- `.../fund-movements/list/fund-movement-lines.integration.test.ts:297-355` (caso nuevo: el
  concepto guardado con la cuenta preseleccionada se asienta igual que uno elegido a mano — o
  constatar que no cambia nada en el servidor y dejarlo en el test de validators).
- `src/modules/help/features/guide/components/_AccountingGuide.tsx:205-245` (lista de cuentas
  de Integración Comercial: "Cuenta de ventas / compras **por defecto**" con la explicación de
  cuándo se usan; nueva viñeta "Gastos bancarios por defecto").
- `src/modules/help/features/guide/components/_CommercialGuide.tsx:140-158` (ítems: "en lugar
  de la cuenta de compras general" → "…de la cuenta de compras por defecto; si el ítem no tiene
  cuenta y no hay por defecto, la factura no se puede confirmar y el sistema nombra el ítem") y
  la sección de facturación (mensaje de error nuevo).
- `src/modules/help/features/guide/components/_TreasuryGuide.tsx:875-915` (Gastos e impuestos
  bancarios: "la cuenta viene preseleccionada con la de Ajustes contables; podés cambiarla").
- `docs/modules/accounting.md:185-195` (tabla de cuentas: "por defecto" + `bankChargesAccountId`),
  `docs/architecture/data-model.md:211-212,455` (fallback y campo nuevo).

**Solo lectura (referencia de patrón)**

- `src/modules/commercial/shared/perceptions.ts:170-193` (pre-validación TSK-644).
- `src/modules/commercial/features/treasury/features/fund-movements/list/actions.server.ts:262-313`
  (`resolvePartnerCapitalAccount`), `:603-614` (`assertLineAccounts`).
- `src/shared/lib/accounts/imputable-accounts.ts:33-46`.
- `src/modules/commercial/features/products/shared/account-filters.ts:22-31`.
- `src/modules/commercial/features/purchases/features/invoices/list/lib/afip-import.server.ts:298-372`.
- `.planes/tsk-717-cuenta-contable-por-socio.md` §1.2.7, §3.3.9.

### 1.4 Dependencias

- **Prisma 7 + una migración aditiva** (`bank_charges_account_id`): `npm run db:migrate` local,
  `docker-entrypoint.sh` en producción (memoria `produccion-dokploy-scripts-db.md`). Ventas y
  compras **no** requieren migración.
- **Helpers existentes sin cambios**: `buildImputableAccountsWhere` (`shared/lib/accounts`),
  `AccountCombobox` (`shared/components/common`), `filterExpenseAccounts`
  (`products/shared/account-filters.ts`, ya importado por fund-movements).
- **Regla "NO importar entre módulos"**: el helper de líneas sin cuenta va en
  `src/modules/commercial/shared/` porque lo usan `sales`, `purchases` (mismo módulo) y
  `accounting/integrations/commercial/index.ts`, que **ya importa** de `commercial/shared`
  (`voucher-utils`, `cost-center`, `perceptions`, `index.ts:35-37`) — desvío preexistente y
  aceptado en ese archivo. El conteo de ítems desde `accounting/settings` se hace con Prisma
  directo, no importando de `commercial`.
- **Regla 11 (permisos)**: nuevas actions con `checkPermission` (`accounting.settings` `view`
  para el conteo; `commercial.treasury.fund-movements` ya cubre catálogos).
- **Datos de la clienta**: para que "por defecto" tenga efecto tiene que imputar sus ítems
  (`_BulkEditModal` / `_ImputationModal`). No hay nada que migrar.

### 1.5 Restricciones y reglas

- Errores esperables por el usuario en `confirmInvoice`/`confirmPurchaseInvoice` se lanzan
  **antes** de la transacción (patrón TSK-644), porque dentro del `catch` de `:1091-1099` /
  `:1446-1454` se pierden. En fund-movements, `BusinessError` → `{ success: false, error }`
  (`actions.server.ts:30-62`).
- `logger`, no `console`; `moment`; `AlertDialog`; Decimales a `Number()` (los conteos son
  enteros; sin decimales nuevos).
- Componentes < 200 líneas: `_CommercialIntegrationForm.tsx` tiene 376 (deuda previa; solo se
  tocan constantes de `SECTIONS`); `_CreateFundMovementModal.tsx` 533 (ídem: el aviso va en
  componente aparte); `_FundMovementLinesField.tsx` 121 (+~15 OK).
- Tests con **Vitest** (`npm run test`), no Cypress (memoria
  `testing-real-es-vitest-no-cypress.md`).
- Guía in-app (regla 10) + `docs/` (regla 8) + **PDF de presentación** (memoria).
- No hay módulo nuevo: nada que registrar en `ACTIVATABLE_MODULES` (`.claude/rules/modules.md`).
- `PermissionGuard`/`hasPermission` ya existen en las pantallas tocadas; los links a
  "Ítems → Imputación" desde settings deben respetar `commercial.products` `view` (mostrar el
  conteo sin link si no tiene permiso).

### 1.6 Riesgos identificados

1. **Cambio de comportamiento: facturas que hoy se confirman "en silencio" van a bloquearse.**
   Una empresa sin global y con ítems sin cuenta hoy confirma sin asiento; con la
   pre-validación, no confirma hasta imputar. Es lo correcto contablemente, pero hay que
   anunciarlo en la presentación y dar el camino (imputación masiva). Mitigación: el mensaje
   nombra las líneas y dice dónde arreglarlo; la alternativa B muestra el conteo antes de que
   pase.
2. **Facturas ya confirmadas sin asiento** por el `return null` histórico. No es alcance
   corregirlas, pero conviene detectarlas: `SELECT count(*) FROM sales_invoices WHERE status =
   'CONFIRMED' AND journal_entry_id IS NULL` (ídem `purchase_invoices`). Si hay, ofrecer a la
   clienta un listado; regenerar asientos es otro ticket.
3. **Cuenta del ítem no imputable en el momento de confirmar** (con hijas, dada de baja, corte
   de ejercicio): hoy se usa igual. La validación nueva la rechaza nombrando ítem y cuenta; el
   combo del ítem preserva la cuenta guardada solo si se le agrega `includeIds` (hoy
   `getAccountsForProductSelect` no lo hace, `catalog-actions.server.ts:12-16`): al editar un
   ítem con cuenta dada de baja el combo se vería vacío. Alcance chico; evaluar en diseño.
4. **Líneas de compra sin ítem** (manuales y AFIP): siguen dependiendo de la global. Si la
   clienta vacía "Cuenta de compras por defecto" y luego importa AFIP, no podrá confirmar nada
   hasta volver a configurarla; la ayuda del campo y la guía tienen que decirlo explícitamente.
5. **Regresión de tests de integración existentes**: `cost-center.integration.test.ts` y
   `perceptions.integration.test.ts` llaman `createJournalEntryForSalesInvoice` **directo** con
   ítems con cuenta y global configurada — no deberían romper, pero si el guard pasa a lanzar
   por `receivablesAccountId` faltante hay que revisar el `beforeAll` (`:128-161`).
6. **Preselección en gastos bancarios con cuenta por defecto no imputable**: si
   `bankChargesAccountId` apunta a una cuenta que ya no está en `lineAccounts`, `append` con ese
   id dejaría el combo "vacío" y `assertLineAccounts` lo rechazaría con el mensaje genérico
   (`:611-613`). Mitigación: preseleccionar solo si el id está en `lineAccounts`; aviso "la
   cuenta por defecto no está disponible".
7. **Asientos generados nacen en `DRAFT`** (transversal, ya señalado en TSK-717 §1.6-5): el mayor
   muestra el desglose por cuenta de ítem cuando el contador registra los asientos. Decirlo en
   la presentación.
8. **Percepción de "ya funcionaba así"**: como el asiento ya priorizaba el ítem, la clienta puede
   pensar que no cambió nada. La presentación debe mostrar el antes/después del texto de
   configuración, el error nuevo con nombre de ítem, y el conteo de ítems sin cuenta.

### 1.7 Preguntas abiertas

Solo las que cambian el diseño:

1. **Gastos bancarios: ¿solo preselección (i) o también conceptos sin cuenta con fallback al
   confirmar (ii)?** Propuesta: **(i)**, porque cumple 718 sin migrar `fund_movement_lines` ni
   relajar `validateLines`/`assertLineAccounts`, y mantiene la trazabilidad de la cuenta elegida
   en el borrador. Si se quiere (ii), suma: columna nullable, `resolveBankChargeLineAccount` en
   `confirmFundMovement:875-901`, cambios en `lines-calc.ts:34-51` y `validators.ts:189-196`, y
   un caso más en el test de integración.
2. **¿Ampliar el re-lanzado del `catch` de `confirmInvoice`/`confirmPurchaseInvoice`
   (`:1092`, `:1447`) para que cualquier fallo del asiento bloquee la confirmación?** Hoy solo
   "período está cerrado" llega al usuario. Con la pre-validación no debería hacer falta, pero
   mientras exista el `catch` una factura puede quedar confirmada sin asiento por otro motivo
   (p. ej. IVA sin cuenta para una alícuota, `index.ts:369-376` hace `continue` y descuadra).
   Propuesta: dejarlo para un ticket aparte y anotarlo en riesgos; no bloquea este diseño.
3. **¿La cuenta por defecto de gastos bancarios se reutiliza como preselección en el movimiento
   bancario manual tipo `FEE` "Comisión"?** (`treasury/shared/validators.ts:174,278`). Costo
   mínimo y coherente, pero 718 no lo pide. Propuesta: no, salvo que la clienta lo use.
4. **¿`Supplier.defaultAccountId` (hoy sin uso en asientos, `schema.prisma:2147`) debería entrar
   como segundo nivel del fallback en compras (ítem → proveedor → global) para las líneas sin
   ítem, típicamente las de AFIP?** Resolvería el caso "importo el resumen de Edenor y quiero que
   vaya a Energía eléctrica, no a Compras". No está pedido en 721/724; propuesta: **no en este
   ticket**, dejarlo anotado como mejora natural para la importación AFIP.

No hay otras preguntas que cambien el diseño: conservar las globales como respaldo (A/B sobre C),
pre-validar antes de la transacción, nombrar el ítem/línea en el error, y el campo aditivo para
gastos bancarios están fundamentados en 1.2.

---

## 2. Planificación

Ocho fases que implementan la **alternativa B** del análisis (1.2.6) con las decisiones ya
tomadas por el usuario: las globales de ventas y compras pasan a llamarse y explicarse como
"**por defecto**" (la de ventas puede quedar vacía; la de compras se mantiene porque las
líneas sin ítem —formulario y AFIP— no tienen otra cuenta posible); un **helper puro** en
`commercial/shared/line-accounts.ts` resuelve la cuenta efectiva de cada línea (ítem → global) y
se usa para **pre-validar antes de la transacción** en `confirmInvoice` y
`confirmPurchaseInvoice` (patrón `findMissingTributeAccounts` de TSK-644), con un error que
**nombra la línea** sin cuenta; en la misma pre-validación se verifica que las cuentas
efectivas sean **imputables** (`buildImputableAccountsWhere`), sin caer a la global en silencio;
el guard del asiento (`integrations/commercial/index.ts:311-316` y `:486-491`) pasa a **lanzar**
y el `catch` de ambos confirm pasa a **relanzar cualquier fallo del asiento**; gastos bancarios
gana `AccountingSettings.bankChargesAccountId` (EXPENSE, migración aditiva) que el modal
**preselecciona** en cada concepto nuevo con un aviso tipo `_PartnerAccountNotice`;
`FundMovementLine.accountId` sigue NOT NULL; el listado de ítems gana filtro/facet y badge por
cuenta faltante y la configuración contable muestra el conteo con link; y un script de **solo
lectura** lista las facturas confirmadas sin asiento (las que cayeron en el bug histórico), con
su SQL para correrlo con `psql` en producción. El orden va del dato hacia la superficie: primero
el esquema, después la lógica pura y la confirmación (que es donde vive el riesgo contable),
después la preselección de gastos bancarios y la visibilidad, y al final diagnóstico,
documentación y verificación.

Decisiones tomadas en esta planificación, donde el usuario dejó margen:

- **La sección "Cuentas de Resultado" del formulario se mantiene con ese título y sin
  descripción de sección**: contiene también `expensesAccountId` ("Cuenta de Gastos
  Operativos"), que el módulo de Gastos usa **siempre**, no como respaldo; una descripción "por
  defecto" a nivel sección sería falsa para ese campo. La semántica va en el label y la ayuda de
  cada uno de los dos campos (fase 1).
- **El aviso de conceptos de gastos bancarios vive dentro de `_FundMovementLinesField`**, no en
  el modal: el campo ya conoce `accounts` (para saber si la cuenta por defecto está disponible)
  y es donde se hace el `append`; el modal (533 líneas, deuda previa) solo le pasa una prop
  más. La decisión de "preseleccionar o no" es una función pura `pickDefaultLineAccount` en
  `shared/lines-calc.ts`, testeable sin base (fase 4).
- **El conteo de ítems sin cuenta en Ajustes contables es un Server Component
  (`ItemsWithoutAccountNotice.tsx`, sin `_`) que se renderiza dentro de la card "Integración
  Comercial", arriba del formulario**: `SECTIONS` es una constante de módulo del Client
  Component y no puede recibir datos del servidor sin una prop ad hoc. Cuenta solo ítems
  `status: 'ACTIVE'` y por `usage` (`SALE`/`PURCHASE_SALE` para ingreso, `PURCHASE`/
  `PURCHASE_SALE` para egreso): un ítem solo de compra sin cuenta de ingreso no es un problema.
  El link "Ver" solo se muestra con permiso `commercial.products` `view` (`PermissionGuard`
  sin redirect, `fallback` = texto plano) (fase 5).
- **Los `continue` de IVA sin cuenta del asiento (`index.ts:369-376` y `:534-541`) pasan a
  `throw` con `buildMissingTributeAccountsMessage(['IVA Débito Fiscal 21%'])`**. Con el `catch`
  relanzando todo, el asiento descuadrado ya iba a bloquear la confirmación, pero con el mensaje
  genérico de `validateBalance` ("El asiento no está balanceado. Debe: X, Haber: Y"), que no
  dice qué falta. Es un cambio de dos líneas en el mismo archivo que se toca (fase 3).
- **`createJournalEntryForSalesInvoice`/`ForPurchaseInvoice` pasan a `Promise<string>`** (ya
  no devuelven `null`): así el `if (journalEntryId)` de los llamadores desaparece y el tipo dice
  la verdad. `createJournalEntryForCogs` (`:1155`) no cambia (fase 3).
- **Los tests de integración nuevos van al lado de los server actions que ejercitan**
  (`sales/…/list/sales-invoice-line-accounts.integration.test.ts` y
  `purchases/…/list/purchase-invoice-line-accounts.integration.test.ts`), con los cuatro
  `vi.mock` de TSK-644, y no en `accounting/integrations/commercial/` como sugería 1.3: la
  pre-validación vive en el confirm, y el molde de `cost-center.integration.test.ts:413-432`
  documenta por qué replicar la consulta en vez de llamar al action deja un test que no
  protege nada. Los casos que llaman al asiento directo (guard, NC) se incluyen en los mismos
  archivos (fase 3).
- **La verificación de imputabilidad usa la fecha de hoy** (`buildImputableAccountsWhere`
  sin `atDate`), igual que `assertLineAccounts` de fondos y `getActiveAccounts` de settings:
  los combos muestran lo imputable hoy, y el error tiene que coincidir con lo que el usuario
  ve en pantalla (fase 3).
- **Facet de imputación con dos valores excluyentes en la UI pero combinables en el `where`**:
  `noIncome` ("Sin cuenta de ingreso") y `noExpense` ("Sin cuenta de egreso"); si llegan los
  dos por URL se aplica `OR`. Los conteos del facet **no** filtran por `status` (coherente con
  los facets `type`/`status` existentes); el link desde settings agrega `&status=ACTIVE` (fase
  5).
- **El script de diagnóstico considera "confirmada" a toda factura con `status NOT IN
  ('DRAFT','CANCELLED')`** (`CONFIRMED`, `PAID`, `PARTIAL_PAID`): una factura cobrada sin
  asiento también cayó en el bug (fase 6).

Testing: **Vitest** (`npm run test` → `vitest run`, `vitest.config.ts` incluye
`src/**/*.test.ts`; memoria `testing-real-es-vitest-no-cypress`). No se pueden testear
componentes `.tsx`; el TDD se aplica a los validators de settings (fase 1), al helper puro
`line-accounts.ts` (fase 2), a la cadena real `confirmInvoice`/`confirmPurchaseInvoice` contra
la base de dev con los `vi.mock` de `purchase-invoice-tributes.integration.test.ts:28-33`
(fase 3), a `pickDefaultLineAccount` y `getFundMovementCatalogs` (fase 4) y a
`getProductFacetCounts`/`getProducts` con el filtro nuevo (fase 5). En esas fases el test se
escribe **antes** del código. Línea base de `npm run check-types`: **219** errores
preexistentes.

### 2.1 Fases de implementación

#### Fase 1: Esquema, migración y configuración contable (TDD en validators)

- **Objetivo:** que `AccountingSettings` tenga la cuenta de gastos bancarios por defecto, con
  una migración que solo agrega una columna nullable y su FK; que el formulario de Ajustes
  contables la ofrezca en "Cuentas de Tesorería (Opcional)"; y que las dos globales de ventas
  y compras se llamen y expliquen como "por defecto". Sin cambios de comportamiento todavía.
- **Tareas:**
  - [x] `prisma/schema.prisma:526` (`model AccountingSettings`, después de
        `defaultBankAccountId`): agregar
        `bankChargesAccountId String? @map("bank_charges_account_id") @db.Uuid // TSK-718: cuenta
        de gastos por defecto para los conceptos de "Gastos e impuestos bancarios"`. En el
        bloque de relaciones, después de `defaultBankAccount` (`:557`), agregar
        `bankChargesAccount Account? @relation("BankChargesAccount", fields:
        [bankChargesAccountId], references: [id])` (sin `onDelete` explícito = `SetNull`, como
        todas las relaciones de este modelo).
  - [x] `prisma/schema.prisma:337` (`model Account`, después de `settingsAsDefaultBankAccount`):
        agregar la inversa `settingsAsBankCharges AccountingSettings[]
        @relation("BankChargesAccount")`.
  - [x] Correr `npm run db:migrate -- --name tsk_718_bank_charges_account`. Verificar que el SQL
        generado en `prisma/migrations/<timestamp>_tsk_718_bank_charges_account/migration.sql`
        sea exactamente `ALTER TABLE "accounting_settings" ADD COLUMN "bank_charges_account_id"
        UUID;` + `ADD CONSTRAINT "accounting_settings_bank_charges_account_id_fkey" FOREIGN KEY
        ("bank_charges_account_id") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE
        CASCADE;` (mismo formato que
        `20260903183104_tsk_644_percepciones_impuestos_internos/migration.sql`). **Sin
        `UPDATE`, sin backfill.** Si `migrate dev` detecta drift ajeno, no resetear: revisar
        antes con `npx prisma migrate status`.
  - [x] `npm run db:generate`. `npm run check-types` debe **fallar en un solo lugar nuevo**:
        `AccountingSettings.tsx:76-108` (`defaultValues` tipado con `FormValues` = `z.output`,
        `_CommercialIntegrationForm.tsx:244-249`) recién cuando se agregue el campo al schema Zod
        del paso siguiente. Es la garantía de compilación que TSK-492 dejó: el campo nuevo **no
        puede** olvidarse en `defaultValues` porque no compila. En runtime, además,
        `accountField` es `nullish` (`validators.ts:12-15`), así que un `undefined` tampoco
        rompería el guardado. Confirmado: no hay nada más que hacer por TSK-483/492.
  - [x] **Validators (TDD).** `src/modules/accounting/features/settings/validators.test.ts`:
        cambiar `'cubre las 30 cuentas configurables'` (`:76-81`) a **31** con el comentario
        `// + gastos bancarios por defecto (TSK-718)`, y agregar en `describe(
        'commercialIntegrationSchema')` el caso `'guarda la cuenta de gastos bancarios por
        defecto y la limpia con __clear__'` (parse con `bankChargesAccountId: CUENTA` →
        `CUENTA`; con `'__clear__'` → `null`; ausente → `null`). Rojo primero.
  - [x] `settings/validators.ts:26` (después de `defaultBankAccountId`): agregar
        `bankChargesAccountId: accountField, // TSK-718`. Verde.
  - [x] `settings/actions.server.ts:46` (firma de `saveAccountingSettings`, después de
        `defaultBankAccountId`): agregar `bankChargesAccountId?: string | null;`. El `upsert`
        (`:90-97`) hace spread de `input`, no requiere más cambios.
  - [x] `settings/AccountingSettings.tsx:84` (después de `defaultBankAccountId`): agregar
        `bankChargesAccountId: settings?.bankChargesAccountId ?? null,`. `configuredAccountIds`
        (`:14-18`) toma toda clave que termina en `AccountId`, así que la cuenta guardada se
        preserva en el combo (`includeIds`) sin tocar nada más.
  - [x] `settings/components/_CommercialIntegrationForm.tsx:60-71`: cambiar los dos campos a
        `label: 'Cuenta de ventas por defecto'`, `help: 'Se usa en las líneas de facturas de
        venta cuyo ítem no tiene Cuenta de Ingresos propia (Ítems → Imputación contable). Si
        todos los ítems de venta tienen la suya, puede quedar sin asignar.'` y `label: 'Cuenta
        de compras por defecto'`, `help: 'Se usa en las líneas de facturas de compra cuyo ítem
        no tiene Cuenta de Egresos propia y en las líneas sin ítem (gastos no inventariables,
        comprobantes importados de AFIP). Si cargás compras sin ítem, tiene que estar
        asignada.'`. Mantener `name`, `types` y la sección.
  - [x] Mismo archivo, sección "Cuentas de Tesorería (Opcional)" (`:115-130`), después de
        `defaultBankAccountId` (`:128`): agregar `{ name: 'bankChargesAccountId', label: 'Gastos
        bancarios por defecto', types: ['EXPENSE'], help: 'Se preselecciona en cada concepto de
        un movimiento "Gastos e impuestos bancarios". Podés cambiarla concepto por concepto; los
        conceptos que son activo (Sircreb) se eligen a mano.' }`. `FieldName` (`:27`) se actualiza
        solo por inferencia del schema.
  - [x] Anotar en la sección 4 del documento que en producción la migración la aplica solo el
        `docker-entrypoint.sh` al deployar (memoria `produccion-dokploy-scripts-db`); no hay
        script manual que correr.
- **Archivos:**
  - Crear: `prisma/migrations/<timestamp>_tsk_718_bank_charges_account/migration.sql`
  - Modificar: `prisma/schema.prisma`, `src/modules/accounting/features/settings/validators.ts`,
    `validators.test.ts`, `actions.server.ts`, `AccountingSettings.tsx`,
    `components/_CommercialIntegrationForm.tsx`
- **Criterio de completitud:** `npx prisma migrate status` en verde; `src/generated/prisma`
  expone `AccountingSettings.bankChargesAccountId`/`bankChargesAccount`; `validators.test.ts`
  en verde (primero rojo por el conteo 31); `check-types` en la línea base (219); en
  `/dashboard/company/accounting/settings` los dos campos muestran los textos nuevos, el campo
  "Gastos bancarios por defecto" aparece en Tesorería y ofrece solo cuentas EXPENSE, guarda y
  limpia; las facturas se siguen confirmando igual que antes (todavía no cambió el asiento).

#### Fase 2: Helper puro de cuentas de línea (TDD unitario)

- **Objetivo:** una única regla, sin base y compartida por ventas, compras y el asiento, que
  dado un conjunto de líneas y la cuenta por defecto diga cuál es la cuenta efectiva de cada
  una, cuáles no tienen ninguna, cuáles tienen una cuenta no disponible, y arme los mensajes
  para el usuario nombrando línea, ítem y cuenta.
- **Tareas:**
  - [ ] Escribir **primero** `src/modules/commercial/shared/line-accounts.test.ts` (Vitest puro,
        estilo `perceptions.test.ts` y `cost-center.test.ts`). Casos:
    - `resolveLineAccount('item', 'global')` → `'item'`; `(null, 'global')` → `'global'`;
      `(undefined, null)` → `null`; `('', 'global')` → `'global'` (cadena vacía cuenta como
      "sin cuenta").
    - `findLinesMissingAccount(lines, defaultId)`: con global, ninguna línea falta aunque los
      ítems no tengan cuenta; sin global, devuelve **solo** las líneas cuyo ítem no tiene
      cuenta (las que sí tienen no aparecen); una línea sin ítem (`productName: null`,
      `itemAccountId: null`) sin global aparece; conserva el orden y el objeto original
      (genérico `T extends LineAccountCheck`, como `findLinesMissingCostCenter`).
    - `buildMissingLineAccountsMessage(missing, 'income')` contiene `No se puede confirmar el
      comprobante`, los nombres entre comillas latinas `«Aceite 10W40», «Filtro»`, `Cuenta de
      Ingresos`, `Ítems → Imputación contable` y `"Cuenta de ventas por defecto"`; con
      `'expense'` dice `Cuenta de Egresos` y `"Cuenta de compras por defecto"`; si alguna línea
      no tiene ítem, agrega la frase `Las líneas sin ítem solo pueden usar la cuenta por
      defecto.`; singular/plural (`la línea` / `las líneas`).
    - `findLinesWithUnavailableAccount(lines, defaultId, availableIds: Set<string>)`: devuelve
      `{ line, accountId, source: 'item' | 'default' }` por cada línea cuya cuenta efectiva no
      está en el set; no devuelve las que no tienen cuenta (esas son del helper anterior).
    - `buildUnavailableLineAccountsMessage(items, 'income')`: nombra la línea y la cuenta
      (`code - name`) y, según `source`, dice `del ítem` + `Corregila en Ítems → Imputación
      contable` o `la "Cuenta de ventas por defecto"` + `Corregila en Contabilidad →
      Configuración`; incluye `no está activa o no es imputable`.
        Debe fallar en rojo porque el módulo no existe.
  - [ ] Crear `src/modules/commercial/shared/line-accounts.ts` (puro, < 120 líneas, sin Prisma ni
        imports de módulos). Exportar:
    - `export type LineAccountKind = 'income' | 'expense'`.
    - `export interface LineAccountCheck { description: string; productName: string | null;
      itemAccountId: string | null | undefined }` (comentario: `productName` `null` = línea sin
      ítem, solo posible en compras).
    - `export function resolveLineAccount(itemAccountId, defaultAccountId): string | null` →
      `itemAccountId || defaultAccountId || null` (con `||` a propósito, para tratar `''` como
      ausente; documentarlo).
    - `export function findLinesMissingAccount<T extends LineAccountCheck>(lines: T[],
      defaultAccountId: string | null | undefined): T[]`.
    - `export function buildMissingLineAccountsMessage(missing: LineAccountCheck[], kind:
      LineAccountKind): string`, con un mapa interno `KIND_LABELS = { income: { itemField:
      'Cuenta de Ingresos', settingLabel: 'Cuenta de ventas por defecto' }, expense: { …
      'Cuenta de Egresos', 'Cuenta de compras por defecto' } }`. Texto: `No se puede confirmar
      el comprobante: ${la línea|las líneas} ${«…», «…»} no ${tiene|tienen} cuenta contable.
      Asignale una ${itemField} al ítem (Ítems → Imputación contable) o configurá la
      "${settingLabel}" en Contabilidad → Configuración.` + (si hay línea sin ítem) ` Las
      líneas sin ítem solo pueden usar la cuenta por defecto.`
    - `export interface UnavailableLineAccount<T> { line: T; accountId: string; source: 'item'
      | 'default' }` y `findLinesWithUnavailableAccount<T extends LineAccountCheck>(lines: T[],
      defaultAccountId, availableIds: Set<string>): UnavailableLineAccount<T>[]`.
    - `export function buildUnavailableLineAccountsMessage(items: Array<{ description: string;
      accountLabel: string; source: 'item' | 'default' }>, kind: LineAccountKind): string` →
      `No se puede confirmar el comprobante: la cuenta ${accountLabel} ${del ítem de la línea
      «X» | configurada como "Cuenta de ventas por defecto"} no está activa o no es imputable.
      Corregila en ${Ítems → Imputación contable | Contabilidad → Configuración}.` (una
      oración por ítem, unidas con espacio; la primera cuenta que falla alcanza para
      bloquear, pero se listan todas).
        Encabezado del archivo con el porqué (TSK-721/724: la cuenta la define el ítem; la
        global es respaldo; nunca imputar en silencio) y referencia a `perceptions.ts:179-193`.
        Test en verde.
  - [ ] `src/modules/commercial/shared/cost-center.ts:25-42` y `fixed-asset.ts:14-35`: actualizar
        los comentarios de `effectiveAccountType`/`effectiveIsFixedAsset`: la cuenta por defecto
        ahora se llama así en pantalla, y una línea sin ninguna cuenta ya **no llega** a
        confirmarse (la pre-validación de `line-accounts.ts` la rechaza antes). Sin cambios de
        código.
- **Archivos:**
  - Crear: `src/modules/commercial/shared/line-accounts.ts`, `line-accounts.test.ts`
  - Modificar: `src/modules/commercial/shared/cost-center.ts`, `fixed-asset.ts` (solo comentarios)
- **Criterio de completitud:** `npm run test` en verde con `line-accounts.test.ts` (primero
  rojo, después verde, mínimo 12 casos); el módulo no importa nada de `@/modules/*` ni de
  Prisma; `check-types` en la línea base.

#### Fase 3: Confirmación de ventas y compras — pre-validación, asiento que lanza, `catch` que relanza (TDD de integración)

- **Objetivo:** que ninguna factura de venta o compra quede confirmada sin asiento: si una
  línea no tiene cuenta resoluble o su cuenta no es imputable, la confirmación se rechaza
  **antes** de la transacción con un mensaje que nombra línea/ítem/cuenta; y si el asiento
  falla por cualquier otro motivo, la transacción se revierte y el error llega al usuario.
- **Tareas:**
  - [ ] **Test de integración de ventas (rojo primero).** Crear
        `src/modules/commercial/features/sales/features/invoices/list/sales-invoice-line-accounts.integration.test.ts`
        con el andamiaje de `purchase-invoice-tributes.integration.test.ts:22-70` (`dotenv/
        config`, los cuatro `vi.mock`, `describe.skipIf(!dbAvailable)`) y prefijo
        `TSK721-SALE-`. `beforeAll`: empresa; cuentas `Ventas` (REVENUE), `Cobrar` (ASSET),
        `IVA DF` (LIABILITY), `Ventas rodados` (REVENUE, para el ítem con cuenta propia) y
        `Ventas vieja` (REVENUE, la que se dará de baja); `AccountingSettings` con
        `receivablesAccountId`, `vatDebitAccountId` y `salesAccountId` = `Ventas`; cliente y
        punto de venta como en `cost-center.integration.test.ts:344-372`; productos con
        **`trackStock: false`** (para que `confirmInvoice` no exija almacén): `conCuenta`
        (`defaultIncomeAccountId: Ventas rodados`), `sinCuenta` (`null`), `cuentaVieja`
        (`defaultIncomeAccountId: Ventas vieja`). Las facturas se crean **directo con
        `prisma.salesInvoice.create`** en `DRAFT` (molde `cost-center.integration.test.ts:
        348-399`; `createInvoice` exige validación AFIP y numeración que no aportan al caso) y
        se confirman con el **`confirmInvoice` real**. Casos:
    - Venta de `conCuenta` con global vacía (`update salesAccountId: null`) → confirma; el
      asiento tiene Haber en `Ventas rodados` y ninguna línea en `Ventas`.
    - Venta de `sinCuenta` con global vacía → `rejects.toThrow(/«.*sinCuenta.*»/)` y el mensaje
      contiene `Cuenta de ventas por defecto`; la factura sigue `DRAFT` con
      `journalEntryId: null`.
    - Venta de `sinCuenta` con global configurada → confirma contra `Ventas` (regresión del
      fallback).
    - Venta de `cuentaVieja` tras `prisma.account.update({ isActive: false })` → rechaza
      nombrando la línea y `Ventas vieja` (`code`); **no** cae a la global (ninguna línea en
      `Ventas`); restaurar `isActive`.
    - NC de venta (`voucherType: 'NOTA_CREDITO_A'`) de `conCuenta` → Debe en `Ventas rodados`,
      Haber en `Cobrar`.
    - Guard del asiento: `prisma.$transaction((tx) => createJournalEntryForSalesInvoice(id,
      companyId, tx))` con `receivablesAccountId: null` → `rejects.toThrow(/Cuentas por
      Cobrar/)` (antes devolvía `null`); restaurar.
        `afterAll`: `salesInvoice → journalEntry → product → customer → pointOfSale →
        accountingSettings → account → company` y `count` por prefijo.
  - [ ] **Test de integración de compras (rojo primero).** Crear
        `purchases/features/invoices/list/purchase-invoice-line-accounts.integration.test.ts`,
        mismo andamiaje, prefijo `TSK721-PURC-`, entrando por **`createPurchaseInvoice` +
        `confirmPurchaseInvoice` reales** (molde `purchase-invoice-tributes.integration.test.ts:
        147-236`; el input del formulario admite líneas sin `productId`). `beforeAll`: cuentas
        `Compras` (EXPENSE), `Pagar`, `IVA CF`, `Repuestos` (EXPENSE, del ítem), `Compras vieja`;
        settings con `payablesAccountId`, `vatCreditAccountId`, `purchasesAccountId: Compras`;
        proveedor; productos `conCuenta`, `sinCuenta`, `cuentaVieja`. Casos:
    - Compra con **línea sin ítem** y global configurada → confirma; Debe en `Compras`.
    - Compra con línea sin ítem y global vacía → rechaza; el mensaje nombra la descripción de
      la línea, contiene `Cuenta de compras por defecto` y `Las líneas sin ítem solo pueden
      usar la cuenta por defecto`; sigue `DRAFT` sin asiento.
    - Compra de `conCuenta` con global vacía → confirma con Debe en `Repuestos`.
    - Compra de `cuentaVieja` con la cuenta dada de baja → rechaza nombrando ítem y cuenta; sin
      fallback.
    - Compra con global apuntando a una cuenta **no hoja** (`isLeaf: false`) y línea sin ítem
      → rechaza nombrando la `"Cuenta de compras por defecto"` (cubre `source: 'default'`).
    - `bulkConfirmPurchaseInvoices([sinCuenta, conCuenta])` con global vacía →
      `confirmedCount: 1`, `failures[0].message` con el nombre de la línea (ya funciona por
      el `try/catch` por factura de `:1538-1547`; el test lo documenta).
  - [ ] **`confirmInvoice`** (`sales/features/invoices/list/actions.server.ts:842-1140`):
    - En el `include` (`:862-870`) cambiar `defaultIncomeAccount: { select: { type: true } }`
      por `{ select: { id: true, code: true, name: true, type: true } }`; el `product.select`
      ya trae `name`.
    - En el `select` de settings (`:883-898`) cambiar `salesAccount: { select: { type: true }
      }` por `{ select: { id: true, code: true, name: true, type: true } }`.
    - Después de cargar `settings` y **antes** del chequeo de tributos (`:900`), agregar el
      bloque "Cuentas de las líneas (TSK-721)": `const lineChecks = invoice.lines.map((line) =>
      ({ description: line.description, productName: line.product.name, itemAccountId:
      line.product.defaultIncomeAccount?.id ?? null }))`; `const missing =
      findLinesMissingAccount(lineChecks, settings?.salesAccount?.id)`; si hay →
      `throw new Error(buildMissingLineAccountsMessage(missing, 'income'))`. Luego
      imputabilidad: `const effectiveIds = [...new Set(lineChecks.map((l) =>
      resolveLineAccount(l.itemAccountId, settings?.salesAccount?.id)).filter(Boolean))]`;
      `const imputable = await prisma.account.findMany({ where: {
      ...buildImputableAccountsWhere({ companyId }), id: { in: effectiveIds } }, select: { id:
      true } })` (sin `types`: la cuenta de un ítem puede ser ASSET, TSK-579); `const
      unavailable = findLinesWithUnavailableAccount(lineChecks, settings?.salesAccount?.id,
      new Set(imputable.map((a) => a.id)))`; si hay → `throw new
      Error(buildUnavailableLineAccountsMessage(unavailable.map((u) => ({ description:
      u.line.description, accountLabel: labelDe(u) , source: u.source })), 'income'))`, donde
      `labelDe` arma `code - name` desde `line.product.defaultIncomeAccount` o
      `settings.salesAccount`. Importar `buildImputableAccountsWhere` de
      `@/shared/lib/accounts/imputable-accounts` y los helpers de
      `@/modules/commercial/shared/line-accounts`.
    - Reemplazar el bloque `:1077-1100` por: `const journalEntryId = await
      createJournalEntryForSalesInvoice(id, companyId, tx); await tx.salesInvoice.update({
      where: { id }, data: { journalEntryId } }); logger.info(…)`. **Sin `try/catch`**: todo
      error del asiento aborta la transacción y llega al `catch` externo (`:1128-1138`), que ya
      relanza `Error` tal cual. Dejar un comentario: `// TSK-721: antes solo se relanzaba
      "período cerrado" y cualquier otro fallo dejaba la factura confirmada sin asiento.`
    - `getSalesDefaultAccountType` (`:606-628`): actualizar el comentario ("cuenta de ventas
      por defecto").
  - [ ] **`confirmPurchaseInvoice`** (`purchases/features/invoices/list/actions.server.ts:1220-1520`):
    - `include` (`:1229-1243`): `defaultExpenseAccount: { select: { id: true, code: true, name:
      true, type: true } }` (el `product` es `include`, ya trae `name`).
    - `select` de settings (`:1258-1272`): `purchasesAccount: { select: { id: true, code: true,
      name: true, type: true } }`.
    - Mismo bloque de pre-validación que en ventas antes de `:1274`, con `productName:
      line.product?.name ?? null`, `itemAccountId: line.product?.defaultExpenseAccount?.id ??
      null`, `kind: 'expense'` y la global `settings?.purchasesAccount?.id`.
    - Reemplazar `:1432-1455` por la llamada directa + `update` + `logger.info`, sin
      `try/catch`, con el mismo comentario. `bulkConfirmPurchaseInvoices` (`:1523-1570`) no
      cambia: ya captura por factura y devuelve `failures`.
    - `getPurchasesDefaultAccount` (`:583-615`): actualizar el comentario.
  - [ ] **Asiento** (`accounting/features/integrations/commercial/index.ts`):
    - Import (`:35-37`): sumar `resolveLineAccount`, `findLinesMissingAccount`,
      `buildMissingLineAccountsMessage` de `@/modules/commercial/shared/line-accounts`.
    - Venta: `select` de líneas (`:291-298`) suma `description: true` y `product: { select: {
      name: true, defaultIncomeAccountId: true, defaultCostCenterId: true } }`. Guard
      (`:311-316`) → `if (!settings.receivablesAccountId) throw new Error('No se puede generar
      el asiento: falta configurar "Cuentas por Cobrar" en Contabilidad → Configuración.')`
      (ya no exige `salesAccountId`). Antes de `expandByCostCenter` (`:337`): `const missing =
      findLinesMissingAccount(invoice.lines.map(l => ({ description: l.description,
      productName: l.product.name, itemAccountId: l.product.defaultIncomeAccountId })),
      settings.salesAccountId); if (missing.length) throw new
      Error(buildMissingLineAccountsMessage(missing, 'income'))`. En `:339`: `accountId:
      resolveLineAccount(line.product?.defaultIncomeAccountId, settings.salesAccountId)!` con
      comentario de que el `!` está cubierto por el chequeo anterior. IVA (`:369-376`):
      reemplazar `logger.warn + continue` por `throw new
      Error(buildMissingTributeAccountsMessage([\`IVA Débito Fiscal ${rate}%\`]))`. Tipo de
      retorno (`:276`) → `Promise<string>`.
    - Compra: espejo en `:466-473` (select), `:486-491` (guard: solo `payablesAccountId`,
      mensaje `"Cuentas por Pagar"`), `:502-504` (`resolveLineAccount(…,
      settings.purchasesAccountId)`, `kind: 'expense'`, `productName: l.product?.name ??
      null`), `:534-541` (IVA CF), `:452` (`Promise<string>`).
    - `createJournalEntry` (`:179-182`) devuelve `Promise<string | null>` pero nunca `null`
      en la práctica: si el tipo obliga, usar `if (!entryId) throw` o ajustar su firma; no
      cambiar CMV (`:1155-1166`).
    - Encabezado (`:1-28`): "1. Factura de Venta: Debe Cuentas por Cobrar / Haber: **cuenta de
      ingresos del ítem, o Ventas por defecto** + IVA DF" y "2. Factura de Compra: Debe:
      **cuenta de egresos del ítem, o Compras por defecto (obligatoria para líneas sin ítem)**
      + IVA CF / Haber: Cuentas por Pagar". Agregar la nota: "Las cuentas de línea se
      pre-validan en `confirmInvoice`/`confirmPurchaseInvoice`; los `throw` de acá son defensa
      en profundidad."
  - [ ] Revisar que `cost-center.integration.test.ts` y `perceptions.integration.test.ts`
        siguen en verde: configuran `receivablesAccountId`/`payablesAccountId` y todos sus ítems
        tienen cuenta (`cost-center…:128-161, 194-224`; `perceptions…:140-210`), así que ni el
        guard nuevo ni la pre-validación los afectan. Si alguno rompe, es una regresión real.
  - [ ] `check-types`: los dos `if (journalEntryId)` eliminados y el cambio a `Promise<string>`
        no deben dejar errores nuevos.
- **Archivos:**
  - Crear: `sales/features/invoices/list/sales-invoice-line-accounts.integration.test.ts`,
    `purchases/features/invoices/list/purchase-invoice-line-accounts.integration.test.ts`
    (bajo `src/modules/commercial/features/`)
  - Modificar: `src/modules/commercial/features/sales/features/invoices/list/actions.server.ts`,
    `src/modules/commercial/features/purchases/features/invoices/list/actions.server.ts`,
    `src/modules/accounting/features/integrations/commercial/index.ts`
- **Criterio de completitud:** `npm run test` en verde: los dos tests nuevos (once casos entre
  ambos, primero rojos), `cost-center.integration.test.ts`, `perceptions.integration.test.ts` y
  `purchase-invoice-tributes.integration.test.ts` sin regresiones; en la app, confirmar una
  factura de venta con un ítem sin cuenta y global vacía muestra el toast con el nombre del
  ítem y la factura sigue en borrador; confirmar con global configurada sigue funcionando; una
  compra importada de AFIP (líneas sin ítem) confirma con la global y se bloquea sin ella;
  ningún `logger.warn('No se pudo generar asiento contable…')` queda en el código.

#### Fase 4: Gastos bancarios — cuenta por defecto preseleccionada en cada concepto (TDD unitario + integración)

- **Objetivo:** que al agregar un concepto en un movimiento "Gastos e impuestos bancarios" la
  cuenta venga preseleccionada con la de Ajustes contables (si existe y es imputable), que el
  usuario pueda cambiarla, y que el modal avise qué cuenta se va a usar o que falta
  configurarla. Sin cambios en el modelo de líneas ni en `confirmFundMovement`.
- **Tareas:**
  - [ ] **Helper puro (TDD).** En `fund-movements/shared/lines-calc.test.ts` agregar
        `describe('pickDefaultLineAccount')`: devuelve el id cuando está entre las cuentas
        disponibles; devuelve `''` cuando la cuenta por defecto es `null`; devuelve `''` cuando
        el id no está en las disponibles (dada de baja / no imputable); no depende del orden.
        Rojo primero.
  - [ ] `fund-movements/shared/lines-calc.ts`: agregar `export function pickDefaultLineAccount(
        defaultAccountId: string | null | undefined, accounts: Array<{ id: string }>): string`
        → `accounts.some((a) => a.id === defaultAccountId) ? defaultAccountId : ''`, con
        comentario (riesgo 1.6-6: preseleccionar un id que el combo no tiene deja el campo
        "vacío" y `assertLineAccounts` lo rechaza con el mensaje genérico). Verde.
  - [ ] **Catálogo (TDD de integración).** En
        `fund-movements/list/fund-movement-lines.integration.test.ts` agregar un `describe('caso
        6: la cuenta de gastos bancarios por defecto llega al formulario (TSK-718)')`: en el
        `beforeAll` del caso, `prisma.accountingSettings.update({ bankChargesAccountId:
        <cuenta EXPENSE del andamiaje> })`; `await getFundMovementCatalogs()` devuelve
        `defaultBankChargesAccount` con `{ id, code, name }` de esa cuenta; con `null` en
        settings devuelve `null`. Rojo primero (el campo no existe en el `return`).
  - [ ] `fund-movements/list/actions.server.ts:148-151` (`getFundMovementCatalogs`): en el
        `select` de `accountingSettings.findUnique` sumar `bankChargesAccount: { select: { id:
        true, code: true, name: true } }`; en el `return` (`:153-162`) agregar
        `defaultBankChargesAccount: settings?.bankChargesAccount ?? null, // TSK-718`.
        Actualizar el JSDoc (`:120`). Verde. `getFundMovementLineAccounts` (`:180-201`) no
        cambia.
  - [ ] Propagar la prop: `FundMovementsList.tsx:37` →
        `defaultBankChargesAccount={catalogs.defaultBankChargesAccount}`;
        `_FundMovementsTable.tsx:36-42` (interface), `:44-53` (destructuring), `:128-136` y
        `:139-147` (los dos modales) → `defaultBankChargesAccount: FundMovementAccountRef | null`;
        `_CreateFundMovementModal.tsx:63-73` (`Props`), `:80-88` (destructuring) y `:455` →
        `<_FundMovementLinesField accounts={lineAccounts}
        defaultAccount={defaultBankChargesAccount} />`. Hacerlo en un solo paso: `check-types`
        acusa en los cuatro archivos.
  - [ ] Crear `fund-movements/list/components/_BankChargesDefaultNotice.tsx` (Client Component,
        < 60 líneas, molde `_PartnerAccountNotice.tsx:15-22` para clases y `Link` a
        `/dashboard/company/accounting/settings`). Props: `{ defaultAccount:
        FundMovementAccountRef | null; available: boolean }`. Tres estados:
    - configurada y disponible → neutra (`Info`): "Los conceptos nuevos se imputan a
      **{code} - {name}** (cuenta de gastos bancarios por defecto). Podés cambiar la cuenta en
      cada fila."
    - configurada pero no disponible → naranja (`AlertTriangle`, `role="status"`): "La cuenta
      de gastos bancarios por defecto **{code} - {name}** ya no está disponible (dada de baja o
      no imputable): elegí la cuenta en cada concepto o corregila en Ajustes contables."
    - no configurada → naranja informativa: "No hay cuenta de gastos bancarios por defecto:
      elegí la cuenta en cada concepto o configurala en Ajustes contables." **No bloquea**: hoy
      ya se opera sin ella.
  - [ ] `_FundMovementLinesField.tsx:14-17`: agregar `defaultAccount?: FundMovementAccountRef |
        null` a las props (importar el tipo desde `../actions.server`); en el cuerpo `const
        defaultAccountId = pickDefaultLineAccount(defaultAccount?.id, accounts)`; en el `append`
        (`:51`) → `append({ accountId: defaultAccountId, description: '', amount: '' })`;
        renderizar `<_BankChargesDefaultNotice defaultAccount={defaultAccount ?? null}
        available={defaultAccountId !== ''} />` debajo del bloque (después del total, `:114-116`,
        y también cuando `fields.length === 0`, para que el aviso se vea antes del primer
        concepto). El archivo queda en ~140 líneas.
  - [ ] Verificar que al **editar** un borrador BANK_CHARGES el `reset` del modal sigue cargando
        las cuentas guardadas (la preselección solo aplica a `append`, no al `reset`), y que
        `validateLines`/`assertLineAccounts`/`confirmFundMovement` no cambian.
- **Archivos:**
  - Crear: `fund-movements/list/components/_BankChargesDefaultNotice.tsx`
  - Modificar: `fund-movements/shared/lines-calc.ts`, `lines-calc.test.ts`,
    `fund-movements/list/actions.server.ts`, `fund-movement-lines.integration.test.ts`,
    `FundMovementsList.tsx`, `components/_FundMovementsTable.tsx`,
    `components/_CreateFundMovementModal.tsx`, `components/_FundMovementLinesField.tsx`
    (todos bajo `src/modules/commercial/features/treasury/features/`)
- **Criterio de completitud:** `npm run test` en verde (`lines-calc.test.ts` y el caso 6 de
  integración, primero rojos); en el modal, con la cuenta configurada, "Agregar concepto" trae
  la cuenta cargada y el aviso neutro; se puede cambiar por otra y guardar; sin cuenta
  configurada, el concepto nace vacío y el aviso naranja aparece; con la cuenta por defecto
  dada de baja, el concepto nace vacío y el aviso lo dice; el asiento de un movimiento con
  conceptos preseleccionados es idéntico al de uno cargado a mano (caso 1 del test existente
  sigue en verde); aporte, retiro y transferencia no cambian.

#### Fase 5: Visibilidad — ítems sin cuenta en el listado y conteo en Ajustes contables

- **Objetivo:** que la clienta pueda ver cuántos ítems caen en la cuenta por defecto, filtrar el
  listado por "sin cuenta de ingreso" / "sin cuenta de egreso", ver en cada fila cuál falta, e
  imputar en masa con `Editar en Lote` hasta llegar a cero.
- **Tareas:**
  - [ ] **Facets y filtro (TDD de integración).** Crear
        `products/features/list/product-imputation-filter.integration.test.ts` (molde
        `price-lists/detail/apply-index.integration.test.ts` para el `skipIf` + los `vi.mock`
        de TSK-644; prefijo `TSK721-PROD-`). `beforeAll`: empresa, una cuenta REVENUE y una
        EXPENSE, cuatro ítems: `ventaSin` (`usage: 'SALE'`, sin cuentas), `compraSin` (`usage:
        'PURCHASE'`, sin cuentas), `ambosOk` (`PURCHASE_SALE`, las dos), `ambosSinIngreso`
        (`PURCHASE_SALE`, solo egreso). Casos: `getProductFacetCounts()` devuelve `imputation:
        { noIncome: 2, noExpense: 1 }` (`compraSin` no cuenta como sin ingreso; `ventaSin` no
        cuenta como sin egreso); `getProducts({ filters: { imputation: ['noIncome'] } })` trae
        exactamente `ventaSin` y `ambosSinIngreso`; `['noExpense']` trae `compraSin`;
        `['noIncome','noExpense']` trae los tres (OR). Rojo primero.
  - [ ] `products/features/list/actions.server.ts`: exportar dos constantes puras (o ponerlas en
        `products/shared/imputation-filter.ts` si el archivo crece):
        `INCOME_USAGES = ['SALE', 'PURCHASE_SALE']`, `EXPENSE_USAGES = ['PURCHASE',
        'PURCHASE_SALE']` (tipo `ProductUsage[]` de `@/generated/prisma/enums`) y
        `missingIncomeWhere = { usage: { in: INCOME_USAGES }, defaultIncomeAccountId: null }`,
        `missingExpenseWhere = { usage: { in: EXPENSE_USAGES }, defaultExpenseAccountId: null }`
        (`Prisma.ProductWhereInput`). En `getProducts` (`:38-41`) agregar `'imputation'` al
        `exclude` (por claridad; `buildFiltersWhere` con `columnMap` ya ignora columnas
        desconocidas) y, junto a `categoryWhere` (`:69-72`), `const imputationFilter =
        filters['imputation'] ?? []` → `imputationWhere = { OR: [ …noIncome ?
        missingIncomeWhere, …noExpense ? missingExpenseWhere ] }` (vacío si no hay filtro);
        sumarlo al `where` (`:76-81`). En `getProductFacetCounts` (`:157-180`) sumar dos
        `prisma.product.count({ where: { companyId, ...missingIncomeWhere } })` /
        `…missingExpenseWhere` al `Promise.all` y devolver `imputation: { noIncome, noExpense
        }`. Verde.
  - [ ] `products/features/list/components/_ProductsTable.tsx:44-47` (`FacetCounts`): agregar
        `imputation?: Record<string, number>`; en `filterOptions` (`:150-190`), después de
        `stockLevel`, agregar `{ columnId: 'imputation', title: 'Imputación', options: [{ value:
        'noIncome', label: 'Sin cuenta de ingreso' }, { value: 'noExpense', label: 'Sin cuenta de
        egreso' }], externalCounts: facetCounts?.imputation ? new
        Map(Object.entries(facetCounts.imputation)) : undefined }`. `ProductsList.tsx:21-30` ya
        pasa `facetCounts` completo; no cambia. El `id: 'imputation'` de la columna
        (`columns.tsx:238`) coincide con el `columnId`, así el filtro se ancla a la columna.
  - [ ] `products/features/list/columns.tsx:237-273` (columna "Imputación"): reemplazar el
        `if (!income && !expense)` (`:246`) por una celda que muestre, por cada cuenta que
        **aplica según `usage`** y falta, un badge naranja chico: `Sin ingreso` (si `usage !==
        'PURCHASE'` y `!income`) y `Sin egreso` (si `usage !== 'SALE'` y `!expense`), y las
        cuentas presentes como hoy (`Ing:`/`Egr:` con el código). Si no falta ninguna que
        aplique, no hay badge. Mantener `meta.title`, `enableSorting: false` y `whitespace-
        nowrap`. Extraer la lógica "qué falta" a una función pura `missingImputations(product)`
        en `products/shared/imputation-filter.ts` con un `imputation-filter.test.ts` (cuatro
        casos por `usage`), para no engordar `columns.tsx` (341 líneas).
  - [ ] **Conteo en Ajustes contables.** `accounting/features/settings/actions.server.ts`: nueva
        action `getItemsWithoutAccountCounts(companyId)` con `checkPermission(
        'accounting.settings', 'view', { redirect: true })` y dos `prisma.product.count` con
        `{ companyId, status: 'ACTIVE', usage: { in: [...] }, defaultIncomeAccountId: null }` /
        `defaultExpenseAccountId: null` (Prisma directo, **sin importar** de `commercial`, regla
        `module-communication.md`; los literales de `usage` se repiten a propósito). Devuelve
        `{ saleItemsWithoutIncome: number; purchaseItemsWithoutExpense: number }`.
  - [ ] Crear `accounting/features/settings/components/ItemsWithoutAccountNotice.tsx` (Server
        Component, sin `_`, < 70 líneas). Props: `{ counts }`. Si ambos son 0 → una línea neutra
        "Todos los ítems activos tienen su cuenta de ingresos y de egresos. Las cuentas por
        defecto solo se usan en líneas de compra sin ítem." Si no → bloque
        `border-orange-500/50 bg-orange-500/10` con: "**N** ítems activos de venta sin Cuenta de
        Ingresos → [Ver]" y/o "**M** ítems activos de compra sin Cuenta de Egresos → [Ver]", y
        la aclaración "Mientras existan, las facturas de esos ítems se imputan a la cuenta por
        defecto; sin ella, no se pueden confirmar. Imputalos desde Ítems → seleccionar → Editar
        en Lote, o uno por uno con Imputación contable." Cada [Ver] es un `Link` a
        `/dashboard/commercial/products?imputation=noIncome&status=ACTIVE` (o `noExpense`)
        envuelto en `<PermissionGuard module="commercial.products" action="view" fallback={null}>`
        (`PermissionGuard.tsx:6-32` soporta `fallback`).
  - [ ] `AccountingSettings.tsx:10-19`: sumar `getItemsWithoutAccountCounts(companyId)` al
        `Promise.all` de datos y renderizar `<ItemsWithoutAccountNotice counts={counts} />`
        dentro del `CardContent` de "Integración Comercial" (`:72`), arriba de
        `_CommercialIntegrationForm`, con `mb-6`.
- **Archivos:**
  - Crear: `products/features/list/product-imputation-filter.integration.test.ts`,
    `products/shared/imputation-filter.ts`, `products/shared/imputation-filter.test.ts`
    (bajo `src/modules/commercial/features/`),
    `src/modules/accounting/features/settings/components/ItemsWithoutAccountNotice.tsx`
  - Modificar: `products/features/list/actions.server.ts`, `components/_ProductsTable.tsx`,
    `columns.tsx`; `src/modules/accounting/features/settings/actions.server.ts`,
    `AccountingSettings.tsx`
- **Criterio de completitud:** `npm run test` en verde (integración de facets/filtro e
  `imputation-filter.test.ts`, primero rojos); en `/dashboard/commercial/products` el filtro
  "Imputación" muestra los dos valores con sus conteos y filtra; la columna marca "Sin
  ingreso"/"Sin egreso" según `usage`; en Ajustes contables el bloque muestra N y M con link, y
  al hacer clic el listado llega filtrado; seleccionando esos ítems y usando "Editar en Lote"
  → cuenta, el conteo baja; sin permiso `commercial.products` el conteo se ve sin link;
  `columns.tsx` y `_ProductsTable.tsx` no superan su tamaño actual en más de ~20 líneas.

#### Fase 6: Script de diagnóstico de facturas confirmadas sin asiento (solo lectura)

- **Objetivo:** saber cuántas facturas de venta y compra quedaron confirmadas sin asiento por
  el `return null` histórico (riesgo 1.6-2), por empresa, para decidir con la clienta y el
  contador qué hacer (regenerar asientos es otro ticket). No corrige nada.
- **Tareas:**
  - [ ] Crear `prisma/scripts/diagnose-invoices-without-entry.ts` con el molde de
        `diagnose-fixed-asset-accounts.ts:1-30` (encabezado con contexto, "SOLO LEE", cómo
        correrlo, `import 'dotenv/config'` + `prisma` de `../../src/shared/lib/prisma`). Consulta
        `salesInvoice.findMany` y `purchaseInvoice.findMany` con `where: { status: { notIn:
        ['DRAFT', 'CANCELLED'] }, journalEntryId: null }`, `select: { companyId, company: { name
        }, fullNumber, voucherType, issueDate, total, status }`, `orderBy: [{ companyId }, {
        issueDate }]`. Imprime por empresa: conteo y suma de `total` por tipo (venta/compra) y
        el detalle (`fullNumber`, tipo, fecha `moment.utc(...).format('DD/MM/YYYY')`, total,
        estado). Sin `UPDATE`, sin `INSERT`, sin `revalidatePath`.
  - [ ] En el encabezado del mismo archivo documentar el **SQL equivalente** para producción
        (memoria `produccion-dokploy-scripts-db`: la imagen `runner` no tiene `tsx`):
        ```sql
        SELECT c.name AS empresa, 'venta' AS tipo, s.full_number, s.voucher_type, s.issue_date::date,
               s.total, s.status
        FROM sales_invoices s JOIN companies c ON c.id = s.company_id
        WHERE s.status NOT IN ('DRAFT','CANCELLED') AND s.journal_entry_id IS NULL
        UNION ALL
        SELECT c.name, 'compra', p.full_number, p.voucher_type, p.issue_date::date, p.total, p.status
        FROM purchase_invoices p JOIN companies c ON c.id = p.company_id
        WHERE p.status NOT IN ('DRAFT','CANCELLED') AND p.journal_entry_id IS NULL
        ORDER BY 1, 2, 5;
        ```
        más el resumen `SELECT company_id, count(*), sum(total) … GROUP BY 1` para cada tabla,
        y el comando `sudo docker exec -it $(sudo docker ps -q --filter
        name=contablemas-contablemas) sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"'`.
        Verificar los nombres de columnas contra `schema.prisma` (`sales_invoices` `:2879`,
        `purchase_invoices` `:3007`, `journal_entry_id`, `full_number`, `issue_date`,
        `voucher_type`, `companies` `:212`).
  - [ ] Correr `npx tsx prisma/scripts/diagnose-invoices-without-entry.ts` contra la base de dev
        y anotar en la sección 4 el resultado (aunque sea cero) y los comandos de prod.
  - [ ] Agregar al encabezado la consulta de ítems sin cuenta del análisis 1.2.3 (`SELECT usage,
        count(*) FILTER (WHERE default_income_account_id IS NULL) …`) para correrla en la misma
        sesión de `psql`: es el dato que la clienta necesita antes de vaciar la global.
- **Archivos:**
  - Crear: `prisma/scripts/diagnose-invoices-without-entry.ts`
- **Criterio de completitud:** el script corre en dev sin escribir nada (`git status` limpio,
  ningún `UPDATE` en el código); el SQL del encabezado corre en `psql` local (`docker exec
  contable-pms-db psql …`, mismo contenedor que usa `capturas-tsk717.mjs:27-30`) y devuelve las
  mismas filas que el script.

#### Fase 7: Documentación (guía in-app, docs del desarrollador y guía de presentación PDF)

- **Objetivo:** cumplir las reglas 8 y 10 del `CLAUDE.md` y el entregable de presentación
  (memoria `guia-presentacion-cliente-por-ticket`), y usar el PDF para anunciar el **cambio de
  comportamiento**: las facturas con ítems sin cuenta ya no se confirman "en silencio", y cómo
  imputar masivamente antes de que pase.
- **Tareas:**
  - [ ] `src/modules/help/features/guide/components/_AccountingGuide.tsx:215-236` (lista de
        cuentas de Integración Comercial): cambiar `<li>Cuenta de Ventas</li>` y `<li>Cuenta de
        Compras</li>` por "Cuenta de ventas **por defecto** y Cuenta de compras **por defecto**:
        la cuenta de cada factura la define el ítem (Ítems → Imputación contable); estas se
        usan solo para los ítems que no tienen la suya. La de ventas puede quedar vacía si
        todos los ítems de venta tienen cuenta; la de compras hace falta para las líneas sin
        ítem (gastos sueltos, comprobantes importados de AFIP)"; en `<li>Caja y Banco</li>`
        agregar "y Gastos bancarios por defecto (se preselecciona en cada concepto de un
        movimiento de gastos bancarios)". Agregar una `Alert` después de la lista: "Debajo de
        estas cuentas, la pantalla te muestra cuántos ítems activos todavía no tienen su
        cuenta de ingresos o de egresos, con un enlace al listado filtrado para imputarlos."
  - [ ] `_CommercialGuide.tsx:145-158` (ítems): en "Cuenta de Egresos" cambiar "en lugar de la
        cuenta de compras general" por "en lugar de la **Cuenta de compras por defecto**"; ídem
        ingresos/ventas. Agregar una `Alert` a continuación: "**Si el ítem no tiene cuenta y no
        hay cuenta por defecto, la factura no se puede confirmar**: el sistema nombra la línea
        y te dice dónde asignarla. En el listado de Ítems, el filtro **Imputación** ('Sin
        cuenta de ingreso' / 'Sin cuenta de egreso') y los badges de la columna muestran cuáles
        faltan; seleccionalos y usá **Editar en Lote** para asignar la cuenta a varios de una
        vez, o **Imputación contable** en el menú de cada fila." En la sección de confirmación
        de facturas (`:490-510`, junto al párrafo de "Exigir centro de costo") agregar el
        párrafo: "Tampoco se puede confirmar una factura si alguna línea no tiene cuenta
        contable (ni la del ítem ni la por defecto) o si la cuenta del ítem está dada de baja:
        el mensaje nombra la línea. En compras, las líneas sin ítem siempre usan la Cuenta de
        compras por defecto." Actualizar la `Alert` de tributos (`:732-742`) para que cierre con
        "lo mismo pasa con la cuenta de cada línea: así no queda una factura confirmada sin su
        asiento".
  - [ ] `_TreasuryGuide.tsx:907-913` (paso de conceptos de gastos bancarios): agregar "La cuenta
        de cada concepto nuevo viene **preseleccionada** con la 'Gastos bancarios por defecto'
        de Ajustes contables (podés cambiarla en cada fila; Sircreb y otros conceptos que son
        activo se eligen a mano). Si no está configurada, el modal te lo avisa y elegís la
        cuenta concepto por concepto, como hasta ahora."
  - [ ] `docs/modules/accounting.md:185-195` (tabla "Mapeo de Cuentas"): `salesAccountId` →
        "Ventas **por defecto** (solo líneas cuyo ítem no tiene `defaultIncomeAccountId`; puede
        ser null)", `purchasesAccountId` → "Compras **por defecto** (ítems sin
        `defaultExpenseAccountId` y líneas sin ítem; requerida si se cargan compras sin
        ítem)", fila nueva `bankChargesAccountId` → "Gastos bancarios por defecto:
        preselección de los conceptos de `BANK_CHARGES` (TSK-718); el asiento usa
        `FundMovementLine.accountId`, no esta cuenta". En la tabla de período bloqueado
        (`:180`) corregir "asiento automatico se omite con warning" → "la confirmación falla y
        se revierte (TSK-721: cualquier error del asiento bloquea)". Agregar la subsección
        "Resolución de la cuenta de línea (TSK-721)" con la regla `ítem → por defecto → error
        que nombra la línea`, la pre-validación en el confirm, la verificación de
        imputabilidad y el archivo `commercial/shared/line-accounts.ts`.
  - [ ] `docs/architecture/data-model.md:211-212`: reescribir "Sobrescribe `purchasesAccountId`
        …" como "Cuenta de la línea en el asiento; si es null cae en `purchasesAccountId`
        (por defecto) y si tampoco hay, la confirmación se rechaza nombrando la línea
        (TSK-721). Tipos admitidos EXPENSE|ASSET (TSK-579); se valida imputable al confirmar."
        (ídem ingresos con REVENUE|ASSET); en la fila `AccountingSettings` (`:455`) agregar
        `bankChargesAccountId (TSK-718)`; en la sección de Tesorería, junto a "Movimiento de
        fondos y sus conceptos (TSK-585)", una línea: "`bankChargesAccountId` de
        `AccountingSettings` es solo preselección de UI; `FundMovementLine.accountId` sigue NOT
        NULL".
  - [ ] `docs/modules/commercial.md`: en "Confirmar Factura de Compra" (`:543-553`) agregar la
        fila `| Validación de cuentas de línea | Siempre | Aborta si alguna línea no resuelve
        cuenta (ítem → compras por defecto) o la cuenta no es imputable (TSK-721) |` y cambiar
        "Dr: Compras" por "Dr: cuenta del ítem o Compras por defecto"; ídem en "Confirmar
        Factura de Venta" (`:574-580`). En la tabla de Productos (`:41-45`) agregar "filtro
        Imputación (sin cuenta de ingreso/egreso), badges por cuenta faltante (TSK-721)". Al
        final del bloque de centros de costo (`:725-741`) agregar el bloque "**Cuentas de
        línea (TSK-721)**" con la regla, los helpers y el cambio del `catch`.
  - [ ] Crear `scripts/guia-presentacion/capturas-tsk721.mjs` sobre la base de
        `capturas-tsk717.mjs:1-50` (login `EMAIL`/`PASSWORD` de dev, `shot()`, salida
        `assets/tsk721-*.png`, `BASE = process.argv[2]`, `psql` vía `docker exec
        contable-pms-db`). Requiere el dev server en `:3010` (`NEXT_PUBLIC_APP_URL=
        http://localhost:3010 npm run dev -- -p 3010`, memoria `dev-local-capturas-y-login`) y
        los datos de la fase 8 sembrados. Capturas: (1) `01-config-antes-despues`: Ajustes
        contables con los campos "Cuenta de ventas/compras por defecto" y sus ayudas, más el
        bloque de conteo de ítems sin cuenta; (2) `02-items-filtro-sin-cuenta`: listado de
        ítems con el filtro "Imputación → Sin cuenta de ingreso" aplicado y los badges; (3)
        `03-items-editar-en-lote`: modal "Editar en Lote" con la cuenta de ingresos elegida;
        (4) `04-factura-bloqueada`: toast de error al confirmar una venta con ítem sin cuenta y
        global vacía; (5) `05-asiento-por-item`: detalle del asiento con dos cuentas de ingreso
        distintas (una por ítem) en el Haber; (6) `06-gastos-bancarios-preseleccion`: modal de
        fondos tipo "Gastos e impuestos bancarios" con un concepto recién agregado con la cuenta
        preseleccionada y el aviso neutro; (7) `07-gastos-bancarios-sin-config`: ídem con el
        aviso naranja (vaciar y restaurar `bank_charges_account_id` por `psql`).
  - [ ] Crear `scripts/guia-presentacion/tsk-721.html` copiando estructura y estilos de
        `tsk-717.html` (cover con eyebrow "Tickets 721 · 724-a/b · 718 · Contabilidad"):
        1. **Qué pedías** (citas de 724 "se determina por la cuenta contable del ítem, no
        puede ser una para todas las ventas", 721 "si el ítem tiene cuentas… esos son los de
        asientos", 718 "también se debe configurar la cuenta desde configuración contable");
        2. **Qué cambió en pantalla** (antes: "Cuenta de Ventas" que parecía la cuenta de todo;
        después: "por defecto", con el conteo de ítems sin cuenta; el filtro y los badges en
        Ítems; la cuenta preseleccionada en gastos bancarios); 3. **Cómo funciona el asiento**
        (la cuenta la define el ítem; la por defecto solo entra si el ítem no tiene; en
        compras, las líneas sin ítem —AFIP— siempre usan la por defecto), con la captura 5;
        4. **Cambio de comportamiento — leer antes de operar**: "hasta ahora, una factura con
        ítems sin cuenta y sin cuenta por defecto se confirmaba igual **sin generar asiento** y
        nadie avisaba; desde esta entrega **no se confirma** y el mensaje nombra la línea"
        (captura 4); qué hacer: revisar el conteo en Ajustes contables, filtrar Ítems por
        "Sin cuenta de ingreso/egreso", imputar con Editar en Lote (capturas 1-3); si vas a
        vaciar la Cuenta de ventas por defecto, primero llevá ese conteo a cero; **no vaciar la
        de compras** si importás comprobantes de AFIP; 5. **Gastos bancarios** (capturas 6-7):
        configurar "Gastos bancarios por defecto", cada concepto nuevo nace con esa cuenta,
        Sircreb se sigue eligiendo a mano; 6. **Qué no cambió**: los asientos ya generados no
        se tocan; los asientos siguen naciendo en Borrador y hay que Registrarlos (TSK-717);
        cambiar la cuenta de un ítem no modifica facturas ya confirmadas; 7. **Facturas
        anteriores sin asiento**: qué significa, cómo las detectamos (script de la fase 6) y
        que su regeneración se define con el contador en otro ticket.
  - [ ] Generar el PDF: `node scripts/guia-presentacion/generar-pdf.mjs
        scripts/guia-presentacion/tsk-721.html
        docs/presentaciones/TSK-721-cuentas-por-defecto.pdf`.
- **Archivos:**
  - Modificar: `src/modules/help/features/guide/components/_AccountingGuide.tsx`,
    `_CommercialGuide.tsx`, `_TreasuryGuide.tsx`, `docs/modules/accounting.md`,
    `docs/modules/commercial.md`, `docs/architecture/data-model.md`
  - Crear: `scripts/guia-presentacion/capturas-tsk721.mjs`, `scripts/guia-presentacion/tsk-721.html`,
    `scripts/guia-presentacion/assets/tsk721-*.png`,
    `docs/presentaciones/TSK-721-cuentas-por-defecto.pdf`
- **Criterio de completitud:** las tres guías in-app describen "por defecto", el error que
  nombra la línea, el filtro de ítems y la preselección de gastos bancarios; `accounting.md`,
  `commercial.md` y `data-model.md` explican la resolución de la cuenta y el cambio del
  `catch`; el PDF se genera sin errores con las siete capturas de la app real y la sección 4
  deja por escrito el cambio de comportamiento y el camino para imputar en masa.

#### Fase 8: Verificación final

- **Objetivo:** cerrar con evidencia: comandos del checklist en verde y los casos de uso
  probados a mano en el navegador con datos reales de dev.
- **Tareas:**
  - [ ] `npm run check-types` (línea base **219**; ninguno nuevo en `accounting/features/
        settings`, `accounting/features/integrations/commercial`, `commercial/shared`,
        `sales/features/invoices`, `purchases/features/invoices`, `products/features/list`,
        `treasury/features/fund-movements` ni `help/`), `npm run lint`, `npm run test` completo
        (validators de settings, `line-accounts.test.ts`, `lines-calc.test.ts`,
        `imputation-filter.test.ts`, los dos tests de integración nuevos de facturas, el de
        facets, el caso 6 de fondos; y sin regresiones en `cost-center`, `perceptions`,
        `purchase-invoice-tributes`, `fund-movement-lines`, `fund-movement-partner-account`).
  - [ ] Preparar datos en dev (empresa "Empresa de Prueba 01 SA", memoria
        `dev-local-capturas-y-login`): dos cuentas REVENUE hoja ("Ventas repuestos", "Ventas
        servicios") y una EXPENSE hoja ("Gastos bancarios"); ítems de venta **A** (con "Ventas
        repuestos"), **B** (con "Ventas servicios"), **C** (sin cuenta de ingresos), **D** (con
        una cuenta REVENUE que luego se da de baja desde el Plan de Cuentas); un ítem de
        compra **E** con cuenta de egresos; un comprobante de compra en borrador con una línea
        sin ítem (formulario, "Ítem: Opcional") o importado de AFIP; cuenta "Gastos
        bancarios" configurada como por defecto; un banco con cuenta contable.
  - [ ] Prueba manual, caso por caso:
    - Venta con A + B y "Cuenta de ventas por defecto" **vacía** → confirma; el asiento tiene
      dos cuentas de ingreso distintas en el Haber.
    - Venta con A + C y global vacía → toast que nombra «C» y dice "Cuenta de ventas por
      defecto"; la factura sigue en borrador; sin asiento en Contabilidad → Asientos.
    - Misma venta con la global configurada → confirma; C va a la global, A a la suya.
    - Venta con D tras dar de baja su cuenta → toast que nombra «D» y la cuenta; no confirma.
      Reasignar la cuenta de D desde Imputación contable y confirmar.
    - NC de venta de A → confirma; el asiento invierte lados con la cuenta de A.
    - Compra con línea sin ítem y "Cuenta de compras por defecto" configurada → confirma con
      la global; vaciar la global → misma compra bloqueada nombrando la línea y "Las líneas
      sin ítem solo pueden usar la cuenta por defecto"; restaurar.
    - Compra con E y global vacía → confirma con la cuenta de E.
    - Confirmación masiva de compras con una que falla → la otra se confirma y el resumen
      nombra la que quedó pendiente con el motivo.
    - Gastos bancarios con cuenta por defecto → "Agregar concepto" nace con la cuenta y el
      aviso neutro; cambiar la cuenta de un concepto, confirmar, ver el asiento con un débito
      por concepto. Vaciar la por defecto → concepto nace vacío, aviso naranja, se puede
      operar igual. Dar de baja la cuenta por defecto → aviso "ya no está disponible".
      Restaurar.
    - Ítems: el filtro "Imputación → Sin cuenta de ingreso" lista a C (y no a los ítems solo
      de compra); la columna marca "Sin ingreso" en C; en Ajustes contables el conteo dice "1
      ítem activo de venta sin Cuenta de Ingresos → Ver" y el link llega filtrado; imputar C
      con "Editar en Lote" → el conteo pasa a "Todos los ítems…".
    - Regresión: recibos, órdenes de pago, gastos, aportes y retiros de socios se confirman
      igual que antes; una venta en período bloqueado sigue mostrando "período está cerrado".
    - Script de diagnóstico en dev: corre y lista (o no) facturas sin asiento; anotar el
      resultado.
  - [ ] Responsive y accesibilidad: Ajustes contables (bloque de conteo) y modal de fondos
        (aviso) a 375px; modo oscuro en los avisos neutro y naranja y en los badges de la
        columna.
  - [ ] Registrar los resultados en la sección 5 del documento, con los comandos y su salida
        resumida, y los comandos de `psql` para el diagnóstico en producción (memoria
        `produccion-dokploy-scripts-db`).
- **Archivos:** ninguno nuevo; solo correcciones puntuales que salgan de la verificación.
- **Criterio de completitud:** los tres comandos en verde (con la línea base de `check-types`
  respetada), los doce casos manuales registrados con resultado, y ningún cambio de
  comportamiento en recibos, órdenes de pago, gastos, aportes, retiros ni transferencias.

### 2.2 Orden de ejecución

1. **Fase 1 primero y sola.** Las fases 4 y 5 dependen del cliente Prisma regenerado con
   `bankChargesAccountId`, y la 3 usa los textos nuevos de los campos en sus mensajes. Commit
   propio ("schema + migración + settings").
2. **Fases 2 y 4 después de la 1, en paralelo**: no comparten archivos (la 2 toca
   `commercial/shared/line-accounts*` y comentarios; la 4 toca `treasury/features/
   fund-movements/**`).
3. **Fase 3 después de la 2** (usa el helper). Es la fase con el cambio contable; commit propio
   con los dos tests de integración.
4. **Fase 5 después de la 1** (el conteo en settings vive en el mismo `AccountingSettings.tsx`
   que la 1 tocó); puede ir en paralelo con la 3 (archivos distintos: `products/**` y
   `settings/**` vs. `sales/**`, `purchases/**`, `integrations/**`). Si se hacen en serie, 3
   antes que 5: la visibilidad es la mitigación del bloqueo, conviene probarlas juntas.
5. **Fase 6 es independiente** de todo (solo lectura); puede hacerse en cualquier momento,
   incluso antes de la 1, para saber cuanto antes cuántas facturas históricas hay en prod.
6. **Fase 7 después de la 3, 4 y 5**: la guía y `docs/` se pueden redactar en paralelo con la
   5, pero las capturas y el PDF necesitan la app terminada y los datos de la 8 sembrados, así
   que `capturas-tsk721.mjs` y el PDF son lo último.
7. **Fase 8 al final**, con todo montado.

**Riesgos de orden a tener presentes:**

- Si el `catch` de `confirmInvoice`/`confirmPurchaseInvoice` se cambia **antes** de la
  pre-validación de la misma fase, cualquier factura con ítem sin cuenta empieza a fallar con
  el mensaje genérico del asiento; hacer las dos cosas en el mismo commit (y la
  pre-validación primero).
- Con el `catch` relanzando todo, una empresa sin cuenta de IVA para alguna alícuota, que hoy
  confirma con asiento descuadrado silenciosamente omitido, pasa a bloquearse. Por eso los
  `continue` de IVA pasan a `throw` con mensaje claro en la misma fase; verificar en la
  prueba manual que la empresa de dev tiene IVA DF y CF configurados (`AccountingVatAccount`
  o `vatDebitAccountId`/`vatCreditAccountId`).
- Los tests de integración de la fase 3 crean facturas de venta directo con Prisma: los
  productos deben tener **`trackStock: false`** o `confirmInvoice` falla en el almacén
  (`sales/…/actions.server.ts:967-978`) antes de llegar a la lógica que se prueba.
- La propagación de `defaultBankChargesAccount` cruza cuatro archivos (`actions.server.ts`,
  `FundMovementsList.tsx`, `_FundMovementsTable.tsx`, `_CreateFundMovementModal.tsx`) más
  `_FundMovementLinesField.tsx`: hacerlo en un solo paso o `check-types` acusa en todos.
- `getProductFacetCounts` y `getProducts` reciben el mismo filtro con nombres distintos
  (`noIncome`/`noExpense`): definir los `where` una sola vez (constantes compartidas) para que
  el conteo del facet y el listado filtrado no diverjan.
- El conteo en Ajustes contables **no** puede importar de `products/shared/imputation-filter.ts`
  (regla de no importar entre módulos); los literales de `usage` se duplican a propósito y el
  test de integración de la fase 5 cubre que ambos den lo mismo si se agrega el caso.
- `validators.test.ts:76-81` de settings falla apenas se agrega el campo al schema Zod: es
  el rojo esperado de la fase 1, no una regresión.

### 2.3 Estimación de complejidad

- Fase 1 (esquema + migración aditiva + settings + textos): **baja** — patrón TSK-644/717 calcado.
- Fase 2 (helper puro con tests): **baja-media** — la dificultad está en los textos de los
  mensajes, que son parte del entregable.
- Fase 3 (pre-validación en dos confirm, guard y `catch`, dos tests de integración con once
  casos): **alta** — es donde vive el riesgo contable y el cambio de comportamiento; toca tres
  archivos grandes (`index.ts` 1228 líneas, los dos `actions.server.ts` de más de 1100).
- Fase 4 (gastos bancarios: catálogo, propagación, aviso, preselección, dos tests): **media**.
- Fase 5 (facets, filtro, badges, conteo con link, tres tests): **media**.
- Fase 6 (script de solo lectura + SQL): **baja**.
- Fase 7 (tres guías, tres docs, PDF con siete capturas y sección de cambio de
  comportamiento): **media-alta** — el PDF con datos coherentes (dos cuentas de ingreso, un
  ítem sin cuenta, una compra AFIP, gastos bancarios con y sin config) es lo que más tiempo
  lleva.
- Fase 8 (verificación con doce casos): **media**.

**Complejidad total: media-alta.** Hay una migración (aditiva, sin datos), no hay permisos
nuevos, no hay rutas nuevas ni módulos a registrar. El riesgo técnico está en la fase 3 (no
romper la confirmación de ventas, compras, NC y confirmación masiva mientras se cambia qué
errores llegan al usuario) y el esfuerzo en la fase 7.

### 2.4 Seguimientos fuera de alcance

Registrados para que no se filtren en este ticket y para abrirlos aparte:

1. **Reutilizar `bankChargesAccountId` como preselección en el movimiento bancario manual
   tipo `FEE` "Comisión"** (`treasury/shared/validators.ts:172-193`,
   `bank-movements/actions.server.ts:161-249`). Costo mínimo y coherente, pero 718 no lo pide;
   decidido **no** en este ticket (pregunta 1.7-3).
2. **`Supplier.defaultAccountId` como segundo nivel del fallback en compras** (ítem →
   proveedor → global) para las líneas sin ítem, típicamente las de AFIP ("el resumen de
   Edenor a Energía eléctrica, no a Compras"). Hoy ningún asiento lo lee (`schema.prisma:2147`).
   Mejora natural de la importación AFIP; ticket aparte (pregunta 1.7-4).
3. **Facturas históricas confirmadas sin asiento** (riesgo 1.6-2). La fase 6 las lista; qué
   hacer con ellas (regenerar el asiento con la fecha original, con la fecha de hoy, o
   asentarlas a mano) es una **decisión contable** de la clienta y su contador; si hay, abrir
   ticket con el listado adjunto y un script de regeneración que reutilice
   `createJournalEntryForSalesInvoice`/`ForPurchaseInvoice`.
4. **Badge "Manual" en asientos automáticos** en el listado de Asientos (detectado en TSK-717,
   sigue pendiente).
5. **Modal de movimientos de fondos desborda en móvil (375px)** (TSK-726 / seguimiento de
   TSK-717): el aviso nuevo de gastos bancarios lo hereda; no se corrige acá.
6. **`getAccountsForProductSelect` no preserva la cuenta guardada del ítem (`includeIds`)**
   (`products/shared/catalog-actions.server.ts:7-17`, riesgo 1.6-3): al editar un ítem cuya
   cuenta fue dada de baja, el combo se ve vacío. La confirmación ya la rechaza nombrando la
   cuenta (fase 3), así que el impacto es solo de UI; mismo patrón `includeIds` de
   `getActiveAccounts`, ticket chico aparte.
7. **Pre-validar también las cuentas de IVA** (por alícuota y `AccountingVatAccount`) en el
   confirm, como se hace con tributos y cuentas de línea. Con el `catch` relanzando, hoy el
   error llega igual (fase 3 lo hace explícito), pero recién dentro de la transacción.
8. **Conceptos de gastos bancarios sin cuenta con fallback al confirmar** (alternativa (ii)
   de 1.2.4): requiere `FundMovementLine.accountId` nullable y relajar `validateLines`/
   `assertLineAccounts`; descartado en este ticket, se reabre solo si la clienta lo pide.
9. **Indicador general de "configuración contable incompleta"** (1.2.2): el conteo de ítems
   sin cuenta es el primer aviso de este tipo; una vista que revise todas las cuentas
   requeridas por los asientos activos (IVA, cobrar/pagar, tributos) sería la generalización.
10. **`createJournalEntry` devuelve `Promise<string | null>` sin devolver nunca `null`**
    (`index.ts:179-182`); ajustar la firma y la de CMV (`:1155`) queda para una limpieza aparte.

## 3. Diseño

Bajada técnica de las ocho fases de la sección 2, respetando las decisiones cerradas en el
análisis (alternativa B de 1.2.6) y en la planificación (globales de ventas/compras conservadas
como "por defecto", helper puro en `commercial/shared`, pre-validación antes de la transacción,
`catch` que relanza, `bankChargesAccountId` solo como preselección, `FundMovementLine.accountId`
NOT NULL, facets + badges + conteo en settings, script de solo lectura). Todas las firmas están
listas para implementar: sin `any`, con los tipos inferidos de Prisma y de Zod, y con los nombres
exactos de los archivos que ya existen. Los ajustes respecto al plan (rutas reales de moldes,
forma de un par de firmas, un riesgo de transporte de errores) están consolidados en 3.7.

### 3.1 Arquitectura de la solución

Tres cadenas independientes, unidas por la misma idea: **la cuenta la define el ítem; la de
configuración es un respaldo declarado; nunca se imputa en silencio**.

```
CONFIGURACIÓN CONTABLE  (accounting/features/settings)                                [Fases 1 y 5]
  _CommercialIntegrationForm ── SECTIONS
        ├─ "Cuenta de ventas por defecto"   (salesAccountId,     REVENUE)   ── solo texto
        ├─ "Cuenta de compras por defecto"  (purchasesAccountId, EXPENSE)   ── solo texto
        └─ "Gastos bancarios por defecto"   (bankChargesAccountId, EXPENSE) ── campo NUEVO
  saveAccountingSettings ─▶ AccountingSettings.bankChargesAccountId ──FK SetNull──▶ Account
  ItemsWithoutAccountNotice (Server Component) ◀── getItemsWithoutAccountCounts(companyId)
        │  prisma.product.count ×2 (Prisma directo, sin importar de commercial)
        └─ [Ver] ─▶ /dashboard/commercial/products?imputation=noIncome&status=ACTIVE

VENTAS / COMPRAS → CONFIRMAR  (commercial/features/sales|purchases/.../list/actions.server.ts)   [Fases 2-3]
  confirmInvoice / confirmPurchaseInvoice
        │  include: product { name, defaultIncomeAccount|defaultExpenseAccount { id, code, name, type } }
        │  settings: salesAccount|purchasesAccount { id, code, name, type }
        ▼  ANTES de prisma.$transaction (patrón findMissingTributeAccounts, TSK-644)
  commercial/shared/line-accounts.ts  (puro, sin Prisma)
        ├─ findLinesMissingAccount(lineChecks, defaultId)        → throw buildMissingLineAccountsMessage
        ├─ resolveLineAccount(itemAccountId, defaultId)          → ids efectivos
        │     prisma.account.findMany({ ...buildImputableAccountsWhere({ companyId }), id: { in } })
        └─ findLinesWithUnavailableAccount(lineChecks, defaultId, imputableIds)
                                                                  → throw buildUnavailableLineAccountsMessage
        ▼  dentro de prisma.$transaction, SIN try/catch
  createJournalEntryForSalesInvoice / ForPurchaseInvoice  (accounting/integrations/commercial/index.ts)
        │  guard: solo receivablesAccountId | payablesAccountId → throw (antes: warn + return null)
        │  línea: resolveLineAccount(product.default…AccountId, settings.…AccountId)  (mismo helper)
        │  IVA sin cuenta → throw buildMissingTributeAccountsMessage (antes: warn + continue)
        ▼  Promise<string>  (ya no null)
  tx.salesInvoice.update({ journalEntryId })  → cualquier fallo revierte la confirmación

TESORERÍA → MOVIMIENTOS DE FONDOS  (commercial/features/treasury/features/fund-movements)         [Fase 4]
  getFundMovementCatalogs() ── defaultBankChargesAccount: { id, code, name } | null
        ▼ FundMovementsList → _FundMovementsTable → _CreateFundMovementModal (prop nueva)
  _FundMovementLinesField ── pickDefaultLineAccount(defaultAccount?.id, accounts)  (shared/lines-calc.ts)
        ├─ append({ accountId: defaultAccountId, … })      ← preselección
        └─ _BankChargesDefaultNotice { defaultAccount, available }   (3 estados)
  validateLines / assertLineAccounts / confirmFundMovement: SIN CAMBIOS

ÍTEMS  (commercial/features/products)                                                    [Fase 5]
  getProductFacetCounts() ── imputation: { noIncome, noExpense }
  getProducts({ filters: { imputation } }) ── OR de missingIncomeWhere / missingExpenseWhere
  columns.tsx "Imputación" ── missingImputations(product) → badges "Sin ingreso" / "Sin egreso"
  _ProductsTable ── facet { columnId: 'imputation', title: 'Imputación' }
```

**Decisiones de arquitectura**

1. **El helper puro vive en `src/modules/commercial/shared/line-accounts.ts`** (hermano de
   `cost-center.ts` y `perceptions.ts`) porque lo consumen tres archivos: los dos confirm de
   `sales` y `purchases` (mismo módulo) y el asiento de
   `accounting/features/integrations/commercial/index.ts`. Ese archivo **ya importa** de
   `@/modules/commercial/shared/*` (`voucher-utils`, `cost-center`, `perceptions`,
   `index.ts:35-37`), y a la inversa `sales/.../actions.server.ts:17` y
   `purchases/.../actions.server.ts:21` importan `createJournalEntryFor…` de `accounting`. Es
   un cruce bidireccional **preexistente y acotado a la integración comercial**; el diseño no
   agrega ningún import nuevo entre módulos fuera de esa pareja de archivos. El conteo de
   ítems desde `accounting/settings` se hace con `prisma.product.count` directo, sin importar
   de `commercial` (regla `module-communication.md`).
2. **La misma regla en dos lugares, con el mismo helper.** La pre-validación del confirm es la
   que llega al usuario; el `throw` dentro de `createJournalEntryFor…` es defensa en
   profundidad para los tests que llaman al asiento directo (`cost-center.integration.test.ts:394`)
   y para cualquier llamador futuro. Ambos usan `resolveLineAccount`/`findLinesMissingAccount`,
   así que no pueden divergir.
3. **La verificación de imputabilidad se hace fuera de la transacción**, con la fecha de hoy
   (`buildImputableAccountsWhere` sin `atDate`), igual que `assertLineAccounts` de fondos
   (`fund-movements/list/actions.server.ts:603-615`) y `getActiveAccounts` de settings. Decisión
   de la sección 2: el error tiene que coincidir con lo que los combos muestran hoy. A
   diferencia de TSK-717 (que resolvía dentro de `tx`), acá no hay riesgo de "foto distinta":
   entre la pre-validación y la transacción no se escribe nada que cambie cuentas.
4. **Los errores del confirm viajan como excepción** (`throw new Error(mensaje)`), igual que
   los de tributos y centro de costo que ya tiene el mismo action, y las tablas los muestran con
   `toast.error(error.message)` (`_InvoicesTable.tsx:63`, `_PurchaseInvoicesTable.tsx:130-132`).
   `bulkConfirmPurchaseInvoices` los captura por factura (`:1538-1547`) y el modal "Facturas
   que no se pudieron confirmar" (`_PurchaseInvoicesTable.tsx:308-328`) muestra `failure.message`
   tal cual. Ver el riesgo de redactado en producción en 3.7 (ajuste 9).
5. **Gastos bancarios no toca el asiento.** `bankChargesAccountId` solo viaja del catálogo al
   `append` del campo de conceptos. El servidor sigue validando `FundMovementLine.accountId`
   NOT NULL con `validateLines` y `assertLineAccounts`; `confirmFundMovement` no lee la cuenta
   nueva. Por eso `getAccountingSettings` del asiento comercial (`index.ts:73-97`) **no** suma
   `bankChargesAccount` al `include`.
6. **Facet y listado comparten el `where`** (`products/shared/imputation-filter.ts`) para que el
   conteo del filtro y las filas filtradas no diverjan (riesgo de orden de 2.2). El conteo de
   settings **duplica a propósito** los literales de `usage` (no puede importar de
   `commercial`); el test de integración de la fase 5 cubre que ambos criterios coincidan.

### 3.2 Modelos de datos

#### 3.2.1 Prisma — `model AccountingSettings` (`prisma/schema.prisma:508-640`)

Campo aditivo debajo de `defaultBankAccountId` (`:526`) y relación debajo de
`defaultBankAccount` (`:557`). Sin `onDelete` explícito: todas las relaciones de este modelo
usan el default (`SetNull` para opcionales), y la migración de TSK-644 lo confirma
(`ON DELETE SET NULL ON UPDATE CASCADE`).

```prisma
  defaultCashAccountId String? @map("default_cash_account_id") @db.Uuid // Caja por defecto
  defaultBankAccountId String? @map("default_bank_account_id") @db.Uuid // Banco por defecto
  // TSK-718: cuenta de gastos por defecto que se PRESELECCIONA en cada concepto de un
  // movimiento "Gastos e impuestos bancarios". Solo UI: el asiento usa FundMovementLine.accountId.
  bankChargesAccountId String? @map("bank_charges_account_id") @db.Uuid

  ...

  defaultCashAccount          Account? @relation("DefaultCashAccount", fields: [defaultCashAccountId], references: [id])
  defaultBankAccount          Account? @relation("DefaultBankAccount", fields: [defaultBankAccountId], references: [id])
  bankChargesAccount          Account? @relation("BankChargesAccount", fields: [bankChargesAccountId], references: [id])
```

El nombre de relación `"BankChargesAccount"` no colisiona: los nombres tomados en `Account`
(`:330-366`) son los 37 `settingsAs*` (`"SalesAccount"` … `"RecpamAccount"`),
`"AccountHierarchy"`, `"AccountDisabledFrom"`, `"PartnerOwnContributionsAccount"`,
`"ProductExpenseAccount"` y `"ProductIncomeAccount"`; `grep -n "BankCharges" prisma/schema.prisma`
hoy no devuelve nada.

Inversa en `model Account`, después de `settingsAsDefaultBankAccount` (`:337`):

```prisma
  settingsAsDefaultCashAccount     AccountingSettings[]   @relation("DefaultCashAccount")
  settingsAsDefaultBankAccount     AccountingSettings[]   @relation("DefaultBankAccount")
  settingsAsBankCharges            AccountingSettings[]   @relation("BankChargesAccount") // TSK-718
```

**Migración** `prisma/migrations/<timestamp>_tsk_718_bank_charges_account/migration.sql`,
generada con `npm run db:migrate -- --name tsk_718_bank_charges_account`. SQL esperado (mismo
formato que `20260903183104_tsk_644_percepciones_impuestos_internos/migration.sql`):

```sql
-- AlterTable
ALTER TABLE "accounting_settings" ADD COLUMN     "bank_charges_account_id" UUID;

-- AddForeignKey
ALTER TABLE "accounting_settings" ADD CONSTRAINT "accounting_settings_bank_charges_account_id_fkey" FOREIGN KEY ("bank_charges_account_id") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
```

Sin `UPDATE`, sin backfill, sin índice (ninguna otra cuenta de `AccountingSettings` lo tiene:
es una tabla de una fila por empresa). `NULL` es el estado correcto de toda empresa
preexistente: el modal sigue naciendo con el concepto vacío, exactamente como hoy. Ventas y
compras **no** requieren migración (1.2.2: los campos ya son nullables en Prisma y en Zod).

#### 3.2.2 Zod — `commercialIntegrationSchema` (`settings/validators.ts:18-58`)

```ts
  defaultCashAccountId: accountField,
  defaultBankAccountId: accountField,
  // TSK-718: se preselecciona en cada concepto de "Gastos e impuestos bancarios".
  bankChargesAccountId: accountField,
  expensesAccountId: accountField,
```

`accountField` ya es `nullish` con `transform(→ null)` (`:12-15`), así que
`CommercialIntegrationValues` gana `bankChargesAccountId: string | null` y
`CommercialIntegrationInput` gana `bankChargesAccountId?: string | null | undefined`.
`FieldName` del form (`_CommercialIntegrationForm.tsx:27`) lo incorpora por inferencia. La
garantía de compilación de TSK-492 (`defaultValues: FormValues`, `:249`) hace que
`AccountingSettings.tsx` **no compile** hasta que se agregue el campo a `defaultValues`
(3.3.2).

#### 3.2.3 TypeScript — tipos nuevos del helper de líneas (`commercial/shared/line-accounts.ts`)

```ts
/** Qué cuenta del ítem se está resolviendo: ingresos (ventas) o egresos (compras). */
export type LineAccountKind = 'income' | 'expense';

/**
 * Una línea de factura vista desde la resolución de su cuenta contable.
 * `productName === null` = línea sin ítem (solo posible en compras: gastos no
 * inventariables y comprobantes importados de AFIP).
 */
export interface LineAccountCheck {
  description: string;
  productName: string | null;
  /** `defaultIncomeAccountId` o `defaultExpenseAccountId` del ítem, según `kind`. */
  itemAccountId: string | null | undefined;
}

/** Una línea cuya cuenta efectiva existe pero hoy no es imputable. */
export interface UnavailableLineAccount<T extends LineAccountCheck> {
  line: T;
  accountId: string;
  /** De dónde salió la cuenta: del ítem o de la "Cuenta de … por defecto". */
  source: 'item' | 'default';
}

/** Lo que necesita el mensaje de "cuenta no disponible": ya con la cuenta formateada. */
export interface UnavailableLineAccountLabel {
  description: string;
  /** `code - name` de la cuenta que falla. */
  accountLabel: string;
  source: 'item' | 'default';
}
```

#### 3.2.4 TypeScript — tipos nuevos de ítems (`products/shared/imputation-filter.ts`)

```ts
import type { Prisma } from '@/generated/prisma/client';
import type { ProductUsage } from '@/generated/prisma/enums';

/** Valores del facet "Imputación" del listado (columna `imputation`). */
export type ImputationFilterValue = 'noIncome' | 'noExpense';

/** Ítems a los que les aplica la cuenta de ingresos: se venden. */
export const INCOME_USAGES: ProductUsage[] = ['SALE', 'PURCHASE_SALE'];
/** Ítems a los que les aplica la cuenta de egresos: se compran. */
export const EXPENSE_USAGES: ProductUsage[] = ['PURCHASE', 'PURCHASE_SALE'];

/** Ítem que se vende y no tiene Cuenta de Ingresos propia (cae en la por defecto). */
export const missingIncomeWhere: Prisma.ProductWhereInput = {
  usage: { in: INCOME_USAGES },
  defaultIncomeAccountId: null,
};
/** Ítem que se compra y no tiene Cuenta de Egresos propia (cae en la por defecto). */
export const missingExpenseWhere: Prisma.ProductWhereInput = {
  usage: { in: EXPENSE_USAGES },
  defaultExpenseAccountId: null,
};

/** Lo mínimo del ítem que necesita la columna "Imputación" para decidir qué badge mostrar. */
export interface ImputationCheck {
  usage: ProductUsage;
  defaultIncomeAccountId: string | null;
  defaultExpenseAccountId: string | null;
}
```

`Prisma.ProductWhereInput` es un tipo: el archivo sigue siendo puro (sin cliente Prisma) y se
puede testear con Vitest sin base.

#### 3.2.5 Tipos inferidos en `fund-movements`

`fund-movements/list/actions.server.ts:991-998`. No se declara ningún tipo nuevo:
`defaultBankChargesAccount` es `FundMovementAccountRef | null` (`:995`, ya existe para TSK-717)
y el consumidor lo infiere de `Awaited<ReturnType<typeof getFundMovementCatalogs>>`.

### 3.3 Funciones y métodos

#### 3.3.1 `saveAccountingSettings` — `settings/actions.server.ts:34-73`

Firma: solo se agrega el campo a la lista explícita, después de `defaultBankAccountId` (`:46`).
El `upsert` (`:90-97`) hace spread de `input`, no cambia.

```ts
    defaultCashAccountId?: string | null;
    defaultBankAccountId?: string | null;
    bankChargesAccountId?: string | null; // TSK-718
    expensesAccountId?: string | null;
```

#### 3.3.2 `AccountingSettingsContent` — `settings/AccountingSettings.tsx:10-114`

`defaultValues` (`:76-108`) suma una línea después de `defaultBankAccountId` (`:84`);
`configuredAccountIds` (`:14-18`) ya toma toda clave que termina en `AccountId`, así que la
cuenta guardada se preserva en el combo (`includeIds`) sin más cambios.

```ts
              defaultBankAccountId: settings?.defaultBankAccountId ?? null,
              bankChargesAccountId: settings?.bankChargesAccountId ?? null, // TSK-718
```

Fase 5: el conteo de ítems sin cuenta se carga junto a las cuentas y se renderiza arriba del
formulario de la card "Integración Comercial" (`:72`):

```tsx
async function AccountingSettingsContent({ companyId }: { companyId: string }) {
  const settings = await getAccountingSettings(companyId);
  const configuredAccountIds = /* igual que hoy, :14-18 */;
  const [accounts, itemCounts] = await Promise.all([
    getActiveAccounts(companyId, configuredAccountIds),
    getItemsWithoutAccountCounts(companyId), // TSK-721
  ]);
  ...
        <CardContent>
          <ItemsWithoutAccountNotice counts={itemCounts} className="mb-6" />
          <_CommercialIntegrationForm ... />
        </CardContent>
```

#### 3.3.3 `getItemsWithoutAccountCounts` (nueva) — `settings/actions.server.ts`

Se agrega después de `getActiveAccounts` (`:233`). Prisma directo sobre `product`, sin importar
nada de `commercial`; los literales de `usage` se repiten a propósito (decisión de 2.2).

```ts
/**
 * Cuántos ítems ACTIVOS todavía caen en la "Cuenta de ventas/compras por
 * defecto" porque no tienen la suya (TSK-721). Se cuenta por `usage`: un ítem
 * solo de compra sin cuenta de ingresos no es un problema, y viceversa.
 *
 * Prisma directo sobre `product`, sin importar de `commercial` (regla
 * `module-communication.md`): los literales de `usage` se duplican a propósito
 * respecto de `products/shared/imputation-filter.ts`. No cubre las líneas de
 * compra sin ítem (formulario "Opcional", importación AFIP), que siempre usan
 * la cuenta por defecto; el aviso lo dice.
 */
export async function getItemsWithoutAccountCounts(
  companyId: string
): Promise<{ saleItemsWithoutIncome: number; purchaseItemsWithoutExpense: number }> {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('No autenticado');
  await checkPermission('accounting.settings', 'view', { redirect: true });

  const [saleItemsWithoutIncome, purchaseItemsWithoutExpense] = await Promise.all([
    prisma.product.count({
      where: {
        companyId,
        status: 'ACTIVE',
        usage: { in: ['SALE', 'PURCHASE_SALE'] },
        defaultIncomeAccountId: null,
      },
    }),
    prisma.product.count({
      where: {
        companyId,
        status: 'ACTIVE',
        usage: { in: ['PURCHASE', 'PURCHASE_SALE'] },
        defaultExpenseAccountId: null,
      },
    }),
  ]);

  return { saleItemsWithoutIncome, purchaseItemsWithoutExpense };
}

export type ItemsWithoutAccountCounts = Awaited<ReturnType<typeof getItemsWithoutAccountCounts>>;
```

Enteros, sin `Decimal`. `select` no aplica a `count`.

#### 3.3.4 Helper puro `commercial/shared/line-accounts.ts` (nuevo, < 120 líneas)

Sin Prisma ni imports de `@/modules/*`. Encabezado del archivo:

```ts
/**
 * Cuenta contable de cada línea de factura (TSK-721 / TSK-724).
 *
 * La cuenta la define el ÍTEM (`defaultIncomeAccountId` en ventas,
 * `defaultExpenseAccountId` en compras). La "Cuenta de ventas/compras por
 * defecto" de Ajustes contables es un RESPALDO para los ítems que no tienen la
 * suya y para las líneas de compra sin ítem. Si no hay ninguna, la factura no
 * se confirma y el mensaje nombra la línea: nunca se imputa en silencio.
 *
 * Funciones puras, compartidas por `confirmInvoice`, `confirmPurchaseInvoice`
 * (pre-validación antes de la transacción, patrón `perceptions.ts:179-193`) y
 * por el asiento (`accounting/features/integrations/commercial/index.ts`,
 * defensa en profundidad).
 */
```

```ts
const KIND_LABELS: Record<LineAccountKind, { itemField: string; settingLabel: string }> = {
  income: { itemField: 'Cuenta de Ingresos', settingLabel: 'Cuenta de ventas por defecto' },
  expense: { itemField: 'Cuenta de Egresos', settingLabel: 'Cuenta de compras por defecto' },
};

/** `code - name`, como lo muestran los combos y los avisos. */
export function formatAccountLabel(account: { code: string; name: string }): string {
  return `${account.code} - ${account.name}`;
}

/**
 * Cuenta efectiva de la línea: la del ítem, o la por defecto, o ninguna.
 * Usa `||` a propósito: una cadena vacía cuenta como "sin cuenta".
 */
export function resolveLineAccount(
  itemAccountId: string | null | undefined,
  defaultAccountId: string | null | undefined
): string | null {
  return itemAccountId || defaultAccountId || null;
}

/** Líneas que no resuelven ninguna cuenta. Conserva orden y objeto original. */
export function findLinesMissingAccount<T extends LineAccountCheck>(
  lines: T[],
  defaultAccountId: string | null | undefined
): T[] {
  return lines.filter((line) => resolveLineAccount(line.itemAccountId, defaultAccountId) === null);
}

/** «descripción», más "(sin ítem)" cuando la línea no tiene ítem. */
function lineLabel(line: LineAccountCheck): string {
  return line.productName === null ? `«${line.description}» (sin ítem)` : `«${line.description}»`;
}

export function buildMissingLineAccountsMessage(
  missing: LineAccountCheck[],
  kind: LineAccountKind
): string {
  const { itemField, settingLabel } = KIND_LABELS[kind];
  const plural = missing.length !== 1;
  const sujeto = plural ? 'las líneas' : 'la línea';
  const verbo = plural ? 'tienen' : 'tiene';
  const nombres = missing.map(lineLabel).join(', ');
  const sinItem = missing.some((l) => l.productName === null)
    ? ' Las líneas sin ítem solo pueden usar la cuenta por defecto.'
    : '';

  return (
    `No se puede confirmar el comprobante: ${sujeto} ${nombres} no ${verbo} cuenta contable. ` +
    `Asignale una ${itemField} al ítem (Ítems → Imputación contable) o configurá la ` +
    `"${settingLabel}" en Contabilidad → Configuración.${sinItem}`
  );
}

/**
 * Líneas cuya cuenta efectiva NO está entre las imputables hoy. Las que no
 * tienen ninguna cuenta no aparecen acá: son de `findLinesMissingAccount`.
 */
export function findLinesWithUnavailableAccount<T extends LineAccountCheck>(
  lines: T[],
  defaultAccountId: string | null | undefined,
  availableIds: Set<string>
): UnavailableLineAccount<T>[] {
  const result: UnavailableLineAccount<T>[] = [];
  for (const line of lines) {
    const accountId = resolveLineAccount(line.itemAccountId, defaultAccountId);
    if (accountId === null || availableIds.has(accountId)) continue;
    result.push({ line, accountId, source: line.itemAccountId ? 'item' : 'default' });
  }
  return result;
}

/** Una oración por línea, unidas con espacio. Se listan todas aunque la primera alcance. */
export function buildUnavailableLineAccountsMessage(
  items: UnavailableLineAccountLabel[],
  kind: LineAccountKind
): string {
  const { settingLabel } = KIND_LABELS[kind];
  return items
    .map((item) =>
      item.source === 'item'
        ? `No se puede confirmar el comprobante: la cuenta ${item.accountLabel} del ítem de la línea ` +
          `«${item.description}» no está activa o no es imputable. Corregila en Ítems → Imputación contable.`
        : `No se puede confirmar el comprobante: la cuenta ${item.accountLabel} configurada como ` +
          `"${settingLabel}" no está activa o no es imputable. Corregila en Contabilidad → Configuración.`
    )
    .join(' ');
}
```

Textos resultantes (literales, son parte del entregable):

| Caso | Mensaje |
|---|---|
| Venta, 2 ítems sin cuenta, sin global | `No se puede confirmar el comprobante: las líneas «Aceite 10W40», «Filtro» no tienen cuenta contable. Asignale una Cuenta de Ingresos al ítem (Ítems → Imputación contable) o configurá la "Cuenta de ventas por defecto" en Contabilidad → Configuración.` |
| Compra, 1 línea sin ítem (AFIP), sin global | `No se puede confirmar el comprobante: la línea «Compra según comprobante AFIP (IVA 21%)» (sin ítem) no tiene cuenta contable. Asignale una Cuenta de Egresos al ítem (Ítems → Imputación contable) o configurá la "Cuenta de compras por defecto" en Contabilidad → Configuración. Las líneas sin ítem solo pueden usar la cuenta por defecto.` |
| Venta, cuenta del ítem dada de baja | `No se puede confirmar el comprobante: la cuenta 4.1.9 - Ventas vieja del ítem de la línea «Rodado usado» no está activa o no es imputable. Corregila en Ítems → Imputación contable.` |
| Compra, global no hoja | `No se puede confirmar el comprobante: la cuenta 5.1 - Compras configurada como "Cuenta de compras por defecto" no está activa o no es imputable. Corregila en Contabilidad → Configuración.` |

Los comentarios de `effectiveAccountType` (`cost-center.ts:24-36`) y `effectiveIsFixedAsset`
(`fixed-asset.ts:13-27`) se reescriben para decir "cuenta de ventas/compras **por defecto**" y
que "una línea sin ninguna cuenta ya no llega a confirmarse: la rechaza la pre-validación de
`line-accounts.ts`". Sin cambios de código.

#### 3.3.5 `confirmInvoice` — `sales/features/invoices/list/actions.server.ts:842-1139`

Imports nuevos (junto a `:20-32`):

```ts
import { buildImputableAccountsWhere } from '@/shared/lib/accounts/imputable-accounts';
import {
  buildMissingLineAccountsMessage,
  buildUnavailableLineAccountsMessage,
  findLinesMissingAccount,
  findLinesWithUnavailableAccount,
  formatAccountLabel,
  resolveLineAccount,
} from '@/modules/commercial/shared/line-accounts';
```

`include` (`:868-869`): `defaultIncomeAccount: { select: { id: true, code: true, name: true, type: true } }`.
`select` de settings (`:891`): `salesAccount: { select: { id: true, code: true, name: true, type: true } }`.

Bloque nuevo, inmediatamente **después** de cargar `settings` (`:898`) y **antes** del chequeo de
tributos (`:900`):

```ts
    // Cuentas de las líneas (TSK-721). La cuenta la define el ítem; la "Cuenta
    // de ventas por defecto" es el respaldo. Se comprueba ANTES de la
    // transacción, como los tributos: así el error llega al usuario con el
    // nombre de la línea en vez de quedar una factura confirmada sin asiento.
    const defaultSalesAccount = settings?.salesAccount ?? null;
    const lineChecks = invoice.lines.map((line) => ({
      description: line.description,
      productName: line.product.name,
      itemAccountId: line.product.defaultIncomeAccount?.id ?? null,
    }));

    const missingLineAccounts = findLinesMissingAccount(lineChecks, defaultSalesAccount?.id);
    if (missingLineAccounts.length > 0) {
      throw new Error(buildMissingLineAccountsMessage(missingLineAccounts, 'income'));
    }

    // La cuenta efectiva tiene que ser imputable HOY (hoja, activa, sin corte
    // de ejercicio vigente); nunca se cae a la global en silencio. Sin `types`:
    // la cuenta de un ítem puede ser ASSET (TSK-579).
    const effectiveAccountIds = [
      ...new Set(
        lineChecks
          .map((l) => resolveLineAccount(l.itemAccountId, defaultSalesAccount?.id))
          .filter((id): id is string => id !== null)
      ),
    ];
    const imputableAccounts = await prisma.account.findMany({
      where: { ...buildImputableAccountsWhere({ companyId }), id: { in: effectiveAccountIds } },
      select: { id: true },
    });
    const unavailable = findLinesWithUnavailableAccount(
      lineChecks,
      defaultSalesAccount?.id,
      new Set(imputableAccounts.map((a) => a.id))
    );
    if (unavailable.length > 0) {
      const labels = new Map<string, string>();
      for (const line of invoice.lines) {
        const account = line.product.defaultIncomeAccount;
        if (account) labels.set(account.id, formatAccountLabel(account));
      }
      if (defaultSalesAccount) labels.set(defaultSalesAccount.id, formatAccountLabel(defaultSalesAccount));

      throw new Error(
        buildUnavailableLineAccountsMessage(
          unavailable.map((u) => ({
            description: u.line.description,
            accountLabel: labels.get(u.accountId) ?? u.accountId,
            source: u.source,
          })),
          'income'
        )
      );
    }
```

El `where` efectivo es `{ companyId, isActive: true, isLeaf: true, OR: [{ disabledFrom: null },
{ disabledFrom: { gt: hoy } }], id: { in } }`: el spread no colisiona con el `OR` del helper
porque `id` es otra clave (mismo patrón que `assertLineAccounts`, `fund-movements/list/actions.server.ts:607`).

Bloque `:1077-1100` (asiento dentro de la transacción) → **sin `try/catch`**:

```ts
      // Asiento contable. TSK-721: antes solo se relanzaba "período cerrado" y
      // cualquier otro fallo del asiento se degradaba a warn, dejando la
      // factura CONFIRMED sin asiento. Ahora cualquier error aborta la
      // transacción y llega al usuario por el catch externo (:1128-1138).
      const journalEntryId = await createJournalEntryForSalesInvoice(id, companyId, tx);
      await tx.salesInvoice.update({ where: { id }, data: { journalEntryId } });
      logger.info('Asiento contable generado para factura de venta', {
        data: { invoiceId: id, journalEntryId },
      });
```

El `catch` externo (`:1128-1138`) ya relanza `Error` tal cual; no cambia. El comentario de
`getSalesDefaultAccountType` (`:606-615`) pasa a hablar de la "cuenta de ventas por defecto".

#### 3.3.6 `confirmPurchaseInvoice` — `purchases/features/invoices/list/actions.server.ts:1220-1510`

Mismos imports que 3.3.5. `include` (`:1236`): `defaultExpenseAccount: { select: { id: true,
code: true, name: true, type: true } }` (el `product` es `include`, ya trae `name`). `select`
de settings (`:1271`): `purchasesAccount: { select: { id: true, code: true, name: true, type: true } }`.

Bloque nuevo antes de `:1275`, espejo del de ventas con estas diferencias:

```ts
    const defaultPurchasesAccount = settings?.purchasesAccount ?? null;
    const lineChecks = invoice.lines.map((line) => ({
      description: line.description,
      productName: line.product?.name ?? null, // null = línea sin ítem (formulario "Opcional", AFIP)
      itemAccountId: line.product?.defaultExpenseAccount?.id ?? null,
    }));
    // ... findLinesMissingAccount(lineChecks, defaultPurchasesAccount?.id) → 'expense'
    // ... labels desde line.product?.defaultExpenseAccount y defaultPurchasesAccount
    // ... buildUnavailableLineAccountsMessage(…, 'expense')
```

Bloque `:1432-1455` → llamada directa + `update` + `logger.info`, sin `try/catch`, con el mismo
comentario. `bulkConfirmPurchaseInvoices` (`:1523-1568`) **no cambia**: ya envuelve cada
`confirmPurchaseInvoice` en `try/catch` y acumula `{ fullNumber, message }` en `failures`; la
UI ya lo muestra por factura (3.4.6). El comentario de `getPurchasesDefaultAccount` (`:583-600`)
pasa a hablar de la "cuenta de compras por defecto".

#### 3.3.7 Asiento — `accounting/features/integrations/commercial/index.ts`

Import (`:35-37`):

```ts
import { isCreditNote } from '@/modules/commercial/shared/voucher-utils';
import { expandByCostCenter } from '@/modules/commercial/shared/cost-center';
import { buildMissingTributeAccountsMessage } from '@/modules/commercial/shared/perceptions';
import {
  buildMissingLineAccountsMessage,
  findLinesMissingAccount,
  resolveLineAccount,
} from '@/modules/commercial/shared/line-accounts';
```

`createJournalEntry` (`:177-180`) pasa a `Promise<string>`: nunca devolvía `null`
(`return entry.id`, `:266`), y con eso `entryId` de ventas/compras tipa `string` sin `!`. Es
privada; CMV (`:1155-1159`) sigue declarando `Promise<string | null>` porque devuelve `null`
en `:1163-1165` — no cambia.

**Venta** (`:273-442`):

```ts
export async function createJournalEntryForSalesInvoice(
  invoiceId: string,
  companyId: string,
  tx: PrismaTransactionClient
): Promise<string> {
  ...
        lines: {
          select: {
            description: true,
            lineType: true, vatRate: true, vatAmount: true, subtotal: true,
            costCenterAllocations: { select: { costCenterId: true, percentage: true } },
            product: { select: { name: true, defaultIncomeAccountId: true, defaultCostCenterId: true } },
          },
        },
  ...
    // Guard (:311-316). Ya no exige salesAccountId: la cuenta de cada línea la
    // define el ítem y la global es solo respaldo (TSK-721). Lanza en vez de
    // devolver null: un asiento que no se puede armar tiene que abortar la
    // confirmación, no dejarla pasar sin asiento.
    if (!settings.receivablesAccountId) {
      throw new Error(
        'No se puede generar el asiento: falta configurar "Cuentas por Cobrar" en Contabilidad → Configuración.'
      );
    }
  ...
    // Defensa en profundidad: confirmInvoice ya pre-validó esto antes de la transacción.
    const missingLineAccounts = findLinesMissingAccount(
      invoice.lines.map((line) => ({
        description: line.description,
        productName: line.product.name,
        itemAccountId: line.product.defaultIncomeAccountId,
      })),
      settings.salesAccountId
    );
    if (missingLineAccounts.length > 0) {
      throw new Error(buildMissingLineAccountsMessage(missingLineAccounts, 'income'));
    }

    const expanded = expandByCostCenter(
      invoice.lines.map((line) => ({
        // El `!` está cubierto por findLinesMissingAccount, justo arriba.
        accountId: resolveLineAccount(line.product.defaultIncomeAccountId, settings.salesAccountId)!,
        subtotal: parseFloat(line.subtotal.toString()),
        ...
  ...
    for (const [rate, vatTotal] of vatByRate) {
      const accountId = getVatAccountId(settings, rate, 'DEBIT');
      if (!accountId) {
        // Antes: warn + continue → asiento descuadrado que moría en
        // validateBalance con un mensaje que no decía qué faltaba (TSK-721).
        throw new Error(buildMissingTributeAccountsMessage([`IVA Débito Fiscal ${rate}%`]));
      }
```

Mensaje resultante del IVA: `No se puede confirmar el comprobante: falta configurar la cuenta
contable de IVA Débito Fiscal 21%. Cargala en Contabilidad → Configuración antes de confirmar.`

**Compra** (`:448-620`): espejo exacto. `select` (`:467-473`) suma `description: true` y
`product: { select: { name: true, defaultExpenseAccountId: true, defaultCostCenterId: true } }`;
guard (`:486-491`) → `if (!settings.payablesAccountId) throw new Error('No se puede generar el
asiento: falta configurar "Cuentas por Pagar" en Contabilidad → Configuración.')`;
`findLinesMissingAccount(…, settings.purchasesAccountId)` con `productName: line.product?.name
?? null` y `kind: 'expense'`; `:504` → `resolveLineAccount(line.product?.defaultExpenseAccountId,
settings.purchasesAccountId)!`; IVA CF (`:534-541`) → `throw new
Error(buildMissingTributeAccountsMessage([`IVA Crédito Fiscal ${rate}%`]))`; tipo de retorno
(`:452`) → `Promise<string>`.

Encabezado (`:7-15`):

```
 * 1. Factura de Venta (confirmada):
 *    - Debe: Cuentas por Cobrar
 *    - Haber: cuenta de ingresos del ítem (o "Cuenta de ventas por defecto") + IVA Débito Fiscal
 *
 * 2. Factura de Compra (confirmada):
 *    - Debe: cuenta de egresos del ítem (o "Cuenta de compras por defecto", obligatoria para
 *      líneas sin ítem) + IVA Crédito Fiscal
 *    - Haber: Cuentas por Pagar
 *
 * Las cuentas de línea se pre-validan en `confirmInvoice`/`confirmPurchaseInvoice`
 * (TSK-721); los `throw` de este archivo son defensa en profundidad.
```

#### 3.3.8 `getFundMovementCatalogs` — `fund-movements/list/actions.server.ts:121-165`

```ts
/** Catálogos para el formulario: bancos, cajas con sesión abierta, socios (con su cuenta de aportes), cuenta de aportes por defecto y cuenta de gastos bancarios por defecto (TSK-718). */
export async function getFundMovementCatalogs() {
  ...
    prisma.accountingSettings.findUnique({
      where: { companyId },
      select: {
        partnerContributionsAccount: { select: { id: true, code: true, name: true } },
        bankChargesAccount: { select: { id: true, code: true, name: true } },
      },
    }),
  ]);

  return {
    banks: ...,
    cashRegisters: ...,
    partners: ...,
    defaultContributionsAccount: settings?.partnerContributionsAccount ?? null,
    // TSK-718: se preselecciona en cada concepto nuevo de "Gastos e impuestos
    // bancarios" si sigue imputable (lo decide `pickDefaultLineAccount` en el cliente).
    defaultBankChargesAccount: settings?.bankChargesAccount ?? null,
  };
}
```

`getFundMovementLineAccounts` (`:181-203`) no cambia: sigue devolviendo solo las imputables
EXPENSE|ASSET; si la cuenta por defecto dejó de serlo, simplemente no está en la lista y la
preselección se omite.

#### 3.3.9 `pickDefaultLineAccount` (nueva) — `fund-movements/shared/lines-calc.ts`

```ts
/**
 * Cuenta con la que nace un concepto nuevo (TSK-718): la "Gastos bancarios por
 * defecto" de Ajustes contables, pero SOLO si está entre las cuentas que el
 * combo ofrece. Preseleccionar un id que el combo no tiene deja el campo
 * "vacío" a la vista y `assertLineAccounts` lo rechaza con el mensaje genérico
 * (riesgo 1.6-6). Devuelve '' (sin cuenta) en cualquier otro caso.
 */
export function pickDefaultLineAccount(
  defaultAccountId: string | null | undefined,
  accounts: Array<{ id: string }>
): string {
  if (!defaultAccountId) return '';
  return accounts.some((account) => account.id === defaultAccountId) ? defaultAccountId : '';
}
```

#### 3.3.10 Propagación de la prop hasta el campo de líneas

| Archivo | Cambio |
|---|---|
| `FundMovementsList.tsx:29-38` | `defaultBankChargesAccount={catalogs.defaultBankChargesAccount}` |
| `_FundMovementsTable.tsx:33-42` (Props), `:44-53`, `:128-136`, `:139-148` | `defaultBankChargesAccount: FundMovementAccountRef \| null;` y pasarla a los dos modales |
| `_CreateFundMovementModal.tsx:63-73` (Props), `:79-88`, `:455` | `/** Cuenta de gastos bancarios por defecto (Ajustes contables); null si no está configurada (TSK-718). */ defaultBankChargesAccount: FundMovementAccountRef \| null;` y `<_FundMovementLinesField accounts={lineAccounts} defaultAccount={defaultBankChargesAccount} />` |

#### 3.3.11 `getProducts` y `getProductFacetCounts` — `products/features/list/actions.server.ts`

Import nuevo: `import { missingExpenseWhere, missingIncomeWhere } from '../../shared/imputation-filter';`

`getProducts` (`:38-79`):

```ts
    const filtersWhere = buildFiltersWhere(filters, {
      type: 'type',
      status: 'status',
    }, { exclude: ['name', 'code', 'category', 'stockLevel', 'imputation'] });
    ...
    // Filtro "Imputación" (TSK-721): sin cuenta de ingreso / sin cuenta de egreso,
    // según el uso del ítem. Los dos valores juntos se combinan con OR.
    const imputationFilter = filters['imputation'] ?? [];
    const imputationConditions: Prisma.ProductWhereInput[] = [
      ...(imputationFilter.includes('noIncome') ? [missingIncomeWhere] : []),
      ...(imputationFilter.includes('noExpense') ? [missingExpenseWhere] : []),
    ];
    const imputationWhere: Prisma.ProductWhereInput =
      imputationConditions.length > 0 ? { OR: imputationConditions } : {};

    const where: Prisma.ProductWhereInput = {
      companyId,
      ...filtersWhere,
      ...textWhere,
      ...categoryWhere,
      ...imputationWhere,
    };
```

`textWhere` ya usa `AND` (`:66`) y `imputationWhere` usa `OR`: claves distintas, sin colisión en
el spread. `getProductFacetCounts` (`:158-180`):

```ts
  const [typeCounts, statusCounts, noIncome, noExpense] = await Promise.all([
    prisma.product.groupBy({ by: ['type'], where: { companyId }, _count: { type: true } }),
    prisma.product.groupBy({ by: ['status'], where: { companyId }, _count: { status: true } }),
    prisma.product.count({ where: { companyId, ...missingIncomeWhere } }),
    prisma.product.count({ where: { companyId, ...missingExpenseWhere } }),
  ]);

  return {
    type: Object.fromEntries(typeCounts.map((t) => [t.type, t._count.type])),
    status: Object.fromEntries(statusCounts.map((s) => [s.status, s._count.status])),
    // TSK-721. Sin filtrar por status, coherente con `type`/`status`.
    imputation: { noIncome, noExpense },
  };
```

#### 3.3.12 `missingImputations` (nueva) — `products/shared/imputation-filter.ts`

```ts
/**
 * Qué cuentas le faltan a un ítem SEGÚN SU USO: a uno solo de compra no le
 * falta la de ingresos, y viceversa. Lo usa la columna "Imputación" para los
 * badges "Sin ingreso" / "Sin egreso" (TSK-721).
 */
export function missingImputations(product: ImputationCheck): ImputationFilterValue[] {
  const missing: ImputationFilterValue[] = [];
  if (INCOME_USAGES.includes(product.usage) && !product.defaultIncomeAccountId) missing.push('noIncome');
  if (EXPENSE_USAGES.includes(product.usage) && !product.defaultExpenseAccountId) missing.push('noExpense');
  return missing;
}
```

#### 3.3.13 Script `prisma/scripts/diagnose-invoices-without-entry.ts` (nuevo, solo lectura)

Molde `diagnose-fixed-asset-accounts.ts:1-30` (`import 'dotenv/config'` + `prisma` de
`../../src/shared/lib/prisma`, "SOLO LEE", cómo correrlo).

```ts
interface InvoiceWithoutEntry {
  companyId: string;
  companyName: string;
  kind: 'venta' | 'compra';
  fullNumber: string;
  voucherType: string;
  issueDate: Date;
  total: number;
  status: string;
}

interface CompanySummary {
  companyId: string;
  companyName: string;
  sales: { count: number; total: number };
  purchases: { count: number; total: number };
  rows: InvoiceWithoutEntry[];
}

/** "Confirmada" = todo lo que no es borrador ni anulada: CONFIRMED, PAID, PARTIAL_PAID. */
const CONFIRMED_STATUSES = { notIn: ['DRAFT', 'CANCELLED'] } as const;

async function findInvoicesWithoutEntry(): Promise<CompanySummary[]>;
async function main(): Promise<void>; // imprime por empresa: conteo + suma por tipo y el detalle
```

Consultas: `prisma.salesInvoice.findMany` / `prisma.purchaseInvoice.findMany` con `where: {
status: CONFIRMED_STATUSES, journalEntryId: null }`, `select: { companyId: true, company: {
select: { name: true } }, fullNumber: true, voucherType: true, issueDate: true, total: true,
status: true }`, `orderBy: [{ companyId: 'asc' }, { issueDate: 'asc' }]`; `total: Number(...)`;
fecha con `moment.utc(issueDate).format('DD/MM/YYYY')`. Sin `UPDATE`, sin `INSERT`, sin
`revalidatePath`. Encabezado con el SQL equivalente para `psql` en producción (columnas
verificadas contra `schema.prisma`: `sales_invoices`/`purchase_invoices`, `status`,
`journal_entry_id`, `full_number`, `voucher_type`, `issue_date`, `total`, `companies.name`):

```sql
-- Detalle
SELECT c.name AS empresa, 'venta' AS tipo, s.full_number, s.voucher_type, s.issue_date::date, s.total, s.status
FROM sales_invoices s JOIN companies c ON c.id = s.company_id
WHERE s.status NOT IN ('DRAFT','CANCELLED') AND s.journal_entry_id IS NULL
UNION ALL
SELECT c.name, 'compra', p.full_number, p.voucher_type, p.issue_date::date, p.total, p.status
FROM purchase_invoices p JOIN companies c ON c.id = p.company_id
WHERE p.status NOT IN ('DRAFT','CANCELLED') AND p.journal_entry_id IS NULL
ORDER BY 1, 2, 5;

-- Resumen por empresa
SELECT company_id, 'venta' AS tipo, count(*), sum(total) FROM sales_invoices
WHERE status NOT IN ('DRAFT','CANCELLED') AND journal_entry_id IS NULL GROUP BY 1
UNION ALL
SELECT company_id, 'compra', count(*), sum(total) FROM purchase_invoices
WHERE status NOT IN ('DRAFT','CANCELLED') AND journal_entry_id IS NULL GROUP BY 1;

-- Ítems activos sin cuenta, por uso (dato previo a vaciar la global; análisis 1.2.3)
SELECT usage,
       count(*) FILTER (WHERE default_income_account_id IS NULL)  AS sin_ingreso,
       count(*) FILTER (WHERE default_expense_account_id IS NULL) AS sin_egreso,
       count(*) AS total
FROM products WHERE company_id = '<PMS>' AND status = 'ACTIVE' GROUP BY 1;
```

Comando de producción (memoria `produccion-dokploy-scripts-db`): `sudo docker exec -it $(sudo
docker ps -q --filter name=contablemas-contablemas) sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"'`.

### 3.4 Interfaces de usuario

#### 3.4.1 `_CommercialIntegrationForm.tsx` — constantes `SECTIONS` (`:56-239`)

Solo cambian entradas de la constante; el render (`:336-363`) es genérico. La sección "Cuentas
de Resultado" mantiene título y sin descripción (decisión de la sección 2: `expensesAccountId`
no es "por defecto").

```ts
  {
    title: 'Cuentas de Resultado',
    fields: [
      {
        name: 'salesAccountId',
        label: 'Cuenta de ventas por defecto',
        types: ['REVENUE'],
        help: 'Se usa en las líneas de facturas de venta cuyo ítem no tiene Cuenta de Ingresos propia (Ítems → Imputación contable). Si todos los ítems de venta tienen la suya, puede quedar sin asignar.',
      },
      {
        name: 'purchasesAccountId',
        label: 'Cuenta de compras por defecto',
        types: ['EXPENSE'],
        help: 'Se usa en las líneas de facturas de compra cuyo ítem no tiene Cuenta de Egresos propia y en las líneas sin ítem (gastos no inventariables, comprobantes importados de AFIP). Si cargás compras sin ítem, tiene que estar asignada.',
      },
      { name: 'expensesAccountId', label: 'Cuenta de Gastos Operativos', types: ['EXPENSE'], help: 'Se usa al confirmar gastos operativos (Debe)' },
    ],
  },
  ...
  {
    title: 'Cuentas de Tesorería (Opcional)',
    fields: [
      { name: 'defaultCashAccountId', label: 'Caja por Defecto', types: ['ASSET'], help: 'Se usa si la caja no tiene cuenta específica asignada' },
      { name: 'defaultBankAccountId', label: 'Banco por Defecto', types: ['ASSET'], help: 'Se usa si la cuenta bancaria no tiene cuenta específica asignada' },
      {
        name: 'bankChargesAccountId',
        label: 'Gastos bancarios por defecto',
        types: ['EXPENSE'],
        help: 'Se preselecciona en cada concepto de un movimiento "Gastos e impuestos bancarios". Podés cambiarla concepto por concepto; los conceptos que son activo (Sircreb) se eligen a mano.',
      },
    ],
  },
```

El combo ofrece solo `EXPENSE` por `accountsFor(field.types)` (`:313-314`) sobre las cuentas
imputables + configuradas que trae `getActiveAccounts`. Grilla `md:grid-cols-2` existente: a
375px cada campo ocupa el ancho completo. El archivo (376 líneas, deuda previa) crece ~8 líneas.

#### 3.4.2 `ItemsWithoutAccountNotice.tsx` (nuevo) — `accounting/features/settings/components/`

Server Component **sin** prefijo `_` (usa `PermissionGuard`, que es async; no tiene estado ni
handlers). < 70 líneas. Se monta en `AccountingSettings.tsx` dentro del `CardContent` de
"Integración Comercial", arriba de `_CommercialIntegrationForm` (3.3.2).

```tsx
import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import Link from 'next/link';

import { PermissionGuard } from '@/shared/components/common/PermissionGuard';
import { cn } from '@/shared/lib/utils';
import type { ItemsWithoutAccountCounts } from '../actions.server';

interface ItemsWithoutAccountNoticeProps {
  counts: ItemsWithoutAccountCounts;
  className?: string;
}

const ITEMS_HREF = '/dashboard/commercial/products';

/** Conteo de ítems activos que caen en la cuenta por defecto, con enlace al listado filtrado (TSK-721). */
export function ItemsWithoutAccountNotice({ counts, className }: ItemsWithoutAccountNoticeProps) {
  const { saleItemsWithoutIncome: noIncome, purchaseItemsWithoutExpense: noExpense } = counts;
  ...
}
```

Estados y textos literales:

- **Ambos en 0** — bloque neutro (`rounded-md border bg-muted/50 p-3 text-sm text-muted-foreground`,
  ícono `CheckCircle2`, `role="status"`):
  «Todos los ítems activos tienen su cuenta de ingresos y de egresos. Las cuentas por defecto
  solo se usan en líneas de compra sin ítem.»
- **Alguno > 0** — bloque naranja (`rounded-md border border-orange-500/50 bg-orange-500/10 p-3
  text-sm text-orange-600`, ícono `AlertTriangle`, `role="status"`), una fila por conteo > 0 y una
  aclaración:
  - «**{N}** {N === 1 ? 'ítem activo de venta' : 'ítems activos de venta'} sin Cuenta de
    Ingresos → [Ver]» con `Link` a `${ITEMS_HREF}?imputation=noIncome&status=ACTIVE`.
  - «**{M}** {M === 1 ? 'ítem activo de compra' : 'ítems activos de compra'} sin Cuenta de
    Egresos → [Ver]» con `Link` a `${ITEMS_HREF}?imputation=noExpense&status=ACTIVE`.
  - «Mientras existan, las facturas de esos ítems se imputan a la cuenta por defecto; sin ella,
    no se pueden confirmar. Imputalos desde Ítems → seleccionar → Editar en Lote, o uno por uno
    con Imputación contable.»

Cada `[Ver]` va envuelto en `<PermissionGuard module="commercial.products" action="view"
fallback={null}>`: sin permiso, el conteo se ve sin enlace (1.5). El `Link` lleva
`className="underline"` como en `_PartnerAccountNotice.tsx:39`. Textos con "Editar en Lote" e
"Imputación contable" tal como figuran en `_ProductsTable.tsx:223` y `columns.tsx:320`.

#### 3.4.3 `_BankChargesDefaultNotice.tsx` (nuevo) — `fund-movements/list/components/`

Client Component (< 60 líneas), mismas clases `neutral`/`warning` y `label()` de
`_PartnerAccountNotice.tsx:15-22`, `Link` a `/dashboard/company/accounting/settings`.

```tsx
interface BankChargesDefaultNoticeProps {
  /** "Gastos bancarios por defecto" de Ajustes contables; `null` si no está configurada. */
  defaultAccount: FundMovementAccountRef | null;
  /** Si la cuenta por defecto está entre las que el combo ofrece hoy (imputable, egreso/activo). */
  available: boolean;
}

export function _BankChargesDefaultNotice({ defaultAccount, available }: BankChargesDefaultNoticeProps): JSX.Element;
```

| Estado | Estilo | Texto literal |
|---|---|---|
| `defaultAccount && available` | neutro, `Info`, `role="status"` | «Los conceptos nuevos se imputan a **{code} - {name}** (cuenta de gastos bancarios por defecto). Podés cambiar la cuenta en cada fila.» |
| `defaultAccount && !available` | naranja, `AlertTriangle`, `role="status"` | «La cuenta de gastos bancarios por defecto **{code} - {name}** ya no está disponible (dada de baja o no imputable): elegí la cuenta en cada concepto o corregila en [Ajustes contables].» |
| `!defaultAccount` | naranja, `AlertTriangle`, `role="status"` | «No hay cuenta de gastos bancarios por defecto: elegí la cuenta en cada concepto o configurala en [Ajustes contables].» |

Ninguno bloquea (hoy ya se opera sin la cuenta); por eso los tres usan `role="status"` y no
`role="alert"`. `{code} - {name}` va en `<span className="font-mono">`.

#### 3.4.4 `_FundMovementLinesField.tsx` (`:14-17`, `:31-36`, `:51`, `:58-60`, `:114-117`)

```tsx
import { pickDefaultLineAccount, sumLines, type FundMovementLineInput } from '../../shared/lines-calc';
import type { FundMovementAccountRef } from '../actions.server';
import { _BankChargesDefaultNotice } from './_BankChargesDefaultNotice';

interface FundMovementLinesFieldProps {
  /** Cuentas imputables de tipo egreso o activo (ya filtradas por el servidor). */
  accounts: AccountOption[];
  /** "Gastos bancarios por defecto" de Ajustes contables; se preselecciona en cada concepto nuevo (TSK-718). */
  defaultAccount?: FundMovementAccountRef | null;
}

export function _FundMovementLinesField({ accounts, defaultAccount = null }: FundMovementLinesFieldProps) {
  ...
  // '' si no hay cuenta por defecto o si ya no está entre las imputables (riesgo 1.6-6).
  const defaultAccountId = pickDefaultLineAccount(defaultAccount?.id, accounts);
  ...
          onClick={() => append({ accountId: defaultAccountId, description: '', amount: '' })}
  ...
      {fields.length === 0 ? (
        <p className="text-sm text-muted-foreground">Agregá al menos un concepto</p>
      ) : ( ... total ... )}

      <_BankChargesDefaultNotice defaultAccount={defaultAccount} available={defaultAccountId !== ''} />
```

El aviso se renderiza **siempre** (con y sin conceptos), debajo del bloque, para que se vea antes
del primer "Agregar concepto". La preselección aplica solo a `append`; el `reset` del modal en
edición sigue cargando las cuentas guardadas del borrador. El archivo pasa de 121 a ~135 líneas.

#### 3.4.5 Ítems — `columns.tsx:237-271` y `_ProductsTable.tsx:44-47, 140-190`

Columna "Imputación" (mantiene `id: 'imputation'`, `meta.title`, `enableSorting: false`):

```tsx
      cell: ({ row }) => {
        const product = row.original;
        const income = product.defaultIncomeAccount;
        const expense = product.defaultExpenseAccount;
        const missing = missingImputations(product); // según usage (TSK-721)
        return (
          <div className="flex flex-col gap-0.5 text-xs">
            {income && (<span className="whitespace-nowrap"><span className="text-muted-foreground">Ing:</span>{' '}<span className="font-mono">{income.code}</span></span>)}
            {expense && (<span className="whitespace-nowrap"><span className="text-muted-foreground">Egr:</span>{' '}<span className="font-mono">{expense.code}</span></span>)}
            {missing.includes('noIncome') && (
              <Badge variant="outline" className="w-fit border-orange-500 text-orange-600 text-xs whitespace-nowrap">
                <AlertTriangle className="mr-1 h-3 w-3" />Sin ingreso
              </Badge>
            )}
            {missing.includes('noExpense') && (
              <Badge variant="outline" className="w-fit border-orange-500 text-orange-600 text-xs whitespace-nowrap">
                <AlertTriangle className="mr-1 h-3 w-3" />Sin egreso
              </Badge>
            )}
          </div>
        );
      },
```

El badge "Sin imputar" desaparece: un ítem `PURCHASE_SALE` sin ninguna cuenta muestra los dos
badges; un ítem solo de compra sin cuenta de ingresos no muestra nada por ingresos. `Product`
(`products/shared/types.ts:32-71`) ya trae `usage`, `defaultIncomeAccountId` y
`defaultExpenseAccountId`, así que cumple `ImputationCheck` sin mapear.

`_ProductsTable.tsx`:

```ts
interface FacetCounts {
  type: Record<string, number>;
  status: Record<string, number>;
  /** TSK-721: conteo por valor del facet "Imputación" (`noIncome` / `noExpense`). */
  imputation?: Record<string, number>;
}
...
      {
        columnId: 'imputation',
        title: 'Imputación',
        options: [
          { value: 'noIncome', label: 'Sin cuenta de ingreso' },
          { value: 'noExpense', label: 'Sin cuenta de egreso' },
        ],
        externalCounts: facetCounts?.imputation ? new Map(Object.entries(facetCounts.imputation)) : undefined,
      },
```

Va después de `stockLevel` (`:178-187`). El toolbar exige que exista `table.getColumn('imputation')`
(`DataTableToolbar.tsx:67-68`): la columna ya tiene ese `id`. El filtro serializa a la URL como
`?imputation=noIncome` o `?imputation=noIncome,noExpense` (`helpers.ts:82-86`) y `parseSearchParams`
lo devuelve como `filters.imputation: string[]` (`:44-49`). `ProductsList.tsx:21-31` ya pasa
`facetCounts` completo.

#### 3.4.6 Mensajes que ve el usuario al confirmar

| Dónde | Cómo se muestra | Texto |
|---|---|---|
| Venta, `_InvoicesTable.tsx:57-63` | `toast.error(error.message)` | los cuatro de la tabla de 3.3.4 con `kind: 'income'` |
| Compra, `_PurchaseInvoicesTable.tsx:118-132` | `toast.error(error.message)` | ídem con `kind: 'expense'` |
| Compra masiva, `_PurchaseInvoicesTable.tsx:93-96, 308-328` | `toast.warning("Se confirmaron N facturas; M no se pudieron confirmar")` + modal "Facturas que no se pudieron confirmar" con `fullNumber` y `message` por factura | el mismo mensaje por factura |
| Guard del asiento (defensa) | `toast.error` | `No se puede generar el asiento: falta configurar "Cuentas por Cobrar" en Contabilidad → Configuración.` / `"Cuentas por Pagar"` |
| IVA sin cuenta (dentro de la transacción, ahora llega) | `toast.error` | `No se puede confirmar el comprobante: falta configurar la cuenta contable de IVA Débito Fiscal 21%. Cargala en Contabilidad → Configuración antes de confirmar.` |
| Período cerrado (sin cambios) | `toast.error` | `No se puede generar el asiento contable: el período está cerrado para la fecha DD/MM/YYYY. …` |

#### 3.4.7 Responsive y modo oscuro

- `ItemsWithoutAccountNotice`: `flex items-start gap-2`; las filas de conteo en `flex flex-wrap
  gap-x-1`; a 375px el texto envuelve y el `[Ver]` baja de línea. Colores por tokens
  (`bg-muted/50`, `text-muted-foreground`, `border-orange-500/50 bg-orange-500/10 text-orange-600`),
  los mismos que ya se ven bien en oscuro en `_PartnerAccountNotice`.
- `_BankChargesDefaultNotice`: hereda el ancho del modal; el desborde del modal a 375px es
  TSK-726 (seguimiento 5 de 2.4), no se corrige acá.
- Badges de la columna: `w-fit` para que no se estiren en la celda; `whitespace-nowrap` como el
  actual "Sin imputar".
- Campo nuevo del formulario: grilla `md:grid-cols-2` existente.

### 3.5 Rutas y navegación

No hay rutas nuevas ni cambios en el sidebar. Rutas existentes involucradas, bajo
`src/app/(core)/dashboard/`:

| Ruta | Archivo | Qué cambia |
|---|---|---|
| `/dashboard/company/accounting/settings` | `company/accounting/settings/page.tsx` | labels/ayudas "por defecto", campo "Gastos bancarios por defecto", bloque `ItemsWithoutAccountNotice` |
| `/dashboard/commercial/products` | `commercial/products/page.tsx` | facet "Imputación", badges "Sin ingreso"/"Sin egreso" |
| `/dashboard/commercial/products?imputation=noIncome&status=ACTIVE` | ídem | destino del [Ver] de ítems de venta sin Cuenta de Ingresos |
| `/dashboard/commercial/products?imputation=noExpense&status=ACTIVE` | ídem | destino del [Ver] de ítems de compra sin Cuenta de Egresos |
| `/dashboard/commercial/invoices` | `commercial/invoices/page.tsx` | toast nuevo al confirmar |
| `/dashboard/commercial/purchases` | `commercial/purchases/page.tsx` | toast nuevo al confirmar; modal de fallos del lote |
| `/dashboard/commercial/treasury/fund-movements` | `commercial/treasury/fund-movements/page.tsx` | preselección + `_BankChargesDefaultNotice` en el modal |

Query params del filtro de ítems: `imputation` = `noIncome` \| `noExpense` \| `noIncome,noExpense`
(`stateToSearchParams` une con coma, `helpers.ts:82-86`); `status=ACTIVE` reutiliza el facet
existente. `commercial/products/page.tsx:9-15` tipa `searchParams` solo con `page`/`search`/
`pageSize`, pero reenvía el objeto completo a `ProductsList`, que lo parsea con
`parseSearchParams` (toda clave no reservada es filtro): los facets `type`/`status` ya llegan
por URL de esa manera, así que `imputation` también. Los enlaces que emiten los avisos apuntan a
`/dashboard/company/accounting/settings` (Ajustes contables) y a las dos URLs filtradas de ítems.

### 3.6 APIs / Endpoints

No aplica. No se crean API Routes: todo son Server Actions ya listadas en 3.3
(`saveAccountingSettings`, `getItemsWithoutAccountCounts`, `confirmInvoice`,
`confirmPurchaseInvoice`, `bulkConfirmPurchaseInvoices`, `getFundMovementCatalogs`,
`getProducts`, `getProductFacetCounts`) más funciones internas (`createJournalEntryFor…`).

### 3.7 Consideraciones técnicas

#### Ajuste de alcance decidido al arrancar la implementación (2026-09-18): resultado `{ success, error }` en los confirm

El riesgo señalado más abajo ("Next redacta los `throw new Error` de Server Actions en producción", TSK-481) invalida el objetivo del ticket: los mensajes «la línea «X» no tiene cuenta contable» no llegarían a la clienta en prod. TSK-481 ya resolvió esto en fund-movements con `BusinessError` + `toActionResult()` → `{ success: true } | { success: false; error }` (`fund-movements/list/actions.server.ts:38-66`), consumido por el modal con `toast.error(result.error)`.

Decisión: **incluir en la Fase 3**
1. Promover `BusinessError` y `toActionResult` a `src/shared/lib/action-result.ts` (exportando también el tipo `ActionResult<T = void>`); fund-movements pasa a importarlos de ahí (su alias local `FundMovementActionResult` puede quedar como `= ActionResult<{ id?: string }>`).
2. `confirmInvoice(id)` y `confirmPurchaseInvoice(id)` devuelven `ActionResult` en vez de `void`/`throw`: la pre-validación de cuentas, imputabilidad, IVA, período cerrado y "factura no encontrada/ya confirmada" lanzan `BusinessError` y se traducen con `toActionResult`; los fallos inesperados se loguean y devuelven el mensaje genérico.
3. Los dos consumidores (`_InvoicesTable.tsx:58` y `_PurchaseInvoicesTable.tsx`) pasan de `try/catch` a `if (!result.success) toast.error(result.error)`.
4. Los bulk confirm no cambian de forma (ya reportan `failures[{fullNumber, message}]`), pero internamente reutilizan el mismo camino para obtener `message` legible.

Verificación en Fase 8: además de `npm run dev`, correr `npm run build && npm run start` y confirmar que el toast muestra el mensaje real (no el digest).



#### Permisos (regla 11)

| Action | `checkPermission` | Estado |
|---|---|---|
| `getItemsWithoutAccountCounts` (nueva) | `('accounting.settings', 'view', { redirect: true })` | nuevo |
| `getAccountingSettings`, `getActiveAccounts`, `saveAccountingSettings` | `('accounting.settings', 'view' / 'update')` | ya existe (`:17`, `:202`, `:76`) |
| `confirmInvoice` | `('commercial.invoices', 'approve')` | ya existe (`:843`) |
| `confirmPurchaseInvoice`, `bulkConfirmPurchaseInvoices` | `('commercial.purchases', 'approve')` | ya existe (`:1221`, `:1524`) |
| `getFundMovementCatalogs`, `getFundMovementLineAccounts` | `('commercial.treasury.fund-movements', 'view')` | ya existe (`:123`, `:182`) |
| `getProducts`, `getProductFacetCounts` | `('commercial.products', 'view')` | ya existe (`:29`, `:159`) |

Módulos de `src/shared/lib/permissions/constants.ts:29, 35, 36, 49, 86`. Páginas: `AccountingSettings.tsx:121`,
`ProductsList.tsx:34`, `FundMovementsList.tsx:19` ya tienen `PermissionGuard … redirect`. El
enlace [Ver] del aviso usa `PermissionGuard module="commercial.products" action="view"
fallback={null}` (`PermissionGuard.tsx:60-78`). No hay módulos nuevos que registrar en
`ACTIVATABLE_MODULES`.

#### Tests (Vitest, `npm run test`)

**`settings/validators.test.ts`** (fase 1): `'cubre las 30 cuentas configurables'` (`:76-81`) →
**31** con comentario `// + gastos bancarios por defecto (TSK-718)`; caso nuevo
`'guarda la cuenta de gastos bancarios por defecto y la limpia con __clear__'`
(`CUENTA` → `CUENTA`; `'__clear__'` → `null`; ausente → `null`).

**`commercial/shared/line-accounts.test.ts`** (nuevo, sin base, fase 2; mínimo 14 casos):

1. `resolveLineAccount('item', 'global')` → `'item'`; `(null, 'global')` → `'global'`;
   `(undefined, null)` → `null`; `('', 'global')` → `'global'`.
2. `findLinesMissingAccount`: con global no falta ninguna aunque los ítems no tengan cuenta;
   sin global devuelve solo las que no tienen cuenta, en orden y con el objeto original (genérico
   `T`); una línea sin ítem (`productName: null`) sin global aparece.
3. `buildMissingLineAccountsMessage(…, 'income')` contiene `No se puede confirmar el comprobante`,
   `«Aceite 10W40», «Filtro»`, `Cuenta de Ingresos`, `Ítems → Imputación contable`,
   `"Cuenta de ventas por defecto"`; con `'expense'` contiene `Cuenta de Egresos` y `"Cuenta de
   compras por defecto"`; con una línea sin ítem agrega `(sin ítem)` y `Las líneas sin ítem solo
   pueden usar la cuenta por defecto.`; singular `la línea … no tiene` / plural `las líneas … no tienen`.
4. `findLinesWithUnavailableAccount`: devuelve `{ line, accountId, source: 'item' }` cuando la
   cuenta del ítem no está en el set y `source: 'default'` cuando cae en la global y esta no
   está; no devuelve líneas sin cuenta ni líneas cuya cuenta sí está.
5. `buildUnavailableLineAccountsMessage`: `source: 'item'` → contiene `del ítem de la línea «X»`,
   `no está activa o no es imputable`, `Corregila en Ítems → Imputación contable`; `source:
   'default'` → `configurada como "Cuenta de ventas por defecto"`, `Corregila en Contabilidad →
   Configuración`; dos ítems → dos oraciones unidas con espacio. `formatAccountLabel({ code:
   '4.1', name: 'Ventas' })` → `'4.1 - Ventas'`.

**`sales/features/invoices/list/sales-invoice-line-accounts.integration.test.ts`** (nuevo,
fase 3). Andamiaje de `purchase-invoice-tributes.integration.test.ts:22-70` (`import
'dotenv/config'`, `describe.skipIf(!dbAvailable)` con `SELECT 1`, los cuatro `vi.mock`:
`@/shared/lib/current-user`, `@/shared/lib/company`, `@/shared/lib/permissions` con
`checkPermission: vi.fn().mockResolvedValue(undefined)`, `next/cache`), prefijo `TSK721-SALE-`.
`sales/.../actions.server.ts:7` importa **solo** `checkPermission` de permisos, así que el mock
de reemplazo total alcanza; si alguna dependencia transitiva importa constantes, pasar al patrón
`importOriginal` de `company/features/general/roles/role-members.integration.test.ts:34-37`.

- `beforeAll`: empresa; cuentas `Ventas` (REVENUE/CREDIT), `Cobrar` (ASSET/DEBIT), `IVA DF`
  (LIABILITY/CREDIT), `Ventas rodados` (REVENUE), `Ventas vieja` (REVENUE); `AccountingSettings`
  con `receivablesAccountId`, `vatDebitAccountId`, `salesAccountId: Ventas`; `contractor` y
  `salesPointOfSale` como `cost-center.integration.test.ts:183-191`; productos con
  **`trackStock: false`** (`confirmInvoice:965-978` exige almacén si no): `conCuenta`
  (`defaultIncomeAccountId: Ventas rodados`), `sinCuenta` (`null`), `cuentaVieja`
  (`defaultIncomeAccountId: Ventas vieja`). Facturas con `prisma.salesInvoice.create` en `DRAFT`
  (molde `cost-center.integration.test.ts:348-391`: `subtotal`, `netTaxed`, `vatAmount`, `total`,
  `totalBeforeDiscount`, `discountTotal`, `createdBy`, `number` único por `pointOfSaleId +
  voucherType`) y confirmación con el **`confirmInvoice` real**.
- Casos: (1) `conCuenta` con `salesAccountId: null` → confirma; Haber en `Ventas rodados`,
  ninguna línea en `Ventas`; (2) `sinCuenta` con global vacía → `rejects.toThrow(/«.*sinCuenta.*»/)`,
  mensaje contiene `Cuenta de ventas por defecto`; sigue `DRAFT` con `journalEntryId: null`;
  (3) `sinCuenta` con global → confirma contra `Ventas`; (4) `cuentaVieja` tras
  `account.update({ isActive: false })` → rechaza con el `code` de `Ventas vieja` y `no está
  activa o no es imputable`; sin líneas en `Ventas`; restaurar; (5) NC `NOTA_CREDITO_A` de
  `conCuenta` → Debe `Ventas rodados`, Haber `Cobrar`; (6) guard:
  `prisma.$transaction((tx) => createJournalEntryForSalesInvoice(id, companyId, tx))` con
  `receivablesAccountId: null` → `rejects.toThrow(/Cuentas por Cobrar/)`; restaurar.
- `afterAll`: `salesInvoice → journalEntry → product → contractor → salesPointOfSale →
  accountingSettings → account → company`, y `count` por prefijo en `company.name`.

**`purchases/features/invoices/list/purchase-invoice-line-accounts.integration.test.ts`**
(nuevo, fase 3). Mismo andamiaje, prefijo `TSK721-PURC-`, entrando por
`createPurchaseInvoice` + `confirmPurchaseInvoice` reales (molde
`purchase-invoice-tributes.integration.test.ts:147-236`; una línea sin `productId` es válida en
`purchaseInvoiceFormSchema`). `beforeAll`: cuentas `Compras` (EXPENSE), `Pagar` (LIABILITY),
`IVA CF` (ASSET), `Repuestos` (EXPENSE), `Compras vieja` (EXPENSE); settings con
`payablesAccountId`, `vatCreditAccountId`, `purchasesAccountId: Compras`; proveedor; productos
`conCuenta`, `sinCuenta`, `cuentaVieja`. Casos: (1) línea sin ítem + global → confirma, Debe en
`Compras`; (2) línea sin ítem + global vacía → rechaza; mensaje con la descripción, `(sin ítem)`,
`Cuenta de compras por defecto` y `Las líneas sin ítem solo pueden usar la cuenta por defecto`;
sigue `DRAFT` sin asiento; (3) `conCuenta` + global vacía → Debe en `Repuestos`; (4) `cuentaVieja`
dada de baja → rechaza nombrando ítem y cuenta, sin fallback; (5) global apuntando a cuenta con
`isLeaf: false` + línea sin ítem → rechaza con `configurada como "Cuenta de compras por defecto"`;
(6) `bulkConfirmPurchaseInvoices([sinCuenta, conCuenta])` con global vacía → `confirmedCount: 1`,
`failures[0].message` con la descripción de la línea. `afterAll` como el test de tributos
(`:131-145`) más `product.deleteMany`.

**`fund-movements/shared/lines-calc.test.ts`** (fase 4): `describe('pickDefaultLineAccount')`:
devuelve el id si está entre las cuentas; `''` con `null`/`undefined`; `''` si el id no está
(dada de baja / no imputable); indiferente al orden de `accounts`.

**`fund-movements/list/fund-movement-lines.integration.test.ts`** (fase 4): `describe('caso 6: la
cuenta de gastos bancarios por defecto llega al formulario (TSK-718)')`: `beforeAll` con
`accountingSettings.update({ bankChargesAccountId: commissionAccountId })` (la cuenta EXPENSE del
andamiaje, `:140, :186`); `getFundMovementCatalogs()` devuelve `defaultBankChargesAccount` con
`{ id, code, name }` de esa cuenta; con `null` devuelve `null`; restaurar.

**`products/features/list/product-imputation-filter.integration.test.ts`** (nuevo, fase 5).
Molde `products/features/price-lists/detail/apply-index.integration.test.ts:32-38` (usa el
`vi.mock` de permisos **con `importOriginal`**), prefijo `TSK721-PROD-`. `beforeAll`: empresa,
una cuenta REVENUE y una EXPENSE, ítems `ventaSin` (`usage: 'SALE'`), `compraSin` (`PURCHASE`),
`ambosOk` (`PURCHASE_SALE`, ambas), `ambosSinIngreso` (`PURCHASE_SALE`, solo egreso), todos con
`createdBy`. Casos: `getProductFacetCounts()` → `imputation: { noIncome: 2, noExpense: 1 }`;
`getProducts({ filters: { imputation: ['noIncome'] } })` → exactamente `ventaSin` y
`ambosSinIngreso`; `['noExpense']` → `compraSin`; `['noIncome', 'noExpense']` → los tres. Caso
extra: el conteo de `getItemsWithoutAccountCounts(companyId)` (importado de
`@/modules/accounting/features/settings/actions.server`, solo en el test) coincide con el facet
para ítems `ACTIVE`, para atar los dos literales de `usage` duplicados.

**`products/shared/imputation-filter.test.ts`** (nuevo, fase 5): `missingImputations` para los
cuatro `usage`×cuentas: `SALE` sin ninguna → `['noIncome']`; `PURCHASE` sin ninguna →
`['noExpense']`; `PURCHASE_SALE` sin ninguna → ambos; `PURCHASE_SALE` con ambas → `[]`.

**Regresiones a vigilar**: `cost-center.integration.test.ts` y `perceptions.integration.test.ts`
configuran `receivablesAccountId`/`payablesAccountId` (`:150-166` y `:141-144`) y todos sus
ítems tienen cuenta; `expect(entryId).not.toBeNull()` sigue compilando con `Promise<string>`.
`purchase-invoice-tributes.integration.test.ts` tiene `purchasesAccountId` y líneas sin ítem:
pasa por la global.

#### Reglas del proyecto

- **Decimal → Number**: no hay decimales nuevos; los conteos son enteros; el script convierte
  `total` con `Number()` solo para imprimir.
- **Logger**: `logger.info` en los dos confirm conserva `{ invoiceId, journalEntryId }`; los dos
  `logger.warn('No se pudo generar asiento contable…')` y los dos `logger.warn('… cuentas no
  configuradas')` desaparecen (criterio de completitud de la fase 3). Ningún `console.*`.
- **Prefijo `_`**: `_BankChargesDefaultNotice.tsx` es Client Component (usa `next/link` dentro
  de un form cliente). `ItemsWithoutAccountNotice.tsx` es Server Component (sin `_`) porque usa
  `PermissionGuard` async; no tiene interactividad.
- **< 200 líneas**: `_BankChargesDefaultNotice` < 60; `ItemsWithoutAccountNotice` < 70;
  `_FundMovementLinesField` 121 → ~135; `line-accounts.ts` < 120; `imputation-filter.ts` < 60.
  `_CommercialIntegrationForm.tsx` (376), `_CreateFundMovementModal.tsx` (533), `columns.tsx`
  (341), `_ProductsTable.tsx` (347) y los tres `actions.server.ts` grandes son deuda previa y
  crecen menos de ~20 líneas cada uno.
- **Textos en español con acentos**; los mensajes de error y de aviso son parte del entregable y
  están literales en 3.3.4, 3.3.7, 3.4.1, 3.4.2, 3.4.3 y 3.4.6.
- **No importar entre módulos**: el único cruce es el preexistente `accounting/integrations/commercial`
  ↔ `commercial/shared` (3.1-1); el conteo de settings usa Prisma directo; `products/shared/
  imputation-filter.ts` lo importan solo `products/features/list/*`. El test de facets importa
  `getItemsWithoutAccountCounts` de `accounting` **solo como test**, no en código de producción.
- **AlertDialog / moment**: no hay confirmaciones nuevas; la única fecha nueva es la del script
  (`moment.utc(...).format('DD/MM/YYYY')`, fuera de la app).
- **Migración en producción**: la aplica `docker-entrypoint.sh` al deployar (memoria
  `produccion-dokploy-scripts-db`); no hay script manual.

#### Ajustes respecto al plan

1. **Ruta del molde del test de facets.** El plan (fase 5) cita
   `price-lists/detail/apply-index.integration.test.ts`; la ruta real es
   `src/modules/commercial/features/products/features/price-lists/detail/apply-index.integration.test.ts`.
   Ese molde usa el `vi.mock` de permisos con `importOriginal` (`:34-37`), que es el que hay que
   copiar para el test nuevo de productos.
2. **No existe un test e2e de ventas equivalente al de tributos de compras** (el pedido de diseño
   suponía uno). El molde para crear facturas de venta directo con Prisma es
   `cost-center.integration.test.ts:348-391` y el de andamiaje/mocks es
   `purchase-invoice-tributes.integration.test.ts:22-70`; el test nuevo de ventas combina ambos.
   El plan ya lo decía así en fase 3; se confirma que no hay otro molde.
3. **`createJournalEntry` pasa a `Promise<string>`.** El plan dejaba abierto "usar `if (!entryId)
   throw` o ajustar su firma". Se ajusta la firma de la función privada (`index.ts:177-180`),
   que ya devolvía siempre `entry.id`; es el cambio de menos código y deja a
   `createJournalEntryForSalesInvoice`/`ForPurchaseInvoice` en `Promise<string>` sin `!`. CMV
   (`:1155-1159`) conserva `Promise<string | null>` (seguimiento 10 de 2.4 sigue abierto para
   esa función).
4. **Sin `lineNumber` en el modelo.** El pedido de diseño sugería un `lineNumber` en el tipo de
   entrada del helper para decir "línea N sin ítem". `SalesInvoiceLine`/`PurchaseInvoiceLine`
   (`schema.prisma:2882-2909`, `:3010-3040`) no tienen ese campo y `description` es obligatoria
   (`min(1)` en ambos validators), así que la línea se nombra por su descripción, como decía el
   plan, y las líneas sin ítem se marcan con el sufijo literal `(sin ítem)` (además de la frase
   final del plan). No se agrega `lineNumber`.
5. **Forma del tipo de entrada del helper.** El pedido sugería `LineForAccountResolution` con
   `product: { id, name, defaultIncomeAccountId | defaultExpenseAccountId } | null` y un
   parámetro `usage`. Se mantiene la forma del plan (`LineAccountCheck { description;
   productName; itemAccountId }` + `kind`), porque desacopla al helper de qué cuenta del ítem se
   está resolviendo: el llamador mapea `defaultIncomeAccount?.id` o `defaultExpenseAccount?.id`
   a `itemAccountId` y el helper es uno solo para ventas, compras y asiento. Se agrega
   `formatAccountLabel` (no estaba en el plan) para armar `code - name` en un solo lugar.
6. **Nombre del retorno de `getItemsWithoutAccountCounts`.** El pedido sugería `{ noIncome;
   noExpense }`; se mantiene el del plan (`{ saleItemsWithoutIncome; purchaseItemsWithoutExpense }`),
   que dice por sí solo que el conteo es por `usage`. Los valores del facet de ítems sí son
   `noIncome`/`noExpense` (plan, fase 5).
7. **Título del facet.** El pedido decía "Imputación contable"; el plan fija `title: 'Imputación'`,
   igual que el `meta.title` de la columna a la que se ancla (`columns.tsx:239`). Se respeta el
   plan.
8. **`where` de imputabilidad con spread, no con `AND`.** El pedido sugería `{ AND:
   [buildImputableAccountsWhere(...), { id: { in } }] }`; se usa `{ ...buildImputableAccountsWhere({
   companyId }), id: { in } }` como el plan y como `assertLineAccounts`
   (`fund-movements/list/actions.server.ts:607`). Son equivalentes: el helper devuelve `OR` y el
   spread solo agrega la clave `id`.
9. **Riesgo a verificar en fase 8 — transporte de errores en producción.** Los errores del
   confirm viajan como `throw new Error(mensaje)` (plan, fase 3), igual que los de tributos
   (TSK-644) y centro de costo (TSK-583) que ya tiene el mismo action. El análisis de TSK-481
   (`.planes/tickets-abiertos-2026-08.md:94-98`) documenta que en build de producción Next
   **redacta** el mensaje de un `Error` lanzado desde un Server Action y el cliente ve "An error
   occurred in the Server Components render… digest"; fund-movements lo resolvió con
   `{ success: false, error }` (`actions.server.ts:34-65`). Este diseño **no** cambia el
   transporte de `confirmInvoice`/`confirmPurchaseInvoice` (sería un cambio transversal a los
   errores ya existentes de esos actions, fuera de alcance), pero la fase 8 debe verificar el
   toast en un build local (`npm run build && npm run start`) y no solo en `npm run dev`. Si el
   mensaje se redacta, abrir ticket para migrar los dos confirm al patrón `FundMovementActionResult`
   antes de anunciar el cambio de comportamiento a la clienta.
10. **`commercial/products/page.tsx` tipa `searchParams` de forma estrecha** (`page`, `search`,
    `pageSize`, `:9-15`), pero reenvía el objeto completo; los facets `type`/`status` ya llegan
    por URL así. No se toca `app/` (regla 6); se anota para no sorprenderse en `check-types`
    (no hay error: el tipo es más angosto que el valor, no incompatible).

## 4. Implementación

### Fase 1: Esquema, migración y configuración contable
- **Estado:** Completada (2026-09-18)
- **Archivos modificados:**
  - `prisma/schema.prisma` - `AccountingSettings.bankChargesAccountId` + relación `"BankChargesAccount"`; inversa `settingsAsBankCharges` en `Account`.
  - `prisma/migrations/20260918212043_tsk_718_bank_charges_account/migration.sql` - creado: ADD COLUMN + FK `ON DELETE SET NULL`. Sin backfill.
  - `settings/validators.ts` - `bankChargesAccountId: accountField`.
  - `settings/validators.test.ts` - el conteo pasa a 31 cuentas; caso nuevo para el campo (vacío/''/uuid).
  - `settings/actions.server.ts` - `bankChargesAccountId?: string | null` en el input de `saveAccountingSettings` (el update ya hace `...input`; `getAccountingSettings` devuelve la fila completa).
  - `settings/AccountingSettings.tsx` - `bankChargesAccountId` en `defaultValues`.
  - `settings/components/_CommercialIntegrationForm.tsx` - Ventas/Compras pasan a "Cuenta de ventas por defecto" / "Cuenta de compras por defecto" con las ayudas del diseño; campo nuevo "Gastos bancarios por defecto" (EXPENSE) en "Cuentas de Tesorería (Opcional)".
- **Notas:** SQL idéntico al esperado en 3.2.1. En producción la migración la aplica solo el `docker-entrypoint.sh` al arrancar; no hay datos que migrar. Vitest settings 10/10; check-types sin errores nuevos (mismo conjunto antes/después).

### Fase 2: Helper puro de cuentas de línea
- **Estado:** Pendiente

### Fase 3: Confirmación de ventas y compras
- **Estado:** Pendiente

### Fase 4: Gastos bancarios — cuenta por defecto preseleccionada
- **Estado:** Pendiente

### Fase 5: Visibilidad — ítems sin cuenta y conteo en Ajustes
- **Estado:** Pendiente

### Fase 6: Script de diagnóstico
- **Estado:** Pendiente

### Fase 7: Documentación
- **Estado:** Pendiente

### Fase 8: Verificación final
- **Estado:** Pendiente

## 5. Verificación
_Pendiente - ejecutar `/verificar tsk-721-cuentas-por-defecto-ventas-compras-bancarios`_
