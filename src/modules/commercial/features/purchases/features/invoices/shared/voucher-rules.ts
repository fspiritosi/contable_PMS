import type { SupplierTaxCondition, VoucherType } from '@/generated/prisma/enums';
import { supplierTaxConditionLabels } from '@/shared/utils/mappers';

import { VOUCHER_TYPE_LABELS } from './validators';

/**
 * Tipo de comprobante de compra según la condición IVA del proveedor (TSK-787).
 *
 * La letra la define quien emite: un Responsable Inscripto emite A (o B), y quien no discrimina IVA
 * (Monotributista, Exento, No Responsable, Consumidor Final) emite C. Cargar una C de un inscripto o
 * una A de un monotributista es un error de carga. Gastos Bancarios (resumen del banco) vale siempre.
 * Sin condición cargada no se restringe nada.
 */

type Letter = 'A' | 'B' | 'C';

const LETTERS_BY_CONDITION: Record<SupplierTaxCondition, Letter[]> = {
  RESPONSABLE_INSCRIPTO: ['A', 'B'],
  MONOTRIBUTISTA: ['C'],
  EXENTO: ['C'],
  NO_RESPONSABLE: ['C'],
  CONSUMIDOR_FINAL: ['C'],
};

const PURCHASE_VOUCHER_TYPES = Object.keys(VOUCHER_TYPE_LABELS) as VoucherType[];
const ALWAYS_ALLOWED: VoucherType[] = ['GASTOS_BANCARIOS'];

const letterOf = (voucherType: VoucherType): Letter | null => {
  const suffix = voucherType.slice(-2);
  return suffix === '_A' || suffix === '_B' || suffix === '_C' ? (suffix[1] as Letter) : null;
};

/** Tipos que puede cargar para ese proveedor, en el orden del selector. */
export function allowedPurchaseVoucherTypes(
  taxCondition: SupplierTaxCondition | null | undefined
): VoucherType[] {
  if (!taxCondition) return PURCHASE_VOUCHER_TYPES;
  const letters = LETTERS_BY_CONDITION[taxCondition];
  const byLetter = PURCHASE_VOUCHER_TYPES.filter((type) => {
    const letter = letterOf(type);
    return letter !== null && letters.includes(letter);
  });
  // Agrupado por clase (factura, NC, ND) como en el selector completo.
  const kindOrder = (type: VoucherType) =>
    type.startsWith('FACTURA') ? 0 : type.startsWith('NOTA_CREDITO') ? 1 : 2;
  return [...byLetter.sort((a, b) => kindOrder(a) - kindOrder(b)), ...ALWAYS_ALLOWED];
}

/** Motivo por el que el tipo no corresponde al proveedor, o `null` si corresponde. */
export function purchaseVoucherMismatchMessage(
  voucherType: VoucherType,
  taxCondition: SupplierTaxCondition | null | undefined
): string | null {
  if (!taxCondition || allowedPurchaseVoucherTypes(taxCondition).includes(voucherType)) return null;
  const condition = supplierTaxConditionLabels[taxCondition];
  if (taxCondition === 'RESPONSABLE_INSCRIPTO') {
    return `Un proveedor ${condition} emite comprobantes A o B, no C.`;
  }
  return `Un proveedor ${condition} emite comprobantes C: elegí Factura C, Nota de Crédito C o Nota de Débito C.`;
}

/** El mismo tipo de comprobante (factura, NC o ND) con la primera letra válida para el proveedor. */
export function equivalentPurchaseVoucher(
  voucherType: VoucherType,
  taxCondition: SupplierTaxCondition | null | undefined
): VoucherType {
  const allowed = allowedPurchaseVoucherTypes(taxCondition);
  if (allowed.includes(voucherType)) return voucherType;
  const kind = voucherType.slice(0, -2);
  return allowed.find((type) => type.startsWith(`${kind}_`)) ?? allowed[0];
}
