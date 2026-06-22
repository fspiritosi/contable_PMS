'use server';

import { revalidatePath } from 'next/cache';
import { getCurrentUserId } from '@/shared/lib/current-user';
import { prisma } from '@/shared/lib/prisma';
import { logger } from '@/shared/lib/logger';
import { uploadFile, deleteFile } from '@/shared/lib/storage';
import { revalidateCompanyRoutes } from '@/modules/companies/shared/utils';
import { getActiveCompanyId } from '@/shared/lib/company';
import { checkPermission } from '@/shared/lib/permissions';
import { invalidateLogoCache } from '@/shared/utils/logo';
import { slugify } from '@/shared/config/storage.config';

const ERROR_CODES = {
  NotFound: 'COMPANY_NOT_FOUND',
  Forbidden: 'COMPANY_FORBIDDEN',
} as const;

/**
 * Obtiene una company por ID (solo si el usuario es miembro)
 */
export async function getCompanyById(companyId: string) {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('No autenticado');

  if (!companyId) {
    logger.error('companyId is undefined');
    throw new Error(ERROR_CODES.NotFound);
  }

  try {
    // Verificar que el usuario es miembro
    const membership = await prisma.companyMember.findFirst({
      where: {
        userId,
        companyId,
        isActive: true,
      },
      select: {
        isOwner: true,
      },
    });

    if (!membership) {
      throw new Error(ERROR_CODES.Forbidden);
    }

    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: {
        id: true,
        name: true,
        slug: true,
        taxId: true,
        taxStatus: true,
        description: true,
        email: true,
        phone: true,
        address: true,
        country: true,
        industry: true,
        logoUrl: true,
        isActive: true,
        isSingleCompany: true,
        createdAt: true,
        updatedAt: true,
        province: true,
        city: true,
        provinceId: true,
        cityId: true,
        _count: {
          select: { members: true },
        },
      },
    });

    if (!company || !company.isActive) {
      throw new Error(ERROR_CODES.NotFound);
    }

    return {
      ...company,
      isOwner: membership.isOwner,
      memberCount: company._count.members,
    };
  } catch (error) {
    logger.error('Error al obtener company', { data: { error, companyId, userId } });
    throw error;
  }
}

/**
 * Elimina una company (soft delete, solo owner)
 */
export async function deleteCompany(companyId: string) {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('No autenticado');

  if (!companyId) {
    logger.error('companyId is undefined');
    throw new Error('Company ID is required');
  }

  try {
    // Verificar que el usuario es owner
    const membership = await prisma.companyMember.findFirst({
      where: {
        userId,
        companyId,
      },
    });

    if (!membership?.isOwner) {
      throw new Error('Solo el propietario puede eliminar la empresa');
    }

    await prisma.company.update({
      where: { id: companyId },
      data: { isActive: false },
    });

    logger.info('Company eliminada', { data: { companyId, userId } });
    revalidateCompanyRoutes(companyId);

    return { success: true };
  } catch (error) {
    logger.error('Error al eliminar company', { data: { error, companyId, userId } });
    throw error;
  }
}

/**
 * Actualiza el modo Single Company (solo owner, solo en DEV)
 */
export async function updateCompanySingleMode(companyId: string, isSingleCompany: boolean) {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('No autenticado');

  if (!companyId) {
    logger.error('companyId is undefined');
    throw new Error('Company ID is required');
  }

  // Solo permitir en modo desarrollo
  if (process.env.NEXT_PUBLIC_IS_DEV !== 'true') {
    throw new Error('Esta funcionalidad solo está disponible en modo desarrollo');
  }

  try {
    // Verificar que el usuario es owner
    const membership = await prisma.companyMember.findFirst({
      where: {
        userId,
        companyId,
      },
    });

    if (!membership?.isOwner) {
      throw new Error('Solo el propietario puede cambiar esta configuración');
    }

    await prisma.company.update({
      where: { id: companyId },
      data: { isSingleCompany },
    });

    logger.info('Company single mode actualizado', { data: { companyId, isSingleCompany, userId } });
    revalidateCompanyRoutes(companyId);

    return { success: true };
  } catch (error) {
    logger.error('Error al actualizar single mode', { data: { error, companyId, userId } });
    throw error;
  }
}

