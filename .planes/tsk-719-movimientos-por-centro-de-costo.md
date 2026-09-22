# TSK-719: Movimientos por centro de costo (entradas y salidas)

**Fecha de inicio:** 2026-09-22
**Ticket:** [719] "Centros de Costo — Tenemos que habilitar los movimientos Entradas y Salidas"
**Origen:** reunión con Elizabeth Perez del 16-17/09 (nota interna)
**Estado:** Implementación en progreso (Fases 1-5 de 7 completadas)

---

## 1. Análisis

### 1.1 Problema

Hoy **Empresa → Centros de Costo** (`/dashboard/company/cost-centers`,
`src/app/(core)/dashboard/company/cost-centers/page.tsx`) es un ABM de una sola columna: la tabla
tiene exactamente una columna visible, **Nombre**, más el menú de acciones Editar/Eliminar
(`src/modules/company/features/cost-centers/list/columns.tsx:27-38` y `:41-86`). El modal de alta
y edición tiene un único campo, también el nombre
(`.../list/components/_CostCenterFormModal.tsx`; el input de la action es
`CreateCostCenterInput { name: string }`, `.../list/actions.server.ts:19-21`). **No hay pantalla de
detalle ni ruta `[id]`**: la carpeta de app tiene un solo `page.tsx` y la feature tiene una sola
sub-carpeta, `list/`.

Es decir: el usuario puede crear el centro "Logística", puede imputarle líneas de factura (TSK-583),
puede asignarlo a empleados y equipos… y **no tiene ningún lugar donde ver qué se le imputó**. El
"mayor del centro de costo" no existe: el Libro Mayor agrupa por cuenta
(`getGeneralLedger`, `src/modules/accounting/features/reports/actions.server.ts:226-337`) y **ni
siquiera lee `costCenterId`** — su `include: { lines: true }` (`:272`) trae el campo pero el armado
del reporte solo filtra por `line.accountId` (`:281-292`). Un `grep costCenterId` sobre `src/`
confirma que **ningún reporte, ninguna pantalla y ninguna query de lectura** consulta
`JournalEntryLine.costCenterId`: los únicos lugares que lo tocan son los que **escriben** el asiento
(`integrations/commercial/index.ts:269`, `:397`, `:581`) y el que lo valida como auxiliar obligatorio
(`entries/validators/index.ts:113-117`).

Lo que pide el ticket es, entonces, **la única mitad que falta del circuito de centros de costo**: el
dato ya se guarda desde TSK-583, pero no se puede leer. "Entradas y Salidas" es el vocabulario de la
clienta para lo que contablemente son los ingresos y los egresos imputados al centro.

### 1.2 Contexto actual

#### 1.2.1 Qué es un centro de costo hoy y dónde se imputa

`model CostCenter` (`prisma/schema.prisma:1040-1060`) tiene **solo** `id`, `name`, `isActive`,
timestamps y `companyId`; `@@unique([companyId, name])` (`:1058`). No tiene código, ni jerarquía
(padre/hijo), ni tipo, ni responsable, ni presupuesto propio. El borrado es lógico:
`deleteCostCenter` hace `update { isActive: false }` (`.../list/actions.server.ts:213-216`), y todas
las lecturas filtran `isActive: true` (`getCostCentersPaginated:47`, `getAllCostCenters:80`,
`getCostCentersForSelect:104`).

Lo referencian seis cosas (`schema.prisma:1053-1056` son las inversas):

| Referencia | Ubicación | ¿Genera asiento con el centro? |
|---|---|---|
| `JournalEntryLine.costCenterId` | `schema.prisma:454`, relación `:461` | **Sí — es el único dato contable** |
| `Employee.costCenterId` | `schema.prisma:1893-1894` | No. Solo dato del legajo (`_WorkInfoTab.tsx`) |
| `Vehicle.costCenterId` | `schema.prisma:2040-2041` | No. Solo ficha del equipo |
| `Product.defaultCostCenterId` | `schema.prisma:2294`, `:2306` | Indirectamente: es el centro por defecto del ítem |
| `PurchaseInvoiceLineCostCenter` | `schema.prisma:3065-3078` | Sí, vía reparto por porcentaje (TSK-583) |
| `SalesInvoiceLineCostCenter` | `schema.prisma:3081-3094` | Sí, ídem |
| `AccountingSettings.requireCostCenter` | `schema.prisma:647` | Es el switch de obligatoriedad |

**No existe liquidación de sueldos ni ningún proceso que impute el centro del empleado o del equipo a
un asiento**: los centros de `Employee` y `Vehicle` son informativos. Esto es importante para la
expectativa de la clienta (ver 1.6).

`requireCostCenter` es el switch "Exigir centro de costo" de Contabilidad → Configuración →
Integración Comercial (`settings/components/_CommercialIntegrationForm.tsx:378-389`, Zod
`settings/validators.ts:59`). **Solo exige reparto en líneas de resultado**: la regla vive en
`src/modules/commercial/shared/cost-center.ts`, `RESULT_ACCOUNT_TYPES = ['REVENUE','EXPENSE']`
(`:11`) y `allowsCostCenter` (`:18-23`), y se aplica en la pre-validación de confirmación de
factura de venta (`sales/features/invoices/list/actions.server.ts:1008-1026`) y de compra
(`purchases/features/invoices/list/actions.server.ts:1398`). Confirmado: **el centro de costo, por
diseño, solo cuelga de cuentas de resultado.**

#### 1.2.2 De dónde salen hoy las líneas de asiento con centro de costo

Solo **dos** generadores, ambos en `src/modules/accounting/features/integrations/commercial/index.ts`:

1. **Factura de venta** — `createJournalEntryForSalesInvoice` (`:294`). Trae las líneas con
   `costCenterAllocations { costCenterId, percentage }` y `product.defaultCostCenterId` (`:317`),
   arma las imputaciones con `expandByCostCenter` (`:383-390`) y escribe `costCenterId` en cada
   línea de resultado del asiento (`:391-397`, `...(costCenterId && { costCenterId })`).
2. **Factura de compra** — `createJournalEntryForPurchaseInvoice` (`:489`), espejo exacto
   (`:512`, `:567-581`).

`expandByCostCenter` (`commercial/shared/cost-center.ts:187-224`) **agrupa por `cuenta + centro`**:
si hay reparto, prorratea con `prorateAmount` (el último centro absorbe el redondeo, `:104-121`); si
no hay reparto, cae en `defaultCostCenterId` del ítem; si el ítem tampoco tiene, la línea del asiento
queda **sin centro**.

**No generan líneas con centro de costo** (verificado con `grep -c costCenter`, resultado 0 en ambos
archivos):

