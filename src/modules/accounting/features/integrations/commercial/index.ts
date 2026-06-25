/**
 * Integración automática del módulo comercial con contabilidad
 *
 * Este módulo genera asientos contables automáticamente cuando se confirman
 * documentos comerciales (facturas, recibos, órdenes de pago).
 *
 * Esquema de asientos:
 *
 * 1. Factura de Venta (confirmada):
 *    - Debe: Cuentas por Cobrar
 *    - Haber: Ventas + IVA Débito Fiscal
 *
 * 2. Factura de Compra (confirmada):
 *    - Debe: Compras + IVA Crédito Fiscal
 *    - Haber: Cuentas por Pagar
 *
 * 3. Recibo de Cobro (confirmado):
 *    - Debe: Caja/Banco
 *    - Haber: Cuentas por Cobrar
 *
 * 4. Orden de Pago (confirmada):
 *    - Debe: Cuentas por Pagar
 *    - Haber: Caja/Banco
 *
 * 5. Gasto (confirmado):
 *    - Debe: Gastos Operativos
 *    - Haber: Cuentas por Pagar
 */

import moment from 'moment';
import { Prisma } from '@/generated/prisma/client';
import { BudgetStatus, AccountNature } from '@/generated/prisma/enums';
import { prisma } from '@/shared/lib/prisma';
import { logger } from '@/shared/lib/logger';
import { isCreditNote } from '@/modules/commercial/shared/voucher-utils';

// Tipo para el cliente de transacción de Prisma
type PrismaTransactionClient = Omit<
  typeof prisma,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

// ============================================
// TIPOS
// ============================================

interface JournalEntryLineInput {
  accountId: string;
  debit: number;
  credit: number;
  description: string;
  customerId?: string;
  supplierId?: string;
  costCenterId?: string;
}

interface CreateJournalEntryInput {
  companyId: string;
  date: Date;
  description: string;
  lines: JournalEntryLineInput[];
}

// ============================================
// HELPER: Obtener configuración contable
// ============================================

async function getAccountingSettings(companyId: string, tx?: PrismaTransactionClient) {
  const client = tx || prisma;

  const settings = await client.accountingSettings.findUnique({
    where: { companyId },
    include: {
      salesAccount: true,
      purchasesAccount: true,
      receivablesAccount: true,
      payablesAccount: true,
      vatDebitAccount: true,
      vatCreditAccount: true,
      defaultCashAccount: true,
      defaultBankAccount: true,
      expensesAccount: true,
      vatAccounts: { select: { vatRate: true, side: true, accountId: true } },
    },
  });

  if (!settings) {
    throw new Error('No se encontró configuración contable para la empresa');
  }

  return settings;
}

function getVatAccountId(
  settings: Awaited<ReturnType<typeof getAccountingSettings>>,
  vatRate: number,
  side: 'DEBIT' | 'CREDIT'
): string | null {
  const override = settings.vatAccounts.find(
    (va) => Number(va.vatRate) === vatRate && va.side === side
  );
  if (override) return override.accountId;
  return side === 'DEBIT' ? settings.vatDebitAccountId : settings.vatCreditAccountId;
}

function getPerceptionAccountId(
  settings: Awaited<ReturnType<typeof getAccountingSettings>>,
  type: string,
  role: 'collected' | 'suffered'
): string | null {
  const map: Record<string, Record<string, string | null | undefined>> = {
    collected: {
      IVA: settings.perceptionIvaCollectedAccountId,
      IIBB: settings.perceptionIibbCollectedAccountId,
    },
    suffered: {
      IVA: settings.perceptionIvaSufferedAccountId,
      IIBB: settings.perceptionIibbSufferedAccountId,
    },
  };
  return map[role]?.[type] ?? null;
}

// ============================================
// HELPER: Obtener cuenta de retención
// ============================================

