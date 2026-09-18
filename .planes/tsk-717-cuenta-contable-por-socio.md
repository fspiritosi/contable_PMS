# TSK-717: Cuenta contable de aportes por socio

**Fecha de inicio:** 2026-09-18
**Tickets:** [717] "Cada socio tiene una cuenta contable propia" · [724-d] "Cuentas de Aportes de Socios" · resuelve [413] (4ª reapertura) y [706] (crítica)
**Reportante:** Elizabeth Perez (eperez@perezmarzo.com.ar) vía 413/706
**Estado:** Verificación completada

---

## 1. Análisis

### 1.1 Problema

Hoy **todos** los aportes y retiros de socios se contabilizan contra **una sola** cuenta de
Patrimonio Neto por empresa: `AccountingSettings.partnerContributionsAccountId`
(`prisma/schema.prisma:534`). El socio que aporta se elige en el modal, pero es un dato
**informativo** ("Socio (opcional)", `_CreateFundMovementModal.tsx:463`) que solo se guarda como
`partnerId`/`partnerName` en el movimiento y **no interviene en el asiento**
(`fund-movements/list/actions.server.ts:677`, `:719`, `:728`).

La clienta lleva la contabilidad de una sociedad de varias socias y necesita que **cada socia
tenga su propia cuenta de aportes** y que el aporte se impute a la cuenta de la que aportó. Ese
es el motivo real por el que el 413 se reabrió cuatro veces y por el que la 706 es crítica:

- **TSK-413** (Elizabeth Perez, externo, reabierto 4 veces): "Una de las primeras cosas que
  hicimos es poner plata en la cuenta bancaria cada socia según su porcentaje. No es gasto… es
  activo contra activo. En BJ [Bejerman] lo llaman movimientos de fondos".
- **TSK-706** (crítica): "Me faltó ponerle dale bola a este ticket [413] porque si no no lleno
  el banco jajaja. Fue con aportes de socios, así voy llegando al saldo real :)".
- **TSK-717** (interna): "En el form del socio tengo que poder indicar cuál es la cuenta
  contable del socio".
- **TSK-724** (interna, punto d): "Cuentas de Aportes de Socios: debemos permitir que se
  configure más de una y cada una debe corresponder a uno de los socios declarados por la
  empresa".

Lo que se pide, en concreto:

1. Poder **asociar una cuenta contable a cada socio** (717).
2. Que el sistema **admita más de una cuenta de aportes**, una por socio (724-d).
3. Que al confirmar un **aporte** (o **retiro**) el asiento use **la cuenta del socio que
   aportó**, de modo que el contador vea en el mayor el aporte de cada socia por separado
   (413/706).

"Activo contra activo" en palabras de la clienta describe el movimiento de fondos (entra plata
al banco); la contrapartida contable real del aporte es Patrimonio Neto, y así está modelado
desde el spec original de 413 (`docs/superpowers/specs/2026-07-10-movimientos-de-fondos-design.md:22-23`:
"contrapartida configurable en Ajustes contables, tipo EQUITY"). No hay que cambiar eso; hay que
**desglosarlo por socio**.

### 1.2 Contexto actual

#### 1.2.1 Modelo de datos

**`Partner`** (`prisma/schema.prisma:4385-4406`, tabla `partners`): `name`, `taxId`, `email`,
`phone`, `notes`, `isActive`, `companyId`, auditoría. Relaciones: `cards Card[]`,
`movements PartnerAccountMovement[]`, `installments PaymentOrderInstallment[]`,
`paymentOrders PaymentOrder[]`. **No tiene ninguna referencia a `Account`.** El comentario del
modelo lo describe como "Socio de la empresa. Puede ser titular de tarjetas y tener cuenta
corriente" (`:4384`).

**`PartnerAccountMovement`** (`prisma/schema.prisma:4470-4489`, tabla `partner_account_movements`):
es la **cuenta corriente de tesorería del socio**, no una cuenta contable. Registra lo que la
**empresa le debe al socio** cuando este paga cosas de la empresa con **su tarjeta personal**:

- `PartnerMovementType` = `OWED` (la empresa pasa a deberle), `REPAYMENT` (la empresa le
  devuelve), `ADJUSTMENT` (ajuste manual) (`schema.prisma:4299-4305`).
- Se alimenta **solo manualmente** desde la pestaña "Cuenta Corriente" del detalle del socio
  (`partners/features/detail/actions.server.ts:116-182`, `createPartnerMovement`, que solo
  admite `REPAYMENT`/`ADJUSTMENT`; `OWED` "se genera automáticamente al pagar con la tarjeta
  del socio (otra fase)" según el comentario de `:111-115`, pero **nadie lo crea hoy**: el único
  `partnerAccountMovement.create` del repo es el de `:144`).
- El saldo del socio se calcula como `Σ(cuotas PENDING de tarjetas del socio) + Σ(OWED) +
  Σ(ADJUSTMENT) − Σ(REPAYMENT)` (`partners/features/list/actions.server.ts:23-62`;
  `detail/actions.server.ts:91-92`). Las cuotas vienen de `PaymentOrderInstallment.partnerId`
  (`schema.prisma:4444`) y se saldan con una OP de devolución al socio
  (`payment-orders/actions.server.ts:713-721`), que **no genera asiento** (`:723-725`).
- **No tiene ninguna relación con la contabilidad**: no hay `accountId`, no genera asientos, y
  los aportes/retiros de `FundMovement` **no la tocan** (no hay `partnerAccountMovement` en
  `fund-movements/list/actions.server.ts`). El spec original de 413 decía "Registra además un
  `PartnerAccountMovement`" (`docs/superpowers/specs/2026-07-10-movimientos-de-fondos-design.md:61`),
  pero eso **no se implementó**. Ver observación en 1.2.5.

Conclusión: `PartnerAccountMovement` resuelve otro problema (deuda con el socio por tarjetas) y
**no sirve** para "la cuenta contable del socio". La cuenta contable del socio es un `Account`
del plan de cuentas.

**`FundMovement`** (`prisma/schema.prisma:4324-4362`, tabla `fund_movements`):

- `type FundMovementType` = `PARTNER_CONTRIBUTION` ("banco/caja contra capital"),
  `PARTNER_WITHDRAWAL` ("capital contra banco/caja"), `ACCOUNT_TRANSFER`, `BANK_CHARGES`
  (`:4307-4314`).
- `status` DRAFT → CONFIRMED (`:4316-4322`); solo se edita/borra en DRAFT.
- `fundOutKind/fundOutId/fundOutLabel` y `fundInKind/fundInId/fundInLabel` (`:4337-4344`): el
  banco o caja de donde salen / a donde entran los fondos, con snapshot de etiqueta.
- **`partnerId String?` con comentario "socio (aporte/retiro), informativo"** y
  `partnerName String?` (`:4346-4347`). **No es una FK**: no hay `partner Partner?
  @relation(...)`, y `Partner` no tiene `fundMovements FundMovement[]`. Se puede borrar un
  socio con aportes confirmados (`deletePartner` solo cuenta `movements` y `cards`,
  `partners/features/list/actions.server.ts:261-274`).
- `journalEntryId`/`journalEntryNumber` (`:4349-4350`), `lines FundMovementLine[]` (TSK-585,
  solo para `BANK_CHARGES`; `:4365-4382`).

**`AccountingSettings.partnerContributionsAccountId`** (`prisma/schema.prisma:534`):
`String? @map("partner_contributions_account_id")`, con relación
`partnerContributionsAccount Account? @relation("PartnerContributionsAccount", ...)` (`:559`) e
inversa `settingsAsPartnerContributions AccountingSettings[]` en `Account` (`:339`). Comentario:
"Cuenta de aportes de socios / capital (para movimientos de fondos)". Es **una por empresa**
(`companyId @unique`, `:509`).

**`Account`** (`prisma/schema.prisma:296-377`):

- `type AccountType` = ASSET, LIABILITY, **EQUITY** (Patrimonio Neto), REVENUE, EXPENSE
  (`:220-228`); `nature AccountNature` DEBIT/CREDIT (`:231-236`).
- Jerarquía `parentId`/`parent`/`children` (`"AccountHierarchy"`, `:304-306`); `isLeaf`
  "= imputable (hoja). Mantenido automáticamente" (`:309`); `isActive`, `disabledFrom`
  (corte por ejercicio, `:311-313`); `isFixedAsset` (TSK-618, `:318`).
- `@@unique([companyId, code])` (`:374`).
- **Patrón de "cuenta contable por entidad" ya existente**, que es exactamente lo que pide 717:
  - `BankAccount.accountId String?` + `account Account?` (`schema.prisma:3197-3200`), inversa
    `bankAccounts BankAccount[]` en `Account` (`:325`).
  - `CashRegister.accountId String?` + `account Account?` (`:3083-3088`), inversa
    `cashRegisters CashRegister[]` (`:326`).
  - `Supplier`/`Contractor` (`:323-324`, "cuentas predeterminadas") y
    `Product` (`productsAsExpenseAccount`/`productsAsIncomeAccount`, `:370-371`).
  - Y el **fallback a la global** ya está codificado para banco y caja en el propio confirm del
    movimiento de fondos: `bank.accountId ?? settings.defaultBankAccountId`
    (`fund-movements/list/actions.server.ts:249`) y `cash.accountId ?? settings.defaultCashAccountId`
    (`:287`), con mensajes de error que nombran a la entidad y dicen dónde configurarla
    (`:250-254`, `:288-292`).

**Cómo se filtra por tipo en los combos existentes**:

- Configuración contable: `getActiveAccounts` trae imputables (`buildImputableAccountsWhere`,
  `src/shared/lib/accounts/imputable-accounts.ts:33-46`: `isActive`, `isLeaf`, sin corte
  vigente, opcionalmente `type in [...]`) más los ids ya configurados
  (`accounting/features/settings/actions.server.ts:199-228`), y el form filtra en el cliente
  por `types` de cada campo (`_CommercialIntegrationForm.tsx:310-311`, `accountsFor`). La
  cuenta de aportes está declarada con `types: ['EQUITY']` (`:140-145`).
- Banco: `getAvailableAccounts` filtra `type: 'ASSET'`, `isActive` (sin `isLeaf`)
  (`bank-accounts/list/actions.server.ts:245-270`). Caja: `getAvailableAccountsForCashRegister`
  idem (`cash-registers/list/actions.server.ts:16-26`).
- Conceptos de fondos: `getFundMovementLineAccounts` usa `buildImputableAccountsWhere` +
  `filterExpenseAccounts` e `includeIds` para preservar cuentas ya guardadas
  (`fund-movements/list/actions.server.ts:167-189`).

**Plan de cuentas modelo** (`accounting/features/accounts/data/model-chart-of-accounts.ts`):
el rubro de Patrimonio Neto tiene `3.1.0/00/00 APORTE DE LOS PROPIETARIOS` (no hoja, `:983-987`)
→ `3.1.1/00/00 CAPITAL SOCIAL` (no hoja, `:989-993`) → hojas `3.1.1/01/00 Acciones en
Circulación`, `3.1.1/02/00 Aportes Irrevocables`, `3.1.1/03/00 Acciones a distribuir`
(`:995-1011`) y `3.1.2/00/00 Ajuste del Capital` (`:1013-1017`). Además existen, como **ASSET**
(créditos diversos), `1.1.4/02/01..03 "Cuenta Part. Socio 1/2/3"` (`:299-315`) y
`1.2.5/02/02 "Cuentas Partic Socios / Accionistas (No Ctes.)"` (`:696-700`): son las
"cuentas particulares" (lo que el socio le debe a la empresa), **no** cuentas de aportes. No hay
en el modelo un padre llamado "Aportes de socios" con hijas por socio; el candidato natural a
padre es `3.1.1/00/00 CAPITAL SOCIAL`.

#### 1.2.2 Feature de socios

Vive en `src/modules/commercial/features/treasury/features/partners/` (módulo comercial,
sub-módulo Tesorería), con rutas delgadas en
`src/app/(core)/dashboard/commercial/treasury/partners/{page,new,[id],[id]/edit}` y permiso
`commercial.treasury.partners` (`src/shared/lib/permissions/constants.ts:47,149,237`; ítem de
sidebar `_AppSidebar.tsx:247-249`).

- **Listado**: `features/list/PartnersList.tsx` (Server) → `_PartnersTable.tsx` (Client) con
  `getPartners` (paginado, con saldo por socio; `list/actions.server.ts:67-128`) y columnas
  Nombre, CUIT/CUIL, Email, Teléfono, "Saldo a favor" (`list/columns.tsx:60-139`).
- **Form** (compartido crear/editar): `features/create/components/_PartnerForm.tsx`. Campos hoy:
  `name` (obligatorio), `taxId`, `email`, `phone`, `notes`, `isActive` (`:36-47`, `:58-151`).
  Un solo `Card` "Datos del Socio". Sin ningún selector de cuenta contable.
- **Validator Zod**: `shared/validators.ts:4-11` (`partnerSchema`) y `PartnerFormData` (`:32`).
- **Tipo `Partner`**: está **escrito a mano** en `shared/types.ts:3-15` (no inferido de
  Prisma); todo campo nuevo hay que agregarlo ahí también.
- **Actions**: `getPartnerById` (`list/actions.server.ts:154-169`, `findFirst` sin `select`),
  `createPartner` (`:174-208`), `updatePartner` (`:213-250`), `deletePartner` (`:255-286`).
  Todas con `checkPermission` y `getActiveCompanyId`.
- **Detalle**: `features/detail/PartnerDetail.tsx` con dos tabs, "Información General"
  (`_PartnerDetailContent.tsx`, muestra Nombre/CUIT/Email/Teléfono/Notas, `:107-142`) y
  "Cuenta Corriente" (`_PartnerAccountTab.tsx`, la de tarjetas descrita en 1.2.1).
- **Edición**: `_EditPartnerForm.tsx:35-42` arma `defaultValues` campo por campo desde
  `partner`.

Patrón a copiar para el selector de cuenta: `_BankAccountFormModal.tsx:52-57` (`useQuery`
`['available-accounts']` → `getAvailableAccounts`, `enabled: open`) y el `FormField`
"Cuenta contable asociada" con `AccountCombobox` + `FormDescription` explicando el fallback
(`:271-292`). El `AccountCombobox` (`src/shared/components/common/AccountCombobox.tsx:47-57`)
busca por código y nombre y admite `clearLabel` para volverlo obligatorio u opcional.

#### 1.2.3 Movimientos de fondos y el asiento actual

Archivo: `src/modules/commercial/features/treasury/features/fund-movements/list/actions.server.ts`
(840 líneas).

**Cómo se elige el socio hoy**: es un **`Select` de `Partner` activos**, no texto libre, pero
**opcional**. `getFundMovementCatalogs` (`:118-151`) trae `partners` (`prisma.partner.findMany
where isActive`, `select id, name`, `:134-138`) y `hasContributionsAccount =
Boolean(settings?.partnerContributionsAccountId)` (`:139-142`, `:149`). El modal renderiza el
campo "Socio (opcional)" solo para aporte/retiro (`_CreateFundMovementModal.tsx:457-486`), con
la opción "Sin socio" (`:474`). El schema lo declara
`partnerId: z.string().uuid().optional().or(z.literal(''))` con comentario "Socio (aporte /
retiro), informativo" (`shared/validators.ts:77-78`); el `superRefine` **no exige socio** para
`PARTNER_CONTRIBUTION`/`PARTNER_WITHDRAWAL` (`:133-148`). Al crear/editar el borrador se
resuelve `partnerName` con un `findFirst` y se guardan ambos (`:519-526`, `:542-543`;
`:598-605`, `:623-624`). El listado muestra `partnerName ?? '—'` (`list/columns.tsx:91`).

**Aviso de configuración**: si `isPartnerMovement && !hasContributionsAccount`, el modal muestra
la alerta naranja "Para confirmar aportes o retiros, configurá primero la 'Cuenta de aportes de
socios' en Ajustes contables" (`_CreateFundMovementModal.tsx:345-353`). No bloquea guardar el
borrador; bloquea al confirmar.

**El asiento al confirmar** (`confirmFundMovement`, `:647-807`):

1. Lee `settings` con `partnerContributionsAccountId`, `defaultBankAccountId`,
   `defaultCashAccountId` (`:665-672`).
2. Para aporte y retiro, `capitalAccountId = settings?.partnerContributionsAccountId ?? null`; si
   falta, `BusinessError('Configurá la "Cuenta de aportes de socios" en Ajustes contables antes
   de confirmar aportes o retiros.')` (`:674-683`). **`movement.partnerId` no se lee en ningún
   momento de esta función.**
3. `applyFundSide` mueve el saldo del banco/caja y devuelve su cuenta contable (`:226-315`).
4. Líneas: aporte = Debe banco/caja destino, Haber `capitalAccountId` (`:711-719`); retiro =
   Debe `capitalAccountId`, Haber banco/caja origen (`:720-728`). **Retiro usa la misma cuenta
   global**, así que la nueva lógica debe aplicarse a ambos tipos.
5. `createJournalEntryForFundMovement` verifica partida doble con `Decimal` y crea el
   `JournalEntry` (`:335-396`). El asiento nace con `createdBy: 'system'` y **sin `status`**, o
   sea `DRAFT` (default del modelo). Esto es común a todas las integraciones del sistema
   (`accounting/features/integrations/treasury/index.ts:93-111`, `bank-movements/actions.server.ts:201-207`)
   y los reportes solo suman `POSTED` (`reports/actions.server.ts:192,254,268,528`): el asiento
   hay que **registrarlo** desde Contabilidad → Asientos (`entries/actions.server.ts:112-168`,
   `postJournalEntry`) para que aparezca en el mayor. No es alcance de este ticket, pero sí
   condiciona "que el contador vea los aportes por socia en el mayor" (ver 1.6).

**Errores como dato**: las mutaciones devuelven `FundMovementActionResult` con `BusinessError`
traducido a `{ success: false, error }` (`:30-62`), porque Next redacta los `Error` lanzados en
producción (TSK-481). Cualquier validación nueva ("el socio X no tiene cuenta") debe ser un
`BusinessError`.

#### 1.2.4 Configuración contable

`src/modules/accounting/features/settings/`:

- `_CommercialIntegrationForm.tsx:131-147`, sección **"Cierre de Ejercicio"**, campo
  `partnerContributionsAccountId`, label **"Cuenta de Aportes de Socios"**, `types: ['EQUITY']`,
  ayuda: "Cuenta de Patrimonio Neto usada como contrapartida de los aportes y retiros de socios
  (Movimientos de fondos)".
- Schema `commercialIntegrationSchema` con `accountField` nullish → null (`validators.ts:12-29`);
  test en `validators.test.ts:44-71`.
- `AccountingSettings.tsx:87` pasa el default; `actions.server.ts:49` lo acepta en
  `saveAccountingSettings`.

**Qué hacer con la global**: recomiendo **conservarla como fallback y renombrarla** ("Cuenta de
aportes de socios por defecto", ayuda: "Se usa si el socio no tiene su propia cuenta de
aportes"), exactamente el criterio que ya rige para banco (`defaultBankAccountId`, ayuda "Se usa
si la cuenta bancaria no tiene cuenta específica asignada", `_CommercialIntegrationForm.tsx:123-128`)
y caja (`:117-122`). Motivos: (a) coherencia con el patrón ya aprendido por la usuaria; (b) las
empresas con un solo socio o que no quieren desglosar siguen funcionando sin configurar nada
nuevo; (c) no hace falta migración destructiva ni tocar `AccountingSettings`. Ver comparación
A vs. B en 1.2.7.

#### 1.2.5 Consumidores y reportes

`grep` amplio de `partnerContributionsAccount` fuera de `src/generated`: solo settings
(`actions.server.ts:49`, `_CommercialIntegrationForm.tsx:141`, `AccountingSettings.tsx:87`,
`validators.ts:29`, `validators.test.ts:44-71`), fund-movements (`actions.server.ts:141,149,668,677`)
y el test de integración (`fund-movement-lines.integration.test.ts:196`). **Ningún reporte lo
lee.**

`FundMovement.partnerId`/`partnerName`: solo lo escriben y muestran fund-movements
(`actions.server.ts:519-543`, `:598-624`; `columns.tsx:91`; modal `:101,164,183,223,460`).
**Ningún reporte contable lee `FundMovement`** (el módulo `accounting/features/reports` no
menciona `partner` ni `fundMovement`).

El **mayor** (`getGeneralLedger`, `reports/actions.server.ts:226-...`) agrupa por `Account`
(`account.findMany` + sumas por `account_id`), así que **con una cuenta por socio el desglose
aparece solo**, sin tocar reportes. Lo mismo el balance (`getBalanceSheet`, `:369`).

**`PartnerAccountMovement` no se alimenta desde los aportes** (verificado en 1.2.1). Es una
observación, no alcance: mezclar aportes de capital (patrimonio) con la deuda por tarjetas
(pasivo con el socio) en el mismo saldo "a favor del socio" sería incorrecto; si algún día se
quiere ver "cuánto aportó cada socia" desde la ficha del socio, conviene una pestaña propia que
lea `FundMovement where partnerId` (o el mayor de su cuenta), no `PartnerAccountMovement`.

#### 1.2.6 Datos existentes

No se pudo verificar la base de producción desde este análisis (requiere SSH al servidor
Dokploy y `psql` dentro del contenedor, ver memoria `produccion-dokploy-scripts-db.md`). La
consulta para hacerlo antes de planificar:

```sql
SELECT status, type, partner_name, count(*), sum(amount)
FROM fund_movements
WHERE type IN ('PARTNER_CONTRIBUTION','PARTNER_WITHDRAWAL')
GROUP BY 1,2,3;
```

Recomendación: **ir hacia adelante, sin migración de datos.** Motivos:

1. La clienta está recargando el banco desde cero para "llegar al saldo real" (706); los aportes
   que haya confirmado con la cuenta global los va a revisar de todos modos.
2. Un asiento confirmado no se edita (`confirmFundMovement` deja `CONFIRMED`; no existe acción de
   anulación de movimientos de fondos, solo reversión manual del asiento desde Contabilidad,
   `entries/actions.server.ts:212`, `reverseJournalEntry`). Reasignar líneas de asientos ya
   registrados por script es más riesgoso que dejar que el contador revierta y recargue los
   pocos que haya.
3. La migración de esquema es **aditiva** (una columna nullable + FK): no rompe filas existentes.

Si al correr la consulta aparecen aportes confirmados con `partner_name` cargado, se le puede
ofrecer a la clienta un script SQL opcional que reasigne `journal_entry_lines.account_id` de la
cuenta global a la del socio **solo para asientos en `DRAFT`** (los no registrados), y para los
`POSTED` el camino normal de reversión + recarga.

#### 1.2.7 Alternativas comparadas y recomendación

**A) `Partner.contributionsAccountId` (FK opcional a `Account`) en el form del socio + fallback
a la global.** Asiento usa `partner.contributionsAccountId ?? settings.partnerContributionsAccountId`.
El aporte/retiro **exige socio**. La global se renombra "por defecto".

