# TSK-760 — Cierre contable: el cierre anual no funciona y el bloqueo de períodos se saltea

**Fecha de inicio:** 2026-10-06
**Estado:** Análisis completado

---

## 1. Análisis

### 1.1 Problema

TSK-760 es la **Fase 0** del análisis de TSK-758 (`.planes/tsk-758-modificaciones-con-periodo-abierto.md`),
separada como ticket propio. Antes de poder decir "todo es modificable salvo período cerrado"
hay que tener **una sola definición de período cerrado que se cumpla en todos lados**. Hoy:

- El **cierre anual no se puede ejecutar**: exige meses cerrados que nadie cierra (B1) y las
  empresas creadas después de la migración 20260625 no tienen `FiscalYear` (B2).
- El **bloqueo de períodos se saltea**: según el creador del asiento se mira `FiscalYear.isClosed`,
  `AccountingPeriod.isClosed`, `lockedUntilDate` o nada (B3, B6). Desbloquear el primer mes del
  ejercicio nuevo reabre el ejercicio cerrado (B5). Se puede registrar un borrador dentro de un
  ejercicio cerrado (B4).
- Varios creadores numeran con `lastEntryNumber + 1` no atómico (B8), no cargan
  `fiscalYearId`/`periodId` (B7) o callan el error (B9).
- La **anulación desde Asientos** no copia auxiliares ni moneda, no valida la fecha de la
  reversión y deja anular el asiento de una factura que sigue vigente (B10).

**Alcance:** B1 a B10 de 758 §1.6 con la arquitectura base de 758 §1.7.1 puntos 1, 2 y 3
(`assertPeriodOpen`, `createJournalEntryTx`/`nextEntryNumberTx`, `reverseJournalEntryTx`,
`setLockedPeriod` sincronizado, `closeFiscalYear` con períodos cerrados y sin DRAFT, backfill).
**Fuera de alcance** (sigue en 758): `replaceDocumentEntryTx`, la matriz por documento, B11 a B17.

**Hallazgo nuevo que condiciona el alcance (ver 1.6, B18 a B22):** al destrabar el cierre anual,
quedan expuestos defectos del propio `closeFiscalYear` que hoy nadie vio porque nunca corrió: con
cero saldos de resultado revienta contra un CHECK de la DB, el asiento de apertura sale
**desbalanceado** y, aun balanceado, **duplica los saldos patrimoniales** en Balance, Sumas y
Saldos y Mayor. Además, todo el cálculo de "mes" usa `moment()` en hora local y producción corre
en UTC. Hay que decidir (1.7, D7 y D8) si entran en este ticket; la recomendación es que sí.

