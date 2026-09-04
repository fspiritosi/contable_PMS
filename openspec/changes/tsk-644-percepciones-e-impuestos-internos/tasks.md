## 1. Modelo de datos y configuración contable

- [x] 1.1 `prisma/schema.prisma`: agregar `internalTaxes Decimal @default(0) @map("internal_taxes") @db.Decimal(12, 2)` a `PurchaseInvoice` y a `SalesInvoice`.
- [x] 1.2 `prisma/schema.prisma`: agregar a `AccountingSettings` los campos `internalTaxesAccountId`, `perceptionMunicipalSufferedAccountId` y `perceptionMunicipalCollectedAccountId` con sus relaciones `Account?` (nombres de relación nuevos, no reutilizar los existentes).
- [x] 1.3 Crear la migración (`npm run db:migrate`) y verificar que el SQL generado no toque datos existentes.
- [x] 1.4 Regenerar el cliente Prisma (`npm run db:generate`) y confirmar que `src/generated/prisma/` refleja los campos nuevos.
- [x] 1.5 Verificar la cobertura del plan de cuentas modelo. **No se edita** `model-chart-of-accounts.ts`: el archivo se regenera desde el `.xls` de la plantilla y lleva el aviso "NO editar a mano". Ya cubre `4.2.1/07/07 Impuestos internos y varios` (EXPENSE), `1.1.4/01/10 Percepciones y Retenciones de IVA` y `1.1.4/01/04 ... IIBB` (sufridas), y `2.1.3/01/03` / `2.1.3/02/10` (efectuadas). No hay cuenta municipal en la plantilla: el contador la crea en su plan si su jurisdicción la usa, y la configuración contable la deja seleccionable.

## 2. Componente compartido de tributos

- [x] 2.1 Crear `src/modules/commercial/shared/perceptions.ts` con `perceptionSchema` (Zod: `type`, `jurisdiction` opcional, `baseAmount`, `amount`), `internalTaxesSchema` y el helper `calculateOtherTaxes(perceptions, internalTaxes)`. **Archivo plano, no carpeta**: es la convención real de `commercial/shared/` (`allocation-form.ts`, `cost-center.ts`, `voucher-utils.ts`).
- [x] 2.2 Helper `derivePerceptionRate(baseAmount, amount)` → `Decimal(6,3)`, con los bordes cubiertos (base cero, monto cero).
- [x] 2.3 `_PerceptionsField.tsx` (client): tabla editable con `useFieldArray`, selector de tipo (IVA / IIBB / Municipal), jurisdicción, base (precargada con el neto gravado, editable), monto y tasa calculada en solo lectura.
- [x] 2.4 Tests unitarios de `calculateOtherTaxes` y `derivePerceptionRate` (Vitest), incluidos los importes exactos de la factura del ticket.
- [x] 2.5 No aplica `index.ts`: al ser archivo plano, se importa como `@/modules/commercial/shared/perceptions`, igual que `allocation-form`. Se agregaron además `totalPerceptions`, `toPerceptionRecords` y `perceptionLabel` para que asiento, detalle y PDF compartan el mismo criterio de etiquetado.

## 3. Facturas de compra

- [x] 3.1 `invoices/shared/validators.ts`: sumar `perceptions: z.array(perceptionSchema).optional()` e `internalTaxes` (string numérico, no negativo) a `purchaseInvoiceFormSchema`.
- [x] 3.2 `create/components/_PurchaseInvoiceForm.tsx`: sección "Percepciones e impuestos internos" entre las líneas y el panel de Totales; extender la suscripción de `form.watch` para que el panel muestre Otros Tributos y recalcule el Total.
- [x] 3.3 `list/actions.server.ts` → `createPurchaseInvoice`: persistir `perceptions` anidadas, calcular `internalTaxes`, `otherTaxes` y `total = subtotal + vatAmount + otherTaxes`.
- [x] 3.4 `list/actions.server.ts` → `updatePurchaseInvoice`: reemplazar las percepciones (`deleteMany` + `create` dentro de la transacción existente) y recalcular los mismos totales.
- [x] 3.5 `list/actions.server.ts` → `getPurchaseInvoiceById`: incluir `perceptions` e `internalTaxes` en el `select`, con los `Decimal` convertidos a `Number()` antes de devolverlos (regla 9 de CLAUDE.md).
- [x] 3.6 `edit/EditPurchaseInvoice.tsx`: precargar las percepciones existentes en el formulario.

