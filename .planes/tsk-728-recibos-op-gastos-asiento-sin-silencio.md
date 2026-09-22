# TSK-728: Recibos, órdenes de pago y gastos no se confirman sin asiento

**Fecha de inicio:** 2026-09-19
**Ticket:** [728] "Recibos, órdenes de pago y gastos: el fallo del asiento se traga en silencio" · seguimiento de 721 y 724c
**Estado:** Verificación completada (pendiente solo el diagnóstico en producción, post-deploy)

---

## 1. Análisis

### 1.1 Problema

Al confirmar un **recibo de cobro**, una **orden de pago** o un **gasto (Egresos)**, la
generación del asiento contable corre dentro de la transacción envuelta en un `try/catch` que
**solo relanza** si el mensaje contiene `'período está cerrado'` y degrada **cualquier otro
fallo** a `logger.warn`:

- Recibos: `src/modules/commercial/features/treasury/features/receipts/actions.server.ts:391-414`
  (`catch` en `:405`, `includes('período está cerrado')` en `:407`, `warn` en `:410`).
- Órdenes de pago: `src/modules/commercial/features/treasury/features/payment-orders/actions.server.ts:724-751`
  (`catch` `:740`, `warn` `:745`).
- Gastos: `src/modules/commercial/features/expenses/actions.server.ts:532-549` (`catch` `:541`,
  `warn` `:546`).

Además, las tres integraciones (`createJournalEntryForReceipt`, `…ForPaymentOrder`,
`…ForExpense` en `src/modules/accounting/features/integrations/commercial/index.ts:678-1032`)
**devuelven `null`** cuando falta una cuenta global (`:686-692`, `:827-833`, `:974-979`) y hacen
**`continue`** cuando un pago o una retención no tiene cuenta (`:752-757`, `:774-779`, `:898-903`,
`:920-925`). El `continue` deja el asiento **descuadrado**, `validateBalance` lanza un `Error`
genérico (`:174-186`, "El asiento no está balanceado…") que el `catch` del action traga. En todos
los casos el comprobante queda **`CONFIRMED` con `journal_entry_id IS NULL`**, la caja/banco ya
se movió, las facturas ya pasaron a `PAID`/`PARTIAL_PAID` y **nadie se entera**.

Segundo problema, heredado de TSK-481: los tres `confirm*` **lanzan** (`throw error` en
`receipts:426-432`, `payment-orders:762-768`, `expenses:556-560`) y los tres consumidores hacen
`catch (error) { toast.error(error.message) }` (`_ReceiptsTable.tsx:44-58`,
`_PaymentOrdersTable.tsx:53-67`, `_ExpensesTable.tsx:54-68`, `_ExpenseDetailModal.tsx:91-116`).
En build de producción Next.js **redacta** el mensaje de cualquier `Error` lanzado desde un
Server Action (memoria `errores-negocio-server-actions`; verificado en TSK-721 con `npm run
build && npm run start`), así que incluso el único error que hoy sí se relanza ("período
cerrado") llega como "An error occurred in the Server Components render… digest".

Es la misma clase de bug que se corrigió en facturas (TSK-721, `.planes/tsk-721-…md` §3.7 y
Fase 3) y en equipos (TSK-724c) con: **pre-validación antes de la transacción**, `BusinessError`
en la integración, `ActionResult` en la action y `result.error` en el cliente. El ticket 728 pide
replicarlo en los tres comprobantes, con tests de integración por cada uno y extender
`prisma/scripts/diagnose-invoices-without-entry.ts` a los tres tipos (criterio de aceptación
literal del ticket: «Confirmar un recibo/OP/gasto con una cuenta contable faltante NO lo deja
confirmado: devuelve `{ success:false, error }` con el motivo legible, también en build de
producción»).

**Hallazgo que cambia el alcance** (detallado en 1.2.4): el silencio no tapa solo "falta
configurar una cuenta". Para varios **medios de pago** el asiento **no tiene definida ninguna
cuenta** en el sistema (cheque físico recibido, cheque propio o endosado en OP, tarjetas de
débito/crédito de empresa o de socio, "Cuenta corriente", efectivo sin caja, transferencia sin
banco). Hoy esos recibos/OP se confirman sin asiento *siempre*. Si el ticket solo "deja de
tragar", esos comprobantes **pasarían a no poder confirmarse nunca**: hay que decidir qué
cuenta lleva cada medio (o si se confirman con aviso explícito). Es la pregunta abierta 1.7-1.

### 1.2 Contexto actual

#### 1.2.1 Recibos de cobro

**Flujo**: `createReceipt` (`receipts/actions.server.ts:112-213`) crea el recibo en `DRAFT`
con `items`, `payments` y `withholdings` y **no** genera asiento. La confirmación es un paso
aparte: `confirmReceipt(receiptId)` (`:219-433`), permiso `commercial.treasury.receipts` /
`approve` (`:220`). No hay bulk de confirmación (grep `bulk` en `treasury/` y `expenses/`: sin
resultados).

**Qué hace `confirmReceipt`** (todo dentro de `prisma.$transaction`, `:252-415`):

1. `findFirst` con `status: 'DRAFT'` e `include: { items.invoice, payments, withholdings }`
   (`:229-245`); si no existe → `throw new Error('Recibo no encontrado o ya confirmado')` (`:247`).
   El `include` de `payments` **no trae** `cashRegister.accountId` ni `bankAccount.accountId`:
   la pre-validación tendrá que cargarlos.
2. `receipt.update({ status: 'CONFIRMED', confirmedBy, confirmedAt })` (`:253-260`).
3. Por cada item: recalcula cobrado (recibos + NC aplicadas) y pasa la factura a `PAID` /
   `PARTIAL_PAID` (`:263-287`).
4. Por cada pago (`:290-389`): si `cashRegisterId` → exige sesión abierta (`throw new
   Error('No hay sesión abierta para la caja seleccionada')`, `:302`), crea `CashMovement INCOME`
   y suma `expectedBalance`; si `bankAccountId && paymentMethod !== 'ECHEQ'` → `BankMovement
   DEPOSIT` y suma `balance` (`:331-364`); si `CHECK`/`ECHEQ` con `checkNumber` → `Check
   THIRD_PARTY` en `PORTFOLIO` (`:367-388`). **Un pago sin caja ni banco no mueve nada.**
5. Asiento en `try/catch` (`:391-414`): `createJournalEntryForReceipt(receiptId, companyId,
   tx)`; si devuelve id, `receipt.update({ journalEntryId })` + `logger.info`; si devuelve
   `null` **no pasa nada**; si lanza, relanza solo "período está cerrado" y el resto → `warn`.
6. `revalidatePath('/dashboard/commercial/treasury/receipts')` y `return { success: true }`
   (`:422-424`). El `catch` externo (`:426-432`) loguea `error` y **relanza**.

**Integración** `createJournalEntryForReceipt` (`accounting/…/commercial/index.ts:678-811`,
firma `Promise<string | null>`):

| Paso | Código | Qué pasa si falta |
|---|---|---|
| Settings con `include` de todas las cuentas | `getAccountingSettings(companyId, tx)` `:683`; helper `:86-109` | sin `AccountingSettings` → `throw new Error('No se encontró configuración contable para la empresa')` (`:106`, **`Error` común, no `BusinessError`**) |
| Guard `receivablesAccountId` ("Cuentas por Cobrar") | `:686-692` | `logger.warn` + **`return null`** |
| Recibo con `payments { amount, cashRegisterId, bankAccountId, cashRegister.accountId, bankAccount.accountId }` y `withholdings { taxType, amount }` | `:694-717` | no encontrado → `throw new Error` (`:722`) |
| Haber Cuentas por Cobrar por `totalAmount`, con `customerId` | `:727-733` | — |
| Debe caja/banco por cada pago: `cashRegister.accountId` → `bankAccount.accountId` → `defaultCashAccountId` (solo si hay `cashRegisterId`) → `defaultBankAccountId` (solo si hay `bankAccountId`) | `:736-770`, resolución `:740-750` | `!accountId` → `logger.warn('No se encontró cuenta contable para el pago')` + **`continue`** (`:752-757`) → asiento descuadrado |
| Debe retención sufrida por `taxType` (`withholdingIva/Ganancias/Iibb/SussSufferedAccountId`) | `:773-786`, mapa `getWithholdingAccountId(…, 'suffered')` `:148-171` | `logger.warn` + **`continue`** (`:774-779`) → descuadrado |
| `lines.length < 2` | `:789-794` | `logger.warn` + **`return null`** (recibo sin pagos ni retenciones, o con todos los pagos sin cuenta) |
| `createJournalEntry` | `:796-804` → `:190-283` | `validateBalance` lanza `Error` genérico (`:174-186`); "período cerrado" y "sin configuración" ya son `BusinessError` (`:205-212`, TSK-721) |
| `catch` interno | `:805-810` | `logger.error` + `throw error` (relanza; la que traga es la action) |

**Nota**: el `paymentMethod` **no se consulta** en el asiento; solo importa si el pago tiene
`cashRegisterId`/`bankAccountId`. La cuenta `checksReceivedAccountId` ("valores a depositar")
existe en el schema (`prisma/schema.prisma:624`) pero **no tiene UI** en Ajustes contables
(`_CommercialIntegrationForm.tsx` no la lista) y el asiento del recibo **no la usa**; solo la lee
`integrations/treasury/index.ts:204-247`, cuya función `createJournalEntryForCheckDeposit`
**no tiene ningún llamador** (grep `ForCheckDeposit|ForCheckRejection|ForBankTransfer|
integrations/treasury` fuera de su propio archivo: 0 resultados; `checks/actions.server.ts`
no importa nada de contabilidad).

**Consumidor**: `_ReceiptsTable.tsx:44-58` (`handleConfirm`, `AlertDialog` "¿Confirmar recibo?"
`:155-171`, texto "se registrarán los movimientos de caja/banco y se actualizará el estado de
las facturas" `:159-162`), `try/catch` con `toast.error(error.message)` y `router.refresh()`.
`_ReceiptDetailModal.tsx` y `_EditReceiptModal.tsx` no confirman. Ninguna vista muestra el
`journalEntryId` (grep `journalEntry` en los componentes de recibos/OP/gastos: 0).

#### 1.2.2 Órdenes de pago

**Flujo**: `createPaymentOrder` (`payment-orders/actions.server.ts:311-418`) y
`createPartnerRepaymentOrder` (`:206-305`, OP de devolución a socio con `partnerId`) crean en
`DRAFT`. `confirmPaymentOrder(paymentOrderId)` (`:424-769`), permiso
`commercial.treasury.payment-orders` / `approve` (`:425`). Sin bulk.

**Qué hace** (transacción `:458-753`):

1. `findFirst` `DRAFT` con `include: { items.invoice/expense, payments { card { partner } },
   withholdings, supplier }` (`:433-452`); tampoco trae `cashRegister`/`bankAccount.accountId`.
2. `status: 'CONFIRMED'` (`:460-467`); facturas de compra y gastos → `PAID`/`PARTIAL_PAID`
   (`:470-508`).
3. Pagos (`:511-621`): **tarjeta de socio → `continue`** (la empresa no mueve plata, `:511-515`);
   caja → sesión abierta o `throw new Error` (`:530`), `CashMovement EXPENSE`; banco (no ECHEQ) →
   `BankMovement WITHDRAWAL`; `CHECK`/`ECHEQ` → endoso de cheque de tercero (`:594-614`, `throw
   new Error` si ya no está en cartera `:601`) o cheque propio `OWN`/`DELIVERED` (`:615-636`).
4. Tarjetas (`:643-711`): genera `PaymentOrderInstallment` (cuotas) y `CashflowProjection`;
   **no** crea `PartnerAccountMovement` (ese modelo solo lo escriben
   `partners/features/list|detail/actions.server.ts`).
5. OP a socio: salda cuotas (`:716-721`).
6. Asiento **solo si `!paymentOrder.partnerId`** (`:724-751`): mismo `try/catch` que recibos.
   Las OP de devolución a socio **nunca generan asiento** aunque muevan caja/banco (comentario
   `:722-723` "no generan asiento de compra") → seguimiento, no es este ticket (1.2.5).
7. `return { success: true }` (`:760`); `catch` externo relanza (`:762-768`).

**Integración** `createJournalEntryForPaymentOrder` (`index.ts:819-957`): espejo del recibo.
Guard `payablesAccountId` ("Cuentas por Pagar") → `warn` + `return null` (`:827-833`); Debe
Cuentas por Pagar por el total con `supplierId` (`:873-879`); Haber caja/banco por pago con la
**misma cadena de resolución** (`:882-916`, `continue` en `:898-903`); Haber retención emitida
por `taxType` (`withholding*EmittedAccountId`, `:919-933`, `continue` `:920-925`);
`lines.length < 2` → `null` (`:935-940`). El `select` de `payments` (`:850-858`) **no trae**
`paymentMethod`, `cardId`, `endorsedCheckId` ni `card.ownerType`: para un pago con tarjeta o
cheque no hay forma de saber qué es dentro del asiento.

**Consumidor**: `_PaymentOrdersTable.tsx:53-67` (`handleConfirm`, mismo patrón `try/catch`;
`AlertDialog` `:185-192`). `_PaymentOrderDetailModal.tsx` y `_EditPaymentOrderModal.tsx` no
confirman.

#### 1.2.3 Gastos (Egresos)

El módulo se llama `expenses` y la pantalla "Egresos" (`ExpensesList.tsx:34`,
`_AppSidebar.tsx:207`, label de permiso `permissions/constants.ts:152`); la guía in-app todavía
dice "Gastos" (`_CommercialGuide.tsx:1109-1190`).

**Flujo**: `createExpense` (`expenses/actions.server.ts:382-429`) crea en `DRAFT` con
`categoryId` obligatorio y `supplierId` opcional (`validators.ts:19-27`). `Expense` **no tiene
líneas, ni IVA, ni forma de pago**: es un monto único (`schema.prisma:3659-3692`); se paga
después con una OP (`PaymentOrderItem.expenseId`, `:3425`). `ExpenseCategory` **no tiene cuenta
contable** (`:3643-3657`: solo `name`, `description`, `isActive`). Por lo tanto el asiento del
gasto usa **siempre** `expensesAccountId` ("Cuenta de Gastos Operativos") contra
`payablesAccountId`: no hay "cuenta del ítem/categoría" que priorizar, a diferencia de 721.

`confirmExpense(id)` (`:479-560`), permiso `commercial.expenses` / `approve` (`:483`), firma
declarada `Promise<{ success: true; budgetWarning?: { message; executedPercent } }>`
(`:479-482`): ya devuelve un objeto con un aviso opcional, así que el cambio a `ActionResult<{
budgetWarning?: … }>` es natural.

1. `findFirst` `DRAFT` → `throw new Error('Gasto no encontrado o ya confirmado')` (`:492-496`).
2. Verificación presupuestaria **no bloqueante** en `try/catch` propio (`:499-525`,
   `checkBudgetForExpense` de `index.ts:1051-1200`); se mantiene tal cual.
3. Transacción (`:527-550`): `status: 'CONFIRMED'` y el asiento en el `try/catch` que traga
   (`:532-549`).
4. `return { success: true, budgetWarning }` (`:554`); `catch` externo relanza (`:556-560`).

**Integración** `createJournalEntryForExpense` (`index.ts:965-1032`): guard `expensesAccountId ||
payablesAccountId` → `warn` + `return null` (`:974-979`); gasto no encontrado → `Error` (`:995`);
dos líneas fijas Debe Gastos Operativos / Haber Cuentas por Pagar con `supplierId` (`:1002-1017`).
No hay `continue` posibles: el único fallo silencioso es el guard.

**Consumidores**: `_ExpensesTable.tsx:54-68` (`handleConfirm`, descarta el `budgetWarning`) y
`_ExpenseDetailModal.tsx:91-116` (muestra `toast.warning` con `result.budgetWarning`, `:99-105`).
Ambos con `try/catch` + `error.message`.

#### 1.2.4 Cómo se resuelven las cuentas de los medios de pago (y dónde no hay ninguna)

La cadena de resolución de recibos y OP es idéntica (`index.ts:740-750` y `:886-896`):

```
cashRegisterId && cashRegister.accountId   → cuenta propia de la caja
bankAccountId  && bankAccount.accountId    → cuenta propia del banco
cashRegisterId && defaultCashAccountId     → "Caja por Defecto"  (Ajustes)
bankAccountId  && defaultBankAccountId     → "Banco por Defecto" (Ajustes)
si no                                      → continue (línea omitida, asiento descuadrado)
```

`BankAccount.accountId` y `CashRegister.accountId` son opcionales (`schema.prisma:3222`,
`:3108`). Los labels reales de Ajustes son "Caja por Defecto" / "Banco por Defecto"
(`_CommercialIntegrationForm.tsx:119-129`, sección "Cuentas de Tesorería (Opcional)"). Los
mensajes ya redactados para "banco/caja sin cuenta" existen en fund-movements (TSK-481/717):
«La cuenta bancaria "X" no tiene cuenta contable asociada. Configurala en la cuenta bancaria o
definí una cuenta de banco por defecto en Ajustes contables.» y su equivalente para caja
(`fund-movements/list/actions.server.ts:353-357`, `:400-404`); conviene reusarlos textualmente.

Qué campos carga cada medio de pago (Zod `basePaymentFields`, `treasury/shared/validators.ts:
347-380`; `refineCheckPayment` `:383-424`; `refineCardPayment` `:511-523`; formularios
`_CreateReceiptModal.tsx:487-690` y `_CreatePaymentOrderModal.tsx:594-830`) y qué hace hoy el
asiento:

| `PaymentMethod` (`schema.prisma:2660-2670`) | Recibo: campos | OP: campos | Cuenta en el asiento hoy | Resultado hoy |
|---|---|---|---|---|
| `CASH` | `cashRegisterId` (el form lo pide `:487-512`; **Zod no lo exige**, `:356`) | ídem (`:669-693`) | caja → por defecto | ok si hay cuenta; sin `cashRegisterId` → `continue` (ni movimiento de caja, `receipts:290`) |
| `TRANSFER` | `bankAccountId` (form `:514-539`; Zod opcional) | ídem (`:694-720`) | banco → por defecto | ok si hay cuenta; sin banco → `continue` |
| `DEBIT_CARD` | `bankAccountId` + `cardLast4` (`:514`, `:667`) | `bankAccountId` (`:694`) + `cardId` obligatorio (`:517`) + tarjeta de socio posible | banco (si lo hay) | recibo: como transferencia. OP con tarjeta de empresa: banco. **OP con tarjeta de socio: `continue` en la action (`:511-515`) y sin cuenta en el asiento** → descuadrado |
| `CREDIT_CARD` | solo `cardLast4` | `cardId` + `installmentsCount` (`:520`); genera cuotas | **ninguna** | `continue` → descuadrado o `null` |
| `CHECK` (físico) | datos del cheque, **sin banco** (`:541-636`; Zod `:407-420`) | propio (`checkNumber`…) o endosado (`endorsedCheckId`, `:401-403`) | **ninguna** (`checksReceivedAccountId` no se usa, ver 1.2.1) | `continue` → descuadrado / `null` |
| `ECHEQ` | `bankAccountId` **obligatorio** (`:421-423`) | `bankAccountId` (emisión) | banco (aunque el saldo no se acredita/debita hasta el cobro, `receipts:331`, `payment-orders:557`) | ok si el banco tiene cuenta |
| `ACCOUNT` ("Cuenta Corriente", `PAYMENT_METHOD_LABELS` `:477`) | nada | nada | **ninguna** | `continue` |
| Sin pagos ni retenciones (Zod lo permite: «se vincula después a movimiento bancario», `:441-444`, `:545-548`) | — | — | solo la línea de Cobrar/Pagar | `lines.length < 2` → `return null`. Vincular después (`linkBankMovementToDocument`, `bank-movements/actions.server.ts:858-905`) **tampoco genera asiento** |

Retenciones: `WithholdingTaxType` = IVA, GANANCIAS, IIBB, SUSS (`schema.prisma:2742-2749`);
cuentas `withholding{Iva,Ganancias,Iibb,Suss}{Emitted,Suffered}AccountId` (`:549-558`) con
labels "Ret. IVA Emitida" … "Ret. SUSS Sufrida" (`_CommercialIntegrationForm.tsx:159-181`).
Existe `WITHHOLDING_TAX_TYPE_LABELS` (`validators.ts:325-330`) para nombrar el tipo en el error.

**Conclusión de la tabla**: con las cuentas que existen hoy solo se puede contabilizar
efectivo con caja, transferencia/débito con banco, e-cheq y retenciones. Para cheque físico
recibido, cheque propio/endosado en OP, tarjeta de crédito, tarjeta de socio y "Cuenta
corriente" **no hay cuenta definida en ningún lado** (ni en `AccountingSettings`, ni en `Card`
—`schema.prisma:4450-4474`, sin `accountId`—, ni en `Partner` —solo `contributionsAccountId`
de patrimonio, `:4431`). Hoy se confirman sin asiento en silencio; con el cambio pasarían a
**bloquearse**. Ver 1.7-1.

#### 1.2.5 Otros lugares con el mismo patrón

Grep de `logger.warn` cerca de asiento/journal y de `catch` que no relanzan en
`src/modules/commercial/**/*.server.ts` y `src/modules/accounting/features/integrations/**`:

| # | Archivo:línea | Qué traga | Alcance |
|---|---|---|---|
| 1 | `treasury/features/receipts/actions.server.ts:405-413` | `catch` del asiento → `warn` salvo "período cerrado"; `null` ignorado (`:394`) | **En alcance** (título) |
| 2 | `treasury/features/payment-orders/actions.server.ts:740-748` | ídem | **En alcance** (título) |
| 3 | `expenses/actions.server.ts:541-548` | ídem | **En alcance** (título) |
| 4 | `integrations/commercial/index.ts:686-692`, `:752-757`, `:774-779`, `:789-794` | recibo: `return null` / `continue` por cuenta faltante | **En alcance** (pasan a `BusinessError`, como 721 hizo en `:330`, `:405-408`) |
| 5 | `integrations/commercial/index.ts:827-833`, `:898-903`, `:920-925`, `:935-940` | OP: ídem | **En alcance** |
| 6 | `integrations/commercial/index.ts:974-979` | gasto: `return null` por `expensesAccountId`/`payablesAccountId` | **En alcance** |
| 7 | `integrations/commercial/index.ts:105-106` | `getAccountingSettings` lanza `Error` común ("No se encontró configuración contable para la empresa") → con `ActionResult` llegaría como mensaje genérico | **En alcance** (cambio de una línea a `BusinessError`; también beneficia a facturas) |
| 8 | `treasury/features/payment-orders/actions.server.ts:722-725` | OP de devolución a socio (`partnerId`) **no genera asiento por diseño** aunque mueva caja/banco | **Seguimiento**: es una decisión contable (¿Haber banco / Debe deuda con socio?), no un `catch`; requiere cuenta de pasivo por socio que hoy no existe |
| 9 | `treasury/features/bank-movements/actions.server.ts:117-131` | movimiento bancario manual: `if (bankAccount.accountId)` → sin cuenta **no genera asiento, sin aviso** (y `createJournalEntryForBankMovement` `:185-189` hace `warn` + `return` si no hay settings) | **Seguimiento**: la action ya exige cuenta contrapartida (`:78`) y la UI podría exigir banco con cuenta; conviene ticket propio junto con 10 |
| 10 | `treasury/features/bank-movements/actions.server.ts:1109-1130`, `:1224-1245` | transferencias banco→banco y banco→caja: `if (sourceAccount.accountId && destAccount.accountId)` → sin cuenta, sin asiento ni aviso; además numeran con `lastEntryNumber + 1` sin el `UPDATE … RETURNING` atómico de `index.ts:223-228` | **Seguimiento** (mismo ticket que 9) |
| 11 | `integrations/treasury/index.ts:62-65`, `:156-159`, `:204-208`, `:228-230`, `:276-280`, `:299-301` y sus `catch` `return null` (`:185`, `:256`, `:325`) | período cerrado y cuentas faltantes → `null`; **código muerto**: ninguna action llama a `createJournalEntryForBankTransfer/CheckDeposit/CheckRejection` | **Seguimiento**: decidir si se conecta a `depositCheck`/`rejectCheck` (`checks/actions.server.ts:286`, `:402`) o se borra; hoy depósitos y rechazos de cheques **no tienen asiento** |
| 12 | `integrations/commercial/index.ts:1216-1218`, `:1236`, `:1246`, `:1271-1276` | CMV: `return null` si faltan `cogsAccountId`/`inventoryAccountId` y `catch` → `null` | **Seguimiento**: TSK-721 lo dejó explícito como pendiente (2.4-10); `createJournalEntryForCOGS` tampoco tiene llamador hoy (grep: 0) |
| 13 | `expenses/actions.server.ts:520-524` | `catch` de la verificación presupuestaria → `warn` | **Fuera**: es no bloqueante por diseño (docs `accounting.md:397`) y no afecta al asiento |
| 14 | `equipment/features/depreciation/actions.server.ts:958-964` | bulk de depreciaciones: `catch` por equipo → `errors[]` que se devuelven al usuario | **Fuera**: ya es el patrón correcto (724c) |

Verificado que **no** hay más: notas de crédito/débito de venta y compra pasan por
`confirmInvoice`/`confirmPurchaseInvoice` (721, sin `catch`: `sales/…/actions.server.ts:1157-1165`,
`purchases/…/actions.server.ts:1524-1532`); remitos, cierre de caja (`cash-registers`,
`sessions`), cheques, tarjetas y cuotas **no escriben asientos** (grep `journalEntry` en esas
carpetas: 0). Fund-movements ya usa `BusinessError`/`ActionResult` sin `catch` que trague
(`fund-movements/list/actions.server.ts:918-931`).

#### 1.2.6 Datos históricos

Molde: `prisma/scripts/diagnose-invoices-without-entry.ts` (291 líneas; solo lectura; header
con el SQL equivalente para prod porque la imagen `runner` no tiene `tsx`, memoria
`produccion-dokploy-scripts-db`; estructura `findInvoicesWithoutEntry` → agrupado por empresa →
totales, `:110-291`). Columnas necesarias, verificadas en dev con `information_schema.columns`:

- `receipts`: `journal_entry_id`, `status` (enum `receipt_status`: DRAFT, CONFIRMED,
  CANCELLED), `full_number`, `date`, `total_amount`, `customer_id` → `contractors.name`.
- `payment_orders`: `journal_entry_id`, `status` (`payment_order_status`: DRAFT, CONFIRMED,
  CANCELLED), `partner_id` (excluir las OP a socio, que no generan asiento por diseño),
  `supplier_id` → `suppliers.business_name`.
- `expenses`: `journal_entry_id`, `status` (`expense_status`: DRAFT, CONFIRMED, PARTIAL_PAID,
  PAID, CANCELLED; "confirmado" = `NOT IN ('DRAFT','CANCELLED')`, como en facturas),
  `full_number`, `date`, `amount`, `supplier_id` opcional.

SQL probado en dev (`docker exec contable-pms-db psql -U postgres -d contable_pms`), devuelve
0 filas y sin errores de columnas:

```sql
SELECT 'RECIBO' AS tipo, c.name, r.full_number, r.date::date, k.name, r.total_amount, r.status::text, r.id
FROM receipts r JOIN companies c ON c.id=r.company_id JOIN contractors k ON k.id=r.customer_id
WHERE r.status='CONFIRMED' AND r.journal_entry_id IS NULL
UNION ALL
SELECT 'OP', c.name, p.full_number, p.date::date, coalesce(v.business_name,'-'), p.total_amount, p.status::text, p.id
FROM payment_orders p JOIN companies c ON c.id=p.company_id LEFT JOIN suppliers v ON v.id=p.supplier_id
WHERE p.status='CONFIRMED' AND p.journal_entry_id IS NULL AND p.partner_id IS NULL
UNION ALL
SELECT 'GASTO', c.name, e.full_number, e.date::date, coalesce(v.business_name,'-'), e.amount, e.status::text, e.id
FROM expenses e JOIN companies c ON c.id=e.company_id LEFT JOIN suppliers v ON v.id=e.supplier_id
WHERE e.status NOT IN ('DRAFT','CANCELLED') AND e.journal_entry_id IS NULL
ORDER BY 2, 4, 1;
```

**Conteo en dev**: `receipts` 0, `payment_orders` 0, `expenses` 0 filas en total (también
`receipt_payments` y `payment_order_payments` 0; `sales_invoices` 0, `purchase_invoices` 8,
`journal_entries` 17, `companies` 2). La base de dev **no tiene datos** de estos comprobantes:
el conteo de históricos sin asiento solo se puede obtener en producción con el SQL de arriba
(mismo chequeo post-deploy que `docs/infrastructure/deployment.md:26-38` documenta para 721).
Conviene además contar en prod `receipt_payments`/`payment_order_payments` por `payment_method`
para saber si los medios "sin cuenta" de 1.2.4 se usan (decide 1.7-1).

#### 1.2.7 Alternativas comparadas y recomendación

**A) Réplica del patrón 721 por módulo.** Tres pre-validaciones específicas (una por
comprobante) que cargan settings + cajas/bancos + retenciones y lanzan `BusinessError` con el
label real de Ajustes; las tres integraciones pasan de `return null`/`continue` a
`BusinessError` y devuelven `Promise<string>`; los tres `confirm*` devuelven `ActionResult`; los
cuatro consumidores leen `result.error`. Pros: cero abstracción nueva, mismo molde que
`confirmInvoice`. Contras: la resolución caja/banco y los mensajes de "falta configurar X en
Contabilidad → Configuración" quedan **triplicados** (recibo y OP ya son copia literal uno del
otro, `index.ts:740-750` vs `:886-896`), y hay que mantener a mano la correspondencia
`settings.campo → label` que ya vive en `SECTIONS` del form (`_CommercialIntegrationForm.tsx:56-258`,
`const` no exportada dentro de un `'use client'`).

