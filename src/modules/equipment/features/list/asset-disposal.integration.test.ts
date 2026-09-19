/**
 * Tests de integración de las bajas de equipos y del ajuste de valor con las
 * cuentas de Bienes de Uso resueltas (TSK-724c, fase 5) contra la base real.
 *
 * Mismo andamiaje que `depreciation/asset-accounts.integration.test.ts`
 * (`describe.skipIf` sin base, `vi.mock` de la frontera de sesión/permisos/
 * caché de Next y `server-only`, limpieza + verificación en el `afterAll`).
 * Prefijo PROPIO (`TSK724C-BAJA-`): Vitest corre los archivos en paralelo y
 * el `afterAll` del test de amortización cuenta lo que empieza con
 * `TSK724C-TEST-`; compartir prefijo lo haría fallar por carrera.
 *
 * Se ejercita el CÓDIGO REAL de `softDeleteVehicle` y `createValueAdjustment`.
 * Qué se prueba: la baja por venta usa las cuentas del TIPO, la baja por
 * pérdida respeta el override de la depreciación, sin cuentas la baja se
 * rechaza ANTES de tocar el equipo (`{ success: false, error }`, nunca
 * `throw`), la cuenta de resultado global faltante y el período cerrado
 * llegan como mensaje, un equipo sin depreciación o con motivo "Otro" se da de
 * baja sin asiento (`journalEntryId: null`), y el ajuste de valor genera
 * siempre asiento o no se guarda.
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
// Código real de producción: nada de esto se reimplementa acá.
import { createValueAdjustment } from '../depreciation/actions.server';
import { softDeleteVehicle } from './actions.server';

const PREFIX = 'TSK724C-BAJA-';

let dbAvailable = false;
try {
  await prisma.$queryRaw`SELECT 1`;
  dbAvailable = true;
} catch {
  dbAvailable = false;
}

interface JournalLineRow {
  accountId: string;
  debit: number;
  credit: number;
}

async function fetchLines(journalEntryId: string): Promise<JournalLineRow[]> {
  const rows = await prisma.journalEntryLine.findMany({
    where: { entryId: journalEntryId },
    select: { accountId: true, debit: true, credit: true },
  });
  return rows.map((r) => ({
    accountId: r.accountId,
    debit: Number(r.debit),
    credit: Number(r.credit),
  }));
}

interface TestVehicle {
  vehicleId: string;
  depreciationId: string | null;
  internNumber: string;
}

const GROSS = 120000;
const DEPRECIATED = 10000;

describe.skipIf(!dbAvailable)(
  'integración: bajas y ajuste de valor con cuentas de Bienes de Uso (TSK-724c)',
  () => {
    let companyId: string;

    // Cuentas
    let buGlobalId: string;
    let aaGlobalId: string;
    let buRodadosId: string;
    let aaRodadosId: string;
    let buPropioId: string;
    let resultadoBajaId: string;

    // Tipos
    const sinCuentasTypeName = `${PREFIX}Sin cuentas`;

    // Equipos
    let conTipo: TestVehicle;
    let conOverride: TestVehicle;
    let sinNada: TestVehicle;
    let sinDepreciacion: TestVehicle;
    let ajuste: TestVehicle;

    async function expectActive(vehicleId: string) {
      const vehicle = await prisma.vehicle.findUniqueOrThrow({
        where: { id: vehicleId },
        select: { isActive: true, terminationDate: true, terminationReason: true },
      });
      expect(vehicle).toEqual({ isActive: true, terminationDate: null, terminationReason: null });
    }

    async function createVehicle(
      internNumber: string,
      typeId: string,
      typeOfVehicleId: string,
      depreciation: { withDepreciation: boolean; fixedAssetAccountId?: string }
    ): Promise<TestVehicle> {
      const vehicle = await prisma.vehicle.create({
        data: {
          companyId,
          internNumber,
          engine: `${PREFIX}MOTOR-${internNumber}`,
          year: '2024',
          typeId,
          typeOfVehicleId,
        },
        select: { id: true },
      });
      if (!depreciation.withDepreciation) {
        return { vehicleId: vehicle.id, depreciationId: null, internNumber };
      }

      // Estado "p1 contabilizado": 10.000 amortizados, valor libro 110.000.
      const created = await prisma.vehicleDepreciation.create({
        data: {
          vehicleId: vehicle.id,
          companyId,
          method: 'STRAIGHT_LINE',
          grossValue: GROSS,
          salvageValue: 0,
          currentBookValue: GROSS - DEPRECIATED,
          totalDepreciated: DEPRECIATED,
          usefulLifeMonths: 12,
          startDate: new Date('2026-01-01T12:00:00.000Z'),
          createdBy: `${PREFIX}user`,
          fixedAssetAccountId: depreciation.fixedAssetAccountId,
          scheduleEntries: {
            create: [1, 2, 3].map((periodNumber) => ({
              periodNumber,
              scheduledDate: new Date(`2026-0${periodNumber}-15T12:00:00.000Z`),
              amount: DEPRECIATED,
              accumulatedAmount: DEPRECIATED * periodNumber,
              bookValueAfter: GROSS - DEPRECIATED * periodNumber,
              isPosted: periodNumber === 1,
            })),
          },
        },
        select: { id: true },
      });
      return { vehicleId: vehicle.id, depreciationId: created.id, internNumber };
    }

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

      const [buGlobal, aaGlobal, buRodados, aaRodados, buPropio, gastoGlobal, resultadoBaja] =
        await Promise.all([
          account('T724CB-BU-GLOBAL', 'Bienes de Uso (por defecto)', 'ASSET'),
          account('T724CB-AA-GLOBAL', 'Amortización acumulada (por defecto)', 'ASSET'),
          account('T724CB-BU-RODADOS', 'Rodados', 'ASSET'),
          account('T724CB-AA-RODADOS', 'Amortización acumulada Rodados', 'ASSET'),
          account('T724CB-BU-PROPIO', 'Bienes de Uso equipo propio', 'ASSET'),
          account('T724CB-GASTO-GLOBAL', 'Gasto de amortización (por defecto)', 'EXPENSE'),
          account('T724CB-RESULTADO-BAJA', 'Resultado por baja de Bienes de Uso', 'EXPENSE'),
        ]);
      buGlobalId = buGlobal.id;
      aaGlobalId = aaGlobal.id;
      buRodadosId = buRodados.id;
      aaRodadosId = aaRodados.id;
      buPropioId = buPropio.id;
      resultadoBajaId = resultadoBaja.id;

      await prisma.accountingSettings.create({
        data: {
          companyId,
          fiscalYearStart: new Date('2026-01-01'),
          fiscalYearEnd: new Date('2026-12-31'),
          lastEntryNumber: 0,
          fixedAssetAccountId: buGlobalId,
          accumulatedDepreciationAccountId: aaGlobalId,
          depreciationExpenseAccountId: gastoGlobal.id,
          assetDisposalGainLossAccountId: resultadoBajaId,
        },
      });

      const typeOfVehicle = await prisma.typeOfVehicle.create({
        data: { companyId, name: `${PREFIX}Vehículos` },
        select: { id: true },
      });

      const [camion, sinCuentasType] = await Promise.all([
        prisma.vehicleType.create({
          data: {
            companyId,
            name: `${PREFIX}Camión`,
            fixedAssetAccountId: buRodadosId,
            accumulatedDepreciationAccountId: aaRodadosId,
          },
          select: { id: true },
        }),
        prisma.vehicleType.create({
          data: { companyId, name: sinCuentasTypeName },
          select: { id: true },
        }),
      ]);

      const tov = typeOfVehicle.id;
      conTipo = await createVehicle(`${PREFIX}CON-TIPO`, camion.id, tov, {
        withDepreciation: true,
      });
      conOverride = await createVehicle(`${PREFIX}CON-OVERRIDE`, camion.id, tov, {
        withDepreciation: true,
        fixedAssetAccountId: buPropioId,
      });
      sinNada = await createVehicle(`${PREFIX}SIN-NADA`, sinCuentasType.id, tov, {
        withDepreciation: true,
      });
      sinDepreciacion = await createVehicle(`${PREFIX}SIN-DEPRECIACION`, camion.id, tov, {
        withDepreciation: false,
      });
      ajuste = await createVehicle(`${PREFIX}AJUSTE`, camion.id, tov, {
        withDepreciation: true,
      });

      vi.mocked(getActiveCompanyId).mockResolvedValue(companyId);
      vi.mocked(getCurrentUserId).mockResolvedValue(`${PREFIX}user`);
    });

    afterAll(async () => {
      // Guarda: sin `companyId` Prisma omite el filtro y borraría tablas enteras.
      if (companyId) {
        await prisma.depreciationScheduleEntry.deleteMany({
          where: { depreciation: { companyId } },
        });
        await prisma.assetValueAdjustment.deleteMany({ where: { companyId } });
        await prisma.journalEntry.deleteMany({ where: { companyId } });
        await prisma.vehicleDepreciation.deleteMany({ where: { companyId } });
        await prisma.vehicle.deleteMany({ where: { companyId } });
        await prisma.vehicleType.deleteMany({ where: { companyId } });
        await prisma.typeOfVehicle.deleteMany({ where: { companyId } });
        await prisma.accountingSettings.deleteMany({ where: { companyId } });
        await prisma.account.deleteMany({ where: { companyId } });
        await prisma.company.deleteMany({ where: { id: companyId } });
      }

      const [remainingVehicles, remainingTypes, remainingAccounts, remainingCompanies] =
        await Promise.all([
          prisma.vehicle.count({ where: { internNumber: { startsWith: PREFIX } } }),
          prisma.vehicleType.count({ where: { name: { startsWith: PREFIX } } }),
          prisma.account.count({ where: { name: { startsWith: PREFIX } } }),
          prisma.company.count({ where: { name: { startsWith: PREFIX } } }),
        ]);
      expect(remainingVehicles).toBe(0);
      expect(remainingTypes).toBe(0);
      expect(remainingAccounts).toBe(0);
      expect(remainingCompanies).toBe(0);

      await prisma.$disconnect();
    });

    describe('caso 1: baja por venta con cuentas del tipo', () => {
      it('genera el asiento con BU y AA Rodados, da de baja y completa la depreciación', async () => {
        const result = await softDeleteVehicle(conTipo.vehicleId, 'SALE');
        expect(result.success).toBe(true);
        if (!result.success) throw new Error(result.error);
        expect(result.journalEntryId).toBeTruthy();

        const lines = await fetchLines(result.journalEntryId!);
        expect(lines).toHaveLength(3);
        expect(lines.find((l) => l.accountId === aaRodadosId)).toMatchObject({
          debit: DEPRECIATED,
          credit: 0,
        });
        expect(lines.find((l) => l.accountId === buRodadosId)).toMatchObject({
          debit: 0,
          credit: GROSS,
        });
        expect(lines.find((l) => l.accountId === resultadoBajaId)).toMatchObject({
          debit: GROSS - DEPRECIATED,
          credit: 0,
        });
        expect(lines.some((l) => l.accountId === buGlobalId)).toBe(false);
        expect(lines.some((l) => l.accountId === aaGlobalId)).toBe(false);

        const vehicle = await prisma.vehicle.findUniqueOrThrow({
          where: { id: conTipo.vehicleId },
          select: { isActive: true, terminationReason: true, terminationDate: true },
        });
        expect(vehicle.isActive).toBe(false);
        expect(vehicle.terminationReason).toBe('SALE');
        expect(vehicle.terminationDate).not.toBeNull();

        const depreciation = await prisma.vehicleDepreciation.findUniqueOrThrow({
          where: { id: conTipo.depreciationId! },
          select: { status: true },
        });
        expect(depreciation.status).toBe('COMPLETED');
      });
    });

    describe('caso 2: baja sin cuenta de Bienes de Uso en ningún nivel', () => {
      it('devuelve { success: false } nombrando equipo, cuenta y operación; el equipo sigue activo', async () => {
        await prisma.accountingSettings.update({
          where: { companyId },
          data: { fixedAssetAccountId: null },
        });
        const entriesBefore = await prisma.journalEntry.count({ where: { companyId } });

        try {
          const result = await softDeleteVehicle(sinNada.vehicleId, 'TOTAL_LOSS');
          expect(result.success).toBe(false);
          if (result.success) return;
          expect(result.error).toContain(`«${sinNada.internNumber}»`);
          expect(result.error).toContain('Bienes de Uso');
          expect(result.error).toContain('la baja');
          expect(result.error).toContain(`«${sinCuentasTypeName}»`);

          await expectActive(sinNada.vehicleId);
          expect(await prisma.journalEntry.count({ where: { companyId } })).toBe(entriesBefore);
        } finally {
          await prisma.accountingSettings.update({
            where: { companyId },
            data: { fixedAssetAccountId: buGlobalId },
          });
        }
      });
    });

    describe('caso 3: falta la cuenta de resultado global', () => {
      it('rechaza la baja nombrando "Resultado por venta/baja de Bienes de Uso"', async () => {
        await prisma.accountingSettings.update({
          where: { companyId },
          data: { assetDisposalGainLossAccountId: null },
        });
        try {
          const result = await softDeleteVehicle(conOverride.vehicleId, 'RETURN');
          expect(result.success).toBe(false);
          if (result.success) return;
          expect(result.error).toContain('Resultado por venta/baja de Bienes de Uso');
          expect(result.error).toContain('Contabilidad → Configuración');
          await expectActive(conOverride.vehicleId);
        } finally {
          await prisma.accountingSettings.update({
            where: { companyId },
            data: { assetDisposalGainLossAccountId: resultadoBajaId },
          });
        }
      });
    });

    describe('caso 4: período cerrado', () => {
      it('el mensaje de período cerrado llega como dato y el equipo sigue activo', async () => {
        await prisma.accountingSettings.update({
          where: { companyId },
          data: { lockedUntilDate: new Date('2099-12-31T00:00:00.000Z') },
        });
        try {
          const result = await softDeleteVehicle(conOverride.vehicleId, 'SALE');
          expect(result.success).toBe(false);
          if (result.success) return;
          expect(result.error).toContain('período está cerrado');
          await expectActive(conOverride.vehicleId);
        } finally {
          await prisma.accountingSettings.update({
            where: { companyId },
            data: { lockedUntilDate: null },
          });
        }
      });
    });

    describe('caso 5: baja por pérdida total con override de la depreciación', () => {
      it('usa la cuenta de Bienes de Uso PROPIA y la acumulada del tipo', async () => {
        const result = await softDeleteVehicle(conOverride.vehicleId, 'TOTAL_LOSS');
        expect(result.success).toBe(true);
        if (!result.success) throw new Error(result.error);

        const lines = await fetchLines(result.journalEntryId!);
        expect(lines).toHaveLength(3);
        expect(lines.find((l) => l.accountId === buPropioId)).toMatchObject({
          debit: 0,
          credit: GROSS,
        });
        expect(lines.find((l) => l.accountId === aaRodadosId)).toMatchObject({
          debit: DEPRECIATED,
          credit: 0,
        });
        expect(lines.find((l) => l.accountId === resultadoBajaId)).toMatchObject({
          debit: GROSS - DEPRECIATED,
          credit: 0,
        });
        expect(lines.some((l) => l.accountId === buRodadosId)).toBe(false);
      });
    });

    describe('caso 6: equipo sin depreciación y motivo "Otro"', () => {
      it('da de baja un equipo sin depreciación sin generar asiento', async () => {
        const entriesBefore = await prisma.journalEntry.count({ where: { companyId } });

        const result = await softDeleteVehicle(sinDepreciacion.vehicleId, 'RETURN');
        expect(result).toEqual({ success: true, journalEntryId: null });

        const vehicle = await prisma.vehicle.findUniqueOrThrow({
          where: { id: sinDepreciacion.vehicleId },
          select: { isActive: true, terminationReason: true },
        });
        expect(vehicle).toEqual({ isActive: false, terminationReason: 'RETURN' });
        expect(await prisma.journalEntry.count({ where: { companyId } })).toBe(entriesBefore);
      });

      it('con motivo "Otro" da de baja sin asiento aunque tenga depreciación', async () => {
        const entriesBefore = await prisma.journalEntry.count({ where: { companyId } });

        const result = await softDeleteVehicle(sinNada.vehicleId, 'OTHER');
        expect(result).toEqual({ success: true, journalEntryId: null });

        const vehicle = await prisma.vehicle.findUniqueOrThrow({
          where: { id: sinNada.vehicleId },
          select: { isActive: true, terminationReason: true },
        });
        expect(vehicle).toEqual({ isActive: false, terminationReason: 'OTHER' });
        expect(await prisma.journalEntry.count({ where: { companyId } })).toBe(entriesBefore);
      });

      it('un equipo ya dado de baja no se vuelve a dar de baja', async () => {
        const result = await softDeleteVehicle(sinNada.vehicleId, 'SALE');
        expect(result.success).toBe(false);
        if (result.success) return;
        expect(result.error).toContain('ya está dado de baja');
      });
    });

    describe('caso 7: ajuste de valor', () => {
      it('sin cuenta de resultado global devuelve { success: false } y NO guarda el ajuste', async () => {
        await prisma.accountingSettings.update({
          where: { companyId },
          data: { assetDisposalGainLossAccountId: null },
        });
        try {
          const result = await createValueAdjustment(ajuste.vehicleId, {
            date: new Date('2026-03-31T12:00:00.000Z'),
            newValue: 90000,
            reason: 'Deterioro',
          });
          expect(result.success).toBe(false);
          if (result.success) return;
          expect(result.error).toContain('Resultado por venta/baja de Bienes de Uso');
          expect(result.error).toContain(`«${ajuste.internNumber}»`);

          const adjustments = await prisma.assetValueAdjustment.count({
            where: { vehicleId: ajuste.vehicleId },
          });
          expect(adjustments).toBe(0);
          const depreciation = await prisma.vehicleDepreciation.findUniqueOrThrow({
            where: { id: ajuste.depreciationId! },
            select: { currentBookValue: true },
          });
          expect(Number(depreciation.currentBookValue)).toBe(GROSS - DEPRECIATED);
        } finally {
          await prisma.accountingSettings.update({
            where: { companyId },
            data: { assetDisposalGainLossAccountId: resultadoBajaId },
          });
        }
      });

      it('con cuentas resueltas genera el asiento de deterioro con las del tipo', async () => {
        const result = await createValueAdjustment(ajuste.vehicleId, {
          date: new Date('2026-03-31T12:00:00.000Z'),
          newValue: 90000,
          reason: 'Deterioro',
        });
        expect(result.success).toBe(true);
        if (!result.success) throw new Error(result.error);

        const difference = GROSS - DEPRECIATED - 90000; // 20.000
        const lines = await fetchLines(result.journalEntryId);
        expect(lines).toHaveLength(2);
        expect(lines.find((l) => l.accountId === resultadoBajaId)).toMatchObject({
          debit: difference,
          credit: 0,
        });
        expect(lines.find((l) => l.accountId === aaRodadosId)).toMatchObject({
          debit: 0,
          credit: difference,
        });
        expect(lines.some((l) => l.accountId === aaGlobalId)).toBe(false);

        const adjustment = await prisma.assetValueAdjustment.findFirstOrThrow({
          where: { vehicleId: ajuste.vehicleId },
          select: { journalEntryId: true, differenceAmount: true },
        });
        expect(adjustment.journalEntryId).toBe(result.journalEntryId);
        expect(Number(adjustment.differenceAmount)).toBe(-difference);

        const depreciation = await prisma.vehicleDepreciation.findUniqueOrThrow({
          where: { id: ajuste.depreciationId! },
          select: { currentBookValue: true },
        });
        expect(Number(depreciation.currentBookValue)).toBe(90000);
      });
    });
  }
);
