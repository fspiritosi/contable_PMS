import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import {
  ACCOUNT_EXPORT_HEADERS,
  ACCOUNT_TEMPLATE_HEADERS,
  LEGACY_COLUMN_INDEXES,
  normalizeHeader,
  parseSiNoCell,
  readAccountRow,
  resolveAccountColumnIndexes,
  validateAccountRow,
  type AccountColumnIndexes,
} from './account-columns';
import { generateAccountsTemplate } from './excel-template';

/**
 * Round-trip del Excel del plan de cuentas (TSK-618).
 *
 * El caso que justifica todo este archivo es el del **export anterior al
 * ticket**: 7 columnas, con `Activa`/`Inactiva` en la 7. Si "Bien de Uso" se
 * leyera por índice fijo, reimportar ese archivo interpretaría `Activa` como
 * valor de la marca y rompería TODAS las filas.
 */

/** Encabezados que escribía el export ANTES de TSK-618. */
const LEGACY_EXPORT_HEADERS = [
  'Código',
  'Nombre',
  'Tipo',
  'Naturaleza',
  'Descripción',
  'Código Padre',
  'Estado',
];

/** Encabezados que traía la plantilla vacía ANTES de TSK-618. */
const LEGACY_TEMPLATE_HEADERS = [
  'Código',
  'Nombre',
  'Tipo',
  'Naturaleza',
  'Descripción (Opcional)',
  'Código Padre (Opcional)',
];

/** Arma una hoja "Plan de Cuentas" en memoria, igual que la que lee el importador. */
function buildSheet(headers: string[], rows: Array<Array<string | null>> = []) {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Plan de Cuentas');

  headers.forEach((header, index) => {
    worksheet.getRow(1).getCell(index + 1).value = header;
  });

  rows.forEach((values, rowIndex) => {
    const row = worksheet.getRow(rowIndex + 2);
    values.forEach((value, colIndex) => {
      row.getCell(colIndex + 1).value = value;
    });
  });

  return worksheet;
}

describe('normalizeHeader', () => {
  it('baja a minúsculas, saca acentos y descarta la aclaración entre paréntesis', () => {
    expect(normalizeHeader('Descripción (Opcional)')).toBe('descripcion');
    expect(normalizeHeader('Código Padre (Opcional)')).toBe('codigo padre');
    expect(normalizeHeader('Bien de Uso (Sí/No)')).toBe('bien de uso');
    expect(normalizeHeader('  BIEN   DE  USO ')).toBe('bien de uso');
  });

  it('devuelve cadena vacía para celdas sin valor', () => {
    expect(normalizeHeader(null)).toBe('');
    expect(normalizeHeader(undefined)).toBe('');
  });
});

