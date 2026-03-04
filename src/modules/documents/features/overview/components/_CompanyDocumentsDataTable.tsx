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
  getAllCompanyDocumentsForExport,
  type CompanyDocumentListItem,
  type DocumentTypeFilterOption,
} from '../actions.server';
import { getCompanyDocumentsColumns } from './_companyDocumentsColumns';

// Iconos para estados
const stateIcons = {
  PENDING: Clock,
  SUBMITTED: Circle,
  APPROVED: CheckCircle2,
  REJECTED: XCircle,
  EXPIRED: AlertCircle,
};

interface Props {
  data: CompanyDocumentListItem[];
  totalRows: number;
  searchParams: DataTableSearchParams;
  documentTypes: DocumentTypeFilterOption[];
}

export function _CompanyDocumentsDataTable({
  data,
  totalRows,
  searchParams,
  documentTypes,
}: Props) {
  const columns = getCompanyDocumentsColumns();

  // Configuración de exportación a Excel
  const exportConfig: DataTableExportConfig<CompanyDocumentListItem> = useMemo(
    () => ({
      fetchAllData: () => getAllCompanyDocumentsForExport(searchParams),
      options: {
        filename: 'documentos-empresa',
        title: 'Documentos de Empresa',
        sheetName: 'Documentos',
      },
      formatters: {
        state: (val) => documentStateLabels[val as DocumentState] || String(val),
        'documentType.name': (val) => (val as string) || '',
        'documentType.isMandatory': (val) => (val ? 'Sí' : 'No'),
        period: (val) => (val as string) || '',
      },
    }),
    [searchParams]
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
      searchPlaceholder="Buscar por tipo de documento..."
      facetedFilters={facetedFilters}
      tableId="documents-company"
      showFilterToggle
      enableRowSelection={true}
      showRowSelection={true}
      emptyMessage="No hay documentos de empresa"
      exportConfig={exportConfig}
      data-testid="company-documents-table"
    />
  );
}
