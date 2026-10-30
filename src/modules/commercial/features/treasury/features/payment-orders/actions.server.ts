'use server';

import { getCurrentUserId } from '@/shared/lib/current-user';
import { getActiveCompanyId } from '@/shared/lib/company';
import { logger } from '@/shared/lib/logger';
import { prisma } from '@/shared/lib/prisma';
import { revalidatePath } from 'next/cache';
import { Prisma } from '@/generated/prisma/client';
import type { DataTableSearchParams } from '@/shared/components/common/DataTable';
import { buildFiltersWhere, buildDateRangeFiltersWhere, parseSearchParams, stateToPrismaParams } from '@/shared/components/common/DataTable/helpers';
import { CREDIT_NOTE_TYPES, isCreditNote } from '@/modules/commercial/shared/voucher-utils';
import type { CreatePaymentOrderFormData, PartnerRepaymentFormData } from '../../shared/validators';
import { partnerRepaymentSchema } from '../../shared/validators';
import type { PendingPurchaseInvoice, PaymentOrderListItem, PaymentOrderWithDetails } from '../../shared/types';
import { checkPermission } from '@/shared/lib/permissions';
import {
  EFFECTIVE_PAYMENT_ORDER_ITEM,
  EFFECTIVE_PURCHASE_CREDIT_NOTE_APPLICATION,
} from '@/shared/lib/effective-settlements';
import { BusinessError, toActionResult, type ActionResult } from '@/shared/lib/action-result';
import {
  assertEntryPreflight,
  loadPaymentOrderEntryPreflight,
  type EntryPreflight,
} from '../../shared/entry-preflight';
import { applyPaymentOrderEffectsTx } from '@/modules/commercial/shared/effects/payment-order.server';
import {
  paymentOrderWithholdingRows,
  writePaymentOrderDataTx,
} from '@/modules/commercial/shared/effects/payment-order-data.server';
import { calculatePendingAmount, hasPendingBalance } from './shared/pending-invoices';

/**
 * Obtiene las facturas pendientes de pago de un proveedor
 */
