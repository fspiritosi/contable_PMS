'use client';

import { AlertTriangle } from 'lucide-react';
import type { UseFormReturn } from 'react-hook-form';

import { Input } from '@/shared/components/ui/input';
import { formatCurrency } from '@/shared/utils/formatters';

import { INSTRUMENT_TYPE_LABELS } from '../../shared/types';
import type { ValuationData, ValuationFormInput } from '../validators';
import type { ValuationCandidate } from '../valuation.server';

export interface PreviewRow {
  holding: ValuationCandidate;
  value: number | null;
  diff: number;
}

interface Props {
  form: UseFormReturn<ValuationFormInput, unknown, ValuationData>;
  preview: PreviewRow[];
}

export function _ValuationLinesTable({ form, preview }: Props) {
  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-left">
          <tr>
            <th className="p-2 font-medium">Tenencia</th>
            <th className="p-2 text-right font-medium">Valor en libros</th>
            <th className="p-2 text-right font-medium">Nominales</th>
            <th className="p-2 font-medium">Valuación</th>
            <th className="p-2 text-right font-medium">Valor al cierre</th>
            <th className="p-2 text-right font-medium">Diferencia</th>
          </tr>
        </thead>
        <tbody>
          {preview.map(({ holding, value, diff }, i) => {
            const hasUnits = holding.nominals !== null && holding.nominals > 0;
            const field = hasUnits ? 'unitPrice' : 'valuedAmount';
            return (
              <tr key={holding.id} className="border-t align-top">
                <td className="p-2">
                  <div className="font-medium">{holding.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {INSTRUMENT_TYPE_LABELS[holding.instrumentType]} · {holding.custody}
                  </div>
                  {holding.laterSales.length > 0 && (
                    <div className="mt-1 flex items-center gap-1 text-xs text-destructive">
                      <AlertTriangle className="h-3 w-3" />
                      Ventas posteriores: {holding.laterSales.join(', ')}
                    </div>
                  )}
                </td>
                <td className="p-2 text-right">{formatCurrency(holding.bookValue)}</td>
                <td className="p-2 text-right">{holding.nominals ?? '—'}</td>
                <td className="p-2">
                  <Input
                    inputMode="decimal"
                    className="min-w-32"
                    placeholder={hasUnits ? 'Precio por nominal' : 'Valor al cierre'}
                    aria-label={`${hasUnits ? 'Precio por nominal' : 'Valor al cierre'} de ${holding.name}`}
                    {...form.register(`lines.${i}.${field}`)}
                  />
                </td>
                <td className="p-2 text-right">{value === null ? '—' : formatCurrency(value)}</td>
                <td
                  className={`p-2 text-right font-medium ${diff < 0 ? 'text-destructive' : diff > 0 ? 'text-green-600' : ''}`}
                >
                  {value === null ? '—' : `${diff > 0 ? '+' : ''}${formatCurrency(diff)}`}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