**Criterios de aceptación (cc-tickets #760):**

1. Cerrar meses en orden y luego el cierre anual, sin error.
2. Las empresas sin `FiscalYear` lo tienen después de la migración.
3. Ningún creador de asientos acepta fechas en período cerrado (con error legible), y todos cargan
   `fiscalYearId`/`periodId` y número atómico.
4. No se registra un DRAFT en un ejercicio cerrado, y el cierre anual informa los DRAFT pendientes.
5. Desbloquear nunca reabre un ejercicio cerrado.
6. La reversión copia auxiliares y moneda, valida ambas fechas y no permite anular desde Asientos
   uno que pertenece a un documento.
7. Tests de integración por creador y del helper.

### 1.2 Contexto actual

Lo ya descripto en 758 §1.2.1 (los dos mecanismos de cierre), §1.2.3 (DRAFT, reportes POSTED,
triggers) y §1.2.4 (`reverseJournalEntry`) **se verificó y sigue vigente**; acá va solo lo
nuevo o corregido.

#### 1.2.1 Inventario completo de creadores de `JournalEntry` (verificado)

Búsqueda: `journalEntry.create`, `INSERT INTO journal_entries` y `createJournalEntry*` en `src/`
y `prisma/` (sin `src/generated`). No hay SQL crudo que inserte asientos. Paths relativos a
`src/modules/`. "Período" = qué verificación de cierre hace hoy.

| # | Creador (caller → helper) | Archivo:línea | Período hoy | `fiscalYearId`/`periodId` | Numeración | Nace | Ante período cerrado / error |
|---|---|---|---|---|---|---|---|
| 1 | Asiento manual `createJournalEntry` (UI `_CreateEntryModal.tsx:91`) | `accounting/features/entries/actions.server.ts:16` (`:45`) | `validateJournalEntryDate` **fuera de la tx** (`:24`): `FiscalYear.isClosed` → `validatePeriodLock` (período **o** `lockedUntilDate`, no ambos); sin FY, fecha dentro de Ajustes | sí (`resolveFiscalPeriod`, fuera de la tx) | atómica (`:38-43`) | DRAFT | lanza `Error` (redactado en prod). Usa el `companyId` que manda el cliente |
| 2 | `postJournalEntry` (UI `_PostEntryDialog.tsx`) | `entries/actions.server.ts:112` (`:157`) | solo `validatePeriodLock`; **no** mira `FiscalYear.isClosed` (B4) | — | — | DRAFT → POSTED | lanza `Error` |
| 3 | `reverseJournalEntry` (UI `_ReverseEntryDialog.tsx:32`) | `entries/actions.server.ts:212` (`:273`) | `validatePeriodLock` de la fecha original (`:253`); la fecha de hoy no se valida | sí, de hoy (`:260`) | atómica (`:265-270`) | POSTED | lanza `Error`; copia solo cuenta, descripción, debe y haber (`:285-291`) |
| 4 | Integración comercial: venta, compra, recibo, OP, gasto (`createJournalEntryFor*`) | `accounting/features/integrations/commercial/index.ts:198` (`:252`) | solo `lockedUntilDate` (`:207-221`) | sí (`:224-241`, mes con `moment()` local) | atómica (`:244-249`) | DRAFT | `BusinessError` "el período está cerrado…" |
| 5 | CMV `createJournalEntryForCOGS` | `integrations/commercial/index.ts:1204` | vía #4 | vía #4 | vía #4 | DRAFT | **código muerto** (sin callers) y además traga el error → `null` (`:1271-1275`) |
| 6 | Baja y venta de equipo (`softDeleteVehicle` en `equipment/features/list/actions.server.ts:379`) | `integrations/equipment/index.ts:64` (`:134`) | solo `lockedUntilDate` (`:86-103`) | sí (`:106-124`) | atómica (`:127-132`) | DRAFT | `BusinessError`. **No guarda el vínculo**: el id del asiento solo se devuelve (`list/actions.server.ts:377-391`) |
| 7 | Tesorería: transferencia, depósito y rechazo de cheque | `integrations/treasury/index.ts:41` (`:93`) | `lockedUntilDate` con `<=` de timestamps (`:61`) | sí, mes con `getMonth()` local (`:72-84`) | atómica (`:86-91`) | DRAFT | **devuelve `null`** (B9). **Código muerto**: ningún import de `integrations/treasury` |
| 8 | Depreciación individual `postDepreciationEntry` → `postEntryTx` | `equipment/features/depreciation/actions.server.ts:795` → `:692` (`:712`) | `lockedUntilDate`, **fuera de la tx** (`:842-849`) | sí (`resolveFiscalPeriodTx`, `:45-61`) | atómica (`:705-710`) | DRAFT | `ActionResult` (`:861`) |
| 9 | Depreciación masiva `postAllPendingDepreciations` | `depreciation/actions.server.ts:871` | **filtra en silencio** los períodos `<= lockedUntilDate` (`:887-899`) | vía #8 | vía #8 | DRAFT | `ActionResult`, pero lo bloqueado ni se informa |
| 10 | Revalúo `createValueAdjustment` | `depreciation/actions.server.ts:990` (`:1111`) | `lockedUntilDate`, fuera de la tx (`:1057-1064`) | sí (`:1099`) | atómica (`:1102-1109`) | DRAFT | `ActionResult` |
| 11 | Movimiento de fondos `confirmFundMovement` → `createJournalEntryForFundMovement` | `commercial/features/treasury/features/fund-movements/list/actions.server.ts:918` → `:447` (`:495`) | **ninguna** | **no** | `lastEntryNumber+1` (`:485-517`) | DRAFT | `ActionResult` (`:621`) |
| 12 | Movimiento bancario manual `createBankMovement` → `createJournalEntryForBankMovement` | `treasury/features/bank-movements/actions.server.ts:31` → `:162` (`:201`) | **ninguna** | **no** | `lastEntryNumber+1` (`:180-246`) | DRAFT | lanza `Error`. Sin Ajustes **omite el asiento en silencio** (`:185-190`); sin cuenta contable en el banco, también (`:117`) |
| 13 | Transferencia banco → banco `createBankTransfer` | `bank-movements/actions.server.ts:1026` (`:1117`) | **ninguna** | **no** | `lastEntryNumber+1` (`:1110-1146`) | DRAFT | lanza `Error`; sin Ajustes o sin cuentas omite el asiento |
| 14 | Transferencia banco ↔ caja (misma action) | `bank-movements/actions.server.ts:1232` | **ninguna** | **no** | `lastEntryNumber+1` (`:1225-1261`) | DRAFT | ídem |
| 15 | Liquidación de IVA `generateVatSettlementEntry` | `accounting/features/vat-settlement/actions.server.ts:102` (`:210`) | **ninguna** | sí (`:149-161`) | atómica (`:140-147`) | POSTED | lanza `Error`. **Sin UI**: solo se exporta en `vat-settlement/index.ts:1` |
| 16 | Diferencia de cambio `generateExchangeDifferenceEntry` | `accounting/features/exchange-rates/actions.server.ts:254` (`:348`) | **ninguna** | **no** | atómica (`:293-300`) | POSTED | lanza `Error`. **Sin UI** |
| 17 | Ajuste por inflación `generateInflationAdjustmentEntry` | `accounting/features/inflation-adjustment/actions.server.ts:258` (`:353`) | **ninguna** | sí (`:292-304`) | atómica (`:283-290`) | POSTED | lanza `Error`. **Sin UI** |
| 18 | Recurrentes `generateRecurringEntry` / `generateAllPendingRecurringEntries` | `accounting/features/recurring-entries/actions.server.ts:177` (`:212`), `:269` | **ninguna** | **no** | `lastEntryNumber+1` (`:210`, `:235-238`) | DRAFT | lanza `Error`; la masiva junta los mensajes en `errors[]` (`:291-298`) |
| 19 | Saldos de apertura `saveOpeningBalanceEntry` | `accounting/features/opening-balances/actions.server.ts:312` (`:456`) | **ninguna** | **no** | `lastEntryNumber+1` (`:454`, `:472-475`) | POSTED | lanza `Error` |
| 20 | Cierre: refundición y apertura `closeFiscalYear` | `accounting/features/fiscal-year-close/actions.server.ts:243` (`:335`, `:443`) | propia (meses `MONTHLY` cerrados, `:279-296`) | sí | atómica (`:326-333`, `:432-439`) | POSTED | lanza `Error` |

Resumen: **20 caminos, 12 helpers de creación distintos**. Ocho ya numeran atómico; seis
(#11 a #14, #18, #19) no. Ninguno evalúa las tres condiciones de cierre a la vez. Los únicos
dos `resolveFiscalPeriod` "compartidos" son copias (`entries/validators/index.ts:307` y
`depreciation/actions.server.ts:45`), más cinco copias inline.

Hay además un `validateJournalEntryDate` **duplicado** en `accounting/shared/validators/index.ts:128`,
que solo compara contra el rango de Ajustes; lo importa `accounts/actions.server.ts:23`
(verificar en diseño si esa función en particular se usa, y eliminarla o delegarla).

#### 1.2.2 Numeración y triggers

- `AccountingSettings.lastEntryNumber` (`prisma/schema.prisma:523`) y `@@unique([companyId, number])`
  en `JournalEntry` (`schema.prisma:433`).
- El patrón atómico ya existe: `UPDATE accounting_settings SET last_entry_number = last_entry_number + 1 … RETURNING`
  (p. ej. `entries/actions.server.ts:38-43`). Con `lastEntryNumber+1` dentro de la tx, dos
  confirmaciones concurrentes leen el mismo valor y la segunda muere con `P2002` (mensaje
  ilegible), o choca con un número ya tomado por un creador atómico.
- Efecto secundario útil: el `UPDATE … RETURNING` toma el **lock de fila** de
  `accounting_settings`. Si `setLockedPeriod`/cierre de mes también hacen `UPDATE` de esa fila
  en su tx, y `assertPeriodOpen` lee el estado **después** de tomar ese lock (o con
  `SELECT … FOR UPDATE`), el cierre de un mes y la creación de un asiento quedan serializados por
  empresa. Sin eso, un asiento puede colarse en un mes que se está cerrando (hoy las validaciones
  de #1, #8 y #10 corren **fuera** de la tx).
- **Triggers** (`prisma/migrations/20260624100000_accounting_constraints/migration.sql`):
  - `trg_journal_entry_immutable` (`:50-74`): sobre un POSTED solo se permite `UPDATE` a
    `REVERSED`; cualquier otro `UPDATE` o `DELETE` lanza excepción. REVERSED no admite nada.
    DRAFT admite todo.
  - `trg_journal_entry_line_immutable` (`:80-102`): líneas de POSTED/REVERSED inmutables.
  - CHECK `chk_jel_debit_or_credit` (`:41-44`): cada línea tiene debe **o** haber > 0, nunca 0/0.
  - **Impacto en el diseño:** (1) el backfill de `fiscal_year_id`/`period_id` sobre asientos POSTED
    o REVERSED **falla** por el trigger: hay que deshabilitarlo dentro de la migración solo para
    ese `UPDATE` (`ALTER TABLE journal_entries DISABLE TRIGGER trg_journal_entry_immutable` …
    `ENABLE`), o dejarlos sin backfill (D4). (2) La reversión solo puede hacer `UPDATE` del original
    a REVERSED: el `reversalEntryId` va en ese mismo `UPDATE`, como hoy. (3) No hay restricción de
    balance por asiento en la DB: un asiento desbalanceado entra igual (B21).
  - En la DB local los dos triggers están habilitados (`pg_trigger.tgenabled = 'O'`).

#### 1.2.3 Modelo de ejercicios y períodos

- `FiscalYear` (`schema.prisma:706-733`): `number` único por empresa, `startDate`/`endDate`
  `timestamp(3)`, `isClosed`, `closingEntryId`/`openingEntryId`.
- `AccountingPeriod` (`schema.prisma:736-754`): `type` = `MONTHLY | OPENING | CLOSING | ADJUSTMENT`
  (`:247-253`); único por `[fiscalYearId, year, month, type]`. `ADJUSTMENT` no lo crea nadie.
- **Dos convenciones distintas para OPENING/CLOSING:** la migración 20260625 usa `month = 0` para
  OPENING y `month = 13` para CLOSING (`migration.sql:158-167`, `:189-198`); `closeFiscalYear` usa
  el mes real de inicio y de fin (`fiscal-year-close/actions.server.ts:398-403`, `:416-421`). Nadie
  busca esos períodos por mes (solo por `type`), así que no rompe nada, pero el backfill tiene que
  elegir una (recomendado: la del código).
- **Migración 20260625** (`migration.sql:146-220`): creó un FY `number = 1` con el rango de
  `accounting_settings` **solo** para las empresas que tenían Ajustes; OPENING + 12 MONTHLY
  (siempre 12, aunque el ejercicio fuera irregular) + CLOSING; `is_closed` del mes =
  `inicio_del_mes <= locked_until_date`; y luego un `UPDATE journal_entries` de backfill
  (`:205-220`) que **con el trigger de 20260624 activo** habría fallado ante cualquier POSTED. Se
  infiere que en ese momento no había asientos POSTED en la base donde corrió.
- **Ajustes y FY se desincronizan:**
  - `saveAccountingSettings` (`settings/actions.server.ts:34-108`) hace `upsert` de
    `fiscalYearStart/End` **sin crear ni actualizar `FiscalYear`**: es la causa de B2 y lo seguiría
    siendo después del backfill (cada empresa nueva vuelve a nacer sin FY).
  - Además permite cambiar las fechas del ejercicio en cualquier momento. `closeFiscalYear` busca el
    FY por **solapamiento** con el rango de Ajustes (`:261-268`).
  - `_AccountingSettingsForm.tsx:73-79` guarda la fecha como `new Date('YYYY-MM-DDT00:00:00')`
    del navegador (UTC-3) → `2026-01-01 03:00:00` UTC en la DB.
- **`closeFiscalYear`** (detalle nuevo respecto de 758):
  - El preview se calcula **fuera de la transacción** (`:298`).
  - Crea el FY siguiente con `create` (`:380`): si ese FY ya existiera (p. ej. porque se creó por
    adelantado para operar en enero), **choca con `@@unique([companyId, number])`**.
  - El bucle de meses del FY nuevo usa `moment()` local (`:405-414`). Con el servidor en UTC-3 y
    fechas guardadas a medianoche UTC, `newStartDate` cae el 31/12 local y se crean **13 meses**,
    el primero de ellos perteneciente al ejercicio cerrado. En UTC crea 12. Ver D8.
- **Nadie lee `fiscalYearId`/`periodId`:** ningún reporte filtra por esas columnas (Diario, Mayor,
  Sumas y Saldos, Balance, Estado de Resultados filtran por `date`;
  `reports/actions.server.ts:186`, `:233`, `:376`, `:508`; `shared/utils/balances.ts:63-93`). B7 es
  higiene de datos y prerrequisito de 758, no un error visible hoy.

#### 1.2.4 Zona horaria (nuevo)

- `journal_entries.date` es `timestamp(3)` sin zona. Hay tres codificaciones mezcladas en la DB
  local: medianoche UTC (22 asientos), 03:00 UTC = medianoche AR (5) y fecha y hora reales de
  `new Date()` (5). El proyecto ya decidió leer estas fechas en UTC (`formatDateUtc`,
  `src/shared/utils/formatters.ts:45-56`, TSK-725).
- Todos los cálculos de mes de cierre usan `moment(date)` **en hora del servidor**:
  `validatePeriodLock` (`entries/validators/index.ts:131-139`), los resolvers de período de #4, #6,
  #8 y `closeFiscalYear`, y la grilla del bloqueo.
- **Producción corre en UTC**: la imagen es `node:22-alpine` sin `TZ` (`Dockerfile:47-84`). El
  desarrollo local corre en UTC-3. **Mismo código, distinto mes** para cualquier fecha entre 00:00
  y 03:00 UTC del día 1. En la DB local hay 4 asientos así (las depreciaciones #16 a #19, fechadas
  el día 1 a las 00:00 UTC): en dev se imputan al mes anterior y en prod al correcto.
- **Hipótesis B22, a verificar en prod:** `_PeriodLockingForm` manda el fin de mes **local** del
  navegador (`:64`, `:107`), que en UTC es el día 1 del mes siguiente a las 02:59:59.999. En el
  servidor UTC, `setLockedPeriod` valida "último día del mes" con `moment()` (`:162-174`) y
  **rechazaría todos los bloqueos**; el form muestra un error genérico (`:128-130`). Si en prod
  hubiera `locked_until_date` guardados por la UI, la hipótesis cae. Verificar con la consulta 1
  del script (§1.6.3) y `sudo docker exec $APP sh -c 'date; printenv TZ'`.

#### 1.2.5 Vínculo asiento ↔ documento (para B10)

Modelos con FK `journalEntryId` (`schema.prisma`):

| Modelo | Línea | Vínculo | Cómo anular el documento hoy |
|---|---|---|---|
| `SalesInvoice` | `:2878` | FK + relación inversa `salesInvoices` | `cancelInvoice` (no revierte, B12) |
| `PurchaseInvoice` | `:3002` | FK + `purchaseInvoices` | `cancelPurchaseInvoice` (no revierte) |
| `Receipt` | `:3308` | FK + `receipts` | no existe |
| `PaymentOrder` | `:3394` | FK + `paymentOrders` | no existe |
| `Expense` | `:3677` | FK + `expenses` | `cancelExpense` (no revierte) |
| `DepreciationScheduleEntry` | `:4147` | FK + `depreciationEntries` | no existe |
| `AssetValueAdjustment` | `:4175` | FK + `valueAdjustments` | no existe |
| `FundMovement` | `:4387` | **columna sin relación** (no hay FK ni relación inversa) | no existe |
| `FiscalYear.closingEntryId` / `openingEntryId` | `:713-721` | FK única | no existe |

Sin vínculo persistido: movimiento bancario manual y transferencias (#12 a #14), baja de equipo
(#6), IVA, diferencia de cambio, inflación, recurrentes y apertura manual. Se distinguen solo por
`createdBy` (`'system'` en #4, #6, #7, #8, #10 a #15, #17; el `userId` en #1, #16, #18, #19, #20) y por
la descripción.

Ya existe una lista parcial de "asientos con documento" en
`reports/actions.server.ts:623-669` (`getEntriesWithoutDocuments`): mira solo ventas, compras,
recibos y OP; le faltan gastos, fondos, depreciación, revalúo y cierre. Conviene un helper único
`getEntryDocumentLink(tx, entryId)` que use ambos.

#### 1.2.6 UI y permisos

- **Bloqueo de períodos:** `AccountingSettings.tsx:62-74` renderiza `_PeriodLockingForm` con el
  rango de **Ajustes** (no del FY). Permiso: `accounting.settings` `update`
  (`_PeriodLockingForm.tsx:53`, `setLockedPeriod` `:149`). El `catch` descarta el mensaje del
  servidor (`:128-130`).
  - Tras un cierre anual, Ajustes apunta al ejercicio nuevo y `lockedUntilDate` = fin del cerrado,
    anterior a la grilla: el primer mes es "bloqueable", y desbloquearlo después manda `null`
    (`:91-96`) → B5 confirmado.
- **Cierre anual:** `FiscalYearClose.tsx` (Server Component con `PermissionGuard`
  `accounting.fiscal-year-close` `view`) → `_FiscalYearStatus.tsx` → `_ClosePreviewDialog.tsx`
  (`approve`). El preview se carga con **`useEffect` + `useState`** (`:46-58`), contra la regla de
  React Query. Errores por `throw` → redactados en prod.
- **Asientos:** `_EntriesTable.tsx:264-284` muestra Registrar (DRAFT) y Anular (POSTED) con
  `accounting.entries` `approve`. `_ReverseEntryDialog.tsx` no advierte nada sobre documentos.
- **Errores legibles:** para cumplir el criterio 3 en producción, toda action que pueda disparar
  "período cerrado" tiene que devolver `ActionResult` (memoria `errores-negocio-server-actions`).
  Ya lo hacen: comerciales (#4), equipos (#6, `softDeleteVehicle` devuelve `ActionResult`, `list/actions.server.ts:347-350`), depreciación
  (#8 a #10) y fondos (#11). **No lo hacen:** `createJournalEntry`, `postJournalEntry`,
  `reverseJournalEntry`, `createBankMovement`, `createBankTransfer`, `generateRecurringEntry`(s),
  `saveOpeningBalanceEntry`, `closeFiscalYear` y `setLockedPeriod`. Callers de UI a adaptar:
  `_CreateEntryModal`, `_PostEntryDialog`, `_ReverseEntryDialog`, `_ClosePreviewDialog`,
  `_PeriodLockingForm`, `_RecurringEntriesTable`, `_GeneratePendingDialog`,
  `_AccountBalancesForm`, `_CreateBankMovementDialog` y `_BankTransferDialog`.
  IVA, diferencia de cambio e inflación no tienen UI.

#### 1.2.7 Mediciones en la DB local (`contable-pms-db`, 2026-10-06)

| Medición | Resultado |
|---|---|
| Empresas | 2: "Empresa de Prueba 01 SA" con Ajustes, "Empresa Demo S.A." sin Ajustes |
| Empresas con `FiscalYear` | **0** (B2 aplica a todas) |
| Ejercicio de Ajustes | 2026-01-01 → 2026-12-31 (guardado 03:00 UTC); `locked_until_date` nulo |
| Asientos | 32: 27 DRAFT (jun a oct 2026) y 5 POSTED (sep 2026) |
| Sin `fiscal_year_id`/`period_id` | 32 de 32 |
| Fuera del rango de Ajustes | 0 |
| Numeración | contador 49; existe el asiento **999999** ("dbg", DRAFT de debug): un `GREATEST(contador, max(number))` llevaría el contador a 999999 (limpiar antes, solo es dato local) |
| Asientos con documento vinculado | compras 3, recibos 1, OP 3, gastos 3, fondos 7, depreciación 4; ninguno compartido |
| Mes distinto UTC vs. UTC-3 | 4 (las depreciaciones del día 1) |
| Documentos vigentes con asiento REVERSED | 0 |

La base local no sirve para medir el impacto de B3/B5 (no hay FY ni bloqueos): eso lo mide el
script de §1.6.3 en producción.

### 1.3 Archivos involucrados

**Núcleo nuevo** (en `src/modules/accounting/shared/utils/`, ver D9 sobre ubicación):

- `period-lock.ts`: `assertPeriodOpen(tx, companyId, date, { periodType })` y
  `ensureFiscalYearTx` (D1).
- `journal-entry-tx.ts`: `nextEntryNumberTx`, `createJournalEntryTx` (número, período,
  auxiliares, moneda, `createdBy`, estado) y `reverseJournalEntryTx`.
- `entry-document-link.ts`: `getEntryDocumentLink(tx, entryId)` (lo reutiliza
  `getEntriesWithoutDocuments`).

**Creadores que pasan a usarlos** (tabla 1.2.1):

- `accounting/features/entries/actions.server.ts` y `entries/validators/index.ts`
  (`validatePeriodLock`, `validateJournalEntryDate` y `resolveFiscalPeriod` delegan o se borran).
- `accounting/shared/validators/index.ts:128` (duplicado).
- `accounting/features/integrations/{commercial,equipment,treasury}/index.ts`.
- `accounting/features/{vat-settlement,exchange-rates,inflation-adjustment,recurring-entries,opening-balances,fiscal-year-close}/actions.server.ts`.
- `equipment/features/depreciation/actions.server.ts`.
- `commercial/features/treasury/features/fund-movements/list/actions.server.ts`.
- `commercial/features/treasury/features/bank-movements/actions.server.ts`.

**Cierre y bloqueo:**

- `accounting/features/settings/actions.server.ts` (`saveAccountingSettings`, `getLockedPeriod`,
  `setLockedPeriod`) y `components/_PeriodLockingForm.tsx`, `AccountingSettings.tsx`.
- `accounting/features/fiscal-year-close/actions.server.ts` y
  `components/_ClosePreviewDialog.tsx`, `_FiscalYearStatus.tsx`.
- Si entra D7: `accounting/shared/utils/balances.ts` y `accounting/features/reports/actions.server.ts`
  (Mayor, Estado de Resultados, Presupuesto vs. real, movimientos por centro de costo).

**UI de errores** (pasar a `ActionResult`): los diez componentes de 1.2.6.

**Esquema y datos:**

- Migración nueva (SQL a mano, estilo 20260625): backfill de FY y períodos, sincronización de
  `is_closed`, backfill de `fiscal_year_id`/`period_id` (D4), ajuste del contador.
- Sin cambios de modelo obligatorios. Opcional: relación declarada de
  `FundMovement.journalEntryId` (758 la pone en fase 1).

**Documentación y tests:**

- `docs/modules/accounting.md` §Cierre de Ejercicio (`:112-130`) y §Bloqueo de Períodos
  (`:221-243`, la tabla de comportamiento cambia), `docs/architecture/data-model.md`.
- Guía in-app `src/modules/help/features/guide/components/_AccountingGuide.tsx` (cierre `:530-560`,
  bloqueo `:695-740`).
- Guía de presentación al cliente (PDF, memoria `guia-presentacion-cliente-por-ticket`).
- Tests nuevos `*.integration.test.ts` (no hay ninguno de asientos manuales, cierre, bloqueo,
  bancos, recurrentes, IVA ni apertura). Los existentes que fijan `lockedUntilDate` y esperan el
  texto `'período está cerrado'`: `receipt-journal-entry.integration.test.ts:522`,
  `payment-order-journal-entry…:620`, `expense-journal-entry…:295`,
  `sales-invoice-line-accounts…:396`, `purchase-invoice-line-accounts…:377` y
  `asset-disposal.integration.test.ts`.

### 1.4 Dependencias

- **TSK-758:** este ticket es su prerrequisito; 758 reutilizará `assertPeriodOpen`,
  `createJournalEntryTx` y `reverseJournalEntryTx`. No hay que esperar respuestas de la clienta:
  1.8-1 de 758 quedó adoptada (ver 1.7).
- **Patrón `ActionResult`/`BusinessError`** (`src/shared/lib/action-result.ts`, TSK-721/728).
- **TSK-725** (fechas de día leídas en UTC): base de D8.
- **TSK-719** (movimientos por centro de costo): la reversión debe copiar `costCenterId`.
- **Triggers de inmutabilidad** (1.2.2): condicionan el backfill y la reversión.
- **Producción** (memoria `produccion-dokploy-scripts-db`): la migración la aplica el entrypoint
  al arrancar; el diagnóstico corre por `psql` antes del deploy.

### 1.5 Restricciones y reglas

- **Un solo criterio de cierre**, evaluado siempre en OR: FY cerrado, `AccountingPeriod` del mes
  cerrado o `fecha <= lockedUntilDate` (758 §1.7.1-1). Mientras `lockedUntilDate` sea derivado, el
  OR no cambia resultados, pero protege ante datos desincronizados.
- **Mes calculado en UTC** (D8), con comparación por día calendario, nunca por timestamp.
- **Validación dentro de la transacción**, después de tomar el lock de `accounting_settings`.
- **Numeración** siempre por `nextEntryNumberTx` (`UPDATE … RETURNING`).
- **Todo creador** carga `fiscalYearId` y `periodId` (criterio 3); si no hay FY para la fecha, se
  resuelve según D1, nunca se deja nulo en silencio.
- **Nada calla:** el período cerrado es `BusinessError`, nunca `return null` ni `logger.warn`.
- **Cierre en orden y reapertura solo del último** (decisión adoptada de 758 1.8-1).
  `lockedUntilDate` = fin del último mes cerrado en forma contigua, sincronizado en la misma tx.
- **Lo POSTED no se toca:** la reversión crea un asiento nuevo y pasa el original a REVERSED en un
  solo `UPDATE` (trigger).
- **Mensajes:** conservar la frase "el período está cerrado" para no romper los tests existentes y
  nombrar el mes (`MM/YYYY`) y la causa (mes cerrado / ejercicio N° X cerrado).
- Reglas del repo: `checkPermission` en cada action, `PermissionGuard`/`usePermissions`,
  `AlertDialog`, `moment`, `logger`, `Decimal`→`Number()`, componentes de menos de 200 líneas,
  `useQuery` (corregir el `useEffect` de `_ClosePreviewDialog` si se toca), `docs/`, guía in-app,
  guía de presentación al cliente y tests Vitest de integración.

### 1.6 Riesgos identificados

#### 1.6.1 Bugs: los de 758 (B1 a B10) más los nuevos

B1 a B10: ver 758 §1.6, **verificados**, con estas precisiones:

- **B6** también incluye la depreciación masiva (#9), que **saltea en silencio** los períodos
  bloqueados en vez de informarlos.
- **B8** afecta a seis caminos (#11 a #14, #18, #19), no a cuatro.
- **B9** también aplica al CMV (#5): traga cualquier error y devuelve `null`. Los dos son código
  muerto; recomendación: borrarlos o migrarlos al helper y que lancen.
- **B10:** solo FundMovement tiene la columna sin relación; la detección tiene que consultarla
  igual (1.2.5).

Nuevos:

| # | Bug | Evidencia | Impacto |
|---|---|---|---|
| B18 | La apertura que genera `closeFiscalYear` **duplica los saldos patrimoniales**: el sistema calcula saldos acumulando todo lo POSTED hasta la fecha, sin asiento de cierre patrimonial, y la apertura vuelve a sumar los saldos del ejercicio cerrado | `fiscal-year-close/actions.server.ts:192-222`, `:443-464`; `shared/utils/balances.ts:63-93`; Mayor `reports/actions.server.ts:233` | Balance, Sumas y Saldos y Mayor del ejercicio nuevo con activos, pasivos y patrimonio **al doble** |
| B19 | El Estado de Resultados del ejercicio cerrado da cero: incluye la refundición, fechada el último día | `reports/actions.server.ts:532-541`; refundición `:335-356` | Informe de resultados inservible después del cierre (ídem Presupuesto vs. real y movimientos por centro de costo) |
| B20 | Sin saldos de resultado POSTED, la refundición tiene una sola línea 0/0 y **revienta contra el CHECK** `chk_jel_debit_or_credit`; el control "no hay cuentas con saldo" nunca dispara porque siempre se agrega la línea de la cuenta Resultado | `fiscal-year-close/actions.server.ts:183-189`, `:300-302` | Probable en prod: los asientos automáticos nacen DRAFT y casi nadie los registra (758 §1.2.3). Error de DB ilegible |
| B21 | El asiento de apertura sale **desbalanceado** por el resultado del ejercicio: el preview patrimonial se calcula antes de la refundición, así que la cuenta Resultado no incluye el resultado (el comentario de `:224` es falso). La DB no controla el balance por asiento | `fiscal-year-close/actions.server.ts:192-225`, `:298` | Asiento POSTED desbalanceado e inmutable |
| B22 | Cálculo de mes y de "fin de mes" en hora local del servidor: dev (UTC-3) y prod (UTC) imputan distinto; la grilla manda el fin de mes local. Hipótesis: en prod `setLockedPeriod` rechaza todo bloqueo | 1.2.4 | Bloqueos inoperantes o corridos un día; períodos del cierre corridos un mes (13 meses) |
| B23 | `saveAccountingSettings` no crea `FiscalYear` y deja editar las fechas del ejercicio con FY existentes | `settings/actions.server.ts:91-98` | B2 reaparece en cada empresa nueva; Ajustes y FY divergen |
| B24 | `closeFiscalYear` crea el FY siguiente con `create`: si ya existe (creado por adelantado), choca con el `@@unique` | `fiscal-year-close/actions.server.ts:380` | Cierre anual imposible apenas se habilite operar en el ejercicio siguiente (D1) |

B18 a B21 hoy son inalcanzables porque el cierre nunca corre (B1, B2). **Al cumplir el
criterio 1 se vuelven alcanzables**, y el primer cierre real de la clienta sería el del
ejercicio 2026, a partir de enero de 2027. Ver D7.

#### 1.6.2 Cambio de comportamiento visible (riesgo principal)

Escenarios concretos, después del arreglo:

1. **Empresa con FY y `lockedUntilDate`, meses `is_closed=false`** (bloqueó después de la migración
   20260625): hoy los asientos manuales y el "Registrar" pasan (B3). Después, **se rechazan** en los
   meses bloqueados. Los DRAFT automáticos de esos meses (los de facturas, recibos, OP, gastos,
   fondos, bancos, depreciación) **quedan sin poder registrarse** hasta reabrir el mes, y el cierre
   anual los va a listar como pendientes (D2). Medir con la consulta 4.
2. **Empresa con FY, meses `is_closed=true` y `lockedUntilDate` menor o nulo** (desbloqueó por la UI
   después de la migración): hoy facturas, recibos, OP, gastos y equipos **pasan** (solo miran
   `lockedUntilDate`) y lo manual se rechaza. Después, con el OR y el backfill por unión (D3),
   **se rechaza todo**. Medir con la consulta 6.
3. **Movimientos de fondos, bancarios, transferencias, recurrentes y apertura**: hoy no validan
   nada. Después se rechazan en meses cerrados. El caso típico: cargar el extracto bancario de un
   mes ya bloqueado. Ahora pide reabrir.
4. **Borradores de comprobantes con fecha en un mes ya bloqueado** (factura cargada en DRAFT en
   marzo, marzo bloqueado después): hoy, en empresas con FY, la confirmación ya falla para
   comerciales; para fondos pasa. Después, falla para todos. Medir con la consulta 8.
5. **Registrar un DRAFT de un ejercicio cerrado**: hoy pasa si el mes no tiene `is_closed` (B4).
   Después, se rechaza siempre.
6. **Desbloquear el primer mes del ejercicio nuevo**: hoy reabre todo el ejercicio cerrado (B5).
   Después, el piso es el fin del ejercicio cerrado y la UI explica por qué no se puede bajar más.
7. **Anular desde Asientos** el asiento de una factura, recibo, OP, gasto, fondos, depreciación,
   revalúo o cierre: hoy se puede. Después, se rechaza con "anulalo desde el comprobante X". Hay
   que comunicar que, hasta 758, varios de esos documentos **no tienen** cómo anularse.
8. **Reversión con fecha de hoy en un mes cerrado**: hoy pasa. Después, se rechaza. Raro (hoy
   casi nunca está cerrado), pero posible si se cierra el mes en curso.
9. **Fechas fuera de todo ejercicio**: hoy las integraciones las aceptan sin FY y lo manual las
   rechaza. Después depende de D1: con la recomendación, en enero se puede operar en el ejercicio
   nuevo antes de cerrar el anterior, y lo anterior al primer ejercicio se rechaza.
10. **Depreciación masiva**: hoy omite en silencio los períodos bloqueados. Después, conviene que
    los informe en `errors[]`.
11. **Zona horaria (D8)**: asientos fechados el día 1 entre 00:00 y 03:00 UTC cambian de mes
    respecto de lo que veía dev. En prod (UTC) no cambia nada si se adopta UTC.
12. **IVA, diferencia de cambio, inflación:** sin UI, sin impacto visible hoy.

#### 1.6.3 Script de diagnóstico para producción (solo lectura)

Probado contra la DB local (resultados en 1.2.7). En prod se corre con el patrón de
`prisma/scripts/verificacion-post-deploy.sh`. En diseño conviene guardarlo como
`prisma/scripts/diagnostico-tsk-760-cierre.sh`.

```bash
sudo docker exec -i $(sudo docker ps -q --filter name=contablemas-contablemas) \
  sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -P pager=off' <<'SQL'
\echo '== 1) Empresas: configuración contable, ejercicios y bloqueo'
SELECT c.name AS empresa,
       s.fiscal_year_start AS ej_inicio_raw, s.fiscal_year_end AS ej_fin_raw,
       s.locked_until_date AS bloqueado_hasta_raw,   -- la hora delata B22
       s.last_entry_number AS contador,
       (SELECT count(*) FROM fiscal_years f WHERE f.company_id = c.id) AS ejercicios,
       (SELECT count(*) FROM fiscal_years f WHERE f.company_id = c.id AND f.is_closed) AS ej_cerrados,
       CASE WHEN s.company_id IS NULL THEN 'SIN CONFIG'
            WHEN s.fiscal_year_end < now() THEN 'EJERCICIO VENCIDO SIN CERRAR'
            ELSE 'ok' END AS estado,
       (SELECT count(*) FROM journal_entries j WHERE j.company_id = c.id) AS asientos
FROM companies c LEFT JOIN accounting_settings s ON s.company_id = c.id
ORDER BY asientos DESC;

\echo '== 2) Asientos sin ejercicio/período (B7), por empresa y estado'
SELECT c.name AS empresa, j.status::text, count(*) AS total,
       count(*) FILTER (WHERE j.fiscal_year_id IS NULL) AS sin_ejercicio,
       count(*) FILTER (WHERE j.period_id IS NULL) AS sin_periodo
FROM journal_entries j JOIN companies c ON c.id = j.company_id
GROUP BY 1, 2 ORDER BY 1, 2;

\echo '== 3) Asientos fuera del ejercicio de Ajustes, por mes'
SELECT c.name AS empresa, to_char(j.date, 'YYYY-MM') AS mes, j.status::text,
       CASE WHEN j.date::date < s.fiscal_year_start::date THEN 'ANTES' ELSE 'DESPUES' END AS lado,
       count(*)
FROM journal_entries j JOIN accounting_settings s ON s.company_id = j.company_id
JOIN companies c ON c.id = j.company_id
WHERE j.date::date < s.fiscal_year_start::date OR j.date::date > s.fiscal_year_end::date
GROUP BY 1, 2, 3, 4 ORDER BY 1, 2;

\echo '== 4) Borradores en meses que quedarían cerrados'
SELECT c.name AS empresa, to_char(j.date, 'YYYY-MM') AS mes, count(*) AS borradores
FROM journal_entries j JOIN accounting_settings s ON s.company_id = j.company_id
JOIN companies c ON c.id = j.company_id
LEFT JOIN accounting_periods p ON p.id = j.period_id
WHERE j.status = 'DRAFT'
  AND ((s.locked_until_date IS NOT NULL AND j.date::date <= s.locked_until_date::date) OR p.is_closed)
GROUP BY 1, 2 ORDER BY 1, 2;

\echo '== 5) Borradores dentro de ejercicios cerrados (B4) y asientos creados después del cierre'
SELECT c.name AS empresa, f.number AS ejercicio, f.closed_at,
       count(*) FILTER (WHERE j.status = 'DRAFT') AS borradores,
       count(*) FILTER (WHERE j.created_at > f.closed_at
                          AND j.id IS DISTINCT FROM f.closing_entry_id) AS creados_post_cierre
FROM fiscal_years f JOIN companies c ON c.id = f.company_id
JOIN journal_entries j ON j.company_id = f.company_id
  AND j.date::date BETWEEN f.start_date::date AND f.end_date::date
WHERE f.is_closed
GROUP BY 1, 2, 3 ORDER BY 1, 2;

\echo '== 6) Períodos MONTHLY cuyo is_closed no coincide con bloqueado_hasta (B3)'
SELECT c.name AS empresa, p.year, p.month, p.is_closed,
       s.locked_until_date::date AS bloqueado_hasta,
       CASE WHEN p.is_closed THEN 'CERRADO pero después del bloqueo: hoy las integraciones pasan'
            ELSE 'ABIERTO dentro del bloqueo: hoy manuales y Registrar pasan' END AS efecto
FROM accounting_periods p JOIN fiscal_years f ON f.id = p.fiscal_year_id
JOIN accounting_settings s ON s.company_id = f.company_id
JOIN companies c ON c.id = f.company_id
WHERE p.type = 'MONTHLY'
  AND p.is_closed <> (s.locked_until_date IS NOT NULL
       AND (make_date(p.year, p.month, 1) + interval '1 month - 1 day')::date
           <= s.locked_until_date::date)
ORDER BY 1, 2, 3;

\echo '== 7) Numeración: asientos por encima del contador (B8)'
SELECT c.name AS empresa, s.last_entry_number AS contador, max(j.number) AS max_numero,
       count(*) FILTER (WHERE j.number > s.last_entry_number) AS sobre_contador
FROM accounting_settings s JOIN companies c ON c.id = s.company_id
LEFT JOIN journal_entries j ON j.company_id = s.company_id
GROUP BY 1, 2 HAVING max(j.number) > s.last_entry_number;

\echo '== 8) Comprobantes en borrador con fecha en un mes bloqueado (fallarán al confirmar)'
SELECT tipo, c.name AS empresa, count(*) FROM (
  SELECT 'VENTA' tipo, d.company_id, d.issue_date AS fecha FROM sales_invoices d WHERE d.status = 'DRAFT'
  UNION ALL SELECT 'COMPRA', d.company_id, d.issue_date FROM purchase_invoices d WHERE d.status = 'DRAFT'
  UNION ALL SELECT 'RECIBO', d.company_id, d.date FROM receipts d WHERE d.status = 'DRAFT'
  UNION ALL SELECT 'OP', d.company_id, d.date FROM payment_orders d WHERE d.status = 'DRAFT'
  UNION ALL SELECT 'GASTO', d.company_id, d.date FROM expenses d WHERE d.status = 'DRAFT'
  UNION ALL SELECT 'FONDOS', d.company_id, d.date FROM fund_movements d WHERE d.status = 'DRAFT'
) x JOIN accounting_settings s ON s.company_id = x.company_id
JOIN companies c ON c.id = x.company_id
WHERE s.locked_until_date IS NOT NULL AND x.fecha::date <= s.locked_until_date::date
GROUP BY 1, 2 ORDER BY 2, 1;

\echo '== 9) Asientos desbalanceados (B21)'
SELECT c.name AS empresa, j.number, j.date::date, j.status::text,
       left(j.description, 60) AS descripcion, sum(l.debit) AS debe, sum(l.credit) AS haber
FROM journal_entries j JOIN journal_entry_lines l ON l.entry_id = j.id
JOIN companies c ON c.id = j.company_id
GROUP BY 1, 2, 3, 4, 5 HAVING abs(sum(l.debit) - sum(l.credit)) >= 0.01 ORDER BY 1, 2;

\echo '== 10) Asientos cuyo mes cambia según la zona horaria (B22)'
SELECT c.name AS empresa, count(*)
FROM journal_entries j JOIN companies c ON c.id = j.company_id
WHERE date_trunc('month', j.date) <> date_trunc('month', j.date - interval '3 hours')
GROUP BY 1;

\echo '== 11) Documentos vigentes con asiento REVERSED (B10)'
SELECT tipo, count(*) FROM (
  SELECT 'VENTA' tipo, d.journal_entry_id FROM sales_invoices d WHERE d.status <> 'CANCELLED'
  UNION ALL SELECT 'COMPRA', d.journal_entry_id FROM purchase_invoices d WHERE d.status <> 'CANCELLED'
  UNION ALL SELECT 'RECIBO', d.journal_entry_id FROM receipts d WHERE d.status = 'CONFIRMED'
  UNION ALL SELECT 'OP', d.journal_entry_id FROM payment_orders d WHERE d.status = 'CONFIRMED'
  UNION ALL SELECT 'GASTO', d.journal_entry_id FROM expenses d WHERE d.status <> 'CANCELLED'
  UNION ALL SELECT 'FONDOS', d.journal_entry_id FROM fund_movements d WHERE d.status = 'CONFIRMED'
  UNION ALL SELECT 'DEPRECIACION', d.journal_entry_id FROM depreciation_schedule_entries d
  UNION ALL SELECT 'REVALUO', d.journal_entry_id FROM asset_value_adjustments d
) x JOIN journal_entries j ON j.id = x.journal_entry_id
WHERE j.status = 'REVERSED' GROUP BY 1;
SQL
# Zona horaria del servidor de la app (B22):
sudo docker exec $(sudo docker ps -q --filter name=contablemas-frontend) sh -c 'date; printenv TZ'
```

Cómo leerlo antes de deployar:

- **1:** cuántas empresas reciben FY nuevo; las "EJERCICIO VENCIDO SIN CERRAR" necesitan más de un
  FY en el backfill (D1). Un `bloqueado_hasta_raw` con hora `02:59:59.999` indica que se guardó
  desde la UI con servidor en hora local; si no hay ninguno y el servidor está en UTC, B22 se
  confirma.
- **4, 6 y 8:** tamaño del cambio de comportamiento de 1.6.2 (escenarios 1, 2 y 4). Si son
  grandes, avisar a la clienta antes del deploy.
- **5 y 9:** si devuelven filas, ya hubo un cierre anual en prod y hay datos que corregir a mano.
- **7:** empresas a las que el backfill tiene que subir el contador.

#### 1.6.4 Riesgos de implementación

- **R1, superficie:** 20 caminos y 10 componentes de UI. Mitigación: un solo helper y un test de
  integración por creador. Los creadores sin UI (IVA, diferencia de cambio, inflación) se migran
  al helper igual (es barato) y se cubren con un test mínimo.
- **R2, migración:** el backfill toca asientos POSTED (trigger). Tiene que ser idempotente,
  correr en una sola transacción y reportar lo que no pudo asignar.
- **R3, DRAFT varados** en meses cerrados (1.6.2-1). Mitigación: D2.
- **R4, concurrencia** cierre de mes vs. creación de asiento (1.2.2). Mitigación: validar dentro de
  la tx con lock de `accounting_settings`.
- **R5, mensajes redactados:** ver 1.2.6. Verificar con `npm run build && npm run start -p 3011`.
- **R6, alcance que crece por B18 a B24.** Mitigación: D7 propone el mínimo indispensable.
- **R7, tests existentes** que fijan `lockedUntilDate` directo por Prisma: siguen funcionando por el
  OR (condición c) y porque esas empresas de test no tienen FY. Si D1 crea FY de forma perezosa,
  los tests de documentos empiezan a crear FY: revisar su limpieza (`afterAll`).

### 1.7 Decisiones (adoptadas y abiertas)

#### Adoptadas

- **A1 (758 1.8-1): meses con estado propio y bloqueo secuencial.**
  - `AccountingPeriod.isClosed` es la verdad del cierre mensual.
  - Se cierra solo el primer mes abierto y se reabre solo el último cerrado.
  - `lockedUntilDate` queda **derivado**: fin del último mes cerrado, actualizado en la misma tx.
  - `_PeriodLockingForm` sigue igual para el usuario, pero ahora cierra y abre los períodos.
  - No se puede reabrir un mes de un ejercicio cerrado (piso = fin del último FY cerrado).
  - Se tomó sin esperar a la clienta porque preserva la UX actual.
- **A2:** `assertPeriodOpen` evalúa las tres condiciones en OR y devuelve
  `{ fiscalYearId, periodId }` (758 §1.7.1-1).
- **A3:** `createJournalEntryTx` + `nextEntryNumberTx` compartidos por los 20 caminos.
- **A4:** `reverseJournalEntryTx` puro (sin `checkPermission` ni `$transaction` propios):
  - copia todas las columnas de línea;
  - valida la fecha original y la de la reversión;
  - `reverseJournalEntry` es el wrapper con `ActionResult` y rechaza los asientos de documentos.
- **A5:** `closeFiscalYear` exige todos los meses cerrados y **ningún DRAFT** en el ejercicio, y
  lista los DRAFT pendientes (cantidad por mes y los primeros números) en el mensaje.
- **A6:** fuera de alcance: `replaceDocumentEntryTx`, matriz por documento y B11 a B17 (758).

#### Abiertas, con recomendación (las puede decidir el líder)

**D1. Fecha sin ejercicio**

- Problema: hoy el FY siguiente solo lo crea `closeFiscalYear`. En enero hay que operar en el
  ejercicio nuevo antes de cerrar el anterior (que se cierra en marzo o abril).
- Recomendado:
  - `ensureFiscalYearTx` crea **hacia adelante**, contiguo y con OPENING + MONTHLY + CLOSING, el
    FY que contiene la fecha, si es posterior al último (tope: un ejercicio más allá del último
    abierto).
  - `closeFiscalYear` **reutiliza** el FY siguiente si ya existe (corrige B24).
  - `saveAccountingSettings` crea el FY 1 al guardar Ajustes por primera vez (corrige B23).
  - Una fecha **anterior al primer FY** se rechaza: "anterior al inicio del primer ejercicio
    (01/01/2026); cargala como saldo de apertura".
- Alternativa: permitir esas fechas sin FY (comportamiento actual de las integraciones). Va contra
  el criterio 3.
- Medir con la consulta 3 cuántos asientos recientes caen antes del inicio.

**D2. DRAFT al cerrar un mes**

- Opciones:
  - (a) bloquear el cierre del mes con DRAFT pendientes;
  - (b) avisar en el diálogo con la cantidad y ofrecer "Registrar los N borradores y cerrar",
    en la misma tx;
  - (c) solo avisar.
- Recomendado: **(b)**. Con (c) los DRAFT quedan varados, porque el "Registrar" respeta el mes
  cerrado, y el cierre anual los rechaza. Eso obliga a reabrir hacia atrás de a un mes. (b)
  adelanta la recomendación (a) de 758 1.8-5 con poco código.
- Si se quiere el mínimo, (c) más el listado del cierre anual. Así lo exige el criterio 4.

**D3. Regla del backfill de `isClosed`**

- Recomendado:
  - período cerrado = `is_closed` actual **o** `fin_del_mes <= locked_until_date` (unión,
    conservadora);
  - después se cierran también los "huecos": todo mes anterior al último cerrado, para cumplir el
    invariante secuencial;
  - `locked_until_date` = fin del último mes cerrado;
  - FY cerrados: todos sus meses cerrados.
- Reportar antes con la consulta 6.

**D4. Backfill de `fiscal_year_id`/`period_id` de asientos existentes**

- Recomendado: **sí, todos**. Para POSTED/REVERSED, deshabilitar
  `trg_journal_entry_immutable` solo durante ese `UPDATE` dentro de la migración y rehabilitarlo
  al final de la misma transacción.
- Alternativa: solo DRAFT. Nadie lee esas columnas hoy (1.2.3), pero 758 y los reportes por
  ejercicio sí lo harán.

**D5. Fecha de la reversión desde Asientos**

- Recomendado: mantener **hoy** (comportamiento actual), validando las dos fechas.
- La discusión "misma fecha que el original" (758 1.8-4) aplica a documentos y queda en 758.

**D6. Qué cuenta como "asiento de documento" para bloquear la anulación**

- Recomendado: bloquear los vinculados por FK (las 8 tablas de 1.2.5) y los de cierre/apertura de
  FY ("anulalo desde la factura N°…").
- Para los `createdBy='system'` sin vínculo (bancos, transferencias, baja de equipo): permitir,
  pero con advertencia en el diálogo ("no revierte el saldo bancario ni el estado del equipo"),
  hasta que 758 agregue los vínculos.
- Los de IVA, diferencia de cambio, inflación, recurrentes y apertura manual se pueden anular
  (no tienen otro camino).

**D7. Defectos del cierre anual que quedan expuestos (B18 a B21)**

- Recomendado: **incluirlos en este ticket**, porque el criterio 1 los vuelve alcanzables y el
  primer cierre real es en 2027. El mínimo es:
  - B20: si no hay saldos de resultado, no generar refundición, o rechazar con
    `BusinessError` ("no hay asientos registrados con resultado: registrá los borradores").
  - B21: calcular la apertura **después** de la refundición, dentro de la tx, y verificar el
    balance antes de insertar; agregar esa verificación a `createJournalEntryTx` para todos.
  - B18: excluir de los saldos acumulados (`balances.ts`, saldo anterior del Mayor) los asientos
    que son `openingEntryId` de un FY generado por cierre (no el de saldos iniciales cargados a
    mano), y mostrarlos solo en el Diario. Alternativa contable más ortodoxa: generar también el
    asiento de cierre patrimonial y excluirlo de los reportes al cierre. Es más trabajo.
  - B19: excluir la refundición (`closingEntryId`) del Estado de Resultados, Presupuesto vs. real y
    movimientos por centro de costo.
- Alternativa: TSK-760b separado, que **tiene que estar en prod antes de habilitar el primer
  cierre**.

**D8. Zona horaria**

- Recomendado:
  - todo cálculo de mes y de rango en **UTC** (`moment.utc`), coherente con TSK-725, y comparación
    por `::date`;
  - `setLockedPeriod` (o su reemplazo `closeAccountingPeriod`/`reopenAccountingPeriod`) recibe
    `{ year, month }`, no un `Date`, y el servidor deriva el fin de mes en UTC;
  - la grilla arma los meses desde los `AccountingPeriod` del FY, no desde fechas.
- Esto también hace que los tests (UTC-3 local) y prod (UTC) den lo mismo.

**D9. Ubicación de los helpers**

- `assertPeriodOpen`, `createJournalEntryTx` y compañía se usan desde `commercial/` y
  `equipment/`.
- Hoy esos módulos ya importan de `@/modules/accounting/features/integrations/…` (excepción
  existente a la regla de comunicación entre módulos).
- Recomendado: dejarlos en `src/modules/accounting/shared/utils/` y exportarlos por
  `integrations/` como hoy. La alternativa es `src/shared/lib/accounting/`, más fiel a la regla pero
  con más movimiento.

**D10. Permisos**

- Recomendado: el cierre y la reapertura de meses siguen con `accounting.settings` `update`
  (preserva quién puede hacerlo hoy). El cierre anual sigue con `accounting.fiscal-year-close`
  `approve`. "Registrar y cerrar" (D2-b) exige además `accounting.entries` `approve`.
- Sin permisos nuevos.

**D11. Edición de fechas del ejercicio en Ajustes**

- Recomendado: con FY existentes, las fechas de Ajustes son de solo lectura y se derivan del FY
  abierto más antiguo. Solo se pueden editar si el FY 1 no tiene asientos ni meses cerrados, y
  en ese caso se regeneran sus períodos.

**D12. OPENING/CLOSING en `assertPeriodOpen`**

- Problema: la refundición cae en diciembre (cerrado por requisito) y la apertura en enero del
  ejercicio nuevo.
- Recomendado: `assertPeriodOpen(…, { periodType: 'CLOSING' | 'OPENING' })` mira solo que el FY no
  esté cerrado y que el período de ese tipo esté abierto, no el MONTHLY. Lo usa solo
  `closeFiscalYear`.

**D13. Código muerto**

- `integrations/treasury/index.ts` y `createJournalEntryForCOGS` no tienen callers y callan
  errores.
- Recomendado: **borrarlos** en este ticket, o migrarlos al helper si alguien los quiere conservar.

**Estimación relativa** (escala de 758 §1.7.3): B1 a B10 = 8; con D7 (+2), D8 (+1) y D2-b (+1),
**unos 12 puntos**. Conviene entregarlo en un PR con fases internas:

1. helpers y tests del helper;
2. migración de creadores con un test por creador;
3. cierre y bloqueo (`setLockedPeriod`, `closeFiscalYear`, D7) con la UI;
4. reversión;
5. migración de datos y script de diagnóstico;
6. `docs/`, guía in-app y guía de presentación.

---

## 2. Planificación
_Pendiente - ejecutar `/planificar tsk-760-cierre-contable`_

## 3. Diseño
_Pendiente - ejecutar `/disenar tsk-760-cierre-contable`_

## 4. Implementación
_Pendiente - ejecutar `/implementar tsk-760-cierre-contable`_

## 5. Verificación
_Pendiente - ejecutar `/verificar tsk-760-cierre-contable`_
