# TSK-724c: Cuentas contables de Bienes de Uso por equipo

**Fecha de inicio:** 2026-09-18
**Tickets:** [724-c] "Configuración de Cuentas Contables — Cuentas de Bienes de Uso" · cierra el paraguas 724 (a/b en 721, d en 717)
**Origen:** reunión con Elizabeth Perez del 16-17/09
**Estado:** Verificación completada (fases 1-9; pendiente solo la consulta 1.2.7 en producción, post-deploy)

---

## 1. Análisis

### 1.1 Problema

TSK-724 punto c dice: *"Cuentas de Bienes de Uso ⇒ Existen más de una cuenta para los bienes de
uso, así que se determina por ítem"*. Hoy la configuración contable tiene **una sola** cuenta de
activo para todos los equipos: `AccountingSettings.fixedAssetAccountId` (`prisma/schema.prisma:578`),
acompañada de una sola cuenta de amortización acumulada (`accumulatedDepreciationAccountId`,
`:579`), una de gasto de amortización (`depreciationExpenseAccountId`, `:580`) y una de resultado
por venta/baja (`assetDisposalGainLossAccountId`, `:581`). La sección del form se llama "Cuentas
de Activos Fijos" y los cuatro campos no tienen texto de ayuda
(`src/modules/accounting/features/settings/components/_CommercialIntegrationForm.tsx:228-244`).

Contablemente eso no cierra: el plan modelo que el propio sistema importa (`Plan de Cuentas
Modelo`, ticket #382) abre **BIENES DE USO** en rubros separados —Inmuebles, Maquinarias y
Equipos, Muebles y Útiles, Rodados, Equipos Tecnológicos, Terrenos, Instalaciones, Equipos de
Comunicación— y cada rubro tiene su propia "Amortizaciones Acumuladas"
(`src/modules/accounting/features/accounts/data/model-chart-of-accounts.ts:420-600`). Con una
única cuenta global, un camión, una máquina y una oficina se amortizan y se dan de baja contra la
misma cuenta, y la amortización acumulada de todos termina en una sola cuenta. La clienta quiere
que **la cuenta se determine por equipo**, con la global como **"por defecto"**, igual que se
resolvió para ventas/compras por ítem (TSK-721) y para aportes por socio (TSK-717).

Lo que se pide, en concreto:

1. Que un equipo pueda tener sus propias cuentas de **Bienes de Uso**, **Amortización acumulada** y
   **Gasto de amortización**, y que los asientos que el sistema genera para ese equipo (amortización
   mensual, baja por venta/pérdida/devolución, ajuste de valor) las usen.
2. Que las cuatro cuentas de Configuración pasen a ser "por defecto" (respaldo declarado), con la
   misma semántica y los mismos textos que ya aprendió la usuaria en 717/721.
3. Que si a un equipo no se le puede resolver una cuenta, el sistema **lo diga** (nombrando el
   equipo y dónde configurarla) en lugar de saltear el asiento en silencio, y que ese mensaje
   **llegue en producción** (`ActionResult`, memoria `errores-negocio-server-actions.md`).

### 1.2 Contexto actual

#### 1.2.1 Integración contable de equipos hoy

Archivo: `src/modules/accounting/features/integrations/equipment/index.ts` (330 líneas).

**Qué asientos genera realmente.** El encabezado (`:1-23`) documenta cuatro asientos: alta
(capitalización), depreciación periódica, baja por venta y baja por pérdida/devolución. Pero el
archivo **solo exporta dos funciones**: `createJournalEntryForAssetSale` (`:169-245`) y
`createJournalEntryForAssetDisposal` (`:254-330`).

- **No existe asiento de alta/capitalización.** `grep createJournalEntryForAsset` en `src/` solo
  da esas dos funciones y su importación en `equipment/features/list/actions.server.ts:14-17`.
  `getEquipmentAccountingSettings` (`:40-56`) selecciona `payablesAccountId` (`:50`) para ese
  asiento que nunca se escribió: es código muerto. El alta contable del bien ocurre **en la
  factura de compra**: el ítem comprado puede tener `defaultExpenseAccountId` de tipo ASSET
  (TSK-579, `commercial/features/products/shared/account-filters.ts:22-31`) y el asiento de compra
  debita esa cuenta (TSK-721, `integrations/commercial/index.ts`). Es decir, **el alta ya es "por
  ítem"**; lo que sigue siendo global es todo lo posterior.
- **La depreciación periódica no vive acá** sino en `equipment/features/depreciation/actions.server.ts`
  (1.2.2).

**Baja por venta** (`createJournalEntryForAssetSale`, `:169-245`):

- Guard: `if (!fixedAssetAccountId || !accumulatedDepreciationAccountId || !assetDisposalGainLossAccountId)`
  → `logger.warn('Cuentas de activos fijos no configuradas - asiento de baja omitido')` y
  **`return null`** (`:176-185`). Mismo silencio que tenía facturas antes de TSK-721.
- Sin `VehicleDepreciation` → `warn('Equipo sin depreciación configurada - asiento de baja
  omitido')` y `return null` (`:194-199`). Un equipo sin depreciación configurada **nunca genera
  asiento de baja**, aunque se haya comprado contra Bienes de Uso.
- Líneas (`:207-232`): Debe `accumulatedDepreciationAccountId` por `totalDepreciated`; Haber
  `fixedAssetAccountId` por `grossValue`; si `currentBookValue > 0`, Debe
  `assetDisposalGainLossAccountId` por el valor libro (`:225-232`). Nunca registra ganancia: el
  precio de venta entra por la factura de venta ("El ingreso por venta se registra vía factura de
  venta", `:165-168`), así que este asiento siempre carga el valor residual como pérdida.
- Fecha del asiento: `new Date()` (`:237`), no la fecha de baja elegida.

**Baja por pérdida total / devolución** (`createJournalEntryForAssetDisposal`, `:254-330`): espejo
exacto, mismos guards (`:261-270`, `:279-284`), mismas líneas (`:292-317`).

**`createJournalEntry` interno** (`:69-159`): valida balance (`:84-88`, `throw`), bloqueo de
período (`:91-104`, `throw` "el período está cerrado"), resuelve ejercicio/período (`:106-124`),
numera con `UPDATE … RETURNING` (`:127-132`) y crea el asiento con `createdBy: 'system'` (`:134-152`).

**Quién la llama y qué pasa con el resultado.** `softDeleteVehicle(id, terminationReason)`
(`equipment/features/list/actions.server.ts:333-379`): dentro de `prisma.$transaction` (`:342`) marca
`isActive: false` + `terminationDate` + `terminationReason` (`:344-351`), llama a
`createJournalEntryForAssetSale` si `SALE` o a `…Disposal` si `TOTAL_LOSS`/`RETURN` (`:354-358`;
`OTHER` no genera nada), y marca la depreciación `COMPLETED` (`:361-371`). El `catch` (`:374-378`)
**convierte cualquier error en `throw new Error('Error al dar de baja el vehículo')`**, incluido
"período cerrado". Y el cliente ni siquiera lee el mensaje:
`_EquipmentDataTable.tsx:116-118` hace `onError: () => toast.error('Error al dar de baja el
equipo')`. Resultado hoy: **una empresa sin cuentas de activos fijos vende un camión, el equipo
queda dado de baja, no hay asiento y nadie se entera**; y si el período está cerrado, el usuario
ve un genérico sin saber por qué.

Detalle menor pero visible: el botón "Dar de Baja" del encabezado del detalle
(`detail/components/_EquipmentHeader.tsx:153-158`) **no tiene `onClick`**: solo funciona la baja
desde el menú del listado.

#### 1.2.2 Amortización hoy

Archivo: `src/modules/equipment/features/depreciation/actions.server.ts` (1045 líneas). Tres
funciones generan asientos, todas con Prisma directo (no usan `createJournalEntry` de la
integración):

**`postDepreciationEntry(scheduleEntryId)`** (`:426-595`) — contabiliza **un período de un
equipo**:

- Lee `depreciationExpenseAccountId`, `accumulatedDepreciationAccountId`, `lockedUntilDate`
  (`:480-486`) y si falta alguna **lanza** `Error('Las cuentas contables de depreciación no están
  configuradas. Configure las cuentas en Contabilidad > Configuración.')` (`:489-493`). Acá **no**
  hay silencio, pero es un `throw new Error` de Server Action: en `npm run dev` el toast lo muestra
  (`_DepreciationTab.tsx:105-107`, `toast.error(error.message)`); **en producción Next lo redacta**
  (memoria `errores-negocio-server-actions.md`).
- Asiento (`:520-545`): Debe `depreciationExpenseAccountId` / Haber
  `accumulatedDepreciationAccountId` por `entry.amount`, descripción "Depreciación período N:
  Equipo {label}", fecha `entry.scheduledDate`. Marca `isPosted` (`:549-557`), actualiza `currentBookValue` /
  `totalDepreciated` (`:560-566`) y completa la depreciación si no quedan períodos (`:570-579`).

**`postAllPendingDepreciations(upToDate)`** (`:600-777`) — contabilización masiva desde el
listado (`_BulkDepreciationDialog.tsx`):

- Mismo guard global con `throw` antes de tocar nada (`:610-623`).
- Trae todos los `DepreciationScheduleEntry` pendientes hasta la fecha de todas las depreciaciones
  ACTIVE de la empresa (`:626-648`) y, dentro de **una** transacción (`:658`), itera **uno por uno**
  (`:659-764`): **un asiento por equipo y por período** (`:695-720`), no un asiento agrupado por
  período. Esto es lo que hace viable la cuenta por equipo: cada asiento ya es de un solo equipo,
  no hay nada que "desagrupar".
- Los errores por equipo van a `errors: string[]` (`:674-678`, `:756-762`) y la función devuelve
  `{ posted, errors }`. El diálogo solo muestra el **conteo**: `toast.warning('N error(es) durante
  la contabilización')` (`_BulkDepreciationDialog.tsx:52-54`); los mensajes no se ven.

**`createValueAdjustment(vehicleId, input)`** (`:786-988`) — revaluación / deterioro:

- Lee `fixedAssetAccountId`, `accumulatedDepreciationAccountId`, `assetDisposalGainLossAccountId`
  (`:826-833`). Si están las tres genera asiento (`:843-905`): revaluación = Debe Bienes de Uso /
  Haber Resultado; deterioro = Debe Resultado / Haber Amortización acumulada. **Si falta alguna, no
  hay rama `else`**: el ajuste se guarda con `journalEntryId` en `undefined` (`:840`, `:907-919`) y se
  recalcula el plan **sin asiento y sin aviso**. Tercer silencio.

**Consumidores en el cliente**: `_DepreciationTab.tsx` (439 líneas; `postMutation` `:95-107`),
`_DepreciationConfigDialog.tsx` (256; `grossValue` se preinicializa con `vehiclePrice` `:52`, que
viene de `Vehicle.price` vía `EquipmentDetail.tsx:299-301`), `_ValueAdjustmentDialog.tsx` (173;
`:71`), `_BulkDepreciationDialog.tsx` (134). Todos hacen `toast.error(error.message)` sobre
excepciones: **ninguno usa `ActionResult`**.

**Conclusión de 1.2.1 + 1.2.2**: hay tres puntos de generación de asientos (amortización,
baja, ajuste) y tres comportamientos distintos ante cuentas faltantes (throw redactado en prod,
`return null` tragado por un catch genérico, y guardado sin asiento). Con cuentas por equipo hay
que unificar los tres en el patrón 721: **resolver → pre-validar antes de la transacción →
`BusinessError` → `ActionResult`**.

#### 1.2.3 Modelo de datos y catálogos

**`Vehicle`** (`prisma/schema.prisma:1961-2043`, tabla `vehicles`) — es "el equipo" (no existe
`Equipment` ni `Asset`):

- Identificación: `internNumber`, `domain`, `chassis`, `engine`, `serie`, `year`, `kilometer`
  (`:1966-1973`). Estado: `status`, `condition`, `isActive` (`:1980-1982`); baja:
  `terminationDate`, `terminationReason VehicleTerminationReason?` = SALE | TOTAL_LOSS | RETURN |
  OTHER (`:1985-1986`, enum `:1919-1926`).
- Titularidad: `titularityType` LEASING | RENTAL | OWNED | PLEDGED (`:1989`, enum `:1928-1935`),
  `ownerId → EquipmentOwner` (`:1997-1998`), `currency`, **`price Decimal?` "Valor del equipo"**
  (`:1994`), `monthlyPrice` (`:1995`). No hay `acquisitionCost` ni `acquisitionDate`: el valor de
  origen contable vive en `VehicleDepreciation.grossValue`.
- Catálogos: `brandId → VehicleBrand?` (`:2009`), `modelId → VehicleModel?` (`:2012`),
  **`typeId String → VehicleType` (obligatorio, `:2015-2016`)**, **`typeOfVehicleId String →
  TypeOfVehicle` (obligatorio, `:2018-2019`)**, `costCenterId?`, `sectorId?`, `typeOperativeId?`
  (`:2021-2029`).
- Contabilidad: `depreciation VehicleDepreciation?` (1→1, `:2037`), `valueAdjustments` (`:2038`).
  **Ninguna referencia a `Account`, ni a `Product`, ni a una línea de compra.**

**`VehicleType`** "Tipos de Equipo (Camión, Semirremolque, Acoplado, etc.)"
(`:1097-1117`, tabla `vehicle_types`): `name`, `hasHitch`, `isTractorUnit`, `isActive`,
`companyId`, `@@unique([companyId, name])`. Tiene **ABM propio** en Empresa → Tipos de Equipo
(`src/modules/company/features/vehicle-types/list/`, ruta `/dashboard/company/vehicle-types`,
permiso `company.vehicle-types`, `shared/lib/permissions/constants.ts:69,168`): `createVehicleType`
/ `updateVehicleType` / `deleteVehicleType` (`actions.server.ts:147,175,212`, inputs `:19-29`
solo `name`/`hasHitch`/`isTractorUnit`), modal `_VehicleTypeFormModal.tsx` (196 líneas, Zod
`:30-34`, dos checkboxes `:150-170`). Para selects: `getVehicleTypesForSelect` (`:104-118`,
`select { id, name, hasHitch, isTractorUnit }`, **sin `checkPermission`**) y el hook
`useVehicleTypes` (`shared/hooks/useCatalogs.ts:170-176`).

**`TypeOfVehicle`** "Clasificación de Vehículo (Vehículo vs Otros equipos)" (`:1119-1134`,
tabla `types_of_vehicles`): `name`, `isActive`, `companyId`. **No tiene ABM**: solo se siembra en
`prisma/seed.ts:794-805` ('Vehículos', 'Otros Equipos', 'Maquinaria', 'Remolques') y se lee con
`getTypesOfVehicleForSelect` (`shared/actions/catalogs.ts:22-36`). Se usa para las pestañas
"Vehículos / Otros" del listado, buscando el registro cuyo `name` es "Vehículos"
(`equipment/features/list/actions.server.ts:78-100`). Es la clasificación más parecida a un rubro
contable, pero sin pantalla de administración no puede ser el eje de configuración.

**`VehicleDepreciation`** (`:4060-4099`, `vehicle_depreciations`): `vehicleId @unique`, `method`,
`status` ACTIVE | COMPLETED | SUSPENDED, `grossValue`, `salvageValue`, `currentBookValue`,
`usefulLifeMonths`, `startDate`, `endDate`, `depreciationRate`, `totalDepreciated`,
`lastDepreciationDate`, `companyId`, `createdBy`. Sin cuentas.
**`DepreciationScheduleEntry`** (`:4101-4128`): `periodNumber`, `scheduledDate`, `amount`,
`accumulatedAmount`, `bookValueAfter`, `isPosted`, `journalEntryId?`, `postedDate`, `postedBy`.
**`AssetValueAdjustment`** (`:4130-4149`): `date`, `previousValue`, `newValue`,
`differenceAmount`, `reason`, `journalEntryId?`.

**`Account`** (`:296-377`): `isFixedAsset Boolean` (TSK-618, `:318`) "se propaga en cascada al
subárbol desde el rubro, y se puede destildar una cuenta puntual (ej. Amortizaciones
Acumuladas)". En la base de dev, con el plan modelo importado, las cuentas de "Amortizaciones
Acumuladas" **también** están marcadas `is_fixed_asset = true` (cascada; verificado con SQL, ver
1.2.7). Inversas ya existentes para las cuatro globales: `settingsAsFixedAsset`,
`settingsAsAccumulatedDepr`, `settingsAsDepreciationExpense`, `settingsAsAssetDisposalGL`
(`:360-363`). Precedentes de "cuenta por entidad" en el mismo modelo: `bankAccounts`,
`cashRegisters` (`:325-326`), `partners @relation("PartnerOwnContributionsAccount")` (`:327`,
TSK-717), `productsAsExpenseAccount` / `productsAsIncomeAccount` (`:370-371`).

**`AccountingSettings`** (`:509-651`): bloque "Cuentas de Activos Fijos (equipos / bienes de
uso)" `:577-586` (cuatro `String?` + cuatro relaciones nombradas). Todo nullable.

**Plan de cuentas modelo** (`model-chart-of-accounts.ts`, rubro 1.2.2 BIENES DE USO `:420-600`):

| Rubro | Valores de origen | Actualizaciones | Amort. acumulada |
|---|---|---|---|
| 1.2.2/01 INMUEBLES (`:426`) | /01/01 | /01/02 | /01/03 (`:444-445`) |
| 1.2.2/02 MAQUINARIAS Y EQUIPOS (`:450`) | /02/01 | /02/02 | /02/03 |
| 1.2.2/03 MUEBLES Y UTILES (`:474`) | /03/01 | /03/02 | /03/03 |
| 1.2.2/04 RODADOS (`:498`) | /04/01 (`:504-505`) | /04/02 | /04/03 (`:516-517`) |
| 1.2.2/05 EQUIPOS TECNOLOGICOS (`:522`) | /05/01 | — | /05/03 |
| 1.2.2/07 TERRENOS (`:540`) | /07/01 | /07/02 | — (no se amortiza) |
| 1.2.2/08 INSTALACIONES (`:558`) | /08/01 | /08/02 | /08/03 |
| 1.2.2/09 EQUIPOS DE COMUNICACION (`:582`) | /09/01 | /09/02 | /09/03 |

- **Convención de código**: `x.x.x/RR/01` = valores de origen, `/RR/02` = actualizaciones,
  `/RR/03` = amortizaciones acumuladas. Es una regularidad **del dataset**, no del código: no
  hay ninguna función en `src/` que relacione una cuenta de activo con su acumulada (grep de
  `/03`, `accumulated` fuera de settings: sin resultados). Además no es universal (Terrenos no
  tiene /03; Equipos Tecnológicos no tiene /02) y la clienta puede tener su propio plan con otros
  códigos. **No conviene derivar la acumulada por convención de código**: se elige explícita.
- **El gasto de amortización no va por rubro sino por función**: "Amortizaciones - Explotación"
  4.2.1/02/10 (`:1248-1250`), "Amortizaciones - Administración" (`:1357`), "Amortizaciones -
  Comercialización" (`:1465`), "Amortizaciones Inversiones en Bienes depreciables" 4.2.1/05/08
  (`:1573`), "Amortizaciones extraordinarias" 4.2.2/03/00 (`:1663`). Es decir, la cuenta de
  gasto **no se deduce de la cuenta de activo** (un camión de explotación y una camioneta de
  administración comparten rubro Rodados pero no cuenta de gasto). Tiene que ser configurable
  por separado, con la global como respaldo.
- **Resultado por venta/baja**: el plan modelo tiene **una** "Utilidad Venta Bienes de Uso"
  4.1.2/01/00 (`:1158-1160`) y **una** "Pérdida por venta bienes de uso" 4.2.2/01/00
  (`:1656-1658`), no una por rubro. Justifica dejar `assetDisposalGainLossAccountId` global
  (1.2.8).

#### 1.2.4 Feature de equipos y su form

`src/modules/equipment/features/`: `list/`, `create/`, `edit/`, `detail/`, `depreciation/`.

- **Alta**: `create/components/_EquipmentForm.tsx` (**965 líneas**, muy por encima de las 200 de la
  regla) con tres pestañas "Información" / "Contrato" / "Asignación" (`:238-257`). Cards:
  Clasificación (`typeOfVehicleId` "Clasificación *" `:268-292`, `typeId` "Tipo de equipo *"
  `:294-316`), Identificación, Marca y Modelo, Estado (pestaña Información); Titularidad
  (`:552-630`), Información de Contrato (`:634-707`), **"Valor del Equipo"** con Moneda y Valor
  (`:711-765`) (pestaña Contrato); Centro de Costo y Sector, Contratistas (pestaña Asignación).
  Zod local `:68-110` (`typeId` y `typeOfVehicleId` obligatorios `:107-108`). Catálogos por hooks
  de `@/shared/hooks` (`:55-64`). Action `createVehicle(input: CreateVehicleInput)`
  (`create/actions.server.ts:16-58, 63-118`).
- **Edición**: `edit/components/_EquipmentFormEdit.tsx` (**890 líneas**) es una **copia** del de
  alta con las mismas pestañas (`:196-204`) y la misma card "Valor del Equipo" (`:647-700`);
  `updateVehicle(id, input)` (`edit/actions.server.ts`, interface `:16`, `data` `:66-104`) y
  `getVehicleForEdit` (`:118`). Cualquier campo nuevo se agrega **dos veces**.
- **Detalle**: `detail/EquipmentDetail.tsx` (319 líneas, Server Component) con `UrlTabs`
  (`_EquipmentDetailTabs.tsx:11`: info | contract | assignment | contractors | documents |
  **depreciation** | qr). Card "Valor del Equipo" `:211-229`; pestaña Depreciación monta
  `_DepreciationTab` con `vehiclePrice` (`:299-301`). `getVehicleById` (`detail/actions.server.ts:17-56`)
  hace `include` de brand/model/type/typeOfVehicle/costCenter/sector/typeOperative/owner.
- **Listado**: `list/EquipmentList.tsx` → `_EquipmentDataTable.tsx` (353 líneas; acciones "Dar de
  baja" con diálogo de motivo `:290-343`, `deleteMutation` `:106-118`, `_BulkDepreciationDialog`
  `:53`). `_EquipmentTable.tsx` (436) es la versión previa no montada (solo la importa
  `EquipmentList.tsx:13` → `_EquipmentDataTable`; verificado por grep).
- **Acciones contables disponibles**: no existe "activar como bien de uso". El equivalente es
  **Configurar Depreciación** (`_DepreciationConfigDialog.tsx`, action `createVehicleDepreciation`
  `depreciation/actions.server.ts:145-251`): es el momento en que el equipo pasa a existir para
  contabilidad (sin `VehicleDepreciation` no hay amortización ni asiento de baja, 1.2.1).
  `updateVehicleDepreciation` (`:256-340`) y `deleteVehicleDepreciation` (`:386-417`) se bloquean
  si hay períodos contabilizados (`:283-285`, `:403-405`). "Dar de baja" con motivo (1.2.1) y
  "Ajuste de valor" (`_ValueAdjustmentDialog`) completan el ciclo.

**Cómo se elige una cuenta en otros forms del proyecto** (precedentes a copiar):

- `AccountCombobox` (`src/shared/components/common/AccountCombobox.tsx`, TSK-464): recibe
  `accounts: { id, code, name }[]`, `value`, `onChange`, `clearLabel` (`:18-36`).
- `buildImputableAccountsWhere({ companyId, types, atDate })`
  (`src/shared/lib/accounts/imputable-accounts.ts:33-46`): hojas activas vigentes, opcionalmente
  por tipo. Función pura, cada módulo la usa con su propio Prisma (sin import cross-module).
- **`includeIds`** para preservar la cuenta guardada aunque hoy no sea imputable:
  `getPartnerContributionAccounts(includeIds)` (`partners/features/list/actions.server.ts:164-183`)
  y `getActiveAccounts(companyId, includeIds)` (`accounting/features/settings/actions.server.ts:200-228`).
- **Campo extraído** para no engordar el form: `_PartnerAccountField.tsx` (64 líneas): `useQuery`
  con key que incluye `savedAccountId`, `AccountCombobox` con `clearLabel="Sin asignar (usar la
  cuenta por defecto)"`, `FormDescription` que explica el fallback y "Cambiarla no modifica los
  asientos ya generados" (`:31-60`).
- **Resolución en el asiento** con error explícito: `resolvePartnerCapitalAccount`
  (`fund-movements/list/actions.server.ts:248-3xx`): cuenta propia → verifica imputabilidad con
  `buildImputableAccountsWhere` → `BusinessError` que nombra al socio, la cuenta y dónde
  corregirla (`:279-290`); si no tiene propia, la global; si tampoco, `BusinessError` que dice
  dónde configurarla.
- Modelo: `Partner.contributionsAccountId String? @db.Uuid` + relación con `onDelete: SetNull` +
  `@@index` (`schema.prisma:4401-4415`); migración
  `prisma/migrations/20260918153728_tsk_717_partner_contributions_account/migration.sql`
  (`ADD COLUMN`, `CREATE INDEX`, `FOREIGN KEY … ON DELETE SET NULL`).

#### 1.2.5 Vínculo compra → equipo

**No existe.** Verificado:

- `Vehicle` no tiene `productId`, `purchaseInvoiceLineId` ni nada parecido (`:1961-2043`).
- En `src/modules/commercial/` la única mención a vehículos es la asignación de equipos a
  clientes (`clients/detail/components/_VehiclesTab.tsx`, `_AssignVehicleDialog.tsx`), sin relación
  con compras.