function getWithholdingAccountId(
  settings: Awaited<ReturnType<typeof getAccountingSettings>>,
  taxType: string,
  role: 'emitted' | 'suffered'
): string | null {
  const map: Record<string, Record<string, string | null | undefined>> = {
    emitted: {
      IVA: settings.withholdingIvaEmittedAccountId,
      GANANCIAS: settings.withholdingGananciasEmittedAccountId,
      IIBB: settings.withholdingIibbEmittedAccountId,
      SUSS: settings.withholdingSussEmittedAccountId,
    },
    suffered: {
      IVA: settings.withholdingIvaSufferedAccountId,
      GANANCIAS: settings.withholdingGananciasSufferedAccountId,
      IIBB: settings.withholdingIibbSufferedAccountId,
      SUSS: settings.withholdingSussSufferedAccountId,
    },
  };
  return map[role]?.[taxType] ?? null;
}

// ============================================
// HELPER: Validar balance del asiento
// ============================================

function validateBalance(lines: JournalEntryLineInput[]): void {
  const totalDebit = lines.reduce((sum, line) => sum + line.debit, 0);
  const totalCredit = lines.reduce((sum, line) => sum + line.credit, 0);

  // Permitir diferencia de centavos por redondeo
  if (Math.abs(totalDebit - totalCredit) > 0.01) {
    throw new Error(
      `El asiento no está balanceado. Debe: ${totalDebit.toFixed(2)}, Haber: ${totalCredit.toFixed(2)}`
    );
  }
}

// ============================================
// HELPER: Crear asiento contable
// ============================================

async function createJournalEntry(
  input: CreateJournalEntryInput,
  tx: PrismaTransactionClient
): Promise<string | null> {
  const { companyId, date, description, lines } = input;

  // Validar balance
  validateBalance(lines);

  // Verificar bloqueo de período
  const settings = await tx.accountingSettings.findUnique({
    where: { companyId },
    select: { lockedUntilDate: true },
  });

  if (!settings) {
    throw new Error('No se encontró configuración contable');
  }

  if (settings.lockedUntilDate && moment(date).isSameOrBefore(moment(settings.lockedUntilDate), 'day')) {
    throw new Error(
      `No se puede generar el asiento contable: el período está cerrado para la fecha ${moment(date).format('DD/MM/YYYY')}. Contacte al contador para reabrir el período.`
    );
  }

  // Resolver ejercicio y período
  const fiscalYear = await tx.fiscalYear.findFirst({
    where: { companyId, startDate: { lte: date }, endDate: { gte: date } },
    select: { id: true },
  });
  let periodId: string | undefined;
  if (fiscalYear) {
    const entryMoment = moment(date);
    const period = await tx.accountingPeriod.findFirst({
      where: {
        fiscalYearId: fiscalYear.id,
        year: entryMoment.year(),
        month: entryMoment.month() + 1,
        type: 'MONTHLY',
      },
      select: { id: true },
    });
    periodId = period?.id;
  }

  // Incremento atómico: UPDATE ... RETURNING evita race conditions
  const [{ last_entry_number: nextNumber }] = await tx.$queryRaw<[{ last_entry_number: number }]>`
    UPDATE accounting_settings
    SET last_entry_number = last_entry_number + 1, updated_at = NOW()
    WHERE company_id = ${companyId}::uuid
    RETURNING last_entry_number
  `;

  // Crear asiento
  const entry = await tx.journalEntry.create({
    data: {
      companyId,
      number: nextNumber,
      date,
      description,
      createdBy: 'system',
      fiscalYearId: fiscalYear?.id,
      periodId,
      lines: {
        create: lines.map((line) => ({
          accountId: line.accountId,
          debit: new Prisma.Decimal(line.debit),
          credit: new Prisma.Decimal(line.credit),
          description: line.description,
          customerId: line.customerId,
          supplierId: line.supplierId,
          costCenterId: line.costCenterId,
        })),
      },
    },
  });

  logger.info('Asiento contable creado automáticamente', {
    data: {
      entryId: entry.id,
      number: nextNumber,
      totalDebit: lines.reduce((sum, line) => sum + line.debit, 0),
      totalCredit: lines.reduce((sum, line) => sum + line.credit, 0),
    },
  });

  return entry.id;
}

