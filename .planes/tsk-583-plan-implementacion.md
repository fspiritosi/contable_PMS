# TSK-583 — Plan de implementación: centros de costo obligatorios y reparto múltiple

> **Para quien ejecute esto:** usar `superpowers:subagent-driven-development` (recomendado) o
> `superpowers:executing-plans` para implementar tarea por tarea. Los pasos usan checkbox
> (`- [ ]`) para seguimiento.

**Objetivo:** Que una línea de factura de compra o venta se pueda repartir entre varios
centros de costo por porcentaje, y que la empresa pueda exigir esa imputación en toda línea
imputada a una cuenta de resultado.

**Arquitectura:** Toda la lógica de reparto (validación, prorrateo, expansión del asiento) es
un puñado de funciones puras en `modules/commercial/shared/cost-center.ts`, testeadas sin base
de datos. Compras, ventas, el asiento y el formulario consumen esas funciones. Los datos viven
en dos tablas gemelas con FK obligatorias; la columna `cost_center_id` de la línea de compra
se migra a reparto 100% y se elimina.

**Stack:** Next.js 16 (App Router, Server Actions), Prisma 7 + PostgreSQL, React Hook Form +
Zod, shadcn/ui, Vitest, Cypress, Playwright (para el PDF de la guía).

**Spec:** `.planes/tsk-583-centros-de-costo-multiples.md`

## Restricciones globales

- **Sin `:any`.** Los tipos se infieren de Prisma o de Zod.
- **`logger`, nunca `console.*`** — `import { logger } from '@/shared/lib/logger'`.
- **Decimal de Prisma → `Number()`** antes de devolver a Client Components.
- **Client Components con prefijo `_`**; Server Components por defecto.
- **`checkPermission()`** al inicio de cada server action; `commercial.purchases` /
  `commercial.sales` con acción `create`, `update` o `approve` según corresponda.
- **Nada de `confirm()` / `alert()`** — `AlertDialog` de shadcn/ui.
- **Fechas con moment.js**, nunca date-fns.
- **Porcentajes:** `Decimal(5,2)` en base, `number` en TypeScript. Un reparto **suma 100.00 o
  está vacío**; nunca un valor intermedio.
- **Solo se reparte el neto (`subtotal`) de la línea.** El IVA nunca.
- **Tipos de cuenta de resultado:** `['REVENUE', 'EXPENSE']`. Los patrimoniales (`ASSET`,
  `LIABILITY`, `EQUITY`) no admiten centro de costo.
- Los mensajes visibles al usuario van en español, con tildes.

**Nota sobre un archivo grande:** `purchases/features/invoices/list/actions.server.ts` tiene
1575 líneas y concentra create, update, confirm y confirmación masiva. El plan **no** lo
parte: no está en el alcance del ticket y partirlo mezclaría un refactor con una feature. Si
alguna tarea lo vuelve inmanejable, se propone aparte.

---

### Tarea 1: Helper compartido de reparto

Toda la lógica del reparto, en funciones puras y sin base de datos. Es la base de las otras
tareas: hacerla primero permite testear las reglas difíciles (el centavo del prorrateo) sin
levantar nada.

**Archivos:**
- Crear: `src/modules/commercial/shared/cost-center.ts`
- Crear: `src/modules/commercial/shared/cost-center.test.ts`
- Eliminar: `src/modules/commercial/features/purchases/features/invoices/shared/cost-center.ts`
- Eliminar: `src/modules/commercial/features/purchases/features/invoices/shared/cost-center.test.ts`
- Modificar: `src/modules/commercial/features/purchases/features/invoices/create/components/_PurchaseInvoiceForm.tsx:26` (el import)
- Modificar: `src/modules/commercial/features/purchases/features/invoices/shared/index.ts` (si reexporta `cost-center`)

**Interfaces:**
- Consume: nada.
- Produce:
  - `RESULT_ACCOUNT_TYPES: readonly ['REVENUE', 'EXPENSE']`
  - `allowsCostCenter(accountType?: string | null): boolean`
  - `interface CostCenterAllocation { costCenterId: string; percentage: number }`
  - `totalPercentage(allocations: CostCenterAllocation[]): number`
  - `type AllocationError = 'DUPLICATE_COST_CENTER' | 'NON_POSITIVE_PERCENTAGE' | 'INCOMPLETE_TOTAL'`
  - `validateAllocations(allocations: CostCenterAllocation[]): AllocationError | null`
  - `prorateAmount(amount: number, allocations: CostCenterAllocation[]): Array<{ costCenterId: string; amount: number }>`
  - `ALLOCATION_ERROR_MESSAGES: Record<AllocationError, string>`

- [ ] **Paso 1: Mover el helper existente sin cambiarlo**

```bash
mkdir -p src/modules/commercial/shared
git mv src/modules/commercial/features/purchases/features/invoices/shared/cost-center.ts \
       src/modules/commercial/shared/cost-center.ts
git mv src/modules/commercial/features/purchases/features/invoices/shared/cost-center.test.ts \
       src/modules/commercial/shared/cost-center.test.ts
```

Actualizar el import en `_PurchaseInvoiceForm.tsx:26` de `'../../shared/cost-center'` a
`'@/modules/commercial/shared/cost-center'`, y revisar si `shared/index.ts` lo reexportaba.

- [ ] **Paso 2: Verificar que no se rompió nada**

Run: `npx vitest run src/modules/commercial/shared/cost-center.test.ts && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -c "error TS"`
Expected: los 4 tests pasan; el conteo de errores TS **no aumenta** respecto de la línea base
(227 en la rama actual — anotar el número antes de empezar).

- [ ] **Paso 3: Escribir los tests del prorrateo y la validación**

Agregar al final de `src/modules/commercial/shared/cost-center.test.ts`:

```typescript
import {
  prorateAmount,
  totalPercentage,
  validateAllocations,
  type CostCenterAllocation,
} from './cost-center';

const LOGISTICA = '11111111-1111-1111-1111-111111111111';
const MANTENIMIENTO = '22222222-2222-2222-2222-222222222222';
const ADMIN = '33333333-3333-3333-3333-333333333333';

describe('validación del reparto', () => {
  it('acepta un reparto vacío: es la imputación opcional de siempre', () => {
    expect(validateAllocations([])).toBeNull();
  });

  it('acepta un solo centro al 100%', () => {
    expect(validateAllocations([{ costCenterId: LOGISTICA, percentage: 100 }])).toBeNull();
  });

  it('acepta un reparto entre varios que suma 100', () => {
    const reparto: CostCenterAllocation[] = [
      { costCenterId: LOGISTICA, percentage: 60 },
      { costCenterId: MANTENIMIENTO, percentage: 40 },
    ];
    expect(validateAllocations(reparto)).toBeNull();
  });

  it('rechaza un reparto incompleto: sería plata sin imputar', () => {
    expect(validateAllocations([{ costCenterId: LOGISTICA, percentage: 60 }])).toBe(
      'INCOMPLETE_TOTAL'
    );
  });

  it('rechaza un reparto que se pasa de 100', () => {
    const reparto = [
      { costCenterId: LOGISTICA, percentage: 60 },
      { costCenterId: MANTENIMIENTO, percentage: 60 },
    ];
    expect(validateAllocations(reparto)).toBe('INCOMPLETE_TOTAL');
  });

  it('rechaza el mismo centro repetido', () => {
    const reparto = [
      { costCenterId: LOGISTICA, percentage: 50 },
      { costCenterId: LOGISTICA, percentage: 50 },
    ];
    expect(validateAllocations(reparto)).toBe('DUPLICATE_COST_CENTER');
  });

  it('rechaza un porcentaje en cero o negativo', () => {
    const reparto = [
      { costCenterId: LOGISTICA, percentage: 100 },
      { costCenterId: MANTENIMIENTO, percentage: 0 },
    ];
    expect(validateAllocations(reparto)).toBe('NON_POSITIVE_PERCENTAGE');
  });

  it('suma con dos decimales sin arrastrar error de punto flotante', () => {
    const reparto = [
      { costCenterId: LOGISTICA, percentage: 33.33 },
      { costCenterId: MANTENIMIENTO, percentage: 33.33 },
      { costCenterId: ADMIN, percentage: 33.34 },
    ];
    expect(totalPercentage(reparto)).toBe(100);
    expect(validateAllocations(reparto)).toBeNull();
  });
});

describe('prorrateo del importe de la línea', () => {
  it('reparte mitad y mitad', () => {
    const reparto = [
      { costCenterId: LOGISTICA, percentage: 50 },
      { costCenterId: MANTENIMIENTO, percentage: 50 },
    ];
    expect(prorateAmount(1000, reparto)).toEqual([
      { costCenterId: LOGISTICA, amount: 500 },
      { costCenterId: MANTENIMIENTO, amount: 500 },
    ]);
  });

  it('el último centro absorbe el centavo que sobra', () => {
    const reparto = [
      { costCenterId: LOGISTICA, percentage: 33.33 },
      { costCenterId: MANTENIMIENTO, percentage: 33.33 },
      { costCenterId: ADMIN, percentage: 33.34 },
    ];
    const partes = prorateAmount(10, reparto);

    expect(partes).toEqual([
      { costCenterId: LOGISTICA, amount: 3.33 },
      { costCenterId: MANTENIMIENTO, amount: 3.33 },
      { costCenterId: ADMIN, amount: 3.34 },
    ]);
    // Lo que importa: la suma de las partes es exactamente el total.
    expect(partes.reduce((acc, p) => acc + p.amount, 0)).toBe(10);
  });

  it('nunca descuadra, sea cual sea el importe', () => {
    const reparto = [
      { costCenterId: LOGISTICA, percentage: 33.33 },
      { costCenterId: MANTENIMIENTO, percentage: 33.33 },
      { costCenterId: ADMIN, percentage: 33.34 },
    ];
    for (const importe of [0.01, 0.05, 1, 7.77, 100.01, 4000000.5]) {
      const suma = prorateAmount(importe, reparto).reduce((acc, p) => acc + p.amount, 0);
      expect(suma).toBe(importe);
    }
  });

  it('sin reparto no devuelve partes', () => {
    expect(prorateAmount(1000, [])).toEqual([]);
  });
});
```

