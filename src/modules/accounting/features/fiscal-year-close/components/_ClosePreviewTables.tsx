'use client';

import { Badge } from '@/shared/components/ui/badge';
import type { ReactNode } from 'react';

import { formatAmount } from '../../../shared/utils';
import { formatDayUtc } from '../../../shared/utils/utc-month';
import type { ClosePreview, ClosingLine } from '../fiscal-year-close-common';

function LinesTable({ lines }: { lines: ClosingLine[] }) {
  const total = (side: 'debit' | 'credit') => lines.reduce((sum, line) => sum + line[side], 0);
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[420px] text-sm">
        <thead>
          <tr className="border-b bg-muted/50">
            <th className="py-2 pl-3 text-left">Cuenta</th>
            <th className="py-2 text-right">Debe</th>
            <th className="py-2 pr-3 text-right">Haber</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line) => (
            <tr key={line.accountId} className="border-b">
              <td className="py-1.5 pl-3">
                <span className="font-mono text-xs">{line.accountCode}</span> {line.accountName}
              </td>
              <td className="py-1.5 text-right font-mono">
                {line.debit > 0 ? formatAmount(line.debit) : ''}
              </td>
              <td className="py-1.5 pr-3 text-right font-mono">
                {line.credit > 0 ? formatAmount(line.credit) : ''}
              </td>
            </tr>
          ))}
          <tr className="bg-muted/30 font-medium">
            <td className="py-2 pl-3">Total</td>
            <td className="py-2 text-right font-mono">{formatAmount(total('debit'))}</td>
            <td className="py-2 pr-3 text-right font-mono">{formatAmount(total('credit'))}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function SummaryBox({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rounded-md border p-3 text-center">
      <p className="text-xs text-muted-foreground">{label}</p>
      {children}
    </div>
  );
}

/**
 * Vista previa del cierre (TSK-760, Fase 9): resumen del resultado, la refundición que se
 * registra el último día del ejercicio y la apertura del ejercicio siguiente.
 */
export function _ClosePreviewTables({ preview }: { preview: ClosePreview }) {
  const { fiscalYear } = preview;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <SummaryBox label="Ingresos">
          <p className="font-mono text-sm font-medium text-green-600">
            {formatAmount(preview.totalRevenue)}
          </p>
        </SummaryBox>
        <SummaryBox label="Gastos">
          <p className="font-mono text-sm font-medium text-red-600">
            {formatAmount(preview.totalExpense)}
          </p>
        </SummaryBox>
        <SummaryBox label={preview.netResult >= 0 ? 'Ganancia' : 'Pérdida'}>
          <Badge variant={preview.netResult >= 0 ? 'default' : 'destructive'}>
            {formatAmount(preview.netResult)}
          </Badge>
        </SummaryBox>
      </div>

      <section className="space-y-1">
        <p className="text-sm font-medium">
          Refundición de resultados ({formatDayUtc(fiscalYear.endDay)})
        </p>
        <div className="rounded-md border">
          <LinesTable lines={preview.closingLines} />
        </div>
      </section>

      {preview.openingLines.length > 0 ? (
        <details className="rounded-md border">
          <summary className="cursor-pointer px-3 py-2 text-sm font-medium hover:bg-muted/50">
            Apertura del ejercicio N° {fiscalYear.number + 1} ({formatDayUtc(preview.openingDay)},{' '}
            {preview.openingLines.length} líneas)
          </summary>
          <LinesTable lines={preview.openingLines} />
        </details>
      ) : (
        <p className="text-sm text-muted-foreground">
          No hay saldos patrimoniales: no se genera asiento de apertura.
        </p>
      )}
    </div>
  );
}