// ============================================
// INTEGRACIÓN: Factura de Venta
// ============================================

export async function createJournalEntryForSalesInvoice(
  invoiceId: string,
  companyId: string,
  tx: PrismaTransactionClient
): Promise<string | null> {
  try {
    const settings = await getAccountingSettings(companyId, tx);

    const invoice = await tx.salesInvoice.findUnique({
      where: { id: invoiceId },
      select: {
        customerId: true,
        fullNumber: true,
        voucherType: true,
        issueDate: true,
        subtotal: true,
        vatAmount: true,
        total: true,
        customer: { select: { name: true } },
        lines: { select: { lineType: true, vatRate: true, vatAmount: true, subtotal: true } },
        perceptions: { select: { type: true, amount: true, jurisdiction: true } },
      },
    });

    if (!invoice) {
      throw new Error('Factura de venta no encontrada');
    }

    const subtotal = parseFloat(invoice.subtotal.toString());
    const total = parseFloat(invoice.total.toString());
    const isNC = isCreditNote(invoice.voucherType);

    if (!settings.receivablesAccountId || !settings.salesAccountId) {
      logger.warn('No se puede crear asiento para factura de venta: cuentas no configuradas', {
        data: { invoiceId, companyId },
      });
      return null;
    }

    const docLabel = isNC ? 'Nota de crédito' : 'Factura de venta';

    const lines: JournalEntryLineInput[] = [
      {
        accountId: settings.receivablesAccountId,
        debit: isNC ? 0 : total,
        credit: isNC ? total : 0,
        description: `${docLabel} ${invoice.fullNumber} - ${invoice.customer.name}`,
        customerId: invoice.customerId,
      },
      {
        accountId: settings.salesAccountId,
        debit: isNC ? subtotal : 0,
        credit: isNC ? 0 : subtotal,
        description: `Ventas - ${invoice.fullNumber}`,
      },
    ];

    // IVA discriminado por alícuota
    const vatByRate = new Map<number, number>();
    for (const line of invoice.lines) {
      if (line.lineType !== 'TAXED') continue;
      const rate = parseFloat(line.vatRate.toString());
      const vat = parseFloat(line.vatAmount.toString());
      if (vat <= 0) continue;
      vatByRate.set(rate, (vatByRate.get(rate) ?? 0) + vat);
    }

    for (const [rate, vatTotal] of vatByRate) {
      const accountId = getVatAccountId(settings, rate, 'DEBIT');
      if (!accountId) {
        logger.warn('No se encontró cuenta de IVA DF para alícuota', {
          data: { invoiceId, rate },
        });
        continue;
      }
      lines.push({
        accountId,
        debit: isNC ? vatTotal : 0,
        credit: isNC ? 0 : vatTotal,
        description: `IVA DF ${rate}% - ${invoice.fullNumber}`,
      });
    }

    // Percepciones cobradas (pasivo)
    for (const perc of invoice.perceptions) {
      const percAmount = parseFloat(perc.amount.toString());
      if (percAmount <= 0) continue;
      const accountId = getPerceptionAccountId(settings, perc.type, 'collected');
      if (!accountId) {
        logger.warn('No se encontró cuenta de percepción cobrada', {
          data: { invoiceId, type: perc.type },
        });
        continue;
      }
      const jurisdLabel = perc.jurisdiction ? ` ${perc.jurisdiction}` : '';
      lines.push({
        accountId,
        debit: isNC ? percAmount : 0,
        credit: isNC ? 0 : percAmount,
        description: `Perc. ${perc.type}${jurisdLabel} - ${invoice.fullNumber}`,
      });
    }

    const entryId = await createJournalEntry(
      {
        companyId,
        date: invoice.issueDate,
        description: `${docLabel} ${invoice.fullNumber}`,
        lines,
      },
      tx
    );

    return entryId;
  } catch (error) {
    logger.error('Error al crear asiento para factura de venta', {
      data: { error, invoiceId, companyId },
    });
    throw error;
  }
}

