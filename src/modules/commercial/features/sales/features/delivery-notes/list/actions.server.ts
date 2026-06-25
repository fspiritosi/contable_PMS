'use server';

import { getCurrentUserId } from '@/shared/lib/current-user';
import { Prisma } from '@/generated/prisma/client';
import { prisma } from '@/shared/lib/prisma';
import { logger } from '@/shared/lib/logger';
import { getActiveCompanyId } from '@/shared/lib/company';
import { revalidatePath } from 'next/cache';
import type { DataTableSearchParams } from '@/shared/components/common/DataTable';
import {
  buildFiltersWhere,
  buildDateRangeFiltersWhere,
  parseSearchParams,
  stateToPrismaParams,
} from '@/shared/components/common/DataTable/helpers';
import { checkPermission } from '@/shared/lib/permissions';
import type { DeliveryNoteFormInput } from '../shared/validators';
import moment from 'moment';

const BASE_PATH = '/dashboard/commercial/delivery-notes';

// ============================================
// QUERIES
// ============================================

export async function getDeliveryNotesPaginated(searchParams: DataTableSearchParams) {
  await checkPermission('commercial.delivery-notes', 'view', { redirect: true });
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('No autenticado');

  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    const parsed = parseSearchParams(searchParams);
    const { skip, take, orderBy } = stateToPrismaParams(parsed);

    const filtersWhere = buildFiltersWhere(parsed.filters, {
      status: 'status',
    }, { exclude: ['deliveryDate', 'fullNumber', 'customer', 'warehouse'] });
    const dateFiltersWhere = buildDateRangeFiltersWhere(parsed.filters, ['deliveryDate']);

    // Filtro de texto para fullNumber
    const fullNumberFilter = parsed.filters['fullNumber']?.[0];
    const fullNumberWhere = fullNumberFilter
      ? { fullNumber: { contains: fullNumberFilter, mode: 'insensitive' as const } }
      : {};

    // Filtro de texto para cliente (relación)
    const customerFilter = parsed.filters['customer']?.[0];
    const customerWhere = customerFilter
      ? { customer: { name: { contains: customerFilter, mode: 'insensitive' as const } } }
      : {};

    // Filtro de texto para almacén (relación)
    const warehouseFilter = parsed.filters['warehouse']?.[0];
    const warehouseWhere = warehouseFilter
      ? { warehouse: { name: { contains: warehouseFilter, mode: 'insensitive' as const } } }
      : {};

    const where = {
      companyId,
      ...filtersWhere,
      ...dateFiltersWhere,
      ...fullNumberWhere,
      ...customerWhere,
      ...warehouseWhere,
    };

    const [notes, total] = await Promise.all([
      prisma.deliveryNote.findMany({
        where,
        skip,
        take,
        orderBy: orderBy || { deliveryDate: 'desc' },
        include: {
          customer: { select: { name: true, taxId: true } },
          warehouse: { select: { name: true } },
          salesInvoice: { select: { fullNumber: true } },
        },
      }),
      prisma.deliveryNote.count({ where }),
    ]);

    return { data: notes, total };
  } catch (error) {
    logger.error('Error al obtener remitos de entrega', {
      data: { error: error instanceof Error ? error.message : String(error), companyId },
    });
    throw new Error('Error al obtener remitos de entrega');
  }
}

export async function getDeliveryNoteById(id: string) {
  await checkPermission('commercial.delivery-notes', 'view', { redirect: true });
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('No autenticado');

  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    const note = await prisma.deliveryNote.findUnique({
      where: { id },
      include: {
        customer: {
          select: { id: true, name: true, taxId: true, address: true, phone: true, email: true },
        },
        warehouse: { select: { id: true, name: true } },
        salesInvoice: { select: { id: true, fullNumber: true, status: true } },
        lines: {
          include: {
            product: {
              select: { code: true, name: true, unitOfMeasure: true, trackStock: true },
            },
          },
        },
      },
    });

    if (!note || note.companyId !== companyId) {
      throw new Error('Remito de entrega no encontrado');
    }

    return {
      ...note,
      lines: note.lines.map((line) => ({
        ...line,
        quantity: Number(line.quantity),
      })),
    };
  } catch (error) {
    logger.error('Error al obtener remito de entrega', { data: { error, id, companyId } });
    throw error;
  }
}

