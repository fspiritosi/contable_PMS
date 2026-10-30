/**
 * Archivos de las retenciones practicadas en las órdenes de pago del mes (TSK-813):
 * - IVA → SIRE F.2005; Seguridad Social → SIRE F.2004; Ganancias → SICORE.
 * - IIBB → SIRCAR, un archivo por jurisdicción (la declaración jurada se presenta por cada una).
 *
 * Una retención sin los datos que pide su archivo (régimen, base, jurisdicción, CUIT) no se
 * informa a medias: queda afuera y se lista en `incomplete` para completarla en la OP.
 */
import moment from 'moment';

import type { SupplierTaxCondition, WithholdingTaxType } from '@/generated/prisma/enums';
import { todayBusinessDay } from '@/shared/utils/business-day';

import { formatSIRCARRetencion } from '../iibb/formatters';
import { formatSICORERecord } from '../sicore/formatters';
import { formatSIREIvaRecord, formatSIRESussRecord, SIRE_IVA_REGIMES_WITH_CONDITION } from '../sire/formatters';

/** Tipo de comprobante "orden de pago" en las tablas de SIRE y SICORE. */
const PAYMENT_ORDER_VOUCHER = 6;
const GANANCIAS_TAX_CODE = '217';

export interface WithholdingForExport {
  taxType: WithholdingTaxType;
  rate: number;
  amount: number;
  certificateNumber: string | null;
  regimeCode: string | null;
  taxableBase: number | null;
  jurisdiction: string | null;
}

export interface PaymentOrderForExport {
  fullNumber: string;
  date: Date;
  totalAmount: number;
  supplier: { taxId: string | null; taxCondition: SupplierTaxCondition | null } | null;
  withholdings: WithholdingForExport[];
}

export interface WithholdingFile {
  content: string;
  registros: number;
}

export interface IncompleteWithholding {
  paymentOrder: string;
  taxType: WithholdingTaxType;
  missing: string[];
}

export interface WithholdingFiles {
  sireIva: WithholdingFile;
  sireSuss: WithholdingFile;
  sicore: WithholdingFile;
  sircar: Array<WithholdingFile & { jurisdiction: string }>;
  incomplete: IncompleteWithholding[];
}

/** Datos que pide cada archivo, además del importe. */
const REQUIRED: Record<WithholdingTaxType, Array<'regimeCode' | 'taxableBase' | 'jurisdiction'>> = {
  IVA: ['regimeCode', 'taxableBase'],
  GANANCIAS: ['regimeCode', 'taxableBase'],
  SUSS: ['regimeCode'],
  IIBB: ['jurisdiction', 'taxableBase'], // sin régimen va "001" (RG CA 2/2011)
};

const MISSING_LABELS = {
  regimeCode: 'régimen',
  taxableBase: 'base imponible',
  jurisdiction: 'jurisdicción',
} as const;

/** Fecha DD/MM/AAAA del día de Argentina, sin depender de la zona del proceso. */
const arcaDate = (date: Date) => moment(todayBusinessDay(date), 'YYYY-MM-DD').format('DD/MM/YYYY');

const toFile = (records: string[]): WithholdingFile => ({
  content: records.join('\r\n'),
  registros: records.length,
});

export function buildWithholdingFiles(
  orders: PaymentOrderForExport[],
  companyCuit: string | null
): WithholdingFiles {
  const sireIva: string[] = [];
  const sireSuss: string[] = [];
  const sicore: string[] = [];
  const sircar = new Map<string, string[]>();
  const incomplete: IncompleteWithholding[] = [];

  for (const order of orders) {
    const cuit = order.supplier?.taxId ?? null;
    const inscripto = order.supplier?.taxCondition === 'RESPONSABLE_INSCRIPTO';
    const date = arcaDate(order.date);

    for (const wh of order.withholdings) {
      const missing: string[] = REQUIRED[wh.taxType]
        .filter((key) => wh[key] === null || wh[key] === '')
        .map((key) => MISSING_LABELS[key]);
      if (!cuit) missing.push('CUIT del proveedor');
      if (wh.taxType === 'SUSS' && !companyCuit) missing.push('CUIT de la empresa');
      if (missing.length > 0) {
        incomplete.push({ paymentOrder: order.fullNumber, taxType: wh.taxType, missing });
        continue;
      }

      const common = {
        codigoTrazabilidad: order.fullNumber,
        regimen: wh.regimeCode ?? '',
        fechaRetencion: date,
        cuitRetenido: cuit as string,
        tipoComprobante: PAYMENT_ORDER_VOUCHER,
        fechaComprobante: date,
        numeroComprobante: order.fullNumber,
        importeComprobante: order.totalAmount,
        importeRetencion: wh.amount,
      };

      switch (wh.taxType) {
        case 'IVA':
          sireIva.push(
            formatSIREIvaRecord({
              ...common,
              condicion: SIRE_IVA_REGIMES_WITH_CONDITION.includes(common.regimen) ? (inscripto ? '1' : '2') : null,
              baseCalculo: wh.taxableBase as number,
            })
          );
          break;
        case 'SUSS':
          sireSuss.push(formatSIRESussRecord({ ...common, cuitAgente: companyCuit as string }));
          break;
        case 'GANANCIAS':
          sicore.push(
            formatSICORERecord({
              codigoComprobante: PAYMENT_ORDER_VOUCHER,
              fechaComprobante: date,
              numeroComprobante: order.fullNumber,
              importeComprobante: order.totalAmount,
              codigoImpuesto: GANANCIAS_TAX_CODE,
              regimen: common.regimen,
              baseCalculo: wh.taxableBase as number,
              fechaRetencion: date,
              // Inscripto en Ganancias: se toma de la condición frente al IVA del proveedor.
              condicion: inscripto ? 1 : 2,
              importeRetencion: wh.amount,
              cuitRetenido: common.cuitRetenido,
            })
          );
          break;
        case 'IIBB': {
          const jurisdiction = wh.jurisdiction as string;
          const records = sircar.get(jurisdiction) ?? [];
          records.push(
            formatSIRCARRetencion({
              renglon: records.length + 1,
              // El número del certificado emitido al proveedor; si no se cargó, el de la OP.
              numeroComprobante: /\d/.test(wh.certificateNumber ?? '') ? (wh.certificateNumber as string) : order.fullNumber,
              cuit: common.cuitRetenido,
              fechaRetencion: date,
              montoSujeto: wh.taxableBase as number,
              alicuota: wh.rate,
              montoRetenido: wh.amount,
              regimen: wh.regimeCode,
              jurisdiccion: jurisdiction,
            })
          );
          sircar.set(jurisdiction, records);
          break;
        }
      }
    }
  }

  return {
    sireIva: toFile(sireIva),
    sireSuss: toFile(sireSuss),
    sicore: toFile(sicore),
    sircar: [...sircar]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([jurisdiction, records]) => ({ jurisdiction, ...toFile(records) })),
    incomplete,
  };
}
