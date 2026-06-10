'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/components/ui/card';
import { Badge } from '@/shared/components/ui/badge';
import { Button } from '@/shared/components/ui/button';
import { ArrowUpDown, ArrowUp, ArrowDown, CheckCircle, Download, FileText, XCircle } from 'lucide-react';
import { cn } from '@/shared/lib/utils';
import moment from 'moment';
import { formatCurrency } from '@/shared/utils/formatters';
import { exportToExcel, type ExcelColumn, type ExcelExportOptions } from '@/shared/lib/excel-export';
import { VOUCHER_TYPE_LABELS, PURCHASE_INVOICE_STATUS_LABELS } from '../../invoices/shared/validators';
import { supplierTaxConditionLabels } from '@/shared/utils/mappers';
import { toast } from 'sonner';

// Tipo de datos por período
interface PurchasesByPeriodData {
  invoices: Array<{
    id: string;
    fullNumber: string;
    voucherType: string;
    issueDate: Date;
    subtotal: number;
    vatAmount: number;
    total: number;
    status: string;
    supplier: { businessName: string };
  }>;
  totals: {
    subtotal: number;
    vatAmount: number;
    total: number;
    count: number;
  };
}

// Tipo de datos por proveedor
interface PurchasesBySupplierData {
  purchasesBySupplier: Array<{
    supplierId: string;
    supplierName: string;
    taxId: string;
    invoiceCount: number;
    subtotal: number;
    vatAmount: number;
    total: number;
  }>;
  totals: {
    subtotal: number;
    vatAmount: number;
    total: number;
    supplierCount: number;
  };
}