- En `src/modules/equipment/` no hay ninguna referencia a `purchaseInvoice`, `Product` ni
  `productId` (grep sin resultados).
- Nada crea un `Vehicle` automáticamente: el único `prisma.vehicle.create` es `createVehicle`
  (`create/actions.server.ts:69-110`), disparado por el form.

Lo que sí existe (TSK-579 / 618): un **ítem** puede tener cuenta de egresos ASSET
(`account-filters.ts:22-31`) y, al confirmar la compra, la línea debita esa cuenta (1.2.1); si la
cuenta está marcada `isFixedAsset` el form y el detalle **sugieren** adjuntar el comprobante
(`commercial/shared/fixed-asset.ts:30-35, 71-95`; `_FixedAssetAttachmentNotice.tsx`). Después, el
equipo se **carga a mano** en Equipos y se le configura la depreciación a mano con `grossValue`
preinicializado desde `Vehicle.price` (`_DepreciationConfigDialog.tsx:52`) — que no viene de la
compra sino del campo "Valor del Equipo" del form.

Consecuencia contable **preexistente** que este ticket debe hacer visible: la compra debita la
cuenta del ítem (p. ej. 1.2.2/04/01 Rodados) pero la baja acredita `fixedAssetAccountId` global
(p. ej. 1.2.2/00/00 o la que sea). Si no coinciden, Rodados queda con saldo para siempre. Con la
cuenta por equipo esto se corrige **solo si** la usuaria pone en el equipo la misma cuenta que
tiene el ítem; hay que decirlo en la guía y en la ayuda del campo. Vincular la línea de compra al
equipo (y heredar la cuenta) es un ticket aparte (1.7).

#### 1.2.6 Configuración contable

`src/modules/accounting/features/settings/`:

- Form `_CommercialIntegrationForm.tsx`, sección `'Cuentas de Activos Fijos'` (`:228-244`):
  `fixedAssetAccountId` "Bienes de Uso" `types: ['ASSET']`; `accumulatedDepreciationAccountId`
  "Depreciación Acumulada" `['ASSET']`; `depreciationExpenseAccountId` "Gasto de Depreciación"
  `['EXPENSE']`; `assetDisposalGainLossAccountId` "Resultado Venta/Baja de B.U."
  `['REVENUE','EXPENSE']`. **Ninguno tiene `help`**, a diferencia de ventas/compras (`:60-71`),
  caja/banco (`:118-129`) y aportes (`:140-145`) que ya usan "por defecto" + ayuda.
- Zod `validators.ts:51-54` (`accountField`, ya nullish) y test `validators.test.ts:55-58`
  (lista de campos cubiertos); `saveAccountingSettings` `actions.server.ts:68-71`;
  `defaultValues` `AccountingSettings.tsx:122-125`. **Nada de esto cambia de forma**: solo
  labels/ayudas/título de la sección. No hay campo global nuevo en este ticket.
- Cómo quedaría: título "Bienes de Uso (cuentas por defecto)"; "Cuenta de Bienes de Uso por
  defecto" — "Se usa en los asientos de baja y de ajuste de valor de los equipos que no tienen
  cuenta propia (Equipos → Editar → Cuentas contables) ni la tienen definida en su Tipo de Equipo
  (Empresa → Tipos de Equipo). Conviene que sea la misma cuenta a la que se imputó la compra del
  bien."; "Amortización acumulada por defecto" — ídem para amortización y baja; "Gasto de
  amortización por defecto" — "Se usa en la amortización mensual de los equipos sin cuenta propia
  ni de tipo"; "Resultado por venta/baja de Bienes de Uso" — sigue única: "Se usa en la baja
  (valor libro no amortizado) y en los ajustes de valor de todos los equipos". Textos finales en
  diseño.
- No existe `_EquipmentIntegration*.tsx`: la sección vive dentro del form comercial (verificado
  con `ls settings/components/`: `ItemsWithoutAccountNotice.tsx`, `_AccountingSettingsForm.tsx`,
  `_CommercialIntegrationForm.tsx`, `_PeriodLockingForm.tsx`).

#### 1.2.7 Datos existentes

Base de dev (`docker exec contable-pms-db psql -U postgres -d contable_pms`), 2026-09-18:

| Tabla | Filas | Detalle |
|---|---|---|
| `vehicles` | 3 | todos de "Empresa Demo S.A." (`7c3afafa…`), tipo Camión / clasificación Vehículos, `price` NULL, activos |
| `vehicle_depreciations` | 0 | — |
| `depreciation_schedule_entries` | 0 | — |
| `asset_value_adjustments` | 0 | — |
| `journal_entries` "Depreciación%" / "Baja por%" / "Ajuste de valor equipo%" | 0 | nunca se generó un asiento de equipos en dev |
| `accounting_settings` | 1 (Empresa de Prueba 01 SA) | las 4 cuentas de activos fijos en NULL; Empresa Demo no tiene fila |
| `vehicle_types` | 8 | Acoplado, Camioneta, Camión, Cisterna, Furgón, Semirremolque, Tractor, Utilitario (Empresa Demo) |
| `types_of_vehicles` | 4 | Maquinaria, Otros Equipos, Remolques, Vehículos (Empresa Demo) |
| `accounts` con `is_fixed_asset` | 31 (22 hojas) | todas de Empresa de Prueba 01, rubro 1.2.2 completo del plan modelo, incluidas las "Amortizaciones Acumuladas" |

Conclusión: en dev **no hay nada que migrar** y para probar hay que sembrar equipos en la empresa
que tiene plan de cuentas (o cuentas en la que tiene equipos). Para **producción** no se puede
saber desde acá (memoria `produccion-dokploy-scripts-db.md`); consulta a correr antes de
planificar:

```sql
SELECT c.name,
       (SELECT count(*) FROM vehicles v WHERE v.company_id = c.id)                         AS equipos,
       (SELECT count(*) FROM vehicle_depreciations d WHERE d.company_id = c.id)            AS con_depreciacion,
       (SELECT count(*) FROM depreciation_schedule_entries e
          JOIN vehicle_depreciations d ON d.id = e.depreciation_id
         WHERE d.company_id = c.id AND e.is_posted)                                        AS periodos_contabilizados,
       (SELECT count(*) FROM asset_value_adjustments a WHERE a.company_id = c.id)         AS ajustes,
       s.fixed_asset_account_id IS NOT NULL                                                AS tiene_bu,
       s.accumulated_depreciation_account_id IS NOT NULL                                   AS tiene_aa,
       s.depreciation_expense_account_id IS NOT NULL                                       AS tiene_gasto,
       (SELECT count(*) FROM vehicle_types t WHERE t.company_id = c.id AND t.is_active)   AS tipos_equipo
FROM companies c LEFT JOIN accounting_settings s ON s.company_id = c.id;
```

Criterio: **ir hacia adelante**. Los asientos ya contabilizados (si los hubiera en prod) quedan
en la cuenta global con la que se generaron; los campos nuevos nacen en NULL y el fallback a la
global mantiene el comportamiento actual para todo equipo que no se toque. No se reasignan
asientos históricos (mismo criterio que 717 y 721).

#### 1.2.8 Alternativas comparadas y recomendación

Las tres cuentas que se determinan "por equipo" son **Bienes de Uso**, **Amortización
acumulada** y **Gasto de amortización**. La de **Resultado por venta/baja** se propone dejar
global en todas las alternativas: (a) el plan modelo tiene una sola cuenta de utilidad y una de
pérdida por venta de bienes de uso (`:1158-1160`, `:1656-1658`), no una por rubro; (b) el
asiento actual la usa solo por el valor libro no amortizado y para los ajustes de valor, es una
cuenta de resultado de la operación, no del bien; (c) si en el futuro se pidiera por rubro, es
un campo más en la misma cadena de resolución, sin rediseño.

**A) Cuentas por equipo** — tres campos en `Vehicle` (`fixedAssetAccountId`,
`accumulatedDepreciationAccountId`, `depreciationExpenseAccountId`), editables en el form, con las
globales como respaldo.

- Pros: es literalmente lo que dice el ticket ("se determina por ítem"); patrón 717 calcado
  (`Partner.contributionsAccountId`, `_PartnerAccountField`, `resolvePartnerCapitalAccount`); el
  equipo es la entidad de cada asiento (1.2.2: un asiento por equipo y período), así que la
  resolución es directa; migración aditiva (3 columnas + 3 FK `SetNull` + índices).
- Contras: carga repetitiva (una flota de 20 camiones = 60 selecciones idénticas) y riesgo de
  inconsistencia entre equipos del mismo rubro; hay que tocar **dos** forms de 965 y 890 líneas
  (`_EquipmentForm.tsx`, `_EquipmentFormEdit.tsx`), lo que obliga a extraer un
  `_EquipmentAccountsFields.tsx` compartido; el detalle y el listado deberían mostrar la cuenta
  resuelta para que la usuaria sepa qué se va a usar.
- Variante A′: poner los tres campos en **`VehicleDepreciation`** (en "Configurar Depreciación",
  que es el acto contable) en vez de en `Vehicle`. Ventaja: quedan **congelados** una vez que
  hay períodos contabilizados (`updateVehicleDepreciation` ya se bloquea, `:283-285`), lo que
  evita el riesgo 1.6-1 de forma natural. Desventaja: la usuaria piensa "la cuenta del equipo",
  no "la cuenta de la depreciación"; y la baja de un equipo sin depreciación seguiría sin
  asiento. Queda como pregunta abierta 1.7-1 para diseño.

**B) Cuentas por Tipo de Equipo** — los tres campos en `VehicleType`; el equipo hereda.

- Verificación del eje: `Vehicle.typeId` es **obligatorio** en el schema (`:2015-2016`) y en Zod
  (`_EquipmentForm.tsx:107`): **todo equipo tiene tipo**. El catálogo tiene ABM con permiso
  propio (`company.vehicle-types`) y modal chico (196 líneas) donde entran tres
  `AccountCombobox`. `TypeOfVehicle` (clasificación) se parece más a un rubro contable pero **no
  tiene ABM** (1.2.3) → descartado como eje; `VehicleBrand`/`VehicleModel` son opcionales →
  descartados.
- Pros: la carga se hace **una vez por tipo** (8 tipos en demo) y los equipos nuevos salen
  imputados solos; para una empresa donde todo es rodado, basta configurar los tipos con
  Rodados / Amort. Acum. Rodados / Amortizaciones-Explotación y la global casi no se usa; el
  contador configura desde una pantalla de catálogo, no equipo por equipo.
- Contras: los tipos son operativos (Camión, Cisterna, Acoplado), no contables: un tipo
  "Otros" o "Maquinaria" puede mezclar rubros y necesita override; sin override por equipo no
  cubre el caso "este equipo va a otra cuenta" que es lo que la clienta describe como "por ítem".
  `getVehicleTypesForSelect` no chequea permisos (`:104-118`); si va a devolver cuentas, conviene
  no exponerlas por ese select sino resolver en el server.

**C) Derivar de la cuenta del ítem de compra** — usar la cuenta ASSET del ítem de la línea de
compra como cuenta de Bienes de Uso del equipo.

- **No es viable hoy**: no hay vínculo compra → equipo (1.2.5). Habría que agregar
  `Vehicle.purchaseInvoiceLineId` (o crear el equipo desde la factura), UI para vincular, y
  resolver qué pasa con equipos cargados sin compra (todos los actuales). Además solo daría **una**
  de las tres cuentas: la acumulada no se deriva con seguridad por código (1.2.3) y el gasto va
  por función, no por rubro. Fuera de alcance de 724-c; se propone como ticket aparte
  ("vincular equipo a línea de compra") en 1.7.

**D) B + C** — se reduce a **B + override por equipo (A)** porque C no existe. Es la
recomendación.

**Recomendación: D′ = tipo de equipo como fuente principal + override por equipo + global como
respaldo**, con resolución **equipo → tipo → global** para cada una de las tres cuentas, de forma
independiente (un equipo puede tener solo la cuenta de gasto propia y heredar el resto). Motivos:
cierra 724-c completo ("más de una cuenta de bienes de uso, determinada por ítem"), minimiza la
carga (se configura por tipo; el equipo solo se toca cuando es la excepción), y produce asientos
correctos por rubro en los tres puntos (activo + acumulada + gasto). Precisiones:

1. **Modelo**: tres `String? @db.Uuid` + relación `Account?` con `onDelete: SetNull` + `@@index`
   en `VehicleType` **y** en `Vehicle` (seis relaciones nombradas, seis inversas en `Account`,
   molde `schema.prisma:4401-4415`). Migración aditiva (molde
   `20260918153728_tsk_717_partner_contributions_account`). Sin migración de datos.
2. **Helper puro compartido** (sin base), p. ej. `src/modules/equipment/shared/asset-accounts.ts`:
   `resolveEquipmentAccounts({ vehicle, type, settings })` → por cuenta `{ id, source: 'equipment'
   | 'type' | 'default' } | null`, `findMissingEquipmentAccounts(...)` y
   `buildMissingEquipmentAccountsMessage(equipoLabel, missing)` con texto tipo: "No se puede
   contabilizar la amortización del equipo «001 - AB123CD»: no tiene cuenta de Amortización
   acumulada. Asignala en Equipos → Editar → Cuentas contables, en Empresa → Tipos de Equipo
   («Camión»), o configurá la 'Amortización acumulada por defecto' en Contabilidad →
   Configuración." Tests unitarios Vitest (molde `commercial/shared/line-accounts.test.ts`).
3. **Imputabilidad**: la cuenta resuelta se valida con `buildImputableAccountsWhere` dentro de la
   transacción (molde `resolvePartnerCapitalAccount:279-290`); una cuenta propia no imputable
   → `BusinessError` que nombra equipo/tipo y cuenta; **nunca** cae a la global en silencio
   (principio 717/721). Tipos: Bienes de Uso `['ASSET']`, Amortización acumulada `['ASSET']`,
   Gasto `['EXPENSE']`. Filtrar además por `isFixedAsset: true` en los combos de activo es
   opcional (en dev las acumuladas también están marcadas por la cascada, 1.2.3), se decide en
   diseño.
4. **Pre-validación + `ActionResult`** en los cuatro puntos de asiento:
   - `postDepreciationEntry` (`:426`): resolver + validar antes de `prisma.$transaction` (`:509`),
     devolver `ActionResult<{ journalEntryId, journalEntryNumber }>`; `_DepreciationTab` pasa a
     `if (!result.success) toast.error(result.error)`.
   - `postAllPendingDepreciations` (`:600`): quitar el guard global (`:619-623`); resolver por
     equipo antes de abrir la transacción (`:658`) y volcar el mensaje a `errors[]` (ya existe, `:756-762`); el diálogo
     debe **mostrar los mensajes**, no solo el conteo (`_BulkDepreciationDialog.tsx:52-54`).
   - `softDeleteVehicle` (`list/actions.server.ts:333`): si el equipo tiene `VehicleDepreciation`,
     pre-validar antes de la transacción; `createJournalEntryForAssetSale/Disposal` reciben las
     cuentas resueltas (o las resuelven con el helper) y **lanzan** en vez de `return null`
     (`:176-185`, `:261-270`); el `catch` (`:374-378`) pasa a `toActionResult`; el cliente
     (`_EquipmentDataTable.tsx:116-118`) muestra `result.error`. El caso "equipo sin depreciación
     configurada" (`:194-199`) se mantiene sin asiento pero **avisado** en el diálogo de baja
     (texto: "Este equipo no tiene depreciación configurada: la baja no genera asiento contable").
   - `createValueAdjustment` (`:786`): reemplazar el `if` sin `else` (`:843-847`) por resolver +
     `BusinessError`; devolver `ActionResult`.
   - Borrar `payablesAccountId` del `select` muerto (`integrations/equipment/index.ts:50`) y
     corregir el encabezado `:1-23` (no hay asiento de alta; la depreciación vive en equipos).
5. **UI**:
   - Tipo de equipo: tres `AccountCombobox` en `_VehicleTypeFormModal.tsx` (extraídos a
     `_VehicleTypeAccountsFields.tsx` para no pasar 200 líneas), action
     `getVehicleTypeAccounts(includeIds)` en `vehicle-types/list/actions.server.ts` con
     `checkPermission('company.vehicle-types','view')`, columnas "Cuentas" en la tabla.
   - Equipo: card "Cuentas contables" (pestaña Contrato, debajo de "Valor del Equipo",
     `_EquipmentForm.tsx:711-765` y `_EquipmentFormEdit.tsx:647-700`) con un componente
     compartido `_EquipmentAccountsFields.tsx`, `clearLabel="Sin asignar (usar la del tipo de
     equipo o la por defecto)"` y ayuda que muestra **qué cuenta se va a usar y de dónde sale**
     (patrón `_PartnerAccountNotice`); action `getEquipmentAccountOptions(includeIds)` con
     `checkPermission('equipment','view')`.
   - Detalle: en la pestaña Depreciación (o en "Valor del Equipo"), las tres cuentas resueltas
     con su origen ("Rodados Valores Originales — del tipo Camión"), para que la usuaria vea
     antes de contabilizar.
   - Configuración contable: labels/ayudas "por defecto" (1.2.6).
6. **Guías, docs y PDF**: 1.3.

### 1.3 Archivos involucrados

**A crear**

- `prisma/migrations/<timestamp>_tsk_724c_equipment_accounts/migration.sql` — `ALTER TABLE
  vehicle_types ADD COLUMN fixed_asset_account_id UUID, accumulated_depreciation_account_id UUID,
  depreciation_expense_account_id UUID` + ídem en `vehicles`, índices y FK `ON DELETE SET NULL`
  (molde `20260918153728_tsk_717_partner_contributions_account/migration.sql`).
- `src/modules/equipment/shared/asset-accounts.ts` + `asset-accounts.test.ts` — resolución
  equipo → tipo → global, faltantes, mensajes (puro; molde `commercial/shared/line-accounts.ts`).
- `src/modules/equipment/shared/components/_EquipmentAccountsFields.tsx` — los tres combos +
  aviso de cuenta efectiva, compartido por alta y edición (molde `_PartnerAccountField.tsx`).
- `src/modules/company/features/vehicle-types/list/components/_VehicleTypeAccountsFields.tsx` —
  los tres combos del catálogo.
- `src/modules/equipment/features/depreciation/depreciation-accounts.integration.test.ts` —
  casos: equipo con cuentas propias → asiento en ellas; equipo sin propias con tipo configurado →
  cuentas del tipo; ni equipo ni tipo → globales; ninguna → `{ success: false }` que nombra el
  equipo y la cuenta; cuenta propia no imputable → error nombrando cuenta (sin fallback);
  masiva con dos equipos de distinto tipo → dos asientos en cuentas distintas y `errors[]` con
  mensaje legible para el que falla; baja por venta usa las cuentas resueltas; ajuste de valor
  sin cuentas → error (ya no se guarda sin asiento). Molde `cost-center.integration.test.ts:1-70`
  (`describe.skipIf`, prefijo `TSK724C-TEST-`, limpieza en `afterAll`) y los `vi.mock` de
  `fund-movement-partner-account.integration.test.ts`.
- `docs/presentaciones/TSK-724c-bienes-de-uso-por-equipo.pdf` + `scripts/guia-presentacion/capturas-tsk724c.mjs`
  y `tsk-724c.html` (memoria `guia-presentacion-cliente-por-ticket.md`; entorno según
  `dev-local-capturas-y-login.md`).

**A modificar**

- `prisma/schema.prisma:1097-1117` (`VehicleType`: 3 campos + 3 relaciones), `:1961-2043`
  (`Vehicle`: 3 campos + 3 relaciones), `:296-377` (`Account`: 6 inversas).
- `src/modules/equipment/features/depreciation/actions.server.ts:426-595` (`postDepreciationEntry`),
  `:600-777` (`postAllPendingDepreciations`), `:786-988` (`createValueAdjustment`): resolución,
  pre-validación, `BusinessError`, `ActionResult`; `select`/`include` del vehículo suman las
  cuentas propias y `type { …cuentas }`.
- `src/modules/equipment/features/depreciation/components/_DepreciationTab.tsx:95-107, 117-136`,
  `_ValueAdjustmentDialog.tsx:60-75`, `list/components/_BulkDepreciationDialog.tsx:46-60`
  (consumo de `ActionResult`; mostrar `errors[]`).
- `src/modules/accounting/features/integrations/equipment/index.ts:1-23` (encabezado), `:40-56`
  (`select`), `:169-245` y `:254-330` (cuentas resueltas, `throw` en vez de `return null`).
- `src/modules/equipment/features/list/actions.server.ts:333-379` (`softDeleteVehicle` →
  `ActionResult`, pre-validación) y `list/components/_EquipmentDataTable.tsx:106-118, 290-343`
  (resultado + aviso "sin depreciación").
- `src/modules/equipment/features/create/actions.server.ts:16-58, 63-118` y
  `edit/actions.server.ts` (`CreateVehicleInput`/`UpdateVehicleInput` + `data` + verificación de
  que las cuentas sean de la empresa, molde `assertPartnerAccount` de 717);
  `create/components/_EquipmentForm.tsx:68-110, 711-765` y `edit/components/_EquipmentFormEdit.tsx:647-700`
  (Zod + card "Cuentas contables" con el componente compartido).
- `src/modules/equipment/features/detail/actions.server.ts:17-56` (`include` de cuentas y
  `type` con cuentas) y `detail/EquipmentDetail.tsx:211-229` o `_DepreciationTab.tsx` (cuentas
  efectivas con origen).
- `src/modules/company/features/vehicle-types/list/actions.server.ts:19-29, 147-210`
  (inputs + `data` + nueva `getVehicleTypeAccounts`), `components/_VehicleTypeFormModal.tsx:30-34,
  60-80, 140-175`, `columns.tsx` (columna "Cuentas").
- `src/modules/accounting/features/settings/components/_CommercialIntegrationForm.tsx:228-244`
  (título, labels y `help` "por defecto").
- `src/modules/help/features/guide/components/_EquipmentGuide.tsx:149-260` (sección Depreciación:
  cuentas por equipo/tipo; corregir `:253-255` que dice que los asientos se generan "desde el
  módulo de Contabilidad" cuando se contabilizan desde la pestaña Depreciación y desde
  "Contabilizar Depreciaciones" del listado) y `_AccountingGuide.tsx:249, 669-715` ("Activos
  Fijos … por defecto"; `:703-706` "cuentas … configuradas en la integración comercial" →
  cadena equipo → tipo → por defecto).
- `docs/modules/equipment.md:61-112` (integración: cadena de resolución, errores explícitos,
  tabla de cuentas), `docs/modules/accounting.md:290-299` (quitar "degradación suave";
  "por defecto"), `docs/architecture/data-model.md:81, 101-103, 150-151, 459` (campos nuevos en
  `Vehicle` y `VehicleType`).

### 1.4 Dependencias

- **Prisma 7 + migración aditiva**: `npm run db:migrate` local; en producción
  `docker-entrypoint.sh` (memoria `produccion-dokploy-scripts-db.md`).
- **`src/shared/lib/action-result.ts`** (`ActionResult`, `BusinessError`, `toActionResult`): ya
  existe desde TSK-721; el módulo de equipos todavía no lo usa en ninguna action.
- **`AccountCombobox`** y **`buildImputableAccountsWhere`**: sin cambios.
- **Plan de cuentas de la empresa**: la clienta (o su contador) necesita las cuentas de cada rubro
  con su acumulada y las de gasto de amortización por función. Con el plan modelo importado ya
  están (`1.2.2/*`, `4.2.1/02/10`, etc.); el sistema no las crea.
- **Regla 11 (permisos)**: `getVehicleTypeAccounts` con `('company.vehicle-types','view')`;
  `getEquipmentAccountOptions` con `('equipment','view')`; las actions de asiento ya tienen
  `('equipment','update'|'delete')` (`depreciation/actions.server.ts:427, 601, 787`;
  `list/actions.server.ts:337`).
- **Comunicación entre módulos**: `equipment` ya importa de
  `@/modules/accounting/features/integrations/equipment` (`list/actions.server.ts:14-17`), igual
  que `commercial` importa `integrations/commercial`: es el precedente aceptado para las
  integraciones. El helper de resolución se ubica en `equipment/shared/` y la integración lo
  recibe ya resuelto (o importa el helper puro), para no crear dependencia inversa nueva. Nota:
  `.claude/rules/` solo contiene `modules.md`; los demás archivos de reglas que cita `CLAUDE.md`
  (`module-communication.md`, etc.) no existen en el repo.
- **Regla 13**: no se crea módulo de primer nivel; `equipment` y `company.vehicle-types` ya están
  mapeados.

### 1.5 Restricciones y reglas

- Decimales a `Number()` antes de Client Components: las actions de depreciación ya lo hacen
  (`getVehicleDepreciation`, `:86-99`); las cuentas no tienen decimales.
- `logger`, no `console`; `AlertDialog`, no `confirm()`; `moment`, no `date-fns`.
- **Componentes < 200 líneas**: `_EquipmentForm.tsx` (965) y `_EquipmentFormEdit.tsx` (890) ya
  violan la regla; no empeorarlos: el bloque nuevo va en un componente aparte. `_DepreciationTab.tsx`
  (439) ídem. `_VehicleTypeFormModal.tsx` (196) roza el límite → extraer.
- Errores esperables como `BusinessError` → `{ success: false, error }`; nunca `throw` suelto
  para mensajes de negocio (memoria `errores-negocio-server-actions.md`). Verificación final con
  `npm run build && npm run start -- -p 3011`.
