/**
 * Columnas de la hoja "Plan de Cuentas" del Excel de importación/exportación
 * (TSK-618).
 *
 * Por qué existe este archivo: hasta este ticket, el importador leía las celdas
 * por índice fijo (1 a 6). Eso era tolerable mientras la plantilla vacía y el
 * export coincidieran, pero NO coinciden:
 *
 *   - la plantilla vacía tiene 6 columnas y la 7 libre;
 *   - el export tiene 7, con "Estado" (`Activa`/`Inactiva`) en la 7;
 *   - el importador lee las dos con el mismo código.
 *
 * Si la columna nueva "Bien de Uso" se leyera por índice fijo, reimportar un
 * archivo exportado ANTES de TSK-618 haría que la celda 7 —que dice `Activa`—
 * se interpretara como valor de "Bien de Uso" y rompiera todas las filas del
 * archivo. Por eso las columnas se resuelven por NOMBRE DE ENCABEZADO, con
 * caída a las posiciones históricas.
 *
 * Todo lo de acá es puro y testeable sin base ni Next: `import-export.server.ts`
 * es `'use server'` y no puede exportar nada que no sea una action async.
 */

import type ExcelJS from 'exceljs';
import { AccountType, AccountNature } from '@/generated/prisma/enums';

/** Encabezados de la plantilla vacía descargable (`excel-template.ts`). */
export const ACCOUNT_TEMPLATE_HEADERS = [
  'Código',
  'Nombre',
  'Tipo',
  'Naturaleza',
  'Descripción (Opcional)',
  'Código Padre (Opcional)',
  'Bien de Uso (Sí/No)',
] as const;

/** Encabezados del archivo exportado (`exportAccountsToExcel`). */
export const ACCOUNT_EXPORT_HEADERS = [
  'Código',
  'Nombre',
  'Tipo',
  'Naturaleza',
  'Descripción',
  'Código Padre',
  'Estado',
  'Bien de Uso',
] as const;

/** Índices (1-based) de cada columna en la hoja "Plan de Cuentas". */
export interface AccountColumnIndexes {
  code: number;
  name: number;
  type: number;
  nature: number;
  description: number;
  parentCode: number;
  /** `null` cuando el archivo es anterior a TSK-618 y no trae la columna. */
  isFixedAsset: number | null;
}

/** Posiciones históricas, para un archivo sin encabezados reconocibles. */
export const LEGACY_COLUMN_INDEXES: AccountColumnIndexes = {
  code: 1,
  name: 2,
  type: 3,
  nature: 4,
  description: 5,
  parentCode: 6,
  isFixedAsset: null,
};

/**
 * Normaliza un encabezado: minúsculas, sin acentos, sin el paréntesis final
 * de aclaración y sin espacios de más.
 *
 * Así `'Descripción (Opcional)'`, `'Descripción'` y `'DESCRIPCION'` caen todos
 * en `'descripcion'`, y `'Bien de Uso (Sí/No)'` (plantilla) coincide con
 * `'Bien de Uso'` (export).
 */
export function normalizeHeader(raw: unknown): string {
  if (raw === null || raw === undefined) return '';

  return raw
    .toString()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\([^)]*\)\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Encabezado normalizado esperado por cada columna. */
const HEADER_ALIASES: Record<keyof AccountColumnIndexes, string[]> = {
  code: ['codigo'],
  name: ['nombre'],
  type: ['tipo'],
  nature: ['naturaleza'],
  description: ['descripcion'],
  parentCode: ['codigo padre'],
  isFixedAsset: ['bien de uso', 'bu'],
};

/** Columnas sin las cuales el archivo no se considera "con encabezados". */
const REQUIRED_COLUMNS = ['code', 'name', 'type', 'nature'] as const;

/**
 * Mapea encabezado → índice (1-based) sobre la fila 1 de la hoja.
 *
 * Acepta tanto `'Bien de Uso'` (export) como `'Bien de Uso (Sí/No)'`
 * (plantilla). Si la fila no trae los encabezados obligatorios —por ejemplo,
 * un archivo armado a mano que arranca directo con datos— devuelve las
 * posiciones históricas, que es exactamente lo que hacía el importador antes
 * de TSK-618.
 */
