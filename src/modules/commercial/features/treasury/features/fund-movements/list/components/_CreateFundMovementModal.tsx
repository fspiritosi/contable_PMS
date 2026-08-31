'use client';

import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
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
  formatFundMovementDate,
  FUND_MOVEMENT_TYPE_LABELS,
  FUND_MOVEMENT_TYPES,
  type FundMovementFormInput,
  type FundMovementTypeValue,
} from '../../shared/validators';
import {
  createFundMovement,
  updateFundMovement,
  confirmFundMovement,
  getFundMovementById,
  getFundMovementLineAccounts,
  type FundMovementActionResult,
  type FundOption,
  type FundMovementPartnerOption,
  type FundMovementListItem,
} from '../actions.server';
import { _FundMovementLinesField } from './_FundMovementLinesField';

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
      lines: [],
    },
  });

  // Conceptos del movimiento en edición: solo BANK_CHARGES los tiene, y el
  // listado (`movement`) no los trae. Se buscan aparte para no cargar la
  // relación en el listado de los otros tres tipos, que no la usan.
  const { data: movementDetail } = useQuery({
    queryKey: ['fund-movement-detail', movement?.id],
    queryFn: () => getFundMovementById(movement!.id),
    enabled: open && Boolean(movement) && movement?.type === 'BANK_CHARGES',
  });

  // Cuentas imputables para los conceptos (egreso o activo, TSK-579): siempre
  // se piden con el modal abierto, para tenerlas listas apenas se elige el
  // tipo "Gastos e impuestos bancarios".
  const { data: lineAccounts = [] } = useQuery({
    queryKey: ['fund-movement-line-accounts'],
    queryFn: getFundMovementLineAccounts,
    enabled: open,
  });

  // Al abrir en modo edición, precargar los datos del movimiento
  useEffect(() => {
    if (open && movement) {
      form.reset({
        type: movement.type as FundMovementTypeValue,
        // UTC: la fecha se guarda anclada a mediodía UTC, leerla en local la corría un día (TSK-483)
        date: formatFundMovementDate(movement.date, 'YYYY-MM-DD'),
        amount: String(movement.amount),
        description: movement.description,
        sourceFund: fundRefFrom(movement.fundOutKind, movement.fundOutId),
        destinationFund: fundRefFrom(movement.fundInKind, movement.fundInId),
        partnerId: movement.partnerId ?? '',
        lines:
          movement.type === 'BANK_CHARGES' && movementDetail
            ? movementDetail.lines.map((line) => ({
                accountId: line.accountId,
                description: line.description,
                amount: String(line.amount),
              }))
            : [],
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
        lines: [],
      });
    }
  }, [open, movement, movementDetail, form]);

  const type = form.watch('type') as FundMovementTypeValue;
  const isContribution = type === 'PARTNER_CONTRIBUTION';
  const isWithdrawal = type === 'PARTNER_WITHDRAWAL';
  const isTransfer = type === 'ACCOUNT_TRANSFER';
  const isBankCharges = type === 'BANK_CHARGES';
  const isPartnerMovement = isContribution || isWithdrawal;
  const noFundAccounts = banks.length === 0 && cashRegisters.length === 0;

  // Al cambiar el tipo de movimiento, los campos que dejan de aplicar no
  // pueden quedar colgados en el formulario: los conceptos se mandarían con
  // un tipo que no los usa, y un destino suelto de un tipo anterior se
  // resolvería igual en el servidor porque no depende de qué campos se
  // muestran en pantalla (TSK-585).
  //
  // "amount" no se toca acá: el schema lo dejó sin ninguna validación para
  // BANK_CHARGES (ni requerido, ni formato, ni "> 0"), así que un valor
  // viejo en ese campo oculto no rompe nada y no hace falta pisarlo con un
  // sentinela. El servidor igual lo ignora y calcula el importe sumando los
  // conceptos (`resolveMovementAmount`). Esto también evita que este efecto
  // le gane al `reset` de más arriba cuando se reabre un borrador
  // BANK_CHARGES para editar: antes, los dos escribían "amount" sin saber
  // uno del otro y el importe que acababa de cargar el reset (el real,
  // útil para mostrarlo si se vuelve a otro tipo) se perdía.
  useEffect(() => {
    if (!isBankCharges) {
      if (form.getValues('lines')?.length) form.setValue('lines', []);
    } else if (form.getValues('destinationFund')) {
      form.setValue('destinationFund', '');
    }
  }, [isBankCharges, form]);

  const persist = async (data: FundMovementFormInput, confirm: boolean) => {
    setIsSubmitting(true);
    try {
      let result: FundMovementActionResult;

      if (isEdit && movement) {
        result = await updateFundMovement(movement.id, data);
        if (result.success && confirm) {
          result = await confirmFundMovement(movement.id);
        }
      } else {
        result = await createFundMovement(data, confirm);
      }

      // Los errores esperables llegan como dato con su mensaje real: en producción
      // una excepción del server action se ve como un digest ilegible (TSK-481).
      if (!result.success) {
        toast.error(result.error);
        return;
      }

      toast.success(
        confirm ? 'Movimiento confirmado' : isEdit ? 'Borrador actualizado' : 'Borrador guardado'
      );
      onOpenChange(false);
      onSuccess();
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
          <form className="min-w-0 space-y-4">
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

            {isBankCharges ? (
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
            ) : (
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
            )}

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

            {(isWithdrawal || isTransfer || isBankCharges) && (
              <FormField
                control={form.control}
                name="sourceFund"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      {isWithdrawal || isBankCharges
                        ? 'Banco/caja de donde salen los fondos *'
                        : 'Banco/caja origen *'}
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

            {isBankCharges && <_FundMovementLinesField accounts={lineAccounts} />}

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
