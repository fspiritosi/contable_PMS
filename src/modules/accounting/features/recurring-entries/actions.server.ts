'use server';

import { BusinessError, toActionResult, type ActionResult } from '@/shared/lib/action-result';
import { getActiveCompanyId } from '@/shared/lib/company';
import { getCurrentUserId } from '@/shared/lib/current-user';
import { prisma } from '@/shared/lib/prisma';
import { logger } from '@/shared/lib/logger';
import { checkPermission } from '@/shared/lib/permissions';
import { type RecurringFrequency } from '@/generated/prisma/enums';
import { formatMonth, monthKeyUtc, revalidateAccountingRoutes } from '../../shared/utils';
import { endOfDayUtc, todayBusinessDayUtc } from '../../shared/utils/utc-month';
import { createJournalEntryTx } from '../../shared/utils/journal-entry-tx';
import { recurringEntrySchema } from './validators';
import moment from 'moment';

/**
 * Calcula la siguiente fecha de generación según frecuencia
 */
function calculateNextDueDate(currentDate: Date, frequency: RecurringFrequency): Date {
  // En UTC (TSK-760, D8): las fechas de día se guardan a medianoche UTC; en hora local
  // el 31/01 00:00Z es el 30/01 y "un mes después" caía el 01/03.
  const m = moment.utc(currentDate);
  switch (frequency) {
    case 'MONTHLY':
      return m.add(1, 'month').toDate();
    case 'BIMONTHLY':
      return m.add(2, 'months').toDate();
    case 'QUARTERLY':
      return m.add(3, 'months').toDate();
    case 'SEMIANNUAL':
      return m.add(6, 'months').toDate();
    case 'ANNUAL':
      return m.add(1, 'year').toDate();
    default:
      return m.add(1, 'month').toDate();
  }
}

const FREQUENCY_LABELS: Record<string, string> = {
  MONTHLY: 'Mensual',
  BIMONTHLY: 'Bimestral',
  QUARTERLY: 'Trimestral',
  SEMIANNUAL: 'Semestral',
  ANNUAL: 'Anual',
};

/**
 * "Hoy" para decidir qué plantillas vencieron: el día calendario de Argentina (TSK-760,
 * D5 revisado), comparado por día UTC (D8). Una plantilla que vence hoy, a cualquier hora,
 * está pendiente; la de mañana no, aunque en UTC ya sea mañana.
 */
function businessToday(): { today: Date; endOfToday: Date } {
  const today = todayBusinessDayUtc();
  return { today, endOfToday: endOfDayUtc(today) };
}

/**
 * Obtiene todos los asientos recurrentes de la empresa
 */
export async function getRecurringEntries(companyId: string) {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('No autenticado');
  await checkPermission('accounting.recurring-entries', 'view', { redirect: true });

  try {
    const entries = await prisma.recurringEntry.findMany({
      where: {
        companyId,
        isActive: true,
      },
      include: {
        lines: {
          include: {
            account: {
              select: {
                code: true,
                name: true,
              },
            },
          },
        },
      },
      orderBy: { nextDueDate: 'asc' },
    });

    const { today, endOfToday } = businessToday();
    return entries.map((entry) => ({
      ...entry,
      frequencyLabel: FREQUENCY_LABELS[entry.frequency] ?? entry.frequency,
      isPending: entry.nextDueDate <= endOfToday && (!entry.endDate || entry.endDate >= today),
    }));
  } catch (error) {
    logger.error('Error al obtener asientos recurrentes', { data: { error, companyId } });
    throw error;
  }
}

/**
 * Crea un nuevo asiento recurrente
 */
export async function createRecurringEntry(
  companyId: string,
  input: {
    name: string;
    description: string;
    frequency: RecurringFrequency;
    startDate: Date;
    endDate?: Date | null;
    lines: { accountId: string; description?: string; debit: number; credit: number }[];
  }
) {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('No autenticado');
  await checkPermission('accounting.recurring-entries', 'create', { redirect: true });

  try {
    // Validar con Zod
    const validated = recurringEntrySchema.parse(input);

    const nextDueDate = validated.startDate;

    const entry = await prisma.$transaction(async (tx) => {
      return tx.recurringEntry.create({
        data: {
          companyId,
          name: validated.name,
          description: validated.description,
          frequency: validated.frequency,
          startDate: validated.startDate,
          endDate: validated.endDate ?? null,
          nextDueDate,
          createdBy: userId,
          lines: {
            create: validated.lines.map((line) => ({
              accountId: line.accountId,
              description: line.description,
              debit: line.debit,
              credit: line.credit,
            })),
          },
        },
        include: {
          lines: true,
        },
      });
    });

    logger.info('Asiento recurrente creado', { data: { entryId: entry.id, userId } });
    revalidateAccountingRoutes(companyId);

    return entry;
  } catch (error) {
    logger.error('Error al crear asiento recurrente', { data: { error, companyId, userId } });
    throw error;
  }
}

