# DataTable - Documentación

Componente de tabla de datos server-side con soporte para paginación, sorting, filtros y selección de filas. Diseñado para trabajar con Next.js App Router y Prisma.

## Tabla de Contenidos

- [Características](#características)
- [Instalación](#instalación)
- [Uso Básico](#uso-básico)
- [Arquitectura](#arquitectura)
- [Props del DataTable](#props-del-datatable)
- [Definición de Columnas](#definición-de-columnas)
- [Server Actions con Prisma](#server-actions-con-prisma)
- [Filtros Faceteados](#filtros-faceteados)
- [Selección de Filas](#selección-de-filas)
- [Acciones Personalizadas](#acciones-personalizadas)
- [Estado en URL](#estado-en-url)
- [Ejemplos Completos](#ejemplos-completos)
- [Troubleshooting](#troubleshooting)

---

## Características

- ✅ **Server-Side Pagination** - Los datos se paginan en el servidor con Prisma
- ✅ **Server-Side Sorting** - El ordenamiento se ejecuta en la base de datos
- ✅ **Server-Side Filtering** - Los filtros se aplican en el servidor
- ✅ **Estado en URL** - El estado se sincroniza con searchParams para compartir links
- ✅ **Filtros Faceteados** - Multi-select con conteo de resultados
- ✅ **Toggle de Columnas** - Mostrar/ocultar columnas dinámicamente
- ✅ **Selección de Filas** - Con checkbox y callback de selección
- ✅ **Responsive** - Adapta controles en móvil (la paginación hace wrap y no ensancha la página, TSK-726)
- ✅ **Accesible** - Soporta navegación por teclado
- ✅ **Tipado Completo** - TypeScript con inferencia de tipos

---

## Instalación

El componente requiere las siguientes dependencias (ya incluidas en el proyecto):

```bash
# TanStack Table
npm install @tanstack/react-table

# Componentes shadcn/ui necesarios
npx shadcn@latest add table button input badge command popover dropdown-menu select separator
```

---

## Uso Básico

### 1. Crear Server Action

```typescript
// src/modules/employees/features/list/actions.server.ts
'use server';

import { prisma } from '@/shared/lib/prisma';
import { getActiveCompanyId } from '@/shared/lib/company';
import {
  parseSearchParams,
  stateToPrismaParams,
  buildSearchWhere,
  buildFiltersWhere,
} from '@/shared/components/common/DataTable';
import type { DataTableSearchParams } from '@/shared/components/common/DataTable';

export async function getEmployees(searchParams: DataTableSearchParams) {
  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  // Parsear parámetros de URL
  const state = parseSearchParams(searchParams);
  const prismaParams = stateToPrismaParams(state);

  // Construir cláusula where
  const searchWhere = buildSearchWhere(state.search, [
    'firstName',
    'lastName',
    'documentNumber',
  ]);
  const filtersWhere = buildFiltersWhere(state.filters);

  const where = {
    companyId,
    ...searchWhere,
    ...filtersWhere,
  };

  // Ejecutar queries
  const [data, total] = await Promise.all([
    prisma.employee.findMany({
      ...prismaParams,
      where,
      include: {
        jobPosition: { select: { id: true, name: true } },
      },
    }),
    prisma.employee.count({ where }),
  ]);

  return { data, total };
}

// Tipo inferido
export type EmployeeListItem = Awaited<
  ReturnType<typeof getEmployees>
>['data'][number];
```

### 2. Definir Columnas

```typescript
// src/modules/employees/features/list/columns.tsx
'use client';

import { ColumnDef } from '@tanstack/react-table';
import { Badge } from '@/shared/components/ui/badge';
import { DataTableColumnHeader } from '@/shared/components/common/DataTable';
import { employeeStatusBadges } from '@/shared/utils/mappers';
import type { EmployeeListItem } from './actions.server';

export const columns: ColumnDef<EmployeeListItem>[] = [
  {
    accessorKey: 'employeeNumber',
    meta: { title: 'Legajo' },  // ← Para el dropdown "Mostrar columnas"
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Legajo" />
    ),
    cell: ({ row }) => (
      <span className="font-medium">{row.getValue('employeeNumber')}</span>
    ),
  },
  {
    accessorKey: 'firstName',
    meta: { title: 'Nombre' },
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Nombre" />
    ),
    cell: ({ row }) => (
      <div>
        {row.original.firstName} {row.original.lastName}
      </div>
    ),
  },
  {
    accessorKey: 'status',
    meta: { title: 'Estado' },
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Estado" />
    ),
    cell: ({ row }) => {
      const status = row.getValue('status') as string;
      const badge = employeeStatusBadges[status];
      return <Badge variant={badge?.variant}>{badge?.label}</Badge>;
    },
    filterFn: (row, id, value) => {
      return value.includes(row.getValue(id));
    },
  },
  {
    accessorKey: 'jobPosition',
    meta: { title: 'Puesto' },
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Puesto" />
    ),
    cell: ({ row }) => row.original.jobPosition?.name || '-',
  },
];
```

### 3. Crear Página (Server Component)

```typescript
// src/app/(core)/dashboard/employees/page.tsx
import { Metadata } from 'next';
import { EmployeesList } from '@/modules/employees';

export const metadata: Metadata = { title: 'Empleados' };

interface Props {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

export default async function EmployeesPage({ searchParams }: Props) {
  const params = await searchParams;
  return <EmployeesList searchParams={params} />;
}
```

### 4. Crear Componente de Lista

```typescript
// src/modules/employees/features/list/EmployeesList.tsx
import { getEmployees } from './actions.server';
import { columns } from './columns';
import { DataTable } from '@/shared/components/common/DataTable';
import type { DataTableSearchParams } from '@/shared/components/common/DataTable';
import { EmployeeStatus } from '@/generated/prisma/enums';
import { employeeStatusBadges } from '@/shared/utils/mappers';
import { Circle, CheckCircle, XCircle } from 'lucide-react';

// Opciones de filtro para estado
const statusOptions = Object.entries(employeeStatusBadges).map(
  ([value, config]) => ({
    value,
    label: config.label,
    icon: value === 'APPROVED' ? CheckCircle : value === 'NOT_APPROVED' ? XCircle : Circle,
  })
);

interface Props {
  searchParams: DataTableSearchParams;
}

export async function EmployeesList({ searchParams }: Props) {
  const { data, total } = await getEmployees(searchParams);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Empleados</h1>
      </div>

      <DataTable
        columns={columns}
        data={data}
        totalRows={total}
        searchParams={searchParams}
        searchPlaceholder="Buscar por nombre o legajo..."
        searchColumn="firstName"
        facetedFilters={[
          {
            columnId: 'status',
            title: 'Estado',
            options: statusOptions,
          },
        ]}
      />
    </div>
  );
}
```

---

## Arquitectura

```
┌─────────────────────────────────────────────────────────────────┐
│                     URL SearchParams                             │
│  ?page=2&pageSize=20&sortBy=name&sortOrder=asc&status=APPROVED  │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                 Server Component (page.tsx)                      │
│  - Recibe searchParams como prop                                 │
│  - Pasa a Server Action para fetch                               │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                   Server Action (Prisma)                         │
│  - parseSearchParams() → convierte URL a estado                  │
│  - stateToPrismaParams() → genera skip, take, orderBy            │
│  - buildSearchWhere() → búsqueda en múltiples campos             │
│  - buildFiltersWhere() → filtros de columnas                     │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                 Client Component (DataTable)                     │
│  - useDataTable() → sincroniza estado con URL                    │
│  - useReactTable() → maneja tabla con TanStack                   │
│  - Renderiza: Toolbar + Table + Pagination                       │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                    User Interaction                              │
│  - Click en header → onSortingChange → router.push()             │
│  - Click en filtro → onColumnFiltersChange → router.push()       │
│  - Click en página → onPaginationChange → router.push()          │
│  → URL cambia → Server Component re-renderiza                    │
└─────────────────────────────────────────────────────────────────┘
```

---

## Props del DataTable

| Prop | Tipo | Default | Descripción |
|------|------|---------|-------------|
| `columns` | `ColumnDef<TData>[]` | **required** | Definiciones de columnas de TanStack Table |
| `data` | `TData[]` | **required** | Datos de la página actual |
| `totalRows` | `number` | **required** | Total de filas en el servidor |
| `searchParams` | `DataTableSearchParams` | `{}` | Search params actuales de la URL |
| `facetedFilters` | `DataTableFacetedFilterConfig[]` | `[]` | Configuración de filtros faceteados |
| `searchPlaceholder` | `string` | `'Buscar...'` | Placeholder del input de búsqueda |
| `searchColumn` | `string` | `undefined` | Columna específica donde buscar |
| `showColumnToggle` | `boolean` | `true` | Mostrar selector de columnas |
| `showRowSelection` | `boolean` | `false` | Mostrar contador de selección |
| `enableRowSelection` | `boolean` | `false` | Habilitar checkboxes de selección |
| `onRowSelectionChange` | `(rows: TData[]) => void` | `undefined` | Callback de selección |
| `emptyMessage` | `string` | `'No se encontraron resultados.'` | Mensaje cuando no hay datos |
| `pageSizeOptions` | `number[]` | `[10, 20, 30, 50, 100]` | Opciones de filas por página |
| `toolbarActions` | `ReactNode` | `undefined` | Acciones adicionales en el toolbar |
| `data-testid` | `string` | `'data-table'` | ID para testing |

---

## Definición de Columnas

### Propiedad `meta.title` (Requerida)

**IMPORTANTE**: Todas las columnas deben incluir `meta: { title: 'Título' }` para que el dropdown "Mostrar columnas" muestre nombres legibles en lugar de IDs técnicos.

```typescript
{
  accessorKey: 'employeeNumber',
  meta: { title: 'Legajo' },  // ← REQUERIDO para el toggle de columnas
  header: ({ column }) => (
    <DataTableColumnHeader column={column} title="Legajo" />
  ),
}
```

Sin `meta.title`, el dropdown mostraría "employeeNumber" en lugar de "Legajo".

### Columna Básica

```typescript
{
  accessorKey: 'name',
  meta: { title: 'Nombre' },
  header: 'Nombre',
}
```

### Columna con Sorting

```typescript
{
  accessorKey: 'name',
  meta: { title: 'Nombre' },
  header: ({ column }) => (
    <DataTableColumnHeader column={column} title="Nombre" />
  ),
}
```

### Columna con Celda Personalizada

```typescript
{
  accessorKey: 'status',
  meta: { title: 'Estado' },
  header: ({ column }) => (
    <DataTableColumnHeader column={column} title="Estado" />
  ),
  cell: ({ row }) => {
    const status = row.getValue('status') as EmployeeStatus;
    const badge = employeeStatusBadges[status];
    return <Badge variant={badge.variant}>{badge.label}</Badge>;
  },
}
```

### Columna con `accessorFn` (Computada)

Para columnas que computan su valor desde múltiples campos:

```typescript
{
  id: 'fullName',  // ID requerido cuando usas accessorFn
  accessorFn: (row) => `${row.lastName}, ${row.firstName}`,
  meta: { title: 'Nombre Completo' },
  header: ({ column }) => (
    <DataTableColumnHeader column={column} title="Nombre Completo" />
  ),
  cell: ({ row }) => (
    <span>{row.original.lastName}, {row.original.firstName}</span>
  ),
}
```

### Columna de Acciones

Las columnas de acciones no necesitan `meta.title` porque no aparecen en el dropdown de columnas (no tienen `accessorFn`).

```typescript
{
  id: 'actions',
  cell: ({ row }) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="h-8 w-8 p-0">
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => router.push(`/employees/${row.original.id}`)}>
          Ver detalle
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => router.push(`/employees/${row.original.id}/edit`)}>
          Editar
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  ),
}
```

### Columna de Selección (Checkbox)

Las columnas de selección usan `enableHiding: false` para que no aparezcan en el dropdown de columnas.

```typescript
{
  id: 'select',
  header: ({ table }) => (
    <Checkbox
      checked={table.getIsAllPageRowsSelected()}
      onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
      aria-label="Seleccionar todos"
    />
  ),
  cell: ({ row }) => (
    <Checkbox
      checked={row.getIsSelected()}
      onCheckedChange={(value) => row.toggleSelected(!!value)}
      aria-label="Seleccionar fila"
    />
  ),
  enableSorting: false,
  enableHiding: false,  // No aparece en "Mostrar columnas"
}
```

### Resumen: Cuándo usar `meta.title`

| Tipo de Columna | ¿Necesita `meta.title`? | Razón |
|-----------------|-------------------------|-------|
| Columna de datos | ✅ Sí | Aparece en el dropdown de columnas |
| Columna computada (`accessorFn`) | ✅ Sí | Aparece en el dropdown de columnas |
| Columna de acciones | ❌ No | No tiene `accessorFn`, no aparece en dropdown |
| Columna de selección | ❌ No | Tiene `enableHiding: false` |

---

## Server Actions con Prisma

### Helper Functions

El componente provee funciones helper para construir queries de Prisma:

#### `parseSearchParams(searchParams)`

Convierte los search params de URL a un objeto estructurado:

```typescript
const state = parseSearchParams({
  page: '2',
  pageSize: '20',
  sortBy: 'name',
  sortOrder: 'desc',
  status: 'APPROVED,PENDING',
  search: 'juan',
});

// Resultado:
// {
//   page: 1,          // 0-indexed (URL es 1-indexed)
//   pageSize: 20,
//   sortBy: 'name',
//   sortOrder: 'desc',
//   search: 'juan',
//   filters: { status: ['APPROVED', 'PENDING'] }
// }
```

#### `stateToPrismaParams(state)`

Genera parámetros de Prisma para paginación y sorting:

```typescript
const prismaParams = stateToPrismaParams(state);

// Resultado:
// {
//   skip: 20,    // page * pageSize
//   take: 20,
//   orderBy: { name: 'desc' }
// }
```

#### `buildSearchWhere(search, fields)`

Construye cláusula OR para búsqueda en múltiples campos:

```typescript
const where = buildSearchWhere('juan', ['firstName', 'lastName', 'email']);

// Resultado:
// {
//   OR: [
//     { firstName: { contains: 'juan', mode: 'insensitive' } },
//     { lastName: { contains: 'juan', mode: 'insensitive' } },
//     { email: { contains: 'juan', mode: 'insensitive' } },
//   ]
// }
```

#### `buildFiltersWhere(filters, columnMap?)`

Construye cláusula where para filtros de columnas:

```typescript
const where = buildFiltersWhere(
  { status: ['APPROVED'], department: ['dept-1', 'dept-2'] },
  { department: 'departmentId' } // Mapeo opcional
);

// Resultado:
// {
//   status: 'APPROVED',           // Un valor = igualdad
//   departmentId: { in: ['dept-1', 'dept-2'] }  // Múltiples = IN
// }
```

### Ejemplo Completo de Server Action

```typescript
'use server';

import { prisma } from '@/shared/lib/prisma';
import { getActiveCompanyId } from '@/shared/lib/company';
import {
  parseSearchParams,
  stateToPrismaParams,
  buildSearchWhere,
  buildFiltersWhere,
} from '@/shared/components/common/DataTable';
import type { DataTableSearchParams } from '@/shared/components/common/DataTable';

export async function getDocuments(searchParams: DataTableSearchParams) {
  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  const state = parseSearchParams(searchParams);
  const { skip, take, orderBy } = stateToPrismaParams(state);

  // Búsqueda en múltiples campos
  const searchWhere = buildSearchWhere(state.search, [
    'employee.firstName',
    'employee.lastName',
    'documentType.name',
  ]);

  // Filtros con mapeo de columnas
  const filtersWhere = buildFiltersWhere(state.filters, {
    documentType: 'documentTypeId',
    state: 'state',
  });

  const where = {
    employee: { companyId },
    ...searchWhere,
    ...filtersWhere,
  };

  const [data, total] = await Promise.all([
    prisma.employeeDocument.findMany({
      skip,
      take,
      orderBy,
      where,
      include: {
        employee: { select: { firstName: true, lastName: true } },
        documentType: { select: { name: true } },
      },
    }),
    prisma.employeeDocument.count({ where }),
  ]);

  return { data, total };
}
```

---

## Filtros Faceteados

### Configuración

```typescript
const facetedFilters = [
  {
    columnId: 'status',  // Debe coincidir con accessorKey de la columna
    title: 'Estado',
    options: [
      { value: 'PENDING', label: 'Pendiente', icon: Clock },
      { value: 'APPROVED', label: 'Aprobado', icon: CheckCircle },
      { value: 'REJECTED', label: 'Rechazado', icon: XCircle },
    ],
  },
  {
    columnId: 'priority',
    title: 'Prioridad',
    options: [
      { value: 'LOW', label: 'Baja', icon: ArrowDown },
      { value: 'MEDIUM', label: 'Media', icon: ArrowRight },
      { value: 'HIGH', label: 'Alta', icon: ArrowUp },
    ],
  },
];

<DataTable
  // ...
  facetedFilters={facetedFilters}
/>
```

### Generar Opciones desde Enums de Prisma

```typescript
import { DocumentState } from '@/generated/prisma/enums';
import { documentStateLabels, documentStateIcons } from '@/shared/utils/mappers';

const stateOptions = Object.values(DocumentState).map((value) => ({
  value,
  label: documentStateLabels[value],
  icon: documentStateIcons[value],
}));
```

---

## Selección de Filas

### Habilitar Selección

```typescript
<DataTable
  // ...
  enableRowSelection={true}
  showRowSelection={true}
  onRowSelectionChange={(selectedRows) => {
    console.log('Filas seleccionadas:', selectedRows);
  }}
/>
```

### Agregar Columna de Checkbox

```typescript
import { Checkbox } from '@/shared/components/ui/checkbox';

const columns = [
  {
    id: 'select',
    header: ({ table }) => (
      <Checkbox
        checked={
          table.getIsAllPageRowsSelected() ||
          (table.getIsSomePageRowsSelected() && 'indeterminate')
        }
        onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
        aria-label="Seleccionar todos"
      />
    ),
    cell: ({ row }) => (
      <Checkbox
        checked={row.getIsSelected()}
        onCheckedChange={(value) => row.toggleSelected(!!value)}
        aria-label="Seleccionar fila"
      />
    ),
    enableSorting: false,
    enableHiding: false,
  },
  // ... otras columnas
];
```

---

## Acciones Personalizadas

### Botones en el Toolbar

```typescript
<DataTable
  // ...
  toolbarActions={
    <>
      <Button variant="outline" size="sm">
        <Download className="mr-2 h-4 w-4" />
        Exportar
      </Button>
      <Button size="sm">
        <Plus className="mr-2 h-4 w-4" />
        Nuevo
      </Button>
    </>
  }
/>
```

### Acciones Masivas (con selección)

```typescript
function EmployeesList() {
  const [selectedRows, setSelectedRows] = useState<Employee[]>([]);

  const handleBulkDelete = async () => {
    if (selectedRows.length === 0) return;
    await deleteEmployees(selectedRows.map((r) => r.id));
    router.refresh();
  };

  return (
    <DataTable
      // ...
      enableRowSelection={true}
      onRowSelectionChange={setSelectedRows}
      toolbarActions={
        selectedRows.length > 0 && (
          <Button variant="destructive" size="sm" onClick={handleBulkDelete}>
            Eliminar ({selectedRows.length})
          </Button>
        )
      }
    />
  );
}
```

---

## Estado en URL

El estado del DataTable se sincroniza automáticamente con la URL:

### Parámetros Soportados

| Parámetro | Descripción | Ejemplo |
|-----------|-------------|---------|
| `page` | Página actual (1-indexed) | `?page=2` |
| `pageSize` | Filas por página | `?pageSize=20` |
| `sortBy` | Campo de ordenamiento | `?sortBy=name` |
| `sortOrder` | Dirección (asc/desc) | `?sortOrder=desc` |
| `search` | Término de búsqueda | `?search=juan` |
| `{columnId}` | Filtros de columna | `?status=APPROVED,PENDING` |

### Ejemplo de URL

```
/dashboard/employees?page=2&pageSize=20&sortBy=lastName&sortOrder=asc&status=APPROVED&search=juan
```

### Beneficios

- ✅ Compartir links con estado exacto
- ✅ Navegación con botón atrás/adelante
- ✅ Bookmarks con filtros guardados
- ✅ SEO-friendly (páginas indexables)

---

## Ejemplos Completos

### Tabla de Documentos de Empleados

Ver implementación en: `src/modules/documents/features/employee-documents/`

### Tabla de Tipos de Documento

Ver implementación en: `src/modules/documents/features/document-types/`

---

## Troubleshooting

### El sorting no funciona

1. Verifica que la columna tenga `accessorKey` definido
2. Usa `DataTableColumnHeader` en el header
3. Verifica que el server action maneje `sortBy` y `sortOrder`

### Los filtros no persisten

1. Asegúrate de pasar `searchParams` al DataTable
2. Verifica que `columnId` coincida con `accessorKey`
3. El server action debe usar `buildFiltersWhere`

### Paginación muestra página incorrecta

1. URL usa índice 1-based, interno usa 0-based
2. `parseSearchParams` hace la conversión automáticamente
3. Verifica que `totalRows` sea correcto

### En el celular la página se ensancha o un modal se sale de la pantalla

Un elemento de la página más ancho que el viewport (sin un ancestro que lo recorte) hace que el
navegador móvil ensanche el *layout viewport* hasta el ancho del contenido. Todo lo que es
`position: fixed` —los `Dialog`, `Sheet`, toasts— se calcula contra ese viewport más ancho: un
`DialogContent` con `max-w-[calc(100%-2rem)]` y `left: 50%` termina más ancho que la pantalla y
con la X de cerrar afuera (TSK-726: página de 443 px a 375 → modal de 411 px).

- **La paginación ya es responsive** (`DataTablePagination.tsx`): contenedor y bloque de controles
  con `flex-wrap` + `gap-x/gap-y` (en lugar de `space-x-*`, que no se lleva bien con el wrap),
  rango "Mostrando X a Y de Z" con `min-w-0 flex-1`, controles con `ml-auto` y "Página X de Y" con
  `min-w-[100px]`. En escritorio queda en una sola línea, igual que antes (36 px de alto); en un
  celular de 375 px se parte en líneas (rango; filas por página + página; flechas) y la página
  mide 375.
- En el celular la tabla en sí no ensancha la página: scrollea dentro de su contenedor (medido en Movimientos de Fondos, TSK-726).
- Si agregás algo al toolbar o al lado de la tabla, revisalo a 375 px **con emulación móvil**
  (`isMobile: true` en Playwright o el modo dispositivo de DevTools): con un viewport angosto de
  escritorio el problema **no se reproduce**, porque ahí el layout viewport no se ensancha.
  Medí `document.documentElement.scrollWidth` (debe ser ≤ `window.innerWidth`). Pendientes
  conocidos: la toolbar "Filtros | Nuevo Socio" de Socios (383 px) y el Dashboard (491 px).

### Performance lenta

1. Usa `select` en Prisma para traer solo campos necesarios
2. Agrega índices a campos de búsqueda/filtro en la BD
3. Considera usar `unstable_cache` de Next.js para queries frecuentes

---

## Componentes Relacionados

- `DataTableColumnHeader` - Header con sorting
- `DataTableFacetedFilter` - Filtro multi-select
- `DataTablePagination` - Controles de paginación
- `DataTableToolbar` - Barra de herramientas
- `DataTableViewOptions` - Toggle de columnas

---

## Créditos

Basado en:
- [shadcn/ui Data Table](https://ui.shadcn.com/docs/components/data-table)
- [TanStack Table](https://tanstack.com/table)
- [sadmann7/tablecn](https://github.com/sadmann7/shadcn-table)
