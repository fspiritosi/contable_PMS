# TSK-758 — Modificar comprobantes mientras el período contable esté abierto

**Fecha de inicio:** 2026-10-06
**Estado:** Análisis completado

---

## 1. Análisis

### 1.1 Problema

Pedido textual del ticket 758 ("Modificaciones en Sistema"): **"Todo es modificable salvo que ya esté
cerrado el período contable al que fue aplicado"**.

Hoy el sistema hace casi lo contrario:

- **Nada confirmado se puede editar.** Facturas de venta y de compra, órdenes de pago, gastos y
  movimientos de fondos solo se editan en `DRAFT`. Los recibos no se pueden editar nunca. Los
  asientos manuales no se pueden editar ni borrar, tampoco en `DRAFT`.
- **Las anulaciones que existen dejan la contabilidad desfasada.** `cancelInvoice`,
  `cancelPurchaseInvoice` y `cancelExpense` marcan el comprobante `CANCELLED` pero **dejan vivo
  el asiento**. `deleteBankMovement`, `deleteCashMovement`, `voidCheck` y `reactivateVehicle`
  deshacen efectos sin tocar el asiento, que queda huérfano.
- **"Período cerrado" no tiene una definición única.** Conviven dos mecanismos de cierre que no
  se hablan, cada integración chequea una cosa distinta y hay creadores de asientos que no
  chequean nada (ver 1.2.1 y 1.2.2). Por eso no se puede implementar "modificable salvo período
  cerrado" sin antes definir y centralizar qué es un período cerrado.

El ticket, entonces, tiene dos partes:

1. Una **base** que hoy no existe: una única verificación de período abierto, una forma
   transaccional de revertir o regenerar el asiento de un documento, y la corrección de los bugs
   de cierre.
2. **Modificación por documento** (editar en sitio o anular y rehacer), con reglas de bloqueo
   propias de cada uno: período cerrado, CAE, pagos aplicados, conciliación.

Se le preguntaron cuatro cosas a la clienta en el ticket y siguen sin respuesta: cierre mensual o
bloqueo hasta una fecha, facturas con CAE (¿solo NC?), comprobantes con pagos aplicados, y fecha
del contra-asiento. Las alternativas y la recomendación de cada una están en 1.8.

### 1.2 Contexto actual

#### 1.2.1 Dos mecanismos de cierre que no se hablan

**A. Cierre anual (`FiscalYear` + `AccountingPeriod`)**

- `closeFiscalYear` (`src/modules/accounting/features/fiscal-year-close/actions.server.ts:243`):
  - Exige que **todos** los `AccountingPeriod` `MONTHLY` del ejercicio tengan `isClosed=true`
    (`:279-297`).
  - Crea la refundición en estado POSTED (`:327-352`) y marca `FiscalYear.isClosed=true`
    (`:356-365`).
  - Fija `lockedUntilDate` igual al fin del ejercicio (`:367-371`).
  - Crea el ejercicio siguiente con OPENING + 12 MONTHLY + CLOSING (`:375-423`) y el asiento de
    apertura POSTED (`:428-468`).
  - Corre `settings.fiscalYearStart/End` al ejercicio nuevo (`:471-477`).
- Los `FiscalYear` y sus períodos los creó **solo la migración de datos**
  `prisma/migrations/20260625100000_fiscal_years_periods_and_auxiliaries/migration.sql:146-195`,
  y solo para las empresas que tenían `accounting_settings` en ese momento. En esa misma
  migración, `is_closed` de los meses MONTHLY se calculó a partir del `locked_until_date` de
  entonces (`:177-182`).
- **Ningún código pone `AccountingPeriod.isClosed=true`.** Sobre `accountingPeriod` solo hay
  `create` y `createMany` (`fiscal-year-close/actions.server.ts:314`, `:423`). No hay UI de
  "cerrar mes".
- Las empresas creadas después de esa migración **no tienen `FiscalYear`**: en la app no existe
  otro `fiscalYear.create` que el de `closeFiscalYear`.

**B. Bloqueo hasta una fecha (`AccountingSettings.lockedUntilDate`)**

- Campo en `prisma/schema.prisma:525-526`.
- `getLockedPeriod` y `setLockedPeriod` en `src/modules/accounting/features/settings/actions.server.ts:113`
  y `:146`. `setLockedPeriod` exige que la fecha sea fin de mes y caiga dentro del ejercicio de
  settings (`:162-175`). **No toca `AccountingPeriod`.**
- UI en `src/modules/accounting/features/settings/components/_PeriodLockingForm.tsx:59-108`:
  - Muestra una grilla de meses del ejercicio actual.
  - Solo son clickeables el primer mes desbloqueado (para bloquearlo) y el último bloqueado (para
    desbloquearlo).
  - Desbloquear el **primer** mes manda `null` (`:92-96`).
- Documentado en `docs/modules/accounting.md:221-240` y en la guía in-app
  `src/modules/help/features/guide/components/_AccountingGuide.tsx:695-740`.

#### 1.2.2 Quién chequea qué (verificado)

