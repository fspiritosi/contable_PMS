'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import moment from 'moment';
import { toast } from 'sonner';
import { TrendingUp, TriangleAlert } from 'lucide-react';

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
import { formatCurrency } from '@/shared/utils/formatters';

import {
  applyPriceIndexToList,
  getApplicablePriceIndexes,
  previewPriceIndexApplication,
} from '../apply-index.server';

interface Props {
  priceListId: string;
  itemCount: number;
}

export function _ApplyPriceIndexDialog({ priceListId, itemCount }: Props) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [selectedIndexId, setSelectedIndexId] = useState<string>('');
  const [selectedValueId, setSelectedValueId] = useState<string>('');

  const { data: indexes, isLoading: isLoadingIndexes } = useQuery({
    queryKey: ['applicable-price-indexes'],
    queryFn: () => getApplicablePriceIndexes(),
    enabled: open,
  });

  const selectedIndex = useMemo(
    () => indexes?.find((index) => index.id === selectedIndexId) ?? null,
    [indexes, selectedIndexId]
  );

  const selectedValue = useMemo(
    () => selectedIndex?.values.find((value) => value.id === selectedValueId) ?? null,
    [selectedIndex, selectedValueId]
  );

  const previewQuery = useQuery({
    queryKey: ['price-index-preview', priceListId, selectedValueId],
    queryFn: () => previewPriceIndexApplication(priceListId, selectedValueId),
    enabled: open && !!selectedValueId,
  });

  const applyMutation = useMutation({
    mutationFn: () => applyPriceIndexToList(priceListId, selectedValueId),
    onSuccess: (result) => {
      toast.success(
        result.itemsAffected === 1
          ? 'Se actualizó 1 ítem'
          : `Se actualizaron ${result.itemsAffected} ítems`
      );
      queryClient.invalidateQueries({ queryKey: ['applicable-price-indexes'] });
      setOpen(false);
      router.refresh();
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : 'Error al aplicar el índice a la lista'
      );
    },
  });

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen) {
      setSelectedIndexId('');
      setSelectedValueId('');
    }
  };

  const handleIndexChange = (indexId: string) => {
    setSelectedIndexId(indexId);
    setSelectedValueId('');
  };

  const hasApplicableIndexes = (indexes?.length ?? 0) > 0;
  const preview = previewQuery.data;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <TrendingUp className="mr-2 h-4 w-4" />
          Actualizar por índice
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Actualizar precios por índice</DialogTitle>
          <DialogDescription>
            Elegí el índice y el período para ver cómo quedarían los precios antes de aplicar
            el ajuste
          </DialogDescription>
        </DialogHeader>

        {isLoadingIndexes ? (
          <div className="py-6 text-center text-sm text-muted-foreground">Cargando índices...</div>
        ) : !hasApplicableIndexes ? (
          <div className="space-y-3 py-4 text-sm">
            <p>Todavía no hay ningún índice con valores cargados.</p>
            <Link
              href="/dashboard/company/price-indexes"
              className="text-blue-600 hover:underline"
              onClick={() => setOpen(false)}
            >
              Ir a Índices de Precios
            </Link>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-end gap-3">
              <div className="flex-1 space-y-1">
                <label className="text-sm font-medium">Índice</label>
                <Select value={selectedIndexId} onValueChange={handleIndexChange}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Seleccioná un índice" />
                  </SelectTrigger>
                  <SelectContent>
                    {indexes?.map((index) => (
                      <SelectItem key={index.id} value={index.id}>
                        {index.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex-1 space-y-1">
                <label className="text-sm font-medium">Período</label>
                <Select
                  value={selectedValueId}
                  onValueChange={setSelectedValueId}
                  disabled={!selectedIndex}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Seleccioná un período" />
                  </SelectTrigger>
                  <SelectContent>
                    {selectedIndex?.values.map((value) => (
                      <SelectItem key={value.id} value={value.id}>
                        {moment.utc(value.period).format('MM/YYYY')} ({value.percentage > 0 ? '+' : ''}
                        {value.percentage}%)
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {previewQuery.isLoading && (
              <div className="py-6 text-center text-sm text-muted-foreground">
                Calculando vista previa...
              </div>
            )}

            {preview && (
              <div className="space-y-3">
                {preview.previousApplication && (
                  <div className="flex items-start gap-2 rounded-md border border-yellow-500/50 bg-yellow-500/10 p-3 text-sm">
                    <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-yellow-600" />
                    <p>
                      Esta lista ya recibió {selectedIndex?.name}
                      {selectedValue ? ` ${moment.utc(selectedValue.period).format('MM/YYYY')}` : ''} el{' '}
                      {moment(preview.previousApplication.appliedAt).format('DD/MM/YYYY')}.
                    </p>
                  </div>
                )}

                <div className="max-h-[300px] overflow-y-auto rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Ítem</TableHead>
                        <TableHead className="text-right">Precio actual</TableHead>
                        <TableHead className="text-right">Precio nuevo</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {preview.items.map((item) => (
                        <TableRow key={item.id}>
                          <TableCell>{item.productName}</TableCell>
                          <TableCell className="text-right">
                            {formatCurrency(item.currentPrice)}
                          </TableCell>
                          <TableCell className="text-right font-medium">
                            {formatCurrency(item.newPrice)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={applyMutation.isPending}>
            Cancelar
          </Button>
          {hasApplicableIndexes && (
            <Button
              onClick={() => applyMutation.mutate()}
              disabled={!preview || applyMutation.isPending}
            >
              {applyMutation.isPending
                ? 'Aplicando...'
                : `Aplicar a los ${itemCount} ítem${itemCount !== 1 ? 's' : ''}`}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
