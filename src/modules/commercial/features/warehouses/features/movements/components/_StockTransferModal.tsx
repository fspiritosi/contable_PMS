'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useForm, useFieldArray } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';

import { Button } from '@/shared/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/shared/components/ui/form';
import { Input } from '@/shared/components/ui/input';
import { Textarea } from '@/shared/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui/select';
import { ArrowRight, Plus, Trash2 } from 'lucide-react';
import moment from 'moment';

import { createStockTransfer } from '../actions.server';
import { stockTransferSchema } from '../../../shared/validators';

type FormData = z.infer<typeof stockTransferSchema>;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  warehouses: Array<{ id: string; name: string }>;
  products: Array<{ id: string; code: string; name: string }>;
}

export function _StockTransferModal({ open, onOpenChange, warehouses, products }: Props) {
  const router = useRouter();
  const queryClient = useQueryClient();

  const form = useForm<FormData>({
    resolver: zodResolver(stockTransferSchema),
    defaultValues: {
      sourceWarehouseId: '',
      destinationWarehouseId: '',
      date: new Date(),
      notes: '',
      lines: [{ productId: '', quantity: '' }],
    },
  });

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: 'lines',
  });

  const mutation = useMutation({
    mutationFn: createStockTransfer,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['stock'] });
      queryClient.invalidateQueries({ queryKey: ['movements'] });
      toast.success('Transferencia registrada');
      onOpenChange(false);
      form.reset();
      router.refresh();
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Error al registrar transferencia');
    },
  });

  const onSubmit = (data: FormData) => {
    mutation.mutate(data);
  };

  const handleAddLine = () => {
    append({ productId: '', quantity: '' });
  };

  // Productos ya seleccionados en otras líneas
  const selectedProductIds = form.watch('lines')?.map((l) => l.productId).filter(Boolean) || [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl">
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)}>
            <DialogHeader>
              <DialogTitle>Transferencia de Stock</DialogTitle>
              <DialogDescription>
                Seleccioná los almacenes y agregá los productos a transferir
              </DialogDescription>
            </DialogHeader>

            <div className="grid gap-4 py-4">
              {/* Datos generales */}
              <div className="flex items-end gap-4">
                <FormField
                  control={form.control}
                  name="sourceWarehouseId"
                  render={({ field }) => (
                    <FormItem className="flex-1">
                      <FormLabel>Almacén Origen *</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Seleccionar origen" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {warehouses.map((w) => (
                            <SelectItem key={w.id} value={w.id}>
                              {w.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <ArrowRight className="h-5 w-5 text-muted-foreground mb-2" />

                <FormField
                  control={form.control}
                  name="destinationWarehouseId"
                  render={({ field }) => (
                    <FormItem className="flex-1">
                      <FormLabel>Almacén Destino *</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Seleccionar destino" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {warehouses.map((w) => (
                            <SelectItem key={w.id} value={w.id}>
                              {w.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="date"
                  render={({ field }) => (
                    <FormItem className="w-[160px]">
                      <FormLabel>Fecha *</FormLabel>
                      <FormControl>
                        <Input
                          type="date"
                          value={field.value ? moment(field.value).format('YYYY-MM-DD') : ''}
                          onChange={(e) => field.onChange(e.target.value ? new Date(e.target.value + 'T12:00:00') : undefined)}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              {/* Líneas de productos */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <FormLabel>Productos *</FormLabel>
                  <Button type="button" variant="outline" size="sm" onClick={handleAddLine}>
                    <Plus className="h-4 w-4 mr-1" />
                    Agregar producto
                  </Button>
                </div>

                {/* Header de la tabla */}
                <div className="grid grid-cols-[1fr_120px_40px] gap-2 text-xs text-muted-foreground font-medium px-1">
                  <span>Producto</span>
                  <span>Cantidad</span>
                  <span />
                </div>

                {fields.map((field, index) => (
                  <div key={field.id} className="grid grid-cols-[1fr_120px_40px] gap-2 items-start">
                    <FormField
                      control={form.control}
                      name={`lines.${index}.productId`}
                      render={({ field: f }) => (
                        <FormItem>
                          <Select onValueChange={f.onChange} value={f.value}>
                            <FormControl>
                              <SelectTrigger className="h-9 text-sm">
                                <SelectValue placeholder="Seleccionar producto" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent position="popper" className="z-[200] max-h-[200px]">
                              {products
                                .filter((p) => !selectedProductIds.includes(p.id) || p.id === f.value)
                                .map((p) => (
                                  <SelectItem key={p.id} value={p.id}>
                                    {p.code} - {p.name}
                                  </SelectItem>
                                ))}
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name={`lines.${index}.quantity`}
                      render={({ field: f }) => (
                        <FormItem>
                          <FormControl>
                            <Input
                              {...f}
                              type="text"
                              placeholder="0.000"
                              inputMode="decimal"
                              className="h-9 text-sm"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-9 w-9 p-0"
                      onClick={() => fields.length > 1 && remove(index)}
                      disabled={fields.length <= 1}
                    >
                      <Trash2 className="h-4 w-4 text-muted-foreground" />
                    </Button>
                  </div>
                ))}

                {form.formState.errors.lines?.message && (
                  <p className="text-sm text-destructive">{form.formState.errors.lines.message}</p>
                )}
              </div>

              {/* Notas */}
              <FormField
                control={form.control}
                name="notes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Notas (opcional)</FormLabel>
                    <FormControl>
                      <Textarea {...field} placeholder="Motivo de la transferencia..." rows={2} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={mutation.isPending}
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={mutation.isPending}>
                {mutation.isPending ? 'Registrando...' : 'Registrar Transferencia'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
