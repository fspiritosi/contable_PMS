'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
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
  FormDescription,
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
import moment from 'moment';

import { createStockAdjustment } from '../actions.server';
import { stockAdjustmentSchema, ADJUSTMENT_REASON_LABELS } from '../../../shared/validators';

type FormData = z.infer<typeof stockAdjustmentSchema>;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  warehouses: Array<{ id: string; name: string }>;
  products: Array<{ id: string; code: string; name: string }>;
}

export function _StockAdjustmentModal({ open, onOpenChange, warehouses, products }: Props) {
  const router = useRouter();
  const queryClient = useQueryClient();

  const form = useForm<FormData>({
    resolver: zodResolver(stockAdjustmentSchema),
    defaultValues: {
      warehouseId: '',
      productId: '',
      quantity: '',
      reason: 'ENTRY',
      notes: '',
      date: new Date(),
    },
  });

  const mutation = useMutation({
    mutationFn: createStockAdjustment,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['stock'] });
      queryClient.invalidateQueries({ queryKey: ['movements'] });
      toast.success('Ajuste de stock registrado');
      onOpenChange(false);
      form.reset();
      router.refresh();
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Error al registrar ajuste');
    },
  });

  const onSubmit = (data: FormData) => {
    mutation.mutate(data);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px]">
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)}>
            <DialogHeader>
              <DialogTitle>Ajuste de Stock</DialogTitle>
              <DialogDescription>
                Registra una entrada o salida manual de stock
              </DialogDescription>
            </DialogHeader>

            <div className="grid gap-6 py-4">
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="warehouseId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Almacén *</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Seleccionar almacén" />
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
                  name="productId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Ítem *</FormLabel>
                      <Select
                        onValueChange={field.onChange}
                        value={field.value}
                        disabled={products.length === 0}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue
                              placeholder={
                                products.length === 0
                                  ? 'No hay ítems con control de stock'
                                  : 'Seleccionar ítem'
                              }
                            />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {products.length === 0 ? (
                            <div className="p-2 text-sm text-muted-foreground text-center">
                              No hay ítems con control de stock habilitado
                            </div>
                          ) : (
                            products.map((p) => (
                              <SelectItem key={p.id} value={p.id}>
                                {p.code} - {p.name}
                              </SelectItem>
                            ))
                          )}
                        </SelectContent>
                      </Select>
                      {products.length === 0 && (
                        <FormDescription className="text-xs">
                          Crea ítems y habilita el control de stock en la configuración
                        </FormDescription>
                      )}
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="reason"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Motivo *</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {Object.entries(ADJUSTMENT_REASON_LABELS).map(([value, label]) => (
                          <SelectItem key={value} value={value}>
                            {label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="quantity"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Cantidad *</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          type="text"
                          placeholder="0.000"
                          inputMode="decimal"
                        />
                      </FormControl>
                      <FormDescription className="text-xs">
                        Siempre positivo (el signo se determina por el motivo)
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="date"
                  render={({ field }) => (
                    <FormItem>
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

              <FormField
                control={form.control}
                name="notes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Notas/Motivo *</FormLabel>
                    <FormControl>
                      <Textarea
                        {...field}
                        placeholder="Describe el motivo del ajuste..."
                        rows={3}
                      />
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
                {mutation.isPending ? 'Guardando...' : 'Registrar Ajuste'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
