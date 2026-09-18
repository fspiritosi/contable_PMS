import { AlertTriangle } from 'lucide-react';
import Link from 'next/link';

import { PermissionGuard } from '@/shared/components/common/PermissionGuard';
import { cn } from '@/shared/lib/utils';
import type { ItemsWithoutAccountCounts } from '../actions.server';

interface ItemsWithoutAccountNoticeProps {
  counts: ItemsWithoutAccountCounts;
  className?: string;
}

const ITEMS_HREF = '/dashboard/commercial/products';

/** Enlace al listado de ítems ya filtrado; sin permiso sobre ítems, el conteo se ve sin enlace. */
function ViewLink({ href }: { href: string }) {
  return (
    <PermissionGuard module="commercial.products" action="view" fallback={null}>
      {' → '}
      <Link href={href} className="underline">
        Ver
      </Link>
    </PermissionGuard>
  );
}

/**
 * Conteo de ítems activos que todavía caen en la cuenta de ventas/compras por
 * defecto, con enlace al listado filtrado (TSK-721). Si no hay ninguno, no
 * renderiza nada.
 */
export function ItemsWithoutAccountNotice({ counts, className }: ItemsWithoutAccountNoticeProps) {
  const { saleItemsWithoutIncome: noIncome, purchaseItemsWithoutExpense: noExpense } = counts;
  if (noIncome === 0 && noExpense === 0) return null;

  return (
    <div
      className={cn(
        'flex items-start gap-2 rounded-md border border-orange-500/50 bg-orange-500/10 p-3 text-sm text-orange-600',
        className
      )}
      role="status"
    >
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="flex flex-col gap-1">
        {noIncome > 0 && (
          <p>
            <strong>{noIncome}</strong>{' '}
            {noIncome === 1 ? 'ítem activo de venta' : 'ítems activos de venta'} sin Cuenta de
            Ingresos
            <ViewLink href={`${ITEMS_HREF}?imputation=noIncome&status=ACTIVE`} />
          </p>
        )}
        {noExpense > 0 && (
          <p>
            <strong>{noExpense}</strong>{' '}
            {noExpense === 1 ? 'ítem activo de compra' : 'ítems activos de compra'} sin Cuenta de
            Egresos
            <ViewLink href={`${ITEMS_HREF}?imputation=noExpense&status=ACTIVE`} />
          </p>
        )}
        <p>
          Mientras existan, las facturas de esos ítems se imputan a la cuenta por defecto; sin ella,
          no se pueden confirmar. Imputalos desde Ítems → seleccionar → Editar en Lote, o uno por
          uno con Imputación contable.
        </p>
      </div>
    </div>
  );
}
