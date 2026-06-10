import Link from 'next/link';
import { PermissionGuard } from '@/shared/components/common/PermissionGuard';
import { getInvoiceById } from '../list/actions.server';
import { Card } from '@/shared/components/ui/card';
import { Badge } from '@/shared/components/ui/badge';
import { Button } from '@/shared/components/ui/button';
import { BackButton } from '@/shared/components/common/BackButton';
import moment from 'moment';
import { VOUCHER_TYPE_LABELS, INVOICE_STATUS_LABELS } from '../shared/validators';
import { Separator } from '@/shared/components/ui/separator';
import { _DocumentAttachment } from '@/modules/commercial/shared/components/_DocumentAttachment';
import { _InvoiceLinkedDocuments } from './components/_InvoiceLinkedDocuments';
import { _LinkInvoiceToProjection } from './components/_LinkInvoiceToProjection';
import { _InvoicePDFButton } from './components/_InvoicePDFButton';

type Invoice = Awaited<ReturnType<typeof getInvoiceById>>;

interface InvoiceDetailProps {
  id: string;
}

export async function InvoiceDetail({ id }: InvoiceDetailProps) {
  const invoice: Invoice = await getInvoiceById(id);

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'DRAFT':
        return <Badge variant="outline">{INVOICE_STATUS_LABELS[status]}</Badge>;
      case 'CONFIRMED':
        return <Badge variant="default">{INVOICE_STATUS_LABELS[status]}</Badge>;
      case 'PAID':
        return <Badge variant="success">{INVOICE_STATUS_LABELS[status]}</Badge>;
      case 'PARTIAL_PAID':
        return <Badge variant="warning">{INVOICE_STATUS_LABELS[status]}</Badge>;
      case 'CANCELLED':
        return <Badge variant="destructive">{INVOICE_STATUS_LABELS[status]}</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  return (
    <PermissionGuard module="commercial.invoices" action="view" redirect>
      <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <BackButton />
          <div>
            <h2 className="text-2xl font-bold tracking-tight">
              {VOUCHER_TYPE_LABELS[invoice.voucherType as keyof typeof VOUCHER_TYPE_LABELS]}{' '}
              {invoice.fullNumber}
            </h2>
            <p className="text-muted-foreground">
              Emitida el {moment(invoice.issueDate).format('DD/MM/YYYY')}
            </p>
          </div>
          {getStatusBadge(invoice.status)}
        </div>

        <div className="flex gap-2">
          <_InvoicePDFButton invoice={invoice} />
          {invoice.status === 'DRAFT' && (
            <Button variant="outline" asChild>
              <Link href={`/dashboard/commercial/invoices/${invoice.id}/edit`}>
                Editar
              </Link>
            </Button>
          )}
          {(invoice.status === 'CONFIRMED' || invoice.status === 'PARTIAL_PAID') && (
            <_LinkInvoiceToProjection
              invoiceId={invoice.id}
              fullNumber={invoice.fullNumber}
              total={Number(invoice.total)}
            />
          )}
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        {/* Información del Cliente */}
        <Card className="p-6">
          <h3 className="text-lg font-semibold mb-4">Cliente</h3>
          <div className="space-y-2">
            <div>
              <span className="text-sm text-muted-foreground">Nombre:</span>
              <p className="font-medium">{invoice.customer.name}</p>
            </div>
            {invoice.customer.taxId && (
              <div>
                <span className="text-sm text-muted-foreground">CUIT/DNI:</span>
                <p className="font-mono">{invoice.customer.taxId}</p>
              </div>
            )}
            {invoice.customer.email && (
              <div>
                <span className="text-sm text-muted-foreground">Email:</span>
                <p>{invoice.customer.email}</p>
              </div>
            )}
            {invoice.customer.phone && (
              <div>
                <span className="text-sm text-muted-foreground">Teléfono:</span>
                <p>{invoice.customer.phone}</p>
              </div>
            )}
            {invoice.customer.address && (
              <div>
                <span className="text-sm text-muted-foreground">Dirección:</span>
                <p>{invoice.customer.address}</p>
              </div>
            )}
          </div>
        </Card>

        {/* Información de la Factura */}
        <Card className="p-6">
          <h3 className="text-lg font-semibold mb-4">Información de la Factura</h3>
          <div className="space-y-2">
            <div>
              <span className="text-sm text-muted-foreground">Punto de Venta:</span>
              <p className="font-medium">
                {invoice.pointOfSale.number.toString().padStart(4, '0')} -{' '}
                {invoice.pointOfSale.name}
              </p>
            </div>
            <div>
              <span className="text-sm text-muted-foreground">Número:</span>
              <p className="font-mono font-semibold">{invoice.fullNumber}</p>
            </div>
            <div>
              <span className="text-sm text-muted-foreground">Fecha de Emisión:</span>
              <p>{moment(invoice.issueDate).format('DD/MM/YYYY')}</p>
            </div>
            {invoice.dueDate && (
              <div>
                <span className="text-sm text-muted-foreground">Fecha de Vencimiento:</span>
                <p>{moment(invoice.dueDate).format('DD/MM/YYYY')}</p>
              </div>
            )}
            {invoice.cae && (
              <>
                <div>
                  <span className="text-sm text-muted-foreground">CAE:</span>
                  <p className="font-mono">{invoice.cae}</p>
                </div>
                <div>
                  <span className="text-sm text-muted-foreground">Vencimiento CAE:</span>
                  <p>
                    {invoice.caeExpiryDate
                      ? moment(invoice.caeExpiryDate).format('DD/MM/YYYY')
                      : '-'}
                  </p>
                </div>
              </>
            )}
          </div>
        </Card>
      </div>

      {/* Líneas de Factura */}
      <Card className="p-6">
        <h3 className="text-lg font-semibold mb-4">Detalle de Productos/Servicios</h3>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="border-b">
              <tr className="text-left text-sm text-muted-foreground">
                <th className="pb-3">Código</th>
                <th className="pb-3">Descripción</th>
                <th className="pb-3 text-right">Cantidad</th>
                <th className="pb-3 text-right">Precio Unit.</th>
                <th className="pb-3 text-right">Dto.</th>
                <th className="pb-3 text-right">IVA %</th>
                <th className="pb-3 text-right">Subtotal</th>
                <th className="pb-3 text-right">IVA</th>
                <th className="pb-3 text-right">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {invoice.lines.map((line) => (
                <tr key={line.id} className="text-sm">
                  <td className="py-3 font-mono">{line.product.code}</td>
                  <td className="py-3">
                    <div className="font-medium">{line.product.name}</div>
                    <div className="text-xs text-muted-foreground">{line.description}</div>
                  </td>
                  <td className="py-3 text-right font-mono">
                    {Number(line.quantity).toFixed(3)} {line.product.unitOfMeasure}
                  </td>
                  <td className="py-3 text-right font-mono">
                    ${Number(line.unitPrice).toFixed(2)}
                  </td>
                  <td className="py-3 text-right font-mono">
                    {line.discountPercent
                      ? `${Number(line.discountPercent)}%`
                      : line.discountAmount && Number(line.discountAmount) > 0
                        ? `$${Number(line.discountAmount).toLocaleString('es-AR', { minimumFractionDigits: 2 })}`
                        : '-'}
                  </td>
                  <td className="py-3 text-right font-mono">
                    {Number(line.vatRate).toFixed(2)}%
                  </td>
                  <td className="py-3 text-right font-mono">
                    ${Number(line.subtotal).toFixed(2)}
                  </td>
                  <td className="py-3 text-right font-mono">
                    ${Number(line.vatAmount).toFixed(2)}
                  </td>
                  <td className="py-3 text-right font-mono font-semibold">
                    ${Number(line.total).toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Totales */}
        <div className="mt-6 flex justify-end">
          <div className="w-full max-w-sm space-y-2">
            {Number(invoice.discountTotal) > 0 && (
              <>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Subtotal (antes dto):</span>
                  <span className="font-mono">
                    ${Number(invoice.totalBeforeDiscount).toLocaleString('es-AR', { minimumFractionDigits: 2 })}
                  </span>
                </div>
                <div className="flex justify-between text-sm text-orange-600">
                  <span>Descuento total:</span>
                  <span className="font-mono">
                    -${Number(invoice.discountTotal).toLocaleString('es-AR', { minimumFractionDigits: 2 })}
                  </span>
                </div>
              </>
            )}
            {invoice.globalDiscountPercent != null && Number(invoice.globalDiscountPercent) > 0 && (
              <div className="text-sm text-muted-foreground">
                Descuento global: {Number(invoice.globalDiscountPercent)}%
              </div>
            )}
            {invoice.globalDiscountAmount != null && Number(invoice.globalDiscountAmount) > 0 && !invoice.globalDiscountPercent && (
              <div className="text-sm text-muted-foreground">
                Descuento global: ${Number(invoice.globalDiscountAmount).toLocaleString('es-AR', { minimumFractionDigits: 2 })}
              </div>
            )}
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Subtotal:</span>
              <span className="font-mono">
                ${Number(invoice.subtotal).toLocaleString('es-AR', { minimumFractionDigits: 2 })}
              </span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">IVA:</span>
              <span className="font-mono">
                ${Number(invoice.vatAmount).toLocaleString('es-AR', { minimumFractionDigits: 2 })}
              </span>
            </div>
            {Number(invoice.otherTaxes) > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Otros Impuestos:</span>
                <span className="font-mono">
                  $
                  {Number(invoice.otherTaxes).toLocaleString('es-AR', {
                    minimumFractionDigits: 2,
                  })}
                </span>
              </div>
            )}
            <Separator />
            <div className="flex justify-between text-lg font-semibold">
              <span>Total:</span>
              <span className="font-mono">
                ${Number(invoice.total).toLocaleString('es-AR', { minimumFractionDigits: 2 })}
              </span>
            </div>
          </div>
        </div>
      </Card>

      {/* Notas */}
      {(invoice.notes || invoice.internalNotes) && (
        <div className="grid gap-6 md:grid-cols-2">
          {invoice.notes && (
            <Card className="p-6">
              <h3 className="text-lg font-semibold mb-2">Observaciones</h3>
              <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                {invoice.notes}
              </p>
            </Card>
          )}
          {invoice.internalNotes && (
            <Card className="p-6">
              <h3 className="text-lg font-semibold mb-2">Notas Internas</h3>
              <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                {invoice.internalNotes}
              </p>
            </Card>
          )}
        </div>
      )}

      {/* Documentos Vinculados y Saldo */}
      <_InvoiceLinkedDocuments invoice={invoice} />

      {/* Asiento Contable */}
      {invoice.journalEntry && (
        <Card className="p-6">
          <h3 className="text-lg font-semibold mb-4">Asiento Contable</h3>
          <div className="flex items-center gap-4">
            <div>
              <span className="text-sm text-muted-foreground">Asiento N°:</span>
              <p className="font-mono font-semibold">{invoice.journalEntry.number}</p>
            </div>
            <div>
              <span className="text-sm text-muted-foreground">Estado:</span>
              <Badge variant={invoice.journalEntry.status === 'POSTED' ? 'default' : 'outline'}>
                {invoice.journalEntry.status === 'POSTED' ? 'Registrado' : 'Borrador'}
              </Badge>
            </div>
            <Button variant="outline" size="sm" asChild>
              <Link href={`/dashboard/company/accounting/entries`}>Ver Asiento</Link>
            </Button>
          </div>
        </Card>
      )}

      {/* Documento Adjunto */}
      <_DocumentAttachment
        documentType="sales-invoice"
        documentId={invoice.id}
        companyId={invoice.companyId}
        companyName={invoice.company.name}
        documentNumber={invoice.fullNumber}
        hasDocument={!!invoice.documentUrl}
        documentUrl={invoice.documentUrl}
      />
    </div>
    </PermissionGuard>
  );
}
