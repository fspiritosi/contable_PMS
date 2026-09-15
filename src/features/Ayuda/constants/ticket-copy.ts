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

  // Lo mismo con una propuesta de cierre: ya se dijo lo que había que decir y
  // ahora responde el equipo. `demand: 'none'` es lo que la deja en "En curso"
  // — mandarla a "Para revisar" sería pedirle al cliente algo que ya hizo.
  // Impersonal ("la propuesta", no "tu propuesta") porque la puede estar
  // leyendo el aprobador sobre un ticket que propuso quien lo reportó.
  if (ticket.close_proposal_status === 'pending') {
    return {
      message:
        ticket.close_proposal_target === 'cancelled'
          ? 'Recibimos el pedido de cancelarlo. El equipo lo revisa y te avisamos; mientras tanto sigue en curso.'
          : 'Recibimos la propuesta de darlo por resuelto. El equipo la revisa y te avisamos; mientras tanto sigue en curso.',
      demand: 'none',
    };
  }

  // Confirmado por el cliente: aunque el estado siga diciendo "Resuelto"
  // (porque la instalación no tiene el estado "Cerrado"), ya no hay nada
  // pendiente de su parte.
  if (ticket.client_confirmed_at) {
    return COPY_BY_SLUG.closed;
  }

  // El rechazo sólo se cuenta mientras el ticket siga en curso. Los campos del
  // último rechazo quedan guardados para siempre; si el ticket después se
  // resuelve o se cancela, lo que importa es eso y no una propuesta vieja.
  // El motivo NO va en esta línea: puede tener mil caracteres y saltos de
  // línea, así que se muestra entero en el aviso de la tarjeta y del detalle.
  const statusCopy = statusCopyFor(ticket);
  if (ticket.close_proposal_declined_at && isInProgress(ticket, statusCopy)) {
    return {
      message: 'El equipo revisó la propuesta de cierre y va a seguir con el ticket.',
      demand: 'none',
    };
  }

  return statusCopy;
}

/** Sólo la tabla por estado, sin los flags que le ganan en `copyFor`. */
function statusCopyFor(ticket: Ticket): StatusCopy {
  const slug = ticket.status?.slug;
  return (slug && COPY_BY_SLUG[slug]) || FALLBACK_COPY;
}

/**
 * "En curso" mirando sólo el estado: ni cerrado ni esperando algo del cliente.
 * Recibe el copy ya resuelto y NO llama a `copyFor`/`bucketFor`, porque
 * `copyFor` lo usa por adentro y la vuelta sería una recursión infinita.
 */
function isInProgress(ticket: Ticket, statusCopy: StatusCopy): boolean {
  const slug = ticket.status?.slug;
  if (ticket.client_confirmed_at) return false;
  if (slug && CLOSED_SLUGS.has(slug)) return false;
  return statusCopy.demand === 'none';
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
    ticket.reopen_status !== 'pending' &&
    ticket.close_proposal_status !== 'pending'
  );
}

/** Largo del motivo de una propuesta de cierre. El backend valida lo mismo. */
export const CLOSE_REASON_MIN = 10;
export const CLOSE_REASON_MAX = 1000;

/**
 * "Proponer cierre" existe sólo en tickets en curso.
 *
 * Se apoya en la misma definición de "en curso" que arma las pestañas, en vez
 * de repetir una lista de slugs: dos definiciones terminan divergiendo. Eso
 * deja afuera, sin nombrarlos, a los resueltos (ya tienen su propia salida en
 * TicketResolutionPanel), a los cerrados y a los que esperan aprobación de
 * presupuesto (ahí la salida es rechazarlo).
 *
 * Una propuesta pendiente también mantiene el ticket en "En curso", así que se
 * excluye aparte: proponer dos veces lo mismo sólo le suma ruido al equipo.
 * Una reapertura pendiente, por lo mismo: el cliente ya dijo lo contrario.
 */
export function canProposeClose(ticket: Ticket): boolean {
  return (
    ticket.close_proposal_status !== 'pending' &&
    ticket.reopen_status !== 'pending' &&
    isInProgress(ticket, statusCopyFor(ticket))
  );
}

/**
 * Validación del motivo, compartida entre el diálogo y la server action. Vive
 * acá (y no duplicada en cada lado) para que el mensaje que ve el cliente al
 * escribir sea exactamente el mismo que devolvería el servidor.
 *
 * Cancelar exige motivo: sin él, el equipo no sabe si dejó de hacer falta o si
 * el cliente se cansó de esperar, que son dos conversaciones distintas. Para
 * "ya está resuelto" el motivo es un extra: el hecho ya lo dice todo.
 */
export function closeReasonError(target: 'resolved' | 'cancelled', reason: string): string | null {
  const length = reason.trim().length;
  if (length > CLOSE_REASON_MAX) {
    return `Acortalo un poco: puede tener hasta ${CLOSE_REASON_MAX} caracteres.`;
  }
  if (target === 'cancelled' && length < CLOSE_REASON_MIN) {
    return length === 0
      ? 'Contanos por qué ya no lo necesitás.'
      : `Escribí al menos ${CLOSE_REASON_MIN} caracteres.`;
  }
  return null;
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
