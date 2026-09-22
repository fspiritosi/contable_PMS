/**
 * Movimientos por centro de costo: entradas, salidas y saldo (TSK-719).
 *
 * "Entradas y Salidas" es el vocabulario de la clienta para los ingresos y los
 * egresos imputados a un centro de costo. La regla no clasifica por tipo de
 * cuenta a secas ni por Debe/Haber a secas, sino por las dos cosas a la vez
 * (opción (c) del análisis 1.2.4):
 *
 *   nature = CREDIT (REVENUE, y LIABILITY/EQUITY si llegaran)
 *       entrada = credit - debit     → la NC de venta debita Ventas y RESTA
 *   nature = DEBIT  (EXPENSE, y ASSET)
 *       salida  = debit - credit     → la NC de compra acredita el gasto y RESTA
 *
 *   saldo del centro = Σ entradas − Σ salidas
 *
 * Clasificar solo por tipo de cuenta haría que las notas de crédito SUMARAN en
 * vez de restar (riesgo 1.6-4, el bug silencioso del ticket); firmar solo por
 * Debe/Haber llamaría "salida" a cualquier Debe, incluso el de un activo.
 *
 * Módulo PURO: sin Prisma, sin Next, sin React. La conversión de `Decimal` a
 * `number` la hace la action antes de llamar acá (regla 9 del CLAUDE.md). El
 * aplanado para Excel también vive acá, y no en el componente, para que el
 * saldo tenga una sola fuente de verdad testeable (riesgo 1.6-8).
 */

/** Etiqueta del bucket de líneas de resultado sin centro imputado. */
export const NO_COST_CENTER_LABEL = '(Sin centro de costo)';

/** Una línea de asiento, ya leída de la base y con los importes en `number`. */
export interface CostCenterMovementLine {
  lineId: string;
  entryId: string;
  entryNumber: number;
  date: Date;
  entryDescription: string;
  lineDescription: string | null;
  status: 'DRAFT' | 'POSTED';
  accountCode: string;
  accountName: string;
  accountNature: 'DEBIT' | 'CREDIT';
  debit: number;
  credit: number;
  costCenterId: string | null;
  costCenterName: string | null;
}

/** Una línea con su clasificación y el saldo acumulado dentro de su grupo. */
export interface CostCenterMovementRow extends CostCenterMovementLine {
  entrada: number;
  salida: number;
  /** Acumulado del grupo hasta esta fila inclusive. */
  saldo: number;
}

export interface CostCenterMovementGroup {
  costCenterId: string | null;
  costCenterName: string;
  totalEntradas: number;
  totalSalidas: number;
  saldo: number;
  rows: CostCenterMovementRow[];
}

export interface CostCenterMovementTotals {
  entradas: number;
  salidas: number;
  saldo: number;
}

export interface DraftsSummary {
  /** Asientos distintos en borrador, no líneas. */
  entryCount: number;
  saldo: number;
}

/**
 * Redondeo a los 2 decimales que manejan `Decimal(12,2)` y el Excel.
 * Se aplica a los TOTALES, no a cada fila, para no acumular error de redondeo.
 */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

type SplittableLine = Pick<CostCenterMovementLine, 'accountNature' | 'debit' | 'credit'>;

/**
 * Clasifica el importe de una línea en entrada o salida (nunca las dos: el
 * constraint `chk_jel_debit_or_credit` garantiza Debe XOR Haber).
 */
export function splitLineAmount(line: SplittableLine): { entrada: number; salida: number } {
  if (line.accountNature === 'CREDIT') {
    return { entrada: line.credit - line.debit, salida: 0 };
  }
  return { entrada: 0, salida: line.debit - line.credit };
}

/** Orden estable del detalle: fecha, número de asiento y, de desempate, id de línea. */
function compareLines(a: CostCenterMovementLine, b: CostCenterMovementLine): number {
  const byDate = a.date.getTime() - b.date.getTime();
  if (byDate !== 0) return byDate;
  const byNumber = a.entryNumber - b.entryNumber;
  if (byNumber !== 0) return byNumber;
  return a.lineId.localeCompare(b.lineId);
}

/**
 * Filas de detalle ordenadas, con entrada, salida y saldo acumulado fila a fila.
 * El acumulado arranca en 0: es el saldo del período, no del centro desde su origen.
 */
