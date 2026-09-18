import { describe, expect, it } from 'vitest';

import { formatDateUtc } from './formatters';

describe('formatDateUtc', () => {
  it('muestra el día calendario de un DateTime guardado a medianoche UTC, sin correrlo a la zona local', () => {
    // Es lo que guarda Prisma para journal_entries.date (timestamp sin zona a 00:00).
    expect(formatDateUtc(new Date('2026-09-18T00:00:00.000Z'))).toBe('18/09/2026');
    expect(formatDateUtc('2026-09-18T00:00:00.000Z')).toBe('18/09/2026');
  });

  it('respeta el día UTC también cuando la hora no es medianoche', () => {
    expect(formatDateUtc(new Date('2026-09-18T03:00:00.000Z'))).toBe('18/09/2026');
    expect(formatDateUtc(new Date('2026-09-18T23:59:59.000Z'))).toBe('18/09/2026');
  });

  it('devuelve el fallback cuando no hay fecha', () => {
    expect(formatDateUtc(null)).toBe('No especificada');
    expect(formatDateUtc(undefined, '-')).toBe('-');
  });
});
