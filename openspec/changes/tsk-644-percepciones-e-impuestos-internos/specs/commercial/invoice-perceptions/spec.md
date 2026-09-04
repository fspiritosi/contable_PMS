## Purpose

Permitir que una factura de compra o de venta registre los tributos no-IVA que trae el
comprobante —percepciones de IVA, Ingresos Brutos y municipales, e impuestos internos— de modo que
el total, el asiento contable, los libros fiscales y la emisión electrónica reflejen el
comprobante real en lugar de forzar al usuario a disfrazarlos como líneas de gasto.

## ADDED Requirements

### Requirement: Carga de percepciones en una factura

El sistema SHALL permitir asociar cero o más percepciones a una factura de compra y a una factura
de venta mientras el comprobante esté en estado borrador. Cada percepción SHALL registrar tipo
(IVA, IIBB o Municipal), jurisdicción opcional, base imponible y monto. La tasa SHALL derivarse de
la base y el monto, y no se pide al usuario.

#### Scenario: Alta de percepciones sobre una factura de compra

- **WHEN** el usuario carga la factura de La Anónima y agrega una percepción de IIBB con
  jurisdicción "NQN" por $1.832,43 y una percepción de IVA por $4.128,01
- **THEN** ambas quedan guardadas contra la factura con su tipo, jurisdicción, base y monto, y la
  tasa registrada de cada una es `monto / base × 100` redondeada a tres decimales

#### Scenario: Percepción sin monto

- **WHEN** el usuario intenta guardar una percepción con monto cero o negativo
- **THEN** el sistema rechaza el guardado e informa que el monto debe ser mayor a cero

#### Scenario: Base imponible ausente

- **WHEN** el usuario carga una percepción con monto pero sin base imponible
- **THEN** el sistema rechaza el guardado e informa que la base es requerida para calcular la tasa

#### Scenario: Edición de una factura confirmada

- **WHEN** el usuario intenta modificar las percepciones de una factura ya confirmada
- **THEN** el sistema lo impide, con el mismo criterio que rige hoy para las líneas del comprobante

### Requirement: Carga de impuestos internos

El sistema SHALL permitir registrar un monto de impuestos internos a nivel cabecera de la factura,
ingresado manualmente por el usuario tal como figura en el comprobante.

#### Scenario: Alta de impuesto interno

- **WHEN** el usuario ingresa $326,95 de impuestos internos en la factura de compra
- **THEN** el monto queda guardado en el comprobante y se refleja en el total

#### Scenario: Monto no informado

- **WHEN** el usuario deja el campo de impuestos internos vacío
- **THEN** el comprobante se guarda con impuestos internos en cero y el total no se ve afectado

#### Scenario: Monto negativo

- **WHEN** el usuario ingresa un monto negativo de impuestos internos
- **THEN** el sistema rechaza el guardado e informa que el monto no puede ser negativo

### Requirement: Composición del total del comprobante

El total de una factura SHALL ser la suma del subtotal neto, el IVA y los otros tributos, donde
"otros tributos" SHALL ser la suma de todas las percepciones más los impuestos internos. El
comprobante SHALL exponer ese agregado además del desglose, porque es el valor que AFIP entiende
por "Otros Tributos".

#### Scenario: Total de la factura del ticket

- **WHEN** se carga una factura con neto gravado $183.242,70, IVA $28.896,06, percepciones por
  $5.960,44 e impuestos internos por $326,95
- **THEN** los otros tributos del comprobante valen $6.287,39 y el total vale $218.426,15

<!-- El ticket de La Anónima imprime $218.426,14: un centavo de diferencia por el redondeo del
     IVA en el emisor. El sistema no fuerza el total al del comprobante; si la diferencia
     importa, el usuario la ajusta en la línea correspondiente. -->


#### Scenario: Recálculo en vivo durante la carga

- **WHEN** el usuario agrega, edita o elimina una percepción, o cambia el impuesto interno, en el
  formulario de la factura
- **THEN** el panel de totales del formulario actualiza otros tributos y total sin recargar la página

#### Scenario: Deuda con el proveedor y con el cliente

- **WHEN** una factura de compra con percepciones e impuestos internos se confirma
- **THEN** el saldo a pagar al proveedor —y el importe ofrecido al armar la orden de pago— es el
  total con tributos incluidos, no el neto más IVA

### Requirement: Imputación contable de los tributos

Al confirmar una factura, el asiento contable SHALL incluir una línea por cada percepción contra su
cuenta correspondiente y una línea por los impuestos internos, de modo que el asiento cierre contra
el total del comprobante. Las percepciones sufridas en compras y los impuestos internos van al
debe; las percepciones cobradas en ventas, al haber.

#### Scenario: Asiento de compra con percepciones e impuestos internos

