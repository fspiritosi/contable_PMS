'use server';

import { z } from 'zod';

import { prisma } from '@/shared/lib/prisma';
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

const discountPresetSchema = z.object({
  name: z.string().min(2, 'El nombre debe tener al menos 2 caracteres'),
  percentage: z.coerce
    .number()
    .min(0.01, 'El porcentaje debe ser mayor a 0')
    .max(100, 'El porcentaje no puede superar 100'),
  isActive: z.boolean().optional(),
});

// ============================================
// TIPOS
// ============================================

export type CreateDiscountPresetInput = z.infer<typeof discountPresetSchema>;

// ============================================
// QUERIES
// ============================================

/**
 * Obtiene descuentos predefinidos con paginación server-side para DataTable
 */
export async function getDiscountPresetsPaginated(searchParams: DataTableSearchParams) {
  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');
  await checkPermission('company.discount-presets', 'view', { redirect: true });

  try {
    const state = parseSearchParams(searchParams);
    const { skip, take, orderBy } = stateToPrismaParams(state);

    const searchWhere = buildSearchWhere(state.search, ['name']);

    const where = {
      companyId,
      ...searchWhere,
    };

    const [data, total] = await Promise.all([
      prisma.discountPreset.findMany({
        where,
        skip,
        take,
        orderBy: orderBy || { name: 'asc' },
      }),
      prisma.discountPreset.count({ where }),
    ]);

    return {
      data: data.map((item) => ({
        ...item,
        percentage: Number(item.percentage),
      })),
      total,
    };
  } catch (error) {
    logger.error('Error al obtener descuentos predefinidos paginados', {
      data: { error, companyId },
    });
    throw new Error('Error al obtener descuentos predefinidos');
  }
}

/**
 * Obtiene descuentos predefinidos activos para selects (dropdowns en facturas)
 */
export async function getDiscountPresetsForSelect() {
  const companyId = await getActiveCompanyId();
  if (!companyId) return [];

  try {
    const presets = await prisma.discountPreset.findMany({
      where: {
        companyId,
        isActive: true,
      },
      select: {
        id: true,
        name: true,
        percentage: true,
      },
      orderBy: { name: 'asc' },
    });

    return presets.map((item) => ({
      ...item,
      percentage: Number(item.percentage),
    }));
  } catch (error) {
    logger.error('Error al obtener descuentos predefinidos para select', { data: { error } });
    return [];
  }
}

// ============================================
// MUTATIONS
// ============================================

/**
 * Crea un nuevo descuento predefinido
 */
export async function createDiscountPreset(input: CreateDiscountPresetInput) {
  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');
  await checkPermission('company.discount-presets', 'create', { redirect: true });

  const parsed = discountPresetSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(
      parsed.error.issues.map((e: { message: string }) => e.message).join(', ')
    );
  }

  try {
    const preset = await prisma.discountPreset.create({
      data: {
        name: parsed.data.name,
        percentage: parsed.data.percentage,
        companyId,
      },
    });

    logger.info('Descuento predefinido creado', { data: { id: preset.id, companyId } });
    revalidatePath('/dashboard/company/discount-presets');

    return { ...preset, percentage: Number(preset.percentage) };
  } catch (error) {
    logger.error('Error al crear descuento predefinido', { data: { error, companyId } });
    throw new Error('Error al crear descuento predefinido');
  }
}

/**
 * Actualiza un descuento predefinido
 */
export async function updateDiscountPreset(id: string, input: CreateDiscountPresetInput) {
  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');
  await checkPermission('company.discount-presets', 'update', { redirect: true });

  const parsed = discountPresetSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(
      parsed.error.issues.map((e: { message: string }) => e.message).join(', ')
    );
  }

  try {
    const existing = await prisma.discountPreset.findFirst({
      where: { id, companyId },
      select: { id: true },
    });

    if (!existing) {
      throw new Error('Descuento predefinido no encontrado');
    }

    const preset = await prisma.discountPreset.update({
      where: { id },
      data: {
        name: parsed.data.name,
        percentage: parsed.data.percentage,
        isActive: parsed.data.isActive ?? true,
      },
    });

    logger.info('Descuento predefinido actualizado', { data: { id, companyId } });
    revalidatePath('/dashboard/company/discount-presets');

    return { ...preset, percentage: Number(preset.percentage) };
  } catch (error) {
    logger.error('Error al actualizar descuento predefinido', { data: { error, id } });
    throw error;
  }
}

/**
 * Elimina un descuento predefinido (hard delete)
 */
export async function deleteDiscountPreset(id: string) {
  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');
  await checkPermission('company.discount-presets', 'delete', { redirect: true });

  try {
    const existing = await prisma.discountPreset.findFirst({
      where: { id, companyId },
    });

    if (!existing) {
      throw new Error('Descuento predefinido no encontrado');
    }

    await prisma.discountPreset.delete({
      where: { id },
    });

    logger.info('Descuento predefinido eliminado', { data: { id, companyId } });
    revalidatePath('/dashboard/company/discount-presets');

    return { success: true };
  } catch (error) {
    logger.error('Error al eliminar descuento predefinido', { data: { error, id } });
    throw error;
  }
}

// ============================================
// TIPOS INFERIDOS
// ============================================

export type DiscountPresetListItem = Awaited<
  ReturnType<typeof getDiscountPresetsPaginated>
>['data'][number];
export type DiscountPresetOption = Awaited<
  ReturnType<typeof getDiscountPresetsForSelect>
>[number];
