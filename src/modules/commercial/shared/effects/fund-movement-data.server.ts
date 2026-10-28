import 'server-only';

import { Prisma } from '@/generated/prisma/client';
import type { Tx } from '@/modules/accounting/features/integrations/core';
import { sumLines } from '@/modules/commercial/features/treasury/features/fund-movements/shared/lines-calc';
import {
  parseFundMovementDate,
  parseFundRef,
  type FundMovementFormInput,
  type FundSourceKind,
} from '@/modules/commercial/features/treasury/features/fund-movements/shared/validators';
import { BusinessError } from '@/shared/lib/action-result';
import { countActiveConcepts, resolveConceptForUsage } from '@/shared/lib/concepts/concepts.server';
import { fundMovementUsage } from '@/shared/lib/concepts/usages';

import { resolveLineConcept, type ResolvedLineConcept } from './fund-movement.server';

/**
 * Escritura de los datos editables de un movimiento de fondo (TSK-792). Vive fuera
 * del archivo `'use server'` de movimientos porque recibe una transacción:
 * exportada desde ahí sería un server action público sin permisos.
 *
 * Los datos llegan del cliente (alta, edición de borrador o propuesta del motor):
 * todo lo que el movimiento referencia (bancos, cajas, socio y conceptos) se valida
 * contra la empresa con la misma conexión que escribe.
 */

/** Valida un banco/caja de la empresa y devuelve su etiqueta, sin tocar saldos. */
async function resolveFundRefLabel(
  db: Tx,
  ref: { kind: FundSourceKind; id: string },
  companyId: string
): Promise<{ kind: FundSourceKind; id: string; label: string }> {
  if (ref.kind === 'BANK') {
    const bank = await db.bankAccount.findFirst({
      where: { id: ref.id, companyId, status: 'ACTIVE' },
      select: { bankName: true, accountNumber: true },
    });
    if (!bank) throw new BusinessError('La cuenta bancaria seleccionada no es válida');
    return { kind: 'BANK', id: ref.id, label: `${bank.bankName} - ${bank.accountNumber}` };
  }
  const cash = await db.cashRegister.findFirst({
    where: { id: ref.id, companyId, status: 'ACTIVE' },
    select: { name: true },
  });
  if (!cash) throw new BusinessError('La caja seleccionada no es válida');
  return { kind: 'CASH', id: ref.id, label: `Caja ${cash.name}` };
}

/**
 * Nombre del socio para el snapshot `partnerName`. En aporte y retiro el socio
 * define la cuenta del asiento (TSK-717). En cualquier tipo, un socio que no es de
 * la empresa se rechaza (TSK-792): antes, en transferencia y gastos bancarios, el
 * id ajeno se guardaba igual con el nombre en `null`.
 */
async function resolvePartnerName(
  db: Tx,
  data: FundMovementFormInput,
  companyId: string
): Promise<string | null> {
  if (!data.partnerId) return null;
  const partner = await db.partner.findFirst({
    where: { id: data.partnerId, companyId },
    select: { name: true },
  });
  if (!partner) throw new BusinessError('El socio seleccionado no es válido');
  return partner.name;
}

/** Una línea de gastos bancarios lista para persistir. */
interface FundMovementLineData {
  conceptId: string;
  /** Snapshot del nombre del concepto, para el historial (TSK-791). */
  conceptName: string;
  /** Cuenta resuelta desde el concepto en el servidor: nunca viene del cliente. */
  accountId: string;
  /** Detalle opcional, trimmeado; puede ser ''. */
  description: string;
  amount: Prisma.Decimal;
  position: number;
}

/**
 * Líneas listas para persistir. Solo las tiene el tipo BANK_CHARGES; el resto
 * de los tipos guarda el movimiento sin líneas, aunque el cliente mande alguna.
 * El importe se redondea acá a los 2 decimales de la columna, para que la base
 * no lo redondee por su cuenta y el total quede diferente de la suma.
 *
 * TSK-791: cada línea trae un concepto y la cuenta se resuelve desde él con
 * `resolveConceptForUsage`, que reemplaza a `assertLineAccounts`: valida que el
 * concepto sea de la empresa, esté activo, tenga el uso y que su cuenta siga
 * siendo imputable y de un tipo admitido (egreso o activo, TSK-579). Así un id
 * manipulado en el payload no puede imputar a otra empresa ni a una cuenta
 * inválida.
 */
