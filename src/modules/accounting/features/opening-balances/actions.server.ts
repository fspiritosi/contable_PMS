'use server';

import { getCurrentUserId } from '@/shared/lib/current-user';
import { prisma } from '@/shared/lib/prisma';
import { logger } from '@/shared/lib/logger';
import { getActiveCompanyId } from '@/shared/lib/company';
import { checkPermission } from '@/shared/lib/permissions';
import { buildImputableAccountsWhere } from '@/shared/lib/accounts/imputable-accounts';
import { revalidateAccountingRoutes } from '../../shared/utils';
import {
  AccountType,
  AccountNature,
  JournalEntryStatus,
  SalesInvoiceStatus,
  PurchaseInvoiceStatus,
} from '@/generated/prisma/enums';
import {
  type OpeningBalanceFormInput,
  type OpeningSalesInvoiceInput,
  type OpeningPurchaseInvoiceInput,
  openingBalanceFormSchema,
  openingSalesInvoiceSchema,
  openingPurchaseInvoiceSchema,
} from './validators';
import moment from 'moment';
import { revalidatePath } from 'next/cache';

const OPENING_ENTRY_DESCRIPTION = 'Asiento de Apertura';
const OPENING_BALANCE_MARKER = 'opening-balance';
const APERTURA_ACCOUNT_NAME = 'Apertura';

// ============================================
// QUERIES
// ============================================

/**
 * Obtiene todos los datos necesarios para la página de saldos de apertura
 */
export async function getOpeningBalancesPageData() {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('No autenticado');

  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No se encontró la empresa activa');
  await checkPermission('accounting.opening-balances', 'view', { redirect: true });

  try {
    const [accounts, settings, contractors, suppliers, pointsOfSale] =
      await Promise.all([
        // Cuentas imputables (hojas): los saldos de apertura se cargan solo
        // sobre cuentas imputables, no sobre cuentas de sumatoria.
        prisma.account.findMany({
          where: buildImputableAccountsWhere({ companyId }),
          select: {
            id: true,
            code: true,
            name: true,
            type: true,
            nature: true,
            parentId: true,
          },
          orderBy: { code: 'asc' },
        }),

        // Settings contables
        prisma.accountingSettings.findUnique({
          where: { companyId },
          select: {
            fiscalYearStart: true,
            fiscalYearEnd: true,
            lastEntryNumber: true,
            lockedUntilDate: true,
          },
        }),

        // Clientes para facturas de venta
        prisma.contractor.findMany({
          where: { companyId, isActive: true },
          select: { id: true, name: true, taxId: true },
          orderBy: { name: 'asc' },
        }),

        // Proveedores para facturas de compra
        prisma.supplier.findMany({
          where: { companyId, status: 'ACTIVE' },
          select: {
            id: true,
            businessName: true,
            tradeName: true,
            taxId: true,
          },
          orderBy: { businessName: 'asc' },
        }),

        // Puntos de venta para facturas de venta
        prisma.salesPointOfSale.findMany({
          where: { companyId, isActive: true },
          select: { id: true, number: true, name: true },
          orderBy: { number: 'asc' },
        }),
      ]);

    const hasChartOfAccounts = accounts.length > 0;
    const hasFiscalYear = settings !== null;

    // Detectar asiento de apertura existente
    let existingOpeningEntry = null;
    if (settings) {
      const entry = await prisma.journalEntry.findFirst({
        where: {
          companyId,
          description: OPENING_ENTRY_DESCRIPTION,
          date: settings.fiscalYearStart,
          status: JournalEntryStatus.POSTED,
        },
        select: {
          id: true,
          number: true,
          date: true,
          status: true,
          lines: {
            select: {
              id: true,
              accountId: true,
              description: true,
              debit: true,
              credit: true,
              account: {
                select: { code: true, name: true, type: true },
              },
            },
          },
        },
      });

      if (entry) {
        existingOpeningEntry = {
          ...entry,
          lines: entry.lines.map((line) => ({
            ...line,
            debit: Number(line.debit),
            credit: Number(line.credit),
          })),
        };
      }
    }

    // Detectar cuenta Apertura existente
    const aperturaAccount = await prisma.account.findFirst({
      where: {
        companyId,
        name: APERTURA_ACCOUNT_NAME,
        type: AccountType.EQUITY,
        isActive: true,
      },
      select: { id: true, code: true, name: true },
    });

    return {
      accounts,
      settings,
      existingOpeningEntry,
      aperturaAccount,
      hasChartOfAccounts,
      hasFiscalYear,
      contractors,
      suppliers,
      pointsOfSale,
    };
  } catch (error) {
    logger.error('Error al obtener datos de saldos de apertura', {
      data: { error, companyId },
    });
    throw error;
  }
}

