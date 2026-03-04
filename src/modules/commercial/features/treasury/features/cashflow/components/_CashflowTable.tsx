'use client';

import { useState } from 'react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/shared/components/ui/table';
import { Button } from '@/shared/components/ui/button';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { formatCurrency } from '@/shared/utils/formatters';
import { cn } from '@/shared/lib/utils';
import type { CashflowRow, CashflowDetailItem } from '../actions.server';

interface Props {
  data: CashflowRow[];
}

type DetailCategory = {
  key: string;
  label: string;
  total: number;
  items: CashflowDetailItem[];
  type: 'inflow' | 'outflow';
};

function getCategoryDetails(row: CashflowRow): DetailCategory[] {
  const categories: DetailCategory[] = [];

  if (row.details.receipts > 0) {
    categories.push({
      key: 'receipts',
      label: 'Recibos de Cobro',
      total: row.details.receipts,
      items: row.details.receiptsItems,
      type: 'inflow',
    });
  }
  if (row.details.salesInvoices > 0) {
    categories.push({
      key: 'salesInvoices',
      label: 'Facturas por Cobrar',
      total: row.details.salesInvoices,
      items: row.details.salesInvoicesItems,
      type: 'inflow',
    });
  }
  if (row.details.checksIn > 0) {
    categories.push({
      key: 'checksIn',
      label: 'Cheques a Cobrar',
      total: row.details.checksIn,
      items: row.details.checksInItems,
      type: 'inflow',
    });
  }
  if (row.details.projectionsIn > 0) {
    categories.push({
      key: 'projectionsIn',
      label: 'Proyecciones Ingreso',
      total: row.details.projectionsIn,
      items: row.details.projectionsInItems,
      type: 'inflow',
    });
  }
  if (row.details.paymentOrders > 0) {
    categories.push({
      key: 'paymentOrders',
      label: 'Órdenes de Pago',
      total: row.details.paymentOrders,
      items: row.details.paymentOrdersItems,
      type: 'outflow',
    });
  }
  if (row.details.purchaseInvoices > 0) {
    categories.push({
      key: 'purchaseInvoices',
      label: 'Facturas por Pagar',
      total: row.details.purchaseInvoices,
      items: row.details.purchaseInvoicesItems,
      type: 'outflow',
    });
  }
  if (row.details.purchaseOrders > 0) {
    categories.push({
      key: 'purchaseOrders',
      label: 'Órdenes de Compra',
      total: row.details.purchaseOrders,
      items: row.details.purchaseOrdersItems,
      type: 'outflow',
    });
  }
  if (row.details.expenses > 0) {
    categories.push({
      key: 'expenses',
      label: 'Gastos',
      total: row.details.expenses,
      items: row.details.expensesItems,
      type: 'outflow',
    });
  }
  if (row.details.checksOut > 0) {
    categories.push({
      key: 'checksOut',
      label: 'Cheques a Pagar',
      total: row.details.checksOut,
      items: row.details.checksOutItems,
      type: 'outflow',
    });
  }
  if (row.details.projectionsOut > 0) {
    categories.push({
      key: 'projectionsOut',
      label: 'Proyecciones Egreso',
      total: row.details.projectionsOut,
      items: row.details.projectionsOutItems,
      type: 'outflow',
    });
  }

  return categories;
}

