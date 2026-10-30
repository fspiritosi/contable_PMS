import { describe, expect, it } from 'vitest';

import {
  allowedPurchaseVoucherTypes,
  equivalentPurchaseVoucher,
  purchaseVoucherMismatchMessage,
} from './voucher-rules';

describe('comprobante de compra según la condición IVA del proveedor (TSK-787)', () => {
  it('Monotributista y Exento: solo C, más Gastos Bancarios', () => {
    const expected = ['FACTURA_C', 'NOTA_CREDITO_C', 'NOTA_DEBITO_C', 'GASTOS_BANCARIOS'];
    expect(allowedPurchaseVoucherTypes('MONOTRIBUTISTA')).toEqual(expected);
    expect(allowedPurchaseVoucherTypes('EXENTO')).toEqual(expected);
  });

  it('No Responsable y Consumidor Final tampoco discriminan IVA: solo C', () => {
    expect(allowedPurchaseVoucherTypes('NO_RESPONSABLE')).toContain('FACTURA_C');
    expect(allowedPurchaseVoucherTypes('CONSUMIDOR_FINAL')).not.toContain('FACTURA_A');
  });

  it('Responsable Inscripto: A y B, sin C', () => {
    expect(allowedPurchaseVoucherTypes('RESPONSABLE_INSCRIPTO')).toEqual([
      'FACTURA_A',
      'FACTURA_B',
      'NOTA_CREDITO_A',
      'NOTA_CREDITO_B',
      'NOTA_DEBITO_A',
      'NOTA_DEBITO_B',
      'GASTOS_BANCARIOS',
    ]);
  });

  it('sin condición cargada: todos', () => {
    expect(allowedPurchaseVoucherTypes(null)).toHaveLength(10);
  });

  it('el mensaje nombra la condición y la letra que corresponde', () => {
    expect(purchaseVoucherMismatchMessage('FACTURA_A', 'EXENTO')).toBe(
      'Un proveedor Exento emite comprobantes C: elegí Factura C, Nota de Crédito C o Nota de Débito C.'
    );
    expect(purchaseVoucherMismatchMessage('FACTURA_C', 'RESPONSABLE_INSCRIPTO')).toBe(
      'Un proveedor Responsable Inscripto emite comprobantes A o B, no C.'
    );
    expect(purchaseVoucherMismatchMessage('FACTURA_C', 'MONOTRIBUTISTA')).toBeNull();
    expect(purchaseVoucherMismatchMessage('GASTOS_BANCARIOS', 'MONOTRIBUTISTA')).toBeNull();
    expect(purchaseVoucherMismatchMessage('FACTURA_A', null)).toBeNull();
  });

  it('al cambiar de proveedor se conserva la clase de comprobante con una letra válida', () => {
    expect(equivalentPurchaseVoucher('FACTURA_A', 'MONOTRIBUTISTA')).toBe('FACTURA_C');
    expect(equivalentPurchaseVoucher('NOTA_CREDITO_B', 'EXENTO')).toBe('NOTA_CREDITO_C');
    expect(equivalentPurchaseVoucher('NOTA_DEBITO_C', 'RESPONSABLE_INSCRIPTO')).toBe('NOTA_DEBITO_A');
    expect(equivalentPurchaseVoucher('FACTURA_B', 'RESPONSABLE_INSCRIPTO')).toBe('FACTURA_B');
    expect(equivalentPurchaseVoucher('GASTOS_BANCARIOS', 'EXENTO')).toBe('GASTOS_BANCARIOS');
  });
});
