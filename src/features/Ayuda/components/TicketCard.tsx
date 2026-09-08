'use client';

import { Button } from '@/shared/components/ui/button';
import { Card } from '@/shared/components/ui/card';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/shared/components/ui/collapsible';
import { ChevronDown, MessageSquare, Paperclip, Tag } from 'lucide-react';
import moment from 'moment';
import 'moment/locale/es';
import { useState } from 'react';
import type { TicketWithUnread } from '@/shared/lib/taskapp/types';
import { parseCategoryFromTitle } from '../constants/categories';
import { canDecide, copyFor, demandFor } from '../constants/ticket-copy';
import { statusFor } from '../constants/ticket-status';
import { useMarkTicketAsReadMutation } from '../hooks/useMarkTicketAsReadMutation';
import { useTicketTimeline } from '../hooks/useTicketTimeline';
import { TicketPriorityBadge } from './TicketPriorityBadge';
import { TicketResolutionPanel } from './TicketResolutionPanel';
import { TicketTimeline } from './TicketTimeline';

interface Props {
  ticket: TicketWithUnread;
  /** Abre el Sheet con la conversación completa. */
  onOpenDetail: (id: number) => void;
  /** El aprobador puede responder tickets que no reportó él. */
  canAct: boolean;
  /** Arranca abierta: el primer ticket de "Para revisar". */
  defaultOpen?: boolean;
}

/**
 * La tarjeta de un ticket.
 *
 * Antes un resuelto y un cancelado se veían igual: una línea de texto gris.
 * Abierta, la tarjeta responde las tres preguntas del cliente en el mismo
 * lugar — qué hicimos, qué mirar para saber si está, y qué hago ahora.
 *
 * El disclosure es un `<button>` real dentro del `<h3>` y NO envuelve a la
 * tarjeta entera: adentro hay botones y checkboxes, y anidar controles dentro
 * de otro control rompe el teclado y los lectores de pantalla. (La versión
 * anterior era un `div role="button"` con la card completa como área
 * clickeable.)
 */
export function TicketCard({ ticket, onOpenDetail, canAct, defaultOpen = false }: Props) {
  const [open, setOpen] = useState(defaultOpen);
  const { categoryLabel, categoryDef, cleanTitle } = parseCategoryFromTitle(ticket.title);
  const status = statusFor(ticket.status?.slug);
  const CategoryIcon = categoryDef?.icon ?? Tag;
  const { message } = copyFor(ticket);
  const demand = demandFor(ticket);
  const decidable = canDecide(ticket);

  const hasNovelty = ticket.unread.hasStatusChange || ticket.unread.hasNewAgentComment;
  const markAsRead = useMarkTicketAsReadMutation();

  // El recorrido se pide recién al abrir: en el listado sería una consulta de
  // eventos por fila para un dato que casi nadie mira colapsado.
  const timeline = useTicketTimeline(ticket.id, open);

  function handleOpenChange(next: boolean) {
    setOpen(next);
    // Abrir el ticket ES leerlo: es lo que apaga la marca de novedad.
    if (next && hasNovelty) markAsRead.mutate(ticket.id);
  }

  const attachmentCount = ticket.attachments?.length ?? 0;

  return (
    // `rounded-lg` y no el `rounded-xl` que trae la Card: ahora la tarjeta vive
    // adentro del panel de la lista, que ya es `rounded-xl`. Anidar dos radios
    // iguales es lo que hace que un bloque se sienta pegado en vez de contenido.
    <Card
      className={`gap-0 overflow-hidden rounded-lg border-l-4 p-0 ${status.borderClass} ${
        demand !== 'none' ? 'shadow-sm' : ''
      }`}
    >
      <Collapsible open={open} onOpenChange={handleOpenChange}>
        <div className="flex flex-col gap-2 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ring-border">
              <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${status.dotClass}`} />
              {status.label}
            </span>

            {/* El texto se guarda en case natural y las mayúsculas las pone el
                CSS: en caps literal el lector de pantalla lo deletrea. */}
            {hasNovelty && (
              <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-primary">
                <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-primary" />
                Novedad
              </span>
            )}

            <span className="ms-auto flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
              <span className="tabular-nums">TKT-{ticket.id}</span>
              {categoryLabel && (
                <span className="hidden items-center gap-1 sm:inline-flex">
                  <CategoryIcon aria-hidden className="h-3.5 w-3.5" />
                  {categoryLabel}
                </span>
              )}
              <TicketPriorityBadge slug={ticket.priority} />
            </span>
          </div>

          <h3 className="min-w-0">
            <CollapsibleTrigger className="group flex w-full items-start gap-2 rounded-md text-start transition-colors duration-150 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none">
              <span className="min-w-0 flex-1 break-words text-balance text-base font-semibold leading-snug tracking-tight">
                {cleanTitle}
              </span>
              <ChevronDown
                aria-hidden
                className={`mt-1 h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-150 motion-reduce:transition-none ${
                  open ? 'rotate-180' : ''
                }`}
              />
            </CollapsibleTrigger>
          </h3>

          {/* La línea que dice qué está pasando y qué esperamos. Es el copy por
              estado, no el nombre del estado repetido. */}
          <p className="text-pretty text-sm text-muted-foreground">
            {message}{' '}
            <time dateTime={ticket.updated_at} className="whitespace-nowrap">
              · {moment(ticket.updated_at).locale('es').fromNow()}
            </time>
          </p>
        </div>

        <CollapsibleContent>
          <div className="flex flex-col gap-5 border-t px-4 pb-4 pt-4 duration-150 animate-in fade-in-0 motion-reduce:animate-none">
            <TicketTimeline
              milestones={timeline.data?.milestones ?? []}
              isLoading={timeline.isLoading}
            />

            {ticket.description && (
              <section aria-label="Lo que reportaste" className="flex flex-col gap-1">
                <h4 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Lo que reportaste
                </h4>
                <p className="max-w-prose whitespace-pre-line text-pretty break-words text-sm leading-relaxed text-muted-foreground">
                  {ticket.description}
                </p>
              </section>
            )}

            {decidable && <TicketResolutionPanel ticket={ticket} canAct={canAct} />}

            {/* Aprobar o rechazar un presupuesto necesita ver las horas y el
                detalle, que viven en el Sheet: acá va la puerta, no una
                segunda copia del flujo de aprobación. */}
            {demand === 'approve' && (
              <Button
                type="button"
                className="self-start gap-2"
                onClick={() => onOpenDetail(ticket.id)}
              >
                Revisar el presupuesto del TKT-{ticket.id}
              </Button>
            )}

            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t pt-3 text-xs">
              <button
                type="button"
                onClick={() => onOpenDetail(ticket.id)}
                className="inline-flex items-center gap-1.5 rounded-md font-medium text-primary underline-offset-2 transition-colors duration-150 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
              >
                <MessageSquare aria-hidden className="h-3.5 w-3.5" />
                Ver la conversación del TKT-{ticket.id}
              </button>
              {attachmentCount > 0 && (
                <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                  <Paperclip aria-hidden className="h-3.5 w-3.5" />
                  <span className="tabular-nums">{attachmentCount}</span>
                  {attachmentCount === 1 ? 'adjunto' : 'adjuntos'}
                </span>
              )}
              <time
                dateTime={ticket.created_at}
                className="ms-auto whitespace-nowrap text-muted-foreground"
              >
                Reportado el {moment(ticket.created_at).locale('es').format('D MMM YYYY')}
              </time>
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}
