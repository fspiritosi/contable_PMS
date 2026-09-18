import { describe, expect, it } from 'vitest';

import {
  buildMissingLineAccountsMessage,
  buildUnavailableLineAccountsMessage,
  findLinesMissingAccount,
  findLinesWithUnavailableAccount,
  formatAccountLabel,
  resolveLineAccount,
  type LineAccountCheck,
} from './line-accounts';

/**
 * La regla de TSK-721/724: la cuenta la define el ítem, la "Cuenta de
 * ventas/compras por defecto" es respaldo, y sin ninguna la línea no se imputa
 * en silencio.
 */
describe('cuenta efectiva de una línea (TSK-721)', () => {
  it('usa la cuenta del ítem cuando la tiene, aunque exista la por defecto', () => {
    expect(resolveLineAccount('item', 'global')).toBe('item');
  });

  it('cae en la cuenta por defecto cuando el ítem no tiene la suya', () => {
    expect(resolveLineAccount(null, 'global')).toBe('global');
    expect(resolveLineAccount(undefined, 'global')).toBe('global');
  });

  it('sin cuenta del ítem ni por defecto devuelve null', () => {
    expect(resolveLineAccount(undefined, null)).toBeNull();
    expect(resolveLineAccount(null, undefined)).toBeNull();
  });

  /** Un `''` que llegue del formulario o de un select vacío es "sin cuenta", no una cuenta. */
  it('trata la cadena vacía como "sin cuenta"', () => {
    expect(resolveLineAccount('', 'global')).toBe('global');
    expect(resolveLineAccount('', '')).toBeNull();
  });
});

const ACEITE: LineAccountCheck = {
  description: 'Aceite 10W40',
  productName: 'Aceite 10W40',
  itemAccountId: null,
};
const FILTRO: LineAccountCheck = {
  description: 'Filtro',
  productName: 'Filtro',
  itemAccountId: undefined,
};
const RODADO: LineAccountCheck = {
  description: 'Rodado usado',
  productName: 'Rodado usado',
  itemAccountId: 'acc-rodado',
};
/** Línea sin ítem: solo posible en compras (gasto suelto o comprobante importado de AFIP). */
const AFIP: LineAccountCheck = {
  description: 'Compra según comprobante AFIP (IVA 21%)',
  productName: null,
  itemAccountId: null,
};

describe('líneas sin ninguna cuenta contable', () => {
  it('con cuenta por defecto no falta ninguna, aunque los ítems no tengan la suya', () => {
    expect(findLinesMissingAccount([ACEITE, FILTRO, RODADO, AFIP], 'global')).toEqual([]);
  });

  it('sin cuenta por defecto devuelve solo las líneas cuyo ítem no tiene cuenta', () => {
    expect(findLinesMissingAccount([ACEITE, RODADO, FILTRO], null)).toEqual([ACEITE, FILTRO]);
  });

  it('una línea sin ítem aparece cuando no hay cuenta por defecto', () => {
    expect(findLinesMissingAccount([RODADO, AFIP], undefined)).toEqual([AFIP]);
  });

  it('conserva el orden y el objeto original con sus campos extra', () => {
    const lineas = [
      { ...FILTRO, index: 1 },
      { ...RODADO, index: 2 },
      { ...ACEITE, index: 3 },
    ];
    const faltan = findLinesMissingAccount(lineas, null);

    expect(faltan.map((l) => l.index)).toEqual([1, 3]);
    expect(faltan[0]).toBe(lineas[0]);
    expect(faltan[1]).toBe(lineas[2]);
  });

  it('con la lista vacía devuelve un array vacío', () => {
    expect(findLinesMissingAccount([], null)).toEqual([]);
  });
});

