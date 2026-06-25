'use server';

import { getCurrentUserId } from '@/shared/lib/current-user';
import { prisma } from '@/shared/lib/prisma';
import { logger } from '@/shared/lib/logger';
import { getActiveCompanyId } from '@/shared/lib/company';
import { revalidatePath } from 'next/cache';
import type { DataTableSearchParams } from '@/shared/components/common/DataTable';
import {
  buildSearchWhere,
  buildFiltersWhere,
  buildDateRangeFiltersWhere,
  buildTextFiltersWhere,
  parseSearchParams,
  stateToPrismaParams,
} from '@/shared/components/common/DataTable/helpers';
import type { Prisma } from '@/generated/prisma/client';
import type { PurchaseInvoiceFormInput } from '../shared/validators';
import type { VoucherType } from '@/generated/prisma/enums';
import { checkPermission } from '@/shared/lib/permissions';
import { createJournalEntryForPurchaseInvoice } from '@/modules/accounting/features/integrations/commercial';
import { isCreditNote, isDebitNote } from '@/modules/commercial/shared/voucher-utils';
import { applyPurchaseCreditNote } from '@/modules/commercial/shared/credit-note-compensation';

// ============================================
// QUERIES
// ============================================

/**
 * Obtiene facturas de compra con paginación server-side para DataTable
 */
export async function getPurchaseInvoicesPaginated(searchParams: DataTableSearchParams) {
  await checkPermission('commercial.purchases', 'view', { redirect: true });
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('No autenticado');

  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    const state = parseSearchParams(searchParams);
    const { skip, take, orderBy: prismaOrderBy } = stateToPrismaParams(state);

    const searchWhere = buildSearchWhere(state.search, [
      'fullNumber',
      'notes',
    ]);

    const filtersWhere = buildFiltersWhere(state.filters, {
      status: 'status',
      voucherType: 'voucherType',
    }, { exclude: ['issueDate', 'fullNumber', 'supplier'] });

    const dateFiltersWhere = buildDateRangeFiltersWhere(state.filters, ['issueDate']);
    const textFiltersWhere = buildTextFiltersWhere(state.filters, ['fullNumber']);

    // Filtro de texto para proveedor (relación anidada)
    const supplierNameFilter = state.filters['supplier'];
    const supplierWhere = supplierNameFilter?.[0]
      ? { supplier: { OR: [
          { businessName: { contains: supplierNameFilter[0], mode: 'insensitive' as const } },
          { tradeName: { contains: supplierNameFilter[0], mode: 'insensitive' as const } },
        ] } }
      : {};

    const where: Prisma.PurchaseInvoiceWhereInput = {
      companyId,
      ...searchWhere,
      ...filtersWhere,
      ...dateFiltersWhere,
      ...textFiltersWhere,
      ...supplierWhere,
    };

    // Manejar ordenamiento por relación supplier
    const sortByField = state.sortBy;
    let orderBy: Prisma.PurchaseInvoiceOrderByWithRelationInput | Prisma.PurchaseInvoiceOrderByWithRelationInput[];
    if (sortByField === 'supplier') {
      orderBy = { supplier: { businessName: state.sortOrder } };
    } else if (prismaOrderBy && Object.keys(prismaOrderBy).length > 0) {
      orderBy = prismaOrderBy;
    } else {
      orderBy = [{ issueDate: 'desc' }, { number: 'desc' }];
    }

    const [invoices, total] = await Promise.all([
      prisma.purchaseInvoice.findMany({
        where,
        skip,
        take,
        orderBy,
        include: {
          supplier: {
            select: {
              businessName: true,
              tradeName: true,
              taxId: true,
            },
          },
          lines: {
            include: {
              product: {
                select: {
                  code: true,
                  name: true,
                  trackStock: true,
                },
              },
            },
          },
          receivingNotes: {
            where: { status: 'CONFIRMED' },
            select: {
              lines: {
                select: {
                  productId: true,
                  quantity: true,
                },
              },
            },
          },
        },
      }),
      prisma.purchaseInvoice.count({ where }),
    ]);

    // Convertir Decimals a Numbers para Client Components
    const data = invoices.map((invoice) => {
      const isConfirmed = invoice.status === 'CONFIRMED';
      const isRegularInvoice =
        !isCreditNote(invoice.voucherType) && !isDebitNote(invoice.voucherType);

      // Calcular estado de recepción: null | 'pending' | 'partial' | 'complete'
      let receptionStatus: 'pending' | 'partial' | 'complete' | null = null;

      if (isConfirmed && isRegularInvoice) {
        // Solo líneas con productos que controlan stock
        const stockLines = invoice.lines.filter((l) => l.product?.trackStock && l.productId);

        if (stockLines.length > 0) {
          // Sumar cantidades recibidas por producto desde remitos confirmados
          const receivedByProduct = new Map<string, number>();
          for (const rn of invoice.receivingNotes) {
            for (const rnLine of rn.lines) {
              const current = receivedByProduct.get(rnLine.productId) ?? 0;
              receivedByProduct.set(rnLine.productId, current + Number(rnLine.quantity));
            }
          }

          // Comparar cada línea de factura con lo recibido
          let allFullyReceived = true;
          let anyReceived = false;

          for (const line of stockLines) {
            const invoicedQty = Number(line.quantity);
            const receivedQty = receivedByProduct.get(line.productId!) ?? 0;

            if (receivedQty >= invoicedQty) {
              anyReceived = true;
            } else if (receivedQty > 0) {
              anyReceived = true;
              allFullyReceived = false;
            } else {
              allFullyReceived = false;
            }
          }

          if (allFullyReceived && anyReceived) {
            receptionStatus = 'complete';
          } else if (anyReceived) {
            receptionStatus = 'partial';
          } else {
            receptionStatus = 'pending';
          }
        }
      }

      return {
        ...invoice,
        subtotal: Number(invoice.subtotal),
        vatAmount: Number(invoice.vatAmount),
        otherTaxes: Number(invoice.otherTaxes),
        total: Number(invoice.total),
        receptionStatus,
        lines: invoice.lines.map((line) => ({
          ...line,
          quantity: Number(line.quantity),
          unitCost: Number(line.unitCost),
          vatRate: Number(line.vatRate),
          vatAmount: Number(line.vatAmount),
          subtotal: Number(line.subtotal),
          total: Number(line.total),
        })),
      };
    });

    return { data, total };
  } catch (error) {
    logger.error('Error al obtener facturas de compra', {
      data: {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        companyId
      },
    });
    // Re-throw the original error to see the details
    if (error instanceof Error) {
      throw error;
    }
    throw new Error('Error al obtener facturas de compra');
  }
}

