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
import type { ReceivingNoteFormInput } from '../shared/validators';
import moment from 'moment';

// ============================================
// QUERIES
// ============================================

/**
 * Obtiene remitos de recepción con paginación server-side para DataTable
 */
export async function getReceivingNotesPaginated(searchParams: DataTableSearchParams) {
  await checkPermission('commercial.receiving-notes', 'view', { redirect: true });
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

    const filtersWhere = buildFiltersWhere(parsed.filters, {}, { exclude: ['receptionDate'] });
    const dateFiltersWhere = buildDateRangeFiltersWhere(parsed.filters, ['receptionDate']);

    const where = {
      companyId,
      ...searchWhere,
      ...filtersWhere,
      ...dateFiltersWhere,
    };

    const [notes, total] = await Promise.all([
      prisma.receivingNote.findMany({
        where,
        skip,
        take,
        orderBy: orderBy || { receptionDate: 'desc' },
        include: {
          supplier: {
            select: {
              businessName: true,
              tradeName: true,
              taxId: true,
            },
          },
          warehouse: {
            select: {
              name: true,
            },
          },
          purchaseOrder: {
            select: {
              fullNumber: true,
            },
          },
          purchaseInvoice: {
            select: {
              fullNumber: true,
            },
          },
        },
      }),
      prisma.receivingNote.count({ where }),
    ]);

    return { data: notes, total };
  } catch (error) {
    logger.error('Error al obtener remitos de recepción', {
      data: { error: error instanceof Error ? error.message : String(error), companyId },
    });
    throw new Error('Error al obtener remitos de recepción');
  }
}

/**
 * Obtiene un remito de recepción por ID con todos sus detalles
 */
export async function getReceivingNoteById(id: string) {
  await checkPermission('commercial.receiving-notes', 'view', { redirect: true });
  const { userId } = await auth();
  if (!userId) throw new Error('No autenticado');

  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    const note = await prisma.receivingNote.findUnique({
      where: { id },
      include: {
        supplier: {
          select: {
            id: true,
            businessName: true,
            tradeName: true,
            taxId: true,
            address: true,
            phone: true,
            email: true,
          },
        },
        warehouse: {
          select: {
            id: true,
            name: true,
          },
        },
        purchaseOrder: {
          select: {
            id: true,
            fullNumber: true,
            status: true,
          },
        },
        purchaseInvoice: {
          select: {
            id: true,
            fullNumber: true,
            status: true,
          },
        },
        lines: {
          include: {
            product: {
              select: {
                code: true,
                name: true,
                unitOfMeasure: true,
                trackStock: true,
              },
            },
            purchaseOrderLine: {
              select: {
                id: true,
                quantity: true,
                receivedQty: true,
                description: true,
              },
            },
          },
        },
      },
    });

    if (!note || note.companyId !== companyId) {
      throw new Error('Remito de recepción no encontrado');
    }

    return {
      ...note,
      lines: note.lines.map((line) => ({
        ...line,
        quantity: Number(line.quantity),
        purchaseOrderLine: line.purchaseOrderLine
          ? {
              ...line.purchaseOrderLine,
              quantity: Number(line.purchaseOrderLine.quantity),
              receivedQty: Number(line.purchaseOrderLine.receivedQty),
            }
          : null,
      })),
    };
  } catch (error) {
    logger.error('Error al obtener remito de recepción', {
      data: { error, id, companyId },
    });
    throw error;
  }
}

/**
 * Obtiene almacenes activos para select
 */
