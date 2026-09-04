## Context

El andamiaje de percepciones ya existe y funciona; lo que falta es la puerta de entrada. Eso
condiciona todo el diseño: **no se inventa un modelo nuevo**, se completa el circuito existente.

Estado verificado en el código (a la fecha del cambio):

| Pieza | Estado |
|---|---|
| `PurchaseInvoicePerception` / `SalesInvoicePerception` (Prisma) | Existen, con `type`, `jurisdiction`, `rate`, `baseAmount`, `amount` |
| `PerceptionType` | `IVA \| IIBB \| MUNICIPAL` |
| Asiento de compra (`createJournalEntryForPurchaseInvoice`) | Ya recorre `invoice.perceptions` |
| Asiento de venta (`createJournalEntryForSalesInvoice`) | Ídem, lado "collected" |
| `getPerceptionAccountId` | Mapea **solo** IVA e IIBB — `MUNICIPAL` cae en `null` |
| Libro IVA, IVA Digital, SIRE, ARCA | Ya leen `invoice.perceptions` |
| Formularios, validators y actions de compra y venta | **No las contemplan** |
| `otherTaxes` (cabecera) | Se muestra en detalle y PDF; se graba `0` salvo importación AFIP |
| Asiento contable | **No contempla `otherTaxes`** |

Dos consecuencias de ese último punto que ya son bugs hoy, sin tocar nada:

1. `afip-import.server.ts` graba `otherTaxes = otrosTributos` y `total = impTotal`. Al confirmar,
   el asiento debita compras + IVA y acredita `total`: si `otherTaxes > 0`, `validateBalance()`
   lanza, `confirmPurchaseInvoice` lo captura como `logger.warn` (solo re-lanza si el mensaje
   incluye "período está cerrado") y la factura **queda confirmada sin `journalEntryId`**.
2. `arca/actions.server.ts` envía `impTrib: Number(invoice.otherTaxes)` pero arma `tributos` desde
   `invoice.perceptions`. AFIP valida `ImpTrib == Σ Tributos.Importe`; hoy coincide porque ambos
   son cero.

## Goals / Non-Goals

**Goals:**
- Una sola semántica de "otros tributos" que sirva a la carga manual, la importación AFIP y ARCA.
- Asiento contable balanceado en toda factura con tributos, sin fallos silenciosos.
- Un componente de carga compartido entre compras y ventas, no dos implementaciones paralelas.
- Corregir de paso los dos bugs latentes descritos arriba: son la misma raíz, no scope creep.

**Non-Goals:**
- Padrón automático de alícuotas (`TaxRatePadron` existe pero queda sin usar acá).
- Retenciones: son del circuito de pagos/cobros y ya están implementadas.
- Percepciones en órdenes de compra, remitos o notas de pedido.
- Recalcular retroactivamente facturas ya confirmadas.

## Decisions

### 1. `otherTaxes` es un agregado derivado, no un campo de captura

`otherTaxes = Σ percepciones.amount + internalTaxes`, siempre calculado en el servidor a partir del
detalle. Se agrega `internalTaxes Decimal @default(0)` a `PurchaseInvoice` y `SalesInvoice` para
guardar el impuesto interno discriminado.

*Por qué*: "Otros Tributos" es literalmente lo que AFIP entiende por ese campo, e incluye las
percepciones. Es la semántica que ya usa la importación AFIP (`otrosTributos`) y la que espera
`impTrib`. Guardar ahí solo los impuestos internos obligaría a tocar ambos y a mantener dos
criterios distintos en el mismo campo.

*Alternativa descartada*: `otherTaxes` = solo internos, con las percepciones sumadas aparte. Deja
`impTrib` inconsistente con `tributos` en ARCA y rompe la importación AFIP existente.

*Consecuencia*: hay que revisar que ningún consumidor sume `otherTaxes` **y** `perceptions` a la vez.
El Libro IVA hoy expone ambas columnas por separado (`perceptions` y `otherTaxes`) — con la nueva
semántica, `otherTaxes` incluiría las percepciones y la fila se leería doble. La columna "Otros Imp."
del Libro IVA pasa a mostrar `internalTaxes`, no `otherTaxes` (spec: "Trazabilidad fiscal").

### 2. El impuesto interno va a cabecera, no a línea

Campo único de monto, ingresado a mano. Es lo que imprime el comprobante del proveedor (el ticket
de La Anónima muestra un único renglón "IMP.INTERNOS") y evita migrar `purchase_invoice_lines`.

