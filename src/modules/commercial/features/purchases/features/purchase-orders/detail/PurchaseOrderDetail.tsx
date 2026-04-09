import { getPurchaseOrderById } from '../list/actions.server';
import { PermissionGuard } from '@/shared/components/common/PermissionGuard';
import { Button } from '@/shared/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card';
import { Badge } from '@/shared/components/ui/badge';
import { Pencil, Plus } from 'lucide-react';
import { BackButton } from '@/shared/components/common/BackButton';
import Link from 'next/link';
import moment from 'moment';
import {
  PURCHASE_ORDER_STATUS_LABELS,
  PURCHASE_ORDER_STATUS_VARIANTS,
  PURCHASE_ORDER_INVOICING_STATUS_LABELS,
  PURCHASE_ORDER_INVOICING_STATUS_VARIANTS,
} from '../shared/validators';
import type { PurchaseOrderStatus, PurchaseOrderInvoicingStatus } from '@/generated/prisma/enums';
import { PURCHASE_INVOICE_STATUS_LABELS } from '../../invoices/shared/validators';
import { cn } from '@/shared/lib/utils';
import { formatCurrency } from '@/shared/utils/formatters';
import { _PurchaseOrderActions } from './components/_PurchaseOrderActions';
import { _InstallmentsTable } from './components/_InstallmentsTable';
import { _PurchaseOrderPDFButton } from './components/_PurchaseOrderPDFButton';

interface Props {
  orderId: string;
}

