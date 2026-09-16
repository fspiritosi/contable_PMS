import { describe, expect, it } from 'vitest';

import { getMemberFullName, getMemberInitials } from './member-display';

/**
 * Helpers de identidad de un miembro de la empresa (TSK-692).
 *
 * Reproducen la lógica que estaba duplicada inline en `users/columns.tsx` y
 * `_EditUserRoleModal.tsx`: nombre completo con `trim()` y fallback
 * "Sin nombre"; iniciales en mayúsculas con fallback "?".
 */
describe('nombre completo de un miembro (TSK-692)', () => {
  it('une nombre y apellido con un espacio', () => {
    expect(getMemberFullName({ firstName: 'Ana', lastName: 'Pérez' })).toBe('Ana Pérez');
  });

  it('no deja espacios sobrantes si falta el nombre o el apellido', () => {
    expect(getMemberFullName({ firstName: 'Ana', lastName: '' })).toBe('Ana');
    expect(getMemberFullName({ firstName: '', lastName: 'Pérez' })).toBe('Pérez');
    expect(getMemberFullName({ firstName: 'Ana', lastName: null })).toBe('Ana');
    expect(getMemberFullName({ firstName: undefined, lastName: 'Pérez' })).toBe('Pérez');
  });

  it('cae en "Sin nombre" si no hay nombre ni apellido', () => {
    expect(getMemberFullName({ firstName: '', lastName: '' })).toBe('Sin nombre');
    expect(getMemberFullName({ firstName: null, lastName: null })).toBe('Sin nombre');
    expect(getMemberFullName({ firstName: undefined, lastName: undefined })).toBe('Sin nombre');
    expect(getMemberFullName({})).toBe('Sin nombre');
  });

  it('recorta los espacios que vengan de más en los propios campos', () => {
    expect(getMemberFullName({ firstName: ' Ana', lastName: 'Pérez ' })).toBe('Ana Pérez');
  });
});

describe('iniciales de un miembro (TSK-692)', () => {
  it('toma la primera letra del nombre y del apellido', () => {
    expect(getMemberInitials({ firstName: 'Ana', lastName: 'Pérez' })).toBe('AP');
  });

  it('usa una sola letra si falta el nombre o el apellido', () => {
    expect(getMemberInitials({ firstName: 'Ana', lastName: '' })).toBe('A');
    expect(getMemberInitials({ firstName: '', lastName: 'Pérez' })).toBe('P');
    expect(getMemberInitials({ firstName: 'Ana', lastName: null })).toBe('A');
    expect(getMemberInitials({ firstName: undefined, lastName: 'Pérez' })).toBe('P');
  });

  it('devuelve las iniciales en mayúsculas', () => {
    expect(getMemberInitials({ firstName: 'ana', lastName: 'pérez' })).toBe('AP');
  });

  it('cae en "?" si no hay nombre ni apellido', () => {
    expect(getMemberInitials({ firstName: '', lastName: '' })).toBe('?');
    expect(getMemberInitials({ firstName: null, lastName: null })).toBe('?');
    expect(getMemberInitials({ firstName: undefined, lastName: undefined })).toBe('?');
    expect(getMemberInitials({})).toBe('?');
  });
});
