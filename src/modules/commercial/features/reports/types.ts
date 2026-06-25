// ============================================
// TIPOS - Informes Impositivos (Libro IVA)
// ============================================

/** Entrada individual del Libro IVA (Ventas o Compras) */
export interface LibroIVAEntry {
  id: string;
  fullNumber: string;
  voucherType: string;
  issueDate: Date;
  entityName: string;
  entityTaxId: string | null;
  entityTaxCondition: string;
  subtotal: number;
  netTaxed: number;
  netNonTaxed: number;
  netExempt: number;
  iva25: number;
  iva5: number;
  iva105: number;
  iva21: number;
  iva27: number;
  perceptions: number;
  otherTaxes: number;
  total: number;
  cae: string | null;
}

/** Resultado del Libro IVA */
export interface LibroIVAResult {
  entries: LibroIVAEntry[];
  totals: {
    subtotal: number;
    netTaxed: number;
    netNonTaxed: number;
    netExempt: number;
    iva25: number;
    iva5: number;
    iva105: number;
    iva21: number;
    iva27: number;
    perceptions: number;
    otherTaxes: number;
    total: number;
    entryCount: number;
  };
}

/** Detalle por alícuota para posición fiscal */
export interface VATRateDetail {
  rate: number;
  salesBase: number;
  salesVAT: number;
  purchasesBase: number;
  purchasesVAT: number;
  position: number;
}

/** Resultado de posición fiscal */
export interface FiscalPositionResult {
  ivaVentas: number;
  ivaCompras: number;
  posicion: number;
  detailByRate: VATRateDetail[];
}
