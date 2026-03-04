'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { usePermissions } from '@/shared/hooks/usePermissions';

import { DataTable, type DataTableSearchParams, type DataTableFacetedFilterConfig } from '@/shared/components/common/DataTable';
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
import { confirmExpense, cancelExpense, deleteExpense } from '../../actions.server';
import { getColumns, type ExpenseListItem } from '../columns';
import { EXPENSE_STATUS_LABELS } from '../../validators';
import { _CreateExpenseModal } from './_CreateExpenseModal';
import { _ExpenseDetailModal } from './_ExpenseDetailModal';

interface Props {
  data: ExpenseListItem[];
  totalRows: number;
  searchParams: DataTableSearchParams;
}

export function _ExpensesTable({ data, totalRows, searchParams }: Props) {
  const router = useRouter();
  const { hasPermission } = usePermissions();
  const [confirmDialogOpen, setConfirmDialogOpen] = useState(false);
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [detailModalOpen, setDetailModalOpen] = useState(false);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [selectedExpense, setSelectedExpense] = useState<ExpenseListItem | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  const handleConfirm = async () => {
    if (!selectedExpense) return;

    setIsProcessing(true);
    try {
      await confirmExpense(selectedExpense.id);
      toast.success('Gasto confirmado correctamente');
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Error al confirmar gasto');
    } finally {
      setIsProcessing(false);
      setConfirmDialogOpen(false);
      setSelectedExpense(null);
    }
  };

  const handleCancel = async () => {
    if (!selectedExpense) return;

    setIsProcessing(true);
    try {
      await cancelExpense(selectedExpense.id);
      toast.success('Gasto cancelado correctamente');
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Error al cancelar gasto');
    } finally {
      setIsProcessing(false);
      setCancelDialogOpen(false);
      setSelectedExpense(null);
    }
  };

  const handleDelete = async () => {
    if (!selectedExpense) return;

    setIsProcessing(true);
    try {
      await deleteExpense(selectedExpense.id);
      toast.success('Gasto eliminado correctamente');
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Error al eliminar gasto');
    } finally {
      setIsProcessing(false);
      setDeleteDialogOpen(false);
      setSelectedExpense(null);
    }
  };

  const canCreate = hasPermission('commercial.expenses', 'create');
  const canUpdate = hasPermission('commercial.expenses', 'update');
  const canApprove = hasPermission('commercial.expenses', 'approve');
  const canDelete = hasPermission('commercial.expenses', 'delete');

  const facetedFilters: DataTableFacetedFilterConfig[] = useMemo(
    () => [
      {
        columnId: 'status',
        title: 'Estado',
        options: Object.entries(EXPENSE_STATUS_LABELS).map(([value, label]) => ({
          label,
          value,
        })),
      },
      {
        columnId: 'date',
        title: 'Fecha',
        type: 'dateRange' as const,
      },
      {
        columnId: 'dueDate',
        title: 'Vencimiento',
        type: 'dateRange' as const,
      },
    ],
    []
  );

  const columns = useMemo(
    () =>
      getColumns({
        onViewDetail: (expense) => {
          setSelectedExpense(expense);
          setDetailModalOpen(true);
        },
        onEdit: canUpdate
          ? (expense) => {
              setSelectedExpense(expense);
              setEditModalOpen(true);
            }
          : undefined,
        onConfirm: canApprove
          ? (expense) => {
              setSelectedExpense(expense);
              setConfirmDialogOpen(true);
            }
          : undefined,
        onCancel: canDelete
          ? (expense) => {
              setSelectedExpense(expense);
              setCancelDialogOpen(true);
            }
          : undefined,
        onDelete: canDelete
          ? (expense) => {
              setSelectedExpense(expense);
              setDeleteDialogOpen(true);
            }
          : undefined,
      }),
    [canUpdate, canApprove, canDelete]
  );

  return (
    <>
      <DataTable
        columns={columns}
        data={data}
        totalRows={totalRows}
        searchParams={searchParams}
        searchPlaceholder="Buscar gastos..."
        facetedFilters={facetedFilters}
        tableId="commercial-expenses"
        showFilterToggle
        toolbarActions={canCreate ? <_CreateExpenseModal onSuccess={() => router.refresh()} /> : undefined}
      />

      {/* Diálogo de Confirmación */}
      <AlertDialog open={confirmDialogOpen} onOpenChange={setConfirmDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmar gasto</AlertDialogTitle>
            <AlertDialogDescription>
              Al confirmar el gasto {selectedExpense?.fullNumber}, quedará registrado como confirmado
              y podrá ser incluido en una orden de pago. Esta acción no se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isProcessing}>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirm} disabled={isProcessing}>
              {isProcessing ? 'Confirmando...' : 'Confirmar'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Diálogo de Cancelación */}
      <AlertDialog open={cancelDialogOpen} onOpenChange={setCancelDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancelar gasto</AlertDialogTitle>
            <AlertDialogDescription>
              ¿Estás seguro de que deseas cancelar el gasto {selectedExpense?.fullNumber}?
              Solo se pueden cancelar gastos sin pagos confirmados. Esta acción no se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isProcessing}>Volver</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleCancel}
              disabled={isProcessing}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isProcessing ? 'Cancelando...' : 'Cancelar Gasto'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Diálogo de Eliminación */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Eliminar gasto</AlertDialogTitle>
            <AlertDialogDescription>
              Esta acción eliminará permanentemente el gasto {selectedExpense?.fullNumber} y todos
              sus registros asociados. Esta acción no se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isProcessing}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={isProcessing}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isProcessing ? 'Eliminando...' : 'Eliminar'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Modal de Detalle */}
      <_ExpenseDetailModal
        expenseId={selectedExpense?.id ?? null}
        open={detailModalOpen}
        onOpenChange={setDetailModalOpen}
        onSuccess={() => router.refresh()}
      />

      {/* Modal de Edición */}
      {editModalOpen && selectedExpense && (
        <_CreateExpenseModal
          expenseId={selectedExpense.id}
          open={editModalOpen}
          onOpenChange={setEditModalOpen}
          onSuccess={() => {
            setEditModalOpen(false);
            router.refresh();
          }}
        />
      )}
    </>
  );
}
