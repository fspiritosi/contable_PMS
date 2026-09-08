'use client';

import { Button } from '@/shared/components/ui/button';
import { Checkbox } from '@/shared/components/ui/checkbox';
import { CheckCircle2, ClipboardCheck, Loader2 } from 'lucide-react';
import { useId, useState } from 'react';
import { toast } from 'sonner';
import type { Ticket } from '@/shared/lib/taskapp/types';
import { canDecide, parseVerificationSteps } from '../constants/ticket-copy';
import { useConfirmTicket } from '../hooks/useConfirmTicket';
import { TicketReopenRequestDialog } from './detail/TicketReopenRequestDialog';

interface Props {
  ticket: Ticket;
  /** El aprobador puede confirmar tickets que no reportó él. */
  canAct: boolean;
}

/**
 * El bloque de resolución: qué hicimos, qué mirar para comprobarlo y las dos
 * salidas.
 *
 * Los dos primeros son OPCIONALES y cada uno aparece sólo si tiene contenido:
 * un ticket resuelto sin respuesta cargada muestra los botones y nada más, sin
 * huecos ni cajas vacías. Las salidas, en cambio, están siempre — son la razón
 * de ser del bloque.
 */
export function TicketResolutionPanel({ ticket, canAct }: Props) {
  const steps = parseVerificationSteps(ticket.verification_steps);
  const summary = ticket.client_summary?.trim();
  const decidable = canDecide(ticket);

  const confirmTicket = useConfirmTicket(ticket.id);
  const [reopenOpen, setReopenOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleConfirm() {
    setError(null);
    confirmTicket.mutate(undefined, {
      // Mismo verbo que el botón: la acción conserva el nombre en todo el flujo.
      onSuccess: () => toast.success('Listo, lo marcamos como resuelto.'),
      onError: (e) =>
        setError(e instanceof Error ? e.message : 'No se pudo registrar tu confirmación.'),
    });
  }

  return (
    <div className="flex flex-col gap-5">
      {summary && (
        <section
          aria-label="Qué hicimos"
          className="rounded-lg border border-emerald-200 bg-emerald-50/60 p-3 dark:border-emerald-900/60 dark:bg-emerald-950/30"
        >
          <h4 className="flex items-center gap-1.5 text-xs font-semibold text-emerald-700 dark:text-emerald-400">
            <CheckCircle2 aria-hidden className="h-3.5 w-3.5" />
            Qué hicimos
          </h4>
          {/* max-w-prose aunque la tarjeta sea más ancha: sin tope, en desktop
              las líneas quedan demasiado largas para leerlas de corrido.
              whitespace-pre-line porque el texto viene en párrafos sueltos. */}
          <p className="mt-1.5 max-w-prose whitespace-pre-line text-pretty break-words text-sm leading-relaxed text-foreground">
            {summary}
          </p>
        </section>
      )}

      {steps.length > 0 && <VerificationChecklist steps={steps} />}

      {decidable && (
        <div className="flex flex-col gap-2">
          {/* Los labels son largos y en mobile no entran en una fila: apilan. */}
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <Button
              type="button"
              onClick={handleConfirm}
              disabled={!canAct || confirmTicket.isPending}
              aria-busy={confirmTicket.isPending}
              className="gap-2 bg-emerald-600 text-white hover:bg-emerald-700 focus-visible:ring-emerald-600 active:scale-[0.98] motion-reduce:transition-none motion-reduce:active:scale-100"
            >
              {confirmTicket.isPending ? (
                <Loader2 aria-hidden className="h-4 w-4 animate-spin" />
              ) : (
                <CheckCircle2 aria-hidden className="h-4 w-4" />
              )}
              Sí, quedó resuelto
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={!canAct || confirmTicket.isPending}
              onClick={() => setReopenOpen(true)}
            >
              No quedó resuelto
            </Button>
            <p className="text-xs text-muted-foreground sm:ms-1">
              Confirmar cierra el ticket. Podés pedir la reapertura más adelante.
            </p>
          </div>

          {/* El error va acá, al lado del botón que falló, y no en un toast:
              el toast se va solo y el cliente queda sin saber si confirmó. */}
          {error && (
            <p role="alert" className="text-xs text-destructive">
              {error}{' '}
              <button
                type="button"
                onClick={handleConfirm}
                className="underline underline-offset-2 hover:no-underline"
              >
                Reintentar
              </button>
            </p>
          )}

          {!canAct && (
            <p className="text-xs text-muted-foreground">
              Sólo quien reportó el ticket o un aprobador del proyecto puede responder.
            </p>
          )}

          <TicketReopenRequestDialog
            ticketId={ticket.id}
            open={reopenOpen}
            onOpenChange={setReopenOpen}
          />
        </div>
      )}
    </div>
  );
}

/**
 * «Qué mirar para confirmarlo», devuelto como checklist.
 *
 * Los tildes viven sólo en el navegador y no se guardan: son una ayuda para no
 * perder el hilo mientras se comprueba, no un formulario. Se lo decimos abajo
 * en vez de dejar que el cliente lo descubra recargando la página.
 */
function VerificationChecklist({ steps }: { steps: string[] }) {
  const baseId = useId();
  const [checked, setChecked] = useState<Set<number>>(() => new Set());
  const done = checked.size;

  return (
    <section aria-label="Qué mirar para confirmarlo" className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h4 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          <ClipboardCheck aria-hidden className="h-3.5 w-3.5" />
          Qué mirar para confirmarlo
        </h4>
        <span className="text-[11px] tabular-nums text-muted-foreground">
          {done} de {steps.length}
        </span>
      </div>

      <ul className="flex flex-col gap-1.5">
        {steps.map((step, i) => {
          const id = `${baseId}-step-${i}`;
          return (
            <li key={id}>
              {/* El label envuelve al checkbox: tocar el texto tilda el ítem.
                  Con el texto fuera del label queda una zona muerta enorme,
                  que es el error clásico de estos checklists. */}
              <label
                htmlFor={id}
                className="flex cursor-pointer items-start gap-2.5 rounded-md border bg-muted/20 p-2.5 transition-colors duration-150 hover:bg-muted/40 motion-reduce:transition-none"
              >
                <Checkbox
                  id={id}
                  checked={checked.has(i)}
                  onCheckedChange={(value) =>
                    setChecked((prev) => {
                      const next = new Set(prev);
                      if (value) next.add(i);
                      else next.delete(i);
                      return next;
                    })
                  }
                  className="mt-0.5 shrink-0"
                />
                <span
                  className={`min-w-0 break-words text-sm leading-relaxed ${
                    checked.has(i) ? 'text-muted-foreground line-through' : 'text-foreground'
                  }`}
                >
                  {step}
                </span>
              </label>
            </li>
          );
        })}
      </ul>

      <p className="text-[11px] text-muted-foreground">
        Los tildes son sólo para vos: no se guardan.
      </p>
    </section>
  );
}
