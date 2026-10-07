'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { ArrowRightLeft, Loader2, Building2, Wallet } from 'lucide-react';

import moment from 'moment';

import { Button } from '@/shared/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui/select';
import { ToggleGroup, ToggleGroupItem } from '@/shared/components/ui/toggle-group';
import { bankTransferSchema } from '../../../../shared/validators';
import {
  createBankTransfer,
  getBankAccountsForTransfer,
  getCashRegistersForTransfer,
} from '../../../bank-movements/actions.server';
import { formatCurrency } from '@/shared/utils/formatters';
import { logger } from '@/shared/lib/logger';
import { z } from 'zod';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  bankAccountId: string;
  onSuccess?: () => void;
}

type FormValues = z.input<typeof bankTransferSchema>;

interface BankAccountOption {
  id: string;
  bankName: string;
  accountNumber: string;
  accountType: string;
  balance: number;
}

interface CashRegisterOption {
  id: string;
  code: string;
  name: string;
  activeSessionId: string | null;
  currentBalance: number;
}

export function _BankTransferDialog({ open, onOpenChange, bankAccountId, onSuccess }: Props) {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [bankAccounts, setBankAccounts] = useState<BankAccountOption[]>([]);
  const [cashRegisters, setCashRegisters] = useState<CashRegisterOption[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const form = useForm<FormValues>({
    resolver: zodResolver(bankTransferSchema),
    defaultValues: {
      sourceBankAccountId: bankAccountId,
      destinationType: 'BANK',
      destinationBankAccountId: null,
      destinationCashRegisterId: null,
      amount: '',
      date: moment().hour(12).startOf('hour').toDate(), // mediodía local, como el onChange (TSK-760)
      description: '',
      reference: '',
    },
  });

  const destinationType = form.watch('destinationType');

  useEffect(() => {
    if (!open) return;

    setIsLoading(true);
    Promise.all([
      getBankAccountsForTransfer(bankAccountId),
      getCashRegistersForTransfer(),
    ])
      .then(([accounts, registers]) => {
        setBankAccounts(accounts);
        setCashRegisters(registers);
      })
      .catch((error) => {
        logger.error('Error al cargar datos para transferencia', { data: { error } });
        toast.error('Error al cargar datos');
      })
      .finally(() => setIsLoading(false));
  }, [open, bankAccountId]);

  useEffect(() => {
    form.setValue('destinationBankAccountId', null);
    form.setValue('destinationCashRegisterId', null);
  }, [destinationType, form]);

  const handleSubmit = async (values: FormValues) => {
    setIsSubmitting(true);
    try {
      const result = await createBankTransfer(values);
      if (!result.success) return void toast.error(result.error);
      toast.success('Transferencia realizada correctamente');
      form.reset();
      onOpenChange(false);
      onSuccess?.();
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Error al realizar la transferencia');
    } finally {
      setIsSubmitting(false);
    }
  };

  const cashRegistersWithSession = cashRegisters.filter((cr) => cr.activeSessionId);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ArrowRightLeft className="h-5 w-5" />
            Transferencia entre Cuentas
          </DialogTitle>
          <DialogDescription>
            Transfiere fondos a otra cuenta bancaria o a una caja
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <Form {...form}>
            <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="destinationType"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Tipo de destino</FormLabel>
                    <FormControl>
                      <ToggleGroup
                        type="single"
                        value={field.value}
                        onValueChange={(value) => {
                          if (value) field.onChange(value);
                        }}
                        className="justify-start"
                      >
                        <ToggleGroupItem value="BANK" className="gap-2">
                          <Building2 className="h-4 w-4" />
                          Cuenta Bancaria
                        </ToggleGroupItem>
                        <ToggleGroupItem value="CASH" className="gap-2">
                          <Wallet className="h-4 w-4" />
                          Caja
                        </ToggleGroupItem>
                      </ToggleGroup>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {destinationType === 'BANK' && (
                <FormField
                  control={form.control}
                  name="destinationBankAccountId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Cuenta destino</FormLabel>
                      <Select
                        onValueChange={field.onChange}
                        value={field.value || ''}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Seleccionar cuenta bancaria" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {bankAccounts.length === 0 ? (
                            <SelectItem value="__empty" disabled>
                              No hay otras cuentas bancarias activas
                            </SelectItem>
                          ) : (
                            bankAccounts.map((account) => (
                              <SelectItem key={account.id} value={account.id}>
                                <div className="flex items-center justify-between gap-4">
                                  <span>{account.bankName} - {account.accountNumber}</span>
                                  <span className="text-xs text-muted-foreground">
                                    {formatCurrency(account.balance)}
                                  </span>
                                </div>
                              </SelectItem>
                            ))
                          )}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}

              {destinationType === 'CASH' && (
                <FormField
                  control={form.control}
                  name="destinationCashRegisterId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Caja destino</FormLabel>
                      <Select
                        onValueChange={field.onChange}
                        value={field.value || ''}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Seleccionar caja" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {cashRegistersWithSession.length === 0 ? (
                            <SelectItem value="__empty" disabled>
                              No hay cajas con sesión abierta
                            </SelectItem>
                          ) : (
                            cashRegistersWithSession.map((cr) => (
                              <SelectItem key={cr.id} value={cr.id}>
                                <div className="flex items-center justify-between gap-4">
                                  <span>{cr.code} - {cr.name}</span>
                                  <span className="text-xs text-muted-foreground">
                                    {formatCurrency(cr.currentBalance)}
                                  </span>
                                </div>
                              </SelectItem>
                            ))
                          )}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="amount"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Monto</FormLabel>
                      <FormControl>
                        <Input
                          type="text"
                          inputMode="decimal"
                          placeholder="0.00"
                          {...field}
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
                      <FormLabel>Fecha</FormLabel>
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
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Descripción</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="Descripción de la transferencia"
                        rows={2}
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="reference"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Referencia (opcional)</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="Número de comprobante"
                        {...field}
                        value={field.value || ''}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="flex justify-end gap-2 pt-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => onOpenChange(false)}
                  disabled={isSubmitting}
                >
                  Cancelar
                </Button>
                <Button type="submit" disabled={isSubmitting}>
                  {isSubmitting ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Transfiriendo...
                    </>
                  ) : (
                    <>
                      <ArrowRightLeft className="mr-2 h-4 w-4" />
                      Transferir
                    </>
                  )}
                </Button>
              </div>
            </form>
          </Form>
        )}
      </DialogContent>
    </Dialog>
  );
}
