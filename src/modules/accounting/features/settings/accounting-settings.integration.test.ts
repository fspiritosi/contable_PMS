/**
 * Tests de integración de Ajustes contables (TSK-760, Fase 3: B23, D11, C3, H6) contra la
 * base real (`contable-pms-db`).
 *
 * Código real: `saveFiscalYearSettings`, `getFiscalYearSettings` y `saveAccountingSettings`
 * (solo cuentas), más `createJournalEntry` para sembrar un asiento.
 *
 * Cada caso usa su propia empresa (prefijo `TSK760-AJ-`). `afterAll` limpia con
 * `cleanupAccountingCompany`.
 */
import 'dotenv/config';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { prisma } from '@/shared/lib/prisma';

vi.mock('server-only', () => ({}));
vi.mock('@/shared/lib/current-user', () => ({ getCurrentUserId: vi.fn() }));
vi.mock('@/shared/lib/company', () => ({ getActiveCompanyId: vi.fn() }));
vi.mock('@/shared/lib/permissions', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/shared/lib/permissions')>()),
  checkPermission: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
// `revalidateAccountingRoutes` hace `require('next/cache')` (no lo intercepta vi.mock).
vi.mock('../../shared/utils', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../shared/utils')>()),
  revalidateAccountingRoutes: vi.fn(),
}));

import { getActiveCompanyId } from '@/shared/lib/company';
import { getCurrentUserId } from '@/shared/lib/current-user';
import { checkPermission } from '@/shared/lib/permissions';

import { cleanupAccountingCompany } from '../../shared/test-utils/cleanup-accounting-company';
import { closeMonthForTest } from '../../shared/test-utils/period-test-helpers';
import { createJournalEntry } from '../entries/actions.server';
import {
  getFiscalYearSettings,
  saveAccountingSettings,
  saveFiscalYearSettings,
} from './actions.server';

const PREFIX = 'TSK760-AJ-';
const LOCKED_TEXT =
  'No se pueden cambiar las fechas del ejercicio N° 1: la empresa ya tiene asientos o meses cerrados. Las fechas cambian solas al cerrar el ejercicio.';

let dbAvailable = false;
try {
  await prisma.$queryRaw`SELECT 1`;
  dbAvailable = true;
} catch {
  dbAvailable = false;
}

const companyIds: string[] = [];

/** Empresa nueva (sin Ajustes salvo que se pidan) y activa para las actions. */
async function setupCompany(
  name: string,
  settings?: { start: string; end: string }
): Promise<{ companyId: string; cajaId: string; ventasId: string }> {
  const { id: companyId } = await prisma.company.create({
    data: { name: `${PREFIX}${name}`, isActive: true },
    select: { id: true },
  });
  companyIds.push(companyId);
  const [caja, ventas] = await Promise.all([
    prisma.account.create({
      data: { companyId, code: 'T760-CAJA', name: `${PREFIX}Caja`, type: 'ASSET', nature: 'DEBIT' },
      select: { id: true },
    }),
    prisma.account.create({
      data: {
        companyId,
        code: 'T760-VENTAS',
        name: `${PREFIX}Ventas`,
        type: 'REVENUE',
        nature: 'CREDIT',
      },
      select: { id: true },
    }),
  ]);
  if (settings) {
    await prisma.accountingSettings.create({
      data: {
        companyId,
        fiscalYearStart: new Date(settings.start),
        fiscalYearEnd: new Date(settings.end),
      },
    });
  }
  vi.mocked(getActiveCompanyId).mockResolvedValue(companyId);
  return { companyId, cajaId: caja.id, ventasId: ventas.id };
}

async function fiscalYearsOf(companyId: string) {
  return prisma.fiscalYear.findMany({
    where: { companyId },
    orderBy: { number: 'asc' },
    select: {
      id: true,
      number: true,
      startDate: true,
      endDate: true,
      periods: {
        orderBy: [{ type: 'asc' }, { year: 'asc' }, { month: 'asc' }],
        select: { type: true, year: true, month: true },
      },
    },
  });
}

async function settingsOf(companyId: string) {
  return prisma.accountingSettings.findUniqueOrThrow({
    where: { companyId },
    select: {
      fiscalYearStart: true,
      fiscalYearEnd: true,
      salesAccountId: true,
      requireCostCenter: true,
    },
  });
}

