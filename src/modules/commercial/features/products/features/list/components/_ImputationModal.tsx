'use client';

import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Calculator } from 'lucide-react';

import { Button } from '@/shared/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog';
import { Label } from '@/shared/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui/select';
import { AccountCombobox } from '@/shared/components/common/AccountCombobox';
import { filterExpenseAccounts, filterIncomeAccounts } from '../../../shared/account-filters';
import type { Product } from '../../../shared/types';
import { updateProductImputation } from '../actions.server';

export interface AccountOption {
  id: string;
  code: string;
  name: string;
  type: string;
  nature: string;
}

export interface CostCenterOption {
  id: string;
  name: string;
}

interface Props {
  product: Product | null;
  accounts: AccountOption[];
  costCenters: CostCenterOption[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

const CLEAR_VALUE = '__none__';

export function _ImputationModal({
  product,
  accounts,
  costCenters,
  open,
  onOpenChange,
  onSuccess,
}: Props) {
  const incomeAccounts = filterIncomeAccounts(accounts);
  const expenseAccounts = filterExpenseAccounts(accounts);

  const [incomeAccountId, setIncomeAccountId] = useState<string>(CLEAR_VALUE);
  const [expenseAccountId, setExpenseAccountId] = useState<string>(CLEAR_VALUE);
  const [costCenterId, setCostCenterId] = useState<string>(CLEAR_VALUE);

  // Sincronizar con el ítem cada vez que se abre el modal
  useEffect(() => {
    if (open && product) {
      setIncomeAccountId(product.defaultIncomeAccountId ?? CLEAR_VALUE);
      setExpenseAccountId(product.defaultExpenseAccountId ?? CLEAR_VALUE);
      setCostCenterId(product.defaultCostCenterId ?? CLEAR_VALUE);
    }
  }, [open, product]);

  const mutation = useMutation({
    mutationFn: () => {
      if (!product) throw new Error('Sin ítem');
      return updateProductImputation(product.id, {
        defaultIncomeAccountId: incomeAccountId === CLEAR_VALUE ? null : incomeAccountId,
        defaultExpenseAccountId: expenseAccountId === CLEAR_VALUE ? null : expenseAccountId,
        defaultCostCenterId: costCenterId === CLEAR_VALUE ? null : costCenterId,
      });
    },
    onSuccess: () => {
      toast.success('Imputación contable actualizada');
      onOpenChange(false);
      onSuccess();
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Error al guardar la imputación');
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Calculator className="h-5 w-5" />
            Imputación contable
          </DialogTitle>
          <DialogDescription>
            {product
              ? `Cuentas para los asientos de "${product.name}"`
              : 'Cuentas contables del ítem'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label>Cuenta de Ingresos (ventas)</Label>
            <AccountCombobox
              accounts={incomeAccounts}
              value={incomeAccountId === CLEAR_VALUE ? null : incomeAccountId}
              onChange={(accountId) => setIncomeAccountId(accountId ?? CLEAR_VALUE)}
              placeholder="Sin asignar"
            />
          </div>

          <div className="space-y-1.5">
            <Label>Cuenta de Egresos (compras)</Label>
            <AccountCombobox
              accounts={expenseAccounts}
              value={expenseAccountId === CLEAR_VALUE ? null : expenseAccountId}
              onChange={(accountId) => setExpenseAccountId(accountId ?? CLEAR_VALUE)}
              placeholder="Sin asignar"
            />
          </div>

          <div className="space-y-1.5">
            <Label>Centro de Costos</Label>
            <Select value={costCenterId} onValueChange={setCostCenterId}>
              <SelectTrigger>
                <SelectValue placeholder="Sin asignar" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={CLEAR_VALUE}>Sin asignar</SelectItem>
                {costCenters.map((cc) => (
                  <SelectItem key={cc.id} value={cc.id}>
                    {cc.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={() => mutation.mutate()} disabled={mutation.isPending}>
            {mutation.isPending ? 'Guardando...' : 'Guardar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
