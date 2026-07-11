'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/shared/components/ui/button';
import { DataTable, type DataTableSearchParams } from '@/shared/components/common/DataTable';
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
import type { ModulePermissions } from '@/shared/lib/permissions';

import { getColumns } from '../columns';
import { _CreateFundMovementModal } from './_CreateFundMovementModal';
import {
  confirmFundMovement,
  deleteFundMovement,
  type FundMovementListItem,
  type FundOption,
  type FundMovementPartnerOption,
} from '../actions.server';

interface Props {
  data: FundMovementListItem[];
  totalRows: number;
  searchParams: DataTableSearchParams;
  permissions: ModulePermissions;
  banks: FundOption[];
  cashRegisters: FundOption[];
  partners: FundMovementPartnerOption[];
  hasContributionsAccount: boolean;
}

export function _FundMovementsTable({
  data,
  totalRows,
  searchParams,
  permissions,
  banks,
  cashRegisters,
  partners,
  hasContributionsAccount,
}: Props) {
  const router = useRouter();
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<FundMovementListItem | null>(null);
  const [confirming, setConfirming] = useState<FundMovementListItem | null>(null);
  const [deleting, setDeleting] = useState<FundMovementListItem | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  const refresh = () => router.refresh();

  const columns = useMemo(
    () =>
      getColumns({
        onEdit: setEditing,
        onConfirm: setConfirming,
        onDelete: setDeleting,
        permissions,
      }),
    [permissions]
  );

  const handleConfirm = async () => {
    if (!confirming) return;
    setIsBusy(true);
    try {
      await confirmFundMovement(confirming.id);
      toast.success('Movimiento confirmado');
      refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Error al confirmar el movimiento');
    } finally {
      setIsBusy(false);
      setConfirming(null);
    }
  };

  const handleDelete = async () => {
    if (!deleting) return;
    setIsBusy(true);
    try {
      await deleteFundMovement(deleting.id);
      toast.success('Borrador eliminado');
      refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Error al eliminar el movimiento');
    } finally {
      setIsBusy(false);
      setDeleting(null);
    }
  };

  return (
    <>
      <DataTable
        columns={columns}
        data={data}
        totalRows={totalRows}
        searchParams={searchParams}
        showSearch={false}
        tableId="commercial-fund-movements"
        toolbarActions={
          permissions.canCreate ? (
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Nuevo Movimiento
            </Button>
          ) : null
        }
      />

      {/* Alta */}
      <_CreateFundMovementModal
        open={createOpen}
        onOpenChange={setCreateOpen}
        banks={banks}
        cashRegisters={cashRegisters}
        partners={partners}
        hasContributionsAccount={hasContributionsAccount}
        onSuccess={refresh}
      />

      {/* Edición de borrador */}
      <_CreateFundMovementModal
        open={!!editing}
        onOpenChange={(open) => !open && setEditing(null)}
        banks={banks}
        cashRegisters={cashRegisters}
        partners={partners}
        hasContributionsAccount={hasContributionsAccount}
        movement={editing}
        onSuccess={refresh}
      />

      {/* Confirmar */}
      <AlertDialog open={!!confirming} onOpenChange={(open) => !open && setConfirming(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Confirmar este movimiento?</AlertDialogTitle>
            <AlertDialogDescription>
              Al confirmarlo se actualizará el saldo del banco/caja y se generará el asiento
              contable. Esta acción no se puede deshacer desde acá.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isBusy}>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirm} disabled={isBusy}>
              Confirmar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Eliminar */}
      <AlertDialog open={!!deleting} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar este borrador?</AlertDialogTitle>
            <AlertDialogDescription>
              El movimiento en borrador &quot;{deleting?.description}&quot; se eliminará
              permanentemente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isBusy}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={isBusy}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