- `accounting/features/integrations/treasury/index.ts` → **movimientos de fondos NO** (coincide con
  lo anotado en `.planes/tsk-583-centros-de-costo-multiples.md:201`: "Órdenes de compra, remitos,
  gastos y movimientos de fondos: no reciben reparto en esta [etapa]").
- `accounting/features/integrations/equipment/index.ts` → **depreciaciones de equipos NO**, aunque el
  `Vehicle` tenga centro asignado.
- Dentro del mismo `commercial/index.ts`: recibo (`:686`), orden de pago (`:820`), gasto (`:962`) y
  CMV (`:1204`) **no** pasan `costCenterId`.
- Cierre de ejercicio, ajuste por inflación, saldos de apertura, asientos recurrentes, liquidación de
  IVA y diferencias de cambio: ninguno lo escribe.

**Asiento manual**: el Zod lo admite (`accounting/shared/types/index.ts:33`,
`costCenterId: z.string().uuid().optional()`) y la action lo persiste
(`entries/actions.server.ts:62`), e incluso hay una validación que lo **exige** cuando la cuenta
tiene `requiresAuxiliary = 'COST_CENTER'` (`entries/validators/index.ts:113-117`). Pero
**el formulario de carga no ofrece el campo**: `_CreateEntryModal.tsx` arma cada línea solo con
`{ accountId, debit, credit, description }` (`:55-56`, `:173`) y no tiene ningún selector de centro
(`grep costCenter` en ese archivo: 0 resultados). Conclusión práctica: **hoy, por UI, el centro de
costo solo se puede imputar desde facturas de venta y de compra.**

#### 1.2.3 Reportes existentes: el molde a copiar

Los 12 reportes viven en `src/modules/accounting/features/reports/`. El registro es totalmente
manual y en tres lugares:

1. `components/_ReportsSelector.tsx:7-20` — el union type `ReportType`.
2. El array del grupo correspondiente (`financialReports:26-66`, `taxReports`, `budgetReports:80-87`,
   `fixedAssetReports`, `auditReports`) con `{ id, name, description, icon }`.
3. `components/_ReportsContent.tsx:57-100` — un `{selectedReport === 'x' && <_XReport companyId={…} />}`.

El shell (`ReportsList.tsx`) resuelve `getActiveCompanyId()` y envuelve todo en
`<PermissionGuard module="accounting.reports" action="view" redirect>`; la ruta
`src/app/(core)/dashboard/company/accounting/reports/page.tsx` además hace
`checkPermission('accounting.reports','view')`. Cada action del archivo repite
`checkPermission('accounting.reports','view',{redirect:true})` (p. ej. `actions.server.ts:229`).

**`_GeneralLedgerReport.tsx` es el molde exacto** para este ticket:

- Estado local con `useState` para `fromDate`/`toDate` inicializados con moment
  (`moment().startOf('month')` y `moment()`), `isLoading`, `data` y `expandedRows` (`:30-38`).
- `handleSubmit` llama directamente a la server action (`getGeneralLedger(companyId, new Date(from),
  new Date(to))`) dentro de `try/catch` con `logger.error` (`:40-55`). **No usa React Query** — es la
  convención de esta carpeta, contra la regla 3 del CLAUDE.md; el único que sí usa `useQuery` es
  `_BudgetVarianceReport.tsx:43-48`, y solo para poblar el selector de ejercicios.
- Export a Excel: aplana los datos a filas (`handleExport`, `:57-149`), define `ExcelColumn[]` con
  `formatter` por columna y llama `exportToExcel(flatData, columns, { filename, sheetName, title,
  includeDate })` (`@/shared/lib/excel-export`). Las fechas se formatean con `formatDateUtc`
  (`@/shared/utils/formatters:52-58`, `moment.utc(...).format('DD/MM/YYYY')` — TSK-725) y los importes
  con `formatAmount` (`@/modules/accounting/shared/utils/index.ts:94`).
- Tabla HTML plana (no DataTable) con filas expandibles por cuenta y **saldo acumulado** recalculado
  línea a línea según `account.nature` (`actions.server.ts:294-313`), más una fila "Saldo anterior"
  cuando `openingBalance !== 0`.

**`_BudgetVarianceReport.tsx` no sirve como molde de "por centro"**: el presupuesto es **por cuenta**,
no por centro de costo — `model Budget` tiene `accountId` y `@@unique([companyId, accountId,
fiscalYear])` (`schema.prisma:475-497`), y `getBudgetVarianceReport` agrupa el ejecutado por
`jel.account_id` (`actions.server.ts:1185-1205`). No hay ninguna relación Budget↔CostCenter. Lo que
sí aporta es el **patrón del selector**: `useQuery` para cargar las opciones + `<Select>` de shadcn
(`:43-48`, `:164-167`), que es lo que hace falta para elegir el centro. `_MonthlyVATReport.tsx:110-117`
tiene otro `<Select>` simple.

#### 1.2.4 Semántica de "entrada" y "salida": opciones y recomendación

El dato disponible por línea es: `debit`, `credit` (`schema.prisma:444-445`, `Decimal(12,2)`) y la
cuenta, con `Account.type` (enum `ASSET|LIABILITY|EQUITY|REVENUE|EXPENSE`, `schema.prisma:220-228`) y
`Account.nature` (`DEBIT|CREDIT`, `:231-236`). La base garantiza que **nunca hay debe y haber en la
misma línea**: constraint `chk_jel_debit_or_credit` (`debit>0 AND credit=0 OR credit>0 AND debit=0`).

- **(a) Por naturaleza de la cuenta** (REVENUE → entrada, EXPENSE → salida). Es lo que la clienta
  entiende, y es consistente con que el centro de costo *solo* cuelga de cuentas de resultado
  (1.2.1). **Falla sola**: una nota de crédito de venta **debita** una cuenta REVENUE
  (`isCreditNote` invierte Debe/Haber, `commercial/shared/voucher-utils.ts`; se usa en
  `integrations/commercial/index.ts:309` y `:484`), y con el criterio (a) crudo esa devolución
  aparecería como "entrada" sumando en vez de restando.
- **(b) Por debe/haber** (Debe → salida, Haber → entrada). Es simple y se autocorrige con las NC,
  pero **miente en cuanto entra una cuenta que no es de resultado**: si mañana un asiento manual
  imputa un anticipo (ASSET) a un centro, el Debe aparecería como "salida" del centro sin serlo. Y
  nombra "salida" a lo que el contador llama Debe, duplicando vocabulario.
- **(c) Las dos: clasificar por tipo/naturaleza de cuenta y firmar por debe/haber.** ← **recomendada.**

**Regla concreta recomendada** (una línea, dos columnas, nunca las dos a la vez):

```
si Account.nature = CREDIT  (REVENUE, y también LIABILITY/EQUITY si llegaran)
    entrada = credit - debit        // NC de venta ⇒ negativo, resta de las entradas
si Account.nature = DEBIT   (EXPENSE, y también ASSET)
    salida  = debit - credit        // NC de compra ⇒ negativo, resta de las salidas

saldo del centro = Σ entradas − Σ salidas   (el resultado que aporta el centro)
```

Usar `nature` y no `type` hace la regla total (cubre los 5 tipos) sin un `else` arbitrario, y coincide
con cómo el Libro Mayor ya calcula el saldo (`actions.server.ts:299-303`). En la práctica, con los
datos que el sistema genera hoy, `nature=CREDIT` ⟺ REVENUE y `nature=DEBIT` ⟺ EXPENSE, así que la
lectura de la clienta ("entradas = ingresos, salidas = gastos") se cumple exactamente.

**Columnas propuestas para la tabla de detalle:**

| Fecha | Asiento N° | Cuenta (código – nombre) | Descripción | Entrada | Salida | Saldo acumulado |
|---|---|---|---|---|---|---|

`Debe` y `Haber` **no** van en la tabla (9 columnas no entran en la card de 2/3 de ancho de
`_ReportsContent`), pero **sí en el Excel**, que es donde el contador quiere cruzar contra el Libro
Mayor. Si se muestran borradores (1.2.5), se suma una columna/badge **Estado**.

#### 1.2.5 DRAFT vs POSTED — la decisión más delicada

`JournalEntry.status` es `JournalEntryStatus @default(DRAFT)` (`schema.prisma:394`; enum
`DRAFT|POSTED|REVERSED`, `:239-245`) y `createJournalEntry` del integrador comercial **no setea
status** (`integrations/commercial/index.ts:252-276`), así que **todo asiento automático nace
DRAFT** y solo pasa a POSTED por `postJournalEntry` (`entries/actions.server.ts:112`, permiso
`accounting.entries` acción `approve`).

**Todos los reportes contables filtran `status = POSTED`**: Libro Diario (`actions.server.ts:192`),
Libro Mayor (`:254` en el SQL de saldo anterior y `:268` en los movimientos del período), Estado de
Resultados (`:528`), Variación Presupuestaria (`:1201`). El de Reversiones filtra `REVERSED` (`:691`).

Esto produce el malentendido que ya se le explicó dos veces a la clienta: **confirma facturas, se
generan los asientos, y los reportes muestran cero** porque quedaron en borrador. Si el reporte nuevo
saliera solo con POSTED, en el estado actual de la base **mostraría vacío siempre** (ver 1.2.6).

**Recomendación:** el reporte se queda en **POSTED por defecto** (coherencia con el resto: si el
mismo período da distinto en el Mayor y acá, el reporte pierde toda autoridad), **más**:

1. Un **switch "Incluir borradores"** (apagado por defecto) que amplía a `status IN ('DRAFT','POSTED')`
   y agrega la columna Estado con badge. `REVERSED` nunca entra.
2. Un **aviso permanente** cuando el período consultado tiene asientos DRAFT con líneas del centro:
   *"Hay N asientos en borrador con movimientos de este centro por $X que no están incluidos.
   Registralos desde Contabilidad → Asientos para que impacten."* — el mismo patrón de alerta
   explicativa que TSK-717 dejó en `_PartnerAccountNotice.tsx` y que TSK-728 usó en la confirmación.
   El conteo sale de la misma query (un `GROUP BY status`), sin costo extra.

Sin el punto 2, este reporte es la tercera vez que la clienta va a reportar "no muestra nada".

#### 1.2.6 Datos en dev

Consultado el 2026-09-22 contra `contable-pms-db` / `contable_pms`:

| Dato | Valor |
|---|---|
| `cost_centers` totales | **8** (6 en "Empresa Demo S.A.", 2 en "Empresa de Prueba 01 SA"; todos `is_active = true`) |
| `journal_entry_lines` con `cost_center_id` | **2** |
| Estado de esos asientos | **DRAFT (2 líneas, $100.000 de debe, $0 de haber)** |
| `journal_entries` totales | **22, todos DRAFT. Cero POSTED.** |
| `sales_invoice_line_cost_centers` | 0 |
| `purchase_invoice_line_cost_centers` | 2 |
| `products` con `default_cost_center_id` | 1 |

Las dos líneas son el reparto de TSK-583 de una sola factura de compra: asiento N° 8 del 28/08/2026,
"Factura de compra 0001-00000001", cuenta `4.2.1/01/00 Combustible` (EXPENSE), $60.000 a Logística y
$40.000 a Mantenimiento, en la empresa de dev "Empresa de Prueba 01 SA".

**Consecuencias prácticas:**

- **No se puede demostrar nada en el navegador sin sembrar.** Con el filtro POSTED por defecto el
  reporte sale vacío; con "incluir borradores" sale una sola cuenta y dos filas, sin ninguna entrada
  (no hay una sola línea de ingreso con centro en toda la base).
- Para las capturas del PDF de presentación (ver memoria `guia-presentacion-cliente-por-ticket`) hay
  que **sembrar en la etapa de verificación**: al menos una factura de **venta** con reparto entre dos
  centros, una de compra ídem, una nota de crédito de venta (para lucir el signo de 1.2.4) y
  **registrar** (POSTED) los asientos, más dejar uno en borrador a propósito para mostrar el aviso.
- El entorno de capturas ya está documentado en la memoria `dev-local-capturas-y-login`
  (`NEXT_PUBLIC_APP_URL=http://localhost:3010 npm run dev -- -p 3010`, usuario
  `fspiritosi@codecontrol.com.ar`, empresa activa "Empresa de Prueba 01 SA" — que es justamente la
  que tiene los datos).

#### 1.2.7 Dónde vive la pantalla

- **Empresa → Centros de Costo** (`_AppSidebar.tsx:368-372`, grupo "General" de Empresa) usa el permiso
  `company.cost-centers` (`shared/lib/permissions/constants.ts:60`, label "Centros de Costo" `:160`).
  Es donde Elizabeth estaba mirando cuando dijo "habilitar los movimientos". En el mapa de módulos
  activables, `company.cost-centers` pertenece al módulo **`employees`**
  (`shared/lib/modules/constants.ts:83`) — dato no obvio y con efecto real: si una empresa desactiva
  el módulo de empleados, pierde la pantalla de centros de costo.
- **Contabilidad → Informes** (`/dashboard/company/accounting/reports`, `_AppSidebar.tsx:107-108`) usa
  `accounting.reports` (`constants.ts:85`, label "Informes" `:182`). Es donde el contador ya busca
  Mayor, Diario y Variación Presupuestaria.

Son **dos permisos distintos**: un usuario administrativo con `company.cost-centers` puede no tener
`accounting.reports`, y viceversa. Cualquier solución que cruce las dos pantallas tiene que respetar
ambos (con `usePermissions()` en el cliente para el link, y `checkPermission` en la action).

#### 1.2.8 Export, totales y comparativa "todos los centros"

Todos los reportes de la carpeta exportan a Excel con el mismo helper (`@/shared/lib/excel-export`,
`exportToExcel` + `ExcelColumn`), así que **este también debe hacerlo** o va a ser el raro. El molde
de aplanado está en `_GeneralLedgerReport.tsx:57-149` (filas de detalle + fila TOTAL).

Además del detalle de un centro conviene una **vista "Todos los centros"**: un `GROUP BY cost_center_id`
con Entradas / Salidas / Saldo por centro es una sola query barata y responde la pregunta que la
clienta va a hacer inmediatamente después ("¿cuál me consume más?"). Propuesta: cuando el selector
está en "Todos", el reporte muestra esa comparativa con filas expandibles al detalle — exactamente la
mecánica de `expandedRows` que ya tiene el Mayor (`_GeneralLedgerReport.tsx:38`, `:151-159`).

**Totales:** total de entradas, total de salidas y saldo del período (tarjetas arriba de la tabla) y
saldo acumulado por fila. Un subtotal **por mes** es deseable pero **no** se recomienda para la
primera entrega: agrega agrupamiento y complica el export, y el ticket no lo pide.

Dos cosas que conviene contemplar en la query desde el diseño:

- **Sin centro**: una opción "(Sin centro de costo)" que liste las líneas de resultado **no imputadas**
  es el complemento natural — es lo que deja ver el agujero cuando `requireCostCenter` está apagado.
  Barato (es `costCenterId IS NULL` + `account.type IN ('REVENUE','EXPENSE')`), pero es alcance extra:
  queda como pregunta abierta (1.7).
- **Centros dados de baja**: `getCostCentersForSelect` filtra `isActive: true`
  (`cost-centers/list/actions.server.ts:104`), así que un centro eliminado desaparece del selector
  **aunque conserve movimientos históricos** (el FK es `ON DELETE SET NULL`, pero el borrado es lógico,
  así que las líneas siguen apuntando a él). El selector del reporte debe incluir los inactivos que
  tengan movimientos, o el histórico se vuelve inalcanzable.

#### 1.2.9 Guías y documentación existentes

- **Guía de usuario in-app** (`src/modules/help/features/guide/components/`): centros de costo se
  mencionan hoy en `_CompanyGuide.tsx:300` (ítem suelto "Centros de costo" en una lista) y `:529`;
  en `_AccountingGuide.tsx:537-543` (el switch "Exigir centro de costo"); en
  `_CommercialGuide.tsx:160`, `:403`, `:497-520` (el reparto por línea de TSK-583); y en
  `_EmployeesGuide.tsx:63`. **El listado de informes está en `_AccountingGuide.tsx:426-445`**, y ahí
  va el ítem nuevo, junto a "Libro Mayor: movimientos agrupados por cuenta" (`:443`).
  Los tabs se registran en `_HelpGuideTabs.tsx`.
- **Docs de desarrollador**: `docs/modules/accounting.md` tiene la tabla de reportes en `## Reportes`
  (`:132-165`, con la fila "| Libro Mayor | Movimientos por cuenta con saldo acumulado |" en `:145`) y
  la sección `### Centro de Costo Obligatorio (TSK-583)` en `:368`. También mencionan centros
  `docs/modules/commercial.md:916,926`, `docs/architecture/data-model.md`, `docs/modules/employees.md`
  y `docs/modules/equipment.md`.
- **PDF de presentación al cliente**: obligatorio por ticket (memoria
  `guia-presentacion-cliente-por-ticket`), se arma con los scripts
  `scripts/guia-presentacion/capturas-*.mjs`.

#### 1.2.10 Alternativas comparadas y recomendación

**A) Reporte "Movimientos por Centro de Costo" en Contabilidad → Informes**

- *A favor*: molde listo (`_GeneralLedgerReport.tsx` + `getGeneralLedger`), registro en 3 líneas
  (`_ReportsSelector.tsx:7-20` + array + `_ReportsContent.tsx`), permiso único ya existente
  (`accounting.reports`), export Excel con el helper compartido, y queda **al lado de los reportes con
  los que el contador lo va a cruzar**. Es la opción de menor costo por lejos: 1 action + 1 componente
  + 2 ediciones chicas.
- *En contra*: Elizabeth no lo va a encontrar. Ella pidió "habilitar los movimientos" **mirando la
  pantalla de Empresa → Centros de Costo**, que es donde seguirá sin pasar nada.

**B) Detalle del centro en Empresa → Centros de Costo**

- *A favor*: es exactamente donde la clienta lo buscó; el click en el nombre es el gesto natural y hoy
  la columna `name` ni siquiera es un link (`columns.tsx:30-38`).
- *En contra*: hay que crear feature `detail/` + ruta `[id]/page.tsx` (hoy no existe ninguna de las
  dos), y **el reporte contable queda escondido en "configuración"**, que es donde el contador no
  mira. Además obliga a decidir qué permiso rige: mostrar importes contables bajo
  `company.cost-centers` le abre datos de resultado a perfiles administrativos que hoy solo pueden
  editar nombres. Y si después se quiere el reporte en Informes, la query se escribe dos veces.

**C) A + B — el reporte hace el trabajo, y desde el listado de centros un link "Ver movimientos"**

- *A favor*: cubre a los dos usuarios con **una sola** implementación de la query y de la tabla.
  Elizabeth lo encuentra donde lo buscó; el contador lo tiene entre los informes.
- *Costo extra real y acotado*: (1) el link debe ir condicionado con `usePermissions()` a
  `accounting.reports.view` — si el usuario no lo tiene, no se muestra (nada de un link que redirige);
  (2) para abrir el reporte **ya filtrado** hace falta deep-link, y hoy `_ReportsContent.tsx:24` guarda
  el reporte elegido en un `useState` sin reflejarlo en la URL: hay que inicializarlo desde
  `useSearchParams()` y propagar `costCenterId` al componente del reporte. Es un cambio chico pero
  **toca un archivo compartido por los 12 reportes**, así que hay que no romper el default
  (`'trial-balance'`).

**Recomendación: C, en dos fases.** Fase 1 = A completo (action + reporte + registro + export), que es
lo que entrega valor y es verificable con tests. Fase 2 = el deep-link y el botón "Ver movimientos" en
el listado de centros. Si hubiera que recortar alcance, se recorta la fase 2, no al revés: sin el
reporte no hay nada, y sin el link hay algo que funciona y se le puede mostrar a la clienta.

**Se descarta B puro** por el permiso (expone resultados contables bajo un permiso de configuración) y
porque duplica trabajo en cuanto alguien pida el mismo dato en Informes.

### 1.3 Archivos involucrados

**Se leen (contexto / molde), no se tocan:**

- `prisma/schema.prisma:1040-1060` (`CostCenter`), `:438-464` (`JournalEntryLine`), `:389-400`
  (`JournalEntry.status`), `:296-322` (`Account.type`/`nature`), `:220-236` (enums), `:647`
  (`requireCostCenter`), `:3065-3094` (tablas de reparto TSK-583).
