'use client';

import { Button } from '@/shared/components/ui/button';
import { cn } from '@/shared/lib/utils';
import { FileText, Book, BookOpen, Scale, TrendingUp, AlertTriangle, RotateCcw, ArrowLeftRight, Calculator, CalendarRange, Target, Receipt } from 'lucide-react';

export type ReportType =
  | 'trial-balance'
  | 'journal-book'
  | 'general-ledger'
  | 'balance-sheet'
  | 'income-statement'
  | 'monthly-vat'
  | 'entries-without-documents'
  | 'reversal-log'
  | 'document-traceability'
  | 'fixed-assets'
  | 'period-depreciations'
  | 'budget-variance';

interface ReportsSelectorProps {
  selectedReport: ReportType;
  onSelect: (report: ReportType) => void;
}

const financialReports = [
  {
    id: 'trial-balance' as const,
    name: 'Balance de Sumas y Saldos',
    description: 'Muestra los saldos de todas las cuentas',
    icon: FileText,
  },
  {
    id: 'balance-sheet' as const,
    name: 'Balance General',
    description: 'Estado de situación patrimonial',
    icon: Scale,
  },
  {
    id: 'income-statement' as const,
    name: 'Estado de Resultados',
    description: 'Ingresos, gastos y resultado del período',
    icon: TrendingUp,
  },
  {
    id: 'journal-book' as const,
    name: 'Libro Diario',
    description: 'Muestra todos los asientos contables',
    icon: Book,
  },
  {
    id: 'general-ledger' as const,
    name: 'Libro Mayor',
    description: 'Muestra los movimientos por cuenta',
    icon: BookOpen,
  },
];

const fixedAssetReports = [
  {
    id: 'fixed-assets' as const,
    name: 'Registro de Bienes de Uso',
    description: 'Listado de activos fijos con valores y depreciación',
    icon: Calculator,
  },
  {
    id: 'period-depreciations' as const,
    name: 'Depreciaciones del Período',
    description: 'Detalle de depreciaciones contabilizadas por período',
    icon: CalendarRange,
  },
];

const taxReports = [
  {
    id: 'monthly-vat' as const,
    name: 'Posicion Mensual de IVA',
    description: 'Debito fiscal vs credito fiscal del periodo',
    icon: Receipt,
  },
];

const budgetReports = [
  {
    id: 'budget-variance' as const,
    name: 'Variación Presupuestaria',
    description: 'Presupuesto vs ejecutado por cuenta',
    icon: Target,
  },
];

const auditReports = [
  {
    id: 'entries-without-documents' as const,
    name: 'Asientos sin Respaldo',
    description: 'Asientos sin documento comercial vinculado',
    icon: AlertTriangle,
  },
  {
    id: 'reversal-log' as const,
    name: 'Registro de Reversiones',
    description: 'Historial de asientos anulados',
    icon: RotateCcw,
  },
  {
    id: 'document-traceability' as const,
    name: 'Trazabilidad Doc-Asiento',
    description: 'Cruce entre documentos y asientos contables',
    icon: ArrowLeftRight,
  },
];

export function _ReportsSelector({ selectedReport, onSelect }: ReportsSelectorProps) {
  const renderReportButton = (report: (typeof financialReports)[number] | (typeof taxReports)[number] | (typeof budgetReports)[number] | (typeof fixedAssetReports)[number] | (typeof auditReports)[number]) => {
    const Icon = report.icon;
    return (
      <Button
        key={report.id}
        variant={selectedReport === report.id ? 'default' : 'outline'}
        className="flex h-auto w-full flex-row items-center justify-start gap-3 whitespace-normal p-3 text-left"
        onClick={() => onSelect(report.id)}
      >
        <Icon className="h-5 w-5 shrink-0" />
        <div>
          <div className="font-medium">{report.name}</div>
          <div
            className={cn(
              'text-xs',
              selectedReport === report.id
                ? 'text-primary-foreground/80'
                : 'text-muted-foreground',
            )}
          >
            {report.description}
          </div>
        </div>
      </Button>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2">
        {financialReports.map(renderReportButton)}
      </div>

      <div>
        <h3 className="text-sm font-medium text-muted-foreground mb-3">Impositivos</h3>
        <div className="flex flex-col gap-2">
          {taxReports.map(renderReportButton)}
        </div>
      </div>

      <div>
        <h3 className="text-sm font-medium text-muted-foreground mb-3">Presupuestarios</h3>
        <div className="flex flex-col gap-2">
          {budgetReports.map(renderReportButton)}
        </div>
      </div>

      <div>
        <h3 className="text-sm font-medium text-muted-foreground mb-3">Bienes de Uso</h3>
        <div className="flex flex-col gap-2">
          {fixedAssetReports.map(renderReportButton)}
        </div>
      </div>

      <div>
        <h3 className="text-sm font-medium text-muted-foreground mb-3">Auditoría</h3>
        <div className="flex flex-col gap-2">
          {auditReports.map(renderReportButton)}
        </div>
      </div>
    </div>
  );
}
