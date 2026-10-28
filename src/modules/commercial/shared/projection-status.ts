import type { ProjectionStatus } from '@/generated/prisma/enums';

/** Estado de una proyección de cashflow según lo confirmado por sus vínculos. */
export function projectionStatusFor(confirmedAmount: number, amount: number): ProjectionStatus {
  if (confirmedAmount >= amount) return 'CONFIRMED';
  if (confirmedAmount > 0) return 'PARTIAL';
  return 'PENDING';
}
