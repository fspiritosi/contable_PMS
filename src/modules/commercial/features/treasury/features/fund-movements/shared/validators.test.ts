import moment from 'moment';
import { describe, expect, it } from 'vitest';

import {
  formatFundMovementDate,
  fundMovementSchema,
  parseFundMovementDate,
  parseFundRef,
} from './validators';

/**
 * Regresión de TSK-483: la usuaria cargaba 20/02/2026 y el sistema mostraba
 * 19/02/2026. La fecha se interpretaba en la hora local del servidor (UTC en el
 * deploy) y se leía en la del navegador (UTC-3), corriéndose un día.
 */
describe('fechas de movimientos de fondos', () => {
  it('conserva el día elegido al guardarlo y volver a leerlo', () => {
    const guardada = parseFundMovementDate('2026-02-20');

    expect(formatFundMovementDate(guardada)).toBe('20/02/2026');
    expect(formatFundMovementDate(guardada, 'YYYY-MM-DD')).toBe('2026-02-20');
  });

  it('ancla la fecha al mediodía UTC, lejos de los bordes del día', () => {
    // Con margen de 12 horas, ningún huso horario del planeta (UTC-12 a UTC+14)
    // puede desplazar la fecha al día anterior o al siguiente.
    expect(parseFundMovementDate('2026-02-20').toISOString()).toBe('2026-02-20T12:00:00.000Z');
  });

  it('se lee igual sin importar la zona horaria del servidor que la guardó', () => {
    // El deploy corre en UTC, pero un entorno local puede estar en UTC-3.
    // La fecha resultante debe ser la misma en ambos casos.
    const original = process.env.TZ;

    try {
      const guardadas = ['UTC', 'America/Argentina/Buenos_Aires', 'Asia/Kolkata'].map((tz) => {
        process.env.TZ = tz;
        return parseFundMovementDate('2026-02-20').toISOString();
      });

      expect(new Set(guardadas).size).toBe(1);
      expect(guardadas[0]).toBe('2026-02-20T12:00:00.000Z');
    } finally {
      process.env.TZ = original;
    }
  });

  it('leerla en hora local es lo que la corría un día (el bug original)', () => {
    const guardada = parseFundMovementDate('2026-02-20');

    // Cómo se lee ahora: en UTC, conserva el día elegido.
    expect(formatFundMovementDate(guardada)).toBe('20/02/2026');

    // Anclarla al mediodía deja 12 h de margen a cada lado, así que ni siquiera
    // una lectura local en UTC-3 (Argentina) la desplaza.
    expect(moment(guardada).utcOffset(-180).format('DD/MM/YYYY')).toBe('20/02/2026');

    // En cambio, con el parseo anterior (medianoche) sí se corría al día previo.
    const comoAntes = moment.utc('2026-02-20', 'YYYY-MM-DD').toDate();
    expect(moment(comoAntes).utcOffset(-180).format('DD/MM/YYYY')).toBe('19/02/2026');
  });

  it('respeta el cambio de año', () => {
    expect(formatFundMovementDate(parseFundMovementDate('2026-01-01'))).toBe('01/01/2026');
    expect(formatFundMovementDate(parseFundMovementDate('2025-12-31'))).toBe('31/12/2025');
  });

  it('respeta el 29 de febrero de un año bisiesto', () => {
    expect(formatFundMovementDate(parseFundMovementDate('2028-02-29'))).toBe('29/02/2028');
  });
});

describe('parseFundRef', () => {
  it('reconoce bancos y cajas', () => {
    const id = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';

    expect(parseFundRef(`BANK:${id}`)).toEqual({ kind: 'BANK', id });
    expect(parseFundRef(`CASH:${id}`)).toEqual({ kind: 'CASH', id });
  });

  it('rechaza referencias mal formadas', () => {
    expect(parseFundRef('')).toBeNull();
    expect(parseFundRef('BANK:no-es-un-uuid')).toBeNull();
    expect(parseFundRef('OTRO:3f2504e0-4f89-11d3-9a0c-0305e82c3301')).toBeNull();
  });
});