/**
 * Obtiene conteos globales para filtros facetados (server-side)
 */
export async function getPurchaseInvoiceFacetCounts() {
  await checkPermission('commercial.purchases', 'view', { redirect: true });
  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  const [statusCounts, voucherTypeCounts] = await Promise.all([
    prisma.purchaseInvoice.groupBy({
      by: ['status'],
      where: { companyId },
      _count: { status: true },
    }),
    prisma.purchaseInvoice.groupBy({
      by: ['voucherType'],
      where: { companyId },
      _count: { voucherType: true },
    }),
  ]);

  return {
    status: Object.fromEntries(statusCounts.map((s) => [s.status, s._count.status])),
    voucherType: Object.fromEntries(voucherTypeCounts.map((v) => [v.voucherType, v._count.voucherType])),
  };
}

/**
 * Obtiene una factura de compra por ID con todos sus detalles
 */
export async function getPurchaseInvoiceById(id: string) {
  await checkPermission('commercial.purchases', 'view', { redirect: true });
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('No autenticado');

  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    const invoice = await prisma.purchaseInvoice.findUnique({
      where: { id },
      include: {
        supplier: true,
        lines: {
          include: {
            product: {
              select: {
                id: true,
                code: true,
                name: true,
                unitOfMeasure: true,
                trackStock: true,
              },
            },
          },
        },
        company: {
          select: {
            name: true,
            taxId: true,
          },
        },
        // Documentos vinculados
        creditDebitNotes: {
          select: {
            id: true,
            fullNumber: true,
            voucherType: true,
            total: true,
            status: true,
            issueDate: true,
          },
          orderBy: { issueDate: 'desc' },
        },
        originalInvoice: {
          select: {
            id: true,
            fullNumber: true,
            voucherType: true,
          },
        },
        paymentOrderItems: {
          select: {
            amount: true,
            paymentOrder: {
              select: {
                id: true,
                fullNumber: true,
                date: true,
                status: true,
                totalAmount: true,
              },
            },
          },
        },
        creditNoteApplicationsReceived: {
          select: {
            amount: true,
            appliedAt: true,
            creditNote: {
              select: {
                id: true,
                fullNumber: true,
                voucherType: true,
                total: true,
              },
            },
          },
        },
        creditNoteApplicationsGiven: {
          select: {
            amount: true,
            appliedAt: true,
            invoice: {
              select: {
                id: true,
                fullNumber: true,
                voucherType: true,
                total: true,
              },
            },
          },
        },
        purchaseOrder: {
          select: {
            id: true,
            fullNumber: true,
            status: true,
            invoicingStatus: true,
          },
        },
        receivingNotes: {
          orderBy: { receptionDate: 'desc' },
          select: {
            id: true,
            fullNumber: true,
            receptionDate: true,
            status: true,
            warehouse: {
              select: { name: true },
            },
            lines: {
              select: {
                productId: true,
                quantity: true,
              },
            },
          },
        },
      },
    });

    if (!invoice) {
      throw new Error('Factura de compra no encontrada');
    }

    if (invoice.companyId !== companyId) {
      throw new Error('No tienes permiso para ver esta factura');
    }

    // Calcular estado de recepción: null | 'pending' | 'partial' | 'complete'
    const isRegularInvoice =
      !isCreditNote(invoice.voucherType) && !isDebitNote(invoice.voucherType);
    let receptionStatus: 'pending' | 'partial' | 'complete' | null = null;

    if (invoice.status === 'CONFIRMED' && isRegularInvoice) {
      const stockLines = invoice.lines.filter((l) => l.product?.trackStock && l.productId);

      if (stockLines.length > 0) {
        const confirmedRNs = invoice.receivingNotes.filter((rn) => rn.status === 'CONFIRMED');
        const receivedByProduct = new Map<string, number>();
        for (const rn of confirmedRNs) {
          for (const rnLine of rn.lines) {
            const current = receivedByProduct.get(rnLine.productId) ?? 0;
            receivedByProduct.set(rnLine.productId, current + Number(rnLine.quantity));
          }
        }

        let allFullyReceived = true;
        let anyReceived = false;

        for (const line of stockLines) {
          const invoicedQty = Number(line.quantity);
          const receivedQty = receivedByProduct.get(line.productId!) ?? 0;

          if (receivedQty >= invoicedQty) {
            anyReceived = true;
          } else if (receivedQty > 0) {
            anyReceived = true;
            allFullyReceived = false;
          } else {
            allFullyReceived = false;
          }
        }

        if (allFullyReceived && anyReceived) {
          receptionStatus = 'complete';
        } else if (anyReceived) {
          receptionStatus = 'partial';
        } else {
          receptionStatus = 'pending';
        }
      }
    }

    // Convertir Decimals a Numbers para Client Components
    return {
      ...invoice,
      subtotal: Number(invoice.subtotal),
      vatAmount: Number(invoice.vatAmount),
      otherTaxes: Number(invoice.otherTaxes),
      total: Number(invoice.total),
      receptionStatus,
      lines: invoice.lines.map((line) => ({
        ...line,
        quantity: Number(line.quantity),
        unitCost: Number(line.unitCost),
        vatRate: Number(line.vatRate),
        vatAmount: Number(line.vatAmount),
        subtotal: Number(line.subtotal),
        total: Number(line.total),
      })),
      creditDebitNotes: invoice.creditDebitNotes.map((cn) => ({
        ...cn,
        total: Number(cn.total),
      })),
      paymentOrderItems: invoice.paymentOrderItems.map((item) => ({
        amount: Number(item.amount),
        paymentOrder: {
          ...item.paymentOrder,
          totalAmount: Number(item.paymentOrder.totalAmount),
        },
      })),
      creditNoteApplicationsReceived: invoice.creditNoteApplicationsReceived.map((app) => ({
        amount: Number(app.amount),
        appliedAt: app.appliedAt,
        creditNote: {
          ...app.creditNote,
          total: Number(app.creditNote.total),
        },
      })),
      creditNoteApplicationsGiven: invoice.creditNoteApplicationsGiven.map((app) => ({
        amount: Number(app.amount),
        appliedAt: app.appliedAt,
        invoice: {
          ...app.invoice,
          total: Number(app.invoice.total),
        },
      })),
      receivingNotes: invoice.receivingNotes.map((rn) => ({
        ...rn,
        lines: rn.lines.map((rnLine) => ({
          ...rnLine,
          quantity: Number(rnLine.quantity),
        })),
      })),
    };
  } catch (error) {
    logger.error('Error al obtener factura de compra', {
      data: { error, id, companyId },
    });
    throw error;
  }
}

