'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/shared/components/ui/button';
import { DataTable, type DataTableSearchParams, type DataTableFacetedFilterConfig } from '@/shared/components/common/DataTable';
import {
  activateBankAccount,
  deactivateBankAccount,
  closeBankAccount,
} from '../../actions.server';
import type { BankAccountWithBalance } from '../../../../shared/types';
import {
  BANK_ACCOUNT_TYPE_LABELS,
  BANK_ACCOUNT_STATUS_LABELS,
} from '../../../../shared/validators';
import { getColumns } from '../columns';
import { _BankAccountFormModal } from './_BankAccountFormModal';
import { usePermissions } from '@/shared/hooks/usePermissions';

interface Props {
  data: BankAccountWithBalance[];
  totalRows: number;
  searchParams: DataTableSearchParams;
}

export function _BankAccountsTable({ data, totalRows, searchParams }: Props) {
  const router = useRouter();
  const [selectedAccount, setSelectedAccount] = useState<BankAccountWithBalance | null>(null);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const { hasPermission } = usePermissions();

  const handleEdit = (account: BankAccountWithBalance) => {
    setSelectedAccount(account);
    setIsEditModalOpen(true);
  };

  const handleToggleStatus = async (account: BankAccountWithBalance) => {
    try {
      setIsLoading(true);
      if (account.status === 'ACTIVE') {
        await deactivateBankAccount(account.id);
        toast.success('Cuenta desactivada correctamente');
      } else {
        await activateBankAccount(account.id);
        toast.success('Cuenta activada correctamente');
      }
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Error al cambiar estado');
    } finally {
      setIsLoading(false);
    }
  };

  const handleClose = async (account: BankAccountWithBalance) => {
    if (account.balance !== 0) {
      toast.error('La cuenta debe tener saldo $0.00 para poder cerrarse');
      return;
    }

    try {
      setIsLoading(true);
      await closeBankAccount(account.id);
      toast.success('Cuenta cerrada correctamente');
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Error al cerrar cuenta');
    } finally {
      setIsLoading(false);
    }
  };

  const canUpdate = hasPermission('commercial.treasury.bank-accounts', 'update');
  const canDelete = hasPermission('commercial.treasury.bank-accounts', 'delete');

  const facetedFilters: DataTableFacetedFilterConfig[] = useMemo(
    () => [
      {
        columnId: 'status',
        title: 'Estado',
        options: Object.entries(BANK_ACCOUNT_STATUS_LABELS).map(([value, label]) => ({
          label,
          value,
        })),
      },
      {
        columnId: 'accountType',
        title: 'Tipo de Cuenta',
        options: Object.entries(BANK_ACCOUNT_TYPE_LABELS).map(([value, label]) => ({
          label,
          value,
        })),
      },
      {
        columnId: 'currency',
        title: 'Moneda',
        options: [
          { label: 'Pesos (ARS)', value: 'ARS' },
          { label: 'Dólares (USD)', value: 'USD' },
          { label: 'Euros (EUR)', value: 'EUR' },
        ],
      },
    ],
    []
  );

  const columns = useMemo(
    () =>
      getColumns({
        onEdit: handleEdit,
        onToggleStatus: handleToggleStatus,
        onClose: handleClose,
        isLoading,
        canEdit: canUpdate,
        canToggleStatus: canUpdate,
        canClose: canDelete,
      }),
    [isLoading, canUpdate, canDelete]
  );

  return (
    <>
      <DataTable
        columns={columns}
        data={data}
        totalRows={totalRows}
        searchParams={searchParams}
        searchPlaceholder="Buscar cuentas bancarias..."
        facetedFilters={facetedFilters}
        tableId="commercial-bank-accounts"
        showFilterToggle
        initialColumnVisibility={{ accountType: false, currency: false }}
        toolbarActions={
          hasPermission('commercial.treasury.bank-accounts', 'create') && (
            <Button size="sm" onClick={() => setIsCreateModalOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Nueva Cuenta
            </Button>
          )
        }
      />

      {selectedAccount && (
        <_BankAccountFormModal
          open={isEditModalOpen}
          onOpenChange={setIsEditModalOpen}
          bankAccount={selectedAccount}
          onSuccess={() => {
            setIsEditModalOpen(false);
            router.refresh();
          }}
        />
      )}

      <_BankAccountFormModal
        open={isCreateModalOpen}
        onOpenChange={setIsCreateModalOpen}
        onSuccess={() => {
          setIsCreateModalOpen(false);
          router.refresh();
        }}
      />
    </>
  );
}
