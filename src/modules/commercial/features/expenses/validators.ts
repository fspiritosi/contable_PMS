import { z } from 'zod';
import type { ExpenseStatus } from '@/generated/prisma/enums';

// ============================================
// CONSTANTES - Etiquetas para UI
// ============================================

export const EXPENSE_STATUS_LABELS: Record<ExpenseStatus, string> = {
  DRAFT: 'Borrador',
  CONFIRMED: 'Confirmado',
  PARTIAL_PAID: 'Parcialmente pagado',
  PAID: 'Pagado',
  CANCELLED: 'Anulado',
};

// ============================================
// SCHEMAS ZOD
// ============================================

export const expenseFormSchema = z.object({
  description: z.string().min(1, 'La descripción es requerida'),
  amount: z.string().regex(/^\d+(\.\d{1,2})?$/, 'Monto inválido'),
  date: z.date({ message: 'La fecha es requerida' }),
  dueDate: z.date().optional().nullable(),
  categoryId: z.string().uuid('Selecciona una categoría'),
  supplierId: z.string().uuid().optional().nullable().or(z.literal('')),
  notes: z.string().optional().nullable(),
});

export type ExpenseFormInput = z.infer<typeof expenseFormSchema>;

export const expenseCategoryFormSchema = z.object({
  name: z.string().min(1, 'El nombre es requerido'),
  description: z.string().optional().nullable(),
  /** TSK-757: cuenta contable propia. undefined = no tocar (update); null = usar la por defecto. */
  accountId: z.string().uuid('Cuenta contable inválida').nullable().optional(),
});

export type ExpenseCategoryFormInput = z.infer<typeof expenseCategoryFormSchema>;
