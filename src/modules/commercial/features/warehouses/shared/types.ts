import { WarehouseType, StockMovementType } from '@/generated/prisma/enums';

// ============================================
// Warehouse Types
// ============================================

export interface Warehouse extends Record<string, unknown> {
  id: string;
  companyId: string;
  code: string;
  name: string;
  type: WarehouseType;
  address: string | null;
  city: string | null;
  state: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  _count?: {
    stocks: number;
    movements: number;
  };
}

export interface CreateWarehouseInput {
  code: string;
  name: string;
  type?: WarehouseType;
  address?: string;
  city?: string;
  state?: string;
  isActive?: boolean;
}

export interface UpdateWarehouseInput extends Partial<CreateWarehouseInput> {}

// ============================================
// Warehouse Stock Types
// ============================================

export interface WarehouseStock extends Record<string, unknown> {
  id: string;
  warehouseId: string;
  productId: string;
  quantity: number;
  reservedQty: number;
  availableQty: number;
  updatedAt: Date;
  warehouse?: {
    id: string;
    code: string;
    name: string;
    city: string | null;
    state: string | null;
  };
  product?: {
    id: string;
    code: string;
    name: string;
    unitOfMeasure: string;
    minStock: number | null;
  };
}

// ============================================
// Stock Movement Types
// ============================================

export interface StockMovement extends Record<string, unknown> {
  id: string;
  companyId: string;
  warehouseId: string;
  productId: string;
  type: StockMovementType;
  quantity: number;
  referenceType: string | null;
  referenceId: string | null;
  referenceNumber: string | null;
  notes: string | null;
  date: Date;
  createdBy: string;
  createdAt: Date;
  warehouse?: {
    id: string;
    code: string;
    name: string;
  };
  product?: {
    id: string;
    code: string;
    name: string;
    unitOfMeasure: string;
  };
}

export interface CreateStockMovementInput {
  warehouseId: string;
  productId: string;
  type: StockMovementType;
  quantity: number;
  referenceType?: string;
  referenceId?: string;
  notes?: string;
  date?: Date;
}

// ============================================
// Labels for UI
// ============================================

export const WAREHOUSE_TYPE_LABELS: Record<WarehouseType, string> = {
  MAIN: 'Principal',
  BRANCH: 'Sucursal',
  TRANSIT: 'En Tránsito',
  VIRTUAL: 'Virtual',
};

export const STOCK_MOVEMENT_TYPE_LABELS: Record<StockMovementType, string> = {
  PURCHASE: 'Compra',
  SALE: 'Venta',
  ADJUSTMENT: 'Ajuste',
  TRANSFER_OUT: 'Transferencia Salida',
  TRANSFER_IN: 'Transferencia Entrada',
  RETURN: 'Devolución',
  PRODUCTION: 'Producción',
  LOSS: 'Pérdida/Merma',
};
