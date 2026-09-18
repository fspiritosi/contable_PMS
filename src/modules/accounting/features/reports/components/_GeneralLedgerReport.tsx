'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/components/ui/card';
import { Input } from '@/shared/components/ui/input';
import { Label } from '@/shared/components/ui/label';
import { Button } from '@/shared/components/ui/button';
import { AccountType } from '@/generated/prisma/enums';
import { getGeneralLedger } from '../actions.server';
import { formatAmount } from '../../../shared/utils';
import { useState } from 'react';
import { ChevronRight, ChevronDown, Loader2, Download } from 'lucide-react';
import moment from 'moment';
import { exportToExcel, ExcelColumn } from '@/shared/lib/excel-export';
import { logger } from '@/shared/lib/logger';
import { formatDateUtc } from '@/shared/utils/formatters';

const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  [AccountType.ASSET]: 'Activo',
  [AccountType.LIABILITY]: 'Pasivo',
  [AccountType.EQUITY]: 'Patrimonio',
  [AccountType.REVENUE]: 'Ingresos',
  [AccountType.EXPENSE]: 'Gastos',
};

interface GeneralLedgerReportProps {
  companyId: string;
}

export function _GeneralLedgerReport({ companyId }: GeneralLedgerReportProps) {
  const [fromDate, setFromDate] = useState<string>(
    moment().startOf('month').format('YYYY-MM-DD')
  );
  const [toDate, setToDate] = useState<string>(
    moment().format('YYYY-MM-DD')
  );
  const [isLoading, setIsLoading] = useState(false);
  const [data, setData] = useState<Awaited<ReturnType<typeof getGeneralLedger>> | null>(null);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      const result = await getGeneralLedger(
        companyId,
        new Date(fromDate),
        new Date(toDate)
      );
      setData(result);
    } catch (error) {
      logger.error('Error al obtener libro mayor', { data: { error } });
    } finally {
      setIsLoading(false);
    }
  };

  const handleExport = async () => {
    if (!data || data.length === 0) return;

    const flatData = data.flatMap((account) => {
      const rows: {
        accountCode: string;
        accountName: string;
        date: Date | null;
        entryNumber: number;
        description: string;
        debit: number;
        credit: number;
        balance: number;
      }[] = [];

      if (account.openingBalance !== 0) {
        rows.push({
          accountCode: account.code,
          accountName: account.name,
          date: null,
          entryNumber: 0,
          description: 'Saldo anterior',
          debit: 0,
          credit: 0,
          balance: account.openingBalance,
        });
      }

      for (const entry of account.entries) {
        rows.push({
          accountCode: account.code,
          accountName: account.name,
          date: entry.date,
          entryNumber: entry.entryNumber,
          description: entry.description || '',
          debit: entry.debit,
          credit: entry.credit,
          balance: entry.balance,
        });
      }

      rows.push({
        accountCode: account.code,
        accountName: 'TOTAL',
        date: null,
        entryNumber: 0,
        description: '',
        debit: account.totalDebit,
        credit: account.totalCredit,
        balance: account.balance,
      });

      return rows;
    });

    const columns: ExcelColumn[] = [
      { key: 'accountCode', title: 'Codigo', width: 12 },
      { key: 'accountName', title: 'Cuenta', width: 25 },
      {
        key: 'date',
        title: 'Fecha',
        width: 12,
        formatter: (value) => value ? formatDateUtc(value as Date) : '',
      },
      { key: 'entryNumber', title: 'Asiento', width: 10, formatter: (v) => v ? String(v) : '' },
      { key: 'description', title: 'Descripcion', width: 30 },
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
      {
        key: 'balance',
        title: 'Saldo',
        width: 15,
        formatter: (value) => (value as number).toFixed(2),
      },
    ];

    await exportToExcel(flatData, columns, {
      filename: `libro-mayor-${moment().format('YYYY-MM-DD')}`,
      sheetName: 'Libro Mayor',
      title: 'Libro Mayor',
      includeDate: true,
    });
  };

  const toggleRow = (accountId: string) => {
    const newExpanded = new Set(expandedRows);
    if (newExpanded.has(accountId)) {
      newExpanded.delete(accountId);
    } else {
      newExpanded.add(accountId);
    }
    setExpandedRows(newExpanded);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Libro Mayor</CardTitle>
        <CardDescription>
          Muestra los movimientos por cuenta en un periodo
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
                  <th className="py-3 pl-4 text-left">Codigo</th>
                  <th className="py-3 text-left">Nombre</th>
                  <th className="py-3 text-left">Tipo</th>
                  <th className="py-3 text-right">Debe</th>
                  <th className="py-3 text-right">Haber</th>
                  <th className="py-3 pr-4 text-right">Saldo</th>
                </tr>
              </thead>
              <tbody>
                {data.map((account) => {
                  const isExpanded = expandedRows.has(account.id);

                  return (
                    <>
                      <tr key={account.id}>
                        <td className="py-2">
                          <div className="flex items-center">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6"
                              onClick={() => toggleRow(account.id)}
                            >
                              {isExpanded ? (
                                <ChevronDown className="h-4 w-4" />
                              ) : (
                                <ChevronRight className="h-4 w-4" />
                              )}
                            </Button>
                            <span className="ml-2">{account.code}</span>
                          </div>
                        </td>
                        <td>{account.name}</td>
                        <td>{ACCOUNT_TYPE_LABELS[account.type]}</td>
                        <td className="text-right">{formatAmount(account.totalDebit)}</td>
                        <td className="text-right">{formatAmount(account.totalCredit)}</td>
                        <td className="py-2 pr-4 text-right">
                          <span
                            className={
                              account.balance < 0
                                ? 'text-destructive'
                                : account.balance > 0
                                ? 'text-green-600'
                                : ''
                            }
                          >
                            {formatAmount(account.balance)}
                          </span>
                        </td>
                      </tr>
                      {isExpanded && (
                        <>
                          <tr className="bg-muted/50">
                            <td className="py-2 pl-12" colSpan={3}>
                              Fecha
                            </td>
                            <td className="py-2 text-right">Debe</td>
                            <td className="py-2 text-right">Haber</td>
                            <td className="py-2 pr-4 text-right">Saldo</td>
                          </tr>
                          {account.openingBalance !== 0 && (
                            <tr className="bg-blue-50/50 dark:bg-blue-950/20">
                              <td className="py-2 pl-12 italic text-muted-foreground" colSpan={3}>
                                Saldo anterior
                              </td>
                              <td className="text-right" />
                              <td className="text-right" />
                              <td className="py-2 pr-4 text-right italic">
                                {formatAmount(account.openingBalance)}
                              </td>
                            </tr>
                          )}
                          {account.entries.map((entry) => (
                            <tr key={`${account.id}-${entry.entryNumber}`} className="bg-muted/30">
                              <td className="py-2 pl-12" colSpan={3}>
                                <div>
                                  {formatDateUtc(entry.date)}
                                  <span className="ml-4 text-sm text-muted-foreground">
                                    Asiento N° {entry.entryNumber}
                                  </span>
                                  <p className="text-sm text-muted-foreground">
                                    {entry.description}
                                  </p>
                                </div>
                              </td>
                              <td className="text-right">
                                {entry.debit > 0 ? formatAmount(entry.debit) : ''}
                              </td>
                              <td className="text-right">
                                {entry.credit > 0 ? formatAmount(entry.credit) : ''}
                              </td>
                              <td className="py-2 pr-4 text-right">
                                <span
                                  className={
                                    entry.balance < 0
                                      ? 'text-destructive'
                                      : entry.balance > 0
                                      ? 'text-green-600'
                                      : ''
                                  }
                                >
                                  {formatAmount(entry.balance)}
                                </span>
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
