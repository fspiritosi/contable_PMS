/**
 * Utilidades de formateo
 * Funciones para formatear fechas, valores y cálculos comunes
 */

import moment from 'moment';

// ============================================
// FORMATEO DE VALORES
// ============================================

/**
 * Muestra un valor o un fallback si es nulo/vacío
 */
export function displayValue(
  value: string | number | null | undefined,
  fallback = 'No especificado'
): string {
  if (value === null || value === undefined || value === '') return fallback;
  return String(value);
}

/**
 * Formatea un valor booleano a Sí/No
 */
export function formatBoolean(value: boolean | null | undefined): string {
  if (value === null || value === undefined) return 'No especificado';
  return value ? 'Sí' : 'No';
}

// ============================================
// FORMATEO DE FECHAS
// ============================================

/**
 * Formatea una fecha a DD/MM/YYYY
 */
export function formatDate(
  date: Date | string | null | undefined,
  fallback = 'No especificada'
): string {
  if (!date) return fallback;
  return moment(date).format('DD/MM/YYYY');
}

/**
 * Formatea un DateTime que representa un DÍA (sin hora significativa) a DD/MM/YYYY,
 * leyéndolo en UTC. Es el caso de `journal_entries.date`, `issueDate` de comprobantes
 * y otros campos que Prisma guarda a medianoche UTC: formatearlos en hora local los
 * corre al día anterior en UTC-3 (TSK-725).
 */
export function formatDateUtc(
  date: Date | string | null | undefined,
  fallback = 'No especificada'
): string {
  if (!date) return fallback;
  return moment.utc(date).format('DD/MM/YYYY');
}

/**
 * Formatea una fecha con hora a DD/MM/YYYY HH:mm
 */
export function formatDateTime(
  date: Date | string | null | undefined,
  fallback = 'No especificada'
): string {
  if (!date) return fallback;
  return moment(date).format('DD/MM/YYYY HH:mm');
}

/**
 * Formatea una fecha de forma relativa (hace 2 días, etc.)
 */
export function formatRelativeDate(date: Date | string | null | undefined): string {
  if (!date) return '';
  return moment(date).fromNow();
}

// ============================================
// CÁLCULOS DE TIEMPO
// ============================================

/**
 * Calcula la edad en años a partir de una fecha de nacimiento
 */
export function calculateAge(birthDate: Date | string | null | undefined): number | null {
  if (!birthDate) return null;
  return moment().diff(moment(birthDate), 'years');
}

/**
 * Formatea la edad para mostrar (ej: "32 años")
 */
export function formatAge(birthDate: Date | string | null | undefined): string {
  const age = calculateAge(birthDate);
  if (age === null) return '';
  return `${age} años`;
}

/**
 * Formatea la edad con paréntesis para mostrar junto a fecha
 */
export function formatAgeParenthesis(birthDate: Date | string | null | undefined): string {
  const age = calculateAge(birthDate);
  if (age === null) return '';
  return `(${age} años)`;
}

/**
 * Calcula la antigüedad en años y meses
 */
export function calculateSeniority(
  hireDate: Date | string | null | undefined
): { years: number; months: number } | null {
  if (!hireDate) return null;
  const years = moment().diff(moment(hireDate), 'years');
  const months = moment().diff(moment(hireDate), 'months') % 12;
  return { years, months };
}

/**
 * Formatea la antigüedad para mostrar (ej: "2 años, 3 meses")
 */
export function formatSeniority(hireDate: Date | string | null | undefined): string {
  const seniority = calculateSeniority(hireDate);
  if (!seniority) return '';

  const { years, months } = seniority;

  if (years === 0 && months === 0) return 'Menos de 1 mes';
  if (years === 0) return `${months} ${months === 1 ? 'mes' : 'meses'}`;
  if (months === 0) return `${years} ${years === 1 ? 'año' : 'años'}`;
  return `${years} ${years === 1 ? 'año' : 'años'}, ${months} ${months === 1 ? 'mes' : 'meses'}`;
}

/**
 * Formatea la antigüedad con paréntesis para mostrar junto a fecha
 */
export function formatSeniorityParenthesis(hireDate: Date | string | null | undefined): string {
  const formatted = formatSeniority(hireDate);
  if (!formatted) return '';
  return `(${formatted})`;
}

// ============================================
// FORMATEO DE NÚMEROS
// ============================================

/**
 * Formatea un número como moneda
 */
export function formatCurrency(
  value: number | null | undefined,
  currency = 'ARS'
): string {
  if (value === null || value === undefined) return '-';
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency,
  }).format(value);
}

/**
 * Formatea un número con separadores de miles
 */
export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined) return '-';
  return new Intl.NumberFormat('es-AR').format(value);
}

// ============================================
// FORMATEO DE STRINGS
// ============================================

/**
 * Obtiene las iniciales de un nombre completo
 */
export function getInitials(firstName: string, lastName: string): string {
  return `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase();
}

/**
 * Formatea un nombre completo (Apellido, Nombre)
 */
export function formatFullName(firstName: string, lastName: string): string {
  return `${lastName}, ${firstName}`;
}

/**
 * Trunca un texto a un máximo de caracteres
 */
export function truncateText(text: string | null | undefined, maxLength: number): string {
  if (!text) return '';
  if (text.length <= maxLength) return text;
  return `${text.substring(0, maxLength)}...`;
}

// ============================================
// FORMATEO DE ARCHIVOS
// ============================================

/**
 * Formatea el tamaño de un archivo en bytes a una unidad legible
 */
export function formatFileSize(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || bytes === 0) return '0 B';

  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const size = bytes / Math.pow(1024, i);

  return `${size.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}
