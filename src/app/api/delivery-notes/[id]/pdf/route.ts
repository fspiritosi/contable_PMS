import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUserId } from '@/shared/lib/current-user';
import { prisma } from '@/shared/lib/prisma';
import { getActiveCompanyId, getActiveCompany } from '@/shared/lib/company';
import { logger } from '@/shared/lib/logger';
import {
  generateDeliveryNotePDF,
  getDeliveryNoteFileName,
} from '@/modules/commercial/features/sales/features/delivery-notes/shared/pdf';
import type { DeliveryNotePDFData } from '@/modules/commercial/features/sales/features/delivery-notes/shared/pdf';
import { getLogoAsDataUri } from '@/shared/utils/logo';

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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

    const [note, company] = await Promise.all([
      prisma.deliveryNote.findFirst({
        where: { id, companyId },
        include: {
          customer: {
            select: { name: true, taxId: true, address: true, phone: true, email: true },
          },
          warehouse: { select: { name: true } },
          salesInvoice: { select: { fullNumber: true } },
          lines: {
            include: {
              product: { select: { code: true, name: true, unitOfMeasure: true } },
            },
          },
        },
      }),
      getActiveCompany(),
    ]);

    if (!note) {
      return NextResponse.json({ error: 'Remito no encontrado' }, { status: 404 });
    }

    if (!company) {
      return NextResponse.json({ error: 'Empresa no encontrada' }, { status: 400 });
    }

    const pdfData: DeliveryNotePDFData = {
      company: {
        name: company.name,
        taxId: company.taxId || '',
        address: company.address || '',
        phone: company.phone || undefined,
        email: company.email || undefined,
        logoDataUri: await getLogoAsDataUri(companyId),
      },
      deliveryNote: {
        fullNumber: note.fullNumber,
        deliveryDate: note.deliveryDate,
        status: note.status,
      },
      customer: {
        name: note.customer.name,
        taxId: note.customer.taxId,
        address: note.customer.address || undefined,
        phone: note.customer.phone || undefined,
        email: note.customer.email || undefined,
      },
      warehouse: { name: note.warehouse.name },
      sourceInvoice: note.salesInvoice
        ? { fullNumber: note.salesInvoice.fullNumber }
        : undefined,
      lines: note.lines.map((line) => ({
        productCode: line.product.code,
        description: line.description || line.product.name,
        quantity: Number(line.quantity),
        unitOfMeasure: line.product.unitOfMeasure || undefined,
        notes: line.notes || undefined,
      })),
      notes: note.notes || undefined,
    };

    const pdfBuffer = await generateDeliveryNotePDF(pdfData);
    const fileName = getDeliveryNoteFileName(pdfData);

    return new NextResponse(pdfBuffer, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${fileName}"`,
      },
    });
  } catch (error) {
    logger.error('Error al generar PDF de remito de entrega', {
      data: { error, deliveryNoteId: id },
    });
    return NextResponse.json({ error: 'Error al generar el PDF' }, { status: 500 });
  }
}
