'use server';

import { auth } from '@clerk/nextjs/server';
import { getActiveCompanyId } from '@/shared/lib/company';
import { logger } from '@/shared/lib/logger';
import { prisma } from '@/shared/lib/prisma';
import { revalidatePath } from 'next/cache';
import { Prisma } from '@/generated/prisma/client';
import type { DataTableSearchParams } from '@/shared/components/common/DataTable';
import {
  buildFiltersWhere,
  buildDateRangeFiltersWhere,
  parseSearchParams,
  stateToPrismaParams,
} from '@/shared/components/common/DataTable/helpers';
import { CREDIT_NOTE_TYPES, isCreditNote } from '@/modules/commercial/shared/voucher-utils';
import type { CreateReceiptFormData } from '../../shared/validators';
import type { PendingInvoice, ReceiptListItem, ReceiptWithDetails } from '../../shared/types';
import { createJournalEntryForReceipt } from '@/modules/accounting/features/integrations/commercial';
import { checkPermission } from '@/shared/lib/permissions';

/**
 * Obtiene las facturas pendientes de cobro de un cliente
 */
export async function getPendingInvoices(customerId: string): Promise<PendingInvoice[]> {
  await checkPermission('commercial.treasury.receipts', 'view', { redirect: true });
  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    const invoices = await prisma.salesInvoice.findMany({
      where: {
        companyId,
        customerId,
        status: {
          in: ['CONFIRMED', 'PARTIAL_PAID'],
        },
        // NC se compensa automáticamente, no se cobra
        voucherType: {
          notIn: CREDIT_NOTE_TYPES,
        },
      },
      select: {
        id: true,
        fullNumber: true,
        issueDate: true,
        total: true,
        status: true,
        receiptItems: {
          select: {
            amount: true,
          },
        },
        creditNoteApplicationsReceived: {
          select: {
            amount: true,
            creditNoteId: true,
          },
        },
        creditDebitNotes: {
          select: {
            id: true,
            voucherType: true,
            total: true,
            status: true,
          },
        },
      },
      orderBy: { issueDate: 'asc' },
    });

    return invoices.map((invoice) => {
      const receiptsPaid = invoice.receiptItems.reduce((sum, item) => sum + Number(item.amount), 0);
      const cnAppliedExplicit = invoice.creditNoteApplicationsReceived.reduce((sum, app) => sum + Number(app.amount), 0);
      // Fallback: NC vinculadas por originalInvoiceId sin registro explícito
      const explicitCNIds = new Set(
        invoice.creditNoteApplicationsReceived.map((app) => app.creditNoteId)
      );
      const cnLinkedRaw = invoice.creditDebitNotes
        .filter(
          (doc) =>
            isCreditNote(doc.voucherType) &&
            doc.status !== 'DRAFT' &&
            doc.status !== 'CANCELLED' &&
            !explicitCNIds.has(doc.id)
        )
        .reduce((sum, doc) => sum + Number(doc.total), 0);
      const maxFallbackCN = Math.max(0, Number(invoice.total) - receiptsPaid - cnAppliedExplicit);
      const cnLinked = Math.min(cnLinkedRaw, maxFallbackCN);
      const cnApplied = cnAppliedExplicit + cnLinked;
      const total = Number(invoice.total);
      const paidAmount = receiptsPaid + cnApplied;
      return {
        id: invoice.id,
        fullNumber: invoice.fullNumber,
        issueDate: invoice.issueDate,
        total,
        paidAmount,
        pendingAmount: total - paidAmount,
        status: invoice.status,
      };
    });
  } catch (error) {
    logger.error('Error al obtener facturas pendientes', { data: { error, customerId } });
    throw new Error('Error al obtener facturas pendientes');
  }
}

/**
 * Crea un nuevo recibo de cobro (borrador)
 */
