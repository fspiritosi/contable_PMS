# TSK-585 parte A — Plan de implementación: conceptos en el movimiento de fondos

> **Para quien ejecute esto:** usar `superpowers:subagent-driven-development` (recomendado) o
> `superpowers:executing-plans` para implementar tarea por tarea. Los pasos usan checkbox
> (`- [ ]`) para seguimiento.

**Objetivo:** Que el débito bancario del mes se cargue como un solo movimiento de fondos
desglosado en conceptos, cada uno imputado a su cuenta contable.

**Arquitectura:** Un tipo nuevo de movimiento (`BANK_CHARGES`) con líneas. El total del
movimiento pasa a ser la suma de las líneas, calculada en el servidor. Al confirmar, el asiento
tiene N+1 líneas: un débito por concepto y un crédito por el total al banco. Eso obliga a
generalizar la función que hoy arma asientos de exactamente dos líneas, **sin cambiar el
comportamiento de los tres tipos que ya existen**.

**Stack:** Next.js 16 (App Router, Server Actions), Prisma 7 + PostgreSQL, React Hook Form + Zod,
shadcn/ui, Vitest.

**Spec:** `.planes/tsk-585a-conceptos-en-movimientos-de-fondos.md`

## Restricciones globales

- **Sin `:any`.** Los tipos se infieren de Prisma o de Zod.
- **`logger`, nunca `console.*`.**
- **Decimal de Prisma → `Number()`** antes de devolver a Client Components.
- **Client Components con prefijo `_`**; Server Components por defecto.
- **`checkPermission()`** al inicio de cada server action, con
  `commercial.treasury.fund-movements` — los mismos permisos que ya usa el módulo.
- **Nada de `confirm()` / `alert()`** — `AlertDialog` de shadcn/ui.
- **Las fechas se guardan con `parseFundMovementDate` y se leen con `formatFundMovementDate`**,
  que anclan al mediodía UTC. Usar `moment(...)` local corre el día (regresión del TSK-483,
  documentada en `validators.test.ts`).
- **Importes con `MoneyInput` al escribir y `formatCurrency` al mostrar** (TSK-580).
- **Cuentas con `AccountCombobox`**, que busca por código y nombre (TSK-464).
- **Las cuentas de las líneas son imputables (hoja, activas) y de tipo egreso o activo.** Pasivo
  y patrimonio quedan fuera.
- Los textos visibles al usuario van en español, con tildes.

**Línea base al empezar:** `tsc --noEmit` **226** errores (preexistentes; el conteo tiene ±1 de
ruido propio por los genéricos de `ColumnDef`, así que no lo tomes como número exacto),
**168** tests, build en verde.

---

### Tarea 1: Helper de líneas

Suma y validación, en funciones puras sin base de datos. Es la base de las tareas siguientes y
lo único con aritmética.

**Archivos:**
- Crear: `src/modules/commercial/features/treasury/features/fund-movements/shared/lines-calc.ts`
- Crear: `src/modules/commercial/features/treasury/features/fund-movements/shared/lines-calc.test.ts`

**Interfaces:**
- Consume: nada.
- Produce:
  - `interface FundMovementLineInput { accountId: string; description: string; amount: string }`
  - `sumLines(lines: FundMovementLineInput[]): number`
  - `type LineError = 'NO_LINES' | 'MISSING_ACCOUNT' | 'MISSING_DESCRIPTION' | 'NON_POSITIVE_AMOUNT'`
  - `validateLines(lines: FundMovementLineInput[]): { index: number; error: LineError } | null`
  - `LINE_ERROR_MESSAGES: Record<LineError, string>`

- [ ] **Paso 1: Escribir los tests**