export async function getCustomersForSelect() {
  const companyId = await getActiveCompanyId();
  if (!companyId) return [];

  try {
    return await prisma.contractor.findMany({
      where: { companyId, isActive: true },
      select: { id: true, name: true, taxId: true },
      orderBy: { name: 'asc' },
    });
  } catch (error) {
    logger.error('Error al obtener clientes', { data: { error } });
    return [];
  }
}

export async function getWarehousesForDelivery() {
  const companyId = await getActiveCompanyId();
  if (!companyId) return [];

  try {
    return await prisma.warehouse.findMany({
      where: { companyId, isActive: true },
      select: { id: true, name: true, type: true },
      orderBy: { name: 'asc' },
    });
  } catch (error) {
    logger.error('Error al obtener almacenes', { data: { error } });
    return [];
  }
}

export async function getProductsForDelivery() {
  const companyId = await getActiveCompanyId();
  if (!companyId) return [];

  try {
    return await prisma.product.findMany({
      where: { companyId, status: 'ACTIVE', trackStock: true, usage: { in: ['SALE', 'PURCHASE_SALE'] } },
      select: { id: true, code: true, name: true, unitOfMeasure: true },
      orderBy: { name: 'asc' },
    });
  } catch (error) {
    logger.error('Error al obtener productos', { data: { error } });
    return [];
  }
}

// ============================================
// MUTATIONS
// ============================================

/**
 * Crea un remito de entrega en PENDING_DELIVERY y descuenta stock
 */
export async function createDeliveryNote(input: DeliveryNoteFormInput) {
  await checkPermission('commercial.delivery-notes', 'create', { redirect: true });
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('No autenticado');

  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    const note = await prisma.$transaction(async (tx) => {
      const lastNote = await tx.deliveryNote.findFirst({
        where: { companyId },
        orderBy: { number: 'desc' },
        select: { number: true },
      });

      const nextNumber = (lastNote?.number ?? 0) + 1;
      const fullNumber = `RE-${String(nextNumber).padStart(5, '0')}`;

      // Verificar stock disponible antes de crear (solo productos con trackStock)
      const productIds = input.lines.map((l) => l.productId);
      const productsInfo = await tx.product.findMany({
        where: { id: { in: productIds } },
        select: { id: true, name: true, trackStock: true },
      });
      const productMap = new Map(productsInfo.map((p) => [p.id, p]));

      for (const line of input.lines) {
        const product = productMap.get(line.productId);
        if (!product?.trackStock) continue;

        const stock = await tx.warehouseStock.findUnique({
          where: {
            warehouseId_productId: {
              warehouseId: input.warehouseId,
              productId: line.productId,
            },
          },
        });

        const available = stock ? Number(stock.availableQty) : 0;
        const requested = parseFloat(line.quantity);

        if (available < requested) {
          throw new Error(
            `Stock insuficiente de "${product.name}". Disponible: ${available}, Solicitado: ${requested}`
          );
        }
      }

      // Crear el remito
      const created = await tx.deliveryNote.create({
        data: {
          companyId,
          customerId: input.customerId,
          warehouseId: input.warehouseId,
          number: nextNumber,
          fullNumber,
          deliveryDate: moment.utc(input.deliveryDate).toDate(),
          notes: input.notes || null,
          createdBy: userId,
          lines: {
            create: input.lines.map((line) => ({
              productId: line.productId,
              description: line.description,
              quantity: new Prisma.Decimal(line.quantity),
              notes: line.notes || null,
            })),
          },
        },
        select: { id: true, fullNumber: true },
      });

      // Descontar stock (solo productos con trackStock)
      for (const line of input.lines) {
        const product = productMap.get(line.productId);
        if (!product?.trackStock) continue;

        const qty = new Prisma.Decimal(line.quantity);

        await tx.stockMovement.create({
          data: {
            companyId,
            warehouseId: input.warehouseId,
            productId: line.productId,
            type: 'SALE',
            quantity: new Prisma.Decimal(parseFloat(line.quantity) * -1),
            referenceType: 'delivery_note',
            referenceId: created.id,
            notes: `Entrega ${fullNumber} - ${line.description}`,
            date: moment.utc(input.deliveryDate).toDate(),
            createdBy: userId,
          },
        });

        await tx.warehouseStock.update({
          where: {
            warehouseId_productId: {
              warehouseId: input.warehouseId,
              productId: line.productId,
            },
          },
          data: {
            quantity: { decrement: qty },
            availableQty: { decrement: qty },
          },
        });
      }

      return created;
    });

    logger.info('Remito de entrega creado', {
      data: { id: note.id, fullNumber: note.fullNumber, companyId, userId },
    });

    revalidatePath(BASE_PATH);
    return note;
  } catch (error) {
    logger.error('Error al crear remito de entrega', {
      data: { error: error instanceof Error ? error.message : String(error), companyId },
    });
    throw new Error(error instanceof Error ? error.message : 'Error al crear el remito de entrega');
  }
}

