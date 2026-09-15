'use client';

import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { MY_TICKETS_WITH_UNREAD_QUERY_KEY } from './useMyTicketsWithUnread';
import { MY_TICKETS_PAGE_QUERY_KEY } from './useMyTicketsPage';
import { APPROVER_TICKETS_QUERY_KEY } from './useApproverTickets';
import { TICKET_TIMELINE_QUERY_KEY } from './useTicketTimeline';
import { TICKET_DETAIL_QUERY_PREFIX } from './useTicketDetail';
import type { TaskAppRealtimeEvent } from '@/shared/lib/taskapp/types';
import { Logger } from '@/lib/logger';

const logger = new Logger('features/Ayuda/realtime-sync');

/**
 * Abre un EventSource al proxy SSE de gh_gestion. Cada evento relevante
 * invalida el caché de tickets para forzar un refetch silencioso.
 *
 * EventSource reconecta automáticamente; cualquier error dispara también
 * un refetch de cortesía para no perder cambios durante desconexiones.
 */
export function useSupportTicketsRealtimeSync() {
  const queryClient = useQueryClient();

  useEffect(() => {
    const source = new EventSource('/api/taskapp/events');

    source.onmessage = (msg) => {
      try {
        const event = JSON.parse(msg.data) as TaskAppRealtimeEvent;
        if (
          event.type === 'ticket.created' ||
          event.type === 'ticket.updated' ||
          event.type === 'comment.created'
        ) {
          queryClient.invalidateQueries({ queryKey: MY_TICKETS_WITH_UNREAD_QUERY_KEY });
          queryClient.invalidateQueries({ queryKey: MY_TICKETS_PAGE_QUERY_KEY });
          queryClient.invalidateQueries({ queryKey: APPROVER_TICKETS_QUERY_KEY });
          // El recorrido gana un hito con cada cambio de estado: sin esto, la
          // tarjeta abierta seguiría mostrando el timeline viejo por 5 minutos.
          queryClient.invalidateQueries({ queryKey: TICKET_TIMELINE_QUERY_KEY });
          // El Sheet de detalle lee de su propia query y no de la lista: sin
          // esto, con el detalle abierto no se ve que el equipo aceptó o
          // rechazó una propuesta de cierre (ni una reapertura, ni un estado
          // nuevo) hasta cerrarlo y volver a abrirlo. Por prefijo, porque el
          // evento no dice qué ticket cambió y sólo refetchea el que está
          // montado.
          queryClient.invalidateQueries({ queryKey: TICKET_DETAIL_QUERY_PREFIX });
        }
      } catch (error) {
        logger.warn('Failed to parse SSE event', { data: { error } });
      }
    };

    // Refetch de cortesía al reconectar, THROTTLEADO: si el SSE falla en loop
    // (backend caído, rate limit), invalidar en cada error genera una tormenta
    // de requests que agrava el problema. Como máximo un refetch cada 15s.
    let lastErrorRefetch = 0;
    source.onerror = () => {
      logger.debug('SSE error / reconnecting');
      const now = Date.now();
      if (now - lastErrorRefetch < 15_000) return;
      lastErrorRefetch = now;
      queryClient.invalidateQueries({ queryKey: MY_TICKETS_WITH_UNREAD_QUERY_KEY });
    };

    return () => {
      source.close();
    };
  }, [queryClient]);
}