export async function getWarehousesForSelect() {
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

/**
 * Obtiene proveedores activos para select
 */
export async function getSuppliersForSelect() {
  const companyId = await getActiveCompanyId();
  if (!companyId) return [];

  try {
    return await prisma.supplier.findMany({
      where: { companyId, status: 'ACTIVE' },
      select: {
        id: true,
        businessName: true,
        tradeName: true,
        taxId: true,
      },
      orderBy: { businessName: 'asc' },
    });
  } catch (error) {
    logger.error('Error al obtener proveedores', { data: { error } });
    return [];
  }
}

/**
 * Obtiene OCs aprobadas/parcialmente recibidas del proveedor para asociar a remito
 */
export async function getApprovedPurchaseOrdersForSupplier(supplierId: string) {
  await checkPermission('commercial.receiving-notes', 'view', { redirect: true });
  const companyId = await getActiveCompanyId();
  if (!companyId) return [];

  try {
    const orders = await prisma.purchaseOrder.findMany({
      where: {
        companyId,
        supplierId,
        status: { in: ['APPROVED', 'PARTIALLY_RECEIVED'] },
      },
      select: {
        id: true,
        fullNumber: true,
        issueDate: true,
        total: true,
      },
      orderBy: { issueDate: 'desc' },
    });

    return orders.map((o) => ({
      ...o,
      total: Number(o.total),
    }));
  } catch (error) {
    logger.error('Error al obtener OCs para remito', { data: { error } });
    return [];
  }
}

/**
 * Obtiene líneas de una OC con cantidad pendiente de recibir
 */
export async function getPurchaseOrderLinesForReceiving(orderId: string) {
  await checkPermission('commercial.receiving-notes', 'view', { redirect: true });
  const companyId = await getActiveCompanyId();
  if (!companyId) return [];

  try {
    const lines = await prisma.purchaseOrderLine.findMany({
      where: {
        orderId,
        order: { companyId },
      },
      include: {
        product: {
          select: {
            id: true,
            code: true,
            name: true,
            unitOfMeasure: true,
            trackStock: true,
          },
        },
      },
      orderBy: { id: 'asc' },
    });

    return lines
      .filter((line) => line.product && line.product.trackStock)
      .map((line) => {
        const qty = Number(line.quantity);
        const received = Number(line.receivedQty);
        const pending = Math.max(0, qty - received);

        return {
          id: line.id,
          productId: line.productId!,
          description: line.description,
          quantity: qty,
          receivedQty: received,
          pendingQty: pending,
          product: line.product!,
        };
      })
      .filter((line) => line.pendingQty > 0);
  } catch (error) {
    logger.error('Error al obtener líneas de OC para remito', { data: { error } });
    return [];
  }
}

/**
 * Obtiene FCs confirmadas del proveedor para asociar a remito
 */
export async function getConfirmedPurchaseInvoicesForSupplier(supplierId: string) {
  await checkPermission('commercial.receiving-notes', 'view', { redirect: true });
  const companyId = await getActiveCompanyId();
  if (!companyId) return [];

  try {
    const invoices = await prisma.purchaseInvoice.findMany({
      where: {
        companyId,
        supplierId,
        status: 'CONFIRMED',
      },
      select: {
        id: true,
        fullNumber: true,
        issueDate: true,
        total: true,
        lines: {
          select: {
            id: true,
            productId: true,
            description: true,
            quantity: true,
            product: {
              select: {
                id: true,
                code: true,
                name: true,
                unitOfMeasure: true,
                trackStock: true,
              },
            },
          },
        },
        // Incluir remitos confirmados para calcular cantidades pendientes
        receivingNotes: {
          where: { status: 'CONFIRMED' },
          select: {
            lines: {
              select: {
                productId: true,
                quantity: true,
              },
            },
          },
        },
      },
      orderBy: { issueDate: 'desc' },
    });

    return invoices.map((inv) => {
      // Sumar cantidades ya recibidas por producto
      const receivedByProduct = new Map<string, number>();
      for (const rn of inv.receivingNotes) {
        for (const rnLine of rn.lines) {
          const current = receivedByProduct.get(rnLine.productId) ?? 0;
          receivedByProduct.set(rnLine.productId, current + Number(rnLine.quantity));
        }
      }

      return {
        ...inv,
        total: Number(inv.total),
        lines: inv.lines
          .filter((line) => line.product && line.product.trackStock)
          .map((line) => {
            const invoicedQty = Number(line.quantity);
            const receivedQty = receivedByProduct.get(line.productId!) ?? 0;
            const pendingQty = Math.max(0, invoicedQty - receivedQty);

            return {
              ...line,
              quantity: invoicedQty,
              receivedQty,
              pendingQty,
              product: line.product!,
            };
          }),
      };
    });
  } catch (error) {
    logger.error('Error al obtener FCs para remito', { data: { error } });
    return [];
  }
}

/**
 * Obtiene productos activos con trackStock para remitos sueltos
 */
export async function getProductsForSelect() {
  const companyId = await getActiveCompanyId();
  if (!companyId) return [];

  try {
    const products = await prisma.product.findMany({
      where: { companyId, status: 'ACTIVE', trackStock: true },
      select: {
        id: true,
        code: true,
        name: true,
        unitOfMeasure: true,
      },
      orderBy: { name: 'asc' },
    });
    return products;
  } catch (error) {
    logger.error('Error al obtener productos', { data: { error } });
    return [];
  }
}

// ============================================
// MUTATIONS
// ============================================

/**
 * Crea un nuevo remito de recepción en estado DRAFT
 */
export async function createReceivingNote(input: ReceivingNoteFormInput) {
  await checkPermission('commercial.receiving-notes', 'create', { redirect: true });
  const { userId } = await auth();
  if (!userId) throw new Error('No autenticado');

  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    const lastNote = await prisma.receivingNote.findFirst({
      where: { companyId },
      orderBy: { number: 'desc' },
      select: { number: true },
    });

    const nextNumber = (lastNote?.number ?? 0) + 1;
    const fullNumber = `RR-${String(nextNumber).padStart(5, '0')}`;

    const note = await prisma.receivingNote.create({
      data: {
        companyId,
        supplierId: input.supplierId,
        warehouseId: input.warehouseId,
        number: nextNumber,
        fullNumber,
        purchaseOrderId: input.purchaseOrderId || null,
        purchaseInvoiceId: input.purchaseInvoiceId || null,
        receptionDate: moment.utc(input.receptionDate).toDate(),
        notes: input.notes || null,
        createdBy: userId,
        lines: {
          create: input.lines.map((line) => ({
            productId: line.productId,
            description: line.description,
            quantity: new Prisma.Decimal(line.quantity),
            purchaseOrderLineId: line.purchaseOrderLineId || null,
            notes: line.notes || null,
          })),
        },
      },
      select: { id: true, fullNumber: true },
    });

    logger.info('Remito de recepción creado', {
      data: { id: note.id, fullNumber: note.fullNumber, companyId, userId },
    });

    revalidatePath('/dashboard/commercial/receiving-notes');
    return note;
  } catch (error) {
    logger.error('Error al crear remito de recepción', {
      data: { error: error instanceof Error ? error.message : String(error), companyId },
    });
    throw new Error('Error al crear el remito de recepción');
  }
}

