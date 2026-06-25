import type { LibroIVACabecera, LibroIVAAlicuota } from './types';

/**
 * Formateadores de texto según layout ARCA para Libro IVA Digital.
 *
 * Ventas cabecera: longitud fija de registro según RG 3685/4597
 * Compras cabecera: longitud fija según RG 3685/4597
 * Alícuotas: longitud fija por registro
 *
 * Los importes van sin punto decimal, con 2 decimales implícitos.
 * Los campos string se rellenan con espacios a la derecha.
 * Los campos numéricos se rellenan con ceros a la izquierda.
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

function formatSignedAmount(amount: number, len: number): string {
  const cents = Math.round(Math.abs(amount) * 100);
  return padLeft(cents, len);
}

// ============================================
// VENTAS — CABECERA
// ============================================

export function formatVentasCabecera(row: LibroIVACabecera): string {
  return [
    row.fechaComprobante,                         // 1-8 Fecha (8)
    padLeft(row.tipoComprobante, 3),              // 9-11 Tipo comprobante (3)
    padLeft(row.puntoVenta, 5),                   // 12-16 Punto de venta (5)
    padLeft(row.numeroDesde, 20),                 // 17-36 Nro desde (20)
    padLeft(row.numeroHasta, 20),                 // 37-56 Nro hasta (20)
    padLeft(row.codigoDocumento, 2),              // 57-58 Código documento (2)
    padLeft(row.numeroDocumento, 20),             // 59-78 Nro documento (20)
    padRight(row.denominacion, 30),               // 79-108 Denominación (30)
    formatAmount(row.importeTotal, 15),           // 109-123 Importe total (15)
    formatAmount(row.importeNoGravado, 15),       // 124-138 No gravado (15)
    formatAmount(row.importeExento, 15),          // 139-153 Exento (15)
    formatAmount(row.importePercepciones, 15),    // 154-168 Percepciones IVA (15)
    formatAmount(row.importeImpuestosInternos, 15), // 169-183 Imp internos (15)
    formatAmount(row.importeIVA, 15),             // 184-198 IVA (15)
    padRight(row.moneda, 3),                      // 199-201 Moneda (3)
    formatAmount(row.tipoCambio, 10),             // 202-211 Tipo de cambio (10)
    padLeft(row.cantidadAlicuotas, 1),            // 212 Cant alícuotas (1)
    padRight(row.codigoOperacion, 1),             // 213 Código operación (1)
    formatAmount(row.otrosTributos, 15),          // 214-228 Otros tributos (15)
    padLeft('', 8),                               // 229-236 Fecha vto pago (8)
  ].join('');
}

// ============================================
// COMPRAS — CABECERA
// ============================================

export function formatComprasCabecera(row: LibroIVACabecera): string {
  return [
    row.fechaComprobante,                         // Fecha (8)
    padLeft(row.tipoComprobante, 3),              // Tipo comprobante (3)
    padLeft(row.puntoVenta, 5),                   // Punto de venta (5)
    padLeft(row.numeroDesde, 20),                 // Nro desde (20)
    padLeft('', 16),                              // Despacho importación (16)
    padLeft(row.codigoDocumento, 2),              // Código documento (2)
    padLeft(row.numeroDocumento, 20),             // Nro documento (20)
    padRight(row.denominacion, 30),               // Denominación (30)
    formatAmount(row.importeTotal, 15),           // Importe total (15)
    formatAmount(row.importeNoGravado, 15),       // No gravado (15)
    formatAmount(row.importeExento, 15),          // Exento (15)
    formatAmount(row.importePercepciones, 15),    // Percepciones IVA (15)
    formatAmount(row.importeImpuestosInternos, 15), // Imp internos (15)
    formatAmount(row.importeIVA, 15),             // IVA (15)
    padRight(row.moneda, 3),                      // Moneda (3)
    formatAmount(row.tipoCambio, 10),             // Tipo de cambio (10)
    padLeft(row.cantidadAlicuotas, 1),            // Cant alícuotas (1)
    padRight(row.codigoOperacion, 1),             // Código operación (1)
    formatSignedAmount(row.importeCredFiscal, 15), // Crédito fiscal computable (15)
    formatAmount(row.otrosTributos, 15),          // Otros tributos (15)
    padLeft('', 11),                              // CUIT Emisor/Corredor (11)
    padRight('', 30),                             // Denominación Emisor/Corredor (30)
    formatAmount(row.importePercepcionesIIBB, 15), // Perc IIBB (15)
    formatAmount(row.importePercepcionesMunicipales, 15), // Perc municipales (15)
  ].join('');
}

// ============================================
// ALÍCUOTAS (ventas y compras)
// ============================================

export function formatAlicuota(row: LibroIVAAlicuota): string {
  return [
    padLeft(row.tipoComprobante, 3),              // Tipo comprobante (3)
    padLeft(row.puntoVenta, 5),                   // Punto de venta (5)
    padLeft(row.numero, 20),                      // Nro comprobante (20)
    formatAmount(row.importeNeto, 15),            // Importe neto (15)
    padLeft(row.alicuotaIVA, 4),                  // Alícuota IVA código (4)
    formatAmount(row.importeIVA, 15),             // Impuesto liquidado (15)
  ].join('');
}