async function buildLinesData(
  db: Tx,
  companyId: string,
  data: FundMovementFormInput
): Promise<FundMovementLineData[]> {
  if (data.type !== 'BANK_CHARGES') return [];
  const cache = new Map<string, ResolvedLineConcept>();
  const lines: FundMovementLineData[] = [];
  for (const [index, line] of (data.lines ?? []).entries()) {
    const concept = await resolveLineConcept(db, companyId, line.conceptId, cache);
    lines.push({
      conceptId: concept.id,
      conceptName: concept.name,
      accountId: concept.accountId,
      description: line.description.trim(),
      amount: new Prisma.Decimal(parseFloat(line.amount)).toDecimalPlaces(2),
      position: index,
    });
  }
  return lines;
}

/**
 * Concepto de un aporte o retiro al guardar (TSK-791). Que sea obligatorio depende
 * de los conceptos activos del tipo, así que se decide acá y no en el schema:
 *  - viene un concepto  → se valida y se guarda con su nombre (snapshot);
 *  - no viene y hay conceptos activos para el tipo → error;
 *  - no viene y no hay conceptos activos → se guarda sin concepto, como antes.
 * Los demás tipos no llevan concepto en el movimiento: gastos bancarios lo lleva
 * en cada línea y la transferencia nunca usa conceptos.
 */
async function resolveMovementConcept(
  db: Tx,
  companyId: string,
  data: FundMovementFormInput
): Promise<{ conceptId: string | null; conceptName: string | null }> {
  const isPartnerMovement =
    data.type === 'PARTNER_CONTRIBUTION' || data.type === 'PARTNER_WITHDRAWAL';
  const usage = isPartnerMovement ? fundMovementUsage(data.type) : null;
  if (!usage) return { conceptId: null, conceptName: null };

  if (data.conceptId) {
    const concept = await resolveConceptForUsage(db, {
      companyId,
      conceptId: data.conceptId,
      usage,
    });
    return { conceptId: concept.id, conceptName: concept.name };
  }
  if ((await countActiveConcepts(db, companyId, usage)) > 0) {
    throw new BusinessError('Elegí el concepto del movimiento');
  }
  return { conceptId: null, conceptName: null };
}

/**
 * Importe del movimiento. En gastos bancarios lo calcula el servidor sumando las
 * líneas ya redondeadas: `amount` ni siquiera llega para ese tipo (TSK-585).
 * Así el total guardado es exactamente la suma de las líneas, que es lo que
 * después se acredita al banco en el asiento.
 */
function resolveMovementAmount(
  data: FundMovementFormInput,
  linesData: FundMovementLineData[]
): number {
  // El `superRefine` del schema exige `amount` (requerido + formato) para
  // todo tipo que no sea BANK_CHARGES, así que acá siempre llega un string
  // válido: la aserción documenta esa garantía en vez de esconder un `?? '0'`
  // que nunca debería ejecutarse.
  if (data.type !== 'BANK_CHARGES') return parseFloat(data.amount!);
  return sumLines(
    linesData.map((line) => ({
      conceptId: line.conceptId,
      description: line.description,
      amount: line.amount.toString(),
    }))
  );
}

/**
 * Datos de la compra o venta de inversión (TSK-793): tenencia, nominales, precio
 * unitario, comisión y marca de venta total. Los demás tipos los guardan vacíos
 * aunque el cliente los mande, como las líneas fuera de gastos bancarios.
 *
 * Acá solo se valida que la tenencia sea de la empresa. Que esté abierta se mira
 * al confirmar (`applyInvestmentSideTx`): un borrador puede quedar apuntando a una
 * tenencia que se cerró después, y se informa recién al confirmarlo.
 */
