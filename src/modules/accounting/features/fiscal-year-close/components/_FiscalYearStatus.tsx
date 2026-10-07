'use client';

import { CalendarDays, Lock, LockOpen } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

import { Badge } from '@/shared/components/ui/badge';
import { Button } from '@/shared/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/shared/components/ui/card';
import { usePermissions } from '@/shared/hooks/usePermissions';

import { formatDayUtc } from '../../../shared/utils/utc-month';
import { ENTRIES_HREF, type FiscalYearCloseStatus } from '../fiscal-year-close-common';
import { _CloseChecklist } from './_CloseChecklist';
import { _ClosePreviewDialog } from './_ClosePreviewDialog';

/**
 * Estado del cierre anual (TSK-760, Fase 9): ejercicio abierto más antiguo, requisitos para
 * cerrarlo (meses y borradores) y el último ejercicio cerrado con sus asientos.
 */
export function _FiscalYearStatus({ status }: { status: FiscalYearCloseStatus }) {
  const { hasPermission } = usePermissions();
  const canApprove = hasPermission('accounting.fiscal-year-close', 'approve');
  const [showCloseDialog, setShowCloseDialog] = useState(false);
  const { fiscalYear, lastClosed } = status;

  return (
    <>
      {fiscalYear && (
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <CalendarDays className="h-5 w-5" />
                  Ejercicio N° {fiscalYear.number}
                </CardTitle>
                <CardDescription>
                  Del {formatDayUtc(fiscalYear.startDay)} al {formatDayUtc(fiscalYear.endDay)}
                </CardDescription>
              </div>
              <Badge variant="outline" className="text-sm">
                <LockOpen className="mr-1 h-3 w-3" /> Abierto
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <_CloseChecklist status={status} />
            {canApprove && (
              <Button
                onClick={() => setShowCloseDialog(true)}
                disabled={!status.canClose}
                className="w-full"
              >
                <Lock className="mr-2 h-4 w-4" />
                Cerrar ejercicio N° {fiscalYear.number}
              </Button>
            )}
            {canApprove && !status.canClose && (
              <p className="text-center text-xs text-muted-foreground">
                Completá los requisitos de arriba para poder cerrar el ejercicio.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {lastClosed && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Lock className="h-4 w-4" />
              Ejercicio N° {lastClosed.number} cerrado
            </CardTitle>
            {lastClosed.closedAt && (
              <CardDescription>Cerrado el {formatDayUtc(lastClosed.closedAt)}</CardDescription>
            )}
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            {lastClosed.closingEntryNumber !== null && (
              <p>
                Asiento de refundición N° <strong>{lastClosed.closingEntryNumber}</strong>
              </p>
            )}
            {lastClosed.openingEntryNumber !== null && (
              <p>
                Asiento de apertura del ejercicio N° {lastClosed.number + 1}: N°{' '}
                <strong>{lastClosed.openingEntryNumber}</strong>
              </p>
            )}
            <p className="text-muted-foreground">
              Sus meses ya no se pueden reabrir. La apertura se ve en el Libro Diario; los saldos de
              los reportes ya la incluyen.
            </p>
            <Link href={ENTRIES_HREF} className="inline-block text-primary hover:underline">
              Ver asientos contables
            </Link>
          </CardContent>
        </Card>
      )}

      {showCloseDialog && fiscalYear?.id && (
        <_ClosePreviewDialog
          fiscalYear={{ ...fiscalYear, id: fiscalYear.id }}
          onClose={() => setShowCloseDialog(false)}
        />
      )}
    </>
  );
}
