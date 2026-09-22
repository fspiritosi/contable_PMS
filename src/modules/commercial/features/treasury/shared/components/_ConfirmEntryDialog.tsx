'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/shared/components/ui/alert-dialog';
import type { ActionResult } from '@/shared/lib/action-result';

import type { EntryPreflight } from '../entry-preflight';
import { _EntryPreviewNotice } from './_EntryPreviewNotice';

export type ConfirmEntryResult = ActionResult<{ id: string; warnings: string[] }>;

interface Props {
  documentId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** «¿Confirmar recibo?» */
  title: string;
  description: string;
  /** Clave de React Query de la vista previa (`receiptEntryPreview`, `paymentOrderEntryPreview`). */
  previewQueryKey: string;
  loadPreview: (id: string) => Promise<EntryPreflight>;
  confirm: (id: string) => Promise<ConfirmEntryResult>;
  /** «Recibo confirmado correctamente» */
  successMessage: string;
  /** «El recibo se confirmó con avisos contables» */
  warningsTitle: string;
  onConfirmed: () => void;
}

/**
 * Diálogo de confirmar un recibo u orden de pago (TSK-728). Al abrirse pide la
 * vista previa del asiento (`useQuery`) y la muestra con `_EntryPreviewNotice`;
 * si ya se sabe que va a fallar, el botón queda deshabilitado. Al confirmar
 * traslada `result.error` al toast rojo y `result.warnings` a uno ámbar.
 */
export function _ConfirmEntryDialog({
  documentId,
  open,
  onOpenChange,
  title,
  description,
  previewQueryKey,
  loadPreview,
  confirm,
  successMessage,
  warningsTitle,
  onConfirmed,
}: Props) {
  const queryClient = useQueryClient();
  const [isConfirming, setIsConfirming] = useState(false);

  const previewQuery = useQuery({
    queryKey: [previewQueryKey, documentId],
    queryFn: () => loadPreview(documentId!),
    enabled: open && !!documentId,
  });

  const handleConfirm = async () => {
    if (!documentId) return;

    setIsConfirming(true);
    try {
      const result = await confirm(documentId);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success(successMessage);
      if (result.warnings.length > 0) {
        toast.warning(warningsTitle, { description: result.warnings.join(' '), duration: 10000 });
      }
      queryClient.invalidateQueries({ queryKey: [previewQueryKey] });
      onConfirmed();
    } finally {
      setIsConfirming(false);
      onOpenChange(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <_EntryPreviewNotice preview={previewQuery.data} isLoading={previewQuery.isLoading} />
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isConfirming}>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleConfirm}
            disabled={isConfirming || previewQuery.isLoading || !!previewQuery.data?.error}
          >
            {isConfirming ? 'Confirmando...' : 'Confirmar'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
