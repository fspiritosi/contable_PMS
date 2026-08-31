import moment from 'moment';
import { z } from 'zod';

import { LINE_ERROR_MESSAGES, validateLines } from './lines-calc';

/**
 * Convierte la fecha del formulario ("YYYY-MM-DD") a Date.
 *
 * Se ancla al mediodía UTC, igual que el resto del sistema (ver
 * `commercial/features/expenses/actions.server.ts`). Interpretarla en hora local
 * hacía que, con el servidor en UTC y el usuario en UTC-3, la fecha se guardara
 * un día antes de la elegida (TSK-483).
 *
 * Al leerla hay que usar `moment.utc(...)`, nunca `moment(...)`.
 */
export function parseFundMovementDate(date: string): Date {
  return moment.utc(date, 'YYYY-MM-DD').startOf('day').add(12, 'hours').toDate();
}

/** Formatea una fecha guardada por `parseFundMovementDate` para mostrarla. */
export function formatFundMovementDate(date: Date | string, format = 'DD/MM/YYYY'): string {
  return moment.utc(date).format(format);
}

/** Tipos de movimiento de fondos (coinciden con el enum Prisma FundMovementType). */
export const FUND_MOVEMENT_TYPES = [
  'PARTNER_CONTRIBUTION',
  'PARTNER_WITHDRAWAL',
  'ACCOUNT_TRANSFER',
  'BANK_CHARGES',
] as const;

export type FundMovementTypeValue = (typeof FUND_MOVEMENT_TYPES)[number];

export const FUND_MOVEMENT_TYPE_LABELS: Record<FundMovementTypeValue, string> = {
  PARTNER_CONTRIBUTION: 'Aporte de socio',
  PARTNER_WITHDRAWAL: 'Retiro de socio',
  ACCOUNT_TRANSFER: 'Transferencia entre cuentas',
  BANK_CHARGES: 'Gastos e impuestos bancarios',
};

/**
 * Referencia a un origen/destino de fondos. Es un banco o una caja concretos,
 * codificados como "BANK:<uuid>" o "CASH:<uuid>". El sistema deriva la cuenta
 * contable de la entidad para el asiento y actualiza su saldo.
 */
export type FundSourceKind = 'BANK' | 'CASH';

const fundRefRegex = /^(BANK|CASH):[0-9a-fA-F-]{36}$/;

export function parseFundRef(ref: string): { kind: FundSourceKind; id: string } | null {
  if (!fundRefRegex.test(ref)) return null;
  const [kind, id] = ref.split(':');
  return { kind: kind as FundSourceKind, id };
}

const amountRegex = /^\d+(\.\d{1,2})?$/;

export const fundMovementSchema = z
  .object({
    type: z.enum(FUND_MOVEMENT_TYPES),
    date: z.string().min(1, 'La fecha es requerida'),
    // Opcional en el schema base: BANK_CHARGES no usa este campo (lo calcula
    // el servidor sumando los conceptos), así que su validación completa
    // -requerido, formato y "> 0"- queda condicionada en el `superRefine` de
    // abajo, igual que el resto de las reglas por tipo. Antes exigía formato
    // acá siempre, y el único llamador que existía se salvaba mandando
    // '0' -un sentinela sin sentido de dominio-; cualquier otro consumidor
    // futuro de este schema que mandara '' para BANK_CHARGES caía en un
    // error silencioso, porque el campo Monto está oculto para ese tipo.
    amount: z.string().optional(),
    description: z.string().min(2, 'La descripción es requerida'),
    // Banco/caja de donde salen los fondos (retiro / transferencia): "BANK:id" | "CASH:id"
    sourceFund: z.string().optional().or(z.literal('')),
    // Banco/caja a donde entran los fondos (aporte / transferencia): "BANK:id" | "CASH:id"
    destinationFund: z.string().optional().or(z.literal('')),
    // Socio (aporte / retiro), informativo
    partnerId: z.string().uuid().optional().or(z.literal('')),
    // Conceptos del débito bancario. Solo los usa BANK_CHARGES (TSK-585).
    //
    // `.optional()` en lugar de `.default([])`: el `default` hace que el tipo
    // de entrada del formulario (antes de validar) y el de salida (ya
    // validado) diverjan, y react-hook-form + zodResolver no aceptan esa
    // asimetría sin declarar un tercer genérico en `useForm` (mismo problema,
    // preexistente, documentado en `purchases/features/invoices/shared/validators.ts`
    // con `costCenterAllocations`).
    lines: z
      .array(
        z.object({
          accountId: z.string(),
          description: z.string(),
          amount: z.string(),
        })
      )
      .optional(),
  })
  .superRefine((data, ctx) => {
    const validRef = (v?: string) => Boolean(v && parseFundRef(v));

    // El total de los gastos bancarios lo calcula el servidor sumando los
    // conceptos, así que este campo no aplica para ese tipo y no se valida
    // en absoluto (TSK-585): ni requerido, ni formato, ni "> 0".
    if (data.type !== 'BANK_CHARGES') {
      if (!data.amount) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['amount'],
          message: 'El monto es requerido',
        });
      } else if (!amountRegex.test(data.amount)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['amount'],
          message: 'Monto inválido (hasta 2 decimales)',
        });
      } else if (!(parseFloat(data.amount) > 0)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['amount'],
          message: 'El monto debe ser mayor a 0',
        });
      }
    }

    if (data.type === 'PARTNER_CONTRIBUTION') {
      if (!validRef(data.destinationFund)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['destinationFund'],
          message: 'Seleccioná el banco o caja donde ingresan los fondos',
        });
      }
    } else if (data.type === 'PARTNER_WITHDRAWAL') {
      if (!validRef(data.sourceFund)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['sourceFund'],
          message: 'Seleccioná el banco o caja de donde salen los fondos',
        });
      }
    } else if (data.type === 'ACCOUNT_TRANSFER') {
      if (!validRef(data.sourceFund)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['sourceFund'],
          message: 'Seleccioná el banco o caja de origen',
        });
      }
      if (!validRef(data.destinationFund)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['destinationFund'],
          message: 'Seleccioná el banco o caja de destino',
        });
      }
      if (data.sourceFund && data.destinationFund && data.sourceFund === data.destinationFund) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['destinationFund'],
          message: 'El destino debe ser distinto del origen',
        });
      }
    } else if (data.type === 'BANK_CHARGES') {
      if (!validRef(data.sourceFund)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['sourceFund'],
          message: 'Seleccioná el banco o caja de donde salen los fondos',
        });
      }

      const problema = validateLines(data.lines ?? []);
      if (problema) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: problema.index === -1 ? ['lines'] : ['lines', problema.index],
          message: LINE_ERROR_MESSAGES[problema.error],
        });
      }
    }
  });

export type FundMovementFormInput = z.infer<typeof fundMovementSchema>;
