/**
 * Tests de integración del informe "Movimientos por Centro de Costo"
 * (TSK-719) contra la base real.
 *
 * CÓDIGO REAL DE PRODUCCIÓN, NO UNA RÉPLICA
 * ------------------------------------------
 * Se aísla únicamente la frontera de sesión, permisos y empresa activa (los
 * tres `vi.mock` de abajo). La query, el corte por estado, la conversión de
 * `Decimal` y el agrupamiento son el código real de las dos actions nuevas.
 *
 * Los asientos se siembran con `prisma.journalEntry.create` en vez de pasar
 * por el integrador comercial: lo que se verifica acá es la LECTURA, y el
 * integrador ya tiene sus propios tests (`integrations/commercial/
 * cost-center.integration.test.ts`).
 */
import 'dotenv/config';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { prisma } from '@/shared/lib/prisma';

// Frontera aislada: sesión, permisos y empresa activa.
vi.mock('@/shared/lib/current-user', () => ({ getCurrentUserId: vi.fn() }));
vi.mock('@/shared/lib/company', () => ({ getActiveCompanyId: vi.fn() }));
vi.mock('@/shared/lib/permissions', () => ({
  checkPermission: vi.fn().mockResolvedValue(undefined),
}));

import { NO_COST_CENTER_LABEL } from '@/modules/accounting/shared/utils/cost-center-movements';
import { getActiveCompanyId } from '@/shared/lib/company';
import { getCurrentUserId } from '@/shared/lib/current-user';
import { checkPermission } from '@/shared/lib/permissions';

// Código real de producción.
import { getCostCenterMovements, getCostCentersForMovementsReport } from './actions.server';

const PREFIX = 'TSK719-TEST-';
const FROM = new Date('2026-09-01T00:00:00.000Z');
const TO = new Date('2026-09-30T00:00:00.000Z');

let dbAvailable = false;
try {
  await prisma.$queryRaw`SELECT 1`;
  dbAvailable = true;
} catch {
  dbAvailable = false;
}

