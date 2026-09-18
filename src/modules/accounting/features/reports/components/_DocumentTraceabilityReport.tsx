'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/components/ui/card';
import { Input } from '@/shared/components/ui/input';
import { Label } from '@/shared/components/ui/label';
import { Button } from '@/shared/components/ui/button';
import { Badge } from '@/shared/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui/select';
import { getDocumentEntryTraceability } from '../actions.server';
import { formatAmount } from '../../../shared/utils';
import { useState } from 'react';
import { Loader2, Download } from 'lucide-react';
import moment from 'moment';
import { exportToExcel, type ExcelColumn } from '@/shared/lib/excel-export';
import { logger } from '@/shared/lib/logger';
import { formatDateUtc } from '@/shared/utils/formatters';

interface DocumentTraceabilityReportProps {
  companyId: string;
}

type DocumentTypeFilter = 'all' | 'sales_invoice' | 'purchase_invoice' | 'receipt' | 'payment_order';

const ENTRY_STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Borrador',
  POSTED: 'Registrado',
  REVERSED: 'Anulado',
};

export function _DocumentTraceabilityReport({ companyId }: DocumentTraceabilityReportProps) {
  const [fromDate, setFromDate] = useState<string>(
    moment().startOf('month').format('YYYY-MM-DD')
  );
  const [toDate, setToDate] = useState<string>(
    moment().format('YYYY-MM-DD')
  );
  const [documentType, setDocumentType] = useState<DocumentTypeFilter>('all');
  const [isLoading, setIsLoading] = useState(false);
  const [data, setData] = useState<Awaited<ReturnType<typeof getDocumentEntryTraceability>> | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      const result = await getDocumentEntryTraceability(
        companyId,
        new Date(fromDate),
        new Date(toDate),
        documentType === 'all' ? undefined : documentType
      );
      setData(result);
    } catch (error) {
      logger.error('Error al obtener trazabilidad', { data: { error } });
    } finally {
      setIsLoading(false);
    }
  };

  const handleExport = async () => {
    if (!data || data.length === 0) return;

    const flatData = data.map((item) => ({
      documentType: item.documentType,
      fullNumber: item.fullNumber,
      date: item.date,
      total: item.total,
      status: item.status,
      entryNumber: item.entryNumber ?? 'Sin asiento',
      entryDate: item.entryDate,
      entryStatus: item.entryStatus ? (ENTRY_STATUS_LABELS[item.entryStatus] || item.entryStatus) : '-',
    }));

    const columns: ExcelColumn[] = [
      { key: 'documentType', title: 'Tipo Documento', width: 18 },
      { key: 'fullNumber', title: 'Número', width: 18 },
      { key: 'date', title: 'Fecha', width: 12, formatter: (value) => formatDateUtc(value as Date) },
      { key: 'total', title: 'Importe', width: 15, formatter: (value) => (value as number).toFixed(2) },
      { key: 'status', title: 'Estado Documento', width: 15 },
      { key: 'entryNumber', title: 'Asiento Nº', width: 12 },
      { key: 'entryDate', title: 'Fecha Asiento', width: 12, formatter: (value) => value ? formatDateUtc(value as Date) : '-' },
      { key: 'entryStatus', title: 'Estado Asiento', width: 15 },
    ];

    await exportToExcel(flatData, columns, {
      filename: `trazabilidad-doc-asiento-${moment().format('YYYY-MM-DD')}`,
      sheetName: 'Trazabilidad',
      title: 'Trazabilidad Documento-Asiento',
      includeDate: true,
    });
  };

  const missingCount = data ? data.filter((d) => !d.hasEntry).length : 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Trazabilidad Documento-Asiento</CardTitle>
        <CardDescription>
          Cruce entre documentos comerciales y sus asientos contables. Documenos sin asiento se resaltan en amarillo.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="mb-6 flex items-end gap-4 flex-wrap">
          <div className="grid gap-2">
            <Label htmlFor="fromDate">Desde</Label>
            <Input
              id="fromDate"
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              disabled={isLoading}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="toDate">Hasta</Label>
            <Input
              id="toDate"
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              disabled={isLoading}
            />
          </div>
          <div className="grid gap-2">
            <Label>Tipo Documento</Label>
            <Select value={documentType} onValueChange={(v) => setDocumentType(v as DocumentTypeFilter)}>
              <SelectTrigger className="w-[200px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="sales_invoice">Factura Venta</SelectItem>
                <SelectItem value="purchase_invoice">Factura Compra</SelectItem>
                <SelectItem value="receipt">Recibo</SelectItem>
                <SelectItem value="payment_order">Orden de Pago</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button type="submit" disabled={isLoading}>
            {isLoading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Generando...
              </>
            ) : (
              'Generar'
            )}
          </Button>
          {data && data.length > 0 && (
            <Button type="button" variant="outline" onClick={handleExport}>
              <Download className="mr-2 h-4 w-4" />
              Exportar Excel
            </Button>
          )}
        </form>

        {data && (
          <>
            {data.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">
                No se encontraron documentos en el período seleccionado.
              </p>
            ) : (
              <div className="rounded-md border">
                <table className="w-full">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      <th className="py-3 pl-4 text-left">Tipo Doc.</th>
                      <th className="py-3 text-left">Número</th>
                      <th className="py-3 text-left">Fecha</th>
                      <th className="py-3 text-right">Importe</th>
                      <th className="py-3 text-left">Estado Doc.</th>
                      <th className="py-3 text-left">Asiento Nº</th>
                      <th className="py-3 text-left">Fecha Asiento</th>
                      <th className="py-3 pr-4 text-left">Estado Asiento</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.map((item, index) => (
                      <tr
                        key={`${item.documentId}-${index}`}
                        className={`border-b ${!item.hasEntry ? 'bg-yellow-50 dark:bg-yellow-950/20' : ''}`}
                      >
                        <td className="py-2 pl-4">
                          <Badge variant="outline" className="text-xs">
                            {item.documentType}
                          </Badge>
                        </td>
                        <td className="py-2 font-mono text-sm">{item.fullNumber}</td>
                        <td className="py-2">{formatDateUtc(item.date)}</td>
                        <td className="py-2 text-right font-mono">{formatAmount(item.total)}</td>
                        <td className="py-2 text-sm">{item.status}</td>
                        <td className="py-2 font-mono">
                          {item.entryNumber ? (
                            item.entryNumber
                          ) : (
                            <span className="text-destructive font-medium">Sin asiento</span>
                          )}
                        </td>
                        <td className="py-2">
                          {item.entryDate
                            ? moment(item.entryDate).format('DD/MM/YYYY')
                            : '-'}
                        </td>
                        <td className="py-2 pr-4 text-sm">
                          {item.entryStatus ? (
                            <Badge
                              variant={
                                item.entryStatus === 'POSTED'
                                  ? 'default'
                                  : item.entryStatus === 'REVERSED'
                                  ? 'destructive'
                                  : 'outline'
                              }
                            >
                              {ENTRY_STATUS_LABELS[item.entryStatus] || item.entryStatus}
                            </Badge>
                          ) : (
                            '-'
                          )}
                        </td>
                      </tr>
                    ))}
                    <tr className="border-t bg-muted/30 font-medium">
                      <td colSpan={3} className="py-3 pl-4">
                        {data.length} documento{data.length !== 1 ? 's' : ''}
                        {missingCount > 0 && (
                          <span className="text-destructive ml-2">
                            / {missingCount} sin asiento contable
                          </span>
                        )}
                      </td>
                      <td className="py-3 text-right font-mono">
                        {formatAmount(data.reduce((sum, d) => sum + d.total, 0))}
                      </td>
                      <td colSpan={4} />
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
