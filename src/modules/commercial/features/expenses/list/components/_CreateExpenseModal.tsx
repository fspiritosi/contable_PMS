'use client';

import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus, Settings } from 'lucide-react';
import moment from 'moment';

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
import { MoneyInput } from '@/shared/components/ui/money-input';
import { Textarea } from '@/shared/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui/select';

import { expenseFormSchema, type ExpenseFormInput } from '../../validators';
import { createExpense, updateExpense, getExpenseById, getExpenseCategories } from '../../actions.server';
import { getSuppliersForSelect } from '@/modules/commercial/features/purchases/features/invoices/list/actions.server';
import { _CategoryManagementModal } from '../../components/_CategoryManagementModal';

interface CreateExpenseModalProps {
  expenseId?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onSuccess?: () => void;
}

export function _CreateExpenseModal({ expenseId, open: controlledOpen, onOpenChange, onSuccess }: CreateExpenseModalProps) {
  const isEditMode = Boolean(expenseId);
  const [internalOpen, setInternalOpen] = useState(false);
  const queryClient = useQueryClient();

  const open = controlledOpen !== undefined ? controlledOpen : internalOpen;
  const setOpen = (value: boolean) => {
    if (onOpenChange) {
      onOpenChange(value);
    } else {
      setInternalOpen(value);
    }
  };

  const form = useForm<ExpenseFormInput>({
    resolver: zodResolver(expenseFormSchema),
    defaultValues: {
      description: '',
      amount: '',
      date: new Date(),
      dueDate: null,
      categoryId: '',
      supplierId: '',
      notes: '',
    },
  });

  // Load expense data for editing
  useEffect(() => {
    if (isEditMode && expenseId && open) {
      getExpenseById(expenseId).then((data) => {
        form.reset({
          description: data.description,
          amount: data.amount.toString(),
          date: new Date(data.date),
          dueDate: data.dueDate ? new Date(data.dueDate) : null,
          categoryId: data.category.id,
          supplierId: data.supplier?.id ?? '',
          notes: data.notes ?? '',
        });
      });
    }
  }, [isEditMode, expenseId, open, form]);

  const { data: categories = [] } = useQuery({
    queryKey: ['expenseCategories'],
    queryFn: getExpenseCategories,
    enabled: open,
  });

  const { data: suppliers = [] } = useQuery({
    queryKey: ['suppliers'],
    queryFn: getSuppliersForSelect,
    enabled: open,
  });

  const onSubmit = async (data: ExpenseFormInput) => {
    try {
      if (isEditMode && expenseId) {
        await updateExpense(expenseId, data);
        toast.success('Egreso actualizado correctamente');
      } else {
        await createExpense(data);
        toast.success('Egreso creado correctamente');
      }

      await queryClient.invalidateQueries({ queryKey: ['expenseCategories'] });
      setOpen(false);
      form.reset();
      onSuccess?.();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Error al guardar el egreso');
    }
  };

  const content = (
    <DialogContent className="max-w-2xl">
      <DialogHeader>
        <DialogTitle>{isEditMode ? 'Editar Egreso' : 'Nuevo Egreso'}</DialogTitle>
      </DialogHeader>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          {/* Descripción */}
          <FormField
            control={form.control}
            name="description"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Descripción *</FormLabel>
                <FormControl>
                  <Input placeholder="Descripción del egreso" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          {/* Monto y Fecha */}
          <div className="grid gap-4 md:grid-cols-2">
            <FormField
              control={form.control}
              name="amount"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Monto *</FormLabel>
                  <FormControl>
                    <MoneyInput
                      placeholder="0,00"
                      value={field.value}
                      onChange={field.onChange}
                      onBlur={field.onBlur}
                      name={field.name}
                      ref={field.ref}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="date"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Fecha *</FormLabel>
                  <FormControl>
                    <Input
                      type="date"
                      value={field.value ? moment(field.value).format('YYYY-MM-DD') : ''}
                      onChange={(e) => {
                        const val = e.target.value;
                        field.onChange(val ? new Date(val + 'T12:00:00') : null);
                      }}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          {/* Fecha de Vencimiento */}
          <FormField
            control={form.control}
            name="dueDate"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Fecha de Vencimiento (opcional)</FormLabel>
                <FormControl>
                  <Input
                    type="date"
                    value={field.value ? moment(field.value).format('YYYY-MM-DD') : ''}
                    onChange={(e) => {
                      const val = e.target.value;
                      field.onChange(val ? new Date(val + 'T12:00:00') : null);
                    }}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          {/* Categoría */}
          <FormField
            control={form.control}
            name="categoryId"
            render={({ field }) => (
              <FormItem>
                <div className="flex items-center justify-between">
                  <FormLabel>Categoría *</FormLabel>
                  <_CategoryManagementModal
                    trigger={
                      <Button type="button" variant="ghost" size="sm" className="h-6 gap-1 text-xs">
                        <Settings className="h-3 w-3" />
                        Gestionar
                      </Button>
                    }
                    onClose={() => queryClient.invalidateQueries({ queryKey: ['expenseCategories'] })}
                  />
                </div>
                <Select onValueChange={field.onChange} value={field.value}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder="Seleccionar categoría" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {categories.length === 0 && (
                      <div className="p-2 text-sm text-muted-foreground">
                        No hay categorías disponibles
                      </div>
                    )}
                    {categories.map((cat) => (
                      <SelectItem key={cat.id} value={cat.id}>
                        {cat.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />

          {/* Proveedor */}
          <FormField
            control={form.control}
            name="supplierId"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Proveedor (opcional)</FormLabel>
                <Select
                  onValueChange={(val) => field.onChange(val === '__none__' ? '' : val)}
                  value={field.value || '__none__'}
                >
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder="Seleccionar proveedor (opcional)" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="__none__">Sin proveedor</SelectItem>
                    {suppliers.map((supplier) => (
                      <SelectItem key={supplier.id} value={supplier.id}>
                        {supplier.tradeName || supplier.businessName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />

          {/* Notas */}
          <FormField
            control={form.control}
            name="notes"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Notas (opcional)</FormLabel>
                <FormControl>
                  <Textarea
                    placeholder="Observaciones adicionales"
                    {...field}
                    value={field.value ?? ''}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting
                ? isEditMode ? 'Guardando...' : 'Creando...'
                : isEditMode ? 'Guardar Cambios' : 'Crear Egreso'}
            </Button>
          </div>
        </form>
      </Form>
    </DialogContent>
  );

  if (isEditMode) {
    return (
      <Dialog open={open} onOpenChange={setOpen}>
        {content}
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="mr-2 h-4 w-4" />
          Nuevo Egreso
        </Button>
      </DialogTrigger>
      {content}
    </Dialog>
  );
}
