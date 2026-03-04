'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ColumnDef,
  ColumnFiltersState,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  SortingState,
  useReactTable,
} from '@tanstack/react-table';
import { Eye, MoreHorizontal, Pencil, Plus, RotateCcw, Trash2, Truck } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';

import { Badge } from '@/shared/components/ui/badge';
import { Button } from '@/shared/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/shared/components/ui/dropdown-menu';
import { Input } from '@/shared/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/shared/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/components/ui/tabs';

import type { VehicleTerminationReason } from '@/generated/prisma/enums';
import {
  getBadgeConfig,
  vehicleConditionBadges,
  vehicleStatusBadges,
  vehicleTerminationReasonLabels,
} from '@/shared/utils/mappers';
import { usePermissions } from '@/shared/hooks/usePermissions';
import {
  getAllVehicles,
  reactivateVehicle,
  softDeleteVehicle,
  type VehicleListItem,
} from '../actions.server';

interface Props {
  initialData: VehicleListItem[];
}

export function _EquipmentTable({ initialData }: Props) {
  const { hasPermission } = usePermissions();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [globalFilter, setGlobalFilter] = useState('');
  const [activeTab, setActiveTab] = useState<'all' | 'vehicles' | 'others'>('all');

  // Dialog states
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [selectedVehicle, setSelectedVehicle] = useState<VehicleListItem | null>(null);
  const [terminationReason, setTerminationReason] = useState<VehicleTerminationReason>('SALE');

  const { data: vehicles = initialData } = useQuery({
    queryKey: ['vehicles'],
    queryFn: getAllVehicles,
    initialData,
  });

  const deleteMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: VehicleTerminationReason }) =>
      softDeleteVehicle(id, reason),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vehicles'] });
      toast.success('Vehículo dado de baja correctamente');
      setDeleteDialogOpen(false);
      setSelectedVehicle(null);
    },
    onError: () => {
      toast.error('Error al dar de baja el vehículo');
    },
  });

  const reactivateMutation = useMutation({
    mutationFn: reactivateVehicle,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vehicles'] });
      toast.success('Vehículo reactivado correctamente');
    },
    onError: () => {
      toast.error('Error al reactivar el vehículo');
    },
  });

  // Filtrar por tipo de vehículo
  const filteredVehicles = vehicles.filter((v) => {
    if (activeTab === 'all') return true;
    if (activeTab === 'vehicles') return v.typeOfVehicle?.name?.toLowerCase() === 'vehículos';
    return v.typeOfVehicle?.name?.toLowerCase() !== 'vehículos';
  });

  const columns: ColumnDef<VehicleListItem>[] = [
    {
      accessorKey: 'internNumber',
      header: 'N° Interno',
      cell: ({ row }) => (
        <Link
          href={`/dashboard/equipment/${row.original.id}`}
          className="font-medium text-primary hover:underline"
        >
          {row.original.internNumber || '-'}
        </Link>
      ),
    },
    {
      accessorKey: 'domain',
      header: 'Dominio',
      cell: ({ row }) => row.original.domain || '-',
    },
    {
      accessorKey: 'type',
      header: 'Tipo',
      cell: ({ row }) => <Badge variant="outline">{row.original.type?.name || '-'}</Badge>,
    },
    {
      accessorKey: 'brand',
      header: 'Marca',
      cell: ({ row }) => row.original.brand?.name || '-',
    },
    {
      accessorKey: 'model',
      header: 'Modelo',
      cell: ({ row }) => row.original.model?.name || '-',
    },
    {
      accessorKey: 'year',
      header: 'Año',
    },
    {
      accessorKey: 'status',
      header: 'Estado',
      cell: ({ row }) => {
        const badge = getBadgeConfig(row.original.status, vehicleStatusBadges);
        return <Badge variant={badge.variant}>{badge.label}</Badge>;
      },
    },
    {
      accessorKey: 'condition',
      header: 'Condición',
      cell: ({ row }) => {
        const badge = getBadgeConfig(row.original.condition, vehicleConditionBadges);
        return <Badge variant={badge.variant}>{badge.label}</Badge>;
      },
    },
    {
      accessorKey: 'isActive',
      header: 'Activo',
      cell: ({ row }) => (
        <Badge variant={row.original.isActive ? 'default' : 'secondary'}>
          {row.original.isActive ? 'Activo' : 'Inactivo'}
        </Badge>
      ),
    },
    {
      id: 'actions',
      cell: ({ row }) => {
        const vehicle = row.original;

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
              <DropdownMenuItem onClick={() => router.push(`/dashboard/equipment/${vehicle.id}`)}>
                <Eye className="mr-2 h-4 w-4" />
                Ver detalle
              </DropdownMenuItem>
              {hasPermission('equipment', 'update') && (
                <DropdownMenuItem
                  onClick={() => router.push(`/dashboard/equipment/${vehicle.id}/edit`)}
                >
                  <Pencil className="mr-2 h-4 w-4" />
                  Editar
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              {vehicle.isActive ? (
                hasPermission('equipment', 'delete') && (
                  <DropdownMenuItem
                    className="text-destructive"
                    onClick={() => {
                      setSelectedVehicle(vehicle);
                      setDeleteDialogOpen(true);
                    }}
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    Dar de baja
                  </DropdownMenuItem>
                )
              ) : (
                hasPermission('equipment', 'update') && (
                  <DropdownMenuItem onClick={() => reactivateMutation.mutate(vehicle.id)}>
                    <RotateCcw className="mr-2 h-4 w-4" />
                    Reactivar
                  </DropdownMenuItem>
                )
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        );
      },
    },
  ];

  const table = useReactTable({
    data: filteredVehicles,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onGlobalFilterChange: setGlobalFilter,
    state: {
      sorting,
      columnFilters,
      globalFilter,
    },
  });

  return (
    <div className="space-y-4">
      <Tabs
        value={activeTab}
        onValueChange={(v) => setActiveTab(v as typeof activeTab)}
        data-testid="equipment-filter-tabs"
      >
        <div className="flex items-center justify-between">
          <TabsList>
            <TabsTrigger value="all">Todos ({vehicles.length})</TabsTrigger>
            <TabsTrigger value="vehicles">
              Vehículos (
              {vehicles.filter((v) => v.typeOfVehicle?.name?.toLowerCase() === 'vehículos').length})
            </TabsTrigger>
            <TabsTrigger value="others">
              Otros (
              {vehicles.filter((v) => v.typeOfVehicle?.name?.toLowerCase() !== 'vehículos').length})
            </TabsTrigger>
          </TabsList>

          <div className="flex items-center gap-4">
            <Input
              data-testid="equipment-search-input"
              placeholder="Buscar por dominio, N° interno..."
              value={globalFilter}
              onChange={(e) => setGlobalFilter(e.target.value)}
              className="max-w-sm"
            />
            {hasPermission('equipment', 'create') && (
              <Button asChild data-testid="new-equipment-button">
                <Link href="/dashboard/equipment/new">
                  <Plus className="mr-2 h-4 w-4" />
                  Nuevo Equipo
                </Link>
              </Button>
            )}
          </div>
        </div>

        <TabsContent value={activeTab} className="mt-4">
          <div className="rounded-md border">
            <Table data-testid="equipment-table">
              <TableHeader>
                {table.getHeaderGroups().map((headerGroup) => (
                  <TableRow key={headerGroup.id}>
                    {headerGroup.headers.map((header) => (
                      <TableHead key={header.id}>
                        {header.isPlaceholder
                          ? null
                          : flexRender(header.column.columnDef.header, header.getContext())}
                      </TableHead>
                    ))}
                  </TableRow>
                ))}
              </TableHeader>
              <TableBody>
                {table.getRowModel().rows?.length ? (
                  table.getRowModel().rows.map((row) => (
                    <TableRow key={row.id} data-state={row.getIsSelected() && 'selected'}>
                      {row.getVisibleCells().map((cell) => (
                        <TableCell key={cell.id}>
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={columns.length} className="h-24 text-center">
                      <div
                        data-testid="equipment-empty-state"
                        className="flex flex-col items-center gap-2"
                      >
                        <Truck className="h-8 w-8 text-muted-foreground" />
                        <p className="text-muted-foreground">No hay equipos registrados</p>
                        <Button asChild size="sm">
                          <Link href="/dashboard/equipment/new">
                            <Plus className="mr-2 h-4 w-4" />
                            Agregar equipo
                          </Link>
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>

          <div className="flex items-center justify-between py-4">
            <p className="text-sm text-muted-foreground">
              Mostrando {table.getRowModel().rows.length} de {filteredVehicles.length} equipos
            </p>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => table.previousPage()}
                disabled={!table.getCanPreviousPage()}
              >
                Anterior
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => table.nextPage()}
                disabled={!table.getCanNextPage()}
              >
                Siguiente
              </Button>
            </div>
          </div>
        </TabsContent>
      </Tabs>

      {/* Dialog para dar de baja */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Dar de baja equipo</DialogTitle>
            <DialogDescription>
              Vas a dar de baja el equipo {selectedVehicle?.internNumber || selectedVehicle?.domain}
              . Selecciona el motivo de baja.
            </DialogDescription>
          </DialogHeader>

          <div className="py-4">
            <Select
              value={terminationReason}
              onValueChange={(v) => setTerminationReason(v as VehicleTerminationReason)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Seleccionar motivo" />
              </SelectTrigger>
              <SelectContent>
                {(
                  Object.entries(vehicleTerminationReasonLabels) as [
                    VehicleTerminationReason,
                    string,
                  ][]
                ).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDialogOpen(false)}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (selectedVehicle) {
                  deleteMutation.mutate({
                    id: selectedVehicle.id,
                    reason: terminationReason,
                  });
                }
              }}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? 'Procesando...' : 'Dar de baja'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
