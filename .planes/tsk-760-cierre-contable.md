# TSK-760 — Cierre contable: el cierre anual no funciona y el bloqueo de períodos se saltea

**Fecha de inicio:** 2026-10-06
**Estado:** Planificación completada

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

Catorce fases, ordenadas por riesgo y dependencias: primero se mide producción (script de solo
lectura), después se construye y testea el núcleo (helpers con TDD), se migran los datos para que
el núcleo tenga sobre qué operar, se pasan los 20 caminos de creación al núcleo en cuatro grupos,
se rehace el bloqueo de meses y el cierre anual, la reversión, se borra el código muerto, se
completan los errores legibles (`ActionResult`) y se cierra con capturas, documentación,
presentación y verificación en modo producción. Un solo PR con un commit por fase. Una migración
de datos (SQL a mano); **ningún cambio de modelo Prisma, ningún permiso ni módulo nuevo**.

Rutas abreviadas: `ACC/` = `src/modules/accounting/`; `UT/` = `src/modules/accounting/shared/utils/`;
`INT/` = `ACC/features/integrations/`; `TRE/` = `src/modules/commercial/features/treasury/features/`;
`DEP/` = `src/modules/equipment/features/depreciation/`; `GP/` = `scripts/guia-presentacion/`.

### 2.0 Decisiones adoptadas

El líder adopta **todas** las recomendaciones de 1.7 (D1 a D13), incluidas D7 (B18 a B21 dentro de
este ticket) y D8 (todo en UTC; las acciones de bloqueo reciben `{ year, month }`). Donde la
recomendación dejaba margen, se eligió lo más simple (marcado con **[simple]**).

| # | Decisión adoptada |
|---|---|
| A1–A6 | Se mantienen como en 1.7 (meses con estado propio y bloqueo secuencial; OR de tres condiciones; helpers compartidos; `reverseJournalEntryTx` puro; cierre anual sin DRAFT; fuera de alcance lo de 758). |
| D1 | `ensureFiscalYearTx(tx, companyId, date)` crea **hacia adelante** el FY que contiene la fecha, contiguo al último existente, con OPENING + MONTHLY (uno por mes real del rango, no siempre 12) + CLOSING. **[simple]** Tope: solo el FY **inmediatamente siguiente** al último existente; una fecha más allá → `BusinessError` ("la fecha 05/03/2028 está más de un ejercicio por delante…"). Fecha anterior al primer FY → `BusinessError` "anterior al inicio del primer ejercicio (01/01/2026); cargala como saldo de apertura". `saveAccountingSettings` crea el FY 1 al guardar Ajustes por primera vez (B23). `closeFiscalYear` reutiliza el FY siguiente si existe (B24). Empresa sin Ajustes → `BusinessError` "configurá Contabilidad → Ajustes" (salvo el caso de bancos, ver abajo). |
| D2 | **(b)**: el diálogo de cierre de mes informa la cantidad de borradores del mes y ofrece **"Registrar los N borradores y cerrar"** en la misma transacción. **[simple]** Si algún borrador no se puede registrar (desbalanceado, cuenta no imputable), el cierre entero se aborta con `BusinessError` que nombra el asiento; no hay registro parcial. "Cerrar sin registrar" no se ofrece: con borradores, el único camino es registrar o reabrir/editar. |
| D3 | Backfill de `is_closed` por **unión** (`is_closed` actual o `fin_del_mes <= locked_until_date`), cierre de huecos hacia atrás (invariante secuencial), FY cerrados con todos sus meses cerrados y `locked_until_date` = fin del último mes cerrado contiguo. |
| D4 | Backfill de `fiscal_year_id`/`period_id` de **todos** los asientos, con `trg_journal_entry_immutable` deshabilitado solo alrededor de ese `UPDATE`, dentro de la misma transacción de la migración. Los asientos que no caen en ningún FY (anteriores al primero) quedan en `NULL` y se reportan con `RAISE NOTICE`. |
| D5 | La reversión desde Asientos usa la fecha de **hoy** (UTC), y valida la del original **y** la de hoy. |
| D6 | Se bloquea anular desde Asientos lo vinculado por FK (8 tablas de 1.2.5, incluida la columna sin relación de `FundMovement`) y los asientos de cierre/apertura de FY. Los `createdBy='system'` sin vínculo (bancos, transferencias, baja de equipo) se permiten con advertencia en el diálogo. IVA, cambio, inflación, recurrentes y apertura manual, sin restricción. |
| D7 | B18 a B21 entran. **[simple]** B18 por **exclusión**: los saldos acumulados (`UT/balances.ts`, saldo anterior del Mayor) excluyen los asientos que son `openingEntryId` de un FY con `closingEntryId` no nulo del FY anterior (apertura generada por cierre); se ven en el Diario. No se genera asiento de cierre patrimonial. B19: el Estado de Resultados, Presupuesto vs. real y movimientos por centro de costo excluyen los `closingEntryId`. B20: sin saldos de resultado → `BusinessError` "no hay asientos registrados con resultado en el ejercicio N° X: registrá los borradores". B21: la apertura se calcula **después** de la refundición, dentro de la tx, y `createJournalEntryTx` verifica balance (|debe − haber| < 0,01) para todo asiento que nace POSTED o se registra. |
| D8 | Todo cálculo de mes y rango en **UTC** (`moment.utc`) y comparación por día calendario UTC. `closeAccountingPeriod`/`reopenAccountingPeriod` reciben `{ year, month }`; el servidor deriva el fin de mes. La grilla se arma desde los `AccountingPeriod` del FY. **[simple]** Fechas de FY nuevas: `startDate` = 00:00:00.000 UTC del primer día y `endDate` = 23:59:59.999 UTC del último (así funcionan las consultas existentes con `gte/lte`); el backfill normaliza también los FY de la migración 20260625. |
| D9 | Helpers en `UT/` (`period-lock.ts`, `journal-entry-tx.ts`, `entry-document-link.ts`, `utc-month.ts`) y reexportados por `INT/` para `commercial/` y `equipment/`, como hoy. |
| D10 | Cierre y reapertura de meses: `accounting.settings` `update`. "Registrar y cerrar": además `accounting.entries` `approve`. Cierre anual: `accounting.fiscal-year-close` `approve`. Sin permisos nuevos. |
| D11 | Con FY existentes, las fechas de ejercicio de Ajustes son de solo lectura y se muestran desde el FY abierto más antiguo. Editables solo si hay un único FY sin asientos ni meses cerrados; en ese caso se regeneran sus períodos en la misma tx. |
| D12 | `assertPeriodOpen(tx, companyId, date, { periodType: 'OPENING' \| 'CLOSING' })` solo mira FY no cerrado y período de ese tipo abierto. Lo usa solo `closeFiscalYear`. Convención de OPENING/CLOSING: la del código (mes real de inicio y de fin); el backfill corrige `month = 0/13` de la migración 20260625. |
| D13 | Se **borran** `INT/treasury/index.ts` y `createJournalEntryForCOGS` (sin callers). |