- `src/modules/accounting/features/integrations/commercial/index.ts:294-441` y `:489-618` (quién
  escribe `costCenterId`), `:198-287` (`createJournalEntry`, nace DRAFT).
- `src/modules/commercial/shared/cost-center.ts` (reglas de reparto y de tipos de cuenta).
- `src/modules/accounting/features/reports/components/_GeneralLedgerReport.tsx` (molde de UI + export).
- `src/modules/accounting/features/reports/components/_BudgetVarianceReport.tsx:43-48`, `:164-167`
  (molde de selector con `useQuery` + `<Select>`).
- `src/shared/lib/excel-export.ts`, `src/shared/utils/formatters.ts:52-58` (`formatDateUtc`),
  `src/modules/accounting/shared/utils/index.ts:94` (`formatAmount`).

**Se crean (fase 1):**

- `src/modules/accounting/features/reports/components/_CostCenterMovementsReport.tsx` — Client
  Component, prefijo `_` (regla 4).
- La action `getCostCenterMovements(companyId, costCenterId | 'all', fromDate, toDate, includeDrafts)`
  y la auxiliar `getCostCentersWithMovements(companyId)` para el selector, dentro de
  `src/modules/accounting/features/reports/actions.server.ts` (convención de la carpeta: un solo
  archivo de actions).
- Tests Vitest (`*.integration.test.ts`) junto a la action — **Vitest, no Cypress**, según la memoria
  `testing-real-es-vitest-no-cypress`. Casos mínimos: reparto entre dos centros, nota de crédito que
  resta, líneas sin centro excluidas, DRAFT excluido por defecto e incluido con el switch, saldo
  acumulado.

**Se modifican (fase 1):**

- `src/modules/accounting/features/reports/components/_ReportsSelector.tsx` — `ReportType` (`:7-20`) +
  entrada en `financialReports` (`:26-66`) con icono de `lucide-react`.
- `src/modules/accounting/features/reports/components/_ReportsContent.tsx:57-100` — el render
  condicional.
- `src/modules/help/features/guide/components/_AccountingGuide.tsx:426-445` — ítem en la lista de
  informes (regla 10).
- `docs/modules/accounting.md:137-146` — fila en la tabla de reportes financieros (regla 8).

**Se modifican (fase 2, deep-link):**

- `src/modules/company/features/cost-centers/list/columns.tsx` — acción "Ver movimientos" en el menú
  (o el nombre como link), condicionada por permiso.
- `src/modules/company/features/cost-centers/list/components/_CostCentersDataTable.tsx` — navegación.
- `src/modules/accounting/features/reports/components/_ReportsContent.tsx` — init de `selectedReport`
  y filtros desde `useSearchParams()`.
- `src/modules/help/features/guide/components/_CompanyGuide.tsx` — mencionar el acceso nuevo.

**Posible migración (ver 1.6):** `prisma/schema.prisma` — `@@index([costCenterId])` en
`JournalEntryLine`.

### 1.4 Dependencias

- **TSK-583** (repartos por porcentaje): es lo que **produce** el dato. Sin él no habría nada que
  mostrar. Ya está en producción.
- **TSK-721 / TSK-728**: dejaron el patrón `ActionResult` / `BusinessError`
  (`src/shared/lib/action-result.ts`) para errores de negocio. Este reporte es de **lectura**, así que
  su único error esperable es "no hay empresa activa" / permiso; se alinea con el resto de
  `reports/actions.server.ts`, que lanza y deja que el `PermissionGuard` redirija. **No** corresponde
  inventar `ActionResult` acá salvo que aparezca una condición de negocio nombrable.
- **TSK-725**: `formatDateUtc` — usar esa función y no `formatDate`, o las fechas de asiento se corren
  un día.
- El circuito **DRAFT → POSTED** (`postJournalEntry`, permiso `accounting.entries.approve`): no se
  toca, pero condiciona qué se ve (1.2.5) y qué se puede demostrar (1.2.6).
- Módulo activable: el reporte cuelga de `accounting`, que ya está registrado; el link de fase 2 sale
  de una pantalla que pertenece al módulo `employees` (`shared/lib/modules/constants.ts:83`) — no hay
  que registrar nada nuevo (regla 13), pero el link debe tolerar que Contabilidad esté desactivada.

### 1.5 Restricciones y reglas

- **Permisos (regla 11)**: la action nueva hace
  `checkPermission('accounting.reports','view',{redirect:true})` como todas sus vecinas
  (`actions.server.ts:229`); la página ya está protegida por `PermissionGuard` en `ReportsList.tsx`.
  El link de fase 2 se condiciona con `usePermissions()` sobre `accounting.reports`.
- **Server/Client (regla 4)**: componente `_CostCenterMovementsReport.tsx` con `'use client'`.
- **Decimal → Number (regla 9)**: `debit`/`credit` son `Decimal(12,2)` (`schema.prisma:444-445`) y
  `percentage` de los repartos también; **todo** debe salir de la action ya convertido con `Number()`,
  o el Client Component rompe. Si se usa `$queryRaw` conviene castear en SQL (`::float`), como hace el
  Mayor en el saldo anterior (`actions.server.ts:249-250`).
- **moment.js, logger, sin `any`** (reglas de oro 1, 2 y `typescript-types.md`).
- **Testing = Vitest** (`npm run test`), no Cypress: el `CLAUDE.md` manda Cypress pero no existe la
  carpeta ni los scripts (memoria `testing-real-es-vitest-no-cypress`). Ejemplos a imitar:
  `integrations/commercial/cost-center.integration.test.ts`.
- **Documentación triple** por ticket: `docs/modules/accounting.md` (regla 8) + guía in-app
  `_AccountingGuide.tsx` (regla 10) + **PDF de presentación al cliente** (memoria
  `guia-presentacion-cliente-por-ticket`).
- **Convención local de la carpeta de reportes**: `useState` + llamada directa a la action en el
  submit, no React Query para los datos del reporte. Seguirla (consistencia) y no tomarla como
  autorización para nuevas pantallas fuera de esta carpeta.
- **No inventar campos en `CostCenter`**: el ticket pide ver movimientos, no agregarle código,
  jerarquía ni presupuesto al modelo.

### 1.6 Riesgos identificados

1. **El reporte sale vacío y parece roto (alto).** Es el riesgo principal: con POSTED por defecto y la
   base actual (22 asientos, **todos DRAFT**), lo primero que ve cualquiera es una tabla en blanco.
   *Mitigación*: el aviso explícito de borradores de 1.2.5 (punto 2) más un empty state que diga por
   qué no hay datos, distinguiendo "el centro no tiene movimientos en el período" de "hay N en
   borrador".
2. **Expectativa desalineada: sueldos y equipos (alto).** `Employee.costCenterId` y
   `Vehicle.costCenterId` existen desde hace mucho y la clienta puede esperar ver ahí el costo de la
   gente y de los equipos. **Ningún proceso los lleva al asiento** (1.2.2). El reporte va a mostrar
   solo facturas de venta y compra con reparto. *Mitigación*: decirlo explícitamente en la guía y en
   el PDF de presentación ("qué NO cambió"), antes de que lo descubra sola.
3. **Sin índice en `cost_center_id` (medio).** `\d journal_entry_lines` confirma que la tabla tiene
   **solo la PK**: no hay índice ni en `cost_center_id`, ni en `entry_id`, ni en `account_id`. Filtrar
   por centro es un seq scan sobre todas las líneas de la empresa. Con volumen real (años de facturas)
   el reporte se degrada. *Mitigación*: migración aditiva con `@@index([costCenterId])` (y evaluar
   `[entryId]`, que hoy sufre todo el módulo). Riesgo bajo de ejecución, beneficio general.
4. **Nota de crédito mal firmada (medio).** Si se implementa la semántica (a) cruda, las devoluciones
   **suman** en vez de restar y el saldo del centro queda inflado. Es el bug silencioso más probable
   de este ticket. *Mitigación*: test Vitest explícito con una NC de venta y una de compra.
5. **Centro eliminado con historia (medio).** El borrado es lógico y el selector filtra
   `isActive: true`: el histórico de un centro dado de baja se vuelve inalcanzable (1.2.8).
6. **Tocar `_ReportsContent.tsx` (bajo, fase 2).** Ese archivo condiciona los 12 reportes; cambiar el
   origen de `selectedReport` puede romper el default. *Mitigación*: mantener `'trial-balance'` como
   fallback y cubrirlo con test.
7. **Desalineación con el Libro Mayor (bajo pero corrosivo).** Si el reporte nuevo incluyera DRAFT por
   defecto y el Mayor no, el mismo período daría dos cifras distintas en dos pantallas contiguas.
   *Mitigación*: POSTED por defecto, sin excepción.
8. **Doble fuente de verdad en el export (bajo).** El aplanado a Excel del Mayor duplica la lógica de
   saldo en el cliente (`_GeneralLedgerReport.tsx:57-149`). Conviene que la action devuelva las filas
   ya calculadas (entrada, salida, saldo acumulado) y que el componente solo las pinte y las exporte.

### 1.7 Preguntas abiertas

Solo dos, y ambas cambian el diseño:

1. **¿El reporte debe ofrecer "(Sin centro de costo)"?** Es decir, listar las líneas de cuentas de
   resultado que **no** tienen centro imputado (1.2.8). Es barato y es la herramienta para detectar lo
   que quedó sin imputar cuando `requireCostCenter` está apagado, pero cambia el selector (pasa de
   "centro | todos" a "centro | todos | sin centro") y la comparativa. *Sugerencia*: incluirlo — es la
   mitad que le da sentido a la vista "Todos".

2. **¿"Todos los centros" muestra comparativa o detalle corrido?** La comparativa (una fila por centro
   con Entradas/Salidas/Saldo, expandible) es más útil y más barata de leer; el detalle corrido de
   todos los centros es más fiel a la idea de "mayor". Cambia la forma del payload de la action y del
   Excel, así que conviene decidirlo antes de diseñar. *Sugerencia*: comparativa con filas expandibles,
   igual que el Mayor.

Lo demás está resuelto en el análisis: semántica (1.2.4, opción **c** por `nature`), estado
(1.2.5, **POSTED por defecto + switch + aviso**), ubicación (1.2.10, **C en dos fases**), export
(**sí, con `exportToExcel`**) y totales (**tarjetas + saldo acumulado; sin subtotal mensual**).

---

## 2. Planificación

Siete fases que implementan la **alternativa C** del análisis (1.2.10) con las decisiones ya
tomadas por el usuario: un reporte nuevo **"Movimientos por Centro de Costo"** en Contabilidad →
Informes (permiso `accounting.reports`), con el molde de `_GeneralLedgerReport` (`useState` +
llamada directa a la action, sin React Query salvo el selector); la semántica de entrada/salida
por **`Account.nature`** (CREDIT → entrada = `credit − debit`; DEBIT → salida = `debit − credit`;
saldo = Σentradas − Σsalidas), con Debe/Haber solo en el Excel; **POSTED por defecto** más un
switch "Incluir borradores" y un **aviso permanente** que dice cuántos asientos en borrador
quedaron afuera y por qué importe; un selector que incluye **"(Sin centro de costo)"** y los
centros **inactivos con historia**; la vista **"Todos los centros"** como comparativa (una fila
por centro, expandible al detalle, igual que el Mayor); una **migración aditiva** que le pone
índices a `journal_entry_lines` (hoy solo tiene la PK); y, como última fase funcional, el
**deep-link** desde Empresa → Centros de Costo ("Ver movimientos"), que obliga a inicializar
`selectedReport` desde `useSearchParams()` en `_ReportsContent.tsx:24`. El orden va del dato hacia
la superficie: primero el índice, después el cálculo puro (que es donde vive el bug silencioso de
la nota de crédito), después la action, después la pantalla, después el acceso desde el otro
módulo, y al final documentación y verificación con siembra.

Decisiones tomadas en esta planificación, donde el usuario dejó margen:

- **Índices: `[costCenterId]` y `[entryId]`, no `[accountId]`.** `journal_entry_lines` es la tabla
  que más crece y hoy tiene **solo la PK** (riesgo 1.6-3), así que cada índice se paga en cada
  escritura de asiento y hay que justificarlo uno por uno:
  - `@@index([costCenterId])` es el del ticket: sin él, filtrar por centro es un seq scan sobre
    todas las líneas de la base. Además lo usa el `EXISTS` del selector de centros con historia
    (fase 3). Nota: en Postgres un btree indexa los `NULL`, así que `costCenterId IS NULL`
    ("Sin centro de costo") también puede usarlo, aunque con ~99% de nulos el planner
    probablemente prefiera el seq scan; Prisma no soporta índices parciales en el schema, así
    que no hay forma declarativa de excluirlos y no vale la pena un SQL a mano.
  - `@@index([entryId])` **sí entra**, aunque no lo pida este ticket: la relación es
    `onDelete: Cascade` (`schema.prisma:456`), y una FK referenciante **sin índice** obliga a
    Postgres a escanear toda la tabla hija cada vez que se borra un asiento (reversiones,
    borrado de borradores); además es el join de `include: { lines: true }` que usan el Libro
    Diario, el Libro Mayor, Estado de Resultados y la Variación Presupuestaria. Es el índice de
    mayor retorno del módulo y cuesta lo mismo escribirlo ahora que en otra migración.
  - `@@index([accountId])` **queda afuera**: ninguna consulta filtra líneas por cuenta en SQL
    (el Mayor trae todos los asientos del período y filtra por cuenta **en memoria**,
    `actions.server.ts:281-292`; el saldo anterior es un `GROUP BY account_id` sobre toda la
    historia, que el planner resuelve con seq scan + hash aggregate igual), y las cuentas se dan
    de baja de forma lógica (`isActive`), no con `DELETE`. Se anota como seguimiento (2.4) para
    cuando alguien optimice el Mayor moviendo el filtro al `where`.
