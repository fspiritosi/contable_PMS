'use client';

import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Settings } from 'lucide-react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/shared/components/ui/dialog';
import { Button } from '@/shared/components/ui/button';
import { Skeleton } from '@/shared/components/ui/skeleton';
import { Separator } from '@/shared/components/ui/separator';
import { usePermissions } from '@/shared/hooks/usePermissions';

import { getAllExpenseCategories } from '../actions.server';
import { useExpenseCategoryMutations } from '../hooks/useExpenseCategoryMutations';
import { _CategoryCreateForm } from './_CategoryCreateForm';
import { _CategoryRow } from './_CategoryRow';

interface CategoryManagementModalProps {
  trigger?: ReactNode;
  onClose?: () => void;
}

/**
 * ABM de categorías de egreso con su cuenta contable (TSK-757). Se abre desde
 * el botón "Categorías" del listado y desde "Gestionar" en el alta del egreso.
 */
export function _CategoryManagementModal({ trigger, onClose }: CategoryManagementModalProps) {
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const { hasPermission } = usePermissions();
  const mutations = useExpenseCategoryMutations();

  const canCreate = hasPermission('commercial.expenses', 'create');
  const canUpdate = hasPermission('commercial.expenses', 'update');

  const { data: categories = [], isLoading } = useQuery({
    queryKey: ['allExpenseCategories'],
    queryFn: getAllExpenseCategories,
    enabled: open,
  });

  const handleOpenChange = (value: boolean) => {
    setOpen(value);
    if (!value) {
      setEditingId(null);
      onClose?.();
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button variant="outline" size="sm">
            <Settings className="mr-2 h-4 w-4" />
            Gestionar Categorías
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Categorías de egreso</DialogTitle>
          <DialogDescription>
            Cada categoría puede tener su cuenta contable; si no tiene, el egreso usa la cuenta de
            egresos por defecto (Contabilidad → Configuración).
          </DialogDescription>
        </DialogHeader>

        <div className="min-w-0 space-y-4">
          {canCreate && (
            <>
              <_CategoryCreateForm
                onCreate={mutations.createCategory}
                isCreating={mutations.isCreating}
              />
              <Separator />
            </>
          )}

          <div>
            <h3 className="mb-3 text-sm font-medium">Categorías existentes</h3>

            {isLoading && (
              <div className="space-y-2">
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
              </div>
            )}

            {!isLoading && categories.length === 0 && (
              <p className="py-4 text-center text-sm text-muted-foreground">
                No hay categorías creadas aún
              </p>
            )}

            {!isLoading && categories.length > 0 && (
              <div className="space-y-2">
                {categories.map((category) => (
                  <_CategoryRow
                    key={category.id}
                    category={category}
                    canUpdate={canUpdate}
                    isEditing={editingId === category.id}
                    isPending={mutations.pendingId === category.id}
                    onEdit={setEditingId}
                    onSave={mutations.updateCategory}
                    onToggle={mutations.toggleCategory}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