/**
 * Obtiene proveedores para select (solo activos)
 */
export async function getSuppliersForSelect() {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('No autenticado');

  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    return await prisma.supplier.findMany({
      where: {
        companyId,
        status: 'ACTIVE',
      },
      select: {
        id: true,
        code: true,
        businessName: true,
        tradeName: true,
        taxId: true,
        taxCondition: true,
      },
      orderBy: { businessName: 'asc' },
    });
  } catch (error) {
    logger.error('Error al obtener proveedores', {
      data: { error, companyId },
    });
    throw new Error('Error al obtener proveedores');
  }
}

/**
 * Obtiene productos para select (solo activos)
 */
export async function getProductsForSelect() {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('No autenticado');

  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    const products = await prisma.product.findMany({
      where: {
        companyId,
        status: 'ACTIVE',
        usage: { in: ['PURCHASE', 'PURCHASE_SALE'] },
      },
      select: {
        id: true,
        code: true,
        name: true,
        description: true,
        unitOfMeasure: true,
        costPrice: true,
        vatRate: true,
        trackStock: true,
        productSuppliers: {
          select: { supplierId: true, supplierCode: true, supplierPrice: true },
        },
      },
      orderBy: { name: 'asc' },
    });

    return products.map((p) => ({
      ...p,
      costPrice: Number(p.costPrice),
      vatRate: Number(p.vatRate),
      supplierIds: p.productSuppliers.map((ps) => ps.supplierId),
      productSuppliers: p.productSuppliers.map((ps) => ({
        supplierId: ps.supplierId,
        supplierCode: ps.supplierCode,
        supplierPrice: ps.supplierPrice ? Number(ps.supplierPrice) : null,
      })),
    }));
  } catch (error) {
    logger.error('Error al obtener productos', {
      data: { error, companyId },
    });
    throw new Error('Error al obtener productos');
  }
}

