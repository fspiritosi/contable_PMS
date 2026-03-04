'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';

import { Button } from '@/shared/components/ui/button';
import { Input } from '@/shared/components/ui/input';
import { Label } from '@/shared/components/ui/label';

import moment from 'moment';

import { accountingSettingsSchema } from '../../../shared/types';
import { saveAccountingSettings } from '../actions.server';
import { useState } from 'react';
import { usePermissions } from '@/shared/hooks/usePermissions';

interface AccountingSettingsFormProps {
  companyId: string;
  defaultValues: {
    fiscalYearStart: Date;
    fiscalYearEnd: Date;
  };
}

type FormValues = {
  fiscalYearStart: Date;
  fiscalYearEnd: Date;
};

export function _AccountingSettingsForm({ companyId, defaultValues }: AccountingSettingsFormProps) {
  const router = useRouter();
  const { hasPermission } = usePermissions();
  const [isLoading, setIsLoading] = useState(false);

  const form = useForm<FormValues>({
    resolver: zodResolver(accountingSettingsSchema),
    defaultValues: {
      fiscalYearStart: defaultValues.fiscalYearStart,
      fiscalYearEnd: defaultValues.fiscalYearEnd,
    },
  });

  const handleSubmit = async (data: FormValues) => {
    // Asegurarnos de que las fechas sean objetos Date
    setIsLoading(true);
    try {
      await saveAccountingSettings(companyId, data);
      toast.success('Configuración guardada correctamente');
      router.refresh();
    } catch (error) {
      if (error instanceof Error) {
        toast.error(error.message);
      } else {
        toast.error('Error al guardar la configuración');
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="fiscalYearStart">
            Inicio del Ejercicio <span className="text-destructive">*</span>
          </Label>
          <Input
            id="fiscalYearStart"
            type="date"
            value={moment(form.watch('fiscalYearStart')).isValid() ? moment(form.watch('fiscalYearStart')).format('YYYY-MM-DD') : ''}
            onChange={(e) => {
              const val = e.target.value;
              if (val) {
                form.setValue('fiscalYearStart', new Date(val + 'T00:00:00'), { shouldValidate: true });
              }
            }}
            disabled={isLoading}
          />
          {form.formState.errors.fiscalYearStart && (
            <p className="text-sm text-destructive">
              {form.formState.errors.fiscalYearStart.message}
            </p>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="fiscalYearEnd">
            Fin del Ejercicio <span className="text-destructive">*</span>
          </Label>
          <Input
            id="fiscalYearEnd"
            type="date"
            value={moment(form.watch('fiscalYearEnd')).isValid() ? moment(form.watch('fiscalYearEnd')).format('YYYY-MM-DD') : ''}
            onChange={(e) => {
              const val = e.target.value;
              if (val) {
                form.setValue('fiscalYearEnd', new Date(val + 'T00:00:00'), { shouldValidate: true });
              }
            }}
            disabled={isLoading}
          />
          {form.formState.errors.fiscalYearEnd && (
            <p className="text-sm text-destructive">
              {form.formState.errors.fiscalYearEnd.message}
            </p>
          )}
        </div>
      </div>

      <div className="flex justify-end">
        <Button type="submit" disabled={isLoading || !hasPermission('accounting.settings', 'update')}>
          {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Guardar Cambios
        </Button>
      </div>
    </form>
  );
}
