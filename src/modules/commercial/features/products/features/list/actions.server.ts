'use server';

import { auth } from '@clerk/nextjs/server';
import { prisma } from '@/shared/lib/prisma';
import { logger } from '@/shared/lib/logger';
import { getActiveCompanyId } from '@/shared/lib/company';
import { checkPermission } from '@/shared/lib/permissions';
import { revalidatePath } from 'next/cache';
import { buildFiltersWhere } from '@/shared/components/common/DataTable/helpers';
import {
  createProductSchema,
  updateProductSchema,
  type CreateProductFormData,
  type UpdateProductFormData,
} from '../../shared/validators';
import type { Product } from '../../shared/types';

interface GetProductsParams {
  page?: number;
  pageSize?: number;
  search?: string;
  filters?: Record<string, string[]>;
}

/**
 * Obtiene el listado de productos con paginación
 */
export async function getProducts(params: GetProductsParams = {}) {
  await checkPermission('commercial.products', 'view', { redirect: true });
  const { page = 1, pageSize = 10, search, filters = {} } = params;
  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    const { userId } = await auth();
    if (!userId) throw new Error('No autenticado');

    const filtersWhere = buildFiltersWhere(filters, {
      type: 'type',
      status: 'status',
    });

    const where = {
      companyId,
      ...filtersWhere,
      ...(search && {
        OR: [
          { name: { contains: search, mode: 'insensitive' as const } },
          { code: { contains: search, mode: 'insensitive' as const } },
          { description: { contains: search, mode: 'insensitive' as const } },
          { barcode: { contains: search, mode: 'insensitive' as const } },
        ],
      }),
    };

    const [products, total] = await Promise.all([
      prisma.product.findMany({
        where,
        include: {
          category: { select: { id: true, name: true } },
        },
        orderBy: [{ status: 'asc' }, { name: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.product.count({ where }),
    ]);

    const data = products.map((product) => ({
      ...product,
      costPrice: Number(product.costPrice),
      salePrice: Number(product.salePrice),
      salePriceWithTax: Number(product.salePriceWithTax),
      vatRate: Number(product.vatRate),
      minStock: product.minStock ? Number(product.minStock) : null,
      maxStock: product.maxStock ? Number(product.maxStock) : null,
    })) as unknown as Product[];

    return {
      data,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    };
  } catch (error) {
    logger.error('Error al obtener productos', { data: { error } });
    throw new Error('Error al obtener productos');
  }
}

/**
 * Obtiene un producto por ID
 */
export async function getProductById(id: string): Promise<Product | null> {
  await checkPermission('commercial.products', 'view', { redirect: true });
  try {
    const { userId } = await auth();
    if (!userId) throw new Error('No autenticado');

    const companyId = await getActiveCompanyId();
    if (!companyId) throw new Error('No se encontró empresa activa');

    const product = await prisma.product.findFirst({
      where: { id, companyId },
      include: {
        category: { select: { id: true, name: true } },
      },
    });

    if (!product) return null;

    return {
      ...product,
      costPrice: Number(product.costPrice),
      salePrice: Number(product.salePrice),
      salePriceWithTax: Number(product.salePriceWithTax),
      vatRate: Number(product.vatRate),
      minStock: product.minStock ? Number(product.minStock) : null,
      maxStock: product.maxStock ? Number(product.maxStock) : null,
    } as unknown as Product;
  } catch (error) {
    logger.error('Error al obtener producto', { data: { error, id } });
    throw new Error('Error al obtener producto');
  }
}

/**
 * Crea un nuevo producto
 */
export async function createProduct(data: CreateProductFormData): Promise<Product> {
  await checkPermission('commercial.products', 'create', { redirect: true });
  try {
    const { userId } = await auth();
    if (!userId) throw new Error('No autenticado');

    const companyId = await getActiveCompanyId();
    if (!companyId) throw new Error('No se encontró empresa activa');

    const validatedData = createProductSchema.parse(data);

    // Generar código automático (PROD-001, PROD-002, etc.)
    const lastProduct = await prisma.product.findFirst({
      where: { companyId },
      orderBy: { code: 'desc' },
      select: { code: true },
    });

    let nextNumber = 1;
    if (lastProduct && lastProduct.code.startsWith('PROD-')) {
      const lastNumber = parseInt(lastProduct.code.split('-')[1]);
      if (!isNaN(lastNumber)) {
        nextNumber = lastNumber + 1;
      }
    }
    const code = `PROD-${nextNumber.toString().padStart(4, '0')}`;

    // Calcular precio con IVA
    const vatRate = validatedData.vatRate || 21;
    const salePriceWithTax = validatedData.salePrice * (1 + vatRate / 100);

    const product = await prisma.product.create({
      data: {
        companyId,
        code,
        name: validatedData.name,
        description: validatedData.description,
        type: validatedData.type,
        categoryId: validatedData.categoryId,
        unitOfMeasure: validatedData.unitOfMeasure || 'UN',
        costPrice: validatedData.costPrice,
        salePrice: validatedData.salePrice,
        salePriceWithTax,
        vatRate,
        trackStock: validatedData.trackStock !== false,
        minStock: validatedData.minStock || 0,
        maxStock: validatedData.maxStock,
        barcode: validatedData.barcode,
        internalCode: validatedData.internalCode,
        brand: validatedData.brand,
        model: validatedData.model,
        createdBy: userId,
      },
      include: {
        category: { select: { id: true, name: true } },
      },
    });

    logger.info('Producto creado', {
      data: { productId: product.id, code: product.code, companyId },
    });

    revalidatePath('/dashboard/commercial/products');

    return {
      ...product,
      costPrice: Number(product.costPrice),
      salePrice: Number(product.salePrice),
      salePriceWithTax: Number(product.salePriceWithTax),
      vatRate: Number(product.vatRate),
      minStock: product.minStock ? Number(product.minStock) : null,
      maxStock: product.maxStock ? Number(product.maxStock) : null,
    } as unknown as Product;
  } catch (error) {
    logger.error('Error al crear producto', { data: { error, data } });
    if (error instanceof Error) {
      throw error;
    }
    throw new Error('Error al crear producto');
  }
}

/**
 * Actualiza un producto
 */
export async function updateProduct(
  id: string,
  data: UpdateProductFormData
): Promise<Product> {
  await checkPermission('commercial.products', 'update', { redirect: true });
  try {
    const { userId } = await auth();
    if (!userId) throw new Error('No autenticado');

    const companyId = await getActiveCompanyId();
    if (!companyId) throw new Error('No se encontró empresa activa');

    const validatedData = updateProductSchema.parse(data);

    const existing = await prisma.product.findFirst({
      where: { id, companyId },
    });

    if (!existing) {
      throw new Error('Producto no encontrado');
    }

    // Calcular precio con IVA si cambió el precio o el IVA
    let salePriceWithTax = Number(existing.salePriceWithTax);
    if (validatedData.salePrice !== undefined || validatedData.vatRate !== undefined) {
      const salePrice = validatedData.salePrice ?? Number(existing.salePrice);
      const vatRate = validatedData.vatRate ?? Number(existing.vatRate);
      salePriceWithTax = salePrice * (1 + vatRate / 100);
    }

    const product = await prisma.product.update({
      where: { id },
      data: {
        name: validatedData.name,
        description: validatedData.description,
        type: validatedData.type,
        categoryId: validatedData.categoryId,
        unitOfMeasure: validatedData.unitOfMeasure,
        costPrice: validatedData.costPrice,
        salePrice: validatedData.salePrice,
        salePriceWithTax,
        vatRate: validatedData.vatRate,
        trackStock: validatedData.trackStock,
        minStock: validatedData.minStock || 0,
        maxStock: validatedData.maxStock,
        barcode: validatedData.barcode,
        internalCode: validatedData.internalCode,
        brand: validatedData.brand,
        model: validatedData.model,
        status: validatedData.status,
      },
      include: {
        category: { select: { id: true, name: true } },
      },
    });

    logger.info('Producto actualizado', {
      data: { productId: id, companyId, userId },
    });

    revalidatePath('/dashboard/commercial/products');
    revalidatePath(`/dashboard/commercial/products/${id}`);

    return {
      ...product,
      costPrice: Number(product.costPrice),
      salePrice: Number(product.salePrice),
      salePriceWithTax: Number(product.salePriceWithTax),
      vatRate: Number(product.vatRate),
      minStock: product.minStock ? Number(product.minStock) : null,
      maxStock: product.maxStock ? Number(product.maxStock) : null,
    } as unknown as Product;
  } catch (error) {
    logger.error('Error al actualizar producto', { data: { error, id, data } });
    if (error instanceof Error) {
      throw error;
    }
    throw new Error('Error al actualizar producto');
  }
}

/**
 * Elimina un producto (soft delete cambiando a INACTIVE)
 */
export async function deleteProduct(id: string): Promise<void> {
  await checkPermission('commercial.products', 'delete', { redirect: true });
  try {
    const { userId } = await auth();
    if (!userId) throw new Error('No autenticado');

    const companyId = await getActiveCompanyId();
    if (!companyId) throw new Error('No se encontró empresa activa');

    const product = await prisma.product.findFirst({
      where: { id, companyId },
    });

    if (!product) {
      throw new Error('Producto no encontrado');
    }

    // Soft delete
    await prisma.product.update({
      where: { id },
      data: { status: 'INACTIVE' },
    });

    logger.info('Producto eliminado', {
      data: { productId: id, companyId, userId },
    });

    revalidatePath('/dashboard/commercial/products');
  } catch (error) {
    logger.error('Error al eliminar producto', { data: { error, id } });
    throw new Error('Error al eliminar producto');
  }
}
