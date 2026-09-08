'use server';

import { getCurrentUserId } from '@/shared/lib/current-user';
import { prisma } from '@/shared/lib/prisma';
import { logger } from '@/shared/lib/logger';
import { checkPermission } from '@/shared/lib/permissions';
import ExcelJS from 'exceljs';
import { AccountType, AccountNature } from '@/generated/prisma/enums';
import { generateAccountsTemplate } from './excel-template';
import {
  ACCOUNT_EXPORT_HEADERS,
  parseSiNoCell,
  readAccountRow,
  resolveAccountColumnIndexes,
  validateAccountRow,
} from './account-columns';
import { validateAccountCodeFormat, AccountCodeFormatError } from '../../../shared/utils/account-code';

/**
 * Descarga la plantilla vacía de Excel para importar cuentas
 */
export async function downloadAccountsTemplate() {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('No autenticado');
  await checkPermission('accounting.accounts', 'view', { redirect: true });

  try {
    const buffer = await generateAccountsTemplate();

    logger.info('Plantilla de cuentas descargada', { data: { userId } });

    return {
      success: true,
      buffer: Array.from(buffer),
      filename: `plantilla-plan-cuentas-${new Date().toISOString().split('T')[0]}.xlsx`,
    };
  } catch (error) {
    logger.error('Error al generar plantilla de cuentas', { data: { error, userId } });
    throw error;
  }
}

/**
 * Exporta el plan de cuentas actual a Excel
 */
export async function exportAccountsToExcel(companyId: string) {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('No autenticado');
  await checkPermission('accounting.accounts', 'view', { redirect: true });

  try {
    // Obtener todas las cuentas de la empresa
    const accounts = await prisma.account.findMany({
      where: { companyId },
      select: {
        code: true,
        name: true,
        type: true,
        nature: true,
        description: true,
        parentId: true,
        parent: {
          select: {
            code: true,
          },
        },
        isActive: true,
        // TSK-618: la marca de Bien de Uso viaja en el export para que el
        // round-trip (exportar → reimportar) no la borre en silencio.
        isFixedAsset: true,
      },
      orderBy: { code: 'asc' },
    });

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Sistema de Gestión';
    workbook.created = new Date();

    const worksheet = workbook.addWorksheet('Plan de Cuentas');

    // Encabezados. Se toman del módulo compartido: el importador resuelve las
    // columnas por NOMBRE, así que ambos lados tienen que leer la misma lista.
    const headers: string[] = [...ACCOUNT_EXPORT_HEADERS];

    const headerRow = worksheet.getRow(1);
    headers.forEach((header, index) => {
      const cell = headerRow.getCell(index + 1);
      cell.value = header;
      cell.font = {
        bold: true,
        color: { argb: 'FFFFFF' },
        size: 11,
      };
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: '6b7280' },
      };
      cell.alignment = {
        horizontal: 'center',
        vertical: 'middle',
      };
    });
    headerRow.height = 25;

    // Datos
    accounts.forEach((account, index) => {
      const row = worksheet.getRow(index + 2);
      row.getCell(1).value = account.code;
      row.getCell(2).value = account.name;
      row.getCell(3).value = account.type;
      row.getCell(4).value = account.nature;
      row.getCell(5).value = account.description || '';
      row.getCell(6).value = account.parent?.code || '';
      row.getCell(7).value = account.isActive ? 'Activa' : 'Inactiva';
      row.getCell(8).value = account.isFixedAsset ? 'Sí' : 'No';
      row.height = 20;
    });

    // Configurar anchos
    worksheet.getColumn(1).width = 15;
    worksheet.getColumn(2).width = 35;
    worksheet.getColumn(3).width = 15;
    worksheet.getColumn(4).width = 15;
    worksheet.getColumn(5).width = 40;
    worksheet.getColumn(6).width = 15;
    worksheet.getColumn(7).width = 12;
    worksheet.getColumn(8).width = 12; // Bien de Uso (TSK-618)

    // Agregar filtros
    worksheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: headers.length },
    };

    const buffer = await workbook.xlsx.writeBuffer();

    logger.info('Plan de cuentas exportado', {
      data: { companyId, userId, accountCount: accounts.length },
    });

    return {
      success: true,
      buffer: Array.from(Buffer.from(buffer)),
      filename: `plan-cuentas-${new Date().toISOString().split('T')[0]}.xlsx`,
    };
  } catch (error) {
    logger.error('Error al exportar plan de cuentas', { data: { error, companyId, userId } });
    throw error;
  }
}

