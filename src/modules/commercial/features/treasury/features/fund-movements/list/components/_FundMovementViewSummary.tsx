'use client';

import { Badge } from '@/shared/components/ui/badge';

import {
  FUND_MOVEMENT_STATUS_LABELS,
  fundMovementStatusVariant,
  getViewSummaryFacts,
} from '../../shared/view-mode';
import type { FundMovementListItem } from '../actions.server';

interface FundMovementViewSummaryProps {
  movement: Pick<FundMovementListItem, 'status' | 'confirmedAt' | 'journalEntryNumber'>;
}

/**
 * Datos de solo lectura del modo vista (TSK-720a): estado, fecha de
 * confirmación y N° de asiento. El N° de asiento ya no está en el listado, así
 * que este es el lugar para consultarlo. Es texto, sin link: no hay página de
 * detalle de asiento.
 */
export function _FundMovementViewSummary({ movement }: FundMovementViewSummaryProps) {
  const facts = getViewSummaryFacts(movement);

  return (
    <dl className="grid gap-3 rounded-md border bg-muted/40 p-3 text-sm sm:grid-cols-3">
      <div className="space-y-1">
        <dt className="text-xs text-muted-foreground">Estado</dt>
        <dd>
          <Badge variant={fundMovementStatusVariant(movement.status)}>
            {FUND_MOVEMENT_STATUS_LABELS[movement.status]}
          </Badge>
        </dd>
      </div>
      {facts.map((fact) => (
        <div key={fact.key} className="space-y-1">
          <dt className="text-xs text-muted-foreground">{fact.label}</dt>
          <dd className={fact.key === 'journalEntry' ? 'font-mono' : undefined}>{fact.value}</dd>
        </div>
      ))}
    </dl>
  );
}
