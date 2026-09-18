'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/components/ui/card';
import { Input } from '@/shared/components/ui/input';
import { Label } from '@/shared/components/ui/label';
import { Button } from '@/shared/components/ui/button';
import { getReversalLog } from '../actions.server';
import { formatAmount } from '../../../shared/utils';
import { useState } from 'react';
import { Loader2, Download } from 'lucide-react';
import moment from 'moment';
import { exportToExcel, type ExcelColumn } from '@/shared/lib/excel-export';
import { logger } from '@/shared/lib/logger';
import { formatDateUtc } from '@/shared/utils/formatters';

interface ReversalLogReportProps {
  companyId: string;
}

export function _ReversalLogReport({ companyId }: ReversalLogReportProps) {
  const [fromDate, setFromDate] = useState<string>(
    moment().startOf('month').format('YYYY-MM-DD')
  );
  const [toDate, setToDate] = useState<string>(
    moment().format('YYYY-MM-DD')
  );
  const [isLoading, setIsLoading] = useState(false);
  const [data, setData] = useState<Awaited<ReturnType<typeof getReversalLog>> | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      const result = await getReversalLog(
        companyId,
        new Date(fromDate),
        new Date(toDate)
      );
      setData(result);
    } catch (error) {
      logger.error('Error al obtener registro de reversiones', { data: { error } });
    } finally {
      setIsLoading(false);
    }
  };

  const handleExport = async () => {
    if (!data || data.length === 0) return;

    const flatData = data.map((entry) => ({
      originalNumber: entry.number,
      originalDate: entry.date,
      description: entry.description,
      amount: entry.totalAmount,
      reversalNumber: entry.reversalEntry?.number ?? '-',
      reversalDate: entry.reversalEntry?.date ?? null,
      reversedBy: entry.reversedBy === 'system' ? 'Sistema' : entry.reversedBy ?? '-',
      reversedAt: entry.reversedAt,
    }));

    const columns: ExcelColumn[] = [
      { key: 'originalNumber', title: 'Asiento Original', width: 15 },
      { key: 'originalDate', title: 'Fecha Original', width: 12, formatter: (value) => value ? formatDateUtc(value as Date) : '-' },
      { key: 'description', title: 'Descripción', width: 40 },
      { key: 'amount', title: 'Importe', width: 15, formatter: (value) => (value as number).toFixed(2) },
      { key: 'reversalNumber', title: 'Asiento Reversión', width: 15 },
      { key: 'reversalDate', title: 'Fecha Reversión', width: 12, formatter: (value) => value ? formatDateUtc(value as Date) : '-' },
      { key: 'reversedBy', title: 'Anulado por', width: 20 },
      { key: 'reversedAt', title: 'Fecha Anulación', width: 15, formatter: (value) => value ? moment(value as Date).format('DD/MM/YYYY HH:mm') : '-' },
    ];

    await exportToExcel(flatData, columns, {
      filename: `registro-reversiones-${moment().format('YYYY-MM-DD')}`,
      sheetName: 'Reversiones',
      title: 'Registro de Reversiones',
      includeDate: true,
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Registro de Reversiones</CardTitle>
        <CardDescription>
          Historial de asientos contables que fueron anulados mediante reversión
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
                No se encontraron reversiones en el período seleccionado.
              </p>
            ) : (
              <div className="rounded-md border">
                <table className="w-full">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      <th className="py-3 pl-4 text-left">Asiento Original</th>
                      <th className="py-3 text-left">Fecha</th>
                      <th className="py-3 text-left">Descripción</th>
                      <th className="py-3 text-right">Importe</th>
                      <th className="py-3 text-left">Asiento Reversión</th>
                      <th className="py-3 text-left">Fecha Reversión</th>
                      <th className="py-3 text-left">Anulado por</th>
                      <th className="py-3 pr-4 text-left">Fecha Anulación</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.map((entry) => (
                      <tr key={entry.id} className="border-b">
                        <td className="py-2 pl-4 font-mono">{entry.number}</td>
                        <td className="py-2">{formatDateUtc(entry.date)}</td>
                        <td className="py-2">{entry.description}</td>
                        <td className="py-2 text-right font-mono">{formatAmount(entry.totalAmount)}</td>
                        <td className="py-2 font-mono">
                          {entry.reversalEntry?.number ?? '-'}
                        </td>
                        <td className="py-2">
                          {entry.reversalEntry?.date
                            ? formatDateUtc(entry.reversalEntry.date)
                            : '-'}
                        </td>
                        <td className="py-2 text-xs text-muted-foreground">
                          {entry.reversedBy === 'system' ? 'Sistema' : entry.reversedBy?.slice(0, 8) ?? '-'}
                        </td>
                        <td className="py-2 pr-4 text-xs">
                          {entry.reversedAt
                            ? moment(entry.reversedAt).format('DD/MM/YYYY HH:mm')
                            : '-'}
                        </td>
                      </tr>
                    ))}
                    <tr className="border-t bg-muted/30 font-medium">
                      <td colSpan={3} className="py-3 pl-4">
                        {data.length} reversión{data.length !== 1 ? 'es' : ''} en el período
                      </td>
                      <td className="py-3 text-right font-mono">
                        {formatAmount(data.reduce((sum, e) => sum + e.totalAmount, 0))}
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
