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
  getAllEmployeeDocumentsForExport,
  type DocumentTypeFilterOption,
  type EmployeeDocumentListItem,
} from '../actions.server';
import { getEmployeeDocumentsColumns } from './_employeeDocumentsColumns';

// Iconos para estados
const stateIcons = {
  PENDING: Clock,
  SUBMITTED: Circle,
  APPROVED: CheckCircle2,
  REJECTED: XCircle,
  EXPIRED: AlertCircle,
};

interface Props {
  data: EmployeeDocumentListItem[];
  totalRows: number;
  searchParams: DataTableSearchParams;
  documentTypes: DocumentTypeFilterOption[];
  isMonthly?: boolean;
}

export function _EmployeeDocumentsDataTable({
  data,
  totalRows,
  searchParams,
  documentTypes,
  isMonthly = false,
}: Props) {
  const columns = getEmployeeDocumentsColumns();

  // Configuración de exportación a Excel
  const exportConfig: DataTableExportConfig<EmployeeDocumentListItem> = useMemo(
    () => ({
      fetchAllData: () => getAllEmployeeDocumentsForExport(searchParams, isMonthly),
      options: {
        filename: isMonthly ? 'documentos-empleados-mensuales' : 'documentos-empleados-permanentes',
        title: isMonthly ? 'Documentos Mensuales de Empleados' : 'Documentos Permanentes de Empleados',
        sheetName: 'Documentos',
      },
      formatters: {
        state: (val) => documentStateLabels[val as DocumentState] || String(val),
        'employee.firstName': (val) => (val as string) || '',
        'employee.lastName': (val) => (val as string) || '',
        'employee.employeeNumber': (val) => (val as string) || '',
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
      searchPlaceholder="Buscar por empleado o tipo de documento..."
      facetedFilters={facetedFilters}
      tableId="documents-employees"
      showFilterToggle
      enableRowSelection={true}
      showRowSelection={true}
      emptyMessage="No hay documentos de empleados"
      exportConfig={exportConfig}
      data-testid="employee-documents-table"
    />
  );
}
