## Why

TSK-644 (reportado por Elizabeth Perez, Perez Marzo): al cargar en PMS una factura de compra
real —el ticket adjunta una factura de La Anónima— no hay dónde registrar las **percepciones**
(Percep. NQN $1.832,43 y Percep. IVA $4.128,01) ni el **impuesto interno** ($326,95). Hoy el
usuario debe inventar líneas de gasto para que el total cierre, lo que ensucia el neto gravado,
distorsiona el Libro IVA y desvirtúa el crédito fiscal que la empresa efectivamente puede computar.

El sistema ya tiene la mitad del camino hecho, y por eso el hueco es visible:

- Existen los modelos `PurchaseInvoicePerception` y `SalesInvoicePerception` (tipo IVA/IIBB/MUNICIPAL,
  jurisdicción, tasa, base y monto).
- El asiento contable de compras **ya imputa percepciones sufridas** y el de ventas las percepciones
  cobradas (`src/modules/accounting/features/integrations/commercial/index.ts`).
- Libro IVA, Libro IVA Digital, SIRE y la emisión ARCA **ya leen** `invoice.perceptions`.

Lo único que falta es que alguien pueda cargarlas: ni el formulario, ni el validator Zod, ni las
server actions de creación/edición las contemplan. Las tablas están siempre vacías y todo el
andamiaje aguas abajo trabaja sobre cero.

Además hay dos defectos latentes que este cambio corrige, porque comparten la misma raíz:

1. **Asiento descuadrado en facturas importadas de AFIP.** `afip-import.server.ts` sí graba
   `otherTaxes = otrosTributos`, y el total importado los incluye. Pero el asiento de compra debita
   compras + IVA y acredita `total`: si `otherTaxes > 0`, `validateBalance()` lanza, el error se
   traga como `logger.warn` y la factura queda **confirmada sin asiento contable**, en silencio.
2. **Rechazo de ARCA en ventas.** La emisión manda `impTrib = otherTaxes` pero arma el array
   `tributos` desde `perceptions`. Como hoy ambas cosas valen cero, coincide por accidente; en
   cuanto se cargue una percepción sin unificar el criterio, AFIP rechaza el CAE porque exige
   `ImpTrib == Σ Tributos.Importe`.

## What Changes

**Alcance**: facturas de compra **y** de venta (decisión del usuario: hacerlo simétrico en un
solo pase, reusando el mismo componente de carga).

- **Percepciones**: sección nueva en el formulario de factura (compra y venta) para agregar N
  percepciones con tipo (IVA / IIBB / Municipal), jurisdicción, base imponible y monto. La tasa se
  deriva de base y monto; no hay padrón ni autocompletado (decisión del usuario: carga manual, el
  usuario copia lo que dice el comprobante).
- **Impuestos internos**: un campo de monto único a nivel cabecera, cargado a mano, tal como
  aparece en el comprobante del proveedor.
- **Semántica unificada de `otherTaxes`**: pasa a ser *la suma de todos los tributos no-IVA*
  (percepciones + impuestos internos), que es exactamente lo que AFIP entiende por "Otros Tributos".
  El desglose vive en la tabla `*_invoice_perceptions` y en un campo nuevo `internalTaxes`. Esto
  alinea de una vez la carga manual, la importación AFIP y la emisión de CAE.
- **Total**: pasa de `subtotal + vatAmount` a `subtotal + vatAmount + otherTaxes`.
- **Asiento contable**: se agrega la línea de impuestos internos contra una cuenta nueva de
  configuración contable (`internalTaxesAccountId`), y la cuenta faltante de percepción **MUNICIPAL**
  —hoy `getPerceptionAccountId` solo mapea IVA e IIBB, así que una percepción municipal se
  descartaría del asiento y lo dejaría descuadrado.
- **ARCA**: `tributos` incluye las percepciones **y** el impuesto interno (tributo AFIP id 4), de
  modo que `impTrib` siempre cuadre con la sumatoria.
- **Visualización**: detalle de factura y PDF muestran las percepciones desglosadas (tipo,
  jurisdicción, monto) y el impuesto interno, en vez del actual renglón mudo "Otros Impuestos".

**Fuera de alcance**: padrón automático de alícuotas (`TaxRatePadron` ya existe pero no se usa
acá), retenciones (son del circuito de pagos/cobros y ya están implementadas), percepciones en
órdenes de compra, remitos o notas de pedido.

## Capabilities

### New Capabilities
- `commercial/invoice-perceptions`: carga, cálculo y persistencia de percepciones (IVA, IIBB,
  Municipal) e impuestos internos en facturas de compra y de venta, incluyendo su efecto sobre los
  totales del comprobante.

### Modified Capabilities
<!-- Sin specs previas en openspec/specs: OpenSpec se inicializó con este cambio, así que el
     comportamiento contable y fiscal afectado se documenta como escenarios dentro de la
     capability nueva. -->

## Impact

**Base de datos** (`prisma/schema.prisma` + migración):
- `AccountingSettings`: nuevos `internalTaxesAccountId` y `perceptionMunicipalSufferedAccountId` /
  `perceptionMunicipalCollectedAccountId`.
- `PurchaseInvoice` / `SalesInvoice`: nuevo campo `internalTaxes Decimal @default(0)`.

**Compras** (`src/modules/commercial/features/purchases/features/invoices/`):
- `shared/validators.ts` — schema de percepciones e impuestos internos.
- `create/components/_PurchaseInvoiceForm.tsx` — sección de carga y recálculo de totales.
- `list/actions.server.ts` — `createPurchaseInvoice`, `updatePurchaseInvoice`, `getPurchaseInvoiceById`.
- `detail/PurchaseInvoiceDetail.tsx`, `shared/pdf/*` — desglose.
- `list/lib/afip-import.server.ts` — poblar `internalTaxes` coherentemente con `otherTaxes`.

**Ventas** (`src/modules/commercial/features/sales/features/invoices/` y `sales/shared/pdf/`):
mismos puntos, más `arca/actions.server.ts` para el armado de `tributos` / `impTrib`.

**Contabilidad** (`src/modules/accounting/features/`):
- `integrations/commercial/index.ts` — líneas de impuesto interno y percepción municipal en ambos asientos.
- `settings/` (`actions.server.ts`, `validators.ts`, `_CommercialIntegrationForm.tsx`) — cuentas nuevas.

**Reportes fiscales**: Libro IVA, Libro IVA Digital y SIRE empiezan a recibir datos reales donde
antes leían cero; hay que verificar que el desglose por tipo siga cuadrando.

**Documentación y tests**: guía de usuario (`_CommercialGuide.tsx`), `docs/`, specs de Cypress de
compras y ventas, y la guía de presentación al cliente del ticket.