/**
 * Actualiza un remito (solo PENDING_DELIVERY): revierte stock anterior y aplica nuevo
 */
export async function updateDeliveryNote(id: string, input: DeliveryNoteFormInput) {
  await checkPermission('commercial.delivery-notes', 'update', { redirect: true });
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('No autenticado');

  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    const existing = await prisma.deliveryNote.findUnique({
      where: { id },
      include: { lines: { include: { product: { select: { trackStock: true } } } } },
    });

    if (!existing || existing.companyId !== companyId) throw new Error('Remito no encontrado');
    if (existing.status !== 'PENDING_DELIVERY') throw new Error('Solo se pueden editar remitos pendientes de entrega');

    await prisma.$transaction(async (tx) => {
      // 1. Revertir stock de líneas anteriores
      for (const line of existing.lines) {
        if (!line.product?.trackStock) continue;

        await tx.warehouseStock.update({
          where: {
            warehouseId_productId: {
              warehouseId: existing.warehouseId,
              productId: line.productId,
            },
          },
          data: {
            quantity: { increment: line.quantity },
            availableQty: { increment: line.quantity },
          },
        });
      }

      // Eliminar movimientos de stock anteriores
      await tx.stockMovement.deleteMany({
        where: { referenceType: 'delivery_note', referenceId: id },
      });

      // 2. Verificar stock para nuevas líneas
      for (const line of input.lines) {
        const stock = await tx.warehouseStock.findUnique({
          where: {
            warehouseId_productId: {
              warehouseId: input.warehouseId,
              productId: line.productId,
            },
          },
        });

        const available = stock ? Number(stock.availableQty) : 0;
        if (available < parseFloat(line.quantity)) {
          throw new Error(`Stock insuficiente de "${line.description}". Disponible: ${available}`);
        }
      }

      // 3. Eliminar líneas anteriores y actualizar remito
      await tx.deliveryNoteLine.deleteMany({ where: { deliveryNoteId: id } });

      await tx.deliveryNote.update({
        where: { id },
        data: {
          customerId: input.customerId,
          warehouseId: input.warehouseId,
          deliveryDate: moment.utc(input.deliveryDate).toDate(),
          notes: input.notes || null,
          lines: {
            create: input.lines.map((line) => ({
              productId: line.productId,
              description: line.description,
              quantity: new Prisma.Decimal(line.quantity),
              notes: line.notes || null,
            })),
          },
        },
      });

      // 4. Descontar stock nuevamente
      for (const line of input.lines) {
        const qty = new Prisma.Decimal(line.quantity);

        await tx.stockMovement.create({
          data: {
            companyId,
            warehouseId: input.warehouseId,
            productId: line.productId,
            type: 'SALE',
            quantity: new Prisma.Decimal(parseFloat(line.quantity) * -1),
            referenceType: 'delivery_note',
            referenceId: id,
            notes: `Entrega ${existing.fullNumber} - ${line.description}`,
            date: moment.utc(input.deliveryDate).toDate(),
            createdBy: userId,
          },
        });

        await tx.warehouseStock.update({
          where: {
            warehouseId_productId: {
              warehouseId: input.warehouseId,
              productId: line.productId,
            },
          },
          data: {
            quantity: { decrement: qty },
            availableQty: { decrement: qty },
          },
        });
      }
    });

    logger.info('Remito de entrega actualizado', { data: { id, companyId, userId } });
    revalidatePath(BASE_PATH);
    revalidatePath(`${BASE_PATH}/${id}`);
  } catch (error) {
    logger.error('Error al actualizar remito de entrega', {
      data: { error: error instanceof Error ? error.message : String(error), id },
    });
    throw new Error(error instanceof Error ? error.message : 'Error al actualizar el remito');
  }
}

/**
 * Elimina un remito (solo PENDING_DELIVERY): revierte stock
 */
