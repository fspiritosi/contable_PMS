'use client';

import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Loader2 } from 'lucide-react';

import { Button } from '@/shared/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog';
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
import type { EquivalenceRow } from '../columns';

const equivalenceFormSchema = z.object({
  name: z.string().min(1, 'El nombre es requerido').max(200),
  oemCode: z.string().max(100).optional(),
  notes: z.string().max(1000).optional(),
});

type EquivalenceFormData = z.infer<typeof equivalenceFormSchema>;

interface EquivalenceFormModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: EquivalenceFormData) => Promise<void>;
  editingGroup?: EquivalenceRow | null;
  isSubmitting?: boolean;
}

export function _EquivalenceFormModal({
  open,
  onOpenChange,
  onSubmit,
  editingGroup,
  isSubmitting = false,
}: EquivalenceFormModalProps) {
  const isEditing = !!editingGroup;

  const form = useForm<EquivalenceFormData>({
    resolver: zodResolver(equivalenceFormSchema),
    defaultValues: {
      name: '',
      oemCode: '',
      notes: '',
    },
  });

  useEffect(() => {
    if (editingGroup) {
      form.reset({
        name: editingGroup.name,
        oemCode: editingGroup.oemCode || '',
        notes: editingGroup.notes || '',
      });
    } else {
      form.reset({ name: '', oemCode: '', notes: '' });
    }
  }, [editingGroup, form]);

  const handleSubmit = async (data: EquivalenceFormData) => {
    await onSubmit(data);
    form.reset();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>
            {isEditing ? 'Editar Grupo de Equivalencia' : 'Nuevo Grupo de Equivalencia'}
          </DialogTitle>
          <DialogDescription>
            {isEditing
              ? 'Modificá los datos del grupo de equivalencia.'
              : 'Creá un grupo para agrupar artículos equivalentes de diferentes marcas.'}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Nombre *</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="Ej: Filtro aceite motor 1.6"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="oemCode"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Código OEM (opcional)</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="Código original de referencia"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Notas (opcional)</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Observaciones sobre este grupo de equivalencia"
                      className="resize-none"
                      rows={3}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Guardando...
                  </>
                ) : isEditing ? (
                  'Guardar Cambios'
                ) : (
                  'Crear Grupo'
                )}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
