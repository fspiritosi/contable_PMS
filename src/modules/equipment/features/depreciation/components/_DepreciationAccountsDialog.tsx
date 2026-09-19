'use client';

import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

import { AccountCombobox } from '@/shared/components/common/AccountCombobox';
import { Alert, AlertDescription } from '@/shared/components/ui/alert';
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
  ASSET_ACCOUNT_KEYS,
  ASSET_ACCOUNT_LABELS,
  ASSET_ACCOUNT_SOURCE_LABELS,
  formatAccountLabel,
  type AssetAccountKey,
} from '@/modules/equipment/shared/asset-accounts';
import {
  getDepreciationAccountOptions,
  updateDepreciationAccounts,
  type VehicleAssetAccounts,
} from '../actions.server';

interface Props {
  data: VehicleAssetAccounts;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Se llama tras guardar: el padre invalida las queries del equipo. */
  onChanged: () => void;
}

type OverrideValues = VehicleAssetAccounts['overrides'];
type OverrideField = keyof OverrideValues;

const FIELD_BY_KEY: Record<AssetAccountKey, OverrideField> = {
  fixedAsset: 'fixedAssetAccountId',
  accumulatedDepreciation: 'accumulatedDepreciationAccountId',
  depreciationExpense: 'depreciationExpenseAccountId',
};

/** Bienes de Uso y Amortización acumulada son de Activo; el gasto, de Resultado. */
const OPTION_GROUP: Record<AssetAccountKey, 'asset' | 'expense'> = {
  fixedAsset: 'asset',
  accumulatedDepreciation: 'asset',
  depreciationExpense: 'expense',
};

/**
 * Override de las tres cuentas de Bienes de Uso en la depreciación del equipo
 * (TSK-724c). Vacía = se usa la del tipo de equipo o la por defecto. No bloquea
 * con períodos contabilizados: avisa que los asientos viejos no cambian.
 */
export function _DepreciationAccountsDialog({ data, open, onOpenChange, onChanged }: Props) {
  const [values, setValues] = useState<OverrideValues>(data.overrides);
  const [isSaving, setIsSaving] = useState(false);

  // Al abrir, arrancar siempre desde lo guardado.
  useEffect(() => {
    if (open) setValues(data.overrides);
  }, [open, data.overrides]);

  const savedIds = useMemo(
    () => Object.values(data.overrides).filter((id): id is string => Boolean(id)),
    [data.overrides]
  );

  const { data: options, isLoading } = useQuery({
    queryKey: ['depreciation-account-options', savedIds],
    queryFn: () => getDepreciationAccountOptions(savedIds),
    enabled: open,
  });

  const isDirty = ASSET_ACCOUNT_KEYS.some(
    (key) => (values[FIELD_BY_KEY[key]] ?? null) !== (data.overrides[FIELD_BY_KEY[key]] ?? null)
  );

  const handleSave = async () => {
    if (!data.depreciationId) return;
    setIsSaving(true);
    try {
      const result = await updateDepreciationAccounts(data.depreciationId, values);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success('Cuentas actualizadas');
      onChanged();
      onOpenChange(false);
    } catch {
      toast.error('No se pudo contactar al servidor');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>Cuentas contables del equipo</DialogTitle>
          <DialogDescription>
            Reemplazan las del tipo de equipo «{data.typeName}» solo para este equipo. Si una queda
            vacía se usa la del tipo de equipo o la por defecto.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {ASSET_ACCOUNT_KEYS.map((key) => {
            const field = FIELD_BY_KEY[key];
            const fallback = data.fallbacks[key];
            return (
              <div key={key} className="space-y-1.5">
                <Label htmlFor={`account-${key}`}>{ASSET_ACCOUNT_LABELS[key].field}</Label>
                <AccountCombobox
                  id={`account-${key}`}
                  accounts={options?.[OPTION_GROUP[key]] ?? []}
                  value={values[field]}
                  onChange={(accountId) => setValues((prev) => ({ ...prev, [field]: accountId }))}
                  clearLabel="Sin asignar (usar la del tipo de equipo o la por defecto)"
                  disabled={isLoading || isSaving}
                />
                <p className="text-xs text-muted-foreground">
                  {values[field] ? (
                    'Propia de este equipo.'
                  ) : fallback ? (
                    <>
                      Si queda vacía se usa {formatAccountLabel(fallback)} —{' '}
                      {ASSET_ACCOUNT_SOURCE_LABELS[fallback.source]}
                      {fallback.source === 'type' ? ` «${data.typeName}»` : ''}.
                    </>
                  ) : (
                    <span className="text-destructive">
                      Si queda vacía no hay cuenta: configurala en el tipo de equipo «
                      {data.typeName}» o en Contabilidad → Configuración.
                    </span>
                  )}
                </p>
              </div>
            );
          })}

          {isDirty && data.postedCount > 0 && (
            <Alert className="border-orange-300 text-orange-900 dark:text-orange-200">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                Este equipo tiene {data.postedCount} período(s) contabilizado(s) con las cuentas
                anteriores. Cambiar la cuenta no modifica esos asientos: los próximos períodos y la
                baja usarán la nueva; el saldo ya acumulado lo reclasifica el contador con un
                asiento manual.
              </AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
            Cancelar
          </Button>
          <Button onClick={handleSave} disabled={!isDirty || isSaving || !data.depreciationId}>
            {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Guardar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
