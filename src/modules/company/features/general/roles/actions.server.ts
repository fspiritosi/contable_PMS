'use server';

import { revalidatePath } from 'next/cache';
import { getCurrentUserId } from '@/shared/lib/current-user';

import { prisma } from '@/shared/lib/prisma';
import { logger } from '@/shared/lib/logger';
import { getActiveCompanyId } from '@/shared/lib/company';
import { checkPermission, createAuditLog, AUDIT_ACTIONS, MODULES, ACTIONS } from '@/shared/lib/permissions';
import { HIDDEN_MODULES, PERMISSION_MODULE_MAP } from '@/shared/lib/modules/constants';
import type { DataTableSearchParams } from '@/shared/components/common/DataTable';
import {
  parseSearchParams,
  stateToPrismaParams,
} from '@/shared/components/common/DataTable/helpers';

// ============================================
// TIPOS
// ============================================

export interface CreateRoleInput {
  name: string;
  description?: string;
  color?: string;
  isDefault?: boolean;
  permissions: Array<{ module: string; actionId: string }>;
}

export interface UpdateRoleInput {
  name?: string;
  description?: string;
  color?: string;
  isDefault?: boolean;
  permissions?: Array<{ module: string; actionId: string }>;
}

// ============================================
// QUERIES
// ============================================

/**
 * Obtiene los roles con paginación
 */
export async function getRolesPaginated(searchParams: DataTableSearchParams) {
  await checkPermission('company.general.roles', 'view', { redirect: true });

  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    const state = parseSearchParams(searchParams);
    const { skip, take, orderBy } = stateToPrismaParams(state);

    const where = { companyId };

    const [roles, total] = await Promise.all([
      prisma.companyRole.findMany({
        where,
        skip,
        take,
        orderBy: orderBy || [{ isSystem: 'desc' }, { name: 'asc' }],
        select: {
          id: true,
          name: true,
          slug: true,
          description: true,
          color: true,
          isSystem: true,
          isDefault: true,
          createdAt: true,
          permissions: {
            select: {
              module: true,
              action: {
                select: { id: true, slug: true },
              },
            },
          },
          _count: {
            select: { members: true },
          },
        },
      }),
      prisma.companyRole.count({ where }),
    ]);

    return { data: roles, total };
  } catch (error) {
    logger.error('Error al obtener roles', { data: { error, companyId } });
    throw new Error('Error al obtener roles');
  }
}

/**
 * Obtiene un rol por ID con sus permisos
 */
export async function getRoleById(roleId: string) {
  await checkPermission('company.general.roles', 'view', { redirect: true });

  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    const role = await prisma.companyRole.findFirst({
      where: { id: roleId, companyId },
      select: {
        id: true,
        name: true,
        slug: true,
        description: true,
        color: true,
        isSystem: true,
        isDefault: true,
        permissions: {
          select: {
            module: true,
            action: {
              select: { id: true, slug: true, name: true },
            },
          },
        },
      },
    });

    if (!role) {
      throw new Error('Rol no encontrado');
    }

    return role;
  } catch (error) {
    logger.error('Error al obtener rol', { data: { error, roleId } });
    throw error;
  }
}

/**
 * Obtiene todas las acciones disponibles del sistema
 */
export async function getSystemActions() {
  await checkPermission('company.general.roles', 'view', { redirect: true });

  try {
    return await prisma.action.findMany({
      select: {
        id: true,
        name: true,
        slug: true,
        description: true,
      },
      orderBy: { slug: 'asc' },
    });
  } catch (error) {
    logger.error('Error al obtener acciones', { data: { error } });
    return [];
  }
}

/**
 * Obtiene la configuración de módulos y acciones para la matriz de permisos
 */