Crear `lines-calc.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';

import { sumLines, validateLines, type FundMovementLineInput } from './lines-calc';

const CUENTA_A = '11111111-1111-4111-8111-111111111111';
const CUENTA_B = '22222222-2222-4222-8222-222222222222';

const linea = (over: Partial<FundMovementLineInput> = {}): FundMovementLineInput => ({
  accountId: CUENTA_A,
  description: 'Sircreb IIBB',
  amount: '100.00',
  ...over,
});

describe('suma de los conceptos', () => {
  it('suma las líneas con centavos sin arrastrar error de punto flotante', () => {
    const lineas = [
      linea({ amount: '302574.16' }),
      linea({ amount: '1434154.28', accountId: CUENTA_B }),
    ];

    // El caso real del ticket: 302.574,16 + 1.434.154,28 = 1.736.728,44
    expect(sumLines(lineas)).toBe(1736728.44);
  });

  it('una sola línea suma su propio importe', () => {
    expect(sumLines([linea({ amount: '1500.5' })])).toBe(1500.5);
  });

  it('sin líneas la suma es cero', () => {
    expect(sumLines([])).toBe(0);
  });
});

describe('validación de los conceptos', () => {
  it('acepta líneas completas', () => {
    expect(validateLines([linea(), linea({ accountId: CUENTA_B })])).toBeNull();
  });

  it('exige al menos una línea', () => {
    expect(validateLines([])).toEqual({ index: -1, error: 'NO_LINES' });
  });

  it('exige cuenta, y dice en qué línea falta', () => {
    expect(validateLines([linea(), linea({ accountId: '' })])).toEqual({
      index: 1,
      error: 'MISSING_ACCOUNT',
    });
  });

  it('exige descripción', () => {
    expect(validateLines([linea({ description: '' })])).toEqual({
      index: 0,
      error: 'MISSING_DESCRIPTION',
    });
  });

  it('exige importe mayor a cero', () => {
    expect(validateLines([linea({ amount: '0' })])).toEqual({
      index: 0,
      error: 'NON_POSITIVE_AMOUNT',
    });
  });

  it('rechaza un importe negativo: una devolución del banco no es una línea negativa', () => {
    expect(validateLines([linea({ amount: '-50' })])).toEqual({
      index: 0,
      error: 'NON_POSITIVE_AMOUNT',
    });
  });

  it('devuelve el primer problema, no todos', () => {
    const resultado = validateLines([linea({ description: '' }), linea({ accountId: '' })]);

    expect(resultado).toEqual({ index: 0, error: 'MISSING_DESCRIPTION' });
  });
});
```

- [ ] **Paso 2: Correr los tests y verificar que fallan**

Run: `npx vitest run src/modules/commercial/features/treasury/features/fund-movements/shared/lines-calc.test.ts`
Expected: FAIL — el módulo no existe.

- [ ] **Paso 3: Implementar**

Crear `lines-calc.ts`:

```typescript
/**
 * Conceptos de un movimiento de gastos e impuestos bancarios (TSK-585).
 *
 * Funciones puras: la suma y la validación se testean sin base ni formulario.
 * El total del movimiento sale de acá y no de lo que mande el cliente.
 */

/** Un concepto tal como llega del formulario: el importe viaja como texto. */
export interface FundMovementLineInput {
  accountId: string;
  description: string;
  amount: string;
}

/** Redondeo a 2 decimales, evitando el arrastre binario de 0.1 + 0.2. */
function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** Total del movimiento: la suma de sus conceptos. */
export function sumLines(lines: FundMovementLineInput[]): number {
  return round2(lines.reduce((total, line) => total + (parseFloat(line.amount) || 0), 0));
}

export type LineError =
  | 'NO_LINES'
  | 'MISSING_ACCOUNT'
  | 'MISSING_DESCRIPTION'
  | 'NON_POSITIVE_AMOUNT';

/** Mensajes para el usuario, en un solo lugar para el formulario y el server action. */
export const LINE_ERROR_MESSAGES: Record<LineError, string> = {
  NO_LINES: 'Agregá al menos un concepto',
  MISSING_ACCOUNT: 'Elegí la cuenta contable del concepto',
  MISSING_DESCRIPTION: 'Escribí una descripción para el concepto',
  NON_POSITIVE_AMOUNT: 'El importe del concepto debe ser mayor a 0',
};

/**
 * El primer problema que encuentra, con el índice de la línea que lo tiene.
 * Devuelve `index: -1` cuando el problema es que no hay ninguna línea.
 */
export function validateLines(
  lines: FundMovementLineInput[]
): { index: number; error: LineError } | null {
  if (lines.length === 0) return { index: -1, error: 'NO_LINES' };

  for (const [index, line] of lines.entries()) {
    if (!line.accountId) return { index, error: 'MISSING_ACCOUNT' };
    if (!line.description.trim()) return { index, error: 'MISSING_DESCRIPTION' };
    if (!(parseFloat(line.amount) > 0)) return { index, error: 'NON_POSITIVE_AMOUNT' };
  }

  return null;
}
```

