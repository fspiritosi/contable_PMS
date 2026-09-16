'use client';

import { Avatar, AvatarFallback, AvatarImage } from '@/shared/components/ui/avatar';
import { cn } from '@/shared/lib/utils';

import { getMemberFullName, getMemberInitials } from './member-display';

const AVATAR_SIZE_CLASSES = {
  sm: 'h-8 w-8',
  md: 'h-10 w-10',
} as const;

interface MemberIdentityProps {
  firstName: string | null;
  lastName: string | null;
  email: string;
  imageUrl: string | null;
  size?: keyof typeof AVATAR_SIZE_CLASSES;
  className?: string;
}

/**
 * Bloque "avatar + nombre + email" de un miembro de la empresa (TSK-692).
 * Compartido por la tabla de Usuarios, el modal "Cambiar rol" y el Popover
 * de usuarios por rol.
 */
export function _MemberIdentity({
  firstName,
  lastName,
  email,
  imageUrl,
  size = 'sm',
  className,
}: MemberIdentityProps) {
  const fullName = getMemberFullName({ firstName, lastName });
  const initials = getMemberInitials({ firstName, lastName });

  return (
    <div className={cn('flex items-center gap-3', className)}>
      <Avatar className={AVATAR_SIZE_CLASSES[size]}>
        <AvatarImage src={imageUrl ?? undefined} alt={fullName} />
        <AvatarFallback>{initials}</AvatarFallback>
      </Avatar>
      <div className="flex flex-col">
        <span className="font-medium" title={fullName}>
          {fullName}
        </span>
        <span className="text-sm text-muted-foreground" title={email}>
          {email}
        </span>
      </div>
    </div>
  );
}
