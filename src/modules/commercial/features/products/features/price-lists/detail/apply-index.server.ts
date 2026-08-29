'use server';

import { revalidatePath } from 'next/cache';

import { getCurrentUserId } from '@/shared/lib/current-user';
import { getActiveCompanyId } from '@/shared/lib/company';
import { checkPermission } from '@/shared/lib/permissions';
import { logger } from '@/shared/lib/logger';
import { prisma } from '@/shared/lib/prisma';

import { adjustItems, findPreviousApplication, type AdjustableItem } from '../shared/price-index-calc';

// ============================================
// TIPOS
// ============================================

/** Un índice activo con al menos un valor cargado, listo para elegir en el selector. */
export interface ApplicablePriceIndex {
  id: string;
  name: string;
  values: Array<{
    id: string;
    period: Date;
    percentage: number;
  }>;
}

/** Una fila de la vista previa: precio actual contra el que quedaría. */
export interface PreviewItem {
  id: string;
  productName: string;
  currentPrice: number;
  newPrice: number;
}

export interface PreviewPriceIndexApplicationResult {
  percentage: number;
  previousApplication: {
    indexId: string;
    indexValueId: string;
    appliedAt: Date;
    appliedByName: string;
  } | null;
  items: PreviewItem[];
}

export interface ApplyPriceIndexResult {
  percentage: number;
  itemsAffected: number;
  appliedAt: Date;
}

/** Una aplicación de índice ya registrada, para el historial de la lista. */
export interface PriceListAdjustmentHistoryItem {
  id: string;
  indexName: string;
  period: Date;
  percentage: number;
  itemsAffected: number;
  appliedAt: Date;
  appliedByName: string;
}

// ============================================
// HELPERS INTERNOS
// ============================================

/**
 * Resuelve ids de usuario a un nombre para mostrar. `appliedBy` guarda el id
 * crudo del usuario sin FK, así que hay que ir a buscarlo: si tiene nombre se
 * usa el nombre, si no el email, y si el id no resuelve a nadie (usuario
 * borrado, dato viejo) se muestra algo neutro en vez de un uuid o de romper.
 */
async function resolveAppliedByNames(userIds: Array<string | null>): Promise<Map<string, string>> {
  const ids = [...new Set(userIds.filter((id): id is string => Boolean(id)))];
  if (ids.length === 0) {
    return new Map();
  }

  const users = await prisma.user.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true, email: true },
  });

  return new Map(users.map((user) => [user.id, user.name?.trim() || user.email]));
}

/**
 * Trae los ítems de la lista con lo necesario para ajustar (precio e IVA del
 * producto) y para mostrar (nombre del producto).
 */
async function getItemsForAdjustment(priceListId: string) {
  return prisma.priceListItem.findMany({
    where: { priceListId },
    select: {
      id: true,
      price: true,
      product: {
        select: { name: true, vatRate: true },
      },
    },
    orderBy: { product: { name: 'asc' } },
  });
}

// ============================================
// QUERIES
// ============================================

/**
 * Índices activos de la empresa que tengan al menos un valor cargado. Un
 * índice sin valores no se puede aplicar, así que no tiene sentido mostrarlo
 * en el selector.
 */
export async function getApplicablePriceIndexes(): Promise<ApplicablePriceIndex[]> {
  await checkPermission('commercial.price-lists', 'view', { redirect: true });

  const companyId = await getActiveCompanyId();
  if (!companyId) {
    throw new Error('No se encontró empresa activa');
  }

  try {
    const indexes = await prisma.priceIndex.findMany({
      where: { companyId, isActive: true, values: { some: {} } },
      select: {
        id: true,
        name: true,
        values: {
          orderBy: { period: 'desc' },
          select: { id: true, period: true, percentage: true },
        },
      },
      orderBy: { name: 'asc' },
    });

    return indexes.map((index) => ({
      id: index.id,
      name: index.name,
      values: index.values.map((value) => ({
        id: value.id,
        period: value.period,
        percentage: Number(value.percentage),
      })),
    }));
  } catch (error) {
    logger.error('Error al obtener índices de precios aplicables', {
      data: { error, companyId },
    });
    throw new Error('Error al obtener índices de precios aplicables');
  }
}