**B) A + helper compartido de "cuentas requeridas".** Igual que A pero:
1. Extraer los labels de Ajustes a constantes puras en `shared/` (mismo criterio que
   `src/shared/lib/assets/asset-account-labels.ts`, creado en 724c para que dos módulos que no
   pueden importarse compartan labels): `ACCOUNTING_SETTING_LABELS: Record<campo, label>`; el form
   pasa a leer los labels de ahí (las ayudas y `types` se quedan en el form).
2. Un helper puro `assertSettingsAccounts(settings, required: campo[], contexto)` /
   `findMissingSettingsAccounts` + `buildMissingSettingsAccountsMessage` en
   `commercial/shared/settings-accounts.ts` (mismo estilo que `perceptions.ts:179-193` y
   `line-accounts.ts`), con mensaje «No se puede confirmar el recibo R-00012: falta configurar
   "Cuentas por Cobrar" y "Ret. IIBB Sufrida" en Contabilidad → Configuración.».
3. Un resolutor compartido de cuenta de medio de pago `resolvePaymentAccount(payment, settings)`
   → `{ accountId, source } | { missing: 'CASH_REGISTER' | 'BANK' | 'METHOD' }` con los
   mensajes de fund-movements reutilizados, usado por la pre-validación **y** por el asiento de
   recibo y OP (una sola cadena de resolución en vez de dos copias).
Las validaciones específicas (sesión de caja abierta, cheque endosado disponible, socio) siguen
por módulo. Pros: los tres módulos —y los futuros (bancarios de 1.2.5-9/10, CMV)— comparten la
regla "estas cuentas de Ajustes son obligatorias para esta operación"; los labels no se
desincronizan del form; recibo y OP dejan de ser copia. Contras: ~2 archivos nuevos en `shared/`
y tocar el form de Ajustes (solo import de labels, sin cambio visual).

**C) Solo quitar los `catch` que tragan.** Todo fallo aborta la transacción (`throw`), sin
pre-validación ni `ActionResult`. Mínimo cambio, pero (i) los mensajes llegan **redactados en
producción** (el motivo del ticket), (ii) el "asiento descuadrado" seguiría siendo un `Error`
genérico sin decir qué cuenta falta, (iii) sin pre-validación se ejecutan movimientos de
caja/banco y cambios de estado que después se revierten (correcto pero opaco). **Descartada**.

**Recomendación: B.** El costo extra sobre A es chico (labels + dos helpers puros con tests
unitarios sin base) y elimina la triplicación que A introduce en el punto más delicado —la
resolución de cuentas de medios de pago— que además hay que **extender** para los medios sin
cuenta (1.7-1). Complementos ya decididos por convención: `BusinessError` se lanza **desde la
integración** (defensa en profundidad, como 721 §4 Fase 3 nota (a)); la pre-validación corre
**antes** de `prisma.$transaction` (724c, `equipment/features/list/actions.server.ts:355-360`);
el cliente conserva `try/finally` y hace `if (!result.success) { toast.error(result.error);
return; }` (`_InvoicesTable.tsx`, `_CreateFundMovementModal.tsx:255`).

### 1.3 Archivos involucrados

**A modificar**

- `src/modules/commercial/features/treasury/features/receipts/actions.server.ts` — `confirmReceipt`
  (`:219-433`): pre-validación, `ActionResult<{ id: string }>`, `BusinessError` en "no
  encontrado/ya confirmado" (`:247`) y "sin sesión de caja" (`:302`), asiento sin `try/catch`,
  `toActionResult` en el `catch` externo. Ajustar `include` para traer `paymentMethod`,
  `cashRegister { name, accountId }`, `bankAccount { bankName, accountId }`.
- `src/modules/commercial/features/treasury/features/payment-orders/actions.server.ts` —
  `confirmPaymentOrder` (`:424-769`): ídem (`:454`, `:530`, `:601` a `BusinessError`); mantener el
  `if (!paymentOrder.partnerId)` (seguimiento 8).
- `src/modules/commercial/features/expenses/actions.server.ts` — `confirmExpense` (`:479-560`):
  `ActionResult<{ budgetWarning?: … }>`, `BusinessError` en `:496`, asiento sin `try/catch`;
  la verificación presupuestaria (`:499-525`) no cambia.
- `src/modules/accounting/features/integrations/commercial/index.ts` — `createJournalEntryForReceipt`
  (`:678-811`), `…ForPaymentOrder` (`:819-957`), `…ForExpense` (`:965-1032`) → `Promise<string>`,
  `BusinessError` en guards/`continue`/`lines.length < 2`; `getAccountingSettings` (`:105-106`)
  → `BusinessError`; `select` de pagos con `paymentMethod`, nombres de caja/banco (y lo que
  decida 1.7-1); encabezado del archivo (`:1-36`, "3. Recibo", "4. OP", "5. Gasto").
- Consumidores: `receipts/list/components/_ReceiptsTable.tsx:44-58`,
  `payment-orders/list/components/_PaymentOrdersTable.tsx:53-67`,
  `expenses/list/components/_ExpensesTable.tsx:54-68`,
  `expenses/list/components/_ExpenseDetailModal.tsx:91-116` → `result.success`/`result.error`
  (y `result.budgetWarning` en los dos de gastos).
- `src/modules/accounting/features/settings/components/_CommercialIntegrationForm.tsx:56-258` —
  leer labels desde la constante compartida (alternativa B); nuevos campos si 1.7-1 lo decide.
- `prisma/scripts/diagnose-invoices-without-entry.ts` — agregar RECIBO/OP/GASTO al listado,
  a los totales y al SQL del header (o script hermano `diagnose-documents-without-entry.ts` si
  se prefiere no tocar el de 721; el header ya está referenciado desde `deployment.md:32`).
- `docs/modules/accounting.md:188-195` (tabla período bloqueado, fila "Confirmar recibo/OP/gasto"
  "pendiente de alinear con TSK-721"), `docs/modules/commercial.md:598-628` (tablas "Confirmar
  Recibo de Cobro" / "Confirmar Orden de Pago", agregar Gasto y la columna "si el asiento falla,
  la confirmación se revierte"), `docs/conventions/coding-standards.md:137-140` ("Donde ya se
  usa"), `docs/infrastructure/deployment.md:26-38` (chequeo post-deploy con el SQL de los tres
  tipos).
- Guías in-app: `_TreasuryGuide.tsx:316-319` (recibos, "se genera el asiento contable"),
  `:366-368` (OP), `:737-740` (relación con Contabilidad); `_CommercialGuide.tsx:1109-1190`
  (Gastos → renombrar "Egresos" y explicar que si falta una cuenta no se confirma),
  `:1401-1404`; `_AccountingGuide.tsx:273` ("cada factura, recibo u orden de pago").
- Memoria `errores-negocio-server-actions.md` (dice que recibos/OP/gastos "todavía tragan").

**A crear**

- `src/shared/lib/accounting/accounting-setting-labels.ts` (nombre tentativo; misma idea que
  `shared/lib/assets/asset-account-labels.ts`): `ACCOUNTING_SETTING_LABELS`.
- `src/modules/commercial/shared/settings-accounts.ts` + `.test.ts`: `findMissingSettingsAccounts`,
  `buildMissingSettingsAccountsMessage`.
- `src/modules/commercial/shared/payment-accounts.ts` + `.test.ts`: `resolvePaymentAccount`,
  `buildMissingPaymentAccountMessage` (puro; recibe `{ paymentMethod, amount, cashRegister?,
  bankAccount?, … }` y `settings`).
- Tests de integración (Vitest, `npm run test`; memoria `testing-real-es-vitest-no-cypress`):
  `receipts/receipt-journal-entry.integration.test.ts`,
  `payment-orders/payment-order-journal-entry.integration.test.ts`,
  `expenses/expense-journal-entry.integration.test.ts`. Moldes: andamiaje de
  `purchase-invoice-line-accounts.integration.test.ts` / `sales-invoice-line-accounts.integration.test.ts`
  (los cuatro `vi.mock`, `describe.skipIf(!dbAvailable)`, prefijo por ticket, `afterAll` con
  conteo por prefijo) y `fund-movement-partner-account.integration.test.ts:19-37, :87-171`
  para crear caja con sesión abierta y banco con/sin `accountId`. **Hoy no existe ningún test de
  recibos, OP ni gastos** salvo el puro `payment-orders/shared/pending-invoices.test.ts`.
- Guía de presentación para la clienta (PDF, memoria `guia-presentacion-cliente-por-ticket`):
  `scripts/guia-presentacion/tsk-728.html` + `capturas-tsk728.mjs` → `docs/presentaciones/TSK-728-….pdf`
  (moldes `capturas-tsk721.mjs`, `generar-pdf.mjs`).

### 1.4 Dependencias

- `src/shared/lib/action-result.ts` (`ActionResult`, `BusinessError`, `toActionResult`,
  `UNEXPECTED_ERROR_MESSAGE`) — ya existe (TSK-721).
- `src/shared/lib/accounts/imputable-accounts.ts` (`buildImputableAccountsWhere`) para validar
  que la cuenta resuelta esté activa, sea hoja y vigente, como hace 721 con las de línea.
- `commercial/shared/perceptions.ts:179-193` (`findMissingTributeAccounts`,
  `buildMissingTributeAccountsMessage`) y `line-accounts.ts:54` (`formatAccountLabel`) como
  estilo/reutilización.
- `treasury/shared/validators.ts:325-330` (`WITHHOLDING_TAX_TYPE_LABELS`) y `:470-478`
  (`PAYMENT_METHOD_LABELS`) para nombrar tipo de retención y medio de pago en los mensajes.
- Mensajes de banco/caja sin cuenta de `fund-movements/list/actions.server.ts:353-357`, `:400-404`.
- Permisos existentes (`approve` en los tres confirm; `permissions/constants.ts:42-43, :50`).
  No hay módulos nuevos para `ACTIVATABLE_MODULES` ni features de industria.
- Si 1.7-1 agrega cuentas a `AccountingSettings`: migración Prisma, `settings/validators.ts`
  (+ el test `'cubre las N cuentas configurables'`, `validators.test.ts:76-81`), `getAccountingSettings`
  de `settings/actions.server.ts` y el `include` de `index.ts:86-103`.

### 1.5 Restricciones y reglas

- **Errores de negocio como dato** (`coding-standards.md:87-140`): `BusinessError` en action e
  integración, `toActionResult` en el `catch`, cliente con `result.error`; verificar en build de
  producción (`npm run build && npm run start -- -p 3011`), no solo en dev.
- **Pre-validar fuera de la transacción** (721/724c): que nada se mueva (caja, banco, estado de
  facturas, cheques) si va a fallar por configuración; dentro de la transacción la integración
  es defensa en profundidad.
- **No importar entre módulos** (`module-communication.md`): `accounting/integrations/commercial`
  ↔ `commercial/shared` es el cruce preexistente y admitido (721 §3.1-1); labels compartidos
  van a `src/shared/lib/…`, no a un módulo.
- **Logger, no console; sin `:any`; Decimal → `Number()`** en lo que se devuelva al cliente
  (`budgetWarning.executedPercent` ya es number).
