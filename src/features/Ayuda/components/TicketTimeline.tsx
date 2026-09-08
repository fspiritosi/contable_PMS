'use client';

import moment from 'moment';
import 'moment/locale/es';
import type { TicketMilestone } from '@/shared/lib/taskapp/types';

interface Props {
  milestones: TicketMilestone[];
  isLoading?: boolean;
}

/**
 * Recorrido del ticket.
 *
 * «Resuelto» solo no dice cuánto tardó ni por dónde pasó. Los hitos con fecha
 * responden eso de un vistazo y dejan claro que la última parada es la del
 * cliente.
 *
 * Se muestra el timeline SÓLO con 3 hitos o más. Con menos, un carril
 * horizontal ocupa media tarjeta para decir «entró y salió»: ahí una línea de
 * texto dice lo mismo y no le roba espacio al «qué hicimos», que es lo que el
 * cliente vino a leer.
 *
 * Los hitos vienen ya filtrados del backend: las paradas internas del equipo
 * («Revisión en Dev» y compañía) no llegan hasta acá.
 */
export function TicketTimeline({ milestones, isLoading }: Props) {
  if (isLoading) {
    return (
      <div className="h-10 animate-pulse rounded-md bg-muted/60" aria-hidden />
    );
  }

  if (milestones.length === 0) return null;

  if (milestones.length < 3) {
    return (
      <p className="text-xs text-muted-foreground">
        {milestones.map((m, i) => (
          <span key={`${m.key}-${m.at}`}>
            {i > 0 && ' · '}
            {m.label} el{' '}
            <time dateTime={m.at} className="tabular-nums">
              {moment(m.at).locale('es').format('D MMM')}
            </time>
          </span>
        ))}
      </p>
    );
  }

  const lastIndex = milestones.length - 1;

  return (
    <section aria-label="Recorrido del ticket" className="flex flex-col gap-2">
      <h4 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        Recorrido del ticket
      </h4>
      {/* Vertical en pantallas chicas y con zoom alto: un carril horizontal a
          320px obliga a scrollear de costado para leer las fechas, que es
          justo el dato por el que existe el recorrido. */}
      <ol className="flex flex-col gap-3 sm:flex-row sm:gap-0">
        {milestones.map((m, i) => {
          const isLast = i === lastIndex;
          return (
            <li
              key={`${m.key}-${m.at}`}
              className="relative flex min-w-0 items-start gap-2 sm:flex-1 sm:flex-col sm:items-stretch sm:gap-1.5"
            >
              <div className="flex shrink-0 items-center sm:w-full">
                <span
                  aria-hidden
                  className={`inline-flex h-2.5 w-2.5 shrink-0 rounded-full ring-2 ring-background ${
                    isLast ? 'bg-emerald-500' : 'bg-muted-foreground/40'
                  }`}
                />
                {/* El riel une hitos; en la última parada no hay nada que unir. */}
                {!isLast && (
                  <span
                    aria-hidden
                    className="ms-1 hidden h-px flex-1 bg-border sm:block"
                  />
                )}
              </div>
              <div className="min-w-0 flex-1 sm:pe-2">
                <p
                  className={`truncate text-xs font-medium ${
                    isLast ? 'text-emerald-600 dark:text-emerald-400' : 'text-foreground'
                  }`}
                  title={m.label}
                >
                  {m.label}
                  {/* El color no puede ser la única señal de "acá está parado". */}
                  {isLast && <span className="sr-only"> — última parada</span>}
                </p>
                <time
                  dateTime={m.at}
                  className="text-[11px] tabular-nums text-muted-foreground"
                >
                  {moment(m.at).locale('es').format('D MMM')}
                </time>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
