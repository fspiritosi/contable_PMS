import { Button } from '@/shared/components/ui/button';
import { Archive, CheckCircle2, Clock, Inbox } from 'lucide-react';
import type { TicketBucket } from '../constants/ticket-copy';

interface Props {
  /** Sin pestaña: el usuario no tiene ni un ticket en toda su historia. */
  bucket?: TicketBucket;
  /**
   * Sólo se pasa en el vacío inicial. Un vacío que informa y no ofrece nada
   * es decoración; uno que ofrece la acción en las tres pestañas es ruido
   * repetido tres veces.
   */
  onReport?: () => void;
}

/**
 * Cada pestaña vacía significa algo distinto y necesita su propio texto.
 * «Para revisar» vacío es una buena noticia — estás al día — mientras que
 * «Cerrados» vacío es apenas un dato. Repetir «No hay resultados» tres veces
 * desperdicia el único momento en que la pantalla puede explicarse sola.
 */
const COPY: Record<TicketBucket | 'none', { icon: typeof Inbox; title: string; body: string }> = {
  none: {
    icon: Inbox,
    title: 'Todavía no enviaste ningún reporte',
    body: 'Cuando reportes algo, vas a seguirlo acá con su estado actualizado.',
  },
  review: {
    icon: CheckCircle2,
    title: 'Estás al día',
    body: 'No hay nada esperando una respuesta tuya. Cuando terminemos algo, aparece acá para que lo revises.',
  },
  active: {
    icon: Clock,
    title: 'No hay nada en curso',
    body: 'Ningún reporte tuyo está en camino ahora mismo.',
  },
  closed: {
    icon: Archive,
    title: 'Todavía no se cerró ningún ticket',
    body: 'Acá van a quedar los reportes terminados, con el motivo del cierre a la vista.',
  },
};

export function EmptyTicketsState({ bucket, onReport }: Props) {
  const { icon: Icon, title, body } = COPY[bucket ?? 'none'];

  return (
    // La misma altura mínima que el error y que un par de tarjetas: las tres
    // salidas de la lista ocupan la misma caja y el panel no cambia de tamaño
    // al cambiar de pestaña.
    <div className="flex min-h-[220px] flex-col items-center justify-center px-4 py-10 text-center">
      {/* Contorno y relleno tenue en vez de un bloque macizo: a 48px con
          `bg-muted` sólido el ícono pesaba más que el título y el vacío se
          leía como una ilustración. */}
      <span className="mb-3.5 inline-flex size-10 items-center justify-center rounded-lg border bg-muted/40 text-muted-foreground">
        <Icon aria-hidden className="size-5" strokeWidth={1.75} />
      </span>
      <h3 className="text-balance text-sm font-semibold tracking-tight">{title}</h3>
      <p className="mt-1.5 max-w-[40ch] text-pretty text-sm leading-relaxed text-muted-foreground">
        {body}
      </p>
      {onReport && (
        // Secundario: el botón sólido de la pantalla es «Enviar reporte», y
        // este apunta justamente a ese formulario.
        <Button type="button" variant="outline" size="sm" className="mt-4" onClick={onReport}>
          Reportar un problema
        </Button>
      )}
    </div>
  );
}
