import { PermissionGuard } from '@/shared/components/common/PermissionGuard';
import { getQuoteById } from '../list/actions.server';
import { Card } from '@/shared/components/ui/card';
import { Badge } from '@/shared/components/ui/badge';
import { Button } from '@/shared/components/ui/button';
import { Separator } from '@/shared/components/ui/separator';
import { BackButton } from '@/shared/components/common/BackButton';
import Link from 'next/link';
import moment from 'moment';
import { QUOTE_STATUS_LABELS } from '../shared/validators';
import { _QuoteStatusActions } from './components/_QuoteStatusActions';
import { _QuotePDFButton } from './components/_QuotePDFButton';

type Quote = Awaited<ReturnType<typeof getQuoteById>>;

interface QuoteDetailProps {
  id: string;
}

function getStatusBadge(status: string) {
  const label = QUOTE_STATUS_LABELS[status] ?? status;
  switch (status) {
    case 'DRAFT':
      return <Badge variant="outline">{label}</Badge>;
    case 'SENT':
      return <Badge variant="default">{label}</Badge>;
    case 'ACCEPTED':
      return <Badge variant="success">{label}</Badge>;
    case 'REJECTED':
      return <Badge variant="destructive">{label}</Badge>;
    case 'EXPIRED':
      return <Badge variant="warning">{label}</Badge>;
    case 'COMPLETED':
      return <Badge className="bg-blue-600">{label}</Badge>;
    default:
      return <Badge variant="outline">{label}</Badge>;
  }
}

function formatARS(value: number) {
  return `$${value.toLocaleString('es-AR', { minimumFractionDigits: 2 })}`;
}

function getProgressColor(current: number, total: number) {
  if (current >= total) return 'text-green-600';
  if (current > 0) return 'text-orange-600';
  return '';
}

