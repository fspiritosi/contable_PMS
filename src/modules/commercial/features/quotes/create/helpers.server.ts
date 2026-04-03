'use server';

import { prisma } from '@/shared/lib/prisma';
import { getActiveCompanyId } from '@/shared/lib/company';
import { checkPermission } from '@/shared/lib/permissions';

export async function getActiveCustomersForQuote() {
  await checkPermission('commercial.quotes', 'view', { redirect: true });
  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  return prisma.contractor.findMany({
    where: { companyId, isActive: true },
    select: { id: true, name: true, taxId: true, email: true },
    orderBy: { name: 'asc' },
  });
}

export async function getActiveLeadsForQuote() {
  await checkPermission('commercial.quotes', 'view', { redirect: true });
  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  return prisma.lead.findMany({
    where: { companyId, isActive: true, convertedAt: null },
    select: { id: true, name: true, email: true, phone: true },
    orderBy: { name: 'asc' },
  });
}

export async function getActiveProductsForQuote() {
  await checkPermission('commercial.quotes', 'view', { redirect: true });
  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  const products = await prisma.product.findMany({
    where: { companyId, status: 'ACTIVE' },
    select: {
      id: true,
      code: true,
      name: true,
      description: true,
      unitOfMeasure: true,
      salePrice: true,
      vatRate: true,
    },
    orderBy: { name: 'asc' },
  });

  return products.map((p) => ({
    ...p,
    salePrice: Number(p.salePrice),
    vatRate: Number(p.vatRate),
  }));
}
