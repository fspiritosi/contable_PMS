// Reglas puras de los conceptos de movimientos (TSK-791).
// Sin Prisma client: solo tipos de los enums generados. Lo consumen Contabilidad y Comercial.
import type {
  AccountType,
  BankMovementType,
  ConceptAccountMode,
  ConceptUsage,
  FundMovementType,
} from '@/generated/prisma/enums';

// Las etiquetas BANK_* se copian de BANK_MOVEMENT_TYPE_LABELS porque ese archivo es de Comercial.
export const CONCEPT_USAGE_LABELS: Record<ConceptUsage, string> = {
  FUND_BANK_CHARGES: 'Gastos e impuestos bancarios',
  FUND_PARTNER_CONTRIBUTION: 'Aporte de socio',
  FUND_PARTNER_WITHDRAWAL: 'Retiro de socio',
  BANK_DEPOSIT: 'Depósito',
  BANK_WITHDRAWAL: 'Extracción',
  BANK_TRANSFER_IN: 'Transferencia Recibida',
  BANK_TRANSFER_OUT: 'Transferencia Enviada',
  BANK_CHECK: 'Cheque',
  BANK_DEBIT: 'Débito Automático',
  BANK_FEE: 'Comisión',
  BANK_INTEREST: 'Interés',
};

/** Usos agrupados por familia, para mostrarlos así en la pantalla de Contabilidad. */
export const CONCEPT_USAGE_GROUPS: { label: string; usages: ConceptUsage[] }[] = [
  {
    label: 'Movimientos de fondo',
    usages: ['FUND_BANK_CHARGES', 'FUND_PARTNER_CONTRIBUTION', 'FUND_PARTNER_WITHDRAWAL'],
  },
  {
    label: 'Movimientos bancarios',
    usages: [
      'BANK_DEPOSIT',
      'BANK_WITHDRAWAL',
      'BANK_TRANSFER_IN',
      'BANK_TRANSFER_OUT',
      'BANK_CHECK',
      'BANK_DEBIT',
      'BANK_FEE',
      'BANK_INTEREST',
    ],
  },
];

const FUND_USAGE_BY_TYPE: Record<FundMovementType, ConceptUsage | null> = {
  BANK_CHARGES: 'FUND_BANK_CHARGES',
  PARTNER_CONTRIBUTION: 'FUND_PARTNER_CONTRIBUTION',
  PARTNER_WITHDRAWAL: 'FUND_PARTNER_WITHDRAWAL',
  ACCOUNT_TRANSFER: null, // la transferencia entre cuentas nunca usa conceptos
};

const BANK_USAGE_BY_TYPE: Record<BankMovementType, ConceptUsage> = {
  DEPOSIT: 'BANK_DEPOSIT',
  WITHDRAWAL: 'BANK_WITHDRAWAL',
  TRANSFER_IN: 'BANK_TRANSFER_IN',
  TRANSFER_OUT: 'BANK_TRANSFER_OUT',
  CHECK: 'BANK_CHECK',
  DEBIT: 'BANK_DEBIT',
  FEE: 'BANK_FEE',
  INTEREST: 'BANK_INTEREST',
};

/** Uso de concepto de un tipo de movimiento de fondo; `null` si no admite conceptos. */
export function fundMovementUsage(type: FundMovementType): ConceptUsage | null {
  return FUND_USAGE_BY_TYPE[type];
}

/** Uso de concepto de un tipo de movimiento bancario. */
export function bankMovementUsage(type: BankMovementType): ConceptUsage {
  return BANK_USAGE_BY_TYPE[type];
}

/** Usos en los que el concepto puede tomar la cuenta del socio. */
export const PARTNER_USAGES: ConceptUsage[] = ['FUND_PARTNER_CONTRIBUTION', 'FUND_PARTNER_WITHDRAWAL'];

// Tipos de cuenta admitidos por uso (reglas existentes: TSK-579, TSK-717, ticket #376).
const ALLOWED_ACCOUNT_TYPES_BY_USAGE: Record<ConceptUsage, AccountType[]> = {
  FUND_BANK_CHARGES: ['EXPENSE', 'ASSET'],
  FUND_PARTNER_CONTRIBUTION: ['ASSET', 'LIABILITY', 'EQUITY'],
  FUND_PARTNER_WITHDRAWAL: ['ASSET', 'LIABILITY', 'EQUITY'],
  BANK_DEPOSIT: ['ASSET', 'LIABILITY', 'EQUITY'],
  BANK_WITHDRAWAL: ['ASSET', 'LIABILITY', 'EQUITY'],
  BANK_TRANSFER_IN: ['ASSET', 'LIABILITY', 'EQUITY'],
  BANK_TRANSFER_OUT: ['ASSET', 'LIABILITY', 'EQUITY'],
  BANK_CHECK: ['ASSET', 'LIABILITY', 'EQUITY'],
  BANK_DEBIT: ['ASSET', 'LIABILITY', 'EQUITY'],
  BANK_FEE: ['ASSET', 'LIABILITY', 'EQUITY'],
  BANK_INTEREST: ['ASSET', 'LIABILITY', 'EQUITY'],
};

/** Tipos de cuenta admitidos por TODOS los usos (intersección). Vacío si no hay usos. */
export function allowedAccountTypes(usages: ConceptUsage[]): AccountType[] {
  if (usages.length === 0) return [];
  const [first, ...rest] = usages.map((u) => ALLOWED_ACCOUNT_TYPES_BY_USAGE[u]);
  return first.filter((t) => rest.every((types) => types.includes(t)));
}

export type ConceptConfigError =
  | 'NAME_REQUIRED'
  | 'NO_USAGES'
  | 'PARTNER_MODE_NOT_ALLOWED'
  | 'ACCOUNT_REQUIRED'
  | 'NO_COMMON_ACCOUNT_TYPE';

export const CONCEPT_CONFIG_ERROR_MESSAGES: Record<ConceptConfigError, string> = {
  NAME_REQUIRED: 'El nombre del concepto es obligatorio.',
  NO_USAGES: 'Elegí al menos un uso para el concepto.',
  PARTNER_MODE_NOT_ALLOWED:
    'Usar la cuenta del socio solo se puede si el concepto aplica únicamente a Aporte y/o Retiro de socio.',
  ACCOUNT_REQUIRED: 'Elegí la cuenta contable del concepto.',
  NO_COMMON_ACCOUNT_TYPE: 'Los usos elegidos no tienen ningún tipo de cuenta contable en común.',
};

/** Valida la configuración de un concepto; devuelve el primer error o `null` si es válida. */
export function validateConceptConfig(input: {
  name: string;
  usages: ConceptUsage[];
  accountMode: ConceptAccountMode;
  accountId: string | null;
}): ConceptConfigError | null {
  if (!input.name.trim()) return 'NAME_REQUIRED';
  if (input.usages.length === 0) return 'NO_USAGES';
  if (allowedAccountTypes(input.usages).length === 0) return 'NO_COMMON_ACCOUNT_TYPE';
  if (input.accountMode === 'PARTNER_ACCOUNT') {
    return input.usages.every((u) => PARTNER_USAGES.includes(u)) ? null : 'PARTNER_MODE_NOT_ALLOWED';
  }
  return input.accountId ? null : 'ACCOUNT_REQUIRED';
}