export async function QuoteDetail({ id }: QuoteDetailProps) {
  const quote: Quote = await getQuoteById(id);
  const showProgress = quote.status === 'ACCEPTED' || quote.status === 'COMPLETED';

  return (
    <PermissionGuard module="commercial.quotes" action="view" redirect>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <BackButton />
            <div>
              <div className="flex items-center gap-3">
                <h2 className="text-2xl font-bold tracking-tight">
                  Presupuesto {quote.number}
                </h2>
                {getStatusBadge(quote.status)}
              </div>
              <p className="text-muted-foreground">
                Emisión: {moment(quote.issueDate).format('DD/MM/YYYY')}
                {' | '}
                Vencimiento:{' '}
                {quote.expirationDate
                  ? moment(quote.expirationDate).format('DD/MM/YYYY')
                  : 'Sin vencimiento'}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <_QuotePDFButton quoteId={quote.id} />
            <_QuoteStatusActions
              quoteId={quote.id}
              status={quote.status}
            />
          </div>
        </div>

        {/* Recipient */}
        <Card className="p-6">
          <h3 className="text-lg font-semibold mb-4">
            {quote.contractor ? 'Cliente' : 'Lead'}
            {quote.lead && (
              <Badge variant="secondary" className="ml-2">
                Lead
              </Badge>
            )}
          </h3>
          <div className="space-y-2">
            {quote.contractor && (
              <>
                <div>
                  <span className="text-sm text-muted-foreground">Nombre:</span>
                  <p className="font-medium">{quote.contractor.name}</p>
                </div>
                {quote.contractor.taxId && (
                  <div>
                    <span className="text-sm text-muted-foreground">CUIT:</span>
                    <p className="font-mono">{quote.contractor.taxId}</p>
                  </div>
                )}
                {quote.contractor.email && (
                  <div>
                    <span className="text-sm text-muted-foreground">Email:</span>
                    <p>{quote.contractor.email}</p>
                  </div>
                )}
                {quote.contractor.phone && (
                  <div>
                    <span className="text-sm text-muted-foreground">Teléfono:</span>
                    <p>{quote.contractor.phone}</p>
                  </div>
                )}
                {quote.contractor.address && (
                  <div>
                    <span className="text-sm text-muted-foreground">Dirección:</span>
                    <p>{quote.contractor.address}</p>
                  </div>
                )}
              </>
            )}
            {quote.lead && (
              <>
                <div>
                  <span className="text-sm text-muted-foreground">Nombre:</span>
                  <p className="font-medium">{quote.lead.name}</p>
                </div>
                {quote.lead.email && (
                  <div>
                    <span className="text-sm text-muted-foreground">Email:</span>
                    <p>{quote.lead.email}</p>
                  </div>
                )}
                {quote.lead.phone && (
                  <div>
                    <span className="text-sm text-muted-foreground">Teléfono:</span>
                    <p>{quote.lead.phone}</p>
                  </div>
                )}
              </>
            )}
          </div>
        </Card>

        {/* Lines table */}
        <Card className="p-6">
          <h3 className="text-lg font-semibold mb-4">
            Detalle de Productos/Servicios
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="border-b">
                <tr className="text-left text-sm text-muted-foreground">
                  <th className="pb-3">#</th>
                  <th className="pb-3">Descripción</th>
                  <th className="pb-3 text-right">Cant.</th>
                  <th className="pb-3 text-right">P. Unit.</th>
                  <th className="pb-3 text-right">Dto.</th>
                  <th className="pb-3 text-right">IVA %</th>
                  <th className="pb-3 text-right">Subtotal</th>
                  <th className="pb-3 text-right">IVA</th>
                  <th className="pb-3 text-right">Total</th>
                  {showProgress && (
                    <>
                      <th className="pb-3 text-right">Entregado</th>
                      <th className="pb-3 text-right">Facturado</th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y">
                {quote.lines.map((line, index) => (
                  <tr key={line.id} className="text-sm">
                    <td className="py-3 text-muted-foreground">{index + 1}</td>
                    <td className="py-3">
                      <div className="font-medium">{line.product.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {line.product.code}
                        {line.description && line.description !== line.product.name
                          ? ` - ${line.description}`
                          : ''}
                      </div>
                    </td>
                    <td className="py-3 text-right font-mono">
                      {line.quantity.toFixed(3)} {line.product.unitOfMeasure}
                    </td>
                    <td className="py-3 text-right font-mono">
                      {formatARS(line.unitPrice)}
                    </td>
                    <td className="py-3 text-right font-mono">
                      {line.discountPercent
                        ? `${line.discountPercent}%`
                        : line.discountAmount && line.discountAmount > 0
                          ? formatARS(line.discountAmount)
                          : '-'}
                    </td>
                    <td className="py-3 text-right font-mono">
                      {line.vatRate.toFixed(2)}%
                    </td>
                    <td className="py-3 text-right font-mono">
                      {formatARS(line.subtotal)}
                    </td>
                    <td className="py-3 text-right font-mono">
                      {formatARS(line.vatAmount)}
                    </td>
                    <td className="py-3 text-right font-mono font-semibold">
                      {formatARS(line.total)}
                    </td>
                    {showProgress && (
                      <>
                        <td className="py-3 text-right font-mono">
                          <span className={getProgressColor(line.deliveredQty, line.quantity)}>
                            {line.deliveredQty.toFixed(0)} / {line.quantity.toFixed(0)}
                          </span>
                        </td>
                        <td className="py-3 text-right font-mono">
                          <span className={getProgressColor(line.invoicedQty, line.quantity)}>
                            {line.invoicedQty.toFixed(0)} / {line.quantity.toFixed(0)}
                          </span>
                        </td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Totals */}
          <div className="mt-6 flex justify-end">
            <div className="w-full max-w-sm space-y-2">
              {quote.discountTotal > 0 && (
                <>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">
                      Subtotal (antes dto):
                    </span>
                    <span className="font-mono">
                      {formatARS(quote.totalBeforeDiscount)}
                    </span>
                  </div>
                  <div className="flex justify-between text-sm text-orange-600">
                    <span>Descuento total:</span>
                    <span className="font-mono">
                      -{formatARS(quote.discountTotal)}
                    </span>
                  </div>
                </>
              )}
              {quote.globalDiscountPercent != null &&
                quote.globalDiscountPercent > 0 && (
                  <div className="text-sm text-muted-foreground">
                    Descuento global: {quote.globalDiscountPercent}%
                  </div>
                )}
              {quote.globalDiscountAmount != null &&
                quote.globalDiscountAmount > 0 &&
                !quote.globalDiscountPercent && (
                  <div className="text-sm text-muted-foreground">
                    Descuento global: {formatARS(quote.globalDiscountAmount)}
                  </div>
                )}
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Subtotal:</span>
                <span className="font-mono">{formatARS(quote.subtotal)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">IVA:</span>
                <span className="font-mono">{formatARS(quote.vatAmount)}</span>
              </div>
              <Separator />
              <div className="flex justify-between text-lg font-semibold">
                <span>Total:</span>
                <span className="font-mono">{formatARS(quote.total)}</span>
              </div>
            </div>
          </div>
        </Card>

        {/* Conditions */}
        {quote.conditions && (
          <Card className="p-6">
            <h3 className="text-lg font-semibold mb-2">Condiciones</h3>
            <p className="text-sm text-muted-foreground whitespace-pre-wrap">
              {quote.conditions}
            </p>
          </Card>
        )}

        {/* Notes */}
        {quote.notes && (
          <Card className="p-6">
            <h3 className="text-lg font-semibold mb-2">Notas</h3>
            <p className="text-sm text-muted-foreground whitespace-pre-wrap">
              {quote.notes}
            </p>
          </Card>
        )}
      </div>
    </PermissionGuard>
  );
}
