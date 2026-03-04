'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, Calculator, CheckCircle2, Circle, Clock, Plus, XCircle } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';

import { VehicleCondition, VehicleStatus } from '@/generated/prisma/enums';
import {
  DataTable,
  type DataTableExportConfig,
  type DataTableFacetedFilterConfig,
  type DataTableSearchParams,
} from '@/shared/components/common/DataTable';
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/shared/components/ui/tabs';
import {
  vehicleConditionLabels,
  vehicleStatusLabels,
  vehicleTerminationReasonLabels,
} from '@/shared/utils/mappers';

import type { VehicleTerminationReason } from '@/generated/prisma/enums';
import type { ModulePermissions } from '@/shared/lib/permissions';
import {
  getAllEquipmentForExport,
  reactivateVehicle,
  softDeleteVehicle,
  type EquipmentListItem,
  type EquipmentTab,
  type TabCounts,
  type VehicleBrandOption,
  type VehicleTypeOption,
} from '../actions.server';
import { getColumns } from '../columns';
import { _BulkDepreciationDialog } from './_BulkDepreciationDialog';

// Iconos para estados
const statusIcons = {
  INCOMPLETE: Clock,
  COMPLETE: Circle,
  COMPLETE_EXPIRED_DOCS: AlertCircle,
  APPROVED: CheckCircle2,
  NOT_APPROVED: XCircle,
};

interface Props {
  data: EquipmentListItem[];
  totalRows: number;
  searchParams: DataTableSearchParams;
  tabCounts: TabCounts;
  currentTab: EquipmentTab;
  vehicleTypes: VehicleTypeOption[];
  vehicleBrands: VehicleBrandOption[];
  permissions: ModulePermissions;
}

