# Tesorería - Inversiones (TSK-793)

## Descripción
Brokers como cuentas de Tesorería, tenencias de instrumentos atadas a un banco o broker, compra y venta de inversiones como Movimientos de Fondos (con asiento y resultado por tenencia) y valuación al cierre del ejercicio.

Spec: `docs/superpowers/specs/2026-10-28-tsk-793-inversiones-design.md`. Alcance de esta entrega: todo en pesos (ARS), sin dividendos ni cotizaciones de mercado.

## Modelo
- **Broker.** Valor `BROKER` en `BankAccountType`. Es una `BankAccount` más (saldo, cuenta contable, transferencias, corrección). El nombre (`bankName`) es obligatorio; no lleva CBU ni alias.
- **`InvestmentHolding`.** Solo datos fijos: cuenta de custodia (`bankAccountId`), `instrumentType` (12 tipos), `name`, `maturityDate?`, `accountId` (cuenta contable del activo, obligatoria), `currency` (`ARS`), `status` (`OPEN`/`CLOSED`).
- **`InvestmentMovement`.** Historial con `kind` `PURCHASE` / `SALE` / `VALUATION` y deltas con signo (`bookDelta`, `nominalsDelta`). **La posición de una tenencia (valor en libros y nominales) es la suma de sus movimientos con fecha <= D**: es función de la fecha, nunca se guarda.
- **`InvestmentValuation`.** Una por ejercicio (`@@unique([companyId, fiscalYearId])`). Genera movimientos `VALUATION` y un asiento con `process: INVESTMENT_VALUATION`.
- **`FundMovement`.** Tipos nuevos `INVESTMENT_PURCHASE` e `INVESTMENT_SALE`. Campos nuevos: `holdingId`, `nominals`, `unitPrice`, `commission`, `isFullSale`. El lado banco/broker/caja usa `fundOut*`/`fundIn*` como siempre; los efectos crean y borran el `InvestmentMovement` ligado por `fundMovementId`.
- **`AccountingSettings`.** `holdingGainAccountId`, `holdingLossAccountId`, `investmentFeesAccountId` (Ajustes contables, integración comercial).

## Reglas de negocio
- Tipos con nominales: acciones, CEDEARs, bonos, opciones, letras, futuros, licitaciones, ONs. Sin nominales (importe): FCI, fideicomisos, cauciones, plazo fijo. Los nominales son opcionales aun en los tipos que los admiten. Con vencimiento: todos menos acciones, CEDEARs, FCI y fideicomisos.
- **Comisión:** gasto aparte. Compra: sale del origen bruto + comisión. Venta: entra al destino bruto - comisión. El resultado se calcula sobre el bruto. Una comisión >= bruto es un error.
- **Venta parcial (decisión del cliente, 2026-10-28):** con nominales, costo = valor en libros x vendidos / en tenencia (PPP) y el resultado se registra en ese momento (`computeSaleCost`, `shared/position.ts`). Sin nominales: baja el capital por lo cobrado, sin resultado hasta el cierre o la venta total.
- **R8:** si la tenencia tiene nominales > 0 a la fecha, la venta parcial exige los nominales vendidos (`Indicá los nominales vendidos`, en `computeSaleCost`: cubre la confirmación y el motor de corrección). El formulario marca el campo con `*`.
- **Venta total / vencimiento:** resultado = bruto - valor en libros; la tenencia pasa a `CLOSED`. Debe ser el último movimiento (R5). Los nominales cargados con "Venta total" no se usan ni se guardan (`nominals` null); el formulario deshabilita y limpia el campo al marcarla.
- Una venta de una tenencia con valor en libros 0 (por ejemplo, valuada a 0) tiene costo 0: el asiento va sin línea de tenencia (los asientos de inversión nunca llevan líneas 0/0) y todo lo cobrado es resultado.
- **R9 (concurrencia):** compra, venta y su revert toman primero el lock de Ajustes contables de la empresa (`lockHoldingOperationsTx` → `assertPeriodOpen`, `FOR UPDATE` de `accounting_settings`), el mismo que la valuación y la creación de asientos. Dos confirmaciones sobre la misma tenencia se serializan y la segunda ve la posición con la primera ya aplicada.
- La posición nunca queda negativa en ningún punto de la historia (`assertHoldingNeverNegative`). No hay posiciones cortas.
- R6: no se acepta compra ni venta con fecha anterior a una venta existente de la misma tenencia. Tampoco movimientos con fecha <= a una valuación de la tenencia.
- Cuenta de custodia, cuenta contable y tipo de instrumento no se pueden cambiar si hay movimientos; una tenencia con movimientos no se elimina.
- Compra y venta no usan conceptos (`fundMovementUsage` devuelve `null`).
- **Corrección en cadena (TSK-792):** el motor extiende `applySides`/revert al lado `INVESTMENT`. Impedimentos: "venta posterior" (MANUAL, P4) y "ya valuada" (MANUAL: deshacer la valuación).

