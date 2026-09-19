import { z } from 'zod';

/**
 * Cuenta contable opcional del tipo de equipo (TSK-724c). `null` = "sin asignar"
 * (se usa la cuenta por defecto de Contabilidad → Configuración); ausente = no se toca.
 */
const accountField = z.string().uuid().nullish();

/**
 * Schema del formulario de Tipos de Equipo. Las tres cuentas de Bienes de Uso
 * (Bienes de Uso, Amortización acumulada, Gasto de amortización) son opcionales:
 * el combo ya filtra por tipo de cuenta y la action valida que sea de la empresa.
 */
export const vehicleTypeSchema = z.object({
  name: z.string().min(2, 'El nombre debe tener al menos 2 caracteres'),
  hasHitch: z.boolean(),
  isTractorUnit: z.boolean(),
  fixedAssetAccountId: accountField,
  accumulatedDepreciationAccountId: accountField,
  depreciationExpenseAccountId: accountField,
});

export type VehicleTypeFormData = z.infer<typeof vehicleTypeSchema>;
