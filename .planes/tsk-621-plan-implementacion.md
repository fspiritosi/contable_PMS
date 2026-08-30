# TSK-621 — Plan de implementación: actualización de listas de precios por índice

> **Para quien ejecute esto:** usar `superpowers:subagent-driven-development` (recomendado) o
> `superpowers:executing-plans` para implementar tarea por tarea. Los pasos usan checkbox
> (`- [ ]`) para seguimiento.

**Objetivo:** Que la empresa pueda cargar índices con un valor por mes (IPC agosto 4,2%) y
aplicar uno a una lista de precios completa, viendo antes qué precio queda cada ítem.

**Arquitectura:** El cálculo (aplicar porcentaje, redondear, recalcular el precio con IVA) es
una función pura testeable sin base de datos. Los índices son un catálogo de empresa más, con la
estructura de `discount-presets`. La aplicación es un server action transaccional que actualiza
todos los ítems de la lista y deja un registro en el historial.

**Stack:** Next.js 16 (App Router, Server Actions), Prisma 7 + PostgreSQL, React Hook Form + Zod,
shadcn/ui, Vitest.

**Spec:** `.planes/tsk-621-indices-de-precios.md`

## Restricciones globales

- **Sin `:any`.** Los tipos se infieren de Prisma o de Zod.
- **`logger`, nunca `console.*`** — `import { logger } from '@/shared/lib/logger'`.
- **Decimal de Prisma → `Number()`** antes de devolver a Client Components.
- **Client Components con prefijo `_`**; Server Components por defecto.
- **`checkPermission()`** al inicio de cada server action: `company.price-indexes` para el ABM
  de índices, `commercial.price-lists` con `update` para aplicar un índice a una lista.
- **Nada de `confirm()` / `alert()`** — `AlertDialog` de shadcn/ui.
- **Fechas con moment.js**, nunca date-fns.
- **Importes con `MoneyInput` al escribir y `formatCurrency` al mostrar** (TSK-580).
- **El porcentaje es `Decimal(6,3)` en base y `number` en TypeScript. Admite negativos.**
- **El precio nuevo se redondea a 2 decimales**, y `priceWithTax` se recalcula desde `price`
  con el IVA del ítem, nunca ajustando el índice por separado.
- Los textos visibles al usuario van en español, con tildes.

**Línea base al empezar:** `tsc --noEmit` 227 errores (preexistentes), 139 tests, build en verde.

---

### Tarea 1: Helper de cálculo

Toda la aritmética del ajuste, en funciones puras y sin base de datos. Es lo único con lógica
real y se puede testear entero antes de que exista el modelo.

**Archivos:**
- Crear: `src/modules/commercial/features/products/features/price-lists/shared/price-index-calc.ts`
- Crear: `src/modules/commercial/features/products/features/price-lists/shared/price-index-calc.test.ts`

**Interfaces:**
- Consume: nada.
- Produce:
  - `interface AdjustableItem { id: string; price: number; vatRate: number }`
  - `interface AdjustedItem { id: string; price: number; priceWithTax: number }`
  - `applyPercentage(value: number, percentage: number): number`
  - `adjustItem(item: AdjustableItem, percentage: number): AdjustedItem`
  - `adjustItems(items: AdjustableItem[], percentage: number): AdjustedItem[]`

- [ ] **Paso 1: Escribir los tests**