// ============================================
// INTEGRACIÓN: Factura de Compra
// ============================================

export async function createJournalEntryForPurchaseInvoice(
  invoiceId: string,
  companyId: string,
  tx: PrismaTransactionClient
): Promise<string | null> {
  try {
    const settings = await getAccountingSettings(companyId, tx);

    const invoice = await tx.purchaseInvoice.findUnique({
      where: { id: invoiceId },
      select: {
        supplierId: true,
        fullNumber: true,
        voucherType: true,
        issueDate: true,
        subtotal: true,
        vatAmount: true,
        total: true,
        supplier: { select: { businessName: true } },
        lines: { select: { lineType: true, vatRate: true, vatAmount: true, subtotal: true } },
        perceptions: { select: { type: true, amount: true, jurisdiction: true } },
      },
    });

    if (!invoice) {
      throw new Error('Factura de compra no encontrada');
    }

    const subtotal = parseFloat(invoice.subtotal.toString());
    const total = parseFloat(invoice.total.toString());
    const isNC = isCreditNote(invoice.voucherType);

    if (!settings.payablesAccountId || !settings.purchasesAccountId) {
      logger.warn('No se puede crear asiento para factura de compra: cuentas no configuradas', {
        data: { invoiceId, companyId },
      });
      return null;
    }

    const docLabel = isNC ? 'Nota de crédito de compra' : 'Factura de compra';

    const lines: JournalEntryLineInput[] = [
      {
        accountId: settings.purchasesAccountId,
        debit: isNC ? 0 : subtotal,
        credit: isNC ? subtotal : 0,
        description: `Compras - ${invoice.fullNumber}`,
      },
    ];

    // IVA discriminado por alícuota
    const vatByRate = new Map<number, number>();
    for (const line of invoice.lines) {
      if (line.lineType !== 'TAXED') continue;
      const rate = parseFloat(line.vatRate.toString());
      const vat = parseFloat(line.vatAmount.toString());
      if (vat <= 0) continue;
      vatByRate.set(rate, (vatByRate.get(rate) ?? 0) + vat);
    }

    for (const [rate, vatTotal] of vatByRate) {
      const accountId = getVatAccountId(settings, rate, 'CREDIT');
      if (!accountId) {
        logger.warn('No se encontró cuenta de IVA CF para alícuota', {
          data: { invoiceId, rate },
        });
        continue;
      }
      lines.push({
        accountId,
        debit: isNC ? 0 : vatTotal,
        credit: isNC ? vatTotal : 0,
        description: `IVA CF ${rate}% - ${invoice.fullNumber}`,
      });
    }

    // Percepciones sufridas (activo, crédito fiscal)
    for (const perc of invoice.perceptions) {
      const percAmount = parseFloat(perc.amount.toString());
      if (percAmount <= 0) continue;
      const accountId = getPerceptionAccountId(settings, perc.type, 'suffered');
      if (!accountId) {
        logger.warn('No se encontró cuenta de percepción sufrida', {
          data: { invoiceId, type: perc.type },
        });
        continue;
      }
      const jurisdLabel = perc.jurisdiction ? ` ${perc.jurisdiction}` : '';
      lines.push({
        accountId,
        debit: isNC ? 0 : percAmount,
        credit: isNC ? percAmount : 0,
        description: `Perc. ${perc.type}${jurisdLabel} - ${invoice.fullNumber}`,
      });
    }

    // Cuentas por pagar (total incluye percepciones)
    lines.push({
      accountId: settings.payablesAccountId,
      debit: isNC ? total : 0,
      credit: isNC ? 0 : total,
      description: `${docLabel} ${invoice.fullNumber} - ${invoice.supplier.businessName}`,
      supplierId: invoice.supplierId,
    });

    const entryId = await createJournalEntry(
      {
        companyId,
        date: invoice.issueDate,
        description: `${docLabel} ${invoice.fullNumber}`,
        lines,
      },
      tx
    );

    return entryId;
  } catch (error) {
    logger.error('Error al crear asiento para factura de compra', {
      data: { error, invoiceId, companyId },
    });
    throw error;
  }
}