describe('resolveAccountColumnIndexes', () => {
  it('resuelve la plantilla vacía REAL que descarga el usuario, con "Bien de Uso" en la 7', async () => {
    const buffer = await generateAccountsTemplate();
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
    const worksheet = workbook.getWorksheet('Plan de Cuentas')!;

    expect(resolveAccountColumnIndexes(worksheet.getRow(1))).toEqual<AccountColumnIndexes>({
      code: 1,
      name: 2,
      type: 3,
      nature: 4,
      description: 5,
      parentCode: 6,
      isFixedAsset: 7,
    });
  });

  it('resuelve el export nuevo, donde "Bien de Uso" es la 8 y "Estado" la 7', () => {
    const worksheet = buildSheet([...ACCOUNT_EXPORT_HEADERS]);

    expect(resolveAccountColumnIndexes(worksheet.getRow(1))).toEqual<AccountColumnIndexes>({
      code: 1,
      name: 2,
      type: 3,
      nature: 4,
      description: 5,
      parentCode: 6,
      isFixedAsset: 8,
    });
  });

  it('en un export ANTERIOR a TSK-618 no inventa la columna: "Estado" no es "Bien de Uso"', () => {
    const worksheet = buildSheet(LEGACY_EXPORT_HEADERS);

    const indexes = resolveAccountColumnIndexes(worksheet.getRow(1));
    expect(indexes.isFixedAsset).toBeNull();
    expect(indexes.parentCode).toBe(6);
  });

  it('en una plantilla vieja de 6 columnas deja la marca en null', () => {
    const worksheet = buildSheet(LEGACY_TEMPLATE_HEADERS);

    expect(resolveAccountColumnIndexes(worksheet.getRow(1))).toEqual<AccountColumnIndexes>({
      ...LEGACY_COLUMN_INDEXES,
    });
  });

  it('resuelve por nombre aunque el usuario reordene las columnas', () => {
    const worksheet = buildSheet([
      'Bien de Uso',
      'Nombre',
      'Código Padre',
      'Código',
      'Naturaleza',
      'Tipo',
      'Descripción',
    ]);

    expect(resolveAccountColumnIndexes(worksheet.getRow(1))).toEqual<AccountColumnIndexes>({
      code: 4,
      name: 2,
      type: 6,
      nature: 5,
      description: 7,
      parentCode: 3,
      isFixedAsset: 1,
    });
  });

  it('no confunde "Código" con "Código Padre"', () => {
    const worksheet = buildSheet(['Código Padre', 'Código', 'Nombre', 'Tipo', 'Naturaleza']);

    const indexes = resolveAccountColumnIndexes(worksheet.getRow(1));
    expect(indexes.parentCode).toBe(1);
    expect(indexes.code).toBe(2);
  });

  it('cae a las posiciones históricas si la fila 1 no trae encabezados reconocibles', () => {
    const worksheet = buildSheet(['1.1.1/00/00', 'CAJA Y BANCOS', 'ASSET', 'DEBIT', '', '']);

    expect(resolveAccountColumnIndexes(worksheet.getRow(1))).toEqual<AccountColumnIndexes>({
      ...LEGACY_COLUMN_INDEXES,
    });
  });
});

describe('parseSiNoCell', () => {
  it.each(['Sí', 'sí', 'SI', 'si', 'S', 'x', 'true', 'VERDADERO', '1', 1, true])(
    'interpreta %o como verdadero',
    (raw) => {
      expect(parseSiNoCell(raw)).toBe(true);
    }
  );

  it.each(['No', 'no', 'N', 'false', 'FALSO', '0', 0, false, '', '   ', null, undefined])(
    'interpreta %o como falso',
    (raw) => {
      expect(parseSiNoCell(raw)).toBe(false);
    }
  );

  it.each(['Activa', 'Inactiva', 'tal vez', '2', 'ASSET'])(
    'devuelve null (valor inválido) para %o, en vez de un false mudo',
    (raw) => {
      expect(parseSiNoCell(raw)).toBeNull();
    }
  );
});

describe('validateAccountRow', () => {
  const validRow = {
    code: '1.2.2/01/01',
    name: 'Inmuebles Valores originales',
    type: 'ASSET',
    nature: 'DEBIT',
  };

  it('acepta una fila sin la columna "Bien de Uso" (archivo anterior a TSK-618)', () => {
    expect(validateAccountRow(validRow)).toEqual({ valid: true, errors: [] });
  });

  it.each(['Sí', 'No', ''])('acepta "%s" en la columna "Bien de Uso"', (raw) => {
    expect(validateAccountRow({ ...validRow, isFixedAssetRaw: raw })).toEqual({
      valid: true,
      errors: [],
    });
  });

  it('rechaza un valor no reconocido con un mensaje claro, no con un false silencioso', () => {
    const result = validateAccountRow({ ...validRow, isFixedAssetRaw: 'Activa' });

    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Valor inválido en "Bien de Uso": use Sí o No');
  });

  it('sigue validando código, nombre, tipo y naturaleza como antes', () => {
    const result = validateAccountRow({ code: '', name: '', type: 'XX', nature: 'YY' });

    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(4);
  });
});

