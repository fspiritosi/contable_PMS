'use client';

import { useMemo } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import moment from 'moment';
import {
  UserPlus,
  UserMinus,
  Shield,
  ShieldCheck,
  ShieldX,
  Mail,
  MailX,
  MailCheck,
  Edit,
  Trash2,
} from 'lucide-react';

import { Badge } from '@/shared/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/shared/components/ui/avatar';
import {
  DataTable,
  DataTableColumnHeader,
  type DataTableSearchParams,
} from '@/shared/components/common/DataTable';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/shared/components/ui/tooltip';
import { AUDIT_ACTIONS } from '@/shared/lib/permissions';

import type { AuditLogListItem } from '../actions.server';

interface Props {
  data: AuditLogListItem[];
  totalRows: number;
  searchParams: DataTableSearchParams;
}

const actionIcons: Record<string, React.ReactNode> = {
  [AUDIT_ACTIONS.role_created]: <Shield className="h-4 w-4 text-green-500" />,
  [AUDIT_ACTIONS.role_updated]: <Edit className="h-4 w-4 text-blue-500" />,
  [AUDIT_ACTIONS.role_deleted]: <Trash2 className="h-4 w-4 text-red-500" />,
  [AUDIT_ACTIONS.role_permission_granted]: <ShieldCheck className="h-4 w-4 text-green-500" />,
  [AUDIT_ACTIONS.role_permission_revoked]: <ShieldX className="h-4 w-4 text-red-500" />,
  [AUDIT_ACTIONS.member_invited]: <UserPlus className="h-4 w-4 text-blue-500" />,
  [AUDIT_ACTIONS.member_role_changed]: <Edit className="h-4 w-4 text-blue-500" />,
  [AUDIT_ACTIONS.member_deactivated]: <UserMinus className="h-4 w-4 text-red-500" />,
  [AUDIT_ACTIONS.member_reactivated]: <UserPlus className="h-4 w-4 text-green-500" />,
  [AUDIT_ACTIONS.member_permission_granted]: <ShieldCheck className="h-4 w-4 text-green-500" />,
  [AUDIT_ACTIONS.member_permission_revoked]: <ShieldX className="h-4 w-4 text-red-500" />,
  [AUDIT_ACTIONS.invitation_accepted]: <MailCheck className="h-4 w-4 text-green-500" />,
  [AUDIT_ACTIONS.invitation_expired]: <MailX className="h-4 w-4 text-orange-500" />,
  [AUDIT_ACTIONS.invitation_cancelled]: <MailX className="h-4 w-4 text-red-500" />,
};

const actionLabels: Record<string, string> = {
  [AUDIT_ACTIONS.role_created]: 'Rol creado',
  [AUDIT_ACTIONS.role_updated]: 'Rol actualizado',
  [AUDIT_ACTIONS.role_deleted]: 'Rol eliminado',
  [AUDIT_ACTIONS.role_permission_granted]: 'Permiso de rol otorgado',
  [AUDIT_ACTIONS.role_permission_revoked]: 'Permiso de rol revocado',
  [AUDIT_ACTIONS.member_invited]: 'Miembro invitado',
  [AUDIT_ACTIONS.member_role_changed]: 'Rol cambiado',
  [AUDIT_ACTIONS.member_deactivated]: 'Miembro desactivado',
  [AUDIT_ACTIONS.member_reactivated]: 'Miembro reactivado',
  [AUDIT_ACTIONS.member_permission_granted]: 'Permiso individual otorgado',
  [AUDIT_ACTIONS.member_permission_revoked]: 'Permiso individual revocado',
  [AUDIT_ACTIONS.invitation_accepted]: 'Invitación aceptada',
  [AUDIT_ACTIONS.invitation_expired]: 'Invitación expirada',
  [AUDIT_ACTIONS.invitation_cancelled]: 'Invitación cancelada',
};