/**
 * Obtiene todas las facturas de compra (sin paginación) para exportación a Excel
 */
export async function getAllPurchaseInvoicesForExport(searchParams: DataTableSearchParams) {
  await checkPermission('commercial.purchases', 'view', { redirect: true });
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('No autenticado');

  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    const state = parseSearchParams(searchParams);

    const searchWhere = buildSearchWhere(state.search, [
      'fullNumber',
      'notes',
    ]);

    const filtersWhere = buildFiltersWhere(state.filters, {
      status: 'status',
      voucherType: 'voucherType',
    }, { exclude: ['issueDate', 'fullNumber', 'supplier'] });

    const dateFiltersWhere = buildDateRangeFiltersWhere(state.filters, ['issueDate']);
    const textFiltersWhere = buildTextFiltersWhere(state.filters, ['fullNumber']);

    // Filtro de texto para proveedor (relación anidada)
    const supplierNameFilter = state.filters['supplier'];
    const supplierWhere = supplierNameFilter?.[0]
      ? { supplier: { OR: [
          { businessName: { contains: supplierNameFilter[0], mode: 'insensitive' as const } },
          { tradeName: { contains: supplierNameFilter[0], mode: 'insensitive' as const } },
        ] } }
      : {};

    const where: Prisma.PurchaseInvoiceWhereInput = {
      companyId,
      ...searchWhere,
      ...filtersWhere,
      ...dateFiltersWhere,
      ...textFiltersWhere,
      ...supplierWhere,
    };

    const invoices = await prisma.purchaseInvoice.findMany({
      where,
      take: 5000,
      orderBy: [{ issueDate: 'desc' }, { number: 'desc' }],
      select: {
        id: true,
        fullNumber: true,
        voucherType: true,
        issueDate: true,
        dueDate: true,
        subtotal: true,
        vatAmount: true,
        otherTaxes: true,
        total: true,
        status: true,
        notes: true,
        cae: true,
        supplier: {
          select: {
            businessName: true,
            tradeName: true,
            taxId: true,
          },
        },
      },
    });

    return invoices.map((inv) => ({
      ...inv,
      supplier: inv.supplier.tradeName || inv.supplier.businessName,
      supplierTaxId: inv.supplier.taxId,
      subtotal: Number(inv.subtotal),
      vatAmount: Number(inv.vatAmount),
      otherTaxes: Number(inv.otherTaxes),
      total: Number(inv.total),
    }));
  } catch (error) {
    logger.error('Error al exportar facturas de compra', {
      data: {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        companyId,
      },
    });
    throw new Error('Error al exportar facturas de compra');
  }
}

// ============================================
// MUTATIONS
// ============================================

/**
 * Obtener facturas de un proveedor para select de factura original (NC/ND)
 */
export async function getSupplierInvoicesForSelect(supplierId: string) {
  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  const invoices = await prisma.purchaseInvoice.findMany({
    where: {
      companyId,
      supplierId,
      status: { in: ['CONFIRMED', 'PAID', 'PARTIAL_PAID'] },
      voucherType: {
        notIn: [
          'NOTA_CREDITO_A', 'NOTA_CREDITO_B', 'NOTA_CREDITO_C',
          'NOTA_DEBITO_A', 'NOTA_DEBITO_B', 'NOTA_DEBITO_C',
        ],
      },
    },
    select: {
      id: true,
      fullNumber: true,
      issueDate: true,
      total: true,
      voucherType: true,
    },
    orderBy: { issueDate: 'desc' },
    take: 50,
  });

  return invoices.map((inv) => ({
    id: inv.id,
    fullNumber: inv.fullNumber,
    issueDate: inv.issueDate,
    total: Number(inv.total),
    voucherType: inv.voucherType,
  }));
}

/**
 * Obtiene OCs aprobadas de un proveedor para vincular a factura de compra
 */
export async function getApprovedPurchaseOrdersForInvoicing(supplierId: string) {
  await checkPermission('commercial.purchases', 'view', { redirect: true });
  const companyId = await getActiveCompanyId();
  if (!companyId) return [];

  try {
    const orders = await prisma.purchaseOrder.findMany({
      where: {
        companyId,
        supplierId,
        status: { in: ['APPROVED', 'PARTIALLY_RECEIVED', 'COMPLETED'] },
        invoicingStatus: { not: 'FULLY_INVOICED' },
      },
      select: {
        id: true,
        fullNumber: true,
        issueDate: true,
        total: true,
        invoicingStatus: true,
      },
      orderBy: { issueDate: 'desc' },
    });

    return orders.map((o) => ({ ...o, total: Number(o.total) }));
  } catch (error) {
    logger.error('Error al obtener OCs para facturación', {
      data: { error: error instanceof Error ? error.message : String(error), supplierId },
    });
    return [];
  }
}

/**
 * Obtiene líneas de una OC con cantidades pendientes de facturar
 */
