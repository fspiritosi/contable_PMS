'use server';

import { Logger } from '@/lib/logger';
import { taskAppClient } from '@/shared/lib/taskapp/client';
import { TaskAppError } from '@/shared/lib/taskapp/errors';
import type { Ticket, TicketTimeline } from '@/shared/lib/taskapp/types';
import { getReporterEmail } from './getReporterEmail';
import { getSupportTicketById } from './support-tickets';

const logger = new Logger('features/Ayuda/support-confirm');

/**
 * "Sí, quedó resuelto": el cliente verificó el arreglo y cierra el ticket.
 *
 * Es la contraparte de `requestSupportTicketReopen`. Hasta que existió, el
 * cliente sólo podía quejarse: no había forma de decir "está bien", así que
 * nadie sabía si un resuelto había sido verificado y el ticket quedaba
 * flotando.
 *
 * La autorización real la hace el backend (reporter o aprobador del proyecto);
 * acá se valida antes sólo para poder devolver un mensaje en criollo en vez de
 * un 403 pelado.
 */
export async function confirmSupportTicket(ticketId: number): Promise<Ticket> {
  // En paralelo: la sesión y el ticket no dependen uno del otro, y encadenar
  // los dos awaits duplicaba la latencia de la confirmación.
  // getSupportTicketById ya resuelve el permiso de lectura (reporter o
  // aprobador) y devuelve null si no corresponde.
  const [reporter, ticket] = await Promise.all([
    getReporterEmail(),
    getSupportTicketById(ticketId),
  ]);
  if (!reporter) throw new Error('No hay usuario autenticado');
  if (!ticket) throw new Error('No tenés acceso a este ticket');

  if (ticket.client_confirmed_at) {
    throw new Error('Este ticket ya está confirmado');
  }
  if (ticket.reopen_status === 'pending') {
    throw new Error('Hay una solicitud de reapertura pendiente para este ticket');
  }

  try {
    return await taskAppClient.confirmTicket(ticketId, reporter.email);
  } catch (error) {
    if (error instanceof TaskAppError && error.code === 'config') {
      throw new Error('El servicio de soporte no está configurado');
    }
    logger.error('Error confirmando ticket', { data: { ticketId, error } });
    throw new Error('No se pudo registrar tu confirmación. Probá de nuevo en unos minutos.');
  }
}

/**
 * Recorrido del ticket. Viene ya filtrado por el backend a los hitos que el
 * cliente puede ver: los estados internos del equipo no llegan hasta acá.
 *
 * Degrada a una lista vacía en vez de tirar: el recorrido es contexto, no
 * puede tumbar la tarjeta si la llamada falla.
 */
export async function getSupportTicketTimeline(ticketId: number): Promise<TicketTimeline> {
  const empty: TicketTimeline = { ticket_id: ticketId, milestones: [] };

  const ticket = await getSupportTicketById(ticketId);
  if (!ticket) return empty;

  try {
    return await taskAppClient.getTicketTimeline(ticketId);
  } catch (error) {
    logger.warn('No se pudo traer el recorrido del ticket', { data: { ticketId, error } });
    return empty;
  }
}
