'use server';

import { revalidatePath } from 'next/cache';

import { getCurrentUserId } from '@/shared/lib/current-user';
import { prisma } from '@/shared/lib/prisma';
import { logger } from '@/shared/lib/logger';
import { getActiveCompanyId } from '@/shared/lib/company';
import { checkPermission, createAuditLog, AUDIT_ACTIONS } from '@/shared/lib/permissions';
import { sendInvitationEmail } from '@/shared/actions/email';
import type { DataTableSearchParams } from '@/shared/components/common/DataTable';
import {
  parseSearchParams,
  stateToPrismaParams,
} from '@/shared/components/common/DataTable/helpers';

// ============================================
// TIPOS
// ============================================

export interface InviteUserInput {
  email: string;
  roleId: string;
  employeeId?: string;
}

export interface UpdateMemberRoleInput {
  memberId: string;
  roleId: string;
}

// ============================================
// QUERIES
// ============================================

/**
 * Obtiene los miembros de la empresa con paginación
 */
export async function getCompanyMembersPaginated(searchParams: DataTableSearchParams) {
  await checkPermission('company.general.users', 'view', { redirect: true });

  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    const state = parseSearchParams(searchParams);
    const { skip, take, orderBy } = stateToPrismaParams(state);

    const where = {
      companyId,
      isActive: true,
    };

    const [members, total] = await Promise.all([
      prisma.companyMember.findMany({
        where,
        skip,
        take,
        orderBy: orderBy || { createdAt: 'desc' },
        select: {
          id: true,
          userId: true,
          isOwner: true,
          isActive: true,
          createdAt: true,
          role: {
            select: {
              id: true,
              name: true,
              slug: true,
              color: true,
              isSystem: true,
            },
          },
          employee: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              employeeNumber: true,
            },
          },
        },
      }),
      prisma.companyMember.count({ where }),
    ]);

    // Enriquecer con datos de usuarios (batch)
    const userIds = members.map((m) => m.userId);
    const users = await prisma.user.findMany({
      where: { id: { in: userIds } },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        imageUrl: true,
      },
    });
    const userMap = new Map(users.map((u) => [u.id, u]));

    const enrichedMembers = members.map((member) => {
      const u = userMap.get(member.userId);
      return {
        ...member,
        email: u?.email ?? 'Sin email',
        firstName: u?.firstName ?? '',
        lastName: u?.lastName ?? '',
        imageUrl: u?.imageUrl ?? null,
      };
    });

    return { data: enrichedMembers, total };
  } catch (error) {
    logger.error('Error al obtener miembros', { data: { error, companyId } });
    throw new Error('Error al obtener usuarios');
  }
}

/**
 * Obtiene las invitaciones pendientes (no aceptadas y no expiradas)
 */
export async function getPendingInvitations() {
  await checkPermission('company.general.users', 'view', { redirect: true });

  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    const invitations = await prisma.companyInvitation.findMany({
      where: {
        companyId,
        acceptedAt: null, // No aceptada
        expiresAt: { gt: new Date() }, // No expirada
      },
      select: {
        id: true,
        email: true,
        expiresAt: true,
        createdAt: true,
        assignedRole: {
          select: {
            id: true,
            name: true,
            color: true,
          },
        },
        employee: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            employeeNumber: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Mapear para compatibilidad con la UI
    return invitations.map((inv) => ({
      ...inv,
      role: inv.assignedRole,
      employee: inv.employee,
    }));
  } catch (error) {
    logger.error('Error al obtener invitaciones', { data: { error, companyId } });
    throw new Error('Error al obtener invitaciones');
  }
}

/**
 * Obtiene los roles disponibles para selección
 */
export async function getAvailableRoles() {
  await checkPermission('company.general.users', 'view', { redirect: true });

  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    return await prisma.companyRole.findMany({
      where: { companyId },
      select: {
        id: true,
        name: true,
        slug: true,
        color: true,
        isSystem: true,
        isDefault: true,
      },
      orderBy: [{ isSystem: 'desc' }, { name: 'asc' }],
    });
  } catch (error) {
    logger.error('Error al obtener roles', { data: { error, companyId } });
    return [];
  }
}

/**
 * Obtiene los empleados disponibles para vincular a una invitación
 * Excluye empleados ya vinculados a un CompanyMember o con invitación pendiente
 */
export async function getAvailableEmployeesForInvitation() {
  await checkPermission('company.general.users', 'view', { redirect: true });

  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    // Obtener IDs de empleados con invitaciones pendientes
    const pendingInvites = await prisma.companyInvitation.findMany({
      where: {
        companyId,
        acceptedAt: null,
        expiresAt: { gt: new Date() },
        employeeId: { not: null },
      },
      select: { employeeId: true },
    });

    const excludedIds = pendingInvites
      .map((i) => i.employeeId)
      .filter((id): id is string => id !== null);

    return await prisma.employee.findMany({
      where: {
        companyId,
        isActive: true,
        companyMember: null,
        id: { notIn: excludedIds },
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        employeeNumber: true,
        documentNumber: true,
        pictureUrl: true,
      },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    });
  } catch (error) {
    logger.error('Error al obtener empleados disponibles', { data: { error, companyId } });
    return [];
  }
}

