'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';

import { Button } from '@/shared/components/ui/button';
import { DataTable, type DataTableSearchParams } from '@/shared/components/common/DataTable';
import type { ModulePermissions } from '@/shared/lib/permissions';

import { getColumns } from '../columns';
import { _CreateFundMovementModal } from './_CreateFundMovementModal';
import type {
  FundMovementListItem,
  FundMovementAccountOption,
  FundMovementPartnerOption,
} from '../actions.server';

interface Props {
  data: FundMovementListItem[];
  totalRows: number;
  searchParams: DataTableSearchParams;
  permissions: ModulePermissions;
  accounts: FundMovementAccountOption[];
  partners: FundMovementPartnerOption[];
  hasContributionsAccount: boolean;
}

export function _FundMovementsTable({
  data,
  totalRows,
  searchParams,
  permissions,
  accounts,
  partners,
  hasContributionsAccount,
}: Props) {
  const router = useRouter();
  const [createOpen, setCreateOpen] = useState(false);

  const columns = useMemo(() => getColumns(), []);

  const handleSuccess = () => router.refresh();

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

      <_CreateFundMovementModal
        open={createOpen}
        onOpenChange={setCreateOpen}
        accounts={accounts}
        partners={partners}
        hasContributionsAccount={hasContributionsAccount}
        onSuccess={handleSuccess}
      />
    </>
  );
}
