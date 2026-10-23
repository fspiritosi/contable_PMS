'use client';

import { Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';

import { DataTable, type DataTableSearchParams } from '@/shared/components/common/DataTable';
import { Button } from '@/shared/components/ui/button';
import { useDocumentCorrection } from '@/modules/commercial/shared/hooks/useDocumentCorrection';
import type { ModulePermissions } from '@/shared/lib/permissions';

import type { FundMovementDetailMode } from '../../shared/view-mode';
import type {
  FundMovementAccountRef,
  FundMovementConceptCatalog,
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
  concepts: FundMovementConceptCatalog;
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
  concepts,
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
  const correction = useDocumentCorrection({ onApplied: refresh });

  const columns = useMemo(() => {
    const openDetail = (movement: FundMovementListItem, mode: FundMovementDetailMode) => {
      setSelected({ movement, mode });
      setDetailOpen(true);
    };
    return getColumns({
      onView: (m) => openDetail(m, 'view'),
      onEdit: (m) => openDetail(m, 'edit'),
      onConfirm: setConfirming,
      // Borrador: se elimina directo. Confirmado: eliminar y anular van por la corrección (TSK-792).
      onDelete: (m) =>
        m.status === 'DRAFT'
          ? setDeleting(m)
          : correction.open({ mode: 'DELETE', ref: { kind: 'FUND_MOVEMENT', id: m.id } }),
      onCancel: (m) => correction.open({ mode: 'CANCEL', ref: { kind: 'FUND_MOVEMENT', id: m.id } }),
      permissions,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [permissions]);

  const modalProps = {
    banks,
    cashRegisters,
    partners,
    defaultContributionsAccount,
    concepts,
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

      {correction.dialog}
    </>
  );
}
