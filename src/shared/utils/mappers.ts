/**
 * Mappers de enums de Prisma a labels para UI
 * IMPORTANTE: Estos mapeos DEBEN usar los tipos de Prisma para garantizar consistencia
 */

import type {
  CostType,
  Currency,
  CustomerTaxCondition,
  DocumentAppliesTo,
  DocumentState,
  EducationLevel,
  EmployeeStatus,
  Gender,
  IdentityDocumentType,
  MaritalStatus,
  SupplierTaxCondition,
  TerminationReason,
  UnionAffiliationStatus,
  VehicleCondition,
  VehicleTitularityType,
  VehicleStatus,
  VehicleTerminationReason,
} from '@/generated/prisma/enums';

// ============================================
// TIPOS DE BADGE
// ============================================

export type BadgeVariant = 'default' | 'secondary' | 'destructive' | 'outline' | 'success' | 'warning';

export interface BadgeConfig {
  label: string;
  variant: BadgeVariant;
}

// ============================================
// TIPO DE DOCUMENTO DE IDENTIDAD
// ============================================

export const identityDocumentTypeLabels: Record<IdentityDocumentType, string> = {
  DNI: 'DNI',
  LE: 'Libreta de Enrolamiento',
  LC: 'Libreta Cívica',
  PASSPORT: 'Pasaporte',
};

// ============================================
// CONDICIÓN FRENTE AL IVA
// ============================================

export const customerTaxConditionLabels: Record<CustomerTaxCondition, string> = {
  RESPONSABLE_INSCRIPTO: 'Responsable Inscripto',
  MONOTRIBUTISTA: 'Monotributista',
  EXENTO: 'Exento',
  CONSUMIDOR_FINAL: 'Consumidor Final',
};

export const supplierTaxConditionLabels: Record<SupplierTaxCondition, string> = {
  RESPONSABLE_INSCRIPTO: 'Responsable Inscripto',
  MONOTRIBUTISTA: 'Monotributista',
  EXENTO: 'Exento',
  NO_RESPONSABLE: 'No Responsable',
  CONSUMIDOR_FINAL: 'Consumidor Final',
};

// ============================================
// DOCUMENTOS - APLICA A
// ============================================

export const documentAppliesToLabels: Record<DocumentAppliesTo, string> = {
  EMPLOYEE: 'Empleados',
  EQUIPMENT: 'Equipos',
  COMPANY: 'Empresa',
};

// ============================================
// DOCUMENTOS - ESTADO
// ============================================

export const documentStateLabels: Record<DocumentState, string> = {
  PENDING: 'Pendiente',
  APPROVED: 'Presentado', // Default label, use getDocumentStateBadge for context-aware labels
  EXPIRED: 'Vencido',
};

export const documentStateBadges: Record<DocumentState, BadgeConfig> = {
  PENDING: { label: 'Pendiente', variant: 'warning' },
  APPROVED: { label: 'Presentado', variant: 'success' }, // Default, use getDocumentStateBadge for context-aware
  EXPIRED: { label: 'Vencido', variant: 'destructive' },
};

/**
 * Obtiene el badge de estado del documento considerando si tiene vencimiento
 * - Sin vencimiento: "Presentado"
 * - Con vencimiento (no vencido): "Vigente"
 * - Vencido: "Vencido"
 */
export function getDocumentStateBadge(
  state: DocumentState,
  hasExpiration: boolean
): BadgeConfig {
  if (state === 'EXPIRED') {
    return { label: 'Vencido', variant: 'destructive' };
  }
  if (state === 'PENDING') {
    return { label: 'Pendiente', variant: 'warning' };
  }
  // APPROVED state
  if (hasExpiration) {
    return { label: 'Vigente', variant: 'success' };
  }
  return { label: 'Presentado', variant: 'success' };
}

// ============================================
// GÉNERO
// ============================================

export const genderLabels: Record<Gender, string> = {
  MALE: 'Masculino',
  FEMALE: 'Femenino',
  NOT_DECLARED: 'No declarado',
};

// ============================================
// ESTADO CIVIL
// ============================================

export const maritalStatusLabels: Record<MaritalStatus, string> = {
  SINGLE: 'Soltero/a',
  MARRIED: 'Casado/a',
  DIVORCED: 'Divorciado/a',
  WIDOWED: 'Viudo/a',
  SEPARATED: 'Separado/a',
  DOMESTIC_PARTNERSHIP: 'Concubinato',
};

// ============================================
// NIVEL EDUCATIVO
// ============================================

export const educationLevelLabels: Record<EducationLevel, string> = {
  PRIMARY: 'Primario',
  SECONDARY: 'Secundario',
  TERTIARY: 'Terciario',
  UNIVERSITY: 'Universitario',
  POSTGRADUATE: 'Posgrado',
};

// ============================================
// AFILIACIÓN SINDICAL
// ============================================

export const unionAffiliationLabels: Record<UnionAffiliationStatus, string> = {
  AFFILIATED: 'Afiliado',
  NOT_AFFILIATED: 'No afiliado',
};

// ============================================
// TIPO DE COSTO
// ============================================

export const costTypeLabels: Record<CostType, string> = {
  DIRECT: 'Directo',
  INDIRECT: 'Indirecto',
};

