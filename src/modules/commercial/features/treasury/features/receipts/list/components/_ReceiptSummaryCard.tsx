'use client';

import { AlertCircle } from 'lucide-react';

import { Alert, AlertDescription } from '@/shared/components/ui/alert';
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card';

import { receiptTotals, type ReceiptAmounts } from './receipt-form-utils';

const money = (value: number) =>
  `$${value.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

interface Props {
  values: ReceiptAmounts;
}

export function _ReceiptSummaryCard({ values }: Props) {
  const { totalItems, totalPayments, totalWithholdings, difference } = receiptTotals(values);
  const hasPayments = (values.payments ?? []).length > 0;
  const hasWithholdings = (values.withholdings ?? []).length > 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Resumen</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          <div className="flex justify-between">
            <span>Total Facturas:</span>
            <span className="font-medium">{money(totalItems)}</span>
          </div>
          {(hasPayments || hasWithholdings) && (
            <>
              {hasPayments && (
                <div className="flex justify-between">
                  <span>Total Pagos:</span>
                  <span className="font-medium">{money(totalPayments)}</span>
                </div>
              )}
              {hasWithholdings && (
                <div className="flex justify-between">
                  <span>Total Retenciones:</span>
                  <span className="font-medium">{money(totalWithholdings)}</span>
                </div>
              )}
              <div className="flex justify-between border-t pt-2">
                <span>Diferencia:</span>
                <span
                  className={`font-bold ${difference === 0 ? 'text-green-600' : 'text-red-600'}`}
                >
                  {money(Math.abs(difference))}
                </span>
              </div>
              {difference !== 0 && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>
                    El total de facturas debe ser igual al total de pagos + retenciones
                  </AlertDescription>
                </Alert>
              )}
            </>
          )}
          {!hasPayments && !hasWithholdings && (
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                Este recibo se guardará sin formas de pago. Podrá vincularlo a un movimiento
                bancario desde la conciliación.
              </AlertDescription>
            </Alert>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
