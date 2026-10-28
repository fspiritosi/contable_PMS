'use client';

import { useFormContext } from 'react-hook-form';

import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/shared/components/ui/form';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui/select';
import { formatCurrency } from '@/shared/utils/formatters';

import type { FundMovementFormInput } from '../../shared/validators';
import { formatNominals, withMovementHolding } from '../../shared/view-mode';
import type {
  FundMovementHoldingOption,
  FundMovementListItem,
  FundOption,
} from '../actions.server';
import { _FundMovementAmountDateFields } from './_FundMovementAmountDateFields';
import { _FundSelectField } from './_FundSelectField';
import { _InvestmentAmountFields } from './_InvestmentAmountFields';
import { _InvestmentCommissionFields } from './_InvestmentCommissionFields';

interface Props {
  isSale: boolean;
  holdings: FundMovementHoldingOption[];
  banks: FundOption[];
  cashRegisters: FundOption[];
  isView: boolean;
  /** Al ver o editar: su tenencia se ofrece aunque ya esté cerrada (`withMovementHolding`). */
  movement?: Pick<FundMovementListItem, 'holdingId' | 'holdingLabel' | 'holdingHasUnits'> | null;
  /** Solo en vista: etiqueta guardada del banco/caja (puede haberse desactivado). */
  fundSnapshot?: string | null;
}

/**
 * Campos de una compra o venta de inversión (TSK-793): banco/broker/caja, tenencia,
 * nominales y precio, importe y fecha, comisión y marca de venta total.
 */
export function _FundMovementInvestmentSection({
  isSale,
  holdings: catalog,
  banks,
  cashRegisters,
  isView,
  movement,
  fundSnapshot,
}: Props) {
  const { control, setValue, watch } = useFormContext<FundMovementFormInput>();
  const holdings = withMovementHolding(catalog, movement);
  const selectedHolding = holdings.find((h) => h.id === watch('holdingId'));
  // La compra con nominales y precio calcula el importe; sin unidades se carga directo.
  const amountIsComputed = !isSale && !isView && Boolean(selectedHolding?.hasUnits);

  const fundField = (
    <_FundSelectField
      name={isSale ? 'destinationFund' : 'sourceFund'}
      label={
        isSale
          ? 'Banco/broker/caja donde entra la plata *'
          : 'Banco/broker/caja de donde sale la plata *'
      }
      banks={banks}
      cashRegisters={cashRegisters}
      disabled={isView}
      snapshotLabel={fundSnapshot}
    />
  );

  const holdingField = (
    <FormField
      control={control}
      name="holdingId"
      render={({ field }) => {
        const selected = holdings.find((h) => h.id === field.value);
        return (
          <FormItem>
            <FormLabel>Tenencia *</FormLabel>
            <Select
              onValueChange={(value) => {
                field.onChange(value);
                // Una tenencia sin unidades no lleva nominales ni precio.
                if (!holdings.find((h) => h.id === value)?.hasUnits) {
                  setValue('nominals', '');
                  setValue('unitPrice', '');
                }
              }}
              value={field.value || undefined}
              disabled={isView}
            >
              <FormControl>
                <SelectTrigger>
                  <SelectValue placeholder="Seleccionar tenencia" />
                </SelectTrigger>
              </FormControl>
              <SelectContent>
                {holdings.map((h) => (
                  <SelectItem key={h.id} value={h.id}>
                    {h.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {isSale && selected && !selected.isClosed && !isView && (
              <p className="text-xs text-muted-foreground">
                Valor en libros: {formatCurrency(selected.bookValue)}
                {selected.nominals !== null && ` · Nominales: ${formatNominals(selected.nominals)}`}
              </p>
            )}
            {holdings.every((h) => h.isClosed) && !isView && (
              <p className="text-xs text-muted-foreground">
                No hay tenencias abiertas. Creá una en Inversiones antes de registrar la operación.
              </p>
            )}
            <FormMessage />
          </FormItem>
        );
      }}
    />
  );

  return (
    <>
      {isSale ? holdingField : fundField}
      {isSale ? fundField : holdingField}
      {selectedHolding?.hasUnits && <_InvestmentAmountFields isSale={isSale} />}
      <_FundMovementAmountDateFields
        showAmount
        amountReadOnly={amountIsComputed}
        amountLabel={isSale ? 'Importe cobrado (bruto) *' : undefined}
      />
      <_InvestmentCommissionFields isSale={isSale} />
    </>
  );
}
