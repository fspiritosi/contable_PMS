import { describe, expect, it } from 'vitest';

import { toPeriodStart } from './period';

describe('normalizacion del periodo', () => {
  it('lleva cualquier fecha del mes al dia 1', () => {
    expect(toPeriodStart(new Date('2026-08-17T15:30:00Z'))).toEqual(new Date('2026-08-01T00:00:00Z'));
  });

  it('una fecha que ya es dia 1 no cambia', () => {
    expect(toPeriodStart(new Date('2026-08-01T00:00:00Z'))).toEqual(new Date('2026-08-01T00:00:00Z'));
  });

  it('el ultimo dia del mes queda en el mismo mes', () => {
    expect(toPeriodStart(new Date('2026-01-31T23:59:59Z'))).toEqual(new Date('2026-01-01T00:00:00Z'));
  });
});
