'use client';

import { ArrowRight, CheckCircle2 } from 'lucide-react';
import { pendingSummary } from '../constants/ticket-copy';

interface Props {
  /** Tickets resueltos esperando que el cliente confirme. */
  confirmCount: number;
  /** Presupuestos esperando aprobación. */
  approveCount: number;
  /** Lleva a la pestaña "Para revisar". */
  onGo: () => void;
}

/**
 * «N tickets necesitan que los mires».
 *
 * El contenedor se monta SIEMPRE, vacío cuando no hay pendientes, y sólo
 * cambia su texto. Si en cambio se insertara en el DOM recién al aparecer el
 * primer pendiente, muchos lectores de pantalla no anunciarían nada: una
 * región live tiene que existir antes de que su contenido cambie.
 *
 * Es `role="status"` (polite) y no `alert`: hay algo para hacer, pero no es
 * urgente ni interrumpe.
 */
export function PendingBanner({ confirmCount, approveCount, onGo }: Props) {
  const total = confirmCount + approveCount;
  const detail = pendingSummary({ confirm: confirmCount, approve: approveCount });

  return (
    <div role="status" aria-live="polite">
      {total > 0 && detail && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-200 border-l-4 border-l-emerald-500 bg-emerald-50/70 px-4 py-3 duration-200 animate-in fade-in-0 slide-in-from-top-1 motion-reduce:animate-none dark:border-emerald-900/60 dark:border-l-emerald-500 dark:bg-emerald-950/30">
          <div className="flex min-w-0 items-start gap-3">
            <CheckCircle2
              aria-hidden
              className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400"
            />
            <div className="min-w-0">
              <p className="text-pretty text-sm font-semibold">
                {total === 1
                  ? '1 ticket necesita que lo mires'
                  : `${total} tickets necesitan que los mires`}
              </p>
              <p className="text-xs text-muted-foreground">{detail}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onGo}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-md text-sm font-medium text-emerald-700 underline-offset-2 transition-colors duration-150 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none dark:text-emerald-400"
          >
            Ver ahora
            <ArrowRight aria-hidden className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  );
}
