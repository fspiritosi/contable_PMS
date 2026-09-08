# TSK-618: Sugerencia de adjuntar la factura en compras de Bienes de Uso

**Fecha de inicio:** 2026-09-08
**Estado:** Implementación en progreso (Fase 4 de 9 completada)

---

## 1. Análisis

### 1.1 Problema

Elizabeth Perez (PMS) pide que, cuando una línea de una factura de compra se impute a una
cuenta del rubro **Bienes de Uso**, el sistema le **sugiera** —sin obligar— al usuario de carga
que suba el escaneo o la imagen del comprobante.

Texto del ticket:

> "Se podrá sugerir pero no obligar, que si un ítem está atado a un activo determinado como
> bien de uso, que se le diga al usuario de carga 'sería ideal que cargues el escaneo o la
> imagen de la factura', dado que los activos luego el contador te pide ese detalle y se
> deprecia, contablemente se amortiza y tiene que determinar bien si no te equivocaste de
> concepto. De hecho yo se las tengo que juntar cada año, solo esas. Que no obligue, solo que
> sugiera con un cartelito. Lo que me hizo acordar que habría que determinar en algún lado.
> Son los ítems atados al padre 'Bienes de Uso', pego imagen de nuestro plan de cuentas pero si
> otra empresa lo pone en otro número, en general se tilda en algún lado BU (Bien de Uso),
> porque tiene como otro análisis."

El pedido tiene **dos mitades**, y la segunda es la que manda:

1. **El aviso** (lo visible): un cartel no bloqueante en la carga de la factura de compra.
2. **La marca** (lo que lo hace posible): *"habría que determinar en algún lado"* qué cuentas
   son Bien de Uso. La clienta descarta explícitamente el criterio por número de cuenta
   ("si otra empresa lo pone en otro número"): la identificación tiene que ser **una marca
   configurable por empresa**, no un código a fuego.

La captura adjunta muestra su plan de cuentas: `1.2.2/00/00 BIENES DE USO (sumatoria)` con
ocho rubros hijos también de sumatoria (INMUEBLES, MAQUINARIAS Y EQUIPOS, MUEBLES Y UTILES,
RODADOS, EQUIPOS TECNOLOGICOS, TERRENOS, INSTALACIONES, EQUIPOS DE COMUNICACION), y recién
debajo las imputables (`1.2.2/01/01 Inmuebles Valores originales`, `01/02 Actualizaciones`,
`01/03 Amortizaciones Acumuladas Inmuebles`). O sea: **un rubro con muchas cuentas hijas,
identificado por el padre**, no una cuenta suelta.

El motivo de negocio es real y concreto: el contador arma el anexo de bienes de uso y el cuadro
de amortizaciones una vez por año, y para eso necesita el comprobante original de cada alta. Hoy
la clienta "se las junta cada año, solo esas" a mano.

### 1.2 Contexto actual

#### 1.2.1 El modelo de cuentas ya tiene jerarquía y flags, pero ninguno dice "Bien de Uso"

`prisma/schema.prisma:296-374` — modelo `Account`:

- Jerarquía por `parentId` / `children` (relación autorreferencial `AccountHierarchy`).
- `isLeaf` (línea 309) marca la cuenta **imputable**; las no-hoja son de sumatoria y se mantiene
  automáticamente (`recomputeIsLeaf` en `accounts/actions.server.ts:45-54`, y el `create` que
  pone `isLeaf: false` al padre en la línea 88).
- `code` con formato `x.x.x/xx/xx`, único por empresa (`@@unique([companyId, code])`).
- Ya existen **dos flags de comportamiento contable por cuenta**: `adjustableByInflation`
  (línea 314) y `requiresAuxiliary` (línea 315).
- **No existe ningún flag de "Bien de Uso".**

Dato importante sobre el precedente `adjustableByInflation`: está en el modelo y se consulta en
`accounting/features/inflation-adjustment/actions.server.ts:155`, pero **no se puede editar
desde ningún formulario** — no está en `accountSchema`
(`accounting/shared/types/index.ts:5-12`, que solo tiene `code`, `name`, `type`, `nature`,
`description`, `parentId`) ni en los modales de alta/edición. Es decir: hay precedente de flag
por cuenta, pero **no** de flag por cuenta editable por el usuario. Este ticket sería el primero.

#### 1.2.2 `fixedAssetAccountId` existe, pero NO es lo que pide el ticket

`prisma/schema.prisma:568-577` (dentro de `AccountingSettings`):

```
// Cuentas de Activos Fijos (equipos / bienes de uso)
fixedAssetAccountId              String? @map("fixed_asset_account_id") @db.Uuid
accumulatedDepreciationAccountId ...
depreciationExpenseAccountId     ...
assetDisposalGainLossAccountId   ...
```

Se configura en **Contabilidad → Configuración Contable → Integración Comercial**, grupo
"Cuentas de Activos Fijos", con la etiqueta literal **"Bienes de Uso"**
(`accounting/features/settings/components/_CommercialIntegrationForm.tsx:219-235`), validada
como `accountField` en `settings/validators.ts:49` y persistida en `settings/actions.server.ts:67`.

**Quién la consume:** `accounting/features/integrations/equipment/index.ts`. Es la cuenta de
**débito del asiento de alta (capitalización) de un equipo** y la de **crédito de la baja**
(líneas 217 y 302; el encabezado del archivo, líneas 1-23, documenta los cuatro asientos).
También la usa `equipment/features/depreciation/actions.server.ts:829-864`.

**Dos razones por las que no sirve como fuente de verdad de "esta cuenta es Bien de Uso":**

1. **Es una sola cuenta**, y el ticket habla de un **rubro con N hijas**. La clienta tiene al
   menos 8 sub-rubros y ~24 cuentas imputables debajo de `1.2.2`.
2. **Ni siquiera puede apuntar al padre.** El selector se alimenta de `getActiveAccounts`
   (`settings/actions.server.ts:199-228`), que usa
   `buildImputableAccountsWhere` (`shared/lib/accounts/imputable-accounts.ts:33-46`) con
   `isLeaf: true`. Solo ofrece **cuentas imputables (hojas)**. El rubro
   `1.2.2/00/00 BIENES DE USO` es de sumatoria: nunca aparece en ese combo.

Además tiene semántica propia y activa: cambiarla de significado rompería el asiento de alta de
equipos.

#### 1.2.3 Alternativas de identificación de "Bien de Uso"