| Creador de asiento / acción | Archivo:línea | Verificación de período | `fiscalYearId`/`periodId` | Estado en que nace el asiento |
|---|---|---|---|---|
| Asiento manual `createJournalEntry` | `entries/actions.server.ts:16` (`:24`) | `validateJournalEntryDate`: `FiscalYear.isClosed` y luego `validatePeriodLock` | sí | DRAFT |
| `postJournalEntry` | `entries/actions.server.ts:112` (`:157`) | solo `validatePeriodLock` (**no** mira `FiscalYear.isClosed`) | — | → POSTED |
| `reverseJournalEntry` | `entries/actions.server.ts:212` (`:253`) | `validatePeriodLock` de la fecha **original**; la fecha de la reversión (hoy) no se valida | sí (hoy) | POSTED |
| Integración comercial: venta, compra, recibo, OP, gasto | `integrations/commercial/index.ts:198` (`:207-221`) | solo `lockedUntilDate`, con `BusinessError` | sí | DRAFT |
| Integración de equipos: baja y venta de equipo | `integrations/equipment/index.ts:64` (`:86-103`) | solo `lockedUntilDate`, con `BusinessError` | sí | DRAFT |
| Integración de tesorería (código muerto, sin callers) | `integrations/treasury/index.ts:41` (`:56-64`) | `lockedUntilDate`; **devuelve `null`** y sigue sin asiento | sí | DRAFT |
| Depreciación `postDepreciationEntry` / `postAllPendingDepreciations` / revalúo | `equipment/features/depreciation/actions.server.ts:842-843`, `:884-893`, `:1057-1058` | solo `lockedUntilDate` | sí | DRAFT (`:712`, `:1111`) |
| Movimientos de fondos `createJournalEntryForFundMovement` | `treasury/features/fund-movements/list/actions.server.ts:447` | **ninguna**; numeración `lastEntryNumber+1` no atómica (`:485-525`) | **no** | DRAFT |
| Movimientos bancarios manuales y transferencias | `treasury/features/bank-movements/actions.server.ts:162` (`:180-246`), `:1117`, `:1232` | **ninguna**; numeración no atómica | **no** | DRAFT |
| Liquidación de IVA | `vat-settlement/actions.server.ts:210-217` | **ninguna** | sí | POSTED |
| Diferencia de cambio | `exchange-rates/actions.server.ts:348-355` | **ninguna** | **no** | POSTED |
| Asientos recurrentes | `recurring-entries/actions.server.ts:212-219` | **ninguna**; numeración no atómica (`:209`, `:235`) | **no** | DRAFT |
| Saldos de apertura | `opening-balances/actions.server.ts:456-462` | **ninguna** | **no** | POSTED |
| Ajuste por inflación | `inflation-adjustment/actions.server.ts:353-360` | **ninguna** | sí | POSTED |
| Cierre / apertura de ejercicio | `fiscal-year-close/actions.server.ts:327`, `:442` | propia | sí | POSTED |

Todos los paths son relativos a `src/modules/accounting/features/`, salvo los de
`equipment/…` (bajo `src/modules/`) y `treasury/…` (bajo `src/modules/commercial/features/`).

`validatePeriodLock` (`src/modules/accounting/features/entries/validators/index.ts:126-170`) mira
primero si existe el `AccountingPeriod` MONTHLY del mes. Si existe, decide **solo** por su
`isClosed` y retorna (`:134-151`). El fallback a `lockedUntilDate` (`:154-169`) corre únicamente
cuando el período no existe. Como nadie cierra períodos, **en las empresas que tienen
`FiscalYear`, el bloqueo de la UI no frena asientos manuales ni el "Registrar" de un DRAFT**.

#### 1.2.3 Estado de los asientos automáticos: casi todos nacen en DRAFT

- `JournalEntry.status` tiene `@default(DRAFT)` (`prisma/schema.prisma:395`). Ningún helper de
  integración setea `status`, así que **todos los asientos de documentos nacen DRAFT**: ventas,
  compras, recibos, OP, gastos, fondos, bancos, equipos y depreciación.
- El pase a POSTED es **solo manual y de a uno**: "Registrar" en
  `src/modules/accounting/features/entries/components/_EntriesTable.tsx:272` →
  `_PostEntryDialog.tsx:32` → `postJournalEntry`. No existe registro masivo; el único
  "post all" (`postAllPendingDepreciations`) también deja DRAFT.
- Los reportes oficiales filtran POSTED:
  - Libro Diario (`reports/actions.server.ts:199`), Mayor (`:261`, `:275`), Estado de Resultados
    (`:535`) y Presupuesto vs. real (`:1208`).
  - Sumas y Saldos y Balance, vía `src/modules/accounting/shared/utils/balances.ts:20`, `:78`,
    `:92`.
  - Liquidación de IVA (`vat-settlement/actions.server.ts:65`, `:77`).
  - Preview del cierre de ejercicio (`fiscal-year-close/actions.server.ts:148`, `:205`).
  - Solo `getCostCenterMovements` (`:1589`) incluye DRAFT, como opción.
- Triggers de inmutabilidad (`prisma/migrations/20260624100000_accounting_constraints/migration.sql:49-102`):
  - POSTED solo puede pasar a REVERSED. REVERSED no se toca.
  - Las líneas de un asiento POSTED o REVERSED no admiten UPDATE ni DELETE.
  - **DRAFT admite cualquier cambio, incluso DELETE.**

**Consecuencia clave para el diseño:** mientras el asiento de un documento siga DRAFT, "modificar"
puede ser **regenerar** el asiento (borrarlo y volver a crearlo con los datos nuevos) sin dejar
rastro contable. Solo hace falta un contra-asiento cuando el asiento ya está POSTED. Así se
respeta el principio contable (lo registrado no se toca, se revierte) y se evita llenar el
diario de pares asiento/contra-asiento por cada corrección.

#### 1.2.4 `reverseJournalEntry` no sirve tal cual para documentos

- Es un Server Action con `checkPermission('accounting.entries','approve')` y su propio
  `prisma.$transaction` (`entries/actions.server.ts:212-340`). No se puede llamar dentro de la
  transacción de un documento.
- Exige POSTED (`:255`). La reversión se fecha **hoy** (`:260`, `:273`), sin validar que hoy
  caiga en un período abierto.
- Al copiar las líneas no copia `costCenterId`, `customerId`, `supplierId`, `currency`,
  `originalAmount` ni `exchangeRate` (`:281-287`). La reversión rompe así los mayores
  auxiliares de cliente, proveedor y centro de costo (TSK-719).
- No verifica si el asiento pertenece a un documento. Desde la UI de asientos (`_EntriesTable.tsx:278`)
  se puede anular el asiento de una factura y la factura sigue `CONFIRMED`, apuntando a un
  asiento REVERSED.
- Lanza `Error`, no `ActionResult`: en producción el mensaje llega redactado (memoria
  `errores-negocio-server-actions`).

#### 1.2.5 Estado actual por documento

