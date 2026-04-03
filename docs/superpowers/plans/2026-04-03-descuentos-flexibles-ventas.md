# Descuentos Flexibles en Ventas - Plan de Implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementar descuentos por línea (% o $) y descuento global (% o $) en facturas de venta, con catálogo de descuentos predefinidos.

**Architecture:** Se agregan campos de descuento a SalesInvoiceLine y SalesInvoice en Prisma. Nuevo modelo DiscountPreset con CRUD en configuración de empresa. La lógica de cálculo se actualiza en `calculateLineAmounts()` y `createInvoice()`/`updateInvoice()`. El formulario muestra campos Dto% / Dto$ por línea + descuento global. IVA se calcula sobre base descontada.

**Tech Stack:** Prisma 7, React 19, React Hook Form + Zod, shadcn/ui, Tanstack Query, react-pdf

**Spec:** `docs/superpowers/specs/2026-04-03-descuentos-flexibles-ventas-design.md`

---

## Task 1: Schema Prisma + Migración

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Agregar campos de descuento a SalesInvoiceLine**

En `prisma/schema.prisma`, buscar el modelo `SalesInvoiceLine` y agregar después de `unitPrice`:

```prisma
  discountPercent Decimal? @db.Decimal(5, 2)
  discountAmount  Decimal? @db.Decimal(12, 2)
```

- [ ] **Step 2: Agregar campos de descuento global a SalesInvoice**

En `prisma/schema.prisma`, buscar el modelo `SalesInvoice` y agregar después de `total`:

```prisma
  globalDiscountPercent Decimal? @db.Decimal(5, 2)
  globalDiscountAmount  Decimal? @db.Decimal(12, 2)
  totalBeforeDiscount   Decimal  @default(0) @db.Decimal(12, 2)
  discountTotal         Decimal  @default(0) @db.Decimal(12, 2)
```

- [ ] **Step 3: Crear modelo DiscountPreset**

En `prisma/schema.prisma`, agregar el nuevo modelo y la relación en Company:

```prisma
model DiscountPreset {
  id         String   @id @default(uuid())
  companyId  String
  name       String
  percentage Decimal  @db.Decimal(5, 2)
  isActive   Boolean  @default(true)
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt

  company Company @relation(fields: [companyId], references: [id])

  @@unique([companyId, name])
  @@index([companyId])
}
```

En el modelo `Company`, agregar la relación:

```prisma
  discountPresets DiscountPreset[]
```

- [ ] **Step 4: Generar migración y aplicar**

```bash
npm run db:migrate -- --name add-discount-fields
npm run db:generate
```

- [ ] **Step 5: Commit**

```bash
git add prisma/
git commit -m "feat(commercial): add discount fields to invoice schema and DiscountPreset model"
```

---

## Task 2: Registrar permisos del nuevo módulo

**Files:**
- Modify: `src/shared/lib/permissions/constants.ts`

- [ ] **Step 1: Agregar módulo en MODULES**

Después de `'company.document-types': 'company.document-types',` agregar:

```typescript
  // Configuración de Empresa - Comercial
  'company.discount-presets': 'company.discount-presets',
```

- [ ] **Step 2: Agregar label en MODULE_LABELS**

Después de `'company.document-types': 'Tipos de Documento',` agregar:

```typescript
  'company.discount-presets': 'Descuentos Predefinidos',
```

- [ ] **Step 3: Agregar grupo en MODULE_GROUPS**

Después del bloque `configuracionDocumentos`, agregar:

```typescript
  configuracionComercial: {
    label: 'Configuración - Comercial',
    modules: ['company.discount-presets'] as Module[],
  },
```

- [ ] **Step 4: Verificar tipos**

```bash
npm run check-types 2>&1 | grep -i "discount\|constants"
```

Expected: sin errores.

- [ ] **Step 5: Commit**

```bash
git add src/shared/lib/permissions/constants.ts
git commit -m "feat(permissions): register company.discount-presets module"
```

---

## Task 3: CRUD Descuentos Predefinidos - Actions

**Files:**
- Create: `src/modules/company/features/discount-presets/list/actions.server.ts`

- [ ] **Step 1: Crear actions.server.ts**

Crear `src/modules/company/features/discount-presets/list/actions.server.ts`:

```typescript
'use server';

import { z } from 'zod';
import { prisma } from '@/shared/lib/prisma';
import { logger } from '@/shared/lib/logger';
import { getActiveCompanyId } from '@/shared/lib/company';
import { checkPermission } from '@/shared/lib/permissions';
import type { DataTableSearchParams } from '@/shared/components/common/DataTable';

// Schema de validación
const discountPresetSchema = z.object({
  name: z.string().min(2, 'El nombre debe tener al menos 2 caracteres'),
  percentage: z.coerce
    .number()
    .min(0.01, 'El porcentaje debe ser mayor a 0')
    .max(100, 'El porcentaje no puede superar 100'),
  isActive: z.boolean().optional(),
});

export type CreateDiscountPresetInput = z.infer<typeof discountPresetSchema>;

export async function getDiscountPresetsPaginated(searchParams: DataTableSearchParams) {
  await checkPermission('company.discount-presets', 'view', { redirect: true });
  const companyId = await getActiveCompanyId();

  const page = Number(searchParams.page) || 1;
  const perPage = Number(searchParams.perPage) || 10;
  const search = searchParams.search || '';

  const where = {
    companyId,
    ...(search && {
      name: { contains: search, mode: 'insensitive' as const },
    }),
  };

  const [data, total] = await Promise.all([
    prisma.discountPreset.findMany({
      where,
      select: {
        id: true,
        name: true,
        percentage: true,
        isActive: true,
        createdAt: true,
      },
      orderBy: { name: 'asc' },
      skip: (page - 1) * perPage,
      take: perPage,
    }),
    prisma.discountPreset.count({ where }),
  ]);

  return {
    data: data.map((d) => ({
      ...d,
      percentage: Number(d.percentage),
    })),
    totalRows: total,
  };
}

export type DiscountPresetListItem = Awaited<
  ReturnType<typeof getDiscountPresetsPaginated>
>['data'][number];

export async function getDiscountPresetsForSelect() {
  await checkPermission('company.discount-presets', 'view', { redirect: true });
  const companyId = await getActiveCompanyId();

  const data = await prisma.discountPreset.findMany({
    where: { companyId, isActive: true },
    select: { id: true, name: true, percentage: true },
    orderBy: { name: 'asc' },
  });

  return data.map((d) => ({
    ...d,
    percentage: Number(d.percentage),
  }));
}

export async function createDiscountPreset(input: CreateDiscountPresetInput) {
  await checkPermission('company.discount-presets', 'create', { redirect: true });
  const companyId = await getActiveCompanyId();

  const validated = discountPresetSchema.parse(input);

  const preset = await prisma.discountPreset.create({
    data: {
      companyId,
      name: validated.name,
      percentage: validated.percentage,
    },
  });

  logger.info('DiscountPreset created', { data: { id: preset.id, name: preset.name } });
  return preset;
}

export async function updateDiscountPreset(id: string, input: CreateDiscountPresetInput) {
  await checkPermission('company.discount-presets', 'update', { redirect: true });
  const companyId = await getActiveCompanyId();

  const validated = discountPresetSchema.parse(input);

  const preset = await prisma.discountPreset.update({
    where: { id, companyId },
    data: {
      name: validated.name,
      percentage: validated.percentage,
      isActive: validated.isActive ?? true,
    },
  });

  logger.info('DiscountPreset updated', { data: { id: preset.id } });
  return preset;
}

export async function deleteDiscountPreset(id: string) {
  await checkPermission('company.discount-presets', 'delete', { redirect: true });
  const companyId = await getActiveCompanyId();

  await prisma.discountPreset.delete({
    where: { id, companyId },
  });

  logger.info('DiscountPreset deleted', { data: { id } });
}
```

