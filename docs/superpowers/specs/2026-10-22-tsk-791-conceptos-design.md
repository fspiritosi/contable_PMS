# TSK-791 — Conceptos de movimientos de fondo y bancarios

**Fecha:** 2026-10-22
**Ticket:** TSK-791 (cc-tickets, proyecto Contable PMS)

## Intención

El cliente no quiere que desde **Gestión** (módulo Comercial / Tesorería) se elijan cuentas
contables. Hoy pasa en dos lugares:

- En los **movimientos de fondo** de tipo **Gastos e impuestos bancarios**, cada línea tiene un
  selector de cuenta (`AccountCombobox` en `_FundMovementLinesField.tsx`).
- En el **"Nuevo Movimiento" del detalle de una cuenta bancaria**
  (`bank-accounts/detail/components/_CreateBankMovementDialog.tsx`), un campo obligatorio
  "Cuenta Contable (Contrapartida)" para los 8 tipos de `BankMovementType`. Lo encontró la
  revisión del diseño y el usuario confirmó que **entra en este ticket**.

Otros formularios de Gestión con selector de cuenta (alta de socios, bancos, cajas, productos)
configuran la cuenta del registro, no imputan un movimiento: **quedan fuera**.

La solución: **Contabilidad** arma un catálogo de **Conceptos**, y cada concepto sabe a qué cuenta
imputa y en qué tipos de movimiento se puede usar. **Gestión** solo elige conceptos y nunca ve
ni toca una cuenta.

El modelo queda preparado para que un concepto se use en más tipos de movimiento (relación
muchos a muchos), y que habilitarlo para otro tipo sea configuración y no código. El TSK-793
(Fondos de inversión, más adelante) probablemente reutilice esto para las ganancias y pérdidas
de un fondo. Ese uso no forma parte de este ticket.

## Objetivos

1. Catálogo de Conceptos en Contabilidad, con alta, edición y activación/desactivación.
2. **Gastos e impuestos bancarios:** cada línea elige un concepto en lugar de una cuenta. Los
   conceptos son **obligatorios**: si no hay ninguno activo para ese tipo, el movimiento no se
   puede cargar y se avisa que Contabilidad tiene que crearlos.
3. **Aporte de socio / Retiro de socio:** si Contabilidad configuró **al menos un concepto activo**
   para ese tipo, el formulario pide un concepto (obligatorio, uno por movimiento). Si no hay
   ninguno, el formulario queda exactamente como hoy.
4. **Movimiento bancario manual** (detalle de cuenta bancaria → "Nuevo Movimiento"): el campo
   "Cuenta Contable (Contrapartida)" se reemplaza por **Concepto**, obligatorio para todos los
   tipos, filtrado por el tipo de movimiento bancario elegido. Si no hay conceptos activos para
   ese tipo, no se puede registrar y se avisa (igual que en Gastos bancarios).
5. La cuenta del asiento sale del concepto, con las reglas de "Cuenta del concepto" (abajo).

## No-objetivos

- **Transferencia entre cuentas** no usa conceptos y no se puede elegir como tipo de un concepto.
- No se reescriben movimientos ya **confirmados**: conservan la cuenta con la que se registraron.
- No se crean conceptos automáticamente a partir de las líneas históricas.
- El uso de conceptos en Fondos de inversión (TSK-793) queda para ese ticket.

## Anti-objetivos (sería un fracaso aunque funcione)

- Que en Gestión quede **algún** lugar de un movimiento (de fondo o bancario manual) donde se
  elija o se tipee una cuenta.
- Que un movimiento de Gastos bancarios se pueda confirmar con una línea sin concepto.
- Que aportes y retiros de una empresa sin conceptos configurados cambien de comportamiento.

## Modelo

### Concepto (decidido con el usuario)

- **Nombre**, único por empresa entre los conceptos activos.
- **Usos a los que aplica**: uno o más, de **dos familias** (y preparado para más):
  - **Movimientos de fondo**: `BANK_CHARGES`, `PARTNER_CONTRIBUTION`, `PARTNER_WITHDRAWAL`.
    `ACCOUNT_TRANSFER` **nunca**.
  - **Movimientos bancarios manuales**: los 8 de `BankMovementType` (Depósito, Extracción,
    Transferencia recibida/enviada, Cheque, Débito automático, Comisión, Interés).

  Un mismo concepto puede aplicar a las dos familias: "Comisión mantenimiento de cuenta" sirve
  para una línea de Gastos bancarios y para un movimiento bancario de tipo Comisión.
  Relación muchos a muchos. La representación (tabla puente con familia + tipo, un enum propio
  de "usos", etc.) queda para el builder, con una condición: **sumar una familia o un tipo
  futuro** (por ejemplo los movimientos de Fondos de inversión del TSK-793) **no tiene que
  requerir migrar datos de conceptos existentes**.
