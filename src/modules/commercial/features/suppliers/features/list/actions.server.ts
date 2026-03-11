'use server';

import { auth } from '@clerk/nextjs/server';
import { prisma } from '@/shared/lib/prisma';
import { logger } from '@/shared/lib/logger';
import { checkPermission } from '@/shared/lib/permissions';
import { getActiveCompanyId } from '@/shared/lib/company';
import { revalidatePath } from 'next/cache';
import {
  buildFiltersWhere,
  buildTextFiltersWhere,
  parseSearchParams,
  stateToPrismaParams,
  type DataTableSearchParams,
} from '@/shared/components/common/DataTable/helpers';
import {
  createSupplierSchema,
  updateSupplierSchema,
  type CreateSupplierFormData,
  type UpdateSupplierFormData,
} from '../../shared/validators';
import type { Supplier } from '../../shared/types';

/**
 * Obtiene el listado de proveedores de la empresa activa con paginación
 */
export async function getSuppliers(searchParams: DataTableSearchParams = {}) {
  await checkPermission('commercial.suppliers', 'view', { redirect: true });
  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    const { userId } = await auth();
    if (!userId) throw new Error('No autenticado');

    const state = parseSearchParams(searchParams);
    const { skip, take, orderBy } = stateToPrismaParams(state);

    const filtersWhere = buildFiltersWhere(state.filters, {
      status: 'status',
      taxCondition: 'taxCondition',
    }, { exclude: ['businessName', 'taxId'] });

    const textFiltersWhere = buildTextFiltersWhere(state.filters, ['taxId']);

    // Filtro de texto para nombre (busca en businessName y tradeName)
    const businessNameFilter = state.filters['businessName'];
    const nameWhere = businessNameFilter?.[0]
      ? {
          OR: [
            { businessName: { contains: businessNameFilter[0], mode: 'insensitive' as const } },
            { tradeName: { contains: businessNameFilter[0], mode: 'insensitive' as const } },
          ],
        }
      : {};

    const where = {
      companyId,
      ...filtersWhere,
      ...textFiltersWhere,
      ...nameWhere,
    };

    const [suppliers, total] = await Promise.all([
      prisma.supplier.findMany({
        where,
        orderBy: orderBy || [{ status: 'asc' }, { businessName: 'asc' }],
        skip,
        take,
      }),
      prisma.supplier.count({ where }),
    ]);

    const data = suppliers.map((supplier) => ({
      ...supplier,
      creditLimit: supplier.creditLimit ? Number(supplier.creditLimit) : null,
    }));

    return {
      data,
      pagination: {
        page: state.page + 1,
        pageSize: state.pageSize,
        total,
        totalPages: Math.ceil(total / state.pageSize),
      },
    };
  } catch (error) {
    logger.error('Error al obtener proveedores', { data: { error } });
    throw new Error('Error al obtener proveedores');
  }
}

/**
 * Obtiene los conteos de facetas para los filtros de proveedores
 */
export async function getSupplierFacetCounts() {
  await checkPermission('commercial.suppliers', 'view', { redirect: true });
  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  const [statusCounts, taxConditionCounts] = await Promise.all([
    prisma.supplier.groupBy({
      by: ['status'],
      where: { companyId },
      _count: { status: true },
    }),
    prisma.supplier.groupBy({
      by: ['taxCondition'],
      where: { companyId },
      _count: { taxCondition: true },
    }),
  ]);

  return {
    status: Object.fromEntries(statusCounts.map((s) => [s.status, s._count.status])),
    taxCondition: Object.fromEntries(taxConditionCounts.map((t) => [t.taxCondition, t._count.taxCondition])),
  };
}

/**
 * Obtiene un proveedor por ID
 */
export async function getSupplierById(id: string): Promise<Supplier | null> {
  await checkPermission('commercial.suppliers', 'view', { redirect: true });
  try {
    const { userId } = await auth();
    if (!userId) throw new Error('No autenticado');

    const companyId = await getActiveCompanyId();
    if (!companyId) throw new Error('No se encontró empresa activa');

    const supplier = await prisma.supplier.findFirst({
      where: { id, companyId },
    });

    if (!supplier) return null;

    return {
      ...supplier,
      creditLimit: supplier.creditLimit ? Number(supplier.creditLimit) : null,
    };
  } catch (error) {
    logger.error('Error al obtener proveedor', { data: { error, id } });
    throw new Error('Error al obtener proveedor');
  }
}

