'use client';

import { useQuery } from '@tanstack/react-query';
import moment from 'moment';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/shared/components/ui/card';
import { logger } from '@/shared/lib/logger';

import {
  getCostCenterMovements,
  getCostCentersForMovementsReport,
  type CostCenterMovementsResult,
} from '../actions.server';
import { _CostCenterMovementsFilters } from './_CostCenterMovementsFilters';
import { _CostCenterMovementsSummary } from './_CostCenterMovementsSummary';
import { _CostCenterMovementsTable } from './_CostCenterMovementsTable';
import { exportCostCenterMovements } from './cost-center-movements-excel';

interface CostCenterMovementsReportProps {
  companyId: string;
  /** Centro que llega por deep-link desde Empresa → Centros de Costo. */
  initialCostCenterId?: string | null;
}

/**
 * Movimientos por centro de costo (TSK-719): entradas, salidas y saldo de un
 * centro, de todos comparados, o de las líneas de resultado sin centro
 * imputado. El cálculo vive entero en la action y en el helper puro; acá solo
 * se pinta y se exporta lo que vino.
 */
export function _CostCenterMovementsReport({
  companyId,
  initialCostCenterId,
}: CostCenterMovementsReportProps) {
  const [costCenterId, setCostCenterId] = useState<string>(initialCostCenterId ?? 'all');
  const [fromDate, setFromDate] = useState(moment().startOf('month').format('YYYY-MM-DD'));
  const [toDate, setToDate] = useState(moment().format('YYYY-MM-DD'));
  const [includeDrafts, setIncludeDrafts] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [data, setData] = useState<CostCenterMovementsResult | null>(null);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  // Única excepción a la convención de la carpeta (sin React Query para los
  // datos del informe): el selector, igual que el de ejercicios del presupuesto.
  const { data: costCenters, isLoading: isLoadingCenters } = useQuery({
    queryKey: ['cost-centers-movements-report', companyId],
    queryFn: () => getCostCentersForMovementsReport(companyId),
  });

  const runReport = async (targetCostCenterId: string) => {
    setIsLoading(true);
    try {
      const result = await getCostCenterMovements(companyId, {
        costCenterId: targetCostCenterId,
        fromDate: new Date(fromDate),
        toDate: new Date(toDate),
        includeDrafts,
      });
      setData(result);
      // Con un solo centro el detalle es justamente lo que se vino a ver.
      setExpandedRows(
        result.groups.length === 1 ? new Set([result.groups[0].costCenterId ?? 'none']) : new Set()
      );
    } catch (error) {
      logger.error('Error al obtener movimientos por centro de costo', { data: { error } });
      toast.error('No se pudo generar el informe de movimientos por centro de costo');
    } finally {
      setIsLoading(false);
    }
  };

  // Deep-link: si el enlace trae un centro, el informe se consulta solo en vez
  // de dejar al usuario frente a un formulario vacío.
  const autoRan = useRef(false);
  useEffect(() => {
    if (autoRan.current || !initialCostCenterId) return;
    autoRan.current = true;
    void runReport(initialCostCenterId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialCostCenterId]);

  // El centro del enlace puede no existir (otra empresa, o borrado sin historia).
  useEffect(() => {
    if (!initialCostCenterId || !costCenters) return;
    if (!costCenters.some((center) => center.id === initialCostCenterId)) {
      setCostCenterId('all');
      toast.info('El centro de costo del enlace ya no está disponible; se muestran todos.');
    }
  }, [costCenters, initialCostCenterId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await runReport(costCenterId);
  };

  const toggleRow = (groupKey: string) => {
    const next = new Set(expandedRows);
    if (next.has(groupKey)) next.delete(groupKey);
    else next.add(groupKey);
    setExpandedRows(next);
  };

  const hasRows = Boolean(data?.groups.some((group) => group.rows.length > 0));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Movimientos por Centro de Costo</CardTitle>
        <CardDescription>
          Entradas, salidas y saldo imputados a cada centro en un período
        </CardDescription>
      </CardHeader>
      <CardContent>
        <_CostCenterMovementsFilters
          costCenters={costCenters ?? []}
          isLoadingCenters={isLoadingCenters}
          costCenterId={costCenterId}
          onCostCenterChange={setCostCenterId}
          fromDate={fromDate}
          onFromDateChange={setFromDate}
          toDate={toDate}
          onToDateChange={setToDate}
          includeDrafts={includeDrafts}
          onIncludeDraftsChange={setIncludeDrafts}
          isLoading={isLoading}
          onSubmit={handleSubmit}
          onExport={() => data && void exportCostCenterMovements(data)}
          canExport={hasRows}
        />

        {data && (
          <div className="space-y-4">
            <_CostCenterMovementsSummary
              totals={data.totals}
              draftsExcluded={data.draftsExcluded}
              hasRows={hasRows}
            />

            {hasRows && (
              <_CostCenterMovementsTable
                groups={data.groups}
                expandedRows={expandedRows}
                onToggle={toggleRow}
                includeDrafts={data.includeDrafts}
              />
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