export function _AuditLogTable({ data, totalRows, searchParams }: Props) {
  const columns = useMemo<ColumnDef<AuditLogListItem>[]>(
    () => [
      {
        accessorKey: 'createdAt',
        meta: { title: 'Fecha' },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Fecha" />,
        cell: ({ row }) => {
          const date = row.original.createdAt;
          return (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger className="cursor-default">
                  <span className="text-sm">{moment(date).fromNow()}</span>
                </TooltipTrigger>
                <TooltipContent>
                  {moment(date).format('DD/MM/YYYY HH:mm:ss')}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          );
        },
      },
      {
        accessorKey: 'performedBy',
        meta: { title: 'Usuario' },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Usuario" />,
        cell: ({ row }) => {
          const user = row.original.performedByUser;
          const fullName = `${user.firstName} ${user.lastName}`.trim() || 'Usuario';
          const initials = `${user.firstName?.[0] ?? ''}${user.lastName?.[0] ?? ''}`.toUpperCase() || '?';

          return (
            <div className="flex items-center gap-2">
              <Avatar className="h-7 w-7">
                <AvatarImage src={user.imageUrl ?? undefined} alt={fullName} />
                <AvatarFallback className="text-xs">{initials}</AvatarFallback>
              </Avatar>
              <span className="text-sm font-medium">{fullName}</span>
            </div>
          );
        },
        enableSorting: false,
      },
      {
        accessorKey: 'action',
        meta: { title: 'Acción' },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Acción" />,
        cell: ({ row }) => {
          const action = row.original.action;
          const icon = actionIcons[action] ?? <Edit className="h-4 w-4" />;
          const label = actionLabels[action] ?? action;

          return (
            <div className="flex items-center gap-2">
              {icon}
              <span className="text-sm">{label}</span>
            </div>
          );
        },
        enableSorting: false,
      },
      {
        accessorKey: 'targetType',
        meta: { title: 'Tipo' },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Tipo" />,
        cell: ({ row }) => {
          const type = row.original.targetType;
          const typeLabels: Record<string, { label: string; variant: 'default' | 'secondary' | 'outline' }> = {
            role: { label: 'Rol', variant: 'default' },
            member: { label: 'Miembro', variant: 'secondary' },
            invitation: { label: 'Invitación', variant: 'outline' },
          };
          const config = typeLabels[type] ?? { label: type, variant: 'outline' };

          return <Badge variant={config.variant}>{config.label}</Badge>;
        },
        enableSorting: false,
      },
      {
        accessorKey: 'targetName',
        meta: { title: 'Objetivo' },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Objetivo" />,
        cell: ({ row }) => {
          return (
            <span className="text-sm">
              {row.original.targetName || row.original.targetId.slice(0, 8)}
            </span>
          );
        },
        enableSorting: false,
      },
      {
        accessorKey: 'details',
        meta: { title: 'Detalles' },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Detalles" />,
        cell: ({ row }) => {
          const { oldValue, newValue, details } = row.original;

          // Mostrar cambio de rol
          if (oldValue && newValue && 'roleName' in (oldValue as object) && 'roleName' in (newValue as object)) {
            const old = oldValue as { roleName: string };
            const updated = newValue as { roleName: string };
            return (
              <span className="text-sm text-muted-foreground">
                {old.roleName} → {updated.roleName}
              </span>
            );
          }

          // Mostrar detalles genéricos
          if (details && typeof details === 'object' && 'roleName' in details) {
            return (
              <span className="text-sm text-muted-foreground">
                Rol: {(details as { roleName: string }).roleName}
              </span>
            );
          }

          // Mostrar cantidad de permisos si hay cambios
          if (newValue && typeof newValue === 'object' && 'permissions' in newValue) {
            const perms = (newValue as { permissions: unknown[] }).permissions;
            return (
              <span className="text-sm text-muted-foreground">
                {perms.length} permisos
              </span>
            );
          }

          return <span className="text-sm text-muted-foreground">-</span>;
        },
        enableSorting: false,
      },
    ],
    []
  );

  return (
    <DataTable
      columns={columns}
      data={data}
      totalRows={totalRows}
      searchParams={searchParams}
      searchPlaceholder="Buscar en auditoría..."
      tableId="company-audit-log"
    />
  );
}