- **Textos en español con acentos**, mensajes que nombran el comprobante (`fullNumber`), la
  cuenta que falta con el label literal de Ajustes y **dónde** cargarla ("Contabilidad →
  Configuración", "en la cuenta bancaria", "en la caja").
- **Testing real es Vitest** (`npm run test`); ignorar la sección Cypress del checklist.
- **Docs + guía in-app + PDF de presentación** con cada cambio visible (reglas 8 y 10, memoria
  `guia-presentacion-cliente-por-ticket`).
- **Componentes < 200 líneas**: los cuatro consumidores cambian ~5 líneas cada uno; los
  `actions.server.ts` de recibos (829), OP (1254) y `index.ts` (1280) ya son deuda previa y
  deben crecer lo mínimo (de ahí los helpers en `shared`).
- **No tocar el diseño de OP a socio ni de movimientos bancarios** (seguimientos 8-11).

### 1.6 Riesgos identificados

1. **Regresión funcional para medios de pago sin cuenta** (1.2.4): recibos con cheque físico,
   OP con cheque propio/endosado o con tarjeta, y "Cuenta corriente" **hoy se confirman** (sin
   asiento) y con el cambio dejarían de confirmarse hasta que exista una cuenta. Es el riesgo
   central y depende de 1.7-1. Mitigación: contar en prod los `payment_method` usados antes de
   diseñar; agregar las cuentas que hagan falta en el mismo ticket; mensaje que diga qué
   configurar.
2. **Recibos/OP sin pagos ni retenciones** (Zod lo permite, `validators.ts:441-444`, `:545-548`):
   hoy `return null`; con el cambio, bloquear o confirmar sin asiento con aviso (1.7-2).
3. **Históricos en producción**: comprobantes ya `CONFIRMED` sin asiento (conteo desconocido,
   dev vacío). Igual que 721: el script lista, la decisión (regenerar con fecha original / asentar
   a mano) es de la clienta y su contador, ticket aparte.
4. **Orden de las validaciones**: la pre-validación necesita `receipt.date` para `atDate` de
   `buildImputableAccountsWhere` y para "período cerrado"; si se valida el período antes de la
   transacción hay que replicar el chequeo de `createJournalEntry:209-212` o dejar que lo lance
   la integración (ya es `BusinessError` y aborta la transacción: alcanza).
5. **`getAccountingSettings` sin configuración** (`index.ts:105-106`) hoy es `Error`: si no se
   cambia a `BusinessError`, la empresa sin Ajustes contables vería el mensaje genérico.
6. **Dos copias de la cadena de resolución** si se elige A: cualquier cuenta nueva (1.7-1) hay
   que agregarla en recibo y OP por separado.
7. **`_CreateReceiptModal.tsx` (875 líneas) y `_CreatePaymentOrderModal.tsx` (1128)** no se
   tocan salvo que 1.7-1 exija campos nuevos en el form (por ejemplo banco de la tarjeta).
8. **Verificación en prod**: la memoria manda comprobar el toast con `npm run build`; el
   `digest` redactado es exactamente lo que se quiere evitar.

### 1.7 Preguntas abiertas

Solo las que cambian el diseño:

1. **¿Qué cuenta lleva cada medio de pago que hoy no tiene ninguna, y entran en este ticket?**
   Opciones por medio (1.2.4):
   - Cheque físico recibido (recibo `CHECK`) → Debe "Cheques de terceros en cartera / Valores a
     depositar": reusar `checksReceivedAccountId` (existe en schema `:624`, sin UI) y darle campo
     en Ajustes. Coherente con `integrations/treasury:242-247`, que ya lo usa como Haber al
     depositar (aunque hoy no se llame).
   - Cheque endosado en OP → Haber la misma cuenta de valores a depositar.
   - Cheque propio en OP (`CHECK`, no e-cheq) → Haber "Cheques propios a pagar / diferidos"
     (pasivo, **campo nuevo**) o directamente el banco (como ya se hace con e-cheq propio,
     `payment-orders:557`).
   - Tarjeta de crédito de empresa → Haber "Tarjetas de crédito a pagar" (pasivo, **campo
     nuevo**); débito de empresa ya va al banco.
   - Tarjeta de socio (débito o crédito) → Haber "Deuda con socios" (pasivo, **campo nuevo**;
     `Partner.contributionsAccountId` es patrimonio, no sirve); la devolución (seguimiento 8)
     la cancelaría.
   - `ACCOUNT` "Cuenta corriente" → no tiene sentido contable en un recibo/OP; propuesta:
     bloquear con «El medio de pago "Cuenta Corriente" no genera asiento; usá otro medio».
   **Recomendación**: contar uso real en prod primero; incluir en este ticket al menos cheques
   (los dos lados) porque es operación cotidiana de tesorería, y decidir tarjetas con la clienta.
   Si se prefiere no agregar cuentas ahora, la alternativa explícita es confirmar **con aviso**
   (`{ success: true, warning: 'Se confirmó sin asiento porque …' }` y `toast.warning`), pero
   eso no cumple el criterio de aceptación literal del ticket para esos casos.
2. **Recibo/OP sin pagos ni retenciones** («se vincula después a movimiento bancario»,
   `validators.ts:441`): ¿bloquear la confirmación («Agregá al menos una forma de pago o una
   retención») o confirmar sin asiento con aviso? Vincular después tampoco genera asiento
   (`bank-movements:858-905`), así que hoy ese flujo nunca contabiliza. Recomendación: bloquear,
   salvo que la clienta use ese flujo.
3. **Efectivo sin caja / transferencia sin banco** (Zod no los exige, `validators.ts:356-357`):
   ¿endurecer el Zod en `receiptPaymentSchema`/`paymentOrderPaymentSchema` (CASH exige
   `cashRegisterId`, TRANSFER/DEBIT_CARD exige `bankAccountId`) además de la pre-validación?
   Recomendación: sí, es una línea por regla y evita crear el borrador inválido; el confirm lo
   valida igual para los borradores ya existentes.

---

## 2. Planificación

Siete fases que implementan la **alternativa B** del análisis (1.2.7) con las decisiones ya
tomadas por el usuario: `confirmReceipt`, `confirmPaymentOrder` y `confirmExpense` pasan al
patrón 721 —**pre-validación antes de `prisma.$transaction`**, integración que lanza
`BusinessError` en vez de `return null`/`continue`, action que devuelve `ActionResult`,
consumidores que leen `result.error`—; los **medios de pago sin cuenta** (cheque físico, cheque
endosado, tarjeta de crédito, tarjeta de socio, "Cuenta Corriente") **no se bloquean ni se les
inventa cuenta**: quedan fuera del asiento con **aviso explícito** antes de confirmar (en el
diálogo) y después (en el resultado, `warnings: string[]` → `toast.warning`); solo **caja y
banco** son obligatorios (pago con `cashRegisterId`/`bankAccountId` sin cuenta resoluble →
`BusinessError` que nombra la caja/banco y dónde configurarla); un asiento que quedaría **de una
sola línea** (ningún pago con cuenta ni retención) se **bloquea**; el **Zod** de recibos y OP
exige caja en `CASH` y banco en `TRANSFER`/`DEBIT_CARD`; el script de diagnóstico de 721 se
**extiende** a recibos, OP y gastos; y hay **un test de integración por módulo** (hoy no existe
ninguno). Los helpers puros (labels de Ajustes en `shared/lib`, resolución de cuenta del pago y
mensajes en `commercial/shared`) se escriben **primero y con TDD**, porque recibo y OP hoy son
copia literal uno del otro y las tres integraciones viven en el mismo archivo. El orden va de
lo puro a lo que muta estado: helpers → recibos → OP → gastos → script → docs → verificación.

**Interpretación necesaria de "siguen sin línea de asiento"** (no reabre la decisión, la hace
ejecutable): si un pago se omite del asiento y la línea de Cuentas por Cobrar/Pagar sigue yendo
por el **total** del comprobante, el asiento queda **descuadrado** y `validateBalance`
(`index.ts:174-186`) lo rechaza; hoy eso es exactamente lo que pasa con un recibo mixto
(caja + cheque) y por eso termina sin asiento. Para que la decisión sea consistente con
"bloquear solo si queda una sola línea", la línea de Cobrar/Pagar va por el **importe
contabilizable** (total − pagos omitidos), de modo que el asiento cuadra con lo que sí tiene
cuenta. Consecuencia contable, que el aviso y el PDF dicen con todas las letras: la cuenta por
cobrar/pagar del cliente/proveedor **queda con ese saldo abierto en contabilidad** hasta que el
ticket de seguimiento (2.4-1) le dé cuenta a cheques/tarjetas y regularice. Si el usuario
prefiere "sin ningún pago omitido → sin asiento entero", es un cambio de dos líneas en el helper
(fase 1) y se anota en la sección 4.

Decisiones tomadas en esta planificación, donde el usuario dejó margen:

- **Labels de Ajustes en `src/shared/lib/accounts/settings-account-labels.ts`** (la carpeta
  `shared/lib/accounts/` ya existe con `imputable-accounts.ts`; no se crea `shared/lib/accounting/`).
  Un solo archivo con los **33** campos `*AccountId` de `commercialIntegrationSchema`
  (`settings/validators.ts:19-54`), no solo los de este ticket: así `_CommercialIntegrationForm`
  puede leer **todos** sus `label` de ahí y `ASSET_ACCOUNT_LABELS.settingLabel`
  (`shared/lib/assets/asset-account-labels.ts:35-49`, TSK-724c) pasa a **referenciar** la misma
  constante en vez de repetir el texto. `_CommercialIntegrationForm.tsx` no exporta nada
  reusable hoy (`SECTIONS` es `const` no exportada en un `'use client'`, `:56`): se cambia solo
  el `label` de cada campo por la constante; `types` y `help` se quedan en el form. Un test en
  `settings/validators.test.ts` garantiza que cada campo `*AccountId` del schema tiene label.
- **Helpers puros en `src/modules/commercial/shared/`** (no en `treasury/shared`): la integración
  (`accounting/…/commercial/index.ts:44-50`) ya importa de `@/modules/commercial/shared/*`
  (`line-accounts`, `perceptions`, `cost-center`), que es el cruce admitido (721 §3.1-1); desde
  `treasury/shared` no hay ningún import previo hacia contabilidad. Dos archivos:
  `settings-accounts.ts` (cuentas requeridas de Ajustes + mensaje) y `payment-accounts.ts`
  (resolución de cuenta del pago, clasificación, avisos).
- **Un loader server-only compartido por recibo y OP** en
  `src/modules/commercial/features/treasury/shared/entry-preflight.ts` (`import 'server-only'`,
  molde `equipment/shared/asset-accounts-loader.ts`): carga settings + pagos con caja/banco/
  tarjeta + retenciones, corre los helpers puros y devuelve `{ error, warnings }`. Lo usan la
  **pre-validación** de los dos confirm y las dos actions de **vista previa** que alimentan el
  diálogo (`getReceiptEntryPreview`, `getPaymentOrderEntryPreview`, con `useQuery` al abrir el
  diálogo, molde `_TerminateEquipmentDialog.tsx:59-63`). Sin esto habría que agregar los pagos al
  `ReceiptListItem`/`PaymentOrderListItem` (`treasury/shared/types.ts:268-284`, `:376-393`), que
  hoy solo traen `_count.payments`, y engordar el listado por una sola pantalla.
- **Imputabilidad de las cuentas resueltas**: la pre-validación también verifica con
  `buildImputableAccountsWhere` (`shared/lib/accounts/imputable-accounts.ts`, sin `atDate`, como
  721 y 724c) que Cobrar/Pagar, la caja/banco resuelta y las cuentas de retención estén activas y
  sean imputables. Es una query más en el loader y un mensaje; sin esto el asiento fallaría con
  el error de Prisma/validación genérico ("Ocurrió un error inesperado"), que es lo que el
  ticket quiere evitar.
- **`CASH` sin `cashRegisterId` y `TRANSFER`/`DEBIT_CARD` (tarjeta de empresa) sin
  `bankAccountId`** en borradores viejos (Zod no lo exigía, `validators.ts:356-357`): se
  **bloquean** en la pre-validación («el pago en Efectivo de $ 1.000,00 no tiene caja asignada.
  Editá el recibo y elegí la caja»), no se tratan como "medio sin cuenta por diseño": hoy
  tampoco mueven caja/banco (`receipts:290`, `payment-orders:517`) y el Zod nuevo los impide
  hacia adelante. En OP, `DEBIT_CARD` con **tarjeta de socio** no lleva banco (la empresa no
  paga, `payment-orders:511-515`): el Zod de OP **no** exige banco en `DEBIT_CARD` (no conoce el
  dueño de la tarjeta, solo `cardId`); lo exige la pre-validación cuando la tarjeta es de la
  empresa. En recibos `DEBIT_CARD` siempre es banco propio → Zod lo exige.
- **Tarjeta de socio se decide antes que la caja/banco** en `resolvePaymentAccount`: el form
  de OP muestra "Cuenta Bancaria" para `DEBIT_CARD` sin mirar el dueño
  (`_CreatePaymentOrderModal.tsx:694-697`), así que un pago con tarjeta de socio puede traer
  `bankAccountId`; hoy la action lo saltea (`:511-515`) pero el asiento lo acreditaría al banco
  de la empresa (`index.ts:886-896`). Con el helper, `card.ownerType === 'PARTNER'` → omitido
  con aviso, aunque tenga banco.
- **`ECHEQ` con banco sigue imputándose al banco** en recibos y OP (comportamiento actual,
  `index.ts:743`), aunque el saldo bancario no se mueva hasta el cobro (`receipts:331`). No se
  cambia acá; queda en 2.4-1 junto con "valores a depositar".
- **OP de devolución a socio (`partnerId`)**: sigue sin asiento por diseño (`payment-orders:722-725`);
  la pre-validación solo corre caja/banco obligatorios (sí mueven plata) y el resultado trae el
  aviso «Las órdenes de pago a socios no generan asiento contable». Sin cambio de diseño (2.4-4).
- **Vista previa en el diálogo bloquea el botón** cuando `error` no es `null`: si ya se sabe
  que va a fallar, no tiene sentido dejar confirmar; el `AlertDialogAction` se deshabilita y el
  motivo se muestra en rojo. Con `warnings` el botón sigue habilitado y el aviso va en ámbar.
- **`confirmExpense` mantiene `budgetWarning` en la rama de éxito** y no suma `warnings`: los
  gastos no tienen pagos, no hay nada que omitir. Tipo: `ActionResult<{ budgetWarning?: {
  message: string; executedPercent: number } }>`.
- **El script de 721 se extiende, no se duplica**: `diagnose-invoices-without-entry.ts` pasa a
  listar VENTA/COMPRA/RECIBO/OP/GASTO; se mantiene el nombre porque `deployment.md:32` ya lo
  referencia, y se actualiza su comentario de cabecera ("comprobantes", no solo facturas).
- **Los tests de integración van al lado de la action que ejercitan** (721):
  `treasury/features/receipts/receipt-journal-entry.integration.test.ts`,
  `treasury/features/payment-orders/payment-order-journal-entry.integration.test.ts`,
  `expenses/expense-journal-entry.integration.test.ts`. Entran por `createReceipt`/
  `createPaymentOrder`/`createExpense` + `confirm*` **reales** (las tres `create` son simples,
  sin AFIP ni numeración externa; molde `fund-movement-partner-account.integration.test.ts`),
  con los cuatro `vi.mock` de `sales-invoice-line-accounts.integration.test.ts:26-32`
  (`importOriginal` en permisos). Las facturas confirmadas que el recibo/OP cobran/pagan se crean
  **directo con Prisma** (molde `cost-center.integration.test.ts:272-300` y `:348-399`).

Testing: **Vitest** (`npm run test` → `vitest run`, `vitest.config.ts` incluye `src/**/*.test.ts`;
memoria `testing-real-es-vitest-no-cypress`). TDD en los helpers puros y el Zod (fase 1, sin
base) y en los tres tests de integración contra la base de dev (fases 2-4): el test se escribe
**antes** del código y se ve rojo. No se testean `.tsx`. Línea base de `npm run check-types`:
**219** errores preexistentes.

### 2.1 Fases de implementación

#### Fase 1: Labels de Ajustes, helpers puros compartidos y Zod (TDD unitario)

- **Objetivo:** una sola fuente para el nombre en pantalla de cada cuenta de Ajustes contables;
  una sola regla, sin base, que dado un pago y los settings diga qué cuenta lleva, si le falta
  una obligatoria o si es un medio sin cuenta por diseño; los mensajes al usuario (falta
  configurar X, caja/banco sin cuenta, pago omitido, asiento de una sola línea) escritos una vez
  y testeados; y el Zod de recibos/OP que impide crear borradores de efectivo sin caja y de
  transferencia/débito sin banco.
- **Tareas:**
  - [x] **Labels (TDD).** En `src/modules/accounting/features/settings/validators.test.ts`
        (`describe('commercialIntegrationSchema')`, junto al caso `'cubre las N cuentas
        configurables'` de `:76-81`) agregar `'cada cuenta configurable tiene label en
        shared/lib/accounts/settings-account-labels'`: `Object.keys(commercialIntegrationSchema.shape)
        .filter((k) => k.endsWith('AccountId'))` debe ser igual (como conjunto) a
        `ACCOUNTING_SETTINGS_ACCOUNT_FIELDS`, y cada label es string no vacío. Rojo: el módulo
        no existe.
  - [x] Crear `src/shared/lib/accounts/settings-account-labels.ts` (sin Prisma, sin React;
        encabezado con el porqué: TSK-728, los mensajes de error deben decir el nombre exacto del
        campo de Ajustes y dos módulos que no se importan —`accounting` y `commercial`— lo
        necesitan). Exportar:
    - `ACCOUNTING_SETTINGS_ACCOUNT_FIELDS = [...] as const` con los 33 nombres exactos de
      `settings/validators.ts:19-54` (`salesAccountId` … `assetDisposalGainLossAccountId`,
      incluidos `bankChargesAccountId`, `internalTaxesAccountId`, percepciones y retenciones).
    - `type AccountingSettingsAccountField = (typeof ACCOUNTING_SETTINGS_ACCOUNT_FIELDS)[number]`.
    - `ACCOUNTING_SETTINGS_ACCOUNT_LABELS: Record<AccountingSettingsAccountField, string>` con
      los textos **literales** de `SECTIONS` (`_CommercialIntegrationForm.tsx:56-258`): 'Cuenta
      de ventas por defecto', 'Cuenta de compras por defecto', 'Cuenta de Gastos Operativos',
      'Cuentas por Cobrar', 'Cuentas por Pagar', 'IVA Débito Fiscal', 'IVA Crédito Fiscal',
      'Caja por Defecto', 'Banco por Defecto', 'Gastos bancarios por defecto', 'Cuenta de
      Resultado del Ejercicio', 'Cuenta de aportes de socios por defecto', 'Ret. IVA Emitida' …
      'Ret. SUSS Sufrida', 'Perc. IVA Cobrada' … 'Perc. Municipal Sufrida', 'Impuestos
      Internos', 'Cuenta de Bienes de Uso por defecto', 'Amortización acumulada por defecto',
      'Gasto de amortización por defecto', 'Resultado por venta/baja de Bienes de Uso'.
    - `ACCOUNTING_SETTINGS_PATH = 'Contabilidad → Configuración'` (el "dónde" de todos los
      mensajes).
    - `settingsAccountLabel(field)` → `"${label}"` (con comillas dobles, como 721 escribe
      `"Cuenta de ventas por defecto"` en sus mensajes).
        Verde.
  - [x] `src/modules/accounting/features/settings/components/_CommercialIntegrationForm.tsx:56-258`:
        cada `label: '…'` de `SECTIONS` pasa a `label: ACCOUNTING_SETTINGS_ACCOUNT_LABELS.<name>`
        (import de `@/shared/lib/accounts/settings-account-labels`). Sin cambio visual: el test
        anterior y una lectura de la pantalla lo confirman.
  - [x] `src/shared/lib/assets/asset-account-labels.ts:35-49`: `settingLabel` de las tres
        cuentas pasa a `ACCOUNTING_SETTINGS_ACCOUNT_LABELS.fixedAssetAccountId` /
        `.accumulatedDepreciationAccountId` / `.depreciationExpenseAccountId`. Los tests de
        `equipment/shared/asset-accounts.test.ts` (mensajes literales) siguen verdes porque el
        texto es el mismo.
  - [x] **Cuentas requeridas de Ajustes (TDD).** Escribir primero
        `src/modules/commercial/shared/settings-accounts.test.ts` (estilo `perceptions.test.ts`):
    - `findMissingSettingsAccounts({ receivablesAccountId: 'X', withholdingIibbSufferedAccountId:
      null }, ['receivablesAccountId', 'withholdingIibbSufferedAccountId'])` →
      `['withholdingIibbSufferedAccountId']`; cadena vacía `''` cuenta como faltante; sin
      faltantes → `[]`; conserva el orden de `required`.
    - `withholdingSettingsField('IIBB', 'suffered')` → `'withholdingIibbSufferedAccountId'`;
      `('GANANCIAS', 'emitted')` → `'withholdingGananciasEmittedAccountId'` (los cuatro tipos ×
      dos roles).
    - `buildMissingSettingsAccountsMessage('el recibo R-00012', ['receivablesAccountId',
      'withholdingIibbSufferedAccountId'])` → contiene `No se puede confirmar el recibo R-00012`,
      `falta configurar "Cuentas por Cobrar" y "Ret. IIBB Sufrida"`, `en Contabilidad →
      Configuración`; con un solo campo no dice "y"; con tres usa `"A", "B" y "C"`.
        Rojo primero.
  - [x] Crear `src/modules/commercial/shared/settings-accounts.ts` (puro, < 80 líneas; importa
        solo de `@/shared/lib/accounts/settings-account-labels`). Exportar
        `type SettingsAccountIds = Partial<Record<AccountingSettingsAccountField, string | null>>`
        (el registro de `AccountingSettings` de Prisma entra tal cual),
        `findMissingSettingsAccounts(settings, required): AccountingSettingsAccountField[]`
        (con `||`, documentado, para tratar `''` como ausente),
        `withholdingSettingsField(taxType: 'IVA' | 'GANANCIAS' | 'IIBB' | 'SUSS', role:
        'emitted' | 'suffered')` (reemplaza el mapa privado `getWithholdingAccountId` de
        `index.ts:148-171`, que pasa a usarlo), y `buildMissingSettingsAccountsMessage(
        documentLabel, missing)`. Verde.
  - [x] **Resolución de cuenta del pago (TDD).** Escribir primero
        `src/modules/commercial/shared/payment-accounts.test.ts`. Casos (mínimo 16):
    - `resolvePaymentAccount` con `cashRegisterId` y `cashRegister.accountId: 'C'` → `{ kind:
      'resolved', accountId: 'C', source: 'cashRegister' }`; sin cuenta propia y
      `settings.defaultCashAccountId: 'DC'` → `source: 'defaultCash'`; sin ninguna → `{ kind:
      'missing', via: 'cashRegister' }`. Ídem banco (`bankAccount.accountId`, `defaultBank`,
      `via: 'bankAccount'`). La caja gana sobre el banco si vinieran los dos (copia del orden
      actual `index.ts:740-750`).
    - `card: { ownerType: 'PARTNER' }` con `bankAccountId` y banco con cuenta → `{ kind:
      'omitted', reason: 'PARTNER_CARD' }` (nunca `resolved`).
    - Sin caja ni banco: `CASH` → `{ kind: 'missing', via: 'noCashRegister' }`; `TRANSFER` y
      `DEBIT_CARD` (tarjeta de empresa o sin tarjeta) → `{ kind: 'missing', via:
      'noBankAccount' }`; `CHECK` con `checkNumber` → `omitted/CHECK`; `CHECK`/`ECHEQ` con
      `endorsedCheckId` → `omitted/ENDORSED_CHECK`; `CREDIT_CARD` → `omitted/CREDIT_CARD`;
      `ACCOUNT` → `omitted/ACCOUNT`.
    - `classifyPayments(payments, settings)` → `{ resolved: [{ payment, accountId, source }],
      missing: [{ payment, via }], omitted: [{ payment, reason }] }`, conservando orden y objeto
      original (genérico `T extends PaymentAccountCheck`); `omittedAmount` = suma de `amount`
      de los omitidos.
    - `describePayment({ paymentMethod: 'CHECK', amount: 1000, checkNumber: '123' })` →
      `Cheque N° 123 por $ 1.000,00`; `TRANSFER` con banco → `Transferencia (Banco Galicia
      123-456) por $ …`; `CASH` con caja → `Efectivo (Caja principal) por $ …`; `CREDIT_CARD`
      con `card.name` → `Tarjeta de Crédito (Visa Galicia Empresa) por $ …`. Usa
      `PAYMENT_METHOD_LABELS` copiado **literal** (no se importa de `treasury/shared/validators`:
      `commercial/shared` no debe depender de una feature) y formato `es-AR` de
      `formatCurrency` (`shared/utils/formatters.ts:152`).
    - `buildMissingPaymentAccountMessage('el recibo R-00012', { via: 'cashRegister', payment })`
      → `No se puede confirmar el recibo R-00012: la caja "Caja principal" no tiene cuenta
      contable asociada. Configurala en Tesorería → Cajas o definí la "Caja por Defecto" en
      Contabilidad → Configuración.`; `via: 'bankAccount'` → `la cuenta bancaria "Banco Galicia
      123-456" … Tesorería → Cuentas Bancarias … "Banco por Defecto" …` (mismo texto que
      fund-movements `:353-357`, `:400-404`, más el label real); `via: 'noCashRegister'` → `el
      pago en Efectivo de $ 1.000,00 no tiene caja asignada. Editá el comprobante y elegí la
      caja.`; `via: 'noBankAccount'` → `… no tiene cuenta bancaria asignada. Editá … y elegí la
      cuenta bancaria.`
    - `buildOmittedPaymentWarning({ payment, reason }, 'receipt')` → `Cheque N° 123 por
      $ 1.000,00 no genera línea en el asiento contable: los cheques todavía no tienen cuenta
      asignada en el sistema. Ese importe queda pendiente en Cuentas por Cobrar hasta que se
      regularice.` (`'paymentOrder'` → `Cuentas por Pagar`; `PARTNER_CARD` → `… la tarjeta es de
      un socio y la empresa no mueve fondos ahora`; `ACCOUNT` → `… "Cuenta Corriente" no
      representa un movimiento de fondos`).
    - `buildSingleLineEntryMessage('el recibo R-00012', 'receipt', omitted)` → `No se puede
      confirmar el recibo R-00012: ningún pago genera línea contable (Cheque N° 123 por
      $ 1.000,00) y no hay retenciones, así que el asiento quedaría con una sola línea. Agregá
      un pago en efectivo, transferencia o e-cheq, o una retención.` (OP: `… un pago en
      efectivo, transferencia, débito de la empresa o e-cheq …`).
    - `buildPartnerOrderWarning()` → `Las órdenes de pago a socios no generan asiento contable.`
        Rojo primero.
  - [x] Crear `src/modules/commercial/shared/payment-accounts.ts` (puro, < 180 líneas; importa
        `formatCurrency` de `@/shared/utils/formatters`, `settingsAccountLabel`/
        `ACCOUNTING_SETTINGS_PATH` de `shared/lib/accounts/settings-account-labels` y el tipo
        `PaymentMethod` de `@/generated/prisma/enums`). Exportar:
    - `interface PaymentAccountCheck { paymentMethod: PaymentMethod; amount: number;
      cashRegisterId: string | null; bankAccountId: string | null; checkNumber?: string | null;
      endorsedCheckId?: string | null; cashRegister?: { name: string; accountId: string | null }
      | null; bankAccount?: { bankName: string; accountNumber: string; accountId: string | null }
      | null; card?: { name: string; ownerType: 'COMPANY' | 'PARTNER' } | null }`.
    - `interface PaymentAccountSettings { defaultCashAccountId?: string | null;
      defaultBankAccountId?: string | null }`.
    - `type PaymentAccountResolution = { kind: 'resolved'; accountId; source: 'cashRegister' |
      'bankAccount' | 'defaultCash' | 'defaultBank' } | { kind: 'missing'; via: 'cashRegister' |
      'bankAccount' | 'noCashRegister' | 'noBankAccount' } | { kind: 'omitted'; reason:
      'PARTNER_CARD' | 'CHECK' | 'ENDORSED_CHECK' | 'CREDIT_CARD' | 'ACCOUNT' }`.
    - `resolvePaymentAccount(payment, settings)`, `classifyPayments(payments, settings)`,
      `describePayment(payment)`, `buildMissingPaymentAccountMessage(documentLabel, missing)`,
      `buildOmittedPaymentWarning(omitted, kind: 'receipt' | 'paymentOrder')`,
      `buildSingleLineEntryMessage(documentLabel, kind, omitted)`, `buildPartnerOrderWarning()`,
      `type EntryDocumentKind = 'receipt' | 'paymentOrder'`.
        Encabezado con el porqué (TSK-728: una sola cadena de resolución para recibo y OP; qué
        medios no tienen cuenta y por qué se omiten con aviso en vez de bloquear; la línea de
        Cobrar/Pagar va por el importe contabilizable). Verde.
  - [x] **Zod (TDD).** Crear `src/modules/commercial/features/treasury/shared/validators.test.ts`
        (no existe ninguno): `receiptPaymentSchema` rechaza `CASH` sin `cashRegisterId` (issue
        en `path: ['cashRegisterId']`, mensaje `'Debe seleccionar la caja'`), rechaza `TRANSFER`
        y `DEBIT_CARD` sin `bankAccountId` (`'Debe seleccionar la cuenta bancaria'`), acepta
        `CHECK` con datos de cheque y sin banco, sigue exigiendo banco en `ECHEQ` (`:421-423`);
        `paymentOrderPaymentSchema` rechaza `CASH` sin caja y `TRANSFER` sin banco, **acepta**
        `DEBIT_CARD` con `cardId` y sin banco (tarjeta de socio), acepta `CHECK` propio sin
        banco y `checkOwnership: 'THIRD_PARTY'` con `endorsedCheckId`. Rojo primero.
  - [x] `src/modules/commercial/features/treasury/shared/validators.ts`: agregar
        `refineFundsSourcePayment(data, ctx, { requireBankForDebitCard })` después de
        `refineCheckPayment` (`:383-424`): `CASH && !cashRegisterId` → issue; `TRANSFER &&
        !bankAccountId` → issue; `DEBIT_CARD && requireBankForDebitCard && !bankAccountId` →
        issue. Llamarla en `receiptPaymentSchema` (`:427-429`, `requireBankForDebitCard: true`)
        y en `paymentOrderPaymentSchema` (`:527-533`, `false`). Actualizar el comentario de
        `:441` y `:545` («Sin pagos ni retenciones es válido…»): sigue siendo válido crear el
        borrador, pero **la confirmación lo rechaza** (fase 2/3). Verde.
  - [x] Comprobar en `_CreateReceiptModal.tsx:487-539` y `_CreatePaymentOrderModal.tsx:669-720`
        que los `FormMessage` de `cashRegisterId`/`bankAccountId` ya existen (sí: cada `FormField`
        tiene el suyo), así el error nuevo se ve sin tocar los forms (875 y 1128 líneas, deuda
        previa; riesgo 1.6-7).
- **Archivos:**
  - Crear: `src/shared/lib/accounts/settings-account-labels.ts`,
    `src/modules/commercial/shared/settings-accounts.ts`, `settings-accounts.test.ts`,
    `src/modules/commercial/shared/payment-accounts.ts`, `payment-accounts.test.ts`,
    `src/modules/commercial/features/treasury/shared/validators.test.ts`
  - Modificar: `src/modules/accounting/features/settings/validators.test.ts`,
    `src/modules/accounting/features/settings/components/_CommercialIntegrationForm.tsx`,
    `src/shared/lib/assets/asset-account-labels.ts`,
    `src/modules/commercial/features/treasury/shared/validators.ts`
- **Criterio de completitud:** `npm run test` en verde con los cuatro tests nuevos/ampliados
  (primero rojos), `asset-accounts.test.ts` y `validators.test.ts` de settings sin regresión;
  ninguno de los dos helpers importa de `@/modules/*` ni de Prisma; `check-types` en 219; en
  `/dashboard/company/accounting/settings` los labels se ven idénticos; en el modal de recibo,
  elegir Efectivo sin caja y guardar muestra "Debe seleccionar la caja".

#### Fase 2: Recibos de cobro — loader compartido, pre-validación, asiento que lanza, `ActionResult` con avisos (TDD de integración)

- **Objetivo:** que ningún recibo quede `CONFIRMED` sin asiento por una cuenta faltante: la
  confirmación se rechaza **antes** de la transacción con un mensaje que nombra la cuenta de
  Ajustes, la caja/banco o la retención; los pagos con medios sin cuenta se **omiten con
  aviso** (en el diálogo y en el toast); un recibo cuyo asiento quedaría de una sola línea se
  bloquea; cualquier otro fallo del asiento revierte la transacción y llega legible en
  producción. Esta fase crea el loader que la fase 3 reutiliza.
- **Tareas:**
  - [x] **Test de integración (rojo primero).** Crear
        `src/modules/commercial/features/treasury/features/receipts/receipt-journal-entry.integration.test.ts`
        con el andamiaje de `sales-invoice-line-accounts.integration.test.ts:19-45` (`dotenv/
        config`, los cuatro `vi.mock` con `importOriginal` en permisos, `describe.skipIf(!dbAvailable)`),
        prefijo `TSK728-REC-`. `beforeAll`: empresa; cuentas `Cobrar` (ASSET), `Caja` (ASSET),
        `Banco` (ASSET), `Ret IIBB Sufrida` (ASSET), `Caja vieja` (ASSET, se dará de baja);
        `AccountingSettings` con `receivablesAccountId: Cobrar`, `withholdingIibbSufferedAccountId`
        y `defaultCashAccountId`/`defaultBankAccountId` **vacíos**; cliente (`prisma.contractor.create`,
        molde `sales-invoice-line-accounts…:187`); `CashRegister` "Caja principal" con `accountId:
        Caja` + `CashRegisterSession` `OPEN` (`sessionNumber: 1`, `openedBy`), `CashRegister`
        "Caja vieja" con `accountId: Caja vieja` + sesión; `BankAccount` "Banco con cuenta"
        (`accountId: Banco`) y "Banco sin cuenta" (`accountId: null`) (molde
        `fund-movement-partner-account…:126-137`); facturas de venta `CONFIRMED` creadas directo
        con Prisma (molde `cost-center.integration.test.ts:348-399`, una por caso, `total` 1000).
        Los recibos se crean con el **`createReceipt` real** (`CreateReceiptFormData`: montos como
        string, `items: [{ invoiceId, amount: '1000' }]`) y se confirman con **`confirmReceipt`
        real**. Helper `fetchEntryLines(receiptId)` (molde `fetchEntryLinesForMovement`). Casos:
    1. Efectivo en "Caja principal" → `{ success: true, warnings: [] }`; asiento con Debe `Caja`
       1000 / Haber `Cobrar` 1000; factura `PAID`; `CashMovement INCOME`.
    2. Transferencia a "Banco sin cuenta" sin `defaultBankAccountId` → `{ success: false }`,
       `error` contiene `la cuenta bancaria "Banco sin cuenta` y `"Banco por Defecto"`; el recibo
       sigue `DRAFT`, `journalEntryId: null`, la factura sigue `CONFIRMED`, **sin**
       `BankMovement` ni cambio de `balance`.
    3. Mismo recibo tras `update defaultBankAccountId: Banco` → confirma; Debe `Banco`.
    4. `receivablesAccountId: null` → `error` contiene `falta configurar "Cuentas por Cobrar"` y
       `Contabilidad → Configuración`; restaurar.
    5. Retención `GANANCIAS` (sin `withholdingGananciasSufferedAccountId`) + efectivo →
       `error` contiene `"Ret. Ganancias Sufrida"`; con `IIBB` (configurada) → confirma con Debe
       `Ret IIBB Sufrida` 100 + Debe `Caja` 900 / Haber `Cobrar` 1000.
    6. Cheque físico 400 + efectivo 600 → `success: true`, `warnings[0]` contiene `Cheque N°` y
       `no genera línea`; asiento **de dos líneas**: Debe `Caja` 600 / Haber `Cobrar` **600**;
       `Check THIRD_PARTY PORTFOLIO` creado; factura `PAID`.
    7. Solo cheque físico 1000 → `success: false`, `error` contiene `una sola línea`; `DRAFT`,
       sin `Check` creado.
    8. Sin pagos ni retenciones (Zod lo permite) → `error` contiene `una sola línea` / `Agregá
       un pago`.
    9. Efectivo en "Caja vieja" tras `prisma.account.update({ isActive: false })` → `error`
       nombra la cuenta (`code - name`) y `no está activa o no es imputable`; restaurar.
    10. Caja sin sesión abierta (cerrar la sesión de "Caja principal") → `{ success: false,
        error: 'No hay sesión abierta para la caja "Caja principal"' }` (hoy `Error` genérico,
        `:302`); reabrir.
    11. `lockedUntilDate` en el futuro → `error` con `período está cerrado`; `DRAFT`, sin
        `CashMovement` (la transacción se revirtió); restaurar.
    12. Confirmar dos veces → `{ success: false, error: 'Recibo no encontrado o ya confirmado' }`.
    13. `getReceiptEntryPreview(id)` del caso 6 antes de confirmar → `{ error: null, warnings:
        [/Cheque N°/] }`; del caso 2 → `{ error: /Banco sin cuenta/ }`.
        `afterAll`: `check → cashMovement → cashRegisterSession → cashRegister → bankMovement →
        bankAccount → receiptWithholding/receiptPayment/receiptItem → receipt → journalEntryLine/
        journalEntry → salesInvoice → contractor → accountingSettings → account → company` por
        `companyId`, y `count` 0 por prefijo en `company`, `account`, `receipt`.
  - [x] **Loader compartido.** Crear
        `src/modules/commercial/features/treasury/shared/entry-preflight.ts` (`import
        'server-only'`, **sin** `'use server'`; molde `equipment/shared/asset-accounts-loader.ts:1-30`).
        Importa `prisma`, `BusinessError`, `buildImputableAccountsWhere`, los helpers de
        `@/modules/commercial/shared/settings-accounts` y `payment-accounts`, y
        `formatAccountLabel` de `commercial/shared/line-accounts`. Exportar:
    - `interface EntryPreflight { documentLabel: string; error: string | null; warnings:
      string[] }` (serializable: lo devuelven las actions de vista previa).
    - `loadReceiptEntryPreflight(companyId, receiptId, client = prisma): Promise<EntryPreflight>`:
      `receipt.findFirst({ where: { id, companyId }, select: { fullNumber, status, date, payments:
      { select: { paymentMethod, amount, cashRegisterId, bankAccountId, checkNumber, cashRegister:
      { select: { name, accountId } }, bankAccount: { select: { bankName, accountNumber, accountId
      } } } }, withholdings: { select: { taxType, amount } } } })` → no encontrado → `error:
      'Recibo no encontrado'`; `status !== 'DRAFT'` → `error: 'Recibo no encontrado o ya
      confirmado'`. `accountingSettings.findUnique` con `select` de `receivablesAccountId`,
      `defaultCashAccountId`, `defaultBankAccountId` y las 4 `withholding*SufferedAccountId`; sin
      settings → `error: 'No se encontró configuración contable para la empresa. Configurala en
      Contabilidad → Configuración.'`. Orden de chequeos (el primero que falla es el `error`):
      (a) `findMissingSettingsAccounts(settings, ['receivablesAccountId', ...withholdings.map(w =>
      withholdingSettingsField(w.taxType, 'suffered'))])` → `buildMissingSettingsAccountsMessage`;
      (b) `classifyPayments(payments, settings)`: si `missing.length` →
      `buildMissingPaymentAccountMessage(label, missing[0])`; (c) si `resolved.length === 0 &&
      withholdings.length === 0` → `buildSingleLineEntryMessage`; (d) imputabilidad: una
      `account.findMany({ where: { ...buildImputableAccountsWhere({ companyId }), id: { in:
      [receivables, ...resolved.map(r => r.accountId), ...withholdingAccounts] } }, select: { id }
      })` + una `account.findMany({ where: { id: { in } }, select: { id, code, name } })` para el
      label; la primera no imputable → `error: 'No se puede confirmar el recibo R-00012: la cuenta
      1.1.1/01 - Caja (de la caja "Caja principal" | configurada como "Caja por Defecto" |
      configurada como "Cuentas por Cobrar") no está activa o no es imputable. Corregila en
      (Tesorería → Cajas | Contabilidad → Configuración).'`. `warnings` = `omitted.map(o =>
      buildOmittedPaymentWarning(o, 'receipt'))`. `documentLabel` = `` `el recibo ${fullNumber}` ``.
    - `assertEntryPreflight(preflight): string[]` → si `error` lanza `new BusinessError(error)`;
      devuelve `warnings`.
    - `loadPaymentOrderEntryPreflight` se agrega en la fase 3 (dejar el archivo preparado con
      un `select` de pagos común: `PAYMENT_SELECT`).
        Sin test unitario propio: lo cubren los tests de integración (fases 2 y 3).
  - [x] **`confirmReceipt`** (`receipts/actions.server.ts:219-433`):
    - Firma → `Promise<ActionResult<{ id: string; warnings: string[] }>>`; imports de
      `ActionResult`, `BusinessError`, `toActionResult` (`@/shared/lib/action-result`) y
      `loadReceiptEntryPreflight`/`assertEntryPreflight` (`../../shared/entry-preflight`).
    - `:247` → `throw new BusinessError('Recibo no encontrado o ya confirmado')`.
    - Entre el `findFirst` y `prisma.$transaction` (`:250`): `const warnings =
      assertEntryPreflight(await loadReceiptEntryPreflight(companyId, receiptId));` con
      comentario `// TSK-728: pre-validación fuera de la transacción: nada se mueve si va a
      fallar por configuración`.
    - `:301-303` → `throw new BusinessError(\`No hay sesión abierta para la caja
      "${payment.cashRegister?.name ?? 'seleccionada'}"\`)`; para tener el nombre, el `include`
      (`:236-244`, `payments: true` en `:241`) cambia `payments: true` por `payments: { include: { cashRegister: { select: {
      name: true } } } }` (solo eso: la pre-validación ya cargó lo demás).
    - Reemplazar `:391-414` por `const journalEntryId = await createJournalEntryForReceipt(
      receiptId, companyId, tx); await tx.receipt.update({ where: { id: receiptId }, data: {
      journalEntryId } }); logger.info(…)`. **Sin `try/catch`** y sin `if (journalEntryId)`.
      Comentario: `// TSK-728: antes solo se relanzaba "período cerrado" y cualquier otro fallo
      dejaba el recibo confirmado sin asiento.`
    - `:423` → `return { success: true, id: receiptId, warnings }`.
    - `catch` externo (`:426-432`) → `if (error instanceof BusinessError) logger.warn(…) ; return
      toActionResult(error, 'Error al confirmar recibo')` (como `confirmInvoice`).
  - [x] **Integración** `createJournalEntryForReceipt` (`accounting/…/commercial/index.ts:678-811`):
    - Firma → `Promise<string>`. Import de `classifyPayments`, `buildMissingPaymentAccountMessage`,
      `buildSingleLineEntryMessage` (`@/modules/commercial/shared/payment-accounts`) y
      `findMissingSettingsAccounts`, `buildMissingSettingsAccountsMessage`,
      `withholdingSettingsField` (`…/settings-accounts`).
    - Guard `:686-692` → `throw new BusinessError(buildMissingSettingsAccountsMessage(\`el recibo
      ${fullNumber}\`, ['receivablesAccountId']))` (hay que mover el `findUnique` del recibo antes
      del guard para tener el `fullNumber`, o usar `receiptId` en el mensaje; preferir mover).
    - `select` de `payments` (`:702-710`) suma `paymentMethod`, `checkNumber`, `cashRegister:
      { select: { name, accountId } }`, `bankAccount: { select: { bankName, accountNumber,
      accountId } }`.
    - Reemplazar el bucle `:736-770` por `const { resolved, missing, omitted } =
      classifyPayments(receipt.payments.map(p => ({ ...p, amount: Number(p.amount) })), settings)`;
      `if (missing.length) throw new BusinessError(buildMissingPaymentAccountMessage(label,
      missing[0]))`; líneas Debe por cada `resolved` (descripción según `source`: `Cobro en
      efectivo` / `Cobro bancario`); `const omittedAmount = sum(omitted)`.
    - Haber Cuentas por Cobrar (`:727-733`): `credit: total - omittedAmount` con comentario
      `// TSK-728: los pagos de medios sin cuenta (cheque, tarjeta, cuenta corriente) no entran
      al asiento; la cuenta por cobrar queda con ese saldo hasta regularizar (ver 2.4-1)`.
    - Retenciones `:774-779` → `throw new BusinessError(buildMissingSettingsAccountsMessage(label,
      [withholdingSettingsField(withholding.taxType, 'suffered')]))`; `getWithholdingAccountId`
      (`:148-171`) pasa a `settings[withholdingSettingsField(taxType, role)] ?? null`.
    - `lines.length < 2` (`:789-794`) → `throw new BusinessError(buildSingleLineEntryMessage(
      label, 'receipt', omitted))`.
    - `:722` → `BusinessError('Recibo de cobro no encontrado')`.
    - `getAccountingSettings` (`:105-106`) → `throw new BusinessError('No se encontró
      configuración contable para la empresa. Configurala en Contabilidad → Configuración.')`
      (1.2.5-7; beneficia a facturas también).
    - Encabezado (`:24-26`, "3. Recibo de Cobro"): `Debe: caja/banco de cada pago (cuenta
      propia o "Caja/Banco por Defecto") + retenciones sufridas / Haber: Cuentas por Cobrar por
      el importe contabilizable. Los pagos con cheque, tarjeta o cuenta corriente no generan
      línea (aviso al usuario, TSK-728). Pre-validado en confirmReceipt; acá defensa en
      profundidad.`
  - [x] **Vista previa.** En `receipts/actions.server.ts` agregar `export async function
        getReceiptEntryPreview(receiptId: string): Promise<EntryPreflight>` con
        `checkPermission('commercial.treasury.receipts', 'approve', { redirect: true })` (es el
        mismo permiso que confirmar), `getActiveCompanyId`, `return loadReceiptEntryPreflight(
        companyId, receiptId)` (no lanza: devuelve `error` como dato). JSDoc: alimenta el
        diálogo de confirmación.
  - [x] **Aviso en el diálogo.** Crear
        `src/modules/commercial/features/treasury/shared/components/_EntryPreviewNotice.tsx`
        (Client Component, < 60 líneas, molde `equipment/shared/components/_TerminateEntryNotice.tsx`
        con `Alert` de shadcn e íconos `AlertTriangle`/`Info`). Props `{ preview: EntryPreflight
        | undefined; isLoading: boolean }`. Estados: cargando → texto gris "Verificando cuentas
        contables…"; `error` → `Alert variant="destructive"` con el mensaje y el título "No se va
        a poder confirmar"; `warnings.length` → `Alert` ámbar "Pagos que no generan asiento
        contable" con una viñeta por aviso; sin nada → no renderiza.
  - [x] **`_ReceiptsTable.tsx`** (`receipts/list/components/_ReceiptsTable.tsx`, 211 líneas):
    - `handleConfirm` (`:44-58`) → `try/finally`: `const result = await confirmReceipt(id); if
      (!result.success) { toast.error(result.error); return; } toast.success('Recibo confirmado
      correctamente'); if (result.warnings.length) toast.warning('El recibo se confirmó con
      avisos contables', { description: result.warnings.join(' '), duration: 10000 });
      router.refresh();` (patrón `_InvoicesTable.tsx`; el `finally` conserva el reset de estado).
    - `useQuery({ queryKey: ['receiptEntryPreview', selectedReceiptId], queryFn: () =>
      getReceiptEntryPreview(selectedReceiptId!), enabled: confirmDialogOpen && !!selectedReceiptId })`
      (`@tanstack/react-query`, molde `_TerminateEquipmentDialog.tsx:59-63`); tras confirmar,
      `queryClient.invalidateQueries({ queryKey: ['receiptEntryPreview'] })`.
    - `AlertDialog` (`:155-171`): debajo de la descripción, `<_EntryPreviewNotice preview={…}
      isLoading={…} />`; la descripción pasa a «Al confirmar el recibo se registrarán los
      movimientos de caja/banco, se actualizará el estado de las facturas y se generará el
      asiento contable. Esta acción no se puede deshacer.»; `AlertDialogAction` con
      `disabled={isConfirming || previewQuery.isLoading || !!previewQuery.data?.error}`.
      Si el archivo supera 200 líneas, extraer el diálogo a `_ConfirmReceiptDialog.tsx` en la
      misma carpeta.
  - [x] Revisar que nada más consuma `confirmReceipt` (grep: solo `_ReceiptsTable`; `index.ts`
        re-exporta `actions.server`).
- **Archivos:**
  - Crear: `receipts/receipt-journal-entry.integration.test.ts`,
    `treasury/shared/entry-preflight.ts`, `treasury/shared/components/_EntryPreviewNotice.tsx`
    (bajo `src/modules/commercial/features/treasury/`)
  - Modificar: `src/modules/commercial/features/treasury/features/receipts/actions.server.ts`,
    `src/modules/commercial/features/treasury/features/receipts/list/components/_ReceiptsTable.tsx`,
    `src/modules/accounting/features/integrations/commercial/index.ts` (encabezado,
    `getAccountingSettings`, `getWithholdingAccountId`, `createJournalEntryForReceipt`)
- **Criterio de completitud:** `npm run test` en verde con los 13 casos (primero rojos) y sin
  regresión en `cost-center`, `perceptions`, `sales-invoice-line-accounts`,
  `purchase-invoice-line-accounts` y `purchase-invoice-tributes` (los tests que ya configuran
  `receivablesAccountId` y no crean recibos no se ven afectados); en la app, confirmar un recibo
  con banco sin cuenta muestra el toast con el nombre del banco y el recibo sigue en borrador;
  con cheque + efectivo el diálogo lista el cheque antes de confirmar y el toast ámbar después;
  ningún `logger.warn('No se pudo generar asiento contable para recibo')` ni `return null` queda
  en la integración del recibo; `check-types` en 219.

#### Fase 3: Órdenes de pago — espejo de recibos (TDD de integración)

- **Objetivo:** lo mismo que la fase 2 para `confirmPaymentOrder`: `payablesAccountId` y
  retenciones **emitidas** obligatorias; caja/banco con cuenta; cheque propio, cheque endosado,
  tarjeta de crédito, tarjeta de socio y cuenta corriente omitidos con aviso; asiento de una
  sola línea bloqueado; OP a socio sin asiento por diseño pero con aviso en el resultado.
- **Tareas:**
  - [x] **Test de integración (rojo primero).** Crear
        `src/modules/commercial/features/treasury/features/payment-orders/payment-order-journal-entry.integration.test.ts`,
        mismo andamiaje, prefijo `TSK728-OP-`. `beforeAll`: cuentas `Pagar` (LIABILITY), `Caja`,
        `Banco`, `Ret IIBB Emitida` (LIABILITY); settings con `payablesAccountId`,
        `withholdingIibbEmittedAccountId`, defaults vacíos; proveedor (`prisma.supplier.create`,
        molde `cost-center.integration.test.ts:171`); caja con sesión abierta y cuenta; bancos con y
        sin cuenta; tarjeta `Card` de empresa (`ownerType: 'COMPANY'`, `cardType: 'CREDIT'`) y
        tarjeta de socio (`Partner` + `Card` `ownerType: 'PARTNER'`, `cardType: 'DEBIT'`); un
        cheque de tercero en cartera (`Check THIRD_PARTY PORTFOLIO`) para endosar; facturas de
        compra `CONFIRMED` directas con Prisma (molde `cost-center…:272-300`). OP con
        **`createPaymentOrder` real** + **`confirmPaymentOrder` real**. Casos:
    1. Efectivo → `{ success: true, warnings: [] }`; Debe `Pagar` 1000 / Haber `Caja` 1000;
       factura `PAID`; `CashMovement EXPENSE`.
    2. Transferencia a banco sin cuenta ni default → `error` con `"Banco sin cuenta` y `"Banco
       por Defecto"`; `DRAFT`, sin `BankMovement`.
    3. `payablesAccountId: null` → `error` con `"Cuentas por Pagar"`; restaurar.
    4. Retención `GANANCIAS` sin cuenta emitida → `error` con `"Ret. Ganancias Emitida"`; con
       `IIBB` → Haber `Ret IIBB Emitida` 100 + Haber `Caja` 900 / Debe `Pagar` 1000.
    5. Cheque propio 400 + efectivo 600 → `success`, `warnings[0]` con `Cheque N°`; asiento
       Debe `Pagar` **600** / Haber `Caja` 600; `Check OWN DELIVERED` creado.
    6. Cheque de tercero endosado 1000 (`checkOwnership: 'THIRD_PARTY'`, `endorsedCheckId`) →
       `success: false`, `error` con `una sola línea`; el cheque sigue `PORTFOLIO`.
    7. Tarjeta de crédito de empresa 1000, 3 cuotas → `error` con `una sola línea`; sin
       `PaymentOrderInstallment` creadas.
    8. Tarjeta de débito de **socio** con `bankAccountId` del banco con cuenta 400 + efectivo
       600 → `success`, `warnings[0]` con `tarjeta es de un socio`; asiento Debe `Pagar` 600 /
       Haber `Caja` 600 — **ninguna línea en `Banco`**; `PaymentOrderInstallment` del socio
       creada; sin `BankMovement`.
    9. Tarjeta de débito de **empresa** sin `bankAccountId` → `error` con `no tiene cuenta
       bancaria asignada` (pre-validación; Zod de OP no lo exige).
    10. OP de devolución a socio (`createPartnerRepaymentOrder` real, molde `payment-orders:206-305`,
        con la cuota del caso 8) pagada en efectivo → `success: true`, `warnings` contiene `Las
        órdenes de pago a socios no generan asiento contable`; `journalEntryId: null`;
        `CashMovement` creado; cuota `PAID`.
    11. Caja sin sesión → `error: 'No hay sesión abierta para la caja "…"'`.
    12. Período cerrado → legible y revertido.
    13. Confirmar dos veces → `'Orden de pago no encontrada o ya confirmada'`.
    14. `getPaymentOrderEntryPreview` del caso 5 → `warnings` con el cheque; del caso 2 → `error`.
        `afterAll` en orden inverso (`paymentOrderInstallment`, `cashflowProjection`, `check`,
        `cashMovement`, sesiones, cajas, `bankMovement`, bancos, `card`, `partner`, pagos/items/
        retenciones de OP, `paymentOrder`, asientos, `purchaseInvoice`, `supplier`, settings,
        cuentas, empresa) y `count` 0 por prefijo.
  - [x] **Loader.** En `treasury/shared/entry-preflight.ts` agregar
        `loadPaymentOrderEntryPreflight(companyId, paymentOrderId, client = prisma)`: `select`
        de pagos = `PAYMENT_SELECT` + `endorsedCheckId` + `card: { select: { name, ownerType } }`;
        `partnerId`; settings con `payablesAccountId`, defaults y las 4 `withholding*EmittedAccountId`.
        Si `partnerId` → solo (b) `missing` de caja/banco y (d) imputabilidad de las resueltas;
        `warnings = [buildPartnerOrderWarning()]`; **no** exige `payablesAccountId` ni bloquea
        por una sola línea. Si no → los cuatro chequeos como en recibos con
        `'payablesAccountId'`, `'emitted'`, `'paymentOrder'`; `documentLabel` = `la orden de pago
        OP-00001`.
  - [x] **`confirmPaymentOrder`** (`payment-orders/actions.server.ts:424-769`): firma
        `Promise<ActionResult<{ id: string; warnings: string[] }>>`; `:454` → `BusinessError`;
        pre-validación antes de `:458`; `:530` → `BusinessError` con el nombre de la caja
        (`include` de `payments` (`:447`) suma `cashRegister: { select: { name: true } }` junto al
        `card`); `:601` → `BusinessError('El cheque de tercero seleccionado ya no está disponible
        en cartera')`; reemplazar `:726-750` por la llamada directa + `update` + `logger.info`
        dentro del `if (!paymentOrder.partnerId)` (mantener el `if`, seguimiento 2.4-4), **sin**
        `try/catch`; `:760` → `return { success: true, id: paymentOrderId, warnings }`; `catch`
        externo → `toActionResult(error, 'Error al confirmar orden de pago')`.
  - [x] **Integración** `createJournalEntryForPaymentOrder` (`index.ts:819-957`): espejo exacto
        de la fase 2 con `payablesAccountId` / `'emitted'` / `'paymentOrder'`: firma
        `Promise<string>`; guard `:827-833` → `BusinessError(buildMissingSettingsAccountsMessage)`;
        `select` de pagos (`:850-858`) suma `paymentMethod`, `checkNumber`, `endorsedCheckId`,
        `card: { select: { name, ownerType } }`, nombres de caja/banco; bucle `:882-916` →
        `classifyPayments` (Haber por cada `resolved`); Debe Cuentas por Pagar (`:873-879`)
        `debit: total - omittedAmount`; retenciones `:920-925` → `BusinessError`; `:935-940` →
        `BusinessError(buildSingleLineEntryMessage(label, 'paymentOrder', omitted))`; `:868` →
        `BusinessError('Orden de pago no encontrada')`. Encabezado "4. Orden de Pago" con la
        misma nota que el recibo más «Las OP a socios no generan asiento».
  - [x] **Vista previa.** `getPaymentOrderEntryPreview(paymentOrderId)` en
        `payment-orders/actions.server.ts` con permiso `commercial.treasury.payment-orders` /
        `approve`.
  - [x] **`_PaymentOrdersTable.tsx`** (`:53-67`, diálogo `:185-192`, 240 líneas): mismos cambios
        que `_ReceiptsTable` (`try/finally`, `result.error`, toast ámbar con `warnings`, `useQuery`
        de la vista previa, `_EntryPreviewNotice`, botón deshabilitado con `error`). Como ya
        tiene 240 líneas, extraer el diálogo a `_ConfirmPaymentOrderDialog.tsx` en
        `payment-orders/list/components/` (< 100 líneas) que reciba `{ paymentOrderId, open,
        onOpenChange, onConfirmed }` y encapsule `useQuery` + `confirmPaymentOrder` + toasts.
        Hacer lo mismo en recibos si en la fase 2 se optó por extraer.
  - [x] Revisar que nada más consuma `confirmPaymentOrder` (grep: solo `_PaymentOrdersTable`).
- **Archivos:**
  - Crear: `payment-orders/payment-order-journal-entry.integration.test.ts`,
    `payment-orders/list/components/_ConfirmPaymentOrderDialog.tsx`
  - Modificar: `treasury/shared/entry-preflight.ts`,
    `payment-orders/actions.server.ts`, `payment-orders/list/components/_PaymentOrdersTable.tsx`,
    `src/modules/accounting/features/integrations/commercial/index.ts`
    (`createJournalEntryForPaymentOrder` y encabezado)
- **Criterio de completitud:** 14 casos en verde (primero rojos), los de la fase 2 siguen
  verdes; en la app, una OP con tarjeta de socio + efectivo muestra el aviso en el diálogo y
  confirma con toast ámbar, y su asiento no toca el banco; una OP solo con tarjeta de crédito no
  se puede confirmar y el diálogo lo dice antes; `check-types` en 219.

#### Fase 4: Gastos (Egresos) — pre-validación y `ActionResult` sin perder `budgetWarning` (TDD de integración)

- **Objetivo:** que un gasto no quede `CONFIRMED` sin asiento si faltan "Cuenta de Gastos
  Operativos" o "Cuentas por Pagar", con el label real en el mensaje; que el aviso
  presupuestario siga llegando en la rama de éxito; y que los dos consumidores lean
  `result.error`.
- **Tareas:**
  - [x] **Test de integración (rojo primero).** Crear
        `src/modules/commercial/features/expenses/expense-journal-entry.integration.test.ts`,
        mismo andamiaje, prefijo `TSK728-GAS-`. `beforeAll`: empresa, cuentas `Gastos` (EXPENSE),
        `Pagar` (LIABILITY), `Gastos vieja` (EXPENSE); settings con `expensesAccountId: Gastos` y
        `payablesAccountId: Pagar`; `ExpenseCategory`; proveedor. Gastos con **`createExpense`
        real** (`ExpenseFormInput`: `amount: '1000'`, `categoryId`, `date`) y **`confirmExpense`
        real**. Casos:
    1. Ambas cuentas → `{ success: true }` (sin `budgetWarning`); asiento Debe `Gastos` 1000 /
       Haber `Pagar` 1000 con `supplierId` en la línea del Haber; `status: 'CONFIRMED'`.
    2. `expensesAccountId: null` → `{ success: false, error }` con `"Cuenta de Gastos Operativos"`
       y `Contabilidad → Configuración`; sigue `DRAFT`, `journalEntryId: null`; restaurar.
    3. `payablesAccountId: null` → `error` con `"Cuentas por Pagar"`; restaurar. Con ambas
       vacías el mensaje nombra las dos (`"Cuenta de Gastos Operativos" y "Cuentas por Pagar"`).
    4. `expensesAccountId: Gastos vieja` con la cuenta `isActive: false` → `error` con `code -
       name` y `no está activa o no es imputable`; restaurar.
    5. Presupuesto (`prisma.budget.create` + `budgetLine` para `Gastos` con monto chico en el
       mes del gasto, molde `checkBudgetForExpense` `index.ts:1051-1200`) → `{ success: true,
       budgetWarning: { message, executedPercent } }` con `executedPercent > 80`; asiento creado
       igual. Si armar el presupuesto resulta costoso, reemplazar por: `vi.spyOn` no es posible
       sobre el mismo módulo → dejar el caso documentado como manual (fase 7) y mantener 4 casos.
    6. Período cerrado → `error` con `período está cerrado`; `DRAFT`.
    7. Confirmar dos veces → `'Gasto no encontrado o ya confirmado'`.
        `afterAll`: `expense → journalEntry → budget → expenseCategory → supplier → settings →
        account → company`, `count` 0 por prefijo.
  - [x] **`confirmExpense`** (`expenses/actions.server.ts:479-560`):
    - Firma → `Promise<ActionResult<{ budgetWarning?: { message: string; executedPercent:
      number } }>>`; imports de `action-result` y de `findMissingSettingsAccounts`,
      `buildMissingSettingsAccountsMessage` (`@/modules/commercial/shared/settings-accounts`),
      `buildImputableAccountsWhere`, `formatAccountLabel` (`commercial/shared/line-accounts`).
    - `:492-496`: el `select` suma `fullNumber`; `:496` → `BusinessError('Gasto no encontrado o
      ya confirmado')`.
    - El `accountingSettings.findUnique` de `:502-505` (hoy dentro del `try` presupuestario)
      sale **antes** y pasa a `select: { expensesAccountId, payablesAccountId }`; le sigue la
      pre-validación: sin settings → `BusinessError('No se encontró configuración contable para
      la empresa. Configurala en Contabilidad → Configuración.')`; `findMissingSettingsAccounts(
      settings, ['expensesAccountId', 'payablesAccountId'])` → `BusinessError(
      buildMissingSettingsAccountsMessage(\`el gasto ${fullNumber}\`, missing))`; imputabilidad
      de las dos con `account.findMany({ where: { ...buildImputableAccountsWhere({ companyId }),
      id: { in } } })` → `BusinessError('No se puede confirmar el gasto G-00001: la cuenta X -
      Y (configurada como "Cuenta de Gastos Operativos") no está activa o no es imputable.
      Corregila en Contabilidad → Configuración.')`. El bloque presupuestario (`:499-525`) se
      mantiene tal cual, leyendo `settings.expensesAccountId` ya cargado.
    - Reemplazar `:532-549` por la llamada directa + `update` **sin `try/catch`**, comentario
      TSK-728.
    - `:554` → `return { success: true, budgetWarning }`; `catch` externo (`:556-560`) →
      `toActionResult(error, 'Error al confirmar gasto')`.
  - [x] **Integración** `createJournalEntryForExpense` (`index.ts:965-1032`): firma
        `Promise<string>`; guard `:974-979` → `throw new BusinessError(
        buildMissingSettingsAccountsMessage(\`el gasto ${fullNumber}\`, findMissingSettingsAccounts(
        settings, ['expensesAccountId', 'payablesAccountId'])))` (mover el `findUnique` del gasto
        antes del guard); `:995` → `BusinessError('Gasto no encontrado')`. Encabezado "5. Gasto":
        «Pre-validado en confirmExpense (TSK-728)».
  - [x] **`_ExpensesTable.tsx`** (`expenses/list/components/_ExpensesTable.tsx:54-68`):
        `try/finally`; `const result = await confirmExpense(id); if (!result.success) {
        toast.error(result.error); return; } toast.success('Egreso confirmado correctamente');
        if (result.budgetWarning) toast.warning('Advertencia de presupuesto', { description:
        result.budgetWarning.message, duration: 10000 }); router.refresh();` (hoy la tabla
        **descarta** el `budgetWarning`; el detalle sí lo muestra: unificar).
  - [x] **`_ExpenseDetailModal.tsx`** (`:91-116`): `try/finally`; `if (!result.success) {
        toast.error(result.error); return; }` y el resto igual (`toast.success`, `budgetWarning`,
        `setConfirmDialogOpen(false)`, `router.refresh()`, `onSuccess`, `loadExpense`).
  - [x] Revisar que nada más consuma `confirmExpense` (grep: solo esos dos).
- **Archivos:**
  - Crear: `src/modules/commercial/features/expenses/expense-journal-entry.integration.test.ts`
  - Modificar: `src/modules/commercial/features/expenses/actions.server.ts`,
    `expenses/list/components/_ExpensesTable.tsx`, `expenses/list/components/_ExpenseDetailModal.tsx`,
    `src/modules/accounting/features/integrations/commercial/index.ts`
    (`createJournalEntryForExpense` y encabezado)
- **Criterio de completitud:** 6-7 casos en verde (primero rojos); en la app, con "Cuenta de
  Gastos Operativos" vacía el toast nombra el campo y el egreso sigue en borrador; con la cuenta
  cargada confirma y, si hay presupuesto excedido, el aviso ámbar aparece tanto desde la tabla
  como desde el detalle; `check-types` en 219.

#### Fase 5: Script de diagnóstico ampliado a recibos, OP y gastos

- **Objetivo:** saber, en producción, cuántos recibos/OP/gastos históricos quedaron confirmados
  sin asiento (el conteo de dev es 0, 1.2.6), con el mismo script y el mismo SQL de header que
  ya usa el chequeo post-deploy de 721.
- **Tareas:**
  - [x] `prisma/scripts/diagnose-invoices-without-entry.ts`:
    - Header (`:1-88`): título «Diagnóstico de comprobantes confirmados SIN asiento contable
      (TSK-721 facturas, TSK-728 recibos/OP/gastos)»; sumar al SQL 1) las tres ramas del análisis
      1.2.6 (`RECIBO`, `OP`, `GASTO`) con `status::text` y `date::date`, alineando columnas con
      las de facturas (`voucher_type` → `NULL::text` para los tres; `tercero` = `contractors.name`
      / `coalesce(suppliers.business_name,'-')`); `OP` excluye `partner_id IS NOT NULL` (sin
      asiento por diseño) y lo dice en comentario; `GASTO` usa `status NOT IN ('DRAFT','CANCELLED')`
      (`CONFIRMED`, `PARTIAL_PAID`, `PAID`); `RECIBO` y `OP` usan `status = 'CONFIRMED'` (sus enums
      no tienen `PAID`). Sumar al SQL 2) (resumen) las tres tablas. Agregar 3) el conteo de uso
      de medios de pago que pide 1.2.6 para el seguimiento 2.4-1: `SELECT payment_method::text,
      count(*), sum(amount) FROM receipt_payments GROUP BY 1` y lo mismo sobre
      `payment_order_payments`.
    - Código: `type DocumentKind = 'VENTA' | 'COMPRA' | 'RECIBO' | 'OP' | 'GASTO'` (`:90`);
      `InvoiceWithoutEntry` → `DocumentWithoutEntry` con `voucherType: string | null`;
      `findInvoicesWithoutEntry` (`:120`) suma tres `findMany` (`receipt` con `status:
      'CONFIRMED'`, `customer.name`, `totalAmount`; `paymentOrder` con `status: 'CONFIRMED'`,
      `partnerId: null`, `supplier.businessName`, `totalAmount`; `expense` con `status: { notIn }`,
      `amount`, `supplier?.businessName ?? '-'`); `CompanySummary` (`:110-116`) pasa de `sales`/
      `purchases` a `byKind: Record<DocumentKind, KindSummary>`; `formatRow` y los totales
      (`:220-282`) iteran los cinco tipos; los `console.log` se mantienen (script CLI, fuera de la
      regla de logger, como el original).
    - Correr `npx tsx prisma/scripts/diagnose-invoices-without-entry.ts` en dev (espera 0
      filas para los tres tipos nuevos y las 8 compras históricas ya conocidas) y el SQL 1) y 3)
      con `docker exec contable-pms-db psql -U postgres -d contable_pms` para verificar que no
      hay errores de columnas ni de casteo de enums.
  - [x] `docs/infrastructure/deployment.md:32-38`: la viñeta pasa a «Comprobantes confirmados
        sin asiento (facturas TSK-721; recibos, OP y gastos TSK-728)» y agrega que el SQL 3)
        dice qué medios de pago se usan (insumo del ticket de seguimiento).