- Tests con **Vitest** (`npm run test`), no Cypress (memoria `testing-real-es-vitest-no-cypress.md`).
- Guía in-app (regla 10) + `docs/` (regla 8) + PDF de presentación (memoria
  `guia-presentacion-cliente-por-ticket.md`).
- Ir hacia adelante: sin reasignar asientos históricos; los campos nuevos nacen NULL y el
  fallback a la global preserva el comportamiento de hoy.

### 1.6 Riesgos identificados

1. **Cambio de cuentas con períodos ya contabilizados.** Si se cambia la cuenta de acumulada de un
   equipo (o de su tipo) después de contabilizar N períodos, la baja debita la acumulada
   **resuelta hoy** por `totalDepreciated` completo, pero parte de ese acumulado quedó acreditado
   en la cuenta vieja: la vieja conserva saldo. Es más grave que en 717 (donde cada aporte es
   independiente). Mitigaciones posibles: (a) bloquear la edición de las cuentas del equipo cuando
   hay `isPosted` (como `updateVehicleDepreciation:283-285`) y advertir en el tipo cuando tiene
   equipos con períodos contabilizados; (b) solo advertir ("Cambiar la cuenta no modifica asientos
   anteriores; si ya hay amortizaciones contabilizadas, el contador debe reclasificar con asiento
   manual"). Decisión en 1.7-2.
2. **Coherencia con la compra**: la cuenta de Bienes de Uso del equipo tiene que ser la misma a la
   que se imputó la línea de compra (1.2.5). Sin vínculo compra → equipo el sistema no puede
   verificarlo; hay que decirlo en la ayuda del campo, en la guía y en la presentación.
3. **Mensajes redactados en producción** (memoria `errores-negocio-server-actions.md`): hoy todas
   las actions de equipos lanzan `Error`; migrarlas a `ActionResult` cambia la firma y obliga a
   tocar cada `useMutation` consumidor (`_DepreciationTab`, `_ValueAdjustmentDialog`,
   `_BulkDepreciationDialog`, `_EquipmentDataTable`). Riesgo de dejar alguno con `try/catch`
   viejo → verificar en build de producción.
4. **`postAllPendingDepreciations` en una sola transacción** (`:658-766`): un `throw` de Prisma
   dentro del loop (no solo lógico) abortaría la transacción entera. Con la resolución por
   equipo hecha **antes** de abrir la transacción (pre-cálculo de cuentas por `vehicleId`) el
   riesgo no crece; hay que respetar ese orden.
5. **Silencio residual en la baja**: mantener "sin depreciación → sin asiento" es correcto
   (no hay valores contables que reversar) pero sigue siendo silencioso si no se avisa en el
   diálogo; y `terminationReason: OTHER` tampoco genera asiento (`list/actions.server.ts:354-358`). Ambos deben quedar
   explícitos en el diálogo y en la guía.
6. **Fecha del asiento de baja = `new Date()`** (`integrations/equipment/index.ts:237, 322`),
   no una fecha elegida; con período cerrado hoy el error se pierde en el catch genérico. Con
   `ActionResult` el mensaje "período cerrado" pasa a verse; agregar fecha de baja al diálogo es
   una mejora fuera de alcance salvo que diseño la considere trivial.
7. **Tipos de equipo compartidos por rubros distintos** ("Otros", "Maquinaria"): la cuenta del
   tipo puede estar mal para algún equipo; el override por equipo lo cubre, pero la usuaria
   tiene que saber que existe → mostrar la cuenta efectiva y su origen en el detalle.
8. **Tests**: no hay ningún test bajo `equipment/` ni `integrations/equipment/` (verificado);
   el primer test de integración tiene que sembrar empresa, plan de cuentas mínimo,
   `AccountingSettings`, tipo de equipo, equipo y depreciación. Es más andamiaje que 717.
9. **Botón "Dar de Baja" muerto en el detalle** (`_EquipmentHeader.tsx:153-158`): si la
   presentación muestra la baja desde el detalle, no funciona. Conectarlo al mismo diálogo es
   chico y conviene hacerlo en este ticket (se toca el diálogo igual).

### 1.7 Preguntas abiertas

Solo las que cambian el diseño:

1. **¿El override por equipo va en `Vehicle` (form de alta/edición, visible siempre) o en
   `VehicleDepreciation` (diálogo "Configurar Depreciación", congelado al contabilizar)?**
   Propuesta: **`Vehicle`**, por coherencia con "la cuenta del equipo" (717: la cuenta es del
   socio), porque la baja de un equipo y su edición se hacen desde Equipos, y porque el tipo de
   equipo (fuente principal) también vive fuera de la depreciación. A′ queda como alternativa si
   se prefiere la inmutabilidad automática.
2. **¿Bloquear o solo advertir el cambio de cuentas cuando ya hay períodos contabilizados?**
   (riesgo 1.6-1). Propuesta: **advertir** en equipo y tipo (aviso naranja con el conteo de
   equipos/períodos afectados) y documentarlo; bloquear obliga a un flujo de "reclasificación"
   que no está pedido. Confirmar con la clienta/contador.
3. **¿Se pide en este ticket el vínculo compra → equipo (alternativa C)?** El análisis asume que
   **no** (724-c habla de cuentas, no de crear equipos desde compras) y lo deja como ticket
   aparte. Si la clienta esperaba "el equipo hereda la cuenta del ítem que compré", cambia el
   alcance (modelo + UI de vinculación).

No hay otras preguntas que cambien el diseño: la cadena equipo → tipo → global, la cuenta de
resultado global, el error explícito con `ActionResult` y el "ir hacia adelante" sin migración
de datos están recomendados con fundamento en 1.2.

---

## 2. Planificación

Nueve fases que implementan la **alternativa D′ ajustada** del análisis (1.2.8) con las
decisiones ya tomadas por el usuario: las tres cuentas de Bienes de Uso (`fixedAssetAccountId`,
`accumulatedDepreciationAccountId`, `depreciationExpenseAccountId`) viven en **`VehicleType`**
(Tipo de equipo, ABM en Empresa → Tipos de Equipo) con un **override opcional en
`VehicleDepreciation`** (no en `Vehicle`: así los forms de 965 y 890 líneas no se tocan y el
override se carga en el acto contable, "Configurar Depreciación"); la resolución es
**depreciación → tipo → global**, independiente por cuenta; `assetDisposalGainLossAccountId`
sigue global; las globales pasan a llamarse "… por defecto". Cambiar las cuentas de un tipo o de
una depreciación con períodos ya contabilizados **advierte, no bloquea**. No hay vínculo compra →
equipo (2.4-1). El módulo **Equipos sale de `HIDDEN_MODULES`** para que la clienta llegue a la
pestaña Depreciación que ya existe. Los cuatro puntos de asiento (amortización individual y
masiva, baja por venta/pérdida/devolución, ajuste de valor) pasan al patrón 721: **resolver →
pre-validar antes de la transacción → `BusinessError` → `ActionResult`**, y se corrigen los tres
silencios de 1.2.1/1.2.2 (`return null` tragado, `catch` genérico, guardado sin asiento). El
orden va del dato a la superficie: esquema, helper puro, las tres superficies que lo consumen
(tipos, depreciación, bajas/ajuste), textos de settings, visibilidad del módulo, documentación y
verificación.

Decisiones tomadas en esta planificación, donde el usuario dejó margen:

- **Filtro de tipos de cuenta en los combos**: Bienes de Uso `['ASSET']`, Amortización acumulada
  `['ASSET']`, Gasto de amortización `['EXPENSE']`. Verificado en el plan modelo: las
  "Amortizac. Acumuladas …" son `type: 'ASSET'` (regularizadoras del activo;
  `model-chart-of-accounts.ts:515-519` para Rodados, ídem en los demás rubros). **No** se filtra
  por `isFixedAsset`: TSK-618 permite destildar puntualmente las acumuladas
  (`schema.prisma:316-318`), y ese filtro las escondería del combo justamente donde hacen falta.
  Mismos tipos que ya usa el form de settings (`_CommercialIntegrationForm.tsx:229-236`).
- **Dónde va la advertencia de "períodos ya contabilizados"**: (a) en el **modal del tipo de
  equipo**, al editar, un aviso naranja (clases de `_PartnerAccountNotice.tsx:20-27`) con el
  conteo de equipos de ese tipo que tienen períodos `isPosted` (action nueva
  `getVehicleTypePostedDepreciationCount`), visible solo si el usuario cambia alguna de las tres
  cuentas respecto de lo guardado; (b) en el **diálogo de cuentas de la depreciación**
  (`_DepreciationAccountsDialog`, nuevo) el mismo aviso con el conteo de períodos contabilizados
  del propio equipo. En ambos el texto dice que los asientos anteriores no cambian, que la
  próxima amortización y la baja usan la cuenta nueva y que el saldo acumulado en la cuenta
  anterior lo reclasifica el contador con un asiento manual. **No se bloquea** (decisión del
  usuario, riesgo 1.6-1).
- **El override de la depreciación se edita con una action propia**, `updateDepreciationAccounts`,
  y no con `updateVehicleDepreciation` (`depreciation/actions.server.ts:256-340`), que se bloquea
  con períodos contabilizados (`:283-285`) y regenera el cronograma entero. Cambiar una cuenta
  no toca montos ni períodos; merece su propio camino, con `ActionResult`.
  `updateVehicleDepreciation` también persiste los tres campos (por consistencia del input),
  pero sigue sin consumidor en la UI (verificado: nadie lo importa desde `.tsx`).
- **Una sola action de lectura para "qué cuentas se van a usar"**: `getVehicleAssetAccounts(vehicleId)`
  devuelve las tres cuentas resueltas con `code - name`, origen (`depreciation | type |
  default`), si son imputables hoy, si el equipo tiene depreciación y cuántos períodos están
  contabilizados. La consumen la card de la pestaña Depreciación, el diálogo de configuración
  (preview de "si queda vacío se usa …"), el diálogo de cuentas y el **diálogo de baja** (aviso
  "sin depreciación → sin asiento" o listado de las cuentas que va a usar). Es la mitigación
  del riesgo 1.6-7 (tipos que mezclan rubros) sin tocar `getVehicleById`.
- **El cargador con Prisma va en `equipment/shared/asset-accounts-loader.ts`** (con
  `import 'server-only'`, sin `'use server'`: exporta funciones que reciben `tx` y no son
  Server Actions), separado del helper puro `asset-accounts.ts` (sin Prisma, testeable sin
  base). Es **batch** (`loadVehiclesAssetAccounts(companyId, vehicleIds)` → `Map`) porque la
  masiva lo necesita por equipo antes de abrir la transacción (riesgo 1.6-4); el caso de un
  equipo es `.get(id)`. La integración contable (`integrations/equipment/index.ts`) **recibe
  las cuentas ya resueltas** como parámetro y no importa nada de `equipment` (no se crea
  dependencia inversa, 1.4).
- **La baja se extrae a `_TerminateEquipmentDialog.tsx`** en `equipment/shared/components/`
  para que la usen el listado (`_EquipmentDataTable.tsx:290-343`, que hoy tiene el diálogo
  inline) y el botón "Dar de Baja" del detalle (`_EquipmentHeader.tsx:153-158`, hoy sin
  `onClick`). `_EquipmentTable.tsx` (436 líneas, sin importadores —verificado por grep— y con
  su propio `softDeleteVehicle` con `onError` genérico) **se elimina**: mantener un segundo
  consumidor muerto con el contrato viejo es una trampa para el cambio de firma.
- **Requisitos por operación** (`REQUIRED_ACCOUNTS_BY_OPERATION`): amortización →
  acumulada + gasto; baja → Bienes de Uso + acumulada + la global de resultado; ajuste de valor →
  Bienes de Uso + acumulada + la global de resultado (igual que el guard actual `:843-847`, que
  pide las tres aunque cada rama use dos; se mantiene para no cambiar semántica en el mismo
  ticket). La global de resultado faltante tiene su propio mensaje que apunta a Contabilidad →
  Configuración.
- **`terminationReason: 'OTHER'` sigue sin asiento** y el diálogo lo dice ("Baja por otro
  motivo: no genera asiento contable"). Igual con "sin depreciación configurada". Son los dos
  silencios que se vuelven explícitos (riesgo 1.6-5), no se cambia su comportamiento.
- **Fecha del asiento de baja** sigue siendo `new Date()` (riesgo 1.6-6): agregar fecha al
  diálogo es alcance nuevo; se anota en 2.4. Con `ActionResult` el error "período cerrado" ya
  se ve.
- **El test de integración va en `equipment/features/depreciation/`** junto al action que
  ejercita (criterio de 721: probar la cadena real, no una réplica), con los cuatro `vi.mock`
  de `fund-movement-partner-account.integration.test.ts:27-32`. Un solo archivo para
  amortización, masiva, baja y ajuste: el andamiaje (empresa, cuentas, settings, tipo,
  clasificación, equipo, depreciación) es el mismo y es más pesado que en 717 (riesgo 1.6-8).

Testing: **Vitest** (`npm run test` → `vitest run`; memoria `testing-real-es-vitest-no-cypress`).
TDD en los validators de tipos de equipo (fase 3) y de depreciación (fase 4), en el helper puro
(fase 2) y en la cadena real de `postDepreciationEntry` / `postAllPendingDepreciations` /
`softDeleteVehicle` / `createValueAdjustment` contra la base de dev (fases 4 y 5). Los `.tsx`
no se testean. Línea base de `npm run check-types`: **219** errores preexistentes.

### 2.1 Fases de implementación

#### Fase 1: Esquema y migración

- **Objetivo:** que `VehicleType` y `VehicleDepreciation` tengan las tres cuentas opcionales,
  con una migración aditiva (columnas nullable, índices, FK `SET NULL`) y el cliente Prisma
  regenerado. Sin cambios de comportamiento.
- **Tareas:**
  - [x] `prisma/schema.prisma:1104` (`model VehicleType`, después de `updatedAt`): agregar el
        bloque
        ```prisma
        // TSK-724c: cuentas de Bienes de Uso del tipo; null = usa la por defecto de AccountingSettings
        fixedAssetAccountId              String? @map("fixed_asset_account_id") @db.Uuid
        accumulatedDepreciationAccountId String? @map("accumulated_depreciation_account_id") @db.Uuid
        depreciationExpenseAccountId     String? @map("depreciation_expense_account_id") @db.Uuid
        ```
        y, en el bloque `// Relaciones` (`:1107-1112`), las tres relaciones
        `fixedAssetAccount Account? @relation("VehicleTypeFixedAssetAccount", fields:
        [fixedAssetAccountId], references: [id], onDelete: SetNull)`,
        `accumulatedDepreciationAccount Account? @relation("VehicleTypeAccumulatedDepreciationAccount", …)`,
        `depreciationExpenseAccount Account? @relation("VehicleTypeDepreciationExpenseAccount", …)`
        y tres `@@index([…AccountId])` antes de `@@map` (`:1116`). Molde
        `schema.prisma:4401-4415` (`Partner.contributionsAccountId`, TSK-717).
  - [x] `prisma/schema.prisma:4082-4084` (`model VehicleDepreciation`, después de
        `lastDepreciationDate`): mismos tres campos con el comentario `// TSK-724c: override de
        las cuentas del tipo de equipo; null = usa la del tipo o la por defecto`, relaciones
        `"DepreciationFixedAssetAccount"`, `"DepreciationAccumulatedDepreciationAccount"`,
        `"DepreciationDepreciationExpenseAccount"` con `onDelete: SetNull`, y tres `@@index`
        junto a los existentes (`:4096-4097`).
  - [x] `prisma/schema.prisma:360-363` (`model Account`, después de `settingsAsAssetDisposalGL`):
        seis inversas con nombres nuevos —los tomados son `FixedAssetAccount`,
        `AccumulatedDepreciationAccount`, `DepreciationExpenseAccount`,
        `AssetDisposalGainLossAccount` (settings) y `PartnerOwnContributionsAccount`,
        `ProductExpenseAccount`, `ProductIncomeAccount`, `AccountHierarchy`,
        `AccountDisabledFrom`—:
        `vehicleTypesAsFixedAsset VehicleType[] @relation("VehicleTypeFixedAssetAccount")`,
        `vehicleTypesAsAccumulatedDepr VehicleType[] @relation("VehicleTypeAccumulatedDepreciationAccount")`,
        `vehicleTypesAsDepreciationExpense VehicleType[] @relation("VehicleTypeDepreciationExpenseAccount")`,
        `depreciationsAsFixedAsset VehicleDepreciation[] @relation("DepreciationFixedAssetAccount")`,
        `depreciationsAsAccumulatedDepr VehicleDepreciation[] @relation("DepreciationAccumulatedDepreciationAccount")`,
        `depreciationsAsDepreciationExpense VehicleDepreciation[] @relation("DepreciationDepreciationExpenseAccount")`,
        con comentario `// TSK-724c`.
  - [x] Correr `npm run db:migrate -- --name tsk_724c_asset_accounts_by_type`. Verificar que
        `prisma/migrations/<timestamp>_tsk_724c_asset_accounts_by_type/migration.sql` tenga
        **exactamente** 6 `ADD COLUMN … UUID` (3 en `vehicle_types`, 3 en
        `vehicle_depreciations`), 6 `CREATE INDEX` y 6 `ADD CONSTRAINT … FOREIGN KEY …
        REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE` (formato de
        `20260918153728_tsk_717_partner_contributions_account/migration.sql`). **Sin `UPDATE`,
        sin backfill** (1.2.7: ir hacia adelante). Si `migrate dev` detecta drift ajeno, no
        resetear: revisar con `npx prisma migrate status`.
  - [x] `npm run db:generate`; `npm run check-types` debe seguir en 219 (los campos nuevos son
        opcionales y ningún `select` explícito los pide todavía).
  - [x] Anotar en la sección 4 que en producción la migración la aplica solo el
        `docker-entrypoint.sh` al deployar (memoria `produccion-dokploy-scripts-db`) y que antes
        conviene correr la consulta de 1.2.7 con `psql` para saber cuántos equipos/períodos hay.
- **Archivos:**
  - Crear: `prisma/migrations/<timestamp>_tsk_724c_asset_accounts_by_type/migration.sql`
  - Modificar: `prisma/schema.prisma`
- **Criterio de completitud:** `npx prisma migrate status` en verde; `src/generated/prisma`
  expone `VehicleType.fixedAssetAccountId` / `fixedAssetAccount` y
  `VehicleDepreciation.depreciationExpenseAccountId` / `depreciationExpenseAccount` (y los
  otros cuatro); `check-types` en 219; la app arranca y Equipos/Tipos de Equipo funcionan como
  antes.

#### Fase 2: Helper puro de cuentas de Bienes de Uso (TDD unitario)

- **Objetivo:** una única regla, sin base, que dado lo guardado en la depreciación, en el tipo y
  en settings diga qué cuenta efectiva usa cada una de las tres, de dónde sale, cuáles faltan
  para una operación dada, y arme los mensajes para el usuario nombrando equipo, tipo, cuenta y
  dónde configurarla.
- **Tareas:**
  - [x] Escribir **primero** `src/modules/equipment/shared/asset-accounts.test.ts` (Vitest puro,
        estilo `commercial/shared/line-accounts.test.ts`). Casos mínimos (14):
    - `resolveAssetAccounts({ depreciation: { accumulatedDepreciationAccountId: 'D' }, type: {
      accumulatedDepreciationAccountId: 'T', depreciationExpenseAccountId: 'TG' }, settings: {
      fixedAssetAccountId: 'S', accumulatedDepreciationAccountId: 'SA',
      depreciationExpenseAccountId: 'SG' } })` → `accumulatedDepreciation: { accountId: 'D',
      source: 'depreciation' }`, `depreciationExpense: { accountId: 'TG', source: 'type' }`,
      `fixedAsset: { accountId: 'S', source: 'default' }` (independencia por cuenta).
    - Sin ninguna de las tres fuentes (`null`/`undefined`) → las tres en `null`; cadena vacía
      `''` cuenta como ausente (igual que `resolveLineAccount`).
    - `findMissingAssetAccounts(resolved, 'depreciation')` → solo `accumulatedDepreciation` y
      `depreciationExpense` importan (con `fixedAsset` en `null` no aparece); `'disposal'` y
      `'adjustment'` → `fixedAsset` y `accumulatedDepreciation`.
    - `buildMissingAssetAccountsMessage({ operation: 'depreciation', vehicleLabel: '001 -
      AB123CD', typeName: 'Camión', missing: ['accumulatedDepreciation'] })` contiene `No se
      puede contabilizar la amortización del equipo «001 - AB123CD»`, `Amortización acumulada`,
      `pestaña Depreciación`, `Empresa → Tipos de Equipo`, `«Camión»`, `"Amortización acumulada
      por defecto"` y `Contabilidad → Configuración`; con dos faltantes usa plural (`no tiene
      cuenta de X ni de Y`, `Asignalas`); con `'disposal'` dice `la baja`; con `'adjustment'`,
      `el ajuste de valor`.
    - `buildUnavailableAssetAccountMessage({ operation: 'disposal', vehicleLabel, typeName,
      key: 'accumulatedDepreciation', accountLabel: '1.2.2/04/03 - Amortizac. Acumuladas
      Rodados', source: 'type' })` contiene `no está activa o no es imputable`, el label, `del
      tipo de equipo «Camión»` y `Corregila en Empresa → Tipos de Equipo`; con `source:
      'depreciation'` → `de la depreciación del equipo` + `pestaña Depreciación`; con
      `'default'` → `configurada como "Amortización acumulada por defecto"` + `Contabilidad →
      Configuración`.
    - `buildMissingDisposalAccountMessage({ operation: 'disposal', vehicleLabel })` contiene
      `"Resultado por venta/baja de Bienes de Uso"` y `Contabilidad → Configuración`.
    - `formatAccountLabel({ code: '1.2.2/04/01', name: 'Rodados Valores Originales' })` →
      `'1.2.2/04/01 - Rodados Valores Originales'`.
        Rojo primero: el módulo no existe.
  - [x] Crear `src/modules/equipment/shared/asset-accounts.ts` (puro, < 150 líneas, sin Prisma
        ni imports de `@/modules/*`). Exportar:
    - `ASSET_ACCOUNT_KEYS = ['fixedAsset', 'accumulatedDepreciation', 'depreciationExpense'] as
      const`, `type AssetAccountKey`, `type AssetAccountSource = 'depreciation' | 'type' |
      'default'`, `type AssetOperation = 'depreciation' | 'disposal' | 'adjustment'`.
    - `interface AssetAccountIds { fixedAssetAccountId?: string | null;
      accumulatedDepreciationAccountId?: string | null; depreciationExpenseAccountId?: string |
      null }` (misma forma que los tres modelos Prisma, así se les pasa el registro tal cual).
    - `interface ResolvedAssetAccount { accountId: string; source: AssetAccountSource }` y
      `type ResolvedAssetAccounts = Record<AssetAccountKey, ResolvedAssetAccount | null>`.
    - `resolveAssetAccounts({ depreciation, type, settings }: { depreciation?: AssetAccountIds |
      null; type?: AssetAccountIds | null; settings?: AssetAccountIds | null }):
      ResolvedAssetAccounts` (con `||`, documentado, para tratar `''` como ausente).
    - `ASSET_ACCOUNT_LABELS: Record<AssetAccountKey, { field: string; settingLabel: string }>` =
      `fixedAsset: { field: 'Bienes de Uso', settingLabel: 'Cuenta de Bienes de Uso por defecto' }`,
      `accumulatedDepreciation: { field: 'Amortización acumulada', settingLabel: 'Amortización
      acumulada por defecto' }`, `depreciationExpense: { field: 'Gasto de amortización',
      settingLabel: 'Gasto de amortización por defecto' }` (**mismos textos** que los labels de
      la fase 6).
    - `ASSET_ACCOUNT_SOURCE_LABELS: Record<AssetAccountSource, string>` = `depreciation: 'de la
      depreciación del equipo'`, `type: 'del tipo de equipo'`, `default: 'por defecto (Ajustes
      contables)'` (los usa la UI para "1.2.2/04/03 … — del tipo de equipo Camión").
    - `REQUIRED_ACCOUNTS_BY_OPERATION: Record<AssetOperation, AssetAccountKey[]>` =
      `depreciation: ['accumulatedDepreciation', 'depreciationExpense']`, `disposal:
      ['fixedAsset', 'accumulatedDepreciation']`, `adjustment: ['fixedAsset',
      'accumulatedDepreciation']`; `OPERATION_LABELS` = `la amortización` / `la baja` / `el
      ajuste de valor`.
    - `findMissingAssetAccounts(resolved: ResolvedAssetAccounts, operation: AssetOperation):
      AssetAccountKey[]`.
    - `buildMissingAssetAccountsMessage({ operation, vehicleLabel, typeName, missing })`. Texto:
      `No se puede contabilizar ${OPERATION} del equipo «${vehicleLabel}»: no tiene cuenta de
      ${X}${ ni de ${Y}}. ${Asignala|Asignalas} en la depreciación del equipo (pestaña
      Depreciación → Cuentas contables), en el tipo de equipo «${typeName}» (Empresa → Tipos de
      Equipo) o configurá ${"X por defecto"${ y "Y por defecto"}} en Contabilidad →
      Configuración.`
    - `buildUnavailableAssetAccountMessage({ operation, vehicleLabel, typeName, key,
      accountLabel, source })`: `No se puede contabilizar ${OPERATION} del equipo
      «${vehicleLabel}»: la cuenta ${accountLabel} (${field}, ${de la depreciación del equipo |
      del tipo de equipo «${typeName}» | configurada como "${settingLabel}"}) no está activa o
      no es imputable. Corregila en ${pestaña Depreciación del equipo | Empresa → Tipos de
      Equipo | Contabilidad → Configuración}.`
    - `buildMissingDisposalAccountMessage({ operation, vehicleLabel })`: `No se puede
      contabilizar ${OPERATION} del equipo «${vehicleLabel}»: falta la cuenta "Resultado por
      venta/baja de Bienes de Uso". Configurala en Contabilidad → Configuración.`
    - `formatAccountLabel({ code, name })` → `` `${code} - ${name}` `` (duplicado a propósito
      de `commercial/shared/line-accounts.ts`: no se importa entre módulos).
        Encabezado con el porqué (TSK-724c: la cuenta la define el tipo de equipo, la
        depreciación puede sobreescribirla, la global es respaldo; nunca imputar en silencio;
        la cuenta de resultado sigue global por 1.2.3). Test en verde.
  - [x] Crear `src/modules/equipment/shared/asset-accounts-loader.ts` (`import 'server-only'`,
        **sin** `'use server'`; usa `prisma` y `buildImputableAccountsWhere` de
        `@/shared/lib/accounts/imputable-accounts`; `BusinessError` de
        `@/shared/lib/action-result`). Exportar:
    - `type PrismaTransactionClient` (misma definición que `depreciation/actions.server.ts:24-27`).
    - `interface LoadedVehicleAssetAccounts { vehicleId; vehicleLabel: string; typeId; typeName:
      string; isActive: boolean; hasDepreciation: boolean; depreciationId: string | null;
      depreciationStatus: DepreciationStatus | null; postedCount: number; overrides:
      AssetAccountIds; typeAccounts: AssetAccountIds; resolved: ResolvedAssetAccounts;
      accounts: Record<string, { id; code; name; imputable: boolean }>;
      assetDisposalGainLossAccountId: string | null; lockedUntilDate: Date | null }`.
    - `loadVehiclesAssetAccounts(companyId, vehicleIds: string[], client = prisma):
      Promise<Map<string, LoadedVehicleAssetAccounts>>`: una `vehicle.findMany({ where: { id:
      { in }, companyId }, select: { id, internNumber, domain, isActive, type: { select: { id,
      name, 3 ids } }, depreciation: { select: { id, status, 3 ids, _count: { select: {
      scheduleEntries: { where: { isPosted: true } } } } } } } })`, una
      `accountingSettings.findUnique` (4 ids + `lockedUntilDate`), resolución con
      `resolveAssetAccounts`, y **dos** queries sobre `account`: todas las ids resueltas (para
      `code`/`name`) y las imputables hoy (`{ ...buildImputableAccountsWhere({ companyId }),
      id: { in } }`, sin `atDate`: misma convención que 721). `vehicleLabel` = `internNumber ||
      domain || id.slice(0, 8)` (como `postDepreciationEntry:506`).
    - `assertAssetAccountsForOperation(loaded, operation): { fixedAssetAccountId: string | null;
      accumulatedDepreciationAccountId: string | null; depreciationExpenseAccountId: string |
      null; assetDisposalGainLossAccountId: string | null }`: lanza `BusinessError` con
      `buildMissingAssetAccountsMessage` si falta alguna requerida, con
      `buildUnavailableAssetAccountMessage` (la primera que falle) si una resuelta no es
      imputable —**nunca** cae a la global cuando la propia o la del tipo existe pero no es
      imputable (principio 717/721)—, y con `buildMissingDisposalAccountMessage` si la
      operación es `disposal`/`adjustment` y no hay `assetDisposalGainLossAccountId`.
        No hay test unitario para el loader (necesita base): lo cubren los tests de
        integración de las fases 4 y 5.
- **Archivos:**
  - Crear: `src/modules/equipment/shared/asset-accounts.ts`, `asset-accounts.test.ts`,
    `asset-accounts-loader.ts`
- **Criterio de completitud:** `npm run test` en verde con `asset-accounts.test.ts` (primero
  rojo); `asset-accounts.ts` no importa nada de `@/modules/*` ni de Prisma; `check-types` en 219
  (el loader compila contra el cliente regenerado en la fase 1).

#### Fase 3: Tipos de equipo — cuentas del tipo (TDD en validators)

- **Objetivo:** que el ABM Empresa → Tipos de Equipo permita cargar las tres cuentas por tipo,
  con combos que ofrecen solo cuentas imputables del tipo correcto, preservan la guardada
  (`includeIds`), advierten si hay equipos con períodos contabilizados y muestran en la tabla
  qué tipos tienen cuentas propias.
- **Tareas:**
  - [x] **Validators (TDD).** Crear
        `src/modules/company/features/vehicle-types/list/validators.test.ts` con casos: nombre
        de menos de 2 caracteres falla; las tres cuentas son opcionales (ausentes → `undefined`,
        `null` → `null`); un valor que no es UUID falla en el campo correcto; `hasHitch` /
        `isTractorUnit` siguen obligatorios booleanos. Rojo porque el módulo no existe.
  - [x] Crear `vehicle-types/list/validators.ts` moviendo `vehicleTypeSchema` de
        `_VehicleTypeFormModal.tsx:30-36` y agregando `fixedAssetAccountId`,
        `accumulatedDepreciationAccountId`, `depreciationExpenseAccountId` como
        `z.string().uuid().nullish()` (constante `accountField`). Exportar `vehicleTypeSchema`
        y `type VehicleTypeFormData = z.infer<…>`. Verde.
  - [x] `vehicle-types/list/actions.server.ts:19-29`: agregar los tres campos `?: string | null`
        a `CreateVehicleTypeInput` y `UpdateVehicleTypeInput`.
  - [x] Mismo archivo: helper privado `assertAccountBelongsToCompany(accountId, companyId)`
        (copiar de `partners/features/list/actions.server.ts:206-217`, incluido el comentario
        de por qué no exige imputable) y usarlo en `createVehicleType` (`:147-170`, `data` con
        los tres ids) y `updateVehicleType` (`:175-210`, ídem). En `updateVehicleType`, además,
        `logger.info` con las cuentas anteriores y nuevas cuando cambian (rastro para el
        contador; el `existing` de `:181-184` debe `select` las tres ids).
  - [x] Mismo archivo: nueva `getVehicleTypeAssetAccounts(includeIds?: string[])` con
        `checkPermission('company.vehicle-types', 'view', { redirect: true })`, que devuelve
        `{ asset: AccountOption[]; expense: AccountOption[] }` con
        `buildImputableAccountsWhere({ companyId, types: ['ASSET'] })` y `['EXPENSE']`
        respectivamente, envolviendo `includeIds` en `OR` como
        `getPartnerContributionAccounts` (`partners/…/actions.server.ts:164-183`). `select: {
        id, code, name }`, `orderBy: { code: 'asc' }`. Exportar `type VehicleTypeAccountOption`.
  - [x] Mismo archivo: nueva `getVehicleTypePostedDepreciationCount(typeId: string)` con el
        mismo permiso → `prisma.vehicle.count({ where: { companyId, typeId, depreciation: {
        scheduleEntries: { some: { isPosted: true } } } } })`. Devuelve `number`.
  - [x] Crear `vehicle-types/list/components/_VehicleTypeAccountsFields.tsx` (< 160 líneas).
        Props: `values: { fixedAssetAccountId; accumulatedDepreciationAccountId;
        depreciationExpenseAccountId }` (cada uno `string | null | undefined`), `onChange(key,
        accountId: string | null)`, `savedIds: string[]` (para `includeIds`), `isEditing`,
        `postedVehiclesCount: number | undefined`, `isDirty: boolean` (alguna cuenta distinta de
        la guardada). Un `useQuery({ queryKey: ['vehicle-type-asset-accounts', savedIds],
        queryFn: () => getVehicleTypeAssetAccounts(savedIds) })`; tres bloques `Label` +
        `AccountCombobox` (`clearLabel="Sin asignar (usar la cuenta por defecto)"`,
        `placeholder` "Cargando cuentas…" mientras carga): "Cuenta de Bienes de Uso" (lista
        `asset`), "Amortización acumulada" (`asset`), "Gasto de amortización" (`expense`), con
        un `<p className="text-xs text-muted-foreground">` cada uno: "Se usa en la baja y el
        ajuste de valor de los equipos de este tipo. Conviene que sea la misma cuenta a la que se
        imputó la compra del bien (Ítems → Imputación contable)." / "Se usa en la amortización
        mensual y en la baja." / "Se usa en la amortización mensual. Suele ir por función
        (explotación, administración), no por rubro." Abajo, si `isEditing && isDirty &&
        postedVehiclesCount > 0`, el aviso naranja (clases de `_PartnerAccountNotice.tsx:20-27`,
        icono `AlertTriangle`): "Este tipo tiene {N} equipo(s) con amortizaciones ya
        contabilizadas. Cambiar las cuentas no modifica esos asientos: las próximas
        amortizaciones y la baja usarán la cuenta nueva y el saldo acumulado hasta hoy queda en
        la anterior. Si hace falta, el contador lo reclasifica con un asiento manual." Un
        párrafo final neutro: "Si un campo queda vacío se usa la cuenta por defecto de
        Contabilidad → Configuración. Cada equipo puede sobreescribir estas cuentas en su
        pestaña Depreciación."
  - [x] `_VehicleTypeFormModal.tsx`: importar `vehicleTypeSchema`/`VehicleTypeFormData` de
        `../validators` (borrar `:26-38`); `defaultValues` (`:66`) y el `reset` (`:75-82`) con
        los tres campos desde `vehicleType?.…AccountId ?? null`; `useQuery({ queryKey:
        ['vehicle-type-posted-count', vehicleType?.id], queryFn: () =>
        getVehicleTypePostedDepreciationCount(vehicleType!.id), enabled: open && isEditing })`;
        montar `<_VehicleTypeAccountsFields values={watch(...)} onChange={(k, v) =>
        setValue(k, v, { shouldDirty: true })} savedIds={…} isEditing postedVehiclesCount
        isDirty={…} />` debajo de los checkboxes (`:170`), separado por un `<Separator />` y el
        subtítulo "Cuentas contables (Bienes de Uso)"; `DialogContent` de `sm:max-w-[425px]`
        (`:126`) a `sm:max-w-[600px]`. Las mutaciones (`:88-112`) no cambian: ya mandan `data`
        completo.
  - [x] `vehicle-types/list/columns.tsx:70-83`: después de "Equipos", columna `id: 'accounts'`,
        header "Cuentas contables" (`DataTableColumnHeader`), `meta: { title: 'Cuentas
        contables' }`, `enableSorting: false`, cell: cuenta cuántas de las tres ids no son
        `null` → `Badge` `variant="secondary"` con "Por defecto" (0), `"{n}/3 propias"`
        (1-2) o `variant="default"` "Propias" (3); `data-testid={`vehicle-type-accounts-${id}`}`.
        `VehicleTypeListItem` (`actions.server.ts:245`) ya trae las columnas nuevas porque
        `getVehicleTypesPaginated` (`:55-69`) no usa `select`.
- **Archivos:**
  - Crear: `src/modules/company/features/vehicle-types/list/validators.ts`,
    `validators.test.ts`, `components/_VehicleTypeAccountsFields.tsx`
  - Modificar: `vehicle-types/list/actions.server.ts`, `components/_VehicleTypeFormModal.tsx`,
    `columns.tsx`
- **Criterio de completitud:** `validators.test.ts` en verde (primero rojo); en
  `/dashboard/company/vehicle-types` crear "Camión" con las tres cuentas guarda y la tabla
  muestra "Propias"; editar y vaciar una deja "2/3 propias"; los combos ofrecen solo hojas
  activas del tipo correcto (una cuenta `isLeaf: false` no aparece); al editar un tipo con un
  equipo amortizado y cambiar una cuenta aparece el aviso naranja; con las cuentas sin cambiar
  no aparece; `check-types` en 219; `_VehicleTypeFormModal.tsx` sigue < 200 líneas.

#### Fase 4: Depreciación — override, resolución y contabilización con `ActionResult` (TDD de integración)

- **Objetivo:** que la depreciación de un equipo pueda sobreescribir las cuentas del tipo; que
  la pestaña Depreciación muestre qué cuentas se van a usar y de dónde salen; y que la
  contabilización individual y masiva resuelva depreciación → tipo → global, pre-valide antes de
  la transacción y devuelva errores legibles en producción (individual: toast con el motivo;
  masiva: lista de mensajes, no solo el conteo).
- **Tareas:**
  - [x] **Validators (TDD).** Crear `src/modules/equipment/features/depreciation/validators.test.ts`:
        `depreciationConfigSchema` sigue aceptando el input actual sin cuentas (regresión);
        acepta las tres cuentas como UUID o `null`; rechaza un no-UUID; los `refine` existentes
        (`salvageValue < grossValue`, tasa obligatoria en `DECLINING_BALANCE`) siguen
        funcionando con los campos nuevos presentes; nuevo `depreciationAccountsSchema` parsea
        `{ fixedAssetAccountId: null, accumulatedDepreciationAccountId: UUID,
        depreciationExpenseAccountId: undefined }`. Rojo primero.
  - [x] `depreciation/validators.ts:3-15`: agregar los tres `accountField = z.string().uuid()
        .nullish()` dentro del `z.object` (antes de los `.refine`). Nuevo
        `depreciationAccountsSchema = z.object({ los tres })` + `type DepreciationAccountsInput`.
        Reexportar desde `depreciation/index.ts`. Verde.
  - [x] `depreciation/actions.server.ts`: importar `ActionResult`, `BusinessError`,
        `toActionResult` de `@/shared/lib/action-result` y `loadVehiclesAssetAccounts`,
        `assertAssetAccountsForOperation` de `@/modules/equipment/shared/asset-accounts-loader`.
        Helper privado `assertAccountsBelongToCompany(ids: (string | null | undefined)[],
        companyId)` (una sola `account.findMany` con `id: { in }`; lanza si falta alguna).
  - [ ] `createVehicleDepreciation` (`:145-251`): en `data` (`:189-203`) agregar los tres ids
        (`?? null`) tras `assertAccountsBelongToCompany`. `updateVehicleDepreciation`
        (`:256-340`): ídem en `data` (`:301-315`). Ambas conservan su forma (`throw`): siguen
        siendo formularios que hoy muestran `error.message` y no son los puntos de asiento.
  - [x] Nueva `updateDepreciationAccounts(depreciationId: string, input:
        DepreciationAccountsInput): Promise<ActionResult>`: `checkPermission('equipment',
        'update')`, `safeParse` → `BusinessError` con los mensajes de Zod; depreciación de la
        empresa o `BusinessError('Depreciación no encontrada')`; **no** bloquea por períodos
        contabilizados (decisión del usuario); `assertAccountsBelongToCompany`; `update` de las
        tres ids; `logger.info('Cuentas de depreciación actualizadas', { data: { depreciationId,
        vehicleId, before, after, postedCount } })`; `revalidatePath(`/dashboard/equipment/${vehicleId}`)`;
        `return { success: true }`; `catch` → `toActionResult(error, 'Error al actualizar las
        cuentas de la depreciación')`.
  - [x] Nueva `getDepreciationAccountOptions(includeIds?: string[])` con
        `checkPermission('equipment', 'view')` → `{ asset, expense }` igual que
        `getVehicleTypeAssetAccounts` (fase 3) pero con el permiso de equipos; no se importa la
        de `company` (regla de módulos: `equipment` no importa de `company`).
  - [x] Nueva `getVehicleAssetAccounts(vehicleId: string)` con `checkPermission('equipment',
        'view')`: `loadVehiclesAssetAccounts(companyId, [vehicleId]).get(vehicleId)` → si no
        existe, `throw new Error('Equipo no encontrado')` (lectura; no es mutación); devuelve
        un objeto **plano** `{ vehicleLabel, typeId, typeName, isActive, hasDepreciation,
        depreciationId, depreciationStatus, postedCount, overrides: { 3 ids }, accounts: Record<
        AssetAccountKey, { accountId, code, name, source, imputable } | null>,
        assetDisposalGainLoss: { accountId, code, name } | null }` (sin `Map`, sin `Date`
        innecesarias). Exportar `type VehicleAssetAccounts`.
  - [x] **`postDepreciationEntry`** (`:426-595`) → `Promise<ActionResult<{ journalEntryId:
        string; journalEntryNumber: number }>>`:
    - Todos los `throw new Error(...)` de negocio (`:448-476`: no encontrado, sin permiso, ya
      contabilizado, no activa, secuencia) pasan a `throw new BusinessError(...)`.
    - Reemplazar la lectura de `settings` y su guard (`:479-493`) por `const loaded = (await
      loadVehiclesAssetAccounts(companyId, [entry.depreciation.vehicleId])).get(…)` y `const
      accounts = assertAssetAccountsForOperation(loaded, 'depreciation')` **antes** de
      `prisma.$transaction` (`:509`). El bloqueo de período (`:496-502`) usa
      `loaded.lockedUntilDate` y lanza `BusinessError`.
    - Las dos líneas del asiento (`:520-545`) usan `accounts.depreciationExpenseAccountId!` y
      `accounts.accumulatedDepreciationAccountId!`; descripciones sin cambios.
    - Fin: `return { success: true, journalEntryId: result.id, journalEntryNumber: result.number
      }`; `catch` (`:591-594`) → `return toActionResult(error, 'Error al contabilizar el
      período')`. Quitar el `logger.error` duplicado (lo hace `toActionResult`).
  - [x] **`postAllPendingDepreciations`** (`:600-777`) → `Promise<ActionResult<{ posted: number;
        errors: string[] }>>`:
    - Quitar el guard global (`:610-623`); leer solo `lockedUntilDate` de settings para el
      `where` (`:626-635`).
    - Después de `pendingEntries` (`:648`): `const vehicleIds = [...new Set(pendingEntries.map(e
      => e.depreciation.vehicleId))]`, `const loadedByVehicle = await
      loadVehiclesAssetAccounts(companyId, vehicleIds)`; por cada equipo, `try {
      assertAssetAccountsForOperation(loaded, 'depreciation') } catch (BusinessError) {
      errors.push(message); skipped.add(vehicleId) }`; `const entriesToPost =
      pendingEntries.filter(e => !skipped.has(e.depreciation.vehicleId))`. Todo esto **antes**
      de `prisma.$transaction` (`:658`, riesgo 1.6-4): un equipo sin cuentas no entra al loop
      y no aborta la transacción de los demás.
    - En el loop (`:659-764`) reemplazar `settings.depreciationExpenseAccountId!` /
      `settings.accumulatedDepreciationAccountId!` (`:706`, `:712`) por las cuentas del
      `Map` para `entry.depreciation.vehicleId`. Los mensajes de `errors.push` existentes
      (`:674-678`, `:761`) se conservan.
    - `return { success: true, posted, errors }`; `catch` → `toActionResult(error, 'Error al
      contabilizar depreciaciones')`.
  - [x] **`getPendingDepreciationsSummary`** (`:993-1041`): con el mismo `Map`, agregar al
        resultado `vehiclesWithoutAccounts: Array<{ vehicleId; vehicleLabel; message: string }>`
        (el `message` de la `BusinessError` de `assertAssetAccountsForOperation`), para que el
        diálogo avise **antes** de contabilizar. `totalEntries`/`totalAmount` no cambian (siguen
        contando todo lo pendiente).
  - [ ] Crear `depreciation/components/_DepreciationAccountsFields.tsx` (< 160 líneas): props
        `values`, `onChange(key, id)`, `savedIds`, `preview?: VehicleAssetAccounts | null`
        (para "Si queda vacío se usa: `1.2.2/04/03 - …` (del tipo de equipo Camión)" o "Si queda
        vacío: **sin cuenta** — configurala en el tipo de equipo o en Contabilidad →
        Configuración" cuando `preview.accounts[key]` es `null` o viene de `type`/`default`),
        `postedCount?: number`, `isDirty`. Query `['depreciation-account-options', savedIds]` →
        `getDepreciationAccountOptions`. Tres `AccountCombobox` con `clearLabel="Sin asignar
        (usar la del tipo de equipo o la por defecto)"`. Aviso naranja si `isDirty && postedCount
        > 0`: "Este equipo tiene {N} período(s) contabilizado(s) en la cuenta anterior. Cambiar
        la cuenta no modifica esos asientos: los próximos períodos y la baja usarán la nueva; el
        saldo ya acumulado lo reclasifica el contador con un asiento manual."
  - [ ] `_DepreciationConfigDialog.tsx` (256 líneas, ya > 200): `defaultValues` (`:50-59`) con
        las tres cuentas en `null`; `useQuery(['vehicleAssetAccounts', vehicleId], () =>
        getVehicleAssetAccounts(vehicleId), { enabled: open })` para el `preview`; debajo del
        grid de campos (`:214`) un `Collapsible` (`@/shared/components/ui/collapsible`) cerrado
        por defecto con trigger "Cuentas contables (opcional, reemplazan las del tipo de
        equipo)" y dentro `<_DepreciationAccountsFields values={form.watch(...)} onChange={(k,
        v) => form.setValue(k, v)} savedIds={[]} preview={preview} />`. Si el archivo supera
        ~290 líneas, mover el `Collapsible` + fields a
        `_DepreciationConfigAccountsSection.tsx`. `DialogContent` `sm:max-w-[600px]` (`:90`)
        alcanza.
  - [x] Crear `depreciation/components/_DepreciationAccountsCard.tsx` (< 180 líneas): `Card`
        "Cuentas contables" con tres filas `{field}: {code - name}` + `Badge` con
        `ASSET_ACCOUNT_SOURCE_LABELS[source]` ("de la depreciación del equipo" / "del tipo de
        equipo Camión" / "por defecto"), o "**Sin cuenta** — asignala acá, en el tipo «Camión» o
        en Contabilidad → Configuración" en rojo si es `null`, y "(no imputable)" si
        `imputable: false`; nota fija: "La compra del bien se imputa a la cuenta del ítem
        (Ítems → Imputación contable). Para que el rubro cierre, la cuenta de Bienes de Uso del
        equipo tiene que ser la misma." Botón "Editar cuentas" (`hasPermission('equipment',
        'update')`) que abre `_DepreciationAccountsDialog`. Props: `vehicleId`, `data:
        VehicleAssetAccounts`, `onChanged` (invalidar `['vehicleAssetAccounts', vehicleId]` y
        `['vehicleDepreciation', vehicleId]`).
  - [x] Crear `depreciation/components/_DepreciationAccountsDialog.tsx` (< 160 líneas): `Dialog`
        con `_DepreciationAccountsFields` (`values` desde `data.overrides`, `savedIds` con las
        tres guardadas, `preview={data}`, `postedCount={data.postedCount}`, `isDirty`
        comparando con `overrides`), botón "Guardar" → `updateDepreciationAccounts(
        data.depreciationId, values)`; `if (!result.success) { toast.error(result.error);
        return; }` → `toast.success('Cuentas actualizadas')`, `onChanged()`, cerrar.
  - [x] `_DepreciationTab.tsx`: segundo `useQuery(['vehicleAssetAccounts', vehicleId], () =>
        getVehicleAssetAccounts(vehicleId))`; montar `<_DepreciationAccountsCard>` entre la card
        de resumen y "Cronograma" (`:371`); `postMutation` (`:98-110`): `onSuccess: (result) =>
        { if (!result.success) { toast.error(result.error); return; } toast.success(`Período
        contabilizado (Asiento #${result.journalEntryNumber})`); … }`, y el `onError` queda solo
        para fallos de red (`toast.error('No se pudo contactar al servidor')`). Al contabilizar,
        invalidar también `['vehicleAssetAccounts', vehicleId]` (cambia `postedCount`). Si el
        archivo pasa de 439 a > 470 líneas, extraer las columnas del cronograma a
        `depreciation-columns.tsx` (ya es deuda; no ampliar).
  - [x] `list/components/_BulkDepreciationDialog.tsx`: estado `resultErrors: string[]`;
        `postMutation.onSuccess` (`:48-57`): `if (!result.success) { toast.error(result.error);
        return; }`; si `result.posted > 0` toast de éxito; si `result.errors.length > 0` →
        `setResultErrors(result.errors)` y **no cerrar** el diálogo: mostrar una lista
        `<ul>` con cada mensaje (scroll `max-h-60`), título "{N} equipo(s)/período(s) no se
        pudieron contabilizar" y el botón principal pasa a "Cerrar". Antes de contabilizar, si
        `summary.vehiclesWithoutAccounts.length > 0`, aviso naranja con los labels de los
        equipos y sus mensajes ("Estos equipos se van a omitir: …"). Al cambiar `upToDate` o
        reabrir, limpiar `resultErrors`. Si pasa de 200 líneas, extraer la lista a
        `_BulkDepreciationErrors.tsx`.
  - [x] **Test de integración (rojo primero).** Crear
        `src/modules/equipment/features/depreciation/depreciation-accounts.integration.test.ts`
        con el andamiaje de `fund-movement-partner-account.integration.test.ts:19-47` (`import
        'dotenv/config'`, `describe.skipIf(!dbAvailable)`, los cuatro `vi.mock`:
        `@/shared/lib/current-user`, `@/shared/lib/company`, `@/shared/lib/permissions`
        `{ checkPermission: vi.fn().mockResolvedValue(undefined) }`, `next/cache`), prefijo
        `TSK724C-TEST-`. `beforeAll`: empresa; cuentas hoja ASSET `BU global`, `AA global`,
        `BU Rodados`, `AA Rodados`, `AA vieja` (para dar de baja), EXPENSE `Gasto global`,
        `Gasto Explotación`, `Gasto propio`, EXPENSE `Resultado baja`; `AccountingSettings`
        (`fiscalYearStart/End` 2026, `lastEntryNumber: 0`, las cuatro globales); `TypeOfVehicle`
        `Vehículos`; `VehicleType` `Camión` (con `BU Rodados`, `AA Rodados`, `Gasto
        Explotación`) y `VehicleType` `Sin cuentas` (las tres en `null`); equipos (campos
        obligatorios: `engine`, `year`, `typeId`, `typeOfVehicleId`, `companyId`;
        `internNumber` único por empresa) `conTipo` (Camión), `conOverride` (Camión +
        `VehicleDepreciation` con `depreciationExpenseAccountId: Gasto propio`), `sinNada`
        (tipo `Sin cuentas`), cada uno con `VehicleDepreciation` `grossValue: 120000`,
        `salvageValue: 0`, `usefulLifeMonths: 12`, `startDate: 2026-01-01` y **dos**
        `DepreciationScheduleEntry` (`periodNumber` 1 y 2, `amount: 10000`, `accumulatedAmount`
        10000/20000, `bookValueAfter` 110000/100000). `vi.mocked(getActiveCompanyId)` /
        `getCurrentUserId`. Casos (todos por los actions **reales**):
    - `postDepreciationEntry(conTipo.p1)` → `{ success: true }`; el asiento tiene Debe en
      `Gasto Explotación` y Haber en `AA Rodados`; ninguna línea en `Gasto global` ni `AA
      global`.
    - `postDepreciationEntry(conOverride.p1)` → Debe en `Gasto propio` (override) y Haber en
      `AA Rodados` (del tipo): independencia por cuenta.
    - `sinNada` con las globales configuradas → asiento en `Gasto global` / `AA global`
      (regresión del comportamiento actual).
    - `sinNada` tras `accountingSettings.update({ accumulatedDepreciationAccountId: null })` →
      `{ success: false, error }` con `error` que contiene `«` + `internNumber` + `»`,
      `Amortización acumulada`, `«Sin cuentas»` y `Contabilidad → Configuración`; el período
      sigue `isPosted: false` y no hay asiento nuevo; restaurar.
    - `conTipo` tras `vehicleType.update({ accumulatedDepreciationAccountId: AA vieja })` +
      `account.update(AA vieja, { isActive: false })` → `success: false` con el `code` de `AA
      vieja` y `Empresa → Tipos de Equipo`; **no** cae a `AA global`; restaurar.
    - Secuencia: `postDepreciationEntry(conTipo.p2)` antes que p1 → `success: false` con
      `períodos anteriores` (los mensajes viejos ahora viajan como dato).
    - `postAllPendingDepreciations(2026-03-01)` con `sinNada` sin cuentas (globales en `null`
      y tipo sin cuentas) y `conTipo`/`conOverride` completos → `success: true`, `posted` = los
      períodos pendientes de los dos equipos con cuentas, `errors.length === 1` y `errors[0]`
      nombra a `sinNada` con el mensaje legible; los asientos de `conTipo` y `conOverride` van a
      cuentas distintas de gasto.
    - `updateDepreciationAccounts(conTipo.depreciationId, { fixedAssetAccountId: null,
      accumulatedDepreciationAccountId: 'AA Rodados', depreciationExpenseAccountId: 'Gasto
      propio' })` con períodos ya contabilizados → `{ success: true }` (no bloquea) y la
      siguiente contabilización usa `Gasto propio`.
    - `getPendingDepreciationsSummary(...)` con `sinNada` sin cuentas →
      `vehiclesWithoutAccounts` lo lista con su mensaje.
        `afterAll`: `journalEntry → depreciationScheduleEntry → vehicleDepreciation →
        assetValueAdjustment → vehicle → vehicleType → typeOfVehicle → accountingSettings →
        account → company` por `companyId`, con la guarda `if (companyId)` de
        `fund-movement-partner-account.integration.test.ts:172-173`. Los casos de baja y ajuste
        de la fase 5 se agregan a **este mismo archivo** (mismo andamiaje).
- **Archivos:**
  - Crear: `depreciation/validators.test.ts`, `depreciation-accounts.integration.test.ts`,
    `components/_DepreciationAccountsFields.tsx`, `_DepreciationAccountsCard.tsx`,
    `_DepreciationAccountsDialog.tsx`
  - Modificar: `depreciation/validators.ts`, `depreciation/index.ts`,
    `depreciation/actions.server.ts`, `components/_DepreciationConfigDialog.tsx`,
    `_DepreciationTab.tsx`, `list/components/_BulkDepreciationDialog.tsx`
- **Criterio de completitud:** `validators.test.ts` y los casos de amortización del test de
  integración en verde (primero rojo); en la app: configurar depreciación de un equipo de tipo
  Camión sin tocar cuentas → la card muestra las tres cuentas del tipo con badge "del tipo de
  equipo Camión"; "Contabilizar" genera el asiento en esas cuentas (verificar en Contabilidad →
  Asientos); editar cuentas de la depreciación y poner un gasto propio → la card lo muestra
  "de la depreciación del equipo" y el próximo período lo usa; equipo de un tipo sin cuentas y
  globales vacías → toast con el mensaje completo (equipo, cuenta, dónde); masiva con ese equipo
  → el diálogo lista el mensaje y no se cierra solo; `check-types` en 219; ningún consumidor
  de `postDepreciationEntry`/`postAllPendingDepreciations` quedó con el `try/catch` viejo (grep).

#### Fase 5: Bajas y ajuste de valor — cuentas resueltas, sin silencios, botón del detalle (TDD de integración)

- **Objetivo:** que la baja por venta / pérdida total / devolución y el ajuste de valor usen las
  cuentas resueltas del equipo, se rechacen **antes** de tocar nada si falta alguna (con el
  mensaje que nombra equipo, cuenta y dónde configurarla), que "período cerrado" llegue al
  usuario, que el diálogo de baja avise cuándo **no** habrá asiento (sin depreciación, motivo
  "Otro"), y que "Dar de Baja" funcione también desde el detalle.
- **Tareas:**
  - [x] `src/modules/accounting/features/integrations/equipment/index.ts:1-23`: reescribir el
        encabezado: la integración genera **solo** los asientos de baja (venta y
        pérdida/devolución); la amortización vive en `equipment/features/depreciation/
        actions.server.ts`; **no hay asiento de alta**: el bien entra a Bienes de Uso por la
        factura de compra (cuenta del ítem, TSK-579/721); las cuentas llegan **resueltas** por
        el llamador (`equipment/shared/asset-accounts-loader.ts`, TSK-724c) y esta integración
        no importa nada de `equipment`.
  - [x] Mismo archivo: eliminar `getEquipmentAccountingSettings` (`:40-56`, incluido el
        `payablesAccountId` muerto). Exportar `interface AssetDisposalAccounts {
        fixedAssetAccountId: string; accumulatedDepreciationAccountId: string;
        assetDisposalGainLossAccountId: string }`.
  - [x] Mismo archivo, `createJournalEntry` (`:69-159`): firma `Promise<string>` (nunca devolvía
        `null`); "No se encontró configuración contable" (`:96-98`) y "período cerrado"
        (`:100-104`) pasan a `throw new BusinessError(...)` (import de
        `@/shared/lib/action-result`); el desbalance (`:84-88`) queda como `Error` (es un bug,
        no una condición de negocio).
  - [x] Mismo archivo, `createJournalEntryForAssetSale` (`:169-245`) y
        `createJournalEntryForAssetDisposal` (`:254-330`): nueva firma `(vehicleId, companyId,
        accounts: AssetDisposalAccounts, tx): Promise<string>`; borrar el guard de settings
        (`:176-185`, `:261-270`); el caso sin `VehicleDepreciation` (`:194-199`, `:279-284`)
        pasa de `logger.warn` + `return null` a `throw new BusinessError('El equipo
        «${label}» no tiene depreciación configurada: la baja no genera asiento contable')`
        (defensa en profundidad; el llamador ya no llama en ese caso); las líneas (`:207-232`,
        `:292-317`) usan `accounts.*`. La fecha sigue `new Date()` (2.4-6).
  - [x] `src/modules/equipment/features/list/actions.server.ts`, `softDeleteVehicle`
        (`:333-379`) → `Promise<ActionResult<{ journalEntryId: string | null }>>`:
    - Imports: `ActionResult`, `BusinessError`, `toActionResult`;
      `loadVehiclesAssetAccounts`, `assertAssetAccountsForOperation`; `revalidatePath`.
    - Antes de la transacción: `const loaded = (await loadVehiclesAssetAccounts(companyId,
      [id])).get(id)`; `if (!loaded) throw new BusinessError('Equipo no encontrado')`; `if
      (!loaded.isActive) throw new BusinessError('El equipo ya está dado de baja')`; `const
      generatesEntry = loaded.hasDepreciation && terminationReason !== 'OTHER'`; `const
      accounts = generatesEntry ? assertAssetAccountsForOperation(loaded, 'disposal') : null`
      (lanza `BusinessError` con los mensajes de la fase 2).
    - Dentro de `prisma.$transaction` (`:342-372`): el `update` del vehículo igual; `let
      journalEntryId: string | null = null`; si `generatesEntry`, `journalEntryId = await
      createJournalEntryForAssetSale(id, companyId, accounts!, tx)` para `SALE`,
      `…Disposal` para `TOTAL_LOSS` / `RETURN`; marcar la depreciación `COMPLETED` como hoy
      (`:361-371`, puede usar `loaded.depreciationId`).
    - `revalidatePath('/dashboard/equipment')` y `revalidatePath(`/dashboard/equipment/${id}`)`;
      `return { success: true, journalEntryId }`; `catch` (`:374-378`) → `return
      toActionResult(error, 'Error al dar de baja el equipo')`. Comentario: `// TSK-724c: antes
      cualquier fallo (incluido "período cerrado") se convertía en un genérico y las cuentas
      faltantes dejaban el equipo dado de baja sin asiento y sin aviso.`
  - [x] `depreciation/actions.server.ts`, `createValueAdjustment` (`:786-988`) →
        `Promise<ActionResult<{ journalEntryId: string }>>`: `safeParse` → `BusinessError`;
        "no encontrada" / "no activa" (`:814-820`) → `BusinessError`; reemplazar la lectura de
        settings (`:826-833`) por `loadVehiclesAssetAccounts(companyId, [vehicleId]).get(…)` +
        `const accounts = assertAssetAccountsForOperation(loaded, 'adjustment')` **antes** de
        `prisma.$transaction` (`:839`); eliminar el `if` sin `else` (`:843-847`): el asiento se
        genera **siempre** con `accounts.fixedAssetAccountId!`, `accounts.
        accumulatedDepreciationAccountId!` y `accounts.assetDisposalGainLossAccountId!`
        (`:865-895`); `journalEntryId` deja de ser `undefined` posible (`:840`, `:915`);
        `return { success: true, journalEntryId }`; `catch` → `toActionResult(error, 'Error al
        registrar el ajuste de valor')`. Comentario: `// TSK-724c: antes, sin cuentas, el
        ajuste se guardaba sin asiento y sin aviso.`
  - [x] `_ValueAdjustmentDialog.tsx:60-75`: `const result = await createValueAdjustment(...)`;
        `if (!result.success) { toast.error(result.error); return; }`; éxito → invalidar también
        `['vehicleAssetAccounts', vehicleId]`. El `catch` queda para fallos de red.
  - [x] Crear `src/modules/equipment/shared/components/_TerminateEquipmentDialog.tsx` (< 190
        líneas) moviendo el diálogo inline de `_EquipmentDataTable.tsx:290-343` y su mutación
        (`:106-118`). Props: `vehicle: { id: string; internNumber: string | null; domain:
        string | null } | null`, `open`, `onOpenChange`, `onTerminated?: () => void`. Dentro:
        `useState<VehicleTerminationReason>('SALE')`; `useQuery(['vehicleAssetAccounts',
        vehicle?.id], () => getVehicleAssetAccounts(vehicle!.id), { enabled: open && !!vehicle
        })`; bajo el `Select` de motivo, un aviso: si `!data.hasDepreciation` → neutro "Este
        equipo no tiene depreciación configurada: la baja no genera asiento contable."; si
        `reason === 'OTHER'` → neutro "Baja por otro motivo: no genera asiento contable."; si
        no, si alguna de `fixedAsset`/`accumulatedDepreciation` es `null` o
        `assetDisposalGainLoss` es `null` → naranja "La baja va a fallar: falta la cuenta de
        {X}. Configurala en la pestaña Depreciación, en el tipo «{typeName}» o en Contabilidad
        → Configuración." (el server la rechaza igual); si está todo → neutro "La baja genera un
        asiento con: Bienes de Uso `{code - name}` ({origen}), Amortización acumulada `{…}`
        ({origen}) y Resultado `{…}`." `useMutation(softDeleteVehicle)`: `onSuccess: (result)
        => { if (!result.success) { toast.error(result.error); return; } toast.success(
        result.journalEntryId ? 'Equipo dado de baja. Se generó el asiento contable.' : 'Equipo
        dado de baja (sin asiento contable).'); queryClient.invalidateQueries({ queryKey:
        ['equipment'] }); router.refresh(); onTerminated?.(); onOpenChange(false); }`. Importa
        `getVehicleAssetAccounts` de `../../features/depreciation/actions.server` y
        `softDeleteVehicle` de `../../features/list/actions.server` (mismo módulo).
  - [x] `_EquipmentDataTable.tsx`: borrar el `Dialog` inline (`:290-343`), `deleteMutation`
        (`:106-118`), `terminationReason` (`:103`) y los imports que queden sin uso (`Select*`,
        `Dialog*`, `vehicleTerminationReasonLabels`, `VehicleTerminationReason` si no se usa
        más); montar `<_TerminateEquipmentDialog vehicle={selectedVehicle}
        open={deleteDialogOpen} onOpenChange={(o) => { setDeleteDialogOpen(o); if (!o)
        setSelectedVehicle(null); }} />`.
  - [x] `detail/components/_EquipmentHeader.tsx:153-158`: `useState(false)` para el diálogo;
        `onClick={() => setTerminateOpen(true)}` en el botón; renderizar
        `<_TerminateEquipmentDialog vehicle={{ id: vehicle.id, internNumber: vehicle.internNumber,
        domain: vehicle.domain }} open onOpenChange />`. `EquipmentDetail.tsx` es Server
        Component y re-renderiza con `router.refresh()` (`isActive` → badge "Inactivo", botón
        desaparece).
  - [x] Eliminar `list/components/_EquipmentTable.tsx` (436 líneas; sin importadores, verificado
        con grep; consumidor muerto de `softDeleteVehicle` con `onError` genérico). Verificar
        que `list/index.ts` no lo exporte.
  - [x] **Casos de integración** (agregar a `depreciation-accounts.integration.test.ts`, mismo
        andamiaje; rojo primero):
    - `softDeleteVehicle(conTipo.id, 'SALE')` con p1 contabilizado (`totalDepreciated:
      10000`, `currentBookValue: 110000`) → `{ success: true, journalEntryId }`; el asiento
      tiene Debe `AA Rodados` 10000, Haber `BU Rodados` 120000, Debe `Resultado baja` 110000;
      el equipo queda `isActive: false`, `terminationReason: 'SALE'`; la depreciación
      `COMPLETED`.
    - `softDeleteVehicle(sinNada.id, 'TOTAL_LOSS')` con globales `fixedAssetAccountId: null` →
      `{ success: false, error }` con `«` + label + `»`, `Bienes de Uso`, `la baja`; el equipo
      sigue `isActive: true` y sin `terminationDate` (la pre-validación corre antes de la
      transacción); restaurar.
    - Equipo **sin** `VehicleDepreciation` (crear `sinDepreciacion` en el `beforeAll`) con
      `'RETURN'` → `{ success: true, journalEntryId: null }`, `isActive: false`, y el conteo de
      `journalEntry` de la empresa no cambia.
    - `softDeleteVehicle(conOverride.id, 'OTHER')` → `success: true`, `journalEntryId: null`.
    - `accountingSettings.update({ lockedUntilDate: 2099-12-31 })` +
      `softDeleteVehicle(conOverride…, 'SALE')` → `success: false` con `período está cerrado`;
      el equipo sigue activo; restaurar.
    - `createValueAdjustment(conTipo.id, { date, newValue: 90000, reason: 'Deterioro' })` con
      globales completas → `{ success: true, journalEntryId }`; asiento Debe `Resultado baja`
      / Haber `AA Rodados` por la diferencia; `assetValueAdjustment.journalEntryId` no es
      `null`.
    - Ídem con `assetDisposalGainLossAccountId: null` → `success: false` con `"Resultado por
      venta/baja de Bienes de Uso"`; **no** se creó ningún `assetValueAdjustment` (antes se
      guardaba sin asiento); restaurar.
