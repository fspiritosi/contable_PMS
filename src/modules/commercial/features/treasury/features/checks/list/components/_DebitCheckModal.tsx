'use client';

import { useCallback } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import moment from 'moment';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/shared/components/ui/dialog';
import {
  Form,
  FormControl,
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
import { Button } from '@/shared/components/ui/button';
import { Skeleton } from '@/shared/components/ui/skeleton';
import { formatCurrency } from '@/shared/utils/formatters';
import { businessToday, fromDateInputValue, toDateInputValue } from '@/shared/utils/date-input';
import { debitCheckSchema, type DebitCheckFormData } from '../../../../shared/validators';
import { debitCheck, getActiveBankAccounts } from '../../actions.server';
import type { CheckListItem } from '../../../../shared/types';
import { notifyCheckActionResult } from '../check-action-result';

interface Props {
  check: CheckListItem;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Debitar un cheque propio entregado (TSK-735): fecha y cuenta bancaria del débito (por
 * defecto, la del cheque). El llamador lo monta con `key` = id del cheque para que los
 * valores por defecto sigan al cheque elegido.
 */
export function _DebitCheckModal({ check, open, onOpenChange }: Props) {
  const router = useRouter();

  const defaults = useCallback(
    (): DebitCheckFormData => ({
      checkId: check.id,
      bankAccountId: check.bankAccount?.id ?? '',
      date: businessToday(),
    }),
    [check.id, check.bankAccount?.id]
  );

  const form = useForm<DebitCheckFormData>({
    resolver: zodResolver(debitCheckSchema),
    defaultValues: defaults(),
  });

  const { isSubmitting } = form.formState;

  const { data: bankAccounts = [], isLoading: loadingAccounts } = useQuery({
    queryKey: ['activeBankAccounts'],
    queryFn: getActiveBankAccounts,
    enabled: open,
  });

  const handleClose = useCallback(() => {
    form.reset(defaults());
    onOpenChange(false);
  }, [form, defaults, onOpenChange]);

  const onSubmit = async (values: DebitCheckFormData) => {
    const result = await debitCheck(values);
    if (notifyCheckActionResult(result, 'Cheque debitado correctamente')) {
      handleClose();
      router.refresh();
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Debitar Cheque</DialogTitle>
        </DialogHeader>

        <div className="mb-2 rounded-md bg-muted p-3 text-sm">
          <p className="font-medium">Cheque N° {check.checkNumber}</p>
          <p className="text-muted-foreground">{check.supplier?.businessName ?? check.bankName}</p>
          <p className="mt-1 text-lg font-bold">{formatCurrency(check.amount)}</p>
          <p className="text-muted-foreground">
            Vence: {moment(check.dueDate).format('DD/MM/YYYY')}
          </p>
        </div>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="bankAccountId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Cuenta Bancaria</FormLabel>
                  {loadingAccounts ? (
                    <Skeleton className="h-10 w-full" />
                  ) : (
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Seleccionar cuenta" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {bankAccounts.map((account) => (
                          <SelectItem key={account.id} value={account.id}>
                            {account.bankName} — {account.accountNumber}
                            <span className="ml-2 text-muted-foreground text-xs">
                              ({formatCurrency(account.balance)})
                            </span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="date"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Fecha de Débito</FormLabel>
                  <FormControl>
                    <Input
                      type="date"
                      value={toDateInputValue(field.value)}
                      onChange={(e) => field.onChange(fromDateInputValue(e.target.value))}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
              <Button type="button" variant="outline" onClick={handleClose} disabled={isSubmitting}>
                Cancelar
              </Button>
              <Button type="submit" disabled={isSubmitting || loadingAccounts}>
                {isSubmitting ? 'Debitando...' : 'Debitar'}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
