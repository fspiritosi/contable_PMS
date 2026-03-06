import { NextRequest, NextResponse } from 'next/server';

import { isS3Provider } from '@/shared/config/storage.config';
import { getContentType } from '@/shared/config/storage.config';
import { localFileExists, readLocalFile, readS3File } from '@/shared/lib/storage';
import { logger } from '@/shared/lib/logger';

/**
 * API Route para servir archivos del storage
 *
 * GET /api/storage/[...path]
 *
 * - Con STORAGE_PROVIDER=local: sirve archivos del filesystem
 * - Con STORAGE_PROVIDER=s3: descarga de S3 internamente y sirve al cliente
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  try {
    const { path: pathSegments } = await params;
    const key = pathSegments.join('/');

    // Validar que no haya path traversal
    if (key.includes('..') || key.startsWith('/')) {
      return NextResponse.json({ error: 'Ruta inválida' }, { status: 400 });
    }

    let file: Buffer | Uint8Array;

    if (isS3Provider()) {
      // S3: descargar internamente y servir al cliente
      const result = await readS3File(key);
      if (!result) {
        return NextResponse.json({ error: 'Archivo no encontrado' }, { status: 404 });
      }
      file = result;
    } else {
      // Storage local: servir archivo del filesystem
      const exists = await localFileExists(key);
      if (!exists) {
        return NextResponse.json({ error: 'Archivo no encontrado' }, { status: 404 });
      }
      file = await readLocalFile(key);
    }

    const contentType = getContentType(key);
    const download = request.nextUrl.searchParams.get('download');
    const filename = key.split('/').pop() || 'file';

    const headers: HeadersInit = {
      'Content-Type': contentType,
      'Content-Length': file.length.toString(),
      'Cache-Control': 'public, max-age=31536000, immutable',
    };

    if (download === 'true') {
      headers['Content-Disposition'] = `attachment; filename="${filename}"`;
    }

    return new NextResponse(new Uint8Array(file), { headers });
  } catch (error) {
    logger.error('Error al servir archivo', { data: { error } });
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 });
  }
}