export async function getPendingPurchaseInvoices(supplierId: string): Promise<PendingPurchaseInvoice[]> {
  await checkPermission('commercial.treasury.payment-orders', 'view', { redirect: true });
  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    const invoices = await prisma.purchaseInvoice.findMany({
      where: {
        companyId,
        supplierId,
        status: {
          in: ['CONFIRMED', 'PARTIAL_PAID'],
        },
        // NC se compensa automáticamente, no se paga
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
        paymentOrderItems: {
          where: EFFECTIVE_PAYMENT_ORDER_ITEM,
          select: {
            amount: true,
          },
        },
        creditNoteApplicationsReceived: {
          where: EFFECTIVE_PURCHASE_CREDIT_NOTE_APPLICATION,
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

    return invoices
      .map((invoice) => {
        const { paidAmount, pendingAmount } = calculatePendingAmount({
          total: Number(invoice.total),
          payments: invoice.paymentOrderItems.map((item) => Number(item.amount)),
          creditNoteApplications: invoice.creditNoteApplicationsReceived.map((app) => ({
            amount: Number(app.amount),
            creditNoteId: app.creditNoteId,
          })),
          linkedCreditDebitNotes: invoice.creditDebitNotes.map((doc) => ({
            id: doc.id,
            total: Number(doc.total),
            isCreditNote: isCreditNote(doc.voucherType),
            status: doc.status,
          })),
        });

        return {
          id: invoice.id,
          fullNumber: invoice.fullNumber,
          issueDate: invoice.issueDate,
          total: Number(invoice.total),
          paidAmount,
          pendingAmount,
          status: invoice.status,
        };
      })
      // Pagarlas o compensarlas con una nota de crédito no cambia su estado:
      // el saldo es lo único que distingue las que siguen abiertas (TSK-584).
      .filter((invoice) => hasPendingBalance(invoice.pendingAmount));
  } catch (error) {
    logger.error('Error al obtener facturas pendientes de pago', { data: { error, supplierId } });
    throw new Error('Error al obtener facturas pendientes de pago');
  }
}

/**
 * Obtiene los cheques de terceros en cartera (disponibles para endosar en un pago).
 * Si se indica isElectronic, filtra por cheques físicos (false) o e-cheq (true).
 */
export async function getPortfolioChecks(isElectronic?: boolean) {
  await checkPermission('commercial.treasury.payment-orders', 'view', { redirect: true });
  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  const checks = await prisma.check.findMany({
    where: {
      companyId,
      type: 'THIRD_PARTY',
      status: 'PORTFOLIO',
      ...(isElectronic === undefined ? {} : { isElectronic }),
    },
    select: {
      id: true,
      checkNumber: true,
      bankName: true,
      amount: true,
      dueDate: true,
      drawerName: true,
      isElectronic: true,
    },
    orderBy: { dueDate: 'asc' },
  });

  return checks.map((c) => ({ ...c, amount: Number(c.amount) }));
}

/**
 * Tarjetas activas de la empresa para el selector de formas de pago.
 */
export async function getActiveCardsForPayment() {
  await checkPermission('commercial.treasury.payment-orders', 'view', { redirect: true });
  const companyId = await getActiveCompanyId();
  if (!companyId) return [];

  const cards = await prisma.card.findMany({
    where: { companyId, isActive: true },
    select: {
      id: true,
      name: true,
      cardType: true,
      brand: true,
      lastFour: true,
      ownerType: true,
      partner: { select: { name: true } },
    },
    orderBy: { name: 'asc' },
  });

  return cards.map((c) => ({
    id: c.id,
    name: c.name,
    cardType: c.cardType,
    brand: c.brand,
    lastFour: c.lastFour,
    ownerType: c.ownerType,
    ownerName: c.ownerType === 'PARTNER' ? c.partner?.name ?? 'Socio' : 'Empresa',
  }));
}

/**
 * Cuotas pendientes (no saldadas) que la empresa le debe a un socio.
 */
export async function getPartnerPendingInstallments(partnerId: string) {
  await checkPermission('commercial.treasury.partners', 'view', { redirect: true });
  const companyId = await getActiveCompanyId();
  if (!companyId) return [];

  const installments = await prisma.paymentOrderInstallment.findMany({
    where: { companyId, partnerId, status: 'PENDING', settledByPaymentOrderId: null },
    select: {
      id: true,
      number: true,
      dueDate: true,
      amount: true,
      card: { select: { name: true } },
      paymentOrder: { select: { fullNumber: true } },
    },
    orderBy: [{ dueDate: 'asc' }],
  });

  return installments.map((i) => ({
    id: i.id,
    number: i.number,
    dueDate: i.dueDate,
    amount: Number(i.amount),
    cardName: i.card?.name ?? '',
    originFullNumber: i.paymentOrder.fullNumber,
  }));
}

/**
 * Crea una OP de devolución a un socio: salda las cuotas seleccionadas de su cuenta
 * corriente. La OP queda en DRAFT; al confirmarla se registran los egresos de caja/banco
 * y las cuotas pasan a PAID.
 */
export async function createPartnerRepaymentOrder(data: PartnerRepaymentFormData) {
  await checkPermission('commercial.treasury.payment-orders', 'create', { redirect: true });
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('No autenticado');

  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  const parsed = partnerRepaymentSchema.safeParse(data);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? 'Datos inválidos');
  }
  const { partnerId, date, notes, installmentIds, payments } = parsed.data;

  try {
    // Validar que las cuotas existan, sean del socio y estén pendientes/no reservadas
    const installments = await prisma.paymentOrderInstallment.findMany({
      where: {
        id: { in: installmentIds },
        companyId,
        partnerId,
        status: 'PENDING',
        settledByPaymentOrderId: null,
      },
      select: { id: true, amount: true },
    });

    if (installments.length !== installmentIds.length) {
      throw new Error('Algunas cuotas ya no están disponibles para devolver');
    }

    const totalCents = installments.reduce((sum, i) => sum + Math.round(Number(i.amount) * 100), 0);
    const payCents = payments.reduce((sum, p) => sum + Math.round(parseFloat(p.amount) * 100), 0);
    if (totalCents !== payCents) {
      throw new Error('El total a devolver debe coincidir con las formas de pago');
    }

    const lastPaymentOrder = await prisma.paymentOrder.findFirst({
      where: { companyId },
      orderBy: { number: 'desc' },
      select: { number: true },
    });
    const nextNumber = (lastPaymentOrder?.number ?? 0) + 1;
    const fullNumber = `OP-${String(nextNumber).padStart(5, '0')}`;

    const op = await prisma.$transaction(async (tx) => {
      const newOp = await tx.paymentOrder.create({
        data: {
          companyId,
          partnerId,
          supplierId: null,
          number: nextNumber,
          fullNumber,
          date,
          totalAmount: new Prisma.Decimal((totalCents / 100).toFixed(2)),
          notes: notes || null,
          status: 'DRAFT',
          createdBy: userId,
        },
      });

      await tx.paymentOrderPayment.createMany({
        data: payments.map((payment) => ({
          paymentOrderId: newOp.id,
          paymentMethod: payment.paymentMethod,
          amount: new Prisma.Decimal(payment.amount),
          cashRegisterId: payment.cashRegisterId || null,
          bankAccountId: payment.bankAccountId || null,
          checkNumber: payment.checkNumber || null,
          reference: payment.reference || null,
          checkBankName: payment.checkBankName || null,
          checkIssueDate: payment.checkIssueDate || null,
          checkDueDate: payment.checkDueDate || null,
          checkDrawerName: payment.checkDrawerName || null,
          checkDrawerTaxId: payment.checkDrawerTaxId || null,
          endorsedCheckId:
            payment.checkOwnership === 'THIRD_PARTY' ? payment.endorsedCheckId || null : null,
        })),
      });

      // Reservar las cuotas para esta OP (se marcan PAID al confirmar)
      await tx.paymentOrderInstallment.updateMany({
        where: { id: { in: installmentIds } },
        data: { settledByPaymentOrderId: newOp.id },
      });

      return newOp;
    });

    logger.info('OP de devolución a socio creada', {
      data: { paymentOrderId: op.id, partnerId, totalAmount: totalCents / 100 },
    });

    revalidatePath('/dashboard/commercial/treasury/payment-orders');
    return { success: true, id: op.id };
  } catch (error) {
    logger.error('Error al crear devolución a socio', { data: { error, partnerId } });
    if (error instanceof Error) throw error;
    throw new Error('Error al crear la devolución al socio');
  }
}

/**
 * Crea una nueva orden de pago (borrador)
 */
export async function createPaymentOrder(data: CreatePaymentOrderFormData) {
  await checkPermission('commercial.treasury.payment-orders', 'create', { redirect: true });
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('No autenticado');

  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    // Obtener el siguiente número de orden de pago
    const lastPaymentOrder = await prisma.paymentOrder.findFirst({
      where: { companyId },
      orderBy: { number: 'desc' },
      select: { number: true },
    });

    const nextNumber = (lastPaymentOrder?.number ?? 0) + 1;
    const fullNumber = `OP-${String(nextNumber).padStart(5, '0')}`;

    // Calcular total
    const totalAmount = data.items.reduce((sum, item) => sum + parseFloat(item.amount), 0);

    // Crear orden de pago con items y pagos en transacción
    const paymentOrder = await prisma.$transaction(async (tx) => {
      // Crear orden de pago
      const newPaymentOrder = await tx.paymentOrder.create({
        data: {
          companyId,
          supplierId: data.supplierId || null,
          number: nextNumber,
          fullNumber,
          date: data.date,
          totalAmount: new Prisma.Decimal(totalAmount),
          notes: data.notes || null,
          status: 'DRAFT',
          createdBy: userId,
        },
      });

      // Crear items (facturas y/o gastos)
      await tx.paymentOrderItem.createMany({
        data: data.items.map((item) => ({
          paymentOrderId: newPaymentOrder.id,
          invoiceId: item.invoiceId || null,
          expenseId: item.expenseId || null,
          amount: new Prisma.Decimal(item.amount),
        })),
      });

      // Crear pagos
      await tx.paymentOrderPayment.createMany({
        data: data.payments.map((payment) => ({
          paymentOrderId: newPaymentOrder.id,
          paymentMethod: payment.paymentMethod,
          amount: new Prisma.Decimal(payment.amount),
          cashRegisterId: payment.cashRegisterId || null,
          bankAccountId: payment.bankAccountId || null,
          checkNumber: payment.checkNumber || null,
          cardLast4: payment.cardLast4 || null,
          cardId: payment.cardId || null,
          installmentsCount:
            payment.paymentMethod === 'CREDIT_CARD' ? payment.installmentsCount ?? null : null,
          reference: payment.reference || null,
          // Metadata del cheque / e-cheq
          checkBankName: payment.checkBankName || null,
          checkIssueDate: payment.checkIssueDate || null,
          checkDueDate: payment.checkDueDate || null,
          checkDrawerName: payment.checkDrawerName || null,
          checkDrawerTaxId: payment.checkDrawerTaxId || null,
          // Cheque de tercero a endosar (si checkOwnership === 'THIRD_PARTY')
          endorsedCheckId: payment.checkOwnership === 'THIRD_PARTY' ? payment.endorsedCheckId || null : null,
        })),
      });

      // Crear retenciones
      if (data.withholdings && data.withholdings.length > 0) {
        await tx.paymentOrderWithholding.createMany({
          data: paymentOrderWithholdingRows(newPaymentOrder.id, data.withholdings),
        });
      }

      return newPaymentOrder;
    });

    logger.info('Orden de pago creada', {
      data: {
        paymentOrderId: paymentOrder.id,
        fullNumber: paymentOrder.fullNumber,
        totalAmount: totalAmount,
      },
    });

    revalidatePath('/dashboard/commercial/treasury/payment-orders');

    return { success: true, id: paymentOrder.id };
  } catch (error) {
    logger.error('Error al crear orden de pago', { data: { error } });
    if (error instanceof Error) {
      throw error;
    }
    throw new Error('Error al crear orden de pago');
  }
}