export async function getPurchaseOrderLinesForInvoicing(orderId: string) {
  await checkPermission('commercial.purchases', 'view', { redirect: true });
  const companyId = await getActiveCompanyId();
  if (!companyId) return [];

  try {
    const lines = await prisma.purchaseOrderLine.findMany({
      where: {
        orderId,
        order: { companyId },
      },
      include: {
        product: {
          select: {
            id: true,
            code: true,
            name: true,
            unitOfMeasure: true,
          },
        },
      },
      orderBy: { id: 'asc' },
    });

    return lines
      .map((line) => {
        const qty = Number(line.quantity);
        const invoiced = Number(line.invoicedQty);
        const pendingQty = Math.max(0, qty - invoiced);

        return {
          id: line.id,
          productId: line.productId,
          description: line.description,
          quantity: qty,
          invoicedQty: invoiced,
          pendingQty,
          unitCost: Number(line.unitCost),
          vatRate: Number(line.vatRate),
          product: line.product,
        };
      })
      .filter((line) => line.pendingQty > 0);
  } catch (error) {
    logger.error('Error al obtener líneas de OC para facturación', {
      data: { error: error instanceof Error ? error.message : String(error), orderId },
    });
    return [];
  }
}

/**
 * Crea una nueva factura de compra en estado DRAFT
 */
export async function createPurchaseInvoice(input: PurchaseInvoiceFormInput) {
  await checkPermission('commercial.purchases', 'create', { redirect: true });
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('No autenticado');

  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    // Calcular totales
    let subtotal = 0;
    let vatAmount = 0;

    const linesData = input.lines.map((line) => {
      const qty = parseFloat(line.quantity);
      const cost = parseFloat(line.unitCost);
      const vat = parseFloat(line.vatRate);

      const lineSubtotal = qty * cost;
      const lineVat = lineSubtotal * (vat / 100);
      const lineTotal = lineSubtotal + lineVat;

      subtotal += lineSubtotal;
      vatAmount += lineVat;

      return {
        productId: line.productId || null,
        description: line.description,
        quantity: qty,
        unitCost: cost,
        vatRate: vat,
        vatAmount: lineVat,
        subtotal: lineSubtotal,
        total: lineTotal,
        purchaseOrderLineId: line.purchaseOrderLineId || null,
      };
    });

    const total = subtotal + vatAmount;

    // Verificar que no exista factura duplicada
    const fullNumber = `${input.pointOfSale}-${input.number}`;
    const existing = await prisma.purchaseInvoice.findFirst({
      where: {
        companyId,
        supplierId: input.supplierId,
        fullNumber,
      },
    });

    if (existing) {
      throw new Error(
        `Ya existe una factura de este proveedor con el número ${fullNumber}`
      );
    }

    // Crear factura
    const invoice = await prisma.purchaseInvoice.create({
      data: {
        companyId,
        supplierId: input.supplierId,
        voucherType: input.voucherType as VoucherType,
        pointOfSale: input.pointOfSale,
        number: input.number,
        fullNumber,
        issueDate: input.issueDate,
        dueDate: input.dueDate || null,
        cae: input.cae || null,
        originalInvoiceId: input.originalInvoiceId || null,
        purchaseOrderId: input.purchaseOrderId || null,
        validated: false,
        subtotal,
        netTaxed: subtotal,
        netNonTaxed: 0,
        netExempt: 0,
        vatAmount,
        otherTaxes: 0,
        total,
        notes: input.notes || null,
        status: 'DRAFT',
        createdBy: userId,
        lines: {
          create: linesData,
        },
      },
      include: {
        supplier: true,
        lines: {
          include: {
            product: true,
          },
        },
      },
    });

    logger.info('Factura de compra creada', {
      data: {
        invoiceId: invoice.id,
        fullNumber: invoice.fullNumber,
        supplierId: input.supplierId,
        total,
        companyId,
        userId,
      },
    });

    revalidatePath('/dashboard/commercial/purchases');
    return { success: true, id: invoice.id };
  } catch (error) {
    logger.error('Error al crear factura de compra', {
      data: { error, input, companyId, userId },
    });
    throw error;
  }
}

/**
 * Actualiza una factura de compra (solo si está en estado DRAFT)
 */