export async function getPermissionsConfig() {
  await checkPermission('company.general.roles', 'view', { redirect: true });

  const actions = await getSystemActions();

  // Estructura de módulos organizada en grupos
  const moduleGroups = [
    {
      name: 'General',
      modules: [
        { key: MODULES.dashboard, label: 'Dashboard' },
        { key: MODULES.employees, label: 'Empleados' },
        { key: MODULES.equipment, label: 'Equipos' },
        { key: MODULES.documents, label: 'Documentos' },
      ],
    },
    {
      name: 'Comercial',
      modules: [
        { key: MODULES['commercial.clients'], label: 'Clientes' },
        { key: MODULES['commercial.leads'], label: 'Leads' },
        { key: MODULES['commercial.contacts'], label: 'Contactos' },
        { key: MODULES['commercial.quotes'], label: 'Presupuestos' },
        { key: MODULES['commercial.suppliers'], label: 'Proveedores' },
        { key: MODULES['commercial.categories'], label: 'Categorías' },
        { key: MODULES['commercial.products'], label: 'Ítems' },
        { key: MODULES['commercial.price-lists'], label: 'Listas de Precios' },
        { key: MODULES['commercial.points-of-sale'], label: 'Puntos de Venta' },
        { key: MODULES['commercial.invoices'], label: 'Facturas de Venta' },
        { key: MODULES['commercial.purchases'], label: 'Facturas de Compra' },
        { key: MODULES['commercial.purchase-orders'], label: 'Órdenes de Compra' },
        { key: MODULES['commercial.receiving-notes'], label: 'Remitos de Recepción' },
        { key: MODULES['commercial.expenses'], label: 'Gastos' },
      ],
    },
    {
      name: 'Almacenes y Stock',
      modules: [
        { key: MODULES['commercial.warehouses'], label: 'Almacenes' },
        { key: MODULES['commercial.stock'], label: 'Control de Stock' },
        { key: MODULES['commercial.movements'], label: 'Movimientos' },
      ],
    },
    {
      name: 'Tesorería',
      modules: [
        { key: MODULES['commercial.treasury.cash-registers'], label: 'Cajas' },
        { key: MODULES['commercial.treasury.bank-accounts'], label: 'Bancos' },
        { key: MODULES['commercial.treasury.receipts'], label: 'Recibos de Cobro' },
        { key: MODULES['commercial.treasury.payment-orders'], label: 'Órdenes de Pago' },
        { key: MODULES['commercial.treasury.checks'], label: 'Cheques' },
        { key: MODULES['commercial.treasury.projections'], label: 'Proyecciones' },
        { key: MODULES['commercial.treasury.cashflow'], label: 'Flujo de Caja' },
      ],
    },
    {
      name: 'Contabilidad',
      modules: [
        { key: MODULES['accounting.accounts'], label: 'Plan de Cuentas' },
        { key: MODULES['accounting.entries'], label: 'Asientos' },
        { key: MODULES['accounting.recurring-entries'], label: 'Asientos Recurrentes' },
        { key: MODULES['accounting.opening-balances'], label: 'Saldos de Apertura' },
        { key: MODULES['accounting.budgets'], label: 'Presupuestos Contables' },
        { key: MODULES['accounting.reports'], label: 'Informes' },
        { key: MODULES['accounting.settings'], label: 'Configuración Contable' },
        { key: MODULES['accounting.fiscal-year-close'], label: 'Cierre de Ejercicio' },
      ],
    },
    {
      name: 'Configuración - General',
      modules: [
        { key: MODULES['company.general.users'], label: 'Usuarios' },
        { key: MODULES['company.general.roles'], label: 'Roles' },
        { key: MODULES['company.general.audit'], label: 'Auditoría' },
      ],
    },
    {
      name: 'Configuración - RRHH',
      modules: [
        { key: MODULES['company.cost-centers'], label: 'Centros de Costo' },
        { key: MODULES['company.contract-types'], label: 'Tipos Contrato' },
        { key: MODULES['company.job-positions'], label: 'Puestos' },
        { key: MODULES['company.job-categories'], label: 'Categorías' },
        { key: MODULES['company.unions'], label: 'Sindicatos' },
        { key: MODULES['company.collective-agreements'], label: 'Convenios' },
      ],
    },
    {
      name: 'Configuración - Equipos',
      modules: [
        { key: MODULES['company.equipment-owners'], label: 'Titulares' },
        { key: MODULES['company.sectors'], label: 'Sectores' },
        { key: MODULES['company.type-operatives'], label: 'Tipo Operativos' },
        { key: MODULES['company.contractors'], label: 'Contratistas' },
        { key: MODULES['company.vehicle-types'], label: 'Tipos Vehículo' },
        { key: MODULES['company.vehicle-brands'], label: 'Marcas Vehículo' },
      ],
    },
  ];

  // Ocultar los permisos de los módulos ocultos en este despliegue (TSK-403 / TSK-377:
  // Empleados, Equipos, Documentos) y de sus catálogos de configuración dependientes
  // (ej. company.cost-centers → employees, company.vehicle-types → equipment), usando
  // el mismo mapeo permiso→módulo del sistema. Se descartan los grupos que queden vacíos.
  const resolveParentModule = (key: string) =>
    PERMISSION_MODULE_MAP[key] ||
    Object.entries(PERMISSION_MODULE_MAP).find(([prefix]) => key.startsWith(`${prefix}.`))?.[1];

  const isHiddenModule = (key: string): boolean => {
    const parent = resolveParentModule(key);
    return parent ? HIDDEN_MODULES.includes(parent) : false;
  };

  const visibleModuleGroups = moduleGroups
    .map((group) => ({ ...group, modules: group.modules.filter((m) => !isHiddenModule(m.key)) }))
    .filter((group) => group.modules.length > 0);

  return {
    actions,
    moduleGroups: visibleModuleGroups,
    availableActions: Object.values(ACTIONS),
  };
}

