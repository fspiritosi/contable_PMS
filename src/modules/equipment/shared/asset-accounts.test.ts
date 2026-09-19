import { describe, expect, it } from 'vitest';

import {
  ASSET_ACCOUNT_KEYS,
  ASSET_ACCOUNT_LABELS,
  ASSET_ACCOUNT_SOURCE_LABELS,
  OPERATION_LABELS,
  REQUIRED_ACCOUNTS_BY_OPERATION,
  buildMissingAssetAccountsMessage,
  buildMissingDisposalAccountMessage,
  buildUnavailableAssetAccountMessage,
  findMissingAssetAccounts,
  formatAccountLabel,
  resolveAssetAccounts,
  type ResolvedAssetAccounts,
} from './asset-accounts';

/**
 * La regla de TSK-724c: la cuenta la define el tipo de equipo, la depreciación
 * del equipo puede sobreescribirla y la "por defecto" de Ajustes contables es
 * respaldo. Cada una de las tres cuentas se resuelve por separado.
 */
describe('cuentas efectivas de un equipo (TSK-724c)', () => {
  it('resuelve cada cuenta por separado: depreciación > tipo > por defecto', () => {
    const resolved = resolveAssetAccounts({
      depreciation: { accumulatedDepreciationAccountId: 'D' },
      type: { accumulatedDepreciationAccountId: 'T', depreciationExpenseAccountId: 'TG' },
      settings: {
        fixedAssetAccountId: 'S',
        accumulatedDepreciationAccountId: 'SA',
        depreciationExpenseAccountId: 'SG',
      },
    });

    expect(resolved.accumulatedDepreciation).toEqual({ accountId: 'D', source: 'depreciation' });
    expect(resolved.depreciationExpense).toEqual({ accountId: 'TG', source: 'type' });
    expect(resolved.fixedAsset).toEqual({ accountId: 'S', source: 'default' });
  });

  it('sin ninguna fuente devuelve las tres en null', () => {
    expect(resolveAssetAccounts({})).toEqual({
      fixedAsset: null,
      accumulatedDepreciation: null,
      depreciationExpense: null,
    });
    expect(resolveAssetAccounts({ depreciation: null, type: null, settings: undefined })).toEqual({
      fixedAsset: null,
      accumulatedDepreciation: null,
      depreciationExpense: null,
    });
  });

  /** Un `''` que llegue de un select vacío es "sin cuenta", no una cuenta. */
  it('trata la cadena vacía como ausente y sigue buscando en la fuente siguiente', () => {
    const resolved = resolveAssetAccounts({
      depreciation: { fixedAssetAccountId: '' },
      type: { fixedAssetAccountId: '', accumulatedDepreciationAccountId: '' },
      settings: { fixedAssetAccountId: 'S' },
    });

    expect(resolved.fixedAsset).toEqual({ accountId: 'S', source: 'default' });
    expect(resolved.accumulatedDepreciation).toBeNull();
  });

  it('expone las tres claves en orden estable', () => {
    expect(ASSET_ACCOUNT_KEYS).toEqual([
      'fixedAsset',
      'accumulatedDepreciation',
      'depreciationExpense',
    ]);
  });
});

const NONE: ResolvedAssetAccounts = {
  fixedAsset: null,
  accumulatedDepreciation: null,
  depreciationExpense: null,
};

describe('cuentas faltantes por operación', () => {
  it('la amortización necesita gasto y acumulada; Bienes de Uso no importa', () => {
    expect(REQUIRED_ACCOUNTS_BY_OPERATION.depreciation).toEqual([
      'accumulatedDepreciation',
      'depreciationExpense',
    ]);
    expect(findMissingAssetAccounts(NONE, 'depreciation')).toEqual([
      'accumulatedDepreciation',
      'depreciationExpense',
    ]);
    expect(
      findMissingAssetAccounts(
        {
          ...NONE,
          accumulatedDepreciation: { accountId: 'A', source: 'type' },
          depreciationExpense: { accountId: 'G', source: 'default' },
        },
        'depreciation'
      )
    ).toEqual([]);
  });

  it('la baja y el ajuste de valor necesitan Bienes de Uso y acumulada; el gasto no importa', () => {
    expect(REQUIRED_ACCOUNTS_BY_OPERATION.disposal).toEqual([
      'fixedAsset',
      'accumulatedDepreciation',
    ]);
    expect(REQUIRED_ACCOUNTS_BY_OPERATION.adjustment).toEqual([
      'fixedAsset',
      'accumulatedDepreciation',
    ]);

    const soloGasto: ResolvedAssetAccounts = {
      ...NONE,
      depreciationExpense: { accountId: 'G', source: 'type' },
    };
    expect(findMissingAssetAccounts(soloGasto, 'disposal')).toEqual([
      'fixedAsset',
      'accumulatedDepreciation',
    ]);
    expect(findMissingAssetAccounts(soloGasto, 'adjustment')).toEqual([
      'fixedAsset',
      'accumulatedDepreciation',
    ]);
  });

  it('devuelve solo la que falta, en el orden de la operación', () => {
    expect(
      findMissingAssetAccounts(
        { ...NONE, accumulatedDepreciation: { accountId: 'A', source: 'depreciation' } },
        'disposal'
      )
    ).toEqual(['fixedAsset']);
  });
});

