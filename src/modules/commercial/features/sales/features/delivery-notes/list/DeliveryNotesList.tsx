import { Button } from '@/shared/components/ui/button';
import { Plus } from 'lucide-react';
import Link from 'next/link';
import { getDeliveryNotesPaginated, getDeliveryNoteFacetCounts } from './actions.server';
import { _DeliveryNotesTable } from './components/_DeliveryNotesTable';
import type { DataTableSearchParams } from '@/shared/components/common/DataTable';
import { PermissionGuard } from '@/shared/components/common/PermissionGuard';

interface Props {
  searchParams: DataTableSearchParams;
}

export async function DeliveryNotesList({ searchParams }: Props) {
  const [initialData, facetCounts] = await Promise.all([
    getDeliveryNotesPaginated(searchParams),
    getDeliveryNoteFacetCounts(),
  ]);

  return (
    <PermissionGuard module="commercial.delivery-notes" action="view" redirect>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Remitos de Entrega</h1>
            <p className="text-muted-foreground">
              Gestiona la entrega de materiales y productos a clientes
            </p>
          </div>
          <PermissionGuard module="commercial.delivery-notes" action="create">
            <Button asChild>
              <Link href="/dashboard/commercial/delivery-notes/new">
                <Plus className="mr-2 h-4 w-4" />
                Nuevo Remito
              </Link>
            </Button>
          </PermissionGuard>
        </div>

        <_DeliveryNotesTable data={initialData.data} totalRows={initialData.total} searchParams={searchParams} facetCounts={facetCounts} />
      </div>
    </PermissionGuard>
  );
}
