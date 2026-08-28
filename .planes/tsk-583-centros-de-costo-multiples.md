# TSK-583 — Centros de costo obligatorios y reparto entre varios centros

**Fecha:** 2026-08-28
**Ticket:** [583] "[Comercial] palabra confusa y falta la elección de CC" — **reabierto**
**Reportante:** Elizabeth Perez (eperez@perezmarzo.com.ar)
**Rama base:** `feat/lote-correcciones-cliente-2026-08`
**Estado:** diseño aprobado, pendiente de plan de implementación

---

## 1. Por qué se reabrió

La primera entrega resolvió los tres pedidos originales del ticket: renombrar "Costo
Unitario" a "Valor Unitario", agregar centro de costo por línea de factura de compra y
permitir la confirmación masiva. La usuaria reabrió con esta aclaración:

> No sé si quedó claro que si elijo trabajar obligatoriamente con centros de costos, tengo
> que imputar a alguna en cualquier factura compra o venta que tenga ítems relacionados con
> cuentas contables en las 4, o sea, ingresos o egresos. No activo, ni pasivo. Y también
> puede ser que sea 100% a 1 cc o mitad a 2 cc. Etc.

Son dos requisitos que la primera entrega no cubre:

1. **Obligatoriedad configurable.** Si la empresa decide trabajar con centros de costo, la
   imputación deja de ser opcional en toda factura de compra o venta con ítems imputados a
   cuentas de resultado.
2. **Reparto entre varios centros.** Una misma línea puede dividirse: 100% a un centro, o
   mitad y mitad entre dos, o cualquier proporción.

El segundo requisito es el que fuerza el rediseño: `PurchaseInvoiceLine.costCenterId` es
**una columna**, y un reparto son **N filas**.

## 2. Estado actual del código

- **Compras:** `PurchaseInvoiceLine.costCenterId` (opcional, un centro por línea). El asiento
  agrupa por `cuenta::centro` — `integrations/commercial/index.ts:470-491`.
- **Ventas:** `SalesInvoiceLine` no tiene centro de costo. El asiento agrupa solo por cuenta
  y hereda el predeterminado del ítem quedándose con **el primero que encuentra**
  (`integrations/commercial/index.ts:332`). Es el mismo bug que se corrigió en compras y
  sigue vivo acá: una venta con ítems de distintos centros imputa todo a uno solo.
- **Criterio de cuenta de resultado:** ya resuelto en
  `purchases/features/invoices/shared/cost-center.ts` (`RESULT_ACCOUNT_TYPES`,
  `allowsCostCenter`) con tests.
- **Configuración:** `AccountingSettings` concentra las cuentas por defecto de la empresa.
- `JournalEntryLine.costCenterId` ya existe: el asiento puede recibir el reparto sin
  cambios de modelo.
- La migración `20260819021225_add_cost_center_to_purchase_invoice_line` está aplicada en
  desarrollo. En producción no, porque el ticket quedó pendiente de deploy.

## 3. Decisiones tomadas

| Decisión | Elección | Por qué |
|---|---|---|
| Nivel del reparto | **Por línea**, con atajo "aplicar a todas las líneas" | Cubre tanto el ítem que va a un centro como la factura repartida entera, con un solo modelo de datos |
| Momento de la exigencia | **Al confirmar** | Permite cargar en borrador y completar después, que es como trabaja la usuaria; además el asiento se genera al confirmar |
| Forma de carga | **Porcentaje**, importe calculado | Es como lo plantea ella ("mitad a 2 cc"); el importe derivado evita descuadres |
| Alcance | **Compras y ventas** (NC/ND incluidas por `voucherType`) | Es lo que pide el feedback textual, y arrastra la corrección del bug de ventas |
| Modelo de datos | **Dos tablas gemelas** | FK obligatorias, cascada directa y unicidad garantizada por la base |

## 4. Modelo de datos

