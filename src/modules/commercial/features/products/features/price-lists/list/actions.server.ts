'use server';

import { auth } from '@clerk/nextjs/server';
import { revalidatePath } from 'next/cache';
import { prisma } from '@/shared/lib/prisma';
import { logger } from '@/shared/lib/logger';
import { getActiveCompanyId } from '@/shared/lib/company';
import { checkPermission } from '@/shared/lib/permissions';
import {
  createPriceListSchema,
  updatePriceListSchema,
  createPriceListItemSchema,
  updatePriceListItemSchema,
  type CreatePriceListFormData,
  type UpdatePriceListFormData,
  type CreatePriceListItemFormData,
  type UpdatePriceListItemFormData,
} from '../../../shared/validators';
import type { PriceList, PriceListItem } from '../../../shared/types';

// ============================================
// Price Lists CRUD
// ============================================

interface GetPriceListsParams {
  page?: number;
  pageSize?: number;
  filters?: Record<string, string[]>;
}

export async function getPriceLists(params: GetPriceListsParams = {}) {
  await checkPermission('commercial.price-lists', 'view', { redirect: true });
  const { page = 1, pageSize = 10, filters = {} } = params;
  const { userId } = await auth();
  if (!userId) {
    throw new Error('No autenticado');
  }

  const companyId = await getActiveCompanyId();
  if (!companyId) {
    throw new Error('No se encontró empresa activa');
  }

  try {
    // Filtro de texto para nombre
    const nameFilter = filters['name']?.[0];
    const nameWhere = nameFilter
      ? { name: { contains: nameFilter, mode: 'insensitive' as const } }
      : {};

    // Filtros boolean (isDefault, isActive)
    const booleanFields = ['isDefault', 'isActive'] as const;
    const booleanWhere = booleanFields.reduce<Record<string, boolean>>((acc, field) => {
      const val = filters[field]?.[0];
      if (val === 'true') acc[field] = true;
      else if (val === 'false') acc[field] = false;
      return acc;
    }, {});

    const where = {
      companyId,
      ...nameWhere,
      ...booleanWhere,
    };

    const [priceLists, total] = await Promise.all([
      prisma.priceList.findMany({
        where,
        include: {
          _count: {
            select: { items: true },
          },
        },
        orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.priceList.count({ where }),
    ]);

    return {
      data: priceLists as PriceList[],
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    };
  } catch (error) {
    logger.error('Error al obtener listas de precios', { data: { error } });
    throw new Error('Error al obtener listas de precios');
  }
}

export async function getPriceListById(id: string): Promise<PriceList | null> {
  await checkPermission('commercial.price-lists', 'view', { redirect: true });
  const { userId } = await auth();
  if (!userId) {
    throw new Error('No autenticado');
  }

  const companyId = await getActiveCompanyId();
  if (!companyId) {
    throw new Error('No se encontró empresa activa');
  }

  try {
    const priceList = await prisma.priceList.findFirst({
      where: { id, companyId },
      include: {
        _count: {
          select: { items: true },
        },
      },
    });

    return priceList as PriceList | null;
  } catch (error) {
    logger.error('Error al obtener lista de precios', { data: { error } });
    throw new Error('Error al obtener lista de precios');
  }
}

export async function createPriceList(data: CreatePriceListFormData): Promise<PriceList> {
  await checkPermission('commercial.price-lists', 'create', { redirect: true });
  const { userId } = await auth();
  if (!userId) {
    throw new Error('No autenticado');
  }

  const companyId = await getActiveCompanyId();
  if (!companyId) {
    throw new Error('No se encontró empresa activa');
  }

  const validatedData = createPriceListSchema.parse(data);

  try {
    // Si se marca como default, desmarcar las otras
    if (validatedData.isDefault) {
      await prisma.priceList.updateMany({
        where: { companyId, isDefault: true },
        data: { isDefault: false },
      });
    }

    const priceList = await prisma.priceList.create({
      data: {
        companyId,
        name: validatedData.name,
        description: validatedData.description,
        isDefault: validatedData.isDefault ?? false,
        isActive: validatedData.isActive ?? true,
      },
      include: {
        _count: {
          select: { items: true },
        },
      },
    });

    revalidatePath('/dashboard/commercial/price-lists');
    logger.info('Lista de precios creada', { data: { priceListId: priceList.id } });

    return priceList as PriceList;
  } catch (error) {
    logger.error('Error al crear lista de precios', { data: { error } });
    throw new Error('Error al crear lista de precios');
  }
}

export async function updatePriceList(
  id: string,
  data: UpdatePriceListFormData
): Promise<PriceList> {
  await checkPermission('commercial.price-lists', 'update', { redirect: true });
  const { userId } = await auth();
  if (!userId) {
    throw new Error('No autenticado');
  }

  const companyId = await getActiveCompanyId();
  if (!companyId) {
    throw new Error('No se encontró empresa activa');
  }

  const validatedData = updatePriceListSchema.parse(data);

  try {
    const existing = await prisma.priceList.findFirst({
      where: { id, companyId },
    });

    if (!existing) {
      throw new Error('Lista de precios no encontrada');
    }

    // Si se marca como default, desmarcar las otras
    if (validatedData.isDefault && !existing.isDefault) {
      await prisma.priceList.updateMany({
        where: { companyId, isDefault: true },
        data: { isDefault: false },
      });
    }

    const priceList = await prisma.priceList.update({
      where: { id },
      data: {
        name: validatedData.name,
        description: validatedData.description,
        isDefault: validatedData.isDefault,
        isActive: validatedData.isActive,
      },
      include: {
        _count: {
          select: { items: true },
        },
      },
    });

    revalidatePath('/dashboard/commercial/price-lists');
    logger.info('Lista de precios actualizada', { data: { priceListId: id } });

    return priceList as PriceList;
  } catch (error) {
    logger.error('Error al actualizar lista de precios', { data: { error } });
    throw new Error('Error al actualizar lista de precios');
  }
}

export async function deletePriceList(id: string): Promise<void> {
  await checkPermission('commercial.price-lists', 'delete', { redirect: true });
  const { userId } = await auth();
  if (!userId) {
    throw new Error('No autenticado');
  }

  const companyId = await getActiveCompanyId();
  if (!companyId) {
    throw new Error('No se encontró empresa activa');
  }

  try {
    const existing = await prisma.priceList.findFirst({
      where: { id, companyId },
      include: {
        _count: {
          select: { items: true },
        },
      },
    });

    if (!existing) {
      throw new Error('Lista de precios no encontrada');
    }

    // No permitir eliminar si tiene items
    if (existing._count.items > 0) {
      throw new Error('No se puede eliminar una lista de precios con productos asignados');
    }

    await prisma.priceList.delete({
      where: { id },
    });

    revalidatePath('/dashboard/commercial/price-lists');
    logger.info('Lista de precios eliminada', { data: { priceListId: id } });
  } catch (error) {
    logger.error('Error al eliminar lista de precios', { data: { error } });
    if (error instanceof Error) {
      throw error;
    }
    throw new Error('Error al eliminar lista de precios');
  }
}

export async function setDefaultPriceList(id: string): Promise<void> {
  await checkPermission('commercial.price-lists', 'update', { redirect: true });
  const { userId } = await auth();
  if (!userId) {
    throw new Error('No autenticado');
  }

  const companyId = await getActiveCompanyId();
  if (!companyId) {
    throw new Error('No se encontró empresa activa');
  }

  try {
    const existing = await prisma.priceList.findFirst({
      where: { id, companyId },
    });

    if (!existing) {
      throw new Error('Lista de precios no encontrada');
    }

    // Desmarcar todas las listas como default
    await prisma.priceList.updateMany({
      where: { companyId, isDefault: true },
      data: { isDefault: false },
    });

    // Marcar la lista actual como default
    await prisma.priceList.update({
      where: { id },
      data: { isDefault: true },
    });

    revalidatePath('/dashboard/commercial/price-lists');
    logger.info('Lista de precios marcada como predeterminada', { data: { priceListId: id } });
  } catch (error) {
    logger.error('Error al marcar lista como predeterminada', { data: { error } });
    throw new Error('Error al marcar lista como predeterminada');
  }
}

// ============================================
// Price List Items CRUD
// ============================================

export async function getPriceListItems(priceListId: string): Promise<PriceListItem[]> {
  await checkPermission('commercial.price-lists', 'view', { redirect: true });
  const { userId } = await auth();
  if (!userId) {
    throw new Error('No autenticado');
  }

  const companyId = await getActiveCompanyId();
  if (!companyId) {
    throw new Error('No se encontró empresa activa');
  }

  try {
    // Verificar que la lista pertenece a la empresa
    const priceList = await prisma.priceList.findFirst({
      where: { id: priceListId, companyId },
    });

    if (!priceList) {
      throw new Error('Lista de precios no encontrada');
    }

    const items = await prisma.priceListItem.findMany({
      where: { priceListId },
      include: {
        product: {
          select: {
            id: true,
            code: true,
            name: true,
            vatRate: true,
          },
        },
      },
      orderBy: {
        product: {
          name: 'asc',
        },
      },
    });

    return items.map((item) => ({
      ...item,
      price: Number(item.price),
      priceWithTax: Number(item.priceWithTax),
      product: item.product ? {
        ...item.product,
        vatRate: Number(item.product.vatRate),
      } : undefined,
    })) as PriceListItem[];
  } catch (error) {
    logger.error('Error al obtener items de lista de precios', { data: { error } });
    throw new Error('Error al obtener items de lista de precios');
  }
}

export async function createPriceListItem(
  priceListId: string,
  data: CreatePriceListItemFormData
): Promise<PriceListItem> {
  await checkPermission('commercial.price-lists', 'create', { redirect: true });
  const { userId } = await auth();
  if (!userId) {
    throw new Error('No autenticado');
  }

  const companyId = await getActiveCompanyId();
  if (!companyId) {
    throw new Error('No se encontró empresa activa');
  }

  const validatedData = createPriceListItemSchema.parse(data);

  try {
    // Verificar que la lista pertenece a la empresa
    const priceList = await prisma.priceList.findFirst({
      where: { id: priceListId, companyId },
    });

    if (!priceList) {
      throw new Error('Lista de precios no encontrada');
    }

    // Verificar que el producto existe y pertenece a la empresa
    const product = await prisma.product.findFirst({
      where: { id: validatedData.productId, companyId },
    });

    if (!product) {
      throw new Error('Producto no encontrado');
    }

    // Verificar que el producto no esté ya en la lista
    const existingItem = await prisma.priceListItem.findFirst({
      where: {
        priceListId,
        productId: validatedData.productId,
      },
    });

    if (existingItem) {
      throw new Error('El producto ya está en esta lista de precios');
    }

    // Calcular precio con IVA
    const vatRate = Number(product.vatRate);
    const priceWithTax = validatedData.price * (1 + vatRate / 100);

    const item = await prisma.priceListItem.create({
      data: {
        priceListId,
        productId: validatedData.productId,
        price: validatedData.price,
        priceWithTax,
        updatedBy: userId,
      },
      include: {
        product: {
          select: {
            id: true,
            code: true,
            name: true,
            vatRate: true,
          },
        },
      },
    });

    revalidatePath(`/dashboard/commercial/price-lists/${priceListId}`);
    logger.info('Item agregado a lista de precios', {
      data: { priceListId, productId: validatedData.productId },
    });

    return {
      ...item,
      price: Number(item.price),
      priceWithTax: Number(item.priceWithTax),
      product: item.product ? {
        ...item.product,
        vatRate: Number(item.product.vatRate),
      } : undefined,
    } as PriceListItem;
  } catch (error) {
    logger.error('Error al agregar item a lista de precios', { data: { error } });
    if (error instanceof Error) {
      throw error;
    }
    throw new Error('Error al agregar item a lista de precios');
  }
}

export async function updatePriceListItem(
  id: string,
  data: UpdatePriceListItemFormData
): Promise<PriceListItem> {
  await checkPermission('commercial.price-lists', 'update', { redirect: true });
  const { userId } = await auth();
  if (!userId) {
    throw new Error('No autenticado');
  }

  const companyId = await getActiveCompanyId();
  if (!companyId) {
    throw new Error('No se encontró empresa activa');
  }

  const validatedData = updatePriceListItemSchema.parse(data);

  try {
    // Verificar que el item existe y pertenece a una lista de la empresa
    const existing = await prisma.priceListItem.findFirst({
      where: {
        id,
        priceList: { companyId },
      },
      include: {
        product: true,
      },
    });

    if (!existing) {
      throw new Error('Item no encontrado');
    }

    // Calcular precio con IVA
    const vatRate = Number(existing.product.vatRate);
    const priceWithTax = validatedData.price * (1 + vatRate / 100);

    // Actualizar item y registrar modificación en la lista
    await prisma.priceList.update({
      where: { id: existing.priceListId },
      data: { lastModifiedBy: userId },
    });

    const item = await prisma.priceListItem.update({
      where: { id },
      data: {
        price: validatedData.price,
        priceWithTax,
        updatedBy: userId,
      },
      include: {
        product: {
          select: {
            id: true,
            code: true,
            name: true,
            vatRate: true,
          },
        },
      },
    });

    revalidatePath(`/dashboard/commercial/price-lists/${existing.priceListId}`);
    logger.info('Item de lista de precios actualizado', { data: { itemId: id } });

    return {
      ...item,
      price: Number(item.price),
      priceWithTax: Number(item.priceWithTax),
      product: item.product ? {
        ...item.product,
        vatRate: Number(item.product.vatRate),
      } : undefined,
    } as PriceListItem;
  } catch (error) {
    logger.error('Error al actualizar item de lista de precios', { data: { error } });
    throw new Error('Error al actualizar item de lista de precios');
  }
}

export async function deletePriceListItem(id: string): Promise<void> {
  await checkPermission('commercial.price-lists', 'delete', { redirect: true });
  const { userId } = await auth();
  if (!userId) {
    throw new Error('No autenticado');
  }

  const companyId = await getActiveCompanyId();
  if (!companyId) {
    throw new Error('No se encontró empresa activa');
  }

  try {
    // Verificar que el item existe y pertenece a una lista de la empresa
    const existing = await prisma.priceListItem.findFirst({
      where: {
        id,
        priceList: { companyId },
      },
    });

    if (!existing) {
      throw new Error('Item no encontrado');
    }

    await prisma.priceListItem.delete({
      where: { id },
    });

    revalidatePath(`/dashboard/commercial/price-lists/${existing.priceListId}`);
    logger.info('Item eliminado de lista de precios', { data: { itemId: id } });
  } catch (error) {
    logger.error('Error al eliminar item de lista de precios', { data: { error } });
    throw new Error('Error al eliminar item de lista de precios');
  }
}

export async function bulkDeletePriceListItems(ids: string[]): Promise<number> {
  await checkPermission('commercial.price-lists', 'delete', { redirect: true });
  const { userId } = await auth();
  if (!userId) throw new Error('No autenticado');

  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No se encontró empresa activa');

  try {
    const result = await prisma.priceListItem.deleteMany({
      where: {
        id: { in: ids },
        priceList: { companyId },
      },
    });

    // Obtener priceListId para revalidar (de cualquier item existente antes del delete)
    if (ids.length > 0) {
      revalidatePath('/dashboard/commercial/price-lists');
    }

    logger.info('Eliminación masiva de items de lista de precios', {
      data: { count: result.count, userId },
    });

    return result.count;
  } catch (error) {
    logger.error('Error al eliminar items masivamente', { data: { error } });
    throw new Error('Error al eliminar items de la lista');
  }
}

// ============================================
// CARGA MASIVA DE PRODUCTOS
// ============================================

interface BulkAddInput {
  productIds: string[];
  adjustmentType: 'increase' | 'decrease';
  adjustmentPercent: number;
}

export async function bulkAddPriceListItems(
  priceListId: string,
  data: BulkAddInput
): Promise<{ added: number; skipped: number }> {
  await checkPermission('commercial.price-lists', 'update', { redirect: true });
  const { userId } = await auth();
  if (!userId) throw new Error('No autenticado');

  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No se encontró empresa activa');

  try {
    // Verificar lista
    const priceList = await prisma.priceList.findFirst({
      where: { id: priceListId, companyId },
    });
    if (!priceList) throw new Error('Lista de precios no encontrada');

    // Obtener productos con sus precios y IVA
    const products = await prisma.product.findMany({
      where: { id: { in: data.productIds }, companyId, status: 'ACTIVE' },
      select: { id: true, salePrice: true, vatRate: true },
    });

    // Obtener items ya existentes en la lista
    const existingItems = await prisma.priceListItem.findMany({
      where: { priceListId, productId: { in: data.productIds } },
      select: { productId: true },
    });
    const existingProductIds = new Set(existingItems.map((i) => i.productId));

    // Filtrar productos que no están ya en la lista
    const newProducts = products.filter((p) => !existingProductIds.has(p.id));

    if (newProducts.length === 0) {
      return { added: 0, skipped: data.productIds.length };
    }

    // Calcular factor de ajuste
    const factor = data.adjustmentType === 'increase'
      ? 1 + data.adjustmentPercent / 100
      : 1 - data.adjustmentPercent / 100;

    // Crear items en batch
    const itemsData = newProducts.map((product) => {
      const basePrice = Number(product.salePrice);
      const price = Math.round(basePrice * factor * 100) / 100;
      const vatRate = Number(product.vatRate);
      const priceWithTax = Math.round(price * (1 + vatRate / 100) * 100) / 100;

      return {
        priceListId,
        productId: product.id,
        price,
        priceWithTax,
        updatedBy: userId,
      };
    });

    await prisma.$transaction(async (tx) => {
      await tx.priceListItem.createMany({ data: itemsData });
      await tx.priceList.update({
        where: { id: priceListId },
        data: { lastModifiedBy: userId },
      });
    });

    revalidatePath(`/dashboard/commercial/price-lists/${priceListId}`);
    logger.info('Carga masiva de productos en lista de precios', {
      data: { priceListId, added: newProducts.length, skipped: existingProductIds.size },
    });

    return { added: newProducts.length, skipped: existingProductIds.size };
  } catch (error) {
    logger.error('Error en carga masiva de lista de precios', { data: { error } });
    if (error instanceof Error) throw error;
    throw new Error('Error al agregar productos masivamente');
  }
}
