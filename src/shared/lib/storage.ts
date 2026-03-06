/**
 * Servicio de Storage Unificado
 *
 * Abstracción que soporta:
 * - S3 compatible (MinIO local / Cloudflare R2 producción)
 * - Local filesystem (legacy, solo para desarrollo sin Docker)
 *
 * La API es la misma independientemente del provider.
 */

import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { promises as fs } from 'fs';
import path from 'path';

import {
  generateUniqueFilename,
  getContentType,
  isS3Provider,
  slugify,
  storageConfig,
  validateFile,
} from '../config/storage.config';
import { logger } from './logger';

// Re-exportar helpers útiles
export { generateUniqueFilename, slugify, validateFile };

// ============================================
// TIPOS
// ============================================

export interface UploadOptions {
  /** Carpeta/prefijo donde guardar el archivo */
  folder?: string;
  /** Content-Type del archivo (auto-detectado si no se especifica) */
  contentType?: string;
  /** Usar nombre único generado (default: true) */
  useUniqueFilename?: boolean;
  /** Metadata adicional para S3 */
  metadata?: Record<string, string>;
}

export interface UploadResult {
  /** Key/path del archivo en storage */
  key: string;
  /** URL pública o presigned para acceder al archivo */
  url: string;
  /** Nombre del archivo guardado */
  filename: string;
}

export interface PresignedUrlOptions {
  /** Tiempo de expiración en segundos (default: 3600) */
  expiresIn?: number;
  /** Forzar descarga con este nombre de archivo */
  downloadFilename?: string;
}

// ============================================
// CLIENTE S3 (Singleton)
// ============================================

let s3Client: S3Client | null = null;

function getS3Client(): S3Client {
  if (!s3Client) {
    const { s3 } = storageConfig;

    s3Client = new S3Client({
      region: s3.region,
      endpoint: s3.endpoint,
      credentials: {
        accessKeyId: s3.accessKeyId,
        secretAccessKey: s3.secretAccessKey,
      },
      forcePathStyle: s3.forcePathStyle,
    });

    logger.info('S3 Client inicializado', {
      data: {
        endpoint: s3.endpoint,
        bucket: s3.bucket,
        forcePathStyle: s3.forcePathStyle,
      },
    });
  }

  return s3Client;
}

// ============================================
// FUNCIONES S3
// ============================================

async function uploadToS3(
  file: Buffer | Uint8Array,
  filename: string,
  options: UploadOptions = {}
): Promise<UploadResult> {
  const { folder = '', contentType, metadata } = options;
  const { s3 } = storageConfig;

  const key = folder ? `${folder}/${filename}` : filename;
  const client = getS3Client();

  await client.send(
    new PutObjectCommand({
      Bucket: s3.bucket,
      Key: key,
      Body: file,
      ContentType: contentType || getContentType(filename),
      Metadata: metadata,
    })
  );

  // Generar URL
  let url: string;
  if (s3.publicUrl) {
    // URL pública directa (si el bucket tiene acceso público)
    url = `${s3.publicUrl}/${key}`;
  } else {
    // Presigned URL para acceso temporal
    url = await getPresignedDownloadUrl(key);
  }

  return { key, url, filename };
}

async function deleteFromS3(key: string): Promise<void> {
  const { s3 } = storageConfig;
  const client = getS3Client();

  await client.send(
    new DeleteObjectCommand({
      Bucket: s3.bucket,
      Key: key,
    })
  );
}

async function getS3PresignedDownloadUrl(
  key: string,
  options: PresignedUrlOptions = {}
): Promise<string> {
  const { s3 } = storageConfig;
  const expiresIn = options.expiresIn || storageConfig.presignedUrlExpiry;
  const client = getS3Client();

  const command = new GetObjectCommand({
    Bucket: s3.bucket,
    Key: key,
    ...(options.downloadFilename && {
      ResponseContentDisposition: `attachment; filename="${options.downloadFilename}"`,
    }),
  });

  // unhoistableHeaders evita que el SDK agregue headers como x-amz-checksum-mode
  // que causan errores de firma con MinIO
  return await getSignedUrl(client, command, {
    expiresIn,
    unhoistableHeaders: new Set(['x-amz-checksum-mode']),
  });
}

async function getS3PresignedUploadUrl(
  key: string,
  contentType: string,
  options: PresignedUrlOptions = {}
): Promise<string> {
  const { s3 } = storageConfig;
  const expiresIn = options.expiresIn || storageConfig.presignedUrlExpiry;
  const client = getS3Client();

  const command = new PutObjectCommand({
    Bucket: s3.bucket,
    Key: key,
    ContentType: contentType,
  });

  return await getSignedUrl(client, command, { expiresIn });
}

// ============================================
// FUNCIONES LOCAL (Legacy)
// ============================================

async function ensureDirectory(dirPath: string): Promise<void> {
  try {
    await fs.access(dirPath);
  } catch {
    await fs.mkdir(dirPath, { recursive: true });
  }
}

async function uploadToLocal(
  file: Buffer | Uint8Array,
  filename: string,
  options: UploadOptions = {}
): Promise<UploadResult> {
  const { folder = '' } = options;
  const { local } = storageConfig;

  const key = folder ? `${folder}/${filename}` : filename;
  const fullPath = path.join(local.basePath, key);
  const dirPath = path.dirname(fullPath);

  await ensureDirectory(dirPath);
  await fs.writeFile(fullPath, file);

  const url = `${local.publicUrl}/${key}`;

  return { key, url, filename };
}

