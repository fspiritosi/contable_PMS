/**
 * Tests de integración de los conceptos en los movimientos de fondo (TSK-791,
 * Tarea 5) contra la base real de desarrollo.
 *
 * Mismo andamiaje que `fund-movement-lines.integration.test.ts`: `describe.skipIf`
 * sin base, prefijo `TSK791-T5-` en todo lo que se crea, los `vi.mock` de la
 * frontera de sesión/permisos/caché de Next, y limpieza + verificación en el
 * `afterAll`. Se ejercita el código real de `createFundMovement`,
 * `updateFundMovement` y `confirmFundMovement`.
 *
 * Qué se prueba:
 *  - Gastos bancarios: cada línea imputa a la cuenta de su concepto, resuelta
 *    al guardar y otra vez al confirmar (gana la cuenta actual del concepto).
 *  - Un concepto desactivado, sin el uso o de otra empresa se rechaza, y el
 *    rechazo al confirmar no mueve saldos.
 *  - Aporte/Retiro: con concepto de cuenta propia se imputa a esa cuenta; con
 *    "cuenta del socio" se imputa como antes; si hay conceptos activos para el
 *    uso, el concepto es obligatorio; sin conceptos, todo sigue como antes.
 *
 * La empresa NO tiene cuenta de aportes por defecto: así "imputa a la cuenta
 * del concepto aunque el socio no tenga cuenta" no puede pasar de casualidad.
 */
import 'dotenv/config';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { ConceptUsage } from '@/generated/prisma/enums';
import { prisma } from '@/shared/lib/prisma';

import type { FundMovementFormInput } from '../shared/validators';

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
  confirmFundMovement,
  createFundMovement,
  getFundMovementCatalogs,
  updateFundMovement,
} from './actions.server';

const PREFIX = 'TSK791-T5-';

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
  description: string;
}

async function fetchEntryLines(movementId: string): Promise<JournalLineRow[]> {
  const movement = await prisma.fundMovement.findUniqueOrThrow({
    where: { id: movementId },
    select: { journalEntryId: true },
  });
  if (!movement.journalEntryId) throw new Error('El movimiento no tiene asiento generado');
  const rows = await prisma.journalEntryLine.findMany({
    where: { entryId: movement.journalEntryId },
    select: { accountId: true, debit: true, credit: true, description: true },
  });
  return rows.map((r) => ({
    accountId: r.accountId,
    debit: Number(r.debit),
    credit: Number(r.credit),
    description: r.description ?? '',
  }));
}

async function bankBalance(id: string): Promise<number> {
  const bank = await prisma.bankAccount.findUniqueOrThrow({
    where: { id },
    select: { balance: true },
  });
  return Number(bank.balance);
}

