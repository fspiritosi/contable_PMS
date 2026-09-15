'use server';

import { Logger } from '@/lib/logger';
import { taskAppClient } from '@/shared/lib/taskapp/client';
import { TaskAppError } from '@/shared/lib/taskapp/errors';
import type { CloseProposalTarget, Ticket } from '@/shared/lib/taskapp/types';
import { canProposeClose, closeReasonError } from '../constants/ticket-copy';
import { getReporterEmail } from './getReporterEmail';
import { getSupportTicketById } from './support-tickets';

const logger = new Logger('features/Ayuda/support-close-proposal');

const TARGETS = new Set<CloseProposalTarget>(['resolved', 'cancelled']);

/**
 * "Esto ya se puede cerrar", desde un ticket en curso.
 *
 * Es una PROPUESTA, no un cierre: el estado no cambia hasta que el equipo la
 * acepta o la rechaza. Por eso existe aparte de `confirmSupportTicket`, que sí
 * cierra — ese es la respuesta a un "Resuelto" del equipo; esta es la
 * iniciativa del cliente cuando el equipo todavía no terminó.
 *
 * Todo lo que valida el diálogo se vuelve a validar acá: una server action es
 * un endpoint POST público y cualquiera puede llamarla con otros argumentos.
 * La autorización final es del backend (reporter o aprobador del proyecto);
 * se chequea antes sólo para devolver un mensaje en criollo en vez de un 403.
 */
export async function proposeSupportTicketClose(
  ticketId: number,
  target: CloseProposalTarget,
  reason: string
): Promise<Ticket> {
  // Lo que no depende del ticket se valida ANTES de ir a buscarlo: un input
  // inválido no tiene por qué pagar la sesión, el GET del ticket y el listado
  // de aprobadores que hace getSupportTicketById.
  if (!TARGETS.has(target)) {
    throw new Error('Elegí si ya está resuelto o si ya no lo necesitás');
  }
  const trimmed = typeof reason === 'string' ? reason.trim() : '';
  const reasonError = closeReasonError(target, trimmed);
  if (reasonError) throw new Error(reasonError);

  // En paralelo, como en la confirmación: la sesión y el ticket no dependen
  // uno del otro. getSupportTicketById ya resuelve el permiso de lectura
  // (reporter o aprobador) y devuelve null si no corresponde.
  const [reporter, ticket] = await Promise.all([
    getReporterEmail(),
    getSupportTicketById(ticketId),
  ]);
  if (!reporter) throw new Error('No hay usuario autenticado');
  if (!ticket) throw new Error('No tenés acceso a este ticket');

  if (!canProposeClose(ticket)) {
    throw new Error(
      ticket.close_proposal_status === 'pending'
        ? 'Este ticket ya tiene una propuesta de cierre esperando respuesta del equipo'
        : 'Este ticket ya no está en curso, así que no se puede proponer su cierre'
    );
  }

  logger.info('Proponiendo cierre', {
    data: { ticketId, target, user: reporter.email, hasReason: trimmed.length > 0 },
  });

  let updated: Ticket;
  try {
    updated = await taskAppClient.proposeTicketClose(ticketId, {
      reporter_email: reporter.email,
      target,
      reason: trimmed || undefined,
    });
  } catch (error) {
    if (error instanceof TaskAppError) {
      if (error.code === 'config') throw new Error('El servicio de soporte no está configurado');
      // 409: el ticket cambió entre que se abrió el diálogo y se envió (el
      // equipo lo resolvió, otra persona ya propuso). No es un error del
      // cliente ni algo que se arregle reintentando: se lo decimos así.
      if (error.status === 409) {
        throw new Error(
          'El ticket cambió mientras lo mirabas y ya no admite esta propuesta. Actualizá la página para ver cómo quedó.'
        );
      }
      if (error.status === 403 || error.status === 404) {
        throw new Error('No tenés permiso para proponer el cierre de este ticket');
      }
      if (error.status === 429) {
        throw new Error('Hubo demasiados intentos seguidos. Esperá un momento y probá de nuevo.');
      }
    }
    logger.error('Error proponiendo cierre', { data: { ticketId, target, error } });
    throw new Error('No se pudo enviar la propuesta. Probá de nuevo en unos minutos.');
  }

  // Lo que devuelve la API trae las horas valorizadas sin filtrar, y lo que
  // retorna una server action viaja entero al navegador. Se conserva el valor
  // que ya dejó pasar getSupportTicketById (null para quien no es aprobador):
  // ocultarlas sólo en la UI no alcanza.
  return { ...updated, estimated_hours: ticket.estimated_hours };
}
