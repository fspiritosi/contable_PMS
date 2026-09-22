/**
 * Tests de integración de la confirmación de un gasto (Egresos) cuando el
 * asiento no se puede generar (TSK-728), contra la base real.
 *
 * El gasto no tiene pagos: su asiento es siempre "Cuenta de Gastos Operativos"
 * contra "Cuentas por Pagar". Antes, si faltaba alguna, la integración devolvía
 * `null` y el gasto quedaba `CONFIRMED` sin asiento. Ahora `confirmExpense`
 * pre-valida las dos cuentas (y su imputabilidad) antes de la transacción y
 * devuelve `ActionResult<{ budgetWarning? }>`, conservando el aviso
 * presupuestario no bloqueante.
 *
 * Se entra por los **server actions reales** (`createExpense`, `confirmExpense`).
 */
import 'dotenv/config';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { prisma } from '@/shared/lib/prisma';

// Frontera aislada: sesión, permisos, empresa activa y caché de Next.
vi.mock('@/shared/lib/current-user', () => ({ getCurrentUserId: vi.fn() }));
vi.mock('@/shared/lib/company', () => ({ getActiveCompanyId: vi.fn() }));
vi.mock('@/shared/lib/permissions', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/shared/lib/permissions')>()),
  checkPermission: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { getActiveCompanyId } from '@/shared/lib/company';
import { getCurrentUserId } from '@/shared/lib/current-user';

// Código real de producción.
import { confirmExpense, createExpense } from './actions.server';

const PREFIX = 'TSK728-GAS-';
const EXPENSE_DATE = new Date('2026-03-10');

let dbAvailable = false;
try {
  await prisma.$queryRaw`SELECT 1`;
  dbAvailable = true;
} catch {
  dbAvailable = false;
}

interface JournalLineRow {
  accountId: string;
  debit: number;
  credit: number;
  supplierId: string | null;
}

describe.skipIf(!dbAvailable)('integración e2e: asiento al confirmar un gasto (TSK-728)', () => {
  let companyId: string;
  let supplierId: string;
  let categoryId: string;

  let gastosId: string;
  let pagarId: string;
  let gastosViejaId: string;
  const GASTOS_VIEJA_CODE = 'T728G-GASTOS-VIEJA';

  const setSettings = (data: {
    expensesAccountId?: string | null;
    payablesAccountId?: string | null;
    lockedUntilDate?: Date | null;
  }) => prisma.accountingSettings.update({ where: { companyId }, data });

  /** Gasto en borrador por el `createExpense` real: $1000 con proveedor. */
  async function createDraft(description: string) {
    const result = await createExpense({
      description: `${PREFIX}${description}`,
      amount: '1000',
      date: EXPENSE_DATE,
      dueDate: null,
      categoryId,
      supplierId,
      notes: null,
    });
    return result.id;
  }

  async function readExpense(id: string) {
    return prisma.expense.findUniqueOrThrow({
      where: { id },
      select: { status: true, journalEntryId: true, fullNumber: true },
    });
  }

  async function fetchEntryLines(expenseId: string): Promise<JournalLineRow[]> {
    const expense = await readExpense(expenseId);
    if (!expense.journalEntryId) throw new Error('El gasto no tiene asiento generado');
    const rows = await prisma.journalEntryLine.findMany({
      where: { entryId: expense.journalEntryId },
      select: { accountId: true, debit: true, credit: true, supplierId: true },
    });
    return rows.map((r) => ({
      accountId: r.accountId,
      debit: Number(r.debit),
      credit: Number(r.credit),
      supplierId: r.supplierId,
    }));
  }

  beforeAll(async () => {
    const company = await prisma.company.create({
      data: { name: `${PREFIX}Empresa`, isActive: true },
    });
    companyId = company.id;

    const mk = (
      code: string,
      name: string,
      type: 'EXPENSE' | 'LIABILITY',
      nature: 'DEBIT' | 'CREDIT'
    ) =>
      prisma.account.create({ data: { companyId, code, name: `${PREFIX}${name}`, type, nature } });

    const [gastos, pagar, gastosVieja] = await Promise.all([
      mk('T728G-GASTOS', 'Gastos Operativos', 'EXPENSE', 'DEBIT'),
      mk('T728G-PAGAR', 'Cuentas por Pagar', 'LIABILITY', 'CREDIT'),
      mk(GASTOS_VIEJA_CODE, 'Gastos vieja', 'EXPENSE', 'DEBIT'),
    ]);
    gastosId = gastos.id;
    pagarId = pagar.id;
    gastosViejaId = gastosVieja.id;

    await prisma.accountingSettings.create({
      data: {
        companyId,
        // A mediodía UTC: `checkBudgetForExpense` toma el mes de inicio con `moment()` local y
        // una medianoche UTC cae en diciembre en UTC-3 (quirk previo, fuera de este ticket).
        fiscalYearStart: new Date('2026-01-01T12:00:00Z'),
        fiscalYearEnd: new Date('2026-12-31T12:00:00Z'),
        expensesAccountId: gastosId,
        payablesAccountId: pagarId,
        requireCostCenter: false,
      },
    });

    const supplier = await prisma.supplier.create({
      data: {
        companyId,
        code: `${PREFIX}PROV`,
        businessName: `${PREFIX}Proveedor`,
        taxId: '30500000002',
        taxCondition: 'RESPONSABLE_INSCRIPTO',
        createdBy: 'test',
      },
      select: { id: true },
    });
    supplierId = supplier.id;

    const category = await prisma.expenseCategory.create({
      data: { companyId, name: `${PREFIX}Categoría` },
      select: { id: true },
    });
    categoryId = category.id;

    vi.mocked(getActiveCompanyId).mockResolvedValue(companyId);
    vi.mocked(getCurrentUserId).mockResolvedValue('test-user');
  });

  afterAll(async () => {
    // Guarda: sin `companyId` Prisma omite el filtro y borraría tablas enteras.
    if (companyId) {
      await prisma.expense.deleteMany({ where: { companyId } });
      await prisma.journalEntry.deleteMany({ where: { companyId } });
      await prisma.budget.deleteMany({ where: { companyId } });
      await prisma.expenseCategory.deleteMany({ where: { companyId } });
      await prisma.supplier.deleteMany({ where: { companyId } });
      await prisma.accountingSettings.deleteMany({ where: { companyId } });
      await prisma.account.deleteMany({ where: { companyId } });
      await prisma.company.deleteMany({ where: { id: companyId } });
    }

    const [remainingCompanies, remainingAccounts, remainingExpenses] = await Promise.all([
      prisma.company.count({ where: { name: { startsWith: PREFIX } } }),
      prisma.account.count({ where: { name: { startsWith: PREFIX } } }),
      prisma.expense.count({ where: { description: { startsWith: PREFIX } } }),
    ]);
    expect(remainingCompanies).toBe(0);
    expect(remainingAccounts).toBe(0);
    expect(remainingExpenses).toBe(0);

    await prisma.$disconnect();
  });

  it('caso 1: ambas cuentas configuradas → confirma sin aviso; Debe Gastos / Haber Pagar con proveedor', async () => {
    const id = await createDraft('Gasto ok');

    const result = await confirmExpense(id);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.budgetWarning).toBeUndefined();

    const expense = await readExpense(id);
    expect(expense.status).toBe('CONFIRMED');
    const lines = await fetchEntryLines(id);
    expect(lines).toHaveLength(2);
    expect(lines.find((l) => l.accountId === gastosId)?.debit).toBe(1000);
    const pagar = lines.find((l) => l.accountId === pagarId);
    expect(pagar?.credit).toBe(1000);
    expect(pagar?.supplierId).toBe(supplierId);
  });

  it('caso 2: sin "Cuenta de Gastos Operativos" → bloqueado con el label exacto; sigue en borrador', async () => {
    const id = await createDraft('Sin cuenta de gastos');
    await setSettings({ expensesAccountId: null });
    try {
      const result = await confirmExpense(id);
      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error).toContain('No se puede confirmar el gasto GTO-');
      expect(result.error).toContain('falta configurar "Cuenta de Gastos Operativos"');
      expect(result.error).toContain('en Contabilidad → Configuración');

      const expense = await readExpense(id);
      expect(expense.status).toBe('DRAFT');
      expect(expense.journalEntryId).toBeNull();
    } finally {
      await setSettings({ expensesAccountId: gastosId });
    }
  });

  it('caso 3: sin "Cuentas por Pagar" → bloqueado; con ambas vacías el mensaje nombra las dos', async () => {
    const id = await createDraft('Sin cuenta por pagar');
    await setSettings({ payablesAccountId: null });
    try {
      const result = await confirmExpense(id);
      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error).toContain('falta configurar "Cuentas por Pagar"');

      await setSettings({ expensesAccountId: null });
      const both = await confirmExpense(id);
      expect(both.success).toBe(false);
      if (both.success) return;
      expect(both.error).toContain(
        'falta configurar "Cuenta de Gastos Operativos" y "Cuentas por Pagar"'
      );
      expect((await readExpense(id)).status).toBe('DRAFT');
    } finally {
      await setSettings({ expensesAccountId: gastosId, payablesAccountId: pagarId });
    }
  });

  it('caso 4: cuenta de gastos inactiva → bloqueado nombrando la cuenta y dónde corregirla', async () => {
    const id = await createDraft('Cuenta inactiva');
    await prisma.account.update({ where: { id: gastosViejaId }, data: { isActive: false } });
    await setSettings({ expensesAccountId: gastosViejaId });
    try {
      const result = await confirmExpense(id);
      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error).toContain(`la cuenta ${GASTOS_VIEJA_CODE} - ${PREFIX}Gastos vieja`);
      expect(result.error).toContain('(configurada como "Cuenta de Gastos Operativos")');
      expect(result.error).toContain('no está activa o no es imputable');
      expect(result.error).toContain('Corregila en Contabilidad → Configuración');
      expect((await readExpense(id)).status).toBe('DRAFT');
    } finally {
      await setSettings({ expensesAccountId: gastosId });
      await prisma.account.update({ where: { id: gastosViejaId }, data: { isActive: true } });
    }
  });

  it('caso 5: presupuesto mensual chico → confirma con budgetWarning y asiento igual', async () => {
    const monthlyAmounts = Array.from({ length: 12 }, () => 0);
    monthlyAmounts[2] = 1000; // marzo (ejercicio que arranca en enero)
    await prisma.budget.create({
      data: {
        companyId,
        accountId: gastosId,
        fiscalYear: 2026,
        status: 'ACTIVE',
        monthlyAmounts,
        totalAmount: 1000,
        createdBy: 'test',
      },
    });

    const id = await createDraft('Con presupuesto');
    const result = await confirmExpense(id);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.budgetWarning).toBeDefined();
    expect(result.budgetWarning?.executedPercent).toBeGreaterThanOrEqual(80);
    expect(result.budgetWarning?.message).toContain('presupuesto mensual');

    expect((await readExpense(id)).status).toBe('CONFIRMED');
    expect(await fetchEntryLines(id)).toHaveLength(2);
  });

  it('caso 6: período cerrado → error legible; sigue en borrador', async () => {
    const id = await createDraft('Período cerrado');
    await setSettings({ lockedUntilDate: new Date('2026-12-31') });
    try {
      const result = await confirmExpense(id);
      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error).toContain('período está cerrado');

      const expense = await readExpense(id);
      expect(expense.status).toBe('DRAFT');
      expect(expense.journalEntryId).toBeNull();
    } finally {
      await setSettings({ lockedUntilDate: null });
    }
  });

  it('caso 7: confirmar dos veces → "Gasto no encontrado o ya confirmado"', async () => {
    const id = await createDraft('Dos veces');
    expect((await confirmExpense(id)).success).toBe(true);

    const again = await confirmExpense(id);
    expect(again.success).toBe(false);
    if (again.success) return;
    expect(again.error).toBe('Gasto no encontrado o ya confirmado');
  });
});
