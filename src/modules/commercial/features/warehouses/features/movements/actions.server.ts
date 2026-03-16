'use server';

import { auth } from '@clerk/nextjs/server';
import { prisma } from '@/shared/lib/prisma';
import { logger } from '@/shared/lib/logger';
import { getActiveCompanyId } from '@/shared/lib/company';
import { stockAdjustmentSchema, stockTransferSchema } from '../../shared/validators';
import { revalidatePath } from 'next/cache';
import { Prisma } from '@/generated/prisma/client';
import { checkPermission } from '@/shared/lib/permissions';

// ============================================
// QUERIES PARA FORMULARIOS
// ============================================

/**
 * Obtiene almacenes activos para select
 */
export async function getWarehousesForSelect() {
  const companyId = await getActiveCompanyId();
  if (!companyId) return [];

  try {
    return await prisma.warehouse.findMany({
      where: {
        companyId,
        isActive: true,
      },
      select: {
        id: true,
        name: true,
      },
      orderBy: { name: 'asc' },
    });
  } catch (error) {
    logger.error('Error al obtener almacenes para select', { data: { error } });
    return [];
  }
}

/**
 * Obtiene productos con control de stock para select
 */
export async function getStockProductsForSelect() {
  const companyId = await getActiveCompanyId();
  if (!companyId) return [];

  try {
    return await prisma.product.findMany({
      where: {
        companyId,
        status: 'ACTIVE',
        trackStock: true, // Solo productos con control de stock
      },
      select: {
        id: true,
        code: true,
        name: true,
        trackStock: true,
      },
      orderBy: [{ code: 'asc' }, { name: 'asc' }],
    });
  } catch (error) {
    logger.error('Error al obtener productos para select', { data: { error } });
    return [];
  }
}

// ============================================
// AJUSTE DE STOCK (Entrada/Salida Manual)
// ============================================

export async function createStockAdjustment(data: unknown) {
  await checkPermission('commercial.movements', 'create', { redirect: true });
  const { userId: authUserId } = await auth();
  if (!authUserId) throw new Error('No autenticado');
  const userId = authUserId;

  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    // Validar datos
    const validatedData = stockAdjustmentSchema.parse(data);
    const quantity = parseFloat(validatedData.quantity);

    // Verificar que el almacén existe
    const warehouse = await prisma.warehouse.findFirst({
      where: {
        id: validatedData.warehouseId,
        companyId,
        isActive: true,
      },
    });

    if (!warehouse) {
      throw new Error('Almacén no encontrado o inactivo');
    }

    // Verificar que el producto existe
    const product = await prisma.product.findFirst({
      where: {
        id: validatedData.productId,
        companyId,
        status: 'ACTIVE',
      },
      select: {
        id: true,
        code: true,
        name: true,
        trackStock: true,
      },
    });

    if (!product) {
      throw new Error('Producto no encontrado o inactivo');
    }

    if (!product.trackStock) {
      throw new Error('Este producto no tiene control de stock habilitado');
    }

    // Para EXIT y LOSS, verificar que hay stock suficiente
    if ((validatedData.reason === 'EXIT' || validatedData.reason === 'LOSS') && quantity > 0) {
      const warehouseStock = await prisma.warehouseStock.findUnique({
        where: {
          warehouseId_productId: {
            warehouseId: warehouse.id,
            productId: product.id,
          },
        },
      });

      const currentStock = warehouseStock?.quantity || new Prisma.Decimal(0);

      if (currentStock.lessThan(quantity)) {
        throw new Error(
          `Stock insuficiente. Disponible: ${currentStock}, Requerido: ${quantity}`
        );
      }
    }

    // Determinar tipo de movimiento y cantidad con signo
    let movementType: 'ADJUSTMENT' | 'LOSS';
    let signedQuantity: Prisma.Decimal;

    if (validatedData.reason === 'LOSS') {
      movementType = 'LOSS';
      signedQuantity = new Prisma.Decimal(-Math.abs(quantity)); // Siempre negativo
    } else {
      movementType = 'ADJUSTMENT';
      // ENTRY = positivo, EXIT = negativo
      signedQuantity = validatedData.reason === 'ENTRY'
        ? new Prisma.Decimal(Math.abs(quantity))
        : new Prisma.Decimal(-Math.abs(quantity));
    }

    // Crear movimiento en transacción
    const result = await prisma.$transaction(async (tx) => {
      // Crear movimiento
      const movement = await tx.stockMovement.create({
        data: {
          companyId,
          warehouseId: warehouse.id,
          productId: product.id,
          type: movementType,
          quantity: signedQuantity,
          referenceType: validatedData.reason.toLowerCase(),
          notes: validatedData.notes,
          date: validatedData.date,
          createdBy: userId,
        },
        include: {
          warehouse: true,
          product: true,
        },
      });

      // Actualizar stock (quantity y availableQty)
      await tx.warehouseStock.upsert({
        where: {
          warehouseId_productId: {
            warehouseId: warehouse.id,
            productId: product.id,
          },
        },
        update: {
          quantity: {
            increment: signedQuantity,
          },
          availableQty: {
            increment: signedQuantity,
          },
        },
        create: {
          warehouseId: warehouse.id,
          productId: product.id,
          quantity: signedQuantity,
          reservedQty: 0,
          availableQty: signedQuantity,
        },
      });

      return movement;
    });

    logger.info('Ajuste de stock creado', {
      data: {
        movementId: result.id,
        reason: validatedData.reason,
        quantity: signedQuantity.toString(),
        companyId,
        userId,
      },
    });

    revalidatePath('/dashboard/commercial/stock');
    revalidatePath('/dashboard/commercial/movements');
    return { success: true };
  } catch (error) {
    logger.error('Error al crear ajuste de stock', {
      data: { companyId, error },
    });

    if (error instanceof Error) {
      throw error;
    }

    throw new Error('Error al crear el ajuste de stock');
  }
}