describe('round-trip de la columna "Bien de Uso"', () => {
  /** Lee todas las filas de datos igual que `importAccountsFromExcel`. */
  function readRows(worksheet: ExcelJS.Worksheet) {
    const indexes = resolveAccountColumnIndexes(worksheet.getRow(1));
    const rows: ReturnType<typeof readAccountRow>[] = [];
    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      rows.push(readAccountRow(row, indexes));
    });
    return rows;
  }

  it('CASO CRÍTICO: reimportar un export ANTERIOR a TSK-618 no lee "Activa" como marca', () => {
    const worksheet = buildSheet(LEGACY_EXPORT_HEADERS, [
      ['1.2.2/00/00', 'BIENES DE USO', 'ASSET', 'DEBIT', '', '1.2.0/00/00', 'Activa'],
      ['1.2.2/01/01', 'Inmuebles', 'ASSET', 'DEBIT', '', '1.2.2/00/00', 'Inactiva'],
    ]);

    const rows = readRows(worksheet);

    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.isFixedAssetRaw).toBeUndefined();
      expect(validateAccountRow(row)).toEqual({ valid: true, errors: [] });
      expect(parseSiNoCell(row.isFixedAssetRaw) ?? false).toBe(false);
    }
    // Y las columnas de siempre se siguen leyendo bien.
    expect(rows[0].code).toBe('1.2.2/00/00');
    expect(rows[0].parentCode).toBe('1.2.0/00/00');
  });

  it('reimportar un export NUEVO conserva la marca de cada cuenta', () => {
    const worksheet = buildSheet([...ACCOUNT_EXPORT_HEADERS], [
      ['1.2.2/00/00', 'BIENES DE USO', 'ASSET', 'DEBIT', '', '', 'Activa', 'Sí'],
      ['1.2.2/01/03', 'Amortizaciones Acumuladas', 'ASSET', 'CREDIT', '', '1.2.2/00/00', 'Activa', 'No'],
      ['5.1.1/00/00', 'GASTOS', 'EXPENSE', 'DEBIT', '', '', 'Inactiva', 'No'],
    ]);

    const rows = readRows(worksheet);

    expect(rows.map((row) => parseSiNoCell(row.isFixedAssetRaw))).toEqual([true, false, false]);
    expect(rows.every((row) => validateAccountRow(row).valid)).toBe(true);
  });

  it('en la plantilla nueva, la celda vacía de "Bien de Uso" vale No y no da error', () => {
    const worksheet = buildSheet([...ACCOUNT_TEMPLATE_HEADERS], [
      ['1.1.1/01/01', 'Caja General', 'ASSET', 'DEBIT', 'Efectivo', '1.1.1/00/00', null],
      ['1.2.2/04/01', 'Rodados', 'ASSET', 'DEBIT', 'Vehículos', '1.2.2/00/00', 'Sí'],
    ]);

    const rows = readRows(worksheet);

    expect(rows[0].isFixedAssetRaw).toBe('');
    expect(parseSiNoCell(rows[0].isFixedAssetRaw)).toBe(false);
    expect(parseSiNoCell(rows[1].isFixedAssetRaw)).toBe(true);
    expect(rows.every((row) => validateAccountRow(row).valid)).toBe(true);
  });

  it('un valor basura en la columna nueva rompe SOLO esa fila, con mensaje', () => {
    const worksheet = buildSheet([...ACCOUNT_TEMPLATE_HEADERS], [
      ['1.2.2/04/01', 'Rodados', 'ASSET', 'DEBIT', '', '', 'Sí'],
      ['1.2.2/04/02', 'Maquinarias', 'ASSET', 'DEBIT', '', '', 'quizás'],
    ]);

    const [ok, broken] = readRows(worksheet).map(validateAccountRow);

    expect(ok.valid).toBe(true);
    expect(broken.valid).toBe(false);
    expect(broken.errors).toEqual(['Valor inválido en "Bien de Uso": use Sí o No']);
  });
});

describe('encabezados publicados', () => {
  it('la plantilla suma "Bien de Uso (Sí/No)" como séptima columna', () => {
    expect(ACCOUNT_TEMPLATE_HEADERS).toHaveLength(7);
    expect(ACCOUNT_TEMPLATE_HEADERS[6]).toBe('Bien de Uso (Sí/No)');
  });

  it('el export suma "Bien de Uso" como octava, después de "Estado"', () => {
    expect(ACCOUNT_EXPORT_HEADERS).toHaveLength(8);
    expect(ACCOUNT_EXPORT_HEADERS[6]).toBe('Estado');
    expect(ACCOUNT_EXPORT_HEADERS[7]).toBe('Bien de Uso');
  });
});
