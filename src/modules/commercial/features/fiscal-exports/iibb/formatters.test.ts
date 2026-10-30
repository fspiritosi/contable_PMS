import { describe, expect, it } from 'vitest';

import { formatSIRCARRetencion } from './formatters';

describe('SIRCAR: diseño de retenciones de la RG CA 2/2011, Anexo II (TSK-813)', () => {
  const record = {
    renglon: 3,
    numeroComprobante: 'OP-00012',
    cuit: '30-71234567-8',
    fechaRetencion: '15/10/2026',
    montoSujeto: 100000,
    alicuota: 1.5,
    montoRetenido: 1500,
    regimen: '11',
    jurisdiccion: '904',
  };

  it('once campos separados por comas', () => {
    expect(formatSIRCARRetencion(record).split(',')).toHaveLength(11);
  });

  it('cada campo en el formato del Anexo II', () => {
    expect(formatSIRCARRetencion(record)).toBe(
      [
        '00003', // renglón, Numérico(5)
        '1', // origen: software propio del agente
        '1', // tipo: comprobante de retención
        '000000000012', // número de comprobante, Numérico(12)
        '30712345678',
        '15/10/2026',
        '100000.00', // monto sujeto, sin separador de miles
        '1.50', // alícuota
        '1500.00', // monto retenido
        '011', // régimen, Numérico(3)
        '904', // jurisdicción del Convenio Multilateral
      ].join(',')
    );
  });

  it('sin régimen definido por la jurisdicción: 001', () => {
    expect(formatSIRCARRetencion({ ...record, regimen: null }).split(',')[9]).toBe('001');
  });
});
