'use server';

import { z } from 'zod';

import { Prisma } from '@/generated/prisma/client';
import { getActiveCompanyId } from '@/shared/lib/company';
import { logger } from '@/shared/lib/logger';
import { checkPermission } from '@/shared/lib/permissions';
import { prisma } from '@/shared/lib/prisma';
import { toPeriodStart } from '@/shared/utils/period';
import { revalidatePath } from 'next/cache';

// ============================================
// SCHEMA
// ============================================

const priceIndexValueSchema = z.object({
  period: z.date(),
  percentage: z.number(),
});

const updatePriceIndexValueSchema = z.object({
  percentage: z.number(),
});

// ============================================
// TIPOS
// ============================================

export type PriceIndexValueInput = z.infer<typeof priceIndexValueSchema>;
export type UpdatePriceIndexValueInput = z.infer<typeof updatePriceIndexValueSchema>;

// ============================================
// QUERIES
// ============================================

/**
 * Obtiene un índice de precios con sus valores por período, ordenados del
 * más reciente al más viejo.
 */
export async function getPriceIndexWithValues(indexId: string) {
  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');
  await checkPermission('company.price-indexes', 'view', { redirect: true });

  try {
    const index = await prisma.priceIndex.findFirst({
      where: { id: indexId, companyId },
      include: {
        values: {
          orderBy: { period: 'desc' },
        },
      },
    });

    if (!index) {
      return null;
    }

    return {
      ...index,
      values: index.values.map((value) => ({
        ...value,
        percentage: Number(value.percentage),
      })),
    };
  } catch (error) {
    logger.error('Error al obtener índice de precios con sus valores', {
      data: { error, indexId, companyId },
    });
    throw new Error('Error al obtener índice de precios');
  }
}

// ============================================
// TIPOS INFERIDOS
// ============================================

export type PriceIndexWithValues = NonNullable<
  Awaited<ReturnType<typeof getPriceIndexWithValues>>
>;
export type PriceIndexValueItem = PriceIndexWithValues['values'][number];

// ============================================
// MUTATIONS
// ============================================

/**
 * Crea el valor de un índice para un período (mes/año). El período se
 * normaliza siempre al día 1 del mes para que el unique `(indexId, period)`
 * impida cargar dos veces el mismo mes.
 */
export async function createPriceIndexValue(indexId: string, input: PriceIndexValueInput) {
  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');
  await checkPermission('company.price-indexes', 'create', { redirect: true });

  const parsed = priceIndexValueSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(parsed.error.issues.map((e) => e.message).join(', '));
  }

  try {
    const index = await prisma.priceIndex.findFirst({
      where: { id: indexId, companyId },
      select: { id: true },
    });

    if (!index) {
      throw new Error('Índice de precios no encontrado');
    }

    const period = toPeriodStart(parsed.data.period);

    const value = await prisma.priceIndexValue.create({
      data: {
        indexId,
        period,
        percentage: parsed.data.percentage,
      },
    });

    logger.info('Valor de índice de precios creado', { data: { indexId, period } });
    revalidatePath(`/dashboard/company/price-indexes/${indexId}`);

    return { ...value, percentage: Number(value.percentage) };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new Error('Ya hay un valor cargado para ese período');
    }
    logger.error('Error al crear valor de índice de precios', {
      data: { error, indexId },
    });
    throw error;
  }
}

/**
 * Actualiza el porcentaje de un valor de índice ya cargado.
 */
export async function updatePriceIndexValue(
  valueId: string,
  input: UpdatePriceIndexValueInput
) {
  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');
  await checkPermission('company.price-indexes', 'update', { redirect: true });

  const parsed = updatePriceIndexValueSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(parsed.error.issues.map((e) => e.message).join(', '));
  }

  try {
    const existing = await prisma.priceIndexValue.findFirst({
      where: { id: valueId, index: { companyId } },
      select: { id: true, indexId: true },
    });

    if (!existing) {
      throw new Error('Valor de índice no encontrado');
    }

    const value = await prisma.priceIndexValue.update({
      where: { id: valueId },
      data: { percentage: parsed.data.percentage },
    });

    logger.info('Valor de índice de precios actualizado', { data: { valueId } });
    revalidatePath(`/dashboard/company/price-indexes/${existing.indexId}`);

    return { ...value, percentage: Number(value.percentage) };
  } catch (error) {
    logger.error('Error al actualizar valor de índice de precios', {
      data: { error, valueId },
    });
    throw error;
  }
}

/**
 * Elimina el valor de un índice para un período.
 */
export async function deletePriceIndexValue(valueId: string) {
  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');
  await checkPermission('company.price-indexes', 'delete', { redirect: true });

  try {
    const existing = await prisma.priceIndexValue.findFirst({
      where: { id: valueId, index: { companyId } },
      select: { id: true, indexId: true },
    });

    if (!existing) {
      throw new Error('Valor de índice no encontrado');
    }

    await prisma.priceIndexValue.delete({ where: { id: valueId } });

    logger.info('Valor de índice de precios eliminado', { data: { valueId } });
    revalidatePath(`/dashboard/company/price-indexes/${existing.indexId}`);

    return { success: true };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') {
      throw new Error(
        'No se puede eliminar: el valor ya se aplicó a una o más listas de precios'
      );
    }
    logger.error('Error al eliminar valor de índice de precios', {
      data: { error, valueId },
    });
    throw error;
  }
}
