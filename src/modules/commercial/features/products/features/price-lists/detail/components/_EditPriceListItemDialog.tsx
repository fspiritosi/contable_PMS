'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { Button } from '@/shared/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { updatePriceListItem } from '../../list/actions.server';
import { updatePriceListItemSchema, type UpdatePriceListItemFormData } from '../../../../shared/validators';
import { logger } from '@/shared/lib/logger';
import type { PriceListItem } from '../../../../shared/types';

interface EditPriceListItemDialogProps {
  item: PriceListItem;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function _EditPriceListItemDialog({ item, open, onOpenChange }: EditPriceListItemDialogProps) {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [priceWithTax, setPriceWithTax] = useState<number>(item.priceWithTax);

  const form = useForm<UpdatePriceListItemFormData>({
    resolver: zodResolver(updatePriceListItemSchema),
    defaultValues: {
      price: item.price,
    },
  });

  const price = form.watch('price');

  useEffect(() => {
    if (price && item.product) {
      const vatRate = item.product.vatRate || 0;
      const calculatedPriceWithTax = price * (1 + vatRate / 100);
      setPriceWithTax(calculatedPriceWithTax);
    }
  }, [price, item.product]);

  const onSubmit = async (data: UpdatePriceListItemFormData) => {
    setIsSubmitting(true);
    try {
      await updatePriceListItem(item.id, data);
      toast.success('Precio actualizado correctamente');
      onOpenChange(false);
      router.refresh();
    } catch (error) {
      logger.error('Error al actualizar precio', { data: { error } });
      toast.error(error instanceof Error ? error.message : 'Error al actualizar precio');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Editar Precio</DialogTitle>
          <DialogDescription>
            Artículo: {item.product?.name || '-'}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="price"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Precio *</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      placeholder="0.00"
                      {...field}
                    />
                  </FormControl>
                  <FormDescription>Precio sin IVA</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="rounded-md bg-muted p-4">
              <p className="text-sm font-medium">Precio con IVA:</p>
              <p className="text-2xl font-bold">${priceWithTax.toFixed(2)}</p>
              <p className="text-xs text-muted-foreground mt-1">
                IVA: {item.product?.vatRate || 0}%
              </p>
            </div>

            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={isSubmitting}
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? 'Guardando...' : 'Guardar'}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
