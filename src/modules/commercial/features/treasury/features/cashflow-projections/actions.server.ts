'use server';

import { auth } from '@clerk/nextjs/server';
import { getActiveCompanyId } from '@/shared/lib/company';
import { logger } from '@/shared/lib/logger';
import { prisma } from '@/shared/lib/prisma';
import { revalidatePath } from 'next/cache';
import type { DataTableSearchParams } from '@/shared/components/common/DataTable';
import {
  parseSearchParams,
  stateToPrismaParams,
  buildFiltersWhere,
  buildDateRangeFiltersWhere,
} from '@/shared/components/common/DataTable/helpers';
import type { CreateProjectionFormData, LinkDocumentFormData } from '../../shared/validators';
import type {
  ProjectionListItem,
  ProjectionDocumentLinkItem,
  DocumentForLinking,
  ProjectionForLinking,
} from '../../shared/types';
import { checkPermission } from '@/shared/lib/permissions';

// ============================================
// CONSULTAS
// ============================================

export async function getProjectionsPaginated(searchParams: DataTableSearchParams) {
  await checkPermission('commercial.treasury.projections', 'view', { redirect: true });
  const { userId } = await auth();
  if (!userId) throw new Error('No autenticado');

  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    const state = parseSearchParams(searchParams);
    const { skip, take, orderBy } = stateToPrismaParams(state);

    const filtersWhere = buildFiltersWhere(state.filters, {
      status: 'status',
      type: 'type',
      category: 'category',
    }, { exclude: ['date', 'description'] });

    const dateFiltersWhere = buildDateRangeFiltersWhere(state.filters, ['date']);

    // Filtro de texto para descripción
    const descriptionFilter = state.filters['description']?.[0];
    const descriptionWhere = descriptionFilter
      ? { description: { contains: descriptionFilter, mode: 'insensitive' as const } }
      : {};

    const where = {
      companyId,
      ...filtersWhere,
      ...dateFiltersWhere,
      ...descriptionWhere,
    };

    const [projections, totalRows] = await Promise.all([
      prisma.cashflowProjection.findMany({
        where,
        select: {
          id: true,
          type: true,
          category: true,
          description: true,
          amount: true,
          date: true,
          isRecurring: true,
          notes: true,
          status: true,
          confirmedAmount: true,
          createdAt: true,
        },
        orderBy: orderBy || { date: 'asc' },
        skip,
        take,
      }),
      prisma.cashflowProjection.count({ where }),
    ]);

    const data: ProjectionListItem[] = projections.map((p) => ({
      id: p.id,
      type: p.type,
      category: p.category,
      description: p.description,
      amount: Number(p.amount),
      date: p.date,
      isRecurring: p.isRecurring,
      notes: p.notes,
      status: p.status,
      confirmedAmount: Number(p.confirmedAmount),
      createdAt: p.createdAt,
    }));

    return { data, totalRows };
  } catch (error) {
    logger.error('Error al obtener proyecciones', { data: { error, companyId } });
    throw new Error('Error al obtener proyecciones');
  }
}

// ============================================
// CREAR PROYECCIÓN
// ============================================

export async function createProjection(data: CreateProjectionFormData) {
  await checkPermission('commercial.treasury.projections', 'create', { redirect: true });
  const { userId } = await auth();
  if (!userId) throw new Error('No autenticado');

  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    const projection = await prisma.cashflowProjection.create({
      data: {
        companyId,
        type: data.type,
        category: data.category,
        description: data.description,
        amount: parseFloat(data.amount),
        date: data.date,
        isRecurring: data.isRecurring,
        notes: data.notes || null,
        createdBy: userId,
      },
    });

    revalidatePath('/dashboard/commercial/treasury/projections');
    return { success: true, id: projection.id };
  } catch (error) {
    logger.error('Error al crear proyección', { data: { error, companyId } });
    throw new Error('Error al crear proyección');
  }
}

// ============================================
// ACTUALIZAR PROYECCIÓN
// ============================================

export async function updateProjection(id: string, data: CreateProjectionFormData) {
  await checkPermission('commercial.treasury.projections', 'update', { redirect: true });
  const { userId } = await auth();
  if (!userId) throw new Error('No autenticado');

  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    const existing = await prisma.cashflowProjection.findFirst({
      where: { id, companyId },
    });

    if (!existing) throw new Error('Proyección no encontrada');

    await prisma.cashflowProjection.update({
      where: { id },
      data: {
        type: data.type,
        category: data.category,
        description: data.description,
        amount: parseFloat(data.amount),
        date: data.date,
        isRecurring: data.isRecurring,
        notes: data.notes || null,
      },
    });

    revalidatePath('/dashboard/commercial/treasury/projections');
    return { success: true };
  } catch (error) {
    logger.error('Error al actualizar proyección', { data: { error, companyId, id } });
    throw new Error(error instanceof Error ? error.message : 'Error al actualizar proyección');
  }
}

