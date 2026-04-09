'use client';

import { useMemo } from 'react';
import moment from 'moment';
import { createColumnHelper } from '@tanstack/react-table';

import { Badge } from '@/shared/components/ui/badge';
import { DataTable } from '@/shared/components/common/DataTable';
import type { DataTableFacetedFilterConfig, DataTableSearchParams } from '@/shared/components/common/DataTable';

import { WITHHOLDING_TAX_TYPE_LABELS } from '../../../../shared/validators';
import { getAllWithholdingsReceived } from '../actions.server';
import { formatCurrency } from '@/shared/utils/formatters';

type WithholdingRow = Awaited<ReturnType<typeof getAllWithholdingsReceived>>[number];

const columnHelper = createColumnHelper<WithholdingRow>();

const columns = [
  columnHelper.accessor('receiptDate', {
    header: 'Fecha',
    meta: { title: 'Fecha' },
    cell: (info) => moment(info.getValue()).format('DD/MM/YYYY'),
  }),
  columnHelper.accessor('receiptFullNumber', {
    header: 'Recibo',
    meta: { title: 'Recibo' },
    cell: (info) => (
      <span className="font-mono text-sm">{info.getValue()}</span>
    ),
  }),
  columnHelper.accessor('customerName', {
    header: 'Cliente',
    meta: { title: 'Cliente' },
  }),
  columnHelper.accessor('customerTaxId', {
    header: 'CUIT',
    meta: { title: 'CUIT' },
    cell: (info) => (
      <span className="font-mono text-sm">{info.getValue() || '-'}</span>
    ),
  }),
  columnHelper.accessor('taxType', {
    header: 'Tipo',
    meta: { title: 'Tipo' },
    cell: (info) => (
      <Badge variant="outline">
        {WITHHOLDING_TAX_TYPE_LABELS[info.getValue() as keyof typeof WITHHOLDING_TAX_TYPE_LABELS]}
      </Badge>
    ),
  }),
  columnHelper.accessor('rate', {
    header: 'Alícuota',
    meta: { title: 'Alícuota' },
    cell: (info) => `${info.getValue()}%`,
  }),
  columnHelper.accessor('amount', {
    header: 'Importe',
    meta: { title: 'Importe' },
    cell: (info) => (
      <span className="font-semibold">{formatCurrency(info.getValue())}</span>
    ),
  }),
  columnHelper.accessor('certificateNumber', {
    header: 'Nº Certificado',
    meta: { title: 'Nº Certificado' },
    cell: (info) => info.getValue() || '-',
  }),
];

interface Props {
  data: WithholdingRow[];
  totalRows: number;
  searchParams: DataTableSearchParams;
}

export function _WithholdingsTable({ data, totalRows, searchParams }: Props) {
  const facetedFilters: DataTableFacetedFilterConfig[] = useMemo(
    () => [
      {
        columnId: 'taxType',
        title: 'Tipo de Retención',
        options: Object.entries(WITHHOLDING_TAX_TYPE_LABELS).map(([value, label]) => ({
          value,
          label,
        })),
      },
      {
        columnId: 'receiptDate',
        title: 'Fecha',
        type: 'dateRange' as const,
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
      facetedFilters={facetedFilters}
      searchPlaceholder="Buscar por cliente, recibo o certificado..."
      tableId="treasury-withholdings"
      showFilterToggle
      exportConfig={{
        fetchAllData: getAllWithholdingsReceived as () => Promise<Record<string, unknown>[]>,
        options: {
          filename: `Retenciones_Recibidas_${moment().format('YYYY-MM-DD')}`,
          sheetName: 'Retenciones',
          title: 'Reporte de Retenciones Recibidas',
          includeDate: true,
        },
      }}
    />
  );
}
