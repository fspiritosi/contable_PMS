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
import { purchaseInvoiceFormSchema, type PurchaseInvoiceFormInput } from '../shared/validators';
import type { VoucherType } from '@/generated/prisma/enums';
import { checkPermission } from '@/shared/lib/permissions';
import { BusinessError, toActionResult, type ActionResult } from '@/shared/lib/action-result';
import { isCreditNote, isDebitNote } from '@/modules/commercial/shared/voucher-utils';
import {
  applyPurchaseInvoiceEffectsTx,
  updatePurchaseOrderInvoicingStatus,
  validatePurchaseInvoiceForConfirmation,
} from '@/modules/commercial/shared/effects/purchase-invoice.server';
import { writePurchaseInvoiceDataTx } from '@/modules/commercial/shared/effects/purchase-invoice-data.server';
import { selectConfirmableInvoices, type BulkConfirmFailure } from '../shared/bulk-confirm';
import {
  calculateOtherTaxes,
  parseInternalTaxes,
  toPerceptionRecords,
} from '@/modules/commercial/shared/perceptions';

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
        // Solo líneas con ítems que controlan stock
        const stockLines = invoice.lines.filter((l) => l.product?.trackStock && l.productId);

        if (stockLines.length > 0) {
          // Sumar cantidades recibidas por ítem desde remitos confirmados
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
                // TSK-618: marca de Bien de Uso de la cuenta de egresos del item,
                // para el aviso de adjuntar el comprobante en el detalle.
                defaultExpenseAccount: { select: { isFixedAsset: true } },
              },
            },
            // Reparto por centro de costo de la linea (TSK-583). El nombre del
            // centro lo muestra el detalle de la factura.
            costCenterAllocations: {
              select: {
                costCenterId: true,
                percentage: true,
                costCenter: { select: { id: true, name: true } },
              },
              orderBy: { costCenter: { name: 'asc' } },
            },
          },
        },
        // Percepciones del comprobante (TSK-644)
        perceptions: {
          select: {
            id: true,
            type: true,
            jurisdiction: true,
            rate: true,
            baseAmount: true,
            amount: true,
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
      internalTaxes: Number(invoice.internalTaxes),
      otherTaxes: Number(invoice.otherTaxes),
      total: Number(invoice.total),
      receptionStatus,
      perceptions: invoice.perceptions.map((p) => ({
        ...p,
        rate: Number(p.rate),
        baseAmount: Number(p.baseAmount),
        amount: Number(p.amount),
      })),
      lines: invoice.lines.map((line) => ({
        ...line,
        quantity: Number(line.quantity),
        unitCost: Number(line.unitCost),
        vatRate: Number(line.vatRate),
        vatAmount: Number(line.vatAmount),
        subtotal: Number(line.subtotal),
        total: Number(line.total),
        costCenterAllocations: line.costCenterAllocations.map((a) => ({
          costCenterId: a.costCenterId,
          percentage: Number(a.percentage),
          costCenter: a.costCenter,
        })),
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
 * Obtiene ítems para select (solo activos)
 */
/**
 * Centros de costo activos, para imputar lineas de factura (TSK-583).
 */
export async function getCostCentersForSelect() {
  await checkPermission('commercial.purchases', 'view', { redirect: true });

  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  return prisma.costCenter.findMany({
    where: { companyId, isActive: true },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  });
}

/** Cuenta de compras por defecto de la empresa, con lo que necesita el formulario. */
export interface PurchasesDefaultAccount {
  /** Tipo de la cuenta (`AccountType` de Prisma), o `null` si no hay configuración. */
  type: string | null;
  /** TSK-618: si esa cuenta está marcada como Bien de Uso. */
  isFixedAsset: boolean;
}

/**
 * "Cuenta de compras por defecto" de la empresa (TSK-583, hallazgo de
 * revisión final; ampliada en TSK-618).
 *
 * El formulario decide si una línea admite/exige centro de costo mirando la
 * cuenta del ítem — pero cuando el ítem no tiene una propia (o la línea no
 * tiene ítem), el asiento (`createJournalEntryForPurchaseInvoice`) la imputa
 * a esta cuenta por defecto (TSK-721: si tampoco está configurada, la
 * confirmación se rechaza). Sin este dato en el formulario, un ítem sin
 * cuenta propia nunca mostraba el campo aunque el asiento lo imputara a una
 * cuenta de resultado.
 *
 * TSK-618 suma la marca de Bien de Uso de esa misma cuenta, por el mismo
 * motivo: una línea sin ítem (o con un ítem sin cuenta de egresos) se imputa
 * acá, así que el aviso de adjuntar el comprobante tiene que mirarla también.
 *
 * Reemplaza a `getPurchasesDefaultAccountType`, que devolvía solo el `type`.
 * Los llamadores siguen pasando `defaultAccountType={defaultAccount.type}`, con
 * la misma forma (`string | null`), así que `_LineCostCenterField` no cambia.
 */
export async function getPurchasesDefaultAccount(): Promise<PurchasesDefaultAccount> {
  await checkPermission('commercial.purchases', 'view', { redirect: true });

  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  const settings = await prisma.accountingSettings.findUnique({
    where: { companyId },
    select: { purchasesAccount: { select: { type: true, isFixedAsset: true } } },
  });

  return {
    type: settings?.purchasesAccount?.type ?? null,
    isFixedAsset: settings?.purchasesAccount?.isFixedAsset ?? false,
  };
}

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
        defaultCostCenterId: true,
        // El tipo de la cuenta decide si la linea admite centro de costo (TSK-583);
        // la marca decide si se sugiere adjuntar el comprobante (TSK-618).
        defaultExpenseAccount: { select: { type: true, isFixedAsset: true } },
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
      defaultExpenseAccountType: p.defaultExpenseAccount?.type ?? null,
      // `?? null`, NO `?? false`: un ítem SIN cuenta de egresos tiene que caer
      // en la cuenta por defecto de la empresa, igual que hace
      // `defaultExpenseAccountType`. Con `?? false` volvería el falso negativo
      // que TSK-583 tuvo que corregir (TSK-618).
      defaultExpenseAccountIsFixedAsset: p.defaultExpenseAccount?.isFixedAsset ?? null,
      supplierIds: p.productSuppliers.map((ps) => ps.supplierId),
      productSuppliers: p.productSuppliers.map((ps) => ({
        supplierId: ps.supplierId,
        supplierCode: ps.supplierCode,
        supplierPrice: ps.supplierPrice ? Number(ps.supplierPrice) : null,
      })),
    }));
  } catch (error) {
    logger.error('Error al obtener ítems', {
      data: { error, companyId },
    });
    throw new Error('Error al obtener ítems');
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
export async function createPurchaseInvoice(rawInput: PurchaseInvoiceFormInput) {
  await checkPermission('commercial.purchases', 'create', { redirect: true });
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('No autenticado');

  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    // Ventas ya valida en el servidor con este mismo schema
    // (`createInvoiceSchema.parse`); acá faltaba, y la invariante "el reparto
    // suma 100 o está vacío" vivía solo en el navegador (TSK-583, hallazgo de
    // revisión final).
    const input = purchaseInvoiceFormSchema.parse(rawInput);

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
        costCenterAllocations: {
          create: (line.costCenterAllocations ?? []).map((a) => ({
            costCenterId: a.costCenterId,
            percentage: a.percentage,
          })),
        },
      };
    });

    // Percepciones e impuestos internos (TSK-644). `otherTaxes` es el agregado
    // que AFIP llama "Otros Tributos" e incluye las percepciones; el desglose
    // queda en la tabla de percepciones y en `internalTaxes`.
    const perceptionsData = toPerceptionRecords(input.perceptions ?? []);
    const internalTaxes = parseInternalTaxes(input.internalTaxes);
    const otherTaxes = calculateOtherTaxes(perceptionsData, internalTaxes);

    const total = subtotal + vatAmount + otherTaxes;

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
        internalTaxes,
        otherTaxes,
        total,
        notes: input.notes || null,
        status: 'DRAFT',
        createdBy: userId,
        lines: {
          create: linesData,
        },
        perceptions: {
          create: perceptionsData,
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
      data: { error, input: rawInput, companyId, userId },
    });
    throw error;
  }
}

