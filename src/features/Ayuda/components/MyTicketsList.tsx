'use client';

import { Button } from '@/shared/components/ui/button';
import { useState } from 'react';
import type { TicketWithUnread } from '@/shared/lib/taskapp/types';
import { MyTicketsListSkeleton } from '../fallback/MyTicketsListSkeleton';
import type { TicketBucket } from '../constants/ticket-copy';
import { EmptyTicketsState } from './EmptyTicketsState';
import { TicketCard } from './TicketCard';

/** Cuántas tarjetas se muestran de entrada en cada pestaña. */
const PAGE_SIZE = 5;

interface Props {
  tickets: TicketWithUnread[];
  bucket: TicketBucket;
  /** Tickets del usuario en TODAS las pestañas: distingue "no hay acá" de "no hay nada". */
  totalTickets: number;
  onOpenDetail: (id: number) => void;
  canAct: boolean;
  isLoading?: boolean;
  /** Falló la carga: se muestra el error con su acción de recuperación. */
  error?: boolean;
  onRetry?: () => void;
  /** Abre el formulario de reporte desde el estado vacío inicial. */
  onReport?: () => void;
}

export function MyTicketsList({
  tickets,
  bucket,
  totalTickets,
  onOpenDetail,
  canAct,
  isLoading,
  error,
  onRetry,
  onReport,
}: Props) {
  const [visible, setVisible] = useState(PAGE_SIZE);

  // Al cambiar de pestaña se vuelve al tope: si no, entrar a "Cerrados"
  // después de haber expandido "En curso" arranca mostrando 20 tarjetas.
  // Se ajusta durante el render y no en un efecto: asi la lista nunca llega a
  // pintarse expandida para volver a cortarse en el frame siguiente (y el
  // React Compiler marca set-state-in-effect como error).
  const [prevBucket, setPrevBucket] = useState(bucket);
  if (prevBucket !== bucket) {
    setPrevBucket(bucket);
    setVisible(PAGE_SIZE);
  }

  if (isLoading) return <MyTicketsListSkeleton />;

  // El error ocupa la misma caja que ocuparía la lista: si colapsa, el panel
  // se encoge de golpe y la pantalla salta.
  if (error) {
    return (
      <div
        role="alert"
        className="flex min-h-[220px] flex-col items-center justify-center gap-3 px-4 py-10 text-center"
      >
        <p className="text-sm font-semibold">No se pudieron cargar tus tickets</p>
        <p className="max-w-[42ch] text-pretty text-sm leading-relaxed text-muted-foreground">
          Revisá tu conexión y probá de nuevo. Si sigue pasando, avisanos por otro canal.
        </p>
        {onRetry && (
          <Button type="button" variant="outline" size="sm" onClick={onRetry}>
            Reintentar
          </Button>
        )}
      </div>
    );
  }

  if (tickets.length === 0) {
    // Sin un solo ticket en toda su historia, «Estás al día» no le dice nada a
    // nadie: nunca hubo algo que revisar. Ese es el único momento en que la
    // pantalla puede explicarse sola y ofrecer la acción que corresponde.
    return totalTickets === 0 ? (
      <EmptyTicketsState onReport={onReport} />
    ) : (
      <EmptyTicketsState bucket={bucket} />
    );
  }

  const shown = tickets.slice(0, visible);
  const remaining = tickets.length - shown.length;

  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col gap-3">
        {shown.map((ticket, i) => (
          <li key={ticket.id}>
            <TicketCard
              ticket={ticket}
              onOpenDetail={onOpenDetail}
              canAct={canAct}
              // Sólo el primero de "Para revisar" nace abierto: es el que pide
              // una respuesta y el que el cliente vino a atender. Abrirlos
              // todos convierte la pestaña en un muro y ninguno destaca.
              defaultOpen={bucket === 'review' && i === 0}
            />
          </li>
        ))}
      </ul>

      {remaining > 0 && (
        // Ancho completo y en tono secundario: es el pie de la lista, no una
        // acción que compita con las de cada ticket.
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="w-full text-xs font-medium text-muted-foreground hover:text-foreground"
          onClick={() => setVisible((v) => v + PAGE_SIZE)}
        >
          Ver {remaining === 1 ? '1 ticket más' : `${remaining} tickets más`}
        </Button>
      )}
    </div>
  );
}
