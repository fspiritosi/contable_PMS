/**
 * Jurisdicciones del Convenio Multilateral con su código de la Comisión Arbitral (TSK-813). Es el
 * código que piden SIRCAR y SIFERE; la retención de IIBB de una orden de pago guarda el código.
 */
export const CONVENIO_MULTILATERAL_JURISDICTIONS = {
  '901': 'Ciudad Autónoma de Buenos Aires',
  '902': 'Buenos Aires',
  '903': 'Catamarca',
  '904': 'Córdoba',
  '905': 'Corrientes',
  '906': 'Chaco',
  '907': 'Chubut',
  '908': 'Entre Ríos',
  '909': 'Formosa',
  '910': 'Jujuy',
  '911': 'La Pampa',
  '912': 'La Rioja',
  '913': 'Mendoza',
  '914': 'Misiones',
  '915': 'Neuquén',
  '916': 'Río Negro',
  '917': 'Salta',
  '918': 'San Juan',
  '919': 'San Luis',
  '920': 'Santa Cruz',
  '921': 'Santa Fe',
  '922': 'Santiago del Estero',
  '923': 'Tierra del Fuego',
  '924': 'Tucumán',
} as const;

export type ConvenioMultilateralJurisdiction = keyof typeof CONVENIO_MULTILATERAL_JURISDICTIONS;

export const CONVENIO_MULTILATERAL_CODES = Object.keys(
  CONVENIO_MULTILATERAL_JURISDICTIONS
) as ConvenioMultilateralJurisdiction[];

export function jurisdictionLabel(code: string): string {
  return CONVENIO_MULTILATERAL_JURISDICTIONS[code as ConvenioMultilateralJurisdiction] ?? code;
}
