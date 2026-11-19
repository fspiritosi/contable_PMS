import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import type { Prisma } from '@/generated/prisma/client';
import { describeAccountReferences, REFERENCE_KEYS } from './deleted-account-code.server';

/** Relaciones de lista (`Modelo[]`) del `model Account` del schema. */
function accountListRelations(): string[] {
  const schema = readFileSync(resolve(__dirname, '../../../../../../prisma/schema.prisma'), 'utf8');
  const block = schema.match(/^model Account \{\n([\s\S]*?)^\}/m);
  if (!block) throw new Error('No se encontró `model Account` en prisma/schema.prisma');
  return block[1]
    .split('\n')
    .map((line) => line.trim().match(/^(\w+)\s+\w+\[\]/))
    .filter((match): match is RegExpMatchArray => match !== null)
    .map((match) => match[1]);
}

describe('ACCOUNT_REFERENCE_LABELS (TSK-864)', () => {
  it('cubre todas las relaciones de Account del schema', () => {
    // Si falla: agregá la relación nueva a ACCOUNT_REFERENCE_LABELS con su etiqueta.
    // Sin eso, reutilizar el código de una cuenta eliminada borraría la cuenta y
    // dejaría esa referencia en NULL sin avisar.
    const relations = accountListRelations();
    expect(relations.length).toBeGreaterThan(50);
    expect([...REFERENCE_KEYS].sort()).toEqual([...relations].sort());
  });

  it('nombra cada lugar una sola vez', () => {
    const counts = Object.fromEntries(REFERENCE_KEYS.map((key) => [key, 0])) as Record<
      keyof Prisma.AccountCountOutputType,
      number
    >;
    counts.checks = 2;
    counts.paymentOrderInstallments = 1;
    counts.settingsAsChecksPayable = 1;
    counts.settingsAsPartnerDebts = 1;

    expect(describeAccountReferences(counts)).toEqual([
      'Configuración contable',
      'Cheques',
      'Cuotas de órdenes de pago',
    ]);
  });
});
