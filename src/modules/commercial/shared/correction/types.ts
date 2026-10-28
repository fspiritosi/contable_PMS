// Tipos puros de la corrección en cadena (TSK-792). Sin dependencias de servidor.

export type CorrectableKind =
  | 'PURCHASE_INVOICE'
  | 'SALES_INVOICE'
  | 'PAYMENT_ORDER'
  | 'RECEIPT'
  | 'FUND_MOVEMENT';

export type CorrectionMode = 'EDIT' | 'DELETE' | 'CANCEL';

export interface DocRef {
  kind: CorrectableKind;
  id: string;
}

/** documentId (OP/RC) → paymentId elegido para absorber la reducción. */
export type PaymentChoices = Record<string, string>;

export type CorrectionRequest =
  | { mode: 'EDIT'; ref: DocRef; data: unknown; choices?: PaymentChoices }
  | { mode: 'DELETE' | 'CANCEL'; ref: DocRef; choices?: PaymentChoices };

export type CardAction =
  | 'MODIFY'
  | 'REWRITE'
  | 'DELETE'
  | 'CANCEL'
  | 'REVERSE'
  | 'BACK_TO_PORTFOLIO'
  | 'UNLINK'
  | 'RECALCULATE';

export interface CardRow {
  label: string;
  before: string | null;
  after: string | null;
}

/** Elección del medio de pago del que se descuenta la reducción de una OP/RC (§4.3). */
export interface PaymentChoice {
  documentId: string;
  documentLabel: string;
  /** Solo los medios que cubren la reducción por sí solos. */
  options: { paymentId: string; label: string }[];
  /** null: falta elegir (no se puede confirmar). */
  selected: string | null;
}

export interface ProposalCard {
  key: string;
  title: string;
  action: CardAction;
  rows: CardRow[];
  warning?: string;
}

export type ImpedimentSeverity = 'MANUAL' | 'BLOCKED';

export type ImpedimentCode =
  | 'PERIOD_CLOSED'
  | 'ENTRY_POSTED'
  | 'AFIP_CAE'
  | 'MONTHLY_PROCESS'
  | 'PARTY_CHANGED_WITH_PAYMENTS'
  | 'WITHHOLDINGS_INSUFFICIENT'
  | 'NO_PAYMENT_COVERS_REDUCTION'
  | 'VOUCHER_CLASS_CHANGED'
  | 'CASH_SESSION_CLOSED'
  | 'CHECK_USED'
  | 'CHECK_ENDORSED_IN_OTHER_OP'
  | 'INSTALLMENT_PAID'
  | 'BANK_MOVEMENT_MANUAL_LINK'
  | 'FUND_BANK_MOVEMENT_RECONCILED'
  | 'UNTRACEABLE_EFFECT'
  | 'REFERENCED_BY_NOTE'
  | 'INVESTMENT_LATER_SALE'
  | 'INVESTMENT_VALUED'
  | 'INVALID_STATE'
  | 'SIMULATION_ERROR';

export interface Impediment {
  code: ImpedimentCode;
  severity: ImpedimentSeverity;
  message: string;
  action?: string;
  href?: string;
}

export interface CorrectionProposal {
  mode: CorrectionMode;
  origin: DocRef;
  cards: ProposalCard[];
  impediments: Impediment[];
  /** Elecciones de medio de pago, pendientes (`selected` null) o ya hechas: siguen visibles. */
  paymentChoices: PaymentChoice[];
  fingerprint: string;
}
