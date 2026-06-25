'use server';

import { getCurrentUserId } from '@/shared/lib/current-user';
import { prisma } from '@/shared/lib/prisma';
import { logger } from '@/shared/lib/logger';
import { getActiveCompanyId } from '@/shared/lib/company';
import { checkPermission } from '@/shared/lib/permissions';
import { createInvoiceSchema } from '../shared/validators';
import { revalidatePath } from 'next/cache';
import { Prisma } from '@/generated/prisma/client';
import type { DataTableSearchParams } from '@/shared/components/common/DataTable';
import { buildFiltersWhere, buildDateRangeFiltersWhere, buildTextFiltersWhere, parseSearchParams, stateToPrismaParams } from '@/shared/components/common/DataTable/helpers';
import {
  validateVoucherType,
  mapTaxStatusToCustomerTaxCondition,
} from '../shared/afip-validation';
import { createJournalEntryForSalesInvoice } from '@/modules/accounting/features/integrations/commercial';
import { isCreditNote, isDebitNote } from '@/modules/commercial/shared/voucher-utils';
import { applySalesCreditNote } from '@/modules/commercial/shared/credit-note-compensation';

// Obtener todas las facturas de venta
export async function getInvoices() {
  await checkPermission('commercial.invoices', 'view', { redirect: true });
  const authUserId = await getCurrentUserId();
  if (!authUserId) throw new Error('No autenticado');
  const userId = authUserId;

  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    const invoices = await prisma.salesInvoice.findMany({
      where: {
        companyId: companyId,
      },
      orderBy: [{ issueDate: 'desc' }, { number: 'desc' }],
      select: {
        id: true,
        voucherType: true,
        number: true,
        fullNumber: true,
        issueDate: true,
        dueDate: true,
        subtotal: true,
        vatAmount: true,
        total: true,
        status: true,
        customer: {
          select: {
            id: true,
            name: true,
            taxId: true,
          },
        },
        pointOfSale: {
          select: {
            id: true,
            number: true,
            name: true,
          },
        },
        cae: true,
        caeExpiryDate: true,
        documentUrl: true,
        documentKey: true,
        companyId: true,
        company: { select: { name: true } },
        createdAt: true,
        updatedAt: true,
      },
    });

    // Convertir Decimals a Numbers para Client Components
    return invoices.map((invoice) => ({
      ...invoice,
      subtotal: Number(invoice.subtotal),
      vatAmount: Number(invoice.vatAmount),
      total: Number(invoice.total),
    }));
  } catch (error) {
    logger.error('Error al obtener facturas', {
      data: { companyId, error },
    });
    throw new Error('Error al obtener las facturas');
  }
}

// Obtener facturas de venta con paginación server-side para DataTable
export async function getInvoicesPaginated(searchParams: DataTableSearchParams) {
  await checkPermission('commercial.invoices', 'view', { redirect: true });
  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    const parsed = parseSearchParams(searchParams);
    const { page, pageSize, search, sortBy, sortOrder } = parsed;
    const { skip, take, orderBy: prismaOrderBy } = stateToPrismaParams(parsed);

    const filtersWhere = buildFiltersWhere(parsed.filters, {
      status: 'status',
      voucherType: 'voucherType',
    }, { exclude: ['issueDate', 'fullNumber', 'customer_name'] });

    const dateFiltersWhere = buildDateRangeFiltersWhere(parsed.filters, ['issueDate']);
    const textFiltersWhere = buildTextFiltersWhere(parsed.filters, ['fullNumber']);

    // Filtro de texto para cliente (relación anidada)
    const customerNameFilter = parsed.filters['customer_name'];
    const customerWhere = customerNameFilter?.[0]
      ? { customer: { name: { contains: customerNameFilter[0], mode: 'insensitive' as const } } }
      : {};

    const where: Prisma.SalesInvoiceWhereInput = {
      companyId,
      ...filtersWhere,
      ...dateFiltersWhere,
      ...textFiltersWhere,
      ...customerWhere,
    };

    const orderBy = prismaOrderBy && Object.keys(prismaOrderBy).length > 0
      ? prismaOrderBy
      : [{ issueDate: 'desc' as const }, { number: 'desc' as const }];

    const [data, total] = await Promise.all([
      prisma.salesInvoice.findMany({
        where,
        select: {
          id: true,
          voucherType: true,
          number: true,
          fullNumber: true,
          issueDate: true,
          dueDate: true,
          subtotal: true,
          vatAmount: true,
          total: true,
          status: true,
          customer: {
            select: {
              id: true,
              name: true,
              taxId: true,
            },
          },
          pointOfSale: {
            select: {
              id: true,
              number: true,
              name: true,
            },
          },
          cae: true,
          caeExpiryDate: true,
          documentUrl: true,
          documentKey: true,
          companyId: true,
          company: { select: { name: true } },
          createdAt: true,
          updatedAt: true,
        },
        orderBy,
        skip,
        take,
      }),
      prisma.salesInvoice.count({ where }),
    ]);

    return {
      data: data.map((invoice) => ({
        ...invoice,
        subtotal: Number(invoice.subtotal),
        vatAmount: Number(invoice.vatAmount),
        total: Number(invoice.total),
      })),
      total,
    };
  } catch (error) {
    logger.error('Error al obtener facturas paginadas', { data: { error } });
    throw error;
  }
}

