'use server';

import { getActiveCompanyId } from '@/shared/lib/company';
import { logger } from '@/shared/lib/logger';
import { checkPermission } from '@/shared/lib/permissions';
import {
  EFFECTIVE_RECEIPT_ITEM,
  EFFECTIVE_SALES_CREDIT_NOTE_APPLICATION,
} from '@/shared/lib/effective-settlements';
import { prisma } from '@/shared/lib/prisma';
import { getPresignedDownloadUrl } from '@/shared/lib/storage';
import { isCreditNote } from '@/modules/commercial/shared/voucher-utils';
import { revalidatePath } from 'next/cache';

// Select optimizado para relaciones
const relationSelect = { select: { id: true, name: true } } as const;

/**
 * Obtiene un cliente por ID con información completa para el detalle
 */
export async function getClientDetailById(id: string) {
  await checkPermission('commercial.clients', 'view', { redirect: true });
  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    const client = await prisma.contractor.findFirst({
      where: { id, companyId },
      include: {
        contact: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            phone: true,
            position: true,
          },
        },
        vehicleAllocations: {
          include: {
            vehicle: {
              select: {
                id: true,
                internNumber: true,
                domain: true,
                brand: { select: { id: true, name: true } },
                model: { select: { id: true, name: true } },
              },
            },
          },
          orderBy: { createdAt: 'desc' },
        },
        employeeAllocations: {
          include: {
            employee: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                employeeNumber: true,
                jobPosition: relationSelect,
              },
            },
          },
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!client) throw new Error('Cliente no encontrado');

    // Generar URL de logo dinámicamente si existe logoKey
    let logoUrl: string | null = null;
    if (client.logoKey) {
      try {
        logoUrl = await getPresignedDownloadUrl(client.logoKey, { expiresIn: 3600 });
      } catch (e) {
        logger.warn('No se pudo generar URL de logo', { data: { key: client.logoKey } });
      }
    }

    return {
      ...client,
      logoUrl,
    };
  } catch (error) {
    logger.error('Error getting client detail', { data: { error, id } });
    throw error instanceof Error ? error : new Error('Error al obtener el cliente');
  }
}

/**
 * Obtiene vehículos disponibles para asignar a un cliente
 * (vehículos que no están asignados a este cliente)
 */
export async function getAvailableVehiclesForClient(clientId: string) {
  await checkPermission('commercial.clients', 'view', { redirect: true });
  const companyId = await getActiveCompanyId();
  if (!companyId) return [];

  try {
    // Obtener IDs de vehículos ya asignados a este cliente
    const assignedVehicleIds = await prisma.contractorVehicle.findMany({
      where: { contractorId: clientId },
      select: { vehicleId: true },
    });

    const excludeIds = assignedVehicleIds.map((v) => v.vehicleId);

    return await prisma.vehicle.findMany({
      where: {
        companyId,
        isActive: true,
        id: { notIn: excludeIds },
      },
      select: {
        id: true,
        internNumber: true,
        domain: true,
        brand: { select: { id: true, name: true } },
        model: { select: { id: true, name: true } },
      },
      orderBy: { internNumber: 'asc' },
    });
  } catch (error) {
    logger.error('Error getting available vehicles', { data: { error, clientId } });
    return [];
  }
}

/**
 * Obtiene empleados disponibles para asignar a un cliente
 * (empleados que no están asignados a este cliente)
 */
export async function getAvailableEmployeesForClient(clientId: string) {
  await checkPermission('commercial.clients', 'view', { redirect: true });
  const companyId = await getActiveCompanyId();
  if (!companyId) return [];

  try {
    // Obtener IDs de empleados ya asignados a este cliente
    const assignedEmployeeIds = await prisma.contractorEmployee.findMany({
      where: { contractorId: clientId },
      select: { employeeId: true },
    });

    const excludeIds = assignedEmployeeIds.map((e) => e.employeeId);

    return await prisma.employee.findMany({
      where: {
        companyId,
        isActive: true,
        id: { notIn: excludeIds },
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        employeeNumber: true,
        jobPosition: relationSelect,
      },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    });
  } catch (error) {
    logger.error('Error getting available employees', { data: { error, clientId } });
    return [];
  }
}

/**
 * Asigna un vehículo a un cliente
 */