/**
 * Actualiza un remito de recepción (solo en DRAFT)
 */
export async function updateReceivingNote(id: string, input: ReceivingNoteFormInput) {
  await checkPermission('commercial.receiving-notes', 'update', { redirect: true });
  const { userId } = await auth();
  if (!userId) throw new Error('No autenticado');

  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    const existing = await prisma.receivingNote.findUnique({
      where: { id },
      select: { companyId: true, status: true },
    });

    if (!existing || existing.companyId !== companyId) {
      throw new Error('Remito no encontrado');
    }
    if (existing.status !== 'DRAFT') {
      throw new Error('Solo se pueden editar remitos en borrador');
    }

    await prisma.$transaction(async (tx) => {
      // Eliminar líneas existentes
      await tx.receivingNoteLine.deleteMany({ where: { receivingNoteId: id } });

      // Actualizar remito y crear nuevas líneas
      await tx.receivingNote.update({
        where: { id },
        data: {
          supplierId: input.supplierId,
          warehouseId: input.warehouseId,
          purchaseOrderId: input.purchaseOrderId || null,
          purchaseInvoiceId: input.purchaseInvoiceId || null,
          receptionDate: moment.utc(input.receptionDate).toDate(),
          notes: input.notes || null,
          lines: {
            create: input.lines.map((line) => ({
              productId: line.productId,
              description: line.description,
              quantity: new Prisma.Decimal(line.quantity),
              purchaseOrderLineId: line.purchaseOrderLineId || null,
              notes: line.notes || null,
            })),
          },
        },
      });
    });

    logger.info('Remito de recepción actualizado', {
      data: { id, companyId, userId },
    });

    revalidatePath('/dashboard/commercial/receiving-notes');
    revalidatePath(`/dashboard/commercial/receiving-notes/${id}`);
  } catch (error) {
    logger.error('Error al actualizar remito', {
      data: { error: error instanceof Error ? error.message : String(error), id },
    });
    throw new Error(error instanceof Error ? error.message : 'Error al actualizar el remito');
  }
}

/**
 * Elimina un remito de recepción (solo en DRAFT)
 */