export async function createReceipt(data: CreateReceiptFormData) {
  await checkPermission('commercial.treasury.receipts', 'create', { redirect: true });
  const { userId } = await auth();
  if (!userId) throw new Error('No autenticado');

  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    // Obtener el siguiente número de recibo
    const lastReceipt = await prisma.receipt.findFirst({
      where: { companyId },
      orderBy: { number: 'desc' },
      select: { number: true },
    });

    const nextNumber = (lastReceipt?.number ?? 0) + 1;
    const fullNumber = `R-${String(nextNumber).padStart(5, '0')}`;

    // Calcular total
    const totalAmount = data.items.reduce((sum, item) => sum + parseFloat(item.amount), 0);

    // Crear recibo con items y pagos en transacción
    const receipt = await prisma.$transaction(async (tx) => {
      // Crear recibo
      const newReceipt = await tx.receipt.create({
        data: {
          companyId,
          customerId: data.customerId,
          number: nextNumber,
          fullNumber,
          date: data.date,
          totalAmount: new Prisma.Decimal(totalAmount),
          notes: data.notes || null,
          status: 'DRAFT',
          createdBy: userId,
        },
      });

      // Crear items
      await tx.receiptItem.createMany({
        data: data.items.map((item) => ({
          receiptId: newReceipt.id,
          invoiceId: item.invoiceId,
          amount: new Prisma.Decimal(item.amount),
        })),
      });

      // Crear pagos
      await tx.receiptPayment.createMany({
        data: data.payments.map((payment) => ({
          receiptId: newReceipt.id,
          paymentMethod: payment.paymentMethod,
          amount: new Prisma.Decimal(payment.amount),
          cashRegisterId: payment.cashRegisterId || null,
          bankAccountId: payment.bankAccountId || null,
          checkNumber: payment.checkNumber || null,
          cardLast4: payment.cardLast4 || null,
          reference: payment.reference || null,
        })),
      });

      // Crear retenciones
      if (data.withholdings && data.withholdings.length > 0) {
        await tx.receiptWithholding.createMany({
          data: data.withholdings.map((w) => ({
            receiptId: newReceipt.id,
            taxType: w.taxType,
            rate: new Prisma.Decimal(w.rate),
            amount: new Prisma.Decimal(w.amount),
            certificateNumber: w.certificateNumber || null,
          })),
        });
      }

      return newReceipt;
    });

    logger.info('Recibo de cobro creado', {
      data: {
        receiptId: receipt.id,
        fullNumber: receipt.fullNumber,
        totalAmount: totalAmount,
      },
    });

    revalidatePath('/dashboard/commercial/treasury/receipts');

    return { success: true, id: receipt.id };
  } catch (error) {
    logger.error('Error al crear recibo', { data: { error } });
    if (error instanceof Error) {
      throw error;
    }
    throw new Error('Error al crear recibo');
  }
}

/**
 * Confirma un recibo de cobro (actualiza facturas y crea movimientos)
 */
