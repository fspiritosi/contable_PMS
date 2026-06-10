import { z } from 'zod';

// ====================================
// CASH REGISTER SCHEMAS
// ====================================

// Schema para crear/editar caja
export const cashRegisterSchema = z.object({
  code: z
    .string()
    .min(1, 'El código es requerido')
    .max(20, 'El código no puede exceder 20 caracteres')
    .regex(/^[A-Z0-9-]+$/, 'El código solo puede contener letras mayúsculas, números y guiones'),
  name: z
    .string()
    .min(1, 'El nombre es requerido')
    .max(100, 'El nombre no puede exceder 100 caracteres'),
  location: z.string().max(200, 'La ubicación no puede exceder 200 caracteres').optional().nullable(),
  isDefault: z.boolean().default(false),
});

// Schema para abrir sesión
export const openSessionSchema = z.object({
  cashRegisterId: z.string().uuid('Caja inválida'),
  openingBalance: z
    .string()
    .min(1, 'El saldo inicial es requerido')
    .regex(/^\d+(\.\d{1,2})?$/, 'Saldo inválido (máximo 2 decimales)')
    .refine((val) => parseFloat(val) >= 0, 'El saldo inicial debe ser positivo o cero'),
  openingNotes: z.string().max(500, 'Las notas no pueden exceder 500 caracteres').optional().nullable(),
});

// Schema para cerrar sesión
export const closeSessionSchema = z.object({
  sessionId: z.string().uuid('Sesión inválida'),
  actualBalance: z
    .string()
    .min(1, 'El saldo real es requerido')
    .regex(/^\d+(\.\d{1,2})?$/, 'Saldo inválido (máximo 2 decimales)')
    .refine((val) => parseFloat(val) >= 0, 'El saldo real debe ser positivo o cero'),
  closingNotes: z.string().max(500, 'Las notas no pueden exceder 500 caracteres').optional().nullable(),
});

// Schema para movimiento de caja
export const cashMovementSchema = z.object({
  sessionId: z.string().uuid('Sesión inválida'),
  cashRegisterId: z.string().uuid('Caja inválida'),
  type: z.enum(['INCOME', 'EXPENSE', 'ADJUSTMENT'], {
    message: 'Debe seleccionar un tipo de movimiento',
  }),
  amount: z
    .string()
    .min(1, 'El monto es requerido')
    .regex(/^\d+(\.\d{1,2})?$/, 'Monto inválido (máximo 2 decimales)')
    .refine((val) => parseFloat(val) > 0, 'El monto debe ser mayor a 0'),
  description: z
    .string()
    .min(1, 'La descripción es requerida')
    .max(500, 'La descripción no puede exceder 500 caracteres'),
  reference: z.string().max(100, 'La referencia no puede exceder 100 caracteres').optional().nullable(),
  date: z.date({ message: 'La fecha es requerida' }),
});

// ====================================
// TYPE INFERENCE
// ====================================

export type CashRegisterFormData = z.infer<typeof cashRegisterSchema>;
export type OpenSessionFormData = z.infer<typeof openSessionSchema>;
export type CloseSessionFormData = z.infer<typeof closeSessionSchema>;
export type CashMovementFormData = z.infer<typeof cashMovementSchema>;

// ====================================
// LABELS Y MAPPERS
// ====================================

export const CASH_REGISTER_STATUS_LABELS = {
  ACTIVE: 'Activa',
  INACTIVE: 'Inactiva',
} as const;

export const CASH_REGISTER_STATUS_BADGES = {
  ACTIVE: 'success' as const,
  INACTIVE: 'secondary' as const,
};

export const SESSION_STATUS_LABELS = {
  OPEN: 'Abierta',
  CLOSED: 'Cerrada',
} as const;

export const SESSION_STATUS_BADGES = {
  OPEN: 'success' as const,
  CLOSED: 'secondary' as const,
};

export const CASH_MOVEMENT_TYPE_LABELS = {
  OPENING: 'Apertura',
  CLOSING: 'Cierre',
  INCOME: 'Ingreso',
  EXPENSE: 'Egreso',
  ADJUSTMENT: 'Ajuste',
} as const;

