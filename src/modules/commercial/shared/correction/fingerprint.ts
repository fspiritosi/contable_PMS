import { createHash } from 'node:crypto';

import type { PaymentChoices, ProposalCard } from './types';

/** JSON estable: claves de objeto ordenadas (recursivo); el orden de los arrays se respeta. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`);
  return `{${entries.join(',')}}`;
}

/** Huella sha256 de la propuesta: cards en el orden dado y choices ordenadas por clave. */
export function fingerprintProposal(
  cards: readonly ProposalCard[],
  choices: PaymentChoices
): string {
  const sortedChoices = Object.entries(choices).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return createHash('sha256')
    .update(stableStringify({ cards, choices: sortedChoices }))
    .digest('hex');
}
