/**
 * Archivos de retenciones (TSK-813) contra la base real: qué órdenes de pago entran (confirmadas
 * del mes de Argentina) y que los datos nuevos de la retención llegan a cada archivo.
 * Todo lo creado lleva el prefijo `TSK813-TEST-`.
 */
import 'dotenv/config';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { prisma } from '@/shared/lib/prisma';

vi.mock('server-only', () => ({}));
vi.mock('@/shared/lib/company', () => ({ getActiveCompanyId: vi.fn() }));
vi.mock('@/shared/lib/permissions', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/shared/lib/permissions')>()),
  checkPermission: vi.fn().mockResolvedValue(undefined),
}));

import { getActiveCompanyId } from '@/shared/lib/company';

import { generateWithholdingFiles } from './actions.server';

const PREFIX = 'TSK813-TEST-';

let dbAvailable = false;
try {
  await prisma.$queryRaw`SELECT 1`;
  dbAvailable = true;
} catch {
  dbAvailable = false;
}

describe.skipIf(!dbAvailable)('archivos de retenciones de las órdenes de pago (TSK-813)', () => {
  let companyId: string;

  beforeAll(async () => {
    ({ id: companyId } = await prisma.company.create({
      data: { name: `${PREFIX}Empresa`, taxId: '30813000015', isActive: true },
      select: { id: true },
    }));
    vi.mocked(getActiveCompanyId).mockResolvedValue(companyId);

    const supplier = await prisma.supplier.create({
      data: {
        companyId,
        code: `${PREFIX}PROV`,
        businessName: `${PREFIX}Proveedor`,
        taxId: '30712345678',
        taxCondition: 'RESPONSABLE_INSCRIPTO',
        createdBy: 'test',
      },
      select: { id: true },
    });

    const orders = [
      // Confirmada del mes, con IVA e IIBB de Córdoba.
      { number: 1, status: 'CONFIRMED', date: '2026-10-15T15:00:00Z' },
      // Borrador del mes: no entra.
      { number: 2, status: 'DRAFT', date: '2026-10-16T15:00:00Z' },
      // 30/09 a las 23:30 de Argentina (ya 01/10 en UTC): es de septiembre.
      { number: 3, status: 'CONFIRMED', date: '2026-10-01T02:30:00Z' },
      // 31/10 a las 23:30 de Argentina (ya 01/11 en UTC): es de octubre.
      { number: 4, status: 'CONFIRMED', date: '2026-11-01T02:30:00Z' },
    ] as const;
    for (const o of orders) {
      await prisma.paymentOrder.create({
        data: {
          companyId,
          supplierId: supplier.id,
          number: o.number,
          fullNumber: `OP-${String(o.number).padStart(5, '0')}`,
          date: new Date(o.date),
          totalAmount: 121000,
          status: o.status,
          createdBy: 'test',
          withholdings: {
            create: [
              { taxType: 'IVA', rate: 2, amount: 2000, regimeCode: '499', taxableBase: 100000 },
              { taxType: 'IIBB', rate: 1.5, amount: 1500, taxableBase: 100000, jurisdiction: '904', regimeCode: '11' },
              // Cargada antes del TSK-813: sin régimen ni base.
              ...(o.number === 4 ? [{ taxType: 'GANANCIAS' as const, rate: 2, amount: 1800 }] : []),
            ],
          },
        },
      });
    }
  });

  afterAll(async () => {
    if (!companyId) return;
    await prisma.paymentOrder.deleteMany({ where: { companyId } });
    await prisma.supplier.deleteMany({ where: { companyId } });
    await prisma.company.deleteMany({ where: { id: companyId } });
    expect(await prisma.company.count({ where: { name: { startsWith: PREFIX } } })).toBe(0);
  });

  it('toma las confirmadas del mes de Argentina y deja afuera borrador y meses vecinos', async () => {
    const files = await generateWithholdingFiles(2026, 10);

    const orderNumbers = files.sireIva.content.split('\r\n').map((r) => r.slice(146, 162).trim());
    expect(orderNumbers).toEqual(['OP-00001', 'OP-00004']);
    expect(files.sireIva.content.split('\r\n').map((r) => r.slice(46, 56))).toEqual(['15/10/2026', '31/10/2026']);
  });

  it('SIRCAR de Córdoba con el régimen y la base de cada retención; la retención sin datos se lista', async () => {
    const files = await generateWithholdingFiles(2026, 10);

    expect(files.sircar).toHaveLength(1);
    expect(files.sircar[0].jurisdiction).toBe('904');
    expect(files.sircar[0].content.split('\r\n')[0]).toBe(
      '00001,1,1,000000000001,30712345678,15/10/2026,100000.00,1.50,1500.00,011,904'
    );
    expect(files.sicore.registros).toBe(0);
    expect(files.incomplete).toEqual([
      { paymentOrder: 'OP-00004', taxType: 'GANANCIAS', missing: ['régimen', 'base imponible'] },
    ]);
  });
});
