'use client';

import { Button } from '@/shared/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog';

import type { CorrectionMode, CorrectionProposal } from '../correction/types';
import { _CorrectionCard } from './_CorrectionCard';
import { _CorrectionImpediments } from './_CorrectionImpediments';

const TITLES: Record<CorrectionMode, string> = {
  EDIT: 'Revisá los cambios antes de guardar',
  DELETE: 'Revisá los cambios antes de eliminar',
  CANCEL: 'Revisá los cambios antes de anular',
};

/** La tarjeta del documento (OP o RC) lleva la clave `KIND:id`; las de banco/caja/asiento no. */
const isDocumentCard = (key: string, documentId: string) =>
  key === `PAYMENT_ORDER:${documentId}` || key === `RECEIPT:${documentId}`;

interface Props {
  proposal: CorrectionProposal | null;
  open: boolean;
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  onChoose: (documentId: string, paymentId: string) => void;
  onConfirm: () => void;
}

export function _CorrectionProposalDialog({
  proposal,
  open,
  busy,
  onOpenChange,
  onChoose,
  onConfirm,
}: Props) {
  if (!proposal) return null;
  const { cards, impediments, pendingChoices } = proposal;
  const blocked = impediments.length > 0 || pendingChoices.some((c) => !c.selected);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="top-0 left-0 flex h-dvh max-h-dvh w-full max-w-full translate-x-0 translate-y-0 flex-col rounded-none sm:top-[50%] sm:left-[50%] sm:h-auto sm:max-h-[90vh] sm:max-w-2xl sm:translate-x-[-50%] sm:translate-y-[-50%] sm:rounded-lg">
        <DialogHeader>
          <DialogTitle>{TITLES[proposal.mode]}</DialogTitle>
          <DialogDescription>
            Esta corrección modifica {cards.length} registros. Se aplican todos juntos al confirmar;
            si algo falla, no se aplica ninguno.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 space-y-3 overflow-y-auto">
          <_CorrectionImpediments impediments={impediments} />
          {cards.map((card) => (
            <_CorrectionCard
              key={card.key}
              card={card}
              choice={pendingChoices.find((c) => isDocumentCard(card.key, c.documentId))}
              disabled={busy}
              onChoose={onChoose}
            />
          ))}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            {proposal.mode === 'EDIT' ? 'Volver a editar' : 'Cancelar'}
          </Button>
          <Button onClick={onConfirm} disabled={blocked || busy}>
            Confirmar corrección
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
