export interface TicketStatus {
  id: number;
  slug: string;
  name: string;
  color?: string;
}

export interface TicketLabel {
  id: number;
  name: string;
  slug: string;
  color?: string;
}

export type TicketPriority = 'low' | 'medium' | 'high' | 'critical';

export interface Ticket {
  id: number;
  title: string;
  description: string;
  status_id: number;
  status?: TicketStatus;
  priority: TicketPriority;
  origin?: 'internal' | 'external';
  reporter_email: string | null;
  reporter_name: string | null;
  approver_email: string | null;
  estimated_hours: number | null;
  attachments: string[];
  /**
   * "Qué hicimos", redactado para el cliente por quien resolvió. Opcional: un
   * ticket trivial puede resolverse sin cargarlo y la tarjeta se arma igual.
   * NO es `completion_summary` — ese es la nota técnica interna (rutas de
   * archivos, hashes de commit) y la API pública no lo expone.
   */
  client_summary: string | null;
  /**
   * "Qué mirar para confirmarlo": una línea por cosa a comprobar. También lo
   * escribe soporte al resolver, porque el que sabe qué se tocó es quien lo
   * arregló — no se le pide al cliente cuando reporta.
   */
  verification_steps: string | null;
  /** Cuándo y quién verificó el arreglo del lado del cliente. */
  client_confirmed_at: string | null;
  client_confirmed_by: string | null;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
  valorized_at: string | null;
  labels: TicketLabel[];
  reopen_status: 'pending' | null;
  reopen_reason: string | null;
  reopen_attachments: string[];
  reopen_requested_at: string | null;
}

export interface Comment {
  id: number;
  task_id: number;
  author_email: string | null;
  body: string;
  is_internal: boolean;
  /**
   * URLs ya firmadas de los archivos del comentario: el backend reemplaza las
   * storage keys por URLs firmadas antes de responder, igual que hace con las
   * del ticket. Llega `null` cuando el comentario no tiene ninguno (slice nil
   * de Go), así que siempre hay que defenderse con `?? []`.
   *
   * No es lo mismo que `Ticket.attachments`: estos pertenecen a UN mensaje del
   * hilo. Ahí van a parar, por ejemplo, las capturas de una solicitud de
   * reapertura, que el backend copia al comentario porque los campos
   * `reopen_*` se limpian cuando la reapertura se resuelve.
   */
  attachments: string[] | null;
  created_at: string;
}

export interface CreateTicketRequest {
  title: string;
  description: string;
  reporter_email: string;
  reporter_name?: string;
  priority: TicketPriority;
  attachments?: string[];
}

export interface CreateCommentRequest {
  body: string;
  author_email: string;
}

export interface UploadResult {
  key: string;
}

export type TaskAppRealtimeEvent =
  | { type: 'connected' }
  | { type: 'ticket.created'; id: number }
  | { type: 'ticket.updated'; id: number }
  | { type: 'comment.created'; id: number };

export interface TicketUnreadState {
  hasStatusChange: boolean;
  hasNewAgentComment: boolean;
  lastSeenAt: string | null;
}

export type TicketWithUnread = Ticket & {
  unread: TicketUnreadState;
};

/**
 * Una parada del recorrido del ticket tal como se la cuenta al cliente. Viene
 * ya filtrada por el backend: los estados internos del equipo ("Revisión en
 * Dev" y compañía) no llegan hasta acá.
 */
export interface TicketMilestone {
  /** Slug del estado, o "received" para el alta. */
  key: string;
  label: string;
  color?: string;
  at: string;
}

export interface TicketTimeline {
  ticket_id: number;
  milestones: TicketMilestone[];
}
