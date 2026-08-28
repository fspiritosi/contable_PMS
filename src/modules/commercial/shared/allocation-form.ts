import { z } from 'zod';

import {
  ALLOCATION_ERROR_MESSAGES,
  validateAllocations,
  type CostCenterAllocation,
} from './cost-center';

/**
 * Reparto de una línea, tal como lo maneja el formulario (TSK-583).
 *
 * La validación es la misma función que usa el server action, así que el
 * formulario y el servidor no pueden divergir en el criterio.
 */
export const allocationFieldSchema = z
  .array(
    z.object({
      costCenterId: z.string().uuid('Elegí un centro de costo'),
      percentage: z.number(),
    })
  )
  .superRefine((allocations, ctx) => {
    const error = validateAllocations(allocations as CostCenterAllocation[]);
    if (!error) return;

    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: ALLOCATION_ERROR_MESSAGES[error],
    });
  });

export type AllocationFieldValue = z.infer<typeof allocationFieldSchema>;
