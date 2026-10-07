import moment from 'moment';

import type { FundMovementStatus } from '@/generated/prisma/enums';
import type { ModulePermissions } from '@/shared/lib/permissions';

import type { FundMovementListItem, FundMovementRecord, FundOption } from '../list/actions.server';
import {
  formatFundMovementDate,
  type FundMovementFormInput,
  type FundMovementTypeValue,
  type FundSourceKind,
} from './validators';

/*
 * Lógica pura del modal de Movimientos de Fondos y de las acciones por fila
 * (TSK-720a / TSK-726). Sin React ni runtime del servidor: los imports de
 * `actions.server` son solo de tipos y se borran al compilar.
 */

// ---------------------------------------------------------------- modos
export type FundMovementModalMode = 'create' | 'edit' | 'view';
/** Modos que trabajan sobre un movimiento existente (instancia única de la tabla, D8). */
export type FundMovementDetailMode = Exclude<FundMovementModalMode, 'create'>;

// ---------------------------------------------------------------- estado
export const FUND_MOVEMENT_STATUS_LABELS: Record<FundMovementStatus, string> = {
  DRAFT: 'Borrador',
  CONFIRMED: 'Confirmado',
  CANCELLED: 'Anulado',
};

export type FundMovementStatusBadgeVariant = 'default' | 'outline' | 'secondary';

const STATUS_VARIANTS: Record<FundMovementStatus, FundMovementStatusBadgeVariant> = {
  CONFIRMED: 'default',
  DRAFT: 'outline',
  CANCELLED: 'secondary',
};

/** CONFIRMED → 'default', DRAFT → 'outline', CANCELLED → 'secondary'. */
export function fundMovementStatusVariant(status: FundMovementStatus): FundMovementStatusBadgeVariant {
  return STATUS_VARIANTS[status];
}

// ---------------------------------------------------------------- acciones por fila (D9)
export type RowActionPermissions = Pick<ModulePermissions, 'canView' | 'canUpdate' | 'canDelete'>;

export interface FundMovementRowActions {
  view: boolean;
  confirm: boolean;
  edit: boolean;
  delete: boolean;
}

export function getRowActions(
  status: FundMovementStatus,
  permissions: RowActionPermissions
): FundMovementRowActions {
  const isDraft = status === 'DRAFT';
  return {
    view: permissions.canView,
    confirm: isDraft && permissions.canUpdate,
    edit: isDraft && permissions.canUpdate,
    delete: isDraft && permissions.canDelete,
  };
}

/** Visibilidad de la columna de acciones: canView || canUpdate || canDelete. */
export function hasAnyRowAction(permissions: RowActionPermissions): boolean {
  return permissions.canView || permissions.canUpdate || permissions.canDelete;
}

/** confirm || edit || delete — decide el separador después de "Ver". */
export function hasDraftActions(actions: FundMovementRowActions): boolean {
  return actions.confirm || actions.edit || actions.delete;
}

// ---------------------------------------------------------------- opciones con snapshot (D4)
export interface SelectOptionLike {
  value: string;
  label: string;
}
export interface SnapshotOption extends SelectOptionLike {
  isSnapshot: true;
}
export interface FundSelectOption extends SelectOptionLike {
  group: FundSourceKind;
}

/** Bancos primero (`BANK:<id>`), cajas después (`CASH:<id>`), en el orden recibido. */
export function buildFundOptions(
  banks: readonly FundOption[],
  cashRegisters: readonly FundOption[]
): FundSelectOption[] {
  return [
    ...banks.map((b) => ({ value: `BANK:${b.id}`, label: b.label, group: 'BANK' as const })),
    ...cashRegisters.map((c) => ({ value: `CASH:${c.id}`, label: c.label, group: 'CASH' as const })),
  ];
}

/**
 * Si `value` no está vacío, no está entre las opciones y hay `snapshotLabel` no vacío,
 * devuelve una copia con `{ value, label: snapshotLabel, isSnapshot: true }` al final.
 * En cualquier otro caso devuelve la misma referencia `options` (sin copiar ni mutar).
 */
export function withSnapshotOption<T extends SelectOptionLike>(
  options: readonly T[],
  value: string | null | undefined,
  snapshotLabel: string | null | undefined
): ReadonlyArray<T | SnapshotOption> {
  if (!value || !snapshotLabel) return options;
  if (options.some((option) => option.value === value)) return options;
  return [...options, { value, label: snapshotLabel, isSnapshot: true }];
}

export function isSnapshotOption(option: SelectOptionLike): option is SnapshotOption {
  return 'isSnapshot' in option && option.isSnapshot === true;
}

// ---------------------------------------------------------------- valores del formulario
export function fundRefFrom(kind: string | null, id: string | null): string {
  return kind && id ? `${kind}:${id}` : '';
}

