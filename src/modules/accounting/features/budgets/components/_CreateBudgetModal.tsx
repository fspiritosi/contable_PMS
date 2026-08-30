'use client';

import { useState, useMemo } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Check, ChevronsUpDown, Loader2, Divide } from 'lucide-react';
import moment from 'moment';

import { Button } from '@/shared/components/ui/button';
import { Input } from '@/shared/components/ui/input';
import { Label } from '@/shared/components/ui/label';
import { Textarea } from '@/shared/components/ui/textarea';
import { MoneyInput } from '@/shared/components/ui/money-input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/shared/components/ui/popover';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/shared/components/ui/command';
import {
  createBudgetSchema,
  type CreateBudgetInput,
} from '../validators';
import {
  getBudgetableAccounts,
  createBudget,
} from '../actions.server';
import { formatAmount } from '../../../shared/utils';

interface CreateBudgetModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  fiscalYear: number;
  fiscalYearStart: Date;
}

/**
 * Obtiene los labels de los 12 meses del ejercicio fiscal.
 * Ej: si fiscalYearStart es julio, retorna ['Julio', 'Agosto', ..., 'Junio'].
 */
function getFiscalMonthLabels(fiscalYearStart: Date): string[] {
  const startMonth = moment(fiscalYearStart).month(); // 0-based
  return Array.from({ length: 12 }, (_, i) =>
    moment()
      .month((startMonth + i) % 12)
      .format('MMMM')
  );
}

