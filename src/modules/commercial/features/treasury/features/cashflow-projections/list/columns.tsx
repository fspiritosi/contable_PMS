'use client';

import type { ColumnDef } from '@tanstack/react-table';
import { Badge } from '@/shared/components/ui/badge';
import { Button } from '@/shared/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/shared/components/ui/dropdown-menu';
import { MoreHorizontal, Pencil, Trash2, RefreshCw, Link2, FileText } from 'lucide-react';
import { formatCurrency } from '@/shared/utils/formatters';
import { cn } from '@/shared/lib/utils';
import moment from 'moment';
import type { ProjectionListItem } from '../../../shared/types';
import type { ProjectionStatus } from '@/generated/prisma/enums';
import {
  PROJECTION_TYPE_LABELS,
  PROJECTION_TYPE_BADGES,
  PROJECTION_CATEGORY_LABELS,
  PROJECTION_STATUS_LABELS,
} from '../../../shared/validators';

// Badge variant + className for projection status (warning/success not in Badge variants)
const PROJECTION_STATUS_STYLE: Record<
  ProjectionStatus,
  { variant: 'secondary' | 'default' | 'destructive' | 'outline'; className?: string }
> = {
  PENDING: { variant: 'secondary' },
  PARTIAL: { variant: 'outline', className: 'border-yellow-500 text-yellow-700 bg-yellow-50' },
  CONFIRMED: { variant: 'outline', className: 'border-green-600 text-green-700 bg-green-50' },
};

interface ColumnsProps {
  onEdit: (projection: ProjectionListItem) => void;
  onDelete: (projection: ProjectionListItem) => void;
  onLink: (projection: ProjectionListItem) => void;
  onViewLinks: (projection: ProjectionListItem) => void;
  canEdit?: boolean;
  canDelete?: boolean;
}

export function getColumns({ onEdit, onDelete, onLink, onViewLinks, canEdit = true, canDelete: canDeleteProp = true }: ColumnsProps): ColumnDef<ProjectionListItem>[] {
  return [
    {
      accessorKey: 'type',
      header: 'Tipo',
      meta: { title: 'Tipo' },
      cell: ({ row }) => (
        <Badge variant={PROJECTION_TYPE_BADGES[row.original.type]}>
          {PROJECTION_TYPE_LABELS[row.original.type]}
        </Badge>
      ),
    },
    {
      accessorKey: 'category',
      header: 'Categoría',
      meta: { title: 'Categoría' },
      cell: ({ row }) => PROJECTION_CATEGORY_LABELS[row.original.category],
    },
    {
      accessorKey: 'description',
      header: 'Descripción',
      meta: { title: 'Descripción' },
    },
    {
      accessorKey: 'amount',
      header: 'Monto',
      meta: { title: 'Monto' },
      cell: ({ row }) => (
        <span
          className={`font-medium ${row.original.type === 'EXPENSE' ? 'text-destructive' : 'text-green-600'}`}
        >
          {row.original.type === 'EXPENSE' ? '-' : '+'}
          {formatCurrency(row.original.amount)}
        </span>
      ),
    },
    {
      accessorKey: 'status',
      header: 'Estado',
      meta: { title: 'Estado' },
      cell: ({ row }) => {
        const { status, confirmedAmount, amount } = row.original;
        const style = PROJECTION_STATUS_STYLE[status];
        return (
          <div className="flex flex-col gap-1">
            <Badge variant={style.variant} className={cn(style.className)}>
              {PROJECTION_STATUS_LABELS[status]}
            </Badge>
            {status === 'PARTIAL' && (
              <span className="text-xs text-muted-foreground">
                {formatCurrency(confirmedAmount)} / {formatCurrency(amount)}
              </span>
            )}
          </div>
        );
      },
    },
    {
      accessorKey: 'date',
      header: 'Fecha',
      meta: { title: 'Fecha' },
      cell: ({ row }) => moment.utc(row.original.date).format('DD/MM/YYYY'),
    },
    {
      accessorKey: 'isRecurring',
      header: 'Recurrente',
      meta: { title: 'Recurrente' },
      cell: ({ row }) =>
        row.original.isRecurring ? (
          <RefreshCw className="h-4 w-4 text-blue-500" />
        ) : (
          <span className="text-muted-foreground text-sm">—</span>
        ),
    },
    {
      id: 'actions',
      meta: { title: 'Acciones' },
      cell: ({ row }) => {
        const projection = row.original;
        const isConfirmed = projection.status === 'CONFIRMED';
        const hasLinks = projection.confirmedAmount > 0;
        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="h-8 w-8 p-0">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {canEdit && (
                <DropdownMenuItem onClick={() => onEdit(projection)}>
                  <Pencil className="mr-2 h-4 w-4" />
                  Editar
                </DropdownMenuItem>
              )}
              {!isConfirmed && (
                <DropdownMenuItem onClick={() => onLink(projection)}>
                  <Link2 className="mr-2 h-4 w-4" />
                  Vincular documento
                </DropdownMenuItem>
              )}
              {hasLinks && (
                <DropdownMenuItem onClick={() => onViewLinks(projection)}>
                  <FileText className="mr-2 h-4 w-4" />
                  Ver documentos vinculados
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              {canDeleteProp && (
                <DropdownMenuItem onClick={() => onDelete(projection)} className="text-destructive">
                  <Trash2 className="mr-2 h-4 w-4" />
                  Eliminar
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        );
      },
    },
  ];
}