// ============================================
// TRANSFERENCIA ENTRE ALMACENES
// ============================================

export async function createStockTransfer(data: unknown) {
  await checkPermission('commercial.movements', 'create', { redirect: true });
  const { userId: authUserId } = await auth();
  if (!authUserId) throw new Error('No autenticado');
  const userId = authUserId;

  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    // Validar datos
    const validatedData = stockTransferSchema.parse(data);
    const quantity = new Prisma.Decimal(validatedData.quantity);

    // Verificar almacén de origen
    const sourceWarehouse = await prisma.warehouse.findFirst({
      where: {
        id: validatedData.sourceWarehouseId,
        companyId,
        isActive: true,
      },
    });

    if (!sourceWarehouse) {
      throw new Error('Almacén de origen no encontrado o inactivo');
    }

    // Verificar almacén de destino
    const destinationWarehouse = await prisma.warehouse.findFirst({
      where: {
        id: validatedData.destinationWarehouseId,
        companyId,
        isActive: true,
      },
    });

    if (!destinationWarehouse) {
      throw new Error('Almacén de destino no encontrado o inactivo');
    }

    // Verificar producto
    const product = await prisma.product.findFirst({
      where: {
        id: validatedData.productId,
        companyId,
        status: 'ACTIVE',
      },
      select: {
        id: true,
        code: true,
        name: true,
        trackStock: true,
      },
    });

    if (!product) {
      throw new Error('Producto no encontrado o inactivo');
    }

    if (!product.trackStock) {
      throw new Error('Este producto no tiene control de stock habilitado');
    }

    // Verificar stock en almacén de origen
    const sourceStock = await prisma.warehouseStock.findUnique({
      where: {
        warehouseId_productId: {
          warehouseId: sourceWarehouse.id,
          productId: product.id,
        },
      },
    });

    const currentStock = sourceStock?.quantity || new Prisma.Decimal(0);

    if (currentStock.lessThan(quantity)) {
      throw new Error(
        `Stock insuficiente en ${sourceWarehouse.name}. Disponible: ${currentStock}, Requerido: ${quantity}`
      );
    }

    // Crear transferencia en transacción
    const result = await prisma.$transaction(async (tx) => {
      // Crear movimiento de salida
      const outMovement = await tx.stockMovement.create({
        data: {
          companyId,
          warehouseId: sourceWarehouse.id,
          productId: product.id,
          type: 'TRANSFER_OUT',
          quantity: quantity.negated(), // Negativo para salida
          referenceType: 'transfer',
          notes: validatedData.notes || `Transferencia a ${destinationWarehouse.name}`,
          date: validatedData.date,
          createdBy: userId,
        },
      });

      // Crear movimiento de entrada
      const inMovement = await tx.stockMovement.create({
        data: {
          companyId,
          warehouseId: destinationWarehouse.id,
          productId: product.id,
          type: 'TRANSFER_IN',
          quantity: quantity, // Positivo para entrada
          referenceType: 'transfer',
          referenceId: outMovement.id, // Vincular con movimiento de salida
          notes: validatedData.notes || `Transferencia desde ${sourceWarehouse.name}`,
          date: validatedData.date,
          createdBy: userId,
        },
        include: {
          warehouse: true,
          product: true,
        },
      });

      // Actualizar stock en almacén de origen (decrementar)
      await tx.warehouseStock.upsert({
        where: {
          warehouseId_productId: {
            warehouseId: sourceWarehouse.id,
            productId: product.id,
          },
        },
        update: {
          quantity: { decrement: quantity },
          availableQty: { decrement: quantity },
        },
        create: {
          warehouseId: sourceWarehouse.id,
          productId: product.id,
          quantity: quantity.negated(),
          reservedQty: 0,
          availableQty: quantity.negated(),
        },
      });

      // Actualizar stock en almacén de destino (incrementar)
      await tx.warehouseStock.upsert({
        where: {
          warehouseId_productId: {
            warehouseId: destinationWarehouse.id,
            productId: product.id,
          },
        },
        update: {
          quantity: { increment: quantity },
          availableQty: { increment: quantity },
        },
        create: {
          warehouseId: destinationWarehouse.id,
          productId: product.id,
          quantity: quantity,
          reservedQty: 0,
          availableQty: quantity,
        },
      });

      return inMovement;
    });

    logger.info('Transferencia de stock creada', {
      data: {
        movementId: result.id,
        from: sourceWarehouse.name,
        to: destinationWarehouse.name,
        quantity: quantity.toString(),
        companyId,
        userId,
      },
    });

    revalidatePath('/dashboard/commercial/stock');
    revalidatePath('/dashboard/commercial/movements');
    return { success: true };
  } catch (error) {
    logger.error('Error al crear transferencia de stock', {
      data: { companyId, error },
    });

    if (error instanceof Error) {
      throw error;
    }

    throw new Error('Error al crear la transferencia');
  }
}