| Documento | Editar | Anular / borrar | Asiento al anular | Otros efectos al anular |
|---|---|---|---|---|
| **Factura de venta** | `updateInvoice` solo DRAFT (`sales/.../invoices/list/actions.server.ts:1262`, `:1276`); lanza `Error` | `cancelInvoice` (`:1393`): cualquier estado salvo CANCELLED (`:1404`), **incluso PAID o con CAE**; lanza `Error` | **No lo revierte** | Devuelve stock con ADJUSTMENT (`:1420-1478`). **Bug:** en una NC también *suma* stock (debería restar). No toca `ReceiptItem`, `SalesCreditNoteApplication`, `CashMovement`, remitos ni proyecciones |
| **Factura de compra** | `updatePurchaseInvoice` solo DRAFT (`purchases/.../invoices/list/actions.server.ts:1066`, `:1096`) | `cancelPurchaseInvoice` (`:1660`): bloquea CANCELLED, PAID y PARTIAL_PAID (`:1688`, `:1692`) | **No lo revierte** | Revierte stock solo si es NC (`:1715-1763`) y descuenta `invoicedQty` de la OC (`:1767-1779`). No toca remitos de recepción ni `PurchaseCreditNoteApplication` |
| **Recibo** | No existe | Solo `deleteReceipt` en DRAFT (`treasury/features/receipts/actions.server.ts:806`, `:820`) | — | Al confirmar (`:242`) mueve la factura a PAID/PARTIAL (`:310-314`), crea `CashMovement` sin FK (`:325-337`), `BankMovement` con `receiptId` y `reconciled=true` (`:368-389`), cheques en PORTFOLIO (`:398-402`) y retenciones |
| **Orden de pago** | `updatePaymentOrder` solo DRAFT (`payment-orders/actions.server.ts:1161`, `:1179`) | Solo `deletePaymentOrder` en DRAFT (`:1111`) | — | Al confirmar (`:448`): facturas y gastos a PAID (`:519-538`), caja (`:568`), banco reconciliado (`:599-620`), cheques de terceros ENDORSED (`:631-640`), cheques propios DELIVERED (`:651-655`), cuotas de tarjeta y proyecciones (`~:715-740`), cuotas de socio (`:752`) |
| **Gasto** | `updateExpense` solo DRAFT (`expenses/actions.server.ts:446`) | `cancelExpense` (`:624`): DRAFT o CONFIRMED sin OP confirmadas (`:637-652`) | **No lo revierte** y no mira el período | Solo cambia el status (`:657`) |
| **Movimiento de fondos** | `updateFundMovement` solo DRAFT (`fund-movements/list/actions.server.ts:683`, `:698`) | `deleteFundMovement` solo DRAFT (`:952`); no hay anulación | — | Al confirmar (`:754`) crea `BankMovement`/`CashMovement` sin FK al movimiento (`:369-409`) |
| **Movimiento bancario manual / transferencia** | No existe | `deleteBankMovement` (`bank-movements/actions.server.ts:648`): bloquea si `reconciled` (`:683`) o si está vinculado a recibo u OP (`:687`) | **Asiento huérfano**: `BankMovement` no tiene `journalEntryId` (`schema.prisma:3243-3281`) | Revierte el saldo (`:694-709`). **Bug:** `'CHECK'` figura en las dos listas (`:697`, `:701`). Se puede borrar el movimiento de un FundMovement confirmado |
| **Movimiento de caja** | No existe | `deleteCashMovement` (`treasury/features/movements/actions.server.ts:199`), con sesión OPEN | Sin asiento propio | No chequea vínculos: se puede borrar la caja de un recibo, OP o FundMovement confirmado |
| **Cheques** | `updateCheck` solo PORTFOLIO, metadata (`checks/actions.server.ts:238`) | `voidCheck` (`:490`) y `deleteCheck` (`:537`) no miran si el cheque es de un recibo u OP | Sin asiento | `rejectCheck` (`:402-421`) y `voidCheck` en DEPOSITED (`:510-514`) borran el `BankMovement` **sin restaurar el saldo** |
| **Asiento manual** | No existe (ni en DRAFT) | Solo `reverseJournalEntry` sobre POSTED | Contra-asiento con fecha de hoy | — |
| **Depreciación / revalúo** | No | No hay desposteo; `deleteVehicleDepreciation` rechaza si ya hay períodos contabilizados (`depreciation/actions.server.ts:649`) | — | — |
| **Baja de equipo** | — | `reactivateVehicle` (`equipment/features/list/actions.server.ts:425`) solo pone `isActive=true` | **No revierte** el asiento de baja | No reactiva la depreciación |
| **Liquidación IVA, diferencia de cambio, ajuste por inflación** | No | No | Nacen POSTED: solo con `reverseJournalEntry` | — |

#### 1.2.6 CAE (ARCA/AFIP)

- `SalesInvoice.cae` y `caeExpiryDate` (`prisma/schema.prisma:2845-2846`). Se obtienen con
  `requestCAE` (`src/modules/commercial/features/arca/actions.server.ts:32`):
  - exige CONFIRMED y que la factura no tenga CAE (`:91-93`);
  - registra un `ArcaRequest` (`:226`, `:292`; modelo en `schema.prisma:4578`) y setea el CAE
    (`:251-261`);
  - en una NC arma `CbtesAsoc` con la factura original (`:188-191`).
- **`requestCAE` no tiene ningún botón en la UI**: solo se exporta en `arca/index.ts:1`. En la
  práctica hoy ninguna factura del sistema obtiene CAE desde la app. La regla igual tiene que
  existir para cuando se habilite.
- `PurchaseInvoice.cae` (`schema.prisma:2977`) es el CAE **del proveedor**. Se carga a mano
  (`EditPurchaseInvoice.tsx:59`) y es solo informativo: no bloquea nada fiscalmente de nuestro
  lado.
- Fiscalmente, un comprobante electrónico autorizado no se modifica ni se anula: se corrige con
  NC o ND. Las NC y ND ya existen (`voucherType`, `originalInvoiceId`, `schema.prisma:2881`,
  `:2892`) y se crean desde el formulario general (`_InvoiceForm.tsx:1019`). No hay una acción
  "generar NC desde esta factura".