- **Archivos:**
  - Modificar: `prisma/scripts/diagnose-invoices-without-entry.ts`, `docs/infrastructure/deployment.md`
- **Criterio de completitud:** el script corre en dev sin errores y lista los cinco tipos; los
  tres bloques SQL del header corren en `psql` de dev sin error; `check-types` en 219 (el
  `tsconfig.json` incluye `**/*.ts`, así que el script entra en `check-types`: no debe sumar
  errores).

#### Fase 6: Documentación — guías in-app, docs, convención, memoria y presentación

- **Objetivo:** que la usuaria sepa que un recibo/OP/gasto ya no se confirma si falta una
  cuenta, qué dice el mensaje y dónde corregirlo, y qué medios de pago **todavía** no generan
  asiento; que `docs/` deje de decir "pendiente de alinear con TSK-721"; que la convención
  liste las tres actions; y que la clienta reciba el PDF con capturas reales (memoria
  `guia-presentacion-cliente-por-ticket`).
- **Tareas:**
  - [x] `src/modules/help/features/guide/components/_TreasuryGuide.tsx`:
    - `:316-319` (recibos, «Al confirmar, se actualiza el saldo de las facturas y se genera el
      asiento contable»): agregar un párrafo «Si falta una cuenta contable (Cuentas por Cobrar,
      la cuenta de la caja o del banco, la de una retención) el recibo **no se confirma** y el
      mensaje dice qué cuenta falta y dónde cargarla (Tesorería → Cajas / Cuentas Bancarias o
      Contabilidad → Configuración). Los pagos con **cheque, tarjeta o cuenta corriente** no
      generan línea en el asiento por ahora: el diálogo de confirmación los lista antes y el
      sistema avisa después; un recibo pagado solo con esos medios no se puede confirmar.»
    - `:366-368` (OP, «Al confirmar, se registra el pago y se genera el asiento»): mismo párrafo
      con Cuentas por Pagar, cheque propio/endosado, tarjeta de empresa o de socio, y «las OP de
      devolución a un socio no generan asiento».
    - `:737-740` (relación con Contabilidad): «… se generan asientos automáticos; si el asiento
      no se puede generar, la confirmación se rechaza con el motivo».
  - [x] `src/modules/help/features/guide/components/_CommercialGuide.tsx:1109-1190` (card
        "Gastos"): título → **"Egresos"** (como la pantalla, `ExpensesList.tsx:34` y el sidebar);
        agregar «Al confirmar un egreso se genera el asiento (Gastos Operativos contra Cuentas
        por Pagar). Si falta alguna de esas dos cuentas en Contabilidad → Configuración, el
        egreso no se confirma y el mensaje nombra la cuenta.» `:1401-1404`: «al confirmar
        facturas, recibos, órdenes de pago y egresos se generan asientos … si falta una cuenta la
        confirmación se rechaza».
  - [x] `src/modules/help/features/guide/components/_AccountingGuide.tsx:273-274`: «cada
        factura, recibo, orden de pago o egreso confirmado genera su asiento automáticamente; si
        falta una cuenta requerida, la confirmación se rechaza y el mensaje dice cuál».
  - [x] `docs/modules/commercial.md`:
    - `:604-612` ("Confirmar Recibo de Cobro"): fila `Asiento Contable` → «Dr: Caja/Banco de cada
      pago (cuenta propia → "Caja/Banco por Defecto") + Ret. Sufridas → Cr: Ctas por Cobrar por
      el importe contabilizable. Si el asiento falla, la confirmación se revierte (TSK-728)»; filas
      nuevas `Pre-validación` («Aborta antes de la transacción si falta Cuentas por Cobrar, la
      cuenta de una caja/banco usada, la de una retención, o si ninguna línea además de Cobrar se
      puede generar») y `Pagos sin cuenta` («Cheque, tarjeta y cuenta corriente no generan línea;
      aviso en diálogo y toast; `warnings[]` en el resultado»).
    - `:614-624` ("Confirmar Orden de Pago"): ídem con Ctas por Pagar, Ret. Emitidas, cheque
      propio/endosado, tarjeta de empresa/socio, y «OP a socio: sin asiento por diseño, aviso».
    - Agregar "### Confirmar Gasto (Egreso)" después de OP con su tabla (Expense.status,
      verificación presupuestaria no bloqueante, pre-validación de `expensesAccountId` +
      `payablesAccountId`, asiento).
    - `:598-600`: «`confirmInvoice`, `confirmPurchaseInvoice`, `confirmReceipt`,
      `confirmPaymentOrder` y `confirmExpense` devuelven `ActionResult`…».
    - `:733-742` ("Comportamiento ante errores"): reemplazar la viñeta «Recibos, órdenes de pago,
      gastos y movimientos bancarios manuales: siguen siendo no-bloqueantes» por «**Recibos,
      órdenes de pago y gastos (TSK-728): bloqueante**, mismo esquema que facturas; los medios de
      pago sin cuenta (cheque, tarjeta, cuenta corriente, tarjeta de socio) se omiten con
      aviso y la línea de Cobrar/Pagar va por el importe contabilizable» y «**Movimientos
      bancarios manuales y transferencias**: siguen no-bloqueantes (seguimiento)». Sección nueva
      "### Cuentas de medios de pago (TSK-728)" con la cadena de resolución de 1.2.4, la tabla de
      medios y su tratamiento (obligatorio / omitido / bloqueado), y los helpers
      (`commercial/shared/payment-accounts.ts`, `settings-accounts.ts`,
      `treasury/shared/entry-preflight.ts`, `shared/lib/accounts/settings-account-labels.ts`).
  - [x] `docs/modules/accounting.md:194`: fila «Confirmar recibo/OP/gasto» → «La confirmación
        falla con mensaje legible y se revierte: el comprobante sigue en `DRAFT` sin asiento
        (TSK-728)». Agregar en la sección de configuración (`:200-220`) que los labels de los
        campos viven en `shared/lib/accounts/settings-account-labels.ts` y que los mensajes de
        error los citan textualmente.
  - [x] `docs/conventions/coding-standards.md:137-140` ("Donde ya se usa"): sumar
        `confirmReceipt`, `confirmPaymentOrder`, `confirmExpense` (TSK-728) y la variante
        «`ActionResult<{ warnings: string[] }>` cuando la operación sale bien pero hay algo que
        avisar (medios de pago sin asiento): el cliente muestra `toast.warning`». Sumar la regla
        «el aviso previo del diálogo se alimenta con una action de vista previa vía `useQuery`
        (`getReceiptEntryPreview`), no con `useEffect`».
  - [x] Memoria `errores-negocio-server-actions.md`: reemplazar «Recibos, órdenes de pago y
        gastos todavía tragan…» por «Desde TSK-728 recibos, OP y gastos también devuelven
        `ActionResult`; quedan pendientes movimientos bancarios manuales/transferencias».
  - [x] Crear `scripts/guia-presentacion/capturas-tsk728.mjs` (molde `capturas-tsk721.mjs:1-45`:
        `BASE` por argumento, login con las credenciales de la memoria `dev-local-capturas-y-login`,
        `psql` vía `docker exec contable-pms-db`, `hideNextBadge`). Siembra en "Empresa de Prueba
        01 SA" con prefijo `TSK728-`: caja "Caja TSK728" con sesión abierta y cuenta; banco
        "Banco TSK728 sin cuenta" (`account_id NULL`) y `default_bank_account_id` vacío; cliente y
        factura de venta confirmada; proveedor y factura de compra confirmada; categoría y egreso
        en borrador; `expenses_account_id` vacío al principio. Capturas: (1) diálogo de confirmar
        recibo con el aviso ámbar del cheque; (2) toast rojo del recibo con banco sin cuenta; (3)
        toast ámbar tras confirmar recibo con cheque + efectivo; (4) asiento del recibo en
        Contabilidad → Asientos (Cobrar por el importe contabilizable); (5) diálogo de OP con
        tarjeta de socio; (6) toast rojo de OP por "Cuentas por Pagar" faltante (vaciar y
        restaurar `payables_account_id`); (7) toast rojo de egreso sin "Cuenta de Gastos
        Operativos"; (8) Ajustes contables con los campos nombrados; (9) modal de recibo con el
        error Zod "Debe seleccionar la caja". Restaurar todo al final (borrar `TSK728-*` y sus
        asientos, devolver settings).
  - [x] Crear `scripts/guia-presentacion/tsk-728.html` (estructura de `tsk-721.html`): "Qué pedía
        el ticket" (en palabras de la clienta: «un recibo se confirmaba aunque el asiento
        fallara y nadie se enteraba»), "Qué cambió" (antes/después: antes confirmado sin asiento;
        ahora se rechaza con el motivo; capturas 2, 6, 7), "Cómo se usa paso a paso" (cargar las
        cuentas en Tesorería → Cajas / Cuentas Bancarias o en Contabilidad → Configuración;
        confirmar; leer el aviso del diálogo; capturas 1, 3, 4, 5), "Configuración necesaria"
        (tabla: operación → cuentas obligatorias con su nombre exacto; captura 8), "Medios de pago
        que todavía no generan asiento" (cheque, e-cheq endosado, tarjeta de crédito, tarjeta de
        socio, cuenta corriente: qué pasa hoy, qué saldo queda abierto y que se resolverá en un
        ticket aparte), "Qué NO cambió" (los movimientos de caja/banco y el estado de las facturas
        siguen igual; las OP a socios siguen sin asiento; los comprobantes históricos sin asiento
        no se tocan: se listan con el script). Generar con `node
        scripts/guia-presentacion/generar-pdf.mjs scripts/guia-presentacion/tsk-728.html
        docs/presentaciones/TSK-728-asientos-sin-silencio.pdf`.