- [ ] **Step 2: Commit**

```bash
git add src/modules/company/features/discount-presets/
git commit -m "feat(company): add discount presets server actions"
```

---

## Task 4: CRUD Descuentos Predefinidos - UI

**Files:**
- Create: `src/modules/company/features/discount-presets/list/columns.tsx`
- Create: `src/modules/company/features/discount-presets/list/components/_DiscountPresetsTable.tsx`
- Create: `src/modules/company/features/discount-presets/list/components/_DiscountPresetFormModal.tsx`
- Create: `src/modules/company/features/discount-presets/list/DiscountPresetsList.tsx`
- Create: `src/modules/company/features/discount-presets/index.ts`
- Create: `src/app/(core)/dashboard/company/discount-presets/page.tsx`

- [ ] **Step 1: Crear columns.tsx**

Crear `src/modules/company/features/discount-presets/list/columns.tsx`:

```typescript
'use client';

import type { ColumnDef } from '@tanstack/react-table';
import { MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import { Badge } from '@/shared/components/ui/badge';
import { Button } from '@/shared/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/shared/components/ui/dropdown-menu';
import { DataTableColumnHeader } from '@/shared/components/common/DataTable';
import type { DiscountPresetListItem } from './actions.server';

interface ColumnsProps {
  onEdit: (item: DiscountPresetListItem) => void;
  onDelete: (item: DiscountPresetListItem) => void;
  permissions: { canUpdate: boolean; canDelete: boolean };
}

export function getColumns({
  onEdit,
  onDelete,
  permissions,
}: ColumnsProps): ColumnDef<DiscountPresetListItem>[] {
  return [
    {
      accessorKey: 'name',
      header: ({ column }) => <DataTableColumnHeader column={column} title="Nombre" />,
      meta: { title: 'Nombre' },
    },
    {
      accessorKey: 'percentage',
      header: ({ column }) => <DataTableColumnHeader column={column} title="Porcentaje" />,
      meta: { title: 'Porcentaje' },
      cell: ({ row }) => <span className="font-mono">{row.original.percentage}%</span>,
    },
    {
      accessorKey: 'isActive',
      header: ({ column }) => <DataTableColumnHeader column={column} title="Estado" />,
      meta: { title: 'Estado' },
      cell: ({ row }) => (
        <Badge variant={row.original.isActive ? 'default' : 'secondary'}>
          {row.original.isActive ? 'Activo' : 'Inactivo'}
        </Badge>
      ),
    },
    ...(permissions.canUpdate || permissions.canDelete
      ? [
          {
            id: 'actions',
            cell: ({ row }: { row: { original: DiscountPresetListItem } }) => (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon">
                    <MoreHorizontal className="size-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {permissions.canUpdate && (
                    <DropdownMenuItem onClick={() => onEdit(row.original)}>
                      <Pencil className="mr-2 size-4" />
                      Editar
                    </DropdownMenuItem>
                  )}
                  {permissions.canDelete && (
                    <DropdownMenuItem
                      className="text-destructive"
                      onClick={() => onDelete(row.original)}
                    >
                      <Trash2 className="mr-2 size-4" />
                      Eliminar
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            ),
          } as ColumnDef<DiscountPresetListItem>,
        ]
      : []),
  ];
}
```

- [ ] **Step 2: Crear _DiscountPresetFormModal.tsx**

Crear `src/modules/company/features/discount-presets/list/components/_DiscountPresetFormModal.tsx`:

