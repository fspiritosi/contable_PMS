'use client';

import { useState } from 'react';
import { _ReportSelector } from './components/_ReportSelector';
import { _PurchaseReportTable } from './components/_PurchaseReportTable';
import {
  getPurchasesByPeriod,
  getPurchasesBySupplier,
  getPurchasesByProduct,
  getVATPurchaseBook,
} from './actions.server';
import { toast } from 'sonner';

type ReportType = 'period' | 'supplier' | 'product' | 'vat';

interface SupplierOption {
  id: string;
  businessName: string;
  tradeName: string | null;
}

interface Props {
  suppliers?: SupplierOption[];
}

export function PurchaseReports({ suppliers = [] }: Props) {
  const [loading, setLoading] = useState(false);
  const [reportType, setReportType] = useState<ReportType | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [reportData, setReportData] = useState<any>(null);
  const [dateRange, setDateRange] = useState<{ startDate?: Date; endDate?: Date }>({});

  const handleGenerate = async (type: ReportType, startDate: Date, endDate: Date, supplierId?: string) => {
    try {
      setLoading(true);
      setReportType(type);
      setDateRange({ startDate, endDate });

      let data;
      switch (type) {
        case 'period':
          data = await getPurchasesByPeriod(startDate, endDate, supplierId);
          break;
        case 'supplier':
          data = await getPurchasesBySupplier(startDate, endDate, supplierId);
          break;
        case 'product':
          data = await getPurchasesByProduct(startDate, endDate, supplierId);
          break;
        case 'vat':
          data = await getVATPurchaseBook(startDate, endDate, supplierId);
          break;
      }

      setReportData(data);
      toast.success('Reporte generado correctamente');
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Error al generar el reporte'
      );
      setReportData(null);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Reportes de Compras</h1>
        <p className="text-muted-foreground">
          Analiza tus compras por período, proveedor, producto o genera el libro IVA
        </p>
      </div>

      <_ReportSelector onGenerate={handleGenerate} loading={loading} suppliers={suppliers} />

      <_PurchaseReportTable
        reportType={reportType}
        data={reportData}
        startDate={dateRange.startDate}
        endDate={dateRange.endDate}
      />
    </div>
  );
}
