import type {
  CashRegisterStatus,
  SessionStatus,
  CashMovementType,
  BankAccountType,
  BankAccountStatus,
  BankMovementType,
  PaymentMethod,
  ReceiptStatus,
  PaymentOrderStatus,
  WithholdingTaxType,
  CheckType,
  CheckStatus,
  ProjectionType,
  ProjectionCategory,
  ProjectionStatus,
} from '@/generated/prisma/enums';

// ====================================
// CASH REGISTER TYPES
// ====================================

export type { CashRegisterStatus, SessionStatus, CashMovementType };

// ====================================
// BANK ACCOUNT TYPES
// ====================================

export type { BankAccountType, BankAccountStatus, BankMovementType };

// ====================================
// RECEIPT TYPES
// ====================================

export type { PaymentMethod, ReceiptStatus, PaymentOrderStatus, WithholdingTaxType };

// ====================================
// CHECK TYPES
// ====================================

export type { CheckType, CheckStatus };

// ====================================
// PROJECTION TYPES
// ====================================

export type { ProjectionType, ProjectionCategory };

// Tipo para caja con sesión activa opcional
export interface CashRegisterWithActiveSession extends Record<string, unknown> {
  id: string;
  code: string;
  name: string;
  location: string | null;
  status: CashRegisterStatus;
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
  activeSession: {
    id: string;
    sessionNumber: number;
    status: SessionStatus;
    openedAt: Date;
    openingBalance: number;
    expectedBalance: number;
    openedBy: string;
  } | null;
}

// Tipo para sesión con movimientos
export interface SessionWithMovements {
  id: string;
  sessionNumber: number;
  status: SessionStatus;
  openedAt: Date;
  closedAt: Date | null;
  openingBalance: number;
  expectedBalance: number;
  actualBalance: number | null;
  difference: number | null;
  openingNotes: string | null;
  closingNotes: string | null;
  openedBy: string;
  closedBy: string | null;
  cashRegister: {
    id: string;
    code: string;
    name: string;
  };
  movements: Array<{
    id: string;
    type: CashMovementType;
    date: Date;
    amount: number;
    description: string;
    reference: string | null;
    createdBy: string;
  }>;
}

// Tipo para movimiento de caja
export interface CashMovementDetail {
  id: string;
  type: CashMovementType;
  date: Date;
  amount: number;
  description: string;
  reference: string | null;
  createdBy: string;
  createdAt: Date;
  session: {
    id: string;
    sessionNumber: number;
  };
  cashRegister: {
    id: string;
    code: string;
    name: string;
  };
}

// ====================================
// BANK ACCOUNT INTERFACES
// ====================================

// Tipo para cuenta bancaria con saldo y movimientos recientes
export interface BankAccountWithBalance extends Record<string, unknown> {
  id: string;
  bankName: string;
  accountNumber: string;
  accountType: BankAccountType;
  cbu: string | null;
  alias: string | null;
  currency: string;
  balance: number;
  status: BankAccountStatus;
  createdAt: Date;
  updatedAt: Date;
  _count?: {
    movements: number;
  };
}

// Tipo para movimiento bancario con relaciones
export interface BankMovementDetail {
  id: string;
  type: BankMovementType;
  amount: number;
  date: Date;
  description: string;
  reference: string | null;
  statementNumber: string | null;
  reconciled: boolean;
  reconciledAt: Date | null;
  createdBy: string;
  createdAt: Date;
  bankAccount: {
    id: string;
    bankName: string;
    accountNumber: string;
  };
  receipt?: { id: string; fullNumber: string } | null;
  paymentOrder?: { id: string; fullNumber: string } | null;
}

// Tipo para cuenta bancaria con movimientos
export interface BankAccountWithMovements {
  id: string;
  bankName: string;
  accountNumber: string;
  accountType: BankAccountType;
  cbu: string | null;
  alias: string | null;
  currency: string;
  balance: number;
  status: BankAccountStatus;
  movements: Array<{
    id: string;
    type: BankMovementType;
    amount: number;
    date: Date;
    description: string;
    reference: string | null;
    reconciled: boolean;
    createdBy: string;
  }>;
}

// ====================================
// RECEIPT INTERFACES
// ====================================

// Tipo para factura pendiente de cobro
export interface PendingInvoice {
  id: string;
  fullNumber: string;
  issueDate: Date;
  total: number;
  paidAmount: number;
  pendingAmount: number;
  status: string;
}

// Tipo para recibo con items y pagos
export interface ReceiptWithDetails extends Record<string, unknown> {
  id: string;
  companyId: string;
  number: number;
  fullNumber: string;
  date: Date;
  totalAmount: number;
  notes: string | null;
  status: ReceiptStatus;
  documentUrl: string | null;
  documentKey: string | null;
  createdAt: Date;
  company: { name: string };
  customer: {
    id: string;
    name: string;
    taxId: string | null;
  };
  items: Array<{
    id: string;
    amount: number;
    invoice: {
      id: string;
      fullNumber: string;
      total: number;
    };
  }>;
  payments: Array<{
    id: string;
    paymentMethod: PaymentMethod;
    amount: number;
    cashRegister: {
      code: string;
      name: string;
    } | null;
    bankAccount: {
      bankName: string;
      accountNumber: string;
    } | null;
    checkNumber: string | null;
    cardLast4: string | null;
    reference: string | null;
  }>;
  withholdings: Array<{
    id: string;
    taxType: WithholdingTaxType;
    rate: number;
    amount: number;
    certificateNumber: string | null;
  }>;
  bankMovements?: Array<{
    id: string;
    type: BankMovementType;
    amount: number;
    date: Date;
    bankAccount: {
      bankName: string;
      accountNumber: string;
    };
  }>;
}

