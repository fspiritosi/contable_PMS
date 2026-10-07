/**
 * Cálculo puro del cierre anual (TSK-760, Fase 9: B20, B21, C4, H5; diseño §3.3.9).
 *
 * - Refundición: cada cuenta de resultado (REVENUE/EXPENSE) con saldo va al lado contrario
 *   y la diferencia a la cuenta Resultado del Ejercicio. Sin línea de Resultado cuando la
 *   diferencia es 0 (ingresos = gastos): el CHECK de la DB rechaza una línea 0/0 (H5).
 * - Apertura: saldos patrimoniales al cierre más el efecto de la refundición sobre la cuenta
 *   Resultado (B21): así balancea siempre, porque los saldos de todas las cuentas suman 0.
 * - Sumas con `Decimal` y redondeo a centavos (los importes de la DB tienen 2 decimales).
 *
 * Puro (sin DB): usable en cliente y testeable sin base.
 */
import type { Prisma as PrismaTypes } from '@/generated/prisma/client';
import { Prisma } from '@/generated/prisma/browser';
import type { AccountType } from '@/generated/prisma/enums';

import type { Amount } from './journal-entry-types';

export interface AccountRef {
  id: string;
  code: string;
  name: string;
}

/** Sumas de Debe y Haber de una cuenta (acumuladas hasta el fin del ejercicio). */
export interface AccountBalanceRow {
  accountId: string;
  code: string;
  name: string;
  type: AccountType;
  debit: Amount;
  credit: Amount;
}

export interface ClosingLine {
  accountId: string;
  accountCode: string;
  accountName: string;
  debit: number;
  credit: number;
}

export interface ResultTotals {
  totalRevenue: number;
  totalExpense: number;
  netResult: number;
}

const RESULT_TYPES: readonly AccountType[] = ['REVENUE', 'EXPENSE'];
const PATRIMONIAL_TYPES: readonly AccountType[] = ['ASSET', 'LIABILITY', 'EQUITY'];

const toDecimal = (amount: Amount): PrismaTypes.Decimal =>
  typeof amount === 'number' ? new Prisma.Decimal(amount) : new Prisma.Decimal(amount.toString());

/** Saldo deudor (Debe − Haber) redondeado a centavos. */
const balanceOf = (row: AccountBalanceRow): PrismaTypes.Decimal =>
  toDecimal(row.debit).minus(toDecimal(row.credit)).toDecimalPlaces(2);

const byCode = (a: ClosingLine, b: ClosingLine) => a.accountCode.localeCompare(b.accountCode);

/** Línea con el saldo deudor `balance` del lado que corresponda (positivo → Debe). */
function lineFor(account: AccountRef, balance: PrismaTypes.Decimal): ClosingLine {
  return {
    accountId: account.id,
    accountCode: account.code,
    accountName: account.name,
    debit: balance.isPositive() ? balance.toNumber() : 0,
    credit: balance.isNegative() ? balance.abs().toNumber() : 0,
  };
}

const refOf = (row: AccountBalanceRow): AccountRef => ({
  id: row.accountId,
  code: row.code,
  name: row.name,
});

/**
 * Refundición: cancela cada cuenta de resultado con saldo (al lado contrario) y lleva la
 * diferencia a Resultado del Ejercicio solo si no es 0 (H5). Sin resultados → [] (B20).
 */
export function buildClosingLines(
  results: readonly AccountBalanceRow[],
  resultAccount: AccountRef
): ClosingLine[] {
  const lines: ClosingLine[] = [];
  let net = new Prisma.Decimal(0); // Σ saldos deudores de resultado

  for (const row of results) {
    if (!RESULT_TYPES.includes(row.type)) continue;
    const balance = balanceOf(row);
    if (balance.isZero()) continue;
    lines.push(lineFor(refOf(row), balance.negated()));
    net = net.plus(balance);
  }
  if (lines.length === 0) return [];

  lines.sort(byCode);
  // La contrapartida en Resultado es el saldo neto (deudor si hubo pérdida).
  if (!net.isZero()) lines.push(lineFor(resultAccount, net));
  return lines;
}

/**
 * Apertura: saldos patrimoniales (sin cuentas en cero) más el efecto de la refundición sobre
 * la cuenta Resultado, fusionado con su saldo previo en una sola línea (B21).
 */
export function buildOpeningLines(
  patrimonial: readonly AccountBalanceRow[],
  closing: readonly ClosingLine[],
  resultAccount: AccountRef
): ClosingLine[] {
  const balances = new Map<string, { account: AccountRef; balance: PrismaTypes.Decimal }>();

  for (const row of patrimonial) {
    if (!PATRIMONIAL_TYPES.includes(row.type)) continue;
    const previous = balances.get(row.accountId)?.balance ?? new Prisma.Decimal(0);
    balances.set(row.accountId, { account: refOf(row), balance: previous.plus(balanceOf(row)) });
  }

  for (const line of closing) {
    if (line.accountId !== resultAccount.id) continue;
    const effect = new Prisma.Decimal(line.debit).minus(new Prisma.Decimal(line.credit));
    const previous = balances.get(resultAccount.id)?.balance ?? new Prisma.Decimal(0);
    balances.set(resultAccount.id, { account: resultAccount, balance: previous.plus(effect) });
  }

  return [...balances.values()]
    .filter(({ balance }) => !balance.isZero())
    .map(({ account, balance }) => lineFor(account, balance))
    .sort(byCode);
}

/** Ingresos netos, gastos netos y resultado (para el resumen de la vista previa). */
export function summarizeResults(results: readonly AccountBalanceRow[]): ResultTotals {
  let revenue = new Prisma.Decimal(0);
  let expense = new Prisma.Decimal(0);
  for (const row of results) {
    if (row.type === 'REVENUE') revenue = revenue.minus(balanceOf(row));
    else if (row.type === 'EXPENSE') expense = expense.plus(balanceOf(row));
  }
  return {
    totalRevenue: revenue.toNumber(),
    totalExpense: expense.toNumber(),
    netResult: revenue.minus(expense).toNumber(),
  };
}