/**
 * Obtiene facturas de apertura (venta y compra)
 */
export async function getOpeningBalanceInvoices() {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('No autenticado');

  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No se encontró la empresa activa');
  await checkPermission('accounting.opening-balances', 'view', { redirect: true });

  try {
    const [salesInvoices, purchaseInvoices] = await Promise.all([
      prisma.salesInvoice.findMany({
        where: {
          companyId,
          status: SalesInvoiceStatus.CONFIRMED,
          journalEntryId: null,
          internalNotes: OPENING_BALANCE_MARKER,
        },
        select: {
          id: true,
          fullNumber: true,
          voucherType: true,
          issueDate: true,
          dueDate: true,
          total: true,
          customer: { select: { name: true } },
        },
        orderBy: { issueDate: 'desc' },
      }),

      prisma.purchaseInvoice.findMany({
        where: {
          companyId,
          status: PurchaseInvoiceStatus.CONFIRMED,
          journalEntryId: null,
          notes: OPENING_BALANCE_MARKER,
        },
        select: {
          id: true,
          fullNumber: true,
          voucherType: true,
          issueDate: true,
          dueDate: true,
          total: true,
          supplier: { select: { businessName: true } },
        },
        orderBy: { issueDate: 'desc' },
      }),
    ]);

    return {
      salesInvoices: salesInvoices.map((inv) => ({
        ...inv,
        total: Number(inv.total),
      })),
      purchaseInvoices: purchaseInvoices.map((inv) => ({
        ...inv,
        total: Number(inv.total),
      })),
    };
  } catch (error) {
    logger.error('Error al obtener facturas de apertura', {
      data: { error, companyId },
    });
    throw error;
  }
}

// ============================================
// MUTATIONS - Part A: Asiento de Apertura
// ============================================

/**
 * Helper: obtiene o crea la cuenta "Apertura" (EQUITY)
 */
async function getOrCreateAperturaAccount(
  companyId: string,
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0]
) {
  // Buscar cuenta existente
  const existing = await tx.account.findFirst({
    where: {
      companyId,
      name: APERTURA_ACCOUNT_NAME,
      type: AccountType.EQUITY,
      isActive: true,
    },
    select: { id: true, code: true, name: true },
  });

  if (existing) return existing;

  // Generar código disponible bajo 3.x.x (EQUITY)
  const equityAccounts = await tx.account.findMany({
    where: { companyId, type: AccountType.EQUITY },
    select: { code: true },
    orderBy: { code: 'desc' },
  });

  // Intentar código 3.0.1, si existe buscar siguiente disponible
  let code = '3.0.1';
  const existingCodes = new Set(equityAccounts.map((a) => a.code));

  if (existingCodes.has(code)) {
    let suffix = 2;
    while (existingCodes.has(`3.0.${suffix}`)) {
      suffix++;
    }
    code = `3.0.${suffix}`;
  }

  const created = await tx.account.create({
    data: {
      companyId,
      code,
      name: APERTURA_ACCOUNT_NAME,
      type: AccountType.EQUITY,
      nature: AccountNature.CREDIT,
    },
    select: { id: true, code: true, name: true },
  });

  logger.info('Cuenta de Apertura creada automáticamente', {
    data: { companyId, code: created.code, id: created.id },
  });

  return created;
}