- [ ] **Paso 4: Correr los tests y verificar que fallan**

Run: `npx vitest run src/modules/commercial/shared/cost-center.test.ts`
Expected: FAIL — "No se exporta validateAllocations / prorateAmount / totalPercentage".

- [ ] **Paso 5: Implementar las funciones**

Agregar a `src/modules/commercial/shared/cost-center.ts`:

```typescript
/** Un tramo del reparto: qué centro se lleva qué porcentaje de la línea. */
export interface CostCenterAllocation {
  costCenterId: string;
  percentage: number;
}

/** Redondeo a 2 decimales, evitando el arrastre binario de 0.1 + 0.2. */
function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** Suma de los porcentajes del reparto, con 2 decimales. */
export function totalPercentage(allocations: CostCenterAllocation[]): number {
  return round2(allocations.reduce((acc, a) => acc + a.percentage, 0));
}

export type AllocationError =
  | 'DUPLICATE_COST_CENTER'
  | 'NON_POSITIVE_PERCENTAGE'
  | 'INCOMPLETE_TOTAL';

/** Mensajes para el usuario, en un solo lugar para formulario y server action. */
export const ALLOCATION_ERROR_MESSAGES: Record<AllocationError, string> = {
  DUPLICATE_COST_CENTER: 'No se puede repetir el mismo centro de costo en una línea',
  NON_POSITIVE_PERCENTAGE: 'Cada centro de costo debe llevarse un porcentaje mayor a cero',
  INCOMPLETE_TOTAL: 'El reparto debe sumar 100%',
};

/**
 * Un reparto es válido si está vacío (imputación opcional, cae en el centro
 * predeterminado del ítem) o si suma exactamente 100%. Un valor intermedio deja
 * plata sin imputar, así que no se admite ni siquiera con la obligatoriedad
 * apagada.
 */
export function validateAllocations(
  allocations: CostCenterAllocation[]
): AllocationError | null {
  if (allocations.length === 0) return null;

  const ids = new Set(allocations.map((a) => a.costCenterId));
  if (ids.size !== allocations.length) return 'DUPLICATE_COST_CENTER';

  if (allocations.some((a) => a.percentage <= 0)) return 'NON_POSITIVE_PERCENTAGE';

  if (totalPercentage(allocations) !== 100) return 'INCOMPLETE_TOTAL';

  return null;
}

/**
 * Reparte un importe según los porcentajes.
 *
 * El último centro absorbe la diferencia de redondeo: sin eso, un 33/33/34 sobre
 * $10 devuelve partes que suman $9,99 y el asiento no cierra, así que la factura
 * no se puede confirmar.
 */
export function prorateAmount(
  amount: number,
  allocations: CostCenterAllocation[]
): Array<{ costCenterId: string; amount: number }> {
  if (allocations.length === 0) return [];

  const parts = allocations.map((a) => ({
    costCenterId: a.costCenterId,
    amount: round2((amount * a.percentage) / 100),
  }));

  const assigned = round2(parts.slice(0, -1).reduce((acc, p) => acc + p.amount, 0));
  parts[parts.length - 1].amount = round2(amount - assigned);

  return parts;
}
```

- [ ] **Paso 6: Correr los tests y verificar que pasan**

Run: `npx vitest run src/modules/commercial/shared/cost-center.test.ts`
Expected: PASS, todos.

- [ ] **Paso 7: Commit**

```bash
git add src/modules/commercial/shared src/modules/commercial/features/purchases
git commit -m "feat(commercial): helper compartido de reparto por centro de costo (TSK-583)"
```

---

### Tarea 2: Modelo de datos y migración

**Archivos:**
- Modificar: `prisma/schema.prisma` — dos modelos nuevos, `requireCostCenter`, eliminar `PurchaseInvoiceLine.costCenterId`
- Crear: `prisma/migrations/<timestamp>_cost_center_allocations/migration.sql`

**Interfaces:**
- Consume: nada.
- Produce: modelos Prisma `PurchaseInvoiceLineCostCenter` y `SalesInvoiceLineCostCenter`
  (campos `id`, `lineId`, `costCenterId`, `percentage`), y `AccountingSettings.requireCostCenter`.

- [ ] **Paso 1: Editar el schema**

En `prisma/schema.prisma`:

```prisma
model PurchaseInvoiceLineCostCenter {
  id           String  @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  lineId       String  @map("line_id") @db.Uuid
  costCenterId String  @map("cost_center_id") @db.Uuid
  percentage   Decimal @db.Decimal(5, 2)

  line       PurchaseInvoiceLine @relation(fields: [lineId], references: [id], onDelete: Cascade)
  costCenter CostCenter          @relation(fields: [costCenterId], references: [id])

  @@unique([lineId, costCenterId])
  @@index([costCenterId])
  @@map("purchase_invoice_line_cost_centers")
}

model SalesInvoiceLineCostCenter {
  id           String  @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  lineId       String  @map("line_id") @db.Uuid
  costCenterId String  @map("cost_center_id") @db.Uuid
  percentage   Decimal @db.Decimal(5, 2)

  line       SalesInvoiceLine @relation(fields: [lineId], references: [id], onDelete: Cascade)
  costCenter CostCenter       @relation(fields: [costCenterId], references: [id])

  @@unique([lineId, costCenterId])
  @@index([costCenterId])
  @@map("sales_invoice_line_cost_centers")
}
```

Y además:
- En `PurchaseInvoiceLine`: **eliminar** `costCenterId`, la relación `costCenter` y el
  comentario asociado; agregar `costCenterAllocations PurchaseInvoiceLineCostCenter[]`.
- En `SalesInvoiceLine`: agregar `costCenterAllocations SalesInvoiceLineCostCenter[]`.
- En `CostCenter`: reemplazar `purchaseInvoiceLines PurchaseInvoiceLine[] @relation("PurchaseInvoiceLineCostCenter")`
  por `purchaseLineAllocations PurchaseInvoiceLineCostCenter[]` y agregar
  `salesLineAllocations SalesInvoiceLineCostCenter[]`.
- En `AccountingSettings`: agregar
  `requireCostCenter Boolean @default(false) @map("require_cost_center")`.

