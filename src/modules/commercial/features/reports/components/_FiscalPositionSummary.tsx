'use client';

import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/components/ui/card';
import { Button } from '@/shared/components/ui/button';
import { Input } from '@/shared/components/ui/input';
import { Skeleton } from '@/shared/components/ui/skeleton';
import { Badge } from '@/shared/components/ui/badge';
import { ArrowDownRight, ArrowUpRight, Search, TrendingDown, TrendingUp, Scale } from 'lucide-react';
import moment from 'moment';
import { toast } from 'sonner';
import { formatCurrency } from '@/shared/utils/formatters';
import { getIVAPositionReport } from '../actions.server';
import type { FiscalPositionResult } from '../types';

export function _FiscalPositionSummary() {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<FiscalPositionResult | null>(null);
  const [fromDate, setFromDate] = useState(moment().startOf('month').format('YYYY-MM-DD'));
  const [toDate, setToDate] = useState(moment().endOf('month').format('YYYY-MM-DD'));

  const handleGenerate = async () => {
    if (!fromDate || !toDate) {
      toast.error('Selecciona las fechas');
      return;
    }

    try {
      setLoading(true);
      const from = new Date(fromDate + 'T00:00:00');
      const to = new Date(toDate + 'T23:59:59');
      const result = await getIVAPositionReport(from, to);
      setData(result);
      toast.success('Reporte generado correctamente');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Error al generar el reporte');
      setData(null);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Filtros */}
      <Card>
        <CardHeader>
          <CardTitle>Posición Fiscal IVA</CardTitle>
          <CardDescription>
            Calcula la diferencia entre IVA Débito Fiscal (ventas) e IVA Crédito Fiscal (compras)
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 grid-cols-1 sm:grid-cols-3">
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
                {loading ? 'Calculando...' : 'Calcular'}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Loading */}
      {loading && (
        <div className="grid gap-4 grid-cols-1 sm:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="pt-6">
                <Skeleton className="h-20 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Resultados */}
      {!loading && data && (
        <>
          {/* Cards resumen */}
          <div className="grid gap-4 grid-cols-1 sm:grid-cols-3">
            {/* IVA Débito Fiscal */}
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">IVA Débito Fiscal</CardTitle>
                <TrendingUp className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{formatCurrency(data.ivaVentas)}</div>
                <p className="text-xs text-muted-foreground mt-1">
                  IVA generado por las ventas del período
                </p>
              </CardContent>
            </Card>

            {/* IVA Crédito Fiscal */}
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">IVA Crédito Fiscal</CardTitle>
                <TrendingDown className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{formatCurrency(data.ivaCompras)}</div>
                <p className="text-xs text-muted-foreground mt-1">
                  IVA pagado en las compras del período
                </p>
              </CardContent>
            </Card>

            {/* Posición */}
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Posición Fiscal</CardTitle>
                <Scale className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-2">
                  <span className="text-2xl font-bold">
                    {formatCurrency(Math.abs(data.posicion))}
                  </span>
                  {data.posicion > 0 ? (
                    <Badge variant="destructive" className="gap-1">
                      <ArrowUpRight className="h-3 w-3" />
                      A pagar
                    </Badge>
                  ) : data.posicion < 0 ? (
                    <Badge variant="secondary" className="gap-1">
                      <ArrowDownRight className="h-3 w-3" />
                      A favor
                    </Badge>
                  ) : (
                    <Badge variant="outline">Neutro</Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {data.posicion > 0
                    ? 'Débito Fiscal mayor que Crédito Fiscal'
                    : data.posicion < 0
                      ? 'Crédito Fiscal mayor que Débito Fiscal'
                      : 'Débito y Crédito Fiscal equilibrados'}
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Detalle por alícuota */}
          {data.detailByRate.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Detalle por Alícuota</CardTitle>
                <CardDescription>
                  Período: {moment(fromDate).format('DD/MM/YYYY')} al{' '}
                  {moment(toDate).format('DD/MM/YYYY')}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="border-b">
                      <tr className="text-left">
                        <th className="pb-3">Alícuota</th>
                        <th className="pb-3 text-right">Base Imp. Ventas</th>
                        <th className="pb-3 text-right">IVA Ventas</th>
                        <th className="pb-3 text-right">Base Imp. Compras</th>
                        <th className="pb-3 text-right">IVA Compras</th>
                        <th className="pb-3 text-right">Posición</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {data.detailByRate.map((detail) => (
                        <tr key={detail.rate}>
                          <td className="py-3 font-semibold">{detail.rate}%</td>
                          <td className="py-3 text-right font-mono">
                            {formatCurrency(detail.salesBase)}
                          </td>
                          <td className="py-3 text-right font-mono">
                            {formatCurrency(detail.salesVAT)}
                          </td>
                          <td className="py-3 text-right font-mono">
                            {formatCurrency(detail.purchasesBase)}
                          </td>
                          <td className="py-3 text-right font-mono">
                            {formatCurrency(detail.purchasesVAT)}
                          </td>
                          <td className="py-3 text-right font-mono font-semibold">
                            {formatCurrency(detail.position)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="border-t-2 font-semibold">
                      <tr>
                        <td className="pt-3">TOTAL</td>
                        <td className="pt-3 text-right font-mono">
                          {formatCurrency(
                            data.detailByRate.reduce((s, d) => s + d.salesBase, 0)
                          )}
                        </td>
                        <td className="pt-3 text-right font-mono">
                          {formatCurrency(data.ivaVentas)}
                        </td>
                        <td className="pt-3 text-right font-mono">
                          {formatCurrency(
                            data.detailByRate.reduce((s, d) => s + d.purchasesBase, 0)
                          )}
                        </td>
                        <td className="pt-3 text-right font-mono">
                          {formatCurrency(data.ivaCompras)}
                        </td>
                        <td className="pt-3 text-right font-mono">
                          {formatCurrency(data.posicion)}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
