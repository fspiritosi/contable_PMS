'use server';

import { getCurrentUserId } from '@/shared/lib/current-user';
import { logger } from '@/shared/lib/logger';
import { getCurrentUserPermissions } from '@/shared/lib/permissions';
import { prisma } from '@/shared/lib/prisma';
import {
  resolveAccessibleWorkspaces,
  WORKSPACES,
  type WorkspaceId,
} from '@/shared/lib/workspaces';

function isWorkspaceId(value: string | null | undefined): value is WorkspaceId {
  return !!value && value in WORKSPACES;
}

/**
 * Espacios de trabajo a los que el usuario tiene acceso.
 * Owners y roles de sistema ven ambos. Backward-compat: sin permisos workspace.* ⇒ ambos.
 */
export async function getAccessibleWorkspaces(): Promise<WorkspaceId[]> {
  const userPermissions = await getCurrentUserPermissions();
  if (!userPermissions) return ['gestion'];

  const isPrivileged =
    userPermissions.isOwner ||
    userPermissions.roleSlug === 'owner' ||
    userPermissions.roleSlug === 'developer';

  if (isPrivileged) {
    return resolveAccessibleWorkspaces({ gestion: true, contable: true });
  }

  return resolveAccessibleWorkspaces({
    gestion: userPermissions.permissions['workspace.gestion']?.view === true,
    contable: userPermissions.permissions['workspace.contable']?.view === true,
  });
}

/**
 * Espacio activo guardado. Si el guardado ya no es accesible, recae al primero
 * accesible y lo persiste de forma lazy (igual que getActiveCompanyId).
 */
export async function getActiveWorkspace(): Promise<WorkspaceId> {
  const [accessible, userId] = await Promise.all([getAccessibleWorkspaces(), getCurrentUserId()]);
  if (!userId) return accessible[0] ?? 'gestion';

  try {
    const prefs = await prisma.userPreference.findUnique({
      where: { userId },
      select: { activeWorkspaceId: true },
    });

    const saved = isWorkspaceId(prefs?.activeWorkspaceId) ? prefs.activeWorkspaceId : null;
    if (saved && accessible.includes(saved)) return saved;

    const fallback = accessible[0] ?? 'gestion';
    await prisma.userPreference.upsert({
      where: { userId },
      create: { userId, activeWorkspaceId: fallback },
      update: { activeWorkspaceId: fallback },
    });
    return fallback;
  } catch (error) {
    logger.error('Error al obtener espacio de trabajo activo', { data: { error, userId } });
    return accessible[0] ?? 'gestion';
  }
}

/**
 * Cambia el espacio activo del usuario. Valida que tenga acceso al espacio destino.
 */
export async function setActiveWorkspace(workspaceId: WorkspaceId): Promise<{ success: true }> {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('No autenticado');

  const accessible = await getAccessibleWorkspaces();
  if (!accessible.includes(workspaceId)) {
    throw new Error('No tienes acceso a este espacio de trabajo');
  }

  try {
    await prisma.userPreference.upsert({
      where: { userId },
      create: { userId, activeWorkspaceId: workspaceId },
      update: { activeWorkspaceId: workspaceId },
    });
    logger.info('Espacio de trabajo cambiado', {
      data: { workspaceId, landing: WORKSPACES[workspaceId].landing, userId },
    });
    return { success: true as const };
  } catch (error) {
    logger.error('Error al cambiar espacio de trabajo', { data: { error, workspaceId, userId } });
    throw error;
  }
}
