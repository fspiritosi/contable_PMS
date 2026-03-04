'use server';

import { auth } from '@clerk/nextjs/server';

import { logger } from '@/shared/lib/logger';
import { prisma } from '@/shared/lib/prisma';

interface TablePreferences {
  columnVisibility?: Record<string, boolean>;
  filterVisibility?: Record<string, boolean>;
}

/**
 * Obtiene las preferencias de tabla para un tableId del usuario actual
 */
export async function getTablePreferences(
  tableId: string
): Promise<TablePreferences | null> {
  const { userId } = await auth();
  if (!userId) return null;

  try {
    const prefs = await prisma.userPreference.findUnique({
      where: { userId },
      select: { tablePreferences: true },
    });

    if (!prefs?.tablePreferences) return null;

    const allPrefs = prefs.tablePreferences as Record<string, TablePreferences>;
    return allPrefs[tableId] ?? null;
  } catch (error) {
    logger.error('Error getting table preferences', { data: { error, tableId } });
    return null;
  }
}

/**
 * Guarda la visibilidad de columnas para un tableId
 */
export async function saveTableColumnVisibility(
  tableId: string,
  visibility: Record<string, boolean>
): Promise<void> {
  const { userId } = await auth();
  if (!userId) return;

  try {
    const prefs = await prisma.userPreference.findUnique({
      where: { userId },
      select: { tablePreferences: true },
    });

    const allPrefs = (prefs?.tablePreferences as Record<string, TablePreferences>) ?? {};
    const tablePrefs = allPrefs[tableId] ?? {};

    allPrefs[tableId] = {
      ...tablePrefs,
      columnVisibility: visibility,
    };

    await prisma.userPreference.update({
      where: { userId },
      data: { tablePreferences: JSON.parse(JSON.stringify(allPrefs)) },
    });
  } catch (error) {
    logger.error('Error saving column visibility', { data: { error, tableId } });
  }
}

/**
 * Guarda la visibilidad de filtros para un tableId
 */
export async function saveTableFilterVisibility(
  tableId: string,
  visibility: Record<string, boolean>
): Promise<void> {
  const { userId } = await auth();
  if (!userId) return;

  try {
    const prefs = await prisma.userPreference.findUnique({
      where: { userId },
      select: { tablePreferences: true },
    });

    const allPrefs = (prefs?.tablePreferences as Record<string, TablePreferences>) ?? {};
    const tablePrefs = allPrefs[tableId] ?? {};

    allPrefs[tableId] = {
      ...tablePrefs,
      filterVisibility: visibility,
    };

    await prisma.userPreference.update({
      where: { userId },
      data: { tablePreferences: JSON.parse(JSON.stringify(allPrefs)) },
    });
  } catch (error) {
    logger.error('Error saving filter visibility', { data: { error, tableId } });
  }
}