// ============================================
// INTEGRACIÓN: Recibo de Cobro
// ============================================

export async function createJournalEntryForReceipt(
  receiptId: string,
  companyId: string,
  tx: PrismaTransactionClient
): Promise<string | null> {
  try {
    const settings = await getAccountingSettings(companyId, tx);

    // Verificar cuenta de cuentas por cobrar
    if (!settings.receivablesAccountId) {
      logger.warn('No se puede crear asiento para recibo: cuenta de cuentas por cobrar no configurada', {
        data: { receiptId, companyId },
      });
      return null;
    }

    // Obtener recibo con sus pagos y retenciones
    const receipt = await tx.receipt.findUnique({
      where: { id: receiptId },
      select: {
        customerId: true,
        fullNumber: true,
        date: true,
        totalAmount: true,
        customer: { select: { name: true } },
        payments: {
          select: {
            amount: true,
            cashRegisterId: true,
            bankAccountId: true,
            cashRegister: { select: { accountId: true } },
            bankAccount: { select: { accountId: true } },
          },
        },
        withholdings: {
          select: {
            taxType: true,
            amount: true,
          },
        },
      },
    });

    if (!receipt) {
      throw new Error('Recibo de cobro no encontrado');
    }

    const total = parseFloat(receipt.totalAmount.toString());
    const lines: JournalEntryLineInput[] = [];

    // Haber: Cuentas por Cobrar (activo disminuye)
    lines.push({
      accountId: settings.receivablesAccountId,
      debit: 0,
      credit: total,
      description: `Recibo de cobro ${receipt.fullNumber} - ${receipt.customer.name}`,
      customerId: receipt.customerId,
    });

    // Debe: Caja/Banco (activo aumenta)
    for (const payment of receipt.payments) {
      const amount = parseFloat(payment.amount.toString());
      let accountId: string | null = null;

      if (payment.cashRegisterId && payment.cashRegister?.accountId) {
        accountId = payment.cashRegister.accountId;
      } else if (payment.bankAccountId && payment.bankAccount?.accountId) {
        accountId = payment.bankAccount.accountId;
      } else if (payment.cashRegisterId && settings.defaultCashAccountId) {
        accountId = settings.defaultCashAccountId;
      } else if (payment.bankAccountId && settings.defaultBankAccountId) {
        accountId = settings.defaultBankAccountId;
      }

      if (!accountId) {
        logger.warn('No se encontró cuenta contable para el pago', {
          data: { receiptId, paymentCashRegisterId: payment.cashRegisterId, paymentBankAccountId: payment.bankAccountId },
        });
        continue;
      }

      lines.push({
        accountId,
        debit: amount,
        credit: 0,
        description: payment.cashRegisterId
          ? `Cobro en efectivo - ${receipt.fullNumber}`
          : `Cobro bancario - ${receipt.fullNumber}`,
      });
    }

    // Debe: Retenciones Sufridas (activo, crédito fiscal)
    for (const withholding of receipt.withholdings) {
      const whAmount = parseFloat(withholding.amount.toString());
      const accountId = getWithholdingAccountId(settings, withholding.taxType, 'suffered');

      if (!accountId) {
        logger.warn('No se encontró cuenta contable para retención sufrida', {
          data: { receiptId, taxType: withholding.taxType },
        });
        continue;
      }

      lines.push({
        accountId,
        debit: whAmount,
        credit: 0,
        description: `Ret. ${withholding.taxType} sufrida - ${receipt.fullNumber}`,
      });
    }

    if (lines.length < 2) {
      logger.warn('No se pudieron crear líneas suficientes para el recibo', {
        data: { receiptId },
      });
      return null;
    }

    const entryId = await createJournalEntry(
      {
        companyId,
        date: receipt.date,
        description: `Recibo de cobro ${receipt.fullNumber}`,
        lines,
      },
      tx
    );

    return entryId;
  } catch (error) {
    logger.error('Error al crear asiento para recibo', {
      data: { error, receiptId, companyId },
    });
    throw error;
  }
}