async function deleteFromLocal(key: string): Promise<void> {
  const { local } = storageConfig;
  const fullPath = path.join(local.basePath, key);

  try {
    await fs.unlink(fullPath);
  } catch (error) {
    // Ignorar si el archivo no existe
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }
}

// ============================================
// API PÚBLICA
// ============================================

/**
 * Sube un archivo al storage
 */
export async function uploadFile(
  file: Buffer | Uint8Array,
  originalFilename: string,
  options: UploadOptions = {}
): Promise<UploadResult> {
  const useUniqueFilename = options.useUniqueFilename ?? true;
  const filename = useUniqueFilename
    ? generateUniqueFilename(originalFilename)
    : originalFilename;

  try {
    let result: UploadResult;

    if (isS3Provider()) {
      result = await uploadToS3(file, filename, options);
    } else {
      result = await uploadToLocal(file, filename, options);
    }

    logger.info('Archivo subido exitosamente', {
      data: {
        key: result.key,
        provider: storageConfig.provider,
        size: file.length,
      },
    });

    return result;
  } catch (error) {
    logger.error('Error al subir archivo', {
      data: { error, filename, provider: storageConfig.provider },
    });
    throw new Error('Error al subir archivo al storage');
  }
}

/**
 * Elimina un archivo del storage
 */
export async function deleteFile(key: string): Promise<void> {
  try {
    if (isS3Provider()) {
      await deleteFromS3(key);
    } else {
      await deleteFromLocal(key);
    }

    logger.info('Archivo eliminado exitosamente', {
      data: { key, provider: storageConfig.provider },
    });
  } catch (error) {
    logger.error('Error al eliminar archivo', {
      data: { error, key, provider: storageConfig.provider },
    });
    throw new Error('Error al eliminar archivo del storage');
  }
}

/**
 * Obtiene una URL para descargar un archivo
 * Si hay S3_PUBLIC_URL configurada, retorna URL pública directa
 * Si no, genera una presigned URL real con el AWS SDK
 */
export async function getPresignedDownloadUrl(
  key: string,
  options: PresignedUrlOptions = {}
): Promise<string> {
  if (isS3Provider()) {
    const { s3 } = storageConfig;
    // Si hay URL pública configurada, usarla directamente
    if (s3.publicUrl) {
      return `${s3.publicUrl}/${key}`;
    }
    // Generar presigned URL real con AWS SDK
    return await getS3PresignedDownloadUrl(key, options);
  }
  // Storage local: URL del API route
  return `${storageConfig.local.publicUrl}/${key}`;
}

/**
 * Obtiene una URL presigned para subir un archivo directamente desde el cliente
 * (Solo funciona con S3/MinIO/R2)
 */
export async function getPresignedUploadUrl(
  key: string,
  contentType: string,
  options: PresignedUrlOptions = {}
): Promise<string> {
  if (!isS3Provider()) {
    throw new Error('Presigned upload URLs solo disponibles con S3 provider');
  }

  try {
    return await getS3PresignedUploadUrl(key, contentType, options);
  } catch (error) {
    logger.error('Error al generar URL de upload', {
      data: { error, key, provider: storageConfig.provider },
    });
    throw new Error('Error al generar URL de upload');
  }
}

/**
 * Obtiene la URL pública de un archivo
 * (Para archivos en carpetas públicas o buckets públicos)
 */
export function getPublicUrl(key: string): string {
  if (isS3Provider()) {
    const { s3 } = storageConfig;
    if (s3.publicUrl) {
      return `${s3.publicUrl}/${key}`;
    }
    // Si no hay URL pública, construir desde endpoint
    return `${s3.endpoint}/${s3.bucket}/${key}`;
  } else {
    return `${storageConfig.local.publicUrl}/${key}`;
  }
}

// ============================================
// HELPERS PARA LEER ARCHIVOS (API route)
// ============================================

/**
 * Lee un archivo desde S3 (solo para el API route)
 * Retorna null si no existe
 */
export async function readS3File(key: string): Promise<Buffer | null> {
  const { s3 } = storageConfig;
  const client = getS3Client();

  try {
    const response = await client.send(
      new GetObjectCommand({
        Bucket: s3.bucket,
        Key: key,
      })
    );

    if (!response.Body) return null;

    // Convertir stream a Buffer
    const chunks: Uint8Array[] = [];
    const stream = response.Body as AsyncIterable<Uint8Array>;
    for await (const chunk of stream) {
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  } catch (error: unknown) {
    if ((error as { name?: string }).name === 'NoSuchKey') {
      return null;
    }
    throw error;
  }
}

// ============================================
// HELPERS PARA LEER ARCHIVOS LOCALES
// (Solo para API route de serving local)
// ============================================

/**
 * Lee un archivo local (solo para el API route)
 */
export async function readLocalFile(key: string): Promise<Buffer> {
  const fullPath = path.join(storageConfig.local.basePath, key);
  return await fs.readFile(fullPath);
}

/**
 * Verifica si un archivo local existe
 */
export async function localFileExists(key: string): Promise<boolean> {
  const fullPath = path.join(storageConfig.local.basePath, key);
  try {
    await fs.access(fullPath);
    return true;
  } catch {
    return false;
  }
}

// Re-exportar funciones de paths desde config
export {
  buildEmployeeDocumentPath,
  buildEquipmentDocumentPath,
  buildCompanyDocumentPath,
  buildCommercialDocumentPath,
  buildDocumentFilename,
  sanitizeFilename,
} from '../config/storage.config';