```
purchase_invoice_line_cost_centers      sales_invoice_line_cost_centers
  id                                      id
  line_id        FK → purchase_...        line_id        FK → sales_invoice_lines
  cost_center_id FK → cost_centers        cost_center_id FK → cost_centers
  percentage     Decimal(5,2)             percentage     Decimal(5,2)
  UNIQUE (line_id, cost_center_id)        UNIQUE (line_id, cost_center_id)
```

Las dos tablas son gemelas a propósito: cada una con FK obligatorias y borrado en cascada
desde su línea, y la base impide por sí sola que un centro se repita dentro de una línea.
"Gemelas" no implica lógica duplicada — el prorrateo y la validación viven en un helper
único.

`AccountingSettings` suma `requireCostCenter Boolean @default(false)`. Apagado por defecto:
ninguna empresa existente cambia de comportamiento al desplegar.

`PurchaseInvoiceLine.costCenterId` **se elimina**. La migración copia lo que haya como
reparto al 100% (`INSERT … SELECT`) antes del `DROP COLUMN`. Ese insert es inofensivo si la
tabla está vacía, así que la migración es segura tanto si la primera entrega llegó a
producción como si no. No se mantienen dos fuentes de verdad para el mismo dato.

## 5. Reglas de negocio

**Un reparto o suma exactamente 100% o está vacío.** Vale siempre, con la obligatoriedad
apagada también: un 60% suelto sería plata sin imputar y no se guarda nunca.

**Con `requireCostCenter` activo:** al confirmar, toda línea cuyo ítem se impute a una cuenta
de resultado debe tener reparto completo. Si falta, la confirmación se rechaza nombrando las
líneas incompletas. La confirmación masiva omite esas facturas, sigue con el resto e informa
el motivo — el mecanismo ya existe de la primera entrega.

**Con `requireCostCenter` inactivo:** el reparto vacío es válido y se comporta como hoy, o
sea cae al centro predeterminado del ítem.

**Solo se reparte el neto de la línea (`subtotal`).** El IVA no: va a la cuenta de IVA
crédito o débito fiscal, que no es de resultado y no admite centro de costo.

**Prorrateo.** Se redondea a 2 decimales y **el último centro absorbe la diferencia**. Sin
eso, un 33/33/33 sobre $100 descuadra el asiento por un centavo y la factura no se puede
confirmar.

**Asiento.** Cada línea se expande en tantas imputaciones como centros tenga, agrupando por
`cuenta + centro`. Se aplica igual en compras y en ventas, lo que de paso corrige el bug del
primer centro en ventas.

**Facturas ya confirmadas:** no se tocan. La validación corre al confirmar, así que activar
el switch no invalida historia ni obliga a recargar nada.

## 6. Interfaz

El `Select` simple de la línea pasa a ser un editor de reparto: arranca con una fila al 100%
(el centro predeterminado del ítem, si tiene), se agregan filas con "+", cada una con centro
y porcentaje, y un pie que muestra el acumulado en verde o rojo según llegue a 100.

```
Línea: Combustible   $100.000,00
  Logística      60,00 %   $60.000,00
  Mantenimiento  40,00 %   $40.000,00
  ─────────────────────────────────
  Total         100,00 %  $100.000,00 ✓
  [ Aplicar este reparto a todas las líneas ]
```

Con un solo centro al 100% se ve prácticamente igual que hoy: el caso simple no se complica.
El editor es **un componente**, `modules/commercial/shared/components/_CostCenterAllocationField.tsx`,
usado por los formularios de compra y de venta. Ambos viven bajo `modules/commercial/`, así
que no cruza fronteras de módulo: es el mismo patrón que ya usan `shared/voucher-utils.ts` y
`shared/components/_PDFOptionsDialog.tsx`.

El switch de obligatoriedad va en Configuración Contable, como *"Exigir centro de costo en
líneas imputadas a cuentas de resultado"*.

## 7. Archivos

