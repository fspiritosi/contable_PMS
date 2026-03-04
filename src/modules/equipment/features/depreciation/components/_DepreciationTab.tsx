'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useRouter } from 'next/navigation';
import moment from 'moment';
import {
  Calculator,
  CheckCircle2,
  Clock,
  Loader2,
  Pause,
  Play,
  Plus,
  Trash2,
  TrendingDown,
} from 'lucide-react';

import { Button } from '@/shared/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/shared/components/ui/card';
import { Badge } from '@/shared/components/ui/badge';
import { Progress } from '@/shared/components/ui/progress';
import { DataTable } from '@/shared/components/common/DataTable';
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

import { usePermissions } from '@/shared/hooks/usePermissions';
import {
  getVehicleDepreciation,
  postDepreciationEntry,
  toggleDepreciationStatus,
  deleteVehicleDepreciation,
} from '../actions.server';
import { _DepreciationConfigDialog } from './_DepreciationConfigDialog';
import { _ValueAdjustmentDialog } from './_ValueAdjustmentDialog';
import { createColumnHelper } from '@tanstack/react-table';

interface Props {
  vehicleId: string;
  vehiclePrice?: number | null;
}

type DepreciationData = Awaited<ReturnType<typeof getVehicleDepreciation>>;
type ScheduleEntry = NonNullable<DepreciationData>['scheduleEntries'][number];

const columnHelper = createColumnHelper<ScheduleEntry>();

const statusLabels: Record<string, string> = {
  ACTIVE: 'Activa',
  COMPLETED: 'Completada',
  SUSPENDED: 'Suspendida',
};

const statusVariants: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  ACTIVE: 'default',
  COMPLETED: 'secondary',
  SUSPENDED: 'destructive',
};

const methodLabels: Record<string, string> = {
  STRAIGHT_LINE: 'Línea Recta',
  DECLINING_BALANCE: 'Saldo Decreciente',
};