export async function deleteDeliveryNote(id: string) {
  await checkPermission('commercial.delivery-notes', 'delete', { redirect: true });
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('No autenticado');

  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    const existing = await prisma.deliveryNote.findUnique({
      where: { id },
      include: { lines: { include: { product: { select: { trackStock: true } } } } },
    });

    if (!existing || existing.companyId !== companyId) throw new Error('Remito no encontrado');
    if (existing.status !== 'PENDING_DELIVERY') throw new Error('Solo se pueden eliminar remitos pendientes de entrega');

    await prisma.$transaction(async (tx) => {
      // Revertir stock
      for (const line of existing.lines) {
        if (!line.product?.trackStock) continue;

        await tx.warehouseStock.update({
          where: {
            warehouseId_productId: {
              warehouseId: existing.warehouseId,
              productId: line.productId,
            },
          },
          data: {
            quantity: { increment: line.quantity },
            availableQty: { increment: line.quantity },
          },
        });
      }

      await tx.stockMovement.deleteMany({
        where: { referenceType: 'delivery_note', referenceId: id },
      });

      await tx.deliveryNote.delete({ where: { id } });
    });

    logger.info('Remito de entrega eliminado', { data: { id, companyId, userId } });
    revalidatePath(BASE_PATH);
  } catch (error) {
    logger.error('Error al eliminar remito de entrega', {
      data: { error: error instanceof Error ? error.message : String(error), id },
    });
    throw new Error(error instanceof Error ? error.message : 'Error al eliminar el remito');
  }
}

/**
 * Aceptar remito: PENDING_DELIVERY → ACCEPTED
 */
export async function acceptDeliveryNote(id: string) {
  await checkPermission('commercial.delivery-notes', 'approve', { redirect: true });
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('No autenticado');

  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    const note = await prisma.deliveryNote.findUnique({
      where: { id },
      select: { companyId: true, status: true, fullNumber: true },
    });

    if (!note || note.companyId !== companyId) throw new Error('Remito no encontrado');
    if (note.status !== 'PENDING_DELIVERY') throw new Error('Solo se pueden aceptar remitos pendientes de entrega');

    await prisma.deliveryNote.update({
      where: { id },
      data: { status: 'ACCEPTED' },
    });

    logger.info('Remito de entrega aceptado', {
      data: { id, fullNumber: note.fullNumber, companyId, userId },
    });

    revalidatePath(BASE_PATH);
    revalidatePath(`${BASE_PATH}/${id}`);
  } catch (error) {
    logger.error('Error al aceptar remito', {
      data: { error: error instanceof Error ? error.message : String(error), id },
    });
    throw new Error(error instanceof Error ? error.message : 'Error al aceptar el remito');
  }
}

/**
 * Cancelar remito (PENDING_DELIVERY o ACCEPTED): revierte stock
 */
export async function cancelDeliveryNote(id: string) {
  await checkPermission('commercial.delivery-notes', 'delete', { redirect: true });
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('No autenticado');

  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    const note = await prisma.deliveryNote.findUnique({
      where: { id },
      include: { lines: { include: { product: { select: { trackStock: true } } } } },
    });

    if (!note || note.companyId !== companyId) throw new Error('Remito no encontrado');
    if (!['PENDING_DELIVERY', 'ACCEPTED'].includes(note.status)) {
      throw new Error('Solo se pueden anular remitos pendientes o aceptados');
    }

    await prisma.$transaction(async (tx) => {
      await tx.deliveryNote.update({
        where: { id },
        data: { status: 'CANCELLED' },
      });

      // Revertir stock
      for (const line of note.lines) {
        if (!line.product?.trackStock) continue;

        await tx.stockMovement.create({
          data: {
            companyId,
            warehouseId: note.warehouseId,
            productId: line.productId,
            type: 'RETURN',
            quantity: line.quantity,
            referenceType: 'delivery_note_cancellation',
            referenceId: note.id,
            notes: `Anulación ${note.fullNumber} - ${line.description}`,
            date: new Date(),
            createdBy: userId,
          },
        });

        await tx.warehouseStock.update({
          where: {
            warehouseId_productId: {
              warehouseId: note.warehouseId,
              productId: line.productId,
            },
          },
          data: {
            quantity: { increment: line.quantity },
            availableQty: { increment: line.quantity },
          },
        });
      }
    });

    logger.info('Remito de entrega anulado', {
      data: { id, fullNumber: note.fullNumber, companyId, userId },
    });

    revalidatePath(BASE_PATH);
    revalidatePath(`${BASE_PATH}/${id}`);
  } catch (error) {
    logger.error('Error al anular remito de entrega', {
      data: { error: error instanceof Error ? error.message : String(error), id },
    });
    throw new Error(error instanceof Error ? error.message : 'Error al anular el remito');
  }
}

