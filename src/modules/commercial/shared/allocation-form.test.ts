import { describe, expect, it } from 'vitest';

import { allocationFieldSchema } from './allocation-form';

const LOGISTICA = '51821449-58e5-421d-91a5-e520bd6a2c51';
const MANTENIMIENTO = 'd843521c-aac6-4be2-a5ab-2fceefb6f3da';

describe('schema del reparto en el formulario', () => {
  it('acepta el reparto vacío', () => {
    expect(allocationFieldSchema.safeParse([]).success).toBe(true);
  });

  it('acepta un reparto que suma 100', () => {
    const reparto = [
      { costCenterId: LOGISTICA, percentage: 60 },
      { costCenterId: MANTENIMIENTO, percentage: 40 },
    ];
    expect(allocationFieldSchema.safeParse(reparto).success).toBe(true);
  });

  it('rechaza un reparto incompleto con un mensaje entendible', () => {
    const resultado = allocationFieldSchema.safeParse([
      { costCenterId: LOGISTICA, percentage: 60 },
    ]);

    expect(resultado.success).toBe(false);
    if (!resultado.success) {
      expect(resultado.error.issues[0].message).toBe('El reparto debe sumar 100%');
    }
  });

  it('rechaza el centro repetido', () => {
    const resultado = allocationFieldSchema.safeParse([
      { costCenterId: LOGISTICA, percentage: 50 },
      { costCenterId: LOGISTICA, percentage: 50 },
    ]);

    expect(resultado.success).toBe(false);
    if (!resultado.success) {
      expect(resultado.error.issues[0].message).toBe(
        'No se puede repetir el mismo centro de costo en una línea'
      );
    }
  });
});
