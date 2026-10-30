/**
 * Archivos de SIRE para la emisión de certificados por lote (TSK-813), según la "Especificación de
 * archivo para emisión por lote" de ARCA (versión del 11/07/2022):
 * - F.2005, retenciones de IVA (impuesto 216): 305 posiciones.
 * - F.2004, retenciones de Seguridad Social (impuesto 353): 191 posiciones.
 * Las retenciones de Ganancias siguen en SICORE (`../sicore/formatters.ts`).
 *
 * Fechas DD/MM/AAAA; importes con dos decimales y punto; campos no obligatorios en blanco.
 */
import { blank, decimal, digits, integer, text } from '../shared/fixed-width';

interface SIRECommonRecord {
  codigoTrazabilidad: string;  // uso no fiscal: el número de la OP
  regimen: string;             // tabla REGIMEN del impuesto
  fechaRetencion: string;      // DD/MM/AAAA
  cuitRetenido: string;
  tipoComprobante: number;     // tabla TIPO_COMPROBANTE (6 = orden de pago)
  fechaComprobante: string;    // DD/MM/AAAA, anterior o igual a la de la retención
  numeroComprobante: string;   // formato según el tipo: X(12) para la orden de pago
  importeComprobante: number;
  importeRetencion: number;
}

export interface SIREIvaRecord extends SIRECommonRecord {
  /** 1 Inscripto, 2 No inscripto. Solo para los regímenes de la tabla REGIMEN_CONDICION (831). */
  condicion: '1' | '2' | null;
  baseCalculo: number;
}

export interface SIRESussRecord extends SIRECommonRecord {
  cuitAgente: string;
}

/** Regímenes de IVA que piden la condición del retenido (tabla REGIMEN_CONDICION). */
export const SIRE_IVA_REGIMES_WITH_CONDITION = ['831'];

export function formatSIREIvaRecord(row: SIREIvaRecord): string {
  return [
    '0100',                                         // 1 Versión (4)
    text(row.codigoTrazabilidad, 36),               // 2 Código de trazabilidad (36)
    '216',                                          // 3 Impuesto (3)
    integer(row.regimen, 3),                        // 4 Régimen (3)
    row.fechaRetencion,                             // 5 Fecha retención (10)
    row.condicion ? integer(row.condicion, 2) : blank(2), // 6 Condición (2)
    '0',                                            // 7 Imposibilidad de retención: efectuada (1)
    blank(30),                                      // 8 Motivo de no retención (30)
    decimal(row.importeRetencion, 14),              // 9 Importe retención (14)
    decimal(row.baseCalculo, 14),                   // 10 Base de cálculo (14)
    '0',                                            // 11 Régimen de exclusión: no (1)
    blank(6),                                       // 12 Porcentaje de exclusión (6)
    blank(10),                                      // 13 Fecha de publicación de la exclusión (10)
    integer(row.tipoComprobante, 2),                // 14 Tipo comprobante (2)
    row.fechaComprobante,                           // 15 Fecha comprobante (10)
    text(row.numeroComprobante, 16),                // 16 Nro comprobante (16)
    blank(12),                                      // 17 COE (12)
    blank(12),                                      // 18 COE original (12)
    blank(14),                                      // 19 CAE (14)
    decimal(row.importeComprobante, 14),            // 20 Importe comprobante (14)
    blank(30),                                      // 21 Motivo de la nota de crédito (30)
    integer(digits(row.cuitRetenido), 11),          // 22 Retenido clave (11)
    blank(25),                                      // 23 Certificado original nro (25)
    blank(10),                                      // 24 Certificado original fecha (10)
    blank(14),                                      // 25 Certificado original importe (14)
    blank(1),                                       // 26 Motivo de la anulación (1)
  ].join('');
}

export function formatSIRESussRecord(row: SIRESussRecord): string {
  return [
    '2004',                                         // 1 Formulario (4)
    '0100',                                         // 2 Versión (4)
    text(row.codigoTrazabilidad, 10),               // 3 Código de trazabilidad (10)
    integer(digits(row.cuitAgente), 11),            // 4 CUIT agente (11)
    '353',                                          // 5 Impuesto (3)
    integer(row.regimen, 3),                        // 6 Régimen (3)
    integer(digits(row.cuitRetenido), 11),          // 7 CUIT retenido (11)
    row.fechaRetencion,                             // 8 Fecha retención (10)
    integer(row.tipoComprobante, 2),                // 9 Tipo comprobante (2)
    row.fechaComprobante,                           // 10 Fecha comprobante (10)
    text(row.numeroComprobante, 16),                // 11 Nro comprobante (16)
    decimal(row.importeComprobante, 14),            // 12 Importe comprobante (14)
    decimal(row.importeRetencion, 14),              // 13 Importe retención (14)
    blank(25),                                      // 14 Certificado original nro (25)
    blank(10),                                      // 15 Certificado original fecha (10)
    blank(14),                                      // 16 Certificado original importe (14)
    blank(30),                                      // 17 Otros datos (30)
  ].join('');
}
