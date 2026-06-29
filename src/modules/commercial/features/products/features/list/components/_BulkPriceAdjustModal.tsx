'use client';

import { useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { DollarSign, TrendingUp, TrendingDown, ArrowRight } from 'lucide-react';

import { Button } from '@/shared/components/ui/button';
import { Checkbox } from '@/shared/components/ui/checkbox';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/shared/components/ui/table';
import { Skeleton } from '@/shared/components/ui/skeleton';
import { useDebounce } from '@/shared/hooks/useDebounce';
import { bulkUpdatePrices, previewBulkPriceUpdate } from '../actions.server';
import type { BulkPriceAdjustmentType } from '../actions.server';

const ADJUSTMENT_TYPE_OPTIONS: { value: BulkPriceAdjustmentType; label: string }[] = [
  { value: 'increase_percent', label: 'Aumento porcentual (%)' },
  { value: 'decrease_percent', label: 'Descuento porcentual (%)' },
  { value: 'increase_fixed', label: 'Aumento fijo ($)' },
  { value: 'decrease_fixed', label: 'Descuento fijo ($)' },
];

const bulkPriceSchema = z.object({
  adjustmentType: z.enum(['increase_percent', 'decrease_percent', 'increase_fixed', 'decrease_fixed']),
  value: z.number().positive('El valor debe ser mayor a 0'),
  applyToSalePrice: z.boolean(),
  applyCostPrice: z.boolean(),
});

type BulkPriceFormData = z.infer<typeof bulkPriceSchema>;

interface Props {
  selectedIds: string[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

function formatCurrency(value: number): string {
  return `$${value.toFixed(2)}`;
}

export function _BulkPriceAdjustModal({ selectedIds, open, onOpenChange, onSuccess }: Props) {
  const queryClient = useQueryClient();

  const form = useForm<BulkPriceFormData>({
    resolver: zodResolver(bulkPriceSchema),
    defaultValues: {
      adjustmentType: 'increase_percent',
      value: 0,
      applyToSalePrice: true,
      applyCostPrice: false,
    },
  });

  const watchedValues = form.watch();
  const debouncedValue = useDebounce(watchedValues.value, 300);
  const debouncedType = useDebounce(watchedValues.adjustmentType, 300);
  const debouncedApplySale = useDebounce(watchedValues.applyToSalePrice, 300);
  const debouncedApplyCost = useDebounce(watchedValues.applyCostPrice, 300);

  const previewInput = useMemo(
    () => ({
      productIds: selectedIds,
      adjustmentType: debouncedType,
      value: debouncedValue,
      applyToSalePrice: debouncedApplySale,
      applyCostPrice: debouncedApplyCost,
    }),
    [selectedIds, debouncedType, debouncedValue, debouncedApplySale, debouncedApplyCost]
  );

  const { data: preview, isLoading: previewLoading } = useQuery({
    queryKey: ['bulk-price-preview', previewInput],
    queryFn: () => previewBulkPriceUpdate(previewInput),
    enabled: open && debouncedValue > 0 && selectedIds.length > 0,
  });

  const mutation = useMutation({
    mutationFn: (data: BulkPriceFormData) =>
      bulkUpdatePrices({
        productIds: selectedIds,
        adjustmentType: data.adjustmentType,
        value: data.value,
        applyToSalePrice: data.applyToSalePrice,
        applyCostPrice: data.applyCostPrice,
      }),
    onSuccess: (result) => {
      toast.success(`Precios actualizados en ${result.count} artículos`);
      queryClient.invalidateQueries({ queryKey: ['products'] });
      form.reset();
      onOpenChange(false);
      onSuccess();
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : 'Error al ajustar precios de artículos';
      toast.error(message);
    },
  });

  const handleSubmit = (data: BulkPriceFormData) => {
    if (!data.applyToSalePrice && !data.applyCostPrice) {
      form.setError('applyToSalePrice', { message: 'Seleccione al menos un precio a ajustar' });
      return;
    }
    mutation.mutate(data);
  };

  const isIncrease = watchedValues.adjustmentType?.startsWith('increase');
  const showPreview = debouncedValue > 0 && preview && preview.length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <DollarSign className="h-5 w-5" />
            Ajuste Masivo de Precios
          </DialogTitle>
          <DialogDescription>
            {selectedIds.length} artículo{selectedIds.length !== 1 ? 's' : ''} seleccionado{selectedIds.length !== 1 ? 's' : ''}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
            {/* Tipo de ajuste */}
            <FormField
              control={form.control}
              name="adjustmentType"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Tipo de ajuste</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Seleccionar tipo" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {ADJUSTMENT_TYPE_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Valor */}
            <FormField
              control={form.control}
              name="value"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Valor</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      step="0.01"
                      min="0.01"
                      placeholder="Ej: 10"
                      {...field}
                      onChange={(e) => field.onChange(e.target.valueAsNumber)}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Checkboxes */}
            <div className="space-y-3">
              <FormField
                control={form.control}
                name="applyToSalePrice"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-center space-x-3 space-y-0">
                    <FormControl>
                      <Checkbox
                        checked={field.value}
                        onCheckedChange={field.onChange}
                      />
                    </FormControl>
                    <FormLabel className="font-normal">
                      Precio de Venta
                    </FormLabel>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="applyCostPrice"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-center space-x-3 space-y-0">
                    <FormControl>
                      <Checkbox
                        checked={field.value}
                        onCheckedChange={field.onChange}
                      />
                    </FormControl>
                    <FormLabel className="font-normal">
                      Precio de Costo
                    </FormLabel>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {/* Preview */}
            {(showPreview || previewLoading) && (
              <div className="space-y-2">
                <p className="text-sm font-medium">
                  Vista previa {selectedIds.length > 5 ? '(primeros 5 artículos)' : ''}
                </p>
                <div className="rounded-md border overflow-auto max-h-[250px]">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Artículo</TableHead>
                        {(debouncedApplySale) && (
                          <TableHead className="text-right">Precio Venta</TableHead>
                        )}
                        {(debouncedApplyCost) && (
                          <TableHead className="text-right">Precio Costo</TableHead>
                        )}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {previewLoading ? (
                        Array.from({ length: 3 }).map((_, i) => (
                          <TableRow key={i}>
                            <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                            {debouncedApplySale && (
                              <TableCell><Skeleton className="h-4 w-24 ml-auto" /></TableCell>
                            )}
                            {debouncedApplyCost && (
                              <TableCell><Skeleton className="h-4 w-24 ml-auto" /></TableCell>
                            )}
                          </TableRow>
                        ))
                      ) : (
                        preview?.map((p) => (
                          <TableRow key={p.id}>
                            <TableCell>
                              <div>
                                <span className="font-medium text-sm">{p.name}</span>
                                {p.code && (
                                  <span className="text-xs text-muted-foreground ml-2 font-mono">{p.code}</span>
                                )}
                              </div>
                            </TableCell>
                            {debouncedApplySale && (
                              <TableCell className="text-right">
                                <div className="flex items-center justify-end gap-1 text-sm">
                                  <span className="text-muted-foreground">{formatCurrency(p.currentSalePrice)}</span>
                                  <ArrowRight className="h-3 w-3 text-muted-foreground" />
                                  <span className={isIncrease ? 'text-green-600 font-medium' : 'text-red-600 font-medium'}>
                                    {formatCurrency(p.newSalePrice)}
                                  </span>
                                </div>
                              </TableCell>
                            )}
                            {debouncedApplyCost && (
                              <TableCell className="text-right">
                                <div className="flex items-center justify-end gap-1 text-sm">
                                  <span className="text-muted-foreground">{formatCurrency(p.currentCostPrice)}</span>
                                  <ArrowRight className="h-3 w-3 text-muted-foreground" />
                                  <span className={isIncrease ? 'text-green-600 font-medium' : 'text-red-600 font-medium'}>
                                    {formatCurrency(p.newCostPrice)}
                                  </span>
                                </div>
                              </TableCell>
                            )}
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </div>
              </div>
            )}

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                disabled={mutation.isPending}
              >
                {mutation.isPending ? (
                  'Aplicando...'
                ) : (
                  <>
                    {isIncrease ? (
                      <TrendingUp className="h-4 w-4 mr-2" />
                    ) : (
                      <TrendingDown className="h-4 w-4 mr-2" />
                    )}
                    Aplicar Ajuste
                  </>
                )}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