| Capa | Archivos |
|---|---|
| Datos | `prisma/schema.prisma` + migración manual (crear tablas, copiar datos, eliminar columna, agregar `require_cost_center`) |
| Helper | `cost-center.ts` pasa de `purchases/features/invoices/shared/` a `modules/commercial/shared/cost-center.ts`; suma prorrateo y validación del 100% |
| Compras | `_PurchaseInvoiceForm.tsx`, `EditPurchaseInvoice.tsx`, validators, actions de create/edit y de confirmación individual y masiva |
| Ventas | `_InvoiceForm.tsx` y sus actions, en espejo |
| Asiento | `integrations/commercial/index.ts` — expansión por centro en compras y ventas, y el bug de la línea 332 |
| Config | `_CommercialIntegrationForm.tsx` + validators + action de settings |

## 8. Pruebas

**Vitest** — lo que tiene lógica real:
- Prorrateo: 33/33/34 sobre $100 (el caso del centavo), reparto de un solo centro, importes con decimales.
- Validación: suma 100 válida, vacío válido, 60% suelto inválido, centro repetido inválido.
- Obligatoriedad: confirma con el switch apagado y línea vacía; rechaza con el switch activo.
- Asiento: agrupación por cuenta + centro, IVA fuera del reparto, asiento balanceado.
- Confirmación masiva: omite las incompletas informando el motivo y confirma el resto.

Se actualizan `cost-center.test.ts` y `bulk-confirm.test.ts` en vez de duplicarlos.

**Cypress** — carga de una factura repartida entre dos centros, en compras y en ventas.

## 9. Documentación

Tres entregables, todos obligatorios para dar el ticket por cerrado:

1. **Guía de usuario in-app** (`src/modules/help/`) — regla 10 del proyecto. Es un cambio
   visible: cómo repartir una línea y qué significa el switch de obligatoriedad.
2. **Documentación técnica** (`docs/`) — el modelo de datos nuevo y el criterio de prorrateo.
3. **Guía de presentación para el cliente** — ver abajo.

### Guía de presentación para el cliente

**Aplica a todos los tickets que se resuelvan, no solo a este.** Por cada ticket entregado
hay que dejar material para mostrarle al cliente qué cambió y cómo se usa. No alcanza con el
`completion_summary` del ticket: eso explica qué se hizo, no cómo usarlo.

Contenido mínimo por ticket:

- Qué pedía el ticket, en las palabras del cliente.
- Qué cambió en pantalla, con capturas del antes y el después.
- Cómo se usa, paso a paso, con un ejemplo concreto y realista.
- Qué configuración hace falta, si la hay (en este ticket: activar el switch).
- Qué **no** cambió, cuando hay riesgo de que se asuma de más.

Para el 583, el ejemplo a mostrar es una factura de servicios repartida entre dos centros de
costo, siguiendo el flujo completo: cargar, repartir, confirmar y ver el asiento resultante
con las dos imputaciones separadas.

Formato: página web publicada como Artifact, que se comparte por link y admite capturas.
Se acumula ticket por ticket para poder presentar un lote entero de una vez.

## 10. Fuera de alcance

- Órdenes de compra, remitos, gastos y movimientos de fondos: no reciben reparto en esta
  entrega, aunque generen asientos con cuentas de resultado.
- Presupuestos por centro de costo: `checkBudgetForExpense` no se toca.
- Reportes por centro de costo: el reparto queda disponible en el asiento, pero no se crean
  reportes nuevos.
- Reimputar facturas ya confirmadas.

## 11. Riesgos

- **La migración elimina una columna.** Trae copia de datos previa y es reversible, pero
  conviene aplicarla en el mismo deploy que destraba los demás tickets, no suelta.
- **Corregir el bug de ventas cambia asientos futuros** de empresas que hoy tienen ítems con
  centros distintos en una misma factura: pasarán a imputar a varios centros en lugar de a
  uno. Es la corrección buscada, pero hay que anunciarla en la guía de presentación.
