import { describe, expect, it } from 'vitest';

import { buildWithholdingFiles, type PaymentOrderForExport, type WithholdingForExport } from './build-files';

const field = (record: string, from: number, to: number) => record.slice(from - 1, to);

const wh = (patch: Partial<WithholdingForExport>): WithholdingForExport => ({
  taxType: 'IVA',
  rate: 2,
  amount: 2000,
  certificateNumber: null,
  regimeCode: '499',
  taxableBase: 100000,
  jurisdiction: null,
  ...patch,
});

const order = (withholdings: WithholdingForExport[], patch: Partial<PaymentOrderForExport> = {}): PaymentOrderForExport => ({
  fullNumber: 'OP-00012',
  date: new Date('2026-10-15T15:00:00Z'),
  totalAmount: 121000,
  supplier: { taxId: '30-71234567-8', taxCondition: 'RESPONSABLE_INSCRIPTO' },
  withholdings,
  ...patch,
});

describe('archivos de retenciones de las órdenes de pago (TSK-813)', () => {
  it('cada impuesto va a su archivo: IVA a SIRE F.2005, SUSS a SIRE F.2004, Ganancias a SICORE, IIBB a SIRCAR', () => {
    const files = buildWithholdingFiles(
      [
        order([
          wh({ taxType: 'IVA' }),
          wh({ taxType: 'SUSS', regimeCode: '755', taxableBase: null }),
          wh({ taxType: 'GANANCIAS', regimeCode: '78' }),
          wh({ taxType: 'IIBB', jurisdiction: '904', rate: 1.5, amount: 1500 }),
        ]),
      ],
      '30700000001'
    );

    expect(files.sireIva.registros).toBe(1);
    expect(files.sireIva.content).toHaveLength(305);
    expect(files.sireSuss.content).toHaveLength(191);
    expect(field(files.sireSuss.content, 19, 29)).toBe('30700000001');
    expect(files.sicore.content).toHaveLength(144);
    expect(field(files.sicore.content, 45, 50)).toBe('217078');
    expect(files.sircar).toEqual([
      {
        jurisdiction: '904',
        registros: 1,
        content: '00001,1,1,000000000012,30712345678,15/10/2026,100000.00,1.50,1500.00,499,904',
      },
    ]);
    expect(files.incomplete).toEqual([]);
  });

  it('SIRCAR: un archivo por jurisdicción, ordenados, con el renglón numerado en cada uno', () => {
    const files = buildWithholdingFiles(
      [
        order([wh({ taxType: 'IIBB', jurisdiction: '921', regimeCode: null })]),
        order([
          wh({ taxType: 'IIBB', jurisdiction: '904', certificateNumber: 'C-0045' }),
          wh({ taxType: 'IIBB', jurisdiction: '921', regimeCode: null }),
        ]),
      ],
      null
    );

    expect(files.sircar.map((f) => [f.jurisdiction, f.registros])).toEqual([
      ['904', 1],
      ['921', 2],
    ]);
    const santaFe = files.sircar[1].content.split('\r\n');
    expect(santaFe.map((line) => line.split(',')[0])).toEqual(['00001', '00002']);
    expect(santaFe[0].split(',')[9]).toBe('001'); // sin régimen definido
    // Con certificado cargado, el número es el del certificado.
    expect(files.sircar[0].content.split(',')[3]).toBe('000000000045');
  });

  it('una retención sin los datos que pide su archivo queda afuera y se lista para completarla', () => {
    const files = buildWithholdingFiles(
      [
        order([
          wh({ taxType: 'IVA', regimeCode: null, taxableBase: null }),
          wh({ taxType: 'IIBB', jurisdiction: null }),
          wh({ taxType: 'SUSS', regimeCode: '755' }),
        ]),
        order([wh({ taxType: 'GANANCIAS' })], { fullNumber: 'OP-00013', supplier: null }),
      ],
      null
    );

    expect(files.sireIva.registros + files.sireSuss.registros + files.sicore.registros).toBe(0);
    expect(files.sircar).toEqual([]);
    expect(files.incomplete).toEqual([
      { paymentOrder: 'OP-00012', taxType: 'IVA', missing: ['régimen', 'base imponible'] },
      { paymentOrder: 'OP-00012', taxType: 'IIBB', missing: ['jurisdicción'] },
      { paymentOrder: 'OP-00012', taxType: 'SUSS', missing: ['CUIT de la empresa'] },
      { paymentOrder: 'OP-00013', taxType: 'GANANCIAS', missing: ['CUIT del proveedor'] },
    ]);
  });

  it('la fecha es el día de Argentina: una OP de las 23:30 del 31/10 no pasa al 01/11', () => {
    const files = buildWithholdingFiles(
      [order([wh({ taxType: 'IVA' })], { date: new Date('2026-11-01T02:30:00Z') })],
      null
    );
    expect(field(files.sireIva.content, 47, 56)).toBe('31/10/2026');
  });

  it('condición del retenido: inscripto si es Responsable Inscripto, si no "no inscripto"', () => {
    const monotributo = { taxId: '20111111112', taxCondition: 'MONOTRIBUTISTA' as const };
    const files = buildWithholdingFiles(
      [
        order([wh({ taxType: 'GANANCIAS', regimeCode: '78' })]),
        order([wh({ taxType: 'GANANCIAS', regimeCode: '78' }), wh({ taxType: 'IVA', regimeCode: '831' })], {
          supplier: monotributo,
        }),
      ],
      null
    );

    expect(files.sicore.content.split('\r\n').map((r) => field(r, 76, 77))).toEqual(['01', '02']);
    expect(field(files.sireIva.content, 57, 58)).toBe('02'); // el régimen 831 pide la condición
  });
});
