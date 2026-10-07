'use server';

import { getCurrentUserId } from '@/shared/lib/current-user';
import { getActiveCompanyId } from '@/shared/lib/company';
import { prisma } from '@/shared/lib/prisma';
import { logger } from '@/shared/lib/logger';
import { checkPermission } from '@/shared/lib/permissions';
import { BusinessError, toActionResult, type ActionResult } from '@/shared/lib/action-result';
import { Prisma } from '@/generated/prisma/client';
import { revalidateAccountingRoutes } from '../../shared/utils';
import { journalEntrySchema, type CreateJournalEntryInput } from '../../shared/types';
import { createJournalEntryTx, postJournalEntryTx } from '../../shared/utils/journal-entry-tx';
import { validateJournalEntryAccounts, validateAccountNatures, validatePeriodLock, validateAuxiliaries, resolveFiscalPeriod } from './validators';

import { JournalEntryStatus } from '@/generated/prisma/enums';

/**
 * Crea un asiento manual en borrador (TSK-760, Fase 4).
 *
 * El `companyId` sale de la empresa activa (no del cliente). Las validaciones de
 * cuentas y auxiliares son de solo lectura y van antes de la tx; el período, la
 * numeración y la creación las hace el núcleo (`createJournalEntryTx`) dentro de
 * la tx, con el lock de la empresa. Errores de negocio como `ActionResult`.
 */
export async function createJournalEntry(
  input: CreateJournalEntryInput
): Promise<ActionResult<{ id: string; number: number }>> {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('No autenticado');
  await checkPermission('accounting.entries', 'create', { redirect: true });
  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    const parsed = journalEntrySchema.safeParse(input);
    if (!parsed.success) {
      throw new BusinessError(parsed.error.issues[0]?.message ?? 'Los datos del asiento no son válidos.');
    }
    const data = parsed.data;

    const accounts = await validateJournalEntryAccounts(companyId, data.lines.map((line) => line.accountId));
    await validateAuxiliaries(companyId, data.lines, accounts);
    // Naturaleza de las cuentas: solo advertencias en el log, no bloquean.
    await validateAccountNatures(companyId, data.lines);

    const entry = await prisma.$transaction((tx) =>
      createJournalEntryTx(tx, {
        companyId,
        date: data.date,
        description: data.description,
        status: 'DRAFT',
        createdBy: userId,
        source: 'manual',
        lines: data.lines.map((line) => ({
          accountId: line.accountId,
          description: line.description ?? null,
          debit: new Prisma.Decimal(line.debit),
          credit: new Prisma.Decimal(line.credit),
          customerId: line.customerId ?? null,
          supplierId: line.supplierId ?? null,
          costCenterId: line.costCenterId ?? null,
        })),
      })
    );

    logger.info('Asiento contable creado', { data: { entryId: entry.id, number: entry.number, userId } });
    revalidateAccountingRoutes(companyId);

    return { success: true, id: entry.id, number: entry.number };
  } catch (error) {
    return toActionResult(error, 'Error al crear asiento contable');
  }
}

/**
 * Registra un asiento en borrador (DRAFT → POSTED) con `postJournalEntryTx`:
 * valida ejercicio cerrado, mes cerrado y bloqueo (B4) y el balance, dentro de la tx.
 */
export async function postJournalEntry(entryId: string): Promise<ActionResult<{ number: number }>> {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('No autenticado');
  await checkPermission('accounting.entries', 'approve', { redirect: true });
  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    const posted = await prisma.$transaction((tx) => postJournalEntryTx(tx, { companyId, entryId, userId }));

    logger.info('Asiento contable registrado', { data: { entryId, number: posted.number, userId } });
    revalidateAccountingRoutes(companyId);

    return { success: true, number: posted.number };
  } catch (error) {
    return toActionResult(error, 'Error al registrar asiento contable');
  }
}

/**
 * Anula un asiento contable
 */
