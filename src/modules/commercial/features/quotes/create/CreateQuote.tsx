import { PermissionGuard } from '@/shared/components/common/PermissionGuard';
import { QuoteForm } from './components/_QuoteForm';
import {
  getActiveCustomersForQuote,
  getActiveLeadsForQuote,
  getActiveProductsForQuote,
} from './helpers.server';

export async function CreateQuote() {
  const [customers, leads, products] = await Promise.all([
    getActiveCustomersForQuote(),
    getActiveLeadsForQuote(),
    getActiveProductsForQuote(),
  ]);

  return (
    <PermissionGuard module="commercial.quotes" action="create" redirect>
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">
            Nuevo Presupuesto
          </h2>
          <p className="text-muted-foreground">
            Completá los datos para crear un nuevo presupuesto
          </p>
        </div>
        <QuoteForm customers={customers} leads={leads} products={products} />
      </div>
    </PermissionGuard>
  );
}