Otras decisiones de esta planificación:

- **Firma del núcleo** (el detalle va en Diseño):
  - `assertPeriodOpen(tx, companyId, date, opts?)` → `{ fiscalYearId, periodId }`. Toma primero
    el lock de `accounting_settings` (`SELECT … FOR UPDATE`), llama a `ensureFiscalYearTx` y
    evalúa en OR: FY cerrado, MONTHLY cerrado, `fecha <= lockedUntilDate` (por día UTC). Mensaje:
    "No se puede registrar con fecha DD/MM/YYYY: el período está cerrado (mes MM/YYYY cerrado |
    ejercicio N° X cerrado)". Conserva "el período está cerrado" (tests existentes).
  - `nextEntryNumberTx(tx, companyId)` → `UPDATE … SET last_entry_number = last_entry_number + 1
    RETURNING` (lanza `BusinessError` si no hay Ajustes).
  - `createJournalEntryTx(tx, { companyId, date, description, lines, status, createdBy,
    currency?, exchangeRate?, periodType? })` → llama a `assertPeriodOpen` y `nextEntryNumberTx`,
    valida líneas (sin 0/0, balance si POSTED) y crea con `fiscalYearId`/`periodId`. Las líneas
    llevan todas las columnas (auxiliares, `costCenterId`, moneda). Sin `checkPermission` ni
    `$transaction` propios.
  - `postJournalEntryTx(tx, companyId, entryId)` → registra un DRAFT validando período y
    balance (lo usan `postJournalEntry` y "Registrar y cerrar").
  - `reverseJournalEntryTx` y `getEntryDocumentLink` en la Fase 10.
- **Bancos sin Ajustes** (#12 a #14): **[simple]** se conserva "sin Ajustes no hay asiento" (la
  empresa no usa contabilidad); no es un cierre de período y sacarlo excede el ticket. Sí deja de
  callar cuando **hay** Ajustes y el período está cerrado. Anotado en 2.4.
- **Actions nuevas o reescritas nacen con `ActionResult`** (memoria `errores-negocio-server-actions`):
  `closeAccountingPeriod`, `reopenAccountingPeriod` (Fase 8), `closeFiscalYear` (Fase 9) y
  `reverseJournalEntry` (Fase 10) con sus componentes. La Fase 12 completa las 7 funciones y 7
  componentes restantes. `setLockedPeriod` se elimina (lo reemplazan las dos nuevas). "No
  autenticado"/"sin empresa activa" siguen como `throw`.
- **Mientras las actions viejas siguen lanzando** (Fases 4 a 7), sus tests afirman
  `rejects.toThrow(/el período está cerrado/)`; la Fase 12 los cambia a `{ success: false }`.
- **Componentes ya excedidos** que solo se adaptan (`_CreateEntryModal` 297, `_EntriesTable` 353,
  `_AccountBalancesForm` 387, `_BankTransferDialog` 374, `_CreateBankMovementDialog` 272,
  `_RecurringEntriesTable` 210): no crecen más de 3-4 líneas; refactor en 2.4 (precedente 757).
  Los que se reescriben (`_PeriodLockingForm` 238, `_ClosePreviewDialog` 215) se parten en piezas
  < 200 líneas.
- **Testing:** Vitest (`npm run test`); puros en `UT/*.test.ts` y de integración
  `*.integration.test.ts` contra `contable-pms-db`. **No Cypress** (memoria). Cada test de
  integración crea su propia empresa y la borra en `afterAll` (incluidos FY y períodos que ahora
  crea `ensureFiscalYearTx`, R7).
- **Línea base:** `npm run check-types` = **219** errores (no sube); `eslint` sin errores en los
  archivos tocados; `npm run test` verde; `npm run build` OK.

### 2.1 Fases de implementación

#### Fase 1: Script de diagnóstico de producción y línea base

- **Objetivo:** que el usuario pueda medir producción **antes** de deployar (tamaño del cambio de
  comportamiento, B22, empresas a migrar) sin tocar nada; registrar la línea base.
- **Tareas:**
  - [ ] Crear `prisma/scripts/diagnostico-tsk760.sh` (ejecutable, `set -euo pipefail`) con el SQL
        de §1.6.3, en el formato de `prisma/scripts/verificacion-post-deploy.sh`
        (`sudo docker exec -i $(sudo docker ps -q --filter name=contablemas-contablemas) sh -c
        'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -P pager=off' <<'SQL'`). **Solo `SELECT`**:
        el script abre con `SET default_transaction_read_only = on;`.
  - [ ] Modos: sin argumento = producción; `--local` = `docker exec -i contable-pms-db` sin
        `sudo` (mismo `sh -c 'psql …'`, usa las variables del contenedor); `--db <nombre>` para
        correrlo contra una copia (Fase 3). Cabecera con uso y cómo leer cada consulta (texto de
        "Cómo leerlo" de §1.6.3).
  - [ ] Agregar las consultas: 0) `current_user`, dueño de `journal_entries`
        (`pg_tables.tableowner`) y estado de los triggers (`pg_trigger.tgenabled`) — la migración
        hace `ALTER TABLE … DISABLE TRIGGER` y necesita ser dueña; 12) FY con `month = 0/13` y FY
        cuyo rango no coincide con Ajustes; 13) asientos anteriores al inicio de Ajustes con
        fecha de los últimos 90 días (impacto de D1).
  - [ ] Al final, instrucciones (B22): `sudo docker exec $(sudo docker ps -q --filter
        name=contablemas-frontend) sh -c 'date; printenv TZ'` (en modo producción lo ejecuta; en
        `--local` imprime `date` del host y `TZ`).
  - [ ] Probar `--local` contra `contable-pms-db` y comparar con 1.2.7. Borrar antes el asiento
        local de debug **999999** (solo dato local; anotarlo en la sección 4).
  - [ ] Medir línea base: `npm run check-types 2>&1 | grep -c "error TS"` (219), `npm run test`
        (anotar cuántos pasan), `npx eslint` de los archivos a tocar. Registrar en la sección 4.
  - [ ] Pedir al usuario que corra el script en producción y pegue la salida en la sección 4
        (**bloqueante para la Fase 3**: define cuántos FY crea el backfill y el texto de aviso a la
        clienta).
- **Archivos:** `prisma/scripts/diagnostico-tsk760.sh` (nuevo).
- **Criterio de completitud:** el script corre en `--local` sin errores y sin escribir; salida de
  producción registrada (o el pedido pendiente anotado); commit
  `chore(accounting): script de diagnóstico de cierre y bloqueo para producción (TSK-760, fase 1)`.

