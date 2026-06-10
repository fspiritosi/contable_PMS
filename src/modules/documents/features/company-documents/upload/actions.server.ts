'use server';

import { getCurrentUserId } from '@/shared/lib/current-user';
import { revalidatePath } from 'next/cache';

import { getActiveCompanyId } from '@/shared/lib/company';
import { logger } from '@/shared/lib/logger';
import { checkPermission } from '@/shared/lib/permissions';
import { prisma } from '@/shared/lib/prisma';
import { uploadFile } from '@/shared/lib/storage';
import { generateCompanyDocumentPath } from '@/shared/utils/documentPaths';
import { generateCompanySlug } from '@/shared/utils/slugify';

// ============================================
// TIPOS
// ============================================

export interface UploadCompanyDocumentInput {
  documentTypeId: string;
  expirationDate?: Date | null;
  period?: string;
  // Archivo enviado como File (multipart/binario, sin inflar el payload)
  file: File;
  fileName: string;
  fileSize: number;
  mimeType: string;
}

export interface UploadCompanyDocumentResult {
  success: boolean;
  error?: string;
  documentId?: string;
}

// ============================================
// MUTATIONS
// ============================================

/**
 * Sube y registra un documento para la empresa
 */
export async function uploadCompanyDocument(
  input: UploadCompanyDocumentInput
): Promise<UploadCompanyDocumentResult> {
  await checkPermission('company.documents', 'create', { redirect: true });
  const companyId = await getActiveCompanyId();
  if (!companyId) {
    return { success: false, error: 'No hay empresa activa' };
  }

  const userId = await getCurrentUserId();
  if (!userId) {
    return { success: false, error: 'No autenticado' };
  }

  try {
    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: { id: true, name: true },
    });

    if (!company) {
      return { success: false, error: 'Empresa no encontrada' };
    }

    const documentType = await prisma.documentType.findFirst({
      where: { id: input.documentTypeId, companyId, appliesTo: 'COMPANY' },
      select: {
        id: true,
        slug: true,
        isMonthly: true,
        hasExpiration: true,
      },
    });

    if (!documentType) {
      return { success: false, error: 'Tipo de documento no encontrado' };
    }

    if (documentType.isMonthly && !input.period) {
      return { success: false, error: 'El periodo es requerido para documentos mensuales' };
    }

    if (documentType.hasExpiration && !input.expirationDate) {
      return {
        success: false,
        error: 'La fecha de vencimiento es requerida para este tipo de documento',
      };
    }

    // Upload file to storage
    const companySlug = generateCompanySlug(company.name);
    const folder = generateCompanyDocumentPath({
      companySlug,
      documentTypeSlug: documentType.slug,
      period: input.period,
      fileName: '', // We just need the folder path
    }).replace(/\/[^/]+$/, ''); // Remove filename to get folder

    const buffer = Buffer.from(await input.file.arrayBuffer());
    const uploadResult = await uploadFile(buffer, input.fileName, { folder });

    // Check if document already exists for this type/period
    const existing = await prisma.companyDocument.findFirst({
      where: {
        companyId,
        documentTypeId: input.documentTypeId,
        period: input.period ?? null,
      },
      select: { id: true },
    });

    const documentPath = generateCompanyDocumentPath({
      companySlug,
      documentTypeSlug: documentType.slug,
      period: input.period,
      fileName: input.fileName,
    });

    if (existing) {
      const document = await prisma.companyDocument.update({
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

      logger.info('Company document updated', { data: { id: document.id } });
      revalidatePath('/dashboard/documents');
      return { success: true, documentId: document.id };
    }

    const document = await prisma.companyDocument.create({
      data: {
        companyId,
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

    logger.info('Company document created', { data: { id: document.id } });
    revalidatePath('/dashboard/documents');
    return { success: true, documentId: document.id };
  } catch (error) {
    logger.error('Error uploading company document', { data: { error, input } });
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Error al subir documento',
    };
  }
}

/**
 * Elimina un documento de empresa
 */
export async function deleteCompanyDocument(id: string) {
  await checkPermission('company.documents', 'delete', { redirect: true });
  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    const document = await prisma.companyDocument.findFirst({
      where: { id, companyId },
      select: { id: true, documentKey: true },
    });

    if (!document) {
      throw new Error('Documento no encontrado');
    }

    await prisma.companyDocument.delete({
      where: { id },
    });

    logger.info('Company document deleted', { data: { id } });
    revalidatePath('/dashboard/documents');

    return { success: true };
  } catch (error) {
    logger.error('Error deleting company document', { data: { error, id } });
    throw error;
  }
}
