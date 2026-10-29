// Tipos para el Libro IVA Digital según formato ARCA/AFIP

export interface LibroIVACabecera {
  fechaComprobante: string;        // YYYYMMDD
  tipoComprobante: number;         // Código AFIP (1, 2, 3, 6, 7, 8, etc.)
  puntoVenta: number;              // 5 dígitos
  numeroDesde: number;             // 20 dígitos
  numeroHasta: number;             // 20 dígitos (solo ventas)
  codigoDocumento: number;         // 80=CUIT, 96=DNI, 99=Sin ident.
  numeroDocumento: string;         // CUIT/DNI sin guiones
  denominacion: string;            // Nombre/Razón Social (30 chars)
  importeTotal: number;
  importeNoGravado: number;
  importeExento: number;
  importePercepcionesIVA: number;  // Percepciones o pagos a cuenta de IVA
  importeImpuestosInternos: number;
  moneda: string;                  // PES, DOL, etc.
  tipoCambio: number;              // 4 enteros 6 decimales
  cantidadAlicuotas: number;       // 0 en compras B/C, que no discriminan IVA
  codigoOperacion: string;         // ' ' normal, 'E' exenta, 'N' no gravada
  importePercepcionesIIBB: number;
  importePercepcionesMunicipales: number;
  importeCredFiscal: number;       // Solo compras
  otrosTributos: number;
}

export interface LibroIVAAlicuota {
  tipoComprobante: number;
  puntoVenta: number;
  numero: number;
  importeNeto: number;
  alicuotaIVA: number;       // Código AFIP: 3=0%, 4=10.5%, 5=21%, 6=27%, 8=5%, 9=2.5%
  importeIVA: number;
}

/** Las alícuotas de compras identifican además al vendedor. */
export interface LibroIVACompraAlicuota extends LibroIVAAlicuota {
  codigoDocumento: number;
  numeroDocumento: string;
}

export interface LibroIVAResult {
  ventas: {
    cabecera: string;
    alicuotas: string;
    registros: number;
  };
  compras: {
    cabecera: string;
    alicuotas: string;
    registros: number;
  };
}