export async function confirmReceipt(receiptId: string) {
  await checkPermission('commercial.treasury.receipts', 'approve', { redirect: true });
  const { userId } = await auth();
  if (!userId) throw new Error('No autenticado');

  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    // Obtener recibo con todos sus datos
    const receipt = await prisma.receipt.findFirst({
      where: {
        id: receiptId,
        companyId,
        status: 'DRAFT',
      },
      include: {
        items: {
          include: {
            invoice: true,
          },
        },
        payments: true,
        withholdings: true,
      },
    });

    if (!receipt) {
      throw new Error('Recibo no encontrado o ya confirmado');
    }

    // Confirmar recibo y procesar en transacción
    await prisma.$transaction(async (tx) => {
      // 1. Confirmar recibo
      await tx.receipt.update({
        where: { id: receiptId },
        data: {
          status: 'CONFIRMED',
          confirmedBy: userId,
          confirmedAt: new Date(),
        },
      });

      // 2. Actualizar estado de facturas
      for (const item of receipt.items) {
        const invoice = item.invoice;

        // Calcular total pagado (recibos + NC aplicadas)
        const existingPayments = await tx.receiptItem.aggregate({
          where: { invoiceId: item.invoiceId },
          _sum: { amount: true },
        });

        const cnApplications = await tx.salesCreditNoteApplication.aggregate({
          where: { invoiceId: item.invoiceId },
          _sum: { amount: true },
        });

        const totalPaid = Number(existingPayments._sum.amount || 0) + Number(cnApplications._sum.amount || 0);
        const invoiceTotal = Number(invoice.total);

        // Actualizar estado según si está totalmente pagada
        const newStatus = totalPaid >= invoiceTotal ? 'PAID' : 'PARTIAL_PAID';

        await tx.salesInvoice.update({
          where: { id: item.invoiceId },
          data: { status: newStatus },
        });
      }

      // 3. Crear movimientos de caja/banco según formas de pago
      for (const payment of receipt.payments) {
        if (payment.cashRegisterId) {
          // Obtener sesión activa de la caja
          const activeSession = await tx.cashRegisterSession.findFirst({
            where: {
              cashRegisterId: payment.cashRegisterId,
              status: 'OPEN',
            },
            select: { id: true },
          });

          if (!activeSession) {
            throw new Error('No hay sesión abierta para la caja seleccionada');
          }

          // Movimiento de caja
          await tx.cashMovement.create({
            data: {
              companyId,
              cashRegisterId: payment.cashRegisterId,
              sessionId: activeSession.id,
              type: 'INCOME',
              amount: payment.amount,
              date: receipt.date,
              description: `Cobro de ${receipt.fullNumber}`,
              reference: receipt.fullNumber,
              createdBy: userId,
            },
          });

          // Actualizar saldo esperado de la sesión
          await tx.cashRegisterSession.update({
            where: { id: activeSession.id },
            data: {
              expectedBalance: {
                increment: payment.amount,
              },
            },
          });
        } else if (payment.bankAccountId) {
          // Movimiento bancario
          const bankAccount = await tx.bankAccount.findUnique({
            where: { id: payment.bankAccountId },
            select: { balance: true },
          });

          if (bankAccount) {
            await tx.bankMovement.create({
              data: {
                companyId,
                bankAccountId: payment.bankAccountId,
                type: 'DEPOSIT',
                amount: payment.amount,
                date: receipt.date,
                description: `Cobro de ${receipt.fullNumber}`,
                reference: receipt.fullNumber,
                receiptId,
                reconciled: true,
                reconciledAt: new Date(),
                reconciledBy: userId,
                createdBy: userId,
              },
            });

            // Actualizar saldo
            await tx.bankAccount.update({
              where: { id: payment.bankAccountId },
              data: {
                balance: bankAccount.balance.add(payment.amount),
              },
            });
          }
        }

        // 3b. Si el pago es con cheque, crear registro Check como THIRD_PARTY en PORTFOLIO
        if (payment.paymentMethod === 'CHECK' && payment.checkNumber) {
          await tx.check.create({
            data: {
              companyId,
              type: 'THIRD_PARTY',
              status: 'PORTFOLIO',
              checkNumber: payment.checkNumber,
              bankName: payment.reference || 'Sin especificar',
              amount: payment.amount,
              issueDate: receipt.date,
              dueDate: receipt.date,
              drawerName: 'Cliente',
              customerId: receipt.customerId,
              receiptPaymentId: payment.id,
              createdBy: userId,
            },
          });
        }
      }

      // Crear asiento contable automáticamente
      try {
        const journalEntryId = await createJournalEntryForReceipt(receiptId, companyId, tx);

        if (journalEntryId) {
          // Actualizar recibo con referencia al asiento contable
          await tx.receipt.update({
            where: { id: receiptId },
            data: { journalEntryId },
          });

          logger.info('Asiento contable generado para recibo de cobro', {
            data: { receiptId, journalEntryId },
          });
        }
      } catch (error) {
        logger.warn('No se pudo generar asiento contable para recibo', {
          data: { receiptId, error },
        });
        // No lanzar error para no interrumpir la confirmación del recibo
      }
    });

    logger.info('Recibo de cobro confirmado', {
      data: {
        receiptId,
        fullNumber: receipt.fullNumber,
      },
    });

    revalidatePath('/dashboard/commercial/treasury/receipts');

    return { success: true };
  } catch (error) {
    logger.error('Error al confirmar recibo', { data: { error, receiptId } });
    if (error instanceof Error) {
      throw error;
    }
    throw new Error('Error al confirmar recibo');
  }
}

/**
 * Obtiene la lista de recibos
 */
