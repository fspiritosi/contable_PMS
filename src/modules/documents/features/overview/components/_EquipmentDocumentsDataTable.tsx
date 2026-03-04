'use client';

import {
  AlertCircle,
  CheckCircle2,
  Circle,
  Clock,
  XCircle,
} from 'lucide-react';
import { useMemo } from 'react';

import { DocumentState } from '@/generated/prisma/enums';
import {
  DataTable,
  type DataTableExportConfig,
  type DataTableFacetedFilterConfig,
  type DataTableSearchParams,
} from '@/shared/components/common/DataTable';
import { documentStateLabels } from '@/shared/utils/mappers';

import {
  getAllEquipmentDocumentsForExport,
  type DocumentTypeFilterOption,
  type EquipmentDocumentListItem,
} from '../actions.server';
import { getEquipmentDocumentsColumns } from './_equipmentDocumentsColumns';

// Iconos para estados
const stateIcons = {
  PENDING: Clock,
  SUBMITTED: Circle,
  APPROVED: CheckCircle2,
  REJECTED: XCircle,
  EXPIRED: AlertCircle,
};

interface Props {
  data: EquipmentDocumentListItem[];
  totalRows: number;
  searchParams: DataTableSearchParams;
  documentTypes: DocumentTypeFilterOption[];
  isMonthly?: boolean;
}

export function _EquipmentDocumentsDataTable({
  data,
  totalRows,
  searchParams,
  documentTypes,
  isMonthly = false,
}: Props) {
  const columns = getEquipmentDocumentsColumns();

  // Configuración de exportación a Excel
  const exportConfig: DataTableExportConfig<EquipmentDocumentListItem> = useMemo(
    () => ({
      fetchAllData: () => getAllEquipmentDocumentsForExport(searchParams, isMonthly),
      options: {
        filename: isMonthly ? 'documentos-equipos-mensuales' : 'documentos-equipos-permanentes',
        title: isMonthly ? 'Documentos Mensuales de Equipos' : 'Documentos Permanentes de Equipos',
        sheetName: 'Documentos',
      },
      formatters: {
        state: (val) => documentStateLabels[val as DocumentState] || String(val),
        'vehicle.domain': (val) => (val as string) || '',
        'vehicle.internNumber': (val) => (val as string) || '',
        'documentType.name': (val) => (val as string) || '',
        'documentType.isMandatory': (val) => (val ? 'Sí' : 'No'),
      },
    }),
    [searchParams, isMonthly]
  );

  // Configurar filtros faceteados
  const facetedFilters: DataTableFacetedFilterConfig[] = [
    {
      columnId: 'state',
      title: 'Estado',
      options: Object.values(DocumentState).map((value) => ({
        value,
        label: documentStateLabels[value],
        icon: stateIcons[value],
      })),
    },
    {
      columnId: 'documentType',
      title: 'Tipo de Documento',
      options: documentTypes.map((dt) => ({
        value: dt.id,
        label: dt.name,
      })),
    },
  ];

  return (
    <DataTable
      columns={columns}
      data={data}
      totalRows={totalRows}
      searchParams={searchParams}
      searchPlaceholder="Buscar por equipo o tipo de documento..."
      facetedFilters={facetedFilters}
      tableId="documents-equipment"
      showFilterToggle
      enableRowSelection={true}
      showRowSelection={true}
      emptyMessage="No hay documentos de equipos"
      exportConfig={exportConfig}
      data-testid="equipment-documents-table"
    />
  );
}
