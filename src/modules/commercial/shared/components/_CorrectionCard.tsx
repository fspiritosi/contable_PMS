'use client';

import { Badge } from '@/shared/components/ui/badge';

import type { CardAction, PaymentChoice, ProposalCard } from '../correction/types';
import { _PaymentChoiceSelect } from './_PaymentChoiceSelect';

export const CARD_ACTION_LABELS: Record<CardAction, string> = {
  MODIFY: 'Se modifica',
  REWRITE: 'Se reescribe',
  DELETE: 'Se elimina',
  CANCEL: 'Se anula',
  REVERSE: 'Contraasiento',
  BACK_TO_PORTFOLIO: 'Vuelve a cartera',
  UNLINK: 'Se desvincula',
  RECALCULATE: 'Se recalcula',
};

const DESTRUCTIVE_ACTIONS: CardAction[] = ['DELETE', 'CANCEL', 'UNLINK'];

interface Props {
  card: ProposalCard;
  /** Elección de medio de pago de la OP o RC de esta tarjeta, si la hay. */
  choice?: PaymentChoice;
  disabled?: boolean;
  onChoose: (documentId: string, paymentId: string) => void;
}

export function _CorrectionCard({ card, choice, disabled, onChoose }: Props) {
  return (
    <div className="rounded-lg border p-3 sm:p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium">{card.title}</p>
        <Badge variant={DESTRUCTIVE_ACTIONS.includes(card.action) ? 'destructive' : 'secondary'}>
          {CARD_ACTION_LABELS[card.action]}
        </Badge>
      </div>

      {card.rows.length > 0 && (
        <dl className="mt-3 space-y-1.5 text-sm">
          {card.rows.map((row) => (
            <div key={row.label} className="flex flex-wrap items-baseline justify-between gap-x-4">
              <dt className="text-muted-foreground">{row.label}</dt>
              <dd className="flex items-baseline gap-2">
                {row.before !== null && row.before !== row.after && (
                  <span className="text-muted-foreground line-through">{row.before}</span>
                )}
                <span className="font-medium">{row.after ?? '—'}</span>
              </dd>
            </div>
          ))}
        </dl>
      )}

      {card.warning && <p className="mt-2 text-xs text-amber-600">{card.warning}</p>}

      {choice && (
        <div className="mt-3">
          <_PaymentChoiceSelect choice={choice} disabled={disabled} onChoose={onChoose} />
        </div>
      )}
    </div>
  );
}