describe('mensaje de líneas sin cuenta contable', () => {
  it('venta con varias líneas: texto literal del diseño', () => {
    expect(buildMissingLineAccountsMessage([ACEITE, FILTRO], 'income')).toBe(
      'No se puede confirmar el comprobante: las líneas «Aceite 10W40», «Filtro» no tienen ' +
        'cuenta contable. Asignale una Cuenta de Ingresos al ítem (Ítems → Imputación contable) ' +
        'o configurá la "Cuenta de ventas por defecto" en Contabilidad → Configuración.'
    );
  });

  it('venta: nombra las partes que el usuario tiene que reconocer', () => {
    const mensaje = buildMissingLineAccountsMessage([ACEITE, FILTRO], 'income');

    expect(mensaje).toContain('No se puede confirmar el comprobante');
    expect(mensaje).toContain('«Aceite 10W40», «Filtro»');
    expect(mensaje).toContain('Cuenta de Ingresos');
    expect(mensaje).toContain('Ítems → Imputación contable');
    expect(mensaje).toContain('"Cuenta de ventas por defecto"');
    expect(mensaje).not.toContain('sin ítem');
  });

  it('compra: habla de Cuenta de Egresos y de la "Cuenta de compras por defecto"', () => {
    const mensaje = buildMissingLineAccountsMessage([ACEITE], 'expense');

    expect(mensaje).toContain('Cuenta de Egresos');
    expect(mensaje).toContain('"Cuenta de compras por defecto"');
    expect(mensaje).not.toContain('Cuenta de Ingresos');
    expect(mensaje).not.toContain('ventas por defecto');
  });

  it('compra con una línea sin ítem (AFIP): texto literal del diseño', () => {
    expect(buildMissingLineAccountsMessage([AFIP], 'expense')).toBe(
      'No se puede confirmar el comprobante: la línea «Compra según comprobante AFIP (IVA 21%)» ' +
        '(sin ítem) no tiene cuenta contable. Asignale una Cuenta de Egresos al ítem ' +
        '(Ítems → Imputación contable) o configurá la "Cuenta de compras por defecto" en ' +
        'Contabilidad → Configuración. Las líneas sin ítem solo pueden usar la cuenta por defecto.'
    );
  });

  it('marca "(sin ítem)" solo en las líneas sin producto y agrega la aclaración una sola vez', () => {
    const mensaje = buildMissingLineAccountsMessage([ACEITE, AFIP], 'expense');

    expect(mensaje).toContain(
      '«Aceite 10W40», «Compra según comprobante AFIP (IVA 21%)» (sin ítem)'
    );
    expect(mensaje).not.toContain('«Aceite 10W40» (sin ítem)');
    expect(
      mensaje.match(/Las líneas sin ítem solo pueden usar la cuenta por defecto\./g)
    ).toHaveLength(1);
  });

  it('usa el singular con una línea y el plural con varias', () => {
    expect(buildMissingLineAccountsMessage([FILTRO], 'income')).toContain(
      'la línea «Filtro» no tiene cuenta contable'
    );
    expect(buildMissingLineAccountsMessage([ACEITE, FILTRO], 'income')).toContain(
      'las líneas «Aceite 10W40», «Filtro» no tienen cuenta contable'
    );
  });
});

