import { z } from 'zod';

import { INSTRUMENT_TYPE_TRAITS } from './types';

const INSTRUMENT_TYPES = [
  'STOCK',
  'CEDEAR',
  'BOND',
  'OPTION',
  'LETTER',
  'FUTURE',
  'TENDER',
  'CORPORATE_BOND',
  'MUTUAL_FUND',
  'TRUST',
  'REPO',
  'FIXED_TERM',
] as const;

/** Alta y edición de una tenencia (TSK-793). La moneda es ARS fija. */
export const holdingFormSchema = z
  .object({
    bankAccountId: z.string().uuid('Elegí el banco o broker donde está la tenencia'),
    instrumentType: z.enum(INSTRUMENT_TYPES, { message: 'Elegí el tipo de instrumento' }),
    name: z
      .string()
      .trim()
      .min(2, 'El nombre debe tener al menos 2 caracteres')
      .max(100, 'El nombre no puede superar los 100 caracteres'),
    // 'YYYY-MM-DD'; vacío = sin vencimiento.
    maturityDate: z
      .string()
      .regex(/^(\d{4}-\d{2}-\d{2})?$/, 'Fecha inválida')
      .optional(),
    accountId: z.string().uuid('Elegí la cuenta contable de la tenencia'),
  })
  .superRefine((value, ctx) => {
    if (value.maturityDate && !INSTRUMENT_TYPE_TRAITS[value.instrumentType].hasMaturity) {
      ctx.addIssue({
        code: 'custom',
        path: ['maturityDate'],
        message: 'Este tipo de instrumento no tiene vencimiento',
      });
    }
  });

export type HoldingFormInput = z.input<typeof holdingFormSchema>;
export type HoldingFormData = z.output<typeof holdingFormSchema>;
