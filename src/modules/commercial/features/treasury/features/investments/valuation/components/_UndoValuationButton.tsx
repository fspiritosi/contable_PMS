'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Undo2 } from 'lucide-react';
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
import { Button } from '@/shared/components/ui/button';

import { undoInvestmentValuation } from '../actions.server';

interface Props {
  valuationId: string;
  fiscalYearNumber: number;
}

export function _UndoValuationButton({ valuationId, fiscalYearNumber }: Props) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);

  const undo = useMutation({
    mutationFn: () => undoInvestmentValuation(valuationId),
    onSuccess: (result) => {
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success('Valuación deshecha');
      queryClient.invalidateQueries({ queryKey: ['investment-valuation-candidates'] });
    },
    onError: () => toast.error('Error al deshacer la valuación'),
    onSettled: () => setOpen(false),
  });

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <Undo2 className="mr-2 h-4 w-4" />
        Deshacer
      </Button>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Deshacer la valuación?</AlertDialogTitle>
            <AlertDialogDescription>
              Se borra la valuación del ejercicio {fiscalYearNumber} y su asiento en borrador. Las
              tenencias vuelven al valor en libros previo.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={undo.isPending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={undo.isPending}
              onClick={(e) => {
                e.preventDefault();
                undo.mutate();
              }}
            >
              {undo.isPending ? 'Deshaciendo...' : 'Deshacer valuación'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
