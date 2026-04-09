'use client';

import { AlertCircle, CheckCircle2, Edit, Trash2 } from 'lucide-react';
import { BackButton } from '@/shared/components/common/BackButton';
import Link from 'next/link';

import { Badge } from '@/shared/components/ui/badge';
import { Button } from '@/shared/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/shared/components/ui/tooltip';

import { getBadgeConfig, vehicleConditionBadges, vehicleStatusBadges } from '@/shared/utils/mappers';
import { usePermissions } from '@/shared/hooks/usePermissions';
import type { VehicleStatusInfo } from '@/shared/lib/vehicleStatus.types';
import type { VehicleDetail } from '../actions.server';

interface Props {
  vehicle: VehicleDetail;
  statusInfo: VehicleStatusInfo;
}

export function _EquipmentHeader({ vehicle, statusInfo }: Props) {
  const { hasPermission } = usePermissions();
  const statusBadge = getBadgeConfig(vehicle.status, vehicleStatusBadges);
  const conditionBadge = getBadgeConfig(vehicle.condition, vehicleConditionBadges);

  // Build tooltip content based on status
  const renderTooltipContent = () => {
    const { missingDocuments, expiredDocuments, completedDocuments } = statusInfo;

    if (missingDocuments.length === 0 && expiredDocuments.length === 0) {
      return (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-green-600">
            <CheckCircle2 className="h-4 w-4" />
            <span className="font-medium">Documentación completa</span>
          </div>
          {completedDocuments.length > 0 && (
            <ul className="ml-6 text-sm text-muted-foreground">
              {completedDocuments.map((doc) => (
                <li key={doc.id}>• {doc.name}</li>
              ))}
            </ul>
          )}
        </div>
      );
    }

    return (
      <div className="space-y-3">
        {missingDocuments.length > 0 && (
          <div>
            <div className="flex items-center gap-2 text-destructive">
              <AlertCircle className="h-4 w-4" />
              <span className="font-medium">Documentos faltantes ({missingDocuments.length})</span>
            </div>
            <ul className="ml-6 mt-1 text-sm">
              {missingDocuments.map((doc) => (
                <li key={doc.id}>• {doc.name}</li>
              ))}
            </ul>
          </div>
        )}
        {expiredDocuments.length > 0 && (
          <div>
            <div className="flex items-center gap-2 text-orange-600">
              <AlertCircle className="h-4 w-4" />
              <span className="font-medium">Documentos vencidos ({expiredDocuments.length})</span>
            </div>
            <ul className="ml-6 mt-1 text-sm">
              {expiredDocuments.map((doc) => (
                <li key={doc.id}>• {doc.name}</li>
              ))}
            </ul>
          </div>
        )}
        {completedDocuments.length > 0 && (
          <div>
            <div className="flex items-center gap-2 text-green-600">
              <CheckCircle2 className="h-4 w-4" />
              <span className="font-medium">Documentos completos ({completedDocuments.length})</span>
            </div>
            <ul className="ml-6 mt-1 text-sm text-muted-foreground">
              {completedDocuments.map((doc) => (
                <li key={doc.id}>• {doc.name}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Row 1: Back button + Info */}
      <div className="flex items-start gap-3 sm:gap-4">
        <BackButton variant="outline" />
        <div className="min-w-0 flex-1">
          {/* Identification and badges - stack on mobile */}
          <div className="flex flex-col gap-1 sm:flex-row sm:flex-wrap sm:items-center sm:gap-2">
            <h1 className="truncate text-xl font-bold tracking-tight sm:text-2xl">
              {vehicle.internNumber || vehicle.domain || 'Sin identificación'}
            </h1>
            <div className="flex flex-wrap gap-1">
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Badge variant={statusBadge.variant} className="cursor-help">
                      {statusBadge.label}
                    </Badge>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="max-w-xs">
                    {renderTooltipContent()}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
              <Badge variant={conditionBadge.variant}>{conditionBadge.label}</Badge>
              {!vehicle.isActive && <Badge variant="destructive">Inactivo</Badge>}
            </div>
          </div>
          {/* Vehicle details - stack on mobile */}
          <div className="mt-1 flex flex-col gap-0.5 text-sm text-muted-foreground sm:flex-row sm:gap-1">
            <span>{vehicle.type?.name}</span>
            <span className="hidden sm:inline">•</span>
            <span>
              {vehicle.brand?.name} {vehicle.model?.name}
            </span>
            {vehicle.year && (
              <>
                <span className="hidden sm:inline">•</span>
                <span>({vehicle.year})</span>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Row 2: Action buttons */}
      <div className="flex gap-2 sm:justify-end">
        {hasPermission('equipment', 'update') && (
          <Button variant="outline" className="flex-1 sm:flex-none" asChild>
            <Link href={`/dashboard/equipment/${vehicle.id}/edit`}>
              <Edit className="mr-2 h-4 w-4" />
              Editar
            </Link>
          </Button>
        )}
        {vehicle.isActive && hasPermission('equipment', 'delete') && (
          <Button variant="destructive" className="flex-1 sm:flex-none">
            <Trash2 className="mr-2 h-4 w-4" />
            <span className="hidden xs:inline">Dar de </span>Baja
          </Button>
        )}
      </div>
    </div>
  );
}
