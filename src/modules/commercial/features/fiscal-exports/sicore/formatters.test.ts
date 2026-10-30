import { describe, expect, it } from 'vitest';

import { formatSICORERecord } from './formatters';

/** Campo del registro por posiciones 1-based e inclusivas. */
const field = (record: string, from: number, to: number) => record.slice(from - 1, to);

describe('SICORE (retenciones de Ganancias): formato estándar de importación (TSK-813)', () => {
  const r = formatSICORERecord({
    codigoComprobante: 6,
    fechaComprobante: '15/10/2026',
    numeroComprobante: 'OP-00012',
    importeComprobante: 121000,
    codigoImpuesto: '217',
    regimen: '78',
    baseCalculo: 100000,
    fechaRetencion: '15/10/2026',
    condicion: 1,
    importeRetencion: 1890.25,
    cuitRetenido: '30-71234567-8',
  });

  it('mide 144 posiciones (retenciones a sujetos del país)', () => {
    expect(r).toHaveLength(144);
  });

  it('comprobante: código, fecha, número sin separadores e importe', () => {
    expect(field(r, 1, 2)).toBe('06');
    expect(field(r, 3, 12)).toBe('15/10/2026');
    expect(field(r, 13, 28)).toBe('000000000012'.padEnd(16));
    expect(field(r, 29, 44)).toBe('0000000121000.00');
  });

  it('impuesto 217, régimen con ceros a la izquierda y operación retención', () => {
    expect(field(r, 45, 47)).toBe('217');
    expect(field(r, 48, 50)).toBe('078');
    expect(field(r, 51, 51)).toBe('1');
  });

  it('base, fecha de la retención, condición e importe retenido', () => {
    expect(field(r, 52, 65)).toBe('00000100000.00');
    expect(field(r, 66, 75)).toBe('15/10/2026');
    expect(field(r, 76, 77)).toBe('01');
    expect(field(r, 78, 78)).toBe('0'); // no es un sujeto suspendido
    expect(field(r, 79, 92)).toBe('00000001890.25');
  });

  it('sin exclusión ni boletín; CUIT sin guiones; sin certificado original', () => {
    expect(field(r, 93, 98)).toBe('000.00');
    expect(field(r, 99, 108)).toBe(' '.repeat(10));
    expect(field(r, 109, 110)).toBe('80');
    expect(field(r, 111, 130)).toBe('30712345678'.padEnd(20));
    expect(field(r, 131, 144)).toBe('0'.repeat(14));
  });
});