#### Fase 2: Núcleo — mes UTC, `assertPeriodOpen`, numeración y `createJournalEntryTx` (TDD)

- **Objetivo:** una sola definición de período cerrado y un solo creador de asientos, testeados,
  sin que todavía los use nadie.
- **Tareas:**
  - [ ] `UT/utc-month.test.ts` (rojo) y `UT/utc-month.ts`: `toUtcDay(date)`,
        `monthKeyUtc(date)` → `{ year, month }`, `endOfMonthUtc({ year, month })`,
        `isOnOrBeforeDayUtc(a, b)`, `monthsBetweenUtc(start, end)` (lista de meses del FY,
        irregulares incluidos), `formatMonth({ year, month })` → `MM/YYYY`. Casos: día 1 00:00Z y
        02:59Z caen en el mes del día 1 (B22); fin de mes de febrero bisiesto; FY irregular de 18
        meses; `TZ=America/Argentina/Buenos_Aires` y `TZ=UTC` dan lo mismo (correr el test con
        ambas en el script de `vitest`, o fijar `process.env.TZ` en el test).
  - [ ] `UT/period-lock.test.ts` (puro) y `UT/period-lock.ts`: función pura
        `evaluatePeriodClosure({ date, fiscalYear, period, lockedUntilDate })` → `{ closed: false }
        | { closed: true, reason: 'FISCAL_YEAR' | 'PERIOD' | 'LOCKED_UNTIL' }` y
        `buildPeriodClosedMessage(date, reason, fyNumber)`. Casos: cada condición sola; OR de las
        tres con datos desincronizados (escenarios 1 y 2 de 1.6.2); día exacto de `lockedUntilDate`
        con hora 02:59:59.999 (cerrado).
  - [ ] `UT/period-lock.ts`: `ensureFiscalYearTx` (D1) y `assertPeriodOpen` (lock `FOR UPDATE`
        sobre `accounting_settings`, D12 con `periodType`). `UT/journal-entry-tx.ts`:
        `nextEntryNumberTx`, `createJournalEntryTx`, `postJournalEntryTx` y la validación pura
        `validateEntryLines(lines, { requireBalance })` (en `UT/journal-entry-lines.ts` con su
        `.test.ts`: 0/0, negativos, desbalance, tolerancia 0,01).
  - [ ] `UT/period-lock.integration.test.ts` contra la DB local, empresa propia con Ajustes:
        sin FY → crea FY 1 al pedir una fecha del rango de Ajustes; fecha del FY siguiente → lo
        crea contiguo con sus períodos; dos ejercicios adelante → rechaza; anterior al primero →
        rechaza con el texto de D1; mes cerrado / FY cerrado / `lockedUntilDate` → rechaza con el
        mes y la causa; OPENING/CLOSING (D12).
  - [ ] `UT/journal-entry-tx.integration.test.ts`: número correlativo; **concurrencia**: 10
        `createJournalEntryTx` en paralelo (`Promise.all` de `$transaction`) → números únicos y
        contador = 10; cierre de mes concurrente con creación (una tx cierra con `FOR UPDATE`
        tomado, la otra espera y falla con "período está cerrado"); POSTED desbalanceado →
        `BusinessError`; `fiscalYearId`/`periodId` siempre cargados; copia de auxiliares, moneda y
        `costCenterId`.
  - [ ] Reexportar desde `INT/index.ts` lo que usan `commercial/` y `equipment/` (D9).
- **Archivos:** `UT/utc-month.ts`, `UT/period-lock.ts`, `UT/journal-entry-tx.ts`,
  `UT/journal-entry-lines.ts` y sus `.test.ts` / `.integration.test.ts` (nuevos);
  `UT/index.ts`, `INT/index.ts` (exports).
- **Criterio de completitud:** tests nuevos verdes; `npm run test` completo verde; tipos ≤ 219;
  ningún caller cambiado; commit
  `feat(accounting): núcleo único de período cerrado y creación de asientos (TSK-760, fase 2)`.

#### Fase 3: Migración de datos y sincronización de Ajustes con el ejercicio

- **Objetivo:** que toda empresa con Ajustes tenga FY y períodos coherentes, que `is_closed` y
  `locked_until_date` digan lo mismo y que los asientos tengan `fiscal_year_id`/`period_id`;
  que no vuelva a pasar (B23, D11).
- **Tareas:**
  - [ ] `npx prisma migrate dev --create-only --name tsk_760_fiscal_years_backfill` y escribir el
        SQL a mano (estilo 20260625), **idempotente** (`INSERT … WHERE NOT EXISTS`,
        `UPDATE … WHERE … IS NULL`, `GREATEST`) y en **una transacción**
        (`BEGIN; … COMMIT;` explícitos si Prisma no envuelve; verificar con `ctx7` en Diseño):
    1. Normalizar los FY existentes (D8): `start_date` = día UTC 00:00, `end_date` = día UTC
       23:59:59.999; OPENING/CLOSING con `month = 0/13` → mes real (D12).
    2. Empresas con Ajustes y sin FY: FY 1 con el rango de Ajustes (`::date`), y luego FY
       contiguos de 12 meses hasta cubrir `GREATEST(now(), max(journal_entries.date))` (empresas
       con "EJERCICIO VENCIDO SIN CERRAR"). Períodos OPENING + un MONTHLY por mes real + CLOSING
       (`generate_series`), con `ON CONFLICT DO NOTHING` sobre el único existente.
    3. `is_closed` por unión (D3), cierre de huecos hacia atrás, FY cerrados → todos sus meses
       cerrados; `locked_until_date` = fin (23:59:59.999 UTC) del último MONTHLY cerrado contiguo,
       o `NULL`.
    4. `ALTER TABLE journal_entries DISABLE TRIGGER trg_journal_entry_immutable;`
       `UPDATE journal_entries SET fiscal_year_id/period_id` (por día UTC, solo donde son `NULL`
       o inconsistentes); `ENABLE TRIGGER` inmediatamente después. Nada más entre ambos.
    5. `last_entry_number = GREATEST(last_entry_number, max(number))` por empresa (consulta 7).
    6. `RAISE NOTICE` con conteos: FY creados, meses cerrados por unión y por hueco, asientos
       sin FY (anteriores al primero) por empresa.
  - [ ] Probar **antes de aplicar** sobre una copia: `docker exec contable-pms-db pg_dump` →
        `createdb contable_tsk760_copia` → restaurar; sembrar escenarios con
        `prisma/scripts/tsk760-escenarios-migracion.sql` (nuevo, solo local): (a) empresa sin FY
        con ejercicio vencido; (b) FY de 20260625 con `lockedUntilDate` y meses `is_closed=false`
        (escenario 1); (c) meses `is_closed=true` y `lockedUntilDate` nulo (escenario 2); (d) DRAFT
        y POSTED en meses que quedan cerrados; (e) asientos anteriores al primer FY y posteriores
        al último; (f) hueco (marzo cerrado, febrero abierto); (g) FY cerrado con un mes abierto.
        Correr `DATABASE_URL=…/contable_tsk760_copia npx prisma migrate deploy` **dos veces**
        (idempotencia: la segunda no cambia nada, comparar `diagnostico-tsk760.sh --db` antes y
        después), y verificar que los triggers quedan `tgenabled = 'O'`.
  - [ ] Test de regresión de la migración: `ACC/features/fiscal-year-close/fy-backfill.integration.test.ts`
        siembra los escenarios (a)-(g) en empresas propias, ejecuta el `migration.sql` con un
        cliente `pg` (consulta simple multi-sentencia) y verifica el resultado; una segunda
        ejecución no cambia filas.
  - [ ] Recién entonces `npm run db:migrate` (aplica en `contable-pms-db`); **nunca**
        `migrate reset`. Si hay drift ajeno: `npx prisma migrate status` y frenar.
  - [ ] B23/D11 en `ACC/features/settings/actions.server.ts` `saveAccountingSettings`: en la
        misma tx, si no hay FY → `ensureFiscalYearTx` con el rango (FY 1); si hay FY y cambian las
        fechas → solo permitido con un único FY sin asientos ni meses cerrados (regenera sus
        períodos), si no `BusinessError`; pasa a `ActionResult`. `getAccountingSettings` devuelve
        también `fiscalYearLocked: boolean` y el rango del FY abierto más antiguo.
  - [ ] Formulario de Ajustes (componente de fechas de ejercicio en `ACC/features/settings/components/`):
        fechas de solo lectura con la leyenda "Las fechas salen del ejercicio N° X; se cambian
        cerrando el ejercicio", y manda `YYYY-MM-DD` (sin `new Date('…T00:00:00')` local, B22).
  - [ ] Tests: `ACC/features/settings/accounting-settings.integration.test.ts`: primera vez crea
        FY 1 con períodos; cambiar fechas con asientos → `{ success: false }`; sin asientos →
        regenera períodos.