/**
 * Calcula qué precio quedaría cada ítem de la lista si se aplicara el valor
 * de índice indicado, sin tocar la base. También avisa si ese mismo valor ya
 * se aplicó antes, para no duplicar el aumento por error.
 */
export async function previewPriceIndexApplication(
  priceListId: string,
  indexValueId: string
): Promise<PreviewPriceIndexApplicationResult> {
  await checkPermission('commercial.price-lists', 'update', { redirect: true });

  const companyId = await getActiveCompanyId();
  if (!companyId) {
    throw new Error('No se encontró empresa activa');
  }

  try {
    const priceList = await prisma.priceList.findFirst({
      where: { id: priceListId, companyId },
      select: { id: true },
    });
    if (!priceList) {
      throw new Error('Lista de precios no encontrada');
    }

    const indexValue = await prisma.priceIndexValue.findFirst({
      where: { id: indexValueId, index: { companyId } },
      select: { id: true, indexId: true, percentage: true },
    });
    if (!indexValue) {
      throw new Error('Valor de índice no encontrado');
    }

    const percentage = Number(indexValue.percentage);

    const rawItems = await getItemsForAdjustment(priceListId);

    const adjustableItems: AdjustableItem[] = rawItems.map((item) => ({
      id: item.id,
      price: Number(item.price),
      vatRate: Number(item.product.vatRate),
    }));

    const adjusted = adjustItems(adjustableItems, percentage);
    const adjustedById = new Map(adjusted.map((item) => [item.id, item]));

    const items: PreviewItem[] = rawItems.map((item) => ({
      id: item.id,
      productName: item.product.name,
      currentPrice: Number(item.price),
      newPrice: adjustedById.get(item.id)?.price ?? Number(item.price),
    }));

    const history = await prisma.priceListAdjustment.findMany({
      where: { priceListId },
      select: { indexId: true, indexValueId: true, appliedAt: true, appliedBy: true },
    });

    const previous = findPreviousApplication(history, indexValueId);

    let previousApplication: PreviewPriceIndexApplicationResult['previousApplication'] = null;
    if (previous) {
      const namesById = await resolveAppliedByNames([previous.appliedBy]);
      previousApplication = {
        indexId: previous.indexId,
        indexValueId: previous.indexValueId,
        appliedAt: previous.appliedAt,
        appliedByName:
          (previous.appliedBy ? namesById.get(previous.appliedBy) : undefined) ?? 'Usuario desconocido',
      };
    }

    return { percentage, previousApplication, items };
  } catch (error) {
    logger.error('Error al calcular la vista previa del ajuste por indice', {
      data: { error, priceListId, indexValueId },
    });
    if (error instanceof Error) {
      throw error;
    }
    throw new Error('Error al calcular la vista previa del ajuste por indice');
  }
}

/**
 * Historial de aplicaciones de índice sobre una lista de precios, más
 * reciente primero. Es lo que responde "¿por qué subió este precio?".
 */