export const CASH_MOVEMENT_TYPE_COLORS = {
  OPENING: 'blue',
  CLOSING: 'gray',
  INCOME: 'green',
  EXPENSE: 'red',
  ADJUSTMENT: 'yellow',
} as const;

// ====================================
// BANK ACCOUNT SCHEMAS
// ====================================

// Schema para crear/editar cuenta bancaria
const NON_BANK_TYPES = ['CASH', 'VIRTUAL_WALLET'] as const;

export const bankAccountSchema = z
  .object({
    bankName: z
      .string()
      .max(100, 'El nombre no puede exceder 100 caracteres')
      .optional()
      .default(''),
    accountNumber: z
      .string()
      .max(50, 'El número de cuenta no puede exceder 50 caracteres')
      .optional()
      .default(''),
    accountType: z.enum(['CHECKING', 'SAVINGS', 'CREDIT', 'CASH', 'VIRTUAL_WALLET'], {
      message: 'Debe seleccionar un tipo de cuenta',
    }),
    cbu: z
      .string()
      .length(22, 'El CBU debe tener exactamente 22 dígitos')
      .regex(/^\d{22}$/, 'El CBU solo puede contener números')
      .optional()
      .nullable(),
    alias: z
      .string()
      .min(6, 'El alias debe tener al menos 6 caracteres')
      .max(20, 'El alias no puede exceder 20 caracteres')
      .optional()
      .nullable(),
    currency: z.string().default('ARS'),
    balance: z
      .string()
      .regex(/^-?\d+(\.\d{1,2})?$/, 'Saldo inválido (máximo 2 decimales)')
      .optional()
      .default('0.00'),
    accountId: z.string().uuid('Cuenta contable inválida').optional().nullable(),
  })
  .refine(
    (data) => {
      if (NON_BANK_TYPES.includes(data.accountType as (typeof NON_BANK_TYPES)[number])) return true;
      return data.bankName && data.bankName.length > 0;
    },
    { message: 'El nombre del banco es requerido', path: ['bankName'] }
  )
  .refine(
    (data) => {
      if (NON_BANK_TYPES.includes(data.accountType as (typeof NON_BANK_TYPES)[number])) return true;
      return data.accountNumber && data.accountNumber.length > 0;
    },
    { message: 'El número de cuenta es requerido', path: ['accountNumber'] }
  );

// Schema para movimiento bancario
export const bankMovementSchema = z.object({
  bankAccountId: z.string().uuid('Cuenta bancaria inválida'),
  type: z.enum(['DEPOSIT', 'WITHDRAWAL', 'TRANSFER_IN', 'TRANSFER_OUT', 'CHECK', 'DEBIT', 'FEE', 'INTEREST'], {
    message: 'Debe seleccionar un tipo de movimiento',
  }),
  amount: z
    .string()
    .min(1, 'El monto es requerido')
    .regex(/^\d+(\.\d{1,2})?$/, 'Monto inválido (máximo 2 decimales)')
    .refine((val) => parseFloat(val) > 0, 'El monto debe ser mayor a 0'),
  date: z.date({ message: 'La fecha es requerida' }),
  description: z
    .string()
    .min(1, 'La descripción es requerida')
    .max(500, 'La descripción no puede exceder 500 caracteres'),
  reference: z.string().max(100, 'La referencia no puede exceder 100 caracteres').optional().nullable(),
  statementNumber: z
    .string()
    .max(50, 'El número de extracto no puede exceder 50 caracteres')
    .optional()
    .nullable(),
  accountId: z.string().uuid('Cuenta contable inválida'),
});

// Schema para conciliación bancaria
export const reconcileBankMovementSchema = z.object({
  movementId: z.string().uuid('Movimiento inválido'),
  reconcile: z.boolean(),
});

