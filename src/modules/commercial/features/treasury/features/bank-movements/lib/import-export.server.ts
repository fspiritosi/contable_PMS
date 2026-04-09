'use server';

import { auth } from '@clerk/nextjs/server';
import { getActiveCompanyId } from '@/shared/lib/company';
import { prisma } from '@/shared/lib/prisma';
import { logger } from '@/shared/lib/logger';
import { Prisma } from '@/generated/prisma/client';
import { BankMovementType } from '@/generated/prisma/enums';
import { revalidatePath } from 'next/cache';
import ExcelJS from 'exceljs';
import moment from 'moment';
import { generateBankMovementsTemplate, VALID_MOVEMENT_TYPES } from './excel-template';

/**
 * Descarga la plantilla vacía de Excel para importar movimientos bancarios
 */
export async function downloadBankMovementsTemplate() {
  const { userId } = await auth();
  if (!userId) throw new Error('No autenticado');

  try {
    const buffer = await generateBankMovementsTemplate();

    logger.info('Plantilla de movimientos bancarios descargada', { data: { userId } });

    return {
      success: true,
      buffer: Array.from(buffer),
      filename: `plantilla-movimientos-bancarios-${new Date().toISOString().split('T')[0]}.xlsx`,
    };
  } catch (error) {
    logger.error('Error al generar plantilla de movimientos bancarios', { data: { error, userId } });
    throw error;
  }
}

/**
 * Valida una fila del Excel de movimientos bancarios
 */
