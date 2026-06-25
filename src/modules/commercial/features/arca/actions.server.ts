'use server';

import { prisma } from '@/shared/lib/prisma';
import { logger } from '@/shared/lib/logger';
import { getActiveCompanyId } from '@/shared/lib/company';
import { checkPermission } from '@/shared/lib/permissions';
import { getTokenSign } from './services/wsaa.server';
import { feCompUltimoAutorizado, feCAESolicitar } from './services/wsfe.server';
import {
  type ArcaEnvironment,
  VOUCHER_TYPE_MAP,
  IVA_RATE_MAP,
  DOC_TIPO_MAP,
  formatAfipDate,
} from './services/utils';
import { revalidatePath } from 'next/cache';
import moment from 'moment';
import { isCreditNote } from '@/modules/commercial/shared/voucher-utils';

// ============================================
// SOLICITAR CAE
// ============================================

interface RequestCAEResult {
  success: boolean;
  cae?: string;
  caeExpiryDate?: Date;
  observations?: string[];
  errors?: string[];
}

export async function requestCAE(invoiceId: string): Promise<RequestCAEResult> {
  await checkPermission('commercial.sales-invoices', 'update', { redirect: true });

  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    const invoice = await prisma.salesInvoice.findUnique({
      where: { id: invoiceId },
      select: {
        id: true,
        voucherType: true,
        number: true,
        issueDate: true,
        dueDate: true,
        subtotal: true,
        netTaxed: true,
        netNonTaxed: true,
        netExempt: true,
        vatAmount: true,
        otherTaxes: true,
        total: true,
        cae: true,
        status: true,
        fullNumber: true,
        originalInvoiceId: true,
        originalInvoice: {
          select: {
            voucherType: true,
            number: true,
            issueDate: true,
            pointOfSale: { select: { number: true } },
          },
        },
        pointOfSale: {
          select: { number: true, afipEnabled: true },
        },
        customer: {
          select: { taxId: true, taxCondition: true },
        },
        lines: {
          select: {
            lineType: true,
            vatRate: true,
            vatAmount: true,
            subtotal: true,
          },
        },
        perceptions: {
          select: { type: true, rate: true, amount: true, jurisdiction: true },
        },
        company: {
          select: { taxId: true },
        },
      },
    });

    if (!invoice) throw new Error('Factura no encontrada');
    if (invoice.cae) throw new Error('La factura ya tiene CAE asignado');
    if (!invoice.pointOfSale.afipEnabled) throw new Error('El punto de venta no tiene AFIP habilitado');
    if (invoice.status !== 'CONFIRMED') throw new Error('La factura debe estar confirmada para solicitar CAE');

    // Determinar ambiente
    const credential = await prisma.arcaCredential.findFirst({
      where: { companyId },
      orderBy: { environment: 'desc' },
      select: { environment: true },
    });

    if (!credential) throw new Error('No hay credenciales ARCA configuradas');
    const environment = credential.environment as ArcaEnvironment;

    // Obtener token/sign
    const auth = await getTokenSign(companyId, environment);
    const cuit = invoice.company.taxId ?? '';

    const cbteTipo = VOUCHER_TYPE_MAP[invoice.voucherType];
    if (!cbteTipo) throw new Error(`Tipo de comprobante no mapeado: ${invoice.voucherType}`);

    // Verificar correlatividad
    const lastAuthorized = await feCompUltimoAutorizado(
      { ...auth, cuit },
      environment,
      invoice.pointOfSale.number,
      cbteTipo
    );

    if (invoice.number !== lastAuthorized + 1) {
      throw new Error(
        `Error de correlatividad: último autorizado es ${lastAuthorized}, ` +
        `se intenta autorizar ${invoice.number}`
      );
    }

    // Mapear IVA por alícuota
    const ivaByRate = new Map<number, { baseImp: number; importe: number }>();
    for (const line of invoice.lines) {
      if (line.lineType !== 'TAXED') continue;
      const rate = Number(line.vatRate);
      const existing = ivaByRate.get(rate) ?? { baseImp: 0, importe: 0 };
      existing.baseImp += Number(line.subtotal);
      existing.importe += Number(line.vatAmount);
      ivaByRate.set(rate, existing);
    }

    const ivaLines = Array.from(ivaByRate.entries()).map(([rate, amounts]) => ({
      id: IVA_RATE_MAP[rate] ?? 5,
      baseImp: amounts.baseImp,
      importe: amounts.importe,
    }));

    // Mapear percepciones como tributos
    const tributos = invoice.perceptions
      .filter((p) => Number(p.amount) > 0)
      .map((p) => {
        const tributeId = p.type === 'IIBB' ? 7 : 99;
        return {
          id: tributeId,
          desc: `Percepción ${p.type}${p.jurisdiction ? ` ${p.jurisdiction}` : ''}`,
          baseImp: Number(invoice.netTaxed),
          alic: Number(p.rate),
          importe: Number(p.amount),
        };
      });

    // Determinar tipo de documento del cliente
    const docTipo = invoice.customer.taxId
      ? (invoice.customer.taxId.length === 11 ? DOC_TIPO_MAP.CUIT : DOC_TIPO_MAP.DNI)
      : DOC_TIPO_MAP.SIN_IDENTIFICAR;
    const docNro = invoice.customer.taxId ?? '0';

    // Concepto: 1=Productos, 2=Servicios, 3=Ambos
    const concepto = 1;

    // Comprobantes asociados (para NC/ND)
    const isNC = isCreditNote(invoice.voucherType);
    const cbtesAsoc = isNC && invoice.originalInvoice
      ? [{
          tipo: VOUCHER_TYPE_MAP[invoice.originalInvoice.voucherType] ?? cbteTipo,
          ptoVta: invoice.originalInvoice.pointOfSale.number,
          nro: invoice.originalInvoice.number,
          cuit,
          cbteFch: formatAfipDate(invoice.originalInvoice.issueDate),
        }]
      : undefined;

    // Solicitar CAE
    const result = await feCAESolicitar(
      { ...auth, cuit },
      environment,
      {
        concepto,
        docTipo,
        docNro,
        cbteTipo,
        ptoVta: invoice.pointOfSale.number,
        cbteDesde: invoice.number,
        cbteHasta: invoice.number,
        cbteFch: formatAfipDate(invoice.issueDate),
        impTotal: Number(invoice.total),
        impTotConc: Number(invoice.netNonTaxed),
        impNeto: Number(invoice.netTaxed),
        impOpEx: Number(invoice.netExempt),
        impIVA: Number(invoice.vatAmount),
        impTrib: Number(invoice.otherTaxes),
        monId: 'PES',
        monCotiz: 1,
        ivaLines,
        tributos: tributos.length > 0 ? tributos : undefined,
        cbtesAsoc,
      }
    );

    // Guardar log en ArcaRequest
    await prisma.arcaRequest.create({
      data: {
        companyId,
        invoiceId,
        service: 'WSFEv1',
        method: 'FECAESolicitar',
        request: {
          ptoVta: invoice.pointOfSale.number,
          cbteTipo,
          cbteDesde: invoice.number,
          docTipo,
          docNro,
        },
        response: {
          resultado: result.resultado,
          cae: result.cae,
          caeFchVto: result.caeFchVto,
          observations: result.observations,
        },
        cae: result.cae,
        result: result.resultado === 'A' ? 'A' : 'R',
        observations: result.observations.join(' | ') || null,
      },
    });

    if (result.resultado === 'A' && result.cae) {
      // Actualizar factura con CAE
      const caeExpiryDate = result.caeFchVto
        ? moment(result.caeFchVto, 'YYYYMMDD').toDate()
        : undefined;

      await prisma.salesInvoice.update({
        where: { id: invoiceId },
        data: {
          cae: result.cae,
          caeExpiryDate,
        },
      });

      logger.info('CAE asignado a factura', {
        data: { companyId, invoiceId, cae: result.cae, fullNumber: invoice.fullNumber },
      });

      revalidatePath('/dashboard/company/commercial/sales/invoices');

      return {
        success: true,
        cae: result.cae,
        caeExpiryDate,
        observations: result.observations,
      };
    }

    logger.warn('CAE rechazado', {
      data: { companyId, invoiceId, observations: result.observations, errors: result.errors },
    });

    return {
      success: false,
      observations: result.observations,
      errors: result.errors,
    };
  } catch (error) {
    logger.error('Error al solicitar CAE', { data: { error, invoiceId, companyId } });

    // Guardar log del error
    await prisma.arcaRequest.create({
      data: {
        companyId: companyId!,
        invoiceId,
        service: 'WSFEv1',
        method: 'FECAESolicitar',
        request: { invoiceId },
        response: { error: error instanceof Error ? error.message : 'Error desconocido' },
        result: 'R',
        observations: error instanceof Error ? error.message : 'Error desconocido',
      },
    });

    throw error;
  }
}

