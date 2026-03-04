'use server';

import { auth } from '@clerk/nextjs/server';
import { Prisma } from '@/generated/prisma/client';
import { prisma } from '@/shared/lib/prisma';
import { logger } from '@/shared/lib/logger';
import { getActiveCompanyId } from '@/shared/lib/company';
import { revalidatePath } from 'next/cache';
import type { DataTableSearchParams } from '@/shared/components/common/DataTable';
import {
  buildSearchWhere,
  buildFiltersWhere,
  buildDateRangeFiltersWhere,
  parseSearchParams,
  stateToPrismaParams,
} from '@/shared/components/common/DataTable/helpers';
import { checkPermission } from '@/shared/lib/permissions';
import type { PurchaseOrderFormInput } from '../shared/validators';
import moment from 'moment';

// ============================================
// QUERIES
// ============================================

/**
 * Obtiene órdenes de compra con paginación server-side para DataTable
 */
export async function getPurchaseOrdersPaginated(searchParams: DataTableSearchParams) {
  await checkPermission('commercial.purchase-orders', 'view', { redirect: true });
  const { userId } = await auth();
  if (!userId) throw new Error('No autenticado');

  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    const parsed = parseSearchParams(searchParams);
    const { skip, take, orderBy } = stateToPrismaParams(parsed);

    const searchWhere = buildSearchWhere(parsed.search, [
      'fullNumber',
      'notes',
    ]);

    const filtersWhere = buildFiltersWhere(parsed.filters, {
      status: 'status',
      invoicingStatus: 'invoicingStatus',
    }, { exclude: ['issueDate'] });

    const dateFiltersWhere = buildDateRangeFiltersWhere(parsed.filters, ['issueDate']);

    const where = {
      companyId,
      ...searchWhere,
      ...filtersWhere,
      ...dateFiltersWhere,
    };

    const [orders, total] = await Promise.all([
      prisma.purchaseOrder.findMany({
        where,
        skip,
        take,
        orderBy: orderBy || { issueDate: 'desc' },
        include: {
          supplier: {
            select: {
              businessName: true,
              tradeName: true,
              taxId: true,
            },
          },
        },
      }),
      prisma.purchaseOrder.count({ where }),
    ]);

    const data = orders.map((order) => ({
      ...order,
      subtotal: Number(order.subtotal),
      vatAmount: Number(order.vatAmount),
      total: Number(order.total),
      issueDate: order.issueDate,
      expectedDeliveryDate: order.expectedDeliveryDate,
    }));

    return { data, total };
  } catch (error) {
    logger.error('Error al obtener órdenes de compra', {
      data: {
        error: error instanceof Error ? error.message : String(error),
        companyId,
      },
    });
    throw new Error('Error al obtener órdenes de compra');
  }
}

/**
 * Obtiene una orden de compra por ID con todos sus detalles
 */
