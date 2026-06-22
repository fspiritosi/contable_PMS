/**
 * API Route para generar y servir PDF de factura de compra
 * GET /api/purchase-invoices/:id/pdf
 * Query params: ?include=creditNotes,paymentOrders,creditNoteApplications,receivingNotes,purchaseOrder
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUserId } from '@/shared/lib/current-user';
import { prisma } from '@/shared/lib/prisma';
import { getActiveCompanyId } from '@/shared/lib/company';
import { logger } from '@/shared/lib/logger';
import {
  generatePurchaseInvoicePDF,
  getPurchaseInvoiceFileName,
  mapPurchaseInvoiceDataForPDF,
} from '@/modules/commercial/features/purchases/features/invoices/shared/pdf';
import { VOUCHER_TYPE_LABELS, PURCHASE_INVOICE_STATUS_LABELS } from '@/modules/commercial/features/purchases/features/invoices/shared/validators';
import type { LinkedDocumentsData, LinkedDocumentSection } from '@/modules/commercial/shared/pdf/linked-documents-types';
import { getLogoAsDataUri } from '@/shared/utils/logo';
import type { PurchaseInvoiceStatus } from '@/generated/prisma/enums';
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

    const invoice = await prisma.purchaseInvoice.findFirst({
      where: { id, companyId },
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
        notes: true,
        cae: true,
        status: true,
        supplier: {
          select: {
            businessName: true,
            tradeName: true,
            taxId: true,
            taxCondition: true,
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
            vatAmount: true,
            total: true,
            product: {
              select: {
                code: true,
                name: true,
                unitOfMeasure: true,
              },
            },
          },
          orderBy: { id: 'asc' },
        },
        purchaseOrder: {
          select: { fullNumber: true },
        },
        ...(includes.has('creditNotes') && {
          creditDebitNotes: {
            select: {
              fullNumber: true,
              voucherType: true,
              total: true,
              status: true,
              issueDate: true,
            },
            orderBy: { issueDate: 'desc' as const },
          },
        }),
        ...(includes.has('paymentOrders') && {
          paymentOrderItems: {
            select: {
              amount: true,
              paymentOrder: {
                select: {
                  fullNumber: true,
                  date: true,
                  status: true,
                  totalAmount: true,
                },
              },
            },
          },
        }),
        ...(includes.has('creditNoteApplications') && {
          creditNoteApplicationsReceived: {
            select: {
              amount: true,
              appliedAt: true,
              creditNote: {
                select: {
                  fullNumber: true,
                  voucherType: true,
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
                  fullNumber: true,
                  voucherType: true,
                },
              },
            },
          },
        }),
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
      },
    });

    if (!invoice) {
      return NextResponse.json({ error: 'Factura de compra no encontrada' }, { status: 404 });
    }

    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: {
        name: true,
        taxId: true,
        address: true,
        phone: true,
        email: true,
      },
    });

    if (!company) {
      return NextResponse.json({ error: 'Empresa no encontrada' }, { status: 404 });
    }

    const pdfData = mapPurchaseInvoiceDataForPDF(invoice as any, company, await getLogoAsDataUri(companyId) ?? undefined);

    // Agregar documentos vinculados
    if (includes.size > 0) {
      const sections: LinkedDocumentSection[] = [];

      if (includes.has('creditNotes') && (invoice as any).creditDebitNotes?.length > 0) {
        sections.push({
          title: 'Notas de Crédito / Débito',
          columns: ['Comprobante', 'Fecha', 'Importe', 'Estado'],
          records: (invoice as any).creditDebitNotes.map((doc: any) => ({
            label: `${VOUCHER_TYPE_LABELS[doc.voucherType as keyof typeof VOUCHER_TYPE_LABELS] || doc.voucherType} ${doc.fullNumber}`,
            date: moment(doc.issueDate).format('DD/MM/YYYY'),
            amount: formatCurrency(doc.total),
            status: PURCHASE_INVOICE_STATUS_LABELS[doc.status as PurchaseInvoiceStatus] || doc.status,
          })),
        });
      }

      if (includes.has('paymentOrders') && (invoice as any).paymentOrderItems?.length > 0) {
        sections.push({
          title: 'Órdenes de Pago',
          columns: ['Orden de Pago', 'Fecha', 'Monto Pagado', 'Estado'],
          records: (invoice as any).paymentOrderItems.map((item: any) => ({
            label: `OP ${item.paymentOrder.fullNumber}`,
            date: moment(item.paymentOrder.date).format('DD/MM/YYYY'),
            amount: formatCurrency(item.amount),
            status: item.paymentOrder.status === 'CONFIRMED' ? 'Confirmada' : 'Borrador',
          })),
        });
      }

      if (includes.has('creditNoteApplications')) {
        const received = (invoice as any).creditNoteApplicationsReceived;
        if (received?.length > 0) {
          sections.push({
            title: 'Notas de Crédito Aplicadas',
            columns: ['Comprobante', 'Fecha', 'Monto Aplicado'],
            records: received.map((app: any) => ({
              label: `${VOUCHER_TYPE_LABELS[app.creditNote.voucherType as keyof typeof VOUCHER_TYPE_LABELS] || app.creditNote.voucherType} ${app.creditNote.fullNumber}`,
              date: moment(app.appliedAt).format('DD/MM/YYYY'),
              amount: formatCurrency(app.amount),
            })),
          });
        }

        const given = (invoice as any).creditNoteApplicationsGiven;
        if (given?.length > 0) {
          sections.push({
            title: 'Aplicada a Facturas',
            columns: ['Comprobante', 'Fecha', 'Monto Aplicado'],
            records: given.map((app: any) => ({
              label: `${VOUCHER_TYPE_LABELS[app.invoice.voucherType as keyof typeof VOUCHER_TYPE_LABELS] || app.invoice.voucherType} ${app.invoice.fullNumber}`,
              date: moment(app.appliedAt).format('DD/MM/YYYY'),
              amount: formatCurrency(app.amount),
            })),
          });
        }
      }

      if (includes.has('receivingNotes') && (invoice as any).receivingNotes?.length > 0) {
        sections.push({
          title: 'Remitos de Recepción',
          columns: ['Remito', 'Fecha', 'Almacén', 'Estado'],
          records: (invoice as any).receivingNotes.map((rn: any) => ({
            label: rn.fullNumber,
            date: moment.utc(rn.receptionDate).format('DD/MM/YYYY'),
            amount: rn.warehouse.name,
            status: rn.status === 'CONFIRMED' ? 'Confirmado' : rn.status === 'CANCELLED' ? 'Anulado' : 'Borrador',
          })),
        });
      }

      if (includes.has('purchaseOrder') && (invoice as any).purchaseOrder) {
        sections.push({
          title: 'Orden de Compra',
          columns: ['Documento', '', '', ''],
          records: [{
            label: `OC ${(invoice as any).purchaseOrder.fullNumber}`,
          }],
        });
      }

      if (sections.length > 0) {
        pdfData.linkedDocuments = { sections } as LinkedDocumentsData;
      }
    }

    const pdfBuffer = await generatePurchaseInvoicePDF(pdfData);
    const fileName = getPurchaseInvoiceFileName(pdfData);

    logger.info('PDF de factura de compra generado', {
      data: {
        purchaseInvoiceId: invoice.id,
        fullNumber: invoice.fullNumber,
        companyId,
        userId,
        includes: Array.from(includes),
      },
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
    logger.error('Error generando PDF de factura de compra', {
      data: { purchaseInvoiceId: id, error },
    });
    return NextResponse.json({ error: 'Error al generar el PDF' }, { status: 500 });
  }
}
