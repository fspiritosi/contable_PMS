import type { LibroIVACabecera, LibroIVAAlicuota, LibroIVACompraAlicuota } from './types';

/**
 * Formateadores de texto según el diseño de registro de ARCA para el Libro IVA Digital
 * (RG 4597, Anexo I: https://www.afip.gob.ar/iva/documentos/libro-iva-digital-diseno-registros.pdf).
 *
 * Longitudes: ventas comprobantes 266, ventas alícuotas 62, compras comprobantes 325,
 * compras alícuotas 84. Hasta el TSK-796 los registros no seguían ese diseño (faltaban
 * campos y otros estaban corridos), así que ARCA los rechazaba.
 *
 * Los importes van sin punto decimal, con 2 decimales implícitos; el tipo de cambio,
 * con 6. Los campos alfanuméricos se rellenan con espacios a la derecha y los
 * numéricos con ceros a la izquierda.
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

/** Tipo de cambio: 4 enteros y 6 decimales sin punto (1 → "0001000000"). */
function formatExchangeRate(rate: number): string {
  return padLeft(Math.round(rate * 1_000_000), 10);
}

// ============================================
// VENTAS — CABECERA (LIBRO_IVA_DIGITAL_VENTAS_CBTE, 266)
// ============================================

export function formatVentasCabecera(row: LibroIVACabecera): string {
  return [
    row.fechaComprobante,                              // 1-8 Fecha (8)
    padLeft(row.tipoComprobante, 3),                   // 9-11 Tipo comprobante (3)
    padLeft(row.puntoVenta, 5),                        // 12-16 Punto de venta (5)
    padLeft(row.numeroDesde, 20),                      // 17-36 Nro comprobante (20)
    padLeft(row.numeroHasta, 20),                      // 37-56 Nro comprobante hasta (20)
    padLeft(row.codigoDocumento, 2),                   // 57-58 Código documento comprador (2)
    padLeft(row.numeroDocumento, 20),                  // 59-78 Nro identificación comprador (20)
    padRight(row.denominacion, 30),                    // 79-108 Denominación comprador (30)
    formatAmount(row.importeTotal, 15),                // 109-123 Importe total (15)
    formatAmount(row.importeNoGravado, 15),            // 124-138 No integran el neto gravado (15)
    formatAmount(0, 15),                               // 139-153 Percepción a no categorizados (15)
    formatAmount(row.importeExento, 15),               // 154-168 Operaciones exentas (15)
    formatAmount(row.importePercepcionesIVA, 15),      // 169-183 Percepciones imp. nacionales (15)
    formatAmount(row.importePercepcionesIIBB, 15),     // 184-198 Percepciones IIBB (15)
    formatAmount(row.importePercepcionesMunicipales, 15), // 199-213 Percepciones municipales (15)
    formatAmount(row.importeImpuestosInternos, 15),    // 214-228 Impuestos internos (15)
    padRight(row.moneda, 3),                           // 229-231 Moneda (3)
    formatExchangeRate(row.tipoCambio),                // 232-241 Tipo de cambio (10)
    padLeft(row.cantidadAlicuotas, 1),                 // 242 Cantidad alícuotas (1)
    padRight(row.codigoOperacion, 1),                  // 243 Código operación (1)
    formatAmount(row.otrosTributos, 15),               // 244-258 Otros tributos (15)
    padLeft('', 8),                                    // 259-266 Fecha vto. pago (8): solo servicios públicos
  ].join('');
}

// ============================================
// COMPRAS — CABECERA (LIBRO_IVA_DIGITAL_COMPRAS_CBTE, 325)
// ============================================

