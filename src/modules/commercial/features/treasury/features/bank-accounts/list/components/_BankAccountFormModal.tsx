'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
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

import { createBankAccount, updateBankAccount } from '../../actions.server';
import { getAvailableAccounts } from '../actions.server';
import { bankAccountSchema, BANK_ACCOUNT_TYPE_LABELS } from '../../../../shared/validators';
import type { BankAccountWithBalance } from '../../../../shared/types';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  bankAccount?: BankAccountWithBalance | null;
  onSuccess: () => void;
}

export function _BankAccountFormModal({ open, onOpenChange, bankAccount, onSuccess }: Props) {
  const isEditing = !!bankAccount;

  // Query para cuentas contables
  const { data: accounts = [] } = useQuery({
    queryKey: ['available-accounts'],
    queryFn: getAvailableAccounts,
    enabled: open,
  });

  const form = useForm({
    resolver: zodResolver(bankAccountSchema),
    defaultValues: {
      bankName: '',
      accountNumber: '',
      accountType: 'CHECKING' as const,
      cbu: null,
      alias: null,
      currency: 'ARS',
      balance: '0.00',
      accountId: null,
    },
  });

  const watchedAccountType = form.watch('accountType');
  const isCash = watchedAccountType === 'CASH';
  const isVirtualWallet = watchedAccountType === 'VIRTUAL_WALLET';
  const isNonBank = isCash || isVirtualWallet;

  // Resetear form cuando cambia el modal o la cuenta
  useEffect(() => {
    if (open) {
      if (bankAccount) {
        form.reset({
          bankName: bankAccount.bankName,
          accountNumber: bankAccount.accountNumber,
          accountType: bankAccount.accountType,
          cbu: bankAccount.cbu,
          alias: bankAccount.alias,
          currency: bankAccount.currency,
          balance: bankAccount.balance.toString(),
          accountId: null, // Se cargará desde el query si existe
        });
      } else {
        form.reset({
          bankName: '',
          accountNumber: '',
          accountType: 'CHECKING',
          cbu: null,
          alias: null,
          currency: 'ARS',
          balance: '0.00',
          accountId: null,
        });
      }
    }
  }, [open, bankAccount, form]);

  const onSubmit = async (data: any) => {
    try {
      if (isEditing) {
        await updateBankAccount(bankAccount.id, data);
        toast.success('Cuenta bancaria actualizada correctamente');
      } else {
        await createBankAccount(data);
        toast.success('Cuenta bancaria creada correctamente');
      }
      onSuccess();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Error al guardar cuenta');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>{isEditing ? 'Editar Cuenta' : 'Nueva Cuenta'}</DialogTitle>
          <DialogDescription>
            {isEditing
              ? 'Modifica los datos de la cuenta'
              : 'Completa los datos para crear una nueva cuenta'}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="accountType"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Tipo de Cuenta *</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Seleccionar tipo" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {Object.entries(BANK_ACCOUNT_TYPE_LABELS).map(([value, label]) => (
                        <SelectItem key={value} value={value}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="bankName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      {isNonBank ? 'Nombre' : 'Banco'} {!isNonBank && '*'}
                    </FormLabel>
                    <FormControl>
                      <Input
                        placeholder={isNonBank ? 'Ej: Caja Principal' : 'Banco Nación'}
                        {...field}
                        value={field.value || ''}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {!isNonBank && (
                <FormField
                  control={form.control}
                  name="accountNumber"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Número de Cuenta *</FormLabel>
                      <FormControl>
                        <Input placeholder="1234567890" {...field} value={field.value || ''} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}
            </div>

            {!isCash && (
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="cbu"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{isVirtualWallet ? 'CVU' : 'CBU'}</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="22 dígitos"
                          {...field}
                          value={field.value || ''}
                          maxLength={22}
                        />
                      </FormControl>
                      <FormDescription>22 dígitos</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="alias"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Alias</FormLabel>
                      <FormControl>
                        <Input placeholder={isVirtualWallet ? 'MI.BILLETERA' : 'EMPRESA.CAJA'} {...field} value={field.value || ''} />
                      </FormControl>
                      <FormDescription>Para transferencias</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            )}

            {!isEditing && (
              <FormField
                control={form.control}
                name="balance"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Saldo Inicial</FormLabel>
                    <FormControl>
                      <div className="relative">
                        <span className="absolute left-3 top-2.5 text-muted-foreground">$</span>
                        <Input
                          type="text"
                          placeholder="0.00"
                          {...field}
                          value={field.value || ''}
                          className="pl-7"
                          onChange={(e) => {
                            const value = e.target.value.replace(/[^0-9.-]/g, '');
                            const parts = value.split('.');
                            if (parts.length > 2) return;
                            if (parts[1] && parts[1].length > 2) return;
                            field.onChange(value);
                          }}
                        />
                      </div>
                    </FormControl>
                    <FormDescription>Saldo actual de la cuenta</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

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
