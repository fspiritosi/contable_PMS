/**
 * Tests de integración del ABM de conceptos de movimientos (TSK-791, Tarea 3)
 * contra la base real de desarrollo. Mismo molde que
 * `fund-movement-lines.integration.test.ts`: `describe.skipIf` sin base, prefijo
 * único en todo lo que se crea y limpieza + verificación en el `afterAll`.
 * Solo se aísla la frontera (sesión, permisos, empresa activa, caché de Next).
 */
import 'dotenv/config';
import { prisma } from '@/shared/lib/prisma';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/shared/lib/current-user', () => ({ getCurrentUserId: vi.fn() }));
vi.mock('@/shared/lib/company', () => ({ getActiveCompanyId: vi.fn() }));
vi.mock('@/shared/lib/permissions', () => ({
  checkPermission: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { getActiveCompanyId } from '@/shared/lib/company';
import { getCurrentUserId } from '@/shared/lib/current-user';
import {
  createConcept,
  deleteConcept,
  getConceptAccountOptions,
  getConcepts,
  setConceptActive,
  updateConcept,
} from './actions.server';

const PREFIX = 'TSK791-T3-';

let dbAvailable = false;
try {
  await prisma.$queryRaw`SELECT 1`;
  dbAvailable = true;
} catch {
  dbAvailable = false;
}

describe.skipIf(!dbAvailable)('integración: ABM de conceptos (TSK-791)', () => {
  let companyId: string;
  let expenseAccountId: string;
  let assetAccountId: string;

  beforeAll(async () => {
    const company = await prisma.company.create({
      data: { name: `${PREFIX}Empresa`, isActive: true },
    });
    companyId = company.id;
    const [expense, asset] = await Promise.all([
      prisma.account.create({
        data: { companyId, code: 'T3-GASTO', name: `${PREFIX}Gasto`, type: 'EXPENSE', nature: 'DEBIT' },
      }),
      prisma.account.create({
        data: { companyId, code: 'T3-ACTIVO', name: `${PREFIX}Activo`, type: 'ASSET', nature: 'DEBIT' },
      }),
    ]);
    expenseAccountId = expense.id;
    assetAccountId = asset.id;
    vi.mocked(getActiveCompanyId).mockResolvedValue(companyId);
    vi.mocked(getCurrentUserId).mockResolvedValue(`${PREFIX}user`);
  });

  afterAll(async () => {
    // Guarda: sin companyId Prisma omitiría el filtro y borraría la tabla entera.
    if (companyId) {
      await prisma.fundMovement.deleteMany({ where: { companyId } }); // cascadea sus líneas
      await prisma.movementConcept.deleteMany({ where: { companyId } });
      await prisma.account.deleteMany({ where: { companyId } });
      await prisma.company.deleteMany({ where: { id: companyId } });
    }
    const [concepts, accounts, companies] = await Promise.all([
      prisma.movementConcept.count({ where: { createdBy: `${PREFIX}user` } }),
      prisma.account.count({ where: { name: { startsWith: PREFIX } } }),
      prisma.company.count({ where: { name: { startsWith: PREFIX } } }),
    ]);
    expect(concepts).toBe(0);
    expect(accounts).toBe(0);
    expect(companies).toBe(0);
    await prisma.$disconnect();
  });

  it('crea concepto de gastos bancarios con cuenta EXPENSE', async () => {
    const result = await createConcept({
      name: `${PREFIX}Comisión`,
      usages: ['FUND_BANK_CHARGES'],
      accountMode: 'OWN_ACCOUNT',
      accountId: expenseAccountId,
    });
    expect(result.success).toBe(true);
    const list = await getConcepts({});
    const row = list.data.find((c) => c.name === `${PREFIX}Comisión`);
    expect(row?.account?.code).toBe('T3-GASTO');
    expect(row?.usageCount).toBe(0);
  });

  it('rechaza cuenta EXPENSE si también aplica a BANK_FEE', async () => {
    const result = await createConcept({
      name: `${PREFIX}Mixto`,
      usages: ['FUND_BANK_CHARGES', 'BANK_FEE'],
      accountMode: 'OWN_ACCOUNT',
      accountId: expenseAccountId,
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toContain('no sirve para todos los usos');
    // La cuenta ASSET sí sirve para ambos usos
    const ok = await createConcept({
      name: `${PREFIX}Mixto`,
      usages: ['FUND_BANK_CHARGES', 'BANK_FEE'],
      accountMode: 'OWN_ACCOUNT',
      accountId: assetAccountId,
    });
    expect(ok.success).toBe(true);
  });

  it('getConceptAccountOptions ofrece solo cuentas de la intersección e incluye las pedidas', async () => {
    const options = await getConceptAccountOptions(['FUND_BANK_CHARGES', 'BANK_FEE']);
    expect(options.map((a) => a.id)).toEqual([assetAccountId]);
    const withInclude = await getConceptAccountOptions(['FUND_BANK_CHARGES', 'BANK_FEE'], [
      expenseAccountId,
    ]);
    expect(withInclude.map((a) => a.id).sort()).toEqual([assetAccountId, expenseAccountId].sort());
  });

  it('PARTNER_ACCOUNT guarda accountId null', async () => {
    const result = await createConcept({
      name: `${PREFIX}Aporte`,
      usages: ['FUND_PARTNER_CONTRIBUTION'],
      accountMode: 'PARTNER_ACCOUNT',
      accountId: assetAccountId,
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    const saved = await prisma.movementConcept.findUniqueOrThrow({ where: { id: result.id } });
    expect(saved.accountId).toBeNull();
  });

  it('rechaza PARTNER_ACCOUNT con uso de gastos bancarios', async () => {
    const result = await createConcept({
      name: `${PREFIX}Socio mal`,
      usages: ['FUND_BANK_CHARGES'],
      accountMode: 'PARTNER_ACCOUNT',
      accountId: null,
    });
    expect(result.success).toBe(false);
  });

  it('rechaza nombre duplicado entre activos', async () => {
    const base = await createConcept({
      name: `${PREFIX}Intereses`,
      usages: ['BANK_INTEREST'],
      accountMode: 'OWN_ACCOUNT',
      accountId: assetAccountId,
    });
    expect(base.success).toBe(true);
    const dup = await createConcept({
      name: ` ${PREFIX.toLowerCase()}intereses `,
      usages: ['BANK_INTEREST'],
      accountMode: 'OWN_ACCOUNT',
      accountId: assetAccountId,
    });
    expect(dup).toEqual({ success: false, error: 'Ya existe un concepto activo con ese nombre' });
  });

  it('permite el mismo nombre si el otro está inactivo, y rechaza reactivarlo', async () => {
    const first = await createConcept({
      name: `${PREFIX}Cheques`,
      usages: ['BANK_CHECK'],
      accountMode: 'OWN_ACCOUNT',
      accountId: assetAccountId,
    });
    expect(first.success).toBe(true);
    if (!first.success) return;
    expect((await setConceptActive(first.id, false)).success).toBe(true);

    const second = await createConcept({
      name: `${PREFIX}Cheques`,
      usages: ['BANK_CHECK'],
      accountMode: 'OWN_ACCOUNT',
      accountId: assetAccountId,
    });
    expect(second.success).toBe(true);

    const reactivate = await setConceptActive(first.id, true);
    expect(reactivate).toEqual({
      success: false,
      error: 'Ya existe un concepto activo con ese nombre',
    });
  });

  it('updateConcept actualiza y no choca consigo mismo', async () => {
    const created = await createConcept({
      name: `${PREFIX}Editable`,
      usages: ['BANK_DEBIT'],
      accountMode: 'OWN_ACCOUNT',
      accountId: assetAccountId,
    });
    expect(created.success).toBe(true);
    if (!created.success) return;
    const updated = await updateConcept(created.id, {
      name: `${PREFIX}Editable`,
      usages: ['BANK_DEBIT', 'BANK_FEE'],
      accountMode: 'OWN_ACCOUNT',
      accountId: assetAccountId,
    });
    expect(updated.success).toBe(true);
    const saved = await prisma.movementConcept.findUniqueOrThrow({ where: { id: created.id } });
    expect(saved.usages.sort()).toEqual(['BANK_DEBIT', 'BANK_FEE']);
  });

  it('deleteConcept rechaza concepto usado en una línea', async () => {
    const created = await createConcept({
      name: `${PREFIX}Usado`,
      usages: ['FUND_BANK_CHARGES'],
      accountMode: 'OWN_ACCOUNT',
      accountId: expenseAccountId,
    });
    expect(created.success).toBe(true);
    if (!created.success) return;

    await prisma.fundMovement.create({
      data: {
        companyId,
        date: new Date('2026-01-15'),
        type: 'BANK_CHARGES',
        amount: 100,
        description: `${PREFIX}Movimiento`,
        createdBy: `${PREFIX}user`,
        lines: {
          create: [
            {
              accountId: expenseAccountId,
              description: `${PREFIX}Línea`,
              amount: 100,
              position: 0,
              conceptId: created.id,
            },
          ],
        },
      },
    });

    const result = await deleteConcept(created.id);
    expect(result).toEqual({
      success: false,
      error: 'Este concepto ya se usó en movimientos: desactivalo en lugar de borrarlo.',
    });
    expect(await prisma.movementConcept.count({ where: { id: created.id } })).toBe(1);
  });

  it('deleteConcept borra uno sin uso', async () => {
    const created = await createConcept({
      name: `${PREFIX}Sin uso`,
      usages: ['BANK_DEPOSIT'],
      accountMode: 'OWN_ACCOUNT',
      accountId: assetAccountId,
    });
    expect(created.success).toBe(true);
    if (!created.success) return;
    expect((await deleteConcept(created.id)).success).toBe(true);
    expect(await prisma.movementConcept.count({ where: { id: created.id } })).toBe(0);
  });
});