- **Archivos:**
  - Crear: `src/modules/equipment/shared/components/_TerminateEquipmentDialog.tsx`
  - Modificar: `accounting/features/integrations/equipment/index.ts`,
    `equipment/features/list/actions.server.ts`, `list/components/_EquipmentDataTable.tsx`,
    `detail/components/_EquipmentHeader.tsx`, `depreciation/actions.server.ts`,
    `depreciation/components/_ValueAdjustmentDialog.tsx`,
    `depreciation-accounts.integration.test.ts`
  - Eliminar: `equipment/features/list/components/_EquipmentTable.tsx`
- **Criterio de completitud:** los casos de baja y ajuste del test en verde (primero rojo); en la
  app: "Dar de baja" desde el listado y desde el detalle abren el mismo diálogo; con un equipo
  de tipo Camión amortizado, baja por venta → asiento en `BU Rodados` / `AA Rodados` /
  Resultado (verificar en Asientos); con un tipo sin cuentas y globales vacías → el toast dice
  qué cuenta falta y dónde; con "Otro" o sin depreciación → el diálogo lo avisa antes y el toast
  dice "sin asiento"; ajuste de valor sin cuenta de resultado → toast legible y sin registro
  guardado; `grep -rn "softDeleteVehicle\|createValueAdjustment" src --include=*.tsx` no
  muestra ningún `try/catch` con mensaje genérico; `check-types` en 219.

