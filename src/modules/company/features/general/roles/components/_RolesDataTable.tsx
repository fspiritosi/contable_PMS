'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';
import Link from 'next/link';

import { Button } from '@/shared/components/ui/button';
import {
  DataTable,
  type DataTableSearchParams,
} from '@/shared/components/common/DataTable';
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
import {
  deleteRole,
  type RoleListItem,
} from '../actions.server';

interface Props {
  data: RoleListItem[];
  totalRows: number;
  searchParams: DataTableSearchParams;
  permissions: ModulePermissions;
}

export function _RolesDataTable({
  data,
  totalRows,
  searchParams,
  permissions,
}: Props) {
  const router = useRouter();
  const [deletingRole, setDeletingRole] = useState<RoleListItem | null>(null);

  const handleEdit = (roleId: string) => {
    router.push(`/dashboard/company/general/roles/${roleId}/edit`);
  };

  const handleDelete = async () => {
    if (!deletingRole) return;
    try {
      await deleteRole(deletingRole.id);
      toast.success('Rol eliminado');
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Error al eliminar rol');
    } finally {
      setDeletingRole(null);
    }
  };

  const columns = useMemo(
    () =>
      getColumns({
        onEdit: handleEdit,
        onDelete: setDeletingRole,
        permissions,
      }),
    [permissions]
  );

  return (
    <>
      <DataTable
        columns={columns}
        data={data}
        totalRows={totalRows}
        searchParams={searchParams}
        searchPlaceholder="Buscar roles..."
        tableId="company-roles"
        toolbarActions={
          permissions.canCreate ? (
            <Button asChild data-testid="new-role-button">
              <Link href="/dashboard/company/general/roles/new">
                <Plus className="h-4 w-4 mr-2" />
                Nuevo Rol
              </Link>
            </Button>
          ) : null
        }
      />

      <AlertDialog
        open={!!deletingRole}
        onOpenChange={(open) => !open && setDeletingRole(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar este rol?</AlertDialogTitle>
            <AlertDialogDescription>
              El rol &quot;{deletingRole?.name}&quot; será eliminado permanentemente.
              Esta acción no se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
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
