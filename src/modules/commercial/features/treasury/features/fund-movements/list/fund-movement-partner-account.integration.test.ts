/**
 * Tests de integración de la cuenta de aportes por socio (TSK-717, Fase 3)
 * contra la base real de desarrollo.
 *
 * Mismo andamiaje que `fund-movement-lines.integration.test.ts` (TSK-585):
 * `describe.skipIf` cuando no hay base, prefijo `TSK717-TEST-` en todo lo que
 * se crea, los cuatro `vi.mock` de la frontera de sesión/permisos/caché de
 * Next, y limpieza + verificación en el `afterAll`. Ver ese archivo para el
 * porqué de cada mock: acá se ejercita el CÓDIGO REAL de
 * `createFundMovement` / `confirmFundMovement`, sin ninguna réplica.
 *
 * Qué se prueba: que el asiento del aporte/retiro se imputa a la cuenta de
 * aportes PROPIA del socio (`Partner.contributionsAccountId`) cuando la
 * tiene, que cae a la cuenta por defecto de `AccountingSettings` cuando no,
 * y que sin ninguna de las dos -o con un socio ausente/inválido, o con una
 * cuenta propia no imputable- la confirmación falla con un mensaje que
 * nombra al socio y dice dónde corregirlo, dejando el movimiento en DRAFT.
 */
import 'dotenv/config';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { prisma } from '@/shared/lib/prisma';

import type { FundMovementFormInput } from '../shared/validators';