/**
 * Actualiza una factura de compra (solo si está en estado DRAFT)
 */
export async function updatePurchaseInvoice(id: string, rawInput: PurchaseInvoiceFormInput) {
  await checkPermission('commercial.purchases', 'update', { redirect: true });
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('No autenticado');

  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    // Ver nota en createPurchaseInvoice: sin esto, la invariante del reparto
    // vivía solo en el navegador (TSK-583, hallazgo de revisión final).
    const input = purchaseInvoiceFormSchema.parse(rawInput);

    await prisma.$transaction(async (tx) => {
      const existingInvoice = await tx.purchaseInvoice.findUnique({
        where: { id },
        select: { companyId: true, status: true },
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

      // Totales, número sin repetir, líneas y percepciones (TSK-792)
      await writePurchaseInvoiceDataTx(tx, companyId, id, input);
    });

    logger.info('Factura de compra actualizada', {
      data: {
        invoiceId: id,
        fullNumber: `${input.pointOfSale}-${input.number}`,
        supplierId: input.supplierId,
        companyId,
        userId,
      },
    });

    revalidatePath('/dashboard/commercial/purchases');
    revalidatePath(`/dashboard/commercial/purchases/${id}`);
    return { success: true, id };
  } catch (error) {
    logger.error('Error al actualizar factura de compra', {
      data: { error, id, input: rawInput, companyId, userId },
    });
    throw error;
  }
}

/** Lo que devuelve `confirmPurchaseInvoice` cuando la factura queda confirmada. */
export interface ConfirmPurchaseInvoiceData {
  id: string;
  /** FC con ítems de stock y sin remito de recepción confirmado: la UI ofrece crearlo. */
  needsReceivingNote: boolean;
  supplierId: string;
}

/**
 * Confirma una factura de compra y actualiza el stock.
 *
 * Devuelve `{ success, error }` en vez de lanzar (TSK-721): en producción
 * Next redacta el mensaje de un `Error` lanzado desde un Server Action, y los
 * motivos de rechazo (línea sin cuenta, cuenta no imputable, tributo sin
 * cuenta, período cerrado, factura ya confirmada) tienen que llegar al usuario
 * tal cual. Cualquier fallo que no sea `BusinessError` se loguea y se
 * devuelve como mensaje genérico.
 */
export async function confirmPurchaseInvoice(
  id: string
): Promise<ActionResult<ConfirmPurchaseInvoiceData>> {
  await checkPermission('commercial.purchases', 'approve', { redirect: true });
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('No autenticado');

  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    const invoice = await prisma.purchaseInvoice.findUnique({
      where: { id },
      select: {
        companyId: true,
        status: true,
        fullNumber: true,
        supplierId: true,
        purchaseOrderId: true,
        voucherType: true,
        lines: { select: { product: { select: { trackStock: true } } } },
      },
    });

    if (!invoice) {
      throw new BusinessError('Factura de compra no encontrada');
    }

    if (invoice.companyId !== companyId) {
      throw new BusinessError('No tienes permiso para confirmar esta factura');
    }

    if (invoice.status !== 'DRAFT') {
      throw new BusinessError('Solo se pueden confirmar facturas en estado borrador');
    }

    // Cuentas de línea y de tributos, centros de costo y almacén principal (NC):
    // ANTES de la transacción, para que el motivo llegue al usuario (TSK-583/644/721).
    await validatePurchaseInvoiceForConfirmation(id, companyId);

    // NOTA: Las FC normales NO generan ingreso de stock. El stock solo ingresa vía Remitos de Recepción.
    // Las NC de compra SÍ decrementan stock (devoluciones al proveedor).
    await prisma.$transaction(async (tx) => {
      await tx.purchaseInvoice.update({
        where: { id },
        data: { status: 'CONFIRMED' },
      });

      // Efectos: stock de NC, facturación de la OC, asiento y compensación de NC (TSK-792)
      await applyPurchaseInvoiceEffectsTx(tx, { companyId, userId }, id);
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
    const isND = isDebitNote(invoice.voucherType);
    const isNC = isCreditNote(invoice.voucherType);
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
      id,
      needsReceivingNote,
      supplierId: invoice.supplierId,
    };
  } catch (error) {
    if (error instanceof BusinessError) {
      logger.warn('Confirmación de factura de compra rechazada', {
        data: { id, companyId, userId, motivo: error.message },
      });
    }
    return toActionResult(error, 'Error al confirmar factura de compra');
  }
}

/**
 * Confirma varias facturas de compra en un solo paso (TSK-583).
 *
 * Va de a una y en serie, no en paralelo: cada confirmacion abre su propia
 * transaccion y las notas de credito ademas mueven stock, asi que lanzarlas
 * juntas invitaria a bloqueos entre si.
 *
 * El lote es best-effort. Una factura que falla no cancela las demas: se
 * registra el motivo y se sigue, para que un solo comprobante mal cargado no
 * obligue a rehacer todo el trabajo.
 */
export async function bulkConfirmPurchaseInvoices(ids: string[]) {
  await checkPermission('commercial.purchases', 'approve', { redirect: true });

  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  const invoices = await prisma.purchaseInvoice.findMany({
    where: { id: { in: ids }, companyId },
    select: { id: true, fullNumber: true, status: true },
  });

  const confirmables = selectConfirmableInvoices(invoices);
  const failures: BulkConfirmFailure[] = [];
  let confirmedCount = 0;

  for (const invoice of confirmables) {
    // `confirmPurchaseInvoice` ya traduce cada fallo a `{ success, error }`
    // (TSK-721): el motivo legible viene por ahí, no por una excepción.
    const result = await confirmPurchaseInvoice(invoice.id);
    if (result.success) {
      confirmedCount += 1;
    } else {
      failures.push({ fullNumber: invoice.fullNumber, message: result.error });
    }
  }

  logger.info('Confirmacion masiva de facturas de compra', {
    data: {
      companyId,
      solicitadas: ids.length,
      confirmables: confirmables.length,
      confirmadas: confirmedCount,
      fallidas: failures.length,
    },
  });

  revalidatePath('/dashboard/commercial/purchases');

  return {
    confirmedCount,
    failures,
    /** Seleccionadas que no estaban en borrador y por eso ni se intentaron. */
    skippedCount: invoices.length - confirmables.length,
  };
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
// TIPOS INFERIDOS
// ============================================

export type PurchaseInvoiceListItem = Awaited<
  ReturnType<typeof getPurchaseInvoicesPaginated>
>['data'][number];
export type PurchaseInvoiceDetail = Awaited<ReturnType<typeof getPurchaseInvoiceById>>;
export type SupplierSelectItem = Awaited<ReturnType<typeof getSuppliersForSelect>>[number];
export type ProductSelectItem = Awaited<ReturnType<typeof getProductsForSelect>>[number];
export type CostCenterSelectItem = Awaited<ReturnType<typeof getCostCentersForSelect>>[number];