- Pros: es el patrón ya existente para banco/caja (`schema.prisma:3197-3200`, `:3083-3088`;
  `fund-movements/list/actions.server.ts:249`, `:287`) con sus mismos mensajes de error; cubre
  717 literalmente ("en el form del socio… indicar la cuenta") y 724-d en la práctica (N cuentas,
  una por socio declarado); cambios acotados: 1 columna, `partnerSchema`, `_PartnerForm`,
  `getPartnerById`/`create`/`update`, `confirmFundMovement`, catálogos del modal; la clienta
  puede cargar los aportes **hoy mismo** después de asignar la cuenta a cada socia; las
  empresas de un solo socio no cambian nada.
- Contras: si una socia no tiene cuenta, el aporte cae en la global en silencio (mitigable:
  advertencia en el modal al elegir un socio sin cuenta, y mostrar en el listado de socios la
  columna "Cuenta de aportes"); `FundMovement.partnerId` pasa a ser obligatorio para
  aporte/retiro (rompe el caso `partnerId: ''` del test de integración,
  `fund-movement-lines.integration.test.ts:314`, `:349`, que hay que actualizar).

**B) Igual que A, sin fallback: sin cuenta en el socio no se confirma; se elimina la global.**

- Pros: fuerza el desglose, imposible imputar "por error" a la cuenta global.
- Contras: rompe a toda empresa que hoy funciona con la global (tendría que cargar socios y
  cuentas para poder seguir confirmando); obliga a migración destructiva de
  `partnerContributionsAccountId` (columna + relación + `settingsAsPartnerContributions` +
  validators + tests) sin beneficio para la clienta; contradice el patrón banco/caja. Lo que sí
  vale de B es el **error explícito nombrando al socio**: se incorpora a A como caso
  "socio sin cuenta **y** sin global configurada".

**C) Tabla `PartnerContributionAccount (companyId, partnerId, accountId)` administrada desde
Contabilidad → Configuración.**

- Pros: es la lectura literal de 724-d ("configurar más de una desde la configuración").
- Contras: es una relación 1:1 socio→cuenta disfrazada de tabla (no hay caso de uso de N
  cuentas por socio); duplica la UI (habría que construir un ABM de pares socio/cuenta en
  `_CommercialIntegrationForm.tsx`, que hoy es una grilla declarativa de campos únicos,
  `:56-236`); obliga al módulo `accounting` a listar `Partner` (que vive en `commercial`) y viola
  la regla "NO importar entre módulos" del CLAUDE.md (habría que mover la lista de socios a
  `shared/actions`); no cubre 717 (el form del socio no la muestra); la usuaria tendría que ir a
  dos pantallas para dar de alta una socia con su cuenta.

**D) Auto-crear la cuenta del socio al darlo de alta, hija de la cuenta padre configurada.**

- Pros: cero clics contables para la usuaria.
- Contras concretos: (1) el padre configurado hoy es una **hoja** en todas las empresas (la
  config solo ofrece imputables, `settings/actions.server.ts:205-212`, y el modelo trae hojas
  `3.1.1/02/00 Aportes Irrevocables`, `model-chart-of-accounts.ts:1001-1005`); colgarle hijas la
  vuelve `isLeaf=false` (`accounts/actions.server.ts:112-117`) y deja los asientos ya imputados
  al padre sobre una cuenta no imputable, además de sacarla del combo de configuración. (2) Hay
  que inventar el **código** (`@@unique([companyId, code])`, formato `x.x.x/xx/xx` validado por
  `validateAccountCodeFormat`, `accounting/shared/utils/account-code.ts:31-...`): no existe hoy
  ningún "siguiente código libre bajo un padre" en el repo. (3) `createAccount` vive en
  `accounting` y exige permiso `accounting.accounts.create` (`accounts/actions.server.ts:70`);
  llamarlo desde `createPartner` (módulo `commercial`) viola la regla de comunicación entre
  módulos y mezcla permisos. (4) El contador de la clienta ya tiene su plan de cuentas (413
  menciona Bejerman); es más probable que quiera **elegir** su cuenta que que el sistema le
  invente una.

**Recomendación: A**, con estas precisiones:

1. `Partner.contributionsAccountId String? @db.Uuid` + `contributionsAccount Account?
   @relation("PartnerContributionsAccount"...)` e inversa `partners Partner[]` en `Account`.
   Nombre distinto al de la relación existente en `AccountingSettings` (que ya se llama
   `"PartnerContributionsAccount"`, `schema.prisma:559`): usar p. ej. `"PartnerOwnContributionsAccount"`.
2. En `_PartnerForm`: campo **"Cuenta contable de aportes"** con `AccountCombobox`, opciones
   = cuentas **EQUITY imputables** (`buildImputableAccountsWhere({ companyId, types: ['EQUITY'] })`
   + `includeIds` para la ya guardada, mismo criterio que `getFundMovementLineAccounts`,
   `fund-movements/list/actions.server.ts:167-189`), ayuda: "Cuenta de Patrimonio Neto a la que
   se imputan los aportes y retiros de este socio. Si no se asigna, se usa la cuenta de aportes
   por defecto de Ajustes contables". Mostrarla también en el detalle y como columna del listado.
3. En el modal de fondos: el socio pasa a ser **obligatorio** para aporte y retiro (label
   "Socio *", sin opción "Sin socio", regla nueva en el `superRefine`); la alerta de
   configuración cambia a: si el socio elegido no tiene cuenta **y** no hay global → naranja
   bloqueante; si no tiene cuenta pero hay global → informativa ("se imputará a la cuenta por
   defecto"). Para eso `getFundMovementCatalogs` devuelve por socio `contributionsAccountId` (o
   `hasOwnAccount`) y su etiqueta.
4. En `confirmFundMovement`: leer `partner.contributionsAccountId` (validando que sea de la
   empresa, `isActive`, `isLeaf`, `type EQUITY`) → `capitalAccountId = partner.contributionsAccountId
   ?? settings.partnerContributionsAccountId`; si el socio del borrador ya no existe →
   `BusinessError('El socio del movimiento ya no existe…')`; si no hay cuenta →
   `BusinessError('El socio "X" no tiene cuenta de aportes y no hay una cuenta por defecto…')`.
   Mismo camino para `PARTNER_WITHDRAWAL`.
5. Configuración contable: renombrar el campo a "Cuenta de aportes de socios (por defecto)" y su
   ayuda. Sin cambios de schema ahí.
6. **No** auto-crear cuentas (D). Si la usuaria necesita una cuenta nueva, la crea en
   Contabilidad → Plan de cuentas (el modal `_CreateAccountModal.tsx` ya permite elegir padre);
   la guía lo explica paso a paso.

Con esto 717 queda cubierto de forma literal, 724-d queda cubierto de hecho (una cuenta por socio
declarado, N cuentas por empresa), 413/706 quedan resueltos (el aporte de cada socia va a su
cuenta y el mayor los muestra separados), y el cambio es aditivo y sin migración de datos.

### 1.3 Archivos involucrados

**A crear**

- `prisma/migrations/<timestamp>_tsk_717_partner_contributions_account/migration.sql` —
  `ALTER TABLE partners ADD COLUMN contributions_account_id UUID` + FK a `accounts(id)` (patrón
  `20260908133427_tsk_618_fixed_asset_account_flag/migration.sql`).
- `src/modules/commercial/features/treasury/features/partners/features/list/partner-account.integration.test.ts`
  (o dentro del test existente de fund-movements) — casos: aporte con socio con cuenta → Haber
  en la cuenta del socio; socio sin cuenta con global → Haber en la global; socio sin cuenta sin
  global → error nombrando al socio; retiro con cuenta del socio → Debe en la cuenta del socio.
  Molde: `fund-movements/list/fund-movement-lines.integration.test.ts:1-238` (`describe.skipIf`
  sin base, prefijo `TSK717-TEST-`, limpieza en `afterAll`).
- `docs/presentaciones/TSK-717-cuenta-por-socio.pdf` (guía de presentación al cliente, memoria
  `guia-presentacion-cliente-por-ticket.md`).

**A modificar**

- `prisma/schema.prisma:4385-4406` (`Partner`: campo + relación) y `:296-377` (`Account`:
  inversa `partners Partner[]`).
- `src/modules/commercial/features/treasury/features/partners/shared/types.ts:3-15` (`Partner`:
  `contributionsAccountId: string | null` y, para listado/detalle, `contributionsAccount:
  { code, name } | null`).
- `.../partners/shared/validators.ts:4-11` (`partnerSchema`: `contributionsAccountId:
  z.string().uuid('Cuenta contable inválida').optional().nullable()`, igual que banco,
  `treasury/shared/validators.ts:20`).
- `.../partners/features/list/actions.server.ts`: nueva `getAvailableContributionAccounts()`
  (EQUITY imputables + `includeIds`); `getPartners` (`:95-103`, incluir cuenta para la
  columna); `getPartnerById` (`:154-169`); `createPartner` (`:185-196`); `updatePartner`
  (`:227-237`); revisar `deletePartner` (`:261-274`) para que un socio con aportes en
  `FundMovement` no se borre (hoy no hay FK, ver 1.6).
- `.../partners/features/create/components/_PartnerForm.tsx:36-47` (defaults) y `:117-133`
  (nuevo `FormField` con `AccountCombobox`, patrón `_BankAccountFormModal.tsx:52-57,271-292`).
- `.../partners/features/edit/components/_EditPartnerForm.tsx:35-42` (default del campo).
- `.../partners/features/detail/components/_PartnerDetailContent.tsx:107-142` (mostrar la
  cuenta).
- `.../partners/features/list/columns.tsx:60-139` (columna "Cuenta de aportes", con
  `meta.title`).
- `src/modules/commercial/features/treasury/features/fund-movements/shared/validators.ts:77-78`
  (quitar "informativo", exigir socio en aporte/retiro dentro del `superRefine`, `:133-148`).
- `.../fund-movements/list/actions.server.ts:118-151` (`getFundMovementCatalogs`: cuenta por
  socio), `:665-683` y `:711-728` (`confirmFundMovement`: resolución por socio + errores).
- `.../fund-movements/list/components/_CreateFundMovementModal.tsx:345-353` (alerta
  condicional) y `:457-486` (socio obligatorio).
- `.../fund-movements/list/FundMovementsList.tsx:34-37` y
  `_FundMovementsTable.tsx:39,50,132,143` (si cambia la forma de `partners`).
- `.../fund-movements/list/fund-movement-lines.integration.test.ts:301-334` (aporte) y
  `:336-...` (retiro): pasar un `partnerId` real; agregar casos por socio.
- `.../fund-movements/shared/validators.test.ts:88-175` (`fundMovementSchema`: nuevo caso
  "exige el socio en aporte y retiro").
- `src/modules/accounting/features/settings/components/_CommercialIntegrationForm.tsx:140-145`
  (label y ayuda "por defecto").
- `src/modules/help/features/guide/components/_TreasuryGuide.tsx:757-863` (Movimientos de
  Fondos: socio obligatorio, cuenta por socio, alerta) y **nueva sección "Socios"** (hoy la guía
  de Tesorería no documenta el ABM de socios: `grep` de "Socios" solo da la sección de fondos).