## 4. Facturas de venta

- [x] 4.1 `sales/features/invoices/shared/validators.ts`: mismos campos en `invoiceFormSchema` y en `createInvoiceSchema` (este último transforma strings a números, mantener el criterio).
- [x] 4.2 `create/components/_InvoiceForm.tsx`: montar `_PerceptionsField` y recalcular totales, respetando el descuento global existente en el cálculo de la base sugerida.
- [x] 4.3 `sales/features/invoices/list/actions.server.ts`: persistencia y totales en creación, edición y lectura por id, con la misma conversión de `Decimal`.
- [x] 4.4 Verificado por lectura: `purchase-invoice-balance.ts` (compras) y el pendiente de cobro de recibos (`receipts/actions.server.ts:88-99`) derivan todo de `Number(invoice.total)`, así que los tributos se propagan sin cambios. El caso real se cubre en 11.3.

## 5. Contabilidad

- [x] 5.1 `integrations/commercial/index.ts` → `getPerceptionAccountId`: agregar `MUNICIPAL` a los mapas `collected` y `suffered`.
- [x] 5.2 `createJournalEntryForPurchaseInvoice`: agregar la línea de impuestos internos contra `internalTaxesAccountId` (debe; haber si es NC), después de las percepciones.
- [x] 5.3 `createJournalEntryForSalesInvoice`: línea equivalente del lado ventas.
- [x] 5.4 Nuevo helper de validación previa: dada la factura, devolver la lista de tributos sin cuenta configurada (por tipo y jurisdicción), con un mensaje al estilo de `buildMissingCostCenterMessage`.
- [x] 5.5 `confirmPurchaseInvoice` y `confirmInvoice` (ventas): invocar esa validación **antes** de abrir la transacción y abortar con error explícito, en lugar de dejar que el `catch` lo degrade a `logger.warn`.
- [x] 5.6 `accounting/features/settings/`: **no había cuentas de percepción en la UI**. Existían en el modelo desde siempre y el asiento las usaba, pero nunca se expusieron en la configuración, así que eran inconfigurables. Se agregaron las **7**: percepción IVA/IIBB/Municipal cobrada y sufrida, más impuestos internos, en tres secciones nuevas de `_CommercialIntegrationForm.tsx`, con sus campos en `validators.ts`, `actions.server.ts` y los `defaultValues` de `AccountingSettings.tsx`. Sin esto, la validación de 5.5 habría bloqueado toda factura con percepciones sin forma de destrabarla.
- [x] 5.7 Test de integración: confirmar una factura de compra con dos percepciones e impuesto interno y verificar que el asiento balancea y que cada línea cae en su cuenta.

## 6. Consumidores de `otherTaxes` (revisión una por una)

- [x] 6.1 `reports/actions.server.ts` (Libro IVA compras y ventas): la columna "Otros Imp." debe pasar a mostrar `internalTaxes`, no `otherTaxes`, para no contar las percepciones dos veces junto a la columna "Percepciones".
- [x] 6.2 `_LibroIVATable.tsx`: ajustar la columna y el total de la exportación a Excel al criterio de 6.1.
- [x] 6.3 `libro-iva-digital`: el diseño de registro ya tiene campos propios (`importeImpuestosInternos`, `importePercepcionesIIBB`, `importePercepcionesMunicipales`), que estaban hardcodeados en 0. Se completan con los valores reales y `otrosTributos` pasa a 0: informar ahí `otherTaxes` —que ya suma todo eso— los contaría dos veces.
- [x] 6.4 SIRE (y SIRCAR/IIBB): **sin cambios**. Ambos leen `prisma.paymentOrder` y trabajan sobre **retenciones**, no sobre percepciones de facturas; el cambio de semántica de `otherTaxes` no los alcanza.
- [x] 6.5 `arca/actions.server.ts`: agregar el impuesto interno al array `tributos` (tributo AFIP id 4) y verificar que `impTrib` (= `otherTaxes`) sea igual a la suma de los importes informados.
- [x] 6.6 `purchases/.../shared/pdf/` y `sales/shared/pdf/`: desglosar percepciones e impuesto interno en la sección de totales del PDF, reemplazando el renglón agregado "Otros Impuestos".
- [x] 6.7 `PurchaseInvoiceDetail.tsx` e `InvoiceDetail.tsx`: mismo desglose en pantalla.

## 7. Importación AFIP