// ============================================
// HELPERS
// ============================================

/**
 * Elimina pares (module, actionId) duplicados para respetar el unique
 * (role_id, module, action_id) de company_role_permissions.
 */
function dedupePermissions(
  permissions: Array<{ module: string; actionId: string }>
): Array<{ module: string; actionId: string }> {
  const seen = new Set<string>();
  return permissions.filter((p) => {
    const key = `${p.module}::${p.actionId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ============================================
// MUTATIONS
// ============================================

/**
 * Crea un nuevo rol
 */
export async function createRole(input: CreateRoleInput) {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('No autenticado');
  await checkPermission('company.general.roles', 'create', { redirect: true });

  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    // Generar slug a partir del nombre
    const slug = input.name
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');

    // Verificar que no exista otro rol con el mismo nombre o slug
    const existing = await prisma.companyRole.findFirst({
      where: {
        companyId,
        OR: [{ name: input.name }, { slug }],
      },
    });

    if (existing) {
      throw new Error('Ya existe un rol con ese nombre');
    }

    // Si este rol será el default, quitar el default de los demás
    if (input.isDefault) {
      await prisma.companyRole.updateMany({
        where: { companyId, isDefault: true },
        data: { isDefault: false },
      });
    }

    const role = await prisma.companyRole.create({
      data: {
        companyId,
        name: input.name,
        slug,
        description: input.description,
        color: input.color,
        isDefault: input.isDefault ?? false,
        isSystem: false,
        permissions: {
          create: dedupePermissions(input.permissions).map((p) => ({
            module: p.module,
            actionId: p.actionId,
          })),
        },
      },
    });

    await createAuditLog({
      action: AUDIT_ACTIONS.role_created,
      targetType: 'role',
      targetId: role.id,
      targetName: role.name,
      newValue: {
        name: input.name,
        permissions: input.permissions,
      },
    });

    logger.info('Rol creado', { data: { roleId: role.id, name: input.name } });
    revalidatePath('/dashboard/company/general/roles');

    return role;
  } catch (error) {
    logger.error('Error al crear rol', { data: { error, input } });
    throw error;
  }
}

/**
 * Actualiza un rol
 */
export async function updateRole(roleId: string, input: UpdateRoleInput) {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('No autenticado');
  await checkPermission('company.general.roles', 'update', { redirect: true });

  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    const existing = await prisma.companyRole.findFirst({
      where: { id: roleId, companyId },
      include: {
        permissions: {
          select: {
            module: true,
            action: { select: { slug: true } },
          },
        },
      },
    });

    if (!existing) {
      throw new Error('Rol no encontrado');
    }

    // No permitir editar roles de sistema (excepto permisos)
    if (existing.isSystem && (input.name || input.description !== undefined)) {
      throw new Error('No se puede modificar el nombre ni descripción de roles de sistema');
    }

    // Si este rol será el default, quitar el default de los demás
    if (input.isDefault && !existing.isDefault) {
      await prisma.companyRole.updateMany({
        where: { companyId, isDefault: true },
        data: { isDefault: false },
      });
    }

    // Usar transacción para actualizar rol y permisos
    const role = await prisma.$transaction(async (tx) => {
      // Si se actualizan permisos, eliminar los existentes
      if (input.permissions) {
        await tx.companyRolePermission.deleteMany({
          where: { roleId },
        });
      }

      return tx.companyRole.update({
        where: { id: roleId },
        data: {
          name: input.name,
          description: input.description,
          color: input.color,
          isDefault: input.isDefault,
          permissions: input.permissions
            ? {
                create: dedupePermissions(input.permissions).map((p) => ({
                  module: p.module,
                  actionId: p.actionId,
                })),
              }
            : undefined,
        },
      });
    });

    const oldPermissions = existing.permissions.map((p) => ({
      module: p.module,
      action: p.action.slug,
    }));

    await createAuditLog({
      action: AUDIT_ACTIONS.role_updated,
      targetType: 'role',
      targetId: roleId,
      targetName: role.name,
      oldValue: input.permissions ? { permissions: oldPermissions } : undefined,
      newValue: input.permissions ? { permissions: input.permissions } : undefined,
    });

    logger.info('Rol actualizado', { data: { roleId, name: role.name } });
    revalidatePath('/dashboard/company/general/roles');

    return role;
  } catch (error) {
    logger.error('Error al actualizar rol', { data: { error, roleId, input } });
    throw error;
  }
}

/**
 * Elimina un rol
 */
export async function deleteRole(roleId: string) {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('No autenticado');
  await checkPermission('company.general.roles', 'delete', { redirect: true });

  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    const existing = await prisma.companyRole.findFirst({
      where: { id: roleId, companyId },
      include: {
        _count: { select: { members: true } },
      },
    });

    if (!existing) {
      throw new Error('Rol no encontrado');
    }

    if (existing.isSystem) {
      throw new Error('No se pueden eliminar roles de sistema');
    }

    if (existing._count.members > 0) {
      throw new Error(
        `No se puede eliminar el rol porque tiene ${existing._count.members} usuario(s) asignado(s)`
      );
    }

    await prisma.companyRole.delete({
      where: { id: roleId },
    });

    await createAuditLog({
      action: AUDIT_ACTIONS.role_deleted,
      targetType: 'role',
      targetId: roleId,
      targetName: existing.name,
    });

    logger.info('Rol eliminado', { data: { roleId, name: existing.name } });
    revalidatePath('/dashboard/company/general/roles');

    return { success: true };
  } catch (error) {
    logger.error('Error al eliminar rol', { data: { error, roleId } });
    throw error;
  }
}

// ============================================
// TIPOS INFERIDOS
// ============================================

export type RoleListItem = Awaited<ReturnType<typeof getRolesPaginated>>['data'][number];
export type Role = Awaited<ReturnType<typeof getRoleById>>;
export type SystemAction = Awaited<ReturnType<typeof getSystemActions>>[number];
export type PermissionsConfig = Awaited<ReturnType<typeof getPermissionsConfig>>;