// Schema para transferencia entre cuentas propias
export const bankTransferSchema = z.object({
  sourceBankAccountId: z.string().uuid('Cuenta origen inválida'),
  destinationType: z.enum(['BANK', 'CASH'], {
    message: 'Debe seleccionar un tipo de destino',
  }),
  destinationBankAccountId: z.string().uuid('Cuenta destino inválida').optional().nullable(),
  destinationCashRegisterId: z.string().uuid('Caja destino inválida').optional().nullable(),
  amount: z
    .string()
    .min(1, 'El monto es requerido')
    .regex(/^\d+(\.\d{1,2})?$/, 'Monto inválido (máximo 2 decimales)')
    .refine((val) => parseFloat(val) > 0, 'El monto debe ser mayor a 0'),
  date: z.date({ message: 'La fecha es requerida' }),
  description: z
    .string()
    .min(1, 'La descripción es requerida')
    .max(500, 'La descripción no puede exceder 500 caracteres'),
  reference: z.string().max(100, 'La referencia no puede exceder 100 caracteres').optional().nullable(),
}).refine(
  (data) => {
    if (data.destinationType === 'BANK') return !!data.destinationBankAccountId;
    if (data.destinationType === 'CASH') return !!data.destinationCashRegisterId;
    return false;
  },
  { message: 'Debe seleccionar una cuenta destino', path: ['destinationBankAccountId'] }
).refine(
  (data) => {
    if (data.destinationType === 'BANK') {
      return data.sourceBankAccountId !== data.destinationBankAccountId;
    }
    return true;
  },
  { message: 'La cuenta destino debe ser diferente a la origen', path: ['destinationBankAccountId'] }
);

// ====================================
// TYPE INFERENCE - BANK
// ====================================

export type BankAccountFormData = z.infer<typeof bankAccountSchema>;
export type BankMovementFormData = z.infer<typeof bankMovementSchema>;
export type ReconcileBankMovementFormData = z.infer<typeof reconcileBankMovementSchema>;
export type BankTransferFormData = z.infer<typeof bankTransferSchema>;

// ====================================
// LABELS Y MAPPERS - BANK
// ====================================

export const BANK_ACCOUNT_TYPE_LABELS = {
  CHECKING: 'Cuenta Corriente',
  SAVINGS: 'Caja de Ahorro',
  CREDIT: 'Cuenta de Crédito',
  CASH: 'Caja',
  VIRTUAL_WALLET: 'Billetera Virtual',
} as const;

export const BANK_ACCOUNT_STATUS_LABELS = {
  ACTIVE: 'Activa',
  INACTIVE: 'Inactiva',
  CLOSED: 'Cerrada',
} as const;

export const BANK_ACCOUNT_STATUS_BADGES = {
  ACTIVE: 'success' as const,
  INACTIVE: 'secondary' as const,
  CLOSED: 'destructive' as const,
};

export const BANK_MOVEMENT_TYPE_LABELS = {
  DEPOSIT: 'Depósito',
  WITHDRAWAL: 'Extracción',
  TRANSFER_IN: 'Transferencia Recibida',
  TRANSFER_OUT: 'Transferencia Enviada',
  CHECK: 'Cheque',
  DEBIT: 'Débito Automático',
  FEE: 'Comisión',
  INTEREST: 'Interés',
} as const;

export const BANK_MOVEMENT_TYPE_COLORS = {
  DEPOSIT: 'green',
  WITHDRAWAL: 'red',
  TRANSFER_IN: 'blue',
  TRANSFER_OUT: 'orange',
  CHECK: 'purple',
  DEBIT: 'red',
  FEE: 'red',
  INTEREST: 'green',
} as const;

// ====================================
// WITHHOLDING SCHEMAS
// ====================================

// Schema para retención impositiva
export const withholdingSchema = z.object({
  taxType: z.enum(['IVA', 'GANANCIAS', 'IIBB', 'SUSS'], {
    message: 'Debe seleccionar un tipo de retención',
  }),
  rate: z
    .string()
    .min(1, 'La alícuota es requerida')
    .regex(/^\d+(\.\d{1,2})?$/, 'Alícuota inválida (máximo 2 decimales)')
    .refine((val) => parseFloat(val) >= 0 && parseFloat(val) <= 100, 'La alícuota debe estar entre 0 y 100'),
  amount: z
    .string()
    .min(1, 'El monto es requerido')
    .regex(/^\d+(\.\d{1,2})?$/, 'Monto inválido (máximo 2 decimales)')
    .refine((val) => parseFloat(val) > 0, 'El monto debe ser mayor a 0'),
  certificateNumber: z.string().max(50, 'El número de certificado no puede exceder 50 caracteres').optional().nullable(),
});

