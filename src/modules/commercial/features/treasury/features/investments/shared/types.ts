import type { InvestmentHoldingStatus, InvestmentInstrumentType } from '@/generated/prisma/enums';

export const INSTRUMENT_TYPE_LABELS: Record<InvestmentInstrumentType, string> = {
  STOCK: 'Acciones',
  CEDEAR: 'CEDEARs',
  BOND: 'Bonos',
  OPTION: 'Opciones',
  LETTER: 'Letras',
  FUTURE: 'Futuros',
  TENDER: 'Licitaciones',
  CORPORATE_BOND: 'Obligaciones negociables',
  MUTUAL_FUND: 'Fondos comunes de inversión (FCI)',
  TRUST: 'Fideicomisos',
  REPO: 'Cauciones',
  FIXED_TERM: 'Plazo fijo',
};

/**
 * Atributos por tipo de instrumento: si se lleva en unidades (nominales) y si
 * tiene vencimiento.
 */
export const INSTRUMENT_TYPE_TRAITS: Record<
  InvestmentInstrumentType,
  { hasUnits: boolean; hasMaturity: boolean }
> = {
  STOCK: { hasUnits: true, hasMaturity: false },
  CEDEAR: { hasUnits: true, hasMaturity: false },
  BOND: { hasUnits: true, hasMaturity: true },
  OPTION: { hasUnits: true, hasMaturity: true },
  LETTER: { hasUnits: true, hasMaturity: true },
  FUTURE: { hasUnits: true, hasMaturity: true },
  TENDER: { hasUnits: true, hasMaturity: true },
  CORPORATE_BOND: { hasUnits: true, hasMaturity: true },
  MUTUAL_FUND: { hasUnits: false, hasMaturity: false },
  TRUST: { hasUnits: false, hasMaturity: false },
  REPO: { hasUnits: false, hasMaturity: true },
  FIXED_TERM: { hasUnits: false, hasMaturity: true },
};

export const HOLDING_STATUS_LABELS: Record<InvestmentHoldingStatus, string> = {
  OPEN: 'Abierta',
  CLOSED: 'Cerrada',
};
