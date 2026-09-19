import 'server-only';

import type { DepreciationStatus } from '@/generated/prisma/enums';
import { buildImputableAccountsWhere } from '@/shared/lib/accounts/imputable-accounts';
import { BusinessError } from '@/shared/lib/action-result';
import { prisma } from '@/shared/lib/prisma';

import {
  ASSET_ACCOUNT_KEYS,
  REQUIRED_ACCOUNTS_BY_OPERATION,
  buildMissingAssetAccountsMessage,
  buildMissingDisposalAccountMessage,
  buildUnavailableAssetAccountMessage,
  findMissingAssetAccounts,
  formatAccountLabel,
  resolveAssetAccounts,
  type AssetAccountIds,
  type AssetOperation,
  type ResolvedAssetAccounts,
} from './asset-accounts';

/**
 * Carga en lote las cuentas de Bienes de Uso de N equipos (TSK-724c): lo
 * guardado en la depreciación, en el tipo y en Ajustes contables, la
 * resolución efectiva y si cada cuenta resuelta es imputable hoy.
 *
 * Lo llaman actions que YA hicieron `checkPermission` y `getActiveCompanyId`:
 * acá no se verifican permisos. `assertAssetAccountsForOperation` lanza
 * `BusinessError` (mensaje legible, viaja en `ActionResult`) en vez de omitir
 * el asiento en silencio. Sin test unitario: lo cubren los tests de
 * integración de amortización, baja y ajuste (fases 4 y 5).
 */

export type PrismaTransactionClient = Omit<
  typeof prisma,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

export interface LoadedAccountInfo {
  id: string;
  code: string;
  name: string;
  /** Hoja, activa y sin corte vigente (`buildImputableAccountsWhere`). */
  imputable: boolean;
}

export interface LoadedVehicleAssetAccounts {
  vehicleId: string;
  /** `internNumber || domain || id.slice(0, 8)`, como en los asientos de amortización. */
  vehicleLabel: string;
  typeId: string;
  typeName: string;
  isActive: boolean;
  hasDepreciation: boolean;
  depreciationId: string | null;
  depreciationStatus: DepreciationStatus | null;
  /** Períodos ya contabilizados de la depreciación (0 si no tiene). */
  postedCount: number;
  /** Cuentas cargadas en la depreciación del equipo. */
  overrides: AssetAccountIds;
  /** Cuentas cargadas en el tipo de equipo. */
  typeAccounts: AssetAccountIds;
  resolved: ResolvedAssetAccounts;
  /** Datos de cada cuenta resuelta, por id. Falta la clave si la cuenta ya no existe. */
  accounts: Record<string, LoadedAccountInfo>;
  /** Cuenta de resultado por venta/baja: sigue siendo global. */
  assetDisposalGainLossAccountId: string | null;
  lockedUntilDate: Date | null;
}

export interface AssertedAssetAccounts {
  fixedAssetAccountId: string | null;
  accumulatedDepreciationAccountId: string | null;
  depreciationExpenseAccountId: string | null;
  assetDisposalGainLossAccountId: string | null;
}

const EMPTY_IDS: AssetAccountIds = {
  fixedAssetAccountId: null,
  accumulatedDepreciationAccountId: null,
  depreciationExpenseAccountId: null,
};

/**
 * Una pasada por `vehicle`, una por `accountingSettings` y dos por `account`
 * (datos de todas las resueltas + cuáles son imputables hoy, sin `atDate`:
 * misma convención que TSK-721). Devuelve un `Map` por `vehicleId`; los ids
 * que no pertenecen a la empresa no aparecen.
 */