export async function assignVehicleToClient(clientId: string, vehicleId: string) {
  await checkPermission('commercial.clients', 'update', { redirect: true });
  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    // Verificar que el cliente pertenece a la empresa
    const client = await prisma.contractor.findFirst({
      where: { id: clientId, companyId },
      select: { id: true },
    });
    if (!client) throw new Error('Cliente no encontrado');

    // Verificar que el vehículo pertenece a la empresa
    const vehicle = await prisma.vehicle.findFirst({
      where: { id: vehicleId, companyId },
      select: { id: true },
    });
    if (!vehicle) throw new Error('Vehículo no encontrado');

    // Verificar que no existe ya la asignación
    const existing = await prisma.contractorVehicle.findUnique({
      where: {
        vehicleId_contractorId: { vehicleId, contractorId: clientId },
      },
    });
    if (existing) throw new Error('El vehículo ya está asignado a este cliente');

    await prisma.contractorVehicle.create({
      data: {
        vehicleId,
        contractorId: clientId,
      },
    });

    revalidatePath(`/dashboard/company/commercial/clients/${clientId}`);
    return { success: true };
  } catch (error) {
    logger.error('Error assigning vehicle to client', { data: { error, clientId, vehicleId } });
    throw error instanceof Error ? error : new Error('Error al asignar vehículo');
  }
}

/**
 * Desasigna un vehículo de un cliente
 */
export async function unassignVehicleFromClient(clientId: string, vehicleId: string) {
  await checkPermission('commercial.clients', 'update', { redirect: true });
  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    // Verificar que el cliente pertenece a la empresa
    const client = await prisma.contractor.findFirst({
      where: { id: clientId, companyId },
      select: { id: true },
    });
    if (!client) throw new Error('Cliente no encontrado');

    await prisma.contractorVehicle.delete({
      where: {
        vehicleId_contractorId: { vehicleId, contractorId: clientId },
      },
    });

    revalidatePath(`/dashboard/company/commercial/clients/${clientId}`);
    return { success: true };
  } catch (error) {
    logger.error('Error unassigning vehicle from client', { data: { error, clientId, vehicleId } });
    throw error instanceof Error ? error : new Error('Error al desasignar vehículo');
  }
}

/**
 * Asigna un empleado a un cliente
 */
export async function assignEmployeeToClient(clientId: string, employeeId: string) {
  await checkPermission('commercial.clients', 'update', { redirect: true });
  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    // Verificar que el cliente pertenece a la empresa
    const client = await prisma.contractor.findFirst({
      where: { id: clientId, companyId },
      select: { id: true },
    });
    if (!client) throw new Error('Cliente no encontrado');

    // Verificar que el empleado pertenece a la empresa
    const employee = await prisma.employee.findFirst({
      where: { id: employeeId, companyId },
      select: { id: true },
    });
    if (!employee) throw new Error('Empleado no encontrado');

    // Verificar que no existe ya la asignación
    const existing = await prisma.contractorEmployee.findUnique({
      where: {
        employeeId_contractorId: { employeeId, contractorId: clientId },
      },
    });
    if (existing) throw new Error('El empleado ya está asignado a este cliente');

    await prisma.contractorEmployee.create({
      data: {
        employeeId,
        contractorId: clientId,
      },
    });

    revalidatePath(`/dashboard/company/commercial/clients/${clientId}`);
    return { success: true };
  } catch (error) {
    logger.error('Error assigning employee to client', { data: { error, clientId, employeeId } });
    throw error instanceof Error ? error : new Error('Error al asignar empleado');
  }
}

/**
 * Desasigna un empleado de un cliente
 */
export async function unassignEmployeeFromClient(clientId: string, employeeId: string) {
  await checkPermission('commercial.clients', 'update', { redirect: true });
  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    // Verificar que el cliente pertenece a la empresa
    const client = await prisma.contractor.findFirst({
      where: { id: clientId, companyId },
      select: { id: true },
    });
    if (!client) throw new Error('Cliente no encontrado');

    await prisma.contractorEmployee.delete({
      where: {
        employeeId_contractorId: { employeeId, contractorId: clientId },
      },
    });

    revalidatePath(`/dashboard/company/commercial/clients/${clientId}`);
    return { success: true };
  } catch (error) {
    logger.error('Error unassigning employee from client', {
      data: { error, clientId, employeeId },
    });
    throw error instanceof Error ? error : new Error('Error al desasignar empleado');
  }
}