// ============================================
// MUTATIONS
// ============================================

/**
 * Invita a un usuario a la empresa
 */
export async function inviteUser(input: InviteUserInput) {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('No autenticado');
  await checkPermission('company.general.users', 'create', { redirect: true });

  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    // Verificar que el rol existe y pertenece a la empresa
    const role = await prisma.companyRole.findFirst({
      where: { id: input.roleId, companyId },
    });

    if (!role) {
      throw new Error('Rol no válido');
    }

    // Verificar si ya existe una invitación pendiente para este email
    const existingInvitation = await prisma.companyInvitation.findFirst({
      where: {
        companyId,
        email: input.email.toLowerCase(),
        acceptedAt: null,
        expiresAt: { gt: new Date() },
      },
    });

    if (existingInvitation) {
      throw new Error('Ya existe una invitación pendiente para este email');
    }

    // Verificar si el usuario ya es miembro
    const existingUser = await prisma.user.findUnique({
      where: { email: input.email.toLowerCase() },
      select: { id: true },
    });

    if (existingUser) {
      const existingMember = await prisma.companyMember.findFirst({
        where: {
          companyId,
          userId: existingUser.id,
        },
        select: { id: true },
      });

      if (existingMember) {
        throw new Error('Este usuario ya es miembro de la empresa');
      }
    }

    // Validar employeeId si se proporciona
    if (input.employeeId) {
      const employee = await prisma.employee.findFirst({
        where: {
          id: input.employeeId,
          companyId,
          isActive: true,
          companyMember: null,
        },
        select: { id: true },
      });

      if (!employee) {
        throw new Error('Empleado no válido o ya vinculado a otro usuario');
      }

      // Verificar que no tenga invitación pendiente
      const existingEmployeeInvite = await prisma.companyInvitation.findFirst({
        where: {
          companyId,
          employeeId: input.employeeId,
          acceptedAt: null,
          expiresAt: { gt: new Date() },
        },
        select: { id: true },
      });

      if (existingEmployeeInvite) {
        throw new Error('Este empleado ya tiene una invitación pendiente');
      }
    }

    // Crear invitación
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7); // Expira en 7 días

    const invitation = await prisma.companyInvitation.create({
      data: {
        companyId,
        email: input.email.toLowerCase(),
        roleId: input.roleId,
        employeeId: input.employeeId || null,
        invitedBy: userId,
        expiresAt,
      },
    });

    // Registrar en audit log
    await createAuditLog({
      action: AUDIT_ACTIONS.member_invited,
      targetType: 'invitation',
      targetId: invitation.id,
      targetName: input.email,
      details: {
        roleId: input.roleId,
        roleName: role.name,
      },
    });

    logger.info('Invitación creada', { data: { invitationId: invitation.id, email: input.email } });
    revalidatePath('/dashboard/company/general/users');

    // Enviar email de invitación
    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: { name: true },
    });

    const inviter = await prisma.user.findUnique({
      where: { id: userId },
      select: { firstName: true, lastName: true },
    });
    const inviterName =
      `${inviter?.firstName || ''} ${inviter?.lastName || ''}`.trim() ||
      'Un administrador';

    try {
      await sendInvitationEmail({
        to: input.email,
        inviteUrl: `${process.env.NEXT_PUBLIC_APP_URL}/invite?token=${invitation.token}`,
        companyName: company?.name || 'La empresa',
        roleName: role.name,
        invitedByName: inviterName,
        expiresAt,
      });
    } catch (emailError) {
      // Si falla el email, logueamos pero no fallamos la invitación
      logger.error('Error enviando email de invitación', {
        data: { emailError, email: input.email },
      });
    }

    return invitation;
  } catch (error) {
    logger.error('Error al invitar usuario', { data: { error, input } });
    throw error;
  }
}

/**
 * Cancela una invitación pendiente (la elimina)
 */
export async function cancelInvitation(invitationId: string) {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('No autenticado');
  await checkPermission('company.general.users', 'update', { redirect: true });

  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    const invitation = await prisma.companyInvitation.findFirst({
      where: {
        id: invitationId,
        companyId,
        acceptedAt: null,
      },
    });

    if (!invitation) {
      throw new Error('Invitación no encontrada');
    }

    // Eliminar la invitación (o podrías marcarla de otra forma)
    await prisma.companyInvitation.delete({
      where: { id: invitationId },
    });

    await createAuditLog({
      action: AUDIT_ACTIONS.invitation_cancelled,
      targetType: 'invitation',
      targetId: invitationId,
      targetName: invitation.email,
    });

    logger.info('Invitación cancelada', { data: { invitationId } });
    revalidatePath('/dashboard/company/general/users');

    return { success: true };
  } catch (error) {
    logger.error('Error al cancelar invitación', { data: { error, invitationId } });
    throw error;
  }
}

/**
 * Reenvía el email de una invitación pendiente.
 * Mantiene el mismo token (el enlace previo sigue siendo válido) y renueva
 * la expiración a 7 días desde ahora.
 */