/**
 * Elimina (soft delete) un asiento recurrente
 */
export async function deleteRecurringEntry(companyId: string, id: string) {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('No autenticado');
  await checkPermission('accounting.recurring-entries', 'delete', { redirect: true });

  try {
    const entry = await prisma.recurringEntry.findUnique({
      where: { id },
      select: { companyId: true },
    });

    if (!entry || entry.companyId !== companyId) {
      throw new Error('Asiento recurrente no encontrado');
    }

    await prisma.recurringEntry.update({
      where: { id },
      data: { isActive: false },
    });

    logger.info('Asiento recurrente eliminado', { data: { id, userId } });
    revalidateAccountingRoutes(companyId);
  } catch (error) {
    logger.error('Error al eliminar asiento recurrente', { data: { error, id, userId } });
    throw error;
  }
}

/**
 * Genera el asiento de una plantilla para la empresa activa (TSK-760, #18). El asiento
 * nace DRAFT con el núcleo (`createJournalEntryTx`: período cerrado, ejercicio,
 * período y número atómico) y la plantilla avanza en la misma transacción. Con el mes
 * del vencimiento cerrado no se crea nada: la plantilla queda pendiente y el mensaje
 * dice qué mes reabrir.
 */
async function generateRecurringEntryForCompany(
  companyId: string,
  recurringEntryId: string,
  userId: string
): Promise<ActionResult<{ id: string; number: number }>> {
  try {
    const recurring = await prisma.recurringEntry.findFirst({
      where: { id: recurringEntryId, companyId },
      select: {
        id: true,
        name: true,
        isActive: true,
        frequency: true,
        nextDueDate: true,
        lines: { select: { accountId: true, description: true, debit: true, credit: true } },
      },
    });
    if (!recurring) throw new BusinessError('Asiento recurrente no encontrado');
    if (!recurring.isActive) throw new BusinessError('El asiento recurrente está inactivo');

    const dueDate = recurring.nextDueDate;
    const description = `${recurring.name} - ${formatMonth(monthKeyUtc(dueDate))}`;

    const entry = await prisma.$transaction(async (tx) => {
      const created = await createJournalEntryTx(tx, {
        companyId,
        date: dueDate,
        description,
        lines: recurring.lines,
        status: 'DRAFT',
        createdBy: userId,
        source: `recurring-entry:${recurring.id}`,
      });
      await tx.recurringEntry.update({
        where: { id: recurring.id },
        data: {
          lastGenerated: dueDate,
          nextDueDate: calculateNextDueDate(dueDate, recurring.frequency),
        },
      });
      return created;
    });

    logger.info('Asiento generado desde plantilla recurrente', {
      data: { recurringEntryId, entryId: entry.id, number: entry.number, userId },
    });
    return { success: true, id: entry.id, number: entry.number };
  } catch (error) {
    return toActionResult(error, 'Error al generar asiento recurrente');
  }
}

/**
 * Genera un asiento contable desde una plantilla recurrente
 */
export async function generateRecurringEntry(
  recurringEntryId: string
): Promise<ActionResult<{ id: string; number: number }>> {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('No autenticado');
  await checkPermission('accounting.recurring-entries', 'create', { redirect: true });
  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  const result = await generateRecurringEntryForCompany(companyId, recurringEntryId, userId);
  if (result.success) revalidateAccountingRoutes(companyId);
  return result;
}

/**
 * Genera todos los asientos recurrentes pendientes. Cada plantilla va en su propia
 * transacción: la que cae en un mes cerrado (o falla por otro motivo) se informa en
 * `errors[]` con el mensaje (que nombra el mes) y queda pendiente; las demás se generan.
 */
export async function generateAllPendingRecurringEntries(): Promise<
  ActionResult<{ generated: number; errors: string[] }>
> {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('No autenticado');
  await checkPermission('accounting.recurring-entries', 'create', { redirect: true });
  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    const { today, endOfToday } = businessToday();
    const pending = await prisma.recurringEntry.findMany({
      where: {
        companyId,
        isActive: true,
        nextDueDate: { lte: endOfToday },
        OR: [{ endDate: null }, { endDate: { gte: today } }],
      },
      select: { id: true, name: true },
      orderBy: { nextDueDate: 'asc' },
    });

    let generated = 0;
    const errors: string[] = [];

    for (const entry of pending) {
      const result = await generateRecurringEntryForCompany(companyId, entry.id, userId);
      if (result.success) generated++;
      else errors.push(`${entry.name}: ${result.error}`);
    }

    logger.info('Generación masiva de asientos recurrentes', {
      data: { companyId, generated, errors: errors.length, userId },
    });

    revalidateAccountingRoutes(companyId);
    return { success: true, generated, errors };
  } catch (error) {
    return toActionResult(error, 'Error en generación masiva de recurrentes');
  }
}
