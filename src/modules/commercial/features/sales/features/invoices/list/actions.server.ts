'use server';

import { getCurrentUserId } from '@/shared/lib/current-user';
import { prisma } from '@/shared/lib/prisma';
import { logger } from '@/shared/lib/logger';
import { getActiveCompanyId } from '@/shared/lib/company';
import { checkPermission } from '@/shared/lib/permissions';
import {
  EFFECTIVE_RECEIPT_ITEM,
  EFFECTIVE_SALES_CREDIT_NOTE_APPLICATION,
} from '@/shared/lib/effective-settlements';
import { BusinessError, toActionResult, type ActionResult } from '@/shared/lib/action-result';
import { createInvoiceSchema } from '../shared/validators';
import { revalidatePath } from 'next/cache';
import type { Prisma } from '@/generated/prisma/client';
import type { DataTableSearchParams } from '@/shared/components/common/DataTable';
import { buildFiltersWhere, buildDateRangeFiltersWhere, buildTextFiltersWhere, parseSearchParams, stateToPrismaParams } from '@/shared/components/common/DataTable/helpers';
import {
  validateVoucherType,
  mapTaxStatusToCustomerTaxCondition,
} from '../shared/afip-validation';
import {
  applySalesInvoiceEffectsTx,
  validateSalesInvoiceForConfirmation,
} from '@/modules/commercial/shared/effects/sales-invoice.server';
import { writeSalesInvoiceDataTx } from '@/modules/commercial/shared/effects/sales-invoice-data.server';
import { buildSalesInvoiceAmounts } from '../shared/totals';

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
            afipEnabled: true,
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
              afipEnabled: true,
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
            // Reparto por centro de costo de la línea (TSK-583). El nombre del
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
        journalEntry: {
          select: {
            id: true,
            number: true,
            status: true,
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
        // Solo cobros y NC vigentes: un recibo anulado o en borrador no cuenta (TSK-792/797).
        receiptItems: {
          where: EFFECTIVE_RECEIPT_ITEM,
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
          where: EFFECTIVE_SALES_CREDIT_NOTE_APPLICATION,
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
      internalTaxes: Number(invoice.internalTaxes),
      otherTaxes: Number(invoice.otherTaxes),
      total: Number(invoice.total),
      perceptions: invoice.perceptions.map((p) => ({
        ...p,
        rate: Number(p.rate),
        baseAmount: Number(p.baseAmount),
        amount: Number(p.amount),
      })),
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

/**
 * Centros de costo activos, para imputar líneas de factura (TSK-583).
 */
export async function getSalesCostCentersForSelect() {
  await checkPermission('commercial.invoices', 'view', { redirect: true });

  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  return prisma.costCenter.findMany({
    where: { companyId, isActive: true },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  });
}

export type SalesCostCenterSelectItem = Awaited<ReturnType<typeof getSalesCostCentersForSelect>>[number];

/**
 * Tipo de la "Cuenta de ventas por defecto" de la empresa (TSK-583, hallazgo
 * de revisión final).
 *
 * El formulario decide si una línea admite/exige centro de costo mirando la
 * cuenta del ítem — pero cuando el ítem no tiene una propia, el asiento
 * (`createJournalEntryForSalesInvoice`) la imputa a esta cuenta por defecto
 * (TSK-721: si tampoco hay cuenta por defecto, la confirmación se rechaza).
 * Sin este dato en el formulario, un ítem sin cuenta propia nunca mostraba el
 * campo aunque el asiento lo imputara a una cuenta de resultado.
 */
export async function getSalesDefaultAccountType() {
  await checkPermission('commercial.invoices', 'view', { redirect: true });

  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  const settings = await prisma.accountingSettings.findUnique({
    where: { companyId },
    select: { salesAccount: { select: { type: true } } },
  });

  return settings?.salesAccount?.type ?? null;
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
    const { linesData, perceptionsData, amounts } = buildSalesInvoiceAmounts(validatedData);

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
          ...amounts,
          notes: validatedData.notes,
          internalNotes: validatedData.internalNotes,
          originalInvoiceId: validatedData.originalInvoiceId || null,
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
/**
 * Confirma una factura de venta: descuenta stock, genera el asiento y la deja
 * en `CONFIRMED`, todo en una transacción.
 *
 * Devuelve `{ success, error }` en vez de lanzar (TSK-721): en producción
 * Next redacta el mensaje de un `Error` lanzado desde un Server Action, y los
 * motivos de rechazo (línea sin cuenta, cuenta no imputable, tributo sin
 * cuenta, período cerrado, stock insuficiente) tienen que llegar al usuario
 * tal cual. Cualquier fallo que no sea `BusinessError` se loguea y se
 * devuelve como mensaje genérico.
 */
export async function confirmInvoice(id: string): Promise<ActionResult<{ id: string }>> {
  await checkPermission('commercial.invoices', 'approve', { redirect: true });
  const authUserId = await getCurrentUserId();
  if (!authUserId) throw new Error('No autenticado');
  const userId = authUserId;

  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    // Verificar que la factura existe y está en borrador
    const invoice = await prisma.salesInvoice.findFirst({
      where: { id, companyId, status: 'DRAFT' },
      select: { id: true, fullNumber: true },
    });

    if (!invoice) {
      throw new BusinessError('Factura no encontrada o ya está confirmada');
    }

    // Cuentas de línea, tributos y centros de costo, antes de la transacción
    await validateSalesInvoiceForConfirmation(id, companyId);

    // Confirmar, descontar stock, asiento y compensación de la NC en transacción
    await prisma.$transaction(async (tx) => {
      // El estado se leyó fuera de la tx: si otra confirmación ganó mientras tanto, el
      // UPDATE condicionado no toca nada y los efectos no se aplican dos veces (TSK-812).
      const { count } = await tx.salesInvoice.updateMany({
        where: { id, companyId, status: 'DRAFT' },
        data: { status: 'CONFIRMED' },
      });
      if (count === 0) throw new BusinessError('Factura no encontrada o ya está confirmada');
      await applySalesInvoiceEffectsTx(tx, { companyId, userId }, id);
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
    return { success: true, id };
  } catch (error) {
    if (error instanceof BusinessError) {
      logger.warn('Confirmación de factura rechazada', {
        data: { id, companyId, motivo: error.message },
      });
    }
    return toActionResult(error, 'Error al confirmar factura');
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

    const invoice = await prisma.$transaction(async (tx) => {
      // Verificar que la factura existe y está en borrador
      const draft = await tx.salesInvoice.findFirst({
        where: { id, companyId, status: 'DRAFT' },
        select: { id: true, fullNumber: true },
      });

      if (!draft) {
        throw new BusinessError('Factura no encontrada o no está en borrador');
      }

      await writeSalesInvoiceDataTx(tx, companyId, id, validatedData);
      return draft;
    });

    logger.info('Factura actualizada', {
      data: { invoiceId: id, fullNumber: invoice.fullNumber, companyId, userId },
    });

    revalidatePath('/dashboard/commercial/invoices');
    revalidatePath(`/dashboard/commercial/invoices/${id}`);
    return { success: true, id: invoice.id };
  } catch (error) {
    logger.error('Error al actualizar factura', { data: { id, companyId, error } });
    if (error instanceof Error) throw error;
    throw new Error('Error al actualizar la factura');
  }
}

/**
 * Descarta una factura de venta en BORRADOR (la pasa a Anulada). Un borrador no aplicó
 * stock, saldo ni asiento, así que no hay nada que revertir.
 *
 * Un comprobante confirmado NO pasa por acá: se anula o elimina con la corrección en cadena
 * (`useDocumentCorrection`, TSK-792), que revierte stock, asiento y cobros. Este camino no
 * puede dejar un asiento vivo porque rechaza todo lo que no sea borrador.
 */
export async function discardDraftInvoice(id: string): Promise<ActionResult<{ id: string }>> {
  await checkPermission('commercial.invoices', 'delete', { redirect: true });
  const companyId = await getActiveCompanyId();
  try {
    if (!companyId) throw new BusinessError('No hay empresa activa');
    const { count } = await prisma.salesInvoice.updateMany({
      where: { id, companyId, status: 'DRAFT' },
      data: { status: 'CANCELLED' },
    });
    if (count === 0) {
      throw new BusinessError(
        'Solo se puede descartar una factura en borrador. Las confirmadas se anulan desde la propuesta de corrección.'
      );
    }
    logger.info('Factura en borrador descartada', { data: { invoiceId: id, companyId } });
    revalidatePath('/dashboard/commercial/invoices');
    revalidatePath(`/dashboard/commercial/invoices/${id}`);
    return { success: true, id };
  } catch (error) {
    return toActionResult(error, 'Error al descartar la factura');
  }
}
