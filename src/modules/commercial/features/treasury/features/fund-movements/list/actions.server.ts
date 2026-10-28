'use server';

import { revalidatePath } from 'next/cache';

import type { FundMovementType } from '@/generated/prisma/enums';
import {
  resolveFundMovementDataTx,
  writeFundMovementDataTx,
} from '@/modules/commercial/shared/effects/fund-movement-data.server';
import { applyFundMovementEffectsTx } from '@/modules/commercial/shared/effects/fund-movement.server';
import type { DataTableSearchParams } from '@/shared/components/common/DataTable';
import {
  parseSearchParams,
  stateToPrismaParams,
} from '@/shared/components/common/DataTable/helpers';
import { ActionResult, BusinessError, toActionResult } from '@/shared/lib/action-result';
import { getActiveCompanyId } from '@/shared/lib/company';
import { getActiveConceptOptions, type ConceptOption } from '@/shared/lib/concepts/concepts.server';
import { getCurrentUserId } from '@/shared/lib/current-user';
import { logger } from '@/shared/lib/logger';
import { checkPermission } from '@/shared/lib/permissions';
import { prisma } from '@/shared/lib/prisma';
import { fundMovementSchema, type FundMovementFormInput } from '../shared/validators';

/**
 * Resultado de una mutación. Los errores esperables viajan como dato, no como
 * excepción (TSK-481). `BusinessError` y `toActionResult` viven en
 * `@/shared/lib/action-result` desde TSK-721, compartidos con la confirmación de
 * facturas.
 */
export type FundMovementActionResult = ActionResult<{ id?: string }>;

// ============================================================================
// QUERIES
// ============================================================================

/** Listado paginado de movimientos de fondos. */
export async function getFundMovements(searchParams: DataTableSearchParams) {
  await checkPermission('commercial.treasury.fund-movements', 'view', { redirect: true });
  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    const state = parseSearchParams(searchParams);
    const { skip, take, orderBy } = stateToPrismaParams(state);
    const where = { companyId };

    const [movements, total] = await Promise.all([
      prisma.fundMovement.findMany({
        where,
        skip,
        take,
        orderBy: orderBy || [{ date: 'desc' }, { createdAt: 'desc' }],
      }),
      prisma.fundMovement.count({ where }),
    ]);

    return {
      data: movements.map((m) => ({ ...m, amount: Number(m.amount) })),
      total,
    };
  } catch (error) {
    logger.error('Error al obtener movimientos de fondos', { data: { error, companyId } });
    throw new Error('Error al obtener movimientos de fondos');
  }
}

/** Un movimiento por id (para edición). */
export async function getFundMovementById(id: string) {
  await checkPermission('commercial.treasury.fund-movements', 'view', { redirect: true });
  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  const movement = await prisma.fundMovement.findFirst({
    where: { id, companyId },
    include: { lines: { orderBy: { position: 'asc' } } },
  });
  if (!movement) return null;
  return {
    ...movement,
    amount: Number(movement.amount),
    // TSK-791: la cuenta contable de la línea no viaja al cliente (Gestión no ve cuentas).
    lines: movement.lines.map((line) => ({
      id: line.id,
      movementId: line.movementId,
      description: line.description,
      amount: Number(line.amount),
      position: line.position,
      conceptId: line.conceptId,
      conceptName: line.conceptName,
      createdAt: line.createdAt,
      updatedAt: line.updatedAt,
    })),
  };
}

/** Tipos de movimiento de fondo que imputan por concepto (TSK-791). */
export type FundMovementConceptType = Exclude<
  FundMovementType,
  'ACCOUNT_TRANSFER' | 'INVESTMENT_PURCHASE' | 'INVESTMENT_SALE'
>;

/** Un concepto como lo ve Gestión: id, nombre y modo, nunca la cuenta (TSK-791). */
export type FundMovementConceptOption = ConceptOption;

/** Conceptos activos por tipo de movimiento, para los combos del formulario. */
export type FundMovementConceptCatalog = Record<
  FundMovementConceptType,
  FundMovementConceptOption[]
>;

/**
 * Catálogos para el formulario: bancos, cajas con sesión abierta, socios (con
 * su cuenta de aportes), cuenta de aportes por defecto y los conceptos activos
 * de cada tipo (TSK-791). La cuenta de gastos bancarios por defecto (TSK-718)
 * ya no viaja: la cuenta de cada línea sale de su concepto.
 */
