import { Avatar, AvatarFallback } from '@/shared/components/ui/avatar';
import { Wrench } from 'lucide-react';
import moment from 'moment';
import 'moment/locale/es';
import type { Comment } from '@/shared/lib/taskapp/types';
import { TicketAttachmentsList } from './TicketAttachmentsList';

interface Props {
  comment: Comment;
  currentUserEmail: string;
  currentUserName: string;
}

/**
 * Caso "el comentario no trae archivos", que es el común. Vive afuera del
 * componente a propósito: un `[]` literal sería un array nuevo en cada render.
 */
const NO_ATTACHMENTS: string[] = [];

function initialsFromName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return '';
  // Si parece email, tomar la parte antes del @ y separar por puntos
  const source = trimmed.includes('@') ? trimmed.split('@')[0] : trimmed;
  const parts = source.split(/[\s._-]+/).filter(Boolean);
  const letters = parts
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');
  return letters || trimmed[0]?.toUpperCase() || '';
}

export function TicketCommentItem({ comment, currentUserEmail, currentUserName }: Props) {
  const isMine = comment.author_email === currentUserEmail;
  const displayName = isMine ? currentUserName : 'Soporte';
  const isOptimistic = comment.id < 0;
  const myInitials = initialsFromName(currentUserName);
  // El backend manda `null` cuando el comentario no tiene archivos (slice nil
  // de Go), así que no alcanza con mirar el largo del array.
  const attachments = comment.attachments ?? NO_ATTACHMENTS;
  // Un comentario puede llegar sin texto y sólo con archivos (pasa con los que
  // el backend copia al hilo desde una solicitud de reapertura). Sin esta
  // guarda quedaría un <p> vacío ocupando una línea adentro de la burbuja.
  const hasBody = comment.body.trim().length > 0;

  return (
    <div className={`flex gap-2 ${isMine ? 'flex-row-reverse' : ''}`}>
      <Avatar className="h-8 w-8 shrink-0">
        <AvatarFallback
          className={
            isMine
              ? 'text-xs'
              : 'bg-primary/10 text-primary'
          }
        >
          {isMine ? myInitials : <Wrench className="h-4 w-4" aria-label="Soporte" />}
        </AvatarFallback>
      </Avatar>
      <div
        className={`max-w-[80%] space-y-1 ${isMine ? 'items-end' : 'items-start'} flex flex-col`}
      >
        <div
          className={`rounded-2xl px-3 py-2 text-sm ${
            isMine ? 'bg-primary/10 text-foreground' : 'bg-muted text-foreground'
          } ${isOptimistic ? 'opacity-60' : ''}`}
        >
          {hasBody ? <p className="whitespace-pre-wrap text-pretty">{comment.body}</p> : null}
          {/* Los adjuntos van ADENTRO de la burbuja, debajo del texto: son
              parte de ESE mensaje, no del ticket. Colgados afuera se leerían
              como un bloque hermano, que es justo la confusión por la que una
              captura enviada en el hilo parecía haberse perdido.

              Todo el bloque —incluida su separación— es condicional: un
              comentario sin archivos no deja margen ni título colgando. */}
          {attachments.length > 0 ? (
            <div className={hasBody ? 'mt-2' : ''}>
              <TicketAttachmentsList urls={attachments} />
            </div>
          ) : null}
        </div>
        <div
          className={`flex items-center gap-2 text-[11px] text-muted-foreground ${isMine ? 'justify-end' : ''}`}
        >
          <span>{displayName}</span>
          <span aria-hidden>·</span>
          <time dateTime={comment.created_at}>
            {moment(comment.created_at).locale('es').fromNow()}
          </time>
        </div>
      </div>
    </div>
  );
}