export async function loadVehiclesAssetAccounts(
  companyId: string,
  vehicleIds: string[],
  client: PrismaTransactionClient = prisma
): Promise<Map<string, LoadedVehicleAssetAccounts>> {
  const result = new Map<string, LoadedVehicleAssetAccounts>();
  if (vehicleIds.length === 0) return result;

  const [vehicles, settings] = await Promise.all([
    client.vehicle.findMany({
      where: { id: { in: vehicleIds }, companyId },
      select: {
        id: true,
        internNumber: true,
        domain: true,
        isActive: true,
        type: {
          select: {
            id: true,
            name: true,
            fixedAssetAccountId: true,
            accumulatedDepreciationAccountId: true,
            depreciationExpenseAccountId: true,
          },
        },
        depreciation: {
          select: {
            id: true,
            status: true,
            fixedAssetAccountId: true,
            accumulatedDepreciationAccountId: true,
            depreciationExpenseAccountId: true,
            _count: { select: { scheduleEntries: { where: { isPosted: true } } } },
          },
        },
      },
    }),
    client.accountingSettings.findUnique({
      where: { companyId },
      select: {
        fixedAssetAccountId: true,
        accumulatedDepreciationAccountId: true,
        depreciationExpenseAccountId: true,
        assetDisposalGainLossAccountId: true,
        lockedUntilDate: true,
      },
    }),
  ]);

  const resolvedByVehicle = vehicles.map((vehicle) => ({
    vehicle,
    resolved: resolveAssetAccounts({
      depreciation: vehicle.depreciation,
      type: vehicle.type,
      settings,
    }),
  }));

  const accountIds = Array.from(
    new Set(
      resolvedByVehicle.flatMap(({ resolved }) =>
        ASSET_ACCOUNT_KEYS.flatMap((key) => (resolved[key] ? [resolved[key].accountId] : []))
      )
    )
  );

  const [accountRows, imputableRows] =
    accountIds.length === 0
      ? [[], []]
      : await Promise.all([
          client.account.findMany({
            where: { id: { in: accountIds }, companyId },
            select: { id: true, code: true, name: true },
          }),
          client.account.findMany({
            where: { ...buildImputableAccountsWhere({ companyId }), id: { in: accountIds } },
            select: { id: true },
          }),
        ]);

  const imputableIds = new Set(imputableRows.map((row) => row.id));
  const accountsById = new Map(
    accountRows.map((row) => [
      row.id,
      { id: row.id, code: row.code, name: row.name, imputable: imputableIds.has(row.id) },
    ])
  );

  for (const { vehicle, resolved } of resolvedByVehicle) {
    const accounts: Record<string, LoadedAccountInfo> = {};
    for (const key of ASSET_ACCOUNT_KEYS) {
      const entry = resolved[key];
      const info = entry ? accountsById.get(entry.accountId) : undefined;
      if (info) accounts[info.id] = info;
    }

    const depreciation = vehicle.depreciation;
    result.set(vehicle.id, {
      vehicleId: vehicle.id,
      vehicleLabel: vehicle.internNumber || vehicle.domain || vehicle.id.slice(0, 8),
      typeId: vehicle.type.id,
      typeName: vehicle.type.name,
      isActive: vehicle.isActive,
      hasDepreciation: depreciation !== null,
      depreciationId: depreciation?.id ?? null,
      depreciationStatus: depreciation?.status ?? null,
      postedCount: depreciation?._count.scheduleEntries ?? 0,
      overrides: depreciation
        ? {
            fixedAssetAccountId: depreciation.fixedAssetAccountId,
            accumulatedDepreciationAccountId: depreciation.accumulatedDepreciationAccountId,
            depreciationExpenseAccountId: depreciation.depreciationExpenseAccountId,
          }
        : EMPTY_IDS,
      typeAccounts: {
        fixedAssetAccountId: vehicle.type.fixedAssetAccountId,
        accumulatedDepreciationAccountId: vehicle.type.accumulatedDepreciationAccountId,
        depreciationExpenseAccountId: vehicle.type.depreciationExpenseAccountId,
      },
      resolved,
      accounts,
      assetDisposalGainLossAccountId: settings?.assetDisposalGainLossAccountId ?? null,
      lockedUntilDate: settings?.lockedUntilDate ?? null,
    });
  }

  return result;
}

/** Atajo para un solo equipo. `undefined` si no existe o no es de la empresa. */
export async function loadVehicleAssetAccounts(
  companyId: string,
  vehicleId: string,
  client: PrismaTransactionClient = prisma
): Promise<LoadedVehicleAssetAccounts | undefined> {
  const loaded = await loadVehiclesAssetAccounts(companyId, [vehicleId], client);
  return loaded.get(vehicleId);
}

/**
 * Pre-validación antes de la transacción (patrón TSK-721). Lanza `BusinessError`
 * si falta alguna cuenta requerida por la operación, si alguna resuelta no es
 * imputable —NUNCA cae a la por defecto cuando la propia o la del tipo existe
 * pero no sirve— o si la operación es baja/ajuste y falta la cuenta de
 * resultado global. Devuelve los ids listos para el asiento.
 */
export function assertAssetAccountsForOperation(
  loaded: LoadedVehicleAssetAccounts,
  operation: AssetOperation
): AssertedAssetAccounts {
  const { vehicleLabel, typeName, resolved } = loaded;

  const missing = findMissingAssetAccounts(resolved, operation);
  if (missing.length > 0) {
    throw new BusinessError(
      buildMissingAssetAccountsMessage({ operation, vehicleLabel, typeName, missing })
    );
  }

  // Solo las cuentas que usa la operación: una cuenta de Bienes de Uso vencida
  // no debe frenar la amortización, que no la toca.
  for (const key of REQUIRED_ACCOUNTS_BY_OPERATION[operation]) {
    const entry = resolved[key];
    if (!entry) continue;
    const info = loaded.accounts[entry.accountId];
    if (info?.imputable) continue;

    throw new BusinessError(
      buildUnavailableAssetAccountMessage({
        operation,
        vehicleLabel,
        typeName,
        key,
        accountLabel: info ? formatAccountLabel(info) : entry.accountId,
        source: entry.source,
      })
    );
  }

  if (operation !== 'depreciation' && !loaded.assetDisposalGainLossAccountId) {
    throw new BusinessError(buildMissingDisposalAccountMessage({ operation, vehicleLabel }));
  }

  return {
    fixedAssetAccountId: resolved.fixedAsset?.accountId ?? null,
    accumulatedDepreciationAccountId: resolved.accumulatedDepreciation?.accountId ?? null,
    depreciationExpenseAccountId: resolved.depreciationExpense?.accountId ?? null,
    assetDisposalGainLossAccountId: loaded.assetDisposalGainLossAccountId,
  };
}