// ====================================
// TYPE INFERENCE - WITHHOLDINGS
// ====================================

export type WithholdingFormData = z.infer<typeof withholdingSchema>;

// ====================================
// LABELS Y MAPPERS - WITHHOLDINGS
// ====================================

export const WITHHOLDING_TAX_TYPE_LABELS = {
  IVA: 'Ret. IVA',
  GANANCIAS: 'Ret. Ganancias',
  IIBB: 'Ret. IIBB',
  SUSS: 'Ret. SUSS',
} as const;

// ====================================
// RECEIPT SCHEMAS
// ====================================

// Schema para item de recibo (factura a cobrar)
export const receiptItemSchema = z.object({
  invoiceId: z.string().uuid('Factura inválida'),
  amount: z
    .string()
    .min(1, 'El monto es requerido')
    .regex(/^\d+(\.\d{1,2})?$/, 'Monto inválido (máximo 2 decimales)')
    .refine((val) => parseFloat(val) > 0, 'El monto debe ser mayor a 0'),
});

// Campos base de una forma de pago (compartidos por recibos y órdenes de pago)
const basePaymentFields = {
  paymentMethod: z.enum(['CASH', 'CHECK', 'ECHEQ', 'TRANSFER', 'DEBIT_CARD', 'CREDIT_CARD', 'ACCOUNT'], {
    message: 'Debe seleccionar una forma de pago',
  }),
  amount: z
    .string()
    .min(1, 'El monto es requerido')
    .regex(/^\d+(\.\d{1,2})?$/, 'Monto inválido (máximo 2 decimales)')
    .refine((val) => parseFloat(val) > 0, 'El monto debe ser mayor a 0'),
  cashRegisterId: z.string().uuid('Caja inválida').optional().nullable(),
  bankAccountId: z.string().uuid('Cuenta bancaria inválida').optional().nullable(),
  checkNumber: z.string().max(50, 'El número de cheque no puede exceder 50 caracteres').optional().nullable(),
  cardLast4: z
    .string()
    .length(4, 'Debe tener 4 dígitos')
    .regex(/^\d{4}$/, 'Solo números')
    .optional()
    .nullable(),
  reference: z.string().max(200, 'La referencia no puede exceder 200 caracteres').optional().nullable(),
  // Metadata del cheque / e-cheq (cuando paymentMethod es CHECK o ECHEQ)
  checkBankName: z.string().max(100, 'El banco no puede exceder 100 caracteres').optional().nullable(),
  checkIssueDate: z.date().optional().nullable(),
  checkDueDate: z.date().optional().nullable(),
  checkDrawerName: z.string().max(150, 'El emisor no puede exceder 150 caracteres').optional().nullable(),
  checkDrawerTaxId: z.string().max(20, 'El CUIT no puede exceder 20 caracteres').optional().nullable(),
  // Sólo aplica a Órdenes de Pago: si el cheque/e-cheq es propio o de un tercero (endoso)
  checkOwnership: z.enum(['OWN', 'THIRD_PARTY']).optional(),
  // Cheque de tercero (en cartera) a endosar cuando checkOwnership es THIRD_PARTY
  endorsedCheckId: z.string().uuid('Cheque inválido').optional().nullable(),
};