- **Archivos:**
  - Crear: `scripts/guia-presentacion/capturas-tsk728.mjs`, `scripts/guia-presentacion/tsk-728.html`,
    `docs/presentaciones/TSK-728-asientos-sin-silencio.pdf`, `scripts/guia-presentacion/assets/tsk728-*.png`
  - Modificar: `_TreasuryGuide.tsx`, `_CommercialGuide.tsx`, `_AccountingGuide.tsx`,
    `docs/modules/commercial.md`, `docs/modules/accounting.md`,
    `docs/conventions/coding-standards.md`, memoria `errores-negocio-server-actions.md`
- **Criterio de completitud:** las tres guías describen el rechazo y los medios sin asiento;
  `docs/` no dice más "pendiente de alinear" ni "no-bloqueantes" para recibos/OP/gastos; la
  convención lista las cinco actions; el PDF existe, abre, tiene las nueve capturas legibles y las
  secciones "Medios de pago que todavía no generan asiento" y "Qué NO cambió".

#### Fase 7: Verificación final

- **Objetivo:** evidencia de que todo funciona en dev **y en build de producción** (el toast con
  el mensaje real, no el digest; memoria `errores-negocio-server-actions`).
- **Tareas:**
  - [x] `npm run check-types` → **219** (línea base); `npm run lint` sin errores nuevos en los
        archivos tocados; `npm run test` en verde: unitarios (labels, settings-accounts,
        payment-accounts, validators de tesorería, validators de settings, asset-accounts) y los
        tres de integración nuevos contra la base de dev, más los previos sin regresión; verificar
        que los `afterAll` dejan `count` 0 de `TSK728-*` en `companies`, `accounts`, `receipts`,
        `payment_orders`, `expenses`.
  - [x] Prueba manual en `npm run dev` (puerto 3010, memoria `dev-local-capturas-y-login`), con
        los datos sembrados por `capturas-tsk728.mjs` o a mano (cubiertos en navegador: 1, 2 —en
        su versión OP—, 3 y 4 —con cheque propio en OP—, 5, 6 —efectivo/transferencia—, 7 y 9
        —Efectivo sin caja—; los sub-casos con tarjeta de socio, tarjeta de crédito sola, OP a
        socio, presupuesto excedido, período cerrado y las otras dos reglas Zod quedan cubiertos
        por los tests de integración/unitarios de las fases 1-4, ver sección 4 · Fase 7):
    1. Recibo con efectivo en caja con cuenta → confirma; asiento Caja/Cobrar; toast verde sin
       avisos.
    2. Recibo con transferencia a banco sin cuenta y sin "Banco por Defecto" → el diálogo
       muestra el error en rojo y el botón deshabilitado; forzando (o desde otro flujo) el toast
       rojo nombra el banco; sigue en borrador; el saldo bancario no cambió. Cargar "Banco por
       Defecto" → confirma.
    3. Recibo con cheque + efectivo → el diálogo lista el cheque; confirma; toast ámbar; el
       asiento tiene Cobrar por el efectivo; el cheque está en cartera.
    4. Recibo solo con cheque → diálogo en rojo "una sola línea"; no se puede confirmar.
    5. Vaciar "Cuentas por Cobrar" → recibo bloqueado con el label exacto; restaurar.
    6. OP con efectivo → confirma; OP con tarjeta de socio + efectivo → aviso y asiento sin banco;
       OP solo con tarjeta de crédito → bloqueada; OP a socio → confirma con aviso "no generan
       asiento".
    7. Egreso sin "Cuenta de Gastos Operativos" → bloqueado con el label; con la cuenta →
       confirma; si hay presupuesto excedido, aviso ámbar desde tabla y desde detalle.
    8. `lockedUntilDate` en el futuro → recibo, OP y egreso devuelven "período está cerrado"
       (antes los tres llegaban redactados en prod).
    9. Modal de recibo nuevo: Efectivo sin caja → "Debe seleccionar la caja"; Transferencia sin
       banco → "Debe seleccionar la cuenta bancaria"; Cheque sin banco → se guarda.
  - [x] **Build de producción**: `npm run build && NEXT_PUBLIC_APP_URL=http://localhost:3011 npm
        run start -- -p 3011`; repetir 2, 5, 6 (tarjeta de crédito sola) y 7 y confirmar que el
        toast muestra el mensaje de negocio y que el toast ámbar de avisos (3) también llega, no
        "An error occurred in the Server Components render" (hecho con 7 —egreso sin cuenta— y
        5 en su versión OP —bloqueo por Ajustes + confirmación OK—; el toast ámbar viaja como
        dato en `warnings`, no como `throw`, así que no depende del build).
  - [ ] Correr el SQL 1) y 3) del script en producción (`psql` según memoria
        `produccion-dokploy-scripts-db`) para registrar cuántos recibos/OP/gastos históricos hay
        sin asiento y qué medios de pago se usan; anotar el resultado en la sección 5 y en el
        ticket de seguimiento 2.4-1. _(Pendiente: requiere acceso a la base de producción; queda
        para el post-deploy, como en 721.)_
  - [x] Documentar todo en la sección 5 con los conteos, los asientos generados y las capturas
        del build de producción.
