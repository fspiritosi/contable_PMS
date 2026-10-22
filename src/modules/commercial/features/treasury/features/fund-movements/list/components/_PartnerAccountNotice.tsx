'use client';

import { AlertTriangle, Info } from 'lucide-react';
import Link from 'next/link';

import type {
  FundMovementAccountRef,
  FundMovementConceptOption,
  FundMovementPartnerOption,
} from '../actions.server';

interface PartnerAccountNoticeProps {
  /** Socio elegido en el formulario; `undefined` si todavía no se eligió. */
  partner: FundMovementPartnerOption | undefined;
  /** Cuenta de aportes por defecto de Ajustes contables; `null` si no está configurada. */
  defaultAccount: FundMovementAccountRef | null;
  /** Concepto elegido (TSK-791); `undefined` si no hay o todavía no se eligió. */
  concept?: FundMovementConceptOption;
  /** Hay conceptos activos para el tipo: hasta elegir uno no se sabe qué cuenta aplica. */
  hasConcepts?: boolean;
}

const ACCOUNTING_SETTINGS_HREF = '/dashboard/company/accounting/settings';

const neutral =
  'flex items-start gap-2 rounded-md border bg-muted/50 p-3 text-sm text-muted-foreground';
const warning =
  'flex items-start gap-2 rounded-md border border-orange-500/50 bg-orange-500/10 p-3 text-sm text-orange-600';

const label = (a: FundMovementAccountRef) => `${a.code} - ${a.name}`;

/**
 * Anticipa a qué cuenta se va a imputar el aporte/retiro según el socio elegido
 * (TSK-717): la propia del socio, la por defecto, o ninguna (no va a poder confirmar).
 */
export function _PartnerAccountNotice({
  partner,
  defaultAccount,
  concept,
  hasConcepts = false,
}: PartnerAccountNoticeProps) {
  // TSK-791: con conceptos disponibles y ninguno elegido, el concepto puede definir la
  // cuenta; no se anticipa un bloqueo que quizá no aplique hasta que se elija.
  if (hasConcepts && !concept) return null;

  // TSK-791: un concepto con cuenta propia define el asiento; la cuenta del socio
  // no se usa, así que no se evalúa ni bloquea, y Gestión no ve la cuenta.
  if (concept?.accountMode === 'OWN_ACCOUNT') {
    return (
      <div className={neutral} role="status">
        <Info className="mt-0.5 h-4 w-4 shrink-0" />
        <span>El asiento se imputará según el concepto «{concept.name}».</span>
      </div>
    );
  }

  // Estado 4: sin socio elegido. Con cuenta por defecto no hay nada que avisar
  // (el campo obligatorio ya lo marca); sin ella se anticipa que no va a poder confirmar.
  if (!partner) {
    if (defaultAccount) return null;
    return (
      <div className={warning} role="status">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <span>
          Para confirmar aportes o retiros hace falta una cuenta de aportes: asignala al socio o
          configurá la por defecto en{' '}
          <Link href={ACCOUNTING_SETTINGS_HREF} className="underline">
            Ajustes contables
          </Link>
          .
        </span>
      </div>
    );
  }

  // Estado 1: el socio tiene cuenta propia.
  if (partner.contributionsAccount) {
    return (
      <div className={neutral} role="status">
        <Info className="mt-0.5 h-4 w-4 shrink-0" />
        <span>
          El asiento se imputará a la cuenta{' '}
          <span className="font-mono">{label(partner.contributionsAccount)}</span> de {partner.name}
          .
        </span>
      </div>
    );
  }

  // Estado 2: sin cuenta propia, pero hay cuenta por defecto.
  if (defaultAccount) {
    return (
      <div className={neutral} role="status">
        <Info className="mt-0.5 h-4 w-4 shrink-0" />
        <span>
          {partner.name} no tiene cuenta de aportes propia: se usará la cuenta por defecto{' '}
          <span className="font-mono">{label(defaultAccount)}</span>.
        </span>
      </div>
    );
  }

  // Estado 3: sin cuenta propia y sin cuenta por defecto → no va a poder confirmar.
  return (
    <div className={warning} role="alert">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <span>
        {partner.name} no tiene cuenta de aportes y no hay una cuenta por defecto. Asignale una en{' '}
        <Link
          href={`/dashboard/commercial/treasury/partners/${partner.id}/edit`}
          className="underline"
        >
          Tesorería → Socios
        </Link>
        , o configurá la &quot;Cuenta de aportes de socios por defecto&quot; en{' '}
        <Link href={ACCOUNTING_SETTINGS_HREF} className="underline">
          Ajustes contables
        </Link>
        . No vas a poder confirmar.
      </span>
    </div>
  );
}