Crear `price-index-calc.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';

import { adjustItem, adjustItems, applyPercentage } from './price-index-calc';

describe('aplicar un porcentaje a un importe', () => {
  it('aumenta segun el indice', () => {
    expect(applyPercentage(120000, 4.2)).toBe(125040);
  });

  it('redondea a dos decimales', () => {
    // 99999 * 1.042 = 104198.958
    expect(applyPercentage(99999, 4.2)).toBe(104198.96);
  });

  it('un porcentaje negativo baja el precio', () => {
    expect(applyPercentage(1000, -10)).toBe(900);
  });

  it('un porcentaje en cero no cambia nada', () => {
    expect(applyPercentage(1234.56, 0)).toBe(1234.56);
  });

  it('redondea hacia arriba el caso que cae justo en la mitad', () => {
    // 100 * 1.005 = 100.5 -> el medio centavo sube
    expect(applyPercentage(100, 0.5)).toBe(100.5);
    // 1.005 redondeado a 2 decimales
    expect(applyPercentage(1, 0.5)).toBe(1.01);
  });
});

describe('ajuste de un item de la lista', () => {
  it('recalcula el precio con IVA desde el precio nuevo', () => {
    const resultado = adjustItem({ id: 'a', price: 1000, vatRate: 21 }, 10);

    expect(resultado).toEqual({ id: 'a', price: 1100, priceWithTax: 1331 });
  });

  it('el precio con IVA sale del precio ajustado, no de ajustar el precio con IVA', () => {
    // Si se ajustara priceWithTax por separado, 1210 * 1.1 = 1331 daria igual aca,
    // pero con decimales los dos caminos divergen por redondeo. Este es el caso:
    // price 33.33 -> 36.66 -> conIVA 44.36
    // (ajustar el conIVA original 40.33 * 1.1 daria 44.36 tambien, pero
    //  33.33*1.1=36.663 redondea a 36.66 y 36.66*1.21=44.3586 -> 44.36)
    const resultado = adjustItem({ id: 'b', price: 33.33, vatRate: 21 }, 10);

    expect(resultado.price).toBe(36.66);
    expect(resultado.priceWithTax).toBe(44.36);
  });

  it('un item sin IVA queda con el mismo precio en ambos campos', () => {
    const resultado = adjustItem({ id: 'c', price: 500, vatRate: 0 }, 20);

    expect(resultado).toEqual({ id: 'c', price: 600, priceWithTax: 600 });
  });
});

describe('ajuste de varios items', () => {
  it('ajusta cada item por separado y conserva el orden', () => {
    const items = [
      { id: 'a', price: 100, vatRate: 21 },
      { id: 'b', price: 200, vatRate: 10.5 },
    ];

    expect(adjustItems(items, 5)).toEqual([
      { id: 'a', price: 105, priceWithTax: 127.05 },
      { id: 'b', price: 210, priceWithTax: 232.05 },
    ]);
  });

  it('una lista vacia no rompe', () => {
    expect(adjustItems([], 5)).toEqual([]);
  });
});
```

- [ ] **Paso 2: Correr los tests y verificar que fallan**

Run: `npx vitest run src/modules/commercial/features/products/features/price-lists/shared/price-index-calc.test.ts`
Expected: FAIL — el módulo no existe.

- [ ] **Paso 3: Implementar**

Crear `price-index-calc.ts`:

```typescript
/**
 * Cálculo del ajuste de precios por índice (TSK-621).
 *
 * Funciones puras: no tocan base de datos ni dependen de Prisma, así que el
 * caso difícil —el redondeo— se puede testear entero sin levantar nada.
 */

/** Un ítem de lista de precios, visto desde el ajuste. */
export interface AdjustableItem {
  id: string;
  price: number;
  /** Alícuota de IVA del ítem, en porcentaje (21 = 21%). */
  vatRate: number;
}

/** El mismo ítem con los dos precios ya ajustados. */
export interface AdjustedItem {
  id: string;
  price: number;
  priceWithTax: number;
}

/** Redondeo a 2 decimales, evitando el arrastre binario de 0.1 + 0.2. */
function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * Aplica un porcentaje a un importe. Acepta negativos: un índice puede dar
 * baja, y bloquearlo sería inventar una restricción que la realidad no tiene.
 */
export function applyPercentage(value: number, percentage: number): number {
  return round2(value * (1 + percentage / 100));
}

/**
 * Ajusta un ítem. `priceWithTax` se recalcula **desde el precio ya ajustado**,
 * no aplicando el índice al precio con IVA anterior: por redondeo los dos
 * caminos divergen y los campos quedan desincronizados.
 */
export function adjustItem(item: AdjustableItem, percentage: number): AdjustedItem {
  const price = applyPercentage(item.price, percentage);

  return {
    id: item.id,
    price,
    priceWithTax: round2(price * (1 + item.vatRate / 100)),
  };
}

/** Ajusta todos los ítems de una lista, conservando el orden. */
export function adjustItems(items: AdjustableItem[], percentage: number): AdjustedItem[] {
  return items.map((item) => adjustItem(item, percentage));
}
```

- [ ] **Paso 4: Correr los tests y verificar que pasan**

Run: `npx vitest run src/modules/commercial/features/products/features/price-lists/shared/price-index-calc.test.ts`
Expected: PASS, los 10.

- [ ] **Paso 5: Commit**

```bash
git add src/modules/commercial/features/products/features/price-lists/shared/
git commit -m "feat(price-lists): helper de calculo del ajuste por indice (TSK-621)"
```

---

### Tarea 2: Modelo de datos y migración

