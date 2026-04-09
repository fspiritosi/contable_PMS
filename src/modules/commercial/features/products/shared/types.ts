import { ProductType, ProductStatus } from '@/generated/prisma/enums';

// ============================================
// Product Category Types
// ============================================

export interface ProductCategory extends Record<string, unknown> {
  id: string;
  companyId: string;
  name: string;
  description: string | null;
  parentId: string | null;
  createdAt: Date;
  updatedAt: Date;
  // Para mostrar jerarquía
  parent?: { id: string; name: string } | null;
  children?: ProductCategory[];
}

export interface CreateCategoryInput {
  name: string;
  description?: string;
  parentId?: string;
}

export interface UpdateCategoryInput extends Partial<CreateCategoryInput> {}

// ============================================
// Product Types
// ============================================

export interface Product extends Record<string, unknown> {
  id: string;
  companyId: string;
  code: string;
  name: string;
  description: string | null;
  type: ProductType;
  categoryId: string | null;
  unitOfMeasure: string;
  costPrice: number;
  salePrice: number;
  salePriceWithTax: number;
  vatRate: number;
  trackStock: boolean;
  minStock: number | null;
  maxStock: number | null;
  barcode: string | null;
  internalCode: string | null;
  brand: string | null;
  model: string | null;
  oemCode: string | null;
  auxiliaryCode: string | null;
  productGroupId: string | null;
  status: ProductStatus;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
  // Relaciones
  category?: { id: string; name: string } | null;
  productGroup?: { id: string; name: string } | null;
  // Calculado desde warehouseStocks
  currentStock?: number;
}

/**
 * Estado del nivel de stock de un producto
 */
export type StockLevel = 'ok' | 'warning' | 'critical' | 'out';

/**
 * Determina el nivel de stock de un producto
 * - out: stock = 0 y trackStock activo
 * - critical: stock < minStock
 * - warning: stock entre minStock y minStock * 1.5
 * - ok: stock normal
 */
export function getStockLevel(product: {
  trackStock: boolean;
  currentStock?: number;
  minStock: number | null;
}): StockLevel {
  if (!product.trackStock || product.currentStock == null) return 'ok';

  const minStock = product.minStock || 0;
  if (minStock <= 0) return 'ok';

  if (product.currentStock <= 0) return 'out';
  if (product.currentStock < minStock) return 'critical';
  if (product.currentStock <= minStock * 1.5) return 'warning';
  return 'ok';
}

export const STOCK_LEVEL_LABELS: Record<StockLevel, string> = {
  ok: 'Normal',
  warning: 'Bajo',
  critical: 'Crítico',
  out: 'Sin stock',
};

export interface CreateProductInput {
  name: string;
  description?: string;
  type: ProductType;
  categoryId?: string;
  unitOfMeasure?: string;
  costPrice: number;
  salePrice: number;
  vatRate?: number;
  trackStock?: boolean;
  minStock?: number;
  maxStock?: number;
  barcode?: string;
  internalCode?: string;
  brand?: string;
  model?: string;
}

export interface UpdateProductInput extends Partial<CreateProductInput> {
  status?: ProductStatus;
}

// ============================================
// Labels for UI
// ============================================

export const PRODUCT_TYPE_LABELS: Record<ProductType, string> = {
  PRODUCT: 'Producto',
  SERVICE: 'Servicio',
  COMBO: 'Combo',
};

export const PRODUCT_STATUS_LABELS: Record<ProductStatus, string> = {
  ACTIVE: 'Activo',
  INACTIVE: 'Inactivo',
  DISCONTINUED: 'Discontinuado',
};

export const UNIT_OF_MEASURE_OPTIONS = [
  { value: 'UN', label: 'Unidad' },
  { value: 'KG', label: 'Kilogramo' },
  { value: 'G', label: 'Gramo' },
  { value: 'L', label: 'Litro' },
  { value: 'ML', label: 'Mililitro' },
  { value: 'M', label: 'Metro' },
  { value: 'CM', label: 'Centímetro' },
  { value: 'M2', label: 'Metro Cuadrado' },
  { value: 'M3', label: 'Metro Cúbico' },
  { value: 'PAR', label: 'Par' },
  { value: 'DOCENA', label: 'Docena' },
  { value: 'CAJA', label: 'Caja' },
  { value: 'PAQUETE', label: 'Paquete' },
  { value: 'SET', label: 'Set' },
  { value: 'HORA', label: 'Hora' },
  { value: 'DIA', label: 'Día' },
  { value: 'MES', label: 'Mes' },
];

export const UNIT_OF_MEASURE_LABELS: Record<string, string> =
  UNIT_OF_MEASURE_OPTIONS.reduce((acc, option) => {
    acc[option.value] = option.label;
    return acc;
  }, {} as Record<string, string>);

export const VAT_RATE_OPTIONS = [
  { value: 0, label: '0%' },
  { value: 10.5, label: '10.5%' },
  { value: 21, label: '21%' },
  { value: 27, label: '27%' },
];

// ============================================
// Price List Types
// ============================================

export interface PriceList extends Record<string, unknown> {
  id: string;
  companyId: string;
  name: string;
  description: string | null;
  isDefault: boolean;
  isActive: boolean;
  createdBy: string | null;
  lastModifiedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
  // Relaciones
  items?: PriceListItem[];
  _count?: {
    items: number;
  };
}

export interface PriceListItem extends Record<string, unknown> {
  id: string;
  priceListId: string;
  productId: string;
  price: number;
  priceWithTax: number;
  updatedBy: string | null;
  updatedAt: Date | null;
  // Relaciones
  product?: {
    id: string;
    code: string;
    name: string;
    vatRate: number;
  };
}

export interface CreatePriceListInput {
  name: string;
  description?: string;
  isDefault?: boolean;
  isActive?: boolean;
}

export interface UpdatePriceListInput extends Partial<CreatePriceListInput> {}

export interface CreatePriceListItemInput {
  productId: string;
  price: number;
}

export interface UpdatePriceListItemInput {
  price: number;
}
