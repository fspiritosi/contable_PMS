'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import moment from 'moment';
import { Loader2, Plus } from 'lucide-react';

import { Button } from '@/shared/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/shared/components/ui/dialog';
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
import { MoneyInput } from '@/shared/components/ui/money-input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui/select';
import { PartnerMovementType } from '@/generated/prisma/enums';
import { logger } from '@/shared/lib/logger';
import {
  partnerMovementSchema,
  MANUAL_MOVEMENT_TYPES,
  type PartnerMovementFormData,
} from '../../../shared/validators';
import { PARTNER_MOVEMENT_TYPE_LABELS } from '../../../shared/types';
import { createPartnerMovement } from '../actions.server';

interface PartnerMovementDialogProps {
  partnerId: string;
}

export function _PartnerMovementDialog({ partnerId }: PartnerMovementDialogProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);

  const form = useForm<PartnerMovementFormData>({
    resolver: zodResolver(partnerMovementSchema),
    defaultValues: {
      date: moment().format('YYYY-MM-DD'),
      type: PartnerMovementType.REPAYMENT,
      amount: undefined,
      description: '',
    },
  });

  const mutation = useMutation({
    mutationFn: (data: PartnerMovementFormData) => createPartnerMovement(partnerId, data),
    onSuccess: () => {
      toast.success('Movimiento registrado correctamente');
      queryClient.invalidateQueries({ queryKey: ['partner-account', partnerId] });
      setOpen(false);
      form.reset({
        date: moment().format('YYYY-MM-DD'),
        type: PartnerMovementType.REPAYMENT,
        amount: undefined,
        description: '',
      });
      router.refresh();
    },
    onError: (error) => {
      logger.error('Error al registrar movimiento de socio', { data: { error } });
      toast.error(error instanceof Error ? error.message : 'Error al registrar movimiento');
    },
  });

  const onSubmit = (data: PartnerMovementFormData) => {
    mutation.mutate(data);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="mr-2 h-4 w-4" />
          Registrar movimiento
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>Registrar movimiento</DialogTitle>
          <DialogDescription>
            Registra una devolución (resta deuda) o un ajuste (suma deuda) en la cuenta
            corriente del socio.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <FormField
                control={form.control}
                name="date"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Fecha *</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="type"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Tipo *</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Seleccionar tipo" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {MANUAL_MOVEMENT_TYPES.map((type) => (
                          <SelectItem key={type} value={type}>
                            {PARTNER_MOVEMENT_TYPE_LABELS[type]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormDescription>
                      Devolución resta deuda · Ajuste suma deuda
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="amount"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Monto *</FormLabel>
                  <FormControl>
                    <MoneyInput
                      placeholder="0,00"
                      value={field.value ?? ''}
                      onChange={(raw) => field.onChange(raw === '' ? undefined : Number(raw))}
                      onBlur={field.onBlur}
                      name={field.name}
                      ref={field.ref}
                    />
                  </FormControl>
                  <FormDescription>Ingresá un monto positivo.</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Descripción *</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Motivo del movimiento..."
                      className="min-h-[80px]"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
                disabled={mutation.isPending}
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={mutation.isPending}>
                {mutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {mutation.isPending ? 'Guardando...' : 'Guardar'}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