export async function PurchaseOrderDetail({ orderId }: Props) {
  const order = await getPurchaseOrderById(orderId);

  const status = order.status as PurchaseOrderStatus;
  const statusVariant = PURCHASE_ORDER_STATUS_VARIANTS[status];
  const isDraft = status === 'DRAFT';
  const canDownloadPDF = !isDraft && status !== 'PENDING_APPROVAL' && status !== 'CANCELLED';

  return (
    <PermissionGuard module="commercial.purchase-orders" action="view" redirect>
      <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <BackButton variant="outline" />
          <div>
            <h1 className="text-3xl font-bold tracking-tight">
              {order.fullNumber}
            </h1>
            <p className="text-muted-foreground">Orden de Compra</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isDraft && (
            <Button variant="outline" asChild>
              <Link href={`/dashboard/commercial/purchase-orders/${orderId}/edit`}>
                <Pencil className="mr-2 h-4 w-4" />
                Editar
              </Link>
            </Button>
          )}
          {canDownloadPDF && (
            <_PurchaseOrderPDFButton order={order} />
          )}
          <_PurchaseOrderActions orderId={order.id} status={status} fullNumber={order.fullNumber} />
          <Badge
            variant={statusVariant}
            className={cn(
              'text-sm px-3 py-1',
              status === 'APPROVED' && 'bg-green-600 hover:bg-green-700'
            )}
          >
            {PURCHASE_ORDER_STATUS_LABELS[status]}
          </Badge>
          {order.invoicingStatus !== 'NOT_INVOICED' && (
            <Badge
              variant={PURCHASE_ORDER_INVOICING_STATUS_VARIANTS[order.invoicingStatus as PurchaseOrderInvoicingStatus]}
              className="text-sm px-3 py-1"
            >
              {PURCHASE_ORDER_INVOICING_STATUS_LABELS[order.invoicingStatus as PurchaseOrderInvoicingStatus]}
            </Badge>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Columna Principal */}
        <div className="lg:col-span-2 space-y-6">
          {/* Datos del Proveedor */}
          <Card>
            <CardHeader>
              <CardTitle>Proveedor</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-muted-foreground">Razón Social</p>
                  <p className="font-medium">{order.supplier.businessName}</p>
                  {order.supplier.tradeName && (
                    <p className="text-sm text-muted-foreground">{order.supplier.tradeName}</p>
                  )}
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">CUIT</p>
                  <p className="font-mono">{order.supplier.taxId}</p>
                </div>
                {order.supplier.address && (
                  <div>
                    <p className="text-sm text-muted-foreground">Dirección</p>
                    <p>{order.supplier.address}</p>
                  </div>
                )}
                {order.supplier.phone && (
                  <div>
                    <p className="text-sm text-muted-foreground">Teléfono</p>
                    <p>{order.supplier.phone}</p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Líneas */}
          <Card>
            <CardHeader>
              <CardTitle>Productos / Servicios</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-2 pr-4">Descripción</th>
                      <th className="text-right py-2 px-4">Cantidad</th>
                      <th className="text-right py-2 px-4">Costo Unit.</th>
                      <th className="text-right py-2 px-4">IVA %</th>
                      <th className="text-right py-2 px-4">Subtotal</th>
                      <th className="text-right py-2 pl-4">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {order.lines.map((line) => (
                      <tr key={line.id} className="border-b last:border-0">
                        <td className="py-2 pr-4">
                          <div>
                            <p className="font-medium">{line.description}</p>
                            {line.product && (
                              <p className="text-xs text-muted-foreground font-mono">
                                [{line.product.code}] {line.product.name}
                              </p>
                            )}
                          </div>
                        </td>
                        <td className="text-right py-2 px-4 font-mono">
                          {line.quantity}
                          {line.receivedQty > 0 && (
                            <span className="block text-xs text-muted-foreground">
                              Recibido: {line.receivedQty}/{line.quantity}
                            </span>
                          )}
                          {line.invoicedQty > 0 && (
                            <span className="block text-xs text-muted-foreground">
                              Facturado: {line.invoicedQty}/{line.quantity}
                            </span>
                          )}
                        </td>
                        <td className="text-right py-2 px-4 font-mono">{formatCurrency(line.unitCost)}</td>
                        <td className="text-right py-2 px-4 font-mono">{line.vatRate}%</td>
                        <td className="text-right py-2 px-4 font-mono">{formatCurrency(line.subtotal)}</td>
                        <td className="text-right py-2 pl-4 font-mono font-semibold">{formatCurrency(line.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Totales */}
              <div className="flex justify-end mt-4 pt-4 border-t">
                <div className="space-y-1 text-right font-mono text-sm">
                  <div className="flex justify-between gap-8">
                    <span className="text-muted-foreground">Subtotal:</span>
                    <span>{formatCurrency(order.subtotal)}</span>
                  </div>
                  <div className="flex justify-between gap-8">
                    <span className="text-muted-foreground">IVA:</span>
                    <span>{formatCurrency(order.vatAmount)}</span>
                  </div>
                  <div className="flex justify-between gap-8 text-lg font-bold">
                    <span>Total:</span>
                    <span>{formatCurrency(order.total)}</span>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Cuotas / Entregas */}
          {order.installments.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Cuotas / Entregas</CardTitle>
              </CardHeader>
              <CardContent>
                <_InstallmentsTable
                  installments={order.installments}
                  orderId={order.id}
                  supplierId={order.supplier.id}
                  orderStatus={status}
                />
              </CardContent>
            </Card>
          )}
        </div>

        {/* Columna Lateral */}
        <div className="space-y-6">
          {/* Fechas */}
          <Card>
            <CardHeader>
              <CardTitle>Fechas</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <p className="text-sm text-muted-foreground">Fecha de Emisión</p>
                <p className="font-medium">{moment.utc(order.issueDate).format('DD/MM/YYYY')}</p>
              </div>
              {order.expectedDeliveryDate && (
                <div>
                  <p className="text-sm text-muted-foreground">Fecha de Entrega Esperada</p>
                  <p className="font-medium">{moment.utc(order.expectedDeliveryDate).format('DD/MM/YYYY')}</p>
                </div>
              )}
              {order.approvedAt && (
                <div>
                  <p className="text-sm text-muted-foreground">Fecha de Aprobación</p>
                  <p className="font-medium">{moment(order.approvedAt).format('DD/MM/YYYY HH:mm')}</p>
                </div>
              )}
              <div>
                <p className="text-sm text-muted-foreground">Fecha de Creación</p>
                <p className="font-medium">{moment(order.createdAt).format('DD/MM/YYYY HH:mm')}</p>
              </div>
            </CardContent>
          </Card>

          {/* Condiciones */}
          {(order.paymentConditions || order.deliveryAddress || order.deliveryNotes) && (
            <Card>
              <CardHeader>
                <CardTitle>Condiciones</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {order.paymentConditions && (
                  <div>
                    <p className="text-sm text-muted-foreground">Condiciones de Pago</p>
                    <p className="whitespace-pre-wrap">{order.paymentConditions}</p>
                  </div>
                )}
                {order.deliveryAddress && (
                  <div>
                    <p className="text-sm text-muted-foreground">Dirección de Entrega</p>
                    <p>{order.deliveryAddress}</p>
                  </div>
                )}
                {order.deliveryNotes && (
                  <div>
                    <p className="text-sm text-muted-foreground">Notas de Entrega</p>
                    <p className="whitespace-pre-wrap">{order.deliveryNotes}</p>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Observaciones */}
          {order.notes && (
            <Card>
              <CardHeader>
                <CardTitle>Observaciones</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="whitespace-pre-wrap">{order.notes}</p>
              </CardContent>
            </Card>
          )}

          {/* Remitos de Recepción */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle>Remitos de Recepción</CardTitle>
              {(status === 'APPROVED' || status === 'PARTIALLY_RECEIVED') && (
                <Button variant="outline" size="sm" asChild>
                  <Link href={`/dashboard/commercial/receiving-notes/new`}>
                    <Plus className="mr-1 h-3 w-3" />
                    Crear Remito
                  </Link>
                </Button>
              )}
            </CardHeader>
            <CardContent>
              {order.receivingNotes.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">
                  No hay remitos de recepción vinculados
                </p>
              ) : (
                <div className="space-y-2">
                  {order.receivingNotes.map((rn) => (
                    <div
                      key={rn.id}
                      className="flex items-center justify-between py-2 border-b last:border-0"
                    >
                      <div className="flex items-center gap-2">
                        <Link
                          href={`/dashboard/commercial/receiving-notes/${rn.id}`}
                          className="text-primary hover:underline font-medium text-sm"
                        >
                          {rn.fullNumber}
                        </Link>
                        <span className="text-xs text-muted-foreground">
                          {rn.warehouse.name}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">
                          {moment.utc(rn.receptionDate).format('DD/MM/YYYY')}
                        </span>
                        <Badge
                          variant={
                            rn.status === 'CONFIRMED'
                              ? 'default'
                              : rn.status === 'CANCELLED'
                                ? 'destructive'
                                : 'secondary'
                          }
                          className={cn(
                            'text-xs',
                            rn.status === 'CONFIRMED' && 'bg-green-600 hover:bg-green-700'
                          )}
                        >
                          {rn.status === 'DRAFT'
                            ? 'Borrador'
                            : rn.status === 'CONFIRMED'
                              ? 'Confirmado'
                              : 'Anulado'}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Facturas Vinculadas */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle>Facturas Vinculadas</CardTitle>
            </CardHeader>
            <CardContent>
              {order.purchaseInvoices.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">
                  No hay facturas vinculadas
                </p>
              ) : (
                <div className="space-y-2">
                  {order.purchaseInvoices.map((inv) => (
                    <div
                      key={inv.id}
                      className="flex items-center justify-between py-2 border-b last:border-0"
                    >
                      <div className="flex items-center gap-2">
                        <Link
                          href={`/dashboard/commercial/purchases/${inv.id}`}
                          className="text-primary hover:underline font-medium text-sm"
                        >
                          {inv.fullNumber}
                        </Link>
                        <span className="text-xs text-muted-foreground">
                          {formatCurrency(inv.total)}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">
                          {moment.utc(inv.issueDate).format('DD/MM/YYYY')}
                        </span>
                        <Badge
                          variant={
                            inv.status === 'CONFIRMED' || inv.status === 'PAID'
                              ? 'default'
                              : inv.status === 'CANCELLED'
                                ? 'destructive'
                                : 'secondary'
                          }
                          className={cn(
                            'text-xs',
                            (inv.status === 'CONFIRMED' || inv.status === 'PAID') && 'bg-green-600 hover:bg-green-700'
                          )}
                        >
                          {PURCHASE_INVOICE_STATUS_LABELS[inv.status as keyof typeof PURCHASE_INVOICE_STATUS_LABELS]}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
    </PermissionGuard>
  );
}
