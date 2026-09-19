# Modulo Equipamiento

**Rutas:** `/dashboard/equipment`, `/dashboard/equipment/new`, `/dashboard/equipment/[id]`, `/dashboard/equipment/[id]/edit`
**Archivos:** `src/modules/equipment/`

El modelo Prisma subyacente es `Vehicle`. El modulo distingue entre "Vehiculos" y "Otros equipos" via `TypeOfVehicle`.

## Visibilidad del modulo

Desde TSK-724c `equipment` **no** esta en `HIDDEN_MODULES` (`src/shared/lib/modules/constants.ts`): la
contabilidad de Bienes de Uso (amortizacion, baja, ajuste de valor) vive en Equipos y la clienta la
necesita. Consecuencias:

- Item "Equipos" en el sidebar (`_AppSidebar.tsx`, `navMain`, espacio de trabajo **Gestion**) y pestaña
  "Equipamiento" en la guia in-app (`_HelpGuideTabs.tsx` → `_EquipmentGuide.tsx`).
- Aparece con su switch en `/dashboard/company/modules` y su grupo de permisos ("Equipos" y
  "Configuracion - Equipos": Titulares, Sectores, Tipos Operativos, Contratistas, Tipos de Equipo, Marcas)
  en la UI de Roles.
- **Roles personalizados creados mientras estuvo oculto no tienen permisos de `equipment` ni de
  `company.vehicle-types`** (la UI nunca los ofrecio). Los roles de sistema (owner/developer/admin) si
  (`rbac-init.ts` itera todos los `MODULE_GROUPS`). Tras deployar hay que otorgarlos desde Empresa → Roles.
  Ver [Modulos ocultos del fork](../architecture/auth-and-permissions.md#módulos-ocultos-del-fork-hidden_modules).

`employees` y `documents` siguen ocultos. Las tres capas del sidebar (RBAC → industria → modulos activos)
no cambiaron: `equipment` es universal y `activeModules` vacio = todo activo.

---

## Features

### Lista (`features/list/`)

- Tabs: Todos, Vehiculos, Otros
- Tabla paginada server-side con busqueda (numero interno, dominio, chasis, motor)
- Filtros: estado, condicion, tipo, marca, activo/inactivo
- Exportacion a Excel
- Soft-delete (con motivo de baja)
- Reactivacion de equipos dados de baja

### Crear (`features/create/`)

- Creacion con campos completos
- Asociacion a contratistas (relacion N:M via `ContractorVehicle`)
- Estado inicial: `INCOMPLETE`, condicion: `OPERATIVE`

### Detalle (`features/detail/`)

- Informacion completa del vehiculo/equipo
- Estado de cumplimiento documental
- Codigo QR para acceso publico

### Editar (`features/edit/`)

- Actualiza vehiculo + re-crea relaciones de contratistas en transaccion

## Campos del Vehiculo/Equipo

**Identificacion:** numero interno, dominio/patente, chasis, motor, serie, ano, kilometraje
**Estado:** status (VehicleStatus), condicion (VehicleCondition)
**Titularidad:** tipo (propia/leasing/tercero), titular, contrato (fechas, moneda, precio)
**Relaciones:** marca, modelo, tipo de equipo, tipo de vehiculo, centro de costo, sector, tipo operativo, contratistas

## Estados y Condiciones

**VehicleStatus:** ACTIVE, INACTIVE, MAINTENANCE, RETIRED
**VehicleCondition:** EXCELLENT, GOOD, FAIR, POOR, OPERATIVE
**Motivos de baja:** SALE, TOTAL_LOSS, RETURN, OTHER

## QR Publico

Cada equipo tiene un codigo QR que apunta a `/eq/[id]` (ruta publica, sin autenticacion). Permite:
- Descargar como PNG (alta resolucion)
- Imprimir directamente
- Copiar URL al portapapeles

## Documentos del Equipo

Gestionados desde el modulo Documents. Rutas: `/dashboard/equipment/[id]/documents`

## Depreciacion (`features/depreciation/`)

Gestion de depreciacion de activos fijos con integracion contable.

### Modelos

| Modelo | Descripcion |
|--------|-------------|
| `VehicleDepreciation` | Configuracion de depreciacion de un equipo (metodo, valores, vida util) + **override opcional de las tres cuentas** de Bienes de Uso (`fixedAssetAccountId?`, `accumulatedDepreciationAccountId?`, `depreciationExpenseAccountId?`, FK `SetNull`, TSK-724c) |
| `DepreciationScheduleEntry` | Periodo individual del schedule (monto, fecha, estado contable) |
| `AssetValueAdjustment` | Ajuste de valor del activo (revaluacion/deterioro); `journalEntryId` ya nunca es `null` |
| `VehicleType` (modulo `company`) | Tipo de equipo; desde TSK-724c lleva las **mismas tres cuentas opcionales**: son el nivel "por rubro" de la cadena de resolucion |

### Metodos de Depreciacion

- **Linea Recta** (`STRAIGHT_LINE`): (grossValue - salvageValue) / usefulLifeMonths
- **Saldo Decreciente** (`DECLINING_BALANCE`): bookValue * (annualRate / 12)

### Flujo

1. Configurar depreciacion en el tab "Depreciacion" del detalle del equipo
2. Se genera automaticamente el schedule completo (todos los periodos)
3. La card **"Cuentas contables"** (`_DepreciationAccountsCard.tsx`, entre el resumen y el cronograma)
   muestra las tres cuentas resueltas y su origen; "Editar cuentas" (`_DepreciationAccountsDialog.tsx`)
   guarda el override en `VehicleDepreciation` (`updateDepreciationAccounts`). Es el **unico** camino de
   escritura del override: `depreciationConfigSchema` / `createVehicleDepreciation` no reciben cuentas.
4. Contabilizar periodos individualmente (boton "Contabilizar" del cronograma) o en lote
   ("Contabilizar Depreciaciones" en el listado, `_BulkDepreciationDialog.tsx`)
5. Al contabilizar, se genera asiento: Gasto de amortizacion (Debe) / Amortizacion acumulada (Haber) con
   las cuentas resueltas para ese equipo (ver Integracion Contable). Los periodos se contabilizan en orden.
6. Ajustes de valor (`createValueAdjustment`) generan **siempre** asiento (Resultado por venta/baja contra
   Amortizacion acumulada) y recalculan el schedule desde el periodo siguiente. Diferencia 0 se rechaza.

### Estados

- `ACTIVE`: Depreciacion en curso
- `COMPLETED`: Vida util agotada o equipo dado de baja
- `SUSPENDED`: Depreciacion pausada temporalmente

### Integracion Contable

**Cuentas por equipo (TSK-724c).** Las tres cuentas de Bienes de Uso ya no son globales: se resuelven
por equipo, cada una por separado, recorriendo una cadena de tres niveles. La cuenta de resultado sigue
siendo unica.

| Cuenta | Tipo | Donde se define (orden de resolucion) | Se usa en |
|--------|------|----------------------------------------|-----------|
| Bienes de Uso (`fixedAssetAccountId`) | ASSET | 1. `VehicleDepreciation` (override, pestaña Depreciacion → "Editar cuentas") → 2. `VehicleType` (Empresa → Tipos de Equipo) → 3. `AccountingSettings` ("Cuenta de Bienes de Uso por defecto") | baja, ajuste de valor |
| Amortizacion acumulada (`accumulatedDepreciationAccountId`) | ASSET | idem ("Amortizacion acumulada por defecto") | amortizacion, baja, ajuste |
| Gasto de amortizacion (`depreciationExpenseAccountId`) | EXPENSE | idem ("Gasto de amortizacion por defecto") | amortizacion |
| Resultado por venta/baja (`assetDisposalGainLossAccountId`) | REVENUE/EXPENSE | solo `AccountingSettings` ("Resultado por venta/baja de Bienes de Uso") | baja, ajuste |

`resolveAssetAccounts` usa `||`: `''`, `null` y `undefined` cuentan como "sin cuenta". El resultado lleva
`source: 'depreciation' | 'type' | 'default'`, que la UI muestra como badge ("de la depreciacion del
equipo" / "del tipo de equipo «Rodados»" / "por defecto (Ajustes contables)").

**Cuentas requeridas por operacion** (`REQUIRED_ACCOUNTS_BY_OPERATION`):

| Operacion | Requiere | Ademas |
|-----------|----------|--------|
| `depreciation` (`postDepreciationEntry`, `postAllPendingDepreciations`) | Amortizacion acumulada, Gasto de amortizacion | — |
| `disposal` (`softDeleteVehicle` con SALE / TOTAL_LOSS / RETURN) | Bienes de Uso, Amortizacion acumulada | Resultado por venta/baja (global) |
| `adjustment` (`createValueAdjustment`) | Bienes de Uso, Amortizacion acumulada | Resultado por venta/baja (global) |

**Politica de errores: advertir, no bloquear la configuracion; rechazar, no degradar la operacion.**

- Las cuentas se validan **antes** de abrir `$transaction` (`loadVehicle(s)AssetAccounts` +
  `assertAssetAccountsForOperation`). Falta una cuenta requerida → `BusinessError` con el mensaje de
  `buildMissingAssetAccountsMessage` (nombra equipo, cuenta(s), tipo y los tres lugares donde cargarla);
  la cuenta resuelta existe pero no es imputable (inactiva, no hoja, con corte vigente) →
  `buildUnavailableAssetAccountMessage` (dice de donde salio y donde corregirla; **no cae** a la global);
  falta la de resultado → `buildMissingDisposalAccountMessage`.
- Las actions devuelven `ActionResult` (`toActionResult` en el `catch`): el mensaje llega al toast tambien
  en build de produccion (memoria `errores-negocio-server-actions`). Antes `softDeleteVehicle` y
  `createValueAdjustment` saltaban el asiento en silencio si faltaban cuentas (`if (settings) {...}`); eso
  se elimino: **no hay fallback silencioso**.
- La masiva no se frena por un equipo: `postAllPendingDepreciations` devuelve `{ posted, errors:
  { vehicleId, label, message }[] }`, y `getPendingDepreciationsSummary` expone `vehiclesWithoutAccounts`
  para el aviso previo del dialogo ("Estos equipos se van a omitir por falta de cuentas contables").
- Cambiar una cuenta con periodos ya contabilizados **no se bloquea**: la UI avisa (naranja) que los
  asientos anteriores no cambian y que el saldo acumulado lo reclasifica el contador; `updateVehicleType`
  y `updateDepreciationAccounts` hacen `logger.info` con before/after.
- Periodo bloqueado (`lockedUntilDate`) tambien es `BusinessError` en amortizacion, baja y ajuste.

**Casos sin asiento (por diseño):** baja con motivo `OTHER`, y baja de un equipo sin `VehicleDepreciation`
(cualquier motivo). `softDeleteVehicle` devuelve `{ success: true, journalEntryId: null }` y el dialogo lo
avisa antes ("no genera asiento contable"). Si `totalDepreciated` es 0, `buildDisposalLines` omite la
linea de acumulada (check `chk_jel_debit_or_credit`).

**Asientos de baja** (`accounting/features/integrations/equipment/index.ts`, cuentas resueltas por el
llamador via `AssetDisposalAccounts`):
- **Venta** (`createJournalEntryForAssetSale`): Debe Amortizacion acumulada (lo amortizado) / Debe Resultado
  (valor libro) / Haber Bienes de Uso (valor de origen).
- **Perdida total / Devolucion** (`createJournalEntryForAssetDisposal`): misma estructura.

**No hay asiento de alta / capitalizacion.** El bien entra a Bienes de Uso por la **factura de compra**
(cuenta ASSET del item, TSK-579/721), que ademas registra IVA credito y la deuda con el proveedor; un
segundo asiento al configurar la depreciacion duplicaria activo y pasivo. `getEquipmentAccountingSettings`
y el `payablesAccountId` que se seleccionaba para eso fueron eliminados. Compra y equipo **no estan
vinculados** (`Vehicle.purchaseInvoiceLineId` no existe): la coherencia "cuenta del item == cuenta de
Bienes de Uso del tipo" se sostiene con la ayuda de los campos, la guia y el PDF (seguimiento 2.4-1 del
plan).

### Helpers compartidos (`src/modules/equipment/shared/`)

| Archivo | Que hace |
|---------|----------|
| `asset-accounts.ts` | Puro (sin Prisma, sin `@/modules/*`): `resolveAssetAccounts`, `findMissingAssetAccounts`, `REQUIRED_ACCOUNTS_BY_OPERATION`, `ASSET_ACCOUNT_SOURCE_LABELS`, `OPERATION_LABELS`, `formatAccountLabel` y los tres `build*Message`. Re-exporta `ASSET_ACCOUNT_KEYS` / `ASSET_ACCOUNT_LABELS` / `AssetAccountIds` desde `src/shared/lib/assets/asset-account-labels.ts` (viven en `shared/` porque tambien los usa el ABM Tipos de Equipo del modulo `company`). 16 tests Vitest. |
| `asset-accounts-loader.ts` | `server-only`. `loadVehiclesAssetAccounts(companyId, vehicleIds, tx?)` (1 `vehicle.findMany` + 1 `accountingSettings.findUnique` en paralelo, luego 2 `account.findMany`: datos e imputables con `buildImputableAccountsWhere`), `loadVehicleAssetAccounts` para uno, y `assertAssetAccountsForOperation(loaded, operation)` que lanza `BusinessError`. Sin `checkPermission` (lo hacen las actions). |
| `components/_TerminateEquipmentDialog.tsx` | Dialogo de baja compartido por listado (`_EquipmentDataTable`) y detalle (`_EquipmentHeader`). `useQuery(['vehicleAssetAccounts', id])` + `useMutation(softDeleteVehicle)`; toast "Equipo dado de baja. Se generó el asiento contable." / "(sin asiento contable)". |
| `components/_TerminateEntryNotice.tsx` | Aviso bajo el motivo: "Verificando cuentas contables…", "no tiene depreciación configurada", "Baja por otro motivo", naranja "La baja va a fallar: falta la cuenta de …", o la lista de cuentas con origen. |

Tests de integracion contra la base real: `features/depreciation/asset-accounts.integration.test.ts`
(prefijo `TSK724C-TEST-`) y `features/list/asset-disposal.integration.test.ts` (prefijo `TSK724C-BAJA-`,
archivo propio porque Vitest corre en paralelo y los `afterAll` cuentan por prefijo).

### Reportes

- **Registro de Bienes de Uso**: Listado de todos los activos con valores brutos, depreciacion acumulada y valor neto
- **Depreciaciones del Periodo**: Detalle de periodos contabilizados en un rango de fechas

Ambos reportes disponibles en Contabilidad > Informes > seccion "Bienes de Uso".

---

## Server Actions Principales

| Funcion | Descripcion |
|---------|-------------|
| `getEquipmentPaginated` | Lista paginada con tabs y filtros |
| `getEquipmentTabCounts` | Conteo para tabs (todos, vehiculos, otros) |
| `createVehicle` | Crear vehiculo + relaciones de contratistas |
| `getVehicleById` | Detalle con todas las relaciones |
| `updateVehicle` | Actualizar en transaccion |
| `softDeleteVehicle(id, reason)` | **`ActionResult<{ journalEntryId: string \| null }>`**. Pre-valida cuentas (`disposal`) antes de la transaccion; asiento segun motivo; `null` si OTHER o sin depreciacion |
| `reactivateVehicle` | Reactivar equipo dado de baja |
| `createVehicleDepreciation` | Configurar depreciacion + generar schedule (sin cuentas: el override va por `updateDepreciationAccounts`) |
| `updateVehicleDepreciation` | Actualizar configuracion + regenerar schedule (sin consumidor en la UI, seguimiento 2.4-9) |
| `getVehicleAssetAccounts(vehicleId)` | Las tres cuentas resueltas con `{ accountId, code, name, source, imputable }`, `fallbacks` (que se usaria con el override vacio), `assetDisposalGainLoss`, `postedCount`, `typeName`. Alimenta la card, el dialogo de cuentas y el de baja |
| `getDepreciationAccountOptions(includeIds?)` | `{ asset, expense }` imputables para los combos del override |
| `updateDepreciationAccounts(depreciationId, input)` | **`ActionResult`**. Guarda el override (`depreciationAccountsSchema`, UUID nullish → null); no bloquea por periodos contabilizados; `assertAccountsBelongToCompany` |
| `postDepreciationEntry(entryId)` | **`ActionResult<{ journalEntryId; journalEntryNumber }>`**. Contabilizar un periodo (cuentas resueltas + secuencia + periodo bloqueado como `BusinessError`) |
| `postAllPendingDepreciations(upToDate)` | **`ActionResult<{ posted; errors: BulkDepreciationError[] }>`**. Masiva; los equipos sin cuentas se omiten y se listan |
| `getPendingDepreciationsSummary(upToDate)` | Resumen del dialogo masivo + `vehiclesWithoutAccounts` |
| `createValueAdjustment(vehicleId, input)` | **`ActionResult<{ journalEntryId: string }>`**. Asiento siempre; rechaza diferencia 0, cuentas faltantes y periodo bloqueado |

En `company/features/vehicle-types/list/actions.server.ts` (modulo `company`):

| Funcion | Descripcion |
|---------|-------------|
| `createVehicleType` / `updateVehicleType` | Reciben las tres cuentas opcionales (`VehicleTypeAccountsInput`); `assertAccountBelongsToCompany`; `logger.info` con `previous`/`next` al cambiar cuentas |
| `getVehicleTypeAssetAccounts(includeIds?)` | `{ asset, expense }` imputables para los combos del modal (sin exigir `isFixedAsset`) |
| `getVehicleTypePostedDepreciationCount(typeId)` | Equipos del tipo con periodos contabilizados, para el aviso naranja del modal |