export function formatComprasCabecera(row: LibroIVACabecera): string {
  return [
    row.fechaComprobante,                              // 1-8 Fecha (8)
    padLeft(row.tipoComprobante, 3),                   // 9-11 Tipo comprobante (3)
    padLeft(row.puntoVenta, 5),                        // 12-16 Punto de venta (5)
    padLeft(row.numeroDesde, 20),                      // 17-36 Nro comprobante (20)
    padLeft('', 16),                                   // 37-52 Despacho de importación (16): ceros
    padLeft(row.codigoDocumento, 2),                   // 53-54 Código documento vendedor (2)
    padLeft(row.numeroDocumento, 20),                  // 55-74 Nro identificación vendedor (20)
    padRight(row.denominacion, 30),                    // 75-104 Denominación vendedor (30)
    formatAmount(row.importeTotal, 15),                // 105-119 Importe total (15)
    formatAmount(row.importeNoGravado, 15),            // 120-134 No integran el neto gravado (15)
    formatAmount(row.importeExento, 15),               // 135-149 Operaciones exentas (15)
    formatAmount(row.importePercepcionesIVA, 15),      // 150-164 Percepciones IVA (15)
    formatAmount(0, 15),                               // 165-179 Percepciones otros imp. nacionales (15)
    formatAmount(row.importePercepcionesIIBB, 15),     // 180-194 Percepciones IIBB (15)
    formatAmount(row.importePercepcionesMunicipales, 15), // 195-209 Percepciones municipales (15)
    formatAmount(row.importeImpuestosInternos, 15),    // 210-224 Impuestos internos (15)
    padRight(row.moneda, 3),                           // 225-227 Moneda (3)
    formatExchangeRate(row.tipoCambio),                // 228-237 Tipo de cambio (10)
    padLeft(row.cantidadAlicuotas, 1),                 // 238 Cantidad alícuotas (1)
    padRight(row.codigoOperacion, 1),                  // 239 Código operación (1)
    formatAmount(row.importeCredFiscal, 15),           // 240-254 Crédito fiscal computable (15)
    formatAmount(row.otrosTributos, 15),               // 255-269 Otros tributos (15)
    padLeft('', 11),                                   // 270-280 CUIT emisor/corredor (11): ceros
    padRight('', 30),                                  // 281-310 Denominación emisor/corredor (30)
    formatAmount(0, 15),                               // 311-325 IVA comisión (15)
  ].join('');
}

// ============================================
// ALÍCUOTAS
// ============================================

/** LIBRO_IVA_DIGITAL_VENTAS_ALICUOTAS (62). */
export function formatAlicuota(row: LibroIVAAlicuota): string {
  return [
    padLeft(row.tipoComprobante, 3),                   // 1-3 Tipo comprobante (3)
    padLeft(row.puntoVenta, 5),                        // 4-8 Punto de venta (5)
    padLeft(row.numero, 20),                           // 9-28 Nro comprobante (20)
    formatAmount(row.importeNeto, 15),                 // 29-43 Neto gravado (15)
    padLeft(row.alicuotaIVA, 4),                       // 44-47 Alícuota IVA código (4)
    formatAmount(row.importeIVA, 15),                  // 48-62 Impuesto liquidado (15)
  ].join('');
}

/** LIBRO_IVA_DIGITAL_COMPRAS_ALICUOTAS (84): agrega el documento del vendedor. */
export function formatComprasAlicuota(row: LibroIVACompraAlicuota): string {
  return [
    padLeft(row.tipoComprobante, 3),                   // 1-3 Tipo comprobante (3)
    padLeft(row.puntoVenta, 5),                        // 4-8 Punto de venta (5)
    padLeft(row.numero, 20),                           // 9-28 Nro comprobante (20)
    padLeft(row.codigoDocumento, 2),                   // 29-30 Código documento vendedor (2)
    padLeft(row.numeroDocumento, 20),                  // 31-50 Nro identificación vendedor (20)
    formatAmount(row.importeNeto, 15),                 // 51-65 Neto gravado (15)
    padLeft(row.alicuotaIVA, 4),                       // 66-69 Alícuota IVA código (4)
    formatAmount(row.importeIVA, 15),                  // 70-84 Impuesto liquidado (15)
  ].join('');
}