**Archivos:**
- Modificar: `prisma/schema.prisma`
- Crear: `prisma/migrations/<timestamp>_price_indexes/migration.sql`

**Interfaces:**
- Consume: nada.
- Produce: modelos `PriceIndex`, `PriceIndexValue`, `PriceListAdjustment`.

- [ ] **Paso 1: Agregar los modelos al schema**

```prisma
model PriceIndex {
  id          String  @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  companyId   String  @map("company_id") @db.Uuid
  name        String
  description String?
  isActive    Boolean @default(true) @map("is_active")

  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  company     Company               @relation(fields: [companyId], references: [id], onDelete: Cascade)
  values      PriceIndexValue[]
  adjustments PriceListAdjustment[]

  @@unique([companyId, name])
  @@map("price_indexes")
}

model PriceIndexValue {
  id      String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  indexId String   @map("index_id") @db.Uuid
  /// Primer día del mes al que corresponde el valor.
  period  DateTime @map("period") @db.Date
  /// Porcentaje del período. Admite negativos: un índice puede dar baja.
  percentage Decimal @db.Decimal(6, 3)

  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  index       PriceIndex            @relation(fields: [indexId], references: [id], onDelete: Cascade)
  adjustments PriceListAdjustment[]

  @@unique([indexId, period])
  @@index([indexId])
  @@map("price_index_values")
}

model PriceListAdjustment {
  id           String @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  priceListId  String @map("price_list_id") @db.Uuid
  indexId      String @map("index_id") @db.Uuid
  indexValueId String @map("index_value_id") @db.Uuid
  /// El porcentaje realmente aplicado. Redundante a proposito: si despues se
  /// corrige el valor del indice, el historial tiene que seguir diciendo que
  /// se aplico ese dia.
  percentage    Decimal @db.Decimal(6, 3)
  itemsAffected Int     @map("items_affected")

  appliedAt DateTime @default(now()) @map("applied_at")
  appliedBy String?  @map("applied_by")

  priceList  PriceList       @relation(fields: [priceListId], references: [id], onDelete: Cascade)
  index      PriceIndex      @relation(fields: [indexId], references: [id])
  indexValue PriceIndexValue @relation(fields: [indexValueId], references: [id])

  @@index([priceListId])
  @@map("price_list_adjustments")
}
```

Agregar además las relaciones inversas: en `Company`, `priceIndexes PriceIndex[]`; en
`PriceList`, `adjustments PriceListAdjustment[]`.

- [ ] **Paso 2: Crear y aplicar la migración**

```bash
npx prisma migrate dev --name price_indexes
npx prisma generate
```

- [ ] **Paso 3: Verificar contra la base**

```bash
docker exec contable-pms-db psql -U postgres -d contable_pms -c "\d price_index_values"
docker exec contable-pms-db psql -U postgres -d contable_pms -c "\d price_list_adjustments"
```

Expected: `price_index_values` con `period` de tipo `date`, `percentage numeric(6,3)` y el
unique `(index_id, period)`; `price_list_adjustments` con sus tres FK.

- [ ] **Paso 4: Verificar tipos**

Run: `npx tsc --noEmit 2>&1 | grep -c "error TS"`
Expected: 227, igual que la línea base. Esta tarea solo agrega modelos, no rompe nada existente.

- [ ] **Paso 5: Commit**

```bash
git add prisma/
git commit -m "feat(db): modelos de indices de precios y su historial (TSK-621)"
```

---

### Tarea 3: Permiso y catálogo de índices

**Archivos:**
- Modificar: `src/shared/lib/permissions/constants.ts`
- Modificar: `src/shared/components/layout/_AppSidebar.tsx:465` (junto a `discount-presets`)
- Crear: `src/modules/company/features/price-indexes/list/actions.server.ts`
- Crear: `src/modules/company/features/price-indexes/list/PriceIndexesList.tsx`
- Crear: `src/modules/company/features/price-indexes/list/columns.tsx`
- Crear: `src/modules/company/features/price-indexes/list/components/_PriceIndexesDataTable.tsx`
- Crear: `src/modules/company/features/price-indexes/list/components/_PriceIndexFormModal.tsx`
- Crear: `src/modules/company/features/price-indexes/list/index.ts`, `.../price-indexes/index.ts`
- Crear: `src/app/(core)/dashboard/company/price-indexes/page.tsx`