// Tipo de datos por producto
interface PurchasesByProductData {
  purchasesByProduct: Array<{
    productId: string | null;
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
interface VATPurchaseBookData {
  vatBook: Array<{
    id: string;
    fullNumber: string;
    voucherType: string;
    issueDate: Date;
    supplierName: string;
    supplierTaxId: string;
    supplierTaxCondition: string;
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
  | PurchasesByPeriodData
  | PurchasesBySupplierData
  | PurchasesByProductData
  | VATPurchaseBookData
  | null;

interface Props {
  reportType: 'period' | 'supplier' | 'product' | 'vat' | null;
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
  const label = PURCHASE_INVOICE_STATUS_LABELS[status as keyof typeof PURCHASE_INVOICE_STATUS_LABELS] || status;
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
      return <Badge variant="secondary">{label}</Badge>;
  }
}

// --- Main Component ---

export function _PurchaseReportTable({ reportType, data, startDate, endDate }: Props) {
  const [sortConfig, setSortConfig] = useState<SortConfig | null>(null);
  const [exporting, setExporting] = useState(false);

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

  const handleExport = async () => {
    if (!data || !reportType) return;

    setExporting(true);
    try {
      let columns: ExcelColumn[] = [];
      let rows: Record<string, unknown>[] = [];
      let options: ExcelExportOptions = { filename: 'reporte-compras', sheetName: 'Reporte' };

      switch (reportType) {
        case 'period': {
          const periodData = data as PurchasesByPeriodData;
          columns = [
            { key: 'issueDate', title: 'Fecha', formatter: (val) => val ? moment(val as string).format('DD/MM/YYYY') : '' },
            { key: 'fullNumber', title: 'Nro. Comprobante' },
            { key: 'voucherType', title: 'Tipo', formatter: (val) => VOUCHER_TYPE_LABELS[val as keyof typeof VOUCHER_TYPE_LABELS] || String(val) },
            { key: 'supplierName', title: 'Proveedor' },
            { key: 'subtotal', title: 'Subtotal', formatter: (val) => Number(val) },
            { key: 'vatAmount', title: 'IVA', formatter: (val) => Number(val) },
            { key: 'total', title: 'Total', formatter: (val) => Number(val) },
            { key: 'status', title: 'Estado', formatter: (val) => PURCHASE_INVOICE_STATUS_LABELS[val as keyof typeof PURCHASE_INVOICE_STATUS_LABELS] || String(val) },
          ];
          rows = (periodData.invoices || []).map((inv) => ({
            ...inv,
            supplierName: inv.supplier.businessName,
          }));
          options = {
            filename: 'compras-por-periodo',
            title: 'Compras por Período',
            sheetName: 'Por Período',
          };
          break;
        }
        case 'supplier': {
          const supplierData = data as PurchasesBySupplierData;
          columns = [
            { key: 'supplierName', title: 'Proveedor' },
            { key: 'taxId', title: 'CUIT' },
            { key: 'invoiceCount', title: 'Cant. Facturas' },
            { key: 'subtotal', title: 'Subtotal', formatter: (val) => Number(val) },
            { key: 'vatAmount', title: 'IVA', formatter: (val) => Number(val) },
            { key: 'total', title: 'Total', formatter: (val) => Number(val) },
          ];
          rows = supplierData.purchasesBySupplier || [];
          options = {
            filename: 'compras-por-proveedor',
            title: 'Compras por Proveedor',
            sheetName: 'Por Proveedor',
          };
          break;
        }
        case 'product': {
          const productData = data as PurchasesByProductData;
          columns = [
            { key: 'productCode', title: 'Código' },
            { key: 'productName', title: 'Producto' },
            { key: 'quantity', title: 'Cantidad', formatter: (val) => Number(val) },
            { key: 'unitOfMeasure', title: 'UM' },
            { key: 'subtotal', title: 'Subtotal', formatter: (val) => Number(val) },
            { key: 'vatAmount', title: 'IVA', formatter: (val) => Number(val) },
            { key: 'total', title: 'Total', formatter: (val) => Number(val) },
          ];
          rows = productData.purchasesByProduct || [];
          options = {
            filename: 'compras-por-producto',
            title: 'Compras por Producto',
            sheetName: 'Por Producto',
          };
          break;
        }
        case 'vat': {
          const vatData = data as VATPurchaseBookData;
          columns = [
            { key: 'issueDate', title: 'Fecha', formatter: (val) => val ? moment(val as string).format('DD/MM/YYYY') : '' },
            { key: 'fullNumber', title: 'Comprobante' },
            { key: 'supplierName', title: 'Proveedor' },
            { key: 'supplierTaxId', title: 'CUIT' },
            { key: 'supplierTaxCondition', title: 'Cond. IVA', formatter: (val) => supplierTaxConditionLabels[val as keyof typeof supplierTaxConditionLabels] || String(val) },
            { key: 'subtotal', title: 'Neto', formatter: (val) => Number(val) },
            { key: 'vatAmount', title: 'IVA', formatter: (val) => Number(val) },
            { key: 'total', title: 'Total', formatter: (val) => Number(val) },
            { key: 'cae', title: 'CAE' },
          ];
          rows = vatData.vatBook || [];
          options = {
            filename: 'libro-iva-compras',
            title: 'Libro IVA Compras',
            sheetName: 'Libro IVA',
          };
          break;
        }
      }

      if (rows.length === 0) {
        toast.warning('No hay datos para exportar');
        return;
      }

      await exportToExcel(rows as Record<string, unknown>[], columns, options);
      toast.success(`Exportado: ${rows.length} registros`);
    } catch {
      toast.error('Error al exportar');
    } finally {
      setExporting(false);
    }
  };

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

  const renderPeriodReport = (data: PurchasesByPeriodData) => {
    const invoices = sortData(data.invoices || [], sortConfig);

    return (
      <Card>
        <CardHeader>
          <CardTitle>Compras por Período</CardTitle>
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
              No hay compras en el período seleccionado
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b">
                  <tr className="text-left">
                    <SortableHeader label="Fecha" sortKey="issueDate" {...headerProps} />
                    <SortableHeader label="Nro. Comprobante" sortKey="fullNumber" {...headerProps} />
                    <SortableHeader label="Tipo" sortKey="voucherType" {...headerProps} />
                    <SortableHeader label="Proveedor" sortKey="supplier.businessName" {...headerProps} />
                    <SortableHeader label="Subtotal" sortKey="subtotal" align="right" {...headerProps} />
                    <SortableHeader label="IVA" sortKey="vatAmount" align="right" {...headerProps} />
                    <SortableHeader label="Total" sortKey="total" align="right" {...headerProps} />
                    <SortableHeader label="Estado" sortKey="status" {...headerProps} />
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
                      <td className="py-3">{inv.supplier.businessName}</td>
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

  const renderSupplierReport = (data: PurchasesBySupplierData) => {
    const suppliers = sortData(data.purchasesBySupplier || [], sortConfig);

    return (
      <Card>
        <CardHeader>
          <CardTitle>Compras por Proveedor</CardTitle>
          <CardDescription>
            {startDate && endDate && (
              <>
                {moment(startDate).format('DD/MM/YYYY')} - {moment(endDate).format('DD/MM/YYYY')}
              </>
            )}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {suppliers.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">
              No hay compras en el período seleccionado
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b">
                  <tr className="text-left">
                    <SortableHeader label="Proveedor" sortKey="supplierName" {...headerProps} />
                    <SortableHeader label="CUIT" sortKey="taxId" {...headerProps} />
                    <SortableHeader label="Cant. Facturas" sortKey="invoiceCount" align="right" {...headerProps} />
                    <SortableHeader label="Subtotal" sortKey="subtotal" align="right" {...headerProps} />
                    <SortableHeader label="IVA" sortKey="vatAmount" align="right" {...headerProps} />
                    <SortableHeader label="Total" sortKey="total" align="right" {...headerProps} />
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {suppliers.map((supplier) => (
                    <tr key={supplier.supplierId}>
                      <td className="py-3">{supplier.supplierName}</td>
                      <td className="py-3 font-mono">{supplier.taxId || '-'}</td>
                      <td className="py-3 text-right">{supplier.invoiceCount}</td>
                      <td className="py-3 text-right font-mono">
                        {formatCurrency(supplier.subtotal)}
                      </td>
                      <td className="py-3 text-right font-mono">{formatCurrency(supplier.vatAmount)}</td>
                      <td className="py-3 text-right font-mono font-semibold">
                        {formatCurrency(supplier.total)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t-2 font-semibold">
                  <tr>
                    <td className="pt-3" colSpan={3}>
                      TOTALES ({data.totals?.supplierCount || 0} proveedores)
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

  const renderProductReport = (data: PurchasesByProductData) => {
    const products = sortData(data.purchasesByProduct || [], sortConfig);

    return (
      <Card>
        <CardHeader>
          <CardTitle>Compras por Producto</CardTitle>
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
              No hay compras en el período seleccionado
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
                  {products.map((product, idx) => (
                    <tr key={product.productId || `line-${idx}`}>
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

  const renderVATReport = (data: VATPurchaseBookData) => {
    const vatBook = sortData(data.vatBook || [], sortConfig);
    const vatSummary = data.vatSummary || [];

    return (
      <>
        <Card>
          <CardHeader>
            <CardTitle>Libro IVA Compras</CardTitle>
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
                No hay compras en el período seleccionado
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b">
                    <tr className="text-left">
                      <SortableHeader label="Fecha" sortKey="issueDate" {...headerProps} />
                      <SortableHeader label="Comprobante" sortKey="fullNumber" {...headerProps} />
                      <SortableHeader label="Proveedor" sortKey="supplierName" {...headerProps} />
                      <SortableHeader label="CUIT" sortKey="supplierTaxId" {...headerProps} />
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
                        <td className="py-3">{inv.supplierName}</td>
                        <td className="py-3 font-mono text-xs">{inv.supplierTaxId || '-'}</td>
                        <td className="py-3 text-xs">
                          {supplierTaxConditionLabels[inv.supplierTaxCondition as keyof typeof supplierTaxConditionLabels] || inv.supplierTaxCondition}
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

  const reportContent = (() => {
    switch (reportType) {
      case 'period':
        return renderPeriodReport(data as PurchasesByPeriodData);
      case 'supplier':
        return renderSupplierReport(data as PurchasesBySupplierData);
      case 'product':
        return renderProductReport(data as PurchasesByProductData);
      case 'vat':
        return renderVATReport(data as VATPurchaseBookData);
      default:
        return null;
    }
  })();

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button
          variant="outline"
          size="sm"
          onClick={handleExport}
          disabled={exporting}
        >
          <Download className="mr-2 h-4 w-4" />
          {exporting ? 'Exportando...' : 'Exportar a Excel'}
        </Button>
      </div>
      {reportContent}
    </div>
  );
}
