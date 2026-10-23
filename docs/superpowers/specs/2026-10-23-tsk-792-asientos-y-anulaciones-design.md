# TSK-792 — Asientos y anulaciones: corrección en cadena

> Diseño acordado en brainstorming el 2026-10-22/23. Lo marcado **[usuario]** lo decidió el usuario (o el
> cliente a través de él); lo marcado **[decisión de diseño]** es una decisión tomada al escribir este documento,
> revisable. Lo que no tiene marca es descripción del sistema actual.

## 1. Intención y por qué

Hoy, una vez confirmado un comprobante (FC, FV, OP, RC o MF), no se puede tocar: editar y eliminar solo existen
en Borrador. Ante un error de carga (caso real: el número de una factura de compra mal cargado) la única salida
fue anular y volver a cargar.

El cliente plantea que **mientras el período fiscal no esté cerrado, se tiene que poder modificar**. Y el
usuario lo plantea como diferencial frente a la competencia: otros sistemas obligan a desarmar la cadena a mano
(para corregir una factura que ya tiene un pago, primero hay que modificar el pago y después la factura).
Nosotros **proponemos la corrección de toda la cadena de impacto y la aplicamos con un solo consentimiento del
usuario** [usuario].

**Éxito:** el usuario corrige o elimina un comprobante confirmado desde el propio comprobante, ve claramente
todo lo que va a cambiar como consecuencia y, al confirmar, el sistema queda consistente (comprobantes,
saldos, banco, caja, cheques, stock y asientos) sin haber tenido que visitar otras pantallas.

## 2. Alcance

### Objetivos

1. **Editar** un comprobante confirmado (FC, FV no AFIP, OP, RC, MF) con su período abierto y su asiento en
   borrador, propagando la corrección a la cadena [usuario].
2. **Eliminar** un comprobante confirmado en las mismas condiciones; su asiento se elimina [usuario].
3. **Anular** un comprobante confirmado dejando rastro, usando el mismo motor de corrección en cadena
   [usuario]. Aplica a los cinco: FC, FV no AFIP, OP, RC y MF [usuario]. Esto corrige dos fallas actuales:
   anular FC/FV deja su asiento vivo, y anular una FV no controla sus cobros [usuario: entran en este ticket];
   y agrega la anulación de OP, RC y MF, que hoy no existe (el estado CANCELLED está en sus modelos pero
   nunca se usa).
4. **Volver a borrador** un asiento Registrado, desde Contabilidad › Asientos [usuario]. Esta funcionalidad no
   existe y hay que crearla [ticket].
5. Antes de aplicar cualquier cambio, **mostrar la propuesta** completa (antes → después de cada registro
   afectado) y aplicar todo junto con un solo "Confirmar" [usuario], en el formato de la variante A elegida
   (ver §7) [usuario].

### No objetivos

- FV emitidas por AFIP (con CAE): no se tocan; se corrigen con nota de crédito [ticket].
- Comprobantes de un período cerrado: no se tocan [ticket].
- Editar o eliminar Gastos (Expense) confirmados como comprobante de origen. Sí se recalcula el estado de un
  gasto cuando se corrige la OP que lo paga [decisión de diseño].
