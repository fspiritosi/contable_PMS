'use client';

import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { Loader2, AlertTriangle } from 'lucide-react';
import moment from 'moment';

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
import { MoneyInput } from '@/shared/components/ui/money-input';
import { Textarea } from '@/shared/components/ui/textarea';
import { Button } from '@/shared/components/ui/button';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui/select';
import {
  fundMovementSchema,
  FUND_MOVEMENT_TYPE_LABELS,
  FUND_MOVEMENT_TYPES,
  type FundMovementFormInput,
  type FundMovementTypeValue,
} from '../../shared/validators';
import {
  createFundMovement,
  updateFundMovement,
  confirmFundMovement,
  type FundOption,
  type FundMovementPartnerOption,
  type FundMovementListItem,
} from '../actions.server';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  banks: FundOption[];
  cashRegisters: FundOption[];
  partners: FundMovementPartnerOption[];
  hasContributionsAccount: boolean;
  movement?: FundMovementListItem | null; // presente = modo edición
  onSuccess: () => void;
}

const NONE = '__none__';

function fundRefFrom(kind: string | null, id: string | null): string {
  return kind && id ? `${kind}:${id}` : '';
}

export function _CreateFundMovementModal({
  open,
  onOpenChange,
  banks,
  cashRegisters,
  partners,
  hasContributionsAccount,
  movement,
  onSuccess,
}: Props) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isEdit = Boolean(movement);

  const form = useForm<FundMovementFormInput>({
    resolver: zodResolver(fundMovementSchema),
    defaultValues: {
      type: 'PARTNER_CONTRIBUTION',
      date: moment().format('YYYY-MM-DD'),
      amount: '',
      description: '',
      sourceFund: '',
      destinationFund: '',
      partnerId: '',
    },
  });

  // Al abrir en modo edición, precargar los datos del movimiento
  useEffect(() => {
    if (open && movement) {
      form.reset({
        type: movement.type as FundMovementTypeValue,
        date: moment(movement.date).format('YYYY-MM-DD'),
        amount: String(movement.amount),
        description: movement.description,
        sourceFund: fundRefFrom(movement.fundOutKind, movement.fundOutId),
        destinationFund: fundRefFrom(movement.fundInKind, movement.fundInId),
        partnerId: movement.partnerId ?? '',
      });
    } else if (open && !movement) {
      form.reset({
        type: 'PARTNER_CONTRIBUTION',
        date: moment().format('YYYY-MM-DD'),
        amount: '',
        description: '',
        sourceFund: '',
        destinationFund: '',
        partnerId: '',
      });
    }
  }, [open, movement, form]);

  const type = form.watch('type') as FundMovementTypeValue;
  const isContribution = type === 'PARTNER_CONTRIBUTION';
  const isWithdrawal = type === 'PARTNER_WITHDRAWAL';
  const isTransfer = type === 'ACCOUNT_TRANSFER';
  const isPartnerMovement = isContribution || isWithdrawal;
  const noFundAccounts = banks.length === 0 && cashRegisters.length === 0;

  const persist = async (data: FundMovementFormInput, confirm: boolean) => {
    setIsSubmitting(true);
    try {
      if (isEdit && movement) {
        await updateFundMovement(movement.id, data);
        if (confirm) await confirmFundMovement(movement.id);
        toast.success(confirm ? 'Movimiento confirmado' : 'Borrador actualizado');
      } else {
        await createFundMovement(data, confirm);
        toast.success(confirm ? 'Movimiento confirmado' : 'Borrador guardado');
      }
      onOpenChange(false);
      onSuccess();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Error al guardar el movimiento');
    } finally {
      setIsSubmitting(false);
    }
  };

  const submit = (confirm: boolean) => form.handleSubmit((data) => persist(data, confirm))();

  const renderFundOptions = () => (
    <>
      {banks.length > 0 && (
        <SelectGroup>
          <SelectLabel>Bancos</SelectLabel>
          {banks.map((b) => (
            <SelectItem key={`BANK:${b.id}`} value={`BANK:${b.id}`}>
              {b.label}
            </SelectItem>
          ))}
        </SelectGroup>
      )}
      {cashRegisters.length > 0 && (
        <SelectGroup>
          <SelectLabel>Cajas</SelectLabel>
          {cashRegisters.map((c) => (
            <SelectItem key={`CASH:${c.id}`} value={`CASH:${c.id}`}>
              {c.label}
            </SelectItem>
          ))}
        </SelectGroup>
      )}
    </>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[560px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Editar Movimiento de Fondos' : 'Nuevo Movimiento de Fondos'}</DialogTitle>
          <DialogDescription>
            Se guarda como borrador editable. Al confirmarlo, actualiza el saldo del banco/caja y
            genera el asiento contable.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form className="space-y-4">
            <FormField
              control={form.control}
              name="type"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Tipo de movimiento *</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {FUND_MOVEMENT_TYPES.map((t) => (
                        <SelectItem key={t} value={t}>
                          {FUND_MOVEMENT_TYPE_LABELS[t]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            {noFundAccounts && (
              <div className="flex items-start gap-2 rounded-md border border-orange-500/50 bg-orange-500/10 p-3 text-sm text-orange-600">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  No hay cuentas bancarias ni cajas con sesión abierta disponibles. Creá una cuenta
                  bancaria o abrí una caja antes de registrar movimientos de fondos.
                </span>
              </div>
            )}

            {isPartnerMovement && !hasContributionsAccount && (
              <div className="flex items-start gap-2 rounded-md border border-orange-500/50 bg-orange-500/10 p-3 text-sm text-orange-600">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  Para confirmar aportes o retiros, configurá primero la &quot;Cuenta de aportes de
                  socios&quot; en Ajustes contables.
                </span>
              </div>
            )}

            <div className="grid gap-4 md:grid-cols-2">
              <FormField
                control={form.control}
                name="amount"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Monto *</FormLabel>
                    <FormControl>
                      <MoneyInput
                        placeholder="0,00"
                        value={field.value}
                        onChange={field.onChange}
                        onBlur={field.onBlur}
                        name={field.name}
                        ref={field.ref}
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
                    <FormLabel>Fecha *</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {(isContribution || isTransfer) && (
              <FormField
                control={form.control}
                name="destinationFund"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      {isContribution ? 'Banco/caja donde ingresan los fondos *' : 'Banco/caja destino *'}
                    </FormLabel>
                    <Select onValueChange={field.onChange} value={field.value || undefined}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Seleccionar banco o caja" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>{renderFundOptions()}</SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            {(isWithdrawal || isTransfer) && (
              <FormField
                control={form.control}
                name="sourceFund"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      {isWithdrawal ? 'Banco/caja de donde salen los fondos *' : 'Banco/caja origen *'}
                    </FormLabel>
                    <Select onValueChange={field.onChange} value={field.value || undefined}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Seleccionar banco o caja" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>{renderFundOptions()}</SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            {isPartnerMovement && (
              <FormField
                control={form.control}
                name="partnerId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Socio (opcional)</FormLabel>
                    <Select
                      onValueChange={(v) => field.onChange(v === NONE ? '' : v)}
                      value={field.value || NONE}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Sin socio" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value={NONE}>Sin socio</SelectItem>
                        {partners.map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Descripción *</FormLabel>
                  <FormControl>
                    <Textarea placeholder="Concepto del movimiento" rows={2} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter className="gap-2 sm:gap-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
                Cancelar
              </Button>
              <Button type="button" variant="secondary" onClick={() => submit(false)} disabled={isSubmitting}>
                {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Guardar
              </Button>
              <Button type="button" onClick={() => submit(true)} disabled={isSubmitting}>
                {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Guardar y Confirmar
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
