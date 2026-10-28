/**
 * Tests de integración de la lectura y resolución de conceptos (TSK-791, Tarea 2)
 * contra la base real de desarrollo. Todo lo que se crea lleva el prefijo
 * `TSK791-T2-`; el `afterAll` lo borra y verifica que no queda nada.
 */
import 'dotenv/config';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { prisma } from '@/shared/lib/prisma';

// `server-only` no existe fuera de un bundle de Next.
vi.mock('server-only', () => ({}));

import {
  countActiveConcepts,
  getActiveConceptOptions,
  resolveConceptForUsage,
} from './concepts.server';

const PREFIX = 'TSK791-T2-';

let dbAvailable = false;
try {
  await prisma.$queryRaw`SELECT 1`;
  dbAvailable = true;
} catch {
  dbAvailable = false;
}

describe.skipIf(!dbAvailable)('conceptos compartidos (integración)', () => {
  let companyId: string;
  let otherCompanyId: string;
  let expenseId: string;
  let assetId: string;
  let parentId: string;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    const [company, other] = await Promise.all([
      prisma.company.create({ data: { name: `${PREFIX}Empresa`, isActive: true } }),
      prisma.company.create({ data: { name: `${PREFIX}Otra`, isActive: true } }),
    ]);
    companyId = company.id;
    otherCompanyId = other.id;

    const mk = (code: string, type: 'EXPENSE' | 'ASSET', isLeaf = true) =>
      prisma.account.create({
        data: {
          companyId,
          code: `T791-${code}`,
          name: `${PREFIX}${code}`,
          type,
          nature: 'DEBIT',
          isLeaf,
        },
      });
    const [expense, asset, parent] = await Promise.all([
      mk('GASTO', 'EXPENSE'),
      mk('ACTIVO', 'ASSET'),
      mk('RUBRO', 'ASSET', false),
    ]);
    expenseId = expense.id;
    assetId = asset.id;
    parentId = parent.id;

    const mkConcept = async (
      key: string,
      data: {
        name: string;
        usages: ('FUND_BANK_CHARGES' | 'FUND_PARTNER_CONTRIBUTION' | 'BANK_FEE')[];
        accountMode?: 'OWN_ACCOUNT' | 'PARTNER_ACCOUNT';
        accountId?: string | null;
        isActive?: boolean;
        companyId?: string;
      }
    ) => {
      const c = await prisma.movementConcept.create({
        data: {
          companyId: data.companyId ?? companyId,
          name: `${PREFIX}${data.name}`,
          usages: data.usages,
          accountMode: data.accountMode ?? 'OWN_ACCOUNT',
          accountId: data.accountId ?? null,
          isActive: data.isActive ?? true,
          createdBy: `${PREFIX}user`,
        },
      });
      ids[key] = c.id;
    };
    await mkConcept('zeta', { name: 'Zeta', usages: ['FUND_BANK_CHARGES'], accountId: expenseId });
    await mkConcept('alfa', {
      name: 'Alfa',
      usages: ['FUND_BANK_CHARGES', 'BANK_FEE'],
      accountId: assetId,
    });
    await mkConcept('inactivo', {
      name: 'Inactivo',
      usages: ['FUND_BANK_CHARGES'],
      accountId: expenseId,
      isActive: false,
    });
    await mkConcept('otroUso', {
      name: 'Otro uso',
      usages: ['BANK_FEE'],
      accountId: assetId,
    });
    await mkConcept('socio', {
      name: 'Socio',
      usages: ['FUND_PARTNER_CONTRIBUTION'],
      accountMode: 'PARTNER_ACCOUNT',
    });
    await mkConcept('noHoja', {
      name: 'No hoja',
      usages: ['FUND_PARTNER_CONTRIBUTION'],
      accountId: parentId,
    });
    await mkConcept('ajeno', {
      name: 'Ajeno',
      usages: ['FUND_BANK_CHARGES'],
      accountId: null,
      companyId: otherCompanyId,
    });
  });

  afterAll(async () => {
    const ids2 = [companyId, otherCompanyId].filter(Boolean);
    if (ids2.length > 0) {
      await prisma.movementConcept.deleteMany({ where: { companyId: { in: ids2 } } });
      await prisma.account.deleteMany({ where: { companyId: { in: ids2 } } });
      await prisma.company.deleteMany({ where: { id: { in: ids2 } } });
    }
    const [concepts, accounts, companies] = await Promise.all([
      prisma.movementConcept.count({ where: { name: { startsWith: PREFIX } } }),
      prisma.account.count({ where: { name: { startsWith: PREFIX } } }),
      prisma.company.count({ where: { name: { startsWith: PREFIX } } }),
    ]);
    await prisma.$disconnect();
    expect({ concepts, accounts, companies }).toEqual({ concepts: 0, accounts: 0, companies: 0 });
  });

  it('getActiveConceptOptions devuelve solo activos con el uso pedido, ordenados por nombre, sin datos de cuenta', async () => {
    const res = await getActiveConceptOptions(prisma, companyId, ['FUND_BANK_CHARGES', 'BANK_FEE']);
    expect(Object.keys(res).sort()).toEqual(['BANK_FEE', 'FUND_BANK_CHARGES']);
    expect(res.FUND_BANK_CHARGES).toEqual([
      { id: ids.alfa, name: `${PREFIX}Alfa`, accountMode: 'OWN_ACCOUNT' },
      { id: ids.zeta, name: `${PREFIX}Zeta`, accountMode: 'OWN_ACCOUNT' },
    ]);
    expect(res.BANK_FEE.map((c) => c.id)).toEqual([ids.alfa, ids.otroUso]);
    expect(Object.keys(res.FUND_BANK_CHARGES[0]).sort()).toEqual(['accountMode', 'id', 'name']);
  });

  it('countActiveConcepts ignora inactivos', async () => {
    expect(await countActiveConcepts(prisma, companyId, 'FUND_BANK_CHARGES')).toBe(2);
    expect(await countActiveConcepts(prisma, companyId, 'BANK_DEPOSIT')).toBe(0);
  });

  it('resolveConceptForUsage devuelve la cuenta propia', async () => {
    const r = await resolveConceptForUsage(prisma, {
      companyId,
      conceptId: ids.zeta,
      usage: 'FUND_BANK_CHARGES',
    });
    expect(r).toEqual({
      id: ids.zeta,
      name: `${PREFIX}Zeta`,
      accountMode: 'OWN_ACCOUNT',
      accountId: expenseId,
    });
  });

  it('resolveConceptForUsage con PARTNER_ACCOUNT devuelve accountId null', async () => {
    const r = await resolveConceptForUsage(prisma, {
      companyId,
      conceptId: ids.socio,
      usage: 'FUND_PARTNER_CONTRIBUTION',
    });
    expect(r.accountMode).toBe('PARTNER_ACCOUNT');
    expect(r.accountId).toBeNull();
  });

  it('rechaza concepto inactivo', async () => {
    await expect(
      resolveConceptForUsage(prisma, { companyId, conceptId: ids.inactivo, usage: 'FUND_BANK_CHARGES' })
    ).rejects.toThrow(`El concepto «${PREFIX}Inactivo» está desactivado. Editá el movimiento y elegí otro concepto.`);
  });

  it('rechaza concepto sin el uso', async () => {
    await expect(
      resolveConceptForUsage(prisma, { companyId, conceptId: ids.otroUso, usage: 'FUND_BANK_CHARGES' })
    ).rejects.toThrow(
      `El concepto «${PREFIX}Otro uso» ya no aplica a Gastos e impuestos bancarios. Editá el movimiento y elegí otro concepto.`
    );
  });

  it('rechaza concepto de otra empresa', async () => {
    await expect(
      resolveConceptForUsage(prisma, { companyId, conceptId: ids.ajeno, usage: 'FUND_BANK_CHARGES' })
    ).rejects.toThrow('El concepto elegido ya no existe. Elegí otro.');
  });

  it('resolveConceptForUsage rechaza cuenta no imputable', async () => {
    await expect(
      resolveConceptForUsage(prisma, {
        companyId,
        conceptId: ids.noHoja,
        usage: 'FUND_PARTNER_CONTRIBUTION',
      })
    ).rejects.toThrow(
      `La cuenta del concepto «${PREFIX}No hoja» no está activa o no es imputable. Pedile a Contabilidad que la corrija en Empresa → Contabilidad → Conceptos.`
    );
  });
});