/**
 * Facturar remitos aceptados: crea SalesInvoice DRAFT desde 1+ remitos del mismo cliente
 */
export async function invoiceDeliveryNotes(deliveryNoteIds: string[]) {
  await checkPermission('commercial.invoices', 'create', { redirect: true });
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('No autenticado');

  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  if (deliveryNoteIds.length === 0) throw new Error('Seleccione al menos un remito');

  try {
    const notes = await prisma.deliveryNote.findMany({
      where: { id: { in: deliveryNoteIds }, companyId },
      include: {
        lines: {
          include: {
            product: {
              select: {
                id: true,
                code: true,
                name: true,
                unitOfMeasure: true,
                salePrice: true,
                vatRate: true,
              },
            },
          },
        },
      },
    });

    // Validaciones
    if (notes.length !== deliveryNoteIds.length) throw new Error('Algunos remitos no fueron encontrados');

    const notAccepted = notes.filter((n) => n.status !== 'ACCEPTED');
    if (notAccepted.length > 0) {
      throw new Error(`Los remitos ${notAccepted.map((n) => n.fullNumber).join(', ')} no están en estado Aceptado`);
    }

    const customerIds = new Set(notes.map((n) => n.customerId));
    if (customerIds.size > 1) throw new Error('Todos los remitos deben ser del mismo cliente');

    const customerId = notes[0].customerId;

    // Obtener punto de venta por defecto
    const pointOfSale = await prisma.salesPointOfSale.findFirst({
      where: { companyId, isActive: true },
      select: { id: true, number: true },
      orderBy: { number: 'asc' },
    });

    if (!pointOfSale) throw new Error('No hay puntos de venta activos');

    // Obtener condición fiscal del cliente para determinar tipo de comprobante
    const customer = await prisma.contractor.findUnique({
      where: { id: customerId },
      select: { taxCondition: true },
    });

    // Determinar tipo de comprobante según condición fiscal
    let voucherType: 'FACTURA_A' | 'FACTURA_B' | 'FACTURA_C' = 'FACTURA_B';
    if (customer?.taxCondition === 'RESPONSABLE_INSCRIPTO') {
      voucherType = 'FACTURA_A';
    } else if (customer?.taxCondition === 'MONOTRIBUTISTA' || customer?.taxCondition === 'CONSUMIDOR_FINAL') {
      voucherType = 'FACTURA_B';
    }

    const invoice = await prisma.$transaction(async (tx) => {
      // Obtener siguiente número de factura
      const lastInvoice = await tx.salesInvoice.findFirst({
        where: { companyId, pointOfSaleId: pointOfSale.id, voucherType },
        orderBy: { number: 'desc' },
        select: { number: true },
      });

      const nextNumber = (lastInvoice?.number ?? 0) + 1;

      // Construir líneas de factura desde líneas de remitos
      const invoiceLines = notes.flatMap((note) =>
        note.lines.map((line) => {
          const unitPrice = line.product?.salePrice ? Number(line.product.salePrice) : 0;
          const vatRate = line.product?.vatRate ? Number(line.product.vatRate) : 21;
          const qty = Number(line.quantity);
          const subtotal = unitPrice * qty;
          const vatAmount = subtotal * (vatRate / 100);
          const total = subtotal + vatAmount;

          return {
            productId: line.productId,
            description: line.description,
            quantity: new Prisma.Decimal(line.quantity),
            unitPrice: new Prisma.Decimal(unitPrice),
            vatRate: new Prisma.Decimal(vatRate),
            subtotal: new Prisma.Decimal(subtotal),
            vatAmount: new Prisma.Decimal(vatAmount),
            total: new Prisma.Decimal(total),
          };
        })
      );

      const totals = invoiceLines.reduce(
        (acc, line) => ({
          subtotal: acc.subtotal + Number(line.subtotal),
          vatAmount: acc.vatAmount + Number(line.vatAmount),
          total: acc.total + Number(line.total),
        }),
        { subtotal: 0, vatAmount: 0, total: 0 }
      );

      // Crear factura en DRAFT
      const created = await tx.salesInvoice.create({
        data: {
          companyId,
          customerId,
          pointOfSaleId: pointOfSale.id,
          voucherType,
          number: nextNumber,
          fullNumber: `${pointOfSale.number.toString().padStart(4, '0')}-${nextNumber.toString().padStart(8, '0')}`,
          issueDate: new Date(),
          subtotal: new Prisma.Decimal(totals.subtotal),
          netTaxed: new Prisma.Decimal(totals.subtotal),
          netNonTaxed: new Prisma.Decimal(0),
          netExempt: new Prisma.Decimal(0),
          vatAmount: new Prisma.Decimal(totals.vatAmount),
          otherTaxes: new Prisma.Decimal(0),
          total: new Prisma.Decimal(totals.total),
          status: 'DRAFT',
          createdBy: userId,
          lines: { create: invoiceLines },
        },
        select: { id: true, fullNumber: true },
      });

      // Actualizar remitos a INVOICED
      await tx.deliveryNote.updateMany({
        where: { id: { in: deliveryNoteIds } },
        data: { status: 'INVOICED', salesInvoiceId: created.id },
      });

      return created;
    });

    logger.info('Factura creada desde remitos de entrega', {
      data: {
        invoiceId: invoice.id,
        invoiceFullNumber: invoice.fullNumber,
        deliveryNoteIds,
        companyId,
        userId,
      },
    });

    revalidatePath(BASE_PATH);
    revalidatePath('/dashboard/commercial/invoices');

    return invoice;
  } catch (error) {
    logger.error('Error al facturar remitos de entrega', {
      data: { error: error instanceof Error ? error.message : String(error), deliveryNoteIds },
    });
    throw new Error(error instanceof Error ? error.message : 'Error al facturar los remitos');
  }
}