- `src/modules/help/features/guide/components/_AccountingGuide.tsx:229` ("Resultado del
  Ejercicio y Aportes de Socios" → aclarar que es la por defecto).
- `docs/architecture/data-model.md:363` (fila `FundMovement`: `partnerId` deja de ser
  informativo) y agregar `Partner.contributionsAccountId`; `docs/modules/commercial.md` o
  `docs/modules/treasury-*.md` (no existe doc de socios/fondos: crear sección).

**Solo lectura (referencia de patrón)**

- `src/shared/lib/accounts/imputable-accounts.ts:33-46`.
- `src/shared/components/common/AccountCombobox.tsx:19-57`.
- `src/modules/commercial/features/treasury/features/bank-accounts/list/actions.server.ts:245-270`
  y `cash-registers/list/actions.server.ts:16-26`.
- `src/modules/accounting/features/settings/actions.server.ts:199-228`.
- `src/modules/accounting/features/accounts/data/model-chart-of-accounts.ts:299-315, 977-1017`.
- `docs/superpowers/specs/2026-07-10-movimientos-de-fondos-design.md`.

### 1.4 Dependencias

- **Prisma 7 + migración**: columna nullable y FK; `npm run db:migrate` local y
  `docker-entrypoint.sh` en producción (memoria `produccion-dokploy-scripts-db.md`).
- **`AccountCombobox`** (`shared/components/common`, TSK-464) y `buildImputableAccountsWhere`
  (`shared/lib/accounts`): ya existen, sin cambios.
- **Plan de cuentas de la empresa**: la clienta (o su contador) tiene que **crear una cuenta
  EQUITY imputable por socia** (p. ej. bajo `3.1.1/00/00 CAPITAL SOCIAL`) antes de asignarlas.
  El sistema no las crea (decisión de 1.2.7).
- **Regla 11 (permisos)**: `getAvailableContributionAccounts` con
  `checkPermission('commercial.treasury.partners', 'view')`; el resto ya está cubierto.
- **Regla "NO importar entre módulos"**: la lista de cuentas EQUITY se consulta desde
  `partners/.../actions.server.ts` con Prisma directo + `buildImputableAccountsWhere` de
  `shared`, sin importar de `accounting`.

### 1.5 Restricciones y reglas

- Decimales a `Number()` antes de Client Components (regla 9) — `getPartners` ya lo hace con
  `balance`; la cuenta nueva no tiene decimales.
- `logger`, no `console`; `AlertDialog`, no `confirm()`; `moment`, no `date-fns`.
- Componentes < 200 líneas: `_PartnerForm.tsx` tiene 167; con el nuevo campo (~25 líneas) roza
  el límite → considerar extraer `_PartnerAccountField.tsx`. `_CreateFundMovementModal.tsx` ya
  tiene 520 (deuda previa; no empeorarlo: la alerta condicional debería ser un componente
  chico).
- Errores esperables en fund-movements como `BusinessError` → `{ success: false, error }`
  (`actions.server.ts:30-62`), nunca `throw` suelto.
- Tests con **Vitest** (`npm run test`, `vitest.config.ts` incluye `src/**/*.test.ts`), **no
  Cypress** (memoria `testing-real-es-vitest-no-cypress.md`; no existe `cypress/`).
- Guía de usuario in-app (regla 10) + docs/ (regla 8) + **PDF de presentación al cliente**
  (memoria `guia-presentacion-cliente-por-ticket.md`).
- No registrar módulo nuevo en `ACTIVATABLE_MODULES` (`.claude/rules/modules.md`): no se crea
  ningún módulo de primer nivel; `commercial.treasury.partners` y
  `commercial.treasury.fund-movements` ya están mapeados.

### 1.6 Riesgos identificados

1. **Borradores existentes sin socio.** Al volver obligatorio el socio, un borrador
   `PARTNER_CONTRIBUTION` guardado sin `partnerId` no podrá confirmarse desde el listado hasta
   editarlo. El mensaje de `confirmFundMovement` debe decirlo ("Editá el movimiento y elegí el
   socio"). Mitigación adicional: el test de integración cubre "borrador sin socio → error
   claro".
2. **`FundMovement.partnerId` sin FK** (`schema.prisma:4346`): un socio se puede borrar con
   aportes confirmados o en borrador (`deletePartner` no lo controla, `list/actions.server.ts:261-274`).
   Con la cuenta por socio, un borrador cuyo socio fue borrado fallaría al confirmar.
   Recomendación: en este ticket, bloquear `deletePartner` si existen `fundMovement` con ese
   `partnerId` (consulta explícita, sin agregar FK para no arrastrar una migración de datos
   sobre `partner_id` huérfanos); evaluar la FK en un ticket aparte.
3. **Cambio de cuenta del socio con aportes ya confirmados.** Si se edita la cuenta de la socia,
   los asientos anteriores quedan en la cuenta vieja (correcto: el asiento es histórico). La
   guía debe aclararlo y el detalle del socio podría avisar "cambiar la cuenta no modifica
   asientos anteriores".
4. **Cuenta del socio deja de ser imputable** (se le cuelga una hija, se da de baja o se corta
   por ejercicio): `confirmFundMovement` debe validar `isLeaf`/`isActive`/`disabledFrom` con
   `buildImputableAccountsWhere` y devolver un `BusinessError` que nombre al socio y a la
   cuenta; el combo del socio debe preservar la cuenta guardada vía `includeIds` (patrón
   `fund-movements/list/actions.server.ts:158-176`).
5. **Asientos generados nacen en `DRAFT`** (1.2.3): el mayor no mostrará el desglose por socia
   hasta que el contador registre los asientos. Preexistente y transversal; hay que dejarlo
   explícito en la guía y en la presentación para que no se lea como "no funcionó".
6. **Tipo de cuenta esperado por el contador.** El combo del socio filtrará EQUITY (coherente con
   la global). Si el contador de la clienta quisiera usar las "Cuenta Part. Socio N" del plan
   modelo (ASSET, `model-chart-of-accounts.ts:299-315`) no las vería; ver pregunta abierta 1.
7. **Regresión en el test de integración** (`fund-movement-lines.integration.test.ts:301-334`,
   `:336-...`): los casos de aporte/retiro pasan `partnerId: ''`; con socio obligatorio fallan.
   Hay que sembrar un `Partner` en el `beforeAll` y limpiarlo en el `afterAll` (agregar
   `prisma.partner.deleteMany({ where: { companyId } })` antes de borrar cuentas, porque la FK
   nueva apunta a `accounts`).

### 1.7 Preguntas abiertas

Solo las que cambian el diseño:

1. **¿La cuenta del socio debe ser exclusivamente de Patrimonio Neto (EQUITY)?** Es lo coherente
   con la global actual y con el asiento "banco contra capital" del spec de 413. Pero el plan
   modelo trae "Cuenta Part. Socio 1/2/3" como **activo** (créditos diversos), que es lo que un
   contador usa para la cuenta particular del socio (otro concepto: lo que el socio le debe a la
   empresa). Si el contador de PMS quisiera imputar aportes ahí, el filtro debería admitir
   `['EQUITY','ASSET']`. **Propuesta por defecto: solo EQUITY**; confirmar con la clienta con la
   pantalla ya funcionando (es un cambio de una constante, no de diseño).
2. **¿El socio pasa a ser obligatorio también para `PARTNER_WITHDRAWAL`?** El análisis asume que
   sí (misma lógica y misma cuenta que el aporte). Si la clienta usa "retiro de socio" para
   retiros genéricos sin socio identificado, habría que dejarlo opcional solo en retiro. Propuesta:
   obligatorio en ambos; es lo que pide 724-d ("cada una debe corresponder a uno de los socios").

No hay otras preguntas que cambien el diseño: el fallback a la global, la no auto-creación de
cuentas y el "ir hacia adelante" sin migración de datos están recomendados con fundamento en 1.2.

---

## 2. Planificación

Seis fases que implementan la **alternativa A** del análisis (1.2.7) con las decisiones ya
tomadas por el usuario: `Partner.contributionsAccountId` (FK opcional a `Account`) editable en el
form del socio con `AccountCombobox`; el asiento de aporte y retiro usa
`partner.contributionsAccountId ?? settings.partnerContributionsAccountId` y, si no hay ninguna,
la confirmación falla con un `BusinessError` que nombra al socio y dice dónde configurarla; la
global se renombra "por defecto"; el **socio pasa a ser obligatorio** en aporte y retiro; la
cuenta del socio puede ser **Activo, Pasivo o Patrimonio** (solo se excluyen Ingresos y Egresos);
sin migración de datos. El orden va del dato hacia la superficie: primero el esquema, después la
feature de socios (que es donde se carga la cuenta), después el asiento (que es donde se usa), y
al final configuración, documentación y verificación.

Decisiones tomadas en esta planificación, donde el usuario dejó margen:

- **`onDelete: SetNull`** en la FK nueva. Es lo que ya rige para `BankAccount.account` y
  `CashRegister.account` (`prisma/schema.prisma:3088`, `:3200`: sin `onDelete` explícito, que en
  Prisma equivale a `SetNull` para una relación opcional), y la baja de cuentas es un **soft
  delete** (`accounting/features/accounts/actions.server.ts:302-345` pone `isActive: false`, no
  borra la fila), así que la FK física casi nunca se dispara. `Restrict` haría fallar el borrado de
  una cuenta con un P2003 que el módulo `accounting` no sabe explicar (el socio vive en
  `commercial`). El caso real —cuenta dada de baja pero todavía asignada— lo cubre la validación de
  imputabilidad en `confirmFundMovement` (fase 3) más `includeIds` en el combo (fase 2).
- **`deletePartner` se mantiene como borrado físico bloqueado**, sumando un tercer bloqueo: hoy
  ya rechaza socios con `movements` o `cards` (`partners/features/list/actions.server.ts:270-274`)
  y el form ya tiene el switch "Activo" (`_PartnerForm.tsx:135-151`) como camino de
  desactivación. No se convierte a desactivación automática: se agrega la cuenta de
  `fundMovement` (cualquier estado, también `DRAFT`) al bloqueo, con un mensaje que sugiere
  desactivarlo.
- **Action nueva `getPartnerContributionAccounts(includeIds?)`** en la feature de socios. La de
  bancos (`getAvailableAccounts`, `bank-accounts/list/actions.server.ts:245-270`) no sirve:
  filtra solo `ASSET`, no exige `isLeaf`, no soporta `includeIds` y pide el permiso de bancos.
- **La global sigue siendo `types: ['EQUITY']`** en la configuración contable: la decisión de
  ampliar tipos aplica a la cuenta del socio, no a la por defecto.

Testing: **Vitest** (`npm run test` → `vitest run`, `vitest.config.ts` incluye
`src/**/*.test.ts`; memoria `testing-real-es-vitest-no-cypress`). No se pueden testear
componentes `.tsx`; el TDD se aplica a los validators Zod (fases 2 y 3) y a la cadena real
`createFundMovement(…, true)` → `confirmFundMovement` contra la base de dev (fase 3), con el
mismo molde de `fund-movement-lines.integration.test.ts`. En esas fases el test se escribe
**antes** del código.

### 2.1 Fases de implementación

#### Fase 1: Esquema y migración aditiva

- **Objetivo:** que `Partner` pueda apuntar a una cuenta contable, con una migración que solo
  agrega una columna nullable y su FK, sin tocar filas existentes ni `AccountingSettings`.
- **Tareas:**
  - [x] `prisma/schema.prisma:4385-4407` (`model Partner`): agregar, debajo de `isActive`
        (`:4393`), `contributionsAccountId String? @map("contributions_account_id") @db.Uuid` con
        comentario `// TSK-717: cuenta contable propia para aportes/retiros; null = usa la por
        defecto de AccountingSettings`. En el bloque de relaciones (`:4395-4399`) agregar
        `contributionsAccount Account? @relation("PartnerOwnContributionsAccount", fields:
        [contributionsAccountId], references: [id], onDelete: SetNull)`. El nombre de relación
        **no** puede ser `"PartnerContributionsAccount"`: ya lo usa `AccountingSettings`
        (`:559`). Agregar `@@index([contributionsAccountId])` junto al `@@index([companyId])`
        (`:4405`). Actualizar el comentario del modelo (`:4384`) para mencionar la cuenta de
        aportes.
  - [x] `prisma/schema.prisma:325-326` (`model Account`, después de `cashRegisters CashRegister[]`):
        agregar la inversa `partners Partner[] @relation("PartnerOwnContributionsAccount") //
        Socios con cuenta de aportes propia (TSK-717)`.
  - [x] Correr `npm run db:migrate -- --name tsk_717_partner_contributions_account`. Verificar que
        el SQL generado en
        `prisma/migrations/<timestamp>_tsk_717_partner_contributions_account/migration.sql` sea
        exactamente: `ALTER TABLE "partners" ADD COLUMN "contributions_account_id" UUID;`, un
        `CREATE INDEX` y un `ADD CONSTRAINT "partners_contributions_account_id_fkey" FOREIGN KEY
        … REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE` (mismo formato que
        `20260831124739_fund_movement_lines/migration.sql:21-22`). **Sin `UPDATE`, sin
        backfill.** Si `migrate dev` detecta drift ajeno al ticket, no resetear la base: revisar
        antes con `npx prisma migrate status`.
  - [x] `npm run db:generate` y `npm run check-types`: el conteo de errores debe seguir en la línea
        base (227) porque el campo es opcional y nadie lo consume todavía.
  - [x] Anotar en la sección 4 del documento que en producción la migración la aplica solo el
        `docker-entrypoint.sh` al deployar (memoria `produccion-dokploy-scripts-db`); no hay
        script manual que correr.
- **Archivos:**
  - Crear: `prisma/migrations/<timestamp>_tsk_717_partner_contributions_account/migration.sql`
  - Modificar: `prisma/schema.prisma`
- **Criterio de completitud:** `npx prisma migrate status` en verde; `src/generated/prisma`
  expone `Partner.contributionsAccountId` y `Partner.contributionsAccount`; `check-types` sin
  errores nuevos; la app arranca y `/dashboard/commercial/treasury/partners` se ve igual que antes.

#### Fase 2: Socios — cargar y mostrar la cuenta de aportes (TDD en validators)

- **Objetivo:** que al crear o editar un socio se pueda elegir su cuenta contable de aportes
  (imputable, de Activo, Pasivo o Patrimonio), que se vea en el listado y en el detalle, y que un
  socio con aportes o retiros registrados no se pueda borrar.
- **Tareas:**
  - [x] Escribir **primero**
        `src/modules/commercial/features/treasury/features/partners/shared/validators.test.ts`
        (Vitest puro, sin base; estilo de `fund-movements/shared/validators.test.ts:88-175`).
        Casos sobre `partnerSchema`: (a) acepta un socio solo con `name` y sin
        `contributionsAccountId` (ausente); (b) acepta `contributionsAccountId: null`; (c) acepta
        un uuid válido; (d) rechaza `'abc'` con el mensaje `'Cuenta contable inválida'`; (e) sigue
        rechazando `name` vacío (regresión). Debe fallar en rojo porque el campo todavía no existe.
  - [x] `partners/shared/validators.ts:4-11` (`partnerSchema`): agregar
        `contributionsAccountId: z.string().uuid('Cuenta contable inválida').nullable().optional()`
        (mismo criterio que `accountId` del banco, `treasury/shared/validators.ts:20`). El tipo
        `PartnerFormData` (`:32`) se actualiza solo por inferencia. Test en verde.
  - [x] `partners/shared/types.ts:3-15` (`Partner`): agregar `contributionsAccountId: string |
        null`. Declarar `export type PartnerAccountRef = { id: string; code: string; name: string }`
        y `export interface PartnerWithAccount extends Partner { contributionsAccount:
        PartnerAccountRef | null }`; en `PartnerWithBalance` (`:17-20`) cambiar `extends Partner`
        por `extends PartnerWithAccount` para que el listado traiga la cuenta. Es un tipo escrito a
        mano (no inferido), así que **hay que tocarlo** o el `check-types` falla al asignar el
        resultado de Prisma.
  - [x] `partners/features/list/actions.server.ts`: nueva action exportada
        `getPartnerContributionAccounts(includeIds?: string[])`:
        `checkPermission('commercial.treasury.partners', 'view', { redirect: true })` +
        `getActiveCompanyId()`; `where` = `buildImputableAccountsWhere({ companyId, types:
        ['ASSET', 'LIABILITY', 'EQUITY'] })` de `@/shared/lib/accounts/imputable-accounts`, y si
        hay `includeIds`, `{ OR: [imputableWhere, { companyId, id: { in: includeIds } }] }` (el
        `where` imputable ya tiene su propio `OR` interno por `disabledFrom`, por eso se envuelve
        y no se mezcla; patrón exacto de `fund-movements/list/actions.server.ts:172-176`).
        `select: { id, code, name }`, `orderBy: { code: 'asc' }`. Sin importar nada de
        `accounting` (regla de no importar entre módulos). Exportar `export type
        PartnerContributionAccountOption = Awaited<ReturnType<typeof
        getPartnerContributionAccounts>>[number]`.
  - [x] `getPartners` (`:95-103`): al `findMany` agregar `include: { contributionsAccount: {
        select: { id: true, code: true, name: true } } }`; el `map` de `:110-113` ya hace spread,
        así que `PartnerWithBalance` queda completo sin más cambios. Sin `Decimal` nuevos.
  - [x] `getPartnerById` (`:154-169`): mismo `include`; cambiar el tipo de retorno a
        `Promise<PartnerWithAccount | null>`. Lo consumen `PartnerDetail.tsx:14-17` y
        `EditPartner.tsx:11` (ambos siguen compilando porque `PartnerWithAccount extends Partner`).
  - [x] `createPartner` (`:185-196`) y `updatePartner` (`:227-237`): agregar
        `contributionsAccountId: validatedData.contributionsAccountId ?? null` al `data`. Antes de
        escribir, si viene un id, validar con un `prisma.account.findFirst({ where: { id,
        companyId }, select: { id: true } })` que la cuenta sea de la empresa; si no,
        `throw new Error('La cuenta contable seleccionada no pertenece a la empresa')` (acá los
        errores sí viajan como excepción: `_CreatePartnerForm.tsx:22-25` y
        `_EditPartnerForm.tsx:27-30` los muestran con `toast.error(error.message)`). No exigir
        imputable en el guardado: el combo ya filtra, y una cuenta que dejó de ser imputable se
        conserva a propósito (`includeIds`); quien la rechaza es la confirmación del asiento
        (fase 3).
  - [x] `deletePartner` (`:261-274`): sumar al `findFirst` un conteo aparte
        `prisma.fundMovement.count({ where: { companyId, partnerId: id } })` (no hay FK ni relación
        Prisma entre `FundMovement.partnerId` y `Partner`, `schema.prisma:4346`, así que no entra
        en el `_count`). Si `> 0`: `throw new Error('No se puede eliminar un socio con aportes o
        retiros registrados. Desactivalo desde Editar si ya no opera.')`. Mantener el bloqueo
        existente por `movements`/`cards` (`:270-274`) tal cual.
  - [x] Crear
        `partners/features/create/components/_PartnerAccountField.tsx` (Client Component, < 80
        líneas) para no pasar las 200 líneas en `_PartnerForm.tsx` (hoy 167). Props: `{ control:
        Control<PartnerFormData>; savedAccountId?: string | null }`. Hace `useQuery({ queryKey:
        ['partner-contribution-accounts', savedAccountId], queryFn: () =>
        getPartnerContributionAccounts(savedAccountId ? [savedAccountId] : undefined) })`
        (patrón `_BankAccountFormModal.tsx:52-57`) y renderiza un `FormField name=
        "contributionsAccountId"` con `FormLabel` **"Cuenta contable de aportes (opcional)"**,
        `AccountCombobox` (`accounts`, `value={field.value ?? null}`, `onChange={field.onChange}`,
        `placeholder="Sin asignar"`, `clearLabel="Sin asignar (usar la cuenta por defecto)"`) y
        `FormDescription`: "Cuenta a la que se imputan los aportes y retiros de este socio. Puede
        ser de Activo, Pasivo o Patrimonio Neto, según el criterio de tu contador. Si no se
        asigna, se usa la cuenta de aportes por defecto de Ajustes contables. Cambiarla no
        modifica los asientos ya generados." Debe funcionar en `page.tsx` server-first: el
        `QueryClientProvider` ya envuelve el dashboard (lo usa `_BankAccountFormModal`).
  - [x] `_PartnerForm.tsx`: agregar `contributionsAccountId: null` a los `defaultValues`
        (`:38-46`); agregar prop opcional `savedAccountId?: string | null` a `PartnerFormProps`
        (`:23-28`); insertar `<_PartnerAccountField control={form.control}
        savedAccountId={savedAccountId} />` entre el campo `notes` (`:117-133`) y el switch
        `isActive` (`:135`). Sigue habiendo un solo `Card`.
  - [x] `_EditPartnerForm.tsx:35-42` (`defaultValues`): agregar `contributionsAccountId:
        partner.contributionsAccountId ?? null`; pasar `savedAccountId={partner.contributionsAccountId}`
        a `_PartnerForm` (`:44-51`). `_CreatePartnerForm.tsx` no cambia (sin `savedAccountId`).
  - [x] `partners/features/list/columns.tsx`: nueva columna entre "Teléfono" (`:106-120`) y
        "Saldo a favor" (`:121-139`): `accessorKey: 'contributionsAccount'`, `meta: { title:
        'Cuenta de aportes' }`, `enableSorting: false`, celda `code · name` en `font-mono text-xs`
        si existe, o `<span className="text-muted-foreground">Por defecto</span>` si es `null`
        (deja visible a simple vista qué socias siguen cayendo en la global, mitigación del
        contra de la alternativa A). Sin cambios en `_PartnersTable.tsx`.
  - [x] `_PartnerDetailContent.tsx:107-142` (card "Datos del Socio"): cambiar la prop a
        `partner: PartnerWithAccount` (`:30-32`) y agregar al grid (`:113-130`) el bloque "Cuenta
        contable de aportes" con `code - name` o "Por defecto (Ajustes contables)". Debajo, un
        `<p className="text-xs text-muted-foreground">` con "Cambiar esta cuenta no modifica los
        asientos ya generados" (riesgo 3 del análisis). `PartnerDetail.tsx:32` ya le pasa el
        resultado de `getPartnerById`.
  - [x] `_PartnerForm.tsx` conserva menos de 200 líneas; `_PartnerAccountField.tsx` y
        `_PartnerDetailContent.tsx` también. Verificar con `wc -l`.
- **Archivos:**
  - Crear: `partners/shared/validators.test.ts`,
    `partners/features/create/components/_PartnerAccountField.tsx`
  - Modificar: `partners/shared/validators.ts`, `partners/shared/types.ts`,
    `partners/features/list/actions.server.ts`, `partners/features/list/columns.tsx`,
    `partners/features/create/components/_PartnerForm.tsx`,
    `partners/features/edit/components/_EditPartnerForm.tsx`,
    `partners/features/detail/components/_PartnerDetailContent.tsx`
    (todos bajo `src/modules/commercial/features/treasury/features/`)
- **Criterio de completitud:** `npm run test` en verde con `validators.test.ts` nuevo (primero
  rojo, después verde); en `/dashboard/commercial/treasury/partners/new` el combo ofrece cuentas
  hoja activas de Activo, Pasivo y Patrimonio y **ninguna** de Ingresos/Egresos; al editar un
  socio con cuenta asignada el combo la muestra seleccionada (también si la cuenta fue dada de
  baja); el listado muestra la columna "Cuenta de aportes" con `meta.title`; el detalle muestra la
  cuenta; borrar un socio con un aporte en borrador o confirmado devuelve el mensaje nuevo;
  `check-types` sin errores nuevos.

#### Fase 3: Movimientos de fondos — socio obligatorio y asiento por socio (TDD unitario + integración)

- **Objetivo:** que aporte y retiro exijan socio, que el asiento se impute a la cuenta del socio
  (Haber en aporte, Debe en retiro) con fallback a la global, que sin ninguna de las dos la
  confirmación falle nombrando al socio, y que el modal avise de antemano qué cuenta se va a usar.
- **Tareas:**
  - [x] **Validators (TDD).** En `fund-movements/shared/validators.test.ts`: cambiar la fixture
        `aporte` (`:89-98`) a `partnerId: uuid` (si no, `'acepta un aporte con banco de destino'`
        `:100` y `'un aporte sigue siendo válido sin líneas'` `:292` fallan por la razón
        equivocada); agregar en el `describe('fundMovementSchema')` los casos: `'exige el socio en
        un aporte'` (`partnerId: ''` → issue en `path ['partnerId']` con mensaje `'Seleccioná el
        socio'`), `'exige el socio en un retiro'` (idem con `PARTNER_WITHDRAWAL` y `sourceFund`),
        `'una transferencia no exige socio'` y `'un gasto bancario no exige socio'` (ambos con
        `partnerId: ''` → `success: true`). Rojo primero.
  - [x] `fund-movements/shared/validators.ts:77-78`: cambiar el comentario a `// Socio del aporte /
        retiro. Obligatorio para esos dos tipos (ver superRefine); define la cuenta del asiento
        (TSK-717)`. El tipo base queda `z.string().uuid().optional().or(z.literal(''))` (los otros
        dos tipos siguen mandando `''`). En el `superRefine`, dentro de las ramas
        `PARTNER_CONTRIBUTION` (`:133-140`) y `PARTNER_WITHDRAWAL` (`:141-148`), agregar `if
        (!data.partnerId) ctx.addIssue({ code: custom, path: ['partnerId'], message: 'Seleccioná
        el socio' })`. **No** tocarlo en `ACCOUNT_TRANSFER` ni `BANK_CHARGES`. Verde.
  - [x] **Test de integración existente.** `fund-movements/list/fund-movement-lines.integration.test.ts`:
        en el `beforeAll` (`:136-204`) crear un `Partner` con `prisma.partner.create({ data: {
        companyId, name: \`${PREFIX}Socio fundador\`, createdBy: \`${PREFIX}user\` } })`
        (`createdBy` es obligatorio, `schema.prisma:4401`) y guardar `partnerId`; en los casos de
        aporte (`:314`) y retiro (`:349`) reemplazar `partnerId: ''` por `partnerId`. Este socio
        **no** tiene cuenta propia, así que esos dos casos siguen esperando la global
        (`capitalAccountId`) y pasan a documentar el fallback. En el `afterAll` (`:219-224`)
        agregar `await prisma.partner.deleteMany({ where: { companyId } })` **después** de
        `fundMovement.deleteMany` y **antes** de `account.deleteMany` (la FK nueva apunta a
        `accounts`). Los casos BANK_CHARGES (`:253`) y transferencia siguen con `partnerId: ''`.
  - [x] **Test de integración nuevo (rojo primero).** Crear
        `fund-movements/list/fund-movement-partner-account.integration.test.ts` con el mismo
        andamiaje (`describe.skipIf(!dbAvailable)`, los cuatro `vi.mock` de `:76-79`, prefijo
        `TSK717-TEST-`, `afterAll` con guarda `if (companyId)` y limpieza en el orden
        `fundMovement → journalEntry → bankAccount → accountingSettings → partner → account →
        company`, más el `count` final por prefijo). `beforeAll`: empresa, cuenta ASSET banco,
        `BankAccount` con `accountId`, cuenta EQUITY `global`, cuenta ASSET `cuentaSociaA` (para
        cubrir que el tipo Activo se acepta), `AccountingSettings` con
        `partnerContributionsAccountId: global`, `Partner` `sociaA` con `contributionsAccountId:
        cuentaSociaA`, `Partner` `sociaB` sin cuenta. Casos, siempre por `createFundMovement(input,
        true)` real y leyendo `journal_entry_lines`:
    - Aporte de `sociaA` → 2 líneas: Debe banco, **Haber `cuentaSociaA`**; ninguna línea toca
      `global`.
    - Aporte de `sociaB` → Haber `global` (fallback).
    - Retiro de `sociaA` → **Debe `cuentaSociaA`**, Haber banco.
    - `sociaB` sin global: `prisma.accountingSettings.update({ partnerContributionsAccountId: null
      })`, aporte → `success: false` y `error` contiene el nombre de `sociaB`, "no tiene cuenta de
      aportes" y "Ajustes contables"; el movimiento queda en `DRAFT` sin `journalEntryId`;
      restaurar la global al final del caso.
    - Borrador viejo sin socio: `prisma.fundMovement.create` directo con `type:
      'PARTNER_CONTRIBUTION'`, `partnerId: null`, `fundInKind/fundInId` del banco y `status:
      'DRAFT'` (saltea el schema a propósito, es el dato legado del riesgo 1), luego
      `confirmFundMovement(id)` → `success: false` y `error` contiene "Editá el movimiento y elegí
      el socio".
    - Cuenta del socio no imputable: `prisma.account.update({ where: { id: cuentaSociaA }, data:
      { isActive: false } })`, aporte de `sociaA` → `success: false`, `error` nombra a la socia y
      a la cuenta (`code`); restaurar `isActive: true`.
  - [x] `fund-movements/list/actions.server.ts`, **`getFundMovementCatalogs` (`:118-151`)**: en
        `prisma.partner.findMany` (`:134-138`) agregar al `select` `contributionsAccount: {
        select: { id: true, code: true, name: true } }`; en `accountingSettings.findUnique`
        (`:139-142`) cambiar el `select` a `partnerContributionsAccount: { select: { id: true,
        code: true, name: true } }`. En el `return` (`:145-150`) devolver `partners` mapeados a
        `{ id, name, contributionsAccount }` y **reemplazar** `hasContributionsAccount: boolean`
        por `defaultContributionsAccount: settings?.partnerContributionsAccount ?? null`. El tipo
        exportado `FundMovementPartnerOption` (`:838-840`) se actualiza solo por inferencia;
        agregar `export type FundMovementAccountRef = { id: string; code: string; name: string }`.
  - [x] **`confirmFundMovement` (`:647-807`)**: reemplazar el bloque `:674-683` por una función
        privada `resolvePartnerCapitalAccount(movement, settings, companyId)` (misma sección
        HELPERS, antes de `applyFundSide`) que, solo para `PARTNER_CONTRIBUTION` y
        `PARTNER_WITHDRAWAL`:
    1. Si `!movement.partnerId` → `BusinessError('Este movimiento no tiene socio asignado. Editá
       el movimiento y elegí el socio antes de confirmarlo.')` (riesgo 1: borradores previos).
    2. `prisma.partner.findFirst({ where: { id: movement.partnerId, companyId }, select: { name,
       contributionsAccountId, contributionsAccount: { select: { code, name } } } })`; si no
       existe → `BusinessError('El socio del movimiento ya no existe. Editá el movimiento y elegí
       otro socio.')`. No bloquear por `isActive`: el borrador se creó cuando estaba activo.
    3. Si el socio tiene `contributionsAccountId`, verificar que sea imputable con
       `prisma.account.findFirst({ where: { ...buildImputableAccountsWhere({ companyId, types:
       ['ASSET','LIABILITY','EQUITY'] }), id: contributionsAccountId } })`; si no →
       `BusinessError(\`La cuenta de aportes "${code} - ${name}" del socio "${partner.name}" no
       está activa o no es imputable. Corregila en Tesorería → Socios → Editar.\`)`. **No** caer a
       la global en este caso: sería imputar en silencio a otra cuenta.
    4. `capitalAccountId = partner.contributionsAccountId ?? settings?.partnerContributionsAccountId
       ?? null`; si es `null` → `BusinessError(\`El socio "${partner.name}" no tiene cuenta de
       aportes y no hay una cuenta por defecto. Asignale una en Tesorería → Socios → Editar, o
       configurá la "Cuenta de aportes de socios por defecto" en Ajustes contables.\`)`.
        Devolver `capitalAccountId`. Las líneas del asiento (`:719` y `:728`) no cambian de forma:
        siguen siendo `parLineas(dest.accountId, capitalAccountId)` en aporte y
        `parLineas(capitalAccountId, src.accountId)` en retiro; solo cambia de dónde sale el id.
        Quitar el `!` de `capitalAccountId!` tipando la variable como `string` dentro de la rama.
  - [x] `createFundMovement` (`:519-526`) y `updateFundMovement` (`:598-605`): el `findFirst` del
        socio hoy tolera que no exista (`partnerName = partner?.name ?? null`). Para aporte y
        retiro, si `data.partnerId` viene pero el socio no es de la empresa → `BusinessError('El
        socio seleccionado no es válido')`, para que el borrador no nazca huérfano. Transferencia y
        gastos bancarios no cambian.
  - [x] `FundMovementsList.tsx:34-37` y `_FundMovementsTable.tsx:39-40, 50-51, 132-133, 143-144`:
        reemplazar la prop `hasContributionsAccount: boolean` por `defaultContributionsAccount:
        FundMovementAccountRef | null` (importar el tipo desde `../actions.server`).
  - [x] Crear `fund-movements/list/components/_PartnerAccountNotice.tsx` (Client Component,
        < 70 líneas), para no engordar `_CreateFundMovementModal.tsx` (520 líneas, deuda previa).
        Props: `{ partner: FundMovementPartnerOption | undefined; defaultAccount:
        FundMovementAccountRef | null }`. Cuatro estados, reutilizando las clases de la alerta
        naranja actual (`:346`) y una variante neutra (`border bg-muted/50 text-muted-foreground`)
        con ícono `Info`:
    - socio con cuenta propia → neutra: "El asiento se imputará a la cuenta {code} - {name} de
      {partner.name}."
    - socio sin cuenta y hay global → neutra: "{partner.name} no tiene cuenta de aportes propia:
      se usará la cuenta por defecto {code} - {name}."
    - socio sin cuenta y sin global → naranja: "{partner.name} no tiene cuenta de aportes y no hay
      una cuenta por defecto. Asignale una en Tesorería → Socios, o configurá la 'Cuenta de
      aportes de socios por defecto' en Ajustes contables. No vas a poder confirmar."
    - sin socio elegido y sin global → naranja: "Para confirmar aportes o retiros hace falta una
      cuenta de aportes: asignala al socio o configurá la por defecto en Ajustes contables." (sin
      socio y con global: no renderiza nada; el campo obligatorio ya lo marca).
  - [x] `_CreateFundMovementModal.tsx`: en `Props` (`:61-70`) y la desestructuración (`:78-87`)
        reemplazar `hasContributionsAccount` por `defaultContributionsAccount`; reemplazar el
        bloque de alerta `:345-353` por `{isPartnerMovement && <_PartnerAccountNotice
        partner={partners.find((p) => p.id === partnerId)} defaultAccount=
        {defaultContributionsAccount} />}` con `const partnerId = form.watch('partnerId')` junto
        a `type` (`:189`). En el campo socio (`:457-486`): label **"Socio *"**, quitar el
        `SelectItem value={NONE}` (`:474`) y la constante `NONE` (`:72`) si queda sin uso,
        `onValueChange={field.onChange}`, `value={field.value || undefined}`, `placeholder=
        "Seleccionar socio"`. El `FormMessage` ya muestra "Seleccioná el socio". En el efecto de
        limpieza (`:218-228`) cambiar la condición de `isBankCharges` a `!isPartnerMovement` para
        `partnerId`, así una transferencia tampoco arrastra un socio elegido en un tipo anterior
        (hoy solo se limpia para gastos bancarios; el servidor persiste `partnerId` sin mirar el
        tipo).
  - [x] Verificar que en el listado la columna "Socio" (`fund-movements/list/columns.tsx:91`)
        sigue mostrando `partnerName`; no cambia.
- **Archivos:**
  - Crear: `fund-movements/list/fund-movement-partner-account.integration.test.ts`,
    `fund-movements/list/components/_PartnerAccountNotice.tsx`
  - Modificar: `fund-movements/shared/validators.ts`, `fund-movements/shared/validators.test.ts`,
    `fund-movements/list/actions.server.ts`,
    `fund-movements/list/fund-movement-lines.integration.test.ts`,
    `fund-movements/list/FundMovementsList.tsx`,
    `fund-movements/list/components/_FundMovementsTable.tsx`,
    `fund-movements/list/components/_CreateFundMovementModal.tsx`
    (todos bajo `src/modules/commercial/features/treasury/features/`)
- **Criterio de completitud:** `npm run test` en verde: validators (casos nuevos), el test de
  integración existente (aporte/retiro con socio real → global) y el nuevo (seis casos); en el
  modal, elegir "Aporte de socio" sin socio y confirmar muestra "Seleccioná el socio"; el aviso
  cambia al elegir un socio con y sin cuenta; el asiento generado para una socia con cuenta tiene
  su cuenta en el Haber (Contabilidad → Asientos, detalle); el retiro la tiene en el Debe; un
  borrador viejo sin socio muestra el error al confirmar desde el listado y se puede editar para
  elegir socio; transferencias y gastos bancarios se guardan igual que antes.

#### Fase 4: Configuración contable — la global pasa a ser "por defecto"

- **Objetivo:** que la pantalla de Ajustes contables deje claro que la cuenta global es un
  fallback para socios sin cuenta propia, sin cambios de esquema ni de validators.
- **Tareas:**
  - [x] `src/modules/accounting/features/settings/components/_CommercialIntegrationForm.tsx:140-145`:
        `label: 'Cuenta de aportes de socios por defecto'`, `help: 'Cuenta de Patrimonio Neto
        usada en los aportes y retiros de los socios que no tienen una cuenta de aportes propia
        (se asigna en Tesorería → Socios). Si todos los socios tienen la suya, este campo puede
        quedar sin asignar.'`. Mantener `types: ['EQUITY']` y `name`.
  - [x] Confirmar que `settings/validators.ts:12-29`, `validators.test.ts:40-72`,
        `AccountingSettings.tsx:87` y `actions.server.ts:49` **no** requieren cambios (el nombre
        del campo no cambia). No agregar el contador "N socios con cuenta propia": obligaría a
        `accounting` a consultar `Partner` (módulo `commercial`); queda en 2.4.
- **Archivos:**
  - Modificar: `src/modules/accounting/features/settings/components/_CommercialIntegrationForm.tsx`
- **Criterio de completitud:** en `/dashboard/accounting/settings` el campo muestra el label y la
  ayuda nuevos, guarda y limpia igual que antes; `validators.test.ts` de settings sigue en verde.

#### Fase 5: Documentación (guía in-app, docs del desarrollador y guía de presentación PDF)

- **Objetivo:** cumplir las reglas 8 y 10 del `CLAUDE.md` y el entregable de presentación al
  cliente (memoria `guia-presentacion-cliente-por-ticket`), y usar el PDF para explicar el
  riesgo preexistente que más le va a llamar la atención a la clienta: el asiento nace en borrador
  y hay que registrarlo para que el mayor del banco lo sume.
- **Tareas:**
  - [x] `src/modules/help/features/guide/components/_TreasuryGuide.tsx`: agregar `Users` al import
        de `lucide-react` (`:3-17`) y una **card nueva "Socios"** antes de "Movimientos de Fondos"
        (insertar antes de la línea 757), con la misma estructura `Card/CardHeader/CardTitle/
        CardDescription/CardContent` que las demás. Contenido: qué es un socio en el sistema
        (titular de tarjetas, cuenta corriente por gastos con tarjeta personal, y ahora cuenta de
        aportes); "Cómo dar de alta un socio" (Tesorería → Socios → Nuevo Socio; nombre; **Cuenta
        contable de aportes**: elegir la cuenta del plan a la que van sus aportes y retiros —puede
        ser de Activo, Pasivo o Patrimonio, según el contador—; si la cuenta no existe, crearla
        antes en Contabilidad → Plan de Cuentas eligiendo la cuenta madre, por ejemplo bajo
        "Capital Social"); `Alert` "Si el socio no tiene cuenta propia, sus aportes van a la
        'Cuenta de aportes de socios por defecto' de Ajustes contables; en el listado lo ves como
        'Por defecto'"; `Alert` "Cambiar la cuenta de un socio no modifica los asientos ya
        generados; los nuevos usan la nueva cuenta"; regla de borrado (con aportes, retiros,
        tarjetas o movimientos no se elimina: se desactiva).
  - [x] Misma guía, card "Movimientos de Fondos" (`:757-882`): en los tipos (`:782-790`) cambiar
        "contra la cuenta de aportes configurada" por "contra la cuenta de aportes **del socio**
        (o la por defecto si no tiene)", y en retiro agregar "usa la misma cuenta del socio"; en el
        paso 3 (`:816-820`) cambiar "opcionalmente el socio" por "el **socio** (obligatorio en
        aporte y retiro): debajo te avisa a qué cuenta se va a imputar"; reescribir la `Alert`
        `:855-863`: "Para confirmar un aporte o retiro el socio tiene que tener su cuenta de
        aportes (Tesorería → Socios) o tiene que existir la cuenta por defecto en Ajustes
        contables. Si falta, el sistema te lo dice al confirmar y el movimiento queda en borrador."
        Agregar una `Alert` nueva a continuación: "**El asiento nace en borrador.** Confirmar el
        movimiento actualiza el saldo del banco o caja y genera el asiento, pero el asiento queda
        en estado Borrador en Contabilidad → Asientos. Hasta que lo **Registres**, el Mayor y el
        Balance no lo suman: si el saldo contable del banco 'no cierra', revisá primero los
        asientos en borrador."
  - [x] `src/modules/help/features/guide/components/_AccountingGuide.tsx:229`: cambiar
        "Resultado del Ejercicio y Aportes de Socios" por "Resultado del Ejercicio y Aportes de
        Socios por defecto (cada socio puede tener su propia cuenta en Tesorería → Socios)".
  - [x] `docs/architecture/data-model.md`: en la tabla de Tesorería (`:346-364`) agregar la fila
        `| Partner | Socio de la empresa (titular de tarjetas, cuenta corriente y cuenta de
        aportes) | name, taxId, isActive, contributionsAccountId → Account (TSK-717) |` y
        `| PartnerAccountMovement | Cuenta corriente de tesorería del socio (OWED/REPAYMENT/
        ADJUSTMENT), sin relación con la contabilidad |`; en la fila `FundMovement` (`:363`)
        cambiar `partnerId` por `partnerId (obligatorio en aporte/retiro desde TSK-717, sin FK)`.
        Debajo del bloque "Movimiento de fondos y sus conceptos (TSK-585)" agregar "**Cuenta de
        aportes por socio (TSK-717):**" con: la regla `partner.contributionsAccountId ??
        settings.partnerContributionsAccountId`; tipos admitidos para la del socio (ASSET,
        LIABILITY, EQUITY imputables) vs. la global (EQUITY); `onDelete: SetNull` y por qué; la
        validación de imputabilidad al confirmar; y que el asiento sigue naciendo `DRAFT`.
  - [x] `docs/modules/commercial.md`: agregar la sección `### Socios y Movimientos de Fondos`
        después de "Cajas" (`:236-254`, antes de `### Inventario` `:256`) con el árbol
        `Partner ├── contributionsAccountId? └── FundMovement (por partnerId, sin FK)`, el flujo
        DRAFT → CONFIRMED, la resolución de la cuenta, los mensajes de error, y la regla de
        `deletePartner`. En "Archivos Clave → Server Actions" (`:766-783`) agregar
        `partners/features/list/actions.server.ts` (`getPartnerContributionAccounts`) y
        `fund-movements/list/actions.server.ts` (`confirmFundMovement`,
        `resolvePartnerCapitalAccount`).
  - [x] Crear `scripts/guia-presentacion/capturas-tsk717.mjs` sobre la base de
        `capturas-tsk692.mjs:1-47` (login con `EMAIL`/`PASSWORD` de dev, `shot()` que remueve
        `nextjs-portal`, salida a `scripts/guia-presentacion/assets/tsk717-*.png`, `BASE =
        process.argv[2] ?? 'http://localhost:3000'`). Requiere el dev server en `:3010` con
        `NEXT_PUBLIC_APP_URL=http://localhost:3010 npm run dev -- -p 3010` (memoria
        `dev-local-capturas-y-login`) y los datos de la fase 6 ya sembrados. Capturas: (1)
        `01-socio-form-cuenta`: form de socio con el combo "Cuenta contable de aportes" abierto y
        filtrado por "capital"; (2) `02-socios-listado`: listado con la columna "Cuenta de
        aportes" mostrando una socia con cuenta y otra "Por defecto"; (3) `03-modal-aporte-aviso`:
        modal con "Aporte de socio", socia con cuenta elegida y el aviso neutro; (4)
        `04-modal-aporte-sin-cuenta`: misma pantalla con socia sin cuenta y sin global (aviso
        naranja); (5) `05-asiento-por-socia`: detalle del asiento en Contabilidad → Asientos con
        la cuenta de la socia en el Haber y el estado Borrador visible; (6) `06-asiento-registrar`:
        el mismo asiento con el botón/menú Registrar; (7) `07-config-por-defecto`: Ajustes
        contables con el campo renombrado.
  - [x] Crear `scripts/guia-presentacion/tsk-717.html` copiando la estructura y estilos de
        `tsk-692.html` (cover con `eyebrow` "Tickets 413 · 706 · 717 · 724-d · Tesorería",
        secciones numeradas): 1. **Qué pedías** (citas textuales de 413 "poner plata en la cuenta
        bancaria cada socia según su porcentaje… activo contra activo" y 706 "si no no lleno el
        banco… fue con aportes de socios"); 2. **Qué cambió en pantalla** (antes: una sola cuenta
        para todas; después: cuenta por socia en el form, socio obligatorio en el aporte, aviso
        de a qué cuenta va); 3. **Cómo se usa paso a paso** con las capturas 1-5: crear la cuenta
        de cada socia en el Plan de Cuentas, asignarla en Socios, cargar el aporte, confirmar,
        ver el asiento; 4. **Qué configuración hace falta**: una cuenta imputable por socia (de
        Activo, Pasivo o Patrimonio, lo decide el contador) y, opcional, la cuenta por defecto;
        5. **Por qué el banco "no se llena" hasta registrar el asiento** (captura 6): el
        movimiento actualiza el saldo de tesorería del banco al confirmar, pero el asiento queda
        en Borrador y el Mayor/Balance solo suman asientos Registrados; procedimiento:
        Contabilidad → Asientos → filtrar Borrador → Registrar; 6. **Qué no cambió**: los aportes
        ya confirmados con la cuenta vieja no se reasignan (se revierten y recargan si hace falta,
        el asiento es histórico); cambiar la cuenta de una socia no toca asientos anteriores; la
        cuenta corriente del socio (tarjetas) es otra cosa y no suma aportes; 7. **Para revisar en
        tu empresa**: qué socias quedaron "Por defecto" en el listado.
  - [x] Generar el PDF: `node scripts/guia-presentacion/generar-pdf.mjs
        scripts/guia-presentacion/tsk-717.html docs/presentaciones/TSK-717-cuenta-por-socio.pdf`
        (convención de `docs/presentaciones/TSK-692-usuarios-por-rol.pdf`).