- **Archivos:** `prisma/migrations/<ts>_tsk_760_fiscal_years_backfill/migration.sql` (nuevo);
  `prisma/scripts/tsk760-escenarios-migracion.sql` (nuevo); `fy-backfill.integration.test.ts`
  y `accounting-settings.integration.test.ts` (nuevos); `ACC/features/settings/actions.server.ts`
  y el formulario de Ajustes (modificados).
- **Criterio de completitud:** en la copia y en la local, `diagnostico-tsk760.sh` da 0 empresas
  con Ajustes sin FY, 0 asientos sin FY/período (salvo los reportados anteriores al primer FY),
  consulta 6 vacía, consulta 7 vacía, triggers habilitados; segunda corrida sin cambios; commit
  `feat(accounting): ejercicios y períodos para todas las empresas y bloqueo sincronizado (TSK-760, fase 3)`.

#### Fase 4: Creadores I — asientos manuales y registrar (#1, #2)

- **Objetivo:** el asiento manual y el "Registrar" usan el núcleo; se borran los validadores
  duplicados (B3, B4 en registrar).
- **Tareas:**
  - [ ] `ACC/features/entries/actions.server.ts` `createJournalEntry`: todo dentro de una tx con
        `createJournalEntryTx` (DRAFT); el `companyId` sale de `getActiveCompanyId()`, no del
        cliente.
  - [ ] `postJournalEntry`: `postJournalEntryTx` (valida FY cerrado + mes + bloqueo y balance; B4).
  - [ ] `ACC/features/entries/validators/index.ts`: borrar `validatePeriodLock`,
        `validateJournalEntryDate` y `resolveFiscalPeriod` (o dejarlos delegando si quedan
        callers fuera de este ticket; grep antes). `ACC/shared/validators/index.ts:128`: borrar el
        duplicado si no se usa (verificar `accounts/actions.server.ts:23`), o delegarlo.
  - [ ] `ACC/features/entries/entries.integration.test.ts` (nuevo): crea DRAFT con FY/período y
        número; mes cerrado → rechaza; registrar DRAFT de un FY cerrado → rechaza (B4); registrar
        DRAFT desbalanceado → rechaza; `companyId` ajeno ignorado.
- **Archivos:** `ACC/features/entries/actions.server.ts`, `ACC/features/entries/validators/index.ts`,
  `ACC/shared/validators/index.ts`, `entries.integration.test.ts` (nuevo).
- **Criterio de completitud:** tests verdes; tipos ≤ 219; commit
  `fix(accounting): asientos manuales y registro respetan el período cerrado (TSK-760, fase 4)`.

#### Fase 5: Creadores II — comerciales, equipos y depreciación (#4, #6, #8, #9, #10)

- **Objetivo:** documentos comerciales y de bienes de uso validan las tres condiciones dentro de
  la tx.
- **Tareas:**
  - [ ] `INT/commercial/index.ts` helper común (`:198`): reemplazar el chequeo de
        `lockedUntilDate`, el resolver de período con `moment()` local y la numeración por
        `createJournalEntryTx`. Venta, compra, recibo, OP y gasto heredan.
  - [ ] `INT/equipment/index.ts` (`:64`): ídem.
  - [ ] `DEP/actions.server.ts`: `postEntryTx` (`:692`), `postDepreciationEntry` (`:795`, mover el
        chequeo de `:842-849` dentro de la tx), `createValueAdjustment` (`:990`, ídem `:1057-1064`)
        y `resolveFiscalPeriodTx` (`:45`, borrar). `postAllPendingDepreciations` (`:871`): los
        períodos cerrados dejan de filtrarse en silencio y se informan en `errors[]` con el mes
        (escenario 10).
  - [ ] Tests: los existentes que esperan "período está cerrado" (`receipt-journal-entry`,
        `payment-order-journal-entry`, `expense-journal-entry`, `sales-invoice-line-accounts`,
        `purchase-invoice-line-accounts`, `asset-disposal`) siguen verdes sin tocar el texto;
        agregar en cada uno un caso "mes cerrado por `AccountingPeriod` sin `lockedUntilDate`"
        (B3) y un caso "asiento con `fiscalYearId`/`periodId`". Nuevo
        `DEP/depreciation-period-lock.integration.test.ts`: individual, revalúo y masiva con un
        mes cerrado (este último aparece en `errors[]`).
- **Archivos:** `INT/commercial/index.ts`, `INT/equipment/index.ts`, `DEP/actions.server.ts`,
  los 6 tests existentes, `depreciation-period-lock.integration.test.ts` (nuevo).
- **Criterio de completitud:** `npm run test` verde; tipos ≤ 219; commit
  `fix(accounting): comprobantes y bienes de uso validan el período cerrado completo (TSK-760, fase 5)`.

