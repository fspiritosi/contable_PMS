import { getPurchaseInvoiceById } from '../list/actions.server';
import { PermissionGuard } from '@/shared/components/common/PermissionGuard';
import { Button } from '@/shared/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/components/ui/card';
import { Badge } from '@/shared/components/ui/badge';
import { Alert, AlertDescription } from '@/shared/components/ui/alert';
import { PackageCheck, PackageMinus, PackageSearch } from 'lucide-react';
import { BackButton } from '@/shared/components/common/BackButton';
import moment from 'moment';
import { PURCHASE_INVOICE_STATUS_LABELS, VOUCHER_TYPE_LABELS } from '../shared/validators';
import type { PurchaseInvoiceStatus } from '@/generated/prisma/enums';
import { Separator } from '@/shared/components/ui/separator';
import { cn } from '@/shared/lib/utils';
import { _DocumentAttachment } from '@/modules/commercial/shared/components/_DocumentAttachment';
import { _PurchaseInvoiceLinkedDocuments } from './components/_PurchaseInvoiceLinkedDocuments';
import { _LinkPurchaseInvoiceToProjection } from './components/_LinkPurchaseInvoiceToProjection';
import { _PurchaseInvoicePDFButton } from './components/_PurchaseInvoicePDFButton';

interface Props {
  invoiceId: string;
}

