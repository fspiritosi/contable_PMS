/**
 * Tests de integración de la corrección en cadena de compras y ventas de inversión
 * (TSK-793, Tarea 5) contra la base real de desarrollo.
 *
 * Las compras y ventas se confirman con la action real (`createFundMovement` con
 * `confirm: true`) y se corrigen con las actions públicas del motor del TSK-792
 * (`previewDocumentCorrection` y después `applyDocumentCorrection` con la huella que
 * devolvió la vista previa). Se aísla solo la frontera de sesión, permisos, empresa
 * activa y caché de Next con `vi.mock`.
 *
 * Cada test arma su propia tenencia (ruling R1). Las tenencias se siembran con
 * Prisma (su ABM llega en la Tarea 6) y la valuación se inserta a mano como un
 * `InvestmentMovement` VALUATION (su lógica llega en la Tarea 8).
 *
 * Aislamiento: todo lo creado lleva el prefijo `TSK793-CO-` y el `afterAll` borra la
 * empresa de prueba con todo lo suyo.
 */
import 'dotenv/config';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { prisma } from '@/shared/lib/prisma';

vi.mock('server-only', () => ({}));
vi.mock('@/shared/lib/current-user', () => ({ getCurrentUserId: vi.fn() }));
vi.mock('@/shared/lib/company', () => ({ getActiveCompanyId: vi.fn() }));
vi.mock('@/shared/lib/permissions', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/shared/lib/permissions')>()),
  checkPermission: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import type { Tx } from '@/modules/accounting/features/integrations/core';
import { cleanupAccountingCompany } from '@/modules/accounting/shared/test-utils/cleanup-accounting-company';
import {
  applyDocumentCorrection,
  previewDocumentCorrection,
} from '@/modules/commercial/shared/actions/document-correction.server';
import type { CorrectionRequest } from '@/modules/commercial/shared/correction/types';
import { loadHoldingMovementsTx } from '@/modules/commercial/shared/effects/investment.server';
import { getActiveCompanyId } from '@/shared/lib/company';
import { getCurrentUserId } from '@/shared/lib/current-user';
import { formatCurrency } from '@/shared/utils/formatters';

import { createFundMovement } from '../fund-movements/list/actions.server';
import type { FundMovementFormInput } from '../fund-movements/shared/validators';
import { positionAt } from './shared/position';

// Toda la suite corre en paralelo con mucha carga: los asientos tardan.
vi.setConfig({ testTimeout: 30_000 });

const PREFIX = 'TSK793-CO-';
const VALUATION_HREF = '/dashboard/commercial/treasury/investments/valuation';

let dbAvailable = false;
try {
  await prisma.$queryRaw`SELECT 1`;
  dbAvailable = true;
} catch {
  dbAvailable = false;
}

describe.skipIf(!dbAvailable)(
  'integración: corrección de compras y ventas de inversión (TSK-793)',
  () => {
    let companyId: string;
    let bankId: string;
    let holdingLedgerId: string;

    const bankBalance = async () =>
      Number(
        (
          await prisma.bankAccount.findUniqueOrThrow({
            where: { id: bankId },
            select: { balance: true },
          })
        ).balance
      );

    const position = async (holdingId: string) =>
      positionAt(await loadHoldingMovementsTx(prisma as unknown as Tx, holdingId));

    const holdingStatus = async (holdingId: string) =>
      (
        await prisma.investmentHolding.findUniqueOrThrow({
          where: { id: holdingId },
          select: { status: true },
        })
      ).status;

    const mkHolding = async (name: string) =>
      (
        await prisma.investmentHolding.create({
          data: {
            companyId,
            bankAccountId: bankId,
            instrumentType: 'BOND',
            name: `${PREFIX}${name}`,
            accountId: holdingLedgerId,
            createdBy: 'test',
          },
          select: { id: true },
        })
      ).id;

    const compra = (
      holdingId: string,
      date: string,
      extra: Partial<FundMovementFormInput> = {}
    ): FundMovementFormInput => ({
      type: 'INVESTMENT_PURCHASE',
      date,
      amount: '1000',
      nominals: '100',
      unitPrice: '10',
      description: `${PREFIX}Compra`,
      sourceFund: `BANK:${bankId}`,
      destinationFund: '',
      partnerId: '',
      holdingId,
      ...extra,
    });

    const venta = (
      holdingId: string,
      date: string,
      extra: Partial<FundMovementFormInput> = {}
    ): FundMovementFormInput => ({
      type: 'INVESTMENT_SALE',
      date,
      amount: '500',
      description: `${PREFIX}Venta`,
      sourceFund: '',
      destinationFund: `BANK:${bankId}`,
      partnerId: '',
      holdingId,
      ...extra,
    });

    async function confirmed(input: FundMovementFormInput): Promise<string> {
      const result = await createFundMovement(input, true);
      if (!result.success || !result.id) {
        throw new Error(`No se pudo confirmar: ${result.success ? 'sin id' : result.error}`);
      }
      return result.id;
    }

    const ref = (id: string) => ({ kind: 'FUND_MOVEMENT' as const, id });

    async function preview(request: CorrectionRequest) {
      const result = await previewDocumentCorrection(request);
      if (!result.success) throw new Error(`Vista previa fallida: ${result.error}`);
      return result.proposal;
    }

    /** Vista previa sin impedimentos y aplicación con su huella; devuelve la propuesta. */
    async function previewAndApply(request: CorrectionRequest) {
      const proposal = await preview(request);
      expect(proposal.impediments).toEqual([]);
      expect(await applyDocumentCorrection(request, proposal.fingerprint)).toEqual({
        success: true,
        applied: true,
      });
      return proposal;
    }

    /** Vista previa con impedimentos: la aplicación se rechaza y no cambia nada. */
    async function expectBlocked(request: CorrectionRequest) {
      const proposal = await preview(request);
      const applied = await applyDocumentCorrection(request, proposal.fingerprint);
      expect(applied).toMatchObject({ success: true, applied: false, reason: 'IMPEDIMENTS' });
      return proposal.impediments;
    }

    beforeAll(async () => {
      const company = await prisma.company.create({
        data: { name: `${PREFIX}Empresa`, isActive: true },
      });
      companyId = company.id;

      const mk = (code: string, type: 'ASSET' | 'EXPENSE' | 'REVENUE') =>
        prisma.account.create({
          data: {
            companyId,
            code: `T793C-${code}`,
            name: `${PREFIX}${code}`,
            type,
            nature: type === 'REVENUE' ? 'CREDIT' : 'DEBIT',
          },
          select: { id: true },
        });
      const [banco, tenencia, comisiones, ganancia, perdida] = await Promise.all([
        mk('BANCO', 'ASSET'),
        mk('TENENCIA', 'ASSET'),
        mk('COMISIONES', 'EXPENSE'),
        mk('GANANCIA', 'REVENUE'),
        mk('PERDIDA', 'EXPENSE'),
      ]);
      holdingLedgerId = tenencia.id;

      await prisma.accountingSettings.create({
        data: {
          companyId,
          fiscalYearStart: new Date('2026-01-01'),
          fiscalYearEnd: new Date('2026-12-31'),
          lastEntryNumber: 0,
          holdingGainAccountId: ganancia.id,
          holdingLossAccountId: perdida.id,
          investmentFeesAccountId: comisiones.id,
        },
      });

      bankId = (
        await prisma.bankAccount.create({
          data: {
            companyId,
            bankName: `${PREFIX}Broker`,
            accountNumber: 'T793C-1',
            accountType: 'BROKER',
            balance: 100000,
            status: 'ACTIVE',
            accountId: banco.id,
          },
          select: { id: true },
        })
      ).id;

      vi.mocked(getActiveCompanyId).mockResolvedValue(companyId);
      vi.mocked(getCurrentUserId).mockResolvedValue('test-user');
    });

    afterAll(async () => {
      // Guarda: sin id, Prisma omitiría el filtro y borraría tablas enteras.
      if (companyId) {
        await prisma.bankMovement.deleteMany({ where: { companyId } });
        // Cascadea los InvestmentMovement de compras y ventas.
        await prisma.fundMovement.deleteMany({ where: { companyId } });
        await prisma.investmentMovement.deleteMany({ where: { companyId } });
        await prisma.investmentHolding.deleteMany({ where: { companyId } });
        await prisma.bankAccount.deleteMany({ where: { companyId } });
        await cleanupAccountingCompany(companyId);
        await prisma.accountingSettings.deleteMany({ where: { companyId } });
        await prisma.account.deleteMany({ where: { companyId } });
        await prisma.company.deleteMany({ where: { id: companyId } });
      }
      expect(await prisma.company.count({ where: { name: { startsWith: PREFIX } } })).toBe(0);
    });

    it('(a) editar el importe de una compra sin ventas posteriores: aplica y la propuesta muestra la tenencia', async () => {
      const holdingId = await mkHolding('H1');
      const mfId = await confirmed(compra(holdingId, '2026-03-10'));
      const bankBefore = await bankBalance();

      const proposal = await previewAndApply({
        mode: 'EDIT',
        ref: ref(mfId),
        data: compra(holdingId, '2026-03-10', { amount: '1200', unitPrice: '12' }),
      });

      expect(await position(holdingId)).toEqual({ bookValue: 1200, nominals: 100 });
      expect(await bankBalance()).toBe(bankBefore - 200);
      const card = proposal.cards.find((c) => c.key === `INVESTMENT_HOLDING:${holdingId}`);
      expect(card?.title).toBe(`Tenencia ${PREFIX}H1`);
      expect(card?.rows).toEqual([
        { label: 'Valor en libros', before: formatCurrency(1000), after: formatCurrency(1200) },
      ]);
    });

    it('(b) anular la venta total: la tenencia vuelve a estar abierta con posición {600, 60}', async () => {
      const holdingId = await mkHolding('H2');
      await confirmed(compra(holdingId, '2026-03-10'));
      await confirmed(venta(holdingId, '2026-04-10', { nominals: '40' }));
      const fullSaleId = await confirmed(
        venta(holdingId, '2026-05-10', { nominals: '60', isFullSale: true })
      );
      expect(await holdingStatus(holdingId)).toBe('CLOSED');

      const proposal = await previewAndApply({ mode: 'CANCEL', ref: ref(fullSaleId) });

      expect(await holdingStatus(holdingId)).toBe('OPEN');
      expect(await position(holdingId)).toEqual({ bookValue: 600, nominals: 60 });
      const card = proposal.cards.find((c) => c.key === `INVESTMENT_HOLDING:${holdingId}`);
      expect(card?.rows).toEqual([
        { label: 'Valor en libros', before: formatCurrency(0), after: formatCurrency(600) },
        { label: 'Nominales', before: '0', after: '60' },
        { label: 'Estado', before: 'Cerrada', after: 'Abierta' },
      ]);
    });

    it('eliminar la venta total: la tarjeta de la tenencia sigue en la propuesta', async () => {
      const holdingId = await mkHolding('H3');
      await confirmed(compra(holdingId, '2026-03-10'));
      const fullSaleId = await confirmed(venta(holdingId, '2026-05-10', { isFullSale: true }));

      const proposal = await previewAndApply({ mode: 'DELETE', ref: ref(fullSaleId) });

      expect(await prisma.fundMovement.count({ where: { id: fullSaleId } })).toBe(0);
      expect(await holdingStatus(holdingId)).toBe('OPEN');
      expect(await position(holdingId)).toEqual({ bookValue: 1000, nominals: 100 });
      const card = proposal.cards.find((c) => c.key === `INVESTMENT_HOLDING:${holdingId}`);
      expect(card?.action).toBe('MODIFY');
      expect(card?.rows.map((r) => r.label)).toEqual(['Valor en libros', 'Nominales', 'Estado']);
    });

    it('(c) editar la compra de una tenencia con venta posterior: INVESTMENT_LATER_SALE, sin aplicar', async () => {
      const holdingId = await mkHolding('H4');
      const purchaseId = await confirmed(compra(holdingId, '2026-03-10'));
      await confirmed(venta(holdingId, '2026-04-10', { nominals: '40' }));
      const bankBefore = await bankBalance();

      const found = await expectBlocked({
        mode: 'EDIT',
        ref: ref(purchaseId),
        data: compra(holdingId, '2026-03-10', { amount: '1200', unitPrice: '12' }),
      });

      expect(found).toEqual([
        {
          code: 'INVESTMENT_LATER_SALE',
          severity: 'MANUAL',
          message: `La tenencia «${PREFIX}H4» tiene una venta posterior («${PREFIX}Venta» del 10/04/2026).`,
          action: 'Anulá primero esa venta, corregí este movimiento y volvé a cargarla.',
        },
      ]);
      expect(await position(holdingId)).toEqual({ bookValue: 600, nominals: 60 });
      expect(await bankBalance()).toBe(bankBefore);
    });

    it('venta del mismo día cargada después: también es posterior (desempate por creación)', async () => {
      const holdingId = await mkHolding('H5');
      await confirmed(compra(holdingId, '2026-03-10'));
      const firstSaleId = await confirmed(venta(holdingId, '2026-04-10', { nominals: '20' }));
      await confirmed(
        venta(holdingId, '2026-04-10', { nominals: '20', description: `${PREFIX}Venta 2` })
      );

      const found = await expectBlocked({ mode: 'CANCEL', ref: ref(firstSaleId) });

      expect(found.map((i) => [i.code, i.message])).toEqual([
        [
          'INVESTMENT_LATER_SALE',
          `La tenencia «${PREFIX}H5» tiene una venta posterior («${PREFIX}Venta 2» del 10/04/2026).`,
        ],
      ]);
    });

    it('anular una compra con comisión: el banco recupera bruto + comisión y la tenencia queda vacía', async () => {
      const holdingId = await mkHolding('H9');
      const bankBefore = await bankBalance();
      const purchaseId = await confirmed(compra(holdingId, '2026-03-10', { commission: '5' }));
      expect(await bankBalance()).toBe(bankBefore - 1005);

      await previewAndApply({ mode: 'CANCEL', ref: ref(purchaseId) });

      expect(await bankBalance()).toBe(bankBefore);
      expect(await prisma.investmentMovement.count({ where: { fundMovementId: purchaseId } })).toBe(
        0
      );
      expect(await position(holdingId)).toEqual({ bookValue: 0, nominals: null });
      expect(
        (await prisma.fundMovement.findUniqueOrThrow({ where: { id: purchaseId } })).status
      ).toBe('CANCELLED');
    });

    it('ruling R8: editar una venta parcial quitándole los nominales: no se aplica', async () => {
      const holdingId = await mkHolding('H10');
      await confirmed(compra(holdingId, '2026-03-10'));
      const saleId = await confirmed(venta(holdingId, '2026-04-10', { nominals: '40' }));
      const bankBefore = await bankBalance();
      const request: CorrectionRequest = {
        mode: 'EDIT',
        ref: ref(saleId),
        data: venta(holdingId, '2026-04-10', { nominals: '' }),
      };

      const proposal = await preview(request);

      expect(proposal.impediments).toEqual([
        { code: 'SIMULATION_ERROR', severity: 'BLOCKED', message: 'Indicá los nominales vendidos' },
      ]);
      expect(await applyDocumentCorrection(request, proposal.fingerprint)).toMatchObject({
        success: true,
        applied: false,
      });
      expect(await position(holdingId)).toEqual({ bookValue: 600, nominals: 60 });
      expect(await bankBalance()).toBe(bankBefore);
    });

    it('(d) anular una compra con una valuación posterior: INVESTMENT_VALUED', async () => {
      const holdingId = await mkHolding('H6');
      const purchaseId = await confirmed(compra(holdingId, '2026-03-10'));
      await prisma.investmentMovement.create({
        data: {
          companyId,
          holdingId,
          kind: 'VALUATION',
          date: new Date('2026-06-30'),
          bookDelta: 0,
        },
      });

      const found = await expectBlocked({ mode: 'CANCEL', ref: ref(purchaseId) });

      expect(found).toEqual([
        {
          code: 'INVESTMENT_VALUED',
          severity: 'MANUAL',
          message: `La tenencia «${PREFIX}H6» ya tiene valuación al cierre del 30/06/2026.`,
          action: 'Deshacé esa valuación desde Tesorería › Inversiones › Valuación y reintentá.',
          href: VALUATION_HREF,
        },
      ]);
      expect(await position(holdingId)).toEqual({ bookValue: 1000, nominals: 100 });
      expect(
        (await prisma.fundMovement.findUniqueOrThrow({ where: { id: purchaseId } })).status
      ).toBe('CONFIRMED');
    });

    it('R6: compra con fecha anterior a una venta confirmada: se rechaza y el banco no cambia', async () => {
      const holdingId = await mkHolding('H7');
      await confirmed(compra(holdingId, '2026-03-10'));
      await confirmed(venta(holdingId, '2026-04-10', { nominals: '40' }));
      const bankBefore = await bankBalance();

      const result = await createFundMovement(compra(holdingId, '2026-04-01'), true);

      expect(result).toEqual({
        success: false,
        error: `La tenencia «${PREFIX}H7» tiene una venta posterior (10/04/2026). Anulá primero esa venta, cargá este movimiento y volvé a cargarla.`,
      });
      expect(await bankBalance()).toBe(bankBefore);
      expect(await position(holdingId)).toEqual({ bookValue: 600, nominals: 60 });
    });

    it('R6: editar una compra pasándola a otra tenencia con venta posterior: no se aplica', async () => {
      const holdingA = await mkHolding('H8A');
      const holdingB = await mkHolding('H8B');
      const purchaseId = await confirmed(compra(holdingA, '2026-03-10'));
      await confirmed(compra(holdingB, '2026-02-10'));
      await confirmed(venta(holdingB, '2026-04-10', { nominals: '40' }));
      const bankBefore = await bankBalance();
      const request: CorrectionRequest = {
        mode: 'EDIT',
        ref: ref(purchaseId),
        data: compra(holdingB, '2026-03-10'),
      };

      const proposal = await preview(request);

      expect(proposal.impediments).toEqual([
        {
          code: 'SIMULATION_ERROR',
          severity: 'BLOCKED',
          message: `La tenencia «${PREFIX}H8B» tiene una venta posterior (10/04/2026). Anulá primero esa venta, cargá este movimiento y volvé a cargarla.`,
        },
      ]);
      expect(await applyDocumentCorrection(request, proposal.fingerprint)).toMatchObject({
        success: true,
        applied: false,
      });
      expect(await position(holdingA)).toEqual({ bookValue: 1000, nominals: 100 });
      expect(await position(holdingB)).toEqual({ bookValue: 600, nominals: 60 });
      expect(await bankBalance()).toBe(bankBefore);
      const movement = await prisma.fundMovement.findUniqueOrThrow({
        where: { id: purchaseId },
        select: { holdingId: true },
      });
      expect(movement.holdingId).toBe(holdingA);
    });
  }
);