export async function resendInvitation(invitationId: string) {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('No autenticado');
  await checkPermission('company.general.users', 'update', { redirect: true });

  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    const invitation = await prisma.companyInvitation.findFirst({
      where: {
        id: invitationId,
        companyId,
        acceptedAt: null,
      },
      include: { assignedRole: { select: { name: true } } },
    });

    if (!invitation) {
      throw new Error('Invitación no encontrada o ya aceptada');
    }

    // Renovar expiración a 7 días desde ahora
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    await prisma.companyInvitation.update({
      where: { id: invitationId },
      data: { expiresAt },
    });

    // Datos para el email
    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: { name: true },
    });

    const inviter = await prisma.user.findUnique({
      where: { id: userId },
      select: { firstName: true, lastName: true },
    });
    const inviterName =
      `${inviter?.firstName || ''} ${inviter?.lastName || ''}`.trim() ||
      'Un administrador';

    // A diferencia de la invitación inicial, acá el envío del email ES el objetivo:
    // si falla, la acción falla para que el usuario lo sepa.
    await sendInvitationEmail({
      to: invitation.email,
      inviteUrl: `${process.env.NEXT_PUBLIC_APP_URL}/invite?token=${invitation.token}`,
      companyName: company?.name || 'La empresa',
      roleName: invitation.assignedRole?.name || 'Miembro',
      invitedByName: inviterName,
      expiresAt,
    });

    await createAuditLog({
      action: AUDIT_ACTIONS.invitation_resent,
      targetType: 'invitation',
      targetId: invitationId,
      targetName: invitation.email,
    });

    logger.info('Invitación reenviada', {
      data: { invitationId, email: invitation.email },
    });
    revalidatePath('/dashboard/company/general/users');

    return { success: true };
  } catch (error) {
    logger.error('Error al reenviar invitación', { data: { error, invitationId } });
    throw error;
  }
}

/**
 * Actualiza el rol de un miembro
 */
export async function updateMemberRole(input: UpdateMemberRoleInput) {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('No autenticado');
  await checkPermission('company.general.users', 'update', { redirect: true });

  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    const member = await prisma.companyMember.findFirst({
      where: { id: input.memberId, companyId },
      include: { role: true },
    });

    if (!member) {
      throw new Error('Miembro no encontrado');
    }

    // No permitir cambiar rol del owner
    if (member.isOwner) {
      throw new Error('No se puede cambiar el rol del propietario');
    }

    const newRole = await prisma.companyRole.findFirst({
      where: { id: input.roleId, companyId },
    });

    if (!newRole) {
      throw new Error('Rol no válido');
    }

    const oldRole = member.role;

    await prisma.companyMember.update({
      where: { id: input.memberId },
      data: { roleId: input.roleId },
    });

    await createAuditLog({
      action: AUDIT_ACTIONS.member_role_changed,
      targetType: 'member',
      targetId: input.memberId,
      module: 'company.general.users',
      oldValue: oldRole ? { roleId: oldRole.id, roleName: oldRole.name } : undefined,
      newValue: { roleId: newRole.id, roleName: newRole.name },
    });

    logger.info('Rol de miembro actualizado', { data: { memberId: input.memberId, newRoleId: input.roleId } });
    revalidatePath('/dashboard/company/general/users');

    return { success: true };
  } catch (error) {
    logger.error('Error al actualizar rol', { data: { error, input } });
    throw error;
  }
}

/**
 * Desactiva un miembro (soft delete)
 */
export async function deactivateMember(memberId: string) {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('No autenticado');
  await checkPermission('company.general.users', 'delete', { redirect: true });

  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    const member = await prisma.companyMember.findFirst({
      where: { id: memberId, companyId },
    });

    if (!member) {
      throw new Error('Miembro no encontrado');
    }

    // No permitir desactivar al owner
    if (member.isOwner) {
      throw new Error('No se puede desactivar al propietario');
    }

    // No permitir desactivarse a sí mismo
    if (member.userId === userId) {
      throw new Error('No puedes desactivarte a ti mismo');
    }

    await prisma.companyMember.update({
      where: { id: memberId },
      data: { isActive: false },
    });

    await createAuditLog({
      action: AUDIT_ACTIONS.member_deactivated,
      targetType: 'member',
      targetId: memberId,
    });

    logger.info('Miembro desactivado', { data: { memberId } });
    revalidatePath('/dashboard/company/general/users');

    return { success: true };
  } catch (error) {
    logger.error('Error al desactivar miembro', { data: { error, memberId } });
    throw error;
  }
}

// ============================================
// TIPOS INFERIDOS
// ============================================

export type CompanyMemberListItem = Awaited<
  ReturnType<typeof getCompanyMembersPaginated>
>['data'][number];
export type PendingInvitation = Awaited<ReturnType<typeof getPendingInvitations>>[number];
export type AvailableRole = Awaited<ReturnType<typeof getAvailableRoles>>[number];
export type AvailableEmployee = Awaited<ReturnType<typeof getAvailableEmployeesForInvitation>>[number];
