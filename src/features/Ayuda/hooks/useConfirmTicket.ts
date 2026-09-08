'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { confirmSupportTicket } from '../actions/support-confirm';
import { MY_TICKETS_QUERY_KEY } from './useMyTickets';
import { MY_TICKETS_PAGE_QUERY_KEY } from './useMyTicketsPage';
import { ticketDetailKey } from './useTicketDetail';
import { MY_TICKETS_WITH_UNREAD_QUERY_KEY } from './queryKeys';
import { APPROVER_TICKETS_QUERY_KEY } from './useApproverTickets';

/**
 * "Sí, quedó resuelto". Mismo patrón de invalidación que la solicitud de
 * reapertura: el ticket cambia de pestaña, así que hay que refrescar las tres
 * listas, no sólo el detalle.
 */
export function useConfirmTicket(ticketId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => confirmSupportTicket(ticketId),
    onSuccess: (updatedTicket) => {
      queryClient.setQueryData(ticketDetailKey(ticketId), updatedTicket);
      queryClient.invalidateQueries({ queryKey: MY_TICKETS_QUERY_KEY });
      queryClient.invalidateQueries({ queryKey: MY_TICKETS_WITH_UNREAD_QUERY_KEY });
      queryClient.invalidateQueries({ queryKey: MY_TICKETS_PAGE_QUERY_KEY });
      // El aprobador puede confirmar tickets que no reportó: sus dos listas
      // quedarían mostrando el ticket como pendiente hasta el próximo refetch.
      queryClient.invalidateQueries({ queryKey: APPROVER_TICKETS_QUERY_KEY });
    },
  });
}
