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
import { Loader2 } from 'lucide-react';
import { generateAllPendingRecurringEntries } from '../actions.server';

interface GeneratePendingDialogProps {
  pendingCount: number;
  onClose: () => void;
}

export function _GeneratePendingDialog({
  pendingCount,
  onClose,
}: GeneratePendingDialogProps) {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<{ generated: number; errors: string[] } | null>(null);

  const handleGenerate = async () => {
    setIsLoading(true);
    try {
      const res = await generateAllPendingRecurringEntries();
      if (!res.success) return void toast.error(res.error);
      setResult(res);
      if (res.generated > 0) {
        toast.success(`${res.generated} asiento${res.generated !== 1 ? 's' : ''} generado${res.generated !== 1 ? 's' : ''}`);
      }
      router.refresh();
    } catch (error) {
      if (error instanceof Error) {
        toast.error(error.message);
      } else {
        toast.error('Error al generar asientos');
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <AlertDialog open onOpenChange={onClose}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Generar asientos pendientes</AlertDialogTitle>
          <AlertDialogDescription>
            {result ? (
              <div className="space-y-2">
                <p>{result.generated} asiento{result.generated !== 1 ? 's' : ''} generado{result.generated !== 1 ? 's' : ''} correctamente.</p>
                {result.errors.length > 0 && (
                  <div className="text-destructive">
                    <p className="font-medium">Errores ({result.errors.length}):</p>
                    <ul className="list-disc list-inside text-xs mt-1">
                      {result.errors.map((err, idx) => (
                        <li key={idx}>{err}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            ) : (
              <>
                Se generarán asientos para {pendingCount} plantilla{pendingCount !== 1 ? 's' : ''} pendiente{pendingCount !== 1 ? 's' : ''}.
                Los asientos se crearán en estado Borrador.
              </>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          {result ? (
            <AlertDialogAction onClick={onClose}>Cerrar</AlertDialogAction>
          ) : (
            <>
              <AlertDialogCancel disabled={isLoading}>Cancelar</AlertDialogCancel>
              <AlertDialogAction
                onClick={handleGenerate}
                disabled={isLoading}
                className="bg-primary text-primary-foreground hover:bg-primary/90"
              >
                {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Generar Todos
              </AlertDialogAction>
            </>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
