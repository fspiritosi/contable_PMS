/**
 * Estados de un comprobante confirmado que admiten corrección en cadena (TSK-792): se
 * editan, eliminan o anulan con la propuesta de corrección. Puro: lo usa también la UI.
 */
export const CORRECTABLE_STATUSES = ['CONFIRMED', 'PARTIAL_PAID', 'PAID'] as const;

export function isCorrectableStatus(status: string): boolean {
  return (CORRECTABLE_STATUSES as readonly string[]).includes(status);
}