describe('fundMovementSchema', () => {
  const uuid = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';
  const uuidSocio = '22222222-2222-4222-8222-222222222222';
  const aporte = {
    type: 'PARTNER_CONTRIBUTION' as const,
    date: '2026-02-20',
    amount: '1200000',
    description: 'aporte para pagar facturas',
    sourceFund: '',
    destinationFund: `BANK:${uuid}`,
    // TSK-717: el socio pasó a ser obligatorio en aporte y retiro, porque
    // define la cuenta del asiento. Sin un uuid acá, los casos que siguen
    // fallarían por la razón equivocada.
    partnerId: uuidSocio,
  };

  it('acepta un aporte con banco de destino', () => {
    expect(fundMovementSchema.safeParse(aporte).success).toBe(true);
  });

  /**
   * TSK-717: el socio deja de ser informativo. Aporte y retiro lo exigen
   * (la cuenta del asiento sale de él); transferencia y gastos bancarios no
   * lo usan y siguen mandando ''.
   */
  it('exige el socio en un aporte', () => {
    const result = fundMovementSchema.safeParse({ ...aporte, partnerId: '' });

    expect(result.success).toBe(false);
    const issue = result.error?.issues.find((i) => i.path[0] === 'partnerId');
    expect(issue?.path).toEqual(['partnerId']);
    expect(issue?.message).toBe('Seleccioná el socio');
  });

  it('exige el socio en un retiro', () => {
    const result = fundMovementSchema.safeParse({
      ...aporte,
      type: 'PARTNER_WITHDRAWAL',
      sourceFund: `BANK:${uuid}`,
      destinationFund: '',
      partnerId: '',
    });

    expect(result.success).toBe(false);
    const issue = result.error?.issues.find((i) => i.path[0] === 'partnerId');
    expect(issue?.path).toEqual(['partnerId']);
    expect(issue?.message).toBe('Seleccioná el socio');
  });

  it('una transferencia no exige socio', () => {
    const result = fundMovementSchema.safeParse({
      ...aporte,
      type: 'ACCOUNT_TRANSFER',
      sourceFund: `CASH:${uuid}`,
      destinationFund: `BANK:${uuid}`,
      partnerId: '',
    });

    expect(result.success).toBe(true);
  });

  it('un gasto bancario no exige socio', () => {
    const result = fundMovementSchema.safeParse({
      type: 'BANK_CHARGES',
      date: '2026-02-20',
      description: 'Gastos bancarios',
      sourceFund: `BANK:${uuid}`,
      destinationFund: '',
      partnerId: '',
      lines: [{ conceptId: uuid, description: 'Comisión', amount: '10' }],
    });

    expect(result.success).toBe(true);
  });

  it('exige el destino en un aporte', () => {
    const result = fundMovementSchema.safeParse({ ...aporte, destinationFund: '' });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['destinationFund']);
  });

  it('rechaza una transferencia hacia la misma cuenta', () => {
    const result = fundMovementSchema.safeParse({
      ...aporte,
      type: 'ACCOUNT_TRANSFER',
      sourceFund: `BANK:${uuid}`,
      destinationFund: `BANK:${uuid}`,
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues.at(-1)?.message).toBe('El destino debe ser distinto del origen');
  });

  it('rechaza montos que no son positivos', () => {
    expect(fundMovementSchema.safeParse({ ...aporte, amount: '0' }).success).toBe(false);
    expect(fundMovementSchema.safeParse({ ...aporte, amount: '-5' }).success).toBe(false);
    expect(fundMovementSchema.safeParse({ ...aporte, amount: '1.234' }).success).toBe(false);
  });

  /**
   * Regresión: `amount` era `.min(1)` en el schema base para los cuatro tipos,
   * y al volverlo opcional (TSK-585, para que BANK_CHARGES no lo necesite) el
   * "requerido" pasó a un `superRefine` condicionado por tipo. Sin este test,
   * un tipeo en esa condición podría dejar a los tres tipos que sí lo usan
   * aceptando un monto vacío sin que ningún test lo note.
   */
  it('exige el monto en los tipos que no son BANK_CHARGES, ausente o vacío', () => {
    const sinAmount: Partial<typeof aporte> = { ...aporte };
    delete sinAmount.amount;

    for (const bad of [sinAmount, { ...aporte, amount: '' }]) {
      const result = fundMovementSchema.safeParse(bad);
      expect(result.success).toBe(false);
      expect(result.error?.issues.some((i) => i.path[0] === 'amount')).toBe(true);
      expect(result.error?.issues.find((i) => i.path[0] === 'amount')?.message).toBe(
        'El monto es requerido'
      );
    }

    for (const type of ['PARTNER_WITHDRAWAL', 'ACCOUNT_TRANSFER'] as const) {
      const result = fundMovementSchema.safeParse({ ...aporte, type, amount: undefined });
      expect(result.success).toBe(false);
      expect(result.error?.issues.some((i) => i.path[0] === 'amount')).toBe(true);
    }
  });
});

import { FUND_MOVEMENT_TYPE_LABELS } from './validators';

const uuidConcepto = '11111111-1111-4111-8111-111111111111';
const uuidBanco = '33333333-3333-4333-8333-333333333333';