export async function deleteReceivingNote(id: string) {
  await checkPermission('commercial.receiving-notes', 'delete', { redirect: true });
  const { userId } = await auth();
  if (!userId) throw new Error('No autenticado');

  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    const existing = await prisma.receivingNote.findUnique({
      where: { id },
      select: { companyId: true, status: true },
    });

    if (!existing || existing.companyId !== companyId) {
      throw new Error('Remito no encontrado');
    }
    if (existing.status !== 'DRAFT') {
      throw new Error('Solo se pueden eliminar remitos en borrador');
    }

    await prisma.receivingNote.delete({ where: { id } });

    logger.info('Remito de recepción eliminado', {
      data: { id, companyId, userId },
    });

    revalidatePath('/dashboard/commercial/receiving-notes');
  } catch (error) {
    logger.error('Error al eliminar remito', {
      data: { error: error instanceof Error ? error.message : String(error), id },
    });
    throw new Error(error instanceof Error ? error.message : 'Error al eliminar el remito');
  }
}

/**
 * Confirma un remito de recepción: crea movimientos de stock e incrementa receivedQty en OC
 */
export async function confirmReceivingNote(id: string) {
  await checkPermission('commercial.receiving-notes', 'approve', { redirect: true });
  const { userId } = await auth();
  if (!userId) throw new Error('No autenticado');

  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    const note = await prisma.receivingNote.findUnique({
      where: { id },
      include: {
        lines: {
          include: {
            product: { select: { trackStock: true } },
          },
        },
      },
    });

    if (!note || note.companyId !== companyId) {
      throw new Error('Remito no encontrado');
    }
    if (note.status !== 'DRAFT') {
      throw new Error('Solo se pueden confirmar remitos en borrador');
    }
    if (note.lines.length === 0) {
      throw new Error('El remito debe tener al menos una línea');
    }

    await prisma.$transaction(async (tx) => {
      // 1. Actualizar estado
      await tx.receivingNote.update({
        where: { id },
        data: { status: 'CONFIRMED' },
      });

      // 2. Crear movimientos de stock y actualizar warehouse stock
      for (const line of note.lines) {
        if (!line.product?.trackStock) continue;

        // Crear movimiento de stock
        await tx.stockMovement.create({
          data: {
            companyId,
            warehouseId: note.warehouseId,
            productId: line.productId,
            type: 'PURCHASE',
            quantity: line.quantity,
            referenceType: 'receiving_note',
            referenceId: note.id,
            notes: `Recepción ${note.fullNumber} - ${line.description}`,
            date: note.receptionDate,
            createdBy: userId,
          },
        });

        // Actualizar stock del almacén
        await tx.warehouseStock.upsert({
          where: {
            warehouseId_productId: {
              warehouseId: note.warehouseId,
              productId: line.productId,
            },
          },
          create: {
            warehouseId: note.warehouseId,
            productId: line.productId,
            quantity: line.quantity,
            reservedQty: 0,
            availableQty: line.quantity,
          },
          update: {
            quantity: { increment: line.quantity },
            availableQty: { increment: line.quantity },
          },
        });

        // 3. Actualizar receivedQty en línea de OC si aplica
        if (line.purchaseOrderLineId) {
          await tx.purchaseOrderLine.update({
            where: { id: line.purchaseOrderLineId },
            data: {
              receivedQty: { increment: line.quantity },
            },
          });
        }
      }

      // 4. Actualizar estado de la OC si aplica
      if (note.purchaseOrderId) {
        await updatePurchaseOrderStatus(tx, note.purchaseOrderId);
      }
    });

    logger.info('Remito de recepción confirmado', {
      data: { id, fullNumber: note.fullNumber, companyId, userId },
    });

    revalidatePath('/dashboard/commercial/receiving-notes');
    revalidatePath(`/dashboard/commercial/receiving-notes/${id}`);
    if (note.purchaseOrderId) {
      revalidatePath(`/dashboard/commercial/purchase-orders/${note.purchaseOrderId}`);
    }
  } catch (error) {
    logger.error('Error al confirmar remito', {
      data: { error: error instanceof Error ? error.message : String(error), id },
    });
    throw new Error(error instanceof Error ? error.message : 'Error al confirmar el remito');
  }
}

/**
 * Cancela un remito confirmado: revierte movimientos de stock y receivedQty
 */