/**
 * Guarda el asiento de saldos de apertura
 */
export async function saveOpeningBalanceEntry(
  input: OpeningBalanceFormInput,
  replaceExisting: boolean
) {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('No autenticado');

  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No se encontró la empresa activa');
  await checkPermission('accounting.opening-balances', 'create', { redirect: true });

  // Validar input
  const parsed = openingBalanceFormSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(
      `Datos inválidos: ${parsed.error.issues.map((e) => e.message).join(', ')}`
    );
  }

  try {
    const settings = await prisma.accountingSettings.findUnique({
      where: { companyId },
    });

    if (!settings) {
      throw new Error('La empresa no tiene configuración contable');
    }

    // Filtrar líneas con monto 0
    const nonZeroBalances = parsed.data.balances.filter(
      (b) => b.debit > 0 || b.credit > 0
    );

    if (nonZeroBalances.length === 0) {
      throw new Error('Debe ingresar al menos un saldo');
    }

    // Validar que cada línea tenga solo Debe o solo Haber
    for (const balance of nonZeroBalances) {
      if (balance.debit > 0 && balance.credit > 0) {
        throw new Error(
          'Cada cuenta debe tener solo Debe o solo Haber, no ambos'
        );
      }
    }

    // Verificar que las cuentas existen y pertenecen a la empresa
    const accountIds = nonZeroBalances.map((b) => b.accountId);
    const accounts = await prisma.account.findMany({
      where: { id: { in: accountIds }, companyId, isActive: true },
      select: { id: true },
    });
    if (accounts.length !== accountIds.length) {
      throw new Error('Algunas cuentas no existen o no están activas');
    }

    // Calcular totales
    const totalDebit = nonZeroBalances.reduce((sum, b) => sum + b.debit, 0);
    const totalCredit = nonZeroBalances.reduce((sum, b) => sum + b.credit, 0);
    const difference = totalDebit - totalCredit;

    const result = await prisma.$transaction(async (tx) => {
      // Obtener o crear cuenta Apertura
      const aperturaAccount = await getOrCreateAperturaAccount(companyId, tx);

      // Construir líneas del asiento
      const lines = nonZeroBalances.map((b) => ({
        accountId: b.accountId,
        debit: b.debit,
        credit: b.credit,
      }));

      // Agregar línea de balanceo (cuenta Apertura)
      if (Math.abs(difference) > 0.001) {
        lines.push({
          accountId: aperturaAccount.id,
          debit: difference < 0 ? Math.abs(difference) : 0,
          credit: difference > 0 ? difference : 0,
        });
      }

      // Verificar balance final
      const finalDebit = lines.reduce((sum, l) => sum + l.debit, 0);
      const finalCredit = lines.reduce((sum, l) => sum + l.credit, 0);
      if (Math.abs(finalDebit - finalCredit) > 0.01) {
        throw new Error('Error interno: el asiento no está balanceado');
      }

      if (replaceExisting) {
        // Buscar asiento existente
        const existing = await tx.journalEntry.findFirst({
          where: {
            companyId,
            description: OPENING_ENTRY_DESCRIPTION,
            date: settings.fiscalYearStart,
            status: JournalEntryStatus.POSTED,
          },
          select: { id: true, number: true },
        });

        if (!existing) {
          throw new Error('No se encontró el asiento de apertura existente');
        }

        // Borrar líneas viejas y crear nuevas
        await tx.journalEntryLine.deleteMany({
          where: { entryId: existing.id },
        });

        await tx.journalEntry.update({
          where: { id: existing.id },
          data: {
            date: settings.fiscalYearStart,
            lines: {
              create: lines,
            },
          },
        });

        logger.info('Asiento de apertura actualizado', {
          data: { entryId: existing.id, entryNumber: existing.number, userId },
        });

        return { entryId: existing.id, entryNumber: existing.number };
      } else {
        // Verificar que no exista ya
        const existing = await tx.journalEntry.findFirst({
          where: {
            companyId,
            description: OPENING_ENTRY_DESCRIPTION,
            date: settings.fiscalYearStart,
            status: JournalEntryStatus.POSTED,
          },
          select: { id: true },
        });

        if (existing) {
          throw new Error(
            'Ya existe un asiento de apertura. Usá la opción de editar.'
          );
        }

        const newNumber = settings.lastEntryNumber + 1;

        const entry = await tx.journalEntry.create({
          data: {
            companyId,
            number: newNumber,
            date: settings.fiscalYearStart,
            description: OPENING_ENTRY_DESCRIPTION,
            status: JournalEntryStatus.POSTED,
            postDate: new Date(),
            createdBy: userId,
            lines: {
              create: lines,
            },
          },
          select: { id: true, number: true },
        });

        await tx.accountingSettings.update({
          where: { companyId },
          data: { lastEntryNumber: newNumber },
        });

        logger.info('Asiento de apertura creado', {
          data: { entryId: entry.id, entryNumber: entry.number, userId },
        });

        return { entryId: entry.id, entryNumber: entry.number };
      }
    });

    revalidateAccountingRoutes(companyId);

    return { success: true, ...result };
  } catch (error) {
    logger.error('Error al guardar asiento de apertura', {
      data: { error, companyId, userId },
    });
    throw error;
  }
}