- **Archivos:**
  - Modificar: `src/modules/help/features/guide/components/_TreasuryGuide.tsx`,
    `src/modules/help/features/guide/components/_AccountingGuide.tsx`,
    `docs/architecture/data-model.md`, `docs/modules/commercial.md`
  - Crear: `scripts/guia-presentacion/capturas-tsk717.mjs`, `scripts/guia-presentacion/tsk-717.html`,
    `scripts/guia-presentacion/assets/tsk717-*.png`, `docs/presentaciones/TSK-717-cuenta-por-socio.pdf`
- **Criterio de completitud:** la guía in-app tiene la card "Socios" y la de fondos describe socio
  obligatorio, cuenta por socio y el asiento en borrador; `data-model.md` y `commercial.md`
  explican la resolución de la cuenta y el `SetNull`; el PDF se genera sin errores con las siete
  capturas de la app real y la sección 5 deja por escrito el tema del asiento en borrador.

#### Fase 6: Verificación final

- **Objetivo:** cerrar con evidencia: comandos del checklist en verde y los casos de uso probados
  a mano en el navegador con datos reales de dev.
- **Tareas:**
  - [x] `npm run check-types` (línea base: **227** errores preexistentes; ninguno nuevo en
        `treasury/features/partners`, `treasury/features/fund-movements`, `accounting/features/
        settings` ni `help/`), `npm run lint`, `npm run test` completo (validators de socios,
        validators de fondos, integración existente e integración nueva; la suite previa sin
        regresiones).
  - [x] Preparar datos en dev (empresa "Empresa de Prueba 01 SA", memoria
        `dev-local-capturas-y-login`): en Plan de Cuentas crear dos cuentas hoja bajo `3.1.1/00/00
        CAPITAL SOCIAL` ("Aportes Socia A", "Aportes Socia B", EQUITY) y usar una ASSET existente
        (p. ej. `1.1.4/02/01 Cuenta Part. Socio 1`) para probar el tipo Activo; socios: **Socia
        A** con cuenta EQUITY propia, **Socia C** con cuenta ASSET propia, **Socia B** sin cuenta;
        global configurada; un banco con cuenta contable; un borrador `PARTNER_CONTRIBUTION`
        creado antes de la fase 3 (o insertado por SQL con `partner_id = NULL`).
  - [x] Prueba manual, caso por caso:
    - Aporte de Socia A → confirma; el asiento tiene "Aportes Socia A" en el Haber y el banco en el
      Debe; el saldo del banco sube.
    - Aporte de Socia C (cuenta ASSET) → confirma; el asiento tiene la cuenta de Activo en el
      Haber (el combo y la confirmación aceptan Activo).
    - Aporte de Socia B con global → el modal muestra el aviso neutro "se usará la cuenta por
      defecto"; confirma contra la global.
    - Quitar la global en Ajustes contables → aporte de Socia B: aviso naranja; al confirmar, error
      que nombra a Socia B y a dónde ir; el movimiento queda en borrador. Restaurar la global.
    - Retiro de Socia A → asiento con "Aportes Socia A" en el Debe y el banco en el Haber.
    - Borrador viejo sin socio → "Confirmar" desde el listado muestra "Editá el movimiento y elegí
      el socio"; al editar, el campo "Socio *" exige elegir uno; luego confirma.
    - Transferencia y gastos bancarios → se guardan y confirman sin pedir socio (regresión).
    - Editar Socia A y dar de baja su cuenta desde el Plan de Cuentas → el combo del form sigue
      mostrándola seleccionada; un aporte nuevo falla al confirmar nombrando la cuenta.
    - Eliminar Socia A (con aportes) → mensaje "No se puede eliminar un socio con aportes o
      retiros registrados…"; un socio nuevo sin nada se elimina como antes.
    - Mayor de la cuenta "Aportes Socia A": vacío mientras el asiento está en Borrador; aparece al
      Registrarlo (confirma el mensaje de la guía y del PDF).
  - [x] Responsive y accesibilidad: form de socio y modal de fondos a 375px (el `AccountCombobox`
        y el aviso no desbordan); modo oscuro en los avisos neutro y naranja.
  - [x] Registrar los resultados en la sección 5 del documento, con los comandos y su salida
        resumida.
- **Archivos:** ninguno nuevo; solo correcciones puntuales que salgan de la verificación.
- **Criterio de completitud:** los tres comandos en verde (con la línea base de `check-types`
  respetada), los diez casos manuales registrados con resultado, y ningún cambio de comportamiento
  en transferencias, gastos bancarios, recibos u órdenes de pago.

### 2.2 Orden de ejecución

1. **Fase 1 primero y sola.** Todo lo demás depende del cliente Prisma regenerado con
   `contributionsAccountId`/`contributionsAccount`. Conviene commit propio ("schema + migración").
2. **Fases 2 y 3 después de la 1, y pueden ir en paralelo**: no comparten archivos (la 2 toca
   `partners/**`, la 3 toca `fund-movements/**`). La única dependencia lógica es que la prueba
   manual de la 3 necesita un socio con cuenta cargada, que hasta que termine la 2 se siembra con
   Prisma/SQL (el test de integración de la 3 ya lo hace así). Si se hacen en serie, **2 antes
   que 3**, porque la clienta puede cargar cuentas apenas la 2 esté y la 3 es la que cambia el
   asiento.
3. **Fase 4 en cualquier momento después de la 1**; es un cambio de textos independiente. Ideal
   junto con la 3 en el mismo commit, porque los mensajes de error de la 3 nombran a la "Cuenta
   de aportes de socios por defecto" y conviene que la pantalla ya se llame así.
4. **Fase 5 después de la 2, 3 y 4.** La guía in-app y `docs/` se pueden redactar en paralelo con
   la 3, pero las capturas y el PDF necesitan la app terminada y los datos de la fase 6 sembrados,
   así que `capturas-tsk717.mjs` y el PDF son lo último.
5. **Fase 6 al final**, con todo montado.

**Riesgos de orden a tener presentes:**

- Si la fase 3 se implementa **antes** de actualizar `fund-movement-lines.integration.test.ts`
  (`:314`, `:349`) y la fixture `aporte` de `validators.test.ts:89-98`, la suite se pone en rojo por
  la razón equivocada ("socio requerido") y enmascara fallas reales. Por eso el TDD de la 3 arranca
  por los tests existentes.
- En el `afterAll` de los dos tests de integración, `partner.deleteMany` tiene que ir **antes** de
  `account.deleteMany`: con la FK nueva, borrar cuentas con socios apuntando a ellas no falla
  (`SetNull`) pero deja filas `partners` huérfanas que el `count` final por prefijo no detecta si
  no se cuentan también los socios. Agregar `prisma.partner.count({ where: { name: { startsWith:
  PREFIX } } })` a la verificación final.
- `Partner.createdBy` es obligatorio (`schema.prisma:4401`): todo `prisma.partner.create` de los
  tests lo tiene que mandar, o falla en el `beforeAll` con un error de Prisma poco legible.
- `PartnerWithBalance` y `Partner` son tipos **escritos a mano** (`partners/shared/types.ts`): si se
  olvida agregar `contributionsAccountId` y `contributionsAccount`, el `check-types` falla en
  `getPartners`/`getPartnerById` y no en el form, que es donde uno mira primero.
