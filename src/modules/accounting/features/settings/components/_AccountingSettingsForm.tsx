'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';

import { Button } from '@/shared/components/ui/button';
import { Input } from '@/shared/components/ui/input';
import { Label } from '@/shared/components/ui/label';
import { usePermissions } from '@/shared/hooks/usePermissions';
import { logger } from '@/shared/lib/logger';

import { formatDayUtc } from '../../../shared/utils/utc-month';
import { saveFiscalYearSettings } from '../actions.server';
import { PERIOD_LOCK_STATUS_QUERY_KEY } from '../period-lock-common';
import {
  fiscalYearSettingsSchema,
  type FiscalYearSettingsInput,
  type FiscalYearSettingsView,
} from '../validators';

interface AccountingSettingsFormProps {
  /** Ejercicio abierto más antiguo; `null` = la empresa todavía no configuró Ajustes. */
  fiscalYear: FiscalYearSettingsView | null;
}

/**
 * Fechas del ejercicio fiscal (TSK-760, B23/D11/C3). Con asientos o cierres las fechas son
 * de solo lectura: salen del ejercicio y cambian solas al cerrarlo. Viajan como
 * 'YYYY-MM-DD' (día calendario), sin `new Date()` del navegador (B22).
 */
export function _AccountingSettingsForm({ fiscalYear }: AccountingSettingsFormProps) {
  if (fiscalYear && !fiscalYear.datesEditable) {
    return (
      <div className="space-y-3">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1">
            <p className="text-sm font-medium">Inicio del Ejercicio</p>
            <p className="text-sm">{formatDayUtc(fiscalYear.startDay)}</p>
          </div>
          <div className="space-y-1">
            <p className="text-sm font-medium">Fin del Ejercicio</p>
            <p className="text-sm">{formatDayUtc(fiscalYear.endDay)}</p>
          </div>
        </div>
        <p className="text-sm text-muted-foreground">
          Las fechas salen del ejercicio N° {fiscalYear.fiscalYearNumber}; cambian solas al cerrar
          el ejercicio.
        </p>
      </div>
    );
  }
  return <EditableFiscalYearForm fiscalYear={fiscalYear} />;
}

function EditableFiscalYearForm({ fiscalYear }: AccountingSettingsFormProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { hasPermission } = usePermissions();
  const [isLoading, setIsLoading] = useState(false);

  const form = useForm<FiscalYearSettingsInput>({
    resolver: zodResolver(fiscalYearSettingsSchema),
    defaultValues: { startDay: fiscalYear?.startDay ?? '', endDay: fiscalYear?.endDay ?? '' },
  });
  const { errors } = form.formState;

  const handleSubmit = async (data: FiscalYearSettingsInput) => {
    setIsLoading(true);
    try {
      const result = await saveFiscalYearSettings(data);
      if (!result.success) return void toast.error(result.error);
      toast.success(`Ejercicio N° ${result.fiscalYearNumber} guardado`);
      // La grilla de Bloqueo de Períodos se arma con el ejercicio recién creado.
      await queryClient.invalidateQueries({ queryKey: PERIOD_LOCK_STATUS_QUERY_KEY });
      router.refresh();
    } catch (error) {
      logger.error('Error al guardar el ejercicio fiscal', { data: { error } });
      toast.error('Error al guardar el ejercicio fiscal');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="startDay">
            Inicio del Ejercicio <span className="text-destructive">*</span>
          </Label>
          <Input id="startDay" type="date" disabled={isLoading} {...form.register('startDay')} />
          {errors.startDay && <p className="text-sm text-destructive">{errors.startDay.message}</p>}
        </div>

        <div className="space-y-2">
          <Label htmlFor="endDay">
            Fin del Ejercicio <span className="text-destructive">*</span>
          </Label>
          <Input id="endDay" type="date" disabled={isLoading} {...form.register('endDay')} />
          {errors.endDay && <p className="text-sm text-destructive">{errors.endDay.message}</p>}
        </div>
      </div>

      <p className="text-sm text-muted-foreground">
        El ejercicio va del primer día de un mes al último día de un mes (hasta 12 meses). Las
        fechas se pueden cambiar mientras la empresa no tenga asientos ni meses cerrados.
      </p>

      <div className="flex justify-end">
        <Button
          type="submit"
          disabled={isLoading || !hasPermission('accounting.settings', 'update')}
        >
          {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Guardar Cambios
        </Button>
      </div>
    </form>
  );
}