- **El helper puro vive en `src/modules/accounting/shared/utils/cost-center-movements.ts`**, no en
  una carpeta `features/reports/shared/` nueva: `reports/` no tiene subcarpetas (solo
  `ReportsList.tsx`, `actions.server.ts` y `components/`), y `shared/utils/` ya es el lugar de los
  cálculos contables puros consumidos por los reportes (`balances.ts`, que
  `reports/actions.server.ts:11-14` importa, más `account-code.ts` y `account-subtree.ts`, cada
  uno con su `.test.ts` al lado). El aplanado para Excel también va ahí (no en el componente),
  para cerrar el riesgo 1.6-8: una sola fuente de verdad del saldo, testeable con Vitest.
- **El selector de centros es una action propia del reporte, no un parámetro nuevo en
  `getCostCentersForSelect`.** Esa función vive en `company/features/cost-centers/list/
  actions.server.ts:99-121`, no tiene `checkPermission` (contra la regla 11) y la consumen
  `useCatalogs.ts:77` y los formularios de factura de compra; agregarle un flag
  `includeInactive` significaría tocar un catálogo compartido por tres módulos y, sobre todo,
  **accounting importaría de company** (regla `module-communication.md`). Se crea
  `getCostCentersForMovementsReport(companyId)` en `reports/actions.server.ts`, con
  `checkPermission('accounting.reports','view')` y una sola query:
  `where: { companyId, OR: [{ isActive: true }, { journalEntryLines: { some: {} } }] }`, que
  devuelve `{ id, name, isActive }` para poder marcar "(inactivo)" en el desplegable.
- **Una sola query con `status IN ('DRAFT','POSTED')` siempre**, y el corte por estado se hace en
  memoria: las POSTED arman el reporte y las DRAFT arman el aviso (conteo de asientos distintos +
  importe neto con la misma regla de `nature`). Así los números del aviso **no pueden** discrepar
  de los del reporte, y activar "Incluir borradores" no dispara otra consulta. `REVERSED` nunca
  entra (el reporte de reversiones ya existe y filtra ese estado, `actions.server.ts:691`).
- **La forma del payload es siempre un array de grupos**, aunque se pida un solo centro: la
  comparativa de "Todos" y el detalle de un centro comparten componente, aplanado de Excel y
  tests, exactamente como el Mayor devuelve un array de cuentas cada una con sus `entries`. Un
  centro puntual es un array de un elemento ya expandido.
- **El bucket "(Sin centro de costo)" se restringe a cuentas de resultado** (`account.type IN
  ('REVENUE','EXPENSE')`), tanto cuando se lo elige explícitamente como cuando aparece dentro de
  "Todos". Sin esa restricción, toda línea de caja, banco, IVA, Cuentas por Cobrar y Cuentas por
  Pagar de la empresa caería en ese bucket y el reporte sería ilegible. Los centros **con**
  nombre no filtran por tipo: si un asiento manual imputó un activo a un centro, tiene que verse
  (hoy es imposible por UI —1.2.2— pero el dato es válido y esconderlo sería un agujero).
- **Las dos actions nuevas validan que el `companyId` que manda el cliente sea el de la empresa
  activa** (`if (companyId !== (await getActiveCompanyId())) throw`). Los 12 reportes existentes
  reciben `companyId` del Client Component y **no** lo verifican: es un agujero real (una llamada
  fabricada lee otra empresa). No se corrige en los 12 acá —es un ticket propio (2.4)— pero el
  código nuevo no lo repite.
- **El link "Ver movimientos" se condiciona con `getModulePermissions('accounting.reports')` en el
  Server Component**, no con `usePermissions()` como sugería 1.5: `CostCentersList.tsx:12-17` ya
  hace `Promise.all` con `getModulePermissions('company.cost-centers')` y le pasa el resultado a
  la tabla; sumar un segundo `getModulePermissions` es una línea, evita un `useQuery` extra en el
  cliente y no deja parpadear el botón mientras cargan los permisos.
- **`_ReportsContent` solo *lee* la URL, no la escribe.** Inicializa `selectedReport` desde
  `useSearchParams()` validando contra la lista de reportes conocidos (fallback
  `'trial-balance'`), y pasa `costCenterId` como prop inicial al reporte nuevo; **no** hace
  `router.replace` al cambiar de reporte. Es el cambio mínimo sobre un archivo que condiciona los
  12 reportes (riesgo 1.6-6); reflejar la selección en la URL queda como seguimiento.
- **El componente se parte en dos desde el principio**: `_CostCenterMovementsReport.tsx` (filtros,
  llamada a la action, tarjetas de totales, aviso de borradores, export) y
  `_CostCenterMovementsTable.tsx` (comparativa + filas expandibles). El molde de una sola pieza
  (`_GeneralLedgerReport.tsx`, 330 líneas) ya viola la regla de <200 líneas y este reporte tiene
  más filtros; no se replica la deuda.

Testing: **Vitest** (`npm run test` → `vitest run`; `vitest.config.ts` incluye
`src/**/*.test.ts`, entorno `node`; memoria `testing-real-es-vitest-no-cypress` — el `CLAUDE.md`
manda Cypress pero no existe la carpeta ni los scripts). No se pueden testear componentes `.tsx`,
así que el TDD se aplica al helper puro (fase 2, test **antes** del código) y a la action contra
la base real de dev (fase 3, con los cuatro `vi.mock` de frontera de
`purchase-invoice-tributes.integration.test.ts:28-33` y prefijo `TSK719-TEST-`). La UI, el
deep-link y el aviso se verifican a mano en el navegador (fase 7), que es también donde se
siembran los datos para las capturas. Línea base de `npm run check-types`: **219** errores
preexistentes.

### 2.1 Fases de implementación

#### Fase 1: Índices en `journal_entry_lines` (migración aditiva, sin backfill)

- **Objetivo:** que filtrar líneas de asiento por centro de costo deje de ser un seq scan sobre
  toda la tabla, y de paso cerrar la FK `entryId` sin índice que sufre todo el módulo contable.
  Sin cambios de comportamiento ni de datos.
- **Tareas:**
  - [x] `prisma/schema.prisma:462` (`model JournalEntryLine`, justo antes de
        `@@map("journal_entry_lines")`): agregar
        `@@index([costCenterId]) // TSK-719: filtro del reporte de movimientos por centro` y
        `@@index([entryId]) // FK sin índice: el Cascade de JournalEntry y los include de lines la escaneaban entera`.
        **No** agregar `@@index([accountId])` (justificación arriba; anotado en 2.4).
  - [x] Correr `npm run db:migrate -- --name tsk_719_journal_entry_lines_indexes`. Verificar que
        el SQL generado en `prisma/migrations/<timestamp>_tsk_719_journal_entry_lines_indexes/
        migration.sql` sean **exactamente dos** `CREATE INDEX` (formato de
        `20260919121736_tsk_724c_asset_accounts_by_type/migration.sql`:
        `CREATE INDEX "journal_entry_lines_cost_center_id_idx" ON "journal_entry_lines"("cost_center_id");`
        y el equivalente de `entry_id`), **sin `ALTER TABLE`, sin `UPDATE`, sin backfill**. Si
        `migrate dev` detecta drift ajeno, no resetear: revisar antes con
        `npx prisma migrate status`.
  - [x] `npm run db:generate` y `npm run check-types` → debe quedar en la línea base (**219**):
        un índice no cambia el tipo generado.
  - [x] Medir el antes/después en dev con la base real (dos líneas con centro, 1.2.6: el volumen
        no alcanza para que el planner elija el índice, así que **no** hay que esperar cambio de
        plan; lo que se verifica es que el índice existe):
        `docker exec contable-pms-db psql -U postgres -d contable_pms -c '\d journal_entry_lines'`
        debe listar los dos índices nuevos además de la PK.
  - [x] Anotar en la sección 4 que en producción la migración la aplica el `docker-entrypoint.sh`
        al deployar (memoria `produccion-dokploy-scripts-db`); no hay script manual que correr.
        Dejar anotado también que `CREATE INDEX` sin `CONCURRENTLY` **bloquea escrituras** en la
        tabla mientras corre: con el volumen actual de la clienta es instantáneo, pero si en el
        futuro la tabla tiene millones de filas hay que hacerlo a mano con `CONCURRENTLY`.
- **Archivos:**
  - Crear: `prisma/migrations/<timestamp>_tsk_719_journal_entry_lines_indexes/migration.sql`
  - Modificar: `prisma/schema.prisma`
- **Criterio de completitud:** `npx prisma migrate status` en verde; `\d journal_entry_lines`
  muestra `journal_entry_lines_cost_center_id_idx` y `journal_entry_lines_entry_id_idx`;
  `check-types` en 219; `npm run test` sin regresiones (los tests de integración existentes
  escriben líneas de asiento y no deben notar nada).

#### Fase 2: Helper puro del cálculo entrada/salida/saldo (TDD unitario)

- **Objetivo:** una sola regla, sin base y sin React, que dado un conjunto de líneas de asiento
  con su cuenta y su centro devuelva las filas de detalle con entrada/salida/saldo acumulado, los
  grupos por centro con sus totales, los totales generales y las filas planas para el Excel. Es
  donde se cierra el bug silencioso de la nota de crédito (riesgo 1.6-4) y la doble fuente de
  verdad del export (riesgo 1.6-8).
- **Tareas:**
  - [x] Escribir **primero** `src/modules/accounting/shared/utils/cost-center-movements.test.ts`
        (Vitest puro, estilo `account-subtree.test.ts`, sin Prisma ni `DATABASE_URL`). Casos
        mínimos (14):
    - `splitLineAmount` con `nature: 'CREDIT'` y `credit: 1000, debit: 0` → `{ entrada: 1000,
      salida: 0 }`; con `nature: 'CREDIT'` y `debit: 300, credit: 0` (nota de crédito de venta)
      → `{ entrada: -300, salida: 0 }`; con `nature: 'DEBIT'` y `debit: 500` → `{ entrada: 0,
      salida: 500 }`; con `nature: 'DEBIT'` y `credit: 120` (NC de compra) → `{ entrada: 0,
      salida: -120 }`.
    - Una línea nunca produce entrada **y** salida a la vez (lo garantiza el constraint
      `chk_jel_debit_or_credit`, 1.2.4): el test lo documenta con un `expect` cruzado.
    - `buildMovementRows(lines)`: ordena por `date`, luego `entryNumber`, luego `lineId`
      (desempate estable) y calcula el **saldo acumulado** fila a fila como
      `saldo += entrada − salida`; caso de tres líneas mezcladas (ingreso, gasto, NC) con el
      acumulado esperado en cada fila; caso de lista vacía → `[]`.
    - `groupByCostCenter(lines)`: dos centros + líneas sin centro → tres grupos, el de sin centro
      con `costCenterId: null` y nombre `'(Sin centro de costo)'`, ordenados por nombre con el
      grupo sin centro **último**; cada grupo trae `totalEntradas`, `totalSalidas`, `saldo` y sus
      filas con acumulado **propio del grupo** (no global).
    - Totales generales: `totalEntradas`/`totalSalidas`/`saldo` de todos los grupos coinciden con
      la suma de los grupos (test de coherencia con importes con decimales, p. ej. 60.000,55 y
      39.999,45, para verificar que no se acumula error de punto flotante más allá de los 2
      decimales que exige el Excel).
    - `summarizeDrafts(draftLines)` → `{ entryCount, saldo }`, contando **asientos distintos**
      (dos líneas del mismo asiento cuentan 1) y con el saldo calculado con la misma regla.
    - `buildExcelRows(groups, { includeStatus })`: por cada grupo, sus filas de detalle
      (centro, fecha, asiento, código y nombre de cuenta, descripción, **debe, haber**, entrada,
      salida, saldo, y `estado` solo si `includeStatus`) + una fila `TOTAL` por grupo; el orden
      es grupo por grupo; con `includeStatus: false` las filas no traen la clave `estado`.
        Debe fallar en rojo porque el módulo no existe.
  - [x] Crear `src/modules/accounting/shared/utils/cost-center-movements.ts` (puro: sin Prisma,
        sin `@/modules/*`, sin React; < 180 líneas). Encabezado con el porqué (TSK-719: "entradas
        y salidas" es el vocabulario de la clienta para ingresos y egresos imputados al centro; se
        clasifica por `Account.nature` y se firma por debe/haber, opción (c) de 1.2.4, para que
        las notas de crédito resten en vez de sumar). Exportar:
    - `export interface CostCenterMovementLine { lineId: string; entryId: string; entryNumber:
      number; date: Date; entryDescription: string; lineDescription: string | null; status:
      'DRAFT' | 'POSTED'; accountCode: string; accountName: string; accountNature: 'DEBIT' |
      'CREDIT'; debit: number; credit: number; costCenterId: string | null; costCenterName:
      string | null }` (todo ya en `number`: la conversión de `Decimal` la hace la action).
    - `export const NO_COST_CENTER_LABEL = '(Sin centro de costo)'`.
    - `export function splitLineAmount(line): { entrada: number; salida: number }`.
    - `export interface CostCenterMovementRow` (la línea + `entrada`, `salida`, `saldo`) y
      `export function buildMovementRows(lines): CostCenterMovementRow[]`.
    - `export interface CostCenterMovementGroup { costCenterId: string | null; costCenterName:
      string; totalEntradas: number; totalSalidas: number; saldo: number; rows:
      CostCenterMovementRow[] }` y `export function groupByCostCenter(lines):
      CostCenterMovementGroup[]`.
    - `export function summarizeDrafts(lines): { entryCount: number; saldo: number }`.
    - `export function buildExcelRows(groups, options): Record<string, unknown>[]`.
        Redondear a 2 decimales con el helper que ya existe en la carpeta
        (`shared/utils/decimal.ts`) si expone algo aplicable; si no, `Math.round(x * 100) / 100`
        en los totales, **no** en cada fila. Test en verde.
  - [x] Exportar lo necesario desde `src/modules/accounting/shared/utils/index.ts` si ese barrel
        reexporta los demás helpers (verificar cómo están `account-code` y `balances`; si el
        barrel no los reexporta, importar por ruta directa y no tocarlo).
