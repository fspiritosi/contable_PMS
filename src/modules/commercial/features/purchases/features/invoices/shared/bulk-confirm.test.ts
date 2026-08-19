import { describe, expect, it } from 'vitest';

import { buildBulkConfirmMessage, selectConfirmableInvoices } from './bulk-confirm';

const FACTURAS = [
  { id: '1', fullNumber: '0001-00000001', status: 'DRAFT' },
  { id: '2', fullNumber: '0001-00000002', status: 'CONFIRMED' },
  { id: '3', fullNumber: '0001-00000003', status: 'DRAFT' },
  { id: '4', fullNumber: '0001-00000004', status: 'CANCELLED' },
  { id: '5', fullNumber: '0001-00000005', status: 'PAID' },
];

describe('qué facturas de una selección se pueden confirmar', () => {
  it('deja solo las que están en borrador', () => {
    expect(selectConfirmableInvoices(FACTURAS).map((f) => f.id)).toEqual(['1', '3']);
  });

  it('devuelve vacío si ninguna está en borrador', () => {
    expect(selectConfirmableInvoices(FACTURAS.filter((f) => f.status !== 'DRAFT'))).toEqual([]);
  });

  it('no altera la selección original', () => {
    const original = [...FACTURAS];
    selectConfirmableInvoices(FACTURAS);
    expect(FACTURAS).toEqual(original);
  });
});

describe('mensaje del resultado', () => {
  it('informa el total cuando salieron todas', () => {
    expect(buildBulkConfirmMessage(3, [])).toBe('Se confirmaron 3 facturas');
  });

  it('usa el singular con una sola', () => {
    expect(buildBulkConfirmMessage(1, [])).toBe('Se confirmó 1 factura');
  });

  it('informa cuántas fallaron sin ocultar las que sí salieron', () => {
    const mensaje = buildBulkConfirmMessage(18, [
      { fullNumber: '0001-00000123', message: 'falta cuenta imputada' },
      { fullNumber: '0001-00000131', message: 'período cerrado' },
    ]);

    expect(mensaje).toBe('Se confirmaron 18 facturas; 2 no se pudieron confirmar');
  });

  it('avisa cuando no se confirmó ninguna', () => {
    const mensaje = buildBulkConfirmMessage(0, [
      { fullNumber: '0001-00000123', message: 'falta cuenta imputada' },
    ]);

    expect(mensaje).toBe('No se pudo confirmar ninguna de las 1 facturas seleccionadas');
  });
});
