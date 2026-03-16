'use client';

import { useForm, useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import moment from 'moment';
import { Check, ChevronsUpDown, Plus, Trash2 } from 'lucide-react';

import { Button } from '@/shared/components/ui/button';
import { Card } from '@/shared/components/ui/card';
import { Input } from '@/shared/components/ui/input';
import { Textarea } from '@/shared/components/ui/textarea';
import { Separator } from '@/shared/components/ui/separator';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/shared/components/ui/form';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui/select';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/shared/components/ui/popover';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/shared/components/ui/command';
import { cn } from '@/shared/lib/utils';

import {
  deliveryNoteFormSchema,
  type DeliveryNoteFormInput,
} from '../../shared/validators';
import {
  createDeliveryNote,
  updateDeliveryNote,
} from '../../list/actions.server';

// ============================================
// TIPOS
// ============================================

interface Props {
  customers: Array<{ id: string; name: string; taxId: string | null }>;
  warehouses: Array<{ id: string; name: string; type: string }>;
  products: Array<{ id: string; code: string; name: string; unitOfMeasure: string }>;
  defaultWarehouseId?: string;
  editMode?: boolean;
  noteId?: string;
  defaultValues?: DeliveryNoteFormInput;
}

// ============================================
// COMPONENTE PRINCIPAL
// ============================================

export function _DeliveryNoteForm({
  customers,
  warehouses,
  products,
  defaultWarehouseId,
  editMode = false,
  noteId,
  defaultValues: initialValues,
}: Props) {
  const router = useRouter();

  const form = useForm<DeliveryNoteFormInput>({
    resolver: zodResolver(deliveryNoteFormSchema),
    defaultValues: initialValues ?? {
      customerId: '',
      warehouseId: defaultWarehouseId ?? '',
      deliveryDate: new Date(),
      notes: '',
      lines: [],
    },
  });

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: 'lines',
  });

  // ============================================
  // SUBMIT
  // ============================================

  const onSubmit = async (data: DeliveryNoteFormInput) => {
    try {
      if (editMode && noteId) {
        await updateDeliveryNote(noteId, data);
        toast.success('Remito de entrega actualizado correctamente');
        router.push(`/dashboard/commercial/delivery-notes/${noteId}`);
      } else {
        const result = await createDeliveryNote(data);
        toast.success('Remito de entrega creado correctamente');
        router.push(`/dashboard/commercial/delivery-notes/${result.id}`);
      }
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : `Error al ${editMode ? 'actualizar' : 'crear'} el remito`
      );
    }
  };

  // ============================================
  // RENDER
  // ============================================

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="space-y-6">
        {/* ─── SECCIÓN: Datos Generales ─── */}
        <Card className="p-6">
          <h3 className="text-lg font-semibold mb-4">Datos Generales</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

            {/* Cliente */}
            <FormField
              control={form.control}
              name="customerId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Cliente *</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Selecciona un cliente" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {customers.map((customer) => (
                        <SelectItem key={customer.id} value={customer.id}>
                          {customer.name}
                          {customer.taxId && (
                            <span className="ml-2 text-xs text-muted-foreground">
                              — {customer.taxId}
                            </span>
                          )}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Almacén */}
            <FormField
              control={form.control}
              name="warehouseId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Almacén *</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Selecciona un almacén" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {warehouses.map((warehouse) => (
                        <SelectItem key={warehouse.id} value={warehouse.id}>
                          {warehouse.name}
                          {warehouse.type === 'MAIN' && (
                            <span className="ml-2 text-xs text-muted-foreground">(Principal)</span>
                          )}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Fecha de Entrega */}
            <FormField
              control={form.control}
              name="deliveryDate"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Fecha de Entrega *</FormLabel>
                  <FormControl>
                    <Input
                      type="date"
                      value={field.value ? moment(field.value).format('YYYY-MM-DD') : ''}
                      onChange={(e) =>
                        field.onChange(
                          e.target.value ? new Date(e.target.value + 'T12:00:00') : null
                        )
                      }
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Observaciones */}
            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem className="md:col-span-2">
                  <FormLabel>Observaciones (opcional)</FormLabel>
                  <FormControl>
                    <Textarea
                      {...field}
                      value={field.value ?? ''}
                      placeholder="Observaciones adicionales sobre la entrega..."
                      rows={3}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
        </Card>

        {/* ─── SECCIÓN: Líneas ─── */}
        <Card className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold">Líneas de Entrega</h3>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                append({
                  productId: '',
                  description: '',
                  quantity: '1',
                  notes: '',
                })
              }
            >
              <Plus className="mr-2 h-4 w-4" />
              Agregar Línea
            </Button>
          </div>

          {/* Mensaje de estado vacío */}
          {fields.length === 0 && (
            <div className="text-center py-8 text-muted-foreground">
              Haz clic en &quot;Agregar Línea&quot; para agregar productos a entregar.
            </div>
          )}

          <div className="space-y-4">
            {fields.map((field, index) => (
              <Card key={field.id} className="p-4 bg-muted/20">
                <div className="flex items-start justify-between mb-3">
                  <h4 className="font-medium text-sm">Línea {index + 1}</h4>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => remove(index)}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">

                  {/* Producto */}
                  <FormField
                    control={form.control}
                    name={`lines.${index}.productId`}
                    render={({ field: f }) => {
                      const selectedProduct = products.find((p) => p.id === f.value);
                      return (
                      <FormItem className="flex flex-col">
                        <FormLabel>Producto *</FormLabel>
                        <Popover>
                          <PopoverTrigger asChild>
                            <FormControl>
                              <Button
                                variant="outline"
                                role="combobox"
                                className={cn(
                                  'w-full justify-between font-normal',
                                  !f.value && 'text-muted-foreground'
                                )}

                              >
                                {selectedProduct
                                    ? `${selectedProduct.code} — ${selectedProduct.name}`
                                    : 'Buscar producto...'}
                                <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                              </Button>
                            </FormControl>
                          </PopoverTrigger>
                          <PopoverContent className="w-[350px] p-0" align="start">
                            <Command>
                              <CommandInput placeholder="Buscar por código o nombre..." />
                              <CommandList>
                                <CommandEmpty>No se encontraron productos.</CommandEmpty>
                                <CommandGroup>
                                  {products.map((product) => (
                                    <CommandItem
                                      key={product.id}
                                      value={`${product.code} ${product.name}`}
                                      onSelect={() => {
                                        f.onChange(product.id);
                                        form.setValue(`lines.${index}.description`, product.name);
                                      }}
                                    >
                                      <Check
                                        className={cn(
                                          'mr-2 h-4 w-4',
                                          f.value === product.id ? 'opacity-100' : 'opacity-0'
                                        )}
                                      />
                                      <span className="font-mono text-xs mr-2">{product.code}</span>
                                      {product.name}
                                    </CommandItem>
                                  ))}
                                </CommandGroup>
                              </CommandList>
                            </Command>
                          </PopoverContent>
                        </Popover>
                        <FormMessage />
                      </FormItem>
                      );
                    }}
                  />

                  {/* Descripción */}
                  <FormField
                    control={form.control}
                    name={`lines.${index}.description`}
                    render={({ field: f }) => (
                      <FormItem className="lg:col-span-2">
                        <FormLabel>Descripción *</FormLabel>
                        <FormControl>
                          <Input {...f} placeholder="Descripción del ítem" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {/* Cantidad */}
                  <FormField
                    control={form.control}
                    name={`lines.${index}.quantity`}
                    render={({ field: f }) => (
                      <FormItem>
                        <FormLabel>Cantidad *</FormLabel>
                        <FormControl>
                          <Input
                            {...f}
                            type="number"
                            step="0.001"
                            min="0.001"
                            placeholder="1"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {/* Notas de línea */}
                  <FormField
                    control={form.control}
                    name={`lines.${index}.notes`}
                    render={({ field: f }) => (
                      <FormItem className="md:col-span-2">
                        <FormLabel>Notas de la línea (opcional)</FormLabel>
                        <FormControl>
                          <Input
                            {...f}
                            value={f.value ?? ''}
                            placeholder="Opcional"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </Card>
            ))}
          </div>

          {/* Error de validación del array de líneas */}
          {form.formState.errors.lines?.root && (
            <p className="text-sm font-medium text-destructive mt-2">
              {form.formState.errors.lines.root.message}
            </p>
          )}
          {typeof form.formState.errors.lines?.message === 'string' && (
            <p className="text-sm font-medium text-destructive mt-2">
              {form.formState.errors.lines.message}
            </p>
          )}
        </Card>

        <Separator />

        {/* ─── ACCIONES ─── */}
        <div className="flex flex-col-reverse sm:flex-row justify-end gap-3">
          <Button
            type="button"
            variant="outline"
            onClick={() => router.back()}
            disabled={form.formState.isSubmitting}
          >
            Cancelar
          </Button>
          <Button type="submit" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting
              ? editMode
                ? 'Actualizando...'
                : 'Guardando...'
              : editMode
                ? 'Actualizar Remito'
                : 'Crear Remito'}
          </Button>
        </div>
      </form>
    </Form>
  );
}
