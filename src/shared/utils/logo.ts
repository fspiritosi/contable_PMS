import 'server-only';
import { prisma } from '@/shared/lib/prisma';
import { logger } from '@/shared/lib/logger';
import { readS3File, readLocalFile } from '@/shared/lib/storage';
import { getContentType } from '@/shared/config/storage.config';
import {isS3Provider} from '../config/storage.config'
/**
 * Cache de logos en memoria (data URI). Key = companyId.
 * TTL corto para evitar inconsistencias cuando se cambia el logo.
 */
const logoCache = new Map<string, { dataUri: string | null; expires: number }>();
const CACHE_TTL_MS = 60_000; // 1 minuto

/**
 * Extrae la key de storage del `logoUrl` guardado en la Company.
 * El `logoUrl` tiene el formato `/api/storage/{key}`.
 */
function extractStorageKey(logoUrl: string | null | undefined): string | null {
  if (!logoUrl) return null;
  const prefix = '/api/storage/';
  if (logoUrl.startsWith(prefix)) {
    return logoUrl.slice(prefix.length);
  }
  return null;
}

/**
 * Detecta el content type a partir del nombre del archivo.
 */
function getContentTypeFromKey(key: string): string {
  const ext = key.toLowerCase().split('.').pop();
  switch (ext) {
    case 'png':
      return 'image/png';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'webp':
      return 'image/webp';
    default:
      return getContentType(key) || 'application/octet-stream';
  }
}

/**
 * Invalida la cache de un logo (llamar desde upload/delete).
 */
export function invalidateLogoCache(companyId: string): void {
  logoCache.delete(companyId);
}

/**
 * Obtiene el logo de una empresa como data URI (base64) listo para embeber en PDFs.
 * Retorna `null` si la empresa no tiene logo o si hubo error al leerlo.
 *
 * Cache en memoria con TTL de 60s.
 */
export async function getLogoAsDataUri(companyId: string): Promise<string | null> {
  // Check cache
  const cached = logoCache.get(companyId);
  if (cached && cached.expires > Date.now()) {
    return cached.dataUri;
  }

  try {
    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: { logoUrl: true },
    });

    if (!company?.logoUrl) {
      logoCache.set(companyId, { dataUri: null, expires: Date.now() + CACHE_TTL_MS });
      return null;
    }

    const key = extractStorageKey(company.logoUrl);
    if (!key) {
      logoCache.set(companyId, { dataUri: null, expires: Date.now() + CACHE_TTL_MS });
      return null;
    }

    const buffer = isS3Provider() ? await readS3File(key) : await readLocalFile(key);
    if (!buffer) {
      logoCache.set(companyId, { dataUri: null, expires: Date.now() + CACHE_TTL_MS });
      return null;
    }

    const contentType = getContentTypeFromKey(key);
    const dataUri = `data:${contentType};base64,${buffer.toString('base64')}`;

    logoCache.set(companyId, { dataUri, expires: Date.now() + CACHE_TTL_MS });
    return dataUri;
  } catch (error) {
    logger.error('Error al obtener logo como data URI', { data: { companyId, error } });
    return null;
  }
}