*Trade-off*: no queda base imponible por alícuota de impuesto interno. Para el circuito de compras
—que es donde el impuesto interno es un costo, no una obligación a liquidar— no hace falta. Si en
el futuro la empresa emite comprobantes con impuestos internos propios y necesita liquidarlos por
alícuota, se agrega el desglose sin romper este campo.

### 3. Cuentas contables nuevas en `AccountingSettings`

- `internalTaxesAccountId` — imputación del impuesto interno.
- `perceptionMunicipalSufferedAccountId` y `perceptionMunicipalCollectedAccountId` — cierran el
  hueco de `getPerceptionAccountId`, que hoy devuelve `null` para `MUNICIPAL`.

La segunda no estaba en el pedido original, pero sin ella el tipo `MUNICIPAL` —que el enum ya
ofrece y el selector va a exponer— se descartaría del asiento y lo dejaría descuadrado. Es
requisito de consistencia del cambio, no una extensión.

*Cuenta sugerida en el plan modelo*: las percepciones sufridas son crédito fiscal (activo); el
impuesto interno de compras es mayor costo o cuenta de resultado, según el criterio del contador.
La configuración lo deja abierto; el modelo de plan de cuentas (`model-chart-of-accounts.ts`) puede
sumar las cuentas sugeridas.

### 4. Falta de cuenta configurada: error explícito, no `warn` silencioso

Hoy cualquier fallo al armar el asiento se traga como `logger.warn` salvo el de período cerrado.
Con tributos en juego eso significa facturas confirmadas sin asiento y descubiertas semanas después.

Al confirmar, si hay tributos cuya cuenta no está configurada, `confirmPurchaseInvoice` /
`confirmInvoice` (ventas) **abortan la confirmación** con un mensaje que nombra la cuenta faltante,
igual que ya se hace con el centro de costo obligatorio (`buildMissingCostCenterMessage`, TSK-583).
La validación va **antes** de abrir la transacción, para no dejar estado a medias.

### 5. Un componente de carga compartido

`src/modules/commercial/shared/perceptions/` — componente cliente `_PerceptionsField.tsx` (tabla
editable con `useFieldArray`) más el schema Zod y el helper de cálculo de totales. Compras y ventas
lo consumen. Va en `commercial/shared/` porque ambos son features del **mismo** módulo `commercial`
(no cruza módulos, así que no viola la regla de comunicación entre módulos), siguiendo el precedente
de `commercial/shared/allocation-form` y `commercial/shared/cost-center`.

La tasa se muestra calculada y en solo lectura (`monto / base × 100`, 3 decimales, que es la
precisión de `Decimal(6,3)` del modelo). Se persiste porque ARCA la necesita en `alic`.

### 6. `baseAmount` lo ingresa el usuario

No se autocompleta con el neto gravado de la factura. Las percepciones de IIBB provinciales suelen
calcularse sobre neto + IVA, y las de IVA sobre el neto, según el régimen: adivinar la base produce
tasas erróneas en el asiento y en ARCA. El formulario ofrece el neto gravado como valor sugerido
inicial, editable.

### 7. Migración de datos existentes

Ninguna. `internalTaxes` arranca en `0` y `otherTaxes` conserva su valor. Para comprobantes
importados de AFIP en borrador conviene un backfill de una línea —`internalTaxes = otherTaxes`
donde `otherTaxes > 0`— para que su asiento pueda generarse balanceado; las facturas ya confirmadas
sin asiento quedan como están y se listan aparte para que el contador decida (ver tarea 8.3).

## Risks / Trade-offs

- **Doble conteo en reportes.** Es el riesgo principal: `otherTaxes` cambia de significado y hay
  siete consumidores (`reports/actions.server.ts`, `_LibroIVATable.tsx`, `libro-iva-digital`,
  `sire`, `arca`, ambos PDF, ambos detalles). Mitigación: la tarea 6 los recorre uno por uno y hay
  un test de integración que compara el total del comprobante contra la suma del desglose.

- **Facturas importadas ya confirmadas sin asiento.** El backfill no las arregla: confirmar es
  irreversible. Se entregan listadas para decisión contable, no se tocan automáticamente.

- **Cambio de comportamiento al confirmar.** Pasar de `warn` a error significa que una factura que
  antes se confirmaba (mal) ahora falla si faltan cuentas. Es el comportamiento correcto, pero
  conviene avisarlo en la guía de presentación al cliente: puede aparecer como "regresión" en
  empresas con configuración contable incompleta.

- **Precisión.** `rate` es `Decimal(6,3)`: una percepción de $0,01 sobre una base grande redondea a
  `0.000`. El monto se guarda tal cual lo ingresó el usuario y es el que manda en asiento y total;
  la tasa es informativa salvo en ARCA, donde AFIP tolera la diferencia porque valida por importe.
