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
import moment from 'moment';
import type { CreatePaymentOrderFormData, PartnerRepaymentFormData } from '../../shared/validators';
import { partnerRepaymentSchema } from '../../shared/validators';
import type { PendingPurchaseInvoice, PaymentOrderListItem, PaymentOrderWithDetails } from '../../shared/types';
import { createJournalEntryForPaymentOrder } from '@/modules/accounting/features/integrations/commercial';
import { checkPermission } from '@/shared/lib/permissions';

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
      const paymentsPaid = invoice.paymentOrderItems.reduce((sum, item) => sum + Number(item.amount), 0);
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
      const maxFallbackCN = Math.max(0, Number(invoice.total) - paymentsPaid - cnAppliedExplicit);
      const cnLinked = Math.min(cnLinkedRaw, maxFallbackCN);
      const cnApplied = cnAppliedExplicit + cnLinked;
      const total = Number(invoice.total);
      const paidAmount = paymentsPaid + cnApplied;
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
          data: data.withholdings.map((w) => ({
            paymentOrderId: newPaymentOrder.id,
            taxType: w.taxType,
            rate: new Prisma.Decimal(w.rate),
            amount: new Prisma.Decimal(w.amount),
            certificateNumber: w.certificateNumber || null,
          })),
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
 * Confirma una orden de pago (actualiza facturas y crea movimientos)
 */