export async function getPurchaseOrderById(id: string) {
  await checkPermission('commercial.purchase-orders', 'view', { redirect: true });
  const { userId } = await auth();
  if (!userId) throw new Error('No autenticado');

  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    const order = await prisma.purchaseOrder.findUnique({
      where: { id },
      include: {
        supplier: {
          select: {
            id: true,
            businessName: true,
            tradeName: true,
            taxId: true,
            taxCondition: true,
            address: true,
            phone: true,
            email: true,
          },
        },
        lines: {
          include: {
            product: {
              select: {
                code: true,
                name: true,
                unitOfMeasure: true,
              },
            },
          },
        },
        installments: {
          orderBy: { number: 'asc' },
          select: {
            id: true,
            number: true,
            dueDate: true,
            amount: true,
            status: true,
            purchaseInvoiceId: true,
            notes: true,
            purchaseInvoice: {
              select: {
                id: true,
                fullNumber: true,
                total: true,
                status: true,
              },
            },
          },
        },
        receivingNotes: {
          orderBy: { receptionDate: 'desc' },
          select: {
            id: true,
            fullNumber: true,
            receptionDate: true,
            status: true,
            warehouse: {
              select: { name: true },
            },
          },
        },
        purchaseInvoices: {
          orderBy: { issueDate: 'desc' },
          select: {
            id: true,
            fullNumber: true,
            voucherType: true,
            issueDate: true,
            total: true,
            status: true,
          },
        },
        company: {
          select: {
            name: true,
            taxId: true,
            taxStatus: true,
            address: true,
            phone: true,
            email: true,
          },
        },
      },
    });

    if (!order || order.companyId !== companyId) {
      throw new Error('Orden de compra no encontrada');
    }

    return {
      ...order,
      subtotal: Number(order.subtotal),
      vatAmount: Number(order.vatAmount),
      total: Number(order.total),
      lines: order.lines.map((line) => ({
        ...line,
        quantity: Number(line.quantity),
        unitCost: Number(line.unitCost),
        vatRate: Number(line.vatRate),
        vatAmount: Number(line.vatAmount),
        subtotal: Number(line.subtotal),
        total: Number(line.total),
        receivedQty: Number(line.receivedQty),
        invoicedQty: Number(line.invoicedQty),
      })),
      installments: order.installments.map((inst) => ({
        ...inst,
        amount: Number(inst.amount),
        purchaseInvoice: inst.purchaseInvoice
          ? { ...inst.purchaseInvoice, total: Number(inst.purchaseInvoice.total) }
          : null,
      })),
      purchaseInvoices: order.purchaseInvoices.map((inv) => ({
        ...inv,
        total: Number(inv.total),
      })),
    };
  } catch (error) {
    logger.error('Error al obtener orden de compra', {
      data: { error, id, companyId },
    });
    throw error;
  }
}

/**
 * Obtiene proveedores activos para select
 */
export async function getSuppliersForSelect() {
  const { userId } = await auth();
  if (!userId) throw new Error('No autenticado');

  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    return await prisma.supplier.findMany({
      where: {
        companyId,
        status: 'ACTIVE',
      },
      select: {
        id: true,
        code: true,
        businessName: true,
        tradeName: true,
        taxId: true,
        taxCondition: true,
      },
      orderBy: { businessName: 'asc' },
    });
  } catch (error) {
    logger.error('Error al obtener proveedores', {
      data: { error, companyId },
    });
    throw new Error('Error al obtener proveedores');
  }
}

/**
 * Obtiene productos activos para select
 */
export async function getProductsForSelect() {
  const { userId } = await auth();
  if (!userId) throw new Error('No autenticado');

  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    const products = await prisma.product.findMany({
      where: {
        companyId,
        status: 'ACTIVE',
      },
      select: {
        id: true,
        code: true,
        name: true,
        description: true,
        unitOfMeasure: true,
        costPrice: true,
        vatRate: true,
      },
      orderBy: { name: 'asc' },
    });

    return products.map((p) => ({
      ...p,
      costPrice: Number(p.costPrice),
      vatRate: Number(p.vatRate),
    }));
  } catch (error) {
    logger.error('Error al obtener productos', {
      data: { error, companyId },
    });
    throw new Error('Error al obtener productos');
  }
}

// ============================================
// MUTATIONS
// ============================================

/**
 * Crea una nueva orden de compra
 */