export async function getReceipts(params: { customerId?: string; status?: string } = {}): Promise<ReceiptListItem[]> {
  await checkPermission('commercial.treasury.receipts', 'view', { redirect: true });
  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    const receipts = await prisma.receipt.findMany({
      where: {
        companyId,
        ...(params.customerId && { customerId: params.customerId }),
        ...(params.status && { status: params.status as any }),
      },
      select: {
        id: true,
        number: true,
        fullNumber: true,
        date: true,
        totalAmount: true,
        status: true,
        createdAt: true,
        customer: {
          select: {
            id: true,
            name: true,
          },
        },
        _count: {
          select: {
            items: true,
            payments: true,
          },
        },
      },
      orderBy: { number: 'desc' },
      take: 100,
    });

    return receipts.map((r) => ({
      ...r,
      totalAmount: Number(r.totalAmount),
    })) as ReceiptListItem[];
  } catch (error) {
    logger.error('Error al obtener recibos', { data: { error } });
    throw new Error('Error al obtener recibos');
  }
}

/**
 * Obtiene recibos con paginación server-side para DataTable
 */
export async function getReceiptsPaginated(searchParams: DataTableSearchParams) {
  await checkPermission('commercial.treasury.receipts', 'view', { redirect: true });
  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    const parsed = parseSearchParams(searchParams);
    const { skip, take, orderBy } = stateToPrismaParams(parsed);

    const filtersWhere = buildFiltersWhere(parsed.filters, {
      status: 'status',
    }, { exclude: ['date', 'customer', 'fullNumber'] });

    const dateFiltersWhere = buildDateRangeFiltersWhere(parsed.filters, ['date']);

    // Filtro de texto para número
    const fullNumberFilter = parsed.filters['fullNumber']?.[0];
    const fullNumberWhere = fullNumberFilter
      ? { fullNumber: { contains: fullNumberFilter, mode: 'insensitive' as const } }
      : {};

    // Filtro de texto para cliente
    const customerFilter = parsed.filters['customer'];
    const customerWhere = customerFilter?.[0]
      ? {
          customer: {
            name: { contains: customerFilter[0], mode: 'insensitive' as const },
          },
        }
      : {};

    const where = {
      companyId,
      ...filtersWhere,
      ...dateFiltersWhere,
      ...fullNumberWhere,
      ...customerWhere,
    };

    const [receipts, total] = await Promise.all([
      prisma.receipt.findMany({
        where,
        skip,
        take,
        orderBy: orderBy || { number: 'desc' },
        select: {
          id: true,
          number: true,
          fullNumber: true,
          date: true,
          totalAmount: true,
          status: true,
          createdAt: true,
          customer: {
            select: {
              id: true,
              name: true,
            },
          },
          _count: {
            select: {
              items: true,
              payments: true,
            },
          },
        },
      }),
      prisma.receipt.count({ where }),
    ]);

    const data = receipts.map((r) => ({
      ...r,
      totalAmount: Number(r.totalAmount),
    })) as ReceiptListItem[];

    return { data, total };
  } catch (error) {
    logger.error('Error al obtener recibos paginados', { data: { error } });
    throw new Error('Error al obtener recibos');
  }
}

/**
 * Obtiene el detalle de un recibo
 */
