'use client';

import { AlertTriangle } from 'lucide-react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog';
import { Form } from '@/shared/components/ui/form';
import { cn } from '@/shared/lib/utils';

import { getModalCopy, type FundMovementModalMode } from '../../shared/view-mode';
import type {
  FundMovementAccountRef,
  FundMovementListItem,
  FundMovementPartnerOption,
  FundOption,
} from '../actions.server';
import { useFundMovementForm } from '../hooks/useFundMovementForm';
import { _FundMovementAmountDateFields } from './_FundMovementAmountDateFields';
import { _FundMovementDescriptionField } from './_FundMovementDescriptionField';
import { _FundMovementFormFooter } from './_FundMovementFormFooter';
import { _FundMovementLinesField } from './_FundMovementLinesField';
import { _FundMovementTypeField } from './_FundMovementTypeField';
import { _FundMovementViewSummary } from './_FundMovementViewSummary';
import { _FundSelectField } from './_FundSelectField';
import { _PartnerAccountNotice } from './_PartnerAccountNotice';
import { _PartnerSelectField } from './_PartnerSelectField';

/**
 * Vista (TSK-720a, D2): los controles van `disabled` pero el texto se lee al
 * 100 %. Con `!` (Tailwind v4) porque `.x :disabled` y
 * `.disabled\:opacity-50:disabled` empatan en especificidad y ganaría el orden
 * del CSS generado.
 */
const READ_ONLY_FIELDSET = '[&_:disabled]:opacity-100! [&_:disabled]:cursor-default!';

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
  const isView = mode === 'view';
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
  // D4: el snapshot guardado solo se ofrece en vista (en edición un fondo fuera
  // de catálogo terminaría en un error del servidor al guardar).
  const snapshot = (label: string | null | undefined) => (isView ? label : null);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[560px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{copy.title}</DialogTitle>
          <DialogDescription>{copy.description}</DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form className="min-w-0 space-y-4">
            {isView && movement && <_FundMovementViewSummary movement={movement} />}

            {/* `min-w-0`: el `min-inline-size: min-content` por defecto del fieldset
                podría volver a desbordar en mobile (TSK-726). Radix Select y el
                combobox reciben además `disabled` explícito: el fieldset no los frena. */}
            <fieldset
              disabled={isView}
              className={cn('min-w-0 space-y-4', isView && READ_ONLY_FIELDSET)}
            >
              <_FundMovementTypeField disabled={isView} />

              {!isView && noFundAccounts && (
                <div className="flex items-start gap-2 rounded-md border border-orange-500/50 bg-orange-500/10 p-3 text-sm text-orange-600">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>
                    No hay cuentas bancarias ni cajas con sesión abierta disponibles. Creá una
                    cuenta bancaria o abrí una caja antes de registrar movimientos de fondos.
                  </span>
                </div>
              )}

              <_FundMovementAmountDateFields showAmount={!isBankCharges} />

              {(isContribution || isTransfer) && (
                <_FundSelectField
                  name="destinationFund"
                  label={
                    isContribution
                      ? 'Banco/caja donde ingresan los fondos *'
                      : 'Banco/caja destino *'
                  }
                  banks={banks}
                  cashRegisters={cashRegisters}
                  disabled={isView}
                  snapshotLabel={snapshot(movement?.fundInLabel)}
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
                  disabled={isView}
                  snapshotLabel={snapshot(movement?.fundOutLabel)}
                />
              )}

              {isBankCharges && (
                <_FundMovementLinesField
                  accounts={lineAccounts}
                  defaultAccount={defaultBankChargesAccount}
                  readOnly={isView}
                />
              )}

              {isPartnerMovement && (
                <_PartnerSelectField
                  partners={partners}
                  disabled={isView}
                  snapshotLabel={snapshot(movement?.partnerName)}
                />
              )}

              {isPartnerMovement && !isView && (
                <_PartnerAccountNotice
                  partner={selectedPartner}
                  defaultAccount={defaultContributionsAccount}
                />
              )}

              <_FundMovementDescriptionField />
            </fieldset>

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
