/**
 * Resultado de una mutación de Server Action (TSK-481, promovido a shared en
 * TSK-721).
 *
 * Los errores esperables viajan como dato, no como excepción: en producción
 * Next.js redacta el mensaje de cualquier `Error` lanzado desde un Server
 * Action y el usuario terminaba viendo "An error occurred in the Server
 * Components render... a digest property is included". Con este contrato el
 * cliente hace `if (!result.success) toast.error(result.error)`.
 *
 * Uso típico en el action:
 *
 *   try {
 *     if (!invoice) throw new BusinessError('Factura no encontrada');
 *     ...
 *     return { success: true, id };
 *   } catch (error) {
 *     return toActionResult(error, 'Error al confirmar factura');
 *   }
 */

import { logger } from '@/shared/lib/logger';

/** Rama de error del resultado: siempre con un mensaje mostrable al usuario. */
export interface ActionFailure {
  success: false;
  error: string;
}

/**
 * `{ success: true, ...T }` o `{ success: false, error }`. `T` son los datos
 * extra que devuelve la acción cuando sale bien (por defecto, ninguno).
 */
export type ActionResult<T extends object = Record<never, never>> =
  | ({ success: true } & T)
  | ActionFailure;

/**
 * Condición esperable y explicable al usuario (falta configuración, cuenta
 * no imputable, comprobante ya confirmado, período cerrado). Se distingue de
 * un fallo real para poder devolver su mensaje tal cual.
 */
export class BusinessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BusinessError';
  }
}

/** Mensaje que ve el usuario cuando el fallo no es una `BusinessError`. */
export const UNEXPECTED_ERROR_MESSAGE =
  'Ocurrió un error inesperado. Volvé a intentar o avisá al equipo si persiste.';

/**
 * Traduce una excepción al resultado que consume el cliente. Una
 * `BusinessError` viaja con su mensaje; cualquier otra cosa se loguea con
 * `contexto` y se reemplaza por el mensaje genérico.
 */
export function toActionResult(error: unknown, contexto: string): ActionFailure {
  if (error instanceof BusinessError) {
    return { success: false, error: error.message };
  }
  logger.error(contexto, { data: { error } });
  return { success: false, error: UNEXPECTED_ERROR_MESSAGE };
}
