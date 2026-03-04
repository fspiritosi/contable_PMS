'use server';

import { getActiveCompanyId } from '@/shared/lib/company';
import { logger } from '@/shared/lib/logger';
import { checkPermission } from '@/shared/lib/permissions';
import { prisma } from '@/shared/lib/prisma';
import { revalidatePath } from 'next/cache';

interface GetContactsParams {
  page?: number;
  pageSize?: number;
  search?: string;
  filters?: Record<string, string[]>;
}

/**
 * Construye la cláusula where para el filtro linkedType
 * Valores posibles: 'client', 'lead', 'none'
 */
function buildLinkedTypeWhere(values: string[]) {
  if (!values || values.length === 0) return {};

  const conditions: object[] = [];

  if (values.includes('client')) {
    conditions.push({ contractorId: { not: null } });
  }
  if (values.includes('lead')) {
    conditions.push({ leadId: { not: null }, contractorId: null });
  }
  if (values.includes('none')) {
    conditions.push({ contractorId: null, leadId: null });
  }

  if (conditions.length === 0) return {};
  if (conditions.length === 1) return conditions[0];
  return { OR: conditions };
}

/**
 * Obtiene la lista de contactos con paginación
 */
export async function getContacts(params: GetContactsParams = {}) {
  await checkPermission('commercial.contacts', 'view', { redirect: true });
  const { page = 1, pageSize = 10, search, filters = {} } = params;
  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    const linkedTypeWhere = buildLinkedTypeWhere(filters['linkedType'] ?? []);

    const where = {
      companyId,
      isActive: true,
      ...linkedTypeWhere,
      ...(search && {
        OR: [
          { firstName: { contains: search, mode: 'insensitive' as const } },
          { lastName: { contains: search, mode: 'insensitive' as const } },
          { email: { contains: search, mode: 'insensitive' as const } },
          { contractor: { name: { contains: search, mode: 'insensitive' as const } } },
          { lead: { name: { contains: search, mode: 'insensitive' as const } } },
        ],
      }),
    };

    const [contacts, total] = await Promise.all([
      prisma.contact.findMany({
        where,
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          phone: true,
          position: true,
          isActive: true,
          createdAt: true,
          contractor: {
            select: {
              id: true,
              name: true,
            },
          },
          lead: {
            select: {
              id: true,
              name: true,
              status: true,
            },
          },
        },
        orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.contact.count({ where }),
    ]);

    return {
      data: contacts,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    };
  } catch (error) {
    logger.error('Error getting contacts', { data: { error, params } });
    throw new Error('Error al obtener contactos');
  }
}

export interface CreateContactInput {
  firstName: string;
  lastName: string;
  email?: string;
  phone?: string;
  position?: string;
  contractorId?: string;
  leadId?: string;
}

/**
 * Crea un nuevo contacto
 */
export async function createContact(input: CreateContactInput) {
  await checkPermission('commercial.contacts', 'create', { redirect: true });
  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    const contact = await prisma.contact.create({
      data: {
        companyId,
        firstName: input.firstName,
        lastName: input.lastName,
        email: input.email || null,
        phone: input.phone || null,
        position: input.position || null,
        contractorId: input.contractorId || null,
        leadId: input.leadId || null,
      },
      select: { id: true },
    });

    revalidatePath('/dashboard/company/commercial/contacts');
    return contact;
  } catch (error) {
    logger.error('Error creating contact', { data: { error, input } });
    throw new Error('Error al crear el contacto');
  }
}

export interface UpdateContactInput extends Partial<CreateContactInput> {}

/**
 * Actualiza un contacto existente
 */
export async function updateContact(id: string, input: UpdateContactInput) {
  await checkPermission('commercial.contacts', 'update', { redirect: true });
  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    const existing = await prisma.contact.findFirst({
      where: { id, companyId },
      select: { id: true },
    });

    if (!existing) throw new Error('Contacto no encontrado');

    const contact = await prisma.contact.update({
      where: { id },
      data: {
        firstName: input.firstName,
        lastName: input.lastName,
        email: input.email || null,
        phone: input.phone || null,
        position: input.position || null,
        contractorId: input.contractorId || null,
        leadId: input.leadId || null,
      },
      select: { id: true },
    });

    revalidatePath('/dashboard/company/commercial/contacts');
    return contact;
  } catch (error) {
    logger.error('Error updating contact', { data: { error, id, input } });
    throw error instanceof Error ? error : new Error('Error al actualizar el contacto');
  }
}

/**
 * Elimina un contacto (soft delete)
 */
export async function deleteContact(id: string) {
  await checkPermission('commercial.contacts', 'delete', { redirect: true });
  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    const existing = await prisma.contact.findFirst({
      where: { id, companyId },
      select: { id: true },
    });

    if (!existing) throw new Error('Contacto no encontrado');

    await prisma.contact.update({
      where: { id },
      data: { isActive: false },
    });

    revalidatePath('/dashboard/company/commercial/contacts');
    return { success: true };
  } catch (error) {
    logger.error('Error deleting contact', { data: { error, id } });
    throw error instanceof Error ? error : new Error('Error al eliminar el contacto');
  }
}

/**
 * Obtiene clientes y leads para el select del formulario
 */
export async function getContactFormOptions() {
  await checkPermission('commercial.contacts', 'view', { redirect: true });
  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    const [clients, leads] = await Promise.all([
      prisma.contractor.findMany({
        where: { companyId, isActive: true },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      }),
      prisma.lead.findMany({
        where: {
          companyId,
          isActive: true,
          status: { notIn: ['CONVERTED', 'REJECTED'] },
        },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      }),
    ]);

    return { clients, leads };
  } catch (error) {
    logger.error('Error getting contact form options', { data: { error } });
    throw new Error('Error al obtener opciones del formulario');
  }
}

// Tipos inferidos
export type ContactListItem = Awaited<ReturnType<typeof getContacts>>['data'][number];
export type ContactFormOptions = Awaited<ReturnType<typeof getContactFormOptions>>;