function validateMovementRow(row: {
  date: string;
  type: string;
  amount: string;
  description: string;
  reference?: string;
  statementNumber?: string;
}): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Validar fecha
  if (!row.date || row.date.trim() === '') {
    errors.push('La fecha es obligatoria');
  } else {
    const parsedDate = moment(row.date, ['DD/MM/YYYY', 'YYYY-MM-DD', 'MM/DD/YYYY'], true);
    if (!parsedDate.isValid()) {
      errors.push(`Fecha inválida: "${row.date}". Use el formato DD/MM/YYYY`);
    }
  }

  // Validar tipo
  if (!row.type || row.type.trim() === '') {
    errors.push('El tipo de movimiento es obligatorio');
  } else if (!VALID_MOVEMENT_TYPES.includes(row.type.trim().toUpperCase() as any)) {
    errors.push(
      `Tipo inválido: "${row.type}". Debe ser uno de: ${VALID_MOVEMENT_TYPES.join(', ')}`
    );
  }

  // Validar monto
  if (!row.amount || row.amount.trim() === '') {
    errors.push('El monto es obligatorio');
  } else {
    const amount = parseFloat(row.amount);
    if (isNaN(amount) || amount <= 0) {
      errors.push(`Monto inválido: "${row.amount}". Debe ser un número positivo`);
    }
  }

  // Validar descripción
  if (!row.description || row.description.trim() === '') {
    errors.push('La descripción es obligatoria');
  } else if (row.description.length > 500) {
    errors.push('La descripción no puede exceder 500 caracteres');
  }

  // Validar referencia (opcional)
  if (row.reference && row.reference.length > 100) {
    errors.push('La referencia no puede exceder 100 caracteres');
  }

  // Validar número de extracto (opcional)
  if (row.statementNumber && row.statementNumber.length > 50) {
    errors.push('El número de extracto no puede exceder 50 caracteres');
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Parsea un valor de celda Excel como fecha
 */
function parseDateValue(cellValue: ExcelJS.CellValue): string {
  if (!cellValue) return '';

  // Si es un objeto Date (Excel puede devolver fechas como objetos Date)
  if (cellValue instanceof Date) {
    return moment(cellValue).format('DD/MM/YYYY');
  }

  // Si es un string
  return String(cellValue).trim();
}

/**
 * Parsea un valor de celda Excel como string
 */
function parseCellValue(cellValue: ExcelJS.CellValue): string {
  if (!cellValue) return '';

  // Si es un objeto con result (fórmula)
  if (typeof cellValue === 'object' && 'result' in cellValue) {
    return String(cellValue.result ?? '').trim();
  }

  return String(cellValue).trim();
}

/**
 * Importa movimientos bancarios desde un archivo Excel
 */
export async function importBankMovementsFromExcel(bankAccountId: string, fileBuffer: number[]) {
  const { userId } = await auth();
  if (!userId) throw new Error('No autenticado');

  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    // Verificar que la cuenta bancaria existe y está activa
    const bankAccount = await prisma.bankAccount.findFirst({
      where: {
        id: bankAccountId,
        companyId,
        status: 'ACTIVE',
      },
      select: {
        id: true,
        bankName: true,
        accountNumber: true,
        balance: true,
      },
    });

    if (!bankAccount) {
      throw new Error('Cuenta bancaria no encontrada o inactiva');
    }

    // Leer el archivo Excel
    const buffer = Buffer.from(fileBuffer);
    const workbook = new ExcelJS.Workbook();
    // @ts-ignore - ExcelJS type issue with Buffer
    await workbook.xlsx.load(buffer);

    const worksheet = workbook.getWorksheet('Movimientos');
    if (!worksheet) {
      throw new Error('No se encontró la hoja "Movimientos" en el archivo');
    }

    // Recopilar datos de las filas
    const movementsToImport: Array<{
      date: Date;
      type: BankMovementType;
      amount: number;
      description: string;
      reference: string | null;
      statementNumber: string | null;
    }> = [];

    const errors: Array<{ row: number; errors: string[] }> = [];

    // Leer filas (saltando el encabezado)
    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return; // Saltar encabezado

      const dateStr = parseDateValue(row.getCell(1).value);
      const type = parseCellValue(row.getCell(2).value);
      const amountStr = parseCellValue(row.getCell(3).value);
      const description = parseCellValue(row.getCell(4).value);
      const reference = parseCellValue(row.getCell(5).value);
      const statementNumber = parseCellValue(row.getCell(6).value);

      // Saltar filas completamente vacías
      if (!dateStr && !type && !amountStr && !description) return;

      const rowData = {
        date: dateStr,
        type: type.toUpperCase(),
        amount: amountStr,
        description,
        reference,
        statementNumber,
      };

      // Validar fila
      const validation = validateMovementRow(rowData);
      if (!validation.valid) {
        errors.push({ row: rowNumber, errors: validation.errors });
        return;
      }

      // Parsear fecha
      const parsedDate = moment(dateStr, ['DD/MM/YYYY', 'YYYY-MM-DD', 'MM/DD/YYYY'], true);

      movementsToImport.push({
        date: parsedDate.toDate(),
        type: rowData.type as BankMovementType,
        amount: parseFloat(amountStr),
        description,
        reference: reference || null,
        statementNumber: statementNumber || null,
      });
    });

    // Si no hay datos para importar
    if (movementsToImport.length === 0 && errors.length === 0) {
      return {
        success: false,
        imported: 0,
        errors: [{ row: 0, errors: ['No se encontraron movimientos para importar'] }],
        message: 'El archivo no contiene datos para importar',
      };
    }

    // Si hay errores de validación, retornar sin importar
    if (errors.length > 0) {
      return {
        success: false,
        imported: 0,
        errors,
        message: `Se encontraron ${errors.length} errores de validación`,
      };
    }

    // Importar en transacción
    const result = await prisma.$transaction(async (tx) => {
      let imported = 0;
      let balanceChange = new Prisma.Decimal(0);

      for (const movement of movementsToImport) {
        const amount = new Prisma.Decimal(movement.amount);
        const isIncome = ['DEPOSIT', 'TRANSFER_IN', 'INTEREST', 'CHECK'].includes(movement.type);

        // Crear movimiento (sin conciliar)
        await tx.bankMovement.create({
          data: {
            bankAccountId,
            companyId,
            type: movement.type,
            amount,
            date: movement.date,
            description: movement.description,
            reference: movement.reference,
            statementNumber: movement.statementNumber,
            reconciled: false,
            createdBy: userId,
          },
        });

        // Calcular cambio de saldo
        if (isIncome) {
          balanceChange = balanceChange.add(amount);
        } else {
          balanceChange = balanceChange.sub(amount);
        }

        imported++;
      }

      // Actualizar saldo de la cuenta
      const newBalance = bankAccount.balance.add(balanceChange);
      await tx.bankAccount.update({
        where: { id: bankAccountId },
        data: { balance: newBalance },
      });

      return { imported, newBalance: Number(newBalance) };
    });

    logger.info('Movimientos bancarios importados', {
      data: {
        bankAccountId,
        bankAccount: `${bankAccount.bankName} - ${bankAccount.accountNumber}`,
        imported: result.imported,
        newBalance: result.newBalance,
      },
    });

    revalidatePath('/dashboard/commercial/treasury/bank-accounts');

    return {
      success: true,
      imported: result.imported,
      errors: [],
      message: `Importación completada: ${result.imported} movimientos importados`,
    };
  } catch (error) {
    logger.error('Error al importar movimientos bancarios', {
      data: { error, bankAccountId },
    });
    if (error instanceof Error) {
      throw error;
    }
    throw new Error('Error al importar movimientos bancarios');
  }
}
