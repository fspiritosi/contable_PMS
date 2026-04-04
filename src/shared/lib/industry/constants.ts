/**
 * Tipos de Industria y Configuración de Features
 *
 * Define qué módulos y features están disponibles para cada tipo de industria.
 * - INDUSTRY_MODULES: Módulos completos restringidos a industrias específicas (Nivel 1 - sidebar/permisos)
 * - INDUSTRY_FEATURES: Features dentro de módulos existentes (Nivel 2 - componentes)
 *
 * Todo módulo/feature que NO esté en estos mapas es universal (disponible para todos).
 */

// ============================================
// TIPOS DE INDUSTRIA
// ============================================

export const INDUSTRY_TYPES = {
  GENERAL: 'GENERAL',
  AUTO_PARTS: 'AUTO_PARTS',
} as const;

export type IndustryType = (typeof INDUSTRY_TYPES)[keyof typeof INDUSTRY_TYPES];

// ============================================
// NIVEL 1: MÓDULOS COMPLETOS POR INDUSTRIA
// ============================================

/**
 * Módulos restringidos a industrias específicas.
 * Key: nombre del módulo (de permissions/constants.ts)
 * Value: array de industrias que pueden acceder
 *
 * Todo módulo que NO esté aquí es universal (visible para todos).
 */
export const INDUSTRY_MODULES: Record<string, IndustryType[]> = {
  'commercial.equivalences': ['AUTO_PARTS'],
};

// ============================================
// NIVEL 2: FEATURES DENTRO DE MÓDULOS EXISTENTES
// ============================================

/**
 * Features específicas dentro de módulos universales.
 * Key: identificador de feature (módulo.feature)
 * Value: array de industrias que pueden acceder
 *
 * Todo feature que NO esté aquí es universal.
 */
export const INDUSTRY_FEATURES: Record<string, IndustryType[]> = {
  'products.triple-coding': ['AUTO_PARTS'],
  'products.equivalences': ['AUTO_PARTS'],
  'products.compare-prices': ['AUTO_PARTS'],
};

// ============================================
// ETIQUETAS PARA UI
// ============================================

export const INDUSTRY_LABELS: Record<IndustryType, string> = {
  GENERAL: 'General',
  AUTO_PARTS: 'Casa de Repuestos',
};

// ============================================
// FUNCIONES HELPER
// ============================================

/**
 * Normaliza el campo industry (String?) a IndustryType.
 * Retorna GENERAL para null, undefined o valores no reconocidos.
 */
export function getIndustryType(industry: string | null | undefined): IndustryType {
  if (industry && Object.values(INDUSTRY_TYPES).includes(industry as IndustryType)) {
    return industry as IndustryType;
  }
  return INDUSTRY_TYPES.GENERAL;
}

/**
 * Nivel 1: Verifica si un módulo completo está disponible para una industria.
 * Módulos no listados en INDUSTRY_MODULES son universales (siempre disponibles).
 */
export function isModuleAvailableForIndustry(
  module: string,
  industryType: IndustryType,
): boolean {
  const allowed = INDUSTRY_MODULES[module];
  if (!allowed) return true;
  return allowed.includes(industryType);
}

/**
 * Nivel 2: Verifica si una feature dentro de un módulo existente está disponible.
 * Features no listadas en INDUSTRY_FEATURES son universales (siempre disponibles).
 */
export function isFeatureAvailableForIndustry(
  feature: string,
  industryType: IndustryType,
): boolean {
  const allowed = INDUSTRY_FEATURES[feature];
  if (!allowed) return true;
  return allowed.includes(industryType);
}
