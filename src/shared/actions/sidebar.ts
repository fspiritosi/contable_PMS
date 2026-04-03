'use server';

import { getIndustryType, isModuleAvailableForIndustry } from '@/shared/lib/industry';
import { getCurrentUserPermissions, MODULES } from '@/shared/lib/permissions';

/**
 * Mapa de permisos del sidebar
 * Key: módulo, Value: tiene permiso view
 */
export type SidebarPermissions = Record<string, boolean>;

/**
 * Obtiene los permisos de vista para todos los módulos del sidebar.
 *
 * - Owners y roles de sistema (owner, developer) tienen todos los permisos
 * - Usuarios normales solo ven items donde tienen permiso 'view'
 * - Módulos restringidos por industria se filtran para todas las categorías de usuario
 */
export async function getSidebarPermissions(
  industry?: string | null,
): Promise<SidebarPermissions> {
  const userPermissions = await getCurrentUserPermissions();

  // Si no hay usuario o no es miembro activo, sin acceso
  if (!userPermissions) {
    return {};
  }

  const permissions: SidebarPermissions = {};

  // Owners y roles de sistema tienen TODOS los permisos
  if (
    userPermissions.isOwner ||
    userPermissions.roleSlug === 'owner' ||
    userPermissions.roleSlug === 'developer'
  ) {
    for (const mod of Object.values(MODULES)) {
      permissions[mod] = true;
    }
  } else {
    // Construir mapa de permisos (solo acción 'view')
    for (const mod of Object.values(MODULES)) {
      permissions[mod] = userPermissions.permissions[mod]?.view === true;
    }
  }

  // Aplicar filtro de industria (Nivel 1)
  // Se aplica DESPUÉS de permisos, tanto para owners como usuarios normales
  const industryType = getIndustryType(industry);
  for (const mod of Object.keys(permissions)) {
    if (!isModuleAvailableForIndustry(mod, industryType)) {
      permissions[mod] = false;
    }
  }

  return permissions;
}