| # | Alternativa | Pros | Contras |
|---|---|---|---|
| **A** | **Flag booleano `isFixedAsset` en `Account`, marcable en el ABM del plan de cuentas y propagado al subárbol** | Es literalmente lo que pide la clienta ("se tilda en algún lado BU"); independiente del código de cuenta; una sola marca sobre el rubro cubre las N hijas; se puede **desmarcar** una hija puntual (ver contras de C'); hay precedente de flags por cuenta (`adjustableByInflation`, `requiresAuxiliary`) y de recorrido en cascada del subárbol (`disableAccount`, `accounts/actions.server.ts:392-414`); deja la base para el anexo de bienes de uso que la clienta arma a mano cada año | Campo nuevo + migración; hay que decidir materializar la cascada vs. resolverla en lectura; hay que propagar al crear una cuenta hija bajo un padre marcado (`createAccount:60-105`) y al mover `parentId` (`updateAccount:114`); hay que sumar la columna al Excel de import/export (`accounts/lib/excel-template.ts:37-44` y `lib/import-export.server.ts:73-78, 220-225`) para no perder la marca en el round-trip; conviene pre-marcar el plan modelo (`data/model-chart-of-accounts.ts:419-...`, donde `1.2.2/00/00 BIENES DE USO` ya existe) para que una empresa nueva no quede en silencio |
| **B** | **Reutilizar `fixedAssetAccountId` de `AccountingSettings`** | Cero migración; ya está configurado en las empresas que usan el módulo de equipos | **Inviable como fuente de verdad**: es UNA cuenta y el selector solo ofrece imputables (`isLeaf: true`), así que no puede apuntar al rubro padre; ya tiene un significado propio y activo (débito de capitalización de equipos, `integrations/equipment/index.ts:217`), y reusarla lo ensucia |
| **C** | **Campo nuevo `fixedAssetRootAccountId` (una o varias raíces de rubro) en `AccountingSettings`** | Una sola configuración por empresa, sin tocar el ABM del plan; el "rubro" queda explícito; el combo de settings podría relajarse para ofrecer sumatorias | La pertenencia se resuelve subiendo por `parentId` en cada consulta (más caro y más código); **arrastra las regularizadoras**: en el plan de la clienta, `1.2.2/01/03 Amortizaciones Acumuladas Inmuebles` cuelga del mismo padre y **no** es un bien de uso — con raíz sin excepciones, el aviso saldría de más; y no cubre la empresa que tiene los bienes de uso repartidos en más de un subárbol |
| **D** | **Por código de cuenta (prefijo configurable, ej. `1.2.2`)** | Trivial de implementar | **Descartada por el propio ticket**: "si otra empresa lo pone en otro número". Además el formato `x.x.x/xx/xx` no garantiza que el rubro sea contiguo |
| **E** | **Marca en el ítem (`Product`) en vez de en la cuenta** | No toca contabilidad | La clienta razona por plan de cuentas ("los ítems atados al padre Bienes de Uso"); obligaría a marcar ítem por ítem en vez de una vez por rubro; y el dato ya está del lado de la cuenta, porque el asiento imputa la línea por `product.defaultExpenseAccountId` |

**Recomendación: A**, el flag `isFixedAsset` por cuenta con cascada al subárbol.

Fundamento, con lo que se vio en el código:

- Es la única alternativa que reproduce el modelo mental de la clienta ("se tilda en algún lado
  BU") y que sobrevive a que cada empresa numere distinto.
- El proyecto **ya tiene flags de comportamiento contable por cuenta** (`adjustableByInflation`,
  `requiresAuxiliary`), así que no introduce un concepto nuevo en el modelo.
- El proyecto **ya recorre el subárbol de una cuenta en cascada**: `disableAccount`
  (`accounts/actions.server.ts:392-414`) arma `childrenByParent` y hace un DFS desde la raíz.
  Marcar/desmarcar el subárbol es el mismo patrón, ya probado.
- Marcar **por cuenta** (aunque se propague desde el padre) permite desmarcar a mano las
  amortizaciones acumuladas, que es un caso real del plan de la clienta y que la alternativa C
  no puede resolver.
- Deja el dato disponible para lo que la clienta anticipa que va a pedir después ("tiene como
  otro análisis", "se las tengo que juntar cada año"): un reporte de altas de bienes de uso del
  ejercicio.

**Punto abierto para planificación** (ver 1.6): si la cascada se **materializa** (se escribe el
booleano en cada descendiente, como hace `disableAccount`) o se **resuelve en lectura**
(subiendo por `parentId`). Materializar hace la consulta del formulario trivial —
`product.defaultExpenseAccount.isFixedAsset` — a cambio de mantener la coherencia en
`createAccount` y en el cambio de `parentId`.

#### 1.2.4 Cómo se resuelve hoy la cuenta contable de cada línea de compra

Esto ya está resuelto y bien documentado por **TSK-583**; el aviso de este ticket se cuelga del
mismo mecanismo.

- **La cuenta efectiva de una línea** se define en el asiento
  (`accounting/features/integrations/commercial/index.ts:505`):

  ```ts
  accountId: line.product?.defaultExpenseAccountId || settings.purchasesAccountId!,
  ```

  Es decir: la cuenta de egresos del ítem, y si el ítem no tiene, la cuenta de compras por
  defecto de la empresa.

- **`effectiveAccountType(accountType, defaultAccountType)`**
  (`commercial/shared/cost-center.ts:37-42`) es el reflejo de esa regla en el formulario:
  devuelve el tipo de la cuenta del ítem o, si no hay, el de la cuenta por defecto. Nació
  justamente porque mirar solo la cuenta del ítem daba falsos negativos.

- **`defaultAccountType`** llega al formulario desde el Server Component:
  `CreatePurchaseInvoice.tsx:11-16` y `EditPurchaseInvoice.tsx:20` llaman a
  `getPurchasesDefaultAccountType()` (`invoices/list/actions.server.ts:582-594`), que devuelve
  `settings.purchasesAccount.type`.

- **La cuenta del ítem** viaja en `getProductsForSelect()`
  (`invoices/list/actions.server.ts:596-645`), que hace
  `defaultExpenseAccount: { select: { type: true } }` y mapea a
  `defaultExpenseAccountType: p.defaultExpenseAccount?.type ?? null` (línea 633).
  **Hoy solo viaja el `type`, no el `id` ni ningún flag.**

- **El formulario conoce la cuenta apenas se elige el ítem en la línea.**
  `_LineCostCenterField` (`create/components/_PurchaseInvoiceForm.tsx:88-158`) hace
  `useWatch({ name: 'lines.${index}.productId' })`, busca el producto en el array y decide si
  renderiza el campo. **Ese mismo lugar y ese mismo dato sirven para decidir el aviso de BU.**

- **Un ítem sí puede estar atado a una cuenta de Bienes de Uso.** El selector de "Cuenta de
  Egresos" del ítem (`products/features/create/components/_AccountingDefaultsSection.tsx:88-110`)
  filtra con `filterExpenseAccounts` (`products/shared/account-filters.ts:21, 26-28`), y
  `EXPENSE_ACCOUNT_TYPES = ['EXPENSE', 'ASSET']`. El comentario del archivo lo dice explícito
  (TSK-579): *"Los activos entran en ambos selectores: un rodado o una máquina se compra y
  también se vende"*. Sin esto el ticket sería imposible; con esto, el camino está abierto.

- **Corolario importante:** el aviso solo puede dispararse en líneas **con ítem** cuya cuenta de
  egresos sea de Bien de Uso. Una línea sin ítem cae en `purchasesAccountId`, que es de gasto y
  nunca va a estar marcada como BU. Hay que decirlo en la guía de usuario.

#### 1.2.5 Adjuntos de factura: hoy **solo desde el detalle**, nunca durante la carga

Este es el punto que condiciona el diseño.

- **Modelo:** `PurchaseInvoice.documentUrl` / `documentKey` (`schema.prisma:2967-2969`).
- **Componente:** `commercial/shared/components/_DocumentAttachment.tsx` — un `Card` con
  `_FileDropzone`, que acepta PDF/JPEG/PNG/WebP y sube vía
  `uploadDocumentAttachment(...)` (`commercial/shared/actions/document-attachment.server.ts`).
- **La subida exige que el documento ya exista**: la action hace
  `prisma.purchaseInvoice.updateMany({ where: { id: documentId, companyId }, data })`
  (`document-attachment.server.ts`, helper `updateDocumentFields`). Sin `id` no hay dónde
  guardar.
- **Dónde está montado hoy para compras:** únicamente en
  `purchases/features/invoices/detail/PurchaseInvoiceDetail.tsx:456-465`, en la columna lateral,
  debajo de "Auditoría".
- **Asimetría con ventas:** la tabla de facturas de **venta** sí ofrece adjuntar desde el listado,
  en un `Dialog` (`sales/features/invoices/list/components/_InvoicesTable.tsx:216-239`).
  `_PurchaseInvoicesTable.tsx` **no tiene nada de eso** (grep de `Attachment|documentUrl|Adjunt`
  no devuelve nada).
- **El formulario de carga no tiene ningún campo de archivo.** Grep de
  `Adjunt|Dropzone|file` en `_PurchaseInvoiceForm.tsx` (959 líneas) no devuelve ningún campo de
  subida.
- **Pero el flujo ya termina en el detalle:** tras guardar, tanto en alta como en edición,
  `_PurchaseInvoiceForm.tsx:385` y `:390` hacen
  `router.push('/dashboard/commercial/purchases/${result.id}')` — o sea, el usuario **aterriza
  exactamente en la pantalla que tiene el dropzone**.

**Opciones para el "cartelito", de menor a mayor alcance:**

| Opción | Qué implica | A favor | En contra |
|---|---|---|---|
| **1. Aviso en el form + aviso persistente en el detalle** | `Alert` no bloqueante en el formulario cuando alguna línea imputa a BU ("Sería ideal que cargues el escaneo o la imagen de la factura — vas a poder adjuntarla al guardar"), más un `Alert` en `PurchaseInvoiceDetail` cuando la factura tiene líneas BU y `!documentUrl`, apuntando a la tarjeta "Documento Adjunto" | Mínimo cambio; **cero** riesgo de estado parcial; el detalle ya renderiza tres `Alert` con este mismo estilo (`PurchaseInvoiceDetail.tsx:103-146`); el redirect post-guardado ya lleva ahí | El cartel del formulario no tiene botón de subir al lado: es una promesa, no una acción. Si el usuario ignora el redirect, el adjunto no se carga |
| **2. Opción 1 + dropzone en el propio formulario** | Agregar un campo de archivo al form; tras `createPurchaseInvoice` devolver el `id` y, desde el cliente, llamar a `uploadDocumentAttachment` con ese `id` (mismo `ArrayBuffer → number[]` que ya hace `_DocumentAttachment.tsx:59-63`). En modo edición el `id` ya existe, así que la subida puede ser inmediata | Resuelve el pedido de punta a punta: el cartel viene con el lugar donde soltar el archivo | Estado parcial posible: la factura queda creada y la subida falla → hace falta un toast claro y que el redirect al detalle sirva de red de contención. Toca la validación del form y el schema de `shared/validators.ts` |
| **3. Opción 1 + botón "Adjuntar" en el listado de compras** | Replicar el `Dialog` de `_InvoicesTable.tsx:216-239` en `_PurchaseInvoicesTable.tsx`, más un indicador de "sin adjunto" | Cierra la asimetría venta/compra; le da a la clienta el barrido anual ("se las junta cada año") desde el listado | Es un pedido adyacente, no el del ticket. Suma alcance |

**Recomendación:** 1 como base obligatoria, 2 como el alcance deseable del ticket (es lo que
convierte la sugerencia en algo accionable), 3 fuera de alcance salvo que el usuario lo pida.
**La elección entre 1 y 2 es la decisión que hay que tomar en planificación.**

#### 1.2.6 Patrones de aviso no bloqueante ya usados en el proyecto

Hay 26 archivos `.tsx` que importan `@/shared/components/ui/alert`. Los más cercanos al caso:

- **`PurchaseInvoiceDetail.tsx:103-146`** — tres `Alert` de estado con colores semánticos
  inline, ya en la pantalla de destino:

  ```tsx
  <Alert className="border-yellow-500/50 bg-yellow-50 dark:bg-yellow-950/20">
    <AlertDescription className="flex items-center justify-between"> ... </AlertDescription>
  </Alert>
  ```

  Es el patrón exacto para el aviso persistente del detalle: mismo componente, mismo archivo,
  mismos tokens de color (incluye variante dark).

- **`EditPurchaseInvoice.tsx`** y **`_ImportAFIPDialog.tsx`** — `Alert` informativos dentro del
  flujo de compras.

- **Precedente de "avisar sin bloquear" en la lógica**, no en la UI: todo TSK-583. La
  obligatoriedad del centro de costo es un **booleano de configuración**
  (`AccountingSettings.requireCostCenter`, `schema.prisma:631`), y solo cuando está en `true` la
  confirmación tira error (`invoices/list/actions.server.ts:1279-1296`). El interruptor vive en
  `_CommercialIntegrationForm.tsx:317-324` como un `Switch` etiquetado "Exigir centro de costo".
  Si en algún momento la clienta quisiera endurecer el aviso de BU, ese es el molde exacto —
  pero **el ticket es explícito: "Que no obligue, solo que sugiera"**.

- **`toast` de `sonner`** para el resultado de acciones (`_PurchaseInvoiceForm.tsx:381-397`).
  Sirve como refuerzo al guardar, no como el cartel principal: un toast se va solo y este aviso
  tiene que quedar a la vista.

#### 1.2.7 ¿Aplica también a la factura de venta?

**Recomendación: alcance solo compras.**

- El ticket habla de la compra, que es donde se **adquiere** el activo y donde nace el valor de
  origen que después se amortiza. Es el comprobante que el contador pide.
- Del lado de ventas, una línea imputada a Bien de Uso es una **baja** de activo, y el respaldo
  documental relevante ahí es la factura que **emite** la propia empresa: el sistema ya la genera
  y la guarda (`sales/features/invoices/shared/pdf/`), así que no hay nada que "escanear".
- El mecanismo queda listo si mañana se quiere extender: `SalesInvoiceLine` ya resuelve la cuenta
  por `product.defaultIncomeAccountId`, `filterIncomeAccounts` también admite `ASSET`
  (`products/shared/account-filters.ts:22`), y la tabla de ventas ya tiene el diálogo de adjuntar.

Sí conviene alcanzar, dentro de compras, a **NC y ND de compra**: usan el mismo formulario y el
mismo `voucherType` (`isCreditNote` / `isDebitNote` en `commercial/shared/voucher-utils.ts`), y
una ND sobre un bien de uso capitaliza igual.

### 1.3 Archivos involucrados

**Modelo y migración**
- `prisma/schema.prisma` — `model Account` (líneas 296-374): agregar `isFixedAsset Boolean @default(false) @map("is_fixed_asset")`.
- `prisma/migrations/<timestamp>_tsk_618_fixed_asset_account_flag/` — migración nueva (convención vigente: `20260903183104_tsk_644_percepciones_impuestos_internos`).

**Marca en el plan de cuentas (Contabilidad)**
- `src/modules/accounting/shared/types/index.ts` — `accountSchema` (líneas 5-12): sumar el campo.
- `src/modules/accounting/features/accounts/actions.server.ts` — `createAccount` (60), `updateAccount` (114), `getAccounts` (253), `getAccountById` (277), `loadModelChartOfAccounts` (496); cascada al subárbol reutilizando el patrón de `disableAccount` (365-414).
- `src/modules/accounting/features/accounts/components/_CreateAccountModal.tsx` y `_EditAccountModal.tsx` — el tilde "Bien de Uso" (`Switch` o `Checkbox`).
- `src/modules/accounting/features/accounts/components/_AccountsTable.tsx` — badge/indicador en el árbol (columnas actuales: Código, Nombre, Tipo, Naturaleza, Saldo, Estado, acciones; líneas 185-200).
- `src/modules/accounting/features/accounts/data/model-chart-of-accounts.ts` — pre-marcar el rubro `1.2.2/*` (BIENES DE USO ya está en la línea 419-424); definir qué pasa con las `Amortizaciones Acumuladas`.
- `src/modules/accounting/features/accounts/lib/excel-template.ts` (headers, 37-44) y `lib/import-export.server.ts` (export 73-112, import 220-260) — columna nueva para no perder la marca en el round-trip.

**Aviso en la factura de compra (Comercial)**
- `src/modules/commercial/features/purchases/features/invoices/list/actions.server.ts` — `getProductsForSelect` (596-645): sumar el flag de la cuenta del ítem al `select` y al mapeo; y `getPurchasesDefaultAccountType` (582-594) por si se decide contemplar la cuenta por defecto.
- `src/modules/commercial/features/purchases/features/invoices/create/components/_PurchaseInvoiceForm.tsx` — el `Alert` (y, en la opción 2, el campo de archivo). Punto natural: junto a `_LineCostCenterField` (88-158) y/o encima del bloque de acciones.
- `src/modules/commercial/features/purchases/features/invoices/create/CreatePurchaseInvoice.tsx` y `edit/EditPurchaseInvoice.tsx` — si hace falta pasar datos nuevos al form.
- `src/modules/commercial/features/purchases/features/invoices/detail/PurchaseInvoiceDetail.tsx` — `Alert` persistente si hay líneas BU sin adjunto (patrón ya presente en 103-146); requiere traer las cuentas de las líneas en el `select` del detalle.
- `src/modules/commercial/shared/` — si el criterio "¿esta línea es Bien de Uso?" se extrae a una función pura con tests, el lugar es acá (junto a `cost-center.ts`), que es donde TSK-583 puso su lógica compartida.

**Opción 2 (subida durante la carga), adicional**
- `src/modules/commercial/features/purchases/features/invoices/shared/validators.ts` — campo de archivo en `purchaseInvoiceFormSchema`.
- `src/modules/commercial/shared/actions/document-attachment.server.ts` — reutilizable tal cual; ver 1.6 sobre su falta de `checkPermission`.

**Documentación y pruebas**
- `docs/modules/accounting.md`, `docs/modules/commercial.md`, `docs/architecture/data-model.md`.
- `src/modules/help/features/guide/components/_AccountingGuide.tsx` (sección "Plan de Cuentas", líneas 40-58) y `_CommercialGuide.tsx` (sección de facturas de compra).
- `docs/presentaciones/TSK-618-*.pdf` — guía de presentación al cliente (mismo formato que `TSK-583-centros-de-costo.pdf`, `TSK-621-indices-de-precios.pdf`).
- Tests Vitest junto al código (ver 1.5).

### 1.4 Dependencias

- **Prisma 7 / PostgreSQL** — campo booleano nuevo con `@default(false)`; migración aditiva, sin backfill obligatorio.
- **shadcn/ui** — `Alert` + `AlertDescription` (`@/shared/components/ui/alert`, ya instalado y usado en 26 archivos), `Switch` / `Checkbox` para el tilde, `Badge` para el indicador en el árbol.
- **React Hook Form + Zod** — `accountSchema` y `purchaseInvoiceFormSchema`.
- **`lucide-react`** — ícono del aviso (`Info` / `Paperclip`).
- **`sonner`** — refuerzo por toast al guardar.
- **Módulo de contabilidad activo**: la marca vive en el plan de cuentas. `MODULE_DEPENDENCIES` ya declara `accounting: ['commercial']` (`.claude/rules/modules.md`), pero **una empresa con `commercial` activo y `accounting` desactivado no tiene plan de cuentas**: en ese escenario el aviso simplemente nunca se dispara. Hay que decidir si eso está bien (probablemente sí: sin contabilidad no hay contador pidiendo el anexo) y documentarlo.
- **Storage MinIO/R2** — solo si se toma la opción 2; el circuito ya existe (`shared/lib/storage.ts`, `buildCommercialDocumentPath`).
- **No hay módulo nuevo**: no aplica la regla 13 de registro en `ACTIVATABLE_MODULES`.

### 1.5 Restricciones y reglas

**Del `CLAUDE.md` (Reglas de Oro):**

| Regla | Cómo impacta |
|---|---|
| **1. moment.js** | No hay fechas nuevas; si se muestra alguna, `moment`, nunca `date-fns` |
| **2. Logger** | Cualquier `logger.info/warn/error` en las actions nuevas; cero `console.*` |
| **3. React Query** | Si el aviso necesitara un fetch en cliente, `useQuery` (el form ya usa `useQuery` para OCs, `_PurchaseInvoiceForm.tsx:311-325`). **Preferible evitarlo**: el flag debería viajar en el `products` que ya llega por props desde el Server Component |
| **4. Prefijo `_`** | Todo componente cliente nuevo lleva `_` |
| **5. AlertDialog, nunca `confirm()`** | Acá el componente correcto es `Alert` (informativo, no bloqueante), **no** `AlertDialog` (que es confirmación modal). Son componentes distintos y conviene no confundirlos |
| **6. `app/` solo rutas** | No se crean carpetas de componentes bajo `app/` |
| **7. Tests con cada cambio** | Ver nota abajo |
| **8. Docs del desarrollador** | `docs/modules/accounting.md`, `docs/modules/commercial.md`, `docs/architecture/data-model.md` (modelo nuevo) |
| **9. Decimal → Number()** | El flag es booleano, así que no agrega Decimals. Pero si se amplía el `select` del detalle o de `getProductsForSelect`, hay que mantener el mapeo de los Decimals que ya vienen (`costPrice`, `vatRate`, subtotales) |
| **10. Guía de usuario** | Cambio visible en dos módulos: `_AccountingGuide.tsx` (cómo tildar BU en el plan de cuentas) y `_CommercialGuide.tsx` (qué significa el cartel y que no bloquea) |
| **11. Permisos en 3 niveles** | `accounting.accounts` → `update` para marcar la cuenta (las actions ya lo hacen: `actions.server.ts:62, 117`); `commercial.purchases` → `view`/`create`/`update` para el formulario (ya cubierto por `PermissionGuard` en `CreatePurchaseInvoice.tsx:20`). En cliente, `usePermissions()` para el tilde del modal (el patrón ya está en `_CommercialIntegrationForm.tsx`) |
| **12. Industria** | La feature es universal (cualquier empresa con contabilidad): **no** se registra en `INDUSTRY_FEATURES` |
| **13. Módulos activables** | No aplica: no hay módulo nuevo |

**Sobre la regla 7 (tests) — corrección importante:** el `CLAUDE.md` manda Cypress
(`npm run cy:run:commercial`, etc.), pero **en el repo no existe la carpeta `cypress/` y
`package.json` no tiene ningún script `cy:*`**. El testing real del proyecto es **Vitest**
(`npm run test` → `vitest run`, `vitest.config.ts`), con precedentes directos y muy cercanos al
caso:
- `src/modules/commercial/shared/cost-center.test.ts` (lógica pura de TSK-583),
- `src/modules/accounting/features/integrations/commercial/cost-center.integration.test.ts`,
- `src/modules/commercial/features/purchases/features/invoices/list/purchase-invoice-tributes.integration.test.ts`,
- `src/modules/accounting/features/accounts/data/model-chart-of-accounts.test.ts`.

El plan debe apuntar a Vitest, con la lógica de "¿esta línea es Bien de Uso?" extraída a una
función pura testeable, igual que `allowsCostCenter` / `effectiveAccountType`.

**Restricciones técnicas:**
- **La sugerencia no puede bloquear nada.** Ni `zodResolver`, ni `handleInvalid`
  (`_PurchaseInvoiceForm.tsx:400-414`), ni la confirmación (`confirmPurchaseInvoice`). El ticket
  es explícito.
- **El comprobante solo se puede adjuntar contra un `id` existente**
  (`document-attachment.server.ts`, `updateDocumentFields`), lo que fuerza cualquier subida
  "durante la carga" a ser en dos pasos.
- **Cascada del flag:** hay que definir el comportamiento al crear una hija bajo un padre marcado
  y al reasignar `parentId`, o la marca queda incoherente en silencio.
- **Checklist de commit del `CLAUDE.md`**: `npm run check-types` y `npm run lint` deben pasar;
  nada de `:any`; componentes < 200 líneas (`_PurchaseInvoiceForm.tsx` ya tiene **959** — todo lo
  nuevo debería salir como subcomponente aparte, siguiendo lo que ya se hizo con
  `_LineCostCenterField`).

### 1.6 Riesgos identificados

1. **Las facturas importadas de AFIP nunca van a disparar el aviso.**
   `list/lib/afip-import.server.ts:299-412` crea las líneas **sin `productId`**, con descripción
   `"Compra según comprobante AFIP (IVA X%)"` armada por alícuota. Sin ítem no hay
   `defaultExpenseAccountId`, la cuenta efectiva cae en `purchasesAccountId` y el aviso no sale.
   Si ese es el canal principal por el que entran las compras de la clienta, la feature se
   percibe como "no anda". **Hay que confirmarlo con el usuario** y, si hace falta, evaluar un
   aviso complementario en el detalle basado en el asiento ya generado, no en el ítem.

2. **Empresa sin ninguna cuenta marcada = silencio total.** Si nadie tilda nada, el cartel no
   aparece nunca y no hay ningún error que lo delate. Mitigación: pre-marcar el rubro
   `1.2.2 BIENES DE USO` en `MODEL_CHART_OF_ACCOUNTS` y sembrar la migración con la cuenta ya
   configurada en `AccountingSettings.fixedAssetAccountId` (que en las empresas con módulo de
   equipos ya apunta a una cuenta real de bienes de uso). **Decisión de planificación.**

3. **Ruido por las regularizadoras.** Si la cascada marca todo el subárbol, quedan marcadas
   también las `Amortizaciones Acumuladas` (`1.2.2/01/03` en el plan de la clienta), que no son
   bienes de uso. Poco frecuente que se compre contra ellas, pero el diseño debe permitir
   desmarcar una cuenta puntual sin perder la marca del rubro.

4. **Ítem sin cuenta de egresos = falso silencio.** Un rodado cargado como ítem pero sin "Cuenta
   de Egresos" asignada cae en `purchasesAccountId` y no avisa. Es el mismo falso negativo que
   TSK-583 tuvo que corregir con `effectiveAccountType`. Conviene documentarlo en la guía y, si
   se quiere, sugerir el uso del `_ImputationModal` de la lista de ítems
   (`products/features/list/components/_ImputationModal.tsx`) para completar cuentas en masa.

5. **Estado parcial si se toma la opción 2.** Factura creada + subida fallida deja la factura sin
   adjunto y al usuario con un toast de éxito y otro de error. Mitigación: el redirect al detalle
   ya lleva a la pantalla donde puede reintentar, y el `Alert` persistente del detalle se lo
   recuerda.

6. **Round-trip del Excel del plan de cuentas.** `import-export.server.ts` exporta 7 columnas
   (73-112) e importa 6 (220-225). Si no se suma la columna, exportar/reimportar borra la marca
   en silencio.

7. **`document-attachment.server.ts` no llama a `checkPermission`.** Solo verifica
   `getCurrentUserId()`. Está fuera del alcance del ticket, pero si la opción 2 amplía la
   superficie de uso de esa action, conviene corregirlo (regla 11 del `CLAUDE.md`).

8. **`_PurchaseInvoiceForm.tsx` ya tiene 959 líneas.** Agregar lógica inline lo empeora y viola
   el límite de 200 líneas del checklist. El aviso debe salir como subcomponente cliente propio.

9. **Alcance que se puede escapar.** El ticket, leído entero, insinúa dos features más grandes:
   el "otro análisis" de los bienes de uso y el "se las tengo que juntar cada año". Con el flag
   en la cuenta ambas quedan habilitadas, pero **no** son parte de este ticket. Conviene dejarlo
   escrito como fuera de alcance para que no se filtre.

10. **Cascada e incoherencia silenciosa.** Crear una cuenta hija bajo un padre marcado, o mover
    una cuenta de rubro, puede dejar el flag desalineado. `createAccount` y `updateAccount`
    (`accounts/actions.server.ts:60, 114`) tienen que contemplarlo, con un test que lo cubra.

**Decisiones que necesitan al usuario en la etapa de planificación:**

- **Alcance del "cartelito":** ¿solo el aviso (opción 1) o aviso + dropzone en el formulario de
  carga (opción 2)? Hoy el adjunto **solo** se puede subir desde el detalle.
- **Semilla de la marca:** ¿se pre-marca el rubro `1.2.2 BIENES DE USO` del plan modelo y se
  siembra la migración desde `fixedAssetAccountId`, o arranca todo en blanco?
- **Facturas de AFIP:** ¿importa que no disparen el aviso?
- **Paridad con ventas y botón de adjuntar en el listado de compras:** ¿se incluyen o quedan
  fuera?

### 1.7 Decisiones tomadas (2026-09-08)

Resueltas con el usuario al cerrar el análisis, antes de planificar:

1. **Identificación de Bien de Uso**: flag booleano `isFixedAsset` en `Account`, tildable
   desde el ABM del plan de cuentas y propagado en cascada al subárbol, siguiendo el
   precedente de `adjustableByInflation` / `requiresAuxiliary` y la cascada de
   `disableAccount`. Se descarta reutilizar `fixedAssetAccountId` de la configuración
   contable: es una sola cuenta, su selector solo ofrece cuentas imputables (`isLeaf: true`)
   y por lo tanto no puede apuntar al rubro sumatoria, y ya tiene semántica propia como
   débito de capitalización de equipos.

2. **Alcance del aviso**: solo aviso no bloqueante, la subida sigue viviendo en el detalle.
   Un `Alert` en el formulario de carga cuando alguna línea se imputa a una cuenta marcada
   como Bien de Uso, y otro en el detalle mientras la factura no tenga adjunto. Se apoya en
   que el guardado ya redirige a `/dashboard/commercial/purchases/${result.id}`, que es
   justamente la pantalla con el dropzone. **No** se agrega campo de archivo al formulario
   de carga ni se toca el flujo de guardado.

3. **Plan de cuentas modelo**: el rubro Bienes de Uso (1.2.2) del plan modelo se crea con
   `isFixedAsset` en `true`, para que las empresas nuevas lo tengan funcionando sin
   configurar nada. Sigue siendo editable desde el ABM.

4. **Facturas importadas de AFIP**: fuera de alcance. Las importadas crean líneas sin
   `productId` y por lo tanto sin cuenta imputada, así que no disparan el aviso. Se
   documenta la limitación y se evalúa por separado.

5. **Alcance de módulos**: solo facturas de compra. Las de venta quedan afuera: el activo
   se incorpora al comprar, no al vender.

6. **Round-trip de Excel del plan de cuentas** (confirmado al cerrar la planificación): la
   columna "Bien de Uso" entra en el alcance del ticket. Sin ella, exportar el plan y volver
   a importarlo perdería los tildes en silencio.

---

## 2. Planificación

Las nueve fases implementan las cinco decisiones de 1.7 y nada más. El orden va del dato
(la marca en la cuenta) hacia la superficie (el aviso), porque el aviso no tiene nada que
mostrar hasta que exista una cuenta marcada.

### 2.1 Fases de implementación

#### Fase 1: Campo `isFixedAsset` en el modelo y migración

- **Objetivo:** que `Account` tenga la marca de Bien de Uso en base, con default seguro y sin
  tocar ninguna empresa existente.
- **Tareas:**
  - [x] Agregar `isFixedAsset Boolean @default(false) @map("is_fixed_asset")` en `model Account`
        (`prisma/schema.prisma`), junto a `adjustableByInflation` y `requiresAuxiliary`, que son
        los dos flags de comportamiento contable ya existentes (líneas 314-315).
  - [x] Generar la migración con `npm run db:migrate` (nombre `tsk_618_fixed_asset_account_flag`,
        siguiendo la convención de `20260903183104_tsk_644_percepciones_impuestos_internos`). El SQL
        debe quedar en un solo `ALTER TABLE "accounts" ADD COLUMN "is_fixed_asset" BOOLEAN NOT NULL
        DEFAULT false;` — aditivo, sin FK, sin índice.
  - [x] Correr `npm run db:generate` para que `@/generated/prisma` exponga el campo (sin esto, las
        fases 3 a 6 no compilan).
  - [x] **No hay backfill de datos.** El default `false` es el estado correcto para toda cuenta
        preexistente: la marca es una decisión de la empresa. La única siembra prevista es la del
        plan de cuentas modelo (fase 3), tal como quedó cerrado en 1.7 punto 3.
  - [x] Crear `prisma/scripts/diagnose-fixed-asset-accounts.ts`, **solo de diagnóstico, sin
        escrituras**, siguiendo la estructura del bloque de diagnóstico de
        `prisma/scripts/backfill-internal-taxes.ts` (encabezado con contexto, `import 'dotenv/config'`,
        idempotente porque no escribe). Lista, por empresa: cantidad de cuentas con
        `isFixedAsset = true`, y —para las que tengan cero— el código y nombre de la cuenta apuntada
        por `AccountingSettings.fixedAssetAccountId`, como pista de por dónde arrancar a tildar.
        Sirve para detectar el riesgo 2 del análisis (empresa sin nada marcado = silencio total) sin
        decidir nada por el usuario.
- **Archivos:**
  - Modificar: `prisma/schema.prisma`
  - Crear: `prisma/migrations/<timestamp>_tsk_618_fixed_asset_account_flag/migration.sql`
  - Crear: `prisma/scripts/diagnose-fixed-asset-accounts.ts`
- **Criterio de completitud:** `npm run db:migrate` aplica limpio, `npx prisma migrate status` en
  verde, `npm run check-types` no suma errores nuevos sobre la línea base, y
  `npx tsx prisma/scripts/diagnose-fixed-asset-accounts.ts` imprime el informe sin modificar nada.

#### Fase 2: Lógica pura del criterio "esta línea es Bien de Uso"

- **Objetivo:** tener el criterio en una función pura testeable sin base de datos, igual que
  TSK-583 hizo con `allowsCostCenter` / `effectiveAccountType`, para que el formulario y el detalle
  usen exactamente la misma regla.
- **Tareas:**
  - [x] Escribir primero `src/modules/commercial/shared/fixed-asset.test.ts` (Vitest, mismo estilo
        que `cost-center.test.ts` y `perceptions.test.ts`: `describe`/`it` en español, sin base).
  - [x] Crear `src/modules/commercial/shared/fixed-asset.ts` con:
    - `effectiveIsFixedAsset(accountIsFixedAsset, defaultIsFixedAsset): boolean` — espejo exacto de
      `effectiveAccountType` (`cost-center.ts:37-42`): si el ítem tiene cuenta propia manda esa;
      si no, la cuenta de compras por defecto de la empresa, que es la que el asiento imputa
      (`accounting/features/integrations/commercial/index.ts:505`).
    - `interface FixedAssetLineCheck { description: string; isFixedAsset?: boolean | null }`.
    - `findFixedAssetLines<T extends FixedAssetLineCheck>(lines: T[]): T[]`.
    - `buildFixedAssetSuggestionMessage(lines: FixedAssetLineCheck[]): string` — el texto del
      cartel, con singular/plural, en un solo lugar para formulario y detalle (mismo patrón que
      `buildMissingCostCenterMessage`).
  - [x] Casos a cubrir en los tests: línea con ítem cuya cuenta está marcada → dispara; línea con
        ítem cuya cuenta no está marcada → no dispara; línea **sin ítem** con cuenta por defecto no
        marcada → no dispara (corolario de 1.2.4); línea sin ítem con cuenta por defecto marcada →
        dispara; varias líneas mezcladas → devuelve solo las de BU y conserva el orden; ninguna
        línea de BU → array vacío y mensaje no se arma; mensaje en singular con una línea y en
        plural con dos o más.
- **Archivos:**
  - Crear: `src/modules/commercial/shared/fixed-asset.ts`
  - Crear: `src/modules/commercial/shared/fixed-asset.test.ts`
- **Criterio de completitud:** `npm run test` pasa con los tests nuevos en verde y sin regresiones
  en los existentes. La función no importa Prisma ni nada de servidor.

#### Fase 3: Marca en el ABM del plan de cuentas, con cascada al subárbol

- **Objetivo:** que el usuario pueda tildar "Bien de Uso" en una cuenta del plan y que la marca se
  propague al subárbol, sin que la cascada pise las excepciones puestas a mano.
- **Tareas:**
  - [x] Sumar `isFixedAsset: z.boolean().optional()` a `accountSchema`
        (`src/modules/accounting/shared/types/index.ts:5-12`) y `isFixedAsset: boolean` a la interfaz
        `AccountWithChildren` (líneas 73-86), que es la que alimenta el árbol de la tabla.
  - [x] `createAccount` (`accounts/actions.server.ts:60-105`): la cuenta nueva **hereda la marca del
        padre** dentro de la misma transacción (`parent.isFixedAsset`), salvo que el input traiga un
        valor explícito. Sin esto, una hija creada después de tildar el rubro queda desalineada en
        silencio (riesgo 10 del análisis).
  - [x] `updateAccount` (`accounts/actions.server.ts:114-190`): dos comportamientos, ambos dentro de
        la transacción que ya existe.
    - **Cascada por cambio de flag:** propagar `isFixedAsset` a todo el subárbol **solo cuando el
      valor cambia** (`input.isFixedAsset !== undefined && input.isFixedAsset !== account.isFixedAsset`).
      Es la condición clave: si se propagara en cada guardado, editar el nombre del rubro borraría
      las excepciones desmarcadas a mano (las Amortizaciones Acumuladas del riesgo 3).
    - **Herencia por cambio de padre:** cuando `parentChanged`, la cuenta y su subárbol toman el
      `isFixedAsset` del nuevo padre.
  - [x] Extraer el recorrido del subárbol a un helper reutilizable (p. ej.
        `collectSubtreeIds(accounts, rootId)`), copiando el patrón ya probado de `disableAccount`
        (`accounts/actions.server.ts:392-414`: `childrenByParent` + pila). `disableAccount` puede
        pasar a usarlo, pero **sin cambiar su comportamiento**.
  - [x] Devolver desde `updateAccount` la cantidad de cuentas afectadas por la cascada para poder
        avisarlo por `toast`, igual que hace `_DisableAccountDialog` con
        `result.affectedAccountIds.length`.
  - [x] `checkPermission('accounting.accounts', 'update')` y `('accounting.accounts', 'create')` ya
        están al inicio de ambas actions (líneas 62 y 117): verificar que siguen ahí y que el helper
        nuevo no crea un camino que las esquive (regla 11 del `CLAUDE.md`).
  - [x] `logger.info` con `{ accountId, affected, isFixedAsset }` al propagar; nada de `console.*`.
  - [x] UI del tilde: `Switch` etiquetado **"Bien de Uso"** con texto de ayuda
        ("Marcar las cuentas del rubro Bienes de Uso: al cargar una factura de compra imputada a
        ellas, el sistema va a sugerir adjuntar el comprobante") en
        `_CreateAccountModal.tsx` y `_EditAccountModal.tsx`, visible solo con
        `usePermissions().hasPermission('accounting.accounts', 'update')`.
  - [x] En `_EditAccountModal`, cuando la cuenta tiene hijas (`account.children.length > 0`) y el
        valor del switch cambió, confirmar con **`AlertDialog`** antes de guardar, explicando que la
        marca se aplica a todas las cuentas del rubro y cuántas son. Nunca `confirm()` (regla 5).
  - [x] `_AccountsTable.tsx`: `Badge` "BU" (variante `outline`, con `title`/tooltip "Bien de Uso")
        junto al nombre de la cuenta marcada. No agregar columna nueva: la tabla ya tiene siete y el
        árbol se indenta.
  - [x] `loadModelChartOfAccounts` (`accounts/actions.server.ts:496-552`): las cuentas del rubro
        `1.2.2` nacen con `isFixedAsset: true`. El dataset
        `data/model-chart-of-accounts.ts` dice explícitamente "NO editar a mano: regenerar desde el
        .xls", así que **no se toca el array**: se agrega en el módulo una constante exportada
        `MODEL_FIXED_ASSET_CODE_PREFIXES = ['1.2.2']` y el `.map` de `loadModelChartOfAccounts`
        resuelve `isFixedAsset` con ella. Son 31 cuentas del dataset (verificado por grep) y quedan
        editables desde el ABM, tal como fija la decisión 3 de 1.7.
  - [x] Tests Vitest: extender `data/model-chart-of-accounts.test.ts` con un caso que verifique que
        el prefijo marca exactamente las 31 cuentas `1.2.2/*` y ninguna otra.
- **Archivos:**
  - Modificar: `src/modules/accounting/shared/types/index.ts`
  - Modificar: `src/modules/accounting/features/accounts/actions.server.ts`
  - Modificar: `src/modules/accounting/features/accounts/components/_CreateAccountModal.tsx`,
    `_EditAccountModal.tsx`, `_AccountsTable.tsx`
  - Modificar: `src/modules/accounting/features/accounts/data/model-chart-of-accounts.test.ts`
  - Revisar (que propague el campo, sin perderlo en el armado del árbol):
    `src/modules/accounting/shared/utils` (`buildAccountTree`)
- **Criterio de completitud:** en la app se puede tildar el rubro `1.2.2` y el badge "BU" aparece
  en las 31 cuentas del subárbol; desmarcar una hija puntual y después editar el **nombre** del
  padre no vuelve a marcarla; crear una hija bajo un padre marcado la crea marcada; una empresa
  nueva que carga el plan modelo ya tiene el rubro marcado. `npm run test`, `npm run lint` y
  `npm run check-types` en verde.

#### Fase 4: Round-trip de la marca en el Excel del plan de cuentas

- **Objetivo:** que exportar e importar el plan no borre la marca en silencio (riesgo 6 del
  análisis).
- **Tareas:**
  - [x] `lib/excel-template.ts`: agregar la columna **"Bien de Uso (Sí/No)"** como séptima columna de
        la plantilla (hoy son seis, líneas 37-44), con su ancho, su formato de encabezado y su
        renglón correspondiente en la hoja 2 de instrucciones.
  - [x] `lib/import-export.server.ts`, exportación (líneas ~73-125): agregar la columna **"Bien de
        Uso"** después de "Estado" (pasa de 7 a 8 columnas), con valor `Sí` / `No`, sumando
        `isFixedAsset: true` al `select` y ajustando anchos y `autoFilter`.
  - [x] `lib/import-export.server.ts`, importación (líneas ~200-260): leer la celda 7, aceptar
        `Sí`/`Si`/`SI`/`true`/`1` como verdadero y vacío/`No`/`false`/`0` como falso, y sumar el
        campo al array `accountsToImport` y a la creación. **La importación toma el valor explícito
        de cada fila y no dispara la cascada de la fase 3**: el archivo es la fuente de verdad de esa
        corrida y la cascada pisaría las excepciones que el usuario haya escrito.
        *(Implementado por resolución de encabezado, no por celda 7 fija — ver diseño 3.7.3.)*
  - [x] Ajustar `validateAccountRow` para que un valor no reconocido en esa columna sea un error de
        fila con mensaje claro, no un `false` mudo.
- **Archivos:**
  - Modificar: `src/modules/accounting/features/accounts/lib/excel-template.ts`
  - Modificar: `src/modules/accounting/features/accounts/lib/import-export.server.ts`
- **Criterio de completitud:** exportar un plan con cuentas marcadas, borrar el plan en una empresa
  de prueba, reimportar el mismo archivo y verificar que las mismas cuentas quedan marcadas. La
  plantilla vacía descargada tiene la columna y su instrucción.

#### Fase 5: Aviso no bloqueante en el formulario de carga de la factura de compra

- **Objetivo:** que al imputar una línea a una cuenta marcada como Bien de Uso aparezca el cartel
  sugiriendo adjuntar el comprobante, sin frenar ni condicionar el guardado.
- **Tareas:**
  - [ ] `getProductsForSelect` (`purchases/features/invoices/list/actions.server.ts:596-645`):
        ampliar `defaultExpenseAccount: { select: { type: true } }` a
        `{ select: { type: true, isFixedAsset: true } }` y agregar al mapeo
        `defaultExpenseAccountIsFixedAsset: p.defaultExpenseAccount?.isFixedAsset ?? false`, al lado
        del `defaultExpenseAccountType` que ya existe. `ProductSelectItem` se infiere del retorno
        (línea 1757), así que el tipo se actualiza solo. Mantener intactos los `Number()` de
        `costPrice` y `vatRate` (regla 9).
  - [ ] `getPurchasesDefaultAccountType` (líneas 582-594): convertirla en
        `getPurchasesDefaultAccount()`, que devuelve `{ type: string | null; isFixedAsset: boolean }`
        leyendo `purchasesAccount: { select: { type: true, isFixedAsset: true } }`. Conserva su
        `checkPermission('commercial.purchases', 'view')`.
  - [ ] `CreatePurchaseInvoice.tsx` (líneas 10-16) y `EditPurchaseInvoice.tsx` (líneas 19-26): usar la
        action nueva en el `Promise.all` y pasar al formulario `defaultAccountType={cuenta.type}`
        —la prop de TSK-583 no cambia de forma, así que `_LineCostCenterField` queda igual— más una
        prop nueva `defaultAccountIsFixedAsset={cuenta.isFixedAsset}`.
  - [ ] Crear el componente cliente `_FixedAssetAttachmentNotice.tsx` en
        `src/modules/commercial/shared/components/` (no dentro de `_PurchaseInvoiceForm.tsx`, que ya
        tiene 959 líneas — riesgo 8). Recibe `form`, `products` y `defaultAccountIsFixedAsset`;
        observa las líneas con `useWatch` (mismo mecanismo que `_LineCostCenterField`,
        `_PurchaseInvoiceForm.tsx:88-158`), resuelve cada línea con `effectiveIsFixedAsset` y
        `findFixedAssetLines` de la fase 2, y devuelve `null` si no hay ninguna.
  - [ ] Cuando hay alguna, renderiza un `Alert` ámbar con ícono `Paperclip` de `lucide-react`,
        siguiendo los tokens de color de los avisos que ya conviven en el detalle
        (`PurchaseInvoiceDetail.tsx:103-146`, incluida la variante dark), con el texto acordado con
        la clienta: *"Esta factura incluye bienes de uso. Sería ideal que cargues el escaneo o la
        imagen del comprobante: vas a poder adjuntarlo al guardar, desde el detalle de la factura."*
        Nombrar las líneas involucradas con `buildFixedAssetSuggestionMessage`.
  - [ ] Montarlo en `_PurchaseInvoiceForm.tsx` una sola vez, encima del bloque de botones de acción.
  - [ ] **Verificar que no bloquea nada:** el aviso no entra en `purchaseInvoiceFormSchema`
        (`shared/validators.ts`), ni en `zodResolver`, ni en `handleInvalid`
        (`_PurchaseInvoiceForm.tsx:400-414`), ni en `createPurchaseInvoice` /
        `updatePurchaseInvoice` / `confirmPurchaseInvoice`. Es solo presentación (decisión 2 de 1.7).
  - [ ] No se agrega ningún campo de archivo al formulario ni se toca el flujo de guardado ni el
        `router.push('/dashboard/commercial/purchases/${result.id}')` de las líneas 385 y 390, que es
        justamente lo que deja al usuario en la pantalla con el dropzone.
- **Archivos:**
  - Modificar: `src/modules/commercial/features/purchases/features/invoices/list/actions.server.ts`
  - Modificar: `.../invoices/create/CreatePurchaseInvoice.tsx`, `.../invoices/edit/EditPurchaseInvoice.tsx`
  - Modificar: `.../invoices/create/components/_PurchaseInvoiceForm.tsx` (solo props y el montaje)
  - Crear: `src/modules/commercial/shared/components/_FixedAssetAttachmentNotice.tsx`
- **Criterio de completitud:** cargando una factura de compra con un ítem cuya cuenta de egresos
  está marcada como BU, el cartel aparece al elegir el ítem y desaparece al quitarlo; la factura se
  guarda y se confirma igual con el cartel a la vista; el mismo cartel funciona en alta, en edición
  y en NC/ND de compra, que usan el mismo formulario.

#### Fase 6: Aviso persistente en el detalle mientras no haya adjunto

- **Objetivo:** que la factura ya guardada con líneas de Bien de Uso recuerde que falta el
  comprobante, justo en la pantalla donde se puede subir.
- **Tareas:**
  - [ ] `getPurchaseInvoiceById` (`list/actions.server.ts:258-...`): en el `include` de
        `lines.product` (líneas 273-281) agregar
        `defaultExpenseAccount: { select: { isFixedAsset: true } }`. No agrega Decimals nuevos, así
        que el bloque de conversión a `Number()` de las líneas (líneas ~463-478) queda igual.
  - [ ] `PurchaseInvoiceDetail.tsx`: calcular en el Server Component
        `const fixedAssetLines = findFixedAssetLines(...)` con la función de la fase 2, y renderizar
        un `Alert` ámbar cuando `fixedAssetLines.length > 0 && !invoice.documentUrl`, en el mismo
        bloque donde ya viven los tres avisos de recepción (líneas 103-146), con idéntico estilo y
        variante dark.
  - [ ] El `Alert` incluye un `Button variant="outline" size="sm"` que ancla a la tarjeta
        "Documento Adjunto" (`PurchaseInvoiceDetail.tsx:456-465`), a la que hay que darle un `id`
        para poder apuntarle.
  - [ ] El aviso desaparece solo: `_DocumentAttachment` ya hace `router.refresh()` tras subir, con
        lo cual `documentUrl` pasa a estar cargado y la condición deja de cumplirse.
- **Archivos:**
  - Modificar: `src/modules/commercial/features/purchases/features/invoices/list/actions.server.ts`
  - Modificar: `src/modules/commercial/features/purchases/features/invoices/detail/PurchaseInvoiceDetail.tsx`
- **Criterio de completitud:** una factura de compra con línea de BU y sin adjunto muestra el
  aviso; al subir el archivo el aviso desaparece sin recargar a mano; una factura sin líneas de BU
  no lo muestra nunca, tenga o no adjunto.

#### Fase 7: Tests de integración y verificación

- **Objetivo:** cubrir con Vitest lo que la función pura no alcanza: la cascada contra la base y el
  viaje del dato hasta el formulario.
- **Tareas:**
  - [ ] **Aclaración de testing:** el `CLAUDE.md` (regla 7) manda Cypress, pero en el repo **no
        existe la carpeta `cypress/` ni ningún script `cy:*` en `package.json`** (verificado). El
        testing real es **Vitest** (`npm run test` → `vitest run`, `vitest.config.ts` con
        `include: ['src/**/*.test.ts']`). Todo el testing de este ticket va en Vitest.
  - [ ] Crear
        `src/modules/accounting/features/accounts/fixed-asset-cascade.integration.test.ts`, contra la
        base real, siguiendo el patrón de `purchase-invoice-tributes.integration.test.ts`: aislar
        **solo** la frontera (`vi.mock` de `@/shared/lib/current-user`, `@/shared/lib/company`,
        `@/shared/lib/permissions`, `next/cache`) y ejercitar el código real `createAccount` /
        `updateAccount`. Prefijo `TSK618-` en los códigos de prueba y limpieza en `afterAll`.
        Casos: marcar el padre marca todo el subárbol; desmarcar el padre lo desmarca todo;
        desmarcar una hija y después editar el **nombre** del padre no la vuelve a marcar; crear una
        hija bajo un padre marcado nace marcada; mover una cuenta a un rubro marcado la marca a ella
        y a su subárbol.
  - [ ] Crear
        `src/modules/commercial/features/purchases/features/invoices/list/fixed-asset-notice.integration.test.ts`:
        que `getProductsForSelect` devuelva `defaultExpenseAccountIsFixedAsset` correcto para un ítem
        con cuenta marcada y para uno sin cuenta; que `getPurchaseInvoiceById` exponga el flag en las
        líneas; y que crear y **confirmar** una factura con línea de BU y sin adjunto funcione sin
        error (la sugerencia no bloquea — es la garantía de la decisión 2 de 1.7).
  - [ ] Correr el checklist de commit del `CLAUDE.md`: `npm run check-types` (comparar contra la
        línea base preexistente, no exigir cero), `npm run lint`, `npm run test`, y una pasada de
        `npm run build`.
- **Archivos:**
  - Crear: `src/modules/accounting/features/accounts/fixed-asset-cascade.integration.test.ts`
  - Crear: `.../invoices/list/fixed-asset-notice.integration.test.ts`
- **Criterio de completitud:** `npm run test` en verde, sin dejar datos de prueba en la base, y sin
  errores nuevos de tipos ni de lint respecto de la línea base.

#### Fase 8: Documentación del desarrollador y guía de usuario

- **Objetivo:** cumplir las reglas 8 y 10 del `CLAUDE.md` y dejar escritas las limitaciones
  conocidas para que no se lean como bugs.
- **Tareas:**
  - [ ] `docs/architecture/data-model.md`: documentar `Account.isFixedAsset` (qué significa, que se
        propaga en cascada al subárbol y que se puede desmarcar una cuenta puntual).
  - [ ] `docs/modules/accounting.md`: sección sobre la marca en el plan de cuentas, la cascada, la
        columna del Excel y la siembra del rubro `1.2.2` en el plan modelo. Aclarar que
        `isFixedAsset` **no** reemplaza a `AccountingSettings.fixedAssetAccountId`, que sigue siendo
        la cuenta de capitalización del asiento de alta de equipos
        (`integrations/equipment/index.ts:217`).
  - [ ] `docs/modules/commercial.md`: el aviso en la carga de factura de compra y en el detalle, con
        las **limitaciones**: (a) las facturas importadas de AFIP crean líneas sin `productId`
        (`list/lib/afip-import.server.ts:299-412`) y por lo tanto **no disparan el aviso** —fuera de
        alcance por decisión 4 de 1.7—; (b) una línea sin ítem cae en `purchasesAccountId` y no
        avisa; (c) un ítem sin "Cuenta de Egresos" tampoco avisa; (d) una empresa con `commercial`
        activo y `accounting` desactivado no tiene plan de cuentas y por lo tanto nunca ve el aviso;
        (e) ventas queda fuera de alcance por decisión 5 de 1.7.
  - [ ] `_AccountingGuide.tsx` (sección "Plan de Cuentas", líneas 40-58): cómo tildar "Bien de Uso",
        que se aplica a todo el rubro y que se puede destildar una cuenta suelta (el caso de las
        Amortizaciones Acumuladas).
  - [ ] `_CommercialGuide.tsx` (sección de facturas de compra): qué significa el cartel, que **no
        obliga**, que el archivo se sube desde el detalle de la factura y que el aviso del detalle se
        va solo al adjuntarlo. Mencionar el caso del ítem sin cuenta de egresos y el
        `_ImputationModal` de la lista de ítems para completarlas en masa.
- **Archivos:**
  - Modificar: `docs/architecture/data-model.md`, `docs/modules/accounting.md`, `docs/modules/commercial.md`
  - Modificar: `src/modules/help/features/guide/components/_AccountingGuide.tsx`,
    `src/modules/help/features/guide/components/_CommercialGuide.tsx`
- **Criterio de completitud:** las cinco limitaciones están escritas; la guía in-app describe el
  circuito completo (tildar la cuenta → cargar la factura → ver el cartel → adjuntar en el detalle)
  en lenguaje de usuario final.

#### Fase 9: Guía de presentación al cliente

- **Objetivo:** el entregable habitual del proyecto: un PDF con capturas reales que le muestra a la
  clienta que su pedido está resuelto.
- **Tareas:**
  - [ ] Crear `scripts/guia-presentacion/capturas-tsk618.mjs` sobre la base de
        `capturas-tsk644.mjs` (Playwright, login con las credenciales de dev, remoción del
        `nextjs-portal` antes de cada captura, salida a `scripts/guia-presentacion/assets/`).
        Capturas: (1) el switch "Bien de Uso" en el modal de edición de cuenta; (2) el árbol del plan
        con el badge BU propagado en el rubro `1.2.2`; (3) el cartel en el formulario de carga de la
        factura; (4) el aviso en el detalle con la tarjeta "Documento Adjunto"; (5) el detalle ya con
        el comprobante adjunto y sin aviso.
  - [ ] Crear `scripts/guia-presentacion/tsk-618.html` siguiendo la estructura y los estilos de
        `tsk-644.html`: el pedido textual de la clienta, qué se hizo, cómo se usa paso a paso, y una
        sección de límites conocidos (AFIP, líneas sin ítem, ventas).
  - [ ] Generar el PDF con
        `node scripts/guia-presentacion/generar-pdf.mjs scripts/guia-presentacion/tsk-618.html docs/presentaciones/TSK-618-bienes-de-uso.pdf`.
- **Archivos:**
  - Crear: `scripts/guia-presentacion/capturas-tsk618.mjs`, `scripts/guia-presentacion/tsk-618.html`
  - Crear: `scripts/guia-presentacion/assets/tsk618-*.png`
  - Crear: `docs/presentaciones/TSK-618-bienes-de-uso.pdf`
- **Criterio de completitud:** el PDF se genera sin errores, todas las capturas son de la app real
  con datos coherentes, y el documento responde textualmente al pedido del ticket.

### 2.2 Orden de ejecución

1. **Fase 1 primero, sin excepción.** Nada compila contra `isFixedAsset` hasta que la migración
   esté aplicada y `npm run db:generate` haya corrido. Es el cuello de botella de las fases 3 a 7.
2. **Fase 2 es independiente y puede ir en paralelo con la 1** (o antes): no toca base ni Prisma,
   es lógica pura con sus tests. Conviene tenerla lista antes de la 5 y la 6, que la consumen.
3. **Fase 3 después de la 1.** Es el corazón del ticket: sin una cuenta marcada, las fases 5 y 6 no
   tienen nada que mostrar y no se pueden probar a mano.
4. **Fase 4 después de la 3**, no antes: la exportación necesita el campo en el `select` y la
   importación necesita que el modelo y el schema Zod ya lo acepten. Si se saltea, exportar e
   importar borra la marca en silencio (riesgo 6).
5. **Fase 5 después de la 2 y la 3.** Depende de la función pura y de que exista al menos una
   cuenta marcada para verificarla de punta a punta.
6. **Fase 6 después de la 5**, para reutilizar el texto y los tokens de color ya definidos y evitar
   dos redacciones distintas del mismo aviso.
7. **Fase 7 al final del código**, con todo montado: los tests de integración de la cascada
   necesitan la fase 3 completa y los del aviso necesitan la 5 y la 6.
8. **Fases 8 y 9 al cierre**, en ese orden: la guía de presentación toma capturas de la app
   terminada, así que no puede adelantarse.

**Riesgos de orden a tener presentes:**

- Olvidar `npm run db:generate` después de la migración produce errores de tipo confusos en las
  fases 3 a 6 que parecen del código y son del cliente Prisma desactualizado.
- La condición "solo propagar cuando el flag cambia" (fase 3) es el punto más delicado del ticket:
  implementarla como "propagar siempre que venga en el input" borra las excepciones desmarcadas a
  mano en el primer guardado del padre, y el síntoma aparece recién en producción.
- La fase 4 y la cascada de la fase 3 se pisan si la importación dispara la cascada: la
  importación tiene que escribir el valor literal de cada fila.
- Cambiar `getPurchasesDefaultAccountType` por `getPurchasesDefaultAccount` toca código de TSK-583
  en tres archivos; hay que hacerlo en un solo paso y verificar que `_LineCostCenterField` sigue
  recibiendo `defaultAccountType` con la misma forma, o se rompe el campo de centro de costo.

### 2.3 Estimación de complejidad

- Fase 1 (modelo y migración): **baja**
- Fase 2 (lógica pura + tests): **baja**
- Fase 3 (ABM + cascada + plan modelo): **alta**
- Fase 4 (round-trip del Excel): **media**
- Fase 5 (aviso en el formulario): **media**
- Fase 6 (aviso en el detalle): **baja**
- Fase 7 (tests de integración y verificación): **media**
- Fase 8 (documentación dev + guía de usuario): **baja**
- Fase 9 (guía de presentación al cliente): **media**

**Complejidad total: media-alta.** El grueso del riesgo está concentrado en la fase 3 (la cascada
y su interacción con las excepciones manuales) y, en menor medida, en la 4. Las fases 5 y 6 son
presentación pura sin lógica de negocio, y las 8 y 9 son entregables sin riesgo técnico.

## 3. Diseño

Bajada técnica de las nueve fases de la sección 2, respetando las seis decisiones cerradas de
1.7. Todas las firmas están listas para implementar: sin `any`, con los tipos inferidos de
Prisma y de Zod, y con los nombres exactos de los archivos que ya existen.

### 3.1 Arquitectura de la solución

La marca nace en el plan de cuentas, viaja por el ítem hasta el formulario de compra y se
vuelve a leer en el detalle. Tres capas, ningún import cruzado entre módulos: la única pieza
compartida entre contabilidad y comercial es el flag en la tabla `accounts`, que cada módulo
consulta con su propia query.

```
CONTABILIDAD (dueño del dato)
  Account.isFixedAsset  ← ABM (_CreateAccountModal / _EditAccountModal)
        ▲                ← cascada al subárbol (updateAccount)
        │                ← herencia del padre (createAccount)
        │                ← round-trip Excel (import-export.server.ts)
        │                ← siembra del rubro 1.2.2 (loadModelChartOfAccounts)
        │
COMERCIAL (consumidor de solo lectura)
        │
        ├─ getProductsForSelect()        → product.defaultExpenseAccount.isFixedAsset
        ├─ getPurchasesDefaultAccount()  → settings.purchasesAccount.isFixedAsset
        │        │
        │        ▼
        │   effectiveIsFixedAsset(cuentaDelItem, cuentaPorDefecto)   ← lógica pura
        │        │                                                     (fixed-asset.ts)
        │        ▼
        ├─ _FixedAssetAttachmentNotice  → Alert en el formulario de carga
        │
        └─ getPurchaseInvoiceById()      → line.product.defaultExpenseAccount.isFixedAsset
                 │
                 ▼
            PurchaseInvoiceDetail        → Alert mientras !documentUrl
                                         → ancla a la tarjeta "Documento Adjunto"
```

**Decisiones de arquitectura**

1. **La cascada se materializa, no se resuelve en lectura** (punto abierto de 1.2.3). Escribir
   el booleano en cada descendiente deja la consulta del formulario en un `select` de un solo
   campo, sin subir por `parentId` en cada línea. El costo —mantener la coherencia en
   `createAccount` y en el cambio de `parentId`— se paga una vez, en dos actions, y queda
   cubierto por los tests de integración de la fase 7.

2. **La regla "¿esta línea es Bien de Uso?" vive en una sola función pura**
   (`commercial/shared/fixed-asset.ts`), igual que TSK-583 hizo con `cost-center.ts`. El
   formulario (cliente) y el detalle (Server Component) la importan, así que no pueden
   divergir.

3. **Nada de lo nuevo toca el guardado.** El aviso es presentación: no entra en
   `purchaseInvoiceFormSchema`, ni en `zodResolver`, ni en `handleInvalid`, ni en
   `createPurchaseInvoice` / `updatePurchaseInvoice` / `confirmPurchaseInvoice`. Es la garantía
   literal del ticket ("que no obligue, solo que sugiera").

4. **El recorrido del subárbol se extrae a un helper puro y testeable**
   (`collectSubtreeIds`), copiando el patrón ya probado de `disableAccount`
   (`accounts/actions.server.ts:392-414`). `disableAccount` pasa a usarlo sin cambiar su
   comportamiento observable.

### 3.2 Modelos de datos

#### 3.2.1 Prisma — `model Account`

Un único campo aditivo, junto a los dos flags de comportamiento contable que ya existen
(`prisma/schema.prisma:314-315`):

```prisma
adjustableByInflation    Boolean            @default(false) @map("adjustable_by_inflation")
requiresAuxiliary        AuxiliaryType?     @map("requires_auxiliary")
// TSK-618: marca de Bien de Uso. Se propaga en cascada al subárbol desde el
// rubro, y se puede destildar una cuenta puntual (ej. Amortizaciones Acumuladas).
isFixedAsset             Boolean            @default(false) @map("is_fixed_asset")
```

Migración `prisma/migrations/<timestamp>_tsk_618_fixed_asset_account_flag/migration.sql`:

```sql
ALTER TABLE "accounts" ADD COLUMN "is_fixed_asset" BOOLEAN NOT NULL DEFAULT false;
```

Sin FK, sin índice y sin backfill: el `false` es el estado correcto de toda cuenta
preexistente (decisión 3 de 1.7 — la única siembra es la del plan modelo). No se agrega
índice porque el flag nunca se usa como filtro de búsqueda: siempre se lee junto a una cuenta
ya localizada por `id` o por `companyId + code`.

#### 3.2.2 Zod — `accountSchema`

`src/modules/accounting/shared/types/index.ts:5-12`:

```ts
export const accountSchema = z.object({
  code: z.string().min(1, 'El código es requerido'),
  name: z.string().min(2, 'El nombre debe tener al menos 2 caracteres'),
  type: z.nativeEnum(AccountType),
  nature: z.nativeEnum(AccountNature),
  description: z.string().optional(),
  parentId: z.string().uuid().optional(),
  /**
   * TSK-618. `optional()` a propósito: cuando no viene, `createAccount` hereda
   * el valor del padre y `updateAccount` no dispara ninguna cascada.
   */
  isFixedAsset: z.boolean().optional(),
});

export type CreateAccountInput = z.infer<typeof accountSchema>;
```

`isFixedAsset` **tiene que ser opcional**: `undefined` es el valor que distingue "el usuario no
tocó el flag" de "el usuario lo apagó". Sin esa distinción, la cascada no puede saber si
cambió, que es exactamente el riesgo señalado en 2.2.

#### 3.2.3 TypeScript — `AccountWithChildren`

Mismo archivo, líneas 73-86:

```ts
export interface AccountWithChildren {
  id: string;
  code: string;
  name: string;
  type: AccountType;
  nature: AccountNature;
  description?: string | null;
  isActive: boolean;
  isLeaf: boolean;
  isFixedAsset: boolean;          // ← TSK-618
  disabledFrom?: Date | null;
  disabledFromFiscalYearId?: string | null;
  parentId?: string | null;
  children: AccountWithChildren[];
}
```

`buildAccountTree` (`accounting/shared/utils/index.ts:37-62`) hace `{ ...account, children: [] }`
sobre el `Account` de Prisma, así que **no hay que tocarla**: el campo viaja solo en cuanto
existe en el modelo. Lo mismo vale para `getAccounts`, que no usa `select` (devuelve la cuenta
completa).

#### 3.2.4 Tipos inferidos del lado comercial

Ninguno se declara a mano; los tres se infieren del retorno de sus actions
(`invoices/list/actions.server.ts:1752-1758`):

```ts
export type ProductSelectItem = Awaited<ReturnType<typeof getProductsForSelect>>[number];
// gana: defaultExpenseAccountIsFixedAsset: boolean | null

export type PurchaseInvoiceDetail = Awaited<ReturnType<typeof getPurchaseInvoiceById>>;
// gana: lines[].product.defaultExpenseAccount: { isFixedAsset: boolean } | null
```

#### 3.2.5 Modelo de la línea, visto desde la regla

`src/modules/commercial/shared/fixed-asset.ts` (fase 2):

```ts
/** Una línea de comprobante, vista desde la sugerencia de adjunto. */
export interface FixedAssetLineCheck {
  /** Descripción de la línea, para nombrarla en el aviso. */
  description: string;
  /** Valor YA resuelto por `effectiveIsFixedAsset`. */
  isFixedAsset?: boolean | null;
}
```

### 3.3 Funciones y métodos

#### Fase 1 — Script de diagnóstico

`prisma/scripts/diagnose-fixed-asset-accounts.ts`, sin escrituras, con la estructura del bloque
de diagnóstico de `backfill-internal-taxes.ts`:

```ts
import 'dotenv/config';

interface CompanyFixedAssetDiagnosis {
  companyId: string;
  companyName: string;
  markedAccounts: number;
  /** Solo cuando markedAccounts === 0: pista de por dónde arrancar a tildar. */
  fixedAssetSettingHint: { code: string; name: string } | null;
}

async function diagnoseFixedAssetAccounts(): Promise<CompanyFixedAssetDiagnosis[]>;
async function main(): Promise<void>;
```

Detecta el riesgo 2 del análisis (empresa sin nada marcado = silencio total) sin decidir nada
por el usuario. Idempotente por construcción: no escribe.

#### Fase 2 — Lógica pura (`src/modules/commercial/shared/fixed-asset.ts`)

```ts
/**
 * Espejo exacto de `effectiveAccountType` (`cost-center.ts:37-42`).
 *
 * `accountIsFixedAsset` es la marca de la cuenta propia del ítem. Cuando el
 * ítem no tiene cuenta de egresos cargada, el asiento no deja la línea sin
 * imputar: cae en `purchasesAccountId`
 * (`accounting/features/integrations/commercial/index.ts:505`), así que el
 * criterio tiene que mirar esa cuenta efectiva.
 *
 * OJO con el `null`: "el ítem no tiene cuenta" (null/undefined) y "el ítem
 * tiene una cuenta que no es BU" (false) NO son lo mismo. Solo el primero cae
 * en la cuenta por defecto.
 */
export function effectiveIsFixedAsset(
  accountIsFixedAsset: boolean | null | undefined,
  defaultIsFixedAsset: boolean | null | undefined
): boolean {
  return accountIsFixedAsset ?? defaultIsFixedAsset ?? false;
}

/** Líneas que se imputan a una cuenta marcada como Bien de Uso. Conserva el orden. */
export function findFixedAssetLines<T extends FixedAssetLineCheck>(lines: T[]): T[];

/**
 * Enumeración de las líneas involucradas, con singular/plural, en un solo
 * lugar para el formulario y el detalle (mismo patrón que
 * `buildMissingCostCenterMessage`). Devuelve '' con la lista vacía.
 */
export function buildFixedAssetSuggestionMessage(lines: FixedAssetLineCheck[]): string;

/** Textos del aviso, únicos para las dos pantallas (ver 3.4.4 y 3.4.5). */
export const FIXED_ASSET_ATTACHMENT_SUGGESTION: string;
export const FIXED_ASSET_ATTACHMENT_PENDING: string;
```

Implementación de `buildFixedAssetSuggestionMessage` (comportamiento exigido por los tests):

| Líneas | Salida |
|---|---|
| 0 | `''` |
| 1 | `La línea «Rodado Ford Ranger» se imputa a una cuenta de Bienes de Uso.` |
| 2+ | `Hay 2 líneas imputadas a cuentas de Bienes de Uso: «Rodado Ford Ranger», «Instalación de balanza».` |

Una descripción vacía se muestra como `(sin descripción)`, para que el aviso nunca quede con
comillas vacías.

El módulo **no importa Prisma ni nada de servidor**: es la condición para que
`fixed-asset.test.ts` corra sin base, igual que `cost-center.test.ts`.

#### Fase 3 — Helpers puros del subárbol

Archivo nuevo `src/modules/accounting/shared/utils/account-subtree.ts` (fuera de
`utils/index.ts`, que carga `next/cache` con un `require` y arrastraría dependencias de
servidor al test):

```ts
/** Una cuenta, vista desde el recorrido del árbol. */
export interface AccountNodeRef {
  id: string;
  parentId: string | null;
}

/**
 * IDs de la cuenta raíz y de TODOS sus descendientes, con la raíz primero.
 *
 * Mismo algoritmo que `disableAccount` (`accounts/actions.server.ts:392-414`):
 * índice `childrenByParent` + pila. Función PURA: recibe la lista plana ya
 * leída de la base, no consulta nada.
 */
export function collectSubtreeIds(accounts: AccountNodeRef[], rootId: string): string[];

export type FixedAssetCascadeReason = 'FLAG_CHANGED' | 'PARENT_CHANGED';

export interface FixedAssetCascade {
  /** Valor a escribir en la raíz y en todo su subárbol. */
  value: boolean;
  reason: FixedAssetCascadeReason;
}

/**
 * Decide SI hay que propagar y con qué valor. `null` = no propagar nada.
 *
 * ESTE ES EL PUNTO MÁS DELICADO DEL TICKET (2.2). La cascada se dispara
 * únicamente cuando el valor efectivo CAMBIA:
 *
 *  - `input === undefined`            → el formulario no mandó el flag: no se propaga.
 *  - `input === current`              → guardaron el rubro sin tocar el tilde (p. ej.
 *                                       editando solo el nombre): NO se propaga, o se
 *                                       pisarían las excepciones destildadas a mano,
 *                                       como las Amortizaciones Acumuladas (riesgo 3).
 *  - `input !== current`              → cascada con `input`, razón FLAG_CHANGED.
 *  - cambió el padre y el padre nuevo → cascada con el valor del padre, razón
 *    tiene otro valor                   PARENT_CHANGED (riesgo 10).
 *  - cambió el padre pero tiene el    → NO se propaga: reescribir el subárbol con el
 *    mismo valor                        mismo valor también borraría las excepciones.
 *  - se quedó sin padre (raíz)        → no hay de quién heredar: no se propaga.
 *
 * Si el flag cambió Y el padre cambió en el mismo guardado, manda el flag
 * explícito: es lo que el usuario acaba de tildar en pantalla.
 */
export function resolveFixedAssetCascade(params: {
  current: boolean;
  input: boolean | undefined;
  parentChanged: boolean;
  /** `isFixedAsset` del padre nuevo; `null` si la cuenta queda sin padre. */
  newParentIsFixedAsset: boolean | null;
}): FixedAssetCascade | null;
```

Test acompañante `account-subtree.test.ts` (Vitest, sin base), que cubre las seis filas de esa
tabla más el recorrido de un árbol de tres niveles.

#### Fase 3 — `createAccount`

`src/modules/accounting/features/accounts/actions.server.ts:60-105`. La firma no cambia
(`CreateAccountInput` ya trae el campo nuevo); cambia el cuerpo de la transacción:

```ts
export async function createAccount(
  params: { companyId: string; input: CreateAccountInput }
): Promise<Account>;
```

```ts
const account = await prisma.$transaction(async (tx) => {
  // TSK-618: la cuenta nueva HEREDA la marca del padre. Sin esto, una hija
  // creada después de tildar el rubro queda desalineada en silencio (riesgo 10).
  // Un valor explícito en el input gana: el modal deja destildar la hija en el alta.
  let inheritedIsFixedAsset = false;
  if (input.parentId) {
    const parent = await tx.account.findUnique({
      where: { id: input.parentId },
      select: { isFixedAsset: true },
    });
    inheritedIsFixedAsset = parent?.isFixedAsset ?? false;
  }

  const created = await tx.account.create({
    data: {
      code: normalizedCode,
      name: input.name,
      type: input.type,
      nature: input.nature,
      description: input.description,
      parentId: input.parentId,
      companyId,
      isLeaf: true,
      isFixedAsset: input.isFixedAsset ?? inheritedIsFixedAsset,
    },
  });

  if (input.parentId) {
    await tx.account.update({ where: { id: input.parentId }, data: { isLeaf: false } });
  }

  return created;
});

logger.info('Cuenta contable creada', {
  data: { accountId: account.id, userId, isFixedAsset: account.isFixedAsset },
});
```

Una cuenta nueva nace hoja, así que **no hay subárbol que propagar**: la herencia del padre es
todo lo que hace falta.

#### Fase 3 — `updateAccount`

Mismo archivo, líneas 114-190. Firma nueva, retrocompatible (el resultado sigue siendo la
cuenta, con un campo más):

```ts
export interface FixedAssetCascadeResult {
  applied: boolean;
  /** Valor propagado. Irrelevante si `applied` es false. */
  value: boolean;
  reason: FixedAssetCascadeReason | null;
  /** Descendientes reescritos (NO incluye la cuenta editada). */
  affectedAccountIds: string[];
}

export type UpdateAccountResult = Account & {
  fixedAssetCascade: FixedAssetCascadeResult;
};

export async function updateAccount(
  companyId: string,
  accountId: string,
  input: Partial<CreateAccountInput>
): Promise<UpdateAccountResult>;
```

Es el único caller el modal de edición (verificado por grep: `_EditAccountModal.tsx:86`), que
hoy descarta el resultado; con la intersección `Account & {...}` cualquier acceso previo a
`result.id` sigue compilando.

Secuencia completa, sobre lo que ya existe:

```ts
// 1. (sin cambios) cuenta existente, pertenencia a la empresa, código normalizado,
//    validaciones de padre y naturaleza, y el `parentChanged` que ya se calcula:
const parentChanged = input.parentId !== undefined && input.parentId !== account.parentId;

// 2. TSK-618: valor del padre nuevo, solo si hace falta.
let newParentIsFixedAsset: boolean | null = null;
if (parentChanged && input.parentId) {
  const newParent = await prisma.account.findUnique({
    where: { id: input.parentId },
    select: { isFixedAsset: true },
  });
  newParentIsFixedAsset = newParent?.isFixedAsset ?? null;
}

// 3. ¿Hay cascada? Decisión pura y testeada sin base.
const cascade = resolveFixedAssetCascade({
  current: account.isFixedAsset,
  input: input.isFixedAsset,
  parentChanged,
  newParentIsFixedAsset,
});

// 4. El subárbol solo se lee cuando hay algo que propagar: una edición común de
//    nombre o descripción NO dispara el findMany de todas las cuentas.
let descendantIds: string[] = [];
if (cascade) {
  const allAccounts = await prisma.account.findMany({
    where: { companyId },
    select: { id: true, parentId: true },
  });
  descendantIds = collectSubtreeIds(allAccounts, accountId).filter((id) => id !== accountId);
}

// 5. Todo en la transacción que ya existía.
const updatedAccount = await prisma.$transaction(async (tx) => {
  const updated = await tx.account.update({
    where: { id: accountId },
    data: {
      ...input,
      ...(normalizedCode ? { code: normalizedCode } : {}),
      // La cascada por cambio de padre pisa lo que haya mandado el formulario:
      // al mover una cuenta de rubro, manda el rubro nuevo.
      ...(cascade ? { isFixedAsset: cascade.value } : {}),
    },
  });

  // isLeaf del padre anterior y del nuevo (sin cambios).
  if (parentChanged) { /* ... recomputeIsLeaf / isLeaf:false ... */ }

  // Un solo updateMany para todo el subárbol: nada de N updates en un for.
  if (cascade && descendantIds.length > 0) {
    await tx.account.updateMany({
      where: { id: { in: descendantIds }, companyId },
      data: { isFixedAsset: cascade.value },
    });
  }

  return updated;
});

logger.info('Cuenta contable actualizada', {
  data: {
    accountId,
    userId,
    isFixedAsset: updatedAccount.isFixedAsset,
    cascadeReason: cascade?.reason ?? null,
    affected: cascade ? descendantIds.length : 0,
  },
});
```

Notas de implementación:

- El `where` del `updateMany` lleva `companyId` además de los ids. Los ids ya salen de un
  `findMany` filtrado por empresa; es defensa en profundidad barata contra un id colado.
- El `checkPermission('accounting.accounts', 'update', { redirect: true })` de la línea 117
  **queda donde está**: la cascada no crea ningún camino que lo esquive, porque `collectSubtreeIds`
  y `resolveFixedAssetCascade` son puros y no consultan la base.
- Qué pasa con las hijas: se reescriben **todas**, incluidas las destildadas a mano. Es
  intencional y es lo que se le avisa al usuario en el `AlertDialog` de 3.4.2 antes de guardar.
  Lo que la condición del punto 3 garantiza es que eso **solo** ocurra cuando el usuario movió
  el tilde o movió la cuenta de rubro, nunca al corregir un nombre.

#### Fase 3 — `disableAccount` reusa el helper

`accounts/actions.server.ts:392-414`: el bloque `childrenByParent` + pila se reemplaza por

```ts
const allAccounts = await prisma.account.findMany({
  where: { companyId },
  select: { id: true, parentId: true },
});
const affectedAccountIds = collectSubtreeIds(allAccounts, accountId);
```

`collectSubtreeIds` devuelve la raíz primero, igual que el DFS actual, así que
`DisableAccountResult.affectedAccountIds` conserva el mismo contenido y el mismo primer
elemento. **Sin cambio de comportamiento observable.**

#### Fase 3 — `loadModelChartOfAccounts`

`data/model-chart-of-accounts.ts` lleva un encabezado que dice "NO editar a mano: regenerar
desde el .xls", así que el array no se toca y la marca vive en un archivo hermano nuevo,
`src/modules/accounting/features/accounts/data/model-fixed-assets.ts`, que sobrevive a una
regeneración del dataset:

```ts
/**
 * Rubros del plan modelo que nacen marcados como Bien de Uso (TSK-618,
 * decisión 3 de 1.7). El prefijo cubre las 31 cuentas de `1.2.2/*` del dataset
 * — el rubro BIENES DE USO, sus ocho sub-rubros y las imputables de cada uno —
 * y ninguna otra.
 *
 * Incluye a propósito las Amortizaciones Acumuladas: el criterio es "el rubro
 * entero", igual que la cascada del ABM, y quien quiera la excepción la
 * destilda desde el plan de cuentas.
 */
export const MODEL_FIXED_ASSET_CODE_PREFIXES = ['1.2.2'] as const;

/** `true` si el código pertenece a alguno de los rubros de Bienes de Uso del modelo. */
export function isModelFixedAssetCode(code: string): boolean {
  return MODEL_FIXED_ASSET_CODE_PREFIXES.some(
    (prefix) => code === prefix || code.startsWith(`${prefix}/`)
  );
}
```

El `startsWith` compara contra `'1.2.2/'` con la barra incluida, para que un futuro `1.2.20`
no entre por accidente (hoy el formato `x.x.x/xx/xx` lo hace imposible, pero la función no
depende de eso).

En `loadModelChartOfAccounts` (`actions.server.ts:496-552`), una sola línea en el `.map`:

```ts
return {
  id: idByCode.get(account.code)!,
  companyId,
  code: account.code,
  name: account.name,
  type: account.type,
  nature: natureForType(account.type),
  isLeaf: account.isLeaf,
  parentId,
  isFixedAsset: isModelFixedAssetCode(account.code),   // ← TSK-618
};
```

Firma sin cambios: `Promise<{ created: number }>`.

Test en `data/model-chart-of-accounts.test.ts`:

```ts
it('marca como Bien de Uso exactamente las 31 cuentas del rubro 1.2.2', () => {
  const marcadas = MODEL_CHART_OF_ACCOUNTS.filter((a) => isModelFixedAssetCode(a.code));
  expect(marcadas).toHaveLength(31);
  expect(marcadas.every((a) => a.code.startsWith('1.2.2/'))).toBe(true);
});
```

#### Fase 4 — Excel: resolución de columnas por encabezado

`lib/import-export.server.ts`. **Este es el punto donde el diseño se aparta del plan por una
razón concreta** (ver 3.7.3): la plantilla vacía tiene 6 columnas y el export 7, con "Estado"
en la 7. Si la columna nueva se lee por índice fijo, reimportar un archivo exportado **antes**
de este ticket haría que la celda 7 —que dice `Activa`— se interprete como valor de "Bien de
Uso" y rompa el archivo entero con errores de fila. Por eso las columnas se resuelven por
nombre de encabezado, con caída a las posiciones históricas:

```ts
/** Índices (1-based) de cada columna en la hoja "Plan de Cuentas". */
export interface AccountColumnIndexes {
  code: number;
  name: number;
  type: number;
  nature: number;
  description: number;
  parentCode: number;
  /** `null` cuando el archivo es anterior a TSK-618 y no trae la columna. */
  isFixedAsset: number | null;
}

/** Posiciones históricas, para un archivo sin encabezados reconocibles. */
const LEGACY_COLUMN_INDEXES: AccountColumnIndexes = {
  code: 1, name: 2, type: 3, nature: 4, description: 5, parentCode: 6, isFixedAsset: null,
};

/**
 * Mapea encabezado → índice, normalizando a minúsculas y sin acentos.
 * Acepta tanto "Bien de Uso" (export) como "Bien de Uso (Sí/No)" (plantilla).
 */
function resolveAccountColumnIndexes(headerRow: ExcelJS.Row): AccountColumnIndexes;

/**
 * Lee una celda Sí/No.
 *  - `true`  ← 'sí', 'si', 's', 'x', 'true', 'verdadero', '1'
 *  - `false` ← vacío, 'no', 'n', 'false', 'falso', '0'
 *  - `null`  ← cualquier otra cosa → error de fila con mensaje claro,
 *              nunca un `false` mudo.
 */
function parseSiNoCell(raw: unknown): boolean | null;
```

`validateAccountRow` suma el campo y su error:

```ts
function validateAccountRow(row: {
  code: string;
  name: string;
  type: string;
  nature: string;
  description?: string;
  parentCode?: string;
  /** Texto crudo de la celda "Bien de Uso"; `undefined` si el archivo no la trae. */
  isFixedAssetRaw?: string;
}): { valid: boolean; errors: string[] };
```

con el mensaje: `Valor inválido en "Bien de Uso": use Sí o No`.

El array `accountsToImport` gana `isFixedAsset?: boolean`, y la creación dentro de la
transacción escribe **el valor literal de la fila**:

```ts
const newAccount = await tx.account.create({
  data: {
    companyId,
    code: accountData.code,
    name: accountData.name,
    type: accountData.type,
    nature: accountData.nature,
    description: accountData.description,
    parentId,
    isLeaf: true,
    // TSK-618: el archivo es la fuente de verdad de esta corrida. NO se hereda
    // del padre ni se dispara la cascada del ABM: pisaría las excepciones que
    // el usuario escribió a mano en el Excel (decisión 6 de 1.7).
    isFixedAsset: accountData.isFixedAsset ?? false,
  },
});
```

Exportación: `select` con `isFixedAsset: true`, octava columna `'Bien de Uso'` después de
`'Estado'`, valor `'Sí' | 'No'`, ancho 12 y `autoFilter` hasta `headers.length` (que ya se
calcula solo).

`lib/excel-template.ts`: séptimo encabezado `'Bien de Uso (Sí/No)'`, `getColumn(7).width = 15`
en la hoja de datos y en la de ejemplo, la séptima celda de cada fila de `exampleData` (`'No'`,
salvo una fila de bien de uso para que se vea el caso), y una sección nueva en las
instrucciones:

> **6. Bien de Uso**
> - Escriba `Sí` en las cuentas del rubro Bienes de Uso (inmuebles, rodados, maquinarias…).
> - Deje vacío o escriba `No` en el resto.
> - Al cargar una factura de compra imputada a una de esas cuentas, el sistema sugiere adjuntar
>   el comprobante escaneado.
> - La importación toma el valor de cada fila tal cual: no se hereda de la cuenta padre.

#### Fase 5 — Actions de compras

`src/modules/commercial/features/purchases/features/invoices/list/actions.server.ts`.

```ts
/**
 * Cuenta de compras por defecto de la empresa (TSK-583 + TSK-618).
 *
 * Reemplaza a `getPurchasesDefaultAccountType`, que devolvía solo el `type`.
 * Los dos únicos callers son `CreatePurchaseInvoice.tsx` y
 * `EditPurchaseInvoice.tsx` (verificado por grep), así que el cambio se hace de
 * una sola vez y `_LineCostCenterField` sigue recibiendo `defaultAccountType`
 * con la misma forma (`string | null`).
 */
export interface PurchasesDefaultAccount {
  /** Tipo de la cuenta (`AccountType` de Prisma), o null si no hay configuración. */
  type: string | null;
  /** TSK-618: si la cuenta por defecto está marcada como Bien de Uso. */
  isFixedAsset: boolean;
}

export async function getPurchasesDefaultAccount(): Promise<PurchasesDefaultAccount> {
  await checkPermission('commercial.purchases', 'view', { redirect: true });

  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  const settings = await prisma.accountingSettings.findUnique({
    where: { companyId },
    select: { purchasesAccount: { select: { type: true, isFixedAsset: true } } },
  });

  return {
    type: settings?.purchasesAccount?.type ?? null,
    isFixedAsset: settings?.purchasesAccount?.isFixedAsset ?? false,
  };
}
```

`getProductsForSelect` — dos líneas:

```ts
// El tipo de la cuenta decide si la línea admite centro de costo (TSK-583);
// la marca decide si se sugiere adjuntar el comprobante (TSK-618).
defaultExpenseAccount: { select: { type: true, isFixedAsset: true } },
...
defaultExpenseAccountType: p.defaultExpenseAccount?.type ?? null,
// `?? null`, NO `?? false`: un ítem SIN cuenta de egresos tiene que caer en la
// cuenta por defecto de la empresa, igual que hace `defaultExpenseAccountType`.
// Con `?? false` volvería el falso negativo que TSK-583 tuvo que corregir.
defaultExpenseAccountIsFixedAsset: p.defaultExpenseAccount?.isFixedAsset ?? null,
```

Los `Number(p.costPrice)` y `Number(p.vatRate)` quedan intactos (regla 9); el flag es booleano
y no agrega Decimals.

#### Fase 6 — Detalle

`getPurchaseInvoiceById` (`list/actions.server.ts:258-...`), dentro del `include` de
`lines.product` (líneas 273-281):

```ts
product: {
  select: {
    id: true,
    code: true,
    name: true,
    unitOfMeasure: true,
    trackStock: true,
    // TSK-618: marca de Bien de Uso de la cuenta de egresos del ítem.
    defaultExpenseAccount: { select: { isFixedAsset: true } },
  },
},
```

No agrega ningún Decimal, así que el bloque de conversión a `Number()` de las líneas
(~463-478) queda como está: el `...line` ya arrastra el `product` completo.

`PurchaseInvoiceDetail` resuelve la cuenta por defecto con la misma action del formulario, para
que las dos pantallas apliquen literalmente la misma regla:

```ts
export async function PurchaseInvoiceDetail({ invoiceId }: Props) {
  const [invoice, defaultAccount] = await Promise.all([
    getPurchaseInvoiceById(invoiceId),
    getPurchasesDefaultAccount(),
  ]);

  // TSK-618: misma regla que el formulario de carga, misma función pura.
  const fixedAssetLines = findFixedAssetLines(
    invoice.lines.map((line) => ({
      description: line.description,
      isFixedAsset: effectiveIsFixedAsset(
        line.product?.defaultExpenseAccount?.isFixedAsset,
        defaultAccount.isFixedAsset
      ),
    }))
  );
  const suggestAttachment = fixedAssetLines.length > 0 && !invoice.documentUrl;
  // ...
}
```

Ambas actions ya exigen `commercial.purchases` → `view`, así que el `Promise.all` no abre
ningún camino sin permiso.

### 3.4 Interfaces de usuario

#### 3.4.1 `_CreateAccountModal.tsx` — tilde con herencia del padre

Un `Switch` de shadcn/ui debajo del campo "Cuenta Padre" y encima de "Descripción":

```tsx
<div className="flex items-start justify-between gap-4 rounded-md border p-3">
  <div className="space-y-1">
    <Label htmlFor="isFixedAsset">Bien de Uso</Label>
    <p className="text-xs text-muted-foreground">
      Marcá las cuentas del rubro Bienes de Uso. Al cargar una factura de compra
      imputada a ellas, el sistema va a sugerir adjuntar el comprobante.
    </p>
  </div>
  <Switch
    id="isFixedAsset"
    checked={form.watch('isFixedAsset') ?? false}
    onCheckedChange={(checked) => form.setValue('isFixedAsset', checked)}
    disabled={isLoading}
  />
</div>
```

**Herencia visible.** Al elegir la cuenta padre, el switch se sincroniza con el valor del padre
(`accounts` ya viene de `getAccounts`, que devuelve la cuenta completa, así que el cliente
tiene el flag sin ningún fetch extra):

```tsx
const parentId = form.watch('parentId');
useEffect(() => {
  const parent = accounts.find((a) => a.id === parentId);
  form.setValue('isFixedAsset', parent?.isFixedAsset ?? false);
}, [parentId, accounts]);
```

Así el usuario **ve** la herencia antes de guardar y puede destildarla en el acto (el caso de
crear una Amortización Acumulada nueva bajo un rubro marcado). El servidor hace lo mismo por su
cuenta, por si el campo no llega.

Ese `Array<{ id; code; name; type }>` del `useState` de la línea 43 pasa a incluir
`isFixedAsset: boolean`.

#### 3.4.2 `_EditAccountModal.tsx` — tilde + confirmación de cascada

Mismo bloque de `Switch`, con `defaultValues` sumando `isFixedAsset: account.isFixedAsset`, y
visible solo con permiso (redundante con el gate de `_AccountsTable`, pero es la regla 11):

```tsx
const { hasPermission } = usePermissions();
const canUpdate = hasPermission('accounting.accounts', 'update');
```

**Qué ve el usuario cuando la cuenta tiene hijas.** `account.children` viene de
`buildAccountTree`, que arma el árbol completo, así que el modal puede contar el subárbol sin
consultar nada:

```tsx
function countDescendants(account: AccountWithChildren): number {
  return account.children.reduce((acc, child) => acc + 1 + countDescendants(child), 0);
}
```

El submit se intercepta: si el switch cambió respecto de `account.isFixedAsset` **y** hay
descendientes, se abre un `AlertDialog` (nunca `confirm()`, regla 5) con los datos guardados en
estado; al confirmar, recién ahí se llama a `updateAccount`.

```
Título:  Aplicar «Bien de Uso» a todo el rubro
         (o «Quitar «Bien de Uso» de todo el rubro» al destildar)

Cuerpo:  «1.2.2/00/00 — BIENES DE USO» tiene 30 cuentas debajo.
         Al guardar, la marca de Bien de Uso se aplica a todas ellas, incluidas
         las que hayas destildado a mano (por ejemplo, las Amortizaciones
         Acumuladas). Después vas a poder volver a destildarlas una por una.

Botones: Cancelar   |   Aplicar a todo el rubro
```

Cuando la cuenta **no** tiene hijas, o el switch no cambió, el guardado es directo, sin diálogo.

El `toast` de éxito informa el alcance real usando el resultado nuevo, igual que hace
`_DisableAccountDialog` con `result.affectedAccountIds.length`:

```tsx
const result = await updateAccount(companyId, account.id, data);
toast.success(
  result.fixedAssetCascade.applied
    ? `Cuenta actualizada. La marca de Bien de Uso se aplicó a ${result.fixedAssetCascade.affectedAccountIds.length} cuenta(s) del rubro.`
    : 'Cuenta actualizada correctamente'
);
```

De paso, el `catch` de la línea 89 hoy traga el mensaje real del servidor
(`toast.error('Error al actualizar la cuenta')`). Se alinea con el del modal de alta
(`error instanceof Error ? error.message : ...`), porque si no, un error de cascada aparece
como un texto genérico.

#### 3.4.3 `_AccountsTable.tsx` — indicador en el árbol

Sin columna nueva (ya son siete y el árbol se indenta): un `Badge` junto al nombre, al lado del
`(sumatoria)` que ya está en la celda 2:

```tsx
<td>
  {account.name}
  {hasChildren && <span className="ml-2 text-xs text-muted-foreground">(sumatoria)</span>}
  {account.isFixedAsset && (
    <Badge variant="outline" className="ml-2" title="Bien de Uso">
      BU
    </Badge>
  )}
</td>
```

`title` en vez de `Tooltip` para no meter un provider en una tabla que ya renderiza cientos de
filas.

#### 3.4.4 Aviso en el formulario de carga

Componente cliente nuevo `src/modules/commercial/shared/components/_FixedAssetAttachmentNotice.tsx`
(fuera de `_PurchaseInvoiceForm.tsx`, que ya tiene 959 líneas — riesgo 8):

```tsx
'use client';

interface FixedAssetAttachmentNoticeProps {
  /** Ítems del selector, con la marca de su cuenta de egresos. */
  products: Array<{ id: string; defaultExpenseAccountIsFixedAsset: boolean | null }>;
  /** Marca de la cuenta de compras por defecto de la empresa. */
  defaultAccountIsFixedAsset: boolean;
  /** Ruta del array de líneas en el formulario. Por defecto `'lines'`. */
  name?: string;
}

export function _FixedAssetAttachmentNotice(
  props: FixedAssetAttachmentNoticeProps
): React.ReactElement | null;
```

Lee las líneas desde el contexto del formulario con `useWatch({ name })` —el mismo mecanismo de
`_LineCostCenterField` y de `_CostCenterAllocationField`, que ya viven en el `FormProvider` que
abre `<Form {...form}>`—, resuelve cada línea con `effectiveIsFixedAsset` + `findFixedAssetLines`
y devuelve `null` si no hay ninguna. No recibe el objeto `form`, así que no importa
`PurchaseInvoiceFormInput` y queda desacoplado del módulo de compras.

Cuando hay al menos una línea de Bien de Uso, renderiza un `Alert` ámbar con `Paperclip`,
con los mismos tokens (y variante dark) de los tres avisos que ya conviven en
`PurchaseInvoiceDetail.tsx:103-146`:

```tsx
<Alert className="border-amber-500/50 bg-amber-50 dark:bg-amber-950/20">
  <Paperclip className="h-4 w-4 text-amber-600" />
  <AlertDescription className="space-y-1 text-amber-800 dark:text-amber-200">
    <p>{FIXED_ASSET_ATTACHMENT_SUGGESTION}</p>
    <p className="text-xs opacity-90">{buildFixedAssetSuggestionMessage(fixedAssetLines)}</p>
  </AlertDescription>
</Alert>
```

**Texto exacto** (`FIXED_ASSET_ATTACHMENT_SUGGESTION`):

> Esta factura incluye bienes de uso. Sería ideal que cargues el escaneo o la imagen del
> comprobante: vas a poder adjuntarlo al guardar, desde el detalle de la factura.

Segunda línea, generada (ejemplo con dos líneas):

> Hay 2 líneas imputadas a cuentas de Bienes de Uso: «Rodado Ford Ranger», «Instalación de
> balanza».

Se monta **una sola vez** en `_PurchaseInvoiceForm.tsx`, entre la tarjeta de "Totales" y el
bloque de botones de acción, que es donde el usuario mira antes de guardar:

```tsx
<_FixedAssetAttachmentNotice
  products={products}
  defaultAccountIsFixedAsset={defaultAccountIsFixedAsset}
/>

{/* Botones de Acción */}
```

La prop nueva del formulario, al lado de la de TSK-583, que **no cambia de forma**:

```ts
interface PurchaseInvoiceFormProps {
  suppliers: SupplierSelectItem[];
  products: ProductSelectItem[];
  costCenters: CostCenterSelectItem[];
  /** Cuenta de compras por defecto de la empresa (TSK-583, revisión final). */
  defaultAccountType?: string | null;
  /** TSK-618: si esa misma cuenta está marcada como Bien de Uso. */
  defaultAccountIsFixedAsset?: boolean;
  mode?: 'create' | 'edit';
  invoiceId?: string;
  defaultValues?: Partial<PurchaseInvoiceFormInput>;
}
```

Los dos Server Components pasan las dos props desde la misma llamada:

```tsx
// CreatePurchaseInvoice.tsx (y EditPurchaseInvoice.tsx, idéntico)
const [suppliers, products, costCenters, defaultAccount] = await Promise.all([
  getSuppliersForSelect(),
  getProductsForSelect(),
  getCostCentersForSelect(),
  getPurchasesDefaultAccount(),
]);

<_PurchaseInvoiceForm
  suppliers={suppliers}
  products={products}
  costCenters={costCenters}
  defaultAccountType={defaultAccount.type}                     // ← igual que antes
  defaultAccountIsFixedAsset={defaultAccount.isFixedAsset}     // ← nuevo
/>
```

Ese `defaultAccountType={defaultAccount.type}` es el punto que protege a TSK-583: la prop sigue
llamándose igual y sigue siendo `string | null`, así que `_LineCostCenterField` no se toca.

#### 3.4.5 Aviso persistente en el detalle

En `PurchaseInvoiceDetail.tsx`, en el mismo bloque de los tres avisos de recepción (103-146),
después de ellos:

```tsx
{suggestAttachment && (
  <Alert className="border-amber-500/50 bg-amber-50 dark:bg-amber-950/20">
    <Paperclip className="h-4 w-4 text-amber-600" />
    <AlertDescription className="flex items-center justify-between">
      <span className="text-amber-800 dark:text-amber-200">
        {FIXED_ASSET_ATTACHMENT_PENDING}
      </span>
      <Button variant="outline" size="sm" asChild className="ml-4 shrink-0">
        <a href="#documento-adjunto">Adjuntar comprobante</a>
      </Button>
    </AlertDescription>
  </Alert>
)}
```

**Texto exacto** (`FIXED_ASSET_ATTACHMENT_PENDING`):

> Esta factura incluye bienes de uso y todavía no tiene el comprobante adjunto. Sería ideal que
> cargues el escaneo o la imagen de la factura: el contador la necesita para el anexo de bienes
> de uso y el cuadro de amortizaciones.

El ancla apunta a la tarjeta que ya existe (línea 456-465), que se envuelve para poder
apuntarle:

```tsx
<div id="documento-adjunto" className="scroll-mt-24">
  <_DocumentAttachment ... />
</div>
```

El aviso **desaparece solo**: `_DocumentAttachment` hace `router.refresh()` después de subir
(`_DocumentAttachment.tsx:75`), el Server Component se vuelve a renderizar con `documentUrl`
cargado y la condición deja de cumplirse. No hace falta estado en cliente.

### 3.5 Rutas y navegación

**No aplica.** El ticket no agrega ni modifica ninguna ruta: la marca se edita en
`/dashboard/company/accounting/accounts` (ABM que ya existe) y los dos avisos aparecen en
`/dashboard/commercial/purchases/new`, `/dashboard/commercial/purchases/[id]/edit` y
`/dashboard/commercial/purchases/[id]`, todas vigentes. El único "salto" nuevo es el ancla
interna `#documento-adjunto` dentro del detalle, que no cambia la URL de navegación.

Tampoco hay entrada nueva de sidebar ni módulo activable: la regla 13 del `CLAUDE.md` no aplica
(no hay módulo de primer nivel nuevo), y la regla 12 tampoco (la feature es universal, no se
registra en `INDUSTRY_FEATURES`).

### 3.6 APIs / Endpoints

**No aplica.** No se crea ninguna API Route bajo `src/app/api/`. Todo el trabajo de servidor se
hace con Server Actions que ya existen, listadas con su firma completa en 3.3:

| Action | Archivo | Cambio |
|---|---|---|
| `createAccount` | `accounting/features/accounts/actions.server.ts` | hereda el flag del padre |
| `updateAccount` | idem | cascada por cambio de valor; retorno enriquecido |
| `disableAccount` | idem | reusa `collectSubtreeIds`, sin cambio de comportamiento |
| `loadModelChartOfAccounts` | idem | siembra el rubro `1.2.2` |
| `exportAccountsToExcel` | `accounts/lib/import-export.server.ts` | columna "Bien de Uso" |
| `importAccountsFromExcel` | idem | lee el valor literal, sin cascada |
| `downloadAccountsTemplate` | idem (vía `excel-template.ts`) | columna e instrucción |
| `getProductsForSelect` | `purchases/.../invoices/list/actions.server.ts` | flag de la cuenta del ítem |
| `getPurchasesDefaultAccountType` → `getPurchasesDefaultAccount` | idem | devuelve `{ type, isFixedAsset }` |
| `getPurchaseInvoiceById` | idem | flag en `lines[].product` |

Todas conservan su `checkPermission` actual. La única action que cambia de nombre
(`getPurchasesDefaultAccountType`) tiene exactamente dos callers, ambos actualizados en el
mismo paso, tal como advierte 2.2.

### 3.7 Consideraciones técnicas

#### 3.7.1 Casos borde y qué hace el sistema en cada uno

| Caso | Comportamiento | Dónde queda escrito |
|---|---|---|
| **Línea sin ítem** | Cae en `purchasesAccountId`. `effectiveIsFixedAsset(undefined, defaultIsFixedAsset)` devuelve el flag de esa cuenta: si la empresa no la marcó (lo normal, es una cuenta de gasto), **no avisa** | Guía de usuario y `docs/modules/commercial.md` |
| **Ítem sin cuenta de egresos** | Idem: `defaultExpenseAccountIsFixedAsset` es `null` y cae en la cuenta por defecto. Es el mismo falso negativo que TSK-583 arregló con `effectiveAccountType`, y por eso el mapeo usa `?? null` y **no** `?? false` | Test de fase 2 + guía (con el puntero al `_ImputationModal` de la lista de ítems para completar cuentas en masa) |
| **Ítem con cuenta que no es BU** | `false` explícito: **no** cae en la cuenta por defecto y **no** avisa. Es la diferencia semántica entre `false` y `null` | Test de fase 2 |
| **Empresa sin contabilidad activa** | No hay plan de cuentas ni `AccountingSettings`: `getPurchasesDefaultAccount()` devuelve `{ type: null, isFixedAsset: false }` y ningún ítem tiene cuenta. El aviso nunca aparece, sin errores ni pantallas rotas | `docs/modules/commercial.md`, limitación (d) |
| **Facturas importadas de AFIP** | `afip-import.server.ts:299-412` crea líneas sin `productId`: caen en la cuenta por defecto y no avisan. **Fuera de alcance** por decisión 4 de 1.7 | `docs/modules/commercial.md`, limitación (a), y sección de límites del PDF de fase 9 |
| **Hija creada después de marcar el padre** | `createAccount` la crea marcada (herencia del padre), y el modal lo muestra antes de guardar para que se pueda destildar en el acto | Test de integración de fase 7 |
| **Cuenta movida a otro rubro** | Si el rubro nuevo tiene otro valor, la cuenta y su subárbol lo toman (`PARENT_CHANGED`). Si tiene el mismo valor, **no se reescribe nada**, para no borrar excepciones | `resolveFixedAssetCascade` + test |
| **Editar solo el nombre del rubro** | `input.isFixedAsset === account.isFixedAsset` → sin cascada. Las Amortizaciones Acumuladas destildadas a mano siguen destildadas | El test que 2.1 marca como imprescindible |
| **Empresa sin ninguna cuenta marcada** | Silencio total, sin error. Se mitiga con la siembra del plan modelo (empresas nuevas) y con el script de diagnóstico de fase 1 (empresas existentes) | Riesgo 2 del análisis |
| **Cuenta por defecto de compras marcada como BU** | Toda factura mostraría el aviso. Es una configuración del usuario, no un bug: el asiento efectivamente imputa ahí. Se menciona en la guía como algo a no hacer salvo que se quiera ese comportamiento | Guía de usuario |
| **Reimportar un Excel exportado antes de TSK-618** | La columna no existe: `isFixedAsset` queda en `null` en `AccountColumnIndexes` y las cuentas nuevas nacen en `false`. Las que ya existen se saltean (`skipped++`), así que **nunca se pierde una marca existente** | 3.7.3 |
| **NC y ND de compra** | Usan el mismo `_PurchaseInvoiceForm` y el mismo detalle, así que el aviso funciona igual, sin código extra (1.2.7) | Criterio de completitud de fase 5 |

#### 3.7.2 Permisos (regla 11)

- **Server Actions:** las cuatro de contabilidad conservan su `checkPermission('accounting.accounts', …)`
  de las líneas 62, 117, 190 y 498; las de comercial, su `checkPermission('commercial.purchases', 'view')`.
  Ninguna función nueva es una action: `collectSubtreeIds`, `resolveFixedAssetCascade`,
  `effectiveIsFixedAsset`, `findFixedAssetLines` y `buildFixedAssetSuggestionMessage` son puras
  y no tocan la base, así que no crean ningún camino que esquive la verificación.
- **Server Components:** `PurchaseInvoiceDetail` ya está envuelto en
  `<PermissionGuard module="commercial.purchases" action="view" redirect>`; `AccountsList`, en
  `accounting.accounts` / `view`.
- **Client Components:** el `Switch` del modal de edición se gatea con
  `usePermissions().hasPermission('accounting.accounts', 'update')`. En el modal de alta se
  muestra siempre: quien llegó ahí ya tiene `accounting.accounts` / `create`.
- **Fuera de alcance:** `document-attachment.server.ts` sigue sin `checkPermission` (riesgo 7
  del análisis). Como este ticket **no** amplía su superficie de uso —no se agrega dropzone al
  formulario, decisión 2 de 1.7— se deja como está y se documenta.

#### 3.7.3 Round-trip del Excel: por qué la resolución por encabezado

Es la única desviación técnica relevante respecto de la fase 4 tal como está escrita. El plan
propone leer la columna nueva por índice fijo (celda 7). El problema concreto:

- la **plantilla vacía** tiene 6 columnas y la 7 está libre;
- el **export** tiene 7 columnas, con `Estado` (`Activa`/`Inactiva`) en la 7;
- el **importador** lee las dos con el mismo código, buscando la hoja `'Plan de Cuentas'`.

Con índice fijo, cualquiera de las dos combinaciones rompe: si "Bien de Uso" es la 7, un export
viejo mete `Activa` en esa celda y `validateAccountRow` tira error en **todas** las filas del
archivo. La resolución por nombre de encabezado (`resolveAccountColumnIndexes`, 3.3 fase 4)
resuelve los tres formatos —plantilla nueva, export nuevo y export viejo— con una función pura
y testeable, y de paso deja de atar el importador al orden de las columnas.

#### 3.7.4 Rendimiento

- El `findMany` de todas las cuentas de la empresa (para el subárbol) se ejecuta **solo cuando
  hay cascada**. Una edición de nombre o descripción no lo dispara. Es un `select` de dos
  columnas sobre unos cientos de filas.
- La propagación es **un** `updateMany`, no N `update` en un `for`. `disableAccount` sí necesita
  el `for` porque cada cuenta se corta en un ejercicio distinto según su saldo; acá el valor es
  el mismo para todo el subárbol.
- `getProductsForSelect` y `getPurchaseInvoiceById` suman un booleano a un `select` de una
  relación que ya se estaba trayendo: no agregan ni un join.
- El aviso del formulario recalcula con `useWatch` sobre `lines`, igual que
  `_LineCostCenterField`. Sobre una factura de decenas de líneas el filtro es trivial; aun así
  se resuelve dentro de un `useMemo` con dependencia en `lines`, `products` y
  `defaultAccountIsFixedAsset`.

#### 3.7.5 Reglas del `CLAUDE.md` que aplican

| Regla | Cómo se cumple |
|---|---|
| 1 — moment.js | No hay fechas nuevas |
| 2 — Logger | `logger.info` en `createAccount` y `updateAccount` con `{ accountId, isFixedAsset, cascadeReason, affected }`; cero `console.*` |
| 3 — React Query | El flag viaja por props desde el Server Component: **ningún fetch en cliente** |
| 4 — Prefijo `_` | `_FixedAssetAttachmentNotice.tsx` |
| 5 — `AlertDialog` vs `Alert` | Los avisos son `Alert` (informativos). La confirmación de cascada es `AlertDialog`. Nunca `confirm()` |
| 6 — `app/` solo rutas | No se crea nada bajo `src/app/` |
| 9 — Decimal → Number | El flag es booleano; los `Number()` existentes de `costPrice`, `vatRate` y de las líneas del detalle quedan intactos |
| Checklist de commit | Ningún archivo nuevo pasa de 200 líneas: `fixed-asset.ts` ~70, `account-subtree.ts` ~70, `_FixedAssetAttachmentNotice.tsx` ~60. `_PurchaseInvoiceForm.tsx` solo suma una prop y un montaje |
| Tipos | Cero `:any`. `ProductSelectItem` y `PurchaseInvoiceDetail` se siguen infiriendo del retorno de sus actions; `CreateAccountInput` sale de `accountSchema` |

Única concesión de tipado: en `_FixedAssetAttachmentNotice`, `useWatch({ name })` desde el
contexto devuelve un valor sin tipar, y se acota con `as WatchedLine[]` sobre una interfaz local
mínima (`{ productId?: string; description?: string }`). Es un `as` a un tipo concreto, no un
`any`, y es el precio de que el componente viva en `commercial/shared/` sin importar
`PurchaseInvoiceFormInput` del feature de compras.

#### 3.7.6 Testing (Vitest, no Cypress)

En el repo **no existe `cypress/` ni ningún script `cy:*`** (verificado). Todo va a Vitest
(`npm run test` → `vitest run`, con `include: ['src/**/*.test.ts']` — nótese: `.ts`, no `.tsx`,
así que la lógica testeable no puede vivir dentro de un componente).

| Archivo | Tipo | Qué cubre |
|---|---|---|
| `src/modules/commercial/shared/fixed-asset.test.ts` | puro | los siete casos de la fase 2, incluida la diferencia `null` (cae en la cuenta por defecto) vs `false` (no cae) |
| `src/modules/accounting/shared/utils/account-subtree.test.ts` | puro | `collectSubtreeIds` sobre un árbol de tres niveles + las seis filas de la tabla de `resolveFixedAssetCascade` |
| `src/modules/accounting/features/accounts/data/model-chart-of-accounts.test.ts` | puro (existente) | el prefijo marca exactamente las 31 cuentas `1.2.2/*` y ninguna otra |
| `src/modules/accounting/features/accounts/fixed-asset-cascade.integration.test.ts` | integración | los cinco casos de la fase 7 contra la base real, con prefijo `TSK618-` y limpieza en `afterAll` |
| `.../invoices/list/fixed-asset-notice.integration.test.ts` | integración | `getProductsForSelect`, `getPurchaseInvoiceById` y —la garantía de la decisión 2 de 1.7— que crear **y confirmar** una factura con línea de BU y sin adjunto funcione sin error |

Los dos de integración aíslan **solo** la frontera, con los cuatro `vi.mock` de
`purchase-invoice-tributes.integration.test.ts` (`@/shared/lib/current-user`,
`@/shared/lib/company`, `@/shared/lib/permissions`, `next/cache`) y ejercitan el código real de
producción.

#### 3.7.7 Orden de implementación y trampas

Se respeta el orden de 2.2. Los tres puntos donde es fácil equivocarse:

1. **`npm run db:generate` después de la migración.** Sin eso, las fases 3 a 6 fallan con
   errores de tipo que parecen del código y son del cliente Prisma desactualizado.
2. **La condición de la cascada.** Implementarla como "propagar siempre que venga en el input"
   borra las excepciones destildadas a mano en el primer guardado del rubro, y el síntoma
   aparece recién en producción. Por eso la decisión vive en `resolveFixedAssetCascade`, una
   función pura con su propio test, y no inline en la action.
3. **El cambio de `getPurchasesDefaultAccountType` a `getPurchasesDefaultAccount`** toca tres
   archivos de TSK-583 en un solo paso. La verificación es que `_LineCostCenterField` siga
   recibiendo `defaultAccountType` con la forma `string | null`; si el campo de centro de costo
   desaparece de las líneas de gasto, es esto.

#### 3.7.8 Qué queda explícitamente fuera de alcance

Para que no se filtre (riesgo 9 del análisis): el reporte anual de altas de bienes de uso, el
anexo y el cuadro de amortizaciones, el botón "Adjuntar" en el listado de compras (opción 3 de
1.2.5), el dropzone en el formulario de carga (opción 2, descartada por la decisión 2 de 1.7),
las facturas de venta (decisión 5) y el aviso sobre comprobantes importados de AFIP
(decisión 4). El flag `isFixedAsset` deja la base puesta para todo eso, pero nada de eso se
implementa acá.

`isFixedAsset` **no reemplaza** a `AccountingSettings.fixedAssetAccountId`: esa sigue siendo la
cuenta de capitalización del asiento de alta de equipos
(`integrations/equipment/index.ts:217`) y no se toca.

## 4. Implementación

### Fase 1: Campo `isFixedAsset` en el modelo y migración
- **Estado:** Completada
- **Archivos modificados:**
  - `prisma/schema.prisma` - campo `isFixedAsset Boolean @default(false) @map("is_fixed_asset")` en `model Account`, ubicado inmediatamente después de `requiresAuxiliary` (junto a los otros dos flags de comportamiento contable), con el comentario de contexto que pide el diseño 3.2.1. Sin FK y sin índice.
  - `prisma/migrations/20260908133427_tsk_618_fixed_asset_account_flag/migration.sql` (nuevo) - migración aditiva, una sola sentencia: `ALTER TABLE "accounts" ADD COLUMN "is_fixed_asset" BOOLEAN NOT NULL DEFAULT false;`. Sin backfill.
  - `prisma/scripts/diagnose-fixed-asset-accounts.ts` (nuevo) - script de diagnóstico **sin escrituras**, con las firmas del diseño 3.3 (`CompanyFixedAssetDiagnosis`, `diagnoseFixedAssetAccounts()`, `main()`). Lista por empresa la cantidad de cuentas con `isFixedAsset = true` y, para las que tienen cero, el código y nombre de la cuenta de `AccountingSettings.fixedAssetAccountId` como pista. Encabezado con contexto e `import 'dotenv/config'`, siguiendo el bloque de diagnóstico de `backfill-internal-taxes.ts`.
  - `src/generated/prisma/**` - cliente regenerado (`npm run db:generate`), ya expone `isFixedAsset`.
- **Notas:**
  - El SQL generado por Prisma salió exactamente como lo preveía el diseño (una sola `ALTER TABLE`, sin FK ni índice), así que no hubo que editar la migración a mano.
  - El contenedor `contable-pms-db` estaba detenido; se lo levantó con `docker start contable-pms-db` (operación no destructiva) antes de correr la migración. `npx prisma migrate status` estaba limpio de entrada ("Database schema is up to date!", 28 migraciones) y la nueva se aplicó sin drift ni pérdida de datos.
  - Verificación del script: `npx tsx prisma/scripts/diagnose-fixed-asset-accounts.ts` imprime el informe correctamente. En la base local las dos empresas (`Empresa Demo S.A.` y `Empresa de Prueba 01 SA`) quedan con 0 cuentas marcadas y sin pista, porque tampoco tienen configurado `fixedAssetAccountId` — es exactamente el riesgo 2 del análisis, y confirma que el script lo detecta.
  - `tsconfig.json` incluye `**/*.ts`, así que el script nuevo entra en `npm run check-types` y compila sin errores.
  - **Sin desvíos respecto del diseño.** No se tocó nada de las fases 2 a 9.
  - Línea base de calidad (preexistente, no introducida por esta fase): `npm run check-types` reporta 227 errores y `npm run lint` 341 problemas (153 errores, 188 advertencias); ninguno corresponde a `prisma/`, al modelo `Account` ni a `isFixedAsset`. `npm run test` pasa en verde: 22 archivos, 239 tests.

### Fase 2: Lógica pura del criterio "esta línea es Bien de Uso"
- **Estado:** Completada
- **Archivos modificados:**
  - `src/modules/commercial/shared/fixed-asset.ts` (nuevo, 93 líneas) - módulo puro, sin Prisma ni nada de servidor, con las cinco exportaciones que pide el diseño 3.3: `effectiveIsFixedAsset(accountIsFixedAsset, defaultIsFixedAsset): boolean` (espejo exacto de `effectiveAccountType`, `cost-center.ts:37-42`), `interface FixedAssetLineCheck { description: string; isFixedAsset?: boolean | null }`, `findFixedAssetLines<T extends FixedAssetLineCheck>(lines: T[]): T[]`, `buildFixedAssetSuggestionMessage(lines: FixedAssetLineCheck[]): string` y las constantes `FIXED_ASSET_ATTACHMENT_SUGGESTION` / `FIXED_ASSET_ATTACHMENT_PENDING` con los textos exactos de 3.4.4 y 3.4.5.
  - `src/modules/commercial/shared/fixed-asset.test.ts` (nuevo, 20 tests en 5 `describe`) - Vitest sin base, mismo estilo que `cost-center.test.ts` y `perceptions.test.ts` (`describe`/`it` en español, comentarios de regresión sobre el porqué de cada caso).
- **Notas:**
  - **Tests escritos antes que la implementación**, como pedía la tarea. Cubren los siete casos de 2.1 más los tres casos borde de la tabla 3.7.1: cuenta del ítem marcada → dispara; cuenta del ítem sin marcar (`false`) → no dispara y **no** cae en la cuenta por defecto; ítem sin cuenta de egresos (`null`) y línea sin ítem (`undefined`) → caen en la cuenta por defecto y siguen su marca; empresa sin contabilidad activa → silencio total sin errores; varias líneas mezcladas → devuelve solo las de BU y conserva el orden; ninguna línea de BU → array vacío y mensaje `''`; singular con una línea y plural con dos o más; descripción vacía → `(sin descripción)`.
  - El test que protege el desvío ya decidido en el diseño es explícito: `distingue "el ítem no tiene cuenta" (null) de "tiene una que no es BU" (false)`. Es la garantía de que el mapeo de `getProductsForSelect` en la fase 5 tiene que ser `?? null` y **no** `?? false`; con `?? false` el fallback a la cuenta de compras por defecto nunca se aplicaría y volvería el falso negativo que TSK-583 arregló con `effectiveAccountType`.
  - `findFixedAssetLines` filtra con `line.isFixedAsset === true`, así que un `null`/`undefined` sin resolver nunca dispara el aviso por accidente: la resolución de tres estados es responsabilidad del llamador, vía `effectiveIsFixedAsset`. El genérico `<T extends FixedAssetLineCheck>` conserva los campos extra que agregue el formulario (probado con un `index`), igual que `findLinesMissingCostCenter`.
  - `buildFixedAssetSuggestionMessage` devuelve `''` con la lista vacía, para que el llamador no tenga que acordarse de chequear la longitud antes de renderizar.
  - **Sin desvíos respecto del diseño.** Se implementó solo lo de la fase 2: `collectSubtreeIds` y `resolveFixedAssetCascade` quedan para la fase 3, y no se tocó el ABM, ni el formulario de compras, ni el detalle, ni el importador de Excel, ni la semilla del plan modelo.
- **Verificación:**
  - `npm run test`: **`Test Files 23 passed (23)` / `Tests 259 passed (259)`**, sin regresiones (línea base de la fase 1: 22 archivos, 239 tests → +1 archivo, +20 tests).
  - `npm run check-types`: 227 errores, **exactamente la misma línea base preexistente de la fase 1**; ninguno menciona `fixed-asset`.
  - `npx eslint src/modules/commercial/shared/fixed-asset.ts src/modules/commercial/shared/fixed-asset.test.ts`: sin salida (limpio). Cero `:any`, cero `console.*`, los dos archivos por debajo de las 200 líneas del checklist.

### Fase 3: Marca en el ABM del plan de cuentas, con cascada al subárbol
- **Estado:** Completada
- **Archivos modificados:**
  - `src/modules/accounting/shared/utils/account-subtree.ts` (nuevo, 100 líneas) - los dos helpers **puros** del diseño 3.3, fuera de `utils/index.ts` para que el test no arrastre `next/cache`: `collectSubtreeIds(accounts, rootId)` (mismo algoritmo `childrenByParent` + pila que tenía `disableAccount` inline, raíz primero) y `resolveFixedAssetCascade({ current, input, parentChanged, newParentIsFixedAsset })`, que devuelve `FixedAssetCascade | null`.
  - `src/modules/accounting/shared/utils/account-subtree.test.ts` (nuevo, 16 tests) - Vitest sin base.
  - `src/modules/accounting/shared/types/index.ts` - `isFixedAsset: z.boolean().optional()` en `accountSchema` (con el comentario de por qué el `optional()` es la clave de la cascada) e `isFixedAsset: boolean` en `AccountWithChildren`.
  - `src/modules/accounting/features/accounts/actions.server.ts`:
    - `createAccount` lee el padre **dentro de la transacción** (`select: { isFixedAsset: true }`) y crea con `input.isFixedAsset ?? inheritedIsFixedAsset`; el `logger.info` suma `isFixedAsset`.
    - `updateAccount` cambia de firma a `Promise<UpdateAccountResult>` (`Account & { fixedAssetCascade: FixedAssetCascadeResult }`, retrocompatible por la intersección). Lee el padre nuevo solo si `parentChanged`, decide con `resolveFixedAssetCascade`, y **solo si hay cascada** dispara el `findMany` del plan para armar `descendantIds`. La propagación es un único `updateMany` dentro de la transacción que ya existía, con `companyId` en el `where`. El `logger.info` suma `cascadeReason` y `affected`.
    - `disableAccount` reemplaza su DFS inline por `collectSubtreeIds` (mismo orden, mismo contenido de `affectedAccountIds`: sin cambio de comportamiento observable).
    - `loadModelChartOfAccounts` agrega `isFixedAsset: isModelFixedAssetCode(account.code)` al `.map`.
  - `src/modules/accounting/features/accounts/data/model-fixed-assets.ts` (nuevo) - `MODEL_FIXED_ASSET_CODE_PREFIXES = ['1.2.2']` e `isModelFixedAssetCode(code)`. Archivo hermano del dataset porque `model-chart-of-accounts.ts` se regenera desde el .xls y dice "NO editar a mano".
  - `src/modules/accounting/features/accounts/data/model-chart-of-accounts.test.ts` - `describe` nuevo con 4 tests de la semilla.
  - `src/modules/accounting/features/accounts/components/_CreateAccountModal.tsx` - `Switch` "Bien de Uso" entre "Cuenta Padre" y "Descripción", más el `useEffect` que sincroniza el tilde con el rubro elegido (herencia visible, destildable en el acto). El estado `accounts` ahora incluye `isFixedAsset`.
  - `src/modules/accounting/features/accounts/components/_EditAccountModal.tsx` - `Switch` gateado con `usePermissions().hasPermission('accounting.accounts', 'update')`, `isFixedAsset` en `defaultValues`, `countDescendants`, `AlertDialog` de confirmación cuando el tilde cambió **y** la cuenta tiene descendientes (nunca `confirm()`), y `toast` que informa cuántas cuentas del rubro se reescribieron. De paso, el `catch` ahora propaga el mensaje real del servidor en vez del texto genérico.
  - `src/modules/accounting/features/accounts/components/_AccountsTable.tsx` - `Badge variant="outline"` con texto "BU" y `title="Bien de Uso"` junto al nombre, sin columna nueva.
- **Notas:**
  - **El punto crítico del ticket quedó donde manda el diseño:** en `resolveFixedAssetCascade`, pura y con test propio. Devuelve `null` (no propaga) cuando el flag no viene, cuando viene con el mismo valor que ya tenía la cuenta, cuando la cuenta pasó a ser raíz, y cuando cambió de padre pero el padre nuevo tiene el mismo valor. Propaga con `FLAG_CHANGED` cuando `input !== current` —que además gana si en el mismo guardado también cambió el padre— y con `PARENT_CHANGED` cuando el rubro nuevo trae otro valor.
  - Tests de la cascada (9 de los 16 del archivo nuevo, más 3 de un `describe` de escenario): tildar propaga; destildar propaga; guardar el mismo valor NO propaga; flag ausente NO propaga; cambio de padre con otro valor propaga; cambio de padre con el mismo valor NO propaga; quedarse sin padre NO propaga; flag + padre en el mismo guardado manda el flag. El `describe` final simula el plan de la clienta con la hija «amortizaciones» destildada a mano y verifica que **editar el nombre del rubro no la vuelve a marcar**, y que destildar/volver a tildar el rubro sí reescribe todo el subárbol (que es el comportamiento avisado por el `AlertDialog`).
  - `collectSubtreeIds` se probó sobre un árbol de tres niveles: raíz primero, no se lleva otras ramas, sobre una hoja devuelve solo la hoja, y devuelve la raíz aunque no esté en la lista (para no cambiarle el comportamiento a `disableAccount`).
  - Los 31 códigos `1.2.2/*` del dataset quedaron verificados por test, incluidas las Amortizaciones Acumuladas (`1.2.2/01/03`), con un caso extra que prueba que un hipotético `1.2.20/00/00` **no** entra por compartir prefijo textual.
  - Permisos: los `checkPermission` de `createAccount` (`create`) y `updateAccount` (`update`) siguen en la primera línea de cada action; los helpers nuevos son puros y no crean ningún camino que los esquive.
  - **Desvío menor respecto del diseño:** el `AlertDialog` de confirmación se monta **dentro** del `DialogContent` del modal de edición en vez de como hermano del `Dialog`. Radix lo portaliza igual y el `FocusScope` anida bien; hacerlo hermano obligaba a envolver todo el `return` en un fragmento y reindentar el archivo entero (ruido de diff sin ganancia). El texto y los botones son los del diseño 3.4.2. Segundo desvío, también menor: el `toast` de cascada solo se muestra si `affectedAccountIds.length > 0`, para no decir "se aplicó a 0 cuenta(s)" al tildar una cuenta hoja.
  - No se tocó nada de las fases 4 a 9: ni el Excel, ni `getProductsForSelect`, ni el formulario de compras, ni el detalle, ni la documentación.
- **Verificación:**
  - `npm run test`: **`Test Files 24 passed (24)` / `Tests 279 passed (279)`** (línea base de la fase 2: 23 archivos, 259 tests → +1 archivo, +20 tests: 16 de `account-subtree.test.ts` y 4 del `describe` nuevo de la semilla).
  - `npm run check-types`: **227 errores, exactamente la misma línea base preexistente** de las fases 1 y 2 (zod v4 / react-hook-form / tanstack-table). Ninguno menciona `account-subtree`, `model-fixed-assets`, `actions.server.ts` de cuentas ni los modales.
  - `npx eslint` sobre los nueve archivos tocados: **0 errores y 2 advertencias**, ambas preexistentes (`catch (error)` sin usar en el `loadAccounts` de cada modal). La línea base de esos dos archivos eran 3 advertencias: el `catch` del `handleSubmit` de edición ahora sí usa el error.

### Fase 4: Round-trip de la marca en el Excel del plan de cuentas
- **Estado:** Completada
- **Archivos modificados:**
  - `src/modules/accounting/features/accounts/lib/account-columns.ts` (nuevo, 243 líneas) - módulo **puro** con toda la lógica de columnas del Excel, tal como la especifica el diseño 3.3 (fase 4): las constantes `ACCOUNT_TEMPLATE_HEADERS` (7 encabezados) y `ACCOUNT_EXPORT_HEADERS` (8), la interfaz `AccountColumnIndexes`, `LEGACY_COLUMN_INDEXES`, `normalizeHeader`, `resolveAccountColumnIndexes(headerRow)`, `parseSiNoCell(raw)`, `readAccountRow(row, indexes)` y `validateAccountRow(row)`. Vive fuera de `import-export.server.ts` porque ese archivo es `'use server'` y **no puede exportar funciones sincrónicas**: sin este módulo, nada de esto sería testeable.
  - `src/modules/accounting/features/accounts/lib/account-columns.test.ts` (nuevo, 49 tests en 6 `describe`) - Vitest sin base, mismo estilo que `account-subtree.test.ts`.
  - `src/modules/accounting/features/accounts/lib/excel-template.ts` - los encabezados salen de `ACCOUNT_TEMPLATE_HEADERS` (ya no están escritos a mano), ancho 15 para la columna 7 en la hoja de datos y en la de ejemplo, séptima celda en cada fila de `exampleData`, tres filas nuevas de ejemplo (`1.2`, `1.2.2 BIENES DE USO` y `1.2.2.01 Rodados`, las dos últimas con `Sí`) para que el caso se vea, y sección **"6. Bien de Uso"** en la hoja de Instrucciones con los cuatro puntos del diseño (incluido "no se hereda de la cuenta padre").
  - `src/modules/accounting/features/accounts/lib/import-export.server.ts`:
    - **Exportación:** `isFixedAsset: true` en el `select`, encabezados desde `ACCOUNT_EXPORT_HEADERS`, octava celda con `'Sí'`/`'No'` y ancho 12. El `autoFilter` ya se calculaba con `headers.length`, así que se estiró solo.
    - **Importación:** `resolveAccountColumnIndexes(worksheet.getRow(1))` una vez antes del `eachRow`, y `readAccountRow(row, columns)` en lugar de las seis lecturas por índice fijo. `accountsToImport` gana `isFixedAsset: boolean` y el `tx.account.create` lo escribe.
    - `validateAccountRow` se movió al módulo puro (misma lógica más la validación nueva); el archivo la importa.
- **Notas:**
  - **El punto crítico de la fase era la asimetría, y se resolvió por nombre de encabezado.** La plantilla tenía 6 columnas y el export escribía 7, con `Activa`/`Inactiva` en la séptima (`import-export.server.ts:112`), pero el importador leía las dos con el mismo código y solo hasta la celda 6. Poner "Bien de Uso" en un índice fijo hacía que reimportar un archivo exportado **antes** de este ticket leyera `Activa` como valor de la marca y tirara `Valor inválido en "Bien de Uso"` en **todas** las filas del archivo. `resolveAccountColumnIndexes` mapea encabezado → índice sobre la fila 1, así que "Bien de Uso" puede quedar 7ª en la plantilla y 8ª en el export sin conflicto, y de paso el importador deja de estar atado al orden de las columnas.
  - `normalizeHeader` baja a minúsculas, saca acentos (NFD + rango de diacríticos) y **descarta el paréntesis final de aclaración**. Con eso, `'Descripción (Opcional)'` (plantilla) y `'Descripción'` (export) caen en el mismo `'descripcion'`, y `'Bien de Uso (Sí/No)'` coincide con `'Bien de Uso'` sin necesidad de dos alias por columna.
  - **Ausente ≠ falso mudo.** Si la fila 1 no trae los cuatro encabezados obligatorios (código, nombre, tipo, naturaleza) se cae a `LEGACY_COLUMN_INDEXES`, que es exactamente lo que hacía el importador antes del ticket. Y `isFixedAsset` **nunca** se adivina por posición: sin encabezado propio queda en `null`, la fila se lee sin `isFixedAssetRaw` y la cuenta nace en `false`. Un archivo viejo importa igual que siempre.
  - **La importación escribe el valor literal de la fila y no dispara la cascada de la fase 3**, con el comentario puesto en el `create` explicando por qué: el archivo es la fuente de verdad de esa corrida y heredar del padre pisaría las excepciones que el usuario escribió a mano (las Amortizaciones Acumuladas del riesgo 3).
  - Un valor no reconocido (`'quizás'`, `'Activa'`, `'2'`) es un **error de fila** con el mensaje del diseño, `Valor inválido en "Bien de Uso": use Sí o No`, y rompe solo esa fila. Vacío es `No`, no es error.
  - `_ImportExportButtons.tsx` **no necesitó cambios**: solo mueve buffers y muestra errores por fila; no sabe nada de columnas.
  - **Desvío respecto del plan (ya previsto por el diseño 3.7.3):** la lectura no es por "celda 7" sino por encabezado resuelto. **Desvío menor propio:** `validateAccountRow` y la función nueva `readAccountRow` se mudaron a `account-columns.ts`. El plan las dejaba en el archivo de actions, pero ahí serían intesteables (`'use server'` solo admite exports async) y la fase pedía tests de ida y vuelta. La lógica de validación preexistente no cambió.
  - No se tocó nada de las fases 5 a 9: ni `getProductsForSelect`, ni el formulario de compras, ni el detalle de la factura, ni la documentación.
- **Verificación:**
  - `npm run test`: **`Test Files 25 passed (25)` / `Tests 328 passed (328)`** (línea base de la fase 3: 24 archivos, 279 tests → +1 archivo, +49 tests). Los 279 previos siguen en verde.
  - Qué cubren los 49 tests: la plantilla vacía **real** (se genera con `generateAccountsTemplate()` y se relee del buffer) resuelve "Bien de Uso" en la 7; el export nuevo, en la 8 sin confundirse con "Estado"; **el export anterior a TSK-618 —el caso crítico— deja la marca en `null`, lee `Activa`/`Inactiva` como lo que son, valida las dos filas sin error y da `false`**; la plantilla vieja de 6 columnas cae en las posiciones históricas; columnas reordenadas se resuelven igual; "Código" no se confunde con "Código Padre"; una fila 1 con datos en vez de encabezados cae a legacy. `parseSiNoCell` se probó con 11 valores verdaderos, 12 falsos y 5 inválidos. `validateAccountRow`, con la columna ausente, con `Sí`/`No`/vacío, con basura y con los cuatro errores clásicos. Y cuatro tests de round-trip completo que leen todas las filas de una hoja armada con cada uno de los tres formatos.
  - `npm run check-types`: **227 errores, exactamente la misma línea base preexistente** de las fases 1 a 3. Ninguno menciona `account-columns`, `excel-template` ni `import-export.server`.
  - `npx eslint` sobre `accounts/lib/`: **1 error y 2 advertencias, las tres preexistentes** y verificadas contra la línea base con `git stash` (el `@ts-ignore` del `xlsx.load` y los dos imports de enums sin usar de `excel-template.ts`). Los dos archivos nuevos no aportan ninguna. Cero `:any`, cero `console.*`.

## 5. Verificación
_Pendiente - ejecutar `/verificar tsk-618-sugerencia-adjunto-bienes-de-uso`_
