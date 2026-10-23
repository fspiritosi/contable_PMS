import type { Impediment } from './types';

const ENTRIES_HREF = '/dashboard/company/accounting/entries';

/** Constructores de impedimentos con el texto ya armado (spec §3 y §7). */
export const impediments = {
  entryPosted(entryNumber: number, docLabel: string): Impediment {
    return {
      code: 'ENTRY_POSTED',
      severity: 'MANUAL',
      message: `El asiento N° ${entryNumber} de ${docLabel} está Registrado.`,
      action: 'Volvelo a borrador desde Contabilidad › Asientos y reintentá.',
      href: ENTRIES_HREF,
    };
  },
  periodClosed(message: string): Impediment {
    return { code: 'PERIOD_CLOSED', severity: 'BLOCKED', message };
  },
  afipCae(docLabel: string): Impediment {
    return {
      code: 'AFIP_CAE',
      severity: 'BLOCKED',
      message: `${docLabel} tiene CAE de AFIP y no se puede modificar, eliminar ni anular desde acá.`,
      action: 'Emití una nota de crédito para corregirla.',
    };
  },
  monthlyProcess(entry: { number: number; description: string }): Impediment {
    return {
      code: 'MONTHLY_PROCESS',
      severity: 'MANUAL',
      message: `Ya se generó «${entry.description}» (asiento N° ${entry.number}) para este mes.`,
      action:
        'Anulá ese asiento desde Contabilidad › Asientos, corregí el comprobante y volvé a generarlo.',
      href: ENTRIES_HREF,
    };
  },
  partyChanged(paymentLabels: string[]): Impediment {
    return {
      code: 'PARTY_CHANGED_WITH_PAYMENTS',
      severity: 'MANUAL',
      message: `No se puede cambiar la contraparte porque el comprobante tiene pagos o cobros asociados: ${paymentLabels.join(', ')}.`,
      action: 'Eliminá o anulá esos pagos o cobros y reintentá.',
    };
  },
  withholdingsInsufficient(docLabel: string): Impediment {
    return {
      code: 'WITHHOLDINGS_INSUFFICIENT',
      severity: 'MANUAL',
      message: `La reducción no se puede cubrir en ${docLabel} sin tocar sus retenciones, que no se recalculan automáticamente.`,
      action: 'Corregí las retenciones de ese comprobante a mano y reintentá.',
    };
  },
  cashSessionClosed(registerName: string, docLabel: string): Impediment {
    return {
      code: 'CASH_SESSION_CLOSED',
      severity: 'BLOCKED',
      message: `${docLabel} tiene un pago en efectivo de una sesión ya cerrada de la caja ${registerName}.`,
    };
  },
  checkUsed(checkLabel: string, statusLabel: string): Impediment {
    return {
      code: 'CHECK_USED',
      severity: 'BLOCKED',
      message: `El cheque ${checkLabel} ya fue utilizado (${statusLabel}) y no se puede revertir.`,
    };
  },
  checkEndorsedInOtherOp(checkLabel: string, opLabel: string): Impediment {
    return {
      code: 'CHECK_ENDORSED_IN_OTHER_OP',
      severity: 'MANUAL',
      message: `El cheque ${checkLabel} fue endosado en ${opLabel}.`,
      action: `Anulá o corregí ${opLabel} para que el cheque vuelva a cartera y reintentá.`,
    };
  },
  installmentPaid(docLabel: string): Impediment {
    return {
      code: 'INSTALLMENT_PAID',
      severity: 'BLOCKED',
      message: `${docLabel} tiene cuotas ya pagadas y no se puede corregir.`,
    };
  },
  bankMovementManualLink(docLabel: string): Impediment {
    return {
      code: 'BANK_MOVEMENT_MANUAL_LINK',
      severity: 'MANUAL',
      message: `Un movimiento bancario de ${docLabel} fue vinculado a mano.`,
      action: 'Desvinculalo desde Tesorería › Bancos y reintentá.',
    };
  },
  fundBankMovementReconciled(docLabel: string): Impediment {
    return {
      code: 'FUND_BANK_MOVEMENT_RECONCILED',
      severity: 'MANUAL',
      message: `El movimiento bancario de ${docLabel} está conciliado.`,
      action: 'Quitá la conciliación desde Tesorería › Bancos y reintentá.',
    };
  },
  untraceable(docLabel: string): Impediment {
    return {
      code: 'UNTRACEABLE_EFFECT',
      severity: 'BLOCKED',
      message: `Un movimiento de ${docLabel} es anterior a la trazabilidad y no se puede corregir automáticamente.`,
    };
  },
  referencedByNote(noteLabel: string): Impediment {
    return {
      code: 'REFERENCED_BY_NOTE',
      severity: 'MANUAL',
      message: `El comprobante está referenciado por ${noteLabel}.`,
      action: `Eliminá o anulá ${noteLabel} y reintentá.`,
    };
  },
  invalidState(message: string): Impediment {
    return { code: 'INVALID_STATE', severity: 'BLOCKED', message };
  },
  simulationError(message: string): Impediment {
    return { code: 'SIMULATION_ERROR', severity: 'BLOCKED', message };
  },
};
