'use client';

import type { Ticket } from '@/shared/lib/taskapp/types';
import { Clock, MessageSquareReply } from 'lucide-react';
import moment from 'moment';
import 'moment/locale/es';
import { canProposeClose } from '../constants/ticket-copy';

export type CloseProposalNoticeVariant = 'card' | 'sheet';

/**
 * Id estable del aviso. Después de enviar la propuesta el botón que abrió el
 * diálogo desaparece (ya no se puede proponer) y el foco se caería al body;
 * con este id se lo lleva al aviso, que es justo lo que confirma el envío.
 */
export function closeProposalNoticeId(ticketId: number, variant: CloseProposalNoticeVariant) {
  return `ayuda-close-proposal-${variant}-${ticketId}`;
}

interface Props {
  ticket: Ticket;
  /** `card`: caja dentro de la tarjeta. `sheet`: franja bajo el encabezado del detalle. */
  variant: CloseProposalNoticeVariant;
}

/**
 * Estado de la propuesta de cierre: pendiente, o el último rechazo.
 *
 * Sólo informa. La acción de proponer vive en ProposeCloseAction y no se
 * repite acá: con dos puertas al mismo diálogo en la misma pantalla nunca
 * queda claro cuál es la buena (ya pasó con la reapertura, ver
 * TicketReopenRequestBanner).
 *
 * Se muestra a quien pueda ver el ticket, no sólo a quien lo reportó: el
 * aprobador también puede proponer, y si no ve que ya hay una propuesta
 * esperando la duplica.
 */
export function TicketCloseProposalNotice({ ticket, variant }: Props) {
  const pending = ticket.close_proposal_status === 'pending';
  // El rechazo es historia en cuanto el ticket sale de "en curso": ahí el
  // estado nuevo dice más que una propuesta vieja.
  const declined = !pending && !!ticket.close_proposal_declined_at && canProposeClose(ticket);
  if (!pending && !declined) return null;

  const boxClass =
    variant === 'sheet'
      ? 'border-b p-4'
      : // `rounded-md` dentro de la tarjeta `rounded-lg` con p-4: el radio de
        // adentro tiene que ser menor que el de afuera o el bloque se ve pegado.
        'rounded-md border p-3';
  const toneClass = pending
    ? 'border-amber-200 bg-amber-50/60 dark:border-amber-900/60 dark:bg-amber-950/30'
    : 'bg-muted/40';

  return (
    <div
      id={closeProposalNoticeId(ticket.id, variant)}
      // tabIndex -1: recibe el foco por código después de enviar, sin sumar
      // una parada de Tab. role="status" para que un cambio que llega por SSE
      // (el equipo rechazó) se anuncie sin interrumpir.
      tabIndex={-1}
      role="status"
      className={`${boxClass} ${toneClass} outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring`}
    >
      <div className="flex items-start gap-3">
        {pending ? (
          <Clock aria-hidden className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
        ) : (
          <MessageSquareReply aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        )}
        <div className="flex min-w-0 flex-col gap-1">
          {pending ? <PendingBody ticket={ticket} /> : <DeclinedBody ticket={ticket} />}
        </div>
      </div>
    </div>
  );
}

function PendingBody({ ticket }: { ticket: Ticket }) {
  const reason = ticket.close_proposal_reason?.trim();
  const when = ticket.close_proposal_requested_at;
  return (
    <>
      {/* El título dice el estado en palabras: el ámbar solo no alcanza. */}
      <p className="text-sm font-medium">Propuesta de cierre esperando respuesta</p>
      <p className="text-pretty text-xs text-muted-foreground">
        {ticket.close_proposal_target === 'cancelled'
          ? 'Se pidió cancelarlo'
          : 'Se propuso darlo por resuelto'}
        {when && (
          <>
            {' '}
            <time dateTime={when} className="whitespace-nowrap">
              {moment(when).locale('es').fromNow()}
            </time>
          </>
        )}
        . El equipo la revisa y te avisa; hasta entonces el ticket sigue en curso.
      </p>
      {reason && <ReasonQuote label="Motivo que se envió">{reason}</ReasonQuote>}
    </>
  );
}

function DeclinedBody({ ticket }: { ticket: Ticket }) {
  const reason = ticket.close_proposal_declined_reason?.trim();
  const when = ticket.close_proposal_declined_at;
  return (
    <>
      <p className="text-sm font-medium">El equipo decidió seguir con el ticket</p>
      <p className="text-pretty text-xs text-muted-foreground">
        Revisó la propuesta de cierre
        {when && (
          <>
            {' '}
            <time dateTime={when} className="whitespace-nowrap">
              {moment(when).locale('es').fromNow()}
            </time>
          </>
        )}
        {/* Sin motivo el aviso se sostiene solo: nada de un "Motivo:" vacío. */}
        {reason ? ' y dejó este motivo.' : '.'} Si todavía creés que corresponde cerrarlo, podés
        volver a proponerlo.
      </p>
      {reason && <ReasonQuote label="Motivo del equipo">{reason}</ReasonQuote>}
    </>
  );
}

/**
 * El motivo entero, respetando los saltos de línea. Puede tener mil
 * caracteres y un link largo sin espacios: `break-words` evita que empuje el
 * ancho de la tarjeta, y `max-w-prose` que se lea en renglones eternos.
 */
function ReasonQuote({ label, children }: { label: string; children: string }) {
  return (
    <figure className="mt-1 flex flex-col gap-0.5">
      <figcaption className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </figcaption>
      <blockquote className="max-w-prose whitespace-pre-line text-pretty break-words border-s-2 ps-2.5 text-sm leading-relaxed text-foreground">
        {children}
      </blockquote>
    </figure>
  );
}
