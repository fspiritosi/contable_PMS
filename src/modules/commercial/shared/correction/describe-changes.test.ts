import { describe, expect, it } from 'vitest';

import {
  STATUS_CANCELLED,
  STATUS_CHECK_ENDORSED,
  STATUS_CHECK_IN_PORTFOLIO,
  STATUS_REVERSED,
  describeChanges,
  type SnapshotEntity,
} from './describe-changes';

const fc = (total: string, status = 'Confirmada'): SnapshotEntity => ({
  key: 'PURCHASE_INVOICE:1',
  order: 0,
  title: 'FC A 0003-00001234 · Lubricantes SA',
  fields: { Total: total },
  status,
});

const entry = (lines: Record<string, string>, status = 'Registrado'): SnapshotEntity => ({
  key: 'ENTRY:15',
  order: 1,
  title: 'Asiento N° 15',
  fields: { Fecha: '01/10/2026', ...lines },
  status,
});

describe('describeChanges', () => {
  it('sin cambios no hay tarjetas', () => {
    const snap = { entities: [fc('$ 100,00'), entry({ 'Línea 1': 'Caja · Debe 100' })] };
    expect(describeChanges(snap, snap)).toEqual([]);
  });

  it('monto cambiado → MODIFY con fila antes/después', () => {
    const cards = describeChanges({ entities: [fc('$ 100,00')] }, { entities: [fc('$ 80,00')] });
    expect(cards).toEqual([
      {
        key: 'PURCHASE_INVOICE:1',
        title: 'FC A 0003-00001234 · Lubricantes SA',
        action: 'MODIFY',
        rows: [{ label: 'Total', before: '$ 100,00', after: '$ 80,00' }],
      },
    ]);
  });

  it('solo cambia el estado → RECALCULATE', () => {
    const cards = describeChanges(
      { entities: [fc('$ 100,00', 'Confirmada')] },
      { entities: [fc('$ 100,00', 'Pago parcial')] }
    );
    expect(cards[0].action).toBe('RECALCULATE');
    expect(cards[0].rows).toEqual([
      { label: 'Estado', before: 'Confirmada', after: 'Pago parcial' },
    ]);
  });

  it('entidad que desaparece → DELETE', () => {
    const cards = describeChanges({ entities: [fc('$ 100,00')] }, { entities: [] });
    expect(cards[0].action).toBe('DELETE');
    expect(cards[0].rows).toEqual([{ label: 'Total', before: '$ 100,00', after: null }]);
  });

  it('asiento con líneas distintas → REWRITE', () => {
    const cards = describeChanges(
      { entities: [entry({ 'Línea 1': 'Caja · Debe 100', 'Línea 2': 'Ventas · Haber 100' })] },
      { entities: [entry({ 'Línea 1': 'Caja · Debe 80', 'Línea 2': 'Ventas · Haber 80' })] }
    );
    expect(cards).toHaveLength(1);
    expect(cards[0].action).toBe('REWRITE');
    expect(cards[0].rows.map((r) => r.label)).toEqual(['Línea 1', 'Línea 2']);
  });

  it('asiento con distinta cantidad de líneas → REWRITE', () => {
    const cards = describeChanges(
      { entities: [entry({ 'Línea 1': 'a' })] },
      { entities: [entry({ 'Línea 1': 'a', 'Línea 2': 'b' })] }
    );
    expect(cards[0].action).toBe('REWRITE');
  });

  it('asiento con otro campo pero mismas líneas → MODIFY', () => {
    const b = entry({ 'Línea 1': 'a' });
    const a = { ...b, fields: { ...b.fields, Fecha: '02/10/2026' } };
    expect(describeChanges({ entities: [b] }, { entities: [a] })[0].action).toBe('MODIFY');
  });

  it('estado Anulada → CANCEL; Anulado → REVERSE', () => {
    const cancel = describeChanges(
      { entities: [fc('$ 1')] },
      { entities: [fc('$ 1', STATUS_CANCELLED)] }
    );
    expect(cancel[0].action).toBe('CANCEL');
    const reverse = describeChanges(
      { entities: [entry({ 'Línea 1': 'a' })] },
      { entities: [entry({ 'Línea 1': 'a' }, STATUS_REVERSED)] }
    );
    expect(reverse[0].action).toBe('REVERSE');
  });

  it('recibo (masculino) que pasa a Anulado → CANCEL, no REVERSE', () => {
    const rc = (status: string): SnapshotEntity => ({
      key: 'RECEIPT:5',
      order: 0,
      title: 'RC 1',
      fields: {},
      status,
    });
    const cards = describeChanges(
      { entities: [rc('Confirmado')] },
      { entities: [rc(STATUS_REVERSED)] }
    );
    expect(cards[0].action).toBe('CANCEL');
  });

  it('asiento que pasa a Anulado → REVERSE', () => {
    const e = (status: string) => entry({ 'Línea 1': 'a' }, status);
    const cards = describeChanges(
      { entities: [e('Registrado')] },
      { entities: [e(STATUS_REVERSED)] }
    );
    expect(cards[0].action).toBe('REVERSE');
  });

  it('asiento nuevo (contraasiento) → REVERSE', () => {
    const counter: SnapshotEntity = {
      ...entry({ 'Línea 1': 'a' }),
      key: 'ENTRY:16',
      title: 'Asiento N° 16',
    };
    const cards = describeChanges({ entities: [] }, { entities: [counter] });
    expect(cards[0].action).toBe('REVERSE');
    expect(cards[0].rows[0].before).toBeNull();
  });

  it('cheque ENDOSADO→EN CARTERA → BACK_TO_PORTFOLIO', () => {
    const check = (status: string): SnapshotEntity => ({
      key: 'CHECK:Galicia:0001',
      order: 3,
      title: 'Cheque Galicia 0001',
      fields: {},
      status,
    });
    const cards = describeChanges(
      { entities: [check(STATUS_CHECK_ENDORSED)] },
      { entities: [check(STATUS_CHECK_IN_PORTFOLIO)] }
    );
    expect(cards[0].action).toBe('BACK_TO_PORTFOLIO');
  });

  it('tarjetas en orden de cadena', () => {
    const op: SnapshotEntity = {
      key: 'PAYMENT_ORDER:9',
      order: 2,
      title: 'OP',
      fields: { Total: '2' },
    };
    const opAfter = { ...op, fields: { Total: '1' } };
    const cards = describeChanges(
      { entities: [op, entry({ 'Línea 1': 'a' }), fc('$ 100,00')] },
      { entities: [opAfter, entry({ 'Línea 1': 'b' }), fc('$ 80,00')] }
    );
    expect(cards.map((c) => c.key)).toEqual(['PURCHASE_INVOICE:1', 'ENTRY:15', 'PAYMENT_ORDER:9']);
  });
});