export async function confirmPaymentOrder(paymentOrderId: string) {
  await checkPermission('commercial.treasury.payment-orders', 'approve', { redirect: true });
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('No autenticado');

  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    // Obtener orden de pago con todos sus datos
    const paymentOrder = await prisma.paymentOrder.findFirst({
      where: {
        id: paymentOrderId,
        companyId,
        status: 'DRAFT',
      },
      include: {
        items: {
          include: {
            invoice: true,
            expense: true,
          },
        },
        payments: { include: { card: { include: { partner: true } } } },
        withholdings: true,
        supplier: { select: { businessName: true, taxId: true } },
      },
    });

    if (!paymentOrder) {
      throw new Error('Orden de pago no encontrada o ya confirmada');
    }

    // Confirmar orden de pago y procesar en transacción
    await prisma.$transaction(async (tx) => {
      // 1. Confirmar orden de pago
      await tx.paymentOrder.update({
        where: { id: paymentOrderId },
        data: {
          status: 'CONFIRMED',
          confirmedBy: userId,
          confirmedAt: new Date(),
        },
      });

      // 2. Actualizar estado de facturas y gastos
      for (const item of paymentOrder.items) {
        if (item.invoiceId && item.invoice) {
          // Item de factura de compra
          const invoice = item.invoice;

          const existingPayments = await tx.paymentOrderItem.aggregate({
            where: { invoiceId: item.invoiceId },
            _sum: { amount: true },
          });

          const cnApplications = await tx.purchaseCreditNoteApplication.aggregate({
            where: { invoiceId: item.invoiceId },
            _sum: { amount: true },
          });

          const totalPaid = Number(existingPayments._sum.amount || 0) + Number(cnApplications._sum.amount || 0);
          const invoiceTotal = Number(invoice.total);
          const newStatus = totalPaid >= invoiceTotal ? 'PAID' : 'PARTIAL_PAID';

          await tx.purchaseInvoice.update({
            where: { id: item.invoiceId },
            data: { status: newStatus },
          });
        } else if (item.expenseId && item.expense) {
          // Item de gasto
          const existingPayments = await tx.paymentOrderItem.aggregate({
            where: { expenseId: item.expenseId },
            _sum: { amount: true },
          });

          const totalPaid = Number(existingPayments._sum.amount || 0);
          const expenseTotal = Number(item.expense.amount);
          const newStatus = totalPaid >= expenseTotal ? 'PAID' : 'PARTIAL_PAID';

          await tx.expense.update({
            where: { id: item.expenseId },
            data: { status: newStatus },
          });
        }
      }

      // 3. Crear movimientos de caja/banco según formas de pago
      for (const payment of paymentOrder.payments) {
        // Si se pagó con la tarjeta de un socio, la empresa NO mueve plata ahora:
        // el socio adelantó el pago. El egreso ocurre al devolverle (OP de devolución).
        if (payment.card && payment.card.ownerType === 'PARTNER') {
          continue;
        }

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

          // Movimiento de caja (EXPENSE)
          await tx.cashMovement.create({
            data: {
              companyId,
              cashRegisterId: payment.cashRegisterId,
              sessionId: activeSession.id,
              type: 'EXPENSE',
              amount: payment.amount,
              date: paymentOrder.date,
              description: `Pago de ${paymentOrder.fullNumber}`,
              reference: paymentOrder.fullNumber,
              createdBy: userId,
            },
          });

          // Actualizar saldo esperado de la sesión (restar)
          await tx.cashRegisterSession.update({
            where: { id: activeSession.id },
            data: {
              expectedBalance: {
                decrement: payment.amount,
              },
            },
          });
        } else if (payment.bankAccountId && payment.paymentMethod !== 'ECHEQ') {
          // Movimiento bancario (WITHDRAWAL). El e-cheq NO debita el saldo hasta que el cheque se debita/cobra.
          const bankAccount = await tx.bankAccount.findUnique({
            where: { id: payment.bankAccountId },
            select: { balance: true },
          });

          if (bankAccount) {
            await tx.bankMovement.create({
              data: {
                companyId,
                bankAccountId: payment.bankAccountId,
                type: 'WITHDRAWAL',
                amount: payment.amount,
                date: paymentOrder.date,
                description: `Pago de ${paymentOrder.fullNumber}`,
                reference: paymentOrder.fullNumber,
                paymentOrderId,
                reconciled: true,
                reconciledAt: new Date(),
                reconciledBy: userId,
                createdBy: userId,
              },
            });

            // Actualizar saldo (restar)
            await tx.bankAccount.update({
              where: { id: payment.bankAccountId },
              data: {
                balance: bankAccount.balance.sub(payment.amount),
              },
            });
          }
        }

        // 3b. Cheque o e-cheq como medio de pago
        if (payment.paymentMethod === 'CHECK' || payment.paymentMethod === 'ECHEQ') {
          if (payment.endorsedCheckId) {
            // Cheque/e-cheq DE TERCEROS: se endosa un cheque en cartera al proveedor
            const endorsed = await tx.check.findFirst({
              where: { id: payment.endorsedCheckId, companyId, type: 'THIRD_PARTY', status: 'PORTFOLIO' },
              select: { id: true },
            });
            if (!endorsed) {
              throw new Error('El cheque de tercero seleccionado ya no está disponible en cartera');
            }
            await tx.check.update({
              where: { id: endorsed.id },
              data: {
                status: 'ENDORSED',
                endorsedToName: paymentOrder.supplier?.businessName || 'Proveedor',
                endorsedToTaxId: paymentOrder.supplier?.taxId || null,
                endorsedAt: paymentOrder.date,
                supplierId: paymentOrder.supplierId,
                paymentOrderPaymentId: payment.id,
              },
            });
          } else if (payment.checkNumber) {
            // Cheque/e-cheq PROPIO: se emite un cheque nuevo
            const isEcheq = payment.paymentMethod === 'ECHEQ';
            await tx.check.create({
              data: {
                companyId,
                type: 'OWN',
                status: 'DELIVERED',
                isElectronic: isEcheq,
                checkNumber: payment.checkNumber,
                bankName: payment.checkBankName || payment.reference || 'Sin especificar',
                amount: payment.amount,
                issueDate: payment.checkIssueDate ?? paymentOrder.date,
                dueDate: payment.checkDueDate ?? paymentOrder.date,
                drawerName: payment.checkDrawerName || 'Empresa',
                drawerTaxId: payment.checkDrawerTaxId || null,
                supplierId: paymentOrder.supplierId,
                // e-cheq propio: cuenta bancaria desde la que se emite
                bankAccountId: isEcheq ? payment.bankAccountId : null,
                paymentOrderPaymentId: payment.id,
                createdBy: userId,
              },
            });
          }
        }
      }

      // 3c. Tarjetas: generar el cronograma de cuotas (la deuda).
      //  - Crédito (empresa o socio): N cuotas mensuales.
      //  - Débito de un socio: 1 cuota (la empresa le debe el total al socio).
      //  - Débito de empresa: nada (el dinero ya salió del banco en el paso 3).
      // Si la tarjeta es de un socio, la cuota queda asociada a él (partnerId) y representa
      // lo que la empresa le debe; se salda con una OP de devolución.
      for (const payment of paymentOrder.payments) {
        if (!payment.card) continue;
        const card = payment.card;
        const isPartnerCard = card.ownerType === 'PARTNER' && Boolean(card.partnerId);
        const paymentAmount = Number(payment.amount);

        let installmentsCount = 0;
        if (payment.paymentMethod === 'CREDIT_CARD') {
          installmentsCount = Math.max(1, payment.installmentsCount ?? 1);
        } else if (payment.paymentMethod === 'DEBIT_CARD' && isPartnerCard) {
          installmentsCount = 1;
        }
        if (installmentsCount === 0) continue;

        // Reparto en centavos para que la suma cuadre exactamente con el total
        const totalCents = Math.round(paymentAmount * 100);
        const baseCents = Math.floor(totalCents / installmentsCount);
        const remainderCents = totalCents - baseCents * installmentsCount;

        for (let i = 1; i <= installmentsCount; i++) {
          const cents = baseCents + (i <= remainderCents ? 1 : 0);
          const amount = new Prisma.Decimal((cents / 100).toFixed(2));

          // Vencimiento: cuotas de crédito vencen i meses después; la cuota única de débito
          // de socio vence en la fecha de la OP (se le debe ya). Si la tarjeta tiene día de
          // vencimiento configurado, se ajusta a ese día del mes correspondiente.
          let dueDate =
            payment.paymentMethod === 'CREDIT_CARD'
              ? moment(paymentOrder.date).add(i, 'months')
              : moment(paymentOrder.date);
          if (card.dueDay) {
            dueDate = dueDate.date(Math.min(card.dueDay, dueDate.daysInMonth()));
          }

          await tx.paymentOrderInstallment.create({
            data: {
              companyId,
              paymentOrderId,
              cardId: card.id,
              partnerId: isPartnerCard ? card.partnerId : null,
              number: i,
              dueDate: dueDate.toDate(),
              amount,
              status: 'PENDING',
            },
          });

          // Proyección de cashflow (egreso futuro: pago a la tarjeta o devolución al socio)
          await tx.cashflowProjection.create({
            data: {
              companyId,
              type: 'EXPENSE',
              category: 'OTHER',
              description:
                installmentsCount > 1
                  ? `Cuota ${i}/${installmentsCount} ${paymentOrder.fullNumber} — ${card.name}`
                  : `${paymentOrder.fullNumber} — ${card.name}`,
              amount,
              date: dueDate.toDate(),
              status: 'PENDING',
              createdBy: userId,
            },
          });
        }
      }

      // 3d. OP de devolución a un socio: saldar las cuotas reservadas por esta OP.
      // La cuota pasa a PAID (deja de contar en el saldo del socio); el egreso real de
      // caja/banco ya se registró en el paso 3.
      if (paymentOrder.partnerId) {
        await tx.paymentOrderInstallment.updateMany({
          where: { settledByPaymentOrderId: paymentOrderId, status: 'PENDING' },
          data: { status: 'PAID', paidAt: paymentOrder.date },
        });
      }

      // Crear asiento contable automáticamente (solo OP a proveedor; las de devolución
      // a socio no generan asiento de compra)
      if (!paymentOrder.partnerId) {
        try {
          const journalEntryId = await createJournalEntryForPaymentOrder(paymentOrderId, companyId, tx);

          if (journalEntryId) {
            // Actualizar orden de pago con referencia al asiento contable
            await tx.paymentOrder.update({
              where: { id: paymentOrderId },
              data: { journalEntryId },
            });

            logger.info('Asiento contable generado para orden de pago', {
              data: { paymentOrderId, journalEntryId },
            });
          }
        } catch (error) {
          logger.warn('No se pudo generar asiento contable para orden de pago', {
            data: { paymentOrderId, error },
          });
          // No lanzar error para no interrumpir la confirmación de la orden
        }
      }
    });

    logger.info('Orden de pago confirmada', {
      data: {
        paymentOrderId,
        fullNumber: paymentOrder.fullNumber,
      },
    });

    revalidatePath('/dashboard/commercial/treasury/payment-orders');

    return { success: true };
  } catch (error) {
    logger.error('Error al confirmar orden de pago', { data: { error, paymentOrderId } });
    if (error instanceof Error) {
      throw error;
    }
    throw new Error('Error al confirmar orden de pago');
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
) {
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
      throw new Error('Orden de pago no encontrada');
    }
    if (existing.status !== 'DRAFT') {
      throw new Error('Solo se pueden editar órdenes de pago en estado borrador');
    }

    // Recalcular total
    const totalAmount = data.items.reduce((sum, item) => sum + parseFloat(item.amount), 0);

    // Reemplazar items/pagos/retenciones en transacción
    await prisma.$transaction(async (tx) => {
      // 1. Actualizar la OP (mantener number, fullNumber, createdBy)
      await tx.paymentOrder.update({
        where: { id: paymentOrderId },
        data: {
          supplierId: data.supplierId || null,
          date: data.date,
          totalAmount: new Prisma.Decimal(totalAmount),
          notes: data.notes || null,
        },
      });

      // 2. Eliminar items, pagos y retenciones viejos
      await tx.paymentOrderItem.deleteMany({ where: { paymentOrderId } });
      await tx.paymentOrderPayment.deleteMany({ where: { paymentOrderId } });
      await tx.paymentOrderWithholding.deleteMany({ where: { paymentOrderId } });

      // 3. Crear nuevos items
      if (data.items.length > 0) {
        await tx.paymentOrderItem.createMany({
          data: data.items.map((item) => ({
            paymentOrderId,
            invoiceId: item.invoiceId || null,
            expenseId: item.expenseId || null,
            amount: new Prisma.Decimal(item.amount),
          })),
        });
      }

      // 4. Crear nuevos pagos
      if (data.payments.length > 0) {
        await tx.paymentOrderPayment.createMany({
          data: data.payments.map((payment) => ({
            paymentOrderId,
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
            checkBankName: payment.checkBankName || null,
            checkIssueDate: payment.checkIssueDate || null,
            checkDueDate: payment.checkDueDate || null,
            checkDrawerName: payment.checkDrawerName || null,
            checkDrawerTaxId: payment.checkDrawerTaxId || null,
            endorsedCheckId:
              payment.checkOwnership === 'THIRD_PARTY' ? payment.endorsedCheckId || null : null,
          })),
        });
      }

      // 5. Crear nuevas retenciones
      if (data.withholdings && data.withholdings.length > 0) {
        await tx.paymentOrderWithholding.createMany({
          data: data.withholdings.map((w) => ({
            paymentOrderId,
            taxType: w.taxType,
            rate: new Prisma.Decimal(w.rate),
            amount: new Prisma.Decimal(w.amount),
            certificateNumber: w.certificateNumber || null,
          })),
        });
      }
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
    logger.error('Error al actualizar orden de pago', {
      data: { error, paymentOrderId },
    });
    if (error instanceof Error) {
      throw error;
    }
    throw new Error('Error al actualizar orden de pago');
  }
}
