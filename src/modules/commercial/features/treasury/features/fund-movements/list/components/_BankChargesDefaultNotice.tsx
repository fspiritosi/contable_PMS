'use client';

import { AlertTriangle, Info } from 'lucide-react';
import Link from 'next/link';

import type { FundMovementAccountRef } from '../actions.server';

interface BankChargesDefaultNoticeProps {
  /** "Gastos bancarios por defecto" de Ajustes contables; `null` si no está configurada. */
  defaultAccount: FundMovementAccountRef | null;
  /** Si la cuenta por defecto está entre las que el combo ofrece hoy (imputable, egreso/activo). */
  available: boolean;
}

const ACCOUNTING_SETTINGS_HREF = '/dashboard/company/accounting/settings';

const neutral =
  'flex items-start gap-2 rounded-md border bg-muted/50 p-3 text-sm text-muted-foreground';
const warning =
  'flex items-start gap-2 rounded-md border border-orange-500/50 bg-orange-500/10 p-3 text-sm text-orange-600';

const label = (a: FundMovementAccountRef) => `${a.code} - ${a.name}`;

const settingsLink = (
  <Link href={ACCOUNTING_SETTINGS_HREF} className="underline">
    Ajustes contables
  </Link>
);

/**
 * Anticipa con qué cuenta nacen los conceptos nuevos de "Gastos e impuestos
 * bancarios" (TSK-718): la por defecto de Ajustes contables, o ninguna si no
 * está configurada o dejó de ser imputable. Ninguno de los tres estados
 * bloquea (hoy ya se opera sin la cuenta), por eso todos usan `role="status"`.
 */
export function _BankChargesDefaultNotice({
  defaultAccount,
  available,
}: BankChargesDefaultNoticeProps) {
  // Estado 3: no configurada → el usuario elige la cuenta en cada concepto.
  if (!defaultAccount) {
    return (
      <div className={warning} role="status">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <span>
          No hay cuenta de gastos bancarios por defecto: elegí la cuenta en cada concepto o
          configurala en {settingsLink}.
        </span>
      </div>
    );
  }

  // Estado 2: configurada pero el combo ya no la ofrece (dada de baja / no imputable).
  if (!available) {
    return (
      <div className={warning} role="status">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <span>
          La cuenta de gastos bancarios por defecto{' '}
          <span className="font-mono">{label(defaultAccount)}</span> ya no está disponible (dada de
          baja o no imputable): elegí la cuenta en cada concepto o corregila en {settingsLink}.
        </span>
      </div>
    );
  }

  // Estado 1: configurada y disponible → se preselecciona en cada concepto nuevo.
  return (
    <div className={neutral} role="status">
      <Info className="mt-0.5 h-4 w-4 shrink-0" />
      <span>
        Los conceptos nuevos se imputan a <span className="font-mono">{label(defaultAccount)}</span>{' '}
        (cuenta de gastos bancarios por defecto). Podés cambiar la cuenta en cada fila.
      </span>
    </div>
  );
}