**Interfaces:**
- Consume: los modelos de la Tarea 2.
- Produce:
  - `getPriceIndexesPaginated(searchParams: DataTableSearchParams)`
  - `createPriceIndex(input: PriceIndexInput)`, `updatePriceIndex(id, input)`, `deletePriceIndex(id)`
  - `type PriceIndexInput = { name: string; description?: string; isActive?: boolean }`

- [ ] **Paso 1: Copiar el patrón de discount-presets**

```bash
ls src/modules/company/features/discount-presets/list/
cat src/modules/company/features/discount-presets/list/actions.server.ts
cat src/modules/company/features/discount-presets/list/components/_DiscountPresetFormModal.tsx
```

Ese catálogo es el molde: mismo esqueleto de actions (paginación server-side con
`DataTableSearchParams`, `checkPermission`, `getActiveCompanyId`, `revalidatePath`), mismo
listado y mismo modal de alta. Seguilo, no inventes una estructura nueva.

- [ ] **Paso 2: Registrar el permiso**

En `src/shared/lib/permissions/constants.ts`, junto a las entradas de `company.discount-presets`
(líneas ~79, ~175 y ~279): agregar `'company.price-indexes'` al mapa de módulos, con la etiqueta
**"Índices de Precios"**, y sumarlo al grupo de configuración de empresa donde está
`company.discount-presets`.

- [ ] **Paso 3: Agregar la entrada al sidebar**

En `_AppSidebar.tsx`, junto al bloque de `discount-presets` (línea ~465):

```typescript
{
  title: 'Índices de Precios',
  href: '/dashboard/company/price-indexes',
  module: 'company.price-indexes',
},
```

- [ ] **Paso 4: Implementar el catálogo**

Schema Zod del índice:

```typescript
const priceIndexSchema = z.object({
  name: z.string().min(2, 'El nombre debe tener al menos 2 caracteres'),
  description: z.string().optional(),
  isActive: z.boolean().optional(),
});
```

El listado muestra nombre, descripción, si está activo, y **cuántos valores cargados tiene**
(`_count.values`), que es el dato que dice si el índice sirve para algo. Cada fila enlaza al
detalle (Tarea 4).

- [ ] **Paso 5: Verificar en el navegador**

```bash
npm run dev
```

Ir a `/dashboard/company/price-indexes`, crear el índice "IPC", verificar que aparece en el
listado y que la entrada figura en el menú.

```bash
docker exec contable-pms-db psql -U postgres -d contable_pms -c "SELECT name, is_active FROM price_indexes;"
```

Si no podés levantar el navegador, decilo en el reporte en vez de afirmar que lo probaste.

- [ ] **Paso 6: Commit**

```bash
git add src/modules/company/features/price-indexes src/app src/shared
git commit -m "feat(company): catalogo de indices de precios (TSK-621)"
```

---

### Tarea 4: Valores por período del índice

**Archivos:**
- Crear: `src/shared/utils/period.ts` y `src/shared/utils/period.test.ts`
- Crear: `src/modules/company/features/price-indexes/detail/PriceIndexDetail.tsx`
- Crear: `src/modules/company/features/price-indexes/detail/actions.server.ts`
- Crear: `src/modules/company/features/price-indexes/detail/components/_PriceIndexValuesTable.tsx`
- Crear: `src/modules/company/features/price-indexes/detail/components/_PriceIndexValueFormModal.tsx`
- Crear: `src/modules/company/features/price-indexes/detail/index.ts`
- Crear: `src/app/(core)/dashboard/company/price-indexes/[id]/page.tsx`

**Interfaces:**
- Consume: modelos de la Tarea 2, patrón de la Tarea 3.
- Produce:
  - `toPeriodStart(date: Date): Date` en `src/shared/utils/period.ts` — compartida porque la
    usan los dos módulos.
  - `getPriceIndexWithValues(indexId: string)` — devuelve el índice y sus valores ordenados por
    período descendente, con `percentage` convertido con `Number()`.
  - `createPriceIndexValue(indexId: string, input: { period: Date; percentage: number })`
  - `updatePriceIndexValue(valueId: string, input: { percentage: number })`
  - `deletePriceIndexValue(valueId: string)`

- [ ] **Paso 1: Escribir el test del normalizador de período**

El período se guarda como el **día 1 del mes**. El formulario da un mes y un año; hay que
normalizarlos siempre igual o el unique `(indexId, period)` no sirve de nada.

**Ojo con dónde vive esta función.** La usa el módulo `company` (al guardar el valor) y no puede
importarse desde `commercial`: en este proyecto **un módulo nunca importa de otro**, lo
compartido va en `shared/`. Por eso va en `src/shared/utils/period.ts`, no junto al resto del
cálculo.

