import { toast } from 'sonner';

import type { ActionResult } from '@/shared/lib/action-result';

/**
 * Toasts del resultado de depositar, rechazar, debitar o anular un cheque (TSK-735):
 * el error tal cual, o el éxito seguido de cada aviso (p. ej. "no genera asiento").
 * Devuelve si la acción salió bien.
 */
export function notifyCheckActionResult(
  result: ActionResult<{ warnings: string[] }>,
  successMessage: string
): boolean {
  if (!result.success) {
    toast.error(result.error);
    return false;
  }
  toast.success(successMessage);
  for (const warning of result.warnings) toast.warning(warning);
  return true;
}
