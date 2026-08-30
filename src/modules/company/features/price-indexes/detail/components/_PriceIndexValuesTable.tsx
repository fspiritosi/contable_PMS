'use client';

import { useMutation } from '@tanstack/react-query';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import moment from 'moment';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';

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
import { Button } from '@/shared/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/shared/components/ui/table';
import type { ModulePermissions } from '@/shared/lib/permissions';

import { deletePriceIndexValue, type PriceIndexValueItem } from '../actions.server';
import { _PriceIndexValueFormModal } from './_PriceIndexValueFormModal';

interface Props {
  indexId: string;
  values: PriceIndexValueItem[];
  permissions: ModulePermissions;
}

export function _PriceIndexValuesTable({ indexId, values, permissions }: Props) {
  const router = useRouter();

  const [formModalOpen, setFormModalOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [selectedValue, setSelectedValue] = useState<PriceIndexValueItem | null>(null);

  const deleteMutation = useMutation({
    mutationFn: deletePriceIndexValue,
    onSuccess: () => {
      toast.success('Valor de índice eliminado');
      setDeleteDialogOpen(false);
      setSelectedValue(null);
      router.refresh();
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Error al eliminar');
    },
  });

  const handleCreate = () => {
    setSelectedValue(null);
    setFormModalOpen(true);
  };

  const handleEdit = (value: PriceIndexValueItem) => {
    setSelectedValue(value);
    setFormModalOpen(true);
  };

  const handleDelete = (value: PriceIndexValueItem) => {
    setSelectedValue(value);
    setDeleteDialogOpen(true);
  };

  const handleFormModalClose = (open: boolean) => {
    setFormModalOpen(open);
    if (!open) setSelectedValue(null);
  };

  const hasAnyAction = permissions.canUpdate || permissions.canDelete;

  return (
    <div className="space-y-4" data-testid="price-index-values-table">
      {permissions.canCreate && (
        <div className="flex justify-end">
          <Button onClick={handleCreate} data-testid="new-price-index-value-button">
            <Plus className="mr-2 h-4 w-4" />
            Nuevo Valor
          </Button>
        </div>
      )}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Período</TableHead>
            <TableHead>Porcentaje</TableHead>
            {hasAnyAction && <TableHead className="text-right">Acciones</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {values.length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={hasAnyAction ? 3 : 2}
                className="h-24 text-center text-muted-foreground"
              >
                No hay valores cargados para este índice
              </TableCell>
            </TableRow>
          ) : (
            values.map((value) => (
              <TableRow key={value.id} data-testid={`price-index-value-row-${value.id}`}>
                <TableCell data-testid={`price-index-value-period-${value.id}`}>
                  {moment.utc(value.period).format('MM/YYYY')}
                </TableCell>
                <TableCell data-testid={`price-index-value-percentage-${value.id}`}>
                  {value.percentage > 0 ? '+' : ''}
                  {value.percentage}%
                </TableCell>
                {hasAnyAction && (
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      {permissions.canUpdate && (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleEdit(value)}
                          data-testid={`price-index-value-edit-${value.id}`}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                      )}
                      {permissions.canDelete && (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleDelete(value)}
                          data-testid={`price-index-value-delete-${value.id}`}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                )}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>

      <_PriceIndexValueFormModal
        open={formModalOpen}
        onOpenChange={handleFormModalClose}
        indexId={indexId}
        value={selectedValue}
      />

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent data-testid="price-index-value-delete-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar valor de índice?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta acción no se puede deshacer. El valor del período &quot;
              {selectedValue ? moment.utc(selectedValue.period).format('MM/YYYY') : ''}&quot; será
              eliminado permanentemente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => selectedValue && deleteMutation.mutate(selectedValue.id)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? 'Eliminando...' : 'Eliminar'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
