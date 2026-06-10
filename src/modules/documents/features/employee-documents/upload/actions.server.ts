'use server';

import { getCurrentUserId } from '@/shared/lib/current-user';
import { revalidatePath } from 'next/cache';

import {
  buildEmployeeDocumentPath,
  buildDocumentFilename,
} from '@/shared/config/storage.config';
import { getActiveCompanyId } from '@/shared/lib/company';
import { recalculateEmployeeStatus } from '@/shared/lib/employeeStatus';
import { logger } from '@/shared/lib/logger';
import { checkPermission } from '@/shared/lib/permissions';
import { prisma } from '@/shared/lib/prisma';
import { uploadFile, deleteFile } from '@/shared/lib/storage';

// ============================================
// TIPOS
// ============================================

export interface UploadEmployeeDocumentInput {
  employeeId: string;
  documentTypeId: string;
  expirationDate?: Date | null;
  period?: string; // Format: "YYYY-MM" for monthly documents
  // Archivo enviado como File (multipart/binario, sin inflar el payload)
  file: File;
  fileName: string;
  fileSize: number;
  mimeType: string;
  // Action type for history tracking
  action?: 'UPLOADED' | 'RENEWED' | 'REPLACED';
}

export interface UploadDocumentResult {
  success: boolean;
  documentId?: string;
  error?: string;
}

// ============================================
// MUTATIONS
// ============================================

/**
 * Sube y registra un documento de empleado
 * El archivo se sube a storage y se crea/actualiza el registro en BD
 */