- **Archivos:**
  - Crear: `src/modules/accounting/shared/utils/cost-center-movements.ts`,
    `cost-center-movements.test.ts`
  - Modificar (solo si el barrel ya reexporta helpers): `src/modules/accounting/shared/utils/index.ts`
- **Criterio de completitud:** `npm run test` en verde con los 14 casos (primero rojos); el módulo
  no importa Prisma, ni `@/modules/*`, ni React; `check-types` en 219.

#### Fase 3: Actions `getCostCenterMovements` y `getCostCentersForMovementsReport` (TDD de integración)

- **Objetivo:** que el servidor devuelva, con una sola consulta y los `Decimal` ya convertidos, la
  comparativa por centro con su detalle, los totales, y el resumen de los borradores excluidos;
  y que el selector ofrezca los centros activos **más** los inactivos con historia.
- **Tareas:**
  - [x] **Test de integración (rojo primero).** Crear
        `src/modules/accounting/features/reports/cost-center-movements.integration.test.ts` con el
        andamiaje de `purchase-invoice-tributes.integration.test.ts:22-70`: `import
        'dotenv/config'`, chequeo `dbAvailable` con `await prisma.$queryRaw\`SELECT 1\``,
        `describe.skipIf(!dbAvailable)`, y los `vi.mock` de frontera —
        `vi.mock('@/shared/lib/current-user', () => ({ getCurrentUserId: vi.fn() }))`,
        `vi.mock('@/shared/lib/company', () => ({ getActiveCompanyId: vi.fn() }))`,
        `vi.mock('@/shared/lib/permissions', () => ({ checkPermission: vi.fn().mockResolvedValue(undefined) }))`.
        Prefijo `TSK719-TEST-`. `beforeAll`: empresa propia; cuentas `Ventas` (REVENUE/CREDIT),
        `Combustible` (EXPENSE/DEBIT), `Cobrar` (ASSET/DEBIT), `IVA DF` (LIABILITY/CREDIT);
        centros `Logística`, `Mantenimiento` y `Viejo` (este último con `isActive: false`);
        asientos creados con `prisma.journalEntry.create` (nested `lines`) para no depender del
        integrador comercial. Escenario:
    - Asiento 1 POSTED: venta — Haber `Ventas` 100.000 con centro Logística, Debe `Cobrar`
      121.000 **sin** centro.
    - Asiento 2 POSTED: compra — Debe `Combustible` 60.000 (Logística) y 40.000 (Mantenimiento).
    - Asiento 3 POSTED: nota de crédito de venta — Debe `Ventas` 30.000 con centro Logística.
    - Asiento 4 POSTED: Haber `Ventas` 10.000 con centro `Viejo` (el inactivo con historia).
    - Asiento 5 DRAFT: Debe `Combustible` 25.000 con centro Logística.
    - Asiento 6 POSTED **fuera del rango de fechas**: Debe `Combustible` 99.999 en Logística.
        Casos:
    - `getCostCenterMovements(companyId, { costCenterId: <Logística>, from, to, includeDrafts:
      false })` → un grupo, `totalEntradas` 70.000 (100.000 − 30.000 de la NC), `totalSalidas`
      60.000, `saldo` 10.000; las filas traen el saldo acumulado 100.000 → 40.000 → 10.000 según
      el orden por fecha; **ninguna** fila del asiento 5 ni del 6.
    - `draftsExcluded` → `{ entryCount: 1, saldo: -25.000 }` (una salida en borrador).
    - Con `includeDrafts: true` → `totalSalidas` 85.000, `saldo` −15.000 y `draftsExcluded` en
      `{ entryCount: 0, saldo: 0 }`; alguna fila con `status: 'DRAFT'`.
    - `costCenterId: 'all'` → cuatro grupos (Logística, Mantenimiento, Viejo y
      `'(Sin centro de costo)'`); el grupo sin centro **no** incluye la línea de `Cobrar` (ASSET)
      del asiento 1 — es la verificación de la restricción a cuentas de resultado.
    - `costCenterId: 'none'` → un solo grupo, vacío en este escenario (no hay líneas de resultado
      sin centro); agregar un asiento 7 POSTED con Haber `Ventas` 5.000 **sin** centro para que
      el caso devuelva una fila y el test no sea vacuo.
    - Un asiento `REVERSED` con línea en Logística **nunca** aparece, ni con `includeDrafts`.
    - `getCostCentersForMovementsReport(companyId)` → devuelve Logística, Mantenimiento y
      **`Viejo`** (inactivo con historia, con `isActive: false` en el payload) y **no** devuelve
      un centro inactivo sin líneas (crear `TSK719-TEST-Vacío` inactivo para probarlo).
    - `companyId` de otra empresa (crear una segunda) → `rejects.toThrow()` por la validación de
      empresa activa.
    - Todos los importes que vuelven son `number` (no `Decimal`): `expect(typeof
      row.debit).toBe('number')` en una fila, que es la regla 9 del CLAUDE.md.
        `afterAll`: borrar en orden `journalEntryLine` → `journalEntry` → `costCenter` →
        `account` → `company` por prefijo y verificar `count` 0 en cada tabla.
  - [x] **`getCostCenterMovements`** en `src/modules/accounting/features/reports/actions.server.ts`
        (al final del archivo, después del último reporte; el archivo tiene 1529 líneas y empieza
        con BOM + `'use server'`). Firma:
        `export async function getCostCenterMovements(companyId: string, filters: {
        costCenterId: string | 'all' | 'none'; fromDate: Date; toDate: Date; includeDrafts:
        boolean })`. Cuerpo, copiando el preámbulo de `getGeneralLedger` (`:227-232`):
        `const userId = await getCurrentUserId(); if (!userId) throw new Error('No autenticado');`
        + `await checkPermission('accounting.reports', 'view', { redirect: true });` + la
        validación de empresa activa (`const activeCompanyId = await getActiveCompanyId(); if
        (companyId !== activeCompanyId) throw new Error('Empresa inválida');` — importar
        `getActiveCompanyId` de `@/shared/lib/company`, que el archivo todavía no importa) +
        `startOfDay`/`endOfDay` (helpers locales del archivo, ya usados en `:231-232`).
    - Una sola query con `select` mínimo (regla de `prisma.md`):
      `prisma.journalEntryLine.findMany({ where: { entry: { companyId, status: { in:
      [JournalEntryStatus.DRAFT, JournalEntryStatus.POSTED] }, date: { gte: from, lte: to } },
      ...costCenterWhere }, select: { id: true, description: true, debit: true, credit: true,
      costCenterId: true, costCenter: { select: { name: true } }, entry: { select: { id: true,
      number: true, date: true, description: true, status: true } }, account: { select: { code:
      true, name: true, nature: true } } }, orderBy: [{ entry: { date: 'asc' } }, { entry: {
      number: 'asc' } }] })`.
    - `costCenterWhere` según el filtro: `'all'` → `{ OR: [{ costCenterId: { not: null } }, {
      costCenterId: null, account: { type: { in: [AccountType.REVENUE, AccountType.EXPENSE] } }
      }] }`; `'none'` → `{ costCenterId: null, account: { type: { in: [REVENUE, EXPENSE] } } }`;
      un uuid → `{ costCenterId }`.
    - Mapear a `CostCenterMovementLine[]` con **`Number(line.debit)` y `Number(line.credit)`**
      (regla 9), `costCenterName: line.costCenter?.name ?? null`.
    - Partir por estado: `posted` y `drafts`. `const groups = groupByCostCenter(includeDrafts ?
      all : posted)`; `const draftsExcluded = includeDrafts ? { entryCount: 0, saldo: 0 } :
      summarizeDrafts(drafts)`. Devolver `{ groups, totals: { entradas, salidas, saldo },
      draftsExcluded, includeDrafts }`.
    - `try/catch` con `logger.error('Error al obtener movimientos por centro de costo', { data: {
      error, companyId, filters } }); throw error;` igual que `:333-336`.
  - [x] **`getCostCentersForMovementsReport(companyId)`** en el mismo archivo, con el mismo
        preámbulo de permiso y empresa activa:
        `prisma.costCenter.findMany({ where: { companyId, OR: [{ isActive: true }, {
        journalEntryLines: { some: {} } }] }, select: { id: true, name: true, isActive: true },
        orderBy: { name: 'asc' } })`. Comentario explicando por qué no se reusa
        `getCostCentersForSelect` (permiso distinto, filtra `isActive`, y accounting no puede
        importar de company).
  - [x] Exportar los tipos inferidos al final del archivo si la carpeta lo acostumbra
        (`export type CostCenterMovementsResult = Awaited<ReturnType<typeof
        getCostCenterMovements>>`) para que el componente los use sin redeclarar.
  - [x] `npm run check-types` → 219. `npm run test` → verde.
- **Archivos:**
  - Crear: `src/modules/accounting/features/reports/cost-center-movements.integration.test.ts`
  - Modificar: `src/modules/accounting/features/reports/actions.server.ts`
- **Criterio de completitud:** los ~11 casos del test de integración en verde (primero rojos), con
  `afterAll` dejando `count` 0 de `TSK719-TEST-*` en `journal_entries`, `cost_centers`, `accounts`
  y `companies`; ningún `Decimal` en el payload; `check-types` en 219.

#### Fase 4: El reporte en Contabilidad → Informes (UI, aviso de borradores y Excel)

- **Objetivo:** que el contador entre a Informes, elija "Movimientos por Centro de Costo", un
  centro (o "Todos", o "Sin centro de costo") y un período, y vea entradas, salidas y saldo, con
  el detalle expandible, el aviso de lo que quedó en borrador y el botón de Excel.
- **Tareas:**
  - [x] `components/_ReportsSelector.tsx:7-19`: agregar `| 'cost-center-movements'` al union
        `ReportType`. En el array `financialReports` (`:26-57`), después de `general-ledger`
        (`:51-56`): `{ id: 'cost-center-movements' as const, name: 'Movimientos por Centro de
        Costo', description: 'Entradas, salidas y saldo por centro', icon: Wallet }` — sumar
        `Wallet` (o `PieChart`, cualquiera de `lucide-react` que no esté ya en uso) al import de
        `:5`.
  - [x] Mismo archivo: exportar `export const REPORT_TYPES = [...] as const` (o un
        `isReportType(value: string): value is ReportType`) con los 13 ids, para que
        `_ReportsContent` pueda validar el parámetro de URL de la fase 5 sin duplicar la lista.
  - [x] `components/_ReportsContent.tsx`: importar `_CostCenterMovementsReport` (junto al resto,
        `:5-16`) y agregar el render condicional después del de `budget-variance` (`:96-98`):
        `{selectedReport === 'cost-center-movements' && (<_CostCenterMovementsReport
        companyId={companyId} />)}`. (La prop `initialCostCenterId` se agrega en la fase 5.)
  - [x] Crear `components/_CostCenterMovementsReport.tsx` (`'use client'`, < 200 líneas; molde
        `_GeneralLedgerReport.tsx:29-55` para el estado y el submit, `_BudgetVarianceReport.tsx:
        43-48` y `:164-167` para el selector con `useQuery` + `<Select>`):
    - Estado: `costCenterId` (`useState<string>('all')`), `fromDate` /`toDate` con
      `moment().startOf('month').format('YYYY-MM-DD')` y `moment().format('YYYY-MM-DD')`,
      `includeDrafts` (`false`), `isLoading`, `data`, `expandedRows: Set<string>`.
    - Selector de centros con **React Query** (única excepción permitida por la convención de la
      carpeta, igual que el de ejercicios del presupuesto):
      `useQuery({ queryKey: ['cost-centers-movements-report', companyId], queryFn: () =>
      getCostCentersForMovementsReport(companyId) })`. Opciones: `Todos los centros` (`'all'`),
      `(Sin centro de costo)` (`'none'`), separador, y cada centro con el sufijo ` (inactivo)`
      cuando `isActive === false`.
    - `<Switch>` de `@/shared/components/ui/switch` con `<Label>` "Incluir borradores".
    - `handleSubmit` llama `getCostCenterMovements(companyId, { costCenterId, fromDate: new
      Date(fromDate), toDate: new Date(toDate), includeDrafts })` en `try/catch` con
      `logger.error` (y `toast.error` de `sonner` con el mensaje, que el Mayor no hace y deja al
      usuario sin señal cuando algo falla).
    - Tarjetas de totales arriba de la tabla: **Entradas**, **Salidas**, **Saldo del período**
      con `formatAmount` (`@/modules/accounting/shared/utils`), saldo en verde/rojo según signo
      (mismo criterio de `_GeneralLedgerReport.tsx:238-246`).
    - **Aviso de borradores**: cuando `data.draftsExcluded.entryCount > 0`, un `<Alert>` naranja
      (molde del `_PartnerAccountNotice.tsx` de TSK-717) con el texto *"Hay N asientos en
      borrador con movimientos de este centro por $X que no están incluidos. Registralos desde
      Contabilidad → Asientos para que impacten, o activá «Incluir borradores» para verlos
      acá."* El importe se muestra con `formatAmount(Math.abs(saldo))` y la palabra
      "entradas"/"salidas" según el signo.
    - **Empty state** que distingue los dos casos (riesgo 1.6-1): si no hay grupos con filas y
      `draftsExcluded.entryCount > 0` → "No hay movimientos registrados en el período; los N
      asientos en borrador de arriba son los únicos que tocan este centro"; si tampoco hay
      borradores → "El centro no tiene movimientos en el período".
    - `handleExport`: `buildExcelRows(data.groups, { includeStatus: includeDrafts })` (fase 2) +
      `ExcelColumn[]` con `formatter` por columna — `Centro`, `Fecha` (`formatDateUtc`, TSK-725,
      **no** `formatDate`), `Asiento`, `Codigo`, `Cuenta`, `Descripcion`, `Debe`, `Haber`,
      `Entrada`, `Salida`, `Saldo` y `Estado` (solo con borradores) — y
      `exportToExcel(rows, columns, { filename: \`movimientos-centro-costo-${moment().format(
      'YYYY-MM-DD')}\`, sheetName: 'Movimientos por Centro', title: 'Movimientos por Centro de
      Costo', includeDate: true })`. **El componente no recalcula nada**: solo pinta y exporta lo
      que vino de la action (riesgo 1.6-8).
  - [x] Crear `components/_CostCenterMovementsTable.tsx` (`'use client'`): recibe `groups`,
        `expandedRows`, `onToggle` e `includeDrafts`. Tabla HTML plana (no `DataTable`, como el
        resto de la carpeta) con una fila por centro — chevron, nombre, Entradas, Salidas, Saldo —
        y, al expandir, el encabezado del detalle y las filas **Fecha | Asiento N° | Cuenta
        (código – nombre) | Descripción | Entrada | Salida | Saldo acumulado**, más un `<Badge>`
        de Estado cuando `includeDrafts`. Copiar la mecánica de `expandedRows` de
        `_GeneralLedgerReport.tsx:151-159` y `:207-300`, **corrigiendo** dos cosas del molde: la
        `key` va en el fragmento externo (el Mayor la pone en el `<tr>` dentro de un `<>` sin key,
        que React advierte) y las filas del detalle se identifican por `lineId`, no por número de
        asiento (dos líneas del mismo asiento en el mismo centro colisionarían).
    - Responsive (regla del checklist): envolver la tabla en `overflow-x-auto` y ocultar
      Descripción en `sm` con `hidden sm:table-cell`; son 7 columnas dentro de la card de 2/3 de
      ancho de `_ReportsContent.tsx:51`.
  - [x] `npm run lint` y `npm run check-types` (219) sobre los archivos nuevos; revisar que
        ninguno pase de 200 líneas y que no haya `:any` ni `console.*`.