## Valuación al cierre
1. Se elige el ejercicio (no cerrado) y se cargan valor al cierre, o precio por nominal, por cada tenencia con saldo a la fecha de cierre.
2. Vista previa: diferencia por tenencia, total positivo y negativo, asiento.
3. Generar: movimiento `VALUATION` por tenencia (`bookDelta` = valor - libros al cierre) y asiento en **borrador** fechado al fin del ejercicio contra las cuentas de resultado por tenencia. El valor cargado es el nuevo valor en libros.
- Una por ejercicio; en orden entre ejercicios (R7); se rechaza si una tenencia tiene ventas posteriores a la fecha de cierre.
- Deshacer: borra movimientos y asiento mientras el asiento esté en Borrador y el ejercicio abierto. Sin diferencias no hay asiento y se deshace igual.
- El asiento pertenece a la valuación (`getEntryDocumentLink`, tipo `INVESTMENT_VALUATION`, columna `InvestmentValuation.journalEntryId` sin relación): Contabilidad › Asientos no lo elimina ni lo anula, y no figura entre los asientos sin documento. Volverlo a borrador sí está permitido (paso previo a deshacer).

## Permisos
Módulo `commercial.treasury.investments`: view, create, update, delete; la valuación además pide `approve`. Cae en el prefijo `commercial.*` del mapeo de módulos activables: no se registra un módulo nuevo.

## Estructura de archivos
```
src/modules/commercial/features/treasury/features/investments/
├── list/         # tenencias por banco/broker, alta/edición/baja (actions.server.ts)
├── detail/       # detalle de una tenencia con su historial
├── valuation/    # valuation.server.ts (motor), actions.server.ts, formulario con vista previa
└── shared/       # position.ts (posición y costo), validators.ts, types.ts
```
Rutas: `/dashboard/commercial/treasury/investments` y `/dashboard/commercial/treasury/investments/valuation`.

## Deploy
1. Migración `prisma/migrations/20261028144955_tsk_793_inversiones` (`prisma migrate deploy`).
2. Permiso: correr `prisma/scripts/tsk793-otorgar-permiso-inversiones.sql` (le da al rol Administrador de cada empresa existente view/create/update/delete/approve; idempotente). Los roles personalizados se otorgan desde Roles.
3. Configurar en Ajustes contables las cuentas de resultado por tenencia (positivo y negativo) y de comisiones de inversiones, y la cuenta contable de cada broker. Sin ellas, compra/venta/valuación dan un error que dice qué configurar.

## Tests
`investments/shared/position.test.ts`, `list/holdings.integration.test.ts`, `investment-fund-movements.integration.test.ts`, `investment-correction.integration.test.ts`, `valuation/valuation.integration.test.ts` (Vitest; los de integración usan la DB de dev con prefijo `TSK793-`).
