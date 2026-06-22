/**
 * API Route para generar y servir PDF de presupuesto
 * GET /api/quotes/:id/pdf
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUserId } from '@/shared/lib/current-user';
import { prisma } from '@/shared/lib/prisma';
import { getActiveCompanyId } from '@/shared/lib/company';
import { logger } from '@/shared/lib/logger';
import { generateQuotePDF, getQuoteFileName } from '@/modules/commercial/features/quotes/shared/pdf/generator';
import { mapQuoteDataForPDF } from '@/modules/commercial/features/quotes/shared/pdf/data-mapper';
import { getLogoAsDataUri } from '@/shared/utils/logo';

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

    // Obtener presupuesto con todos los datos necesarios
    const quote = await prisma.quote.findFirst({
      where: {
        id,
        companyId,
      },
      include: {
        contractor: {
          select: {
            id: true,
            name: true,
            taxId: true,
            email: true,
            phone: true,
            address: true,
          },
        },
        lead: {
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
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
          orderBy: {
            id: 'asc',
          },
        },
      },
    });

    if (!quote) {
      return NextResponse.json({ error: 'Presupuesto no encontrado' }, { status: 404 });
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

    // Convertir Decimals a numbers para el mapper
    const quoteForMapper = {
      ...quote,
      subtotal: Number(quote.subtotal),
      vatAmount: Number(quote.vatAmount),
      total: Number(quote.total),
      totalBeforeDiscount: Number(quote.totalBeforeDiscount),
      discountTotal: Number(quote.discountTotal),
      globalDiscountPercent: quote.globalDiscountPercent ? Number(quote.globalDiscountPercent) : null,
      globalDiscountAmount: quote.globalDiscountAmount ? Number(quote.globalDiscountAmount) : null,
      lines: quote.lines.map((line) => ({
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
    };

    // Mapear datos al formato del PDF
    const pdfData = mapQuoteDataForPDF(quoteForMapper, company, await getLogoAsDataUri(companyId) ?? undefined);

    // Generar PDF
    const pdfBuffer = await generateQuotePDF(pdfData);

    // Generar nombre de archivo
    const fileName = getQuoteFileName(pdfData);

    // Log de generación
    logger.info('PDF de presupuesto generado', {
      data: {
        quoteId: quote.id,
        number: quote.number,
        companyId,
        userId,
      },
    });

    // Retornar PDF
    return new NextResponse(new Uint8Array(pdfBuffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${fileName}"`,
        'Content-Length': pdfBuffer.length.toString(),
      },
    });
  } catch (error) {
    logger.error('Error generando PDF de presupuesto', {
      data: { quoteId: id, error },
    });

    return NextResponse.json(
      { error: 'Error al generar el PDF' },
      { status: 500 }
    );
  }
}