export async function updatePurchaseInvoice(id: string, input: PurchaseInvoiceFormInput) {
  await checkPermission('commercial.purchases', 'update', { redirect: true });
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('No autenticado');

  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    // Verificar que la factura existe
    const existingInvoice = await prisma.purchaseInvoice.findUnique({
      where: { id },
      include: {
        lines: true,
      },
    });

    if (!existingInvoice) {
      throw new Error('Factura de compra no encontrada');
    }

    if (existingInvoice.companyId !== companyId) {
      throw new Error('No tienes permiso para editar esta factura');
    }

    // VALIDACIÓN CRÍTICA: Solo permitir edición si está en estado DRAFT
    if (existingInvoice.status !== 'DRAFT') {
      throw new Error(
        'No se puede editar una factura confirmada. Solo se pueden editar facturas en estado borrador.'
      );
    }

    // Calcular totales
    let subtotal = 0;
    let vatAmount = 0;

    const linesData = input.lines.map((line) => {
      const qty = parseFloat(line.quantity);
      const cost = parseFloat(line.unitCost);
      const vat = parseFloat(line.vatRate);

      const lineSubtotal = qty * cost;
      const lineVat = lineSubtotal * (vat / 100);
      const lineTotal = lineSubtotal + lineVat;

      subtotal += lineSubtotal;
      vatAmount += lineVat;

      return {
        productId: line.productId || null,
        description: line.description,
        quantity: qty,
        unitCost: cost,
        vatRate: vat,
        vatAmount: lineVat,
        subtotal: lineSubtotal,
        total: lineTotal,
        purchaseOrderLineId: line.purchaseOrderLineId || null,
      };
    });

    const total = subtotal + vatAmount;

    // Verificar que no exista otra factura con el mismo número
    const fullNumber = `${input.pointOfSale}-${input.number}`;
    const duplicate = await prisma.purchaseInvoice.findFirst({
      where: {
        companyId,
        supplierId: input.supplierId,
        fullNumber,
        id: { not: id }, // Excluir la factura actual
      },
    });

    if (duplicate) {
      throw new Error(
        `Ya existe otra factura de este proveedor con el número ${fullNumber}`
      );
    }

    // Actualizar factura y líneas en transacción
    const invoice = await prisma.$transaction(async (tx) => {
      // Eliminar líneas existentes
      await tx.purchaseInvoiceLine.deleteMany({
        where: { invoiceId: id },
      });

      // Actualizar factura con nuevas líneas
      return await tx.purchaseInvoice.update({
        where: { id },
        data: {
          supplierId: input.supplierId,
          voucherType: input.voucherType as VoucherType,
          pointOfSale: input.pointOfSale,
          number: input.number,
          fullNumber,
          issueDate: input.issueDate,
          dueDate: input.dueDate || null,
          cae: input.cae || null,
          purchaseOrderId: input.purchaseOrderId || null,
          subtotal,
          netTaxed: subtotal,
          netNonTaxed: 0,
          netExempt: 0,
          vatAmount,
          otherTaxes: 0,
          total,
          notes: input.notes || null,
          lines: {
            create: linesData,
          },
        },
        include: {
          supplier: true,
          lines: {
            include: {
              product: true,
            },
          },
        },
      });
    });

    logger.info('Factura de compra actualizada', {
      data: {
        invoiceId: id,
        fullNumber: invoice.fullNumber,
        supplierId: input.supplierId,
        total,
        companyId,
        userId,
      },
    });

    revalidatePath('/dashboard/commercial/purchases');
    revalidatePath(`/dashboard/commercial/purchases/${id}`);
    return { success: true, id: invoice.id };
  } catch (error) {
    logger.error('Error al actualizar factura de compra', {
      data: { error, id, input, companyId, userId },
    });
    throw error;
  }
}

/**
 * Confirma una factura de compra y actualiza el stock
 */