// ============================================
// ESTADO DEL EMPLEADO
// ============================================

export const employeeStatusLabels: Record<EmployeeStatus, string> = {
  INCOMPLETE: 'Incompleto',
  COMPLETE: 'Completo',
  COMPLETE_EXPIRED_DOCS: 'Documentos Vencidos',
};

export const employeeStatusBadges: Record<EmployeeStatus, BadgeConfig> = {
  INCOMPLETE: { label: 'Incompleto', variant: 'warning' },
  COMPLETE: { label: 'Completo', variant: 'success' },
  COMPLETE_EXPIRED_DOCS: { label: 'Docs Vencidos', variant: 'destructive' },
};

// ============================================
// MOTIVO DE BAJA
// ============================================

export const terminationReasonLabels: Record<TerminationReason, string> = {
  DISMISSAL_WITHOUT_CAUSE: 'Despido sin causa',
  RESIGNATION: 'Renuncia',
  DISMISSAL_WITH_CAUSE: 'Despido con causa',
  MUTUAL_AGREEMENT: 'Mutuo acuerdo',
  CONTRACT_END: 'Fin de contrato',
  DEATH: 'Fallecimiento',
};

// ============================================
// ESTADO DEL VEHÍCULO
// ============================================

export const vehicleStatusLabels: Record<VehicleStatus, string> = {
  INCOMPLETE: 'Incompleto',
  COMPLETE: 'Completo',
  COMPLETE_EXPIRED_DOCS: 'Documentos Vencidos',
  APPROVED: 'Avalado',
  NOT_APPROVED: 'No Avalado',
};

export const vehicleStatusBadges: Record<VehicleStatus, BadgeConfig> = {
  INCOMPLETE: { label: 'Incompleto', variant: 'warning' },
  COMPLETE: { label: 'Completo', variant: 'success' },
  COMPLETE_EXPIRED_DOCS: { label: 'Docs Vencidos', variant: 'destructive' },
  APPROVED: { label: 'Avalado', variant: 'success' },
  NOT_APPROVED: { label: 'No Avalado', variant: 'destructive' },
};

// ============================================
// CONDICIÓN DEL VEHÍCULO
// ============================================

export const vehicleConditionLabels: Record<VehicleCondition, string> = {
  OPERATIVE: 'Operativo',
  NOT_OPERATIVE: 'No Operativo',
  IN_REPAIR: 'En Reparación',
  CONDITIONAL_OPERATIVE: 'Operativo Condicionado',
  IN_PREPARATION: 'En Preparación',
};

export const vehicleConditionBadges: Record<VehicleCondition, BadgeConfig> = {
  OPERATIVE: { label: 'Operativo', variant: 'success' },
  NOT_OPERATIVE: { label: 'No Operativo', variant: 'destructive' },
  IN_REPAIR: { label: 'En Reparación', variant: 'warning' },
  CONDITIONAL_OPERATIVE: { label: 'Op. Condicionado', variant: 'outline' },
  IN_PREPARATION: { label: 'En Preparación', variant: 'warning' },
};

// ============================================
// MOTIVO DE BAJA DE VEHÍCULO
// ============================================

export const vehicleTerminationReasonLabels: Record<VehicleTerminationReason, string> = {
  SALE: 'Venta',
  TOTAL_LOSS: 'Destrucción Total',
  RETURN: 'Devolución',
  OTHER: 'Otro',
};

// ============================================
// TIPO DE TITULARIDAD DE VEHÍCULO
// ============================================

export const vehicleTitularityTypeLabels: Record<VehicleTitularityType, string> = {
  LEASING: 'Leasing',
  RENTAL: 'Alquiler',
  OWNED: 'Propio',
  PLEDGED: 'Prendado',
};

export const vehicleTitularityTypeBadges: Record<VehicleTitularityType, BadgeConfig> = {
  LEASING: { label: 'Leasing', variant: 'outline' },
  RENTAL: { label: 'Alquiler', variant: 'secondary' },
  OWNED: { label: 'Propio', variant: 'default' },
  PLEDGED: { label: 'Prendado', variant: 'outline' },
};

// ============================================
// MONEDA
// ============================================

export const currencyLabels: Record<Currency, string> = {
  USD: 'USD - Dólar',
  EUR: 'EUR - Euro',
  GBP: 'GBP - Libra',
  ARS: 'ARS - Peso Argentino',
};

export const currencySymbols: Record<Currency, string> = {
  USD: '$',
  EUR: '€',
  GBP: '£',
  ARS: '$',
};

// ============================================
// HELPERS PARA OBTENER LABELS SEGUROS
// ============================================

/**
 * Obtiene el label de un enum de forma segura
 * Si el valor es null/undefined, retorna el fallback
 */
export function getLabel<T extends string>(
  value: T | null | undefined,
  labels: Record<T, string>,
  fallback = 'No especificado'
): string {
  if (!value) return fallback;
  return labels[value] ?? fallback;
}

/**
 * Obtiene la configuración de badge de forma segura
 */
export function getBadgeConfig<T extends string>(
  value: T | null | undefined,
  badges: Record<T, BadgeConfig>,
  fallback: BadgeConfig = { label: 'Desconocido', variant: 'outline' }
): BadgeConfig {
  if (!value) return fallback;
  return badges[value] ?? fallback;
}
