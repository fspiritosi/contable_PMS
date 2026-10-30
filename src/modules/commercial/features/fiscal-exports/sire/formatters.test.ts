import { describe, expect, it } from 'vitest';

import { formatSIREIvaRecord, formatSIRESussRecord } from './formatters';

/** Campo del registro por posiciones 1-based e inclusivas, como en la especificación de SIRE. */
const field = (record: string, from: number, to: number) => record.slice(from - 1, to);

const base = {
  codigoTrazabilidad: 'OP-00012',
  regimen: '499',
  fechaRetencion: '15/10/2026',
  cuitRetenido: '30712345678',
  tipoComprobante: 6,
  fechaComprobante: '15/10/2026',
  numeroComprobante: 'OP-00012',
  importeComprobante: 121000,
  importeRetencion: 2100.5,
};

describe('SIRE F.2005 (retenciones de IVA): especificación para emisión por lote (TSK-813)', () => {
  const r = formatSIREIvaRecord({ ...base, condicion: null, baseCalculo: 100000 });

  it('mide 305 posiciones', () => {
    expect(r).toHaveLength(305);
  });

  it('versión, trazabilidad, impuesto 216 y régimen', () => {
    expect(field(r, 1, 4)).toBe('0100');
    expect(field(r, 5, 40)).toBe('OP-00012'.padEnd(36));
    expect(field(r, 41, 43)).toBe('216');
    expect(field(r, 44, 46)).toBe('499');
  });

  it('fechas DD/MM/AAAA y condición en blanco fuera de la tabla REGIMEN_CONDICION', () => {
    expect(field(r, 47, 56)).toBe('15/10/2026');
    expect(field(r, 57, 58)).toBe('  ');
    expect(field(r, 137, 146)).toBe('15/10/2026');
  });

  it('retención efectuada, sin régimen de exclusión', () => {
    expect(field(r, 59, 59)).toBe('0');
    expect(field(r, 60, 89)).toBe(' '.repeat(30));
    expect(field(r, 118, 118)).toBe('0');
    expect(field(r, 119, 124)).toBe(' '.repeat(6));
    expect(field(r, 125, 134)).toBe(' '.repeat(10));
  });

  it('importes con dos decimales y separador obligatorio, alineados a derecha con ceros', () => {
    expect(field(r, 90, 103)).toBe('00000002100.50');
    expect(field(r, 104, 117)).toBe('00000100000.00');
    expect(field(r, 201, 214)).toBe('00000121000.00');
  });

  it('comprobante orden de pago (6) con su número, COE y CAE en blanco', () => {
    expect(field(r, 135, 136)).toBe('06');
    expect(field(r, 147, 162)).toBe('OP-00012'.padEnd(16));
    expect(field(r, 163, 200)).toBe(' '.repeat(38));
  });

  it('CUIT del retenido y certificado original en blanco', () => {
    expect(field(r, 215, 244)).toBe(' '.repeat(30));
    expect(field(r, 245, 255)).toBe('30712345678');
    expect(field(r, 256, 305)).toBe(' '.repeat(50));
  });

  it('régimen 831: informa la condición del retenido', () => {
    const r831 = formatSIREIvaRecord({ ...base, regimen: '831', condicion: '2', baseCalculo: 100000 });
    expect(field(r831, 44, 46)).toBe('831');
    expect(field(r831, 57, 58)).toBe('02');
  });
});

describe('SIRE F.2004 (retenciones de Seguridad Social) (TSK-813)', () => {
  const r = formatSIRESussRecord({ ...base, regimen: '755', cuitAgente: '30700000001' });

  it('mide 191 posiciones', () => {
    expect(r).toHaveLength(191);
  });

  it('formulario, versión, trazabilidad, agente, impuesto 353 y régimen', () => {
    expect(field(r, 1, 4)).toBe('2004');
    expect(field(r, 5, 8)).toBe('0100');
    expect(field(r, 9, 18)).toBe('OP-00012'.padEnd(10));
    expect(field(r, 19, 29)).toBe('30700000001');
    expect(field(r, 30, 32)).toBe('353');
    expect(field(r, 33, 35)).toBe('755');
  });

  it('retenido, fechas, comprobante e importes', () => {
    expect(field(r, 36, 46)).toBe('30712345678');
    expect(field(r, 47, 56)).toBe('15/10/2026');
    expect(field(r, 57, 58)).toBe('06');
    expect(field(r, 59, 68)).toBe('15/10/2026');
    expect(field(r, 69, 84)).toBe('OP-00012'.padEnd(16));
    expect(field(r, 85, 98)).toBe('00000121000.00');
    expect(field(r, 99, 112)).toBe('00000002100.50');
  });

  it('certificado original y otros datos en blanco', () => {
    expect(field(r, 113, 191)).toBe(' '.repeat(79));
  });
});
