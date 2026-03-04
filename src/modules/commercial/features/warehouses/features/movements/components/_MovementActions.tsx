'use client';

import { useState } from 'react';
import { Button } from '@/shared/components/ui/button';
import { Plus, ArrowLeftRight } from 'lucide-react';
import { _StockAdjustmentModal } from './_StockAdjustmentModal';
import { _StockTransferModal } from './_StockTransferModal';
import { usePermissions } from '@/shared/hooks/usePermissions';

interface Props {
  warehouses: Array<{ id: string; name: string }>;
  products: Array<{ id: string; code: string; name: string; trackStock: boolean }>;
}

export function _MovementActions({ warehouses, products }: Props) {
  const [adjustmentModalOpen, setAdjustmentModalOpen] = useState(false);
  const [transferModalOpen, setTransferModalOpen] = useState(false);
  const { hasPermission } = usePermissions();

  // Filtrar solo productos con control de stock
  const stockProducts = products.filter((p) => p.trackStock);

  return (
    <>
      <div className="flex gap-2">
        {hasPermission('commercial.movements', 'create') && (
          <Button onClick={() => setAdjustmentModalOpen(true)} className="gap-2">
            <Plus className="h-4 w-4" />
            Ajuste de Stock
          </Button>
        )}
        {hasPermission('commercial.movements', 'create') && (
          <Button onClick={() => setTransferModalOpen(true)} variant="outline" className="gap-2">
            <ArrowLeftRight className="h-4 w-4" />
            Transferencia
          </Button>
        )}
      </div>

      <_StockAdjustmentModal
        open={adjustmentModalOpen}
        onOpenChange={setAdjustmentModalOpen}
        warehouses={warehouses}
        products={stockProducts}
      />

      <_StockTransferModal
        open={transferModalOpen}
        onOpenChange={setTransferModalOpen}
        warehouses={warehouses}
        products={stockProducts}
      />
    </>
  );
}
