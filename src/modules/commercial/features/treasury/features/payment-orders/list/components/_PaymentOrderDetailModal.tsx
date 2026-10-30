'use client';

import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/shared/components/ui/dialog';
import { Badge } from '@/shared/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card';
import { Skeleton } from '@/shared/components/ui/skeleton';
import { ArrowUp } from 'lucide-react';
import { getPaymentOrder } from '../../actions.server';
import { PAYMENT_ORDER_STATUS_LABELS, PAYMENT_ORDER_STATUS_BADGES, PAYMENT_METHOD_LABELS, BANK_MOVEMENT_TYPE_LABELS, WITHHOLDING_TAX_TYPE_LABELS } from '../../../../shared/validators';
import type { PaymentOrderWithDetails } from '../../../../shared/types';
import moment from 'moment';
import { logger } from '@/shared/lib/logger';
import { _DocumentAttachment } from '@/modules/commercial/shared/components/_DocumentAttachment';
import { jurisdictionLabel } from '@/modules/commercial/shared/convenio-multilateral';

interface PaymentOrderDetailModalProps {
  paymentOrderId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function PaymentOrderDetailModal({ paymentOrderId, open, onOpenChange }: PaymentOrderDetailModalProps) {
  const [paymentOrder, setPaymentOrder] = useState<PaymentOrderWithDetails | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open && paymentOrderId) {
      loadPaymentOrder();
    }
  }, [open, paymentOrderId]);

  const loadPaymentOrder = async () => {
    if (!paymentOrderId) return;

    setLoading(true);
    try {
      const data = await getPaymentOrder(paymentOrderId);
      setPaymentOrder(data);
    } catch (error) {
      logger.error('Error al cargar orden de pago', { data: { error } });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="md:min-w-[800px]">
        <DialogHeader>
          <DialogTitle>Detalle de Orden de Pago</DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="space-y-4">
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-40 w-full" />
            <Skeleton className="h-40 w-full" />
          </div>
        ) : paymentOrder ? (
          <div className="space-y-6">
            {/* Información General */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Información General</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm text-muted-foreground">Número</p>
                    <p className="font-medium">{paymentOrder.fullNumber}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Estado</p>
                    <Badge variant={PAYMENT_ORDER_STATUS_BADGES[paymentOrder.status]}>
                      {PAYMENT_ORDER_STATUS_LABELS[paymentOrder.status]}
                    </Badge>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Fecha</p>
                    <p className="font-medium">{moment(paymentOrder.date).format('DD/MM/YYYY')}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Total</p>
                    <p className="font-medium text-lg">
                      ${paymentOrder.totalAmount.toLocaleString('es-AR', { minimumFractionDigits: 2 })}
                    </p>
                  </div>
                </div>

                {paymentOrder.supplier && (
                  <div>
                    <p className="text-sm text-muted-foreground">Proveedor</p>
                    <p className="font-medium">
                      {paymentOrder.supplier.tradeName || paymentOrder.supplier.businessName}
                    </p>
                    {paymentOrder.supplier.taxId && (
                      <p className="text-sm text-muted-foreground">CUIT: {paymentOrder.supplier.taxId}</p>
                    )}
                  </div>
                )}

                {paymentOrder.notes && (
                  <div>
                    <p className="text-sm text-muted-foreground">Observaciones</p>
                    <p className="text-sm">{paymentOrder.notes}</p>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Items a Pagar */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Items a Pagar</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {paymentOrder.items.map((item) => (
                    <div key={item.id} className="flex justify-between items-center p-3 border rounded-lg">
                      <div>
                        {item.invoice ? (
                          <>
                            <p className="font-medium">{item.invoice.fullNumber}</p>
                            <p className="text-sm text-muted-foreground">
                              Factura - Total: ${item.invoice.total.toLocaleString('es-AR', { minimumFractionDigits: 2 })}
                            </p>
                          </>
                        ) : item.expense ? (
                          <>
                            <p className="font-medium">{item.expense.fullNumber}</p>
                            <p className="text-sm text-muted-foreground">
                              Gasto - {item.expense.description}
                            </p>
                          </>
                        ) : null}
                      </div>
                      <div className="text-right">
                        <p className="text-sm text-muted-foreground">Monto a pagar</p>
                        <p className="font-medium">
                          ${item.amount.toLocaleString('es-AR', { minimumFractionDigits: 2 })}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Formas de Pago */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Formas de Pago</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {paymentOrder.payments.map((payment) => {
                    let detail = '';
                    if (payment.cashRegister) {
                      detail = `Caja: ${payment.cashRegister.code} - ${payment.cashRegister.name}`;
                    } else if (payment.bankAccount) {
                      detail = `${payment.bankAccount.bankName} - ${payment.bankAccount.accountNumber}`;
                    } else if (payment.checkNumber) {
                      detail = `Cheque N° ${payment.checkNumber}`;
                    } else if (payment.cardLast4) {
                      detail = `Tarjeta **** ${payment.cardLast4}`;
                    } else if (payment.reference) {
                      detail = payment.reference;
                    }

                    return (
                      <div key={payment.id} className="flex justify-between items-center p-3 border rounded-lg">
                        <div>
                          <p className="font-medium">
                            {PAYMENT_METHOD_LABELS[payment.paymentMethod as keyof typeof PAYMENT_METHOD_LABELS]}
                          </p>
                          {detail && <p className="text-sm text-muted-foreground">{detail}</p>}
                        </div>
                        <div className="text-right">
                          <p className="font-medium">
                            ${payment.amount.toLocaleString('es-AR', { minimumFractionDigits: 2 })}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>

            {/* Retenciones Emitidas */}
            {paymentOrder.withholdings && paymentOrder.withholdings.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Retenciones Emitidas</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {paymentOrder.withholdings.map((w) => (
                      <div key={w.id} className="flex justify-between items-center p-3 border rounded-lg">
                        <div>
                          <p className="font-medium">
                            {WITHHOLDING_TAX_TYPE_LABELS[w.taxType as keyof typeof WITHHOLDING_TAX_TYPE_LABELS]}
                          </p>
                          <p className="text-sm text-muted-foreground">
                            Alícuota: {w.rate}%
                            {w.certificateNumber && ` | Cert. N° ${w.certificateNumber}`}
                            {w.regimeCode && ` | Régimen ${w.regimeCode}`}
                            {w.taxableBase !== null &&
                              ` | Base $${w.taxableBase.toLocaleString('es-AR', { minimumFractionDigits: 2 })}`}
                            {w.jurisdiction && ` | ${jurisdictionLabel(w.jurisdiction)}`}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="font-medium">
                            ${w.amount.toLocaleString('es-AR', { minimumFractionDigits: 2 })}
                          </p>
                        </div>
                      </div>
                    ))}
                    <div className="flex justify-between items-center p-3 bg-muted/50 rounded-lg">
                      <p className="font-medium">Total Retenciones</p>
                      <p className="font-bold">
                        ${paymentOrder.withholdings.reduce((sum, w) => sum + w.amount, 0).toLocaleString('es-AR', { minimumFractionDigits: 2 })}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Movimientos Bancarios Vinculados */}
            {paymentOrder.bankMovements && paymentOrder.bankMovements.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Movimientos Bancarios</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {paymentOrder.bankMovements.map((mov) => (
                      <div key={mov.id} className="flex justify-between items-center p-3 border rounded-lg">
                        <div className="flex items-center gap-2">
                          <ArrowUp className="h-4 w-4 text-red-600" />
                          <div>
                            <p className="font-medium">
                              {BANK_MOVEMENT_TYPE_LABELS[mov.type as keyof typeof BANK_MOVEMENT_TYPE_LABELS] || mov.type}
                            </p>
                            <p className="text-sm text-muted-foreground">
                              {mov.bankAccount.bankName} - {mov.bankAccount.accountNumber}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {moment(mov.date).format('DD/MM/YYYY')}
                            </p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="font-medium text-red-600">
                            -${Number(mov.amount).toLocaleString('es-AR', { minimumFractionDigits: 2 })}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Documento Adjunto */}
            <_DocumentAttachment
              documentType="payment-order"
              documentId={paymentOrder.id}
              companyId={paymentOrder.companyId}
              companyName={paymentOrder.company.name}
              documentNumber={paymentOrder.fullNumber}
              hasDocument={!!paymentOrder.documentUrl}
              documentUrl={paymentOrder.documentUrl}
            />
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