Crear `src/shared/utils/period.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';

import { toPeriodStart } from './period';

describe('normalizacion del periodo', () => {
  it('lleva cualquier fecha del mes al dia 1', () => {
    expect(toPeriodStart(new Date('2026-08-17T15:30:00Z'))).toEqual(new Date('2026-08-01T00:00:00Z'));
  });

  it('una fecha que ya es dia 1 no cambia', () => {
    expect(toPeriodStart(new Date('2026-08-01T00:00:00Z'))).toEqual(new Date('2026-08-01T00:00:00Z'));
  });

  it('el ultimo dia del mes queda en el mismo mes', () => {
    expect(toPeriodStart(new Date('2026-01-31T23:59:59Z'))).toEqual(new Date('2026-01-01T00:00:00Z'));
  });
});
```

- [ ] **Paso 2: Correr y ver que falla**

Run: `npx vitest run src/shared/utils/period.test.ts`
Expected: FAIL — el módulo no existe.

- [ ] **Paso 3: Implementar el normalizador**

Crear `src/shared/utils/period.ts`:

```typescript
/**
 * Lleva una fecha al primer día de su mes, en UTC.
 *
 * El período de un índice es un mes, no un día. Guardarlo siempre como el día 1
 * es lo que hace que el unique `(indexId, period)` impida cargar dos veces el
 * mismo mes.
 */
export function toPeriodStart(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}
```

- [ ] **Paso 4: Correr y ver que pasa**

Run: `npx vitest run src/shared/utils/period.test.ts`
Expected: PASS, los 3.

- [ ] **Paso 5: Implementar la pantalla de detalle**

La pantalla muestra el nombre del índice y su tabla de valores, ordenados del más reciente al
más viejo, con el período formateado con moment (`moment(period).format('MM/YYYY')`). El alta
es un modal con dos campos: período (mes y año) y porcentaje.

El porcentaje usa `MoneyInput`? **No**: es un porcentaje, no un importe. Usá un `Input` numérico
con `step="0.001"`, coherente con `Decimal(6,3)`.

Al guardar, el período se normaliza con `toPeriodStart`. Si ya existe un valor para ese índice y
período, el unique de la base lo rechaza: capturá el error de Prisma `P2002` y mostrá
**"Ya hay un valor cargado para ese período"** en vez del error crudo.

- [ ] **Paso 6: Verificar contra la base**

Cargar IPC con dos períodos (2026-07 4,1% y 2026-08 4,2%) y verificar:

```bash
docker exec contable-pms-db psql -U postgres -d contable_pms -c \
  "SELECT i.name, v.period, v.percentage FROM price_index_values v JOIN price_indexes i ON i.id = v.index_id ORDER BY v.period;"
```

Expected: los dos períodos con día 1 (`2026-07-01`, `2026-08-01`). Intentar cargar 2026-08 de
nuevo debe mostrar el mensaje, no romper.

- [ ] **Paso 7: Commit**

```bash
git add src/modules/company/features/price-indexes src/app src/shared/utils
git commit -m "feat(company): valores por periodo de los indices de precios (TSK-621)"
```

---

### Tarea 5: Vista previa y aplicación del índice

El corazón de la feature: el server action que calcula qué precio quedaría cada ítem y el que
aplica el cambio.

**Archivos:**
- Crear: `src/modules/commercial/features/products/features/price-lists/detail/apply-index.server.ts`
- Modificar: `src/modules/commercial/features/products/features/price-lists/shared/price-index-calc.test.ts`

**Interfaces:**
- Consume: `adjustItems`, `AdjustableItem` (Tarea 1); modelos (Tarea 2).
- Produce:
  - `getApplicablePriceIndexes()` — índices activos de la empresa **que tengan al menos un
    valor cargado**, con sus valores ordenados por período descendente.
  - `previewPriceIndexApplication(priceListId: string, indexValueId: string)` — devuelve
    `{ percentage, previousApplication, items: Array<{ id, productName, currentPrice, newPrice }> }`
  - `applyPriceIndexToList(priceListId: string, indexValueId: string)` — aplica y registra.

- [ ] **Paso 1: Escribir el test de la detección de doble aplicación**

Es la regla que protege de subir los precios dos veces. Va como función pura para poder
testearla sin base:

Agregar a `price-index-calc.test.ts`:

```typescript
import { findPreviousApplication } from './price-index-calc';

const APLICACIONES = [
  { indexId: 'ipc', indexValueId: 'v-2026-07', appliedAt: new Date('2026-08-02'), appliedBy: 'Ana' },
  { indexId: 'ipc', indexValueId: 'v-2026-08', appliedAt: new Date('2026-09-12'), appliedBy: 'Fabricio' },
];

describe('deteccion de doble aplicacion', () => {
  it('encuentra la aplicacion previa del mismo valor de indice', () => {
    const previa = findPreviousApplication(APLICACIONES, 'v-2026-08');

    expect(previa?.appliedBy).toBe('Fabricio');
  });

  it('no marca nada si ese periodo nunca se aplico', () => {
    expect(findPreviousApplication(APLICACIONES, 'v-2026-09')).toBeNull();
  });

  it('sin aplicaciones previas devuelve null', () => {
    expect(findPreviousApplication([], 'v-2026-08')).toBeNull();
  });

  it('con dos aplicaciones del mismo valor devuelve la mas reciente', () => {
    const repetidas = [
      ...APLICACIONES,
      { indexId: 'ipc', indexValueId: 'v-2026-08', appliedAt: new Date('2026-09-20'), appliedBy: 'Ana' },
    ];

    expect(findPreviousApplication(repetidas, 'v-2026-08')?.appliedBy).toBe('Ana');
  });
});
```

- [ ] **Paso 2: Correr y ver que falla**

Run: `npx vitest run src/modules/commercial/features/products/features/price-lists/shared/price-index-calc.test.ts`
Expected: FAIL — no se exporta `findPreviousApplication`.

- [ ] **Paso 3: Implementar**

En `price-index-calc.ts`:

```typescript
/** Una aplicación ya registrada, vista desde la detección de repetidos. */
export interface PreviousApplication {
  indexId: string;
  indexValueId: string;
  appliedAt: Date;
  appliedBy: string | null;
}

/**
 * La aplicación más reciente del mismo valor de índice sobre esta lista, si la
 * hay. Sirve para avisar antes de repetir: aplicar dos veces un 4,2% sube 8,6%.
 */
export function findPreviousApplication<T extends PreviousApplication>(
  applications: T[],
  indexValueId: string
): T | null {
  const matches = applications.filter((a) => a.indexValueId === indexValueId);
  if (matches.length === 0) return null;

  return matches.reduce((latest, a) => (a.appliedAt > latest.appliedAt ? a : latest));
}
```

- [ ] **Paso 4: Correr y ver que pasa**

Run: `npx vitest run src/modules/commercial/features/products/features/price-lists/shared/price-index-calc.test.ts`
Expected: PASS, los 14 de price-index-calc.

- [ ] **Paso 5: Implementar los server actions**

Crear `apply-index.server.ts` con `'use server'`. Los tres actions arrancan con
`await checkPermission('commercial.price-lists', 'update', { redirect: true })` salvo
`getApplicablePriceIndexes`, que usa `'view'`.

`previewPriceIndexApplication`: trae los ítems de la lista con `product.vatRate` y
`product.name`, los pasa por `adjustItems`, y devuelve la comparación. Convierte **todos** los
Decimal con `Number()`. Devuelve también `previousApplication` usando `findPreviousApplication`
sobre el historial de esa lista.

`applyPriceIndexToList`: dentro de `prisma.$transaction`, actualiza cada `PriceListItem` con su
precio nuevo y crea el `PriceListAdjustment` con el `percentage` del valor del índice y
`itemsAffected`. Si la lista no tiene ítems, lanza **"La lista no tiene ítems para actualizar"**.
Si el valor del índice no existe o es de otra empresa, lanza error.

Al terminar, `revalidatePath` de la ruta de la lista.

- [ ] **Paso 6: Verificar contra la base con un script de Prisma**

Crear una lista con 2 ítems de precios conocidos, aplicar un índice del 10% y verificar:

```bash
docker exec contable-pms-db psql -U postgres -d contable_pms -c \
  "SELECT p.name, i.price, i.price_with_tax FROM price_list_items i JOIN products p ON p.id = i.product_id ORDER BY p.name;"
docker exec contable-pms-db psql -U postgres -d contable_pms -c \
  "SELECT percentage, items_affected, applied_at FROM price_list_adjustments ORDER BY applied_at DESC LIMIT 1;"
```

Expected: los precios subieron 10%, `priceWithTax` coherente con el IVA de cada ítem, y una fila
de historial con `items_affected = 2`. Limpiá los datos de prueba al terminar.