export async function uploadEmployeeDocument(
  input: UploadEmployeeDocumentInput
): Promise<UploadDocumentResult> {
  await checkPermission('documents', 'create', { redirect: true });
  const companyId = await getActiveCompanyId();
  if (!companyId) {
    return { success: false, error: 'No hay empresa activa' };
  }

  const userId = await getCurrentUserId();
  if (!userId) {
    return { success: false, error: 'No autenticado' };
  }

  try {
    // Obtener datos del empleado y empresa
    const employee = await prisma.employee.findFirst({
      where: { id: input.employeeId, companyId },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        documentNumber: true,
        company: {
          select: { name: true },
        },
      },
    });

    if (!employee) {
      return { success: false, error: 'Empleado no encontrado' };
    }

    // Obtener tipo de documento
    const documentType = await prisma.documentType.findFirst({
      where: { id: input.documentTypeId, companyId, appliesTo: 'EMPLOYEE' },
      select: {
        id: true,
        name: true,
        slug: true,
        isMonthly: true,
        hasExpiration: true,
      },
    });

    if (!documentType) {
      return { success: false, error: 'Tipo de documento no encontrado' };
    }

    // Validar periodo para documentos mensuales
    if (documentType.isMonthly && !input.period) {
      return { success: false, error: 'El periodo es requerido para documentos mensuales' };
    }

    // Validar fecha de vencimiento para documentos que vencen
    if (documentType.hasExpiration && !input.expirationDate) {
      return {
        success: false,
        error: 'La fecha de vencimiento es requerida para este tipo de documento',
      };
    }

    // Generar nombre de archivo y path
    const filename = buildDocumentFilename(documentType.name, input.fileName);
    const employeeFullName = `${employee.firstName} ${employee.lastName}`;

    const documentPath = buildEmployeeDocumentPath({
      companyName: employee.company.name,
      documentTypeName: documentType.name,
      employeeFullName,
      employeeDocumentNumber: employee.documentNumber,
      filename,
    });

    // Convertir array de bytes a Buffer
    const fileBuffer = Buffer.from(await input.file.arrayBuffer());

    // Subir archivo a storage
    const uploadResult = await uploadFile(fileBuffer, filename, {
      folder: documentPath.split('/').slice(0, -1).join('/'), // Carpeta sin el filename
      contentType: input.mimeType,
      useUniqueFilename: false, // Ya generamos nombre único
    });

    // Verificar si ya existe un documento para este tipo/periodo
    const existing = await prisma.employeeDocument.findFirst({
      where: {
        employeeId: input.employeeId,
        documentTypeId: input.documentTypeId,
        period: input.period ?? null,
      },
      select: { id: true, documentKey: true },
    });

    let documentId: string;

    if (existing) {
      // Guardar datos anteriores para historial
      const previousData = await prisma.employeeDocument.findUnique({
        where: { id: existing.id },
        select: {
          state: true,
          documentKey: true,
          fileName: true,
          fileSize: true,
          mimeType: true,
          expirationDate: true,
        },
      });

      // Determinar la acción a usar
      const actionType = input.action || 'REPLACED';
      const shouldDeleteOldFile = actionType === 'REPLACED';

      // Eliminar archivo anterior solo si es REPLACED (no para RENEWED)
      if (shouldDeleteOldFile && existing.documentKey) {
        try {
          await deleteFile(existing.documentKey);
          logger.info('Old document file deleted (replaced)', {
            data: { key: existing.documentKey },
          });
        } catch (e) {
          logger.warn('Could not delete old document file', {
            data: { key: existing.documentKey },
          });
        }
      }

      // Actualizar documento existente (directamente a APPROVED)
      const document = await prisma.employeeDocument.update({
        where: { id: existing.id },
        data: {
          state: 'APPROVED',
          expirationDate: input.expirationDate,
          documentPath,
          documentKey: uploadResult.key,
          fileName: input.fileName,
          fileSize: input.fileSize,
          mimeType: input.mimeType,
          uploadedBy: userId,
        },
        select: { id: true },
      });

      documentId = document.id;

      // Registrar en historial con la acción especificada
      if (previousData) {
        // Para RENEWED: guardamos los datos del documento ANTERIOR (para poder verlo/descargarlo)
        // Para REPLACED: guardamos los datos del documento NUEVO (el anterior se borró)
        const historyData =
          actionType === 'RENEWED'
            ? {
                // Guardar datos del documento ANTERIOR para poder accederlo
                documentKey: previousData.documentKey,
                fileName: previousData.fileName,
                fileSize: previousData.fileSize,
                mimeType: previousData.mimeType,
                expirationDate: previousData.expirationDate,
                state: previousData.state,
                reason: `Renovado por: ${input.fileName}`,
              }
            : {
                // Guardar datos del documento NUEVO (el anterior ya no existe)
                documentKey: uploadResult.key,
                fileName: input.fileName,
                fileSize: input.fileSize,
                mimeType: input.mimeType,
                expirationDate: input.expirationDate,
                state: 'APPROVED' as const,
                reason: undefined,
              };

        await prisma.employeeDocumentHistory.create({
          data: {
            documentId,
            action: actionType,
            ...historyData,
            changedBy: userId,
          },
        });
      }

      logger.info(`Employee document updated (${actionType.toLowerCase()})`, {
        data: { id: documentId, employeeId: input.employeeId, path: documentPath },
      });
    } else {
      // Crear nuevo documento (directamente a APPROVED)
      const document = await prisma.employeeDocument.create({
        data: {
          employeeId: input.employeeId,
          documentTypeId: input.documentTypeId,
          state: 'APPROVED',
          expirationDate: input.expirationDate,
          period: input.period,
          documentPath,
          documentKey: uploadResult.key,
          fileName: input.fileName,
          fileSize: input.fileSize,
          mimeType: input.mimeType,
          uploadedBy: userId,
        },
        select: { id: true },
      });

      documentId = document.id;

      // Registrar en historial como UPLOADED
      await prisma.employeeDocumentHistory.create({
        data: {
          documentId,
          action: 'UPLOADED',
          state: 'APPROVED',
          documentKey: uploadResult.key,
          fileName: input.fileName,
          fileSize: input.fileSize,
          mimeType: input.mimeType,
          expirationDate: input.expirationDate,
          changedBy: userId,
        },
      });

      logger.info('Employee document created', {
        data: { id: documentId, employeeId: input.employeeId, path: documentPath },
      });
    }

    // Recalculate employee status
    await recalculateEmployeeStatus(input.employeeId, companyId);

    revalidatePath(`/dashboard/employees/${input.employeeId}`);
    revalidatePath('/dashboard/documents');

    return { success: true, documentId };
  } catch (error) {
    logger.error('Error uploading employee document', {
      data: { error, employeeId: input.employeeId },
    });

    const message = error instanceof Error ? error.message : 'Error al subir documento';
    return { success: false, error: message };
  }
}

/**
 * Elimina un documento de empleado COMPLETAMENTE (registro + archivo actual + TODOS los archivos del historial)
 */