```typescript
'use client';

import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2 } from 'lucide-react';
import { z } from 'zod';

import { Button } from '@/shared/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog';
import { Input } from '@/shared/components/ui/input';
import { Label } from '@/shared/components/ui/label';
import { Switch } from '@/shared/components/ui/switch';
import type { DiscountPresetListItem } from '../actions.server';

const formSchema = z.object({
  name: z.string().min(2, 'El nombre debe tener al menos 2 caracteres'),
  percentage: z.coerce
    .number()
    .min(0.01, 'El porcentaje debe ser mayor a 0')
    .max(100, 'El porcentaje no puede superar 100'),
  isActive: z.boolean(),
});

type FormData = z.infer<typeof formSchema>;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item?: DiscountPresetListItem | null;
  onSubmit: (data: FormData) => Promise<void>;
  isSubmitting: boolean;
}

export function _DiscountPresetFormModal({
  open,
  onOpenChange,
  item,
  onSubmit,
  isSubmitting,
}: Props) {
  const isEdit = Boolean(item);

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: '',
      percentage: 0,
      isActive: true,
    },
  });

  useEffect(() => {
    if (open) {
      form.reset({
        name: item?.name ?? '',
        percentage: item?.percentage ?? 0,
        isActive: item?.isActive ?? true,
      });
    }
  }, [open, item, form]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? 'Editar Descuento Predefinido' : 'Nuevo Descuento Predefinido'}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">
              Nombre <span className="text-destructive">*</span>
            </Label>
            <Input
              id="name"
              placeholder="Ej: Mecánico, Mayorista"
              {...form.register('name')}
              disabled={isSubmitting}
            />
            {form.formState.errors.name && (
              <p className="text-sm text-destructive">{form.formState.errors.name.message}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="percentage">
              Porcentaje (%) <span className="text-destructive">*</span>
            </Label>
            <Input
              id="percentage"
              type="number"
              step="0.01"
              min="0.01"
              max="100"
              placeholder="Ej: 15"
              {...form.register('percentage')}
              disabled={isSubmitting}
            />
            {form.formState.errors.percentage && (
              <p className="text-sm text-destructive">
                {form.formState.errors.percentage.message}
              </p>
            )}
          </div>

          {isEdit && (
            <div className="flex items-center gap-2">
              <Switch
                id="isActive"
                checked={form.watch('isActive')}
                onCheckedChange={(checked) => form.setValue('isActive', checked)}
                disabled={isSubmitting}
              />
              <Label htmlFor="isActive">Activo</Label>
            </div>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting && <Loader2 className="mr-2 size-4 animate-spin" />}
              {isEdit ? 'Guardar cambios' : 'Crear'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 3: Crear _DiscountPresetsTable.tsx**

Crear `src/modules/company/features/discount-presets/list/components/_DiscountPresetsTable.tsx`:

```typescript
'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus } from 'lucide-react';
import { Button } from '@/shared/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/shared/components/ui/alert-dialog';
import { DataTable } from '@/shared/components/common/DataTable';
import type { DataTableSearchParams } from '@/shared/components/common/DataTable';
import { usePermissions } from '@/shared/hooks/usePermissions';
import {
  createDiscountPreset,
  updateDiscountPreset,
  deleteDiscountPreset,
  type DiscountPresetListItem,
  type CreateDiscountPresetInput,
} from '../actions.server';
import { getColumns } from '../columns';
import { _DiscountPresetFormModal } from './_DiscountPresetFormModal';

interface Props {
  data: DiscountPresetListItem[];
  totalRows: number;
  searchParams: DataTableSearchParams;
}

