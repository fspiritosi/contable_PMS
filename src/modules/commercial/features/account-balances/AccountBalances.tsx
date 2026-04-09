'use client';

import { useCallback, useEffect, useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/components/ui/tabs';
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card';
import { Button } from '@/shared/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui/select';
import { AlertTriangle, Calendar, ChevronLeft, ChevronRight, DollarSign, Loader2, TrendingDown, TrendingUp, X } from 'lucide-react';
import { toast } from 'sonner';
import moment from 'moment';
import 'moment/locale/es';
import { getAccountsReceivable, getAccountsPayable } from './actions.server';
import { _ReceivableTable } from './components/_ReceivableTable';
import { _PayableTable } from './components/_PayableTable';
import { formatCurrency } from '@/shared/utils/formatters';

moment.locale('es');

type ReportData = Awaited<ReturnType<typeof getAccountsReceivable>> | Awaited<ReturnType<typeof getAccountsPayable>> | null;

const MONTHS = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

export function AccountBalances() {
  const [activeTab, setActiveTab] = useState<'receivable' | 'payable'>('receivable');
  const [loading, setLoading] = useState(false);
  const [receivableData, setReceivableData] = useState<Awaited<ReturnType<typeof getAccountsReceivable>> | null>(null);
  const [payableData, setPayableData] = useState<Awaited<ReturnType<typeof getAccountsPayable>> | null>(null);

  // Filtro de mes: null = todas las fechas (sin filtro)
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null);
  const [overdueOnly, setOverdueOnly] = useState(false);

  const thisYear = moment().year();
  const years = [thisYear, thisYear - 1, thisYear - 2];
  const activeMonthIdx = selectedMonth ? moment(selectedMonth, 'YYYY-MM').month() : null;
  const activeYear = selectedMonth ? moment(selectedMonth, 'YYYY-MM').year() : thisYear;
  const isCurrentMonth = selectedMonth === moment().format('YYYY-MM');

  const getDateRange = useCallback(() => {
    if (!selectedMonth) return { startDate: undefined, endDate: undefined };
    const start = moment(selectedMonth, 'YYYY-MM').startOf('month').toDate();
    const end = moment(selectedMonth, 'YYYY-MM').endOf('month').toDate();
    return { startDate: start, endDate: end };
  }, [selectedMonth]);

  const fetchReport = useCallback(async (type: 'receivable' | 'payable') => {
    try {
      setLoading(true);
      const { startDate, endDate } = getDateRange();
      if (type === 'receivable') {
        const data = await getAccountsReceivable(startDate, endDate, overdueOnly);
        setReceivableData(data);
      } else {
        const data = await getAccountsPayable(startDate, endDate, overdueOnly);
        setPayableData(data);
      }
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Error al generar el reporte'
      );
    } finally {
      setLoading(false);
    }
  }, [getDateRange, overdueOnly]);

  // Generar reporte automáticamente al montar y al cambiar filtros
  useEffect(() => {
    fetchReport(activeTab);
  }, [selectedMonth, overdueOnly]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleTabChange = (tab: string) => {
    const t = tab as 'receivable' | 'payable';
    setActiveTab(t);
    // Si no hay datos para esta tab, cargar
    if (t === 'receivable' && !receivableData) fetchReport(t);
    if (t === 'payable' && !payableData) fetchReport(t);
  };

  const handleMonthChange = (month: string | null) => {
    setSelectedMonth(month);
    setReceivableData(null);
    setPayableData(null);
  };

  const handleOverdueToggle = () => {
    setOverdueOnly((prev) => !prev);
    setReceivableData(null);
    setPayableData(null);
  };

  const handlePrev = () => {
    const base = selectedMonth ? moment(selectedMonth, 'YYYY-MM') : moment();
    handleMonthChange(base.subtract(1, 'month').format('YYYY-MM'));
  };

  const handleNext = () => {
    const base = selectedMonth ? moment(selectedMonth, 'YYYY-MM') : moment();
    handleMonthChange(base.add(1, 'month').format('YYYY-MM'));
  };

  const currentData: ReportData = activeTab === 'receivable' ? receivableData : payableData;

  const periodLabel = selectedMonth
    ? moment(selectedMonth, 'YYYY-MM').format('MMMM YYYY')
    : 'Todas las fechas';

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Saldos Pendientes</h1>
        <p className="text-muted-foreground">
          Reportes de pendiente de cobranza y pendiente de pago
        </p>
      </div>

      {/* Filtro de Mes */}
      <div className="flex flex-wrap items-center gap-2">
        <Calendar className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm text-muted-foreground">Período:</span>

        <Button
          variant="outline"
          size="sm"
          className="h-7 w-7 p-0"
          onClick={handlePrev}
          title="Mes anterior"
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>

        <Button
          variant={isCurrentMonth ? 'default' : 'secondary'}
          size="sm"
          className="h-7 text-xs"
          onClick={() => handleMonthChange(moment().format('YYYY-MM'))}
        >
          Actual
        </Button>

        <Button
          variant="outline"
          size="sm"
          className="h-7 w-7 p-0"
          onClick={handleNext}
          title="Mes siguiente"
        >
          <ChevronRight className="h-4 w-4" />
        </Button>

        <div className="flex items-center gap-1">
          <Select
            value={activeMonthIdx !== null ? String(activeMonthIdx) : ''}
            onValueChange={(v) => {
              const newPeriod = moment({ year: activeYear, month: parseInt(v) }).format('YYYY-MM');
              handleMonthChange(newPeriod);
            }}
          >
            <SelectTrigger className="h-7 w-[110px] text-xs">
              <SelectValue placeholder="Mes" />
            </SelectTrigger>
            <SelectContent>
              {MONTHS.map((name, idx) => (
                <SelectItem key={idx} value={String(idx)}>
                  {name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={selectedMonth ? String(activeYear) : ''}
            onValueChange={(v) => {
              const month = activeMonthIdx ?? moment().month();
              const newPeriod = moment({ year: parseInt(v), month }).format('YYYY-MM');
              handleMonthChange(newPeriod);
            }}
          >
            <SelectTrigger className="h-7 w-[80px] text-xs">
              <SelectValue placeholder="Año" />
            </SelectTrigger>
            <SelectContent>
              {years.map((y) => (
                <SelectItem key={y} value={String(y)}>
                  {y}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {selectedMonth && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs"
            onClick={() => handleMonthChange(null)}
          >
            <X className="mr-1 h-3 w-3" />
            Todas
          </Button>
        )}

        <div className="h-4 w-px bg-border" />

        <Button
          variant={overdueOnly ? 'destructive' : 'outline'}
          size="sm"
          className="h-7 text-xs gap-1"
          onClick={handleOverdueToggle}
        >
          <AlertTriangle className="h-3 w-3" />
          Vencidas
        </Button>

        {loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
      </div>

      <Tabs value={activeTab} onValueChange={handleTabChange}>
        <TabsList>
          <TabsTrigger value="receivable" className="gap-2">
            <TrendingUp className="h-4 w-4" />
            Pendiente de Cobranza
          </TabsTrigger>
          <TabsTrigger value="payable" className="gap-2">
            <TrendingDown className="h-4 w-4" />
            Pendiente de Pago
          </TabsTrigger>
        </TabsList>

        {/* Summary Cards */}
        {currentData && (
          <div className="mt-4 grid gap-4 md:grid-cols-3">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Total Facturado</CardTitle>
                <DollarSign className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {formatCurrency(currentData.totals.totalAmount)}
                </div>
                <p className="text-xs text-muted-foreground">
                  {currentData.totals.invoiceCount} comprobantes
                  {selectedMonth && ` - ${periodLabel}`}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Total Cobrado/Pagado</CardTitle>
                <DollarSign className="h-4 w-4 text-green-600" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-green-600">
                  {formatCurrency(currentData.totals.totalPaid)}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Total Pendiente</CardTitle>
                <DollarSign className="h-4 w-4 text-destructive" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-destructive">
                  {formatCurrency(currentData.totals.totalPending)}
                </div>
                <p className="text-xs text-muted-foreground">
                  {'customerCount' in currentData.totals
                    ? `${currentData.totals.customerCount} clientes`
                    : `${'supplierCount' in currentData.totals ? currentData.totals.supplierCount : 0} proveedores`}
                </p>
              </CardContent>
            </Card>
          </div>
        )}

        <TabsContent value="receivable" className="mt-4">
          {receivableData ? (
            <_ReceivableTable data={receivableData} />
          ) : !loading ? (
            <Card>
              <CardContent className="pt-6">
                <p className="text-center text-muted-foreground py-8">
                  Cargando reporte...
                </p>
              </CardContent>
            </Card>
          ) : null}
        </TabsContent>

        <TabsContent value="payable" className="mt-4">
          {payableData ? (
            <_PayableTable data={payableData} />
          ) : !loading ? (
            <Card>
              <CardContent className="pt-6">
                <p className="text-center text-muted-foreground py-8">
                  Cargando reporte...
                </p>
              </CardContent>
            </Card>
          ) : null}
        </TabsContent>
      </Tabs>
    </div>
  );
}
