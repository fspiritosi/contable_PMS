'use client';

import { Plus, Trash2, Truck } from 'lucide-react';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

import { Button } from '@/shared/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/shared/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/shared/components/ui/table';
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

import { formatDate } from '@/shared/utils/formatters';
import { unassignVehicleFromClient } from '../actions.server';
import type { ClientDetail } from '../actions.server';
import { _AssignVehicleDialog } from './_AssignVehicleDialog';
import { usePermissions } from '@/shared/hooks/usePermissions';

interface Props {
  client: ClientDetail;
}

export function _VehiclesTab({ client }: Props) {
  const router = useRouter();
  const { hasPermission } = usePermissions();
  const [showAssignDialog, setShowAssignDialog] = useState(false);
  const [vehicleToUnassign, setVehicleToUnassign] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleUnassign = async () => {
    if (!vehicleToUnassign) return;

    setIsLoading(true);
    try {
      await unassignVehicleFromClient(client.id, vehicleToUnassign);
      toast.success('Vehículo desasignado');
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Error al desasignar vehículo');
    } finally {
      setIsLoading(false);
      setVehicleToUnassign(null);
    }
  };

  const vehicleToUnassignData = client.vehicleAllocations.find(
    (v) => v.vehicle.id === vehicleToUnassign
  );

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Truck className="h-5 w-5" />
                Vehículos Asignados
              </CardTitle>
              <CardDescription>
                {client.vehicleAllocations.length} vehículo
                {client.vehicleAllocations.length !== 1 ? 's' : ''} asignado
                {client.vehicleAllocations.length !== 1 ? 's' : ''}
              </CardDescription>
            </div>
            {hasPermission('commercial.clients', 'update') && (
              <Button onClick={() => setShowAssignDialog(true)}>
                <Plus className="mr-2 h-4 w-4" />
                Asignar Vehículo
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {client.vehicleAllocations.length > 0 ? (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Interno</TableHead>
                    <TableHead>Dominio</TableHead>
                    <TableHead className="hidden md:table-cell">Marca / Modelo</TableHead>
                    <TableHead className="hidden sm:table-cell">Fecha Asignación</TableHead>
                    <TableHead className="w-[80px]">Acciones</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {client.vehicleAllocations.map((allocation) => (
                    <TableRow key={allocation.id}>
                      <TableCell className="font-medium">
                        {allocation.vehicle.internNumber}
                      </TableCell>
                      <TableCell>{allocation.vehicle.domain}</TableCell>
                      <TableCell className="hidden md:table-cell">
                        {allocation.vehicle.brand?.name} {allocation.vehicle.model?.name}
                      </TableCell>
                      <TableCell className="hidden sm:table-cell">
                        {formatDate(allocation.createdAt)}
                      </TableCell>
                      <TableCell>
                        {hasPermission('commercial.clients', 'update') && (
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setVehicleToUnassign(allocation.vehicle.id)}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-8 text-center text-muted-foreground">
              <Truck className="mb-2 h-12 w-12" />
              <p>No hay vehículos asignados</p>
              <p className="text-sm">Haz clic en &quot;Asignar Vehículo&quot; para agregar uno</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Dialog para asignar vehículo */}
      <_AssignVehicleDialog
        clientId={client.id}
        open={showAssignDialog}
        onOpenChange={setShowAssignDialog}
      />

      {/* Dialog de confirmación para desasignar */}
      <AlertDialog open={!!vehicleToUnassign} onOpenChange={() => setVehicleToUnassign(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Desasignar vehículo?</AlertDialogTitle>
            <AlertDialogDescription>
              El vehículo{' '}
              <strong>
                {vehicleToUnassignData?.vehicle.internNumber} ({vehicleToUnassignData?.vehicle.domain})
              </strong>{' '}
              será desasignado de este cliente. Esta acción se puede revertir asignándolo nuevamente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isLoading}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleUnassign}
              disabled={isLoading}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isLoading ? 'Procesando...' : 'Desasignar'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
