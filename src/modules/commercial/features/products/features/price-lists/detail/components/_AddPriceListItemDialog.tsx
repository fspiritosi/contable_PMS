'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { Plus } from 'lucide-react';
import { Button } from '@/shared/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
import { createPriceListItem } from '../../list/actions.server';
import { getProducts } from '../../../list/actions.server';
import { createPriceListItemSchema, type CreatePriceListItemFormData } from '../../../../shared/validators';
import { logger } from '@/shared/lib/logger';
import type { Product } from '../../../../shared/types';

interface AddPriceListItemDialogProps {
  priceListId: string;
}

export function _AddPriceListItemDialog({ priceListId }: AddPriceListItemDialogProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(false);
  const [priceWithTax, setPriceWithTax] = useState<number>(0);

  const form = useForm<CreatePriceListItemFormData>({
    resolver: zodResolver(createPriceListItemSchema),
    defaultValues: {
      productId: '',
      price: 0,
    },
  });

  useEffect(() => {
    if (open) {
      loadProducts();
    }
  }, [open]);

  const loadProducts = async () => {
    setLoading(true);
    try {
      const result = await getProducts();
      setProducts(result.data.filter((p) => p.status === 'ACTIVE'));
    } catch (error) {
      logger.error('Error al cargar artículos', { data: { error } });
      toast.error('Error al cargar artículos');
    } finally {
      setLoading(false);
    }
  };

  const selectedProductId = form.watch('productId');
  const price = form.watch('price');

  useEffect(() => {
    if (selectedProductId && price) {
      const product = products.find((p) => p.id === selectedProductId);
      if (product) {
        const vatRate = product.vatRate || 0;
        const calculatedPriceWithTax = price * (1 + vatRate / 100);
        setPriceWithTax(calculatedPriceWithTax);
      }
    } else {
      setPriceWithTax(0);
    }
  }, [selectedProductId, price, products]);

  const onSubmit = async (data: CreatePriceListItemFormData) => {
    setIsSubmitting(true);
    try {
      await createPriceListItem(priceListId, data);
      toast.success('Artículo agregado a la lista');
      form.reset();
      setOpen(false);
      router.refresh();
    } catch (error) {
      logger.error('Error al agregar artículo', { data: { error } });
      toast.error(error instanceof Error ? error.message : 'Error al agregar artículo');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="mr-2 h-4 w-4" />
          Agregar Artículo
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Agregar Artículo a la Lista</DialogTitle>
          <DialogDescription>
            Selecciona un artículo y asigna su precio
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="productId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Artículo *</FormLabel>
                  <Select
                    onValueChange={field.onChange}
                    value={field.value}
                    disabled={loading}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder={loading ? 'Cargando...' : 'Seleccionar artículo'} />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {products.map((product) => (
                        <SelectItem key={product.id} value={product.id}>
                          {product.code} - {product.name}
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

            {priceWithTax > 0 && (
              <div className="rounded-md bg-muted p-4">
                <p className="text-sm font-medium">Precio con IVA:</p>
                <p className="text-2xl font-bold">${priceWithTax.toFixed(2)}</p>
              </div>
            )}

            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
                disabled={isSubmitting}
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? 'Agregando...' : 'Agregar'}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
