'use client';

import React, { useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card';
import { Badge } from '@/shared/components/ui/badge';
import { Button } from '@/shared/components/ui/button';
import { ChevronDown, ChevronRight, ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react';
import { cn } from '@/shared/lib/utils';
import { formatCurrency } from '@/shared/utils/formatters';
import { VOUCHER_TYPE_LABELS } from '@/modules/commercial/features/sales/features/invoices/shared/validators';
import moment from 'moment';
import type { getAccountsReceivable } from '../actions.server';

type ReceivableData = Awaited<ReturnType<typeof getAccountsReceivable>>;
type SortConfig = { key: string; direction: 'asc' | 'desc' };

function getOverdueBadge(days: number) {
  if (days === 0) return <Badge variant="secondary">Al día</Badge>;
  if (days <= 30) return <Badge variant="warning">Vencida {days}d</Badge>;
  if (days <= 60) return <Badge className="bg-orange-600">Vencida {days}d</Badge>;
  return <Badge variant="destructive">Vencida {days}d</Badge>;
}

interface Props {
  data: ReceivableData;
}

export function _ReceivableTable({ data }: Props) {
  const [expandedCustomers, setExpandedCustomers] = useState<Set<string>>(new Set());
  const [sortConfig, setSortConfig] = useState<SortConfig | null>({ key: 'totalPending', direction: 'desc' });

  const toggleCustomer = (customerId: string) => {
    setExpandedCustomers((prev) => {
      const next = new Set(prev);
      if (next.has(customerId)) {
        next.delete(customerId);
      } else {
        next.add(customerId);
      }
      return next;
    });
  };

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

  const sortedCustomers = [...data.customerBalances].sort((a, b) => {
    if (!sortConfig) return 0;
    const aVal = a[sortConfig.key as keyof typeof a];
    const bVal = b[sortConfig.key as keyof typeof b];
    if (typeof aVal === 'string' && typeof bVal === 'string') {
      return sortConfig.direction === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
    }
    const diff = Number(aVal) - Number(bVal);
    return sortConfig.direction === 'asc' ? diff : -diff;
  });

  const SortHeader = ({ label, sortKey, align }: { label: string; sortKey: string; align?: 'right' }) => {
    const isActive = sortConfig?.key === sortKey;
    const Icon = isActive ? (sortConfig.direction === 'asc' ? ArrowUp : ArrowDown) : ArrowUpDown;
    return (
      <th
        className={cn('px-3 pb-3 cursor-pointer select-none hover:text-foreground transition-colors whitespace-nowrap', align === 'right' && 'text-right')}
        onClick={() => handleSort(sortKey)}
      >
        <div className={cn('flex items-center gap-1', align === 'right' && 'justify-end')}>
          {label}
          <Icon className={cn('h-3 w-3 shrink-0', !isActive && 'opacity-50')} />
        </div>
      </th>
    );
  };

  if (data.customerBalances.length === 0) {
    return (
      <Card>
        <CardContent className="pt-6">
          <p className="text-center text-muted-foreground py-8">
            No hay saldos pendientes de cobranza
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Pendiente de Cobranza por Cliente</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b">
              <tr className="text-left">
                <th className="pb-3 w-10"></th>
                <SortHeader label="Cliente" sortKey="customerName" />
                <th className="px-3 pb-3 whitespace-nowrap">CUIT</th>
                <SortHeader label="Comprobantes" sortKey="invoiceCount" align="right" />
                <SortHeader label="Total" sortKey="totalAmount" align="right" />
                <SortHeader label="Cobrado" sortKey="totalPaid" align="right" />
                <SortHeader label="Pendiente" sortKey="totalPending" align="right" />
              </tr>
            </thead>
            <tbody>
              {sortedCustomers.map((customer) => {
                const isExpanded = expandedCustomers.has(customer.customerId);
                return (
                  <React.Fragment key={customer.customerId}>
                    <tr
                      className="cursor-pointer hover:bg-muted/50 transition-colors border-b"
                      onClick={() => toggleCustomer(customer.customerId)}
                    >
                      <td className="py-3 px-1">
                        <Button variant="ghost" size="sm" className="h-6 w-6 p-0">
                          {isExpanded ? (
                            <ChevronDown className="h-4 w-4" />
                          ) : (
                            <ChevronRight className="h-4 w-4" />
                          )}
                        </Button>
                      </td>
                      <td className="py-3 px-3 font-medium">{customer.customerName}</td>
                      <td className="py-3 px-3 font-mono text-xs whitespace-nowrap">{customer.customerTaxId || '-'}</td>
                      <td className="py-3 px-3 text-right">{customer.invoiceCount}</td>
                      <td className="py-3 px-3 text-right font-mono whitespace-nowrap">{formatCurrency(customer.totalAmount)}</td>
                      <td className="py-3 px-3 text-right font-mono whitespace-nowrap text-green-600">{formatCurrency(customer.totalPaid)}</td>
                      <td className="py-3 px-3 text-right font-mono whitespace-nowrap font-semibold text-destructive">
                        {formatCurrency(customer.totalPending)}
                      </td>
                    </tr>
                    {isExpanded &&
                      customer.invoices.map((inv) => (
                        <tr key={inv.id} className="bg-muted/30 border-b">
                          <td></td>
                          <td className="py-2 px-3 pl-8 font-mono text-xs">{inv.fullNumber}</td>
                          <td className="py-2 px-3 text-xs">
                            {VOUCHER_TYPE_LABELS[inv.voucherType as keyof typeof VOUCHER_TYPE_LABELS]}
                          </td>
                          <td className="py-2 px-3 text-right text-xs whitespace-nowrap">
                            {moment(inv.issueDate).format('DD/MM/YYYY')}
                            {inv.dueDate && (
                              <span className="ml-2">{getOverdueBadge(inv.daysOverdue)}</span>
                            )}
                          </td>
                          <td className="py-2 px-3 text-right font-mono text-xs whitespace-nowrap">{formatCurrency(inv.total)}</td>
                          <td className="py-2 px-3 text-right font-mono text-xs whitespace-nowrap text-green-600">
                            {formatCurrency(inv.paid)}
                          </td>
                          <td className="py-2 px-3 text-right font-mono text-xs whitespace-nowrap font-semibold text-destructive">
                            {formatCurrency(inv.pending)}
                          </td>
                        </tr>
                      ))}
                  </React.Fragment>
                );
              })}
            </tbody>
            <tfoot className="border-t-2 font-semibold">
              <tr>
                <td className="pt-3 px-3" colSpan={4}>
                  TOTALES ({data.totals.customerCount} clientes, {data.totals.invoiceCount} comprobantes)
                </td>
                <td className="pt-3 px-3 text-right font-mono whitespace-nowrap">{formatCurrency(data.totals.totalAmount)}</td>
                <td className="pt-3 px-3 text-right font-mono whitespace-nowrap text-green-600">{formatCurrency(data.totals.totalPaid)}</td>
                <td className="pt-3 px-3 text-right font-mono whitespace-nowrap text-destructive">{formatCurrency(data.totals.totalPending)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