describe('mensajes al usuario', () => {
  const vehicleLabel = '001 - AB123CD';
  const typeName = 'Camión';

  it('nombra la operación, el equipo, la cuenta que falta y los tres lugares donde configurarla', () => {
    const message = buildMissingAssetAccountsMessage({
      operation: 'depreciation',
      vehicleLabel,
      typeName,
      missing: ['accumulatedDepreciation'],
    });

    expect(message).toContain(
      'No se puede contabilizar la amortización del equipo «001 - AB123CD»'
    );
    expect(message).toContain('no tiene cuenta de Amortización acumulada.');
    expect(message).toContain(
      'Asignala en la depreciación del equipo (pestaña Depreciación → Cuentas contables)'
    );
    expect(message).toContain('en el tipo de equipo «Camión» (Empresa → Tipos de Equipo)');
    expect(message).toContain(
      'configurá "Amortización acumulada por defecto" en Contabilidad → Configuración'
    );
    expect(message).not.toContain(' ni de ');
  });

  it('con dos faltantes usa plural y nombra ambas cuentas y ambos ajustes', () => {
    const message = buildMissingAssetAccountsMessage({
      operation: 'depreciation',
      vehicleLabel,
      typeName,
      missing: ['accumulatedDepreciation', 'depreciationExpense'],
    });

    expect(message).toContain(
      'no tiene cuenta de Amortización acumulada ni de Gasto de amortización.'
    );
    expect(message).toContain('Asignalas en la depreciación del equipo');
    expect(message).toContain(
      'configurá "Amortización acumulada por defecto" y "Gasto de amortización por defecto" en Contabilidad → Configuración'
    );
  });

  it('nombra la baja y el ajuste de valor según la operación', () => {
    expect(OPERATION_LABELS).toEqual({
      depreciation: 'la amortización',
      disposal: 'la baja',
      adjustment: 'el ajuste de valor',
    });

    expect(
      buildMissingAssetAccountsMessage({
        operation: 'disposal',
        vehicleLabel,
        typeName,
        missing: ['fixedAsset'],
      })
    ).toContain(
      'No se puede contabilizar la baja del equipo «001 - AB123CD»: no tiene cuenta de Bienes de Uso.'
    );

    expect(
      buildMissingAssetAccountsMessage({
        operation: 'adjustment',
        vehicleLabel,
        typeName,
        missing: ['fixedAsset'],
      })
    ).toContain('No se puede contabilizar el ajuste de valor del equipo «001 - AB123CD»');
  });

  const accountLabel = '1.2.2/04/03 - Amortizac. Acumuladas Rodados';

  it('cuenta no imputable del tipo de equipo: dice de dónde salió y dónde corregirla', () => {
    const message = buildUnavailableAssetAccountMessage({
      operation: 'disposal',
      vehicleLabel,
      typeName,
      key: 'accumulatedDepreciation',
      accountLabel,
      source: 'type',
    });

    expect(message).toContain('No se puede contabilizar la baja del equipo «001 - AB123CD»');
    expect(message).toContain(
      `la cuenta ${accountLabel} (Amortización acumulada, del tipo de equipo «Camión») no está activa o no es imputable`
    );
    expect(message).toContain('Corregila en Empresa → Tipos de Equipo.');
  });

  it('cuenta no imputable de la depreciación del equipo: manda a la pestaña Depreciación', () => {
    const message = buildUnavailableAssetAccountMessage({
      operation: 'depreciation',
      vehicleLabel,
      typeName,
      key: 'depreciationExpense',
      accountLabel,
      source: 'depreciation',
    });

    expect(message).toContain(`(Gasto de amortización, de la depreciación del equipo)`);
    expect(message).toContain('Corregila en la pestaña Depreciación del equipo.');
  });

  it('cuenta no imputable por defecto: nombra el ajuste contable y manda a Configuración', () => {
    const message = buildUnavailableAssetAccountMessage({
      operation: 'adjustment',
      vehicleLabel,
      typeName,
      key: 'accumulatedDepreciation',
      accountLabel,
      source: 'default',
    });

    expect(message).toContain(
      '(Amortización acumulada, configurada como "Amortización acumulada por defecto") no está activa o no es imputable'
    );
    expect(message).toContain('Corregila en Contabilidad → Configuración.');
  });

  it('la cuenta de resultado sigue siendo global: falta → Contabilidad → Configuración', () => {
    const message = buildMissingDisposalAccountMessage({ operation: 'disposal', vehicleLabel });

    expect(message).toBe(
      'No se puede contabilizar la baja del equipo «001 - AB123CD»: falta la cuenta ' +
        '"Resultado por venta/baja de Bienes de Uso". Configurala en Contabilidad → Configuración.'
    );
    expect(buildMissingDisposalAccountMessage({ operation: 'adjustment', vehicleLabel })).toContain(
      'No se puede contabilizar el ajuste de valor del equipo'
    );
  });

  it('formatea la cuenta como código - nombre', () => {
    expect(formatAccountLabel({ code: '1.2.2/04/01', name: 'Rodados Valores Originales' })).toBe(
      '1.2.2/04/01 - Rodados Valores Originales'
    );
  });

  it('los labels coinciden con los de Contabilidad → Configuración y la UI', () => {
    expect(ASSET_ACCOUNT_LABELS.fixedAsset).toEqual({
      field: 'Bienes de Uso',
      settingLabel: 'Cuenta de Bienes de Uso por defecto',
    });
    expect(ASSET_ACCOUNT_LABELS.accumulatedDepreciation).toEqual({
      field: 'Amortización acumulada',
      settingLabel: 'Amortización acumulada por defecto',
    });
    expect(ASSET_ACCOUNT_LABELS.depreciationExpense).toEqual({
      field: 'Gasto de amortización',
      settingLabel: 'Gasto de amortización por defecto',
    });
    expect(ASSET_ACCOUNT_SOURCE_LABELS).toEqual({
      depreciation: 'de la depreciación del equipo',
      type: 'del tipo de equipo',
      default: 'por defecto (Ajustes contables)',
    });
  });
});
