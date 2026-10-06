import moment from 'moment';
import { describe, expect, it } from 'vitest';

import type { FundMovementStatus } from '@/generated/prisma/enums';

import {
  buildFundOptions,
  emptyFundMovementFormValues,
  formResetKey,
  formValuesFromMovement,
  FUND_MOVEMENT_STATUS_LABELS,
  fundMovementStatusVariant,
  fundRefFrom,
  getModalCopy,
  getRowActions,
  getViewSummaryFacts,
  hasAnyRowAction,
  hasDraftActions,
  isSnapshotOption,
  needsMovementDetail,
  shouldCleanupFieldsOnTypeChange,
  withSnapshotOption,
  type FundMovementFormSource,
  type FundMovementLineSource,
  type FundMovementRowActions,
  type RowActionPermissions,
} from './view-mode';

const BANK_ID = '11111111-1111-4111-8111-111111111111';
const CASH_ID = '22222222-2222-4222-8222-222222222222';
const PARTNER_ID = '33333333-3333-4333-8333-333333333333';
const ACCOUNT_A = '44444444-4444-4444-8444-444444444444';
const ACCOUNT_B = '55555555-5555-4555-8555-555555555555';

const ALL: RowActionPermissions = { canView: true, canUpdate: true, canDelete: true };
const NONE: RowActionPermissions = { canView: false, canUpdate: false, canDelete: false };

const EDIT_DESCRIPTION =
  'Se guarda como borrador editable. Al confirmarlo, actualiza el saldo del banco/caja y genera el asiento contable.';

function movementSource(overrides: Partial<FundMovementFormSource> = {}): FundMovementFormSource {
  return {
    type: 'PARTNER_CONTRIBUTION',
    date: new Date('2026-03-01T12:00:00Z'),
    amount: 1500,
    description: 'Aporte inicial',
    fundOutKind: null,
    fundOutId: null,
    fundInKind: 'BANK',
    fundInId: BANK_ID,
    partnerId: PARTNER_ID,
    ...overrides,
  } satisfies FundMovementFormSource;
}

describe('getRowActions', () => {
  it('borrador con todos los permisos → las cuatro acciones', () => {
    expect(getRowActions('DRAFT', ALL)).toEqual({ view: true, confirm: true, edit: true, delete: true });
  });

  it.each<FundMovementStatus>(['CONFIRMED', 'CANCELLED'])('%s con todos los permisos → solo ver', (status) => {
    expect(getRowActions(status, ALL)).toEqual({ view: true, confirm: false, edit: false, delete: false });
  });

  it('borrador solo con view → solo ver', () => {
    expect(getRowActions('DRAFT', { ...NONE, canView: true })).toEqual({
      view: true,
      confirm: false,
      edit: false,
      delete: false,
    });
  });

  it('borrador con view + delete → ver y eliminar', () => {
    expect(getRowActions('DRAFT', { canView: true, canUpdate: false, canDelete: true })).toEqual({
      view: true,
      confirm: false,
      edit: false,
      delete: true,
    });
  });

  it('borrador con update sin view → confirmar y editar, sin ver', () => {
    expect(getRowActions('DRAFT', { ...NONE, canUpdate: true })).toEqual({
      view: false,
      confirm: true,
      edit: true,
      delete: false,
    });
  });

  it('confirmado sin permisos → nada', () => {
    expect(getRowActions('CONFIRMED', NONE)).toEqual({
      view: false,
      confirm: false,
      edit: false,
      delete: false,
    });
  });
});

describe('hasAnyRowAction', () => {
  it('sin permisos → false', () => {
    expect(hasAnyRowAction(NONE)).toBe(false);
  });

  it.each<keyof RowActionPermissions>(['canView', 'canUpdate', 'canDelete'])('solo %s → true', (perm) => {
    expect(hasAnyRowAction({ ...NONE, [perm]: true })).toBe(true);
  });
});

describe('hasDraftActions', () => {
  const base: FundMovementRowActions = { view: true, confirm: false, edit: false, delete: false };

  it('solo ver → false', () => {
    expect(hasDraftActions(base)).toBe(false);
  });

  it('con eliminar → true', () => {
    expect(hasDraftActions({ ...base, delete: true })).toBe(true);
  });

  it('con editar → true', () => {
    expect(hasDraftActions({ ...base, edit: true })).toBe(true);
  });
});

describe('rótulo y variante del estado', () => {
  it.each<[FundMovementStatus, string, string]>([
    ['DRAFT', 'Borrador', 'outline'],
    ['CONFIRMED', 'Confirmado', 'default'],
    ['CANCELLED', 'Anulado', 'secondary'],
  ])('%s → %s / %s', (status, label, variant) => {
    expect(FUND_MOVEMENT_STATUS_LABELS[status]).toBe(label);
    expect(fundMovementStatusVariant(status)).toBe(variant);
  });
});

