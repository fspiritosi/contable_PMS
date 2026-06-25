'use server';

import { getCurrentUserId } from '@/shared/lib/current-user';
import { getActiveCompanyId } from '@/shared/lib/company';
import { prisma } from '@/shared/lib/prisma';
import { logger } from '@/shared/lib/logger';
import { checkPermission } from '@/shared/lib/permissions';
import { revalidatePath } from 'next/cache';
import ExcelJS from 'exceljs';
import moment from 'moment';
import type { VoucherType, SupplierTaxCondition, InvoiceLineType } from '@/generated/prisma/enums';

// Mapeo de códigos AFIP a VoucherType del sistema
const AFIP_VOUCHER_MAP: Record<number, VoucherType> = {
  1: 'FACTURA_A',
  2: 'NOTA_DEBITO_A',
  3: 'NOTA_CREDITO_A',
  6: 'FACTURA_B',
  7: 'NOTA_DEBITO_B',
  8: 'NOTA_CREDITO_B',
  11: 'FACTURA_C',
  12: 'NOTA_DEBITO_C',
  13: 'NOTA_CREDITO_C',
};

// Mapeo de condición fiscal según tipo de comprobante recibido
function inferTaxCondition(voucherType: VoucherType): SupplierTaxCondition {
  if (voucherType.endsWith('_A')) return 'RESPONSABLE_INSCRIPTO';
  if (voucherType.endsWith('_C')) return 'MONOTRIBUTISTA';
  return 'RESPONSABLE_INSCRIPTO';
}

function parseCellValue(cellValue: ExcelJS.CellValue): string {
  if (!cellValue) return '';
  if (typeof cellValue === 'object' && 'result' in cellValue) {
    return String(cellValue.result ?? '').trim();
  }
  return String(cellValue).trim();
}

function parseDateValue(cellValue: ExcelJS.CellValue): Date | null {
  if (!cellValue) return null;
  if (cellValue instanceof Date) return cellValue;
  const str = String(cellValue).trim();
  const parsed = moment(str, ['DD/MM/YYYY', 'YYYY-MM-DD'], true);
  return parsed.isValid() ? parsed.toDate() : null;
}

function parseNumber(cellValue: ExcelJS.CellValue): number {
  if (!cellValue) return 0;
  if (typeof cellValue === 'number') return cellValue;
  const str = String(cellValue).replace(',', '.').trim();
  const num = parseFloat(str);
  return isNaN(num) ? 0 : num;
}

function parseVoucherType(tipoStr: string): VoucherType | null {
  // Formato AFIP: "1 - Factura A", "3 - Nota de Crédito A", etc.
  const match = tipoStr.match(/^(\d+)\s*-/);
  if (!match) return null;
  const code = parseInt(match[1]);
  return AFIP_VOUCHER_MAP[code] || null;
}

function normalizeCuit(cuit: string): string {
  return cuit.replace(/[-\s]/g, '');
}

export interface AFIPImportResult {
  success: boolean;
  imported: number;
  skipped: number;
  suppliersCreated: number;
  errors: Array<{ row: number; error: string }>;
  message: string;
}

/**
 * Importa comprobantes recibidos desde un archivo Excel de AFIP (Mis Comprobantes Recibidos)
 */
