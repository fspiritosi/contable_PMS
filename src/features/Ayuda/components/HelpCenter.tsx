'use client';

import { Button } from '@/shared/components/ui/button';
import { Card } from '@/shared/components/ui/card';
import { HelpCircle, Loader2, Plus, RefreshCcw } from 'lucide-react';
import dynamic from 'next/dynamic';
import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Ticket, TicketWithUnread } from '@/shared/lib/taskapp/types';
import { BUCKET_LABEL, bucketFor, type TicketBucket } from '../constants/ticket-copy';
import { useMyTicketsWithUnread } from '../hooks/useMyTicketsWithUnread';
import { ApproverAllTickets } from './ApproverAllTickets';
import { ApproverInbox } from './ApproverInbox';
import { MyTicketsList } from './MyTicketsList';
import { Tabs, TabsList, TabsPanel, TabsTrigger } from './Tabs';


const TicketDetailSheet = dynamic(() => import('./detail/TicketDetailSheet'), { ssr: false });

// El formulario arrastra react-hook-form + zod + el resolver. Es la acción
// secundaria de la pantalla (la primaria es leer el estado de los tickets), así
// que sale del chunk inicial y se carga en paralelo con el shell.
const TicketForm = dynamic(() => import('./TicketForm').then((m) => m.TicketForm), {
  // ssr:false y no solo el import diferido. Renderizarlo en el servidor y
  // cargarlo diferido en el cliente hace que react-hook-form genere los useId
  // de sus campos en otro orden al hidratar: los htmlFor/id del HTML servido no
  // coinciden con los del cliente y React descarta ese subarbol. El formulario
  // es interaccion pura detras de login, no aporta nada al HTML inicial.
  ssr: false,
  // Sin radio propio: el esqueleto ya vive adentro de la Card, que recorta.
  loading: () => <div className="min-h-[520px] animate-pulse bg-muted/40" aria-hidden />,
});

const BUCKETS: TicketBucket[] = ['review', 'active', 'closed'];

/**
 * Las pestañas son un riel subrayado, no el segmented pill que traen las
 * primitivas por defecto.
 *
 * Dos razones. Una, el pill es una superficie más (`bg-muted` redondeado) y acá
 * ya hay dos superficies en juego: sumarle una tercera flotando arriba de la
 * lista es lo que hacía que la columna se leyera como piezas sueltas. Dos, el
 * riel subrayado se apoya sobre el borde del encabezado del panel y le da a la
 * columna una línea estructural que antes no tenía.
 *
 * El activo se marca con peso + color de texto + subrayado `foreground`, NO con
 * el color de acento: el acento queda reservado para la única acción primaria
 * de la pantalla, que es enviar el reporte. Esa doble señal (peso + subrayado)
 * es además lo que hace que el estado no dependa sólo del color.
 *
 * `./Tabs` no aporta una sola clase, así que acá está el estilo completo del
 * botón y no nada más los overrides. Dos cosas que antes llegaban gratis desde
 * la base de shadcn y ahora hay que poner explícitas: el foco visible y el
 * `whitespace-nowrap` que evita que «Para revisar» se parta en dos líneas y
 * desalinee el riel.
 */
const TAB_TRIGGER_CLASS =
  'group -mb-px inline-flex items-center gap-2 whitespace-nowrap rounded-t-sm border-0 border-b-2 border-transparent bg-transparent px-2.5 py-0 pb-2.5 text-sm font-normal text-muted-foreground outline-none transition-colors duration-150 touch-manipulation hover:text-foreground focus-visible:outline-1 focus-visible:outline-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 motion-reduce:transition-none data-[state=active]:border-foreground data-[state=active]:font-medium data-[state=active]:text-foreground';

interface Props {
  initialTickets: TicketWithUnread[];
  initialTicket: Ticket | null;
  initialTicketId: number | null;
  currentUserEmail: string;
  currentUserName: string;
}

