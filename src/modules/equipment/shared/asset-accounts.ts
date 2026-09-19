/**
 * Cuentas contables de Bienes de Uso de un equipo (TSK-724c).
 *
 * La cuenta la define el TIPO DE EQUIPO (Empresa → Tipos de Equipo); la
 * depreciación del equipo puede sobreescribirla; las "por defecto" de Ajustes
 * contables son el RESPALDO para los equipos sin cuenta propia ni de tipo. Cada
 * una de las tres cuentas (Bienes de Uso, Amortización acumulada, Gasto de
 * amortización) se resuelve por separado. Si para una operación falta alguna,
 * el asiento no se genera y el mensaje nombra equipo, tipo, cuenta y dónde
 * configurarla: nunca se imputa en silencio.
 *
 * La cuenta "Resultado por venta/baja de Bienes de Uso" sigue siendo global
 * (Contabilidad → Configuración): es de resultado, no depende del rubro (1.2.3).
 *
 * Funciones puras, sin Prisma ni imports de otros módulos (solo `shared/`). Las consume
 * `asset-accounts-loader.ts` (server) y la UI de depreciación/tipos de equipo.
 */

import {
  ASSET_ACCOUNT_FIELD_BY_KEY,
  ASSET_ACCOUNT_KEYS,
  ASSET_ACCOUNT_LABELS,
  type AssetAccountIds,
  type AssetAccountKey,
} from '@/shared/lib/assets/asset-account-labels';

// Claves, campos y labels viven en `shared/lib/assets` (fase 3) porque también
// los usa el ABM Tipos de Equipo del módulo `company`; acá se re-exportan para
// que los consumidores de `equipment` sigan importando desde este helper.
export { ASSET_ACCOUNT_KEYS, ASSET_ACCOUNT_LABELS };
export type { AssetAccountIds, AssetAccountKey };

/** De dónde salió la cuenta efectiva. */
export type AssetAccountSource = 'depreciation' | 'type' | 'default';

/** Operaciones que generan asiento sobre un equipo. */
export type AssetOperation = 'depreciation' | 'disposal' | 'adjustment';

export interface ResolvedAssetAccount {
  accountId: string;
  source: AssetAccountSource;
}

export type ResolvedAssetAccounts = Record<AssetAccountKey, ResolvedAssetAccount | null>;

/** Para la UI: "1.2.2/04/03 - … — del tipo de equipo Camión". */
export const ASSET_ACCOUNT_SOURCE_LABELS: Record<AssetAccountSource, string> = {
  depreciation: 'de la depreciación del equipo',
  type: 'del tipo de equipo',
  default: 'por defecto (Ajustes contables)',
};

export const REQUIRED_ACCOUNTS_BY_OPERATION: Record<AssetOperation, AssetAccountKey[]> = {
  depreciation: ['accumulatedDepreciation', 'depreciationExpense'],
  disposal: ['fixedAsset', 'accumulatedDepreciation'],
  adjustment: ['fixedAsset', 'accumulatedDepreciation'],
};

export const OPERATION_LABELS: Record<AssetOperation, string> = {
  depreciation: 'la amortización',
  disposal: 'la baja',
  adjustment: 'el ajuste de valor',
};

/** `code - name`, como lo muestran los combos y los avisos. */
export function formatAccountLabel(account: { code: string; name: string }): string {
  return `${account.code} - ${account.name}`;
}

/**
 * Cuenta efectiva de cada clave: la de la depreciación, o la del tipo, o la por
 * defecto, o ninguna. Usa `||` a propósito: una cadena vacía cuenta como "sin cuenta".
 */