- **Archivos:** ninguno nuevo (sección 5 del documento).
- **Criterio de completitud:** los nueve pasos manuales pasan, el build de producción muestra los
  mensajes reales (error y avisos), tests y tipos en línea base, sección 5 completa con los
  conteos de prod.

### 2.2 Orden de ejecución

1. **Fase 1 primero y sola.** Todo lo demás importa sus exports (`ACCOUNTING_SETTINGS_ACCOUNT_LABELS`,
   `findMissingSettingsAccounts`, `withholdingSettingsField`, `classifyPayments`, los builders
   de mensajes, el Zod). Commit propio ("labels + helpers puros + Zod", solo tests unitarios).
2. **Fases 2 y 3 en serie, con un solo agente, en este orden**: comparten **tres** archivos —
   `accounting/features/integrations/commercial/index.ts` (las tres integraciones y
   `getAccountingSettings`/`getWithholdingAccountId` viven ahí), `treasury/shared/entry-preflight.ts`
   (la 2 lo crea, la 3 le agrega el loader de OP) y el componente `_EntryPreviewNotice.tsx`
   (la 2 lo crea, la 3 lo reutiliza). La 2 va antes porque define el molde que la 3 espeja.
   Un commit por fase, cada uno con su test de integración.
3. **Fase 4 en paralelo con 2-3 solo si otro agente toca `index.ts` en una sección disjunta
   (`createJournalEntryForExpense`, `:965-1032`) y se rebasea antes de mergear**; como el
   riesgo de conflicto en el encabezado y en `getAccountingSettings` es real y la fase es chica,
   **se recomienda en serie después de la 3** con el mismo agente. Los consumidores de gastos
   (`expenses/**`) no se cruzan con nadie.
4. **Fase 5 es independiente** (solo lectura, no toca `src/`): puede hacerse en cualquier
   momento, incluso antes de la 1 y en paralelo con lo que sea, para saber cuanto antes cuántos
   comprobantes históricos hay en prod y qué medios de pago se usan (insumo de 2.4-1).
5. **Fase 6 después de 2-4**: guías, `docs/` y convención se pueden redactar en paralelo con la
   4; `capturas-tsk728.mjs` y el PDF necesitan la app terminada, así que son lo último antes
   de la 7.
6. **Fase 7 al final**, con todo montado, incluido el build de producción y la consulta a prod.

**Riesgos de orden a tener presentes:**

- Si el `catch` de un `confirm*` pasa a `toActionResult` **antes** de que la integración
  correspondiente deje de devolver `null`, el comprobante sigue confirmándose sin asiento
  (`if (journalEntryId)` lo tapa). Hacer las tres cosas (pre-validación + integración que lanza
  + `catch`) en el **mismo commit** de cada fase, y la pre-validación primero.
- Cambiar `getAccountingSettings` (`index.ts:105-106`) a `BusinessError` afecta también a
  facturas y CMV: es el comportamiento deseado (mensaje legible), pero verificar que
  `sales-invoice-line-accounts` y `purchase-invoice-line-accounts` siguen verdes (crean settings,
  así que no lo tocan).
- `getWithholdingAccountId` pasa a apoyarse en `withholdingSettingsField`: hacerlo en la fase 2
  y no volver a tocarlo en la 3.
- La línea de Cobrar/Pagar por `total − omittedAmount` **no** debe aplicarse cuando hay pagos
  `missing`: el helper ya lanza antes, pero el orden dentro de la integración importa
  (clasificar → lanzar por `missing` → recién ahí restar).
- Los tests de integración crean cajas con sesión abierta (`CashRegisterSession` exige
  `sessionNumber` y `openedBy`) y bancos con `accountNumber` único por empresa: usar el prefijo.
- `payments: true` en el `include` de `confirmReceipt` (`:241`) hoy trae todos los escalares
  (`paymentMethod`, `checkNumber`, `checkBankName`… que `:367-388` usa): al pasar a
  `include: { cashRegister }` **no** convertirlo en `select`, o se pierden esos campos.
- `_PaymentOrdersTable.tsx` (240) ya excede las 200 líneas: extraer el diálogo, no sumar.
- `validators.test.ts` de settings gana un caso pero **no** cambia el conteo `'cubre las N
  cuentas configurables'`: no hay campos nuevos en el schema (sin migración en este ticket).

### 2.3 Estimación de complejidad

- Fase 1 (labels de 33 campos, dos helpers puros con ~30 casos, Zod con test): **media** — la
  dificultad está en los textos, que son el entregable, y en cubrir bien la matriz de medios de
  pago.
- Fase 2 (loader, pre-validación, integración, `ActionResult` con avisos, vista previa, notice,
  13 casos de integración con andamiaje de caja/banco/cheque): **alta** — es donde vive el
  cambio contable y el andamiaje del primer test de tesorería es el costo fijo más grande.
- Fase 3 (espejo con tarjetas, cheques endosados y OP a socio, 14 casos, extracción del
  diálogo): **alta** — más casos que recibos y `payment-orders/actions.server.ts` tiene 1254
  líneas.
- Fase 4 (gastos: pre-validación de dos cuentas, dos consumidores, 6-7 casos): **baja-media**.
- Fase 5 (script + SQL de tres tipos): **baja**.
- Fase 6 (tres guías, tres docs, memoria, script de capturas con siembra de recibo/OP/gasto,
  HTML + PDF): **media-alta** — el PDF con datos coherentes (caja con cuenta, banco sin cuenta,
  cheque, tarjeta de socio) es lo que más tiempo lleva.
- Fase 7 (nueve pasos manuales + build de producción + consulta a prod): **media**.