#### Fase 6: Creadores III — tesorería (#11 a #14)

- **Objetivo:** movimientos de fondos, bancarios y transferencias validan período y numeran
  atómico (B3, B7, B8).
- **Tareas:**
  - [ ] `TRE/fund-movements/list/actions.server.ts` `createJournalEntryForFundMovement` (`:447`):
        `createJournalEntryTx` (deja de usar `lastEntryNumber + 1`).
  - [ ] `TRE/bank-movements/actions.server.ts`: `createJournalEntryForBankMovement` (`:162`),
        transferencia banco → banco (`:1026`/`:1117`) y banco ↔ caja (`:1232`) con
        `createJournalEntryTx`. Se conserva "sin Ajustes no hay asiento" (2.0), pero con Ajustes y
        período cerrado se rechaza el movimiento entero (no se graba el movimiento sin asiento).
  - [ ] Tests: `fund-movement-lines.integration.test.ts` + caso mes cerrado y numeración; nuevo
        `TRE/bank-movements/bank-movement-period-lock.integration.test.ts`: movimiento manual y las
        dos transferencias en mes abierto (asiento con FY/período/número) y cerrado (rechazo, sin
        movimiento grabado).
- **Archivos:** `TRE/fund-movements/list/actions.server.ts`, `TRE/bank-movements/actions.server.ts`,
  tests indicados.
- **Criterio de completitud:** tests verdes; tipos ≤ 219; commit
  `fix(treasury): fondos, bancos y transferencias respetan el período cerrado (TSK-760, fase 6)`.

#### Fase 7: Creadores IV — generadores contables (#15 a #19)

- **Objetivo:** recurrentes, saldos de apertura, IVA, diferencia de cambio e inflación usan el
  núcleo.
- **Tareas:**
  - [ ] `ACC/features/recurring-entries/actions.server.ts` `generateRecurringEntry` (`:177`) y
        `generateAllPendingRecurringEntries` (`:269`, el período cerrado va a `errors[]` con el mes).
  - [ ] `ACC/features/opening-balances/actions.server.ts` `saveOpeningBalanceEntry` (`:312`):
        POSTED, con `periodType: 'OPENING'` del FY de la fecha y balance verificado.
  - [ ] `ACC/features/vat-settlement/actions.server.ts` (`:102`),
        `ACC/features/exchange-rates/actions.server.ts` (`:254`),
        `ACC/features/inflation-adjustment/actions.server.ts` (`:258`): `createJournalEntryTx`
        (sin UI, migración barata, R1).
  - [ ] Tests nuevos `ACC/features/{recurring-entries,opening-balances}/*.integration.test.ts`
        (abierto/cerrado, numeración, FY/período) y un test mínimo combinado
        `ACC/features/vat-settlement/generators-period-lock.integration.test.ts` para IVA, cambio e
        inflación (rechazo en mes cerrado y FY/período cargados).
- **Archivos:** las 5 actions y los tests nuevos.
- **Criterio de completitud:** los 20 caminos de 1.2.1 (salvo #3, #5, #7, #20, que van en sus
  fases) pasan por `createJournalEntryTx`; `grep -rn "lastEntryNumber + 1\|journalEntry.create("
  src/modules` solo devuelve el núcleo y los pendientes de fases 9-11; tests verdes; commit
  `fix(accounting): recurrentes, apertura, IVA, cambio e inflación respetan el período cerrado (TSK-760, fase 7)`.

#### Fase 8: Cierre y reapertura de meses (B3, B5, B22, D2)

- **Objetivo:** el bloqueo de períodos cierra y abre `AccountingPeriod` en orden, sincroniza
  `lockedUntilDate`, nunca reabre un ejercicio cerrado y ofrece registrar los borradores.
