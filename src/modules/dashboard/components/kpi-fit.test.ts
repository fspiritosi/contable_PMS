import { describe, expect, it } from 'vitest';

import { kpiValueFontSize } from './kpi-fit';

describe('kpiValueFontSize', () => {
  it('limita al tamaño máximo y escala con el ancho del contenedor', () => {
    expect(kpiValueFontSize(20)).toBe('min(1.5rem, calc(100cqi / 10.40))');
  });

  it('un valor más largo achica la fuente', () => {
    expect(kpiValueFontSize(11)).toBe('min(1.5rem, calc(100cqi / 5.72))');
  });

  it('no divide por cero con un valor vacío', () => {
    expect(kpiValueFontSize(0)).toBe('min(1.5rem, calc(100cqi / 0.52))');
  });
});