- La resolución de la cuenta en `confirmFundMovement` **no debe caer a la global** cuando el socio
  tiene una cuenta asignada que dejó de ser imputable: ese caso es error explícito (paso 3 del
  helper). Caer a la global ahí sería imputar en silencio a otra cuenta, justo lo que la clienta
  denunció en 413/706.
- El reemplazo de `hasContributionsAccount` por `defaultContributionsAccount` cruza cuatro
  archivos (`actions.server.ts`, `FundMovementsList.tsx`, `_FundMovementsTable.tsx`,
  `_CreateFundMovementModal.tsx`): hacerlo en un solo paso o el `check-types` acusa en los cuatro.

### 2.3 Estimación de complejidad

- Fase 1 (esquema + migración aditiva): **baja**
- Fase 2 (socios: validator, action de cuentas, form, listado, detalle, `deletePartner`): **media**
  — muchos archivos pero todos con patrón existente (banco/caja); el punto con criterio es
  `includeIds` y los tipos a mano
- Fase 3 (fondos: socio obligatorio, resolución por socio, avisos, dos tests de integración):
  **media-alta** — es donde vive la lógica contable del ticket, con seis casos de integración y
  cuatro estados de aviso; los mensajes de error son parte del entregable
- Fase 4 (configuración: label + ayuda): **baja**
- Fase 5 (guía in-app con card nueva + docs + PDF con siete capturas): **media** — el PDF con datos
  coherentes (tres socias, dos tipos de cuenta, asiento en borrador y registrado) es lo que más
  tiempo lleva
- Fase 6 (verificación con diez casos): **media**

**Complejidad total: media.** Hay una migración (aditiva y sin datos), no hay permisos nuevos, no
hay rutas nuevas ni módulos a registrar. El riesgo técnico está en la fase 3 (no romper aporte,
retiro, transferencia y gastos bancarios mientras se cambia de dónde sale la cuenta de
contrapartida) y el esfuerzo en la fase 5.

### 2.4 Seguimientos fuera de alcance

- **Modal de movimientos de fondos desborda en móvil (375px)**: el `DialogContent` mide 411px con cualquier tipo de movimiento (también en `main`); la X de cerrar queda fuera. Ajeno a este ticket; revisar `sm:max-w-[560px]` vs. el `max-w-[calc(100%-2rem)]` base o el contenido con ancho mínimo.

- **Fecha del asiento un día antes en el listado de Asientos**: `accounting/features/entries/components/_EntriesTable.tsx:243` usa `new Date(entry.date).toLocaleDateString()` sobre un timestamp sin zona; en UTC-3 muestra el día anterior. Corrección: `moment.utc(entry.date).format('DD/MM/YYYY')`. El badge "Manual" en asientos automáticos también es engañoso. Detectado en la verificación de TSK-717.

Registrados para que no se filtren en este ticket y para abrirlos aparte:

1. **`PartnerAccountMovement` no se alimenta desde los aportes/retiros** (análisis 1.2.1 y
   1.2.5). Es correcto que no lo haga: esa tabla es la deuda de la empresa con el socio por gastos
   pagados con su tarjeta personal (pasivo), no capital. Si se quiere ver "cuánto aportó cada
   socia" desde su ficha, va una pestaña nueva que lea `FundMovement where partnerId` o el mayor
   de su cuenta, en otro ticket.
2. **`FundMovement.partnerId` sin FK a `partners`** (`schema.prisma:4346`). Este ticket lo mitiga
   bloqueando `deletePartner` cuando hay movimientos y validando la existencia del socio al
   confirmar. Agregar la FK requiere primero limpiar posibles `partner_id` huérfanos en
   producción; ticket aparte.
3. **Los asientos generados por integraciones nacen en `DRAFT`** (todas las integraciones,
   análisis 1.2.3). El mayor y el balance solo suman `POSTED`. Se documenta en la guía y en el
   PDF; si la clienta quiere que los asientos de movimientos de fondos nazcan registrados (o un
   "Registrar todos los borradores" masivo), es una decisión de producto para otro ticket.
4. **TSK-724 puntos a/b/c y TSK-718** se resuelven en otros tickets; acá solo se cubre 724-d
   (varias cuentas de aportes, una por socio).
5. **Contador "N socios con cuenta propia" en Ajustes contables.** Descartado para no hacer que
   `accounting` consulte `Partner` (regla de no importar entre módulos). Si se quiere, va por una
   action en `shared/actions`.
6. **Modal de fondos con un borrador cuyo socio fue desactivado**: `getFundMovementCatalogs` solo
   trae socios `isActive`, así que al editar ese borrador el `Select` queda vacío aunque el
   formulario tenga el `partnerId`. Preexistente; la solución es el mismo patrón `includeIds` que
   ya usan las cuentas, aplicado a socios.
7. **Reasignación de aportes ya confirmados con la cuenta global.** Sin migración de datos (decisión
   del análisis 1.2.6). Si al correr la consulta de 1.2.6 en producción aparecen aportes
   `POSTED` que la clienta quiera desglosar, el camino es reversión + recarga desde Contabilidad;
   para los `DRAFT` se puede ofrecer un SQL puntual en un ticket aparte.
8. **`getAvailableAccounts` de bancos y cajas no exigen `isLeaf`** (`bank-accounts/list/
   actions.server.ts:245-270`, `cash-registers/list/actions.server.ts:16-26`): ofrecen cuentas no
   imputables que el asiento después rechaza. Unificarlas sobre `buildImputableAccountsWhere` es
   deuda ajena a este ticket.

## 3. Diseño

Bajada técnica de las seis fases de la sección 2, respetando las decisiones cerradas en el
análisis (alternativa A de 1.2.7) y en la planificación (`onDelete: SetNull`, `deletePartner`
bloqueado, action nueva `getPartnerContributionAccounts`, la global sigue siendo `EQUITY`, la
cuenta del socio admite `ASSET`/`LIABILITY`/`EQUITY`). Todas las firmas están listas para
implementar: sin `any`, con los tipos inferidos de Prisma y de Zod, y con los nombres exactos de
los archivos que ya existen. Los ajustes respecto al plan (rutas reales, firma del helper,
fixtures que faltaban) están consolidados en 3.7.

### 3.1 Arquitectura de la solución

La cuenta nace en el form del socio, se guarda en `Partner.contributionsAccountId`, se anticipa
en el modal de fondos (aviso) y se consume al confirmar el movimiento, donde decide una de las
dos líneas del asiento. Dos módulos, ningún import cruzado: **contabilidad** no se entera de
que existe el socio (solo renombra un label), y **comercial** resuelve la cuenta con Prisma
directo y con el helper puro `buildImputableAccountsWhere` de `shared/`.

```
TESORERÍA → SOCIOS  (commercial/features/treasury/features/partners)
  _PartnerForm ─ _PartnerAccountField ── useQuery ── getPartnerContributionAccounts(includeIds?)
        │                                             where = imputable ∧ type ∈ {ASSET, LIABILITY, EQUITY}
        ▼                                             (+ la cuenta ya guardada, aunque hoy no cumpla)
  createPartner / updatePartner
        │   valida que la cuenta sea de la empresa
        ▼
  Partner.contributionsAccountId ──FK SetNull──▶ Account          [Fase 1-2]
        │
        ├─ listado: columna "Cuenta de aportes"  (code · name | "Por defecto")
        └─ detalle: "Cuenta contable de aportes"

TESORERÍA → MOVIMIENTOS DE FONDOS  (commercial/features/treasury/features/fund-movements)
  getFundMovementCatalogs()
        │   partners[]: { id, name, contributionsAccount | null }
        │   defaultContributionsAccount: AccountingSettings.partnerContributionsAccount | null
        ▼
  _CreateFundMovementModal ── "Socio *" (obligatorio; superRefine) ── _PartnerAccountNotice
        │                                                              (4 estados, ver 3.4.3)
        ▼  Guardar / Guardar y Confirmar
  createFundMovement(input, confirm) ─▶ confirmFundMovement(id)
                                             │  lee AccountingSettings con prisma directo (hoy :665-672)
                                             ▼  dentro de prisma.$transaction
                                       resolvePartnerCapitalAccount(tx, companyId, partnerId, defaultId)
                                             │  partner.contributionsAccountId  → valida imputable → 'partner'
                                             │  ∅ + settings.partnerContributionsAccountId → 'default'
                                             │  ∅ + ∅ → BusinessError nombrando al socio
                                             ▼
                                       aporte: Debe banco/caja · Haber cuenta resuelta
                                       retiro: Debe cuenta resuelta · Haber banco/caja
                                             ▼
                                       createJournalEntryForFundMovement → JournalEntry (DRAFT)

CONTABILIDAD → CONFIGURACIÓN  (accounting/features/settings)                          [Fase 4]
  _CommercialIntegrationForm: label "Cuenta de aportes de socios por defecto" (solo texto)
```

**Decisiones de arquitectura**

1. **La resolución de la cuenta vive en un único helper privado de `fund-movements`**
   (`resolvePartnerCapitalAccount`, 3.3.9) y se ejecuta **dentro de la transacción** de
   `confirmFundMovement`, con el mismo `tx` que después escribe el asiento. Así la
   verificación de imputabilidad y la escritura de las líneas ven la misma foto de la base, y
   el error de negocio aborta la transacción sin dejar `bank_movements` ya aplicados. El plan la
   ubicaba fuera de la transacción; ver ajuste 1 de 3.7.
2. **`confirmFundMovement` ya lee `AccountingSettings` con Prisma directo**
   (`fund-movements/list/actions.server.ts:665-672`, `prisma.accountingSettings.findUnique`),
   no a través del módulo `accounting`. Se mantiene igual: el `select` sigue trayendo
   `partnerContributionsAccountId`, que pasa a ser el **fallback** en vez de la única fuente.
   Ningún archivo de `commercial` importa de `accounting` ni viceversa.
3. **El criterio "qué tipos de cuenta puede tener un socio" se declara una sola vez**, en
   `partners/shared/types.ts` (`PARTNER_CONTRIBUTION_ACCOUNT_TYPES`, 3.2.3), y lo importan la
   action del combo y la validación de la confirmación. Es un import **entre features del mismo
   módulo** (`fund-movements` → `partners/shared`), igual que el que ya hace
   `fund-movements/list/actions.server.ts:13` hacia `products/shared/account-filters`. Sin esto,
   el combo y la confirmación podían divergir (ajuste 3 de 3.7).
4. **Nada de lo nuevo cambia la forma del asiento.** Aporte y retiro siguen siendo
   `parLineas(debe, haber)` (`:704-707`); solo cambia de dónde sale el id de la cuenta de
   capital. Transferencias y gastos bancarios no pasan por el helper.
5. **Los errores esperables viajan como dato** (`BusinessError` → `{ success: false, error }`,
   `:30-62`), nunca como `throw` suelto, porque el modal y el listado muestran `result.error`
   con `toast.error` (`_CreateFundMovementModal.tsx:246-249`, `_FundMovementsTable.tsx:77-81`).
   En la feature de socios, en cambio, los errores **sí** son excepciones: los forms hacen
   `toast.error(error.message)` (`_CreatePartnerForm.tsx:22-25`, `_EditPartnerForm.tsx:27-30`).

### 3.2 Modelos de datos

#### 3.2.1 Prisma — `model Partner` y `model Account`

`prisma/schema.prisma:4384-4407`. Campo aditivo debajo de `isActive` (`:4393`), relación en el
bloque de relaciones (`:4395-4399`), índice junto al existente (`:4405`), y comentario del modelo
actualizado (`:4384`):

```prisma
/// Socio de la empresa. Puede ser titular de tarjetas, tener cuenta corriente y una
/// cuenta contable propia para sus aportes y retiros (TSK-717).
model Partner {
  id        String  @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  companyId String  @map("company_id") @db.Uuid
  name      String
  taxId     String? @map("tax_id") // CUIT/CUIL
  email     String?
  phone     String?
  notes     String?
  isActive  Boolean @default(true) @map("is_active")
  // TSK-717: cuenta contable propia para aportes/retiros; null = usa la por defecto de AccountingSettings
  contributionsAccountId String? @map("contributions_account_id") @db.Uuid

  company              Company                   @relation(fields: [companyId], references: [id])
  contributionsAccount Account?                  @relation("PartnerOwnContributionsAccount", fields: [contributionsAccountId], references: [id], onDelete: SetNull)
  cards                Card[]
  movements            PartnerAccountMovement[]
  installments         PaymentOrderInstallment[]
  paymentOrders        PaymentOrder[]

  createdBy String   @map("created_by")
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  @@index([companyId])
  @@index([contributionsAccountId])
  @@map("partners")
}
```

El nombre de relación **no puede** ser `"PartnerContributionsAccount"`: ya lo usa
`AccountingSettings.partnerContributionsAccount` (`schema.prisma:559`) con su inversa
`settingsAsPartnerContributions` (`:339`). Los nombres ya tomados en `Account` son los 40
`settingsAs*` (`:329-368`), `"AccountHierarchy"`, `"AccountDisabledFrom"`,
`"ProductExpenseAccount"` y `"ProductIncomeAccount"`; `"PartnerOwnContributionsAccount"` no
colisiona con ninguno.

Inversa en `model Account`, después de `cashRegisters CashRegister[]` (`:326`):

```prisma
  bankAccounts             BankAccount[] // Relación con cuentas bancarias (para cuentas contables)
  cashRegisters            CashRegister[] // Relación con cajas (para cuentas contables)
  partners                 Partner[]          @relation("PartnerOwnContributionsAccount") // Socios con cuenta de aportes propia (TSK-717)
```

**Migración** `prisma/migrations/<timestamp>_tsk_717_partner_contributions_account/migration.sql`,
generada con `npm run db:migrate -- --name tsk_717_partner_contributions_account`. SQL esperado
(mismo formato que `20260831124739_fund_movement_lines/migration.sql`):

```sql
-- AlterTable
ALTER TABLE "partners" ADD COLUMN "contributions_account_id" UUID;

-- CreateIndex
CREATE INDEX "partners_contributions_account_id_idx" ON "partners"("contributions_account_id");

-- AddForeignKey
ALTER TABLE "partners" ADD CONSTRAINT "partners_contributions_account_id_fkey" FOREIGN KEY ("contributions_account_id") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
```

Sin `UPDATE`, sin backfill: `NULL` es el estado correcto de todo socio preexistente (usa la
global, exactamente lo que hacía hasta hoy). `SET NULL` en vez de `RESTRICT` por la decisión de
la sección 2: la baja de cuentas es un soft delete (`isActive: false`) y el caso real —cuenta
dada de baja pero asignada— lo rechaza `resolvePartnerCapitalAccount` con un mensaje que nombra
al socio, no un P2003 que `accounting` no sabría explicar. `FundMovement.partnerId` **no** gana
FK en este ticket (seguimiento 2 de 2.4).

#### 3.2.2 Zod — `partnerSchema`

`partners/shared/validators.ts:4-11`:

```ts
export const partnerSchema = z.object({
  name: z.string().min(1, 'El nombre es requerido').max(200),
  taxId: z.string().max(20).optional().or(z.literal('')),
  email: z.string().email('Email inválido').optional().or(z.literal('')),
  phone: z.string().max(50).optional().or(z.literal('')),
  notes: z.string().max(1000).optional().or(z.literal('')),
  isActive: z.boolean().default(true),
  // TSK-717: cuenta contable propia para aportes/retiros. null/ausente = usa la por
  // defecto de Ajustes contables. Mismo criterio que `accountId` de caja/banco
  // (`treasury/shared/validators.ts:20`).
  contributionsAccountId: z.string().uuid('Cuenta contable inválida').nullable().optional(),
});

export type PartnerFormData = z.infer<typeof partnerSchema>;
// gana: contributionsAccountId?: string | null | undefined
```

`.nullable().optional()` y no `.or(z.literal(''))`: el `AccountCombobox` emite `null` al limpiar
(`onChange: (accountId: string | null) => void`, `AccountCombobox.tsx:29`), no `''`.

#### 3.2.3 TypeScript — tipos de la feature de socios

`partners/shared/types.ts:3-20`. Son tipos **escritos a mano** (no inferidos), así que hay que
tocarlos o `check-types` falla en `getPartners`/`getPartnerById`:

```ts
import type { AccountType, PartnerMovementType } from '@/generated/prisma/enums';

export interface Partner extends Record<string, unknown> {
  id: string;
  companyId: string;
  name: string;
  taxId: string | null;
  email: string | null;
  phone: string | null;
  notes: string | null;
  isActive: boolean;
  /** TSK-717: cuenta contable propia para aportes/retiros; null = usa la por defecto. */
  contributionsAccountId: string | null;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

/** Referencia mínima a una cuenta del plan, para mostrar `code - name`. */
export type PartnerAccountRef = { id: string; code: string; name: string };

/** Socio con su cuenta de aportes resuelta (listado, detalle, edición). */
export interface PartnerWithAccount extends Partner {
  contributionsAccount: PartnerAccountRef | null;
}

/** Socio en el listado, con el balance (lo que la empresa le debe) ya calculado. */
export interface PartnerWithBalance extends PartnerWithAccount {
  balance: number;
}

/**
 * Tipos de cuenta que puede tener un socio como cuenta de aportes (TSK-717).
 * Activo, Pasivo o Patrimonio Neto según el criterio del contador; quedan
 * fuera Ingresos (REVENUE) y Egresos (EXPENSE). Lo usan el combo del form
 * (`getPartnerContributionAccounts`) y la validación al confirmar el asiento
 * (`resolvePartnerCapitalAccount`), para que nunca diverjan.
 */
export const PARTNER_CONTRIBUTION_ACCOUNT_TYPES: AccountType[] = ['ASSET', 'LIABILITY', 'EQUITY'];
```

El enum real es `AccountType { ASSET, LIABILITY, EQUITY, REVENUE, EXPENSE }`
(`schema.prisma:220-228`): lo que el análisis llamaba "Ingresos" es `REVENUE`.

#### 3.2.4 Tipos inferidos en `fund-movements`

`fund-movements/list/actions.server.ts:835-840`. Ninguno se declara a mano salvo la referencia
a cuenta:

```ts
export type FundMovementListItem = Awaited<ReturnType<typeof getFundMovements>>['data'][number];
export type FundMovementRecord = NonNullable<Awaited<ReturnType<typeof getFundMovementById>>>;
export type FundOption = { id: string; label: string };
/** Cuenta del plan tal como viaja al modal: para mostrar `code - name` en el aviso (TSK-717). */
export type FundMovementAccountRef = { id: string; code: string; name: string };
export type FundMovementPartnerOption = Awaited<
  ReturnType<typeof getFundMovementCatalogs>
>['partners'][number];
// gana: { id: string; name: string; contributionsAccount: FundMovementAccountRef | null }
```

### 3.3 Funciones y métodos

#### 3.3.1 `getPartnerContributionAccounts` (nueva) — `partners/features/list/actions.server.ts`

Se agrega después de `getPartnerFacetCounts` (`:149`). Imports nuevos en el archivo:
`import { buildImputableAccountsWhere } from '@/shared/lib/accounts/imputable-accounts';` y
`PARTNER_CONTRIBUTION_ACCOUNT_TYPES` / `PartnerWithAccount` desde `../../shared/types`.

```ts
/**
 * Cuentas que un socio puede tener como cuenta de aportes: imputables (hoja,
 * activa, sin corte de ejercicio vigente) y de tipo Activo, Pasivo o Patrimonio
 * Neto (TSK-717). `includeIds` preserva la cuenta ya guardada aunque hoy no
 * cumpla el filtro (dada de baja, con hijas, cortada por ejercicio), para que al
 * editar el socio el combo la muestre seleccionada en vez de vacía; mismo patrón
 * que `getFundMovementLineAccounts` (`fund-movements/list/actions.server.ts:167-189`).
 *
 * El `where` imputable ya tiene su propio `OR` por `disabledFrom`, por eso se
 * envuelve en otro `OR` y no se mezcla. No se importa nada de `accounting`.
 */
export async function getPartnerContributionAccounts(includeIds?: string[]) {
  await checkPermission('commercial.treasury.partners', 'view', { redirect: true });
  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  const imputableWhere = buildImputableAccountsWhere({
    companyId,
    types: PARTNER_CONTRIBUTION_ACCOUNT_TYPES,
  });
  const where =
    includeIds && includeIds.length > 0
      ? { OR: [imputableWhere, { companyId, id: { in: includeIds } }] }
      : imputableWhere;

  return prisma.account.findMany({
    where,
    select: { id: true, code: true, name: true },
    orderBy: { code: 'asc' },
  });
}

export type PartnerContributionAccountOption = Awaited<
  ReturnType<typeof getPartnerContributionAccounts>
>[number];
// = { id: string; code: string; name: string }  (compatible con AccountOption del combobox)
```

`where` efectivo sin `includeIds`:

```ts
{
  companyId,
  isActive: true,
  isLeaf: true,
  type: { in: ['ASSET', 'LIABILITY', 'EQUITY'] },
  OR: [{ disabledFrom: null }, { disabledFrom: { gt: new Date() } }],
}
```

No sirve reutilizar `getAvailableAccounts` de bancos (`bank-accounts/list/actions.server.ts:245-270`):
filtra solo `ASSET`, no exige `isLeaf`, no soporta `includeIds` y pide el permiso de bancos.

#### 3.3.2 `getPartners` — `:95-113`

Solo cambia el `findMany`; el `map` de `:110-113` ya hace spread, así que `PartnerWithBalance`
(que ahora extiende `PartnerWithAccount`) queda completo:

```ts
prisma.partner.findMany({
  where,
  orderBy: orderBy || [{ isActive: 'desc' }, { name: 'asc' }],
  skip,
  take,
  include: { contributionsAccount: { select: { id: true, code: true, name: true } } },
}),
```

Sin `Decimal` nuevos (`balance` ya viene por `Number()` en `getBalancesByPartner`).

#### 3.3.3 `getPartnerById` — `:154-169`

```ts
export async function getPartnerById(id: string): Promise<PartnerWithAccount | null> {
  await checkPermission('commercial.treasury.partners', 'view', { redirect: true });
  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    return await prisma.partner.findFirst({
      where: { id, companyId },
      include: { contributionsAccount: { select: { id: true, code: true, name: true } } },
    });
  } catch (error) {
    logger.error('Error al obtener socio', { data: { error, id } });
    throw new Error('Error al obtener socio');
  }
}
```

