'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/shared/components/ui/alert-dialog';
import { Button } from '@/shared/components/ui/button';
import { usePermissions } from '@/shared/hooks/usePermissions';

import { formatDayUtc } from '../../../shared/utils/utc-month';
import { closeFiscalYear, previewFiscalYearClose } from '../actions.server';
import {
  FISCAL_YEAR_CLOSE_PREVIEW_QUERY_KEY,
  type ClosePreview,
  type FiscalYearSummary,
} from '../fiscal-year-close-common';
import { _ClosePreviewTables } from './_ClosePreviewTables';

interface ClosePreviewDialogProps {
  fiscalYear: FiscalYearSummary;
  onClose: () => void;
}

/** La vista previa viaja como `ActionResult`: el mensaje de negocio se arma acá (no se redacta). */
async function loadPreview(fiscalYearId: string): Promise<ClosePreview> {
  const result = await previewFiscalYearClose(fiscalYearId);
  if (!result.success) throw new Error(result.error);
  return result;
}

/**
 * Confirmación del cierre anual (TSK-760, Fase 9). La vista previa usa el mismo cálculo que
 * el cierre; el servidor vuelve a validar todo dentro de la transacción.
 */
export function _ClosePreviewDialog({ fiscalYear, onClose }: ClosePreviewDialogProps) {
  const router = useRouter();
  const { hasPermission } = usePermissions();
  const canApprove = hasPermission('accounting.fiscal-year-close', 'approve');

  const preview = useQuery({
    queryKey: [...FISCAL_YEAR_CLOSE_PREVIEW_QUERY_KEY, fiscalYear.id],
    queryFn: () => loadPreview(fiscalYear.id),
    retry: false,
    staleTime: 0,
  });

  const close = useMutation({
    mutationFn: () => closeFiscalYear({ fiscalYearId: fiscalYear.id }),
    onSuccess: (result) => {
      router.refresh();
      if (!result.success) return void toast.error(result.error);
      const opening = result.openingEntryNumber
        ? ` y apertura N° ${result.openingEntryNumber}`
        : '';
      toast.success(
        `Ejercicio N° ${fiscalYear.number} cerrado: refundición N° ${result.closingEntryNumber}${opening}. ` +
          `Queda abierto el ejercicio N° ${result.nextFiscalYearNumber}.`
      );
      onClose();
    },
    onError: () => toast.error('Error al cerrar el ejercicio fiscal'),
  });

  return (
    <AlertDialog open onOpenChange={(open) => !open && !close.isPending && onClose()}>
      <AlertDialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <AlertDialogHeader>
          <AlertDialogTitle>Cerrar el ejercicio N° {fiscalYear.number}</AlertDialogTitle>
          <AlertDialogDescription>
            Del {formatDayUtc(fiscalYear.startDay)} al {formatDayUtc(fiscalYear.endDay)}
          </AlertDialogDescription>
        </AlertDialogHeader>

        {preview.isPending ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="mr-2 h-6 w-6 animate-spin" />
            <span className="text-sm text-muted-foreground">Calculando saldos...</span>
          </div>
        ) : preview.isError ? (
          <p className="py-4 text-center text-sm text-destructive">{preview.error.message}</p>
        ) : (
          <div className="space-y-4">
            <_ClosePreviewTables preview={preview.data} />
            <p className="text-xs text-muted-foreground">
              Al confirmar se registran la refundición y la apertura, el ejercicio N°{' '}
              {fiscalYear.number} queda cerrado y sus meses ya no se pueden reabrir. No se puede
              deshacer.
            </p>
          </div>
        )}

        <AlertDialogFooter>
          <AlertDialogCancel disabled={close.isPending}>Cancelar</AlertDialogCancel>
          <Button
            onClick={() => close.mutate()}
            disabled={close.isPending || !preview.isSuccess || !canApprove}
          >
            {close.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Confirmar cierre
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