**Complejidad total: alta.** No hay migración, permisos nuevos, rutas nuevas ni módulos a
registrar, pero se cambia la firma de tres Server Actions con cuatro consumidores, se reescriben
tres integraciones del archivo más grande de contabilidad (1280 líneas) y no existe ningún test
previo de recibos, OP ni gastos. El riesgo técnico está en las fases 2 y 3; el esfuerzo, en la 6.

### 2.4 Seguimientos fuera de alcance

Registrados para que no se filtren en este ticket y para abrirlos aparte:

1. **Cuentas para los medios de pago que hoy no tienen ninguna** (pregunta 1.7-1, decisión del
   usuario: en este ticket se omiten con aviso). Ticket propio con: (a) cheque físico recibido y
   cheque endosado → reusar `checksReceivedAccountId` ("valores a depositar", existe en
   `schema.prisma:624` **sin UI** en Ajustes: darle campo en `SECTIONS`, `validators.ts` (+1 en
   el conteo del test), label en `settings-account-labels.ts`) y que `resolvePaymentAccount`
   la devuelva como `resolved/source: 'checksReceived'`; (b) cheque propio en OP → "Cheques
   propios diferidos a pagar" (pasivo, campo nuevo) o el banco emisor; (c) tarjeta de crédito de
   empresa → "Tarjetas de crédito a pagar" (pasivo, campo nuevo); (d) tarjeta de socio → "Deuda
   con socios" (pasivo, campo nuevo; `Partner.contributionsAccountId` es patrimonio y no sirve),
   que la OP de devolución (punto 4) cancelaría; (e) `ACCOUNT` "Cuenta Corriente" → bloquear.
   Además, **regularizar** los saldos que este ticket deja abiertos en Cobrar/Pagar por los pagos
   omitidos (listarlos: `receipt_payments`/`payment_order_payments` con `payment_method IN
   ('CHECK','CREDIT_CARD','ACCOUNT')` o tarjeta de socio, de comprobantes confirmados desde el
   deploy de 728). El SQL 3) de la fase 5 dice cuánto se usan esos medios en prod. Incluir también
   el e-cheq recibido, que hoy se imputa al banco antes de acreditarse.
2. **Movimientos bancarios manuales y transferencias sin asiento ni aviso** (1.2.5-9 y -10):
   `bank-movements/actions.server.ts:117-131` (`if (bankAccount.accountId)`), `:1109-1130` y
   `:1224-1245` (transferencias banco→banco / banco→caja, además con numeración
   `lastEntryNumber + 1` no atómica). Mismo patrón: `resolvePaymentAccount` ya sirve para la
   cadena banco → "Banco por Defecto"; `BusinessError` + `ActionResult`. Ticket propio.
3. **`integrations/treasury/index.ts` es código muerto** (1.2.5-11): `createJournalEntryForBankTransfer`
   / `ForCheckDeposit` / `ForCheckRejection` sin ningún llamador; depósitos y rechazos de cheques
   (`checks/actions.server.ts:286`, `:402`) **no tienen asiento**. Decidir si se conecta (con el
   punto 1: valores a depositar → banco) o se borra. Va junto con el punto 1.
4. **OP de devolución a socio sin asiento** (1.2.5-8, `payment-orders:722-725`): mueve caja/banco
   y no asienta nada. Requiere la cuenta "Deuda con socios" del punto 1(d): Debe deuda con socio
   / Haber caja-banco. Este ticket solo agrega el aviso.
5. **CMV** (`index.ts:1216-1276`, 1.2.5-12): `return null` si faltan `cogsAccountId`/
   `inventoryAccountId` y `catch → null`; `createJournalEntryForCOGS` tampoco tiene llamador.
   Pendiente desde 721 (2.4-10).
6. **Históricos en producción**: recibos/OP/gastos ya `CONFIRMED` sin asiento (conteo
   desconocido, dev vacío). La fase 5 los lista; qué hacer (regenerar con
   `createJournalEntryForReceipt/…` a fecha original o asentar a mano) es decisión de la clienta y
   su contador; si el SQL devuelve filas, ticket con el listado adjunto (mismo criterio que
   721 2.4-3).
7. **Mostrar el asiento en el detalle de recibo/OP/gasto** (`journalEntryId` no se muestra en
   ninguna vista, 1.2.1): un link "Ver asiento" en `_ReceiptDetailModal`, `_PaymentOrderDetailModal`
   y `_ExpenseDetailModal` cerraría el círculo de "el usuario se entera". Fuera del título.
8. **Vincular después a movimiento bancario tampoco genera asiento**
   (`linkBankMovementToDocument`, `bank-movements/actions.server.ts:858-905`): con este ticket un
   recibo/OP sin pagos ya no se puede confirmar, así que el flujo «se vincula después» queda sin
   uso real; confirmar con la clienta si se elimina la opción o se le da asiento en el ticket 2.
9. **`line-accounts.ts:48-51` (`KIND_LABELS`) y `perceptions.ts`** siguen con labels de Ajustes
   escritos a mano ('Cuenta de ventas por defecto', etc.): migrarlos a
   `ACCOUNTING_SETTINGS_ACCOUNT_LABELS` es una limpieza aparte (sus tests literales no cambian).
10. **Deuda de tamaño** en `receipts/actions.server.ts` (829), `payment-orders/actions.server.ts`
    (1254), `integrations/commercial/index.ts` (1280), `_CreateReceiptModal.tsx` (875) y
    `_CreatePaymentOrderModal.tsx` (1128): este ticket crece lo mínimo (helpers y loader afuera)
    pero no las corrige.
11. **Badge "Manual" en asientos automáticos** (`createdBy: 'system'`, detectado en TSK-717,
    sigue pendiente): los asientos de recibos/OP/gastos también lo sufren.
12. **Fund-movements con alias local de `ActionResult`** (`fund-movements/list/actions.server.ts:38-66`,
    nota de 721 §4 Fase 3): migrarlo a `@/shared/lib/action-result` sigue pendiente.

## 3. Diseño
_Pendiente - ejecutar `/disenar tsk-728-recibos-op-gastos-asiento-sin-silencio`_

## 4. Implementación

> Etapa de diseño (sección 3) salteada por decisión del usuario: la planificación ya fija
> archivos, firmas y textos, y la implementación sigue el molde de TSK-721/724c.

### Fase 1: Labels de Ajustes, helpers puros compartidos y Zod

**Estado:** Completada (2026-09-20).

**Archivos creados:**
- `src/shared/lib/accounts/settings-account-labels.ts`: `ACCOUNTING_SETTINGS_ACCOUNT_FIELDS`
  (31 campos), `AccountingSettingsAccountField`, `ACCOUNTING_SETTINGS_ACCOUNT_LABELS`,
  `ACCOUNTING_SETTINGS_PATH = 'Contabilidad → Configuración'`, `settingsAccountLabel(field)`.
- `src/modules/commercial/shared/settings-accounts.ts` + `.test.ts` (8 tests):
  `SettingsAccountIds`, `findMissingSettingsAccounts(settings, required)`,
  `withholdingSettingsField(taxType, role)`, `buildMissingSettingsAccountsMessage(documentLabel, missing)`.
- `src/modules/commercial/shared/payment-accounts.ts` + `.test.ts` (36 tests):
  `PaymentAccountCheck`, `PaymentAccountSettings`, `PaymentAccountResolution`, `EntryDocumentKind`,
  `ResolvedPayment`/`MissingPaymentAccount`/`OmittedPayment`/`PaymentsClassification`,
  `resolvePaymentAccount`, `classifyPayments` (con `omittedAmount` redondeado a centavos),
  `describePayment`, `buildMissingPaymentAccountMessage`, `buildOmittedPaymentWarning`,
  `buildSingleLineEntryMessage`, `buildPartnerOrderWarning`.
- `src/modules/commercial/features/treasury/shared/validators.test.ts` (11 tests).

**Archivos modificados:**
- `settings/validators.test.ts`: test de cobertura «cada cuenta configurable tiene label…».
- `_CommercialIntegrationForm.tsx`: los 31 `label` de `SECTIONS` leen de
  `ACCOUNTING_SETTINGS_ACCOUNT_LABELS` (diff verificado: textos idénticos; `types` y `help` quedan).
- `shared/lib/assets/asset-account-labels.ts`: `settingLabel` referencia la constante compartida.
- `treasury/shared/validators.ts`: `refineFundsSourcePayment(data, ctx, { requireBankForDebitCard })`;
  recibos `true`, OP `false`; comentario de «sin pagos ni retenciones» actualizado.

**Desvíos respecto del plan:**
- El schema tiene **31** cuentas `*AccountId`, no 33 (el conteo del test existente ya era 31).
  El plan hablaba de 33 por error de conteo; la lista de labels cubre todas las que existen.
- `ECHEQ` sin banco ni endoso → `missing/noBankAccount` (el plan no lo especificaba; es coherente
  con que el e-cheq se imputa al banco).
- `treasury/shared/validators.ts` ya no cumplía Prettier antes de este cambio (365 líneas de
  reformato); se respetó el estilo del archivo para no ensuciar el diff. ESLint limpio.
- `describePayment` con cheque endosado (sin `checkNumber`) dice «Cheque por $ …».

**Verificación:** `npx vitest run` 536/536 (480 + 56 nuevos, todos escritos primero en rojo);
`check-types` en 219 (línea base); ESLint y Prettier limpios en lo nuevo.

### Fase 2: Recibos de cobro

**Estado:** Completada (2026-09-21).

**Archivos creados:**
- `src/modules/commercial/features/treasury/features/receipts/receipt-journal-entry.integration.test.ts`
  (12 `it`, 13 casos del plan; el 2 y el 3 comparten recibo). Entra por `createReceipt`,
  `confirmReceipt` y `getReceiptEntryPreview` reales; prefijo `TSK728-REC-`; mockea además
  `server-only` (como los tests de 724c) porque el loader lo importa.
- `src/modules/commercial/features/treasury/shared/entry-preflight.ts` (`import 'server-only'`):
  `EntryPreflight { documentLabel, error, warnings, accounts }`, `EntryPreviewAccount { concept,
  account }`, `loadReceiptEntryPreflight(companyId, receiptId, client = prisma)`,
  `loadPaymentOrderEntryPreflight(companyId, paymentOrderId, client = prisma)` (ya escrito para la
  fase 3), `assertEntryPreflight(preflight): string[]`. Núcleo genérico `runPreflight` con los cuatro
  chequeos en orden (Ajustes → caja/banco `missing` → una sola línea → imputabilidad) y `PAYMENT_SELECT`
  común.
- `src/modules/commercial/features/treasury/shared/components/_EntryPreviewNotice.tsx` (75 líneas):
  cargando «Verificando cuentas contables…»; `error` → `Alert destructive` «No se va a poder
  confirmar»; `warnings` → `Alert` ámbar «Avisos del asiento contable» con viñetas; `accounts` →
  `Alert` neutro «El asiento contable se genera con estas cuentas:» con `concepto: code - name`.
- `src/modules/commercial/features/treasury/shared/components/_ConfirmEntryDialog.tsx` (112 líneas):
  diálogo genérico para recibo y OP (`documentId`, `title`, `description`, `previewQueryKey`,
  `loadPreview`, `confirm`, `successMessage`, `warningsTitle`, `onConfirmed`); `useQuery` al abrir,
  botón deshabilitado con `error`, `toast.error(result.error)`, `toast.warning(warningsTitle, {
  description: warnings.join(' '), duration: 10000 })`.

**Archivos modificados:**
- `receipts/actions.server.ts`: `confirmReceipt(receiptId): Promise<ActionResult<{ id: string;
  warnings: string[] }>>` con pre-validación antes de `$transaction`, `BusinessError` en «no
  encontrado o ya confirmado» y «No hay sesión abierta para la caja "X"» (`payments: { include: {
  cashRegister: { select: { name } } } }`), asiento sin `try/catch`, `toActionResult` en el catch;
  nueva `getReceiptEntryPreview(receiptId): Promise<EntryPreflight>` (permiso `approve`).
- `accounting/features/integrations/commercial/index.ts`: `getAccountingSettings` lanza
  `BusinessError` («… Configurala en Contabilidad → Configuración.»); `getWithholdingAccountId`
  usa `withholdingSettingsField`; `createJournalEntryForReceipt(receiptId, companyId, tx):
  Promise<string>` con `findMissingSettingsAccounts` + `classifyPayments` + `BusinessError` en
  todos los `return null`/`continue`, Haber Cobrar por `total − omittedAmount`; encabezado «3.».
- `_ReceiptsTable.tsx` (211 → 190 líneas): usa `_ConfirmEntryDialog`; descripción nueva del diálogo.

**Desvíos respecto del plan:**
- El diálogo se extrajo a un componente **genérico** en `treasury/shared/components/`
  (`_ConfirmEntryDialog`) en vez de `_ConfirmReceiptDialog` + `_ConfirmPaymentOrderDialog` por módulo:
  recibo y OP son idénticos salvo textos y actions, y la tabla de OP ya excede las 200 líneas.
- `EntryPreflight` suma `accounts` (cuentas con las que se genera el asiento) para que el notice
  tenga un estado «OK con cuentas listadas», como el de baja de equipos (724c). Se obtiene de la
  misma query de imputabilidad, sin costo extra.
- El título del aviso ámbar es «Avisos del asiento contable» (no «Pagos que no generan asiento
  contable») porque el mismo notice muestra en OP el aviso «Las órdenes de pago a socios no generan
  asiento contable», que no es un pago.
- Los tres archivos preexistentes que se tocaron (`index.ts`, `receipts/actions.server.ts`,
  `_ReceiptsTable.tsx`) ya no cumplían Prettier en HEAD; se respetó su estilo. Los nuevos sí cumplen.

**Verificación:** `npx vitest run` 548/548 (536 + 12, escritos primero en rojo: 12 fallaban);
`check-types` en 219; ESLint sin errores en lo tocado (los warnings restantes son previos, en
archivos no tocados).

### Fase 3: Órdenes de pago

**Estado:** Completada (2026-09-22).

**Archivos creados:**
- `payment-orders/payment-order-journal-entry.integration.test.ts` (14 casos, prefijo `TSK728-OP-`):
  entra por `createPaymentOrder`, `createPartnerRepaymentOrder`, `confirmPaymentOrder` y
  `getPaymentOrderEntryPreview` reales; tarjetas `Card` de empresa (crédito y débito) y de socio,
  cheque de tercero en cartera para endosar, facturas de compra directas con Prisma.
- `payment-orders/list/components/_DeletePaymentOrderDialog.tsx` (67 líneas): diálogo de eliminar
  extraído tal cual de la tabla.

**Archivos modificados:**
- `treasury/shared/entry-preflight.ts`: `loadPaymentOrderEntryPreflight` (escrito en la fase 2, lo
  cubre este test): `PAYMENT_SELECT` + `endorsedCheckId` + `card { name, ownerType }`; OP a socio →
  `generatesEntry: false` (solo `missing` de caja/banco e imputabilidad) con
  `buildPartnerOrderWarning()` como aviso y `accounts: []`.
- `payment-orders/actions.server.ts`: `confirmPaymentOrder(paymentOrderId): Promise<ActionResult<{
  id: string; warnings: string[] }>>` con pre-validación antes de `$transaction`, `BusinessError` en
  «no encontrada o ya confirmada», «No hay sesión abierta para la caja "X"» (`payments.include` suma
  `cashRegister { name }`) y «El cheque de tercero seleccionado ya no está disponible en cartera»,
  asiento sin `try/catch` dentro del `if (!paymentOrder.partnerId)` (se mantiene), `toActionResult`;
  nueva `getPaymentOrderEntryPreview(paymentOrderId): Promise<EntryPreflight>` (permiso `approve`).
- `accounting/features/integrations/commercial/index.ts`: `createJournalEntryForPaymentOrder(
  paymentOrderId, companyId, tx): Promise<string>`, espejo del recibo con `payablesAccountId` /
  `'emitted'` / `'paymentOrder'`; el `select` de pagos suma `paymentMethod`, `checkNumber`,
  `endorsedCheckId`, `card { name, ownerType }` y nombres de caja/banco; Debe Pagar por
  `total − omittedAmount`; encabezado «4.».
- `_PaymentOrdersTable.tsx` (240 → 176 líneas): `_ConfirmEntryDialog` (genérico de la fase 2) y
  `_DeletePaymentOrderDialog`.

**Desvíos respecto del plan:**
- No se creó `_ConfirmPaymentOrderDialog.tsx`: se reutiliza `_ConfirmEntryDialog` de
  `treasury/shared/components/` (ver Fase 2). Para bajar la tabla de 200 líneas se extrajo el diálogo
  de **eliminar** (movimiento puro, sin cambio de comportamiento).
- El test verifica además, en el caso 14, la lista `accounts` de la vista previa
  (`['Cuentas por Pagar', 'Caja "…"']`).

**Verificación:** `npx vitest run` 562/562 (548 + 14, escritos primero en rojo: 14 fallaban);
`check-types` en 219; ESLint sin errores en lo tocado (`:any` en `getPaymentOrders` y warnings en
modales no tocados son previos); Prettier limpio en los archivos nuevos; base sin restos `TSK728-`.

### Fase 4: Gastos (Egresos)

**Estado:** Completada (2026-09-22).

**Archivos creados:**
- `src/modules/commercial/features/expenses/expense-journal-entry.integration.test.ts` (7 casos,
  prefijo `TSK728-GAS-`, incluido el 5 con `prisma.budget.create` → `budgetWarning.executedPercent
  ≥ 80`). Entra por `createExpense` y `confirmExpense` reales.

**Archivos modificados:**
- `expenses/actions.server.ts`: `confirmExpense(id): Promise<ActionResult<{ budgetWarning?: {
  message: string; executedPercent: number } }>>`. El `accountingSettings.findUnique` sale del `try`
  presupuestario y pasa a `select: { expensesAccountId, payablesAccountId }`; sin settings →
  `BusinessError('No se encontró configuración contable para la empresa. Configurala en Contabilidad →
  Configuración.')`; helper privado `assertExpenseEntryAccounts(companyId, documentLabel, settings)`
  (`findMissingSettingsAccounts` + `buildMissingSettingsAccountsMessage` + imputabilidad con
  `buildImputableAccountsWhere` → «la cuenta X - Y (configurada como "Cuenta de Gastos Operativos") no
  está activa o no es imputable. Corregila en Contabilidad → Configuración.»); el bloque presupuestario
  se mantiene tal cual leyendo `settings.expensesAccountId`; asiento sin `try/catch`; `toActionResult`.
- `accounting/features/integrations/commercial/index.ts`: `createJournalEntryForExpense(expenseId,
  companyId, tx): Promise<string>`; `findUnique` del gasto antes del guard; guard → `BusinessError(
  buildMissingSettingsAccountsMessage(\`el gasto ${fullNumber}\`, missing))`; «Gasto no encontrado» →
  `BusinessError`; encabezado «5.» y la lista de documentos del módulo suma «gastos».
- `_ExpensesTable.tsx` y `_ExpenseDetailModal.tsx`: `try/finally`, `if (!result.success) {
  toast.error(result.error); return; }`; la tabla ahora también muestra el `budgetWarning` en
  `toast.warning('Advertencia de presupuesto', …)` (antes lo descartaba).

**Desvíos respecto del plan:**
- El caso 5 (presupuesto) se implementó (no quedó como manual). Para que `checkBudgetForExpense`
  encuentre el presupuesto, el test crea `fiscalYearStart`/`fiscalYearEnd` a **mediodía UTC**: esa
  función toma el mes de inicio con `moment()` local y una medianoche UTC del 1/1 cae en diciembre en
  UTC-3, con lo que busca el ejercicio anterior. Es un quirk previo de la verificación presupuestaria,
  fuera de este ticket; anotado para seguimiento.
- `assertExpenseEntryAccounts` vive en `expenses/actions.server.ts` (privado, ~40 líneas) y no en
  `entry-preflight.ts`: el gasto no tiene pagos ni vista previa, y `treasury/shared` es de otra feature.

**Verificación:** `npx vitest run` 569/569 (562 + 7, escritos primero en rojo: 6 fallaban y el caso 1
ya pasaba); `check-types` en 219; ESLint sin errores en lo tocado; Prettier limpio en el archivo nuevo
(los tres preexistentes ya no cumplían Prettier en HEAD); base sin restos `TSK728-`.

### Fase 5: Script de diagnóstico

**Estado:** Completada (2026-09-20).

**Archivos modificados:**
- `prisma/scripts/diagnose-invoices-without-entry.ts` (nombre sin cambios; el plan dice
  "Modificar", y `docs/` y el plan de 721 lo referencian por ese nombre). Solo lectura: cinco
  `findMany` (`salesInvoice`/`purchaseInvoice` `status notIn [DRAFT,CANCELLED]`; `receipt` y
  `paymentOrder` `status: 'CONFIRMED'`, la OP con `partnerId: null`; `expense` `status notIn`)
  con `journalEntryId: null`; `findPartnerOrdersWithoutEntry` (OP a socio, sección aparte
  "NO ES PROBLEMA"); `reportPaymentMethods` (`groupBy paymentMethod` con `_count`/`_sum` sobre
  `receiptPayment`/`paymentOrderPayment` de comprobantes CONFIRMED, y `count` de recibos/OP con
  algún pago en `CHECK`/`CREDIT_CARD`/`ACCOUNT`). `DocumentKind` de cinco valores,
  `DocumentWithoutEntry` con `voucherType: string | null`, `CompanySummary.byKind`. Header con
  los seis bloques SQL para `psql` (1 detalle UNION, 2 OP a socio, 3 resumen, 4 uso por medio,
  5 comprobantes con medio sin cuenta, 6 ítems sin cuenta de 721).
- `docs/infrastructure/deployment.md`: viñeta «Comprobantes confirmados sin asiento (facturas
  TSK-721; recibos, OP y gastos TSK-728)» con los seis bloques y el insumo del seguimiento.
- `docs/modules/accounting.md`, `docs/modules/commercial.md`: la mención al script dice que
  también cubre recibos/OP/gastos (el resto de esas secciones es de la Fase 6).

