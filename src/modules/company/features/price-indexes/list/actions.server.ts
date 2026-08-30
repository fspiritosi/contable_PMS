'use server';

import { z } from 'zod';

import { prisma } from '@/shared/lib/prisma';
import { Prisma } from '@/generated/prisma/client';
import { logger } from '@/shared/lib/logger';
import { revalidatePath } from 'next/cache';
import { getActiveCompanyId } from '@/shared/lib/company';
import { checkPermission } from '@/shared/lib/permissions';
import type { DataTableSearchParams } from '@/shared/components/common/DataTable';
import {
  buildSearchWhere,
  parseSearchParams,
  stateToPrismaParams,
} from '@/shared/components/common/DataTable/helpers';

// ============================================
// SCHEMA
// ============================================

const priceIndexSchema = z.object({
  name: z.string().min(2, 'El nombre debe tener al menos 2 caracteres'),
  description: z.string().optional(),
  isActive: z.boolean().optional(),
});

// ============================================
// TIPOS
// ============================================

export type PriceIndexInput = z.infer<typeof priceIndexSchema>;

// ============================================
// QUERIES
// ============================================

/**
 * Obtiene índices de precios con paginación server-side para DataTable
 */
export async function getPriceIndexesPaginated(searchParams: DataTableSearchParams) {
  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');
  await checkPermission('company.price-indexes', 'view', { redirect: true });

  try {
    const state = parseSearchParams(searchParams);
    const { skip, take, orderBy } = stateToPrismaParams(state);

    const searchWhere = buildSearchWhere(state.search, ['name']);

    const where = {
      companyId,
      ...searchWhere,
    };

    const [data, total] = await Promise.all([
      prisma.priceIndex.findMany({
        where,
        skip,
        take,
        orderBy: orderBy || { name: 'asc' },
        include: {
          _count: {
            select: { values: true },
          },
        },
      }),
      prisma.priceIndex.count({ where }),
    ]);

    return { data, total };
  } catch (error) {
    logger.error('Error al obtener índices de precios paginados', {
      data: { error, companyId },
    });
    throw new Error('Error al obtener índices de precios');
  }
}

// ============================================
// MUTATIONS
// ============================================

/**
 * Crea un nuevo índice de precios
 */
export async function createPriceIndex(input: PriceIndexInput) {
  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');
  await checkPermission('company.price-indexes', 'create', { redirect: true });

  const parsed = priceIndexSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(parsed.error.issues.map((e: { message: string }) => e.message).join(', '));
  }

  try {
    const index = await prisma.priceIndex.create({
      data: {
        name: parsed.data.name,
        description: parsed.data.description || null,
        companyId,
      },
    });

    logger.info('Índice de precios creado', { data: { id: index.id, companyId } });
    revalidatePath('/dashboard/company/price-indexes');

    return index;
  } catch (error) {
    logger.error('Error al crear índice de precios', { data: { error, companyId } });
    throw new Error('Error al crear índice de precios');
  }
}

/**
 * Actualiza un índice de precios
 */
export async function updatePriceIndex(id: string, input: PriceIndexInput) {
  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');
  await checkPermission('company.price-indexes', 'update', { redirect: true });

  const parsed = priceIndexSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(parsed.error.issues.map((e: { message: string }) => e.message).join(', '));
  }

  try {
    const existing = await prisma.priceIndex.findFirst({
      where: { id, companyId },
      select: { id: true },
    });

    if (!existing) {
      throw new Error('Índice de precios no encontrado');
    }

    const index = await prisma.priceIndex.update({
      where: { id },
      data: {
        name: parsed.data.name,
        description: parsed.data.description || null,
        isActive: parsed.data.isActive ?? true,
      },
    });

    logger.info('Índice de precios actualizado', { data: { id, companyId } });
    revalidatePath('/dashboard/company/price-indexes');

    return index;
  } catch (error) {
    logger.error('Error al actualizar índice de precios', { data: { error, id } });
    throw error;
  }
}

/**
 * Elimina un índice de precios (hard delete)
 *
 * Las FK de price_list_adjustments hacia el índice están en ON DELETE RESTRICT:
 * si el índice ya se aplicó a alguna lista de precios, Prisma rechaza el borrado
 * (P2003) para proteger el historial de ajustes. Ese rechazo es correcto y se
 * traduce a un mensaje entendible en vez de dejarlo salir como error crudo.
 */
export async function deletePriceIndex(id: string) {
  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');
  await checkPermission('company.price-indexes', 'delete', { redirect: true });

  try {
    const existing = await prisma.priceIndex.findFirst({
      where: { id, companyId },
    });

    if (!existing) {
      throw new Error('Índice de precios no encontrado');
    }

    await prisma.priceIndex.delete({
      where: { id },
    });

    logger.info('Índice de precios eliminado', { data: { id, companyId } });
    revalidatePath('/dashboard/company/price-indexes');

    return { success: true };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') {
      throw new Error(
        'No se puede eliminar: el índice ya se aplicó a una o más listas de precios'
      );
    }
    logger.error('Error al eliminar índice de precios', { data: { error, id } });
    throw error;
  }
}

// ============================================
// TIPOS INFERIDOS
// ============================================

export type PriceIndexListItem = Awaited<
  ReturnType<typeof getPriceIndexesPaginated>
>['data'][number];
