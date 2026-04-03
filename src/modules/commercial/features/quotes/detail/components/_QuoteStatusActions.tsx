'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '@/shared/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/shared/components/ui/alert-dialog';
import {
  Send,
  CheckCircle2,
  XCircle,
  Pencil,
  Trash2,
  Copy,
  Info,
} from 'lucide-react';
import { usePermissions } from '@/shared/hooks/usePermissions';
import {
  updateQuoteStatus,
  deleteQuote,
  duplicateQuote,
} from '../../list/actions.server';

interface QuoteStatusActionsProps {
  quoteId: string;
  status: string;
}

export function _QuoteStatusActions({
  quoteId,
  status,
}: QuoteStatusActionsProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { hasPermission } = usePermissions();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);
  const [acceptOpen, setAcceptOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);

  const statusMutation = useMutation({
    mutationFn: ({ newStatus }: { newStatus: string }) =>
      updateQuoteStatus(quoteId, newStatus),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['quotes'] });
      router.refresh();
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Error al cambiar el estado');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteQuote(quoteId),
    onSuccess: () => {
      toast.success('Presupuesto eliminado');
      queryClient.invalidateQueries({ queryKey: ['quotes'] });
      router.push('/dashboard/commercial/quotes');
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Error al eliminar el presupuesto');
    },
  });

  const duplicateMutation = useMutation({
    mutationFn: () => duplicateQuote(quoteId),
    onSuccess: (result) => {
      toast.success('Presupuesto duplicado');
      queryClient.invalidateQueries({ queryKey: ['quotes'] });
      router.push(`/dashboard/commercial/quotes/${result.id}`);
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Error al duplicar el presupuesto');
    },
  });

  const isLoading =
    statusMutation.isPending ||
    deleteMutation.isPending ||
    duplicateMutation.isPending;

  return (
    <>
      {/* DRAFT actions */}
      {status === 'DRAFT' && (
        <>
          {hasPermission('commercial.quotes', 'update') && (
            <AlertDialog open={sendOpen} onOpenChange={setSendOpen}>
              <AlertDialogTrigger asChild>
                <Button size="sm" disabled={isLoading}>
                  <Send className="mr-2 h-4 w-4" />
                  Marcar como Enviado
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Marcar como Enviado</AlertDialogTitle>
                  <AlertDialogDescription>
                    El presupuesto pasará a estado &quot;Enviado&quot; y ya no podrá
                    editarse. ¿Deseas continuar?
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancelar</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => {
                      statusMutation.mutate(
                        { newStatus: 'SENT' },
                        {
                          onSuccess: () => {
                            toast.success('Presupuesto marcado como enviado');
                            setSendOpen(false);
                          },
                        },
                      );
                    }}
                  >
                    Confirmar
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}

          {hasPermission('commercial.quotes', 'update') && (
            <Button
              variant="outline"
              size="sm"
              disabled={isLoading}
              onClick={() =>
                router.push(`/dashboard/commercial/quotes/${quoteId}/edit`)
              }
            >
              <Pencil className="mr-2 h-4 w-4" />
              Editar
            </Button>
          )}

          {hasPermission('commercial.quotes', 'delete') && (
            <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" size="sm" disabled={isLoading}>
                  <Trash2 className="mr-2 h-4 w-4" />
                  Eliminar
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Eliminar Presupuesto</AlertDialogTitle>
                  <AlertDialogDescription>
                    Esta acción no se puede deshacer. Se eliminará el
                    presupuesto y todas sus líneas de forma permanente.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancelar</AlertDialogCancel>
                  <AlertDialogAction
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    onClick={() => deleteMutation.mutate()}
                  >
                    Eliminar
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </>
      )}

      {/* SENT actions */}
      {status === 'SENT' && (
        <>
          {hasPermission('commercial.quotes', 'approve') && (
            <AlertDialog open={acceptOpen} onOpenChange={setAcceptOpen}>
              <AlertDialogTrigger asChild>
                <Button
                  size="sm"
                  className="bg-green-600 hover:bg-green-700"
                  disabled={isLoading}
                >
                  <CheckCircle2 className="mr-2 h-4 w-4" />
                  Aceptar
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Aceptar Presupuesto</AlertDialogTitle>
                  <AlertDialogDescription>
                    El presupuesto pasará a estado &quot;Aceptado&quot;. ¿Deseas
                    continuar?
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancelar</AlertDialogCancel>
                  <AlertDialogAction
                    className="bg-green-600 hover:bg-green-700"
                    onClick={() => {
                      statusMutation.mutate(
                        { newStatus: 'ACCEPTED' },
                        {
                          onSuccess: () => {
                            toast.success('Presupuesto aceptado');
                            setAcceptOpen(false);
                          },
                        },
                      );
                    }}
                  >
                    Aceptar
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}

          {hasPermission('commercial.quotes', 'update') && (
            <AlertDialog open={rejectOpen} onOpenChange={setRejectOpen}>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" size="sm" disabled={isLoading}>
                  <XCircle className="mr-2 h-4 w-4" />
                  Rechazar
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Rechazar Presupuesto</AlertDialogTitle>
                  <AlertDialogDescription>
                    El presupuesto pasará a estado &quot;Rechazado&quot;. ¿Deseas
                    continuar?
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancelar</AlertDialogCancel>
                  <AlertDialogAction
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    onClick={() => {
                      statusMutation.mutate(
                        { newStatus: 'REJECTED' },
                        {
                          onSuccess: () => {
                            toast.success('Presupuesto rechazado');
                            setRejectOpen(false);
                          },
                        },
                      );
                    }}
                  >
                    Rechazar
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </>
      )}

      {/* ACCEPTED info */}
      {status === 'ACCEPTED' && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Info className="h-4 w-4" />
          <span>
            Presupuesto aceptado. Próximamente podrás generar facturas y
            remitos.
          </span>
        </div>
      )}

      {/* Duplicate - always available */}
      {hasPermission('commercial.quotes', 'create') && (
        <Button
          variant="outline"
          size="sm"
          disabled={isLoading}
          onClick={() => duplicateMutation.mutate()}
        >
          <Copy className="mr-2 h-4 w-4" />
          Duplicar
        </Button>
      )}
    </>
  );
}