- En la pantalla de Contabilidad los usos se eligen **agrupados por familia**. *(Llamada mía.)*
- **Cuenta del concepto**, en uno de dos modos:
  - **Cuenta propia**: se elige una cuenta imputable del plan. Puede ser de cualquier tipo, no
    solo gasto: los conceptos tipo Sircreb son de activo, como explica hoy la ayuda del ajuste
    `bankChargesAccountId`.
  - **Usar la cuenta del socio**: el asiento usa la cuenta que corresponde hoy al socio
    (`partner.contributionsAccountId ?? settings.partnerContributionsAccountId`, TSK-717).
- **Activo / inactivo.**

### Reglas de la cuenta del concepto

- Si el concepto aplica a **Gastos bancarios** o a **cualquier movimiento bancario**, la cuenta
  propia es **obligatoria**, porque no hay otra cuenta de dónde sacarla.
- **"Usar la cuenta del socio"** solo se puede elegir si el concepto aplica **únicamente** a
  Aporte y/o Retiro. Si aplica a cualquier otro uso, necesita cuenta propia. *(Llamada mía:
  el usuario confirmó los dos modos, no esta combinación.)*
- Al crear un concepto para Aporte o Retiro, la UI pregunta explícitamente si **mantiene la
  cuenta del socio** o **usa otra**, y en ese caso pide la cuenta (pedido del usuario).

### Líneas y movimientos

- `FundMovementLine` gana `conceptId` (nullable, porque las líneas históricas no tienen) y
  conserva `accountId`, que pasa a ser **la cuenta resuelta del concepto**: se completa en el
  servidor y nunca viene del cliente.
- `FundMovement` gana `conceptId` (nullable) para Aporte/Retiro.
- Se guarda un **snapshot del nombre del concepto** en la línea o el movimiento, siguiendo el
  patrón de etiquetas que ya usa `FundMovement` (`fundOutLabel`, `partnerName`). Así el historial
  se ve aunque el concepto se renombre o se desactive.

### Cuándo se resuelve la cuenta

- Al **guardar el borrador**, el servidor resuelve la cuenta desde el concepto, para que el aviso
  "el asiento se imputará a…" sea correcto.
- Al **confirmar**, se vuelve a resolver desde el concepto, para que un cambio de cuenta hecho por
  Contabilidad mientras el movimiento estaba en borrador se respete.
- Una vez **confirmado**, la cuenta queda fija en la línea, el movimiento y el asiento.

### Obligatoriedad y validez: se verifican en el servidor al guardar y al confirmar *(llamada mía)*

- La regla "si hay conceptos activos para el tipo, el concepto es obligatorio" se evalúa en el
  **servidor**, tanto al guardar como al confirmar, porque depende de datos (los conceptos
  activos). El validador Zod compartido solo valida la forma (un uuid si viene). La UI la
  anticipa mostrando el campo como obligatorio.
- Al confirmar, un borrador **se bloquea** con un `BusinessError` claro si:
  - le falta el concepto y para su tipo hay conceptos activos. Esto incluye los borradores de
    Aporte o Retiro creados antes de que existieran conceptos para ese tipo, y los de Gastos
    bancarios con líneas viejas;
  - tiene un concepto inactivo;
  - tiene un concepto que ya no aplica a su tipo, porque Contabilidad se lo quitó.

  El usuario edita el borrador, elige otro concepto y confirma. No hay un diálogo de "avisar y
  dejar confirmar". Es coherente con "obligatorio" y evita un flujo nuevo en
  `_FundMovementConfirmDialogs.tsx`.
- Sin conceptos activos para Aporte o Retiro, guardar y confirmar siguen exactamente como hoy.

## Comportamiento en Gestión

### Gastos e impuestos bancarios

- Cada línea tiene: **Concepto** (combo con los conceptos activos de `BANK_CHARGES`, obligatorio),
  **Detalle** (texto libre opcional; hoy se llama "descripción" y es obligatorio) e **Importe**.
  La línea **no muestra la cuenta**. *(Llamada mía: no mostrar el código de cuenta, porque el
  cliente no quiere cuentas en Gestión; el nombre del concepto alcanza.)*
