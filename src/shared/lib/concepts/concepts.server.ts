import 'server-only';

import type { ConceptAccountMode, ConceptUsage } from '@/generated/prisma/enums';
import { buildImputableAccountsWhere } from '@/shared/lib/accounts/imputable-accounts';
import { BusinessError } from '@/shared/lib/action-result';
import type { prisma } from '@/shared/lib/prisma';

import { allowedAccountTypes, CONCEPT_USAGE_LABELS } from './usages';

// Cliente de Prisma o de transacción (mismo molde que fund-movements/list/actions.server.ts)
export type ConceptDb = Omit<
  typeof prisma,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

/** Lo que Gestión ve de un concepto: sin datos de cuenta, a propósito. */
export interface ConceptOption {
  id: string;
  name: string;
  accountMode: ConceptAccountMode;
}

export interface ResolvedConcept {
  id: string;
  name: string;
  accountMode: ConceptAccountMode;
  /** `null` cuando el concepto usa la cuenta del socio. */
  accountId: string | null;
}

/** Conceptos activos de la empresa para los usos pedidos, ordenados por nombre. */
export async function getActiveConceptOptions(
  db: ConceptDb,
  companyId: string,
  usages: ConceptUsage[]
): Promise<Record<ConceptUsage, ConceptOption[]>> {
  const result = {} as Record<ConceptUsage, ConceptOption[]>;
  for (const usage of usages) result[usage] = [];
  if (usages.length === 0) return result;

  const concepts = await db.movementConcept.findMany({
    where: { companyId, isActive: true, usages: { hasSome: usages } },
    select: { id: true, name: true, accountMode: true, usages: true },
    orderBy: { name: 'asc' },
  });
  for (const concept of concepts) {
    for (const usage of usages) {
      if (concept.usages.includes(usage)) {
        result[usage].push({ id: concept.id, name: concept.name, accountMode: concept.accountMode });
      }
    }
  }
  return result;
}

/** Cantidad de conceptos activos de la empresa para un uso. */
export async function countActiveConcepts(
  db: ConceptDb,
  companyId: string,
  usage: ConceptUsage
): Promise<number> {
  return db.movementConcept.count({
    where: { companyId, isActive: true, usages: { has: usage } },
  });
}

/**
 * Valida un concepto para un uso y devuelve su cuenta. Se llama al guardar y al
 * confirmar, porque Contabilidad puede haberlo cambiado entre una cosa y otra.
 */
export async function resolveConceptForUsage(
  db: ConceptDb,
  input: { companyId: string; conceptId: string; usage: ConceptUsage }
): Promise<ResolvedConcept> {
  const { companyId, conceptId, usage } = input;
  const concept = await db.movementConcept.findFirst({
    where: { id: conceptId, companyId },
    select: { id: true, name: true, accountMode: true, accountId: true, isActive: true, usages: true },
  });
  if (!concept) throw new BusinessError('El concepto elegido ya no existe. Elegí otro.');
  if (!concept.isActive) {
    throw new BusinessError(`El concepto «${concept.name}» está desactivado. Editá el movimiento y elegí otro concepto.`);
  }
  if (!concept.usages.includes(usage)) {
    throw new BusinessError(
      `El concepto «${concept.name}» ya no aplica a ${CONCEPT_USAGE_LABELS[usage]}. Editá el movimiento y elegí otro concepto.`
    );
  }

  if (concept.accountMode === 'PARTNER_ACCOUNT') {
    return { id: concept.id, name: concept.name, accountMode: concept.accountMode, accountId: null };
  }

  // Cuenta propia: debe seguir siendo imputable y de un tipo admitido por el uso.
  const account = concept.accountId
    ? await db.account.findFirst({
        where: {
          id: concept.accountId,
          ...buildImputableAccountsWhere({ companyId, types: allowedAccountTypes([usage]) }),
        },
        select: { id: true },
      })
    : null;
  if (!account) {
    throw new BusinessError(
      `La cuenta del concepto «${concept.name}» no está activa o no es imputable. Pedile a Contabilidad que la corrija en Empresa → Contabilidad → Conceptos.`
    );
  }
  return { id: concept.id, name: concept.name, accountMode: concept.accountMode, accountId: account.id };
}