export function _CreateBudgetModal({
  open,
  onOpenChange,
  fiscalYear,
  fiscalYearStart,
}: CreateBudgetModalProps) {
  const queryClient = useQueryClient();
  const [accountPopoverOpen, setAccountPopoverOpen] = useState(false);
  const [distributeAmount, setDistributeAmount] = useState('');

  const monthLabels = useMemo(
    () => getFiscalMonthLabels(fiscalYearStart),
    [fiscalYearStart]
  );

  const { data: accounts, isLoading: isLoadingAccounts } = useQuery({
    queryKey: ['budgetable-accounts', fiscalYear],
    queryFn: () => getBudgetableAccounts(fiscalYear),
    enabled: open,
  });

  const form = useForm<CreateBudgetInput>({
    resolver: zodResolver(createBudgetSchema),
    defaultValues: {
      accountId: '',
      fiscalYear,
      monthlyAmounts: new Array(12).fill(0),
      notes: '',
    },
  });

  const watchedAmounts = form.watch('monthlyAmounts');
  const selectedAccountId = form.watch('accountId');

  const calculatedTotal = useMemo(() => {
    return (watchedAmounts ?? []).reduce(
      (sum: number, val: number) => sum + (Number(val) || 0),
      0
    );
  }, [watchedAmounts]);

  const selectedAccount = useMemo(() => {
    if (!accounts || !selectedAccountId) return null;
    return accounts.find((a) => a.id === selectedAccountId) ?? null;
  }, [accounts, selectedAccountId]);

  const createMutation = useMutation({
    mutationFn: (data: CreateBudgetInput) => createBudget(data),
    onSuccess: () => {
      toast.success('Presupuesto creado correctamente');
      queryClient.invalidateQueries({ queryKey: ['budgets'] });
      queryClient.invalidateQueries({
        queryKey: ['budgetable-accounts'],
      });
      handleClose();
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Error al crear el presupuesto');
    },
  });

  const handleClose = () => {
    form.reset({
      accountId: '',
      fiscalYear,
      monthlyAmounts: new Array(12).fill(0),
      notes: '',
    });
    setDistributeAmount('');
    onOpenChange(false);
  };

  const handleDistribute = () => {
    const total = Number(distributeAmount);
    if (isNaN(total) || total <= 0) {
      toast.error('Ingresa un monto valido para distribuir');
      return;
    }

    const perMonth = Math.round((total / 12) * 100) / 100;
    // Ajustar el ultimo mes para que la suma sea exacta
    const amounts = new Array(12).fill(perMonth);
    const diff = total - perMonth * 12;
    amounts[11] = Math.round((perMonth + diff) * 100) / 100;

    form.setValue('monthlyAmounts', amounts, { shouldValidate: true });
  };

  const onSubmit = (data: CreateBudgetInput) => {
    createMutation.mutate(data);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Nuevo Presupuesto</DialogTitle>
          <DialogDescription>
            Crea un presupuesto para una cuenta contable de resultado (Ingreso o
            Gasto) para el ejercicio fiscal {fiscalYear}.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
          {/* Account selector */}
          <div className="space-y-2">
            <Label>Cuenta contable</Label>
            <Popover
              open={accountPopoverOpen}
              onOpenChange={setAccountPopoverOpen}
            >
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  role="combobox"
                  aria-expanded={accountPopoverOpen}
                  className="w-full justify-between"
                  disabled={isLoadingAccounts}
                >
                  <span className="truncate">
                    {selectedAccount
                      ? `${selectedAccount.code} - ${selectedAccount.name}`
                      : isLoadingAccounts
                        ? 'Cargando cuentas...'
                        : 'Seleccionar cuenta...'}
                  </span>
                  <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[500px] p-0" align="start">
                <Command shouldFilter={true}>
                  <CommandInput placeholder="Buscar por codigo o nombre..." />
                  <CommandList>
                    <CommandEmpty>No se encontraron cuentas</CommandEmpty>
                    <CommandGroup>
                      {(accounts ?? []).map((account) => (
                        <CommandItem
                          key={account.id}
                          value={`${account.code} ${account.name}`}
                          onSelect={() => {
                            form.setValue('accountId', account.id, {
                              shouldValidate: true,
                            });
                            setAccountPopoverOpen(false);
                          }}
                        >
                          <div className="flex w-full items-center justify-between">
                            <span className="truncate">
                              {account.code} - {account.name}
                            </span>
                            <span className="ml-2 text-xs text-muted-foreground">
                              {account.type === 'EXPENSE'
                                ? 'Gasto'
                                : 'Ingreso'}
                            </span>
                          </div>
                          {selectedAccountId === account.id && (
                            <Check className="ml-2 h-4 w-4 shrink-0" />
                          )}
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
            {form.formState.errors.accountId && (
              <p className="text-sm text-destructive">
                {form.formState.errors.accountId.message}
              </p>
            )}
          </div>

          {/* Distribute evenly */}
          <div className="space-y-2">
            <Label>Distribuir uniformemente (opcional)</Label>
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <MoneyInput
                  placeholder="Monto total a distribuir"
                  value={distributeAmount}
                  onChange={(raw) => setDistributeAmount(raw)}
                />
              </div>
              <Button
                type="button"
                variant="outline"
                onClick={handleDistribute}
              >
                <Divide className="mr-2 h-4 w-4" />
                Distribuir en 12
              </Button>
            </div>
          </div>

          {/* Monthly amounts grid */}
          <div className="space-y-2">
            <Label>Montos mensuales</Label>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
              {monthLabels.map((label, index) => (
                <div key={index} className="space-y-1">
                  <Label className="text-xs text-muted-foreground capitalize">
                    {label}
                  </Label>
                  <Controller
                    control={form.control}
                    name={`monthlyAmounts.${index}`}
                    render={({ field }) => (
                      <MoneyInput
                        placeholder="0,00"
                        value={field.value ?? ''}
                        onChange={(raw) => field.onChange(raw === '' ? undefined : Number(raw))}
                        onBlur={field.onBlur}
                        name={field.name}
                        ref={field.ref}
                      />
                    )}
                  />
                  {form.formState.errors.monthlyAmounts?.[index] && (
                    <p className="text-xs text-destructive">
                      {form.formState.errors.monthlyAmounts[index]?.message}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Total calculated */}
          <div className="flex items-center justify-between rounded-md border bg-muted/50 px-4 py-3">
            <span className="text-sm font-medium">Total Presupuestado</span>
            <span className="text-lg font-bold">
              {formatAmount(calculatedTotal)}
            </span>
          </div>

          {/* Notes */}
          <div className="space-y-2">
            <Label>Notas (opcional)</Label>
            <Textarea
              placeholder="Observaciones sobre este presupuesto..."
              rows={3}
              {...form.register('notes')}
            />
            {form.formState.errors.notes && (
              <p className="text-sm text-destructive">
                {form.formState.errors.notes.message}
              </p>
            )}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={handleClose}
              disabled={createMutation.isPending}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={createMutation.isPending}>
              {createMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Guardando...
                </>
              ) : (
                'Guardar Presupuesto'
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