- **Sin conceptos activos para el tipo:** el tipo se puede elegir, pero se muestra un aviso ("No
  hay conceptos configurados para Gastos bancarios. Pedile a Contabilidad que los cree en
  Contabilidad → Conceptos.") y no se puede guardar ni confirmar. Si el usuario tiene permiso
  sobre Conceptos, el aviso incluye un link.
- **Borradores viejos** (líneas con cuenta y sin concepto): al abrirlos en edición, la línea
  muestra el concepto vacío y obliga a elegirlo antes de guardar o confirmar. El detalle que tenían
  se conserva.
- **Vista de un movimiento ya confirmado** sin concepto: muestra la descripción histórica, como
  hoy.

### Aporte y Retiro de socio

- Si hay conceptos activos para el tipo, aparece **Concepto** (obligatorio, uno por movimiento).
- El aviso `_PartnerAccountNotice` refleja la cuenta resultante:
  - Si el concepto usa **la cuenta del socio**, los avisos son los mismos que hoy.
  - Si el concepto tiene **cuenta propia**, no se muestra la cuenta ("Concepto: Aporte para
    obra"). La falta de cuenta del socio deja de bloquear, porque esa cuenta no se usa.
- Si no hay conceptos activos para el tipo, todo queda como hoy, sin el campo.

### Transferencia

Sin cambios.

### Movimiento bancario manual ("Nuevo Movimiento" en el detalle de la cuenta bancaria)

- El campo **"Cuenta Contable (Contrapartida)"** desaparece y lo reemplaza **Concepto**
  (obligatorio), con los conceptos activos que aplican al **tipo elegido**. Al cambiar el tipo,
  el combo se refiltra y, si el concepto elegido no aplica al nuevo tipo, se limpia.
- Sin conceptos activos para el tipo elegido: aviso como en Gastos bancarios y no se puede
  registrar.
- El movimiento bancario no tiene borrador (se registra y genera el asiento en el acto), así que
  la cuenta se resuelve del concepto **al registrar**, en el servidor, y la acción
  (`createBankMovement`) deja de aceptar `accountId` del cliente.
- `BankMovement` gana `conceptId` (nullable, por los históricos) y el snapshot del nombre del
  concepto. La tabla de movimientos de la cuenta bancaria puede mostrar el concepto. *(Llamada
  mía; la columna es opcional.)*
- Las transferencias entre cuentas propias (`_BankTransferDialog`) no cambian: no piden cuenta.
- Los movimientos bancarios generados por recibos, órdenes de pago, cheques, etc. no pasan por
  este formulario y no cambian.

## Comportamiento en Contabilidad

- Pantalla nueva **Conceptos** con listado (DataTable), alta, edición y activar/desactivar.
- Ubicación en el sidebar: **Empresa → Contabilidad → Conceptos**, junto a "Plan de Cuentas" y
  "Configuración". Ruta sugerida: `/dashboard/company/accounting/concepts`. *(Llamada mía.)*
- **Borrar**: solo si el concepto no se usó en ninguna línea ni movimiento. Si se usó, solo se
  puede desactivar. Desactivarlo lo saca de los combos de Gestión; los borradores que ya lo tienen
  no se pueden confirmar hasta elegir otro concepto (ver "Obligatoriedad y validez"). *(Llamada mía.)*
- **Permiso nuevo** `accounting.concepts` (`view`/`create`/`update`/`delete`), registrado en
  `permissions/constants.ts` y mapeado a `accounting` en `PERMISSION_MODULE_MAP`. **Gestión no
  necesita este permiso** para listar los conceptos en el combo: los lee con su propio permiso de
  movimientos de fondo.
- Comunicación entre módulos: Comercial no puede importar de `modules/accounting`. La lectura de
  conceptos por tipo (para los combos y para resolver la cuenta) va en `src/shared/`.

## Ajuste "Cuenta por defecto de gastos bancarios"

`AccountingSettings.bankChargesAccountId` hoy preselecciona la cuenta de cada línea. Con conceptos
obligatorios queda **sin uso**: se saca de la pantalla de Configuración contable y de Gestión
(`_BankChargesDefaultNotice`). La columna se deja en la base sin borrar, para no hacer una
migración destructiva. *(Llamada mía.)*

## Módulo de Contabilidad inactivo

Si la empresa tiene Comercial sin Contabilidad, no hay quien configure conceptos, así que
**Gastos bancarios y el movimiento bancario manual no se pueden cargar** (mismo aviso). Aporte y
Retiro siguen como hoy. Es
coherente con el objetivo: sin Contabilidad no hay cuentas. *(Llamada mía.)*

## Restricciones del proyecto

- Reglas del `CLAUDE.md` y `.claude/rules/`: permisos en 3 niveles, Server Components por defecto,
  `_` para los client, sin `:any`, `Decimal` → `Number()`, `ActionResult`/`BusinessError` para
  errores de negocio, moment.js.
- Tests con **Vitest** (no Cypress): unitarios de las reglas de validación del concepto, y de
  integración de confirmar Gastos bancarios / Aporte con concepto y de registrar un movimiento
  bancario con concepto, siguiendo `fund-movement-lines.integration.test.ts`,
  `fund-movement-partner-account.integration.test.ts` y
  `bank-movement-period-lock.integration.test.ts` (este último hoy manda `accountId`: se adapta).
- Entregables de cada ticket: guía in-app (Contabilidad y Tesorería), `docs/` (data-model,
  módulo, permisos) y PDF de presentación para el cliente con capturas.

## Lo que queda para el builder

- Tabla puente o array para concepto ↔ tipo.
- Nombres de modelos, campos y enums.
- Cómo se comparte la validación del formulario de concepto entre client y server.
- Mensajes exactos de error y de avisos, en el tono de los existentes.