// Validaciones comunes para cheque/e-cheq como medio de pago
function refineCheckPayment(
  data: {
    paymentMethod: string;
    checkNumber?: string | null;
    checkBankName?: string | null;
    checkDueDate?: Date | null;
    checkDrawerName?: string | null;
    bankAccountId?: string | null;
    checkOwnership?: 'OWN' | 'THIRD_PARTY';
    endorsedCheckId?: string | null;
  },
  ctx: z.RefinementCtx,
  options: { requireDrawer?: boolean; allowOwnership?: boolean } = {}
) {
  const isCheck = data.paymentMethod === 'CHECK' || data.paymentMethod === 'ECHEQ';
  if (!isCheck) return;

  // Órdenes de pago con cheque de tercero: se endosa un cheque de la cartera, no se cargan datos
  if (options.allowOwnership && data.checkOwnership === 'THIRD_PARTY') {
    if (!data.endorsedCheckId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['endorsedCheckId'], message: 'Debe seleccionar un cheque de la cartera' });
    }
    return;
  }

  // Cheque propio (OP) o cheque recibido (cobranza): se cargan los datos del cheque
  if (!data.checkNumber) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['checkNumber'], message: 'El número de cheque es requerido' });
  }
  if (!data.checkBankName) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['checkBankName'], message: 'El banco emisor es requerido' });
  }
  if (!data.checkDueDate) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['checkDueDate'], message: 'La fecha de vencimiento es requerida' });
  }
  if (options.requireDrawer && !data.checkDrawerName) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['checkDrawerName'], message: 'El emisor (librador) es requerido' });
  }
  // e-cheq: requiere cuenta de depósito donde ingresó
  if (data.paymentMethod === 'ECHEQ' && !data.bankAccountId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['bankAccountId'], message: 'Debe indicar la cuenta de depósito del e-cheq' });
  }
}

// Schema para pago de recibo (forma de pago) — el emisor del cheque (cliente o tercero) es requerido
export const receiptPaymentSchema = z
  .object(basePaymentFields)
  .superRefine((data, ctx) => refineCheckPayment(data, ctx, { requireDrawer: true }));

// Schema para crear recibo
export const createReceiptSchema = z
  .object({
    customerId: z.string().uuid('Cliente inválido'),
    date: z.date({ message: 'La fecha es requerida' }),
    notes: z.string().max(500, 'Las notas no pueden exceder 500 caracteres').optional().nullable(),
    items: z.array(receiptItemSchema).min(1, 'Debe agregar al menos una factura a cobrar'),
    payments: z.array(receiptPaymentSchema),
    withholdings: z.array(withholdingSchema).default([]),
  })
  .refine(
    (data) => {
      // Sin pagos ni retenciones es válido (se vincula después a movimiento bancario)
      if (data.payments.length === 0 && data.withholdings.length === 0) return true;
      // Con pagos/retenciones, validar que el total sea igual al de facturas
      // Usar multiplicación por 100 y redondeo para evitar errores de punto flotante con montos grandes
      const totalItems = data.items.reduce((sum, item) => sum + Math.round(parseFloat(item.amount) * 100), 0);
      const totalPayments = data.payments.reduce((sum, payment) => sum + Math.round(parseFloat(payment.amount) * 100), 0);
      const totalWithholdings = data.withholdings.reduce((sum, w) => sum + Math.round(parseFloat(w.amount) * 100), 0);
      return totalItems === totalPayments + totalWithholdings;
    },
    {
      message: 'El total de facturas debe ser igual al total de pagos + retenciones',
      path: ['payments'],
    }
  );

// ====================================
// TYPE INFERENCE - RECEIPTS
// ====================================

export type ReceiptItemFormData = z.infer<typeof receiptItemSchema>;
export type ReceiptPaymentFormData = z.infer<typeof receiptPaymentSchema>;
export type CreateReceiptFormData = z.infer<typeof createReceiptSchema>;

// ====================================
// LABELS Y MAPPERS - RECEIPTS
// ====================================

export const PAYMENT_METHOD_LABELS = {
  CASH: 'Efectivo',
  CHECK: 'Cheque',
  ECHEQ: 'E-Cheq',
  TRANSFER: 'Transferencia',
  DEBIT_CARD: 'Tarjeta de Débito',
  CREDIT_CARD: 'Tarjeta de Crédito',
  ACCOUNT: 'Cuenta Corriente',
} as const;

export const RECEIPT_STATUS_LABELS = {
  DRAFT: 'Borrador',
  CONFIRMED: 'Confirmado',
  CANCELLED: 'Cancelado',
} as const;

export const RECEIPT_STATUS_BADGES = {
  DRAFT: 'secondary' as const,
  CONFIRMED: 'success' as const,
  CANCELLED: 'destructive' as const,
};

// ====================================
// PAYMENT ORDER SCHEMAS
// ====================================

