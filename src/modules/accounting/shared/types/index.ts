import { AccountNature, AccountType, JournalEntryStatus } from '@/generated/prisma/enums';
import { z } from 'zod';

// Validación de cuenta contable
export const accountSchema = z.object({
  code: z.string().min(1, 'El código es requerido'),
  name: z.string().min(2, 'El nombre debe tener al menos 2 caracteres'),
  type: z.nativeEnum(AccountType),
  nature: z.nativeEnum(AccountNature),
  description: z.string().optional(),
  parentId: z.string().uuid().optional(),
});

export type CreateAccountInput = z.infer<typeof accountSchema>;

// Validación de línea de asiento
export const journalEntryLineSchema = z.object({
  accountId: z.string().uuid(),
  description: z.string().optional(),
  debit: z.string().regex(/^\d+(\.\d{1,2})?$/, 'Debe ser un número con máximo 2 decimales'),
  credit: z.string().regex(/^\d+(\.\d{1,2})?$/, 'Debe ser un número con máximo 2 decimales'),
  customerId: z.string().uuid().optional(),
  supplierId: z.string().uuid().optional(),
  costCenterId: z.string().uuid().optional(),
});

export const journalEntrySchema = z.object({
  date: z.date(),
  description: z.string().min(2, 'La descripción debe tener al menos 2 caracteres'),
  lines: z.array(journalEntryLineSchema)
    .min(2, 'El asiento debe tener al menos 2 líneas')
    .refine(
      (lines) => {
        const totalDebit = lines.reduce((sum, line) => sum + Number(line.debit), 0);
        const totalCredit = lines.reduce((sum, line) => sum + Number(line.credit), 0);
        return Math.abs(totalDebit - totalCredit) < 0.01;
      },
      { message: 'El asiento debe estar balanceado (Debe = Haber)' }
    )
    .refine(
      (lines) => lines.every(line => {
        const debit = Number(line.debit);
        const credit = Number(line.credit);
        return (debit > 0 && credit === 0) || (credit > 0 && debit === 0);
      }),
      { message: 'Una línea debe tener solo Debe o solo Haber' }
    )
    .refine(
      (lines) => lines.every(line => {
        const debit = Number(line.debit);
        const credit = Number(line.credit);
        return debit >= 0 && credit >= 0;
      }),
      { message: 'Los montos deben ser positivos' }
    ),
});

export type CreateJournalEntryInput = z.infer<typeof journalEntrySchema>;
export type JournalEntryLineInput = z.infer<typeof journalEntryLineSchema>;

// Validación de configuración contable
export const accountingSettingsSchema = z.object({
  fiscalYearStart: z.date(),
  fiscalYearEnd: z.date(),
}).refine(
  (data) => data.fiscalYearEnd > data.fiscalYearStart,
  { message: 'La fecha de fin debe ser posterior a la fecha de inicio' }
);

export type CreateAccountingSettingsInput = z.infer<typeof accountingSettingsSchema>;

// Tipos de respuesta
export interface AccountWithChildren {
  id: string;
  code: string;
  name: string;
  type: AccountType;
  nature: AccountNature;
  description?: string | null;
  isActive: boolean;
  isLeaf: boolean;
  disabledFrom?: Date | null;
  disabledFromFiscalYearId?: string | null;
  parentId?: string | null;
  children: AccountWithChildren[];
}

export interface JournalEntryWithLines {
  id: string;
  companyId: string;
  number: number;
  date: Date;
  description: string;
  status: JournalEntryStatus;
  postDate?: Date | null;
  originalEntryId?: string | null;
  reversalEntryId?: string | null;
  reversedBy?: string | null;
  reversedAt?: Date | null;
  originalEntry?: { number: number } | null;
  reversalEntry?: { number: number } | null;
  lines: {
    id: string;
    accountId: string;
    description?: string | null;
    debit: number;
    credit: number;
    account: {
      code: string;
      name: string;
    };
  }[];
  salesInvoices?: { id: string; fullNumber: string }[];
  purchaseInvoices?: { id: string; fullNumber: string }[];
  receipts?: { id: string; fullNumber: string }[];
  paymentOrders?: { id: string; fullNumber: string }[];
}
