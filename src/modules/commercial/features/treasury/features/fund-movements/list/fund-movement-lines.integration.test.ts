/**
 * Tests de integración de los conceptos del movimiento de fondos (TSK-585,
 * Tarea 6 del plan de implementación) contra la base real de desarrollo.
 *
 * Sigue el molde de
 * `src/modules/accounting/features/integrations/commercial/cost-center.integration.test.ts`:
 * el `describe.skipIf` cuando no hay base, el prefijo `TSK585-TEST-` en todo
 * lo que se crea, y la limpieza + verificación en el `afterAll`.
 *
 * Alcance: NO se re-testean las funciones puras de `../shared/lines-calc.ts`
 * (`sumLines`, `validateLines`) ni las de `../shared/validators.ts`
 * (`parseFundMovementDate`, el `superRefine` de `fundMovementSchema`) — ya
 * tienen tests unitarios en `lines-calc.test.ts` y `validators.test.ts`. Acá
 * se ejercita la cadena real contra la base.
 *
 * CÓDIGO REAL DE PRODUCCIÓN, NO UNA RÉPLICA
 * ------------------------------------------
 * Este archivo invoca `createFundMovement` (con `confirm: true`, que
 * internamente llama a la `confirmFundMovement` real) y `getFundMovementById`
 * -las funciones reales de `../list/actions.server.ts`, sin ninguna copia- y
 * verifica lo que efectivamente queda grabado en la base. Solo se aísla la
 * FRONTERA de autenticación/framework, nunca la lógica de dominio:
 *
 *   - `checkPermission` (`@/shared/lib/permissions`): decide si el usuario
 *     puede hacer la operación; no es lógica del ticket.
 *   - `getCurrentUserId` (`@/shared/lib/current-user`): depende de la sesión
 *     de Clerk vía `next/headers`, que no existe fuera de un request de
 *     Next.
 *   - `getActiveCompanyId` (`@/shared/lib/company`): depende a su vez de
 *     `getCurrentUserId`.
 *   - `revalidatePath` (`next/cache`): invalidación de caché de Next: no
 *     tiene efecto ni sentido fuera de un request, y sin mockearlo explota
 *     (no hay "static generation store" bajo Vitest).
 *
 * Los cuatro `vi.mock(...)` de más abajo reemplazan ÚNICAMENTE esos cuatro
 * módulos. Todo lo demás -el cálculo del total, el armado de las líneas del
 * asiento por tipo de movimiento, la verificación de partida doble, la
 * persistencia del movimiento y del asiento, la lectura ordenada de los
 * conceptos- es el código real, sin duplicar ni una línea. Si alguien rompe
 * `createJournalEntryForFundMovement`, el armado de líneas de
 * `confirmFundMovement`, `buildLinesData` o `resolveMovementAmount`, estos
 * tests se rompen con él: no hay una copia propia que pueda quedarse
 * desactualizada y seguir en verde.
 *
 * (Versión anterior de este archivo: como la firma de `confirmFundMovement`
 * son server actions de un módulo `'use server'`, se asumió que no podían
 * ejecutarse fuera de un request de Next y se optó por replicar su
 * secuencia. Esa premisa era incorrecta: `'use server'` es una anotación
 * para el bundler de Next -decide qué queda expuesto como endpoint-, no
 * una restricción de Node/Vitest sobre cómo se puede importar el módulo. Lo
 * que sí impide ejecutar el código tal cual es la frontera de sesión y
 * framework de arriba, y esa es aislable con `vi.mock`.)
 *
 * No se ejercita `applyFundSide` en el sentido de comprobar el `balance` del
 * banco resultante (aunque sí se ejecuta de verdad como parte de
 * `confirmFundMovement`, y por eso el `beforeAll` siembra bancos con saldo
 * y cuenta contable reales): verificar saldos está fuera del alcance de los
 * 4 casos pedidos, que son sobre el asiento contable y la persistencia de
 * los conceptos.
 *
 * Aislamiento de datos: todo lo que este archivo crea usa el prefijo
 * `TSK585-TEST-` (empresa, cuentas, bancos, descripciones de movimientos y
 * asientos). El `afterAll` borra todo en orden inverso de dependencias y
 * verifica que no sobrevive ninguna fila con el prefijo.
 */