// ============================================
// INTEGRACIÓN: Orden de Pago
// ============================================

export async function createJournalEntryForPaymentOrder(
  paymentOrderId: string,
  companyId: string,
  tx: PrismaTransactionClient
): Promise<string | null> {
  try {
    const settings = await getAccountingSettings(companyId, tx);

    // Verificar cuenta de cuentas por pagar
    if (!settings.payablesAccountId) {
      logger.warn('No se puede crear asiento para orden de pago: cuenta de cuentas por pagar no configurada', {
        data: { paymentOrderId, companyId },
      });
      return null;
    }

    // Obtener orden de pago con sus pagos y retenciones
    const paymentOrder = await tx.paymentOrder.findUnique({
      where: { id: paymentOrderId },
      select: {
        supplierId: true,
        fullNumber: true,
        date: true,
        totalAmount: true,
        supplier: {
          select: {
            businessName: true,
            tradeName: true,
          }
        },
        payments: {
          select: {
            amount: true,
            cashRegisterId: true,
            bankAccountId: true,
            cashRegister: { select: { accountId: true } },
            bankAccount: { select: { accountId: true } },
          },
        },
        withholdings: {
          select: {
            taxType: true,
            amount: true,
          },
        },
      },
    });

    if (!paymentOrder) {
      throw new Error('Orden de pago no encontrada');
    }

    const total = parseFloat(paymentOrder.totalAmount.toString());
    const lines: JournalEntryLineInput[] = [];

    // Debe: Cuentas por Pagar (pasivo disminuye)
    lines.push({
      accountId: settings.payablesAccountId,
      debit: total,
      credit: 0,
      description: `Orden de pago ${paymentOrder.fullNumber}${paymentOrder.supplier ? ` - ${paymentOrder.supplier.tradeName || paymentOrder.supplier.businessName}` : ''}`,
      supplierId: paymentOrder.supplierId ?? undefined,
    });

    // Haber: Caja/Banco (activo disminuye)
    for (const payment of paymentOrder.payments) {
      const amount = parseFloat(payment.amount.toString());
      let accountId: string | null = null;

      if (payment.cashRegisterId && payment.cashRegister?.accountId) {
        accountId = payment.cashRegister.accountId;
      } else if (payment.bankAccountId && payment.bankAccount?.accountId) {
        accountId = payment.bankAccount.accountId;
      } else if (payment.cashRegisterId && settings.defaultCashAccountId) {
        accountId = settings.defaultCashAccountId;
      } else if (payment.bankAccountId && settings.defaultBankAccountId) {
        accountId = settings.defaultBankAccountId;
      }

      if (!accountId) {
        logger.warn('No se encontró cuenta contable para el pago', {
          data: { paymentOrderId, paymentCashRegisterId: payment.cashRegisterId, paymentBankAccountId: payment.bankAccountId },
        });
        continue;
      }

      lines.push({
        accountId,
        debit: 0,
        credit: amount,
        description: payment.cashRegisterId
          ? `Pago en efectivo - ${paymentOrder.fullNumber}`
          : `Pago bancario - ${paymentOrder.fullNumber}`,
      });
    }

    // Haber: Retenciones Emitidas (pasivo, por pagar a AFIP)
    for (const withholding of paymentOrder.withholdings) {
      const whAmount = parseFloat(withholding.amount.toString());
      const accountId = getWithholdingAccountId(settings, withholding.taxType, 'emitted');

      if (!accountId) {
        logger.warn('No se encontró cuenta contable para retención emitida', {
          data: { paymentOrderId, taxType: withholding.taxType },
        });
        continue;
      }

      lines.push({
        accountId,
        debit: 0,
        credit: whAmount,
        description: `Ret. ${withholding.taxType} emitida - ${paymentOrder.fullNumber}`,
      });
    }

    if (lines.length < 2) {
      logger.warn('No se pudieron crear líneas suficientes para la orden de pago', {
        data: { paymentOrderId },
      });
      return null;
    }

    const entryId = await createJournalEntry(
      {
        companyId,
        date: paymentOrder.date,
        description: `Orden de pago ${paymentOrder.fullNumber}`,
        lines,
      },
      tx
    );

    return entryId;
  } catch (error) {
    logger.error('Error al crear asiento para orden de pago', {
      data: { error, paymentOrderId, companyId },
    });
    throw error;
  }
}

