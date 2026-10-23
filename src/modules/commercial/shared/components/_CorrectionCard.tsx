'use client';

import { Badge } from '@/shared/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui/select';

import type { CardAction, PaymentChoice, ProposalCard } from '../correction/types';

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
  /** Elección pendiente de la OP o RC de esta tarjeta, si la hay. */
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
        <div className="mt-3 space-y-1.5">
          <p className="text-sm font-medium">¿De qué medio de pago se descuenta?</p>
          <Select
            value={choice.selected ?? undefined}
            onValueChange={(paymentId) => onChoose(choice.documentId, paymentId)}
            disabled={disabled}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Elegí un medio de pago" />
            </SelectTrigger>
            <SelectContent>
              {choice.options.map((option) => (
                <SelectItem key={option.paymentId} value={option.paymentId}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
    </div>
  );
}
