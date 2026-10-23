'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';

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
import { logger } from '@/shared/lib/logger';
import { createConcept, getConceptById, updateConcept } from '../actions.server';
import { conceptSchema, type ConceptFormData, type ConceptFormInput } from '../shared/validators';
import { _ConceptAccountField } from './_ConceptAccountField';
import { _ConceptUsagesField } from './_ConceptUsagesField';

interface Props {
  /** `null` = alta. */
  conceptId: string | null;
  onClose: () => void;
}

const EMPTY_VALUES: ConceptFormInput = {
  name: '',
  usages: [],
  accountMode: 'OWN_ACCOUNT',
  accountId: null,
};

export function _ConceptFormDialog({ conceptId, onClose }: Props) {
  const isEdit = conceptId !== null;
  const { data: concept, isLoading } = useQuery({
    queryKey: ['concept', conceptId],
    queryFn: () => getConceptById(conceptId as string),
    enabled: isEdit,
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Editar concepto' : 'Nuevo concepto'}</DialogTitle>
          <DialogDescription>
            Gestión elige el concepto por su nombre; la cuenta contable la define Contabilidad.
          </DialogDescription>
        </DialogHeader>
        {isEdit && isLoading ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Cargando concepto...</p>
        ) : isEdit && !concept ? (
          <p className="py-6 text-center text-sm text-destructive">Concepto no encontrado</p>
        ) : (
          <_ConceptForm
            conceptId={conceptId}
            defaults={
              concept
                ? {
                    name: concept.name,
                    usages: concept.usages,
                    accountMode: concept.accountMode,
                    accountId: concept.accountId,
                  }
                : EMPTY_VALUES
            }
            onClose={onClose}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function _ConceptForm({
  conceptId,
  defaults,
  onClose,
}: {
  conceptId: string | null;
  defaults: ConceptFormInput;
  onClose: () => void;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const form = useForm<ConceptFormInput, unknown, ConceptFormData>({
    resolver: zodResolver(conceptSchema),
    defaultValues: defaults,
  });

  const onSubmit = async (values: ConceptFormData) => {
    try {
      const result = conceptId
        ? await updateConcept(conceptId, values)
        : await createConcept(values);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success(conceptId ? 'Concepto actualizado' : 'Concepto creado');
      await queryClient.invalidateQueries({ queryKey: ['concept', conceptId] });
      router.refresh();
      onClose();
    } catch (error) {
      logger.error('Error al guardar concepto', { data: { error } });
      toast.error('No se pudo guardar el concepto');
    }
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Nombre</FormLabel>
              <FormControl>
                <Input {...field} placeholder="Ej: Impuesto ley 25.413" autoComplete="off" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <_ConceptUsagesField control={form.control} />
        <_ConceptAccountField
          control={form.control}
          setValue={form.setValue}
          savedAccountId={defaults.accountId}
        />
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting ? 'Guardando...' : 'Guardar'}
          </Button>
        </DialogFooter>
      </form>
    </Form>
  );
}
