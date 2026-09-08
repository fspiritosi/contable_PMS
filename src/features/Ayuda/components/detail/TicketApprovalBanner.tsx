'use client';

import { Button } from '@/shared/components/ui/button';
import { Loader2, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import type { Ticket } from '@/shared/lib/taskapp/types';
import { useApproveTicket } from '../../hooks/useApproveTicket';
import { usePendingApproverTickets } from '../../hooks/useApproverTickets';
import { useRejectTicket } from '../../hooks/useRejectTicket';
import { ConfirmDialog } from '../ConfirmDialog';

interface Props {
  ticket: Ticket;
  currentUserEmail: string;
}

export function TicketApprovalBanner({ ticket, currentUserEmail }: Props) {
  void currentUserEmail;
  // Solo los aprobadores reales ven las acciones: el listado de pendientes lo
  // resuelve el backend validando el email contra el array de aprobadores del
  // proyecto (un no-aprobador recibe lista vacía). Un aprobador puede aprobar
  // cualquier ticket pendiente, incluso los creados por él mismo.
  const { data: pendingTickets = [] } = usePendingApproverTickets();
  const isApprover = pendingTickets.some((t) => t.id === ticket.id);
  const canApprove = isApprover && ticket.status?.slug === 'pendiente_aprobacion';

  const approve = useApproveTicket(ticket.id);
  const reject = useRejectTicket(ticket.id);
  // Un solo estado en vez de dos booleanos: los dos diálogos son excluyentes y
  // así no existe el estado imposible de tener los dos abiertos.
  const [confirming, setConfirming] = useState<'approve' | 'reject' | null>(null);

  if (!canApprove) return null;

  async function handleApprove() {
    try {
      await approve.mutateAsync();
      toast.success('Aprobación registrada.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error al aprobar');
    } finally {
      // Se cierra recién al terminar, pase lo que pase: mientras corre, el
      // diálogo se queda con el botón deshabilitado para que diez clicks
      // seguidos no disparen diez requests.
      setConfirming(null);
    }
  }

  async function handleReject() {
    try {
      await reject.mutateAsync();
      toast.success('Rechazo registrado.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error al rechazar');
    } finally {
      setConfirming(null);
    }
  }

  const isBusy = approve.isPending || reject.isPending;

  // La confirmación nombra las horas que se están aprobando: es el número al
  // que el cliente se compromete, y es lo único que no puede deshacer después.
  const approveDescription =
    ticket.estimated_hours != null
      ? `Al aprobar confirmás la valorización de ${ticket.estimated_hours} h y el ticket pasa a planificación.`
      : 'Al aprobar, el ticket pasa a planificación y el equipo avanza con él.';

  return (
    <div className="border-b bg-amber-50 dark:bg-amber-950/40 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-start gap-3">
          <ShieldCheck className="mt-0.5 h-5 w-5 text-amber-600" />
          <div>
            <p className="text-sm font-medium">Aprobá la valorización de este ticket</p>
            <p className="text-xs text-muted-foreground">
              El equipo valorizó este ticket. Aprobá para que pase a planificación, o rechazalo si
              no corresponde.
            </p>
            {ticket.estimated_hours != null ? (
              <p className="mt-0.5 text-xs font-medium text-amber-700 dark:text-amber-400">
                Horas valorizadas: {ticket.estimated_hours} h
              </p>
            ) : null}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={isBusy}
            onClick={() => setConfirming('reject')}
          >
            Rechazar
          </Button>
          <Button size="sm" disabled={isBusy} onClick={() => setConfirming('approve')}>
            {isBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Aprobar
          </Button>
        </div>
      </div>

      <ConfirmDialog
        open={confirming === 'approve'}
        onOpenChange={() => setConfirming(null)}
        title="¿Confirmás la valorización de este ticket?"
        description={approveDescription}
        confirmLabel="Aprobar valorización"
        busy={approve.isPending}
        onConfirm={handleApprove}
      />
      <ConfirmDialog
        open={confirming === 'reject'}
        onOpenChange={() => setConfirming(null)}
        title="¿Confirmás que rechazás este ticket?"
        description="Al rechazar, el ticket queda cancelado y el equipo no avanzará con él."
        confirmLabel="Rechazar ticket"
        destructive
        busy={reject.isPending}
        onConfirm={handleReject}
      />
    </div>
  );
}
