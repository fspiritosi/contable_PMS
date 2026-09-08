'use client';

import { Button } from '@/shared/components/ui/button';
import { Loader2 } from 'lucide-react';
import { useEffect, useId, useRef } from 'react';
import type { KeyboardEvent, PointerEvent, SyntheticEvent } from 'react';

/**
 * Diálogo de confirmación propio del módulo. No sale de
 * `@/shared/components/ui/alert-dialog`.
 *
 * POR QUÉ NO USAMOS EL DEL HOST — es la misma decisión que la de `Tabs.tsx`, y
 * por la misma razón.
 *
 * El módulo se instala con `npx github:codecontrolsas/taskapp-cli` en apps
 * cuyo stack no controlamos, y los dos proyectos que ya lo tienen difieren
 * justo acá: uno arma su `alert-dialog` sobre Radix y el otro sobre Base UI.
 * No es un tema de nombres, es de API: Radix compone con `asChild` y Base UI
 * con `render`, así que `<AlertDialogTrigger asChild>` compila en uno y tira
 * `TS2322: Property 'asChild' does not exist` en el otro. Ya pasó, y se había
 * "resuelto" parcheando a mano el archivo instalado — que es justo lo que hace
 * que el próximo `init` deje un `.new` en vez de actualizar.
 *
 * Lo que la pantalla necesita es un cartel con dos botones. Eso no justifica
 * depender de una primitiva que no podemos garantizar. Del host seguimos
 * usando lo que sí coincide entre los dos: `Button` (que no es ni Radix ni
 * Base UI), los tokens de Tailwind y los íconos.
 *
 * POR QUÉ UN `<dialog>` NATIVO Y NO UN DIV CON TRAMPA DE FOCO A MANO:
 *
 * - `showModal()` da trampa de foco real (Tab y Shift+Tab ciclan adentro),
 *   `Escape`, y el resto del documento inerte — todo del navegador, sin
 *   reimplementar la parte que más se rompe.
 * - Pinta en el *top layer*, así que no compite por `z-index` ni lo recorta el
 *   `overflow` del sheet donde vive el banner. Un overlay `position: fixed`
 *   propio dependería de que ningún ancestro del host cree un containing block
 *   (`transform`, `filter`, `contain`), y eso no lo controlamos.
 *
 * Y por qué NO se portalea a `document.body`: el banner vive adentro del sheet
 * de detalle, que tiene su propia trampa de foco. Un portal al body dejaría el
 * diálogo fuera del scope del sheet y el sheet le robaría el foco de vuelta.
 * Renderizado en línea, el foco nunca sale de su subárbol y los dos conviven.
 */

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel?: string;
  /** Pinta la acción de confirmar como destructiva. */
  destructive?: boolean;
  /** Mientras la acción corre: bloquea el cierre y deshabilita los botones. */
  busy?: boolean;
  onConfirm: () => void;
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel = 'Cancelar',
  destructive = false,
  busy = false,
  onConfirm,
}: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  // Sincroniza el prop `open` con el estado nativo del <dialog>. Acá no hay
  // ningún `setState`: sólo llamadas al DOM.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!open || dialog === null) return;

    // Quién tenía el foco antes de abrir. `close()` lo devuelve solo, pero si
    // el diálogo se desmonta abierto (se cierra el sheet, se navega) esa
    // restauración nativa no ocurre y el foco se cae al <body>.
    const opener =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    dialog.showModal();

    // Foco inicial en el primer control, que por orden de DOM es siempre
    // "Cancelar": en una confirmación el foco no puede nacer sobre la acción
    // que confirma.
    dialog.querySelector<HTMLElement>('button:not([disabled])')?.focus();

    return () => {
      if (dialog.open) dialog.close();
      if (opener !== null && opener.isConnected && document.activeElement === document.body) {
        opener.focus();
      }
    };
  }, [open]);

  // Bloqueo del scroll del fondo, en su propio efecto porque tiene su propio
  // ciclo de vida: hay que devolver el body EXACTAMENTE como estaba, incluso
  // si el diálogo se desmonta abierto.
  useEffect(() => {
    if (!open) return;

    const { body } = document;
    const previousOverflow = body.style.overflow;
    const previousPaddingRight = body.style.paddingRight;

    // Compensar el ancho de la barra ANTES de ocultarla, o el fondo salta unos
    // píxeles a la derecha al abrir. Si el hueco es 0 no se toca nada: pasa con
    // las barras superpuestas de macOS y también cuando el sheet del host ya
    // bloqueó el scroll y compensó él.
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

  function requestClose() {
    // Mientras la mutación corre no se cierra: cerrar dejaría la acción en el
    // aire, sin nadie que muestre el resultado.
    if (busy) return;
    onOpenChange(false);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDialogElement>) {
    // El sheet del host escucha Escape en `document`. Si el evento llega hasta
    // allá, una sola tecla cierra el diálogo Y el panel de atrás.
    if (event.key === 'Escape') event.stopPropagation();
  }

  function handleCancel(event: SyntheticEvent<HTMLDialogElement>) {
    // `cancel` es lo que dispara Escape en un <dialog> modal. Se corta el
    // cierre nativo para que TODO cierre pase por `onOpenChange` y el estado
    // del padre nunca quede desincronizado del DOM.
    event.preventDefault();
    requestClose();
  }

  function handlePointerDown(event: PointerEvent<HTMLDialogElement>) {
    // El backdrop de un <dialog> modal es el propio elemento: un click afuera
    // del panel llega con `target === currentTarget`. Por eso el <dialog> va
    // con padding 0 y todo el contenido adentro de un hijo — si tuviera
    // padding, clickear ese borde también cerraría.
    //
    // `pointerdown` y no `click`: arrastrar una selección desde adentro y
    // soltar sobre el backdrop no tiene que cerrar nada.
    if (event.target === event.currentTarget) requestClose();
  }

  return (
    <dialog
      ref={dialogRef}
      role="alertdialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onKeyDown={handleKeyDown}
      onCancel={handleCancel}
      onPointerDown={handlePointerDown}
      className="m-auto w-[calc(100%-2rem)] max-w-md rounded-lg border bg-background p-0 text-foreground shadow-lg [&::backdrop]:bg-black/50 open:animate-in open:fade-in-0 open:zoom-in-95 open:duration-150 motion-reduce:open:animate-none"
    >
      {/* `overscroll-contain` para que llegar al tope del contenido no siga
          scrolleando el fondo en mobile, y alto máximo en vez de fijo para que
          el diálogo siga usable con el zoom al 200%. */}
      <div className="max-h-[calc(100dvh-4rem)] overflow-y-auto overscroll-contain p-6">
        <h2 id={titleId} className="text-base font-semibold text-balance">
          {title}
        </h2>
        <p id={descriptionId} className="mt-2 text-sm text-pretty text-muted-foreground">
          {description}
        </p>
        {/* "Cancelar" va primero en el DOM (es el foco inicial) y queda abajo
            en la columna invertida de mobile, igual que los alert dialogs del
            host. */}
        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" onClick={requestClose} disabled={busy}>
            {cancelLabel}
          </Button>
          <Button
            type="button"
            variant={destructive ? 'destructive' : 'default'}
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {confirmLabel}
          </Button>
        </div>
      </div>
    </dialog>
  );
}
