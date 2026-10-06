/**
 * Tests de integración de la confirmación de un gasto (Egresos) cuando el
 * asiento no se puede generar (TSK-728), contra la base real.
 *
 * El gasto no tiene pagos: su asiento es la cuenta del Debe (la de su categoría
 * o, si no tiene, la "Cuenta de egresos por defecto", TSK-757) contra "Cuentas
 * por Pagar". Antes, si faltaba alguna, la integración devolvía
 * `null` y el gasto quedaba `CONFIRMED` sin asiento. Ahora `confirmExpense`
 * pre-valida las dos cuentas (y su imputabilidad) antes de la transacción y
 * devuelve `ActionResult<{ budgetWarning? }>`, conservando el aviso
 * presupuestario no bloqueante.
 *
 * Se entra por los **server actions reales** (`createExpense`, `confirmExpense`).
 *
 * TSK-757: las categorías de gasto guardan su cuenta contable propia (ABM con
 * `ActionResult`, validación multiempresa y combo con `includeIds`), casos C1–C6;
 * y el asiento, la pre-validación y el presupuesto usan la cuenta resuelta
 * (categoría → por defecto; cuenta de categoría no imputable bloquea), casos 8–13;
 * y el detalle (`getExpenseById`) muestra la cuenta del Debe, caso D1.
 * Los casos 1–7 usan una categoría sin cuenta (mismo comportamiento que TSK-728).
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
import {
  confirmExpense,
  createExpense,
  createExpenseCategory,
  getExpenseById,
  getExpenseCategoryAccounts,
  toggleExpenseCategory,
  updateExpenseCategory,
} from './actions.server';

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
  async function createDraft(description: string, expenseCategoryId: string = categoryId) {
    const result = await createExpense({
      description: `${PREFIX}${description}`,
      amount: '1000',
      date: EXPENSE_DATE,
      dueDate: null,
      categoryId: expenseCategoryId,
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

  it('caso 2: sin "Cuenta de egresos por defecto" → bloqueado con el label exacto y la salida por categoría; sigue en borrador', async () => {
    const id = await createDraft('Sin cuenta de gastos');
    await setSettings({ expensesAccountId: null });
    try {
      const result = await confirmExpense(id);
      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error).toContain('No se puede confirmar el gasto GTO-');
      expect(result.error).toContain('falta configurar "Cuenta de egresos por defecto"');
      expect(result.error).toContain('en Contabilidad → Configuración');
      expect(result.error).toContain(
        `o asignale una cuenta contable a la categoría "${PREFIX}Categoría" en Comercial → Egresos → Categorías.`
      );

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
        'falta configurar "Cuenta de egresos por defecto" y "Cuentas por Pagar"'
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
      expect(result.error).toContain('(configurada como "Cuenta de egresos por defecto")');
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

  describe('categorías con cuenta (TSK-757)', () => {
    let alqId: string;
    let alqViejaId: string;
    let activoId: string;
    let otherCompanyId: string;
    let otherAccountId: string;

    const readCategory = (id: string) =>
      prisma.expenseCategory.findUniqueOrThrow({
        where: { id },
        select: { name: true, description: true, accountId: true, isActive: true },
      });

    beforeAll(async () => {
      const mk = (code: string, name: string, type: 'EXPENSE' | 'ASSET') =>
        prisma.account.create({
          data: { companyId, code, name: `${PREFIX}${name}`, type, nature: 'DEBIT' },
          select: { id: true },
        });
      const [alq, alqVieja, activo] = await Promise.all([
        mk('T757-ALQ', 'Alquileres', 'EXPENSE'),
        mk('T757-ALQ-VIEJA', 'Alquileres vieja', 'EXPENSE'),
        mk('T757-ACTIVO', 'Anticipos', 'ASSET'),
      ]);
      alqId = alq.id;
      alqViejaId = alqVieja.id;
      activoId = activo.id;

      const other = await prisma.company.create({
        data: { name: `${PREFIX}Otra`, isActive: true },
        select: { id: true },
      });
      otherCompanyId = other.id;
      const otherAccount = await prisma.account.create({
        data: {
          companyId: otherCompanyId,
          code: 'T757-OTRA',
          name: `${PREFIX}Gastos otra empresa`,
          type: 'EXPENSE',
          nature: 'DEBIT',
        },
        select: { id: true },
      });
      otherAccountId = otherAccount.id;
    });

    afterAll(async () => {
      // Guarda: sin `otherCompanyId` Prisma omite el filtro y borraría tablas enteras.
      if (otherCompanyId) {
        await prisma.expenseCategory.deleteMany({ where: { companyId: otherCompanyId } });
        await prisma.account.deleteMany({ where: { companyId: otherCompanyId } });
        await prisma.company.deleteMany({ where: { id: otherCompanyId } });
      }
    });

    it('C1: crear con cuenta propia → { success, id } y la cuenta queda guardada', async () => {
      const result = await createExpenseCategory({
        name: `${PREFIX}Alquiler`,
        description: 'Alquiler de oficina',
        accountId: alqId,
      });
      expect(result.success).toBe(true);
      if (!result.success) return;
      expect((await readCategory(result.id)).accountId).toBe(alqId);

      const sinCuenta = await createExpenseCategory({ name: `${PREFIX}Sin cuenta` });
      expect(sinCuenta.success).toBe(true);
      if (!sinCuenta.success) return;
      expect((await readCategory(sinCuenta.id)).accountId).toBeNull();
    });

    it('C2: cuenta de otra empresa → error de negocio y no se crea', async () => {
      const name = `${PREFIX}Ajena`;
      const result = await createExpenseCategory({ name, accountId: otherAccountId });
      expect(result).toEqual({
        success: false,
        error: 'La cuenta contable seleccionada no pertenece a la empresa',
      });
      expect(await prisma.expenseCategory.count({ where: { companyId, name } })).toBe(0);
    });

    it('C3: nombre duplicado → "Ya existe una categoría con ese nombre" (alta y edición)', async () => {
      const name = `${PREFIX}Duplicada`;
      const first = await createExpenseCategory({ name });
      expect(first.success).toBe(true);

      expect(await createExpenseCategory({ name })).toEqual({
        success: false,
        error: 'Ya existe una categoría con ese nombre',
      });

      const other = await createExpenseCategory({ name: `${PREFIX}Otra duplicada` });
      if (!other.success) throw new Error(other.error);
      expect(await updateExpenseCategory(other.id, { name })).toEqual({
        success: false,
        error: 'Ya existe una categoría con ese nombre',
      });
    });

    it('C4: update con accountId null vuelve a "por defecto"; sin accountId no lo toca', async () => {
      const created = await createExpenseCategory({ name: `${PREFIX}Editable`, accountId: alqId });
      if (!created.success) throw new Error(created.error);

      const untouched = await updateExpenseCategory(created.id, {
        name: `${PREFIX}Editable 2`,
        description: 'nueva',
      });
      expect(untouched).toEqual({ success: true });
      expect(await readCategory(created.id)).toMatchObject({
        name: `${PREFIX}Editable 2`,
        description: 'nueva',
        accountId: alqId,
      });

      expect(
        await updateExpenseCategory(created.id, { name: `${PREFIX}Editable 2`, accountId: null })
      ).toEqual({ success: true });
      expect((await readCategory(created.id)).accountId).toBeNull();

      expect(
        await updateExpenseCategory(created.id, {
          name: `${PREFIX}Editable 2`,
          accountId: otherAccountId,
        })
      ).toEqual({
        success: false,
        error: 'La cuenta contable seleccionada no pertenece a la empresa',
      });
      expect((await readCategory(created.id)).accountId).toBeNull();
    });

    it('C5: toggle devuelve el estado nuevo; id inexistente → "Categoría no encontrada"', async () => {
      const created = await createExpenseCategory({ name: `${PREFIX}Toggle` });
      if (!created.success) throw new Error(created.error);

      expect(await toggleExpenseCategory(created.id)).toEqual({ success: true, isActive: false });
      expect((await readCategory(created.id)).isActive).toBe(false);
      expect(await toggleExpenseCategory(created.id)).toEqual({ success: true, isActive: true });

      const missingId = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
      expect(await toggleExpenseCategory(missingId)).toEqual({
        success: false,
        error: 'Categoría no encontrada',
      });
      expect(await updateExpenseCategory(missingId, { name: `${PREFIX}Nada` })).toEqual({
        success: false,
        error: 'Categoría no encontrada',
      });
    });

    it('C6: el combo ofrece EXPENSE imputables + la guardada inactiva; sin ASSET ni otra empresa', async () => {
      await prisma.account.update({ where: { id: alqViejaId }, data: { isActive: false } });
      try {
        const withoutSaved = (await getExpenseCategoryAccounts()).map((a) => a.id);
        expect(withoutSaved).toContain(alqId);
        expect(withoutSaved).not.toContain(alqViejaId);

        const withSaved = (await getExpenseCategoryAccounts([alqViejaId])).map((a) => a.id);
        expect(withSaved).toContain(alqId);
        expect(withSaved).toContain(alqViejaId);
        expect(withSaved).not.toContain(activoId);
        expect(withSaved).not.toContain(otherAccountId);

        // includeIds de otra empresa no se cuela.
        const foreign = (await getExpenseCategoryAccounts([otherAccountId])).map((a) => a.id);
        expect(foreign).not.toContain(otherAccountId);
      } finally {
        await prisma.account.update({ where: { id: alqViejaId }, data: { isActive: true } });
      }
    });

    /** Categoría del test (prefijo para la limpieza) por la action real. */
    async function createCategory(name: string, accountId: string | null) {
      const result = await createExpenseCategory({ name: `${PREFIX}${name}`, accountId });
      if (!result.success) throw new Error(result.error);
      return result.id;
    }

    function debitLine(lines: JournalLineRow[]) {
      const debits = lines.filter((l) => l.debit > 0);
      expect(debits).toHaveLength(1);
      return debits[0];
    }

    it('caso 8: categoría con cuenta y SIN cuenta por defecto → confirma; Debe la de la categoría', async () => {
      const catId = await createCategory('Con cuenta sin default', alqId);
      const id = await createDraft('Categoría con cuenta sin default', catId);
      await setSettings({ expensesAccountId: null });
      try {
        const result = await confirmExpense(id);
        expect(result).toMatchObject({ success: true });

        expect((await readExpense(id)).status).toBe('CONFIRMED');
        const lines = await fetchEntryLines(id);
        expect(lines).toHaveLength(2);
        expect(debitLine(lines)).toMatchObject({ accountId: alqId, debit: 1000, credit: 0 });
        const pagar = lines.find((l) => l.accountId === pagarId);
        expect(pagar?.credit).toBe(1000);
        expect(pagar?.supplierId).toBe(supplierId);
      } finally {
        await setSettings({ expensesAccountId: gastosId });
      }
    });

    it('caso 9: categoría con cuenta y con cuenta por defecto → el Debe va a la de la categoría', async () => {
      const catId = await createCategory('Con cuenta y default', alqId);
      const id = await createDraft('Categoría con cuenta y default', catId);

      const result = await confirmExpense(id);
      expect(result.success).toBe(true);
      if (!result.success) return;
      // El presupuesto del caso 5 está sobre la cuenta por defecto: no aplica a este egreso.
      expect(result.budgetWarning).toBeUndefined();

      const lines = await fetchEntryLines(id);
      expect(debitLine(lines).accountId).toBe(alqId);
      expect(lines.some((l) => l.accountId === gastosId)).toBe(false);
    });

    it('caso 10: cuenta de la categoría inactiva → bloqueado nombrando categoría y cuenta; no cae a la por defecto', async () => {
      const catId = await createCategory('Cuenta inactiva', alqViejaId);
      const id = await createDraft('Categoría con cuenta inactiva', catId);
      await prisma.account.update({ where: { id: alqViejaId }, data: { isActive: false } });
      try {
        const result = await confirmExpense(id);
        expect(result.success).toBe(false);
        if (result.success) return;
        expect(result.error).toContain('No se puede confirmar el gasto GTO-');
        expect(result.error).toContain(`la cuenta T757-ALQ-VIEJA - ${PREFIX}Alquileres vieja`);
        expect(result.error).toContain(`de la categoría "${PREFIX}Cuenta inactiva"`);
        expect(result.error).toContain('no está activa o no es imputable');
        expect(result.error).toContain('Corregila en Comercial → Egresos → Categorías.');

        const expense = await readExpense(id);
        expect(expense.status).toBe('DRAFT');
        expect(expense.journalEntryId).toBeNull();
      } finally {
        await prisma.account.update({ where: { id: alqViejaId }, data: { isActive: true } });
      }
    });

    it('caso 11: categoría sin cuenta y sin cuenta por defecto → mensaje con las dos formas de resolverlo', async () => {
      const catId = await createCategory('Sin cuenta ni default', null);
      const id = await createDraft('Sin cuenta ni default', catId);
      await setSettings({ expensesAccountId: null });
      try {
        const result = await confirmExpense(id);
        expect(result.success).toBe(false);
        if (result.success) return;
        expect(result.error).toBe(
          `No se puede confirmar el gasto ${(await readExpense(id)).fullNumber}: falta configurar ` +
            '"Cuenta de egresos por defecto" en Contabilidad → Configuración, o asignale una ' +
            `cuenta contable a la categoría "${PREFIX}Sin cuenta ni default" en Comercial → Egresos → Categorías.`
        );
        const expense = await readExpense(id);
        expect(expense.status).toBe('DRAFT');
        expect(expense.journalEntryId).toBeNull();
      } finally {
        await setSettings({ expensesAccountId: gastosId });
      }
    });

    it('caso 12: el presupuesto se mide sobre la cuenta resuelta (categoría o por defecto)', async () => {
      const catId = await createCategory('Presupuesto', alqId);

      // Sin presupuesto en T757-ALQ: el de la cuenta por defecto (caso 5) no aplica.
      const sinPresupuesto = await confirmExpense(await createDraft('Presupuesto sin', catId));
      expect(sinPresupuesto.success).toBe(true);
      if (!sinPresupuesto.success) return;
      expect(sinPresupuesto.budgetWarning).toBeUndefined();

      // La categoría sin cuenta sigue avisando por el presupuesto de la por defecto.
      const porDefecto = await confirmExpense(await createDraft('Presupuesto por defecto'));
      expect(porDefecto.success).toBe(true);
      if (!porDefecto.success) return;
      expect(porDefecto.budgetWarning).toBeDefined();

      const monthlyAmounts = Array.from({ length: 12 }, () => 0);
      monthlyAmounts[2] = 1000; // marzo
      await prisma.budget.create({
        data: {
          companyId,
          accountId: alqId,
          fiscalYear: 2026,
          status: 'ACTIVE',
          monthlyAmounts,
          totalAmount: 1000,
          createdBy: 'test',
        },
      });

      const id = await createDraft('Presupuesto con', catId);
      const conPresupuesto = await confirmExpense(id);
      expect(conPresupuesto.success).toBe(true);
      if (!conPresupuesto.success) return;
      expect(conPresupuesto.budgetWarning).toBeDefined();
      expect(conPresupuesto.budgetWarning?.message).toContain('presupuesto mensual');
      // No bloqueante: confirmado y con asiento sobre la cuenta de la categoría.
      expect((await readExpense(id)).status).toBe('CONFIRMED');
      expect(debitLine(await fetchEntryLines(id)).accountId).toBe(alqId);
    });

    it('caso 13: se borra la cuenta de la categoría → SET NULL y el egreso usa la por defecto', async () => {
      const temp = await prisma.account.create({
        data: {
          companyId,
          code: 'T757-TEMP',
          name: `${PREFIX}Cuenta temporal`,
          type: 'EXPENSE',
          nature: 'DEBIT',
        },
        select: { id: true },
      });
      const catId = await createCategory('Cuenta borrada', temp.id);
      const id = await createDraft('Cuenta de categoría borrada', catId);

      await prisma.account.delete({ where: { id: temp.id } });
      expect((await readCategory(catId)).accountId).toBeNull();

      const result = await confirmExpense(id);
      expect(result.success).toBe(true);
      expect(debitLine(await fetchEntryLines(id)).accountId).toBe(gastosId);
    });

    it('D1: el detalle muestra la cuenta del Debe: prevista en borrador, la del asiento si está confirmado', async () => {
      const alqLabel = `T757-ALQ - ${PREFIX}Alquileres`;
      const gastosLabel = `T728G-GASTOS - ${PREFIX}Gastos Operativos`;
      const conCuenta = await createDraft('Detalle con cuenta', await createCategory('Detalle', alqId));
      const sinCuenta = await createDraft('Detalle sin cuenta');

      // Borrador: categoría con cuenta → "de la categoría"; sin cuenta → la por defecto
      const draftCat = await getExpenseById(conCuenta);
      expect(draftCat.debitAccount).toEqual({ origin: 'category', label: alqLabel });
      expect(draftCat.journalEntryNumber).toBeNull();
      expect(draftCat).not.toHaveProperty('journalEntry');
      expect((await getExpenseById(sinCuenta)).debitAccount).toEqual({
        origin: 'default',
        label: gastosLabel,
      });

      // Borrador sin cuenta en la categoría ni por defecto → 'missing'
      await setSettings({ expensesAccountId: null });
      try {
        expect((await getExpenseById(sinCuenta)).debitAccount).toEqual({
          origin: 'missing',
          label: null,
        });
      } finally {
        await setSettings({ expensesAccountId: gastosId });
      }

      // Confirmado: la cuenta del Debe del asiento, aunque después cambie la de la categoría
      expect((await confirmExpense(conCuenta)).success).toBe(true);
      await prisma.expenseCategory.updateMany({
        where: { companyId, name: `${PREFIX}Detalle` },
        data: { accountId: null },
      });
      const confirmed = await getExpenseById(conCuenta);
      expect(confirmed.debitAccount).toEqual({ origin: 'entry', label: alqLabel });
      const entry = await prisma.journalEntry.findUniqueOrThrow({
        where: { id: (await readExpense(conCuenta)).journalEntryId ?? '' },
        select: { number: true },
      });
      expect(confirmed.journalEntryNumber).toBe(entry.number);
    });
  });
});
