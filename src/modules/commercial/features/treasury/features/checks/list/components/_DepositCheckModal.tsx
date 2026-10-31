'use client';

import { useCallback } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import moment from 'moment';
import {
  Dialog,
  DialogContent,
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
import { Button } from '@/shared/components/ui/button';
import { Skeleton } from '@/shared/components/ui/skeleton';
import { formatCurrency } from '@/shared/utils/formatters';
import { businessToday, fromDateInputValue, toDateInputValue } from '@/shared/utils/date-input';
import { depositCheckSchema, type DepositCheckFormData } from '../../../../shared/validators';
import { depositCheck, getActiveBankAccounts } from '../../actions.server';
import type { CheckListItem } from '../../../../shared/types';
import { notifyCheckActionResult } from '../check-action-result';

interface Props {
  check: CheckListItem;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Depositar un cheque de tercero en cartera. Un e-cheq ya registrado en un banco
 * (`lockedBankAccountId`, TSK-735) solo se deposita en esa cuenta: el selector queda fijo.
 */
export function _DepositCheckModal({ check, open, onOpenChange }: Props) {
  const router = useRouter();

  const form = useForm<DepositCheckFormData>({
    resolver: zodResolver(depositCheckSchema),
    defaultValues: {
      checkId: check.id,
      bankAccountId: check.lockedBankAccountId ?? '',
      depositDate: businessToday(),
    },
  });

  const { isSubmitting } = form.formState;

  const { data: bankAccounts = [], isLoading: loadingAccounts } = useQuery({
    queryKey: ['activeBankAccounts'],
    queryFn: getActiveBankAccounts,
    enabled: open,
  });

  const handleClose = useCallback(() => {
    form.reset({
      checkId: check.id,
      bankAccountId: check.lockedBankAccountId ?? '',
      depositDate: businessToday(),
    });
    onOpenChange(false);
  }, [form, check.id, check.lockedBankAccountId, onOpenChange]);

  const onSubmit = async (values: DepositCheckFormData) => {
    const result = await depositCheck(values);
    if (notifyCheckActionResult(result, 'Cheque depositado correctamente')) {
      handleClose();
      router.refresh();
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Depositar Cheque</DialogTitle>
        </DialogHeader>

        <div className="mb-2 rounded-md bg-muted p-3 text-sm">
          <p className="font-medium">Cheque N° {check.checkNumber}</p>
          <p className="text-muted-foreground">{check.bankName}</p>
          <p className="mt-1 text-lg font-bold">{formatCurrency(check.amount)}</p>
          <p className="text-muted-foreground">
            Vence: {moment(check.dueDate).format('DD/MM/YYYY')}
          </p>
        </div>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            {/* Cuenta bancaria destino */}
            <FormField
              control={form.control}
              name="bankAccountId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Cuenta Bancaria Destino</FormLabel>
                  {loadingAccounts ? (
                    <Skeleton className="h-10 w-full" />
                  ) : (
                    <Select
                      onValueChange={field.onChange}
                      value={field.value}
                      disabled={Boolean(check.lockedBankAccountId)}
                    >
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
                  {check.lockedBankAccountId && (
                    <FormDescription>
                      El e-cheq ya se registró en esta cuenta: solo se puede depositarlo acá.
                    </FormDescription>
                  )}
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Fecha de depósito */}
            <FormField
              control={form.control}
              name="depositDate"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Fecha de Depósito</FormLabel>
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

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={handleClose} disabled={isSubmitting}>
                Cancelar
              </Button>
              <Button type="submit" disabled={isSubmitting || loadingAccounts}>
                {isSubmitting ? 'Depositando...' : 'Depositar'}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
