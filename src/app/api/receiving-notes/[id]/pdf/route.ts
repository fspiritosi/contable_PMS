/**
 * API Route para generar y servir PDF de remito de recepción
 * GET /api/receiving-notes/:id/pdf
 * Query params: ?include=purchaseOrder,purchaseInvoice
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUserId } from '@/shared/lib/current-user';
import { prisma } from '@/shared/lib/prisma';
import { getActiveCompanyId } from '@/shared/lib/company';
import { logger } from '@/shared/lib/logger';
import {
  generateReceivingNotePDF,
  getReceivingNoteFileName,
  mapReceivingNoteDataForPDF,
} from '@/modules/commercial/features/purchases/features/receiving-notes/shared/pdf';
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

    const receivingNote = await prisma.receivingNote.findFirst({
      where: {
        id,
        companyId,
      },
      select: {
        fullNumber: true,
        receptionDate: true,
        status: true,
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
        warehouse: {
          select: {
            name: true,
          },
        },
        purchaseOrder: {
          select: {
            fullNumber: true,
            ...(includes.has('purchaseOrder') && {
              issueDate: true,
              total: true,
              status: true,
            }),
          },
        },
        purchaseInvoice: {
          select: {
            fullNumber: true,
            ...(includes.has('purchaseInvoice') && {
              issueDate: true,
              total: true,
              status: true,
            }),
          },
        },
        lines: {
          select: {
            description: true,
            quantity: true,
            notes: true,
            product: {
              select: {
                code: true,
                name: true,
                unitOfMeasure: true,
              },
            },
          },
        },
      },
    });

    if (!receivingNote) {
      return NextResponse.json({ error: 'Remito de recepción no encontrado' }, { status: 404 });
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

    const pdfData = mapReceivingNoteDataForPDF(receivingNote, company, await getLogoAsDataUri(companyId) ?? undefined);

    // Agregar documentos vinculados
    if (includes.size > 0) {
      const sections: LinkedDocumentSection[] = [];

      if (includes.has('purchaseOrder') && receivingNote.purchaseOrder) {
        const po = receivingNote.purchaseOrder as any;
        sections.push({
          title: 'Orden de Compra',
          columns: ['Documento', 'Fecha', 'Total', 'Estado'],
          records: [{
            label: `OC ${po.fullNumber}`,
            date: po.issueDate ? moment.utc(po.issueDate).format('DD/MM/YYYY') : '',
            amount: po.total ? formatCurrency(po.total) : '',
            status: po.status === 'CONFIRMED' ? 'Confirmada' : po.status === 'PARTIAL_RECEIVED' ? 'Recepción Parcial' : po.status === 'RECEIVED' ? 'Recibida' : po.status === 'CANCELLED' ? 'Anulada' : 'Borrador',
          }],
        });
      }

      if (includes.has('purchaseInvoice') && receivingNote.purchaseInvoice) {
        const inv = receivingNote.purchaseInvoice as any;
        sections.push({
          title: 'Factura de Compra',
          columns: ['Documento', 'Fecha', 'Total', 'Estado'],
          records: [{
            label: `FC ${inv.fullNumber}`,
            date: inv.issueDate ? moment(inv.issueDate).format('DD/MM/YYYY') : '',
            amount: inv.total ? formatCurrency(inv.total) : '',
            status: inv.status === 'CONFIRMED' ? 'Confirmada' : inv.status === 'PAID' ? 'Pagada' : inv.status === 'CANCELLED' ? 'Anulada' : 'Borrador',
          }],
        });
      }

      if (sections.length > 0) {
        pdfData.linkedDocuments = { sections } as LinkedDocumentsData;
      }
    }

    const pdfBuffer = await generateReceivingNotePDF(pdfData);
    const fileName = getReceivingNoteFileName(pdfData);

    logger.info('PDF de remito de recepción generado', {
      data: {
        fullNumber: receivingNote.fullNumber,
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
    logger.error('Error generando PDF de remito de recepción', {
      data: { receivingNoteId: id, error },
    });

    return NextResponse.json({ error: 'Error al generar el PDF' }, { status: 500 });
  }
}