Consumidores: `PartnerDetail.tsx:14-17` y `EditPartner.tsx:11`; siguen compilando porque
`PartnerWithAccount extends Partner`.

#### 3.3.4 Helper privado `assertAccountBelongsToCompany` (nuevo, mismo archivo)

Antes de `createPartner`, para no duplicar la validación en `create` y `update`:

```ts
/**
 * Verifica que la cuenta elegida sea de la empresa activa (TSK-717). No exige
 * que sea imputable: el combo ya filtra, y una cuenta que dejó de serlo se
 * conserva a propósito (`includeIds`); quien la rechaza es la confirmación del
 * asiento (`resolvePartnerCapitalAccount`). Acá los errores son excepciones:
 * los forms los muestran con `toast.error(error.message)`.
 */
async function assertAccountBelongsToCompany(
  accountId: string | null | undefined,
  companyId: string
): Promise<string | null> {
  if (!accountId) return null;
  const account = await prisma.account.findFirst({
    where: { id: accountId, companyId },
    select: { id: true },
  });
  if (!account) throw new Error('La cuenta contable seleccionada no pertenece a la empresa');
  return account.id;
}
```

#### 3.3.5 `createPartner` (`:174-208`) y `updatePartner` (`:213-250`)

Las firmas no cambian (`PartnerFormData` ya trae el campo). Cambia el cuerpo:

```ts
// createPartner — después de `partnerSchema.parse(data)` (:183)
const contributionsAccountId = await assertAccountBelongsToCompany(
  validatedData.contributionsAccountId,
  companyId
);

const partner = await prisma.partner.create({
  data: {
    companyId,
    name: validatedData.name,
    taxId: validatedData.taxId || null,
    email: validatedData.email || null,
    phone: validatedData.phone || null,
    notes: validatedData.notes || null,
    isActive: validatedData.isActive,
    contributionsAccountId,            // ← TSK-717
    createdBy: userId,
  },
});

logger.info('Socio creado', {
  data: { partnerId: partner.id, companyId, contributionsAccountId },
});
```

```ts
// updatePartner — después del `findFirst` de `existing` (:224-225)
const contributionsAccountId = await assertAccountBelongsToCompany(
  validatedData.contributionsAccountId,
  companyId
);

const partner = await prisma.partner.update({
  where: { id },
  data: {
    name: validatedData.name,
    taxId: validatedData.taxId || null,
    email: validatedData.email || null,
    phone: validatedData.phone || null,
    notes: validatedData.notes || null,
    isActive: validatedData.isActive,
    contributionsAccountId,            // ← TSK-717 (null = volver a la por defecto)
  },
});
```

Cambiar la cuenta de un socio **no toca asientos ya generados** (riesgo 3 del análisis): el
asiento es histórico y la guía y el detalle lo dicen.

#### 3.3.6 `deletePartner` — `:255-286`

Tercer bloqueo, con una consulta aparte porque `FundMovement.partnerId` no es relación Prisma
(`schema.prisma:4346`) y no entra en el `_count`:

```ts
const [partner, fundMovementsCount] = await Promise.all([
  prisma.partner.findFirst({
    where: { id, companyId },
    include: { _count: { select: { movements: true, cards: true } } },
  }),
  // TSK-717: sin FK ni relación Prisma entre FundMovement.partnerId y Partner,
  // así que no entra en el `_count`. Cuenta cualquier estado, también DRAFT.
  prisma.fundMovement.count({ where: { companyId, partnerId: id } }),
]);

if (!partner) throw new Error('Socio no encontrado');

if (partner._count.movements > 0 || partner._count.cards > 0) {
  throw new Error('No se puede eliminar un socio con movimientos o tarjetas asociadas');
}

if (fundMovementsCount > 0) {
  throw new Error(
    'No se puede eliminar un socio con aportes o retiros registrados. Desactivalo desde Editar si ya no opera.'
  );
}
```

El bloqueo existente por `movements`/`cards` (`:270-274`) queda tal cual, antes del nuevo.

#### 3.3.7 `fundMovementSchema` — `fund-movements/shared/validators.ts:77-78` y `:133-148`

El tipo base de `partnerId` **no cambia** (`z.string().uuid().optional().or(z.literal(''))`):
transferencia y gastos bancarios siguen mandando `''`. Cambia el comentario y el `superRefine`:

```ts
// Socio del aporte / retiro. Obligatorio para esos dos tipos (ver superRefine);
// define la cuenta del asiento (TSK-717).
partnerId: z.string().uuid().optional().or(z.literal('')),
```

```ts
if (data.type === 'PARTNER_CONTRIBUTION') {
  if (!validRef(data.destinationFund)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['destinationFund'],
      message: 'Seleccioná el banco o caja donde ingresan los fondos',
    });
  }
  // TSK-717: el socio decide la cuenta del asiento, así que ya no es informativo.
  if (!data.partnerId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['partnerId'], message: 'Seleccioná el socio' });
  }
} else if (data.type === 'PARTNER_WITHDRAWAL') {
  if (!validRef(data.sourceFund)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['sourceFund'],
      message: 'Seleccioná el banco o caja de donde salen los fondos',
    });
  }
  if (!data.partnerId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['partnerId'], message: 'Seleccioná el socio' });
  }
}
```

**No** se toca en `ACCOUNT_TRANSFER` (`:149-170`) ni `BANK_CHARGES` (`:171-188`).
`FundMovementFormInput` (`:191`) no cambia de forma.

#### 3.3.8 `getFundMovementCatalogs` — `fund-movements/list/actions.server.ts:118-151`

```ts
/** Catálogos para el formulario: bancos, cajas con sesión abierta, socios (con su cuenta de aportes) y cuenta por defecto. */
export async function getFundMovementCatalogs() {
  await checkPermission('commercial.treasury.fund-movements', 'view', { redirect: true });
  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  const [banks, cashRegisters, partners, settings] = await Promise.all([
    prisma.bankAccount.findMany({ /* sin cambios (:124-128) */ }),
    prisma.cashRegister.findMany({ /* sin cambios (:129-133) */ }),
    prisma.partner.findMany({
      where: { companyId, isActive: true },
      select: {
        id: true,
        name: true,
        contributionsAccount: { select: { id: true, code: true, name: true } },
      },
      orderBy: { name: 'asc' },
    }),
    prisma.accountingSettings.findUnique({
      where: { companyId },
      select: { partnerContributionsAccount: { select: { id: true, code: true, name: true } } },
    }),
  ]);

  return {
    banks: banks.map((b) => ({ id: b.id, label: `${b.bankName} - ${b.accountNumber}` })),
    cashRegisters: cashRegisters.map((c) => ({ id: c.id, label: `Caja ${c.name}` })),
    partners: partners.map((p) => ({
      id: p.id,
      name: p.name,
      contributionsAccount: p.contributionsAccount,
    })),
    // TSK-717: reemplaza `hasContributionsAccount: boolean`. El modal necesita
    // código y nombre para decir "se usará la cuenta por defecto X".
    defaultContributionsAccount: settings?.partnerContributionsAccount ?? null,
  };
}
```

Tipo de retorno inferido:

```ts
{
  banks: FundOption[];
  cashRegisters: FundOption[];
  partners: { id: string; name: string; contributionsAccount: FundMovementAccountRef | null }[];
  defaultContributionsAccount: FundMovementAccountRef | null;
}
```

El reemplazo de `hasContributionsAccount` cruza `FundMovementsList.tsx:37`,
`_FundMovementsTable.tsx:40,51,133,144` y `_CreateFundMovementModal.tsx:67,84,345` (ver 3.4.4);
hacerlo en un solo paso.

#### 3.3.9 `resolvePartnerCapitalAccount` (nuevo helper privado) — sección HELPERS, antes de `applyFundSide` (`:226`)

Import nuevo: `import { PARTNER_CONTRIBUTION_ACCOUNT_TYPES } from '../../partners/shared/types';`

```ts
/** De dónde salió la cuenta de capital del asiento (para el log y los tests). */
type CapitalAccountSource = 'partner' | 'default';

interface ResolvedCapitalAccount {
  accountId: string;
  source: CapitalAccountSource;
  partnerName: string;
}

/**
 * Cuenta de capital de un aporte o retiro (TSK-717):
 * `partner.contributionsAccountId ?? settings.partnerContributionsAccountId`.
 *
 * Se ejecuta DENTRO de la transacción de `confirmFundMovement`, con el mismo
 * `tx` que escribe el asiento. Todos los errores son `BusinessError`: viajan
 * al modal como `{ success: false, error }` y el movimiento queda en DRAFT.
 *
 *  1. Sin `partnerId`           → borrador anterior a TSK-717 (riesgo 1): error, editar y elegir socio.
 *  2. Socio inexistente         → borrado o de otra empresa: error, elegir otro socio.
 *                                 No bloquea por `isActive`: el borrador se creó cuando estaba activo.
 *  3. Cuenta propia asignada    → tiene que ser imputable (hoja, activa, sin corte vigente) y
 *                                 de tipo ASSET/LIABILITY/EQUITY. Si no lo es → error.
 *                                 NUNCA cae a la global en este caso: sería imputar en silencio a
 *                                 otra cuenta, justo lo que la clienta denunció en 413/706.
 *  4. Sin cuenta propia         → global si existe (`source: 'default'`); si tampoco → error que
 *                                 nombra al socio y dice dónde configurarla.
 */
async function resolvePartnerCapitalAccount(
  tx: PrismaTransactionClient,
  companyId: string,
  partnerId: string | null,
  defaultAccountId: string | null
): Promise<ResolvedCapitalAccount> {
  if (!partnerId) {
    throw new BusinessError(
      'Este movimiento no tiene socio asignado. Editá el movimiento y elegí el socio antes de confirmarlo.'
    );
  }

  const partner = await tx.partner.findFirst({
    where: { id: partnerId, companyId },
    select: {
      name: true,
      contributionsAccountId: true,
      contributionsAccount: { select: { id: true, code: true, name: true } },
    },
  });
  if (!partner) {
    throw new BusinessError(
      'El socio del movimiento ya no existe. Editá el movimiento y elegí otro socio.'
    );
  }

  if (partner.contributionsAccount) {
    const { id, code, name } = partner.contributionsAccount;
    const imputable = await tx.account.findFirst({
      where: {
        ...buildImputableAccountsWhere({ companyId, types: PARTNER_CONTRIBUTION_ACCOUNT_TYPES }),
        id,
      },
      select: { id: true },
    });
    if (!imputable) {
      throw new BusinessError(
        `La cuenta de aportes "${code} - ${name}" del socio "${partner.name}" no está activa o no es imputable. Corregila en Tesorería → Socios → Editar.`
      );
    }
    return { accountId: id, source: 'partner', partnerName: partner.name };
  }

  if (!defaultAccountId) {
    throw new BusinessError(
      `El socio "${partner.name}" no tiene cuenta de aportes y no hay una cuenta por defecto. Asignale una en Tesorería → Socios → Editar, o configurá la "Cuenta de aportes de socios por defecto" en Ajustes contables.`
    );
  }
  return { accountId: defaultAccountId, source: 'default', partnerName: partner.name };
}
```

Nota sobre `partner.contributionsAccount` vs. `contributionsAccountId`: con la FK `SetNull`
nunca puede haber id sin cuenta, así que alcanza con mirar la relación; `contributionsAccountId`
se selecciona igual para el log. La verificación de imputabilidad se hace con
`buildImputableAccountsWhere` y no a mano (`isActive`/`isLeaf`), para no repetir el error que
TSK-585 corrigió en `assertLineAccounts` (`:446-478`): olvidar `disabledFrom`.

#### 3.3.10 `confirmFundMovement` — `:647-807`

Firma sin cambios: `confirmFundMovement(id: string): Promise<FundMovementActionResult>`.

1. El `select` de `settings` (`:665-672`) **no cambia** (sigue trayendo
   `partnerContributionsAccountId`, `defaultBankAccountId`, `defaultCashAccountId`).
