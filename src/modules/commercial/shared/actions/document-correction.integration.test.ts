/**
 * Tests de integración de los server actions de corrección (TSK-792, Tarea 13):
 * permisos, validación del pedido, aplicación y respuesta con huella vieja.
 */
import 'dotenv/config';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { prisma } from '@/shared/lib/prisma';

import type { PurchaseInvoiceFormInput } from '@/modules/commercial/features/purchases/features/invoices/shared/validators';

vi.mock('server-only', () => ({}));
vi.mock('@/shared/lib/current-user', () => ({ getCurrentUserId: vi.fn() }));
vi.mock('@/shared/lib/company', () => ({ getActiveCompanyId: vi.fn() }));
vi.mock('@/shared/lib/permissions', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/shared/lib/permissions')>()),
  checkPermission: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { cleanupAccountingCompany } from '@/modules/accounting/shared/test-utils/cleanup-accounting-company';
import {
  confirmPurchaseInvoice,
  createPurchaseInvoice,
} from '@/modules/commercial/features/purchases/features/invoices/list/actions.server';
import { getActiveCompanyId } from '@/shared/lib/company';
import { getCurrentUserId } from '@/shared/lib/current-user';
import { checkPermission } from '@/shared/lib/permissions';

import type { CorrectionRequest } from '../correction/types';
import { applyDocumentCorrection, previewDocumentCorrection } from './document-correction.server';

const PREFIX = 'TSK792-ACT-';
const DATE = new Date('2026-03-10');

let dbAvailable = false;
try {
  await prisma.$queryRaw`SELECT 1`;
  dbAvailable = true;
} catch {
  dbAvailable = false;
}

describe.skipIf(!dbAvailable)('integración: actions de corrección (TSK-792)', () => {
  let companyId: string;
  let supplierId: string;
  let seq = 1;

  const input = (total: number): PurchaseInvoiceFormInput => ({
    supplierId,
    voucherType: 'FACTURA_A',
    pointOfSale: '0001',
    number: String(seq++).padStart(8, '0'),
    issueDate: DATE,
    lines: [
      { description: `${PREFIX}servicio`, quantity: '1', unitCost: total.toFixed(2), vatRate: '0' },
    ],
    internalTaxes: '',
  });

  async function confirmedFC(total: number) {
    const data = input(total);
    const { id } = await createPurchaseInvoice(data);
    const result = await confirmPurchaseInvoice(id);
    if (!result.success) throw new Error(`No se pudo confirmar la FC: ${result.error}`);
    return { id, data };
  }

  const editTo = (
    id: string,
    data: PurchaseInvoiceFormInput,
    total: number
  ): CorrectionRequest => ({
    mode: 'EDIT',
    ref: { kind: 'PURCHASE_INVOICE', id },
    data: { ...data, lines: data.lines.map((l) => ({ ...l, unitCost: total.toFixed(2) })) },
  });

  const totalOf = async (id: string) =>
    Number(
      (await prisma.purchaseInvoice.findUniqueOrThrow({ where: { id }, select: { total: true } }))
        .total
    );

  beforeAll(async () => {
    companyId = (
      await prisma.company.create({ data: { name: `${PREFIX}Empresa`, isActive: true } })
    ).id;
    const mk = (
      code: string,
      type: 'ASSET' | 'LIABILITY' | 'EXPENSE',
      nature: 'DEBIT' | 'CREDIT'
    ) =>
      prisma.account.create({
        data: { companyId, code: `T792A-${code}`, name: `${PREFIX}${code}`, type, nature },
        select: { id: true },
      });
    const [compras, pagar, ivaCf] = await Promise.all([
      mk('COMPRAS', 'EXPENSE', 'DEBIT'),
      mk('PAGAR', 'LIABILITY', 'CREDIT'),
      mk('IVACF', 'ASSET', 'DEBIT'),
    ]);
    await prisma.accountingSettings.create({
      data: {
        companyId,
        fiscalYearStart: new Date('2026-01-01'),
        fiscalYearEnd: new Date('2026-12-31'),
        purchasesAccountId: compras.id,
        payablesAccountId: pagar.id,
        vatCreditAccountId: ivaCf.id,
        requireCostCenter: false,
      },
    });
    supplierId = (
      await prisma.supplier.create({
        data: {
          companyId,
          code: `${PREFIX}A`,
          businessName: `${PREFIX}Proveedor`,
          taxId: '30500000004',
          taxCondition: 'RESPONSABLE_INSCRIPTO',
          createdBy: 'test',
        },
        select: { id: true },
      })
    ).id;
    vi.mocked(getActiveCompanyId).mockResolvedValue(companyId);
    vi.mocked(getCurrentUserId).mockResolvedValue('test-user');
  });

  afterAll(async () => {
    if (companyId) {
      await prisma.purchaseInvoice.deleteMany({ where: { companyId } });
      await cleanupAccountingCompany(companyId);
      await prisma.supplier.deleteMany({ where: { companyId } });
      await prisma.accountingSettings.deleteMany({ where: { companyId } });
      await prisma.account.deleteMany({ where: { companyId } });
      await prisma.company.deleteMany({ where: { id: companyId } });
    }
    expect(await prisma.company.count({ where: { name: { startsWith: PREFIX } } })).toBe(0);
    await prisma.$disconnect();
  });

  it('preview sin permiso update rechaza', async () => {
    const fc = await confirmedFC(1000);
    vi.mocked(checkPermission).mockClear();
    vi.mocked(checkPermission).mockRejectedValueOnce(new Error('NEXT_REDIRECT'));
    const result = await previewDocumentCorrection(editTo(fc.id, fc.data, 800));
    expect(result.success).toBe(false);
    expect(checkPermission).toHaveBeenCalledWith('commercial.purchases', 'update', {
      redirect: true,
    });
    expect(await totalOf(fc.id)).toBe(1000);
  });

  it('un pedido con id que no es uuid devuelve error de negocio', async () => {
    const result = await previewDocumentCorrection({
      mode: 'DELETE',
      ref: { kind: 'PURCHASE_INVOICE', id: 'no-es-uuid' },
    });
    expect(result).toEqual({ success: false, error: 'La solicitud de corrección no es válida.' });
  });

  it('apply devuelve applied:true y deja los cambios', async () => {
    const fc = await confirmedFC(1000);
    const request = editTo(fc.id, fc.data, 800);
    const preview = await previewDocumentCorrection(request);
    if (!preview.success) throw new Error(preview.error);
    const result = await applyDocumentCorrection(request, preview.proposal.fingerprint);
    expect(result).toEqual({ success: true, applied: true });
    expect(await totalOf(fc.id)).toBe(800);
  });

  it('apply stale devuelve propuesta nueva', async () => {
    const fc = await confirmedFC(1000);
    const request = editTo(fc.id, fc.data, 700);
    const result = await applyDocumentCorrection(request, 'huella-vieja');
    expect(result).toMatchObject({ success: true, applied: false, reason: 'STALE' });
    if (!result.success || result.applied) return;
    expect(result.proposal?.fingerprint).not.toBe('');
    expect(await totalOf(fc.id)).toBe(1000);
  });
});
