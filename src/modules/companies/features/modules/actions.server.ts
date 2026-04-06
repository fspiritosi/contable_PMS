'use server';

import { prisma } from '@/shared/lib/prisma';
import { logger } from '@/shared/lib/logger';
import { getActiveCompanyId } from '@/shared/lib/company';
import { checkPermission } from '@/shared/lib/permissions';
import {
  resolveModuleDependencies,
  ACTIVATABLE_MODULES,
  type ActivatableModule,
} from '@/shared/lib/modules';
import { revalidatePath } from 'next/cache';

export async function getCompanyActiveModules() {
  await checkPermission('company.general.users', 'view', { redirect: true });
  const companyId = await getActiveCompanyId();

  const company = await prisma.company.findUnique({
    where: { id: companyId! },
    select: { activeModules: true },
  });

  return company?.activeModules ?? [];
}

export async function updateCompanyModules(modules: string[]) {
  await checkPermission('company.general.users', 'update', { redirect: true });
  const companyId = await getActiveCompanyId();

  // Validate all modules are valid
  const validModules = modules.filter((m) =>
    Object.values(ACTIVATABLE_MODULES).includes(m as ActivatableModule),
  ) as ActivatableModule[];

  // Resolve dependencies
  const resolved = resolveModuleDependencies(validModules);

  await prisma.company.update({
    where: { id: companyId! },
    data: { activeModules: resolved },
  });

  logger.info('Company modules updated', { data: { companyId, modules: resolved } });
  revalidatePath('/dashboard');
  return { success: true, activeModules: resolved };
}
