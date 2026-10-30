/**
 * Letra del comprobante de compra según la condición IVA del proveedor (TSK-787), contra la base
 * real. El formulario ya ofrece solo las letras válidas; esto prueba la defensa del servidor en el
 * alta (`createPurchaseInvoice`) y en la escritura de datos que comparten la edición del borrador y
 * la corrección en cadena (`writePurchaseInvoiceDataTx`, vía `updatePurchaseInvoice`).
 */
import 'dotenv/config';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { prisma } from '@/shared/lib/prisma';

vi.mock('@/shared/lib/current-user', () => ({ getCurrentUserId: vi.fn() }));
vi.mock('@/shared/lib/company', () => ({ getActiveCompanyId: vi.fn() }));
vi.mock('@/shared/lib/permissions', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/shared/lib/permissions')>()),
  checkPermission: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { getActiveCompanyId } from '@/shared/lib/company';
import { getCurrentUserId } from '@/shared/lib/current-user';
import { BusinessError } from '@/shared/lib/action-result';

import { createPurchaseInvoice, updatePurchaseInvoice } from './actions.server';

const PREFIX = 'TSK787-LETRA-';

let dbAvailable = false;
try {
  await prisma.$queryRaw`SELECT 1`;
  dbAvailable = true;
} catch {
  dbAvailable = false;
}

describe.skipIf(!dbAvailable)('comprobante de compra según la condición IVA del proveedor (TSK-787)', () => {
  let companyId: string;
  let exentoId: string;
  let inscriptoId: string;
  let nextNumber = 1;

  const input = (supplierId: string, voucherType: string) => ({
    supplierId,
    voucherType,
    pointOfSale: '0009',
    number: String(nextNumber++).padStart(8, '0'),
    issueDate: new Date('2026-10-19'),
    lines: [{ description: 'Registro de dominio', quantity: '1', unitCost: '8500', vatRate: '0' }],
  });

  const invoicesOf = (supplierId: string) => prisma.purchaseInvoice.count({ where: { companyId, supplierId } });

  beforeAll(async () => {
    ({ id: companyId } = await prisma.company.create({
      data: { name: `${PREFIX}Empresa`, isActive: true },
      select: { id: true },
    }));
    const supplier = (code: string, taxCondition: 'EXENTO' | 'RESPONSABLE_INSCRIPTO', taxId: string) =>
      prisma.supplier.create({
        data: { companyId, code, businessName: `${PREFIX}${code}`, taxId, taxCondition, createdBy: 'test' },
        select: { id: true },
      });
    exentoId = (await supplier('EXENTO', 'EXENTO', '33715179119')).id;
    inscriptoId = (await supplier('RI', 'RESPONSABLE_INSCRIPTO', '30718578481')).id;
    vi.mocked(getActiveCompanyId).mockResolvedValue(companyId);
    vi.mocked(getCurrentUserId).mockResolvedValue('test-user');
  });

  afterAll(async () => {
    if (!companyId) return;
    await prisma.purchaseInvoice.deleteMany({ where: { companyId } });
    await prisma.supplier.deleteMany({ where: { companyId } });
    await prisma.company.deleteMany({ where: { id: companyId } });
    expect(await prisma.company.count({ where: { name: { startsWith: PREFIX } } })).toBe(0);
  });

  it('proveedor Exento con Factura A: se rechaza y no se crea nada', async () => {
    const error = await createPurchaseInvoice(input(exentoId, 'FACTURA_A')).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(BusinessError);
    expect((error as Error).message).toBe(
      'Un proveedor Exento emite comprobantes C: elegí Factura C, Nota de Crédito C o Nota de Débito C.'
    );
    expect(await invoicesOf(exentoId)).toBe(0);
  });

  it('proveedor Exento con Factura C: se crea', async () => {
    const result = await createPurchaseInvoice(input(exentoId, 'FACTURA_C'));
    expect(result.success).toBe(true);
  });

  it('proveedor Responsable Inscripto con Factura C: se rechaza', async () => {
    await expect(createPurchaseInvoice(input(inscriptoId, 'FACTURA_C'))).rejects.toThrow(
      'Un proveedor Responsable Inscripto emite comprobantes A o B, no C.'
    );
  });

  it('editar el borrador a una letra que no corresponde: se rechaza y queda como estaba', async () => {
    const { id } = await createPurchaseInvoice(input(exentoId, 'FACTURA_C'));

    await expect(updatePurchaseInvoice(id, { ...input(exentoId, 'FACTURA_B') })).rejects.toThrow(
      'Un proveedor Exento emite comprobantes C'
    );

    const invoice = await prisma.purchaseInvoice.findUniqueOrThrow({ where: { id }, select: { voucherType: true } });
    expect(invoice.voucherType).toBe('FACTURA_C');
  });
});

describe.skipIf(!dbAvailable)('importación desde AFIP: letra que no corresponde al proveedor (TSK-787)', () => {
  const PREFIX_IMPORT = 'TSK787-AFIP-';
  let companyId: string;

  /** Excel con el formato de "Mis Comprobantes Recibidos": título, encabezados y una fila por comprobante. */
  async function afipFile(rows: { tipo: string; numero: number; cuit: string; nombre: string }[]) {
    const ExcelJS = (await import('exceljs')).default;
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Recibidos');
    sheet.addRow(['Mis Comprobantes Recibidos']);
    sheet.addRow(['Fecha', 'Tipo', 'Punto de Venta', 'Número Desde']);
    for (const row of rows) {
      const cells: (string | number)[] = new Array(30).fill('');
      cells[0] = '19/10/2026';
      cells[1] = row.tipo;
      cells[2] = 9;
      cells[3] = row.numero;
      cells[5] = '86428472326513';
      cells[7] = row.cuit;
      cells[8] = row.nombre;
      cells[26] = 8500; // operaciones exentas
      cells[29] = 8500; // total
      sheet.addRow(cells);
    }
    return Array.from(new Uint8Array(await workbook.xlsx.writeBuffer()));
  }

  beforeAll(async () => {
    ({ id: companyId } = await prisma.company.create({
      data: { name: `${PREFIX_IMPORT}Empresa`, isActive: true },
      select: { id: true },
    }));
    // Cargado como inscripto, pero en AFIP emite C: la ficha está mal.
    await prisma.supplier.create({
      data: {
        companyId,
        code: 'SUP-001',
        businessName: `${PREFIX_IMPORT}NIC`,
        taxId: '33715179119',
        taxCondition: 'RESPONSABLE_INSCRIPTO',
        createdBy: 'test',
      },
    });
    vi.mocked(getActiveCompanyId).mockResolvedValue(companyId);
    vi.mocked(getCurrentUserId).mockResolvedValue('test-user');
  });

  afterAll(async () => {
    if (!companyId) return;
    await prisma.purchaseInvoice.deleteMany({ where: { companyId } });
    await prisma.supplier.deleteMany({ where: { companyId } });
    await prisma.company.deleteMany({ where: { id: companyId } });
  });

  it('el comprobante de AFIP se importa igual y avisa que se revise la condición del proveedor', async () => {
    const { importPurchaseInvoicesFromAFIP } = await import('./lib/afip-import.server');
    const result = await importPurchaseInvoicesFromAFIP(
      await afipFile([
        { tipo: '11 - Factura C', numero: 6150467, cuit: '33-71517911-9', nombre: 'NIC Argentina' },
        { tipo: '11 - Factura C', numero: 1, cuit: '20-11111111-2', nombre: `${PREFIX_IMPORT}Nuevo` },
      ])
    );

    expect(result.errors).toEqual([]);
    expect(result.imported).toBe(2);
    expect(result.suppliersCreated).toBe(1); // el nuevo toma la condición de la letra: sin aviso
    expect(result.warnings).toEqual([
      {
        row: 3,
        warning:
          'NIC Argentina (0009-06150467): Un proveedor Responsable Inscripto emite comprobantes A o B, no C. ' +
          'Revisá su condición IVA en la ficha del proveedor.',
      },
    ]);
  });
});