// ============================================
// ACCEPTED DELIVERY NOTES GROUPED BY CUSTOMER
// ============================================

export async function getAcceptedDeliveryNotesByCustomer() {
  await checkPermission('commercial.delivery-notes', 'view', { redirect: true });
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('No autenticado');

  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    const notes = await prisma.deliveryNote.findMany({
      where: { companyId, status: 'ACCEPTED' },
      select: {
        id: true,
        fullNumber: true,
        deliveryDate: true,
        customer: { select: { id: true, name: true, taxId: true } },
        lines: { select: { description: true, quantity: true } },
      },
      orderBy: { deliveryDate: 'asc' },
    });

    const byCustomer = new Map<
      string,
      {
        customer: { id: string; name: string; taxId: string | null };
        notes: typeof notes;
      }
    >();

    for (const note of notes) {
      const existing = byCustomer.get(note.customer.id);
      if (existing) {
        existing.notes.push(note);
      } else {
        byCustomer.set(note.customer.id, { customer: note.customer, notes: [note] });
      }
    }

    return Array.from(byCustomer.values()).map((g) => ({
      ...g,
      notes: g.notes.map((n) => ({
        ...n,
        lines: n.lines.map((l) => ({ ...l, quantity: Number(l.quantity) })),
      })),
    }));
  } catch (error) {
    logger.error('Error al obtener remitos aceptados por cliente', {
      data: { error: error instanceof Error ? error.message : String(error) },
    });
    throw new Error('Error al obtener remitos aceptados');
  }
}

export type AcceptedDeliveryNotesByCustomer = Awaited<
  ReturnType<typeof getAcceptedDeliveryNotesByCustomer>
>;

// ============================================
// FACET COUNTS
// ============================================

export async function getDeliveryNoteFacetCounts() {
  await checkPermission('commercial.delivery-notes', 'view', { redirect: true });
  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  const statusCounts = await prisma.deliveryNote.groupBy({
    by: ['status'],
    where: { companyId },
    _count: { status: true },
  });

  return {
    status: Object.fromEntries(statusCounts.map((s) => [s.status, s._count.status])),
  };
}

// ============================================
// TIPOS INFERIDOS
// ============================================

export type DeliveryNoteListItem = Awaited<
  ReturnType<typeof getDeliveryNotesPaginated>
>['data'][number];

export type DeliveryNoteDetail = Awaited<
  ReturnType<typeof getDeliveryNoteById>
>;
