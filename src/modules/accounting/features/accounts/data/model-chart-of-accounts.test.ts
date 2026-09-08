import { describe, it, expect } from 'vitest';
import { MODEL_CHART_OF_ACCOUNTS } from './model-chart-of-accounts';
import { isModelFixedAssetCode } from './model-fixed-assets';
import { getParentCode } from '../../../shared/utils/account-code';

describe('MODEL_CHART_OF_ACCOUNTS', () => {
  const byCode = new Map(MODEL_CHART_OF_ACCOUNTS.map((a) => [a.code, a]));

  it('no incluye la raíz de Resultados 4.0.0 (mezcla tipos)', () => {
    expect(byCode.has('4.0.0/00/00')).toBe(false);
  });

  it('las únicas cuentas con padre derivado ausente son las ramas de Resultados', () => {
    // Al omitir 4.0.0, las cuentas 4.1.0 y 4.2.0 quedan con padre derivado (4.0.0)
    // inexistente y se tratan como raíces. No debe haber otras "huérfanas".
    const orphans = MODEL_CHART_OF_ACCOUNTS.filter((account) => {
      const parentCode = getParentCode(account.code);
      return parentCode !== null && !byCode.has(parentCode);
    }).map((a) => a.code);

    expect(orphans.sort()).toEqual(['4.1.0/00/00', '4.2.0/00/00']);
  });

  it('padre e hija siempre comparten el mismo tipo (regla TSK-376)', () => {
    for (const account of MODEL_CHART_OF_ACCOUNTS) {
      const parentCode = getParentCode(account.code);
      const parent = parentCode ? byCode.get(parentCode) : undefined;
      if (parent) {
        expect(parent.type).toBe(account.type);
      }
    }
  });

  it('mapea el tipo según el prefijo del código', () => {
    for (const account of MODEL_CHART_OF_ACCOUNTS) {
      if (account.code.startsWith('1')) expect(account.type).toBe('ASSET');
      else if (account.code.startsWith('2')) expect(account.type).toBe('LIABILITY');
      else if (account.code.startsWith('3')) expect(account.type).toBe('EQUITY');
      else if (account.code.startsWith('4.1')) expect(account.type).toBe('REVENUE');
      else if (account.code.startsWith('4.2')) expect(account.type).toBe('EXPENSE');
      else if (account.code.startsWith('6')) expect(account.type).toBe('EXPENSE');
    }
  });

  it('RECPAM (6.0.0) es EXPENSE e imputable', () => {
    const recpam = byCode.get('6.0.0/00/00');
    expect(recpam).toBeDefined();
    expect(recpam?.type).toBe('EXPENSE');
    expect(recpam?.isLeaf).toBe(true);
  });

  it('no hay códigos duplicados', () => {
    expect(byCode.size).toBe(MODEL_CHART_OF_ACCOUNTS.length);
  });
});

describe('semilla de Bien de Uso en el plan modelo (TSK-618)', () => {
  const marcadas = MODEL_CHART_OF_ACCOUNTS.filter((account) =>
    isModelFixedAssetCode(account.code)
  );

  it('marca exactamente las 31 cuentas del rubro 1.2.2', () => {
    expect(marcadas).toHaveLength(31);
    expect(marcadas.every((account) => account.code.startsWith('1.2.2/'))).toBe(true);
  });

  it('incluye el rubro BIENES DE USO y sus Amortizaciones Acumuladas', () => {
    // La cascada del ABM marca el rubro entero; destildar las regularizadoras
    // es una decisión del usuario, no del dataset.
    const codigos = marcadas.map((account) => account.code);
    expect(codigos).toContain('1.2.2/00/00');
    expect(codigos).toContain('1.2.2/01/03');
  });

  it('no marca ninguna cuenta de otro rubro', () => {
    const noMarcadas = MODEL_CHART_OF_ACCOUNTS.filter(
      (account) => !isModelFixedAssetCode(account.code)
    );
    expect(noMarcadas.some((account) => account.code.startsWith('1.2.2'))).toBe(false);
    expect(isModelFixedAssetCode('1.2.1/00/00')).toBe(false);
    expect(isModelFixedAssetCode('1.2.3/00/00')).toBe(false);
  });

  it('no se confunde con un código que solo comparte el prefijo textual', () => {
    // Sin la barra, un hipotético 1.2.20 entraría por accidente.
    expect(isModelFixedAssetCode('1.2.20/00/00')).toBe(false);
  });
});