/** Valores vacíos del alta. `today` se inyecta para testear. */
export function emptyFundMovementFormValues(today?: string): FundMovementFormInput {
  return {
    type: 'PARTNER_CONTRIBUTION',
    date: today ?? moment().format('YYYY-MM-DD'),
    amount: '',
    description: '',
    sourceFund: '',
    destinationFund: '',
    partnerId: '',
    lines: [],
  };
}

export type FundMovementFormSource = Pick<
  FundMovementListItem,
  | 'type'
  | 'date'
  | 'amount'
  | 'description'
  | 'fundOutKind'
  | 'fundOutId'
  | 'fundInKind'
  | 'fundInId'
  | 'partnerId'
>;
export type FundMovementLineSource = Pick<
  FundMovementRecord['lines'][number],
  'accountId' | 'description' | 'amount'
>;

/**
 * Valores del formulario a partir de un movimiento guardado. Los conceptos solo
 * se cargan para BANK_CHARGES y si ya llegaron (`lines` no null/undefined).
 */
export function formValuesFromMovement(
  movement: FundMovementFormSource,
  lines: readonly FundMovementLineSource[] | null | undefined
): FundMovementFormInput {
  const type: FundMovementTypeValue = movement.type;
  return {
    type,
    // UTC: la fecha se guarda anclada a mediodía UTC, leerla en local la corría un día (TSK-483)
    date: formatFundMovementDate(movement.date, 'YYYY-MM-DD'),
    amount: String(movement.amount),
    description: movement.description,
    sourceFund: fundRefFrom(movement.fundOutKind, movement.fundOutId),
    destinationFund: fundRefFrom(movement.fundInKind, movement.fundInId),
    partnerId: movement.partnerId ?? '',
    lines:
      type === 'BANK_CHARGES' && lines
        ? lines.map((line) => ({
            accountId: line.accountId,
            description: line.description,
            amount: String(line.amount),
          }))
        : [],
  };
}

// ---------------------------------------------------------------- textos (D6)
export interface FundMovementModalCopy {
  title: string;
  description: string;
}

const EDITABLE_DESCRIPTION =
  'Se guarda como borrador editable. Al confirmarlo, actualiza el saldo del banco/caja y genera el asiento contable.';

const VIEW_DESCRIPTIONS: Record<FundMovementStatus, string> = {
  DRAFT: 'Borrador: todavía no movió saldos ni generó asiento.',
  CONFIRMED: 'Confirmado: ya actualizó el saldo del banco/caja y generó su asiento.',
  CANCELLED: 'Anulado: el movimiento quedó sin efecto.',
};

export function getModalCopy(
  mode: FundMovementModalMode,
  status?: FundMovementStatus | null
): FundMovementModalCopy {
  if (mode === 'create') return { title: 'Nuevo Movimiento de Fondos', description: EDITABLE_DESCRIPTION };
  if (mode === 'edit') return { title: 'Editar Movimiento de Fondos', description: EDITABLE_DESCRIPTION };
  return {
    title: 'Movimiento de Fondos',
    description: status ? VIEW_DESCRIPTIONS[status] : 'Consulta de solo lectura.',
  };
}

// ---------------------------------------------------------------- guardas del hook
/** En vista no se limpian campos al cambiar el tipo (riesgo 6). */
export function shouldCleanupFieldsOnTypeChange(mode: FundMovementModalMode): boolean {
  return mode !== 'view';
}

/** Los conceptos solo se piden al editar o ver un BANK_CHARGES. */
export function needsMovementDetail(
  mode: FundMovementModalMode,
  type: FundMovementTypeValue | null | undefined
): boolean {
  return mode !== 'create' && type === 'BANK_CHARGES';
}

/** Clave de `appliedDetailRef`: create → 'new'; edit/view → `${mode}:${movementId}` (riesgo 7). */
export function formResetKey(mode: FundMovementModalMode, movementId: string | null | undefined): string {
  return mode === 'create' ? 'new' : `${mode}:${movementId ?? ''}`;
}

// ---------------------------------------------------------------- resumen de vista (D3)
export interface ViewSummaryFact {
  key: 'confirmedAt' | 'journalEntry';
  label: string;
  value: string;
}

/** Solo los hechos presentes, en orden. El estado va aparte (badge). */
export function getViewSummaryFacts(
  movement: Pick<FundMovementListItem, 'confirmedAt' | 'journalEntryNumber'>
): ViewSummaryFact[] {
  const facts: ViewSummaryFact[] = [];
  if (movement.confirmedAt != null) {
    // Timestamp real: se muestra en hora local (a diferencia de `date`, anclada a mediodía UTC).
    facts.push({
      key: 'confirmedAt',
      label: 'Confirmado el',
      value: moment(movement.confirmedAt).format('DD/MM/YYYY HH:mm'),
    });
  }
  if (movement.journalEntryNumber != null) {
    facts.push({ key: 'journalEntry', label: 'Asiento N°', value: String(movement.journalEntryNumber) });
  }
  return facts;
}