// Obtener conteos globales para filtros facetados (server-side)
export async function getInvoiceFacetCounts() {
  await checkPermission('commercial.invoices', 'view', { redirect: true });
  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  const [statusCounts, voucherTypeCounts] = await Promise.all([
    prisma.salesInvoice.groupBy({
      by: ['status'],
      where: { companyId },
      _count: { status: true },
    }),
    prisma.salesInvoice.groupBy({
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

// Obtener una factura por ID
export async function getInvoiceById(id: string) {
  await checkPermission('commercial.invoices', 'view', { redirect: true });
  const authUserId = await getCurrentUserId();
  if (!authUserId) throw new Error('No autenticado');
  const userId = authUserId;

  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    const invoice = await prisma.salesInvoice.findFirst({
      where: {
        id: id,
        companyId: companyId,
      },
      include: {
        customer: {
          select: {
            id: true,
            name: true,
            taxId: true,
            email: true,
            phone: true,
            address: true,
          },
        },
        pointOfSale: {
          select: {
            id: true,
            number: true,
            name: true,
            afipEnabled: true,
          },
        },
        lines: {
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
        },
        journalEntry: {
          select: {
            id: true,
            number: true,
            status: true,
          },
        },
        company: {
          select: {
            name: true,
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
        receiptItems: {
          select: {
            amount: true,
            receipt: {
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
      },
    });

    if (!invoice) {
      throw new Error('Factura no encontrada');
    }

    // Convertir Decimals a Numbers para Client Components
    return {
      ...invoice,
      subtotal: Number(invoice.subtotal),
      vatAmount: Number(invoice.vatAmount),
      otherTaxes: Number(invoice.otherTaxes),
      total: Number(invoice.total),
      globalDiscountPercent: invoice.globalDiscountPercent ? Number(invoice.globalDiscountPercent) : null,
      globalDiscountAmount: invoice.globalDiscountAmount ? Number(invoice.globalDiscountAmount) : null,
      totalBeforeDiscount: Number(invoice.totalBeforeDiscount),
      discountTotal: Number(invoice.discountTotal),
      lines: invoice.lines.map((line) => ({
        ...line,
        quantity: Number(line.quantity),
        unitPrice: Number(line.unitPrice),
        vatRate: Number(line.vatRate),
        vatAmount: Number(line.vatAmount),
        subtotal: Number(line.subtotal),
        total: Number(line.total),
        discountPercent: line.discountPercent ? Number(line.discountPercent) : null,
        discountAmount: line.discountAmount ? Number(line.discountAmount) : null,
      })),
      creditDebitNotes: invoice.creditDebitNotes.map((cn) => ({
        ...cn,
        total: Number(cn.total),
      })),
      receiptItems: invoice.receiptItems.map((item) => ({
        amount: Number(item.amount),
        receipt: {
          ...item.receipt,
          totalAmount: Number(item.receipt.totalAmount),
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
    };
  } catch (error) {
    logger.error('Error al obtener factura', {
      data: { id, companyId, error },
    });
    throw new Error('Error al obtener la factura');
  }
}

// Obtener próximo número de factura
export async function getNextInvoiceNumber(
  pointOfSaleId: string,
  voucherType: string
): Promise<number> {
  await checkPermission('commercial.invoices', 'view', { redirect: true });
  const authUserId = await getCurrentUserId();
  if (!authUserId) throw new Error('No autenticado');

  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    // Obtener el último número usado para este punto de venta y tipo de comprobante
    const lastInvoice = await prisma.salesInvoice.findFirst({
      where: {
        companyId: companyId,
        pointOfSaleId: pointOfSaleId,
        voucherType: voucherType as any,
      },
      orderBy: {
        number: 'desc',
      },
      select: {
        number: true,
      },
    });

    return lastInvoice ? lastInvoice.number + 1 : 1;
  } catch (error) {
    logger.error('Error al obtener próximo número de factura', {
      data: { pointOfSaleId, voucherType, companyId, error },
    });
    throw new Error('Error al obtener el próximo número');
  }
}

// Calcular totales de una línea
function calculateLineAmounts(
  quantity: number,
  unitPrice: number,
  vatRate: number,
  discountPercent: number | null,
  discountAmount: number | null,
): {
  baseAmount: number;
  discountValue: number;
  subtotal: number;
  vatAmount: number;
  total: number;
} {
  const baseAmount = quantity * unitPrice;

  let discountValue = 0;
  if (discountPercent != null && discountPercent > 0) {
    discountValue = baseAmount * (discountPercent / 100);
  } else if (discountAmount != null && discountAmount > 0) {
    discountValue = Math.min(discountAmount, baseAmount);
  }

  const subtotal = baseAmount - discountValue;
  const vatAmount = subtotal * (vatRate / 100);
  const total = subtotal + vatAmount;

  return {
    baseAmount: Math.round(baseAmount * 100) / 100,
    discountValue: Math.round(discountValue * 100) / 100,
    subtotal: Math.round(subtotal * 100) / 100,
    vatAmount: Math.round(vatAmount * 100) / 100,
    total: Math.round(total * 100) / 100,
  };
}

function calculateGlobalDiscount(
  sumLineSubtotals: number,
  globalDiscountPercent: number | null,
  globalDiscountAmount: number | null,
): number {
  if (globalDiscountPercent != null && globalDiscountPercent > 0) {
    return Math.round(sumLineSubtotals * (globalDiscountPercent / 100) * 100) / 100;
  }
  if (globalDiscountAmount != null && globalDiscountAmount > 0) {
    return Math.round(Math.min(globalDiscountAmount, sumLineSubtotals) * 100) / 100;
  }
  return 0;
}

function calculateInvoiceTotalsWithGlobalDiscount(
  linesData: Array<{ subtotal: number; vatRate: number }>,
  globalDiscount: number,
): { invoiceSubtotal: number; invoiceVatAmount: number } {
  const sumLineSubtotals = linesData.reduce((acc, l) => acc + l.subtotal, 0);

  if (globalDiscount <= 0 || sumLineSubtotals <= 0) {
    return {
      invoiceSubtotal: sumLineSubtotals,
      invoiceVatAmount: linesData.reduce(
        (acc, l) => acc + l.subtotal * (l.vatRate / 100),
        0,
      ),
    };
  }

  let invoiceVatAmount = 0;
  for (const line of linesData) {
    const weight = line.subtotal / sumLineSubtotals;
    const lineGlobalDiscount = globalDiscount * weight;
    const discountedBase = line.subtotal - lineGlobalDiscount;
    invoiceVatAmount += discountedBase * (line.vatRate / 100);
  }

  return {
    invoiceSubtotal: Math.round((sumLineSubtotals - globalDiscount) * 100) / 100,
    invoiceVatAmount: Math.round(invoiceVatAmount * 100) / 100,
  };
}

// Obtener facturas de un cliente para select de factura original (NC/ND)
export async function getCustomerInvoicesForSelect(customerId: string) {
  await checkPermission('commercial.invoices', 'view', { redirect: true });
  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  const invoices = await prisma.salesInvoice.findMany({
    where: {
      companyId,
      customerId,
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

// Crear una nueva factura
export async function createInvoice(data: unknown) {
  await checkPermission('commercial.invoices', 'create', { redirect: true });
  const authUserId = await getCurrentUserId();
  if (!authUserId) throw new Error('No autenticado');
  const userId = authUserId;

  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    // Validar datos
    const validatedData = createInvoiceSchema.parse(data);

    // Verificar que el punto de venta existe y pertenece a la empresa
    const pointOfSale = await prisma.salesPointOfSale.findFirst({
      where: {
        id: validatedData.pointOfSaleId,
        companyId: companyId,
        isActive: true,
      },
    });

    if (!pointOfSale) {
      throw new Error('Punto de venta no encontrado o inactivo');
    }

    // Verificar que el cliente existe
    const customer = await prisma.contractor.findFirst({
      where: {
        id: validatedData.customerId,
        companyId: companyId,
      },
      select: {
        id: true,
        name: true,
        taxCondition: true,
      },
    });

    if (!customer) {
      throw new Error('Cliente no encontrado');
    }

    // Obtener condición fiscal de la empresa (emisor)
    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: { taxStatus: true },
    });

    if (!company) {
      throw new Error('Empresa no encontrada');
    }

    // Validar tipo de comprobante según AFIP
    const emisorTaxCondition = mapTaxStatusToCustomerTaxCondition(company.taxStatus);
    const receptorTaxCondition = customer.taxCondition;

    const afipValidation = validateVoucherType(
      emisorTaxCondition,
      receptorTaxCondition,
      validatedData.voucherType as any
    );

    if (!afipValidation.isValid) {
      throw new Error(afipValidation.error);
    }

    // Obtener próximo número
    const nextNumber = await getNextInvoiceNumber(
      validatedData.pointOfSaleId,
      validatedData.voucherType
    );

    // Generar número completo (formato: 0001-00000001)
    const fullNumber = `${pointOfSale.number.toString().padStart(4, '0')}-${nextNumber.toString().padStart(8, '0')}`;

    // Calcular totales
    let totalLineDiscounts = 0;

    const linesData = validatedData.lines.map((line) => {
      const amounts = calculateLineAmounts(
        line.quantity,
        line.unitPrice,
        line.vatRate,
        line.discountPercent,
        line.discountAmount,
      );

      totalLineDiscounts += amounts.discountValue;

      return {
        productId: line.productId,
        description: line.description,
        quantity: new Prisma.Decimal(line.quantity),
        unitPrice: new Prisma.Decimal(line.unitPrice),
        vatRate: new Prisma.Decimal(line.vatRate),
        vatAmount: new Prisma.Decimal(amounts.vatAmount),
        subtotal: new Prisma.Decimal(amounts.subtotal),
        total: new Prisma.Decimal(amounts.total),
        discountPercent: line.discountPercent != null ? new Prisma.Decimal(line.discountPercent) : null,
        discountAmount: line.discountAmount != null ? new Prisma.Decimal(line.discountAmount) : null,
      };
    });

    const sumLineSubtotals = linesData.reduce((acc, l) => acc + Number(l.subtotal), 0);

    const globalDiscount = calculateGlobalDiscount(
      sumLineSubtotals,
      validatedData.globalDiscountPercent,
      validatedData.globalDiscountAmount,
    );

    const { invoiceSubtotal, invoiceVatAmount } = calculateInvoiceTotalsWithGlobalDiscount(
      validatedData.lines.map((line, i) => ({
        subtotal: Number(linesData[i].subtotal),
        vatRate: line.vatRate,
      })),
      globalDiscount,
    );

    const invoiceTotal = invoiceSubtotal + invoiceVatAmount;
    const totalBeforeDiscount = sumLineSubtotals;
    const discountTotal = totalLineDiscounts + globalDiscount;

    // Crear factura en transacción
    const invoice = await prisma.$transaction(async (tx) => {
      // Crear factura
      const newInvoice = await tx.salesInvoice.create({
        data: {
          companyId: companyId,
          customerId: validatedData.customerId,
          pointOfSaleId: validatedData.pointOfSaleId,
          voucherType: validatedData.voucherType as any,
          number: nextNumber,
          fullNumber: fullNumber,
          issueDate: validatedData.issueDate,
          dueDate: validatedData.dueDate,
          subtotal: new Prisma.Decimal(invoiceSubtotal),
          netTaxed: new Prisma.Decimal(invoiceSubtotal),
          netNonTaxed: new Prisma.Decimal(0),
          netExempt: new Prisma.Decimal(0),
          vatAmount: new Prisma.Decimal(invoiceVatAmount),
          otherTaxes: new Prisma.Decimal(0),
          total: new Prisma.Decimal(invoiceTotal),
          globalDiscountPercent: validatedData.globalDiscountPercent != null ? new Prisma.Decimal(validatedData.globalDiscountPercent) : null,
          globalDiscountAmount: validatedData.globalDiscountAmount != null ? new Prisma.Decimal(validatedData.globalDiscountAmount) : null,
          totalBeforeDiscount: new Prisma.Decimal(totalBeforeDiscount),
          discountTotal: new Prisma.Decimal(discountTotal),
          notes: validatedData.notes,
          internalNotes: validatedData.internalNotes,
          originalInvoiceId: validatedData.originalInvoiceId || null,
          status: 'DRAFT',
          createdBy: userId,
          lines: {
            create: linesData,
          },
        },
        include: {
          lines: true,
          customer: true,
          pointOfSale: true,
        },
      });

      return newInvoice;
    });

    logger.info('Factura creada', {
      data: {
        invoiceId: invoice.id,
        fullNumber: invoice.fullNumber,
        total: invoice.total.toString(),
        companyId,
        userId,
      },
    });

    revalidatePath('/dashboard/commercial/invoices');
    return { success: true, id: invoice.id };
  } catch (error) {
    logger.error('Error al crear factura', {
      data: { companyId, error },
    });

    if (error instanceof Error) {
      throw error;
    }

    throw new Error('Error al crear la factura');
  }
}

// Confirmar factura (cambia estado de DRAFT a CONFIRMED y descuenta stock)
export async function confirmInvoice(id: string) {
  await checkPermission('commercial.invoices', 'approve', { redirect: true });
  const authUserId = await getCurrentUserId();
  if (!authUserId) throw new Error('No autenticado');
  const userId = authUserId;

  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    // Verificar que la factura existe y está en borrador
    const invoice = await prisma.salesInvoice.findFirst({
      where: {
        id: id,
        companyId: companyId,
        status: 'DRAFT',
      },
      include: {
        lines: {
          include: {
            product: {
              select: {
                id: true,
                code: true,
                name: true,
                trackStock: true,
              },
            },
          },
        },
      },
    });

    if (!invoice) {
      throw new Error('Factura no encontrada o ya está confirmada');
    }

    // Confirmar y descontar stock en transacción
    const result = await prisma.$transaction(async (tx) => {
      // Actualizar factura
      const updatedInvoice = await tx.salesInvoice.update({
        where: { id: id },
        data: {
          status: 'CONFIRMED',
        },
      });

      // ND no afecta stock (ajuste financiero)
      // NC restaura stock, Factura descuenta stock
      const isND = isDebitNote(invoice.voucherType);
      const isNC = isCreditNote(invoice.voucherType);

      if (!isND) {
        for (const line of invoice.lines) {
          if (line.product.trackStock) {
            // Buscar almacén principal (o el primero disponible)
            const warehouse = await tx.warehouse.findFirst({
              where: {
                companyId: companyId,
                isActive: true,
              },
              orderBy: {
                createdAt: 'asc',
              },
            });

            if (!warehouse) {
              throw new Error('No hay almacenes disponibles para gestionar stock');
            }

            const quantityToHandle = line.quantity;

            if (isNC) {
              // NC de venta: restaurar stock (devuelve productos)
              await tx.warehouseStock.upsert({
                where: {
                  warehouseId_productId: {
                    warehouseId: warehouse.id,
                    productId: line.productId,
                  },
                },
                update: {
                  quantity: { increment: quantityToHandle },
                  availableQty: { increment: quantityToHandle },
                },
                create: {
                  warehouseId: warehouse.id,
                  productId: line.productId,
                  quantity: quantityToHandle,
                  reservedQty: 0,
                  availableQty: quantityToHandle,
                },
              });

              await tx.stockMovement.create({
                data: {
                  companyId: companyId,
                  productId: line.productId,
                  warehouseId: warehouse.id,
                  type: 'RETURN',
                  quantity: quantityToHandle,
                  referenceType: 'sales_invoice',
                  referenceId: invoice.id,
                  notes: `NC Venta ${invoice.fullNumber}`,
                  date: new Date(),
                  createdBy: userId,
                },
              });
            } else {
              // Factura normal: descontar stock
              const warehouseStock = await tx.warehouseStock.findUnique({
                where: {
                  warehouseId_productId: {
                    warehouseId: warehouse.id,
                    productId: line.productId,
                  },
                },
              });

              const currentStock = warehouseStock?.quantity || new Prisma.Decimal(0);

              if (currentStock.lessThan(quantityToHandle)) {
                throw new Error(
                  `Stock insuficiente para ${line.product.name}. Disponible: ${currentStock}, Requerido: ${quantityToHandle}`
                );
              }

              await tx.warehouseStock.upsert({
                where: {
                  warehouseId_productId: {
                    warehouseId: warehouse.id,
                    productId: line.productId,
                  },
                },
                update: {
                  quantity: { decrement: quantityToHandle },
                  availableQty: { decrement: quantityToHandle },
                },
                create: {
                  warehouseId: warehouse.id,
                  productId: line.productId,
                  quantity: new Prisma.Decimal(0).minus(quantityToHandle),
                  reservedQty: 0,
                  availableQty: new Prisma.Decimal(0).minus(quantityToHandle),
                },
              });

              await tx.stockMovement.create({
                data: {
                  companyId: companyId,
                  productId: line.productId,
                  warehouseId: warehouse.id,
                  type: 'SALE',
                  quantity: quantityToHandle,
                  referenceType: 'sales_invoice',
                  referenceId: invoice.id,
                  notes: `Factura ${invoice.fullNumber}`,
                  date: new Date(),
                  createdBy: userId,
                },
              });
            }
          }
        }
      }

      // Crear asiento contable automáticamente
      try {
        const journalEntryId = await createJournalEntryForSalesInvoice(id, companyId, tx);

        if (journalEntryId) {
          // Actualizar factura con referencia al asiento contable
          await tx.salesInvoice.update({
            where: { id: id },
            data: { journalEntryId },
          });

          logger.info('Asiento contable generado para factura de venta', {
            data: { invoiceId: id, journalEntryId },
          });
        }
      } catch (error) {
        // Re-lanzar errores de período bloqueado (el usuario debe saberlo)
        if (error instanceof Error && error.message.includes('período está cerrado')) {
          throw error;
        }
        logger.warn('No se pudo generar asiento contable para factura de venta', {
          data: { invoiceId: id, error },
        });
      }

      // Auto-compensar NC contra facturas/ND pendientes del mismo cliente
      if (isCreditNote(updatedInvoice.voucherType)) {
        await applySalesCreditNote(tx, {
          id: updatedInvoice.id,
          total: updatedInvoice.total,
          customerId: updatedInvoice.customerId,
          originalInvoiceId: updatedInvoice.originalInvoiceId,
        }, companyId);
      }

      return updatedInvoice;
    });

    logger.info('Factura confirmada y stock descontado', {
      data: {
        invoiceId: id,
        fullNumber: invoice.fullNumber,
        companyId,
        userId,
      },
    });

    revalidatePath('/dashboard/commercial/invoices');
    revalidatePath(`/dashboard/commercial/invoices/${id}`);
    revalidatePath('/dashboard/commercial/stock');
    return { success: true, id: result.id };
  } catch (error) {
    logger.error('Error al confirmar factura', {
      data: { id, companyId, error },
    });

    if (error instanceof Error) {
      throw error;
    }

    throw new Error('Error al confirmar la factura');
  }
}

// Obtener tipos de comprobante permitidos según cliente seleccionado
export async function getAllowedVoucherTypesForCustomer(customerId: string) {
  await checkPermission('commercial.invoices', 'view', { redirect: true });
  const authUserId = await getCurrentUserId();
  if (!authUserId) throw new Error('No autenticado');

  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    // Obtener condición fiscal del cliente
    const customer = await prisma.contractor.findFirst({
      where: {
        id: customerId,
        companyId: companyId,
      },
      select: {
        taxCondition: true,
      },
    });

    if (!customer) {
      throw new Error('Cliente no encontrado');
    }

    // Obtener condición fiscal de la empresa
    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: { taxStatus: true },
    });

    if (!company) {
      throw new Error('Empresa no encontrada');
    }

    // Mapear y obtener tipos permitidos
    const emisorTaxCondition = mapTaxStatusToCustomerTaxCondition(company.taxStatus);
    const receptorTaxCondition = customer.taxCondition;

    const { getAllowedVoucherTypes } = await import('../shared/afip-validation');
    const allowedTypes = getAllowedVoucherTypes(emisorTaxCondition, receptorTaxCondition);

    return allowedTypes;
  } catch (error) {
    logger.error('Error al obtener tipos de comprobante permitidos', {
      data: { customerId, companyId, error },
    });
    throw error;
  }
}

// Actualizar factura en borrador
export async function updateInvoice(id: string, data: unknown) {
  await checkPermission('commercial.invoices', 'update', { redirect: true });
  const authUserId = await getCurrentUserId();
  if (!authUserId) throw new Error('No autenticado');
  const userId = authUserId;

  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    const validatedData = createInvoiceSchema.parse(data);

    // Verificar que la factura existe y está en borrador
    const invoice = await prisma.salesInvoice.findFirst({
      where: { id, companyId, status: 'DRAFT' },
    });

    if (!invoice) {
      throw new Error('Factura no encontrada o no está en borrador');
    }

    // Calcular totales
    let totalLineDiscounts = 0;

    const linesData = validatedData.lines.map((line) => {
      const amounts = calculateLineAmounts(
        line.quantity,
        line.unitPrice,
        line.vatRate,
        line.discountPercent,
        line.discountAmount,
      );
      totalLineDiscounts += amounts.discountValue;

      return {
        productId: line.productId,
        description: line.description,
        quantity: new Prisma.Decimal(line.quantity),
        unitPrice: new Prisma.Decimal(line.unitPrice),
        vatRate: new Prisma.Decimal(line.vatRate),
        vatAmount: new Prisma.Decimal(amounts.vatAmount),
        subtotal: new Prisma.Decimal(amounts.subtotal),
        total: new Prisma.Decimal(amounts.total),
        discountPercent: line.discountPercent != null ? new Prisma.Decimal(line.discountPercent) : null,
        discountAmount: line.discountAmount != null ? new Prisma.Decimal(line.discountAmount) : null,
      };
    });

    const sumLineSubtotals = linesData.reduce((acc, l) => acc + Number(l.subtotal), 0);

    const globalDiscount = calculateGlobalDiscount(
      sumLineSubtotals,
      validatedData.globalDiscountPercent,
      validatedData.globalDiscountAmount,
    );

    const { invoiceSubtotal, invoiceVatAmount } = calculateInvoiceTotalsWithGlobalDiscount(
      validatedData.lines.map((line, i) => ({
        subtotal: Number(linesData[i].subtotal),
        vatRate: line.vatRate,
      })),
      globalDiscount,
    );

    const invoiceTotal = invoiceSubtotal + invoiceVatAmount;
    const totalBeforeDiscount = sumLineSubtotals;
    const discountTotal = totalLineDiscounts + globalDiscount;

    const result = await prisma.$transaction(async (tx) => {
      await tx.salesInvoiceLine.deleteMany({ where: { invoiceId: id } });

      return tx.salesInvoice.update({
        where: { id },
        data: {
          customerId: validatedData.customerId,
          voucherType: validatedData.voucherType as any,
          issueDate: validatedData.issueDate,
          dueDate: validatedData.dueDate,
          subtotal: new Prisma.Decimal(invoiceSubtotal),
          netTaxed: new Prisma.Decimal(invoiceSubtotal),
          netNonTaxed: new Prisma.Decimal(0),
          netExempt: new Prisma.Decimal(0),
          vatAmount: new Prisma.Decimal(invoiceVatAmount),
          total: new Prisma.Decimal(invoiceTotal),
          globalDiscountPercent: validatedData.globalDiscountPercent != null ? new Prisma.Decimal(validatedData.globalDiscountPercent) : null,
          globalDiscountAmount: validatedData.globalDiscountAmount != null ? new Prisma.Decimal(validatedData.globalDiscountAmount) : null,
          totalBeforeDiscount: new Prisma.Decimal(totalBeforeDiscount),
          discountTotal: new Prisma.Decimal(discountTotal),
          notes: validatedData.notes,
          internalNotes: validatedData.internalNotes,
          lines: { create: linesData },
        },
        include: { lines: true, customer: true, pointOfSale: true },
      });
    });

    logger.info('Factura actualizada', {
      data: { invoiceId: id, fullNumber: invoice.fullNumber, companyId, userId },
    });

    revalidatePath('/dashboard/commercial/invoices');
    revalidatePath(`/dashboard/commercial/invoices/${id}`);
    return { success: true, id: result.id };
  } catch (error) {
    logger.error('Error al actualizar factura', { data: { id, companyId, error } });
    if (error instanceof Error) throw error;
    throw new Error('Error al actualizar la factura');
  }
}

// Anular factura (con devolución de stock si estaba confirmada)
export async function cancelInvoice(id: string) {
  await checkPermission('commercial.invoices', 'delete', { redirect: true });
  const authUserId = await getCurrentUserId();
  if (!authUserId) throw new Error('No autenticado');
  const userId = authUserId;

  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    const invoice = await prisma.salesInvoice.findFirst({
      where: { id, companyId, status: { not: 'CANCELLED' } },
      include: {
        lines: {
          include: {
            product: {
              select: { id: true, trackStock: true },
            },
          },
        },
      },
    });

    if (!invoice) {
      throw new Error('Factura no encontrada o ya está anulada');
    }

    const wasConfirmed = invoice.status !== 'DRAFT';

    const result = await prisma.$transaction(async (tx) => {
      const updatedInvoice = await tx.salesInvoice.update({
        where: { id },
        data: { status: 'CANCELLED' },
      });

      // Revertir stock si fue confirmada
      if (wasConfirmed) {
        for (const line of invoice.lines) {
          if (line.product.trackStock) {
            const stockMovement = await tx.stockMovement.findFirst({
              where: {
                referenceId: invoice.id,
                referenceType: 'sales_invoice',
                productId: line.productId,
              },
            });

            if (stockMovement) {
              await tx.warehouseStock.upsert({
                where: {
                  warehouseId_productId: {
                    warehouseId: stockMovement.warehouseId,
                    productId: line.productId,
                  },
                },
                update: {
                  quantity: { increment: line.quantity },
                  availableQty: { increment: line.quantity },
                },
                create: {
                  warehouseId: stockMovement.warehouseId,
                  productId: line.productId,
                  quantity: line.quantity,
                  reservedQty: 0,
                  availableQty: line.quantity,
                },
              });

              await tx.stockMovement.create({
                data: {
                  companyId,
                  productId: line.productId,
                  warehouseId: stockMovement.warehouseId,
                  type: 'ADJUSTMENT',
                  quantity: line.quantity,
                  referenceType: 'sales_invoice_cancel',
                  referenceId: invoice.id,
                  notes: `Anulación de factura ${invoice.fullNumber}`,
                  date: new Date(),
                  createdBy: userId,
                },
              });
            }
          }
        }
      }

      return updatedInvoice;
    });

    logger.info('Factura anulada', {
      data: {
        invoiceId: id,
        fullNumber: invoice.fullNumber,
        stockRestored: wasConfirmed,
        companyId,
        userId,
      },
    });

    revalidatePath('/dashboard/commercial/invoices');
    revalidatePath(`/dashboard/commercial/invoices/${id}`);
    revalidatePath('/dashboard/commercial/stock');
    return { success: true, id: result.id };
  } catch (error) {
    logger.error('Error al anular factura', { data: { id, companyId, error } });
    if (error instanceof Error) throw error;
    throw new Error('Error al anular la factura');
  }
}
