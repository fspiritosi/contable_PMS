'use server';

import { auth } from '@clerk/nextjs/server';
import { revalidatePath } from 'next/cache';
import { Prisma } from '@/generated/prisma/client';
import { prisma } from '@/shared/lib/prisma';
import { logger } from '@/shared/lib/logger';
import { getActiveCompanyId } from '@/shared/lib/company';
import { checkPermission } from '@/shared/lib/permissions';
import type { DataTableSearchParams } from '@/shared/components/common/DataTable';
import { parseSearchParams, stateToPrismaParams, buildFiltersWhere } from '@/shared/components/common/DataTable/helpers';
import {
  createWarehouseSchema,
  updateWarehouseSchema,
  createStockMovementSchema,
  setStockQuantitySchema,
  directStockTransferSchema,
  type CreateWarehouseFormData,
  type UpdateWarehouseFormData,
  type CreateStockMovementFormData,
  type SetStockQuantityFormData,
  type DirectStockTransferFormData,
} from '../../shared/validators';
import type { Warehouse, WarehouseStock, StockMovement } from '../../shared/types';

// ============================================
// Warehouses CRUD
// ============================================

interface GetWarehousesParams {
  page?: number;
  pageSize?: number;
  search?: string;
  isActive?: boolean;
  filters?: Record<string, string[]>;
}

