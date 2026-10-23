import { describe, expect, it } from 'vitest';

import { dedupeImpediments, impediments } from './impediments';
import type { Impediment } from './types';

describe('impediments', () => {
  const table: [string, Impediment, Impediment['code'], Impediment['severity']][] = [
    ['entryPosted', impediments.entryPosted(15, 'FC A 0001-00000001'), 'ENTRY_POSTED', 'MANUAL'],
    ['periodClosed', impediments.periodClosed('Período cerrado'), 'PERIOD_CLOSED', 'BLOCKED'],
    ['afipCae', impediments.afipCae('FV A 0001-00000002'), 'AFIP_CAE', 'BLOCKED'],
    [
      'monthlyProcess',
      impediments.monthlyProcess({ number: 7, description: 'Amortizaciones' }),
      'MONTHLY_PROCESS',
      'MANUAL',
    ],
    ['partyChanged', impediments.partyChanged(['OP 1']), 'PARTY_CHANGED_WITH_PAYMENTS', 'MANUAL'],
    [
      'withholdingsInsufficient',
      impediments.withholdingsInsufficient('OP 1'),
      'WITHHOLDINGS_INSUFFICIENT',
      'MANUAL',
    ],
    [
      'noPaymentCoversReduction',
      impediments.noPaymentCoversReduction('la OP 1', 500),
      'NO_PAYMENT_COVERS_REDUCTION',
      'MANUAL',
    ],
    [
      'cashSessionClosed',
      impediments.cashSessionClosed('Caja 1', 'OP 1'),
      'CASH_SESSION_CLOSED',
      'BLOCKED',
    ],
    ['checkUsed', impediments.checkUsed('Galicia 0001', 'Depositado'), 'CHECK_USED', 'BLOCKED'],
    [
      'checkEndorsedInOtherOp',
      impediments.checkEndorsedInOtherOp('Galicia 0001', 'OP 2'),
      'CHECK_ENDORSED_IN_OTHER_OP',
      'MANUAL',
    ],
    ['installmentPaid', impediments.installmentPaid('FC 1'), 'INSTALLMENT_PAID', 'BLOCKED'],
    [
      'bankMovementManualLink',
      impediments.bankMovementManualLink('OP 1'),
      'BANK_MOVEMENT_MANUAL_LINK',
      'MANUAL',
    ],
    [
      'fundBankMovementReconciled',
      impediments.fundBankMovementReconciled('MF 1'),
      'FUND_BANK_MOVEMENT_RECONCILED',
      'MANUAL',
    ],
    ['untraceable', impediments.untraceable('OP 1'), 'UNTRACEABLE_EFFECT', 'BLOCKED'],
    ['referencedByNote', impediments.referencedByNote('NC 1'), 'REFERENCED_BY_NOTE', 'MANUAL'],
    ['invalidState', impediments.invalidState('Estado inválido'), 'INVALID_STATE', 'BLOCKED'],
    ['simulationError', impediments.simulationError('Falló'), 'SIMULATION_ERROR', 'BLOCKED'],
  ];

  it('cubre los 17 constructores', () => {
    expect(table).toHaveLength(17);
    expect(Object.keys(impediments).sort()).toEqual(table.map(([name]) => name).sort());
  });

  it.each(table)('severidades por constructor: %s', (_name, imp, code, severity) => {
    expect(imp.code).toBe(code);
    expect(imp.severity).toBe(severity);
    expect(imp.message.length).toBeGreaterThan(0);
  });

  it('los MANUAL indican qué hacer', () => {
    for (const [, imp] of table) {
      if (imp.severity === 'MANUAL') expect(imp.action).toBeTruthy();
    }
  });

  it('textos de referencia', () => {
    const posted = impediments.entryPosted(15, 'FC A 0001-00000001');
    expect(posted.message).toBe('El asiento N° 15 de FC A 0001-00000001 está Registrado.');
    expect(posted.action).toBe('Volvelo a borrador desde Contabilidad › Asientos y reintentá.');
    expect(posted.href).toBe('/dashboard/company/accounting/entries');
    const monthly = impediments.monthlyProcess({ number: 7, description: 'Amortizaciones' });
    expect(monthly.message).toBe('Ya se generó «Amortizaciones» (asiento N° 7) para este mes.');
    expect(monthly.action).toBe(
      'Anulá ese asiento desde Contabilidad › Asientos, corregí el comprobante y volvé a generarlo.'
    );
    expect(impediments.untraceable('OP 1').message).toBe(
      'Un movimiento de OP 1 es anterior a la trazabilidad y no se puede corregir automáticamente.'
    );
  });
});

describe('dedupeImpediments', () => {
  it('quita los repetidos por código y mensaje, conservando el orden', () => {
    const closed = impediments.cashSessionClosed('Caja 1', 'OP 1');
    const otherRegister = impediments.cashSessionClosed('Caja 2', 'OP 1');
    const used = impediments.checkUsed('Galicia 0001', 'Depositado');
    expect(dedupeImpediments([closed, used, { ...closed }, otherRegister, used])).toEqual([
      closed,
      used,
      otherRegister,
    ]);
  });

  it('lista vacía → vacía', () => {
    expect(dedupeImpediments([])).toEqual([]);
  });
});
