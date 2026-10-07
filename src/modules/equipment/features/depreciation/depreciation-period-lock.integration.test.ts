/**
 * Tests de integración del período cerrado en la amortización y el revalúo
 * (TSK-760, fase 5) contra la base real de desarrollo.
 *
 * Mismo andamiaje que `asset-accounts.integration.test.ts` (`describe.skipIf`
 * sin base, `vi.mock` de la frontera de sesión/permisos/caché de Next y
 * `server-only`), con prefijo PROPIO (`TSK760-DEP-`): Vitest corre los archivos
 * en paralelo y los `afterAll` cuentan por prefijo.
 *
 * Se ejercita el CÓDIGO REAL de `postDepreciationEntry`, `createValueAdjustment`
 * y `postAllPendingDepreciations`. Qué se prueba:
 * - un mes cerrado por `AccountingPeriod` (sin `lockedUntilDate`, B3) rechaza la
 *   amortización individual y el revalúo con el texto estándar, sin consumir
 *   número y sin marcar nada;
 * - en mes abierto el asiento nace DRAFT con `fiscalYearId`/`periodId` del mes;
 * - la masiva informa el mes cerrado en `errors[]` y sigue con los demás equipos;
 * - la masiva ya no omite en silencio lo bloqueado por `lockedUntilDate`
 *   (escenario 10 de 1.6.2): aparece en `errors[]`.
 */
import 'dotenv/config';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { prisma } from '@/shared/lib/prisma';

