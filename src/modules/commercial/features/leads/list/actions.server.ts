'use server';

import { LeadStatus } from '@/generated/prisma/enums';
import { getActiveCompanyId } from '@/shared/lib/company';
import { logger } from '@/shared/lib/logger';
import { checkPermission } from '@/shared/lib/permissions';
import { prisma } from '@/shared/lib/prisma';
import { buildFiltersWhere } from '@/shared/components/common/DataTable/helpers';
import { revalidatePath } from 'next/cache';

interface GetLeadsParams {
  page?: number;
  pageSize?: number;
  search?: string;
  status?: LeadStatus;
  filters?: Record<string, string[]>;
}

/**
 * Obtiene la lista de leads con paginación
 */
export async function getLeads(params: GetLeadsParams = {}) {
  await checkPermission('commercial.leads', 'view', { redirect: true });
  const { page = 1, pageSize = 10, search, status, filters = {} } = params;
  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    const filtersWhere = buildFiltersWhere(filters, ['status']);

    const where = {
      companyId,
      isActive: true,
      ...(status && { status }),
      ...filtersWhere,
      ...(search && {
        OR: [
          { name: { contains: search, mode: 'insensitive' as const } },
          { taxId: { contains: search, mode: 'insensitive' as const } },
          { email: { contains: search, mode: 'insensitive' as const } },
        ],
      }),
    };

    const [leads, total] = await Promise.all([
      prisma.lead.findMany({
        where,
        select: {
          id: true,
          name: true,
          taxId: true,
          email: true,
          phone: true,
          address: true,
          status: true,
          notes: true,
          convertedAt: true,
          createdAt: true,
          contact: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
              phone: true,
              position: true,
            },
          },
          convertedToClient: {
            select: {
              id: true,
              name: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.lead.count({ where }),
    ]);

    return {
      data: leads,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    };
  } catch (error) {
    logger.error('Error getting leads', { data: { error, params } });
    throw new Error('Error al obtener leads');
  }
}

/**
 * Obtiene un lead por ID
 */
export async function getLeadById(id: string) {
  await checkPermission('commercial.leads', 'view', { redirect: true });
  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    const lead = await prisma.lead.findFirst({
      where: { id, companyId },
      include: {
        contact: true,
        convertedToClient: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    if (!lead) throw new Error('Lead no encontrado');
    return lead;
  } catch (error) {
    logger.error('Error getting lead by id', { data: { error, id } });
    throw error instanceof Error ? error : new Error('Error al obtener el lead');
  }
}

/**
 * Obtiene contactos disponibles (sin asignar a cliente ni lead)
 * @param currentContactId - ID del contacto actual para incluirlo en la lista al editar
 */
export async function getAvailableContactsForLead(currentContactId?: string) {
  await checkPermission('commercial.leads', 'view', { redirect: true });
  const companyId = await getActiveCompanyId();
  if (!companyId) return [];

  try {
    return await prisma.contact.findMany({
      where: {
        companyId,
        isActive: true,
        OR: [
          // Contactos sin asignar
          { contractorId: null, leadId: null },
          // O el contacto actual (para que aparezca en el select al editar)
          ...(currentContactId ? [{ id: currentContactId }] : []),
        ],
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
        position: true,
      },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    });
  } catch (error) {
    logger.error('Error getting available contacts for lead', { data: { error } });
    return [];
  }
}

export interface CreateLeadInput {
  name: string;
  taxId?: string;
  email?: string;
  phone?: string;
  address?: string;
  notes?: string;
  contactId?: string; // Para vincular un contacto existente
  contact?: {
    firstName: string;
    lastName: string;
    email?: string;
    phone?: string;
    position?: string;
  };
}

/**
 * Crea un nuevo lead
 */
export async function createLead(input: CreateLeadInput) {
  await checkPermission('commercial.leads', 'create', { redirect: true });
  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    // Si se proporciona contactId, vincular el contacto existente
    // Si se proporciona contact, crear uno nuevo
    const contactData = input.contactId
      ? { connect: { id: input.contactId } }
      : input.contact
        ? {
            create: {
              companyId,
              firstName: input.contact.firstName,
              lastName: input.contact.lastName,
              email: input.contact.email || null,
              phone: input.contact.phone || null,
              position: input.contact.position || null,
            },
          }
        : undefined;

    const lead = await prisma.lead.create({
      data: {
        companyId,
        name: input.name,
        taxId: input.taxId || null,
        email: input.email || null,
        phone: input.phone || null,
        address: input.address || null,
        notes: input.notes || null,
        contact: contactData,
      },
      select: { id: true },
    });

    revalidatePath('/dashboard/company/commercial/leads');
    revalidatePath('/dashboard/company/commercial/contacts');
    return lead;
  } catch (error) {
    logger.error('Error creating lead', { data: { error, input } });
    throw new Error('Error al crear el lead');
  }
}

export interface UpdateLeadInput extends Partial<CreateLeadInput> {
  status?: LeadStatus;
  unlinkContact?: boolean; // Para desvincular el contacto actual
}

/**
 * Actualiza un lead existente
 */
export async function updateLead(id: string, input: UpdateLeadInput) {
  await checkPermission('commercial.leads', 'update', { redirect: true });
  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    const existing = await prisma.lead.findFirst({
      where: { id, companyId },
      select: { id: true, contact: { select: { id: true } } },
    });

    if (!existing) throw new Error('Lead no encontrado');

    // Determinar la operación de contacto
    let contactData;
    if (input.unlinkContact && existing.contact) {
      // Desvincular el contacto actual (solo desvincula, no elimina)
      contactData = { disconnect: true };
    } else if (input.contactId) {
      // Vincular un contacto existente diferente
      if (existing.contact) {
        // Primero desvincular el actual, luego conectar el nuevo
        await prisma.lead.update({
          where: { id },
          data: { contact: { disconnect: true } },
        });
      }
      contactData = { connect: { id: input.contactId } };
    } else if (input.contact) {
      // Crear o actualizar contacto inline
      contactData = existing.contact
        ? {
            update: {
              firstName: input.contact.firstName,
              lastName: input.contact.lastName,
              email: input.contact.email || null,
              phone: input.contact.phone || null,
              position: input.contact.position || null,
            },
          }
        : {
            create: {
              companyId,
              firstName: input.contact.firstName,
              lastName: input.contact.lastName,
              email: input.contact.email || null,
              phone: input.contact.phone || null,
              position: input.contact.position || null,
            },
          };
    }

    const lead = await prisma.lead.update({
      where: { id },
      data: {
        name: input.name,
        taxId: input.taxId || null,
        email: input.email || null,
        phone: input.phone || null,
        address: input.address || null,
        notes: input.notes || null,
        status: input.status,
        contact: contactData,
      },
      select: { id: true },
    });

    revalidatePath('/dashboard/company/commercial/leads');
    revalidatePath('/dashboard/company/commercial/contacts');
    return lead;
  } catch (error) {
    logger.error('Error updating lead', { data: { error, id, input } });
    throw error instanceof Error ? error : new Error('Error al actualizar el lead');
  }
}

/**
 * Actualiza el estado de un lead
 */
export async function updateLeadStatus(id: string, status: LeadStatus) {
  await checkPermission('commercial.leads', 'update', { redirect: true });
  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    const existing = await prisma.lead.findFirst({
      where: { id, companyId },
      select: { id: true },
    });

    if (!existing) throw new Error('Lead no encontrado');

    await prisma.lead.update({
      where: { id },
      data: { status },
    });

    revalidatePath('/dashboard/company/commercial/leads');
    return { success: true };
  } catch (error) {
    logger.error('Error updating lead status', { data: { error, id, status } });
    throw error instanceof Error ? error : new Error('Error al actualizar el estado');
  }
}

export interface ConvertLeadInput {
  address?: string;
  phone?: string;
  email?: string;
}

/**
 * Convierte un lead a cliente
 */
export async function convertLeadToClient(id: string, additionalData?: ConvertLeadInput) {
  await checkPermission('commercial.leads', 'approve', { redirect: true });
  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    const lead = await prisma.lead.findFirst({
      where: { id, companyId },
      include: { contact: true },
    });

    if (!lead) throw new Error('Lead no encontrado');
    if (lead.status === 'CONVERTED') throw new Error('Este lead ya fue convertido');

    // Crear el cliente en una transacción
    const result = await prisma.$transaction(async (tx) => {
      // 1. Crear el cliente
      const client = await tx.contractor.create({
        data: {
          companyId,
          name: lead.name,
          taxId: lead.taxId,
          email: additionalData?.email || lead.email,
          phone: additionalData?.phone || lead.phone,
          address: additionalData?.address || lead.address,
        },
        select: { id: true },
      });

      // 2. Mover el contacto al cliente (si existe)
      if (lead.contact) {
        await tx.contact.update({
          where: { id: lead.contact.id },
          data: {
            leadId: null,
            contractorId: client.id,
          },
        });
      }

      // 3. Actualizar el lead como convertido
      await tx.lead.update({
        where: { id },
        data: {
          status: 'CONVERTED',
          convertedAt: new Date(),
          convertedToClientId: client.id,
        },
      });

      return client;
    });

    revalidatePath('/dashboard/company/commercial/leads');
    revalidatePath('/dashboard/company/commercial/clients');

    return result;
  } catch (error) {
    logger.error('Error converting lead to client', { data: { error, id } });
    throw error instanceof Error ? error : new Error('Error al convertir el lead');
  }
}

/**
 * Elimina un lead (soft delete)
 */
export async function deleteLead(id: string) {
  await checkPermission('commercial.leads', 'delete', { redirect: true });
  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    const existing = await prisma.lead.findFirst({
      where: { id, companyId },
      select: { id: true },
    });

    if (!existing) throw new Error('Lead no encontrado');

    await prisma.lead.update({
      where: { id },
      data: { isActive: false },
    });

    revalidatePath('/dashboard/company/commercial/leads');
    return { success: true };
  } catch (error) {
    logger.error('Error deleting lead', { data: { error, id } });
    throw error instanceof Error ? error : new Error('Error al eliminar el lead');
  }
}

// Tipos inferidos
export type LeadListItem = Awaited<ReturnType<typeof getLeads>>['data'][number];
export type LeadDetail = Awaited<ReturnType<typeof getLeadById>>;
export type AvailableContactForLead = Awaited<ReturnType<typeof getAvailableContactsForLead>>[number];