export async function importPurchaseInvoicesFromAFIP(
  fileBuffer: number[]
): Promise<AFIPImportResult> {
  await checkPermission('commercial.purchases', 'create', { redirect: true });
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('No autenticado');

  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    const buffer = Buffer.from(fileBuffer);
    const workbook = new ExcelJS.Workbook();
    // @ts-ignore - ExcelJS type issue with Buffer
    await workbook.xlsx.load(buffer);

    const worksheet = workbook.worksheets[0];
    if (!worksheet) {
      return {
        success: false,
        imported: 0,
        skipped: 0,
        suppliersCreated: 0,
        errors: [{ row: 0, error: 'El archivo no contiene hojas de cálculo' }],
        message: 'Archivo inválido',
      };
    }

    // Verificar que sea un archivo AFIP (fila 2 = headers)
    const headerRow = worksheet.getRow(2);
    const firstHeader = parseCellValue(headerRow.getCell(1).value);
    if (firstHeader !== 'Fecha') {
      return {
        success: false,
        imported: 0,
        skipped: 0,
        suppliersCreated: 0,
        errors: [{ row: 0, error: 'El archivo no parece ser un export de "Mis Comprobantes Recibidos" de AFIP. Se espera "Fecha" en la primera columna de la fila 2.' }],
        message: 'Formato de archivo no reconocido',
      };
    }

    // Cachear proveedores existentes por CUIT
    const existingSuppliers = await prisma.supplier.findMany({
      where: { companyId },
      select: { id: true, taxId: true },
    });
    const supplierByCuit = new Map(existingSuppliers.map((s) => [s.taxId, s.id]));

    // Obtener último código de proveedor para auto-incrementar
    const lastSupplier = await prisma.supplier.findFirst({
      where: { companyId },
      orderBy: { code: 'desc' },
      select: { code: true },
    });
    let nextSupplierNumber = 1;
    if (lastSupplier && lastSupplier.code.startsWith('SUP-')) {
      const lastNum = parseInt(lastSupplier.code.split('-')[1]);
      if (!isNaN(lastNum)) nextSupplierNumber = lastNum + 1;
    }

    // Cachear facturas existentes para detectar duplicados
    const existingInvoices = await prisma.purchaseInvoice.findMany({
      where: { companyId },
      select: { supplierId: true, fullNumber: true },
    });
    const existingInvoiceKeys = new Set(
      existingInvoices.map((inv) => `${inv.supplierId}|${inv.fullNumber}`)
    );

    const errors: Array<{ row: number; error: string }> = [];
    let imported = 0;
    let skipped = 0;
    let suppliersCreated = 0;

    // Procesar filas (empezando desde fila 3, fila 1=título, fila 2=headers)
    const rows: Array<{
      rowNumber: number;
      date: Date;
      voucherType: VoucherType;
      pointOfSale: string;
      number: string;
      cae: string;
      cuit: string;
      businessName: string;
      netoGravIva0: number;
      iva25: number;
      netoGravIva25: number;
      iva5: number;
      netoGravIva5: number;
      iva105: number;
      netoGravIva105: number;
      iva21: number;
      netoGravIva21: number;
      iva27: number;
      netoGravIva27: number;
      netoGravadoTotal: number;
      netoNoGravado: number;
      opExentas: number;
      otrosTributos: number;
      totalIva: number;
      impTotal: number;
    }> = [];

    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber <= 2) return; // Saltar título y headers

      const tipoStr = parseCellValue(row.getCell(2).value);
      if (!tipoStr) return; // Fila vacía

      const date = parseDateValue(row.getCell(1).value);
      if (!date) {
        errors.push({ row: rowNumber, error: 'Fecha inválida' });
        return;
      }

      const voucherType = parseVoucherType(tipoStr);
      if (!voucherType) {
        errors.push({ row: rowNumber, error: `Tipo de comprobante no reconocido: "${tipoStr}"` });
        return;
      }

      const pointOfSaleRaw = parseCellValue(row.getCell(3).value);
      const numberRaw = parseCellValue(row.getCell(4).value);
      const cae = parseCellValue(row.getCell(6).value);
      const cuit = normalizeCuit(parseCellValue(row.getCell(8).value));
      const businessName = parseCellValue(row.getCell(9).value);

      if (!cuit || cuit.length < 10) {
        errors.push({ row: rowNumber, error: `CUIT inválido: "${cuit}"` });
        return;
      }

      if (!businessName) {
        errors.push({ row: rowNumber, error: 'Denominación del emisor vacía' });
        return;
      }

      const pointOfSale = pointOfSaleRaw.padStart(4, '0');
      const number = numberRaw.padStart(8, '0');

      rows.push({
        rowNumber,
        date,
        voucherType,
        pointOfSale,
        number,
        cae,
        cuit,
        businessName,
        netoGravIva0: parseNumber(row.getCell(14).value),
        iva25: parseNumber(row.getCell(15).value),
        netoGravIva25: parseNumber(row.getCell(16).value),
        iva5: parseNumber(row.getCell(17).value),
        netoGravIva5: parseNumber(row.getCell(18).value),
        iva105: parseNumber(row.getCell(19).value),
        netoGravIva105: parseNumber(row.getCell(20).value),
        iva21: parseNumber(row.getCell(21).value),
        netoGravIva21: parseNumber(row.getCell(22).value),
        iva27: parseNumber(row.getCell(23).value),
        netoGravIva27: parseNumber(row.getCell(24).value),
        netoGravadoTotal: parseNumber(row.getCell(25).value),
        netoNoGravado: parseNumber(row.getCell(26).value),
        opExentas: parseNumber(row.getCell(27).value),
        otrosTributos: parseNumber(row.getCell(28).value),
        totalIva: parseNumber(row.getCell(29).value),
        impTotal: parseNumber(row.getCell(30).value),
      });
    });

    if (rows.length === 0 && errors.length === 0) {
      return {
        success: false,
        imported: 0,
        skipped: 0,
        suppliersCreated: 0,
        errors: [{ row: 0, error: 'No se encontraron comprobantes para importar' }],
        message: 'El archivo no contiene datos',
      };
    }

    // Procesar cada fila en transacción
    for (const rowData of rows) {
      try {
        // Buscar o crear proveedor
        let supplierId = supplierByCuit.get(rowData.cuit);

        if (!supplierId) {
          const code = `SUP-${nextSupplierNumber.toString().padStart(3, '0')}`;
          nextSupplierNumber++;

          const newSupplier = await prisma.supplier.create({
            data: {
              companyId,
              code,
              businessName: rowData.businessName,
              taxId: rowData.cuit,
              taxCondition: inferTaxCondition(rowData.voucherType),
              status: 'ACTIVE',
              createdBy: userId,
            },
          });

          supplierId = newSupplier.id;
          supplierByCuit.set(rowData.cuit, supplierId);
          suppliersCreated++;
        }

        // Verificar duplicado
        const fullNumber = `${rowData.pointOfSale}-${rowData.number}`;
        const invoiceKey = `${supplierId}|${fullNumber}`;
        if (existingInvoiceKeys.has(invoiceKey)) {
          skipped++;
          continue;
        }

        // Construir líneas basadas en las alícuotas de IVA presentes
        const lines: Array<{
          description: string;
          quantity: number;
          unitCost: number;
          lineType: InvoiceLineType;
          vatRate: number;
          vatAmount: number;
          subtotal: number;
          total: number;
        }> = [];

        const ivaRates = [
          { rate: 0, neto: rowData.netoGravIva0, iva: 0 },
          { rate: 2.5, neto: rowData.netoGravIva25, iva: rowData.iva25 },
          { rate: 5, neto: rowData.netoGravIva5, iva: rowData.iva5 },
          { rate: 10.5, neto: rowData.netoGravIva105, iva: rowData.iva105 },
          { rate: 21, neto: rowData.netoGravIva21, iva: rowData.iva21 },
          { rate: 27, neto: rowData.netoGravIva27, iva: rowData.iva27 },
        ];

        for (const { rate, neto, iva } of ivaRates) {
          if (neto > 0) {
            lines.push({
              description: `Compra según comprobante AFIP (IVA ${rate}%)`,
              quantity: 1,
              unitCost: neto,
              lineType: 'TAXED',
              vatRate: rate,
              vatAmount: iva,
              subtotal: neto,
              total: neto + iva,
            });
          }
        }

        // Neto no gravado
        if (rowData.netoNoGravado > 0) {
          lines.push({
            description: 'No gravado',
            quantity: 1,
            unitCost: rowData.netoNoGravado,
            lineType: 'NON_TAXED',
            vatRate: 0,
            vatAmount: 0,
            subtotal: rowData.netoNoGravado,
            total: rowData.netoNoGravado,
          });
        }

        // Operaciones exentas
        if (rowData.opExentas > 0) {
          lines.push({
            description: 'Operaciones exentas',
            quantity: 1,
            unitCost: rowData.opExentas,
            lineType: 'EXEMPT',
            vatRate: 0,
            vatAmount: 0,
            subtotal: rowData.opExentas,
            total: rowData.opExentas,
          });
        }

        // Si no hay líneas (caso borde), crear una genérica
        if (lines.length === 0) {
          lines.push({
            description: 'Compra según comprobante AFIP',
            quantity: 1,
            unitCost: rowData.impTotal,
            lineType: 'TAXED',
            vatRate: 0,
            vatAmount: 0,
            subtotal: rowData.impTotal,
            total: rowData.impTotal,
          });
        }

        const netTaxed = rowData.netoGravadoTotal;
        const netNonTaxed = rowData.netoNoGravado;
        const netExempt = rowData.opExentas;
        const subtotal = netTaxed + netNonTaxed + netExempt;
        const vatAmount = rowData.totalIva;
        const otherTaxes = rowData.otrosTributos;
        const total = rowData.impTotal;

        await prisma.purchaseInvoice.create({
          data: {
            companyId,
            supplierId,
            voucherType: rowData.voucherType,
            pointOfSale: rowData.pointOfSale,
            number: rowData.number,
            fullNumber,
            issueDate: rowData.date,
            cae: rowData.cae || null,
            validated: !!rowData.cae,
            subtotal,
            netTaxed,
            netNonTaxed,
            netExempt,
            vatAmount,
            otherTaxes,
            total,
            status: 'DRAFT',
            createdBy: userId,
            lines: {
              create: lines,
            },
          },
        });

        existingInvoiceKeys.add(invoiceKey);
        imported++;
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        errors.push({ row: rowData.rowNumber, error: msg });
      }
    }

    logger.info('Importación AFIP de comprobantes recibidos completada', {
      data: { companyId, userId, imported, skipped, suppliersCreated, errorsCount: errors.length },
    });

    revalidatePath('/dashboard/commercial/purchases');
    revalidatePath('/dashboard/commercial/suppliers');

    return {
      success: imported > 0,
      imported,
      skipped,
      suppliersCreated,
      errors,
      message: `Importación completada: ${imported} comprobantes importados, ${skipped} duplicados omitidos${suppliersCreated > 0 ? `, ${suppliersCreated} proveedores creados` : ''}`,
    };
  } catch (error) {
    logger.error('Error al importar comprobantes AFIP', { data: { error, companyId } });
    if (error instanceof Error) throw error;
    throw new Error('Error al importar comprobantes desde AFIP');
  }
}
