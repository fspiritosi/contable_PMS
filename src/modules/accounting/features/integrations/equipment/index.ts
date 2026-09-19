/**
 * Integración del módulo de equipos con contabilidad: asientos de BAJA.
 *
 * Esta integración genera solo los asientos de baja de un bien de uso:
 *
 * 1. Baja por venta (`createJournalEntryForAssetSale`):
 *    - Debe: Amortización acumulada (total amortizado)
 *    - Debe: Resultado por venta/baja de Bienes de Uso (valor libro restante)
 *    - Haber: Bienes de Uso (valor de origen)
 *    El ingreso por la venta se registra con la factura de venta (integración
 *    comercial).
 *
 * 2. Baja por pérdida total / devolución (`createJournalEntryForAssetDisposal`):
 *    - Debe: Amortización acumulada (total amortizado)
 *    - Debe: Resultado por venta/baja de Bienes de Uso (valor libro restante)
 *    - Haber: Bienes de Uso (valor de origen)
 *
 * Qué NO hace:
 * - No hay asiento de alta: el bien entra a Bienes de Uso por la factura de
 *   compra, con la cuenta del ítem (TSK-579 / TSK-721).
 * - La amortización periódica vive en
 *   `equipment/features/depreciation/actions.server.ts`.
 *
 * Las cuentas llegan RESUELTAS por el llamador (depreciación del equipo → tipo
 * de equipo → por defecto de Ajustes contables, vía
 * `equipment/shared/asset-accounts-loader.ts`, TSK-724c): esta integración no
 * importa nada de `equipment` y no lee `accountingSettings` para elegir
 * cuentas. Toda condición de negocio (equipo sin depreciación, período
 * cerrado) se lanza como `BusinessError` para que el action la devuelva como
 * `{ success: false, error }`; antes se devolvía `null` y el equipo quedaba
 * dado de baja sin asiento y sin aviso.
 */

import { Prisma } from '@/generated/prisma/client';
import { BusinessError } from '@/shared/lib/action-result';
import { logger } from '@/shared/lib/logger';
import { prisma } from '@/shared/lib/prisma';
import moment from 'moment';

// Tipo para el cliente de transacción de Prisma
type PrismaTransactionClient = Omit<
  typeof prisma,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

/** Cuentas ya resueltas y validadas por el llamador para el asiento de baja. */
export interface AssetDisposalAccounts {
  fixedAssetAccountId: string;
  accumulatedDepreciationAccountId: string;
  assetDisposalGainLossAccountId: string;
}

// ============================================
// HELPER: Crear asiento contable
// ============================================

interface JournalEntryLineInput {
  accountId: string;
  debit: number;
  credit: number;
  description: string;
}

async function createJournalEntry(
  input: {
    companyId: string;
    date: Date;
    description: string;
    lines: JournalEntryLineInput[];
  },
  tx: PrismaTransactionClient
): Promise<string> {
  const { companyId, date, description, lines } = input;

  // Validar balance: un desbalance es un bug del llamador, no una condición de negocio.
  const totalDebit = lines.reduce((sum, line) => sum + line.debit, 0);
  const totalCredit = lines.reduce((sum, line) => sum + line.credit, 0);

  if (Math.abs(totalDebit - totalCredit) > 0.01) {
    throw new Error(
      `El asiento no está balanceado. Debe: ${totalDebit.toFixed(2)}, Haber: ${totalCredit.toFixed(2)}`
    );
  }

  // Verificar bloqueo de período
  const settings = await tx.accountingSettings.findUnique({
    where: { companyId },
    select: { lockedUntilDate: true },
  });

  if (!settings) {
    throw new BusinessError(
      'No se encontró la configuración contable de la empresa. Configurala en Contabilidad → Configuración.'
    );
  }

  if (
    settings.lockedUntilDate &&
    moment(date).isSameOrBefore(moment(settings.lockedUntilDate), 'day')
  ) {
    throw new BusinessError(
      `No se puede generar el asiento contable: el período está cerrado para la fecha ${moment(date).format('DD/MM/YYYY')}. Contacte al contador para reabrir el período.`
    );
  }

  // Resolver ejercicio y período
  const fiscalYear = await tx.fiscalYear.findFirst({
    where: { companyId, startDate: { lte: date }, endDate: { gte: date } },
    select: { id: true },
  });
  let periodId: string | undefined;
  if (fiscalYear) {
    const entryMoment = moment(date);
    const period = await tx.accountingPeriod.findFirst({
      where: {
        fiscalYearId: fiscalYear.id,
        year: entryMoment.year(),
        month: entryMoment.month() + 1,
        type: 'MONTHLY',
      },
      select: { id: true },
    });
    periodId = period?.id;
  }

  // Incremento atómico: UPDATE ... RETURNING evita race conditions
  const [{ last_entry_number: nextNumber }] = await tx.$queryRaw<[{ last_entry_number: number }]>`
    UPDATE accounting_settings
    SET last_entry_number = last_entry_number + 1, updated_at = NOW()
    WHERE company_id = ${companyId}::uuid
    RETURNING last_entry_number
  `;

  const entry = await tx.journalEntry.create({
    data: {
      companyId,
      number: nextNumber,
      date,
      description,
      createdBy: 'system',
      fiscalYearId: fiscalYear?.id,
      periodId,
      lines: {
        create: lines.map((line) => ({
          accountId: line.accountId,
          debit: new Prisma.Decimal(line.debit),
          credit: new Prisma.Decimal(line.credit),
          description: line.description,
        })),
      },
    },
    select: { id: true },
  });

  logger.info('Asiento contable de baja de equipo creado', {
    data: { entryId: entry.id, number: nextNumber, description },
  });

  return entry.id;
}