- **WHEN** se confirma una factura de compra con percepciones de IVA e IIBB e impuestos internos
- **THEN** el asiento debita compras, IVA crédito fiscal, cada percepción sufrida en su cuenta y los
  impuestos internos en su cuenta, y acredita el total a cuentas por pagar, quedando balanceado

#### Scenario: Percepción municipal

- **WHEN** se confirma una factura que incluye una percepción de tipo Municipal
- **THEN** el asiento la imputa a la cuenta de percepción municipal configurada, sin descartarla

#### Scenario: Cuenta de tributo sin configurar

- **WHEN** se confirma una factura con un tributo cuya cuenta contable no está configurada en la
  configuración contable
- **THEN** el sistema no genera un asiento descuadrado: informa al usuario qué cuenta falta configurar
  y no deja la factura confirmada sin asiento de forma silenciosa

#### Scenario: Nota de crédito con percepciones

- **WHEN** se confirma una nota de crédito de compra que incluye percepciones
- **THEN** el asiento invierte el sentido de todas las líneas de tributos igual que hace con compras e IVA

### Requirement: Configuración de cuentas de tributos

La configuración contable de la empresa SHALL permitir designar la cuenta de impuestos internos y
las cuentas de percepción municipal cobrada y sufrida, junto a las cuentas de percepción de IVA e
IIBB ya existentes.

#### Scenario: Alta de las cuentas nuevas

- **WHEN** el usuario abre la configuración contable de la empresa
- **THEN** puede seleccionar cuenta de impuestos internos, percepción municipal sufrida y percepción
  municipal cobrada, y guardarlas junto al resto de la configuración

### Requirement: Visualización del desglose de tributos

El detalle de la factura y su PDF SHALL mostrar cada percepción con su tipo, jurisdicción y monto, y
el impuesto interno como renglón propio, en lugar de un único importe agregado sin explicación.

#### Scenario: Detalle de una factura con tributos

- **WHEN** el usuario abre el detalle de una factura de compra con dos percepciones e impuesto interno
- **THEN** ve "Percepción IVA", "Percepción IIBB NQN" e "Impuestos Internos" como renglones separados
  entre el IVA y el total

#### Scenario: Factura sin tributos

- **WHEN** la factura no tiene percepciones ni impuestos internos
- **THEN** el detalle y el PDF no muestran renglones de tributos vacíos ni en cero

### Requirement: Consistencia con la emisión electrónica ARCA

Al solicitar CAE para una factura de venta, el sistema SHALL informar cada percepción y el impuesto
interno como tributos, y el importe total de tributos SHALL coincidir con la suma de esos tributos
informados, tal como exige AFIP.

#### Scenario: CAE de una factura con percepciones e impuesto interno

- **WHEN** se solicita CAE de una factura de venta con percepciones e impuestos internos
- **THEN** el pedido informa un tributo por cada percepción y uno de impuestos internos, y el importe
  total de tributos es igual a la suma de los importes informados

#### Scenario: Factura sin tributos

- **WHEN** se solicita CAE de una factura sin percepciones ni impuestos internos
- **THEN** el pedido no informa tributos y el importe total de tributos es cero

### Requirement: Coherencia de los comprobantes importados de AFIP

Los comprobantes importados desde AFIP SHALL quedar con la misma semántica de tributos que los
cargados a mano, de forma que puedan confirmarse y generar asiento sin intervención manual.

#### Scenario: Importación con otros tributos

- **WHEN** se importa desde AFIP un comprobante recibido cuyo campo de otros tributos es mayor a cero
- **THEN** el importe queda registrado como impuestos internos del comprobante y, al confirmarlo, el
  asiento contable se genera balanceado en lugar de omitirse

#### Scenario: Ajuste posterior del desglose

- **WHEN** el usuario edita un comprobante importado en borrador y desglosa parte de esos tributos
  como percepciones
- **THEN** el sistema no reasigna montos por su cuenta: el usuario baja el monto de impuestos
  internos a mano, y el panel de totales le muestra en vivo los otros tributos y el total
  resultantes para que vea de inmediato si el comprobante deja de cerrar

### Requirement: Trazabilidad fiscal de los tributos

Los reportes fiscales que ya contemplan percepciones —Libro IVA, Libro IVA Digital y SIRE— SHALL
reflejar los montos cargados, y el total de otros tributos informado en esos reportes SHALL ser
consistente con el desglose del comprobante.

#### Scenario: Libro IVA de compras con percepciones

- **WHEN** el usuario genera el Libro IVA de compras de un período que incluye la factura con
  percepciones e impuestos internos
- **THEN** la columna de percepciones muestra $5.960,44 para ese comprobante y la de otros impuestos
  no vuelve a contar ese mismo importe
