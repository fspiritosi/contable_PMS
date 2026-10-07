'use client';

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
import { toast } from 'sonner';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { type JournalEntryWithLines } from '../../../shared/types';
import { postJournalEntry } from '../actions.server';
import { Loader2 } from 'lucide-react';

interface PostEntryDialogProps {
  entry: JournalEntryWithLines;
  onClose: () => void;
}

export function _PostEntryDialog({ entry, onClose }: PostEntryDialogProps) {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);

  const handlePost = async () => {
    setIsLoading(true);
    try {
      const result = await postJournalEntry(entry.id);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success(`Asiento N° ${result.number} registrado correctamente`);
      router.refresh();
      onClose();
    } catch {
      toast.error('Error al registrar el asiento');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <AlertDialog open onOpenChange={onClose}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>¿Registrar asiento contable?</AlertDialogTitle>
          <AlertDialogDescription>
            Estás por registrar el asiento N° {entry.number}.
            <br /><br />
            Una vez registrado, el asiento no podrá ser modificado. Solo podrá ser
            anulado mediante un asiento de reversión.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isLoading}>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            className="bg-primary text-primary-foreground hover:bg-primary/90"
            onClick={handlePost}
            disabled={isLoading}
          >
            {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Registrar
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