// ============================================
// MUTATIONS - Part B: Facturas de Apertura
// ============================================

/**
 * Crea una factura de venta como saldo de apertura
 */
export async function createOpeningSalesInvoice(
  input: OpeningSalesInvoiceInput
) {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('No autenticado');

  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No se encontró la empresa activa');
  await checkPermission('accounting.opening-balances', 'create', { redirect: true });

  const parsed = openingSalesInvoiceSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(
      `Datos inválidos: ${parsed.error.issues.map((e) => e.message).join(', ')}`
    );
  }

  const data = parsed.data;

  try {
    // Obtener punto de venta para generar fullNumber
    const pointOfSale = await prisma.salesPointOfSale.findUnique({
      where: { id: data.pointOfSaleId },
      select: { number: true, companyId: true },
    });

    if (!pointOfSale || pointOfSale.companyId !== companyId) {
      throw new Error('Punto de venta no encontrado');
    }

    const numberPadded = data.number.padStart(8, '0');
    const posPadded = pointOfSale.number.toString().padStart(4, '0');
    const fullNumber = `${posPadded}-${numberPadded}`;

    // Verificar unicidad
    const existing = await prisma.salesInvoice.findFirst({
      where: {
        pointOfSaleId: data.pointOfSaleId,
        voucherType: data.voucherType,
        number: parseInt(data.number),
      },
    });

    if (existing) {
      throw new Error(
        `Ya existe una factura ${data.voucherType} N° ${fullNumber}`
      );
    }

    const invoice = await prisma.salesInvoice.create({
      data: {
        companyId,
        customerId: data.customerId,
        pointOfSaleId: data.pointOfSaleId,
        voucherType: data.voucherType,
        number: parseInt(data.number),
        fullNumber,
        issueDate: data.issueDate,
        dueDate: data.dueDate,
        subtotal: data.total,
        vatAmount: 0,
        otherTaxes: 0,
        total: data.total,
        status: SalesInvoiceStatus.CONFIRMED,
        journalEntryId: null,
        internalNotes: OPENING_BALANCE_MARKER,
        createdBy: userId,
        lines: {
          create: [
            {
              description: 'Saldo de apertura',
              quantity: 1,
              unitPrice: data.total,
              vatRate: 0,
              vatAmount: 0,
              subtotal: data.total,
              total: data.total,
            },
          ],
        },
      },
      select: { id: true, fullNumber: true },
    });

    logger.info('Factura de venta de apertura creada', {
      data: { invoiceId: invoice.id, fullNumber: invoice.fullNumber, userId },
    });

    revalidatePath('/dashboard/company/accounting/opening-balances');
    revalidatePath('/dashboard/commercial/invoices');

    return { success: true, id: invoice.id, fullNumber: invoice.fullNumber };
  } catch (error) {
    logger.error('Error al crear factura de venta de apertura', {
      data: { error, companyId, userId },
    });
    throw error;
  }
}

