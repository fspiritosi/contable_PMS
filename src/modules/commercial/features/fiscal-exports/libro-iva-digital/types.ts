// Tipos para el Libro IVA Digital según formato ARCA/AFIP

export interface LibroIVACabecera {
  fechaComprobante: string;        // YYYYMMDD
  tipoComprobante: number;         // Código AFIP (1, 2, 3, 6, 7, 8, etc.)
  puntoVenta: number;              // 5 dígitos
  numeroDesde: number;             // 20 dígitos
  numeroHasta: number;             // 20 dígitos
  codigoDocumento: number;         // 80=CUIT, 96=DNI, 99=Sin ident.
  numeroDocumento: string;         // CUIT/DNI sin guiones
  denominacion: string;            // Nombre/Razón Social (30 chars)
  importeTotal: number;
  importeNoGravado: number;
  importeExento: number;
  importePercepciones: number;
  importeImpuestosInternos: number;
  importeIVA: number;
  moneda: string;                  // PES, DOL, etc.
  tipoCambio: number;
  cantidadAlicuotas: number;
  codigoOperacion: string;         // ' '=normal, 'X'=exportación
  importePercepcionesIIBB: number;
  importePercepcionesMunicipales: number;
  importeCredFiscal: number;       // Para compras
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
