'use client';

import type { Control } from 'react-hook-form';

import type { SupplierTaxCondition, VoucherType } from '@/generated/prisma/enums';
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/shared/components/ui/form';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/components/ui/select';
import { supplierTaxConditionLabels } from '@/shared/utils/mappers';

import type { PurchaseInvoiceFormInput } from '../../shared/validators';
import { VOUCHER_TYPE_LABELS } from '../../shared/validators';
import { allowedPurchaseVoucherTypes } from '../../shared/voucher-rules';

interface PurchaseVoucherTypeFieldProps {
  control: Control<PurchaseInvoiceFormInput>;
  /** Condición IVA del proveedor elegido: define las letras que se ofrecen (TSK-787). */
  taxCondition: SupplierTaxCondition | null | undefined;
}

/**
 * Tipo de comprobante de la factura de compra: solo las letras que corresponden a la condición IVA
 * del proveedor (Monotributista/Exento → C; Responsable Inscripto → A o B). Si el borrador ya tiene
 * una letra que no corresponde (cargado antes de TSK-787) se sigue mostrando, y el guardado lo
 * rechaza con el motivo.
 */
export function _PurchaseVoucherTypeField({ control, taxCondition }: PurchaseVoucherTypeFieldProps) {
  const allowed = allowedPurchaseVoucherTypes(taxCondition);

  return (
    <FormField
      control={control}
      name="voucherType"
      render={({ field }) => {
        const options = allowed.includes(field.value as VoucherType)
          ? allowed
          : [...(field.value ? [field.value as VoucherType] : []), ...allowed];
        return (
          <FormItem>
            <FormLabel>Tipo de Comprobante *</FormLabel>
            {/* `key`: al cambiar de proveedor cambian las opciones y el valor a la vez; sin remontar,
                el Select no muestra un valor que no estaba entre las opciones anteriores. */}
            <Select key={taxCondition ?? 'ALL'} onValueChange={field.onChange} value={field.value}>
              <FormControl>
                <SelectTrigger>
                  <SelectValue placeholder="Selecciona un tipo" />
                </SelectTrigger>
              </FormControl>
              <SelectContent>
                {options.map((value) => (
                  <SelectItem key={value} value={value}>
                    {VOUCHER_TYPE_LABELS[value]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {taxCondition && (
              <FormDescription>
                Proveedor {supplierTaxConditionLabels[taxCondition]}:{' '}
                {taxCondition === 'RESPONSABLE_INSCRIPTO' ? 'comprobantes A o B' : 'comprobantes C'}.
              </FormDescription>
            )}
            <FormMessage />
          </FormItem>
        );
      }}
    />
  );
}
