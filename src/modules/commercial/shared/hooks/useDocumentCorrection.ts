'use client';

import { useMutation } from '@tanstack/react-query';
import { createElement, useState, type ReactNode } from 'react';
import { toast } from 'sonner';

import {
  applyDocumentCorrection,
  previewDocumentCorrection,
} from '../actions/document-correction.server';
import { _CorrectionProposalDialog } from '../components/_CorrectionProposalDialog';
import type { CorrectionProposal, CorrectionRequest } from '../correction/types';

const STALE_MESSAGE = 'Algo cambió mientras revisabas. Revisá la propuesta actualizada.';

export function useDocumentCorrection(opts: { onApplied: () => void }): {
  open: (request: CorrectionRequest) => void;
  dialog: ReactNode;
  isPending: boolean;
} {
  const [request, setRequest] = useState<CorrectionRequest | null>(null);
  const [proposal, setProposal] = useState<CorrectionProposal | null>(null);

  const preview = useMutation({
    mutationFn: async (next: CorrectionRequest) => {
      const result = await previewDocumentCorrection(next);
      if (!result.success) throw new Error(result.error);
      return { next, proposal: result.proposal };
    },
    onSuccess: ({ next, proposal: fresh }) => {
      setRequest(next);
      setProposal(fresh);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const apply = useMutation({
    mutationFn: async () => {
      if (!request || !proposal) throw new Error('No hay una corrección para aplicar.');
      const result = await applyDocumentCorrection(request, proposal.fingerprint);
      if (!result.success) throw new Error(result.error);
      return result;
    },
    onSuccess: (result) => {
      if (result.applied) {
        toast.success('Corrección aplicada');
        setProposal(null);
        setRequest(null);
        opts.onApplied();
        return;
      }
      if (result.proposal) setProposal(result.proposal);
      if (result.reason === 'STALE') toast.warning(STALE_MESSAGE);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const choose = (documentId: string, paymentId: string) => {
    if (!request) return;
    preview.mutate({ ...request, choices: { ...request.choices, [documentId]: paymentId } });
  };

  const close = (isOpen: boolean) => {
    if (isOpen) return;
    setProposal(null);
    setRequest(null);
  };

  const isPending = preview.isPending || apply.isPending;
  const dialog = createElement(_CorrectionProposalDialog, {
    proposal,
    open: proposal !== null,
    busy: isPending,
    onOpenChange: close,
    onChoose: choose,
    onConfirm: () => apply.mutate(),
  });

  return { open: (next) => preview.mutate(next), dialog, isPending };
}