- **Archivos:**
  - Crear: `src/modules/accounting/features/reports/components/_CostCenterMovementsReport.tsx`,
    `_CostCenterMovementsTable.tsx`
  - Modificar: `src/modules/accounting/features/reports/components/_ReportsSelector.tsx`,
    `_ReportsContent.tsx`
- **Criterio de completitud:** en `/dashboard/company/accounting/reports` aparece el informe nuevo
  en el grupo financiero; con "Todos los centros" muestra una fila por centro expandible; el aviso
  de borradores aparece y desaparece al activar el switch; el Excel abre con las 11/12 columnas y
  los totales por centro; un usuario sin `accounting.reports` no llega a la pantalla (ya lo
  bloquean `page.tsx:5` y el `PermissionGuard` de `ReportsList.tsx:10`).

#### Fase 5: Deep-link desde Empresa → Centros de Costo

- **Objetivo:** que Elizabeth encuentre los movimientos donde los buscó: un "Ver movimientos" en
  el listado de centros que abre el informe **ya filtrado** por ese centro, sin mostrárselo a
  quien no tiene permiso de informes contables.
- **Tareas:**
  - [x] `components/_ReportsContent.tsx`: importar `useSearchParams` de `next/navigation` y
        cambiar `:24` por
        `const searchParams = useSearchParams(); const reportParam = searchParams.get('report');
        const [selectedReport, setSelectedReport] = useState<ReportType>(isReportType(reportParam)
        ? reportParam : 'trial-balance');` — el fallback `'trial-balance'` es obligatorio (riesgo
        1.6-6) y la validación usa el helper exportado en la fase 4, no una lista duplicada.
        Leer también `const initialCostCenterId = searchParams.get('costCenterId')` y pasarlo al
        reporte nuevo: `<_CostCenterMovementsReport companyId={companyId}
        initialCostCenterId={initialCostCenterId} />`. **No** se escribe la URL al cambiar de
        informe (decisión arriba; seguimiento en 2.4).
  - [x] `components/_CostCenterMovementsReport.tsx`: aceptar `initialCostCenterId?: string | null`
        y usarlo como valor inicial de `useState` (`initialCostCenterId ?? 'all'`). Si viene un
        id, **disparar la consulta automáticamente** al montar (un `useEffect` con dependencia
        vacía que llame al mismo `handleSubmit`), para que el link no deje al usuario frente a un
        formulario vacío. Si el id no está entre los centros que devuelve el selector (centro de
        otra empresa o borrado), el `<Select>` cae a `'all'` y se muestra un `toast.info`.
  - [x] `ReportsList.tsx:9-13`: envolver `<_ReportsContent />` en `<Suspense fallback={null}>`
        (import de `react`). `useSearchParams` en un Client Component obliga a un límite de
        Suspense o `npm run build` falla con *"useSearchParams() should be wrapped in a suspense
        boundary"*; verificarlo corriendo el build, no solo el dev server.
  - [x] `cost-centers/list/CostCentersList.tsx:13-16`: sumar
        `getModulePermissions('accounting.reports')` al `Promise.all` y pasar
        `canViewAccountingReports={reportPermissions.canView}` a `_CostCentersDataTable`
        (`:28-33`).
  - [x] `cost-centers/list/components/_CostCentersDataTable.tsx:31-36` y `:81-84`: aceptar la prop
        nueva, pasarla a `getColumns` y agregarla a las dependencias del `useMemo`. El handler
        navega con el `router` que el componente ya tiene (`:39`):
        `router.push(\`/dashboard/company/accounting/reports?report=cost-center-movements&costCenterId=${id}\`)`.
  - [x] `cost-centers/list/columns.tsx:18-22` y `:42-85`: agregar `canViewReports: boolean` y
        `onViewMovements: (costCenter: CostCenterListItem) => void` a `ColumnsProps`; incluir
        `canViewReports` en el cálculo de `hasAnyAction` (`:26`) para que la columna de acciones
        aparezca aunque el usuario solo tenga informes; y agregar el `DropdownMenuItem` "Ver
        movimientos" (icono `BarChart3` de `lucide-react`, `data-testid=
        \`cost-center-movements-${costCenter.id}\``) **arriba** de Editar, condicionado a
        `canViewReports`.
  - [x] Verificar que el link tolera que el módulo Contabilidad esté **desactivado** para la
        empresa (1.4): si `accounting` no está en `activeModules`, la ruta de informes redirige;
        comprobar si `getModulePermissions` ya devuelve `canView: false` en ese caso (leer
        `src/shared/lib/permissions/getModulePermissions.server.ts:45-90` y el filtrado de
        `shared/actions/sidebar.ts`). Si **no** lo contempla, sumar al `Promise.all` la lectura de
        módulos activos y exigir las dos condiciones; dejar anotado el resultado de la
        verificación en la sección 4.
- **Archivos:**
  - Modificar: `src/modules/accounting/features/reports/components/_ReportsContent.tsx`,
    `_CostCenterMovementsReport.tsx`, `src/modules/accounting/features/reports/ReportsList.tsx`,
    `src/modules/company/features/cost-centers/list/CostCentersList.tsx`,
    `components/_CostCentersDataTable.tsx`, `columns.tsx`
- **Criterio de completitud:** `npm run build` pasa (sin el error de Suspense); desde Empresa →
  Centros de Costo, "Ver movimientos" abre Informes con el reporte nuevo seleccionado, el centro
  elegido y los datos ya cargados; entrar a `/dashboard/company/accounting/reports` sin
  parámetros sigue mostrando Balance de Sumas y Saldos; un `?report=basura` también cae ahí; un
  usuario sin `accounting.reports` no ve el ítem del menú.

#### Fase 6: Documentación — guías in-app, `docs/` y PDF de presentación

- **Objetivo:** que el usuario final sepa qué mide el reporte y, sobre todo, **qué no mide**
  (riesgo 1.6-2: sueldos y equipos no imputan centro de costo), y que la clienta reciba el PDF con
  capturas reales (memoria `guia-presentacion-cliente-por-ticket`).
- **Tareas:**
  - [ ] `src/modules/help/features/guide/components/_AccountingGuide.tsx`: agregar después del
        ítem "Libro Mayor" (`:442-444`, antes del `</ul>` de `:445`) el `<li>`
        *"**Movimientos por Centro de Costo**: entradas, salidas y saldo de cada centro; se puede
        ver un centro, todos comparados o las líneas sin centro asignado"*. Y, debajo de la lista
        (después de `:445`), un bloque corto con las tres cosas que generan malentendidos: (1)
        **qué cuenta como entrada y como salida** (una venta imputada al centro entra, un gasto
        sale, y una nota de crédito resta del lado que corresponde); (2) **qué imputa centro de
        costo hoy**: solo las líneas de facturas de **venta** y de **compra** con reparto o con
        centro por defecto del ítem — *no* los movimientos de fondos, ni la amortización de
        equipos, ni los recibos, órdenes de pago y gastos, ni ninguna liquidación de sueldos (el
        centro del legajo y el del equipo son informativos); (3) **borradores**: el informe
        muestra asientos **registrados**; los que están en borrador aparecen en el aviso y solo
        se suman activando "Incluir borradores".
  - [ ] `_CompanyGuide.tsx:300` (bullet "Centros de costo" del catálogo de Empleados): cambiarlo
        por *"Centros de costo (con «Ver movimientos» para abrir el informe contable del centro)"*.
        Y en la lista "Relación con otros módulos" (`:522-530`), agregar un `<li>` **Contabilidad**:
        *"el informe «Movimientos por Centro de Costo» muestra lo imputado a cada centro; requiere
        permiso de Informes contables"*.
  - [ ] `docs/modules/accounting.md`: fila nueva en la tabla de Reportes Financieros después de
        Libro Mayor (`:145`): `| Movimientos por Centro de Costo | Entradas, salidas y saldo por
        centro (TSK-719); comparativa de todos los centros expandible al detalle |`. Debajo de la
        tabla, una subsección `#### Movimientos por Centro de Costo (TSK-719)` con la regla de
        signo por `Account.nature`, el filtro `costCenterId: uuid | 'all' | 'none'`, la
        restricción del bucket "sin centro" a cuentas de resultado, el switch de borradores y el
        helper puro `shared/utils/cost-center-movements.ts`. Matizar la frase
        *"Todos los reportes solo consideran asientos POSTED"* (`:162`) con "salvo Movimientos por
        Centro de Costo, que puede incluir borradores a pedido y avisa cuando los excluye".
  - [ ] `docs/architecture/data-model.md:466`: completar la fila de `JournalEntryLine` — hoy dice
        solo `accountId, debit, credit, description` y le faltan los auxiliares: agregar
        `customerId?, supplierId?, costCenterId?` y los índices nuevos
        (`@@index([costCenterId])`, `@@index([entryId])`, TSK-719).
  - [ ] Crear `scripts/guia-presentacion/capturas-tsk719.mjs` (molde `capturas-tsk721.mjs` y
        `capturas-tsk728.mjs:1-45`: `baseUrl` por argumento, login con las credenciales de la
        memoria `dev-local-capturas-y-login`, `psql` vía `docker exec contable-pms-db`,
        `hideNextBadge`, restauración al final). Siembra en "Empresa de Prueba 01 SA" lo que la
        base de dev no tiene (1.2.6): una factura de **venta** con reparto entre Logística y
        Mantenimiento, una de **compra** ídem, una **nota de crédito** de venta, y el `POSTED` de
        esos asientos; deja **uno en borrador a propósito** para la captura del aviso. Capturas:
        (1) el informe en el selector; (2) "Todos los centros" con la comparativa; (3) un centro
        expandido con el detalle y el saldo acumulado; (4) el aviso de borradores; (5) el mismo
        período con "Incluir borradores" activado; (6) "(Sin centro de costo)"; (7) el Excel
        abierto (o la fila de descarga); (8) el menú "Ver movimientos" en Empresa → Centros de
        Costo; (9) el informe abierto por deep-link ya filtrado. Borrar los datos `TSK719-*` al
        terminar.
  - [ ] Crear `scripts/guia-presentacion/tsk-719.html` (estructura de `tsk-728.html`): "Qué pedía
        el ticket" (en palabras de Elizabeth: *"habilitar los movimientos Entradas y Salidas"*),
        "Qué cambió" (antes/después con capturas), "Cómo se usa paso a paso", "Qué significan
        Entrada y Salida" (con el ejemplo de la nota de crédito), **"Qué NO imputa centro de
        costo"** (movimientos de fondos, amortización de equipos, recibos, órdenes de pago,
        gastos y sueldos; el centro del legajo y del equipo son informativos) y **"Borrador vs
        Registrado"** (por qué un asiento recién generado no aparece y cómo registrarlo). Generar
        con `node scripts/guia-presentacion/generar-pdf.mjs scripts/guia-presentacion/tsk-719.html
        docs/presentaciones/TSK-719-movimientos-centro-de-costo.pdf`.
