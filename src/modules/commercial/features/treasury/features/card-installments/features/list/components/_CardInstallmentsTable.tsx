'use client';

import { useMemo } from 'react';

import {
  DataTable,
  type DataTableFacetedFilterConfig,
  type DataTableSearchParams,
} from '@/shared/components/common/DataTable';
import { getColumns, CARD_INSTALLMENT_STATUS_LABELS, type CardInstallment } from '../columns';

interface CardInstallmentsTableProps {
  data: CardInstallment[];
  totalRows: number;
  searchParams: DataTableSearchParams;
}

export function _CardInstallmentsTable({ data, totalRows, searchParams }: CardInstallmentsTableProps) {
  const columns = useMemo(() => getColumns(), []);

  const facetedFilters = useMemo<DataTableFacetedFilterConfig[]>(
    () => [
      {
        columnId: 'status',
        title: 'Estado',
        options: Object.entries(CARD_INSTALLMENT_STATUS_LABELS).map(([value, label]) => ({
          value,
          label,
        })),
      },
    ],
    []
  );

  return (
    <DataTable
      columns={columns}
      data={data}
      totalRows={totalRows}
      searchParams={searchParams}
      showSearch={false}
      tableId="commercial-treasury-card-installments"
      facetedFilters={facetedFilters}
      showFilterToggle
    />
  );
}