function formatCurrency(value: number): string {
  return `$ ${value.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function _DepreciationTab({ vehicleId, vehiclePrice }: Props) {
  const { hasPermission } = usePermissions();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [showConfigDialog, setShowConfigDialog] = useState(false);
  const [showAdjustmentDialog, setShowAdjustmentDialog] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [postingEntryId, setPostingEntryId] = useState<string | null>(null);

  const { data: depreciation, isLoading } = useQuery({
    queryKey: ['vehicleDepreciation', vehicleId],
    queryFn: () => getVehicleDepreciation(vehicleId),
  });

  const postMutation = useMutation({
    mutationFn: postDepreciationEntry,
    onSuccess: (result) => {
      toast.success(`Período contabilizado (Asiento #${result.journalEntryNumber})`);
      queryClient.invalidateQueries({ queryKey: ['vehicleDepreciation', vehicleId] });
      router.refresh();
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
    onSettled: () => {
      setPostingEntryId(null);
    },
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: 'ACTIVE' | 'SUSPENDED' }) =>
      toggleDepreciationStatus(id, status),
    onSuccess: () => {
      toast.success('Estado actualizado');
      queryClient.invalidateQueries({ queryKey: ['vehicleDepreciation', vehicleId] });
      router.refresh();
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteVehicleDepreciation,
    onSuccess: () => {
      toast.success('Depreciación eliminada');
      queryClient.invalidateQueries({ queryKey: ['vehicleDepreciation', vehicleId] });
      router.refresh();
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  // Sin depreciación configurada
  if (!depreciation) {
    return (
      <>
        <Card>
          <CardContent className="flex flex-col items-center justify-center gap-4 py-12">
            <Calculator className="h-12 w-12 text-muted-foreground" />
            <div className="text-center">
              <p className="font-medium">Depreciación no configurada</p>
              <p className="text-sm text-muted-foreground">
                Configure la depreciación para este equipo para calcular y contabilizar la
                pérdida de valor.
              </p>
            </div>
            {hasPermission('equipment', 'create') && (
              <Button onClick={() => setShowConfigDialog(true)}>
                <Plus className="mr-2 h-4 w-4" />
                Configurar Depreciación
              </Button>
            )}
          </CardContent>
        </Card>

        <_DepreciationConfigDialog
          vehicleId={vehicleId}
          vehiclePrice={vehiclePrice}
          open={showConfigDialog}
          onOpenChange={setShowConfigDialog}
        />
      </>
    );
  }

  const percentDepreciated =
    depreciation.grossValue > 0
      ? Math.round((depreciation.totalDepreciated / depreciation.grossValue) * 100)
      : 0;

  const postedCount = depreciation.scheduleEntries.filter((e) => e.isPosted).length;
  const totalEntries = depreciation.scheduleEntries.length;
  const hasPostedEntries = postedCount > 0;

  // Encontrar el próximo período a contabilizar
  const nextPendingEntry = depreciation.scheduleEntries.find((e) => !e.isPosted);

  const columns = [
    columnHelper.accessor('periodNumber', {
      header: 'Período',
      meta: { title: 'Período' },
      cell: (info) => info.getValue(),
    }),
    columnHelper.accessor('scheduledDate', {
      header: 'Fecha',
      meta: { title: 'Fecha' },
      cell: (info) => moment(info.getValue()).format('MM/YYYY'),
    }),
    columnHelper.accessor('amount', {
      header: 'Monto',
      meta: { title: 'Monto' },
      cell: (info) => formatCurrency(info.getValue()),
    }),
    columnHelper.accessor('accumulatedAmount', {
      header: 'Acumulado',
      meta: { title: 'Acumulado' },
      cell: (info) => formatCurrency(info.getValue()),
    }),
    columnHelper.accessor('bookValueAfter', {
      header: 'Valor Libro',
      meta: { title: 'Valor Libro' },
      cell: (info) => formatCurrency(info.getValue()),
    }),
    columnHelper.display({
      id: 'status',
      header: 'Estado',
      meta: { title: 'Estado' },
      cell: ({ row }) => {
        const entry = row.original;
        if (entry.isPosted) {
          return (
            <Badge variant="secondary" className="gap-1">
              <CheckCircle2 className="h-3 w-3" />
              Contabilizado
            </Badge>
          );
        }
        return (
          <Badge variant="outline" className="gap-1">
            <Clock className="h-3 w-3" />
            Pendiente
          </Badge>
        );
      },
    }),
    columnHelper.display({
      id: 'actions',
      header: '',
      meta: { title: 'Acciones' },
      cell: ({ row }) => {
        const entry = row.original;
        if (entry.isPosted || !nextPendingEntry || entry.id !== nextPendingEntry.id) {
          return null;
        }
        if (!hasPermission('equipment', 'update')) {
          return null;
        }

        return (
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setPostingEntryId(entry.id);
              postMutation.mutate(entry.id);
            }}
            disabled={
              postMutation.isPending || depreciation.status !== 'ACTIVE'
            }
          >
            {postingEntryId === entry.id ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              'Contabilizar'
            )}
          </Button>
        );
      },
    }),
  ];

  return (
    <div className="space-y-4">
      {/* Resumen */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Depreciación</CardTitle>
              <CardDescription>
                {methodLabels[depreciation.method]} - {depreciation.usefulLifeMonths} meses de vida
                útil
              </CardDescription>
            </div>
            <Badge variant={statusVariants[depreciation.status]}>
              {statusLabels[depreciation.status]}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Valores */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">Valor de Origen</p>
              <p className="text-lg font-semibold">{formatCurrency(depreciation.grossValue)}</p>
            </div>
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">Valor Residual</p>
              <p className="text-lg font-semibold">{formatCurrency(depreciation.salvageValue)}</p>
            </div>
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">Valor Libro Actual</p>
              <p className="text-lg font-semibold">
                {formatCurrency(depreciation.currentBookValue)}
              </p>
            </div>
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">Total Depreciado</p>
              <p className="text-lg font-semibold">
                {formatCurrency(depreciation.totalDepreciated)}
              </p>
            </div>
          </div>

          {/* Barra de progreso */}
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Progreso de depreciación</span>
              <span className="font-medium">{percentDepreciated}%</span>
            </div>
            <Progress value={percentDepreciated} className="h-2" />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>
                Inicio: {moment(depreciation.startDate).format('DD/MM/YYYY')}
              </span>
              <span>
                {postedCount}/{totalEntries} períodos contabilizados
              </span>
              <span>
                Fin: {depreciation.endDate ? moment(depreciation.endDate).format('DD/MM/YYYY') : '-'}
              </span>
            </div>
          </div>

          {/* Acciones */}
          <div className="flex flex-wrap gap-2 border-t pt-4">
            {depreciation.status === 'ACTIVE' && hasPermission('equipment', 'update') && (
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  toggleMutation.mutate({ id: depreciation.id, status: 'SUSPENDED' })
                }
                disabled={toggleMutation.isPending}
              >
                <Pause className="mr-2 h-4 w-4" />
                Suspender
              </Button>
            )}
            {depreciation.status === 'SUSPENDED' && hasPermission('equipment', 'update') && (
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  toggleMutation.mutate({ id: depreciation.id, status: 'ACTIVE' })
                }
                disabled={toggleMutation.isPending}
              >
                <Play className="mr-2 h-4 w-4" />
                Reactivar
              </Button>
            )}
            {depreciation.status === 'ACTIVE' && hasPermission('equipment', 'update') && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowAdjustmentDialog(true)}
              >
                <TrendingDown className="mr-2 h-4 w-4" />
                Ajustar Valor
              </Button>
            )}
            {!hasPostedEntries && depreciation.status !== 'COMPLETED' && hasPermission('equipment', 'delete') && (
              <Button
                variant="destructive"
                size="sm"
                onClick={() => setShowDeleteConfirm(true)}
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Eliminar
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Schedule */}
      <Card>
        <CardHeader>
          <CardTitle>Cronograma de Depreciación</CardTitle>
          <CardDescription>
            Detalle por período de la depreciación programada
          </CardDescription>
        </CardHeader>
        <CardContent>
          <DataTable columns={columns} data={depreciation.scheduleEntries} />
        </CardContent>
      </Card>

      {/* Dialogs */}
      <_ValueAdjustmentDialog
        vehicleId={vehicleId}
        currentBookValue={depreciation.currentBookValue}
        open={showAdjustmentDialog}
        onOpenChange={setShowAdjustmentDialog}
      />

      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Eliminar Depreciación</AlertDialogTitle>
            <AlertDialogDescription>
              Se eliminará la configuración de depreciación y todo el cronograma. Esta acción no
              se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteMutation.mutate(depreciation.id)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                'Eliminar'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