export function _DiscountPresetsTable({ data, totalRows, searchParams }: Props) {
  const queryClient = useQueryClient();
  const { hasPermission } = usePermissions();

  const [formOpen, setFormOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [selectedItem, setSelectedItem] = useState<DiscountPresetListItem | null>(null);

  const permissions = {
    canCreate: hasPermission('company.discount-presets', 'create'),
    canUpdate: hasPermission('company.discount-presets', 'update'),
    canDelete: hasPermission('company.discount-presets', 'delete'),
  };

  const createMutation = useMutation({
    mutationFn: (input: CreateDiscountPresetInput) => createDiscountPreset(input),
    onSuccess: () => {
      toast.success('Descuento predefinido creado');
      setFormOpen(false);
      setSelectedItem(null);
      queryClient.invalidateQueries({ queryKey: ['discount-presets'] });
    },
    onError: () => toast.error('Error al crear el descuento predefinido'),
  });

  const updateMutation = useMutation({
    mutationFn: (input: CreateDiscountPresetInput) =>
      updateDiscountPreset(selectedItem!.id, input),
    onSuccess: () => {
      toast.success('Descuento predefinido actualizado');
      setFormOpen(false);
      setSelectedItem(null);
      queryClient.invalidateQueries({ queryKey: ['discount-presets'] });
    },
    onError: () => toast.error('Error al actualizar el descuento predefinido'),
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteDiscountPreset(selectedItem!.id),
    onSuccess: () => {
      toast.success('Descuento predefinido eliminado');
      setDeleteOpen(false);
      setSelectedItem(null);
      queryClient.invalidateQueries({ queryKey: ['discount-presets'] });
    },
    onError: () => toast.error('Error al eliminar el descuento predefinido'),
  });

  const handleEdit = (item: DiscountPresetListItem) => {
    setSelectedItem(item);
    setFormOpen(true);
  };

  const handleDelete = (item: DiscountPresetListItem) => {
    setSelectedItem(item);
    setDeleteOpen(true);
  };

  const handleSubmit = async (formData: CreateDiscountPresetInput) => {
    if (selectedItem) {
      await updateMutation.mutateAsync(formData);
    } else {
      await createMutation.mutateAsync(formData);
    }
  };

  const columns = getColumns({ onEdit: handleEdit, onDelete: handleDelete, permissions });

  return (
    <>
      <DataTable
        columns={columns}
        data={data}
        totalRows={totalRows}
        searchParams={searchParams}
        searchPlaceholder="Buscar descuentos..."
        toolbarActions={
          permissions.canCreate ? (
            <Button
              size="sm"
              onClick={() => {
                setSelectedItem(null);
                setFormOpen(true);
              }}
            >
              <Plus className="mr-2 size-4" />
              Nuevo Descuento
            </Button>
          ) : undefined
        }
      />

      <_DiscountPresetFormModal
        open={formOpen}
        onOpenChange={(open) => {
          setFormOpen(open);
          if (!open) setSelectedItem(null);
        }}
        item={selectedItem}
        onSubmit={handleSubmit}
        isSubmitting={createMutation.isPending || updateMutation.isPending}
      />

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar descuento predefinido?</AlertDialogTitle>
            <AlertDialogDescription>
              Se eliminará &quot;{selectedItem?.name}&quot;. Esta acción no se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteMutation.mutate()}
              disabled={deleteMutation.isPending}
            >
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
```

- [ ] **Step 4: Crear DiscountPresetsList.tsx (Server Component)**

Crear `src/modules/company/features/discount-presets/list/DiscountPresetsList.tsx`:

```typescript
import type { DataTableSearchParams } from '@/shared/components/common/DataTable';
import { PermissionGuard } from '@/shared/components/common/PermissionGuard';
import { getDiscountPresetsPaginated } from './actions.server';
import { _DiscountPresetsTable } from './components/_DiscountPresetsTable';

interface Props {
  searchParams: DataTableSearchParams;
}

export async function DiscountPresetsList({ searchParams }: Props) {
  const { data, totalRows } = await getDiscountPresetsPaginated(searchParams);

  return (
    <PermissionGuard module="company.discount-presets" action="view" redirect>
      <div className="space-y-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Descuentos Predefinidos</h1>
          <p className="text-muted-foreground">
            Configurá descuentos rápidos para aplicar en facturas de venta.
          </p>
        </div>
        <_DiscountPresetsTable
          data={data}
          totalRows={totalRows}
          searchParams={searchParams}
        />
      </div>
    </PermissionGuard>
  );
}
```

- [ ] **Step 5: Crear index.ts y page.tsx**

Crear `src/modules/company/features/discount-presets/index.ts`:

```typescript
export { DiscountPresetsList } from './list/DiscountPresetsList';
```

Crear `src/app/(core)/dashboard/company/discount-presets/page.tsx`:

```typescript
import type { Metadata } from 'next';
import type { DataTableSearchParams } from '@/shared/components/common/DataTable';
import { DiscountPresetsList } from '@/modules/company/features/discount-presets';

export const metadata: Metadata = {
  title: 'Descuentos Predefinidos',
};

interface Props {
  searchParams: Promise<DataTableSearchParams>;
}

export default async function DiscountPresetsPage({ searchParams }: Props) {
  const params = await searchParams;
  return <DiscountPresetsList searchParams={params} />;
}
```

- [ ] **Step 6: Agregar nav item en sidebar**

En `src/shared/components/layout/_AppSidebar.tsx`, en la sección de configuración, buscar el bloque de "Almacenes" (con icono Package) y agregar después un nuevo grupo:

```typescript
{
  title: 'Comercial',
  icon: BadgePercent,
  items: [
    {
      title: 'Descuentos Predefinidos',
      href: '/dashboard/company/discount-presets',
      module: 'company.discount-presets',
    },
  ],
},
```

Agregar `BadgePercent` al import de lucide-react.

- [ ] **Step 7: Verificar tipos y lint**

```bash
npm run check-types 2>&1 | grep -i "discount"
npx eslint src/modules/company/features/discount-presets/ src/app/\(core\)/dashboard/company/discount-presets/
```

Expected: sin errores.

- [ ] **Step 8: Commit**

```bash
git add src/modules/company/features/discount-presets/ src/app/\(core\)/dashboard/company/discount-presets/ src/shared/components/layout/_AppSidebar.tsx
git commit -m "feat(company): add discount presets CRUD with UI, sidebar nav, and permissions"
```

---

## Task 5: Actualizar validadores de factura

**Files:**
- Modify: `src/modules/commercial/features/sales/features/invoices/shared/validators.ts`

- [ ] **Step 1: Agregar campos de descuento a los schemas**

En `validators.ts`, agregar campos de descuento al `invoiceLineSchema`:

```typescript
export const invoiceLineSchema = z.object({
  productId: z.string().uuid('Producto inválido'),
  description: z.string().min(1, 'La descripción es requerida'),
  quantity: z
    .string()
    .min(1, 'La cantidad es requerida')
    .regex(/^\d+(\.\d{1,3})?$/, 'Cantidad inválida'),
  unitPrice: z
    .string()
    .min(1, 'El precio es requerido')
    .regex(/^\d+(\.\d{1,2})?$/, 'Precio inválido'),
  vatRate: z
    .string()
    .regex(/^\d+(\.\d{1,2})?$/, 'Alícuota de IVA inválida'),
  discountPercent: z.string().optional(),
  discountAmount: z.string().optional(),
});
```

Al `invoiceFormSchema`, agregar campos de descuento global:

```typescript
export const invoiceFormSchema = z.object({
  // ... campos existentes sin cambios ...
  globalDiscountPercent: z.string().optional(),
  globalDiscountAmount: z.string().optional(),
  lines: z.array(invoiceLineSchema).min(1, 'Debe agregar al menos una línea'),
});
```

Al `createInvoiceSchema` (server-side), agregar las transformaciones en la línea y en el schema raíz:

En la línea del schema server-side, agregar:

```typescript
  discountPercent: z
    .string()
    .optional()
    .transform((val) => (val ? parseFloat(val) : null))
    .pipe(z.number().min(0).max(100).nullable()),
  discountAmount: z
    .string()
    .optional()
    .transform((val) => (val ? parseFloat(val) : null))
    .pipe(z.number().nonnegative().nullable()),
```

En el schema raíz server-side, agregar:

```typescript
  globalDiscountPercent: z
    .string()
    .optional()
    .transform((val) => (val ? parseFloat(val) : null))
    .pipe(z.number().min(0).max(100).nullable()),
  globalDiscountAmount: z
    .string()
    .optional()
    .transform((val) => (val ? parseFloat(val) : null))
    .pipe(z.number().nonnegative().nullable()),
```

- [ ] **Step 2: Commit**

```bash
git add src/modules/commercial/features/sales/features/invoices/shared/validators.ts
git commit -m "feat(commercial): add discount fields to invoice validators"
```

---

## Task 6: Actualizar lógica de cálculo en actions

**Files:**
- Modify: `src/modules/commercial/features/sales/features/invoices/list/actions.server.ts`

- [ ] **Step 1: Actualizar calculateLineAmounts()**

Reemplazar la función `calculateLineAmounts` existente:

```typescript
function calculateLineAmounts(
  quantity: number,
  unitPrice: number,
  vatRate: number,
  discountPercent: number | null,
  discountAmount: number | null,
): {
  baseAmount: number;
  discountValue: number;
  subtotal: number;
  vatAmount: number;
  total: number;
} {
  const baseAmount = quantity * unitPrice;

  let discountValue = 0;
  if (discountPercent != null && discountPercent > 0) {
    discountValue = baseAmount * (discountPercent / 100);
  } else if (discountAmount != null && discountAmount > 0) {
    discountValue = Math.min(discountAmount, baseAmount);
  }

  const subtotal = baseAmount - discountValue;
  const vatAmount = subtotal * (vatRate / 100);
  const total = subtotal + vatAmount;

  return {
    baseAmount: Math.round(baseAmount * 100) / 100,
    discountValue: Math.round(discountValue * 100) / 100,
    subtotal: Math.round(subtotal * 100) / 100,
    vatAmount: Math.round(vatAmount * 100) / 100,
    total: Math.round(total * 100) / 100,
  };
}
```

- [ ] **Step 2: Agregar función de cálculo de descuento global**

Agregar debajo de `calculateLineAmounts`:

```typescript
function calculateGlobalDiscount(
  sumLineSubtotals: number,
  globalDiscountPercent: number | null,
  globalDiscountAmount: number | null,
): number {
  if (globalDiscountPercent != null && globalDiscountPercent > 0) {
    return Math.round(sumLineSubtotals * (globalDiscountPercent / 100) * 100) / 100;
  }
  if (globalDiscountAmount != null && globalDiscountAmount > 0) {
    return Math.round(Math.min(globalDiscountAmount, sumLineSubtotals) * 100) / 100;
  }
  return 0;
}

function calculateInvoiceTotalsWithGlobalDiscount(
  linesData: Array<{ subtotal: number; vatRate: number }>,
  globalDiscount: number,
): { invoiceSubtotal: number; invoiceVatAmount: number } {
  const sumLineSubtotals = linesData.reduce((acc, l) => acc + l.subtotal, 0);

  if (globalDiscount <= 0 || sumLineSubtotals <= 0) {
    return {
      invoiceSubtotal: sumLineSubtotals,
      invoiceVatAmount: linesData.reduce(
        (acc, l) => acc + l.subtotal * (l.vatRate / 100),
        0,
      ),
    };
  }

  // Distribuir proporcionalmente para recalcular IVA por alícuota
  let invoiceVatAmount = 0;
  for (const line of linesData) {
    const weight = line.subtotal / sumLineSubtotals;
    const lineGlobalDiscount = globalDiscount * weight;
    const discountedBase = line.subtotal - lineGlobalDiscount;
    invoiceVatAmount += discountedBase * (line.vatRate / 100);
  }

  return {
    invoiceSubtotal: Math.round((sumLineSubtotals - globalDiscount) * 100) / 100,
    invoiceVatAmount: Math.round(invoiceVatAmount * 100) / 100,
  };
}
```

- [ ] **Step 3: Actualizar createInvoice()**

En la función `createInvoice()`, reemplazar el bloque de cálculo de líneas y totales. Donde actualmente se calcula `linesData`:

```typescript
  let totalLineDiscounts = 0;

  const linesData = validatedData.lines.map((line) => {
    const amounts = calculateLineAmounts(
      line.quantity,
      line.unitPrice,
      line.vatRate,
      line.discountPercent,
      line.discountAmount,
    );

    totalLineDiscounts += amounts.discountValue;

    return {
      productId: line.productId,
      description: line.description,
      quantity: new Prisma.Decimal(line.quantity),
      unitPrice: new Prisma.Decimal(line.unitPrice),
      vatRate: new Prisma.Decimal(line.vatRate),
      discountPercent: line.discountPercent != null ? new Prisma.Decimal(line.discountPercent) : null,
      discountAmount: line.discountAmount != null ? new Prisma.Decimal(line.discountAmount) : null,
      vatAmount: new Prisma.Decimal(amounts.vatAmount),
      subtotal: new Prisma.Decimal(amounts.subtotal),
      total: new Prisma.Decimal(amounts.total),
    };
  });

  const sumLineSubtotals = linesData.reduce(
    (acc, l) => acc + Number(l.subtotal),
    0,
  );

  const globalDiscount = calculateGlobalDiscount(
    sumLineSubtotals,
    validatedData.globalDiscountPercent,
    validatedData.globalDiscountAmount,
  );

  const { invoiceSubtotal, invoiceVatAmount } = calculateInvoiceTotalsWithGlobalDiscount(
    validatedData.lines.map((line, i) => ({
      subtotal: Number(linesData[i].subtotal),
      vatRate: line.vatRate,
    })),
    globalDiscount,
  );

  const invoiceTotal = invoiceSubtotal + invoiceVatAmount;
  const totalBeforeDiscount = sumLineSubtotals;
  const discountTotal = totalLineDiscounts + globalDiscount;
```

Y en el `prisma.salesInvoice.create`, agregar los campos nuevos:

```typescript
  globalDiscountPercent: validatedData.globalDiscountPercent != null
    ? new Prisma.Decimal(validatedData.globalDiscountPercent)
    : null,
  globalDiscountAmount: validatedData.globalDiscountAmount != null
    ? new Prisma.Decimal(validatedData.globalDiscountAmount)
    : null,
  totalBeforeDiscount: new Prisma.Decimal(totalBeforeDiscount),
  discountTotal: new Prisma.Decimal(discountTotal),
  subtotal: new Prisma.Decimal(invoiceSubtotal),
  vatAmount: new Prisma.Decimal(invoiceVatAmount),
  total: new Prisma.Decimal(invoiceTotal),
```

- [ ] **Step 4: Actualizar updateInvoice() con la misma lógica**

La función `updateInvoice()` usa la misma lógica de cálculo. Aplicar los mismos cambios que en `createInvoice()` — reemplazar el bloque de cálculo de líneas y totales, y agregar los campos nuevos al `prisma.salesInvoice.update`.

- [ ] **Step 5: Actualizar getInvoiceById()**

En `getInvoiceById()`, agregar los campos nuevos al `select` del query y al return con `Number()`:

En el select de la query, agregar:
```typescript
  globalDiscountPercent: true,
  globalDiscountAmount: true,
  totalBeforeDiscount: true,
  discountTotal: true,
```

En el select de las lines, agregar:
```typescript
  discountPercent: true,
  discountAmount: true,
```

En el return, convertir a Number():
```typescript
  globalDiscountPercent: invoice.globalDiscountPercent ? Number(invoice.globalDiscountPercent) : null,
  globalDiscountAmount: invoice.globalDiscountAmount ? Number(invoice.globalDiscountAmount) : null,
  totalBeforeDiscount: Number(invoice.totalBeforeDiscount),
  discountTotal: Number(invoice.discountTotal),
```

Y en las líneas:
```typescript
  discountPercent: line.discountPercent ? Number(line.discountPercent) : null,
  discountAmount: line.discountAmount ? Number(line.discountAmount) : null,
```

- [ ] **Step 6: Verificar tipos**

```bash
npm run check-types 2>&1 | grep -i "invoice\|discount"
```

- [ ] **Step 7: Commit**

```bash
git add src/modules/commercial/features/sales/features/invoices/list/actions.server.ts
git commit -m "feat(commercial): update invoice calculation logic with discount support"
```

---

## Task 7: Actualizar formulario de factura

**Files:**
- Modify: `src/modules/commercial/features/sales/features/invoices/create/components/_InvoiceForm.tsx`

- [ ] **Step 1: Agregar import de getDiscountPresetsForSelect y estado**

Agregar imports al inicio del archivo:

```typescript
import { useQuery } from '@tanstack/react-query';
import { BadgePercent } from 'lucide-react';
import { getDiscountPresetsForSelect } from '@/modules/company/features/discount-presets/list/actions.server';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/shared/components/ui/popover';
```

Dentro del componente, agregar query de presets:

```typescript
const { data: discountPresets = [] } = useQuery({
  queryKey: ['discount-presets-select'],
  queryFn: getDiscountPresetsForSelect,
});
```

- [ ] **Step 2: Actualizar defaultValues y handleAddLine**

En `handleAddLine`, agregar campos de descuento:

```typescript
const handleAddLine = () => {
  append({
    productId: '',
    description: '',
    quantity: '1',
    unitPrice: '0',
    vatRate: '21',
    discountPercent: '',
    discountAmount: '',
  });
};
```

En los defaultValues del form (si tiene initialData para edit mode), agregar los campos de descuento:

```typescript
discountPercent: line.discountPercent?.toString() ?? '',
discountAmount: line.discountAmount?.toString() ?? '',
```

Y agregar globalDiscountPercent/globalDiscountAmount en los defaultValues del form raíz:

```typescript
globalDiscountPercent: initialData?.globalDiscountPercent?.toString() ?? '',
globalDiscountAmount: initialData?.globalDiscountAmount?.toString() ?? '',
```

- [ ] **Step 3: Actualizar _LineTotals para incluir descuento**

Reemplazar el componente `_LineTotals`:

```typescript
function _LineTotals({ form, index }: { form: ReturnType<typeof useForm<FormInput>>; index: number }) {
  const line = useWatch({ control: form.control, name: `lines.${index}` });

  const qty = parseFloat(line?.quantity ?? '0');
  const price = parseFloat(line?.unitPrice ?? '0');
  const dtoPercent = parseFloat(line?.discountPercent ?? '0');
  const dtoAmount = parseFloat(line?.discountAmount ?? '0');
  const vat = parseFloat(line?.vatRate ?? '0');

  const baseAmount = isNaN(qty) || isNaN(price) ? 0 : Math.round(qty * price * 100) / 100;

  let discountValue = 0;
  if (!isNaN(dtoPercent) && dtoPercent > 0) {
    discountValue = Math.round(baseAmount * (dtoPercent / 100) * 100) / 100;
  } else if (!isNaN(dtoAmount) && dtoAmount > 0) {
    discountValue = Math.round(Math.min(dtoAmount, baseAmount) * 100) / 100;
  }

  const neto = Math.round((baseAmount - discountValue) * 100) / 100;
  const iva = isNaN(vat) ? 0 : Math.round(neto * (vat / 100) * 100) / 100;
  const total = Math.round((neto + iva) * 100) / 100;

  return (
    <div className="flex justify-end gap-4 text-sm text-muted-foreground font-mono pt-1">
      {discountValue > 0 && <span className="text-orange-600">Dto: -{formatCurrency(discountValue)}</span>}
      <span>Neto: {formatCurrency(neto)}</span>
      <span>IVA: {formatCurrency(iva)}</span>
      <span className="font-semibold text-foreground">Total: {formatCurrency(total)}</span>
    </div>
  );
}
```

- [ ] **Step 4: Agregar campos Dto% y Dto$ en cada línea**

Dentro del loop `fields.map((field, index) =>`, después del campo `unitPrice` y antes de `description`, agregar:

```typescript
{/* Descuento % */}
<div className="space-y-1">
  <Label className="text-xs">Dto %</Label>
  <div className="flex gap-1">
    <Input
      type="number"
      step="0.01"
      min="0"
      max="100"
      placeholder="0"
      className="w-20"
      {...form.register(`lines.${index}.discountPercent`, {
        onChange: (e) => {
          if (e.target.value) {
            form.setValue(`lines.${index}.discountAmount`, '');
          }
        },
      })}
    />
    {discountPresets.length > 0 && (
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="icon" className="size-8" type="button">
            <BadgePercent className="size-4" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-48 p-1" align="start">
          {discountPresets.map((preset) => (
            <Button
              key={preset.id}
              variant="ghost"
              size="sm"
              className="w-full justify-start"
              type="button"
              onClick={() => {
                form.setValue(`lines.${index}.discountPercent`, preset.percentage.toString());
                form.setValue(`lines.${index}.discountAmount`, '');
              }}
            >
              {preset.name} ({preset.percentage}%)
            </Button>
          ))}
        </PopoverContent>
      </Popover>
    )}
  </div>
</div>

{/* Descuento $ */}
<div className="space-y-1">
  <Label className="text-xs">Dto $</Label>
  <Input
    type="number"
    step="0.01"
    min="0"
    placeholder="0"
    className="w-24"
    {...form.register(`lines.${index}.discountAmount`, {
      onChange: (e) => {
        if (e.target.value) {
          form.setValue(`lines.${index}.discountPercent`, '');
        }
      },
    })}
  />
</div>
```

- [ ] **Step 5: Agregar sección de descuento global**

Después de las líneas y antes de la Card de totales, agregar:

```typescript
{fields.length > 0 && (
  <Card className="p-4">
    <h4 className="text-sm font-semibold mb-3">Descuento Global</h4>
    <div className="flex flex-wrap items-end gap-4">
      <div className="space-y-1">
        <Label className="text-xs">Porcentaje (%)</Label>
        <div className="flex gap-1">
          <Input
            type="number"
            step="0.01"
            min="0"
            max="100"
            placeholder="0"
            className="w-24"
            {...form.register('globalDiscountPercent', {
              onChange: (e) => {
                if (e.target.value) {
                  form.setValue('globalDiscountAmount', '');
                }
              },
            })}
          />
          {discountPresets.length > 0 && (
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="ghost" size="icon" className="size-8" type="button">
                  <BadgePercent className="size-4" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-48 p-1" align="start">
                {discountPresets.map((preset) => (
                  <Button
                    key={preset.id}
                    variant="ghost"
                    size="sm"
                    className="w-full justify-start"
                    type="button"
                    onClick={() => {
                      form.setValue('globalDiscountPercent', preset.percentage.toString());
                      form.setValue('globalDiscountAmount', '');
                    }}
                  >
                    {preset.name} ({preset.percentage}%)
                  </Button>
                ))}
              </PopoverContent>
            </Popover>
          )}
        </div>
      </div>
      <div className="space-y-1">
        <Label className="text-xs">Monto fijo ($)</Label>
        <Input
          type="number"
          step="0.01"
          min="0"
          placeholder="0"
          className="w-32"
          {...form.register('globalDiscountAmount', {
            onChange: (e) => {
              if (e.target.value) {
                form.setValue('globalDiscountPercent', '');
              }
            },
          })}
        />
      </div>
    </div>
  </Card>
)}
```

- [ ] **Step 6: Actualizar useEffect de totales**

Reemplazar el useEffect que calcula totales para incluir descuentos:

```typescript
useEffect(() => {
  const subscription = form.watch((value) => {
    if (value.lines) {
      let subtotalBeforeDiscount = 0;
      let lineDiscountsTotal = 0;
      let sumLineSubtotals = 0;
      const lineDetails: Array<{ subtotal: number; vatRate: number }> = [];

      value.lines.forEach((line) => {
        if (line?.quantity && line?.unitPrice && line?.vatRate) {
          const qty = parseFloat(line.quantity);
          const price = parseFloat(line.unitPrice);
          const vat = parseFloat(line.vatRate);
          const dtoPercent = parseFloat(line.discountPercent ?? '0');
          const dtoAmount = parseFloat(line.discountAmount ?? '0');

          const baseAmount = qty * price;
          subtotalBeforeDiscount += baseAmount;

          let discountValue = 0;
          if (!isNaN(dtoPercent) && dtoPercent > 0) {
            discountValue = baseAmount * (dtoPercent / 100);
          } else if (!isNaN(dtoAmount) && dtoAmount > 0) {
            discountValue = Math.min(dtoAmount, baseAmount);
          }
          lineDiscountsTotal += discountValue;

          const lineSubtotal = baseAmount - discountValue;
          sumLineSubtotals += lineSubtotal;
          lineDetails.push({ subtotal: lineSubtotal, vatRate: vat });
        }
      });

      // Descuento global
      const gDtoPercent = parseFloat(value.globalDiscountPercent ?? '0');
      const gDtoAmount = parseFloat(value.globalDiscountAmount ?? '0');

      let globalDiscount = 0;
      if (!isNaN(gDtoPercent) && gDtoPercent > 0) {
        globalDiscount = sumLineSubtotals * (gDtoPercent / 100);
      } else if (!isNaN(gDtoAmount) && gDtoAmount > 0) {
        globalDiscount = Math.min(gDtoAmount, sumLineSubtotals);
      }

      // IVA sobre base descontada (distribución proporcional)
      let vatAmount = 0;
      if (globalDiscount > 0 && sumLineSubtotals > 0) {
        for (const ld of lineDetails) {
          const weight = ld.subtotal / sumLineSubtotals;
          const discountedBase = ld.subtotal - globalDiscount * weight;
          vatAmount += discountedBase * (ld.vatRate / 100);
        }
      } else {
        vatAmount = lineDetails.reduce((acc, ld) => acc + ld.subtotal * (ld.vatRate / 100), 0);
      }

      const invoiceSubtotal = sumLineSubtotals - globalDiscount;

      setTotals({
        subtotalBeforeDiscount: Math.round(subtotalBeforeDiscount * 100) / 100,
        lineDiscounts: Math.round(lineDiscountsTotal * 100) / 100,
        globalDiscount: Math.round(globalDiscount * 100) / 100,
        subtotal: Math.round(invoiceSubtotal * 100) / 100,
        vatAmount: Math.round(vatAmount * 100) / 100,
        total: Math.round((invoiceSubtotal + vatAmount) * 100) / 100,
      });
    }
  });

  return () => subscription.unsubscribe();
}, [form]);
```

Actualizar el state de totals para incluir los campos nuevos:

```typescript
const [totals, setTotals] = useState({
  subtotalBeforeDiscount: 0,
  lineDiscounts: 0,
  globalDiscount: 0,
  subtotal: 0,
  vatAmount: 0,
  total: 0,
});
```

- [ ] **Step 7: Actualizar sección de totales en el render**

Reemplazar la Card de totales:

```typescript
{fields.length > 0 && (
  <Card className="p-6">
    <h3 className="text-lg font-semibold mb-4">Totales</h3>
    <div className="space-y-2 max-w-sm ml-auto">
      {(totals.lineDiscounts > 0 || totals.globalDiscount > 0) && (
        <>
          <div className="flex justify-between">
            <span>Subtotal (antes dto):</span>
            <span className="font-mono">
              {totals.subtotalBeforeDiscount.toLocaleString('es-AR', { style: 'currency', currency: 'ARS' })}
            </span>
          </div>
          {totals.lineDiscounts > 0 && (
            <div className="flex justify-between text-orange-600">
              <span>Descuento líneas:</span>
              <span className="font-mono">
                -{totals.lineDiscounts.toLocaleString('es-AR', { style: 'currency', currency: 'ARS' })}
              </span>
            </div>
          )}
          {totals.globalDiscount > 0 && (
            <div className="flex justify-between text-orange-600">
              <span>Descuento global:</span>
              <span className="font-mono">
                -{totals.globalDiscount.toLocaleString('es-AR', { style: 'currency', currency: 'ARS' })}
              </span>
            </div>
          )}
        </>
      )}
      <div className="flex justify-between">
        <span>Base imponible:</span>
        <span className="font-mono">
          {totals.subtotal.toLocaleString('es-AR', { style: 'currency', currency: 'ARS' })}
        </span>
      </div>
      <div className="flex justify-between">
        <span>IVA:</span>
        <span className="font-mono">
          {totals.vatAmount.toLocaleString('es-AR', { style: 'currency', currency: 'ARS' })}
        </span>
      </div>
      <Separator />
      <div className="flex justify-between text-lg font-semibold">
        <span>Total:</span>
        <span className="font-mono">
          {totals.total.toLocaleString('es-AR', { style: 'currency', currency: 'ARS' })}
        </span>
      </div>
    </div>
  </Card>
)}
```

- [ ] **Step 8: Verificar tipos y lint**

```bash
npm run check-types 2>&1 | grep -i "invoice\|discount"
npx eslint src/modules/commercial/features/sales/features/invoices/create/
```

- [ ] **Step 9: Commit**

```bash
git add src/modules/commercial/features/sales/features/invoices/
git commit -m "feat(commercial): add discount fields to invoice form with presets selector"
```

---

## Task 8: Actualizar detalle de factura

**Files:**
- Modify: `src/modules/commercial/features/sales/features/invoices/detail/InvoiceDetail.tsx`

- [ ] **Step 1: Agregar columna Dto. en la tabla de líneas**

En la tabla de líneas del detalle, agregar columna "Dto." entre "Precio Unit." e "IVA %":

En el header:
```typescript
<TableHead className="text-right">Dto.</TableHead>
```

En cada fila:
```typescript
<TableCell className="text-right font-mono">
  {line.discountPercent
    ? `${line.discountPercent}%`
    : line.discountAmount
      ? `$${line.discountAmount.toLocaleString('es-AR', { minimumFractionDigits: 2 })}`
      : '-'}
</TableCell>
```

- [ ] **Step 2: Actualizar sección de totales**

Agregar filas de descuento en la sección de totales (solo cuando hay descuentos):

```typescript
{(invoice.discountTotal > 0) && (
  <>
    <div className="flex justify-between">
      <span>Subtotal (antes dto):</span>
      <span className="font-mono">
        {invoice.totalBeforeDiscount.toLocaleString('es-AR', { style: 'currency', currency: 'ARS' })}
      </span>
    </div>
    <div className="flex justify-between text-orange-600">
      <span>Descuento total:</span>
      <span className="font-mono">
        -{invoice.discountTotal.toLocaleString('es-AR', { style: 'currency', currency: 'ARS' })}
      </span>
    </div>
  </>
)}
```

Si hay descuento global, mostrarlo:
```typescript
{invoice.globalDiscountPercent && (
  <div className="text-sm text-muted-foreground">
    Descuento global: {invoice.globalDiscountPercent}%
  </div>
)}
{invoice.globalDiscountAmount && (
  <div className="text-sm text-muted-foreground">
    Descuento global: ${invoice.globalDiscountAmount.toLocaleString('es-AR', { minimumFractionDigits: 2 })}
  </div>
)}
```

- [ ] **Step 3: Commit**

```bash
git add src/modules/commercial/features/sales/features/invoices/detail/
git commit -m "feat(commercial): show discount info in invoice detail view"
```

---

## Task 9: Actualizar PDF de factura

**Files:**
- Modify: `src/modules/commercial/features/sales/shared/pdf/types.ts`
- Modify: `src/modules/commercial/features/sales/shared/pdf/InvoiceTemplate.tsx`

- [ ] **Step 1: Actualizar tipos del PDF**

En `types.ts`, agregar campos de descuento a las líneas y totales:

En `lines` array item, agregar:
```typescript
  discountPercent?: number | null;
  discountAmount?: number | null;
```

En `totals`, agregar:
```typescript
  totalBeforeDiscount?: number;
  discountTotal?: number;
  globalDiscountPercent?: number | null;
  globalDiscountAmount?: number | null;
```

- [ ] **Step 2: Actualizar template**

En `InvoiceTemplate.tsx`:

En el header de la tabla, agregar columna "Dto." condicional (solo si alguna línea tiene descuento):

```typescript
const hasAnyDiscount = lines.some(
  (l) => (l.discountPercent && l.discountPercent > 0) || (l.discountAmount && l.discountAmount > 0)
);
```

Agregar columna si `hasAnyDiscount`:
```typescript
{hasAnyDiscount && <Text style={styles.colDto}>Dto.</Text>}
```

En cada fila:
```typescript
{hasAnyDiscount && (
  <Text style={styles.colDto}>
    {line.discountPercent ? `${line.discountPercent}%` : line.discountAmount ? `$${line.discountAmount.toFixed(2)}` : ''}
  </Text>
)}
```

En la sección de totales, agregar filas de descuento antes del subtotal (solo cuando hay descuentos):

```typescript
{totals.discountTotal && totals.discountTotal > 0 && (
  <>
    <View style={styles.totalRow}>
      <Text style={styles.totalLabel}>Subtotal (antes dto):</Text>
      <Text style={styles.totalValue}>
        ${(totals.totalBeforeDiscount ?? totals.subtotal).toLocaleString('es-AR', { minimumFractionDigits: 2 })}
      </Text>
    </View>
    <View style={styles.totalRow}>
      <Text style={styles.totalLabel}>Descuento:</Text>
      <Text style={styles.totalValue}>
        -${totals.discountTotal.toLocaleString('es-AR', { minimumFractionDigits: 2 })}
      </Text>
    </View>
  </>
)}
```

- [ ] **Step 3: Actualizar mapeo de datos para el PDF**

Buscar donde se construye `InvoicePDFData` (probablemente en la action que genera el PDF o en el componente que lo llama) y agregar los campos nuevos al mapeo de líneas y totales.

- [ ] **Step 4: Commit**

```bash
git add src/modules/commercial/features/sales/shared/pdf/
git commit -m "feat(commercial): add discount column and totals to invoice PDF"
```

---

## Task 10: Actualizar EditInvoice para pasar descuentos

**Files:**
- Modify: `src/modules/commercial/features/sales/features/invoices/edit/EditInvoice.tsx`

- [ ] **Step 1: Agregar campos de descuento a initialData**

En `EditInvoice.tsx`, donde se mapean los datos para `initialData`, agregar:

En las líneas:
```typescript
discountPercent: line.discountPercent?.toString() ?? '',
discountAmount: line.discountAmount?.toString() ?? '',
```

En el form data raíz:
```typescript
globalDiscountPercent: invoice.globalDiscountPercent?.toString() ?? '',
globalDiscountAmount: invoice.globalDiscountAmount?.toString() ?? '',
```

- [ ] **Step 2: Commit**

```bash
git add src/modules/commercial/features/sales/features/invoices/edit/
git commit -m "feat(commercial): pass discount data to edit invoice form"
```

---

## Task 11: Verificación final

- [ ] **Step 1: Verificar tipos globales**

```bash
npm run check-types 2>&1 | tail -20
```

- [ ] **Step 2: Verificar lint**

```bash
npm run lint 2>&1 | tail -20
```

- [ ] **Step 3: Test manual - crear factura con descuentos**

1. Ir a Facturación > Nueva Factura
2. Agregar línea con producto
3. Aplicar Dto% en la línea → verificar que totales recalculan
4. Limpiar Dto% y aplicar Dto$ → verificar exclusión mutua
5. Aplicar descuento global % → verificar que IVA se recalcula
6. Guardar factura → verificar que se persiste correctamente
7. Ver detalle → verificar columna Dto. y totales con descuento
8. Descargar PDF → verificar columna y totales

- [ ] **Step 4: Test manual - CRUD presets**

1. Ir a Configuración > Comercial > Descuentos Predefinidos
2. Crear preset "Mecánico" 15%
3. Crear preset "Mayorista" 20%
4. Editar preset → cambiar porcentaje
5. En factura nueva → verificar que aparecen en el selector de presets
6. Eliminar preset → verificar que desaparece

- [ ] **Step 5: Commit final**

```bash
git add -A
git commit -m "feat(commercial): flexible discounts in sales invoices

- Line-level discounts (% or $, mutually exclusive)
- Global invoice discount (% or $)
- Discount presets CRUD (company config)
- Preset selector in invoice form
- Updated detail view and PDF with discount info
- VAT calculated on discounted base (AFIP compliant)"
```
