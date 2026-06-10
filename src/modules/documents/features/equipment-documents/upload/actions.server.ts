'use server';

import { getCurrentUserId } from '@/shared/lib/current-user';
import { revalidatePath } from 'next/cache';

import { getActiveCompanyId } from '@/shared/lib/company';
import { logger } from '@/shared/lib/logger';
import { checkPermission } from '@/shared/lib/permissions';
import { prisma } from '@/shared/lib/prisma';
import { recalculateVehicleStatus } from '@/shared/lib/vehicleStatus';
import { uploadFile, deleteFile } from '@/shared/lib/storage';
import {
  buildEquipmentDocumentPath,
  buildDocumentFilename,
} from '@/shared/config/storage.config';

// ============================================
// TIPOS
// ============================================

export interface UploadEquipmentDocumentInput {
  vehicleId: string;
  documentTypeId: string;
  expirationDate?: Date | null;
  period?: string;
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
 * Sube y registra un documento de equipo
 * El archivo se sube a storage y se crea/actualiza el registro en BD
 */
export async function uploadEquipmentDocument(
  input: UploadEquipmentDocumentInput
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
    // Obtener datos del vehículo y empresa
    const vehicle = await prisma.vehicle.findFirst({
      where: { id: input.vehicleId, companyId },
      select: {
        id: true,
        domain: true,
        internNumber: true,
        company: {
          select: { name: true },
        },
      },
    });

    if (!vehicle) {
      return { success: false, error: 'Vehículo no encontrado' };
    }

    // Obtener tipo de documento
    const documentType = await prisma.documentType.findFirst({
      where: { id: input.documentTypeId, companyId, appliesTo: 'EQUIPMENT' },
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
    const vehicleDescription = vehicle.internNumber || 'equipo';
    const licensePlate = vehicle.domain || vehicle.id.slice(0, 8);

    const documentPath = buildEquipmentDocumentPath({
      companyName: vehicle.company.name,
      documentTypeName: documentType.name,
      vehicleDescription,
      licensePlate,
      filename,
    });

    // Convertir array de bytes a Buffer
    const fileBuffer = Buffer.from(await input.file.arrayBuffer());

    // Subir archivo a storage
    const uploadResult = await uploadFile(fileBuffer, filename, {
      folder: documentPath.split('/').slice(0, -1).join('/'),
      contentType: input.mimeType,
      useUniqueFilename: false,
    });

    // Verificar si ya existe un documento para este tipo/periodo
    const existing = await prisma.equipmentDocument.findFirst({
      where: {
        vehicleId: input.vehicleId,
        documentTypeId: input.documentTypeId,
        period: input.period ?? null,
      },
      select: { id: true, documentKey: true },
    });

    let documentId: string;

    if (existing) {
      // Guardar datos anteriores para historial
      const previousData = await prisma.equipmentDocument.findUnique({
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
          logger.info('Old equipment document file deleted (replaced)', {
            data: { key: existing.documentKey },
          });
        } catch (e) {
          logger.warn('Could not delete old equipment document file', {
            data: { key: existing.documentKey },
          });
        }
      }

      // Actualizar documento existente
      const document = await prisma.equipmentDocument.update({
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

        await prisma.equipmentDocumentHistory.create({
          data: {
            documentId,
            action: actionType,
            ...historyData,
            changedBy: userId,
          },
        });
      }

      logger.info(`Equipment document updated (${actionType.toLowerCase()})`, {
        data: { id: documentId, vehicleId: input.vehicleId, path: documentPath },
      });
    } else {
      // Crear nuevo documento
      const document = await prisma.equipmentDocument.create({
        data: {
          vehicleId: input.vehicleId,
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
      await prisma.equipmentDocumentHistory.create({
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

      logger.info('Equipment document created', {
        data: { id: documentId, vehicleId: input.vehicleId, path: documentPath },
      });
    }

    // Recalculate vehicle status
    await recalculateVehicleStatus(input.vehicleId, companyId);

    revalidatePath(`/dashboard/equipment/${input.vehicleId}`);
    revalidatePath('/dashboard/documents');

    return { success: true, documentId };
  } catch (error) {
    logger.error('Error uploading equipment document', {
      data: { error, vehicleId: input.vehicleId },
    });

    const message = error instanceof Error ? error.message : 'Error al subir documento';
    return { success: false, error: message };
  }
}

/**
 * Elimina un documento de equipo COMPLETAMENTE (registro + archivo actual + TODOS los archivos del historial)
 */
export async function deleteEquipmentDocument(
  id: string,
  vehicleId: string
): Promise<UploadDocumentResult> {
  await checkPermission('documents', 'delete', { redirect: true });
  const companyId = await getActiveCompanyId();
  if (!companyId) {
    return { success: false, error: 'No hay empresa activa' };
  }

  try {
    // Verificar que el documento existe y pertenece al vehículo de la empresa
    // Incluir historial para obtener todas las keys de archivos
    const document = await prisma.equipmentDocument.findFirst({
      where: {
        id,
        vehicleId,
        vehicle: { companyId },
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
        logger.info('Equipment document file deleted from storage', { data: { key } });
      } catch (e) {
        logger.warn('Could not delete equipment document file from storage', {
          data: { key, error: e },
        });
        // Continuar aunque falle algún archivo
      }
    }

    // Eliminar registro de BD (el historial se elimina por CASCADE)
    await prisma.equipmentDocument.delete({
      where: { id },
    });

    logger.info('Equipment document deleted completely', {
      data: { id, vehicleId, filesDeleted: keysToDelete.length },
    });

    // Recalculate vehicle status
    await recalculateVehicleStatus(vehicleId, companyId);

    revalidatePath(`/dashboard/equipment/${vehicleId}`);
    revalidatePath('/dashboard/documents');

    return { success: true };
  } catch (error) {
    logger.error('Error deleting equipment document', {
      data: { error, id, vehicleId },
    });

    const message = error instanceof Error ? error.message : 'Error al eliminar documento';
    return { success: false, error: message };
  }
}

/**
 * Elimina SOLO la versión actual del documento y restaura la versión anterior del historial.
 * Si no hay versión anterior, elimina el documento completamente.
 */
export async function revertEquipmentDocumentVersion(
  id: string,
  vehicleId: string
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
    const document = await prisma.equipmentDocument.findFirst({
      where: {
        id,
        vehicleId,
        vehicle: { companyId },
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
      return deleteEquipmentDocument(id, vehicleId);
    }

    // Eliminar el archivo actual de storage
    if (document.documentKey) {
      try {
        await deleteFile(document.documentKey);
        logger.info('Current equipment document file deleted', { data: { key: document.documentKey } });
      } catch (e) {
        logger.warn('Could not delete current equipment document file', {
          data: { key: document.documentKey, error: e },
        });
      }
    }

    // Actualizar el documento con los datos de la versión anterior
    await prisma.equipmentDocument.update({
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
    await prisma.equipmentDocumentHistory.create({
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
    await prisma.equipmentDocumentHistory.delete({
      where: { id: previousVersion.id },
    });

    logger.info('Equipment document reverted to previous version', {
      data: { id, vehicleId, restoredFile: previousVersion.fileName },
    });

    // Recalculate vehicle status
    await recalculateVehicleStatus(vehicleId, companyId);

    revalidatePath(`/dashboard/equipment/${vehicleId}`);
    revalidatePath('/dashboard/documents');

    return { success: true };
  } catch (error) {
    logger.error('Error reverting equipment document version', {
      data: { error, id, vehicleId },
    });

    const message = error instanceof Error ? error.message : 'Error al revertir versión';
    return { success: false, error: message };
  }
}
