'use client';

import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { PackagePlus, Search, Check } from 'lucide-react';

import { Button } from '@/shared/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/shared/components/ui/dialog';
import { Input } from '@/shared/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui/select';
import { Checkbox } from '@/shared/components/ui/checkbox';
import { Badge } from '@/shared/components/ui/badge';
import { ScrollArea } from '@/shared/components/ui/scroll-area';

import { getProducts } from '../../../list/actions.server';
import { bulkAddPriceListItems } from '../../list/actions.server';

interface Props {
  priceListId: string;
  existingProductIds: string[];
}

export function _BulkAddItemsDialog({ priceListId, existingProductIds }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [adjustmentType, setAdjustmentType] = useState<'increase' | 'decrease'>('increase');
  const [adjustmentPercent, setAdjustmentPercent] = useState('0');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { data: productsResult, isLoading } = useQuery({
    queryKey: ['products-for-bulk-add'],
    queryFn: () => getProducts({ pageSize: 9999 }),
    enabled: open,
  });
  const allProducts = productsResult?.data || [];

  // Filtrar productos que no están ya en la lista
  const existingSet = useMemo(() => new Set(existingProductIds), [existingProductIds]);
  const availableProducts = useMemo(
    () => allProducts.filter((p) => !existingSet.has(p.id)),
    [allProducts, existingSet]
  );

  // Aplicar búsqueda
  const filteredProducts = useMemo(() => {
    if (!search) return availableProducts;
    const q = search.toLowerCase();
    return availableProducts.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.code.toLowerCase().includes(q) ||
        (p.barcode && p.barcode.toLowerCase().includes(q))
    );
  }, [availableProducts, search]);

  const toggleProduct = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selectedIds.size === filteredProducts.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredProducts.map((p) => p.id)));
    }
  };

  const handleSubmit = async () => {
    if (selectedIds.size === 0) {
      toast.error('Seleccioná al menos un producto');
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await bulkAddPriceListItems(priceListId, {
        productIds: Array.from(selectedIds),
        adjustmentType,
        adjustmentPercent: parseFloat(adjustmentPercent) || 0,
      });

      toast.success(
        `${result.added} producto${result.added !== 1 ? 's' : ''} agregado${result.added !== 1 ? 's' : ''}` +
          (result.skipped > 0 ? ` (${result.skipped} ya existían)` : '')
      );

      setOpen(false);
      setSelectedIds(new Set());
      setSearch('');
      setAdjustmentPercent('0');
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Error al agregar productos');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <PackagePlus className="mr-2 h-4 w-4" />
          Carga Masiva
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Carga Masiva de Productos</DialogTitle>
          <DialogDescription>
            Seleccioná los productos y definí el porcentaje de ajuste sobre el precio de venta base
          </DialogDescription>
        </DialogHeader>

        {/* Ajuste de precio */}
        <div className="flex items-end gap-3">
          <div className="space-y-1">
            <label className="text-sm font-medium">Tipo de Ajuste</label>
            <Select value={adjustmentType} onValueChange={(v) => setAdjustmentType(v as 'increase' | 'decrease')}>
              <SelectTrigger className="w-[160px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="increase">Aumento %</SelectItem>
                <SelectItem value="decrease">Descuento %</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium">Porcentaje</label>
            <div className="relative w-[100px]">
              <Input
                type="number"
                min="0"
                max="100"
                step="0.1"
                value={adjustmentPercent}
                onChange={(e) => setAdjustmentPercent(e.target.value)}
                className="pr-7"
              />
              <span className="absolute right-3 top-2.5 text-muted-foreground text-sm">%</span>
            </div>
          </div>
          <p className="text-xs text-muted-foreground pb-2">
            Sobre el precio de venta de cada producto
          </p>
        </div>

        {/* Búsqueda */}
        <div className="relative">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por nombre, código o código de barras..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        {/* Selección y contador */}
        <div className="flex items-center justify-between text-sm">
          <button
            type="button"
            onClick={toggleAll}
            className="text-blue-600 hover:underline text-xs"
          >
            {selectedIds.size === filteredProducts.length && filteredProducts.length > 0
              ? 'Deseleccionar todos'
              : 'Seleccionar todos'}
          </button>
          <Badge variant="secondary">
            {selectedIds.size} seleccionado{selectedIds.size !== 1 ? 's' : ''} de {availableProducts.length} disponibles
          </Badge>
        </div>

        {/* Lista de productos */}
        <ScrollArea className="h-[300px] border rounded-md">
          {isLoading ? (
            <div className="flex items-center justify-center h-full text-muted-foreground">
              Cargando productos...
            </div>
          ) : filteredProducts.length === 0 ? (
            <div className="flex items-center justify-center h-full text-muted-foreground">
              {availableProducts.length === 0
                ? 'Todos los productos ya están en la lista'
                : 'No se encontraron productos'}
            </div>
          ) : (
            <div className="divide-y">
              {filteredProducts.map((product) => (
                <label
                  key={product.id}
                  className="flex items-center gap-3 px-3 py-2 hover:bg-muted/50 cursor-pointer"
                >
                  <Checkbox
                    checked={selectedIds.has(product.id)}
                    onCheckedChange={() => toggleProduct(product.id)}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono text-muted-foreground">{product.code}</span>
                      <span className="text-sm truncate">{product.name}</span>
                    </div>
                  </div>
                  <span className="text-sm font-mono text-muted-foreground shrink-0">
                    ${Number(product.salePrice).toFixed(2)}
                  </span>
                  {selectedIds.has(product.id) && (
                    <Check className="h-4 w-4 text-green-600 shrink-0" />
                  )}
                </label>
              ))}
            </div>
          )}
        </ScrollArea>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={isSubmitting}>
            Cancelar
          </Button>
          <Button onClick={handleSubmit} disabled={isSubmitting || selectedIds.size === 0}>
            {isSubmitting
              ? 'Agregando...'
              : `Agregar ${selectedIds.size} producto${selectedIds.size !== 1 ? 's' : ''}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
