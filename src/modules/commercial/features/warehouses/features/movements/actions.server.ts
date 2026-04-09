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
    const validatedData = stockTransferSchema.parse(data);

    // Verificar almacenes
    const [sourceWarehouse, destinationWarehouse] = await Promise.all([
      prisma.warehouse.findFirst({
        where: { id: validatedData.sourceWarehouseId, companyId, isActive: true },
        select: { id: true, name: true },
      }),
      prisma.warehouse.findFirst({
        where: { id: validatedData.destinationWarehouseId, companyId, isActive: true },
        select: { id: true, name: true },
      }),
    ]);

    if (!sourceWarehouse) throw new Error('Almacén de origen no encontrado o inactivo');
    if (!destinationWarehouse) throw new Error('Almacén de destino no encontrado o inactivo');

    // Verificar todos los productos
    const productIds = validatedData.lines.map((l) => l.productId);
    const products = await prisma.product.findMany({
      where: { id: { in: productIds }, companyId, status: 'ACTIVE' },
      select: { id: true, code: true, name: true, trackStock: true },
    });

    const productMap = new Map(products.map((p) => [p.id, p]));
    for (const line of validatedData.lines) {
      const product = productMap.get(line.productId);
      if (!product) throw new Error(`Producto no encontrado o inactivo`);
      if (!product.trackStock) throw new Error(`El producto "${product.name}" no tiene control de stock habilitado`);
    }

    // Verificar stock disponible para cada producto
    const sourceStocks = await prisma.warehouseStock.findMany({
      where: {
        warehouseId: sourceWarehouse.id,
        productId: { in: productIds },
      },
    });
    const stockMap = new Map(sourceStocks.map((s) => [s.productId, s]));

    for (const line of validatedData.lines) {
      const quantity = new Prisma.Decimal(line.quantity);
      const stock = stockMap.get(line.productId);
      const available = stock?.quantity || new Prisma.Decimal(0);
      const product = productMap.get(line.productId)!;
      if (available.lessThan(quantity)) {
        throw new Error(
          `Stock insuficiente de "${product.name}" en ${sourceWarehouse.name}. Disponible: ${available}, Requerido: ${quantity}`
        );
      }
    }

    // Generar número de transferencia
    const lastTransfer = await prisma.stockTransfer.findFirst({
      where: { companyId },
      orderBy: { createdAt: 'desc' },
      select: { transferNumber: true },
    });
    const lastNum = lastTransfer ? parseInt(lastTransfer.transferNumber.replace('TR-', ''), 10) : 0;
    const transferNumber = `TR-${String(lastNum + 1).padStart(5, '0')}`;

    // Crear transferencia en transacción
    const transfer = await prisma.$transaction(async (tx) => {
      // Crear header
      const stockTransfer = await tx.stockTransfer.create({
        data: {
          companyId,
          transferNumber,
          sourceWarehouseId: sourceWarehouse.id,
          destinationWarehouseId: destinationWarehouse.id,
          date: validatedData.date,
          notes: validatedData.notes || null,
          createdBy: userId,
          lines: {
            create: validatedData.lines.map((line) => ({
              productId: line.productId,
              quantity: new Prisma.Decimal(line.quantity),
            })),
          },
        },
      });

      // Crear movimientos de stock y actualizar cantidades por cada línea
      for (const line of validatedData.lines) {
        const quantity = new Prisma.Decimal(line.quantity);
        const product = productMap.get(line.productId)!;

        // Movimiento de salida
        const outMovement = await tx.stockMovement.create({
          data: {
            companyId,
            warehouseId: sourceWarehouse.id,
            productId: line.productId,
            type: 'TRANSFER_OUT',
            quantity: quantity.negated(),
            referenceType: 'transfer',
            referenceId: stockTransfer.id,
            notes: `${transferNumber} → ${destinationWarehouse.name} (${product.code})`,
            date: validatedData.date,
            createdBy: userId,
          },
        });

        // Movimiento de entrada
        await tx.stockMovement.create({
          data: {
            companyId,
            warehouseId: destinationWarehouse.id,
            productId: line.productId,
            type: 'TRANSFER_IN',
            quantity,
            referenceType: 'transfer',
            referenceId: stockTransfer.id,
            notes: `${transferNumber} ← ${sourceWarehouse.name} (${product.code})`,
            date: validatedData.date,
            createdBy: userId,
          },
        });

        // Actualizar stock origen (decrementar)
        await tx.warehouseStock.upsert({
          where: { warehouseId_productId: { warehouseId: sourceWarehouse.id, productId: line.productId } },
          update: { quantity: { decrement: quantity }, availableQty: { decrement: quantity } },
          create: { warehouseId: sourceWarehouse.id, productId: line.productId, quantity: quantity.negated(), reservedQty: 0, availableQty: quantity.negated() },
        });

        // Actualizar stock destino (incrementar)
        await tx.warehouseStock.upsert({
          where: { warehouseId_productId: { warehouseId: destinationWarehouse.id, productId: line.productId } },
          update: { quantity: { increment: quantity }, availableQty: { increment: quantity } },
          create: { warehouseId: destinationWarehouse.id, productId: line.productId, quantity, reservedQty: 0, availableQty: quantity },
        });
      }

      return stockTransfer;
    });

    logger.info('Transferencia de stock creada', {
      data: {
        transferId: transfer.id,
        transferNumber,
        from: sourceWarehouse.name,
        to: destinationWarehouse.name,
        lineCount: validatedData.lines.length,
        companyId,
        userId,
      },
    });

    revalidatePath('/dashboard/commercial/stock');
    revalidatePath('/dashboard/commercial/movements');
    return { success: true, id: transfer.id, transferNumber };
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

// Obtener transferencia por ID (para PDF)
export async function getStockTransfer(id: string) {
  await checkPermission('commercial.movements', 'view', { redirect: true });
  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  const transfer = await prisma.stockTransfer.findFirst({
    where: { id, companyId },
    include: {
      sourceWarehouse: { select: { code: true, name: true } },
      destinationWarehouse: { select: { code: true, name: true } },
      lines: {
        include: {
          product: { select: { code: true, name: true, unitOfMeasure: true } },
        },
      },
    },
  });

  if (!transfer) throw new Error('Transferencia no encontrada');

  return {
    ...transfer,
    lines: transfer.lines.map((line) => ({
      ...line,
      quantity: Number(line.quantity),
    })),
  };
}
