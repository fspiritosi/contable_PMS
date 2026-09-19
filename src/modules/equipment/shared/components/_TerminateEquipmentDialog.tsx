'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';

import type { VehicleTerminationReason } from '@/generated/prisma/enums';
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
import { vehicleTerminationReasonLabels } from '@/shared/utils/mappers';

import { getVehicleAssetAccounts } from '../../features/depreciation/actions.server';
import { softDeleteVehicle } from '../../features/list/actions.server';
import { _TerminateEntryNotice } from './_TerminateEntryNotice';

export interface TerminateEquipmentVehicle {
  id: string;
  internNumber: string | null;
  domain: string | null;
}

interface Props {
  vehicle: TerminateEquipmentVehicle | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onTerminated?: () => void;
}

const REASONS = Object.entries(vehicleTerminationReasonLabels) as [
  VehicleTerminationReason,
  string,
][];

/**
 * Diálogo de baja de un equipo, compartido por el listado y el detalle
 * (TSK-724c). Muestra con qué cuentas se va a generar el asiento (o por qué no
 * habrá asiento) y traslada el `error` de `softDeleteVehicle` al toast.
 */
export function _TerminateEquipmentDialog({ vehicle, open, onOpenChange, onTerminated }: Props) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [reason, setReason] = useState<VehicleTerminationReason>('SALE');

  const accountsQuery = useQuery({
    queryKey: ['vehicleAssetAccounts', vehicle?.id],
    queryFn: () => getVehicleAssetAccounts(vehicle!.id),
    enabled: open && !!vehicle,
  });

  const mutation = useMutation({
    mutationFn: ({
      id,
      terminationReason,
    }: {
      id: string;
      terminationReason: VehicleTerminationReason;
    }) => softDeleteVehicle(id, terminationReason),
    onSuccess: (result) => {
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success(
        result.journalEntryId
          ? 'Equipo dado de baja. Se generó el asiento contable.'
          : 'Equipo dado de baja (sin asiento contable).'
      );
      queryClient.invalidateQueries({ queryKey: ['equipment'] });
      queryClient.invalidateQueries({ queryKey: ['vehicleAssetAccounts', vehicle?.id] });
      router.refresh();
      onTerminated?.();
      onOpenChange(false);
    },
    onError: () => {
      toast.error('No se pudo contactar al servidor. Volvé a intentar.');
    },
  });

  const label = vehicle?.internNumber || vehicle?.domain || 'seleccionado';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="terminate-equipment-dialog">
        <DialogHeader>
          <DialogTitle>Dar de baja equipo</DialogTitle>
          <DialogDescription>
            Vas a dar de baja el equipo {label}. Seleccioná el motivo de baja.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <Select value={reason} onValueChange={(v) => setReason(v as VehicleTerminationReason)}>
            <SelectTrigger data-testid="terminate-reason-select">
              <SelectValue placeholder="Seleccionar motivo" />
            </SelectTrigger>
            <SelectContent>
              {REASONS.map(([value, text]) => (
                <SelectItem key={value} value={value}>
                  {text}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <_TerminateEntryNotice
            data={accountsQuery.data}
            isLoading={accountsQuery.isLoading}
            reason={reason}
          />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            variant="destructive"
            onClick={() =>
              vehicle && mutation.mutate({ id: vehicle.id, terminationReason: reason })
            }
            disabled={!vehicle || mutation.isPending}
            data-testid="terminate-confirm-button"
          >
            {mutation.isPending ? 'Procesando…' : 'Dar de baja'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