// ============================================
// CONSULTAR ÚLTIMO COMPROBANTE AUTORIZADO
// ============================================

export async function getLastAuthorizedNumber(
  ptoVta: number,
  voucherType: string
): Promise<number> {
  await checkPermission('commercial.sales-invoices', 'view', { redirect: true });

  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    const credential = await prisma.arcaCredential.findFirst({
      where: { companyId },
      orderBy: { environment: 'desc' },
      select: { environment: true },
    });

    if (!credential) throw new Error('No hay credenciales ARCA configuradas');
    const environment = credential.environment as ArcaEnvironment;

    const auth = await getTokenSign(companyId, environment);

    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: { taxId: true },
    });

    const cuit = company?.taxId ?? '';
    const cbteTipo = VOUCHER_TYPE_MAP[voucherType];
    if (!cbteTipo) throw new Error(`Tipo de comprobante no mapeado: ${voucherType}`);

    return feCompUltimoAutorizado({ ...auth, cuit }, environment, ptoVta, cbteTipo);
  } catch (error) {
    logger.error('Error al consultar último autorizado', {
      data: { error, companyId, ptoVta, voucherType },
    });
    throw error;
  }
}

// ============================================
// LOG DE SOLICITUDES
// ============================================

export async function getArcaRequests(page: number = 1, pageSize: number = 50) {
  await checkPermission('commercial.sales-invoices', 'view', { redirect: true });

  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    const [requests, total] = await Promise.all([
      prisma.arcaRequest.findMany({
        where: { companyId },
        orderBy: { createdAt: 'desc' },
        take: pageSize,
        skip: (page - 1) * pageSize,
        select: {
          id: true,
          service: true,
          method: true,
          cae: true,
          result: true,
          observations: true,
          createdAt: true,
          salesInvoice: {
            select: { fullNumber: true },
          },
        },
      }),
      prisma.arcaRequest.count({ where: { companyId } }),
    ]);

    return {
      requests: requests.map((r) => ({
        id: r.id,
        service: r.service,
        method: r.method,
        cae: r.cae,
        result: r.result,
        observations: r.observations,
        createdAt: r.createdAt,
        invoiceNumber: r.salesInvoice?.fullNumber ?? null,
      })),
      total,
      pages: Math.ceil(total / pageSize),
    };
  } catch (error) {
    logger.error('Error al obtener solicitudes ARCA', { data: { error, companyId } });
    throw error;
  }
}
