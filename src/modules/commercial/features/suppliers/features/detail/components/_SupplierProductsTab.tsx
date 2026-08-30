'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus, Trash2, Package } from 'lucide-react';

import { Button } from '@/shared/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card';
import { Badge } from '@/shared/components/ui/badge';
import { MoneyInput } from '@/shared/components/ui/money-input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/shared/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui/select';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/shared/components/ui/alert-dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/shared/components/ui/table';
import { usePermissions } from '@/shared/hooks/usePermissions';
import { formatCurrency } from '@/shared/utils/formatters';

import {
  getSupplierProducts,
  addProductToSupplier,
  removeProductFromSupplier,
  type SupplierProduct,
} from '../actions.server';
import { getProducts } from '@/modules/commercial/features/products/features/list/actions.server';

interface Props {
  supplierId: string;
  initialProducts: SupplierProduct[];
}

export function _SupplierProductsTab({ supplierId, initialProducts }: Props) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { hasPermission } = usePermissions();
  const canEdit = hasPermission('commercial.suppliers', 'update');

  const [addOpen, setAddOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const [selectedProductId, setSelectedProductId] = useState('');
  const [supplierCode, setSupplierCode] = useState('');
  const [supplierPrice, setSupplierPrice] = useState('');

  const { data: products = initialProducts } = useQuery({
    queryKey: ['supplier-products', supplierId],
    queryFn: () => getSupplierProducts(supplierId),
    initialData: initialProducts,
  });

  const { data: allProducts = [] } = useQuery({
    queryKey: ['all-products-for-supplier'],
    queryFn: async () => {
      const result = await getProducts({ pageSize: 9999 });
      return result.data;
    },
    enabled: addOpen,
  });

  const existingProductIds = new Set(products.map((p) => p.productId));
  const availableProducts = allProducts.filter((p) => !existingProductIds.has(p.id));

  const addMutation = useMutation({
    mutationFn: () =>
      addProductToSupplier(supplierId, {
        productId: selectedProductId,
        supplierCode: supplierCode || undefined,
        supplierPrice: supplierPrice ? parseFloat(supplierPrice) : undefined,
      }),
    onSuccess: () => {
      toast.success('Ítem asociado al proveedor');
      queryClient.invalidateQueries({ queryKey: ['supplier-products', supplierId] });
      setAddOpen(false);
      setSelectedProductId('');
      setSupplierCode('');
      setSupplierPrice('');
      router.refresh();
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Error al asociar ítem');
    },
  });

  const removeMutation = useMutation({
    mutationFn: (id: string) => removeProductFromSupplier(id),
    onSuccess: () => {
      toast.success('Ítem desvinculado del proveedor');
      queryClient.invalidateQueries({ queryKey: ['supplier-products', supplierId] });
      setDeleteTarget(null);
      router.refresh();
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Error al desvincular');
    },
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div className="flex items-center gap-2">
          <Package className="h-5 w-5" />
          <CardTitle>Ítems del Proveedor</CardTitle>
          <Badge variant="secondary">{products.length}</Badge>
        </div>
        {canEdit && (
          <Dialog open={addOpen} onOpenChange={setAddOpen}>
            <DialogTrigger asChild>
              <Button size="sm">
                <Plus className="mr-1 h-4 w-4" />
                Asociar Ítem
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Asociar Ítem al Proveedor</DialogTitle>
                <DialogDescription>
                  Seleccioná un ítem y opcionalmente ingresá el código y precio del proveedor
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4 py-2">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Ítem *</label>
                  <Select value={selectedProductId} onValueChange={setSelectedProductId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Seleccionar ítem" />
                    </SelectTrigger>
                    <SelectContent position="popper" className="max-h-[200px]">
                      {availableProducts.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.code} - {p.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Código del Proveedor</label>
                    <MoneyInput
                      placeholder="0,00"
                      value={supplierPrice}
                      onChange={(raw) => setSupplierCode(raw)}
                    />
                  </div>
                </div>
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => setAddOpen(false)}>
                  Cancelar
                </Button>
                <Button
                  onClick={() => addMutation.mutate()}
                  disabled={!selectedProductId || addMutation.isPending}
                >
                  {addMutation.isPending ? 'Asociando...' : 'Asociar'}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </CardHeader>

      <CardContent>
        {products.length === 0 ? (
          <p className="text-center text-muted-foreground py-8">
            No hay ítems asociados a este proveedor
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Código</TableHead>
                <TableHead>Ítem</TableHead>
                <TableHead>Cód. Proveedor</TableHead>
                <TableHead className="text-right">Precio Proveedor</TableHead>
                <TableHead className="text-right">Precio Costo</TableHead>
                {canEdit && <TableHead className="w-[50px]" />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {products.map((item) => (
                <TableRow key={item.id}>
                  <TableCell className="font-mono text-sm">{item.productCode}</TableCell>
                  <TableCell className="font-medium">{item.productName}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {item.supplierCode || '—'}
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {item.supplierPrice ? formatCurrency(item.supplierPrice) : '—'}
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {formatCurrency(item.costPrice)}
                  </TableCell>
                  {canEdit && (
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
                        onClick={() => setDeleteTarget({ id: item.id, name: item.productName })}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Desvincular ítem</AlertDialogTitle>
            <AlertDialogDescription>
              ¿Desvincular &quot;{deleteTarget?.name}&quot; de este proveedor?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleteTarget && removeMutation.mutate(deleteTarget.id)}>
              Desvincular
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
