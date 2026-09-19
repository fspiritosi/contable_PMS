/**
 * Tests de integración de las cuentas de Bienes de Uso en la amortización
 * (TSK-724c, fase 4) contra la base real de desarrollo.
 *
 * Mismo andamiaje que `fund-movement-partner-account.integration.test.ts`:
 * `describe.skipIf` cuando no hay base, prefijo `TSK724C-TEST-` en todo lo que
 * se crea, los `vi.mock` de la frontera de sesión/permisos/caché de Next
 * (más `server-only`, que el loader importa como marcador) y limpieza +
 * verificación en el `afterAll`. Se ejercita el CÓDIGO REAL de
 * `postDepreciationEntry`, `postAllPendingDepreciations`,
 * `updateDepreciationAccounts`, `getVehicleAssetAccounts` y
 * `getPendingDepreciationsSummary`, sin ninguna réplica.
 *
 * Qué se prueba: que el asiento de amortización usa las cuentas del TIPO de
 * equipo, que el override de la depreciación gana por cuenta (independiente
 * de las otras dos), que sin cuenta propia ni de tipo cae a las "por defecto"
 * de Ajustes contables, y que sin ninguna -o con una cuenta resuelta no
 * imputable- la contabilización falla con `{ success: false, error }` (nunca
 * `throw`) nombrando equipo, cuenta y dónde configurarla, sin asiento ni
 * `isPosted`. En la masiva, un equipo sin cuentas no frena a los demás y su
 * mensaje viaja en `errors[]`. Los casos de baja y ajuste (fase 5) se agregan
 * a este mismo archivo.
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
import {
  getPendingDepreciationsSummary,
  getVehicleAssetAccounts,
  postAllPendingDepreciations,
  postDepreciationEntry,
  updateDepreciationAccounts,
} from './actions.server';

const PREFIX = 'TSK724C-TEST-';

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

async function fetchEntryLines(scheduleEntryId: string): Promise<JournalLineRow[]> {
  const entry = await prisma.depreciationScheduleEntry.findUniqueOrThrow({
    where: { id: scheduleEntryId },
    select: { journalEntryId: true, isPosted: true },
  });
  expect(entry.isPosted).toBe(true);
  if (!entry.journalEntryId) throw new Error('El período no tiene asiento generado');

  const rows = await prisma.journalEntryLine.findMany({
    where: { entryId: entry.journalEntryId },
    select: { accountId: true, debit: true, credit: true },
  });
  return rows.map((r) => ({
    accountId: r.accountId,
    debit: Number(r.debit),
    credit: Number(r.credit),
  }));
}

async function expectNotPosted(scheduleEntryId: string) {
  const entry = await prisma.depreciationScheduleEntry.findUniqueOrThrow({
    where: { id: scheduleEntryId },
    select: { isPosted: true, journalEntryId: true },
  });
  expect(entry).toMatchObject({ isPosted: false, journalEntryId: null });
}

interface TestVehicle {
  vehicleId: string;
  depreciationId: string;
  internNumber: string;
  /** Ids de los períodos 1, 2 y 3. */
  periods: [string, string, string];
}

const AMOUNT = 10000;

