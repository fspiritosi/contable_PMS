'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Plus } from 'lucide-react';

import { Button } from '@/shared/components/ui/button';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/shared/components/ui/form';
import { Input } from '@/shared/components/ui/input';
import { Textarea } from '@/shared/components/ui/textarea';

import { expenseCategoryFormSchema, type ExpenseCategoryFormInput } from '../validators';
import { _CategoryAccountField } from './_CategoryAccountField';

interface CategoryCreateFormProps {
  /** true si se creó: solo entonces se limpia el form. */
  onCreate: (data: ExpenseCategoryFormInput) => Promise<boolean>;
  isCreating: boolean;
}

/** Alta de una categoría de egreso con su cuenta contable opcional (TSK-757). */
export function _CategoryCreateForm({ onCreate, isCreating }: CategoryCreateFormProps) {
  const form = useForm<ExpenseCategoryFormInput>({
    resolver: zodResolver(expenseCategoryFormSchema),
    defaultValues: { name: '', description: '', accountId: null },
  });

  const handleSubmit = async (data: ExpenseCategoryFormInput) => {
    if (await onCreate(data)) form.reset();
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-3">
        <h3 className="text-sm font-medium">Nueva categoría</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="name"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Nombre *</FormLabel>
                <FormControl>
                  <Input placeholder="Ej.: Alquiler de oficina" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="accountId"
            render={({ field }) => (
              <FormItem className="min-w-0">
                <FormLabel>Cuenta contable (opcional)</FormLabel>
                <_CategoryAccountField
                  id="new-category-account"
                  value={field.value}
                  onChange={field.onChange}
                  disabled={isCreating}
                />
                <FormDescription className="text-xs">
                  Si la dejás vacía, se usa la cuenta de egresos por defecto.
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
        <FormField
          control={form.control}
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
        <Button type="submit" size="sm" disabled={isCreating}>
          <Plus className="mr-2 h-4 w-4" />
          {isCreating ? 'Creando...' : 'Agregar'}
        </Button>
      </form>
    </Form>
  );
}