// Tipo para lista de recibos
export interface ReceiptListItem extends Record<string, unknown> {
  id: string;
  number: number;
  fullNumber: string;
  date: Date;
  totalAmount: number;
  status: ReceiptStatus;
  createdAt: Date;
  customer: {
    id: string;
    name: string;
  };
  _count: {
    items: number;
    payments: number;
  };
}

// ====================================
// PAYMENT ORDER INTERFACES
// ====================================

// Tipo para factura pendiente de pago
export interface PendingPurchaseInvoice {
  id: string;
  fullNumber: string;
  issueDate: Date;
  total: number;
  paidAmount: number;
  pendingAmount: number;
  status: string;
}

// Tipo para orden de pago con items y formas de pago
export interface PaymentOrderWithDetails extends Record<string, unknown> {
  id: string;
  companyId: string;
  number: number;
  fullNumber: string;
  date: Date;
  totalAmount: number;
  notes: string | null;
  status: PaymentOrderStatus;
  documentUrl: string | null;
  documentKey: string | null;
  createdAt: Date;
  company: { name: string };
  supplier: {
    id: string;
    businessName: string;
    tradeName: string | null;
    taxId: string | null;
  } | null;
  items: Array<{
    id: string;
    amount: number;
    invoice: {
      id: string;
      fullNumber: string;
      total: number;
    } | null;
    expense: {
      id: string;
      fullNumber: string;
      description: string;
      amount: number;
    } | null;
  }>;
  payments: Array<{
    id: string;
    paymentMethod: PaymentMethod;
    amount: number;
    cashRegisterId: string | null;
    bankAccountId: string | null;
    cashRegister: {
      code: string;
      name: string;
    } | null;
    bankAccount: {
      bankName: string;
      accountNumber: string;
    } | null;
    checkNumber: string | null;
    cardLast4: string | null;
    reference: string | null;
  }>;
  withholdings: Array<{
    id: string;
    taxType: WithholdingTaxType;
    rate: number;
    amount: number;
    certificateNumber: string | null;
  }>;
  bankMovements?: Array<{
    id: string;
    type: BankMovementType;
    amount: number;
    date: Date;
    bankAccount: {
      bankName: string;
      accountNumber: string;
    };
  }>;
}

// Tipo para lista de órdenes de pago
export interface PaymentOrderListItem extends Record<string, unknown> {
  id: string;
  number: number;
  fullNumber: string;
  date: Date;
  totalAmount: number;
  status: PaymentOrderStatus;
  createdAt: Date;
  supplier: {
    id: string;
    businessName: string;
    tradeName: string | null;
  } | null;
  _count: {
    items: number;
    payments: number;
  };
}

// ====================================
// CHECK INTERFACES
// ====================================

export interface CheckListItem extends Record<string, unknown> {
  id: string;
  type: CheckType;
  status: CheckStatus;
  checkNumber: string;
  bankName: string;
  amount: number;
  issueDate: Date;
  dueDate: Date;
  drawerName: string;
  customer: { id: string; name: string } | null;
  supplier: { id: string; businessName: string } | null;
  bankAccount: { id: string; bankName: string; accountNumber: string } | null;
}

export interface CheckWithDetails extends Record<string, unknown> {
  id: string;
  type: CheckType;
  status: CheckStatus;
  checkNumber: string;
  bankName: string;
  branch: string | null;
  accountNumber: string | null;
  amount: number;
  issueDate: Date;
  dueDate: Date;
  isElectronic: boolean;
  drawerName: string;
  drawerTaxId: string | null;
  payeeName: string | null;
  endorsedToName: string | null;
  endorsedToTaxId: string | null;
  endorsedAt: Date | null;
  rejectedAt: Date | null;
  rejectionReason: string | null;
  clearedAt: Date | null;
  depositedAt: Date | null;
  notes: string | null;
  customer: { id: string; name: string } | null;
  supplier: { id: string; businessName: string } | null;
  bankAccount: { id: string; bankName: string; accountNumber: string } | null;
}

// ====================================
// PROJECTION INTERFACES
// ====================================

export interface ProjectionListItem extends Record<string, unknown> {
  id: string;
  type: ProjectionType;
  category: ProjectionCategory;
  description: string;
  amount: number;
  date: Date;
  isRecurring: boolean;
  notes: string | null;
  status: ProjectionStatus;
  confirmedAmount: number;
  createdAt: Date;
}

export interface ProjectionDocumentLinkItem {
  id: string;
  amount: number;
  notes: string | null;
  createdAt: Date;
  documentType: 'SALES_INVOICE' | 'PURCHASE_INVOICE' | 'EXPENSE';
  documentFullNumber: string;
  documentTotal: number;
  documentDate: Date;
  documentEntityName: string | null;
}

export interface DocumentForLinking {
  id: string;
  fullNumber: string;
  total: number;
  date: Date;
  entityName: string | null;
  documentType: 'SALES_INVOICE' | 'PURCHASE_INVOICE' | 'EXPENSE';
}

export interface ProjectionForLinking {
  id: string;
  type: ProjectionType;
  category: ProjectionCategory;
  description: string;
  amount: number;
  confirmedAmount: number;
  remainingAmount: number;
  date: Date;
}
