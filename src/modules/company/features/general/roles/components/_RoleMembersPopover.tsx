'use client';

import Link from 'next/link';
import { ArrowRight, Shield, Users } from 'lucide-react';

import { Badge } from '@/shared/components/ui/badge';
import { Button } from '@/shared/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/shared/components/ui/popover';

import { _MemberIdentity } from '../../shared/_MemberIdentity';
import type { RoleListItem } from '../actions.server';

const USERS_PAGE_HREF = '/dashboard/company/general/users';

interface RoleMembersPopoverProps {
  role: RoleListItem;
  canViewUsers: boolean;
}

function formatActiveCount(count: number): string {
  return count === 1 ? '1 usuario activo' : `${count} usuarios activos`;
}

function formatInactiveCount(count: number): string {
  return count === 1
    ? '+1 inactivo conserva este rol'
    : `+${count} inactivos conservan este rol`;
}

/**
 * Contador de la columna Usuarios de la tabla de Roles (TSK-692).
 * Al hacer clic abre un Popover con los miembros activos del rol, el aviso de
 * inactivos y, si el usuario puede ver la pantalla de Usuarios, un link para
 * gestionarlos allí. Todos los datos vienen en `role`: no hay fetch.
 */
export function _RoleMembersPopover({ role, canViewUsers }: RoleMembersPopoverProps) {
  const totalMembers = role._count.members;
  const activeMembers = role.members;
  const hasAnyMember = totalMembers > 0;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          disabled={!hasAnyMember}
          aria-label={`Ver usuarios del rol ${role.name}`}
          data-testid={`role-members-${role.id}`}
          className="h-8 gap-1 px-2 font-normal text-muted-foreground"
        >
          <Users className="h-4 w-4" />
          <span>{totalMembers}</span>
        </Button>
      </PopoverTrigger>

      <PopoverContent align="start" collisionPadding={16} className="w-72 p-0">
        <div className="border-b px-3 py-2">
          <p className="text-sm font-medium">Usuarios con el rol {role.name}</p>
          <p className="text-xs text-muted-foreground">{formatActiveCount(activeMembers.length)}</p>
        </div>

        {activeMembers.length > 0 ? (
          <ul className="max-h-64 overflow-y-auto py-1">
            {activeMembers.map((member) => (
              <li
                key={member.id}
                className="flex items-center justify-between gap-2 px-3 py-2"
                data-testid={`role-member-${member.id}`}
              >
                <_MemberIdentity
                  firstName={member.firstName}
                  lastName={member.lastName}
                  email={member.email}
                  imageUrl={member.imageUrl}
                  size="sm"
                  className="min-w-0 flex-1 [&>div]:min-w-0 [&>div>span]:truncate"
                />
                {member.isOwner && (
                  <Badge variant="default" className="shrink-0 bg-amber-500 hover:bg-amber-500">
                    <Shield className="mr-1 h-3 w-3" />
                    Propietario
                  </Badge>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-3 py-4 text-center text-sm text-muted-foreground">
            Ningún usuario activo tiene este rol
          </p>
        )}

        {role.inactiveMembersCount > 0 && (
          <p className="border-t px-3 py-2 text-xs text-muted-foreground">
            {formatInactiveCount(role.inactiveMembersCount)}
          </p>
        )}

        {canViewUsers && (
          <div className="border-t px-1 py-1">
            <Button asChild variant="link" size="sm" className="h-8 px-2">
              <Link href={USERS_PAGE_HREF} data-testid={`role-members-manage-${role.id}`}>
                Gestionar en Usuarios
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
