'use server';

import { getActiveCompanyId } from '@/shared/lib/company';
import { logger } from '@/shared/lib/logger';
import { checkPermission } from '@/shared/lib/permissions';
import { prisma } from '@/shared/lib/prisma';
import { buildFiltersWhere } from '@/shared/components/common/DataTable/helpers';
import { revalidatePath } from 'next/cache';

interface GetClientsParams {
  page?: number;
  pageSize?: number;
  search?: string;
  isActive?: boolean;
  filters?: Record<string, string[]>;
}

/**
 * Obtiene la lista de clientes (contratistas) con paginación
 */
export async function getClients(params: GetClientsParams = {}) {
  await checkPermission('commercial.clients', 'view', { redirect: true });
  const { page = 1, pageSize = 10, search, isActive, filters = {} } = params;
  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    // Build faceted filters, excluding isActive since it needs boolean conversion
    const facetedWhere = buildFiltersWhere(filters, {}, { exclude: ['isActive'] });

    // Handle isActive boolean filter from faceted filter (values are 'true'/'false' strings)
    let isActiveFilter: boolean | undefined = isActive;
    if (filters.isActive && filters.isActive.length > 0) {
      const val = filters.isActive[0];
      if (val === 'true') isActiveFilter = true;
      else if (val === 'false') isActiveFilter = false;
    }

    const where = {
      companyId,
      ...facetedWhere,
      ...(isActiveFilter !== undefined && { isActive: isActiveFilter }),
      ...(search && {
        OR: [
          { name: { contains: search, mode: 'insensitive' as const } },
          { taxId: { contains: search, mode: 'insensitive' as const } },
          { email: { contains: search, mode: 'insensitive' as const } },
        ],
      }),
    };

    const [clients, total] = await Promise.all([
      prisma.contractor.findMany({
        where,
        select: {
          id: true,
          name: true,
          taxId: true,
          email: true,
          phone: true,
          address: true,
          isActive: true,
          terminationDate: true,
          createdAt: true,
          // Campos comerciales
          taxCondition: true,
          paymentTermDays: true,
          creditLimit: true,
          priceListId: true,
          defaultAccountId: true,
          _count: {
            select: {
              vehicleAllocations: true,
              employeeAllocations: true,
            },
          },
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
          priceList: {
            select: {
              id: true,
              name: true,
            },
          },
          defaultAccount: {
            select: {
              id: true,
              code: true,
              name: true,
            },
          },
        },
        orderBy: { name: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.contractor.count({ where }),
    ]);

    return {
      data: clients,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    };
  } catch (error) {
    logger.error('Error getting clients', { data: { error, params } });
    throw new Error('Error al obtener clientes');
  }
}

/**
 * Obtiene un cliente por ID
 */
export async function getClientById(id: string) {
  await checkPermission('commercial.clients', 'view', { redirect: true });
  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    const client = await prisma.contractor.findFirst({
      where: { id, companyId },
      include: {
        contact: true,
        vehicleAllocations: {
          include: {
            vehicle: {
              select: {
                id: true,
                internNumber: true,
                domain: true,
              },
            },
          },
        },
        employeeAllocations: {
          include: {
            employee: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                employeeNumber: true,
              },
            },
          },
        },
      },
    });

    if (!client) throw new Error('Cliente no encontrado');
    return client;
  } catch (error) {
    logger.error('Error getting client by id', { data: { error, id } });
    throw error instanceof Error ? error : new Error('Error al obtener el cliente');
  }
}

export interface CreateClientInput {
  name: string;
  taxId?: string;
  email?: string;
  phone?: string;
  address?: string;
  contactId?: string; // Para vincular un contacto existente
  contact?: {
    firstName: string;
    lastName: string;
    email?: string;
    phone?: string;
    position?: string;
  };
  // Campos comerciales (opcionales)
  taxCondition?: 'RESPONSABLE_INSCRIPTO' | 'MONOTRIBUTISTA' | 'EXENTO' | 'CONSUMIDOR_FINAL';
  paymentTermDays?: number;
  creditLimit?: number;
  priceListId?: string;
  defaultAccountId?: string;
}

/**
 * Crea un nuevo cliente
 */
export async function createClient(input: CreateClientInput) {
  await checkPermission('commercial.clients', 'create', { redirect: true });
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

    const client = await prisma.contractor.create({
      data: {
        companyId,
        name: input.name,
        taxId: input.taxId || null,
        email: input.email || null,
        phone: input.phone || null,
        address: input.address || null,
        // Campos comerciales
        taxCondition: input.taxCondition,
        paymentTermDays: input.paymentTermDays,
        creditLimit: input.creditLimit,
        priceListId: input.priceListId,
        defaultAccountId: input.defaultAccountId,
        contact: contactData,
      },
      select: { id: true },
    });

    revalidatePath('/dashboard/company/commercial/clients');
    revalidatePath('/dashboard/company/commercial/contacts');
    return client;
  } catch (error) {
    logger.error('Error creating client', { data: { error, input } });
    throw new Error('Error al crear el cliente');
  }
}