// ============================================
// ELIMINAR PROYECCIÓN
// ============================================

export async function deleteProjection(id: string) {
  await checkPermission('commercial.treasury.projections', 'delete', { redirect: true });
  const { userId } = await auth();
  if (!userId) throw new Error('No autenticado');

  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    const existing = await prisma.cashflowProjection.findFirst({
      where: { id, companyId },
    });

    if (!existing) throw new Error('Proyección no encontrada');

    await prisma.cashflowProjection.delete({ where: { id } });

    revalidatePath('/dashboard/commercial/treasury/projections');
    return { success: true };
  } catch (error) {
    logger.error('Error al eliminar proyección', { data: { error, companyId, id } });
    throw new Error(error instanceof Error ? error.message : 'Error al eliminar proyección');
  }
}

// ============================================
// TOTALES PARA KPIs
// ============================================

export async function getProjectionsTotals() {
  await checkPermission('commercial.treasury.projections', 'view', { redirect: true });
  const { userId } = await auth();
  if (!userId) throw new Error('No autenticado');

  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    const [incomeAgg, expenseAgg] = await Promise.all([
      prisma.cashflowProjection.aggregate({
        where: { companyId, type: 'INCOME' },
        _sum: { amount: true },
      }),
      prisma.cashflowProjection.aggregate({
        where: { companyId, type: 'EXPENSE' },
        _sum: { amount: true },
      }),
    ]);

    const totalIncome = Number(incomeAgg._sum.amount ?? 0);
    const totalExpense = Number(expenseAgg._sum.amount ?? 0);

    return {
      totalIncome,
      totalExpense,
      netBalance: totalIncome - totalExpense,
    };
  } catch (error) {
    logger.error('Error al obtener totales de proyecciones', { data: { error, companyId } });
    throw new Error('Error al obtener totales de proyecciones');
  }
}

// ============================================
// VINCULACIÓN CON DOCUMENTOS
// ============================================

export async function linkDocumentToProjection(data: LinkDocumentFormData) {
  await checkPermission('commercial.treasury.projections', 'update', { redirect: true });
  const { userId } = await auth();
  if (!userId) throw new Error('No autenticado');

  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    const projection = await prisma.cashflowProjection.findFirst({
      where: { id: data.projectionId, companyId },
    });

    if (!projection) throw new Error('Proyección no encontrada');
    if (projection.status === 'CONFIRMED') throw new Error('La proyección ya está completamente confirmada');

    const linkAmount = parseFloat(data.amount);
    const remaining = Number(projection.amount) - Number(projection.confirmedAmount);

    if (linkAmount > remaining + 0.01) {
      throw new Error(`El monto excede el saldo disponible de la proyección ($${remaining.toFixed(2)})`);
    }

    // Validar tipo compatible
    if (projection.type === 'INCOME' && !data.salesInvoiceId) {
      throw new Error('Las proyecciones de ingreso solo se pueden vincular a facturas de venta');
    }
    if (projection.type === 'EXPENSE' && !data.purchaseInvoiceId && !data.expenseId) {
      throw new Error('Las proyecciones de egreso solo se pueden vincular a facturas de compra o gastos');
    }

    const newConfirmedAmount = Number(projection.confirmedAmount) + linkAmount;
    const newStatus =
      newConfirmedAmount >= Number(projection.amount) ? 'CONFIRMED' : newConfirmedAmount > 0 ? 'PARTIAL' : 'PENDING';

    await prisma.$transaction(async (tx) => {
      await tx.projectionDocumentLink.create({
        data: {
          companyId,
          projectionId: data.projectionId,
          amount: linkAmount,
          salesInvoiceId: data.salesInvoiceId || null,
          purchaseInvoiceId: data.purchaseInvoiceId || null,
          expenseId: data.expenseId || null,
          notes: data.notes || null,
          createdBy: userId,
        },
      });

      await tx.cashflowProjection.update({
        where: { id: data.projectionId },
        data: {
          confirmedAmount: newConfirmedAmount,
          status: newStatus,
        },
      });
    });

    revalidatePath('/dashboard/commercial/treasury/projections');
    revalidatePath('/dashboard/commercial/treasury/cashflow');
    return { success: true };
  } catch (error) {
    logger.error('Error al vincular documento a proyección', { data: { error, companyId } });
    throw new Error(error instanceof Error ? error.message : 'Error al vincular documento');
  }
}

