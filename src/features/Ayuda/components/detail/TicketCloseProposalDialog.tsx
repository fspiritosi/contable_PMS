'use client';

import { Button } from '@/shared/components/ui/button';
import { Textarea } from '@/shared/components/ui/textarea';
import type { CloseProposalTarget } from '@/shared/lib/taskapp/types';
import { Loader2 } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import type { FormEvent, PointerEvent, SyntheticEvent } from 'react';
import { toast } from 'sonner';
import { CLOSE_REASON_MAX, CLOSE_REASON_MIN, closeReasonError } from '../../constants/ticket-copy';
import { useProposeTicketClose } from '../../hooks/useProposeTicketClose';

/**
 * Las dos formas de proponer el cierre. Título corto para distinguirlas de un
 * vistazo y una línea que dice la consecuencia, porque "cancelar" y "resolver"
 * terminan en pestañas iguales pero no significan lo mismo para el equipo.
 */
const OPTIONS: { value: CloseProposalTarget; title: string; hint: string }[] = [
  {
    value: 'resolved',
    title: 'Ya está resuelto',
    hint: 'Se solucionó o dejó de pasar. Si el equipo está de acuerdo, se cierra como resuelto.',
  },
  {
    value: 'cancelled',
    title: 'Ya no lo necesito',
    hint: 'Preferís que no se siga trabajando. Si el equipo está de acuerdo, se cancela.',
  },
];

interface Props {
  ticketId: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Después del envío exitoso, con el diálogo ya cerrado. */
  onProposed?: () => void;
  /**
   * El ticket dejó de admitir la propuesta con el diálogo abierto (llegó un
   * cambio por SSE: el equipo lo resolvió, otra persona propuso). Se avisa
   * acá en vez de desmontar el diálogo y tirar lo que la persona escribió.
   */
  stale?: boolean;
}

/**
 * Diálogo de "Proponer cierre".
 *
 * Es un `<dialog>` nativo por las mismas razones que `ConfirmDialog` (leer el
 * comentario de ese archivo): el `Dialog` y el `RadioGroup` del host son Radix
 * en un proyecto y Base UI en otro, con APIs incompatibles. Por eso también
 * los radios son `<input type="radio">` nativos: flechas, Tab y el anuncio
 * "1 de 2" los da el navegador, y no dependen de ninguna primitiva del host.
 *
 * No reusa `ConfirmDialog` porque ese recibe título y descripción como texto:
 * acá hay un formulario adentro.
 */
