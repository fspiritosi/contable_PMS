'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Building2, Plus, Truck, User } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';

import {
  DataTable,
  type DataTableFacetedFilterConfig,
  type DataTableSearchParams,
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
import { Button } from '@/shared/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/shared/components/ui/tabs';

import {
  deleteDocumentType,
  type DocumentTypeListItem,
  type DocumentTypeTab,
  type TabCounts,
} from '../../document-types/list/actions.server';
import { getColumns } from '../../document-types/list/columns';
import { _DocumentTypeFormModal } from '../../document-types/list/components/_DocumentTypeFormModal';
import { usePermissions } from '@/shared/hooks/usePermissions';

interface Props {
  data: DocumentTypeListItem[];
  totalRows: number;
  searchParams: DataTableSearchParams;
  tabCounts: TabCounts;
  currentTab: DocumentTypeTab;
}

export function _DocumentTypesTab({ data, totalRows, searchParams, tabCounts, currentTab }: Props) {
  const router = useRouter();
  const params = useSearchParams();
  const queryClient = useQueryClient();

  // Dialog states
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [formModalOpen, setFormModalOpen] = useState(false);
  const [selectedDocType, setSelectedDocType] = useState<DocumentTypeListItem | null>(null);

  // Mutation
  const deleteMutation = useMutation({
    mutationFn: deleteDocumentType,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['documentTypes'] });
      toast.success('Tipo de documento eliminado');
      setDeleteDialogOpen(false);
      setSelectedDocType(null);
      router.refresh();
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Error al eliminar');
    },
  });

  // Handlers
  const handleDelete = (docType: DocumentTypeListItem) => {
    setSelectedDocType(docType);
    setDeleteDialogOpen(true);
  };

  const handleEdit = (docType: DocumentTypeListItem) => {
    setSelectedDocType(docType);
    setFormModalOpen(true);
  };

  const handleCreate = () => {
    setSelectedDocType(null);
    setFormModalOpen(true);
  };

  const handleFormModalClose = (open: boolean) => {
    setFormModalOpen(open);
    if (!open) {
      setSelectedDocType(null);
    }
  };

  const { hasPermission } = usePermissions();
  const canUpdate = hasPermission('documents', 'update');
  const canDelete = hasPermission('documents', 'delete');

  // Obtener columnas con handlers
  const columns = getColumns({ onDelete: handleDelete, onEdit: handleEdit, canUpdate, canDelete });

  // Cambio de tab interno (docTypeTab) - preservar tab=types
  const handleDocTypeTabChange = (docTypeTab: string) => {
    const newParams = new URLSearchParams();
    newParams.set('tab', 'types');
    if (docTypeTab !== 'ALL') {
      newParams.set('docTypeTab', docTypeTab);
    }
    // Reset page when changing docTypeTab
    router.push(`/dashboard/documents?${newParams.toString()}`);
  };

  // Configurar filtros faceteados
  const facetedFilters: DataTableFacetedFilterConfig[] = [
    {
      columnId: 'isMandatory',
      title: 'Obligatorio',
      options: [
        { value: 'true', label: 'Sí' },
        { value: 'false', label: 'No' },
      ],
    },
    {
      columnId: 'hasExpiration',
      title: 'Vence',
      options: [
        { value: 'true', label: 'Sí' },
        { value: 'false', label: 'No' },
      ],
    },
    {
      columnId: 'isMonthly',
      title: 'Mensual',
      options: [
        { value: 'true', label: 'Sí' },
        { value: 'false', label: 'No' },
      ],
    },
  ];

  // Botón de nuevo tipo para el toolbar
  const toolbarActions = (
    <Button onClick={handleCreate} data-testid="new-document-type-button">
      <Plus className="mr-2 h-4 w-4" />
      Nuevo Tipo
    </Button>
  );

  return (
    <div className="space-y-4">
      {/* Tabs para filtrar por appliesTo */}
      <Tabs
        value={currentTab}
        onValueChange={handleDocTypeTabChange}
        data-testid="doctype-filter-tabs"
      >
        <TabsList>
          <TabsTrigger value="ALL">Todos ({tabCounts.ALL})</TabsTrigger>
          <TabsTrigger value="EMPLOYEE">
            <User className="mr-2 h-4 w-4" />
            Empleados ({tabCounts.EMPLOYEE})
          </TabsTrigger>
          <TabsTrigger value="EQUIPMENT">
            <Truck className="mr-2 h-4 w-4" />
            Equipos ({tabCounts.EQUIPMENT})
          </TabsTrigger>
          <TabsTrigger value="COMPANY">
            <Building2 className="mr-2 h-4 w-4" />
            Empresa ({tabCounts.COMPANY})
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {/* DataTable */}
      <DataTable
        columns={columns}
        data={data}
        totalRows={totalRows}
        searchParams={searchParams}
        searchPlaceholder="Buscar por nombre..."
        facetedFilters={facetedFilters}
        tableId="documents-types-overview"
        showFilterToggle
        enableRowSelection={true}
        showRowSelection={true}
        toolbarActions={toolbarActions}
        emptyMessage="No hay tipos de documento configurados"
        data-testid="document-types-table"
      />

      {/* Modal de creación/edición */}
      <_DocumentTypeFormModal
        open={formModalOpen}
        onOpenChange={handleFormModalClose}
        documentType={selectedDocType}
      />

      {/* Dialog de confirmación de eliminación */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent data-testid="document-type-delete-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar tipo de documento?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta acción eliminará el tipo de documento <strong>{selectedDocType?.name}</strong>.
              Esta acción no se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="document-type-delete-cancel">
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => selectedDocType && deleteMutation.mutate(selectedDocType.id)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleteMutation.isPending}
              data-testid="document-type-delete-confirm"
            >
              {deleteMutation.isPending ? 'Eliminando...' : 'Eliminar'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