export async function confirmPurchaseInvoice(id: string) {
  await checkPermission('commercial.purchases', 'approve', { redirect: true });
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('No autenticado');

  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    const invoice = await prisma.purchaseInvoice.findUnique({
      where: { id },
      include: {
        lines: {
          include: {
            product: true,
          },
        },
      },
    });

    if (!invoice) {
      throw new Error('Factura de compra no encontrada');
    }

    if (invoice.companyId !== companyId) {
      throw new Error('No tienes permiso para confirmar esta factura');
    }

    if (invoice.status !== 'DRAFT') {
      throw new Error('Solo se pueden confirmar facturas en estado borrador');
    }

    // Confirmar factura en transacción
    // NOTA: Las FC normales NO generan ingreso de stock. El stock solo ingresa vía Remitos de Recepción.
    // Las NC de compra SÍ decrementan stock (devoluciones al proveedor).
    const isND = isDebitNote(invoice.voucherType);
    const isNC = isCreditNote(invoice.voucherType);

    // Almacén principal solo necesario para NC (decremento de stock por devolución)
    let mainWarehouse: { id: string } | null = null;
    if (isNC) {
      mainWarehouse = await prisma.warehouse.findFirst({
        where: {
          companyId,
          type: 'MAIN',
          isActive: true,
        },
        select: { id: true },
      });

      if (!mainWarehouse) {
        throw new Error(
          'No se encontró un almacén principal activo. Configura uno antes de confirmar notas de crédito.'
        );
      }
    }

    const result = await prisma.$transaction(async (tx) => {
      // Actualizar estado de la factura
      const updatedInvoice = await tx.purchaseInvoice.update({
        where: { id },
        data: {
          status: 'CONFIRMED',
        },
        include: {
          supplier: true,
          lines: {
            include: {
              product: true,
            },
          },
        },
      });

      // NC de compra: devolvemos al proveedor → decrementar stock
      if (isNC && mainWarehouse) {
        for (const line of invoice.lines) {
          if (!line.productId || !line.product) continue;
          if (!line.product.trackStock) continue;

          const quantity = Number(line.quantity);

          await tx.warehouseStock.upsert({
            where: {
              warehouseId_productId: {
                warehouseId: mainWarehouse.id,
                productId: line.productId,
              },
            },
            create: {
              warehouseId: mainWarehouse.id,
              productId: line.productId,
              quantity: -quantity,
              reservedQty: 0,
              availableQty: -quantity,
            },
            update: {
              quantity: {
                decrement: quantity,
              },
              availableQty: {
                decrement: quantity,
              },
            },
          });

          await tx.stockMovement.create({
            data: {
              companyId,
              warehouseId: mainWarehouse.id,
              productId: line.productId,
              type: 'RETURN',
              quantity,
              referenceType: 'purchase_invoice',
              referenceId: invoice.id,
              notes: `NC Compra ${invoice.fullNumber} - ${line.product.name}`,
              date: invoice.issueDate,
              createdBy: userId,
            },
          });
        }
      }

      // Incrementar invoicedQty en líneas de OC vinculadas (solo facturas regulares)
      if (invoice.purchaseOrderId && !isND && !isNC) {
        for (const line of invoice.lines) {
          if (line.purchaseOrderLineId) {
            await tx.purchaseOrderLine.update({
              where: { id: line.purchaseOrderLineId },
              data: {
                invoicedQty: { increment: line.quantity },
              },
            });
          }
        }
        await updatePurchaseOrderInvoicingStatus(tx, invoice.purchaseOrderId);
      }

      // Crear asiento contable automáticamente
      try {
        const journalEntryId = await createJournalEntryForPurchaseInvoice(id, companyId, tx);

        if (journalEntryId) {
          // Actualizar factura con referencia al asiento contable
          await tx.purchaseInvoice.update({
            where: { id },
            data: { journalEntryId },
          });

          logger.info('Asiento contable generado para factura de compra', {
            data: { invoiceId: id, journalEntryId },
          });
        }
      } catch (error) {
        // Re-lanzar errores de período bloqueado (el usuario debe saberlo)
        if (error instanceof Error && error.message.includes('período está cerrado')) {
          throw error;
        }
        logger.warn('No se pudo generar asiento contable para factura de compra', {
          data: { invoiceId: id, error },
        });
      }

      // Auto-compensar NC contra facturas/ND pendientes del mismo proveedor
      if (isCreditNote(updatedInvoice.voucherType)) {
        await applyPurchaseCreditNote(tx, {
          id: updatedInvoice.id,
          total: updatedInvoice.total,
          supplierId: updatedInvoice.supplierId,
          originalInvoiceId: updatedInvoice.originalInvoiceId,
        }, companyId);
      }

      return updatedInvoice;
    });

    logger.info('Factura de compra confirmada', {
      data: {
        invoiceId: id,
        fullNumber: invoice.fullNumber,
        companyId,
        userId,
      },
    });

    revalidatePath('/dashboard/commercial/purchases');
    revalidatePath(`/dashboard/commercial/purchases/${id}`);
    revalidatePath('/dashboard/commercial/stock');
    if (invoice.purchaseOrderId) {
      revalidatePath(`/dashboard/commercial/purchase-orders/${invoice.purchaseOrderId}`);
    }

    // Determinar si la FC necesita un remito de recepción
    const hasTrackStockProducts = invoice.lines.some(
      (l) => l.product?.trackStock
    );
    let needsReceivingNote = false;
    if (hasTrackStockProducts && !isND && !isNC) {
      const confirmedRNCount = await prisma.receivingNote.count({
        where: { purchaseInvoiceId: id, status: 'CONFIRMED' },
      });
      needsReceivingNote = confirmedRNCount === 0;
    }

    return {
      success: true,
      id: result.id,
      needsReceivingNote,
      supplierId: invoice.supplierId,
    };
  } catch (error) {
    logger.error('Error al confirmar factura de compra', {
      data: { error, id, companyId, userId },
    });
    throw error;
  }
}

/**
 * Cancela una factura de compra.
 * Solo revierte stock si es una NC (nota de crédito) que había decrementado stock.
 * Las FC normales no generan stock, por lo que no hay nada que revertir.
 */
