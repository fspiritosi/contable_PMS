'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import moment from 'moment';

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
import { AccountCombobox } from '@/shared/components/common/AccountCombobox';
import { Textarea } from '@/shared/components/ui/textarea';

import { createBankMovement, getAccountsForBankMovement } from '../../../bank-movements/actions.server';
import {
  bankMovementSchema,
  BANK_MOVEMENT_TYPE_LABELS,
  type BankMovementFormData,
} from '../../../../shared/validators';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  bankAccountId: string;
  onSuccess: () => void;
}

export function _CreateBankMovementDialog({ open, onOpenChange, bankAccountId, onSuccess }: Props) {
  const { data: accounts = [] } = useQuery({
    queryKey: ['accounts-for-bank-movement'],
    queryFn: getAccountsForBankMovement,
    enabled: open,
  });

  const form = useForm<BankMovementFormData>({
    resolver: zodResolver(bankMovementSchema),
    defaultValues: {
      bankAccountId,
      type: 'DEPOSIT',
      amount: '',
      date: new Date(),
      description: '',
      reference: null,
      statementNumber: null,
      accountId: '',
    },
  });

  const onSubmit = async (data: BankMovementFormData) => {
    try {
      await createBankMovement(data);
      toast.success('Movimiento bancario registrado correctamente');
      form.reset({
        bankAccountId,
        type: 'DEPOSIT',
        amount: '',
        date: new Date(),
        description: '',
        reference: null,
        statementNumber: null,
        accountId: '',
      });
      onSuccess();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Error al registrar movimiento');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>Nuevo Movimiento Bancario</DialogTitle>
          <DialogDescription>
            Registra un movimiento manual en la cuenta bancaria
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="type"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Tipo de Movimiento *</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Seleccionar tipo" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {Object.entries(BANK_MOVEMENT_TYPE_LABELS).map(([value, label]) => (
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
                        onChange={(e) => field.onChange(e.target.value ? new Date(e.target.value + 'T12:00:00') : undefined)}
                      />
                    </FormControl>
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
                    <div className="relative">
                      <span className="absolute left-3 top-2.5 text-muted-foreground">$</span>
                      <Input
                        type="text"
                        placeholder="0.00"
                        {...field}
                        value={field.value || ''}
                        className="pl-7"
                        onChange={(e) => {
                          const value = e.target.value.replace(/[^0-9.]/g, '');
                          const parts = value.split('.');
                          if (parts.length > 2) return;
                          if (parts[1] && parts[1].length > 2) return;
                          field.onChange(value);
                        }}
                      />
                    </div>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="accountId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Cuenta Contable (Contrapartida) *</FormLabel>
                  <FormControl>
                    <AccountCombobox
                      accounts={accounts}
                      value={field.value}
                      onChange={(accountId) => field.onChange(accountId ?? '')}
                      placeholder="Seleccionar cuenta contable"
                      clearLabel={null}
                    />
                  </FormControl>
                  <FormDescription>
                    Cuenta contable a la que se imputa el movimiento
                  </FormDescription>
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
                      placeholder="Descripción del movimiento..."
                      {...field}
                      rows={2}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="reference"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Referencia</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="Número de referencia"
                        {...field}
                        value={field.value || ''}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="statementNumber"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>N° de Extracto</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="Número de extracto"
                        {...field}
                        value={field.value || ''}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting ? 'Registrando...' : 'Registrar Movimiento'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
