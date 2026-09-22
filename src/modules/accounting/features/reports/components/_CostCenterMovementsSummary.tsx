'use client';

import { AlertTriangle } from 'lucide-react';

import { formatAmount } from '../../../shared/utils';
import type {
  CostCenterMovementTotals,
  DraftsSummary,
} from '../../../shared/utils/cost-center-movements';

interface CostCenterMovementsSummaryProps {
  totals: CostCenterMovementTotals;
  draftsExcluded: DraftsSummary;
  /** `true` cuando hay al menos una fila de detalle en algún grupo. */
  hasRows: boolean;
  /** Qué se eligió en el selector, para redactar el aviso sin mentir el alcance. */
  scope: 'one' | 'all' | 'none';
}

/** Cómo nombrar lo consultado en los textos, según el selector. */
const SCOPE_LABELS: Record<CostCenterMovementsSummaryProps['scope'], string> = {
  one: 'de este centro',
  all: 'de los centros de costo',
  none: 'sin centro de costo',
};

/** Cómo impactan los borradores excluidos, para redactar el aviso. */
function draftsImpact(saldo: number): string {
  if (saldo > 0) return `por ${formatAmount(saldo)} en entradas`;
  if (saldo < 0) return `por ${formatAmount(Math.abs(saldo))} en salidas`;
  return 'sin impacto neto en el saldo';
}

/**
 * Totales del período, aviso de los asientos en borrador que quedaron afuera y
 * empty state. El aviso existe porque todos los asientos nacen en borrador: sin
 * él, el informe parece roto cuando en realidad falta registrarlos (TSK-719).
 */
export function _CostCenterMovementsSummary({
  totals,
  draftsExcluded,
  hasRows,
  scope,
}: CostCenterMovementsSummaryProps) {
  const { entryCount, saldo: draftsSaldo } = draftsExcluded;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-md border p-3">
          <p className="text-xs text-muted-foreground">Entradas</p>
          <p className="text-lg font-semibold">{formatAmount(totals.entradas)}</p>
        </div>
        <div className="rounded-md border p-3">
          <p className="text-xs text-muted-foreground">Salidas</p>
          <p className="text-lg font-semibold">{formatAmount(totals.salidas)}</p>
        </div>
        <div className="rounded-md border p-3">
          <p className="text-xs text-muted-foreground">Saldo del período</p>
          <p
            className={
              totals.saldo < 0
                ? 'text-lg font-semibold text-destructive'
                : totals.saldo > 0
                  ? 'text-lg font-semibold text-green-600'
                  : 'text-lg font-semibold'
            }
          >
            {formatAmount(totals.saldo)}
          </p>
        </div>
      </div>

      {entryCount > 0 && (
        <div
          className="flex items-start gap-2 rounded-md border border-orange-500/50 bg-orange-500/10 p-3 text-sm text-orange-600"
          role="status"
          data-testid="cost-center-movements-drafts-notice"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            Hay {entryCount} {entryCount === 1 ? 'asiento' : 'asientos'} en borrador con movimientos{' '}
            {SCOPE_LABELS[scope]} {draftsImpact(draftsSaldo)} que no están incluidos. Registralos
            desde Contabilidad → Asientos para que impacten, o activá «Incluir borradores» para
            verlos acá.
          </span>
        </div>
      )}

      {!hasRows && (
        <p
          className="py-6 text-center text-sm text-muted-foreground"
          data-testid="cost-center-movements-empty"
        >
          {entryCount > 0
            ? entryCount === 1
              ? `No hay movimientos registrados en el período; el asiento en borrador de arriba es el único ${scope === 'none' ? 'sin centro de costo' : 'que corresponde'}.`
              : `No hay movimientos registrados en el período; los ${entryCount} asientos en borrador de arriba son los únicos ${scope === 'none' ? 'sin centro de costo' : 'que corresponden'}.`
            : scope === 'none'
              ? 'No hay movimientos sin centro de costo en el período.'
              : scope === 'all'
                ? 'No hay movimientos en el período.'
                : 'El centro no tiene movimientos en el período.'}
        </p>
      )}
    </div>
  );
}
