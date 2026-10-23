import { describe, expect, it } from 'vitest';

import { fingerprintProposal } from './fingerprint';
import type { ProposalCard } from './types';

const cards = (after = '$ 80,00'): ProposalCard[] => [
  {
    key: 'A',
    title: 'FC',
    action: 'MODIFY',
    rows: [{ label: 'Total', before: '$ 100,00', after }],
  },
  { key: 'B', title: 'OP', action: 'RECALCULATE', rows: [] },
];

describe('fingerprintProposal', () => {
  it('misma propuesta → misma huella', () => {
    const h = fingerprintProposal(cards(), { op1: 'p1' });
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(fingerprintProposal(cards(), { op1: 'p1' })).toBe(h);
  });

  it('cambia un importe → cambia la huella', () => {
    expect(fingerprintProposal(cards('$ 81,00'), {})).not.toBe(fingerprintProposal(cards(), {}));
  });

  it('orden de choices no importa', () => {
    expect(fingerprintProposal(cards(), { a: '1', b: '2' })).toBe(
      fingerprintProposal(cards(), { b: '2', a: '1' })
    );
  });

  it('orden de cards sí importa; orden de claves dentro de una card no', () => {
    const [a, b] = cards();
    expect(fingerprintProposal([b, a], {})).not.toBe(fingerprintProposal([a, b], {}));
    const reordered = {
      rows: a.rows,
      action: a.action,
      title: a.title,
      key: a.key,
    } as ProposalCard;
    expect(fingerprintProposal([reordered, b], {})).toBe(fingerprintProposal([a, b], {}));
  });

  it('una choice distinta cambia la huella', () => {
    expect(fingerprintProposal(cards(), { a: '1' })).not.toBe(
      fingerprintProposal(cards(), { a: '2' })
    );
  });
});
