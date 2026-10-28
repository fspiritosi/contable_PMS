'use client';

import { useQuery } from '@tanstack/react-query';
import { AlertTriangle } from 'lucide-react';
import { useState } from 'react';

import { Badge } from '@/shared/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui/select';
import { Skeleton } from '@/shared/components/ui/skeleton';
import { usePermissions } from '@/shared/hooks/usePermissions';
import { formatDateUtc } from '@/shared/utils/formatters';

import { getValuationCandidates, type ValuationFiscalYear } from '../actions.server';
import { _UndoValuationButton } from './_UndoValuationButton';
import { _ValuationLinesForm } from './_ValuationLinesForm';

export const VALUATION_QUERY_KEY = 'investment-valuation-candidates';

export function _ValuationForm({ fiscalYears }: { fiscalYears: ValuationFiscalYear[] }) {
  const { hasPermission } = usePermissions();
  const canApprove = hasPermission('commercial.treasury.investments', 'approve');
  const [fiscalYearId, setFiscalYearId] = useState(fiscalYears[0]?.id ?? '');
  const selected = fiscalYears.find((fy) => fy.id === fiscalYearId);

  const { data, isLoading, isError } = useQuery({
    queryKey: [VALUATION_QUERY_KEY, fiscalYearId],
    queryFn: () => getValuationCandidates(fiscalYearId),
    enabled: !!fiscalYearId,
  });

  if (fiscalYears.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        La empresa no tiene ejercicios contables. Configurá uno en Contabilidad para poder valuar.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <div className="max-w-sm space-y-2">
        <span className="text-sm font-medium">Ejercicio</span>
        <Select value={fiscalYearId} onValueChange={setFiscalYearId}>
          <SelectTrigger>
            <SelectValue placeholder="Elegí el ejercicio" />
          </SelectTrigger>
          <SelectContent>
            {fiscalYears.map((fy) => (
              <SelectItem key={fy.id} value={fy.id}>
                {`Ejercicio ${fy.number} (${fy.startDate} al ${fy.endDate})${fy.isClosed ? ' · cerrado' : ''}`}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isLoading && <Skeleton className="h-48 w-full" />}
      {isError && <p className="text-sm text-destructive">No se pudo cargar la valuación.</p>}

      {data && selected && (
        <>
          {data.existing && (
            <Card>
              <CardHeader>
                <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                  Valuación generada
                  <Badge variant="secondary">
                    {data.existing.journalEntryNumber
                      ? `Asiento N° ${data.existing.journalEntryNumber}`
                      : 'Sin diferencias, sin asiento'}
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-muted-foreground">
                  Generada el {formatDateUtc(data.existing.createdAt)} para el ejercicio{' '}
                  {selected.number}. El asiento queda en borrador hasta que lo registres en
                  Contabilidad › Asientos.
                </p>
                {canApprove && !selected.isClosed && (
                  <_UndoValuationButton
                    valuationId={data.existing.id}
                    fiscalYearNumber={selected.number}
                  />
                )}
              </CardContent>
            </Card>
          )}

          {selected.isClosed && !data.existing && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <AlertTriangle className="h-4 w-4" />
              El ejercicio está cerrado: no se puede valuar.
            </p>
          )}

          {!data.existing && !selected.isClosed && (
            <_ValuationLinesForm
              key={fiscalYearId}
              fiscalYearId={fiscalYearId}
              holdings={data.holdings}
              canApprove={canApprove}
            />
          )}
        </>
      )}
    </div>
  );
}