#### 1.2.7 UI actual de modificación

- **Ventas.** En el listado, Editar solo en DRAFT y "Anular" en cualquier estado salvo CANCELLED
  (`sales/.../list/columns.tsx:166-188`). El handler `_InvoicesTable.tsx:78` llama a
  `cancelInvoice` sin leer el resultado. El detalle (`InvoiceDetail.tsx:65-68`) no tiene Anular.
  `EditInvoice.tsx:31` bloquea si no es DRAFT.
- **Compras.** En el listado, `canCancel` solo en DRAFT o CONFIRMED (`purchases/.../list/columns.tsx:147-150`).
  El detalle no tiene Editar ni Anular.

### 1.3 Archivos involucrados

**Base (período y reversión)**

- `src/modules/accounting/features/entries/validators/index.ts`: `validatePeriodLock` y
  `validateJournalEntryDate`, a reemplazar o delegar en el helper único.
- `src/modules/accounting/features/entries/actions.server.ts`: create, post y reverse; extraer
  `reverseJournalEntryTx`.
- `src/modules/accounting/features/settings/actions.server.ts` y
  `components/_PeriodLockingForm.tsx`: el bloqueo por fecha.
- `src/modules/accounting/features/fiscal-year-close/actions.server.ts`: cierre anual.
- `src/modules/accounting/shared/utils/fiscal-year.ts`: el helper nuevo puede vivir acá o en
  `accounting/shared/utils/period-lock.ts`.
- `src/shared/lib/action-result.ts`: `BusinessError` y `ActionResult`.
- Integraciones que pasan a usar el helper único:
  - `src/modules/accounting/features/integrations/commercial/index.ts`
  - `src/modules/accounting/features/integrations/equipment/index.ts`
  - `src/modules/accounting/features/integrations/treasury/index.ts`
- Otros creadores de asientos que también pasan a usarlo: `vat-settlement`, `exchange-rates`,
  `recurring-entries`, `opening-balances` e `inflation-adjustment` (bajo
  `src/modules/accounting/features/`), y `src/modules/equipment/features/depreciation/actions.server.ts`.

**Documentos**

- Ventas: `src/modules/commercial/features/sales/features/invoices/{list,detail,edit}/`.
- Compras: `src/modules/commercial/features/purchases/features/invoices/{list,detail,edit}/`.
- Recibos: `src/modules/commercial/features/treasury/features/receipts/`.
- Órdenes de pago: `src/modules/commercial/features/treasury/features/payment-orders/`.
- Gastos: `src/modules/commercial/features/expenses/`.
- Movimientos de fondos: `src/modules/commercial/features/treasury/features/fund-movements/`.
- Bancos, caja y cheques: `src/modules/commercial/features/treasury/features/{bank-movements,movements,checks}/`.
- Equipos: `src/modules/equipment/features/list/actions.server.ts` (`softDeleteVehicle`,
  `reactivateVehicle`).
- Asientos manuales (UI): `src/modules/accounting/features/entries/components/_EntriesTable.tsx`.
- ARCA: `src/modules/commercial/features/arca/actions.server.ts`.

**Esquema**

- `prisma/schema.prisma`: `BankMovement.journalEntryId` (nuevo), un vínculo de
  `FundMovement.journalEntryId` como FK real y, posiblemente, el origen del asiento en
  `JournalEntry` (ver 1.7.1).

**Documentación y tests**

- `docs/modules/accounting.md` (§ Bloqueo de Períodos), `docs/modules/commercial.md` y
  `docs/architecture/data-model.md`.
- La guía in-app: `_AccountingGuide.tsx` y las guías comerciales y de tesorería en
  `src/modules/help/features/guide/components/`.
- Tests de integración Vitest (`*.integration.test.ts`). Los existentes ya ejercitan
  `lockedUntilDate`: `receipt-journal-entry.integration.test.ts:522`,
  `payment-order-journal-entry.integration.test.ts:620`,
  `expense-journal-entry.integration.test.ts:295`,
  `sales-invoice-line-accounts.integration.test.ts:396` y
  `purchase-invoice-line-accounts.integration.test.ts:377`.

### 1.4 Dependencias

- **Respuestas de la clienta (1.8).** Condicionan las reglas de CAE y de pagos aplicados y la
  fecha del contra-asiento. La base (fase 0 y fase 1) no depende de ellas.
- **Patrón `ActionResult`/`BusinessError`** (TSK-481/721/728). Toda acción nueva de
  modificación o anulación tiene que usarlo, porque "período cerrado" es justamente el mensaje
  que el usuario necesita leer en producción.
- **TSK-719** (movimientos por centro de costo): la reversión tiene que copiar los auxiliares, o
  rompe ese reporte.
- **TSK-721 / TSK-728:** la prevalidación de cuentas antes de la transacción se reutiliza al
  regenerar asientos.
- **Inmutabilidad en la DB** (triggers de 1.2.3): define qué se puede borrar (DRAFT) y qué
  requiere reversión (POSTED).
- **Permisos** (`src/shared/lib/permissions/constants.ts`): editar un documento confirmado y
  anularlo probablemente merezcan una acción distinta de `update` (por ejemplo `approve`, o un
  permiso nuevo `modify-confirmed`). A definir en el diseño.

### 1.5 Restricciones y reglas

- **Lo POSTED no se modifica**: se revierte con un contra-asiento. Lo impone el trigger de la DB.
- **Período cerrado = inmodificable**, sin excepciones desde la UI de documentos. Para corregir
  un período cerrado, la vía es reabrirlo (lo hace el contador) o registrar un ajuste en el
  período abierto.
- **El contra-asiento debe caer en un período abierto.** Si la fecha elegida (la del original o
  la de hoy) está cerrada, se rechaza con `BusinessError`.
- **Facturas de venta con CAE:** no se editan ni se anulan; se corrigen con NC o ND (normativa
  ARCA, RG 4291 y concordantes). Igual en ND y NC con CAE.
