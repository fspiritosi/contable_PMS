'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import moment from 'moment';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';

import { Button } from '@/shared/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog';
import { Form } from '@/shared/components/ui/form';

import { INSTRUMENT_TYPE_TRAITS } from '../../shared/types';
import { holdingFormSchema, type HoldingFormInput } from '../../shared/validators';
import {
  createInvestmentHolding,
  getHoldingFormCatalogs,
  updateInvestmentHolding,
  type InvestmentHoldingRow,
} from '../actions.server';
import { _HoldingFormFields } from './_HoldingFormFields';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  holding?: InvestmentHoldingRow | null;
  defaultBankAccountId?: string;
  onSuccess: () => void;
}

const EMPTY = (bankAccountId = ''): HoldingFormInput => ({
  bankAccountId,
  instrumentType: 'BOND',
  name: '',
  maturityDate: '',
  accountId: '',
});

export function _HoldingFormModal({
  open,
  onOpenChange,
  holding,
  defaultBankAccountId,
  onSuccess,
}: Props) {
  const isEditing = !!holding;
  const { data: catalogs } = useQuery({
    queryKey: ['investment-holding-catalogs'],
    queryFn: getHoldingFormCatalogs,
    enabled: open,
  });

  const form = useForm<HoldingFormInput>({
    resolver: zodResolver(holdingFormSchema),
    defaultValues: EMPTY(defaultBankAccountId),
  });
  const instrumentType = form.watch('instrumentType');
  const hasMaturity = INSTRUMENT_TYPE_TRAITS[instrumentType].hasMaturity;

  useEffect(() => {
    if (!open) return;
    form.reset(
      holding
        ? {
            bankAccountId: holding.bankAccountId,
            instrumentType: holding.instrumentType,
            name: holding.name,
            maturityDate: holding.maturityDate
              ? moment.utc(holding.maturityDate).format('YYYY-MM-DD')
              : '',
            accountId: holding.account.id,
          }
        : EMPTY(defaultBankAccountId)
    );
  }, [open, holding, defaultBankAccountId, form]);

  const onSubmit = async (values: HoldingFormInput) => {
    // Un tipo sin vencimiento no manda fecha, aunque quede una cargada de otro tipo.
    const data = { ...values, maturityDate: hasMaturity ? values.maturityDate : '' };
    const result = holding
      ? await updateInvestmentHolding(holding.id, data)
      : await createInvestmentHolding(data);
    if (!result.success) {
      toast.error(result.error);
      return;
    }
    toast.success(isEditing ? 'Tenencia actualizada' : 'Tenencia creada');
    onOpenChange(false);
    onSuccess();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>{isEditing ? 'Editar tenencia' : 'Nueva tenencia'}</DialogTitle>
          <DialogDescription>
            Un instrumento que tenés en un banco o broker. Las compras y ventas se cargan desde
            Movimientos de Fondos.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <_HoldingFormFields form={form} catalogs={catalogs} hasMaturity={hasMaturity} />

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting ? 'Guardando...' : isEditing ? 'Actualizar' : 'Crear'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