export interface UpdateClientInput extends Partial<CreateClientInput> {
  unlinkContact?: boolean; // Para desvincular el contacto actual
}

/**
 * Actualiza un cliente existente
 */
export async function updateClient(id: string, input: UpdateClientInput) {
  await checkPermission('commercial.clients', 'update', { redirect: true });
  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    // Verificar que el cliente pertenece a la empresa
    const existing = await prisma.contractor.findFirst({
      where: { id, companyId },
      select: { id: true, contact: { select: { id: true } } },
    });

    if (!existing) throw new Error('Cliente no encontrado');

    // Determinar la operación de contacto
    let contactData;
    if (input.unlinkContact && existing.contact) {
      // Desvincular el contacto actual (solo desvincula, no elimina)
      contactData = { disconnect: true };
    } else if (input.contactId) {
      // Vincular un contacto existente diferente
      if (existing.contact) {
        // Primero desvincular el actual, luego conectar el nuevo
        await prisma.contractor.update({
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

    const client = await prisma.contractor.update({
      where: { id },
      data: {
        name: input.name,
        taxId: input.taxId || null,
        email: input.email || null,
        phone: input.phone || null,
        address: input.address || null,
        // Campos comerciales
        ...(input.taxCondition !== undefined && { taxCondition: input.taxCondition }),
        ...(input.paymentTermDays !== undefined && { paymentTermDays: input.paymentTermDays }),
        ...(input.creditLimit !== undefined && { creditLimit: input.creditLimit }),
        ...(input.priceListId !== undefined && { priceListId: input.priceListId }),
        ...(input.defaultAccountId !== undefined && { defaultAccountId: input.defaultAccountId }),
        contact: contactData,
      },
      select: { id: true },
    });

    revalidatePath('/dashboard/company/commercial/clients');
    revalidatePath('/dashboard/company/commercial/contacts');
    revalidatePath(`/dashboard/company/commercial/clients/${id}`);
    return client;
  } catch (error) {
    logger.error('Error updating client', { data: { error, id, input } });
    throw error instanceof Error ? error : new Error('Error al actualizar el cliente');
  }
}

/**
 * Da de baja a un cliente
 */
export async function deactivateClient(id: string, reason?: string) {
  await checkPermission('commercial.clients', 'delete', { redirect: true });
  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    const existing = await prisma.contractor.findFirst({
      where: { id, companyId },
      select: { id: true },
    });

    if (!existing) throw new Error('Cliente no encontrado');

    await prisma.contractor.update({
      where: { id },
      data: {
        isActive: false,
        terminationDate: new Date(),
        reasonForTermination: reason || null,
      },
    });

    revalidatePath('/dashboard/company/commercial/clients');
    return { success: true };
  } catch (error) {
    logger.error('Error deactivating client', { data: { error, id } });
    throw error instanceof Error ? error : new Error('Error al dar de baja el cliente');
  }
}

/**
 * Reactiva un cliente
 */
export async function reactivateClient(id: string) {
  await checkPermission('commercial.clients', 'update', { redirect: true });
  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    const existing = await prisma.contractor.findFirst({
      where: { id, companyId },
      select: { id: true },
    });

    if (!existing) throw new Error('Cliente no encontrado');

    await prisma.contractor.update({
      where: { id },
      data: {
        isActive: true,
        terminationDate: null,
        reasonForTermination: null,
      },
    });

    revalidatePath('/dashboard/company/commercial/clients');
    return { success: true };
  } catch (error) {
    logger.error('Error reactivating client', { data: { error, id } });
    throw error instanceof Error ? error : new Error('Error al reactivar el cliente');
  }
}

/**
 * Obtiene contactos disponibles (sin asignar a cliente ni lead)
 */
export async function getAvailableContacts(currentContactId?: string) {
  await checkPermission('commercial.clients', 'view', { redirect: true });
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
    logger.error('Error getting available contacts', { data: { error } });
    return [];
  }
}

// Tipos inferidos
export type ClientListItem = Awaited<ReturnType<typeof getClients>>['data'][number];
export type ClientData = Awaited<ReturnType<typeof getClientById>>;
export type AvailableContact = Awaited<ReturnType<typeof getAvailableContacts>>[number];