- [ ] **Paso 4: Correr los tests y verificar que pasan**

Run: `npx vitest run src/modules/commercial/features/treasury/features/fund-movements/shared/lines-calc.test.ts`
Expected: PASS, los 10.

- [ ] **Paso 5: Commit**

```bash
git add src/modules/commercial/features/treasury/features/fund-movements/shared/
git commit -m "feat(treasury): helper de conceptos del movimiento de fondos (TSK-585)"
```

---

### Tarea 2: Modelo de datos y migración

**Archivos:**
- Modificar: `prisma/schema.prisma`
- Crear: `prisma/migrations/<timestamp>_fund_movement_lines/migration.sql`

**Interfaces:**
- Consume: nada.
- Produce: el valor `BANK_CHARGES` en `FundMovementType` y el modelo `FundMovementLine`.

- [ ] **Paso 1: Editar el schema**

En el enum `FundMovementType` (alrededor de la línea 4285), agregar el valor **al final**:

```prisma
  BANK_CHARGES // Gastos e impuestos bancarios: débito del banco desglosado en conceptos (TSK-585)
```

Y el modelo nuevo, después de `FundMovement`:

```prisma
/// Un concepto dentro de un movimiento de gastos e impuestos bancarios (TSK-585).
model FundMovementLine {
  id          String  @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  movementId  String  @map("movement_id") @db.Uuid
  accountId   String  @map("account_id") @db.Uuid
  description String
  amount      Decimal @db.Decimal(15, 2)
  /// Orden de carga, para mostrarlos como los escribió el usuario.
  position    Int

  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  movement FundMovement @relation(fields: [movementId], references: [id], onDelete: Cascade)
  account  Account      @relation(fields: [accountId], references: [id])

  @@index([movementId])
  @@map("fund_movement_lines")
}
```

Agregar además la relación inversa `lines FundMovementLine[]` en `FundMovement`, y
`fundMovementLines FundMovementLine[]` en `Account`.

- [ ] **Paso 2: Crear y aplicar la migración**

```bash
npx prisma migrate dev --name fund_movement_lines
npx prisma generate
```

- [ ] **Paso 3: Verificar contra la base**

```bash
docker exec contable-pms-db psql -U postgres -d contable_pms -c "\d fund_movement_lines"
docker exec contable-pms-db psql -U postgres -d contable_pms -c "SELECT unnest(enum_range(NULL::fund_movement_type));"
```

Expected: la tabla con `amount numeric(15,2)`, la FK a `fund_movements` en cascada y la FK a
`accounts` sin cascada; el enum con los cuatro valores, `BANK_CHARGES` incluido.

- [ ] **Paso 4: Verificar que no rompió nada**

Run: `npm test`
Expected: 168 tests en verde. Esta tarea solo agrega modelo, no toca lógica.

- [ ] **Paso 5: Commit**

```bash
git add prisma/
git commit -m "feat(db): conceptos del movimiento de fondos y tipo gastos bancarios (TSK-585)"
```

---

### Tarea 3: Validación del formulario