- [ ] **Paso 2: Generar la migración vacía para escribirla a mano**

Run: `npx prisma migrate dev --create-only --name cost_center_allocations`
Expected: crea la carpeta con el SQL autogenerado, sin aplicarlo.

- [ ] **Paso 3: Editar el SQL para no perder los datos existentes**

El SQL autogenerado hace `DROP COLUMN` a secas. Insertar **antes** del drop la copia de lo
que haya como reparto al 100%:

```sql
-- Lo ya imputado con el modelo anterior pasa a ser un reparto al 100%.
-- Inofensivo si la tabla está vacía (la primera entrega no llegó a producción).
INSERT INTO "purchase_invoice_line_cost_centers" ("line_id", "cost_center_id", "percentage")
SELECT "id", "cost_center_id", 100.00
FROM "purchase_invoice_lines"
WHERE "cost_center_id" IS NOT NULL;

ALTER TABLE "purchase_invoice_lines" DROP COLUMN "cost_center_id";
```

Verificar que el `INSERT` quede después del `CREATE TABLE` de
`purchase_invoice_line_cost_centers` y antes del `DROP COLUMN`.

- [ ] **Paso 4: Aplicar y verificar**

```bash
npx prisma migrate dev
npx prisma generate
docker exec contable-pms-db psql -U postgres -d contable_pms -c "\d purchase_invoice_line_cost_centers"
docker exec contable-pms-db psql -U postgres -d contable_pms -c "SELECT count(*) FROM purchase_invoice_line_cost_centers;"
```

Expected: la tabla existe con el unique `(line_id, cost_center_id)`; el conteo coincide con
las líneas que tenían centro antes de migrar.

- [ ] **Paso 5: Verificar tipos**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep "costCenterId" | head -20`
Expected: aparecen los usos rotos de la columna eliminada
(`list/actions.server.ts:849`, `:992`, `EditPurchaseInvoice.tsx:65`,
`integrations/commercial/index.ts:438`). Son los que arreglan las tareas 5, 6 y 7 — anotarlos.

- [ ] **Paso 6: Commit**

```bash
git add prisma/
git commit -m "feat(db): tablas de reparto por centro de costo y flag de obligatoriedad (TSK-583)"
```

---

### Tarea 3: Switch de obligatoriedad en Configuración Contable

Va antes que la validación porque la tarea 6 necesita leer el flag.

**Archivos:**
- Modificar: `src/modules/accounting/features/settings/validators.ts`
- Modificar: `src/modules/accounting/features/settings/components/_CommercialIntegrationForm.tsx`
- Modificar: `src/modules/accounting/features/settings/actions.server.ts`
- Modificar: `src/modules/accounting/features/settings/validators.test.ts`

**Interfaces:**
- Consume: `AccountingSettings.requireCostCenter` (Tarea 2).
- Produce: `commercialIntegrationSchema` con el campo `requireCostCenter: z.boolean().default(false)`;
  `getAccountingSettings()` devuelve `requireCostCenter: boolean`.

- [ ] **Paso 1: Escribir el test del validator**

Agregar en `src/modules/accounting/features/settings/validators.test.ts`:

```typescript
describe('exigir centro de costo', () => {
  it('viene apagado si el formulario no lo manda', () => {
    const parsed = commercialIntegrationSchema.parse({});
    expect(parsed.requireCostCenter).toBe(false);
  });

  it('conserva el valor cuando se activa', () => {
    const parsed = commercialIntegrationSchema.parse({ requireCostCenter: true });
    expect(parsed.requireCostCenter).toBe(true);
  });
});
```

- [ ] **Paso 2: Correr y ver que falla**

Run: `npx vitest run src/modules/accounting/features/settings/validators.test.ts`
Expected: FAIL — `requireCostCenter` es `undefined`.

- [ ] **Paso 3: Agregar el campo al schema**

En `validators.ts`, dentro de `commercialIntegrationSchema`:

```typescript
  /**
   * Con esto activo, toda línea imputada a una cuenta de resultado necesita
   * reparto por centro de costo para poder confirmar la factura (TSK-583).
   */
  requireCostCenter: z.boolean().default(false),
```

- [ ] **Paso 4: Correr y ver que pasa**

Run: `npx vitest run src/modules/accounting/features/settings/validators.test.ts`
Expected: PASS.

- [ ] **Paso 5: Sumar el switch al formulario y al action**

En `_CommercialIntegrationForm.tsx`, agregar antes de las secciones de cuentas un bloque con
el `Switch` de shadcn/ui (`@/shared/components/ui/switch`):

- Etiqueta: **"Exigir centro de costo"**
- Ayuda: *"Al confirmar una factura de compra o venta, cada línea imputada a una cuenta de
  ingresos o egresos deberá tener su reparto por centro de costo."*
- Registrado con `form.register('requireCostCenter')` o `Controller`, según el patrón del
  archivo.

En `actions.server.ts`: incluir `requireCostCenter` en el `select` de lectura y en el `data`
de `saveAccountingSettings`.

- [ ] **Paso 6: Verificar en el navegador**

```bash
npm run dev
```

Ir a Configuración Contable, activar el switch, guardar, recargar. Expected: queda activado.

```bash
docker exec contable-pms-db psql -U postgres -d contable_pms -c "SELECT require_cost_center FROM accounting_settings;"
```

- [ ] **Paso 7: Commit**

```bash
git add src/modules/accounting/features/settings
git commit -m "feat(accounting): switch para exigir centro de costo (TSK-583)"
```

---

### Tarea 4: Editor de reparto (componente compartido)

**Archivos:**
- Crear: `src/modules/commercial/shared/components/_CostCenterAllocationField.tsx`
- Crear: `src/modules/commercial/shared/allocation-form.ts`
- Crear: `src/modules/commercial/shared/allocation-form.test.ts`

**Interfaces:**
- Consume: `CostCenterAllocation`, `validateAllocations`, `prorateAmount`,
  `ALLOCATION_ERROR_MESSAGES`, `totalPercentage` (Tarea 1).
- Produce:
  - `allocationFieldSchema: z.ZodType<{ costCenterId: string; percentage: number }[]>` —
    schema Zod reutilizable por compras y ventas.
  - Componente `_CostCenterAllocationField` con props
    `{ name: string; lineAmount: number; costCenters: Array<{ id: string; name: string }>; onApplyToAll?: () => void }`.

- [ ] **Paso 1: Escribir el test del schema del formulario**

Crear `src/modules/commercial/shared/allocation-form.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';

import { allocationFieldSchema } from './allocation-form';

const LOGISTICA = '11111111-1111-1111-1111-111111111111';
const MANTENIMIENTO = '22222222-2222-2222-2222-222222222222';

describe('schema del reparto en el formulario', () => {
  it('acepta el reparto vacío', () => {
    expect(allocationFieldSchema.safeParse([]).success).toBe(true);
  });

  it('acepta un reparto que suma 100', () => {
    const reparto = [
      { costCenterId: LOGISTICA, percentage: 60 },
      { costCenterId: MANTENIMIENTO, percentage: 40 },
    ];
    expect(allocationFieldSchema.safeParse(reparto).success).toBe(true);
  });

  it('rechaza un reparto incompleto con un mensaje entendible', () => {
    const resultado = allocationFieldSchema.safeParse([
      { costCenterId: LOGISTICA, percentage: 60 },
    ]);

    expect(resultado.success).toBe(false);
    if (!resultado.success) {
      expect(resultado.error.issues[0].message).toBe('El reparto debe sumar 100%');
    }
  });

  it('rechaza el centro repetido', () => {
    const resultado = allocationFieldSchema.safeParse([
      { costCenterId: LOGISTICA, percentage: 50 },
      { costCenterId: LOGISTICA, percentage: 50 },
    ]);

    expect(resultado.success).toBe(false);
    if (!resultado.success) {
      expect(resultado.error.issues[0].message).toBe(
        'No se puede repetir el mismo centro de costo en una línea'
      );
    }
  });
});
```

- [ ] **Paso 2: Correr y ver que falla**

Run: `npx vitest run src/modules/commercial/shared/allocation-form.test.ts`
Expected: FAIL — el módulo no existe.

- [ ] **Paso 3: Implementar el schema**

Crear `src/modules/commercial/shared/allocation-form.ts`:

```typescript
import { z } from 'zod';