// ============================================
// INTEGRACIÓN: Gasto
// ============================================

export async function createJournalEntryForExpense(
  expenseId: string,
  companyId: string,
  tx: PrismaTransactionClient
): Promise<string | null> {
  try {
    const settings = await getAccountingSettings(companyId, tx);

    // Verificar que estén configuradas las cuentas necesarias
    if (!settings.expensesAccountId || !settings.payablesAccountId) {
      logger.warn('No se puede crear asiento para gasto: cuentas no configuradas', {
        data: { expenseId, companyId },
      });
      return null;
    }

    // Obtener gasto
    const expense = await tx.expense.findUnique({
      where: { id: expenseId },
      select: {
        supplierId: true,
        fullNumber: true,
        description: true,
        date: true,
        amount: true,
        supplier: { select: { businessName: true } },
      },
    });

    if (!expense) {
      throw new Error('Gasto no encontrado');
    }

    const amount = parseFloat(expense.amount.toString());
    const supplierName = expense.supplier?.businessName;

    const lines: JournalEntryLineInput[] = [
      {
        accountId: settings.expensesAccountId,
        debit: amount,
        credit: 0,
        description: `Gasto ${expense.fullNumber} - ${expense.description}`,
      },
      {
        accountId: settings.payablesAccountId,
        debit: 0,
        credit: amount,
        description: `Gasto ${expense.fullNumber}${supplierName ? ` - ${supplierName}` : ''}`,
        supplierId: expense.supplierId ?? undefined,
      },
    ];

    const entryId = await createJournalEntry(
      {
        companyId,
        date: expense.date,
        description: `Gasto ${expense.fullNumber} - ${expense.description}`,
        lines,
      },
      tx
    );

    return entryId;
  } catch (error) {
    logger.error('Error al crear asiento para gasto', {
      data: { error, expenseId, companyId },
    });
    throw error;
  }
}

// ============================================
// VALIDACIÓN PRESUPUESTARIA PARA GASTOS
// ============================================

/**
 * Verifica si un gasto supera el presupuesto mensual de la cuenta.
 * Retorna un warning (no bloquea la operación).
 * Se invoca desde confirmExpense() antes de la transacción.
 *
 * @param accountId - ID de la cuenta de gastos (expensesAccountId de settings)
 * @param amount - Monto del gasto que se está confirmando
 * @param companyId - ID de la empresa
 * @param expenseDate - Fecha del gasto para determinar el mes presupuestario
 * @returns Objeto con hasWarning, message y executedPercent; o null si no hay presupuesto
 */