**Archivos:**
- Modificar: `.../fund-movements/shared/validators.ts:24-36` (tipos y etiquetas) y `:55-114` (schema)
- Modificar: `.../fund-movements/shared/validators.test.ts`

**Interfaces:**
- Consume: `validateLines`, `LINE_ERROR_MESSAGES`, `FundMovementLineInput` (Tarea 1).
- Produce: `FUND_MOVEMENT_TYPES` con `'BANK_CHARGES'`, su etiqueta
  `'Gastos e impuestos bancarios'`, y `fundMovementSchema` aceptando `lines`.

- [ ] **Paso 1: Escribir los tests**

Agregar al final de `validators.test.ts`:

```typescript
import { FUND_MOVEMENT_TYPE_LABELS } from './validators';

const uuidCuenta = '11111111-1111-4111-8111-111111111111';
const uuidBanco = '33333333-3333-4333-8333-333333333333';

const gastosBancarios = {
  type: 'BANK_CHARGES' as const,
  date: '2026-07-31',
  amount: '0',
  description: 'Gastos e impuestos de julio',
  sourceFund: `BANK:${uuidBanco}`,
  destinationFund: '',
  partnerId: '',
  lines: [
    { accountId: uuidCuenta, description: 'Sircreb IIBB', amount: '302574.16' },
    { accountId: uuidCuenta, description: 'Impuesto a los débitos', amount: '1434154.28' },
  ],
};

describe('gastos e impuestos bancarios (TSK-585)', () => {
  it('está entre los tipos disponibles, con su etiqueta', () => {
    expect(FUND_MOVEMENT_TYPE_LABELS.BANK_CHARGES).toBe('Gastos e impuestos bancarios');
  });

  it('acepta un movimiento con conceptos y origen', () => {
    expect(fundMovementSchema.safeParse(gastosBancarios).success).toBe(true);
  });

  it('exige el banco o caja de donde sale la plata', () => {
    const result = fundMovementSchema.safeParse({ ...gastosBancarios, sourceFund: '' });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['sourceFund']);
  });

  it('exige al menos un concepto', () => {
    const result = fundMovementSchema.safeParse({ ...gastosBancarios, lines: [] });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe('Agregá al menos un concepto');
  });

  it('señala el concepto sin cuenta', () => {
    const result = fundMovementSchema.safeParse({
      ...gastosBancarios,
      lines: [gastosBancarios.lines[0], { accountId: '', description: 'X', amount: '10' }],
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe('Elegí la cuenta contable del concepto');
  });
});

describe('los tipos que ya existían no piden conceptos (regresión TSK-585)', () => {
  const aporte = {
    type: 'PARTNER_CONTRIBUTION' as const,
    date: '2026-07-31',
    amount: '1000.00',
    description: 'Aporte del socio',
    sourceFund: '',
    destinationFund: `BANK:${uuidBanco}`,
    partnerId: '',
  };

  it('un aporte sigue siendo válido sin líneas', () => {
    expect(fundMovementSchema.safeParse(aporte).success).toBe(true);
  });

  it('una transferencia sigue siendo válida sin líneas', () => {
    const transferencia = {
      ...aporte,
      type: 'ACCOUNT_TRANSFER' as const,
      sourceFund: `BANK:${uuidBanco}`,
      destinationFund: `CASH:${uuidCuenta}`,
    };

    expect(fundMovementSchema.safeParse(transferencia).success).toBe(true);
  });
});
```

- [ ] **Paso 2: Correr y ver que falla**

Run: `npx vitest run src/modules/commercial/features/treasury/features/fund-movements/shared/validators.test.ts`
Expected: FAIL — `BANK_CHARGES` no está entre los tipos.

- [ ] **Paso 3: Implementar**

En `validators.ts`:

