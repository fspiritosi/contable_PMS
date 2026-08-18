'use client';

import { useMemo, useState } from 'react';
import { Check, ChevronsUpDown, X } from 'lucide-react';

import { cn } from '@/shared/lib/utils';
import { Button } from '@/shared/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/shared/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/shared/components/ui/popover';

/** Cuenta mostrable en el selector. Acepta cualquier query que traiga code y name. */
export interface AccountOption {
  id: string;
  code: string;
  name: string;
}

interface AccountComboboxProps {
  accounts: AccountOption[];
  /** Id de la cuenta elegida, o null si no hay ninguna. */
  value: string | null | undefined;
  onChange: (accountId: string | null) => void;
  id?: string;
  placeholder?: string;
  /** Texto de la opción que limpia la selección. Omitir para volverla obligatoria. */
  clearLabel?: string | null;
  disabled?: boolean;
  className?: string;
  'aria-invalid'?: boolean;
}

/**
 * Selector de cuentas contables con búsqueda por código y por nombre.
 *
 * Un plan de cuentas completo es demasiado largo para un `Select`: había que
 * recorrerlo entrada por entrada para encontrar la cuenta (TSK-464, TSK-492).
 * Filtra sobre "código + nombre", así que sirve tanto a quien conoce el árbol
 * de cuentas y tipea "1.1.1" como a quien busca "banco galicia".
 */
export function AccountCombobox({
  accounts,
  value,
  onChange,
  id,
  placeholder = 'Seleccionar cuenta...',
  clearLabel = 'Sin asignar',
  disabled = false,
  className,
  'aria-invalid': ariaInvalid,
}: AccountComboboxProps) {
  const [open, setOpen] = useState(false);

  const selected = useMemo(
    () => (value ? accounts.find((account) => account.id === value) : undefined) ?? null,
    [accounts, value]
  );

  const select = (accountId: string | null) => {
    onChange(accountId);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-invalid={ariaInvalid}
          disabled={disabled}
          className={cn(
            'w-full justify-between font-normal',
            !selected && 'text-muted-foreground',
            className
          )}
        >
          <span className="truncate">
            {selected ? `${selected.code} - ${selected.name}` : placeholder}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>

      <PopoverContent
        className="w-[--radix-popover-trigger-width] min-w-[280px] p-0"
        align="start"
      >
        <Command>
          <CommandInput placeholder="Buscar por código o nombre..." />
          <CommandList>
            <CommandEmpty>No se encontraron cuentas</CommandEmpty>

            {clearLabel && (
              <CommandGroup>
                <CommandItem value="__sin-asignar__" onSelect={() => select(null)}>
                  <X className="mr-2 h-4 w-4 shrink-0 opacity-50" />
                  <span className="text-muted-foreground">{clearLabel}</span>
                  {!selected && <Check className="ml-auto h-4 w-4 shrink-0" />}
                </CommandItem>
              </CommandGroup>
            )}

            <CommandGroup>
              {accounts.map((account) => (
                <CommandItem
                  // El value alimenta el filtro: por eso incluye código Y nombre.
                  key={account.id}
                  value={`${account.code} ${account.name}`}
                  onSelect={() => select(account.id)}
                >
                  <span className="mr-2 shrink-0 font-mono text-xs text-muted-foreground">
                    {account.code}
                  </span>
                  <span className="truncate">{account.name}</span>
                  {selected?.id === account.id && (
                    <Check className="ml-auto h-4 w-4 shrink-0" />
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