- [ ] **Paso 7: Commit**

```bash
git add src/modules/commercial/features/products/features/price-lists
git commit -m "feat(price-lists): vista previa y aplicacion de un indice (TSK-621)"
```

---

### Tarea 6: Diálogo de aplicación

**Archivos:**
- Crear: `src/modules/commercial/features/products/features/price-lists/detail/components/_ApplyPriceIndexDialog.tsx`
- Modificar: `src/modules/commercial/features/products/features/price-lists/detail/PriceListDetail.tsx`

**Interfaces:**
- Consume: `getApplicablePriceIndexes`, `previewPriceIndexApplication`, `applyPriceIndexToList`
  (Tarea 5); `formatCurrency` de `@/shared/utils/formatters`.
- Produce: el componente `_ApplyPriceIndexDialog` con props
  `{ priceListId: string; itemCount: number }`.

- [ ] **Paso 1: Implementar el diálogo**

Client Component. Al abrir, carga los índices aplicables con React Query (**nunca**
`useEffect` + `useState` para fetch: regla del proyecto). Dos selects encadenados —índice y
período— y, al elegir período, pide la vista previa.

La tabla de vista previa muestra ítem, precio actual y precio nuevo, los dos con
`formatCurrency`. Arriba, si `previousApplication` no es null, un aviso:

```
⚠ Esta lista ya recibió {índice} {período} el {fecha}, aplicado por {usuario}.
```

El botón de confirmar dice **"Aplicar a los N ítems"** y queda deshabilitado hasta que haya una
vista previa cargada. Al aplicar, `toast.success` con la cantidad de ítems actualizados y cierre
del diálogo.

Si no hay ningún índice con valores cargados, el diálogo lo dice y ofrece el enlace a
`/dashboard/company/price-indexes` en vez de mostrar selects vacíos.

- [ ] **Paso 2: Agregar el botón a la pantalla de la lista**

En `PriceListDetail.tsx`, junto al botón que ya existe en la cabecera (línea ~41), agregar
**"Actualizar por índice"**, envuelto en `PermissionGuard` con
`module="commercial.price-lists" action="update"`. No se muestra si la lista no tiene ítems.

- [ ] **Paso 3: Verificar el flujo completo en el navegador**

```bash
npm run dev
```

Abrir una lista con ítems, "Actualizar por índice", elegir IPC 2026-08, comprobar que la vista
previa muestra los precios nuevos, aplicar, y verificar que la tabla de la lista quedó
actualizada. Volver a abrir el diálogo con el mismo período: tiene que aparecer el aviso.

Si no podés usar el navegador, decilo explícitamente en el reporte.

- [ ] **Paso 4: Verificar tipos y lint**

Run: `npx tsc --noEmit 2>&1 | grep -c "error TS"` y `npx eslint <archivos tocados>`
Expected: 227 y sin hallazgos nuevos.

- [ ] **Paso 5: Commit**

```bash
git add src/modules/commercial/features/products/features/price-lists
git commit -m "feat(price-lists): dialogo para actualizar precios por indice (TSK-621)"
```

---

### Tarea 7: Historial en la lista de precios

**Archivos:**
- Crear: `src/modules/commercial/features/products/features/price-lists/detail/components/_PriceListAdjustmentsHistory.tsx`
- Modificar: `src/modules/commercial/features/products/features/price-lists/detail/PriceListDetail.tsx`
- Modificar: `src/modules/commercial/features/products/features/price-lists/detail/apply-index.server.ts`

**Interfaces:**
- Consume: modelos (Tarea 2).
- Produce: `getPriceListAdjustments(priceListId: string)` — historial ordenado por
  `appliedAt` descendente, con el nombre del índice y el período, y `percentage` convertido con
  `Number()`.

- [ ] **Paso 1: Implementar la consulta**

En `apply-index.server.ts`, con `checkPermission('commercial.price-lists', 'view')`.

- [ ] **Paso 2: Implementar la sección**

Una `Card` debajo de la tabla de ítems, con una fila por aplicación: índice, período
(`moment(period).format('MM/YYYY')`), porcentaje, fecha (`DD/MM/YYYY HH:mm`), usuario y cantidad
de ítems. Si no hay ninguna, un texto: **"Todavía no se aplicó ningún índice a esta lista."**

- [ ] **Paso 3: Verificar**

Después de aplicar un índice, la sección tiene que mostrar esa aplicación con los datos
correctos.