describe('líneas cuya cuenta efectiva no es imputable hoy', () => {
  const disponibles = new Set(['global', 'acc-ok']);

  it('devuelve la línea con source "item" cuando la cuenta del ítem no está en el set', () => {
    expect(findLinesWithUnavailableAccount([RODADO], 'global', disponibles)).toEqual([
      { line: RODADO, accountId: 'acc-rodado', source: 'item' },
    ]);
  });

  it('devuelve source "default" cuando cae en la cuenta por defecto y esta no está en el set', () => {
    expect(findLinesWithUnavailableAccount([ACEITE, AFIP], 'global-baja', disponibles)).toEqual([
      { line: ACEITE, accountId: 'global-baja', source: 'default' },
      { line: AFIP, accountId: 'global-baja', source: 'default' },
    ]);
  });

  it('no devuelve las líneas cuya cuenta efectiva sí está disponible', () => {
    const ok: LineAccountCheck = { ...RODADO, itemAccountId: 'acc-ok' };

    expect(findLinesWithUnavailableAccount([ok, ACEITE], 'global', disponibles)).toEqual([]);
  });

  /** Las líneas sin ninguna cuenta son de `findLinesMissingAccount`, no de este helper. */
  it('no devuelve las líneas sin ninguna cuenta', () => {
    expect(findLinesWithUnavailableAccount([ACEITE, AFIP], null, disponibles)).toEqual([]);
  });

  it('conserva el orden y el objeto original con sus campos extra', () => {
    const lineas = [
      { ...RODADO, index: 1 },
      { ...ACEITE, index: 2 },
      { ...FILTRO, index: 3 },
    ];
    const result = findLinesWithUnavailableAccount(lineas, 'global-baja', disponibles);

    expect(result.map((r) => r.line.index)).toEqual([1, 2, 3]);
    expect(result[0].line).toBe(lineas[0]);
    expect(result.map((r) => r.source)).toEqual(['item', 'default', 'default']);
  });
});

describe('mensaje de cuenta no disponible', () => {
  it('formatea la cuenta como "código - nombre"', () => {
    expect(formatAccountLabel({ code: '4.1', name: 'Ventas' })).toBe('4.1 - Ventas');
  });

  it('cuenta del ítem dada de baja (venta): texto literal del diseño', () => {
    expect(
      buildUnavailableLineAccountsMessage(
        [{ description: 'Rodado usado', accountLabel: '4.1.9 - Ventas vieja', source: 'item' }],
        'income'
      )
    ).toBe(
      'No se puede confirmar el comprobante: la cuenta 4.1.9 - Ventas vieja del ítem de la línea ' +
        '«Rodado usado» no está activa o no es imputable. Corregila en Ítems → Imputación contable.'
    );
  });

  it('cuenta por defecto no hoja (compra): texto literal del diseño', () => {
    expect(
      buildUnavailableLineAccountsMessage(
        [{ description: 'Gasto suelto', accountLabel: '5.1 - Compras', source: 'default' }],
        'expense'
      )
    ).toBe(
      'No se puede confirmar el comprobante: la cuenta 5.1 - Compras configurada como ' +
        '"Cuenta de compras por defecto" no está activa o no es imputable. ' +
        'Corregila en Contabilidad → Configuración.'
    );
  });

  it('venta con la cuenta por defecto: nombra la "Cuenta de ventas por defecto"', () => {
    const mensaje = buildUnavailableLineAccountsMessage(
      [{ description: 'Filtro', accountLabel: '4.1 - Ventas', source: 'default' }],
      'income'
    );

    expect(mensaje).toContain('configurada como "Cuenta de ventas por defecto"');
    expect(mensaje).toContain('no está activa o no es imputable');
    expect(mensaje).toContain('Corregila en Contabilidad → Configuración');
    expect(mensaje).not.toContain('del ítem');
  });

  it('con varios ítems arma una oración por cada uno, unidas con espacio', () => {
    const mensaje = buildUnavailableLineAccountsMessage(
      [
        { description: 'Rodado usado', accountLabel: '4.1.9 - Ventas vieja', source: 'item' },
        { description: 'Filtro', accountLabel: '4.1 - Ventas', source: 'default' },
      ],
      'income'
    );

    expect(mensaje).toBe(
      'No se puede confirmar el comprobante: la cuenta 4.1.9 - Ventas vieja del ítem de la línea ' +
        '«Rodado usado» no está activa o no es imputable. Corregila en Ítems → Imputación contable. ' +
        'No se puede confirmar el comprobante: la cuenta 4.1 - Ventas configurada como ' +
        '"Cuenta de ventas por defecto" no está activa o no es imputable. ' +
        'Corregila en Contabilidad → Configuración.'
    );
    expect(mensaje.match(/No se puede confirmar el comprobante/g)).toHaveLength(2);
  });
});