/**
 * Vista previa del asiento de una orden de pago: alimenta el diálogo de
 * confirmación (TSK-728). No lanza: `error`/`warnings` viajan como dato.
 * Mismo permiso que confirmar.
 */
export async function getPaymentOrderEntryPreview(paymentOrderId: string): Promise<EntryPreflight> {
  await checkPermission('commercial.treasury.payment-orders', 'approve', { redirect: true });
  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  return loadPaymentOrderEntryPreflight(companyId, paymentOrderId);
}

/**
 * Confirma una orden de pago (actualiza facturas/gastos, crea movimientos y el asiento).
 *
 * Los errores esperables (OP ya confirmada, caja sin sesión, cheque endosado no
 * disponible, cuenta contable faltante, período cerrado) vuelven como
 * `{ success: false, error }`; `warnings` lista los pagos que quedaron fuera del
 * asiento y el aviso de OP a socio (TSK-728).
 */
export async function confirmPaymentOrder(
  paymentOrderId: string
): Promise<ActionResult<{ id: string; warnings: string[] }>> {
  await checkPermission('commercial.treasury.payment-orders', 'approve', { redirect: true });
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('No autenticado');

  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    // Guarda: solo se confirma un borrador de la empresa activa
    const paymentOrder = await prisma.paymentOrder.findFirst({
      where: {
        id: paymentOrderId,
        companyId,
        status: 'DRAFT',
      },
      select: { fullNumber: true },
    });

    if (!paymentOrder) {
      throw new BusinessError('Orden de pago no encontrada o ya confirmada');
    }

    // TSK-728: pre-validación fuera de la transacción: nada se mueve si va a fallar por configuración
    const warnings = assertEntryPreflight(await loadPaymentOrderEntryPreflight(companyId, paymentOrderId));

    await prisma.$transaction(async (tx) => {
      // 1. Confirmar orden de pago.
      // El estado se leyó fuera de la tx: si otra confirmación ganó mientras tanto, el
      // UPDATE condicionado no toca nada y los efectos no se aplican dos veces (TSK-812).
      const { count } = await tx.paymentOrder.updateMany({
        where: { id: paymentOrderId, companyId, status: 'DRAFT' },
        data: {
          status: 'CONFIRMED',
          confirmedBy: userId,
          confirmedAt: new Date(),
        },
      });
      if (count === 0) throw new BusinessError('Orden de pago no encontrada o ya confirmada');

      // 2. Efectos: facturas/gastos, caja, banco, cheques, cuotas y asiento (TSK-792)
      await applyPaymentOrderEffectsTx(tx, { companyId, userId }, paymentOrderId);
    });

    logger.info('Orden de pago confirmada', {
      data: {
        paymentOrderId,
        fullNumber: paymentOrder.fullNumber,
        warnings,
      },
    });

    revalidatePath('/dashboard/commercial/treasury/payment-orders');

    return { success: true, id: paymentOrderId, warnings };
  } catch (error) {
    if (error instanceof BusinessError) {
      logger.warn('Confirmación de orden de pago rechazada', {
        data: { paymentOrderId, companyId, userId, motivo: error.message },
      });
    }
    return toActionResult(error, 'Error al confirmar orden de pago');
  }
}