export function TicketCloseProposalDialog({
  ticketId,
  open,
  onOpenChange,
  onProposed,
  stale = false,
}: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const id = useId();
  const titleId = `${id}-title`;
  const descriptionId = `${id}-description`;
  const targetErrorId = `${id}-target-error`;
  const reasonId = `${id}-reason`;
  const reasonHintId = `${id}-reason-hint`;
  const reasonErrorId = `${id}-reason-error`;

  const [target, setTarget] = useState<CloseProposalTarget | null>(null);
  const [reason, setReason] = useState('');
  // Los errores de campo aparecen recién después del primer intento de envío:
  // marcar en rojo mientras la persona todavía está escribiendo es retarla por
  // algo que no terminó de hacer.
  const [attempted, setAttempted] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  // Estado propio y no `isPending` de la mutación: entre que la mutación
  // termina y el diálogo se cierra hay un render en que isPending ya es false
  // y el ticket ya figura con la propuesta pendiente, y en ese frame aparecía
  // el aviso de "el ticket cambió".
  const [sending, setSending] = useState(false);
  const propose = useProposeTicketClose(ticketId);

  const targetError = attempted && target === null ? 'Elegí una de las dos opciones.' : null;
  const reasonValidation = target ? closeReasonError(target, reason) : null;
  const overMax = reason.trim().length > CLOSE_REASON_MAX;
  // Pasarse del máximo se avisa en el momento (el contador ya está en rojo);
  // quedarse corto, recién al enviar.
  const reasonError = attempted || overMax ? reasonValidation : null;
  const reasonRequired = target === 'cancelled';

  // Apertura, foco inicial y restauración: mismo mecanismo que ConfirmDialog.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!open || dialog === null) return;

    const opener =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    dialog.showModal();
    // Foco en la primera opción y no en "Volver": acá lo primero que hay que
    // hacer es elegir, y con Tab desde el título se llegaría igual.
    dialog.querySelector<HTMLElement>('input[type="radio"]:not([disabled])')?.focus();

    // El sheet de Radix escucha Escape en `document` en fase de CAPTURA, antes
    // de que el evento llegue al diálogo, así que un `stopPropagation` en el
    // onKeyDown de React llega tarde y una sola tecla cerraba también el panel
    // de atrás. Se corta en `window`, que captura antes que `document`. No se
    // llama a preventDefault: el cierre nativo (evento `cancel`) tiene que
    // seguir ocurriendo, y lo maneja handleCancel.
    const stopEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') event.stopPropagation();
    };
    window.addEventListener('keydown', stopEscape, { capture: true });

    return () => {
      window.removeEventListener('keydown', stopEscape, { capture: true });
      if (dialog.open) dialog.close();
      if (opener !== null && opener.isConnected && document.activeElement === document.body) {
        opener.focus();
      }
    };
  }, [open]);

  // Bloqueo del scroll del fondo, devolviendo el body exactamente como estaba.
  useEffect(() => {
    if (!open) return;

    const { body } = document;
    const previousOverflow = body.style.overflow;
    const previousPaddingRight = body.style.paddingRight;
    const gap = window.innerWidth - document.documentElement.clientWidth;
    if (gap > 0) {
      const current = Number.parseFloat(window.getComputedStyle(body).paddingRight) || 0;
      body.style.paddingRight = `${current + gap}px`;
    }
    body.style.overflow = 'hidden';

    return () => {
      body.style.overflow = previousOverflow;
      body.style.paddingRight = previousPaddingRight;
    };
  }, [open]);

  function reset() {
    setTarget(null);
    setReason('');
    setAttempted(false);
    setServerError(null);
    setSending(false);
  }

  function requestClose() {
    // Mientras se envía no se cierra: el resultado quedaría sin nadie que lo
    // muestre y la persona no sabría si la propuesta llegó.
    if (sending) return;
    reset();
    onOpenChange(false);
  }

  function handleCancel(event: SyntheticEvent<HTMLDialogElement>) {
    // Todo cierre pasa por onOpenChange para que el estado del padre no quede
    // desincronizado del DOM.
    event.preventDefault();
    requestClose();
  }

  function handlePointerDown(event: PointerEvent<HTMLDialogElement>) {
    // Click en el backdrop (ver ConfirmDialog). Con texto escrito NO se cierra:
    // un click de más afuera del panel no puede borrar un motivo de 500
    // caracteres. Para salir con texto está "Volver" o Escape, que son
    // intencionales.
    if (event.target !== event.currentTarget) return;
    if (reason.trim().length > 0) return;
    requestClose();
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sending || stale) return;

    setAttempted(true);
    setServerError(null);

    // Foco al primer campo con error: el mensaje está enlazado por
    // aria-describedby, así que el lector lo lee al llegar.
    if (target === null) {
      dialogRef.current?.querySelector<HTMLElement>('input[type="radio"]')?.focus();
      return;
    }
    if (closeReasonError(target, reason)) {
      textareaRef.current?.focus();
      return;
    }

    setSending(true);
    try {
      // mutateAsync y no mutate con callbacks: los callbacks de `mutate` no
      // corren si el componente se desmontó, y el refetch que dispara el SSE
      // del propio backend puede desmontar la tarjeta en el medio.
      await propose.mutateAsync({ target, reason });
      // Mismo sustantivo que el botón y el aviso: "propuesta". No dice
      // "cerrado" porque no lo está.
      toast.success('Enviamos tu propuesta de cierre. Te avisamos cuando el equipo responda.');
      reset();
      onOpenChange(false);
      onProposed?.();
    } catch (error) {
      // El diálogo queda abierto y el texto intacto: reintentar no puede
      // obligar a escribir todo de nuevo.
      setSending(false);
      setServerError(
        error instanceof Error ? error.message : 'No se pudo enviar la propuesta. Probá de nuevo.'
      );
    }
  }

  const reasonHint = reasonRequired
    ? `Contale al equipo por qué ya no hace falta. Entre ${CLOSE_REASON_MIN} y ${CLOSE_REASON_MAX} caracteres.`
    : target === 'resolved'
      ? 'Por ejemplo, qué cambió o cómo lo comprobaste.'
      : 'Elegí una opción y, si querés, sumá un comentario.';

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onCancel={handleCancel}
      onPointerDown={handlePointerDown}
      className="m-auto w-[calc(100%-2rem)] max-w-lg rounded-lg border bg-background p-0 text-foreground shadow-lg [&::backdrop]:bg-black/50 open:animate-in open:fade-in-0 open:zoom-in-95 open:duration-150 motion-reduce:open:animate-none"
    >
      <form
        noValidate
        onSubmit={handleSubmit}
        aria-busy={sending}
        className="flex max-h-[calc(100dvh-4rem)] flex-col gap-5 overflow-y-auto overscroll-contain p-6"
      >
        <div>
          <h2 id={titleId} className="text-base font-semibold text-balance">
            Proponer el cierre del TKT-{ticketId}
          </h2>
          <p id={descriptionId} className="mt-2 text-sm text-pretty text-muted-foreground">
            El equipo revisa tu propuesta antes de cerrarlo. Hasta que responda, el ticket sigue en
            curso y no cambia de estado.
          </p>
        </div>

        <fieldset className="flex min-w-0 flex-col gap-2" disabled={sending}>
          <legend className="mb-2 text-sm font-medium">¿Por qué querés cerrarlo?</legend>
          {OPTIONS.map((option) => {
            const hintId = `${id}-${option.value}-hint`;
            return (
              // El label envuelve todo: la tarjeta entera es el área de click,
              // sin zona muerta entre el radio y el texto. El estado elegido
              // se ve por el punto del radio y el borde, no sólo por el fondo.
              <label
                key={option.value}
                className="flex cursor-pointer items-start gap-3 rounded-md border p-3 transition-colors duration-150 hover:bg-muted/40 has-[:checked]:border-primary has-[:checked]:bg-primary/5 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60 motion-reduce:transition-none"
              >
                <input
                  type="radio"
                  name={`${id}-target`}
                  value={option.value}
                  checked={target === option.value}
                  onChange={() => setTarget(option.value)}
                  // Sin aria-invalid: el rol radio no lo admite. El error llega
                  // igual, enlazado por aria-describedby.
                  aria-describedby={targetError ? `${hintId} ${targetErrorId}` : hintId}
                  className="mt-0.5 size-4 shrink-0 accent-primary outline-none"
                />
                <span className="min-w-0">
                  <span className="block text-sm font-medium">{option.title}</span>
                  <span
                    id={hintId}
                    className="mt-0.5 block text-pretty text-xs leading-relaxed text-muted-foreground"
                  >
                    {option.hint}
                  </span>
                </span>
              </label>
            );
          })}
          {targetError && (
            <p id={targetErrorId} className="text-xs text-destructive">
              {targetError}
            </p>
          )}
        </fieldset>

        <div className="flex flex-col gap-1.5">
          {/* "(obligatorio)" escrito y no un asterisco rojo: el requisito
              cambia según la opción y tiene que leerse, no adivinarse. */}
          <label htmlFor={reasonId} className="text-sm font-medium">
            {reasonRequired ? 'Motivo' : 'Comentario para el equipo'}{' '}
            <span className="font-normal text-muted-foreground">
              {reasonRequired ? '(obligatorio)' : '(opcional)'}
            </span>
          </label>
          <Textarea
            ref={textareaRef}
            id={reasonId}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            disabled={sending}
            aria-required={reasonRequired}
            aria-invalid={reasonError ? true : undefined}
            aria-describedby={reasonError ? `${reasonHintId} ${reasonErrorId}` : reasonHintId}
            placeholder={
              reasonRequired
                ? 'Ej: lo resolvimos por otro lado y ya no usamos esa pantalla.'
                : 'Ej: desde la actualización del martes el reporte sale bien.'
            }
            className="min-h-24 max-h-60 resize-y break-words"
          />
          <div className="flex items-start justify-between gap-3 text-xs">
            <p id={reasonHintId} className="text-pretty text-muted-foreground">
              {reasonHint}
            </p>
            <span
              aria-hidden
              className={`shrink-0 tabular-nums ${overMax ? 'text-destructive' : 'text-muted-foreground'}`}
            >
              {reason.length}/{CLOSE_REASON_MAX}
            </span>
          </div>
          {reasonError && (
            <p id={reasonErrorId} className="text-xs text-destructive">
              {reasonError}
            </p>
          )}
        </div>

        {stale && !sending && (
          <p role="status" className="rounded-md bg-muted p-3 text-sm text-pretty">
            El ticket cambió mientras escribías y ya no admite una propuesta de cierre. Volvé para
            ver cómo quedó.
          </p>
        )}

        {/* El error del envío va acá, junto a los botones, y no sólo en un
            toast: el toast se va solo y la persona queda sin saber si llegó. */}
        {serverError && (
          <p role="alert" className="text-sm text-pretty text-destructive">
            {serverError}
          </p>
        )}

        {/* "Volver" y no "Cancelar": una de las opciones es cancelar el
            ticket, y un botón "Cancelar" al lado se lee como esa opción. Va
            primero en el DOM y queda abajo en la columna invertida de mobile,
            igual que en ConfirmDialog. */}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" onClick={requestClose} disabled={sending}>
            Volver
          </Button>
          <Button type="submit" disabled={sending || stale}>
            {sending ? <Loader2 aria-hidden className="mr-2 h-4 w-4 animate-spin" /> : null}
            Enviar propuesta
          </Button>
        </div>
      </form>
    </dialog>
  );
}
