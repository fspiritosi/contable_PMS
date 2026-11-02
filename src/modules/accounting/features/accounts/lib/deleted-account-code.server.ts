import 'server-only';

import type { Prisma } from '@/generated/prisma/client';
import type { prisma } from '@/shared/lib/prisma';
import { BusinessError } from '@/shared/lib/action-result';

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

/**
 * Dónde puede estar asignada una cuenta, con el nombre que ve el usuario.
 *
 * Es un `Record` sobre TODAS las relaciones de `Account`: si mañana se agrega una
 * relación nueva al schema, `npm run check-types` falla hasta sumarla acá (ojo: el
 * `next build` NO, porque corre con `ignoreBuildErrors`). Sin eso, borrar una
 * cuenta eliminada podría dejar en NULL una referencia en silencio (las FK
 * opcionales hacen `SET NULL`) en lugar de frenar con un mensaje.
 */
const ACCOUNT_REFERENCE_LABELS: Record<keyof Prisma.AccountCountOutputType, string> = {
  children: 'Subcuentas',
  entries: 'Asientos contables',
  suppliers: 'Proveedores',
  contractors: 'Clientes',
  bankAccounts: 'Cuentas bancarias',
  cashRegisters: 'Cajas',
  partners: 'Socios',
  investmentHoldings: 'Inversiones',
  vehicleTypesAsFixedAsset: 'Tipos de equipo',
  vehicleTypesAsAccumulatedDepr: 'Tipos de equipo',
  vehicleTypesAsDepreciationExpense: 'Tipos de equipo',
  depreciationsAsFixedAsset: 'Depreciaciones de equipos',
  depreciationsAsAccumulatedDepr: 'Depreciaciones de equipos',
  depreciationsAsDepreciationExpense: 'Depreciaciones de equipos',
  expenseCategories: 'Categorías de egreso',
  vatAccountMappings: 'Cuentas de IVA por alícuota',
  recurringEntryLines: 'Asientos recurrentes',
  budgets: 'Presupuestos',
  withholdingRegimes: 'Regímenes de retención',
  productsAsExpenseAccount: 'Productos',
  productsAsIncomeAccount: 'Productos',
  fundMovementLines: 'Movimientos de fondos',
  movementConcepts: 'Conceptos de movimientos',
  settingsAsSalesAccount: 'Configuración contable',
  settingsAsPurchasesAccount: 'Configuración contable',
  settingsAsReceivablesAccount: 'Configuración contable',
  settingsAsPayablesAccount: 'Configuración contable',
  settingsAsVatDebitAccount: 'Configuración contable',
  settingsAsVatCreditAccount: 'Configuración contable',
  settingsAsDefaultCashAccount: 'Configuración contable',
  settingsAsDefaultBankAccount: 'Configuración contable',
  settingsAsBankCharges: 'Configuración contable',
  settingsAsHoldingGain: 'Configuración contable',
  settingsAsHoldingLoss: 'Configuración contable',
  settingsAsInvestmentFees: 'Configuración contable',
  settingsAsExpensesAccount: 'Configuración contable',
  settingsAsResultAccount: 'Configuración contable',
  settingsAsPartnerContributions: 'Configuración contable',
  settingsAsWhIvaEmitted: 'Configuración contable',
  settingsAsWhGananciasEmitted: 'Configuración contable',
  settingsAsWhIibbEmitted: 'Configuración contable',
  settingsAsWhSussEmitted: 'Configuración contable',
  settingsAsWhIvaSuffered: 'Configuración contable',
  settingsAsWhGananciasSuffered: 'Configuración contable',
  settingsAsWhIibbSuffered: 'Configuración contable',
  settingsAsWhSussSuffered: 'Configuración contable',
  settingsAsFixedAsset: 'Configuración contable',
  settingsAsAccumulatedDepr: 'Configuración contable',
  settingsAsDepreciationExpense: 'Configuración contable',
  settingsAsAssetDisposalGL: 'Configuración contable',
  settingsAsPercIvaCollected: 'Configuración contable',
  settingsAsPercIibbCollected: 'Configuración contable',
  settingsAsPercMunicipalCollected: 'Configuración contable',
  settingsAsPercIvaSuffered: 'Configuración contable',
  settingsAsPercIibbSuffered: 'Configuración contable',
  settingsAsPercMunicipalSuffered: 'Configuración contable',
  settingsAsInternalTaxes: 'Configuración contable',
  settingsAsCogs: 'Configuración contable',
  settingsAsInventory: 'Configuración contable',
  settingsAsChecksReceived: 'Configuración contable',
  settingsAsChecksRejected: 'Configuración contable',
  settingsAsVatPayable: 'Configuración contable',
  settingsAsVatBalance: 'Configuración contable',
  settingsAsRecpam: 'Configuración contable',
};

const REFERENCE_KEYS = Object.keys(ACCOUNT_REFERENCE_LABELS) as Array<
  keyof Prisma.AccountCountOutputType
>;

const REFERENCE_COUNT_SELECT = Object.fromEntries(
  REFERENCE_KEYS.map((key) => [key, true])
) as Record<keyof Prisma.AccountCountOutputType, true>;

/** Etiquetas sin repetir de las relaciones con al menos un registro. */
export function describeAccountReferences(counts: Prisma.AccountCountOutputType): string[] {
  const labels = REFERENCE_KEYS.filter((key) => counts[key] > 0).map(
    (key) => ACCOUNT_REFERENCE_LABELS[key]
  );
  return [...new Set(labels)];
}

/**
 * Deja libre `code` para una cuenta nueva o editada (TSK-822).
 *
 * Eliminar una cuenta es un soft delete: la cuenta desaparece del Plan de Cuentas
 * pero su código seguía ocupado por el `@@unique([companyId, code])`, y el
 * usuario no tenía forma de ver qué lo ocupaba.
 *
 * - Sin cuenta con ese código: no hace nada.
 * - Cuenta ACTIVA con ese código: `BusinessError` (duplicado real).
 * - Cuenta ELIMINADA sin referencias: se borra físicamente y el código queda libre.
 *   La baja ya exige que no tenga movimientos ni subcuentas, así que no se pierde
 *   historia contable.
 * - Cuenta ELIMINADA todavía asignada en algún lado: `BusinessError` que nombra
 *   dónde, para no dejar esas referencias en NULL en silencio.
 *
 * Corre dentro de la transacción del alta/edición: el borrado y el `create` /
 * `update` posterior son atómicos.
 *
 * @returns el `parentId` de la cuenta borrada (para recomputar su `isLeaf`), o null.
 */
export async function freeAccountCode(
  tx: Tx,
  params: { companyId: string; code: string; excludeId?: string }
): Promise<{ freedParentId: string | null }> {
  const { companyId, code, excludeId } = params;

  const holder = await tx.account.findFirst({
    where: { companyId, code, ...(excludeId ? { id: { not: excludeId } } : {}) },
    select: {
      id: true,
      name: true,
      isActive: true,
      parentId: true,
      _count: { select: REFERENCE_COUNT_SELECT },
    },
  });

  if (!holder) return { freedParentId: null };

  if (holder.isActive) {
    throw new BusinessError(`Ya existe una cuenta con el código ${code} («${holder.name}»)`);
  }

  const references = describeAccountReferences(holder._count);
  if (references.length > 0) {
    throw new BusinessError(
      `El código ${code} pertenece a la cuenta eliminada «${holder.name}», que todavía está ` +
        `asignada en: ${references.join(', ')}. Quitá esa asignación o usá otro código.`
    );
  }

  await tx.account.delete({ where: { id: holder.id } });
  return { freedParentId: holder.parentId };
}
