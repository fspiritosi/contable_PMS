'use client';

import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/components/ui/card';
import { Button } from '@/shared/components/ui/button';
import { Input } from '@/shared/components/ui/input';
import { Skeleton } from '@/shared/components/ui/skeleton';
import { FileSpreadsheet, Search } from 'lucide-react';
import moment from 'moment';
import { toast } from 'sonner';
import { formatCurrency } from '@/shared/utils/formatters';
import { VOUCHER_TYPE_LABELS } from '@/modules/commercial/features/sales/features/invoices/shared/validators';
import { customerTaxConditionLabels, supplierTaxConditionLabels } from '@/shared/utils/mappers';
import { exportToExcel } from '@/shared/lib/excel-export';
import type { ExcelColumn } from '@/shared/lib/excel-export';
import type { LibroIVAResult } from '../types';

interface Props {
  type: 'ventas' | 'compras';
  fetchData: (from: Date, to: Date) => Promise<LibroIVAResult>;
}

const taxConditionLabels = { ...customerTaxConditionLabels, ...supplierTaxConditionLabels };

export function _LibroIVATable({ type, fetchData }: Props) {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<LibroIVAResult | null>(null);
  const [fromDate, setFromDate] = useState(moment().startOf('month').format('YYYY-MM-DD'));
  const [toDate, setToDate] = useState(moment().endOf('month').format('YYYY-MM-DD'));

  const entityLabel = type === 'ventas' ? 'Cliente' : 'Proveedor';
  const title = type === 'ventas' ? 'Libro IVA Ventas' : 'Libro IVA Compras';

  const handleGenerate = async () => {
    if (!fromDate || !toDate) {
      toast.error('Selecciona las fechas');
      return;
    }

    try {
      setLoading(true);
      const from = new Date(fromDate + 'T00:00:00');
      const to = new Date(toDate + 'T23:59:59');
      const result = await fetchData(from, to);
      setData(result);
      toast.success('Reporte generado correctamente');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Error al generar el reporte');
      setData(null);
    } finally {
      setLoading(false);
    }
  };

  const handleExportExcel = async () => {
    if (!data || data.entries.length === 0) return;

    const columns: ExcelColumn[] = [
      {
        key: 'issueDate',
        title: 'Fecha',
        width: 12,
        formatter: (value) => moment(value as string).format('DD/MM/YYYY'),
      },
      {
        key: 'voucherType',
        title: 'Tipo',
        width: 18,
        formatter: (value) =>
          VOUCHER_TYPE_LABELS[value as keyof typeof VOUCHER_TYPE_LABELS] || String(value),
      },
      { key: 'fullNumber', title: 'Número', width: 18 },
      { key: 'entityName', title: entityLabel, width: 30 },
      { key: 'entityTaxId', title: 'CUIT', width: 15 },
      {
        key: 'entityTaxCondition',
        title: 'Cond. IVA',
        width: 22,
        formatter: (value) =>
          taxConditionLabels[value as keyof typeof taxConditionLabels] || String(value),
      },
      { key: 'netTaxed', title: 'Neto Gravado', width: 15 },
      { key: 'netNonTaxed', title: 'No Gravado', width: 13 },
      { key: 'netExempt', title: 'Exento', width: 13 },
      { key: 'iva25', title: 'IVA 2.5%', width: 13 },
      { key: 'iva5', title: 'IVA 5%', width: 13 },
      { key: 'iva105', title: 'IVA 10.5%', width: 13 },
      { key: 'iva21', title: 'IVA 21%', width: 13 },
      { key: 'iva27', title: 'IVA 27%', width: 13 },
      { key: 'perceptions', title: 'Percepciones', width: 13 },
      { key: 'otherTaxes', title: 'Otros Imp.', width: 13 },
      { key: 'total', title: 'Total', width: 15 },
    ];

    await exportToExcel(
      data.entries as unknown as Record<string, unknown>[],
      columns,
      {
        filename: `${title.replace(/ /g, '_')}_${fromDate}_${toDate}`,
        sheetName: title,
        title: `${title} - ${moment(fromDate).format('DD/MM/YYYY')} al ${moment(toDate).format('DD/MM/YYYY')}`,
      }
    );

    toast.success('Archivo Excel exportado');
  };

  return (
    <div className="space-y-4">
      {/* Filtros */}
      <Card>
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          <CardDescription>Selecciona el período y genera el libro IVA</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 grid-cols-1 sm:grid-cols-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Desde</label>
              <Input
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Hasta</label>
              <Input
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">&nbsp;</label>
              <Button
                onClick={handleGenerate}
                disabled={loading}
                className="w-full"
              >
                <Search className="mr-2 h-4 w-4" />
                {loading ? 'Generando...' : 'Generar'}
              </Button>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">&nbsp;</label>
              <Button
                variant="outline"
                onClick={handleExportExcel}
                disabled={!data || data.entries.length === 0}
                className="w-full"
              >
                <FileSpreadsheet className="mr-2 h-4 w-4" />
                Exportar Excel
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Loading */}
      {loading && (
        <Card>
          <CardContent className="pt-6 space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </CardContent>
        </Card>
      )}

      {/* Tabla */}
      {!loading && data && (
        <Card>
          <CardContent className="pt-6">
            {data.entries.length === 0 ? (
              <p className="text-center text-muted-foreground py-8">
                No hay comprobantes en el período seleccionado
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b">
                    <tr className="text-left">
                      <th className="pb-3">Fecha</th>
                      <th className="pb-3">Tipo</th>
                      <th className="pb-3">Número</th>
                      <th className="pb-3">{entityLabel}</th>
                      <th className="pb-3">CUIT</th>
                      <th className="pb-3 text-right">Neto Grav.</th>
                      <th className="pb-3 text-right">No Grav.</th>
                      <th className="pb-3 text-right">Exento</th>
                      <th className="pb-3 text-right">IVA 2.5%</th>
                      <th className="pb-3 text-right">IVA 5%</th>
                      <th className="pb-3 text-right">IVA 10.5%</th>
                      <th className="pb-3 text-right">IVA 21%</th>
                      <th className="pb-3 text-right">IVA 27%</th>
                      <th className="pb-3 text-right">Perc.</th>
                      <th className="pb-3 text-right">Otros</th>
                      <th className="pb-3 text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {data.entries.map((entry) => {
                      const c = (v: number) => v > 0 ? formatCurrency(v) : '-';
                      return (
                        <tr key={entry.id}>
                          <td className="py-3 whitespace-nowrap">
                            {moment(entry.issueDate).format('DD/MM/YYYY')}
                          </td>
                          <td className="py-3 text-xs">
                            {VOUCHER_TYPE_LABELS[entry.voucherType as keyof typeof VOUCHER_TYPE_LABELS] || entry.voucherType}
                          </td>
                          <td className="py-3 font-mono text-xs">{entry.fullNumber}</td>
                          <td className="py-3 max-w-[180px] truncate" title={entry.entityName}>
                            {entry.entityName}
                          </td>
                          <td className="py-3 font-mono text-xs">{entry.entityTaxId || '-'}</td>
                          <td className="py-3 text-right font-mono">{c(entry.netTaxed)}</td>
                          <td className="py-3 text-right font-mono">{c(entry.netNonTaxed)}</td>
                          <td className="py-3 text-right font-mono">{c(entry.netExempt)}</td>
                          <td className="py-3 text-right font-mono">{c(entry.iva25)}</td>
                          <td className="py-3 text-right font-mono">{c(entry.iva5)}</td>
                          <td className="py-3 text-right font-mono">{c(entry.iva105)}</td>
                          <td className="py-3 text-right font-mono">{c(entry.iva21)}</td>
                          <td className="py-3 text-right font-mono">{c(entry.iva27)}</td>
                          <td className="py-3 text-right font-mono">{c(entry.perceptions)}</td>
                          <td className="py-3 text-right font-mono">{c(entry.otherTaxes)}</td>
                          <td className="py-3 text-right font-mono font-semibold">
                            {formatCurrency(entry.total)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot className="border-t-2 font-semibold">
                    <tr>
                      <td className="pt-3" colSpan={5}>
                        TOTALES ({data.totals.entryCount} comprobantes)
                      </td>
                      <td className="pt-3 text-right font-mono">{formatCurrency(data.totals.netTaxed)}</td>
                      <td className="pt-3 text-right font-mono">{formatCurrency(data.totals.netNonTaxed)}</td>
                      <td className="pt-3 text-right font-mono">{formatCurrency(data.totals.netExempt)}</td>
                      <td className="pt-3 text-right font-mono">{formatCurrency(data.totals.iva25)}</td>
                      <td className="pt-3 text-right font-mono">{formatCurrency(data.totals.iva5)}</td>
                      <td className="pt-3 text-right font-mono">{formatCurrency(data.totals.iva105)}</td>
                      <td className="pt-3 text-right font-mono">{formatCurrency(data.totals.iva21)}</td>
                      <td className="pt-3 text-right font-mono">{formatCurrency(data.totals.iva27)}</td>
                      <td className="pt-3 text-right font-mono">{formatCurrency(data.totals.perceptions)}</td>
                      <td className="pt-3 text-right font-mono">{formatCurrency(data.totals.otherTaxes)}</td>
                      <td className="pt-3 text-right font-mono">{formatCurrency(data.totals.total)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