const gastosBancarios = {
  type: 'BANK_CHARGES' as const,
  date: '2026-07-31',
  amount: '0',
  description: 'Gastos e impuestos de julio',
  sourceFund: `BANK:${uuidBanco}`,
  destinationFund: '',
  partnerId: '',
  lines: [
    { conceptId: uuidConcepto, description: 'Sircreb IIBB', amount: '302574.16' },
    { conceptId: uuidConcepto, description: '', amount: '1434154.28' },
  ],
};

describe('gastos e impuestos bancarios (TSK-585)', () => {
  it('está entre los tipos disponibles, con su etiqueta', () => {
    expect(FUND_MOVEMENT_TYPE_LABELS.BANK_CHARGES).toBe('Gastos e impuestos bancarios');
  });

  it('acepta un movimiento con conceptos y origen', () => {
    expect(fundMovementSchema.safeParse(gastosBancarios).success).toBe(true);
  });

  /**
   * Este tipo no usa "amount" -lo calcula el servidor sumando los conceptos-
   * así que no debe pedirlo ni con formato ni ausente. Cubre el hallazgo de
   * la revisión: el schema exigía `amount` para los cuatro tipos aunque
   * BANK_CHARGES nunca lo mostrara en pantalla, y el único síntoma visible
   * era un botón "Guardar" que no hacía nada.
   */
  it('no exige el monto: ni vacío, ni ausente, ni con cualquier formato', () => {
    expect(fundMovementSchema.safeParse({ ...gastosBancarios, amount: '' }).success).toBe(true);

    const sinAmount: Partial<typeof gastosBancarios> = { ...gastosBancarios };
    delete sinAmount.amount;
    expect(fundMovementSchema.safeParse(sinAmount).success).toBe(true);

    expect(
      fundMovementSchema.safeParse({ ...gastosBancarios, amount: 'no-es-un-numero' }).success
    ).toBe(true);
  });

  it('exige el banco o caja de donde sale la plata', () => {
    const result = fundMovementSchema.safeParse({ ...gastosBancarios, sourceFund: '' });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['sourceFund']);
  });

  it('exige al menos un concepto', () => {
    const result = fundMovementSchema.safeParse({ ...gastosBancarios, lines: [] });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe('Agregá al menos un concepto');
  });

  it('señala la línea sin concepto (TSK-791)', () => {
    const result = fundMovementSchema.safeParse({
      ...gastosBancarios,
      lines: [gastosBancarios.lines[0], { conceptId: '', description: 'X', amount: '10' }],
    });

    expect(result.success).toBe(false);
    // Un concepto vacío incumple el `.uuid()` y además `validateLines`: los dos
    // dicen lo mismo, y al menos uno cae en la línea 1.
    expect(
      result.error?.issues.some(
        (i) => i.message === 'Elegí el concepto' && i.path[0] === 'lines' && i.path[1] === 1
      )
    ).toBe(true);
  });

  it('el detalle de la línea es opcional (TSK-791)', () => {
    const result = fundMovementSchema.safeParse({
      ...gastosBancarios,
      lines: [{ conceptId: uuidConcepto, description: '', amount: '10' }],
    });

    expect(result.success).toBe(true);
  });

  /**
   * Regresión de TSK-585 (antes sobre `accountId`): un id malformado
   * (payload manipulado) llegaba hasta Prisma y explotaba con un P2023 que el
   * usuario veía como "Ocurrió un error inesperado".
   */
  it('rechaza un id de concepto con formato inválido', () => {
    const result = fundMovementSchema.safeParse({
      ...gastosBancarios,
      lines: [{ conceptId: 'no-es-un-uuid', description: 'X', amount: '10' }],
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues.some((i) => i.message === 'Elegí el concepto')).toBe(true);
  });

  it('la línea ya no acepta cuenta: la resuelve el servidor desde el concepto (TSK-791)', () => {
    const result = fundMovementSchema.safeParse({
      ...gastosBancarios,
      lines: [{ accountId: uuidConcepto, description: 'X', amount: '10' }],
    });

    expect(result.success).toBe(false);
  });

  /**
   * Regresión: no había tope de cantidad de conceptos. Un payload con miles
   * de líneas generaba un asiento de miles de líneas (hallazgo de revisión
   * final, TSK-585).
   */
  it('rechaza más de 100 conceptos, pero acepta exactamente 100', () => {
    const unConcepto = { conceptId: uuidConcepto, description: 'Concepto', amount: '10' };

    const conCien = fundMovementSchema.safeParse({
      ...gastosBancarios,
      lines: Array.from({ length: 100 }, () => unConcepto),
    });
    expect(conCien.success).toBe(true);

    const conCientoUno = fundMovementSchema.safeParse({
      ...gastosBancarios,
      lines: Array.from({ length: 101 }, () => unConcepto),
    });
    expect(conCientoUno.success).toBe(false);
    expect(
      conCientoUno.error?.issues.some(
        (i) => i.message === 'No se pueden cargar más de 100 conceptos por movimiento'
      )
    ).toBe(true);
  });
});

