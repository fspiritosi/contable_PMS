'use client';

import { AlertTriangle } from 'lucide-react';

import { _NoConceptsNotice } from '@/shared/components/common/_NoConceptsNotice';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog';
import { Form } from '@/shared/components/ui/form';
import { CONCEPT_USAGE_LABELS } from '@/shared/lib/concepts';
import { cn } from '@/shared/lib/utils';

import { conceptNamesById, getModalCopy, type FundMovementModalMode } from '../../shared/view-mode';
import type {
  FundMovementAccountRef,
  FundMovementConceptCatalog,
  FundMovementHoldingOption,
  FundMovementListItem,
  FundMovementPartnerOption,
  FundOption,
} from '../actions.server';
import { useFundMovementForm } from '../hooks/useFundMovementForm';
import { _FundMovementAmountDateFields } from './_FundMovementAmountDateFields';
import { _FundMovementDescriptionField } from './_FundMovementDescriptionField';
import { _FundMovementFormFooter } from './_FundMovementFormFooter';
import { _FundMovementInvestmentSection } from './_FundMovementInvestmentSection';
import { _FundMovementLinesField } from './_FundMovementLinesField';
import { _FundMovementPartnerSection } from './_FundMovementPartnerSection';
import { _FundMovementTypeField } from './_FundMovementTypeField';
import { _FundMovementViewSummary } from './_FundMovementViewSummary';
import { _FundSelectField } from './_FundSelectField';

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
  /** Conceptos activos por tipo (TSK-791); Gestión no ve la cuenta de ninguno. */
  concepts: FundMovementConceptCatalog;
  /** Tenencias abiertas para compra/venta de inversión (TSK-793). */
  holdings: FundMovementHoldingOption[];
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
  concepts,
  holdings,
  mode,
  movement,
  onSuccess,
}: Props) {
  const isView = mode === 'view';
  // Editar un movimiento confirmado: el guardado abre la propuesta de corrección (TSK-792).
  const isCorrection = mode === 'edit' && movement?.status === 'CONFIRMED';
  const copy = getModalCopy(mode, movement?.status);
  const {
    form,
    movementDetail,
    isContribution,
    isWithdrawal,
    isTransfer,
    isBankCharges,
    isInvestmentPurchase,
    isInvestmentSale,
    isPartnerMovement,
    isSubmitting,
    submit,
    correctionDialog,
  } = useFundMovementForm({ open, mode, movement, concepts, onOpenChange, onSuccess });

  const isInvestment = isInvestmentPurchase || isInvestmentSale;
  const noFundAccounts = banks.length === 0 && cashRegisters.length === 0;
  // TSK-791: gastos bancarios sin conceptos no se puede guardar ni confirmar.
  const noBankChargesConcepts = !isView && isBankCharges && concepts.BANK_CHARGES.length === 0;
  // Nombre guardado de cada concepto de línea, solo para la vista (puede estar desactivado).
  const lineConceptNames = isView ? conceptNamesById(movementDetail?.lines) : undefined;
  // D4: el snapshot guardado solo se ofrece en vista (en edición un fondo fuera
  // de catálogo terminaría en un error del servidor al guardar).
  const snapshot = (label: string | null | undefined) => (isView ? label : null);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[560px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{copy.title}</DialogTitle>
          <DialogDescription>
            {isCorrection
              ? 'Al revisar los cambios verás todo lo que se corrige (saldos, asiento y conciliación) antes de aplicarlo.'
              : copy.description}
          </DialogDescription>
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

              {isInvestment ? (
                <_FundMovementInvestmentSection
                  isSale={isInvestmentSale}
                  holdings={holdings}
                  banks={banks}
                  cashRegisters={cashRegisters}
                  isView={isView}
                  holdingSnapshot={snapshot(movement?.holdingName)}
                  fundSnapshot={snapshot(
                    isInvestmentSale ? movement?.fundInLabel : movement?.fundOutLabel
                  )}
                />
              ) : (
                <_FundMovementAmountDateFields showAmount={!isBankCharges} />
              )}

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
                  concepts={concepts.BANK_CHARGES}
                  conceptNames={lineConceptNames}
                  readOnly={isView}
                />
              )}

              {noBankChargesConcepts && (
                <_NoConceptsNotice usageLabel={CONCEPT_USAGE_LABELS.FUND_BANK_CHARGES} />
              )}

              {isPartnerMovement && (
                <_FundMovementPartnerSection
                  partners={partners}
                  defaultContributionsAccount={defaultContributionsAccount}
                  concepts={
                    concepts[isContribution ? 'PARTNER_CONTRIBUTION' : 'PARTNER_WITHDRAWAL']
                  }
                  isView={isView}
                  partnerSnapshot={snapshot(movement?.partnerName)}
                />
              )}

              <_FundMovementDescriptionField />
            </fieldset>

            <_FundMovementFormFooter
              mode={mode}
              isCorrection={isCorrection}
              isSubmitting={isSubmitting}
              submitDisabled={noBankChargesConcepts}
              onCancel={() => onOpenChange(false)}
              onSubmit={(confirm) => void submit(confirm)}
            />
          </form>
        </Form>
        {correctionDialog}
      </DialogContent>
    </Dialog>
  );
}
