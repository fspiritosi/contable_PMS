# Estandares de Codigo

---

## TypeScript

### Tipos desde Prisma/Zod, NUNCA manuales

```typescript
// Desde Prisma (enums)
import { Gender, VoucherType } from '@/generated/prisma/enums';

// Desde Prisma (tipos inferidos de queries)
type GetItemsResult = Awaited<ReturnType<typeof getItems>>;
type Item = GetItemsResult[number];

// Desde Zod (formularios)
type FormData = z.infer<typeof mySchema>;

// NUNCA crear enums o tipos manuales si Prisma/Zod los tiene
```

### Sin `:any`

```typescript
// CORRECTO - Inferir tipos
const data = await getItems(); // tipo inferido automaticamente

// INCORRECTO
const data: any = await getItems();
```

---

## Componentes

### Server Components por Defecto

Todos los componentes son Server Components a menos que necesiten interactividad del browser.

```
EmployeesList.tsx      ← Server Component (default)
_EmployeesTable.tsx    ← Client Component (prefijo _)
```

### Prefijo `_` para Client Components

Todo archivo con `'use client'` debe tener `_` al inicio del nombre.

### Maximo 200 Lineas

Si un componente supera 200 lineas, extraer logica a subcomponentes o hooks.

---

## Server Actions

### Ubicacion por Feature

```
modules/{modulo}/features/{feature}/actions.server.ts
```

Cada feature tiene su propio `actions.server.ts`. Acciones compartidas van en `shared/actions/`.

### Patron Estandar

```typescript
'use server';

import { prisma } from '@/shared/lib/prisma';
import { getActiveCompanyId } from '@/shared/lib/company';
import { logger } from '@/shared/lib/logger';

export async function getItems() {
  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  return prisma.item.findMany({
    where: { companyId },
    select: { id: true, name: true },  // Solo campos necesarios
    orderBy: { name: 'asc' },
  });
}
```

### Errores de negocio en Server Actions

**Regla:** una mutacion que puede fallar por una condicion esperable (falta configuracion, cuenta
no imputable, comprobante ya confirmado, periodo cerrado, stock insuficiente) **no lanza**: devuelve
`ActionResult` y el mensaje viaja como dato. Helpers en `src/shared/lib/action-result.ts`:

```typescript
import { ActionResult, BusinessError, toActionResult } from '@/shared/lib/action-result';

export async function confirmInvoice(id: string): Promise<ActionResult<{ id: string }>> {
  await checkPermission('commercial.invoices', 'approve', { redirect: true });
  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa'); // infraestructura: si lanza

  try {
    const invoice = await prisma.salesInvoice.findFirst({ ... });
    if (!invoice) throw new BusinessError('Factura no encontrada');
    if (invoice.status !== 'DRAFT') {
      throw new BusinessError('Solo se pueden confirmar facturas en estado borrador');
    }
    // ... validaciones y transaccion; cualquier BusinessError interno sube hasta aca
    return { success: true, id };
  } catch (error) {
    return toActionResult(error, 'Error al confirmar factura');
  }
}
```

- `ActionResult<T extends object = Record<never, never>>` = `({ success: true } & T) |
  { success: false; error: string }`.
- `BusinessError` es la unica excepcion cuyo mensaje llega al usuario tal cual. Cualquier otra
  cosa (`Error` de Prisma, bug) `toActionResult` la loguea con el contexto y la reemplaza por
  `UNEXPECTED_ERROR_MESSAGE` ("Ocurrio un error inesperado...").
- `BusinessError` puede lanzarse desde capas internas (por ejemplo el asiento en
  `accounting/features/integrations/commercial`), no solo desde el action: el `catch` externo la
  traduce. Asi "periodo cerrado" o "falta configurar Cuentas por Cobrar" llegan legibles sin
  remapear por texto.
- El cliente hace `if (!result.success) { toast.error(result.error); return; }` dentro de un
  `try/finally` (el `finally` resetea el estado de carga; no hace falta `catch`). **Nunca**
  `try/catch` esperando leer `error.message`.
- Los bulk (`bulkConfirmPurchaseInvoices`) reutilizan el mismo camino y arman `failures[{ fullNumber,
  message }]` con `result.error`.

**Por que.** En produccion Next.js **redacta** el mensaje de cualquier `Error` lanzado desde un
Server Action: el cliente recibe "An error occurred in the Server Components render... a digest
property is included" y el texto real solo queda en el log del servidor. Con `throw new Error(...)`
las validaciones funcionan en `npm run dev` y fallan mudas en prod (TSK-481 lo detecto en
movimientos de fondos). Verificado en TSK-721 con `npm run build && npm run start`: el toast
muestra el mensaje completo.

