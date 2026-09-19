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
import { Tabs, TabsList, TabsTrigger } from '@/shared/components/ui/tabs';
import { vehicleConditionLabels, vehicleStatusLabels } from '@/shared/utils/mappers';

import type { ModulePermissions } from '@/shared/lib/permissions';
import { _TerminateEquipmentDialog } from '@/modules/equipment/shared/components/_TerminateEquipmentDialog';
import {
  getAllEquipmentForExport,
  reactivateVehicle,
  type EquipmentListItem,
  type EquipmentTab,
  type TabCounts,
  type VehicleBrandOption,
  type VehicleTypeOption,
} from '../actions.server';
import { getColumns } from '../columns';
import { _BulkDepreciationDialog } from './_BulkDepreciationDialog';

interface FacetCounts {
  status: Record<string, number>;
  condition: Record<string, number>;
  type: Record<string, number>;
  brand: Record<string, number>;
  isActive: Record<string, number>;
}

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
  facetCounts?: FacetCounts;
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
  facetCounts,
  permissions,
}: Props) {
  const router = useRouter();
  const params = useSearchParams();
  const queryClient = useQueryClient();

  // Dialog states
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [bulkDepreciationOpen, setBulkDepreciationOpen] = useState(false);
  const [selectedVehicle, setSelectedVehicle] = useState<EquipmentListItem | null>(null);

  // Mutations
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

  // Configurar filtros faceteados con conteos externos
  const facetedFilters: DataTableFacetedFilterConfig[] = useMemo(
    () => [
      {
        columnId: 'status',
        title: 'Estado',
        options: Object.values(VehicleStatus).map((value) => ({
          value,
          label: vehicleStatusLabels[value],
          icon: statusIcons[value],
        })),
        externalCounts: facetCounts?.status ? new Map(Object.entries(facetCounts.status)) : undefined,
      },
      {
        columnId: 'condition',
        title: 'Condición',
        options: Object.values(VehicleCondition).map((value) => ({
          value,
          label: vehicleConditionLabels[value],
        })),
        externalCounts: facetCounts?.condition ? new Map(Object.entries(facetCounts.condition)) : undefined,
      },
      {
        columnId: 'type',
        title: 'Tipo',
        options: vehicleTypes.map((t) => ({
          value: t.id,
          label: t.name,
        })),
        externalCounts: facetCounts?.type ? new Map(Object.entries(facetCounts.type)) : undefined,
      },
      {
        columnId: 'brand',
        title: 'Marca',
        options: vehicleBrands.map((b) => ({
          value: b.id,
          label: b.name,
        })),
        externalCounts: facetCounts?.brand ? new Map(Object.entries(facetCounts.brand)) : undefined,
      },
      {
        columnId: 'isActive',
        title: 'Activo',
        options: [
          { value: 'true', label: 'Activo' },
          { value: 'false', label: 'Inactivo' },
        ],
        externalCounts: facetCounts?.isActive ? new Map(Object.entries(facetCounts.isActive)) : undefined,
      },
    ],
    [vehicleTypes, vehicleBrands, facetCounts]
  );

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

      {/* Diálogo de baja compartido con el detalle (TSK-724c) */}
      <_TerminateEquipmentDialog
        vehicle={selectedVehicle}
        open={deleteDialogOpen}
        onOpenChange={(o) => {
          setDeleteDialogOpen(o);
          if (!o) setSelectedVehicle(null);
        }}
      />

      {/* Dialog de contabilización masiva de depreciaciones */}
      <_BulkDepreciationDialog
        open={bulkDepreciationOpen}
        onOpenChange={setBulkDepreciationOpen}
      />
    </div>
  );
}
