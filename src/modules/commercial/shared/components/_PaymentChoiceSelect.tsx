'use client';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui/select';

import type { PaymentChoice } from '../correction/types';

interface Props {
  choice: PaymentChoice;
  disabled?: boolean;
  onChoose: (documentId: string, paymentId: string) => void;
}

/** Elección del medio de pago del que se descuenta la reducción de una OP/RC (§4.3). */
export function _PaymentChoiceSelect({ choice, disabled, onChoose }: Props) {
  return (
    <div className="space-y-1.5">
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
      <p className="text-muted-foreground text-xs">
        Solo se ofrecen los medios que cubren la diferencia por sí solos.
      </p>
    </div>
  );
}