export async function createPurchaseOrder(input: PurchaseOrderFormInput) {
  await checkPermission('commercial.purchase-orders', 'create', { redirect: true });
  const { userId } = await auth();
  if (!userId) throw new Error('No autenticado');

  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    // Obtener siguiente número secuencial
    const lastOrder = await prisma.purchaseOrder.findFirst({
      where: { companyId },
      orderBy: { number: 'desc' },
      select: { number: true },
    });

    const nextNumber = (lastOrder?.number ?? 0) + 1;
    const fullNumber = `OC-${String(nextNumber).padStart(5, '0')}`;

    // Calcular totales de líneas
    const lines = input.lines.map((line) => {
      const quantity = new Prisma.Decimal(line.quantity);
      const unitCost = new Prisma.Decimal(line.unitCost);
      const vatRate = new Prisma.Decimal(line.vatRate);
      const subtotal = quantity.mul(unitCost);
      const vatAmount = subtotal.mul(vatRate).div(100);
      const total = subtotal.add(vatAmount);

      return {
        productId: line.productId || null,
        description: line.description,
        quantity,
        unitCost,
        vatRate,
        vatAmount,
        subtotal,
        total,
      };
    });

    const subtotal = lines.reduce((acc, l) => acc.add(l.subtotal), new Prisma.Decimal(0));
    const vatAmount = lines.reduce((acc, l) => acc.add(l.vatAmount), new Prisma.Decimal(0));
    const total = subtotal.add(vatAmount);

    const order = await prisma.$transaction(async (tx) => {
      const created = await tx.purchaseOrder.create({
        data: {
          companyId,
          supplierId: input.supplierId,
          number: nextNumber,
          fullNumber,
          issueDate: moment.utc(input.issueDate).startOf('day').toDate(),
          expectedDeliveryDate: input.expectedDeliveryDate
            ? moment.utc(input.expectedDeliveryDate).startOf('day').toDate()
            : null,
          paymentConditions: input.paymentConditions || null,
          deliveryAddress: input.deliveryAddress || null,
          deliveryNotes: input.deliveryNotes || null,
          notes: input.notes || null,
          subtotal,
          vatAmount,
          total,
          createdBy: userId,
          lines: {
            create: lines,
          },
        },
      });

      // Crear cuotas si aplica
      if (input.hasInstallments && input.installments && input.installments.length >= 2) {
        const installmentSum = input.installments.reduce(
          (acc, inst) => acc.add(new Prisma.Decimal(inst.amount)),
          new Prisma.Decimal(0)
        );

        if (!installmentSum.equals(total)) {
          throw new Error('La suma de las cuotas debe ser igual al total de la orden');
        }

        await tx.purchaseOrderInstallment.createMany({
          data: input.installments.map((inst, idx) => ({
            companyId,
            orderId: created.id,
            number: idx + 1,
            dueDate: moment.utc(inst.dueDate).startOf('day').toDate(),
            amount: new Prisma.Decimal(inst.amount),
            notes: inst.notes || null,
          })),
        });
      }

      return created;
    });

    logger.info('Orden de compra creada', {
      data: { orderId: order.id, fullNumber: order.fullNumber },
    });

    revalidatePath('/dashboard/commercial/purchase-orders');

    return { id: order.id, fullNumber: order.fullNumber };
  } catch (error) {
    logger.error('Error al crear orden de compra', {
      data: { error, companyId },
    });
    throw new Error('Error al crear la orden de compra');
  }
}

/**
 * Actualiza una orden de compra (solo si está en DRAFT)
 */
export async function updatePurchaseOrder(id: string, input: PurchaseOrderFormInput) {
  await checkPermission('commercial.purchase-orders', 'update', { redirect: true });
  const { userId } = await auth();
  if (!userId) throw new Error('No autenticado');

  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    const existing = await prisma.purchaseOrder.findUnique({
      where: { id },
      select: { companyId: true, status: true },
    });

    if (!existing || existing.companyId !== companyId) {
      throw new Error('Orden de compra no encontrada');
    }

    if (existing.status !== 'DRAFT') {
      throw new Error('Solo se pueden editar órdenes en estado borrador');
    }

    // Calcular totales de líneas
    const lines = input.lines.map((line) => {
      const quantity = new Prisma.Decimal(line.quantity);
      const unitCost = new Prisma.Decimal(line.unitCost);
      const vatRate = new Prisma.Decimal(line.vatRate);
      const subtotal = quantity.mul(unitCost);
      const vatAmount = subtotal.mul(vatRate).div(100);
      const total = subtotal.add(vatAmount);

      return {
        productId: line.productId || null,
        description: line.description,
        quantity,
        unitCost,
        vatRate,
        vatAmount,
        subtotal,
        total,
      };
    });

    const subtotal = lines.reduce((acc, l) => acc.add(l.subtotal), new Prisma.Decimal(0));
    const vatAmount = lines.reduce((acc, l) => acc.add(l.vatAmount), new Prisma.Decimal(0));
    const total = subtotal.add(vatAmount);

    await prisma.$transaction(async (tx) => {
      // Eliminar líneas y cuotas existentes
      await tx.purchaseOrderLine.deleteMany({ where: { orderId: id } });
      await tx.purchaseOrderInstallment.deleteMany({ where: { orderId: id } });

      // Actualizar orden con nuevas líneas
      await tx.purchaseOrder.update({
        where: { id },
        data: {
          supplierId: input.supplierId,
          issueDate: moment.utc(input.issueDate).startOf('day').toDate(),
          expectedDeliveryDate: input.expectedDeliveryDate
            ? moment.utc(input.expectedDeliveryDate).startOf('day').toDate()
            : null,
          paymentConditions: input.paymentConditions || null,
          deliveryAddress: input.deliveryAddress || null,
          deliveryNotes: input.deliveryNotes || null,
          notes: input.notes || null,
          subtotal,
          vatAmount,
          total,
          lines: {
            create: lines,
          },
        },
      });

      // Recrear cuotas si aplica
      if (input.hasInstallments && input.installments && input.installments.length >= 2) {
        const installmentSum = input.installments.reduce(
          (acc, inst) => acc.add(new Prisma.Decimal(inst.amount)),
          new Prisma.Decimal(0)
        );

        if (!installmentSum.equals(total)) {
          throw new Error('La suma de las cuotas debe ser igual al total de la orden');
        }

        await tx.purchaseOrderInstallment.createMany({
          data: input.installments.map((inst, idx) => ({
            companyId,
            orderId: id,
            number: idx + 1,
            dueDate: moment.utc(inst.dueDate).startOf('day').toDate(),
            amount: new Prisma.Decimal(inst.amount),
            notes: inst.notes || null,
          })),
        });
      }
    });

    logger.info('Orden de compra actualizada', { data: { orderId: id } });

    revalidatePath('/dashboard/commercial/purchase-orders');
    revalidatePath(`/dashboard/commercial/purchase-orders/${id}`);

    return { success: true };
  } catch (error) {
    logger.error('Error al actualizar orden de compra', {
      data: { error, id, companyId },
    });
    throw error;
  }
}

