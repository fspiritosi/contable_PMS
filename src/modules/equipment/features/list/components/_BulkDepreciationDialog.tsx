'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { AlertTriangle, Calculator, Loader2 } from 'lucide-react';
import moment from 'moment';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { Alert, AlertDescription, AlertTitle } from '@/shared/components/ui/alert';
import { Button } from '@/shared/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog';
import { Input } from '@/shared/components/ui/input';
import { Label } from '@/shared/components/ui/label';

import {
  getPendingDepreciationsSummary,
  postAllPendingDepreciations,
  type BulkDepreciationError,
} from '@/modules/equipment/features/depreciation/actions.server';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Lista de motivos, con scroll: sirve tanto para el aviso previo como para el resultado. */
function _MessageList({ items }: { items: { key: string; message: string }[] }) {
  return (
    <ul className="max-h-60 list-disc space-y-1 overflow-y-auto pl-4 text-sm">
      {items.map((item) => (
        <li key={item.key}>{item.message}</li>
      ))}
    </ul>
  );
}

export function _BulkDepreciationDialog({ open, onOpenChange }: Props) {
  const router = useRouter();
  const [upToDate, setUpToDate] = useState(moment().format('YYYY-MM-DD'));
  const [resultErrors, setResultErrors] = useState<BulkDepreciationError[]>([]);

  // Al reabrir o cambiar la fecha, el resultado anterior deja de valer.
  useEffect(() => {
    setResultErrors([]);
  }, [open, upToDate]);

  const { data: summary, isLoading } = useQuery({
    queryKey: ['pendingDepreciations', upToDate],
    queryFn: () => getPendingDepreciationsSummary(new Date(upToDate)),
    enabled: open,
  });

  const postMutation = useMutation({
    mutationFn: () => postAllPendingDepreciations(new Date(upToDate)),
    onSuccess: (result) => {
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      if (result.posted > 0) {
        toast.success(`${result.posted} período(s) contabilizado(s)`);
      }
      router.refresh();
      if (result.errors.length > 0) {
        // No se cierra solo: el usuario tiene que ver qué quedó afuera y por qué.
        setResultErrors(result.errors);
        return;
      }
      onOpenChange(false);
    },
    onError: () => {
      toast.error('No se pudo contactar al servidor');
    },
  });

  const skipped = summary?.vehiclesWithoutAccounts ?? [];
  const hasResult = resultErrors.length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>Contabilizar Depreciaciones</DialogTitle>
          <DialogDescription>
            Contabilice todos los períodos de depreciación pendientes hasta la fecha seleccionada
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="upToDate">Contabilizar hasta</Label>
            <Input
              id="upToDate"
              type="date"
              value={upToDate}
              onChange={(e) => setUpToDate(e.target.value)}
              disabled={postMutation.isPending}
            />
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : summary ? (
            <div className="rounded-lg bg-muted p-4 space-y-2">
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div>
                  <p className="text-muted-foreground">Períodos pendientes</p>
                  <p className="text-lg font-semibold">{summary.totalEntries}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Equipos afectados</p>
                  <p className="text-lg font-semibold">{summary.vehicleCount}</p>
                </div>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Monto total a contabilizar</p>
                <p className="text-lg font-semibold">
                  $ {summary.totalAmount.toLocaleString('es-AR', { minimumFractionDigits: 2 })}
                </p>
              </div>
            </div>
          ) : null}

          {hasResult ? (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>
                {resultErrors.length} equipo(s)/período(s) no se pudieron contabilizar
              </AlertTitle>
              <AlertDescription>
                <_MessageList
                  items={resultErrors.map((e, i) => ({
                    key: `${e.vehicleId}-${i}`,
                    message: e.message,
                  }))}
                />
              </AlertDescription>
            </Alert>
          ) : skipped.length > 0 ? (
            <Alert className="border-orange-300 text-orange-900 dark:text-orange-200">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Estos equipos se van a omitir por falta de cuentas contables</AlertTitle>
              <AlertDescription>
                <_MessageList
                  items={skipped.map((v) => ({ key: v.vehicleId, message: v.message }))}
                />
              </AlertDescription>
            </Alert>
          ) : null}
        </div>

        <DialogFooter>
          {hasResult ? (
            <Button onClick={() => onOpenChange(false)}>Cerrar</Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancelar
              </Button>
              <Button
                onClick={() => postMutation.mutate()}
                disabled={postMutation.isPending || !summary || summary.totalEntries === 0}
              >
                {postMutation.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Contabilizando...
                  </>
                ) : (
                  <>
                    <Calculator className="mr-2 h-4 w-4" />
                    Contabilizar {summary?.totalEntries || 0} período(s)
                  </>
                )}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