- **Atomicidad:** documento, efectos colaterales (stock, saldos, cheques, aplicaciones) y asiento
  en **una sola transacción**. Nada de `try/catch` que trague errores (lección de TSK-728).
- **Numeración de asientos:** siempre `UPDATE … RETURNING` atómico. No `lastEntryNumber+1`.
- **Errores de negocio** como `ActionResult`, verificados con `npm run build && npm run start`
  (memoria `errores-negocio-server-actions`).
- Reglas del repo: `checkPermission` en cada action, `PermissionGuard`/`usePermissions`,
  `AlertDialog` (nunca `confirm()`), `moment`, `logger`, `Decimal`→`Number()`, componentes de
  menos de 200 líneas, guía in-app y `docs/` actualizados, tests Vitest de integración.
- Al anular se mantiene la **trazabilidad**: el documento anulado conserva el vínculo a su
  asiento original y gana un vínculo a la reversión. No se borra nada POSTED.

### 1.6 Riesgos identificados

**Fase 0: bugs encontrados (corregir antes o como primera fase)**

| # | Bug | Evidencia | Impacto |
|---|---|---|---|
| B1 | Nadie pone `AccountingPeriod.isClosed=true` → `closeFiscalYear` **falla siempre** con "Debe cerrar todos los períodos mensuales…" en las empresas con `FiscalYear` cuyos meses no se cerraron en la migración | `fiscal-year-close/actions.server.ts:279-297`; no hay ningún `accountingPeriod.update` | El cierre anual es inusable |
| B2 | Las empresas creadas después de la migración 20260625 no tienen `FiscalYear` → `closeFiscalYear` falla con "No se encontró el ejercicio fiscal" | `:262-272`; único `fiscalYear.create` en `:380` | Ídem para empresas nuevas |
| B3 | `validatePeriodLock` ignora `lockedUntilDate` si existe el `AccountingPeriod` del mes | `validators/index.ts:134-151` | El bloqueo de la UI **no frena** asientos manuales ni el "Registrar" en las empresas con `FiscalYear` |
| B4 | `postJournalEntry` no valida `FiscalYear.isClosed`, y el cierre anual solo suma POSTED, sin advertir de DRAFTs pendientes | `entries/actions.server.ts:157`; `fiscal-year-close/actions.server.ts:148`, `:205` | Se puede registrar un DRAFT dentro de un ejercicio ya cerrado y alterar balances cerrados; la refundición no lo contempló |
| B5 | Desbloquear el primer mes del ejercicio nuevo pone `lockedUntilDate=null`, que también desbloquea el ejercicio cerrado | `_PeriodLockingForm.tsx:92-96`; `fiscal-year-close/actions.server.ts:367-371` | Las integraciones comerciales y de equipos, que solo miran `lockedUntilDate`, vuelven a aceptar fechas del ejercicio cerrado |
| B6 | Creadores de asientos sin ninguna validación de período: fondos, bancos y transferencias, IVA, diferencia de cambio, recurrentes, apertura, inflación | tabla 1.2.2 | Se escribe en períodos cerrados |
| B7 | Asientos sin `fiscalYearId`/`periodId`: fondos, bancos, diferencia de cambio, recurrentes, apertura | tabla 1.2.2 | Reportes por ejercicio o período incompletos |
| B8 | Numeración no atómica (`lastEntryNumber+1`): fondos (`:485-525`), bancos (`:180-246`, `:1117`, `:1232`), recurrentes (`:209`, `:235`) | — | Choque con `@@unique([companyId, number])` bajo concurrencia |
| B9 | `integrations/treasury` devuelve `null` en período cerrado (silencio). Hoy es código muerto | `integrations/treasury/index.ts:61-63` | Si se reutiliza, repite el bug de TSK-728 |
| B10 | `reverseJournalEntry` no copia auxiliares ni moneda, no valida el período de la fecha de hoy y permite anular asientos de documentos | `entries/actions.server.ts:253-287` | Mayores auxiliares descuadrados; documento CONFIRMED con asiento REVERSED |
| B11 | `cancelInvoice` en una NC suma stock en lugar de restarlo | `sales/.../actions.server.ts:1420-1478` | Stock inflado |
| B12 | `cancelInvoice`, `cancelPurchaseInvoice` y `cancelExpense` no revierten el asiento; `cancelInvoice` permite PAID y CAE | 1.2.5 | Contabilidad desfasada del documento |
| B13 | `deleteBankMovement`: `'CHECK'` en las dos listas, y deja huérfano el asiento manual o de transferencia | `bank-movements/actions.server.ts:697`, `:701` | Saldo mal revertido; asiento sin documento |
| B14 | `rejectCheck` y `voidCheck` (en DEPOSITED) borran el `BankMovement` sin restaurar el saldo; `voidCheck`/`deleteCheck` no miran el vínculo con recibo u OP | `checks/actions.server.ts:402-421`, `:510-514`, `:537-551` | Saldo bancario inflado; recibo u OP con cheque inexistente |
| B15 | `deleteCashMovement` no chequea vínculos con recibo, OP o FundMovement | `movements/actions.server.ts:199-257` | Caja desfasada del documento |
| B16 | `reactivateVehicle` no revierte el asiento de baja ni reactiva la depreciación | `equipment/features/list/actions.server.ts:425` | Bien activo con baja contable vigente |
| B17 | `saveOpeningBalanceEntry` con `replaceExisting=true` hace `deleteMany` de líneas de un asiento POSTED; el trigger lo rechaza siempre | `opening-balances/actions.server.ts:400-427` | La opción "reemplazar" está rota |

> Los B11 a B17 no son estrictamente de "período", pero tocan los mismos flujos de anulación que
> el ticket generaliza. Conviene arreglarlos en la fase del documento correspondiente, no
> aparte. B1 a B10 son prerrequisito.

**Riesgos de la implementación**

- **R1: alcance.** "Todo es modificable" toca unos 12 tipos de documento con efectos cruzados
  (stock, saldos, cheques, aplicaciones, cuotas, proyecciones). Hacerlo de una vez es inviable;
  va por fases (1.7.3).