- [ ] **Paso 4: Commit**

```bash
git add src/modules/commercial/features/products/features/price-lists
git commit -m "feat(price-lists): historial de actualizaciones por indice (TSK-621)"
```

---

### Tarea 8: Tests de integración

**Archivos:**
- Crear: `src/modules/commercial/features/products/features/price-lists/detail/apply-index.integration.test.ts`

**Interfaces:**
- Consume: todo lo anterior.
- Produce: nada.

- [ ] **Paso 1: Mirar el test de integración que ya existe**

```bash
cat src/modules/accounting/features/integrations/commercial/cost-center.integration.test.ts
```

Ese archivo es el molde: `describe.skipIf` cuando la base no está disponible, datos con prefijo
propio, y limpieza completa en `afterAll`. Seguilo.

- [ ] **Paso 2: Escribir los tests**

Prefijo de datos: `TSK621-TEST-`. Cuatro casos:

1. **Aplicación completa** — lista con 3 ítems, índice del 10%: los tres quedan con el precio
   aumentado y `priceWithTax` recalculado con el IVA de cada uno.
2. **Historial** — después de aplicar, hay una fila de `price_list_adjustments` con el
   porcentaje aplicado y `items_affected = 3`.
3. **Atomicidad** — si la actualización falla a mitad de camino, ningún ítem queda modificado.
   Forzalo con un valor de índice inexistente y comprobá que los precios siguen intactos.
4. **Doble aplicación** — aplicar dos veces el mismo valor deja **dos** filas en el historial, y
   la consulta de aplicación previa encuentra la más reciente.

- [ ] **Paso 3: Correr**

Run: `npx vitest run src/modules/commercial/features/products/features/price-lists/detail/apply-index.integration.test.ts`
Expected: PASS los 4.

- [ ] **Paso 4: Verificar que la base quedó limpia y que el skip funciona**

```bash
npm test
docker exec contable-pms-db psql -U postgres -d contable_pms -c \
  "SELECT count(*) FROM price_indexes WHERE name LIKE 'TSK621-TEST-%';"
```

Expected: la suite en verde y el conteo en 0. Probá además parar el contenedor y correr `npm
test`: el archivo tiene que saltearse, no fallar.

- [ ] **Paso 5: Commit**

```bash
git add src/modules/commercial/features/products/features/price-lists
git commit -m "test(price-lists): integracion de la aplicacion de indices (TSK-621)"
```

---

### Tarea 9: Documentación

**Archivos:**
- Modificar: la guía correspondiente en `src/modules/help/features/guide/components/`
- Modificar: `docs/architecture/data-model.md`
- Crear: `scripts/guia-presentacion/tsk-621.html`
- Crear: `docs/presentaciones/TSK-621-indices-de-precios.pdf`

- [ ] **Paso 1: Guía de usuario in-app**

En la guía comercial: qué es un índice, cómo se carga el valor del mes, y cómo se aplica a una
lista. Aclarar que **no hay marcha atrás** y que por eso está la vista previa.

- [ ] **Paso 2: Documentación técnica**

En `docs/architecture/data-model.md`: los tres modelos nuevos y el criterio de cálculo
(`priceWithTax` se recalcula desde `price`, redondeo a 2 decimales).

- [ ] **Paso 3: Guía de presentación en PDF**

Con capturas reales, siguiendo la estructura del spec (sección 9 del spec del TSK-583): qué
pedía, qué cambió, cómo se usa con un ejemplo concreto, qué hay que configurar, y qué no
cambió. **Incluir el aviso de que no hay deshacer, con el motivo.**

```bash
node scripts/guia-presentacion/generar-pdf.mjs \
  scripts/guia-presentacion/tsk-621.html \
  docs/presentaciones/TSK-621-indices-de-precios.pdf
```

- [ ] **Paso 4: Commit**

```bash
git add src/modules/help docs scripts/guia-presentacion
git commit -m "docs: guia de usuario y de presentacion de los indices de precios (TSK-621)"
```

---

## Cierre

- [ ] `npm test` en verde; anotar el total.
- [ ] `npx tsc --noEmit` sin errores nuevos respecto de 227.
- [ ] `npm run lint` sin hallazgos nuevos.
- [ ] `npm run build` con exit 0.
- [ ] Actualizar el ticket 621 en cc-tickets con análisis y resumen, mencionando la **migración
      de base de datos** que hay que aplicar en el deploy.
- [ ] Adjuntar el PDF de la guía de presentación.