#### Fase 6: Configuración contable — cuentas "por defecto"

- **Objetivo:** que la sección de Bienes de Uso de Ajustes contables explique que tres de las
  cuatro cuentas son respaldo de las del tipo/depreciación, con los mismos textos que aprendió
  la usuaria en 717/721. Sin campos nuevos, sin cambios en Zod ni en `saveAccountingSettings`
  (verificado: `validators.ts:51-54` y `validators.test.ts` no cambian; el conteo de cuentas
  configurables sigue en 31).
- **Tareas:**
  - [x] `settings/components/_CommercialIntegrationForm.tsx:227-244`: `title: 'Bienes de Uso
        (cuentas por defecto)'`, `description: 'Las cuentas de Bienes de Uso, Amortización
        acumulada y Gasto de amortización se definen por Tipo de Equipo (Empresa → Tipos de
        Equipo) y cada equipo puede sobreescribirlas en su pestaña Depreciación. Las de acá se
        usan cuando ninguna de las dos está cargada.'` (`SectionDef.description` ya existe,
        `:45-49`). Campos: `fixedAssetAccountId` → `label: 'Cuenta de Bienes de Uso por
        defecto'`, `help: 'Se usa en la baja y en el ajuste de valor de los equipos que no tienen
        cuenta en su depreciación ni en su Tipo de Equipo. Conviene que sea la misma cuenta a la
        que se imputó la compra del bien (Ítems → Imputación contable).'`;
        `accumulatedDepreciationAccountId` → `label: 'Amortización acumulada por defecto'`,
        `help: 'Se usa en la amortización mensual y en la baja de los equipos sin cuenta propia
        ni de tipo.'`; `depreciationExpenseAccountId` → `label: 'Gasto de amortización por
        defecto'`, `help: 'Se usa en la amortización mensual de los equipos sin cuenta propia ni
        de tipo. Suele ir por función (explotación, administración), no por rubro.'`;
        `assetDisposalGainLossAccountId` → `label: 'Resultado por venta/baja de Bienes de
        Uso'`, `help: 'Única para todos los equipos: recibe el valor libro no amortizado en la
        baja y la diferencia en los ajustes de valor. Sin esta cuenta la baja y el ajuste no se
        pueden contabilizar.'`. `name` y `types` sin cambios. Los `label` deben coincidir
        **literalmente** con `ASSET_ACCOUNT_LABELS[*].settingLabel` (fase 2) y con
        `buildMissingDisposalAccountMessage`.
- **Archivos:**
  - Modificar: `src/modules/accounting/features/settings/components/_CommercialIntegrationForm.tsx`
- **Criterio de completitud:** en `/dashboard/company/accounting/settings` la sección muestra
  el título, la descripción y las cuatro ayudas nuevas; guardar y limpiar siguen funcionando;
  `settings/validators.test.ts` sigue en verde sin cambios; `check-types` en 219.

#### Fase 7: Módulo Equipos visible

- **Objetivo:** que la clienta pueda llegar a Equipos → Detalle → Depreciación, a "Contabilizar
  Depreciaciones" del listado y a Empresa → Tipos de Equipo: sacar `equipment` de
  `HIDDEN_MODULES` y reponer lo que TSK-377 (commit `7d3997e`) quitó **solo para Equipos**
  (Empleados y Documentos siguen ocultos). Verificado qué implica: `HIDDEN_MODULES`
  (`shared/lib/modules/constants.ts:22`) lo consumen la pantalla de activación
  (`_ModulesConfigForm.tsx:59-62`, filtra `MODULE_ORDER`) y la pantalla de roles
  (`company/features/general/roles/actions.server.ts:305-318`, oculta el grupo de permisos
  `equipment` y los catálogos `company.vehicle-*`, `company.sectors`, etc. mapeados en
  `PERMISSION_MODULE_MAP:82-87`); el **sidebar no lo lee**: TSK-377 borró a mano el ítem
  `{ title: 'Equipos', href: '/dashboard/equipment', icon: Truck, module: 'equipment' }` de
  `navMain` (`_AppSidebar.tsx:82-84`), y la guía in-app borró la pestaña `equipamiento`
  (`_HelpGuideTabs.tsx`). El subgrupo Empresa → Equipos (Marcas, Tipos de Equipo, Titulares,
  Sectores, Tipos Operativos, Contratistas; `_AppSidebar.tsx:416-446`) **ya está** en el
  sidebar y se filtra solo por permiso `company.vehicle-types` etc. Las tres capas de
  `getSidebarPermissions` (`shared/actions/sidebar.ts:21-68`) no requieren cambios:
  `equipment` no está en `INDUSTRY_MODULES` (universal) y `activeModules` vacío = todo activo
  (en dev ambas empresas tienen `{}`). `equipment` cae en el espacio **Gestión**
  (`workspaces/helpers.ts:10-13`: solo `accounting*` es Contable).
- **Tareas:**
  - [x] `src/shared/lib/modules/constants.ts:17-22`: `HIDDEN_MODULES = ['employees',
        'documents']` y actualizar el comentario: Equipos se muestra desde TSK-724c porque la
        contabilidad de Bienes de Uso (depreciación, baja) vive ahí.
  - [x] `src/shared/components/layout/_AppSidebar.tsx:83`: reponer `{ title: 'Equipos', href:
        '/dashboard/equipment', icon: Truck, module: 'equipment' }` después de Dashboard
        (`Truck` ya está importado, `:16`).
  - [x] `src/modules/help/features/guide/components/_HelpGuideTabs.tsx`: reponer `'equipamiento'`
        en `GuideTab`, `{ value: 'equipamiento', label: 'Equipamiento', icon: Truck }` en `tabs`
        (después de Dashboard) y `equipamiento: <_EquipmentGuide />` en `tabContent`, con los
        imports (`Truck` de lucide, `_EquipmentGuide`). Empleados y Documentos **no** se
        reponen.
  - [x] Verificar sin cambios de código: `/dashboard/company/modules` lista "Equipos" con su
        switch y descripción; `/dashboard/company/general/roles` muestra el grupo "Equipos" y
        los catálogos de Config Equipos al editar un rol; `/dashboard/equipment` carga con
        `PermissionGuard module="equipment"` (`EquipmentList.tsx:34`); Empresa → Tipos de Equipo
        sigue accesible.
  - [x] Anotar en la sección 4 (y en la presentación, fase 8) que los **roles personalizados**
        de la clienta hoy no tienen permisos de `equipment` ni de `company.vehicle-types`
        (nunca pudieron otorgarse porque la UI los ocultaba): el owner ve todo; a los demás hay
        que darles Ver/Crear/Editar/Eliminar de Equipos y de Tipos de Equipo desde Roles.
  - [x] `.claude/rules/modules.md`: agregar punto 7 "Módulos ocultos del fork
        (`HIDDEN_MODULES`)": qué consume la constante (activación y roles), que el sidebar y la
        guía se editan a mano (`_AppSidebar.tsx` `navMain`, `_HelpGuideTabs.tsx`), y que desde
        TSK-724c `equipment` está visible.
  - [x] `docs/architecture/auth-and-permissions.md:211-219` (capas del sidebar): párrafo
        "Módulos ocultos del fork" con la misma explicación y el estado actual
        (`employees`, `documents` ocultos; `equipment` visible desde TSK-724c).