- [x] 7.1 `list/lib/afip-import.server.ts`: grabar `internalTaxes = rowData.otrosTributos` junto al `otherTaxes` que ya se guarda, para que el asiento pueda balancear.
- [x] 7.2 Desglose manual, sin reasignación automática (decisión del usuario). El campo de impuestos internos se precarga con lo importado y el usuario lo baja él mismo; el panel de totales ya muestra Otros tributos y Total en vivo, así que ve al instante si el comprobante deja de cerrar. Descontar solo habría tenido sentido en facturas importadas, que no están marcadas como tales, y volvía mágico un campo que el usuario cree estar controlando. Spec actualizado.

## 8. Datos existentes

- [x] 8.1 `prisma/scripts/backfill-internal-taxes.ts`: backfill idempotente en borradores (compras y ventas) + diagnóstico de las confirmadas sin asiento.
- [x] 8.2 Ejecutado en desarrollo: 0 comprobantes afectados (nadie usó la importación AFIP en esta base). Que una factura con impuestos internos confirme con asiento balanceado queda verificado por el test de integración `perceptions.integration.test.ts`.
- [x] 8.3 El mismo script lista las confirmadas con `otherTaxes > 0` y `journalEntryId = null`, sin tocarlas. En la base de desarrollo: ninguna. Hay que correrlo en producción para obtener el listado real.

## 9. Tests

**Cypress no existe en este proyecto**: no hay carpeta `cypress/`, ni scripts `cy:*`, ni ningún
`.cy.ts`. Es un remanente del proyecto base del que este es fork, ya documentado en TSK-583, que
resolvió lo mismo con tests de integración de Vitest contra la base local. Se sigue ese camino.

- [x] 9.1 `perceptions.integration.test.ts`: factura con dos percepciones e impuesto interno (los importes del ticket), verificando total y desglose.
- [x] 9.2 Mismo archivo: el asiento generado balancea contra el total del comprobante, con cada tributo en su cuenta.
- [x] 9.3 Mismo archivo: sin la cuenta de impuestos internos configurada, falla con un mensaje que la nombra y la factura queda sin asiento.
- [x] 9.4 Mismo archivo: caso de venta con percepción cobrada e impuesto interno (pasivo, lado haber).
- [x] 9.5 Suite completa en verde: `npx vitest run` → 234/234 (incluye los 17 unitarios de `perceptions.test.ts` y los 10 de integración). Se actualizó `settings/validators.test.ts`, que contaba 23 cuentas configurables y ahora son 30.

## 10. Documentación

- [x] 10.1 `src/modules/help/features/guide/components/_CommercialGuide.tsx`: documentar la carga de percepciones e impuestos internos en facturas de compra y venta.
- [x] 10.2 `docs/modules/commercial.md` y `docs/architecture/data-model.md`: campos y tablas nuevos.
- [x] 10.3 `docs/architecture/` (integración contable): asiento con tributos y cuentas nuevas requeridas.
- [x] 10.4 `scripts/guia-presentacion/tsk-644.html` + `.pdf` (4 páginas), con capturas reales de la app tomadas con `capturas-tsk644.mjs` cargando la factura de La Anónima. Incluye el aviso sobre las cuentas contables y una sección de "qué no cambió".

## 11. Cierre

- [x] 11.1 `check-types` en 227 errores y `lint` en 341 problemas: **exactamente la línea base** de la rama (medida con `git stash`). El proyecto arrastra esos errores de otros módulos; el cambio no agrega ninguno. `npx vitest run`: 239/239.
- [x] 11.2 Checklist de commit revisado: sin `:any` (se tipificaron con `DecimalLike` los campos nuevos de los data-mapper, que arrastraban `any`), sin `console.*`, `Decimal` convertidos a `Number()` en todos los returns, componentes bajo 200 líneas (se extrajo `_PerceptionRow` de `_PerceptionsField`), permisos cubiertos por las actions existentes. No hay columnas nuevas de DataTable.
- [x] 11.3 Verificado con `purchase-invoice-tributes.integration.test.ts` (5 tests), que entra por los **server actions reales** con el input del formulario y los importes de La Anónima: totales ($218.426,15), alícuotas derivadas (IIBB 1,000% / IVA 2,253%), jurisdicción NQN, bloqueo por cuenta faltante, asiento balanceado y saldo al proveedor con tributos incluidos. Queda como test permanente, no como script descartable.
