'use client';

import { Search, X } from 'lucide-react';

import { Button } from '@/shared/components/ui/button';
import { Input } from '@/shared/components/ui/input';

interface AccountsSearchBarProps {
  value: string;
  onChange: (value: string) => void;
  /** Cuentas que coinciden; solo se muestra mientras hay búsqueda. */
  matchCount: number;
}

/** Buscador del plan de cuentas (TSK-850): por código o nombre, sin acentos. */
export function _AccountsSearchBar({ value, onChange, matchCount }: AccountsSearchBarProps) {
  const searching = value.trim() !== '';

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
      <div className="relative w-full sm:max-w-md">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="search"
          placeholder="Buscar cuenta por código o nombre..."
          aria-label="Buscar cuenta"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onChange('');
          }}
          className="pl-9 pr-9 [&::-webkit-search-cancel-button]:hidden"
        />
        {searching && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="absolute right-1 top-1/2 h-7 w-7 -translate-y-1/2"
            onClick={() => onChange('')}
            aria-label="Limpiar búsqueda"
          >
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>
      {searching && (
        <span className="text-sm text-muted-foreground" aria-live="polite">
          {matchCount === 1 ? '1 cuenta coincide' : `${matchCount} cuentas coinciden`}
        </span>
      )}
    </div>
  );
}
