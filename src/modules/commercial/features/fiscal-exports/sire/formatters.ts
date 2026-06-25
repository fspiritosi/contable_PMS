/**
 * Formateador de archivos SIRE (ex SICORE) para retenciones nacionales.
 * Formato de longitud fija según RG 2233/3726 AFIP.
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

export interface SIRERecord {
  codigoComprobante: string;       // 2 chars (01=Factura, 02=NC, etc.)
  fechaEmision: string;            // DDMMYYYY
  numeroComprobante: string;       // 16 chars
  importeComprobante: number;
  codigoImpuesto: string;          // 3 chars (217=IVA, 218=Ganancias)
  codigoRegimen: string;           // 3 chars
  codigoOperacion: string;         // 1 char (1=Retención)
  baseImponible: number;
  fechaEmisionRetencion: string;   // DDMMYYYY
  codigoCondicion: string;         // 2 chars (01=Inscripto, 02=No inscripto)
  retencionPracticada: number;     // Monto no sujeto
  alicuota: number;
  montoRetenido: number;
  montoExcedente: number;
  certificadoNumero: string;       // Nro certificado si ya se emitió
  fechaRetencion: string;          // DDMMYYYY
  tipoDocRetenido: string;         // 80=CUIT
  nroDocRetenido: string;          // CUIT sin guiones
}

export function formatSIRERecord(row: SIRERecord): string {
  return [
    padRight(row.codigoComprobante, 2),            // Código comprobante (2)
    row.fechaEmision,                               // Fecha emisión (8)
    padRight(row.numeroComprobante, 16),            // Nro comprobante (16)
    formatAmount(row.importeComprobante, 16),       // Importe comprobante (16)
    padRight(row.codigoImpuesto, 3),                // Código impuesto (3)
    padRight(row.codigoRegimen, 3),                 // Código régimen (3)
    padRight(row.codigoOperacion, 1),               // Código operación (1)
    formatAmount(row.baseImponible, 14),            // Base imponible (14)
    row.fechaEmisionRetencion,                      // Fecha emisión retención (8)
    padRight(row.codigoCondicion, 2),               // Código condición (2)
    formatAmount(row.retencionPracticada, 14),      // Retención practicada - monto no sujeto (14)
    formatAmount(row.alicuota, 5),                  // Alícuota (5, con 2 decimales)
    formatAmount(row.montoRetenido, 14),            // Monto retenido (14)
    formatAmount(row.montoExcedente, 14),           // Monto excedente (14)
    padRight(row.certificadoNumero, 14),            // Nro certificado original (14)
    row.fechaRetencion,                             // Fecha retención (8)
    padRight(row.tipoDocRetenido, 2),               // Tipo doc retenido (2)
    padRight(row.nroDocRetenido, 20),               // Nro doc retenido (20)
  ].join('');
}