export async function cancelReceivingNote(id: string) {
  await checkPermission('commercial.receiving-notes', 'delete', { redirect: true });
  const { userId } = await auth();
  if (!userId) throw new Error('No autenticado');

  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    const note = await prisma.receivingNote.findUnique({
      where: { id },
      include: {
        lines: {
          include: {
            product: { select: { trackStock: true } },
          },
        },
      },
    });

    if (!note || note.companyId !== companyId) {
      throw new Error('Remito no encontrado');
    }
    if (note.status !== 'CONFIRMED') {
      throw new Error('Solo se pueden anular remitos confirmados');
    }

    await prisma.$transaction(async (tx) => {
      // 1. Verificar stock suficiente para revertir
      for (const line of note.lines) {
        if (!line.product?.trackStock) continue;

        const stock = await tx.warehouseStock.findUnique({
          where: {
            warehouseId_productId: {
              warehouseId: note.warehouseId,
              productId: line.productId,
            },
          },
        });

        if (!stock || Number(stock.quantity) < Number(line.quantity)) {
          throw new Error(
            `Stock insuficiente para revertir ${line.description}. Disponible: ${stock ? Number(stock.quantity) : 0}, Requerido: ${Number(line.quantity)}`
          );
        }
      }

      // 2. Actualizar estado
      await tx.receivingNote.update({
        where: { id },
        data: { status: 'CANCELLED' },
      });

      // 3. Crear movimientos de stock reversos
      for (const line of note.lines) {
        if (!line.product?.trackStock) continue;

        await tx.stockMovement.create({
          data: {
            companyId,
            warehouseId: note.warehouseId,
            productId: line.productId,
            type: 'ADJUSTMENT',
            quantity: new Prisma.Decimal(Number(line.quantity) * -1),
            referenceType: 'receiving_note_cancellation',
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
            quantity: { decrement: line.quantity },
            availableQty: { decrement: line.quantity },
          },
        });

        // 4. Revertir receivedQty en línea de OC
        if (line.purchaseOrderLineId) {
          await tx.purchaseOrderLine.update({
            where: { id: line.purchaseOrderLineId },
            data: {
              receivedQty: { decrement: line.quantity },
            },
          });
        }
      }

      // 5. Re-evaluar estado de la OC
      if (note.purchaseOrderId) {
        await updatePurchaseOrderStatus(tx, note.purchaseOrderId);
      }
    });

    logger.info('Remito de recepción anulado', {
      data: { id, fullNumber: note.fullNumber, companyId, userId },
    });

    revalidatePath('/dashboard/commercial/receiving-notes');
    revalidatePath(`/dashboard/commercial/receiving-notes/${id}`);
    if (note.purchaseOrderId) {
      revalidatePath(`/dashboard/commercial/purchase-orders/${note.purchaseOrderId}`);
    }
  } catch (error) {
    logger.error('Error al anular remito', {
      data: { error: error instanceof Error ? error.message : String(error), id },
    });
    throw new Error(error instanceof Error ? error.message : 'Error al anular el remito');
  }
}

// ============================================
// HELPERS
// ============================================

/**
 * Evalúa y actualiza el estado de una OC según las cantidades recibidas
 */
async function updatePurchaseOrderStatus(
  tx: Prisma.TransactionClient,
  purchaseOrderId: string
) {
  const poLines = await tx.purchaseOrderLine.findMany({
    where: { orderId: purchaseOrderId },
    select: { quantity: true, receivedQty: true },
  });

  const allFullyReceived = poLines.every(
    (line) => Number(line.receivedQty) >= Number(line.quantity)
  );
  const anyPartiallyReceived = poLines.some(
    (line) => Number(line.receivedQty) > 0
  );

  let newStatus: 'APPROVED' | 'PARTIALLY_RECEIVED' | 'COMPLETED';
  if (allFullyReceived) {
    newStatus = 'COMPLETED';
  } else if (anyPartiallyReceived) {
    newStatus = 'PARTIALLY_RECEIVED';
  } else {
    newStatus = 'APPROVED';
  }

  await tx.purchaseOrder.update({
    where: { id: purchaseOrderId },
    data: { status: newStatus },
  });
}

// ============================================
// TIPOS INFERIDOS
// ============================================

export type ReceivingNoteListItem = Awaited<
  ReturnType<typeof getReceivingNotesPaginated>
>['data'][number];

export type ReceivingNoteDetail = Awaited<
  ReturnType<typeof getReceivingNoteById>
>;

export type SupplierSelectItem = Awaited<
  ReturnType<typeof getSuppliersForSelect>
>[number];

export type WarehouseSelectItem = Awaited<
  ReturnType<typeof getWarehousesForSelect>
>[number];
