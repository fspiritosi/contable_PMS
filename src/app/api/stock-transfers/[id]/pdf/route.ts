import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { prisma } from '@/shared/lib/prisma';
import { getActiveCompanyId, getActiveCompany } from '@/shared/lib/company';
import { logger } from '@/shared/lib/logger';
import {
  generateStockTransferPDF,
  getStockTransferFileName,
} from '@/modules/commercial/features/warehouses/features/movements/shared/pdf';
import type { StockTransferPDFData } from '@/modules/commercial/features/warehouses/features/movements/shared/pdf';

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
    }

    const companyId = await getActiveCompanyId();
    if (!companyId) {
      return NextResponse.json({ error: 'No hay empresa activa' }, { status: 400 });
    }

    const [transfer, company] = await Promise.all([
      prisma.stockTransfer.findFirst({
        where: { id, companyId },
        include: {
          sourceWarehouse: { select: { code: true, name: true } },
          destinationWarehouse: { select: { code: true, name: true } },
          lines: {
            include: {
              product: { select: { code: true, name: true, unitOfMeasure: true } },
            },
          },
        },
      }),
      getActiveCompany(),
    ]);

    if (!transfer) {
      return NextResponse.json({ error: 'Transferencia no encontrada' }, { status: 404 });
    }

    if (!company) {
      return NextResponse.json({ error: 'Empresa no encontrada' }, { status: 400 });
    }

    const pdfData: StockTransferPDFData = {
      company: {
        name: company.name,
        taxId: company.taxId || '',
        address: company.address || '',
      },
      transfer: {
        transferNumber: transfer.transferNumber,
        date: transfer.date,
        notes: transfer.notes,
      },
      sourceWarehouse: transfer.sourceWarehouse,
      destinationWarehouse: transfer.destinationWarehouse,
      lines: transfer.lines.map((line) => ({
        productCode: line.product.code,
        productName: line.product.name,
        unit: line.product.unitOfMeasure || undefined,
        quantity: Number(line.quantity),
      })),
    };

    const pdfBuffer = await generateStockTransferPDF(pdfData);
    const fileName = getStockTransferFileName(pdfData);

    return new NextResponse(pdfBuffer, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${fileName}"`,
      },
    });
  } catch (error) {
    logger.error('Error al generar PDF de transferencia', {
      data: { error, transferId: id },
    });
    return NextResponse.json(
      { error: 'Error al generar el PDF' },
      { status: 500 }
    );
  }
}