describe('buildFundOptions', () => {
  it('pone bancos antes que cajas, con su referencia y grupo', () => {
    const options = buildFundOptions(
      [{ id: BANK_ID, label: 'Santander' }],
      [{ id: CASH_ID, label: 'Caja central' }]
    );
    expect(options).toEqual([
      { value: `BANK:${BANK_ID}`, label: 'Santander', group: 'BANK' },
      { value: `CASH:${CASH_ID}`, label: 'Caja central', group: 'CASH' },
    ]);
  });

  it('sin bancos ni cajas → []', () => {
    expect(buildFundOptions([], [])).toEqual([]);
  });
});

describe('withSnapshotOption', () => {
  const options = [
    { value: `BANK:${BANK_ID}`, label: 'Santander' },
    { value: `CASH:${CASH_ID}`, label: 'Caja central' },
  ];

  it('valor en el catálogo → misma referencia', () => {
    expect(withSnapshotOption(options, `BANK:${BANK_ID}`, 'Santander viejo')).toBe(options);
  });

  it('valor fuera del catálogo con rótulo → copia con la opción snapshot al final', () => {
    const result = withSnapshotOption(options, 'CASH:otra', 'Caja cerrada');
    expect(result).not.toBe(options);
    expect(result).toEqual([...options, { value: 'CASH:otra', label: 'Caja cerrada', isSnapshot: true }]);
  });

  it.each([null, '', undefined])('valor fuera del catálogo con rótulo %s → misma referencia', (label) => {
    expect(withSnapshotOption(options, 'CASH:otra', label)).toBe(options);
  });

  it.each([null, '', undefined])('valor %s → misma referencia', (value) => {
    expect(withSnapshotOption(options, value, 'Caja cerrada')).toBe(options);
  });

  it('no muta el array de entrada', () => {
    const copy = [...options];
    withSnapshotOption(options, 'CASH:otra', 'Caja cerrada');
    expect(options).toEqual(copy);
  });
});

describe('isSnapshotOption', () => {
  it('true para la opción agregada y false para una del catálogo', () => {
    const options = [{ value: 'a', label: 'A' }];
    const result = withSnapshotOption(options, 'b', 'B');
    expect(isSnapshotOption(result[1])).toBe(true);
    expect(isSnapshotOption(result[0])).toBe(false);
  });
});

describe('fundRefFrom', () => {
  it('arma la referencia', () => {
    expect(fundRefFrom('BANK', BANK_ID)).toBe(`BANK:${BANK_ID}`);
  });

  it('kind o id null → vacío', () => {
    expect(fundRefFrom(null, BANK_ID)).toBe('');
    expect(fundRefFrom('BANK', null)).toBe('');
  });
});

describe('emptyFundMovementFormValues', () => {
  it('con today explícito devuelve el alta vacía', () => {
    expect(emptyFundMovementFormValues('2026-10-06')).toEqual({
      type: 'PARTNER_CONTRIBUTION',
      date: '2026-10-06',
      amount: '',
      description: '',
      sourceFund: '',
      destinationFund: '',
      partnerId: '',
      lines: [],
    });
  });

  it('cada llamada devuelve un array de líneas nuevo', () => {
    expect(emptyFundMovementFormValues('2026-10-06').lines).not.toBe(
      emptyFundMovementFormValues('2026-10-06').lines
    );
  });

  it('sin argumento usa la fecha de hoy', () => {
    expect(emptyFundMovementFormValues().date).toBe(moment().format('YYYY-MM-DD'));
  });
});

describe('formValuesFromMovement', () => {
  it('aporte: destino desde fundIn, origen vacío, socio', () => {
    expect(formValuesFromMovement(movementSource(), null)).toEqual({
      type: 'PARTNER_CONTRIBUTION',
      date: '2026-03-01',
      amount: '1500',
      description: 'Aporte inicial',
      sourceFund: '',
      destinationFund: `BANK:${BANK_ID}`,
      partnerId: PARTNER_ID,
      lines: [],
    });
  });

  it('retiro: origen desde fundOut y socio', () => {
    const values = formValuesFromMovement(
      movementSource({
        type: 'PARTNER_WITHDRAWAL',
        fundOutKind: 'CASH',
        fundOutId: CASH_ID,
        fundInKind: null,
        fundInId: null,
      }),
      null
    );
    expect(values.sourceFund).toBe(`CASH:${CASH_ID}`);
    expect(values.destinationFund).toBe('');
    expect(values.partnerId).toBe(PARTNER_ID);
  });

  it('transferencia: origen y destino, partnerId null → vacío', () => {
    const values = formValuesFromMovement(
      movementSource({
        type: 'ACCOUNT_TRANSFER',
        fundOutKind: 'BANK',
        fundOutId: BANK_ID,
        fundInKind: 'CASH',
        fundInId: CASH_ID,
        partnerId: null,
      }),
      null
    );
    expect(values.sourceFund).toBe(`BANK:${BANK_ID}`);
    expect(values.destinationFund).toBe(`CASH:${CASH_ID}`);
    expect(values.partnerId).toBe('');
  });

  it('gastos bancarios: mapea los conceptos en orden, con importes a string', () => {
    const lines: FundMovementLineSource[] = [
      { accountId: ACCOUNT_A, description: 'Comisión', amount: 1234.5 },
      { accountId: ACCOUNT_B, description: 'IVA', amount: 259.25 },
    ];
    const values = formValuesFromMovement(
      movementSource({ type: 'BANK_CHARGES', fundOutKind: 'BANK', fundOutId: BANK_ID, partnerId: null }),
      lines
    );
    expect(values.lines).toEqual([
      { accountId: ACCOUNT_A, description: 'Comisión', amount: '1234.5' },
      { accountId: ACCOUNT_B, description: 'IVA', amount: '259.25' },
    ]);
  });

  it('gastos bancarios sin conceptos cargados → []', () => {
    expect(formValuesFromMovement(movementSource({ type: 'BANK_CHARGES' }), null).lines).toEqual([]);
  });

  it('otro tipo con conceptos pasados → []', () => {
    const lines: FundMovementLineSource[] = [{ accountId: ACCOUNT_A, description: 'X', amount: 10 }];
    expect(formValuesFromMovement(movementSource(), lines).lines).toEqual([]);
  });

  it('la fecha anclada a mediodía UTC no se corre un día (TSK-483)', () => {
    expect(formValuesFromMovement(movementSource({ date: new Date('2026-03-01T12:00:00Z') }), null).date).toBe(
      '2026-03-01'
    );
  });

  it('el monto pasa a string', () => {
    expect(formValuesFromMovement(movementSource({ amount: 1500 }), null).amount).toBe('1500');
  });
});

