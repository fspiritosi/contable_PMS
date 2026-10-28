# TSK-793 — Inversiones: brokers y tenencias (primera entrega)

**Ticket:** TSK-793 "Inversiones" (cc-tickets, proyecto Contable PMS).
**Fuente:** propuesta del cliente en `docs/inversione.txt` (no versionado), conversación del 2026-10-24/28.
**Rama:** `feat/tsk-793-inversiones`, sobre `feat/tsk-791-conceptos` (incluye TSK-791 y TSK-792; el PR #38 a `main` sigue abierto).

## Intención

El estudio contable (Beatriz) hoy no tiene cómo registrar las inversiones de sus clientes: plata que sale del banco a un broker o a un instrumento (bono, CEDEAR, FCI, caución, plazo fijo…), vuelve, y al cierre del ejercicio vale otra cosa. Calcular el **resultado por tenencia** (lo pagado contra lo que vale al 31/12) es lo que "le sacó canas verdes".

El cliente lo dice así: *"El módulo de inversiones lo manejaría con la complejidad de una plataforma de bróker pero con la simplificación contable real."* No se sigue el día a día del mercado: solo el **capital** de cada instrumento y el **resultado**.

**Qué sería un éxito:** registrar aportes y retiros de inversiones con su asiento, ver en cada banco/broker qué tenencias hay y cuánto valen en libros, y al cierre cargar el valor de cada tenencia (o el precio del nominal) y que el sistema genere solo el asiento de resultado por tenencia.

## Alcance de esta entrega (acordado)

Entra:
1. **Brokers** como un tipo nuevo de cuenta en Tesorería. La sección "Cuentas" pasa a llamarse **"Cuentas Bancarias y Brokers"**.
2. **Tenencias de instrumentos** atadas a un banco o broker.
3. **Compra** (aporte) y **venta / retiro** de inversiones como Movimientos de Fondos, con asiento.
4. **Resultado por tenencia** en la venta total (y al vencimiento) y en la **valuación al cierre del ejercicio**.
5. **Comisiones** de compra/venta como **gasto aparte** (decisión del usuario).

Queda para entregas siguientes (no-objetivos de esta):
- **Dólares / moneda extranjera** en tenencias y brokers. Hoy todo en pesos. El modelo no debe impedir agregarlo después (la tenencia guarda su moneda, fija en ARS por ahora).
- **Dividendos** (se cobran en el banco/broker contra una cuenta propia; no suman al instrumento).
- Seguimiento de cotizaciones, órdenes de mercado, integración con brokers.

Anti-objetivos (sería un fracaso aunque funcione):
- Que el usuario tenga que hacer a mano la cuenta de resultado por tenencia.
- Que una tenencia quede con saldo negativo o que se pueda retirar de ella más de lo que tiene.
- Que la valuación al cierre o las ventas rompan la corrección en cadena del TSK-792 (editar/anular un movimiento con efectos ya posteriores tiene que dar impedimento, no inconsistencias).

## Conceptos

- **Cuenta (banco o broker):** el broker tiene su **saldo líquido** propio (lo transferido + lo que vuelve de las inversiones), igual que un banco. Se puede invertir desde el banco directo o pasando por el broker.
- **Tenencia:** un instrumento dentro de una cuenta. *"Podés tener Balanz con un bono X y Cocos con el mismo bono X"*: son dos tenencias distintas.
- **Tipo de instrumento:** catálogo fijo con tres atributos — si lleva **unidades (nominales)** o es solo importe, si tiene **vencimiento**, y moneda (siempre ARS en esta entrega).

| Tipo | Unidades | Vencimiento |
|---|---|---|
| Acciones | sí | no |
| CEDEARs | sí | no |
| Bonos | sí | sí |
| Opciones | sí | sí |
| Letras | sí | sí |
| Futuros | sí | sí |
| Licitaciones | sí | sí |
| Obligaciones negociables | sí | sí |
| Fondos (FCI) | no (importe) | no |
| Fideicomisos | no (importe) | no |
| Cauciones | no (importe) | sí |
| Plazo fijo | no (importe) | sí |

Los **nominales son opcionales** aun en los tipos que los admiten (decisión del cliente: "poner los nominales (opcional)").

- **Valor en libros** de una tenencia: lo invertido menos lo retirado (a costo), o el valor fijado en la última valuación al cierre más/menos lo movido después. Es la base contra la que se calcula el resultado.

## Lo que el usuario decidió

- Corte de la primera entrega: el de "Alcance" arriba.
- Comisiones y derechos de mercado: **gasto aparte**, no se suman al costo del instrumento.
- Cuentas de resultado por tenencia: **4.1.1/03/02** (positivo) y **4.2.1/05/11** (negativo), como propone el cliente. Existen en el plan modelo (`model-chart-of-accounts.ts:1134` y `:1590`).
- El ciclo de la tenencia (compra, venta total/vencimiento con resultado en el mismo asiento, validación de saldo de la tenencia, valuación al cierre) tal como se describe abajo.

## Comportamiento

### Brokers

- Nuevo valor `BROKER` en `BankAccountType` (también en el validador que lo repite: `treasury/shared/validators.ts:133`) y en `NON_BANK_TYPES` (no pide CBU/alias). El nombre del broker va en `bankName`; tiene `accountId` (cuenta contable) como cualquier cuenta.
- Aparece en el listado de cuentas con su tipo. El ítem del sidebar y el título de la página pasan a "Cuentas Bancarias y Brokers".
- La transferencia banco ↔ broker es la **Transferencia entre cuentas** que ya existe en Movimientos de Fondos (sin cambios).

### Tenencias

- Entidad nueva. Datos: cuenta donde está (banco o broker de la empresa), tipo de instrumento, nombre/ticker (texto libre), vencimiento (opcional, solo para tipos con vencimiento), **cuenta contable del activo** (obligatoria, cuenta imputable de activo), moneda (ARS), estado (abierta / cerrada), nominales actuales (opcional) y valor en libros.
- Nominales y valor en libros **se derivan de sus movimientos** (no se editan a mano).
- Se crea desde su pantalla o al vuelo dentro de la compra.
- Una tenencia cerrada no admite movimientos nuevos. Una tenencia con movimientos no se elimina.

### Compra de inversión (aporte)

- Nuevo tipo de Movimiento de Fondos **"Compra de inversión"**. Origen: banco, caja o broker. Destino: una tenencia (nuevo lado `INVESTMENT` además de `BANK`/`CASH`).
- Si se cargan nominales: cantidad × precio = importe invertido. Si no, se carga el importe.
- **Comisión** opcional: importe aparte que también sale del origen y va a una cuenta de gasto.
- Asiento: Debe cuenta de la tenencia (importe) + Debe cuenta de comisiones (comisión) / Haber banco/broker (total).
- Respeta el ciclo existente: borrador sin efectos → confirmado con asiento y saldos. Se corrige y anula con el motor del TSK-792.

### Venta de inversión (retiro, venta total, vencimiento)

- Nuevo tipo **"Venta de inversión"**. Origen: una tenencia. Destino: banco, caja o broker. Se carga lo cobrado y, si la tenencia lleva nominales, los nominales vendidos.
- **Validación:** no se puede sacar de la tenencia más que su valor en libros ni más nominales de los que tiene.
- **Venta total** (marca explícita "vendo todo", o vencimiento): el sistema compara lo cobrado con el valor en libros; la diferencia va a **resultado por tenencia** positivo o negativo **en el mismo asiento**. La tenencia queda en cero y se cierra. Un vencimiento se carga como venta total.
- **Venta parcial: PENDIENTE de confirmar con el cliente** (ver "Pregunta abierta"). Debe quedar resuelto en un solo lugar (una función de política de venta) para que cambiarlo no toque el resto.
- Comisión de venta opcional: gasto aparte, igual que en la compra.
- Asiento (venta total con ganancia): Debe banco/broker (cobrado − comisión) + Debe comisiones / Haber tenencia (valor en libros) + Haber resultado por tenencia positivo (diferencia). Con pérdida, la diferencia va al Debe de la cuenta negativa.

### Valuación al cierre del ejercicio

- Pantalla nueva "Valuación de inversiones". Se elige el ejercicio; lista las **tenencias abiertas a la fecha de cierre** con su valor en libros a esa fecha.
- Por cada una se carga el **valor al cierre**, o el **precio por nominal** si tiene nominales (el sistema multiplica).
- Muestra la vista previa del asiento (diferencia por tenencia, total positivo y negativo) antes de generarlo.
- Genera **un asiento** con fecha de cierre del ejercicio, marcado con un **proceso nuevo** en `JournalEntryProcess` (p. ej. `HOLDING_RESULT`). Ese marcado hace que el motor del TSK-792 bloquee correcciones de ese mes (`chain.server.ts:672-676`), igual que diferencia de cambio y RECPAM.
- El valor cargado pasa a ser el **nuevo valor en libros** de la tenencia desde esa fecha.
- Una valuación por ejercicio. Se puede deshacer (borra el asiento y restaura los valores en libros) mientras el asiento no esté Registrado y el período esté abierto.
- La refundición de resultados del cierre de ejercicio (`closeFiscalYearTx`) ya lleva estas cuentas a cero: no hace falta un proceso nuevo para "se refunde a fin de año y pasa cero al otro".
- Orden esperado: la valuación se hace **antes** del cierre contable del ejercicio. Si el ejercicio ya está cerrado, no se puede valuar.

## Pregunta abierta — RESUELTA por el cliente (2026-10-28)

**Venta parcial antes del cierre:** ¿se calcula el resultado de la parte vendida en ese momento, o solo se baja el capital y el resultado espera al cierre o a la venta total?

**Respuesta del cliente:** la venta parcial registra **en ese momento** el resultado de la parte vendida: los nominales vendidos contra su costo de compra. El resto se valúa al cierre del ejercicio y se arrastra. Las recompras se suman a la misma tenencia. Se usa **precio promedio ponderado (PPP)**.

Queda implementado así (aislado en `computeSaleCost`):
- Con nominales: costo = valor en libros × nominales vendidos / nominales en tenencia (PPP). El resultado (bruto − costo) se registra en esa fecha.
- Sin nominales (FCI, cauciones, fideicomisos, plazo fijo): se baja el capital por el importe cobrado; el resultado aparece al cierre o en la venta total.

## Restricciones

- Convenciones del proyecto (`CLAUDE.md`, `.claude/rules/`): permisos en 3 niveles, Decimal → Number, moment con hora argentina para fechas de negocio, `ActionResult`/`BusinessError` en server actions, componentes cliente con `_`, sin `any`.
- Tests con **Vitest** (Cypress no existe en el repo). Integración contra la DB de dev como en el TSK-792.
- Entregables de cada ticket: docs de desarrollador (`docs/`), guía de usuario in-app (`src/modules/help/`), guía de presentación al cliente (`scripts/guia-presentacion/`).
- No romper los Movimientos de Fondos existentes: el `switch` de `applySidesAndBuildEntryLinesTx` es exhaustivo (`fund-movement.server.ts:682`), y el revert solo deshace hoy movimientos de banco/caja (`:780-781`): hay que extenderlo al lado `INVESTMENT`.
- Los conceptos del TSK-791 (`MovementConcept`/`ConceptUsage`) se aplican a los tipos de Movimiento de Fondos: los dos tipos nuevos deben integrarse igual que los existentes.

## Decisiones mías (revisables)

- **Broker = tipo de cuenta bancaria**, no una entidad nueva: hereda saldo, cuenta contable, movimientos, transferencias y corrección.
- **Compra y venta = tipos de Movimiento de Fondos**, no un circuito aparte: heredan borrador/confirmación, asiento, anulación y corrección en cadena.
- **Cuenta contable por tenencia, obligatoria y elegida por el usuario** (sin cuenta por defecto por tipo). Al crear, se sugiere filtrar por activo.
- **Nuevos ajustes contables** en `AccountingSettings` (pantalla de integración comercial): cuenta de resultado por tenencia positivo, negativo y cuenta de comisiones de inversiones. Sin configurar, la compra/venta/valuación que las necesite da un error claro diciendo qué configurar (como el `entry-preflight` existente).
- **Validación de saldo** solo en las tenencias. Bancos y brokers mantienen el comportamiento actual (hoy no validan saldo insuficiente).
- **Permisos (ruling P1):** el módulo es `commercial.treasury.investments` (view/create/update/delete) para tenencias, compras/ventas y valuación; la valuación además pide `approve`. Sigue la nomenclatura de Tesorería. Antes se pensó `commercial.investments`.
- **Valor en libros con fecha.** Es realista valuar 2025 en marzo de 2026, con movimientos de 2026 ya cargados. Por eso el valor en libros de una tenencia es función de la fecha: el valor de la última valuación hasta esa fecha más/menos los movimientos posteriores a ella. La valuación toma el valor en libros **a la fecha de cierre** (solo movimientos hasta ese día). Las compras posteriores al cierre no molestan. Si la tenencia tiene **ventas confirmadas posteriores al cierre** (su resultado se calculó contra el valor previo a la valuación), esa tenencia no se puede valuar: se informa cuáles son, para que el usuario las anule o corrija, valúe y las vuelva a cargar. Lo mismo al deshacer una valuación.
- **Bloqueo por valuación.** Además del bloqueo mensual que ya da el proceso nuevo en `JournalEntryProcess`, corregir, anular o cargar con fecha anterior un movimiento de una tenencia **valuada**, con fecha igual o anterior al cierre de ese ejercicio, es un **impedimento** del motor del TSK-792 (tipo "podés resolverlo": deshacer la valuación). El bloqueo es por tenencia y por ejercicio valuado, no por mes.
- **Comisiones.** Los formularios piden el **importe bruto** (nominales × precio, o el importe) y la comisión aparte. Compra: sale del origen bruto + comisión. Venta: entra al destino bruto − comisión. El resultado por tenencia se calcula sobre el **bruto** (bruto − valor en libros). La comisión siempre va al Debe de la cuenta de comisiones.
- **Conceptos del TSK-791 (ruling P2).** Compra y venta de inversión **no usan conceptos**: `fundMovementUsage` devuelve `null`, como la transferencia. Las cuentas del asiento salen de la tenencia, del banco/broker y de los ajustes, nunca de un concepto. Sin cuenta asociada, el concepto aportaba poco y obligaba a sumar usos nuevos.
- **Módulo activable.** `commercial.treasury.investments` cae en el mapeo por prefijo `commercial.*` de `PERMISSION_MODULE_MAP` (`src/shared/lib/modules/constants.ts:72`): se activa con Comercial, como el resto de Tesorería. No se registra un módulo nuevo.
- **Sin posiciones cortas.** Opciones y futuros lanzados (posición vendida, saldo negativo) **no** se soportan en esta entrega: toda tenencia tiene valor en libros y nominales ≥ 0.
- **Ubicación:** "Inversiones" como ítem nuevo del grupo Tesorería (listado de tenencias agrupadas por cuenta, con detalle e historial de cada una) y "Valuación de inversiones" dentro de esa sección. El detalle de una cuenta broker también lista sus tenencias.

## Lo que queda al constructor

- Nombres de modelos, tablas, enums y rutas.
- Cómo se guarda el historial de una tenencia (tabla de movimientos de tenencia ligada al Movimiento de Fondos, como `BankMovement`).
- Diseño visual de las pantallas, siguiendo los patrones de Tesorería existentes.
- Cómo encaja la valuación en el motor de corrección (impedimento al corregir un movimiento anterior a una valuación hecha).
- **P3. Venta parcial.** Ver "Pregunta abierta — RESUELTA": costo proporcional por PPP con nominales; sin nominales, baja de capital sin resultado.
- **P4. Ventas posteriores.** Corregir o anular un movimiento de una tenencia con una **venta posterior** es un impedimento MANUAL ("anulá primero la venta posterior"): el costo de una venta queda fijo al confirmarse.
- **P5. Asiento de la valuación en borrador.** Se genera en **borrador** (`process: INVESTMENT_VALUATION`). Deshacer la valuación lo borra mientras siga en borrador; si ya está Registrado, primero se vuelve a borrador (TSK-792).
- **R4. Nombre del broker obligatorio.** Un broker no tiene CBU ni alias, así que el nombre (`bankName`) es lo único que lo identifica.
- **R5. La venta total es el último movimiento.** No se pueden cargar movimientos de una tenencia con fecha posterior a su venta total, ni vender todo si hay movimientos posteriores.
- **R6. Sin compra ni venta anteriores a una venta existente.** No se acepta una compra o venta de la tenencia con fecha anterior a una venta ya registrada de la misma tenencia: el costo de esa venta dejaría de ser coherente.
- **R7. Valuaciones en orden entre ejercicios.** No se puede valuar un ejercicio si hay una valuación posterior de la misma tenencia: primero se deshace la más reciente (se valúa y se deshace en orden).
