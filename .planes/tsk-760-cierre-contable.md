# TSK-760 — Cierre contable: el cierre anual no funciona y el bloqueo de períodos se saltea

**Fecha de inicio:** 2026-10-06
**Estado:** Completado — pendiente diagnóstico de producción antes del deploy (verificación: APROBADO CON CONDICIONES, ver §5.6)

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
| D5 revisado | (Líder, Fase 12) **"Hoy" = día calendario en `America/Argentina/Buenos_Aires`**, representado como ese día a 00:00Z (D8). Vale para todo lugar del servidor que toma "hoy" para fechar un asiento o decidir un vencimiento. Helper puro `todayBusinessDayUtc(now?)` / `todayBusinessDay(now?)` en `UT/utc-month.ts`, zona en la constante única `BUSINESS_TIME_ZONE`, con `Intl.DateTimeFormat` (sin `moment-timezone`, que no está instalado). Motivo: a las 22:40 AR la reversión salía fechada el día siguiente. |
| D6 | Se bloquea anular desde Asientos lo vinculado por FK (8 tablas de 1.2.5, incluida la columna sin relación de `FundMovement`) y los asientos de cierre/apertura de FY. Los `createdBy='system'` sin vínculo (bancos, transferencias, baja de equipo) se permiten con advertencia en el diálogo. IVA, cambio, inflación, recurrentes y apertura manual, sin restricción. |
| D7 | B18 a B21 entran. **[simple]** B18 por **exclusión**: los saldos acumulados (`UT/balances.ts`, saldo anterior del Mayor) excluyen los asientos que son `openingEntryId` de un FY con `closingEntryId` no nulo del FY anterior (apertura generada por cierre); se ven en el Diario. No se genera asiento de cierre patrimonial. B19: el Estado de Resultados, Presupuesto vs. real y movimientos por centro de costo excluyen los `closingEntryId`. B20: sin saldos de resultado → `BusinessError` "no hay asientos registrados con resultado en el ejercicio N° X: registrá los borradores". B21: la apertura se calcula **después** de la refundición, dentro de la tx, y `createJournalEntryTx` verifica balance (|debe − haber| < 0,01) para todo asiento que nace POSTED o se registra. |
| D8 | Todo cálculo de mes y rango en **UTC** (`moment.utc`) y comparación por día calendario UTC. `closeAccountingPeriod`/`reopenAccountingPeriod` reciben `{ year, month }`; el servidor deriva el fin de mes. La grilla se arma desde los `AccountingPeriod` del FY. **[simple]** Fechas de FY nuevas: `startDate` = 00:00:00.000 UTC del primer día y `endDate` = 23:59:59.999 UTC del último (así funcionan las consultas existentes con `gte/lte`); el backfill normaliza también los FY de la migración 20260625. |
| D9 | Helpers en `UT/` (`period-lock.ts`, `journal-entry-tx.ts`, `entry-document-link.ts`, `utc-month.ts`) y reexportados por `INT/` para `commercial/` y `equipment/`, como hoy. |
| D10 | Cierre y reapertura de meses: `accounting.settings` `update`. "Registrar y cerrar": además `accounting.entries` `approve`. Cierre anual: `accounting.fiscal-year-close` `approve`. Sin permisos nuevos. |
| D11 | Con FY existentes, las fechas de ejercicio de Ajustes son de solo lectura y se muestran desde el FY abierto más antiguo. Editables solo si hay un único FY sin asientos ni meses cerrados; en ese caso se regeneran sus períodos en la misma tx. |
| D12 | `assertPeriodOpen(tx, companyId, date, { periodType: 'OPENING' \| 'CLOSING' })` solo mira FY no cerrado y período de ese tipo abierto. Lo usa solo `closeFiscalYear`. Convención de OPENING/CLOSING: la del código (mes real de inicio y de fin); el backfill corrige `month = 0/13` de la migración 20260625. |
| D13 | Se **borran** `INT/treasury/index.ts` y `createJournalEntryForCOGS` (sin callers). |
| C1–C8 | Decisiones de Diseño confirmadas por el líder el 2026-10-06: ver 3.7.7. C1–C5, C7 y C8 tal como propone el diseño; C6 cambia: se agrega "Eliminar borrador" (Fase 10). |

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
  - [x] Crear `prisma/scripts/diagnostico-tsk760.sh` (ejecutable, `set -euo pipefail`) con el SQL
        de §1.6.3, en el formato de `prisma/scripts/verificacion-post-deploy.sh`
        (`sudo docker exec -i $(sudo docker ps -q --filter name=contablemas-contablemas) sh -c
        'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -P pager=off' <<'SQL'`). **Solo `SELECT`**:
        el script abre con `SET default_transaction_read_only = on;`.
  - [x] Modos: sin argumento = producción; `--local` = `docker exec -i contable-pms-db` sin
        `sudo` (mismo `sh -c 'psql …'`, usa las variables del contenedor); `--db <nombre>` para
        correrlo contra otro contenedor y `--database <base>` para otra base del mismo
        contenedor (la copia `contable_tsk760_copia` de la Fase 3 es una base, no un contenedor). Cabecera con uso y cómo leer cada consulta (texto de
        "Cómo leerlo" de §1.6.3).
  - [x] Agregar las consultas: 0) `current_user`, dueño de `journal_entries`
        (`pg_tables.tableowner`) y estado de los triggers (`pg_trigger.tgenabled`) — la migración
        hace `ALTER TABLE … DISABLE TRIGGER` y necesita ser dueña; 12) FY con `month = 0/13` y FY
        cuyo rango no coincide con Ajustes; 13) asientos anteriores al inicio de Ajustes con
        fecha de los últimos 90 días (impacto de D1).
  - [x] Al principio, instrucciones (B22): `sudo docker exec $(sudo docker ps -q --filter
        name=contablemas-frontend) sh -c 'date; printenv TZ'` (en modo producción lo ejecuta; en
        `--local` imprime `date` del host y `TZ`).
  - [x] Probar `--local` contra `contable-pms-db` y comparar con 1.2.7. Borrar antes el asiento
        local de debug **999999** (solo dato local; anotarlo en la sección 4). **No se borró**:
        con C1 no hace falta para migrar y sirve de caso real de "número aislado" (ver sección 4).
  - [x] Medir línea base: `npm run check-types 2>&1 | grep -c "error TS"` (219), `npm run test`
        (anotar cuántos pasan), `npx eslint` de los archivos a tocar. Registrar en la sección 4.
  - [x] Pedir al usuario que corra el script en producción y pegue la salida en la sección 4
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
  - [x] `UT/utc-month.test.ts` (rojo) y `UT/utc-month.ts`: `toUtcDay(date)`,
        `monthKeyUtc(date)` → `{ year, month }`, `endOfMonthUtc({ year, month })`,
        `isOnOrBeforeDayUtc(a, b)`, `monthsBetweenUtc(start, end)` (lista de meses del FY,
        irregulares incluidos), `formatMonth({ year, month })` → `MM/YYYY`. Casos: día 1 00:00Z y
        02:59Z caen en el mes del día 1 (B22); fin de mes de febrero bisiesto; FY irregular de 18
        meses; `TZ=America/Argentina/Buenos_Aires` y `TZ=UTC` dan lo mismo (correr el test con
        ambas en el script de `vitest`, o fijar `process.env.TZ` en el test).
  - [x] `UT/period-lock.test.ts` (puro) y `UT/period-lock.ts`: función pura
        `evaluatePeriodClosure({ date, fiscalYear, period, lockedUntilDate })` → `{ closed: false }
        | { closed: true, reason: 'FISCAL_YEAR' | 'PERIOD' | 'LOCKED_UNTIL' }` y
        `buildPeriodClosedMessage(date, reason, fyNumber)`. Casos: cada condición sola; OR de las
        tres con datos desincronizados (escenarios 1 y 2 de 1.6.2); día exacto de `lockedUntilDate`
        con hora 02:59:59.999 (cerrado).
  - [x] `UT/period-lock.ts`: `ensureFiscalYearTx` (D1) y `assertPeriodOpen` (lock `FOR UPDATE`
        sobre `accounting_settings`, D12 con `periodType`). `UT/journal-entry-tx.ts`:
        `nextEntryNumberTx`, `createJournalEntryTx`, `postJournalEntryTx` y la validación pura
        `validateEntryLines(lines, { requireBalance })` (en `UT/journal-entry-lines.ts` con su
        `.test.ts`: 0/0, negativos, desbalance, tolerancia 0,01).
  - [x] `UT/period-lock.integration.test.ts` contra la DB local, empresa propia con Ajustes:
        sin FY → crea FY 1 al pedir una fecha del rango de Ajustes; fecha del FY siguiente → lo
        crea contiguo con sus períodos; dos ejercicios adelante → rechaza; anterior al primero →
        rechaza con el texto de D1; mes cerrado / FY cerrado / `lockedUntilDate` → rechaza con el
        mes y la causa; OPENING/CLOSING (D12).
  - [x] `UT/journal-entry-tx.integration.test.ts`: número correlativo; **concurrencia**: 10
        `createJournalEntryTx` en paralelo (`Promise.all` de `$transaction`) → números únicos y
        contador = 10; cierre de mes concurrente con creación (una tx cierra con `FOR UPDATE`
        tomado, la otra espera y falla con "período está cerrado"); POSTED desbalanceado →
        `BusinessError`; `fiscalYearId`/`periodId` siempre cargados; copia de auxiliares, moneda y
        `costCenterId`.
  - [x] Reexportar desde `INT/index.ts` lo que usan `commercial/` y `equipment/` (D9).
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
  - [x] `npx prisma migrate dev --create-only --name tsk_760_fiscal_years_backfill` y escribir el
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
  - [x] Probar **antes de aplicar** sobre una copia: `docker exec contable-pms-db pg_dump` →
        `createdb contable_tsk760_copia` → restaurar; sembrar escenarios con
        `prisma/scripts/tsk760-escenarios-migracion.sql` (nuevo, solo local): (a) empresa sin FY
        con ejercicio vencido; (b) FY de 20260625 con `lockedUntilDate` y meses `is_closed=false`
        (escenario 1); (c) meses `is_closed=true` y `lockedUntilDate` nulo (escenario 2); (d) DRAFT
        y POSTED en meses que quedan cerrados; (e) asientos anteriores al primer FY y posteriores
        al último; (f) hueco (marzo cerrado, febrero abierto); (g) FY cerrado con un mes abierto.
        Correr `DATABASE_URL=…/contable_tsk760_copia npx prisma migrate deploy` **dos veces**
        (idempotencia: la segunda no cambia nada, comparar `diagnostico-tsk760.sh --db` antes y
        después), y verificar que los triggers quedan `tgenabled = 'O'`.
  - [x] ~~Test de regresión de la migración~~ (reemplazado por `prisma/scripts/tsk760-escenarios-verificar.sql`, ver sección 4): `ACC/features/fiscal-year-close/fy-backfill.integration.test.ts`
        siembra los escenarios (a)-(g) en empresas propias, ejecuta el `migration.sql` con un
        cliente `pg` (consulta simple multi-sentencia) y verifica el resultado; una segunda
        ejecución no cambia filas.
  - [x] Recién entonces `npm run db:migrate` (se usó `migrate deploy`: drift ajeno, ver sección 4) (aplica en `contable-pms-db`); **nunca**
        `migrate reset`. Si hay drift ajeno: `npx prisma migrate status` y frenar.
  - [x] B23/D11 en `ACC/features/settings/actions.server.ts` `saveAccountingSettings`: en la
        misma tx, si no hay FY → `ensureFiscalYearTx` con el rango (FY 1); si hay FY y cambian las
        fechas → solo permitido con un único FY sin asientos ni meses cerrados (regenera sus
        períodos), si no `BusinessError`; pasa a `ActionResult`. `getAccountingSettings` devuelve
        también `fiscalYearLocked: boolean` y el rango del FY abierto más antiguo.
  - [x] Formulario de Ajustes (componente de fechas de ejercicio en `ACC/features/settings/components/`):
        fechas de solo lectura con la leyenda "Las fechas salen del ejercicio N° X; se cambian
        cerrando el ejercicio", y manda `YYYY-MM-DD` (sin `new Date('…T00:00:00')` local, B22).
  - [x] Tests: `ACC/features/settings/accounting-settings.integration.test.ts`: primera vez crea
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
  - [x] `ACC/features/entries/actions.server.ts` `createJournalEntry`: todo dentro de una tx con
        `createJournalEntryTx` (DRAFT); el `companyId` sale de `getActiveCompanyId()`, no del
        cliente.
  - [x] `postJournalEntry`: `postJournalEntryTx` (valida FY cerrado + mes + bloqueo y balance; B4).
  - [x] `ACC/features/entries/validators/index.ts`: borrar `validatePeriodLock`,
        `validateJournalEntryDate` y `resolveFiscalPeriod` (o dejarlos delegando si quedan
        callers fuera de este ticket; grep antes). `ACC/shared/validators/index.ts:128`: borrar el
        duplicado si no se usa (verificar `accounts/actions.server.ts:23`), o delegarlo.
  - [x] `ACC/features/entries/entries.integration.test.ts` (nuevo): crea DRAFT con FY/período y
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
  - [x] `INT/commercial/index.ts` helper común (`:198`): reemplazar el chequeo de
        `lockedUntilDate`, el resolver de período con `moment()` local y la numeración por
        `createJournalEntryTx`. Venta, compra, recibo, OP y gasto heredan.
  - [x] `INT/equipment/index.ts` (`:64`): ídem.
  - [x] `DEP/actions.server.ts`: `postEntryTx` (`:692`), `postDepreciationEntry` (`:795`, mover el
        chequeo de `:842-849` dentro de la tx), `createValueAdjustment` (`:990`, ídem `:1057-1064`)
        y `resolveFiscalPeriodTx` (`:45`, borrar). `postAllPendingDepreciations` (`:871`): los
        períodos cerrados dejan de filtrarse en silencio y se informan en `errors[]` con el mes
        (escenario 10).
  - [x] Tests: los existentes que esperan "período está cerrado" (`receipt-journal-entry`,
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
  - [x] `TRE/fund-movements/list/actions.server.ts` `createJournalEntryForFundMovement` (`:447`):
        `createJournalEntryTx` (deja de usar `lastEntryNumber + 1`).
  - [x] `TRE/bank-movements/actions.server.ts`: `createJournalEntryForBankMovement` (`:162`),
        transferencia banco → banco (`:1026`/`:1117`) y banco ↔ caja (`:1232`) con
        `createJournalEntryTx`. Se conserva "sin Ajustes no hay asiento" (2.0), pero con Ajustes y
        período cerrado se rechaza el movimiento entero (no se graba el movimiento sin asiento).
  - [x] Tests: `fund-movement-lines.integration.test.ts` + caso mes cerrado y numeración; nuevo
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
  - [x] `ACC/features/recurring-entries/actions.server.ts` `generateRecurringEntry` (`:177`) y
        `generateAllPendingRecurringEntries` (`:269`, el período cerrado va a `errors[]` con el mes).
  - [x] `ACC/features/opening-balances/actions.server.ts` `saveOpeningBalanceEntry` (`:312`):
        POSTED, con `periodType: 'OPENING'` del FY de la fecha y balance verificado.
  - [x] `ACC/features/vat-settlement/actions.server.ts` (`:102`),
        `ACC/features/exchange-rates/actions.server.ts` (`:254`),
        `ACC/features/inflation-adjustment/actions.server.ts` (`:258`): `createJournalEntryTx`
        (sin UI, migración barata, R1).
  - [x] Tests nuevos `ACC/features/{recurring-entries,opening-balances}/*.integration.test.ts`
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
  - [x] `ACC/features/settings/actions.server.ts`: reemplazar `setLockedPeriod` por
        `closeAccountingPeriod({ year, month, postDrafts })` y `reopenAccountingPeriod({ year,
        month })`, ambas `ActionResult`, con `checkPermission('accounting.settings', 'update')`
        (+ `accounting.entries` `approve` si `postDrafts`, D10). Reglas: solo el primer MONTHLY
        abierto se cierra; solo el último cerrado se reabre; nunca uno de un FY cerrado (piso, B5);
        `lockedUntilDate` recalculado en la misma tx tras `FOR UPDATE`. Con DRAFT en el mes y sin
        `postDrafts` → `BusinessError` con cantidad y primeros números; con `postDrafts` →
        `postJournalEntryTx` de cada uno o aborta todo (D2).
  - [x] `getPeriodLockStatus()` (reemplaza `getLockedPeriod`): meses del FY abierto más antiguo y
        del siguiente si existe, desde `AccountingPeriod`, con `isClosed`, `draftCount`,
        `canClose`, `canReopen` y el motivo (`reason`) cuando no se puede.
  - [x] UI: partir `_PeriodLockingForm.tsx` (238) en `_PeriodLockingPanel.tsx` (lista de meses
        con `useQuery(['periodLockStatus'])`), `_PeriodMonthRow.tsx` y `_ClosePeriodDialog.tsx`
        (`AlertDialog`: "Marzo 2026 tiene 4 borradores" + botón "Registrar los 4 borradores y
        cerrar"), y hook `usePeriodLockMutations.ts`; todos < 200 líneas;
        `toast.error(result.error)`. `AccountingSettings.tsx` deja de pasar el rango de Ajustes.
  - [x] `ACC/features/settings/period-lock.integration.test.ts`: cerrar en orden; cerrar fuera de
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
  - [x] `ACC/features/fiscal-year-close/actions.server.ts` `closeFiscalYear` → `ActionResult`:
        FY por id del FY abierto más antiguo (no por solapamiento con Ajustes); exige todos los
        MONTHLY cerrados (B1, mensaje con los meses abiertos) y **ningún DRAFT** en el rango
        (A5/B4, cantidad por mes y primeros números); preview **dentro** de la tx; refundición con
        `createJournalEntryTx(…, { periodType: 'CLOSING', status: 'POSTED' })`; sin saldos de
        resultado → `BusinessError` (B20); apertura calculada **después** de la refundición, con
        `periodType: 'OPENING'` y balance verificado (B21); FY siguiente con `ensureFiscalYearTx`
        (reutiliza si existe, B24; meses en UTC, sin los 13 meses); `isClosed`, `closedAt`,
        `closingEntryId`, `openingEntryId`; `lockedUntilDate` y Ajustes al FY nuevo.
  - [x] `previewFiscalYearClose` / `getFiscalYearStatus`: mismos cálculos compartidos (función
        `computeClosePreviewTx`); el status informa meses abiertos y DRAFT pendientes.
  - [x] B18: `UT/balances.ts` (`calculateAllAccountBalances`, `calculateOpeningBalance` y
        afines) y el saldo anterior del Mayor (`ACC/features/reports/actions.server.ts:233`)
        excluyen las aperturas generadas por cierre (helper `getClosingGeneratedEntryIds(companyId)`
        en `UT/`). B19: Estado de Resultados (`:508-541`), Presupuesto vs. real y movimientos por
        centro de costo excluyen los `closingEntryId`.
  - [x] UI: `_ClosePreviewDialog.tsx` (215) pasa a `useQuery(['fiscalYearClosePreview'])` (fuera
        el `useEffect`) y se parte en `_ClosePreviewDialog.tsx` + `_ClosePreviewTables.tsx` < 200;
        `_FiscalYearStatus.tsx` muestra meses abiertos y DRAFT pendientes con link a Bloqueo de
        períodos y Asientos.
  - [x] `ACC/features/fiscal-year-close/fiscal-year-close.integration.test.ts`: con meses
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
  - [x] `UT/entry-document-link.ts`: `getEntryDocumentLink(tx, entryId)` → `{ kind, label,
        number } | null` sobre las 8 tablas de 1.2.5 (incluida `fund_movements.journal_entry_id`
        sin relación) y `fiscal_years.closing/opening_entry_id`. `getEntriesWithoutDocuments`
        (`ACC/features/reports/actions.server.ts:623`) lo reutiliza.
  - [x] `UT/journal-entry-tx.ts` `reverseJournalEntryTx(tx, { companyId, entryId, date,
        createdBy })` (**hecho en la Fase 7** para B25, con tests; acá solo se usa): valida período del original y de la fecha de reversión, crea el asiento con
        todas las columnas de línea invertidas (auxiliares, `costCenterId`, moneda) vía
        `createJournalEntryTx`, y pasa el original a REVERSED con `reversalEntryId` en **un solo**
        `UPDATE` (trigger).
  - [x] `ACC/features/entries/actions.server.ts` `reverseJournalEntry` → `ActionResult`: si hay
        documento vinculado → `BusinessError` "Este asiento es de la factura A-0001-00000012:
        anulalo desde el comprobante". `getReversalWarning(entryId)` para los `system` sin vínculo
        (D6).
  - [x] `_ReverseEntryDialog.tsx`: `useQuery` del aviso + `toast.error(result.error)`.
  - [x] **C6 — "Eliminar borrador"** (decisión del líder, 3.7.7): `deleteDraftJournalEntry(entryId)`
        en `ACC/features/entries/actions.server.ts` → `ActionResult`, con
        `checkPermission('accounting.entries', 'delete')` (el permiso existe: `ACTIONS.delete` es
        genérico en `src/shared/lib/permissions/constants.ts` y `accounting.entries` es módulo).
        Solo asientos `DRAFT` de la empresa activa **sin documento vinculado**
        (`getEntryDocumentLink` nulo); si no → `BusinessError` ("solo se eliminan borradores
        manuales" / mensaje de documento). Borra líneas y cabecera en una tx (el trigger permite
        DELETE de DRAFT). No valida período: su fin es destrabar el cierre de un mes con un
        borrador imposible de registrar (H9). En `_EntriesTable.tsx`, acción "Eliminar borrador"
        con `AlertDialog`, visible con `hasPermission('accounting.entries', 'delete')` y estado
        DRAFT (sin crecer más de 3-4 líneas: el diálogo va en `_DeleteDraftEntryDialog.tsx`). El
        mensaje de "Registrar y cerrar" (Fase 8) que nombra el borrador trabado sugiere
        eliminarlo si es manual. Va en esta fase porque depende de `getEntryDocumentLink`.
        Test en `reverse-entry.integration.test.ts` (o `delete-draft-entry.integration.test.ts`):
        borra DRAFT manual; rechaza POSTED, DRAFT de factura/gasto/fondos y de otra empresa.
  - [x] `ACC/features/entries/reverse-entry.integration.test.ts`: copia auxiliares, moneda y
        centro de costo; original en mes cerrado → rechaza; hoy en mes cerrado → rechaza; asiento
        de factura / gasto / fondos / cierre → rechaza nombrando el documento; manual → anula.
- **Archivos:** `UT/entry-document-link.ts` (nuevo), `UT/journal-entry-tx.ts`,
  `ACC/features/entries/actions.server.ts`, `_ReverseEntryDialog.tsx`, `_EntriesTable.tsx`,
  `_DeleteDraftEntryDialog.tsx` (nuevo, C6),
  `ACC/features/reports/actions.server.ts`, test nuevo.
- **Criterio de completitud:** criterio de aceptación 6 cubierto por test; commit
  `fix(accounting): la anulación de asientos copia todo y respeta documentos y períodos (TSK-760, fase 10)`.

#### Fase 11: Borrado de código muerto (B9, D13)

- **Objetivo:** que no quede ningún creador que calle errores.
- **Tareas:**
  - [x] Borrar `INT/treasury/index.ts` (y su export) y `createJournalEntryForCOGS`
        (`INT/commercial/index.ts:1204`), previa confirmación con grep de que no hay callers
        (incluido `src/app`, `prisma/` y tests).
  - [x] `grep -rn "return null" ` en los creadores restantes: ningún camino de asiento devuelve
        `null` ante error; `grep -rn "journalEntry.create(\|lastEntryNumber + 1" src/modules` →
        solo `UT/journal-entry-tx.ts`.
- **Archivos:** `INT/treasury/index.ts` (borrado), `INT/commercial/index.ts`, `INT/index.ts`.
- **Criterio de completitud:** greps limpios; tipos ≤ 219; tests verdes; commit
  `refactor(accounting): borrar creadores de asientos sin uso que callaban errores (TSK-760, fase 11)`.

#### Fase 12: Errores legibles en producción (`ActionResult`) en las actions restantes

- **Objetivo:** el "período está cerrado" llega legible en producción desde todas las pantallas.
- **Tareas:**
  - [x] Pasar a `Promise<ActionResult<…>>` con `BusinessError` + `toActionResult`:
        `createJournalEntry`, `postJournalEntry` (`ACC/features/entries/actions.server.ts`),
        `createBankMovement`, `createBankTransfer` (`TRE/bank-movements/actions.server.ts`;
        **ya hechas en la Fase 6**, junto con sus dos diálogos),
        `generateRecurringEntry`, `generateAllPendingRecurringEntries`,
        `saveOpeningBalanceEntry`. Junto con `closeAccountingPeriod`/`reopenAccountingPeriod`
        (Fase 8), `closeFiscalYear` (Fase 9) y `reverseJournalEntry` (Fase 10) quedan las 9 de
        1.2.6.
  - [x] Adaptar los 7 componentes restantes (`if (!result.success) toast.error(result.error)`):
        `_CreateEntryModal`, `_PostEntryDialog`, `_RecurringEntriesTable`, `_GeneratePendingDialog`,
        `_AccountBalancesForm`, `_CreateBankMovementDialog`, `_BankTransferDialog` (los excedidos
        no crecen más de 3-4 líneas). Con `_ReverseEntryDialog`, `_ClosePreviewDialog` y el panel
        de bloqueo, son los 10 de 1.2.6.
  - [x] Actualizar los tests de las fases 4, 6 y 7 de `rejects.toThrow` a
        `{ success: false, error: expect.stringContaining('el período está cerrado') }`.
  - [x] **D5 revisado** (líder): "hoy" del servidor = día calendario de Argentina
        (`todayBusinessDayUtc`, `UT/utc-month.ts`) en todo lugar de la rama que fecha un asiento
        o decide un vencimiento con `new Date()`.
- **Archivos:** las 3 actions y los 7 componentes; tests de fases 4, 6 y 7.
- **Criterio de completitud:** `grep -n "throw new Error" ` en esas actions solo deja errores
  técnicos; tests verdes; tipos ≤ 219; eslint limpio; commit
  `fix(accounting): mensajes de período cerrado legibles en producción (TSK-760, fase 12)`.

#### Fase 13: Capturas, documentación, guía in-app y presentación

- **Objetivo:** que la clienta entienda qué cambia antes de que le pase, y que el equipo tenga la
  documentación al día.
- **Tareas:**
  - [x] `GP/capturas-tsk760.mjs` (molde `capturas-tsk728.mjs`, puerto 3010 con override de
        `NEXT_PUBLIC_APP_URL`, memoria `dev-local-capturas-y-login`), sembrando por SQL una empresa
        demo con FY y borradores marcados `TSK760-demo`: 01 lista de meses del bloqueo; 02
        diálogo "Marzo tiene N borradores → Registrar y cerrar"; 03 toast al registrar un asiento
        en mes cerrado; 04 reapertura bloqueada en el primer mes del ejercicio nuevo; 05 estado del
        cierre anual con meses abiertos y borradores; 06 cierre anual ejecutado (refundición y
        apertura); 07 Balance después del cierre (sin duplicar); 08 anular asiento de factura →
        mensaje; 09 aviso al anular un movimiento bancario; 10 fechas de ejercicio de solo lectura
        en Ajustes; 11-12 (`--prod`) toasts de bloqueo contra el build en :3011. `--restore`.
  - [x] Guía in-app `src/modules/help/features/guide/components/_AccountingGuide.tsx`: reescribir
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
  - [x] `docs/modules/accounting.md` §Cierre de Ejercicio (`:112-130`) y §Bloqueo de Períodos
        (`:221-243`, tabla nueva: una regla para todos los creadores); sección "Núcleo de asientos"
        (`assertPeriodOpen`, `createJournalEntryTx`, `reverseJournalEntryTx`,
        `getEntryDocumentLink`, mes UTC). `docs/architecture/data-model.md`: invariantes de
        `FiscalYear`/`AccountingPeriod`/`lockedUntilDate` y convención OPENING/CLOSING.
  - [x] Presentación: `GP/tsk-760.html` (molde `tsk-728.html`) con: qué estaba mal (en simple), qué
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
  - [x] `npm run check-types` ≤ 219; `npx eslint` de todos los archivos tocados sin errores;
        `npm run test` verde (todo); `npm run build` OK. (eslint: 1 error **previo** en `UT/index.ts`, ver §5.2.)
  - [x] Modo producción: `NEXT_PUBLIC_APP_URL=http://localhost:3011 npm run build && npm run
        start -- -p 3011`; con `GP/capturas-tsk760.mjs --prod` disparar asiento manual, registrar,
        movimiento bancario, recurrente, anulación de asiento de factura y cierre anual con
        borradores, y ver el **texto real** en el toast (no el digest redactado).
  - [x] Recorrer los 7 criterios de aceptación de 1.1 y marcar con qué test/captura se cumple.
  - [x] Correr `diagnostico-tsk760.sh --local` final y guardar la salida en la sección 5.
  - [x] Notas de deploy para el PR:
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
  - [x] Completar sección 5 del `.planes`.
  - [ ] `completion_summary` del ticket (memoria `cc-tickets-resueltos-sin-comentarios`): **pendiente**,
        depende del diagnóstico de producción y del deploy (el resumen tiene que decir qué pasó en prod).
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

Rutas abreviadas como en 2 (`ACC/`, `UT/`, `INT/`, `TRE/`, `DEP/`, `GP/`). Todo lo que sigue se
verificó contra el código de la rama (2026-10-06); las líneas citadas son las de hoy.

**Hallazgos de esta etapa que cambian o precisan el plan** (detalle en cada sección):

| # | Hallazgo | Dónde | Efecto en el diseño |
|---|---|---|---|
| H1 | Prisma 7 **no** envuelve la migración en una transacción en PostgreSQL (lo hace recién Prisma 8; verificado con `ctx7`, docs `/prisma/web`). | `docker-entrypoint.sh:16` corre `migrate deploy` | La migración abre y cierra `BEGIN; … COMMIT;` explícitos. `ALTER TABLE … DISABLE TRIGGER` es DDL transaccional: si algo falla, el trigger queda habilitado. |
| H2 | **B25 (nuevo):** "Editar" el asiento de saldos de apertura borra las líneas de un asiento POSTED (`deleteMany` + `update`), y el trigger `trg_journal_entry_line_immutable` lo rechaza siempre. La edición nunca funcionó. | `opening-balances/actions.server.ts:400-433`, UI `_AccountBalancesForm.tsx:185` | Reemplazar = revertir el asiento vigente + crear uno nuevo, ambos en el período OPENING (3.3.6, #19). |
| H3 | `saveOpeningBalanceEntry` y `getOpeningBalancesPageData` buscan la apertura existente por `date = settings.fiscalYearStart` exacto. Al normalizar las fechas (D8) dejarían de encontrarla y permitirían duplicarla. | `opening-balances/actions.server.ts:112-113`, `:405-406`, `:441-442` | Se busca por `fiscalYearId` del ejercicio + descripción + POSTED. |
| H4 | Las aperturas generadas también distorsionan la **liquidación de IVA** de enero (suma movimientos POSTED del mes sobre cuentas de IVA), la diferencia de cambio y el ajuste por inflación (saldos acumulados), no solo Balance, Sumas y Saldos y Mayor. La refundición distorsiona el control de presupuesto de gastos de diciembre. | `vat-settlement/actions.server.ts:58-79`, `exchange-rates:205-216`, `inflation-adjustment:170-200`, `INT/commercial/index.ts:1130-1145`, `budgets/actions.server.ts:80-95` | La exclusión de D7 se aplica con dos fragmentos SQL compartidos en todas esas consultas (3.3.8). |
| H5 | El cierre anual filtra `a.is_active = true`: una cuenta de resultado desactivada con saldo queda fuera de la refundición (resultado mal calculado) y fuera de la apertura (desbalance). Con ingresos = gastos, la línea de Resultado sale 0/0 y choca con el CHECK. | `fiscal-year-close/actions.server.ts:147`, `:204`, `:183-189` | Sin filtro de cuenta activa; la línea de Resultado se omite si la diferencia es 0. |
| H6 | `saveAccountingSettings` la llama también `_CommercialIntegrationForm` reenviando las fechas del ejercicio leídas de la DB. Con D11 eso mezclaría "guardar cuentas" con "cambiar el ejercicio". | `_CommercialIntegrationForm.tsx:328-339` | Se separa en `saveFiscalYearSettings` (fechas) y `saveAccountingSettings` (solo cuentas). |
| H7 | `entries/validators/index.ts` y `UT/balances.ts` tienen `'use server'`: cada función exportada es un endpoint invocable desde el navegador. | `validators/index.ts:1`, `balances.ts:1` | Los helpers nuevos **no** llevan `'use server'` y abren con `import 'server-only'`. Se quita `'use server'` de `validators/index.ts` (solo lo importan actions). `balances.ts` se deja (fuera de alcance, anotado). |
| H8 | El duplicado `ACC/shared/validators/index.ts:128` (`validateJournalEntryDate`) no tiene callers (`accounts/actions.server.ts` no lo importa). | grep | Se borra. |
| H9 | No hay acción para editar ni eliminar un asiento manual en borrador. Un borrador que no se puede registrar (cuenta que dejó de ser imputable) bloquea para siempre el cierre de su mes con D2 "todo o nada". | `entries/actions.server.ts` | Se mantiene D2, con mensaje que nombra el asiento y la cuenta; ver decisión a confirmar C6. |
| H10 | La transacción interactiva de Prisma corta a los 5 s por defecto: "Registrar N borradores y cerrar" y el cierre anual pueden excederlo. | — | `$transaction(fn, { timeout: 30_000, maxWait: 10_000 })` en esas dos actions. |

### 3.1 Arquitectura de la solución

#### 3.1.1 Capas

```
┌──────────────────────────────── Client Components (prefijo _) ─────────────────────────────────┐
│ _CreateEntryModal  _PostEntryDialog  _ReverseEntryDialog   _PeriodLockingPanel  _ClosePeriodDialog │
│ _ClosePreviewDialog  _FiscalYearStatus  _AccountBalancesForm  _CreateBankMovementDialog  …         │
│        useQuery / useMutation  →  if (!r.success) toast.error(r.error)                             │
└───────────────────────────────────────────────┬───────────────────────────────────────────────────┘
                                                │ Server Actions → ActionResult<T>
┌───────────────────────────────────────────────▼───────────────────────────────────────────────────┐
│ Actions (checkPermission + getActiveCompanyId + prisma.$transaction + toActionResult)              │
│  ACC/entries  ACC/settings (close/reopen mes, ejercicio)  ACC/fiscal-year-close  ACC/recurring …   │
│  INT/commercial · INT/equipment (helpers con tx del llamador)  TRE/fund-movements  TRE/bank-mov.   │
│  DEP/depreciation                                                                                   │
└───────────────────────────────────────────────┬───────────────────────────────────────────────────┘
                                                │ tx: Prisma.TransactionClient (sin $transaction ni permisos propios)
┌───────────────────────────────────────────────▼───────────────────────────────────────────────────┐
│ Núcleo UT/ (server-only)                                                                            │
│  period-lock.ts        lockAccountingSettingsTx · ensureFiscalYearTx · assertPeriodOpen            │
│                        syncLockedUntilDateTx · createFiscalYearWithPeriodsTx                       │
│  journal-entry-tx.ts   nextEntryNumberTx · createJournalEntryTx · postJournalEntryTx               │
│                        reverseJournalEntryTx                                                       │
│  entry-document-link.ts getEntryDocumentLink · entriesWithoutDocumentWhere                          │
│  closing-entries.ts    NOT_CLOSE_GENERATED_OPENING_SQL · NOT_CLOSING_ENTRY_SQL · *Where (Prisma)   │
│ Núcleo UT/ (puro, testeable sin DB, usable en cliente)                                             │
│  utc-month.ts  period-closure.ts  journal-entry-lines.ts  fiscal-year-close-math.ts                │
└───────────────────────────────────────────────┬───────────────────────────────────────────────────┘
                                                │
┌───────────────────────────────────────────────▼───────────────────────────────────────────────────┐
│ PostgreSQL: accounting_settings (fila = lock por empresa + contador) · fiscal_years ·             │
│ accounting_periods · journal_entries/lines (triggers de inmutabilidad, CHECK 0/0)                  │
└───────────────────────────────────────────────────────────────────────────────────────────────────┘
```

Reexportación para otros módulos (D9): `src/modules/accounting/features/integrations/core/index.ts`
(nuevo) reexporta `createJournalEntryTx`, `assertPeriodOpen`, `postJournalEntryTx` y los tipos
`JournalEntryLineDraft`, `CreatedJournalEntry`. `TRE/` y `DEP/` importan de
`@/modules/accounting/features/integrations/core`, igual que hoy importan de `integrations/commercial`
y `integrations/equipment`.

**Regla de lock (única forma de serializar por empresa):** toda operación que crea, registra o
anula asientos, o que cambia el estado de un período, toma **primero** la fila de
`accounting_settings` de la empresa con `SELECT … FOR UPDATE` (`lockAccountingSettingsTx`) y recién
después lee ejercicios y períodos. La numeración (`UPDATE … RETURNING` sobre la misma fila) ya
tomaba ese lock; ahora también lo toman el cierre y la reapertura de meses, el cierre anual y
`saveFiscalYearSettings`. Orden de locks: documentos propios del creador → `accounting_settings` →
períodos/asientos. El cierre de meses no toca documentos, así que no hay ciclo posible.

#### 3.1.2 Flujo "crear asiento" (cualquiera de los 20 caminos)

```
action ─ checkPermission ─ getActiveCompanyId ─ validaciones de solo lectura (cuentas, auxiliares)
  └─ prisma.$transaction(tx =>
       [lógica propia del documento: estados, saldos de banco, etc.]
       createJournalEntryTx(tx, { companyId, date, description, lines, status, createdBy, periodType? })
         ├─ validateEntryLines(lines)                      (puro: ≥2 líneas, sin 0/0, sin negativos, balance)
         ├─ assertAccountsUsableTx(tx, companyId, ids)     (de la empresa y hojas)
         ├─ assertPeriodOpen(tx, companyId, date, { periodType })
         │    ├─ lockAccountingSettingsTx  ── SELECT … FROM accounting_settings … FOR UPDATE
         │    ├─ findFiscalYearForDateTx   ── si no hay: (lockedUntil cubre la fecha → "período cerrado")
         │    │                                          sino ensureFiscalYearTx (crea el siguiente o rechaza)
         │    ├─ findPeriodTx (MONTHLY del mes UTC, u OPENING/CLOSING por tipo); si falta → ensurePeriodsTx
         │    └─ evaluatePeriodClosure (puro, OR de las 3 condiciones) → BusinessError o { fiscalYearId, periodId }
         ├─ nextEntryNumberTx  ── UPDATE accounting_settings … RETURNING (salta números ocupados)
         └─ tx.journalEntry.create({ number, fiscalYearId, periodId, status, postDate?, lines: todas las columnas })
       [documento.journalEntryId = entry.id]
     )
  └─ catch → toActionResult(error, contexto)
```

#### 3.1.3 Flujo "registrar" (DRAFT → POSTED)

```
postJournalEntry(entryId) → $transaction(tx => postJournalEntryTx(tx, { companyId, entryId, userId }))
  ├─ lee el asiento con líneas (de la empresa, DRAFT)
  ├─ assertPeriodOpen(tx, companyId, entry.date)        (incluye FY cerrado: corrige B4)
  ├─ validateEntryLines(lines) + assertAccountsUsableTx
  └─ UPDATE status = POSTED, postDate = now, fiscalYearId/periodId = los resueltos (corrige datos viejos)
```

#### 3.1.4 Flujo "cerrar mes" / "reabrir mes" (A1, D2, D10, B3, B5, B22)

```
closeAccountingPeriod({ year, month, postDrafts })
  ├─ checkPermission(settings, update) [+ (entries, approve) si postDrafts]
  └─ $transaction(tx =>                                        { timeout: 30 s }
       lockAccountingSettingsTx
       candidato = primer MONTHLY abierto de los FY abiertos (orden FY.number, year, month)
       ≠ {year, month} → BusinessError "Solo se puede cerrar el primer mes abierto: MM/YYYY."
       borradores = DRAFT con fecha (día UTC) dentro del mes
       si hay y !postDrafts → BusinessError con cantidad y números
       si postDrafts → para cada borrador (por número): postJournalEntryTx; el primero que falla
                        aborta todo con "No se cerró MM/YYYY: el borrador N° X no se puede registrar. <motivo>"
       UPDATE accounting_periods SET is_closed = true, closed_at, closed_by
       syncLockedUntilDateTx  → locked_until_date = fin UTC del último mes cerrado contiguo
     )

reopenAccountingPeriod({ year, month })
  └─ $transaction(tx =>
       lockAccountingSettingsTx
       el mes pedido pertenece a un FY cerrado → BusinessError (piso, B5)
       candidato = último MONTHLY cerrado de los FY abiertos; ≠ pedido → BusinessError
       UPDATE is_closed = false, closed_at = null, closed_by = null
       syncLockedUntilDateTx  → si no quedan meses cerrados en FY abiertos: fin del último FY cerrado, o NULL
     )
```

#### 3.1.5 Flujo "cerrar ejercicio" (B1, B4, B18–B21, B24, D12)

```
closeFiscalYear({ fiscalYearId })
  ├─ checkPermission(fiscal-year-close, approve)
  └─ $transaction(tx =>                                        { timeout: 30 s }
       lockAccountingSettingsTx
       fy = FY abierto más antiguo; ≠ fiscalYearId → BusinessError; ya cerrado → BusinessError
       MONTHLY abiertos del FY → BusinessError con la lista (B1)
       DRAFT con fecha en el FY → BusinessError con cantidad por mes y números (A5, B4)
       resultAccountId de Ajustes → si falta, BusinessError
       preview = computeClosePreviewTx(tx, companyId, fy)      (mismo cálculo que el preview)
       preview.closingLines vacío → BusinessError (B20)
       closing = createJournalEntryTx(POSTED, date = fin del FY, periodType CLOSING, líneas de refundición)
       next = ensureFiscalYearTx(tx, settings, día siguiente al fin)   (reutiliza si existe: B24; meses UTC)
       opening = preview.openingLines vacío ? null
               : createJournalEntryTx(POSTED, date = inicio de next, periodType OPENING)  (balance verificado: B21)
       UPDATE fiscal_years (fy):   is_closed, closed_at, closed_by, closing_entry_id
       UPDATE accounting_periods:  todos los períodos de fy → is_closed = true
       UPDATE fiscal_years (next): opening_entry_id = opening.id; su OPENING → is_closed = true
       syncLockedUntilDateTx; Ajustes.fiscalYearStart/End = rango del FY abierto más antiguo
     )
```

El orden importa: la refundición se crea con el FY todavía abierto (D12: `CLOSING` exige FY no
cerrado y período CLOSING abierto) y recién después se marca cerrado.

#### 3.1.6 Flujo "revertir" (A4, B10, D5, D6)

```
reverseJournalEntry({ entryId })
  ├─ checkPermission(entries, approve)
  └─ $transaction(tx =>
       link = getEntryDocumentLink(tx, companyId, entryId)
       link ≠ null → BusinessError "Este asiento pertenece a <documento>…" (D6)
       reverseJournalEntryTx(tx, { companyId, entryId, date: hoy UTC 00:00, createdBy: userId })
         ├─ lee original (POSTED, de la empresa) con todas las columnas de línea y el tipo de su período
         ├─ assertPeriodOpen(original.date, { periodType: tipo del período original,
         │                                    subject: "No se puede anular el asiento N° X (fecha DD/MM/YYYY)" })
         ├─ reversal = createJournalEntryTx(POSTED, date, líneas invertidas con auxiliares, costCenterId,
         │                                  currency/originalAmount/exchangeRate, originalEntryId)
         │                (valida el período de la fecha de reversión)
         └─ UPDATE original SET status = REVERSED, reversal_entry_id, reversed_by, reversed_at   (un solo UPDATE)
     )
```

### 3.2 Modelos de datos

#### 3.2.1 Cambios de schema: ninguno

Se evaluó agregar un enum `JournalEntryType` (MANUAL / CLOSING / OPENING_GENERATED…) para
identificar la apertura generada por el cierre (D7) y se descarta: el dato ya existe y es único.

- **Apertura generada por cierre** = asiento cuyo id está en `fiscal_years.opening_entry_id`
  (FK `@unique`, `schema.prisma:713-721`). Hoy solo la escribe `closeFiscalYear`; el saldo de
  apertura manual (#19, descripción `'Asiento de Apertura'`) **no** la usa. Se fija como invariante
  documentado (docs y comentario en `closing-entries.ts`): *`openingEntryId` solo lo escribe
  `closeFiscalYear`*. Test que lo protege en 3.7.
- **Refundición** = asiento cuyo id está en `fiscal_years.closing_entry_id`.
- **Período** de cada asiento especial: refundición → `AccountingPeriod` `CLOSING`; apertura
  generada y saldo de apertura manual → `OPENING`. `periodType` ya existe (`AccountingPeriodType`,
  `schema.prisma:248-253`); `ADJUSTMENT` sigue sin uso.
- Convenciones de datos (sin cambio de tipo de columna):
  - `fiscal_years.start_date` = día UTC 00:00:00.000; `end_date` = último día 23:59:59.999 (D8).
  - `accounting_settings.locked_until_date` = fin UTC (23:59:59.999) del último mes cerrado
    contiguo, o `NULL`. Derivado: solo lo escribe `syncLockedUntilDateTx` (y la migración).
  - `accounting_settings.fiscal_year_start/end` = rango del FY abierto más antiguo (derivado).
  - OPENING/CLOSING: `year`/`month` reales del inicio y del fin del FY (D12).
  - Un FY tiene exactamente un OPENING, un CLOSING y un MONTHLY por mes calendario entre
    `start_date` y `end_date`, ni uno más.

Opcional descartado: relación declarada `FundMovement.journalEntry` (queda en 758; la detección
consulta la columna, 3.3.7).

#### 3.2.2 Migración de datos `tsk_760_fiscal_years_backfill`

Archivo: `prisma/migrations/<timestamp>_tsk_760_fiscal_years_backfill/migration.sql`, creado con
`npx prisma migrate dev --create-only --name tsk_760_fiscal_years_backfill` y escrito a mano.
Propiedades:

- **Transaccional** con `BEGIN;`/`COMMIT;` explícitos (H1). Si falla, Prisma la marca como fallida
  (P3009) pero la base queda como estaba; se corrige y se hace
  `migrate resolve --rolled-back <nombre>` antes de redeployar.
- **Idempotente:** cada paso tiene guarda (`NOT EXISTS`, `ON CONFLICT DO NOTHING`,
  `IS DISTINCT FROM`). Correrla dos veces deja exactamente lo mismo.
- **Segura para producción:** no borra asientos ni líneas; el trigger de inmutabilidad se
  deshabilita solo alrededor del `UPDATE` de `fiscal_year_id`/`period_id` y se rehabilita en la
  misma transacción; no toca `updated_at` de `journal_entries` (auditoría).
- **Funciona sobre una base vacía** (shadow DB de `migrate dev`).
- Informa con `RAISE NOTICE`. **Prisma no garantiza mostrar los NOTICE en el log del
  contenedor**: la verificación oficial es correr el diagnóstico antes y después (3.7.6).
- Requiere ser dueño de `journal_entries` (consulta 0 del diagnóstico). En local el usuario es
  `postgres` (superusuario, dueño); en prod, `$POSTGRES_USER` del contenedor.
- Toma `ACCESS EXCLUSIVE` sobre `journal_entries` por el `ALTER TABLE` mientras dura la
  transacción (segundos). En un deploy con la réplica vieja todavía viva, sus escrituras de asientos
  esperan; no fallan.

```sql
-- TSK-760: ejercicios y períodos para todas las empresas con Ajustes, bloqueo sincronizado
-- (A1/D3), fiscal_year_id/period_id en todos los asientos (D4) y contador de numeración.
-- Idempotente y transaccional. Ver .planes/tsk-760-cierre-contable.md §3.2.2.
BEGIN;

-- ===================================================================================
-- Paso 1: normalizar los ejercicios existentes a días UTC (D8) y OPENING/CLOSING (D12)
-- ===================================================================================
UPDATE fiscal_years
SET start_date = start_date::date,
    end_date   = end_date::date + interval '1 day' - interval '1 millisecond',
    updated_at = now()
WHERE start_date <> start_date::date
   OR end_date <> end_date::date + interval '1 day' - interval '1 millisecond';

UPDATE accounting_periods p
SET year = EXTRACT(YEAR FROM f.start_date)::int, month = EXTRACT(MONTH FROM f.start_date)::int,
    updated_at = now()
FROM fiscal_years f
WHERE f.id = p.fiscal_year_id AND p.type = 'OPENING'
  AND (p.year, p.month) IS DISTINCT FROM
      (EXTRACT(YEAR FROM f.start_date)::int, EXTRACT(MONTH FROM f.start_date)::int);

UPDATE accounting_periods p
SET year = EXTRACT(YEAR FROM f.end_date)::int, month = EXTRACT(MONTH FROM f.end_date)::int,
    updated_at = now()
FROM fiscal_years f
WHERE f.id = p.fiscal_year_id AND p.type = 'CLOSING'
  AND (p.year, p.month) IS DISTINCT FROM
      (EXTRACT(YEAR FROM f.end_date)::int, EXTRACT(MONTH FROM f.end_date)::int);

-- ===================================================================================
-- Paso 2: FY 1 para empresas con Ajustes y sin ejercicios (B2/B23), y ejercicios
--         contiguos de 12 meses hasta cubrir hoy o el último asiento (tope: hoy + 1 año)
-- ===================================================================================
INSERT INTO fiscal_years (id, company_id, number, start_date, end_date, updated_at)
SELECT gen_random_uuid(), s.company_id, 1,
       s.fiscal_year_start::date,
       s.fiscal_year_end::date + interval '1 day' - interval '1 millisecond',
       now()
FROM accounting_settings s
WHERE NOT EXISTS (SELECT 1 FROM fiscal_years f WHERE f.company_id = s.company_id);

DO $$
DECLARE
  r        record;
  last_fy  record;
  v_start  date;
  creados  int := 0;
BEGIN
  FOR r IN
    SELECT s.company_id,
           LEAST(
             GREATEST((now() AT TIME ZONE 'UTC')::date,
                      COALESCE((SELECT max(j.date)::date FROM journal_entries j
                                WHERE j.company_id = s.company_id),
                               (now() AT TIME ZONE 'UTC')::date)),
             ((now() AT TIME ZONE 'UTC') + interval '1 year')::date
           ) AS objetivo
    FROM accounting_settings s
    WHERE EXISTS (SELECT 1 FROM fiscal_years f WHERE f.company_id = s.company_id)
  LOOP
    LOOP
      SELECT id, number, end_date INTO last_fy
      FROM fiscal_years WHERE company_id = r.company_id ORDER BY number DESC LIMIT 1;
      EXIT WHEN last_fy.end_date::date >= r.objetivo;
      v_start := last_fy.end_date::date + 1;
      INSERT INTO fiscal_years (id, company_id, number, start_date, end_date, updated_at)
      VALUES (gen_random_uuid(), r.company_id, last_fy.number + 1, v_start,
              (v_start + interval '12 months') - interval '1 millisecond',
              now());
      creados := creados + 1;
    END LOOP;
  END LOOP;
  RAISE NOTICE 'TSK-760 paso 2: ejercicios siguientes creados: %', creados;
END $$;

-- Períodos: OPENING, un MONTHLY por mes calendario del rango y CLOSING (ON CONFLICT = idempotente)
INSERT INTO accounting_periods (id, fiscal_year_id, year, month, type, is_closed, updated_at)
SELECT gen_random_uuid(), f.id, EXTRACT(YEAR FROM m)::int, EXTRACT(MONTH FROM m)::int,
       'MONTHLY', false, now()
FROM fiscal_years f
CROSS JOIN LATERAL generate_series(date_trunc('month', f.start_date),
                                   date_trunc('month', f.end_date),
                                   interval '1 month') AS m
ON CONFLICT (fiscal_year_id, year, month, type) DO NOTHING;

INSERT INTO accounting_periods (id, fiscal_year_id, year, month, type, is_closed, updated_at)
SELECT gen_random_uuid(), f.id, EXTRACT(YEAR FROM f.start_date)::int,
       EXTRACT(MONTH FROM f.start_date)::int, 'OPENING', false, now()
FROM fiscal_years f
WHERE NOT EXISTS (SELECT 1 FROM accounting_periods p
                  WHERE p.fiscal_year_id = f.id AND p.type = 'OPENING');

INSERT INTO accounting_periods (id, fiscal_year_id, year, month, type, is_closed, updated_at)
SELECT gen_random_uuid(), f.id, EXTRACT(YEAR FROM f.end_date)::int,
       EXTRACT(MONTH FROM f.end_date)::int, 'CLOSING', false, now()
FROM fiscal_years f
WHERE NOT EXISTS (SELECT 1 FROM accounting_periods p
                  WHERE p.fiscal_year_id = f.id AND p.type = 'CLOSING');

-- MONTHLY fuera del rango del FY (20260625 creaba siempre 12; el bug de 13 meses de
-- closeFiscalYear): se borran solo si ningún asiento los referencia.
DELETE FROM accounting_periods p
USING fiscal_years f
WHERE f.id = p.fiscal_year_id AND p.type = 'MONTHLY'
  AND (make_date(p.year, p.month, 1) < date_trunc('month', f.start_date)::date
       OR make_date(p.year, p.month, 1) > date_trunc('month', f.end_date)::date)
  AND NOT EXISTS (SELECT 1 FROM journal_entries j WHERE j.period_id = p.id);

-- ===================================================================================
-- Paso 3: is_closed por unión (D3), FY cerrados, huecos y locked_until_date derivado
-- ===================================================================================
DO $$
DECLARE n_union int; n_fy int; n_hueco int; n_lock int;
BEGIN
  -- 3a. unión: is_closed actual O fin_del_mes <= locked_until_date (por día)
  UPDATE accounting_periods p
  SET is_closed = true, closed_at = COALESCE(p.closed_at, now()),
      closed_by = COALESCE(p.closed_by, 'migracion-tsk760'), updated_at = now()
  FROM fiscal_years f JOIN accounting_settings s ON s.company_id = f.company_id
  WHERE p.fiscal_year_id = f.id AND p.type = 'MONTHLY' AND NOT p.is_closed
    AND s.locked_until_date IS NOT NULL
    AND (make_date(p.year, p.month, 1) + interval '1 month' - interval '1 day')::date
        <= s.locked_until_date::date;
  GET DIAGNOSTICS n_union = ROW_COUNT;

  -- 3b. FY cerrado → todos sus períodos cerrados (MONTHLY, OPENING, CLOSING)
  UPDATE accounting_periods p
  SET is_closed = true, closed_at = COALESCE(p.closed_at, f.closed_at, now()),
      closed_by = COALESCE(p.closed_by, f.closed_by, 'migracion-tsk760'), updated_at = now()
  FROM fiscal_years f
  WHERE p.fiscal_year_id = f.id AND f.is_closed AND NOT p.is_closed;
  GET DIAGNOSTICS n_fy = ROW_COUNT;

  -- 3c. huecos: todo MONTHLY anterior al último MONTHLY cerrado de la empresa
  WITH ultimo AS (
    SELECT f.company_id, max(make_date(p.year, p.month, 1)) AS mes
    FROM accounting_periods p JOIN fiscal_years f ON f.id = p.fiscal_year_id
    WHERE p.type = 'MONTHLY' AND p.is_closed
    GROUP BY f.company_id
  )
  UPDATE accounting_periods p
  SET is_closed = true, closed_at = COALESCE(p.closed_at, now()),
      closed_by = COALESCE(p.closed_by, 'migracion-tsk760'), updated_at = now()
  FROM fiscal_years f JOIN ultimo u ON u.company_id = f.company_id
  WHERE p.fiscal_year_id = f.id AND p.type = 'MONTHLY' AND NOT p.is_closed
    AND make_date(p.year, p.month, 1) < u.mes;
  GET DIAGNOSTICS n_hueco = ROW_COUNT;

  -- 3d. locked_until_date = fin UTC del último MONTHLY cerrado (ya contiguo tras 3c), o NULL
  WITH ultimo AS (
    SELECT f.company_id,
           max(make_date(p.year, p.month, 1)) + interval '1 month' - interval '1 millisecond' AS hasta
    FROM accounting_periods p JOIN fiscal_years f ON f.id = p.fiscal_year_id
    WHERE p.type = 'MONTHLY' AND p.is_closed
    GROUP BY f.company_id
  )
  UPDATE accounting_settings s
  SET locked_until_date = u.hasta, updated_at = now()
  FROM (SELECT s2.company_id, u2.hasta FROM accounting_settings s2
        LEFT JOIN ultimo u2 ON u2.company_id = s2.company_id
        WHERE EXISTS (SELECT 1 FROM fiscal_years f WHERE f.company_id = s2.company_id)) u
  WHERE u.company_id = s.company_id AND s.locked_until_date IS DISTINCT FROM u.hasta;
  GET DIAGNOSTICS n_lock = ROW_COUNT;

  -- 3e. fechas de Ajustes = rango del FY abierto más antiguo (D11)
  UPDATE accounting_settings s
  SET fiscal_year_start = f.start_date, fiscal_year_end = f.end_date, updated_at = now()
  FROM (SELECT DISTINCT ON (company_id) company_id, start_date, end_date
        FROM fiscal_years WHERE NOT is_closed ORDER BY company_id, number) f
  WHERE f.company_id = s.company_id
    AND (s.fiscal_year_start, s.fiscal_year_end) IS DISTINCT FROM (f.start_date, f.end_date);

  RAISE NOTICE 'TSK-760 paso 3: meses cerrados por unión %, por FY cerrado %, por hueco %; bloqueos recalculados %',
    n_union, n_fy, n_hueco, n_lock;
END $$;

-- ===================================================================================
-- Paso 4: fiscal_year_id/period_id de todos los asientos (D4). Trigger deshabilitado
--         SOLO alrededor de este UPDATE.
-- ===================================================================================
ALTER TABLE journal_entries DISABLE TRIGGER trg_journal_entry_immutable;

WITH destino AS (
  SELECT j.id, f.id AS fy_id,
         CASE
           WHEN EXISTS (SELECT 1 FROM fiscal_years x WHERE x.closing_entry_id = j.id)
             THEN (SELECT p.id FROM accounting_periods p
                   WHERE p.fiscal_year_id = f.id AND p.type = 'CLOSING' LIMIT 1)
           WHEN EXISTS (SELECT 1 FROM fiscal_years x WHERE x.opening_entry_id = j.id)
             OR (j.description = 'Asiento de Apertura' AND j.date::date = f.start_date::date)
             THEN (SELECT p.id FROM accounting_periods p
                   WHERE p.fiscal_year_id = f.id AND p.type = 'OPENING' LIMIT 1)
           ELSE (SELECT p.id FROM accounting_periods p
                 WHERE p.fiscal_year_id = f.id AND p.type = 'MONTHLY'
                   AND p.year = EXTRACT(YEAR FROM j.date)::int
                   AND p.month = EXTRACT(MONTH FROM j.date)::int)
         END AS period_id
  FROM journal_entries j
  JOIN fiscal_years f ON f.company_id = j.company_id
                     AND j.date >= f.start_date AND j.date <= f.end_date
)
UPDATE journal_entries j
SET fiscal_year_id = d.fy_id, period_id = d.period_id
FROM destino d
WHERE d.id = j.id
  AND (j.fiscal_year_id IS DISTINCT FROM d.fy_id OR j.period_id IS DISTINCT FROM d.period_id);

ALTER TABLE journal_entries ENABLE TRIGGER trg_journal_entry_immutable;

-- ===================================================================================
-- Paso 5: contador = último número de la racha contigua que sigue al contador
--         (no salta a un número aislado como el 999999 de debug)
-- ===================================================================================
UPDATE accounting_settings s
SET last_entry_number = x.ultimo_contiguo, updated_at = now()
FROM (
  SELECT s2.company_id,
         (SELECT min(j.number) FROM journal_entries j
          WHERE j.company_id = s2.company_id AND j.number > s2.last_entry_number
            AND NOT EXISTS (SELECT 1 FROM journal_entries k
                            WHERE k.company_id = j.company_id AND k.number = j.number + 1)
         ) AS ultimo_contiguo
  FROM accounting_settings s2
  WHERE EXISTS (SELECT 1 FROM journal_entries j
                WHERE j.company_id = s2.company_id AND j.number = s2.last_entry_number + 1)
) x
WHERE x.company_id = s.company_id;

-- ===================================================================================
-- Paso 6: informe de lo que no se pudo asignar
-- ===================================================================================
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT j.company_id, count(*) AS n, min(j.date)::date AS desde, max(j.date)::date AS hasta
    FROM journal_entries j WHERE j.fiscal_year_id IS NULL GROUP BY j.company_id
  LOOP
    RAISE NOTICE 'TSK-760: empresa % tiene % asientos fuera de todo ejercicio (% a %)',
      r.company_id, r.n, r.desde, r.hasta;
  END LOOP;
  FOR r IN
    SELECT s.company_id, count(*) AS n, max(j.number) AS max_num
    FROM accounting_settings s JOIN journal_entries j ON j.company_id = s.company_id
    WHERE j.number > s.last_entry_number GROUP BY s.company_id
  LOOP
    RAISE NOTICE 'TSK-760: empresa % tiene % números aislados sobre el contador (máx %); nextEntryNumberTx los saltea',
      r.company_id, r.n, r.max_num;
  END LOOP;
END $$;

COMMIT;
```

**Probado en seco (2026-10-06):** el SQL corrió contra `contable_pms` local dentro de una
transacción con `ROLLBACK`, dos veces seguidas: la primera creó FY 1 (2026, 00:00 → 23:59:59.999)
con 14 períodos, asignó FY/período a los 32 asientos, dejó el contador en 49 y reportó el 999999;
la segunda no cambió nada (huellas de 3.2.4 idénticas) y los triggers quedaron `O`. Con el
999999 presente, el `UPDATE` de `nextEntryNumberTx` devolvió 50.

Decisiones dentro del SQL:

- **Numeración (paso 5) — cambia el plan:** en vez de `GREATEST(contador, max(number))` (que con
  un 999999 aislado llevaría el contador a 999999), el contador sube solo hasta el final de la
  racha **contigua** que lo sigue (las colisiones reales: asientos `contador+1, +2…` creados por
  los caminos no atómicos). Un número aislado se reporta y `nextEntryNumberTx` lo saltea si alguna
  vez se lo alcanza (3.3.4). Así el 999999 local no hace falta borrarlo para migrar (igual se borra
  en Fase 1 por prolijidad) y algo parecido en prod no rompe nada.
- **Asientos fuera de todo ejercicio:** los anteriores al primer FY y los posteriores al tope
  (hoy + 1 año) quedan con `fiscal_year_id = NULL` y se reportan (paso 6 y consulta 13). Siguen
  sumando en los reportes (que filtran por fecha). Si son DRAFT, ya no se pueden registrar: la
  fecha anterior al primer ejercicio se rechaza (D1). No hay acción para borrarlos (H9): se
  informan a la clienta según el diagnóstico.
- **Saldo de apertura manual** dentro del backfill: se asigna al período OPENING (consistente con
  cómo lo crea #19 desde ahora y necesario para revertirlo, B25).
- `locked_until_date` heredado de la UI vieja (fin de mes local, p. ej. `2026-04-01 02:59:59.999`)
  se interpreta por `::date` en 3a (cierra marzo, no abril) y se reescribe normalizado en 3d.

#### 3.2.3 Escenarios sembrados para probar la migración

`prisma/scripts/tsk760-escenarios-migracion.sql` (solo local, empresas con nombre `TSK760-MIG-x`,
fechas fijas de 2025-2026; borra y vuelve a crear sus filas al inicio). Estado **antes** → esperado
**después**:

| Esc. | Siembra | Esperado tras la migración |
|---|---|---|
| (a) | Ajustes 2025-01-01→2025-12-31 (03:00 UTC), sin FY, asientos DRAFT y POSTED en 2025 y en 03/2026 | FY 1 (2025, 00:00/23:59:59.999), FY 2 (2026) con 12 MONTHLY + OPENING + CLOSING cada uno; todos los asientos con FY/período; Ajustes = rango FY 1 |
| (b) | FY de 20260625 (`month` 0/13, 12 meses) con `locked_until_date = 2026-04-01 02:59:59.999` y todos los meses `is_closed = false` | ene-mar cerrados (unión), abr abierto; OPENING/CLOSING con mes 1 y 12; `locked_until_date = 2026-03-31 23:59:59.999` |
| (c) | FY con ene-feb `is_closed = true`, `locked_until_date = NULL` | ene-feb siguen cerrados; `locked_until_date = 2026-02-28 23:59:59.999` |
| (d) | DRAFT y POSTED (y un REVERSED con su reversión) fechados en meses que quedan cerrados por (b) | FY/período asignados también a POSTED y REVERSED; el trigger vuelve a `tgenabled = 'O'`; los DRAFT aparecen en la consulta 4 |
| (e) | Asientos del 2024-12-15 (antes del primer FY) y uno DRAFT del 2030-01-10 | ambos con `fiscal_year_id = NULL` y reportados; no se crean FY más allá de hoy + 1 año |
| (f) | Hueco: marzo cerrado, enero y febrero abiertos, `locked_until_date = NULL` | ene-feb cerrados por hueco; `locked_until_date = 2026-03-31 23:59:59.999` |
| (g) | FY 1 `is_closed = true` con un MONTHLY abierto y CLOSING abierto; FY 2 abierto | todos los períodos de FY 1 cerrados; Ajustes = rango FY 2; `locked_until_date` ≥ fin de FY 1 |
| (h) extra | Contador 10, asientos 11 y 12 (no atómicos) y un 999999 | contador = 12; NOTICE por el 999999 |

#### 3.2.4 Cómo verificar la idempotencia

1. Copia: `docker exec contable-pms-db pg_dump -U postgres -Fc contable_pms > /tmp/tsk760.dump`,
   `createdb contable_tsk760_copia`, `pg_restore -d contable_tsk760_copia`; correr
   `tsk760-escenarios-migracion.sql`.
2. Primera corrida: `DATABASE_URL=…/contable_tsk760_copia npx prisma migrate deploy`.
3. Huella: guardar la salida de esta consulta (en el script de diagnóstico como consulta 14):

```sql
SELECT 'fy' AS t, md5(string_agg(concat_ws('|', company_id, number, start_date, end_date, is_closed,
        closing_entry_id, opening_entry_id), ',' ORDER BY company_id, number)) FROM fiscal_years
UNION ALL SELECT 'periodos', md5(string_agg(concat_ws('|', fiscal_year_id, year, month, type, is_closed),
        ',' ORDER BY fiscal_year_id, type, year, month)) FROM accounting_periods
UNION ALL SELECT 'asientos', md5(string_agg(concat_ws('|', id, fiscal_year_id, period_id, status, number),
        ',' ORDER BY id)) FROM journal_entries
UNION ALL SELECT 'ajustes', md5(string_agg(concat_ws('|', company_id, fiscal_year_start, fiscal_year_end,
        locked_until_date, last_entry_number), ',' ORDER BY company_id)) FROM accounting_settings;
```

4. Segunda corrida **del mismo archivo** por fuera de Prisma (que ya la marcó aplicada):
   `docker exec -i contable-pms-db psql -U postgres -d contable_tsk760_copia -v ON_ERROR_STOP=1 < migration.sql`.
   Los NOTICE deben dar 0 en todos los contadores; la huella, idéntica; `pg_trigger.tgenabled = 'O'`
   para los dos triggers.
5. Lo mismo automatizado en `fy-backfill.integration.test.ts` (3.7).

### 3.3 Funciones y métodos

Tipos comunes (en `UT/journal-entry-types.ts`, sin `server-only` para poder usarlos en cliente):

```ts
import type { Prisma } from '@/generated/prisma/client';
import type { AccountingPeriodType, JournalEntryStatus } from '@/generated/prisma/enums';

/** Cliente transaccional. `prisma` también es asignable (para lecturas fuera de tx). */
export type Tx = Prisma.TransactionClient;
/** 'YYYY-MM-DD' (día calendario UTC). Es lo que viaja entre cliente y servidor. */
export type IsoDay = string;
export interface YearMonth { year: number; month: number } // month 1..12
export type EntryPeriodType = Extract<AccountingPeriodType, 'MONTHLY' | 'OPENING' | 'CLOSING'>;
export type CreatableEntryStatus = Extract<JournalEntryStatus, 'DRAFT' | 'POSTED'>;
export type Amount = number | Prisma.Decimal;
```

Los `PrismaTransactionClient` locales de cada archivo (`Omit<typeof prisma, '$connect' | …>`) son
estructuralmente asignables a `Prisma.TransactionClient`: los llamadores no cambian su alias.

#### 3.3.1 `UT/utc-month.ts` (puro)

```ts
export function toUtcDay(date: Date): IsoDay;                       // moment.utc(date).format('YYYY-MM-DD')
export function parseIsoDay(day: IsoDay): Date;                     // 00:00:00.000Z; lanza BusinessError si no es válido
export function startOfDayUtc(date: Date | IsoDay): Date;
export function endOfDayUtc(date: Date | IsoDay): Date;             // 23:59:59.999Z
export function monthKeyUtc(date: Date): YearMonth;
export function startOfMonthUtc(ym: YearMonth): Date;
export function endOfMonthUtc(ym: YearMonth): Date;                 // último día 23:59:59.999Z
export function addMonths(ym: YearMonth, n: number): YearMonth;
export function compareYearMonth(a: YearMonth, b: YearMonth): number;
export function monthsBetweenUtc(start: Date, end: Date): YearMonth[];   // inclusivo, irregulares incluidos
export function isOnOrBeforeDayUtc(a: Date, b: Date): boolean;     // por día calendario UTC
export function formatMonth(ym: YearMonth): string;                 // 'MM/YYYY'
export function formatMonthLabel(ym: YearMonth): string;            // 'mar 2026' (locale es)
export function formatDayUtc(date: Date | IsoDay): string;          // 'DD/MM/YYYY'
```

#### 3.3.2 `UT/period-closure.ts` (puro)

```ts
export type PeriodClosureReason = 'FISCAL_YEAR' | 'PERIOD' | 'LOCKED_UNTIL';
export type PeriodClosure = { closed: false } | { closed: true; reason: PeriodClosureReason };

export interface PeriodClosureInput {
  date: Date;
  periodType: EntryPeriodType;
  fiscalYear: { number: number; isClosed: boolean };
  period: { isClosed: boolean };
  lockedUntilDate: Date | null;
}
/** Precedencia: FY cerrado > período cerrado > lockedUntilDate. Con OPENING/CLOSING (D12)
 *  solo cuentan FY y período de ese tipo; lockedUntilDate se ignora. */
export function evaluatePeriodClosure(input: PeriodClosureInput): PeriodClosure;

export interface PeriodClosedMessageInput {
  date: Date;
  reason: PeriodClosureReason;
  periodType: EntryPeriodType;
  fiscalYearNumber: number;
  lockedUntilDate: Date | null;
  /** Sujeto de la frase. Por defecto: `No se puede registrar con fecha DD/MM/YYYY`. */
  subject?: string;
}
export function buildPeriodClosedMessage(input: PeriodClosedMessageInput): string;
```

Textos exactos (siempre contienen "el período está cerrado", tests existentes):

| Causa | Mensaje |
|---|---|
| `PERIOD` (MONTHLY) | `No se puede registrar con fecha 10/03/2026: el período está cerrado (mes 03/2026 cerrado). Para operar, reabrilo desde Contabilidad → Configuración → Bloqueo de Períodos.` |
| `FISCAL_YEAR` | `No se puede registrar con fecha 10/03/2026: el período está cerrado (ejercicio N° 1 cerrado).` |
| `LOCKED_UNTIL` | `No se puede registrar con fecha 10/03/2026: el período está cerrado (bloqueado hasta 31/03/2026). Para operar, reabrilo desde Contabilidad → Configuración → Bloqueo de Períodos.` |
| `PERIOD` (OPENING) | `No se puede registrar con fecha 01/01/2027: el período está cerrado (apertura del ejercicio N° 2 cerrada).` |
| `PERIOD` (CLOSING) | `No se puede registrar con fecha 31/12/2026: el período está cerrado (cierre del ejercicio N° 1 cerrado).` |

Con `subject` (reversión): `No se puede anular el asiento N° 12 (fecha 10/03/2026): el período está cerrado (mes 03/2026 cerrado). …`.

#### 3.3.3 `UT/period-lock.ts` (`import 'server-only'`)

```ts
export interface LockedAccountingSettings {
  id: string;
  companyId: string;
  fiscalYearStart: Date;
  fiscalYearEnd: Date;
  lockedUntilDate: Date | null;
}
export interface FiscalYearRef {
  id: string; number: number; startDate: Date; endDate: Date; isClosed: boolean;
}
export interface OpenPeriodRef { fiscalYearId: string; fiscalYearNumber: number; periodId: string }
export interface AssertPeriodOpenOptions { periodType?: EntryPeriodType; subject?: string }

/** SELECT … FROM accounting_settings WHERE company_id = $1 FOR UPDATE.
 *  Reentrante dentro de la misma tx. Sin fila → BusinessError NO_SETTINGS. */
export async function lockAccountingSettingsTx(tx: Tx, companyId: string): Promise<LockedAccountingSettings>;

/** FY cuyo rango contiene la fecha (startDate <= date <= endDate; fechas normalizadas). */
export async function findFiscalYearForDateTx(tx: Tx, companyId: string, date: Date): Promise<FiscalYearRef | null>;

/**
 * D1. Devuelve el FY que contiene la fecha, creándolo si corresponde. Recibe los Ajustes ya
 * bloqueados (prueba de que el llamador tiene el lock).
 * - Sin FY en la empresa → crea FY 1 con el rango de Ajustes (por día UTC) y lo usa si la fecha cae
 *   dentro; si no, sigue con las reglas de abajo.
 * - Fecha anterior al inicio del primer FY → BusinessError BEFORE_FIRST_FY.
 * - Fecha posterior al último FY y dentro del inmediato siguiente (inicio = día siguiente al fin,
 *   12 meses) → lo crea con createFiscalYearWithPeriodsTx.
 * - Más allá del siguiente → BusinessError TOO_FAR_AHEAD.
 */
export async function ensureFiscalYearTx(tx: Tx, settings: LockedAccountingSettings, date: Date): Promise<FiscalYearRef>;

/** Crea el FY con OPENING (mes de inicio) + un MONTHLY por mes + CLOSING (mes de fin).
 *  createMany({ skipDuplicates: true }) para los períodos. */
export async function createFiscalYearWithPeriodsTx(
  tx: Tx,
  input: { companyId: string; number: number; startDay: IsoDay; endDay: IsoDay }
): Promise<FiscalYearRef>;

/** Crea los períodos faltantes de un FY existente (autorreparación; createMany skipDuplicates). */
export async function ensurePeriodsTx(tx: Tx, fiscalYear: FiscalYearRef): Promise<void>;

/**
 * A2 + D12. Una sola definición de período cerrado. Pasos:
 * 1. settings = lockAccountingSettingsTx(tx, companyId)            ← lock FOR UPDATE de la fila
 *    de accounting_settings de la empresa (la misma que actualiza nextEntryNumberTx).
 * 2. fy = findFiscalYearForDateTx; si no hay:
 *      MONTHLY y lockedUntilDate cubre la fecha (por día UTC) → BusinessError LOCKED_UNTIL
 *      si no → fy = ensureFiscalYearTx(tx, settings, date)
 * 3. period = MONTHLY {fy, monthKeyUtc(date)} | {fy, type} para OPENING/CLOSING;
 *    si falta → ensurePeriodsTx y se relee.
 * 4. evaluatePeriodClosure → BusinessError(buildPeriodClosedMessage(…)).
 * 5. Devuelve { fiscalYearId, fiscalYearNumber, periodId }.
 */
export async function assertPeriodOpen(
  tx: Tx, companyId: string, date: Date, opts?: AssertPeriodOpenOptions
): Promise<OpenPeriodRef>;

/** lockedUntilDate = endOfMonthUtc del último MONTHLY de la racha cerrada desde el primer mes
 *  del primer FY (FY cerrado cuenta como todo cerrado), o NULL. Escribe solo si cambia. */
export async function syncLockedUntilDateTx(tx: Tx, companyId: string): Promise<Date | null>;

/** Lista ordenada (FY.number, year, month) de MONTHLY con su FY; base de cierre/reapertura y de
 *  getPeriodLockStatus. */
export async function listMonthlyPeriodsTx(tx: Tx, companyId: string): Promise<MonthlyPeriodRow[]>;
export interface MonthlyPeriodRow extends YearMonth {
  periodId: string; isClosed: boolean;
  fiscalYearId: string; fiscalYearNumber: number; fiscalYearClosed: boolean;
}
```

SQL del lock (exacto):

```ts
const rows = await tx.$queryRaw<LockedAccountingSettings[]>`
  SELECT id, company_id AS "companyId", fiscal_year_start AS "fiscalYearStart",
         fiscal_year_end AS "fiscalYearEnd", locked_until_date AS "lockedUntilDate"
  FROM accounting_settings WHERE company_id = ${companyId}::uuid
  FOR UPDATE`;
```

Mensajes (`BusinessError`):

| Código | Texto |
|---|---|
| NO_SETTINGS | `No se encontró configuración contable para la empresa. Configurala en Contabilidad → Configuración.` |
| BEFORE_FIRST_FY | `La fecha 15/12/2025 es anterior al inicio del primer ejercicio (01/01/2026); cargala como saldo de apertura.` |
| TOO_FAR_AHEAD | `La fecha 05/03/2028 está más de un ejercicio por delante del último ejercicio (N° 2, hasta 31/12/2027).` |

#### 3.3.4 `UT/journal-entry-lines.ts` (puro) y `UT/journal-entry-tx.ts` (`server-only`)

```ts
// journal-entry-lines.ts
export interface JournalEntryLineDraft {
  accountId: string;
  debit: Amount;
  credit: Amount;
  description?: string | null;
  customerId?: string | null;
  supplierId?: string | null;
  costCenterId?: string | null;   // TSK-583/719
  currency?: string;              // default 'ARS'
  originalAmount?: Amount | null;
  exchangeRate?: Amount | null;
}
export interface LineTotals { debit: Prisma.Decimal; credit: Prisma.Decimal }
/** Suma con Prisma.Decimal. Lanza BusinessError con el primer problema. */
export function validateEntryLines(lines: readonly JournalEntryLineDraft[]): LineTotals;
/** Invierte debe/haber conservando todas las demás columnas (reversión). */
export function invertLines(lines: readonly JournalEntryLineDraft[]): JournalEntryLineDraft[];
```

| Regla | Mensaje |
|---|---|
| < 2 líneas | `Un asiento debe tener al menos 2 líneas.` |
| importe no finito o negativo | `La línea 3 tiene un importe inválido: los montos deben ser números positivos.` |
| debe y haber > 0 | `La línea 3 tiene importe en el Debe y en el Haber; cada línea va en uno solo.` |
| debe y haber = 0 | `La línea 3 no tiene importe en el Debe ni en el Haber.` |
| desbalance ≥ 0,01 | `El asiento no está balanceado. Debe: $1500.00, Haber: $1499.00, Diferencia: $1.00` (texto actual) |

Se valida balance **siempre** (también DRAFT): todos los creadores ya lo exigían al crear; para
POSTED (nace o se registra) es el control de B21.

```ts
// journal-entry-tx.ts
export interface CreateJournalEntryTxInput {
  companyId: string;
  date: Date;
  description: string;
  lines: readonly JournalEntryLineDraft[];
  status: CreatableEntryStatus;
  /** userId o 'system' (se conserva lo de cada creador, 1.2.5). */
  createdBy: string;
  periodType?: EntryPeriodType;      // default MONTHLY
  originalEntryId?: string;          // solo reversiones
  /** Etiqueta del origen para el log (p. ej. 'sales-invoice:<id>'); no se persiste. */
  source?: string;
}
export interface CreatedJournalEntry {
  id: string; number: number; fiscalYearId: string; periodId: string; status: CreatableEntryStatus;
}

/** Cuentas de la empresa y hojas (1 query). BusinessError:
 *  `La cuenta 5.1.03 no es imputable (tiene subcuentas).` /
 *  `Una o más cuentas del asiento no existen o no pertenecen a la empresa.` */
export async function assertAccountsUsableTx(tx: Tx, companyId: string, accountIds: readonly string[]): Promise<void>;

/** Siguiente número libre. Requiere el lock (lo toma assertPeriodOpen). */
export async function nextEntryNumberTx(tx: Tx, companyId: string): Promise<number>;

/** validateEntryLines → assertAccountsUsableTx → assertPeriodOpen → nextEntryNumberTx → create.
 *  Sin checkPermission ni $transaction. */
export async function createJournalEntryTx(tx: Tx, input: CreateJournalEntryTxInput): Promise<CreatedJournalEntry>;

export interface PostJournalEntryTxInput { companyId: string; entryId: string; userId: string }
/** DRAFT → POSTED: assertPeriodOpen(entry.date, tipo de su período) + validateEntryLines +
 *  assertAccountsUsableTx; actualiza fiscalYearId/periodId. */
export async function postJournalEntryTx(tx: Tx, input: PostJournalEntryTxInput): Promise<{ id: string; number: number }>;

export interface ReverseJournalEntryTxInput { companyId: string; entryId: string; date: Date; createdBy: string }
export interface ReversedJournalEntry { original: { id: string; number: number }; reversal: CreatedJournalEntry }
export async function reverseJournalEntryTx(tx: Tx, input: ReverseJournalEntryTxInput): Promise<ReversedJournalEntry>;
```

`nextEntryNumberTx` (un solo statement; salta números ocupados, ver paso 5 de la migración):

```sql
-- Las referencias a s.last_entry_number se reevalúan sobre la versión vigente de la fila
-- (sin CTE con snapshot propio); el lock ya lo tomó assertPeriodOpen.
UPDATE accounting_settings s
SET last_entry_number = CASE
      WHEN NOT EXISTS (SELECT 1 FROM journal_entries j
                       WHERE j.company_id = s.company_id AND j.number = s.last_entry_number + 1)
        THEN s.last_entry_number + 1
      ELSE (SELECT min(j.number) + 1 FROM journal_entries j
            WHERE j.company_id = s.company_id AND j.number > s.last_entry_number
              AND NOT EXISTS (SELECT 1 FROM journal_entries k
                              WHERE k.company_id = s.company_id AND k.number = j.number + 1))
    END,
    updated_at = now()
WHERE s.company_id = ${companyId}::uuid
RETURNING s.last_entry_number
```

Sin fila → BusinessError NO_SETTINGS. El camino normal es un `EXISTS` sobre el índice único
`(company_id, number)`.

Mensajes de `postJournalEntryTx` / `reverseJournalEntryTx`:

| Caso | Mensaje |
|---|---|
| no existe o es de otra empresa | `Asiento no encontrado.` |
| post de un no-DRAFT | `El asiento N° 12 ya no está en borrador.` |
| reversión de un no-POSTED | `Solo se pueden anular asientos registrados; el N° 12 está en estado Borrador.` (o `Anulado`) |
| período del original cerrado | tabla 3.3.2 con `subject` |
| período de la fecha de reversión cerrado | tabla 3.3.2 sin `subject` (fecha de hoy) |

#### 3.3.5 Cierre y reapertura de meses (`ACC/features/settings/actions.server.ts`)

```ts
export interface PeriodMonthStatus extends YearMonth {
  label: string;               // 'mar 2026'
  isClosed: boolean;
  draftCount: number;
  action: 'close' | 'reopen' | null;   // solo el primer abierto y el último cerrado reabrible
}
export interface PeriodLockFiscalYear {
  id: string; number: number; startDay: IsoDay; endDay: IsoDay; months: PeriodMonthStatus[];
}
export interface PeriodLockStatus {
  fiscalYears: PeriodLockFiscalYear[];   // FY abierto más antiguo y el siguiente si existe
  lockedUntil: IsoDay | null;
  /** Piso de B5: último FY cerrado. La UI explica "sus meses no se pueden reabrir". */
  lastClosedFiscalYear: { number: number; endDay: IsoDay } | null;
}

export async function getPeriodLockStatus(): Promise<PeriodLockStatus | null>;   // null = sin Ajustes
export async function closeAccountingPeriod(
  input: YearMonth & { postDrafts: boolean }
): Promise<ActionResult<{ lockedUntil: IsoDay; postedDrafts: number }>>;
export async function reopenAccountingPeriod(
  input: YearMonth
): Promise<ActionResult<{ lockedUntil: IsoDay | null }>>;
```

Mensajes:

| Caso | Mensaje |
|---|---|
| mes inexistente | `No existe el mes 07/2031 en los ejercicios de la empresa.` |
| no es el primer abierto | `Solo se puede cerrar el primer mes abierto: 03/2026.` |
| no hay abiertos | `No hay meses abiertos para cerrar en los ejercicios vigentes.` |
| borradores sin `postDrafts` | `El mes 03/2026 tiene 4 borradores sin registrar (N° 12, 15, 18, 20). Registralos o elegí "Registrar los 4 borradores y cerrar".` (hasta 5 números + `…`) |
| un borrador falla | `No se cerró 03/2026: el borrador N° 15 no se puede registrar. <mensaje de la causa>` |
| reabrir mes de FY cerrado | `No se puede reabrir 12/2026: pertenece al ejercicio N° 1, que está cerrado.` |
| no es el último cerrado | `Solo se puede reabrir el último mes cerrado: 05/2026.` |
| nada que reabrir | `No hay meses cerrados para reabrir.` |
| `postDrafts` sin permiso | `checkPermission('accounting.entries', 'approve', { redirect: true })` (como hoy) |

`setLockedPeriod` y `getLockedPeriod` se **borran**. `validateFiscalYear` de
`ACC/shared/validators` se reutiliza en `saveFiscalYearSettings`.

#### 3.3.6 Ajustes: ejercicio y cuentas (B23, D11, H6)

```ts
export interface FiscalYearSettingsView {
  fiscalYearNumber: number;
  startDay: IsoDay; endDay: IsoDay;     // FY abierto más antiguo
  datesEditable: boolean;               // único FY, sin asientos en la empresa, sin meses cerrados
}
export async function getFiscalYearSettings(): Promise<FiscalYearSettingsView | null>;

/** Primera vez: upsert de Ajustes + FY 1 con sus períodos (createFiscalYearWithPeriodsTx).
 *  Con FY: solo si datesEditable (regenera períodos en la tx); si no, BusinessError. */
export async function saveFiscalYearSettings(
  input: { startDay: IsoDay; endDay: IsoDay }
): Promise<ActionResult<{ fiscalYearNumber: number }>>;

/** Solo cuentas (sin fechas). Requiere Ajustes existentes. */
export async function saveAccountingSettings(
  input: Omit<SaveAccountingSettingsInput, 'fiscalYearStart' | 'fiscalYearEnd'>
): Promise<ActionResult>;
```

| Caso | Mensaje |
|---|---|
| fin ≤ inicio / > 1 año | textos actuales de `validateFiscalYear` |
| no empieza día 1 o no termina fin de mes | `El ejercicio tiene que empezar el primer día de un mes y terminar el último día de un mes.` |
| cambio con asientos o meses cerrados | `No se pueden cambiar las fechas del ejercicio N° 1: la empresa ya tiene asientos o meses cerrados. Las fechas cambian solas al cerrar el ejercicio.` |
| cuentas sin Ajustes | `Configurá primero el ejercicio fiscal.` |

#### 3.3.7 `UT/entry-document-link.ts` (`server-only`)

```ts
export type EntryDocumentKind =
  | 'SALES_INVOICE' | 'PURCHASE_INVOICE' | 'RECEIPT' | 'PAYMENT_ORDER' | 'EXPENSE'
  | 'FUND_MOVEMENT' | 'DEPRECIATION' | 'VALUE_ADJUSTMENT' | 'FISCAL_YEAR_CLOSING' | 'FISCAL_YEAR_OPENING';
export interface EntryDocumentLink { kind: EntryDocumentKind; documentId: string; label: string }

/** Un findUnique de journalEntry con select de las 7 relaciones inversas + FY de cierre/apertura,
 *  y un fundMovement.findFirst({ where: { companyId, journalEntryId } }) (columna sin relación). */
export async function getEntryDocumentLink(tx: Tx, companyId: string, entryId: string): Promise<EntryDocumentLink | null>;

/** Where para getEntriesWithoutDocuments: { none: {} } en las 7 relaciones, `is: null` en las dos
 *  de FY y `id: { notIn }` con los journalEntryId de fund_movements de la empresa. */
export async function entriesWithoutDocumentWhere(tx: Tx, companyId: string): Promise<Prisma.JournalEntryWhereInput>;

export function buildDocumentLinkedMessage(link: EntryDocumentLink): string;
```

`label` y mensaje de rechazo (D6):

| kind | label | Mensaje |
|---|---|---|
| SALES_INVOICE | `la factura de venta 0001-00000012` | `Este asiento pertenece a la factura de venta 0001-00000012 y no se puede anular desde Asientos: anulá el comprobante.` |
| PURCHASE_INVOICE | `la factura de compra 0001-00000345` | ídem |
| RECEIPT / PAYMENT_ORDER / EXPENSE | `el recibo R-00001` / `la orden de pago OP-00004` / `el gasto GTO-00002` | ídem |
| FUND_MOVEMENT | `el movimiento de fondos "Aporte de socio"` | ídem |
| DEPRECIATION | `la depreciación del período 3 del equipo INT-12` | ídem |
| VALUE_ADJUSTMENT | `el ajuste de valor del equipo INT-12` | ídem |
| FISCAL_YEAR_CLOSING | `la refundición del ejercicio N° 1` | `Este asiento es la refundición del ejercicio N° 1 y no se puede anular.` |
| FISCAL_YEAR_OPENING | `la apertura del ejercicio N° 2` | `Este asiento es la apertura del ejercicio N° 2 y no se puede anular.` |

#### 3.3.8 `UT/closing-entries.ts` (B18, B19, H4)

```ts
/** Excluye la apertura generada por un cierre (alias de journal_entries = je). */
export const NOT_CLOSE_GENERATED_OPENING_SQL: Prisma.Sql =
  Prisma.sql`NOT EXISTS (SELECT 1 FROM fiscal_years fyo WHERE fyo.opening_entry_id = je.id)`;
/** Excluye la refundición. */
export const NOT_CLOSING_ENTRY_SQL: Prisma.Sql =
  Prisma.sql`NOT EXISTS (SELECT 1 FROM fiscal_years fyc WHERE fyc.closing_entry_id = je.id)`;
export const notCloseGeneratedOpeningWhere: Prisma.JournalEntryWhereInput = { fiscalYearAsOpeningEntry: { is: null } };
export const notClosingEntryWhere: Prisma.JournalEntryWhereInput = { fiscalYearAsClosingEntry: { is: null } };
```

Dónde se aplican (regla: *la apertura generada solo se ve en el Diario; la refundición no
cuenta como resultado del período*):

| Consulta | Archivo:línea | Fragmento |
|---|---|---|
| `calculateAccountBalance`, `calculateAllAccountBalances` (×2), `calculateBalanceByType` (×2) — Balance, Sumas y Saldos, plan de cuentas, ecuación contable | `UT/balances.ts:15-27`, `:70-95`, `:198-223` | apertura |
| Mayor: saldo anterior y movimientos | `reports/actions.server.ts:252-275` | apertura (ambos) |
| Estado de Resultados | `reports/actions.server.ts:532-541` | refundición |
| Presupuesto vs. real | `reports/actions.server.ts:1197-1210`, `budgets/actions.server.ts:80-95` | refundición |
| Movimientos por centro de costo | `reports/actions.server.ts:1586-1592` | refundición |
| Control de presupuesto de gastos | `INT/commercial/index.ts:1130-1145` | refundición |
| Liquidación de IVA (preview) | `vat-settlement/actions.server.ts:58-79` | apertura |
| Diferencia de cambio (saldo acumulado) | `exchange-rates/actions.server.ts:205-216` | apertura |
| Ajuste por inflación (saldos de cierre y de apertura) | `inflation-adjustment/actions.server.ts:170-200` | apertura |
| Saldos patrimoniales del cierre anual | `computeClosePreviewTx` | apertura |

`UT/balances.ts:15` cambia `whereCondition: any` por `Prisma.JournalEntryLineWhereInput` al tocarla.

#### 3.3.9 Cierre anual (`ACC/features/fiscal-year-close/actions.server.ts` + `UT/fiscal-year-close-math.ts`)

```ts
// fiscal-year-close-math.ts (puro)
export interface AccountBalanceRow {
  accountId: string; code: string; name: string;
  type: AccountType; debit: Prisma.Decimal; credit: Prisma.Decimal;
}
export interface ClosingLine { accountId: string; accountCode: string; accountName: string; debit: number; credit: number }
/** Refundición: cada REVENUE/EXPENSE con saldo ≠ 0 al lado contrario; contrapartida en Resultado
 *  solo si |diferencia| ≥ 0,005 (H5). */
export function buildClosingLines(results: readonly AccountBalanceRow[], resultAccount: AccountRef): ClosingLine[];
/** Apertura: saldos patrimoniales + efecto de la refundición sobre la cuenta Resultado (B21). */
export function buildOpeningLines(patrimonial: readonly AccountBalanceRow[], closing: readonly ClosingLine[], resultAccount: AccountRef): ClosingLine[];

// actions.server.ts
export interface ClosePreview {
  fiscalYear: { id: string; number: number; startDay: IsoDay; endDay: IsoDay };
  closingLines: ClosingLine[];
  openingLines: ClosingLine[];
  totalRevenue: number; totalExpense: number; netResult: number;
}
export interface FiscalYearCloseStatus {
  fiscalYear: { id: string; number: number; startDay: IsoDay; endDay: IsoDay } | null;  // abierto más antiguo
  lastClosed: { number: number; closingEntryNumber: number | null; openingEntryNumber: number | null; closedAt: IsoDay } | null;
  resultAccountName: string | null;
  openMonths: string[];                                                 // ['11/2026', '12/2026']
  pendingDrafts: { month: string; count: number; numbers: number[] }[];  // primeros 5 por mes
  canClose: boolean;
}
export async function getFiscalYearStatus(): Promise<FiscalYearCloseStatus | null>;
export async function previewFiscalYearClose(fiscalYearId: string): Promise<ActionResult<ClosePreview>>;
export async function closeFiscalYear(
  input: { fiscalYearId: string }
): Promise<ActionResult<{ closingEntryNumber: number; openingEntryNumber: number | null; nextFiscalYearNumber: number }>>;

/** Interno; lo usan preview (con `prisma`) y close (con `tx`, después del lock). */
async function computeClosePreviewTx(tx: Tx, companyId: string, fy: FiscalYearRef, resultAccount: AccountRef): Promise<ClosePreview>;
```

Correcciones de `computeClosePreviewTx` respecto de hoy:

- Saldos de resultado: POSTED con `je.date <= fy.endDate` (**acumulado**, no solo el rango del
  FY), sin filtro de cuenta activa (H5). Como los ejercicios anteriores quedaron en cero por su
  refundición, el acumulado da el resultado del FY; y si hay resultados viejos sin refundir
  (asientos anteriores al primer FY), entran en esta refundición en vez de desbalancear la
  apertura. Ver C4.
- Saldos patrimoniales: POSTED con `je.date <= fy.endDate`, `NOT_CLOSE_GENERATED_OPENING_SQL`,
  sin filtro de cuenta activa.
- Sumas con `::numeric` → `Prisma.Decimal`, redondeo a 2 decimales al armar líneas.

Mensajes:

| Caso | Mensaje |
|---|---|
| sin Ajustes | NO_SETTINGS (3.3.3) |
| sin cuenta de Resultado | `Configurá la cuenta de Resultado del Ejercicio en Contabilidad → Configuración antes de cerrar.` |
| no es el abierto más antiguo | `Solo se puede cerrar el ejercicio abierto más antiguo (N° 1).` |
| ya cerrado | `El ejercicio N° 1 ya está cerrado.` |
| meses abiertos (B1) | `No se puede cerrar el ejercicio N° 1: faltan cerrar los meses 11/2026, 12/2026. Cerralos en orden desde Contabilidad → Configuración → Bloqueo de Períodos.` |
| borradores (A5) | `No se puede cerrar el ejercicio N° 1: hay 5 borradores sin registrar (03/2026: N° 12, 15; 07/2026: N° 30, 31, 33). Reabrí esos meses y registralos antes de cerrar.` |
| sin resultados (B20) | `No hay asientos registrados con resultado en el ejercicio N° 1: registrá los borradores antes de cerrar.` |
| apertura desbalanceada (defensa B21) | se propaga el de `validateEntryLines`, prefijado: `El asiento de apertura no balancea. …` |

#### 3.3.10 Diff conceptual por creador

| # | Creador | Qué reemplaza | Riesgos |
|---|---|---|---|
| 1 | `createJournalEntry(input)` → `ActionResult<{ id; number }>` | `validateJournalEntryDate`, `resolveFiscalPeriod` y el `UPDATE … RETURNING` fuera/dentro de tx por `createJournalEntryTx` (DRAFT, `createdBy` = userId). `companyId` de `getActiveCompanyId()`; se quita el parámetro. Validadores de cuentas/auxiliares siguen fuera de la tx pero lanzan `BusinessError` | Si un validador queda con `throw new Error`, en prod llega el genérico: convertir todos. Firma nueva: un solo caller (`_CreateEntryModal`) |
| 2 | `postJournalEntry(entryId)` | `validatePeriodLock` + `validateJournalEntryBalance` + `update` por `postJournalEntryTx` | B4: pasa a rechazar DRAFT de FY cerrado (esperado) |
| 3 | `reverseJournalEntry({ entryId })` | Validación y creación inline por `getEntryDocumentLink` + `reverseJournalEntryTx` | Escenario 7 de 1.6.2: deja de poder anular asientos de documentos |
| 4 | `INT/commercial` `createJournalEntry` interno (venta, compra, recibo, OP, gasto) | Cuerpo entero (balance, `lockedUntilDate`, resolver con `moment()` local, numeración) por `createJournalEntryTx` (DRAFT, `'system'`); devuelve `entry.id` | Tests existentes: el texto sigue conteniendo "período está cerrado". Primer asiento de una empresa de test crea FY 1 (R7, limpieza) |
| 5 | `createJournalEntryForCOGS` | se borra (D13) | grep de callers en `src/`, `prisma/`, tests |
| 6 | `INT/equipment` `createJournalEntry` interno (baja/venta) | ídem #4; el desbalance pasa de `Error` a `BusinessError` | `asset-disposal` con `lockedUntilDate` 2099: sigue rechazando por condición (c) |
| 7 | `INT/treasury/index.ts` | se borra (D13) | — |
| 8 | `postEntryTx` / `postDepreciationEntry` | `resolveFiscalPeriodTx` (se borra), numeración y el chequeo previo de `loaded.lockedUntilDate` (`:842-849`) por `createJournalEntryTx` dentro de la tx | El texto "El período MM/YYYY está bloqueado" pasa al estándar (sin tests que lo fijen) |
| 9 | `postAllPendingDepreciations` | se quita el filtro `gt: lockedUntilDate`; en el bucle, `BusinessError` → `errors[]` con `Equipo X: <mensaje>`; cualquier otro error se relanza (una excepción SQL aborta la tx de Postgres) | Los períodos siguientes del mismo equipo salen como "omitido (anterior no contabilizado)": correcto, se informa |
| 10 | `createValueAdjustment` | chequeo previo `:1057-1064` y resolver/numeración por `createJournalEntryTx` | — |
| 11 | `createJournalEntryForFundMovement` | `lastEntryNumber + 1` + `update` del contador por `createJournalEntryTx` (DRAFT, `'system'`); conserva su chequeo exacto con `Decimal` previo | Antes no validaba período: escenario 3 de 1.6.2 |
| 12 | `createJournalEntryForBankMovement` | numeración no atómica por `createJournalEntryTx`; conserva "sin Ajustes no hay asiento" (`findUnique` de Ajustes con `select: { id }` y `logger.warn`, como hoy) | Con Ajustes y mes cerrado, el movimiento entero se rechaza (no se graba sin asiento) |
| 13-14 | transferencias banco→banco y banco↔caja | ídem #12, extrayendo las líneas a `buildTransferLines` dentro del mismo archivo | Archivo grande (1390 líneas): tocar solo los bloques `:1108-1147` y `:1223-1262` |
| 15 | `generateVatSettlementEntry` | numeración + resolver por `createJournalEntryTx` (POSTED, `'system'`, fecha `endOfMonthUtc`); rango del preview en UTC | Sin UI |
| 16 | `generateExchangeDifferenceEntry` | numeración por `createJournalEntryTx` (POSTED, userId); ahora carga FY/período | Sin UI |
| 17 | `generateInflationAdjustmentEntry` | ídem #15 (fecha `endOfMonthUtc`) | Sin UI |
| 18 | `generateRecurringEntry` / masiva | función interna `generateRecurringEntryTx(tx, …)`; `lastEntryNumber + 1` por `createJournalEntryTx` (DRAFT, userId); avance de `nextDueDate` en la misma tx; la masiva junta `result.error` en `errors[]` | Recurrente con fecha en mes cerrado queda pendiente hasta reabrir (el mensaje lo dice) |
| 19 | `saveOpeningBalanceEntry` | `lastEntryNumber + 1` por `createJournalEntryTx` (POSTED, `periodType: 'OPENING'`, fecha = inicio del FY abierto más antiguo). Reemplazo = `reverseJournalEntryTx` del vigente con su misma fecha + nuevo (B25). Búsqueda del vigente por `fiscalYearId` (H3) | OPENING de un FY generado por cierre está cerrado: no se cargan saldos manuales en FY ≥ 2 (correcto) |
| 20 | `closeFiscalYear` | reescrito (3.3.9) | Ver 3.7 |

### 3.4 Interfaces de usuario

| Componente | Tipo | Props | Líneas est. | Notas |
|---|---|---|---|---|
| `AccountingSettings.tsx` | Server | — | 150 (hoy 160) | deja de pasar fechas a la grilla; card "Bloqueo de Períodos" con `id="bloqueo-periodos"`; pasa `fiscalYear` a `_AccountingSettingsForm` |
| `_AccountingSettingsForm.tsx` | Client | `{ fiscalYear: FiscalYearSettingsView \| null }` | 120 | si `!datesEditable`: fechas en texto con la leyenda "Las fechas salen del ejercicio N° X; cambian solas al cerrar el ejercicio." Envía `'YYYY-MM-DD'` (sin `new Date('…T00:00:00')`); `ActionResult` |
| `_PeriodLockingPanel.tsx` (reemplaza `_PeriodLockingForm`) | Client | — | 130 | `useQuery({ queryKey: ['accounting', 'periodLockStatus'], queryFn: getPeriodLockStatus })`; un bloque por FY con grilla de `_PeriodMonthCell`; nota del piso ("El ejercicio N° 1 está cerrado: sus meses no se pueden reabrir"); abre los diálogos |
| `_PeriodMonthCell.tsx` | Client | `{ month: PeriodMonthStatus; disabled: boolean; onSelect(month): void }` | 70 | candado abierto/cerrado, insignia con `draftCount` si > 0, botón solo si `action` ≠ null |
| `_ClosePeriodDialog.tsx` | Client | `{ month: PeriodMonthStatus \| null; canPostDrafts: boolean; onOpenChange(open): void }` | 120 | `AlertDialog`. Sin borradores: "¿Cerrar marzo 2026?" + "Cerrar mes". Con N: "Marzo 2026 tiene N borradores sin registrar" + explicación + botón "Registrar los N borradores y cerrar" (requiere `accounting.entries` `approve`, si no: texto "pedile a alguien con permiso de registrar asientos") |
| `_ReopenPeriodDialog.tsx` | Client | `{ month: PeriodMonthStatus \| null; onOpenChange(open): void }` | 60 | `AlertDialog` de confirmación |
| `hooks/usePeriodLockMutations.ts` | Hook | — → `{ close, reopen }` | 60 | `useMutation`; si `!result.success` → `toast.error(result.error)`; si ok → toast + `invalidateQueries(['accounting', 'periodLockStatus'])` + `router.refresh()` |
| `_FiscalYearStatus.tsx` | Client | `{ status: FiscalYearCloseStatus }` | 150 | meses abiertos y borradores por mes con links a `/dashboard/company/accounting/settings#bloqueo-periodos` y `/dashboard/company/accounting/entries`; botón "Cerrar ejercicio N° X" deshabilitado si `!canClose`; bloque del último cerrado |
| `_ClosePreviewDialog.tsx` | Client | `{ fiscalYear: { id; number; startDay; endDay }; onClose(): void }` | 120 | `useQuery({ queryKey: ['accounting', 'fiscalYearClosePreview', id], queryFn })` (queryFn lanza `new Error(r.error)` si `!r.success`: el mensaje se arma en el cliente y no se redacta); `useMutation` de `closeFiscalYear`; fuera `useEffect` |
| `_ClosePreviewTables.tsx` | Client | `{ preview: ClosePreview }` | 120 | resumen (ingresos, gastos, resultado) + `ClosingLinesTable` (refundición) + `<details>` de apertura |
| `_ReverseEntryDialog.tsx` | Client | `{ entry: JournalEntryWithLines; onClose(): void }` | 110 | `useQuery({ queryKey: ['accounting', 'reversalCheck', entry.id], queryFn: getReversalCheck })`: si `link` → texto del bloqueo y botón deshabilitado; si `warning` → aviso ámbar; siempre "La anulación se registra con fecha de hoy (DD/MM/YYYY)". `ActionResult` |
| 7 componentes de Fase 12 | Client | sin cambio | +3-4 c/u | `_CreateEntryModal`, `_PostEntryDialog`, `_RecurringEntriesTable`, `_GeneratePendingDialog`, `_AccountBalancesForm`, `_CreateBankMovementDialog`, `_BankTransferDialog`; `_CommercialIntegrationForm` deja de leer y reenviar fechas (−5) |

Responsive: grilla `grid-cols-3 sm:grid-cols-4 md:grid-cols-6` como hoy; tablas del preview con
`overflow-x-auto`.

### 3.5 Rutas y navegación

Sin rutas nuevas ni ítems de sidebar.

- `/dashboard/company/accounting/settings` — card "Bloqueo de Períodos" con ancla
  `#bloqueo-periodos` (destino de los links del cierre anual y del texto de los mensajes).
- `/dashboard/company/accounting/fiscal-year-close` — links a la anterior y a
  `/dashboard/company/accounting/entries`.
- `revalidateAccountingRoutes(companyId)` después de cada mutación (ya cubre settings,
  entries, fiscal-year-close, opening-balances, recurring-entries).

### 3.6 APIs / Endpoints (Server Actions)

Ninguna API Route. Todas con `checkPermission` al inicio, `getActiveCompanyId()` (el
`companyId` del cliente se ignora o se quita), `BusinessError` + `toActionResult`. "No
autenticado"/"Sin empresa activa" siguen como `throw`.

| Action | Firma | Permiso | Estado |
|---|---|---|---|
| `createJournalEntry` | `(input: CreateJournalEntryInput) => Promise<ActionResult<{ id: string; number: number }>>` | entries create | modificada |
| `postJournalEntry` | `(entryId: string) => Promise<ActionResult<{ number: number }>>` | entries approve | modificada |
| `reverseJournalEntry` | `(input: { entryId: string }) => Promise<ActionResult<{ reversalNumber: number }>>` | entries approve | modificada |
| `deleteDraftJournalEntry` | `(entryId: string) => Promise<ActionResult>` | entries delete | nueva (C6, Fase 10) |
| `getReversalCheck` | `(entryId: string) => Promise<ActionResult<{ link: EntryDocumentLink \| null; warning: string \| null; date: IsoDay }>>` | entries approve | nueva |
| `getPeriodLockStatus` | `() => Promise<PeriodLockStatus \| null>` | settings view | nueva (reemplaza `getLockedPeriod`) |
| `closeAccountingPeriod` | `(input: YearMonth & { postDrafts: boolean }) => Promise<ActionResult<{ lockedUntil: IsoDay; postedDrafts: number }>>` | settings update (+ entries approve) | nueva (reemplaza `setLockedPeriod`) |
| `reopenAccountingPeriod` | `(input: YearMonth) => Promise<ActionResult<{ lockedUntil: IsoDay \| null }>>` | settings update | nueva |
| `getFiscalYearSettings` | `() => Promise<FiscalYearSettingsView \| null>` | settings view | nueva |
| `saveFiscalYearSettings` | `(input: { startDay: IsoDay; endDay: IsoDay }) => Promise<ActionResult<{ fiscalYearNumber: number }>>` | settings update | nueva |
| `saveAccountingSettings` | `(input: AccountsSettingsInput) => Promise<ActionResult>` | settings update | modificada (sin fechas) |
| `getFiscalYearStatus` | `() => Promise<FiscalYearCloseStatus \| null>` | fiscal-year-close view | modificada |
| `previewFiscalYearClose` | `(fiscalYearId: string) => Promise<ActionResult<ClosePreview>>` | fiscal-year-close view | modificada |
| `closeFiscalYear` | `(input: { fiscalYearId: string }) => Promise<ActionResult<{ closingEntryNumber: number; openingEntryNumber: number \| null; nextFiscalYearNumber: number }>>` | fiscal-year-close approve | modificada |
| `createBankMovement` | `(data: BankMovementFormData) => Promise<ActionResult<{ id: string }>>` | treasury.bank-accounts create | modificada (Fase 12) |
| `createBankTransfer` | `(data: BankTransferFormData) => Promise<ActionResult<{ id: string }>>` | ídem | modificada (Fase 12) |
| `generateRecurringEntry` | `(recurringEntryId: string) => Promise<ActionResult<{ id: string; number: number }>>` | recurring-entries create | modificada |
| `generateAllPendingRecurringEntries` | `() => Promise<ActionResult<{ generated: number; errors: string[] }>>` | ídem | modificada |
| `saveOpeningBalanceEntry` | `(input: OpeningBalanceFormInput, replaceExisting: boolean) => Promise<ActionResult<{ entryId: string; entryNumber: number }>>` | opening-balances create | modificada |
| `getEntriesWithoutDocuments` | igual | reports view | usa `entriesWithoutDocumentWhere` |
| `setLockedPeriod`, `getLockedPeriod` | — | — | borradas |

IVA, diferencia de cambio e inflación conservan su firma (sin UI, siguen lanzando; anotado en 2.4).

### 3.7 Consideraciones técnicas

#### 3.7.1 Casos de test por fase

Puros (`UT/*.test.ts`, sin DB) e integración (`*.integration.test.ts`, `describe.skipIf(!dbAvailable)`,
empresa propia con prefijo `TSK760-…`, mocks de `server-only`, `current-user`, `company`,
`permissions`, `next/cache` como `receipt-journal-entry.integration.test.ts`).

| Fase | Archivo | Casos |
|---|---|---|
| 2 | `UT/utc-month.test.ts` | día 1 00:00Z y 02:59Z → mes del día 1; `endOfMonthUtc` feb 2028 = 29 23:59:59.999Z; `monthsBetweenUtc` de un FY de 18 meses y de uno de 6; `isOnOrBeforeDayUtc` mismo día distinta hora; todo igual con `process.env.TZ = 'UTC'` y `'America/Argentina/Buenos_Aires'` (se fija antes de importar moment, en dos `describe` con `vi.resetModules`) |
| 2 | `UT/period-closure.test.ts` | cada causa sola; OR con datos desincronizados (escenarios 1 y 2 de 1.6.2); precedencia FY > período > bloqueo; OPENING/CLOSING ignoran `lockedUntilDate`; los 5 textos exactos de 3.3.2 |
| 2 | `UT/journal-entry-lines.test.ts` | 1 línea; 0/0; negativo; NaN; ambos lados; desbalance 0,01 rechaza y 0,009 pasa; `0.1 + 0.2` vs `0.3` balancea (Decimal); `invertLines` conserva auxiliares, `costCenterId` y moneda |
| 2 | `UT/fiscal-year-close-math.test.ts` | refundición con ganancia, con pérdida, con resultado 0 (sin línea de Resultado, H5); apertura balanceada con el resultado incluido (B21) |
| 2 | `UT/period-lock.integration.test.ts` | sin FY → crea FY 1 desde Ajustes 03:00Z normalizado; fecha del FY siguiente → lo crea contiguo con 12 MONTHLY + OPENING + CLOSING; dos adelante → TOO_FAR_AHEAD; anterior → BEFORE_FIRST_FY; mes cerrado / FY cerrado / `lockedUntilDate` → texto exacto; sin FY y fecha ≤ `lockedUntilDate` → LOCKED_UNTIL sin crear FY; OPENING/CLOSING (D12); período faltante → `ensurePeriodsTx` lo repara; `syncLockedUntilDateTx` con racha y con FY cerrado |
| 2 | `UT/journal-entry-tx.integration.test.ts` | número correlativo; **concurrencia de numeración**: 10 `prisma.$transaction(tx => createJournalEntryTx(…), { maxWait: 10_000, timeout: 10_000 })` en `Promise.all` → números 1..10 sin repetir y contador = 10; **salto de ocupados**: contador 5 con asientos 6 y 7 sembrados → devuelve 8; **cierre concurrente**: tx A toma `lockAccountingSettingsTx`, espera una promesa, cierra el mes; tx B `createJournalEntryTx` en ese mes arranca después y termina con "el período está cerrado"; DRAFT y POSTED con `fiscalYearId`/`periodId`; desbalance → BusinessError sin consumir número; cuenta de otra empresa y no hoja → BusinessError; copia de auxiliares, moneda y `costCenterId` (TSK-583/719); `postJournalEntryTx` de FY cerrado (B4); `reverseJournalEntryTx` copia todo y deja el original REVERSED con `reversalEntryId` |
| 3 | `ACC/features/fiscal-year-close/fy-backfill.integration.test.ts` | siembra (a)-(h) de 3.2.3 en empresas propias, ejecuta `migration.sql` con `pg.Client` (`client.query(sql)` multi-sentencia), verifica la tabla de esperados, la huella, los triggers `'O'`, y que una segunda ejecución no cambia la huella. Limpieza con `SET LOCAL session_replication_role = 'replica'` |
| 3 | `ACC/features/settings/accounting-settings.integration.test.ts` | primera vez → FY 1 con períodos; cambiar fechas con asientos → `{ success: false }` con el texto; sin asientos → regenera; día no 1 → rechazo; `saveAccountingSettings` sin Ajustes → rechazo; `_CommercialIntegrationForm` ya no manda fechas (tipo) |
| 4 | `ACC/features/entries/entries.integration.test.ts` | DRAFT con FY/período/número; mes cerrado; post de DRAFT en FY cerrado (B4); post de DRAFT desbalanceado (sembrado por SQL); validadores devuelven `BusinessError` legible; `companyId` ajeno no se usa |
| 5 | 6 tests existentes (receipt, payment-order, expense, sales-invoice-line-accounts, purchase-invoice-line-accounts, asset-disposal) | siguen verdes sin tocar el texto; + caso "mes cerrado por `AccountingPeriod` sin `lockedUntilDate`" (B3) + "asiento con `fiscalYearId`/`periodId`"; limpieza con FY creados |
| 5 | `DEP/depreciation-period-lock.integration.test.ts` | individual, revalúo y masiva con un mes cerrado (masiva: aparece en `errors[]`, los demás se contabilizan) |
| 6 | `fund-movement-lines.integration.test.ts` + `TRE/bank-movements/bank-movement-period-lock.integration.test.ts` | numeración atómica y FY/período; movimiento manual y dos transferencias en mes abierto (asiento) y cerrado (rechazo, sin movimiento ni saldo cambiado); sin Ajustes → movimiento sin asiento (se conserva) |
| 7 | `recurring-entries.integration.test.ts`, `opening-balances.integration.test.ts`, `vat-settlement/generators-period-lock.integration.test.ts` | abierto/cerrado, numeración, FY/período; apertura en OPENING; **editar apertura** = reversión + nuevo (B25), búsqueda por FY (H3); IVA/cambio/inflación rechazan mes cerrado |
| 8 | `ACC/features/settings/period-lock.integration.test.ts` | cerrar en orden; fuera de orden; reabrir el último; reabrir primer mes del FY nuevo con el anterior cerrado (B5); con DRAFT sin/con `postDrafts`; DRAFT desbalanceado aborta todo (nada cerrado, nada registrado); `lockedUntilDate` = fin UTC del último; diciembre con `TZ` UTC y AR (B22); `getPeriodLockStatus` con `action` correcto |
| 9 | `ACC/features/fiscal-year-close/fiscal-year-close.integration.test.ts` | meses abiertos → texto; DRAFT → texto; sin resultados (B20); resultado 0 (H5); cuenta de resultado inactiva con saldo entra (H5); cierre feliz: refundición y apertura balanceadas, FY siguiente con 12 meses, períodos del FY cerrado todos cerrados, OPENING del nuevo cerrado; FY siguiente ya existente reutilizado (B24); después: Balance y Sumas y Saldos del FY nuevo = saldos del cerrado (no el doble, B18), Estado de Resultados del cerrado ≠ 0 (B19), IVA de enero sin la apertura (H4); reabrir mes del FY cerrado → rechazo; **segundo cierre** (FY 2) no duplica (excluye la apertura de FY 2); `openingEntryId` solo lo escribe el cierre (#19 no lo toca) |
| 9 | `cost-center-movements.*`, `reports/*` existentes | verdes |
| 10 | `ACC/features/entries/reverse-entry.integration.test.ts` | copia auxiliares, moneda y centro de costo; original en mes cerrado → texto con `subject`; hoy en mes cerrado → rechazo; factura / gasto / fondos (columna sin relación) / refundición → texto de 3.3.7; manual → anula; `getReversalCheck` da aviso para `'system'` sin vínculo |
| 12 | tests de fases 4, 6, 7 | de `rejects.toThrow(/el período está cerrado/)` a `{ success: false, error: expect.stringContaining('el período está cerrado') }` |

**Helper de limpieza** compartido para tests (R7): `ACC/shared/test-utils/cleanup-accounting-company.ts`
(no termina en `.test.ts`, Vitest no lo corre): en una tx con
`SET LOCAL session_replication_role = 'replica'` borra líneas y asientos de la empresa, y después
`fiscal_years` (cascada a períodos). Los tests nuevos y los 6 existentes lo llaman antes de borrar
la empresa: con FY creados de forma perezosa, borrar la empresa primero dispararía el `SET NULL`
de `journal_entries.fiscal_year_id` sobre asientos POSTED y el trigger lo rechazaría.

#### 3.7.2 Invariantes a no romper

- **TSK-728 (errores como dato, nada en silencio):** ningún creador devuelve `null` ante error; el
  período cerrado es `BusinessError` que llega como `{ success: false, error }`. Única excepción
  conservada a propósito: bancos sin Ajustes (2.0). `grep -rn "return null" ` en los creadores en
  Fase 11.
- **TSK-583/719 (centros de costo en líneas):** `createJournalEntryTx` persiste `costCenterId` de
  cada línea tal cual; `expandByCostCenter` sigue en `INT/commercial` antes de llamar al núcleo; la
  reversión invierte conservando `costCenterId`. Test en Fase 2 y Fase 10;
  `cost-center-movements.*` verdes.
- **TSK-717/721/757 (cuentas):** las pre-validaciones de cuentas por documento siguen antes de la
  tx con sus mensajes; `assertAccountsUsableTx` es defensa en profundidad (empresa + hoja) y no
  reemplaza a `buildImputableAccountsWhere`. La cuenta de aportes por socio (717) y las de ítems
  (721/757) no cambian.
- **Numeración única:** solo `nextEntryNumberTx` asigna números (`grep "lastEntryNumber + 1\|journalEntry.create(" src/modules` → solo `UT/journal-entry-tx.ts`);
  `@@unique([companyId, number])` sigue siendo la red final.
- **Inmutabilidad:** nadie hace `UPDATE` de un POSTED salvo la transición a REVERSED en un solo
  `UPDATE`; la única desactivación del trigger es la de la migración.
- **Permisos:** sin permisos nuevos (D10).

#### 3.7.3 Rendimiento y concurrencia

- Cada asiento suma 2-3 lecturas (lock, FY, período) a la tx; la creación ya estaba serializada por
  empresa por el `UPDATE` del contador, así que el lock no agrega espera nueva.
- `closeAccountingPeriod` y `closeFiscalYear` corren con `{ timeout: 30_000, maxWait: 10_000 }`
  (H10). Mientras corren, la creación de asientos de esa empresa espera (es el objetivo, R4).
- `getPeriodLockStatus` arma los conteos de borradores con un solo `groupBy` por mes
  (`date_trunc('month', date)`) en el rango de los FY mostrados.

#### 3.7.4 Diseño de `GP/capturas-tsk760.mjs`

Molde `capturas-tsk728.mjs` (Playwright con Chrome del sistema, login con las credenciales de dev,
puerto 3010 con `NEXT_PUBLIC_APP_URL` sobrescrito; memoria `dev-local-capturas-y-login`).

- **Uso:** `node scripts/guia-presentacion/capturas-tsk760.mjs [baseUrl]` (01-04 y 08-10),
  `… --copia` (05-07, sobre la base copia), `… --prod` (11-12 contra :3011), `… --restore`.
- **Siembra por `psql`** sobre "Empresa de Prueba 01 SA" (`COMPANY_ID` del molde), marcada
  `TSK760-demo` en la descripción de los asientos: guarda antes el estado de
  `accounting_periods.is_closed`, `fiscal_years` y `accounting_settings.locked_until_date/fiscal_year_*`
  de la empresa; crea por las actions (vía UI) o por SQL 3 asientos manuales DRAFT en marzo y uno
  POSTED de factura; deja enero y febrero cerrados.
- **Recorrido:**
  01 Configuración → Bloqueo de Períodos (ene-feb cerrados, marzo con "3 borradores").
  02 Clic en marzo → diálogo "Marzo 2026 tiene 3 borradores" con "Registrar los 3 borradores y cerrar".
  03 Asientos → nuevo asiento manual con fecha 15/02 → toast "el período está cerrado (mes 02/2026 cerrado)".
  04 Con FY 2 sembrado y FY 1 cerrado por SQL: primer mes de FY 2 → nota del piso, sin botón de reabrir.
  05 Cierre de ejercicio con meses abiertos y borradores → lista y links.
  06 Cierre ejecutado (todos los meses cerrados por SQL) → toast + números de refundición y apertura.
  07 Reportes → Balance al 31/01 del FY nuevo (sin duplicar).
  08 Asientos → anular asiento de factura → diálogo bloqueado con el texto de 3.3.7.
  09 Anular movimiento bancario → aviso ámbar.
  10 Configuración → fechas del ejercicio de solo lectura.
  11-12 (`--prod`) toasts de 03 y 08 contra el build de producción (texto real, no el digest).
- **Restauración:** 01-04 y 08-10 solo crean datos marcados `TSK760-demo` y cambian
  `is_closed`/`locked_until_date`; en `finally` (y con `--restore`) se borran los asientos marcados
  (con `SET LOCAL session_replication_role = 'replica'`, son POSTED) y se reponen los valores
  guardados. 05-07 **cierran un ejercicio** (asientos POSTED inmutables, FY nuevo): se corren solo
  con `--copia`, contra `contable_tsk760_copia` (dev server levantado con el `DATABASE_URL` de la
  copia); el script verifica `current_database()` y se niega a correrlos sobre `contable_pms`.

#### 3.7.5 Documentación

Sin cambios respecto de la Fase 13; agregar en `docs/modules/accounting.md` la tabla de mensajes
(3.3.2), el invariante `openingEntryId`, la regla de lock y la exclusión de 3.3.8; en
`docs/architecture/data-model.md`, las convenciones de 3.2.1.

#### 3.7.6 Notas de deploy (texto para el PR)

1. **Antes (diagnóstico, solo lectura):** en el servidor,
   `bash prisma/scripts/diagnostico-tsk760.sh > diag-antes.txt`. Revisar:
   - 0: el usuario de la base es dueño de `journal_entries` y los dos triggers están `O`
     (si no es dueño, **no deployar**: la migración falla y queda P3009);
   - 1 y 12: empresas que reciben FY nuevo y FY con `month 0/13`;
   - 4, 6 y 8: tamaño del cambio de comportamiento (borradores en meses que quedan cerrados,
     meses desincronizados, comprobantes en borrador con fecha bloqueada); si hay filas, avisar a la
     clienta con la presentación **antes** del deploy;
   - 7: contador; 13: asientos anteriores al primer ejercicio;
   - 14: huella (para comparar después);
   - zona horaria del contenedor de la app (B22).
2. **Backup:** `sudo docker exec $(sudo docker ps -q --filter name=contablemas-contablemas) sh -c 'pg_dump -U "$POSTGRES_USER" -Fc "$POSTGRES_DB"' > contable-antes-tsk760.dump`
   y comprobar que pesa más de 0 bytes.
3. **Deploy:** la migración `tsk_760_fiscal_years_backfill` la aplica `docker-entrypoint.sh` al
   arrancar (transaccional e idempotente). Verificar con
   `sudo docker exec $(sudo docker ps -q --filter name=contablemas-frontend) node node_modules/prisma/build/index.js migrate status`.
   Si figura fallida (P3009): la base quedó como antes (BEGIN/COMMIT); corregir, `migrate resolve
   --rolled-back <nombre>` y redeployar.
4. **Después:** `bash prisma/scripts/diagnostico-tsk760.sh > diag-despues.txt`. Esperado: consulta 2
   sin asientos sin ejercicio salvo los de la 13; 6 y 7 vacías (salvo números aislados reportados);
   triggers `O`; FY para toda empresa con Ajustes. Si la réplica vieja creó asientos durante el
   deploy y la consulta 2 muestra alguno sin ejercicio, correr el paso 4 de la migración a mano (se
   deja como `prisma/scripts/tsk760-backfill-asientos.sql`, idempotente).
5. Sin permisos, módulos ni variables de entorno nuevas (`TZ` no hace falta).
6. Comportamiento visible para la clienta: link al PDF `docs/presentaciones/TSK-760-cierre-contable.pdf`.

#### 3.7.7 Decisiones de diseño a confirmar por el líder

| # | Decisión | Alternativa |
|---|---|---|
| C1 | Contador = fin de la racha contigua + `nextEntryNumberTx` que saltea ocupados (en vez de `GREATEST(max)`) | `GREATEST` del plan: un número aislado alto en prod dispararía la numeración |
| C2 | B25: "editar saldos de apertura" = revertir + nuevo (dos asientos POSTED más por edición) | Dejar la edición rota y ocultar el botón; queda para 758 |
| C3 | Separar `saveFiscalYearSettings` de `saveAccountingSettings` y exigir ejercicios de meses completos (día 1 a fin de mes); fechas editables solo si la empresa no tiene **ningún** asiento | Mantener una sola action y comparar fechas por día |
| C4 | Refundición sobre saldos de resultado **acumulados** al fin del FY, incluidas cuentas inactivas, y sin línea de Resultado cuando da 0 | Solo el rango del FY: si hay resultados viejos sin refundir, la apertura no balancea y el cierre se rechaza |
| C5 | Validar balance también en DRAFT, más empresa + hoja de cada cuenta, en el núcleo | Solo POSTED (plan); hoy todos los creadores ya lo exigen |
| C6 | Un borrador imposible de registrar bloquea el cierre de su mes (D2 todo o nada) y no hay acción para borrarlo (H9) | Agregar "eliminar borrador manual" (fuera de alcance, chico) |
| C7 | El OPENING del ejercicio creado por un cierre queda cerrado: no se cargan saldos de apertura manuales en FY ≥ 2 | Dejarlo abierto (riesgo de duplicar la apertura) |
| C8 | La migración crea ejercicios hacia adelante hasta hoy + 1 año como máximo; lo posterior queda sin FY y se reporta | Sin tope (un asiento con año mal tipeado crearía decenas de FY) |

**Decisiones del líder (2026-10-06):**

| # | Decisión |
|---|---|
| C1 | Adoptada tal como propone el diseño (racha contigua + salteo de ocupados). |
| C2 | Adoptada (editar apertura = revertir + nuevo). |
| C3 | Adoptada (`saveFiscalYearSettings` separada, meses completos, fechas editables solo sin asientos). |
| C4 | Adoptada (refundición sobre resultados acumulados, cuentas inactivas incluidas, sin línea de Resultado en 0). |
| C5 | Adoptada (balance también en DRAFT + empresa y hoja de cada cuenta en el núcleo). |
| C6 | **Cambia:** se agrega la acción **"Eliminar borrador"** solo para asientos DRAFT manuales sin documento vinculado (`getEntryDocumentLink` nulo), con `accounting.entries` `delete` (existe), para que un borrador trabado no impida cerrar un mes. D2 "todo o nada" se mantiene. Asignada a la **Fase 10** (depende de `getEntryDocumentLink`); ver tarea en 2.1 y `deleteDraftJournalEntry` en 3.6. |
| C7 | Adoptada: la apertura generada por el cierre queda en un período (OPENING) cerrado. |
| C8 | Adoptada (tope hoy + 1 año en la migración). |


## 4. Implementación

### Fase 1: Script de diagnóstico de producción y línea base
**Estado:** Completada (2026-10-06)

**Archivos creados:**
- `prisma/scripts/diagnostico-tsk760.sh` (ejecutable): diagnóstico de solo lectura.

**Notas:**
- Solo lectura garantizada en tres capas: `SET default_transaction_read_only = on` (sesión),
  todo dentro de `BEGIN TRANSACTION READ ONLY` … `ROLLBACK`, y ninguna sentencia de escritura
  (verificado con grep: la única aparición de `ALTER TABLE` está dentro de un `\echo`). Los
  `SET LOCAL` (`statement_timeout`, `TimeZone = 'UTC'`) mueren con la transacción.
  `psql -X -v ON_ERROR_STOP=1`.
- Modos: sin argumento = producción (`sudo docker`, contenedor por filtro
  `name=contablemas-contablemas`; aborta si hay 0 o más de 1); `--local` (`contable-pms-db`,
  `docker` sin `sudo` si alcanza); `--db <contenedor>`; `--database <base>` (nuevo respecto del
  plan: la copia de la Fase 3 es una **base** dentro de `contable-pms-db`, no un contenedor).
- Al inicio imprime los comandos para leer `printenv TZ` y `date` del contenedor de la app; en
  modo producción además los ejecuta (sin fallar si TZ no está definida).
- Consultas: 0 (dueño de `journal_entries`, triggers, migraciones fallidas), 1–11 de §1.6.3 (1 con
  hora del bloqueo y `meses_completos` para C3; 5 con `LEFT JOIN`; 7 separa racha contigua de
  números aislados para C1), 12 (FY existentes: meses 0/13, rango vs. Ajustes; empresas con Ajustes
  sin FY), 13 (antes del inicio, recientes y más allá de hoy + 1 año, C8), 14 (huella de 3.2.4),
  15 (resultados: cuentas inactivas con saldo y resultado previo al ejercicio, C4/H5), 16
  (borradores trabados con/sin documento, C5/C6) y un **RESUMEN** A–T con "cómo leerlo", más un
  texto final que separa lo que bloquea el deploy, lo que cambia la Fase 3 y lo que requiere aviso
  a la clienta.
- Asiento local **999999** ("dbg") **no se borró**: con C1 no hace falta para la migración y queda
  como caso real de "número aislado" (P = 1 en el resumen). Se puede borrar a mano si molesta.
- **Línea base:** `npm run check-types` = **219** errores `TS`; `npm run test` = **48 archivos,
  601 tests, todos verdes**.
- Salida `--local` (2026-10-06) resumida, coincide con 1.2.7:
  - 0: usuario `postgres`, dueño y superusuario; los dos triggers `O`; 0 migraciones fallidas.
  - 1: "Empresa de Prueba 01 SA" con Ajustes 2026-01-01 03:00 → 2026-12-31 03:00, sin bloqueo,
    contador 49, 0 FY, 32 asientos; "Empresa Demo S.A." sin Ajustes.
  - 2: 27 DRAFT + 5 POSTED, todos sin ejercicio ni período. 3, 4, 5, 6, 8, 9, 11, 13: sin filas.
  - 7: 1 número aislado (999999), racha contigua 0. 10: 4 asientos cambian de mes UTC vs. UTC-3.
  - 12: sin FY; 1 empresa con Ajustes sin FY. 15: 7 cuentas de resultado con saldo, 0 inactivas,
    resultado previo 0. 16: 27 borradores, 6 sin documento, 0 trabados.
  - Resumen: A=true, B=2, C=0, D=1, E=1, F=0, G=0, H=0, I=0, J=0, K=0, L=0, M=0, N=0, O=0, P=1,
    Q=0, R=0, S=0, T=0.
- **Pendiente del usuario (bloqueante para la Fase 3):** correr el script en producción y pegar
  la salida acá.

### Fase 2: Núcleo — mes UTC, `assertPeriodOpen`, numeración y `createJournalEntryTx` (TDD)
**Estado:** Completada (2026-10-06)

**Archivos creados** (`UT/` = `src/modules/accounting/shared/utils/`):
- `UT/journal-entry-types.ts`: `Tx`, `IsoDay`, `YearMonth`, `EntryPeriodType`,
  `CreatableEntryStatus`, `Amount` (sin `server-only`).
- `UT/utc-month.ts` (puro, `moment.utc`): las 15 funciones de §3.3.1.
- `UT/period-closure.ts` (puro): `evaluatePeriodClosure` y `buildPeriodClosedMessage` con los
  textos exactos de §3.3.2.
- `UT/journal-entry-lines.ts` (puro, `Decimal`): `validateEntryLines` (C5: también DRAFT) e
  `invertLines`.
- `UT/period-lock.ts` (`server-only`): `lockAccountingSettingsTx` (SQL exacto `FOR UPDATE`),
  `findFiscalYearForDateTx`, `ensureFiscalYearTx` (D1), `createFiscalYearWithPeriodsTx`,
  `ensurePeriodsTx`, `assertPeriodOpen` (A2/D12), `listMonthlyPeriodsTx`,
  `syncLockedUntilDateTx`; exporta `NO_SETTINGS_MESSAGE`.
- `UT/journal-entry-tx.ts` (`server-only`): `assertAccountsUsableTx`, `nextEntryNumberTx` (SQL
  exacto de C1: racha contigua + salteo de ocupados), `createJournalEntryTx`, `postJournalEntryTx`.
- `ACC/features/integrations/core/index.ts`: reexporta `createJournalEntryTx`,
  `postJournalEntryTx`, `assertPeriodOpen` y sus tipos (D9).
- `ACC/shared/test-utils/cleanup-accounting-company.ts`: limpieza de tests (R7, §3.7.1) con
  `SET LOCAL session_replication_role = 'replica'`, borrando líneas → asientos → períodos →
  ejercicios (con `replica` tampoco corren las cascadas de FK).

**Archivos modificados:**
- `UT/index.ts`: reexporta **solo** los módulos puros (`utc-month`, `period-closure`,
  `journal-entry-lines`, tipos). Los `server-only` no, porque este índice lo importan componentes
  cliente (`_MonthlyBalanceView`, `_IncomeStatementReport`, …).

**Tests (111 nuevos, todos verdes; TDD: se escribieron primero y fallaron por módulo inexistente):**
- `UT/utc-month.test.ts` (44 = 22 × 2 zonas): la batería entera corre con `TZ=UTC` y con
  `TZ=America/Argentina/Buenos_Aires` (`vi.resetModules` + import dinámico) y verifica que la zona
  efectivamente cambió; día 1 00:00Z/02:59Z, febrero bisiesto, FY de 18 y 6 meses, Ajustes a las
  03:00Z → 12 meses, `isOnOrBeforeDayUtc`, `parseIsoDay` inválido → `BusinessError`, formatos.
- `UT/period-closure.test.ts` (18): cada causa sola, escenarios 1 y 2 de 1.6.2, precedencia, día
  exacto de `lockedUntilDate` a las 02:59:59.999, OPENING/CLOSING ignoran el bloqueo, los 5 textos
  exactos más el de `subject`.
- `UT/journal-entry-lines.test.ts` (13): 0/1 línea, 0/0, negativo, NaN/Infinity, ambos lados,
  desbalance (texto actual), 0,01 rechaza y 0,009 pasa, `0.1 + 0.2` vs `0.3`, `Decimal` de Prisma,
  `invertLines` conserva auxiliares/centro/moneda.
- `UT/period-lock.integration.test.ts` (18): NO_SETTINGS; sin FY → FY 1 normalizado (00:00Z /
  23:59:59.999Z) con OPENING + 12 MONTHLY + CLOSING; fecha dentro → no crea; FY siguiente contiguo
  con 14 períodos; sin FY y fecha del siguiente → FY 1 y 2; TOO_FAR_AHEAD; BEFORE_FIRST_FY; borde
  31/12 23:59Z vs 01/01 00:30Z; mes / FY / `lockedUntilDate` con texto exacto; sin FY y fecha ≤
  bloqueo → LOCKED_UNTIL **sin crear FY** (contado dentro de la misma tx); OPENING/CLOSING (D12);
  autorreparación con `ensurePeriodsTx`; `syncLockedUntilDateTx` con hueco y con FY cerrado.
- `UT/journal-entry-tx.integration.test.ts` (18): correlativo; **concurrencia: 10
  `$transaction(createJournalEntryTx)` en `Promise.all` (DRAFT y POSTED alternados) → números
  1..10 sin repetir, contador = 10, un único FY creado**; C1 salto de ocupados (contador 5 + 6 y 7
  sembrados → 8) y número aislado 999999 que no dispara la numeración (→ 1); NO_SETTINGS; **cierre
  concurrente**: la tx A toma el lock y retiene, la creación B queda esperando (se verifica que no
  terminó a los 300 ms), A cierra marzo y confirma, B falla con "el período está cerrado (mes
  03/2026 cerrado)" sin consumir número; DRAFT/POSTED con `fiscalYearId`/`periodId` y `postDate`;
  copia de auxiliares, moneda, `originalAmount`, `exchangeRate` y `costCenterId`; OPENING;
  desbalance DRAFT y POSTED sin consumir número; cuenta ajena y no hoja; mes cerrado;
  `postJournalEntryTx`: corrige asiento viejo sin FY/período, no-DRAFT, inexistente/ajeno, FY
  cerrado (B4), DRAFT desbalanceado sembrado.
- Cada integración usa empresas propias (`TSK760-PL-…`, `TSK760-JE-…`); `afterAll` limpia y
  afirma 0 empresas, cuentas, asientos, FY y períodos remanentes (verificado además por `psql`).

**Calidad:** `npm run test` = **53 archivos, 712 tests, todos verdes** (línea base 48/601);
`npm run check-types` = **219** (igual a la línea base); `eslint` sin errores en los archivos
nuevos. `UT/index.ts` conserva un error y un warning **previos** (el `require('next/cache')` de
`revalidateAccountingRoutes`, verificado contra `HEAD`); no se tocó porque ese índice lo importan
componentes cliente. Sin `any` ni `console`. Ningún caller cambiado.

**Desvíos (mínimos):**
- El plan ubicaba `evaluatePeriodClosure` en `UT/period-lock.ts` y la reexportación en
  `INT/index.ts` (que no existe); se siguió el Diseño: `UT/period-closure.ts` (puro) y
  `INT/core/index.ts` (§3.1.1).
- `reverseJournalEntryTx` y `fiscal-year-close-math` figuran en la tabla de tests de Fase 2 de
  §3.7.1, pero el plan los asigna a las Fases 10 y 9: quedan para esas fases. `invertLines`
  (puro, trivial) sí entró con su test. `syncLockedUntilDateTx`/`listMonthlyPeriodsTx` se
  adelantaron (los pide §3.7.1 para esta fase; los usa la Fase 8).
- Ejemplo de TOO_FAR_AHEAD de §3.3.3 ("05/03/2028 … N° 2, hasta 31/12/2027") es internamente
  inconsistente (esa fecha cae en el FY inmediato siguiente al N° 2); se respeta la plantilla del
  texto y el test usa FY 1 2026 con fecha 05/03/2028 → "(N° 1, hasta 31/12/2026)".
- `ensureFiscalYearTx`: una fecha entre dos FY no contiguos (no debería existir) lanza
  `BusinessError` "La fecha … no pertenece a ningún ejercicio…" (caso no previsto en el diseño).
- `ensurePeriodsTx` crea OPENING/CLOSING solo si el FY no tiene **ninguno** de ese tipo (no solo
  por clave única), para no duplicarlos sobre FY de 20260625 con `month = 0/13` antes de la Fase 3.
- `findFiscalYearForDateTx` compara por día UTC (`startDate <= fin del día`, `endDate >= inicio
  del día`), y `ensureFiscalYearTx` busca el FY por día: tolera FY todavía sin normalizar.
- `parseIsoDay` inválido: `BusinessError` "Fecha inválida: X. Usá el formato AAAA-MM-DD." (texto
  no fijado por el diseño). `formatMonthLabel` usa una tabla propia de meses (el locale `es` de
  moment devuelve "mar." con punto).
- `LineTotals` usa el tipo `Prisma.Decimal` de `client` y el valor de `@/generated/prisma/browser`
  (el namespace del navegador solo exporta el valor), para que `journal-entry-lines` sea usable en
  cliente.

### Fase 3: Migración de datos y sincronización de Ajustes con el ejercicio
**Estado:** Completada (2026-10-06/07) **sin** la salida del diagnóstico de producción (decisión del líder:
implementar ahora y ajustar si producción revela algo; ver la tabla "letra → suposición" al final).

**Archivos creados:**
- `prisma/migrations/20261007020224_tsk_760_fiscal_years_backfill/migration.sql`: SQL a mano, `BEGIN;`/`COMMIT;`
  explícitos (H1), idempotente. El timestamp va **después** de `20261006214031_tsk_757_expense_category_account`
  (aplicada en la base de dev desde la rama de 757, ver desvíos).
- `prisma/scripts/tsk760-escenarios-migracion.sql`: siembra 9 empresas `TSK760-MIG-x` (ids fijos
  `76076076-0003-4000-8000-000000000NNN`) en la **copia**; se niega a correr sobre `contable_pms`.
- `prisma/scripts/tsk760-escenarios-verificar.sql`: ~45 afirmaciones (`RAISE EXCEPTION` en la primera que falla,
  termina en `ROLLBACK`) por escenario + invariantes globales (FY normalizados, exactamente un OPENING y un CLOSING
  por FY, ningún MONTHLY fuera de rango, ningún asiento con FY y sin período ni en un período de otro FY,
  consulta 6 vacía, triggers `O`).
- `ACC/features/settings/fiscal-year-settings.ts` (`server-only`, sin `'use server'`, H7):
  `buildFiscalYearSettingsTx` y `saveFiscalYearSettingsTx`.
- `ACC/features/settings/accounting-settings.integration.test.ts` (7 tests, prefijo `TSK760-AJ-`).

**SQL final, resumido** (diferencias con §3.2.2 en **negrita**):
1. Normaliza FY a `día 00:00` / `día 23:59:59.999`. **Un fin a las `02:59:59.999` (fin del día local guardado con
   el servidor en UTC-3) cuenta como el día anterior** (`pg_temp.tsk760_dia_fin`). OPENING/CLOSING `0/13` (o de otro
   mes) → mes real de inicio/fin, **sin pisar la clave única si un FY tuviera dos** (quedan y se informan).
2. FY 1 desde Ajustes para empresas sin FY (**solo si el rango es válido**: fin > inicio; si no, se informa) y FY
   contiguos de 12 meses hasta cubrir hoy (UTC) o el último asiento, **ignorando para ese objetivo los asientos más
   allá de hoy + 1 año** (un 2030 mal tipeado no crea el FY 2027).
3. Períodos: un MONTHLY por mes del rango + OPENING + CLOSING (`ON CONFLICT` / `NOT EXISTS`).
4. `DISABLE TRIGGER trg_journal_entry_immutable` → un único `UPDATE` de `fiscal_year_id/period_id` → `ENABLE`.
   FY por **día UTC** (`j.date::date BETWEEN`, como `findFiscalYearForDateTx`), **`DISTINCT ON` por el de menor
   número si se solaparan**; **sin FY → `NULL`** (antes el diseño dejaba el valor viejo). Período: refundición →
   CLOSING; apertura generada o "Asiento de Apertura" del día de inicio → OPENING; **si ya está en el
   OPENING/CLOSING de ese FY se conserva** (reversión de una apertura, Fase 7: si no, el backfill la habría movido a
   MONTHLY y la segunda corrida del código no coincidiría); si no, MONTHLY del mes UTC (corrige los mal imputados
   por hora local).
5. **Borrado de MONTHLY fuera de rango sin asientos, movido a después del paso 4** (así también se van los que solo
   referenciaban asientos que el paso 4 reubicó).
6. Cierre: unión con `locked_until_date` (D3), FY cerrado → todos sus períodos, **OPENING del FY que sigue a uno
   cerrado → cerrado (C7, como `closeFiscalYearTx`)**, huecos, `locked_until_date` = fin del último MONTHLY cerrado
   (o NULL), Ajustes = FY abierto más antiguo (D11).
7. Contador C1 (fin de la racha contigua; un aislado no lo mueve).
8. **Red de seguridad: si el trigger no quedó `O`, `RAISE EXCEPTION` (rollback de todo)**, y `NOTICE` de: empresas
   sin FY por rango inválido, asientos sin FY (por empresa, con rango de fechas), asientos con FY y sin período, FY
   con dos OPENING/CLOSING, números aislados.

Trigger "re-habilitado aunque falle": está garantizado por la transacción. Se probó en la copia `BEGIN; ALTER TABLE …
DISABLE TRIGGER …; SELECT 1/0; COMMIT;` → error, rollback, `tgenabled = 'O'`. Prisma 7 ejecuta el archivo tal cual
(`migrate deploy` lo aplicó con `BEGIN/COMMIT` y `DO $$` sin problemas). Si cualquier paso falla, la base queda como
estaba y Prisma marca P3009 (`migrate resolve --rolled-back` antes de redeployar, §3.7.6).

**Prueba en la copia** (`contable_tsk760_copia`, `pg_dump -Fc` de `contable_pms` + `pg_restore` dentro del
contenedor; borrada al final): siembra → diagnóstico → `DATABASE_URL=…/contable_tsk760_copia npx prisma migrate
deploy` → verificación → segunda corrida por `psql -f` → huellas.

| Empresa | Siembra | Resultado (verificado por `tsk760-escenarios-verificar.sql`: OK) |
|---|---|---|
| 001 A (a, F) | Ajustes 2024 a las 03:00Z, sin FY, asientos 2024, 2025 (uno el día 1 a las 00:30Z) y 03/2026, "Asiento de Apertura" 01/01/2024 03:00Z | FY 1 2024, FY 2 2025, FY 3 2026 (12 MONTHLY + OPENING + CLOSING c/u); apertura → OPENING FY 1; 00:30Z del 01/02 → 02/2025; Ajustes = FY 1 (abierto más antiguo) |
| 002 B (b, d, 12) | FY de 20260625 (03:00Z, OPENING 0, CLOSING 13, MONTHLY de 12/2025 a 01/2027), bloqueo UI `2026-04-01 02:59:59.999`, DRAFT feb, POSTED mar, REVERSED + reversión ene, DRAFT abr, DRAFT 20/12/2025 apuntando al MONTHLY 12/2025 | FY normalizado, OPENING 2026-1 / CLOSING 2026-12, 12 MONTHLY (12/2025 y 01/2027 borrados), ene-mar cerrados, abr abierto, bloqueo `2026-03-31 23:59:59.999`; POSTED y REVERSED con FY/período (trigger de vuelta en `O`); DRAFT de 2025 → `NULL/NULL` |
| 003 C (c) | FY normalizado, ene-feb `is_closed`, bloqueo NULL; POSTED del 01/05 00:00Z imputado a abril; apertura REVERSED y su reversión POSTED en OPENING | bloqueo `2026-02-28 23:59:59.999`; el del 01/05 → 05/2026; ambas aperturas siguen en OPENING |
| 005 E (e, Q, R) | Ajustes 2025 sin FY; asientos 15/12/2024, 2025, 10/03/2027 y 10/01/2030 | FY 2025, 2026 y 2027 (por el asiento de 2027); 2024 y 2030 → `NULL` e informados |
| 006 F (f) | marzo cerrado, ene-feb abiertos | ene-mar cerrados, bloqueo 31/03 |
| 007 G (g, G, T, 12) | FY 1 2025 cerrado por el código viejo (noviembre y CLOSING abiertos, refundición vinculada); FY 2 hasta `2027-01-01 02:59:59.999` con 13 MONTHLY y CLOSING 2027-1, apertura vinculada, OPENING abierto; Ajustes en 2025; cuenta REVENUE inactiva con saldo POSTED | FY 1: 14 períodos cerrados; FY 2: fin 2026-12-31 23:59:59.999, 12 MONTHLY, CLOSING 2026-12, OPENING cerrado (C7); Ajustes = FY 2; bloqueo 31/12/2025; refundición → CLOSING FY 1, apertura → OPENING FY 2; cuenta intacta |
| 008 H (h, O, P) | contador 10, asientos 10, 11, 12 y 999999 | contador 12; NOTICE por el 999999 |
| 009 I (robustez) | Ajustes con fin anterior al inicio y un asiento | sin FY, Ajustes intactos, asiento `NULL`, NOTICE |
| 010 J (meses incompletos) | Ajustes 15/01/2026 → 14/01/2027 sin FY | FY 1 con ese rango y 13 MONTHLY; el asiento del 10/01/2027 → 01/2027 del FY 1 |

Las empresas reales de la copia (las de dev) también: "Empresa de Prueba 01 SA" 43/43 asientos con FY y período,
Ajustes 03:00Z → normalizados; "TSK760 Demo cierre anual" (creada por el código de la Fase 9) sin cambios salvo sus
6 asientos sembrados sin FY.

**Idempotencia (copia):** huella de §3.2.4 + `updated_at` de FY, períodos y Ajustes, antes y después de la segunda
corrida — **idénticas**: `fy 5a99e588…`, `periodos c0ac3886…`, `asientos f31ccc20…`, `ajustes 818e7c85…`,
`updated_at 9699cb53…`. Segunda corrida: todos los `UPDATE/INSERT/DELETE 0`, NOTICE "ejercicios siguientes creados:
0" y "paso 6: … 0 …", triggers `O`.

**Diagnóstico en la copia, resumen antes → después:** A true→true, B 2→2, C 0→0, D 11→11, **E 5→1** (queda la de
rango inválido), **F 4→3**, G 2→2, **H 2→5**, **I 1→0**, J 2→2, **K 18→0**, L 0, M 0, N 0, **O 5→0**, P 2→2,
**Q 11→13**, R 1→1, S 0, T 1→1. Consulta 2 después: sin ejercicio solo los 4 esperados (002 N° 6, 005 N° 1 y 4, 009).
Lectura de los que "suben": Q se mide contra el inicio de Ajustes y Ajustes pasa al FY abierto más antiguo, así que
después del deploy Q también cuenta los asientos de ejercicios **cerrados** (007 y la demo de la Fase 9); F cuenta
empresas cuyo FY abierto más antiguo ya venció (001: hay que cerrar 2024 y 2025 en orden; 005 y 009). H sube porque
el bloqueo pasa a derivarse de los meses cerrados (003, 006 tenían meses cerrados sin bloqueo).

**Base de dev:** `npx prisma migrate deploy` (no `migrate dev`, ver desvíos) → aplicada; `npm run db:generate`; dev
server :3010 reiniciado. Diagnóstico `--local` antes/después idéntico en el resumen (A true, B 2, C 0, D 2, E 0, F 0,
G 1, H 1, I 0, J–O 0, P 1, Q 8, R–T 0) y consulta 2: los 38 asientos sin ejercicio quedaron con FY y período (52/52).
Segunda corrida por `psql` en dev: todo 0, huellas iguales (`fy 4de61e6e…`, `periodos 2f46e785…`, `asientos
75d384df…`, `ajustes 3c857d9f…`, `updated_at 18173c29…`). NOTICE: el 999999 de "Empresa de Prueba 01 SA".

**Ajustes (B23/D11/C3/H6):**
- `SET/validators.ts` (puro, lo usan formulario y servidor): `FiscalYearSettingsView`, `validateFiscalYearRange`
  (fecha válida, fin > inicio, día 1 a fin de mes, ≤ 12 meses; textos de `validateFiscalYear` + el de §3.3.6) y
  `fiscalYearSettingsSchema` (Zod con `'YYYY-MM-DD'`).
- `SET/actions.server.ts`: `getFiscalYearSettings()` (settings `view`) y `saveFiscalYearSettings({ startDay, endDay })`
  → `ActionResult<{ fiscalYearNumber }>` (settings `update`). `saveFiscalYearSettingsTx`: valida, `upsert` de Ajustes,
  **lock de Ajustes** (se serializa con `assertPeriodOpen`), y: sin FY → crea el N° 1 con períodos
  (`createFiscalYearWithPeriodsTx`; también con asientos viejos sin FY, p. ej. la empresa de rango inválido); mismas
  fechas que el FY abierto más antiguo → no-op exitoso; fechas nuevas → solo si **no hay asientos, ni meses ni FY
  cerrados** (C3), en cuyo caso el N° 1 conserva su id, toma las fechas, se regeneran sus períodos y se borran los FY
  siguientes vacíos; si no, `BusinessError` con el texto de §3.3.6.
- `saveAccountingSettings(input)` → `ActionResult`, **solo cuentas** (sin `companyId` del cliente ni fechas):
  `commercialIntegrationSchema.safeParse` en el servidor y `updateMany`; sin Ajustes → "Configurá primero el
  ejercicio fiscal.".
- `_AccountingSettingsForm.tsx` (122 → 125): `{ fiscalYear }`; sin `datesEditable` muestra las fechas como texto con
  "Las fechas salen del ejercicio N° X; cambian solas al cerrar el ejercicio."; editable: `type="date"` con el valor
  `'YYYY-MM-DD'` tal cual (sin `new Date('…T00:00:00')`, B22), leyenda de meses completos, toasts con `ActionResult` e
  `invalidateQueries` del estado de Bloqueo de Períodos (si no, la grilla seguía diciendo "Configurá primero el
  ejercicio fiscal" tras crear el FY).
- `_CommercialIntegrationForm.tsx` (434 → 418): ya no lee Ajustes ni reenvía fechas (H6); sin prop `companyId`.
- `AccountingSettings.tsx`: pasa `getFiscalYearSettings()`. `ACC/shared/types`: borrado `accountingSettingsSchema` y
  su tipo (sin otros usos).

**Tests** (TDD: escritos primero, 11/11 en rojo; después verdes): `validators.test.ts` +4 (meses completos,
bisiesto, irregular de 12, 13 meses, fin anterior, fecha inexistente 2027-02-29, esquema);
`accounting-settings.integration.test.ts` 7: primera vez crea Ajustes + FY 1 (00:00Z/23:59:59.999Z, OPENING 1, 12
MONTHLY, CLOSING 12) y vista editable; empresa con Ajustes 03:00Z sin FY → guardar crea el FY 1 (14 períodos) y
normaliza Ajustes; meses incompletos / > 12 / fin anterior → `{ success: false }` sin crear nada; sin asientos →
regenera (07/2026–06/2027, mismo id); con un asiento → texto exacto, FY intacto, vista `datesEditable: false`, y
guardar las mismas fechas da `success`; con un mes cerrado → rechazo; `saveAccountingSettings` sin Ajustes → texto,
con Ajustes guarda cuentas y `requireCostCenter` sin tocar fechas ni FY.

**Calidad:** `npm run test` = **64 archivos, 873 tests, verdes** (con la DB de dev ya migrada); `check-types` =
**219**; `eslint` de `SET/` y `ACC/shared/types` sin errores ni warnings; sin `any` ni `console`.

**Prueba en navegador** (Playwright contra :3010 reiniciado; script temporal borrado; capturas `f3-01` a `f3-04` en
el scratchpad):
- "Empresa de Prueba 01 SA" (con asientos): fechas 01/01/2026 – 31/12/2026 en texto, sin inputs, leyenda del
  ejercicio N° 1. "Guardar Configuración" de Integración Comercial → "Configuración de integración guardada
  correctamente"; fechas de Ajustes intactas.
- Empresa temporal "TSK760 Demo Ajustes F3 (no usar)" (sin Ajustes, el usuario de dev como dueño, activada por
  `user_preferences`): formulario vacío; 15/01–31/12 → mensaje de meses completos en el formulario; 01/01–31/12 →
  "Ejercicio N° 1 guardado", FY con 14 períodos y la grilla de Bloqueo de Períodos aparece; con la pantalla abierta
  se insertó un asiento por SQL y 01/02/2026–31/01/2027 → toast "No se pueden cambiar las fechas del ejercicio N° 1:
  la empresa ya tiene asientos o meses cerrados. Las fechas cambian solas al cerrar el ejercicio.", FY sin cambios;
  al recargar, solo lectura. Móvil 390 px: `scrollWidth` 390.
- Limpieza: empresa temporal borrada (asiento DRAFT, FY, Ajustes, cuentas, miembro); empresa activa restaurada a
  "Empresa de Prueba 01 SA".

**Datos que quedaron en la DB de dev:** la migración aplicada (FY/período en los 52 asientos; Ajustes de "Empresa de
Prueba 01 SA" normalizados a 00:00Z / 23:59:59.999Z). Nada más.

**Desvíos y notas:**
- **`migrate dev` no se pudo usar:** la base de dev tiene aplicada `20261006214031_tsk_757_expense_category_account`
  (rama de 757, PR #34) que esta rama no tiene, y `migrate dev` (también `--create-only`) pide **reset**. No se
  reseteó: la carpeta se creó a mano y se aplicó con `migrate deploy` (lo mismo que hace producción). `migrate
  status` queda "up to date". Al mergear 757 no hay conflicto de orden (757 < 760).
- **Sin `fy-backfill.integration.test.ts`:** la migración es global (toca todas las empresas) y toma `ACCESS
  EXCLUSIVE` sobre `journal_entries`; correrla desde Vitest contra la base compartida, con los demás archivos de test
  en paralelo, modificaría sus empresas y bloquearía sus inserts. Se reemplazó por el par siembra/verificación SQL
  sobre la copia, reproducible.
- D11 vs. C3: las fechas son editables con **varios** FY si no hay asientos ni cierres (caso real: empresa que cargó
  Ajustes hace años y nunca operó; la migración le crea FY hasta hoy y, con la regla "único FY", no podría corregir
  sus fechas). Se descartan los FY siguientes vacíos.
- `getAccountingSettings(companyId)` queda (la usa la página para las cuentas); `getFiscalYearSettings` es la nueva.
- No se agregó `prisma/scripts/tsk760-backfill-asientos.sql` (§3.7.6 paso 4): queda para la Fase 14.

**Diagnóstico de producción → qué suposición invalidaría** (correrlo antes del deploy y revisar esta tabla):

| Letra / sección | Suposición de la migración | Valor que la invalida y qué hacer |
|---|---|---|
| A | El usuario de la base es dueño de `journal_entries` (`DISABLE TRIGGER`) | `false` → la migración falla entera (P3009, sin cambios). No deployar; dar ownership o correr como dueño |
| B | Los dos triggers están `O` antes | ≠ 2 → alguien los tocó; la red del paso 8 solo mira el de asientos. Revisar antes |
| E | Las empresas sin FY tienen un rango de Ajustes válido | E > 0 con `meses_completos` (sección 1) **nulo o fin ≤ inicio** → no reciben FY (NOTICE); corregir Ajustes después del deploy desde la UI (guardar crea el FY 1) |
| F | Un ejercicio vencido se resuelve creando FY de 12 meses contiguos hasta hoy | F > 0 con un ejercicio irregular o con asientos que muestran otro calendario (p. ej. FY julio-junio pero asientos de enero a diciembre) → los FY creados no siguen el calendario real; revisar sección 1 y 3 y, si hace falta, corregir antes |
| G | Los FY cerrados vienen del código viejo con fechas a medianoche o al fin del día (`02:59:59.999` se lee como el día anterior) y su apertura está en el FY siguiente | G > 0 con `fin_raw` (sección 12) en otra hora de madrugada (p. ej. `03:00:00` del día 1 siguiente) → el FY normalizado se estiraría un día al año siguiente; con refundiciones fuera del último día o aperturas vinculadas al FY cerrado (no al siguiente) → el paso 4 las pone en el FY por fecha, revisar 5 y 12 a mano |
| sección 12 | Cada FY tiene a lo sumo un OPENING y un CLOSING; FY sin solaparse ni huecos, numerados en orden cronológico | `apertura_mes`/`cierre_mes` con dos valores (p. ej. `0,1`) → queda el duplicado (NOTICE) y el núcleo usa uno cualquiera: limpiar a mano. Rangos solapados → asientos al FY de menor número. Huecos entre FY → `ensureFiscalYearTx` rechaza esas fechas ("no pertenece a ningún ejercicio"). `igual_a_ajustes = f` → Ajustes pasa a las fechas del FY (el FY manda) |
| sección 1 `meses_completos` | — | `f` → el FY 1 se crea con el rango irregular (13 MONTHLY si cruza meses parciales) y los siguientes arrancan a mitad de mes; funciona, pero conviene que la clienta corrija Ajustes mientras no tenga asientos |
| O | Las colisiones de numeración son la racha `contador+1…` | O muy grande (cientos) → indicaría caminos que escriben números sin tocar el contador hace tiempo; el contador sube igual hasta el fin de la racha |
| P | Los números aislados son pocos y altos (tipo 999999) | P > 0 con aislados **cerca** del contador (p. ej. contador 120, aislados 125-140) → `nextEntryNumberTx` los saltea al alcanzarlos (bien), pero la numeración tendrá saltos visibles; avisar |
| Q | Lo anterior al primer ejercicio es poco y viejo (queda sin FY, se informa) | Q > 0 con `antes_inicio_fecha_ult_90d` o `antes_inicio_draft` > 0 (sección 13) → la clienta opera fechas anteriores al inicio de Ajustes: esos DRAFT no se podrán registrar ("anterior al inicio del primer ejercicio"). Considerar corregir el inicio de Ajustes **antes** del deploy (después ya hay asientos y la UI no deja) |
| R | Lo posterior a hoy + 1 año son errores de tipeo | R > 0 con fechas cercanas al tope o muchas → no son typos: hay que crear esos FY a mano o corregir fechas |
| T | La migración no toca cuentas; el cierre ya las incluye (C4/H5) | T > 0 no invalida la migración; confirma C4. Solo informar |
| I / H | El bloqueo heredado se interpreta por día (`::date`); `02:59:59.999` del día 1 cierra el mes anterior | H > 0 con `bloqueo_hora` distinta de `00:00`, `03:00`, `23:59:59.999` y `02:59:59.999` (sección 1) → origen desconocido; revisar si el día elegido es el que la clienta quiso bloquear |
| K, J, L | (no son suposiciones: miden el cambio de comportamiento) | > 0 → avisar a la clienta antes del deploy (§3.7.6) |

### Fase 4: Creadores I — asientos manuales y registrar
**Estado:** Completada (2026-10-06)

**Archivos modificados** (`ACC/` = `src/modules/accounting/`):
- `ACC/features/entries/actions.server.ts`:
  - `createJournalEntry(input)` → `Promise<ActionResult<{ id; number }>>` (§3.6). Se quitó el
    parámetro `companyId`: sale de `getActiveCompanyId()`. Revalida el input con
    `journalEntrySchema` en el servidor; `validateJournalEntryAccounts` + `validateAuxiliaries`
    (solo lectura, antes de la tx) y `validateAccountNatures` (solo log); después
    `prisma.$transaction(tx => createJournalEntryTx(…, status: 'DRAFT', createdBy: userId,
    source: 'manual'))`. Las líneas pasan `description`, auxiliares y **`costCenterId`**
    (TSK-583/719) con importes como `Prisma.Decimal`.
  - `postJournalEntry(entryId)` → `Promise<ActionResult<{ number }>>`: `postJournalEntryTx` en
    una tx (FY cerrado + mes + bloqueo + balance + cuentas; B4). Sin `companyId` del cliente.
  - "No autenticado"/"No hay empresa activa" siguen como `throw` (§3.6).
  - `reverseJournalEntry` **no se tocó** (Fase 10).
- `ACC/features/entries/validators/index.ts`: sin `'use server'` (H7); borrados
  `validateJournalEntryDate`, `validateJournalEntryBalance` y `validateJournalEntryAmounts` (los
  cubre el núcleo); `validateJournalEntryAccounts` y `validateAuxiliaries` lanzan `BusinessError`
  con el mismo texto; `logger` y `moment` por `import` (el `require('@/shared/lib/logger')` no
  resolvía el alias fuera de Next). `validatePeriodLock` y `resolveFiscalPeriod` **quedan**
  marcadas `@deprecated`: su único caller es `reverseJournalEntry`; se borran en la Fase 10.
- `ACC/shared/validators/index.ts`: borrado el duplicado `validateJournalEntryDate` (H8, sin
  callers).
- `_CreateEntryModal.tsx` (297 → 286 líneas) y `_PostEntryDialog.tsx`: `if (!result.success)
  toast.error(result.error)`; toast de éxito con el número. El modal ya no manda `companyId` y
  usa `CreateJournalEntryInput` como tipo del form (se fue el `as any`).

**Tests:** `ACC/features/entries/entries.integration.test.ts` (12, nuevo; primero rojo: 12/12
fallaban por la firma vieja). Crear: DRAFT con número, FY 1 y período MONTHLY 03/2026 creados en
el momento; conserva `costCenterId` y descripción de línea; mes cerrado → texto exacto de §3.3.2
sin consumir número; auxiliar faltante y cuenta no hoja → mensajes legibles (no el genérico); Zod
en servidor (desbalanceado); cuentas de otra empresa → rechazo. Registrar: POSTED con
`postDate`/FY/período; mes cerrado → texto exacto y sigue DRAFT; **B4** (FY cerrado con el mes
abierto); DRAFT desbalanceado sembrado → texto actual; asiento de otra empresa → "Asiento no
encontrado."; dos veces → "ya no está en borrador". El test mockea `revalidateAccountingRoutes`
(su `require('next/cache')` no lo intercepta `vi.mock` y fuera de Next lanza).

**Calidad:** `npm run test` = **54 archivos, 724 tests, verdes**; `check-types` = **219**; `eslint`
de los archivos tocados sin errores (queda 1 warning previo en `_CreateEntryModal`: `error` sin
usar en el `catch` de la carga de cuentas). Sin `any` ni `console`.

**Prueba en navegador** (Playwright contra :3010, empresa "Empresa de Prueba 01 SA"):
- Nuevo asiento 05/10/2026 Caja chica / Caja $1,00 → toast "Asiento N° 50 creado en borrador";
  Registrar → "Asiento N° 50 registrado correctamente". DB: POSTED, FY 1, período MONTHLY 10/2026,
  contador 50.
- Octubre cerrado por SQL: crear con fecha 05/10/2026 y registrar el DRAFT N° 36 (06/10/2026) →
  toasts "No se puede registrar con fecha 05/10/2026 (06/10/2026): el período está cerrado (mes
  10/2026 cerrado). Para operar, reabrilo desde …". Octubre restaurado (`is_closed = false`), N° 36
  sigue DRAFT, contador sin cambios.

**Datos que quedaron en la DB de dev:**
- Asiento **N° 50** `dd45a66d-5e64-4a0e-8b94-fdecba6e4bde`, POSTED (inmutable), 05/10/2026,
  "Verificación interna TSK-760 (no usar)", Caja chica D / Caja H $1,00. `last_entry_number` = 50.
- **FY 1** `1caebea1-a8e5-4298-b8d5-367cb9d8d671` (2026-01-01 00:00Z → 2026-12-31 23:59:59.999Z,
  abierto) con 14 períodos, creado por `ensureFiscalYearTx` en el primer asiento. Ningún período
  cerrado. Los otros 32 asientos siguen sin `fiscal_year_id` (los completa la Fase 3).

**Desvíos:**
- El plan decía que en las Fases 4–7 los tests afirmaran `rejects.toThrow` y que la Fase 12
  pasara `createJournalEntry`/`postJournalEntry` y sus dos componentes a `ActionResult`. Se
  adelantó acá (instrucción del líder: toda action tocada devuelve `ActionResult`). **La Fase 12
  ya no tiene que tocar** `createJournalEntry`, `postJournalEntry`, `_CreateEntryModal` ni
  `_PostEntryDialog`.
- `validateJournalEntryAccounts` comparaba la cantidad de cuentas encontradas contra la de
  líneas: una misma cuenta en dos líneas rechazaba el asiento. Ahora compara contra las cuentas
  distintas.
- No depende de la Fase 3: el núcleo crea FY y períodos al vuelo. Visto en el navegador: un
  warning previo de React (`key` en `_EntriesTable`, archivo no tocado).

### Fase 5: Creadores II — comerciales, equipos y depreciación
**Estado:** Completada (2026-10-06)

**Archivos modificados** (`INT/` = `src/modules/accounting/features/integrations/`,
`DEP/` = `src/modules/equipment/features/depreciation/`):
- `INT/commercial/index.ts`: el `createJournalEntry` interno (venta, compra, recibo, OP, gasto
  y el CMV muerto) pasa a ser un envoltorio de `createJournalEntryTx` (DRAFT, `'system'`,
  `source` = `sales-invoice:<id>`, `purchase-invoice:<id>`, `receipt:<id>`, `payment-order:<id>`,
  `expense:<id>`, `cogs:<id>`). Se borraron `validateBalance`, el chequeo de `lockedUntilDate`,
  el resolver de FY/período con `moment()` local y el `UPDATE … RETURNING` propio. Las líneas
  pasan con todas sus columnas (auxiliares, `costCenterId`, moneda) como `Prisma.Decimal`; la
  construcción de líneas de cada documento (`expandByCostCenter`, percepciones, impuestos
  internos, cuentas por ítem/socio/categoría) **no se tocó**.
- `INT/equipment/index.ts`: ídem para la baja por venta y por pérdida/devolución
  (`source` = `asset-sale:<vehicleId>` / `asset-disposal:<vehicleId>`). Se fue `moment`.
- `DEP/actions.server.ts`:
  - `resolveFiscalPeriodTx` borrado; `postEntryTx` crea el asiento con `createJournalEntryTx`
    (`source` = `depreciation:<scheduleEntryId>`), con el importe como `Decimal` del período.
  - `postDepreciationEntry` y `createValueAdjustment`: se quitó el chequeo previo de
    `loaded.lockedUntilDate` fuera de la tx; el período lo valida el núcleo dentro de la tx. El
    texto "El período MM/YYYY está bloqueado" pasa al estándar de §3.3.2.
  - `postAllPendingDepreciations`: ya no filtra `scheduledDate > lockedUntilDate` (escenario 10);
    en el bucle, `BusinessError` → `errors[]` con `Equipo X: <mensaje>` y sigue; cualquier otro
    error se relanza (aborta la masiva entera: después de un error SQL la tx de Postgres queda
    abortada). Antes cualquier error se juntaba como texto.
- `src/modules/equipment/shared/asset-accounts-loader.ts`: quitado `lockedUntilDate` de
  `LoadedVehicleAssetAccounts` (sin lectores tras esta fase).

**Archivos creados:**
- `ACC/shared/test-utils/period-test-helpers.ts`: `closeMonthForTest` (cierra el MONTHLY por
  `AccountingPeriod.isClosed` sin tocar `lockedUntilDate`, creando FY/períodos con el núcleo;
  devuelve la función que lo reabre), `readLastEntryNumber`, `readEntryPeriod`.
- `DEP/depreciation-period-lock.integration.test.ts` (4 tests, prefijo `TSK760-DEP-`).

**Tests** (TDD: con la implementación guardada en `git stash`, los 12 casos nuevos de período
cerrado fallaron; los de FY/período de comprobantes ya pasaban con el código viejo porque el FY
lo había creado el caso anterior; con la implementación, todo verde):
- Agregados a los 6 existentes: "mes cerrado por `AccountingPeriod` sin `lockedUntilDate`" (B3:
  texto estándar con el mes, documento en DRAFT sin `journalEntryId`, contador sin cambios y,
  en recibo y OP, sin movimiento de caja) y "asiento DRAFT `'system'` con `fiscalYearId` y período
  MONTHLY del mes del documento": `expense-journal-entry` (casos 8 y 9),
  `purchase-invoice-line-accounts` (8b, 8c), `sales-invoice-line-accounts` (9, 10),
  `receipt-journal-entry` (14a, 14b), `payment-order-journal-entry` (15a, 15b),
  `asset-disposal` (1b: período del mes de hoy; 4b: baja rechazada con el mes de hoy cerrado).
  Los casos existentes con `lockedUntilDate` siguen verdes sin tocar el texto.
- `depreciation-period-lock`: individual (mes cerrado → texto exacto, sin marca ni número;
  abierto → DRAFT con FY y período 01/2026); revalúo (mes cerrado → sin ajuste, valor libro y
  contador intactos; abierto → asiento 04/2026); masiva con febrero cerrado (equipo de ene-mar:
  error de 02/2026 + "período 3 omitido"; equipo de mar-may: se contabiliza; `posted` = 2 y
  contador + 2); masiva con `lockedUntilDate` 28/02 (escenario 10: el período de febrero aparece
  en `errors[]` con "bloqueado hasta 28/02/2026", antes se omitía en silencio).
- `vi.mock('server-only', () => ({}))` agregado a `expense-journal-entry`,
  `purchase-invoice-line-accounts`, `purchase-invoice-tributes`, `sales-invoice-line-accounts`,
  `cost-center` y `perceptions` (el núcleo abre con `import 'server-only'`).
- `cost-center`, `perceptions`, `purchase-invoice-tributes`, `asset-accounts` (depreciación),
  `cost-center-movements` y `fund-movement-*`: verdes sin cambios de lógica.

**Calidad:** `npm run test` = **55 archivos, 740 tests, verdes**; `check-types` = **219**;
`eslint` de los archivos tocados sin errores (quedan 2 warnings previos en
`checkBudgetForExpense`: `fiscalYearStart`/`fiscalYearEnd` sin usar). Sin `any` ni `console`.
Tras correr los tests no quedan empresas, cuentas, FY ni períodos de test en la base (verificado
por `psql`).

**Prueba en navegador** (Playwright contra :3010, "Empresa de Prueba 01 SA"; script temporal
borrado). Durante la prueba se apagó `require_cost_center` (las líneas de la compra demo no
tienen centro) y se puso "Cuenta de Gastos Operativos" = 4.2.1/03/10 (en dev está vacía); ambos
restaurados (`require_cost_center = t`, `expenses_account_id = NULL`).
- Septiembre 2026 cerrado por SQL (`accounting_periods.is_closed`, sin `lockedUntilDate`):
  confirmar la compra 0001-97244388 y el egreso GTO-00001 → toasts "No se puede registrar con
  fecha 08/09/2026 (22/09/2026): el período está cerrado (mes 09/2026 cerrado). Para operar,
  reabrilo desde Contabilidad → Configuración → Bloqueo de Períodos."; ambos siguen DRAFT sin
  asiento y el contador sigue en 50/51.
- Septiembre reabierto: "Factura confirmada correctamente" y "Egreso confirmado correctamente";
  asientos DRAFT con FY 1 y período MONTHLY 2026/09.

**Datos que quedaron en la DB de dev:**
- Compra **0001-97244388** CONFIRMED con asiento **N° 51**
  `803231de-164c-40ce-b99b-4fe210b68250` (DRAFT, FY 1, período 09/2026).
- Egreso **GTO-00001** (marca `TSK728-demo`) CONFIRMED con asiento **N° 52**
  `4156c4a2-fac5-4e99-ab65-f938bec01781` (DRAFT, FY 1, período 09/2026).
- `last_entry_number` = 52. Ningún período cerrado; `locked_until_date` nulo.

**Desvíos y notas:**
- **Conflicto esperado con PR #34 (TSK-757, sin mergear):** en esta rama
  `createJournalEntryForExpense` sigue debitando la `expensesAccountId` global de Ajustes; solo
  cambió el helper interno al que llama (`createJournalEntry` → `createJournalEntryTx`). #34
  reescribe esa función para usar la cuenta de la categoría de egreso. Al mergear #34 (antes o
  después de esta rama) habrá conflicto en `createJournalEntryForExpense` (y probablemente en
  `expense-journal-entry.integration.test.ts`): resolverlo conservando la resolución de cuenta
  de 757 y la llamada a `createJournalEntry` (núcleo) de esta fase, y agregar al test de 757 el
  `vi.mock('server-only')`.
- Balance: el `validateBalance` de las integraciones toleraba `> 0,01` con coma flotante; ahora
  rige `validateEntryLines` (`≥ 0,01` con `Decimal`, C5). Un comprobante con una diferencia de
  exactamente un centavo entre total y líneas, que antes podía pasar según el redondeo del
  `float`, ahora se rechaza con `BusinessError` legible. No se encontró ninguno en los tests.
- Defensa en profundidad: `assertAccountsUsableTx` también rechaza cuentas no hoja o de otra
  empresa en estos asientos (las pre-validaciones de 717/721/724c siguen antes de la tx).
- Los tests existentes no necesitaron `cleanupAccountingCompany`: sus asientos son DRAFT (se
  borran sin trigger) y el FY creado al vuelo cae por cascada al borrar la empresa. El test
  nuevo de depreciación sí lo usa.
- `createJournalEntryForCOGS` (muerto) sigue tragando errores; se borra en la Fase 11.
- La baja de equipos sigue fechada con `new Date()` (hoy), como antes.

### Fase 6: Creadores III — tesorería
**Estado:** Completada (2026-10-06)

**Archivos modificados** (`TRE/` = `src/modules/commercial/features/treasury/features/`):
- `TRE/fund-movements/list/actions.server.ts`: `createJournalEntryForFundMovement` conserva su
  chequeo de partida doble con `Decimal` y crea el asiento con `createJournalEntryTx` (DRAFT,
  `'system'`, `source` = `fund-movement:<id>`); se fueron `lastEntryNumber + 1` y el `update` del
  contador. `confirmFundMovement` sigue devolviendo `ActionResult` (TSK-481/721) y ahora rechaza
  "sin Ajustes" **antes** de tocar saldos (mismo texto que antes; las lecturas `settings?.` pasan a
  `settings.`). El armado de líneas por tipo (TSK-585 conceptos de BANK_CHARGES, TSK-717 cuenta de
  capital por socio, TSK-718/721) y la transacción única con saldos de banco/caja no cambian. El
  asiento sigue naciendo **DRAFT** como antes. **No se tocó ningún componente de fund-movements**
  (sin conflicto con PR #33, que refactoriza la UI pero no `actions.server.ts`).
- `TRE/bank-movements/actions.server.ts`:
  - Helper nuevo `createTreasuryEntryTx(tx, …)`: sin Ajustes → `logger.warn` y sin asiento (se
    conserva, decisión 2.0); con Ajustes → `createJournalEntryTx` (DRAFT, `'system'`). Lo usan el
    movimiento manual y las dos transferencias. `buildTransferLines` arma las dos líneas (diseño
    §3.3.10, #13-14). Sin cuenta contable en el banco/caja, sigue sin asiento (como antes).
  - `createBankMovement` y `createBankTransfer` → `Promise<ActionResult<{ id }>>` (la transferencia
    devuelve el id del movimiento de salida): `BusinessError` en las validaciones (banco/caja/cuenta
    inexistente, caja sin sesión, Zod con `safeParse` → primer mensaje) y `toActionResult` en el
    `catch`. "No autenticado"/"sin empresa activa" siguen como `throw` (§3.6). Con Ajustes y mes
    cerrado se rechaza el movimiento **entero** (no se graba sin asiento).
- `TRE/../bank-accounts/detail/components/_CreateBankMovementDialog.tsx` y `_BankTransferDialog.tsx`
  (+1 línea cada uno): `if (!result.success) return void toast.error(result.error)`. Además la
  fecha por defecto pasa de `new Date()` (hora real) a **mediodía local de hoy**, la misma
  convención que ya usaba el `onChange` del campo (`'T12:00:00'`). Visto en el navegador: a las
  21:40 AR el `new Date()` es el día siguiente en UTC y el toast decía "fecha 07/10/2026" con el
  formulario mostrando 06/10/2026 (y el último día del mes, después de las 21:00, imputaría al mes
  siguiente). Con el cambio, el mensaje y el período coinciden con lo que ve el usuario.

**Tests** (TDD: primero en rojo, 9 fallas — 3 de fondos y 6 de bancos —; con la implementación,
todo verde):
- `fund-movement-lines.integration.test.ts`, caso 7 (3 tests): mes abierto → asiento DRAFT
  `'system'` con FY y período MONTHLY 04/2026, número = contador + 1 (también en
  `journalEntryNumber`); mes cerrado (`closeMonthForTest`, B3) → `confirmFundMovement` devuelve el
  texto estándar, sin consumir número, sin cambiar el saldo del banco ni crear `BankMovement`, el
  borrador sigue DRAFT sin asiento y, reabierto el mes, se confirma; **dos confirmaciones en
  paralelo** → números consecutivos sin choque (con `lastEntryNumber + 1` una fallaba por `P2002`).
- `TRE/bank-movements/bank-movement-period-lock.integration.test.ts` (nuevo, 8 tests, prefijo
  `TSK760-BNK-`, limpieza con `cleanupAccountingCompany`): movimiento manual abierto (asiento con
  FY/período/número), cerrado (rechazo, sin movimiento, saldo y contador intactos), dos en paralelo
  (números consecutivos), empresa sin Ajustes (movimiento sin asiento); banco→banco y banco→caja
  abiertos (saldos, `CashMovement`, asiento) y cerrados (sin `BankMovement` ni `CashMovement`,
  saldos de banco y de sesión de caja intactos, contador sin cambios).
- `vi.mock('server-only')` agregado a `fund-movement-lines` y `fund-movement-partner-account`.
  `fund-movement-partner-account` verde sin otros cambios.

**Calidad:** `npm run test` = **56 archivos, 751 tests, verdes**; `check-types` = **219**; `eslint`
de los archivos tocados sin errores (el directorio `bank-movements/` tiene 2 errores previos en
`lib/import-export.server.ts`, no tocado). Sin `any` ni `console`. No quedan empresas de test.

**Prueba en navegador** (Playwright contra :3010, "Empresa de Prueba 01 SA"; script temporal
borrado). Borrador de fondos sembrado por SQL: aporte de Juan Perez al Santander, $1,00, 06/10/2026.
- Octubre cerrado por SQL (`accounting_periods.is_closed`): Confirmar el aporte (menú de la fila) →
  toast "No se puede registrar con fecha 06/10/2026: el período está cerrado (mes 10/2026 cerrado).
  Para operar, reabrilo desde Contabilidad → Configuración → Bloqueo de Períodos."; Transferir
  Santander → Caja Principal $1 → mismo toast. Contador (52), saldo del banco, saldo esperado de la
  caja, borrador DRAFT y cantidad de movimientos de banco/caja: sin cambios.
- Octubre reabierto: "Movimiento confirmado" y "Transferencia realizada correctamente"; asientos
  N° 53 (fondos) y N° 54 (banco→caja) DRAFT con FY 1 y período MONTHLY 2026/10.
- Repetida la transferencia cerrada con la fecha por defecto corregida: el toast dice 06/10/2026.
  Octubre quedó abierto (0 períodos cerrados).

**Datos que quedaron en la DB de dev** (todo con la descripción "Verificación interna TSK-760 F6 … (no usar)"):
- Movimiento de fondos `f436a986-2df7-4e61-abda-1f7e5549cbad` CONFIRMED (aporte Juan Perez $1,00 al
  Santander) con asiento **N° 53** `8c7cebf1-b6d5-4cfe-9349-2168eca50ee7` (DRAFT) y `BankMovement`
  DEPOSIT $1,00 `c6292b10-078b-4385-b28e-303582a3b33f`.
- Transferencia banco→caja $1,00: `BankMovement` TRANSFER_OUT `36626de7-68a9-44fa-b66f-6e77d678d71b`,
  `CashMovement` INCOME `9d61ece8-3d7d-4c31-90ef-f17d19708f54` y asiento **N° 54**
  `7838638a-657d-4341-b761-2aef86abfb3e` (DRAFT).
- Saldos: Santander sin cambio neto (+1 −1 = $1.515.754,56); sesión de Caja Principal +$1,00
  (140.000,00 → 140.001,00). `last_entry_number` = 54. Ningún período cerrado.

**Desvíos y notas:**
- Como en la Fase 4 (instrucción del líder: toda action tocada devuelve `ActionResult`),
  `createBankMovement`/`createBankTransfer` y sus dos diálogos se pasaron acá. **La Fase 12 ya no
  tiene que tocar** esas dos actions ni `_CreateBankMovementDialog`/`_BankTransferDialog`.
- Sin Ajustes, `confirmFundMovement` ahora falla antes de mover saldos (antes fallaba dentro de la
  tx, con el mismo texto y el mismo resultado final por rollback).
- Defensa en profundidad: `assertAccountsUsableTx` rechaza ahora una contrapartida no hoja en el
  movimiento manual (antes solo se exigía `isActive`), con `BusinessError` legible.
- Fechas con hora real: los movimientos bancarios importados desde Excel y los de otros caminos
  siguen guardando la fecha que llega; el núcleo la interpreta por día UTC (fuera de alcance, 2.4).
  Solo se corrigió el valor por defecto de los dos diálogos tocados.
- Preexistente, no tocado: `createBankTransfer` lee el saldo del banco origen **fuera** de la tx
  (dos transferencias simultáneas del mismo banco pueden pisar el saldo). Candidato a ticket aparte.

### Fase 7: Creadores IV — generadores contables
**Estado:** Completada (2026-10-06)

**Archivos modificados** (`ACC/` = `src/modules/accounting/`, `UT/` = `ACC/shared/utils/`):
- `UT/journal-entry-tx.ts`: **`reverseJournalEntryTx`** (adelantado de la Fase 10 porque B25 lo
  necesita; firma de §3.3.4 más `periodType?` y `source?`, ver desvíos). Puro: lee el original
  (POSTED, de la empresa) con todas las columnas de línea, valida su período con el tipo de su
  período y `subject` "No se puede anular el asiento N° X (fecha DD/MM/YYYY)", crea la reversión
  POSTED con `invertLines` vía `createJournalEntryTx` (`originalEntryId`, descripción
  "Anulación del asiento N° X - …", valida el período de la fecha de reversión) y pasa el
  original a REVERSED con `reversalEntryId`/`reversedBy`/`reversedAt` en un solo `UPDATE`. Sin
  `checkPermission`, `$transaction` ni chequeo de documento (eso es del llamador). Mensajes de
  §3.3.4 ("Asiento no encontrado.", "Solo se pueden anular asientos registrados; el N° X está en
  estado Borrador/Anulado."). `toEntryPeriodType` compartido con `postJournalEntryTx`.
  **La Fase 10 lo reutiliza** (solo le falta el wrapper `reverseJournalEntry` con
  `getEntryDocumentLink`). Reexportado en `INT/core/index.ts`.
- `ACC/features/recurring-entries/actions.server.ts` (#18): función interna
  `generateRecurringEntryForCompany` → `createJournalEntryTx` (DRAFT, userId,
  `source` = `recurring-entry:<id>`) y avance de `nextDueDate`/`lastGenerated` en la misma tx.
  `generateRecurringEntry(recurringEntryId)` → `ActionResult<{ id; number }>` y
  `generateAllPendingRecurringEntries()` → `ActionResult<{ generated; errors }>` (§3.6): **sin
  `companyId` del cliente** (sale de `getActiveCompanyId()`); cada plantilla en su propia tx, el
  rechazo va a `errors[]` como `<nombre>: <mensaje con el mes>` y la plantilla queda pendiente.
  `calculateNextDueDate` y la etiqueta `MM/YYYY` de la descripción pasan a UTC (`moment.utc`,
  `formatMonth(monthKeyUtc)`): en hora local el 31/01 00:00Z avanzaba al 01/03 y el día 1 se
  etiquetaba con el mes anterior.
- `_RecurringEntriesTable.tsx` (210, sin crecer) y `_GeneratePendingDialog.tsx` (101):
  `if (!result.success) return void toast.error(result.error)`; el diálogo ya no recibe
  `companyId`. `_CreateRecurringEntryDialog.tsx` (321, sin crecer): fecha de inicio por defecto
  y la elegida en los `type="date"` a **mediodía local** (`'T12:00:00'`), como en la Fase 6
  (antes `new Date('YYYY-MM-DD')` = 00:00Z, que el propio input mostraba como el día anterior).
- `ACC/features/opening-balances/actions.server.ts` (#19, B25, H3):
  `saveOpeningBalanceEntry` → `ActionResult<{ entryId; entryNumber }>`. En una tx: lock de Ajustes,
  ejercicio **abierto más antiguo** (o FY 1 con `ensureFiscalYearTx` si la empresa no tiene
  ejercicios: no depende de la Fase 3), fecha = su día de inicio (00:00Z), cuenta Apertura,
  búsqueda del vigente con `openingEntryWhere`: por `fiscalYearId` **o** (sin ejercicio, cargado
  antes de TSK-760) por **día UTC** del inicio, POSTED, sin `originalEntryId` (excluye
  reversiones). Crear con vigente → "Ya existe un asiento de apertura. Usá la opción de editar.";
  editar sin vigente → "No se encontró el asiento de apertura existente". **Editar** =
  `reverseJournalEntryTx` del vigente con su misma fecha y `periodType: 'OPENING'` + nuevo
  `createJournalEntryTx` (POSTED, OPENING). Validaciones previas → `BusinessError` (mismos
  textos). `getOpeningBalancesPageData` usa la misma búsqueda (con el FY abierto más antiguo, o la
  fecha de Ajustes si todavía no hay FY).
- `_AccountBalancesForm.tsx` (387 → 386): `ActionResult`; "Fecha:" con `moment.utc` (con la
  fecha normalizada a 00:00Z el `moment` local mostraba 31/12); texto del diálogo de edición:
  "Se anulará el asiento vigente (con una reversión en la misma fecha) y se registrará uno nuevo
  con estos saldos." (antes decía que reemplazaba las líneas).
- `ACC/features/vat-settlement/actions.server.ts` (#15): `createJournalEntryTx` (POSTED,
  `'system'`, fecha `endOfMonthUtc`); rango del preview en UTC (`startOfMonthUtc`/`endOfMonthUtc`)
  y período `MM/YYYY` con `formatMonth`; se omiten líneas 0/0 (sin DF, sin CF o saldo cero: las
  rechaza el CHECK). → `ActionResult<{ id; number; preview }>`.
- `ACC/features/exchange-rates/actions.server.ts` (#16): `createJournalEntryTx` (POSTED, userId);
  ahora carga ejercicio y período; descripción con `formatDayUtc`. → `ActionResult<{ id; number }>`.
- `ACC/features/inflation-adjustment/actions.server.ts` (#17): `createJournalEntryTx` (POSTED,
  `'system'`, fecha `endOfMonthUtc`); rangos de `calculateRECPAM` en UTC; contrapartida redondeada
  a centavos y omitida si da 0. → `ActionResult<{ id; number }>`. Los "no hay índice cargado" y
  "Configuración contable no encontrada" de los previews pasan a `BusinessError`.

**Tests** (TDD: los 20 nuevos fallaron primero — firma vieja, `reverseJournalEntryTx`
inexistente, el "editar" de apertura chocaba con el trigger —; con la implementación, verdes):
- `UT/journal-entry-tx.integration.test.ts` + 4 de `reverseJournalEntryTx`: copia invertida de
  auxiliares, moneda, `originalAmount`/`exchangeRate` y `costCenterId`, original REVERSED con
  `reversalEntryId`/`reversedBy`/`reversedAt`; `periodType: 'OPENING'` con la misma fecha; mes del
  original cerrado → texto con `subject` sin consumir número; borrador / otra empresa. Su
  `afterAll` ahora limpia los asientos de todas las empresas antes de borrar auxiliares (la
  reversión usa auxiliares de la empresa principal: borrarlos primero disparaba el `SET NULL`
  sobre líneas POSTED).
- `ACC/features/recurring-entries/recurring-entries.integration.test.ts` (6, `TSK760-REC-`): mes
  abierto (DRAFT, FY/período 03/2026, número, descripción, plantilla avanzada); mes cerrado
  (`closeMonthForTest`) → `{ success: false }` con el texto exacto, sin consumir número ni avanzar
  la plantilla, y reabierto se genera; 31/01 → 28/02 (UTC); dos en paralelo → 1 y 2; plantilla
  de otra empresa; **masiva con febrero cerrado** → `generated: 1`, `errors: ["<nombre>: No se
  puede registrar con fecha 10/02/2026: … (mes 02/2026 cerrado) …"]`, la de febrero sigue pendiente.
- `ACC/features/opening-balances/opening-balances.integration.test.ts` (7, `TSK760-OB-`): crear
  (POSTED, OPENING, 01/01 00:00Z, FY 1, cuenta Apertura balanceando, la página lo encuentra);
  crear dos veces → rechazo sin duplicar; **B25**: editar → original REVERSED, reversión N° 2
  POSTED en OPENING con la misma fecha, nuevo N° 3, un solo vigente, la página muestra el nuevo, y
  editar otra vez revierte el último; **H3**: apertura sembrada sin ejercicio a las 03:00Z (Ajustes
  del formulario viejo) → detectada, no se duplica y se reemplaza; OPENING cerrado (C7) → "…
  (apertura del ejercicio N° 1 cerrada)." sin consumir número; editar sin vigente; sin Ajustes.
- `ACC/features/vat-settlement/generators-period-lock.integration.test.ts` (3, `TSK760-GEN-`):
  IVA, diferencia de cambio e inflación con marzo cerrado → texto exacto sin consumir número;
  abierto → POSTED con FY/período 03/2026, número, `createdBy` y líneas esperadas (IVA e inflación
  fechados 31/03 23:59:59.999Z).

**Calidad:** `npm run test` = **59 archivos, 771 tests, verdes**; `check-types` = **219**; `eslint`
de los archivos tocados sin errores ni warnings. Sin `any` ni `console`. No quedan empresas de
test. `grep "lastEntryNumber + 1\|journalEntry.create(" src/modules` → solo el núcleo y los
pendientes de las Fases 9 (`closeFiscalYear` ×2), 10 (`reverseJournalEntry`) y 11
(`INT/treasury`).

**Prueba en navegador** (Playwright contra :3010, "Empresa de Prueba 01 SA"; scripts temporales
borrados). Plantilla recurrente sembrada por SQL (vence 15/09/2026, Caja chica / Caja $1).
- Septiembre cerrado por SQL: "Generar asiento" → toast "No se puede registrar con fecha
  15/09/2026: el período está cerrado (mes 09/2026 cerrado). Para operar, reabrilo desde …";
  plantilla sin cambios. Reabierto: "Asiento N° 55 generado desde …"; DRAFT, MONTHLY 2026/09,
  descripción "… - 09/2026", plantilla al 15/10/2026.
- Saldos de apertura con el OPENING cerrado por SQL: "No se puede registrar con fecha 01/01/2026:
  el período está cerrado (apertura del ejercicio N° 1 cerrada)." Reabierto: "Asiento de apertura
  N° 65 creado" (Caja chica $1, 01/01/2026, OPENING); **Editar** a $2 → "Asiento de apertura N° 67
  actualizado": N° 65 REVERSED, N° 66 reversión POSTED en OPENING, N° 67 vigente; el banner
  muestra el N° 67 (no duplica). En la primera corrida la edición devolvió una vez el mensaje
  genérico; no se pudo reproducir en 4 corridas más (con traza temporal del error en
  `toActionResult`, ya revertida): probablemente un corte transitorio del dev server; anotado para
  la verificación en modo producción (Fase 14).

**Datos que quedaron en la DB de dev** (todo "Verificación interna TSK-760 F7 (no usar)" o
apertura de prueba):
- Plantilla recurrente `ba3c39ec-bdf8-4da2-94b5-feac34db6832` (activa, próxima 15/10/2026) y su
  asiento **N° 55** `b88ea27d-3e52-4a6f-aa7a-43a52c215535` (DRAFT, 15/09/2026).
- Cuenta **3.0.1 "Apertura"** `a969c731-9039-4ff0-81e7-4e792e2c3c96` (la crea la action).
- Apertura: **N° 65** `9394616d-ba61-4188-a14f-0d3aec9b038b` REVERSED, **N° 66**
  `c7ce101c-8b25-439d-b9b5-d09a707b0ac8` (reversión) y **N° 67**
  `42bbf830-6448-40cd-994d-88ca34151325` vigente (Caja chica D / Apertura H $2,00), POSTED en el
  OPENING del FY 1. Los números 56 a 64 (corridas repetidas de la edición) se borraron con
  `session_replication_role = 'replica'`: quedan como hueco. `last_entry_number` = 67. Ningún
  período cerrado.

**Desvíos y notas:**
- `reverseJournalEntryTx` entra en esta fase (el plan lo ubicaba en la 10) porque B25 lo necesita.
  Agrega a la firma de §3.3.4 `periodType?` (default MONTHLY; la apertura revierte en OPENING con
  la misma fecha, §3.3.10 #19) y `source?`.
- IVA, diferencia de cambio e inflación: §3.6 decía que conservaban la firma y seguían lanzando;
  se pasaron a `ActionResult` por el criterio del líder (toda action tocada). No tienen callers.
- Las actions de recurrentes pierden el parámetro `companyId` (§3.6): `getRecurringEntries`,
  `createRecurringEntry` y `deleteRecurringEntry` (no tocadas) todavía lo reciben del cliente.
- Las fechas de cierre de mes del IVA y la inflación se guardan a las 23:59:59.999Z (diseño:
  `endOfMonthUtc`), no a medianoche.
- La guía in-app y `docs/` (texto de "Editar" saldos de apertura) quedan para la Fase 13.
- **La Fase 12 ya no tiene que tocar** `generateRecurringEntry`, `generateAllPendingRecurringEntries`,
  `saveOpeningBalanceEntry`, `_RecurringEntriesTable`, `_GeneratePendingDialog` ni
  `_AccountBalancesForm`.

### Fase 8: Cierre y reapertura de meses
**Estado:** Completada (2026-10-06)

**Archivos creados** (`ACC/` = `src/modules/accounting/`, `SET/` = `ACC/features/settings/`):
- `SET/period-lock-common.ts` (puro, usable en cliente): tipos `PeriodMonthStatus`,
  `PeriodLockFiscalYear`, `PeriodLockStatus` (§3.3.5), `PERIOD_LOCK_STATUS_QUERY_KEY`
  (`['accounting', 'periodLockStatus']`), `formatMonthLong` ('marzo 2026'), `postDraftsLabel`
  ("Registrar los N borradores y cerrar" / "Registrar el borrador y cerrar") y
  `draftsPendingMessage` (texto de §3.3.5, hasta 5 números y `…`, singular/plural).
- `SET/period-closing.ts` (`server-only`, sin `'use server'`, H7): `closeMonthTx`, `reopenMonthTx`,
  `buildPeriodLockStatusTx` y `parseYearMonth`, todos con el cliente transaccional del llamador.
  Toman primero `lockAccountingSettingsTx`; sobre `listMonthlyPeriodsTx` eligen el primer mes
  abierto (un FY cerrado cuenta como todo cerrado) y el último cerrado de un FY abierto; borradores
  del mes por rango UTC (`startOfMonthUtc`/`endOfMonthUtc`); con `postDrafts`,
  `postJournalEntryTx` de cada uno por número y, si uno lanza `BusinessError`, se relanza como
  "No se cerró MM/YYYY: el borrador N° X no se puede registrar. <causa>" (la tx entera se
  revierte: D2 todo o nada); después marca el período (`closedAt`/`closedBy`) y
  `syncLockedUntilDateTx`. Sin ejercicios (Fase 3 pendiente) el cierre crea el FY 1 desde Ajustes
  con `ensureFiscalYearTx` y completa períodos faltantes de los FY abiertos (`ensurePeriodsTx`);
  el estado (solo lectura) se arma desde el rango de Ajustes sin crear nada (`id: null`).
- `SET/hooks/usePeriodLockMutations.ts`: `useMutation` de cierre y reapertura; siempre invalida
  `PERIOD_LOCK_STATUS_QUERY_KEY` y hace `router.refresh()` (también ante un rechazo, para corregir
  una pantalla desactualizada); `toast.error(result.error)`.
- `SET/components/_PeriodLockingPanel.tsx` (109), `_PeriodMonthCell.tsx` (65),
  `_ClosePeriodDialog.tsx` (91), `_ReopenPeriodDialog.tsx` (60): todos < 200. El panel usa
  `useQuery` con `initialData` del Server Component; un bloque por FY (abierto más antiguo y el
  siguiente), "Cerrado hasta el DD/MM/YYYY", nota del piso (B5) si hay FY cerrado, insignia de
  borradores por mes y botón solo en el mes con `action`. Diálogos con `AlertDialog` y `Button`
  propio (no `AlertDialogAction`, para no cerrarse antes de terminar). Con borradores y sin
  `accounting.entries` `approve`, el botón queda deshabilitado con el texto de §3.4.
- `SET/period-lock.integration.test.ts` (20 tests, prefijo `TSK760-PLK-`).

**Archivos modificados:**
- `SET/actions.server.ts`: **borrados** `getLockedPeriod` y `setLockedPeriod` (sin otros callers;
  ya no queda ningún fin de mes armado en el navegador). Nuevos `getPeriodLockStatus()`
  (`accounting.settings` `view`), `closeAccountingPeriod({ year, month, postDrafts })` y
  `reopenAccountingPeriod({ year, month })` con `ActionResult` (§3.6), `accounting.settings`
  `update` y además `accounting.entries` `approve` si `postDrafts` (D10, sin permisos nuevos),
  `getActiveCompanyId()` (sin `companyId` del cliente), `$transaction` con `timeout: 30_000,
  maxWait: 10_000` en el cierre (H10), `revalidateAccountingRoutes`. Se fue el `import moment`.
- `SET/AccountingSettings.tsx`: card con `id="bloqueo-periodos"` (`scroll-mt-20`, destino de los
  links de §3.5), descripción nueva y `_PeriodLockingPanel initialStatus={…}`; ya no pasa el rango
  de Ajustes. `SET/components/_PeriodLockingForm.tsx` **borrado** (238 líneas).
- `src/modules/commercial/features/products/features/list/product-imputation-filter.integration.test.ts`:
  `vi.mock('server-only')` (importa `getItemsWithoutAccountCounts` de las actions de Ajustes, que
  ahora importan el núcleo).

**Tests** (TDD: escritos primero; 18 de 20 fallaron por las actions inexistentes, los 2 que
pasaban eran el chequeo de TZ; con la implementación, 20/20):
- Orden (A1): estado sin FY desde Ajustes (12 meses, `id: null`, enero `close`, no crea FY);
  cerrar enero crea el FY y deja `lockedUntilDate` = `2026-01-31T23:59:59.999Z`, `closedBy`,
  `closedAt` y solo el permiso de Ajustes; cerrar marzo o enero de nuevo → "Solo se puede cerrar el
  primer mes abierto: 02/2026."; mes inexistente (07/2031) y mes 13 → texto; **B3**: asiento
  manual del 15/01 con enero cerrado → texto estándar; `action` = `[null, reopen, close, null]`;
  reabrir enero o marzo con febrero como último → "Solo se puede reabrir el último mes cerrado:
  02/2026."; reabrir febrero → `lockedUntil` 2026-01-31; reabrir enero → `null`; otra vez → "No hay
  meses cerrados para reabrir."; empresa sin Ajustes → estado `null` y texto NO_SETTINGS.
- **D2**: dos borradores en enero (uno a las 23:30Z del 31) → `draftCount` 2 y rechazo con
  "El mes 01/2026 tiene 2 borradores sin registrar (N° 1, 2). Registralos o elegí "Registrar los 2
  borradores y cerrar"."; con un borrador **desbalanceado** sembrado (N° 3) → "No se cerró 01/2026:
  el borrador N° 3 no se puede registrar. El asiento no está balanceado. Debe: $100.00, Haber:
  $90.00, Diferencia: $10.00", los tres siguen DRAFT (aunque 1 y 2 se registraron antes dentro de
  la tx), enero abierto, `lockedUntilDate` nulo, y se verificó el permiso `accounting.entries`
  `approve`; con una **cuenta no imputable** (N° 4) → mismo esquema con "La cuenta T760-RUBRO no es
  imputable (tiene subcuentas)."; sin los trabados → `{ lockedUntil: '2026-01-31', postedDrafts: 2 }`,
  ambos POSTED con `postDate` y período de enero; 6 borradores → lista 5 y `…`.
- **B5**: FY 1 (2026) cerrado con diciembre desincronizado (abierto) y FY 2 (2027) abierto: el estado
  muestra solo el FY 2 y `lastClosedFiscalYear` `{ 1, 2026-12-31 }`; cerrar 12/2026 → "Solo se puede
  cerrar el primer mes abierto: 01/2027."; reabrir 12/2026 u 11/2026 → "No se puede reabrir
  12/2026: pertenece al ejercicio N° 1, que está cerrado."; cerrar y reabrir 01/2027 →
  `lockedUntil` **2026-12-31** (piso, no `null`); el FY 1 sigue cerrado.
- **B22**: el bloque de diciembre corre dos veces, con `process.env.TZ = 'UTC'` y
  `'America/Argentina/Buenos_Aires'` (verifica que la zona cambió: el 01/12 01:00Z es día 1 o 30):
  cierra enero→noviembre por `{ year, month }`, un borrador del 01/12 01:00Z cuenta en diciembre
  (noviembre 0), "Registrar y cerrar" deja `lockedUntilDate` = `2026-12-31T23:59:59.999Z` y un
  asiento del 31/12 23:30Z se rechaza con "(mes 12/2026 cerrado)". Además el archivo completo se
  corrió con `TZ=UTC` y con `TZ=America/Argentina/Buenos_Aires` en el entorno: 20/20 en ambos.

**Calidad:** `npm run test` = **60 archivos, 791 tests, verdes**; `check-types` = **219**; `eslint`
de `SET/` sin errores ni warnings. Sin `any` ni `console`. No quedan empresas de test.

**Prueba en navegador** (Playwright contra :3010, "Empresa de Prueba 01 SA"; script temporal
borrado; capturas `f8-01` a `f8-10` en el scratchpad). `locked_until_date` inicial: **NULL**.
Borradores sembrados por SQL en mayo: N° 68 (Caja chica / Caja $1) y N° 69 (cuenta 1.0.0/00/00
ACTIVO, no imputable).
- Cerrar enero → abril en orden por la grilla: toasts "Se cerró enero 2026" … "abril 2026"; la
  grilla muestra "Cerrado hasta el 30/04/2026", abril con "Reabrir" y mayo con "Cerrar".
- **Fuera de orden**: una segunda pestaña abierta antes de cerrar abril (abril como "primer
  abierto") intenta cerrar abril → toast "Solo se puede cerrar el primer mes abierto: 05/2026." y
  la pestaña se actualiza.
- **D2**: el diálogo de mayo dice "Mayo 2026 tiene 2 borradores sin registrar" con el botón
  "Registrar los 2 borradores y cerrar" → toast "No se cerró 05/2026: el borrador N° 69 no se puede
  registrar. La cuenta 1.0.0/00/00 no es imputable (tiene subcuentas)."; en la DB 68 y 69 siguen
  DRAFT y mayo abierto. Borrado el N° 69 (dato de la prueba), el diálogo ofrece "Registrar el
  borrador y cerrar" → "Se registró el borrador y se cerró mayo 2026"; N° 68 POSTED con el período
  de mayo; `locked_until_date` = 2026-05-31 23:59:59.999.
- **B3**: Asientos → Nuevo asiento 10/03/2026 Caja chica / Caja $1 → toast "No se puede registrar
  con fecha 10/03/2026: el período está cerrado (mes 03/2026 cerrado). Para operar, reabrilo desde
  Contabilidad → Configuración → Bloqueo de Períodos." (no se creó).
- Reabrir mayo → abril → … → enero de a uno ("Se reabrió …"). **Final: 0 períodos cerrados y
  `locked_until_date` NULL** (igual que al inicio).
- Móvil (390 px): grilla de 3 columnas correcta. El `scrollWidth` de 408 px viene de los selectores
  de la card "Integración Comercial" (previo, fuera del panel).
- Primera corrida: el script se cortó tras cerrar febrero (detección de toasts del script); se
  dejó enero/febrero abiertos por SQL (`is_closed = false`, `closed_at/by = NULL`,
  `locked_until_date = NULL`) y se repitió entera.

**Datos que quedaron en la DB de dev:**
- Asiento **N° 68** `a771de5f-9181-4abe-be1b-d6288d1761c7`, **POSTED** (inmutable), 12/05/2026,
  "Verificación interna TSK-760 F8 (no usar)", Caja chica D / Caja H $1,00, período MONTHLY 05/2026
  `814a5e6e-2fa5-4388-a3af-de9239641f9a`, `created_by = 'tsk760-f8'`. Lo registró "Registrar el
  borrador y cerrar".
- N° 69 (`297ed9bf-9686-4ebe-8dae-7d9fc9dbd395`, DRAFT con cuenta no imputable) **borrado**: queda
  como hueco. `last_entry_number` = 69. Ningún borrador real de dev se registró.
- Ningún período cerrado; `locked_until_date` NULL.

**Desvíos y notas:**
- `PeriodLockFiscalYear.id` es `string | null` (`null` = empresa sin ejercicios, estado armado desde
  Ajustes); el diseño lo tipaba `string`. El panel recibe `initialStatus` del Server Component
  (el diseño lo listaba sin props) para no mostrar la grilla vacía mientras carga.
- La lógica transaccional va en `SET/period-closing.ts` (no en `actions.server.ts`) para que las
  actions sean envoltorios finos y la lógica no quede expuesta como endpoint (H7).
- `closeAccountingPeriod` con un mes ya cerrado responde "Solo se puede cerrar el primer mes
  abierto: …" (el diseño no tenía texto propio para ese caso). Mes inválido: "Mes inválido:
  2026-13." (texto no fijado).
- Mientras no corra la Fase 3, una empresa con `lockedUntilDate` desincronizado de los períodos
  (escenario 1 de 1.6.2) vería **bajar** `lockedUntilDate` al cerrar o reabrir un mes, porque se
  deriva de los períodos. La Fase 3 hace el backfill por unión (D3) antes del deploy; en dev
  `locked_until_date` era NULL.
- El cierre de mes solo considera FY existentes: si todos los meses del FY abierto están cerrados y
  no existe el siguiente, responde "No hay meses abiertos para cerrar…" (el siguiente lo crea el
  primer asiento de esa fecha o el cierre anual).
- `docs/` y la guía in-app (textos nuevos de "Bloqueo de Períodos") quedan para la Fase 13.

### Fase 9: Cierre anual
**Estado:** Completada (2026-10-06)

**Archivos creados** (`ACC/` = `src/modules/accounting/`, `UT/` = `ACC/shared/utils/`, `FYC/` = `ACC/features/fiscal-year-close/`):
- `UT/fiscal-year-close-math.ts` (puro, `Decimal`): `buildClosingLines` (refundición; contrapartida en
  Resultado solo si el neto ≠ 0, H5/B20), `buildOpeningLines` (patrimoniales + efecto de la refundición
  sobre Resultado fusionado en una línea, B21) y `summarizeResults`.
- `UT/closing-entries.ts`: `NOT_CLOSE_GENERATED_OPENING_SQL`, `NOT_CLOSING_ENTRY_SQL` y sus `*Where`
  Prisma (§3.3.8), con el invariante "`openingEntryId` solo lo escribe el cierre".
- `FYC/fiscal-year-close.ts` (`server-only`, sin `'use server'`, H7): `computeClosePreviewTx` (saldos
  POSTED acumulados al fin del FY, sin filtro de cuenta activa, sin aperturas generadas; C4/H5/B18),
  `buildFiscalYearStatusTx`, `findOpenFiscalYearTx`, `closeFiscalYearTx` (§3.1.5: lock → FY abierto
  más antiguo → meses (B1) → borradores (A5/B4) → cuenta Resultado → vista previa (B20) → refundición
  POSTED en CLOSING con el FY abierto (D12) → `ensureFiscalYearTx` del siguiente (B24) → apertura
  verificada en OPENING (B21) → FY y todos sus períodos cerrados, `closingEntryId`/`openingEntryId`,
  OPENING del siguiente cerrado (C7) → `syncLockedUntilDateTx` → Ajustes al FY abierto más antiguo).
- `FYC/fiscal-year-close-common.ts` (tipos `ClosePreview`, `FiscalYearCloseStatus`, query key, links).
- `FYC/components/_CloseChecklist.tsx` (93) y `_ClosePreviewTables.tsx` (106).
- Tests: `UT/fiscal-year-close-math.test.ts` (19) y `FYC/fiscal-year-close.integration.test.ts` (17,
  prefijo `TSK760-FYC-`).

**Archivos modificados:**
- `FYC/actions.server.ts` reescrito: `getFiscalYearStatus()`, `previewFiscalYearClose(fiscalYearId)` →
  `ActionResult<ClosePreview>` y `closeFiscalYear({ fiscalYearId })` → `ActionResult<{ closingEntryNumber;
  openingEntryNumber; nextFiscalYearNumber }>` (`timeout: 30_000, maxWait: 10_000`, H10), sin `companyId`
  del cliente. `FiscalYearClose.tsx` ya no pasa `companyId`.
- `_FiscalYearStatus.tsx` (116): ejercicio abierto más antiguo, checklist con links a Bloqueo de
  Períodos (`#bloqueo-periodos`) y Asientos, botón "Cerrar ejercicio N° X" deshabilitado si
  `!canClose`, tarjeta del último cerrado (refundición/apertura). `_ClosePreviewDialog.tsx` (215 → 116):
  `useQuery` (fuera el `useEffect`) + `useMutation`, `Button` propio, toast con los números.
- Exclusiones (§3.3.8): `UT/balances.ts` (los 5 cálculos; `whereCondition: any` → tipado), Mayor (saldo
  anterior y movimientos), Estado de Resultados, Presupuesto vs. real, movimientos por centro de costo
  (`reports/actions.server.ts`), `budgets/actions.server.ts` (ejecución), control de presupuesto de
  gastos (`INT/commercial`), IVA (preview), diferencia de cambio e inflación.
- Mes/día de inicio del ejercicio leídos con `moment.utc` en presupuestos (`budgets/actions.server.ts`
  ×3, `getBudgetVarianceReport`, `checkBudgetForExpense`, `_CreateBudgetModal`): tras el cierre Ajustes
  queda a 00:00Z y en hora local (dev, UTC-3) el ejercicio de presupuestos arrancaba el 31/12.

**Tests** (TDD: math rojo por módulo inexistente; integración 13/17 en rojo con las actions viejas; con
los fragmentos de exclusión neutralizados, 7 casos de reportes fallan; con la implementación, verdes):
validaciones (meses abiertos B1 con texto exacto y `openMonths`; borrador viejo → texto y
`pendingDrafts`; B20 en vista previa y cierre sin consumir número ni crear FY; sin cuenta de Resultado;
FY que no es el más antiguo; FY inexistente); cierre feliz (vista previa = asientos; refundición
CLOSING 31/12 y apertura OPENING 01/01 balanceadas; FY 1 con 14 períodos cerrados; FY 2 con 12 meses
abiertos y OPENING cerrado; Ajustes y `lockedUntilDate`; estado posterior; "ya está cerrado"); después
del cierre: Balance, Sumas y Saldos, `calculateAccountBalance` y Mayor de enero = saldos del cierre (B18),
Estado de Resultados 2026 con sus valores (B19), presupuesto y centros de costo sin la refundición, IVA
de enero, diferencia de cambio e inflación sin la apertura (H4); reabrir 12/2026 → rechazo; **segundo
cierre** sin duplicar; FY 2 preexistente reutilizado (B24) con resultado previo al primer FY y cuenta
inactiva incluidos (C4/H5) y sin línea de Resultado en 0.

**Calidad:** `npm run test` = **62 archivos, 827 tests, verdes**; `check-types` = **219**; `eslint` de los
archivos tocados sin errores (warnings previos: `Input` en `_CreateBudgetModal`, `fiscalYearStart/End` en
`checkBudgetForExpense`, dos interfaces sin uso en `reports`). Sin `any` (se fue uno) ni `console`.
Componentes < 200. No quedan empresas de test.

**Prueba en navegador** (Playwright contra :3010; script temporal borrado; capturas `f9-01` a `f9-17` en
el scratchpad). Empresa sembrada por SQL **"TSK760 Demo cierre anual (no usar)"**
(`76076076-0000-4000-8000-000000000009`), el usuario de dev como dueño, Ajustes 2025 (03:00Z), 6 asientos
POSTED 2025 y un borrador N° 7 en diciembre. Se cambió la empresa activa con el selector del sidebar.
- Antes: la pantalla de cierre lista los 12 meses abiertos y "1 borrador sin registrar: 12/2025: N° 7",
  botón deshabilitado. Balance al 31/12/2025 y Estado de Resultados 2025 (680.000 / 370.000).
- Bloqueo de Períodos: enero → noviembre en orden; diciembre "tiene 1 borrador" → "Registrar el
  borrador y cerrar".
- Cierre: checklist en verde; vista previa (ingresos 680.000, gastos 375.000, ganancia 305.000;
  refundición y apertura de 5 líneas por 1.405.000); "Confirmar cierre" → toast "Ejercicio N° 1 cerrado:
  refundición N° 8 y apertura N° 9. Queda abierto el ejercicio N° 2." DB: FY 1 cerrado con 14 períodos
  cerrados, FY 2 (2026, 00:00Z → 23:59:59.999Z) con OPENING cerrado, `locked_until_date` 31/12/2025.
- Después: Balance al 31/01/2026 = 1.405.000 de activo (no el doble), Sumas y Saldos de enero 2026 y Mayor
  con saldo anterior sin movimientos repetidos, plan de cuentas con saldos del Ej. 2, Estado de
  Resultados 2025 = 305.000 (no cero), Diario con la refundición (31/12) y la apertura (01/01), Bloqueo de
  Períodos con el FY 2 y la nota del piso. Móvil 390 px sin scroll horizontal.
- **Ojo:** la primera vez los reportes de saldos salieron duplicados: el dev server (Turbopack) no había
  recargado `balances.ts` (`'use server'`). Reiniciado el server, correctos. Reverificar en build de
  producción (Fase 14).
- Al terminar se volvió a "Empresa de Prueba 01 SA" (verificado en `user_preferences`).

**Datos que quedaron en la DB de dev:** la empresa **"TSK760 Demo cierre anual (no usar)"**
(`76076076-0000-4000-8000-000000000009`, 9 cuentas, asientos N° 1 a 9 POSTED, FY 1 2025 cerrado, FY 2
2026 abierto) con el usuario de dev como miembro dueño. No se borró (asientos POSTED inmutables); para
borrarla hace falta `session_replication_role = 'replica'`. "Empresa de Prueba 01 SA" no se tocó.

**Desvíos y notas:**
- `closing-entries.ts` sin `server-only` (solo constantes): si no, había que mockearlo en tests de
  reportes existentes (`cost-center-movements.integration`).
- Refundición fechada el último día a 00:00Z (no al `endDate` 23:59:59.999Z), como los demás asientos
  de día. Textos de §3.3.9 respetados; nuevos: "Ejercicio no encontrado.", singular "hay 1 borrador sin
  registrar", y la vista previa también devuelve B20.
- `FiscalYearCloseStatus.fiscalYear.id` es `string | null` (sin ejercicios, desde Ajustes), como en la
  Fase 8. `ClosePreview` agrega `openingDay`.
- Preexistente, fuera de alcance: `getBalanceSheet.isBalanced` compara activo (deudor, +) contra pasivo
  y patrimonio (acreedor, −), así que el Balance General muestra "no está equilibrado" en toda empresa
  con pasivo o patrimonio (antes y después del cierre). Candidato a ticket aparte. Warnings de `key`
  previos en `_AccountsTable`/reportes.
- `docs/` y guía in-app quedan para la Fase 13.

### Fase 10: Reversión desde Asientos (+ "Eliminar borrador", C6)
**Estado:** Completada (2026-10-06)

**Archivos creados** (`ACC/` = `src/modules/accounting/`, `UT/` = `ACC/shared/utils/`, `ENT/` = `ACC/features/entries/`):
- `UT/entry-document-link.ts` (`server-only`, sin `'use server'`): `getEntryDocumentLink(tx, companyId, entryId)`
  (un `findFirst` con las 7 relaciones inversas + refundición/apertura de FY, y un `fundMovement.findFirst` por la
  columna sin relación), `entriesWithoutDocumentWhere(tx, companyId)` y `buildDocumentLinkedMessage(link, 'reverse' |
  'delete')` con los textos de §3.3.7 (contrae "a el" → "al": "pertenece al egreso GTO-00007").
- `ENT/components/_DeleteDraftEntryDialog.tsx` (68): `AlertDialog` + `useMutation` de `deleteDraftJournalEntry`.
- `ENT/components/_EntryActionsMenu.tsx` (72): el menú de la fila con sus tres diálogos (Registrar y Eliminar
  borrador en DRAFT, Anular en POSTED), cada uno con su permiso (`approve` / `delete`).
- `ENT/reverse-entry.integration.test.ts` (18 tests, prefijo `TSK760-RV-`).

**Archivos modificados:**
- `ENT/actions.server.ts`:
  - `reverseJournalEntry({ entryId })` → `ActionResult<{ reversalNumber }>` (§3.6): sin `companyId` del cliente; en
    una tx, `getEntryDocumentLink` → `BusinessError` con el texto de §3.3.7 si hay documento (D6), y si no
    `reverseJournalEntryTx` (Fase 7) con fecha `startOfDayUtc(hoy)` (D5): valida el período del original (con
    `subject` "No se puede anular el asiento N° X (fecha …)") y el de hoy, y copia auxiliares, centro de costo y
    moneda invertidos (B10). Se fueron el `UPDATE … + 1` propio, el `journalEntry.create` y `validatePeriodLock`.
  - `getReversalCheck(entryId)` → `ActionResult<{ link, blockedMessage, warning, date }>` (§3.6, más
    `blockedMessage` para que el cliente no arme el texto): aviso para `createdBy = 'system'` sin vínculo (D6).
  - `deleteDraftJournalEntry(entryId)` → `ActionResult<{ number }>` (C6): `accounting.entries` `delete`; solo DRAFT
    de la empresa activa, sin documento y no `'system'`; borra con `deleteMany({ id, companyId, status: DRAFT })`
    (si otro lo registró entre lectura y borrado, no borra). No valida período (H9).
- `ENT/validators/index.ts`: **borrados** `validatePeriodLock` y `resolveFiscalPeriod` (deprecados en Fase 4, sin
  callers) y el `import moment`.
- `ENT/components/_ReverseEntryDialog.tsx` (105): `useQuery(['accounting', 'reversalCheck', id])` + `useMutation`;
  bloqueo en rojo con el botón deshabilitado ("Cerrar"), aviso ámbar para sistema sin vínculo, "La anulación se
  registra con fecha de hoy (DD/MM/YYYY)"; `Button` propio (no se cierra antes de terminar).
- `ENT/components/_EntriesTable.tsx` (353 → 302): el menú y los diálogos pasan a `_EntryActionsMenu`; de paso, la
  fila usa `React.Fragment key` (se va el warning de `key` previo, visto en Fases 4 y 9).
- `ACC/features/reports/actions.server.ts`: `getEntriesWithoutDocuments` usa `entriesWithoutDocumentWhere` (ahora
  excluye también egresos, fondos, depreciación, revalúo y cierre/apertura). `cost-center-movements.integration.test.ts`:
  `vi.mock('server-only')` (importa esas actions).
- `ACC/features/settings/period-closing.ts`: el "No se cerró MM/YYYY: el borrador N° X no se puede registrar. …" de
  D2 agrega "Si es un asiento manual que ya no sirve, podés eliminarlo desde Asientos." cuando el borrador es
  manual (no `'system'` y sin documento). `period-lock.integration.test.ts`: los 2 textos exactos actualizados.

**Tests** (TDD: escritos primero, 17/17 en rojo por las actions inexistentes; con la implementación, verdes; luego
+1 de `entriesWithoutDocumentWhere`). "Hoy" fijo en 06/10/2026 15:00Z con `vi.useFakeTimers({ toFake: ['Date'] })`:
- anular un manual POSTED: reversión N° = original + 1, fecha 2026-10-06T00:00Z, MONTHLY 10/2026, POSTED,
  `originalEntryId`; original REVERSED con `reversedBy`; líneas invertidas con `supplierId`, `costCenterId`,
  `currency` USD, `originalAmount` y `exchangeRate`; permiso `approve`.
- mes del original cerrado → texto exacto con `subject`, sin consumir número, sigue POSTED; mes de hoy cerrado →
  "No se puede registrar con fecha 06/10/2026: … (mes 10/2026 cerrado)."
- factura de compra, egreso, movimiento de fondos (columna sin relación) y refundición → textos exactos de §3.3.7,
  siguen POSTED; borrador → "Solo se pueden anular asientos registrados; el N° X está en estado Borrador."; otra
  empresa → "Asiento no encontrado."; `'system'` sin vínculo → se anula.
- `getReversalCheck`: manual (todo `null`, `date` '2026-10-06'), sistema sin vínculo (aviso "no revierte el saldo
  bancario ni el estado del equipo"), vinculado (`link` + `blockedMessage`).
- `entriesWithoutDocumentWhere`: de manual + factura + fondos + refundición queda solo el manual.
- `deleteDraftJournalEntry`: borra el DRAFT manual y sus líneas (permiso `delete`); rechaza POSTED ("Solo se
  eliminan borradores; el asiento N° X está en estado Registrado."), DRAFT de factura (texto con el comprobante) y de
  fondos, DRAFT `'system'` sin vínculo, de otra empresa; sin permiso (`checkPermission` rechaza) no borra nada.

**Calidad:** `npm run test` = **63 archivos, 845 tests, verdes**; `check-types` = **219**; `eslint` de los archivos
tocados sin errores (warnings previos: `error` en `_CreateEntryModal`, dos interfaces sin uso en `reports`). Sin
`any` ni `console`. Componentes < 200 salvo `_EntriesTable` (302, ya excedido; bajó 51). No quedan empresas de test.

**Prueba en navegador** (Playwright contra :3010, "Empresa de Prueba 01 SA"; script temporal borrado; capturas
`f10-01` a `f10-08` en el scratchpad). Se **reinició el dev server** antes de probar (cambió la firma de
`reverseJournalEntry`; en la Fase 9 Turbopack no había recargado un archivo `'use server'`).
- N° 51 (DRAFT de la compra 0001-97244388): "Eliminar borrador" → toast "Este asiento pertenece a la factura de
  compra 0001-97244388 y no se puede eliminar: solo se eliminan borradores manuales." Registrar → POSTED. Anular →
  el diálogo muestra en rojo "Este asiento pertenece a la factura de compra 0001-97244388 y no se puede anular desde
  Asientos: anulá el comprobante." con "Anular" deshabilitado.
- N° 50 (manual "Verificación interna TSK-760"): el diálogo dice "La anulación se registra con fecha de hoy
  (07/10/2026)" → toast "Asiento N° 50 anulado con el asiento N° 70". DB: 50 REVERSED; 70 POSTED, 07/10/2026,
  con período, Caja D $1 / Caja chica H $1 (invertidas).
- Nuevo asiento manual 06/10/2026 Caja chica / Caja $1 → "Asiento N° 71 creado en borrador"; "Eliminar borrador" →
  "Borrador N° 71 eliminado" y la fila desaparece.

**Datos que quedaron en la DB de dev:**
- **N° 51** `803231de-164c-40ce-b99b-4fe210b68250` (compra 0001-97244388) pasó de DRAFT a **POSTED** (inmutable),
  para tener un asiento registrado de comprobante (no había ninguno en dev).
- **N° 50** `dd45a66d-5e64-4a0e-8b94-fdecba6e4bde` **REVERSED**; **N° 70** (reversión, POSTED, 07/10/2026).
- N° 71 creado y eliminado: queda como hueco. `last_entry_number` = 71. Ningún período cerrado.

**Desvíos y notas:**
- **Fecha de la reversión = hoy en UTC (D5):** a las 22:40 AR el diálogo y el asiento dicen 07/10/2026 (en UTC ya es
  el día siguiente). Es lo que pide el diseño y el diálogo lo muestra antes de confirmar; si molesta, la alternativa
  es mandar el día local desde el cliente (los formularios de Fase 6 y 7 ya usan mediodía local).
- El aviso de D6 sale para todo `'system'` sin vínculo, lo que incluye IVA e inflación (también `'system'`); el texto
  es genérico ("por ejemplo, un movimiento bancario, una transferencia o la baja de un equipo"). Recurrentes y
  diferencia de cambio (`userId`) no lo muestran.
- Etiqueta de egresos: "el egreso GTO-…" (el diseño decía "el gasto"): así se llaman en el sidebar y en los toasts.
- `getReversalCheck` agrega `blockedMessage`; `deleteDraftJournalEntry` devuelve `{ number }` (para el toast).
- "Eliminar borrador" también rechaza los DRAFT `'system'` sin vínculo (bancos, transferencias, baja): borrarlos
  dejaría el movimiento sin asiento. Para destrabar un mes con uno de esos hay que reabrir/corregir el origen.
- `_EntryActionsMenu` (nuevo) en vez de crecer `_EntriesTable` 3-4 líneas: el menú y los diálogos salen de la
  tabla (−51 líneas).
- `docs/` y la guía in-app quedan para la Fase 13.

### Fase 11: Borrado de código muerto
**Estado:** Completada (2026-10-06)

**Archivos borrados / modificados** (`INT/` = `src/modules/accounting/features/integrations/`):
- `INT/treasury/index.ts` **borrado** (B9): `createJournalEntryForBankTransfer`, `createJournalEntryForCheckDeposit`
  y `createJournalEntryForCheckRejection`, que devolvían `null` ante cualquier error. No había barrel que lo
  exportara (`INT/index.ts` no existe), así que no hubo export que quitar.
- `INT/commercial/index.ts`: **borrado** `createJournalEntryForCOGS` (D13, tragaba errores y devolvía `null`) con su
  encabezado de sección. Los imports que usaba siguen en uso por otras funciones.
- `docs/modules/accounting.md`: la línea de seguimientos de TSK-728 que listaba ambos como pendientes.

**Verificación previa (0 llamadores):** `grep -rn "integrations/treasury\|createJournalEntryForBankTransfer\|
createJournalEntryForCheckDeposit\|createJournalEntryForCheckRejection\|createJournalEntryForCOGS"` en `src/`
(sin `src/generated`), `prisma/`, `scripts/`, `docs/` y `.claude/` → solo las propias definiciones (y dos menciones en
documentación: la de `accounting.md`, actualizada, y el plan histórico `docs/contable/plan-implementacion-contable.md`,
que no se toca). No hay carpeta `cypress/`.

**Greps de cierre:**
- `grep -rn "journalEntry.create(\|lastEntryNumber + 1\|last_entry_number + 1" src/modules` (sin tests) → solo
  `UT/journal-entry-tx.ts` (`createJournalEntryTx` y el SQL de `nextEntryNumberTx`).
- `return null` en `INT/`, `journal-entry-tx.ts`, bancos y fondos: ninguno es un creador de asientos que calle un
  error. Quedan la excepción conservada a propósito (bancos sin Ajustes, `createTreasuryEntryTx`, con `logger.warn`),
  el control de presupuesto de egresos (`checkBudgetForExpense`, no crea asientos) y lecturas de fondos.

**Calidad:** `npm run test` = **63 archivos, 845 tests, verdes** (sin cambios: el código borrado no tenía tests);
`check-types` = **219**; `eslint` de `INT/commercial/index.ts` sin errores (2 warnings previos en
`checkBudgetForExpense`). Sin prueba en navegador: no hay comportamiento visible que cambie.

### Fase 12: Errores legibles en producción (`ActionResult`) en las actions restantes
**Estado:** Completada (2026-10-06)

**`ActionResult`: no quedó nada por migrar.** Las 7 funciones y los 7 componentes de esta fase se adelantaron en
las Fases 4 (`createJournalEntry`, `postJournalEntry`, `_CreateEntryModal`, `_PostEntryDialog`), 6
(`createBankMovement`, `createBankTransfer`, `_CreateBankMovementDialog`, `_BankTransferDialog`) y 7
(`generateRecurringEntry`, `generateAllPendingRecurringEntries`, `saveOpeningBalanceEntry`, `_RecurringEntriesTable`,
`_GeneratePendingDialog`, `_AccountBalancesForm`). Con `closeAccountingPeriod`/`reopenAccountingPeriod` (8),
`closeFiscalYear` (9) y `reverseJournalEntry`/`deleteDraftJournalEntry`/`getReversalCheck` (10) están las 9 de 1.2.6 y
los 10 componentes. Verificado en esta fase:
- `grep -n "throw new Error"` en esas actions: solo "No autenticado" / "No hay empresa activa" antes del `try` (siguen
  como `throw`, 2.0). Los `throw new Error` que quedan en esos archivos son de actions fuera de alcance (lecturas,
  conciliación y borrado de movimientos bancarios, facturas de apertura, `saveAccountingSettings`, ver abajo).
- Ningún test afirma `rejects.toThrow` sobre una action migrada: los que quedan son de helpers `*Tx` del núcleo
  (`assertPeriodOpen`, `reopenMonthTx`, integraciones de comprobantes), que lanzan `BusinessError` a propósito, o
  del `NEXT_REDIRECT` de `checkPermission`.
- Otras actions con asiento que pasan por el núcleo también devuelven `ActionResult` (desde TSK-721/724c/728 o
  fases 5–7): `confirmInvoice`, `confirmPurchaseInvoice`, `confirmReceipt`, `confirmPaymentOrder`, `confirmExpense`,
  `confirmFundMovement`, `softDeleteVehicle`, `postDepreciationEntry`, `postAllPendingDepreciations`,
  `createValueAdjustment`, IVA, cambio e inflación.

**Corrección "hoy" (D5 revisado, decisión del líder; 2.0).**
- `UT/utc-month.ts`: `BUSINESS_TIME_ZONE = 'America/Argentina/Buenos_Aires'` (constante única),
  `todayBusinessDay(now = new Date()): IsoDay` (`Intl.DateTimeFormat#formatToParts` con esa zona; `moment-timezone`
  no está instalado y no se agregó) y `todayBusinessDayUtc(now?)` = ese día a 00:00Z (`parseIsoDay`, D8). Puro.
- **Lugares cambiados** (todo `new Date()`/`moment.utc()` como "hoy" para fechar asientos o decidir vencimientos en el
  código de la rama, `git diff main...HEAD`):
  1. `ACC/features/entries/actions.server.ts` `reverseJournalEntry`: fecha de la reversión
     `startOfDayUtc(new Date())` → `todayBusinessDayUtc()` (y con ella la validación del período de "hoy").
  2. ídem `getReversalCheck`: `date` del diálogo `toUtcDay(new Date())` → `todayBusinessDay()`.
  3. `INT/equipment/index.ts` `createJournalEntryForAssetSale` y 4. `createJournalEntryForAssetDisposal`: fecha del
     asiento de baja `new Date()` (hora real, el núcleo la leía por día UTC) → `todayBusinessDayUtc()`.
  5. `ACC/features/recurring-entries/actions.server.ts` `getRecurringEntries` (`isPending`) y
     6. `generateAllPendingRecurringEntries` (filtro de pendientes): `nextDueDate <= ahora` →
     `nextDueDate <= fin del día AR` y `endDate >= inicio del día AR` (helper local `businessToday()`). Antes, una
     plantilla guardada a mediodía local (como guarda el formulario) no vencía hasta las 12:00, y a las 22:40 AR
     vencían las de mañana a 00:00Z.
- **No cambiados (no son "hoy" de negocio):** sellos de tiempo (`postDate`, `reversedAt`, `closedAt`,
  `confirmedAt`, `reconciledAt`, `postedDate`), corte de imputabilidad `disabledFrom > now` (instante),
  `Vehicle.terminationDate = new Date()` en `softDeleteVehicle` (dato del equipo, no del asiento; archivo fuera del
  diff), presupuestos (`moment()` para el año en curso, fuera de alcance) y `getCurrentFiscalYear` (`UT/fiscal-year.ts`,
  fuera del diff). Los defaults de fecha de los formularios cliente (`_CreateEntryModal`, bancos, recurrentes) ya
  usan el día local del navegador.
- Texto del diálogo de anulación: sin cambios ("La anulación se registra con fecha de hoy (DD/MM/YYYY)"); ahora la
  fecha es la de Argentina.

**Tests** (TDD: primero en rojo, 18 fallando entre los cuatro archivos; después verdes):
- `UT/utc-month.test.ts` (+7 casos × 2 zonas de proceso, `TZ=UTC` y `TZ=America/Argentina/Buenos_Aires`, fake
  timers): constante única; 23:30 AR (02:30Z) → día AR; 22:40 AR (01:40Z) → día AR; 00:00 AR (03:00Z) ya es el día
  siguiente; 23:59:59.999 AR sigue en el anterior; 31/12 21:30 AR (01/01 00:30Z) → 31/12 y mes 12/2026; mediodía.
- `ENT/reverse-entry.integration.test.ts` (+2): a las 01:40Z del 07/10 `getReversalCheck.date` = '2026-10-06' y la
  reversión queda 2026-10-06T00:00Z en 10/2026; a las 01:00Z del 01/10 la reversión va al 30/09 y con septiembre
  cerrado devuelve `{ success: false, error: 'No se puede registrar con fecha 30/09/2026: el período está cerrado…' }`.
- `ACC/features/recurring-entries/recurring-entries.integration.test.ts` (+1): a las 10:00 AR vence la plantilla de
  hoy a mediodía local; a las 22:40 AR (01:40Z) no vence la de mañana a 00:00Z.
- `equipment/features/list/asset-disposal.integration.test.ts`: 1b afirma la fecha del asiento de baja =
  `todayBusinessDayUtc()`; 4b cierra el mes de `todayBusinessDayUtc()` (antes `new Date()` con `getUTC*`, que
  fallaba de noche en AR).

**Calidad:** `npm run test` = **63 archivos, 862 tests, verdes**; `check-types` = **219**; `eslint` de los 8 archivos
tocados sin errores ni warnings. Sin `any` ni `console`. Ningún componente tocado.

**Prueba en navegador** (Playwright contra :3010, reiniciado antes; "Empresa de Prueba 01 SA"; 22:56 AR del 06/10 =
01:56Z del 07/10; script temporal borrado; capturas `f12-01` a `f12-04` en el scratchpad). Octubre 2026 se cerró
**temporalmente por SQL** (`accounting_periods.is_closed`) y se reabrió en el `finally`:
- Anular N° 34 (mes abierto): el diálogo dice "La anulación se registra con fecha de hoy (06/10/2026)." (antes
  07/10/2026 a esta hora).
- Con 10/2026 cerrado: Anular N° 34 → toast "No se puede registrar con fecha 06/10/2026: el período está cerrado (mes
  10/2026 cerrado). Para operar, reabrilo desde Contabilidad → Configuración → Bloqueo de Períodos."; Registrar el
  borrador N° 53 → el mismo texto; "Generar asiento" de la recurrente (vence 15/10) → "No se puede registrar con
  fecha 15/10/2026: … (mes 10/2026 cerrado). …".
- DB después: N° 34 POSTED, N° 53 DRAFT, la recurrente sin generar (`next_due_date` 15/10). Nada cambió.

**Desvíos y notas:**
- La fase no migró ninguna action a `ActionResult`: ya estaban todas (ver arriba). El trabajo de código es la
  corrección de "hoy".
- `saveAccountingSettings` todavía lanza `throw new Error` para las fechas del ejercicio ("no puede ser mayor a un
  año", "fin posterior al inicio"); §3.6 la pasa a `ActionResult` sin fechas (D11), que es trabajo de la **Fase 3**.
- En la DB de dev hay un asiento N° 999999 DRAFT `system` "dbg" (10/07/2026) que no es de esta fase; no se tocó.

### Fase 13: Capturas, documentación, guía in-app y presentación
**Estado:** Completada (2026-10-06)

**Archivos creados** (`GP/` = `scripts/guia-presentacion/`):
- `GP/capturas-tsk760.mjs`: siembra por SQL una empresa propia con nombre realista, **"Distribuidora del Sur SA"**
  (ids fijos `76076013-…`, CUIT ficticio, el usuario de dev como dueño y empresa activa por `user_preferences`):
  plan de 11 cuentas (una de sumatoria, `1.1.1/00/00 Disponibilidades`), Ajustes 2025 con Resultado/Gastos/
  Proveedores/Banco/Caja, ejercicio N° 1 2025 con 14 períodos (enero y febrero cerrados, bloqueo 28/02/2025), 50
  asientos realistas de 2025 (aporte de capital + compras, ventas, cobranzas y sueldos de cada mes; en marzo 3
  borradores manuales, uno con la cuenta de sumatoria) y el egreso GTO-00001 del 20/02/2025 en borrador. Recorre
  24 pasos con chequeos de pantalla **y** de base (sale con código 1 si alguno falla), verifica en cada captura que
  el texto visible no contenga `TSK|demo|test|no usar|verificación interna|prueba|dbg`, y limpia la empresa
  entera al empezar, al terminar, ante una excepción y ante SIGINT/SIGTERM: `SET LOCAL session_replication_role =
  'replica'` **solo** dentro de la transacción de limpieza y solo sobre filas de esa empresa (líneas de sus
  asientos, períodos de sus ejercicios, toda tabla con `company_id` = la empresa, la empresa), y restaura la
  empresa activa a "Empresa de Prueba 01 SA". `--clean` solo limpia.
- `GP/assets/tsk760-*.png` (27): 01 grilla, 02 diálogo con 3 borradores, 03/03b todo o nada (toast y pantalla),
  04/05 eliminar borrador, 06 registrar y cerrar (toast y pantalla), 07 fuera de orden (segunda ventana
  desactualizada), 08 reabrir, 09/09b asiento manual en febrero cerrado, 10/10b egreso en febrero cerrado, 11
  fechas de solo lectura, 12 checklist pendiente, 13 listo, 14 vista previa, 15 toast, 16 estado posterior, 17
  Balance al 31/01/2026, 18 Estado de Resultados 2025, 19 grilla con la nota del ejercicio cerrado, 20/21 anular
  manual (fecha de hoy AR) y toast, 22 anular asiento de egreso bloqueado, 23/24 móvil 375.
- `GP/tsk-760.html` y `docs/presentaciones/TSK-760-cierre-contable.pdf` (11 páginas A4).
- `src/modules/help/features/guide/components/_AccountingClosingGuide.tsx` (163 líneas): cierre de meses y
  borradores, cierre de ejercicio, anular y eliminar asientos.

**Archivos modificados:**
- `_AccountingGuide.tsx` (917 → 853): las cards viejas "Cierre de Ejercicio" y "Bloqueo de Períodos" se
  reemplazan por `<_AccountingClosingGuide />`; Asientos: "Crear Asiento" con fecha en mes abierto, estado
  "Anulado", Anular (fecha de hoy) y Eliminar borrador; Configuración: fechas de solo lectura y Bloqueo.
- `docs/modules/accounting.md`: ciclo de vida, validación, Reversión (anular) + Eliminar borrador, Numeración,
  sección nueva **Núcleo de asientos** (helpers, `assertPeriodOpen`, tabla de mensajes, `createJournalEntryTx`,
  errores, convención de días UTC y "hoy" en Argentina), Cierre de Ejercicio reescrito (requisitos, flujo,
  exclusión de apertura/refundición en reportes, defecto previo de `isBalanced`), Ejercicio Fiscal, Bloqueo de
  Períodos (actions, permisos, tabla de impacto única), Saldos de Apertura (B25, H3, C7).
- `docs/architecture/data-model.md`: `JournalEntry` (fiscalYearId/periodId, campos de reversión), `FiscalYear` y
  `AccountingPeriod` en la tabla, invariantes de ejercicios/períodos/`lockedUntilDate`, relaciones.
- `docs/conventions/coding-standards.md`: convención "Asientos contables: `createJournalEntryTx`" con el grep de
  verificación.
- Dos correcciones chicas encontradas por las capturas:
  - `FYC/fiscal-year-close.ts`: "Cerrado el …" del último ejercicio cerrado mostraba el día **UTC** del instante
    de cierre (a las 23:40 AR decía el día siguiente); ahora `todayBusinessDay(closedAt)` (D5 revisado).
  - `ENT/components/_CreateEntryModal.tsx`: `max-w-3xl` → `sm:max-w-3xl`. El `sm:max-w-lg` del `DialogContent`
    base ganaba en escritorio y el formulario quedaba recortado y desplazado (previo a 760).

**Resultado del script** (corrida final, 2026-10-06 ~23:50 AR): "Todos los chequeos pasaron"; textos reales:
"No se cerró 03/2025: el borrador N° 12 no se puede registrar. La cuenta 1.1.1/00/00 no es imputable (tiene
subcuentas). Si es un asiento manual que ya no sirve, podés eliminarlo desde Asientos." · "Borrador N° 12
eliminado" · "Se registraron 2 borradores y se cerró marzo 2025" · "Solo se puede cerrar el primer mes abierto:
04/2025." · "No se puede registrar con fecha 15/02/2025 (y 20/02/2025 en el egreso): el período está cerrado (mes
02/2025 cerrado). Para operar, reabrilo desde …" · "Ejercicio N° 1 cerrado: refundición N° 51 y apertura N° 52.
Queda abierto el ejercicio N° 2." · Total Activo $ 12.831.000,00 al 31/12/2025 y al 31/01/2026 (= SQL) · Estado de
Resultados 2025 = $ 4.831.000,00 · "La anulación se registra con fecha de hoy (06/10/2026)." (23:4x AR) · "Asiento
N° 53 anulado con el asiento N° 55" · "Este asiento pertenece al egreso GTO-00002 y no se puede anular desde
Asientos: anulá el comprobante." · móvil `scrollWidth` 375.

**Calidad:** `check-types` = **219**; `eslint` de los `.tsx`/`.ts` tocados sin errores (1 warning previo en
`_CreateEntryModal`: `error` sin usar); `npm run test` = **64 archivos, 873 tests, verdes**. PDF revisado página por
página como imagen.

**Datos que quedaron en la DB de dev:** ninguno nuevo (la empresa del script se borra entera; verificado 0 filas y
empresa activa restaurada). Sigue la "TSK760 Demo cierre anual (no usar)" de la Fase 9 (no se usó ni se tocó).

**Desvíos y notas:**
- Se sembró una empresa propia en lugar de "Empresa de Prueba 01 SA" (el plan, §3.7.4): su nombre dice
  "Prueba" y el cierre anual es irreversible. Por eso tampoco hizo falta la base copia (`--copia`) ni `--restore`:
  todo, incluido el cierre anual, corre en una sola pasada contra dev y se borra. Las capturas `--prod` (11-12 del
  plan) quedan para la Fase 14.
- Abril a diciembre se cierran por SQL antes del cierre anual (el cierre de un mes ya se mostró en 01-08).
- El aviso "El balance no está equilibrado" (defecto previo de `getBalanceSheet.isBalanced`, Fase 9) no se
  captura: la 17 recorta las tablas de Activo, Pasivo y Patrimonio. La presentación lo explica en un recuadro
  ("detalle anterior, se corrige aparte"). **Pendiente decidir el ticket aparte.**
- La segunda pantalla del paso 07 va en otro contexto del navegador: como pestaña de la misma ventana dejaba la
  principal en segundo plano y Chrome congelaba sus animaciones (los toasts no terminaban de entrar).
- Presentación, sección 8 ("qué pasa el día del deploy"): los borradores en meses bloqueados se redactaron de
  forma genérica; el número concreto sale del diagnóstico de producción.

### Fase 14: Verificación final y notas de deploy
**Estado:** Completada (2026-10-07) — salvo el `completion_summary` del ticket, que espera el diagnóstico de
producción y el deploy.

**Calidad (rama completa, `git diff main...HEAD`):** `check-types` = **219** (= línea base); `eslint` de los 99
`.ts/.tsx` tocados: **1 error previo** (`UT/index.ts:146`, `require('next/cache')` de `revalidateAccountingRoutes`,
existe igual en `main`; el índice lo importan componentes cliente, no se toca) y 7 warnings previos; sin `console.` ni
`any` en líneas agregadas; `npm run test` = **64 archivos, 875 tests, verdes, 0 salteados** (28 archivos de
integración contra la DB corrieron); componentes nuevos < 200 (máx. `_AccountingClosingGuide` 169); grep de creación:
`journalEntry.create(` / `last_entry_number + 1` solo en `UT/journal-entry-tx.ts` (y la siembra local
`prisma/scripts/tsk760-escenarios-migracion.sql`); `NEXT_PUBLIC_APP_URL=http://localhost:3011 npm run build` OK.

**Corrección de la verificación** (commit `4041322`): `postJournalEntryTx` y `reverseJournalEntryTx` leían el estado
antes del lock; dos "Registrar" (o dos "Anular") simultáneos del mismo asiento terminaban en el trigger de
inmutabilidad con el mensaje genérico. Ahora el `UPDATE` va condicionado al estado y, si no toca filas, lanza el
`BusinessError` de siempre. +2 tests de concurrencia (rojos antes, verdes después).

**Prueba en modo producción** (build en :3011, Playwright; el script temporal se borró): ver §5.4. Ningún toast salió
redactado. `capturas-tsk760.mjs http://localhost:3011`: "Todos los chequeos pasaron"; regeneró 5 PNG que solo
difieren en fechas/números y se restauraron con `git checkout`.

**Datos de dev:** "Empresa de Prueba 01 SA" quedó como estaba (0 meses cerrados, `locked_until_date` NULL, contador
71, N° 51 POSTED, 52 y 54 DRAFT); la empresa temporal de la verificación y la del script de capturas, borradas;
empresa activa restaurada. Huella del diagnóstico `--local` después de todo: `fy 4de61e6e…`, `periodos 2f46e785…`,
`asientos 75d384df…`, `ajustes 3c857d9f…` (idéntica a la de la Fase 3: la verificación no dejó rastros).

**Diagnóstico `--local` final:** A true, B 2, C 0, D 2, E 0, F 0, G 1, H 1, I–O 0, P 1, Q 8, R–T 0. Consulta 2: los
52 asientos de dev con ejercicio y período. G/H/Q son la empresa "TSK760 Demo cierre anual (no usar)" de la Fase 9
(ejercicio 2025 cerrado; Ajustes ya apunta a 2026, por eso sus 8 asientos de 2025 cuentan como "antes del inicio").

#### Notas de deploy (texto para el PR)

1. **Diagnóstico de producción (solo lectura), antes de todo:** en el servidor,
   `bash prisma/scripts/diagnostico-tsk760.sh > diag-antes.txt` (corre por `sudo docker exec … psql` contra
   `contablemas-contablemas` y además imprime `date`/`TZ` del contenedor de la app).
2. **Decidir con el RESUMEN y la tabla "letra → suposición" de la Fase 3** (sección 4):
   - **No deployar** si A = false (el usuario de la base no es dueño de `journal_entries`: la migración falla entera,
     P3009), B ≠ 2 (triggers tocados) o C > 0 (migración fallida pendiente).
   - Revisar a mano antes de seguir si G > 0 (ya hubo un cierre anual con el código viejo: secciones 5, 9 y 12), F > 0
     con calendario irregular, E > 0 con rango de Ajustes inválido, P con aislados cerca del contador, Q con
     borradores recientes anteriores al inicio (corregir el inicio de Ajustes **antes**: después ya no se puede) o
     R > 0.
   - J, K, L > 0 = cambio de comportamiento visible: van al aviso a la clienta (paso 6).
   - Guardar la huella (consulta 14) de `diag-antes.txt`.
3. **Backup:** `sudo docker exec $(sudo docker ps -q --filter name=contablemas-contablemas) sh -c 'pg_dump -U
   "$POSTGRES_USER" -Fc "$POSTGRES_DB"' > contable-antes-tsk760.dump` y comprobar que pesa más de 0 bytes.
4. **Deploy.** La migración `20261007020224_tsk_760_fiscal_years_backfill` la aplica `docker-entrypoint.sh` al
   arrancar: transaccional (`BEGIN/COMMIT` propios) e idempotente; toma `ACCESS EXCLUSIVE` sobre `journal_entries`
   unos segundos. Sin permisos, módulos ni variables de entorno nuevas (`TZ` no hace falta).
5. **Verificar:**
   - `sudo docker exec $(sudo docker ps -q --filter name=contablemas-frontend) node node_modules/prisma/build/index.js
     migrate status` → "up to date". Si figura fallida (P3009): la base quedó como antes; corregir, `migrate resolve
     --rolled-back 20261007020224_tsk_760_fiscal_years_backfill` y redeployar (restaurar el backup solo si algo más
     falló).
   - `bash prisma/scripts/diagnostico-tsk760.sh > diag-despues.txt`. Esperado: E = 0 (salvo rango inválido,
     informado), K = 0, O = 0, B = 2; consulta 2 sin asientos sin ejercicio salvo los de la 13. La huella **cambia**
     respecto de `diag-antes.txt` (es lo que hace la migración).
   - Si la consulta 2 muestra asientos sin ejercicio creados por la réplica vieja durante el deploy, re-correr la
     migración por psql (es idempotente, probada dos veces seguidas en la copia):
     `sudo docker exec -i $(sudo docker ps -q --filter name=contablemas-contablemas) sh -c 'psql -U "$POSTGRES_USER"
     -d "$POSTGRES_DB" -v ON_ERROR_STOP=1' < prisma/migrations/20261007020224_tsk_760_fiscal_years_backfill/migration.sql`
     y volver a correr el diagnóstico: una tercera corrida no debe mover la huella.
6. **Avisar a la clienta** con `docs/presentaciones/TSK-760-cierre-contable.pdf` (sección 8 completada con los
   números reales de J, K, L y Q): meses que quedaron cerrados, borradores en esos meses, comprobantes en borrador
   que no se van a poder confirmar sin reabrir, y que el cierre de 2026 se hace cerrando los meses en orden.
7. **Antes del deploy, decidir la condición de §5.6** (redondeo de IVA de 1 centavo en facturas de varias líneas).

## 5. Verificación

**Fecha:** 2026-10-07 · **Verificador:** revisión independiente (Fase 14 / `/verificar`) sobre
`fix/tsk-760-cierre-contable` (fases 1–13 + `4041322`).

### 5.1 Revisión de código

Archivos críticos revisados completos: `UT/{period-lock,journal-entry-tx,journal-entry-lines,period-closure,utc-month,
closing-entries,fiscal-year-close-math,entry-document-link}.ts`, `SET/period-closing.ts`, `FYC/fiscal-year-close.ts`,
la migración, y los creadores de comerciales (`INT/commercial`), fondos y bancos.

| Riesgo | Resultado |
|---|---|
| **Orden de locks / deadlock** | Correcto. Toda operación que crea, registra, anula o cambia un período toma primero `accounting_settings` `FOR UPDATE` (`lockAccountingSettingsTx`, `period-lock.ts:85`): `assertPeriodOpen` (`:271`), `closeMonthTx`/`reopenMonthTx` vía `loadMonthsTx` (`period-closing.ts:85`), `closeFiscalYearTx` (`fiscal-year-close.ts:302`). Los creadores de documentos bloquean documento → Ajustes; el cierre de mes y el anual no tocan documentos, y las únicas filas que el cierre de mes actualiza (borradores, períodos) solo se tocan con el lock ya tomado. Las FK (`KEY SHARE` sobre FY/período al insertar asientos) no generan ciclo: quien las toma ya tiene el lock. No se encontró ciclo posible entre `closeMonth` y `createJournalEntry`. |
| Estado leído antes del lock | `postJournalEntryTx`/`reverseJournalEntryTx` leían el estado antes del lock: doble registro/anulación simultánea → choque con el trigger y mensaje genérico (no corrupción). **Corregido** (`4041322`). |
| Validación fuera de la tx | Ningún creador valida período fuera de la tx: el grep de `lockedUntilDate`/`assertPeriodOpen`/`isClosed` en `src/modules` solo encuentra el núcleo, el cierre y lecturas de UI/estado. |
| TSK-728 (documento CONFIRMED sin asiento) | Se mantiene: venta, compra, recibo, OP, egreso, fondos, bancos, baja de equipo y depreciación crean el asiento con la `tx` del documento y relanzan (`INT/commercial` `catch` → `throw error`); el `UPDATE` del documento va en la misma tx. Única excepción a propósito: bancos sin Ajustes (2.0). |
| **Redondeo de balance con `Decimal` (TSK-583/644)** | Repartos de centro de costo (`prorateAmount` + `round2`) y percepciones (importes de 2 decimales) cuadran exacto. **Hallazgo (condición, no corregido):** ver abajo, R-1. |
| Exclusión apertura/refundición (B18/B19) | Solo por vínculo de FY (`fiscal_years.opening_entry_id`/`closing_entry_id`), que escribe únicamente `closeFiscalYearTx` (`fiscal-year-close.ts:377,384`; grep). El "Asiento de Apertura" manual no se excluye de ningún reporte (la migración solo lo pasa al período OPENING; la exclusión no mira el período). |
| Migración | Idempotente (guardas en cada paso, probada dos veces en la copia y en dev), `BEGIN/COMMIT` propios, trigger deshabilitado solo alrededor del `UPDATE` del paso 4 y red de seguridad en el paso 8 (`RAISE EXCEPTION` si no quedó `O`). `INSERT` sin `id` válido: `fiscal_years.id`/`accounting_periods.id` tienen `DEFAULT gen_random_uuid()` en la DB. Datos raros que mide el diagnóstico: rango de Ajustes inválido (sin FY + NOTICE), FY con dos OPENING/CLOSING (no pisa la clave única, NOTICE), asientos fuera de tope (NULL + NOTICE), fin de FY a las 02:59:59.999. Única causa de fallo previsible: A = false o trigger inexistente (B ≠ 2), ambos en el diagnóstico. |
| Numeración | Solo `nextEntryNumberTx`; concurrencia cubierta por test (10 en paralelo, y fondos/bancos/recurrentes en paralelo). |

**R-1 (condición) — 1 centavo de redondeo de IVA en facturas de varias líneas.** El total de la factura se calcula con
el IVA **agregado** (`Σ subtotal × alícuota`, redondeado una vez; `sales/.../invoices/list/actions.server.ts:546-549`
y `:783`; compras igual, `purchases/.../actions.server.ts:941-962`, redondeo por la DB), pero el asiento suma el IVA
**línea por línea** ya redondeado (`INT/commercial/index.ts:345` y `:530`). Con dos o más líneas la diferencia de
±0,01 es frecuente (simulación: ~25 % de las facturas de dos líneas al 21 %; ej. dos líneas de $1,07 → total 2,59,
asiento 2,58). En `main`, `validateBalance` aceptaba `|d − h| > 0,01` en coma flotante, así que la mitad de esos casos
pasaba por azar (`2,59 − 2,58 = 0,00999…`) y la otra mitad ya fallaba; con `validateEntryLines` (`Decimal`, rechaza
`≥ 0,01`, C5) **fallan todos**: "El asiento no está balanceado. … Diferencia: $0.01" al confirmar. Es un defecto previo
de cálculo (no de este ticket) que la rama vuelve determinista: hay facturas que hoy se confirman y después del deploy
no. No se corrigió porque toca el armado de líneas de comerciales (TSK-721/644) y es una decisión contable: (a) en
`INT/commercial`, imputar la diferencia de redondeo (≤ 0,005 × líneas) a la línea de IVA de mayor importe; o (b)
calcular el IVA del comprobante como suma de los IVA de línea redondeados (cambia el total, afecta AFIP); o (c)
aceptar `≤ 0,01` exacto en `validateEntryLines` (deja asientos POSTED desbalanceados por un centavo, contra B21).
Recomendado: (a), con test, antes del deploy.

Observaciones menores (no bloquean): una confirmación de documento (timeout por defecto de Prisma, 5 s) que llega
mientras corre un "Registrar N borradores y cerrar" largo (hasta 30 s) puede vencer esperando el lock y mostrar el
mensaje genérico; `confirmFundMovement` sigue mirando el estado DRAFT fuera de la tx (previo, doble confirmación
concurrente); `saveFiscalYearSettingsTx` hace `upsert` antes del lock (dos primeras configuraciones simultáneas →
P2002). Todo previo o de baja probabilidad; anotado para 758.

### 5.2 Build / Lint

| Chequeo | Resultado |
|---|---|
| `npm run check-types` | 219 errores `TS` (= línea base, ninguno nuevo) |
| `eslint` de los 99 `.ts/.tsx` del diff | 1 error **previo** (`UT/index.ts:146`, `require()` también en `main:138`), 7 warnings previos |
| `console.` / `: any` / `as any` en líneas agregadas | 0 |
| Componentes nuevos | todos < 200 (máx. 169) |
| Grep de creación de asientos | solo `UT/journal-entry-tx.ts` |
| `NEXT_PUBLIC_APP_URL=http://localhost:3011 npm run build` | OK |

### 5.3 Tests

`npm run test`: **64 archivos, 875 tests, todos verdes, 0 salteados** (incluye 28 archivos `*.integration.test.ts`
contra `contable-pms-db`; línea base del ticket 48/601). Criterios de aceptación:

| # | Criterio | Evidencia |
|---|---|---|
| 1 | Cerrar meses en orden y luego el cierre anual, sin error | `SET/period-lock.integration.test.ts` (orden, fuera de orden), `FYC/fiscal-year-close.integration.test.ts` (cierre feliz, B18–B21, B24, segundo cierre); capturas 01–16 en modo producción |
| 2 | Empresas sin FY lo tienen tras la migración | migración probada en la copia (escenarios a–j, `tsk760-escenarios-verificar.sql` OK) y en dev; diagnóstico E = 0 |
| 3 | Ningún creador acepta período cerrado (error legible), todos con FY/período y número atómico | un test por creador: `entries`, 6 de comprobantes/equipos, `depreciation-period-lock`, `fund-movement-lines`, `bank-movement-period-lock`, `recurring-entries`, `opening-balances`, `generators-period-lock`; `journal-entry-tx` (concurrencia de numeración); grep de creación; toasts reales en §5.4 |
| 4 | No se registra un DRAFT en FY cerrado y el cierre anual informa los DRAFT | `entries` y `journal-entry-tx` (B4); `fiscal-year-close` (texto de borradores); captura 12 |
| 5 | Desbloquear nunca reabre un FY cerrado | `period-lock` (B5: piso, texto "pertenece al ejercicio N° 1"); captura 19 |
| 6 | Reversión copia auxiliares y moneda, valida ambas fechas, no anula asientos de documentos | `reverse-entry.integration.test.ts`, `journal-entry-tx` (copia completa, mes del original, mes de hoy, doble anulación); §5.4 |
| 7 | Tests de integración por creador y del helper | ver fila 3 + `period-lock.integration`, `journal-entry-tx.integration` |

### 5.4 Verificación funcional (build de producción en :3011)

Login con el usuario de dev; "Empresa de Prueba 01 SA" (octubre y enero cerrados por SQL solo durante la prueba) y una
empresa temporal sembrada y borrada al final. Textos **exactos** de los toasts (ninguno redactado):

| Caso | Toast / texto |
|---|---|
| Asiento manual en mes cerrado (05/10/2026) | "No se puede registrar con fecha 05/10/2026: el período está cerrado (mes 10/2026 cerrado). Para operar, reabrilo desde Contabilidad → Configuración → Bloqueo de Períodos." |
| Registrar borrador en mes cerrado (N° 54) | "No se puede registrar con fecha 07/10/2026: el período está cerrado (mes 10/2026 cerrado). Para operar, reabrilo desde Contabilidad → Configuración → Bloqueo de Períodos." |
| Cerrar fuera de orden (pantalla desactualizada) | "Solo se puede cerrar el primer mes abierto: 02/2026." (y en el script de capturas: "… 04/2025.") |
| "Registrar los N borradores y cerrar" con uno inválido (capturas) | "No se cerró 03/2025: el borrador N° 12 no se puede registrar. La cuenta 1.1.1/00/00 no es imputable (tiene subcuentas). Si es un asiento manual que ya no sirve, podés eliminarlo desde Asientos." |
| Anular el asiento de un comprobante (N° 51) | diálogo: "Este asiento pertenece a la factura de compra 0001-97244388 y no se puede anular desde Asientos: anulá el comprobante." con "Anular" deshabilitado |
| Eliminar un borrador vinculado (N° 52) | "Este asiento pertenece al egreso GTO-00001 y no se puede eliminar: solo se eliminan borradores manuales." |
| Guardar fechas de ejercicio con asientos | "No se pueden cambiar las fechas del ejercicio N° 1: la empresa ya tiene asientos o meses cerrados. Las fechas cambian solas al cerrar el ejercicio." |
| Saldos de apertura: crear + **editar 3 veces** (lo de la Fase 7) | "Asiento de apertura N° 1 creado" · "N° 3 actualizado" · "N° 5 actualizado" · "N° 7 actualizado" (DB: 1, 3, 5 REVERSED; 2, 4, 6 reversiones; 7 vigente). 3/3 sin mensaje genérico |
| Egreso en mes cerrado (capturas) | "No se puede registrar con fecha 20/02/2025: el período está cerrado (mes 02/2025 cerrado). …" |
| Cierre anual (capturas) | "Ejercicio N° 1 cerrado: refundición N° 51 y apertura N° 52. Queda abierto el ejercicio N° 2." |

`capturas-tsk760.mjs http://localhost:3011`: todos los chequeos de pantalla y de base pasaron (incluidos Balance al
31/01/2026 sin duplicar y Estado de Resultados 2025 ≠ 0 en el build de producción, la duda de la Fase 9). Estado de
"Empresa de Prueba 01 SA" al empezar y al terminar: 0 meses cerrados, `locked_until_date` NULL, contador 71. :3011
detenido por PID; :3010 responde 200.

### 5.5 Cumplimiento de reglas

| Regla | Estado |
|---|---|
| `checkPermission` en actions / `PermissionGuard` / `usePermissions` | ✓ (sin permisos nuevos, D10) |
| `ActionResult` + `BusinessError` en actions con motivo para el usuario | ✓ (verificado en build de producción) |
| moment.js (sin date-fns), `logger` (sin `console`), sin `any` | ✓ |
| `AlertDialog` (sin `confirm()`) | ✓ |
| React Query (fuera el `useEffect` de `_ClosePreviewDialog`) | ✓ |
| Server Components por defecto, `_` en client, componentes < 200 | ✓ nuevos; los ya excedidos no crecieron (`_EntriesTable` bajó a 302) |
| `Decimal` → `Number()` hacia el cliente | ✓ |
| Tests (Vitest, no Cypress) | ✓ |
| `docs/`, guía in-app, presentación al cliente | ✓ (Fase 13); la sección 8 del PDF espera los números del diagnóstico de prod |

### 5.6 Resultado final

**Estado:** APROBADO CON CONDICIONES

La rama cumple los 7 criterios de aceptación, la calidad está en verde y los mensajes llegan legibles en producción.
Se corrigió un defecto chico de concurrencia (`4041322`). Queda una regresión acotada (R-1) y el paso obligatorio de
producción.

**Acciones pendientes:**
1. **R-1:** decidir y, si se elige la opción (a), corregir el redondeo de IVA de 1 centavo en el asiento de facturas
   de venta/compra de varias líneas **antes del deploy** (hoy confirman ~la mitad de esos casos; con la rama, ninguno).
2. Correr `prisma/scripts/diagnostico-tsk760.sh` en producción y decidir con la tabla "letra → suposición" (§4,
   Fase 3) antes de deployar; seguir las notas de deploy de §4, Fase 14.
3. Completar la sección 8 de la presentación con los números reales (J, K, L, Q) y avisar a la clienta.
4. Después del deploy: `completion_summary` del ticket (memoria `cc-tickets-resueltos-sin-comentarios`).
5. Tickets aparte ya anotados: `getBalanceSheet.isBalanced` (Fase 9), saldo de origen leído fuera de la tx en
   `createBankTransfer` (Fase 6), merge con PR #34 (TSK-757, conflicto previsto en `createJournalEntryForExpense`).