export async function unlinkDocumentFromProjection(linkId: string) {
  await checkPermission('commercial.treasury.projections', 'update', { redirect: true });
  const { userId } = await auth();
  if (!userId) throw new Error('No autenticado');

  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    const link = await prisma.projectionDocumentLink.findFirst({
      where: { id: linkId, companyId },
      include: { projection: true },
    });

    if (!link) throw new Error('Vínculo no encontrado');

    const newConfirmedAmount = Number(link.projection.confirmedAmount) - Number(link.amount);
    const newStatus =
      newConfirmedAmount >= Number(link.projection.amount)
        ? 'CONFIRMED'
        : newConfirmedAmount > 0
          ? 'PARTIAL'
          : 'PENDING';

    await prisma.$transaction(async (tx) => {
      await tx.projectionDocumentLink.delete({ where: { id: linkId } });

      await tx.cashflowProjection.update({
        where: { id: link.projectionId },
        data: {
          confirmedAmount: Math.max(0, newConfirmedAmount),
          status: newStatus,
        },
      });
    });

    revalidatePath('/dashboard/commercial/treasury/projections');
    revalidatePath('/dashboard/commercial/treasury/cashflow');
    return { success: true };
  } catch (error) {
    logger.error('Error al desvincular documento', { data: { error, companyId, linkId } });
    throw new Error(error instanceof Error ? error.message : 'Error al desvincular documento');
  }
}

