'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  CheckCircle2,
  Clock,
  ListChecks,
  BarChart3,
} from 'lucide-react';

import { DataTable, type DataTableSearchParams } from '@/shared/components/common/DataTable';
import { Button } from '@/shared/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/components/ui/card';
import { reconcileMultipleBankMovements } from '../../../bank-movements/actions.server';
import { getReconciliationColumns } from '../columns';
import { _LinkDocumentDialog } from './_LinkDocumentDialog';

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
}

interface ReconciliationStats {
  total: number;
  reconciled: number;
  pending: number;
  percentage: number;
}

interface Props {
  data: BankMovement[];
  totalRows: number;
  searchParams: DataTableSearchParams;
  stats: ReconciliationStats;
  bankAccountId: string;
}

export function _ReconciliationView({ data, totalRows, searchParams, stats, bankAccountId }: Props) {
  const router = useRouter();
  const [selectedRows, setSelectedRows] = useState<BankMovement[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [linkDialogOpen, setLinkDialogOpen] = useState(false);
  const [movementToLink, setMovementToLink] = useState<BankMovement | null>(null);

  const handleBulkReconcile = async () => {
    const ids = selectedRows.map((r) => r.id);
    if (ids.length === 0) return;

    try {
      setIsLoading(true);
      const result = await reconcileMultipleBankMovements(ids, true);
      toast.success(`${result.count} movimiento(s) conciliado(s)`);
      setSelectedRows([]);
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Error al conciliar');
    } finally {
      setIsLoading(false);
    }
  };

  const handleOpenLinkDialog = (movement: BankMovement) => {
    setMovementToLink(movement);
    setLinkDialogOpen(true);
  };

  const columns = useMemo(
    () => getReconciliationColumns({ onLink: handleOpenLinkDialog }),
    []
  );

  const toolbarActions = selectedRows.length > 0 ? (
    <Button
      size="sm"
      onClick={handleBulkReconcile}
      disabled={isLoading}
    >
      <CheckCircle2 className="mr-2 h-4 w-4" />
      Conciliar ({selectedRows.length})
    </Button>
  ) : null;

  return (
    <div className="space-y-6">
      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 mb-2">
              <ListChecks className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Total Movimientos</span>
            </div>
            <div className="text-2xl font-bold">{stats.total}</div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 mb-2">
              <CheckCircle2 className="h-4 w-4 text-green-600" />
              <span className="text-sm text-muted-foreground">Conciliados</span>
            </div>
            <div className="text-2xl font-bold text-green-600">{stats.reconciled}</div>
            <div className="mt-2">
              <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
                <span>Progreso</span>
                <span>{stats.percentage}%</span>
              </div>
              <div className="h-2 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full rounded-full bg-green-600 transition-all duration-300"
                  style={{ width: `${stats.percentage}%` }}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 mb-2">
              <Clock className="h-4 w-4 text-orange-600" />
              <span className="text-sm text-muted-foreground">Pendientes</span>
            </div>
            <div className="text-2xl font-bold text-orange-600">{stats.pending}</div>
          </CardContent>
        </Card>
      </div>

      {/* Pending Movements Table */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5 text-muted-foreground" />
            <div>
              <CardTitle>Movimientos Pendientes</CardTitle>
              <CardDescription>
                Selecciona los movimientos que deseas conciliar o vincúlalos a un documento
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {totalRows === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <CheckCircle2 className="h-12 w-12 text-green-600 mb-4" />
              <h3 className="text-lg font-semibold">Todo conciliado</h3>
              <p className="text-muted-foreground mt-1">
                No hay movimientos pendientes de conciliación
              </p>
            </div>
          ) : (
            <DataTable<BankMovement>
              columns={columns}
              data={data}
              totalRows={totalRows}
              searchParams={searchParams}
              showSearch={false}
              tableId="commercial-bank-reconciliation"
              enableRowSelection
              showRowSelection
              onRowSelectionChange={setSelectedRows}
              toolbarActions={toolbarActions}
            />
          )}
        </CardContent>
      </Card>

      {/* Dialog para vincular movimiento */}
      <_LinkDocumentDialog
        open={linkDialogOpen}
        onOpenChange={setLinkDialogOpen}
        movement={movementToLink}
        bankAccountId={bankAccountId}
      />
    </div>
  );
}
