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
});