export async function PurchaseInvoiceDetail({ invoiceId }: Props) {
  const invoice = await getPurchaseInvoiceById(invoiceId);

  const statusVariant:
    | 'default'
    | 'secondary'
    | 'destructive'
    | 'outline' =
    invoice.status === 'CONFIRMED'
      ? 'default'
      : invoice.status === 'PAID'
      ? 'default'
      : invoice.status === 'CANCELLED'
      ? 'destructive'
      : 'secondary';

  return (
    <PermissionGuard module="commercial.purchases" action="view" redirect>
      <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <BackButton variant="outline" />
          <div>
            <h1 className="text-3xl font-bold tracking-tight">
              Factura {invoice.fullNumber}
            </h1>
            <p className="text-muted-foreground">
              {VOUCHER_TYPE_LABELS[invoice.voucherType] || invoice.voucherType}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <_PurchaseInvoicePDFButton invoice={invoice} />
          {(invoice.status === 'CONFIRMED' || invoice.status === 'PARTIAL_PAID') && (
            <_LinkPurchaseInvoiceToProjection
              invoiceId={invoice.id}
              fullNumber={invoice.fullNumber}
              total={Number(invoice.total)}
            />
          )}
          <Badge
            variant={statusVariant}
            className={cn(
              'text-sm px-3 py-1',
              invoice.status === 'CONFIRMED' && 'bg-green-600 hover:bg-green-700'
            )}
          >
            {PURCHASE_INVOICE_STATUS_LABELS[invoice.status as PurchaseInvoiceStatus]}
          </Badge>
        </div>
      </div>

      {invoice.receptionStatus === 'pending' && (
        <Alert className="border-yellow-500/50 bg-yellow-50 dark:bg-yellow-950/20">
          <PackageSearch className="h-4 w-4 text-yellow-600" />
          <AlertDescription className="flex items-center justify-between">
            <span className="text-yellow-800 dark:text-yellow-200">
              Esta factura tiene productos pendientes de recepción. Cree un remito para registrar el ingreso al almacén.
            </span>
            <Button variant="outline" size="sm" asChild className="ml-4 shrink-0">
              <Link
                href={`/dashboard/commercial/receiving-notes/new?purchaseInvoiceId=${invoice.id}&supplierId=${invoice.supplierId}`}
              >
                Crear remito
              </Link>
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {invoice.receptionStatus === 'partial' && (
        <Alert className="border-orange-500/50 bg-orange-50 dark:bg-orange-950/20">
          <PackageMinus className="h-4 w-4 text-orange-500" />
          <AlertDescription className="flex items-center justify-between">
            <span className="text-orange-800 dark:text-orange-200">
              Recepción parcial. Aún quedan productos pendientes de recibir.
            </span>
            <Button variant="outline" size="sm" asChild className="ml-4 shrink-0">
              <Link
                href={`/dashboard/commercial/receiving-notes/new?purchaseInvoiceId=${invoice.id}&supplierId=${invoice.supplierId}`}
              >
                Crear remito
              </Link>
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {invoice.receptionStatus === 'complete' && (
        <Alert className="border-green-500/50 bg-green-50 dark:bg-green-950/20">
          <PackageCheck className="h-4 w-4 text-green-600" />
          <AlertDescription>
            <span className="text-green-800 dark:text-green-200">
              Recepción completa. Todos los productos fueron recibidos en el almacén.
            </span>
          </AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Columna Principal */}
        <div className="lg:col-span-2 space-y-6">
          {/* Datos del Proveedor */}
          <Card>
            <CardHeader>
              <CardTitle>Proveedor</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-muted-foreground">Razón Social</p>
                  <p className="font-medium">{invoice.supplier.businessName}</p>
                </div>
                {invoice.supplier.tradeName && (
                  <div>
                    <p className="text-sm text-muted-foreground">Nombre de Fantasía</p>
                    <p className="font-medium">{invoice.supplier.tradeName}</p>
                  </div>
                )}
                <div>
                  <p className="text-sm text-muted-foreground">CUIT</p>
                  <p className="font-mono">{invoice.supplier.taxId}</p>
                </div>
                {invoice.supplier.email && (
                  <div>
                    <p className="text-sm text-muted-foreground">Email</p>
                    <p>{invoice.supplier.email}</p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Líneas de la Factura */}
          <Card>
            <CardHeader>
              <CardTitle>Detalle de la Factura</CardTitle>
              <CardDescription>Líneas de productos/servicios</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b">
                    <tr className="text-left">
                      <th className="pb-3">Descripción</th>
                      <th className="pb-3 text-right">Cantidad</th>
                      <th className="pb-3 text-right">Costo Unit.</th>
                      <th className="pb-3 text-right">IVA %</th>
                      <th className="pb-3 text-right">Subtotal</th>
                      <th className="pb-3 text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {invoice.lines.map((line) => (
                      <tr key={line.id}>
                        <td className="py-3">
                          <div>
                            <p className="font-medium">{line.description}</p>
                            {line.product && (
                              <p className="text-xs text-muted-foreground">
                                {line.product.code} - {line.product.name}
                              </p>
                            )}
                          </div>
                        </td>
                        <td className="py-3 text-right font-mono">
                          {Number(line.quantity).toFixed(3)}{' '}
                          {line.product?.unitOfMeasure || 'UN'}
                        </td>
                        <td className="py-3 text-right font-mono">
                          ${Number(line.unitCost).toFixed(2)}
                        </td>
                        <td className="py-3 text-right">
                          {Number(line.vatRate).toFixed(2)}%
                        </td>
                        <td className="py-3 text-right font-mono">
                          ${Number(line.subtotal).toFixed(2)}
                        </td>
                        <td className="py-3 text-right font-mono font-semibold">
                          ${Number(line.total).toFixed(2)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="border-t-2">
                    <tr className="font-semibold">
                      <td className="pt-3" colSpan={4}>
                        TOTALES
                      </td>
                      <td className="pt-3 text-right">
                        ${Number(invoice.subtotal).toFixed(2)}
                      </td>
                      <td className="pt-3 text-right">
                        ${Number(invoice.total).toFixed(2)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </CardContent>
          </Card>

          {/* Observaciones */}
          {invoice.notes && (
            <Card>
              <CardHeader>
                <CardTitle>Observaciones</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm whitespace-pre-wrap">{invoice.notes}</p>
              </CardContent>
            </Card>
          )}

          {/* Documentos Vinculados y Saldo */}
          <_PurchaseInvoiceLinkedDocuments invoice={invoice} />

          {/* Remitos de Recepción */}
          {invoice.receivingNotes.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Remitos de Recepción</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {invoice.receivingNotes.map((rn) => (
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
              </CardContent>
            </Card>
          )}
        </div>

        {/* Columna Lateral */}
        <div className="space-y-6">
          {/* Información del Comprobante */}
          <Card>
            <CardHeader>
              <CardTitle>Información</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <p className="text-sm text-muted-foreground">Tipo</p>
                <p className="font-medium">
                  {VOUCHER_TYPE_LABELS[invoice.voucherType] || invoice.voucherType}
                </p>
              </div>
              <Separator />
              <div>
                <p className="text-sm text-muted-foreground">Número Completo</p>
                <p className="font-mono font-medium">{invoice.fullNumber}</p>
              </div>
              <Separator />
              <div>
                <p className="text-sm text-muted-foreground">Fecha de Emisión</p>
                <p className="font-medium">
                  {moment(invoice.issueDate).format('DD/MM/YYYY')}
                </p>
              </div>
              {invoice.dueDate && (
                <>
                  <Separator />
                  <div>
                    <p className="text-sm text-muted-foreground">Fecha de Vencimiento</p>
                    <p className="font-medium">
                      {moment(invoice.dueDate).format('DD/MM/YYYY')}
                    </p>
                  </div>
                </>
              )}
              {invoice.cae && (
                <>
                  <Separator />
                  <div>
                    <p className="text-sm text-muted-foreground">CAE</p>
                    <p className="font-mono text-xs break-all">{invoice.cae}</p>
                    {invoice.validated && (
                      <Badge variant="default" className="mt-1 bg-green-600 hover:bg-green-700">
                        Validado
                      </Badge>
                    )}
                  </div>
                </>
              )}
              {invoice.purchaseOrder && (
                <>
                  <Separator />
                  <div>
                    <p className="text-sm text-muted-foreground">Orden de Compra</p>
                    <Link
                      href={`/dashboard/commercial/purchase-orders/${invoice.purchaseOrder.id}`}
                      className="text-primary hover:underline font-medium"
                    >
                      {invoice.purchaseOrder.fullNumber}
                    </Link>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {/* Totales */}
          <Card>
            <CardHeader>
              <CardTitle>Totales</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="flex justify-between">
                <span className="text-sm text-muted-foreground">Subtotal</span>
                <span className="font-mono">${Number(invoice.subtotal).toFixed(2)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-muted-foreground">IVA</span>
                <span className="font-mono">${Number(invoice.vatAmount).toFixed(2)}</span>
              </div>
              {Number(invoice.otherTaxes) > 0 && (
                <div className="flex justify-between">
                  <span className="text-sm text-muted-foreground">Otros Impuestos</span>
                  <span className="font-mono">
                    ${Number(invoice.otherTaxes).toFixed(2)}
                  </span>
                </div>
              )}
              <Separator />
              <div className="flex justify-between text-lg font-semibold">
                <span>Total</span>
                <span className="font-mono">${Number(invoice.total).toFixed(2)}</span>
              </div>
            </CardContent>
          </Card>

          {/* Auditoría */}
          <Card>
            <CardHeader>
              <CardTitle>Auditoría</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div>
                <p className="text-muted-foreground">Creado por</p>
                <p className="font-medium">{invoice.createdBy}</p>
              </div>
              <Separator />
              <div>
                <p className="text-muted-foreground">Fecha de Creación</p>
                <p>{moment(invoice.createdAt).format('DD/MM/YYYY HH:mm')}</p>
              </div>
              <Separator />
              <div>
                <p className="text-muted-foreground">Última Actualización</p>
                <p>{moment(invoice.updatedAt).format('DD/MM/YYYY HH:mm')}</p>
              </div>
            </CardContent>
          </Card>

          {/* Documento Adjunto */}
          <_DocumentAttachment
            documentType="purchase-invoice"
            documentId={invoice.id}
            companyId={invoice.companyId}
            companyName={invoice.company.name}
            documentNumber={invoice.fullNumber}
            hasDocument={!!invoice.documentUrl}
            documentUrl={invoice.documentUrl}
          />
        </div>
      </div>
    </div>
    </PermissionGuard>
  );
}
