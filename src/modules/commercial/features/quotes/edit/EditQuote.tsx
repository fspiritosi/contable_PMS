import { PermissionGuard } from '@/shared/components/common/PermissionGuard';
import { getQuoteById } from '../list/actions.server';
import {
  getActiveCustomersForQuote,
  getActiveLeadsForQuote,
  getActiveProductsForQuote,
} from '../create/helpers.server';
import { QuoteForm } from '../create/components/_QuoteForm';
import { redirect } from 'next/navigation';

interface EditQuoteProps {
  id: string;
}

export async function EditQuote({ id }: EditQuoteProps) {
  const [quote, customers, leads, products] = await Promise.all([
    getQuoteById(id),
    getActiveCustomersForQuote(),
    getActiveLeadsForQuote(),
    getActiveProductsForQuote(),
  ]);

  // Solo se pueden editar presupuestos en borrador
  if (quote.status !== 'DRAFT') {
    redirect(`/dashboard/commercial/quotes/${id}`);
  }

  // Preparar datos iniciales para el formulario
  const initialData = {
    recipientType: (quote.contractor ? 'customer' : 'lead') as
      | 'customer'
      | 'lead',
    customerId: quote.contractor?.id ?? '',
    leadId: quote.lead?.id ?? '',
    issueDate: new Date(quote.issueDate),
    expirationDate: quote.expirationDate
      ? new Date(quote.expirationDate)
      : undefined,
    currency: quote.currency as 'ARS' | 'USD' | 'EUR' | 'GBP',
    notes: quote.notes || '',
    conditions: quote.conditions || '',
    globalDiscountPercent: quote.globalDiscountPercent?.toString() ?? '',
    globalDiscountAmount: quote.globalDiscountAmount?.toString() ?? '',
    lines: quote.lines.map((line) => ({
      productId: line.product.id,
      description: line.description,
      quantity: line.quantity.toString(),
      unitPrice: line.unitPrice.toString(),
      vatRate: line.vatRate.toString(),
      discountPercent: line.discountPercent?.toString() ?? '',
      discountAmount: line.discountAmount?.toString() ?? '',
    })),
  };

  return (
    <PermissionGuard module="commercial.quotes" action="update" redirect>
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">
            Editar Presupuesto {quote.number}
          </h2>
          <p className="text-muted-foreground">
            Modifica los datos del presupuesto en borrador
          </p>
        </div>

        <QuoteForm
          customers={customers}
          leads={leads}
          products={products}
          mode="edit"
          quoteId={id}
          initialData={initialData}
        />
      </div>
    </PermissionGuard>
  );
}