import {
  ALLOCATION_ERROR_MESSAGES,
  validateAllocations,
  type CostCenterAllocation,
} from './cost-center';

/**
 * Reparto de una línea, tal como lo maneja el formulario (TSK-583).
 *
 * La validación es la misma función que usa el server action, así que el
 * formulario y el servidor no pueden divergir en el criterio.
 */
export const allocationFieldSchema = z
  .array(
    z.object({
      costCenterId: z.string().uuid('Elegí un centro de costo'),
      percentage: z.number(),
    })
  )
  .superRefine((allocations, ctx) => {
    const error = validateAllocations(allocations as CostCenterAllocation[]);
    if (!error) return;

    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: ALLOCATION_ERROR_MESSAGES[error],
    });
  });

export type AllocationFieldValue = z.infer<typeof allocationFieldSchema>;
```

- [ ] **Paso 4: Correr y ver que pasa**

Run: `npx vitest run src/modules/commercial/shared/allocation-form.test.ts`
Expected: PASS.

- [ ] **Paso 5: Implementar el componente**

Crear `src/modules/commercial/shared/components/_CostCenterAllocationField.tsx`:

```tsx
'use client';

import { Plus, Trash2 } from 'lucide-react';
import { useFieldArray, useFormContext, useWatch } from 'react-hook-form';

import { Button } from '@/shared/components/ui/button';
import { Input } from '@/shared/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui/select';
import { cn } from '@/shared/lib/utils';

import { prorateAmount, totalPercentage, type CostCenterAllocation } from '../cost-center';

export interface CostCenterOption {
  id: string;
  name: string;
}

interface CostCenterAllocationFieldProps {
  /** Ruta del array dentro del formulario, ej: `lines.0.costCenterAllocations`. */
  name: string;
  /** Neto de la línea, para mostrar cuánto se lleva cada centro. */
  lineAmount: number;
  costCenters: CostCenterOption[];
  /** Copia este reparto al resto de las líneas. Si no viene, no se ofrece. */
  onApplyToAll?: () => void;
}

const formatMoney = (value: number) =>
  new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(
    value
  );

/**
 * Reparto de una línea entre varios centros de costo (TSK-583).
 *
 * Con un solo centro al 100% se ve casi igual que el selector anterior: el caso
 * simple no se complica por soportar el repartido.
 */
