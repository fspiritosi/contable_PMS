# TSK-735 — Cuentas contables para cheques, tarjetas y cuenta corriente

Seguimiento de TSK-728. Hoy los recibos (RC) y órdenes de pago (OP) pagados con cheque, e-cheq endosado,
tarjeta de crédito, tarjeta de socio o "Cuenta Corriente" omiten ese pago del asiento con un aviso, y
Cobrar/Pagar va por el importe contabilizable: el saldo queda abierto en Deudores/Proveedores hasta
regularizarlo a mano. Este ticket les da cuenta, contabiliza el ciclo de vida del cheque y regulariza lo
histórico donde se puede.

## Decisiones del usuario (31/10/2026)

1. **Cheques de terceros: ciclo completo.**
   - Recibo: Valores a depositar / Deudores.
   - Depósito: Banco / Valores a depositar.
   - Rechazo: Cheques rechazados / Banco.
   - Endoso en OP: Proveedores / Valores a depositar.
2. **Cheques propios físicos: Valores diferidos a pagar + acción "Debitar".**
   - OP: Proveedores / Valores diferidos a pagar.
   - En Cheques, la acción nueva "Debitar" (Entregado → Cobrado) asienta Valores diferidos a pagar / Banco.
3. **Tarjetas: dos pasivos + asiento en la devolución.**
   - Tarjeta de la empresa (crédito): Proveedores / Tarjetas de crédito a pagar.
   - Tarjeta de socio (crédito o débito): Proveedores / Deudas con socios.
   - La OP de devolución a socio pasa a tener asiento: Deudas con socios / Caja o Banco.
   - El pago del resumen de la tarjeta de la empresa no tiene flujo y queda fuera del alcance (ticket aparte).
4. **"Cuenta Corriente": deja de ofrecerse en recibos y OP nuevos.** Los históricos quedan como están
   (pago omitido con aviso) y se listan en el diagnóstico de regularización.

## Cuentas de Configuración (Contabilidad → Configuración, sección nueva "Cheques y tarjetas")

| Campo de `AccountingSettings` | Etiqueta | Tipo | Estado |
|---|---|---|---|
| `checksReceivedAccountId` | Valores a depositar | Activo | existe, sin UI |
| `checksRejectedAccountId` | Cheques rechazados | Activo | existe, sin UI |
| `checksPayableAccountId` | Valores diferidos a pagar | Pasivo | nuevo |
| `creditCardsPayableAccountId` | Tarjetas de crédito a pagar | Pasivo | nuevo |
| `partnerDebtsAccountId` | Deudas con socios | Pasivo | nuevo |

Como "Caja por Defecto": si el medio se usa y la cuenta no está configurada, la confirmación **se bloquea**
con un mensaje que nombra la cuenta y dónde configurarla (mismo mecanismo `missing` de `payment-accounts.ts`
y de la pre-validación).

## Resolución de la cuenta de cada pago (`resolvePaymentAccount`)

| Pago | Documento | Cuenta | Lado |
|---|---|---|---|
| CHECK o ECHEQ de tercero recibido | RC | Valores a depositar | Debe |
| CHECK o ECHEQ endosado (`endorsedCheckId`) | OP | cuenta del cheque endosado (ver "cheques históricos") | Haber |
| CHECK propio físico | OP | Valores diferidos a pagar | Haber |
| ECHEQ propio (con banco) | OP | banco, como hoy | Haber |
| CREDIT_CARD de la empresa | OP | Tarjetas de crédito a pagar | Haber |
| Tarjeta de socio (crédito o débito) | OP | Deudas con socios | Haber |
| ACCOUNT | RC/OP históricos | omitido con aviso, como hoy | — |

**E-cheq recibido (mi decisión):** hoy el asiento lo manda al banco, pero Tesorería lo deja en cartera y
no suma al saldo bancario hasta depositarlo. Pasa a Valores a depositar, igual que el cheque físico, y su
depósito se asienta con el mismo ciclo. Si no, depositarlo debitaría el banco dos veces.

`omitted` queda solo para ACCOUNT (los históricos que se corrijan con TSK-792 vuelven a generar el mismo asiento).

## Cuenta registrada del cheque y de la cuota (mi decisión)

Para saber contra qué cuenta descargar un cheque, cada cheque guarda la cuenta en la que quedó registrado.
Columna nueva `Check.accountId` (nullable), que se completa así:

- Al confirmar el RC: Valores a depositar.
- Al emitir un cheque propio físico en una OP: Valores diferidos a pagar.

