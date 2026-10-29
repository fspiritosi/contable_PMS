import { describe, expect, it } from 'vitest';

import { formatAlicuota, formatComprasAlicuota, formatComprasCabecera, formatVentasCabecera } from './formatters';
import type { LibroIVACabecera } from './types';

/** Campo del registro por posiciones 1-based e inclusivas, como en el diseño de ARCA. */
const field = (record: string, from: number, to: number) => record.slice(from - 1, to);

const cabecera: LibroIVACabecera = {
  fechaComprobante: '20260915',
  tipoComprobante: 1,
  puntoVenta: 3,
  numeroDesde: 125,
  numeroHasta: 125,
  codigoDocumento: 80,
  numeroDocumento: '30712345678',
  denominacion: 'PEÑA HNOS SA',
  importeTotal: 1331.5,
  importeNoGravado: 10,
  importeExento: 20,
  importePercepcionesIVA: 30,
  importeImpuestosInternos: 40,
  moneda: 'PES',
  tipoCambio: 1,
  cantidadAlicuotas: 2,
  codigoOperacion: ' ',
  importePercepcionesIIBB: 50,
  importePercepcionesMunicipales: 60,
  importeCredFiscal: 210,
  otrosTributos: 0,
};

describe('Libro IVA Digital: diseño de registro de ARCA (TSK-796)', () => {
  it('ventas comprobantes: 266 posiciones con cada importe en su campo', () => {
    const r = formatVentasCabecera(cabecera);
    expect(r).toHaveLength(266);
    expect(field(r, 9, 11)).toBe('001');
    expect(field(r, 17, 36)).toBe('125'.padStart(20, '0'));
    expect(field(r, 37, 56)).toBe('125'.padStart(20, '0'));
    expect(field(r, 59, 78)).toBe('30712345678'.padStart(20, '0'));
    expect(field(r, 79, 108)).toBe('PEÑA HNOS SA'.padEnd(30));
    expect(field(r, 109, 123)).toBe('000000000133150');
    expect(field(r, 124, 138)).toBe('000000000001000'); // no gravado
    expect(field(r, 139, 153)).toBe('0'.repeat(15)); // percepción a no categorizados
    expect(field(r, 154, 168)).toBe('000000000002000'); // exento
    expect(field(r, 169, 183)).toBe('000000000003000'); // percepciones nacionales (IVA)
    expect(field(r, 184, 198)).toBe('000000000005000'); // IIBB
    expect(field(r, 199, 213)).toBe('000000000006000'); // municipales
    expect(field(r, 214, 228)).toBe('000000000004000'); // impuestos internos
    expect(field(r, 229, 231)).toBe('PES');
    expect(field(r, 232, 241)).toBe('0001000000'); // 4 enteros 6 decimales
    expect(field(r, 242, 242)).toBe('2');
    expect(field(r, 259, 266)).toBe('00000000');
  });

  it('compras comprobantes: 325 posiciones con cada importe en su campo', () => {
    const r = formatComprasCabecera(cabecera);
    expect(r).toHaveLength(325);
    expect(field(r, 17, 36)).toBe('125'.padStart(20, '0'));
    expect(field(r, 37, 52)).toBe('0'.repeat(16)); // despacho de importación
    expect(field(r, 53, 54)).toBe('80');
    expect(field(r, 55, 74)).toBe('30712345678'.padStart(20, '0'));
    expect(field(r, 75, 104)).toBe('PEÑA HNOS SA'.padEnd(30));
    expect(field(r, 105, 119)).toBe('000000000133150');
    expect(field(r, 120, 134)).toBe('000000000001000'); // no gravado
    expect(field(r, 135, 149)).toBe('000000000002000'); // exento
    expect(field(r, 150, 164)).toBe('000000000003000'); // percepciones IVA
    expect(field(r, 165, 179)).toBe('0'.repeat(15)); // otros nacionales
    expect(field(r, 180, 194)).toBe('000000000005000'); // IIBB
    expect(field(r, 195, 209)).toBe('000000000006000'); // municipales
    expect(field(r, 210, 224)).toBe('000000000004000'); // impuestos internos
    expect(field(r, 225, 227)).toBe('PES');
    expect(field(r, 228, 237)).toBe('0001000000');
    expect(field(r, 238, 238)).toBe('2');
    expect(field(r, 240, 254)).toBe('000000000021000'); // crédito fiscal computable
    expect(field(r, 270, 280)).toBe('0'.repeat(11));
    expect(field(r, 281, 310)).toBe(' '.repeat(30));
  });

  it('alícuotas: 62 posiciones en ventas y 84 en compras, con el vendedor', () => {
    const base = { tipoComprobante: 1, puntoVenta: 3, numero: 125, importeNeto: 1000, alicuotaIVA: 5, importeIVA: 210 };
    const venta = formatAlicuota(base);
    expect(venta).toHaveLength(62);
    expect(field(venta, 44, 47)).toBe('0005');
    expect(field(venta, 48, 62)).toBe('000000000021000');

    const compra = formatComprasAlicuota({ ...base, codigoDocumento: 80, numeroDocumento: '30712345678' });
    expect(compra).toHaveLength(84);
    expect(field(compra, 29, 30)).toBe('80');
    expect(field(compra, 31, 50)).toBe('30712345678'.padStart(20, '0'));
    expect(field(compra, 51, 65)).toBe('000000000100000');
    expect(field(compra, 66, 69)).toBe('0005');
    expect(field(compra, 70, 84)).toBe('000000000021000');
  });
});