- Movimientos bancarios manuales, transferencias, liquidación de IVA, ajustes por inflación, diferencia de
  cambio, depreciación y asientos manuales: fuera de la corrección en cadena (sí aplica a ellos "Volver a
  borrador" en Asientos, con las condiciones de §6).
- Un log general de auditoría (no existe en el sistema y no se crea acá).
- Los problemas detectados en el análisis que se derivaron a tickets propios: **TSK-796** (Libro IVA Digital
  omite facturas Pagadas y Parciales), **TSK-797** (OP/RC en borrador descuentan el saldo pendiente) y
  **TSK-798** (la FV generada desde remitos descuenta stock dos veces) [usuario]. La corrección en cadena
  repite lo que hoy hace la confirmación; no corrige el TSK-798.
- Revisar o corregir comprobantes ya anulados en el pasado que quedaron con asiento vivo [decisión de diseño:
  se menciona en la guía de deploy como dato, no se migra].

### Anti-objetivos (sería un fracaso aunque "funcione")

- Que el usuario tenga que ir pantalla por pantalla a corregir los registros dependientes [usuario].
- Que se modifique algo que no se le mostró antes en la propuesta [usuario].
- Que quede una corrección aplicada a medias: es todo o nada (una sola transacción) [usuario].
- Que se toque un período cerrado, un asiento Registrado sin haberlo vuelto a borrador (salvo en Anular, §5.3),
  o una FV con CAE.

## 3. Vocabulario

- **Comprobante de origen:** el que el usuario edita, elimina o anula.
- **Cadena de impacto:** los registros que dependen del comprobante de origen y cambian por la corrección.
- **Propuesta:** la lista de cambios (antes → después) que el sistema calcula y muestra, sin aplicar nada.
- **Impedimento:** algo de la cadena que el sistema no debe corregir solo. Es de dos tipos [usuario]:
  - **Modificable a mano:** el usuario puede resolverlo en otra pantalla y reintentar; el aviso dice qué hacer
    y, cuando se puede, enlaza a esa pantalla.
  - **No modificable:** se informa que la corrección no es posible y por qué.

Si hay al menos un impedimento, **no se aplica nada** y el botón Confirmar queda deshabilitado [usuario].

## 4. Reglas de la corrección en cadena

### 4.1 Condiciones del comprobante de origen

Para **Editar** y **Eliminar**:

- Estado confirmado (CONFIRMED, PAID o PARTIAL_PAID según el modelo).
- Su asiento en **borrador** (DRAFT) [ticket]. Si está Registrado → impedimento modificable a mano: "Volvelo a
  borrador desde Contabilidad › Asientos" con enlace al asiento.
- **Período abierto** para la fecha del comprobante y, si la edición cambia la fecha, también para la fecha
  nueva [decisión de diseño]. Se usa `assertPeriodOpen` (hoy solo se valida al crear o registrar el asiento,
  no al editar ni borrar comprobantes).
- FV: el punto de venta no está habilitado para AFIP y la factura no tiene CAE; si lo tiene → impedimento no
  modificable.
- **Procesos del mes que se calcularon sobre los saldos** [usuario: impedimento modificable a mano]: si en el
  mes del comprobante (fecha vieja o nueva) ya existe una **liquidación de IVA**, un **ajuste por inflación** o
  una **diferencia de cambio** generados (se identifican por el `source` de su asiento:
  `vat-settlement:…`, etc.), y la corrección afecta lo que ese proceso calculó → impedimento "Podés
  resolverlo": anulá ese proceso, corregí el comprobante y volvé a generarlo. Criterio de "afecta"
  [decisión de diseño]: la liquidación de IVA, cualquier FC/FV del mes; el ajuste por inflación y la
  diferencia de cambio, cualquier comprobante del mes que genere asiento. Los textos y el enlace llevan a la
  pantalla de ese proceso.

Para **Anular**: igual, salvo que el asiento puede estar Registrado (ver §5.3).

### 4.2 Qué se puede cambiar al editar

Todo lo que se carga en el alta [usuario: "digamos que se puede cambiar"], con estas excepciones y efectos
[decisión de diseño]:

- **FV no AFIP:** punto de venta, tipo de comprobante y número quedan fijos (la numeración es correlativa por
  punto de venta y tipo; hoy ya es así en la edición de borradores).
- **Proveedor o cliente:** si el comprobante tiene pagos o cobros vinculados → impedimento modificable a mano
  ("el pago se hizo a otro proveedor: corregí primero la OP-xxx"). Sin vinculados, se cambia libremente.
- **Fecha:** ver §4.1 (ambos períodos abiertos). El asiento toma la fecha nueva.
- **Stock y orden de compra:** se revierten los efectos y se vuelven a aplicar con los datos nuevos; si no
  alcanza el stock → impedimento no modificable (o modificable si el usuario puede ajustar stock: se informa).

Conceptualmente, **editar = deshacer todos los efectos del comprobante y volver a aplicarlos con los datos
nuevos**, en la misma transacción, ajustando la cadena con las reglas de §4.3.

### 4.3 Propagación de montos: "respetar los montos nuevos" (lectura A) [usuario: lo pidió el cliente así]

La corrección se propaga hacia abajo: los registros dependientes se ajustan al monto nuevo.

- **El monto baja** (ej.: FC de $1.000.000 → $800.000, pagada con OP de $1.000.000 por transferencia): la OP
  baja a $800.000, su movimiento bancario y el saldo de la cuenta también, y su asiento se reescribe. Se asume
  que el pago se cargó con el mismo error.
- **El monto sube:** los pagos/cobros no se tocan; el comprobante queda con saldo pendiente y vuelve a "Pago
  parcial" [decisión de diseño, presentada al usuario sin objeción].
- **Se elimina o anula el comprobante:** cada pago/cobro que lo cancelaba se ajusta igual: si solo cancelaba
  ese comprobante, se elimina con todos sus efectos; si cancelaba varios, se le quita esa imputación y baja su
  total.

Reparto cuando hay varios [decisión de diseño]:

- **Varias cancelaciones sobre el mismo comprobante** (varias OP/RC parciales, notas de crédito aplicadas): la
  diferencia se descuenta de la más reciente hacia la más antigua.
- **Dentro de una OP/RC**, la diferencia sale de la imputación de ese comprobante. Si la OP/RC tiene **un solo
  medio de pago**, se ajusta ese. Si tiene **varios**, la propuesta le pide al usuario que elija de qué medio se
  descuenta (es la única elección que se le pide además del consentimiento).
- **Retenciones** de la OP / del RC: no se recalculan solas. La reducción sale de los medios de pago; si no
  alcanza sin tocar retenciones → impedimento modificable a mano. Si la OP tiene retenciones, la propuesta
  muestra un aviso "revisá el certificado de retención".

Profundidad de la cadena [decisión de diseño]: el comprobante de origen → los comprobantes que lo cancelan o
que él cancela (OP/RC, NC aplicadas) → los efectos de dinero, valores y contabilidad de esos comprobantes. La
cadena **no sigue más allá**: si un efecto ya fue usado por otro comprobante (ej.: el cheque recibido en el RC
se endosó en otra OP), eso es un impedimento, no una nueva rama de la propuesta.

### 4.4 Mapa de efectos por comprobante y qué hace la corrección

(Relevado del código; referencias en el análisis.)

**FC — Factura de compra (incluye NC/ND de compra)**
- Asiento DRAFT vinculado → se reescribe (editar) o elimina (eliminar).
- OP que la pagan (`PaymentOrderItem`) → regla §4.3; el estado de la FC se recalcula.
- NC aplicadas (`PurchaseCreditNoteApplication`) → se ajustan o eliminan según §4.3; se recalcula el estado
  de las facturas afectadas.
- Orden de compra: `invoicedQty` y estado de facturación → se revierten y reaplican.
- NC de compra con stock (devolución) → se revierte/reaplica el movimiento de stock.
- Remito de recepción, cuotas de OC y vínculos de proyección de cashflow → al eliminar se desvinculan (el
  remito sigue existiendo; el stock entró por el remito y no depende de la factura).

**FV no AFIP — Factura de venta (incluye NC/ND de venta)**
- Asiento DRAFT → reescribe / elimina.
- Stock: movimientos SALE/RETURN de la factura → se revierten y reaplican (todos los de la factura, por
  `referenceId`; no solo el primero por producto como hace hoy la anulación).
- Recibos que la cobran (`ReceiptItem`) → regla §4.3.
- NC aplicadas (`SalesCreditNoteApplication`) → igual que en compras.
- Remitos de entrega facturados → al eliminar/anular la FV vuelven a "pendiente de facturar". Al **editar**
  una FV que salió de remitos, los remitos siguen vinculados y el stock se trata igual que al confirmar
  [decisión de diseño]. El doble descuento existente es el TSK-798, fuera de alcance.

**OP — Orden de pago**
- Facturas de compra y gastos imputados → se recalcula su estado.
- Movimiento bancario creado por la OP → se ajusta o elimina, y se ajusta el saldo de la cuenta. Si el
  movimiento fue **vinculado a mano** a la OP (`linkBankMovementToDocument`) → impedimento modificable a mano
  ("desvinculalo y reintentá"). Los movimientos que crea la OP/RC nacen conciliados, así que estar conciliado
  **no** es impedimento para ellos [decisión de diseño]. Para distinguir unos de otros se agrega una marca de
  origen (§4.5).
- Movimiento de caja → se ajusta o elimina y se ajusta el saldo esperado de la sesión. Si la sesión de caja
  ya está **cerrada** → impedimento no modificable [decisión de diseño; el usuario no objetó esta ubicación].
- Cheque propio emitido (DELIVERED) → se ajusta o elimina. Si ya fue debitado, anulado o rechazado →
  impedimento no modificable.
- Cheque de tercero endosado → al quitarlo vuelve a cartera (PORTFOLIO) y se limpian los datos del endoso.
- Cuotas de tarjeta y sus proyecciones de cashflow → se regeneran o eliminan. Si alguna cuota ya está pagada
  → impedimento no modificable.
- OP de devolución a socio → las cuotas que saldaba vuelven a pendientes.
- Asiento DRAFT → reescribe / elimina.

**RC — Recibo de cobro**
- Facturas de venta imputadas → se recalcula su estado.
- Depósito bancario y movimiento de caja → como en la OP.
- Cheque de tercero recibido: si sigue en cartera (PORTFOLIO), se ajusta o elimina. Si fue **endosado en una
  OP** → impedimento modificable a mano ("corregí primero la OP-xxx"). Si fue **depositado, cobrado o
  rechazado** → impedimento no modificable.
- Asiento DRAFT → reescribe / elimina.
- Hoy el RC **no tiene edición** ni siquiera en borrador: hay que crearla.

**MF — Movimiento de fondo**
- Movimientos de banco y/o caja de cada lado → se ajustan o eliminan con sus saldos.
- Si un movimiento bancario del MF fue **conciliado** por el usuario → impedimento modificable a mano
  ("desconcilialo y reintentá") [decisión de diseño].
- Asiento DRAFT → reescribe / elimina.
- Las líneas con concepto (Gastos bancarios, TSK-791) se reeditan con las mismas reglas del alta.

### 4.5 Trazabilidad necesaria (cambio de modelo) [decisión de diseño]

Hoy algunos efectos no guardan de qué comprobante salieron, y no se pueden ubicar de forma fiable:

- `BankMovement` y `CashMovement` creados por un MF no guardan referencia al MF.
- `CashMovement` creados por OP/RC solo guardan `reference = fullNumber` (texto).
- Las proyecciones de cashflow de cuotas de tarjeta no tienen FK a la OP.
- `BankMovement` con `paymentOrderId`/`receiptId` no distingue si lo creó la OP/RC al confirmar o si se
  vinculó a mano después (`linkBankMovementToDocument` carga los mismos campos). Se agrega una marca de origen
  (creado por el comprobante / vinculado a mano). Backfill sugerido: creado por el comprobante si se creó en
  la misma transacción de confirmación (fecha de creación ≈ `confirmedAt` del comprobante y conciliado al
  crearse); el resto, vinculado a mano.

Se agregan los vínculos (FK opcionales) y se completan para los registros existentes con un script de
backfill: por `reference` + caja + tipo para caja de OP/RC; por cuenta + fecha + importe + tipo para MF,
**aceptando solo coincidencias únicas**. Un registro existente que no se pueda vincular con certeza produce un
impedimento no modificable ("este movimiento es anterior a la trazabilidad y no se puede corregir
automáticamente").

## 5. Las tres acciones sobre el comprobante

### 5.1 Editar
El usuario abre el formulario de edición del comprobante confirmado (el mismo que en borrador) y al
**Guardar** el sistema calcula la propuesta sin aplicar nada y abre el diálogo (§7). Al confirmar, aplica.

### 5.2 Eliminar [usuario]
- Requiere asiento en borrador y período abierto.
- Se borra el comprobante con su asiento y se corrige la cadena (§4.3).
- No deja rastro, salvo el hueco en la numeración del asiento (la numeración es correlativa por empresa y se
  asigna al crear el asiento).
- Uso típico: errores de carga.

### 5.3 Anular [usuario]
- El comprobante queda visible como **Anulada**, con rastro contable.
- Si su asiento está en borrador, se elimina (igual que en Eliminar).
- Si está **Registrado**, se genera el **contraasiento** (como la anulación de asientos actual), sin pasar por
  borrador, **con la fecha del comprobante** (no la de hoy), para que el mayor de cada mes siga coincidiendo
  con el libro IVA [decisión de diseño]. La anulación de asientos actual rechaza asientos vinculados a un
  documento; la nueva anulación se hace desde el comprobante.
- Aplica a FC, FV no AFIP, OP, RC y MF [usuario]. OP, RC y MF anulados quedan visibles con estado Anulada,
  sin efectos vigentes (sus imputaciones, movimientos de banco/caja, cheques y cuotas se revierten según §4.4)
  [decisión de diseño]. Las listas de Tesorería muestran el estado y la acción.
- La cadena se corrige igual que al eliminar, con la misma propuesta. Los registros dependientes siguen las
  reglas de §4 (sus asientos tienen que estar en borrador; si no, impedimento modificable) [decisión de diseño].
- Requiere el período del comprobante abierto [decisión de diseño, aceptada por el usuario].
- Uso típico: el comprobante existió y se quiere dejar constancia (ej.: una operación que se cayó).
- Reemplaza la anulación actual de FC y FV (que no tocaba el asiento ni los cobros).

Con asiento Registrado y período abierto, el usuario elige: **Anular** (queda contraasiento) o **Volver a
borrador + Eliminar** (no queda rastro) [usuario: "me cierra"].

## 6. Volver un asiento a borrador

- **Dónde:** Contabilidad › Asientos, acción "Volver a borrador" en un asiento Registrado [usuario].
- **Quién:** por permisos [usuario]. Se usa el mismo permiso que hoy habilita Registrar y Anular asientos
  (`accounting.entries` / `approve`) [decisión de diseño, presentada al usuario sin objeción].
- **Condiciones** [decisión de diseño, salvo período]:
  - Período del asiento abierto [ticket].
  - No es un asiento de refundición ni de apertura del cierre de ejercicio.
  - No está anulado ni es el contraasiento de una anulación.
- **Efecto:** el asiento conserva su número y vuelve a Borrador; deja de contar en mayor y balances hasta que se
  registre de nuevo (los reportes solo cuentan asientos Registrados). Se guarda quién y cuándo lo hizo (columnas
  nuevas en el asiento). Si el asiento pertenece a un comprobante, este queda editable/eliminable con el flujo
  de §5.
- **Cambio técnico:** el trigger de base `prevent_posted_entry_modification` (migración
  `20260624100000_accounting_constraints`) hoy rechaza cualquier cambio de un asiento Registrado salvo pasar a
  Anulado. Hay que habilitar **solo** la transición Registrado → Borrador (y la escritura de las columnas de
  trazabilidad), manteniendo el resto de la inmutabilidad, incluida la de las líneas mientras esté Registrado.

## 7. La pantalla de propuesta (variante A) [usuario: "es más clara"]

Diálogo "Revisá los cambios antes de guardar" (o "…antes de eliminar/anular"):

- **Resumen arriba:** "Esta corrección modifica N registros. Se aplican todos juntos al confirmar; si algo
  falla, no se aplica ninguno."
- **Una tarjeta por registro afectado**, en orden de la cadena (comprobante de origen, su asiento, cada OP/RC,
  sus movimientos de banco/caja, cheques, asientos dependientes). Cada tarjeta: título con identificación
  (tipo, número, contraparte), etiqueta de acción (**Se modifica / Se reescribe / Se elimina / Vuelve a
  cartera / …**) y filas *campo · antes (tachado) → después*. Para saldos de banco/caja se muestra el saldo
  antes → después.
- Si hace falta elegir el medio de pago del que se descuenta (§4.3), la elección va dentro de la tarjeta de
  esa OP/RC.
- Botones: **Volver a editar** (o Cancelar) y **Confirmar corrección**.
- **Con impedimentos:** aviso "Hay N impedimentos. Hasta resolverlos no se aplica ningún cambio. Tus datos
  editados quedan en el formulario." y una fila por impedimento con su etiqueta (**Podés resolverlo** / **No se
  puede**), el motivo, qué hacer y un enlace cuando exista. Confirmar deshabilitado.

Boceto de referencia: variante A de `.superpowers/brainstorm/…/propuesta-correccion.html` (local, no versionado).

Consistencia [decisión de diseño]: la propuesta se recalcula en el servidor al confirmar; si difiere de la que
se mostró (otro usuario cambió algo en el medio), no se aplica y se vuelve a mostrar la propuesta actualizada.

## 8. Permisos [decisión de diseño]

Tres capas como en el resto del sistema (`checkPermission` / `PermissionGuard` / `usePermissions`):

- Editar → `update` del módulo del comprobante; Eliminar y Anular → `delete` (es el permiso que hoy usan
  anular FC/FV y eliminar OP/RC). Módulos: `commercial.purchases`, `commercial.invoices`,
  `commercial.treasury.payment-orders`, `commercial.treasury.receipts`, `commercial.treasury.fund-movements`.
- La corrección de la cadena no exige permisos sobre cada registro dependiente: el consentimiento es sobre la
  propuesta completa.
- Volver a borrador → `accounting.entries` / `approve` (§6).

## 9. Restricciones

- Todo el trabajo de aplicación en una sola transacción de base de datos (todo o nada).
- Las reglas de negocio actuales siguen vigentes al reaplicar: las mismas validaciones y la misma construcción
  de asientos que al confirmar (`createJournalEntryFor…`, preflight de cuentas, `assertPeriodOpen`).
- El asiento en borrador del comprobante editado **se reescribe conservando su número** [decisión de diseño,
  presentada sin objeción]; no se elimina y recrea.
- Errores de negocio como `ActionResult` / `BusinessError` (Next redacta los `throw` en producción).
- Convenciones del proyecto: moment.js, fecha de negocio en hora argentina, logger, Decimal → Number, sin
  imports entre módulos (lo común va a `shared/`), client components con `_` y < 200 líneas.
- Tests: Vitest (no hay Cypress). La lógica que arma la propuesta debe poder probarse sin base (funciones puras
  sobre una foto de los datos).
- Entregables obligatorios por ticket: guía in-app (Contabilidad › Asientos y las guías de Compras, Ventas y
  Tesorería), docs de desarrollador (`docs/modules/accounting.md`, `commercial.md`, `data-model.md`,
  `auth-and-permissions.md` si cambia algo), y la presentación PDF al cliente (`docs/presentaciones/`).
- Rama `feat/tsk-792-correccion-en-cadena`, creada sobre `feat/tsk-791-conceptos` (PR #38 sin mergear) porque
  la edición de MF depende del código de conceptos [decisión de diseño].

## 10. Queda a criterio del implementador

- La arquitectura del motor (sugerencia: un "planificador" puro que, dada la foto del comprobante y su cadena
  más los datos nuevos, devuelve la propuesta y los impedimentos; y un "aplicador" que ejecuta la propuesta en
  la transacción). Dónde vive cada parte respetando la regla de no importar entre módulos.
- Cómo se divide el trabajo en etapas. Sugerencia de orden: (1) volver a borrador + trigger; (2) trazabilidad
  y backfill; (3) motor + FC/OP; (4) FV/RC (incluye la edición de RC); (5) MF; (6) Anular sobre el motor;
  (7) guías, docs y PDF.
- Qué conserva un comprobante anulado de sus vínculos (ej.: si la OP anulada mantiene la lista de facturas que
  pagaba como dato histórico o se borran sus imputaciones), siempre que deje de afectar saldos y estados.
- Textos exactos de etiquetas y mensajes, siguiendo el tono de la variante A.
- Si "Editar" se ofrece en tablas además del detalle, y cómo se muestra cuando no está disponible.
