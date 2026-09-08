import type { Ticket } from '@/shared/lib/taskapp/types';
import { canDecide } from '../../constants/ticket-copy';
import { TicketResolutionPanel } from '../TicketResolutionPanel';
import { TicketAttachmentsList } from './TicketAttachmentsList';
import { TicketCommentsThread } from './TicketCommentsThread';

const COMPLETED_STATUSES = new Set(['resolved', 'done', 'closed', 'cancelled']);

interface Props {
  ticket: Ticket;
  currentUserEmail: string;
  currentUserName: string;
}

export function TicketDetailBody({ ticket, currentUserEmail, currentUserName }: Props) {
  const isCompleted = ticket.status != null && COMPLETED_STATUSES.has(ticket.status.slug);

  return (
    <div className="space-y-6 p-6">
      {/* Arriba de todo cuando hay algo que decidir: el aprobador entra al
          ticket por acá y no por el listado propio, así que si el bloque de
          resolución viviera sólo en la tarjeta él nunca lo vería. */}
      {canDecide(ticket) && (
        <section aria-label="Resolución">
          <TicketResolutionPanel ticket={ticket} canAct />
        </section>
      )}

      {ticket.description && (
        <section>
          <h4 className="mb-2 text-sm font-medium text-muted-foreground">Descripción</h4>
          <p className="whitespace-pre-wrap text-sm text-foreground">{ticket.description}</p>
        </section>
      )}

      <TicketAttachmentsList urls={ticket.attachments ?? []} />

      <section>
        <h4 className="mb-3 text-sm font-medium text-muted-foreground">Conversación</h4>
        <TicketCommentsThread
          ticketId={ticket.id}
          currentUserEmail={currentUserEmail}
          currentUserName={currentUserName}
          isCompleted={isCompleted}
        />
      </section>
    </div>
  );
}