- **Archivos:**
  - Crear: `scripts/guia-presentacion/capturas-tsk719.mjs`, `tsk-719.html`,
    `docs/presentaciones/TSK-719-movimientos-centro-de-costo.pdf`,
    `scripts/guia-presentacion/assets/tsk719-*.png`
  - Modificar: `src/modules/help/features/guide/components/_AccountingGuide.tsx`,
    `_CompanyGuide.tsx`, `docs/modules/accounting.md`, `docs/architecture/data-model.md`
- **Criterio de completitud:** la pestaña Contabilidad de la guía describe el informe, la regla de
  entrada/salida, el límite de qué imputa centro de costo y el tema borradores; `docs/` refleja el
  reporte, la semántica y los índices; el PDF existe, abre y tiene las nueve capturas legibles más
  las secciones "Qué NO imputa centro de costo" y "Borrador vs Registrado".

#### Fase 7: Verificación final (con siembra, porque en dev no hay datos)

- **Objetivo:** evidencia de que funciona sobre datos reales, incluido el caso "solo borradores",
  que es el que la clienta se va a encontrar primero.
- **Tareas:**
  - [ ] `npm run check-types` → **219** (línea base); `npm run lint` sin errores nuevos en los
        archivos tocados; `npm run test` en verde (el unitario de la fase 2 y el de integración de
        la fase 3, verificando que el `afterAll` deja `count` 0 de `TSK719-TEST-*`).
  - [ ] `npm run build` (la fase 5 toca `useSearchParams`: el build es el único que detecta el
        error de Suspense).
  - [ ] Levantar dev según la memoria `dev-local-capturas-y-login`:
        `NEXT_PUBLIC_APP_URL=http://localhost:3010 npm run dev -- -p 3010`, usuario
        `fspiritosi@codecontrol.com.ar`, empresa activa **"Empresa de Prueba 01 SA"** (es la que
        tiene el plan de cuentas y las dos líneas con centro).
  - [ ] **Estado inicial, antes de sembrar** (1.2.6: 8 centros, 2 líneas con centro, 22 asientos
        y todos DRAFT): abrir el informe con "Todos los centros" y el período que cubre el
        asiento N° 8 → debe salir **vacío con el aviso** "Hay 1 asiento en borrador… por
        $100.000"; activar "Incluir borradores" → aparecen Logística $60.000 y Mantenimiento
        $40.000 como **salidas**. Capturar: es la prueba del riesgo 1.6-1.
  - [ ] Sembrar y **registrar** (POSTED) desde la app, no por SQL, para ejercitar el circuito
        real: (1) una factura de **venta** con dos líneas repartidas entre Logística y
        Mantenimiento; (2) una factura de **compra** ídem; (3) una **nota de crédito** de venta
        sobre la primera; (4) registrar los asientos desde Contabilidad → Asientos (permiso
        `accounting.entries` acción `approve`); (5) dejar una cuarta factura confirmada **sin**
        registrar.
  - [ ] Pasos manuales:
    1. Un centro con período que incluye todo → entradas, salidas y saldo correctos; la NC
       **resta** de las entradas (verificar el número a mano contra el Libro Mayor).
    2. "Todos los centros" → una fila por centro; expandir dos y ver el detalle con el saldo
       acumulado reiniciando en cada grupo.
    3. "(Sin centro de costo)" → aparecen las líneas de resultado no imputadas y **no** aparecen
       Cuentas por Cobrar/Pagar ni IVA.
    4. Aviso de borradores con el importe de la factura sin registrar; activarlo y ver la fila
       con el badge Borrador.
    5. Período sin movimientos → empty state correcto (el de "sin movimientos", no el de
       borradores).
    6. Un centro **eliminado** (dar de baja uno con historia desde el ABM) sigue disponible en el
       selector con "(inactivo)" y muestra sus movimientos.
    7. Export a Excel: abre, trae Debe y Haber además de Entrada/Salida, y los totales por centro
       coinciden con la pantalla.
    8. Deep-link: "Ver movimientos" desde Empresa → Centros de Costo abre el informe filtrado y
       cargado.
    9. Permisos: con un usuario `@demo.local` sin `accounting.reports` el ítem "Ver movimientos"
       no aparece y la ruta de informes redirige; con `accounting.reports` pero sin
       `company.cost-centers`, el informe funciona igual (el selector es del módulo contable).
  - [ ] Cruzar el reporte contra el **Libro Mayor** del mismo período y las mismas cuentas: el
        total de una cuenta de resultado tiene que coincidir con la suma de los centros más el
        bucket "(Sin centro de costo)". Si no cuadra, hay un filtro de más (riesgo 1.6-7).
  - [ ] Consulta en producción (`psql` según memoria `produccion-dokploy-scripts-db`) para dejar
        registrado cuántos centros, cuántas líneas con centro y cuántos asientos POSTED/DRAFT hay
        en la base de la clienta, y así anticipar si el informe le va a salir vacío el primer día.
        Anotar el resultado en la sección 5.
  - [ ] Documentar todo en la sección 5 con los conteos, los asientos generados y las capturas.
- **Archivos:** ninguno nuevo (sección 5 del documento).
- **Criterio de completitud:** los nueve pasos manuales pasan, el cruce con el Libro Mayor cuadra,
  tests y tipos en línea base, build en verde, sección 5 completa con la consulta de producción.

### 2.2 Orden de ejecución

