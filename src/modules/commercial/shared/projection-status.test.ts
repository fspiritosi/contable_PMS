import { describe, expect, it } from 'vitest';

import { projectionStatusFor } from './projection-status';

describe('projectionStatusFor', () => {
  it('confirmada si lo vinculado cubre el importe', () => {
    expect(projectionStatusFor(100, 100)).toBe('CONFIRMED');
    expect(projectionStatusFor(120, 100)).toBe('CONFIRMED');
  });
  it('parcial con algo vinculado', () => {
    expect(projectionStatusFor(0.01, 100)).toBe('PARTIAL');
  });
  it('pendiente sin nada vinculado (o negativo)', () => {
    expect(projectionStatusFor(0, 100)).toBe('PENDING');
    expect(projectionStatusFor(-5, 100)).toBe('PENDING');
  });
});
