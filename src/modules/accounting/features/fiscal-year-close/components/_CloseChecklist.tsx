'use client';

import { CircleAlert, CircleCheck } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';

import {
  ENTRIES_HREF,
  PERIOD_LOCK_HREF,
  type FiscalYearCloseStatus,
} from '../fiscal-year-close-common';

function Item({ ok, children }: { ok: boolean; children: ReactNode }) {
  const Icon = ok ? CircleCheck : CircleAlert;
  return (
    <li className="flex gap-2">
      <Icon
        className={`mt-0.5 h-4 w-4 shrink-0 ${ok ? 'text-green-600' : 'text-amber-600'}`}
        aria-hidden
      />
      <div className="space-y-1 text-sm">{children}</div>
    </li>
  );
}

/**
 * Requisitos del cierre anual (TSK-760, Fase 9: B1, A5/B4): cuenta de Resultado, todos los
 * meses cerrados y ningún borrador en el ejercicio, con links para resolver cada uno.
 */
export function _CloseChecklist({ status }: { status: FiscalYearCloseStatus }) {
  const { openMonths, pendingDrafts, resultAccountName } = status;
  const draftCount = pendingDrafts.reduce((sum, group) => sum + group.count, 0);

  return (
    <ul className="space-y-3 rounded-md border p-4">
      <Item ok={resultAccountName !== null}>
        {resultAccountName ? (
          <p>
            Cuenta de Resultado del Ejercicio: <strong>{resultAccountName}</strong>
          </p>
        ) : (
          <p>
            Falta la cuenta de Resultado del Ejercicio.{' '}
            <Link href="/dashboard/company/accounting/settings" className="underline">
              Configurarla
            </Link>
          </p>
        )}
      </Item>

      <Item ok={openMonths.length === 0}>
        {openMonths.length === 0 ? (
          <p>Todos los meses del ejercicio están cerrados.</p>
        ) : (
          <>
            <p>
              Faltan cerrar {openMonths.length === 1 ? 'el mes' : `${openMonths.length} meses`}:{' '}
              {openMonths.join(', ')}.
            </p>
            <Link href={PERIOD_LOCK_HREF} className="text-primary underline">
              Cerrarlos en orden en Bloqueo de Períodos
            </Link>
          </>
        )}
      </Item>

      <Item ok={draftCount === 0}>
        {draftCount === 0 ? (
          <p>No hay borradores sin registrar en el ejercicio.</p>
        ) : (
          <>
            <p>
              {draftCount === 1
                ? 'Hay 1 borrador sin registrar'
                : `Hay ${draftCount} borradores sin registrar`}
              :{' '}
              {pendingDrafts
                .map(
                  (g) =>
                    `${g.month}: N° ${g.numbers.join(', ')}${g.count > g.numbers.length ? ', …' : ''}`
                )
                .join('; ')}
              .
            </p>
            <Link href={ENTRIES_HREF} className="text-primary underline">
              Ver asientos
            </Link>
          </>
        )}
      </Item>
    </ul>
  );
}