import 'dotenv/config';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { prisma } from '@/shared/lib/prisma';

import { sumLines } from '../shared/lines-calc';
import type { FundMovementFormInput } from '../shared/validators';

// Frontera aislada: sesión/permisos/empresa activa/caché de Next. Ver el
// comentario de arriba para el porqué de cada uno.
vi.mock('@/shared/lib/current-user', () => ({ getCurrentUserId: vi.fn() }));
vi.mock('@/shared/lib/company', () => ({ getActiveCompanyId: vi.fn() }));
vi.mock('@/shared/lib/permissions', () => ({ checkPermission: vi.fn().mockResolvedValue(undefined) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { getActiveCompanyId } from '@/shared/lib/company';
import { getCurrentUserId } from '@/shared/lib/current-user';
// Código real de producción: nada de esto se reimplementa acá.
import { createFundMovement, getFundMovementById } from './actions.server';

const PREFIX = 'TSK585-TEST-';

// ============================================
// Chequeo de disponibilidad de la base
// ============================================
//
// Igual que en `cost-center.integration.test.ts`: lo que puede faltar es que
// Docker esté levantado, así que el chequeo real es una consulta, no la sola
// presencia de `DATABASE_URL`.
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
}

async function fetchEntryLinesForMovement(movementId: string): Promise<JournalLineRow[]> {
  const movement = await prisma.fundMovement.findUniqueOrThrow({
    where: { id: movementId },
    select: { journalEntryId: true },
  });
  if (!movement.journalEntryId) throw new Error('El movimiento no tiene asiento generado');

  const rows = await prisma.journalEntryLine.findMany({
    where: { entryId: movement.journalEntryId },
    select: { accountId: true, debit: true, credit: true },
  });
  return rows.map((r) => ({ accountId: r.accountId, debit: Number(r.debit), credit: Number(r.credit) }));
}

describe.skipIf(!dbAvailable)('integración: conceptos del movimiento de fondos (TSK-585)', () => {
  // Andamiaje común a los 4 casos, creado una vez en el beforeAll de este describe.
  let companyId: string;

  let bankLedgerAccountId: string; // cuenta contable del banco de origen
  let destLedgerAccountId: string; // cuenta contable del banco de destino
  let capitalAccountId: string; // aportes de socios (patrimonio)
  let commissionAccountId: string; // concepto: comisión bancaria (egreso)
  let sircrebAccountId: string; // concepto: percepción Sircreb (activo, a computar)

  let bankSourceId: string; // BankAccount de origen (retiro/gasto/transferencia)
  let bankDestId: string; // BankAccount de destino (aporte/transferencia)

  beforeAll(async () => {
    const company = await prisma.company.create({ data: { name: `${PREFIX}Empresa`, isActive: true } });
    companyId = company.id;

    const [bankLedger, destLedger, capital, commission, sircreb] = await Promise.all([
      prisma.account.create({
        data: { companyId, code: 'T585-BANCO1', name: `${PREFIX}Banco Origen`, type: 'ASSET', nature: 'DEBIT' },
      }),
      prisma.account.create({
        data: { companyId, code: 'T585-BANCO2', name: `${PREFIX}Banco Destino`, type: 'ASSET', nature: 'DEBIT' },
      }),
      prisma.account.create({
        data: { companyId, code: 'T585-CAPITAL', name: `${PREFIX}Aportes de Socios`, type: 'EQUITY', nature: 'CREDIT' },
      }),
      prisma.account.create({
        data: { companyId, code: 'T585-COMISION', name: `${PREFIX}Comisiones Bancarias`, type: 'EXPENSE', nature: 'DEBIT' },
      }),
      prisma.account.create({
        data: { companyId, code: 'T585-SIRCREB', name: `${PREFIX}Percepcion Sircreb`, type: 'ASSET', nature: 'DEBIT' },
      }),
    ]);
    bankLedgerAccountId = bankLedger.id;
    destLedgerAccountId = destLedger.id;
    capitalAccountId = capital.id;
    commissionAccountId = commission.id;
    sircrebAccountId = sircreb.id;

    const [bankSource, bankDest] = await Promise.all([
      prisma.bankAccount.create({
        data: {
          companyId,
          bankName: `${PREFIX}Banco Origen`,
          accountNumber: 'T585-9001',
          accountType: 'CHECKING',
          balance: 10000000,
          status: 'ACTIVE',
          accountId: bankLedgerAccountId,
        },
      }),
      prisma.bankAccount.create({
        data: {
          companyId,
          bankName: `${PREFIX}Banco Destino`,
          accountNumber: 'T585-9002',
          accountType: 'CHECKING',
          balance: 0,
          status: 'ACTIVE',
          accountId: destLedgerAccountId,
        },
      }),
    ]);
    bankSourceId = bankSource.id;
    bankDestId = bankDest.id;

    await prisma.accountingSettings.create({
      data: {
        companyId,
        fiscalYearStart: new Date('2026-01-01'),
        fiscalYearEnd: new Date('2026-12-31'),
        lastEntryNumber: 0,
        partnerContributionsAccountId: capitalAccountId,
      },
    });

    // Único punto donde se aísla la frontera: la empresa activa y el usuario
    // son los de este test, no una sesión real.
    vi.mocked(getActiveCompanyId).mockResolvedValue(companyId);
    vi.mocked(getCurrentUserId).mockResolvedValue(`${PREFIX}user`);
  });

  afterAll(async () => {
    // Orden inverso de dependencias: primero los movimientos (cascadean sus
    // conceptos) y los asientos (cascadean sus líneas) -las líneas de ambos
    // tienen FK RESTRICT hacia `accounts`-, después los bancos (cascadean
    // sus `bank_movements`) y la configuración, después las cuentas, después
    // la empresa.
    await prisma.fundMovement.deleteMany({ where: { companyId } });
    await prisma.journalEntry.deleteMany({ where: { companyId } });
    await prisma.bankAccount.deleteMany({ where: { companyId } });
    await prisma.accountingSettings.deleteMany({ where: { companyId } });
    await prisma.account.deleteMany({ where: { companyId } });
    await prisma.company.deleteMany({ where: { id: companyId } });

    // Verificación de que no sobrevive ninguna fila de la corrida.
    const [remainingMovements, remainingAccounts, remainingCompanies] = await Promise.all([
      prisma.fundMovement.count({ where: { description: { startsWith: PREFIX } } }),
      prisma.account.count({ where: { name: { startsWith: PREFIX } } }),
      prisma.company.count({ where: { name: { startsWith: PREFIX } } }),
    ]);
    expect(remainingMovements).toBe(0);
    expect(remainingAccounts).toBe(0);
    expect(remainingCompanies).toBe(0);

    await prisma.$disconnect();
  });

  describe('caso 1: el asiento de gastos bancarios tiene N+1 líneas y balancea', () => {
    // `createFundMovement(input, true)` real: crea el borrador y lo confirma
    // en la misma llamada. Los importes son los del ticket: dos conceptos de
    // $302.574,16 y $1.434.154,28.
    let lines: JournalLineRow[];

    beforeAll(async () => {
      const formInput: FundMovementFormInput = {
        type: 'BANK_CHARGES',
        date: '2026-01-15',
        description: `${PREFIX}Gastos e impuestos bancarios de enero`,
        sourceFund: `BANK:${bankSourceId}`,
        destinationFund: '',
        partnerId: '',
        lines: [
          { accountId: commissionAccountId, description: `${PREFIX}Comision de mantenimiento`, amount: '302574.16' },
          { accountId: sircrebAccountId, description: `${PREFIX}Percepcion Sircreb`, amount: '1434154.28' },
        ],
      };

      const result = await createFundMovement(formInput, true);
      expect(result.success).toBe(true);
      if (!result.success) throw new Error(result.error);

      lines = await fetchEntryLinesForMovement(result.id!);
    });

    it('genera N+1 líneas: un débito por cada uno de los 2 conceptos y un crédito al banco', () => {
      expect(lines).toHaveLength(3);
    });

    it('cada concepto queda debitado en su propia cuenta por su importe exacto', () => {
      const comision = lines.find((l) => l.accountId === commissionAccountId);
      const sircreb = lines.find((l) => l.accountId === sircrebAccountId);
      expect(comision).toMatchObject({ debit: 302574.16, credit: 0 });
      expect(sircreb).toMatchObject({ debit: 1434154.28, credit: 0 });
    });

    it('el crédito al banco es el total de los conceptos, $1.736.728,44', () => {
      const banco = lines.find((l) => l.accountId === bankLedgerAccountId);
      expect(banco).toMatchObject({ debit: 0, credit: 1736728.44 });
    });

    it('el asiento balancea: la suma de débitos es igual a la suma de créditos', () => {
      const totalDebit = lines.reduce((sum, l) => sum + l.debit, 0);
      const totalCredit = lines.reduce((sum, l) => sum + l.credit, 0);
      expect(totalDebit).toBe(totalCredit);
      expect(totalDebit).toBe(1736728.44);
    });
  });

  describe('caso 2: regresión de los tipos existentes (riesgo principal de esta entrega)', () => {
    // Antes de esta entrega, `createJournalEntryForFundMovement` armaba
    // siempre dos líneas (un débito y un crédito) internamente. Ahora las
    // arma cada llamador y se las pasa ya construidas. Los tres tipos que ya
    // estaban en producción antes de TSK-585 -aporte, retiro y
    // transferencia- tienen que seguir generando exactamente dos líneas, con
    // las mismas cuentas que antes del cambio. Cada sub-caso llama a
    // `createFundMovement(input, true)` real (crea + confirma) y lee el
    // asiento que quedó en la base.

    describe('aporte de socio', () => {
      let lines: JournalLineRow[];
      const amount = 50000;

      beforeAll(async () => {
        const result = await createFundMovement(
          {
            type: 'PARTNER_CONTRIBUTION',
            date: '2026-01-20',
            amount: String(amount),
            description: `${PREFIX}Aporte de socio fundador`,
            sourceFund: '',
            destinationFund: `BANK:${bankDestId}`,
            partnerId: '',
          },
          true
        );
        expect(result.success).toBe(true);
        if (!result.success) throw new Error(result.error);

        lines = await fetchEntryLinesForMovement(result.id!);
      });

      it('genera exactamente dos líneas', () => {
        expect(lines).toHaveLength(2);
      });

      it('debita el banco destino y acredita la cuenta de aportes de socios, por el total', () => {
        const banco = lines.find((l) => l.accountId === destLedgerAccountId);
        const capital = lines.find((l) => l.accountId === capitalAccountId);
        expect(banco).toMatchObject({ debit: amount, credit: 0 });
        expect(capital).toMatchObject({ debit: 0, credit: amount });
      });
    });

    describe('retiro de socio', () => {
      let lines: JournalLineRow[];
      const amount = 15000;

      beforeAll(async () => {
        const result = await createFundMovement(
          {
            type: 'PARTNER_WITHDRAWAL',
            date: '2026-01-21',
            amount: String(amount),
            description: `${PREFIX}Retiro de socio fundador`,
            sourceFund: `BANK:${bankSourceId}`,
            destinationFund: '',
            partnerId: '',
          },
          true
        );
        expect(result.success).toBe(true);
        if (!result.success) throw new Error(result.error);

        lines = await fetchEntryLinesForMovement(result.id!);
      });

      it('genera exactamente dos líneas', () => {
        expect(lines).toHaveLength(2);
      });

      it('debita la cuenta de aportes de socios y acredita el banco origen, por el total', () => {
        const capital = lines.find((l) => l.accountId === capitalAccountId);
        const banco = lines.find((l) => l.accountId === bankLedgerAccountId);
        expect(capital).toMatchObject({ debit: amount, credit: 0 });
        expect(banco).toMatchObject({ debit: 0, credit: amount });
      });
    });

    describe('transferencia entre cuentas', () => {
      let lines: JournalLineRow[];
      const amount = 25000;

      beforeAll(async () => {
        const result = await createFundMovement(
          {
            type: 'ACCOUNT_TRANSFER',
            date: '2026-01-22',
            amount: String(amount),
            description: `${PREFIX}Transferencia entre bancos`,
            sourceFund: `BANK:${bankSourceId}`,
            destinationFund: `BANK:${bankDestId}`,
            partnerId: '',
          },
          true
        );
        expect(result.success).toBe(true);
        if (!result.success) throw new Error(result.error);

        lines = await fetchEntryLinesForMovement(result.id!);
      });

      it('genera exactamente dos líneas', () => {
        expect(lines).toHaveLength(2);
      });

      it('debita el banco destino y acredita el banco origen, por el total transferido', () => {
        const destino = lines.find((l) => l.accountId === destLedgerAccountId);
        const origen = lines.find((l) => l.accountId === bankLedgerAccountId);
        expect(destino).toMatchObject({ debit: amount, credit: 0 });
        expect(origen).toMatchObject({ debit: 0, credit: amount });
      });
    });
  });

  describe('caso 3: el total se calcula en el servidor, no lo que manda el cliente', () => {
    // `createFundMovement` real, con un `amount` deliberadamente distinto de
    // la suma de las líneas. `sumLines` (función real, importada) se usa acá
    // solo como oráculo independiente para calcular el total esperado; el
    // valor que se compara es el que devuelve `getFundMovementById` real.
    let storedAmount: number;
    const sentAmount = '999999.99'; // deliberadamente distinto de la suma de las líneas
    const conceptos = [
      { accountId: '', description: 'Comision', amount: '100.50' },
      { accountId: '', description: 'Sircreb', amount: '50.25' },
    ];

    beforeAll(async () => {
      conceptos[0].accountId = commissionAccountId;
      conceptos[1].accountId = sircrebAccountId;

      const result = await createFundMovement({
        type: 'BANK_CHARGES',
        date: '2026-02-01',
        amount: sentAmount,
        description: `${PREFIX}Gastos con monto simulado incorrecto`,
        sourceFund: `BANK:${bankSourceId}`,
        destinationFund: '',
        partnerId: '',
        lines: conceptos,
      });
      expect(result.success).toBe(true);
      if (!result.success) throw new Error(result.error);

      const found = await getFundMovementById(result.id!);
      storedAmount = found!.amount;
    });

    it('guarda la suma de los conceptos, no el monto enviado por el cliente', () => {
      const sumaEsperada = sumLines(conceptos);
      expect(sumaEsperada).toBe(150.75);
      expect(storedAmount).toBe(sumaEsperada);
      expect(storedAmount).not.toBe(parseFloat(sentAmount));
    });
  });

  describe('caso 4: el borrador guarda y relee sus conceptos, con su orden', () => {
    // `createFundMovement` (borrador, sin confirmar) + `getFundMovementById`
    // reales: los tres conceptos se cargan en un orden con sentido -no
    // alfabético, para que no coincida por casualidad con un posible orden
    // por descripción- y se verifica que la relectura respeta ese orden.
    let releidas: { description: string; accountId: string; amount: number }[];

    beforeAll(async () => {
      const result = await createFundMovement({
        type: 'BANK_CHARGES',
        date: '2026-02-10',
        description: `${PREFIX}Borrador con tres conceptos`,
        sourceFund: `BANK:${bankSourceId}`,
        destinationFund: '',
        partnerId: '',
        lines: [
          { accountId: commissionAccountId, description: `${PREFIX}Comision mantenimiento`, amount: '850.30' },
          { accountId: commissionAccountId, description: `${PREFIX}IVA sobre comision`, amount: '178.56' },
          { accountId: sircrebAccountId, description: `${PREFIX}Percepcion Sircreb`, amount: '1200.00' },
        ],
      });
      expect(result.success).toBe(true);
      if (!result.success) throw new Error(result.error);

      const found = await getFundMovementById(result.id!);
      releidas = found!.lines.map((l) => ({ description: l.description, accountId: l.accountId, amount: l.amount }));
    });

    it('relee los tres conceptos', () => {
      expect(releidas).toHaveLength(3);
    });

    it('los relee en el mismo orden en que se cargaron', () => {
      expect(releidas.map((l) => l.description)).toEqual([
        `${PREFIX}Comision mantenimiento`,
        `${PREFIX}IVA sobre comision`,
        `${PREFIX}Percepcion Sircreb`,
      ]);
    });

    it('conserva la cuenta y el importe de cada concepto', () => {
      expect(releidas[0]).toMatchObject({ accountId: commissionAccountId, amount: 850.3 });
      expect(releidas[1]).toMatchObject({ accountId: commissionAccountId, amount: 178.56 });
      expect(releidas[2]).toMatchObject({ accountId: sircrebAccountId, amount: 1200 });
    });
  });
});