```typescript
export const FUND_MOVEMENT_TYPES = [
  'PARTNER_CONTRIBUTION',
  'PARTNER_WITHDRAWAL',
  'ACCOUNT_TRANSFER',
  'BANK_CHARGES',
] as const;

export const FUND_MOVEMENT_TYPE_LABELS: Record<FundMovementTypeValue, string> = {
  PARTNER_CONTRIBUTION: 'Aporte de socio',
  PARTNER_WITHDRAWAL: 'Retiro de socio',
  ACCOUNT_TRANSFER: 'Transferencia entre cuentas',
  BANK_CHARGES: 'Gastos e impuestos bancarios',
};
```

En el objeto del schema, agregar el campo de líneas:

```typescript
    // Conceptos del débito bancario. Solo los usa BANK_CHARGES (TSK-585).
    lines: z
      .array(
        z.object({
          accountId: z.string(),
          description: z.string(),
          amount: z.string(),
        })
      )
      .default([]),
```

Y en el `superRefine`, una rama más **al final del if/else**, sin tocar las existentes:

```typescript
    } else if (data.type === 'BANK_CHARGES') {
      if (!validRef(data.sourceFund)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['sourceFund'],
          message: 'Seleccioná el banco o caja de donde salen los fondos',
        });
      }

      const problema = validateLines(data.lines);
      if (problema) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: problema.index === -1 ? ['lines'] : ['lines', problema.index],
          message: LINE_ERROR_MESSAGES[problema.error],
        });
      }
    }
```

**El punto delicado de esta tarea**: el campo `amount` del movimiento hoy exige ser mayor a
cero (`:59-63`). Para `BANK_CHARGES` el formulario manda `'0'` porque el total lo calcula el
servidor desde las líneas (Tarea 4), así que esa regla lo rechazaría.

La solución NO es aflojar el campo para todos. Sacá el `.refine()` del campo y movelo al
`superRefine`, condicionado por tipo:

```typescript
    amount: z
      .string()
      .min(1, 'El monto es requerido')
      .regex(amountRegex, 'Monto inválido (hasta 2 decimales)'),
```

y como **primera** comprobación del `superRefine`, antes del if/else de tipos:

```typescript
    // El total de los gastos bancarios lo calcula el servidor sumando los
    // conceptos, así que el formulario manda 0 y este campo no aplica (TSK-585).
    if (data.type !== 'BANK_CHARGES' && !(parseFloat(data.amount) > 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['amount'],
        message: 'El monto debe ser mayor a 0',
      });
    }
```

El mensaje es el mismo de antes, así que los tests existentes que lo esperan siguen pasando.
Verificá eso: si algún test de los tipos viejos falla acá, el movimiento de la validación cambió
algo que no debía.

- [ ] **Paso 4: Correr y ver que pasa**

Run: `npx vitest run src/modules/commercial/features/treasury/features/fund-movements/shared/validators.test.ts`
Expected: PASS, incluidos los de regresión de los tipos viejos.

- [ ] **Paso 5: Commit**

```bash
git add src/modules/commercial/features/treasury/features/fund-movements/shared/
git commit -m "feat(treasury): validacion de conceptos en el movimiento de fondos (TSK-585)"
```

---

### Tarea 4: Persistencia y asiento N+1

El corazón de la entrega, y donde vive el riesgo: hay que generalizar la función del asiento sin
alterar los tres tipos que ya funcionan.

**Archivos:**
- Modificar: `.../fund-movements/list/actions.server.ts` — `createJournalEntryForFundMovement`
  (línea ~270), `createFundMovement` (~325), la edición en borrador, y el bloque de confirmación
  (~484-560)

**Interfaces:**
- Consume: `sumLines`, `validateLines` (Tarea 1); el modelo `FundMovementLine` (Tarea 2); el
  schema con `lines` (Tarea 3).
- Produce: `createJournalEntryForFundMovement` con una firma que acepta N líneas.

- [ ] **Paso 1: Generalizar la función del asiento**

Hoy recibe `debitAccountId` y `creditAccountId` y arma dos líneas. Cambiala para que reciba las
líneas ya armadas:

```typescript
async function createJournalEntryForFundMovement(
  input: {
    companyId: string;
    date: Date;
    description: string;
    /** Líneas del asiento, ya balanceadas: la suma de débitos debe igualar la de créditos. */
    lines: Array<{ accountId: string; debit: number; credit: number; description: string }>;
  },
  tx: PrismaTransactionClient
) {
```

y que las escriba tal cual, en vez de construir las dos a mano.

**Los tres llamadores existentes pasan a armar sus dos líneas** en el punto de llamada:

```typescript
      lines: [
        { accountId: debitAccountId, debit: amountNumber, credit: 0, description: movement.description },
        { accountId: creditAccountId, debit: 0, credit: amountNumber, description: movement.description },
      ],
```

El comportamiento tiene que quedar idéntico: mismas cuentas, mismos importes, mismo orden.

- [ ] **Paso 2: Guardar y editar las líneas en borrador**

En `createFundMovement`, cuando el tipo es `BANK_CHARGES`:
- El `amount` que se guarda es `sumLines(data.lines)`, **no** el que mandó el formulario.
- Las líneas se crean anidadas, con `position` según el orden del array.

En la edición en borrador, borrar las líneas anteriores y recrearlas dentro de la misma
transacción, igual que hace el resto del sistema con las líneas de una factura.

- [ ] **Paso 3: Armar el asiento del tipo nuevo**

En el bloque de confirmación, agregar la rama de `BANK_CHARGES` al if/else de tipos. A
diferencia de los otros, no resuelve un `debitAccountId` único:

- Mueve el saldo del origen con `applyFundSide(tx, { kind: movement.fundOutKind, id: movement.fundOutId }, 'OUT', sideCtx)`, igual que un retiro.
- Arma **una línea de asiento por cada concepto** (débito a la cuenta de la línea, con la
  descripción del concepto) más **una línea de crédito** por el total, a la cuenta del origen.

El total del crédito tiene que ser exactamente la suma de los débitos: usá el `amount` guardado
del movimiento, que ya es esa suma.

- [ ] **Paso 4: Verificar contra la base**

Con un script de Prisma, crear un movimiento `BANK_CHARGES` con dos conceptos ($302.574,16 y
$1.434.154,28), confirmarlo y comprobar:

```bash
docker exec contable-pms-db psql -U postgres -d contable_pms -c \
  "SELECT jel.debit, jel.credit, a.code FROM journal_entry_lines jel JOIN accounts a ON a.id = jel.account_id ORDER BY jel.created_at DESC LIMIT 5;"
```

Expected: tres líneas — dos débitos de 302574.16 y 1434154.28, y un crédito de 1736728.44 a la
cuenta del banco. La suma de débitos igual a la de créditos.

**Y el chequeo que importa igual o más**: confirmar también un aporte de socio y una
transferencia, y verificar que sus asientos siguen teniendo exactamente dos líneas con las
mismas cuentas que antes.

Limpiá los datos de prueba y confirmalo con SQL.

- [ ] **Paso 5: Verificar tipos y tests**

Run: `npx tsc --noEmit 2>&1 | grep -c "error TS"` y `npm test`
Expected: sin errores nuevos respecto de 226 (±1 de ruido), y los tests en verde.

- [ ] **Paso 6: Commit**

```bash
git add src/modules/commercial/features/treasury/features/fund-movements/
git commit -m "feat(treasury): asiento con un debito por concepto en gastos bancarios (TSK-585)"
```

---

### Tarea 5: Tabla de conceptos en el formulario

**Archivos:**
- Crear: `.../fund-movements/list/components/_FundMovementLinesField.tsx`
- Modificar: `.../fund-movements/list/components/_CreateFundMovementModal.tsx` (línea ~126, donde
  se derivan `isContribution`/`isWithdrawal`/`isTransfer`; y el bloque de campos, ~250-330)

**Interfaces:**
- Consume: `sumLines` (Tarea 1); el schema con `lines` (Tarea 3).
- Produce: el componente `_FundMovementLinesField` con props
  `{ accounts: AccountOption[] }`, que opera sobre el campo `lines` del formulario.

