'use client';

import { useQuery } from '@tanstack/react-query';
import { AlertTriangle } from 'lucide-react';

import { AccountCombobox } from '@/shared/components/common/AccountCombobox';
import { Label } from '@/shared/components/ui/label';
import {
  ASSET_ACCOUNT_FIELD_BY_KEY,
  ASSET_ACCOUNT_KEYS,
  ASSET_ACCOUNT_LABELS,
  type AssetAccountIds,
  type AssetAccountKey,
} from '@/shared/lib/assets/asset-account-labels';

import {
  getVehicleTypeAssetAccounts,
  getVehicleTypePostedDepreciationCount,
} from '../actions.server';

export type VehicleTypeAccountField = keyof AssetAccountIds;

interface Props {
  values: AssetAccountIds;
  onChange: (field: VehicleTypeAccountField, accountId: string | null) => void;
  /** Tipo guardado (edición) o `null` (creación). Sus cuentas se preservan en el combo. */
  saved: (AssetAccountIds & { id: string }) | null;
  /** El modal está abierto: habilita la consulta de equipos contabilizados. */
  enabled: boolean;
}

/** Qué lista ofrece cada combo y qué explica su ayuda. */
const FIELD_META: Record<AssetAccountKey, { list: 'asset' | 'expense'; help: string }> = {
  fixedAsset: {
    list: 'asset',
    help: 'Se usa en la baja y el ajuste de valor de los equipos de este tipo. Conviene que sea la misma cuenta a la que se imputó la compra del bien (Ítems → Imputación contable).',
  },
  accumulatedDepreciation: {
    list: 'asset',
    help: 'Se usa en la amortización mensual y en la baja.',
  },
  depreciationExpense: {
    list: 'expense',
    help: 'Se usa en la amortización mensual. Suele ir por función (explotación, administración), no por rubro.',
  },
};

const warningClass =
  'flex items-start gap-2 rounded-md border border-orange-500/50 bg-orange-500/10 p-3 text-sm text-orange-600';

/**
 * Las tres cuentas contables de Bienes de Uso de un tipo de equipo (TSK-724c).
 * Va separado de `_VehicleTypeFormModal` para que ese archivo no pase las 200 líneas.
 */
export function _VehicleTypeAccountsFields({ values, onChange, saved, enabled }: Props) {
  const fields = ASSET_ACCOUNT_KEYS.map((key) => ASSET_ACCOUNT_FIELD_BY_KEY[key]);
  const savedIds = fields.flatMap((f) => (saved?.[f] ? [saved[f]] : []));
  const isDirty = fields.some((f) => (values[f] ?? null) !== (saved?.[f] ?? null));

  // La key incluye `savedIds` para que el `includeIds` no se comparta entre tipos distintos.
  const { data, isLoading } = useQuery({
    queryKey: ['vehicle-type-asset-accounts', savedIds],
    queryFn: () => getVehicleTypeAssetAccounts(savedIds.length > 0 ? savedIds : undefined),
  });

  // Equipos del tipo con amortizaciones contabilizadas: solo al editar, para el aviso.
  const { data: postedVehiclesCount } = useQuery({
    queryKey: ['vehicle-type-posted-count', saved?.id],
    queryFn: () => getVehicleTypePostedDepreciationCount(saved!.id),
    enabled: enabled && !!saved,
  });

  const showPostedWarning = !!saved && isDirty && (postedVehiclesCount ?? 0) > 0;

  return (
    <div className="space-y-4" data-testid="vehicle-type-accounts-fields">
      {ASSET_ACCOUNT_KEYS.map((key) => {
        const field = ASSET_ACCOUNT_FIELD_BY_KEY[key];
        const { list, help } = FIELD_META[key];
        const label =
          key === 'fixedAsset' ? 'Cuenta de Bienes de Uso' : ASSET_ACCOUNT_LABELS[key].field;
        return (
          <div key={key} className="space-y-2">
            <Label htmlFor={`vehicle-type-${field}`}>{label}</Label>
            <AccountCombobox
              id={`vehicle-type-${field}`}
              accounts={data?.[list] ?? []}
              value={values[field] ?? null}
              onChange={(accountId) => onChange(field, accountId)}
              placeholder={isLoading ? 'Cargando cuentas…' : 'Sin asignar'}
              clearLabel="Sin asignar (usar la cuenta por defecto)"
              disabled={isLoading}
            />
            <p className="text-xs text-muted-foreground">{help}</p>
          </div>
        );
      })}

      {showPostedWarning && (
        <div
          className={warningClass}
          role="alert"
          data-testid="vehicle-type-accounts-posted-warning"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            Este tipo tiene {postedVehiclesCount} equipo{postedVehiclesCount === 1 ? '' : 's'} con
            amortizaciones ya contabilizadas. Cambiar las cuentas no modifica esos asientos: las
            próximas amortizaciones y la baja usarán la cuenta nueva y el saldo acumulado hasta hoy
            queda en la anterior. Si hace falta, el contador lo reclasifica con un asiento manual.
          </span>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        Si un campo queda vacío se usa la cuenta por defecto de Contabilidad → Configuración. Cada
        equipo puede sobreescribir estas cuentas en su pestaña Depreciación.
      </p>
    </div>
  );
}