/**
 * Envía una orden de compra para aprobación (DRAFT → PENDING_APPROVAL)
 */
export async function submitForApproval(id: string) {
  await checkPermission('commercial.purchase-orders', 'update', { redirect: true });
  const { userId } = await auth();
  if (!userId) throw new Error('No autenticado');

  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    const order = await prisma.purchaseOrder.findUnique({
      where: { id },
      select: { companyId: true, status: true, fullNumber: true },
    });

    if (!order || order.companyId !== companyId) {
      throw new Error('Orden de compra no encontrada');
    }

    if (order.status !== 'DRAFT') {
      throw new Error('Solo se pueden enviar a aprobación órdenes en estado borrador');
    }

    await prisma.purchaseOrder.update({
      where: { id },
      data: { status: 'PENDING_APPROVAL' },
    });

    logger.info('Orden de compra enviada a aprobación', {
      data: { orderId: id, fullNumber: order.fullNumber },
    });

    revalidatePath('/dashboard/commercial/purchase-orders');
    revalidatePath(`/dashboard/commercial/purchase-orders/${id}`);

    return { success: true };
  } catch (error) {
    logger.error('Error al enviar orden a aprobación', {
      data: { error, id, companyId },
    });
    throw error;
  }
}

/**
 * Aprueba una orden de compra (PENDING_APPROVAL → APPROVED)
 */
export async function approvePurchaseOrder(id: string) {
  await checkPermission('commercial.purchase-orders', 'approve', { redirect: true });
  const { userId } = await auth();
  if (!userId) throw new Error('No autenticado');

  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    const order = await prisma.purchaseOrder.findUnique({
      where: { id },
      select: { companyId: true, status: true, fullNumber: true },
    });

    if (!order || order.companyId !== companyId) {
      throw new Error('Orden de compra no encontrada');
    }

    if (order.status !== 'PENDING_APPROVAL') {
      throw new Error('Solo se pueden aprobar órdenes pendientes de aprobación');
    }

    await prisma.purchaseOrder.update({
      where: { id },
      data: {
        status: 'APPROVED',
        approvedBy: userId,
        approvedAt: new Date(),
      },
    });

    logger.info('Orden de compra aprobada', {
      data: { orderId: id, fullNumber: order.fullNumber, approvedBy: userId },
    });

    revalidatePath('/dashboard/commercial/purchase-orders');
    revalidatePath(`/dashboard/commercial/purchase-orders/${id}`);

    return { success: true };
  } catch (error) {
    logger.error('Error al aprobar orden de compra', {
      data: { error, id, companyId },
    });
    throw error;
  }
}

