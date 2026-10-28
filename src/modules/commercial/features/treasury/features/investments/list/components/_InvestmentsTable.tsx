'use client';

import { Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';

import { DataTable } from '@/shared/components/common/DataTable';
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui/select';
import { usePermissions } from '@/shared/hooks/usePermissions';

import { deleteInvestmentHolding, type InvestmentHoldingRow } from '../actions.server';
import { getColumns } from '../columns';
import { _HoldingFormModal } from './_HoldingFormModal';

interface Props {
  data: InvestmentHoldingRow[];
  /** Si viene, la tabla es la de una sola cuenta: sin filtro ni columna de custodia. */
  fixedBankAccountId?: string;
}

const ALL = 'ALL';

export function _InvestmentsTable({ data, fixedBankAccountId }: Props) {
  const router = useRouter();
  const { hasPermission } = usePermissions();
  const canCreate = hasPermission('commercial.treasury.investments', 'create');
  const canUpdate = hasPermission('commercial.treasury.investments', 'update');
  const canDelete = hasPermission('commercial.treasury.investments', 'delete');

  const [bankFilter, setBankFilter] = useState(ALL);
  const [statusFilter, setStatusFilter] = useState(ALL);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<InvestmentHoldingRow | null>(null);
  const [deleting, setDeleting] = useState<InvestmentHoldingRow | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const banks = useMemo(
    () => [...new Map(data.map((h) => [h.bankAccountId, h.bankAccountLabel]))],
    [data]
  );
  const rows = data.filter(
    (h) =>
      (bankFilter === ALL || h.bankAccountId === bankFilter) &&
      (statusFilter === ALL || h.status === statusFilter)
  );

  const columns = useMemo(
    () =>
      getColumns({
        canUpdate,
        canDelete,
        hideBankAccount: !!fixedBankAccountId,
        onEdit: (holding) => {
          setEditing(holding);
          setFormOpen(true);
        },
        onDelete: setDeleting,
      }),
    [canUpdate, canDelete, fixedBankAccountId]
  );

  const handleDelete = async () => {
    if (!deleting) return;
    setIsDeleting(true);
    const result = await deleteInvestmentHolding(deleting.id);
    setIsDeleting(false);
    if (result.success) {
      toast.success('Tenencia eliminada');
      setDeleting(null);
      router.refresh();
    } else {
      toast.error(result.error);
      setDeleting(null);
    }
  };

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {!fixedBankAccountId && (
          <Select value={bankFilter} onValueChange={setBankFilter}>
            <SelectTrigger className="w-full sm:w-64">
              <SelectValue placeholder="Banco / broker" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Todos los bancos y brokers</SelectItem>
              {banks.map(([id, label]) => (
                <SelectItem key={id} value={id}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-full sm:w-44">
            <SelectValue placeholder="Estado" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Todos los estados</SelectItem>
            <SelectItem value="OPEN">Abiertas</SelectItem>
            <SelectItem value="CLOSED">Cerradas</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <DataTable
        columns={columns}
        data={rows}
        totalRows={rows.length}
        searchParams={{ pageSize: '100' }}
        showSearch={false}
        tableId={fixedBankAccountId ? 'commercial-bank-holdings' : 'commercial-investments'}
        toolbarActions={
          canCreate ? (
            <Button
              onClick={() => {
                setEditing(null);
                setFormOpen(true);
              }}
            >
              <Plus className="mr-2 h-4 w-4" />
              Nueva tenencia
            </Button>
          ) : null
        }
      />

      <_HoldingFormModal
        open={formOpen}
        onOpenChange={setFormOpen}
        holding={editing}
        defaultBankAccountId={fixedBankAccountId}
        onSuccess={() => router.refresh()}
      />

      <AlertDialog open={!!deleting} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Eliminar tenencia</AlertDialogTitle>
            <AlertDialogDescription>
              Vas a eliminar la tenencia «{deleting?.name}». Solo se puede si no tiene movimientos.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} disabled={isDeleting}>
              {isDeleting ? 'Eliminando...' : 'Eliminar'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