- **R2: cascadas.** Modificar una factura cobrada obliga a recalcular las aplicaciones del recibo;
  modificar un recibo con cheques ya depositados o endosados obliga a deshacer la cadena del
  cheque. Hay que definir hasta dónde se permite (1.8-3).
- **R3: asientos DRAFT ↔ POSTED.** Si cada documento tiene dos caminos (regenerar si es DRAFT,
  revertir si es POSTED), se duplica la superficie de tests. Mitigación: un único helper
  `replaceDocumentEntryTx` que decide internamente.
- **R4: vínculos débiles.** `CashMovement` (sin FK a recibo, OP ni FundMovement), `BankMovement`
  (sin `journalEntryId`) y `FundMovement.journalEntryId` (sin relación declarada en
  `JournalEntry`) hacen difícil deshacer con precisión. Sin una FK nueva, la anulación tiene que
  buscar por `referenceId`, descripción o fecha, lo que es frágil.
- **R5: migración del modelo de cierre.** Unificar los dos mecanismos cambia el comportamiento
  para las empresas con `FiscalYear` (hoy se ignora `lockedUntilDate`). Hay que backfillear
  `AccountingPeriod.isClosed` desde `lockedUntilDate` y crear el `FiscalYear` que falta en las
  empresas nuevas.
- **R6: datos ya inconsistentes en producción** (facturas CANCELLED con asiento vivo, asientos
  huérfanos de bancos). Hace falta un script de diagnóstico, con psql en Dokploy según la memoria
  `produccion-dokploy-scripts-db`, antes de decidir si se corrigen.
- **R7: CAE sin UI.** Si la clienta empieza a pedir CAE desde la app, la regla "con CAE no se
  edita" pasa a morder en todos los flujos de venta. Conviene implementarla desde el inicio.
- **R8: mensajes redactados.** Las acciones actuales de anulación lanzan `Error`; migrarlas a
  `ActionResult` es parte del trabajo, no opcional.

### 1.7 Propuesta de enfoque

#### 1.7.1 Arquitectura base reutilizable

**1. `assertPeriodOpen(tx, companyId, date, { action })`**, único, en
`src/modules/accounting/shared/utils/period-lock.ts`. Lanza `BusinessError` con un mensaje que
nombra el mes y la causa. Un período está **cerrado** si se cumple cualquiera de estas
condiciones:

- (a) existe un `FiscalYear` que contiene `date` con `isClosed=true`;
- (b) existe el `AccountingPeriod` MONTHLY de ese mes con `isClosed=true`;
- (c) `lockedUntilDate` existe y `date <= lockedUntilDate`.

Se evalúan las tres siempre (OR), no "una o la otra". Además:

- Devuelve `{ fiscalYearId, periodId }` para que todos los creadores los seteen. Así se
  reemplazan las cinco copias de "resolver ejercicio y período".
- Lo usan todos los creadores de la tabla 1.2.2, `postJournalEntry`, la reversión y toda acción
  de modificación de documentos. `validatePeriodLock` y `validateJournalEntryDate` pasan a
  delegar en él.
- Un helper hermano, `nextEntryNumberTx(tx, companyId)`, centraliza el `UPDATE … RETURNING`.
- Mejor aún, un `createJournalEntryTx(tx, input)` compartido (número, período, auxiliares,
  moneda) que reemplace los cinco `createJournalEntry` locales: commercial, equipment, treasury,
  fondos y bancos.

**2. Fuente de verdad del cierre** (depende de 1.8-1; recomendación):

- `AccountingPeriod.isClosed` es la verdad del cierre mensual. `lockedUntilDate` se mantiene como
  "cerrado hasta", **derivado** y sincronizado.
- `setLockedPeriod` pasa a cerrar o abrir los `AccountingPeriod` del rango en la misma
  transacción y nunca puede bajar de `FiscalYear.endDate` de un ejercicio cerrado (corrige B5).
- Se agregan `closeAccountingPeriod` y `reopenAccountingPeriod`. Pueden ser la misma grilla
  `_PeriodLockingForm`, con validación de que el mes no tenga DRAFTs pendientes, o un aviso.
- `closeFiscalYear` exige períodos cerrados y **ausencia de DRAFT** en el ejercicio (corrige B1
  y B4).
- Migración de datos:
  - backfill de `FiscalYear` y períodos para las empresas sin ellos (B2);
  - `isClosed` de los períodos según el `lockedUntilDate` vigente (B3).

**3. `reverseJournalEntryTx(tx, { entryId, date, userId, reason })`**, puro, sin
`checkPermission` ni `$transaction` propios, extraído de `reverseJournalEntry`:

- copia **todas** las columnas de línea: auxiliares, `currency`, `originalAmount`,
  `exchangeRate`;
- llama a `assertPeriodOpen` para la fecha original **y** para la fecha de la reversión;
- setea `originalEntryId` y `reversalEntryId`;
- `reverseJournalEntry` (el action) queda como wrapper con `ActionResult`, y rechaza anular desde
  la UI de asientos uno que pertenezca a un documento ("anulalo desde la factura N°…"), lo que
  corrige B10.

**4. `replaceDocumentEntryTx(tx, { oldEntryId, buildNew })`**: el corazón de "modificar".

- Si el asiento viejo es **DRAFT** → `assertPeriodOpen(fecha vieja)` y luego se borra el asiento
  (líneas en cascada; el trigger lo permite). Hay que desvincular el documento antes, porque la
  FK es opcional.
- Si es **POSTED** → `reverseJournalEntryTx` con la fecha de 1.8-4.
- Si es **REVERSED** o no existe → no hace nada.
- Después, si `buildNew` no es null → `assertPeriodOpen(fecha nueva)` y se crea el asiento nuevo
  con el creador de la integración (prevalidando cuentas como en TSK-721).
- "Anular" = `replaceDocumentEntryTx` con `buildNew = null`.

**5. Detección de dependencias por documento**, con funciones `getModificationBlockers(tx, doc)`
que devuelven una lista de motivos legibles: tiene CAE, tiene cobros o pagos aplicados, NC
aplicada, cheque depositado o endosado, movimiento conciliado, período cerrado. La UI las consume
vía `useQuery` para deshabilitar el botón y explicar por qué. El servidor las vuelve a evaluar
dentro de la transacción.