/**
 * Importa cuentas desde un archivo Excel
 */
export async function importAccountsFromExcel(companyId: string, fileBuffer: number[]) {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('No autenticado');
  await checkPermission('accounting.accounts', 'create', { redirect: true });

  try {
    const buffer = Buffer.from(fileBuffer);
    const workbook = new ExcelJS.Workbook();
    // @ts-ignore - ExcelJS type issue with Buffer
    await workbook.xlsx.load(buffer);

    const worksheet = workbook.getWorksheet('Plan de Cuentas');
    if (!worksheet) {
      throw new Error('No se encontró la hoja "Plan de Cuentas" en el archivo');
    }

    const accountsToImport: Array<{
      code: string;
      name: string;
      type: AccountType;
      nature: AccountNature;
      description?: string;
      parentCode?: string;
      /** TSK-618: valor literal de la columna "Bien de Uso" de esa fila. */
      isFixedAsset: boolean;
    }> = [];

    const errors: Array<{ row: number; errors: string[] }> = [];

    // TSK-618: las columnas se resuelven por NOMBRE de encabezado, no por
    // posición. La plantilla vacía tiene 6 columnas, el export viejo 7 (con
    // "Estado" en la 7) y el export nuevo 8: leer por índice fijo haría que un
    // export anterior a este ticket metiera "Activa" en "Bien de Uso" y
    // rompiera todas las filas del archivo.
    const columns = resolveAccountColumnIndexes(worksheet.getRow(1));

    // Leer filas (saltando el encabezado)
    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return; // Saltar encabezado

      const rowData = readAccountRow(row, columns);

      // Saltar filas vacías
      if (!rowData.code && !rowData.name) return;

      // Validar fila
      const validation = validateAccountRow(rowData);
      if (!validation.valid) {
        errors.push({ row: rowNumber, errors: validation.errors });
        return;
      }

      // Normalizar código (y código padre) al formato canónico x.x.x/xx/xx.
      let normalizedCode: string;
      let normalizedParentCode: string | undefined;
      try {
        normalizedCode = validateAccountCodeFormat(rowData.code);
        normalizedParentCode = rowData.parentCode
          ? validateAccountCodeFormat(rowData.parentCode)
          : undefined;
      } catch (error) {
        errors.push({
          row: rowNumber,
          errors: [
            error instanceof AccountCodeFormatError
              ? error.message
              : 'Código con formato inválido',
          ],
        });
        return;
      }

      accountsToImport.push({
        code: normalizedCode,
        name: rowData.name,
        type: rowData.type as AccountType,
        nature: rowData.nature as AccountNature,
        description: rowData.description || undefined,
        parentCode: normalizedParentCode,
        // Ya validado arriba: si el texto fuera inválido, la fila no llega acá.
        // Archivo sin la columna (anterior a TSK-618) → `false`.
        isFixedAsset: parseSiNoCell(rowData.isFixedAssetRaw) ?? false,
      });
    });

    // Si hay errores de validación, retornar sin importar
    if (errors.length > 0) {
      return {
        success: false,
        imported: 0,
        errors,
        message: `Se encontraron ${errors.length} errores de validación`,
      };
    }

    // Verificar códigos duplicados en el archivo
    const codes = accountsToImport.map((a) => a.code);
    const duplicates = codes.filter((code, index) => codes.indexOf(code) !== index);
    if (duplicates.length > 0) {
      return {
        success: false,
        imported: 0,
        errors: [
          {
            row: 0,
            errors: [`Códigos duplicados en el archivo: ${duplicates.join(', ')}`],
          },
        ],
        message: 'Se encontraron códigos duplicados en el archivo',
      };
    }

    // Importar en transacción
    const result = await prisma.$transaction(async (tx) => {
      let imported = 0;
      let skipped = 0;
      const importErrors: Array<{ row: number; errors: string[] }> = [];

      // Mapa de códigos a IDs para resolver parentId
      const codeToId = new Map<string, string>();
      // Mapa de códigos a tipo, para validar padre mismo-tipo.
      const codeToType = new Map<string, AccountType>();

      // Obtener cuentas existentes para mapear códigos a IDs
      const existingAccounts = await tx.account.findMany({
        where: { companyId },
        select: { id: true, code: true, type: true },
      });
      existingAccounts.forEach((acc) => {
        codeToId.set(acc.code, acc.id);
        codeToType.set(acc.code, acc.type);
      });

      // Importar en orden (por nivel de jerarquía)
      for (const accountData of accountsToImport) {
        try {
          // Verificar si ya existe
          const existing = await tx.account.findUnique({
            where: {
              companyId_code: {
                companyId,
                code: accountData.code,
              },
            },
          });

          if (existing) {
            skipped++;
            continue;
          }

          // Resolver parentId
          let parentId: string | undefined;
          if (accountData.parentCode) {
            parentId = codeToId.get(accountData.parentCode);
            if (!parentId) {
              importErrors.push({
                row: accountsToImport.indexOf(accountData) + 2,
                errors: [`Cuenta padre con código "${accountData.parentCode}" no encontrada`],
              });
              continue;
            }

            // Validar padre mismo-tipo (ticket #376).
            const parentType = codeToType.get(accountData.parentCode);
            if (parentType && parentType !== accountData.type) {
              importErrors.push({
                row: accountsToImport.indexOf(accountData) + 2,
                errors: [
                  `La cuenta padre "${accountData.parentCode}" debe ser del mismo tipo que la cuenta`,
                ],
              });
              continue;
            }
          }

          // Crear cuenta (nace hoja/imputable)
          const newAccount = await tx.account.create({
            data: {
              companyId,
              code: accountData.code,
              name: accountData.name,
              type: accountData.type,
              nature: accountData.nature,
              description: accountData.description,
              parentId,
              isLeaf: true,
              // TSK-618: el archivo es la fuente de verdad de esta corrida. NO
              // se hereda del padre ni se dispara la cascada del ABM: pisaría
              // las excepciones que el usuario escribió a mano en el Excel.
              isFixedAsset: accountData.isFixedAsset,
            },
          });

          // Si tiene padre, el padre deja de ser hoja.
          if (parentId) {
            await tx.account.update({
              where: { id: parentId },
              data: { isLeaf: false },
            });
          }

          // Agregar al mapa para futuras referencias
          codeToId.set(newAccount.code, newAccount.id);
          codeToType.set(newAccount.code, newAccount.type);
          imported++;
        } catch (error) {
          importErrors.push({
            row: accountsToImport.indexOf(accountData) + 2,
            errors: [error instanceof Error ? error.message : 'Error desconocido'],
          });
        }
      }

      return { imported, skipped, errors: importErrors };
    });

    logger.info('Plan de cuentas importado', {
      data: {
        companyId,
        userId,
        imported: result.imported,
        skipped: result.skipped,
        errors: result.errors.length,
      },
    });

    return {
      success: true,
      imported: result.imported,
      skipped: result.skipped,
      errors: result.errors,
      message: `Importación completada: ${result.imported} cuentas importadas, ${result.skipped} omitidas (ya existían)`,
    };
  } catch (error) {
    logger.error('Error al importar plan de cuentas', { data: { error, companyId, userId } });
    throw error;
  }
}