1. **Fase 1 primero y sola.** Es una migración: conviene su propio commit ("índices de
   `journal_entry_lines`") para poder revertirla sin arrastrar nada. Las demás fases **no
   dependen técnicamente** de ella (la query funciona igual sin índice), así que si la migración
   se trabara por drift en dev, el resto puede avanzar; pero no se mergea el ticket sin ella.
2. **Fase 2 después de la 1** (o en paralelo: no comparte ni un archivo). Commit propio con el
   test unitario. Las fases 3 y 4 dependen de sus exports (`buildMovementRows`,
   `groupByCostCenter`, `summarizeDrafts`, `buildExcelRows`, `NO_COST_CENTER_LABEL`), así que es
   la que marca el ritmo.
3. **Fase 3 después de la 2.** Toca un solo archivo de producción (`reports/actions.server.ts`) y
   crea el test de integración.
4. **Fase 4 después de la 3.** Necesita las dos actions y los tipos inferidos. Es la única fase
   con trabajo de UI pesado.
5. **Fases 5 y 6 después de la 4**, y **entre sí en paralelo**: verificado que no comparten
   archivos salvo `_CostCenterMovementsReport.tsx`, que la 5 toca para agregar
   `initialCostCenterId` mientras la 6 no toca ningún `.tsx` del módulo contable (solo guías,
   `docs/` y `scripts/`). Si se hacen en paralelo, las **capturas y el PDF de la 6 van al final**:
   necesitan el deep-link de la 5 para las capturas 8 y 9.
6. **Fase 7 al final**, con todo montado y los datos sembrados.

Si hubiera que recortar alcance, se recorta la **fase 5** (el análisis lo dice en 1.2.10: sin el
reporte no hay nada; sin el link hay algo que funciona y se le puede mostrar a la clienta). Lo
que **no** se puede recortar es el aviso de borradores de la fase 4 ni la sección "qué NO imputa
centro de costo" de la fase 6: son las dos mitigaciones de los riesgos altos.

**Riesgos de orden a tener presentes:**

- El helper de la fase 2 define los nombres visibles `'(Sin centro de costo)'`, "Entrada",
  "Salida": escribirlos una vez ahí y **copiarlos literalmente** en la UI (fase 4), en las guías
  y en el PDF (fase 6). El test unitario falla si alguien los cambia sin actualizar.
- La fase 4 registra el reporte en **tres lugares** (`ReportType`, el array `financialReports`, el
  render condicional de `_ReportsContent`): olvidar el tercero deja un botón que no pinta nada y
  `check-types` no lo acusa. Hacerlos en el mismo commit.
- La fase 5 toca `_ReportsContent.tsx`, que condiciona los 12 reportes existentes: el fallback
  `'trial-balance'` y la validación del parámetro son obligatorios, y hay que probar a mano al
  menos otros dos informes después del cambio.
- `useSearchParams` sin `<Suspense>` **no falla en `npm run dev`**, falla en `npm run build`:
  correr el build dentro de la fase 5, no recién en la 7.
- El test de integración de la fase 3 crea su propia empresa y sus propias cuentas: si se reusara
  la empresa de dev, el `afterAll` borraría asientos reales. Prefijo `TSK719-TEST-` en **todo**,
  incluida la empresa, como hace `cost-center.integration.test.ts`.
- La siembra de la fase 7 registra asientos (POSTED) en la base de dev: son datos que después
  **sí** se ven en el Libro Mayor y en el Balance de dev. Está bien —hoy no hay ninguno— pero hay
  que dejarlo anotado en la sección 5 para no confundirse en el próximo ticket.

### 2.3 Estimación de complejidad

- Fase 1 (dos `@@index`, migración aditiva sin datos): **baja** — 15 minutos, molde calcado.
- Fase 2 (helper puro con cinco funciones y 14 casos): **media** — la dificultad no es el código
  sino acertar los casos de signo (NC de venta y de compra) y el orden estable de las filas; es
  la fase que evita el bug silencioso del ticket.
- Fase 3 (dos actions + test de integración con andamiaje propio): **media-alta** — el costo fijo
  es el `beforeAll` con siete asientos y su limpieza; la query en sí es una sola con `select`.
- Fase 4 (dos componentes nuevos, tres puntos de registro, selector con React Query, switch,
  tarjetas, aviso, empty state doble, export): **alta** — es la fase más larga en líneas y la
  única que no se puede cubrir con tests automáticos en este proyecto.
- Fase 5 (deep-link, Suspense, menú y permisos en el otro módulo): **media** — chica en líneas
  pero toca un archivo compartido por 12 reportes y cruza la frontera de dos módulos.
- Fase 6 (dos guías, dos docs, script de capturas con siembra y nueve capturas, HTML + PDF):
  **media-alta** — como en los tickets anteriores, el PDF con datos coherentes es lo que más
  tiempo lleva, y acá además hay que **sembrar de cero** porque la base de dev no tiene nada que
  mostrar.
- Fase 7 (nueve pasos manuales + siembra + cruce con el Mayor + consulta en producción):
  **media**.

**Complejidad total: media-alta.** No hay permisos nuevos que registrar (`accounting.reports` ya
existe), ni módulos que agregar a `ACTIVATABLE_MODULES` (regla 13: `accounting` ya está), ni
rutas nuevas, ni cambios de firma en actions existentes, ni riesgo contable (es todo lectura). La
migración es la más inocua posible. El peso está en la UI de la fase 4 y en que **no hay datos
para verificar nada** sin sembrarlos primero: la fase 7 es más cara de lo habitual por eso.

### 2.4 Seguimientos fuera de alcance

Registrados para que no se filtren en este ticket y para abrirlos aparte:

1. **Movimientos de fondos, equipos, recibos, órdenes de pago, gastos y CMV no imputan centro de
   costo** (1.2.2, riesgo 1.6-2). Es la limitación más visible del reporte: un centro "Logística"
   va a mostrar las compras de combustible facturadas pero no el pago del combustible cargado como
   gasto, ni la amortización del camión, ni los sueldos del sector. **Amerita ticket propio**, y
   probablemente más de uno: el más barato y de mayor impacto es `Expense` (gastos), que ya tiene
   cuenta de resultado y una sola línea; le sigue la depreciación de equipos, donde
   `Vehicle.costCenterId` ya existe (`schema.prisma:2040-2041`) y solo hay que llevarlo a la línea
   del asiento en `integrations/equipment/index.ts`. Este ticket **no** lo hace: lo declara en la
   guía y en el PDF para no generar expectativa falsa.
2. **Falta el campo de centro de costo en el modal de asiento manual** (1.2.2): el Zod lo admite
   (`accounting/shared/types/index.ts:33`), la action lo persiste (`entries/actions.server.ts:62`)
   y hay una validación que lo **exige** cuando la cuenta tiene `requiresAuxiliary =
   'COST_CENTER'` (`entries/validators/index.ts:113-117`), pero `_CreateEntryModal.tsx:55-56,173`
   arma cada línea sin él. O sea: hay cuentas que **no se pueden imputar a mano** hoy. Es un bug
   acotado (agregar un `<Select>` por línea) y es el complemento natural de este reporte.
3. **Presupuesto por centro de costo** (1.2.3): `Budget` es por cuenta
   (`schema.prisma:475-497`, `@@unique([companyId, accountId, fiscalYear])`) y no hay ninguna
   relación con `CostCenter`. En cuanto la clienta vea entradas y salidas por centro va a pedir
   "cuánto tenía presupuestado"; eso es una columna nueva en `Budget`, migración con `@@unique`
   ampliado y cambios en `getBudgetVarianceReport` (`actions.server.ts:1185-1205`). Ticket propio.
4. **`_ReportsContent` no refleja el informe elegido en la URL** (1.2.10-C): esta fase 5 solo
   **lee** el parámetro. Escribirlo con `router.replace` al cambiar de informe haría que se pueda
   compartir el link de cualquiera de los 13 y que el botón Atrás funcione; es chico pero toca el
   archivo de los 12 reportes y no hay forma de testearlo acá.
5. **Los 12 reportes existentes reciben `companyId` del cliente y no lo validan** contra
   `getActiveCompanyId()` (`getGeneralLedger:226`, `getJournalBook`, etc.): una llamada fabricada
   al server action puede leer los datos contables de otra empresa siempre que el usuario tenga
   `accounting.reports` en la suya. El `checkPermission` no cubre esto porque es por usuario, no
   por empresa. Las actions nuevas de este ticket **sí** lo validan; corregir las otras es una
   pasada de una línea por action más una revisión de los tests, y es un **ticket de seguridad**,
   no una limpieza.
6. **`@@index([accountId])` en `journal_entry_lines`**: no entra en la fase 1 porque ninguna query
   filtra líneas por cuenta en SQL. En cuanto alguien optimice el Libro Mayor (hoy trae **todos**
   los asientos del período y filtra por cuenta en memoria, `actions.server.ts:268-292`, que es
   además su verdadero problema de performance) ese índice pasa a ser necesario.
7. **Otras tablas sin índice en columnas que se filtran**: la revisión de la fase 1 mostró que
   `journal_entries` tiene solo `@@unique([companyId, number])` y **ningún índice por
   `(companyId, date)` ni por `(companyId, status)`**, que es exactamente el `where` de los seis
   reportes contables y del listado de asientos. Es el índice de mayor impacto del módulo y no
   entra acá para no mezclar alcance, pero conviene medirlo con `EXPLAIN ANALYZE` en producción y
   abrirlo como ticket de performance junto con el punto 6.
8. **`_CostCentersTable.tsx` es código muerto**
   (`company/features/cost-centers/list/components/_CostCentersTable.tsx`): no lo importa nadie
   (`grep` da solo su propia definición); el listado usa `_CostCentersDataTable`. Borrarlo es
   limpieza aparte, pero hay que **no** agregarle el "Ver movimientos" por error en la fase 5.
9. **`getCostCentersForSelect` sin `checkPermission`**
   (`cost-centers/list/actions.server.ts:99-121`, devuelve `[]` si no hay empresa activa pero no
   verifica permiso): contra la regla 11. Este ticket no la toca (crea su propia action), pero la
   deuda sigue ahí, igual que `getCostCentersForSelect` duplicada en
   `purchases/features/invoices/list/actions.server.ts:572`.
10. **Subtotales por mes en el reporte** (1.2.8): descartados a propósito para la primera entrega
    (agrupamiento extra + export más complejo, y el ticket no los pide). Si la clienta los pide,
    es un nivel más en `groupByCostCenter` y una fila más por mes en `buildExcelRows`.
11. **Filtro por rango de cuentas o por tipo dentro del reporte**: hoy se ve todo lo imputado al
    centro. Si aparecen muchas cuentas por centro, el paso natural es un sub-agrupamiento por
    cuenta dentro de cada centro (el "mayor del centro de costo" literal). No está pedido.
12. **`CostCenter` sigue sin código, jerarquía, responsable ni presupuesto** (1.2.1): el ticket
    pide ver movimientos, no enriquecer el modelo, y el análisis lo deja explícito en 1.5. Si la
    clienta pide agrupar centros (por ejemplo "Operaciones" conteniendo "Logística" y
    "Mantenimiento"), eso es `parentId` + migración + recursión en el reporte: ticket propio.

## 3. Diseño
_Pendiente - ejecutar `/disenar tsk-719-movimientos-por-centro-de-costo`_

## 4. Implementación

> Etapa de diseño (sección 3) salteada por decisión del usuario: el plan trae archivo:línea y firmas suficientes.

### Fase 1: Índices en journal_entry_lines
- **Estado:** Completada (2026-09-22)
- **Archivos modificados:**
  - `prisma/schema.prisma` - `@@index([costCenterId])` y `@@index([entryId])` en `JournalEntryLine`.
  - `prisma/migrations/20260922112920_tsk_719_journal_entry_lines_indexes/migration.sql` - creado: exactamente dos `CREATE INDEX`, sin ALTER/UPDATE/backfill.
- **Notas:** `\d journal_entry_lines` en dev lista los dos índices nuevos además de la PK. check-types 219 = base. En producción la migración la aplica el `docker-entrypoint.sh` al deployar. `CREATE INDEX` sin `CONCURRENTLY` bloquea escrituras mientras corre: con el volumen actual es instantáneo; si la tabla creciera a millones de filas habría que hacerlo a mano con `CONCURRENTLY`.

### Fase 2: Helper puro de movimientos por centro
- **Estado:** Completada (2026-09-22)
- **Archivos creados:**
  - `src/modules/accounting/shared/utils/cost-center-movements.test.ts` - 15 tests (los 14 del plan + "sin borradores devuelve el resumen en cero"), escritos primero y en rojo.
  - `src/modules/accounting/shared/utils/cost-center-movements.ts` - módulo puro (sin Prisma, sin `@/modules/*`, sin React). Exporta `NO_COST_CENTER_LABEL`, `splitLineAmount`, `buildMovementRows`, `groupByCostCenter`, `sumGroupTotals`, `summarizeDrafts`, `buildExcelRows` y los tipos `CostCenterMovementLine/Row/Group/Totals` y `DraftsSummary`.
- **Notas:**
  - Se agregó `sumGroupTotals(groups)` -no previsto en el plan- para que los totales generales se calculen y redondeen en el mismo lugar que los de cada grupo y la action no duplique la suma.
  - `shared/utils/index.ts` **no se tocó**: ese barrel solo reexporta `balances`; `account-code` y `account-subtree` se importan por ruta directa, así que el helper nuevo sigue la misma convención.
  - `shared/utils/decimal.ts` no se reusó: sus helpers son para `Decimal` de Prisma y usan `any`. El redondeo a 2 decimales es un `round2` local aplicado **solo a totales** (no a cada fila), como pedía el plan.
  - 228 líneas contra las "<180" del plan: la diferencia es el encabezado y los JSDoc que documentan la regla de signo; el código ejecutable son ~130 líneas.

### Fase 3: Actions del reporte
- **Estado:** Completada (2026-09-22)
- **Archivos creados:**
  - `src/modules/accounting/features/reports/cost-center-movements.integration.test.ts` - 11 tests contra la base real (rojos primero), con los tres `vi.mock` de frontera y prefijo `TSK719-TEST-`.
- **Archivos modificados:**
  - `src/modules/accounting/features/reports/actions.server.ts` - `getCostCenterMovements(companyId, { costCenterId, fromDate, toDate, includeDrafts })` y `getCostCentersForMovementsReport(companyId)`, más los tipos `CostCenterMovementsResult` y `CostCenterOption`; nuevos imports de `getActiveCompanyId` y del helper puro.
- **Notas:**
  - Payload de `getCostCenterMovements`: `{ groups, totals: { entradas, salidas, saldo }, draftsExcluded: { entryCount, saldo }, includeDrafts }`, con `groups` **siempre** un array (un centro puntual es un array de 1).
  - Una sola query `status IN (DRAFT, POSTED)` con el corte por estado en memoria, `select` mínimo y `Decimal → Number` en el map (regla 9). `REVERSED` nunca entra.
  - Las dos actions validan `companyId` contra `getActiveCompanyId()` y hacen `checkPermission('accounting.reports','view',{ redirect: true })`.
  - **Limpieza de la siembra:** los asientos POSTED y REVERSED son inmutables por el trigger `trg_journal_entry_immutable` (migración `20260624100000_accounting_constraints`), así que el `afterAll` borra dentro de una transacción con `SET LOCAL session_replication_role = 'replica'`. Es el alcance más chico posible (esa conexión y ese bloque) en vez de un `ALTER TABLE ... DISABLE TRIGGER`, que afectaría a toda la tabla mientras corren otros tests en paralelo. Verificado: 0 filas `TSK719-TEST-*` en `companies`, `cost_centers`, `accounts` y `journal_entries`.
  - `prettier --check` sobre `actions.server.ts` ya fallaba en `HEAD` (el plugin `organize-imports` reordena imports viejos): no se reformateó el archivo entero para no ensuciar el diff; el bloque nuevo sí está prettier-limpio.

### Fase 4: UI del reporte
- **Estado:** Completada (2026-09-22)
- **Archivos creados:**
  - `.../reports/components/_CostCenterMovementsReport.tsx` (160 líneas) - filtros, llamada a la action, orquestación.
  - `.../reports/components/_CostCenterMovementsFilters.tsx` (131) - selector de centro, período y switch de borradores.
  - `.../reports/components/_CostCenterMovementsSummary.tsx` (94) - tarjetas de totales, aviso de borradores y empty state.
  - `.../reports/components/_CostCenterMovementsTable.tsx` (152) - comparativa por centro con detalle expandible.
  - `.../reports/components/cost-center-movements-excel.ts` (64) - columnas y export a Excel.
- **Archivos modificados:**
  - `.../reports/components/_ReportsSelector.tsx` - `REPORT_TYPES`, `isReportType`, entrada en `financialReports` (ícono `Wallet`).
  - `.../reports/components/_ReportsContent.tsx` - render condicional del informe nuevo.
- **Notas:**
  - **Cinco archivos en vez de dos.** El plan preveía `_Report` + `_Table`; con los filtros, las tarjetas, el aviso, el empty state y las 12 columnas del Excel, el componente principal daba 271 líneas. Se partió en Filters, Summary (molde `_BudgetVarianceSummary`, que ya existe en la carpeta) y un módulo `cost-center-movements-excel.ts` (precedente: `accounting/features/accounts/components/actions.ts`). Todos quedan bajo 200 líneas.
  - `ReportType` **se deriva** de `REPORT_TYPES` (`(typeof REPORT_TYPES)[number]`) en vez de duplicar la lista de 13 ids: el union y la validación de la URL no pueden desincronizarse.
  - Defectos del molde corregidos **solo acá**: la `key` va en un `<Fragment key=...>` externo y las filas del detalle se identifican por `lineId`.
  - Responsive: `overflow-x-auto` + `min-w-[640px]`; Descripción con `hidden sm:table-cell`, y para que el `colSpan` no desalinee en mobile la fila de grupo emite su propia celda `hidden sm:table-cell` en lugar de un `colSpan` único.
  - Con un solo grupo el detalle se expande solo (es lo que el usuario vino a ver); con "Todos" arranca contraído.
  - El aviso dice, literal: *"Hay N asientos en borrador con movimientos de este centro por $X en entradas|salidas que no están incluidos. Registralos desde Contabilidad → Asientos para que impacten, o activá «Incluir borradores» para verlos acá."* (con `sin impacto neto en el saldo` cuando el neto da 0). Empty states: *"No hay movimientos registrados en el período; los N asientos en borrador de arriba son los únicos que tocan este centro."* / *"El centro no tiene movimientos en el período."*
  - `prettier --check` **ya fallaba en `HEAD`** para `_ReportsSelector.tsx`, `_ReportsContent.tsx` y `ReportsList.tsx` (igual que `actions.server.ts` en la fase 3): no se reformatearon enteros; los archivos nuevos sí están prettier-limpios.

### Fase 5: Deep-link y acceso desde Centros de Costo
- **Estado:** Completada (2026-09-22)
- **Archivos modificados:**
  - `.../reports/components/_ReportsContent.tsx` - `useSearchParams()` (solo lectura) para `?report=` con fallback `'trial-balance'` vía `isReportType`, y `?costCenterId=` como `initialCostCenterId`.
  - `.../reports/ReportsList.tsx` - `<Suspense fallback={null}>` alrededor de `_ReportsContent`.
  - `.../reports/components/_CostCenterMovementsReport.tsx` - prop `initialCostCenterId`, auto-consulta al montar y caída a "Todos" con `toast.info` si el centro del enlace no está en el selector.
  - `company/features/cost-centers/list/CostCentersList.tsx` - `getModulePermissions('accounting.reports')` + `getActiveCompany()` en el `Promise.all`.
  - `company/features/cost-centers/list/components/_CostCentersDataTable.tsx` - prop nueva y `router.push` al informe filtrado.
  - `company/features/cost-centers/list/columns.tsx` - ítem "Ver movimientos" (ícono `BarChart3`, `data-testid="cost-center-movements-<id>"`) arriba de Editar, y `canViewReports` sumado a `hasAnyAction`.
- **Notas:**
  - **Verificación pedida por el plan (módulo Contabilidad desactivado): `getModulePermissions` NO contempla los módulos activos.** Resuelve solo RBAC (`getModulePermissions.server.ts:45-80`); el filtrado por `activeModules` vive únicamente en `shared/actions/sidebar.ts:61-66`. Por eso `CostCentersList` suma `getActiveCompany()` y exige también `isModuleActiveForCompany('accounting.reports', activeCompany?.activeModules ?? [])` (el prefijo `accounting` está en `PERMISSION_MODULE_MAP`, y `activeModules` vacío = todos activos).
  - El enlace navega por URL (`router.push`): `company` no importa nada de `accounting` (`module-communication.md`).
  - `_ReportsContent` **no escribe** la URL al cambiar de informe (queda como seguimiento en 2.4).
  - El `<Suspense>` es obligatorio: sin él `npm run build` falla con *"useSearchParams() should be wrapped in a suspense boundary"*. Verificado con `npm run build` (compila).

### Fase 6: Documentación
- **Estado:** Pendiente

### Fase 7: Verificación final
- **Estado:** Pendiente

## 5. Verificación
_Pendiente - ejecutar `/verificar tsk-719-movimientos-por-centro-de-costo`_