export async function checkBudgetForExpense(
  accountId: string,
  amount: number,
  companyId: string,
  expenseDate: Date
): Promise<{
  hasWarning: boolean;
  message: string;
  executedPercent: number;
} | null> {
  try {
    // Obtener configuración contable para determinar el año fiscal
    const settings = await prisma.accountingSettings.findUnique({
      where: { companyId },
      select: {
        fiscalYearStart: true,
        fiscalYearEnd: true,
      },
    });

    if (!settings) return null;

    // Determinar el año fiscal de la fecha del gasto
    const startMonth = moment(settings.fiscalYearStart).month(); // 0-based
    const expenseMoment = moment(expenseDate);
    const expenseMonth = expenseMoment.month(); // 0-based
    const expenseYear = expenseMoment.year();

    // Calcular el año fiscal al que pertenece la fecha del gasto
    const fiscalYear = expenseMonth < startMonth ? expenseYear - 1 : expenseYear;

    // Buscar presupuesto ACTIVE para la cuenta y año fiscal
    const budget = await prisma.budget.findFirst({
      where: {
        companyId,
        accountId,
        fiscalYear,
        status: BudgetStatus.ACTIVE,
      },
      select: {
        id: true,
        monthlyAmounts: true,
        account: {
          select: { nature: true },
        },
      },
    });

    if (!budget) return null;

    const monthlyAmounts = budget.monthlyAmounts as number[];

    // Calcular el índice del mes actual dentro del array de 12 posiciones
    // El índice 0 corresponde al primer mes del año fiscal
    const monthIndex = expenseMonth >= startMonth
      ? expenseMonth - startMonth
      : 12 - startMonth + expenseMonth;

    if (monthIndex < 0 || monthIndex >= 12) return null;

    const budgetedForMonth = monthlyAmounts[monthIndex] ?? 0;

    // Si no hay presupuesto asignado para este mes, no hay advertencia
    if (budgetedForMonth <= 0) return null;

    // Calcular ejecutado del mes actual con query optimizada
    const fiscalYearStart = moment(settings.fiscalYearStart)
      .year(fiscalYear)
      .startOf('day')
      .toDate();
    const fiscalYearEnd = moment(settings.fiscalYearEnd)
      .year(fiscalYear + 1)
      .endOf('day')
      .toDate();

    // Solo necesitamos el mes actual, pero usamos el rango del mes específico
    const monthStart = expenseMoment.clone().startOf('month').toDate();
    const monthEnd = expenseMoment.clone().endOf('month').toDate();

    const accountNature = budget.account.nature;

    const results = await prisma.$queryRaw<
      {
        total_debit: Prisma.Decimal;
        total_credit: Prisma.Decimal;
      }[]
    >`
      SELECT
        COALESCE(SUM(jel.debit), 0) AS total_debit,
        COALESCE(SUM(jel.credit), 0) AS total_credit
      FROM journal_entry_lines jel
      JOIN journal_entries je ON jel.entry_id = je.id
      WHERE jel.account_id = ${accountId}::uuid
        AND je.company_id = ${companyId}::uuid
        AND je.status = 'POSTED'
        AND je.date >= ${monthStart}
        AND je.date <= ${monthEnd}
    `;

    const row = results[0];
    const debit = row ? Number(row.total_debit) : 0;
    const credit = row ? Number(row.total_credit) : 0;

    // Calcular ejecutado según naturaleza de la cuenta
    const currentExecuted =
      accountNature === AccountNature.DEBIT ? debit - credit : credit - debit;

    const totalAfter = currentExecuted + amount;
    const executedPercent =
      budgetedForMonth > 0
        ? Math.round((totalAfter / budgetedForMonth) * 100)
        : 0;

    // Advertir si supera el 80% del presupuesto mensual
    if (executedPercent >= 80) {
      const monthLabel = expenseMoment.format('MMMM YYYY');
      const formatAmount = (n: number) =>
        n.toLocaleString('es-AR', {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        });

      let message: string;
      if (executedPercent > 100) {
        message =
          `Este gasto excede el presupuesto mensual de ${monthLabel}. ` +
          `Presupuestado: $${formatAmount(budgetedForMonth)}, ` +
          `Ejecutado actual: $${formatAmount(currentExecuted)}, ` +
          `Este gasto: $${formatAmount(amount)}, ` +
          `Total resultante: $${formatAmount(totalAfter)} (${executedPercent}% del presupuesto).`;
      } else {
        message =
          `Este gasto se acerca al límite del presupuesto mensual de ${monthLabel}. ` +
          `Presupuestado: $${formatAmount(budgetedForMonth)}, ` +
          `Ejecutado actual: $${formatAmount(currentExecuted)}, ` +
          `Este gasto: $${formatAmount(amount)}, ` +
          `Total resultante: $${formatAmount(totalAfter)} (${executedPercent}% del presupuesto).`;
      }

      return { hasWarning: true, message, executedPercent };
    }

    return null;
  } catch (error) {
    // No bloquear la operación por errores en la validación presupuestaria
    logger.error('Error en validación presupuestaria para gasto', {
      data: { error, accountId, amount, companyId },
    });
    return null;
  }
}