/**
 * Crea una factura de compra como saldo de apertura
 */
export async function createOpeningPurchaseInvoice(
  input: OpeningPurchaseInvoiceInput
) {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('No autenticado');

  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No se encontró la empresa activa');
  await checkPermission('accounting.opening-balances', 'create', { redirect: true });

  const parsed = openingPurchaseInvoiceSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(
      `Datos inválidos: ${parsed.error.issues.map((e) => e.message).join(', ')}`
    );
  }

  const data = parsed.data;

  try {
    const posPadded = data.pointOfSale.padStart(4, '0');
    const numberPadded = data.number.padStart(8, '0');
    const fullNumber = `${posPadded}-${numberPadded}`;

    // Verificar unicidad
    const existing = await prisma.purchaseInvoice.findFirst({
      where: {
        companyId,
        supplierId: data.supplierId,
        fullNumber,
      },
    });

    if (existing) {
      throw new Error(
        `Ya existe una factura de compra N° ${fullNumber} para este proveedor`
      );
    }

    // Verificar que el proveedor pertenece a la empresa
    const supplier = await prisma.supplier.findUnique({
      where: { id: data.supplierId },
      select: { companyId: true },
    });

    if (!supplier || supplier.companyId !== companyId) {
      throw new Error('Proveedor no encontrado');
    }

    const invoice = await prisma.purchaseInvoice.create({
      data: {
        companyId,
        supplierId: data.supplierId,
        voucherType: data.voucherType,
        pointOfSale: posPadded,
        number: numberPadded,
        fullNumber,
        issueDate: data.issueDate,
        dueDate: data.dueDate,
        subtotal: data.total,
        vatAmount: 0,
        otherTaxes: 0,
        total: data.total,
        status: PurchaseInvoiceStatus.CONFIRMED,
        journalEntryId: null,
        internalNotes: OPENING_BALANCE_MARKER,
        createdBy: userId,
        lines: {
          create: [
            {
              description: 'Saldo de apertura',
              quantity: 1,
              unitCost: data.total,
              vatRate: 0,
              vatAmount: 0,
              subtotal: data.total,
              total: data.total,
            },
          ],
        },
      },
      select: { id: true, fullNumber: true },
    });

    logger.info('Factura de compra de apertura creada', {
      data: { invoiceId: invoice.id, fullNumber: invoice.fullNumber, userId },
    });

    revalidatePath('/dashboard/company/accounting/opening-balances');
    revalidatePath('/dashboard/commercial/purchases');

    return { success: true, id: invoice.id, fullNumber: invoice.fullNumber };
  } catch (error) {
    logger.error('Error al crear factura de compra de apertura', {
      data: { error, companyId, userId },
    });
    throw error;
  }
}

/**
 * Elimina una factura de apertura (solo si es de apertura)
 */
