'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/shared/components/ui/button';
import { Plus } from 'lucide-react';
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
import type { CheckListItem } from '../../../../shared/types';
import { CHECK_STATUS_LABELS, CHECK_TYPE_LABELS } from '../../../../shared/validators';
import { voidCheck, deleteCheck } from '../../actions.server';
import { getColumns } from '../columns';
import { _CreateCheckModal } from './_CreateCheckModal';
import { _CheckDetailModal } from './_CheckDetailModal';
import { _EditCheckModal } from './_EditCheckModal';
import { _DepositCheckModal } from './_DepositCheckModal';
import { _EndorseCheckModal } from './_EndorseCheckModal';
import { _DebitCheckModal } from './_DebitCheckModal';
import { notifyCheckActionResult } from '../check-action-result';
import { usePermissions } from '@/shared/hooks/usePermissions';

interface FacetCounts {
  status: Record<string, number>;
  type: Record<string, number>;
}

interface Props {
  data: CheckListItem[];
  totalRows: number;
  searchParams: DataTableSearchParams;
  facetCounts?: FacetCounts;
}

export function _ChecksTable({ data, totalRows, searchParams, facetCounts }: Props) {
  const router = useRouter();
  const [createOpen, setCreateOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [depositOpen, setDepositOpen] = useState(false);
  const [endorseOpen, setEndorseOpen] = useState(false);
  const [debitOpen, setDebitOpen] = useState(false);
  const [voidDialogOpen, setVoidDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [selectedCheck, setSelectedCheck] = useState<CheckListItem | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const { hasPermission } = usePermissions();

  const handleVoid = async () => {
    if (!selectedCheck) return;
    setIsProcessing(true);
    try {
      const result = await voidCheck(selectedCheck.id);
      if (notifyCheckActionResult(result, 'Cheque anulado correctamente')) {
        setVoidDialogOpen(false);
        router.refresh();
      }
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDelete = async () => {
    if (!selectedCheck) return;
    setIsProcessing(true);
    try {
      const result = await deleteCheck(selectedCheck.id);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success('Cheque eliminado correctamente');
      setDeleteDialogOpen(false);
      router.refresh();
    } finally {
      setIsProcessing(false);
    }
  };

  const canCreate = hasPermission('commercial.treasury.checks', 'create');
  const canUpdate = hasPermission('commercial.treasury.checks', 'update');
  const canDelete = hasPermission('commercial.treasury.checks', 'delete');
  const canApprove = hasPermission('commercial.treasury.checks', 'approve');

  const facetedFilters: DataTableFacetedFilterConfig[] = useMemo(
    () => [
      {
        columnId: 'checkNumber',
        title: 'Número',
        type: 'text' as const,
        placeholder: 'Buscar por número...',
      },
      {
        columnId: 'bankName',
        title: 'Banco',
        type: 'text' as const,
        placeholder: 'Buscar por banco...',
      },
      {
        columnId: 'drawerName',
        title: 'Librador',
        type: 'text' as const,
        placeholder: 'Buscar por librador...',
      },
      {
        columnId: 'status',
        title: 'Estado',
        options: Object.entries(CHECK_STATUS_LABELS).map(([value, label]) => ({
          label,
          value,
        })),
        externalCounts: facetCounts?.status ? new Map(Object.entries(facetCounts.status)) : undefined,
      },
      {
        columnId: 'type',
        title: 'Tipo',
        options: Object.entries(CHECK_TYPE_LABELS).map(([value, label]) => ({
          label,
          value,
        })),
        externalCounts: facetCounts?.type ? new Map(Object.entries(facetCounts.type)) : undefined,
      },
      {
        columnId: 'issueDate',
        title: 'Fecha Emisión',
        type: 'dateRange' as const,
      },
      {
        columnId: 'dueDate',
        title: 'Fecha Vencimiento',
        type: 'dateRange' as const,
      },
    ],
    [facetCounts]
  );

  const columns = useMemo(
    () =>
      getColumns({
        onView: (check) => {
          setSelectedCheck(check);
          setDetailOpen(true);
        },
        onEdit: (check) => {
          setSelectedCheck(check);
          setEditOpen(true);
        },
        onDeposit: (check) => {
          setSelectedCheck(check);
          setDepositOpen(true);
        },
        onEndorse: (check) => {
          setSelectedCheck(check);
          setEndorseOpen(true);
        },
        onDebit: (check) => {
          setSelectedCheck(check);
          setDebitOpen(true);
        },
        onVoid: (check) => {
          setSelectedCheck(check);
          setVoidDialogOpen(true);
        },
        onDelete: (check) => {
          setSelectedCheck(check);
          setDeleteDialogOpen(true);
        },
        canDeposit: canUpdate,
        canEndorse: canUpdate,
        canUpdate,
        canDebit: canApprove,
        canVoid: canDelete,
        canDelete,
      }),
    [canUpdate, canDelete, canApprove]
  );

  return (
    <>
      <DataTable
        columns={columns}
        data={data}
        totalRows={totalRows}
        searchParams={searchParams}
        showSearch={false}
        facetedFilters={facetedFilters}
        tableId="commercial-checks"
        showFilterToggle
        toolbarActions={
          canCreate && (
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Nuevo Cheque
            </Button>
          )
        }
      />

      <_CreateCheckModal open={createOpen} onOpenChange={setCreateOpen} />

      {selectedCheck && (
        <>
          <_CheckDetailModal
            open={detailOpen}
            onOpenChange={setDetailOpen}
            checkId={selectedCheck.id}
          />
          <_EditCheckModal
            open={editOpen}
            onOpenChange={setEditOpen}
            checkId={selectedCheck.id}
          />
          <_DepositCheckModal
            key={`deposit-${selectedCheck.id}`}
            open={depositOpen}
            onOpenChange={setDepositOpen}
            check={selectedCheck}
          />
          <_EndorseCheckModal
            open={endorseOpen}
            onOpenChange={setEndorseOpen}
            check={selectedCheck}
          />
          <_DebitCheckModal
            key={selectedCheck.id}
            open={debitOpen}
            onOpenChange={setDebitOpen}
            check={selectedCheck}
          />
        </>
      )}

      <AlertDialog open={voidDialogOpen} onOpenChange={setVoidDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Anular cheque?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta acción anulará el cheque N° <strong>{selectedCheck?.checkNumber}</strong>.
              Si estaba depositado, se eliminará el movimiento bancario asociado. Si corresponde,
              se generará el asiento de la anulación.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isProcessing}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleVoid}
              disabled={isProcessing}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isProcessing ? 'Anulando...' : 'Anular'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar cheque?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta acción eliminará permanentemente el cheque N°{' '}
              <strong>{selectedCheck?.checkNumber}</strong>. Esta acción no se puede deshacer.
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
    </>
  );
}