export function buildMovementRows(lines: CostCenterMovementLine[]): CostCenterMovementRow[] {
  const ordered = [...lines].sort(compareLines);

  let saldo = 0;
  return ordered.map((line) => {
    const { entrada, salida } = splitLineAmount(line);
    saldo += entrada - salida;
    return { ...line, entrada, salida, saldo };
  });
}

/**
 * Un grupo por centro de costo, ordenados por nombre y con el bucket "sin
 * centro" siempre último. Cada grupo acumula su propio saldo desde cero.
 */
export function groupByCostCenter(lines: CostCenterMovementLine[]): CostCenterMovementGroup[] {
  const byCenter = new Map<string, CostCenterMovementLine[]>();
  for (const line of lines) {
    const key = line.costCenterId ?? '';
    const bucket = byCenter.get(key);
    if (bucket) bucket.push(line);
    else byCenter.set(key, [line]);
  }

  const groups: CostCenterMovementGroup[] = [];
  for (const [key, groupLines] of byCenter) {
    const rows = buildMovementRows(groupLines);
    const totalEntradas = round2(rows.reduce((acc, row) => acc + row.entrada, 0));
    const totalSalidas = round2(rows.reduce((acc, row) => acc + row.salida, 0));

    groups.push({
      costCenterId: key === '' ? null : key,
      costCenterName: key === '' ? NO_COST_CENTER_LABEL : (groupLines[0].costCenterName ?? key),
      totalEntradas,
      totalSalidas,
      saldo: round2(totalEntradas - totalSalidas),
      rows,
    });
  }

  return groups.sort((a, b) => {
    if (a.costCenterId === null) return 1;
    if (b.costCenterId === null) return -1;
    return a.costCenterName.localeCompare(b.costCenterName, 'es');
  });
}

/** Totales generales del reporte: la suma de los grupos, ya redondeada. */
export function sumGroupTotals(groups: CostCenterMovementGroup[]): CostCenterMovementTotals {
  const entradas = round2(groups.reduce((acc, group) => acc + group.totalEntradas, 0));
  const salidas = round2(groups.reduce((acc, group) => acc + group.totalSalidas, 0));
  return { entradas, salidas, saldo: round2(entradas - salidas) };
}

/**
 * Resumen de lo que quedó afuera por estar en borrador: cuántos ASIENTOS
 * distintos (dos líneas del mismo asiento cuentan una vez) y por qué importe
 * neto, con la misma regla de signo que el reporte para que el aviso no pueda
 * discrepar de la tabla (análisis 1.2.5).
 */
export function summarizeDrafts(lines: CostCenterMovementLine[]): DraftsSummary {
  const entryIds = new Set<string>();
  let saldo = 0;
  for (const line of lines) {
    entryIds.add(line.entryId);
    const { entrada, salida } = splitLineAmount(line);
    saldo += entrada - salida;
  }
  return { entryCount: entryIds.size, saldo: round2(saldo) };
}

/**
 * Filas planas para `exportToExcel`: grupo por grupo, el detalle y una fila
 * TOTAL por centro. El componente solo pinta y exporta lo que sale de acá.
 */
export function buildExcelRows(
  groups: CostCenterMovementGroup[],
  options: { includeStatus: boolean }
): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = [];

  for (const group of groups) {
    for (const row of group.rows) {
      const flat: Record<string, unknown> = {
        centro: group.costCenterName,
        fecha: row.date,
        asiento: row.entryNumber,
        codigo: row.accountCode,
        cuenta: row.accountName,
        descripcion: row.lineDescription ?? row.entryDescription,
        debe: row.debit,
        haber: row.credit,
        entrada: row.entrada,
        salida: row.salida,
        saldo: row.saldo,
      };
      if (options.includeStatus) flat.estado = row.status;
      rows.push(flat);
    }

    const totalRow: Record<string, unknown> = {
      centro: group.costCenterName,
      fecha: null,
      asiento: '',
      codigo: '',
      cuenta: 'TOTAL',
      descripcion: '',
      debe: round2(group.rows.reduce((acc, row) => acc + row.debit, 0)),
      haber: round2(group.rows.reduce((acc, row) => acc + row.credit, 0)),
      entrada: group.totalEntradas,
      salida: group.totalSalidas,
      saldo: group.saldo,
    };
    if (options.includeStatus) totalRow.estado = '';
    rows.push(totalRow);
  }

  return rows;
}
