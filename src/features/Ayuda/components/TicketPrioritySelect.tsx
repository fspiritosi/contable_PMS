'use client';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui/select';
import { PRIORITIES, PRIORITY_BY_SLUG, type PriorityDef, type PrioritySlug } from '../constants/ticket-priority';

interface Props {
  value: PrioritySlug;
  onChange: (value: PrioritySlug) => void;
  disabled?: boolean;
}

const PLACEHOLDER = 'Elegí una prioridad';

export function TicketPrioritySelect({ value, onChange, disabled }: Props) {
  /**
   * El label del trigger se resuelve ACÁ y se le pasa como children al
   * `SelectValue` en vez de dejar que lo derive la primitiva.
   *
   * Por qué: el módulo se instala en apps que no usan la misma librería de
   * primitivas. Radix portalea el contenido del `<SelectItem>` elegido dentro
   * del trigger, así que «Media» aparecía sola, de rebote. Base UI no hace eso:
   * imprime el value crudo salvo que le pases el catálogo por prop, y el mismo
   * formulario mostraba «medium» en inglés. TypeScript no ve la diferencia —
   * las dos tipan igual y las dos compilan en cero — así que el bug sólo se
   * detecta mirando la pantalla. Con children explícitos el texto del trigger
   * deja de depender de un comportamiento no declarado y sale igual en las dos.
   *
   * El placeholder sigue vivo por las dos vías, a propósito: la prop
   * `placeholder` es la que mira Radix cuando no hay valor, y el fallback de los
   * children es la única que mira Base UI (donde children siempre gana).
   */
  const selected: PriorityDef | undefined = PRIORITY_BY_SLUG[value];
  const SelectedIcon = selected?.icon;

  return (
    <Select value={value} onValueChange={(v) => onChange(v as PrioritySlug)} disabled={disabled}>
      {/* `w-full` porque el trigger de Base UI arranca en `w-fit`: sin esto el
          control se encoge al ancho del label y cambia de tamaño en cada
          selección. */}
      <SelectTrigger className="w-full">
        <SelectValue placeholder={PLACEHOLDER}>
          {selected && SelectedIcon ? (
            <span className="flex min-w-0 items-center gap-2">
              <SelectedIcon aria-hidden className={`h-4 w-4 shrink-0 ${selected.iconClass}`} />
              <span className="truncate">{selected.label}</span>
            </span>
          ) : (
            PLACEHOLDER
          )}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {PRIORITIES.map((p) => {
          const Icon = p.icon;
          return (
            <SelectItem key={p.slug} value={p.slug}>
              <span className="flex items-center gap-2">
                <Icon aria-hidden className={`h-4 w-4 ${p.iconClass}`} />
                {p.label}
              </span>
            </SelectItem>
          );
        })}
      </SelectContent>
    </Select>
  );
}