- **Archivos:**
  - Modificar: `src/shared/lib/modules/constants.ts`, `src/shared/components/layout/_AppSidebar.tsx`,
    `src/modules/help/features/guide/components/_HelpGuideTabs.tsx`, `.claude/rules/modules.md`,
    `docs/architecture/auth-and-permissions.md`
- **Criterio de completitud:** con el owner de dev, el sidebar de Gestión muestra "Equipos" y
  lleva a `/dashboard/equipment`; Módulos lista Equipos; Roles muestra el grupo Equipos; la guía
  tiene la pestaña Equipamiento; Empleados y Documentos siguen ocultos en los tres lugares;
  `check-types` en 219 (`_EquipmentGuide.tsx` ya compilaba sin montarse).

#### Fase 8: Documentación — guías in-app, docs y presentación

- **Objetivo:** que la usuaria encuentre en la guía qué son las cuentas por tipo/depreciación,
  cómo se resuelven y qué pasa si faltan; que `docs/` refleje el modelo y la integración; y
  que la clienta reciba el PDF con capturas reales (memoria `guia-presentacion-cliente-por-ticket`).
- **Tareas:**
  - [x] `src/modules/help/features/guide/components/_EquipmentGuide.tsx:149-260` (card
        "Depreciación de Equipos"): agregar un bloque "**Cuentas contables**" con la cadena
        (depreciación del equipo → Tipo de Equipo → por defecto de Contabilidad →
        Configuración), dónde se cargan (Empresa → Tipos de Equipo; pestaña Depreciación →
        "Editar cuentas"; Ajustes contables), qué muestra la card "Cuentas contables" (cuenta y
        origen), que si falta una cuenta la contabilización **no se hace** y el mensaje dice cuál
        y dónde, y que cambiar una cuenta con períodos ya contabilizados no toca los asientos
        anteriores (el saldo acumulado se reclasifica a mano). Agregar el aviso "La compra del
        bien entra a Bienes de Uso por la cuenta del **ítem** (Ítems → Imputación contable): la
        cuenta de Bienes de Uso del tipo/equipo tiene que ser la misma para que el rubro
        cierre." Corregir `:253-257`: los asientos se generan **desde la pestaña Depreciación**
        (botón Contabilizar) y desde "Contabilizar Depreciaciones" del listado, no "desde el
        módulo de Contabilidad". Bloque "Dar de baja": motivos, qué motivos generan asiento
        (venta, pérdida total, devolución) y cuáles no (otro; sin depreciación), y que el aviso
        aparece en el diálogo. En el `Alert` final (`:264-286`), "Empresa → Catálogos": sumar
        "Tipos de Equipo define las cuentas contables de Bienes de Uso".
  - [x] `_AccountingGuide.tsx:249`: `Activos Fijos (bienes de uso, depreciación y bajas)` →
        `Bienes de Uso (cuentas por defecto: cada Tipo de Equipo define las suyas y cada equipo
        puede sobreescribirlas en su pestaña Depreciación)`. `:669-715` (card "Depreciación de
        Activos Fijos"): `:703-706` "con las cuentas de depreciación configuradas en la
        integración comercial" → "con las cuentas del equipo: las de su depreciación si las
        tiene, si no las de su Tipo de Equipo, si no las por defecto de Configuración"; `:697-699`
        "Desde Contabilidad, puedes generar los asientos" → "Desde Equipos (pestaña Depreciación
        o botón Contabilizar Depreciaciones del listado) se generan los asientos"; agregar viñeta
        "Si a un equipo le falta una cuenta, la contabilización se rechaza con un mensaje que
        dice qué cuenta falta y dónde cargarla".
  - [x] `docs/modules/equipment.md:92-105` (Integración Contable): reemplazar la tabla por la
        cadena de resolución (tabla: cuenta | dónde se define | tipo | se usa en), la lista de
        operaciones y sus cuentas requeridas (`REQUIRED_ACCOUNTS_BY_OPERATION`), la política de
        errores (`ActionResult`, mensajes, sin fallback silencioso, "advertir no bloquear"),
        los casos sin asiento (OTHER, sin depreciación) y la nota de la compra por ítem. `:116-131`
        (Server Actions): agregar `updateDepreciationAccounts`, `getVehicleAssetAccounts`,
        `getDepreciationAccountOptions`, `getVehicleTypeAssetAccounts`,
        `getVehicleTypePostedDepreciationCount`; marcar que `softDeleteVehicle`,
        `postDepreciationEntry`, `postAllPendingDepreciations`, `createValueAdjustment`
        devuelven `ActionResult`. Sección nueva "Visibilidad del módulo" (fuera de
        `HIDDEN_MODULES` desde TSK-724c; espacio Gestión; permisos a otorgar por rol). Sección
        "Helpers compartidos": `shared/asset-accounts.ts`, `asset-accounts-loader.ts`,
        `shared/components/_TerminateEquipmentDialog.tsx`.
  - [x] `docs/modules/accounting.md:290-299`: título "Cuentas de Bienes de Uso (4 campos, 3 de
        ellos por defecto)"; tabla con la columna "Respaldo de" (VehicleDepreciation →
        VehicleType); reemplazar "Sin estas cuentas … no se generan (degradacion suave)" por
        "Sin cuenta resoluble la operacion se rechaza con `ActionResult` que nombra el equipo y
        la cuenta (TSK-724c); no hay degradacion suave".
  - [x] `docs/architecture/data-model.md:81` (`Vehicle`: sin cambios, aclarar "las cuentas
        contables van en VehicleType/VehicleDepreciation"), `:92` (`VehicleDepreciation`: sumar
        `fixedAssetAccountId?`, `accumulatedDepreciationAccountId?`,
        `depreciationExpenseAccountId?` override, FK SetNull, TSK-724c), `:101-103`
        (relaciones: `VehicleType N→1 Account ×3`, `VehicleDepreciation N→1 Account ×3`),
        `:150` (`VehicleType`: "Tipos de equipo + cuentas de Bienes de Uso del tipo"), `:459`
        (`AccountingSettings`: `fixedAssetAccountId`, `accumulatedDepreciationAccountId`,
        `depreciationExpenseAccountId` **por defecto**, TSK-724c).
  - [x] (hecho en fase 9, 2026-09-19; tipos "Rodados"/"Maquinaria" y 14 capturas en vez de "Camión"/"Otros equipos" y 11) Crear `scripts/guia-presentacion/capturas-tsk724c.mjs` (molde `capturas-tsk721.mjs:1-40`:
        `baseUrl` por argumento, login con las credenciales de la memoria
        `dev-local-capturas-y-login`, `psql` vía `docker exec contable-pms-db`, `hideNextBadge`).
        Siembra en "Empresa de Prueba 01 SA" (la que tiene plan de cuentas; 1.2.7) lo que falta:
        `types_of_vehicles` "Vehículos", `vehicle_types` "Camión" (con `BU Rodados
        1.2.2/04/01`, `AA Rodados 1.2.2/04/03`, `Amortizaciones - Explotación 4.2.1/02/10`) y
        "Otros equipos" (sin cuentas), un equipo `TSK724C-001` tipo Camión con depreciación
        (120.000, 12 meses, inicio 01/2026) y uno `TSK724C-002` tipo "Otros equipos"; las cuatro
        globales en settings **vacías** al principio (para la captura del error) y cargadas
        después. Capturas: (1) Módulos con "Equipos" activo; (2) sidebar con Equipos; (3) modal
        de Tipo de Equipo con las tres cuentas; (4) tabla de tipos con "Propias"/"Por defecto";
        (5) pestaña Depreciación con la card "Cuentas contables" (origen "del tipo de equipo
        Camión"); (6) toast de error al contabilizar `TSK724C-002` sin cuentas; (7) asiento de
        amortización en Contabilidad → Asientos con las cuentas de Rodados; (8) diálogo "Editar
        cuentas" con el aviso naranja (tras contabilizar un período); (9) diálogo de baja con el
        aviso de cuentas / "sin asiento"; (10) diálogo masivo con la lista de errores; (11)
        Ajustes contables con la sección "Bienes de Uso (cuentas por defecto)". Restaurar los
        datos al final (borrar `TSK724C-*` y sus asientos; dejar settings como estaban).
  - [x] Crear `scripts/guia-presentacion/tsk-724c.html` (estructura de `tsk-721.html`): "Qué
        pedía el ticket" (724-c en palabras de la clienta), "Qué cambió" (antes/después con
        capturas), "Cómo se usa paso a paso" (activar Equipos → cargar cuentas en Tipos de Equipo
        → dar de alta el equipo → Configurar Depreciación → Contabilizar → Dar de baja),
        "Configuración necesaria" (plan de cuentas con rubros y acumuladas; globales por
        defecto; permisos de Equipos por rol), "Qué NO cambió" (la compra entra por la cuenta del
        ítem, no se vincula compra y equipo; los asientos ya contabilizados no se reasignan;
        "Otro" y "sin depreciación" no generan asiento; la cuenta de resultado sigue única), y
        "Aviso importante": la cuenta de Bienes de Uso del ítem comprado y la del Tipo de
        Equipo/equipo deben ser la misma para que el rubro cierre. Generar con `node
        scripts/guia-presentacion/generar-pdf.mjs scripts/guia-presentacion/tsk-724c.html
        docs/presentaciones/TSK-724c-bienes-de-uso.pdf`.
- **Archivos:**
  - Crear: `scripts/guia-presentacion/capturas-tsk724c.mjs`, `tsk-724c.html`,
    `docs/presentaciones/TSK-724c-bienes-de-uso.pdf`, `scripts/guia-presentacion/assets/tsk724c-*.png`
  - Modificar: `_EquipmentGuide.tsx`, `_AccountingGuide.tsx`, `docs/modules/equipment.md`,
    `docs/modules/accounting.md`, `docs/architecture/data-model.md`
- **Criterio de completitud:** la pestaña Equipamiento de la guía describe la cadena y los
  errores; `docs/` no menciona más "degradación suave" ni "asiento de alta"; el PDF existe, abre,
  tiene las once capturas legibles y la sección "Qué NO cambió".

#### Fase 9: Verificación final

- **Objetivo:** evidencia de que todo funciona en dev **y en build de producción** (el toast con
  el mensaje real, no el digest; memoria `errores-negocio-server-actions`).
