import type { Ticket } from '@/shared/lib/taskapp/types';

/**
 * La regla que ordena todo el Centro de Ayuda: de todos los estados por los
 * que pasa un ticket, SÓLO DOS le piden algo al cliente — "Esperando tu
 * aprobación" y "Resuelto". Esos dos van a la pestaña "Para revisar"; el
 * resto es información y no debe competir por su atención.
 *
 * Sin esta regla las tres pestañas son tres listas y el cliente tiene que
 * adivinar en cuál hay algo para hacer.
 */
export type TicketBucket = 'review' | 'active' | 'closed';

export const BUCKET_LABEL: Record<TicketBucket, string> = {
  review: 'Para revisar',
  active: 'En curso',
  closed: 'Cerrados',
};

/** Qué se espera del cliente en este ticket. */
export type TicketDemand = 'approve' | 'confirm' | 'none';

interface StatusCopy {
  /** Qué le decimos que está pasando. Una línea, sin jerga. */
  message: string;
  demand: TicketDemand;
}

const RESOLVED_SLUGS = new Set(['resolved', 'done']);
const CLOSED_SLUGS = new Set(['closed', 'cancelled']);

/**
 * Copy por estado. Es una tabla y no un `switch` para que agregar un estado
 * sea agregar una fila.
 *
 * Ojo: las claves son los slugs SEMBRADOS. Los estados son datos editables
 * desde Admin, así que un slug que no esté acá cae en el copy genérico de
 * `copyFor()` — nunca se muestra el nombre crudo del estado.
 */
const COPY_BY_SLUG: Record<string, StatusCopy> = {
  open: {
    message: 'Lo recibimos. Un responsable lo va a mirar.',
    demand: 'none',
  },
  pendiente_aprobacion: {
    message: 'Te pasamos el esfuerzo y la fecha estimada. No arrancamos hasta que respondas.',
    demand: 'approve',
  },
  aprobado_cliente: {
    message: 'Aprobaste el presupuesto. Queda en cola.',
    demand: 'none',
  },
  valued: {
    message: 'Ya lo dimensionamos y estamos por pasarte el detalle.',
    demand: 'none',
  },
  pending_planning: {
    message: 'Entra en la próxima planificación; te confirmamos la fecha acá.',
    demand: 'none',
  },
  planned: {
    message: 'Ya está agendado. Te avisamos cuando arranque.',
    demand: 'none',
  },
  in_progress: {
    message: 'Lo estamos trabajando. Te avisamos en cuanto haya novedades.',
    demand: 'none',
  },
  blocked: {
    message: 'Está frenado por algo que necesitamos resolver antes. Te avisamos apenas se destrabe.',
    demand: 'none',
  },
  resolved: {
    message: 'Terminamos. Fijate si quedó como esperabas y contanos.',
    demand: 'confirm',
  },
  done: {
    message: 'Terminamos. Fijate si quedó como esperabas y contanos.',
    demand: 'confirm',
  },
  closed: {
    message: 'Confirmaste que quedó resuelto.',
    demand: 'none',
  },
  cancelled: {
    message: 'No lo vamos a hacer. El motivo está en la conversación del ticket.',
    demand: 'none',
  },
};

/**
 * Copy genérico para los estados que no están en la tabla. El backend ya
 * reemplaza los estados internos por la última parada visible, así que esto
 * es la segunda red: aunque llegara un slug desconocido, el cliente lee "está
 * en curso" y nunca el nombre interno del estado.
 */
const FALLBACK_COPY: StatusCopy = {
  message: 'Lo estamos trabajando. Te avisamos en cuanto haya novedades.',
  demand: 'none',
};

export function copyFor(ticket: Ticket): StatusCopy {
  // Una reapertura pendiente le gana a cualquier estado: el cliente ya
  // respondió y la pelota volvió a ser nuestra.
  if (ticket.reopen_status === 'pending') {
    return {
      message: 'Recibimos tu pedido de reapertura; te respondemos a la brevedad.',
      demand: 'none',
    };
  }

  // Confirmado por el cliente: aunque el estado siga diciendo "Resuelto"
  // (porque la instalación no tiene el estado "Cerrado"), ya no hay nada
  // pendiente de su parte.
  if (ticket.client_confirmed_at) {
    return COPY_BY_SLUG.closed;
  }

  const slug = ticket.status?.slug;
  return (slug && COPY_BY_SLUG[slug]) || FALLBACK_COPY;
}

/** Qué necesitamos del cliente en este ticket, si es que necesitamos algo. */
export function demandFor(ticket: Ticket): TicketDemand {
  return copyFor(ticket).demand;
}

export function bucketFor(ticket: Ticket): TicketBucket {
  const slug = ticket.status?.slug;

  // Cerrado primero: un ticket confirmado o cancelado no vuelve a pedir nada,
  // aunque su slug siga siendo "resolved".
  if (ticket.client_confirmed_at) return 'closed';
  if (slug && CLOSED_SLUGS.has(slug)) return 'closed';

  return demandFor(ticket) === 'none' ? 'active' : 'review';
}

/** Un resuelto sin confirmar todavía admite las dos salidas. */
export function canDecide(ticket: Ticket): boolean {
  const slug = ticket.status?.slug;
  return (
    !!slug &&
    RESOLVED_SLUGS.has(slug) &&
    !ticket.client_confirmed_at &&
    ticket.reopen_status !== 'pending'
  );
}

/**
 * Parte `verification_steps` en ítems de checklist. Una línea por cosa a
 * comprobar; se toleran viñetas escritas a mano ("- ", "* ", "1. ") porque
 * quien lo carga escribe en un textarea y las pone sin pensar.
 */
export function parseVerificationSteps(raw: string | null): string[] {
  if (!raw) return [];
  return raw
    .split('\n')
    .map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim())
    .filter((line) => line.length > 0);
}

/**
 * Resumen del banner de pendientes, en strings completos. No se arma
 * concatenando fragmentos alrededor de un número: en español el plural cambia
 * el artículo y el verbo, y "1 tickets necesitan" queda roto.
 */
export function pendingSummary(counts: { confirm: number; approve: number }): string | null {
  const parts: string[] = [];
  if (counts.confirm > 0) {
    parts.push(
      counts.confirm === 1 ? '1 ticket resuelto para revisar' : `${counts.confirm} tickets resueltos para revisar`
    );
  }
  if (counts.approve > 0) {
    parts.push(
      counts.approve === 1 ? '1 presupuesto para aprobar' : `${counts.approve} presupuestos para aprobar`
    );
  }
  return parts.length > 0 ? parts.join(' · ') : null;
}
