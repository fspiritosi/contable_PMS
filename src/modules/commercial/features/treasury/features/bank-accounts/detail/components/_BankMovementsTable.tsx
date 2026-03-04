'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { CheckCircle2, Circle } from 'lucide-react';

import { DataTable, type DataTableSearchParams, type DataTableFacetedFilterConfig } from '@/shared/components/common/DataTable';
import { Button } from '@/shared/components/ui/button';
import {
  reconcileBankMovement,
  reconcileMultipleBankMovements,
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

interface Props {
  data: BankMovement[];
  totalRows: number;
  searchParams: DataTableSearchParams;
}

export function _BankMovementsTable({ data, totalRows, searchParams }: Props) {
  const router = useRouter();
  const [selectedRows, setSelectedRows] = useState<BankMovement[]>([]);
  const [isLoading, setIsLoading] = useState(false);
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

  const pendingSelected = selectedRows.filter((r) => !r.reconciled);
  const reconciledSelected = selectedRows.filter((r) => r.reconciled);

  const canReconcile = hasPermission('commercial.treasury.bank-accounts', 'update');

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
    () => getMovementColumns({ onToggleReconcile: handleToggleReconcile, isLoading, canReconcile }),
    [isLoading, canReconcile]
  );

  const toolbarActions = (
    <>
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
  );
}
