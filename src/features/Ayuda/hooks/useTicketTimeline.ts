'use client';

import { useQuery } from '@tanstack/react-query';
import { getSupportTicketTimeline } from '../actions/support-confirm';

/** Prefijo: invalidarlo refresca el recorrido de todos los tickets abiertos. */
export const TICKET_TIMELINE_QUERY_KEY = ['ayuda', 'ticket-timeline'];

export const ticketTimelineKey = (id: number) => [...TICKET_TIMELINE_QUERY_KEY, id] as const;

/**
 * Recorrido del ticket. `enabled` importa: la tarjeta sólo lo pide cuando el
 * cliente la abre. Traerlo en el listado sería una consulta de eventos por
 * cada fila, para un dato que casi nadie mira.
 */
export function useTicketTimeline(ticketId: number, enabled: boolean) {
  return useQuery({
    queryKey: ticketTimelineKey(ticketId),
    queryFn: () => getSupportTicketTimeline(ticketId),
    enabled,
    // El recorrido sólo cambia cuando cambia el estado, y eso ya invalida el
    // listado: no hace falta refetchearlo seguido.
    staleTime: 5 * 60_000,
  });
}
