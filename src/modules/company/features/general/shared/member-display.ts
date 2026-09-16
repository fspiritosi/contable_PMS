/**
 * Helpers puros de identidad de un miembro de la empresa (TSK-692).
 *
 * Centralizan el nombre completo y las iniciales que antes estaban duplicados
 * inline en la tabla de Usuarios y en el modal "Cambiar rol". Sin imports de
 * React ni de Prisma: corren en Vitest con `environment: 'node'`.
 */

export interface MemberDisplayName {
  firstName?: string | null;
  lastName?: string | null;
}

export const MEMBER_NO_NAME_LABEL = 'Sin nombre';
export const MEMBER_NO_INITIALS_LABEL = '?';

/** Nombre completo con `trim()`; si no hay nombre ni apellido, "Sin nombre". */
export function getMemberFullName({ firstName, lastName }: MemberDisplayName): string {
  return `${firstName ?? ''} ${lastName ?? ''}`.trim() || MEMBER_NO_NAME_LABEL;
}

/** Iniciales en mayúsculas (primera letra de nombre y apellido); si no hay, "?". */
export function getMemberInitials({ firstName, lastName }: MemberDisplayName): string {
  return `${firstName?.[0] ?? ''}${lastName?.[0] ?? ''}`.toUpperCase() || MEMBER_NO_INITIALS_LABEL;
}
