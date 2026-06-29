'use client';

import { useCallback, useMemo, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { AlertTriangle, DollarSign, FileSpreadsheet, Pencil, Plus, Scale, Tag } from 'lucide-react';
import { toast } from 'sonner';

import { useIndustry } from '@/providers/IndustryProvider';
import { Button } from '@/shared/components/ui/button';
import {
  DataTable,
  type DataTableSearchParams,
  type DataTableFacetedFilterConfig,
} from '@/shared/components/common/DataTable';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/shared/components/ui/alert-dialog';
import type { ModulePermissions } from '@/shared/lib/permissions';
import { getColumns } from '../columns';
import type { Product } from '../../../shared/types';
import {
  PRODUCT_TYPE_LABELS,
  PRODUCT_STATUS_LABELS,
} from '../../../shared/types';
import { deleteProduct } from '../actions.server';
import { _BulkEditModal } from './_BulkEditModal';
import { _BulkPriceAdjustModal } from './_BulkPriceAdjustModal';
import { _OemCompareModal } from './_OemCompareModal';
import { _LabelPrintModal } from './_LabelPrintModal';
import { _ProductImportModal } from './_ProductImportModal';

interface FacetCounts {
  type: Record<string, number>;
  status: Record<string, number>;
}

interface ProductsTableProps {
  data: Product[];
  totalRows: number;
  searchParams: DataTableSearchParams;
  permissions: ModulePermissions;
  facetCounts?: FacetCounts;
}

export function _ProductsTable({ data, totalRows, searchParams, permissions, facetCounts }: ProductsTableProps) {
  const router = useRouter();
  const pathname = usePathname();
  const urlSearchParams = useSearchParams();
  const { isFeatureAvailable } = useIndustry();
  const showOemCode = isFeatureAvailable('products.triple-coding');
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [deletingProduct, setDeletingProduct] = useState<Product | null>(null);
  const [selectedRows, setSelectedRows] = useState<Product[]>([]);
  const [bulkPriceOpen, setBulkPriceOpen] = useState(false);
  const [bulkEditOpen, setBulkEditOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [oemCompareOpen, setOemCompareOpen] = useState(false);
  const [labelPrintOpen, setLabelPrintOpen] = useState(false);
  const showCompareButton = isFeatureAvailable('products.compare-prices');

  const isLowStockActive = urlSearchParams.get('stockLevel') === 'low';

  const handleToggleLowStock = useCallback(() => {
    const params = new URLSearchParams(urlSearchParams.toString());
    if (isLowStockActive) {
      params.delete('stockLevel');
    } else {
      params.set('stockLevel', 'low');
      params.delete('page'); // Reset page when toggling filter
    }
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }, [isLowStockActive, urlSearchParams, pathname, router]);

  const selectedIds = useMemo(() => selectedRows.map((r) => r.id), [selectedRows]);

  const handleSelectionChange = useCallback((rows: Product[]) => {
    setSelectedRows(rows);
  }, []);

  const handleBulkPriceSuccess = useCallback(() => {
    setSelectedRows([]);
    router.refresh();
  }, [router]);

  const handleBulkEditSuccess = useCallback(() => {
    setSelectedRows([]);
    router.refresh();
  }, [router]);

  const handleImportSuccess = useCallback(() => {
    router.refresh();
  }, [router]);

  const handleRefresh = () => {
    router.refresh();
  };

  const handleDelete = async () => {
    if (!deletingProduct) return;
    try {
      await deleteProduct(deletingProduct.id);
      toast.success('Artículo eliminado correctamente');
      handleRefresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Error al eliminar artículo';
      toast.error(message);
    } finally {
      setDeletingProduct(null);
    }
  };

  const columns = useMemo(
    () =>
      getColumns({
        onEdit: setEditingProduct,
        onDelete: setDeletingProduct,
        permissions,
        showOemCode,
      }),
    [permissions, showOemCode]
  );

  const facetedFilters = useMemo<DataTableFacetedFilterConfig[]>(
    () => [
      {
        columnId: 'name',
        title: 'Artículo',
        type: 'text' as const,
        placeholder: 'Buscar por nombre...',
      },
      {
        columnId: 'code',
        title: 'Código',
        type: 'text' as const,
        placeholder: 'Buscar por código...',
      },
      {
        columnId: 'type',
        title: 'Tipo',
        options: Object.entries(PRODUCT_TYPE_LABELS).map(([value, label]) => ({
          value,
          label,
        })),
        externalCounts: facetCounts?.type ? new Map(Object.entries(facetCounts.type)) : undefined,
      },
      {
        columnId: 'category',
        title: 'Categoría',
        type: 'text' as const,
        placeholder: 'Buscar por categoría...',
      },
      {
        columnId: 'status',
        title: 'Estado',
        options: Object.entries(PRODUCT_STATUS_LABELS).map(([value, label]) => ({
          value,
          label,
        })),
        externalCounts: facetCounts?.status ? new Map(Object.entries(facetCounts.status)) : undefined,
      },
      {
        columnId: 'stockLevel',
        title: 'Nivel de Stock',
        options: [
          { value: 'low', label: 'Bajo mínimo (todos)' },
          { value: 'out', label: 'Sin stock' },
          { value: 'critical', label: 'Stock crítico' },
          { value: 'warning', label: 'Stock bajo' },
        ],
      },
    ],
    [facetCounts]
  );

  return (
    <>
      <DataTable
        columns={columns}
        data={data}
        totalRows={totalRows}
        searchParams={searchParams}
        showSearch={false}
        tableId="commercial-products"
        facetedFilters={facetedFilters}
        showFilterToggle
        enableRowSelection
        showRowSelection
        onRowSelectionChange={handleSelectionChange}
        toolbarActions={
          <>
            <Button
              variant={isLowStockActive ? 'destructive' : 'outline'}
              size="sm"
              onClick={handleToggleLowStock}
            >
              <AlertTriangle className="h-4 w-4 mr-2" />
              {isLowStockActive ? 'Bajo stock ✕' : 'Bajo stock'}
            </Button>
            {selectedIds.length > 0 && permissions.canUpdate && (
              <>
                <Button
                  variant="outline"
                  onClick={() => setBulkEditOpen(true)}
                >
                  <Pencil className="h-4 w-4 mr-2" />
                  Editar en Lote ({selectedIds.length})
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setBulkPriceOpen(true)}
                >
                  <DollarSign className="h-4 w-4 mr-2" />
                  Ajustar Precios ({selectedIds.length})
                </Button>
              </>
            )}
            {selectedIds.length > 0 && permissions.canView && (
              <Button
                variant="outline"
                onClick={() => setLabelPrintOpen(true)}
              >
                <Tag className="h-4 w-4 mr-2" />
                Imprimir Etiquetas ({selectedIds.length})
              </Button>
            )}
            {selectedIds.length === 0 && showCompareButton && (
              <Button
                variant="outline"
                onClick={() => setOemCompareOpen(true)}
              >
                <Scale className="h-4 w-4 mr-2" />
                Comparar por OEM
              </Button>
            )}
            {selectedIds.length === 0 && permissions.canCreate && (
              <Button
                variant="outline"
                onClick={() => setImportOpen(true)}
              >
                <FileSpreadsheet className="h-4 w-4 mr-2" />
                Importar Excel
              </Button>
            )}
            {permissions.canCreate && (
              <Button onClick={() => router.push('/dashboard/commercial/products/new')}>
                <Plus className="h-4 w-4 mr-2" />
                Nuevo Artículo
              </Button>
            )}
          </>
        }
      />

      {/* Modal de comparación por OEM */}
      {showCompareButton && (
        <_OemCompareModal
          open={oemCompareOpen}
          onOpenChange={setOemCompareOpen}
        />
      )}

      {/* Modal de importación desde Excel */}
      <_ProductImportModal
        open={importOpen}
        onOpenChange={setImportOpen}
        onSuccess={handleImportSuccess}
      />

      {/* Modal de edición masiva */}
      <_BulkEditModal
        selectedIds={selectedIds}
        open={bulkEditOpen}
        onOpenChange={setBulkEditOpen}
        onSuccess={handleBulkEditSuccess}
      />

      {/* Modal de ajuste masivo de precios */}
      <_BulkPriceAdjustModal
        selectedIds={selectedIds}
        open={bulkPriceOpen}
        onOpenChange={setBulkPriceOpen}
        onSuccess={handleBulkPriceSuccess}
      />

      {/* Modal de impresión de etiquetas */}
      <_LabelPrintModal
        selectedIds={selectedIds}
        open={labelPrintOpen}
        onOpenChange={setLabelPrintOpen}
      />

      {/* Diálogo de confirmación para eliminar */}
      <AlertDialog
        open={!!deletingProduct}
        onOpenChange={(open) => !open && setDeletingProduct(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar este artículo?</AlertDialogTitle>
            <AlertDialogDescription>
              El artículo "{deletingProduct?.name}" será eliminado permanentemente.
              Esta acción no se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
