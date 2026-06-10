'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/components/ui/card';
import { Badge } from '@/shared/components/ui/badge';
import { ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react';
import { cn } from '@/shared/lib/utils';
import moment from 'moment';
import { VOUCHER_TYPE_LABELS, INVOICE_STATUS_LABELS } from '../../invoices/shared/validators';
import { customerTaxConditionLabels } from '@/shared/utils/mappers';
import { formatCurrency } from '@/shared/utils/formatters';
import { CheckCircle, FileText, XCircle } from 'lucide-react';

// Tipo de datos por período
interface SalesByPeriodData {
  invoices: Array<{
    id: string;
    fullNumber: string;
    voucherType: string;
    issueDate: Date;
    subtotal: number;
    vatAmount: number;
    total: number;
    status: string;
    customer: { name: string };
  }>;
  totals: {
    subtotal: number;
    vatAmount: number;
    total: number;
    count: number;
  };
}

// Tipo de datos por cliente
interface SalesByCustomerData {
  salesByCustomer: Array<{
    customerId: string;
    customerName: string;
    taxId: string | null;
    invoiceCount: number;
    subtotal: number;
    vatAmount: number;
    total: number;
  }>;
  totals: {
    subtotal: number;
    vatAmount: number;
    total: number;
    customerCount: number;
  };
}

// Tipo de datos por producto
interface SalesByProductData {
  salesByProduct: Array<{
    productId: string;
    productCode: string;
    productName: string;
    unitOfMeasure: string;
    quantity: number;
    subtotal: number;
    vatAmount: number;
    total: number;
  }>;
  totals: {
    subtotal: number;
    vatAmount: number;
    total: number;
    productCount: number;
  };
}

// Tipo de datos libro IVA
interface VATSalesBookData {
  vatBook: Array<{
    id: string;
    fullNumber: string;
    voucherType: string;
    issueDate: Date;
    customerName: string;
    customerTaxId: string | null;
    customerTaxCondition: string;
    subtotal: number;
    vatAmount: number;
    total: number;
    cae: string | null;
    vatByRate: Array<{
      rate: number;
      base: number;
      amount: number;
    }>;
  }>;
  totals: {
    subtotal: number;
    vatAmount: number;
    total: number;
    invoiceCount: number;
  };
  vatSummary: Array<{
    rate: number;
    base: number;
    amount: number;
  }>;
}

type ReportData =
  | SalesByPeriodData
  | SalesByCustomerData
  | SalesByProductData
  | VATSalesBookData
  | null;

interface Props {
  reportType: 'period' | 'customer' | 'product' | 'vat' | null;
  data: ReportData;
  startDate?: Date;
  endDate?: Date;
}

// --- Sorting helpers ---

type SortConfig = { key: string; direction: 'asc' | 'desc' };

function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, part) => {
    if (acc && typeof acc === 'object') return (acc as Record<string, unknown>)[part];
    return undefined;
  }, obj);
}

function sortData<T>(data: T[], config: SortConfig | null): T[] {
  if (!config) return data;
  return [...data].sort((a, b) => {
    const aVal = getNestedValue(a as Record<string, unknown>, config.key);
    const bVal = getNestedValue(b as Record<string, unknown>, config.key);

    if (aVal == null && bVal == null) return 0;
    if (aVal == null) return 1;
    if (bVal == null) return -1;

    let comparison = 0;
    if (typeof aVal === 'string' && typeof bVal === 'string') {
      comparison = aVal.localeCompare(bVal);
    } else if (aVal instanceof Date || bVal instanceof Date) {
      comparison = new Date(aVal as string | Date).getTime() - new Date(bVal as string | Date).getTime();
    } else {
      comparison = Number(aVal) - Number(bVal);
    }

    return config.direction === 'asc' ? comparison : -comparison;
  });
}

function SortableHeader({
  label,
  sortKey,
  sortConfig,
  onSort,
  align,
}: {
  label: string;
  sortKey: string;
  sortConfig: SortConfig | null;
  onSort: (key: string) => void;
  align?: 'right';
}) {
  const isActive = sortConfig?.key === sortKey;
  const Icon = isActive
    ? sortConfig.direction === 'asc' ? ArrowUp : ArrowDown
    : ArrowUpDown;

  return (
    <th
      className={cn(
        'pb-3 cursor-pointer select-none hover:text-foreground transition-colors',
        align === 'right' && 'text-right',
      )}
      onClick={() => onSort(sortKey)}
    >
      <div className={cn('flex items-center gap-1', align === 'right' && 'justify-end')}>
        {label}
        <Icon className={cn('h-3 w-3 shrink-0', !isActive && 'opacity-50')} />
      </div>
    </th>
  );
}