export function _EquipmentDataTable({
  data,
  totalRows,
  searchParams,
  tabCounts,
  currentTab,
  vehicleTypes,
  vehicleBrands,
  permissions,
}: Props) {
  const router = useRouter();
  const params = useSearchParams();
  const queryClient = useQueryClient();

  // Dialog states
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [bulkDepreciationOpen, setBulkDepreciationOpen] = useState(false);
  const [selectedVehicle, setSelectedVehicle] = useState<EquipmentListItem | null>(null);
  const [terminationReason, setTerminationReason] = useState<VehicleTerminationReason>('SALE');

  // Mutations
  const deleteMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: VehicleTerminationReason }) =>
      softDeleteVehicle(id, reason),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['equipment'] });
      toast.success('Equipo dado de baja correctamente');
      setDeleteDialogOpen(false);
      setSelectedVehicle(null);
      router.refresh();
    },
    onError: () => {
      toast.error('Error al dar de baja el equipo');
    },
  });

  const reactivateMutation = useMutation({
    mutationFn: reactivateVehicle,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['equipment'] });
      toast.success('Equipo reactivado correctamente');
      router.refresh();
    },
    onError: () => {
      toast.error('Error al reactivar el equipo');
    },
  });

  // Handlers para columnas
  const handleSoftDelete = (vehicle: EquipmentListItem) => {
    setSelectedVehicle(vehicle);
    setDeleteDialogOpen(true);
  };

  const handleReactivate = (id: string) => {
    reactivateMutation.mutate(id);
  };

  // Obtener columnas con handlers y permisos
  const columns = useMemo(
    () =>
      getColumns({
        onSoftDelete: handleSoftDelete,
        onReactivate: handleReactivate,
        permissions,
      }),
    [permissions]
  );

  // Configuración de exportación a Excel
  const exportConfig: DataTableExportConfig<EquipmentListItem> = useMemo(
    () => ({
      fetchAllData: () => getAllEquipmentForExport(searchParams, currentTab),
      options: {
        filename: 'equipos',
        title: 'Listado de Equipos',
        sheetName: 'Equipos',
      },
      formatters: {
        status: (val) => vehicleStatusLabels[val as VehicleStatus] || String(val),
        condition: (val) => vehicleConditionLabels[val as VehicleCondition] || String(val),
        'brand.name': (val) => (val as string) || '',
        'model.name': (val) => (val as string) || '',
        'type.name': (val) => (val as string) || '',
        'typeOfVehicle.name': (val) => (val as string) || '',
        'costCenter.name': (val) => (val as string) || '',
        'sector.name': (val) => (val as string) || '',
        isActive: (val) => (val ? 'Activo' : 'Inactivo'),
      },
    }),
    [searchParams, currentTab]
  );

  // Cambio de tab - preservar otros parámetros pero resetear página
  const handleTabChange = (tab: string) => {
    const newParams = new URLSearchParams(params.toString());
    newParams.set('tab', tab);
    newParams.delete('page'); // Reset a primera página
    router.push(`/dashboard/equipment?${newParams.toString()}`);
  };

  // Configurar filtros faceteados
  const facetedFilters: DataTableFacetedFilterConfig[] = [
    {
      columnId: 'status',
      title: 'Estado',
      options: Object.values(VehicleStatus).map((value) => ({
        value,
        label: vehicleStatusLabels[value],
        icon: statusIcons[value],
      })),
    },
    {
      columnId: 'condition',
      title: 'Condición',
      options: Object.values(VehicleCondition).map((value) => ({
        value,
        label: vehicleConditionLabels[value],
      })),
    },
    {
      columnId: 'type',
      title: 'Tipo',
      options: vehicleTypes.map((t) => ({
        value: t.id,
        label: t.name,
      })),
    },
    {
      columnId: 'brand',
      title: 'Marca',
      options: vehicleBrands.map((b) => ({
        value: b.id,
        label: b.name,
      })),
    },
    {
      columnId: 'isActive',
      title: 'Activo',
      options: [
        { value: 'true', label: 'Activo' },
        { value: 'false', label: 'Inactivo' },
      ],
    },
  ];

  // Botones del toolbar
  const toolbarActions = (
    <div className="flex gap-2">
      {permissions.canUpdate && (
        <Button variant="outline" onClick={() => setBulkDepreciationOpen(true)}>
          <Calculator className="mr-2 h-4 w-4" />
          <span className="hidden sm:inline">Contabilizar Depreciaciones</span>
          <span className="sm:hidden">Deprec.</span>
        </Button>
      )}
      {permissions.canCreate && (
        <Button asChild data-testid="new-equipment-button">
          <Link href="/dashboard/equipment/new">
            <Plus className="mr-2 h-4 w-4" />
            Nuevo Equipo
          </Link>
        </Button>
      )}
    </div>
  );

  return (
    <div className="space-y-4">
      {/* Tabs para filtrar por tipo */}
      <Tabs value={currentTab} onValueChange={handleTabChange} data-testid="equipment-filter-tabs">
        <TabsList>
          <TabsTrigger value="all">Todos ({tabCounts.all})</TabsTrigger>
          <TabsTrigger value="vehicles">Vehículos ({tabCounts.vehicles})</TabsTrigger>
          <TabsTrigger value="others">Otros ({tabCounts.others})</TabsTrigger>
        </TabsList>
      </Tabs>

      {/* DataTable */}
      <DataTable
        columns={columns}
        data={data}
        totalRows={totalRows}
        searchParams={searchParams}
        searchPlaceholder="Buscar por N° interno, dominio, chasis..."
        facetedFilters={facetedFilters}
        tableId="equipment"
        showFilterToggle
        enableRowSelection={true}
        showRowSelection={true}
        toolbarActions={toolbarActions}
        emptyMessage="No hay equipos registrados"
        exportConfig={exportConfig}
        data-testid="equipment-table"
      />

      {/* Dialog para dar de baja */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Dar de baja equipo</DialogTitle>
            <DialogDescription>
              Vas a dar de baja el equipo{' '}
              {selectedVehicle?.internNumber || selectedVehicle?.domain || 'seleccionado'}.
              Selecciona el motivo de baja.
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

      {/* Dialog de contabilización masiva de depreciaciones */}
      <_BulkDepreciationDialog
        open={bulkDepreciationOpen}
        onOpenChange={setBulkDepreciationOpen}
      />
    </div>
  );
}
