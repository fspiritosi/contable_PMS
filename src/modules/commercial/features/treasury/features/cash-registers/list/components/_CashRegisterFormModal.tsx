'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';

import { Button } from '@/shared/components/ui/button';
import { Checkbox } from '@/shared/components/ui/checkbox';
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
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/shared/components/ui/form';
import { Input } from '@/shared/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui/select';

import { createCashRegister, updateCashRegister } from '../../actions.server';
import { getAvailableAccountsForCashRegister } from '../actions.server';
import { cashRegisterSchema, type CashRegisterFormData } from '../../../../shared/validators';
import type { CashRegisterWithActiveSession } from '../../../../shared/types';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  cashRegister?: CashRegisterWithActiveSession | null;
  onSuccess: () => void;
}

export function _CashRegisterFormModal({ open, onOpenChange, cashRegister, onSuccess }: Props) {
  const isEditing = !!cashRegister;

  const { data: accounts = [] } = useQuery({
    queryKey: ['available-accounts-cash-register'],
    queryFn: getAvailableAccountsForCashRegister,
    enabled: open,
  });

  const form = useForm({
    resolver: zodResolver(cashRegisterSchema),
    defaultValues: {
      code: '',
      name: '',
      location: null,
      isDefault: false,
      accountId: null,
    },
  });

  // Resetear form cuando cambia el modal o la caja
  useEffect(() => {
    if (open) {
      if (cashRegister) {
        form.reset({
          code: cashRegister.code,
          name: cashRegister.name,
          location: cashRegister.location || '',
          isDefault: cashRegister.isDefault,
          accountId: (cashRegister.accountId as string | null) ?? null,
        });
      } else {
        form.reset({
          code: '',
          name: '',
          location: null,
          isDefault: false,
          accountId: null,
        });
      }
    }
  }, [open, cashRegister, form]);

  const onSubmit = async (data: CashRegisterFormData) => {
    try {
      if (isEditing) {
        await updateCashRegister(cashRegister.id, data);
        toast.success('Caja actualizada correctamente');
      } else {
        await createCashRegister(data);
        toast.success('Caja creada correctamente');
      }
      onSuccess();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Error al guardar caja');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>{isEditing ? 'Editar Caja' : 'Nueva Caja'}</DialogTitle>
          <DialogDescription>
            {isEditing
              ? 'Modifica los datos de la caja registradora'
              : 'Completa los datos para crear una nueva caja registradora'}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="code"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Código *</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="CAJA-01"
                      {...field}
                      value={field.value || ''}
                      className="uppercase"
                      onChange={(e) => field.onChange(e.target.value.toUpperCase())}
                    />
                  </FormControl>
                  <FormDescription>Código único identificador (ej: CAJA-01, CAJA-PRINCIPAL)</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Nombre *</FormLabel>
                  <FormControl>
                    <Input placeholder="Caja Principal" {...field} value={field.value || ''} />
                  </FormControl>
                  <FormDescription>Nombre descriptivo de la caja</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="location"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Ubicación</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="Recepción, Sucursal Centro, etc."
                      {...field}
                      value={field.value || ''}
                    />
                  </FormControl>
                  <FormDescription>Ubicación física de la caja</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="accountId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Cuenta contable asociada</FormLabel>
                  <Select
                    onValueChange={(v) => field.onChange(v === '__none__' ? null : v)}
                    value={field.value || '__none__'}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Sin asignar" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="__none__">Sin asignar</SelectItem>
                      {accounts.map((account) => (
                        <SelectItem key={account.id} value={account.id}>
                          {account.code} - {account.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormDescription>
                    Cuenta de activo usada en los asientos de esta caja. Si no se asigna, se usa la
                    cuenta de caja por defecto de Ajustes contables.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="isDefault"
              render={({ field }) => (
                <FormItem className="flex flex-row items-start space-x-3 space-y-0 rounded-md border p-4">
                  <FormControl>
                    <Checkbox checked={field.value} onCheckedChange={field.onChange} />
                  </FormControl>
                  <div className="space-y-1 leading-none">
                    <FormLabel>Caja por defecto</FormLabel>
                    <FormDescription>
                      Marcar como la caja predeterminada para operaciones de efectivo
                    </FormDescription>
                  </div>
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting ? 'Guardando...' : isEditing ? 'Actualizar' : 'Crear'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