/**
 * Rechaza una orden de compra (PENDING_APPROVAL → DRAFT)
 */
export async function rejectPurchaseOrder(id: string) {
  await checkPermission('commercial.purchase-orders', 'approve', { redirect: true });
  const { userId } = await auth();
  if (!userId) throw new Error('No autenticado');

  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    const order = await prisma.purchaseOrder.findUnique({
      where: { id },
      select: { companyId: true, status: true, fullNumber: true },
    });

    if (!order || order.companyId !== companyId) {
      throw new Error('Orden de compra no encontrada');
    }

    if (order.status !== 'PENDING_APPROVAL') {
      throw new Error('Solo se pueden rechazar órdenes pendientes de aprobación');
    }

    await prisma.purchaseOrder.update({
      where: { id },
      data: { status: 'DRAFT' },
    });

    logger.info('Orden de compra rechazada', {
      data: { orderId: id, fullNumber: order.fullNumber },
    });

    revalidatePath('/dashboard/commercial/purchase-orders');
    revalidatePath(`/dashboard/commercial/purchase-orders/${id}`);

    return { success: true };
  } catch (error) {
    logger.error('Error al rechazar orden de compra', {
      data: { error, id, companyId },
    });
    throw error;
  }
}

/**
 * Cancela una orden de compra (DRAFT/PENDING_APPROVAL/APPROVED → CANCELLED)
 */
export async function cancelPurchaseOrder(id: string) {
  await checkPermission('commercial.purchase-orders', 'update', { redirect: true });
  const { userId } = await auth();
  if (!userId) throw new Error('No autenticado');

  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    const order = await prisma.purchaseOrder.findUnique({
      where: { id },
      select: { companyId: true, status: true, fullNumber: true },
    });

    if (!order || order.companyId !== companyId) {
      throw new Error('Orden de compra no encontrada');
    }

    const cancellableStatuses = ['DRAFT', 'PENDING_APPROVAL', 'APPROVED'];
    if (!cancellableStatuses.includes(order.status)) {
      throw new Error('No se puede cancelar una orden en este estado');
    }

    await prisma.purchaseOrder.update({
      where: { id },
      data: { status: 'CANCELLED' },
    });

    logger.info('Orden de compra cancelada', {
      data: { orderId: id, fullNumber: order.fullNumber },
    });

    revalidatePath('/dashboard/commercial/purchase-orders');
    revalidatePath(`/dashboard/commercial/purchase-orders/${id}`);

    return { success: true };
  } catch (error) {
    logger.error('Error al cancelar orden de compra', {
      data: { error, id, companyId },
    });
    throw error;
  }
}

/**
 * Elimina una orden de compra (solo si está en DRAFT)
 */
export async function deletePurchaseOrder(id: string) {
  await checkPermission('commercial.purchase-orders', 'delete', { redirect: true });
  const { userId } = await auth();
  if (!userId) throw new Error('No autenticado');

  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    const order = await prisma.purchaseOrder.findUnique({
      where: { id },
      select: { companyId: true, status: true, fullNumber: true },
    });

    if (!order || order.companyId !== companyId) {
      throw new Error('Orden de compra no encontrada');
    }

    if (order.status !== 'DRAFT') {
      throw new Error('Solo se pueden eliminar órdenes en estado borrador');
    }

    await prisma.purchaseOrder.delete({ where: { id } });

    logger.info('Orden de compra eliminada', {
      data: { orderId: id, fullNumber: order.fullNumber },
    });

    revalidatePath('/dashboard/commercial/purchase-orders');

    return { success: true };
  } catch (error) {
    logger.error('Error al eliminar orden de compra', {
      data: { error, id, companyId },
    });
    throw error;
  }
}

// ============================================
// CUOTAS - VINCULACIÓN CON FACTURAS
// ============================================

/**
 * Vincula una factura de compra a una cuota de OC
 */