**6. Vínculos que faltan** (migración):

- `BankMovement.journalEntryId`;
- relación declarada `FundMovement.journalEntry`;
- `CashMovement.receiptId`, `paymentOrderId` y `fundMovementId` (o un `referenceType` +
  `referenceId` genérico, como ya hace `StockMovement`).

Sin esto, anular recibos, OP o fondos depende de búsquedas frágiles (R4).

**7. Modelo de "modificar":**

- **Editar en sitio** = deshacer efectos + `replaceDocumentEntryTx` + aplicar efectos nuevos,
  todo en una transacción. El documento conserva número e id. Sirve para comprobantes internos
  sin CAE: compras, gastos, OP, recibos, fondos y bancos.
- **Anular y rehacer** = el documento pasa a CANCELLED con su asiento revertido, y se ofrece
  "Duplicar como borrador". Más trazable, pero cambia el número. Recomendado solo donde la
  numeración es fiscal (ventas sin CAE ya emitidas al cliente) o donde la clienta prefiera
  rastro.

#### 1.7.2 Matriz por documento (propuesta)

Notas comunes a todas las filas:

- "Período" = `assertPeriodOpen` sobre la fecha original **y** la nueva.
- "Asiento" = `replaceDocumentEntryTx`.

| Documento | "Modificar" significa | Bloqueos | Efectos a deshacer / rehacer |
|---|---|---|---|
| **Factura de venta sin CAE** | Editar en sitio (CONFIRMED sin cobros) o anular y rehacer (recomendado si ya se entregó al cliente) | Período; CAE; `ReceiptItem` confirmados (1.8-3); NC aplicadas a ella; remito que movió el stock | Stock (StockMovement SALE/RETURN, corrigiendo B11), aplicaciones de NC (`SalesCreditNoteApplication`), `CashMovement` de contado, proyecciones, estado del remito y `invoicedQty` del presupuesto |
| **Factura de venta con CAE** (FC, NC, ND) | **No se modifica.** Botón "Generar NC/ND" precargado desde la factura | Siempre | — (la NC hace su propio asiento y su stock) |
| **Factura de compra** | Editar en sitio | Período; OP confirmadas que la apliquen (1.8-3); remito de recepción vinculado (avisar) | Stock (solo NC), `invoicedQty` de la OC, `PurchaseCreditNoteApplication` y asiento |
| **Recibo** | Editar en sitio o anular (hoy no existe ninguno de los dos) | Período; cheque recibido ya depositado, endosado o rechazado; banco conciliado manualmente | Estado de factura PAID/PARTIAL (recalcular desde `ReceiptItem`), `CashMovement` (necesita FK), `BankMovement` (`receiptId`) y saldo, cheques PORTFOLIO (borrar o anular), retenciones sufridas y asiento |
| **Orden de pago** | Editar en sitio o anular | Período; cheque propio ya debitado (CLEARED) o de terceros endosado ya depositado por el proveedor; cuotas de tarjeta con cuotas pagadas | Estado de facturas y gastos, `CashMovement`, `BankMovement` y saldo, cheques (ENDORSED→PORTFOLIO, DELIVERED→borrar o anular), cuotas y proyecciones, cuotas de socio, retenciones emitidas (¿certificado ya entregado?) y asiento |
| **Gasto** | Editar en sitio; corregir `cancelExpense` para que revierta el asiento | Período; OP confirmadas que lo paguen (hoy ya se exige) | Asiento y control presupuestario |
| **Movimiento de fondos** | Editar en sitio o anular | Período; movimiento bancario resultante conciliado | `BankMovement`/`CashMovement` (necesitan FK) y saldo, asiento |
| **Movimiento bancario manual / transferencia** | Editar o borrar con reversión del asiento (hoy queda huérfano) | Período; `reconciled`; vinculado a recibo, OP o fondos (se edita desde el documento) | Saldo (corrigiendo B13), asiento (necesita `journalEntryId`) y contraparte de la transferencia |
| **Movimiento de caja manual** | Borrar (existe) | Sesión de caja cerrada; vinculado a un documento (agregar el chequeo) | Saldo esperado |
| **Cheque** | Sin cambio funcional; agregar bloqueos | Vinculado a recibo u OP confirmados → se modifica desde el documento | Corregir el saldo en rechazo y anulación (B14) |
| **Asiento manual** | DRAFT: editar o borrar (nuevo). POSTED: revertir (existe) | Período | — |
| **Depreciación** | "Desposteo" del último período contabilizado (revertir y reabrir el cronograma) | Período; solo el último contabilizado, en orden inverso | Asiento y `isPosted` del cronograma |
| **Revalúo** | Anular (revertir y borrar el `AssetValueAdjustment`) | Período; depreciaciones posteriores contabilizadas sobre el valor nuevo | Valor del bien y asiento |
| **Baja de equipo** | `reactivateVehicle` revierte el asiento de baja y reactiva la depreciación | Período | Asiento y estado de la depreciación |
| **Liquidación IVA, diferencia de cambio, ajuste por inflación, apertura** | Anular (revertir) y volver a generar | Período | Asiento (y arreglar `replaceExisting`, B17) |

#### 1.7.3 Fases sugeridas y estimación relativa

Estimación en puntos relativos (1 = cambio chico).

