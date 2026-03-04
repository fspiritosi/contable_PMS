'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Mail, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import moment from 'moment';

import { Button } from '@/shared/components/ui/button';
import { Badge } from '@/shared/components/ui/badge';
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
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/shared/components/ui/card';
import type { ModulePermissions } from '@/shared/lib/permissions';

import { getColumns } from '../columns';
import { _InviteUserModal } from './_InviteUserModal';
import { _EditUserRoleModal } from './_EditUserRoleModal';
import {
  deactivateMember,
  cancelInvitation,
  type CompanyMemberListItem,
  type PendingInvitation,
  type AvailableRole,
  type AvailableEmployee,
} from '../actions.server';

interface Props {
  data: CompanyMemberListItem[];
  totalRows: number;
  searchParams: DataTableSearchParams;
  pendingInvitations: PendingInvitation[];
  availableRoles: AvailableRole[];
  availableEmployees: AvailableEmployee[];
  currentUserId: string;
  permissions: ModulePermissions;
}

export function _UsersDataTable({
  data,
  totalRows,
  searchParams,
  pendingInvitations,
  availableRoles,
  availableEmployees,
  currentUserId,
  permissions,
}: Props) {
  const router = useRouter();
  const [isInviteOpen, setIsInviteOpen] = useState(false);
  const [editingMember, setEditingMember] = useState<CompanyMemberListItem | null>(null);
  const [deactivatingMember, setDeactivatingMember] = useState<CompanyMemberListItem | null>(null);
  const [cancellingInvitation, setCancellingInvitation] = useState<PendingInvitation | null>(null);

  const handleRefresh = () => {
    router.refresh();
  };

  const handleDeactivate = async () => {
    if (!deactivatingMember) return;
    try {
      await deactivateMember(deactivatingMember.id);
      toast.success('Usuario desactivado');
      handleRefresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Error al desactivar usuario');
    } finally {
      setDeactivatingMember(null);
    }
  };

  const handleCancelInvitation = async () => {
    if (!cancellingInvitation) return;
    try {
      await cancelInvitation(cancellingInvitation.id);
      toast.success('Invitación cancelada');
      handleRefresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Error al cancelar invitación');
    } finally {
      setCancellingInvitation(null);
    }
  };

  const columns = useMemo(
    () =>
      getColumns({
        onEditRole: setEditingMember,
        onDeactivate: setDeactivatingMember,
        currentUserId,
        permissions,
      }),
    [currentUserId, permissions]
  );

  return (
    <>
      {/* Invitaciones pendientes */}
      {pendingInvitations.length > 0 && (
        <Card className="mb-6">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Mail className="h-4 w-4" />
              Invitaciones Pendientes
            </CardTitle>
            <CardDescription>
              Usuarios que han sido invitados pero aún no han aceptado
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {pendingInvitations.map((invitation) => (
                <div
                  key={invitation.id}
                  className="flex items-center justify-between p-3 border rounded-lg"
                >
                  <div className="flex items-center gap-3">
                    <div>
                      <p className="font-medium">{invitation.email}</p>
                      <p className="text-sm text-muted-foreground">
                        Rol: {invitation.role?.name ?? 'Sin rol'}
                        {invitation.employee && (
                          <>
                            {' '}
                            • Empleado: {invitation.employee.firstName}{' '}
                            {invitation.employee.lastName} (Leg.{' '}
                            {invitation.employee.employeeNumber})
                          </>
                        )}
                        {' '}• Expira: {moment(invitation.expiresAt).format('DD/MM/YYYY')}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">Pendiente</Badge>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setCancellingInvitation(invitation)}
                    >
                      <XCircle className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <DataTable
        columns={columns}
        data={data}
        totalRows={totalRows}
        searchParams={searchParams}
        searchPlaceholder="Buscar usuarios..."
        tableId="company-users"
        toolbarActions={
          permissions.canCreate ? (
            <Button onClick={() => setIsInviteOpen(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Invitar Usuario
            </Button>
          ) : null
        }
      />

      {/* Modal de invitación */}
      <_InviteUserModal
        open={isInviteOpen}
        onOpenChange={setIsInviteOpen}
        availableRoles={availableRoles}
        availableEmployees={availableEmployees}
        onSuccess={handleRefresh}
      />

      {/* Modal de editar rol */}
      <_EditUserRoleModal
        open={!!editingMember}
        onOpenChange={(open) => !open && setEditingMember(null)}
        member={editingMember}
        availableRoles={availableRoles}
        onSuccess={handleRefresh}
      />

      {/* Diálogo de confirmación para desactivar */}
      <AlertDialog
        open={!!deactivatingMember}
        onOpenChange={(open) => !open && setDeactivatingMember(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Desactivar este usuario?</AlertDialogTitle>
            <AlertDialogDescription>
              El usuario &quot;{deactivatingMember?.firstName} {deactivatingMember?.lastName}&quot;
              será desactivado y ya no podrá acceder a la empresa.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeactivate}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Desactivar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Diálogo de confirmación para cancelar invitación */}
      <AlertDialog
        open={!!cancellingInvitation}
        onOpenChange={(open) => !open && setCancellingInvitation(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Cancelar esta invitación?</AlertDialogTitle>
            <AlertDialogDescription>
              La invitación para &quot;{cancellingInvitation?.email}&quot; será cancelada.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Volver</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleCancelInvitation}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Cancelar Invitación
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
