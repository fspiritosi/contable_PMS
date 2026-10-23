import { describe, expect, it } from 'vitest';

import { allocateReduction, planPaymentReduction, type Cancellation } from './allocation';

const c = (
  itemId: string,
  amount: number,
  date: string,
  createdAt = `${date}T10:00:00Z`
): Cancellation => ({
  itemId,
  documentId: `doc-${itemId}`,
  source: 'PAYMENT_ORDER',
  amount,
  date: new Date(`${date}T00:00:00Z`),
  createdAt: new Date(createdAt),
});

const OP1 = c('op1', 600, '2026-10-01');
const OP2 = c('op2', 400, '2026-10-05');

describe('allocateReduction', () => {
  it('reparte desde la más reciente', () => {
    expect(allocateReduction([OP1, OP2], 200)).toEqual([
      { itemId: 'op2', documentId: 'doc-op2', source: 'PAYMENT_ORDER', before: 400, after: 200 },
    ]);
  });

  it('consume varias', () => {
    const res = allocateReduction([OP1, OP2], 500);
    expect(res.map((r) => [r.itemId, r.before, r.after])).toEqual([
      ['op2', 400, 0],
      ['op1', 600, 500],
    ]);
  });

  it('desempata por createdAt desc con la misma fecha', () => {
    const a = c('a', 100, '2026-10-01', '2026-10-01T09:00:00Z');
    const b = c('b', 100, '2026-10-01', '2026-10-01T11:00:00Z');
    expect(allocateReduction([a, b], 50)[0].itemId).toBe('b');
  });

  it('reducción 0 no ajusta nada', () => {
    expect(allocateReduction([OP1, OP2], 0)).toEqual([]);
  });

  it('reducción mayor al total deja todo en 0', () => {
    const res = allocateReduction([OP1, OP2], 5000);
    expect(res.map((r) => r.after)).toEqual([0, 0]);
  });

  it('redondea a centavos sin perder 0,01', () => {
    const items = [
      c('a', 33.33, '2026-10-01'),
      c('b', 33.33, '2026-10-02'),
      c('c', 33.33, '2026-10-03'),
    ];
    const res = allocateReduction(items, 99.99);
    expect(res.map((r) => r.after)).toEqual([0, 0, 0]);
    expect(res.reduce((s, r) => s + (r.before - r.after), 0)).toBeCloseTo(99.99, 10);
  });
});

describe('planPaymentReduction', () => {
  const cash = { id: 'p1', amount: 300, label: 'Efectivo' };
  const bank = { id: 'p2', amount: 700, label: 'Transferencia' };

  it('un medio OK', () => {
    expect(planPaymentReduction([cash], 100)).toEqual({ kind: 'OK', paymentId: 'p1', after: 200 });
  });

  it('varios sin choice → NEEDS_CHOICE con los medios que alcanzan', () => {
    expect(planPaymentReduction([cash, bank], 100)).toEqual({
      kind: 'NEEDS_CHOICE',
      options: [cash, bank],
    });
  });

  it('solo se ofrecen los medios que cubren la reducción', () => {
    expect(planPaymentReduction([cash, bank], 500)).toEqual({
      kind: 'NEEDS_CHOICE',
      options: [bank],
    });
  });

  it('varios con choice OK', () => {
    expect(planPaymentReduction([cash, bank], 100, 'p2')).toEqual({
      kind: 'OK',
      paymentId: 'p2',
      after: 600,
    });
  });

  it('choice inexistente → NEEDS_CHOICE', () => {
    expect(planPaymentReduction([cash, bank], 100, 'zzz')).toEqual({
      kind: 'NEEDS_CHOICE',
      options: [cash, bank],
    });
  });

  it('choice de un medio que no alcanza no se acepta: vuelve a pedir entre los que alcanzan', () => {
    expect(planPaymentReduction([cash, bank], 400, 'p1')).toEqual({
      kind: 'NEEDS_CHOICE',
      options: [bank],
    });
  });

  it('ningún medio alcanza → INSUFFICIENT', () => {
    expect(planPaymentReduction([cash], 300.01)).toEqual({ kind: 'INSUFFICIENT' });
    expect(planPaymentReduction([cash, bank], 700.01, 'p2')).toEqual({ kind: 'INSUFFICIENT' });
  });

  it('reducción exacta deja el medio en 0', () => {
    expect(planPaymentReduction([cash], 300)).toEqual({ kind: 'OK', paymentId: 'p1', after: 0 });
  });
});
