'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { type ColumnDef, type RowSelectionState } from '@tanstack/react-table';
import { MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import moment from 'moment';
import { toast } from 'sonner';
import { DataTable } from '@/shared/components/common/DataTable';
import { Button } from '@/shared/components/ui/button';
import { Checkbox } from '@/shared/components/ui/checkbox';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/shared/components/ui/dropdown-menu';
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
import { deletePriceListItem, bulkDeletePriceListItems } from '../../list/actions.server';
import type { PriceListItem } from '../../../../shared/types';
import { logger } from '@/shared/lib/logger';
import { _AddPriceListItemDialog } from './_AddPriceListItemDialog';
import { _EditPriceListItemDialog } from './_EditPriceListItemDialog';
import { _BulkAddItemsDialog } from './_BulkAddItemsDialog';
import { usePermissions } from '@/shared/hooks/usePermissions';

interface PriceListItemsTableProps {
  priceListId: string;
  items: PriceListItem[];
}

export function _PriceListItemsTable({ priceListId, items }: PriceListItemsTableProps) {
  const router = useRouter();
  const { hasPermission } = usePermissions();
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [editingItem, setEditingItem] = useState<PriceListItem | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);

  const canDelete = hasPermission('commercial.price-lists', 'delete');

  const selectedCount = Object.keys(rowSelection).filter((k) => rowSelection[k]).length;

  const handleDelete = async () => {
    if (!deleteTarget) return;

    setDeletingId(deleteTarget.id);
    setDeleteTarget(null);
    try {
      await deletePriceListItem(deleteTarget.id);
      toast.success('Producto eliminado de la lista');
      router.refresh();
    } catch (error) {
      logger.error('Error al eliminar item', { data: { error } });
      toast.error(error instanceof Error ? error.message : 'Error al eliminar item');
    } finally {
      setDeletingId(null);
    }
  };

  const handleBulkDelete = async () => {
    const selectedIndices = Object.keys(rowSelection).filter((k) => rowSelection[k]);
    const selectedIds = selectedIndices.map((idx) => items[parseInt(idx)].id);

    if (selectedIds.length === 0) return;

    setIsBulkDeleting(true);
    setBulkDeleteOpen(false);
    try {
      const count = await bulkDeletePriceListItems(selectedIds);
      toast.success(`${count} producto${count !== 1 ? 's' : ''} eliminado${count !== 1 ? 's' : ''} de la lista`);
      setRowSelection({});
      router.refresh();
    } catch (error) {
      logger.error('Error al eliminar items masivamente', { data: { error } });
      toast.error(error instanceof Error ? error.message : 'Error al eliminar items');
    } finally {
      setIsBulkDeleting(false);
    }
  };

  const columns = useMemo<ColumnDef<PriceListItem>[]>(
    () => [
      ...(canDelete
        ? [
            {
              id: 'select',
              header: ({ table }: any) => (
                <Checkbox
                  checked={table.getIsAllPageRowsSelected()}
                  onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
                  aria-label="Seleccionar todos"
                />
              ),
              cell: ({ row }: any) => (
                <Checkbox
                  checked={row.getIsSelected()}
                  onCheckedChange={(value) => row.toggleSelected(!!value)}
                  aria-label="Seleccionar fila"
                />
              ),
              enableSorting: false,
              meta: { title: '' },
            } as ColumnDef<PriceListItem>,
          ]
        : []),
      {
        accessorKey: 'product.code',
        header: 'Código',
        meta: { title: 'Código' },
        cell: ({ row }) => row.original.product?.code || '-',
      },
      {
        accessorKey: 'product.name',
        header: 'Producto',
        meta: { title: 'Producto' },
        cell: ({ row }) => (
          <span className="font-medium">{row.original.product?.name || '-'}</span>
        ),
      },
      {
        accessorKey: 'price',
        header: 'Precio',
        meta: { title: 'Precio' },
        cell: ({ row }) => `$${row.original.price.toFixed(2)}`,
      },
      {
        accessorKey: 'product.vatRate',
        header: 'IVA',
        meta: { title: 'IVA' },
        cell: ({ row }) => `${row.original.product?.vatRate || 0}%`,
      },
      {
        accessorKey: 'priceWithTax',
        header: 'Precio con IVA',
        meta: { title: 'Precio con IVA' },
        cell: ({ row }) => (
          <span className="font-medium">${row.original.priceWithTax.toFixed(2)}</span>
        ),
      },
      {
        accessorKey: 'updatedAt',
        header: 'Modificado',
        meta: { title: 'Modificado' },
        cell: ({ row }) =>
          row.original.updatedAt ? (
            <span className="text-xs text-muted-foreground">
              {moment(row.original.updatedAt).format('DD/MM/YY HH:mm')}
            </span>
          ) : null,
      },
      {
        id: 'actions',
        meta: { title: 'Acciones' },
        cell: ({ row }) => {
          const item = row.original;

          return (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="h-8 w-8 p-0">
                  <span className="sr-only">Abrir menú</span>
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>Acciones</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {hasPermission('commercial.price-lists', 'update') && (
                  <DropdownMenuItem onClick={() => setEditingItem(item)}>
                    <Pencil className="mr-2 h-4 w-4" />
                    Editar precio
                  </DropdownMenuItem>
                )}
                {canDelete && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={() => setDeleteTarget({ id: item.id, name: item.product?.name || 'el producto' })}
                      disabled={deletingId === item.id}
                      className="text-destructive focus:text-destructive"
                    >
                      <Trash2 className="mr-2 h-4 w-4" />
                      Eliminar
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          );
        },
      },
    ],
    [deletingId, canDelete]
  );

  return (
    <>
      <DataTable
        columns={columns as ColumnDef<Record<string, unknown>, unknown>[]}
        data={items as unknown as Record<string, unknown>[]}
        totalRows={items.length}
        tableId="commercial-price-list-items"
        searchPlaceholder="Buscar por código o nombre..."
        enableRowSelection={canDelete}
        showRowSelection={canDelete}
        onRowSelectionChange={setRowSelection}
        toolbarActions={
          <div className="flex gap-2">
            {canDelete && selectedCount > 0 && (
              <Button
                variant="destructive"
                size="sm"
                onClick={() => setBulkDeleteOpen(true)}
                disabled={isBulkDeleting}
              >
                <Trash2 className="mr-1 h-4 w-4" />
                Eliminar ({selectedCount})
              </Button>
            )}
            {hasPermission('commercial.price-lists', 'update') && (
              <>
                <_AddPriceListItemDialog priceListId={priceListId} />
                <_BulkAddItemsDialog
                  priceListId={priceListId}
                  existingProductIds={items.map((i) => i.productId)}
                />
              </>
            )}
          </div>
        }
      />

      {editingItem && (
        <_EditPriceListItemDialog
          item={editingItem}
          open={!!editingItem}
          onOpenChange={(open) => !open && setEditingItem(null)}
        />
      )}

      {/* Delete individual */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Estás seguro?</AlertDialogTitle>
            <AlertDialogDescription>
              Vas a eliminar &quot;{deleteTarget?.name}&quot; de esta lista. Esta acción no se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>Eliminar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete bulk */}
      <AlertDialog open={bulkDeleteOpen} onOpenChange={setBulkDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Eliminar {selectedCount} producto{selectedCount !== 1 ? 's' : ''}</AlertDialogTitle>
            <AlertDialogDescription>
              Vas a eliminar {selectedCount} producto{selectedCount !== 1 ? 's' : ''} de esta lista de precios. Esta acción no se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleBulkDelete}>
              Eliminar {selectedCount}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
