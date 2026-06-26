import { describe, expect, it } from 'vitest';
import {
  getWorkspaceForModule,
  getWorkspaceForRoute,
  resolveAccessibleWorkspaces,
  resolveEffectiveWorkspace,
} from './helpers';

describe('getWorkspaceForModule', () => {
  it('mapea módulos accounting a contable', () => {
    expect(getWorkspaceForModule('accounting')).toBe('contable');
    expect(getWorkspaceForModule('accounting.entries')).toBe('contable');
    expect(getWorkspaceForModule('accounting.settings')).toBe('contable');
  });

  it('mapea el resto a gestion', () => {
    expect(getWorkspaceForModule('commercial.invoices')).toBe('gestion');
    expect(getWorkspaceForModule('employees')).toBe('gestion');
    expect(getWorkspaceForModule('company.general.users')).toBe('gestion');
  });

  it('mapea módulo nulo/indefinido (transversal) a gestion', () => {
    expect(getWorkspaceForModule(null)).toBe('gestion');
    expect(getWorkspaceForModule(undefined)).toBe('gestion');
  });
});

describe('getWorkspaceForRoute', () => {
  it('detecta rutas contables', () => {
    expect(getWorkspaceForRoute('/dashboard/accounting')).toBe('contable');
    expect(getWorkspaceForRoute('/dashboard/accounting/reports')).toBe('contable');
    expect(getWorkspaceForRoute('/dashboard/company/accounting/entries')).toBe('contable');
  });

  it('el resto es gestion', () => {
    expect(getWorkspaceForRoute('/dashboard')).toBe('gestion');
    expect(getWorkspaceForRoute('/dashboard/employees')).toBe('gestion');
    expect(getWorkspaceForRoute('/dashboard/company/general/users')).toBe('gestion');
  });
});

describe('resolveAccessibleWorkspaces', () => {
  it('devuelve solo los espacios con permiso explícito', () => {
    expect(resolveAccessibleWorkspaces({ gestion: true, contable: false })).toEqual(['gestion']);
    expect(resolveAccessibleWorkspaces({ gestion: false, contable: true })).toEqual(['contable']);
    expect(resolveAccessibleWorkspaces({ gestion: true, contable: true })).toEqual([
      'gestion',
      'contable',
    ]);
  });

  it('backward-compat: sin ningún permiso devuelve ambos', () => {
    expect(resolveAccessibleWorkspaces({ gestion: false, contable: false })).toEqual([
      'gestion',
      'contable',
    ]);
  });
});

describe('resolveEffectiveWorkspace', () => {
  it('usa el espacio de la ruta si es accesible', () => {
    expect(
      resolveEffectiveWorkspace('/dashboard/accounting', ['gestion', 'contable'], 'gestion'),
    ).toBe('contable');
  });

  it('cae al guardado si la ruta no es accesible', () => {
    expect(resolveEffectiveWorkspace('/dashboard/accounting', ['gestion'], 'gestion')).toBe(
      'gestion',
    );
  });

  it('cae al primer accesible si no hay guardado válido', () => {
    expect(resolveEffectiveWorkspace('/dashboard/employees', ['contable'], null)).toBe('contable');
  });

  it('cae al primer accesible cuando ni la ruta ni el guardado son accesibles', () => {
    expect(resolveEffectiveWorkspace('/dashboard/accounting', ['gestion'], 'contable')).toBe('gestion');
  });
});
