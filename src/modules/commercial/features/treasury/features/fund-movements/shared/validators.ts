import { z } from 'zod';

/** Tipos de movimiento de fondos (coinciden con el enum Prisma FundMovementType). */
export const FUND_MOVEMENT_TYPES = [
  'PARTNER_CONTRIBUTION',
  'PARTNER_WITHDRAWAL',
  'ACCOUNT_TRANSFER',
] as const;

export type FundMovementTypeValue = (typeof FUND_MOVEMENT_TYPES)[number];

export const FUND_MOVEMENT_TYPE_LABELS: Record<FundMovementTypeValue, string> = {
  PARTNER_CONTRIBUTION: 'Aporte de socio',
  PARTNER_WITHDRAWAL: 'Retiro de socio',
  ACCOUNT_TRANSFER: 'Transferencia entre cuentas',
};

const amountRegex = /^\d+(\.\d{1,2})?$/;

export const fundMovementSchema = z
  .object({
    type: z.enum(FUND_MOVEMENT_TYPES),
    date: z.string().min(1, 'La fecha es requerida'),
    amount: z
      .string()
      .min(1, 'El monto es requerido')
      .regex(amountRegex, 'Monto inválido (hasta 2 decimales)')
      .refine((v) => parseFloat(v) > 0, 'El monto debe ser mayor a 0'),
    description: z.string().min(2, 'La descripción es requerida'),
    // Cuenta de la que salen los fondos (retiro / transferencia)
    sourceAccountId: z.string().uuid().optional().or(z.literal('')),
    // Cuenta a la que entran los fondos (aporte / transferencia)
    destinationAccountId: z.string().uuid().optional().or(z.literal('')),
    // Socio (aporte / retiro), informativo
    partnerId: z.string().uuid().optional().or(z.literal('')),
  })
  .superRefine((data, ctx) => {
    if (data.type === 'PARTNER_CONTRIBUTION') {
      if (!data.destinationAccountId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['destinationAccountId'],
          message: 'Seleccioná la cuenta donde ingresan los fondos',
        });
      }
    } else if (data.type === 'PARTNER_WITHDRAWAL') {
      if (!data.sourceAccountId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['sourceAccountId'],
          message: 'Seleccioná la cuenta de donde salen los fondos',
        });
      }
    } else if (data.type === 'ACCOUNT_TRANSFER') {
      if (!data.sourceAccountId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['sourceAccountId'],
          message: 'Seleccioná la cuenta origen',
        });
      }
      if (!data.destinationAccountId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['destinationAccountId'],
          message: 'Seleccioná la cuenta destino',
        });
      }
      if (
        data.sourceAccountId &&
        data.destinationAccountId &&
        data.sourceAccountId === data.destinationAccountId
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['destinationAccountId'],
          message: 'La cuenta destino debe ser distinta de la origen',
        });
      }
    }
  });

export type FundMovementFormInput = z.infer<typeof fundMovementSchema>;