// Frontera aislada: sesión/permisos/empresa activa/caché de Next.
vi.mock('@/shared/lib/current-user', () => ({ getCurrentUserId: vi.fn() }));
vi.mock('@/shared/lib/company', () => ({ getActiveCompanyId: vi.fn() }));
vi.mock('@/shared/lib/permissions', () => ({
  checkPermission: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { getActiveCompanyId } from '@/shared/lib/company';
import { getCurrentUserId } from '@/shared/lib/current-user';
// Código real de producción: nada de esto se reimplementa acá.
import { confirmFundMovement, createFundMovement } from './actions.server';

const PREFIX = 'TSK717-TEST-';

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

async function fetchEntryLinesForMovement(movementId: string): Promise<JournalLineRow[]> {
  const movement = await prisma.fundMovement.findUniqueOrThrow({
    where: { id: movementId },
    select: { journalEntryId: true },
  });
  if (!movement.journalEntryId) throw new Error('El movimiento no tiene asiento generado');

  const rows = await prisma.journalEntryLine.findMany({
    where: { entryId: movement.journalEntryId },
    select: { accountId: true, debit: true, credit: true },
  });
  return rows.map((r) => ({
    accountId: r.accountId,
    debit: Number(r.debit),
    credit: Number(r.credit),
  }));
}

describe.skipIf(!dbAvailable)('integración: cuenta de aportes por socio (TSK-717)', () => {
  let companyId: string;

  let bankLedgerAccountId: string; // cuenta contable del banco
  let globalAccountId: string; // cuenta de aportes por defecto (EQUITY)
  let sociaAAccountId: string; // cuenta propia de la socia A (ASSET, para cubrir que el tipo Activo se acepta)
  const sociaAAccountCode = 'T717-SOCIA-A';

  let bankId: string;
  let sociaAId: string; // con cuenta propia
  let sociaBId: string; // sin cuenta propia
  const sociaAName = `${PREFIX}Socia A con cuenta`;
  const sociaBName = `${PREFIX}Socia B sin cuenta`;

  beforeAll(async () => {
    const company = await prisma.company.create({
      data: { name: `${PREFIX}Empresa`, isActive: true },
    });
    companyId = company.id;

    const [bankLedger, global, sociaAAccount] = await Promise.all([
      prisma.account.create({
        data: {
          companyId,
          code: 'T717-BANCO',
          name: `${PREFIX}Banco`,
          type: 'ASSET',
          nature: 'DEBIT',
        },
      }),
      prisma.account.create({
        data: {
          companyId,
          code: 'T717-GLOBAL',
          name: `${PREFIX}Aportes de Socios (por defecto)`,
          type: 'EQUITY',
          nature: 'CREDIT',
        },
      }),
      prisma.account.create({
        data: {
          companyId,
          code: sociaAAccountCode,
          name: `${PREFIX}Cuenta particular Socia A`,
          type: 'ASSET',
          nature: 'DEBIT',
        },
      }),
    ]);
    bankLedgerAccountId = bankLedger.id;
    globalAccountId = global.id;
    sociaAAccountId = sociaAAccount.id;

    const bank = await prisma.bankAccount.create({
      data: {
        companyId,
        bankName: `${PREFIX}Banco`,
        accountNumber: 'T717-9001',
        accountType: 'CHECKING',
        balance: 10000000,
        status: 'ACTIVE',
        accountId: bankLedgerAccountId,
      },
    });
    bankId = bank.id;

    await prisma.accountingSettings.create({
      data: {
        companyId,
        fiscalYearStart: new Date('2026-01-01'),
        fiscalYearEnd: new Date('2026-12-31'),
        lastEntryNumber: 0,
        partnerContributionsAccountId: globalAccountId,
      },
    });

    const [sociaA, sociaB] = await Promise.all([
      prisma.partner.create({
        data: {
          companyId,
          name: sociaAName,
          createdBy: `${PREFIX}user`,
          contributionsAccountId: sociaAAccountId,
        },
        select: { id: true },
      }),
      prisma.partner.create({
        data: { companyId, name: sociaBName, createdBy: `${PREFIX}user` },
        select: { id: true },
      }),
    ]);
    sociaAId = sociaA.id;
    sociaBId = sociaB.id;

    vi.mocked(getActiveCompanyId).mockResolvedValue(companyId);
    vi.mocked(getCurrentUserId).mockResolvedValue(`${PREFIX}user`);
  });

  afterAll(async () => {
    // Guarda: sin `companyId` Prisma omite el filtro y borraría tablas enteras.
    if (companyId) {
      // Orden inverso de dependencias. El socio va después de los movimientos
      // (no hay FK, pero es su dueño lógico) y antes de las cuentas, porque
      // `Partner.contributionsAccountId` apunta a `accounts` (TSK-717).
      await prisma.fundMovement.deleteMany({ where: { companyId } });
      await prisma.journalEntry.deleteMany({ where: { companyId } });
      await prisma.bankAccount.deleteMany({ where: { companyId } });
      await prisma.accountingSettings.deleteMany({ where: { companyId } });
      await prisma.partner.deleteMany({ where: { companyId } });
      await prisma.account.deleteMany({ where: { companyId } });
      await prisma.company.deleteMany({ where: { id: companyId } });
    }

    const [remainingMovements, remainingPartners, remainingAccounts, remainingCompanies] =
      await Promise.all([
        prisma.fundMovement.count({ where: { description: { startsWith: PREFIX } } }),
        prisma.partner.count({ where: { name: { startsWith: PREFIX } } }),
        prisma.account.count({ where: { name: { startsWith: PREFIX } } }),
        prisma.company.count({ where: { name: { startsWith: PREFIX } } }),
      ]);
    expect(remainingMovements).toBe(0);
    expect(remainingPartners).toBe(0);
    expect(remainingAccounts).toBe(0);
    expect(remainingCompanies).toBe(0);

    await prisma.$disconnect();
  });

  const aporteDe = (
    partnerId: string,
    description: string,
    amount: number
  ): FundMovementFormInput => ({
    type: 'PARTNER_CONTRIBUTION',
    date: '2026-03-10',
    amount: String(amount),
    description: `${PREFIX}${description}`,
    sourceFund: '',
    destinationFund: `BANK:${bankId}`,
    partnerId,
  });

  describe('caso 1: aporte de una socia con cuenta propia', () => {
    let lines: JournalLineRow[];
    const amount = 100000;

    beforeAll(async () => {
      const result = await createFundMovement(aporteDe(sociaAId, 'Aporte socia A', amount), true);
      expect(result.success).toBe(true);
      if (!result.success) throw new Error(result.error);
      lines = await fetchEntryLinesForMovement(result.id!);
    });

    it('genera exactamente dos líneas', () => {
      expect(lines).toHaveLength(2);
    });

    it('debita el banco y acredita la cuenta PROPIA de la socia, no la global', () => {
      const banco = lines.find((l) => l.accountId === bankLedgerAccountId);
      const propia = lines.find((l) => l.accountId === sociaAAccountId);
      expect(banco).toMatchObject({ debit: amount, credit: 0 });
      expect(propia).toMatchObject({ debit: 0, credit: amount });
      expect(lines.some((l) => l.accountId === globalAccountId)).toBe(false);
    });
  });

  describe('caso 2: aporte de una socia sin cuenta propia cae a la cuenta por defecto', () => {
    let lines: JournalLineRow[];
    const amount = 40000;

    beforeAll(async () => {
      const result = await createFundMovement(aporteDe(sociaBId, 'Aporte socia B', amount), true);
      expect(result.success).toBe(true);
      if (!result.success) throw new Error(result.error);
      lines = await fetchEntryLinesForMovement(result.id!);
    });

    it('debita el banco y acredita la cuenta por defecto', () => {
      expect(lines).toHaveLength(2);
      const banco = lines.find((l) => l.accountId === bankLedgerAccountId);
      const global = lines.find((l) => l.accountId === globalAccountId);
      expect(banco).toMatchObject({ debit: amount, credit: 0 });
      expect(global).toMatchObject({ debit: 0, credit: amount });
      expect(lines.some((l) => l.accountId === sociaAAccountId)).toBe(false);
    });
  });

  describe('caso 3: retiro de una socia con cuenta propia', () => {
    let lines: JournalLineRow[];
    const amount = 25000;

    beforeAll(async () => {
      const result = await createFundMovement(
        {
          type: 'PARTNER_WITHDRAWAL',
          date: '2026-03-11',
          amount: String(amount),
          description: `${PREFIX}Retiro socia A`,
          sourceFund: `BANK:${bankId}`,
          destinationFund: '',
          partnerId: sociaAId,
        },
        true
      );
      expect(result.success).toBe(true);
      if (!result.success) throw new Error(result.error);
      lines = await fetchEntryLinesForMovement(result.id!);
    });

    it('debita la cuenta PROPIA de la socia y acredita el banco', () => {
      expect(lines).toHaveLength(2);
      const propia = lines.find((l) => l.accountId === sociaAAccountId);
      const banco = lines.find((l) => l.accountId === bankLedgerAccountId);
      expect(propia).toMatchObject({ debit: amount, credit: 0 });
      expect(banco).toMatchObject({ debit: 0, credit: amount });
      expect(lines.some((l) => l.accountId === globalAccountId)).toBe(false);
    });
  });

  describe('caso 4: socia sin cuenta propia y sin cuenta por defecto', () => {
    it('no confirma, nombra a la socia y dice dónde configurarla; el movimiento queda en borrador', async () => {
      await prisma.accountingSettings.update({
        where: { companyId },
        data: { partnerContributionsAccountId: null },
      });

      try {
        const result = await createFundMovement(
          aporteDe(sociaBId, 'Aporte socia B sin global', 1000),
          true
        );

        expect(result.success).toBe(false);
        if (result.success) return;
        expect(result.error).toContain(sociaBName);
        expect(result.error).toContain('no tiene cuenta de aportes');
        expect(result.error).toContain('Ajustes contables');

        // El borrador quedó creado (createFundMovement lo crea antes de
        // confirmar) pero sin asiento ni cambio de estado.
        const draft = await prisma.fundMovement.findFirst({
          where: { companyId, description: `${PREFIX}Aporte socia B sin global` },
          select: { status: true, journalEntryId: true },
        });
        expect(draft).toMatchObject({ status: 'DRAFT', journalEntryId: null });
      } finally {
        await prisma.accountingSettings.update({
          where: { companyId },
          data: { partnerContributionsAccountId: globalAccountId },
        });
      }
    });
  });

  describe('caso 5: borrador legado sin socio (anterior a TSK-717)', () => {
    it('no confirma y pide editar el movimiento para elegir el socio', async () => {
      // Se saltea el schema a propósito: es el dato legado que ya existe en
      // la base (aportes guardados cuando el socio era opcional).
      const legacy = await prisma.fundMovement.create({
        data: {
          companyId,
          status: 'DRAFT',
          date: new Date('2026-03-12T12:00:00.000Z'),
          type: 'PARTNER_CONTRIBUTION',
          amount: 5000,
          description: `${PREFIX}Aporte legado sin socio`,
          fundInKind: 'BANK',
          fundInId: bankId,
          fundInLabel: `${PREFIX}Banco - T717-9001`,
          partnerId: null,
          createdBy: `${PREFIX}user`,
        },
        select: { id: true },
      });

      const result = await confirmFundMovement(legacy.id);

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error).toContain('Editá el movimiento y elegí el socio');

      const after = await prisma.fundMovement.findUniqueOrThrow({
        where: { id: legacy.id },
        select: { status: true, journalEntryId: true },
      });
      expect(after).toMatchObject({ status: 'DRAFT', journalEntryId: null });
    });
  });

  describe('caso 6: la cuenta propia de la socia no es imputable', () => {
    it('no confirma, nombra a la socia y a la cuenta, y NO cae en silencio a la cuenta por defecto', async () => {
      await prisma.account.update({ where: { id: sociaAAccountId }, data: { isActive: false } });

      try {
        const result = await createFundMovement(
          aporteDe(sociaAId, 'Aporte socia A con cuenta inactiva', 2000),
          true
        );

        expect(result.success).toBe(false);
        if (result.success) return;
        expect(result.error).toContain(sociaAName);
        expect(result.error).toContain(sociaAAccountCode);

        const draft = await prisma.fundMovement.findFirst({
          where: { companyId, description: `${PREFIX}Aporte socia A con cuenta inactiva` },
          select: { status: true, journalEntryId: true },
        });
        expect(draft).toMatchObject({ status: 'DRAFT', journalEntryId: null });

        // Ningún asiento de este intento tocó la global.
        const globalLines = await prisma.journalEntryLine.count({
          where: {
            accountId: globalAccountId,
            entry: { description: `${PREFIX}Aporte socia A con cuenta inactiva` },
          },
        });
        expect(globalLines).toBe(0);
      } finally {
        await prisma.account.update({ where: { id: sociaAAccountId }, data: { isActive: true } });
      }
    });
  });

  describe('caso 7: el socio del borrador no es de la empresa', () => {
    it('rechaza el borrador al crearlo (no nace huérfano)', async () => {
      const result = await createFundMovement(
        aporteDe('00000000-0000-4000-8000-000000000000', 'Aporte con socio inexistente', 1000),
        false
      );

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error).toBe('El socio seleccionado no es válido');

      const count = await prisma.fundMovement.count({
        where: { companyId, description: `${PREFIX}Aporte con socio inexistente` },
      });
      expect(count).toBe(0);
    });

    it('un borrador cuyo socio fue borrado después no confirma y pide elegir otro', async () => {
      // Socio que existe al crear el borrador y desaparece antes de confirmar.
      const efimero = await prisma.partner.create({
        data: { companyId, name: `${PREFIX}Socio efímero`, createdBy: `${PREFIX}user` },
        select: { id: true },
      });
      const draft = await createFundMovement(
        aporteDe(efimero.id, 'Aporte de socio efímero', 1000),
        false
      );
      expect(draft.success).toBe(true);
      if (!draft.success) throw new Error(draft.error);

      await prisma.partner.delete({ where: { id: efimero.id } });

      const result = await confirmFundMovement(draft.id!);
      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error).toContain('El socio del movimiento ya no existe');
    });
  });
});