export function _CostCenterAllocationField({
  name,
  lineAmount,
  costCenters,
  onApplyToAll,
}: CostCenterAllocationFieldProps) {
  const { control, register } = useFormContext();
  const { fields, append, remove } = useFieldArray({ control, name });

  const allocations = (useWatch({ control, name }) ?? []) as CostCenterAllocation[];
  const total = totalPercentage(allocations);
  const amounts = prorateAmount(lineAmount, allocations);
  const isComplete = total === 100;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">Centros de costo</span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => append({ costCenterId: '', percentage: fields.length === 0 ? 100 : 0 })}
        >
          <Plus className="mr-1 h-4 w-4" />
          Agregar centro
        </Button>
      </div>

      {fields.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Sin reparto — se usa el centro predeterminado del ítem
        </p>
      ) : (
        <>
          {fields.map((field, index) => (
            <div key={field.id} className="flex items-center gap-2">
              <Select
                value={allocations[index]?.costCenterId ?? ''}
                onValueChange={(value) =>
                  control._formValues &&
                  control.setValue?.(`${name}.${index}.costCenterId`, value, {
                    shouldValidate: true,
                  })
                }
              >
                <SelectTrigger className="flex-1">
                  <SelectValue placeholder="Elegí un centro de costo" />
                </SelectTrigger>
                <SelectContent position="popper" className="max-h-[250px]">
                  {costCenters.map((costCenter) => (
                    <SelectItem key={costCenter.id} value={costCenter.id}>
                      {costCenter.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Input
                type="number"
                step="0.01"
                min="0"
                max="100"
                className="w-24 text-right"
                {...register(`${name}.${index}.percentage`, { valueAsNumber: true })}
              />
              <span className="text-sm text-muted-foreground">%</span>

              <span className="w-32 text-right text-sm tabular-nums">
                ${formatMoney(amounts[index]?.amount ?? 0)}
              </span>

              <Button type="button" variant="ghost" size="icon" onClick={() => remove(index)}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}

          <div className="flex items-center justify-between border-t pt-2">
            <span className={cn('text-sm font-medium', isComplete ? 'text-green-600' : 'text-destructive')}>
              Total {formatMoney(total)} % · ${formatMoney(lineAmount)}
            </span>

            {onApplyToAll && isComplete && (
              <Button type="button" variant="outline" size="sm" onClick={onApplyToAll}>
                Aplicar a todas las líneas
              </Button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
```

Dos detalles al integrarlo: el formulario tiene que estar envuelto en `FormProvider` para que
`useFormContext` funcione — si `_PurchaseInvoiceForm` no lo usa, pasar `control` por props en
lugar de por contexto. Y el mensaje de error del reparto sale del `superRefine` del schema, así
que hay que renderizar el `FormMessage` del campo `name` debajo del bloque.

- [ ] **Paso 6: Verificar tipos y lint**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -c "shared/components/_CostCenterAllocationField"` y `npx eslint src/modules/commercial/shared`
Expected: 0 errores propios del archivo nuevo.

- [ ] **Paso 7: Commit**

```bash
git add src/modules/commercial/shared
git commit -m "feat(commercial): editor de reparto por centro de costo (TSK-583)"
```

---

### Tarea 5: Compras — cargar y guardar el reparto

**Archivos:**
- Modificar: `src/modules/commercial/features/purchases/features/invoices/shared/validators.ts:33-42`
- Modificar: `src/modules/commercial/features/purchases/features/invoices/create/components/_PurchaseInvoiceForm.tsx` (reemplaza `_LineCostCenterField`, líneas 80-145)
- Modificar: `src/modules/commercial/features/purchases/features/invoices/edit/EditPurchaseInvoice.tsx:65`
- Modificar: `src/modules/commercial/features/purchases/features/invoices/list/actions.server.ts:849` (create) y `:992` (update)

**Interfaces:**
- Consume: `allocationFieldSchema`, `_CostCenterAllocationField` (Tarea 4); modelos de la Tarea 2.
- Produce: `purchaseInvoiceLineSchema` con `costCenterAllocations` en lugar de `costCenterId`.

- [ ] **Paso 1: Cambiar el schema de la línea**

En `validators.ts`, reemplazar la línea 41 (`costCenterId: ...`) por:

```typescript
  // Reparto por centro de costo. Vacío = centro predeterminado del ítem (TSK-583).
  costCenterAllocations: allocationFieldSchema.default([]),
```

con `import { allocationFieldSchema } from '@/modules/commercial/shared/allocation-form';`

- [ ] **Paso 2: Reemplazar el campo en el formulario**

En `_PurchaseInvoiceForm.tsx`, `_LineCostCenterField` pasa a renderizar
`_CostCenterAllocationField` en lugar del `Select`. Se conserva tal cual la guarda de entrada:

```typescript
if (!allowsCostCenter(product?.defaultExpenseAccountType)) return null;
```

`lineAmount` sale del subtotal ya calculado de la línea (cantidad × valor unitario). El
`onApplyToAll` copia el reparto de esa línea a las demás líneas cuyo ítem pase la misma
guarda, usando `form.setValue`.

- [ ] **Paso 3: Adaptar el precargado de la edición**

En `EditPurchaseInvoice.tsx:65`, reemplazar `costCenterId: line.costCenterId || ''` por:

```typescript
      costCenterAllocations: line.costCenterAllocations.map((a) => ({
        costCenterId: a.costCenterId,
        percentage: Number(a.percentage),
      })),
```

`percentage` es `Decimal` de Prisma: el `Number()` es obligatorio antes de pasar a un Client
Component. Verificar que el `select`/`include` de la query traiga `costCenterAllocations`.

- [ ] **Paso 4: Persistir en create y update**

En `list/actions.server.ts:849` y `:992`, reemplazar `costCenterId: line.costCenterId || null`
por la escritura anidada:

```typescript
        costCenterAllocations: {
          create: line.costCenterAllocations.map((a) => ({
            costCenterId: a.costCenterId,
            percentage: a.percentage,
          })),
        },
```

En el update, borrar el reparto anterior antes de recrearlo (`deleteMany` sobre las líneas de
la factura dentro de la misma transacción), igual que se hace hoy con las líneas.

- [ ] **Paso 5: Probar el flujo completo a mano**

```bash
npm run dev
```

Cargar una factura de compra con un ítem imputado a cuenta de egresos, repartir 60/40 entre
dos centros, guardar como borrador, reabrir en edición. Expected: el reparto vuelve tal cual
se guardó.

```bash
docker exec contable-pms-db psql -U postgres -d contable_pms \
  -c "SELECT line_id, cost_center_id, percentage FROM purchase_invoice_line_cost_centers ORDER BY line_id LIMIT 5;"
```

- [ ] **Paso 6: Verificar tipos**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "purchases|_PurchaseInvoiceForm" | head`
Expected: ningún error nuevo en esos archivos.

- [ ] **Paso 7: Commit**

```bash
git add src/modules/commercial/features/purchases
git commit -m "feat(purchases): reparto por centro de costo en la carga de facturas (TSK-583)"
```

---

### Tarea 6: Compras — obligatoriedad al confirmar

**Archivos:**
- Modificar: `src/modules/commercial/shared/cost-center.ts` (agrega `findLinesMissingCostCenter`)
- Modificar: `src/modules/commercial/shared/cost-center.test.ts`
- Modificar: `src/modules/commercial/features/purchases/features/invoices/list/actions.server.ts:1083` (`confirmPurchaseInvoice`) y la confirmación masiva

**Interfaces:**
- Consume: `allowsCostCenter`, `validateAllocations` (Tarea 1); `requireCostCenter` (Tarea 3).
- Produce:
  - `interface CostCenterLineCheck { description: string; accountType?: string | null; allocations: CostCenterAllocation[] }`
  - `findLinesMissingCostCenter(lines: CostCenterLineCheck[]): CostCenterLineCheck[]`
  - `buildMissingCostCenterMessage(missing: CostCenterLineCheck[]): string`

- [ ] **Paso 1: Escribir los tests**

Agregar en `src/modules/commercial/shared/cost-center.test.ts`:

```typescript
import {
  buildMissingCostCenterMessage,
  findLinesMissingCostCenter,
  type CostCenterLineCheck,
} from './cost-center';

const LINEAS: CostCenterLineCheck[] = [
  { description: 'Combustible', accountType: 'EXPENSE', allocations: [] },
  {
    description: 'Peajes',
    accountType: 'EXPENSE',
    allocations: [{ costCenterId: LOGISTICA, percentage: 100 }],
  },
  { description: 'Camioneta', accountType: 'ASSET', allocations: [] },
  { description: 'Gasto suelto', accountType: null, allocations: [] },
];

describe('líneas que quedan sin imputar con la obligatoriedad activa', () => {
  it('marca la línea de resultado sin reparto', () => {
    expect(findLinesMissingCostCenter(LINEAS).map((l) => l.description)).toEqual([
      'Combustible',
    ]);
  });

  it('no marca la que ya tiene reparto completo', () => {
    const conReparto = LINEAS.filter((l) => l.description === 'Peajes');
    expect(findLinesMissingCostCenter(conReparto)).toEqual([]);
  });

  it('no exige nada a una compra de activo', () => {
    const activo = LINEAS.filter((l) => l.description === 'Camioneta');
    expect(findLinesMissingCostCenter(activo)).toEqual([]);
  });

  it('no exige nada a una línea sin cuenta conocida', () => {
    const suelta = LINEAS.filter((l) => l.description === 'Gasto suelto');
    expect(findLinesMissingCostCenter(suelta)).toEqual([]);
  });

  it('arma un mensaje que nombra las líneas incompletas', () => {
    const mensaje = buildMissingCostCenterMessage(findLinesMissingCostCenter(LINEAS));
    expect(mensaje).toBe('Falta el centro de costo en 1 línea: Combustible');
  });

  it('usa el plural con varias líneas', () => {
    const mensaje = buildMissingCostCenterMessage([
      { description: 'Combustible', accountType: 'EXPENSE', allocations: [] },
      { description: 'Peajes', accountType: 'EXPENSE', allocations: [] },
    ]);
    expect(mensaje).toBe('Falta el centro de costo en 2 líneas: Combustible, Peajes');
  });
});
```

- [ ] **Paso 2: Correr y ver que falla**

Run: `npx vitest run src/modules/commercial/shared/cost-center.test.ts`
Expected: FAIL — no se exporta `findLinesMissingCostCenter`.

- [ ] **Paso 3: Implementar**

En `src/modules/commercial/shared/cost-center.ts`:

```typescript
/** Una línea de factura, vista desde la regla de obligatoriedad. */
export interface CostCenterLineCheck {
  description: string;
  accountType?: string | null;
  allocations: CostCenterAllocation[];
}

/**
 * Líneas que exigirían reparto y no lo tienen completo.
 *
 * Solo se mira lo imputado a cuentas de resultado: una compra de activo no
 * consume presupuesto de ningún centro, y una línea sin cuenta conocida no tiene
 * criterio para exigir nada.
 *
 * Ojo con el reparto vacío: `validateAllocations([])` devuelve `null` porque el
 * vacío es válido cuando la obligatoriedad está apagada. Acá, en cambio, el
 * vacío es justamente lo que falta, así que se chequea aparte.
 */
export function findLinesMissingCostCenter<T extends CostCenterLineCheck>(lines: T[]): T[] {
  return lines.filter((line) => {
    if (!allowsCostCenter(line.accountType)) return false;
    if (line.allocations.length === 0) return true;

    return validateAllocations(line.allocations) !== null;
  });
}

/** Aviso para el usuario, nombrando qué líneas hay que completar. */
export function buildMissingCostCenterMessage(missing: CostCenterLineCheck[]): string {
  const nombres = missing.map((l) => l.description).join(', ');
  const sustantivo = missing.length === 1 ? 'línea' : 'líneas';

  return `Falta el centro de costo en ${missing.length} ${sustantivo}: ${nombres}`;
}
```

- [ ] **Paso 4: Correr y ver que pasa**

Run: `npx vitest run src/modules/commercial/shared/cost-center.test.ts`
Expected: PASS, incluida la línea "Combustible".

- [ ] **Paso 5: Aplicar la regla en la confirmación**

En `confirmPurchaseInvoice` (`list/actions.server.ts:1083`), después de traer la factura:

```typescript
    const settings = await prisma.accountingSettings.findUnique({
      where: { companyId },
      select: { requireCostCenter: true },
    });

    if (settings?.requireCostCenter) {
      const missing = findLinesMissingCostCenter(
        invoice.lines.map((line) => ({
          description: line.description,
          accountType: line.product?.defaultExpenseAccountType ?? null,
          allocations: line.costCenterAllocations.map((a) => ({
            costCenterId: a.costCenterId,
            percentage: Number(a.percentage),
          })),
        }))
      );

      if (missing.length > 0) {
        throw new Error(buildMissingCostCenterMessage(missing));
      }
    }
```

Ampliar el `include` de la query para traer `costCenterAllocations` y el
`defaultExpenseAccountType` del producto (revisar cómo se obtiene hoy el tipo de cuenta; si
no está en `product`, resolverlo con un `include` de la cuenta).

La confirmación masiva llama a esta misma función por factura, así que el error viaja solo al
listado de fallidas — el mecanismo de `bulk-confirm.ts` ya lo contempla y no hay que tocarlo.

- [ ] **Paso 6: Probar los dos caminos**

Con el switch **apagado**: confirmar una factura con línea de egresos sin reparto → confirma.
Con el switch **activo**: la misma factura → error nombrando la línea. Completar el reparto →
confirma. Selección masiva de 3 facturas con 1 incompleta → confirma 2 e informa 1 omitida.

- [ ] **Paso 7: Commit**

```bash
git add src/modules/commercial
git commit -m "feat(purchases): exigir centro de costo al confirmar segun configuracion (TSK-583)"
```

---

### Tarea 7: Asiento de compras con reparto

**Archivos:**
- Modificar: `src/modules/commercial/shared/cost-center.ts` (agrega `expandByCostCenter`)
- Modificar: `src/modules/commercial/shared/cost-center.test.ts`
- Modificar: `src/modules/accounting/features/integrations/commercial/index.ts:438` y `:470-491`

**Interfaces:**
- Consume: `prorateAmount` (Tarea 1).
- Produce:
  - `interface ExpandableLine { accountId: string; subtotal: number; allocations: CostCenterAllocation[]; defaultCostCenterId?: string | null }`
  - `expandByCostCenter(lines: ExpandableLine[]): Array<{ accountId: string; costCenterId?: string; total: number }>`

- [ ] **Paso 1: Escribir los tests**

Agregar en `src/modules/commercial/shared/cost-center.test.ts`:

```typescript
import { expandByCostCenter } from './cost-center';

const CUENTA_COMBUSTIBLE = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const CUENTA_SERVICIOS = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

describe('expansión de líneas para el asiento', () => {
  it('parte una línea repartida en una imputación por centro', () => {
    const resultado = expandByCostCenter([
      {
        accountId: CUENTA_COMBUSTIBLE,
        subtotal: 1000,
        allocations: [
          { costCenterId: LOGISTICA, percentage: 60 },
          { costCenterId: MANTENIMIENTO, percentage: 40 },
        ],
      },
    ]);

    expect(resultado).toEqual([
      { accountId: CUENTA_COMBUSTIBLE, costCenterId: LOGISTICA, total: 600 },
      { accountId: CUENTA_COMBUSTIBLE, costCenterId: MANTENIMIENTO, total: 400 },
    ]);
  });

  it('sin reparto cae en el centro predeterminado del ítem', () => {
    const resultado = expandByCostCenter([
      {
        accountId: CUENTA_COMBUSTIBLE,
        subtotal: 1000,
        allocations: [],
        defaultCostCenterId: LOGISTICA,
      },
    ]);

    expect(resultado).toEqual([
      { accountId: CUENTA_COMBUSTIBLE, costCenterId: LOGISTICA, total: 1000 },
    ]);
  });

  it('sin reparto ni predeterminado, la imputación queda sin centro', () => {
    const resultado = expandByCostCenter([
      { accountId: CUENTA_COMBUSTIBLE, subtotal: 1000, allocations: [] },
    ]);

    expect(resultado).toEqual([
      { accountId: CUENTA_COMBUSTIBLE, costCenterId: undefined, total: 1000 },
    ]);
  });

  it('acumula lo que cae en la misma cuenta y el mismo centro', () => {
    const resultado = expandByCostCenter([
      {
        accountId: CUENTA_COMBUSTIBLE,
        subtotal: 1000,
        allocations: [{ costCenterId: LOGISTICA, percentage: 100 }],
      },
      {
        accountId: CUENTA_COMBUSTIBLE,
        subtotal: 500,
        allocations: [{ costCenterId: LOGISTICA, percentage: 100 }],
      },
    ]);

    expect(resultado).toEqual([
      { accountId: CUENTA_COMBUSTIBLE, costCenterId: LOGISTICA, total: 1500 },
    ]);
  });

  it('no mezcla centros distintos de la misma cuenta', () => {
    const resultado = expandByCostCenter([
      {
        accountId: CUENTA_SERVICIOS,
        subtotal: 1000,
        allocations: [{ costCenterId: LOGISTICA, percentage: 100 }],
      },
      {
        accountId: CUENTA_SERVICIOS,
        subtotal: 500,
        allocations: [{ costCenterId: MANTENIMIENTO, percentage: 100 }],
      },
    ]);

    expect(resultado).toHaveLength(2);
  });

  it('ignora las líneas sin importe', () => {
    expect(expandByCostCenter([{ accountId: CUENTA_SERVICIOS, subtotal: 0, allocations: [] }])).toEqual(
      []
    );
  });

  it('lo repartido suma exactamente el neto de la línea', () => {
    const resultado = expandByCostCenter([
      {
        accountId: CUENTA_SERVICIOS,
        subtotal: 10,
        allocations: [
          { costCenterId: LOGISTICA, percentage: 33.33 },
          { costCenterId: MANTENIMIENTO, percentage: 33.33 },
          { costCenterId: ADMIN, percentage: 33.34 },
        ],
      },
    ]);

    expect(resultado.reduce((acc, r) => acc + r.total, 0)).toBe(10);
  });
});
```

- [ ] **Paso 2: Correr y ver que falla**

Run: `npx vitest run src/modules/commercial/shared/cost-center.test.ts`
Expected: FAIL — no se exporta `expandByCostCenter`.

- [ ] **Paso 3: Implementar**

```typescript
/** Una línea de factura, vista desde la generación del asiento. */
export interface ExpandableLine {
  accountId: string;
  subtotal: number;
  allocations: CostCenterAllocation[];
  defaultCostCenterId?: string | null;
}

/**
 * Convierte las líneas en imputaciones de asiento, una por cuenta y centro.
 *
 * Agrupa por `cuenta + centro`: agrupando solo por cuenta, un reparto entre
 * varios centros se perdía y sobrevivía uno solo. Sin reparto, cae en el centro
 * predeterminado del ítem, que es el comportamiento de siempre.
 */
export function expandByCostCenter(
  lines: ExpandableLine[]
): Array<{ accountId: string; costCenterId?: string; total: number }> {
  const grouped = new Map<
    string,
    { accountId: string; costCenterId?: string; total: number }
  >();

  const add = (accountId: string, costCenterId: string | undefined, amount: number) => {
    const key = `${accountId}::${costCenterId ?? ''}`;
    const existing = grouped.get(key) || { accountId, costCenterId, total: 0 };
    existing.total = round2(existing.total + amount);
    grouped.set(key, existing);
  };

  for (const line of lines) {
    if (line.subtotal <= 0) continue;

    if (line.allocations.length === 0) {
      add(line.accountId, line.defaultCostCenterId ?? undefined, line.subtotal);
      continue;
    }

    for (const part of prorateAmount(line.subtotal, line.allocations)) {
      add(line.accountId, part.costCenterId, part.amount);
    }
  }

  return [...grouped.values()];
}
```

- [ ] **Paso 4: Correr y ver que pasa**

Run: `npx vitest run src/modules/commercial/shared/cost-center.test.ts`
Expected: PASS, todos.

- [ ] **Paso 5: Usarlo en el asiento de compras**

En `integrations/commercial/index.ts`, dentro de `createJournalEntryForPurchaseInvoice`:

- En el `select` de `lines` (`:438`): sacar `costCenterId`, agregar
  `costCenterAllocations: { select: { costCenterId: true, percentage: true } }`.
- Reemplazar el bloque `purchasesByAccount` (`:470-491`) por:

```typescript
    const expanded = expandByCostCenter(
      invoice.lines.map((line) => ({
        accountId: line.product?.defaultExpenseAccountId || settings.purchasesAccountId!,
        subtotal: parseFloat(line.subtotal.toString()),
        allocations: line.costCenterAllocations.map((a) => ({
          costCenterId: a.costCenterId,
          percentage: Number(a.percentage),
        })),
        defaultCostCenterId: line.product?.defaultCostCenterId,
      }))
    );

    const lines: JournalEntryLineInput[] = expanded.map(({ accountId, costCenterId, total: accountTotal }) => ({
      accountId,
      debit: isNC ? 0 : accountTotal,
      credit: isNC ? accountTotal : 0,
      description: `Compras - ${invoice.fullNumber}`,
      ...(costCenterId && { costCenterId }),
    }));
```

El bloque del IVA queda **intacto**: el IVA no se reparte.

- [ ] **Paso 6: Verificar el asiento a mano**

Confirmar una factura con una línea de $1.000 repartida 60/40 y ver el asiento generado.
Expected: dos imputaciones a la cuenta de compras, $600 y $400, cada una con su centro; la
línea de IVA sin centro; el asiento balanceado.

```bash
docker exec contable-pms-db psql -U postgres -d contable_pms -c \
  "SELECT account_id, cost_center_id, debit, credit FROM journal_entry_lines ORDER BY created_at DESC LIMIT 5;"
```

- [ ] **Paso 7: Commit**

```bash
git add src/modules/commercial/shared src/modules/accounting
git commit -m "feat(accounting): asiento de compras con reparto por centro de costo (TSK-583)"
```

---

### Tarea 8: Ventas — reparto en la carga

Espejo de las tareas 5 y 6, sobre facturas de venta. Se repite el detalle en vez de remitir a
las tareas anteriores, porque los archivos y los nombres son distintos.

**Archivos:**
- Modificar: el schema Zod de la línea de venta (buscar con
  `grep -rn "salesInvoiceLineSchema\|invoiceLineSchema" src/modules/commercial/features/sales`)
- Modificar: `src/modules/commercial/features/sales/features/invoices/create/components/_InvoiceForm.tsx`
- Modificar: las actions de create/update/confirm de ventas
  (`find src/modules/commercial/features/sales/features/invoices -name "actions.server.ts"`)

**Interfaces:**
- Consume: `allocationFieldSchema`, `_CostCenterAllocationField` (Tarea 4);
  `findLinesMissingCostCenter`, `buildMissingCostCenterMessage` (Tarea 6);
  `SalesInvoiceLineCostCenter` (Tarea 2).
- Produce: nada nuevo — reusa todo.

- [ ] **Paso 1: Ubicar los puntos exactos a tocar**

```bash
grep -rn "lineSchema" src/modules/commercial/features/sales/features/invoices/
grep -rn "lines: {" src/modules/commercial/features/sales/features/invoices/*/actions.server.ts | head
grep -rn "export async function confirm" src/modules/commercial/features/sales/features/invoices/*/actions.server.ts
```

Anotar archivo y línea de: schema de la línea, creación de líneas, actualización, confirmación.

- [ ] **Paso 2: Agregar el reparto al schema de la línea de venta**

```typescript
  // Reparto por centro de costo. Vacío = centro predeterminado del ítem (TSK-583).
  costCenterAllocations: allocationFieldSchema.default([]),
```

- [ ] **Paso 3: Sumar el editor al formulario de ventas**

En `_InvoiceForm.tsx`, dentro de cada línea, renderizar `_CostCenterAllocationField` con la
misma guarda de entrada que compras, pero mirando la cuenta de **ingresos** del ítem:

```typescript
if (!allowsCostCenter(product?.defaultIncomeAccountType)) return null;
```

Si el producto no expone `defaultIncomeAccountType` en el select actual, ampliarlo en la query
que alimenta el formulario.

- [ ] **Paso 4: Persistir en create y update**

Igual que en compras: escritura anidada `costCenterAllocations: { create: [...] }`, y en el
update borrar el reparto anterior dentro de la misma transacción antes de recrearlo.

- [ ] **Paso 5: Exigir al confirmar**

En la confirmación de ventas, replicar el bloque de la Tarea 6 leyendo
`settings.requireCostCenter` y usando `findLinesMissingCostCenter` +
`buildMissingCostCenterMessage`, con `defaultIncomeAccountType` como `accountType`.

- [ ] **Paso 6: Probar el flujo**

Cargar una factura de venta con un ítem de ingresos repartido 50/50, guardar, reabrir,
confirmar con el switch activo y con el switch apagado.

- [ ] **Paso 7: Commit**

```bash
git add src/modules/commercial/features/sales
git commit -m "feat(sales): reparto por centro de costo en facturas de venta (TSK-583)"
```

---

### Tarea 9: Asiento de ventas y corrección del centro único

**Archivos:**
- Modificar: `src/modules/accounting/features/integrations/commercial/index.ts:269-346`
  (`createJournalEntryForSalesInvoice`)
- Modificar: `src/modules/commercial/shared/cost-center.test.ts` (test de regresión del bug)

**Interfaces:**
- Consume: `expandByCostCenter` (Tarea 7).
- Produce: nada nuevo.

- [ ] **Paso 1: Escribir el test de regresión del bug**

El bug: hoy el asiento de ventas se queda con el **primer** centro que encuentra y descarta
los demás (`index.ts:332`). Agregar en `cost-center.test.ts`:

```typescript
/**
 * Regresión: el asiento de ventas agrupaba solo por cuenta y conservaba el
 * primer centro de costo que encontraba, así que una venta con ítems de centros
 * distintos imputaba todo a uno solo (TSK-583).
 */
describe('venta con ítems de distintos centros (regresión)', () => {
  it('mantiene separada la imputación de cada centro', () => {
    const resultado = expandByCostCenter([
      {
        accountId: CUENTA_SERVICIOS,
        subtotal: 1000,
        allocations: [],
        defaultCostCenterId: LOGISTICA,
      },
      {
        accountId: CUENTA_SERVICIOS,
        subtotal: 500,
        allocations: [],
        defaultCostCenterId: MANTENIMIENTO,
      },
    ]);

    expect(resultado).toEqual([
      { accountId: CUENTA_SERVICIOS, costCenterId: LOGISTICA, total: 1000 },
      { accountId: CUENTA_SERVICIOS, costCenterId: MANTENIMIENTO, total: 500 },
    ]);
  });
});
```

- [ ] **Paso 2: Correr y ver el estado**

Run: `npx vitest run src/modules/commercial/shared/cost-center.test.ts`
Expected: PASS — `expandByCostCenter` ya se comporta bien; el test fija la conducta para que
nadie la revierta. El bug vive en el llamador, no en el helper.

- [ ] **Paso 3: Reemplazar el agrupamiento de ventas**

En `createJournalEntryForSalesInvoice`, sustituir el bloque `salesByAccount` (`:324-346`) por:

```typescript
    const expanded = expandByCostCenter(
      invoice.lines.map((line) => ({
        accountId: line.product?.defaultIncomeAccountId || settings.salesAccountId!,
        subtotal: parseFloat(line.subtotal.toString()),
        allocations: line.costCenterAllocations.map((a) => ({
          costCenterId: a.costCenterId,
          percentage: Number(a.percentage),
        })),
        defaultCostCenterId: line.product?.defaultCostCenterId,
      }))
    );

    for (const { accountId, costCenterId, total: accountTotal } of expanded) {
      lines.push({
        accountId,
        debit: isNC ? accountTotal : 0,
        credit: isNC ? 0 : accountTotal,
        description: `Ventas - ${invoice.fullNumber}`,
        ...(costCenterId && { costCenterId }),
      });
    }
```

Ampliar el `select` de `lines` de la query para traer `costCenterAllocations` y
`product.defaultCostCenterId`.

- [ ] **Paso 4: Verificar el asiento**

Confirmar una venta con dos ítems de centros distintos. Expected: dos imputaciones separadas
a la cuenta de ventas, una por centro. Antes del cambio, todo caía en uno solo.

- [ ] **Paso 5: Correr toda la batería**

Run: `npm test`
Expected: PASS. Anotar el total de tests.

- [ ] **Paso 6: Commit**

```bash
git add src/modules/accounting src/modules/commercial/shared
git commit -m "fix(accounting): el asiento de ventas ya no colapsa los centros de costo (TSK-583)"
```

---

### Tarea 10: Tests de integración contra la base

**Nota sobre un cambio de plan.** Esta tarea pedía originalmente un spec de Cypress. Al llegar
acá se comprobó que **Cypress no existe en este proyecto**: no hay carpeta `cypress/`, ni
scripts `cy:*` en `package.json`, ni ningún `.cy.ts`. El `CLAUDE.md` lo menciona, pero es un
remanente del proyecto base del que este es fork. Montar Cypress entero queda fuera del alcance
de TSK-583, así que la cobertura se hace con **Vitest contra la base local**, que es lo que el
proyecto sí tiene.

Esto además cierra una brecha que señalaron las revisiones de las Tareas 6, 7 y 9: la
verificación del asiento y de la obligatoriedad se venía haciendo con scripts de Prisma que se
borraban al terminar, así que nada en el repo detectaría una regresión.

**Archivos:**
- Crear: `src/modules/accounting/features/integrations/commercial/cost-center.integration.test.ts`

**Interfaces:**
- Consume: `createJournalEntryForPurchaseInvoice`, `createJournalEntryForSalesInvoice`
  (`integrations/commercial/index.ts`), `confirmPurchaseInvoice`
  (`purchases/.../list/actions.server.ts`), el cliente Prisma.
- Produce: nada.

- [ ] **Paso 1: Ver cómo se conecta el proyecto a la base en un test**

```bash
cat prisma.config.ts
grep -rn "PrismaPg\|new PrismaClient" src/shared/lib/prisma.ts
docker exec contable-pms-db psql -U postgres -d contable_pms -c "SELECT 1;"
```

Los tests usan la base de desarrollo. Si no hay base alcanzable, el archivo entero debe
saltearse con `describe.skipIf(...)`, no fallar: alguien que corra `npm test` sin Docker
levantado tiene que seguir viendo la suite en verde.

- [ ] **Paso 2: Escribir el andamiaje de datos**

Un `beforeAll` que cree, con ids fijos y prefijo reconocible (`TSK583-TEST-`): empresa o
reutilización de la existente, dos centros de costo, un ítem imputado a cuenta de egresos, un
ítem imputado a cuenta de ingresos, y las cuentas contables mínimas que
`createJournalEntryFor*` necesita (`payables`, `purchases`, `receivables`, `sales`,
`vatCredit`, `vatDebit`).

Un `afterAll` que borre **todo** lo creado, en orden inverso de dependencias. Verificá al final
que no queda ninguna fila con el prefijo.

- [ ] **Paso 3: Escribir los tests**

Cinco casos, todos contra la base real:

1. **Compra con reparto 60/40** — una línea de $1.000 a cuenta de egresos, repartida entre dos
   centros. El asiento tiene dos imputaciones a la cuenta de compras, de $600 y $400, cada una
   con su centro.
2. **El IVA no se reparte** — en ese mismo asiento, la línea de IVA no tiene centro de costo.
3. **El asiento balancea** — suma de débitos igual a suma de créditos.
4. **Venta con ítems de centros distintos (regresión del bug)** — dos líneas con centros
   predeterminados distintos generan **dos** imputaciones separadas a la cuenta de ventas. Antes
   de la Tarea 9 caían en una sola.
5. **Obligatoriedad** — con `requireCostCenter = true`, confirmar una factura de compra con una
   línea de egresos sin reparto falla con el mensaje que nombra la línea; con el flag en
   `false`, la misma factura confirma. Dejá el flag como estaba al terminar.

- [ ] **Paso 4: Correr los tests**

Run: `npx vitest run src/modules/accounting/features/integrations/commercial/cost-center.integration.test.ts`
Expected: PASS los cinco.

- [ ] **Paso 5: Correr la suite completa y verificar que la base quedó limpia**

```bash
npm test
docker exec contable-pms-db psql -U postgres -d contable_pms -c "SELECT count(*) FROM cost_centers WHERE name LIKE 'TSK583-TEST-%';"
```

Expected: la suite en verde y el conteo en 0.

- [ ] **Paso 6: Commit**

```bash
git add src/modules/accounting/features/integrations/commercial/cost-center.integration.test.ts
git commit -m "test(accounting): integracion del reparto por centro de costo (TSK-583)"
```

---

### Tarea 11: Documentación y guía de presentación en PDF

**Archivos:**
- Modificar: la guía in-app correspondiente en `src/modules/help/features/guide/components/`
- Modificar: `docs/` — modelo de datos y criterio de prorrateo
- Crear: `scripts/guia-presentacion/generar-pdf.mjs`
- Crear: `scripts/guia-presentacion/tsk-583.html`
- Crear: `docs/presentaciones/TSK-583-centros-de-costo.pdf` (generado)

**Interfaces:**
- Consume: la feature terminada.
- Produce: `node scripts/guia-presentacion/generar-pdf.mjs <archivo.html> <salida.pdf>`,
  reutilizable por los próximos tickets.

- [ ] **Paso 1: Actualizar la guía de usuario in-app**

```bash
ls src/modules/help/features/guide/components/
```

En la guía del módulo comercial: cómo repartir una línea entre varios centros, que el reparto
debe sumar 100%, y qué implica el switch de obligatoriedad. Regla 10 del CLAUDE.md.

- [ ] **Paso 2: Actualizar la documentación técnica**

En `docs/architecture/data-model.md`: las dos tablas nuevas y el flag. En la documentación del
módulo contable: que el asiento agrupa por cuenta + centro y que el último centro absorbe el
redondeo.

- [ ] **Paso 3: Escribir el script de PDF**

Crear `scripts/guia-presentacion/generar-pdf.mjs`:

```javascript
/**
 * Convierte una guía de presentación en HTML a PDF.
 *
 * Uso: node scripts/guia-presentacion/generar-pdf.mjs entrada.html salida.pdf
 *
 * Usa Playwright, que ya es dependencia del proyecto. Queda reutilizable para
 * las guías de los próximos tickets.
 */
import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const [input, output] = process.argv.slice(2);

if (!input || !output) {
  console.error('Uso: node generar-pdf.mjs <entrada.html> <salida.pdf>');
  process.exit(1);
}

const browser = await chromium.launch();
const page = await browser.newPage();

await page.goto(pathToFileURL(resolve(input)).href, { waitUntil: 'networkidle' });
await page.pdf({
  path: resolve(output),
  format: 'A4',
  printBackground: true,
  margin: { top: '18mm', bottom: '18mm', left: '15mm', right: '15mm' },
});

await browser.close();
console.log(`PDF generado en ${output}`);
```

- [ ] **Paso 4: Tomar las capturas**

Con `npm run dev` corriendo y datos de ejemplo cargados, capturar: el switch en Configuración
Contable, una línea con el reparto 60/40 y su pie en verde, el error al confirmar sin reparto,
y el asiento resultante con las dos imputaciones. Guardarlas junto al HTML e incrustarlas como
`data:` URI o por ruta relativa.

- [ ] **Paso 5: Escribir la guía**

Crear `scripts/guia-presentacion/tsk-583.html` con la estructura fijada en el spec (sección 9):

1. **Qué pedías** — la cita textual de la reapertura.
2. **Qué cambió** — antes: un centro por línea, elegido de una lista; ahora: reparto por
   porcentaje entre los centros que hagan falta.
3. **Cómo se usa** — el ejemplo de la factura de servicios repartida entre dos centros:
   cargar, repartir 60/40, confirmar, ver el asiento con las dos imputaciones.
4. **Qué hay que configurar** — el switch "Exigir centro de costo", y qué pasa con él apagado.
5. **Qué no cambió** — las facturas ya confirmadas no se tocan; el IVA no se reparte porque no
   es cuenta de resultado; comprar un activo sigue sin pedir centro de costo.
6. **Aviso** — en las ventas, una factura con ítems de centros distintos antes imputaba todo a
   uno solo; ahora imputa a cada uno. Los asientos nuevos van a verse distintos de los viejos.

- [ ] **Paso 6: Generar el PDF y revisarlo**

```bash
mkdir -p docs/presentaciones
node scripts/guia-presentacion/generar-pdf.mjs \
  scripts/guia-presentacion/tsk-583.html \
  docs/presentaciones/TSK-583-centros-de-costo.pdf
```

Abrirlo y verificar que las capturas se ven y que no hay cortes de página en medio de un paso.

- [ ] **Paso 7: Commit**

```bash
git add src/modules/help docs scripts/guia-presentacion
git commit -m "docs: guia de usuario y guia de presentacion del reparto por centro de costo (TSK-583)"
```

---

## Cierre

Antes de dar el ticket por entregado:

- [ ] `npm test` en verde; anotar cuántos tests corren.
- [ ] Los tests de integración de la Tarea 10 en verde con la base levantada.
- [ ] `npx tsc --noEmit` sin errores nuevos respecto de la línea base (227 al empezar).
- [ ] `npm run lint` sin hallazgos nuevos respecto de la línea base (339 al empezar).
- [ ] `npm run build` con exit 0.
- [ ] Actualizar en cc-tickets el ticket 583: `analysis_notes` con por qué se reabrió y
      `completion_summary` con lo entregado, mencionando **la migración de base de datos** que
      hay que aplicar en el deploy.
- [ ] Adjuntar el PDF de la guía de presentación.
