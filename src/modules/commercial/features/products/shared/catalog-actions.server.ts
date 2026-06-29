'use server';

import { prisma } from '@/shared/lib/prisma';
import { getActiveCompanyId } from '@/shared/lib/company';
import { checkPermission } from '@/shared/lib/permissions';

export async function getAccountsForProductSelect() {
  await checkPermission('commercial.products', 'view', { redirect: true });
  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  return prisma.account.findMany({
    where: { companyId, isActive: true, isLeaf: true },
    select: { id: true, code: true, name: true, type: true, nature: true },
    orderBy: { code: 'asc' },
  });
}

export async function getCostCentersForProductSelect() {
  await checkPermission('commercial.products', 'view', { redirect: true });
  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  return prisma.costCenter.findMany({
    where: { companyId, isActive: true },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  });
}

export async function getWarehousesForProductSelect() {
  await checkPermission('commercial.products', 'view', { redirect: true });
  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  return prisma.warehouse.findMany({
    where: { companyId, isActive: true },
    select: { id: true, code: true, name: true },
    orderBy: { name: 'asc' },
  });
}

export async function getSuppliersForProductSelect() {
  await checkPermission('commercial.products', 'view', { redirect: true });
  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  return prisma.supplier.findMany({
    where: { companyId, status: 'ACTIVE' },
    select: { id: true, code: true, businessName: true, tradeName: true },
    orderBy: { businessName: 'asc' },
  });
}
