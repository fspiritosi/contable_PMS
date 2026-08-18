'use client';

import { useState } from 'react';
import { _ReportSelector } from './components/_ReportSelector';
import { _SalesReportTable } from './components/_SalesReportTable';
import {
  getSalesByPeriod,
  getSalesByCustomer,
  getSalesByProduct,
  getVATSalesBook,
} from './actions.server';
import { toast } from 'sonner';

type ReportType = 'period' | 'customer' | 'product' | 'vat';

export function SalesReports() {
  const [loading, setLoading] = useState(false);
  const [reportType, setReportType] = useState<ReportType | null>(null);
  const [reportData, setReportData] = useState<any>(null);
  const [dateRange, setDateRange] = useState<{ startDate?: Date; endDate?: Date }>({});

  const handleGenerate = async (type: ReportType, startDate: Date, endDate: Date) => {
    try {
      setLoading(true);
      setReportType(type);
      setDateRange({ startDate, endDate });

      let data;
      switch (type) {
        case 'period':
          data = await getSalesByPeriod(startDate, endDate);
          break;
        case 'customer':
          data = await getSalesByCustomer(startDate, endDate);
          break;
        case 'product':
          data = await getSalesByProduct(startDate, endDate);
          break;
        case 'vat':
          data = await getVATSalesBook(startDate, endDate);
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
        <h1 className="text-3xl font-bold tracking-tight">Reportes de Ventas</h1>
        <p className="text-muted-foreground">
          Analiza tus ventas por período, cliente, ítem o genera el libro IVA
        </p>
      </div>

      <_ReportSelector onGenerate={handleGenerate} loading={loading} />

      <_SalesReportTable
        reportType={reportType}
        data={reportData}
        startDate={dateRange.startDate}
        endDate={dateRange.endDate}
      />
    </div>
  );
}
