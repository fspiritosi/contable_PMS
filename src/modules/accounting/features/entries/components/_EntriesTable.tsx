'use client';

import * as React from 'react';
import { useState, useMemo, useCallback } from 'react';
import { Button } from '@/shared/components/ui/button';
import { Badge } from '@/shared/components/ui/badge';
import { JournalEntryStatus } from '@/generated/prisma/enums';
import { type JournalEntryWithLines } from '../../../shared/types';
import { ChevronRight, ChevronDown, MoreHorizontal, CheckCircle, XCircle, ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/shared/components/ui/dropdown-menu';
import { usePermissions } from '@/shared/hooks/usePermissions';
import { _PostEntryDialog } from './_PostEntryDialog';
import { _ReverseEntryDialog } from './_ReverseEntryDialog';
import { formatAmount } from '../../../shared/utils';
import { cn } from '@/shared/lib/utils';
import Link from 'next/link';
import { formatDateUtc } from '@/shared/utils/formatters';

interface EntriesTableProps {
  entries: JournalEntryWithLines[];
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
  className,
}: {
  label: string;
  sortKey: string;
  sortConfig: SortConfig | null;
  onSort: (key: string) => void;
  align?: 'right';
  className?: string;
}) {
  const isActive = sortConfig?.key === sortKey;
  const Icon = isActive
    ? sortConfig.direction === 'asc' ? ArrowUp : ArrowDown
    : ArrowUpDown;

  return (
    <th
      className={cn(
        'py-3 cursor-pointer select-none hover:text-foreground transition-colors',
        align === 'right' ? 'text-right' : 'text-left',
        className,
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

// --- Helper functions ---

function getEntrySource(entry: JournalEntryWithLines) {
  if (entry.salesInvoices && entry.salesInvoices.length > 0) {
    const doc = entry.salesInvoices[0];
    return {
      type: 'Fact. Venta',
      label: doc.fullNumber,
      href: `/dashboard/commercial/invoices/${doc.id}`,
      variant: 'default' as const,
    };
  }
  if (entry.purchaseInvoices && entry.purchaseInvoices.length > 0) {
    const doc = entry.purchaseInvoices[0];
    return {
      type: 'Fact. Compra',
      label: doc.fullNumber,
      href: `/dashboard/commercial/purchases/${doc.id}`,
      variant: 'secondary' as const,
    };
  }
  if (entry.receipts && entry.receipts.length > 0) {
    const doc = entry.receipts[0];
    return {
      type: 'Recibo',
      label: doc.fullNumber,
      href: `/dashboard/commercial/treasury/receipts`,
      variant: 'outline' as const,
    };
  }
  if (entry.paymentOrders && entry.paymentOrders.length > 0) {
    const doc = entry.paymentOrders[0];
    return {
      type: 'Orden Pago',
      label: doc.fullNumber,
      href: `/dashboard/commercial/treasury/payment-orders`,
      variant: 'outline' as const,
    };
  }
  if (entry.originalEntryId) {
    return {
      type: 'Reversión',
      label: entry.originalEntry ? `Asiento ${entry.originalEntry.number}` : null,
      href: null,
      variant: 'destructive' as const,
    };
  }
  return {
    type: 'Manual',
    label: null,
    href: null,
    variant: 'outline' as const,
  };
}

// --- Main Component ---

export function _EntriesTable({ entries }: EntriesTableProps) {
  const { hasPermission } = usePermissions();
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [postEntry, setPostEntry] = useState<JournalEntryWithLines | null>(null);
  const [reverseEntry, setReverseEntry] = useState<JournalEntryWithLines | null>(null);
  const [sortConfig, setSortConfig] = useState<SortConfig | null>(null);
  const canApprove = hasPermission('accounting.entries', 'approve');

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

  // Pre-compute totalDebit for sorting
  const entriesWithTotal = useMemo(
    () =>
      entries.map((entry) => ({
        ...entry,
        _totalDebit: entry.lines.reduce((sum, line) => sum + Number(line.debit), 0),
      })),
    [entries],
  );

  const sortedEntries = useMemo(
    () => sortData(entriesWithTotal, sortConfig),
    [entriesWithTotal, sortConfig],
  );

  const toggleRow = (entryId: string) => {
    const newExpanded = new Set(expandedRows);
    if (newExpanded.has(entryId)) {
      newExpanded.delete(entryId);
    } else {
      newExpanded.add(entryId);
    }
    setExpandedRows(newExpanded);
  };

  const getStatusLabel = (status: JournalEntryStatus) => {
    const labels = {
      [JournalEntryStatus.DRAFT]: 'Borrador',
      [JournalEntryStatus.POSTED]: 'Registrado',
      [JournalEntryStatus.REVERSED]: 'Anulado',
    };
    return labels[status];
  };

  const getStatusColor = (status: JournalEntryStatus) => {
    const colors = {
      [JournalEntryStatus.DRAFT]: 'text-yellow-600',
      [JournalEntryStatus.POSTED]: 'text-green-600',
      [JournalEntryStatus.REVERSED]: 'text-red-600',
    };
    return colors[status];
  };

  const headerProps = { sortConfig, onSort: handleSort };

  const renderEntryRow = (entry: typeof sortedEntries[number]) => {
    const isExpanded = expandedRows.has(entry.id);
    const source = getEntrySource(entry);

    return (
      <>
        <tr key={entry.id} className={entry.status === JournalEntryStatus.REVERSED ? 'opacity-50' : undefined}>
          <td className="py-2">
            <div className="flex items-center">
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={() => toggleRow(entry.id)}
              >
                {isExpanded ? (
                  <ChevronDown className="h-4 w-4" />
                ) : (
                  <ChevronRight className="h-4 w-4" />
                )}
              </Button>
              <span className="ml-2">{entry.number}</span>
            </div>
          </td>
          <td>{formatDateUtc(entry.date)}</td>
          <td>{entry.description}</td>
          <td>
            <div className="flex items-center gap-1">
              <Badge variant={source.variant} className="text-xs">
                {source.type}
              </Badge>
              {source.href && source.label && (
                <Link href={source.href} className="text-xs text-blue-600 hover:underline">
                  {source.label}
                </Link>
              )}
              {!source.href && source.label && (
                <span className="text-xs text-muted-foreground">{source.label}</span>
              )}
            </div>
          </td>
          <td className={getStatusColor(entry.status)}>{getStatusLabel(entry.status)}</td>
          <td className="text-right">{formatAmount(entry._totalDebit)}</td>
          <td className="text-right">
            {canApprove && (entry.status === JournalEntryStatus.DRAFT || entry.status === JournalEntryStatus.POSTED) && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon">
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {entry.status === JournalEntryStatus.DRAFT && (
                    <DropdownMenuItem onClick={() => setPostEntry(entry)}>
                      <CheckCircle className="mr-2 h-4 w-4" />
                      Registrar
                    </DropdownMenuItem>
                  )}
                  {entry.status === JournalEntryStatus.POSTED && (
                    <DropdownMenuItem
                      onClick={() => setReverseEntry(entry)}
                      className="text-destructive"
                    >
                      <XCircle className="mr-2 h-4 w-4" />
                      Anular
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </td>
        </tr>
        {isExpanded && (
          <>
            {entry.lines.map((line) => (
              <tr key={line.id} className="bg-muted/30">
                <td className="py-2" />
                <td colSpan={2}>
                  <div className="ml-8">
                    {line.account.code} - {line.account.name}
                    {line.description && (
                      <p className="text-sm text-muted-foreground">{line.description}</p>
                    )}
                  </div>
                </td>
                <td />
                <td />
                <td className="text-right">{line.debit > 0 ? formatAmount(line.debit) : ''}</td>
                <td className="text-right">{line.credit > 0 ? formatAmount(line.credit) : ''}</td>
              </tr>
            ))}
          </>
        )}
      </>
    );
  };

  return (
    <>
      <div className="rounded-md border">
        <table className="w-full">
          <thead>
            <tr className="border-b bg-muted/50">
              <SortableHeader label="Número" sortKey="number" className="pl-4" {...headerProps} />
              <SortableHeader label="Fecha" sortKey="date" {...headerProps} />
              <SortableHeader label="Descripción" sortKey="description" {...headerProps} />
              <th className="py-3 text-left">Origen</th>
              <SortableHeader label="Estado" sortKey="status" {...headerProps} />
              <SortableHeader label="Importe" sortKey="_totalDebit" align="right" {...headerProps} />
              <th className="py-3 pr-4 text-right">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {sortedEntries.map((entry) => renderEntryRow(entry))}
          </tbody>
        </table>
      </div>

      {postEntry && (
        <_PostEntryDialog
          entry={postEntry}
          onClose={() => setPostEntry(null)}
        />
      )}

      {reverseEntry && (
        <_ReverseEntryDialog
          entry={reverseEntry}
          onClose={() => setReverseEntry(null)}
        />
      )}
    </>
  );
}