2. Se **elimina** el bloque `:675-683` (`let capitalAccountId` + el `BusinessError` "Configurá la
   'Cuenta de aportes de socios'…"): la validación previa `hasContributionsAccount` deja de
   existir como tal, porque la global ya no es condición necesaria. En su lugar:

```ts
const isTransfer = movement.type === 'ACCOUNT_TRANSFER';
const defaultContributionsAccountId = settings?.partnerContributionsAccountId ?? null;
let capitalSource: CapitalAccountSource | null = null; // para el log final
```

3. Dentro de la transacción, las dos ramas de socio (`:711-719` y `:720-728`):

```ts
if (movement.type === 'PARTNER_CONTRIBUTION') {
  if (!movement.fundInKind || !movement.fundInId) throw new BusinessError('Falta el banco/caja destino');
  const capital = await resolvePartnerCapitalAccount(
    tx, companyId, movement.partnerId, defaultContributionsAccountId
  );
  capitalSource = capital.source;
  const dest = await applyFundSide(
    tx,
    { kind: movement.fundInKind as FundSourceKind, id: movement.fundInId },
    'IN',
    sideCtx
  );
  entryLines = parLineas(dest.accountId, capital.accountId);     // Debe banco/caja · Haber cuenta del socio
} else if (movement.type === 'PARTNER_WITHDRAWAL') {
  if (!movement.fundOutKind || !movement.fundOutId) throw new BusinessError('Falta el banco/caja origen');
  const capital = await resolvePartnerCapitalAccount(
    tx, companyId, movement.partnerId, defaultContributionsAccountId
  );
  capitalSource = capital.source;
  const src = await applyFundSide(
    tx,
    { kind: movement.fundOutKind as FundSourceKind, id: movement.fundOutId },
    'OUT',
    sideCtx
  );
  entryLines = parLineas(capital.accountId, src.accountId);      // Debe cuenta del socio · Haber banco/caja
}
```

Desaparecen los dos `capitalAccountId!` (`:719`, `:728`): `capital.accountId` es `string`. El
helper se llama **antes** de `applyFundSide` para que un socio sin cuenta falle antes de mover
saldos (igual la transacción lo revertiría, pero así el orden de los errores es el natural).

4. El log final (`:799`) suma la fuente:

```ts
logger.info('Movimiento de fondos confirmado', {
  data: { id, companyId, type: movement.type, partnerId: movement.partnerId, capitalSource },
});
```

`BANK_CHARGES` y `ACCOUNT_TRANSFER` (`:729-766`) no cambian.

#### 3.3.11 `createFundMovement` (`:519-526`) y `updateFundMovement` (`:598-605`)

Los dos bloques idénticos que resuelven `partnerName` se reemplazan por un helper privado
(sección HELPERS) que además rechaza un socio ajeno en aporte/retiro, para que el borrador no
nazca huérfano:

```ts
/**
 * Nombre del socio para el snapshot `partnerName`. En aporte y retiro el socio
 * define la cuenta del asiento (TSK-717), así que si el id no es de la empresa
 * el borrador no se guarda. Transferencia y gastos bancarios no cambian: si
 * llegara un id suelto, se guarda `null` como hasta ahora.
 */
async function resolvePartnerName(
  data: FundMovementFormInput,
  companyId: string
): Promise<string | null> {
  if (!data.partnerId) return null;
  const partner = await prisma.partner.findFirst({
    where: { id: data.partnerId, companyId },
    select: { name: true },
  });
  const isPartnerMovement =
    data.type === 'PARTNER_CONTRIBUTION' || data.type === 'PARTNER_WITHDRAWAL';
  if (!partner && isPartnerMovement) {
    throw new BusinessError('El socio seleccionado no es válido');
  }
  return partner?.name ?? null;
}
```

Uso en ambas mutaciones: `const partnerName = await resolvePartnerName(data, companyId);`. El
`data` de Prisma (`:542-543`, `:623-624`) sigue igual: `partnerId: data.partnerId || null,
partnerName`.

#### 3.3.12 `_CommercialIntegrationForm.tsx:140-145` (Fase 4)

Solo textos; `name` y `types` no cambian, así que `validators.ts`, `validators.test.ts`,
`AccountingSettings.tsx:87` y `actions.server.ts:49` de settings quedan intactos:

```ts
{
  name: 'partnerContributionsAccountId',
  label: 'Cuenta de aportes de socios por defecto',
  types: ['EQUITY'],
  help: 'Cuenta de Patrimonio Neto usada en los aportes y retiros de los socios que no tienen una cuenta de aportes propia (se asigna en Tesorería → Socios). Si todos los socios tienen la suya, este campo puede quedar sin asignar.',
},
```

### 3.4 Interfaces de usuario

#### 3.4.1 `_PartnerAccountField.tsx` (nuevo) — `partners/features/create/components/`

Client Component (< 80 líneas) para que `_PartnerForm.tsx` (hoy 167 líneas) no pase las 200.

```tsx
'use client';

import type { Control } from 'react-hook-form';
import { useQuery } from '@tanstack/react-query';

import { AccountCombobox } from '@/shared/components/common/AccountCombobox';
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/shared/components/ui/form';
import { getPartnerContributionAccounts } from '../../list/actions.server';
import type { PartnerFormData } from '../../../shared/validators';

interface PartnerAccountFieldProps {
  control: Control<PartnerFormData>;
  /** Cuenta ya guardada (edición): se preserva en el combo aunque hoy no sea imputable. */
  savedAccountId?: string | null;
}

export function _PartnerAccountField({ control, savedAccountId }: PartnerAccountFieldProps) {
  // Patrón `_BankAccountFormModal.tsx:52-57`. La key incluye `savedAccountId`
  // para que el `includeIds` no se comparta entre socios distintos.
  const { data: accounts = [], isLoading } = useQuery({
    queryKey: ['partner-contribution-accounts', savedAccountId ?? null],
    queryFn: () => getPartnerContributionAccounts(savedAccountId ? [savedAccountId] : undefined),
  });

  return (
    <FormField
      control={control}
      name="contributionsAccountId"
      render={({ field }) => (
        <FormItem>
          <FormLabel>Cuenta contable de aportes (opcional)</FormLabel>
          <FormControl>
            <AccountCombobox
              accounts={accounts}
              value={field.value ?? null}
              onChange={field.onChange}
              placeholder={isLoading ? 'Cargando cuentas...' : 'Sin asignar'}
              clearLabel="Sin asignar (usar la cuenta por defecto)"
              disabled={isLoading}
            />
          </FormControl>
          <FormDescription>
            Cuenta a la que se imputan los aportes y retiros de este socio. Puede ser de Activo,
            Pasivo o Patrimonio Neto, según el criterio de tu contador. Si no se asigna, se usa la
            cuenta de aportes por defecto de Ajustes contables. Cambiarla no modifica los asientos
            ya generados.
          </FormDescription>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}
```

**Textos literales**: label `Cuenta contable de aportes (opcional)`; placeholder `Sin asignar`;
opción de limpieza `Sin asignar (usar la cuenta por defecto)`; ayuda la del `FormDescription`.
El `AccountCombobox` ya muestra `code - name` en el trigger y busca por código+nombre
(`AccountCombobox.tsx:88, 118`). Funciona server-first en `new/page.tsx` porque el
`QueryClientProvider` ya envuelve el dashboard (lo usa `_BankAccountFormModal`).

#### 3.4.2 `_PartnerForm.tsx` y `_EditPartnerForm.tsx`

`_PartnerForm.tsx:23-28` (props) y `:38-46` (defaults):

```ts
interface PartnerFormProps {
  defaultValues?: Partial<PartnerFormData>;
  onSubmit: (data: PartnerFormData) => Promise<void>;
  isSubmitting?: boolean;
  submitLabel?: string;
  /** Cuenta ya guardada (edición), para preservarla en el combo (TSK-717). */
  savedAccountId?: string | null;
}

// defaultValues:
{
  name: '',
  taxId: '',
  email: '',
  phone: '',
  notes: '',
  isActive: true,
  contributionsAccountId: null,   // ← TSK-717
  ...defaultValues,
}
```

Inserción, entre el campo `notes` (`:117-133`) y el switch `isActive` (`:135`), dentro del
mismo `Card` "Datos del Socio":

```tsx
<_PartnerAccountField control={form.control} savedAccountId={savedAccountId} />
```

`_EditPartnerForm.tsx:12-14` y `:35-51`:

```ts
interface EditPartnerFormProps {
  partner: PartnerWithAccount;     // antes Partner; getPartnerById ya lo devuelve así
}

const defaultValues: PartnerFormData = {
  name: partner.name,
  taxId: partner.taxId || '',
  email: partner.email || '',
  phone: partner.phone || '',
  notes: partner.notes || '',
  isActive: partner.isActive,
  contributionsAccountId: partner.contributionsAccountId ?? null,
};

<_PartnerForm
  defaultValues={defaultValues}
  onSubmit={handleSubmit}
  isSubmitting={isSubmitting}
  submitLabel="Guardar Cambios"
  savedAccountId={partner.contributionsAccountId}
/>
```

`_CreatePartnerForm.tsx` no cambia (sin `savedAccountId`; el default `null` alcanza).

#### 3.4.3 `_PartnerAccountNotice.tsx` (nuevo) — `fund-movements/list/components/`

Client Component (< 70 líneas). Reemplaza la alerta fija de `_CreateFundMovementModal.tsx:345-353`
y evita engordar el modal (520 líneas, deuda previa).

```tsx
'use client';

import Link from 'next/link';
import { AlertTriangle, Info } from 'lucide-react';

import type { FundMovementAccountRef, FundMovementPartnerOption } from '../actions.server';

interface PartnerAccountNoticeProps {
  /** Socio elegido en el formulario; `undefined` si todavía no se eligió. */
  partner: FundMovementPartnerOption | undefined;
  /** Cuenta de aportes por defecto de Ajustes contables; `null` si no está configurada. */
  defaultAccount: FundMovementAccountRef | null;
}

const ACCOUNTING_SETTINGS_HREF = '/dashboard/company/accounting/settings';

const neutral =
  'flex items-start gap-2 rounded-md border bg-muted/50 p-3 text-sm text-muted-foreground';
const warning =
  'flex items-start gap-2 rounded-md border border-orange-500/50 bg-orange-500/10 p-3 text-sm text-orange-600';

const label = (a: FundMovementAccountRef) => `${a.code} - ${a.name}`;

export function _PartnerAccountNotice({ partner, defaultAccount }: PartnerAccountNoticeProps) {
  // Estado 4: sin socio elegido. Con global no hay nada que avisar (el campo
  // obligatorio ya lo marca); sin global se anticipa que no va a poder confirmar.
  if (!partner) {
    if (defaultAccount) return null;
    return (
      <div className={warning} role="status">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <span>
          Para confirmar aportes o retiros hace falta una cuenta de aportes: asignala al socio o
          configurá la por defecto en{' '}
          <Link href={ACCOUNTING_SETTINGS_HREF} className="underline">Ajustes contables</Link>.
        </span>
      </div>
    );
  }

  // Estado 1: el socio tiene cuenta propia.
  if (partner.contributionsAccount) {
    return (
      <div className={neutral} role="status">
        <Info className="mt-0.5 h-4 w-4 shrink-0" />
        <span>
          El asiento se imputará a la cuenta <span className="font-mono">{label(partner.contributionsAccount)}</span> de {partner.name}.
        </span>
      </div>
    );
  }

  // Estado 2: sin cuenta propia, pero hay global.
  if (defaultAccount) {
    return (
      <div className={neutral} role="status">
        <Info className="mt-0.5 h-4 w-4 shrink-0" />
        <span>
          {partner.name} no tiene cuenta de aportes propia: se usará la cuenta por defecto{' '}
          <span className="font-mono">{label(defaultAccount)}</span>.
        </span>
      </div>
    );
  }

  // Estado 3: sin cuenta propia y sin global → no va a poder confirmar.
  return (
    <div className={warning} role="alert">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <span>
        {partner.name} no tiene cuenta de aportes y no hay una cuenta por defecto. Asignale una en{' '}
        <Link href={`/dashboard/commercial/treasury/partners/${partner.id}/edit`} className="underline">
          Tesorería → Socios
        </Link>
        , o configurá la &quot;Cuenta de aportes de socios por defecto&quot; en{' '}
        <Link href={ACCOUNTING_SETTINGS_HREF} className="underline">Ajustes contables</Link>. No vas
        a poder confirmar.
      </span>
    </div>
  );
}
```

**Los cuatro estados y su texto literal** (`{code} - {name}` es la etiqueta de la cuenta):

| Estado | Variante | Texto |
|---|---|---|
| Socio con cuenta propia | neutra (`Info`) | `El asiento se imputará a la cuenta {code} - {name} de {socio}.` |
| Socio sin cuenta, hay global | neutra (`Info`) | `{socio} no tiene cuenta de aportes propia: se usará la cuenta por defecto {code} - {name}.` |
| Socio sin cuenta, sin global | naranja (`AlertTriangle`, `role="alert"`) | `{socio} no tiene cuenta de aportes y no hay una cuenta por defecto. Asignale una en Tesorería → Socios, o configurá la "Cuenta de aportes de socios por defecto" en Ajustes contables. No vas a poder confirmar.` — con links a `/dashboard/commercial/treasury/partners/{id}/edit` y a `/dashboard/company/accounting/settings` |
| Sin socio elegido, sin global | naranja | `Para confirmar aportes o retiros hace falta una cuenta de aportes: asignala al socio o configurá la por defecto en Ajustes contables.` |
| Sin socio elegido, hay global | — | no renderiza nada |

Las clases naranjas son las mismas de la alerta actual (`_CreateFundMovementModal.tsx:336, 346`),
así que en modo oscuro se ve igual que hoy; la variante neutra usa tokens del tema
(`bg-muted/50`, `text-muted-foreground`) y no necesita variante dark explícita. Los links dentro
del `Dialog` navegan y cierran el modal por el cambio de ruta; el borrador no se pierde porque
el aviso solo aparece antes de confirmar y "Guardar" sigue disponible.

#### 3.4.4 `_CreateFundMovementModal.tsx`

Cambios puntuales, sin reestructurar el archivo:

1. **Props** (`:61-70`) y desestructuración (`:78-87`): `hasContributionsAccount: boolean` →
   `defaultContributionsAccount: FundMovementAccountRef | null` (importar el tipo desde
   `../actions.server`, `:48-58`). Eliminar la constante `NONE` (`:72`), que queda sin uso.
2. **Watch del socio** junto al de `type` (`:189`):

```ts
const partnerId = form.watch('partnerId');
const selectedPartner = partners.find((p) => p.id === partnerId);
```

3. **Aviso** (`:345-353`) reemplazado por:

```tsx
{isPartnerMovement && (
  <_PartnerAccountNotice partner={selectedPartner} defaultAccount={defaultContributionsAccount} />
)}
```

4. **Campo socio** (`:457-486`): obligatorio, sin opción "Sin socio". Mismo lugar (después de
   los bancos/cajas y antes de la descripción):

```tsx
{isPartnerMovement && (
  <FormField
    control={form.control}
    name="partnerId"
    render={({ field }) => (
      <FormItem>
        <FormLabel>Socio *</FormLabel>
        <Select onValueChange={field.onChange} value={field.value || undefined}>
          <FormControl>
            <SelectTrigger>
              <SelectValue placeholder="Seleccionar socio" />
            </SelectTrigger>
          </FormControl>
          <SelectContent>
            {partners.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <FormMessage />
      </FormItem>
    )}
  />
)}
```

El `FormMessage` muestra `Seleccioná el socio` (viene del `superRefine`). Si `partners` está
vacío, el `Select` no ofrece opciones y el mensaje de validación deja claro que hace falta dar de
alta un socio (no se agrega otro aviso: ya son suficientes).

5. **Efecto de limpieza** (`:218-228`): `partnerId` se limpia cuando el tipo **no** es de socio
   (hoy solo para gastos bancarios), así una transferencia tampoco arrastra un socio:

```ts
useEffect(() => {
  if (!isBankCharges) {
    if (form.getValues('lines')?.length) form.setValue('lines', []);
  } else {
    if (form.getValues('destinationFund')) form.setValue('destinationFund', '');
  }
  // TSK-717: el servidor persiste `partnerId` sin mirar el tipo; solo aporte y
  // retiro lo usan (y ahora define la cuenta del asiento).
  if (!isPartnerMovement && form.getValues('partnerId')) form.setValue('partnerId', '');
  if (isContribution && form.getValues('sourceFund')) {
    form.setValue('sourceFund', '');
  }
}, [isBankCharges, isContribution, isPartnerMovement, form]);
```

6. `FundMovementsList.tsx:37` → `defaultContributionsAccount={catalogs.defaultContributionsAccount}`;
   `_FundMovementsTable.tsx:40, 51, 133, 144` → prop `defaultContributionsAccount:
   FundMovementAccountRef | null` en la interfaz y en las dos instancias del modal.

El listado de movimientos (`fund-movements/list/columns.tsx:87-92`, columna "Socio" con
`partnerName ?? '—'`) no cambia.

#### 3.4.5 Columna "Cuenta de aportes" — `partners/features/list/columns.tsx`

Entre "Teléfono" (`:106-120`) y "Saldo a favor" (`:121-139`):

```tsx
{
  accessorKey: 'contributionsAccount',
  meta: { title: 'Cuenta de aportes' },
  header: ({ column }) => <DataTableColumnHeader column={column} title="Cuenta de aportes" />,
  enableSorting: false,
  cell: ({ row }) => {
    const account = row.original.contributionsAccount;
    if (!account) return <span className="text-muted-foreground">Por defecto</span>;
    return (
      <span className="font-mono text-xs" title={account.name}>
        {account.code} · {account.name}
      </span>
    );
  },
},
```

`enableSorting: false` porque `stateToPrismaParams` traduciría el `orderBy` a una relación y
Prisma lo rechazaría. "Por defecto" deja a simple vista qué socias siguen cayendo en la global
(mitigación del contra de la alternativa A). `_PartnersTable.tsx` no cambia.

#### 3.4.6 Detalle — `_PartnerDetailContent.tsx:30-32` y `:107-142`

Prop `partner: PartnerWithAccount` (`:27`, `:31`). En la card "Datos del Socio", después del
grid de cuatro campos (`:113-130`) y antes de las notas:

```tsx
<div className="mt-4 border-t pt-4">
  <p className="text-sm font-medium text-muted-foreground">Cuenta contable de aportes</p>
  <p className="text-sm">
    {partner.contributionsAccount ? (
      <span className="font-mono">
        {partner.contributionsAccount.code} - {partner.contributionsAccount.name}
      </span>
    ) : (
      'Por defecto (Ajustes contables)'
    )}
  </p>
  <p className="mt-1 text-xs text-muted-foreground">
    Cambiar esta cuenta no modifica los asientos ya generados.
  </p>
</div>
```

El archivo pasa de 170 a ~186 líneas: sigue debajo de 200.

#### 3.4.7 Responsive

- **Form del socio** (`_PartnerForm`): el campo nuevo ocupa el ancho completo del `Card`, fuera
  de los `grid md:grid-cols-2`, igual que `notes`; el `AccountCombobox` ya trunca el nombre
  (`truncate`, `AccountCombobox.tsx:124`) y su `Popover` se ajusta al ancho del trigger. A 375px
  el `FormDescription` de cuatro líneas se lee completo.
- **Modal de fondos**: el `DialogContent` ya es `sm:max-w-[560px] max-h-[90vh] overflow-y-auto`
  (`:299`); el aviso es un `flex` con ícono `shrink-0` y texto que envuelve, sin ancho fijo. El
  código de cuenta en `font-mono` puede partirse en dos líneas: aceptable.
- **Listado de socios**: la columna nueva se oculta con el selector de columnas del `DataTable`
  (por eso lleva `meta.title`); en móvil la tabla ya hace scroll horizontal.
- **Detalle**: el bloque nuevo es full-width debajo del grid, sin cambios de breakpoint.

### 3.5 Rutas y navegación

No hay rutas nuevas ni cambios en el sidebar. Rutas existentes involucradas, con sus archivos
bajo `src/app/(core)/dashboard/`:

| Ruta | Archivo | Qué cambia |
|---|---|---|
| `/dashboard/commercial/treasury/partners` | `commercial/treasury/partners/page.tsx` | columna "Cuenta de aportes" |
| `/dashboard/commercial/treasury/partners/new` | `commercial/treasury/partners/new/page.tsx` | campo "Cuenta contable de aportes" |
| `/dashboard/commercial/treasury/partners/[id]` | `commercial/treasury/partners/[id]/page.tsx` | dato "Cuenta contable de aportes" |
| `/dashboard/commercial/treasury/partners/[id]/edit` | `commercial/treasury/partners/[id]/edit/page.tsx` | campo con la cuenta guardada preseleccionada |
| `/dashboard/commercial/treasury/fund-movements` | `commercial/treasury/fund-movements/page.tsx` | "Socio *", aviso `_PartnerAccountNotice` |
| `/dashboard/company/accounting/settings` | `company/accounting/settings/page.tsx` | label y ayuda "por defecto" |

Links que emite el aviso destructivo (3.4.3): `/dashboard/commercial/treasury/partners/{id}/edit`
(editar al socio elegido) y `/dashboard/company/accounting/settings` (sidebar: Contabilidad →
Configuración, `_AppSidebar.tsx:484-488`). Las rutas que menciona la guía de usuario de la
fase 5: Plan de Cuentas `/dashboard/company/accounting/accounts` y Asientos
`/dashboard/company/accounting/entries` (`_AppSidebar.tsx:94-98, 479-483`).

### 3.6 APIs / Endpoints

No aplica. No se crean API Routes: todo son Server Actions ya listadas en 3.3
(`getPartnerContributionAccounts`, `getPartners`, `getPartnerById`, `createPartner`,
`updatePartner`, `deletePartner`, `getFundMovementCatalogs`, `createFundMovement`,
`updateFundMovement`, `confirmFundMovement`).

### 3.7 Consideraciones técnicas

#### Permisos (regla 11)

| Action | `checkPermission` | Estado |
|---|---|---|
| `getPartnerContributionAccounts` (nueva) | `('commercial.treasury.partners', 'view', { redirect: true })` | nuevo |
| `getPartners`, `getPartnerById` | `('commercial.treasury.partners', 'view')` | ya existe (`:68`, `:155`) |
| `createPartner` / `updatePartner` / `deletePartner` | `('commercial.treasury.partners', 'create' / 'update' / 'delete')` | ya existe (`:175`, `:217`, `:256`) |
| `getFundMovementCatalogs` | `('commercial.treasury.fund-movements', 'view')` | ya existe (`:119`) |
| `createFundMovement` / `updateFundMovement` / `confirmFundMovement` | `('commercial.treasury.fund-movements', 'create' / 'update' / 'update')` | ya existe (`:499`, `:572`, `:648`) |

Módulos tomados de `src/shared/lib/permissions/constants.ts:47, 49`. Las páginas ya tienen
`PermissionGuard` (`PartnerDetail.tsx:24`, `EditPartner.tsx:18`, `FundMovementsList.tsx:19`) y
el detalle usa `usePermissions` (`_PartnerDetailContent.tsx:36`). El nuevo helper
`resolvePartnerCapitalAccount` es privado y corre dentro de `confirmFundMovement`, que ya
verificó permisos. No hay módulos nuevos que registrar en `ACTIVATABLE_MODULES`.

#### Tests (Vitest, `npm run test`)

**`partners/shared/validators.test.ts`** (nuevo, sin base, rojo primero — fase 2):

1. acepta un socio solo con `name`, sin `contributionsAccountId`;
2. acepta `contributionsAccountId: null`;
3. acepta un uuid válido;
4. rechaza `'abc'` con `issues[0].message === 'Cuenta contable inválida'` y `path ['contributionsAccountId']`;
5. regresión: sigue rechazando `name: ''`.

**`fund-movements/shared/validators.test.ts`** (fase 3):

- Cambiar `partnerId: ''` → `partnerId: uuid` en **las dos** fixtures `aporte` (`:90-98` y
  `:283-290`; el plan solo nombraba la primera, ver ajuste 5).
- Nuevos en `describe('fundMovementSchema')`: `'exige el socio en un aporte'` (`partnerId: ''` →
  issue con `path ['partnerId']` y `message 'Seleccioná el socio'`); `'exige el socio en un
  retiro'` (idem con `PARTNER_WITHDRAWAL` + `sourceFund`); `'una transferencia no exige socio'`
  y `'un gasto bancario no exige socio'` (`partnerId: ''` → `success: true`).

**`fund-movement-lines.integration.test.ts`** (existente, fase 3): en el `beforeAll`
(`:136-204`) crear `prisma.partner.create({ data: { companyId, name: \`${PREFIX}Socio
fundador\`, createdBy: \`${PREFIX}user\` } })` (**`createdBy` es obligatorio**,
`schema.prisma:4401`) y usar su id en `:314` y `:349`; ese socio no tiene cuenta, así que ambos
casos pasan a documentar el fallback a `capitalAccountId`. En el `afterAll` (`:219-224`) agregar
`await prisma.partner.deleteMany({ where: { companyId } })` **después** de `fundMovement` y
**antes** de `account` (la FK nueva apunta a `accounts`), y sumar
`prisma.partner.count({ where: { name: { startsWith: PREFIX } } })` a la verificación final.

**`fund-movement-partner-account.integration.test.ts`** (nuevo, fase 3). Mismo andamiaje que el
existente: `import 'dotenv/config'`, `describe.skipIf(!dbAvailable)` con `SELECT 1`, prefijo
`TSK717-TEST-`, los cuatro `vi.mock` de `:76-79`, `vi.mocked(getActiveCompanyId)` /
`vi.mocked(getCurrentUserId)`, helper `fetchEntryLinesForMovement`.

- `beforeAll`: empresa; cuenta `ASSET` del banco; `BankAccount` con `accountId` y saldo;
  cuenta `EQUITY` `global`; cuenta `ASSET` `cuentaSociaA` (prueba que el tipo Activo se
  acepta); `AccountingSettings` con `partnerContributionsAccountId: global`; `Partner` `sociaA`
  con `contributionsAccountId: cuentaSociaA`; `Partner` `sociaB` sin cuenta. Todos con
  `createdBy`.
- Casos (siempre por `createFundMovement(input, true)` real, salvo el 5):
  1. Aporte de `sociaA` → 2 líneas: Debe banco, **Haber `cuentaSociaA`**; ninguna toca `global`.
  2. Aporte de `sociaB` → Haber `global` (fallback).
  3. Retiro de `sociaA` → **Debe `cuentaSociaA`**, Haber banco.
  4. `sociaB` sin global: `accountingSettings.update({ partnerContributionsAccountId: null })`;
     aporte → `success: false`, `error` contiene `sociaB.name`, `"no tiene cuenta de aportes"` y
     `"Ajustes contables"`; el movimiento queda `DRAFT` con `journalEntryId: null`; restaurar.
  5. Borrador legado sin socio: `prisma.fundMovement.create` directo (`PARTNER_CONTRIBUTION`,
     `partnerId: null`, `fundInKind: 'BANK'`, `fundInId`, `status: 'DRAFT'`, `createdBy`) y
     `confirmFundMovement(id)` → `success: false`, `error` contiene
     `"Editá el movimiento y elegí el socio"`.
  6. Cuenta del socio no imputable: `account.update({ where: { id: cuentaSociaA }, data: {
     isActive: false } })`; aporte de `sociaA` → `success: false`, `error` contiene
     `sociaA.name` y `cuentaSociaA.code`; **no** genera asiento contra `global`; restaurar
     `isActive: true`.
- `afterAll` con guarda `if (companyId)` y orden **fundMovement → journalEntry → bankAccount →
  accountingSettings → partner → account → company**; verificación final por prefijo en
  `fundMovement.description`, `partner.name`, `account.name`, `company.name`.

**Advertencia sobre el `vi.mock` de permisos**: el mock de reemplazo total
(`vi.mock('@/shared/lib/permissions', () => ({ checkPermission: vi.fn()… }))`, como en
`fund-movement-lines.integration.test.ts:78`) funciona porque `fund-movements/list/actions.server.ts`
solo importa `checkPermission` de ese módulo. Si el test nuevo llegara a importar
`partners/features/list/actions.server.ts` u otro módulo que también tome constantes de
`@/shared/lib/permissions`, hay que pasar al patrón con `importOriginal` de
`role-members.integration.test.ts:34-37` (`...(await importOriginal()), checkPermission: vi.fn()`),
o el import de las constantes devuelve `undefined` y el error es poco legible.

#### Reglas del proyecto

- **Decimal → Number**: no hay decimales nuevos; `getPartners` ya convierte `balance` y
  `getFundMovements` ya convierte `amount`. `contributionsAccount` es `{ id, code, name }`, plano.
- **Logger**: `logger.info` en `createPartner`/`updatePartner` suma `contributionsAccountId`; el
  de `confirmFundMovement` suma `type`, `partnerId` y `capitalSource`. Ningún `console.*`.
- **Prefijo `_`**: `_PartnerAccountField.tsx` y `_PartnerAccountNotice.tsx` son Client
  Components (usan `useQuery` / `next/link` y se montan dentro de forms cliente).
- **< 200 líneas**: `_PartnerForm.tsx` 167 → ~175; `_PartnerDetailContent.tsx` 170 → ~186;
  `_PartnerAccountField.tsx` < 80; `_PartnerAccountNotice.tsx` < 70.
  `_CreateFundMovementModal.tsx` (520) y `fund-movements/list/actions.server.ts` (840) son deuda
  previa y **no crecen** (el aviso sale a componente; el helper reemplaza un bloque y los dos
  bloques duplicados de `partnerName` se unifican).
- **Textos en español** con acentos; los mensajes de error y de aviso son parte del entregable
  y están literales en 3.3.9, 3.3.11, 3.4.1 y 3.4.3.
- **No importar entre módulos**: `commercial` usa `buildImputableAccountsWhere` de
  `@/shared/lib/accounts` y `AccountCombobox` de `@/shared/components/common`; `accounting` solo
  cambia textos. El import `fund-movements` → `partners/shared/types` es intra-módulo.
- **`AlertDialog`**: el borrado de socio ya usa `AlertDialog` (`_PartnerDetailContent.tsx:82-102`);
  el mensaje nuevo llega por `toast.error`. Sin `confirm()`.
- **moment**: sin fechas nuevas.

#### Ajustes respecto al plan

1. **Firma y ubicación de `resolvePartnerCapitalAccount`.** El plan (fase 3) la describía como
   `resolvePartnerCapitalAccount(movement, settings, companyId)` fuera de la transacción,
   devolviendo `capitalAccountId`. El diseño la define como
   `resolvePartnerCapitalAccount(tx, companyId, partnerId, defaultAccountId): Promise<{ accountId; source; partnerName }>`
   y la llama **dentro** de `prisma.$transaction`. Motivo: la verificación de imputabilidad y
   la escritura del asiento usan la misma foto de la base; `source` permite loguear y testear
   si se usó la cuenta propia o la global. Los cinco casos y sus mensajes son los del plan, sin
   cambios.
2. **Ruta real de la configuración contable.** El plan (fase 4, criterio de completitud) dice
   `/dashboard/accounting/settings`; la ruta real es `/dashboard/company/accounting/settings`
   (`src/app/(core)/dashboard/company/accounting/settings/page.tsx`; sidebar
   `_AppSidebar.tsx:486`). Idem Plan de Cuentas (`/dashboard/company/accounting/accounts`) y
   Asientos (`/dashboard/company/accounting/entries`) para la guía y las capturas de la fase 5.
3. **Constante compartida `PARTNER_CONTRIBUTION_ACCOUNT_TYPES`.** El plan repetía el literal
   `['ASSET', 'LIABILITY', 'EQUITY']` en la action del combo y en la confirmación. Se declara
   una vez en `partners/shared/types.ts` y se importa desde `fund-movements` (import entre
   features del mismo módulo, como el que ya existe hacia `products/shared/account-filters`).
   Mismo criterio que el plan aplicó al reutilizar `buildImputableAccountsWhere`.
4. **Nombre del enum.** El pedido de diseño habla de excluir "INCOME/EXPENSE"; el enum real es
   `AccountType { ASSET, LIABILITY, EQUITY, REVENUE, EXPENSE }` (`schema.prisma:220-228`). Se
   excluyen `REVENUE` y `EXPENSE`.
5. **Segunda fixture `aporte` en `validators.test.ts`.** El plan solo menciona `:89-98`; existe
   otra en `:283-290` (bloque de regresión de TSK-585, `'un aporte sigue siendo válido sin
   líneas'`) que también manda `partnerId: ''` y fallaría por la razón equivocada. Hay que
   cambiar las dos.
6. **Helper `resolvePartnerName`.** El plan pedía tocar los dos bloques de `partnerName` en
   `createFundMovement` y `updateFundMovement`; el diseño los unifica en un helper privado con
   la misma regla (`BusinessError('El socio seleccionado no es válido')` solo en aporte/retiro).
   Sin cambio de comportamiento respecto al plan.
7. **`assertAccountBelongsToCompany`.** Misma idea: el plan pedía la validación inline en
   `createPartner` y `updatePartner`; se extrae a un helper privado con el mensaje literal del
   plan (`'La cuenta contable seleccionada no pertenece a la empresa'`).
8. **Prop `partner` de `_EditPartnerForm`.** El plan no lo decía explícitamente: pasa de
   `Partner` a `PartnerWithAccount` para que `partner.contributionsAccountId` tipe sin cast
   (`getPartnerById` ya lo devuelve así, 3.3.3).

## 4. Implementación

### Fase 1: Esquema y migración aditiva
- **Estado:** Completada (2026-09-18)
- **Archivos modificados:**
  - `prisma/schema.prisma` - `Partner.contributionsAccountId` (nullable, `@db.Uuid`), relación `contributionsAccount` con nombre `"PartnerOwnContributionsAccount"` y `onDelete: SetNull`, índice; inversa `partners Partner[]` en `Account` (debajo de `cashRegisters`).
  - `prisma/migrations/20260918153728_tsk_717_partner_contributions_account/migration.sql` - creado: ADD COLUMN + CREATE INDEX + FK `ON DELETE SET NULL ON UPDATE CASCADE`. Sin backfill.
  - `src/generated/prisma/**` - regenerado con `npm run db:generate`.
- **Notas:** el SQL generado coincide con el esperado en 3.2.1. `npm run check-types` sigue en 227 (línea base). En producción la migración la aplica solo `docker-entrypoint.sh` al arrancar el contenedor (`migrate deploy`); no hay script de datos que correr.

### Fase 2: Socios — cargar y mostrar la cuenta de aportes
- **Estado:** Completada (2026-09-18)
- **Archivos modificados:**
  - `partners/shared/validators.test.ts` - creado (TDD: rojo con 3 de 5 casos antes de tocar el schema, verde después): sin cuenta, `null`, uuid válido, `'abc'` → `'Cuenta contable inválida'` en `path ['contributionsAccountId']`, regresión `name: ''`.
  - `partners/shared/validators.ts` - `contributionsAccountId: z.string().uuid('Cuenta contable inválida').nullable().optional()`; nuevo `export type PartnerFormInput = z.input<typeof partnerSchema>`.
  - `partners/shared/types.ts` - `Partner.contributionsAccountId: string | null`; `PartnerAccountRef`, `PartnerWithAccount`; `PartnerWithBalance extends PartnerWithAccount`; `PARTNER_CONTRIBUTION_ACCOUNT_TYPES: AccountType[] = ['ASSET', 'LIABILITY', 'EQUITY']`.
  - `partners/features/list/actions.server.ts` - `getPartnerContributionAccounts(includeIds?: string[])` + `PartnerContributionAccountOption`, con `buildImputableAccountsWhere` de `@/shared/lib/accounts/imputable-accounts` envuelto en `OR` cuando hay `includeIds`; `include` de `contributionsAccount { id, code, name }` en `getPartners` y `getPartnerById` (retorna `PartnerWithAccount | null`); helper privado `assertAccountBelongsToCompany`; `createPartner`/`updatePartner` guardan `contributionsAccountId` y lo loguean; `deletePartner` suma `prisma.fundMovement.count({ where: { companyId, partnerId: id } })` con el mensaje literal del diseño, después del bloqueo por `movements`/`cards`.
  - `partners/features/create/components/_PartnerAccountField.tsx` - creado (64 líneas, Client): `useQuery(['partner-contribution-accounts', savedAccountId])` + `AccountCombobox` con label "Cuenta contable de aportes (opcional)", placeholder "Sin asignar", clearLabel "Sin asignar (usar la cuenta por defecto)" y el `FormDescription` literal de 3.4.1.
  - `partners/features/create/components/_PartnerForm.tsx` - prop `savedAccountId`, default `contributionsAccountId: null`, `<_PartnerAccountField>` entre `notes` e `isActive` (174 líneas).
  - `partners/features/edit/components/_EditPartnerForm.tsx` - prop `partner: PartnerWithAccount`, `contributionsAccountId` en `defaultValues`, `savedAccountId={partner.contributionsAccountId}`.
  - `partners/features/list/columns.tsx` - columna "Cuenta de aportes" (`meta.title`, `enableSorting: false`, `code · name` en `font-mono text-xs` o "Por defecto") entre Teléfono y Saldo a favor.
  - `partners/features/detail/components/_PartnerDetailContent.tsx` - prop `PartnerWithAccount`; bloque "Cuenta contable de aportes" con `code - name` o "Por defecto (Ajustes contables)" y la nota "Cambiar esta cuenta no modifica los asientos ya generados." (188 líneas).
- **Notas:**
  - `buildImputableAccountsWhere` no tiene opción `includeIds`: se implementó el `OR` envolvente como dice 3.3.1 (mismo patrón que `getFundMovementLineAccounts`).
  - Desvío de tipado respecto a 3.4.1: la prop es `control: Control<PartnerFormInput, unknown, PartnerFormData>` y no `Control<PartnerFormData>`. Motivo: `_PartnerForm` usaba `useForm<PartnerFormData>` con `zodResolver` y `isActive.default(true)` desalinea input/output; eso ya generaba 8 errores de `check-types` en el archivo (deuda previa) y el `control` tipado como en el diseño sumaba un noveno. Se quitó el genérico explícito de `useForm` (patrón de `_BankAccountFormModal`) y se tipó el `control` con input/output separados. Resultado: `check-types` baja de 227 a **219** (los 8 previos de `_PartnerForm.tsx` desaparecen); los 18 que quedan bajo `partners/` son de `_PartnerMovementDialog.tsx` y `_PartnerRepaymentDialog.tsx`, no tocados.
  - `columns.tsx` pasa de 200 a 218 líneas: ya estaba en el límite antes de la columna nueva; es un archivo de definición de columnas, no un componente, y no se refactorizó para no ampliar el alcance.
  - En `updatePartner` el `findFirst` de `existing` ahora lleva `select: { id: true }` (solo se usa para verificar existencia).
  - `npx vitest run .../partners`: 5/5 en verde. `npx eslint` sobre los 9 archivos tocados: limpio. Sin `console.*` ni `:any`. No se tocó nada de `fund-movements/`, `_CommercialIntegrationForm.tsx` ni guías (Fases 3-5).

### Fase 3: Movimientos de fondos — socio obligatorio y asiento por socio
- **Estado:** Completada (2026-09-18)
- **Archivos modificados:**
  - `fund-movements/shared/validators.ts` - comentario de `partnerId` y `superRefine`: `'Seleccioná el socio'` en `PARTNER_CONTRIBUTION` y `PARTNER_WITHDRAWAL`; `ACCOUNT_TRANSFER` y `BANK_CHARGES` sin cambios.
  - `fund-movements/shared/validators.test.ts` - las dos fixtures `aporte` con `partnerId` uuid; 4 casos nuevos (exige socio en aporte/retiro, transferencia y gasto bancario no lo exigen).
  - `fund-movements/list/actions.server.ts` - `getFundMovementCatalogs` devuelve `partners: {id, name, contributionsAccount}[]` y `defaultContributionsAccount: FundMovementAccountRef | null` (reemplaza `hasContributionsAccount`); helpers privados `resolvePartnerCapitalAccount(tx, companyId, partnerId, defaultAccountId): Promise<{ accountId; source: 'partner' | 'default'; partnerName }>` y `resolvePartnerName(data, companyId)`; `confirmFundMovement` sin la pre-validación de la global, resuelve la cuenta dentro de la transacción antes de `applyFundSide` (aporte = Haber, retiro = Debe) y loguea `capitalSource`; `createFundMovement`/`updateFundMovement` rechazan socio ajeno en aporte/retiro (`'El socio seleccionado no es válido'`); tipo exportado `FundMovementAccountRef`.
  - `fund-movements/list/fund-movement-lines.integration.test.ts` - `Partner` real sin cuenta en el `beforeAll`, aporte/retiro documentan el fallback a la global; `partner.deleteMany` entre `accountingSettings` y `account`; `partner.count` en la verificación final.
  - `fund-movements/list/fund-movement-partner-account.integration.test.ts` - creado: 7 `describe` / 9 casos contra la base real (cuenta propia en aporte y retiro, fallback a la global, sin global → error nombrando a la socia, borrador legado sin socio, cuenta propia inactiva sin fallback, socio inexistente al crear y socio borrado antes de confirmar). Prefijo `TSK717-TEST-`, limpieza en el orden fundMovement → journalEntry → bankAccount → accountingSettings → partner → account → company.
  - `fund-movements/list/components/_PartnerAccountNotice.tsx` - creado (90 líneas): 4 estados con `Info`/`AlertTriangle`, links a `/dashboard/commercial/treasury/partners/{id}/edit` y `/dashboard/company/accounting/settings`.
  - `fund-movements/list/components/_CreateFundMovementModal.tsx` - prop `defaultContributionsAccount`, `form.watch('partnerId')` + `selectedPartner`, notice en lugar de la alerta fija, campo "Socio *" sin "Sin socio" (constante `NONE` eliminada), limpieza de `partnerId` para todo tipo que no sea de socio. 520 → 516 líneas.
  - `fund-movements/list/components/_FundMovementsTable.tsx`, `fund-movements/list/FundMovementsList.tsx` - prop `defaultContributionsAccount` en lugar de `hasContributionsAccount`.
- **Notas:**
  - TDD: unitarios (2 rojos) e integración nueva (7 rojos) fallaron por la razón correcta antes de tocar producción; después del cambio, `npx vitest run` completo en verde (29 archivos, 360 tests) y 0 filas `TSK717-TEST-%` en la base.
  - `npx eslint` limpio en `fund-movements/`. `npm run check-types`: ningún error en `fund-movements/`; el total bajó de 227 a 219 durante la corrida en paralelo con la Fase 2 (todos preexistentes, del tipado de `zodResolver` en otros modales).
  - Desvío respecto a 3.3.9: los tipos permitidos para la cuenta del socio se declaran como constante privada `PARTNER_CAPITAL_ACCOUNT_TYPES` en `fund-movements/list/actions.server.ts` en lugar de importar `PARTNER_CONTRIBUTION_ACCOUNT_TYPES` de `partners/shared/types` (la Fase 2 la estaba creando en paralelo y la consigna fue no depender de código nuevo de `partners/`). Mismo literal `['ASSET', 'LIABILITY', 'EQUITY']`; unificar el import es un cambio de una línea cuando las dos fases estén integradas.
  - Desvío menor respecto a 3.7: el test nuevo agrega un séptimo bloque (socio inexistente al crear → `'El socio seleccionado no es válido'` sin borrador huérfano; socio borrado entre borrador y confirmación → `'El socio del movimiento ya no existe'`) para cubrir el caso 2 de `resolvePartnerCapitalAccount` y `resolvePartnerName`, que el diseño pedía pero el plan de tests no listaba.
  - `actions.server.ts` pasa de 841 a 958 líneas (deuda previa): el crecimiento son los docblocks de los dos helpers nuevos; la lógica reemplaza bloques existentes.
  - Verificación manual en el modal (mensaje "Seleccioná el socio", los 4 estados del aviso, links) queda para la Fase 6.

### Fase 4: Configuración contable — la global pasa a ser "por defecto"
- **Estado:** Completada (2026-09-18)
- **Archivos modificados:**
  - `src/modules/accounting/features/settings/components/_CommercialIntegrationForm.tsx` - label "Cuenta de aportes de socios por defecto" y texto de ayuda que remite a Tesorería → Socios. `name` y `types: ['EQUITY']` sin cambios.
- **Notas:** sin cambios en validators, tests ni actions de settings (solo texto). No había otras menciones al label viejo en `src/`.

### Fase 5: Documentación
- **Estado:** Completada (2026-09-18)
- **Archivos modificados:**
  - `src/modules/help/features/guide/components/_TreasuryGuide.tsx` - import `Users`; card nueva **"Socios"** antes de "Movimientos de Fondos" (qué es un socio, alta paso a paso con el campo "Cuenta contable de aportes (opcional)" y sus tipos Activo/Pasivo/Patrimonio, crear la cuenta antes en Plan de Cuentas, columna "Cuenta de aportes"/"Por defecto", `Alert` de fallback a la por defecto, `Alert` "cambiar la cuenta no modifica asientos", regla de borrado/desactivación). En "Movimientos de Fondos": tipos aporte/retiro contra la cuenta **del socio** (o la por defecto), paso 3 con socio obligatorio y el aviso debajo del campo, `Alert` de configuración reescrita (cuenta del socio o por defecto; aviso naranja; queda en borrador) y `Alert` nueva **"El asiento nace en borrador"** (Registrar en Contabilidad → Asientos; el Mayor y el Balance solo suman registrados).
  - `src/modules/help/features/guide/components/_AccountingGuide.tsx` - ítem "Resultado del Ejercicio y Aportes de Socios **por defecto**" con la aclaración de la cuenta propia por socio en Tesorería → Socios.
  - `docs/architecture/data-model.md` - filas `Partner` (con `contributionsAccountId → Account`, relación `PartnerOwnContributionsAccount`, `SetNull`) y `PartnerAccountMovement` en la tabla de Tesorería; `FundMovement.partnerId` "obligatorio en aporte/retiro desde TSK-717, sin FK" + `partnerName`; bloque nuevo **"Cuenta de aportes por socio (TSK-717)"** (regla `partner.contributionsAccountId ?? settings.partnerContributionsAccountId`, Haber/Debe, sin fallback si la propia no es imputable, tipos admitidos vs. global, `SetNull` y por qué, socio obligatorio y `deletePartner`, asiento en `DRAFT`, migración aditiva sin backfill).
  - `docs/modules/commercial.md` - `partners/` y `fund-movements/` en el árbol de Tesorería; sección nueva **"Socios y Movimientos de Fondos"** (árbol `Partner`/`FundMovement`, flujo DRAFT → CONFIRMED, los 4 casos de `resolvePartnerCapitalAccount` con sus mensajes literales, socio obligatorio en el validator, `_PartnerAccountNotice`/`getFundMovementCatalogs`, `getPartnerContributionAccounts(includeIds?)`, `PARTNER_CONTRIBUTION_ACCOUNT_TYPES`, regla de `deletePartner`); filas "Socios" y "Movimientos de Fondos" en Archivos Clave → Server Actions.
- **Archivos creados:**
  - `scripts/guia-presentacion/tsk-717.html` - guía de presentación con la estructura y estilos de `tsk-692.html` (eyebrow "Tickets 413 · 706 · 717 · 724-d · Tesorería"). Secciones: 1. Qué pedías (citas de 413 y 706, qué pasaba); 2. Qué cambió (antes/ahora + asiento nº 13 como captura principal); 3. Cómo se usa paso a paso (asignar cuenta en Socios → cargar el aporte → confirmar y ver el asiento; capturas 01-04, 06-08); 4. Detalles que conviene saber (socio obligatorio, fallback a la por defecto con captura 05, sin cuenta ni por defecto no deja confirmar con captura 09, cuentas de Activo/Pasivo/Patrimonio, cambiar la cuenta no toca lo confirmado); 5. Importante: el asiento nace en Borrador (saldo de tesorería vs. asiento, cómo registrar desde el menú … → Registrar, y la nota "si ves la fecha corrida, ya lo tenemos identificado"); 6. Qué no cambió (transferencias y gastos bancarios, aportes ya confirmados, campo renombrado con captura 10, cuenta corriente del socio).
  - `docs/presentaciones/TSK-717-cuenta-por-socio.pdf` - generado con `generar-pdf.mjs` (Chrome del sistema como fallback): **7 páginas, 482 KB**, las 10 capturas de `assets/tsk717-*.png`.
- **Notas:**
  - Las capturas (`scripts/guia-presentacion/capturas-tsk717.mjs` y `assets/tsk717-01..10.png`) se hicieron en la Fase 6, antes de esta fase; el set real difiere del listado del plan (10 capturas en lugar de 7: se sumaron el form completo, el modal completo, el listado de movimientos y el aviso "por defecto"; no hay captura separada del menú Registrar). El PDF se armó sobre el set real.
  - El PDF no menciona el badge "Manual" del asiento automático (2.4) y presenta la fecha corrida solo como "ya lo tenemos identificado", según lo acordado.
  - Ajustes de texto contra la UI real: la pantalla de bancos se llama "Tesorería → Cuentas" en el menú (no "Cuentas Bancarias") y Asientos no tiene filtro por estado, solo ordenamiento por la columna Estado; el PDF lo dice así.
  - Maquetación: las cuatro capturas del modal van a 420px (`figure.modal`) y los pasos largos pueden partirse entre páginas (`ol.steps.long`), para no dejar páginas casi vacías.
  - `npx eslint` sobre las dos guías: 0 errores (1 warning preexistente en `_AccountingGuide.tsx`: import `Receipt` sin usar, ajeno a este ticket). `npm run check-types`: 219 errores (línea base de la rama, sin cambios).

### Fase 6: Verificación final
- **Estado:** Completada (2026-09-18, antes de la Fase 5 para que el PDF tenga capturas reales)
- **Cómo:** dev server en `:3010` con `NEXT_PUBLIC_APP_URL` sobreescrita; script `scripts/guia-presentacion/capturas-tsk717.mjs` que recorre el flujo real (alta de socia con cuenta, listado, modal en sus 3 estados, confirmación, asiento, ajustes) sobre la Empresa de Prueba 01 SA.
- **Resultados:**
  - Alta de "María López" con cuenta `1.1.4/02/01 Cuenta Part. Socio 1` desde el form → columna "Cuenta de aportes" la muestra; "Juan Perez" queda "Por defecto".
  - Aporte de $250.000 confirmado → asiento nº 13: Banco Santander Debe 250.000 / **Cuenta Part. Socio 1** Haber 250.000 (ya no la global).
  - Aviso del modal en los 3 estados con los textos del diseño; el estado "falta configurar" se probó vaciando la global y restaurándola.
  - Ajuste de UX surgido de la prueba: el aviso estaba debajo de "Tipo de movimiento"; se movió debajo del campo Socio para que el mensaje quede pegado al dato que describe.
  - `npx vitest run` 29 archivos / 360 tests; `check-types` 219 (base 227: la Fase 2 corrigió 8 previos); eslint limpio en lo tocado.
- **Hallazgo fuera de alcance (agregado a 2.4):** `_EntriesTable.tsx:243` muestra la fecha del asiento con `new Date(entry.date).toLocaleDateString()`; con un timestamp sin zona cae al día anterior en UTC-3 (el aporte del 18/09 se lista como 17/9 aunque la base guarda 2026-09-18). Además viola la regla moment.js. Y el asiento automático se etiqueta "Manual".

## 5. Verificación

**Fecha:** 2026-09-18 · **Entorno:** dev server `:3010` (`NEXT_PUBLIC_APP_URL` sobreescrita), base `contable-pms-db`, Empresa de Prueba 01 SA · **Script:** `scripts/guia-presentacion/capturas-tsk717.mjs http://localhost:3010`

| Caso | Resultado |
|---|---|
| Alta de socia con cuenta `1.1.4/02/01 Cuenta Part. Socio 1` desde el form (`AccountCombobox` con búsqueda) | OK; listado muestra la cuenta; el socio sin cuenta muestra "Por defecto" |
| Aporte $250.000 a la socia con cuenta propia → `Guardar y Confirmar` | Movimiento Confirmado, asiento nº 13: Banco Santander Debe 250.000 / **Cuenta Part. Socio 1** Haber 250.000 |
| Aviso modal — socio con cuenta propia | "El asiento se imputará a la cuenta 1.1.4/02/01 - Cuenta Part. Socio 1 de María López." |
| Aviso modal — socio sin cuenta, con global | "Juan Perez no tiene cuenta de aportes propia: se usará la cuenta por defecto 3.1.1/01/00 - Acciones en Circulación." |
| Aviso modal — sin cuenta ni global (global vaciada y restaurada por el script) | Aviso naranja con links a Socios y Ajustes contables; "No vas a poder confirmar." |
| Retiro, cuenta no imputable, socio inexistente, socio borrado entre borrador y confirmación, transferencias/gastos bancarios sin socio | Cubiertos por `fund-movement-partner-account.integration.test.ts` (7 bloques) y `validators.test.ts` |
| Ajustes contables | Campo renombrado "Cuenta de aportes de socios por defecto" con la ayuda nueva |
| Móvil 375px — form de socio | `scrollWidth` 375, combo dentro del viewport |
| Móvil 375px — modal de fondos | El aviso queda dentro (361px). El `DialogContent` mide 411px **también sin el aviso** (medido con el tipo por defecto): desborde preexistente del modal, anotado en 2.4 |
| `npx vitest run` | 29 archivos / 360 tests en verde |
| `npm run check-types` | 219 errores (línea base 227; la Fase 2 corrigió 8 previos en `_PartnerForm`), 0 en archivos tocados |
| `npx eslint` en `partners/`, `fund-movements/`, guías | Limpio (errores preexistentes solo en `bank-movements`, `payment-orders`, `receipts`, no tocados) |

Ajuste surgido de la verificación: el aviso se movió debajo del campo Socio (`6930ec4`).

Capturas: `scripts/guia-presentacion/assets/tsk717-*.png` (01-10 desktop, 11-12 móvil).