describe.skipIf(!dbAvailable)('Ajustes contables: ejercicio y cuentas (TSK-760, Fase 3)', () => {
  beforeEach(() => {
    vi.mocked(getCurrentUserId).mockResolvedValue('test-user');
    vi.mocked(checkPermission).mockClear();
  });

  afterAll(async () => {
    for (const companyId of companyIds) {
      await cleanupAccountingCompany(companyId);
      await prisma.accountingSettings.deleteMany({ where: { companyId } });
      await prisma.account.deleteMany({ where: { companyId } });
      await prisma.company.deleteMany({ where: { id: companyId } });
    }
    expect(await prisma.company.count({ where: { name: { startsWith: PREFIX } } })).toBe(0);
  });

  it('primera vez: crea Ajustes y el ejercicio N° 1 con OPENING + 12 MONTHLY + CLOSING (B23)', async () => {
    const { companyId } = await setupCompany('Primera');
    expect(await getFiscalYearSettings()).toBeNull();

    const result = await saveFiscalYearSettings({ startDay: '2026-01-01', endDay: '2026-12-31' });

    expect(result).toEqual({ success: true, fiscalYearNumber: 1 });
    expect(checkPermission).toHaveBeenCalledWith('accounting.settings', 'update', {
      redirect: true,
    });
    const [fy] = await fiscalYearsOf(companyId);
    expect(fy.startDate.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    expect(fy.endDate.toISOString()).toBe('2026-12-31T23:59:59.999Z');
    expect(fy.periods.filter((p) => p.type === 'MONTHLY')).toHaveLength(12);
    expect(fy.periods.filter((p) => p.type === 'OPENING')).toEqual([
      { type: 'OPENING', year: 2026, month: 1 },
    ]);
    expect(fy.periods.filter((p) => p.type === 'CLOSING')).toEqual([
      { type: 'CLOSING', year: 2026, month: 12 },
    ]);
    const settings = await settingsOf(companyId);
    expect(settings.fiscalYearStart.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    expect(settings.fiscalYearEnd.toISOString()).toBe('2026-12-31T23:59:59.999Z');
    expect(await getFiscalYearSettings()).toEqual({
      fiscalYearNumber: 1,
      startDay: '2026-01-01',
      endDay: '2026-12-31',
      datesEditable: true,
    });
  });

  it('Ajustes sin ejercicio (empresa vieja): guardar crea el ejercicio N° 1', async () => {
    const { companyId } = await setupCompany('SinFY', {
      start: '2026-01-01T03:00:00.000Z',
      end: '2026-12-31T03:00:00.000Z',
    });
    expect(await getFiscalYearSettings()).toEqual({
      fiscalYearNumber: 1,
      startDay: '2026-01-01',
      endDay: '2026-12-31',
      datesEditable: true,
    });

    const result = await saveFiscalYearSettings({ startDay: '2026-01-01', endDay: '2026-12-31' });

    expect(result).toEqual({ success: true, fiscalYearNumber: 1 });
    const fys = await fiscalYearsOf(companyId);
    expect(fys).toHaveLength(1);
    expect(fys[0].periods).toHaveLength(14);
    const settings = await settingsOf(companyId);
    expect(settings.fiscalYearStart.toISOString()).toBe('2026-01-01T00:00:00.000Z');
  });

  it('exige meses completos y como máximo 12 meses (C3), sin crear nada', async () => {
    const { companyId } = await setupCompany('MesesCompletos');

    expect(await saveFiscalYearSettings({ startDay: '2026-01-15', endDay: '2027-01-14' })).toEqual({
      success: false,
      error:
        'El ejercicio tiene que empezar el primer día de un mes y terminar el último día de un mes.',
    });
    expect(await saveFiscalYearSettings({ startDay: '2026-01-01', endDay: '2027-01-31' })).toEqual({
      success: false,
      error: 'El ejercicio fiscal no puede ser mayor a un año',
    });
    expect(await saveFiscalYearSettings({ startDay: '2026-12-01', endDay: '2026-01-31' })).toEqual({
      success: false,
      error: 'La fecha de fin debe ser posterior a la fecha de inicio',
    });
    expect(await prisma.accountingSettings.count({ where: { companyId } })).toBe(0);
    expect(await prisma.fiscalYear.count({ where: { companyId } })).toBe(0);
  });

  it('sin asientos: cambiar las fechas regenera los períodos del mismo ejercicio', async () => {
    const { companyId } = await setupCompany('Regenera');
    await saveFiscalYearSettings({ startDay: '2026-01-01', endDay: '2026-12-31' });
    const [before] = await fiscalYearsOf(companyId);

    const result = await saveFiscalYearSettings({ startDay: '2026-07-01', endDay: '2027-06-30' });

    expect(result).toEqual({ success: true, fiscalYearNumber: 1 });
    const fys = await fiscalYearsOf(companyId);
    expect(fys).toHaveLength(1);
    expect(fys[0].id).toBe(before.id);
    expect(fys[0].startDate.toISOString()).toBe('2026-07-01T00:00:00.000Z');
    expect(fys[0].endDate.toISOString()).toBe('2027-06-30T23:59:59.999Z');
    const monthly = fys[0].periods.filter((p) => p.type === 'MONTHLY');
    expect(monthly).toHaveLength(12);
    expect(monthly[0]).toEqual({ type: 'MONTHLY', year: 2026, month: 7 });
    expect(monthly[11]).toEqual({ type: 'MONTHLY', year: 2027, month: 6 });
    expect(fys[0].periods.filter((p) => p.type !== 'MONTHLY')).toEqual([
      { type: 'OPENING', year: 2026, month: 7 },
      { type: 'CLOSING', year: 2027, month: 6 },
    ]);
    const settings = await settingsOf(companyId);
    expect(settings.fiscalYearEnd.toISOString()).toBe('2027-06-30T23:59:59.999Z');
  });

  it('con un asiento: las fechas no se pueden cambiar (texto legible) y guardar las mismas no falla', async () => {
    const { companyId, cajaId, ventasId } = await setupCompany('ConAsiento');
    await saveFiscalYearSettings({ startDay: '2026-01-01', endDay: '2026-12-31' });
    const entry = await createJournalEntry({
      date: new Date('2026-03-10T12:00:00.000Z'),
      description: `${PREFIX}asiento`,
      lines: [
        { accountId: cajaId, debit: '10.00', credit: '0.00' },
        { accountId: ventasId, debit: '0.00', credit: '10.00' },
      ],
    });
    expect(entry).toMatchObject({ success: true });

    expect(await getFiscalYearSettings()).toMatchObject({
      datesEditable: false,
      fiscalYearNumber: 1,
    });
    expect(await saveFiscalYearSettings({ startDay: '2026-02-01', endDay: '2027-01-31' })).toEqual({
      success: false,
      error: LOCKED_TEXT,
    });
    const [fy] = await fiscalYearsOf(companyId);
    expect(fy.startDate.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    expect(fy.periods).toHaveLength(14);

    expect(await saveFiscalYearSettings({ startDay: '2026-01-01', endDay: '2026-12-31' })).toEqual({
      success: true,
      fiscalYearNumber: 1,
    });
  });

  it('con un mes cerrado y sin asientos: tampoco se pueden cambiar las fechas', async () => {
    const { companyId } = await setupCompany('MesCerrado');
    await saveFiscalYearSettings({ startDay: '2026-01-01', endDay: '2026-12-31' });
    await closeMonthForTest(companyId, new Date('2026-01-15T00:00:00.000Z'));

    expect(await getFiscalYearSettings()).toMatchObject({ datesEditable: false });
    expect(await saveFiscalYearSettings({ startDay: '2026-02-01', endDay: '2027-01-31' })).toEqual({
      success: false,
      error: LOCKED_TEXT,
    });
  });

  it('saveAccountingSettings guarda solo cuentas: sin Ajustes rechaza, con Ajustes no toca fechas (H6)', async () => {
    const { companyId, ventasId } = await setupCompany('Cuentas');

    expect(await saveAccountingSettings({ salesAccountId: ventasId })).toEqual({
      success: false,
      error: 'Configurá primero el ejercicio fiscal.',
    });
    expect(await prisma.accountingSettings.count({ where: { companyId } })).toBe(0);

    await saveFiscalYearSettings({ startDay: '2026-01-01', endDay: '2026-12-31' });
    const [fyBefore] = await fiscalYearsOf(companyId);

    const result = await saveAccountingSettings({
      salesAccountId: ventasId,
      requireCostCenter: true,
    });

    expect(result).toEqual({ success: true });
    expect(checkPermission).toHaveBeenCalledWith('accounting.settings', 'update', {
      redirect: true,
    });
    const settings = await settingsOf(companyId);
    expect(settings.salesAccountId).toBe(ventasId);
    expect(settings.requireCostCenter).toBe(true);
    expect(settings.fiscalYearStart.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    expect(settings.fiscalYearEnd.toISOString()).toBe('2026-12-31T23:59:59.999Z');
    expect(await fiscalYearsOf(companyId)).toEqual([fyBefore]);
  });
});
