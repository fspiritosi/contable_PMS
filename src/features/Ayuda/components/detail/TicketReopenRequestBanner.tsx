'use client';

import type { Ticket } from '@/shared/lib/taskapp/types';
import { Clock } from 'lucide-react';
import moment from 'moment';
import 'moment/locale/es';

interface Props {
  ticket: Ticket;
  currentUserEmail: string;
}

/**
 * Aviso de "ya pediste la reapertura, la estamos mirando". Sólo eso: el pedido
 * en sí se hace desde TicketResolutionPanel, junto al "sí, quedó resuelto",
 * porque las dos salidas del ticket tienen que estar en el mismo lugar.
 */
export function TicketReopenRequestBanner({ ticket, currentUserEmail }: Props) {
  const isReporter = ticket.reporter_email === currentUserEmail;
  if (!isReporter) return null;

  if (ticket.reopen_status === 'pending' && ticket.reopen_requested_at) {
    return (
      <div className="border-b bg-amber-50 dark:bg-amber-950/40 p-4">
        <div className="flex items-start gap-3">
          <Clock className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
          <div>
            <p className="text-sm font-medium">Solicitud de reapertura enviada</p>
            <p className="text-xs text-muted-foreground">
              {moment(ticket.reopen_requested_at).locale('es').fromNow()} — un agente la va a
              revisar y te avisamos.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Las dos salidas ("sí, quedó resuelto" / "no quedó resuelto") viven juntas
  // en TicketResolutionPanel, dentro del cuerpo del Sheet. Este banner ya no
  // ofrece la suya: el cliente tenía el mismo pedido de reapertura dos veces
  // en la misma pantalla, una sola de las cuales le daba la opción de decir
  // que sí.
  return null;
}
