import { describe, expect, it } from 'vitest';
import type { BankMovementType } from '@/generated/prisma/enums';
import {
  allowedAccountTypes,
  bankMovementUsage,
  fundMovementUsage,
  validateConceptConfig,
} from './usages';

const BANK_TYPES: BankMovementType[] = [
  'DEPOSIT',
  'WITHDRAWAL',
  'TRANSFER_IN',
  'TRANSFER_OUT',
  'CHECK',
  'DEBIT',
  'FEE',
  'INTEREST',
];

describe('fundMovementUsage', () => {
  it('la transferencia entre cuentas no tiene uso', () => {
    expect(fundMovementUsage('ACCOUNT_TRANSFER')).toBeNull();
  });
  it('mapea los tipos de fondo a su uso', () => {
    expect(fundMovementUsage('BANK_CHARGES')).toBe('FUND_BANK_CHARGES');
    expect(fundMovementUsage('PARTNER_CONTRIBUTION')).toBe('FUND_PARTNER_CONTRIBUTION');
    expect(fundMovementUsage('PARTNER_WITHDRAWAL')).toBe('FUND_PARTNER_WITHDRAWAL');
  });
});

describe('bankMovementUsage', () => {
  it('mapea FEE a BANK_FEE', () => {
    expect(bankMovementUsage('FEE')).toBe('BANK_FEE');
  });
  it('los 8 tipos tienen uso', () => {
    for (const t of BANK_TYPES) expect(bankMovementUsage(t)).toBe(`BANK_${t}`);
  });
});

describe('allowedAccountTypes', () => {
  it('gastos bancarios admite EXPENSE y ASSET', () => {
    expect([...allowedAccountTypes(['FUND_BANK_CHARGES'])].sort()).toEqual(['ASSET', 'EXPENSE']);
  });
  it('intersecta gastos bancarios con comisión bancaria', () => {
    expect(allowedAccountTypes(['FUND_BANK_CHARGES', 'BANK_FEE'])).toEqual(['ASSET']);
  });
  it('aporte de socio con depósito admite ASSET, LIABILITY y EQUITY', () => {
    expect([...allowedAccountTypes(['FUND_PARTNER_CONTRIBUTION', 'BANK_DEPOSIT'])].sort()).toEqual([
      'ASSET',
      'EQUITY',
      'LIABILITY',
    ]);
  });
  it('sin usos devuelve vacío', () => {
    expect(allowedAccountTypes([])).toEqual([]);
  });
});

describe('validateConceptConfig', () => {
  const base = {
    name: 'Comisión',
    usages: ['FUND_BANK_CHARGES'] as const,
    accountMode: 'OWN_ACCOUNT' as const,
    accountId: 'acc-1',
  };
  it('exige nombre', () => {
    expect(validateConceptConfig({ ...base, usages: [...base.usages], name: '  ' })).toBe('NAME_REQUIRED');
  });
  it('exige al menos un uso', () => {
    expect(validateConceptConfig({ ...base, usages: [] })).toBe('NO_USAGES');
  });
  it('permite cuenta del socio solo con aporte y/o retiro', () => {
    expect(
      validateConceptConfig({
        name: 'Aporte',
        usages: ['FUND_PARTNER_CONTRIBUTION', 'FUND_PARTNER_WITHDRAWAL'],
        accountMode: 'PARTNER_ACCOUNT',
        accountId: null,
      })
    ).toBeNull();
    expect(
      validateConceptConfig({
        name: 'Aporte',
        usages: ['FUND_PARTNER_CONTRIBUTION', 'FUND_BANK_CHARGES'],
        accountMode: 'PARTNER_ACCOUNT',
        accountId: null,
      })
    ).toBe('PARTNER_MODE_NOT_ALLOWED');
  });
  it('cuenta propia exige cuenta', () => {
    expect(validateConceptConfig({ ...base, usages: [...base.usages], accountId: null })).toBe('ACCOUNT_REQUIRED');
  });
  it('config válida devuelve null', () => {
    expect(validateConceptConfig({ ...base, usages: [...base.usages] })).toBeNull();
  });
});
