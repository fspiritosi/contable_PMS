'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { CloseProposalTarget, TicketWithUnread } from '@/shared/lib/taskapp/types';
import { proposeSupportTicketClose } from '../actions/support-close-proposal';
import { MY_TICKETS_QUERY_KEY } from './useMyTickets';
import { MY_TICKETS_PAGE_QUERY_KEY } from './useMyTicketsPage';
import { ticketDetailKey } from './useTicketDetail';
import { MY_TICKETS_WITH_UNREAD_QUERY_KEY } from './queryKeys';
import { APPROVER_TICKETS_QUERY_KEY } from './useApproverTickets';
import { ticketTimelineKey } from './useTicketTimeline';

/**
 * Propuesta de cierre. Mismo patrón que useConfirmTicket, con una diferencia:
 * además de invalidar, parchea el ticket en la lista de la pantalla.
 *
 * Por qué: la tarjeta lee de esa lista y no del detalle. Sólo invalidando, el
 * botón "Proponer cierre" seguía a la vista (y clickeable) durante el refetch,
 * después del toast de "enviada". Con el parche la tarjeta pasa al aviso de
 * pendiente en el mismo render en que se cierra el diálogo, y el foco tiene
 * adónde ir.
 */
export function useProposeTicketClose(ticketId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { target: CloseProposalTarget; reason: string }) =>
      proposeSupportTicketClose(ticketId, input.target, input.reason),
    onSuccess: (updatedTicket) => {
      queryClient.setQueryData(ticketDetailKey(ticketId), updatedTicket);
      queryClient.setQueryData<TicketWithUnread[]>(MY_TICKETS_WITH_UNREAD_QUERY_KEY, (old) =>
        // `unread` se conserva: es del navegador (views locales), la API no lo trae.
        old?.map((t) => (t.id === ticketId ? { ...t, ...updatedTicket, unread: t.unread } : t))
      );
      queryClient.invalidateQueries({ queryKey: MY_TICKETS_QUERY_KEY });
      queryClient.invalidateQueries({ queryKey: MY_TICKETS_WITH_UNREAD_QUERY_KEY });
      queryClient.invalidateQueries({ queryKey: MY_TICKETS_PAGE_QUERY_KEY });
      // El aprobador también puede proponer sobre tickets que no reportó.
      queryClient.invalidateQueries({ queryKey: APPROVER_TICKETS_QUERY_KEY });
      // La propuesta deja un hito en el recorrido si el backend lo expone.
      queryClient.invalidateQueries({ queryKey: ticketTimelineKey(ticketId) });
    },
  });
}
