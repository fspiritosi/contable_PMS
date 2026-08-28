'use client';

import { useMemo } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';

import { Button } from '@/shared/components/ui/button';
import { Input } from '@/shared/components/ui/input';
import { Label } from '@/shared/components/ui/label';
import { Textarea } from '@/shared/components/ui/textarea';
import { MoneyInput } from '@/shared/components/ui/money-input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog';

import {
  createRevisionSchema,
  type CreateRevisionInput,
} from '../validators';
import { createBudgetRevision } from '../actions.server';
import { formatAmount } from '../../../shared/utils';

interface BudgetRevisionModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  budgetId: string;
  currentAmounts: number[];
  monthLabels: string[];
  onRevisionCreated: () => void;
}

export function _BudgetRevisionModal({
  open,
  onOpenChange,
  budgetId,
  currentAmounts,
  monthLabels,
  onRevisionCreated,
}: BudgetRevisionModalProps) {
  const queryClient = useQueryClient();

  const form = useForm<CreateRevisionInput>({
    resolver: zodResolver(createRevisionSchema),
    defaultValues: {
      budgetId,
      newAmounts: [...currentAmounts],
      reason: '',
    },
  });

  // Reset form when modal opens with fresh data
  const handleOpenChange = (isOpen: boolean) => {
    if (isOpen) {
      form.reset({
        budgetId,
        newAmounts: [...currentAmounts],
        reason: '',
      });
    }
    onOpenChange(isOpen);
  };

  const watchedNewAmounts = form.watch('newAmounts');

  const currentTotal = useMemo(
    () => currentAmounts.reduce((sum, val) => sum + val, 0),
    [currentAmounts]
  );

  const newTotal = useMemo(
    () =>
      (watchedNewAmounts ?? []).reduce(
        (sum: number, val: number) => sum + (Number(val) || 0),
        0
      ),
    [watchedNewAmounts]
  );

  const difference = newTotal - currentTotal;

  const revisionMutation = useMutation({
    mutationFn: (data: CreateRevisionInput) => createBudgetRevision(data),
    onSuccess: () => {
      toast.success('Revision creada correctamente');
      queryClient.invalidateQueries({ queryKey: ['budget-detail'] });
      queryClient.invalidateQueries({ queryKey: ['budgets'] });
      onRevisionCreated();
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Error al crear la revision');
    },
  });

  const onSubmit = (data: CreateRevisionInput) => {
    revisionMutation.mutate(data);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Revisar Presupuesto</DialogTitle>
          <DialogDescription>
            Modifica los montos mensuales y registra el motivo de la revision.
            Los montos actuales se muestran como referencia.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
          {/* Monthly amounts comparison */}
          <div className="rounded-md border">
            <div className="grid grid-cols-[1fr_1fr_1fr] gap-0 border-b bg-muted/50 px-3 py-2 text-sm font-medium">
              <span>Mes</span>
              <span className="text-right">Actual</span>
              <span className="text-right">Nuevo</span>
            </div>
            <div className="max-h-[350px] overflow-auto">
              {monthLabels.map((label, index) => (
                <div
                  key={index}
                  className="grid grid-cols-[1fr_1fr_1fr] items-center gap-0 border-b px-3 py-1.5 last:border-b-0"
                >
                  <span className="text-sm font-medium capitalize">
                    {label}
                  </span>
                  <span className="text-right text-sm text-muted-foreground">
                    {formatAmount(currentAmounts[index])}
                  </span>
                  <div className="flex justify-end">
                    <Controller
                      control={form.control}
                      name={`newAmounts.${index}`}
                      render={({ field }) => (
                        <MoneyInput
                          className="w-[140px] text-right"
                          value={field.value ?? ''}
                          onChange={(raw) => field.onChange(raw === '' ? undefined : Number(raw))}
                          onBlur={field.onBlur}
                          name={field.name}
                          ref={field.ref}
                        />
                      )}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Summary */}
          <div className="flex flex-col gap-2 rounded-md border bg-muted/50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-1 text-sm">
              <p>
                Total actual:{' '}
                <span className="font-medium">{formatAmount(currentTotal)}</span>
              </p>
              <p>
                Total nuevo:{' '}
                <span className="font-bold">{formatAmount(newTotal)}</span>
              </p>
            </div>
            <div className="text-sm">
              Diferencia:{' '}
              <span
                className={`font-bold ${difference > 0 ? 'text-red-600' : difference < 0 ? 'text-green-600' : ''}`}
              >
                {difference > 0 ? '+' : ''}
                {formatAmount(difference)}
              </span>
            </div>
          </div>

          {/* Reason */}
          <div className="space-y-2">
            <Label>
              Motivo de la revision <span className="text-destructive">*</span>
            </Label>
            <Textarea
              placeholder="Describa el motivo de esta revision..."
              rows={3}
              {...form.register('reason')}
            />
            {form.formState.errors.reason && (
              <p className="text-sm text-destructive">
                {form.formState.errors.reason.message}
              </p>
            )}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => handleOpenChange(false)}
              disabled={revisionMutation.isPending}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={revisionMutation.isPending}>
              {revisionMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Guardando...
                </>
              ) : (
                'Confirmar Revision'
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