// Frontera aislada: sesión/permisos/empresa activa/caché de Next.
vi.mock('server-only', () => ({}));
vi.mock('@/shared/lib/current-user', () => ({ getCurrentUserId: vi.fn() }));
vi.mock('@/shared/lib/company', () => ({ getActiveCompanyId: vi.fn() }));
vi.mock('@/shared/lib/permissions', () => ({
  checkPermission: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { getActiveCompanyId } from '@/shared/lib/company';
import { getCurrentUserId } from '@/shared/lib/current-user';
import { cleanupAccountingCompany } from '@/modules/accounting/shared/test-utils/cleanup-accounting-company';
import {
  closeMonthForTest,
  readEntryPeriod,
  readLastEntryNumber,
} from '@/modules/accounting/shared/test-utils/period-test-helpers';
// Código real de producción.
import {
  createValueAdjustment,
  postAllPendingDepreciations,
  postDepreciationEntry,
} from './actions.server';

const PREFIX = 'TSK760-DEP-';
const AMOUNT = 10000;
const GROSS = 120000;

let dbAvailable = false;
try {
  await prisma.$queryRaw`SELECT 1`;
  dbAvailable = true;
} catch {
  dbAvailable = false;
}

interface TestVehicle {
  vehicleId: string;
  depreciationId: string;
  label: string;
  /** Ids de los períodos en orden. */
  periods: string[];
}

const closedMessage = (day: string, month: string) =>
  `No se puede registrar con fecha ${day}: el período está cerrado (mes ${month} cerrado).`;

describe.skipIf(!dbAvailable)('integración: período cerrado en amortización y revalúo (TSK-760)', () => {
  let companyId: string;
  let camionTypeId: string;
  let typeOfVehicleId: string;

  /** Equipo con 3 períodos mensuales a partir de `firstMonth` (día 15, 12:00Z). */
  async function createVehicle(suffix: string, firstMonth: number): Promise<TestVehicle> {
    const label = `${PREFIX}${suffix}`;
    const vehicle = await prisma.vehicle.create({
      data: {
        companyId,
        internNumber: label,
        engine: `${PREFIX}MOTOR-${suffix}`,
        year: '2024',
        typeId: camionTypeId,
        typeOfVehicleId,
      },
      select: { id: true },
    });
    const depreciation = await prisma.vehicleDepreciation.create({
      data: {
        vehicleId: vehicle.id,
        companyId,
        method: 'STRAIGHT_LINE',
        grossValue: GROSS,
        salvageValue: 0,
        currentBookValue: GROSS,
        usefulLifeMonths: 12,
        startDate: new Date(Date.UTC(2026, firstMonth - 1, 1, 12)),
        createdBy: `${PREFIX}user`,
        scheduleEntries: {
          create: [1, 2, 3].map((periodNumber) => ({
            periodNumber,
            scheduledDate: new Date(Date.UTC(2026, firstMonth + periodNumber - 2, 15, 12)),
            amount: AMOUNT,
            accumulatedAmount: AMOUNT * periodNumber,
            bookValueAfter: GROSS - AMOUNT * periodNumber,
          })),
        },
      },
      select: {
        id: true,
        scheduleEntries: { select: { id: true }, orderBy: { periodNumber: 'asc' } },
      },
    });
    return {
      vehicleId: vehicle.id,
      depreciationId: depreciation.id,
      label,
      periods: depreciation.scheduleEntries.map((e) => e.id),
    };
  }

  /** Saca al equipo de la masiva (solo toma depreciaciones ACTIVE). */
  const suspend = (v: TestVehicle) =>
    prisma.vehicleDepreciation.update({
      where: { id: v.depreciationId },
      data: { status: 'SUSPENDED' },
    });

  const readPeriod = (id: string) =>
    prisma.depreciationScheduleEntry.findUniqueOrThrow({
      where: { id },
      select: { isPosted: true, journalEntryId: true },
    });

  beforeAll(async () => {
    const company = await prisma.company.create({
      data: { name: `${PREFIX}Empresa`, isActive: true },
    });
    companyId = company.id;

    const account = (code: string, name: string, type: 'ASSET' | 'EXPENSE') =>
      prisma.account.create({
        data: { companyId, code, name: `${PREFIX}${name}`, type, nature: 'DEBIT' },
        select: { id: true },
      });
    const [bu, aa, gasto, resultado] = await Promise.all([
      account('T760D-BU', 'Bienes de Uso', 'ASSET'),
      account('T760D-AA', 'Amortización acumulada', 'ASSET'),
      account('T760D-GASTO', 'Gasto de amortización', 'EXPENSE'),
      account('T760D-RESULTADO', 'Resultado por baja', 'EXPENSE'),
    ]);

    await prisma.accountingSettings.create({
      data: {
        companyId,
        fiscalYearStart: new Date('2026-01-01'),
        fiscalYearEnd: new Date('2026-12-31'),
        lastEntryNumber: 0,
        fixedAssetAccountId: bu.id,
        accumulatedDepreciationAccountId: aa.id,
        depreciationExpenseAccountId: gasto.id,
        assetDisposalGainLossAccountId: resultado.id,
      },
    });

    const typeOfVehicle = await prisma.typeOfVehicle.create({
      data: { companyId, name: `${PREFIX}Vehículos` },
      select: { id: true },
    });
    typeOfVehicleId = typeOfVehicle.id;
    const camion = await prisma.vehicleType.create({
      data: { companyId, name: `${PREFIX}Camión` },
      select: { id: true },
    });
    camionTypeId = camion.id;

    vi.mocked(getActiveCompanyId).mockResolvedValue(companyId);
    vi.mocked(getCurrentUserId).mockResolvedValue(`${PREFIX}user`);
  });

  afterAll(async () => {
    // Guarda: sin `companyId` Prisma omite el filtro y borraría tablas enteras.
    if (companyId) {
      await prisma.depreciationScheduleEntry.deleteMany({ where: { depreciation: { companyId } } });
      await prisma.assetValueAdjustment.deleteMany({ where: { companyId } });
      await cleanupAccountingCompany(companyId);
      await prisma.vehicleDepreciation.deleteMany({ where: { companyId } });
      await prisma.vehicle.deleteMany({ where: { companyId } });
      await prisma.vehicleType.deleteMany({ where: { companyId } });
      await prisma.typeOfVehicle.deleteMany({ where: { companyId } });
      await prisma.accountingSettings.deleteMany({ where: { companyId } });
      await prisma.account.deleteMany({ where: { companyId } });
      await prisma.company.deleteMany({ where: { id: companyId } });
    }

    const [companies, accounts, vehicles, fiscalYears] = await Promise.all([
      prisma.company.count({ where: { name: { startsWith: PREFIX } } }),
      prisma.account.count({ where: { name: { startsWith: PREFIX } } }),
      prisma.vehicle.count({ where: { internNumber: { startsWith: PREFIX } } }),
      companyId ? prisma.fiscalYear.count({ where: { companyId } }) : Promise.resolve(0),
    ]);
    expect(companies).toBe(0);
    expect(accounts).toBe(0);
    expect(vehicles).toBe(0);
    expect(fiscalYears).toBe(0);

    await prisma.$disconnect();
  });

  it('individual: mes cerrado → error legible sin número ni marca; abierto → asiento DRAFT con ejercicio y período', async () => {
    const v = await createVehicle('IND', 1);
    const reopen = await closeMonthForTest(companyId, new Date('2026-01-15T12:00:00Z'));
    const counterBefore = await readLastEntryNumber(companyId);
    try {
      const result = await postDepreciationEntry(v.periods[0]);
      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error).toContain(closedMessage('15/01/2026', '01/2026'));
      expect(await readPeriod(v.periods[0])).toEqual({ isPosted: false, journalEntryId: null });
      expect(await readLastEntryNumber(companyId)).toBe(counterBefore);
    } finally {
      await reopen();
    }

    const ok = await postDepreciationEntry(v.periods[0]);
    expect(ok.success).toBe(true);
    if (!ok.success) return;
    const entry = await readEntryPeriod(ok.journalEntryId);
    expect(entry.status).toBe('DRAFT');
    expect(entry.createdBy).toBe('system');
    expect(entry.fiscalYearId).not.toBeNull();
    expect(entry.period).toMatchObject({ year: 2026, month: 1, type: 'MONTHLY' });
    expect(entry.period?.fiscalYearId).toBe(entry.fiscalYearId);

    await suspend(v);
  });

  it('revalúo: mes cerrado → error legible, sin ajuste ni número; abierto → asiento con ejercicio y período', async () => {
    const v = await createVehicle('AJUSTE', 4);
    const date = new Date('2026-04-20T12:00:00Z');
    const reopen = await closeMonthForTest(companyId, date);
    const counterBefore = await readLastEntryNumber(companyId);
    try {
      const result = await createValueAdjustment(v.vehicleId, {
        date,
        newValue: 100000,
        reason: 'Deterioro',
      });
      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error).toContain(closedMessage('20/04/2026', '04/2026'));

      expect(await prisma.assetValueAdjustment.count({ where: { vehicleId: v.vehicleId } })).toBe(0);
      const depreciation = await prisma.vehicleDepreciation.findUniqueOrThrow({
        where: { id: v.depreciationId },
        select: { currentBookValue: true },
      });
      expect(Number(depreciation.currentBookValue)).toBe(GROSS);
      expect(await readLastEntryNumber(companyId)).toBe(counterBefore);
    } finally {
      await reopen();
    }

    const ok = await createValueAdjustment(v.vehicleId, {
      date,
      newValue: 100000,
      reason: 'Deterioro',
    });
    expect(ok.success).toBe(true);
    if (!ok.success) return;
    const entry = await readEntryPeriod(ok.journalEntryId);
    expect(entry.status).toBe('DRAFT');
    expect(entry.fiscalYearId).not.toBeNull();
    expect(entry.period).toMatchObject({ year: 2026, month: 4, type: 'MONTHLY' });

    await suspend(v);
  });

  describe('masiva', () => {
    let enero: TestVehicle;
    let marzo: TestVehicle;

    beforeAll(async () => {
      enero = await createVehicle('MAS-ENE', 1); // ene, feb, mar
      marzo = await createVehicle('MAS-MAR', 3); // mar, abr, may
    });

    it('un mes cerrado aparece en errors[] con el mes y los demás se contabilizan', async () => {
      const reopen = await closeMonthForTest(companyId, new Date('2026-02-15T12:00:00Z'));
      const counterBefore = await readLastEntryNumber(companyId);
      try {
        const result = await postAllPendingDepreciations(new Date('2026-03-31T23:59:59.000Z'));
        expect(result.success).toBe(true);
        if (!result.success) return;

        // Contabilizados: enero p1 (ene) y marzo p1 (mar). Febrero cerrado → error;
        // marzo de "enero" → omitido porque el anterior no se contabilizó.
        expect(result.posted).toBe(2);
        expect(await readLastEntryNumber(companyId)).toBe(counterBefore + 2);

        const eneroErrors = result.errors.filter((e) => e.vehicleId === enero.vehicleId);
        expect(eneroErrors.map((e) => e.message)).toEqual([
          `Equipo ${enero.label}: ${closedMessage('15/02/2026', '02/2026')} Para operar, reabrilo desde Contabilidad → Configuración → Bloqueo de Períodos.`,
          `Equipo ${enero.label}: período 3 omitido (anterior no contabilizado)`,
        ]);
        expect(result.errors.some((e) => e.vehicleId === marzo.vehicleId)).toBe(false);

        expect((await readPeriod(enero.periods[0])).isPosted).toBe(true);
        expect(await readPeriod(enero.periods[1])).toEqual({ isPosted: false, journalEntryId: null });
        const marzoP1 = await readPeriod(marzo.periods[0]);
        expect(marzoP1.isPosted).toBe(true);
        const entry = await readEntryPeriod(marzoP1.journalEntryId!);
        expect(entry.period).toMatchObject({ year: 2026, month: 3, type: 'MONTHLY' });
      } finally {
        await reopen();
      }
    });

    it('lo bloqueado por lockedUntilDate ya no se omite en silencio: aparece en errors[] (escenario 10)', async () => {
      await prisma.accountingSettings.update({
        where: { companyId },
        data: { lockedUntilDate: new Date('2026-02-28T23:59:59.999Z') },
      });
      const counterBefore = await readLastEntryNumber(companyId);
      try {
        const result = await postAllPendingDepreciations(new Date('2026-03-31T23:59:59.000Z'));
        expect(result.success).toBe(true);
        if (!result.success) return;

        expect(result.posted).toBe(0);
        expect(await readLastEntryNumber(companyId)).toBe(counterBefore);
        expect(result.errors.map((e) => e.message)).toEqual([
          `Equipo ${enero.label}: No se puede registrar con fecha 15/02/2026: el período está cerrado (bloqueado hasta 28/02/2026). Para operar, reabrilo desde Contabilidad → Configuración → Bloqueo de Períodos.`,
          `Equipo ${enero.label}: período 3 omitido (anterior no contabilizado)`,
        ]);
      } finally {
        await prisma.accountingSettings.update({
          where: { companyId },
          data: { lockedUntilDate: null },
        });
      }
    });
  });
});