export async function cancelPurchaseInvoice(id: string) {
  await checkPermission('commercial.purchases', 'delete', { redirect: true });
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('No autenticado');

  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    const invoice = await prisma.purchaseInvoice.findUnique({
      where: { id },
      include: {
        lines: {
          include: {
            product: true,
          },
        },
      },
    });

    if (!invoice) {
      throw new Error('Factura de compra no encontrada');
    }

    if (invoice.companyId !== companyId) {
      throw new Error('No tienes permiso para cancelar esta factura');
    }

    if (invoice.status === 'CANCELLED') {
      throw new Error('La factura ya está cancelada');
    }

    if (invoice.status === 'PAID' || invoice.status === 'PARTIAL_PAID') {
      throw new Error('No se puede cancelar una factura pagada o parcialmente pagada');
    }

    // Solo las NC afectan stock (devoluciones), las FC normales no
    const isNC = isCreditNote(invoice.voucherType);

    // Obtener almacén principal solo si es NC (necesitamos revertir stock)
    let mainWarehouse: { id: string } | null = null;
    if (isNC) {
      mainWarehouse = await prisma.warehouse.findFirst({
        where: {
          companyId,
          type: 'MAIN',
          isActive: true,
        },
        select: { id: true },
      });
    }

    // Cancelar factura y revertir stock si era NC confirmada
    const result = await prisma.$transaction(async (tx) => {
      // Si era NC confirmada, revertir el decremento de stock (devolver stock)
      if (invoice.status === 'CONFIRMED' && isNC && mainWarehouse) {
        for (const line of invoice.lines) {
          if (!line.productId || !line.product || !line.product.trackStock) {
            continue;
          }

          const quantity = Number(line.quantity);

          // Incrementar stock (revertir la devolución)
          await tx.warehouseStock.upsert({
            where: {
              warehouseId_productId: {
                warehouseId: mainWarehouse.id,
                productId: line.productId,
              },
            },
            create: {
              warehouseId: mainWarehouse.id,
              productId: line.productId,
              quantity,
              reservedQty: 0,
              availableQty: quantity,
            },
            update: {
              quantity: {
                increment: quantity,
              },
              availableQty: {
                increment: quantity,
              },
            },
          });

          // Registrar movimiento de reversión
          await tx.stockMovement.create({
            data: {
              companyId,
              warehouseId: mainWarehouse.id,
              productId: line.productId,
              type: 'ADJUSTMENT',
              quantity,
              referenceType: 'purchase_invoice_cancel',
              referenceId: invoice.id,
              notes: `Cancelación NC Compra ${invoice.fullNumber} - ${line.product.name}`,
              date: new Date(),
              createdBy: userId,
            },
          });
        }
      }

      // Decrementar invoicedQty en líneas de OC vinculadas
      if (invoice.purchaseOrderId && invoice.status === 'CONFIRMED') {
        for (const line of invoice.lines) {
          if (line.purchaseOrderLineId) {
            await tx.purchaseOrderLine.update({
              where: { id: line.purchaseOrderLineId },
              data: {
                invoicedQty: { decrement: line.quantity },
              },
            });
          }
        }
        await updatePurchaseOrderInvoicingStatus(tx, invoice.purchaseOrderId);
      }

      // Actualizar estado de la factura
      return await tx.purchaseInvoice.update({
        where: { id },
        data: {
          status: 'CANCELLED',
        },
        include: {
          supplier: true,
          lines: {
            include: {
              product: true,
            },
          },
        },
      });
    });

    logger.info('Factura de compra cancelada', {
      data: {
        invoiceId: id,
        fullNumber: invoice.fullNumber,
        wasConfirmed: invoice.status === 'CONFIRMED',
        companyId,
        userId,
      },
    });

    revalidatePath('/dashboard/commercial/purchases');
    revalidatePath(`/dashboard/commercial/purchases/${id}`);
    revalidatePath('/dashboard/commercial/stock');
    if (invoice.purchaseOrderId) {
      revalidatePath(`/dashboard/commercial/purchase-orders/${invoice.purchaseOrderId}`);
    }
    return { success: true, id: result.id };
  } catch (error) {
    logger.error('Error al cancelar factura de compra', {
      data: { error, id, companyId, userId },
    });
    throw error;
  }
}

// ============================================
// HELPERS
// ============================================

/**
 * Recalcula el estado de facturación de una OC basado en las cantidades facturadas
 */
async function updatePurchaseOrderInvoicingStatus(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  purchaseOrderId: string
) {
  const poLines = await tx.purchaseOrderLine.findMany({
    where: { orderId: purchaseOrderId },
    select: { quantity: true, invoicedQty: true },
  });

  const allFullyInvoiced = poLines.every(
    (line) => Number(line.invoicedQty) >= Number(line.quantity)
  );
  const anyPartiallyInvoiced = poLines.some(
    (line) => Number(line.invoicedQty) > 0
  );

  let newStatus: 'NOT_INVOICED' | 'PARTIALLY_INVOICED' | 'FULLY_INVOICED';
  if (allFullyInvoiced) {
    newStatus = 'FULLY_INVOICED';
  } else if (anyPartiallyInvoiced) {
    newStatus = 'PARTIALLY_INVOICED';
  } else {
    newStatus = 'NOT_INVOICED';
  }

  await tx.purchaseOrder.update({
    where: { id: purchaseOrderId },
    data: { invoicingStatus: newStatus },
  });
}

// ============================================
// TIPOS INFERIDOS
// ============================================

export type PurchaseInvoiceListItem = Awaited<
  ReturnType<typeof getPurchaseInvoicesPaginated>
>['data'][number];
export type PurchaseInvoiceDetail = Awaited<ReturnType<typeof getPurchaseInvoiceById>>;
export type SupplierSelectItem = Awaited<ReturnType<typeof getSuppliersForSelect>>[number];
export type ProductSelectItem = Awaited<ReturnType<typeof getProductsForSelect>>[number];
