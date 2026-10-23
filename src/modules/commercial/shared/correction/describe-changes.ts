// Compara dos fotos de la cadena afectada y arma las tarjetas de la propuesta (TSK-792, §7).
//
// Convenciones que debe respetar quien arma las fotos (Tarea 12):
// - Tipo de entidad por prefijo de `key`: 'ENTRY:<número>' = asiento; 'CHECK:<banco>:<número>' = cheque.
// - Las líneas de un asiento van en `fields`, una entrada por línea, con la etiqueta
//   que empieza con ENTRY_LINE_PREFIX (p. ej. 'Línea 1' → '1.1.01 Caja · Debe $ 100,00').
//   Si hay líneas distintas (alta, baja o cambio) entre las fotos, el asiento es REWRITE.
// - `status` lleva el estado en castellano, con las constantes STATUS_* de este archivo.

import type { CardAction, CardRow, ProposalCard } from './types';

export interface SnapshotEntity {
  /** Clave natural estable entre fotos ('PURCHASE_INVOICE:<id>', 'ENTRY:<number>', 'BANK:<accountId>:<docId>', 'CHECK:<bank>:<number>'). */
  key: string;
  /** Orden de la cadena (0 origen, 1 su asiento, 2.. dependientes y efectos). */
  order: number;
  /** "FC A 0003-00001234 · Lubricantes SA". */
  title: string;
  /** Etiqueta → valor ya formateado (moneda AR, fechas DD/MM/YYYY, estados en castellano). */
  fields: Record<string, string>;
  /** Para distinguir CANCEL/REVERSE/BACK_TO_PORTFOLIO. */
  status?: string;
}

export interface ChainSnapshot {
  entities: SnapshotEntity[];
}

export const ENTRY_KEY_PREFIX = 'ENTRY:';
export const CHECK_KEY_PREFIX = 'CHECK:';
export const ENTRY_LINE_PREFIX = 'Línea ';
export const STATUS_ROW_LABEL = 'Estado';

/** Comprobante anulado (femenino: factura, orden de pago, nota). */
export const STATUS_CANCELLED = 'Anulada';
/** Asiento anulado con contraasiento (masculino). */
export const STATUS_REVERSED = 'Anulado';
export const STATUS_CHECK_ENDORSED = 'Endosado';
export const STATUS_CHECK_IN_PORTFOLIO = 'En cartera';

const isEntry = (key: string) => key.startsWith(ENTRY_KEY_PREFIX);
const isCheck = (key: string) => key.startsWith(CHECK_KEY_PREFIX);

function diffRows(before: SnapshotEntity, after: SnapshotEntity): CardRow[] {
  const rows: CardRow[] = [];
  const labels = [
    ...Object.keys(after.fields),
    ...Object.keys(before.fields).filter((l) => !(l in after.fields)),
  ];
  for (const label of labels) {
    const b = before.fields[label] ?? null;
    const a = after.fields[label] ?? null;
    if (b !== a) rows.push({ label, before: b, after: a });
  }
  if ((before.status ?? null) !== (after.status ?? null)) {
    rows.push({
      label: STATUS_ROW_LABEL,
      before: before.status ?? null,
      after: after.status ?? null,
    });
  }
  return rows;
}

function actionForChange(
  before: SnapshotEntity,
  after: SnapshotEntity,
  rows: CardRow[]
): CardAction {
  const statusChanged = (before.status ?? null) !== (after.status ?? null);
  if (statusChanged) {
    if (after.status === STATUS_CANCELLED) return 'CANCEL';
    if (after.status === STATUS_REVERSED) return 'REVERSE';
    if (
      isCheck(after.key) &&
      before.status === STATUS_CHECK_ENDORSED &&
      after.status === STATUS_CHECK_IN_PORTFOLIO
    ) {
      return 'BACK_TO_PORTFOLIO';
    }
  }
  if (isEntry(after.key) && rows.some((r) => r.label.startsWith(ENTRY_LINE_PREFIX)))
    return 'REWRITE';
  if (rows.length === 1 && rows[0].label === STATUS_ROW_LABEL) return 'RECALCULATE';
  return 'MODIFY';
}

export function describeChanges(before: ChainSnapshot, after: ChainSnapshot): ProposalCard[] {
  const beforeByKey = new Map(before.entities.map((e) => [e.key, e]));
  const afterByKey = new Map(after.entities.map((e) => [e.key, e]));
  const cards: { order: number; card: ProposalCard }[] = [];

  for (const b of before.entities) {
    const a = afterByKey.get(b.key);
    if (!a) {
      cards.push({
        order: b.order,
        card: {
          key: b.key,
          title: b.title,
          action: 'DELETE',
          rows: Object.entries(b.fields).map(([label, value]) => ({
            label,
            before: value,
            after: null,
          })),
        },
      });
      continue;
    }
    const rows = diffRows(b, a);
    if (rows.length === 0) continue;
    cards.push({
      order: a.order,
      card: { key: a.key, title: a.title, action: actionForChange(b, a, rows), rows },
    });
  }

  // Entidades nuevas: un asiento nuevo es un contraasiento; cualquier otra se informa como modificación.
  for (const a of after.entities) {
    if (beforeByKey.has(a.key)) continue;
    cards.push({
      order: a.order,
      card: {
        key: a.key,
        title: a.title,
        action: isEntry(a.key) ? 'REVERSE' : 'MODIFY',
        rows: Object.entries(a.fields).map(([label, value]) => ({
          label,
          before: null,
          after: value,
        })),
      },
    });
  }

  return cards.sort((x, y) => x.order - y.order).map((c) => c.card);
}
