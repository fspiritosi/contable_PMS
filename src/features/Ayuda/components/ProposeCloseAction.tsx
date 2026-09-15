'use client';

import { Button } from '@/shared/components/ui/button';
import type { Ticket } from '@/shared/lib/taskapp/types';
import { DoorClosed } from 'lucide-react';
import { useState } from 'react';
import { canProposeClose } from '../constants/ticket-copy';
import { TicketCloseProposalDialog } from './detail/TicketCloseProposalDialog';

interface Props {
  ticket: Ticket;
  /**
   * `link`: acción de texto para el pie de la tarjeta, al lado de "Ver la
   * conversación". `panel`: bloque con contexto para el detalle.
   */
  variant: 'link' | 'panel';
  /** Adónde va el foco después de enviar: el aviso de propuesta pendiente. */
  focusTargetId: string;
}

/**
 * La puerta a "Proponer cierre".
 *
 * Es una acción SECUNDARIA a propósito: en un ticket en curso lo normal es
 * esperar, y un botón lleno al lado de cada ticket invitaría a cerrar cosas
 * que el equipo está por terminar. Por eso va en tono apagado y nunca con el
 * color de acento, que en el Centro de Ayuda es de "enviar reporte".
 *
 * Decide sola si se muestra (canProposeClose) para que la tarjeta y el detalle
 * no repitan la regla.
 */
export function ProposeCloseAction({ ticket, variant, focusTargetId }: Props) {
  const [open, setOpen] = useState(false);
  const proposable = canProposeClose(ticket);

  // Con el diálogo abierto se queda montado aunque el ticket deje de admitir la
  // propuesta (llega un cambio por SSE mientras la persona escribe): desmontar
  // le borraría el texto sin explicación. El diálogo avisa con `stale`.
  if (!proposable && !open) return null;

  function handleProposed() {
    // Al frame siguiente: el aviso de "pendiente" se monta en el mismo render
    // en que este botón desaparece.
    requestAnimationFrame(() => document.getElementById(focusTargetId)?.focus());
  }

  const dialog = (
    <TicketCloseProposalDialog
      ticketId={ticket.id}
      open={open}
      onOpenChange={setOpen}
      onProposed={handleProposed}
      stale={!proposable}
    />
  );

  if (variant === 'link') {
    return (
      <>
        {proposable && (
          <button
            type="button"
            aria-haspopup="dialog"
            onClick={() => setOpen(true)}
            // py-1 -my-1: el texto es xs y la zona clickeable tiene que llegar
            // a 24px de alto sin cambiar el ritmo de la fila.
            className="-my-1 inline-flex items-center gap-1.5 rounded-md py-1 font-medium text-muted-foreground transition-colors duration-150 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
          >
            <DoorClosed aria-hidden className="h-3.5 w-3.5" />
            Proponer cierre
            {/* Hay una por tarjeta: sin el número, la lista de botones del
                lector de pantalla es "Proponer cierre" repetido. */}
            <span className="sr-only"> del TKT-{ticket.id}</span>
          </button>
        )}
        {dialog}
      </>
    );
  }

  return (
    <>
      {proposable && (
        <section
          aria-label="Proponer cierre"
          className="flex flex-col gap-3 rounded-lg border border-dashed p-3 sm:flex-row sm:items-center sm:justify-between"
        >
          <p className="text-pretty text-sm text-muted-foreground">
            ¿Ya está resuelto o dejó de hacer falta? Podés proponerle al equipo cerrarlo.
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-haspopup="dialog"
            className="shrink-0 gap-1.5 self-start sm:self-auto"
            onClick={() => setOpen(true)}
          >
            <DoorClosed aria-hidden className="h-3.5 w-3.5" />
            Proponer cierre
          </Button>
        </section>
      )}
      {dialog}
    </>
  );
}
