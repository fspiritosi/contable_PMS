'use client';

import { formatCurrency } from '@/shared/utils/formatters';

export interface PreviewLine {
  id: string;
  name: string;
  accountCode: string;
  diff: number;
}

/** Vista previa del asiento: por tenencia, la contrapartida es el resultado por tenencia. */
export function _ValuationEntryPreview({ lines }: { lines: PreviewLine[] }) {
  const withDiff = lines.filter((l) => l.diff !== 0);
  const gains = withDiff.filter((l) => l.diff > 0).reduce((sum, l) => sum + l.diff, 0);
  const losses = withDiff.filter((l) => l.diff < 0).reduce((sum, l) => sum - l.diff, 0);

  if (withDiff.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Sin diferencias: no se genera asiento, solo se deja registrada la valuación.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
        <span>
          Ganancia por tenencia: <strong>{formatCurrency(gains)}</strong>
        </span>
        <span>
          Pérdida por tenencia:{' '}
          <strong className="text-destructive">{formatCurrency(losses)}</strong>
        </span>
      </div>
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left">
            <tr>
              <th className="p-2 font-medium">Cuenta</th>
              <th className="p-2 text-right font-medium">Debe</th>
              <th className="p-2 text-right font-medium">Haber</th>
            </tr>
          </thead>
          <tbody>
            {withDiff.map((l) => {
              const amount = formatCurrency(Math.abs(l.diff));
              const holding = `${l.accountCode} · ${l.name}`;
              const result =
                l.diff > 0 ? 'Resultado positivo por tenencia' : 'Resultado negativo por tenencia';
              const rows =
                l.diff > 0
                  ? [
                      { label: holding, debit: amount, credit: '' },
                      { label: result, debit: '', credit: amount },
                    ]
                  : [
                      { label: result, debit: amount, credit: '' },
                      { label: holding, debit: '', credit: amount },
                    ];
              return rows.map((r, i) => (
                <tr key={`${l.id}-${i}`} className="border-t">
                  <td className={i === 1 ? 'p-2 pl-6' : 'p-2'}>{r.label}</td>
                  <td className="p-2 text-right">{r.debit}</td>
                  <td className="p-2 text-right">{r.credit}</td>
                </tr>
              ));
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