export async function getFundMovementCatalogs() {
  await checkPermission('commercial.treasury.fund-movements', 'view', { redirect: true });
  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  const [banks, cashRegisters, partners, settings, conceptsByUsage] = await Promise.all([
    prisma.bankAccount.findMany({
      where: { companyId, status: 'ACTIVE' },
      select: { id: true, bankName: true, accountNumber: true },
      orderBy: { bankName: 'asc' },
    }),
    prisma.cashRegister.findMany({
      where: { companyId, status: 'ACTIVE', sessions: { some: { status: 'OPEN' } } },
      select: { id: true, name: true, code: true },
      orderBy: { name: 'asc' },
    }),
    prisma.partner.findMany({
      where: { companyId, isActive: true },
      select: {
        id: true,
        name: true,
        contributionsAccount: { select: { id: true, code: true, name: true } },
      },
      orderBy: { name: 'asc' },
    }),
    prisma.accountingSettings.findUnique({
      where: { companyId },
      select: {
        partnerContributionsAccount: { select: { id: true, code: true, name: true } },
      },
    }),
    // Gestión los lee con su propio permiso: no necesita `accounting.concepts`.
    getActiveConceptOptions(prisma, companyId, [
      'FUND_BANK_CHARGES',
      'FUND_PARTNER_CONTRIBUTION',
      'FUND_PARTNER_WITHDRAWAL',
    ]),
  ]);

  const concepts: FundMovementConceptCatalog = {
    BANK_CHARGES: conceptsByUsage.FUND_BANK_CHARGES,
    PARTNER_CONTRIBUTION: conceptsByUsage.FUND_PARTNER_CONTRIBUTION,
    PARTNER_WITHDRAWAL: conceptsByUsage.FUND_PARTNER_WITHDRAWAL,
  };

  return {
    banks: banks.map((b) => ({ id: b.id, label: `${b.bankName} - ${b.accountNumber}` })),
    cashRegisters: cashRegisters.map((c) => ({ id: c.id, label: `Caja ${c.name}` })),
    partners: partners.map((p) => ({
      id: p.id,
      name: p.name,
      contributionsAccount: p.contributionsAccount,
    })),
    // TSK-717: reemplaza `hasContributionsAccount: boolean`. El modal necesita
    // código y nombre para decir "se usará la cuenta por defecto X".
    defaultContributionsAccount: settings?.partnerContributionsAccount ?? null,
    concepts,
  };
}

// ============================================================================
// MUTATIONS
// ============================================================================

/**
 * Crea un movimiento de fondos en BORRADOR (sin asiento ni impacto en saldos).
 * Si `confirm` es true, lo confirma en la misma operación.
 */
export async function createFundMovement(
  input: FundMovementFormInput,
  confirm = false
): Promise<FundMovementActionResult> {
  await checkPermission('commercial.treasury.fund-movements', 'create', { redirect: true });

  try {
    const userId = await getCurrentUserId();
    if (!userId) throw new BusinessError('No autenticado');
    const companyId = await getActiveCompanyId();
    if (!companyId) throw new BusinessError('No hay empresa activa');

    const data = fundMovementSchema.parse(input);
    const { fields, lines } = await resolveFundMovementDataTx(prisma, companyId, data);

    const created = await prisma.fundMovement.create({
      data: {
        ...fields,
        companyId,
        status: 'DRAFT',
        createdBy: userId,
        ...(lines.length > 0 ? { lines: { create: lines } } : {}),
      },
      select: { id: true },
    });

    logger.info('Movimiento de fondos creado (borrador)', { data: { id: created.id, companyId } });

    if (confirm) {
      // El borrador ya quedó creado: si la confirmación falla, se informa el
      // motivo y el movimiento sigue disponible para corregir y reconfirmar.
      const confirmed = await confirmFundMovement(created.id);
      if (!confirmed.success) return confirmed;
    } else {
      revalidatePath('/dashboard/commercial/treasury/fund-movements');
    }

    return { success: true, id: created.id };
  } catch (error) {
    return toActionResult(error, 'Error al crear movimiento de fondos');
  }
}

