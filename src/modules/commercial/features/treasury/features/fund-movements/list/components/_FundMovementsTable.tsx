'use client';

import { Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';

import { DataTable, type DataTableSearchParams } from '@/shared/components/common/DataTable';
import { Button } from '@/shared/components/ui/button';
import type { ModulePermissions } from '@/shared/lib/permissions';

import type { FundMovementDetailMode } from '../../shared/view-mode';
import type {
  FundMovementAccountRef,
  FundMovementListItem,
  FundMovementPartnerOption,
  FundOption,
} from '../actions.server';
import { getColumns } from '../columns';
import { _CreateFundMovementModal } from './_CreateFundMovementModal';
import { _FundMovementConfirmDialogs } from './_FundMovementConfirmDialogs';

interface Props {
  data: FundMovementListItem[];
  totalRows: number;
  searchParams: DataTableSearchParams;
  permissions: ModulePermissions;
  banks: FundOption[];
  cashRegisters: FundOption[];
  partners: FundMovementPartnerOption[];
  defaultContributionsAccount: FundMovementAccountRef | null;
  defaultBankChargesAccount: FundMovementAccountRef | null;
}

type DetailSelection = { movement: FundMovementListItem; mode: FundMovementDetailMode };

export function _FundMovementsTable({
  data,
  totalRows,
  searchParams,
  permissions,
  banks,
  cashRegisters,
  partners,
  defaultContributionsAccount,
  defaultBankChargesAccount,
}: Props) {
  const router = useRouter();
  const [createOpen, setCreateOpen] = useState(false);
  // Edición y vista comparten una instancia del modal (TSK-720a, D8). Al cerrar
  // solo baja `detailOpen`: `selected` se conserva para que la animación de
  // salida no cambie título ni campos.
  const [selected, setSelected] = useState<DetailSelection | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [confirming, setConfirming] = useState<FundMovementListItem | null>(null);
  const [deleting, setDeleting] = useState<FundMovementListItem | null>(null);

  const refresh = () => router.refresh();

  const columns = useMemo(() => {
    const openDetail = (movement: FundMovementListItem, mode: FundMovementDetailMode) => {
      setSelected({ movement, mode });
      setDetailOpen(true);
    };
    return getColumns({
      onView: (m) => openDetail(m, 'view'),
      onEdit: (m) => openDetail(m, 'edit'),
      onConfirm: setConfirming,
      onDelete: setDeleting,
      permissions,
    });
  }, [permissions]);

  const modalProps = {
    banks,
    cashRegisters,
    partners,
    defaultContributionsAccount,
    defaultBankChargesAccount,
    onSuccess: refresh,
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
        mode="create"
        open={createOpen}
        onOpenChange={setCreateOpen}
        {...modalProps}
      />

      {/* Edición de borrador o vista de solo lectura (cualquier estado) */}
      <_CreateFundMovementModal
        mode={selected?.mode ?? 'view'}
        open={detailOpen}
        onOpenChange={setDetailOpen}
        movement={selected?.movement ?? null}
        {...modalProps}
      />

      <_FundMovementConfirmDialogs
        confirming={confirming}
        deleting={deleting}
        onCloseConfirm={() => setConfirming(null)}
        onCloseDelete={() => setDeleting(null)}
        onSuccess={refresh}
      />
    </>
  );
}