/**
 * Obtiene la cuenta corriente completa del cliente
 */
export async function getClientAccountStatement(clientId: string) {
  await checkPermission('commercial.clients', 'view', { redirect: true });
  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    // Verificar que el cliente existe y pertenece a la empresa
    const client = await prisma.contractor.findFirst({
      where: { id: clientId, companyId },
      select: { id: true, name: true },
    });

    if (!client) {
      throw new Error('Cliente no encontrado');
    }

    // Obtener facturas de venta
    const salesInvoices = await prisma.salesInvoice.findMany({
      where: {
        customerId: clientId,
        companyId,
        status: { in: ['CONFIRMED', 'PAID', 'PARTIAL_PAID'] },
      },
      select: {
        id: true,
        fullNumber: true,
        voucherType: true,
        issueDate: true,
        dueDate: true,
        total: true,
        status: true,
        receiptItems: {
          where: EFFECTIVE_RECEIPT_ITEM,
          select: {
            amount: true,
            receipt: {
              select: {
                fullNumber: true,
                date: true,
              },
            },
          },
        },
        creditNoteApplicationsReceived: {
          where: EFFECTIVE_SALES_CREDIT_NOTE_APPLICATION,
          select: {
            amount: true,
            creditNoteId: true,
            creditNote: {
              select: {
                fullNumber: true,
              },
            },
          },
        },
        creditNoteApplicationsGiven: {
          select: {
            amount: true,
            invoice: {
              select: {
                fullNumber: true,
              },
            },
          },
        },
        creditDebitNotes: {
          select: {
            id: true,
            voucherType: true,
            total: true,
            status: true,
          },
        },
      },
      orderBy: { issueDate: 'desc' },
    });

    // Obtener recibos
    const receipts = await prisma.receipt.findMany({
      where: {
        customerId: clientId,
        companyId,
        status: 'CONFIRMED', // Solo recibos confirmados
      },
      select: {
        id: true,
        fullNumber: true,
        date: true,
        totalAmount: true,
        status: true,
        items: {
          select: {
            amount: true,
            invoice: {
              select: {
                fullNumber: true,
                issueDate: true,
              },
            },
          },
        },
        withholdings: {
          select: {
            amount: true,
            taxType: true,
          },
        },
      },
      orderBy: { date: 'desc' },
    });

    // Calcular saldos
    const invoicesWithBalance = salesInvoices.map((invoice) => {
      const isNC = isCreditNote(invoice.voucherType);
      const totalCollected = invoice.receiptItems.reduce(
        (sum, item) => sum + Number(item.amount),
        0
      );

      // NC aplicadas explícitamente (tabla SalesCreditNoteApplication)
      const cnAppliedToThisExplicit = invoice.creditNoteApplicationsReceived.reduce(
        (sum, app) => sum + Number(app.amount),
        0
      );

      // Fallback: NC vinculadas por originalInvoiceId sin registro explícito
      // Capear para que collected no supere el total de la factura
      const explicitCNIds = new Set(
        invoice.creditNoteApplicationsReceived.map((app) => app.creditNoteId)
      );
      const cnLinkedRaw = !isNC
        ? invoice.creditDebitNotes
            .filter(
              (doc) =>
                isCreditNote(doc.voucherType) &&
                doc.status !== 'DRAFT' &&
                doc.status !== 'CANCELLED' &&
                !explicitCNIds.has(doc.id)
            )
            .reduce((sum, doc) => sum + Number(doc.total), 0)
        : 0;
      const maxFallbackNC = Math.max(0, Number(invoice.total) - totalCollected - cnAppliedToThisExplicit);
      const cnLinkedToThis = Math.min(cnLinkedRaw, maxFallbackNC);

      const cnAppliedToThis = cnAppliedToThisExplicit + cnLinkedToThis;

      const cnAppliedFromThis = invoice.creditNoteApplicationsGiven.reduce(
        (sum, app) => sum + Number(app.amount),
        0
      );

      // NC: saldo restante no aplicado (negativo = crédito disponible)
      // Factura/ND: balance = total - cobrado - NC aplicadas
      const balance = isNC
        ? -(Number(invoice.total) - cnAppliedFromThis)
        : Number(invoice.total) - totalCollected - cnAppliedToThis;

      return {
        id: invoice.id,
        fullNumber: invoice.fullNumber,
        voucherType: invoice.voucherType,
        issueDate: invoice.issueDate,
        dueDate: invoice.dueDate,
        total: Number(invoice.total),
        collected: isNC ? cnAppliedFromThis : totalCollected + cnAppliedToThis,
        balance,
        status: invoice.status,
        receipts: invoice.receiptItems.map((item) => ({
          amount: Number(item.amount),
          receiptNumber: item.receipt.fullNumber,
          receiptDate: item.receipt.date,
        })),
      };
    });

    const receiptsFormatted = receipts.map((receipt) => ({
      id: receipt.id,
      fullNumber: receipt.fullNumber,
      date: receipt.date,
      totalAmount: Number(receipt.totalAmount),
      status: receipt.status,
      withholdingsTotal: receipt.withholdings.reduce((sum, w) => sum + Number(w.amount), 0),
      invoices: receipt.items.map((item) => ({
        amount: Number(item.amount),
        invoiceNumber: item.invoice.fullNumber,
        invoiceDate: item.invoice.issueDate,
      })),
    }));

    // Calcular totales: Facturado (Facturas + ND), Cobrado (Recibos + NC aplicadas), Saldo
    const totalInvoiced = invoicesWithBalance
      .filter((inv) => !isCreditNote(inv.voucherType))
      .reduce((sum, inv) => sum + inv.total, 0);
    const totalCollected = invoicesWithBalance
      .filter((inv) => !isCreditNote(inv.voucherType))
      .reduce((sum, inv) => sum + inv.collected, 0);
    const totalBalance = totalInvoiced - totalCollected;

    logger.info('Cuenta corriente de cliente obtenida', {
      data: { clientId, companyId, invoiceCount: invoicesWithBalance.length },
    });

    return {
      client: {
        id: client.id,
        name: client.name,
      },
      invoices: invoicesWithBalance,
      receipts: receiptsFormatted,
      summary: {
        totalInvoiced,
        totalCollected,
        totalBalance,
      },
    };
  } catch (error) {
    logger.error('Error al obtener cuenta corriente de cliente', {
      data: { clientId, error },
    });
    throw error;
  }
}

