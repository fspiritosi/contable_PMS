/**
 * Archivo de retenciones de IIBB para SIRCAR (TSK-813), según el Anexo II de la RG 2/2011 de la
 * Comisión Arbitral: un registro por retención, once campos separados por comas. Fechas
 * dd/mm/aaaa; importes y alícuota con punto decimal y sin separador de miles. La declaración
 * jurada se presenta por jurisdicción: cada archivo lleva una sola.
 */
import { digits, integer } from '../shared/fixed-width';

export interface SIRCARRetencion {
  renglon: number;               // único por archivo
  numeroComprobante: string;     // se informan solo sus dígitos
  cuit: string;
  fechaRetencion: string;        // dd/mm/aaaa
  montoSujeto: number;
  alicuota: number;
  montoRetenido: number;
  regimen: string | null;        // tabla de la jurisdicción
  jurisdiccion: string;          // código del Convenio Multilateral (901-924)
}

/** Régimen a informar cuando la jurisdicción no definió ninguno. */
const NO_REGIME = '001';

export function formatSIRCARRetencion(row: SIRCARRetencion): string {
  return [
    integer(row.renglon, 5),                         // 1 Número de renglón
    '1',                                             // 2 Origen: software propio del agente
    '1',                                             // 3 Tipo: comprobante de retención
    integer(digits(row.numeroComprobante), 12),      // 4 Número de comprobante
    integer(digits(row.cuit), 11),                   // 5 CUIT del retenido
    row.fechaRetencion,                              // 6 Fecha de retención
    row.montoSujeto.toFixed(2),                      // 7 Monto sujeto a retención
    row.alicuota.toFixed(2),                         // 8 Alícuota
    row.montoRetenido.toFixed(2),                    // 9 Monto retenido
    row.regimen ? integer(row.regimen, 3) : NO_REGIME, // 10 Tipo de régimen
    integer(row.jurisdiccion, 3),                    // 11 Jurisdicción
  ].join(',');
}
