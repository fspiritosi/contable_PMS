'use client';

import { ColumnDef } from '@tanstack/react-table';
import { Download, Eye, MoreHorizontal } from 'lucide-react';
import Link from 'next/link';
import { toast } from 'sonner';

import { Badge } from '@/shared/components/ui/badge';
import { Button } from '@/shared/components/ui/button';
import { Checkbox } from '@/shared/components/ui/checkbox';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/shared/components/ui/dropdown-menu';

import { DataTableColumnHeader } from '@/shared/components/common/DataTable';
import { getDocumentStateBadge } from '@/shared/utils/mappers';
import { formatDate } from '@/shared/utils/formatters';
import type { EquipmentDocumentListItem } from '../actions.server';
import { getEquipmentDocumentDownloadUrl } from '../actions.server';

async function handleViewEquipmentDocument(documentId: string) {
  const result = await getEquipmentDocumentDownloadUrl(documentId);
  if (result.success && result.url) {
    window.open(result.url, '_blank', 'noopener,noreferrer');
  } else {
    toast.error(result.error || 'Error al obtener documento');
  }
}

async function handleDownloadEquipmentDocument(documentId: string, fileName?: string | null) {
  const result = await getEquipmentDocumentDownloadUrl(documentId);
  if (result.success && result.url) {
    const link = document.createElement('a');
    link.href = result.url;
    link.download = fileName || result.fileName || 'documento';
    link.target = '_blank';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  } else {
    toast.error(result.error || 'Error al descargar documento');
  }
}

export function getEquipmentDocumentsColumns(): ColumnDef<EquipmentDocumentListItem>[] {
  return [
    // Columna de selección
    {
      id: 'select',
      header: ({ table }) => (
        <Checkbox
          checked={
            table.getIsAllPageRowsSelected() ||
            (table.getIsSomePageRowsSelected() && 'indeterminate')
          }
          onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
          aria-label="Seleccionar todos"
        />
      ),
      cell: ({ row }) => (
        <Checkbox
          checked={row.getIsSelected()}
          onCheckedChange={(value) => row.toggleSelected(!!value)}
          aria-label="Seleccionar fila"
        />
      ),
      enableSorting: false,
      enableHiding: false,
    },

    // Equipo
    {
      id: 'vehicle',
      accessorFn: (row) => row.vehicle ? (row.vehicle.internNumber || row.vehicle.domain || '') : 'General',
      header: ({ column }) => <DataTableColumnHeader column={column} title="Equipo" />,
      cell: ({ row }) => {
        const vehicle = row.original.vehicle;
        if (!vehicle) {
          return <span className="text-muted-foreground">General (Multirrecurso)</span>;
        }
        return (
          <div>
            <Link
              href={`/dashboard/equipment/${vehicle.id}`}
              className="font-medium hover:underline"
            >
              {vehicle.internNumber || vehicle.domain || '-'}
            </Link>
            {vehicle.domain && vehicle.internNumber && (
              <p className="text-xs text-muted-foreground">{vehicle.domain}</p>
            )}
          </div>
        );
      },
    },

    // Tipo de Documento
    {
      id: 'documentType',
      accessorFn: (row) => row.documentType.name,
      header: ({ column }) => <DataTableColumnHeader column={column} title="Tipo de Documento" />,
      cell: ({ row }) => (
        <div>
          <span className="font-medium">{row.original.documentType.name}</span>
          {row.original.documentType.isMandatory && (
            <Badge variant="outline" className="ml-2 text-xs">
              Obligatorio
            </Badge>
          )}
        </div>
      ),
      filterFn: (row, id, value) => {
        return value.includes(row.original.documentType.id);
      },
    },

    // Período (solo para mensuales)
    {
      accessorKey: 'period',
      header: ({ column }) => <DataTableColumnHeader column={column} title="Período" />,
      cell: ({ row }) => row.original.period || '-',
    },

    // Estado
    {
      accessorKey: 'state',
      header: ({ column }) => <DataTableColumnHeader column={column} title="Estado" />,
      cell: ({ row }) => {
        const hasExpiration = row.original.documentType.hasExpiration;
        const badge = getDocumentStateBadge(row.original.state, hasExpiration);
        return <Badge variant={badge.variant}>{badge.label}</Badge>;
      },
      filterFn: (row, id, value) => {
        return value.includes(row.getValue(id));
      },
    },

    // Fecha de Vencimiento
    {
      accessorKey: 'expirationDate',
      header: ({ column }) => <DataTableColumnHeader column={column} title="Vencimiento" />,
      cell: ({ row }) => {
        if (!row.original.expirationDate) return '-';
        const date = new Date(row.original.expirationDate);
        const isExpired = date < new Date();
        return (
          <span className={isExpired ? 'text-destructive font-medium' : ''}>
            {formatDate(row.original.expirationDate)}
          </span>
        );
      },
    },

    // Acciones
    {
      id: 'actions',
      cell: ({ row }) => {
        const doc = row.original;

        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="h-8 w-8 p-0">
                <span className="sr-only">Abrir menú</span>
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {doc.vehicle && (
                <DropdownMenuItem asChild>
                  <Link href={`/dashboard/equipment/${doc.vehicle.id}`}>
                    <Eye className="mr-2 h-4 w-4" />
                    Ver equipo
                  </Link>
                </DropdownMenuItem>
              )}
              {doc.documentKey && (
                <>
                  <DropdownMenuItem onClick={() => handleViewEquipmentDocument(doc.id)}>
                    <Eye className="mr-2 h-4 w-4" />
                    Ver documento
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleDownloadEquipmentDocument(doc.id, doc.fileName)}>
                    <Download className="mr-2 h-4 w-4" />
                    Descargar
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
