'use client';

import { useEffect, useState, useTransition } from 'react';
import moment from 'moment';
import Link from 'next/link';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/shared/components/ui/card';
import { Button } from '@/shared/components/ui/button';
import { Skeleton } from '@/shared/components/ui/skeleton';
import { ArrowDownToLine, ArrowUpToLine, TrendingUp, Wallet } from 'lucide-react';
import { getMonthlyBalance } from '../actions.server';
import { formatAmount } from '@/modules/accounting/shared/utils';

interface Props {
  companyId: string;
}

interface IncomeStatementResult {
  revenue: { title: string; accounts: { code: string; name: string; amount: number }[]; total: number };
  expenses: { title: string; accounts: { code: string; name: string; amount: number }[]; total: number };
  grossProfit: number;
  netIncome: number;
}

export function _MonthlyBalanceView({ companyId }: Props) {
  const [selectedMonth, setSelectedMonth] = useState<string>(moment().format('YYYY-MM'));
  const [data, setData] = useState<IncomeStatementResult | null>(null);
  const [isLoading, startTransition] = useTransition();

  const loadBalance = (month: string) => {
    startTransition(async () => {
      try {
        const result = await getMonthlyBalance(month);
        setData(result as IncomeStatementResult);
      } catch {
        // El error ya se loggea en el server action
        setData(null);
      }
    });
  };

  const handleMonthChange = (month: string) => {
    setSelectedMonth(month);
    loadBalance(month);
  };

  const goToCurrentMonth = () => {
    const current = moment().format('YYYY-MM');
    setSelectedMonth(current);
    loadBalance(current);
  };

  // Cargar el mes actual al montar (y si cambia la empresa)
  useEffect(() => {
    loadBalance(selectedMonth);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId]);

  const monthLabel = moment(selectedMonth, 'YYYY-MM').format('MMMM YYYY');
  const isCurrentMonth = selectedMonth === moment().format('YYYY-MM');

  return (
    <div className="space-y-6">
      {/* Header + Selector de mes */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Balance del Mes</h1>
          <p className="text-sm text-muted-foreground">
            Resumen financiero del mes seleccionado (ingresos, gastos y resultado)
          </p>
        </div>
        <div className="flex items-end gap-2">
          <div className="grid gap-1.5">
            <label htmlFor="month-selector" className="text-xs font-medium text-muted-foreground">
              Mes
            </label>
            <input
              id="month-selector"
              type="month"
              value={selectedMonth}
              onChange={(e) => handleMonthChange(e.target.value)}
              max={moment().format('YYYY-MM')}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
          </div>
          {!isCurrentMonth && (
            <Button type="button" variant="outline" onClick={goToCurrentMonth}>
              Mes actual
            </Button>
          )}
        </div>
      </div>

      {/* 3 Cards KPI */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Ingresos</CardTitle>
            <ArrowUpToLine className="h-4 w-4 text-green-600" />
          </CardHeader>
          <CardContent>
            {isLoading && !data ? (
              <Skeleton className="h-8 w-32" />
            ) : (
              <>
                <div className="text-2xl font-bold text-green-600">
                  {formatAmount(data?.revenue.total ?? 0)}
                </div>
                <p className="text-xs text-muted-foreground">
                  {data?.revenue.accounts.length ?? 0} cuenta(s) con movimiento
                </p>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Gastos</CardTitle>
            <ArrowDownToLine className="h-4 w-4 text-red-600" />
          </CardHeader>
          <CardContent>
            {isLoading && !data ? (
              <Skeleton className="h-8 w-32" />
            ) : (
              <>
                <div className="text-2xl font-bold text-red-600">
                  {formatAmount(data?.expenses.total ?? 0)}
                </div>
                <p className="text-xs text-muted-foreground">
                  {data?.expenses.accounts.length ?? 0} cuenta(s) con movimiento
                </p>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Resultado</CardTitle>
            {(data?.netIncome ?? 0) >= 0 ? (
              <TrendingUp className="h-4 w-4 text-green-600" />
            ) : (
              <TrendingUp className="h-4 w-4 text-destructive" />
            )}
          </CardHeader>
          <CardContent>
            {isLoading && !data ? (
              <Skeleton className="h-8 w-32" />
            ) : (
              <>
                <div
                  className={`text-2xl font-bold ${
                    (data?.netIncome ?? 0) >= 0 ? 'text-green-600' : 'text-destructive'
                  }`}
                >
                  {formatAmount(data?.netIncome ?? 0)}
                </div>
                <p className="text-xs text-muted-foreground">
                  {(data?.netIncome ?? 0) >= 0 ? 'Utilidad del período' : 'Pérdida del período'}
                </p>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Detalle por cuenta */}
      <Card>
        <CardHeader>
          <CardTitle>Detalle de {monthLabel}</CardTitle>
          <CardDescription>
            Cuentas con movimiento en el período seleccionado
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {isLoading && !data ? (
            <div className="space-y-3">
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-20 w-full" />
            </div>
          ) : data ? (
            <>
              {/* Ingresos */}
              <div className="rounded-md border">
                <div className="border-b bg-muted px-4 py-2">
                  <h3 className="text-sm font-semibold">{data.revenue.title}</h3>
                </div>
                {data.revenue.accounts.length === 0 ? (
                  <p className="px-4 py-3 text-sm text-muted-foreground">
                    Sin ingresos registrados en este mes
                  </p>
                ) : (
                  <table className="w-full text-sm">
                    <tbody>
                      {data.revenue.accounts.map((account) => (
                        <tr key={account.code} className="border-b last:border-0">
                          <td className="px-4 py-2 text-muted-foreground font-mono text-xs">
                            {account.code}
                          </td>
                          <td className="px-4 py-2">{account.name}</td>
                          <td className="px-4 py-2 text-right font-mono text-green-600">
                            {formatAmount(account.amount)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              {/* Gastos */}
              <div className="rounded-md border">
                <div className="border-b bg-muted px-4 py-2">
                  <h3 className="text-sm font-semibold">{data.expenses.title}</h3>
                </div>
                {data.expenses.accounts.length === 0 ? (
                  <p className="px-4 py-3 text-sm text-muted-foreground">
                    Sin gastos registrados en este mes
                  </p>
                ) : (
                  <table className="w-full text-sm">
                    <tbody>
                      {data.expenses.accounts.map((account) => (
                        <tr key={account.code} className="border-b last:border-0">
                          <td className="px-4 py-2 text-muted-foreground font-mono text-xs">
                            {account.code}
                          </td>
                          <td className="px-4 py-2">{account.name}</td>
                          <td className="px-4 py-2 text-right font-mono text-red-600">
                            {formatAmount(account.amount)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">No se pudo cargar la información</p>
          )}
        </CardContent>
      </Card>

      {/* Link a informes completos */}
      <div className="flex justify-end">
        <Button variant="outline" asChild>
          <Link href="/dashboard/company/accounting/reports">
            <Wallet className="mr-2 h-4 w-4" />
            Ver informes contables completos
          </Link>
        </Button>
      </div>
    </div>
  );
}