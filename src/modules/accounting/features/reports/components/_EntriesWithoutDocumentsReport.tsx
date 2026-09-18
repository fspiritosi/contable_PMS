'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/components/ui/card';
import { Input } from '@/shared/components/ui/input';
import { Label } from '@/shared/components/ui/label';
import { Button } from '@/shared/components/ui/button';
import { Badge } from '@/shared/components/ui/badge';
import { JournalEntryStatus } from '@/generated/prisma/enums';
import { getEntriesWithoutDocuments } from '../actions.server';
import { formatAmount } from '../../../shared/utils';
import { useState } from 'react';
import { Loader2, Download } from 'lucide-react';
import moment from 'moment';
import { exportToExcel, type ExcelColumn } from '@/shared/lib/excel-export';
import { logger } from '@/shared/lib/logger';
import { formatDateUtc } from '@/shared/utils/formatters';

interface EntriesWithoutDocumentsReportProps {
  companyId: string;
}

export function _EntriesWithoutDocumentsReport({ companyId }: EntriesWithoutDocumentsReportProps) {
  const [fromDate, setFromDate] = useState<string>(
    moment().startOf('month').format('YYYY-MM-DD')
  );
  const [toDate, setToDate] = useState<string>(
    moment().format('YYYY-MM-DD')
  );
  const [isLoading, setIsLoading] = useState(false);
  const [data, setData] = useState<Awaited<ReturnType<typeof getEntriesWithoutDocuments>> | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      const result = await getEntriesWithoutDocuments(
        companyId,
        new Date(fromDate),
        new Date(toDate)
      );
      setData(result);
    } catch (error) {
      logger.error('Error al obtener asientos sin respaldo', { data: { error } });
    } finally {
      setIsLoading(false);
    }
  };

  const handleExport = async () => {
    if (!data || data.length === 0) return;

    const columns: ExcelColumn[] = [
      { key: 'number', title: 'Número', width: 10 },
      { key: 'date', title: 'Fecha', width: 12, formatter: (value) => formatDateUtc(value as Date) },
      { key: 'description', title: 'Descripción', width: 40 },
      { key: 'status', title: 'Estado', width: 12 },
      { key: 'totalDebit', title: 'Debe', width: 15, formatter: (value) => (value as number).toFixed(2) },
      { key: 'totalCredit', title: 'Haber', width: 15, formatter: (value) => (value as number).toFixed(2) },
      { key: 'createdBy', title: 'Creado por', width: 20 },
    ];

    await exportToExcel(data, columns, {
      filename: `asientos-sin-respaldo-${moment().format('YYYY-MM-DD')}`,
      sheetName: 'Asientos sin Respaldo',
      title: 'Asientos sin Respaldo Documental',
      includeDate: true,
    });
  };

  const getStatusLabel = (status: string) => {
    const labels: Record<string, string> = {
      [JournalEntryStatus.DRAFT]: 'Borrador',
      [JournalEntryStatus.POSTED]: 'Registrado',
      [JournalEntryStatus.REVERSED]: 'Anulado',
    };
    return labels[status] || status;
  };

  const getStatusVariant = (status: string) => {
    if (status === JournalEntryStatus.POSTED) return 'default' as const;
    if (status === JournalEntryStatus.REVERSED) return 'destructive' as const;
    return 'outline' as const;
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Asientos sin Respaldo Documental</CardTitle>
        <CardDescription>
          Asientos contables que no están vinculados a ningún documento comercial (facturas, recibos, órdenes de pago)
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="mb-6 flex items-end gap-4">
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
                No se encontraron asientos sin respaldo en el período seleccionado.
              </p>
            ) : (
              <div className="rounded-md border">
                <table className="w-full">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      <th className="py-3 pl-4 text-left">Número</th>
                      <th className="py-3 text-left">Fecha</th>
                      <th className="py-3 text-left">Descripción</th>
                      <th className="py-3 text-left">Estado</th>
                      <th className="py-3 text-right">Importe</th>
                      <th className="py-3 pr-4 text-right">Creado por</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.map((entry) => (
                      <tr key={entry.id} className="border-b">
                        <td className="py-2 pl-4 font-mono">{entry.number}</td>
                        <td className="py-2">{formatDateUtc(entry.date)}</td>
                        <td className="py-2">{entry.description}</td>
                        <td className="py-2">
                          <Badge variant={getStatusVariant(entry.status)}>
                            {getStatusLabel(entry.status)}
                          </Badge>
                        </td>
                        <td className="py-2 text-right font-mono">{formatAmount(entry.totalDebit)}</td>
                        <td className="py-2 pr-4 text-right text-xs text-muted-foreground">
                          {entry.createdBy === 'system' ? 'Sistema' : entry.createdBy.slice(0, 8)}
                        </td>
                      </tr>
                    ))}
                    <tr className="border-t bg-muted/30 font-medium">
                      <td colSpan={4} className="py-3 pl-4">
                        {data.length} asiento{data.length !== 1 ? 's' : ''} sin respaldo documental
                      </td>
                      <td className="py-3 text-right font-mono">
                        {formatAmount(data.reduce((sum, e) => sum + e.totalDebit, 0))}
                      </td>
                      <td />
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
