'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card';
import { Wallet, TrendingUp, TrendingDown, Target, Landmark, AlertCircle } from 'lucide-react';
import { formatCurrency } from '@/shared/utils/formatters';
import type { CashflowSummary } from '../actions.server';

interface Props {
  summary: CashflowSummary;
}

export function _CashflowSummaryCards({ summary }: Props) {
  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Saldo Actual</CardTitle>
          <Wallet className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{formatCurrency(summary.currentBalance)}</div>
          <p className="text-xs text-muted-foreground">Bancos + Cajas</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Ingresos Proyectados</CardTitle>
          <TrendingUp className="h-4 w-4 text-green-600" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold text-green-600">
            {formatCurrency(summary.totalProjectedInflows)}
          </div>
          <p className="text-xs text-muted-foreground">
            {summary.checksInPortfolio.count > 0 && (
              <span>
                <Landmark className="inline h-3 w-3 mr-1" />
                {summary.checksInPortfolio.count} cheques en cartera (
                {formatCurrency(summary.checksInPortfolio.total)})
              </span>
            )}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Egresos Proyectados</CardTitle>
          <TrendingDown className="h-4 w-4 text-destructive" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold text-destructive">
            {formatCurrency(summary.totalProjectedOutflows)}
          </div>
          {(summary.overdueReceivables.count > 0 || summary.overduePayables.count > 0) && (
            <p className="text-xs text-yellow-600 mt-1">
              <AlertCircle className="inline h-3 w-3 mr-1" />
              {summary.overduePayables.count} pagos vencidos
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Saldo Proyectado</CardTitle>
          <Target className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div
            className={`text-2xl font-bold ${summary.endingProjectedBalance >= 0 ? 'text-green-600' : 'text-destructive'}`}
          >
            {formatCurrency(summary.endingProjectedBalance)}
          </div>
          <div className="mt-1 space-y-0.5">
            <p className="text-xs text-green-600">
              + Ingresos: {formatCurrency(summary.totalProjectedInflows)}
            </p>
            <p className="text-xs text-destructive">
              - Egresos: {formatCurrency(summary.totalProjectedOutflows)}
            </p>
          </div>
          <p className="text-xs text-muted-foreground mt-1">Acumulado desde hoy</p>
        </CardContent>
      </Card>
    </div>
  );
}