// ============================================
// HELPER: Valores de la depreciación y líneas comunes de baja
// ============================================

interface DisposalFigures {
  grossValue: number;
  totalDepreciated: number;
  bookValue: number;
  vehicleLabel: string;
}

/**
 * Lee la depreciación del equipo. Sin depreciación no hay valores para el
 * asiento: se lanza `BusinessError` (defensa en profundidad; el llamador ya no
 * llama en ese caso y da de baja sin asiento).
 */
async function loadDisposalFigures(
  vehicleId: string,
  companyId: string,
  tx: PrismaTransactionClient
): Promise<DisposalFigures> {
  const depreciation = await tx.vehicleDepreciation.findUnique({
    where: { vehicleId },
    select: {
      companyId: true,
      grossValue: true,
      totalDepreciated: true,
      currentBookValue: true,
      vehicle: { select: { internNumber: true, domain: true } },
    },
  });

  const label = depreciation?.vehicle.internNumber || depreciation?.vehicle.domain;
  if (!depreciation || depreciation.companyId !== companyId) {
    throw new BusinessError(
      `El equipo «${label || vehicleId.slice(0, 8)}» no tiene depreciación configurada: la baja no genera asiento contable.`
    );
  }

  return {
    grossValue: Number(depreciation.grossValue),
    totalDepreciated: Number(depreciation.totalDepreciated),
    bookValue: Number(depreciation.currentBookValue),
    vehicleLabel: label || vehicleId.slice(0, 8),
  };
}

/**
 * Líneas comunes a toda baja: reversar la acumulada (si hay algo amortizado:
 * el check `chk_jel_debit_or_credit` rechaza una línea 0/0), dar de baja el
 * valor de origen y mandar el valor libro restante a resultado.
 */
function buildDisposalLines(
  figures: DisposalFigures,
  accounts: AssetDisposalAccounts,
  resultDescription: string
): JournalEntryLineInput[] {
  const { grossValue, totalDepreciated, bookValue, vehicleLabel } = figures;
  const lines: JournalEntryLineInput[] = [];

  if (totalDepreciated > 0) {
    lines.push({
      accountId: accounts.accumulatedDepreciationAccountId,
      debit: totalDepreciated,
      credit: 0,
      description: `Baja amort. acumulada - Equipo ${vehicleLabel}`,
    });
  }

  lines.push({
    accountId: accounts.fixedAssetAccountId,
    debit: 0,
    credit: grossValue,
    description: `Baja bien de uso - Equipo ${vehicleLabel}`,
  });

  if (bookValue > 0) {
    lines.push({
      accountId: accounts.assetDisposalGainLossAccountId,
      debit: bookValue,
      credit: 0,
      description: `${resultDescription} - Equipo ${vehicleLabel}`,
    });
  }

  return lines;
}

// ============================================
// INTEGRACIÓN: Baja de activo por venta
// ============================================

/**
 * Genera el asiento de baja de un bien de uso por venta y devuelve su id.
 * El ingreso por la venta se registra vía factura de venta (integración comercial).
 * Lanza `BusinessError` si el equipo no tiene depreciación o el período está cerrado.
 */
export async function createJournalEntryForAssetSale(
  vehicleId: string,
  companyId: string,
  accounts: AssetDisposalAccounts,
  tx: PrismaTransactionClient
): Promise<string> {
  const figures = await loadDisposalFigures(vehicleId, companyId, tx);

  return createJournalEntry(
    {
      companyId,
      date: new Date(),
      description: `Baja por venta de bien de uso: Equipo ${figures.vehicleLabel}`,
      lines: buildDisposalLines(figures, accounts, 'Resultado por venta'),
    },
    tx
  );
}

// ============================================
// INTEGRACIÓN: Baja de activo por pérdida/devolución
// ============================================

/**
 * Genera el asiento de baja de un bien de uso por pérdida total o devolución
 * y devuelve su id. Lanza `BusinessError` si el equipo no tiene depreciación
 * o el período está cerrado.
 */
export async function createJournalEntryForAssetDisposal(
  vehicleId: string,
  companyId: string,
  accounts: AssetDisposalAccounts,
  tx: PrismaTransactionClient
): Promise<string> {
  const figures = await loadDisposalFigures(vehicleId, companyId, tx);
  const motivo = figures.bookValue > 0 ? 'pérdida total' : 'devolución';

  return createJournalEntry(
    {
      companyId,
      date: new Date(),
      description: `Baja por ${motivo} de bien de uso: Equipo ${figures.vehicleLabel}`,
      lines: buildDisposalLines(figures, accounts, 'Pérdida por baja'),
    },
    tx
  );
}