// Schema para item de orden de pago (factura o gasto a pagar)
export const paymentOrderItemSchema = z.object({
  invoiceId: z.string().uuid('Factura inválida').optional().nullable(),
  expenseId: z.string().uuid('Gasto inválido').optional().nullable(),
  amount: z
    .string()
    .min(1, 'El monto es requerido')
    .regex(/^\d+(\.\d{1,2})?$/, 'Monto inválido (máximo 2 decimales)')
    .refine((val) => parseFloat(val) > 0, 'El monto debe ser mayor a 0'),
}).refine(
  (data) => (data.invoiceId && !data.expenseId) || (!data.invoiceId && data.expenseId),
  { message: 'Cada item debe tener una factura o un gasto, no ambos', path: ['invoiceId'] }
);

// Schema para pago de orden (forma de pago) — mismos campos, pero el cheque emitido es de la
// propia empresa, por lo que no se exige el emisor (librador)
export const paymentOrderPaymentSchema = z
  .object(basePaymentFields)
  .superRefine((data, ctx) => refineCheckPayment(data, ctx, { requireDrawer: false, allowOwnership: true }));

// Schema para crear orden de pago
export const createPaymentOrderSchema = z
  .object({
    supplierId: z.string().uuid('Proveedor inválido').optional().nullable(),
    date: z.date({ message: 'La fecha es requerida' }),
    notes: z.string().max(500, 'Las notas no pueden exceder 500 caracteres').optional().nullable(),
    items: z.array(paymentOrderItemSchema).min(1, 'Debe agregar al menos un item a pagar'),
    payments: z.array(paymentOrderPaymentSchema),
    withholdings: z.array(withholdingSchema).default([]),
  })
  .refine(
    (data) => {
      // Sin pagos ni retenciones es válido (se vincula después a movimiento bancario)
      if (data.payments.length === 0 && data.withholdings.length === 0) return true;
      // Con pagos/retenciones, validar que el total sea igual al de facturas
      // Usar multiplicación por 100 y redondeo para evitar errores de punto flotante con montos grandes
      const totalItems = data.items.reduce((sum, item) => sum + Math.round(parseFloat(item.amount) * 100), 0);
      const totalPayments = data.payments.reduce((sum, payment) => sum + Math.round(parseFloat(payment.amount) * 100), 0);
      const totalWithholdings = data.withholdings.reduce((sum, w) => sum + Math.round(parseFloat(w.amount) * 100), 0);
      return totalItems === totalPayments + totalWithholdings;
    },
    {
      message: 'El total de facturas debe ser igual al total de pagos + retenciones',
      path: ['payments'],
    }
  );

// ====================================
// TYPE INFERENCE - PAYMENT ORDERS
// ====================================

export type PaymentOrderItemFormData = z.infer<typeof paymentOrderItemSchema>;
export type PaymentOrderPaymentFormData = z.infer<typeof paymentOrderPaymentSchema>;
export type CreatePaymentOrderFormData = z.infer<typeof createPaymentOrderSchema>;

// ====================================
// LABELS Y MAPPERS - PAYMENT ORDERS
// ====================================

export const PAYMENT_ORDER_STATUS_LABELS = {
  DRAFT: 'Borrador',
  CONFIRMED: 'Confirmado',
  CANCELLED: 'Cancelado',
} as const;

export const PAYMENT_ORDER_STATUS_BADGES = {
  DRAFT: 'secondary' as const,
  CONFIRMED: 'success' as const,
  CANCELLED: 'destructive' as const,
};

// ====================================
// CHECK SCHEMAS
// ====================================