async function resolveInvestmentFields(
  db: Tx,
  companyId: string,
  data: FundMovementFormInput
): Promise<{
  holdingId: string | null;
  nominals: Prisma.Decimal | null;
  unitPrice: Prisma.Decimal | null;
  commission: Prisma.Decimal | null;
  isFullSale: boolean;
}> {
  const isInvestment = data.type === 'INVESTMENT_PURCHASE' || data.type === 'INVESTMENT_SALE';
  if (!isInvestment) {
    return {
      holdingId: null,
      nominals: null,
      unitPrice: null,
      commission: null,
      isFullSale: false,
    };
  }
  // El schema exige la tenencia en los dos tipos de inversión.
  const holding = data.holdingId
    ? await db.investmentHolding.findFirst({
        where: { id: data.holdingId, companyId },
        select: { id: true },
      })
    : null;
  if (!holding) throw new BusinessError('La tenencia seleccionada no es válida');

  const decimal = (value: string | undefined, places: number) =>
    value ? new Prisma.Decimal(value).toDecimalPlaces(places) : null;
  // "Venta total" no aplica a la compra.
  const isFullSale = data.type === 'INVESTMENT_SALE' && Boolean(data.isFullSale);
  return {
    holdingId: holding.id,
    // La venta total vende todos los nominales: los cargados no se usan, así que
    // tampoco se guardan (el formulario los limpia al marcarla).
    nominals: isFullSale ? null : decimal(data.nominals, 6),
    unitPrice: decimal(data.unitPrice, 6),
    commission: decimal(data.commission, 2),
    isFullSale,
  };
}

/**
 * Resuelve los datos de un movimiento desde el form ya validado por
 * `fundMovementSchema`: etiquetas de banco/caja, socio, concepto, líneas con su
 * cuenta e importe, y los datos de inversión (TSK-793). Valida que todo sea de la empresa (`BusinessError` si no).
 * Lo usan el alta (`createFundMovement`) y `writeFundMovementDataTx`.
 */
export async function resolveFundMovementDataTx(
  db: Tx,
  companyId: string,
  data: FundMovementFormInput
) {
  const sourceRef = data.sourceFund ? parseFundRef(data.sourceFund) : null;
  const destRef = data.destinationFund ? parseFundRef(data.destinationFund) : null;
  const lines = await buildLinesData(db, companyId, data);
  const concept = await resolveMovementConcept(db, companyId, data);

  // fundOut = origen (retiro/transferencia); fundIn = destino (aporte/transferencia)
  const fundOut = sourceRef ? await resolveFundRefLabel(db, sourceRef, companyId) : null;
  const fundIn = destRef ? await resolveFundRefLabel(db, destRef, companyId) : null;
  const partnerName = await resolvePartnerName(db, data, companyId);
  const investment = await resolveInvestmentFields(db, companyId, data);

  return {
    fields: {
      date: parseFundMovementDate(data.date),
      type: data.type,
      amount: new Prisma.Decimal(resolveMovementAmount(data, lines)),
      description: data.description,
      fundOutKind: fundOut?.kind ?? null,
      fundOutId: fundOut?.id ?? null,
      fundOutLabel: fundOut?.label ?? null,
      fundInKind: fundIn?.kind ?? null,
      fundInId: fundIn?.id ?? null,
      fundInLabel: fundIn?.label ?? null,
      partnerId: data.partnerId || null,
      partnerName,
      conceptId: concept.conceptId,
      conceptName: concept.conceptName,
      ...investment,
    },
    lines,
  };
}

/**
 * Escribe los datos editables del movimiento dentro de la transacción del llamador:
 * fecha, tipo, importe, descripción, bancos/cajas, socio y concepto, y reemplaza
 * las líneas de gastos bancarios. No mira el estado ni mueve fondos: lo usan
 * `updateFundMovement` (borrador) y el motor de corrección, que revierte y reaplica
 * los efectos alrededor de esta escritura. Recibe el form ya validado por
 * `fundMovementSchema` y rechaza referencias ajenas a la empresa.
 */
export async function writeFundMovementDataTx(
  tx: Tx,
  companyId: string,
  fundMovementId: string,
  input: FundMovementFormInput
): Promise<void> {
  const existing = await tx.fundMovement.count({ where: { id: fundMovementId, companyId } });
  if (existing === 0) throw new BusinessError('Movimiento no encontrado');

  const { fields, lines } = await resolveFundMovementDataTx(tx, companyId, input);

  await tx.fundMovement.update({ where: { id: fundMovementId, companyId }, data: fields });

  // Las líneas se reemplazan enteras, con la posición del formulario.
  await tx.fundMovementLine.deleteMany({ where: { movementId: fundMovementId } });
  if (lines.length > 0) {
    await tx.fundMovementLine.createMany({
      data: lines.map((line) => ({ ...line, movementId: fundMovementId })),
    });
  }
}
