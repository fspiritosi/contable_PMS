import { z } from 'zod';

/**
 * Valuación de inversiones al cierre del ejercicio (TSK-793). Una línea por
 * tenencia: o el valor al cierre o el precio por nominal (el servidor multiplica
 * por los nominales a la fecha de cierre), nunca los dos.
 */

const amountRegex = /^\d+(\.\d{1,2})?$/;
// El precio por nominal admite hasta 6 decimales, como en la compra y la venta.
const priceRegex = /^\d+(\.\d{1,6})?$/;

const filled = (value: string | undefined): value is string =>
  value !== undefined && value.trim() !== '';

const ONE_VALUE_MESSAGE = 'Cargá el valor al cierre o el precio por nominal';

const valuationLineSchema = z
  .object({
    holdingId: z.string().uuid('Tenencia inválida'),
    valuedAmount: z.string().optional(),
    unitPrice: z.string().optional(),
  })
  .superRefine((line, ctx) => {
    const hasAmount = filled(line.valuedAmount);
    const hasPrice = filled(line.unitPrice);
    if (hasAmount === hasPrice) {
      ctx.addIssue({ code: 'custom', path: ['valuedAmount'], message: ONE_VALUE_MESSAGE });
      return;
    }
    if (hasAmount && !amountRegex.test(line.valuedAmount?.trim() ?? '')) {
      ctx.addIssue({ code: 'custom', path: ['valuedAmount'], message: 'Valor al cierre inválido' });
    }
    if (hasPrice && !priceRegex.test(line.unitPrice?.trim() ?? '')) {
      ctx.addIssue({ code: 'custom', path: ['unitPrice'], message: 'Precio por nominal inválido' });
    }
  })
  // Los campos vacíos del formulario salen como "no cargado".
  .transform(({ holdingId, valuedAmount, unitPrice }) => ({
    holdingId,
    ...(filled(valuedAmount) ? { valuedAmount: valuedAmount.trim() } : {}),
    ...(filled(unitPrice) ? { unitPrice: unitPrice.trim() } : {}),
  }));

export const valuationSchema = z
  .object({
    fiscalYearId: z.string().uuid('Elegí el ejercicio'),
    lines: z.array(valuationLineSchema),
  })
  .superRefine((value, ctx) => {
    const ids = value.lines.map((line) => line.holdingId);
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({ code: 'custom', path: ['lines'], message: 'Hay tenencias repetidas' });
    }
  });

export type ValuationFormInput = z.input<typeof valuationSchema>;
export type ValuationData = z.output<typeof valuationSchema>;
