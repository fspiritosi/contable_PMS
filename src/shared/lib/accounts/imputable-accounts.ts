import type { AccountType } from '@/generated/prisma/enums';
import type { Prisma } from '@/generated/prisma/client';

/**
 * Opciones para construir el filtro de cuentas imputables.
 */
export interface BuildImputableAccountsWhereOptions {
  /** Empresa dueña de las cuentas. */
  companyId: string;
  /** Restringir a ciertos tipos (Activo, Pasivo, etc.). Si se omite, cualquier tipo. */
  types?: AccountType[];
  /**
   * Fecha de referencia para excluir cuentas con corte de deshabilitado ya efectivo.
   * Por defecto: hoy. Una cuenta con `disabledFrom <= atDate` se excluye.
   */
  atDate?: Date;
}

/**
 * Construye el objeto `where` de Prisma para traer cuentas **imputables**
 * (hojas activas y vigentes), opcionalmente restringido a ciertos `types`.
 *
 * Función PURA: NO ejecuta Prisma ni verifica permisos. Cada action de cada
 * módulo la usa dentro de su propia query (con su `checkPermission` y `select`),
 * de modo que el criterio de imputable se comparte sin imports cross-module.
 *
 * Reglas:
 * - `isLeaf: true`  → solo cuentas hoja (una cuenta con hijas nunca es imputable).
 * - `isActive: true` → excluye soft-deletes globales.
 * - `type: { in }`  → sólo si se pasan `types`.
 * - corte por ejercicio → excluye cuentas cuyo `disabledFrom` ya está vigente a `atDate`.
 */
export function buildImputableAccountsWhere(
  options: BuildImputableAccountsWhereOptions
): Prisma.AccountWhereInput {
  const { companyId, types, atDate } = options;
  const referenceDate = atDate ?? new Date();

  return {
    companyId,
    isActive: true,
    isLeaf: true,
    ...(types && types.length > 0 ? { type: { in: types } } : {}),
    OR: [{ disabledFrom: null }, { disabledFrom: { gt: referenceDate } }],
  };
}
