'use client';

import { useState, ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Settings, Plus, Edit2, Check, X, Power } from 'lucide-react';

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/shared/components/ui/dialog';
import { Button } from '@/shared/components/ui/button';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/shared/components/ui/form';
import { Input } from '@/shared/components/ui/input';
import { Textarea } from '@/shared/components/ui/textarea';
import { Badge } from '@/shared/components/ui/badge';
import { Skeleton } from '@/shared/components/ui/skeleton';
import { Separator } from '@/shared/components/ui/separator';
import { cn } from '@/shared/lib/utils';
import { logger } from '@/shared/lib/logger';

import {
  getAllExpenseCategories,
  createExpenseCategory,
  updateExpenseCategory,
  toggleExpenseCategory,
} from '../actions.server';
import { expenseCategoryFormSchema, type ExpenseCategoryFormInput } from '../validators';

type CategoryItem = Awaited<ReturnType<typeof getAllExpenseCategories>>[number];

interface EditState {
  id: string;
  name: string;
  description: string;
}

interface CategoryManagementModalProps {
  trigger?: ReactNode;
  onClose?: () => void;
}

export function _CategoryManagementModal({ trigger, onClose }: CategoryManagementModalProps) {
  const [open, setOpen] = useState(false);
  const [editState, setEditState] = useState<EditState | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const { data: categories = [], isLoading } = useQuery({
    queryKey: ['allExpenseCategories'],
    queryFn: getAllExpenseCategories,
    enabled: open,
  });

  const createForm = useForm<ExpenseCategoryFormInput>({
    resolver: zodResolver(expenseCategoryFormSchema),
    defaultValues: { name: '', description: '' },
  });

  const handleCreate = async (data: ExpenseCategoryFormInput) => {
    try {
      await createExpenseCategory(data);
      toast.success('Categoría creada correctamente');
      await queryClient.invalidateQueries({ queryKey: ['allExpenseCategories'] });
      await queryClient.invalidateQueries({ queryKey: ['expenseCategories'] });
      createForm.reset();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Error al crear categoría');
    }
  };

  const handleEditSave = async (category: CategoryItem) => {
    if (!editState) return;

    try {
      await updateExpenseCategory(category.id, {
        name: editState.name,
        description: editState.description || null,
      });
      toast.success('Categoría actualizada correctamente');
      await queryClient.invalidateQueries({ queryKey: ['allExpenseCategories'] });
      await queryClient.invalidateQueries({ queryKey: ['expenseCategories'] });
      setEditState(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Error al actualizar categoría');
    }
  };

  const handleToggle = async (category: CategoryItem) => {
    setTogglingId(category.id);
    try {
      await toggleExpenseCategory(category.id);
      toast.success(category.isActive ? 'Categoría desactivada' : 'Categoría activada');
      await queryClient.invalidateQueries({ queryKey: ['allExpenseCategories'] });
      await queryClient.invalidateQueries({ queryKey: ['expenseCategories'] });
    } catch (error) {
      logger.error('Error al toggle categoría', { data: { error } });
      toast.error(error instanceof Error ? error.message : 'Error al cambiar estado');
    } finally {
      setTogglingId(null);
    }
  };

  const handleOpenChange = (value: boolean) => {
    setOpen(value);
    if (!value) {
      setEditState(null);
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
      <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Gestión de Categorías</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Nueva categoría */}
          <Form {...createForm}>
            <form onSubmit={createForm.handleSubmit(handleCreate)} className="space-y-3">
              <h3 className="text-sm font-medium">Nueva Categoría</h3>
              <FormField
                control={createForm.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Nombre *</FormLabel>
                    <FormControl>
                      <Input placeholder="Nombre de la categoría" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={createForm.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Descripción (opcional)</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="Descripción de la categoría"
                        rows={2}
                        {...field}
                        value={field.value ?? ''}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button type="submit" size="sm" disabled={createForm.formState.isSubmitting}>
                <Plus className="mr-2 h-4 w-4" />
                {createForm.formState.isSubmitting ? 'Creando...' : 'Agregar'}
              </Button>
            </form>
          </Form>

          <Separator />

          {/* Lista de categorías */}
          <div>
            <h3 className="text-sm font-medium mb-3">Categorías existentes</h3>

            {isLoading && (
              <div className="space-y-2">
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
              </div>
            )}

            {!isLoading && categories.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">
                No hay categorías creadas aún
              </p>
            )}

            {!isLoading && categories.length > 0 && (
              <div className="space-y-2">
                {categories.map((category) => (
                  <div
                    key={category.id}
                    className={cn(
                      'p-3 border rounded-lg',
                      !category.isActive && 'opacity-60 bg-muted/30'
                    )}
                  >
                    {editState?.id === category.id ? (
                      /* Edit mode */
                      <div className="space-y-2">
                        <Input
                          value={editState.name}
                          onChange={(e) =>
                            setEditState((prev) => prev ? { ...prev, name: e.target.value } : null)
                          }
                          placeholder="Nombre"
                          className="h-8 text-sm"
                        />
                        <Input
                          value={editState.description}
                          onChange={(e) =>
                            setEditState((prev) => prev ? { ...prev, description: e.target.value } : null)
                          }
                          placeholder="Descripción (opcional)"
                          className="h-8 text-sm"
                        />
                        <div className="flex gap-2">
                          <Button
                            type="button"
                            size="sm"
                            variant="default"
                            className="h-7 text-xs"
                            onClick={() => handleEditSave(category)}
                          >
                            <Check className="mr-1 h-3 w-3" />
                            Guardar
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            className="h-7 text-xs"
                            onClick={() => setEditState(null)}
                          >
                            <X className="mr-1 h-3 w-3" />
                            Cancelar
                          </Button>
                        </div>
                      </div>
                    ) : (
                      /* View mode */
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-medium">{category.name}</p>
                            {!category.isActive && (
                              <Badge variant="secondary" className="text-xs">Inactiva</Badge>
                            )}
                          </div>
                          {category.description && (
                            <p className="text-xs text-muted-foreground mt-0.5">{category.description}</p>
                          )}
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {category._count.expenses} egreso{category._count.expenses !== 1 ? 's' : ''}
                          </p>
                        </div>
                        <div className="flex items-center gap-1 flex-shrink-0">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() =>
                              setEditState({
                                id: category.id,
                                name: category.name,
                                description: category.description ?? '',
                              })
                            }
                            title="Editar"
                          >
                            <Edit2 className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            disabled={togglingId === category.id}
                            onClick={() => handleToggle(category)}
                            title={category.isActive ? 'Desactivar' : 'Activar'}
                          >
                            <Power className={cn('h-3.5 w-3.5', category.isActive ? 'text-green-600' : 'text-muted-foreground')} />
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
