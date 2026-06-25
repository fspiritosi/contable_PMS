/**
 * Formateador de archivos SIRCAR para retenciones/percepciones IIBB provinciales.
 * Formato estándar SIRCAR (Comisión Arbitral) de longitud fija.
 */

function padRight(str: string, len: number): string {
  return str.substring(0, len).padEnd(len, ' ');
}

function padLeft(num: number | string, len: number, char: string = '0'): string {
  return String(num).padStart(len, char);
}

function formatAmount(amount: number, len: number): string {
  const cents = Math.round(Math.abs(amount) * 100);
  return padLeft(cents, len);
}

export interface SIRCARRecord {
  jurisdiccion: string;          // 3 chars (901=BA, 902=CABA, etc.)
  cuit: string;                  // 11 chars
  fechaRetencion: string;        // DDMMYYYY
  numeroSucursal: string;        // 4 chars
  numeroCertificado: string;     // 8 chars
  tipoComprobante: string;       // 1 char (R=Retención)
  letraComprobante: string;      // 1 char
  numeroComprobanteOrigen: string; // 20 chars
  importeRetenido: number;
}

export function formatSIRCARRecord(row: SIRCARRecord): string {
  return [
    padRight(row.jurisdiccion, 3),                  // Jurisdicción (3)
    padLeft(row.cuit.replace(/-/g, ''), 11),        // CUIT (11)
    row.fechaRetencion,                              // Fecha retención (8)
    padLeft(row.numeroSucursal, 4),                  // Nro sucursal (4)
    padLeft(row.numeroCertificado, 8),               // Nro certificado (8)
    padRight(row.tipoComprobante, 1),                // Tipo comprobante (1)
    padRight(row.letraComprobante, 1),               // Letra (1)
    padRight(row.numeroComprobanteOrigen, 20),       // Nro comprobante origen (20)
    formatAmount(row.importeRetenido, 11),           // Importe retenido (11)
  ].join('');
}