describe.skipIf(!dbAvailable)('informe de movimientos por centro de costo (TSK-719)', () => {
  let companyId: string;
  let otherCompanyId: string;
  let logisticaId: string;
  let mantenimientoId: string;
  let viejoId: string;

  beforeAll(async () => {
    const [company, otherCompany] = await Promise.all([
      prisma.company.create({ data: { name: `${PREFIX}Empresa`, isActive: true } }),
      prisma.company.create({ data: { name: `${PREFIX}Otra Empresa`, isActive: true } }),
    ]);
    companyId = company.id;
    otherCompanyId = otherCompany.id;

    const mkAccount = (
      code: string,
      name: string,
      type: 'ASSET' | 'LIABILITY' | 'REVENUE' | 'EXPENSE',
      nature: 'DEBIT' | 'CREDIT'
    ) =>
      prisma.account.create({
        data: { companyId, code, name: `${PREFIX}${name}`, type, nature },
      });

    const [ventas, combustible, cobrar, ivaDf] = await Promise.all([
      mkAccount('719-VTA', 'Ventas', 'REVENUE', 'CREDIT'),
      mkAccount('719-COMB', 'Combustible', 'EXPENSE', 'DEBIT'),
      mkAccount('719-COBRAR', 'Cuentas por Cobrar', 'ASSET', 'DEBIT'),
      mkAccount('719-IVADF', 'IVA Debito Fiscal', 'LIABILITY', 'CREDIT'),
    ]);

    const mkCostCenter = (name: string, isActive: boolean) =>
      prisma.costCenter.create({ data: { companyId, name: `${PREFIX}${name}`, isActive } });

    const [logistica, mantenimiento, viejo] = await Promise.all([
      mkCostCenter('Logística', true),
      mkCostCenter('Mantenimiento', true),
      mkCostCenter('Viejo', false),
      mkCostCenter('Vacío', false), // inactivo SIN movimientos: no debe salir en el selector
    ]);
    logisticaId = logistica.id;
    mantenimientoId = mantenimiento.id;
    viejoId = viejo.id;

    const mkEntry = (
      number: number,
      date: string,
      description: string,
      status: 'DRAFT' | 'POSTED' | 'REVERSED',
      lines: {
        accountId: string;
        debit?: number;
        credit?: number;
        costCenterId?: string;
        description?: string;
      }[]
    ) =>
      prisma.journalEntry.create({
        data: {
          companyId,
          number,
          date: new Date(date),
          description: `${PREFIX}${description}`,
          status,
          createdBy: `${PREFIX}user`,
          lines: {
            create: lines.map((line) => ({
              accountId: line.accountId,
              debit: line.debit ?? 0,
              credit: line.credit ?? 0,
              description: line.description ?? null,
              costCenterId: line.costCenterId ?? null,
            })),
          },
        },
      });

    // 1 POSTED: venta con centro en la cuenta de resultado y sin centro en el activo.
    await mkEntry(1, '2026-09-01', 'Venta', 'POSTED', [
      { accountId: ventas.id, credit: 100000, costCenterId: logistica.id },
      { accountId: cobrar.id, debit: 121000 },
      { accountId: ivaDf.id, credit: 21000 },
    ]);
    // 2 POSTED: compra repartida entre dos centros.
    await mkEntry(2, '2026-09-05', 'Compra de combustible', 'POSTED', [
      { accountId: combustible.id, debit: 60000, costCenterId: logistica.id },
      { accountId: combustible.id, debit: 40000, costCenterId: mantenimiento.id },
      { accountId: cobrar.id, credit: 100000 },
    ]);
    // 3 POSTED: nota de crédito de venta (debita Ventas): tiene que RESTAR.
    await mkEntry(3, '2026-09-10', 'Nota de crédito de venta', 'POSTED', [
      { accountId: ventas.id, debit: 30000, costCenterId: logistica.id },
      { accountId: cobrar.id, credit: 30000 },
    ]);
    // 4 POSTED: movimiento del centro dado de baja (historia alcanzable).
    await mkEntry(4, '2026-09-11', 'Venta en centro dado de baja', 'POSTED', [
      { accountId: ventas.id, credit: 10000, costCenterId: viejo.id },
      { accountId: cobrar.id, debit: 10000 },
    ]);
    // 5 DRAFT: no entra por defecto, alimenta el aviso.
    await mkEntry(5, '2026-09-12', 'Compra en borrador', 'DRAFT', [
      { accountId: combustible.id, debit: 25000, costCenterId: logistica.id },
      { accountId: cobrar.id, credit: 25000 },
    ]);
    // 6 POSTED fuera del rango de fechas.
    await mkEntry(6, '2026-10-15', 'Compra fuera del período', 'POSTED', [
      { accountId: combustible.id, debit: 99999, costCenterId: logistica.id },
      { accountId: cobrar.id, credit: 99999 },
    ]);
    // 7 POSTED: línea de resultado SIN centro imputado.
    await mkEntry(7, '2026-09-20', 'Venta sin centro imputado', 'POSTED', [
      { accountId: ventas.id, credit: 5000 },
      { accountId: cobrar.id, debit: 5000 },
    ]);
    // 8 REVERSED: nunca debe aparecer, ni con includeDrafts.
    await mkEntry(8, '2026-09-21', 'Asiento reversado', 'REVERSED', [
      { accountId: ventas.id, credit: 777, costCenterId: logistica.id },
      { accountId: cobrar.id, debit: 777 },
    ]);

    vi.mocked(getCurrentUserId).mockResolvedValue(`${PREFIX}user`);
    vi.mocked(getActiveCompanyId).mockResolvedValue(companyId);
  });

  afterAll(async () => {
    // Los asientos POSTED y REVERSED son inmutables por trigger
    // (`trg_journal_entry_immutable`, migración 20260624100000): para poder
    // limpiar la siembra hay que desactivar los triggers, y se hace con
    // `SET LOCAL` dentro de una transacción para que el alcance sea esta
    // conexión y este bloque, y no la tabla entera.
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
      await tx.journalEntryLine.deleteMany({ where: { entry: { companyId } } });
      await tx.journalEntry.deleteMany({ where: { companyId } });
    });
    await prisma.costCenter.deleteMany({ where: { companyId } });
    await prisma.account.deleteMany({ where: { companyId } });
    await prisma.company.deleteMany({ where: { id: { in: [companyId, otherCompanyId] } } });

    expect(await prisma.journalEntry.count({ where: { companyId } })).toBe(0);
    expect(await prisma.costCenter.count({ where: { name: { startsWith: PREFIX } } })).toBe(0);
    expect(await prisma.account.count({ where: { name: { startsWith: PREFIX } } })).toBe(0);
    expect(await prisma.company.count({ where: { name: { startsWith: PREFIX } } })).toBe(0);
  });

  describe('getCostCenterMovements', () => {
    it('detalla un centro con el signo de la nota de crédito y el saldo acumulado', async () => {
      const result = await getCostCenterMovements(companyId, {
        costCenterId: logisticaId,
        fromDate: FROM,
        toDate: TO,
        includeDrafts: false,
      });

      expect(result.groups).toHaveLength(1);
      const [logistica] = result.groups;
      expect(logistica.costCenterName).toBe(`${PREFIX}Logística`);
      expect(logistica.totalEntradas).toBe(70000); // 100.000 − 30.000 de la NC
      expect(logistica.totalSalidas).toBe(60000);
      expect(logistica.saldo).toBe(10000);
      expect(logistica.rows.map((row) => row.saldo)).toEqual([100000, 40000, 10000]);
      expect(result.totals).toEqual({ entradas: 70000, salidas: 60000, saldo: 10000 });

      // Ni el borrador (asiento 5) ni el de octubre (asiento 6) entran.
      expect(logistica.rows).toHaveLength(3);
      expect(logistica.rows.some((row) => row.entryNumber === 5)).toBe(false);
      expect(logistica.rows.some((row) => row.entryNumber === 6)).toBe(false);
    });

    it('avisa cuántos asientos en borrador quedaron afuera y por qué importe', async () => {
      const result = await getCostCenterMovements(companyId, {
        costCenterId: logisticaId,
        fromDate: FROM,
        toDate: TO,
        includeDrafts: false,
      });

      expect(result.draftsExcluded).toEqual({ entryCount: 1, saldo: -25000 });
      expect(result.includeDrafts).toBe(false);
    });

    it('con includeDrafts suma los borradores y vacía el aviso', async () => {
      const result = await getCostCenterMovements(companyId, {
        costCenterId: logisticaId,
        fromDate: FROM,
        toDate: TO,
        includeDrafts: true,
      });

      const [logistica] = result.groups;
      expect(logistica.totalSalidas).toBe(85000); // 60.000 + 25.000 del borrador
      expect(logistica.saldo).toBe(-15000);
      expect(result.draftsExcluded).toEqual({ entryCount: 0, saldo: 0 });
      expect(logistica.rows.some((row) => row.status === 'DRAFT')).toBe(true);
    });

    it('con "all" arma un grupo por centro y el bucket sin centro solo con cuentas de resultado', async () => {
      const result = await getCostCenterMovements(companyId, {
        costCenterId: 'all',
        fromDate: FROM,
        toDate: TO,
        includeDrafts: false,
      });

      expect(result.groups.map((group) => group.costCenterName)).toEqual([
        `${PREFIX}Logística`,
        `${PREFIX}Mantenimiento`,
        `${PREFIX}Viejo`,
        NO_COST_CENTER_LABEL,
      ]);

      const sinCentro = result.groups[3];
      // La línea de Cuentas por Cobrar (ASSET) del asiento 1 NO cae en este bucket.
      expect(sinCentro.rows).toHaveLength(1);
      expect(sinCentro.rows[0].accountCode).toBe('719-VTA');
      expect(sinCentro.totalEntradas).toBe(5000);
      expect(
        result.groups.some((group) => group.rows.some((row) => row.accountCode === '719-COBRAR'))
      ).toBe(false);
    });

    it('con "none" devuelve solo las líneas de resultado sin centro imputado', async () => {
      const result = await getCostCenterMovements(companyId, {
        costCenterId: 'none',
        fromDate: FROM,
        toDate: TO,
        includeDrafts: false,
      });

      expect(result.groups).toHaveLength(1);
      expect(result.groups[0].costCenterId).toBeNull();
      expect(result.groups[0].costCenterName).toBe(NO_COST_CENTER_LABEL);
      expect(result.groups[0].rows).toHaveLength(1);
      expect(result.groups[0].saldo).toBe(5000);
    });

    it('nunca incluye asientos reversados, ni siquiera con includeDrafts', async () => {
      const [sinBorradores, conBorradores] = await Promise.all([
        getCostCenterMovements(companyId, {
          costCenterId: 'all',
          fromDate: FROM,
          toDate: TO,
          includeDrafts: false,
        }),
        getCostCenterMovements(companyId, {
          costCenterId: 'all',
          fromDate: FROM,
          toDate: TO,
          includeDrafts: true,
        }),
      ]);

      const tieneReversado = (rows: { entryNumber: number }[]) =>
        rows.some((row) => row.entryNumber === 8);
      expect(sinBorradores.groups.some((group) => tieneReversado(group.rows))).toBe(false);
      expect(conBorradores.groups.some((group) => tieneReversado(group.rows))).toBe(false);
    });

    it('devuelve los importes como number, sin Decimal (regla 9)', async () => {
      const result = await getCostCenterMovements(companyId, {
        costCenterId: logisticaId,
        fromDate: FROM,
        toDate: TO,
        includeDrafts: false,
      });

      const [row] = result.groups[0].rows;
      expect(typeof row.debit).toBe('number');
      expect(typeof row.credit).toBe('number');
      expect(typeof row.saldo).toBe('number');
    });

    it('rechaza un companyId que no es el de la empresa activa', async () => {
      await expect(
        getCostCenterMovements(otherCompanyId, {
          costCenterId: 'all',
          fromDate: FROM,
          toDate: TO,
          includeDrafts: false,
        })
      ).rejects.toThrow();
    });

    it('exige el permiso de informes contables', async () => {
      await getCostCenterMovements(companyId, {
        costCenterId: 'all',
        fromDate: FROM,
        toDate: TO,
        includeDrafts: false,
      });

      expect(vi.mocked(checkPermission)).toHaveBeenCalledWith('accounting.reports', 'view', {
        redirect: true,
      });
    });
  });

  describe('getCostCentersForMovementsReport', () => {
    it('incluye los activos y los inactivos CON historia, pero no los inactivos vacíos', async () => {
      const centers = await getCostCentersForMovementsReport(companyId);
      const names = centers.map((center) => center.name);

      expect(names).toEqual([`${PREFIX}Logística`, `${PREFIX}Mantenimiento`, `${PREFIX}Viejo`]);
      expect(centers.find((center) => center.id === viejoId)?.isActive).toBe(false);
      expect(centers.find((center) => center.id === mantenimientoId)?.isActive).toBe(true);
      expect(names).not.toContain(`${PREFIX}Vacío`);
    });

    it('rechaza un companyId que no es el de la empresa activa', async () => {
      await expect(getCostCentersForMovementsReport(otherCompanyId)).rejects.toThrow();
    });
  });
});
