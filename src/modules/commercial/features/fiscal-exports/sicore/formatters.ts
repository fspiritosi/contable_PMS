/**
 * Archivo de importación de retenciones de SICORE (TSK-813): Ganancias (impuesto 217), que no pasó
 * a SIRE. Formato estándar del aplicativo, 144 posiciones para sujetos del país.
 *
 * El instructivo de SICORE define el orden de los campos, la fecha DD/MM/AAAA, la alineación
 * (texto a la izquierda con espacios, números a la derecha con ceros), el número de comprobante y
 * la CUIT sin separadores. Las posiciones salen de ese orden y de los ejemplos del instructivo.
 * Importes con punto decimal: el separador por defecto del aplicativo desde el Release 23.
 */
import { blank, decimal, digits, integer, text } from '../shared/fixed-width';

export interface SICORERecord {
  codigoComprobante: number;   // 6 = orden de pago
  fechaComprobante: string;    // DD/MM/AAAA
  numeroComprobante: string;   // se informan solo sus dígitos
  importeComprobante: number;
  codigoImpuesto: string;      // 217 = Ganancias
  regimen: string;
  baseCalculo: number;
  fechaRetencion: string;      // DD/MM/AAAA
  condicion: number;           // 1 Inscripto, 2 No inscripto
  importeRetencion: number;
  cuitRetenido: string;
}

export function formatSICORERecord(row: SICORERecord): string {
  return [
    integer(row.codigoComprobante, 2),              // 1 Código de comprobante (2)
    row.fechaComprobante,                           // 2 Fecha de emisión del comprobante (10)
    text(integer(digits(row.numeroComprobante), 12), 16), // 3 Nro de comprobante (16)
    decimal(row.importeComprobante, 16),            // 4 Importe del comprobante (16)
    integer(row.codigoImpuesto, 3),                 // 5 Código de impuesto (3)
    integer(row.regimen, 3),                        // 6 Código de régimen (3)
    '1',                                            // 7 Código de operación: retención (1)
    decimal(row.baseCalculo, 14),                   // 8 Base de cálculo (14)
    row.fechaRetencion,                             // 9 Fecha de emisión de la retención (10)
    integer(row.condicion, 2),                      // 10 Código de condición (2)
    '0',                                            // 11 Retención a sujetos suspendidos: no (1)
    decimal(row.importeRetencion, 14),              // 12 Importe de la retención (14)
    decimal(0, 6),                                  // 13 Porcentaje de exclusión (6)
    blank(10),                                      // 14 Fecha de emisión del boletín (10)
    '80',                                           // 15 Tipo de documento del retenido: CUIT (2)
    text(digits(row.cuitRetenido), 20),             // 16 Nro de documento del retenido (20)
    integer(0, 14),                                 // 17 Nro de certificado original (14)
  ].join('');
}
