'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle } from 'lucide-react';
import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
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
import { Button } from '@/shared/components/ui/button';

import { generateInvestmentValuation } from '../actions.server';
import { valuationSchema, type ValuationData, type ValuationFormInput } from '../validators';
import type { ValuationCandidate } from '../valuation.server';
import { _ValuationEntryPreview } from './_ValuationEntryPreview';
import { _ValuationLinesTable } from './_ValuationLinesTable';

interface Props {
  fiscalYearId: string;
  holdings: ValuationCandidate[];
  canApprove: boolean;
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Valor resultante de una línea, o null si todavía no se cargó un número válido. */
function resolvedValue(
  holding: ValuationCandidate,
  line: { valuedAmount?: string; unitPrice?: string } | undefined
): number | null {
  const hasUnits = holding.nominals !== null && holding.nominals > 0;
  const raw = (hasUnits ? line?.unitPrice : line?.valuedAmount)?.trim();
  if (!raw || Number.isNaN(Number(raw))) return null;
  return round2(hasUnits ? (holding.nominals ?? 0) * Number(raw) : Number(raw));
}

export function _ValuationLinesForm({ fiscalYearId, holdings, canApprove }: Props) {
  const queryClient = useQueryClient();
  const [confirmOpen, setConfirmOpen] = useState(false);

  const form = useForm<ValuationFormInput, unknown, ValuationData>({
    resolver: zodResolver(valuationSchema),
    mode: 'onChange',
    defaultValues: {
      fiscalYearId,
      lines: holdings.map((h) => ({ holdingId: h.id, valuedAmount: '', unitPrice: '' })),
    },
  });
  const lines = useWatch({ control: form.control, name: 'lines' });
  const blocked = holdings.some((h) => h.laterSales.length > 0);

  const generate = useMutation({
    mutationFn: generateInvestmentValuation,
    onSuccess: (result) => {
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success(
        result.journalEntryNumber
          ? `Valuación generada. Asiento N° ${result.journalEntryNumber} en borrador`
          : 'Valuación generada, sin diferencias'
      );
      queryClient.invalidateQueries({ queryKey: ['investment-valuation-candidates'] });
    },
    onError: () => toast.error('Error al generar la valuación'),
    onSettled: () => setConfirmOpen(false),
  });

  const preview = holdings.map((h, i) => {
    const value = resolvedValue(h, lines?.[i]);
    return { holding: h, value, diff: value === null ? 0 : round2(value - h.bookValue) };
  });

  if (holdings.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No hay tenencias con saldo al cierre de este ejercicio.
      </p>
    );
  }

  return (
    <form className="space-y-6" onSubmit={form.handleSubmit(() => setConfirmOpen(true))} noValidate>
      {blocked && (
        <div className="flex gap-2 rounded-md border border-destructive/50 bg-destructive/5 p-3 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          <span>
            Hay tenencias con ventas posteriores al cierre. Anulá esas ventas, valuá y volvé a
            cargarlas.
          </span>
        </div>
      )}

      <_ValuationLinesTable form={form} preview={preview} />

      <div className="space-y-2">
        <h2 className="text-lg font-semibold">Vista previa del asiento</h2>
        <_ValuationEntryPreview
          lines={preview.map(({ holding, diff }) => ({
            id: holding.id,
            name: holding.name,
            accountCode: holding.accountCode,
            diff,
          }))}
        />
      </div>

      {canApprove && (
        <div className="flex justify-end">
          <Button type="submit" disabled={blocked || !form.formState.isValid || generate.isPending}>
            Generar valuación
          </Button>
        </div>
      )}

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Generar la valuación?</AlertDialogTitle>
            <AlertDialogDescription>
              Se ajusta el valor en libros de {holdings.length} tenencia
              {holdings.length === 1 ? '' : 's'} al cierre del ejercicio y se crea el asiento en
              borrador. Podés deshacerla mientras el asiento siga en borrador.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={generate.isPending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={generate.isPending}
              onClick={(e) => {
                e.preventDefault();
                generate.mutate(form.getValues());
              }}
            >
              {generate.isPending ? 'Generando...' : 'Generar valuación'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </form>
  );
}
