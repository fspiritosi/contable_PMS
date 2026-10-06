'use client';

import { AlertTriangle } from 'lucide-react';

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
import { Textarea } from '@/shared/components/ui/textarea';

import { getModalCopy, type FundMovementModalMode } from '../../shared/view-mode';
import type {
  FundMovementAccountRef,
  FundMovementListItem,
  FundMovementPartnerOption,
  FundOption,
} from '../actions.server';
import { useFundMovementForm } from '../hooks/useFundMovementForm';
import { _FundMovementAmountDateFields } from './_FundMovementAmountDateFields';
import { _FundMovementFormFooter } from './_FundMovementFormFooter';
import { _FundMovementLinesField } from './_FundMovementLinesField';
import { _FundMovementTypeField } from './_FundMovementTypeField';
import { _FundSelectField } from './_FundSelectField';
import { _PartnerAccountNotice } from './_PartnerAccountNotice';
import { _PartnerSelectField } from './_PartnerSelectField';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  banks: FundOption[];
  cashRegisters: FundOption[];
  partners: FundMovementPartnerOption[];
  /** Cuenta de aportes por defecto (Ajustes contables); `null` si no está configurada (TSK-717). */
  defaultContributionsAccount: FundMovementAccountRef | null;
  /** Cuenta de gastos bancarios por defecto (Ajustes contables); `null` si no está configurada (TSK-718). */
  defaultBankChargesAccount: FundMovementAccountRef | null;
  /** Fuente de verdad del modo (antes se derivaba de `Boolean(movement)`). */
  mode: FundMovementModalMode;
  /** Requerido en 'edit' y 'view'. */
  movement?: FundMovementListItem | null;
  onSuccess: () => void;
}

export function _CreateFundMovementModal({
  open,
  onOpenChange,
  banks,
  cashRegisters,
  partners,
  defaultContributionsAccount,
  defaultBankChargesAccount,
  mode,
  movement,
  onSuccess,
}: Props) {
  const copy = getModalCopy(mode, movement?.status);
  const {
    form,
    lineAccounts,
    isContribution,
    isWithdrawal,
    isTransfer,
    isBankCharges,
    isPartnerMovement,
    isSubmitting,
    submit,
  } = useFundMovementForm({ open, mode, movement, onOpenChange, onSuccess });

  const noFundAccounts = banks.length === 0 && cashRegisters.length === 0;
  const partnerId = form.watch('partnerId');
  const selectedPartner = partners.find((p) => p.id === partnerId);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[560px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{copy.title}</DialogTitle>
          <DialogDescription>{copy.description}</DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form className="min-w-0 space-y-4">
            <_FundMovementTypeField />

            {noFundAccounts && (
              <div className="flex items-start gap-2 rounded-md border border-orange-500/50 bg-orange-500/10 p-3 text-sm text-orange-600">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  No hay cuentas bancarias ni cajas con sesión abierta disponibles. Creá una cuenta
                  bancaria o abrí una caja antes de registrar movimientos de fondos.
                </span>
              </div>
            )}

            <_FundMovementAmountDateFields showAmount={!isBankCharges} />

            {(isContribution || isTransfer) && (
              <_FundSelectField
                name="destinationFund"
                label={
                  isContribution ? 'Banco/caja donde ingresan los fondos *' : 'Banco/caja destino *'
                }
                banks={banks}
                cashRegisters={cashRegisters}
              />
            )}

            {(isWithdrawal || isTransfer || isBankCharges) && (
              <_FundSelectField
                name="sourceFund"
                label={
                  isWithdrawal || isBankCharges
                    ? 'Banco/caja de donde salen los fondos *'
                    : 'Banco/caja origen *'
                }
                banks={banks}
                cashRegisters={cashRegisters}
              />
            )}

            {isBankCharges && (
              <_FundMovementLinesField
                accounts={lineAccounts}
                defaultAccount={defaultBankChargesAccount}
              />
            )}

            {isPartnerMovement && <_PartnerSelectField partners={partners} />}

            {isPartnerMovement && (
              <_PartnerAccountNotice
                partner={selectedPartner}
                defaultAccount={defaultContributionsAccount}
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

            <_FundMovementFormFooter
              mode={mode}
              isSubmitting={isSubmitting}
              onCancel={() => onOpenChange(false)}
              onSubmit={(confirm) => void submit(confirm)}
            />
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
