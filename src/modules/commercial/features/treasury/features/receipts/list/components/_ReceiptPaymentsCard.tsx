'use client';

import { AlertCircle, Plus } from 'lucide-react';
import { useFieldArray } from 'react-hook-form';

import { Alert, AlertDescription } from '@/shared/components/ui/alert';
import { Button } from '@/shared/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/shared/components/ui/card';
import { businessToday } from '@/shared/utils/date-input';

import { _ReceiptPaymentRow } from './_ReceiptPaymentRow';
import type {
  AvailableBankAccount,
  AvailableCashRegister,
  ReceiptForm,
} from './receipt-form-utils';

interface Props {
  form: ReceiptForm;
  cashRegisters: AvailableCashRegister[];
  bankAccounts: AvailableBankAccount[];
}

export function _ReceiptPaymentsCard({ form, cashRegisters, bankAccounts }: Props) {
  const { fields, append, remove } = useFieldArray({ control: form.control, name: 'payments' });

  const addPaymentMethod = () => {
    append({
      paymentMethod: 'CASH',
      amount: '',
      cashRegisterId: null,
      bankAccountId: null,
      checkNumber: null,
      cardLast4: null,
      reference: null,
      // Metadata de cheque/e-cheq: fecha de emisión por defecto = fecha del recibo
      checkBankName: null,
      checkIssueDate: form.getValues('date') ?? businessToday(),
      checkDueDate: null,
      checkDrawerName: null,
      checkDrawerTaxId: null,
    });
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle className="text-base">Formas de Pago</CardTitle>
            <CardDescription>Agregue las formas de pago utilizadas</CardDescription>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={addPaymentMethod}>
            <Plus className="mr-2 h-4 w-4" />
            Agregar Pago
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {fields.length === 0 && (
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              Sin formas de pago — el recibo podrá vincularse a un movimiento bancario existente
            </AlertDescription>
          </Alert>
        )}

        {fields.map((field, index) => (
          <_ReceiptPaymentRow
            key={field.id}
            form={form}
            index={index}
            onRemove={() => remove(index)}
            cashRegisters={cashRegisters}
            bankAccounts={bankAccounts}
          />
        ))}
      </CardContent>
    </Card>
  );
}