export async function deleteOpeningInvoice(
  type: 'sales' | 'purchases',
  id: string
) {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('No autenticado');

  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No se encontró la empresa activa');
  await checkPermission('accounting.opening-balances', 'delete', { redirect: true });

  try {
    if (type === 'sales') {
      const invoice = await prisma.salesInvoice.findUnique({
        where: { id },
        select: { companyId: true, internalNotes: true, status: true },
      });

      if (!invoice || invoice.companyId !== companyId) {
        throw new Error('Factura no encontrada');
      }

      if (invoice.internalNotes !== OPENING_BALANCE_MARKER) {
        throw new Error('Solo se pueden eliminar facturas de apertura');
      }

      if (
        invoice.status !== SalesInvoiceStatus.CONFIRMED
      ) {
        throw new Error('La factura tiene cobros asociados y no se puede eliminar');
      }

      // Verificar que no tenga cobros
      const receiptItems = await prisma.receiptItem.findFirst({
        where: { salesInvoiceId: id },
      });

      if (receiptItems) {
        throw new Error('La factura tiene cobros asociados y no se puede eliminar');
      }

      await prisma.salesInvoice.delete({ where: { id } });
    } else {
      const invoice = await prisma.purchaseInvoice.findUnique({
        where: { id },
        select: { companyId: true, internalNotes: true, status: true },
      });

      if (!invoice || invoice.companyId !== companyId) {
        throw new Error('Factura no encontrada');
      }

      if (invoice.internalNotes !== OPENING_BALANCE_MARKER) {
        throw new Error('Solo se pueden eliminar facturas de apertura');
      }

      if (
        invoice.status !== PurchaseInvoiceStatus.CONFIRMED
      ) {
        throw new Error('La factura tiene pagos asociados y no se puede eliminar');
      }

      // Verificar que no tenga pagos
      const paymentItems = await prisma.paymentOrderItem.findFirst({
        where: { purchaseInvoiceId: id },
      });

      if (paymentItems) {
        throw new Error('La factura tiene pagos asociados y no se puede eliminar');
      }

      await prisma.purchaseInvoice.delete({ where: { id } });
    }

    logger.info('Factura de apertura eliminada', {
      data: { type, id, userId },
    });

    revalidatePath('/dashboard/company/accounting/opening-balances');

    return { success: true };
  } catch (error) {
    logger.error('Error al eliminar factura de apertura', {
      data: { error, type, id, userId },
    });
    throw error;
  }
}

// ============================================
// MUTATIONS - Part B: Import Excel
// ============================================

/**
 * Importa facturas de venta de apertura desde Excel
 */
