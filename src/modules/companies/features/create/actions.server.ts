'use server';

import { getCurrentUserId } from '@/shared/lib/current-user';
import { prisma } from '@/shared/lib/prisma';
import { logger } from '@/shared/lib/logger';
import { revalidateCompanyRoutes } from '@/modules/companies/shared/utils';
import { initializeCompanyRbac } from '@/shared/lib/permissions/rbac-init';

import { TaxStatus } from '@/generated/prisma/enums';

export interface CreateCompanyInput {
  name: string;
  taxId?: string;
  taxStatus?: TaxStatus;
  description?: string;
  email?: string;
  phone?: string;
  address?: string;
  country?: string;
  industry?: string;
  provinceId?: number;
  cityId?: number;
}

/**
 * Crea una nueva company y asigna al usuario como owner
 */
export async function createCompany(input: CreateCompanyInput) {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('No autenticado');

  try {
    // Generar slug desde el nombre
    const slug = input.name
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');

    // Verificar que el slug no exista
    const existingSlug = await prisma.company.findUnique({
      where: { slug },
    });

    const finalSlug = existingSlug ? `${slug}-${Date.now()}` : slug;

    // Crear company y membership en transacción
    const result = await prisma.$transaction(async (tx) => {
      // Crear la company
      const company = await tx.company.create({
        data: {
          name: input.name,
          slug: finalSlug,
          taxId: input.taxId,
          taxStatus: input.taxStatus,
          description: input.description,
          email: input.email,
          phone: input.phone,
          address: input.address,
          country: input.country,
          industry: input.industry,
          provinceId: input.provinceId,
          cityId: input.cityId,
        },
      });

      // Inicializar RBAC (acciones globales, roles de sistema y permisos) de forma
      // idempotente, para que la empresa nazca con roles/permisos sin depender del seed.
      const { roleIds } = await initializeCompanyRbac(tx, company.id);

      // Crear membership como owner, con el rol Propietario asignado.
      await tx.companyMember.create({
        data: {
          companyId: company.id,
          userId,
          isOwner: true,
          roleId: roleIds.owner,
          joinedAt: new Date(),
        },
      });

      // Actualizar preferencias para usar esta company como activa
      await tx.userPreference.upsert({
        where: { userId },
        create: {
          userId,
          activeCompanyId: company.id,
        },
        update: {
          activeCompanyId: company.id,
        },
      });

      return company;
    });

    logger.info('Company creada', { data: { companyId: result.id, userId } });
    revalidateCompanyRoutes(result.id);

    return result;
  } catch (error) {
    logger.error('Error al crear company', { 
      data: { 
        error, 
        userId,
        errorMessage: error instanceof Error ? error.message : 'Error desconocido',
        errorStack: error instanceof Error ? error.stack : undefined
      } 
    });
    if (error instanceof Error) {
      throw new Error(`Error al crear empresa: ${error.message}`);
    }
    throw new Error('Error al crear empresa');
  }
}