**Donde ya se usa:** `confirmInvoice` y `confirmPurchaseInvoice` (TSK-721), `confirmReceipt`,
`confirmPaymentOrder` y `confirmExpense` (TSK-728), `createFundMovement` / `updateFundMovement` /
`confirmFundMovement` (TSK-481, con un alias local que todavia no importa de `shared/lib`). Las
actions nuevas que muten estado con validaciones de negocio deben seguir este patron; las de solo
lectura pueden seguir lanzando (el error se muestra en `error.tsx`).

**Variante con avisos:** cuando la operacion sale bien pero hay algo que avisar (pagos que quedan
fuera del asiento, presupuesto excedido), el `success` lleva el dato:
`ActionResult<{ id: string; warnings: string[] }>` (`confirmReceipt`, `confirmPaymentOrder`) o
`ActionResult<{ budgetWarning?: { message; executedPercent } }>` (`confirmExpense`). El cliente
muestra `toast.success(...)` y, si hay avisos, `toast.warning(titulo, { description })`. No mezclar
avisos en `error`: `success: false` significa que no paso nada.

**Vista previa + pre-validacion (recomendado para confirmaciones con asiento):** la validacion de
negocio vive en una funcion `server-only` que devuelve el resultado como dato
(`EntryPreflight { error, warnings, accounts }`, `treasury/shared/entry-preflight.ts`) y la usan dos
actions: una de vista previa (`getReceiptEntryPreview`, permiso `approve`) que el dialogo de
confirmar carga con `useQuery` al abrirse —nunca `useEffect` + `useState`— para mostrar las cuentas,
deshabilitar el boton si va a fallar y listar los avisos; y el confirm, que la vuelve a correr
**antes** de `prisma.$transaction` y lanza `BusinessError` con el mismo `error`. Asi el usuario no
descubre el bloqueo despues de hacer clic, y nada se mueve si va a fallar por configuracion
(`_ConfirmEntryDialog` + `_EntryPreviewNotice` en `treasury/shared/components/`; en equipos, el
dialogo de baja de TSK-724c sigue la misma idea).

---

## Logger

**NUNCA** usar `console.*`. Siempre usar el logger:

```typescript
import { logger, Logger } from '@/shared/lib/logger';

// Global
logger.info('mensaje');
logger.error('error', { data: { error } });

// Con scope
const log = new Logger('MiComponente');
log.info('mensaje');
```

Se controla con `NEXT_PUBLIC_SHOW_LOGS=true/false`.

---

## Fechas

**SIEMPRE** `moment.js`. **NUNCA** `date-fns`:

```typescript
import moment from 'moment';

moment(date).format('DD/MM/YYYY');       // Fecha corta
moment(date).format('DD/MM/YYYY HH:mm'); // Fecha y hora
moment(date).format('YYYY-MM-DD');       // ISO
moment().diff(startDate, 'days');        // Diferencia
moment().add(7, 'days');                 // Sumar
moment(dateA).isBefore(dateB);           // Comparar
```

Funciones de formateo reutilizables en `shared/utils/formatters.ts`.

---

## Data Fetching

**SIEMPRE** React Query. **NUNCA** `useEffect` + `useState`:

```typescript
// CORRECTO
const { data, isLoading } = useQuery({
  queryKey: ['items'],
  queryFn: getItems,
});

// INCORRECTO
const [data, setData] = useState([]);
useEffect(() => { getData().then(setData); }, []);
```

Mutaciones con invalidacion:
```typescript
const mutation = useMutation({
  mutationFn: createItem,
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ['items'] });
  },
});
```

---

## Modulos Independientes

Los modulos **NO** importan de otros modulos:

```typescript
// PROHIBIDO
import { utils } from '@/modules/commercial/shared/utils';

// CORRECTO
import { utils } from '@/shared/utils';
```

Si algo se necesita en multiples modulos, va en `shared/`.

---

## Base de Datos

### Queries Eficientes

```typescript
// CORRECTO - Include en una query
const data = await prisma.employee.findMany({
  include: { department: true },
});

// INCORRECTO - N+1
for (const emp of employees) {
  const dept = await prisma.department.findUnique({ ... });
}
```

### Usar `select` para Optimizar

```typescript
const users = await prisma.user.findMany({
  select: { id: true, name: true, email: true },
});
```

### Siempre `getActiveCompanyId()`

Todas las queries de server actions deben filtrar por `companyId`.

### Transacciones para Multiples Operaciones

```typescript
await prisma.$transaction(async (tx) => {
  const user = await tx.user.create({ ... });
  const profile = await tx.profile.create({ ... });
});
```

---

## `app/` = Solo Rutas

La carpeta `app/` solo puede contener: `page.tsx`, `layout.tsx`, `loading.tsx`, `error.tsx`, `not-found.tsx` y subcarpetas de rutas.

**Prohibido:** carpetas `components/`, logica de negocio, utilidades.

Toda la logica va en `modules/` o `shared/`.
