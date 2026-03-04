'use client';

import { useMemo, useState } from 'react';
import { ColumnDef } from '@tanstack/react-table';
import { DataTable, type DataTableFacetedFilterConfig } from '@/shared/components/common/DataTable';
import { Badge } from '@/shared/components/ui/badge';
import { Button } from '@/shared/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/shared/components/ui/dropdown-menu';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/shared/components/ui/alert-dialog';
import { MoreHorizontal, Pencil, Trash2, Power, CheckCircle2, XCircle } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { deletePointOfSale, togglePointOfSaleStatus, getPointsOfSale } from '../actions.server';
import { toast } from 'sonner';
import { usePermissions } from '@/shared/hooks/usePermissions';

type PointOfSale = Awaited<ReturnType<typeof getPointsOfSale>>[number];

interface PointsOfSaleTableProps {
  data: PointOfSale[];
}

export function PointsOfSaleTable({ data }: PointsOfSaleTableProps) {
  const router = useRouter();
  const { hasPermission } = usePermissions();
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [selectedPointOfSale, setSelectedPointOfSale] = useState<PointOfSale | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const handleEdit = (pointOfSale: PointOfSale) => {
    router.push(`/dashboard/commercial/points-of-sale/${pointOfSale.id}/edit`);
  };

  const handleDeleteClick = (pointOfSale: PointOfSale) => {
    setSelectedPointOfSale(pointOfSale);
    setDeleteDialogOpen(true);
  };

  const handleDeleteConfirm = async () => {
    if (!selectedPointOfSale) return;

    setIsDeleting(true);
    try {
      await deletePointOfSale(selectedPointOfSale.id);
      toast.success('Punto de venta eliminado correctamente');
      setDeleteDialogOpen(false);
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Error al eliminar el punto de venta');
    } finally {
      setIsDeleting(false);
    }
  };

  const handleToggleStatus = async (pointOfSale: PointOfSale) => {
    try {
      await togglePointOfSaleStatus(pointOfSale.id);
      toast.success(
        `Punto de venta ${pointOfSale.isActive ? 'desactivado' : 'activado'} correctamente`
      );
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Error al cambiar el estado del punto de venta'
      );
    }
  };

  const columns: ColumnDef<PointOfSale>[] = [
    {
      accessorKey: 'number',
      header: 'Número',
      meta: { title: 'Número' },
      cell: ({ row }) => {
        const number = row.original.number;
        return (
          <div className="font-mono font-semibold">
            {number.toString().padStart(4, '0')}
          </div>
        );
      },
    },
    {
      accessorKey: 'name',
      header: 'Nombre',
      meta: { title: 'Nombre' },
      cell: ({ row }) => {
        const name = row.original.name;
        return <div className="font-medium">{name}</div>;
      },
    },
    {
      accessorKey: 'isActive',
      header: 'Estado',
      meta: { title: 'Estado' },
      cell: ({ row }) => {
        const isActive = row.original.isActive;
        return isActive ? (
          <Badge variant="default" className="gap-1">
            <CheckCircle2 className="h-3 w-3" />
            Activo
          </Badge>
        ) : (
          <Badge variant="secondary" className="gap-1">
            <XCircle className="h-3 w-3" />
            Inactivo
          </Badge>
        );
      },
      filterFn: (row, id, value: string[]) => {
        return value.includes(String(row.getValue(id)));
      },
    },
    {
      accessorKey: 'afipEnabled',
      header: 'AFIP',
      meta: { title: 'AFIP' },
      cell: ({ row }) => {
        const afipEnabled = row.original.afipEnabled;
        return afipEnabled ? (
          <Badge variant="default">Habilitado</Badge>
        ) : (
          <Badge variant="outline">Deshabilitado</Badge>
        );
      },
      filterFn: (row, id, value: string[]) => {
        return value.includes(String(row.getValue(id)));
      },
    },
    {
      accessorKey: '_count.salesInvoices',
      header: 'Facturas',
      meta: { title: 'Facturas' },
      cell: ({ row }) => {
        const count = row.original._count.salesInvoices;
        return <div className="text-center">{count}</div>;
      },
    },
    {
      id: 'actions',
      cell: ({ row }) => {
        const pointOfSale = row.original;

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
              <DropdownMenuSeparator />
              {hasPermission('commercial.points-of-sale', 'update') && (
                <>
                  <DropdownMenuItem onClick={() => handleEdit(pointOfSale)}>
                    <Pencil className="mr-2 h-4 w-4" />
                    Editar
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleToggleStatus(pointOfSale)}>
                    <Power className="mr-2 h-4 w-4" />
                    {pointOfSale.isActive ? 'Desactivar' : 'Activar'}
                  </DropdownMenuItem>
                </>
              )}
              {hasPermission('commercial.points-of-sale', 'delete') && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={() => handleDeleteClick(pointOfSale)}
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

  const facetedFilters: DataTableFacetedFilterConfig[] = useMemo(
    () => [
      {
        columnId: 'isActive',
        title: 'Estado',
        options: [
          { value: 'true', label: 'Activo', icon: CheckCircle2 },
          { value: 'false', label: 'Inactivo', icon: XCircle },
        ],
      },
      {
        columnId: 'afipEnabled',
        title: 'AFIP',
        options: [
          { value: 'true', label: 'Habilitado' },
          { value: 'false', label: 'Deshabilitado' },
        ],
      },
    ],
    []
  );

  return (
    <>
      <DataTable
        columns={columns}
        data={data}
        totalRows={data.length}
        facetedFilters={facetedFilters}
        tableId="commercial-points-of-sale"
        showFilterToggle
      />

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Estás seguro?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta acción no se puede deshacer. Se eliminará permanentemente el punto de venta{' '}
              <strong>
                {selectedPointOfSale?.number.toString().padStart(4, '0')} -{' '}
                {selectedPointOfSale?.name}
              </strong>
              .
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteConfirm} disabled={isDeleting}>
              {isDeleting ? 'Eliminando...' : 'Eliminar'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