export function resolveAccountColumnIndexes(headerRow: ExcelJS.Row): AccountColumnIndexes {
  const found = new Map<keyof AccountColumnIndexes, number>();

  const lastColumn = Math.max(headerRow.cellCount ?? 0, ACCOUNT_EXPORT_HEADERS.length);
  for (let column = 1; column <= lastColumn; column++) {
    const header = normalizeHeader(headerRow.getCell(column).value);
    if (!header) continue;

    for (const [key, aliases] of Object.entries(HEADER_ALIASES)) {
      const columnKey = key as keyof AccountColumnIndexes;
      if (found.has(columnKey)) continue;
      if (aliases.includes(header)) {
        found.set(columnKey, column);
        break;
      }
    }
  }

  const hasHeaders = REQUIRED_COLUMNS.every((key) => found.has(key));
  if (!hasHeaders) return { ...LEGACY_COLUMN_INDEXES };

  return {
    code: found.get('code') ?? LEGACY_COLUMN_INDEXES.code,
    name: found.get('name') ?? LEGACY_COLUMN_INDEXES.name,
    type: found.get('type') ?? LEGACY_COLUMN_INDEXES.type,
    nature: found.get('nature') ?? LEGACY_COLUMN_INDEXES.nature,
    description: found.get('description') ?? LEGACY_COLUMN_INDEXES.description,
    parentCode: found.get('parentCode') ?? LEGACY_COLUMN_INDEXES.parentCode,
    // Sin encabezado no hay columna: el archivo es anterior a TSK-618 y NO se
    // adivina por posición (ahí vive "Estado" en los export viejos).
    isFixedAsset: found.get('isFixedAsset') ?? null,
  };
}

const TRUE_VALUES = new Set(['si', 's', 'x', 'true', 'verdadero', '1']);
const FALSE_VALUES = new Set(['', 'no', 'n', 'false', 'falso', '0']);

/**
 * Lee una celda Sí/No.
 *
 *  - `true`  ← 'sí', 'si', 's', 'x', 'true', 'verdadero', '1'
 *  - `false` ← vacío, 'no', 'n', 'false', 'falso', '0'
 *  - `null`  ← cualquier otra cosa → error de fila con mensaje claro,
 *              nunca un `false` mudo.
 */
export function parseSiNoCell(raw: unknown): boolean | null {
  if (raw === null || raw === undefined) return false;
  if (typeof raw === 'boolean') return raw;

  const value = normalizeHeader(raw);
  if (TRUE_VALUES.has(value)) return true;
  if (FALSE_VALUES.has(value)) return false;

  return null;
}

/** Fila de cuenta leída del Excel, con los textos crudos de cada celda. */
export interface AccountExcelRow {
  code: string;
  name: string;
  type: string;
  nature: string;
  description?: string;
  parentCode?: string;
  /** Texto crudo de la celda "Bien de Uso"; `undefined` si el archivo no la trae. */
  isFixedAssetRaw?: string;
}

/**
 * Lee una fila de datos usando los índices ya resueltos por encabezado.
 *
 * Función pura: recibe la fila de ExcelJS y devuelve strings. La validación y
 * la normalización de códigos quedan en el importador.
 */
export function readAccountRow(row: ExcelJS.Row, indexes: AccountColumnIndexes): AccountExcelRow {
  const cell = (index: number) => row.getCell(index).value?.toString().trim();

  return {
    code: cell(indexes.code) || '',
    name: cell(indexes.name) || '',
    type: cell(indexes.type) || '',
    nature: cell(indexes.nature) || '',
    description: cell(indexes.description),
    parentCode: cell(indexes.parentCode),
    isFixedAssetRaw:
      indexes.isFixedAsset === null ? undefined : (cell(indexes.isFixedAsset) ?? ''),
  };
}

/**
 * Valida los datos de una cuenta antes de importar.
 *
 * Vivía dentro de `import-export.server.ts`, pero ese archivo es `'use server'`
 * y no puede exportar funciones sincrónicas: acá queda testeable.
 */
export function validateAccountRow(row: AccountExcelRow): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Validar código
  if (!row.code || row.code.trim() === '') {
    errors.push('El código es obligatorio');
  }

  // Validar nombre
  if (!row.name || row.name.trim() === '') {
    errors.push('El nombre es obligatorio');
  }

  // Validar tipo
  const validTypes: string[] = Object.values(AccountType);
  if (!validTypes.includes(row.type)) {
    errors.push(`Tipo inválido. Debe ser uno de: ${validTypes.join(', ')}`);
  }

  // Validar naturaleza
  const validNatures: string[] = Object.values(AccountNature);
  if (!validNatures.includes(row.nature)) {
    errors.push(`Naturaleza inválida. Debe ser uno de: ${validNatures.join(', ')}`);
  }

  // Validar "Bien de Uso" (TSK-618): un valor no reconocido es un error de fila
  // explícito, nunca un `false` mudo que borre la marca en silencio.
  if (row.isFixedAssetRaw !== undefined && parseSiNoCell(row.isFixedAssetRaw) === null) {
    errors.push('Valor inválido en "Bien de Uso": use Sí o No');
  }

  return { valid: errors.length === 0, errors };
}
