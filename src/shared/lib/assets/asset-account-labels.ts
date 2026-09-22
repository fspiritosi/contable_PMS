/**
 * Claves, campos y nombres en pantalla de las tres cuentas contables de Bienes
 * de Uso (TSK-724c). Viven en `shared/` porque las consumen dos módulos que no
 * pueden importarse entre sí: `equipment` (helper de resolución, depreciación,
 * bajas) y `company` (ABM Tipos de Equipo). Sin Prisma, sin React: solo constantes.
 */

import { ACCOUNTING_SETTINGS_ACCOUNT_LABELS } from '@/shared/lib/accounts/settings-account-labels';

export const ASSET_ACCOUNT_KEYS = [
  'fixedAsset',
  'accumulatedDepreciation',
  'depreciationExpense',
] as const;

export type AssetAccountKey = (typeof ASSET_ACCOUNT_KEYS)[number];

/**
 * Las tres cuentas tal como están en `VehicleDepreciation`, `VehicleType` y
 * `AccountingSettings`: se les pasa el registro de Prisma tal cual.
 */
export interface AssetAccountIds {
  fixedAssetAccountId?: string | null;
  accumulatedDepreciationAccountId?: string | null;
  depreciationExpenseAccountId?: string | null;
}

/** Campo de `AssetAccountIds` que corresponde a cada clave. */
export const ASSET_ACCOUNT_FIELD_BY_KEY: Record<AssetAccountKey, keyof AssetAccountIds> = {
  fixedAsset: 'fixedAssetAccountId',
  accumulatedDepreciation: 'accumulatedDepreciationAccountId',
  depreciationExpense: 'depreciationExpenseAccountId',
};

/**
 * Cómo se llama cada cuenta en pantalla y cómo se llama su ajuste contable (fase 6).
 * El `settingLabel` es el mismo texto que muestra Contabilidad → Configuración (TSK-728).
 */
export const ASSET_ACCOUNT_LABELS: Record<
  AssetAccountKey,
  { field: string; settingLabel: string }
> = {
  fixedAsset: {
    field: 'Bienes de Uso',
    settingLabel: ACCOUNTING_SETTINGS_ACCOUNT_LABELS.fixedAssetAccountId,
  },
  accumulatedDepreciation: {
    field: 'Amortización acumulada',
    settingLabel: ACCOUNTING_SETTINGS_ACCOUNT_LABELS.accumulatedDepreciationAccountId,
  },
  depreciationExpense: {
    field: 'Gasto de amortización',
    settingLabel: ACCOUNTING_SETTINGS_ACCOUNT_LABELS.depreciationExpenseAccountId,
  },
};