/**
 * Obtiene conteos globales para filtros facetados (server-side)
 */
export async function getPaymentOrderFacetCounts() {
  await checkPermission('commercial.treasury.payment-orders', 'view', { redirect: true });
  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  const statusCounts = await prisma.paymentOrder.groupBy({
    by: ['status'],
    where: { companyId },
    _count: { status: true },
  });

  return {
    status: Object.fromEntries(statusCounts.map((s) => [s.status, s._count.status])),
  };
}

/**
 * Obtiene la lista de órdenes de pago
 */
export async function getPaymentOrders(params: { supplierId?: string; status?: string } = {}): Promise<PaymentOrderListItem[]> {
  await checkPermission('commercial.treasury.payment-orders', 'view', { redirect: true });
  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    const paymentOrders = await prisma.paymentOrder.findMany({
      where: {
        companyId,
        ...(params.supplierId && { supplierId: params.supplierId }),
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
        partnerId: true,
        supplier: {
          select: {
            id: true,
            businessName: true,
            tradeName: true,
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

    return paymentOrders.map((po) => ({
      ...po,
      totalAmount: Number(po.totalAmount),
    })) as PaymentOrderListItem[];
  } catch (error) {
    logger.error('Error al obtener órdenes de pago', {
      data: {
        error,
        message: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined
      }
    });
    throw error;
  }
}

/**
 * Obtiene órdenes de pago con paginación server-side para DataTable
 */
export async function getPaymentOrdersPaginated(searchParams: DataTableSearchParams) {
  await checkPermission('commercial.treasury.payment-orders', 'view', { redirect: true });
  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    const parsed = parseSearchParams(searchParams);
    const { page, pageSize, search, sortBy, sortOrder } = parsed;
    const { skip, take, orderBy: prismaOrderBy } = stateToPrismaParams(parsed);

    const filtersWhere = buildFiltersWhere(parsed.filters, {
      status: 'status',
    }, { exclude: ['date', 'supplier', 'fullNumber'] });

    const dateFiltersWhere = buildDateRangeFiltersWhere(parsed.filters, ['date']);

    // Filtro de texto para número
    const fullNumberFilter = parsed.filters['fullNumber']?.[0];
    const fullNumberWhere = fullNumberFilter
      ? { fullNumber: { contains: fullNumberFilter, mode: 'insensitive' as const } }
      : {};

    // Filtro de texto para proveedor
    const supplierFilter = parsed.filters['supplier'];
    const supplierWhere = supplierFilter?.[0]
      ? {
          supplier: {
            OR: [
              { businessName: { contains: supplierFilter[0], mode: 'insensitive' as const } },
              { tradeName: { contains: supplierFilter[0], mode: 'insensitive' as const } },
            ],
          },
        }
      : {};

    const where: Prisma.PaymentOrderWhereInput = {
      companyId,
      ...filtersWhere,
      ...dateFiltersWhere,
      ...fullNumberWhere,
      ...supplierWhere,
    };

    const orderBy = prismaOrderBy && Object.keys(prismaOrderBy).length > 0 ? prismaOrderBy : { number: 'desc' as const };

    const [data, total] = await Promise.all([
      prisma.paymentOrder.findMany({
        where,
        select: {
          id: true,
          number: true,
          fullNumber: true,
          date: true,
          totalAmount: true,
          status: true,
          createdAt: true,
          partnerId: true,
          supplier: {
            select: {
              id: true,
              businessName: true,
              tradeName: true,
            },
          },
          _count: {
            select: {
              items: true,
              payments: true,
            },
          },
        },
        orderBy,
        skip,
        take,
      }),
      prisma.paymentOrder.count({ where }),
    ]);

    return {
      data: data.map((po) => ({
        ...po,
        totalAmount: Number(po.totalAmount),
      })) as PaymentOrderListItem[],
      total,
    };
  } catch (error) {
    logger.error('Error al obtener órdenes de pago paginadas', { data: { error } });
    throw error;
  }
}

/**
 * Obtiene el detalle de una orden de pago
 */
export async function getPaymentOrder(id: string): Promise<PaymentOrderWithDetails> {
  await checkPermission('commercial.treasury.payment-orders', 'view', { redirect: true });
  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    const paymentOrder = await prisma.paymentOrder.findFirst({
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
        supplier: {
          select: {
            id: true,
            businessName: true,
            tradeName: true,
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
            expense: {
              select: {
                id: true,
                fullNumber: true,
                description: true,
                amount: true,
              },
            },
          },
        },
        payments: {
          select: {
            id: true,
            paymentMethod: true,
            amount: true,
            cashRegisterId: true,
            bankAccountId: true,
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
            cardId: true,
            installmentsCount: true,
            reference: true,
            checkBankName: true,
            checkIssueDate: true,
            checkDueDate: true,
            checkDrawerName: true,
            checkDrawerTaxId: true,
            endorsedCheckId: true,
          },
        },
        withholdings: {
          select: {
            id: true,
            taxType: true,
            rate: true,
            amount: true,
            certificateNumber: true,
            regimeCode: true,
            taxableBase: true,
            jurisdiction: true,
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

    if (!paymentOrder) {
      throw new Error('Orden de pago no encontrada');
    }

    return {
      ...paymentOrder,
      totalAmount: Number(paymentOrder.totalAmount),
      items: paymentOrder.items.map((item) => ({
        ...item,
        amount: Number(item.amount),
        invoice: item.invoice ? {
          ...item.invoice,
          total: Number(item.invoice.total),
        } : null,
        expense: item.expense ? {
          ...item.expense,
          amount: Number(item.expense.amount),
        } : null,
      })),
      payments: paymentOrder.payments.map((payment) => ({
        ...payment,
        amount: Number(payment.amount),
      })),
      withholdings: paymentOrder.withholdings.map((w) => ({
        ...w,
        rate: Number(w.rate),
        amount: Number(w.amount),
        taxableBase: w.taxableBase === null ? null : Number(w.taxableBase),
      })),
      bankMovements: paymentOrder.bankMovements?.map((mov) => ({
        ...mov,
        amount: Number(mov.amount),
      })),
    } as PaymentOrderWithDetails;
  } catch (error) {
    logger.error('Error al obtener orden de pago', { data: { error, id } });
    throw new Error('Error al obtener orden de pago');
  }
}

/**
 * Elimina una orden de pago en estado DRAFT
 */
export async function deletePaymentOrder(paymentOrderId: string) {
  await checkPermission('commercial.treasury.payment-orders', 'delete', { redirect: true });
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('No autenticado');

  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    // Verificar que la orden exista y esté en estado DRAFT
    const paymentOrder = await prisma.paymentOrder.findFirst({
      where: {
        id: paymentOrderId,
        companyId,
        status: 'DRAFT',
      },
    });

    if (!paymentOrder) {
      throw new Error('Orden de pago no encontrada o no está en estado borrador');
    }

    // Eliminar la orden de pago (los items y payments se eliminan en cascada)
    await prisma.paymentOrder.delete({
      where: { id: paymentOrderId },
    });

    logger.info('Orden de pago eliminada', {
      data: {
        paymentOrderId,
        fullNumber: paymentOrder.fullNumber,
      },
    });

    revalidatePath('/dashboard/commercial/treasury/payment-orders');

    return { success: true };
  } catch (error) {
    logger.error('Error al eliminar orden de pago', { data: { error, paymentOrderId } });
    if (error instanceof Error) {
      throw error;
    }
    throw new Error('Error al eliminar orden de pago');
  }
}

/**
 * Actualiza una orden de pago en estado DRAFT.
 * Reemplaza items, pagos y retenciones. Mantiene number/fullNumber/createdBy.
 */
export async function updatePaymentOrder(
  paymentOrderId: string,
  data: CreatePaymentOrderFormData
): Promise<ActionResult<{ id: string }>> {
  await checkPermission('commercial.treasury.payment-orders', 'update', { redirect: true });
  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    // Verificar que la OP existe, es de la empresa y está en DRAFT
    const existing = await prisma.paymentOrder.findFirst({
      where: { id: paymentOrderId, companyId },
      select: { id: true, status: true, fullNumber: true },
    });

    if (!existing) {
      throw new BusinessError('Orden de pago no encontrada');
    }
    if (existing.status !== 'DRAFT') {
      throw new BusinessError('Solo se pueden editar órdenes de pago en estado borrador');
    }

    // Recalcular total
    const totalAmount = data.items.reduce((sum, item) => sum + parseFloat(item.amount), 0);

    // Reemplazar items/pagos/retenciones en transacción, validando que todo sea de la
    // empresa (TSK-792)
    await prisma.$transaction(async (tx) => {
      await writePaymentOrderDataTx(tx, companyId, paymentOrderId, data);
    });

    logger.info('Orden de pago actualizada', {
      data: {
        paymentOrderId,
        fullNumber: existing.fullNumber,
        itemsCount: data.items.length,
        paymentsCount: data.payments.length,
        totalAmount,
      },
    });

    revalidatePath('/dashboard/commercial/treasury/payment-orders');

    return { success: true, id: paymentOrderId };
  } catch (error) {
    // Los BusinessError de la validación de pertenencia (R10) viajan como dato: un
    // `throw` desde el Server Action se redacta en producción.
    return toActionResult(error, 'Error al actualizar orden de pago');
  }
}
