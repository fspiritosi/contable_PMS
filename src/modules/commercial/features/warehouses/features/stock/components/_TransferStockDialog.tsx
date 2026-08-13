'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
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
  FormDescription,
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
import { Input } from '@/shared/components/ui/input';
import { Textarea } from '@/shared/components/ui/textarea';
import { Button } from '@/shared/components/ui/button';
import { Alert, AlertDescription } from '@/shared/components/ui/alert';
import { ArrowRight, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import type { Warehouse, WarehouseStock } from '../../../shared/types';
import { directStockTransferSchema, type DirectStockTransferFormData } from '../../../shared/validators';
import { transferStock } from '../../list/actions.server';

interface TransferStockDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  stock: WarehouseStock;
  warehouses: Warehouse[];
  fromWarehouseId: string;
}

export function TransferStockDialog({
  open,
  onOpenChange,
  stock,
  warehouses,
  fromWarehouseId,
}: TransferStockDialogProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const queryClient = useQueryClient();

  const form = useForm<DirectStockTransferFormData>({
    resolver: zodResolver(directStockTransferSchema),
    defaultValues: {
      fromWarehouseId,
      toWarehouseId: '',
      productId: stock.productId,
      quantity: 0,
      notes: '',
    },
  });

  const quantity = form.watch('quantity');
  const toWarehouseId = form.watch('toWarehouseId');
  const isExceedingAvailable = Number(quantity) > stock.availableQty;

  const handleSubmit = async (data: DirectStockTransferFormData) => {
    setIsSubmitting(true);
    try {
      await transferStock(data);
      toast.success('Transferencia realizada correctamente');
      queryClient.invalidateQueries({ queryKey: ['warehouse-stocks'] });
      onOpenChange(false);
      form.reset();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Error al transferir stock');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[550px]">
        <DialogHeader>
          <DialogTitle>Transferir Stock</DialogTitle>
          <DialogDescription>
            Transfiere stock de este ítem a otro almacén
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
            {/* Product Info */}
            <div className="rounded-lg border p-4 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Ítem</span>
                <span className="font-mono text-sm text-muted-foreground">
                  {stock.product?.code}
                </span>
              </div>
              <div className="text-base font-semibold">{stock.product?.name}</div>
              <div className="flex items-center gap-4 text-sm">
                <div>
                  <span className="text-muted-foreground">Disponible: </span>
                  <span className="font-semibold text-green-600">
                    {stock.availableQty.toLocaleString()}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground">Total: </span>
                  <span className="font-semibold">{stock.quantity.toLocaleString()}</span>
                </div>
              </div>
            </div>

            {/* Transfer Direction */}
            <div className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg">
              <div className="flex-1 text-center">
                <div className="text-xs text-muted-foreground mb-1">Origen</div>
                <div className="font-medium">{stock.warehouse?.name}</div>
                <div className="text-xs text-muted-foreground">{stock.warehouse?.code}</div>
              </div>
              <ArrowRight className="h-5 w-5 text-muted-foreground" />
              <div className="flex-1 text-center">
                <div className="text-xs text-muted-foreground mb-1">Destino</div>
                <div className="font-medium">
                  {toWarehouseId
                    ? warehouses.find(w => w.id === toWarehouseId)?.name || '?'
                    : 'Seleccionar'}
                </div>
              </div>
            </div>

            {/* Destination Warehouse */}
            <FormField
              control={form.control}
              name="toWarehouseId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Almacén Destino</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Selecciona almacén destino" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {warehouses.map((warehouse) => (
                        <SelectItem key={warehouse.id} value={warehouse.id}>
                          <div className="flex items-center gap-2">
                            <span>{warehouse.name}</span>
                            <span className="text-muted-foreground">({warehouse.code})</span>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormDescription>
                    Almacén que recibirá el stock transferido
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Quantity */}
            <FormField
              control={form.control}
              name="quantity"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Cantidad a Transferir</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      step="0.01"
                      placeholder="0"
                      {...field}
                      onChange={(e) => field.onChange(e.target.value)}
                    />
                  </FormControl>
                  <FormDescription>
                    Cantidad disponible: {stock.availableQty.toLocaleString()}{' '}
                    {stock.product?.unitOfMeasure || 'unidades'}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Warning if exceeding */}
            {isExceedingAvailable && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  La cantidad supera el stock disponible ({stock.availableQty.toLocaleString()}).
                  Solo puedes transferir stock que no esté reservado.
                </AlertDescription>
              </Alert>
            )}

            {/* Notes */}
            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Notas (opcional)</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Motivo de la transferencia..."
                      className="resize-none"
                      {...field}
                    />
                  </FormControl>
                  <FormDescription>
                    Describe el motivo de la transferencia
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={isSubmitting}
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                disabled={isSubmitting || isExceedingAvailable || !toWarehouseId}
              >
                {isSubmitting ? 'Transfiriendo...' : 'Transferir'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