export async function deleteEmployeeDocument(
  id: string,
  employeeId: string
): Promise<UploadDocumentResult> {
  await checkPermission('documents', 'delete', { redirect: true });
  const companyId = await getActiveCompanyId();
  if (!companyId) {
    return { success: false, error: 'No hay empresa activa' };
  }

  try {
    // Verificar que el documento existe y pertenece al empleado de la empresa
    // Incluir historial para obtener todas las keys de archivos
    const document = await prisma.employeeDocument.findFirst({
      where: {
        id,
        employeeId,
        employee: { companyId },
      },
      select: {
        id: true,
        documentKey: true,
        history: {
          select: { documentKey: true },
        },
      },
    });

    if (!document) {
      return { success: false, error: 'Documento no encontrado' };
    }

    // Recopilar todas las keys de archivos a eliminar (actual + historial)
    const keysToDelete: string[] = [];
    if (document.documentKey) {
      keysToDelete.push(document.documentKey);
    }
    for (const entry of document.history) {
      if (entry.documentKey && !keysToDelete.includes(entry.documentKey)) {
        keysToDelete.push(entry.documentKey);
      }
    }

    // Eliminar todos los archivos de storage
    for (const key of keysToDelete) {
      try {
        await deleteFile(key);
        logger.info('Document file deleted from storage', { data: { key } });
      } catch (e) {
        logger.warn('Could not delete document file from storage', {
          data: { key, error: e },
        });
        // Continuar aunque falle algún archivo
      }
    }

    // Eliminar registro de BD (el historial se elimina por CASCADE)
    await prisma.employeeDocument.delete({
      where: { id },
    });

    logger.info('Employee document deleted completely', {
      data: { id, employeeId, filesDeleted: keysToDelete.length },
    });

    // Recalculate employee status
    await recalculateEmployeeStatus(employeeId, companyId);

    revalidatePath(`/dashboard/employees/${employeeId}`);
    revalidatePath('/dashboard/documents');

    return { success: true };
  } catch (error) {
    logger.error('Error deleting employee document', {
      data: { error, id, employeeId },
    });

    const message = error instanceof Error ? error.message : 'Error al eliminar documento';
    return { success: false, error: message };
  }
}

/**
 * Elimina SOLO la versión actual del documento y restaura la versión anterior del historial.
 * Si no hay versión anterior, elimina el documento completamente.
 */
export async function revertToVersionVersion(
  id: string,
  employeeId: string
): Promise<UploadDocumentResult> {
  await checkPermission('documents', 'update', { redirect: true });
  const companyId = await getActiveCompanyId();
  if (!companyId) {
    return { success: false, error: 'No hay empresa activa' };
  }

  const userId = await getCurrentUserId();
  if (!userId) {
    return { success: false, error: 'No autenticado' };
  }

  try {
    // Obtener el documento con su historial ordenado
    const document = await prisma.employeeDocument.findFirst({
      where: {
        id,
        employeeId,
        employee: { companyId },
      },
      select: {
        id: true,
        documentKey: true,
        fileName: true,
        history: {
          orderBy: { changedAt: 'desc' },
          select: {
            id: true,
            action: true,
            documentKey: true,
            fileName: true,
            fileSize: true,
            mimeType: true,
            expirationDate: true,
            state: true,
          },
        },
      },
    });

    if (!document) {
      return { success: false, error: 'Documento no encontrado' };
    }

    // Buscar la versión anterior que tenga archivo diferente al actual
    // El primer entry del historial es la versión actual, buscamos desde el segundo
    const previousVersion = document.history.find(
      (entry, index) =>
        index > 0 && entry.documentKey && entry.documentKey !== document.documentKey
    );

    if (!previousVersion || !previousVersion.documentKey) {
      // No hay versión anterior, eliminar el documento completamente
      return deleteEmployeeDocument(id, employeeId);
    }

    // Eliminar el archivo actual de storage
    if (document.documentKey) {
      try {
        await deleteFile(document.documentKey);
        logger.info('Current document file deleted', { data: { key: document.documentKey } });
      } catch (e) {
        logger.warn('Could not delete current document file', {
          data: { key: document.documentKey, error: e },
        });
      }
    }

    // Actualizar el documento con los datos de la versión anterior
    await prisma.employeeDocument.update({
      where: { id },
      data: {
        state: previousVersion.state,
        documentKey: previousVersion.documentKey,
        fileName: previousVersion.fileName,
        fileSize: previousVersion.fileSize,
        mimeType: previousVersion.mimeType,
        expirationDate: previousVersion.expirationDate,
      },
    });

    // Registrar la acción en el historial
    await prisma.employeeDocumentHistory.create({
      data: {
        documentId: id,
        action: 'DELETED',
        state: previousVersion.state,
        documentKey: previousVersion.documentKey,
        fileName: previousVersion.fileName,
        fileSize: previousVersion.fileSize,
        mimeType: previousVersion.mimeType,
        expirationDate: previousVersion.expirationDate,
        changedBy: userId,
        reason: `Versión actual eliminada. Restaurado: ${previousVersion.fileName}`,
      },
    });

    // Eliminar el entry del historial que ahora es la versión actual
    // (para evitar duplicados, ya que esa versión ahora está en el documento principal)
    await prisma.employeeDocumentHistory.delete({
      where: { id: previousVersion.id },
    });

    logger.info('Document reverted to previous version', {
      data: { id, employeeId, restoredFile: previousVersion.fileName },
    });

    revalidatePath(`/dashboard/employees/${employeeId}`);
    revalidatePath('/dashboard/documents');

    return { success: true };
  } catch (error) {
    logger.error('Error reverting document version', {
      data: { error, id, employeeId },
    });

    const message = error instanceof Error ? error.message : 'Error al revertir versión';
    return { success: false, error: message };
  }
}
