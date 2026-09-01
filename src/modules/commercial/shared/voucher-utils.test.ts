import { describe, expect, it } from 'vitest';

import { VOUCHER_TYPE_LABELS } from '../features/purchases/features/invoices/shared/validators';
import { isCreditNote, isDebitNote } from './voucher-utils';

describe('clasificación de tipos de comprobante', () => {
  it('reconoce las notas de crédito', () => {
    expect(isCreditNote('NOTA_CREDITO_A')).toBe(true);
    expect(isCreditNote('NOTA_CREDITO_B')).toBe(true);
    expect(isCreditNote('NOTA_CREDITO_C')).toBe(true);
  });

  it('reconoce las notas de débito', () => {
    expect(isDebitNote('NOTA_DEBITO_A')).toBe(true);
    expect(isDebitNote('NOTA_DEBITO_B')).toBe(true);
    expect(isDebitNote('NOTA_DEBITO_C')).toBe(true);
  });

  it('una factura no es ninguna de las dos', () => {
    expect(isCreditNote('FACTURA_A')).toBe(false);
    expect(isDebitNote('FACTURA_A')).toBe(false);
  });
});

/**
 * TSK-585. El resumen bancario se carga como comprobante de compra para poder
 * computar el IVA de los gastos del banco. Es un gasto, no una devolución: el
 * asiento tiene que sumar, y eso depende de que no se lo tome por nota de
 * crédito, que es lo único que invierte débito y crédito.
 */
describe('gastos bancarios (TSK-585)', () => {
  it('está disponible como comprobante de compra', () => {
    expect(VOUCHER_TYPE_LABELS.GASTOS_BANCARIOS).toBe('Gastos Bancarios');
  });

  it('no es una nota de crédito: el asiento suma, no resta', () => {
    expect(isCreditNote('GASTOS_BANCARIOS')).toBe(false);
  });

  it('tampoco es una nota de débito', () => {
    expect(isDebitNote('GASTOS_BANCARIOS')).toBe(false);
  });
});