// ============================================
// TIPOS INFERIDOS
// ============================================

export type ClientDetail = Awaited<ReturnType<typeof getClientDetailById>>;
export type ClientVehicleAllocation = ClientDetail['vehicleAllocations'][number];
export type ClientEmployeeAllocation = ClientDetail['employeeAllocations'][number];
export type AvailableVehicle = Awaited<ReturnType<typeof getAvailableVehiclesForClient>>[number];
export type AvailableEmployee = Awaited<ReturnType<typeof getAvailableEmployeesForClient>>[number];
export type ClientAccountStatement = Awaited<ReturnType<typeof getClientAccountStatement>>;
export type ClientInvoiceWithBalance = ClientAccountStatement['invoices'][number];
export type ClientReceipt = ClientAccountStatement['receipts'][number];

// ============================================
// REMITOS DE ENTREGA DEL CLIENTE
// ============================================

export async function getClientDeliveryNotes(clientId: string) {
  await checkPermission('commercial.delivery-notes', 'view', { redirect: true });
  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    const notes = await prisma.deliveryNote.findMany({
      where: { companyId, customerId: clientId },
      select: {
        id: true,
        fullNumber: true,
        deliveryDate: true,
        status: true,
        warehouse: { select: { name: true } },
        salesInvoice: { select: { id: true, fullNumber: true } },
        lines: { select: { quantity: true } },
      },
      orderBy: { deliveryDate: 'desc' },
    });

    return notes.map((n) => ({
      ...n,
      lineCount: n.lines.length,
      totalQty: n.lines.reduce((sum, l) => sum + Number(l.quantity), 0),
    }));
  } catch (error) {
    logger.error('Error al obtener remitos del cliente', { data: { error, clientId } });
    return [];
  }
}

export type ClientDeliveryNote = Awaited<ReturnType<typeof getClientDeliveryNotes>>[number];