**Desvíos respecto del plan:**
- `voucher_type` es un enum en Postgres: el SQL 1) necesita `s.voucher_type::text` /
  `p.voucher_type::text` además de `NULL::text` en las otras ramas (el header de 721 no lo
  casteaba porque las dos ramas compartían el enum). Detectado al correr el SQL en psql.
- Las "8 compras históricas ya conocidas" del plan no aparecen: en dev `purchase_invoices` tiene
  5 DRAFT y 3 CONFIRMED con asiento, así que el detalle da 0 filas (correcto).
- Sección 2 (OP a socio) sumada al script y al SQL, para que en prod se vea cuántas hay sin
  contarlas como problema; y SQL 5) (comprobantes con medio sin cuenta) además del 4) por medio.

**Verificación:**
- `npx tsx prisma/scripts/diagnose-invoices-without-entry.ts` en dev (base `contable-pms-db`,
  `receipts`/`payment_orders`/`expenses`/`receipt_payments`/`payment_order_payments` en 0 filas):

  ```
  === Diagnóstico de comprobantes confirmados sin asiento (TSK-721 / TSK-728) ===
  (solo lectura: no se corrige nada)

  --- 1) PROBLEMA: comprobantes confirmados SIN asiento contable ---
  (VENTA/COMPRA/GASTO: no DRAFT ni CANCELLED; RECIBO/OP: CONFIRMED; OP a socio excluidas, ver 2)

  Ninguno. Nada que revisar.

  --- 2) NO ES PROBLEMA: OP a socio confirmadas sin asiento (sin asiento por diseño) ---
  Ninguna.

  --- 3) Uso de medios de pago en recibos y OP CONFIRMADOS (con o sin asiento) ---
  Ninguno: no hay pagos en recibos ni OP confirmados.

  Con al menos un pago SIN cuenta contable definida hoy (CHECK, CREDIT_CARD, ACCOUNT): RECIBO 0 | OP 0.
  ```
- Los seis bloques SQL del header corridos con `docker exec -i contable-pms-db psql -U postgres
  -d contable_pms` (solo SELECT): 1) 0 filas con columnas `tipo, empresa, numero, voucher_type,
  fecha, tercero, total, status, id`; 2) 0 filas; 3) 0 filas; 4) 0 filas; 5) `RECIBO 0 / OP 0`;
  sin errores de columnas ni de enums.
- `check-types` en 219 (línea base, sin errores en el script); ESLint y Prettier limpios.

### Fase 6: Documentación

**Estado:** Completada (2026-09-22).

**Archivos creados:**
- `scripts/guia-presentacion/tsk-728.html` (CSS de `tsk-724c.html`) y
  `docs/presentaciones/TSK-728-asientos-sin-silencio.pdf` (5 páginas A4, 396 KB, generado con
  `generar-pdf.mjs` sobre el Chrome del sistema). Eyebrow «Ticket 728 · Tesorería · Recibos, Órdenes
  de pago y Egresos». Secciones: 1 Qué pasaba (no lo pidió la clienta; antes/después) · 2 Qué cambió
  (vista previa con cuentas: 08, 03, 04; bloqueo con el campo y dónde: 09, 01, 02; callout «Qué vas a
  notar») · 3 Cheques, tarjetas y cuenta corriente (05, 06, asiento parcial, próxima mejora, «si
  todos los pagos son de ese tipo, no se confirma» con 07, OP a socio) · 4 Egresos (10, 11,
  presupuesto solo avisa) · 5 Al cargar (12) · 6 Qué revisar en tu empresa (tabla de cuentas por
  comprobante + cajas/bancos; históricos: «nosotros lo revisamos al instalar») · 7 Qué no cambió.
  Las capturas 13-15 (prod) no van en el PDF; se mencionan como «lo verificamos también en la
  versión instalada».

**Archivos modificados:**
- `_TreasuryGuide.tsx`: subsección «Qué revisa el sistema al confirmar» en Recibos y en Órdenes de
  Pago (vista previa, bloqueo con el nombre del campo y dónde, medios sin cuenta con aviso y saldo
  pendiente en Cobrar/Pagar, bloqueo de una sola línea, OP a socio sin asiento, Efectivo exige caja /
  Transferencia exige banco); relación con Contabilidad («si el asiento no se puede generar… la
  confirmación se rechaza con el motivo»).
- `_CommercialGuide.tsx`: card «Gastos» → **«Egresos»** (ruta, botón «Nuevo Egreso»), subsección
  «Qué revisa el sistema al confirmar» (Gastos Operativos contra Cuentas por Pagar; presupuesto solo
  avisa); relación con Contabilidad suma egresos y el rechazo.
- `_AccountingGuide.tsx`: lista de cuentas con los labels reales («Cuentas por Cobrar», «Caja por
  Defecto», «Cuenta de Gastos Operativos»…), tabla «Qué cuentas exige cada comprobante» (shadcn
  `Table`), alert «Ningún comprobante se confirma sin asiento», relación con Tesorería suma egresos.
  Se quitó el import `Receipt` sin uso (warning previo).
- `docs/modules/commercial.md`: ciclo de vida del gasto (`DRAFT → CONFIRMED → …`); las cinco actions
  con `ActionResult` (+ `warnings` / `budgetWarning`); tablas de Confirmar Recibo / OP con filas
  «Pre-validación», «Asiento por importe contabilizable» y «Pagos sin cuenta»; nueva «Confirmar Gasto
  (Egreso)»; «Comportamiento ante errores» ya no dice «pendiente de alinear» (bloqueante para los
  tres; bancarios manuales/transferencias siguen no-bloqueantes); nueva «Cuentas de medios de pago
  (TSK-728)» con la cadena, la tabla por medio y los helpers; reglas de validación; tabla resumen
  (+ Gasto, OP a socio); archivos clave.
- `docs/modules/accounting.md`: asientos automáticos, fila de período bloqueado para recibo/OP/gasto,
  mapeo de cuentas (Cobrar/Pagar/Gastos/Caja-Banco por defecto con quién los usa), **labels** con
  `settings-account-labels.ts` como fuente única, nueva «Asientos de recibos, OP y gastos (TSK-728)»
  (integraciones con `BusinessError`, `getAccountingSettings`, importe contabilizable, medios omitidos,
  pre-validación, seguimientos), retenciones con sus labels y el bloqueo.
- `docs/conventions/coding-standards.md`: «Donde ya se usa» suma las tres actions; «Variante con
  avisos» (`warnings[]` / `budgetWarning` → `toast.warning`); «Vista previa + pre-validación» como
  patrón recomendado para confirmaciones con asiento (`useQuery`, nunca `useEffect`).
- `docs/infrastructure/deployment.md`: la frase «desde esos tickets la confirmación se bloquea»
  aclara que los medios sin cuenta se confirman con aviso y asiento parcial.
- Memoria `errores-negocio-server-actions.md`: recibos/OP/gastos ya usan el patrón; pendientes solo
  movimientos bancarios manuales y transferencias.

**Desvíos respecto del plan:**
- `scripts/guia-presentacion/capturas-tsk728.mjs` y las capturas se hicieron en la Fase 7 (antes que
  esta), con el set de 15 capturas de la sección 5 en lugar de las 9 planificadas; la tarea queda
  marcada acá por completitud.
- El PDF no incluye la captura de Ajustes contables (8 del plan): la sección 6 lista los campos en
  una tabla con sus nombres literales, que es lo que la clienta necesita para encontrarlos.
- Las tres guías in-app ya no cumplían Prettier en HEAD; se respetó el estilo del archivo (ESLint
  limpio en las tres).

**Verificación:** `npx eslint` en las tres guías sin errores ni warnings; `check-types` en 219
(línea base); PDF abierto y revisado página por página (5 páginas, capturas legibles).

### Fase 7: Verificación final

**Estado:** Completada (2026-09-22), salvo el conteo en producción (post-deploy).

**Cómo:**
- `npx vitest run` → **569/569** (46 archivos); sin restos `TSK728-*` en `companies`.
- `npm run check-types 2>&1 | grep -c "error TS"` → **219** (línea base).
- `npx eslint src/modules/commercial/features/treasury src/modules/commercial/features/expenses
  src/modules/accounting/features/integrations/commercial` → 14 errores / 27 warnings, **todos
  previos** al ticket (verificado con `git blame`): los dos `:any` de `getPaymentOrders` (`:827`) y
  `getReceipts` (`:469`) son de `81faabe0`; el resto está en `pdf/data-mapper.ts`, `import-export`,
  modales y detalles no tocados. Ningún hallazgo en `entry-preflight.ts`, `_ConfirmEntryDialog`,
  `_EntryPreviewNotice`, `payment-accounts.ts`, `settings-accounts.ts` ni en los tests nuevos.
- Dev server relanzado en `:3010` (el que corría tenía código anterior al commit `3742e48`).
- Script nuevo `scripts/guia-presentacion/capturas-tsk728.mjs` (molde de `capturas-tsk724c.mjs`):
  siembra por SQL en la Empresa de Prueba 01 SA lo que la base de dev no tenía —caja `CAJA-01`
  "Caja Principal" con cuenta 1.1.1/01/01 y sesión abierta, categoría "Servicios generales",
  cliente "Cliente Demo SA" + punto de venta 1 + factura de venta `0001-00000001` CONFIRMED
  (insertada por SQL, sin asiento), y los comprobantes demo marcados con `notes='TSK728-demo'`:
  OP-00001 (transferencia $50.000), OP-00002 (transferencia $30.000 + cheque propio N° 10001
  $20.000), OP-00003 (solo cheque propio N° 10002 $10.000), OP-00004 (transferencia $5.000, para
  prod), R-00001 (efectivo $20.000 en Caja Principal contra la FA), GTO-00001/00002/00003 ($15.000
  / $8.500 / $15.000, proveedor Distribuidora de Combustibles SRL). Cambia temporalmente
  `payables/receivables/expenses_account_id`, `default_bank_account_id` y el `account_id` del
  Banco Santander, y **restaura todo en `finally`**. Modos: completo, `--prod` (13-15), `--solo-zod`
  (12), `--solo-egreso` (10-11 con GTO-00003), `--restore`. Es idempotente: al empezar borra los
  comprobantes demo con sus asientos, movimientos bancarios (devolviendo el saldo), cheques y
  movimientos de caja.
- **Build de producción**: `NEXT_PUBLIC_APP_URL=http://localhost:3011 npm run build` (exit 0) +
  `NEXT_PUBLIC_APP_URL=http://localhost:3011 BETTER_AUTH_URL=http://localhost:3011 npm run start
  -- -p 3011`; script en modo `--prod`; server de prod matado por PID al terminar.

**Resultados:** ver la tabla de la sección 5. Los 15 casos del navegador pasaron: notices con el
label literal de Ajustes, bloqueo que nombra el banco y dónde configurarlo, notice ámbar + toast
de avisos para el cheque propio, bloqueo de "una sola línea", Zod "Debe seleccionar la caja", y en
prod el toast de error llega con el **mensaje completo** (no el digest). Asientos generados
(número · Debe / Haber): OP-00001 → nº 25 Acreedores Locales (Ctes.) 50.000 / Banco Santander Río
c/c 50.000; OP-00002 → nº 26 Acreedores 30.000 / Banco 30.000 (Pagar por total − cheque; cheque
10001 `OWN/DELIVERED` $20.000); R-00001 → nº 27 Caja 20.000 / Deudores locales 20.000 (FA pasa a
`PARTIAL_PAID`, sesión de caja +20.000); GTO-00003 → nº 28 Gastos Varios - Administración 15.000 /
Acreedores 15.000; OP-00004 (prod) → nº 29 Acreedores 5.000 / Banco 5.000. Comprobantes bloqueados
quedaron en `DRAFT` con `journal_entry_id NULL` y sin movimientos. Diagnóstico
(`diagnose-invoices-without-entry.ts`): 0 recibos/OP/gastos confirmados sin asiento; medios usados
OP CHECK 1 ($20.000) / TRANSFER 3 ($85.000), RECIBO CASH 1 ($20.000); "con algún pago sin cuenta":
OP 1 (la mixta, esperado).

**Hallazgos (no se corrigió nada):**
- El **modal de nueva OP abre en la pestaña "Gastos"** cuando no viene prellenado
  (`_CreatePaymentOrderModal.tsx:369`, `defaultTab = hasInvoicesPrefilled ? 'invoices' :
  'expenses'`), así que para pagar facturas hay que cambiar de pestaña a mano. Es previo al ticket
  (`226692d`); anotado como posible mejora de UX, no bloquea.
- Los toasts de error/éxito/aviso de Sonner van **sin `richColors`**: el "rojo" es el ícono ⊗ con
  fondo neutro (igual que en 721/724c). Los notices dentro del diálogo sí son rojo/ámbar/neutro.
- Los asientos generados quedan en estado **"Borrador"** en Contabilidad → Asientos, como todos
  los automáticos del sistema (facturas, fund-movements, equipos): comportamiento previo, fuera
  del ticket.
- La factura de venta `0001-00000001` sembrada por SQL aparece en el diagnóstico como "VENTA sin
  asiento": es un artefacto de la siembra (se insertó CONFIRMED sin pasar por `confirmInvoice`),
  no un caso del ticket. Sirve de control de que el script la detecta.
- Con toasts de 4 s, capturar después de `waitForTimeout(3500)` los pierde: el script espera la
  aparición del toast (`waitForSelector`) y los captura enseguida, con `hover` para desplegar la
  pila (éxito + avisos).

## 5. Verificación

**Fecha:** 2026-09-22 · rama `fix/tsk-728-asientos-sin-silencio` · `npx vitest run` 569/569 ·
`check-types` 219 (línea base) · ESLint sin hallazgos nuevos en lo tocado.

| # | Caso (dev `:3010`, Empresa de Prueba 01 SA) | Resultado | Texto literal / evidencia | Captura |
|---|---|---|---|---|
| 1 | OP-00001 (transferencia) con "Cuentas por Pagar" en NULL | PASA: notice rojo, **Confirmar deshabilitado**, OP sigue `DRAFT` | «No se va a poder confirmar» · «No se puede confirmar la orden de pago OP-00001: falta configurar "Cuentas por Pagar" en Contabilidad → Configuración.» | `tsk728-01-op-bloqueada-ajustes.png` |
| 2 | OP-00001 con Banco Santander sin `account_id` y sin "Banco por Defecto" | PASA: notice rojo, botón deshabilitado, `DRAFT`, saldo bancario intacto | «No se puede confirmar la orden de pago OP-00001: la cuenta bancaria "Banco Santander 1085628-1" no tiene cuenta contable asociada. Configurala en Tesorería → Cuentas Bancarias o definí el "Banco por Defecto" en Contabilidad → Configuración.» | `tsk728-02-op-bloqueada-banco-sin-cuenta.png` |
| 3 | OP-00001 con todo configurado | PASA: notice neutro con las cuentas; toast `success` «Orden de pago confirmada correctamente»; `CONFIRMED` con asiento | «El asiento contable se genera con estas cuentas:» · Cuentas por Pagar: `2.1.1/02/01 - Acreedores Locales (Ctes.)` · Banco "Banco Santander 1085628-1": `1.1.1/02/01 - Banco Santander Río c/c en pesos` | `tsk728-03-op-ok-cuentas.png` |
| 4 | Asiento de OP-00001 en Contabilidad → Asientos | PASA: fila «Orden de pago OP-00001» expandida, origen «Orden Pago» | SQL nº 25: `2.1.1/02/01` Debe 50.000,00 / `1.1.1/02/01` Haber 50.000,00 | `tsk728-04-op-asiento.png` |
| 5 | OP-00002 mixta: transferencia $30.000 + cheque propio N° 10001 $20.000 | PASA: notice ámbar + notice neutro, botón habilitado | «Avisos del asiento contable» · «Cheque N° 10001 por $ 20.000,00 no genera línea en el asiento contable: los cheques todavía no tienen cuenta asignada en el sistema. Ese importe queda pendiente en Cuentas por Pagar hasta que se regularice.» | `tsk728-05-op-mixta-aviso-cheque.png` |
| 6 | Confirmar OP-00002 | PASA: toast `success` + toast `warning` con el aviso; `CONFIRMED` con asiento; cheque 10001 `OWN/DELIVERED` | «La orden de pago se confirmó con avisos contables» + el texto del cheque · SQL nº 26: Acreedores Debe **30.000,00** (total − cheque) / Banco Haber 30.000,00 | `tsk728-06-op-mixta-toast-avisos.png` |
| 7 | OP-00003 solo con cheque propio N° 10002 $10.000 | PASA: notice rojo de una sola línea, botón deshabilitado, `DRAFT` | «No se puede confirmar la orden de pago OP-00003: ningún pago genera línea contable (Cheque N° 10002 por $ 10.000,00) y no hay retenciones, así que el asiento quedaría con una sola línea. Agregá un pago en efectivo, transferencia, débito de la empresa o e-cheq, o una retención.» | `tsk728-07-op-solo-cheque-bloqueada.png` |
| 8 | R-00001 efectivo $20.000 en "Caja Principal" (cuenta 1.1.1/01/01, sesión abierta), "Cuentas por Cobrar" = 1.1.3/01/01 | PASA: notice neutro; toast «Recibo confirmado correctamente»; `CONFIRMED` con asiento; FA `0001-00000001` → `PARTIAL_PAID`; sesión de caja +20.000 | Cuentas por Cobrar: `1.1.3/01/01 - Deudores locales` · Caja "Caja Principal": `1.1.1/01/01 - Caja` · SQL nº 27: Caja Debe 20.000,00 / Deudores locales Haber 20.000,00 | `tsk728-08-recibo-ok-cuentas.png` |
| 9 | R-00001 con "Cuentas por Cobrar" en NULL (estado original de la empresa) | PASA: notice rojo, botón deshabilitado, `DRAFT` | «No se puede confirmar el recibo R-00001: falta configurar "Cuentas por Cobrar" en Contabilidad → Configuración.» | `tsk728-09-recibo-bloqueado-ajustes.png` |
| 10 | Egreso GTO-00003 con "Cuenta de Gastos Operativos" en NULL | PASA: toast `error` con el label; sigue `DRAFT` sin asiento | «No se puede confirmar el gasto GTO-00003: falta configurar "Cuenta de Gastos Operativos" en Contabilidad → Configuración.» | `tsk728-10-egreso-sin-cuenta-toast.png` |
| 11 | GTO-00003 con la cuenta 4.2.1/03/10 | PASA: toast «Egreso confirmado correctamente»; `CONFIRMED` con asiento | SQL nº 28: `4.2.1/03/10 - Gastos Varios - Administración` Debe 15.000,00 / `2.1.1/02/01` Haber 15.000,00 | `tsk728-11-egreso-ok-toast.png` |
| 12 | Modal "Nueva Orden de Pago": pestaña Facturas → proveedor → factura → pago Efectivo (Resto) sin caja → "Crear Orden de Pago" | PASA: mensaje Zod bajo el select de caja; no se crea ninguna OP (count = 0) | «Debe seleccionar la caja» | `tsk728-12-nueva-op-efectivo-sin-caja.png` |
| 13 | **Build de producción `:3011`**: GTO-00002 sin "Cuenta de Gastos Operativos" | PASA: el toast trae el **mensaje completo, no el digest**; `DRAFT` | «No se puede confirmar el gasto GTO-00002: falta configurar "Cuenta de Gastos Operativos" en Contabilidad → Configuración.» | `tsk728-13-prod-egreso-sin-cuenta-toast.png` |
| 14 | **Prod**: OP-00004 con "Cuentas por Pagar" en NULL | PASA: notice rojo, botón deshabilitado | «No se puede confirmar la orden de pago OP-00004: falta configurar "Cuentas por Pagar" en Contabilidad → Configuración.» | `tsk728-14-prod-op-bloqueada-ajustes.png` |
| 15 | **Prod**: OP-00004 restaurada y confirmada | PASA: toast «Orden de pago confirmada correctamente»; `CONFIRMED` con asiento | SQL nº 29: Acreedores Debe 5.000,00 / Banco Haber 5.000,00 | `tsk728-15-prod-op-confirmada-toast.png` |
| — | Tests de integración (fases 2-4) | 12 recibos + 14 OP + 7 gastos en verde: cubren caja sin cuenta con/sin "Caja por Defecto", retenciones sin cuenta, cheque de tercero recibido, tarjeta de socio, tarjeta de crédito sola, OP a socio, presupuesto, período cerrado, Zod de transferencia/débito | `npx vitest run` 569/569 | — |
| — | Conteo histórico en producción | **Pendiente post-deploy** (SQL 1) y 3) del header de `diagnose-invoices-without-entry.ts`, memoria `produccion-dokploy-scripts-db`) | — | — |

**Estado final de la base de dev** (verificado por SQL al terminar): `accounting_settings` de la
empresa `02885d43-…`: `receivables_account_id NULL`, `payables_account_id 7cbdad9a-…`
(2.1.1/02/01), `expenses_account_id NULL`, `default_cash_account_id NULL`,
`default_bank_account_id NULL`, `sales_account_id NULL`, `require_cost_center t` — idéntico al
inicio. Banco Santander 1085628-1: `account_id 4233917c-…` (1.1.1/02/01) restaurado; saldo
1.601.485 → **1.516.485** (−50.000 −30.000 −5.000 de las tres OP confirmadas). Quedan en la base
(marcados `notes='TSK728-demo'`, el script los recicla): OP-00001/00002/00004 `CONFIRMED` con
asiento, OP-00003 `DRAFT`, R-00001 `CONFIRMED` con asiento, GTO-00001/00002 `DRAFT`, GTO-00003
`CONFIRMED` con asiento; más la caja `CAJA-01` con sesión abierta, "Cliente Demo SA" y la FA
`0001-00000001` (`PARTIAL_PAID`, sin asiento por haberse sembrado por SQL). Comprobantes
confirmados sin asiento (recibos/OP/gastos): **0**. Restos `TSK728-*` de los tests: 0.