// Tipo inferido
export type Company = Awaited<ReturnType<typeof getCompanyById>>;

// ============================================
// LOGO DE EMPRESA
// ============================================

const LOGO_MIME_TYPES = ['image/png', 'image/jpeg'] as const;
const LOGO_MAX_SIZE_BYTES = 10 * 1024 * 1024; // 10MB

/**
 * Sube el logo de la empresa activa.
 * Solo PNG o JPG, máximo 10MB. Reemplaza el logo anterior.
 */
export async function uploadCompanyLogo(params: { file: number[]; fileName: string; mimeType: string }) {
  await checkPermission('company.companies', 'update', { redirect: true });

  const userId = await getCurrentUserId();
  if (!userId) throw new Error('No autenticado');

  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  const { file, fileName, mimeType } = params;

  if (!LOGO_MIME_TYPES.includes(mimeType as (typeof LOGO_MIME_TYPES)[number])) {
    throw new Error('Solo se permiten imágenes PNG o JPG');
  }

  if (file.length > LOGO_MAX_SIZE_BYTES) {
    throw new Error('El logo no puede superar los 10MB');
  }

  try {
    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: { id: true, name: true, logoUrl: true },
    });
    if (!company) throw new Error('Empresa no encontrada');

    const buffer = Buffer.from(file);
    const companySlug = slugify(company.name);
    const finalFolder = `${companySlug}/logo`;

    const result = await uploadFile(buffer, fileName, { folder: finalFolder });

    const oldKey = company.logoUrl?.startsWith('/api/storage/')
      ? company.logoUrl.slice('/api/storage/'.length)
      : null;

    await prisma.company.update({
      where: { id: companyId },
      data: { logoUrl: result.url },
    });

    invalidateLogoCache(companyId);

    if (oldKey && oldKey !== result.key) {
      try {
        await deleteFile(oldKey);
      } catch (error) {
        logger.warn('No se pudo eliminar logo anterior', { data: { key: oldKey, error } });
      }
    }

    revalidatePath('/dashboard/companies');
    revalidatePath(`/dashboard/companies/${companyId}`);

    logger.info('Logo de empresa actualizado', {
      data: { companyId, key: result.key },
    });

    return { success: true, url: result.url };
  } catch (error) {
    logger.error('Error al subir logo de empresa', {
      data: { error, companyId, fileName },
    });
    if (error instanceof Error) throw error;
    throw new Error('Error al subir el logo');
  }
}

/**
 * Elimina el logo de la empresa activa.
 */
export async function deleteCompanyLogo() {
  await checkPermission('company.companies', 'update', { redirect: true });

  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: { logoUrl: true },
    });

    if (!company?.logoUrl) {
      throw new Error('No hay logo para eliminar');
    }

    const key = company.logoUrl.startsWith('/api/storage/')
      ? company.logoUrl.slice('/api/storage/'.length)
      : null;

    if (key) {
      try {
        await deleteFile(key);
      } catch (error) {
        logger.warn('No se pudo eliminar archivo de logo', { data: { key, error } });
      }
    }

    await prisma.company.update({
      where: { id: companyId },
      data: { logoUrl: null },
    });

    invalidateLogoCache(companyId);

    revalidatePath('/dashboard/companies');
    revalidatePath(`/dashboard/companies/${companyId}`);

    logger.info('Logo de empresa eliminado', { data: { companyId } });

    return { success: true };
  } catch (error) {
    logger.error('Error al eliminar logo de empresa', {
      data: { error, companyId },
    });
    if (error instanceof Error) throw error;
    throw new Error('Error al eliminar el logo');
  }
}