- **Tareas:**
  - [ ] `ACC/features/settings/actions.server.ts`: reemplazar `setLockedPeriod` por
        `closeAccountingPeriod({ year, month, postDrafts })` y `reopenAccountingPeriod({ year,
        month })`, ambas `ActionResult`, con `checkPermission('accounting.settings', 'update')`
        (+ `accounting.entries` `approve` si `postDrafts`, D10). Reglas: solo el primer MONTHLY
        abierto se cierra; solo el último cerrado se reabre; nunca uno de un FY cerrado (piso, B5);
        `lockedUntilDate` recalculado en la misma tx tras `FOR UPDATE`. Con DRAFT en el mes y sin
        `postDrafts` → `BusinessError` con cantidad y primeros números; con `postDrafts` →
        `postJournalEntryTx` de cada uno o aborta todo (D2).
  - [ ] `getPeriodLockStatus()` (reemplaza `getLockedPeriod`): meses del FY abierto más antiguo y
        del siguiente si existe, desde `AccountingPeriod`, con `isClosed`, `draftCount`,
        `canClose`, `canReopen` y el motivo (`reason`) cuando no se puede.
  - [ ] UI: partir `_PeriodLockingForm.tsx` (238) en `_PeriodLockingPanel.tsx` (lista de meses
        con `useQuery(['periodLockStatus'])`), `_PeriodMonthRow.tsx` y `_ClosePeriodDialog.tsx`
        (`AlertDialog`: "Marzo 2026 tiene 4 borradores" + botón "Registrar los 4 borradores y
        cerrar"), y hook `usePeriodLockMutations.ts`; todos < 200 líneas;
        `toast.error(result.error)`. `AccountingSettings.tsx` deja de pasar el rango de Ajustes.
  - [ ] `ACC/features/settings/period-lock.integration.test.ts`: cerrar en orden; cerrar fuera de
        orden → rechaza; reabrir el último; reabrir el primer mes del FY nuevo con el anterior
        cerrado → rechaza (B5); con DRAFT sin/con `postDrafts`; DRAFT desbalanceado aborta todo;
        `lockedUntilDate` = fin del último cerrado; mes de diciembre en UTC con servidor `TZ=UTC`
        y `TZ=America/Argentina/Buenos_Aires` (B22).
- **Archivos:** `ACC/features/settings/actions.server.ts`, `AccountingSettings.tsx`, componentes
  nuevos en `ACC/features/settings/components/` y `hooks/`, `_PeriodLockingForm.tsx` (borrado),
  test nuevo.
- **Criterio de completitud:** tests verdes; componentes < 200; no queda ningún `Date` de fin de
  mes armado en el navegador; commit
  `feat(accounting): cierre de meses en orden con registro de borradores (TSK-760, fase 8)`.

#### Fase 9: Cierre anual (B1, B4, B18–B21, B24, D12)

- **Objetivo:** el cierre anual se puede ejecutar después de cerrar los meses, genera asientos
  correctos y los reportes no se rompen después.
- **Tareas:**
  - [ ] `ACC/features/fiscal-year-close/actions.server.ts` `closeFiscalYear` → `ActionResult`:
        FY por id del FY abierto más antiguo (no por solapamiento con Ajustes); exige todos los
        MONTHLY cerrados (B1, mensaje con los meses abiertos) y **ningún DRAFT** en el rango
        (A5/B4, cantidad por mes y primeros números); preview **dentro** de la tx; refundición con
        `createJournalEntryTx(…, { periodType: 'CLOSING', status: 'POSTED' })`; sin saldos de
        resultado → `BusinessError` (B20); apertura calculada **después** de la refundición, con
        `periodType: 'OPENING'` y balance verificado (B21); FY siguiente con `ensureFiscalYearTx`
        (reutiliza si existe, B24; meses en UTC, sin los 13 meses); `isClosed`, `closedAt`,
        `closingEntryId`, `openingEntryId`; `lockedUntilDate` y Ajustes al FY nuevo.
  - [ ] `previewFiscalYearClose` / `getFiscalYearStatus`: mismos cálculos compartidos (función
        `computeClosePreviewTx`); el status informa meses abiertos y DRAFT pendientes.
  - [ ] B18: `UT/balances.ts` (`calculateAllAccountBalances`, `calculateOpeningBalance` y
        afines) y el saldo anterior del Mayor (`ACC/features/reports/actions.server.ts:233`)
        excluyen las aperturas generadas por cierre (helper `getClosingGeneratedEntryIds(companyId)`
        en `UT/`). B19: Estado de Resultados (`:508-541`), Presupuesto vs. real y movimientos por
        centro de costo excluyen los `closingEntryId`.
  - [ ] UI: `_ClosePreviewDialog.tsx` (215) pasa a `useQuery(['fiscalYearClosePreview'])` (fuera
        el `useEffect`) y se parte en `_ClosePreviewDialog.tsx` + `_ClosePreviewTables.tsx` < 200;
        `_FiscalYearStatus.tsx` muestra meses abiertos y DRAFT pendientes con link a Bloqueo de
        períodos y Asientos.
  - [ ] `ACC/features/fiscal-year-close/fiscal-year-close.integration.test.ts`: con meses
        abiertos → rechaza nombrándolos; con DRAFT → rechaza listándolos; sin resultados → B20;
        cierre feliz: refundición y apertura balanceadas, FY siguiente con 12 meses, FY siguiente
        **ya existente** reutilizado (B24); después del cierre, Balance/Sumas y Saldos del FY nuevo
        = saldos del cerrado (no el doble, B18) y Estado de Resultados del cerrado ≠ 0 (B19);
        reabrir un mes del FY cerrado → rechaza.
- **Archivos:** `ACC/features/fiscal-year-close/actions.server.ts` y componentes,
  `UT/balances.ts`, `ACC/features/reports/actions.server.ts`, acciones de presupuesto y
  `ACC/features/reports/` de centro de costo (`UT/cost-center-movements.ts`), test nuevo.
- **Criterio de completitud:** criterio de aceptación 1 y 4 cubiertos por test; tests de reportes
  existentes (`cost-center-movements.*`) verdes; commit
  `fix(accounting): el cierre anual se ejecuta y genera asientos correctos (TSK-760, fase 9)`.

#### Fase 10: Reversión desde Asientos (B10, D5, D6)

- **Objetivo:** la anulación copia todo, valida ambas fechas y no deja anular asientos de
  documentos.
- **Tareas:**
  - [ ] `UT/entry-document-link.ts`: `getEntryDocumentLink(tx, entryId)` → `{ kind, label,
        number } | null` sobre las 8 tablas de 1.2.5 (incluida `fund_movements.journal_entry_id`
        sin relación) y `fiscal_years.closing/opening_entry_id`. `getEntriesWithoutDocuments`
        (`ACC/features/reports/actions.server.ts:623`) lo reutiliza.
  - [ ] `UT/journal-entry-tx.ts` `reverseJournalEntryTx(tx, { companyId, entryId, date,
        createdBy })`: valida período del original y de la fecha de reversión, crea el asiento con
        todas las columnas de línea invertidas (auxiliares, `costCenterId`, moneda) vía
        `createJournalEntryTx`, y pasa el original a REVERSED con `reversalEntryId` en **un solo**
        `UPDATE` (trigger).
  - [ ] `ACC/features/entries/actions.server.ts` `reverseJournalEntry` → `ActionResult`: si hay
        documento vinculado → `BusinessError` "Este asiento es de la factura A-0001-00000012:
        anulalo desde el comprobante". `getReversalWarning(entryId)` para los `system` sin vínculo
        (D6).
  - [ ] `_ReverseEntryDialog.tsx`: `useQuery` del aviso + `toast.error(result.error)`.
  - [ ] `ACC/features/entries/reverse-entry.integration.test.ts`: copia auxiliares, moneda y
        centro de costo; original en mes cerrado → rechaza; hoy en mes cerrado → rechaza; asiento
        de factura / gasto / fondos / cierre → rechaza nombrando el documento; manual → anula.
- **Archivos:** `UT/entry-document-link.ts` (nuevo), `UT/journal-entry-tx.ts`,
  `ACC/features/entries/actions.server.ts`, `_ReverseEntryDialog.tsx`,
  `ACC/features/reports/actions.server.ts`, test nuevo.
- **Criterio de completitud:** criterio de aceptación 6 cubierto por test; commit
  `fix(accounting): la anulación de asientos copia todo y respeta documentos y períodos (TSK-760, fase 10)`.

#### Fase 11: Borrado de código muerto (B9, D13)

- **Objetivo:** que no quede ningún creador que calle errores.
- **Tareas:**
  - [ ] Borrar `INT/treasury/index.ts` (y su export) y `createJournalEntryForCOGS`
        (`INT/commercial/index.ts:1204`), previa confirmación con grep de que no hay callers
        (incluido `src/app`, `prisma/` y tests).
  - [ ] `grep -rn "return null" ` en los creadores restantes: ningún camino de asiento devuelve
        `null` ante error; `grep -rn "journalEntry.create(\|lastEntryNumber + 1" src/modules` →
        solo `UT/journal-entry-tx.ts`.
- **Archivos:** `INT/treasury/index.ts` (borrado), `INT/commercial/index.ts`, `INT/index.ts`.
- **Criterio de completitud:** greps limpios; tipos ≤ 219; tests verdes; commit
  `refactor(accounting): borrar creadores de asientos sin uso que callaban errores (TSK-760, fase 11)`.

#### Fase 12: Errores legibles en producción (`ActionResult`) en las actions restantes

- **Objetivo:** el "período está cerrado" llega legible en producción desde todas las pantallas.
- **Tareas:**
  - [ ] Pasar a `Promise<ActionResult<…>>` con `BusinessError` + `toActionResult`:
        `createJournalEntry`, `postJournalEntry` (`ACC/features/entries/actions.server.ts`),
        `createBankMovement`, `createBankTransfer` (`TRE/bank-movements/actions.server.ts`),
        `generateRecurringEntry`, `generateAllPendingRecurringEntries`,
        `saveOpeningBalanceEntry`. Junto con `closeAccountingPeriod`/`reopenAccountingPeriod`
        (Fase 8), `closeFiscalYear` (Fase 9) y `reverseJournalEntry` (Fase 10) quedan las 9 de
        1.2.6.
  - [ ] Adaptar los 7 componentes restantes (`if (!result.success) toast.error(result.error)`):
        `_CreateEntryModal`, `_PostEntryDialog`, `_RecurringEntriesTable`, `_GeneratePendingDialog`,
        `_AccountBalancesForm`, `_CreateBankMovementDialog`, `_BankTransferDialog` (los excedidos
        no crecen más de 3-4 líneas). Con `_ReverseEntryDialog`, `_ClosePreviewDialog` y el panel
        de bloqueo, son los 10 de 1.2.6.
  - [ ] Actualizar los tests de las fases 4, 6 y 7 de `rejects.toThrow` a
        `{ success: false, error: expect.stringContaining('el período está cerrado') }`.
- **Archivos:** las 3 actions y los 7 componentes; tests de fases 4, 6 y 7.
- **Criterio de completitud:** `grep -n "throw new Error" ` en esas actions solo deja errores
  técnicos; tests verdes; tipos ≤ 219; eslint limpio; commit
  `fix(accounting): mensajes de período cerrado legibles en producción (TSK-760, fase 12)`.

#### Fase 13: Capturas, documentación, guía in-app y presentación

- **Objetivo:** que la clienta entienda qué cambia antes de que le pase, y que el equipo tenga la
  documentación al día.
- **Tareas:**
  - [ ] `GP/capturas-tsk760.mjs` (molde `capturas-tsk728.mjs`, puerto 3010 con override de
        `NEXT_PUBLIC_APP_URL`, memoria `dev-local-capturas-y-login`), sembrando por SQL una empresa
        demo con FY y borradores marcados `TSK760-demo`: 01 lista de meses del bloqueo; 02
        diálogo "Marzo tiene N borradores → Registrar y cerrar"; 03 toast al registrar un asiento
        en mes cerrado; 04 reapertura bloqueada en el primer mes del ejercicio nuevo; 05 estado del
        cierre anual con meses abiertos y borradores; 06 cierre anual ejecutado (refundición y
        apertura); 07 Balance después del cierre (sin duplicar); 08 anular asiento de factura →
        mensaje; 09 aviso al anular un movimiento bancario; 10 fechas de ejercicio de solo lectura
        en Ajustes; 11-12 (`--prod`) toasts de bloqueo contra el build en :3011. `--restore`.
  - [ ] Guía in-app `src/modules/help/features/guide/components/_AccountingGuide.tsx`: reescribir
        "Cierre de ejercicio" (`:530-560`) y "Bloqueo de períodos" (`:695-740`). Si el archivo
        (917 líneas) obliga, partir las dos secciones en `_AccountingClosingGuide.tsx`. Texto base
        para la clienta:
    - **Cierre de meses:** "Los meses se cierran de a uno y en orden, desde Contabilidad → Ajustes
      → Bloqueo de períodos. Un mes cerrado no admite ningún movimiento con esa fecha: ni
      asientos manuales, ni facturas, recibos, órdenes de pago, gastos, movimientos de fondos o
      bancarios, transferencias, depreciaciones o asientos recurrentes. Solo se puede reabrir el
      último mes cerrado, y nunca uno de un ejercicio ya cerrado."
    - **Borradores:** "Si el mes que vas a cerrar tiene asientos en borrador (por ejemplo, los que
      generan las facturas al confirmarse), el sistema te los muestra y te ofrece registrarlos
      todos y cerrar. Un borrador que queda en un mes cerrado ya no se puede registrar sin
      reabrir el mes, y el cierre anual no se puede hacer con borradores pendientes."
    - **Cierre anual:** "Con todos los meses cerrados y sin borradores, el cierre del ejercicio
      genera la refundición de resultados y la apertura del ejercicio siguiente. Podés operar en
      el ejercicio nuevo antes de cerrar el anterior; el sistema lo crea solo con la primera
      operación."
    - **Anulación:** "Desde Asientos ya no se puede anular el asiento de un comprobante (factura,
      recibo, OP, gasto, movimiento de fondos, depreciación, revalúo o cierre): se anula desde el
      comprobante. Varios de esos comprobantes todavía no tienen anulación; llega en el próximo
      ticket (758)."
    - **Fechas del ejercicio:** "Las fechas del ejercicio en Ajustes ya no se editan una vez
      que hay movimientos."
  - [ ] `docs/modules/accounting.md` §Cierre de Ejercicio (`:112-130`) y §Bloqueo de Períodos
        (`:221-243`, tabla nueva: una regla para todos los creadores); sección "Núcleo de asientos"
        (`assertPeriodOpen`, `createJournalEntryTx`, `reverseJournalEntryTx`,
        `getEntryDocumentLink`, mes UTC). `docs/architecture/data-model.md`: invariantes de
        `FiscalYear`/`AccountingPeriod`/`lockedUntilDate` y convención OPENING/CLOSING.
  - [ ] Presentación: `GP/tsk-760.html` (molde `tsk-728.html`) con: qué estaba mal (en simple), qué
        cambia (los 5 textos de arriba + escenarios 1 a 9 de 1.6.2 relevantes según el diagnóstico
        de producción), qué tiene que hacer la clienta después del deploy (revisar borradores en
        meses bloqueados, cerrar los meses en orden antes del primer cierre anual de 2027) y las
        capturas; `node GP/generar-pdf.mjs GP/tsk-760.html
        docs/presentaciones/TSK-760-cierre-contable.pdf`.
