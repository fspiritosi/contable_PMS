'use server';

import { prisma } from '@/shared/lib/prisma';
import { logger } from '@/shared/lib/logger';
import { getActiveCompanyId } from '@/shared/lib/company';
import { checkPermission } from '@/shared/lib/permissions';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { revalidatePath } from 'next/cache';

// ============================================
// CIFRADO AES-256 PARA CREDENCIALES
// ============================================

const ENCRYPTION_KEY = process.env.ARCA_ENCRYPTION_KEY ?? '';
const ALGORITHM = 'aes-256-gcm';

function encrypt(data: Buffer): Buffer {
  if (!ENCRYPTION_KEY) throw new Error('ARCA_ENCRYPTION_KEY no configurada');

  const key = Buffer.from(ENCRYPTION_KEY, 'hex');
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
  const authTag = cipher.getAuthTag();

  // Formato: iv(12) + authTag(16) + encrypted(N)
  return Buffer.concat([iv, authTag, encrypted]);
}

export function decrypt(data: Buffer): Buffer {
  if (!ENCRYPTION_KEY) throw new Error('ARCA_ENCRYPTION_KEY no configurada');

  const key = Buffer.from(ENCRYPTION_KEY, 'hex');
  const iv = data.subarray(0, 12);
  const authTag = data.subarray(12, 28);
  const encrypted = data.subarray(28);

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  return Buffer.concat([decipher.update(encrypted), decipher.final()]);
}

// ============================================
// CRUD DE CREDENCIALES
// ============================================

export async function getArcaCredentials() {
  await checkPermission('company.general', 'view', { redirect: true });

  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    const credentials = await prisma.arcaCredential.findMany({
      where: { companyId },
      select: {
        id: true,
        cuit: true,
        environment: true,
        tokenExpiry: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { environment: 'asc' },
    });

    return credentials.map((c) => ({
      id: c.id,
      cuit: c.cuit,
      environment: c.environment,
      hasValidToken: c.tokenExpiry ? c.tokenExpiry > new Date() : false,
      tokenExpiry: c.tokenExpiry,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
    }));
  } catch (error) {
    logger.error('Error al obtener credenciales ARCA', { data: { error, companyId } });
    throw error;
  }
}

interface SaveCredentialInput {
  cuit: string;
  environment: string;
  certificate: ArrayBuffer;
  privateKey: ArrayBuffer;
}

export async function saveArcaCredential(input: SaveCredentialInput) {
  await checkPermission('company.general', 'update', { redirect: true });

  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    const certBuffer = Buffer.from(input.certificate);
    const keyBuffer = Buffer.from(input.privateKey);

    // Cifrar certificado y clave privada — convertir a Uint8Array para Prisma 7
    const encryptedCert = new Uint8Array(encrypt(certBuffer));
    const encryptedKey = new Uint8Array(encrypt(keyBuffer));

    const result = await prisma.arcaCredential.upsert({
      where: {
        companyId_environment: {
          companyId,
          environment: input.environment,
        },
      },
      update: {
        cuit: input.cuit,
        certificate: encryptedCert,
        privateKey: encryptedKey,
        token: null,
        sign: null,
        tokenExpiry: null,
      },
      create: {
        companyId,
        cuit: input.cuit,
        environment: input.environment,
        certificate: encryptedCert,
        privateKey: encryptedKey,
      },
      select: { id: true },
    });

    logger.info('Credencial ARCA guardada', {
      data: { companyId, environment: input.environment, cuit: input.cuit },
    });

    revalidatePath('/dashboard/company/settings/arca');

    return result;
  } catch (error) {
    logger.error('Error al guardar credencial ARCA', { data: { error, companyId } });
    throw error;
  }
}

export async function deleteArcaCredential(id: string) {
  await checkPermission('company.general', 'delete', { redirect: true });

  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    await prisma.arcaCredential.delete({ where: { id } });

    logger.info('Credencial ARCA eliminada', { data: { companyId, id } });
    revalidatePath('/dashboard/company/settings/arca');
  } catch (error) {
    logger.error('Error al eliminar credencial ARCA', { data: { error, companyId, id } });
    throw error;
  }
}