describe.skipIf(!dbAvailable)(
  'integración: cuentas de Bienes de Uso en la amortización (TSK-724c)',
  () => {
    let companyId: string;

    // Cuentas
    let buGlobalId: string;
    let aaGlobalId: string;
    let gastoGlobalId: string;
    let buRodadosId: string;
    let aaRodadosId: string;
    let gastoExplotacionId: string;
    let gastoPropioId: string;
    let aaViejaId: string;
    const aaViejaCode = 'T724C-AA-VIEJA';

    // Tipos
    let camionTypeId: string;
    const sinCuentasTypeName = `${PREFIX}Sin cuentas`;

    // Equipos
    let conTipo: TestVehicle;
    let conOverride: TestVehicle;
    let sinNada: TestVehicle;
    let secuencia: TestVehicle;

    async function createVehicleWithDepreciation(
      internNumber: string,
      typeId: string,
      typeOfVehicleId: string,
      overrides: { depreciationExpenseAccountId?: string } = {}
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

      const depreciation = await prisma.vehicleDepreciation.create({
        data: {
          vehicleId: vehicle.id,
          companyId,
          method: 'STRAIGHT_LINE',
          grossValue: 120000,
          salvageValue: 0,
          currentBookValue: 120000,
          usefulLifeMonths: 12,
          startDate: new Date('2026-01-01T12:00:00.000Z'),
          createdBy: `${PREFIX}user`,
          ...overrides,
          scheduleEntries: {
            create: [1, 2, 3].map((periodNumber) => ({
              periodNumber,
              scheduledDate: new Date(`2026-0${periodNumber}-15T12:00:00.000Z`),
              amount: AMOUNT,
              accumulatedAmount: AMOUNT * periodNumber,
              bookValueAfter: 120000 - AMOUNT * periodNumber,
            })),
          },
        },
        select: {
          id: true,
          scheduleEntries: { select: { id: true }, orderBy: { periodNumber: 'asc' } },
        },
      });

      const [p1, p2, p3] = depreciation.scheduleEntries.map((e) => e.id);
      return {
        vehicleId: vehicle.id,
        depreciationId: depreciation.id,
        internNumber,
        periods: [p1, p2, p3],
      };
    }

    beforeAll(async () => {
      const company = await prisma.company.create({
        data: { name: `${PREFIX}Empresa`, isActive: true },
      });
      companyId = company.id;

      const asset = (code: string, name: string) =>
        prisma.account.create({
          data: { companyId, code, name: `${PREFIX}${name}`, type: 'ASSET', nature: 'DEBIT' },
          select: { id: true },
        });
      const expense = (code: string, name: string) =>
        prisma.account.create({
          data: { companyId, code, name: `${PREFIX}${name}`, type: 'EXPENSE', nature: 'DEBIT' },
          select: { id: true },
        });

      const [buGlobal, aaGlobal, buRodados, aaRodados, aaVieja] = await Promise.all([
        asset('T724C-BU-GLOBAL', 'Bienes de Uso (por defecto)'),
        asset('T724C-AA-GLOBAL', 'Amortización acumulada (por defecto)'),
        asset('T724C-BU-RODADOS', 'Rodados'),
        asset('T724C-AA-RODADOS', 'Amortización acumulada Rodados'),
        asset(aaViejaCode, 'Amortización acumulada vieja'),
      ]);
      const [gastoGlobal, gastoExplotacion, gastoPropio, resultadoBaja] = await Promise.all([
        expense('T724C-GASTO-GLOBAL', 'Gasto de amortización (por defecto)'),
        expense('T724C-GASTO-EXPLOT', 'Amortización de equipos de explotación'),
        expense('T724C-GASTO-PROPIO', 'Amortización equipo propio'),
        expense('T724C-RESULTADO-BAJA', 'Resultado por baja de Bienes de Uso'),
      ]);
      buGlobalId = buGlobal.id;
      aaGlobalId = aaGlobal.id;
      gastoGlobalId = gastoGlobal.id;
      buRodadosId = buRodados.id;
      aaRodadosId = aaRodados.id;
      gastoExplotacionId = gastoExplotacion.id;
      gastoPropioId = gastoPropio.id;
      aaViejaId = aaVieja.id;

      await prisma.accountingSettings.create({
        data: {
          companyId,
          fiscalYearStart: new Date('2026-01-01'),
          fiscalYearEnd: new Date('2026-12-31'),
          lastEntryNumber: 0,
          fixedAssetAccountId: buGlobalId,
          accumulatedDepreciationAccountId: aaGlobalId,
          depreciationExpenseAccountId: gastoGlobalId,
          assetDisposalGainLossAccountId: resultadoBaja.id,
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
            depreciationExpenseAccountId: gastoExplotacionId,
          },
          select: { id: true },
        }),
        prisma.vehicleType.create({
          data: { companyId, name: sinCuentasTypeName },
          select: { id: true },
        }),
      ]);
      camionTypeId = camion.id;

      conTipo = await createVehicleWithDepreciation(
        `${PREFIX}CON-TIPO`,
        camionTypeId,
        typeOfVehicle.id
      );
      conOverride = await createVehicleWithDepreciation(
        `${PREFIX}CON-OVERRIDE`,
        camionTypeId,
        typeOfVehicle.id,
        { depreciationExpenseAccountId: gastoPropioId }
      );
      sinNada = await createVehicleWithDepreciation(
        `${PREFIX}SIN-NADA`,
        sinCuentasType.id,
        typeOfVehicle.id
      );
      secuencia = await createVehicleWithDepreciation(
        `${PREFIX}SECUENCIA`,
        camionTypeId,
        typeOfVehicle.id
      );

      vi.mocked(getActiveCompanyId).mockResolvedValue(companyId);
      vi.mocked(getCurrentUserId).mockResolvedValue(`${PREFIX}user`);
    });

    afterAll(async () => {
      // Guarda: sin `companyId` Prisma omite el filtro y borraría tablas enteras.
      if (companyId) {
        // Orden inverso de dependencias.
        await prisma.depreciationScheduleEntry.deleteMany({
          where: { depreciation: { companyId } },
        });
        await prisma.journalEntry.deleteMany({ where: { companyId } });
        await prisma.vehicleDepreciation.deleteMany({ where: { companyId } });
        await prisma.assetValueAdjustment.deleteMany({ where: { companyId } });
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

    describe('caso 1: equipo cuyo tipo tiene cuentas', () => {
      it('imputa el gasto y la acumulada del TIPO, no las por defecto', async () => {
        const result = await postDepreciationEntry(conTipo.periods[0]);
        expect(result.success).toBe(true);
        if (!result.success) throw new Error(result.error);
        expect(result.journalEntryNumber).toBeGreaterThan(0);

        const lines = await fetchEntryLines(conTipo.periods[0]);
        expect(lines).toHaveLength(2);
        expect(lines.find((l) => l.accountId === gastoExplotacionId)).toMatchObject({
          debit: AMOUNT,
          credit: 0,
        });
        expect(lines.find((l) => l.accountId === aaRodadosId)).toMatchObject({
          debit: 0,
          credit: AMOUNT,
        });
        expect(lines.some((l) => l.accountId === gastoGlobalId)).toBe(false);
        expect(lines.some((l) => l.accountId === aaGlobalId)).toBe(false);
      });
    });

    describe('caso 2: la depreciación sobreescribe solo el gasto', () => {
      it('usa el gasto PROPIO y la acumulada del tipo: cada cuenta se resuelve por separado', async () => {
        const result = await postDepreciationEntry(conOverride.periods[0]);
        expect(result.success).toBe(true);
        if (!result.success) throw new Error(result.error);

        const lines = await fetchEntryLines(conOverride.periods[0]);
        expect(lines).toHaveLength(2);
        expect(lines.find((l) => l.accountId === gastoPropioId)).toMatchObject({
          debit: AMOUNT,
          credit: 0,
        });
        expect(lines.find((l) => l.accountId === aaRodadosId)).toMatchObject({
          debit: 0,
          credit: AMOUNT,
        });
        expect(lines.some((l) => l.accountId === gastoExplotacionId)).toBe(false);
      });

      it('getVehicleAssetAccounts muestra la resolución efectiva con su origen', async () => {
        const data = await getVehicleAssetAccounts(conOverride.vehicleId);
        expect(data.hasDepreciation).toBe(true);
        expect(data.depreciationId).toBe(conOverride.depreciationId);
        expect(data.postedCount).toBe(1);
        expect(data.overrides.depreciationExpenseAccountId).toBe(gastoPropioId);
        expect(data.accounts.depreciationExpense).toMatchObject({
          accountId: gastoPropioId,
          code: 'T724C-GASTO-PROPIO',
          source: 'depreciation',
          imputable: true,
        });
        expect(data.accounts.accumulatedDepreciation).toMatchObject({
          accountId: aaRodadosId,
          source: 'type',
        });
        expect(data.accounts.fixedAsset).toMatchObject({ accountId: buRodadosId, source: 'type' });
        // Si se vaciara el override, se usaría la del tipo.
        expect(data.fallbacks.depreciationExpense).toMatchObject({
          accountId: gastoExplotacionId,
          source: 'type',
        });
      });
    });

    describe('caso 3: equipo sin cuentas propias ni de tipo', () => {
      it('cae a las cuentas por defecto de Ajustes contables (regresión)', async () => {
        const result = await postDepreciationEntry(sinNada.periods[0]);
        expect(result.success).toBe(true);
        if (!result.success) throw new Error(result.error);

        const lines = await fetchEntryLines(sinNada.periods[0]);
        expect(lines).toHaveLength(2);
        expect(lines.find((l) => l.accountId === gastoGlobalId)).toMatchObject({
          debit: AMOUNT,
          credit: 0,
        });
        expect(lines.find((l) => l.accountId === aaGlobalId)).toMatchObject({
          debit: 0,
          credit: AMOUNT,
        });
      });
    });

    describe('caso 4: sin ninguna cuenta de amortización acumulada', () => {
      it('devuelve { success: false } nombrando equipo, cuenta, tipo y dónde configurarla; no genera asiento', async () => {
        await prisma.accountingSettings.update({
          where: { companyId },
          data: { accumulatedDepreciationAccountId: null },
        });

        try {
          const result = await postDepreciationEntry(sinNada.periods[1]);
          expect(result.success).toBe(false);
          if (result.success) return;
          expect(result.error).toContain(`«${sinNada.internNumber}»`);
          expect(result.error).toContain('Amortización acumulada');
          expect(result.error).toContain(`«${sinCuentasTypeName}»`);
          expect(result.error).toContain('Contabilidad → Configuración');

          await expectNotPosted(sinNada.periods[1]);
        } finally {
          await prisma.accountingSettings.update({
            where: { companyId },
            data: { accumulatedDepreciationAccountId: aaGlobalId },
          });
        }
      });
    });

    describe('caso 5: la cuenta del tipo existe pero no es imputable', () => {
      it('falla nombrando la cuenta y Empresa → Tipos de Equipo, y NO cae a la por defecto', async () => {
        await prisma.vehicleType.update({
          where: { id: camionTypeId },
          data: { accumulatedDepreciationAccountId: aaViejaId },
        });
        await prisma.account.update({ where: { id: aaViejaId }, data: { isActive: false } });

        try {
          const result = await postDepreciationEntry(conTipo.periods[1]);
          expect(result.success).toBe(false);
          if (result.success) return;
          expect(result.error).toContain(`«${conTipo.internNumber}»`);
          expect(result.error).toContain(aaViejaCode);
          expect(result.error).toContain('Empresa → Tipos de Equipo');

          await expectNotPosted(conTipo.periods[1]);
          const globalLines = await prisma.journalEntryLine.count({
            where: { accountId: aaGlobalId, entry: { companyId } },
          });
          // Solo el asiento del caso 3 tocó la acumulada por defecto.
          expect(globalLines).toBe(1);
        } finally {
          await prisma.account.update({ where: { id: aaViejaId }, data: { isActive: true } });
          await prisma.vehicleType.update({
            where: { id: camionTypeId },
            data: { accumulatedDepreciationAccountId: aaRodadosId },
          });
        }
      });
    });

    describe('caso 6: secuencia de períodos', () => {
      it('el error de negocio viaja como dato, no como excepción', async () => {
        const result = await postDepreciationEntry(secuencia.periods[1]);
        expect(result.success).toBe(false);
        if (result.success) return;
        expect(result.error).toContain('períodos anteriores');
        await expectNotPosted(secuencia.periods[1]);
      });
    });

    describe('caso 7: contabilización masiva con un equipo sin cuentas', () => {
      it('contabiliza los demás y lista el mensaje del equipo omitido en errors[]', async () => {
        await prisma.accountingSettings.update({
          where: { companyId },
          data: { accumulatedDepreciationAccountId: null, depreciationExpenseAccountId: null },
        });

        try {
          const summary = await getPendingDepreciationsSummary(
            new Date('2026-02-28T23:59:59.000Z')
          );
          expect(summary.vehiclesWithoutAccounts).toHaveLength(1);
          expect(summary.vehiclesWithoutAccounts[0]).toMatchObject({
            vehicleId: sinNada.vehicleId,
            vehicleLabel: sinNada.internNumber,
          });
          expect(summary.vehiclesWithoutAccounts[0].message).toContain('Gasto de amortización');

          const result = await postAllPendingDepreciations(new Date('2026-02-28T23:59:59.000Z'));
          expect(result.success).toBe(true);
          if (!result.success) throw new Error(result.error);

          // Pendientes hasta febrero: conTipo p2, conOverride p2, secuencia p1 y p2.
          expect(result.posted).toBe(4);
          expect(result.errors).toHaveLength(1);
          expect(result.errors[0]).toMatchObject({
            vehicleId: sinNada.vehicleId,
            label: sinNada.internNumber,
          });
          expect(result.errors[0].message).toContain(`«${sinNada.internNumber}»`);
          expect(result.errors[0].message).toContain('Contabilidad → Configuración');

          await expectNotPosted(sinNada.periods[1]);

          const conTipoLines = await fetchEntryLines(conTipo.periods[1]);
          const conOverrideLines = await fetchEntryLines(conOverride.periods[1]);
          expect(
            conTipoLines.some((l) => l.accountId === gastoExplotacionId && l.debit === AMOUNT)
          ).toBe(true);
          expect(
            conOverrideLines.some((l) => l.accountId === gastoPropioId && l.debit === AMOUNT)
          ).toBe(true);
          await fetchEntryLines(secuencia.periods[0]);
          await fetchEntryLines(secuencia.periods[1]);
        } finally {
          await prisma.accountingSettings.update({
            where: { companyId },
            data: {
              accumulatedDepreciationAccountId: aaGlobalId,
              depreciationExpenseAccountId: gastoGlobalId,
            },
          });
        }
      });
    });

    describe('caso 8: updateDepreciationAccounts con períodos contabilizados', () => {
      it('guarda el override sin bloquear ni tocar el cronograma, y el próximo período lo usa', async () => {
        const before = await prisma.depreciationScheduleEntry.findMany({
          where: { depreciationId: conTipo.depreciationId },
          select: { id: true, isPosted: true, amount: true },
          orderBy: { periodNumber: 'asc' },
        });
        expect(before.filter((e) => e.isPosted)).toHaveLength(2);

        const result = await updateDepreciationAccounts(conTipo.depreciationId, {
          fixedAssetAccountId: null,
          accumulatedDepreciationAccountId: aaRodadosId,
          depreciationExpenseAccountId: gastoPropioId,
        });
        expect(result).toEqual({ success: true });

        const after = await prisma.depreciationScheduleEntry.findMany({
          where: { depreciationId: conTipo.depreciationId },
          select: { id: true, isPosted: true, amount: true },
          orderBy: { periodNumber: 'asc' },
        });
        expect(after).toEqual(before);

        const saved = await prisma.vehicleDepreciation.findUniqueOrThrow({
          where: { id: conTipo.depreciationId },
          select: {
            fixedAssetAccountId: true,
            accumulatedDepreciationAccountId: true,
            depreciationExpenseAccountId: true,
          },
        });
        expect(saved).toEqual({
          fixedAssetAccountId: null,
          accumulatedDepreciationAccountId: aaRodadosId,
          depreciationExpenseAccountId: gastoPropioId,
        });

        const post = await postDepreciationEntry(conTipo.periods[2]);
        expect(post.success).toBe(true);
        const lines = await fetchEntryLines(conTipo.periods[2]);
        expect(lines.find((l) => l.accountId === gastoPropioId)).toMatchObject({ debit: AMOUNT });
        expect(lines.some((l) => l.accountId === gastoExplotacionId)).toBe(false);
      });

      it('rechaza una cuenta que no es de la empresa como dato, no como excepción', async () => {
        const result = await updateDepreciationAccounts(conTipo.depreciationId, {
          fixedAssetAccountId: '00000000-0000-4000-8000-000000000000',
          accumulatedDepreciationAccountId: null,
          depreciationExpenseAccountId: null,
        });
        expect(result.success).toBe(false);
        if (result.success) return;
        expect(result.error).toContain('no pertenece a la empresa');
      });
    });

    describe('caso 9: masiva sin nada pendiente', () => {
      it('devuelve success con posted 0 y sin errores', async () => {
        const result = await postAllPendingDepreciations(new Date('2025-12-31T00:00:00.000Z'));
        expect(result).toEqual({ success: true, posted: 0, errors: [] });
      });
    });
  }
);