export const createCheckSchema = z.object({
  type: z.enum(['OWN', 'THIRD_PARTY'], { message: 'Debe seleccionar un tipo de cheque' }),
  checkNumber: z
    .string()
    .min(1, 'El número de cheque es requerido')
    .max(30, 'El número no puede exceder 30 caracteres'),
  bankName: z
    .string()
    .min(1, 'El banco es requerido')
    .max(100, 'El banco no puede exceder 100 caracteres'),
  branch: z.string().max(100, 'La sucursal no puede exceder 100 caracteres').optional().nullable(),
  accountNumber: z.string().max(50, 'La cuenta no puede exceder 50 caracteres').optional().nullable(),
  amount: z
    .string()
    .min(1, 'El monto es requerido')
    .regex(/^\d+(\.\d{1,2})?$/, 'Monto inválido (máximo 2 decimales)')
    .refine((val) => parseFloat(val) > 0, 'El monto debe ser mayor a 0'),
  issueDate: z.date({ message: 'La fecha de emisión es requerida' }),
  dueDate: z.date({ message: 'La fecha de vencimiento es requerida' }),
  drawerName: z
    .string()
    .min(1, 'El librador es requerido')
    .max(200, 'El librador no puede exceder 200 caracteres'),
  drawerTaxId: z.string().max(13, 'El CUIT no puede exceder 13 caracteres').optional().nullable(),
  payeeName: z.string().max(200, 'El beneficiario no puede exceder 200 caracteres').optional().nullable(),
  customerId: z.string().uuid('Cliente inválido').optional().nullable(),
  supplierId: z.string().uuid('Proveedor inválido').optional().nullable(),
  notes: z.string().max(500, 'Las notas no pueden exceder 500 caracteres').optional().nullable(),
});

// Schema para editar la metadata de un cheque (sólo permitido en cartera/PORTFOLIO)
export const updateCheckSchema = z.object({
  checkId: z.string().uuid('Cheque inválido'),
  checkNumber: z
    .string()
    .min(1, 'El número de cheque es requerido')
    .max(30, 'El número no puede exceder 30 caracteres'),
  bankName: z
    .string()
    .min(1, 'El banco es requerido')
    .max(100, 'El banco no puede exceder 100 caracteres'),
  branch: z.string().max(100, 'La sucursal no puede exceder 100 caracteres').optional().nullable(),
  accountNumber: z.string().max(50, 'La cuenta no puede exceder 50 caracteres').optional().nullable(),
  issueDate: z.date({ message: 'La fecha de emisión es requerida' }),
  dueDate: z.date({ message: 'La fecha de vencimiento es requerida' }),
  drawerName: z
    .string()
    .min(1, 'El librador es requerido')
    .max(200, 'El librador no puede exceder 200 caracteres'),
  drawerTaxId: z.string().max(13, 'El CUIT no puede exceder 13 caracteres').optional().nullable(),
  payeeName: z.string().max(200, 'El beneficiario no puede exceder 200 caracteres').optional().nullable(),
  notes: z.string().max(500, 'Las notas no pueden exceder 500 caracteres').optional().nullable(),
});

export const depositCheckSchema = z.object({
  checkId: z.string().uuid('Cheque inválido'),
  bankAccountId: z.string().uuid('Cuenta bancaria requerida'),
  depositDate: z.date({ message: 'La fecha de depósito es requerida' }),
});

export const endorseCheckSchema = z.object({
  checkId: z.string().uuid('Cheque inválido'),
  endorsedToName: z
    .string()
    .min(1, 'El nombre del beneficiario es requerido')
    .max(200, 'No puede exceder 200 caracteres'),
  endorsedToTaxId: z.string().max(13, 'El CUIT no puede exceder 13 caracteres').optional().nullable(),
  supplierId: z.string().uuid('Proveedor inválido').optional().nullable(),
  endorsedDate: z.date({ message: 'La fecha de endoso es requerida' }),
});

// ====================================
// TYPE INFERENCE - CHECKS
// ====================================

export type CreateCheckFormData = z.infer<typeof createCheckSchema>;
export type UpdateCheckFormData = z.infer<typeof updateCheckSchema>;
export type DepositCheckFormData = z.infer<typeof depositCheckSchema>;
export type EndorseCheckFormData = z.infer<typeof endorseCheckSchema>;

// ====================================
// LABELS Y MAPPERS - CHECKS
// ====================================

export const CHECK_TYPE_LABELS = {
  OWN: 'Propio',
  THIRD_PARTY: 'Tercero',
} as const;