- **Archivos:** `GP/capturas-tsk760.mjs`, `GP/tsk-760.html`,
  `docs/presentaciones/TSK-760-cierre-contable.pdf`, `GP/assets/tsk760-*.png` (nuevos);
  `_AccountingGuide.tsx`, `docs/modules/accounting.md`, `docs/architecture/data-model.md`.
- **Criterio de completitud:** capturas 01-10 tomadas y revisadas; PDF generado y abierto; guía
  in-app compila y se ve en `/dashboard/help`; commit
  `docs(accounting): guías, docs y presentación del cierre contable (TSK-760, fase 13)`.

#### Fase 14: Verificación final y notas de deploy

- **Objetivo:** dejar el PR listo para deployar con evidencia.
- **Tareas:**
  - [ ] `npm run check-types` ≤ 219; `npx eslint` de todos los archivos tocados sin errores;
        `npm run test` verde (todo); `npm run build` OK.
  - [ ] Modo producción: `NEXT_PUBLIC_APP_URL=http://localhost:3011 npm run build && npm run
        start -- -p 3011`; con `GP/capturas-tsk760.mjs --prod` disparar asiento manual, registrar,
        movimiento bancario, recurrente, anulación de asiento de factura y cierre anual con
        borradores, y ver el **texto real** en el toast (no el digest redactado).
  - [ ] Recorrer los 7 criterios de aceptación de 1.1 y marcar con qué test/captura se cumple.
  - [ ] Correr `diagnostico-tsk760.sh --local` final y guardar la salida en la sección 5.
  - [ ] Notas de deploy para el PR:
    1. **Antes de deployar:** correr `prisma/scripts/diagnostico-tsk760.sh` en el servidor y
       revisar consultas 0 (el usuario de la migración es dueño de `journal_entries`), 1, 4, 6, 8 y
       13; si 4/6/8 tienen filas, avisar a la clienta con la presentación.
    2. Backup (`pg_dump`) de la base `contable` antes del deploy.
    3. La migración `tsk_760_fiscal_years_backfill` la aplica `docker-entrypoint.sh` al arrancar;
       es idempotente y transaccional; verificar con `sudo docker exec $APP node
       node_modules/prisma/build/index.js migrate status` y revisar el log del contenedor (los
       `NOTICE` con los conteos).
    4. **Después:** volver a correr el diagnóstico (esperado: consultas 2, 6 y 7 vacías salvo
       asientos anteriores al primer ejercicio; triggers habilitados).
    5. Sin permisos ni módulos nuevos; sin variables de entorno nuevas (`TZ` no hace falta: el
       código ya no depende de la zona del servidor).
    6. Comportamiento visible: link al PDF.
  - [ ] Completar sección 5 del `.planes` y el `completion_summary` del ticket (memoria
        `cc-tickets-resueltos-sin-comentarios`).
