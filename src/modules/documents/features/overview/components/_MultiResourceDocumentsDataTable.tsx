'use client';

import { useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Clock } from 'lucide-react';
import { useState } from 'react';

import {
  DataTable,
  type DataTableFacetedFilterConfig,
} from '@/shared/components/common/DataTable';

import type { MultiResourceDocumentTypeWithStatus } from '../actions.server';
import { getMultiResourceDocumentsColumns } from './_multiResourceDocumentsColumns';
import { _MultiResourceUploadModal } from './_MultiResourceUploadModal';

// ============================================
// TIPOS
// ============================================

interface Props {
  data: MultiResourceDocumentTypeWithStatus[];
  appliesTo: 'EMPLOYEE' | 'EQUIPMENT';
  emptyMessage?: string;
}

// ============================================
// COMPONENT
// ============================================

export function _MultiResourceDocumentsDataTable({
  data,
  appliesTo,
  emptyMessage = 'No hay tipos de documento multirrecurso configurados',
}: Props) {
  const queryClient = useQueryClient();
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [selectedDocType, setSelectedDocType] = useState<
    MultiResourceDocumentTypeWithStatus['documentType'] | null
  >(null);

  const handleUploadClick = (docType: MultiResourceDocumentTypeWithStatus['documentType']) => {
    setSelectedDocType(docType);
    setUploadModalOpen(true);
  };

  const handleUploadSuccess = () => {
    // Invalidar queries para refrescar datos
    if (appliesTo === 'EMPLOYEE') {
      queryClient.invalidateQueries({ queryKey: ['multiResourceEmployeeDocTypesWithStatus'] });
      queryClient.invalidateQueries({ queryKey: ['multiResourceEmployeeDocsStats'] });
    } else {
      queryClient.invalidateQueries({ queryKey: ['multiResourceEquipmentDocTypesWithStatus'] });
      queryClient.invalidateQueries({ queryKey: ['multiResourceEquipmentDocsStats'] });
    }
    setUploadModalOpen(false);
    setSelectedDocType(null);
  };

  const columns = getMultiResourceDocumentsColumns({
    appliesTo,
    onUploadClick: handleUploadClick,
  });

  // Configurar filtros faceteados
  const facetedFilters: DataTableFacetedFilterConfig[] = [
    {
      columnId: 'status',
      title: 'Estado',
      options: [
        { value: 'uploaded', label: 'Subido', icon: CheckCircle2 },
        { value: 'pending', label: 'Pendiente', icon: Clock },
      ],
    },
  ];

  return (
    <>
      <DataTable
        columns={columns}
        data={data}
        totalRows={data.length}
        searchPlaceholder="Buscar por tipo de documento..."
        facetedFilters={facetedFilters}
        tableId="documents-multi-resource"
        showFilterToggle
        enableRowSelection={true}
        showRowSelection={true}
        emptyMessage={emptyMessage}
        data-testid="multi-resource-documents-table"
      />

      {/* Modal de Upload */}
      {selectedDocType && (
        <_MultiResourceUploadModal
          documentType={selectedDocType}
          appliesTo={appliesTo}
          open={uploadModalOpen}
          onOpenChange={setUploadModalOpen}
          onSuccess={handleUploadSuccess}
        />
      )}
    </>
  );
}
