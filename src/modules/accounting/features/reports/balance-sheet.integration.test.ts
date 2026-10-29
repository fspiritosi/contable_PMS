/**
 * Balance General (TSK-761) contra la base real (`contable-pms-db`).
 *
 * Los saldos llegan como débito − crédito. Antes, el pasivo y el patrimonio se
 * sumaban así, con signo negativo, y el informe decía "no está equilibrado" en
 * cualquier empresa con pasivo o patrimonio. Ahora se presentan con su saldo
 * acreedor en positivo y Activo = Pasivo + Patrimonio + Resultado del ejercicio.
 *
 * Todo lo creado lleva el prefijo `TSK761-BS-`.
 */
import 'dotenv/config';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { prisma } from '@/shared/lib/prisma';

vi.mock('server-only', () => ({}));
vi.mock('@/shared/lib/current-user', () => ({ getCurrentUserId: vi.fn().mockResolvedValue('test-user') }));
vi.mock('@/shared/lib/permissions', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/shared/lib/permissions')>()),
  checkPermission: vi.fn().mockResolvedValue(undefined),
}));

import { cleanupAccountingCompany } from '../../shared/test-utils/cleanup-accounting-company';
import { getBalanceSheet } from './actions.server';

const PREFIX = 'TSK761-BS-';
const day = (iso: string) => new Date(`${iso}T12:00:00.000Z`);

let dbAvailable = false;
try {
  await prisma.$queryRaw`SELECT 1`;
  dbAvailable = true;
} catch {
  dbAvailable = false;
}

type AccountType = 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE';

describe.skipIf(!dbAvailable)('Balance General: Activo = Pasivo + Patrimonio (TSK-761)', () => {
  let companyId: string;
  const acc: Record<string, string> = {};
  let entryNumber = 0;

  const post = (date: string, lines: { accountId: string; debit?: number; credit?: number }[]) =>
    prisma.journalEntry.create({
      data: {
        companyId,
        number: ++entryNumber,
        date: day(date),
        description: `${PREFIX}asiento ${entryNumber}`,
        status: 'POSTED',
        postDate: new Date(),
        createdBy: 'test-user',
        lines: { create: lines.map((l) => ({ accountId: l.accountId, debit: l.debit ?? 0, credit: l.credit ?? 0 })) },
      },
    });

  beforeAll(async () => {
    ({ id: companyId } = await prisma.company.create({
      data: { name: `${PREFIX}Empresa`, isActive: true },
      select: { id: true },
    }));
    const seeds: [string, string, AccountType][] = [
      ['caja', '1.1.01', 'ASSET'],
      ['prestamo', '2.1.01', 'LIABILITY'],
      ['capital', '3.1.01', 'EQUITY'],
      ['ventas', '4.1.01', 'REVENUE'],
      ['devoluciones', '4.1.02', 'REVENUE'],
      ['gastos', '5.1.01', 'EXPENSE'],
    ];
    for (const [key, code, type] of seeds) {
      const nature = type === 'ASSET' || type === 'EXPENSE' ? 'DEBIT' : 'CREDIT';
      acc[key] = (
        await prisma.account.create({
          data: { companyId, code, name: `${PREFIX}${key}`, type, nature },
          select: { id: true },
        })
      ).id;
    }

    await post('2026-03-02', [{ accountId: acc.caja, debit: 1000 }, { accountId: acc.capital, credit: 1000 }]);
    await post('2026-03-05', [{ accountId: acc.caja, debit: 500 }, { accountId: acc.prestamo, credit: 500 }]);
    await post('2026-03-10', [{ accountId: acc.caja, debit: 800 }, { accountId: acc.ventas, credit: 800 }]);
    // Cuenta de ingresos con saldo deudor (devoluciones): resta del resultado, no suma.
    await post('2026-03-12', [{ accountId: acc.devoluciones, debit: 100 }, { accountId: acc.caja, credit: 100 }]);
    await post('2026-03-20', [{ accountId: acc.gastos, debit: 300 }, { accountId: acc.caja, credit: 300 }]);
    // Asiento que no balancea (dato corrupto, cargado por fuera de la app): el informe debe avisarlo.
    await post('2026-05-01', [{ accountId: acc.caja, debit: 50 }]);
  });

  afterAll(async () => {
    if (companyId) await cleanupAccountingCompany(companyId);
  });

  it('presenta pasivo y patrimonio con saldo acreedor en positivo y queda equilibrado', async () => {
    const sheet = await getBalanceSheet(companyId, day('2026-04-30'));

    expect(sheet.totalAssets).toBe(1900);
    expect(sheet.liabilities.total).toBe(500);
    expect(sheet.liabilities.accounts).toEqual([{ code: '2.1.01', name: `${PREFIX}prestamo`, balance: 500 }]);
    expect(sheet.equity.total).toBe(1000);
    expect(sheet.periodResult).toBe(400); // 800 ventas − 100 devoluciones − 300 gastos
    expect(sheet.totalLiabilitiesAndEquity).toBe(1900);
    expect(sheet.isBalanced).toBe(true);
    expect(sheet.difference).toBe(0);
  });

  it('si el balance no cierra, lo informa con la diferencia', async () => {
    const sheet = await getBalanceSheet(companyId, day('2026-05-31'));

    expect(sheet.totalAssets).toBe(1950);
    expect(sheet.totalLiabilitiesAndEquity).toBe(1900);
    expect(sheet.isBalanced).toBe(false);
    expect(sheet.difference).toBe(50);
  });
});