/**
 * Crea un nuevo proveedor
 */
export async function createSupplier(data: CreateSupplierFormData): Promise<Supplier> {
  await checkPermission('commercial.suppliers', 'create', { redirect: true });
  try {
    const { userId } = await auth();
    if (!userId) throw new Error('No autenticado');

    const companyId = await getActiveCompanyId();
    if (!companyId) throw new Error('No se encontró empresa activa');

    // Validar datos
    const validatedData = createSupplierSchema.parse(data);

    // Generar código automático (SUP-001, SUP-002, etc.)
    const lastSupplier = await prisma.supplier.findFirst({
      where: { companyId },
      orderBy: { code: 'desc' },
      select: { code: true },
    });

    let nextNumber = 1;
    if (lastSupplier && lastSupplier.code.startsWith('SUP-')) {
      const lastNumber = parseInt(lastSupplier.code.split('-')[1]);
      if (!isNaN(lastNumber)) {
        nextNumber = lastNumber + 1;
      }
    }
    const code = `SUP-${nextNumber.toString().padStart(3, '0')}`;

    // Validar que no exista el CUIT en la empresa
    const existingSupplier = await prisma.supplier.findFirst({
      where: {
        companyId,
        taxId: validatedData.taxId.replace(/-/g, ''), // Normalizar CUIT
      },
    });

    if (existingSupplier) {
      throw new Error('Ya existe un proveedor con ese CUIT');
    }

    // Crear proveedor
    const supplier = await prisma.supplier.create({
      data: {
        companyId,
        code,
        businessName: validatedData.businessName,
        tradeName: validatedData.tradeName,
        taxId: validatedData.taxId.replace(/-/g, ''), // Guardar sin guiones
        taxCondition: validatedData.taxCondition,
        email: validatedData.email,
        phone: validatedData.phone,
        website: validatedData.website,
        address: validatedData.address,
        city: validatedData.city,
        state: validatedData.state,
        zipCode: validatedData.zipCode,
        country: validatedData.country || 'Argentina',
        paymentTermDays: validatedData.paymentTermDays || 0,
        creditLimit: validatedData.creditLimit,
        contactName: validatedData.contactName,
        contactPhone: validatedData.contactPhone,
        contactEmail: validatedData.contactEmail,
        notes: validatedData.notes,
        createdBy: userId,
      },
    });

    logger.info('Proveedor creado', {
      data: { supplierId: supplier.id, code: supplier.code, companyId },
    });

    revalidatePath('/dashboard/commercial/suppliers');
    revalidatePath('/dashboard');

    return {
      ...supplier,
      creditLimit: supplier.creditLimit ? Number(supplier.creditLimit) : null,
    };
  } catch (error) {
    logger.error('Error al crear proveedor', { data: { error, data } });
    if (error instanceof Error) {
      throw error;
    }
    throw new Error('Error al crear proveedor');
  }
}

/**
 * Actualiza un proveedor existente
 */