/** Actualiza un movimiento en BORRADOR (no permitido si ya está confirmado). */
export async function updateFundMovement(
  id: string,
  input: FundMovementFormInput
): Promise<FundMovementActionResult> {
  await checkPermission('commercial.treasury.fund-movements', 'update', { redirect: true });

  try {
    const companyId = await getActiveCompanyId();
    if (!companyId) throw new BusinessError('No hay empresa activa');

    // Las líneas se reemplazan enteras en la misma transacción que el movimiento.
    await prisma.$transaction(async (tx) => {
      const existing = await tx.fundMovement.findFirst({
        where: { id, companyId },
        select: { status: true },
      });
      if (!existing) throw new BusinessError('Movimiento no encontrado');
      if (existing.status !== 'DRAFT') {
        throw new BusinessError('Solo se pueden editar movimientos en borrador');
      }
      const data = fundMovementSchema.parse(input);
      await writeFundMovementDataTx(tx, companyId, id, data);
    });

    revalidatePath('/dashboard/commercial/treasury/fund-movements');
    return { success: true, id };
  } catch (error) {
    return toActionResult(error, 'Error al actualizar movimiento de fondos');
  }
}

/**
 * Confirma un movimiento en borrador: actualiza saldos de banco/caja y genera
 * el asiento contable, de forma atómica. Lo deja CONFIRMED.
 */
export async function confirmFundMovement(id: string): Promise<FundMovementActionResult> {
  await checkPermission('commercial.treasury.fund-movements', 'update', { redirect: true });

  try {
    const userId = await getCurrentUserId();
    if (!userId) throw new BusinessError('No autenticado');
    const companyId = await getActiveCompanyId();
    if (!companyId) throw new BusinessError('No hay empresa activa');

    const movement = await prisma.fundMovement.findFirst({
      where: { id, companyId },
      select: { status: true, type: true, partnerId: true },
    });
    if (!movement) throw new BusinessError('Movimiento no encontrado');
    if (movement.status !== 'DRAFT') {
      throw new BusinessError('El movimiento ya fue confirmado o anulado');
    }

    await prisma.$transaction(async (tx) => {
      await tx.fundMovement.update({
        where: { id },
        data: { status: 'CONFIRMED', confirmedAt: new Date() },
      });
      await applyFundMovementEffectsTx(tx, { companyId, userId }, id);
    });

    logger.info('Movimiento de fondos confirmado', {
      data: { id, companyId, type: movement.type, partnerId: movement.partnerId },
    });
    revalidatePath('/dashboard/commercial/treasury/fund-movements');
    revalidatePath('/dashboard/commercial/treasury/bank-accounts');
    revalidatePath('/dashboard/commercial/treasury/cash-registers');
    return { success: true, id };
  } catch (error) {
    return toActionResult(error, 'Error al confirmar movimiento de fondos');
  }
}

/** Elimina un movimiento en BORRADOR (los confirmados no se pueden borrar acá). */
export async function deleteFundMovement(id: string): Promise<FundMovementActionResult> {
  await checkPermission('commercial.treasury.fund-movements', 'delete', { redirect: true });

  try {
    const companyId = await getActiveCompanyId();
    if (!companyId) throw new BusinessError('No hay empresa activa');

    const existing = await prisma.fundMovement.findFirst({
      where: { id, companyId },
      select: { status: true },
    });
    if (!existing) throw new BusinessError('Movimiento no encontrado');
    if (existing.status !== 'DRAFT') {
      throw new BusinessError('Solo se pueden eliminar movimientos en borrador');
    }

    await prisma.fundMovement.delete({ where: { id } });
    logger.info('Movimiento de fondos eliminado (borrador)', { data: { id, companyId } });
    revalidatePath('/dashboard/commercial/treasury/fund-movements');
    return { success: true, id };
  } catch (error) {
    return toActionResult(error, 'Error al eliminar movimiento de fondos');
  }
}

export type FundMovementListItem = Awaited<ReturnType<typeof getFundMovements>>['data'][number];
export type FundMovementRecord = NonNullable<Awaited<ReturnType<typeof getFundMovementById>>>;
export type FundOption = { id: string; label: string };
/** Referencia mínima a una cuenta del plan, para mostrar `code - name` (TSK-717). */
export type FundMovementAccountRef = { id: string; code: string; name: string };
export type FundMovementPartnerOption = Awaited<
  ReturnType<typeof getFundMovementCatalogs>
>['partners'][number];