- [ ] **Paso 1: Mirar los patrones que hay que seguir**

```bash
sed -n '120,135p' src/modules/commercial/features/treasury/features/fund-movements/list/components/_CreateFundMovementModal.tsx
cat src/modules/commercial/shared/components/_CostCenterAllocationField.tsx
```

El primero muestra cómo el modal deriva banderas por tipo; el segundo es un campo de líneas con
`useFieldArray` ya construido en este proyecto (del TSK-583), con su pie de totales. Seguí ese
patrón, no inventes uno nuevo.

- [ ] **Paso 2: Implementar el componente**

Client Component (`'use client'`), con `useFieldArray` sobre `lines`. Cada fila:

- **Cuenta**: `AccountCombobox` de `@/shared/components/common/AccountCombobox`, con las cuentas
  que recibe por props (ya filtradas por el servidor).
- **Descripción**: `Input` de texto.
- **Importe**: `MoneyInput` de `@/shared/components/ui/money-input`.
- Botón de quitar la fila.

Abajo, el botón **"+ Agregar concepto"** y un pie con el **Total** calculado con `sumLines`,
formateado con `formatCurrency`. Con cero líneas, el texto **"Agregá al menos un concepto"**.

- [ ] **Paso 3: Conectarlo al modal**

En `_CreateFundMovementModal.tsx`, junto a las banderas existentes:

```typescript
  const isBankCharges = type === 'BANK_CHARGES';
```

Con ese tipo elegido: **ocultar** el campo de importe y el de fondo de destino, y **mostrar** la
tabla de conceptos. Los otros tres tipos no cambian en nada.

Las cuentas se cargan con React Query (**nunca** `useEffect` + `useState`), desde un server
action que las filtre a **imputables de tipo egreso o activo**. Fijate si ya existe uno que
sirva antes de escribir otro: `grep -rn "buildImputableAccountsWhere" --include="*.ts" src/`.

- [ ] **Paso 4: Verificar el flujo en el navegador**

```bash
npm run dev
```

Cargar un movimiento de gastos bancarios con dos conceptos, ver que el total del pie es la suma,
guardarlo como borrador, reabrirlo y comprobar que los conceptos vuelven. Después confirmarlo y
mirar el asiento.

**Ojo con el puerto**: si el 3000 está ocupado, usá otro y levantá con `NEXT_PUBLIC_APP_URL`
apuntando al mismo puerto. **No mates procesos de otras sesiones**; si el lock de `.next` está
tomado, decilo en el reporte en vez de forzarlo.

- [ ] **Paso 5: Commit**

```bash
git add src/modules/commercial/features/treasury/features/fund-movements/
git commit -m "feat(treasury): tabla de conceptos en el movimiento de fondos (TSK-585)"
```

---

### Tarea 6: Tests de integración

**Archivos:**
- Crear: `.../fund-movements/list/fund-movement-lines.integration.test.ts`

**Interfaces:**
- Consume: todo lo anterior.
- Produce: nada.

- [ ] **Paso 1: Mirar el molde**

```bash
cat src/modules/accounting/features/integrations/commercial/cost-center.integration.test.ts
```

De ahí salen el `describe.skipIf` cuando no hay base, los datos con prefijo propio y la limpieza
en `afterAll`. Seguilo.

- [ ] **Paso 2: Escribir los tests**

Prefijo de datos: `TSK585-TEST-`. Cuatro casos:

1. **El asiento del tipo nuevo tiene N+1 líneas y balancea** — dos conceptos de $302.574,16 y
   $1.434.154,28: dos débitos a sus cuentas y un crédito de $1.736.728,44 al banco; suma de
   débitos igual a suma de créditos.
2. **Regresión de los tipos existentes** — un aporte de socio y una transferencia generan
   asientos de **exactamente dos líneas**, con las mismas cuentas que antes del cambio. Es el
   riesgo principal de esta entrega.
