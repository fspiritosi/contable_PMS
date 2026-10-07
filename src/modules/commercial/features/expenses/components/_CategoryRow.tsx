'use client';

import { useState } from 'react';
import { Check, Edit2, Power, X } from 'lucide-react';

import { Badge } from '@/shared/components/ui/badge';
import { Button } from '@/shared/components/ui/button';
import { Input } from '@/shared/components/ui/input';
import { cn } from '@/shared/lib/utils';

import type { getAllExpenseCategories } from '../actions.server';
import type { ExpenseCategoryFormInput } from '../validators';
import { _CategoryAccountField } from './_CategoryAccountField';

export type CategoryItem = Awaited<ReturnType<typeof getAllExpenseCategories>>[number];

interface CategoryRowProps {
  category: CategoryItem;
  canUpdate: boolean;
  isEditing: boolean;
  isPending: boolean;
  onEdit: (id: string | null) => void;
  onSave: (id: string, data: ExpenseCategoryFormInput) => Promise<boolean>;
  onToggle: (category: { id: string; isActive: boolean }) => Promise<boolean>;
}

interface Draft {
  name: string;
  description: string;
  accountId: string | null;
}

/** Fila del ABM de categorías: vista con la cuenta contable o edición inline (TSK-757). */
export function _CategoryRow({
  category,
  canUpdate,
  isEditing,
  isPending,
  onEdit,
  onSave,
  onToggle,
}: CategoryRowProps) {
  const [draft, setDraft] = useState<Draft>({
    name: category.name,
    description: category.description ?? '',
    accountId: category.accountId,
  });

  const startEdit = () => {
    setDraft({
      name: category.name,
      description: category.description ?? '',
      accountId: category.accountId,
    });
    onEdit(category.id);
  };

  const save = async () => {
    const saved = await onSave(category.id, {
      name: draft.name,
      description: draft.description || null,
      // Siempre se manda: null = volver a la cuenta de egresos por defecto.
      accountId: draft.accountId,
    });
    if (saved) onEdit(null);
  };

  const count = category._count.expenses;

  return (
    <div
      className={cn('min-w-0 rounded-lg border p-3', !category.isActive && 'bg-muted/30 opacity-60')}
      data-testid="category-row"
    >
      {isEditing ? (
        <div className="space-y-2">
          <div className="grid gap-2 sm:grid-cols-2">
            <Input
              value={draft.name}
              onChange={(e) => setDraft((prev) => ({ ...prev, name: e.target.value }))}
              placeholder="Nombre"
              aria-label="Nombre"
              className="h-8 text-sm"
            />
            <div className="min-w-0">
              <_CategoryAccountField
                id={`category-account-${category.id}`}
                value={draft.accountId}
                onChange={(accountId) => setDraft((prev) => ({ ...prev, accountId }))}
                savedAccountId={category.accountId}
                disabled={isPending}
              />
            </div>
          </div>
          <Input
            value={draft.description}
            onChange={(e) => setDraft((prev) => ({ ...prev, description: e.target.value }))}
            placeholder="Descripción (opcional)"
            aria-label="Descripción"
            className="h-8 text-sm"
          />
          <div className="flex gap-2">
            <Button type="button" size="sm" className="h-7 text-xs" disabled={isPending} onClick={save}>
              <Check className="mr-1 h-3 w-3" />
              Guardar
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-7 text-xs"
              disabled={isPending}
              onClick={() => onEdit(null)}
            >
              <X className="mr-1 h-3 w-3" />
              Cancelar
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-0.5">
            <div className="flex min-w-0 items-center gap-2">
              <p className="truncate text-sm font-medium">{category.name}</p>
              {!category.isActive && (
                <Badge variant="secondary" className="text-xs">
                  Inactiva
                </Badge>
              )}
            </div>
            <p
              className={cn(
                'min-w-0 basis-full truncate text-xs sm:basis-auto',
                category.account ? 'font-mono' : 'text-muted-foreground'
              )}
              data-testid="category-account"
              title={category.account ? `${category.account.code} - ${category.account.name}` : undefined}
            >
              {category.account
                ? `${category.account.code} - ${category.account.name}`
                : 'Por defecto'}
            </p>
            {category.description && (
              <p className="basis-full text-xs text-muted-foreground">{category.description}</p>
            )}
            <p className="basis-full text-xs text-muted-foreground">
              {count} egreso{count !== 1 ? 's' : ''}
            </p>
          </div>
          {canUpdate && (
            <div className="flex shrink-0 items-center gap-1">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                disabled={isPending}
                onClick={startEdit}
                title="Editar"
                aria-label={`Editar ${category.name}`}
              >
                <Edit2 className="h-3.5 w-3.5" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                disabled={isPending}
                onClick={() => onToggle(category)}
                title={category.isActive ? 'Desactivar' : 'Activar'}
                aria-label={`${category.isActive ? 'Desactivar' : 'Activar'} ${category.name}`}
              >
                <Power
                  className={cn(
                    'h-3.5 w-3.5',
                    category.isActive ? 'text-green-600' : 'text-muted-foreground'
                  )}
                />
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