export async function linkInvoiceToInstallment(
  installmentId: string,
  purchaseInvoiceId: string
) {
  await checkPermission('commercial.purchase-orders', 'update', { redirect: true });
  const { userId } = await auth();
  if (!userId) throw new Error('No autenticado');

  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    const installment = await prisma.purchaseOrderInstallment.findUnique({
      where: { id: installmentId },
      include: {
        order: {
          select: { supplierId: true },
        },
      },
    });

    if (!installment || installment.companyId !== companyId) {
      throw new Error('Cuota no encontrada');
    }

    if (installment.status !== 'PENDING') {
      throw new Error('Solo se pueden vincular cuotas pendientes');
    }

    const invoice = await prisma.purchaseInvoice.findUnique({
      where: { id: purchaseInvoiceId },
      select: { id: true, companyId: true, supplierId: true, fullNumber: true },
    });

    if (!invoice || invoice.companyId !== companyId) {
      throw new Error('Factura no encontrada');
    }

    if (invoice.supplierId !== installment.order.supplierId) {
      throw new Error('La factura debe ser del mismo proveedor que la orden de compra');
    }

    await prisma.purchaseOrderInstallment.update({
      where: { id: installmentId },
      data: {
        purchaseInvoiceId,
        status: 'INVOICED',
      },
    });

    logger.info('Factura vinculada a cuota de OC', {
      data: { installmentId, purchaseInvoiceId, companyId },
    });

    revalidatePath('/dashboard/commercial/purchase-orders');

    return { success: true };
  } catch (error) {
    logger.error('Error al vincular factura a cuota', {
      data: { error, installmentId, purchaseInvoiceId, companyId },
    });
    throw error;
  }
}

/**
 * Desvincula una factura de una cuota de OC
 */
export async function unlinkInvoiceFromInstallment(installmentId: string) {
  await checkPermission('commercial.purchase-orders', 'update', { redirect: true });
  const { userId } = await auth();
  if (!userId) throw new Error('No autenticado');

  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    const installment = await prisma.purchaseOrderInstallment.findUnique({
      where: { id: installmentId },
      select: { id: true, companyId: true, status: true },
    });

    if (!installment || installment.companyId !== companyId) {
      throw new Error('Cuota no encontrada');
    }

    if (installment.status !== 'INVOICED') {
      throw new Error('Solo se pueden desvincular cuotas facturadas');
    }

    await prisma.purchaseOrderInstallment.update({
      where: { id: installmentId },
      data: {
        purchaseInvoiceId: null,
        status: 'PENDING',
      },
    });

    logger.info('Factura desvinculada de cuota de OC', {
      data: { installmentId, companyId },
    });

    revalidatePath('/dashboard/commercial/purchase-orders');

    return { success: true };
  } catch (error) {
    logger.error('Error al desvincular factura de cuota', {
      data: { error, installmentId, companyId },
    });
    throw error;
  }
}

/**
 * Obtiene facturas de compra del proveedor que no están vinculadas a cuotas
 */
export async function getUnlinkedPurchaseInvoicesForSupplier(supplierId: string) {
  await checkPermission('commercial.purchase-orders', 'view', { redirect: true });
  const { userId } = await auth();
  if (!userId) throw new Error('No autenticado');

  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    const invoices = await prisma.purchaseInvoice.findMany({
      where: {
        companyId,
        supplierId,
        purchaseOrderInstallments: { none: {} },
      },
      select: {
        id: true,
        fullNumber: true,
        issueDate: true,
        total: true,
        status: true,
      },
      orderBy: { issueDate: 'desc' },
      take: 50,
    });

    return invoices.map((inv) => ({
      ...inv,
      total: Number(inv.total),
    }));
  } catch (error) {
    logger.error('Error al obtener facturas no vinculadas', {
      data: { error, supplierId, companyId },
    });
    throw new Error('Error al obtener facturas');
  }
}

// ============================================
// TIPOS INFERIDOS
// ============================================

export type PurchaseOrderListItem = Awaited<ReturnType<typeof getPurchaseOrdersPaginated>>['data'][number];
export type PurchaseOrderDetailData = Awaited<ReturnType<typeof getPurchaseOrderById>>;
export type SupplierSelectItem = Awaited<ReturnType<typeof getSuppliersForSelect>>[number];
export type ProductSelectItem = Awaited<ReturnType<typeof getProductsForSelect>>[number];
