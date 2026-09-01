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
  const aporte = {
    type: 'PARTNER_CONTRIBUTION' as const,
    date: '2026-02-20',
    amount: '1200000',
    description: 'aporte para pagar facturas',
    sourceFund: '',
    destinationFund: `BANK:${uuid}`,
    partnerId: '',
  };

  it('acepta un aporte con banco de destino', () => {
    expect(fundMovementSchema.safeParse(aporte).success).toBe(true);
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

const uuidCuenta = '11111111-1111-4111-8111-111111111111';
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
    { accountId: uuidCuenta, description: 'Sircreb IIBB', amount: '302574.16' },
    { accountId: uuidCuenta, description: 'Impuesto a los débitos', amount: '1434154.28' },
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

  it('señala el concepto sin cuenta', () => {
    const result = fundMovementSchema.safeParse({
      ...gastosBancarios,
      lines: [gastosBancarios.lines[0], { accountId: '', description: 'X', amount: '10' }],
    });

    expect(result.success).toBe(false);
    // Con `.uuid()` en `accountId` (hallazgo de revisión final, TSK-585), una
    // cuenta vacía también incumple el formato: `safeParse` reporta ese
    // problema además del de `validateLines`, así que se busca el mensaje de
    // dominio entre todos los issues en vez de asumir que es el primero. El
    // combobox de conceptos (`_FundMovementLinesField`) solo lee el error de
    // raíz de la línea, así que en la UI el usuario sigue viendo únicamente
    // este mensaje.
    expect(result.error?.issues.some((i) => i.message === 'Elegí la cuenta contable del concepto')).toBe(
      true
    );
  });

  /**
   * Regresión: `accountId` no tenía `.uuid()`, a diferencia de `partnerId`. Un
   * id malformado (payload manipulado, o un bug en otro punto del formulario)
   * llegaba hasta Prisma y explotaba con un P2023 que el usuario veía como
   * "Ocurrió un error inesperado" en vez de un mensaje útil (hallazgo de
   * revisión final, TSK-585).
   */
  it('rechaza un id de cuenta con formato inválido', () => {
    const result = fundMovementSchema.safeParse({
      ...gastosBancarios,
      lines: [{ accountId: 'no-es-un-uuid', description: 'X', amount: '10' }],
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues.some((i) => i.message === 'Cuenta contable inválida')).toBe(true);
  });

  /**
   * Regresión: no había tope de cantidad de conceptos. Un payload con miles
   * de líneas generaba un asiento de miles de líneas (hallazgo de revisión
   * final, TSK-585).
   */
  it('rechaza más de 100 conceptos, pero acepta exactamente 100', () => {
    const unConcepto = { accountId: uuidCuenta, description: 'Concepto', amount: '10' };

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
    partnerId: '',
  };

  it('un aporte sigue siendo válido sin líneas', () => {
    expect(fundMovementSchema.safeParse(aporte).success).toBe(true);
  });

  it('una transferencia sigue siendo válida sin líneas', () => {
    const transferencia = {
      ...aporte,
      type: 'ACCOUNT_TRANSFER' as const,
      sourceFund: `BANK:${uuidBanco}`,
      destinationFund: `CASH:${uuidCuenta}`,
    };

    expect(fundMovementSchema.safeParse(transferencia).success).toBe(true);
  });
});