describe('los tipos que ya existían no piden conceptos (regresión TSK-585)', () => {
  const aporte = {
    type: 'PARTNER_CONTRIBUTION' as const,
    date: '2026-07-31',
    amount: '1000.00',
    description: 'Aporte del socio',
    sourceFund: '',
    destinationFund: `BANK:${uuidBanco}`,
    partnerId: '22222222-2222-4222-8222-222222222222', // obligatorio desde TSK-717
  };

  it('un aporte sigue siendo válido sin líneas', () => {
    expect(fundMovementSchema.safeParse(aporte).success).toBe(true);
  });

  it('una transferencia sigue siendo válida sin líneas', () => {
    const transferencia = {
      ...aporte,
      type: 'ACCOUNT_TRANSFER' as const,
      sourceFund: `BANK:${uuidBanco}`,
      destinationFund: `CASH:${uuidConcepto}`,
    };

    expect(fundMovementSchema.safeParse(transferencia).success).toBe(true);
  });
});

describe('concepto del movimiento (TSK-791)', () => {
  const aporte = {
    type: 'PARTNER_CONTRIBUTION' as const,
    date: '2026-07-31',
    amount: '1000.00',
    description: 'Aporte del socio',
    sourceFund: '',
    destinationFund: `BANK:${uuidBanco}`,
    partnerId: '22222222-2222-4222-8222-222222222222',
  };

  // Que sea obligatorio depende de los conceptos activos: lo decide el servidor.
  it('es opcional en el schema: ausente o vacío', () => {
    expect(fundMovementSchema.safeParse(aporte).success).toBe(true);
    expect(fundMovementSchema.safeParse({ ...aporte, conceptId: '' }).success).toBe(true);
  });

  it('si viene, tiene que ser un uuid', () => {
    expect(fundMovementSchema.safeParse({ ...aporte, conceptId: uuidConcepto }).success).toBe(true);
    expect(fundMovementSchema.safeParse({ ...aporte, conceptId: 'no-es-un-uuid' }).success).toBe(
      false
    );
  });
});

describe('compra y venta de inversiones (TSK-793)', () => {
  const uuidTenencia = '44444444-4444-4444-8444-444444444444';
  const compra = {
    type: 'INVESTMENT_PURCHASE' as const,
    date: '2026-07-31',
    amount: '1000.00',
    description: 'Compra de acciones',
    sourceFund: `BANK:${uuidBanco}`,
    destinationFund: '',
    holdingId: uuidTenencia,
  };
  const venta = {
    type: 'INVESTMENT_SALE' as const,
    date: '2026-07-31',
    amount: '1000.00',
    description: 'Venta de acciones',
    sourceFund: '',
    destinationFund: `BANK:${uuidBanco}`,
    holdingId: uuidTenencia,
  };
  const mensajes = (input: object) => {
    const r = fundMovementSchema.safeParse(input);
    return r.success ? [] : r.error.issues.map((i) => i.message);
  };

  it('una compra y una venta válidas pasan', () => {
    expect(fundMovementSchema.safeParse(compra).success).toBe(true);
    expect(fundMovementSchema.safeParse(venta).success).toBe(true);
  });

  it('la compra exige origen', () => {
    expect(mensajes({ ...compra, sourceFund: '' })).toContain(
      'Seleccioná el banco, broker o caja de donde sale la plata'
    );
  });

  it('la venta exige destino', () => {
    expect(mensajes({ ...venta, destinationFund: '' })).toContain(
      'Seleccioná el banco, broker o caja donde entra la plata'
    );
  });

  it('exigen tenencia', () => {
    expect(mensajes({ ...compra, holdingId: '' })).toContain('Seleccioná la tenencia');
    expect(mensajes({ ...venta, holdingId: undefined })).toContain('Seleccioná la tenencia');
  });

  it('la compra valida importe = nominales x precio', () => {
    expect(mensajes({ ...compra, nominals: '10', unitPrice: '100' })).toEqual([]);
    expect(mensajes({ ...compra, nominals: '10', unitPrice: '99' })).toContain(
      'El importe no coincide con nominales × precio'
    );
  });

  it('la comisión de la venta debe ser menor al importe', () => {
    expect(mensajes({ ...venta, commission: '10' })).toEqual([]);
    expect(mensajes({ ...venta, commission: '1000' })).toContain(
      'La comisión no puede ser mayor o igual al importe'
    );
  });

  it('la comisión no puede ser negativa', () => {
    expect(fundMovementSchema.safeParse({ ...compra, commission: '-5' }).success).toBe(false);
  });
});
