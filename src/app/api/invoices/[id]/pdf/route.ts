/**
 * API Route para generar y servir PDF de factura
 * GET /api/invoices/:id/pdf
 * Query params: ?include=creditNotes,receipts,creditNoteApplications,journalEntry
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUserId } from '@/shared/lib/current-user';
import { prisma } from '@/shared/lib/prisma';
import { getActiveCompanyId } from '@/shared/lib/company';
import { logger } from '@/shared/lib/logger';
import { generateInvoicePDF, getInvoiceFileName } from '@/modules/commercial/features/sales/shared/pdf/generator';
import { mapInvoiceDataForPDF } from '@/modules/commercial/features/sales/shared/pdf/data-mapper';
import { VOUCHER_TYPE_LABELS, INVOICE_STATUS_LABELS } from '@/modules/commercial/features/sales/features/invoices/shared/validators';
import type { LinkedDocumentsData, LinkedDocumentSection } from '@/modules/commercial/shared/pdf/linked-documents-types';
import type { SalesInvoiceStatus } from '@/generated/prisma/enums';
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

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    // Autenticación
    const userId = await getCurrentUserId();
    if (!userId) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
    }

    const companyId = await getActiveCompanyId();
    if (!companyId) {
      return NextResponse.json({ error: 'No hay empresa activa' }, { status: 400 });
    }

    const includes = parseIncludes(request);

    // Obtener factura con todos los datos necesarios
    const invoice = await prisma.salesInvoice.findFirst({
      where: {
        id,
        companyId,
      },
      include: {
        customer: {
          select: {
            name: true,
            taxId: true,
            taxCondition: true,
            email: true,
            phone: true,
            address: true,
          },
        },
        pointOfSale: {
          select: {
            number: true,
            name: true,
          },
        },
        lines: {
          include: {
            product: {
              select: {
                code: true,
                name: true,
                unitOfMeasure: true,
              },
            },
          },
          orderBy: {
            id: 'asc',
          },
        },
        // Incluir relaciones según query params
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
        ...(includes.has('receipts') && {
          receiptItems: {
            select: {
              amount: true,
              receipt: {
                select: {
                  fullNumber: true,
                  date: true,
                  status: true,
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
        ...(includes.has('journalEntry') && {
          journalEntry: {
            select: {
              number: true,
              status: true,
              date: true,
            },
          },
        }),
      },
    });

    if (!invoice) {
      return NextResponse.json({ error: 'Factura no encontrada' }, { status: 404 });
    }

    // Obtener datos de la empresa
    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: {
        name: true,
        taxId: true,
        taxStatus: true,
        address: true,
        phone: true,
        email: true,
      },
    });

    if (!company) {
      return NextResponse.json({ error: 'Empresa no encontrada' }, { status: 404 });
    }

    // Mapear datos al formato del PDF
    const pdfData = mapInvoiceDataForPDF(invoice as any, company, await getLogoAsDataUri(companyId) ?? undefined);

    // Agregar documentos vinculados si se solicitaron
    if (includes.size > 0) {
      const sections: LinkedDocumentSection[] = [];

      // NC/ND vinculadas
      if (includes.has('creditNotes') && (invoice as any).creditDebitNotes?.length > 0) {
        sections.push({
          title: 'Notas de Crédito / Débito',
          columns: ['Comprobante', 'Fecha', 'Importe', 'Estado'],
          records: (invoice as any).creditDebitNotes.map((doc: any) => ({
            label: `${VOUCHER_TYPE_LABELS[doc.voucherType as keyof typeof VOUCHER_TYPE_LABELS] || doc.voucherType} ${doc.fullNumber}`,
            date: moment(doc.issueDate).format('DD/MM/YYYY'),
            amount: formatCurrency(doc.total),
            status: INVOICE_STATUS_LABELS[doc.status as SalesInvoiceStatus] || doc.status,
          })),
        });
      }

      // Cobros (recibos)
      if (includes.has('receipts') && (invoice as any).receiptItems?.length > 0) {
        sections.push({
          title: 'Cobros (Recibos)',
          columns: ['Recibo', 'Fecha', 'Monto Cobrado', 'Estado'],
          records: (invoice as any).receiptItems.map((item: any) => ({
            label: `Recibo ${item.receipt.fullNumber}`,
            date: moment(item.receipt.date).format('DD/MM/YYYY'),
            amount: formatCurrency(item.amount),
            status: item.receipt.status === 'CONFIRMED' ? 'Confirmado' : 'Borrador',
          })),
        });
      }

      // NC aplicadas
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

      // Asiento contable
      if (includes.has('journalEntry') && (invoice as any).journalEntry) {
        const entry = (invoice as any).journalEntry;
        sections.push({
          title: 'Asiento Contable',
          columns: ['Asiento', 'Fecha', '', 'Estado'],
          records: [
            {
              label: `Asiento #${entry.number}`,
              date: entry.date ? moment(entry.date).format('DD/MM/YYYY') : '',
              status: entry.status === 'POSTED' ? 'Registrado' : entry.status === 'REVERSED' ? 'Reversado' : 'Borrador',
            },
          ],
        });
      }

      if (sections.length > 0) {
        pdfData.linkedDocuments = { sections } as LinkedDocumentsData;
      }
    }

    // Generar PDF
    const pdfBuffer = await generateInvoicePDF(pdfData);

    // Generar nombre de archivo
    const fileName = getInvoiceFileName(pdfData);

    // Log de generación
    logger.info('PDF de factura generado', {
      data: {
        invoiceId: invoice.id,
        fullNumber: invoice.fullNumber,
        companyId,
        userId,
        includes: Array.from(includes),
      },
    });

    // Retornar PDF (convertir Buffer a Uint8Array)
    return new NextResponse(new Uint8Array(pdfBuffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${fileName}"`,
        'Content-Length': pdfBuffer.length.toString(),
      },
    });
  } catch (error) {
    const { id: invoiceId } = await params;
    logger.error('Error generando PDF de factura', {
      data: { invoiceId, error },
    });

    return NextResponse.json(
      { error: 'Error al generar el PDF' },
      { status: 500 }
    );
  }
}
