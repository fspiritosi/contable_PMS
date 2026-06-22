/**
 * API Route para generar y servir PDF de orden de pago
 * GET /api/payment-orders/:id/pdf
 * Query params: ?include=journalEntry
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUserId } from '@/shared/lib/current-user';
import { prisma } from '@/shared/lib/prisma';
import { getActiveCompanyId } from '@/shared/lib/company';
import { logger } from '@/shared/lib/logger';
import {
  generatePaymentOrderPDF,
  getPaymentOrderFileName,
  mapPaymentOrderDataForPDF,
} from '@/modules/commercial/features/treasury/features/payment-orders/shared/pdf';
import type { LinkedDocumentsData, LinkedDocumentSection } from '@/modules/commercial/shared/pdf/linked-documents-types';
import { getLogoAsDataUri } from '@/shared/utils/logo';
import moment from 'moment';

function parseIncludes(request: NextRequest): Set<string> {
  const includeParam = request.nextUrl.searchParams.get('include');
  if (!includeParam) return new Set();
  return new Set(includeParam.split(',').map((s) => s.trim()));
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

    const paymentOrder = await prisma.paymentOrder.findFirst({
      where: {
        id,
        companyId,
      },
      select: {
        id: true,
        number: true,
        fullNumber: true,
        date: true,
        totalAmount: true,
        notes: true,
        status: true,
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
        items: {
          select: {
            id: true,
            amount: true,
            invoice: {
              select: {
                id: true,
                fullNumber: true,
                issueDate: true,
                total: true,
                paymentOrderItems: {
                  select: {
                    amount: true,
                  },
                },
              },
            },
          },
          orderBy: {
            id: 'asc',
          },
        },
        payments: {
          select: {
            id: true,
            paymentMethod: true,
            amount: true,
            cashRegister: {
              select: {
                code: true,
                name: true,
              },
            },
            bankAccount: {
              select: {
                bankName: true,
                accountNumber: true,
              },
            },
            checkNumber: true,
            cardLast4: true,
            reference: true,
          },
          orderBy: {
            id: 'asc',
          },
        },
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

    if (!paymentOrder) {
      return NextResponse.json({ error: 'Orden de pago no encontrada' }, { status: 404 });
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

    const pdfData = mapPaymentOrderDataForPDF(paymentOrder as any, company, await getLogoAsDataUri(companyId) ?? undefined);

    // Agregar documentos vinculados
    if (includes.size > 0) {
      const sections: LinkedDocumentSection[] = [];

      if (includes.has('journalEntry') && (paymentOrder as any).journalEntry) {
        const entry = (paymentOrder as any).journalEntry;
        sections.push({
          title: 'Asiento Contable',
          columns: ['Asiento', 'Fecha', '', 'Estado'],
          records: [{
            label: `Asiento #${entry.number}`,
            date: entry.date ? moment(entry.date).format('DD/MM/YYYY') : '',
            status: entry.status === 'POSTED' ? 'Registrado' : entry.status === 'REVERSED' ? 'Reversado' : 'Borrador',
          }],
        });
      }

      if (sections.length > 0) {
        pdfData.linkedDocuments = { sections } as LinkedDocumentsData;
      }
    }

    const pdfBuffer = await generatePaymentOrderPDF(pdfData);
    const fileName = getPaymentOrderFileName(pdfData);

    logger.info('PDF de orden de pago generado', {
      data: {
        paymentOrderId: paymentOrder.id,
        fullNumber: paymentOrder.fullNumber,
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
    logger.error('Error generando PDF de orden de pago', {
      data: { paymentOrderId: id, error },
    });

    return NextResponse.json({ error: 'Error al generar el PDF' }, { status: 500 });
  }
}
