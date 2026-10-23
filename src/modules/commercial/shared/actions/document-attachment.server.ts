'use server';

import { buildCommercialDocumentPath } from '@/shared/config/storage.config';
import { getCurrentUserId } from '@/shared/lib/current-user';
import { logger } from '@/shared/lib/logger';
import { prisma } from '@/shared/lib/prisma';
import { deleteFile, getPresignedDownloadUrl, uploadFile } from '@/shared/lib/storage';
import { revalidatePath } from 'next/cache';

type CommercialDocumentType = 'sales-invoice' | 'purchase-invoice' | 'receipt' | 'payment-order';

const DOCUMENT_TYPE_TO_PATH: Record<
  CommercialDocumentType,
  'facturas-venta' | 'facturas-compra' | 'recibos' | 'ordenes-pago'
> = {
  'sales-invoice': 'facturas-venta',
  'purchase-invoice': 'facturas-compra',
  receipt: 'recibos',
  'payment-order': 'ordenes-pago',
};

/**
 * Sube un documento adjunto a una entidad comercial
 */
export async function uploadDocumentAttachment(params: {
  documentType: CommercialDocumentType;
  documentId: string;
  companyId: string;
  companyName: string;
  documentNumber: string;
  fileName: string;
  file: number[];
}) {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('No autenticado');

  const { documentType, documentId, companyId, companyName, documentNumber, fileName, file } =
    params;

  try {
    const buffer = Buffer.from(file);

    // Construir path de storage
    const folder = buildCommercialDocumentPath({
      companyName,
      documentType: DOCUMENT_TYPE_TO_PATH[documentType],
      documentNumber,
      filename: '',
    }).replace(/\/$/, '');

    // Subir archivo
    const result = await uploadFile(buffer, fileName, { folder });

    // Obtener documento previo para eliminar si existe
    const existingDoc = await getExistingDocumentKey(documentType, documentId, companyId);

    // Actualizar registro con la URL y key del nuevo documento
    await updateDocumentFields(documentType, documentId, companyId, result.url, result.key);

    // Eliminar documento anterior si existía
    if (existingDoc) {
      try {
        await deleteFile(existingDoc);
      } catch (error) {
        logger.warn('No se pudo eliminar documento anterior', {
          data: { key: existingDoc, error },
        });
      }
    }

    logger.info('Documento adjunto subido', {
      data: { documentType, documentId, key: result.key },
    });

    revalidateCommercialPaths();

    return { success: true, url: result.url, key: result.key };
  } catch (error) {
    logger.error('Error al subir documento adjunto', { data: { error, documentType, documentId } });
    throw new Error('Error al subir documento adjunto');
  }
}

/**
 * Elimina un documento adjunto de una entidad comercial
 */
export async function deleteDocumentAttachment(params: {
  documentType: CommercialDocumentType;
  documentId: string;
  companyId: string;
}) {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('No autenticado');

  const { documentType, documentId, companyId } = params;

  try {
    // Obtener key del documento actual
    const documentKey = await getExistingDocumentKey(documentType, documentId, companyId);

    if (!documentKey) {
      throw new Error('No hay documento adjunto para eliminar');
    }

    // Eliminar de storage
    await deleteFile(documentKey);

    // Limpiar campos en la BD
    await updateDocumentFields(documentType, documentId, companyId, null, null);

    logger.info('Documento adjunto eliminado', {
      data: { documentType, documentId, key: documentKey },
    });

    revalidateCommercialPaths();

    return { success: true };
  } catch (error) {
    logger.error('Error al eliminar documento adjunto', {
      data: { error, documentType, documentId },
    });
    if (error instanceof Error) throw error;
    throw new Error('Error al eliminar documento adjunto');
  }
}

/**
 * Obtiene la URL de descarga de un documento adjunto
 */
export async function getDocumentAttachmentUrl(params: {
  documentType: CommercialDocumentType;
  documentId: string;
  companyId: string;
}) {
  const { documentType, documentId, companyId } = params;

  const documentKey = await getExistingDocumentKey(documentType, documentId, companyId);

  if (!documentKey) {
    return null;
  }

  return getPresignedDownloadUrl(documentKey);
}

// ============================================
// HELPERS INTERNOS
// ============================================

async function getExistingDocumentKey(
  documentType: CommercialDocumentType,
  documentId: string,
  companyId: string
): Promise<string | null> {
  const select = { documentKey: true };
  const where = { id: documentId, companyId };

  switch (documentType) {
    case 'sales-invoice': {
      const doc = await prisma.salesInvoice.findFirst({ where, select });
      return doc?.documentKey ?? null;
    }
    case 'purchase-invoice': {
      const doc = await prisma.purchaseInvoice.findFirst({ where, select });
      return doc?.documentKey ?? null;
    }
    case 'receipt': {
      const doc = await prisma.receipt.findFirst({ where, select });
      return doc?.documentKey ?? null;
    }
    case 'payment-order': {
      const doc = await prisma.paymentOrder.findFirst({ where, select });
      return doc?.documentKey ?? null;
    }
  }
}

async function updateDocumentFields(
  documentType: CommercialDocumentType,
  documentId: string,
  companyId: string,
  documentUrl: string | null,
  documentKey: string | null
): Promise<void> {
  const data = { documentUrl, documentKey };

  switch (documentType) {
    case 'sales-invoice':
      await prisma.salesInvoice.updateMany({ where: { id: documentId, companyId }, data });
      break;
    case 'purchase-invoice':
      await prisma.purchaseInvoice.updateMany({ where: { id: documentId, companyId }, data });
      break;
    case 'receipt':
      await prisma.receipt.updateMany({ where: { id: documentId, companyId }, data });
      break;
    case 'payment-order':
      await prisma.paymentOrder.updateMany({ where: { id: documentId, companyId }, data });
      break;
  }
}

function revalidateCommercialPaths() {
  revalidatePath('/dashboard/commercial/invoices');
  revalidatePath('/dashboard/commercial/purchases');
  revalidatePath('/dashboard/commercial/treasury/receipts');
  revalidatePath('/dashboard/commercial/treasury/payment-orders');
}