export async function reverseJournalEntry(companyId: string, entryId: string) {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('No autenticado');
  await checkPermission('accounting.entries', 'approve', { redirect: true });

  try {
    const entry = await prisma.journalEntry.findUnique({
      where: { id: entryId },
      select: {
        id: true,
        companyId: true,
        number: true,
        date: true,
        description: true,
        status: true,
        postDate: true,
        createdBy: true,
        createdAt: true,
        updatedAt: true,
        lines: {
          select: {
            id: true,
            entryId: true,
            accountId: true,
            description: true,
            debit: true,
            credit: true,
          },
        },
      },
    });

    if (!entry) {
      throw new Error('Asiento no encontrado');
    }

    if (entry.companyId !== companyId) {
      throw new Error('El asiento no pertenece a la empresa');
    }

    // Validar que el período no esté bloqueado
    await validatePeriodLock(companyId, entry.date);

    if (entry.status !== JournalEntryStatus.POSTED) {
      throw new Error('Solo se pueden anular asientos registrados');
    }

    // Resolver período para la fecha actual (la reversión se registra hoy)
    const fiscal = await resolveFiscalPeriod(companyId, new Date());

    // Crear asiento de reversión
    const result = await prisma.$transaction(async (tx) => {
      // Incremento atómico: UPDATE ... RETURNING evita race conditions
      const [{ last_entry_number: nextNumber }] = await tx.$queryRaw<[{ last_entry_number: number }]>`
        UPDATE accounting_settings
        SET last_entry_number = last_entry_number + 1, updated_at = NOW()
        WHERE company_id = ${companyId}::uuid
        RETURNING last_entry_number
      `;

      // Crear asiento de reversión primero
      const reversalEntry = await tx.journalEntry.create({
        data: {
          companyId,
          number: nextNumber,
          date: new Date(),
          description: `Anulación del asiento N° ${entry.number} - ${entry.description}`,
          status: JournalEntryStatus.POSTED,
          postDate: new Date(),
          createdBy: userId,
          originalEntryId: entryId,
          fiscalYearId: fiscal?.fiscalYearId,
          periodId: fiscal?.periodId,
          lines: {
            create: entry.lines.map(line => ({
              accountId: line.accountId,
              description: line.description,
              debit: line.credit,
              credit: line.debit,
            })),
          },
        },
        select: {
          id: true,
          companyId: true,
          number: true,
          date: true,
          description: true,
          status: true,
          postDate: true,
          createdBy: true,
          createdAt: true,
          updatedAt: true,
          lines: {
            select: {
              id: true,
              entryId: true,
              accountId: true,
              description: true,
              debit: true,
              credit: true,
              account: {
                select: {
                  code: true,
                  name: true,
                },
              },
            },
          },
        },
      });

      // Marcar el asiento original como anulado
      await tx.journalEntry.update({
        where: { id: entryId },
        data: {
          status: JournalEntryStatus.REVERSED,
          reversalEntryId: reversalEntry.id, // Link al asiento de reversión
          reversedBy: userId,
          reversedAt: new Date(),
        },
      });

      return reversalEntry;
    });

    logger.info('Asiento contable anulado', { data: { entryId, reversalId: result.id, userId } });
    revalidateAccountingRoutes(companyId);

    return result;
  } catch (error) {
    logger.error('Error al anular asiento contable', { data: { error, entryId, userId } });
    throw error;
  }
}

/**
 * Obtiene todos los asientos contables de una empresa
 */
export async function getJournalEntries(companyId: string) {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('No autenticado');
  await checkPermission('accounting.entries', 'view', { redirect: true });

  try {
    const entries = await prisma.journalEntry.findMany({
      where: { companyId },
      orderBy: [
        { date: 'desc' },
        { number: 'desc' },
      ],
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
        originalEntry: {
          select: { number: true },
        },
        reversalEntry: {
          select: { number: true },
        },
        salesInvoices: {
          select: { id: true, fullNumber: true },
        },
        purchaseInvoices: {
          select: { id: true, fullNumber: true },
        },
        receipts: {
          select: { id: true, fullNumber: true },
        },
        paymentOrders: {
          select: { id: true, fullNumber: true },
        },
      },
    });

    return entries;
  } catch (error) {
    logger.error('Error al obtener asientos contables', { data: { error, companyId, userId } });
    throw error;
  }
}

/**
 * Obtiene un asiento contable por ID
 */
export async function getJournalEntryById(companyId: string, entryId: string) {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('No autenticado');
  await checkPermission('accounting.entries', 'view', { redirect: true });

  try {
    const entry = await prisma.journalEntry.findUnique({
      where: { id: entryId },
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
          select: {
            id: true,
            entryId: true,
            accountId: true,
            description: true,
            debit: true,
            credit: true,
          },
        },
      },
    });

    if (!entry) {
      throw new Error('Asiento no encontrado');
    }

    if (entry.companyId !== companyId) {
      throw new Error('El asiento no pertenece a la empresa');
    }

    return entry;
  } catch (error) {
    logger.error('Error al obtener asiento contable', { data: { error, entryId, userId } });
    throw error;
  }
}