export function HelpCenter({
  initialTickets,
  initialTicket,
  initialTicketId,
  currentUserEmail,
  currentUserName,
}: Props) {
  const searchParams = useSearchParams();

  // Una sola lectura de los tickets del usuario para toda la pantalla.
  // Antes convivían dos: el SSR traía la lista completa (para el contador de
  // no leídos) y el cliente volvía a pedir la página 1 apenas hidrataba. Con
  // tres pestañas hacen falta los totales de cada una igual, así que la lista
  // completa alcanza y sobra — y es una llamada menos por carga.
  const {
    data: tickets = [],
    isLoading,
    isFetching,
    isError,
    refetch,
  } = useMyTicketsWithUnread(initialTickets);

  // null = el usuario todavia no eligio pestaña; manda la derivada de los datos.
  const [pickedTab, setPickedTab] = useState<TicketBucket | null>(null);

  // Una sola pasada por la lista para las tres pestañas. Con un filter por
  // pestaña se recorría tres veces por render.
  const byBucket = useMemo(() => {
    const groups: Record<TicketBucket, TicketWithUnread[]> = {
      review: [],
      active: [],
      closed: [],
    };
    for (const ticket of tickets) groups[bucketFor(ticket)].push(ticket);
    return groups;
  }, [tickets]);

  // Si no hay nada para revisar, abrir en esa pestaña es mostrar un vacío: la
  // primera con contenido dice más. Se calcula en el render en vez de
  // corregirlo con un efecto — el efecto pintaba la pestaña equivocada un
  // frame antes de arreglarla, y ademas es set-state-in-effect.
  const tab: TicketBucket =
    pickedTab ??
    (byBucket.review.length > 0 || tickets.length === 0
      ? 'review'
      : byBucket.active.length > 0
        ? 'active'
        : 'closed');
  const setTab = setPickedTab;

  // ── Sheet de detalle (conversación completa) ──────────────────────────────
  const getInitialId = (): number | null => {
    const param = searchParams.get('ticket');
    if (!param) return initialTicketId;
    const n = Number(param);
    return Number.isFinite(n) ? n : null;
  };

  const [activeTicketId, setActiveTicketId] = useState<number | null>(getInitialId);

  // Sincronizar SOLO si la URL cambia por afuera (back/forward del browser).
  useEffect(() => {
    const param = searchParams.get('ticket');
    const n = param ? Number(param) : null;
    const fromUrl = n != null && Number.isFinite(n) ? n : null;
    if (fromUrl !== activeTicketId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setActiveTicketId(fromUrl);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const handleSelect = useCallback((id: number) => {
    setActiveTicketId(id);
    const params = new URLSearchParams(window.location.search);
    params.set('ticket', String(id));
    window.history.replaceState(null, '', `${window.location.pathname}?${params.toString()}`);
  }, []);

  const handleClose = useCallback(() => {
    setActiveTicketId(null);
    const params = new URLSearchParams(window.location.search);
    params.delete('ticket');
    const qs = params.toString();
    window.history.replaceState(
      null,
      '',
      qs ? `${window.location.pathname}?${qs}` : window.location.pathname
    );
  }, []);

  // El formulario es un panel fijo en escritorio; en teléfono ocuparía la
  // pantalla entera antes de dejar ver un solo ticket, así que arranca
  // plegado detrás de un botón que se ve sin scrollear.
  const [formOpen, setFormOpen] = useState(false);

  // Misma acción que el botón del encabezado: en teléfono despliega el
  // formulario (que arranca plegado) y en cualquier tamaño lleva la vista
  // hasta él. Sin scroll suave a propósito: es navegación, no decoración, y
  // el desplazamiento animado molesta a quien pidió menos movimiento.
  const handleReport = useCallback(() => {
    setFormOpen(true);
    // En teléfono el panel está `hidden` hasta que se aplica el estado: sin
    // esperar al pintado, el scroll apuntaría a un nodo sin caja.
    requestAnimationFrame(() => {
      document.getElementById('reportar-problema')?.scrollIntoView({ block: 'nearest' });
    });
  }, []);

  return (
    <section className="mx-auto flex max-w-[1200px] flex-col gap-6 pt-2">
      <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
        <div className="flex min-w-0 items-center gap-3">
          {/* El único elemento con color de acento junto al botón de enviar:
              es la identidad de la pantalla, no una acción que compita. */}
          <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary ring-1 ring-inset ring-primary/20">
            <HelpCircle aria-hidden className="size-[18px]" strokeWidth={2} />
          </span>
          <div className="min-w-0">
            <h1 className="text-pretty text-xl font-semibold leading-tight tracking-tight">
              Centro de Ayuda
            </h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Reportá un problema y seguí el estado de tus solicitudes.
            </p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {/* Con borde y no como ícono pelado: sin caja propia el botón queda
              flotando en el margen derecho y no se lee como control. */}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={isFetching}
            aria-label="Actualizar la lista de tickets"
            className="h-8 gap-1.5 px-2.5 text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            {isFetching ? (
              <Loader2 aria-hidden className="size-3.5 animate-spin" />
            ) : (
              <RefreshCcw aria-hidden className="size-3.5" />
            )}
            <span className="hidden sm:inline">Actualizar</span>
          </Button>
          <Button
            type="button"
            size="sm"
            className="h-8 gap-1.5 lg:hidden"
            onClick={() => setFormOpen((o) => !o)}
            aria-expanded={formOpen}
            aria-controls="reportar-problema"
          >
            <Plus aria-hidden className="size-4" />
            Reportar
          </Button>
        </div>
      </header>

      {/* Sin aviso de pendientes arriba de la lista, a propósito (#691). Decía
          lo mismo por tercera vez: el badge del sidebar ya trae al cliente
          hasta acá, la pantalla abre en "Para revisar" cuando hay pendientes y
          el contador de esa pestaña dice cuántos son. Su botón "Ver ahora"
          seleccionaba la pestaña que ya estaba abierta, así que no hacía nada
          visible y se reportó como roto. */}
      <ApproverInbox onSelect={handleSelect} />

      {/* El panel de reporte no escala con la pantalla: tiene un ancho propio
          y es la lista la que se estira. Con 30/70 el formulario quedaba
          enorme en monitores grandes y apretado en notebooks. */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_380px] lg:items-start">
        {/* La lista vive dentro de su propio panel, con el mismo tratamiento
            que el formulario de la derecha: borde + superficie + el mismo
            radio. Antes las pestañas y las tarjetas flotaban sueltas sobre el
            fondo de la página mientras la otra mitad sí tenía caja, y esa
            asimetría era lo que hacía ver la pantalla a medio terminar.

            La separación la hace el borde y no la sombra a propósito: el
            módulo se instala en apps de terceros y no podemos dar por hecho
            que `bg-card` contraste contra `bg-background` en todos los temas.
            El único valor crudo es el reflejo interior de 1px al 4% de blanco,
            que en oscuro es lo que hace que la caja se lea como una superficie
            y no como un rectángulo dibujado; en temas claros no se ve y no
            molesta. */}
        <Tabs
          value={tab}
          onValueChange={setTab}
          className="overflow-hidden rounded-xl border bg-card shadow-[0_1px_2px_0_#0000000d,inset_0_1px_0_0_#ffffff0a]"
        >
          <div className="flex flex-col gap-3 border-b px-4 pt-3.5">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <h2 className="text-sm font-semibold tracking-tight">Mis tickets</h2>
              <span className="text-xs tabular-nums text-muted-foreground">
                {tickets.length === 1 ? '1 en total' : `${tickets.length} en total`}
              </span>
            </div>
            {/* El riel es una sola parada de tabulación: se entra por la
                pestaña activa y adentro se recorre con las flechas. El nombre
                accesible tiene que decir qué se filtra, porque las etiquetas
                sueltas («Cerrados») no alcanzan fuera de contexto. */}
            <TabsList
              label="Filtrar mis tickets por estado"
              className="flex w-full justify-start gap-1"
            >
              {BUCKETS.map((b) => (
                <TabsTrigger key={b} value={b} className={TAB_TRIGGER_CLASS}>
                  {BUCKET_LABEL[b]}
                  <span className="rounded-full bg-muted px-1.5 py-px text-[11px] tabular-nums text-muted-foreground transition-colors duration-150 group-data-[state=active]:text-foreground motion-reduce:transition-none">
                    {byBucket[b].length}
                  </span>
                </TabsTrigger>
              ))}
            </TabsList>
          </div>

          {/* Sólo el panel activo se monta: los otros dos devuelven null.
              El foco se dibuja con offset negativo, es decir hacia adentro: el
              panel ocupa todo el ancho de la caja y un anillo por fuera lo
              recortaría el `overflow-hidden` del contenedor. */}
          {BUCKETS.map((b) => (
            <TabsPanel
              key={b}
              value={b}
              className="p-4 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
              aria-busy={isLoading}
            >
              <MyTicketsList
                tickets={byBucket[b]}
                bucket={b}
                totalTickets={tickets.length}
                onOpenDetail={handleSelect}
                onReport={handleReport}
                canAct
                isLoading={isLoading && tickets.length === 0}
                error={isError && tickets.length === 0}
                onRetry={() => refetch()}
              />
            </TabsPanel>
          ))}
        </Tabs>

        {/* `py-0` + `gap-0` para manejar el ritmo vertical desde adentro del
            formulario: con el padding por defecto de la Card el encabezado de
            la derecha arrancaba 10px más abajo que el de la izquierda y las
            dos columnas se veían desalineadas. */}
        <Card
          id="reportar-problema"
          className={`gap-0 overflow-hidden py-0 shadow-[0_1px_2px_0_#0000000d,inset_0_1px_0_0_#ffffff0a] ${
            formOpen ? '' : 'hidden'
          } lg:sticky lg:top-4 lg:block`}
        >
          <TicketForm />
        </Card>
      </div>

      <ApproverAllTickets onSelect={handleSelect} />

      <TicketDetailSheet
        ticketId={activeTicketId}
        initialTicket={initialTicket}
        currentUserEmail={currentUserEmail}
        currentUserName={currentUserName}
        onClose={handleClose}
      />
    </section>
  );
}
