import { ConceptAccountMode, ConceptUsage } from '@/generated/prisma/enums';
import { CONCEPT_CONFIG_ERROR_MESSAGES, validateConceptConfig } from '@/shared/lib/concepts/usages';
import { z } from 'zod';

/**
 * Esquema del form de conceptos (TSK-791). Las reglas de configuración viven en
 * `validateConceptConfig` (shared); acá solo se marca cada error en su campo.
 */
export const conceptSchema = z
  .object({
    name: z.string().trim().min(1, 'El nombre del concepto es obligatorio.').max(100),
    usages: z.array(z.nativeEnum(ConceptUsage)),
    accountMode: z.nativeEnum(ConceptAccountMode),
    // El combo emite null al limpiar; '' queda por compatibilidad con inputs vacíos.
    accountId: z.string().uuid('Cuenta contable inválida').or(z.literal('')).nullable().optional(),
  })
  .superRefine((data, ctx) => {
    const error = validateConceptConfig({
      name: data.name,
      usages: data.usages,
      accountMode: data.accountMode,
      accountId: data.accountId || null,
    });
    if (!error || error === 'NAME_REQUIRED') return;
    const path =
      error === 'ACCOUNT_REQUIRED'
        ? 'accountId'
        : error === 'PARTNER_MODE_NOT_ALLOWED'
          ? 'accountMode'
          : 'usages'; // NO_USAGES y NO_COMMON_ACCOUNT_TYPE
    ctx.addIssue({ code: 'custom', path: [path], message: CONCEPT_CONFIG_ERROR_MESSAGES[error] });
  });

export type ConceptFormInput = z.input<typeof conceptSchema>;
export type ConceptFormData = z.output<typeof conceptSchema>;
