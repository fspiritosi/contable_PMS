'use client';

import { createContext, useContext, useId, useMemo } from 'react';
import type { ComponentProps, KeyboardEvent } from 'react';

/**
 * Pestañas propias del módulo. No salen de `@/shared/components/ui/tabs`.
 *
 * POR QUÉ NO USAMOS LAS DEL HOST — es la decisión importante de este archivo.
 *
 * El módulo se instala con `npx github:codecontrolsas/taskapp-cli` en apps
 * cuyo stack no controlamos, y ya tenemos dos que difieren justo en esta
 * pieza: una arma sus tabs sobre Radix (`Tabs / TabsList / TabsTrigger /
 * TabsContent`) y la otra sobre Base UI (`Tabs / TabsList / TabsTab /
 * TabsPanel`). No es un tema de nombres: son dos APIs distintas, con props
 * distintas, así que cualquier import de `ui/tabs` compila en una y rompe la
 * compilación en la otra.
 *
 * Lo que la pantalla necesita son tres botones y un panel. Eso no justifica
 * depender de una primitiva que no podemos garantizar, así que se implementa
 * acá siguiendo el patrón Tabs de WAI-ARIA (APG). Del host seguimos usando lo
 * que sí coincide entre los dos (Button, Card, los tokens de Tailwind).
 *
 * Dos detalles del contrato, a propósito:
 *
 * - Cada disparador expone `data-state="active" | "inactive"`, igual que
 *   shadcn/Radix, para que las clases `data-[state=active]:*` y
 *   `group-data-[state=active]:*` de quien lo use sigan valiendo tal cual.
 * - La activación es MANUAL y no es configurable: las flechas mueven el foco
 *   pero no cambian de pestaña. Recorrer el riel con el teclado no debe montar
 *   una lista de tickets por cada paso.
 *
 * Sin clases propias: el estilado entero lo pone quien lo usa. Así el módulo
 * tampoco depende del `cn()` del host, que también vive en rutas distintas
 * según el proyecto.
 */

interface TabsContextValue {
  /** Pestaña seleccionada. */
  value: string;
  select: (value: string) => void;
  /**
   * Prefijo único de esta instancia. Los ids de tab y panel se derivan de acá
   * para que dos rieles en la misma página no colisionen.
   */
  baseId: string;
}

const TabsContext = createContext<TabsContextValue | null>(null);

function useTabsContext(component: string): TabsContextValue {
  const context = useContext(TabsContext);
  if (context === null) {
    throw new Error(`<${component}> tiene que estar dentro de <Tabs>.`);
  }
  return context;
}

const tabDomId = (baseId: string, value: string) => `${baseId}-tab-${value}`;
const panelDomId = (baseId: string, value: string) => `${baseId}-panel-${value}`;

// ── Raíz ────────────────────────────────────────────────────────────────────

interface TabsProps<T extends string>
  extends Omit<ComponentProps<'div'>, 'onChange' | 'defaultValue'> {
  value: T;
  onValueChange: (value: T) => void;
}

/**
 * Contenedor. Es un `div` pelado sin rol ARIA (el riel y el panel se enlazan
 * por id, no por anidación), así que quien lo usa puede meter encabezados u
 * otra cosa entre la lista de pestañas y el panel.
 *
 * Genérico en `T` para que el `onValueChange` llegue tipado con la unión real
 * de la pantalla y no haya que castear `string` del otro lado.
 */
export function Tabs<T extends string>({ value, onValueChange, ...props }: TabsProps<T>) {
  const baseId = useId();

  const context = useMemo<TabsContextValue>(
    () => ({ value, select: onValueChange as (next: string) => void, baseId }),
    [value, onValueChange, baseId]
  );

  return (
    <TabsContext.Provider value={context}>
      <div {...props} />
    </TabsContext.Provider>
  );
}

// ── Riel ────────────────────────────────────────────────────────────────────

interface TabsListProps extends Omit<ComponentProps<'div'>, 'role' | 'onKeyDown'> {
  /**
   * Nombre accesible del riel. Sin esto el lector de pantalla anuncia "lista de
   * pestañas" y nada más: no dice qué se está filtrando.
   */
  label: string;
}

export function TabsList({ label, ...props }: TabsListProps) {
  /**
   * Un solo handler delegado en el riel en vez de uno por botón: el orden de
   * navegación es el orden del DOM, así que se lee de ahí y no hay que
   * sostener un índice en estado que pueda desincronizarse.
   */
  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const { key } = event;
    if (key !== 'ArrowRight' && key !== 'ArrowLeft' && key !== 'Home' && key !== 'End') {
      return;
    }

    const tabs = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]:not([disabled])')
    );
    const current = tabs.indexOf(document.activeElement as HTMLButtonElement);
    if (current === -1) return;

    // Se corta el default para que las flechas no scrolleen la página y para
    // que Home/End no salten al principio o al final del documento.
    event.preventDefault();

    const last = tabs.length - 1;
    const next =
      key === 'Home'
        ? 0
        : key === 'End'
          ? last
          : key === 'ArrowRight'
            ? current === last
              ? 0
              : current + 1
            : current === 0
              ? last
              : current - 1;

    // Sólo mueve el foco. La selección cambia con Enter, Espacio o click.
    tabs[next].focus();
  }

  return (
    <div
      {...props}
      role="tablist"
      aria-label={label}
      aria-orientation="horizontal"
      onKeyDown={handleKeyDown}
    />
  );
}

// ── Disparador ──────────────────────────────────────────────────────────────

interface TabsTriggerProps
  extends Omit<ComponentProps<'button'>, 'value' | 'type' | 'role' | 'onClick'> {
  /**
   * Identificador de la pestaña. Va sin espacios: forma parte del id del panel
   * y de `aria-controls`, que es una lista separada por espacios.
   */
  value: string;
}

export function TabsTrigger({ value, ...props }: TabsTriggerProps) {
  const { value: selected, select, baseId } = useTabsContext('TabsTrigger');
  const isActive = selected === value;

  return (
    <button
      {...props}
      type="button"
      role="tab"
      id={tabDomId(baseId, value)}
      aria-selected={isActive}
      aria-controls={panelDomId(baseId, value)}
      // Roving tabindex: el riel entero es UNA sola parada de tabulación. Tab
      // entra por la pestaña seleccionada y de ahí las flechas se mueven
      // adentro, en vez de obligar a pasar por las tres para salir.
      tabIndex={isActive ? 0 : -1}
      data-state={isActive ? 'active' : 'inactive'}
      onClick={() => select(value)}
    />
  );
}

// ── Panel ───────────────────────────────────────────────────────────────────

interface TabsPanelProps extends Omit<ComponentProps<'div'>, 'value' | 'role'> {
  value: string;
}

export function TabsPanel({ value, ...props }: TabsPanelProps) {
  const { value: selected, baseId } = useTabsContext('TabsPanel');

  // La pestaña inactiva no se renderiza: no se esconde con CSS. Cada panel
  // monta su propia lista de tickets y tener las tres vivas es pagar tres
  // veces el render (y tres suscripciones de query) por una que se ve.
  if (selected !== value) return null;

  return (
    <div
      {...props}
      role="tabpanel"
      id={panelDomId(baseId, value)}
      aria-labelledby={tabDomId(baseId, value)}
      // El panel entra en la tabulación después del riel: así Tab desde la
      // pestaña cae en la lista y no en el próximo control de la página.
      tabIndex={0}
    />
  );
}
