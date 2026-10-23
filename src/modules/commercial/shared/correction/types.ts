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

export interface PaymentChoice {
  documentId: string;
  documentLabel: string;
  options: { paymentId: string; label: string }[];
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
  | 'CASH_SESSION_CLOSED'
  | 'CHECK_USED'
  | 'CHECK_ENDORSED_IN_OTHER_OP'
  | 'INSTALLMENT_PAID'
  | 'BANK_MOVEMENT_MANUAL_LINK'
  | 'FUND_BANK_MOVEMENT_RECONCILED'
  | 'UNTRACEABLE_EFFECT'
  | 'REFERENCED_BY_NOTE'
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
  pendingChoices: PaymentChoice[];
  fingerprint: string;
}