- **Archivos:** `.planes/tsk-760-cierre-contable.md` (secciones 4 y 5), descripción del PR.
- **Criterio de completitud:** todo lo anterior en verde y documentado; commit
  `chore(accounting): verificación final del cierre contable (TSK-760, fase 14)`.

### 2.2 Orden de ejecución

```
Fase 1 (diagnóstico) ──► [usuario corre en prod] ──┐
Fase 2 (núcleo, TDD) ──────────────────────────────┴─► Fase 3 (migración + Ajustes)
   ──► Fase 4 (manual) ──► Fase 5 (comerciales/equipos) ──► Fase 6 (tesorería) ──► Fase 7 (generadores)
   ──► Fase 8 (meses) ──► Fase 9 (cierre anual) ──► Fase 10 (reversión) ──► Fase 11 (código muerto)
   ──► Fase 12 (ActionResult) ──► Fase 13 (capturas/docs/PDF) ──► Fase 14 (verificación)
```

- Fases 1 y 2 son independientes y pueden ir en paralelo; la 3 necesita el núcleo
  (`ensureFiscalYearTx` en `saveAccountingSettings`) y, idealmente, la salida de producción.
- Fases 4 a 7 dependen de 2 y 3 y entre sí solo por conflictos de archivo (se pueden paralelizar
  4/5/6/7 en ramas cortas si hace falta, pero en un solo PR conviene secuencial).
- Fase 8 depende de 4 (`postJournalEntryTx`). Fase 9 depende de 8 (meses cerrados) y de 3.
- Fase 10 depende de 2; va después de 9 porque bloquea anular cierres/aperturas.
- Fase 12 va al final de lo funcional para tocar cada componente una sola vez.
- Fase 13 necesita todo el comportamiento final; Fase 14 cierra.

### 2.3 Estimación de complejidad

| Fase | Complejidad | Motivo |
|---|---|---|
| 1. Diagnóstico | Baja | SQL ya probado; empaquetado y modos |
| 2. Núcleo | **Alta** | Lock, concurrencia, UTC, creación de FY hacia adelante; base de todo |
| 3. Migración | **Alta** | SQL a mano sobre datos reales, trigger, idempotencia, escenarios |
| 4. Manual | Media | Dos actions y limpieza de validadores |
| 5. Comerciales/equipos | Media | Un helper común + depreciación; muchos tests existentes |
| 6. Tesorería | Media | Tres caminos con numeración propia en un archivo grande |
| 7. Generadores | Media | Cinco actions, tres sin UI |
| 8. Meses | **Alta** | Reglas secuenciales, D2-b, UI nueva partida |
| 9. Cierre anual | **Alta** | Asientos POSTED inmutables, B18-B21 tocan reportes |
| 10. Reversión | Media | Helper nuevo de vínculos + copia completa |
| 11. Código muerto | Baja | Borrado con grep |
| 12. ActionResult | Media | Mecánico pero 7 actions/7 componentes |
| 13. Capturas/docs/PDF | Media | Siembra de escenarios y texto para la clienta |
| 14. Verificación | Media | Build de prod y deploy notes |

Total coherente con los ~12 puntos de 1.7 (escala de 758): el grueso del riesgo está en 2, 3, 8 y 9.

### 2.4 Fuera de alcance

- Sigue en **TSK-758**: `replaceDocumentEntryTx`, la matriz de modificación por documento,
  "todo es modificable salvo período cerrado" y los bugs **B11 a B17** (entre ellos B12: anular
  factura/compra/gasto no revierte el asiento). Hasta 758, varios documentos no tienen cómo
  anularse (lo dice la presentación).
- Vínculos persistidos asiento ↔ documento para bancos, transferencias y baja de equipo, y la
  relación declarada de `FundMovement.journalEntryId` (758 fase 1).
- Fecha de la reversión "igual a la del original" para documentos (758 1.8-4).
- Asiento de cierre patrimonial "ortodoxo" (D7 se resuelve por exclusión en reportes).
- Período `ADJUSTMENT` (nadie lo crea).
- Bancos sin Ajustes contables: se mantiene que no generan asiento.
- Refactor de componentes ya excedidos de 200 líneas (`_CreateEntryModal`, `_EntriesTable`,
  `_AccountBalancesForm`, `_BankTransferDialog`, `_CreateBankMovementDialog`,
  `_RecurringEntriesTable`).
- UI para IVA, diferencia de cambio e inflación.
- Normalizar las fechas de `journal_entries.date` guardadas a 03:00 UTC o con hora real (se
  interpretan por día UTC; no se reescriben).

## 3. Diseño
_Pendiente - ejecutar `/disenar tsk-760-cierre-contable`_

## 4. Implementación
_Pendiente - ejecutar `/implementar tsk-760-cierre-contable`_

## 5. Verificación
_Pendiente - ejecutar `/verificar tsk-760-cierre-contable`_