| Fase | Contenido | Est. |
|---|---|---|
| **0. Bugs de cierre** | B1 a B10: `assertPeriodOpen` único con OR de las tres condiciones; `createJournalEntryTx` y `nextEntryNumberTx` compartidos; todos los creadores lo usan (B6, B7, B8, B9); `postJournalEntry` valida el ejercicio; `closeFiscalYear` exige períodos cerrados y sin DRAFT; `setLockedPeriod` sincroniza `AccountingPeriod` y no baja de un ejercicio cerrado (B5); migración de backfill (B2, B3). Tests de integración del helper y de cada creador | 8 |
| **1. Base de modificación** | `reverseJournalEntryTx` (copia auxiliares, valida las dos fechas) y `replaceDocumentEntryTx`; el action de reversión rechaza asientos de documentos; editar y borrar asientos manuales en DRAFT; FKs nuevas (`BankMovement.journalEntryId`, relación de `FundMovement`, vínculos de `CashMovement`); patrón `getModificationBlockers` + componente UI de "por qué no se puede" | 6 |
| **2. Anulaciones que ya existen** (riesgo bajo, alto valor) | `cancelExpense`, `cancelPurchaseInvoice` y `cancelInvoice` revierten el asiento y pasan a `ActionResult`; regla de CAE en `cancelInvoice`; B11; script de diagnóstico de datos ya inconsistentes (R6) | 4 |
| **3. Gastos y compras: editar confirmados** | Sin cascadas de cobro (bloqueo si hay pagos) | 5 |
| **4. Movimientos de fondos, bancarios y caja** | Editar y anular con FK nuevas; B13 y B15 | 5 |
| **5. Ventas sin CAE: editar o anular confirmadas** | Stock, NC aplicadas, remitos y presupuestos; "Generar NC/ND desde factura" para las que tienen CAE | 7 |
| **6. Recibos y órdenes de pago: anular y editar** | Cascada de cheques, saldos, aplicaciones, cuotas y retenciones; B14 | 10 |
| **7. Equipos y asientos especiales** | Desposteo de depreciación, anular revalúo, `reactivateVehicle` (B16), anular IVA, diferencia de cambio, inflación y apertura (B17) | 5 |

Las fases 0 y 1 son prerrequisito de todas. Las 2 a 7 son independientes entre sí y se pueden
entregar por separado (un PR por fase). Cada fase actualiza los tests, `docs/` y la guía in-app.

### 1.8 Decisiones abiertas para la clienta

**1. ¿Cierre mensual o bloqueo hasta una fecha?**

- (a) Bloqueo "hasta fecha", como hoy: secuencial, no deja un mes abierto entre dos cerrados.
- (b) Cierre mensual independiente: cada mes se cierra y reabre por separado.
- **Recomendado: (b) con la restricción de (a)**, es decir, meses con estado propio
  (`AccountingPeriod.isClosed`), pero cerrar solo en orden y reabrir solo el último cerrado.
  Se mantiene `lockedUntilDate` como derivado.
- Por qué: es lo que ya modela el esquema y lo que exige `closeFiscalYear`, y conserva la UX que
  la clienta ya conoce. Agregar el aviso "hay N asientos en borrador en este mes" al cerrar.

**2. Facturas de venta con CAE**

- (a) No se modifican ni se anulan: solo NC/ND.
- (b) Se permite anular internamente con NC automática.
- (c) Se permite editar datos no fiscales (notas, vencimiento, centro de costo).
- **Recomendado: (a) + (c)**: solo se editan campos que no viajan a ARCA ni cambian el asiento
  (observaciones, vencimiento, adjunto, centros de costo si no cambian cuentas), más un botón
  "Generar NC/ND" precargado.
- Hoy `requestCAE` no tiene UI: confirmar si la clienta factura electrónicamente desde otro
  sistema y carga las facturas acá. En ese caso, ¿la regla aplica igual a las facturas que
  traen CAE cargado a mano?

**3. Comprobantes con pagos o cobros aplicados**

- (a) Bloquear: primero se anula el recibo u OP.
- (b) Permitir si no cambia el total.
- (c) Permitir siempre y recalcular saldos y estados.
- **Recomendado: (a) para ventas y compras** (mensaje: "tiene el recibo N° X aplicado; anulalo
  primero") **y (b) como extensión opcional** para cambios que no tocan total ni contraparte
  (por ejemplo, cuenta contable o centro de costo de una línea).
- Para recibos y OP: bloquear si algún cheque ya salió de cartera (depositado, endosado o
  rechazado) o si el banco se concilió manualmente.

**4. Fecha del contra-asiento** (solo cuando el asiento original ya está POSTED)

- (a) La misma fecha del original: corrige el mes original y queda prolijo para reportes
  mensuales.
- (b) Fecha de hoy: lo que hace hoy `reverseJournalEntry`.
- (c) A elección del usuario.
- **Recomendado: (a)**. Como solo se permite modificar con el período abierto, la fecha original
  siempre es válida, y así el IVA y los resultados del mes quedan correctos sin que la
  corrección "salte" de mes.
- Mantener (b) solo para la anulación manual de asientos desde Contabilidad, o unificar en (a).
- Si el asiento es DRAFT no hay contra-asiento: se regenera.

**5. (Nueva) ¿Asientos automáticos directo en POSTED?**

- Hoy los asientos de documentos nacen DRAFT y alguien tiene que "Registrar" uno por uno; si no,
  no aparecen en Diario, Mayor ni Balance.
- Opciones:
  - (a) mantener DRAFT y agregar "Registrar todos los del mes" (natural al cerrar el período);
  - (b) nacer POSTED.
- **Recomendado: (a)**. Mantiene la revisión del contador y maximiza el caso barato (regenerar
  en lugar de revertir) durante el mes abierto. El cierre de período obliga a registrar o revisar
  los DRAFT.

**6. (Nueva) Editar en sitio vs. anular y rehacer en ventas sin CAE**

- **Recomendado:** editar en sitio mientras no tenga cobros ni CAE; si ya se entregó al cliente,
  anular y "Duplicar como borrador".
- Confirmar si la numeración interna de ventas sin CAE (comprobantes X o remitos) tiene que ser
  correlativa sin huecos.

---

## 2. Planificación
_Pendiente - ejecutar `/planificar tsk-758-modificaciones-con-periodo-abierto`_

## 3. Diseño
_Pendiente - ejecutar `/disenar tsk-758-modificaciones-con-periodo-abierto`_

## 4. Implementación
_Pendiente - ejecutar `/implementar tsk-758-modificaciones-con-periodo-abierto`_

## 5. Verificación
_Pendiente - ejecutar `/verificar tsk-758-modificaciones-con-periodo-abierto`_
