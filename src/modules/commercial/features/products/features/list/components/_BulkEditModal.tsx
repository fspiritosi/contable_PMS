'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Pencil } from 'lucide-react';

import { Button } from '@/shared/components/ui/button';
import { Checkbox } from '@/shared/components/ui/checkbox';
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
import { Textarea } from '@/shared/components/ui/textarea';
import {
  PRODUCT_STATUS_LABELS,
  UNIT_OF_MEASURE_OPTIONS,
} from '../../../shared/types';
import { bulkUpdateProducts } from '../actions.server';
import { getCategories } from '../../../features/categories/actions.server';
import type { AccountOption, CostCenterOption } from './_ImputationModal';

const CLEAR_VALUE = '__none__';

interface Props {
  selectedIds: string[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
  accounts: AccountOption[];
  costCenters: CostCenterOption[];
}

export function _BulkEditModal({ selectedIds, open, onOpenChange, onSuccess, accounts, costCenters }: Props) {
  const queryClient = useQueryClient();

  const incomeAccounts = accounts.filter((a) => a.nature === 'CREDIT');
  const expenseAccounts = accounts.filter((a) => a.nature === 'DEBIT');

  // Field enable toggles
  const [enableCategory, setEnableCategory] = useState(false);
  const [enableStatus, setEnableStatus] = useState(false);
  const [enableUnit, setEnableUnit] = useState(false);
  const [enableDescription, setEnableDescription] = useState(false);
  const [enableIncomeAccount, setEnableIncomeAccount] = useState(false);
  const [enableExpenseAccount, setEnableExpenseAccount] = useState(false);
  const [enableCostCenter, setEnableCostCenter] = useState(false);

  // Field values
  const [categoryId, setCategoryId] = useState<string>('');
  const [status, setStatus] = useState<string>('');
  const [unitOfMeasure, setUnitOfMeasure] = useState<string>('');
  const [description, setDescription] = useState<string>('');
  const [incomeAccountId, setIncomeAccountId] = useState<string>(CLEAR_VALUE);
  const [expenseAccountId, setExpenseAccountId] = useState<string>(CLEAR_VALUE);
  const [costCenterId, setCostCenterId] = useState<string>(CLEAR_VALUE);

  const { data: categories } = useQuery({
    queryKey: ['product-categories-select'],
    queryFn: getCategories,
    enabled: open,
  });

  const mutation = useMutation({
    mutationFn: () => {
      const updates: Record<string, string | null | undefined> = {};
      if (enableCategory) updates.categoryId = categoryId === CLEAR_VALUE ? null : (categoryId || null);
      if (enableStatus) updates.status = status;
      if (enableUnit) updates.unitOfMeasure = unitOfMeasure;
      if (enableDescription) updates.description = description;
      if (enableIncomeAccount) updates.defaultIncomeAccountId = incomeAccountId === CLEAR_VALUE ? null : incomeAccountId;
      if (enableExpenseAccount) updates.defaultExpenseAccountId = expenseAccountId === CLEAR_VALUE ? null : expenseAccountId;
      if (enableCostCenter) updates.defaultCostCenterId = costCenterId === CLEAR_VALUE ? null : costCenterId;

      return bulkUpdateProducts({ productIds: selectedIds, updates });
    },
    onSuccess: (result) => {
      toast.success(`${result.count} ítem${result.count !== 1 ? 's' : ''} actualizado${result.count !== 1 ? 's' : ''}`);
      queryClient.invalidateQueries({ queryKey: ['products'] });
      handleReset();
      onOpenChange(false);
      onSuccess();
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : 'Error al actualizar ítems';
      toast.error(message);
    },
  });

  const handleReset = () => {
    setEnableCategory(false);
    setEnableStatus(false);
    setEnableUnit(false);
    setEnableDescription(false);
    setEnableIncomeAccount(false);
    setEnableExpenseAccount(false);
    setEnableCostCenter(false);
    setCategoryId('');
    setStatus('');
    setUnitOfMeasure('');
    setDescription('');
    setIncomeAccountId(CLEAR_VALUE);
    setExpenseAccountId(CLEAR_VALUE);
    setCostCenterId(CLEAR_VALUE);
  };

  const handleSubmit = () => {
    if (!hasChanges) {
      toast.error('Seleccione al menos un campo para modificar');
      return;
    }
    if (enableStatus && !status) {
      toast.error('Seleccione un estado');
      return;
    }
    if (enableUnit && !unitOfMeasure) {
      toast.error('Seleccione una unidad de medida');
      return;
    }
    mutation.mutate();
  };

  const hasChanges =
    enableCategory ||
    enableStatus ||
    enableUnit ||
    enableDescription ||
    enableIncomeAccount ||
    enableExpenseAccount ||
    enableCostCenter;

  return (
    <Dialog open={open} onOpenChange={(val) => { if (!val) handleReset(); onOpenChange(val); }}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Pencil className="h-5 w-5" />
            Edición Masiva
          </DialogTitle>
          <DialogDescription>
            {selectedIds.length} ítem{selectedIds.length !== 1 ? 's' : ''} seleccionado{selectedIds.length !== 1 ? 's' : ''}.
            Active los campos que desea modificar.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Category */}
          <div className="flex items-start gap-3">
            <Checkbox
              id="enable-category"
              checked={enableCategory}
              onCheckedChange={(checked) => setEnableCategory(checked === true)}
              className="mt-2"
            />
            <div className="flex-1 space-y-1.5">
              <Label htmlFor="enable-category" className={!enableCategory ? 'text-muted-foreground' : ''}>
                Cambiar categoría a:
              </Label>
              <Select
                disabled={!enableCategory}
                value={categoryId}
                onValueChange={setCategoryId}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Seleccionar categoría" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Sin categoría</SelectItem>
                  {categories?.map((cat) => (
                    <SelectItem key={cat.id} value={cat.id}>
                      {cat.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Status */}
          <div className="flex items-start gap-3">
            <Checkbox
              id="enable-status"
              checked={enableStatus}
              onCheckedChange={(checked) => setEnableStatus(checked === true)}
              className="mt-2"
            />
            <div className="flex-1 space-y-1.5">
              <Label htmlFor="enable-status" className={!enableStatus ? 'text-muted-foreground' : ''}>
                Cambiar estado a:
              </Label>
              <Select
                disabled={!enableStatus}
                value={status}
                onValueChange={setStatus}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Seleccionar estado" />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(PRODUCT_STATUS_LABELS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Unit of Measure */}
          <div className="flex items-start gap-3">
            <Checkbox
              id="enable-unit"
              checked={enableUnit}
              onCheckedChange={(checked) => setEnableUnit(checked === true)}
              className="mt-2"
            />
            <div className="flex-1 space-y-1.5">
              <Label htmlFor="enable-unit" className={!enableUnit ? 'text-muted-foreground' : ''}>
                Cambiar unidad de medida a:
              </Label>
              <Select
                disabled={!enableUnit}
                value={unitOfMeasure}
                onValueChange={setUnitOfMeasure}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Seleccionar unidad" />
                </SelectTrigger>
                <SelectContent>
                  {UNIT_OF_MEASURE_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Description */}
          <div className="flex items-start gap-3">
            <Checkbox
              id="enable-description"
              checked={enableDescription}
              onCheckedChange={(checked) => setEnableDescription(checked === true)}
              className="mt-2"
            />
            <div className="flex-1 space-y-1.5">
              <Label htmlFor="enable-description" className={!enableDescription ? 'text-muted-foreground' : ''}>
                Reemplazar descripción por:
              </Label>
              <Textarea
                disabled={!enableDescription}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Nueva descripción (dejar vacío para limpiar)"
                rows={3}
              />
            </div>
          </div>

          {/* Cuenta de Ingresos */}
          <div className="flex items-start gap-3">
            <Checkbox
              id="enable-income-account"
              checked={enableIncomeAccount}
              onCheckedChange={(checked) => setEnableIncomeAccount(checked === true)}
              className="mt-2"
            />
            <div className="flex-1 space-y-1.5">
              <Label htmlFor="enable-income-account" className={!enableIncomeAccount ? 'text-muted-foreground' : ''}>
                Cuenta de ingresos (ventas):
              </Label>
              <Select disabled={!enableIncomeAccount} value={incomeAccountId} onValueChange={setIncomeAccountId}>
                <SelectTrigger>
                  <SelectValue placeholder="Seleccionar cuenta" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={CLEAR_VALUE}>Sin asignar</SelectItem>
                  {incomeAccounts.map((account) => (
                    <SelectItem key={account.id} value={account.id}>
                      {account.code} - {account.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Cuenta de Gastos */}
          <div className="flex items-start gap-3">
            <Checkbox
              id="enable-expense-account"
              checked={enableExpenseAccount}
              onCheckedChange={(checked) => setEnableExpenseAccount(checked === true)}
              className="mt-2"
            />
            <div className="flex-1 space-y-1.5">
              <Label htmlFor="enable-expense-account" className={!enableExpenseAccount ? 'text-muted-foreground' : ''}>
                Cuenta de gastos (compras):
              </Label>
              <Select disabled={!enableExpenseAccount} value={expenseAccountId} onValueChange={setExpenseAccountId}>
                <SelectTrigger>
                  <SelectValue placeholder="Seleccionar cuenta" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={CLEAR_VALUE}>Sin asignar</SelectItem>
                  {expenseAccounts.map((account) => (
                    <SelectItem key={account.id} value={account.id}>
                      {account.code} - {account.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Centro de Costos */}
          <div className="flex items-start gap-3">
            <Checkbox
              id="enable-cost-center"
              checked={enableCostCenter}
              onCheckedChange={(checked) => setEnableCostCenter(checked === true)}
              className="mt-2"
            />
            <div className="flex-1 space-y-1.5">
              <Label htmlFor="enable-cost-center" className={!enableCostCenter ? 'text-muted-foreground' : ''}>
                Centro de costos:
              </Label>
              <Select disabled={!enableCostCenter} value={costCenterId} onValueChange={setCostCenterId}>
                <SelectTrigger>
                  <SelectValue placeholder="Seleccionar centro de costos" />
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
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => { handleReset(); onOpenChange(false); }}
          >
            Cancelar
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={mutation.isPending || !hasChanges}
          >
            {mutation.isPending ? 'Aplicando...' : 'Aplicar Cambios'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