describe('getModalCopy', () => {
  it('create y edit: títulos distintos, misma descripción', () => {
    expect(getModalCopy('create')).toEqual({ title: 'Nuevo Movimiento de Fondos', description: EDIT_DESCRIPTION });
    expect(getModalCopy('edit', 'DRAFT')).toEqual({
      title: 'Editar Movimiento de Fondos',
      description: EDIT_DESCRIPTION,
    });
  });

  it.each<[FundMovementStatus, string]>([
    ['DRAFT', 'Borrador: todavía no movió saldos ni generó asiento.'],
    ['CONFIRMED', 'Confirmado: ya actualizó el saldo del banco/caja y generó su asiento.'],
    ['CANCELLED', 'Anulado: el movimiento quedó sin efecto.'],
  ])('view %s', (status, description) => {
    expect(getModalCopy('view', status)).toEqual({ title: 'Movimiento de Fondos', description });
  });

  it('view sin estado', () => {
    expect(getModalCopy('view')).toEqual({
      title: 'Movimiento de Fondos',
      description: 'Consulta de solo lectura.',
    });
    expect(getModalCopy('view', null).description).toBe('Consulta de solo lectura.');
  });
});

describe('shouldCleanupFieldsOnTypeChange', () => {
  it('limpia en create y edit, no en view', () => {
    expect(shouldCleanupFieldsOnTypeChange('create')).toBe(true);
    expect(shouldCleanupFieldsOnTypeChange('edit')).toBe(true);
    expect(shouldCleanupFieldsOnTypeChange('view')).toBe(false);
  });
});

describe('needsMovementDetail', () => {
  it('solo edit/view de gastos bancarios', () => {
    expect(needsMovementDetail('create', 'BANK_CHARGES')).toBe(false);
    expect(needsMovementDetail('edit', 'BANK_CHARGES')).toBe(true);
    expect(needsMovementDetail('view', 'BANK_CHARGES')).toBe(true);
    expect(needsMovementDetail('edit', 'PARTNER_CONTRIBUTION')).toBe(false);
    expect(needsMovementDetail('view', undefined)).toBe(false);
  });
});

describe('formResetKey', () => {
  it('create siempre es "new"', () => {
    expect(formResetKey('create', null)).toBe('new');
    expect(formResetKey('create', 'abc')).toBe('new');
  });

  it('edit y view incluyen el modo y el id', () => {
    expect(formResetKey('edit', 'abc')).toBe('edit:abc');
    expect(formResetKey('view', 'abc')).toBe('view:abc');
    expect(formResetKey('edit', 'abc')).not.toBe(formResetKey('view', 'abc'));
  });
});

describe('getViewSummaryFacts', () => {
  it('borrador sin confirmación ni asiento → []', () => {
    expect(getViewSummaryFacts({ confirmedAt: null, journalEntryNumber: null })).toEqual([]);
  });

  it('confirmado → fecha de confirmación y número de asiento', () => {
    const confirmedAt = new Date('2026-03-02T15:30:00Z');
    expect(getViewSummaryFacts({ confirmedAt, journalEntryNumber: 123 })).toEqual([
      { key: 'confirmedAt', label: 'Confirmado el', value: moment(confirmedAt).format('DD/MM/YYYY HH:mm') },
      { key: 'journalEntry', label: 'Asiento N°', value: '123' },
    ]);
  });

  it('confirmado sin número de asiento → solo la fecha', () => {
    const facts = getViewSummaryFacts({ confirmedAt: new Date('2026-03-02T15:30:00Z'), journalEntryNumber: null });
    expect(facts.map((f) => f.key)).toEqual(['confirmedAt']);
  });
});
