# Patrones de UI

---

## shadcn/ui

El proyecto usa shadcn/ui como biblioteca de componentes. Los componentes estan en `src/shared/components/ui/`.

Componentes disponibles (40+): alert-dialog, alert, avatar, badge, button, calendar, card, chart, checkbox, collapsible, command, date-range-picker, dialog, drawer, dropdown-menu, form, input, label, navigation-menu, popover, radio-group, resizable, scroll-area, select, separator, sheet, sidebar, skeleton, sonner, switch, table, tabs, textarea, toggle-group, toggle, tooltip, url-tabs.

### Agregar un Componente Nuevo

```bash
npx shadcn@latest add <nombre-componente>
```

Se instala automaticamente en `src/shared/components/ui/`.

---

## DataTable

Componente reutilizable en `src/shared/components/common/DataTable/`.

Documentacion detallada: `src/shared/components/common/DataTable/DOCS.md`

### Uso Basico

```typescript
import { DataTable } from '@/shared/components/common/DataTable';

const columns: ColumnDef<Item>[] = [
  {
    accessorKey: 'name',
    header: 'Nombre',
    meta: { title: 'Nombre' },  // OBLIGATORIO
  },
];

<DataTable columns={columns} data={data} />
```

### Regla: `meta.title` Obligatorio

Todas las columnas deben tener `meta.title` para la UI de visibilidad de columnas.

### Funcionalidades

- Paginacion server-side
- Busqueda (input con debounce)
- Filtros facetados (multi-select)
- Ordenamiento por columna
- Visibilidad de columnas
- Exportacion a Excel
- Seleccion de filas

### Archivos Separados

La definicion de columnas va en un archivo `columns.tsx` separado:

```
features/list/
├── actions.server.ts
├── {Module}List.tsx
├── columns.tsx          ← Definicion de columnas
└── components/
    └── _Table.tsx       ← Client component con DataTable
```

---

## Formularios

### React Hook Form + Zod

```typescript
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

const schema = z.object({
  name: z.string().min(2, 'Minimo 2 caracteres'),
  email: z.string().email('Email invalido'),
});

type FormData = z.infer<typeof schema>;

const form = useForm<FormData>({
  resolver: zodResolver(schema),
  defaultValues: { name: '', email: '' },
});
```

### Componentes de Formulario

Usar los componentes de shadcn/ui `Form`:

```tsx
<Form {...form}>
  <FormField
    control={form.control}
    name="name"
    render={({ field }) => (
      <FormItem>
        <FormLabel>Nombre</FormLabel>
        <FormControl>
          <Input {...field} />
        </FormControl>
        <FormMessage />
      </FormItem>
    )}
  />
</Form>
```

### Campos de fecha: `_DateInput`

Para un campo de fecha cuyo valor es un `Date`, usar `_DateInput`
(`@/shared/components/common/_DateInput`) en lugar de `<Input type="date">` con conversión a mano:

```tsx
<FormField
  control={form.control}
  name="issueDate"
  render={({ field }) => (
    <FormItem>
      <FormLabel>Fecha de Emisión *</FormLabel>
      <FormControl>
        <_DateInput {...field} />
      </FormControl>
      <FormMessage />
    </FormItem>
  )}
/>
```

- Mientras un segmento está a medio tipear, el navegador reporta `''`. `_DateInput` emite `null` en ese
  caso (nunca un `Date` inválido) y guarda localmente lo que se ve, así React no reescribe el input a
  mitad del tipeo. El patrón `new Date(e.target.value + 'T12:00:00')` sin contemplar el vacío vaciaba
  el campo al tipear el mes (TSK-782).
- `mode="local"` (por defecto): el día a las 12:00 locales, convención de los formularios comerciales.
  `mode="utc"`: el día a las 00:00Z, convención del núcleo contable (D8 de TSK-760).
- Con un schema `z.date({ message: '… es requerida' })`, una fecha incompleta al guardar muestra ese
  mensaje. Fuera de un formulario (filtros), el estado es `Date | null` y la acción espera fechas completas.
- La conversión pura está en `@/shared/utils/date-input` (`toDateInputValue`, `fromDateInputValue`).
- Los campos que guardan la fecha como string `'YYYY-MM-DD'` no tienen el problema y pueden seguir con
  `<Input type="date">`.

### Schemas en `validators.ts`

Los schemas Zod van en el archivo `validators.ts` de cada feature o en `shared/validators.ts` si son compartidos.

---

## Modales y Dialogs

Usar `Dialog` de shadcn/ui:

```tsx
<Dialog open={open} onOpenChange={setOpen}>
  <DialogTrigger asChild>
    <Button>Abrir</Button>
  </DialogTrigger>
  <DialogContent>
    <DialogHeader>
      <DialogTitle>Titulo</DialogTitle>
      <DialogDescription>Descripcion</DialogDescription>
    </DialogHeader>
    {/* Contenido */}
    <DialogFooter>
      <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
      <Button onClick={handleSubmit}>Guardar</Button>
    </DialogFooter>
  </DialogContent>
</Dialog>
```

---

## Notificaciones

Usar Sonner para toasts:

```typescript
import { toast } from 'sonner';

toast.success('Guardado correctamente');
toast.error('Error al guardar');
toast.loading('Guardando...');
```

---

## Tabs con URL

Para tabs sincronizados con la URL, usar `url-tabs`:

```tsx
import { URLTabs } from '@/shared/components/ui/url-tabs';

<URLTabs
  tabs={[
    { value: 'general', label: 'General', content: <GeneralTab /> },
    { value: 'documents', label: 'Documentos', content: <DocsTab /> },
  ]}
  defaultTab="general"
/>
```

La tab activa se refleja en el query param `?tab=`.

---

## Responsive Design

- **Mobile-first:** Disenar primero para mobile, expandir para desktop
- **Sidebar colapsable:** Se colapsa automaticamente en mobile
- **Tablas:** Scroll horizontal en mobile
- **Cards:** Grid responsive (`grid-cols-1 md:grid-cols-2 lg:grid-cols-3`)
- **Modales:** Full-screen en mobile, dialog en desktop

### Breakpoints Tailwind

```
sm:  640px
md:  768px
lg:  1024px
xl:  1280px
2xl: 1536px
```

---

## Iconos

Usar Lucide Icons:

```typescript
import { Plus, Pencil, Trash2, Search } from 'lucide-react';

<Button><Plus className="h-4 w-4 mr-2" /> Nuevo</Button>
```

---

## Mappers y Labels

Labels y badges para enums van en `shared/utils/mappers.ts`:

```typescript
import { statusLabels, statusBadges } from '@/shared/utils/mappers';

<Badge variant={statusBadges[status]}>{statusLabels[status]}</Badge>
```

**Nunca** definir mapeos inline en componentes.
