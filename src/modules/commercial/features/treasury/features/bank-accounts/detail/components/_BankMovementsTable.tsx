'use client';

import { useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import moment from 'moment';
import { ArrowDownCircle, ArrowUpCircle, CheckCircle2, Circle, Download, Loader2, TrendingUp } from 'lucide-react';

import { DataTable, type DataTableSearchParams, type DataTableFacetedFilterConfig } from '@/shared/components/common/DataTable';
import { Button } from '@/shared/components/ui/button';
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
import { exportToExcel, type ExcelColumn } from '@/shared/lib/excel-export';
import { formatCurrency } from '@/shared/utils/formatters';
import {
  reconcileBankMovement,
  reconcileMultipleBankMovements,
  getAllBankMovementsForExport,
  deleteBankMovement,
} from '../../../bank-movements/actions.server';
import { BANK_MOVEMENT_TYPE_LABELS } from '../../../../shared/validators';
import { getMovementColumns } from '../columns';
import { usePermissions } from '@/shared/hooks/usePermissions';

interface BankMovement extends Record<string, unknown> {
  id: string;
  type: string;
  amount: number;
  date: Date;
  description: string;
  reference: string | null;
  statementNumber: string | null;
  reconciled: boolean;
  reconciledAt: Date | null;
  createdAt: Date;
  receipt?: { id: string; fullNumber: string } | null;
  paymentOrder?: { id: string; fullNumber: string } | null;
}

interface MovementsTotals {
  totalEntries: number;
  totalExits: number;
  netBalance: number;
}

interface Props {
  data: BankMovement[];
  totalRows: number;
  searchParams: DataTableSearchParams;
  bankAccountId: string;
  bankAccountName?: string;
  totals?: MovementsTotals;
}

export function _BankMovementsTable({ data, totalRows, searchParams, bankAccountId, bankAccountName, totals }: Props) {
  const router = useRouter();
  const currentSearchParams = useSearchParams();
  const [selectedRows, setSelectedRows] = useState<BankMovement[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [movementToDelete, setMovementToDelete] = useState<BankMovement | null>(null);
  const { hasPermission } = usePermissions();

  const handleToggleReconcile = async (movement: BankMovement) => {
    try {
      setIsLoading(true);
      await reconcileBankMovement(movement.id, !movement.reconciled);
      toast.success(
        movement.reconciled ? 'Movimiento desconciliado' : 'Movimiento conciliado'
      );
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Error al conciliar');
    } finally {
      setIsLoading(false);
    }
  };

  const handleBulkReconcile = async (reconcile: boolean) => {
    const ids = selectedRows.map((r) => r.id);
    if (ids.length === 0) return;

    try {
      setIsLoading(true);
      const result = await reconcileMultipleBankMovements(ids, reconcile);
      toast.success(
        `${result.count} movimiento(s) ${reconcile ? 'conciliado(s)' : 'desconciliado(s)'}`
      );
      setSelectedRows([]);
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Error al conciliar');
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeleteMovement = async () => {
    if (!movementToDelete) return;
    try {
      setIsLoading(true);
      await deleteBankMovement(movementToDelete.id);
      toast.success('Movimiento eliminado correctamente');
      setMovementToDelete(null);
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Error al eliminar movimiento');
    } finally {
      setIsLoading(false);
    }
  };

  const handleExportExcel = async () => {
    setIsExporting(true);
    try {
      // Build searchParams from current URL params for the server action
      const exportParams: DataTableSearchParams = {};
      currentSearchParams.forEach((value, key) => {
        exportParams[key] = value;
      });

      const allData = await getAllBankMovementsForExport(bankAccountId, exportParams);

      const excelColumns: ExcelColumn[] = [
        {
          key: 'date',
          title: 'Fecha',
          width: 15,
          formatter: (value) => moment(value as string).format('DD/MM/YYYY'),
        },
        {
          key: 'type',
          title: 'Tipo',
          width: 22,
          formatter: (value) => BANK_MOVEMENT_TYPE_LABELS[value as keyof typeof BANK_MOVEMENT_TYPE_LABELS] || String(value),
        },
        {
          key: 'description',
          title: 'Descripción',
          width: 40,
        },
        {
          key: 'reference',
          title: 'Referencia',
          width: 20,
        },
        {
          key: 'statementNumber',
          title: 'N° Extracto',
          width: 15,
        },
        {
          key: 'amount',
          title: 'Monto',
          width: 18,
          formatter: (value, row) => {
            const type = (row as BankMovement).type;
            const isIncome = ['DEPOSIT', 'TRANSFER_IN', 'INTEREST', 'CHECK'].includes(type);
            const amount = Number(value);
            return isIncome ? amount : -amount;
          },
        },
        {
          key: 'reconciled',
          title: 'Conciliado',
          width: 14,
          formatter: (value) => (value ? 'Sí' : 'No'),
        },
        {
          key: 'document',
          title: 'Documento',
          width: 20,
          formatter: (_value, row) => {
            const r = row as BankMovement;
            return r.receipt?.fullNumber || r.paymentOrder?.fullNumber || '';
          },
        },
      ];

      await exportToExcel(allData as unknown as Record<string, unknown>[], excelColumns, {
        filename: `movimientos-${bankAccountName || 'bancarios'}-${moment().format('YYYY-MM-DD')}`,
        sheetName: 'Movimientos',
        title: `Movimientos Bancarios${bankAccountName ? ` - ${bankAccountName}` : ''}`,
      });

      toast.success(`${allData.length} movimiento(s) exportados`);
    } catch {
      toast.error('Error al exportar movimientos');
    } finally {
      setIsExporting(false);
    }
  };

  const pendingSelected = selectedRows.filter((r) => !r.reconciled);
  const reconciledSelected = selectedRows.filter((r) => r.reconciled);

  const canReconcile = hasPermission('commercial.treasury.bank-accounts', 'update');
  const canDelete = hasPermission('commercial.treasury.bank-accounts', 'delete');

  const facetedFilters: DataTableFacetedFilterConfig[] = useMemo(
    () => [
      {
        columnId: 'type',
        title: 'Tipo',
        options: Object.entries(BANK_MOVEMENT_TYPE_LABELS).map(([value, label]) => ({
          label: label as string,
          value,
        })),
      },
      {
        columnId: 'reconciled',
        title: 'Conciliado',
        options: [
          { label: 'Conciliado', value: 'true' },
          { label: 'Pendiente', value: 'false' },
        ],
      },
      {
        columnId: 'date',
        title: 'Fecha',
        type: 'dateRange' as const,
      },
    ],
    []
  );

  const columns = useMemo(
    () => getMovementColumns({
      onToggleReconcile: handleToggleReconcile,
      onDelete: canDelete ? setMovementToDelete : undefined,
      isLoading,
      canReconcile,
      canDelete,
    }),
    [isLoading, canReconcile, canDelete]
  );

  const toolbarActions = (
    <>
      <Button
        size="sm"
        variant="outline"
        onClick={handleExportExcel}
        disabled={isExporting || totalRows === 0}
      >
        {isExporting ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        ) : (
          <Download className="mr-2 h-4 w-4" />
        )}
        Exportar Excel
      </Button>
      {canReconcile && pendingSelected.length > 0 && (
        <Button
          size="sm"
          onClick={() => handleBulkReconcile(true)}
          disabled={isLoading}
        >
          <CheckCircle2 className="mr-2 h-4 w-4" />
          Conciliar ({pendingSelected.length})
        </Button>
      )}
      {canReconcile && reconciledSelected.length > 0 && (
        <Button
          size="sm"
          variant="outline"
          onClick={() => handleBulkReconcile(false)}
          disabled={isLoading}
        >
          <Circle className="mr-2 h-4 w-4" />
          Desconciliar ({reconciledSelected.length})
        </Button>
      )}
    </>
  );

  return (
    <>
      <DataTable<BankMovement>
        columns={columns}
        data={data}
        totalRows={totalRows}
        searchParams={searchParams}
        showSearch={false}
        facetedFilters={facetedFilters}
        tableId="commercial-bank-movements"
        showFilterToggle
        enableRowSelection
        showRowSelection
        onRowSelectionChange={setSelectedRows}
        toolbarActions={toolbarActions}
      />

      {totals && (
        <div className="mt-4 flex flex-wrap items-center gap-4 rounded-lg border bg-muted/50 px-4 py-3">
          <div className="flex items-center gap-2">
            <ArrowDownCircle className="h-4 w-4 text-green-600" />
            <span className="text-sm text-muted-foreground">Entradas:</span>
            <span className="text-sm font-semibold text-green-600">{formatCurrency(totals.totalEntries)}</span>
          </div>
          <div className="flex items-center gap-2">
            <ArrowUpCircle className="h-4 w-4 text-red-600" />
            <span className="text-sm text-muted-foreground">Salidas:</span>
            <span className="text-sm font-semibold text-red-600">{formatCurrency(totals.totalExits)}</span>
          </div>
          <div className="flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm text-muted-foreground">Saldo filtrado:</span>
            <span className={`text-sm font-bold ${totals.netBalance >= 0 ? 'text-green-600' : 'text-red-600'}`}>
              {formatCurrency(totals.netBalance)}
            </span>
          </div>
        </div>
      )}

      <AlertDialog open={!!movementToDelete} onOpenChange={(open) => !open && setMovementToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Eliminar movimiento</AlertDialogTitle>
            <AlertDialogDescription>
              {movementToDelete && (
                <>
                  ¿Estás seguro de eliminar este movimiento de{' '}
                  <strong>
                    ${Math.abs(movementToDelete.amount).toLocaleString('es-AR', {
                      minimumFractionDigits: 2,
                    })}
                  </strong>
                  ? El saldo de la cuenta se actualizará automáticamente. Esta acción no se puede deshacer.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isLoading}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteMovement}
              disabled={isLoading}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isLoading ? 'Eliminando...' : 'Eliminar'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