export async function updateSupplier(
  id: string,
  data: UpdateSupplierFormData
): Promise<Supplier> {
  await checkPermission('commercial.suppliers', 'update', { redirect: true });
  try {
    const { userId } = await auth();
    if (!userId) throw new Error('No autenticado');

    const companyId = await getActiveCompanyId();
    if (!companyId) throw new Error('No se encontró empresa activa');

    // Validar datos
    const validatedData = updateSupplierSchema.parse(data);

    // Verificar que el proveedor existe y pertenece a la empresa
    const existingSupplier = await prisma.supplier.findFirst({
      where: { id, companyId },
    });

    if (!existingSupplier) {
      throw new Error('Proveedor no encontrado');
    }

    // Si se está actualizando el CUIT, validar que no exista otro proveedor con ese CUIT
    if (validatedData.taxId) {
      const normalizedTaxId = validatedData.taxId.replace(/-/g, '');
      if (normalizedTaxId !== existingSupplier.taxId) {
        const duplicateSupplier = await prisma.supplier.findFirst({
          where: {
            companyId,
            taxId: normalizedTaxId,
            id: { not: id },
          },
        });

        if (duplicateSupplier) {
          throw new Error('Ya existe un proveedor con ese CUIT');
        }
      }
    }

    // Actualizar proveedor
    const supplier = await prisma.supplier.update({
      where: { id },
      data: {
        businessName: validatedData.businessName,
        tradeName: validatedData.tradeName,
        taxId: validatedData.taxId ? validatedData.taxId.replace(/-/g, '') : undefined,
        taxCondition: validatedData.taxCondition,
        email: validatedData.email,
        phone: validatedData.phone,
        website: validatedData.website,
        address: validatedData.address,
        city: validatedData.city,
        state: validatedData.state,
        zipCode: validatedData.zipCode,
        country: validatedData.country,
        paymentTermDays: validatedData.paymentTermDays,
        creditLimit: validatedData.creditLimit,
        contactName: validatedData.contactName,
        contactPhone: validatedData.contactPhone,
        contactEmail: validatedData.contactEmail,
        status: validatedData.status,
        notes: validatedData.notes,
      },
    });

    logger.info('Proveedor actualizado', {
      data: { supplierId: supplier.id, companyId, userId },
    });

    revalidatePath('/dashboard/commercial/suppliers');
    revalidatePath(`/dashboard/commercial/suppliers/${id}`);
    revalidatePath('/dashboard');

    return {
      ...supplier,
      creditLimit: supplier.creditLimit ? Number(supplier.creditLimit) : null,
    };
  } catch (error) {
    logger.error('Error al actualizar proveedor', { data: { error, id, data } });
    if (error instanceof Error) {
      throw error;
    }
    throw new Error('Error al actualizar proveedor');
  }
}

/**
 * Cambia el estado de un proveedor
 */
export async function toggleSupplierStatus(id: string): Promise<void> {
  await checkPermission('commercial.suppliers', 'update', { redirect: true });
  try {
    const { userId } = await auth();
    if (!userId) throw new Error('No autenticado');

    const companyId = await getActiveCompanyId();
    if (!companyId) throw new Error('No se encontró empresa activa');

    const supplier = await prisma.supplier.findFirst({
      where: { id, companyId },
    });

    if (!supplier) {
      throw new Error('Proveedor no encontrado');
    }

    const newStatus = supplier.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';

    await prisma.supplier.update({
      where: { id },
      data: { status: newStatus },
    });

    logger.info('Estado de proveedor cambiado', {
      data: { supplierId: id, oldStatus: supplier.status, newStatus, companyId, userId },
    });

    revalidatePath('/dashboard/commercial/suppliers');
    revalidatePath(`/dashboard/commercial/suppliers/${id}`);
  } catch (error) {
    logger.error('Error al cambiar estado de proveedor', { data: { error, id } });
    throw new Error('Error al cambiar estado de proveedor');
  }
}

/**
 * Elimina un proveedor (soft delete cambiando a INACTIVE)
 */
export async function deleteSupplier(id: string): Promise<void> {
  await checkPermission('commercial.suppliers', 'delete', { redirect: true });
  try {
    const { userId } = await auth();
    if (!userId) throw new Error('No autenticado');

    const companyId = await getActiveCompanyId();
    if (!companyId) throw new Error('No se encontró empresa activa');

    const supplier = await prisma.supplier.findFirst({
      where: { id, companyId },
    });

    if (!supplier) {
      throw new Error('Proveedor no encontrado');
    }

    // TODO: En el futuro, validar que no tenga facturas asociadas antes de eliminar

    // Soft delete: cambiar estado a INACTIVE
    await prisma.supplier.update({
      where: { id },
      data: { status: 'INACTIVE' },
    });

    logger.info('Proveedor eliminado', {
      data: { supplierId: id, companyId, userId },
    });

    revalidatePath('/dashboard/commercial/suppliers');
  } catch (error) {
    logger.error('Error al eliminar proveedor', { data: { error, id } });
    throw new Error('Error al eliminar proveedor');
  }
}
