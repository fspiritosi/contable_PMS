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
import { createJournalEntryTx, postJournalEntryTx, reverseJournalEntryTx } from '../../shared/utils/journal-entry-tx';
import {
  buildDocumentLinkedMessage,
  getEntryDocumentLink,
  type EntryDocumentLink,
} from '../../shared/utils/entry-document-link';
import type { IsoDay } from '../../shared/utils/journal-entry-types';
import { todayBusinessDay, todayBusinessDayUtc } from '../../shared/utils/utc-month';
import { validateJournalEntryAccounts, validateAccountNatures, validateAuxiliaries } from './validators';

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

/** Aviso para los asientos de sistema sin documento vinculado (D6): se anulan, pero solo el asiento. */
const SYSTEM_ENTRY_WARNING =
  'Este asiento lo generó el sistema sin un comprobante vinculado (por ejemplo, un movimiento ' +
  'bancario, una transferencia o la baja de un equipo). Anularlo no revierte el saldo bancario ni ' +
  'el estado del equipo: corregilos a mano si corresponde.';

export interface ReversalCheck {
  /** Documento al que pertenece el asiento (si lo hay, no se puede anular desde Asientos). */
  link: EntryDocumentLink | null;
  /** Motivo del bloqueo, listo para mostrar (`null` si se puede anular). */
  blockedMessage: string | null;
  /** Advertencia para asientos de sistema sin vínculo (D6). */
  warning: string | null;
  /** Fecha con la que se registraría la anulación: hoy en Argentina (D5 revisado). */
  date: IsoDay;
}

/**
 * Qué pasaría al anular el asiento desde Asientos (lo usa el diálogo para avisar o
 * bloquear antes de confirmar). Solo lectura.
 */
export async function getReversalCheck(entryId: string): Promise<ActionResult<ReversalCheck>> {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('No autenticado');
  await checkPermission('accounting.entries', 'approve', { redirect: true });
  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    const entry = await prisma.journalEntry.findFirst({
      where: { id: entryId, companyId },
      select: { createdBy: true },
    });
    if (!entry) throw new BusinessError('Asiento no encontrado.');

    const link = await getEntryDocumentLink(prisma, companyId, entryId);
    return {
      success: true,
      link,
      blockedMessage: link ? buildDocumentLinkedMessage(link) : null,
      warning: !link && entry.createdBy === 'system' ? SYSTEM_ENTRY_WARNING : null,
      date: todayBusinessDay(),
    };
  } catch (error) {
    return toActionResult(error, 'Error al verificar la anulación del asiento');
  }
}

/**
 * Anula un asiento registrado desde Asientos (TSK-760, Fase 10: B10, D5, D6).
 *
 * Rechaza los asientos que pertenecen a un documento (8 tablas + refundición/apertura):
 * se anulan desde su comprobante. La reversión se registra con fecha de hoy (día
 * calendario de Argentina, `todayBusinessDayUtc`) y
 * `reverseJournalEntryTx` valida el período del original y el de hoy, y copia todas las
 * columnas de línea invertidas (auxiliares, centro de costo, moneda).
 */
export async function reverseJournalEntry(input: {
  entryId: string;
}): Promise<ActionResult<{ reversalNumber: number }>> {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('No autenticado');
  await checkPermission('accounting.entries', 'approve', { redirect: true });
  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');
  const { entryId } = input;

  try {
    const result = await prisma.$transaction(async (tx) => {
      const link = await getEntryDocumentLink(tx, companyId, entryId);
      if (link) throw new BusinessError(buildDocumentLinkedMessage(link));
      return reverseJournalEntryTx(tx, {
        companyId,
        entryId,
        date: todayBusinessDayUtc(),
        createdBy: userId,
        source: `manual-reversal:${entryId}`,
      });
    });

    logger.info('Asiento contable anulado', {
      data: { entryId, reversalId: result.reversal.id, number: result.reversal.number, userId },
    });
    revalidateAccountingRoutes(companyId);

    return { success: true, reversalNumber: result.reversal.number };
  } catch (error) {
    return toActionResult(error, 'Error al anular asiento contable');
  }
}

const ENTRY_STATUS_LABELS: Record<JournalEntryStatus, string> = {
  DRAFT: 'Borrador',
  POSTED: 'Registrado',
  REVERSED: 'Anulado',
};

/**
 * Elimina un borrador manual (TSK-760, C6): para que un borrador imposible de
 * registrar no trabe el cierre de su mes (H9). Solo DRAFT de la empresa activa, sin
 * documento vinculado y no generado por el sistema. No valida período (su fin es
 * justamente destrabar un mes). Las líneas caen por cascada.
 */
export async function deleteDraftJournalEntry(entryId: string): Promise<ActionResult<{ number: number }>> {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('No autenticado');
  await checkPermission('accounting.entries', 'delete', { redirect: true });
  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    const number = await prisma.$transaction(async (tx) => {
      const entry = await tx.journalEntry.findFirst({
        where: { id: entryId, companyId },
        select: { number: true, status: true, createdBy: true },
      });
      if (!entry) throw new BusinessError('Asiento no encontrado.');
      if (entry.status !== JournalEntryStatus.DRAFT) {
        throw new BusinessError(
          `Solo se eliminan borradores; el asiento N° ${entry.number} está en estado ` +
            `${ENTRY_STATUS_LABELS[entry.status]}.`
        );
      }
      const link = await getEntryDocumentLink(tx, companyId, entryId);
      if (link) throw new BusinessError(buildDocumentLinkedMessage(link, 'delete'));
      if (entry.createdBy === 'system') {
        throw new BusinessError(
          `El borrador N° ${entry.number} lo generó el sistema (por ejemplo, un movimiento bancario): ` +
            'solo se eliminan borradores manuales.'
        );
      }
      // `status: DRAFT` en el where: si otro lo registró entre la lectura y el borrado, no borra.
      const deleted = await tx.journalEntry.deleteMany({
        where: { id: entryId, companyId, status: JournalEntryStatus.DRAFT },
      });
      if (deleted.count !== 1) throw new BusinessError(`El asiento N° ${entry.number} ya no está en borrador.`);
      return entry.number;
    });

    logger.info('Borrador de asiento eliminado', { data: { entryId, number, userId } });
    revalidateAccountingRoutes(companyId);

    return { success: true, number };
  } catch (error) {
    return toActionResult(error, 'Error al eliminar el borrador');
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