export async function importOpeningSalesInvoicesFromExcel(
  base64Content: string
) {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('No autenticado');

  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No se encontró la empresa activa');
  await checkPermission('accounting.opening-balances', 'create', { redirect: true });

  try {
    const ExcelJS = (await import('exceljs')).default;
    const workbook = new ExcelJS.Workbook();
    const buffer = Buffer.from(base64Content, 'base64');
    await workbook.xlsx.load(buffer);

    const worksheet = workbook.getWorksheet(1);
    if (!worksheet) throw new Error('El archivo no tiene hojas de cálculo');

    // Cargar datos de referencia
    const [contractors, pointsOfSale] = await Promise.all([
      prisma.contractor.findMany({
        where: { companyId, isActive: true },
        select: { id: true, name: true, taxId: true },
      }),
      prisma.salesPointOfSale.findMany({
        where: { companyId, isActive: true },
        select: { id: true, number: true },
      }),
    ]);

    const errors: string[] = [];
    let imported = 0;

    const rows: OpeningSalesInvoiceInput[] = [];

    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber <= 1) return; // Skip header

      const clienteValue = String(row.getCell(1).value || '').trim();
      const tipoValue = String(row.getCell(2).value || '').trim();
      const pdvValue = String(row.getCell(3).value || '').trim();
      const numeroValue = String(row.getCell(4).value || '').trim();
      const fechaEmisionValue = row.getCell(5).value;
      const fechaVencValue = row.getCell(6).value;
      const totalValue = Number(row.getCell(7).value);

      if (!clienteValue && !tipoValue && !numeroValue) return; // Skip empty rows

      // Resolver cliente
      const client = contractors.find(
        (c) => c.taxId === clienteValue || c.name === clienteValue
      );
      if (!client) {
        errors.push(`Fila ${rowNumber}: Cliente "${clienteValue}" no encontrado`);
        return;
      }

      // Resolver punto de venta
      const pos = pointsOfSale.find(
        (p) => p.number.toString() === pdvValue || p.number.toString().padStart(4, '0') === pdvValue
      );
      if (!pos) {
        errors.push(
          `Fila ${rowNumber}: Punto de venta "${pdvValue}" no encontrado`
        );
        return;
      }

      // Validar tipo comprobante
      const voucherTypeMap: Record<string, string> = {
        'FACTURA A': 'FACTURA_A',
        'FACTURA B': 'FACTURA_B',
        'FACTURA C': 'FACTURA_C',
        FACTURA_A: 'FACTURA_A',
        FACTURA_B: 'FACTURA_B',
        FACTURA_C: 'FACTURA_C',
        'NOTA CREDITO A': 'NOTA_CREDITO_A',
        'NOTA CREDITO B': 'NOTA_CREDITO_B',
        'NOTA CREDITO C': 'NOTA_CREDITO_C',
        NOTA_CREDITO_A: 'NOTA_CREDITO_A',
        NOTA_CREDITO_B: 'NOTA_CREDITO_B',
        NOTA_CREDITO_C: 'NOTA_CREDITO_C',
      };

      const voucherType = voucherTypeMap[tipoValue.toUpperCase()];
      if (!voucherType) {
        errors.push(
          `Fila ${rowNumber}: Tipo de comprobante "${tipoValue}" no válido`
        );
        return;
      }

      if (!numeroValue) {
        errors.push(`Fila ${rowNumber}: Número de factura vacío`);
        return;
      }

      if (isNaN(totalValue) || totalValue <= 0) {
        errors.push(`Fila ${rowNumber}: Total inválido`);
        return;
      }

      let issueDate: Date;
      if (fechaEmisionValue instanceof Date) {
        issueDate = fechaEmisionValue;
      } else {
        const parsed = moment(String(fechaEmisionValue), ['DD/MM/YYYY', 'YYYY-MM-DD'], true);
        if (!parsed.isValid()) {
          errors.push(`Fila ${rowNumber}: Fecha de emisión inválida`);
          return;
        }
        issueDate = parsed.toDate();
      }

      let dueDate: Date | null = null;
      if (fechaVencValue) {
        if (fechaVencValue instanceof Date) {
          dueDate = fechaVencValue;
        } else {
          const parsed = moment(String(fechaVencValue), ['DD/MM/YYYY', 'YYYY-MM-DD'], true);
          if (parsed.isValid()) {
            dueDate = parsed.toDate();
          }
        }
      }

      rows.push({
        customerId: client.id,
        pointOfSaleId: pos.id,
        voucherType: voucherType as OpeningSalesInvoiceInput['voucherType'],
        number: numeroValue,
        issueDate,
        dueDate,
        total: totalValue,
      });
    });

    // Crear facturas
    for (const row of rows) {
      try {
        await createOpeningSalesInvoice(row);
        imported++;
      } catch (error) {
        const msg = error instanceof Error ? error.message : 'Error desconocido';
        errors.push(`Factura ${row.number}: ${msg}`);
      }
    }

    revalidatePath('/dashboard/company/accounting/opening-balances');

    return { success: true, imported, errors };
  } catch (error) {
    logger.error('Error al importar facturas de venta de apertura', {
      data: { error, companyId, userId },
    });
    throw error;
  }
}

/**
 * Importa facturas de compra de apertura desde Excel
 */
