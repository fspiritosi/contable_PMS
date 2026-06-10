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
import { Input } from '@/shared/components/ui/input';
import { Textarea } from '@/shared/components/ui/textarea';
import { Button } from '@/shared/components/ui/button';
import { Badge } from '@/shared/components/ui/badge';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import type { WarehouseStock } from '../../../shared/types';
import { setStockQuantitySchema, type SetStockQuantityFormData } from '../../../shared/validators';
import { adjustStock } from '../../list/actions.server';

interface AdjustStockDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  stock: WarehouseStock;
  warehouseId: string;
}

export function AdjustStockDialog({
  open,
  onOpenChange,
  stock,
  warehouseId,
}: AdjustStockDialogProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const queryClient = useQueryClient();

  const form = useForm<SetStockQuantityFormData>({
    resolver: zodResolver(setStockQuantitySchema),
    defaultValues: {
      warehouseId,
      productId: stock.productId,
      newQuantity: stock.quantity,
      notes: '',
    },
  });

  const currentQuantity = stock.quantity;
  const newQuantity = form.watch('newQuantity');
  const difference = Number(newQuantity || 0) - currentQuantity;

  const handleSubmit = async (data: SetStockQuantityFormData) => {
    setIsSubmitting(true);
    try {
      await adjustStock(data);
      toast.success('Stock ajustado correctamente');
      queryClient.invalidateQueries({ queryKey: ['warehouse-stocks', warehouseId] });
      onOpenChange(false);
      form.reset();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Error al ajustar stock');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Ajustar Stock</DialogTitle>
          <DialogDescription>
            Modifica la cantidad de stock para este producto
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
            {/* Product Info */}
            <div className="rounded-lg border p-4 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Producto</span>
                <span className="font-mono text-sm text-muted-foreground">
                  {stock.product?.code}
                </span>
              </div>
              <div className="text-base font-semibold">{stock.product?.name}</div>
              <div className="flex items-center gap-4 text-sm">
                <div>
                  <span className="text-muted-foreground">Cantidad actual: </span>
                  <span className="font-semibold">{currentQuantity.toLocaleString()}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Reservado: </span>
                  <span className="font-semibold text-orange-600">
                    {stock.reservedQty.toLocaleString()}
                  </span>
                </div>
              </div>
            </div>

            {/* New Quantity */}
            <FormField
              control={form.control}
              name="newQuantity"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Nueva Cantidad</FormLabel>
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
                    Ingresa la cantidad total correcta de stock
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Difference Indicator */}
            {difference !== 0 && (
              <div className="rounded-lg border p-3 space-y-1">
                <div className="text-sm font-medium">Ajuste a realizar:</div>
                <div className="flex items-center gap-2">
                  {difference > 0 ? (
                    <Badge variant="success">
                      +{difference.toLocaleString()} {stock.product?.unitOfMeasure || 'unidades'}
                    </Badge>
                  ) : (
                    <Badge variant="destructive">
                      {difference.toLocaleString()} {stock.product?.unitOfMeasure || 'unidades'}
                    </Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  {difference > 0 ? 'Se agregará stock' : 'Se reducirá stock'}
                </p>
              </div>
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
                      placeholder="Motivo del ajuste..."
                      className="resize-none"
                      {...field}
                    />
                  </FormControl>
                  <FormDescription>
                    Describe el motivo del ajuste para trazabilidad
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
              <Button type="submit" disabled={isSubmitting || difference === 0}>
                {isSubmitting ? 'Ajustando...' : 'Ajustar Stock'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
