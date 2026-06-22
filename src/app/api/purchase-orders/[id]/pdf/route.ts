/**
 * API Route para generar y servir PDF de orden de compra
 * GET /api/purchase-orders/:id/pdf
 * Query params: ?include=receivingNotes,purchaseInvoices
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUserId } from '@/shared/lib/current-user';
import { prisma } from '@/shared/lib/prisma';
import { getActiveCompanyId } from '@/shared/lib/company';
import { logger } from '@/shared/lib/logger';
import {
  generatePurchaseOrderPDF,
  getPurchaseOrderFileName,
  mapPurchaseOrderDataForPDF,
} from '@/modules/commercial/features/purchases/features/purchase-orders/shared/pdf';
import type { LinkedDocumentsData, LinkedDocumentSection } from '@/modules/commercial/shared/pdf/linked-documents-types';
import { getLogoAsDataUri } from '@/shared/utils/logo';
import moment from 'moment';

function parseIncludes(request: NextRequest): Set<string> {
  const includeParam = request.nextUrl.searchParams.get('include');
  if (!includeParam) return new Set();
  return new Set(includeParam.split(',').map((s) => s.trim()));
}

function formatCurrency(value: number | { toNumber?: () => number }): string {
  const num = typeof value === 'number' ? value : Number(value);
  return `$${num.toLocaleString('es-AR', { minimumFractionDigits: 2 })}`;
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const userId = await getCurrentUserId();
    if (!userId) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
    }

    const companyId = await getActiveCompanyId();
    if (!companyId) {
      return NextResponse.json({ error: 'No hay empresa activa' }, { status: 400 });
    }

    const includes = parseIncludes(request);

    const purchaseOrder = await prisma.purchaseOrder.findFirst({
      where: { id, companyId },
      select: {
        id: true,
        number: true,
        fullNumber: true,
        issueDate: true,
        expectedDeliveryDate: true,
        subtotal: true,
        vatAmount: true,
        total: true,
        status: true,
        paymentConditions: true,
        deliveryAddress: true,
        deliveryNotes: true,
        notes: true,
        supplier: {
          select: {
            businessName: true,
            tradeName: true,
            taxId: true,
            address: true,
            phone: true,
            email: true,
          },
        },
        lines: {
          select: {
            description: true,
            quantity: true,
            unitCost: true,
            vatRate: true,
            subtotal: true,
            total: true,
            product: { select: { code: true, name: true } },
          },
          orderBy: { id: 'asc' },
        },
        installments: {
          select: { number: true, dueDate: true, amount: true, notes: true },
          orderBy: { number: 'asc' },
        },
        ...(includes.has('receivingNotes') && {
          receivingNotes: {
            select: {
              fullNumber: true,
              receptionDate: true,
              status: true,
              warehouse: { select: { name: true } },
            },
            orderBy: { receptionDate: 'desc' as const },
          },
        }),
        ...(includes.has('purchaseInvoices') && {
          purchaseInvoices: {
            select: {
              fullNumber: true,
              issueDate: true,
              total: true,
              status: true,
            },
            orderBy: { issueDate: 'desc' as const },
          },
        }),
      },
    });

    if (!purchaseOrder) {
      return NextResponse.json({ error: 'Orden de compra no encontrada' }, { status: 404 });
    }

    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: { name: true, taxId: true, address: true, phone: true, email: true },
    });

    if (!company) {
      return NextResponse.json({ error: 'Empresa no encontrada' }, { status: 404 });
    }

    const pdfData = mapPurchaseOrderDataForPDF(purchaseOrder as any, company, await getLogoAsDataUri(companyId) ?? undefined);

    // Agregar documentos vinculados
    if (includes.size > 0) {
      const sections: LinkedDocumentSection[] = [];

      if (includes.has('receivingNotes') && (purchaseOrder as any).receivingNotes?.length > 0) {
        sections.push({
          title: 'Remitos de Recepción',
          columns: ['Remito', 'Fecha', 'Almacén', 'Estado'],
          records: (purchaseOrder as any).receivingNotes.map((rn: any) => ({
            label: rn.fullNumber,
            date: moment.utc(rn.receptionDate).format('DD/MM/YYYY'),
            amount: rn.warehouse.name,
            status: rn.status === 'CONFIRMED' ? 'Confirmado' : rn.status === 'CANCELLED' ? 'Anulado' : 'Borrador',
          })),
        });
      }

      if (includes.has('purchaseInvoices') && (purchaseOrder as any).purchaseInvoices?.length > 0) {
        sections.push({
          title: 'Facturas de Compra',
          columns: ['Factura', 'Fecha', 'Total', 'Estado'],
          records: (purchaseOrder as any).purchaseInvoices.map((inv: any) => ({
            label: inv.fullNumber,
            date: moment(inv.issueDate).format('DD/MM/YYYY'),
            amount: formatCurrency(inv.total),
            status: inv.status === 'CONFIRMED' ? 'Confirmada' : inv.status === 'PAID' ? 'Pagada' : inv.status === 'CANCELLED' ? 'Anulada' : 'Borrador',
          })),
        });
      }

      if (sections.length > 0) {
        pdfData.linkedDocuments = { sections } as LinkedDocumentsData;
      }
    }

    const pdfBuffer = await generatePurchaseOrderPDF(pdfData);
    const fileName = getPurchaseOrderFileName(pdfData);

    logger.info('PDF de orden de compra generado', {
      data: { purchaseOrderId: purchaseOrder.id, fullNumber: purchaseOrder.fullNumber, companyId, userId, includes: Array.from(includes) },
    });

    return new NextResponse(new Uint8Array(pdfBuffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${fileName}"`,
        'Content-Length': pdfBuffer.length.toString(),
      },
    });
  } catch (error) {
    logger.error('Error generando PDF de orden de compra', {
      data: { purchaseOrderId: id, error },
    });
    return NextResponse.json({ error: 'Error al generar el PDF' }, { status: 500 });
  }
}
