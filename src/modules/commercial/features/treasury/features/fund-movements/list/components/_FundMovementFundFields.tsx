'use client';

import type { FundMovementTypeValue } from '../../shared/validators';
import type { FundOption } from '../actions.server';
import { _FundSelectField } from './_FundSelectField';

interface Props {
  type: FundMovementTypeValue;
  banks: FundOption[];
  cashRegisters: FundOption[];
  isView: boolean;
  /** Solo en vista: `fundInLabel` / `fundOutLabel` guardados. */
  destinationSnapshot?: string | null;
  sourceSnapshot?: string | null;
}

/** Destino y/u origen de aporte, retiro, transferencia y gastos bancarios. */
export function _FundMovementFundFields({
  type,
  banks,
  cashRegisters,
  isView,
  destinationSnapshot,
  sourceSnapshot,
}: Props) {
  const isContribution = type === 'PARTNER_CONTRIBUTION';
  const isWithdrawal = type === 'PARTNER_WITHDRAWAL';
  const isTransfer = type === 'ACCOUNT_TRANSFER';
  const isBankCharges = type === 'BANK_CHARGES';

  return (
    <>
      {(isContribution || isTransfer) && (
        <_FundSelectField
          name="destinationFund"
          label={
            isContribution ? 'Banco/caja donde ingresan los fondos *' : 'Banco/caja destino *'
          }
          banks={banks}
          cashRegisters={cashRegisters}
          disabled={isView}
          snapshotLabel={destinationSnapshot}
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
          snapshotLabel={sourceSnapshot}
        />
      )}
    </>
  );
}
