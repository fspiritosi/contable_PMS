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
 * se ejercita la cadena real contra la base: el asiento que efectivamente
 * queda grabado, y que el total y los conceptos de un movimiento se
 * persistan y relean correctamente.
 *
 * LIMITACIÓN CONOCIDA (documentada también en el reporte de la Tarea 6):
 * los server actions de `../list/actions.server.ts` (`createFundMovement`,
 * `confirmFundMovement`, etc.) no se pueden invocar desde un test de Vitest:
 * usan `checkPermission` y `getCurrentUserId`, que dependen de `next/headers`
 * (sesión/request de Next) y explotan fuera de ese contexto. Y la función
 * genérica que arma el asiento, `createJournalEntryForFundMovement` -la que
 * esta entrega generalizó para que reciba las líneas ya armadas en vez de
 * construir siempre dos-, tampoco se puede importar: vive en ese mismo
 * archivo `'use server'` y no está exportada (ni podría estarlo sin volverse
 * candidata a Server Action, con un parámetro -el cliente de transacción-
 * que no es serializable).
 *
 * Por eso este archivo REPLICA, a propósito y línea por línea, la secuencia
 * real de `confirmFundMovement` y de `createJournalEntryForFundMovement`
 * (ver `persistJournalEntry` y el comentario de cada `describe`), en vez de
 * invocarlas. Qué protege: que esa secuencia, ejecutada contra la base real,
 * arma y persiste exactamente las líneas que describe el ticket -incluida
 * la regresión de los tres tipos que ya estaban en producción-. Qué NO
 * protege: que `confirmFundMovement` siga llamando a esta secuencia tal
 * cual; si alguien cambia `createJournalEntryForFundMovement` o el armado de
 * líneas por tipo sin tocar este archivo, el cambio puede pasar
 * desapercibido para estos tests. Es la misma limitación -y la misma
 * solución- que ya adoptó `cost-center.integration.test.ts` para su caso 5.
 *
 * No se ejercita `applyFundSide` (actualización de saldos de banco/caja):
 * no está exportada, y está fuera del alcance de los 4 casos pedidos, que
 * son sobre el asiento contable y la persistencia de los conceptos, no
 * sobre el movimiento de saldos.
 *
 * Aislamiento de datos: todo lo que este archivo crea usa el prefijo
 * `TSK585-TEST-` (empresa, cuentas, bancos, descripciones de movimientos y
 * asientos). El `afterAll` borra todo en orden inverso de dependencias y
 * verifica que no sobrevive ninguna fila con el prefijo.
 */
import 'dotenv/config';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { Prisma } from '@/generated/prisma/client';
import { prisma } from '@/shared/lib/prisma';

import { sumLines } from '../shared/lines-calc';
import { fundMovementSchema, type FundMovementFormInput } from '../shared/validators';

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

// Cliente de transacción de Prisma (mismo tipo que define
// `../list/actions.server.ts`; no se puede importar de ahí sin volverlo un
// export de un archivo `'use server'`).
type PrismaTransactionClient = Omit<
  typeof prisma,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

/** Una línea del asiento, con la misma forma que arma cada tipo de movimiento. */
interface JournalLineInput {
  accountId: string;
  debit: number;
  credit: number;
  description: string;
}

interface JournalLineRow {
  accountId: string;
  debit: number;
  credit: number;
}

/**
 * Réplica de `createJournalEntryForFundMovement`
 * (`../list/actions.server.ts`): verifica la partida doble y persiste el
 * asiento con las líneas que le pasa el llamador, incrementando
 * `lastEntryNumber`. Mismo comportamiento, mismo orden de operaciones.
 */
async function persistJournalEntry(
  tx: PrismaTransactionClient,
  params: { companyId: string; date: Date; description: string; lines: JournalLineInput[] }
): Promise<{ id: string; number: number }> {
  const { companyId, date, description, lines } = params;

  const totalDebe = lines.reduce((t, l) => t.add(new Prisma.Decimal(l.debit)), new Prisma.Decimal(0));
  const totalHaber = lines.reduce((t, l) => t.add(new Prisma.Decimal(l.credit)), new Prisma.Decimal(0));
  if (!totalDebe.equals(totalHaber)) {
    throw new Error(
      `Asiento desbalanceado en el test: debe ${totalDebe.toString()} vs haber ${totalHaber.toString()}`
    );
  }

  const settings = await tx.accountingSettings.findUniqueOrThrow({
    where: { companyId },
    select: { lastEntryNumber: true },
  });
  const nextNumber = settings.lastEntryNumber + 1;

  const entry = await tx.journalEntry.create({
    data: {
      companyId,
      number: nextNumber,
      date,
      description,
      createdBy: 'test',
      lines: {
        create: lines.map((line) => ({
          accountId: line.accountId,
          debit: new Prisma.Decimal(line.debit),
          credit: new Prisma.Decimal(line.credit),
          description: line.description,
        })),
      },
    },
    select: { id: true, number: true },
  });

  await tx.accountingSettings.update({ where: { companyId }, data: { lastEntryNumber: nextNumber } });
  return entry;
}