export async function getReceipt(id: string): Promise<ReceiptWithDetails> {
  await checkPermission('commercial.treasury.receipts', 'view', { redirect: true });
  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    const receipt = await prisma.receipt.findFirst({
      where: { id, companyId },
      select: {
        id: true,
        companyId: true,
        number: true,
        fullNumber: true,
        date: true,
        totalAmount: true,
        notes: true,
        status: true,
        documentUrl: true,
        documentKey: true,
        createdAt: true,
        company: { select: { name: true } },
        customer: {
          select: {
            id: true,
            name: true,
            taxId: true,
          },
        },
        items: {
          select: {
            id: true,
            amount: true,
            invoice: {
              select: {
                id: true,
                fullNumber: true,
                total: true,
              },
            },
          },
        },
        payments: {
          select: {
            id: true,
            paymentMethod: true,
            amount: true,
            cashRegister: {
              select: {
                code: true,
                name: true,
              },
            },
            bankAccount: {
              select: {
                bankName: true,
                accountNumber: true,
              },
            },
            checkNumber: true,
            cardLast4: true,
            reference: true,
          },
        },
        withholdings: {
          select: {
            id: true,
            taxType: true,
            rate: true,
            amount: true,
            certificateNumber: true,
          },
        },
        bankMovements: {
          select: {
            id: true,
            type: true,
            amount: true,
            date: true,
            bankAccount: {
              select: {
                bankName: true,
                accountNumber: true,
              },
            },
          },
        },
      },
    });

    if (!receipt) {
      throw new Error('Recibo no encontrado');
    }

    return {
      ...receipt,
      totalAmount: Number(receipt.totalAmount),
      items: receipt.items.map((item) => ({
        ...item,
        amount: Number(item.amount),
        invoice: {
          ...item.invoice,
          total: Number(item.invoice.total),
        },
      })),
      payments: receipt.payments.map((payment) => ({
        ...payment,
        amount: Number(payment.amount),
      })),
      withholdings: receipt.withholdings.map((w) => ({
        ...w,
        rate: Number(w.rate),
        amount: Number(w.amount),
      })),
      bankMovements: receipt.bankMovements?.map((mov) => ({
        ...mov,
        amount: Number(mov.amount),
      })),
    } as ReceiptWithDetails;
  } catch (error) {
    logger.error('Error al obtener recibo', { data: { error, id } });
    throw new Error('Error al obtener recibo');
  }
}

/**
 * Obtiene cajas activas con sesión abierta (para selector de pago)
 */
export async function getAvailableCashRegisters() {
  await checkPermission('commercial.treasury.receipts', 'view', { redirect: true });
  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    const cashRegisters = await prisma.cashRegister.findMany({
      where: {
        companyId,
        status: 'ACTIVE',
        sessions: {
          some: {
            status: 'OPEN',
          },
        },
      },
      select: {
        id: true,
        code: true,
        name: true,
        sessions: {
          where: { status: 'OPEN' },
          select: {
            id: true,
            expectedBalance: true,
          },
          take: 1,
        },
      },
    });

    return cashRegisters.map((cr) => ({
      id: cr.id,
      code: cr.code,
      name: cr.name,
      sessionId: cr.sessions[0]?.id,
      balance: Number(cr.sessions[0]?.expectedBalance ?? 0),
    }));
  } catch (error) {
    logger.error('Error al obtener cajas disponibles', { data: { error } });
    return [];
  }
}

/**
 * Obtiene cuentas bancarias activas (para selector de pago)
 */
export async function getAvailableBankAccounts() {
  await checkPermission('commercial.treasury.receipts', 'view', { redirect: true });
  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    const accounts = await prisma.bankAccount.findMany({
      where: {
        companyId,
        status: 'ACTIVE',
      },
      select: {
        id: true,
        bankName: true,
        accountNumber: true,
        balance: true,
      },
      orderBy: { bankName: 'asc' },
    });

    return accounts.map((a) => ({
      ...a,
      balance: Number(a.balance),
    }));
  } catch (error) {
    logger.error('Error al obtener cuentas bancarias', { data: { error } });
    return [];
  }
}

/**
 * Elimina un recibo en estado DRAFT
 */
export async function deleteReceipt(receiptId: string) {
  await checkPermission('commercial.treasury.receipts', 'delete', { redirect: true });
  const { userId } = await auth();
  if (!userId) throw new Error('No autenticado');

  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    // Verificar que el recibo exista y esté en estado DRAFT
    const receipt = await prisma.receipt.findFirst({
      where: {
        id: receiptId,
        companyId,
        status: 'DRAFT',
      },
    });

    if (!receipt) {
      throw new Error('Recibo no encontrado o no está en estado borrador');
    }

    // Eliminar el recibo (los items y payments se eliminan en cascada)
    await prisma.receipt.delete({
      where: { id: receiptId },
    });

    logger.info('Recibo eliminado', {
      data: {
        receiptId,
        fullNumber: receipt.fullNumber,
      },
    });

    revalidatePath('/dashboard/commercial/treasury/receipts');

    return { success: true };
  } catch (error) {
    logger.error('Error al eliminar recibo', { data: { error, receiptId } });
    if (error instanceof Error) {
      throw error;
    }
    throw new Error('Error al eliminar recibo');
  }
}