function getStatusBadge(status: string) {
  const label = INVOICE_STATUS_LABELS[status as keyof typeof INVOICE_STATUS_LABELS] || status;
  switch (status) {
    case 'DRAFT':
      return (
        <Badge variant="outline" className="gap-1">
          <FileText className="h-3 w-3" />
          {label}
        </Badge>
      );
    case 'CONFIRMED':
      return (
        <Badge variant="default" className="gap-1">
          <CheckCircle className="h-3 w-3" />
          {label}
        </Badge>
      );
    case 'PAID':
      return (
        <Badge variant="success" className="gap-1">
          <CheckCircle className="h-3 w-3" />
          {label}
        </Badge>
      );
    case 'PARTIAL_PAID':
      return (
        <Badge variant="warning" className="gap-1">
          <CheckCircle className="h-3 w-3" />
          {label}
        </Badge>
      );
    case 'CANCELLED':
      return (
        <Badge variant="destructive" className="gap-1">
          <XCircle className="h-3 w-3" />
          {label}
        </Badge>
      );
    default:
      return <Badge variant="outline">{label}</Badge>;
  }
}

// --- Main Component ---

export function _SalesReportTable({ reportType, data, startDate, endDate }: Props) {
  const [sortConfig, setSortConfig] = useState<SortConfig | null>(null);

  useEffect(() => {
    setSortConfig(null);
  }, [reportType]);

  const handleSort = useCallback((key: string) => {
    setSortConfig((prev) => {
      if (prev?.key === key) {
        return prev.direction === 'asc'
          ? { key, direction: 'desc' as const }
          : null;
      }
      return { key, direction: 'asc' as const };
    });
  }, []);

  if (!data || !reportType) {
    return (
      <Card>
        <CardContent className="pt-6">
          <p className="text-center text-muted-foreground">
            Selecciona un tipo de reporte y genera para ver los resultados
          </p>
        </CardContent>
      </Card>
    );
  }

  const headerProps = { sortConfig, onSort: handleSort };

  const renderPeriodReport = (data: SalesByPeriodData) => {
    const invoices = sortData(data.invoices || [], sortConfig);

    return (
      <Card>
        <CardHeader>
          <CardTitle>Ventas por Período</CardTitle>
          <CardDescription>
            {startDate && endDate && (
              <>
                {moment(startDate).format('DD/MM/YYYY')} - {moment(endDate).format('DD/MM/YYYY')}
              </>
            )}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {invoices.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">
              No hay ventas en el período seleccionado
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b">
                  <tr className="text-left">
                    <SortableHeader label="Fecha" sortKey="issueDate" {...headerProps} />
                    <SortableHeader label="Nro. Comprobante" sortKey="fullNumber" {...headerProps} />
                    <SortableHeader label="Tipo" sortKey="voucherType" {...headerProps} />
                    <SortableHeader label="Cliente" sortKey="customer.name" {...headerProps} />
                    <SortableHeader label="Subtotal" sortKey="subtotal" align="right" {...headerProps} />
                    <SortableHeader label="IVA" sortKey="vatAmount" align="right" {...headerProps} />
                    <SortableHeader label="Total" sortKey="total" align="right" {...headerProps} />
                    <th className="pb-3 pl-4">
                      <div className="flex items-center gap-1 cursor-pointer select-none hover:text-foreground transition-colors" onClick={() => handleSort('status')}>
                        Estado
                        {sortConfig?.key === 'status' ? (
                          sortConfig.direction === 'asc' ? <ArrowUp className="h-3 w-3 shrink-0" /> : <ArrowDown className="h-3 w-3 shrink-0" />
                        ) : (
                          <ArrowUpDown className="h-3 w-3 shrink-0 opacity-50" />
                        )}
                      </div>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {invoices.map((inv) => (
                    <tr key={inv.id}>
                      <td className="py-3">{moment(inv.issueDate).format('DD/MM/YYYY')}</td>
                      <td className="py-3 font-mono">{inv.fullNumber}</td>
                      <td className="py-3">
                        {VOUCHER_TYPE_LABELS[inv.voucherType as keyof typeof VOUCHER_TYPE_LABELS]}
                      </td>
                      <td className="py-3">{inv.customer.name}</td>
                      <td className="py-3 text-right font-mono">
                        {formatCurrency(Number(inv.subtotal))}
                      </td>
                      <td className="py-3 text-right font-mono">
                        {formatCurrency(Number(inv.vatAmount))}
                      </td>
                      <td className="py-3 text-right font-mono font-semibold">
                        {formatCurrency(Number(inv.total))}
                      </td>
                      <td className="py-3 pl-4">
                        {getStatusBadge(inv.status)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t-2 font-semibold">
                  <tr>
                    <td className="pt-3" colSpan={4}>
                      TOTALES ({data.totals?.count || 0} facturas)
                    </td>
                    <td className="pt-3 text-right font-mono">{formatCurrency(data.totals?.subtotal || 0)}</td>
                    <td className="pt-3 text-right font-mono">
                      {formatCurrency(data.totals?.vatAmount || 0)}
                    </td>
                    <td className="pt-3 text-right font-mono">{formatCurrency(data.totals?.total || 0)}</td>
                    <td></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    );
  };

  const renderCustomerReport = (data: SalesByCustomerData) => {
    const customers = sortData(data.salesByCustomer || [], sortConfig);

    return (
      <Card>
        <CardHeader>
          <CardTitle>Ventas por Cliente</CardTitle>
          <CardDescription>
            {startDate && endDate && (
              <>
                {moment(startDate).format('DD/MM/YYYY')} - {moment(endDate).format('DD/MM/YYYY')}
              </>
            )}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {customers.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">
              No hay ventas en el período seleccionado
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b">
                  <tr className="text-left">
                    <SortableHeader label="Cliente" sortKey="customerName" {...headerProps} />
                    <SortableHeader label="CUIT" sortKey="taxId" {...headerProps} />
                    <SortableHeader label="Cant. Facturas" sortKey="invoiceCount" align="right" {...headerProps} />
                    <SortableHeader label="Subtotal" sortKey="subtotal" align="right" {...headerProps} />
                    <SortableHeader label="IVA" sortKey="vatAmount" align="right" {...headerProps} />
                    <SortableHeader label="Total" sortKey="total" align="right" {...headerProps} />
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {customers.map((customer) => (
                    <tr key={customer.customerId}>
                      <td className="py-3">{customer.customerName}</td>
                      <td className="py-3 font-mono">{customer.taxId || '-'}</td>
                      <td className="py-3 text-right">{customer.invoiceCount}</td>
                      <td className="py-3 text-right font-mono">
                        {formatCurrency(customer.subtotal)}
                      </td>
                      <td className="py-3 text-right font-mono">{formatCurrency(customer.vatAmount)}</td>
                      <td className="py-3 text-right font-mono font-semibold">
                        {formatCurrency(customer.total)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t-2 font-semibold">
                  <tr>
                    <td className="pt-3" colSpan={3}>
                      TOTALES ({data.totals?.customerCount || 0} clientes)
                    </td>
                    <td className="pt-3 text-right font-mono">
                      {formatCurrency(data.totals?.subtotal || 0)}
                    </td>
                    <td className="pt-3 text-right font-mono">
                      {formatCurrency(data.totals?.vatAmount || 0)}
                    </td>
                    <td className="pt-3 text-right font-mono">{formatCurrency(data.totals?.total || 0)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    );
  };

  const renderProductReport = (data: SalesByProductData) => {
    const products = sortData(data.salesByProduct || [], sortConfig);

    return (
      <Card>
        <CardHeader>
          <CardTitle>Ventas por Producto</CardTitle>
          <CardDescription>
            {startDate && endDate && (
              <>
                {moment(startDate).format('DD/MM/YYYY')} - {moment(endDate).format('DD/MM/YYYY')}
              </>
            )}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {products.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">
              No hay ventas en el período seleccionado
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b">
                  <tr className="text-left">
                    <SortableHeader label="Código" sortKey="productCode" {...headerProps} />
                    <SortableHeader label="Producto" sortKey="productName" {...headerProps} />
                    <SortableHeader label="Cantidad" sortKey="quantity" align="right" {...headerProps} />
                    <th className="pb-3">UM</th>
                    <SortableHeader label="Subtotal" sortKey="subtotal" align="right" {...headerProps} />
                    <SortableHeader label="IVA" sortKey="vatAmount" align="right" {...headerProps} />
                    <SortableHeader label="Total" sortKey="total" align="right" {...headerProps} />
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {products.map((product) => (
                    <tr key={product.productId}>
                      <td className="py-3 font-mono">{product.productCode}</td>
                      <td className="py-3">{product.productName}</td>
                      <td className="py-3 text-right font-mono">{product.quantity.toFixed(3)}</td>
                      <td className="py-3">{product.unitOfMeasure}</td>
                      <td className="py-3 text-right font-mono">{formatCurrency(product.subtotal)}</td>
                      <td className="py-3 text-right font-mono">{formatCurrency(product.vatAmount)}</td>
                      <td className="py-3 text-right font-mono font-semibold">
                        {formatCurrency(product.total)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t-2 font-semibold">
                  <tr>
                    <td className="pt-3" colSpan={4}>
                      TOTALES ({data.totals?.productCount || 0} productos)
                    </td>
                    <td className="pt-3 text-right font-mono">{formatCurrency(data.totals?.subtotal || 0)}</td>
                    <td className="pt-3 text-right font-mono">
                      {formatCurrency(data.totals?.vatAmount || 0)}
                    </td>
                    <td className="pt-3 text-right font-mono">{formatCurrency(data.totals?.total || 0)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    );
  };

  const renderVATReport = (data: VATSalesBookData) => {
    const vatBook = sortData(data.vatBook || [], sortConfig);
    const vatSummary = data.vatSummary || [];

    return (
      <>
        <Card>
          <CardHeader>
            <CardTitle>Libro IVA Ventas</CardTitle>
            <CardDescription>
              {startDate && endDate && (
                <>
                  {moment(startDate).format('DD/MM/YYYY')} - {moment(endDate).format('DD/MM/YYYY')}
                </>
              )}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {vatBook.length === 0 ? (
              <p className="text-center text-muted-foreground py-8">
                No hay ventas en el período seleccionado
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b">
                    <tr className="text-left">
                      <SortableHeader label="Fecha" sortKey="issueDate" {...headerProps} />
                      <SortableHeader label="Comprobante" sortKey="fullNumber" {...headerProps} />
                      <SortableHeader label="Cliente" sortKey="customerName" {...headerProps} />
                      <SortableHeader label="CUIT" sortKey="customerTaxId" {...headerProps} />
                      <th className="pb-3">Cond. IVA</th>
                      <SortableHeader label="Neto" sortKey="subtotal" align="right" {...headerProps} />
                      <SortableHeader label="IVA" sortKey="vatAmount" align="right" {...headerProps} />
                      <SortableHeader label="Total" sortKey="total" align="right" {...headerProps} />
                      <th className="pb-3">CAE</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {vatBook.map((inv) => (
                      <tr key={inv.id}>
                        <td className="py-3">{moment(inv.issueDate).format('DD/MM/YYYY')}</td>
                        <td className="py-3 font-mono text-xs">{inv.fullNumber}</td>
                        <td className="py-3">{inv.customerName}</td>
                        <td className="py-3 font-mono text-xs">{inv.customerTaxId || '-'}</td>
                        <td className="py-3 text-xs">
                          {customerTaxConditionLabels[inv.customerTaxCondition as keyof typeof customerTaxConditionLabels] || inv.customerTaxCondition}
                        </td>
                        <td className="py-3 text-right font-mono">{formatCurrency(inv.subtotal)}</td>
                        <td className="py-3 text-right font-mono">{formatCurrency(inv.vatAmount)}</td>
                        <td className="py-3 text-right font-mono font-semibold">
                          {formatCurrency(inv.total)}
                        </td>
                        <td className="py-3 font-mono text-xs">{inv.cae || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="border-t-2 font-semibold">
                    <tr>
                      <td className="pt-3" colSpan={5}>
                        TOTALES ({data.totals?.invoiceCount || 0} facturas)
                      </td>
                      <td className="pt-3 text-right font-mono">
                        {formatCurrency(data.totals?.subtotal || 0)}
                      </td>
                      <td className="pt-3 text-right font-mono">
                        {formatCurrency(data.totals?.vatAmount || 0)}
                      </td>
                      <td className="pt-3 text-right font-mono">{formatCurrency(data.totals?.total || 0)}</td>
                      <td></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Resumen por alícuota */}
        {vatSummary.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Resumen IVA por Alícuota</CardTitle>
            </CardHeader>
            <CardContent>
              <table className="w-full text-sm">
                <thead className="border-b">
                  <tr className="text-left">
                    <th className="pb-3">Alícuota</th>
                    <th className="pb-3 text-right">Base Imponible</th>
                    <th className="pb-3 text-right">Impuesto</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {vatSummary.map((vat) => (
                    <tr key={vat.rate}>
                      <td className="py-3 font-semibold">{vat.rate}%</td>
                      <td className="py-3 text-right font-mono">{formatCurrency(vat.base)}</td>
                      <td className="py-3 text-right font-mono">{formatCurrency(vat.amount)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t-2 font-semibold">
                  <tr>
                    <td className="pt-3">TOTAL</td>
                    <td className="pt-3 text-right font-mono">
                      {formatCurrency(vatSummary.reduce((sum, v) => sum + v.base, 0))}
                    </td>
                    <td className="pt-3 text-right font-mono">
                      {formatCurrency(vatSummary.reduce((sum, v) => sum + v.amount, 0))}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </CardContent>
          </Card>
        )}
      </>
    );
  };

  switch (reportType) {
    case 'period':
      return renderPeriodReport(data as SalesByPeriodData);
    case 'customer':
      return renderCustomerReport(data as SalesByCustomerData);
    case 'product':
      return renderProductReport(data as SalesByProductData);
    case 'vat':
      return renderVATReport(data as VATSalesBookData);
    default:
      return null;
  }
}