async function fetchEntryLines(entryId: string): Promise<JournalLineRow[]> {
  const rows = await prisma.journalEntryLine.findMany({
    where: { entryId },
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

  let bankSourceId: string; // BankAccount de origen (gasto/retiro/transferencia)
  let bankDestId: string; // BankAccount de destino (aporte/transferencia)

  const createdFundMovementIds: string[] = [];
  const createdJournalEntryIds: string[] = [];

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
          balance: 5000000,
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
  });

  afterAll(async () => {
    // Orden inverso de dependencias: primero los movimientos (cascadean sus
    // conceptos), después los asientos (cascadean sus líneas), después los
    // bancos y la configuración (referencian cuentas con RESTRICT), después
    // las cuentas, después la empresa.
    for (const id of createdFundMovementIds) {
      await prisma.fundMovement.delete({ where: { id } }).catch(() => undefined);
    }
    for (const id of createdJournalEntryIds) {
      await prisma.journalEntry.delete({ where: { id } }).catch(() => undefined);
    }
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
    // Réplica del branch BANK_CHARGES de `confirmFundMovement`: un débito por
    // concepto + un crédito al banco por el total. Los importes son los del
    // ticket: dos conceptos de $302.574,16 y $1.434.154,28.
    let lines: JournalLineRow[];

    beforeAll(async () => {
      const total = sumLines([
        { accountId: commissionAccountId, description: 'x', amount: '302574.16' },
        { accountId: sircrebAccountId, description: 'y', amount: '1434154.28' },
      ]);
      expect(total).toBe(1736728.44);

      const movement = await prisma.fundMovement.create({
        data: {
          companyId,
          status: 'DRAFT',
          date: new Date('2026-01-15T12:00:00.000Z'),
          type: 'BANK_CHARGES',
          amount: new Prisma.Decimal(total),
          description: `${PREFIX}Gastos e impuestos bancarios de enero`,
          fundOutKind: 'BANK',
          fundOutId: bankSourceId,
          fundOutLabel: `${PREFIX}Banco Origen`,
          createdBy: 'test',
          lines: {
            create: [
              {
                accountId: commissionAccountId,
                description: `${PREFIX}Comision de mantenimiento`,
                amount: new Prisma.Decimal('302574.16'),
                position: 0,
              },
              {
                accountId: sircrebAccountId,
                description: `${PREFIX}Percepcion Sircreb`,
                amount: new Prisma.Decimal('1434154.28'),
                position: 1,
              },
            ],
          },
        },
        include: { lines: { orderBy: { position: 'asc' } } },
      });
      createdFundMovementIds.push(movement.id);

      // Mismo armado que el branch BANK_CHARGES real: un débito por concepto
      // más un crédito al banco por el total.
      const entryLines: JournalLineInput[] = [
        ...movement.lines.map((line) => ({
          accountId: line.accountId,
          debit: Number(line.amount),
          credit: 0,
          description: line.description,
        })),
        {
          accountId: bankLedgerAccountId,
          debit: 0,
          credit: Number(movement.amount),
          description: movement.description,
        },
      ];

      const entry = await prisma.$transaction((tx) =>
        persistJournalEntry(tx, {
          companyId,
          date: movement.date,
          description: movement.description,
          lines: entryLines,
        })
      );
      createdJournalEntryIds.push(entry.id);

      await prisma.fundMovement.update({
        where: { id: movement.id },
        data: {
          status: 'CONFIRMED',
          journalEntryId: entry.id,
          journalEntryNumber: entry.number,
          confirmedAt: new Date(),
        },
      });

      lines = await fetchEntryLines(entry.id);
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
    // arma cada llamador y se las pasa ya construidas. Un aporte de socio y
    // una transferencia entre cuentas -los dos tipos que ya estaban en
    // producción antes de TSK-585- tienen que seguir generando exactamente
    // dos líneas, con las mismas cuentas que antes del cambio.
    //
    // Si alguien rompe el armado genérico (por ejemplo, agregando o
    // perdiendo una línea, o invirtiendo débito/crédito), estos tests se
    // ponen en rojo.

    describe('aporte de socio', () => {
      let lines: JournalLineRow[];
      const amount = 50000;

      beforeAll(async () => {
        const movement = await prisma.fundMovement.create({
          data: {
            companyId,
            status: 'DRAFT',
            date: new Date('2026-01-20T12:00:00.000Z'),
            type: 'PARTNER_CONTRIBUTION',
            amount: new Prisma.Decimal(amount),
            description: `${PREFIX}Aporte de socio fundador`,
            fundInKind: 'BANK',
            fundInId: bankDestId,
            fundInLabel: `${PREFIX}Banco Destino`,
            createdBy: 'test',
          },
        });
        createdFundMovementIds.push(movement.id);

        // Mismo armado que el branch PARTNER_CONTRIBUTION real: `parLineas`
        // arma exactamente dos líneas -débito al banco/caja destino, crédito
        // a la cuenta de aportes-, sin depender de `applyFundSide` para el
        // `accountId` porque ya lo sembramos en el `BankAccount` del beforeAll.
        const entryLines: JournalLineInput[] = [
          { accountId: destLedgerAccountId, debit: amount, credit: 0, description: movement.description },
          { accountId: capitalAccountId, debit: 0, credit: amount, description: movement.description },
        ];

        const entry = await prisma.$transaction((tx) =>
          persistJournalEntry(tx, {
            companyId,
            date: movement.date,
            description: movement.description,
            lines: entryLines,
          })
        );
        createdJournalEntryIds.push(entry.id);

        await prisma.fundMovement.update({
          where: { id: movement.id },
          data: { status: 'CONFIRMED', journalEntryId: entry.id, journalEntryNumber: entry.number, confirmedAt: new Date() },
        });

        lines = await fetchEntryLines(entry.id);
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

    describe('transferencia entre cuentas', () => {
      let lines: JournalLineRow[];
      const amount = 25000;

      beforeAll(async () => {
        const movement = await prisma.fundMovement.create({
          data: {
            companyId,
            status: 'DRAFT',
            date: new Date('2026-01-22T12:00:00.000Z'),
            type: 'ACCOUNT_TRANSFER',
            amount: new Prisma.Decimal(amount),
            description: `${PREFIX}Transferencia entre bancos`,
            fundOutKind: 'BANK',
            fundOutId: bankSourceId,
            fundOutLabel: `${PREFIX}Banco Origen`,
            fundInKind: 'BANK',
            fundInId: bankDestId,
            fundInLabel: `${PREFIX}Banco Destino`,
            createdBy: 'test',
          },
        });
        createdFundMovementIds.push(movement.id);

        // Mismo armado que el branch ACCOUNT_TRANSFER real: `parLineas` arma
        // exactamente dos líneas -débito al destino, crédito al origen-.
        const entryLines: JournalLineInput[] = [
          { accountId: destLedgerAccountId, debit: amount, credit: 0, description: movement.description },
          { accountId: bankLedgerAccountId, debit: 0, credit: amount, description: movement.description },
        ];

        const entry = await prisma.$transaction((tx) =>
          persistJournalEntry(tx, {
            companyId,
            date: movement.date,
            description: movement.description,
            lines: entryLines,
          })
        );
        createdJournalEntryIds.push(entry.id);

        await prisma.fundMovement.update({
          where: { id: movement.id },
          data: { status: 'CONFIRMED', journalEntryId: entry.id, journalEntryNumber: entry.number, confirmedAt: new Date() },
        });

        lines = await fetchEntryLines(entry.id);
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
    // `buildLinesData` + `resolveMovementAmount` (ambas privadas de
    // `../list/actions.server.ts`) redondean cada concepto a 2 decimales y
    // calculan el total con `sumLines` -la misma función real, importada
    // acá-, ignorando por completo el campo `amount` del formulario para
    // BANK_CHARGES. Se manda un `amount` bien distinto de la suma de los
    // conceptos y se verifica que lo que queda guardado es la suma, no lo
    // que llegó.
    let storedAmount: number;
    let sentAmount: number;
    let sumaConceptos: number;

    beforeAll(async () => {
      const formInput: FundMovementFormInput = {
        type: 'BANK_CHARGES',
        date: '2026-02-01',
        amount: '999999.99', // deliberadamente distinto de la suma de las líneas
        description: `${PREFIX}Gastos con monto simulado incorrecto`,
        sourceFund: `BANK:${bankSourceId}`,
        destinationFund: '',
        partnerId: '',
        lines: [
          { accountId: commissionAccountId, description: 'Comision', amount: '100.50' },
          { accountId: sircrebAccountId, description: 'Sircreb', amount: '50.25' },
        ],
      };

      // El schema no exige que `amount` coincida con la suma para BANK_CHARGES
      // (ni con nada): confirma la nota de la Tarea 6 de que `amount` quedó
      // opcional y sin validar para este tipo.
      const parsed = fundMovementSchema.parse(formInput);
      sentAmount = parseFloat(parsed.amount!);

      // Réplica de `buildLinesData`: redondeo a 2 decimales por concepto.
      const linesData = (parsed.lines ?? []).map((line, index) => ({
        accountId: line.accountId,
        description: line.description.trim(),
        amount: new Prisma.Decimal(parseFloat(line.amount)).toDecimalPlaces(2),
        position: index,
      }));

      // Réplica de `resolveMovementAmount` para BANK_CHARGES: la suma de los
      // conceptos ya redondeados, con la función real `sumLines`.
      sumaConceptos = sumLines(
        linesData.map((line) => ({
          accountId: line.accountId,
          description: line.description,
          amount: line.amount.toString(),
        }))
      );
      expect(sumaConceptos).toBe(150.75);
      expect(sumaConceptos).not.toBe(sentAmount);

      const movement = await prisma.fundMovement.create({
        data: {
          companyId,
          status: 'DRAFT',
          date: new Date('2026-02-01T12:00:00.000Z'),
          type: 'BANK_CHARGES',
          amount: new Prisma.Decimal(sumaConceptos),
          description: formInput.description,
          fundOutKind: 'BANK',
          fundOutId: bankSourceId,
          fundOutLabel: `${PREFIX}Banco Origen`,
          createdBy: 'test',
          lines: { create: linesData },
        },
      });
      createdFundMovementIds.push(movement.id);

      const reread = await prisma.fundMovement.findUniqueOrThrow({ where: { id: movement.id } });
      storedAmount = Number(reread.amount);
    });

    it('guarda la suma de los conceptos, no el monto enviado por el cliente', () => {
      expect(storedAmount).toBe(150.75);
      expect(storedAmount).not.toBe(sentAmount);
      expect(storedAmount).toBe(sumaConceptos);
    });
  });

  describe('caso 4: el borrador guarda y relee sus conceptos, con su orden', () => {
    // Los conceptos se crean con la `position` desordenada respecto del
    // array de creación, a propósito: si `getFundMovementById` (o cualquier
    // lectura) dejara de ordenar por `position` y confiara en el orden de
    // inserción, este test lo detectaría.
    let releidas: { description: string; accountId: string; amount: number }[];

    beforeAll(async () => {
      const conceptos = [
        { accountId: sircrebAccountId, description: `${PREFIX}Percepcion Sircreb`, amount: '1200.00', position: 2 },
        { accountId: commissionAccountId, description: `${PREFIX}Comision mantenimiento`, amount: '850.30', position: 0 },
        { accountId: commissionAccountId, description: `${PREFIX}IVA sobre comision`, amount: '178.56', position: 1 },
      ];

      const movement = await prisma.fundMovement.create({
        data: {
          companyId,
          status: 'DRAFT',
          date: new Date('2026-02-10T12:00:00.000Z'),
          type: 'BANK_CHARGES',
          amount: new Prisma.Decimal(sumLines(conceptos)),
          description: `${PREFIX}Borrador con tres conceptos`,
          fundOutKind: 'BANK',
          fundOutId: bankSourceId,
          fundOutLabel: `${PREFIX}Banco Origen`,
          createdBy: 'test',
          lines: {
            create: conceptos.map((c) => ({
              accountId: c.accountId,
              description: c.description,
              amount: new Prisma.Decimal(c.amount),
              position: c.position,
            })),
          },
        },
      });
      createdFundMovementIds.push(movement.id);

      // Misma lectura que `getFundMovementById`: `include lines orderBy
      // position asc`, y `Number()` sobre los Decimal (regla de Decimal →
      // Number antes de llegar a un Client Component).
      const reread = await prisma.fundMovement.findFirstOrThrow({
        where: { id: movement.id, companyId },
        include: { lines: { orderBy: { position: 'asc' } } },
      });

      releidas = reread.lines.map((l) => ({
        description: l.description,
        accountId: l.accountId,
        amount: Number(l.amount),
      }));
    });

    it('relee los tres conceptos', () => {
      expect(releidas).toHaveLength(3);
    });

    it('los relee en el orden de `position`, no en el orden en que se insertaron', () => {
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
