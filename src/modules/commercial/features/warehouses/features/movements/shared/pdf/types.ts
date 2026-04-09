export interface StockTransferPDFData {
  company: {
    name: string;
    taxId: string;
    address: string;
  };

  transfer: {
    transferNumber: string;
    date: Date;
    notes?: string | null;
  };

  sourceWarehouse: {
    code: string;
    name: string;
  };

  destinationWarehouse: {
    code: string;
    name: string;
  };

  lines: Array<{
    productCode: string;
    productName: string;
    unit?: string;
    quantity: number;
  }>;
}