export async function getProjectionLinks(projectionId: string): Promise<ProjectionDocumentLinkItem[]> {
  await checkPermission('commercial.treasury.projections', 'view', { redirect: true });
  const { userId } = await auth();
  if (!userId) throw new Error('No autenticado');

  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    const links = await prisma.projectionDocumentLink.findMany({
      where: { projectionId, companyId },
      select: {
        id: true,
        amount: true,
        notes: true,
        createdAt: true,
        salesInvoiceId: true,
        purchaseInvoiceId: true,
        expenseId: true,
        salesInvoice: {
          select: { fullNumber: true, total: true, issueDate: true, customer: { select: { name: true } } },
        },
        purchaseInvoice: {
          select: {
            fullNumber: true,
            total: true,
            issueDate: true,
            supplier: { select: { businessName: true } },
          },
        },
        expense: {
          select: { fullNumber: true, amount: true, date: true, supplier: { select: { businessName: true } } },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return links.map((link) => {
      if (link.salesInvoice) {
        return {
          id: link.id,
          amount: Number(link.amount),
          notes: link.notes,
          createdAt: link.createdAt,
          documentType: 'SALES_INVOICE' as const,
          documentFullNumber: link.salesInvoice.fullNumber,
          documentTotal: Number(link.salesInvoice.total),
          documentDate: link.salesInvoice.issueDate,
          documentEntityName: link.salesInvoice.customer?.name || null,
        };
      }
      if (link.purchaseInvoice) {
        return {
          id: link.id,
          amount: Number(link.amount),
          notes: link.notes,
          createdAt: link.createdAt,
          documentType: 'PURCHASE_INVOICE' as const,
          documentFullNumber: link.purchaseInvoice.fullNumber,
          documentTotal: Number(link.purchaseInvoice.total),
          documentDate: link.purchaseInvoice.issueDate,
          documentEntityName: link.purchaseInvoice.supplier?.businessName || null,
        };
      }
      // Expense
      return {
        id: link.id,
        amount: Number(link.amount),
        notes: link.notes,
        createdAt: link.createdAt,
        documentType: 'EXPENSE' as const,
        documentFullNumber: link.expense!.fullNumber,
        documentTotal: Number(link.expense!.amount),
        documentDate: link.expense!.date,
        documentEntityName: link.expense!.supplier?.businessName || null,
      };
    });
  } catch (error) {
    logger.error('Error al obtener vínculos de proyección', { data: { error, companyId, projectionId } });
    throw new Error('Error al obtener vínculos');
  }
}

export async function searchDocumentsForLinking(
  projectionId: string,
  search: string
): Promise<DocumentForLinking[]> {
  await checkPermission('commercial.treasury.projections', 'view', { redirect: true });
  const { userId } = await auth();
  if (!userId) throw new Error('No autenticado');

  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    const projection = await prisma.cashflowProjection.findFirst({
      where: { id: projectionId, companyId },
      select: { type: true },
    });

    if (!projection) throw new Error('Proyección no encontrada');

    const results: DocumentForLinking[] = [];

    if (projection.type === 'INCOME') {
      const invoices = await prisma.salesInvoice.findMany({
        where: {
          companyId,
          status: { in: ['CONFIRMED', 'PARTIAL_PAID'] },
          ...(search
            ? {
                OR: [
                  { fullNumber: { contains: search, mode: 'insensitive' as const } },
                  { customer: { name: { contains: search, mode: 'insensitive' as const } } },
                ],
              }
            : {}),
        },
        select: {
          id: true,
          fullNumber: true,
          total: true,
          issueDate: true,
          customer: { select: { name: true } },
        },
        take: 20,
        orderBy: { issueDate: 'desc' },
      });

      results.push(
        ...invoices.map((inv) => ({
          id: inv.id,
          fullNumber: inv.fullNumber,
          total: Number(inv.total),
          date: inv.issueDate,
          entityName: inv.customer?.name || null,
          documentType: 'SALES_INVOICE' as const,
        }))
      );
    } else {
      // EXPENSE projection → search purchase invoices and expenses
      const [purchaseInvoices, expenses] = await Promise.all([
        prisma.purchaseInvoice.findMany({
          where: {
            companyId,
            status: { in: ['CONFIRMED', 'PARTIAL_PAID'] },
            ...(search
              ? {
                  OR: [
                    { fullNumber: { contains: search, mode: 'insensitive' as const } },
                    { supplier: { businessName: { contains: search, mode: 'insensitive' as const } } },
                  ],
                }
              : {}),
          },
          select: {
            id: true,
            fullNumber: true,
            total: true,
            issueDate: true,
            supplier: { select: { businessName: true } },
          },
          take: 15,
          orderBy: { issueDate: 'desc' },
        }),
        prisma.expense.findMany({
          where: {
            companyId,
            status: { in: ['CONFIRMED', 'PARTIAL_PAID'] },
            ...(search
              ? {
                  OR: [
                    { fullNumber: { contains: search, mode: 'insensitive' as const } },
                    { description: { contains: search, mode: 'insensitive' as const } },
                  ],
                }
              : {}),
          },
          select: {
            id: true,
            fullNumber: true,
            amount: true,
            date: true,
            supplier: { select: { businessName: true } },
          },
          take: 15,
          orderBy: { date: 'desc' },
        }),
      ]);

      results.push(
        ...purchaseInvoices.map((inv) => ({
          id: inv.id,
          fullNumber: inv.fullNumber,
          total: Number(inv.total),
          date: inv.issueDate,
          entityName: inv.supplier?.businessName || null,
          documentType: 'PURCHASE_INVOICE' as const,
        })),
        ...expenses.map((exp) => ({
          id: exp.id,
          fullNumber: exp.fullNumber,
          total: Number(exp.amount),
          date: exp.date,
          entityName: exp.supplier?.businessName || null,
          documentType: 'EXPENSE' as const,
        }))
      );
    }

    return results;
  } catch (error) {
    logger.error('Error al buscar documentos para vincular', { data: { error, companyId } });
    throw new Error('Error al buscar documentos');
  }
}

export async function searchProjectionsForLinking(
  documentType: 'SALES_INVOICE' | 'PURCHASE_INVOICE' | 'EXPENSE',
  search: string
): Promise<ProjectionForLinking[]> {
  await checkPermission('commercial.treasury.projections', 'view', { redirect: true });
  const { userId } = await auth();
  if (!userId) throw new Error('No autenticado');

  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    const projectionType = documentType === 'SALES_INVOICE' ? 'INCOME' : 'EXPENSE';

    const projections = await prisma.cashflowProjection.findMany({
      where: {
        companyId,
        type: projectionType,
        status: { in: ['PENDING', 'PARTIAL'] },
        ...(search
          ? { description: { contains: search, mode: 'insensitive' as const } }
          : {}),
      },
      select: {
        id: true,
        type: true,
        category: true,
        description: true,
        amount: true,
        confirmedAmount: true,
        date: true,
      },
      take: 20,
      orderBy: { date: 'asc' },
    });

    return projections.map((p) => ({
      id: p.id,
      type: p.type,
      category: p.category,
      description: p.description,
      amount: Number(p.amount),
      confirmedAmount: Number(p.confirmedAmount),
      remainingAmount: Number(p.amount) - Number(p.confirmedAmount),
      date: p.date,
    }));
  } catch (error) {
    logger.error('Error al buscar proyecciones para vincular', { data: { error, companyId } });
    throw new Error('Error al buscar proyecciones');
  }
}

// ============================================
// HELPERS PARA CASHFLOW DASHBOARD
// ============================================

export async function getProjectionsInRange(startDate: Date, endDate: Date) {
  await checkPermission('commercial.treasury.projections', 'view', { redirect: true });
  const { userId } = await auth();
  if (!userId) throw new Error('No autenticado');

  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    const projections = await prisma.cashflowProjection.findMany({
      where: {
        companyId,
        date: { gte: startDate, lte: endDate },
      },
      select: {
        id: true,
        type: true,
        category: true,
        description: true,
        amount: true,
        date: true,
        isRecurring: true,
      },
    });

    return projections.map((p) => ({
      ...p,
      amount: Number(p.amount),
    }));
  } catch (error) {
    logger.error('Error al obtener proyecciones para cashflow', { data: { error, companyId } });
    throw new Error('Error al obtener proyecciones para cashflow');
  }
}