3. **El total se calcula en el servidor** — mandar un `amount` distinto de la suma de las líneas
   y verificar que se guarda la suma, no lo que llegó.
4. **El borrador guarda y relee sus conceptos**, con su orden.

Como los server actions no corren fuera de un request de Next (usan `checkPermission` y sesión),
vas a tener que replicar su secuencia. **Decilo en un comentario del propio test y en el
reporte**: protege el cálculo y la persistencia, no que el action siga usándolos.

- [ ] **Paso 3: Correr**

Run: `npx vitest run src/modules/commercial/features/treasury/features/fund-movements/list/fund-movement-lines.integration.test.ts`
Expected: PASS los 4.

- [ ] **Paso 4: Verificar la limpieza y el skip**

```bash
npm test
docker exec contable-pms-db psql -U postgres -d contable_pms -c \
  "SELECT count(*) FROM fund_movements WHERE description LIKE 'TSK585-TEST-%';"
```

Expected: suite en verde y conteo en 0. Probá además parar el contenedor y correr `npm test`: el
archivo tiene que saltearse, no fallar.

- [ ] **Paso 5: Commit**

```bash
git add src/modules/commercial/features/treasury/features/fund-movements/
git commit -m "test(treasury): integracion de los conceptos del movimiento de fondos (TSK-585)"
```

---

### Tarea 7: Documentación

**Archivos:**
- Modificar: la guía correspondiente en `src/modules/help/features/guide/components/`
- Modificar: `docs/architecture/data-model.md`
- Crear: `scripts/guia-presentacion/tsk-585.html`
- Crear: `docs/presentaciones/TSK-585-gastos-bancarios.pdf`

- [ ] **Paso 1: Guía de usuario in-app**

En la guía de tesorería: cómo cargar el débito del mes con sus conceptos, y que cada concepto va
a su cuenta contable.

**Lo más importante de esta guía es aclarar cuándo usar cada cosa**, que es la confusión más
probable: los gastos bancarios **con IVA** se cargan como comprobante de compra con el tipo
"Gastos Bancarios" (la parte B de este ticket, ya entregada), y los impuestos y retenciones
**sin IVA** como movimiento de fondos (esta parte).

- [ ] **Paso 2: Documentación técnica**

En `docs/architecture/data-model.md`: el modelo `FundMovementLine`, el tipo nuevo, y que el
asiento de este tipo tiene N+1 líneas mientras los otros tres siguen con dos.

- [ ] **Paso 3: Guía de presentación en PDF**

Con capturas reales, siguiendo la estructura de las anteriores (mirá `tsk-621.html` como
referencia de formato): qué pedía, qué cambió, cómo se usa con el ejemplo del ticket (Sircreb e
impuesto a los débitos), y **la aclaración de cuándo va cada una de las dos formas**.

```bash
node scripts/guia-presentacion/generar-pdf.mjs \
  scripts/guia-presentacion/tsk-585.html \
  docs/presentaciones/TSK-585-gastos-bancarios.pdf
```

- [ ] **Paso 4: Commit**

```bash
git add src/modules/help docs scripts/guia-presentacion
git commit -m "docs: guia de usuario y de presentacion de los gastos bancarios (TSK-585)"
```

---

## Cierre

- [ ] `npm test` en verde; anotar el total.
- [ ] `npx tsc --noEmit` sin errores nuevos respecto de 226 (el conteo tiene ±1 de ruido propio).
- [ ] `npm run lint` sin hallazgos nuevos.
- [ ] `npm run build` con exit 0.
- [ ] Actualizar el ticket 585 en cc-tickets con las **dos partes**: el comprobante de compra
      (entregado en `feat/tsk-585-gastos-bancarios`) y los conceptos del movimiento de fondos,
      mencionando la **migración de base de datos** que hay que aplicar en el deploy.
- [ ] Adjuntar el PDF de la guía de presentación.
