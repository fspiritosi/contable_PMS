'use client';

import { ColumnDef } from '@tanstack/react-table';
import { MoreHorizontal, Package, Eye, Edit, Trash2, DollarSign, AlertTriangle } from 'lucide-react';
import Link from 'next/link';

import { Badge } from '@/shared/components/ui/badge';
import { Button } from '@/shared/components/ui/button';
import { Checkbox } from '@/shared/components/ui/checkbox';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/shared/components/ui/dropdown-menu';
import { DataTableColumnHeader } from '@/shared/components/common/DataTable';
import type { ModulePermissions } from '@/shared/lib/permissions';
import type { Product } from '../../shared/types';
import {
  PRODUCT_TYPE_LABELS,
  PRODUCT_STATUS_LABELS,
  getStockLevel,
} from '../../shared/types';

interface ColumnsProps {
  onEdit: (product: Product) => void;
  onDelete: (product: Product) => void;
  permissions: ModulePermissions;
  showOemCode?: boolean;
}

export function getColumns({ onEdit, onDelete, permissions, showOemCode = false }: ColumnsProps): ColumnDef<Product>[] {
  const { canUpdate, canDelete } = permissions;
  const hasAnyAction = canUpdate || canDelete;

  const baseColumns: ColumnDef<Product>[] = [
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
    {
      accessorKey: 'name',
      meta: { title: 'Artículo' },
      header: ({ column }) => <DataTableColumnHeader column={column} title="Artículo" />,
      cell: ({ row }) => {
        const product = row.original;
        return (
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center">
              <Package className="h-4 w-4 text-primary" />
            </div>
            <div>
              <Link
                href={`/dashboard/commercial/products/${product.id}`}
                className="font-medium hover:underline"
              >
                {product.name}
              </Link>
              {product.description && (
                <p className="text-xs text-muted-foreground truncate max-w-[300px]">
                  {product.description}
                </p>
              )}
            </div>
          </div>
        );
      },
    },
    {
      accessorKey: 'code',
      meta: { title: 'Código' },
      header: ({ column }) => <DataTableColumnHeader column={column} title="Código" />,
      cell: ({ row }) => {
        const code = row.original.code;
        return code ? (
          <span className="font-mono text-sm">{code}</span>
        ) : (
          <span className="text-muted-foreground">-</span>
        );
      },
    },
    ...(showOemCode
      ? [
          {
            accessorKey: 'oemCode',
            meta: { title: 'Código OEM' },
            header: ({ column }: { column: unknown }) => (
              <DataTableColumnHeader column={column as import('@tanstack/react-table').Column<Product>} title="Código OEM" />
            ),
            cell: ({ row }: { row: import('@tanstack/react-table').Row<Product> }) => {
              const oemCode = row.original.oemCode;
              return oemCode ? (
                <span className="font-mono text-sm">{oemCode}</span>
              ) : (
                <span className="text-muted-foreground">-</span>
              );
            },
          } as ColumnDef<Product>,
        ]
      : []),
    {
      accessorKey: 'type',
      meta: { title: 'Tipo' },
      header: ({ column }) => <DataTableColumnHeader column={column} title="Tipo" />,
      cell: ({ row }) => {
        const type = row.original.type;
        return (
          <Badge variant={type === 'PRODUCT' ? 'default' : 'secondary'}>
            {PRODUCT_TYPE_LABELS[type]}
          </Badge>
        );
      },
    },
    {
      accessorKey: 'category',
      meta: { title: 'Categoría' },
      header: ({ column }) => <DataTableColumnHeader column={column} title="Categoría" />,
      cell: ({ row }) => {
        const category = row.original.category;
        return category ? (
          <span className="text-sm">{category.name}</span>
        ) : (
          <span className="text-sm text-muted-foreground">Sin categoría</span>
        );
      },
    },
    {
      accessorKey: 'salePrice',
      meta: { title: 'Precio Venta' },
      header: ({ column }) => <DataTableColumnHeader column={column} title="Precio Venta" />,
      cell: ({ row }) => {
        const product = row.original;
        return (
          <div className="flex items-center gap-1">
            <DollarSign className="h-3 w-3 text-muted-foreground" />
            <div className="flex flex-col">
              <span className="font-medium">${product.salePrice.toFixed(2)}</span>
              <span className="text-xs text-muted-foreground">
                Con IVA: ${product.salePriceWithTax.toFixed(2)}
              </span>
            </div>
          </div>
        );
      },
    },
    {
      accessorKey: 'costPrice',
      meta: { title: 'Precio Costo' },
      header: ({ column }) => <DataTableColumnHeader column={column} title="Precio Costo" />,
      cell: ({ row }) => {
        return (
          <div className="flex items-center gap-1">
            <DollarSign className="h-3 w-3 text-muted-foreground" />
            <span className="text-sm">${row.original.costPrice.toFixed(2)}</span>
          </div>
        );
      },
    },
    {
      accessorKey: 'profitMargin',
      meta: { title: '% Ganancia' },
      header: ({ column }) => <DataTableColumnHeader column={column} title="% Ganancia" />,
      cell: ({ row }) => {
        const margin = row.original.profitMargin;
        return margin > 0 ? (
          <span className="text-sm font-mono">{margin}%</span>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        );
      },
    },
    {
      id: 'stock',
      meta: { title: 'Stock' },
      header: ({ column }) => <DataTableColumnHeader column={column} title="Stock" />,
      cell: ({ row }) => {
        const product = row.original;
        if (!product.trackStock) {
          return <span className="text-sm text-muted-foreground">No controlado</span>;
        }

        const currentStock = product.currentStock ?? 0;
        const minStock = product.minStock || 0;
        const level = getStockLevel(product);

        return (
          <div className="flex items-center gap-2">
            <div className="flex flex-col text-xs">
              <span className="font-medium">{currentStock}</span>
              {minStock > 0 && (
                <span className="text-muted-foreground">Mín: {minStock}</span>
              )}
            </div>
            {level === 'out' && (
              <Badge variant="destructive" className="text-xs whitespace-nowrap">
                <AlertTriangle className="mr-1 h-3 w-3" />
                Sin stock
              </Badge>
            )}
            {level === 'critical' && (
              <Badge variant="destructive" className="text-xs whitespace-nowrap">
                <AlertTriangle className="mr-1 h-3 w-3" />
                Crítico
              </Badge>
            )}
            {level === 'warning' && (
              <Badge variant="outline" className="border-yellow-500 text-yellow-600 text-xs whitespace-nowrap">
                Bajo
              </Badge>
            )}
          </div>
        );
      },
    },
    {
      accessorKey: 'status',
      meta: { title: 'Estado' },
      header: ({ column }) => <DataTableColumnHeader column={column} title="Estado" />,
      cell: ({ row }) => {
        const status = row.original.status;
        return (
          <Badge variant={status === 'ACTIVE' ? 'default' : 'secondary'}>
            {PRODUCT_STATUS_LABELS[status]}
          </Badge>
        );
      },
    },
  ];

  // Solo agregar columna de acciones si el usuario tiene al menos un permiso
  if (hasAnyAction) {
    baseColumns.push({
      id: 'actions',
      cell: ({ row }) => {
        const product = row.original;
        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="h-8 w-8 p-0">
                <span className="sr-only">Abrir menú</span>
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Acciones</DropdownMenuLabel>
              <DropdownMenuItem asChild>
                <Link href={`/dashboard/commercial/products/${product.id}`}>
                  <Eye className="mr-2 h-4 w-4" />
                  Ver detalle
                </Link>
              </DropdownMenuItem>
              {canUpdate && (
                <DropdownMenuItem asChild>
                  <Link href={`/dashboard/commercial/products/${product.id}/edit`}>
                    <Edit className="mr-2 h-4 w-4" />
                    Editar
                  </Link>
                </DropdownMenuItem>
              )}
              {canUpdate && canDelete && <DropdownMenuSeparator />}
              {canDelete && (
                <DropdownMenuItem
                  onClick={() => onDelete(product)}
                  className="text-destructive"
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  Eliminar
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        );
      },
    });
  }

  return baseColumns;
}