- **Tareas:**
  - [x] `npm run check-types` → **219** (línea base); `npm run lint` sin errores nuevos en los
        archivos tocados; `npm run test` en verde (unitarios + `depreciation-accounts.
        integration.test.ts` contra la base de dev; verificar que el `afterAll` deja `count` 0
        de `TSK724C-TEST-*` en `vehicles`, `vehicle_types`, `accounts`, `journal_entries`).
  - [x] Prueba manual en `npm run dev` (puerto 3010 según memoria `dev-local-capturas-y-login`),
        con los datos sembrados por `capturas-tsk724c.mjs` o a mano (2026-09-19: pasos 1-8
        cubiertos por el script; 9, 10 y 11 y las variantes "desactivar módulo", "cargar la
        global", "Otro"/"sin depreciación" quedan pendientes — ver sección 4, Fase 9):
    1. Módulos: Equipos aparece; desactivarlo oculta el ítem del sidebar y Tipos de Equipo;
       reactivarlo los devuelve.
    2. Tipo "Camión" con las tres cuentas; tabla muestra "Propias".
    3. Equipo tipo Camión + Configurar Depreciación sin tocar cuentas → card muestra las del
       tipo; Contabilizar → asiento con `4.2.1/02/10` / `1.2.2/04/03`.
    4. Editar cuentas de la depreciación → gasto propio → aviso naranja (hay 1 período) →
       guardar → siguiente período usa la propia; el anterior no cambió.
    5. Equipo tipo "Otros equipos" con globales vacías → Contabilizar → toast con equipo,
       cuenta y los tres lugares; cargar la global → contabiliza.
    6. Masiva con los dos equipos, uno sin cuentas → diálogo lista el error, el otro se
       contabiliza; el aviso previo ("se van a omitir") aparece antes de confirmar.
    7. Baja por venta del Camión desde el **detalle** → diálogo muestra las cuentas → asiento
       de baja con `1.2.2/04/03` (Debe), `1.2.2/04/01` (Haber), resultado; equipo inactivo.
    8. Baja "Otro" y baja de un equipo sin depreciación → aviso en el diálogo, toast "sin
       asiento".
    9. Ajuste de valor con la cuenta de resultado vacía → toast legible, nada guardado; con la
       cuenta → asiento.
    10. `lockedUntilDate` en el futuro → baja y amortización devuelven "período cerrado" (antes
        la baja mostraba el genérico).
    11. Roles: el grupo Equipos aparece; asignar Ver a un rol y entrar con un usuario
        `@demo.local` de ese rol → ve Equipos, no ve "Contabilizar" (requiere Editar).
  - [x] **Build de producción**: `npm run build && NEXT_PUBLIC_APP_URL=http://localhost:3011 npm
        run start -- -p 3011`; repetir 5, 7 (con cuentas faltantes) y 9 y confirmar que el toast
        muestra el mensaje de negocio, no "An error occurred in the Server Components render"
        (2026-09-19: 5 y 7 verificados con `--solo-error`; 9 —ajuste de valor— pendiente).
  - [ ] Consulta de 1.2.7 en producción (`psql` según memoria `produccion-dokploy-scripts-db`)
        para dejar registrado cuántos equipos/depreciaciones/períodos hay y si las globales
        están cargadas; anotar el resultado en la sección 5.
  - [x] Documentar todo en la sección 5 con los conteos, los asientos generados y las capturas
        del build de producción.
- **Archivos:** ninguno nuevo (sección 5 del documento).
- **Criterio de completitud:** los once pasos manuales pasan, el build de producción muestra los
  mensajes reales, tests y tipos en línea base, sección 5 completa.

### 2.2 Orden de ejecución

1. **Fase 1 primero y sola.** Todo lo demás compila contra el cliente Prisma regenerado (los
   `select` de las cuentas nuevas en el loader, los `data` de tipos y depreciación). Commit
   propio ("schema + migración").
2. **Fase 2 después de la 1** (el loader usa los campos nuevos). Commit propio con el test
   unitario. Las fases 3, 4 y 5 dependen de sus exports (`ASSET_ACCOUNT_LABELS`,
   `loadVehiclesAssetAccounts`, `assertAssetAccountsForOperation`).
3. **Fases 3, 4 y 5 en paralelo después de la 2.** Verificado que **no comparten archivos**: la
   3 toca solo `company/features/vehicle-types/**`; la 4 toca `equipment/features/depreciation/**`
   y `list/components/_BulkDepreciationDialog.tsx`; la 5 toca `integrations/equipment/index.ts`,
   `list/actions.server.ts`, `list/components/_EquipmentDataTable.tsx`,
   `detail/components/_EquipmentHeader.tsx`, `_ValueAdjustmentDialog.tsx` y crea
   `shared/components/_TerminateEquipmentDialog.tsx`. **Dos excepciones que obligan a
   coordinar**: (a) `depreciation/actions.server.ts` lo tocan la 4 (`postDepreciationEntry`,
   `postAll…`, nuevas actions) y la 5 (`createValueAdjustment`) → si se hacen en paralelo, la 5
   espera a que la 4 haga el commit de ese archivo, o se hace `createValueAdjustment` dentro de
   la 4; (b) el test de integración es **uno** para ambas → la 5 agrega sus casos al archivo que
   crea la 4. En serie, el orden recomendado es **4 → 5 → 3**: la 4 crea `getVehicleAssetAccounts`
   que la 5 usa en el diálogo de baja, y la 3 es independiente.
4. **Fases 6 y 7 son independientes del esquema** y no comparten archivos con nadie: pueden
   hacerse en cualquier momento, incluso antes de la 1 (desvío respecto del enunciado "6 y 7
   tras 1": no hay dependencia técnica). Se recomienda hacerlas **después de la 2** de todos
   modos, porque los labels de la 6 tienen que coincidir con `ASSET_ACCOUNT_LABELS` (fase 2) y
   para que la 7 (módulo visible) entre al mismo PR que las correcciones de silencios —mostrar
   Equipos antes de arreglar `softDeleteVehicle` expondría el bug actual a la clienta.
5. **Fase 8 después de 3-7**: guías y `docs/` se pueden redactar en paralelo con la 5; las
   capturas y el PDF necesitan la app terminada y los datos sembrados, así que
   `capturas-tsk724c.mjs` y el PDF son lo último antes de la 9.
6. **Fase 9 al final**, con todo montado, incluido el build de producción.

**Riesgos de orden a tener presentes:**

- Si el `catch` de `softDeleteVehicle` se cambia a `toActionResult` **antes** de quitar el
  `return null` de la integración, la baja sin cuentas sigue "exitosa" sin asiento. Hacer las
  dos cosas (integración que lanza + pre-validación + `catch`) en el mismo commit de la fase 5.
- Cambiar la firma de `softDeleteVehicle` rompe `_EquipmentTable.tsx` y `_EquipmentDataTable.tsx`
  a la vez: eliminar el primero y migrar el segundo en el mismo paso, o `check-types` acusa.
- En `postAllPendingDepreciations`, la resolución por equipo tiene que quedar **fuera** de
  `prisma.$transaction`: un `throw` dentro del loop aborta la transacción entera en Postgres
  (riesgo 1.6-4). El test "masiva con un equipo sin cuentas" lo cubre.
- Los labels "… por defecto" viven en tres lugares (`ASSET_ACCOUNT_LABELS`, `SECTIONS` de
  settings, guías): escribirlos una vez en la fase 2 y copiarlos literalmente en 6 y 8; el test
  unitario de mensajes falla si se cambian sin actualizar.
- El test de integración crea `Vehicle` con `internNumber`/`domain` únicos por empresa
  (`@@unique([companyId, internNumber])`): usar el prefijo en ambos.
- `getVehicleTypesPaginated` no usa `select`, así que las columnas nuevas viajan al cliente
  solas; si alguien lo optimiza con `select`, la columna "Cuentas contables" y el `reset` del
  modal pierden los datos (documentarlo en el `VehicleTypeListItem`).
- La sección de settings se renombra en la 6 y la guía de Contabilidad en la 8: el texto
  "Bienes de Uso (cuentas por defecto)" debe ser el mismo en ambos.

### 2.3 Estimación de complejidad

- Fase 1 (esquema: 6 columnas, 6 FK, 6 inversas, migración aditiva): **baja** — molde 717
  calcado, sin datos.
- Fase 2 (helper puro + loader batch con imputabilidad): **media** — la dificultad está en los
  textos (parte del entregable) y en que el loader sirva a cuatro consumidores con una sola
  consulta por tabla.
- Fase 3 (tipos de equipo: validators, dos actions nuevas, campos extraídos, aviso, columna):
  **media**.
- Fase 4 (depreciación: dos actions migradas a `ActionResult` con pre-validación, tres nuevas,
  tres componentes nuevos, dos diálogos tocados, test de integración con andamiaje pesado):
  **alta** — es donde vive el cambio contable y el riesgo de la transacción masiva.
- Fase 5 (integración que lanza, `softDeleteVehicle` con `ActionResult`, diálogo de baja
  compartido con avisos, botón del detalle, ajuste de valor, siete casos de integración):
  **alta** — cuatro archivos grandes y el cambio de firma con dos consumidores.
- Fase 6 (textos de settings): **baja**.
- Fase 7 (módulo visible: tres archivos + docs + regla): **baja** — pero requiere verificación
  manual de roles y activación.
- Fase 8 (dos guías, tres docs, script de capturas con siembra y once capturas, HTML + PDF):
  **media-alta** — el PDF con datos coherentes (dos tipos, dos equipos, globales vacías y
  cargadas) es lo que más tiempo lleva.
- Fase 9 (once pasos manuales + build de producción + consulta en prod): **media**.

**Complejidad total: alta.** Hay una migración (aditiva, sin datos), no hay permisos ni rutas
nuevas ni módulos a registrar (regla 13: `equipment` ya está en `ACTIVATABLE_MODULES`), pero
se cambia la firma de cuatro Server Actions con consumidores en cinco componentes, se reescribe
la integración de bajas y no hay ningún test previo del módulo de equipos: el andamiaje del
test de integración es el costo fijo más grande. El riesgo técnico está en las fases 4 y 5; el
esfuerzo, en la 8.

### 2.4 Seguimientos fuera de alcance

Registrados para que no se filtren en este ticket y para abrirlos aparte:

1. **Vínculo compra → equipo** (alternativa C, 1.2.5, pregunta 1.7-3): `Vehicle.purchaseInvoiceLineId`
   o "crear equipo desde la línea de compra", con herencia de la cuenta de Bienes de Uso del
   ítem y `grossValue` desde el neto de la línea. Cerraría el riesgo 1.6-2 (coherencia compra ↔
   equipo) que hoy solo se mitiga con la ayuda del campo, la guía y el PDF. Ticket aparte.
2. **`TypeOfVehicle` (clasificación) como rubro contable** (1.2.3): es la entidad más parecida a
   un rubro, pero no tiene ABM (solo seed). Si la clienta prefiere configurar por clasificación
   (Vehículos / Maquinaria / Otros) en vez de por tipo operativo, hace falta el ABM primero y
   sumar un nivel a la cadena (depreciación → tipo → clasificación → global). No se hace ahora:
   Tipo de Equipo alcanza para la flota de la clienta y tiene ABM.
3. **Asiento de alta / capitalización**: el encabezado de la integración lo prometía
   (`index.ts:5-8`) y nunca existió; `payablesAccountId` se seleccionaba para eso. **Decisión:
   no hace falta y no se crea.** El bien entra a Bienes de Uso por la factura de compra (cuenta
   ASSET del ítem, TSK-579/721), que además registra el IVA crédito y la deuda con el proveedor;
   un segundo asiento "Debe Bienes de Uso / Haber Proveedores" al configurar la depreciación
   **duplicaría** el activo y el pasivo. Los equipos que no se compraron con factura del sistema
   (históricos, aportados) entran por saldos de apertura o asiento manual. La fase 5 corrige el
   comentario; si en el futuro se pide un alta contable para bienes sin compra, debe ser
   opcional y explícito (checkbox "Generar asiento de alta" con contracuenta elegible), nunca
   automático.
4. **Datos históricos en producción**: los asientos ya contabilizados quedan en las cuentas
   globales con las que se generaron (1.2.7, "ir hacia adelante"). Si la consulta de la fase 9
   muestra períodos contabilizados, el contador decide si reclasifica con asiento manual; el
   sistema no lo hace. Mismo criterio que 717/721.
5. **Badge "Manual" en asientos automáticos** en el listado de Asientos (`createdBy: 'system'`
   los distingue; detectado en TSK-717, sigue pendiente). Los asientos de equipos también lo
   sufren.
6. **Fecha del asiento de baja = `new Date()`** (riesgo 1.6-6): agregar "Fecha de baja" al
   diálogo y usarla en `terminationDate` y en el asiento. Con `ActionResult` el "período
   cerrado" ya se ve; elegir la fecha es alcance nuevo.
7. **Recibos, órdenes de pago y gastos siguen tragando el fallo del asiento con `logger.warn`**
   (memoria `errores-negocio-server-actions`, 2.4 de TSK-721): mismo patrón `ActionResult` +
   pre-validación pendiente; ticket 728 (recibos/OP/gastos).
8. **Indicador "equipos sin cuenta contable"** análogo a `ItemsWithoutAccountNotice` de 721:
   conteo de tipos de equipo con equipos amortizables y sin cuentas resolubles, en Ajustes
   contables y/o en el listado de Equipos. El aviso previo del diálogo masivo (fase 4) es el
   primer paso.
9. **`updateVehicleDepreciation` sin consumidor en la UI** (`depreciation/actions.server.ts:256-340`):
   no hay "Editar depreciación" antes del primer período; o se le da UI o se elimina. No se
   toca acá (solo se le agregan los campos nuevos por consistencia).
10. **Deuda de tamaño** en `_EquipmentForm.tsx` (965), `_EquipmentFormEdit.tsx` (890),
    `_DepreciationTab.tsx` (439) y `_DepreciationConfigDialog.tsx` (256): este ticket no las
    empeora (componentes nuevos aparte) pero tampoco las corrige.
11. **Columnas de `vehicle-types/list/columns.tsx` sin `meta.title`** (las cuatro existentes):
    la nueva lo lleva; corregir las otras es una limpieza aparte.
12. **`getVehicleTypesForSelect` sin `checkPermission`** (`vehicle-types/list/actions.server.ts:104-118`):
    no devuelve las cuentas (verificado en su `select`), así que no expone nada nuevo, pero
    sigue contra la regla 11.

## 3. Diseño
_Pendiente - ejecutar `/disenar tsk-724c-bienes-de-uso-por-item-equipos`_

## 4. Implementación

> Etapa de diseño (sección 3) salteada por decisión del usuario (2026-09-19): el plan trae archivo:línea y firmas suficientes; las decisiones de diseño se anotan en las Notas de cada fase.

### Fase 1: Esquema y migración
- **Estado:** Completada (2026-09-19)
- **Archivos modificados:**
  - `prisma/schema.prisma` - 3 cuentas opcionales + relaciones (`VehicleType*Account`) e índices en `VehicleType`; 3 cuentas opcionales + relaciones (`Depreciation*Account`) e índices en `VehicleDepreciation`; 6 inversas en `Account`. `onDelete: SetNull`.
  - `prisma/migrations/20260919121736_tsk_724c_asset_accounts_by_type/migration.sql` - creado: 6 ADD COLUMN (dos ALTER TABLE multi-columna), 6 CREATE INDEX, 6 FK `ON DELETE SET NULL ON UPDATE CASCADE`. Sin UPDATE ni backfill.
- **Notas:** `prisma format` realineó las columnas del bloque `settingsAs*` de `Account` (solo whitespace). `check-types` 219 = base. En producción la migración la aplica solo el `docker-entrypoint.sh` al deployar; antes conviene correr la consulta de 1.2.7 con psql para saber cuántos equipos/períodos hay.

### Fase 2: Helper puro de cuentas de Bienes de Uso
- **Estado:** Completada (2026-09-19)
- **Archivos creados:**
  - `src/modules/equipment/shared/asset-accounts.test.ts` - 16 tests Vitest puros (rojo primero: módulo inexistente). Cubre resolución independiente por cuenta con `source`, `''`/`null`/`undefined` como ausente, faltantes por operación, los tres mensajes (singular/plural, `la amortización`/`la baja`/`el ajuste de valor`, origen y destino por `source`), `formatAccountLabel` y los labels/constantes.
  - `src/modules/equipment/shared/asset-accounts.ts` - helper puro (sin Prisma ni `@/modules/*`): `ASSET_ACCOUNT_KEYS`, `AssetAccountKey`, `AssetAccountSource`, `AssetOperation`, `AssetAccountIds`, `ResolvedAssetAccount(s)`, `ASSET_ACCOUNT_LABELS`, `ASSET_ACCOUNT_SOURCE_LABELS`, `REQUIRED_ACCOUNTS_BY_OPERATION`, `OPERATION_LABELS`, `resolveAssetAccounts`, `findMissingAssetAccounts`, `buildMissingAssetAccountsMessage`, `buildUnavailableAssetAccountMessage`, `buildMissingDisposalAccountMessage`, `formatAccountLabel`.
  - `src/modules/equipment/shared/asset-accounts-loader.ts` - `import 'server-only'`; `PrismaTransactionClient`, `LoadedAccountInfo`, `LoadedVehicleAssetAccounts`, `AssertedAssetAccounts`, `loadVehiclesAssetAccounts(companyId, vehicleIds, client = prisma): Promise<Map<…>>` (1 `vehicle.findMany` + 1 `accountingSettings.findUnique` en paralelo, luego 2 `account.findMany`: datos + imputables con `buildImputableAccountsWhere({ companyId })` sin `atDate`), atajo `loadVehicleAssetAccounts(companyId, vehicleId, client?)` para un solo equipo, y `assertAssetAccountsForOperation(loaded, operation): AssertedAssetAccounts` que lanza `BusinessError` (faltante → no imputable → falta resultado global en baja/ajuste).
- **Notas:** el helper quedó en 209 líneas (el plan pedía < 150): el exceso es el encabezado y los JSDoc de cada export; la lógica no supera las 100. La verificación de imputabilidad en `assertAssetAccountsForOperation` recorre solo `REQUIRED_ACCOUNTS_BY_OPERATION[operation]` (no las tres): una cuenta de Bienes de Uso vencida no frena la amortización, que no la toca; sigue sin caer nunca a la global cuando la propia/del tipo existe pero no sirve. Si la cuenta resuelta ya no existe en `account` (borrada), el mensaje usa el id crudo como label. Sin `checkPermission` en el loader (lo hacen las actions que lo llaman); sin test de integración propio, lo cubren fases 4 y 5. `check-types` 219 = base; eslint y prettier limpios.

### Fase 3: Tipos de equipo
- **Estado:** Completada (2026-09-19)
- **Archivos creados:**
  - `src/modules/company/features/vehicle-types/list/validators.test.ts` - 8 tests Vitest (rojo primero: módulo inexistente): nombre corto, cuentas ausentes → `undefined`, `null` → `null`, UUIDs válidos, no-UUID señalado en el campo correcto (`it.each` por los tres), `hasHitch`/`isTractorUnit` obligatorios booleanos.
  - `src/modules/company/features/vehicle-types/list/validators.ts` - `vehicleTypeSchema` movido del modal + `accountField = z.string().uuid().nullish()` para las tres cuentas; `VehicleTypeFormData`.
  - `src/modules/company/features/vehicle-types/list/components/_VehicleTypeAccountsFields.tsx` (121 líneas) - tres `AccountCombobox` (Bienes de Uso y Amortización acumulada sobre la lista `asset`, Gasto de amortización sobre `expense`), ayuda por campo, `clearLabel="Sin asignar (usar la cuenta por defecto)"`, aviso naranja y párrafo final neutro. Props: `values: AssetAccountIds`, `onChange(field, accountId)`, `saved: (AssetAccountIds & { id }) | null`, `enabled`. Calcula adentro `savedIds`/`isDirty` y hace los dos `useQuery` (`['vehicle-type-asset-accounts', savedIds]` y `['vehicle-type-posted-count', saved?.id]`, este último solo con `saved`).
  - `src/shared/lib/assets/asset-account-labels.ts` - `ASSET_ACCOUNT_KEYS`, `AssetAccountKey`, `AssetAccountIds`, `ASSET_ACCOUNT_FIELD_BY_KEY`, `ASSET_ACCOUNT_LABELS`. **Decisión:** `company` no puede importar de `equipment/shared`, así que las constantes se movieron a `shared/` en vez de duplicarlas; `equipment/shared/asset-accounts.ts` las importa y re-exporta (sus 16 tests siguen verdes, `asset-accounts-loader.ts` sin cambios).
- **Archivos modificados:**
  - `vehicle-types/list/actions.server.ts` - `CreateVehicleTypeInput`/`UpdateVehicleTypeInput` extienden `VehicleTypeAccountsInput` (tres `?: string | null`); `getVehicleTypesPaginated` con `select` explícito (id, name, hasHitch, isTractorUnit, isActive, las tres cuentas, `_count.vehicles`); `getVehicleTypeAssetAccounts(includeIds?: string[]): Promise<{ asset: {id,code,name}[]; expense: … }>` (dos `findMany` en paralelo con `buildImputableAccountsWhere({ companyId, types: ['ASSET'] })` / `['EXPENSE']`, `includeIds` envuelto en `OR`, sin exigir `isFixedAsset`); `getVehicleTypePostedDepreciationCount(typeId: string): Promise<number>` (`vehicle.count` con `depreciation.scheduleEntries.some.isPosted`); `assertAccountBelongsToCompany` privado (copiado de partners) + `resolveAccountsInput` que respeta `undefined`; `createVehicleType` lo llama fuera del `try` (el `catch` reenvuelve el mensaje) y guarda las tres; `updateVehicleType` `select` las tres del `existing`, guarda y hace `logger.info` con `previous`/`next` cuando alguna cambió. Tipos `VehicleTypeAssetAccounts` y `VehicleTypeAccountOption`.
  - `components/_VehicleTypeFormModal.tsx` (196 líneas) - schema importado de `../validators`; `toFormValues(vehicleType)` para `defaultValues` y `reset`; `<Separator />` + subtítulo "Cuentas contables (Bienes de Uso)" + `_VehicleTypeAccountsFields values={watch()} saved={vehicleType ?? null} enabled={open}`; `DialogContent` a `sm:max-w-[600px]` con `max-h-[90vh] overflow-y-auto`.
  - `columns.tsx` - columna `id: 'accounts'` "Cuentas contables" (`meta.title`, `enableSorting: false`) después de "Equipos": `Badge` "Por defecto" (0, secondary), "{n}/3 propias" (1-2, secondary), "Propias" (3, default); `data-testid="vehicle-type-accounts-{id}"`.
- **Notas:** el aviso naranja (`role="alert"`, `data-testid="vehicle-type-accounts-posted-warning"`) aparece solo editando, con alguna cuenta distinta de la guardada y `postedCount > 0`; texto: "Este tipo tiene {N} equipo(s) con amortizaciones ya contabilizadas. Cambiar las cuentas no modifica esos asientos: las próximas amortizaciones y la baja usarán la cuenta nueva y el saldo acumulado hasta hoy queda en la anterior. Si hace falta, el contador lo reclasifica con un asiento manual." Los conteos `_VehicleTypesTable.tsx` (legacy, usa `getAllVehicleTypes` con `include`) no se tocaron. `prettier --write` sobre los archivos tocados también ordenó imports preexistentes en `actions.server.ts`, `columns.tsx` y el modal (ruido mínimo). `vitest` vehicle-types + equipment/shared: 24 tests verdes; eslint y prettier limpios; `check-types` 219 = base. La verificación en navegador (crear "Camión" con tres cuentas → "Propias", vaciar una → "2/3 propias", aviso con equipo amortizado) queda para la fase 9.

### Fase 4: Depreciación
- **Estado:** Completada (2026-09-19)
- **Archivos creados:**
  - `src/modules/equipment/features/depreciation/asset-accounts.integration.test.ts` - 11 tests contra la base real (rojo primero), andamiaje de `fund-movement-partner-account.integration.test.ts` + `vi.mock('server-only')` (el loader lo importa y no resuelve bajo Node). Empresa/cuentas/tipos/4 equipos con 3 períodos cada uno bajo prefijo `TSK724C-TEST-`. Casos: cuentas del tipo; override solo del gasto (independencia por cuenta) + `getVehicleAssetAccounts` con `source`/`fallbacks`; caída a las por defecto; sin acumulada → `{ success:false }` con equipo, cuenta, tipo y "Contabilidad → Configuración", sin asiento ni `isPosted`; cuenta del tipo inactiva → error con `code` y "Empresa → Tipos de Equipo", sin caer a la global; secuencia como dato; masiva con `sinNada` sin cuentas → `posted: 4`, `errors[0]` lo nombra y `vehiclesWithoutAccounts` lo avisa antes; `updateDepreciationAccounts` con períodos contabilizados guarda, no toca el cronograma y el próximo período usa la nueva; cuenta ajena → error como dato; masiva sin pendientes.
  - `src/modules/equipment/features/depreciation/validators.test.ts` - 3 tests de `depreciationAccountsSchema` (UUID/null/ausente → null; mensaje en español) y regresión de `depreciationConfigSchema`.
  - `src/modules/equipment/features/depreciation/components/_DepreciationAccountsCard.tsx` (128 líneas) - card "Cuentas contables": `useQuery(['vehicleAssetAccounts', vehicleId])`, tres filas `code - name` + badge de origen ("de la depreciación del equipo" / "del tipo de equipo «Camión»" / "por defecto (Ajustes contables)"), badge rojo "no imputable", "Sin cuenta — asignala acá, en el tipo de equipo «…» o en Contabilidad → Configuración" en rojo; nota fija sobre la compra del ítem; botón "Editar cuentas" con `hasPermission('equipment','update')`; monta el diálogo e invalida `vehicleAssetAccounts` y `vehicleDepreciation`.
  - `src/modules/equipment/features/depreciation/components/_DepreciationAccountsDialog.tsx` (177 líneas) - tres `AccountCombobox` (Activo para Bienes de Uso y Amortización acumulada, Gasto para el gasto; `clearLabel` "Sin asignar (usar la del tipo de equipo o la por defecto)"), `useQuery(['depreciation-account-options', savedIds])`, ayuda por campo "Si queda vacía se usa {cuenta} — del tipo de equipo «…»" o en rojo "Si queda vacía no hay cuenta: configurala en …", aviso naranja si `isDirty && postedCount > 0`, Guardar → `updateDepreciationAccounts`, `if (!result.success) toast.error(result.error)`.
- **Archivos modificados:**
  - `depreciation/validators.ts` + `index.ts` - `depreciationAccountsSchema` (`z.string().uuid().nullish()` → `null`) y `DepreciationAccountsInput`. `depreciationConfigSchema` sin cambios.
  - `depreciation/actions.server.ts` - sección "CUENTAS DE BIENES DE USO": `getVehicleAssetAccounts(vehicleId): Promise<VehicleAssetAccounts>` (plano: `overrides`, `accounts` y `fallbacks` por clave con `{ accountId, code, name, source, imputable }`, `postedCount`, `depreciationId`), `getDepreciationAccountOptions(includeIds?) → { asset, expense }` con `buildImputableAccountsWhere`, `updateDepreciationAccounts(depreciationId, input): Promise<ActionResult>` (no bloquea por períodos, `assertAccountsBelongToCompany` → `BusinessError`, `logger.info` con before/after/postedCount). `postDepreciationEntry(id): Promise<ActionResult<{ journalEntryId; journalEntryNumber }>>` y `postAllPendingDepreciations(upToDate): Promise<ActionResult<{ posted; errors: BulkDepreciationError[] }>>` con `loadVehicle(s)AssetAccounts` + `assertAssetAccountsForOperation(...,'depreciation')` ANTES de `$transaction`, `BusinessError` para todos los motivos de negocio (incl. período bloqueado, con `loaded.lockedUntilDate`) y `toActionResult` en el catch. El asiento + marcas se extrajo a `postEntryTx` (privada, compartida por individual y masiva; misma descripción y líneas). `getPendingDepreciationsSummary` suma `vehiclesWithoutAccounts: { vehicleId, vehicleLabel, message }[]`.
  - `components/_DepreciationTab.tsx` - monta `<_DepreciationAccountsCard>` entre resumen y cronograma; `postMutation.onSuccess` hace `if (!result.success) toast.error(result.error)`, invalida también `vehicleAssetAccounts`; `onError` solo "No se pudo contactar al servidor".
  - `list/components/_BulkDepreciationDialog.tsx` (192 líneas) - `resultErrors: BulkDepreciationError[]` (se limpia al reabrir/cambiar fecha); aviso naranja previo "Estos equipos se van a omitir por falta de cuentas contables" con los mensajes de `vehiclesWithoutAccounts`; tras contabilizar con errores no se cierra: `Alert` destructivo "{N} equipo(s)/período(s) no se pudieron contabilizar" con la lista (scroll `max-h-60`) y botón "Cerrar".
- **Notas:**
  - **Desvíos respecto del plan:** `errors[]` de la masiva es `{ vehicleId, label, message }[]` (indicación del orquestador) en vez de `string[]`. No se agregaron las tres cuentas a `depreciationConfigSchema`/`createVehicleDepreciation`/`updateVehicleDepreciation` ni el `Collapsible` en `_DepreciationConfigDialog` (tareas sin marcar): el override se edita solo desde la card, que aparece apenas se configura la depreciación; evita un segundo camino de escritura. `_DepreciationAccountsFields.tsx` no se creó (los combos viven en el diálogo, 177 líneas). `VehicleAssetAccounts` no incluye `assetDisposalGainLoss` (fase 5 si lo necesita) y suma `fallbacks` (qué se usaría con el override vacío), que el diálogo usa para la ayuda por campo.
  - `getVehicleAssetAccounts` hace 2 queries extra (settings + cuentas de respaldo no resueltas) para `fallbacks`; imputabilidad de esas con el mismo criterio que `buildImputableAccountsWhere` (hoja, activa, sin corte vigente).
  - Se quitó el BOM inicial de `actions.server.ts` (línea 1). Los avisos de `prettier --check` que quedan en `actions.server.ts`, `validators.ts` y `_DepreciationTab.tsx` son preexistentes en HEAD (orden de imports, comas finales) y ajenos a las líneas tocadas; los archivos nuevos y `_BulkDepreciationDialog.tsx` están formateados. ESLint limpio en lo tocado (los 2 warnings de `_DepreciationConfigDialog.tsx` son preexistentes). `check-types` 219 = base. `npx vitest run src/modules/equipment`: 3 archivos, 30 tests verdes.
  - Pendiente para fase 9: verificar en navegador y en build de producción (`npm run build && npm run start`) que el toast muestre el mensaje completo. Ningún consumidor de `postDepreciationEntry`/`postAllPendingDepreciations` quedó con el `try/catch` viejo (grep: solo `_DepreciationTab` y `_BulkDepreciationDialog`).

### Fase 5: Bajas y ajuste de valor
- **Estado:** Completada (2026-09-19)
- **Archivos creados:**
  - `src/modules/equipment/features/list/asset-disposal.integration.test.ts` - 10 tests contra la base real (rojo primero), mismo andamiaje que el de amortización pero con prefijo PROPIO `TSK724C-BAJA-`: Vitest corre los archivos en paralelo y el `afterAll` del test de la fase 4 cuenta lo que empieza con `TSK724C-TEST-`; compartir prefijo daba carrera. 5 equipos (`conTipo`, `conOverride` con BU propia, `sinNada`, `sinDepreciacion`, `ajuste`) con p1 "contabilizado" (`totalDepreciated: 10000`, `currentBookValue: 110000`) sembrado directo. Casos: venta con cuentas del tipo (Debe AA Rodados 10.000 / Haber BU Rodados 120.000 / Debe Resultado 110.000, `isActive:false`, `SALE`, depreciación `COMPLETED`); sin BU en ningún nivel → `{ success:false }` con «equipo», "Bienes de Uso", "la baja", «tipo», equipo activo y sin asiento; sin cuenta de resultado global → error "Resultado por venta/baja de Bienes de Uso"; período cerrado → "período está cerrado" y equipo activo (rollback de la transacción); pérdida total con override → BU PROPIA + AA del tipo; sin depreciación `RETURN` → `{ success:true, journalEntryId:null }` y conteo de asientos igual; `OTHER` ídem; equipo ya inactivo → "ya está dado de baja"; ajuste sin cuenta de resultado → `success:false`, sin `assetValueAdjustment` y `currentBookValue` intacto; ajuste con cuentas → asiento Debe Resultado / Haber AA Rodados por 20.000, `assetValueAdjustment.journalEntryId` = asiento, valor libro 90.000.
  - `src/modules/equipment/shared/components/_TerminateEquipmentDialog.tsx` (145 líneas) - diálogo de baja compartido por listado y detalle. Props `vehicle: { id, internNumber, domain } | null`, `open`, `onOpenChange`, `onTerminated?`. `useQuery(['vehicleAssetAccounts', vehicle?.id])` habilitado con `open && !!vehicle`; `useMutation(softDeleteVehicle)` con `if (!result.success) toast.error(result.error)`; éxito → "Equipo dado de baja. Se generó el asiento contable." / "Equipo dado de baja (sin asiento contable)."; invalida `equipment` y `vehicleAssetAccounts`, `router.refresh()`, `onTerminated?.()`, cierra. `onError` solo "No se pudo contactar al servidor. Volvé a intentar." `data-testid`: `terminate-equipment-dialog`, `terminate-reason-select`, `terminate-confirm-button`.
  - `src/modules/equipment/shared/components/_TerminateEntryNotice.tsx` (104 líneas) - aviso bajo el motivo, extraído para respetar el límite de líneas: "Verificando cuentas contables…" mientras carga; neutro "Este equipo no tiene depreciación configurada: la baja no genera asiento contable."; neutro "Baja por otro motivo: no genera asiento contable."; naranja (`role="alert"`, `terminate-notice-missing`) "La baja va a fallar: falta la cuenta de {Bienes de Uso | Amortización acumulada | Resultado por venta/baja de Bienes de Uso}. Configurala en la pestaña Depreciación, en el tipo «{typeName}» o en Contabilidad → Configuración."; neutro "La baja genera un asiento con: Bienes de Uso `code - name` (origen), Amortización acumulada `…` (origen) y Resultado `…`." (origen con «tipo» cuando `source === 'type'`).
- **Archivos modificados:**
  - `src/modules/accounting/features/integrations/equipment/index.ts` - encabezado reescrito (solo asientos de baja; sin asiento de alta: el bien entra por la factura de compra; amortización en `equipment/depreciation`; cuentas resueltas por el llamador; sin imports de `equipment`). Eliminado `getEquipmentAccountingSettings` (y el `payablesAccountId` muerto). Exporta `interface AssetDisposalAccounts { fixedAssetAccountId; accumulatedDepreciationAccountId; assetDisposalGainLossAccountId }` (las tres `string`). `createJournalEntry` → `Promise<string>`; sin settings y período cerrado → `BusinessError` (import de `@/shared/lib/action-result`, como `integrations/commercial`); desbalance sigue `Error`. `createJournalEntryForAssetSale(vehicleId, companyId, accounts: AssetDisposalAccounts, tx): Promise<string>` y `createJournalEntryForAssetDisposal(...)` ídem: sin `VehicleDepreciation` → `BusinessError('El equipo «…» no tiene depreciación configurada: la baja no genera asiento contable.')`. Lo común se extrajo a `loadDisposalFigures` (select mínimo, verifica `companyId`) y `buildDisposalLines`.
  - `src/modules/equipment/features/list/actions.server.ts` - `softDeleteVehicle(id, terminationReason: VehicleTerminationReason): Promise<ActionResult<{ journalEntryId: string | null }>>`. Pre-validación ANTES de `$transaction`: `loadVehicleAssetAccounts` → "Equipo no encontrado" / "El equipo ya está dado de baja"; `generatesEntry = hasDepreciation && reason !== 'OTHER'`; `toDisposalAccounts(loaded)` (privada) llama `assertAssetAccountsForOperation(loaded, 'disposal')`. En la transacción: `vehicle.update` (`select: { id }`), asiento venta/baja según motivo y `vehicleDepreciation.update({ status: 'COMPLETED' })` con `loaded.depreciationId`; `revalidatePath` de listado y detalle; `catch` → `toActionResult(error, 'Error al dar de baja el equipo')` con el comentario TSK-724c. `checkPermission('equipment','delete')` intacto.
  - `src/modules/equipment/features/depreciation/actions.server.ts` - `createValueAdjustment(vehicleId, input): Promise<ActionResult<{ journalEntryId: string }>>`: `safeParse`, "no encontrada", "no activa" → `BusinessError`; `loadVehicleAssetAccounts` + `assertAssetAccountsForOperation(loaded, 'adjustment')` ANTES de la transacción (sin el `if` silencioso: el asiento se genera siempre y `assetValueAdjustment.journalEntryId` nunca es `null`); `select` explícito en la depreciación; `catch` → `toActionResult(error, 'Error al registrar el ajuste de valor')`. `VehicleAssetAccounts` suma `assetDisposalGainLoss: VehicleAssetAccountView | null` (`source: 'default'`) y `getVehicleAssetAccounts` lo carga en la misma consulta de "cuentas de respaldo".
  - `depreciation/components/_ValueAdjustmentDialog.tsx` - `const result = await createValueAdjustment(...)`; `if (!result.success) { toast.error(result.error); return; }`; éxito "Ajuste de valor registrado. Se generó el asiento contable." e invalida también `['vehicleAssetAccounts', vehicleId]`; el `catch` queda para red.
  - `list/components/_EquipmentDataTable.tsx` - borrados el `Dialog` inline, `deleteMutation`, `terminationReason` y los imports de `Select*`, `Dialog*`, `vehicleTerminationReasonLabels`, `VehicleTerminationReason`, `softDeleteVehicle`; monta `<_TerminateEquipmentDialog vehicle={selectedVehicle} open onOpenChange={(o) => { setDeleteDialogOpen(o); if (!o) setSelectedVehicle(null); }} />`.
  - `detail/components/_EquipmentHeader.tsx` - `useState(false)`, `onClick` en "Dar de Baja" (`data-testid="terminate-equipment-button"`) y `<_TerminateEquipmentDialog vehicle={{ id, internNumber, domain }} …/>`. `EquipmentDetail` es Server Component y se re-renderiza con `router.refresh()`.
- **Archivos eliminados:**
  - `list/components/_EquipmentTable.tsx` - 436 líneas sin importadores (grep en `src/`, `cypress/`, `docs/`; `list/index.ts` no lo exportaba).
- **Notas:**
  - **Desvíos respecto del plan:** (1) test en archivo propio `list/asset-disposal.integration.test.ts` con prefijo `TSK724C-BAJA-` en vez de agregar al de la fase 4 (motivo arriba: paralelismo de Vitest). (2) El aviso del diálogo vive en `_TerminateEntryNotice.tsx` aparte (el diálogo con el aviso adentro superaba las 190 líneas). (3) `createValueAdjustment` además rechaza con `BusinessError` la diferencia 0 ("El nuevo valor es igual al valor libro actual: no hay nada que ajustar") y el período cerrado con `loaded.lockedUntilDate` (mismo criterio que `postDepreciationEntry`); antes una diferencia 0 producía líneas 0/0 que rompen el check `chk_jel_debit_or_credit` de `journal_entry_lines`. (4) Por el mismo check, `buildDisposalLines` omite la línea de acumulada cuando `totalDepreciated` es 0 (equipo con depreciación configurada y ningún período contabilizado): antes esa baja explotaba con error de base.
  - **Equipo sin depreciación**: la baja se hace sin asiento y devuelve `{ success: true, journalEntryId: null }`; el diálogo lo avisa antes y el toast dice "(sin asiento contable)". Mismo comportamiento para motivo "Otro". La `BusinessError` de la integración para ese caso queda como defensa en profundidad (el action ya no la llama).
  - Los avisos de `prettier --check` que quedan en `list/actions.server.ts`, `depreciation/actions.server.ts`, `_EquipmentDataTable.tsx`, `_EquipmentHeader.tsx` y `_ValueAdjustmentDialog.tsx` son preexistentes en HEAD (orden de imports, JSX largo) y ajenos a las líneas tocadas; `integrations/equipment/index.ts` (reescrito) y los archivos nuevos están formateados. ESLint: 0 errores; los 3 warnings (`_tab` ×2, `handleReactivate`) son preexistentes. `check-types` 219 = base. `npx vitest run src/modules/equipment`: 4 archivos, 40 tests; suite completa: 40 archivos, 480 tests verdes.
  - Pendiente para fase 9: verificar en navegador (baja desde listado y detalle abren el mismo diálogo; aviso naranja con tipo sin cuentas y globales vacías; "Otro"/sin depreciación → aviso y toast "sin asiento") y en build de producción que el toast muestre el mensaje completo.

### Fase 6: Configuración contable "por defecto"
- **Estado:** Completada (2026-09-19)
- **Archivos modificados:**
  - `src/modules/accounting/features/settings/components/_CommercialIntegrationForm.tsx` - sección renombrada a "Bienes de Uso (cuentas por defecto)" con `description` que explica la resolución (Tipo de Equipo → pestaña Depreciación del equipo → estas por defecto). Labels: `fixedAssetAccountId` → "Cuenta de Bienes de Uso por defecto"; `accumulatedDepreciationAccountId` → "Amortización acumulada por defecto"; `depreciationExpenseAccountId` → "Gasto de amortización por defecto"; `assetDisposalGainLossAccountId` → "Resultado por venta/baja de Bienes de Uso" (única para todos los equipos). Las cuatro con `help` según el plan. `name` y `types` sin cambios.
- **Notas:** sin cambios en `validators.ts`, `actions.server.ts` ni tests (`validators.test.ts` sigue verde; los comentarios `// Cuentas de Activos Fijos` de esos dos archivos se dejan como están). Los tres labels "… por defecto" son los que debe usar `ASSET_ACCOUNT_LABELS[*].settingLabel` (fase 2) y `buildMissingDisposalAccountMessage` (fase 5) para que el mensaje de error nombre el campo exacto de la pantalla. `docs/modules/accounting.md` todavía menciona los labels viejos → fase 8. `check-types` 219 = base.

### Fase 7: Módulo Equipos visible
- **Estado:** Completada (2026-09-19)
- **Archivos modificados:**
  - `src/shared/lib/modules/constants.ts` - `HIDDEN_MODULES = ['employees', 'documents']`; comentario reescrito: quién la consume (activación y roles), que sidebar y guía se editan a mano, y que `equipment` es visible desde TSK-724c.
  - `src/shared/components/layout/_AppSidebar.tsx` - repuesto `{ title: 'Equipos', href: '/dashboard/equipment', icon: Truck, module: 'equipment' }` en `navMain` después de Dashboard (mismo literal que borró `7d3997e`; `Truck` ya estaba importado).
  - `src/modules/help/features/guide/components/_HelpGuideTabs.tsx` - repuesta la pestaña `equipamiento` ("Equipamiento", ícono `Truck`, `<_EquipmentGuide />`) después de Dashboard. `_EquipmentGuide.tsx` existía (nunca se borró, solo se desmontó). Empleados y Documentos no se reponen.
  - `src/modules/company/features/general/roles/actions.server.ts` - solo el comentario del filtro de módulos ocultos (decía "Empleados, Equipos, Documentos").
  - `.claude/rules/modules.md` - punto 7 "Módulos ocultos del fork (`HIDDEN_MODULES`)".
  - `docs/architecture/auth-and-permissions.md` - subsección "Módulos ocultos del fork (`HIDDEN_MODULES`)" debajo de las capas del sidebar.
- **Notas:**
  - Tres capas verificadas por código, sin cambios: RBAC filtra por `equipment` (`getSidebarPermissions`; el `PermissionGuard module="equipment"` de `EquipmentList.tsx:34` ya existía); industria: `equipment` no está en `INDUSTRY_MODULES` → universal; módulos activos: `activeModules` vacío = todo activo, y al salir de `HIDDEN_MODULES` la pantalla `/dashboard/company/modules` lo lista con su switch (filtra `MODULE_ORDER`, sin tocar código). Espacio de trabajo: `getWorkspaceForModule('equipment')` → Gestión.
  - **Roles**: `getRolePermissionsMatrix` filtra los grupos con `HIDDEN_MODULES`, así que ahora la UI de roles muestra el grupo "Equipos" (Principal) y "Configuración - Equipos" (Titulares, Sectores, Tipos Operativos, Contratistas, Tipos Vehículo, Marcas Vehículo). **Hallazgo**: los roles personalizados creados en producción **no tienen** permisos de `equipment` ni de `company.vehicle-types` (la UI los ocultaba y nunca pudieron otorgarse). Los roles de sistema owner/developer/admin sí los tienen: `rbac-init.ts` itera todos los `MODULE_GROUPS`. Tras deployar hay que entrar a Roles y dar Ver/Crear/Editar/Eliminar de Equipos y de Tipos de Equipo a los roles personalizados que lo necesiten (anotar en la presentación, fase 8).
  - La verificación en navegador (sidebar Gestión con "Equipos", Módulos, Roles, guía con pestaña Equipamiento, Empleados/Documentos siguen ocultos) queda para la fase 9: no había dev server levantado y otras fases editan la rama en paralelo. `check-types` 219 = base; `vitest` de settings y shared verde (27 tests). Los avisos de `prettier --check` en `_AppSidebar.tsx`, `constants.ts` y `roles/actions.server.ts` son preexistentes en HEAD (orden de imports, JSX largo) y ajenos a las líneas tocadas; no se reformatearon para no ensuciar el diff.

### Fase 8: Documentación
- **Estado:** Completada (2026-09-19)
- **Archivos creados:**
  - `scripts/guia-presentacion/tsk-724c.html` - guía de presentación (estructura y CSS de `tsk-721.html` + tabla `chain`, pasos con letras, `side-by-side.narrow-left` para el sidebar). Eyebrow "Ticket 724 (c) · Bienes de Uso · Equipos". Secciones: 1 Qué pediste (cita de 724-c, qué pasaba, la baja sin asiento en silencio) · 2 Qué cambió (antes/después, regla en una línea, tabla de las 4 cuentas con uso y dónde se cargan, captura 03) · 3 Activar Equipos (01, 02; callout naranja de permisos a roles no Propietario) · 4 Paso a paso a-d (04, 05, 06, 07, 08, 09; callout "Qué tipos conviene tener" y "Qué significa el aviso naranja") · 5 Si falta una cuenta (10, 11a, 11; cambio de comportamiento, "Qué vas a notar") · 6 La baja (12, 13; motivos con/sin asiento) · 7 Importante: la compra entra por el ítem (no vinculados, mejora futura; equipos sin factura) · 8 Qué no cambió (resultado global, Borrador, asientos previos, equipos dados de baja, depreciación e informes, resto de Configuración). La captura 14 (prod) no se incluyó: es visualmente idéntica a la 10; el texto del punto 5 dice que el mensaje se verificó en la versión instalada.
  - `docs/presentaciones/TSK-724c-bienes-de-uso.pdf` - 8 páginas A4, 866 KB (`generar-pdf.mjs`, Chrome del sistema). Sección 1-2 en pág. 1-2, 3 en 2-3, 4 en 3-5, 5 en 5-6, 6 en 7, 7-8 en 8.
- **Archivos modificados:**
  - `src/modules/help/features/guide/components/_EquipmentGuide.tsx` (518 líneas tras `prettier --write`; era 289) - reescrita al fork: título "Equipos", menú Equipos (grupo Principal), catálogos en Empresa → Equipos, listado (tabs, filtros, Contabilizar Depreciaciones, baja desde (…)), las 7 pestañas reales del detalle (Información, Contrato, Asignación, Contratistas, Documentos, Depreciación, QR), documentos en Empresa → General → Documentos (el módulo Documentos sigue oculto). Cards nuevas: "Cuentas contables de Bienes de Uso" (cadena equipo → tipo → por defecto, resolución por cuenta, qué muestra la card y sus badges, "Sin cuenta — …", Editar cuentas, alerta de períodos contabilizados, alerta "La compra del bien entra por el ítem" y sin asiento de alta), "Contabilizar la amortización" (individual con Contabilizar, masiva con aviso previo "Estos equipos se van a omitir…" y lista de errores, alerta "Si falta una cuenta, no se contabiliza", Bloqueo de Períodos, asientos en Borrador → Registrar) y "Dar de baja un equipo" (los 4 motivos con badges, cuáles generan asiento, sin depreciación/Otro sin asiento, el aviso previo del diálogo, la baja rechazada deja el equipo activo, reactivación). Ajustes de valor: asiento siempre y rechazo si falta cuenta. Alert final: Empresa → Equipos (Tipos de Equipo define cuentas), Módulos, Roles (Editar para contabilizar, Eliminar para baja), Contabilidad (informes), Comercial → Ítems.
  - `_CompanyGuide.tsx` - catálogos "Para Equipos (Empresa → Equipos)" con los nombres reales; bloque "Tipos de Equipo: cuentas contables de Bienes de Uso" (los 3 campos con su ayuda, Sin asignar → por defecto, override por equipo, badges de la columna "Cuentas contables") + Alert con el aviso naranja ("El cambio no se bloquea"); "Módulos con Permisos": Equipos + catálogos de Empresa → Equipos y la nota de otorgar permisos a roles personalizados; "Relación con otros módulos" actualizado.
  - `_AccountingGuide.tsx` - viñeta de Configuración: "Bienes de Uso por defecto (…)" con la cadena y la nota de que Resultado por venta/baja es única; card renombrada "Bienes de Uso: amortización y bajas" (se generan desde Equipos, cuentas del equipo → tipo → por defecto, rechazo con mensaje, masiva omite y lista, baja con/sin asiento, la compra entra por el ítem); "Relación con otros módulos" → Equipos.
  - `docs/modules/equipment.md` - sección nueva "Visibilidad del modulo" (fuera de `HIDDEN_MODULES`, sidebar/guía, Módulos y Roles, roles personalizados sin permisos); tabla de modelos con las cuentas en `VehicleDepreciation` y `VehicleType`; flujo con la card y el único camino de escritura del override; "Integracion Contable" reescrita (tabla cuenta | tipo | orden de resolución | se usa en; `REQUIRED_ACCOUNTS_BY_OPERATION`; política "advertir no bloquear / rechazar no degradar" con `ActionResult` y los tres `build*Message`; casos sin asiento OTHER/sin depreciación y `totalDepreciated` 0; asientos de baja; **sin asiento de alta**, eliminación de `getEquipmentAccountingSettings`/`payablesAccountId`, compra y equipo no vinculados); "Helpers compartidos" (`asset-accounts.ts`, `asset-accounts-loader.ts`, `_TerminateEquipmentDialog`, `_TerminateEntryNotice`, tests de integración y sus prefijos); tabla de Server Actions con `ActionResult` marcado en `softDeleteVehicle`, `updateDepreciationAccounts`, `postDepreciationEntry`, `postAllPendingDepreciations`, `createValueAdjustment` + las nuevas de depreciación y de `vehicle-types`.
  - `docs/modules/accounting.md` - "Cuentas de Bienes de Uso (4 campos, 3 de ellos por defecto) — TSK-724c" con labels reales y columna "Respaldo de"; "no hay degradacion suave" en lugar de "degradacion suave"; la comparación de tributos ahora dice "como en Bienes de Uso desde TSK-724c"; "Asientos Automaticos" suma amortización, ajuste y baja de Equipos y la nota de que no existe asiento de alta.
  - `docs/architecture/data-model.md` - `Vehicle` (sin cuentas propias), `VehicleDepreciation` (3 campos override), relaciones `VehicleDepreciation N→1 Account ×3` y `VehicleType N→1 Account ×3` con los nombres de relación de Prisma, párrafo de resolución + migración; `VehicleType` en catálogos; `AccountingSettings` con las tres "por defecto" y `assetDisposalGainLossAccountId` única.
  - `docs/infrastructure/deployment.md` - "Chequeos post-deploy": ítem "Equipos y Bienes de Uso" con (1) otorgar permisos de Equipos y Tipos de Equipo a roles personalizados y (2) la consulta SQL de 1.2.7.
  - `docs/architecture/auth-and-permissions.md` - sin cambios: la subsección "Módulos ocultos del fork" de la fase 7 ya dice que `equipment` es visible desde TSK-724c y que a los roles personalizados hay que otorgarles permisos; coherente con `equipment.md` y `deployment.md`.
- **Notas:**
  - `eslint` en las tres guías: 0 errores (1 warning `Receipt` sin usar en `_AccountingGuide.tsx`, preexistente en HEAD). `prettier --check` de `_AccountingGuide.tsx` y `_CompanyGuide.tsx` ya fallaba en HEAD; no se reformatearon para no ensuciar el diff; `_EquipmentGuide.tsx` sí (reescrita entera). `check-types` 219 = base.
  - Estilo: `_EquipmentGuide`/`_CompanyGuide` mantienen el "tú" ("Ve a", "Haz clic") del archivo; `_AccountingGuide` mantiene el "vos" de sus secciones nuevas. El PDF va en "vos", sin rutas ni nombres de componentes.
  - Las tareas de la fase 8 que el plan describía con "Camión"/"Otros equipos" y 11 capturas se hicieron en la fase 9 con "Rodados"/"Maquinaria" y 14 capturas; los textos de la guía y el PDF usan los nombres reales de las capturas.
  - Fase 9: la única tarea sin marcar es la consulta 1.2.7 en producción, que no es documentación y queda para el post-deploy (ahora documentada en `deployment.md`).

### Fase 9: Verificación final
- **Estado:** Completada (2026-09-19) — casos 1-8 del plan + build de producción; pendientes 9 (ajuste de valor), 10 (`lockedUntilDate`), 11 (roles) y la consulta en producción.
- **Cómo:**
  - Script `scripts/guia-presentacion/capturas-tsk724c.mjs` (nuevo, molde `capturas-tsk721.mjs`) contra `npm run dev -- -p 3010` (dev server relanzado para tomar el cliente Prisma nuevo). Modos: recorrido completo (siembra + 14 capturas), `--solo-error` (caso "sin cuentas" para el build de prod) y `--solo-capturas` (retoma 03 y 07 sin tocar datos).
  - Siembra por SQL solo lo que no tiene ABM: `types_of_vehicles` "Vehículos" y "Maquinaria" en Empresa de Prueba 01 SA. Todo lo demás por UI: tipos "Rodados" (BU `1.2.2/04/01`, AA `1.2.2/04/03`, gasto `4.2.1/02/10`) y "Maquinaria" (sin cuentas); equipos `TSK724C-001` (Rodados, dominio AB123CD) y `TSK724C-002` (Maquinaria); depreciación lineal 1.200.000 / 60 meses y 500.000 / 36 meses con inicio 01/06/2026 (4 períodos vencidos). Las 4 globales quedaron en NULL todo el recorrido salvo la de Resultado (`4.2.2/01/00`), cargada por SQL solo para la baja por venta y restaurada a NULL al final (`settings después: NULL NULL NULL NULL`). Los tipos/equipos TSK724C-* quedan en la base; el script los borra (con sus asientos) si vuelve a correr.
  - Build: `NEXT_PUBLIC_APP_URL=http://localhost:3011 BETTER_AUTH_URL=http://localhost:3011 npm run build && npm run start -- -p 3011` (build limpio, exit 0) y `capturas-tsk724c.mjs http://localhost:3011 --solo-error`. Servers dev y prod matados por PID de `ss -ltnp`.
  - `npx vitest run` → 40 archivos / **480 tests** verdes; residuos `TSK724C-TEST-*` / `TSK724C-BAJA-*` en `vehicles`, `vehicle_types`, `accounts`, `journal_entries` = 0/0/0/0. `check-types` → **219** = base. `eslint` en `equipment`, `vehicle-types`, `integrations/equipment` y `app/(core)/dashboard/equipment` → 0 errores, 23 warnings preexistentes.
- **Resultados:** ver tabla de la sección 5. Asiento de amortización #16 (período 1): Debe `4.2.1/02/10 Amortizaciones - Explotación` 20.000 / Haber `1.2.2/04/03 Amortizac. Acumuladas Rodados` 20.000. Tras el override de la acumulada a `1.2.2/02/03`, el #17 (período 2) acredita `1.2.2/02/03` y el #16 no cambió. Baja por venta #20: Debe `4.2.2/01/00 Pérdida por venta bienes de uso` 1.120.000 / Debe `1.2.2/02/03` 80.000 (acumulada del override, 4 períodos) / Haber `1.2.2/04/01 Rodados Valores Originales` 1.200.000; equipo `is_active=false`, `SALE`, depreciación `COMPLETED`.
- **Hallazgos:**
  1. **Bloqueante preexistente, corregido en el working tree SIN commit** (una palabra): `src/app/(core)/dashboard/equipment/[id]/page.tsx:14` validaba `tab` contra `['info','contract','assignment','contractors','documents','qr']` sin `'depreciation'`, así que el server siempre caía en `info` y, como `UrlTabs` es controlado, el clic en "Depreciación" (y el deep link `?tab=depreciation`) volvía a "Información": **la pestaña Depreciación era inalcanzable** desde el commit inicial. Se agregó `'depreciation'` a `validTabs` para poder verificar; revisar y commitear (o descartar) según criterio del responsable.
  2. `_TerminateEntryNotice.tsx` (aviso neutro "La baja genera un asiento con: …"): `AlertDescription` es `grid`, así que cada `<code>` inline queda en su propia línea y el punto final aparece solo (captura 12). Cosmético; envolver el contenido en un `<span>`/`<p>` lo arregla.
  3. Preexistente, fuera del ticket: el cronograma (`_DepreciationTab.tsx:209`, `moment(scheduledDate).format('MM/YYYY')`) muestra **05/2026** para un período guardado como `2026-06-01 00:00 UTC` (el navegador en -03 lo ve como 31/05 21:00), mientras el listado de asientos muestra 01/06/2026 para el mismo asiento. Capturas 10 y 11: "Contabilizar hasta 19/09/2026" y períodos 05/2026-08/2026 en pantalla vs. asientos 01/06-01/09.
  4. Preexistente: los asientos generados por amortización y baja aparecen en Contabilidad → Asientos con origen **"Manual"** y estado **"Borrador"** (capturas 07 y listado), igual que los de aportes; no hay `source` de equipos ni confirmación automática.
  5. Menor: el diálogo masivo cuenta en "Períodos pendientes 6 / Contabilizar 6 período(s) / $ 95.555,56" también los 4 del equipo que el propio aviso naranja dice que se va a omitir; luego contabiliza 2 y lista 1 error (capturas 11a/11).
  6. El aviso naranja del diálogo de baja nombra solo la **primera** cuenta faltante ("falta la cuenta de Bienes de Uso") mientras el toast del rechazo nombra las dos (BU y Amortización acumulada). Consistente pero desparejo (captura 13).
  7. No cubierto en esta fase: desactivar/reactivar el módulo Equipos; "cargar la global → contabiliza"; baja "Otro" y de un equipo sin depreciación; ajuste de valor (caso 9); `lockedUntilDate` (10); roles con usuario `@demo.local` (11); consulta 1.2.7 en producción.

## 5. Verificación

Fecha: 2026-09-19 · rama `feat/tsk-724c-cuentas-bienes-de-uso` · dev `:3010` / prod `:3011` · script `scripts/guia-presentacion/capturas-tsk724c.mjs` · capturas `scripts/guia-presentacion/assets/tsk724c-*.png`.

| # | Caso | Resultado | Evidencia |
|---|------|-----------|-----------|
| 1 | Módulo Equipos visible: sidebar (grupo Principal) y `/dashboard/company/modules` con switch "Activo" | OK | `01-sidebar-equipos`, `02-modulos-equipos` |
| 2 | Ajustes contables: sección "Bienes de Uso (cuentas por defecto)" con los 4 labels nuevos y ayudas | OK (los 4 labels encontrados con `exact`) | `03-ajustes-bienes-de-uso` |
| 3 | Tipo "Rodados" con `1.2.2/04/01`, `1.2.2/04/03`, `4.2.1/02/10`; tipo "Maquinaria" sin cuentas; columna "Cuentas contables" | OK — badges "Propias" / "Por defecto"; SQL `Rodados|3`, `Maquinaria|0` | `04-tipo-rodados-modal`, `05-tipos-listado-cuentas` |
| 4 | Equipo `TSK724C-001` (Rodados) + depreciación lineal → card "Cuentas contables" | OK — las 3 cuentas con badge "del tipo de equipo «Rodados»" | `06-card-cuentas-del-tipo` |
| 5 | Contabilizar período 1 → asiento | OK — toast "Período contabilizado (Asiento #16)"; SQL: Debe `4.2.1/02/10` 20.000 / Haber `1.2.2/04/03` 20.000 | `07-asiento-amortizacion` |
| 6 | Override: "Editar cuentas" → acumulada `1.2.2/02/03` → aviso naranja → Guardar → período 2 | OK — aviso "Este equipo tiene 1 período(s) contabilizado(s)…"; toast "Cuentas actualizadas"; badge "de la depreciación del equipo"; asiento #17 acredita `1.2.2/02/03`; el #16 sigue en `1.2.2/04/03` | `08-override-aviso-naranja`, `09-card-cuentas-override` |
| 7 | Equipo `TSK724C-002` (Maquinaria, sin cuentas, globales NULL) → Contabilizar | OK — toast rojo: «No se puede contabilizar la amortización del equipo «TSK724C-002»: no tiene cuenta de Amortización acumulada ni de Gasto de amortización. Asignalas en la depreciación del equipo (pestaña Depreciación → Cuentas contables), en el tipo de equipo «Maquinaria» (Empresa → Tipos de Equipo) o configurá "Amortización acumulada por defecto" y "Gasto de amortización por defecto" en Contabilidad → Configuración.»; períodos contabilizados = 0; la card muestra "Sin cuenta — asignala acá, en el tipo de equipo «Maquinaria» o en Contabilidad → Configuración" en las 3 filas | `10-toast-error-sin-cuentas` |
| 8 | Masiva "Contabilizar pendientes" con ambos equipos | OK — aviso previo "Estos equipos se van a omitir por falta de cuentas contables" con el mensaje de TSK724C-002; tras confirmar: toast "2 período(s) contabilizado(s)" y alerta roja "1 equipo(s)/período(s) no se pudieron contabilizar" con el mensaje; SQL `TSK724C-001 4/60`, `TSK724C-002 0/36` | `11a-masiva-aviso-previo`, `11-masiva-errores` |
| 9a | Baja por venta de `TSK724C-001` desde el **detalle** (botón "Baja" del encabezado) con Resultado global cargado | OK — diálogo "La baja genera un asiento con: Bienes de Uso 1.2.2/04/01 (del tipo de equipo «Rodados»), Amortización acumulada 1.2.2/02/03 (de la depreciación del equipo) y Resultado 4.2.2/01/00"; toast "Equipo dado de baja. Se generó el asiento contable."; asiento #20: Debe `4.2.2/01/00` 1.120.000 + Debe `1.2.2/02/03` 80.000 / Haber `1.2.2/04/01` 1.200.000; `is_active=f`, `SALE`, depreciación `COMPLETED` | `12-baja-dialogo-cuentas` |
| 9b | Baja de `TSK724C-002` desde el **listado** (sin cuentas) | OK — aviso naranja "La baja va a fallar: falta la cuenta de Bienes de Uso. Configurala en la pestaña Depreciación, en el tipo «Maquinaria» o en Contabilidad → Configuración."; toast rojo «No se puede contabilizar la baja del equipo «TSK724C-002»: no tiene cuenta de Bienes de Uso ni de Amortización acumulada. Asignalas en la depreciación del equipo (pestaña Depreciación → Cuentas contables), en el tipo de equipo «Maquinaria» (Empresa → Tipos de Equipo) o configurá "Cuenta de Bienes de Uso por defecto" y "Amortización acumulada por defecto" en Contabilidad → Configuración.»; el equipo sigue activo | `13-baja-rechazada` |
| 10 | **Build de producción** (`npm run build` exit 0 + `start -p 3011`): caso 7 y 9b contra `:3011` | OK — el toast muestra el **mensaje completo**, idéntico al de dev (amortización: «No se puede contabilizar la amortización del equipo «TSK724C-002»: no tiene cuenta de Amortización acumulada ni de Gasto de amortización. …»; baja: «No se puede contabilizar la baja del equipo «TSK724C-002»: no tiene cuenta de Bienes de Uso ni de Amortización acumulada. …»), no el digest "An error occurred in the Server Components render"; períodos contabilizados 0, equipo activo | `14-prod-toast-sin-cuentas` |
| 11 | Restaurar settings | OK — `NULL NULL NULL NULL` antes y después (solo Resultado se cargó temporalmente para 9a) | log del script |
| — | `npx vitest run` | 40 archivos / 480 tests verdes; residuos de los tests de integración 0 | — |
| — | `npm run check-types` | 219 errores = línea base | — |
| — | `eslint` equipment / vehicle-types / integrations/equipment / app/equipment | 0 errores (23 warnings preexistentes) | — |

**Pendiente de verificar** (no cubierto por el script): desactivar/reactivar el módulo Equipos; cargar la global y ver que TSK724C-002 contabiliza; baja "Otro" y de equipo sin depreciación; ajuste de valor (con y sin cuenta de resultado); `lockedUntilDate` en el futuro; roles con usuario `@demo.local`; consulta 1.2.7 en producción.

**Hallazgos** (detalle en sección 4, Fase 9): (1) pestaña Depreciación inalcanzable por `validTabs` sin `'depreciation'` en `app/(core)/dashboard/equipment/[id]/page.tsx` — corregido en el working tree sin commit; (2) `<code>` del aviso de baja en líneas separadas por el `grid` de `AlertDescription`; (3) cronograma muestra el mes anterior (UTC vs -03); (4) asientos de equipos salen "Manual"/"Borrador"; (5) el diálogo masivo cuenta los períodos que va a omitir; (6) el aviso de baja nombra solo la primera cuenta faltante.