export function _CashflowTable({ data }: Props) {
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());

  const toggleRow = (period: string) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(period)) {
        next.delete(period);
      } else {
        next.add(period);
      }
      return next;
    });
  };

  const toggleCategory = (compositeKey: string) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(compositeKey)) {
        next.delete(compositeKey);
      } else {
        next.add(compositeKey);
      }
      return next;
    });
  };

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[200px]">Período</TableHead>
            <TableHead className="text-right">Ingresos</TableHead>
            <TableHead className="text-right">Egresos</TableHead>
            <TableHead className="text-right">Neto</TableHead>
            <TableHead className="text-right">Saldo Proyectado</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.map((row) => {
            const isExpanded = expandedRows.has(row.period);
            const categories = getCategoryDetails(row);
            const hasDetails = categories.length > 0;

            return (
              <>
                <TableRow
                  key={row.period}
                  className={cn(
                    'cursor-pointer hover:bg-muted/50',
                    hasDetails && 'font-medium'
                  )}
                  onClick={() => hasDetails && toggleRow(row.period)}
                >
                  <TableCell className="flex items-center gap-2">
                    {hasDetails && (
                      <Button variant="ghost" size="sm" className="h-5 w-5 p-0">
                        {isExpanded ? (
                          <ChevronDown className="h-3 w-3" />
                        ) : (
                          <ChevronRight className="h-3 w-3" />
                        )}
                      </Button>
                    )}
                    {!hasDetails && <span className="w-5" />}
                    {row.periodLabel}
                  </TableCell>
                  <TableCell className="text-right text-green-600">
                    {row.inflows > 0 ? formatCurrency(row.inflows) : '—'}
                  </TableCell>
                  <TableCell className="text-right text-destructive">
                    {row.outflows > 0 ? formatCurrency(row.outflows) : '—'}
                  </TableCell>
                  <TableCell
                    className={cn(
                      'text-right font-medium',
                      row.net >= 0 ? 'text-green-600' : 'text-destructive'
                    )}
                  >
                    {row.net !== 0 ? formatCurrency(row.net) : '—'}
                  </TableCell>
                  <TableCell
                    className={cn(
                      'text-right font-bold',
                      row.projectedBalance >= 0 ? '' : 'text-destructive'
                    )}
                  >
                    {formatCurrency(row.projectedBalance)}
                  </TableCell>
                </TableRow>

                {isExpanded && hasDetails && (
                  <>
                    {categories.map((cat) => {
                      const catKey = `${row.period}-${cat.key}`;
                      const isCatExpanded = expandedCategories.has(catKey);
                      const hasSubItems = cat.items.length > 1;

                      return (
                        <>
                          <TableRow
                            key={catKey}
                            className={cn(
                              'bg-muted/30',
                              hasSubItems && 'cursor-pointer hover:bg-muted/50'
                            )}
                            onClick={(e) => {
                              e.stopPropagation();
                              if (hasSubItems) toggleCategory(catKey);
                            }}
                          >
                            <TableCell className="pl-12 text-sm text-muted-foreground">
                              <span className="flex items-center gap-1.5">
                                {hasSubItems && (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-4 w-4 p-0"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      toggleCategory(catKey);
                                    }}
                                  >
                                    {isCatExpanded ? (
                                      <ChevronDown className="h-2.5 w-2.5" />
                                    ) : (
                                      <ChevronRight className="h-2.5 w-2.5" />
                                    )}
                                  </Button>
                                )}
                                {!hasSubItems && <span className="w-4" />}
                                {cat.label}
                                {hasSubItems && (
                                  <span className="text-xs text-muted-foreground/60">
                                    ({cat.items.length})
                                  </span>
                                )}
                              </span>
                            </TableCell>
                            {cat.type === 'inflow' ? (
                              <>
                                <TableCell className="text-right text-sm text-green-600">
                                  {formatCurrency(cat.total)}
                                </TableCell>
                                <TableCell />
                              </>
                            ) : (
                              <>
                                <TableCell />
                                <TableCell className="text-right text-sm text-destructive">
                                  {formatCurrency(cat.total)}
                                </TableCell>
                              </>
                            )}
                            <TableCell />
                            <TableCell />
                          </TableRow>

                          {isCatExpanded && hasSubItems &&
                            cat.items.map((item, idx) => (
                              <TableRow
                                key={`${catKey}-item-${idx}`}
                                className="bg-muted/15"
                              >
                                <TableCell className="pl-20 text-xs text-muted-foreground truncate max-w-[300px]">
                                  {item.label}
                                </TableCell>
                                {cat.type === 'inflow' ? (
                                  <>
                                    <TableCell className="text-right text-xs text-green-600/80">
                                      {formatCurrency(item.amount)}
                                    </TableCell>
                                    <TableCell />
                                  </>
                                ) : (
                                  <>
                                    <TableCell />
                                    <TableCell className="text-right text-xs text-destructive/80">
                                      {formatCurrency(item.amount)}
                                    </TableCell>
                                  </>
                                )}
                                <TableCell />
                                <TableCell />
                              </TableRow>
                            ))}
                        </>
                      );
                    })}
                  </>
                )}
              </>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
