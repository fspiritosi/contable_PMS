'use server';

import { getCurrentUserId } from '@/shared/lib/current-user';
import { prisma } from '@/shared/lib/prisma';
import { getActiveCompanyId } from '@/shared/lib/company';

// Obtener clientes activos para el selector
export async function getActiveCustomers() {
  const authUserId = await getCurrentUserId();
  if (!authUserId) throw new Error('No autenticado');

  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  const customers = await prisma.contractor.findMany({
    where: {
      companyId: companyId,
    },
    select: {
      id: true,
      name: true,
      taxId: true,
      email: true,
    },
    orderBy: {
      name: 'asc',
    },
  });

  return customers;
}

// Obtener puntos de venta activos para el selector
export async function getActivePointsOfSale() {
  const authUserId = await getCurrentUserId();
  if (!authUserId) throw new Error('No autenticado');

  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  const pointsOfSale = await prisma.salesPointOfSale.findMany({
    where: {
      companyId: companyId,
      isActive: true,
    },
    select: {
      id: true,
      number: true,
      name: true,
      afipEnabled: true,
    },
    orderBy: {
      number: 'asc',
    },
  });

  return pointsOfSale;
}

// Obtener ítems activos para el selector
export async function getActiveProducts() {
  const authUserId = await getCurrentUserId();
  if (!authUserId) throw new Error('No autenticado');

  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  const products = await prisma.product.findMany({
    where: {
      companyId: companyId,
      status: 'ACTIVE',
      usage: { in: ['SALE', 'PURCHASE_SALE'] },
    },
    select: {
      id: true,
      code: true,
      name: true,
      description: true,
      unitOfMeasure: true,
      salePrice: true,
      salePriceWithTax: true,
      vatRate: true,
      trackStock: true,
      // El tipo de la cuenta decide si la línea admite centro de costo (TSK-583).
      defaultIncomeAccount: { select: { type: true } },
    },
    orderBy: {
      name: 'asc',
    },
  });

  return products.map((p) => ({
    ...p,
    salePrice: Number(p.salePrice),
    salePriceWithTax: Number(p.salePriceWithTax),
    vatRate: Number(p.vatRate),
    defaultIncomeAccountType: p.defaultIncomeAccount?.type ?? null,
  }));
}