export function resolveAssetAccounts({
  depreciation,
  type,
  settings,
}: {
  depreciation?: AssetAccountIds | null;
  type?: AssetAccountIds | null;
  settings?: AssetAccountIds | null;
}): ResolvedAssetAccounts {
  const resolveOne = (key: AssetAccountKey): ResolvedAssetAccount | null => {
    const field = ASSET_ACCOUNT_FIELD_BY_KEY[key];
    const fromDepreciation = depreciation?.[field];
    if (fromDepreciation) return { accountId: fromDepreciation, source: 'depreciation' };
    const fromType = type?.[field];
    if (fromType) return { accountId: fromType, source: 'type' };
    const fromSettings = settings?.[field];
    if (fromSettings) return { accountId: fromSettings, source: 'default' };
    return null;
  };

  return {
    fixedAsset: resolveOne('fixedAsset'),
    accumulatedDepreciation: resolveOne('accumulatedDepreciation'),
    depreciationExpense: resolveOne('depreciationExpense'),
  };
}

/** Claves requeridas por la operación que no resolvieron ninguna cuenta. */
export function findMissingAssetAccounts(
  resolved: ResolvedAssetAccounts,
  operation: AssetOperation
): AssetAccountKey[] {
  return REQUIRED_ACCOUNTS_BY_OPERATION[operation].filter((key) => resolved[key] === null);
}

const prefix = (operation: AssetOperation, vehicleLabel: string) =>
  `No se puede contabilizar ${OPERATION_LABELS[operation]} del equipo «${vehicleLabel}»`;

/** Aviso: qué cuentas faltan para la operación y en qué tres lugares se pueden cargar. */
export function buildMissingAssetAccountsMessage({
  operation,
  vehicleLabel,
  typeName,
  missing,
}: {
  operation: AssetOperation;
  vehicleLabel: string;
  typeName: string;
  missing: AssetAccountKey[];
}): string {
  const plural = missing.length > 1;
  const campos = missing.map((key) => ASSET_ACCOUNT_LABELS[key].field).join(' ni de ');
  const ajustes = missing.map((key) => `"${ASSET_ACCOUNT_LABELS[key].settingLabel}"`).join(' y ');

  return (
    `${prefix(operation, vehicleLabel)}: no tiene cuenta de ${campos}. ` +
    `${plural ? 'Asignalas' : 'Asignala'} en la depreciación del equipo ` +
    `(pestaña Depreciación → Cuentas contables), en el tipo de equipo «${typeName}» ` +
    `(Empresa → Tipos de Equipo) o configurá ${ajustes} en Contabilidad → Configuración.`
  );
}

/** Aviso: la cuenta resuelta existe pero hoy no es imputable; dice de dónde salió y dónde corregirla. */
export function buildUnavailableAssetAccountMessage({
  operation,
  vehicleLabel,
  typeName,
  key,
  accountLabel,
  source,
}: {
  operation: AssetOperation;
  vehicleLabel: string;
  typeName: string;
  key: AssetAccountKey;
  accountLabel: string;
  source: AssetAccountSource;
}): string {
  const { field, settingLabel } = ASSET_ACCOUNT_LABELS[key];
  const origen: Record<AssetAccountSource, string> = {
    depreciation: 'de la depreciación del equipo',
    type: `del tipo de equipo «${typeName}»`,
    default: `configurada como "${settingLabel}"`,
  };
  const destino: Record<AssetAccountSource, string> = {
    depreciation: 'la pestaña Depreciación del equipo',
    type: 'Empresa → Tipos de Equipo',
    default: 'Contabilidad → Configuración',
  };

  return (
    `${prefix(operation, vehicleLabel)}: la cuenta ${accountLabel} (${field}, ${origen[source]}) ` +
    `no está activa o no es imputable. Corregila en ${destino[source]}.`
  );
}

/** Aviso: falta la cuenta de resultado, que sigue siendo global. */
export function buildMissingDisposalAccountMessage({
  operation,
  vehicleLabel,
}: {
  operation: AssetOperation;
  vehicleLabel: string;
}): string {
  return (
    `${prefix(operation, vehicleLabel)}: falta la cuenta "Resultado por venta/baja de Bienes de Uso". ` +
    `Configurala en Contabilidad → Configuración.`
  );
}
