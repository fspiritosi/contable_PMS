'use client';

import { ColumnDef } from '@tanstack/react-table';
import {
  MoreHorizontal,
  Eye,
  Edit,
  Copy,
  Send,
  CheckCircle,
  XCircle,
  Trash2,
} from 'lucide-react';
import moment from 'moment';

import { Badge } from '@/shared/components/ui/badge';
import { Button } from '@/shared/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/shared/components/ui/dropdown-menu';
import { DataTableColumnHeader } from '@/shared/components/common/DataTable';
import { QUOTE_STATUS_LABELS } from '../shared/validators';

export type QuoteListItem = {
  id: string;
  number: string;
  issueDate: Date;
  expirationDate: Date | null;
  status: string;
  subtotal: number;
  vatAmount: number;
  total: number;
  currency: string;
  contractor: { id: string; name: string } | null;
  lead: { id: string; name: string } | null;
  createdAt: Date;
  updatedAt: Date;
} & Record<string, unknown>;

type BadgeVariant = 'secondary' | 'default' | 'outline' | 'destructive';

const STATUS_BADGE_VARIANTS: Record<string, BadgeVariant> = {
  DRAFT: 'secondary',
  SENT: 'default',
  ACCEPTED: 'default',
  COMPLETED: 'default',
  REJECTED: 'destructive',
  EXPIRED: 'outline',
};

const STATUS_BADGE_CLASSNAMES: Record<string, string | undefined> = {
  ACCEPTED: 'bg-green-600 hover:bg-green-700 text-white',
  COMPLETED: 'bg-green-800 hover:bg-green-800 text-white',
  EXPIRED: 'text-orange-600 border-orange-600',
};

interface ColumnsProps {
  onView: (quote: QuoteListItem) => void;
  onEdit?: (quote: QuoteListItem) => void;
  onDuplicate?: (quote: QuoteListItem) => void;
  onUpdateStatus?: (quote: QuoteListItem, newStatus: string) => void;
  onDelete?: (quote: QuoteListItem) => void;
}

export function getColumns({
  onView,
  onEdit,
  onDuplicate,
  onUpdateStatus,
  onDelete,
}: ColumnsProps): ColumnDef<QuoteListItem>[] {
  return [
    {
      accessorKey: 'number',
      meta: { title: 'Número' },
      header: ({ column }) => <DataTableColumnHeader column={column} title="Número" />,
      cell: ({ row }) => (
        <span className="font-semibold font-mono">{row.original.number}</span>
      ),
    },
    {
      accessorKey: 'issueDate',
      meta: { title: 'Fecha' },
      header: ({ column }) => <DataTableColumnHeader column={column} title="Fecha" />,
      cell: ({ row }) => moment(row.original.issueDate).format('DD/MM/YYYY'),
    },
    {
      id: 'recipient',
      accessorFn: (row) => row.contractor?.name ?? row.lead?.name ?? '',
      meta: { title: 'Destinatario' },
      header: ({ column }) => <DataTableColumnHeader column={column} title="Destinatario" />,
      cell: ({ row }) => {
        const { contractor, lead } = row.original;
        if (contractor) {
          return (
            <div className="flex items-center gap-2">
              <span className="truncate max-w-[180px]">{contractor.name}</span>
              <Badge variant="outline" className="text-xs shrink-0">
                Cliente
              </Badge>
            </div>
          );
        }
        if (lead) {
          return (
            <div className="flex items-center gap-2">
              <span className="truncate max-w-[180px]">{lead.name}</span>
              <Badge variant="secondary" className="text-xs shrink-0">
                Lead
              </Badge>
            </div>
          );
        }
        return <span className="text-muted-foreground">-</span>;
      },
    },
    {
      accessorKey: 'expirationDate',
      meta: { title: 'Vencimiento' },
      header: ({ column }) => <DataTableColumnHeader column={column} title="Vencimiento" />,
      cell: ({ row }) => {
        const { expirationDate, status } = row.original;
        if (!expirationDate) return <span className="text-muted-foreground">-</span>;

        const expMoment = moment(expirationDate);
        const daysUntilExpiry = expMoment.diff(moment(), 'days');
        const isExpiredOrSoon =
          status !== 'REJECTED' &&
          status !== 'COMPLETED' &&
          status !== 'EXPIRED' &&
          daysUntilExpiry <= 3;

        return (
          <span className={isExpiredOrSoon ? 'text-destructive font-medium' : undefined}>
            {expMoment.format('DD/MM/YYYY')}
          </span>
        );
      },
    },
    {
      accessorKey: 'total',
      meta: { title: 'Total' },
      header: ({ column }) => <DataTableColumnHeader column={column} title="Total" />,
      cell: ({ row }) => (
        <span className="font-mono text-right block">
          $
          {row.original.total.toLocaleString('es-AR', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })}
        </span>
      ),
    },
    {
      accessorKey: 'status',
      meta: { title: 'Estado' },
      header: ({ column }) => <DataTableColumnHeader column={column} title="Estado" />,
      cell: ({ row }) => {
        const status = row.original.status;
        return (
          <Badge
            variant={STATUS_BADGE_VARIANTS[status] ?? 'default'}
            className={STATUS_BADGE_CLASSNAMES[status]}
          >
            {QUOTE_STATUS_LABELS[status] ?? status}
          </Badge>
        );
      },
    },
    {
      id: 'actions',
      cell: ({ row }) => {
        const quote = row.original;
        const isDraft = quote.status === 'DRAFT';
        const isSent = quote.status === 'SENT';

        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="h-8 w-8 p-0">
                <span className="sr-only">Abrir menú</span>
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => onView(quote)}>
                <Eye className="mr-2 h-4 w-4" />
                Ver Detalle
              </DropdownMenuItem>

              {isDraft && onEdit && (
                <DropdownMenuItem onClick={() => onEdit(quote)}>
                  <Edit className="mr-2 h-4 w-4" />
                  Editar
                </DropdownMenuItem>
              )}

              {onDuplicate && (
                <DropdownMenuItem onClick={() => onDuplicate(quote)}>
                  <Copy className="mr-2 h-4 w-4" />
                  Duplicar
                </DropdownMenuItem>
              )}

              {isDraft && onUpdateStatus && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => onUpdateStatus(quote, 'SENT')}>
                    <Send className="mr-2 h-4 w-4" />
                    Enviar
                  </DropdownMenuItem>
                </>
              )}

              {isSent && onUpdateStatus && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => onUpdateStatus(quote, 'ACCEPTED')}>
                    <CheckCircle className="mr-2 h-4 w-4" />
                    Aceptar
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => onUpdateStatus(quote, 'REJECTED')}
                    className="text-destructive"
                  >
                    <XCircle className="mr-2 h-4 w-4" />
                    Rechazar
                  </DropdownMenuItem>
                </>
              )}

              {isDraft && onDelete && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={() => onDelete(quote)}
                    className="text-destructive"
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    Eliminar
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        );
      },
    },
  ];
}