`PaymentOrderInstallment.accountId` (nullable): al confirmar una OP con tarjeta de socio se guarda Deudas con
socios. Con tarjeta de la empresa se guarda Tarjetas a pagar, que hoy no se usa pero deja la cuota trazable.

**Históricos (`accountId` null).** Son cheques y cuotas de antes de este ticket: su comprobante de origen
omitió el pago y el saldo quedó abierto en Deudores o Proveedores. Su descarga va contra esa cuenta del
tercero, y así **se regulariza sola**:

| Evento sobre un histórico | Asiento |
|---|---|
| Depósito de cheque físico de tercero | Banco / Deudores (cliente del cheque) |
| Depósito de e-cheq de tercero | sin asiento: el RC ya lo había debitado al banco; se avisa |
| Endoso en OP | Proveedores / Deudores (cliente del cheque) |
| Débito de cheque propio físico | Proveedores (proveedor del cheque) / Banco |
| Cuota de tarjeta de socio devuelta | Proveedores (proveedor de la OP de origen) / Caja o Banco |

## Asientos del ciclo de vida del cheque

Son asientos nuevos de Tesorería (en borrador, `createdBy: 'system'`, mismo núcleo `createJournalEntryTx`).
Se guardan en columnas nuevas de `Check`:

- `depositEntryId`
- `rejectionEntryId`
- `debitEntryId`
- `voidEntryId`

| Acción (pantalla Cheques) | Estado | Asiento |
|---|---|---|
| Depositar | PORTFOLIO → DEPOSITED | Banco / cuenta del cheque |
| Rechazar | DEPOSITED → REJECTED | Cheques rechazados (con cliente) / Banco |
| Debitar (nueva) | DELIVERED → CASHED | cuenta del cheque / Banco |
| Anular en cartera | PORTFOLIO → VOIDED | Deudores (cliente) / cuenta del cheque |
| Anular depositado | DEPOSITED → VOIDED | revierte el depósito y anula como en cartera |
| Anular entregado | DELIVERED → VOIDED | cuenta del cheque / Proveedores (proveedor) |
| Endosar a mano (fuera de OP) | PORTFOLIO → ENDORSED | sin cambio: sin asiento y con aviso; el endoso contable va por OP |

Reglas comunes:

- La cuenta "Banco" sale de la cuenta bancaria (`BankAccount.accountId`) y, si no tiene, de "Banco por
  Defecto". Si no se resuelve, la acción se bloquea con el mismo mensaje que hoy.
- Las acciones respetan el período cerrado. Si el asiento falla, la acción entera se revierte.
- Acreditar (DEPOSITED → CLEARED) no genera asiento: el débito al banco se hizo en el depósito.

## OP de devolución a socio

Hoy no genera asiento. Pasa a generarlo:

- Debe: por cada cuota saldada, la cuenta de la cuota, o Proveedores con el proveedor de la OP de origen si
  es histórica.
- Haber: los pagos resueltos (caja, banco, cheque propio, endoso).
- Se quita el aviso "Las órdenes de pago a socios no generan asiento contable".

## "Cuenta Corriente"

- Desaparece de los selectores de RC y OP.
- Los esquemas de alta y edición la rechazan con el mensaje "El medio "Cuenta Corriente" ya no se usa:
  elegí otro medio o registrá una nota de crédito/débito".
- Los registros existentes no se tocan.

## Regularización

`prisma/scripts/tsk735-diagnostico-medios-sin-cuenta.sql` (psql, de solo lectura) lista para el contador:

- RC/OP confirmados con CHECK/ECHEQ/CREDIT_CARD/ACCOUNT/tarjeta de socio, con el importe que quedó
  abierto en Deudores/Proveedores, y qué pasa con cada uno:
  - "se regulariza al depositar/endosar/debitar" (cheque en cartera o entregado),
  - "ya depositado/endosado antes: regularizar a mano",
  - "tarjeta de empresa: regularizar a mano",
  - "cuenta corriente: regularizar con NC/ND".
- Totales por tercero.

## Fuera de alcance

- Pagar el resumen de una tarjeta de la empresa (Tarjetas a pagar se acumula hasta ese ticket).
- Gestión posterior del cheque rechazado (recupero, redepósito).
- Asiento del endoso manual fuera de OP.
- `accounting/features/integrations/treasury/index.ts`: ya no existe (se eliminó antes); nada que hacer.

## Criterio de aceptación (del ticket)

- Un RC cobrado con cheque genera asiento completo, con Cobrar por el total y sin avisos.
- Una OP pagada con cheque propio o tarjeta genera asiento completo, con Pagar por el total y sin avisos.
- Los importes pendientes históricos quedan regularizados o listados para el contador.
- Tests de integración por medio de pago.
