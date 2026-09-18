'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/components/ui/card';
import { Input } from '@/shared/components/ui/input';
import { Label } from '@/shared/components/ui/label';
import { Button } from '@/shared/components/ui/button';
import { JournalEntryStatus } from '@/generated/prisma/enums';
import { getJournalBook } from '../actions.server';
import { formatAmount } from '../../../shared/utils';
import { useState } from 'react';
import { ChevronRight, ChevronDown, Loader2, Download } from 'lucide-react';
import moment from 'moment';
import { exportToExcel, ExcelColumn } from '@/shared/lib/excel-export';
import { logger } from '@/shared/lib/logger';
import { formatDateUtc } from '@/shared/utils/formatters';

interface JournalBookReportProps {
  companyId: string;
}

export function _JournalBookReport({ companyId }: JournalBookReportProps) {
  const [fromDate, setFromDate] = useState<string>(
    moment().startOf('month').format('YYYY-MM-DD')
  );
  const [toDate, setToDate] = useState<string>(
    moment().format('YYYY-MM-DD')
  );
  const [isLoading, setIsLoading] = useState(false);
  const [data, setData] = useState<Awaited<ReturnType<typeof getJournalBook>> | null>(null);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      const result = await getJournalBook(
        companyId,
        new Date(fromDate),
        new Date(toDate)
      );
      setData(result);
    } catch (error) {
      logger.error('Error al obtener libro diario', { data: { error } });
    } finally {
      setIsLoading(false);
    }
  };

  const handleExport = async () => {
    if (!data || data.length === 0) return;

    const flatData = data.flatMap((entry) =>
      entry.lines.map((line) => ({
        entryNumber: entry.number,
        entryDate: entry.date,
        entryDescription: entry.description,
        accountCode: line.account.code,
        accountName: line.account.name,
        lineDescription: line.description || '',
        debit: Number(line.debit),
        credit: Number(line.credit),
      }))
    );

    const columns: ExcelColumn[] = [
      { key: 'entryNumber', title: 'Asiento', width: 10 },
      {
        key: 'entryDate',
        title: 'Fecha',
        width: 12,
        formatter: (value) => formatDateUtc(value as Date),
      },
      { key: 'entryDescription', title: 'Descripcion', width: 30 },
      { key: 'accountCode', title: 'Codigo', width: 12 },
      { key: 'accountName', title: 'Cuenta', width: 25 },
      { key: 'lineDescription', title: 'Detalle', width: 20 },
      {
        key: 'debit',
        title: 'Debe',
        width: 15,
        formatter: (value) => (value as number).toFixed(2),
      },
      {
        key: 'credit',
        title: 'Haber',
        width: 15,
        formatter: (value) => (value as number).toFixed(2),
      },
    ];

    await exportToExcel(flatData, columns, {
      filename: `libro-diario-${moment().format('YYYY-MM-DD')}`,
      sheetName: 'Libro Diario',
      title: 'Libro Diario',
      includeDate: true,
    });
  };

  const toggleRow = (entryId: string) => {
    const newExpanded = new Set(expandedRows);
    if (newExpanded.has(entryId)) {
      newExpanded.delete(entryId);
    } else {
      newExpanded.add(entryId);
    }
    setExpandedRows(newExpanded);
  };

  const getStatusLabel = (status: JournalEntryStatus) => {
    const labels = {
      [JournalEntryStatus.DRAFT]: 'Borrador',
      [JournalEntryStatus.POSTED]: 'Registrado',
      [JournalEntryStatus.REVERSED]: 'Anulado',
    };
    return labels[status];
  };

  const getStatusColor = (status: JournalEntryStatus) => {
    const colors = {
      [JournalEntryStatus.DRAFT]: 'text-yellow-600',
      [JournalEntryStatus.POSTED]: 'text-green-600',
      [JournalEntryStatus.REVERSED]: 'text-red-600',
    };
    return colors[status];
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Libro Diario</CardTitle>
        <CardDescription>
          Muestra todos los asientos contables en un periodo
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
            {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Generar
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={handleExport}
            disabled={isLoading || !data || data.length === 0}
            title="Exportar a Excel"
          >
            <Download className="h-4 w-4" />
          </Button>
        </form>

        {data && (
          <div className="rounded-md border">
            <table className="w-full">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="py-3 pl-4 text-left">Numero</th>
                  <th className="py-3 text-left">Fecha</th>
                  <th className="py-3 text-left">Descripcion</th>
                  <th className="py-3 text-left">Estado</th>
                  <th className="py-3 text-right">Importe</th>
                </tr>
              </thead>
              <tbody>
                {data.map((entry) => {
                  const isExpanded = expandedRows.has(entry.id);
                  const totalDebit = entry.lines.reduce(
                    (sum, line) => sum + Number(line.debit),
                    0
                  );

                  return (
                    <>
                      <tr
                        key={entry.id}
                        className={entry.status === JournalEntryStatus.REVERSED ? 'opacity-50' : undefined}
                      >
                        <td className="py-2">
                          <div className="flex items-center">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6"
                              onClick={() => toggleRow(entry.id)}
                            >
                              {isExpanded ? (
                                <ChevronDown className="h-4 w-4" />
                              ) : (
                                <ChevronRight className="h-4 w-4" />
                              )}
                            </Button>
                            <span className="ml-2">{entry.number}</span>
                          </div>
                        </td>
                        <td>{formatDateUtc(entry.date)}</td>
                        <td>{entry.description}</td>
                        <td className={getStatusColor(entry.status)}>
                          {getStatusLabel(entry.status)}
                        </td>
                        <td className="text-right pr-4">{formatAmount(totalDebit)}</td>
                      </tr>
                      {isExpanded && (
                        <>
                          {entry.lines.map((line) => (
                            <tr key={line.id} className="bg-muted/30">
                              <td className="py-2" />
                              <td colSpan={2}>
                                <div className="ml-8">
                                  {line.account.code} - {line.account.name}
                                  {line.description && (
                                    <p className="text-sm text-muted-foreground">
                                      {line.description}
                                    </p>
                                  )}
                                </div>
                              </td>
                              <td />
                              <td className="text-right pr-4">
                                {Number(line.debit) > 0
                                  ? formatAmount(Number(line.debit))
                                  : formatAmount(-Number(line.credit))}
                              </td>
                            </tr>
                          ))}
                        </>
                      )}
                    </>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
