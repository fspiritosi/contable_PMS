/**
 * Cuenta contable de cada línea de factura (TSK-721 / TSK-724).
 *
 * La cuenta la define el ÍTEM (`defaultIncomeAccountId` en ventas,
 * `defaultExpenseAccountId` en compras). La "Cuenta de ventas/compras por
 * defecto" de Ajustes contables es un RESPALDO para los ítems que no tienen la
 * suya y para las líneas de compra sin ítem. Si no hay ninguna, la factura no
 * se confirma y el mensaje nombra la línea: nunca se imputa en silencio.
 *
 * Funciones puras, compartidas por `confirmInvoice`, `confirmPurchaseInvoice`
 * (pre-validación antes de la transacción, patrón `perceptions.ts:179-193`) y
 * por el asiento (`accounting/features/integrations/commercial/index.ts`,
 * defensa en profundidad).
 */

/** Qué cuenta del ítem se está resolviendo: ingresos (ventas) o egresos (compras). */
export type LineAccountKind = 'income' | 'expense';

/**
 * Una línea de factura vista desde la resolución de su cuenta contable.
 * `productName === null` = línea sin ítem (solo posible en compras: gastos no
 * inventariables y comprobantes importados de AFIP).
 */
export interface LineAccountCheck {
  description: string;
  productName: string | null;
  /** `defaultIncomeAccountId` o `defaultExpenseAccountId` del ítem, según `kind`. */
  itemAccountId: string | null | undefined;
}

/** Una línea cuya cuenta efectiva existe pero hoy no es imputable. */
export interface UnavailableLineAccount<T extends LineAccountCheck> {
  line: T;
  accountId: string;
  /** De dónde salió la cuenta: del ítem o de la "Cuenta de … por defecto". */
  source: 'item' | 'default';
}

/** Lo que necesita el mensaje de "cuenta no disponible": ya con la cuenta formateada. */
export interface UnavailableLineAccountLabel {
  description: string;
  /** `code - name` de la cuenta que falla. */
  accountLabel: string;
  source: 'item' | 'default';
}

/** Cómo se llaman en pantalla el campo del ítem y el ajuste contable, según `kind`. */
const KIND_LABELS: Record<LineAccountKind, { itemField: string; settingLabel: string }> = {
  income: { itemField: 'Cuenta de Ingresos', settingLabel: 'Cuenta de ventas por defecto' },
  expense: { itemField: 'Cuenta de Egresos', settingLabel: 'Cuenta de compras por defecto' },
};

/** `code - name`, como lo muestran los combos y los avisos. */
export function formatAccountLabel(account: { code: string; name: string }): string {
  return `${account.code} - ${account.name}`;
}

/**
 * Cuenta efectiva de la línea: la del ítem, o la por defecto, o ninguna.
 * Usa `||` a propósito: una cadena vacía cuenta como "sin cuenta".
 */
export function resolveLineAccount(
  itemAccountId: string | null | undefined,
  defaultAccountId: string | null | undefined
): string | null {
  return itemAccountId || defaultAccountId || null;
}

/** Líneas que no resuelven ninguna cuenta. Conserva orden y objeto original. */
export function findLinesMissingAccount<T extends LineAccountCheck>(
  lines: T[],
  defaultAccountId: string | null | undefined
): T[] {
  return lines.filter((line) => resolveLineAccount(line.itemAccountId, defaultAccountId) === null);
}

/** «descripción», más "(sin ítem)" cuando la línea no tiene ítem. */
function lineLabel(line: LineAccountCheck): string {
  return line.productName === null ? `«${line.description}» (sin ítem)` : `«${line.description}»`;
}

/** Aviso al confirmar: qué líneas no tienen cuenta y dónde se arregla. */
export function buildMissingLineAccountsMessage(
  missing: LineAccountCheck[],
  kind: LineAccountKind
): string {
  const { itemField, settingLabel } = KIND_LABELS[kind];
  const plural = missing.length !== 1;
  const sujeto = plural ? 'las líneas' : 'la línea';
  const verbo = plural ? 'tienen' : 'tiene';
  const nombres = missing.map(lineLabel).join(', ');
  const sinItem = missing.some((l) => l.productName === null)
    ? ' Las líneas sin ítem solo pueden usar la cuenta por defecto.'
    : '';

  return (
    `No se puede confirmar el comprobante: ${sujeto} ${nombres} no ${verbo} cuenta contable. ` +
    `Asignale una ${itemField} al ítem (Ítems → Imputación contable) o configurá la ` +
    `"${settingLabel}" en Contabilidad → Configuración.${sinItem}`
  );
}

/**
 * Líneas cuya cuenta efectiva NO está entre las imputables hoy. Las que no
 * tienen ninguna cuenta no aparecen acá: son de `findLinesMissingAccount`.
 */
export function findLinesWithUnavailableAccount<T extends LineAccountCheck>(
  lines: T[],
  defaultAccountId: string | null | undefined,
  availableIds: Set<string>
): UnavailableLineAccount<T>[] {
  const result: UnavailableLineAccount<T>[] = [];

  for (const line of lines) {
    const accountId = resolveLineAccount(line.itemAccountId, defaultAccountId);
    if (accountId === null || availableIds.has(accountId)) continue;

    result.push({ line, accountId, source: line.itemAccountId ? 'item' : 'default' });
  }

  return result;
}

/** Una oración por línea, unidas con espacio. Se listan todas aunque la primera alcance. */
export function buildUnavailableLineAccountsMessage(
  items: UnavailableLineAccountLabel[],
  kind: LineAccountKind
): string {
  const { settingLabel } = KIND_LABELS[kind];

  return items
    .map((item) =>
      item.source === 'item'
        ? `No se puede confirmar el comprobante: la cuenta ${item.accountLabel} del ítem de la línea ` +
          `«${item.description}» no está activa o no es imputable. Corregila en Ítems → Imputación contable.`
        : `No se puede confirmar el comprobante: la cuenta ${item.accountLabel} configurada como ` +
          `"${settingLabel}" no está activa o no es imputable. Corregila en Contabilidad → Configuración.`
    )
    .join(' ');
}