export async function importOpeningPurchaseInvoicesFromExcel(
  base64Content: string
) {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('No autenticado');

  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No se encontró la empresa activa');
  await checkPermission('accounting.opening-balances', 'create', { redirect: true });

  try {
    const ExcelJS = (await import('exceljs')).default;
    const workbook = new ExcelJS.Workbook();
    const buffer = Buffer.from(base64Content, 'base64');
    await workbook.xlsx.load(buffer);

    const worksheet = workbook.getWorksheet(1);
    if (!worksheet) throw new Error('El archivo no tiene hojas de cálculo');

    // Cargar datos de referencia
    const suppliers = await prisma.supplier.findMany({
      where: { companyId, status: 'ACTIVE' },
      select: { id: true, businessName: true, tradeName: true, taxId: true },
    });

    const errors: string[] = [];
    let imported = 0;

    const rows: OpeningPurchaseInvoiceInput[] = [];

    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber <= 1) return; // Skip header

      const proveedorValue = String(row.getCell(1).value || '').trim();
      const tipoValue = String(row.getCell(2).value || '').trim();
      const pdvValue = String(row.getCell(3).value || '').trim();
      const numeroValue = String(row.getCell(4).value || '').trim();
      const fechaEmisionValue = row.getCell(5).value;
      const fechaVencValue = row.getCell(6).value;
      const totalValue = Number(row.getCell(7).value);

      if (!proveedorValue && !tipoValue && !numeroValue) return;

      // Resolver proveedor
      const supplier = suppliers.find(
        (s) =>
          s.taxId === proveedorValue ||
          s.businessName === proveedorValue ||
          s.tradeName === proveedorValue
      );
      if (!supplier) {
        errors.push(
          `Fila ${rowNumber}: Proveedor "${proveedorValue}" no encontrado`
        );
        return;
      }

      // Validar tipo comprobante
      const voucherTypeMap: Record<string, string> = {
        'FACTURA A': 'FACTURA_A',
        'FACTURA B': 'FACTURA_B',
        'FACTURA C': 'FACTURA_C',
        FACTURA_A: 'FACTURA_A',
        FACTURA_B: 'FACTURA_B',
        FACTURA_C: 'FACTURA_C',
        'NOTA CREDITO A': 'NOTA_CREDITO_A',
        'NOTA CREDITO B': 'NOTA_CREDITO_B',
        'NOTA CREDITO C': 'NOTA_CREDITO_C',
        NOTA_CREDITO_A: 'NOTA_CREDITO_A',
        NOTA_CREDITO_B: 'NOTA_CREDITO_B',
        NOTA_CREDITO_C: 'NOTA_CREDITO_C',
      };

      const voucherType = voucherTypeMap[tipoValue.toUpperCase()];
      if (!voucherType) {
        errors.push(
          `Fila ${rowNumber}: Tipo de comprobante "${tipoValue}" no válido`
        );
        return;
      }

      if (!numeroValue) {
        errors.push(`Fila ${rowNumber}: Número de factura vacío`);
        return;
      }

      if (isNaN(totalValue) || totalValue <= 0) {
        errors.push(`Fila ${rowNumber}: Total inválido`);
        return;
      }

      let issueDate: Date;
      if (fechaEmisionValue instanceof Date) {
        issueDate = fechaEmisionValue;
      } else {
        const parsed = moment(String(fechaEmisionValue), ['DD/MM/YYYY', 'YYYY-MM-DD'], true);
        if (!parsed.isValid()) {
          errors.push(`Fila ${rowNumber}: Fecha de emisión inválida`);
          return;
        }
        issueDate = parsed.toDate();
      }

      let dueDate: Date | null = null;
      if (fechaVencValue) {
        if (fechaVencValue instanceof Date) {
          dueDate = fechaVencValue;
        } else {
          const parsed = moment(String(fechaVencValue), ['DD/MM/YYYY', 'YYYY-MM-DD'], true);
          if (parsed.isValid()) {
            dueDate = parsed.toDate();
          }
        }
      }

      rows.push({
        supplierId: supplier.id,
        voucherType: voucherType as OpeningPurchaseInvoiceInput['voucherType'],
        pointOfSale: pdvValue,
        number: numeroValue,
        issueDate,
        dueDate,
        total: totalValue,
      });
    });

    // Crear facturas
    for (const row of rows) {
      try {
        await createOpeningPurchaseInvoice(row);
        imported++;
      } catch (error) {
        const msg = error instanceof Error ? error.message : 'Error desconocido';
        errors.push(`Factura ${row.number}: ${msg}`);
      }
    }

    revalidatePath('/dashboard/company/accounting/opening-balances');

    return { success: true, imported, errors };
  } catch (error) {
    logger.error('Error al importar facturas de compra de apertura', {
      data: { error, companyId, userId },
    });
    throw error;
  }
}