describe.skipIf(!dbAvailable)('integración: movimientos de fondo con concepto (TSK-791)', () => {
  let companyId: string;
  let otherCompanyId: string;

  let bankLedgerId: string;
  let commissionAccountId: string; // EXPENSE
  let sircrebAccountId: string; // ASSET
  let altExpenseAccountId: string; // EXPENSE, para cambiar la cuenta de un concepto
  let obraAccountId: string; // EQUITY, cuenta propia del concepto de aporte/retiro
  let partnerOwnAccountId: string; // EQUITY, cuenta de aportes propia de un socio

  let bankId: string;
  let partnerSinCuentaId: string;
  let partnerConCuentaId: string;

  const concepts: Record<string, string> = {};

  async function mkConcept(
    key: string,
    data: {
      name: string;
      usages: ConceptUsage[];
      accountMode?: 'OWN_ACCOUNT' | 'PARTNER_ACCOUNT';
      accountId?: string | null;
      companyId?: string;
    }
  ) {
    const c = await prisma.movementConcept.create({
      data: {
        companyId: data.companyId ?? companyId,
        name: `${PREFIX}${data.name}`,
        usages: data.usages,
        accountMode: data.accountMode ?? 'OWN_ACCOUNT',
        accountId: data.accountId ?? null,
        createdBy: `${PREFIX}user`,
      },
      select: { id: true },
    });
    concepts[key] = c.id;
    return c.id;
  }

  const mkAccount = (code: string, type: 'ASSET' | 'EXPENSE' | 'EQUITY', company = companyId) =>
    prisma.account.create({
      data: {
        companyId: company,
        code: `T791T5-${code}`,
        name: `${PREFIX}${code}`,
        type,
        nature: type === 'EQUITY' ? 'CREDIT' : 'DEBIT',
      },
      select: { id: true },
    });

  /** Gastos bancarios del banco de prueba con las líneas dadas. */
  const gastos = (
    description: string,
    lines: { conceptId: string; description: string; amount: string }[]
  ): FundMovementFormInput => ({
    type: 'BANK_CHARGES',
    date: '2026-06-10',
    description: `${PREFIX}${description}`,
    sourceFund: `BANK:${bankId}`,
    destinationFund: '',
    partnerId: '',
    lines,
  });

  /** Aporte de socio al banco de prueba. */
  const aporte = (
    description: string,
    partnerId: string,
    conceptId: string,
    amount = '1000'
  ): FundMovementFormInput => ({
    type: 'PARTNER_CONTRIBUTION',
    date: '2026-06-11',
    amount,
    description: `${PREFIX}${description}`,
    sourceFund: '',
    destinationFund: `BANK:${bankId}`,
    partnerId,
    conceptId,
  });

  beforeAll(async () => {
    const [company, other] = await Promise.all([
      prisma.company.create({ data: { name: `${PREFIX}Empresa`, isActive: true } }),
      prisma.company.create({ data: { name: `${PREFIX}Otra`, isActive: true } }),
    ]);
    companyId = company.id;
    otherCompanyId = other.id;

    const [bankLedger, commission, sircreb, altExpense, obra, partnerOwn, otherExpense] =
      await Promise.all([
        mkAccount('BANCO', 'ASSET'),
        mkAccount('COMISION', 'EXPENSE'),
        mkAccount('SIRCREB', 'ASSET'),
        mkAccount('OTRO-GASTO', 'EXPENSE'),
        mkAccount('OBRA', 'EQUITY'),
        mkAccount('SOCIO-PROPIA', 'EQUITY'),
        mkAccount('AJENA', 'EXPENSE', otherCompanyId),
      ]);
    bankLedgerId = bankLedger.id;
    commissionAccountId = commission.id;
    sircrebAccountId = sircreb.id;
    altExpenseAccountId = altExpense.id;
    obraAccountId = obra.id;
    partnerOwnAccountId = partnerOwn.id;

    const bank = await prisma.bankAccount.create({
      data: {
        companyId,
        bankName: `${PREFIX}Banco`,
        accountNumber: 'T791T5-9001',
        accountType: 'CHECKING',
        balance: 10000000,
        status: 'ACTIVE',
        accountId: bankLedgerId,
      },
    });
    bankId = bank.id;

    // Sin cuenta de aportes por defecto, a propósito (ver el comentario de arriba).
    await prisma.accountingSettings.create({
      data: {
        companyId,
        fiscalYearStart: new Date('2026-01-01'),
        fiscalYearEnd: new Date('2026-12-31'),
        lastEntryNumber: 0,
      },
    });

    const [sinCuenta, conCuenta] = await Promise.all([
      prisma.partner.create({
        data: { companyId, name: `${PREFIX}Socio sin cuenta`, createdBy: `${PREFIX}user` },
        select: { id: true },
      }),
      prisma.partner.create({
        data: {
          companyId,
          name: `${PREFIX}Socio con cuenta`,
          contributionsAccountId: partnerOwnAccountId,
          createdBy: `${PREFIX}user`,
        },
        select: { id: true },
      }),
    ]);
    partnerSinCuentaId = sinCuenta.id;
    partnerConCuentaId = conCuenta.id;

    await mkConcept('comision', {
      name: 'Comisión mantenimiento',
      usages: ['FUND_BANK_CHARGES'],
      accountId: commissionAccountId,
    });
    await mkConcept('sircreb', {
      name: 'Percepción Sircreb',
      usages: ['FUND_BANK_CHARGES', 'BANK_DEBIT'],
      accountId: sircrebAccountId,
    });
    await mkConcept('ajeno', {
      name: 'Concepto de otra empresa',
      usages: ['FUND_BANK_CHARGES'],
      accountId: otherExpense.id,
      companyId: otherCompanyId,
    });
    await mkConcept('aporteObra', {
      name: 'Aporte para obra',
      usages: ['FUND_PARTNER_CONTRIBUTION', 'FUND_PARTNER_WITHDRAWAL'],
      accountId: obraAccountId,
    });
    await mkConcept('aporteSocio', {
      name: 'Aporte de capital',
      usages: ['FUND_PARTNER_CONTRIBUTION'],
      accountMode: 'PARTNER_ACCOUNT',
    });

    vi.mocked(getActiveCompanyId).mockResolvedValue(companyId);
    vi.mocked(getCurrentUserId).mockResolvedValue(`${PREFIX}user`);
  });

  afterAll(async () => {
    // Misma guarda que en `fund-movement-lines`: sin ids, Prisma omitiría el filtro.
    const companyIds = [companyId, otherCompanyId].filter(Boolean);
    if (companyIds.length > 0) {
      const inCompanies = { companyId: { in: companyIds } };
      await prisma.fundMovement.deleteMany({ where: inCompanies });
      await prisma.journalEntry.deleteMany({ where: inCompanies });
      await prisma.bankAccount.deleteMany({ where: inCompanies });
      await prisma.accountingSettings.deleteMany({ where: inCompanies });
      await prisma.partner.deleteMany({ where: inCompanies });
      await prisma.movementConcept.deleteMany({ where: inCompanies });
      await prisma.account.deleteMany({ where: inCompanies });
      await prisma.company.deleteMany({ where: { id: { in: companyIds } } });
    }

    const [movements, conceptsLeft, partners, accounts, companies] = await Promise.all([
      prisma.fundMovement.count({ where: { description: { startsWith: PREFIX } } }),
      prisma.movementConcept.count({ where: { name: { startsWith: PREFIX } } }),
      prisma.partner.count({ where: { name: { startsWith: PREFIX } } }),
      prisma.account.count({ where: { name: { startsWith: PREFIX } } }),
      prisma.company.count({ where: { name: { startsWith: PREFIX } } }),
    ]);
    await prisma.$disconnect();
    expect({ movements, conceptsLeft, partners, accounts, companies }).toEqual({
      movements: 0,
      conceptsLeft: 0,
      partners: 0,
      accounts: 0,
      companies: 0,
    });
  });

  it('los catálogos traen los conceptos activos por tipo, sin datos de cuenta', async () => {
    const catalogs = await getFundMovementCatalogs();
    expect(Object.keys(catalogs.concepts).sort()).toEqual([
      'BANK_CHARGES',
      'PARTNER_CONTRIBUTION',
      'PARTNER_WITHDRAWAL',
    ]);
    expect(catalogs.concepts.BANK_CHARGES).toEqual([
      {
        id: concepts.comision,
        name: `${PREFIX}Comisión mantenimiento`,
        accountMode: 'OWN_ACCOUNT',
      },
      { id: concepts.sircreb, name: `${PREFIX}Percepción Sircreb`, accountMode: 'OWN_ACCOUNT' },
    ]);
    expect(catalogs.concepts.PARTNER_CONTRIBUTION.map((c) => c.id)).toEqual([
      concepts.aporteSocio,
      concepts.aporteObra,
    ]);
    expect(catalogs.concepts.PARTNER_WITHDRAWAL.map((c) => c.id)).toEqual([concepts.aporteObra]);
    expect('defaultBankChargesAccount' in catalogs).toBe(false);
  });

  it('gastos bancarios: cada línea imputa a la cuenta de su concepto y la descripción cae al nombre si no hay detalle', async () => {
    const result = await createFundMovement(
      gastos('Gastos de junio', [
        { conceptId: concepts.comision, description: '  Mantenimiento junio  ', amount: '100.50' },
        { conceptId: concepts.sircreb, description: '', amount: '49.50' },
      ]),
      true
    );
    expect(result).toMatchObject({ success: true });
    if (!result.success) return;

    const entry = await fetchEntryLines(result.id!);
    expect(entry).toHaveLength(3);
    expect(entry.find((l) => l.accountId === commissionAccountId)).toMatchObject({
      debit: 100.5,
      credit: 0,
      description: 'Mantenimiento junio',
    });
    expect(entry.find((l) => l.accountId === sircrebAccountId)).toMatchObject({
      debit: 49.5,
      credit: 0,
      description: `${PREFIX}Percepción Sircreb`,
    });
    expect(entry.find((l) => l.accountId === bankLedgerId)).toMatchObject({
      debit: 0,
      credit: 150,
    });

    const lines = await prisma.fundMovementLine.findMany({
      where: { movementId: result.id! },
      orderBy: { position: 'asc' },
      select: { conceptId: true, conceptName: true, accountId: true, description: true },
    });
    expect(lines).toEqual([
      {
        conceptId: concepts.comision,
        conceptName: `${PREFIX}Comisión mantenimiento`,
        accountId: commissionAccountId,
        description: 'Mantenimiento junio',
      },
      {
        conceptId: concepts.sircreb,
        conceptName: `${PREFIX}Percepción Sircreb`,
        accountId: sircrebAccountId,
        description: '',
      },
    ]);
  });

  it('al confirmar toma la cuenta actual del concepto, no la del borrador', async () => {
    const mutableId = await mkConcept('mutable', {
      name: 'Concepto que cambia',
      usages: ['FUND_BANK_CHARGES'],
      accountId: commissionAccountId,
    });

    // El borrador nace con otro concepto y se edita: la edición reemplaza las líneas.
    const draft = await createFundMovement(
      gastos('Borrador que cambia de cuenta', [
        { conceptId: concepts.comision, description: '', amount: '80' },
      ])
    );
    expect(draft).toMatchObject({ success: true });
    if (!draft.success) return;
    const updated = await updateFundMovement(
      draft.id!,
      gastos('Borrador que cambia de cuenta', [
        { conceptId: mutableId, description: '', amount: '80' },
      ])
    );
    expect(updated).toMatchObject({ success: true });

    const saved = await prisma.fundMovementLine.findFirstOrThrow({
      where: { movementId: draft.id! },
      select: { conceptId: true, accountId: true, conceptName: true },
    });
    expect(saved).toEqual({
      conceptId: mutableId,
      accountId: commissionAccountId,
      conceptName: `${PREFIX}Concepto que cambia`,
    });

    // Contabilidad cambia la cuenta y el nombre mientras el movimiento está en borrador.
    await prisma.movementConcept.update({
      where: { id: mutableId },
      data: { accountId: altExpenseAccountId, name: `${PREFIX}Concepto renombrado` },
    });

    const confirmed = await confirmFundMovement(draft.id!);
    expect(confirmed).toMatchObject({ success: true });

    const entry = await fetchEntryLines(draft.id!);
    expect(entry.find((l) => l.debit > 0)).toMatchObject({
      accountId: altExpenseAccountId,
      debit: 80,
      description: `${PREFIX}Concepto renombrado`,
    });
    expect(entry.some((l) => l.accountId === commissionAccountId)).toBe(false);

    const line = await prisma.fundMovementLine.findFirstOrThrow({
      where: { movementId: draft.id! },
      select: { accountId: true, conceptName: true },
    });
    expect(line).toEqual({
      accountId: altExpenseAccountId,
      conceptName: `${PREFIX}Concepto renombrado`,
    });
  });

  describe('rechaza confirmar con concepto inactivo o sin el uso', () => {
    async function draftWith(conceptKey: string, label: string) {
      const id = await mkConcept(conceptKey, {
        name: label,
        usages: ['FUND_BANK_CHARGES'],
        accountId: commissionAccountId,
      });
      const draft = await createFundMovement(
        gastos(`Borrador con ${label}`, [{ conceptId: id, description: '', amount: '70' }])
      );
      expect(draft).toMatchObject({ success: true });
      if (!draft.success) throw new Error(draft.error);
      return { conceptId: id, movementId: draft.id! };
    }

    async function expectRejectedWithoutMovingBalances(movementId: string, message: string) {
      const balanceBefore = await bankBalance(bankId);
      const bankMovementsBefore = await prisma.bankMovement.count({
        where: { bankAccountId: bankId },
      });

      const result = await confirmFundMovement(movementId);

      expect(result).toEqual({ success: false, error: message });
      expect(await bankBalance(bankId)).toBe(balanceBefore);
      expect(await prisma.bankMovement.count({ where: { bankAccountId: bankId } })).toBe(
        bankMovementsBefore
      );
      const movement = await prisma.fundMovement.findUniqueOrThrow({
        where: { id: movementId },
        select: { status: true, journalEntryId: true },
      });
      expect(movement).toEqual({ status: 'DRAFT', journalEntryId: null });
    }

    it('concepto desactivado después de guardar el borrador', async () => {
      const { conceptId, movementId } = await draftWith('inactivado', 'Concepto inactivado');
      await prisma.movementConcept.update({ where: { id: conceptId }, data: { isActive: false } });

      await expectRejectedWithoutMovingBalances(
        movementId,
        `El concepto «${PREFIX}Concepto inactivado» está desactivado. Editá el movimiento y elegí otro concepto.`
      );
    });

    it('concepto al que Contabilidad le quitó el uso', async () => {
      const { conceptId, movementId } = await draftWith('sinUso', 'Concepto sin el uso');
      await prisma.movementConcept.update({
        where: { id: conceptId },
        data: { usages: ['BANK_FEE'] },
      });

      await expectRejectedWithoutMovingBalances(
        movementId,
        `El concepto «${PREFIX}Concepto sin el uso» ya no aplica a Gastos e impuestos bancarios. Editá el movimiento y elegí otro concepto.`
      );
    });

    it('borrador viejo con una línea sin concepto', async () => {
      const legacy = await prisma.fundMovement.create({
        data: {
          companyId,
          status: 'DRAFT',
          date: new Date('2026-06-12T12:00:00.000Z'),
          type: 'BANK_CHARGES',
          amount: 30,
          description: `${PREFIX}Gastos viejos sin concepto`,
          fundOutKind: 'BANK',
          fundOutId: bankId,
          fundOutLabel: `${PREFIX}Banco`,
          createdBy: `${PREFIX}user`,
          lines: {
            create: [
              {
                accountId: commissionAccountId,
                conceptId: concepts.comision,
                conceptName: `${PREFIX}Comisión mantenimiento`,
                description: 'Con concepto',
                amount: 10,
                position: 0,
              },
              {
                accountId: commissionAccountId,
                description: 'Sin concepto',
                amount: 20,
                position: 1,
              },
            ],
          },
        },
        select: { id: true },
      });

      await expectRejectedWithoutMovingBalances(
        legacy.id,
        'Hay conceptos sin elegir: editá el movimiento y elegí el concepto de cada línea.'
      );
    });
  });

  it('rechaza guardar gastos bancarios con conceptId de otra empresa', async () => {
    const result = await createFundMovement(
      gastos('Gastos con concepto ajeno', [
        { conceptId: concepts.ajeno, description: '', amount: '10' },
      ])
    );

    expect(result).toEqual({
      success: false,
      error: 'El concepto elegido ya no existe. Elegí otro.',
    });
    expect(
      await prisma.fundMovement.count({
        where: { description: `${PREFIX}Gastos con concepto ajeno` },
      })
    ).toBe(0);
  });

  it('buildLinesData ignora líneas fuera de BANK_CHARGES', async () => {
    const result = await createFundMovement({
      ...aporte('Aporte con líneas colgadas', partnerSinCuentaId, concepts.aporteObra),
      lines: [{ conceptId: concepts.comision, description: 'No va', amount: '10' }],
    });
    expect(result).toMatchObject({ success: true });
    if (!result.success) return;
    expect(await prisma.fundMovementLine.count({ where: { movementId: result.id! } })).toBe(0);
  });

  it('gastos bancarios no guardan concepto a nivel movimiento', async () => {
    const result = await createFundMovement({
      ...gastos('Gastos con concepto suelto', [
        { conceptId: concepts.comision, description: '', amount: '10' },
      ]),
      conceptId: concepts.aporteObra,
    });
    expect(result).toMatchObject({ success: true });
    if (!result.success) return;
    const movement = await prisma.fundMovement.findUniqueOrThrow({
      where: { id: result.id! },
      select: { conceptId: true, conceptName: true },
    });
    expect(movement).toEqual({ conceptId: null, conceptName: null });
  });

  it('aporte con concepto de cuenta propia imputa a esa cuenta aunque el socio no tenga cuenta de aportes', async () => {
    const result = await createFundMovement(
      aporte('Aporte para obra', partnerSinCuentaId, concepts.aporteObra, '5000'),
      true
    );
    expect(result).toMatchObject({ success: true });
    if (!result.success) return;

    const entry = await fetchEntryLines(result.id!);
    expect(entry).toHaveLength(2);
    expect(entry.find((l) => l.accountId === bankLedgerId)).toMatchObject({
      debit: 5000,
      credit: 0,
    });
    expect(entry.find((l) => l.accountId === obraAccountId)).toMatchObject({
      debit: 0,
      credit: 5000,
    });

    const movement = await prisma.fundMovement.findUniqueOrThrow({
      where: { id: result.id! },
      select: { conceptId: true, conceptName: true, status: true },
    });
    expect(movement).toEqual({
      conceptId: concepts.aporteObra,
      conceptName: `${PREFIX}Aporte para obra`,
      status: 'CONFIRMED',
    });
  });

  it('retiro con concepto de cuenta propia debita esa cuenta y acredita el banco', async () => {
    const result = await createFundMovement(
      {
        type: 'PARTNER_WITHDRAWAL',
        date: '2026-06-13',
        amount: '700',
        description: `${PREFIX}Retiro para obra`,
        sourceFund: `BANK:${bankId}`,
        destinationFund: '',
        partnerId: partnerSinCuentaId,
        conceptId: concepts.aporteObra,
      },
      true
    );
    expect(result).toMatchObject({ success: true });
    if (!result.success) return;

    const entry = await fetchEntryLines(result.id!);
    expect(entry).toHaveLength(2);
    expect(entry.find((l) => l.accountId === obraAccountId)).toMatchObject({
      debit: 700,
      credit: 0,
    });
    expect(entry.find((l) => l.accountId === bankLedgerId)).toMatchObject({
      debit: 0,
      credit: 700,
    });
  });

  it('aporte con concepto PARTNER_ACCOUNT imputa a la cuenta del socio', async () => {
    const result = await createFundMovement(
      aporte('Aporte de capital', partnerConCuentaId, concepts.aporteSocio, '3000'),
      true
    );
    expect(result).toMatchObject({ success: true });
    if (!result.success) return;

    const entry = await fetchEntryLines(result.id!);
    expect(entry).toHaveLength(2);
    expect(entry.find((l) => l.accountId === partnerOwnAccountId)).toMatchObject({
      debit: 0,
      credit: 3000,
    });
    expect(entry.find((l) => l.accountId === bankLedgerId)).toMatchObject({
      debit: 3000,
      credit: 0,
    });
  });

  it('con concepto PARTNER_ACCOUNT, un socio sin cuenta ni cuenta por defecto sigue bloqueando', async () => {
    const result = await createFundMovement(
      aporte('Aporte de capital sin cuenta', partnerSinCuentaId, concepts.aporteSocio),
      true
    );
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toContain(
      `El socio "${PREFIX}Socio sin cuenta" no tiene cuenta de aportes`
    );
  });

  it('con concepto de cuenta propia, el socio sigue siendo obligatorio al confirmar', async () => {
    const legacy = await prisma.fundMovement.create({
      data: {
        companyId,
        status: 'DRAFT',
        date: new Date('2026-06-14T12:00:00.000Z'),
        type: 'PARTNER_CONTRIBUTION',
        amount: 100,
        description: `${PREFIX}Aporte con concepto y sin socio`,
        fundInKind: 'BANK',
        fundInId: bankId,
        fundInLabel: `${PREFIX}Banco`,
        conceptId: concepts.aporteObra,
        conceptName: `${PREFIX}Aporte para obra`,
        createdBy: `${PREFIX}user`,
      },
      select: { id: true },
    });

    const result = await confirmFundMovement(legacy.id);
    expect(result).toEqual({
      success: false,
      error:
        'Este movimiento no tiene socio asignado. Editá el movimiento y elegí el socio antes de confirmarlo.',
    });
  });

  it('con conceptos de aporte activos, rechaza guardar y confirmar sin concepto', async () => {
    const saved = await createFundMovement(aporte('Aporte sin concepto', partnerConCuentaId, ''));
    expect(saved).toEqual({ success: false, error: 'Elegí el concepto del movimiento' });

    // Borrador anterior a los conceptos: se crea directo con Prisma.
    const legacy = await prisma.fundMovement.create({
      data: {
        companyId,
        status: 'DRAFT',
        date: new Date('2026-06-15T12:00:00.000Z'),
        type: 'PARTNER_CONTRIBUTION',
        amount: 900,
        description: `${PREFIX}Aporte viejo sin concepto`,
        fundInKind: 'BANK',
        fundInId: bankId,
        fundInLabel: `${PREFIX}Banco`,
        partnerId: partnerConCuentaId,
        partnerName: `${PREFIX}Socio con cuenta`,
        createdBy: `${PREFIX}user`,
      },
      select: { id: true },
    });
    const balanceBefore = await bankBalance(bankId);

    const result = await confirmFundMovement(legacy.id);

    expect(result).toEqual({
      success: false,
      error: 'Este movimiento no tiene concepto. Editalo y elegí uno antes de confirmarlo.',
    });
    expect(await bankBalance(bankId)).toBe(balanceBefore);
    const movement = await prisma.fundMovement.findUniqueOrThrow({
      where: { id: legacy.id },
      select: { status: true },
    });
    expect(movement.status).toBe('DRAFT');
  });

  describe('sin conceptos de aporte', () => {
    beforeAll(async () => {
      await prisma.movementConcept.updateMany({
        where: { companyId, usages: { has: 'FUND_PARTNER_CONTRIBUTION' } },
        data: { isActive: false },
      });
    });

    afterAll(async () => {
      if (!companyId) return;
      await prisma.movementConcept.updateMany({
        where: { companyId, id: { in: [concepts.aporteObra, concepts.aporteSocio] } },
        data: { isActive: true },
      });
    });

    it('sin conceptos de aporte, confirma como antes con la cuenta del socio', async () => {
      const result = await createFundMovement(
        aporte('Aporte como antes', partnerConCuentaId, '', '1200'),
        true
      );
      expect(result).toMatchObject({ success: true });
      if (!result.success) return;

      const entry = await fetchEntryLines(result.id!);
      expect(entry).toHaveLength(2);
      expect(entry.find((l) => l.accountId === partnerOwnAccountId)).toMatchObject({
        debit: 0,
        credit: 1200,
      });
      const movement = await prisma.fundMovement.findUniqueOrThrow({
        where: { id: result.id! },
        select: { conceptId: true, conceptName: true },
      });
      expect(movement).toEqual({ conceptId: null, conceptName: null });
    });
  });
});
