import { PartnerMovementType } from '@/generated/prisma/enums';

export interface Partner extends Record<string, unknown> {
  id: string;
  companyId: string;
  name: string;
  taxId: string | null;
  email: string | null;
  phone: string | null;
  notes: string | null;
  isActive: boolean;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

/** Socio en el listado, con el balance (lo que la empresa le debe) ya calculado. */
export interface PartnerWithBalance extends Partner {
  balance: number;
}

export interface PartnerMovement extends Record<string, unknown> {
  id: string;
  companyId: string;
  partnerId: string;
  date: Date;
  type: PartnerMovementType;
  amount: number;
  description: string;
  paymentOrderId: string | null;
  createdBy: string;
  createdAt: Date;
}

/** Detalle de la cuenta corriente del socio. */
export interface PartnerInstallment extends Record<string, unknown> {
  id: string;
  number: number;
  dueDate: Date;
  amount: number;
  status: 'PENDING' | 'PAID';
  cardName: string;
  originFullNumber: string;
  settledByFullNumber: string | null;
}

export interface PartnerAccountStatement {
  movements: PartnerMovement[];
  installments: PartnerInstallment[];
  balance: number;
  pendingInstallments: number;
  totalOwed: number;
  totalRepayment: number;
  totalAdjustment: number;
}

// Labels para UI
export const PARTNER_MOVEMENT_TYPE_LABELS: Record<PartnerMovementType, string> = {
  OWED: 'Deuda generada',
  REPAYMENT: 'Devolución',
  ADJUSTMENT: 'Ajuste',
};

/**
 * Signo de cada tipo de movimiento respecto del balance (lo que la empresa le debe al socio).
 * balance = Σ(OWED) + Σ(ADJUSTMENT) − Σ(REPAYMENT)
 */
export const PARTNER_MOVEMENT_TYPE_SIGN: Record<PartnerMovementType, 1 | -1> = {
  OWED: 1,
  ADJUSTMENT: 1,
  REPAYMENT: -1,
};