export const CHECK_STATUS_LABELS = {
  PORTFOLIO: 'En Cartera',
  DEPOSITED: 'Depositado',
  CLEARED: 'Acreditado',
  REJECTED: 'Rechazado',
  ENDORSED: 'Endosado',
  DELIVERED: 'Entregado',
  CASHED: 'Cobrado',
  VOIDED: 'Anulado',
} as const;

export const CHECK_STATUS_BADGES = {
  PORTFOLIO: 'default' as const,
  DEPOSITED: 'warning' as const,
  CLEARED: 'success' as const,
  REJECTED: 'destructive' as const,
  ENDORSED: 'secondary' as const,
  DELIVERED: 'default' as const,
  CASHED: 'success' as const,
  VOIDED: 'destructive' as const,
};

// ====================================
// CASHFLOW PROJECTION SCHEMAS
// ====================================

export const createProjectionSchema = z.object({
  type: z.enum(['INCOME', 'EXPENSE'], { message: 'Debe seleccionar un tipo' }),
  category: z.enum(['SALES', 'PURCHASES', 'SALARIES', 'TAXES', 'RENT', 'SERVICES', 'OTHER'], {
    message: 'Debe seleccionar una categoría',
  }),
  description: z
    .string()
    .min(1, 'La descripción es requerida')
    .max(300, 'La descripción no puede exceder 300 caracteres'),
  amount: z
    .string()
    .min(1, 'El monto es requerido')
    .regex(/^\d+(\.\d{1,2})?$/, 'Monto inválido (máximo 2 decimales)')
    .refine((val) => parseFloat(val) > 0, 'El monto debe ser mayor a 0'),
  date: z.date({ message: 'La fecha es requerida' }),
  isRecurring: z.boolean().default(false),
  notes: z.string().max(500, 'Las notas no pueden exceder 500 caracteres').optional().nullable(),
});

// ====================================
// TYPE INFERENCE - PROJECTIONS
// ====================================

export type CreateProjectionFormData = z.infer<typeof createProjectionSchema>;

// ====================================
// LABELS Y MAPPERS - PROJECTIONS
// ====================================

export const PROJECTION_TYPE_LABELS = {
  INCOME: 'Ingreso',
  EXPENSE: 'Egreso',
} as const;

export const PROJECTION_TYPE_BADGES = {
  INCOME: 'default' as const,
  EXPENSE: 'destructive' as const,
};

export const PROJECTION_CATEGORY_LABELS = {
  SALES: 'Ventas',
  PURCHASES: 'Compras',
  SALARIES: 'Sueldos',
  TAXES: 'Impuestos',
  RENT: 'Alquiler',
  SERVICES: 'Servicios',
  OTHER: 'Otros',
} as const;

// ====================================
// PROJECTION STATUS LABELS
// ====================================

export const PROJECTION_STATUS_LABELS = {
  PENDING: 'Pendiente',
  PARTIAL: 'Parcial',
  CONFIRMED: 'Confirmada',
} as const;

export const PROJECTION_STATUS_BADGES = {
  PENDING: 'secondary' as const,
  PARTIAL: 'warning' as const,
  CONFIRMED: 'success' as const,
};

// ====================================
// LINK DOCUMENT SCHEMA
// ====================================

export const linkDocumentToProjectionSchema = z
  .object({
    projectionId: z.string().uuid('ID de proyección inválido'),
    amount: z
      .string()
      .min(1, 'El monto es requerido')
      .regex(/^\d+(\.\d{1,2})?$/, 'Monto inválido (máximo 2 decimales)')
      .refine((val) => parseFloat(val) > 0, 'El monto debe ser mayor a 0'),
    salesInvoiceId: z.string().uuid().optional().nullable(),
    purchaseInvoiceId: z.string().uuid().optional().nullable(),
    expenseId: z.string().uuid().optional().nullable(),
    notes: z.string().max(500, 'Las notas no pueden exceder 500 caracteres').optional().nullable(),
  })
  .refine(
    (data) => {
      const fks = [data.salesInvoiceId, data.purchaseInvoiceId, data.expenseId].filter(Boolean);
      return fks.length === 1;
    },
    { message: 'Debe vincular exactamente un documento' }
  );

export type LinkDocumentFormData = z.infer<typeof linkDocumentToProjectionSchema>;