export async function getWarehouses(params: GetWarehousesParams = {}) {
  await checkPermission('commercial.warehouses', 'view', { redirect: true });
  const { page = 1, pageSize = 10, search, isActive, filters = {} } = params;
  const { userId } = await auth();
  if (!userId) {
    throw new Error('No autenticado');
  }

  const companyId = await getActiveCompanyId();
  if (!companyId) {
    throw new Error('No se encontró empresa activa');
  }

  try {
    // Build faceted filters, excluding isActive since it needs boolean conversion
    const facetedWhere = buildFiltersWhere(filters, {}, { exclude: ['isActive'] });

    // Handle isActive boolean filter from faceted filter (values are 'true'/'false' strings)
    let isActiveFilter: boolean | undefined = isActive;
    if (filters.isActive && filters.isActive.length > 0) {
      const val = filters.isActive[0];
      if (val === 'true') isActiveFilter = true;
      else if (val === 'false') isActiveFilter = false;
    }

    const where = {
      companyId,
      ...facetedWhere,
      ...(isActiveFilter !== undefined && { isActive: isActiveFilter }),
      ...(search && {
        OR: [
          { code: { contains: search, mode: 'insensitive' as const } },
          { name: { contains: search, mode: 'insensitive' as const } },
          { city: { contains: search, mode: 'insensitive' as const } },
        ],
      }),
    };

    const [warehouses, total] = await Promise.all([
      prisma.warehouse.findMany({
        where,
        include: {
          _count: {
            select: {
              stocks: true,
              movements: true,
            },
          },
        },
        orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.warehouse.count({ where }),
    ]);

    return {
      data: warehouses as Warehouse[],
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    };
  } catch (error) {
    logger.error('Error al obtener almacenes', { data: { error } });
    throw new Error('Error al obtener almacenes');
  }
}

export async function getWarehouseById(id: string): Promise<Warehouse> {
  await checkPermission('commercial.warehouses', 'view', { redirect: true });
  const { userId } = await auth();
  if (!userId) {
    throw new Error('No autenticado');
  }

  const companyId = await getActiveCompanyId();
  if (!companyId) {
    throw new Error('No se encontró empresa activa');
  }

  try {
    const warehouse = await prisma.warehouse.findFirst({
      where: { id, companyId },
      include: {
        _count: {
          select: {
            stocks: true,
            movements: true,
          },
        },
      },
    });

    if (!warehouse) {
      throw new Error('Almacén no encontrado');
    }

    return warehouse as Warehouse;
  } catch (error) {
    logger.error('Error al obtener almacén', { data: { error } });
    throw error instanceof Error ? error : new Error('Error al obtener almacén');
  }
}

export async function createWarehouse(data: CreateWarehouseFormData): Promise<Warehouse> {
  await checkPermission('commercial.warehouses', 'create', { redirect: true });
  const { userId } = await auth();
  if (!userId) {
    throw new Error('No autenticado');
  }

  const companyId = await getActiveCompanyId();
  if (!companyId) {
    throw new Error('No se encontró empresa activa');
  }

  const validatedData = createWarehouseSchema.parse(data);

  try {
    // Verificar código único
    const existing = await prisma.warehouse.findFirst({
      where: {
        companyId,
        code: validatedData.code,
      },
    });

    if (existing) {
      throw new Error('Ya existe un almacén con este código');
    }

    const warehouse = await prisma.warehouse.create({
      data: {
        companyId,
        code: validatedData.code,
        name: validatedData.name,
        type: validatedData.type || 'MAIN',
        address: validatedData.address,
        city: validatedData.city,
        state: validatedData.state,
        isActive: validatedData.isActive ?? true,
      },
      include: {
        _count: {
          select: {
            stocks: true,
            movements: true,
          },
        },
      },
    });

    revalidatePath('/dashboard/commercial/warehouses');
    logger.info('Almacén creado', { data: { warehouseId: warehouse.id } });

    return warehouse as Warehouse;
  } catch (error) {
    logger.error('Error al crear almacén', { data: { error } });
    if (error instanceof Error) {
      throw error;
    }
    throw new Error('Error al crear almacén');
  }
}

export async function updateWarehouse(
  id: string,
  data: UpdateWarehouseFormData
): Promise<Warehouse> {
  await checkPermission('commercial.warehouses', 'update', { redirect: true });
  const { userId } = await auth();
  if (!userId) {
    throw new Error('No autenticado');
  }

  const companyId = await getActiveCompanyId();
  if (!companyId) {
    throw new Error('No se encontró empresa activa');
  }

  const validatedData = updateWarehouseSchema.parse(data);

  try {
    const existing = await prisma.warehouse.findFirst({
      where: { id, companyId },
    });

    if (!existing) {
      throw new Error('Almacén no encontrado');
    }

    // Verificar código único si se cambia
    if (validatedData.code && validatedData.code !== existing.code) {
      const duplicate = await prisma.warehouse.findFirst({
        where: {
          companyId,
          code: validatedData.code,
          NOT: { id },
        },
      });

      if (duplicate) {
        throw new Error('Ya existe un almacén con este código');
      }
    }

    const warehouse = await prisma.warehouse.update({
      where: { id },
      data: {
        code: validatedData.code,
        name: validatedData.name,
        type: validatedData.type,
        address: validatedData.address,
        city: validatedData.city,
        state: validatedData.state,
        isActive: validatedData.isActive,
      },
      include: {
        _count: {
          select: {
            stocks: true,
            movements: true,
          },
        },
      },
    });

    revalidatePath('/dashboard/commercial/warehouses');
    logger.info('Almacén actualizado', { data: { warehouseId: id } });

    return warehouse as Warehouse;
  } catch (error) {
    logger.error('Error al actualizar almacén', { data: { error } });
    if (error instanceof Error) {
      throw error;
    }
    throw new Error('Error al actualizar almacén');
  }
}

export async function deleteWarehouse(id: string): Promise<void> {
  await checkPermission('commercial.warehouses', 'delete', { redirect: true });
  const { userId } = await auth();
  if (!userId) {
    throw new Error('No autenticado');
  }

  const companyId = await getActiveCompanyId();
  if (!companyId) {
    throw new Error('No se encontró empresa activa');
  }

  try {
    const existing = await prisma.warehouse.findFirst({
      where: { id, companyId },
      include: {
        _count: {
          select: {
            stocks: true,
            movements: true,
          },
        },
      },
    });

    if (!existing) {
      throw new Error('Almacén no encontrado');
    }

    // No permitir eliminar si tiene stock o movimientos
    if (existing._count.stocks > 0) {
      throw new Error('No se puede eliminar un almacén con stock registrado');
    }

    if (existing._count.movements > 0) {
      throw new Error('No se puede eliminar un almacén con movimientos registrados');
    }

    await prisma.warehouse.delete({
      where: { id },
    });

    revalidatePath('/dashboard/commercial/warehouses');
    logger.info('Almacén eliminado', { data: { warehouseId: id } });
  } catch (error) {
    logger.error('Error al eliminar almacén', { data: { error } });
    if (error instanceof Error) {
      throw error;
    }
    throw new Error('Error al eliminar almacén');
  }
}

export async function toggleWarehouseActive(id: string): Promise<void> {
  await checkPermission('commercial.warehouses', 'update', { redirect: true });
  const { userId } = await auth();
  if (!userId) {
    throw new Error('No autenticado');
  }

  const companyId = await getActiveCompanyId();
  if (!companyId) {
    throw new Error('No se encontró empresa activa');
  }

  try {
    const existing = await prisma.warehouse.findFirst({
      where: { id, companyId },
    });

    if (!existing) {
      throw new Error('Almacén no encontrado');
    }

    await prisma.warehouse.update({
      where: { id },
      data: { isActive: !existing.isActive },
    });

    revalidatePath('/dashboard/commercial/warehouses');
    logger.info('Estado de almacén actualizado', {
      data: { warehouseId: id, isActive: !existing.isActive },
    });
  } catch (error) {
    logger.error('Error al cambiar estado de almacén', { data: { error } });
    throw new Error('Error al cambiar estado de almacén');
  }
}

// ============================================
// Warehouse Stock
// ============================================

export async function getWarehouseStocks(warehouseId: string): Promise<WarehouseStock[]> {
  await checkPermission('commercial.stock', 'view', { redirect: true });
  const { userId } = await auth();
  if (!userId) {
    throw new Error('No autenticado');
  }

  const companyId = await getActiveCompanyId();
  if (!companyId) {
    throw new Error('No se encontró empresa activa');
  }

  try {
    // Verificar que el almacén pertenece a la empresa
    const warehouse = await prisma.warehouse.findFirst({
      where: { id: warehouseId, companyId },
    });

    if (!warehouse) {
      throw new Error('Almacén no encontrado');
    }

    const stocks = await prisma.warehouseStock.findMany({
      where: { warehouseId },
      include: {
        product: {
          select: {
            id: true,
            code: true,
            name: true,
            unitOfMeasure: true,
            minStock: true,
          },
        },
        warehouse: {
          select: {
            id: true,
            code: true,
            name: true,
          },
        },
      },
      orderBy: {
        product: {
          name: 'asc',
        },
      },
    });

    return stocks.map((stock) => ({
      ...stock,
      quantity: Number(stock.quantity),
      reservedQty: Number(stock.reservedQty),
      availableQty: Number(stock.availableQty),
      product: stock.product ? {
        ...stock.product,
        minStock: stock.product.minStock ? Number(stock.product.minStock) : null,
      } : undefined,
    })) as WarehouseStock[];
  } catch (error) {
    logger.error('Error al obtener stock de almacén', { data: { error } });
    throw new Error('Error al obtener stock de almacén');
  }
}

export async function getProductStock(productId: string): Promise<WarehouseStock[]> {
  await checkPermission('commercial.stock', 'view', { redirect: true });
  const { userId } = await auth();
  if (!userId) {
    throw new Error('No autenticado');
  }

  const companyId = await getActiveCompanyId();
  if (!companyId) {
    throw new Error('No se encontró empresa activa');
  }

  try {
    // Verificar que el producto pertenece a la empresa
    const product = await prisma.product.findFirst({
      where: { id: productId, companyId },
    });

    if (!product) {
      throw new Error('Producto no encontrado');
    }

    const stocks = await prisma.warehouseStock.findMany({
      where: {
        productId,
        warehouse: { companyId },
      },
      include: {
        warehouse: {
          select: {
            id: true,
            code: true,
            name: true,
            city: true,
            state: true,
          },
        },
        product: {
          select: {
            id: true,
            code: true,
            name: true,
            unitOfMeasure: true,
            minStock: true,
          },
        },
      },
      orderBy: {
        warehouse: {
          name: 'asc',
        },
      },
    });

    return stocks.map((stock) => ({
      ...stock,
      quantity: Number(stock.quantity),
      reservedQty: Number(stock.reservedQty),
      availableQty: Number(stock.availableQty),
      product: stock.product ? {
        ...stock.product,
        minStock: stock.product.minStock ? Number(stock.product.minStock) : null,
      } : undefined,
    })) as WarehouseStock[];
  } catch (error) {
    logger.error('Error al obtener stock del producto', { data: { error } });
    throw new Error('Error al obtener stock del producto');
  }
}

// ============================================
// Stock Movements
// ============================================

export async function getStockMovements(filters?: {
  warehouseId?: string;
  productId?: string;
  limit?: number;
}): Promise<StockMovement[]> {
  await checkPermission('commercial.movements', 'view', { redirect: true });
  const { userId } = await auth();
  if (!userId) {
    throw new Error('No autenticado');
  }

  const companyId = await getActiveCompanyId();
  if (!companyId) {
    throw new Error('No se encontró empresa activa');
  }

  try {
    const movements = await prisma.stockMovement.findMany({
      where: {
        companyId,
        ...(filters?.warehouseId && { warehouseId: filters.warehouseId }),
        ...(filters?.productId && { productId: filters.productId }),
      },
      include: {
        warehouse: {
          select: {
            id: true,
            code: true,
            name: true,
          },
        },
        product: {
          select: {
            id: true,
            code: true,
            name: true,
            unitOfMeasure: true,
          },
        },
      },
      orderBy: { date: 'desc' },
      take: filters?.limit || 100,
    });

    return movements.map((movement) => ({
      ...movement,
      quantity: Number(movement.quantity),
    })) as StockMovement[];
  } catch (error) {
    logger.error('Error al obtener movimientos de stock', { data: { error } });
    throw new Error('Error al obtener movimientos de stock');
  }
}

export async function getStockMovementsPaginated(
  searchParams: DataTableSearchParams,
  filters?: {
    warehouseId?: string;
    productId?: string;
    type?: string;
    dateFrom?: Date;
    dateTo?: Date;
  }
) {
  await checkPermission('commercial.movements', 'view', { redirect: true });
  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    const parsed = parseSearchParams(searchParams);
    const { page, pageSize, search, sortBy, sortOrder } = parsed;
    const { skip, take, orderBy: prismaOrderBy } = stateToPrismaParams(parsed);

    const where: Prisma.StockMovementWhereInput = {
      companyId,
      ...(filters?.warehouseId && { warehouseId: filters.warehouseId }),
      ...(filters?.productId && { productId: filters.productId }),
      ...(filters?.type && { type: filters.type as any }),
      ...(filters?.dateFrom || filters?.dateTo
        ? {
            date: {
              ...(filters?.dateFrom && { gte: filters.dateFrom }),
              ...(filters?.dateTo && { lte: filters.dateTo }),
            },
          }
        : {}),
      ...(search && {
        OR: [
          { product: { name: { contains: search, mode: 'insensitive' } } },
          { product: { code: { contains: search, mode: 'insensitive' } } },
          { notes: { contains: search, mode: 'insensitive' } },
          { referenceType: { contains: search, mode: 'insensitive' } },
        ],
      }),
    };

    const orderBy = prismaOrderBy && Object.keys(prismaOrderBy).length > 0 ? prismaOrderBy : { date: 'desc' as const };

    const [data, total] = await Promise.all([
      prisma.stockMovement.findMany({
        where,
        include: {
          warehouse: {
            select: {
              id: true,
              code: true,
              name: true,
            },
          },
          product: {
            select: {
              id: true,
              code: true,
              name: true,
              unitOfMeasure: true,
            },
          },
        },
        orderBy,
        skip,
        take,
      }),
      prisma.stockMovement.count({ where }),
    ]);

    return {
      data: data.map((m) => ({
        ...m,
        quantity: Number(m.quantity),
      })) as StockMovement[],
      total,
    };
  } catch (error) {
    logger.error('Error al obtener movimientos de stock paginados', { data: { error } });
    throw error;
  }
}

export async function createStockMovement(data: CreateStockMovementFormData): Promise<StockMovement> {
  await checkPermission('commercial.movements', 'create', { redirect: true });
  const { userId } = await auth();
  if (!userId) {
    throw new Error('No autenticado');
  }

  const companyId = await getActiveCompanyId();
  if (!companyId) {
    throw new Error('No se encontró empresa activa');
  }

  const validatedData = createStockMovementSchema.parse(data);

  try {
    // Verificar que el almacén y producto pertenecen a la empresa
    const [warehouse, product] = await Promise.all([
      prisma.warehouse.findFirst({
        where: { id: validatedData.warehouseId, companyId },
      }),
      prisma.product.findFirst({
        where: { id: validatedData.productId, companyId },
      }),
    ]);

    if (!warehouse) {
      throw new Error('Almacén no encontrado');
    }

    if (!product) {
      throw new Error('Producto no encontrado');
    }

    // Crear el movimiento
    const movement = await prisma.stockMovement.create({
      data: {
        companyId,
        warehouseId: validatedData.warehouseId,
        productId: validatedData.productId,
        type: validatedData.type,
        quantity: validatedData.quantity,
        referenceType: validatedData.referenceType,
        referenceId: validatedData.referenceId,
        notes: validatedData.notes,
        date: validatedData.date || new Date(),
        createdBy: userId,
      },
      include: {
        warehouse: {
          select: {
            id: true,
            code: true,
            name: true,
          },
        },
        product: {
          select: {
            id: true,
            code: true,
            name: true,
            unitOfMeasure: true,
          },
        },
      },
    });

    revalidatePath('/dashboard/commercial/warehouses');
    logger.info('Movimiento de stock creado', { data: { movementId: movement.id } });

    return {
      ...movement,
      quantity: Number(movement.quantity),
    } as StockMovement;
  } catch (error) {
    logger.error('Error al crear movimiento de stock', { data: { error } });
    if (error instanceof Error) {
      throw error;
    }
    throw new Error('Error al crear movimiento de stock');
  }
}

// ============================================
// Stock Adjustment
// ============================================

export async function adjustStock(data: SetStockQuantityFormData): Promise<void> {
  await checkPermission('commercial.stock', 'update', { redirect: true });
  const { userId } = await auth();
  if (!userId) {
    throw new Error('No autenticado');
  }

  const companyId = await getActiveCompanyId();
  if (!companyId) {
    throw new Error('No se encontró empresa activa');
  }

  const validatedData = setStockQuantitySchema.parse(data);

  try {
    const [warehouse, product] = await Promise.all([
      prisma.warehouse.findFirst({
        where: { id: validatedData.warehouseId, companyId },
      }),
      prisma.product.findFirst({
        where: { id: validatedData.productId, companyId },
      }),
    ]);

    if (!warehouse) {
      throw new Error('Almacén no encontrado');
    }

    if (!product) {
      throw new Error('Producto no encontrado');
    }

    // Obtener stock actual
    const currentStock = await prisma.warehouseStock.findFirst({
      where: {
        warehouseId: validatedData.warehouseId,
        productId: validatedData.productId,
      },
    });

    const currentQty = currentStock ? Number(currentStock.quantity) : 0;
    const diff = validatedData.newQuantity - currentQty;

    // Crear o actualizar stock
    await prisma.warehouseStock.upsert({
      where: {
        warehouseId_productId: {
          warehouseId: validatedData.warehouseId,
          productId: validatedData.productId,
        },
      },
      create: {
        warehouseId: validatedData.warehouseId,
        productId: validatedData.productId,
        quantity: validatedData.newQuantity,
        availableQty: validatedData.newQuantity,
      },
      update: {
        quantity: validatedData.newQuantity,
        availableQty: validatedData.newQuantity - (currentStock?.reservedQty ? Number(currentStock.reservedQty) : 0),
      },
    });

    // Registrar movimiento
    await prisma.stockMovement.create({
      data: {
        companyId,
        warehouseId: validatedData.warehouseId,
        productId: validatedData.productId,
        type: 'ADJUSTMENT',
        quantity: diff,
        notes: validatedData.notes || `Ajuste de stock: ${currentQty} → ${validatedData.newQuantity}`,
        date: new Date(),
        createdBy: userId,
      },
    });

    revalidatePath('/dashboard/commercial/warehouses');
    logger.info('Stock ajustado', {
      data: {
        warehouseId: validatedData.warehouseId,
        productId: validatedData.productId,
        from: currentQty,
        to: validatedData.newQuantity,
      },
    });
  } catch (error) {
    logger.error('Error al ajustar stock', { data: { error } });
    if (error instanceof Error) {
      throw error;
    }
    throw new Error('Error al ajustar stock');
  }
}

// ============================================
// Stock Transfer
// ============================================

export async function transferStock(data: DirectStockTransferFormData): Promise<void> {
  await checkPermission('commercial.movements', 'create', { redirect: true });
  const { userId } = await auth();
  if (!userId) {
    throw new Error('No autenticado');
  }

  const companyId = await getActiveCompanyId();
  if (!companyId) {
    throw new Error('No se encontró empresa activa');
  }

  const validatedData = directStockTransferSchema.parse(data);

  try {
    const [fromWarehouse, toWarehouse, product] = await Promise.all([
      prisma.warehouse.findFirst({
        where: { id: validatedData.fromWarehouseId, companyId },
      }),
      prisma.warehouse.findFirst({
        where: { id: validatedData.toWarehouseId, companyId },
      }),
      prisma.product.findFirst({
        where: { id: validatedData.productId, companyId },
      }),
    ]);

    if (!fromWarehouse) {
      throw new Error('Almacén origen no encontrado');
    }

    if (!toWarehouse) {
      throw new Error('Almacén destino no encontrado');
    }

    if (!product) {
      throw new Error('Producto no encontrado');
    }

    // Verificar stock disponible en origen
    const fromStock = await prisma.warehouseStock.findFirst({
      where: {
        warehouseId: validatedData.fromWarehouseId,
        productId: validatedData.productId,
      },
    });

    if (!fromStock || Number(fromStock.availableQty) < validatedData.quantity) {
      throw new Error('Stock insuficiente en almacén origen');
    }

    // Ejecutar transferencia en transacción
    await prisma.$transaction(async (tx) => {
      // Reducir stock en origen
      await tx.warehouseStock.update({
        where: {
          warehouseId_productId: {
            warehouseId: validatedData.fromWarehouseId,
            productId: validatedData.productId,
          },
        },
        data: {
          quantity: { decrement: validatedData.quantity },
          availableQty: { decrement: validatedData.quantity },
        },
      });

      // Incrementar stock en destino
      await tx.warehouseStock.upsert({
        where: {
          warehouseId_productId: {
            warehouseId: validatedData.toWarehouseId,
            productId: validatedData.productId,
          },
        },
        create: {
          warehouseId: validatedData.toWarehouseId,
          productId: validatedData.productId,
          quantity: validatedData.quantity,
          availableQty: validatedData.quantity,
        },
        update: {
          quantity: { increment: validatedData.quantity },
          availableQty: { increment: validatedData.quantity },
        },
      });

      // Registrar movimiento de salida
      await tx.stockMovement.create({
        data: {
          companyId,
          warehouseId: validatedData.fromWarehouseId,
          productId: validatedData.productId,
          type: 'TRANSFER_OUT',
          quantity: -validatedData.quantity,
          notes: validatedData.notes || `Transferencia a ${toWarehouse.name}`,
          date: new Date(),
          createdBy: userId,
        },
      });

      // Registrar movimiento de entrada
      await tx.stockMovement.create({
        data: {
          companyId,
          warehouseId: validatedData.toWarehouseId,
          productId: validatedData.productId,
          type: 'TRANSFER_IN',
          quantity: validatedData.quantity,
          notes: validatedData.notes || `Transferencia desde ${fromWarehouse.name}`,
          date: new Date(),
          createdBy: userId,
        },
      });
    });

    revalidatePath('/dashboard/commercial/warehouses');
    logger.info('Stock transferido', {
      data: {
        from: validatedData.fromWarehouseId,
        to: validatedData.toWarehouseId,
        productId: validatedData.productId,
        quantity: validatedData.quantity,
      },
    });
  } catch (error) {
    logger.error('Error al transferir stock', { data: { error } });
    if (error instanceof Error) {
      throw error;
    }
    throw new Error('Error al transferir stock');
  }
}


// ============================================
// Type Exports
// ============================================

export type WarehouseListItem = Awaited<ReturnType<typeof getWarehouses>>['data'][number];
