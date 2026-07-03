import type { Prisma } from '@/generated/prisma/client';
import { ACTIONS, SYSTEM_ROLES, MODULE_GROUPS, type Module } from './constants';

/**
 * Inicialización idempotente del sistema RBAC de una empresa (Ticket #402).
 *
 * Reutiliza las constantes del sistema (ACTIONS, SYSTEM_ROLES, MODULE_GROUPS) como
 * única fuente de verdad, alineado con `prisma/seed.ts` (sección 6.5). Al crear una
 * empresa deja disponibles:
 *  - las 5 acciones globales (view, create, update, delete, approve),
 *  - los 3 roles de sistema (Propietario, Desarrollador, Administrador) con sus permisos,
 *  - y devuelve los ids de rol para asignar el `owner` al miembro.
 *
 * Es idempotente: usa upsert para acciones/roles y `createMany({ skipDuplicates })`
 * para permisos, respetando el unique `(role_id, module, action_id)`.
 */

/** Nombres visibles de cada acción del sistema. */
const ACTION_LABELS: Record<string, { name: string; description: string }> = {
  view: { name: 'Ver', description: 'Permite ver/listar recursos' },
  create: { name: 'Crear', description: 'Permite crear nuevos recursos' },
  update: { name: 'Editar', description: 'Permite modificar recursos existentes' },
  delete: { name: 'Eliminar', description: 'Permite eliminar recursos' },
  approve: { name: 'Aprobar', description: 'Permite aprobar recursos' },
};

/** Módulos de "Espacios de Trabajo": solo se otorga la acción `view`. */
const WORKSPACE_MODULES: Module[] = [...MODULE_GROUPS.espaciosDeTrabajo.modules];

/** Restricciones del rol Administrador: no puede eliminar en estos módulos. */
const ADMIN_DELETE_RESTRICTED: Module[] = ['company.general.roles', 'company.general.audit'];

/** Todos los módulos con matriz completa (todos los grupos menos Espacios de Trabajo). */
function getFullMatrixModules(): Module[] {
  const workspace = new Set<string>(WORKSPACE_MODULES);
  const modules = new Set<Module>();
  for (const group of Object.values(MODULE_GROUPS)) {
    for (const moduleName of group.modules) {
      if (!workspace.has(moduleName)) modules.add(moduleName);
    }
  }
  return [...modules];
}

export interface CompanyRbacResult {
  roleIds: Record<'owner' | 'developer' | 'admin', string>;
}

export async function initializeCompanyRbac(
  tx: Prisma.TransactionClient,
  companyId: string
): Promise<CompanyRbacResult> {
  // 1. Asegurar las acciones globales (idempotente por slug único).
  const actionIdBySlug = new Map<string, string>();
  for (const slug of Object.values(ACTIONS)) {
    const labels = ACTION_LABELS[slug];
    const action = await tx.action.upsert({
      where: { slug },
      update: { name: labels.name, description: labels.description },
      create: { slug, name: labels.name, description: labels.description },
    });
    actionIdBySlug.set(slug, action.id);
  }

  // 2. Crear los roles de sistema de la empresa (idempotente por (companyId, slug)).
  const roleIdBySlug = new Map<string, string>();
  for (const role of Object.values(SYSTEM_ROLES)) {
    const created = await tx.companyRole.upsert({
      where: { companyId_slug: { companyId, slug: role.slug } },
      update: { name: role.name, description: role.description, color: role.color },
      create: {
        companyId,
        slug: role.slug,
        name: role.name,
        description: role.description,
        color: role.color,
        isSystem: true,
        isDefault: role.isDefault,
      },
    });
    roleIdBySlug.set(role.slug, created.id);
  }

  const ownerId = roleIdBySlug.get('owner')!;
  const developerId = roleIdBySlug.get('developer')!;
  const adminId = roleIdBySlug.get('admin')!;

  // 3. Construir la matriz de permisos.
  const fullModules = getFullMatrixModules();
  const allActionSlugs = Object.values(ACTIONS);
  const viewActionId = actionIdBySlug.get(ACTIONS.view)!;

  const permissions: { roleId: string; module: string; actionId: string }[] = [];

  // Owner y Developer: acceso total.
  for (const roleId of [ownerId, developerId]) {
    for (const moduleName of fullModules) {
      for (const actionSlug of allActionSlugs) {
        permissions.push({ roleId, module: moduleName, actionId: actionIdBySlug.get(actionSlug)! });
      }
    }
  }

  // Admin: todo excepto `delete` en roles y auditoría.
  for (const moduleName of fullModules) {
    for (const actionSlug of allActionSlugs) {
      if (actionSlug === ACTIONS.delete && ADMIN_DELETE_RESTRICTED.includes(moduleName)) continue;
      permissions.push({ roleId: adminId, module: moduleName, actionId: actionIdBySlug.get(actionSlug)! });
    }
  }

  // Espacios de Trabajo: solo `view` para los 3 roles.
  for (const roleId of [ownerId, developerId, adminId]) {
    for (const moduleName of WORKSPACE_MODULES) {
      permissions.push({ roleId, module: moduleName, actionId: viewActionId });
    }
  }

  await tx.companyRolePermission.createMany({ data: permissions, skipDuplicates: true });

  return {
    roleIds: { owner: ownerId, developer: developerId, admin: adminId },
  };
}
