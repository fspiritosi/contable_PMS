import { Button } from '@/shared/components/ui/button';
import { Plus } from 'lucide-react';
import Link from 'next/link';
import { getReceivingNotesPaginated, getReceivingNoteFacetCounts } from './actions.server';
import { _ReceivingNotesTable } from './components/_ReceivingNotesTable';
import type { DataTableSearchParams } from '@/shared/components/common/DataTable';
import { PermissionGuard } from '@/shared/components/common/PermissionGuard';

interface Props {
  searchParams: DataTableSearchParams;
}

export async function ReceivingNotesList({ searchParams }: Props) {
  const [initialData, facetCounts] = await Promise.all([
    getReceivingNotesPaginated(searchParams),
    getReceivingNoteFacetCounts(),
  ]);

  return (
    <PermissionGuard module="commercial.receiving-notes" action="view" redirect>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Remitos de Recepción</h1>
            <p className="text-muted-foreground">
              Gestiona la recepción de materiales y ítems
            </p>
          </div>
          <Button asChild>
            <Link href="/dashboard/commercial/receiving-notes/new">
              <Plus className="mr-2 h-4 w-4" />
              Nuevo Remito
            </Link>
          </Button>
        </div>

        <_ReceivingNotesTable data={initialData.data} totalRows={initialData.total} searchParams={searchParams} facetCounts={facetCounts} />
      </div>
    </PermissionGuard>
  );
}