export async function getPriceListAdjustments(
  priceListId: string
): Promise<PriceListAdjustmentHistoryItem[]> {
  await checkPermission('commercial.price-lists', 'view', { redirect: true });

  const companyId = await getActiveCompanyId();
  if (!companyId) {
    throw new Error('No se encontró empresa activa');
  }

  try {
    const priceList = await prisma.priceList.findFirst({
      where: { id: priceListId, companyId },
      select: { id: true },
    });
    if (!priceList) {
      throw new Error('Lista de precios no encontrada');
    }

    const adjustments = await prisma.priceListAdjustment.findMany({
      where: { priceListId },
      orderBy: { appliedAt: 'desc' },
      select: {
        id: true,
        percentage: true,
        itemsAffected: true,
        appliedAt: true,
        appliedBy: true,
        index: { select: { name: true } },
        indexValue: { select: { period: true } },
      },
    });

    const namesById = await resolveAppliedByNames(adjustments.map((a) => a.appliedBy));

    return adjustments.map((adjustment) => ({
      id: adjustment.id,
      indexName: adjustment.index.name,
      period: adjustment.indexValue.period,
      percentage: Number(adjustment.percentage),
      itemsAffected: adjustment.itemsAffected,
      appliedAt: adjustment.appliedAt,
      appliedByName:
        (adjustment.appliedBy ? namesById.get(adjustment.appliedBy) : undefined) ??
        'Usuario desconocido',
    }));
  } catch (error) {
    logger.error('Error al obtener el historial de ajustes de la lista de precios', {
      data: { error, priceListId },
    });
    if (error instanceof Error) {
      throw error;
    }
    throw new Error('Error al obtener el historial de ajustes de la lista de precios');
  }
}

// ============================================
// MUTATIONS
// ============================================

/**
 * Aplica el valor de índice a todos los ítems de la lista y registra el
 * ajuste en el historial. Todo o nada: si algo falla, ningún precio cambia.
 */
export async function applyPriceIndexToList(
  priceListId: string,
  indexValueId: string
): Promise<ApplyPriceIndexResult> {
  await checkPermission('commercial.price-lists', 'update', { redirect: true });

  const userId = await getCurrentUserId();
  const companyId = await getActiveCompanyId();
  if (!companyId) {
    throw new Error('No se encontró empresa activa');
  }

  try {
    const priceList = await prisma.priceList.findFirst({
      where: { id: priceListId, companyId },
      select: { id: true },
    });
    if (!priceList) {
      throw new Error('Lista de precios no encontrada');
    }

    const indexValue = await prisma.priceIndexValue.findFirst({
      where: { id: indexValueId, index: { companyId } },
      select: { id: true, indexId: true, percentage: true },
    });
    if (!indexValue) {
      throw new Error('Valor de índice no encontrado');
    }

    const rawItems = await getItemsForAdjustment(priceListId);
    if (rawItems.length === 0) {
      throw new Error('La lista no tiene ítems para actualizar');
    }

    const percentage = Number(indexValue.percentage);

    const adjustableItems: AdjustableItem[] = rawItems.map((item) => ({
      id: item.id,
      price: Number(item.price),
      vatRate: Number(item.product.vatRate),
    }));

    const adjusted = adjustItems(adjustableItems, percentage);

    const adjustment = await prisma.$transaction(async (tx) => {
      await Promise.all(
        adjusted.map((item) =>
          tx.priceListItem.update({
            where: { id: item.id },
            data: {
              price: item.price,
              priceWithTax: item.priceWithTax,
              updatedBy: userId,
            },
          })
        )
      );

      await tx.priceList.update({
        where: { id: priceListId },
        data: { lastModifiedBy: userId },
      });

      return tx.priceListAdjustment.create({
        data: {
          priceListId,
          indexId: indexValue.indexId,
          indexValueId,
          percentage: indexValue.percentage,
          itemsAffected: adjusted.length,
          appliedBy: userId,
        },
        select: { percentage: true, itemsAffected: true, appliedAt: true },
      });
    });

    revalidatePath(`/dashboard/commercial/price-lists/${priceListId}`);
    logger.info('Indice aplicado a lista de precios', {
      data: { priceListId, indexValueId, itemsAffected: adjusted.length },
    });

    return {
      percentage: Number(adjustment.percentage),
      itemsAffected: adjustment.itemsAffected,
      appliedAt: adjustment.appliedAt,
    };
  } catch (error) {
    logger.error('Error al aplicar indice a la lista de precios', {
      data: { error, priceListId, indexValueId },
    });
    if (error instanceof Error) {
      throw error;
    }
    throw new Error('Error al aplicar índice a la lista de precios');
  }
}
