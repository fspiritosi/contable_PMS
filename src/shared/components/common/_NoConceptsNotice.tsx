'use client';

import { AlertTriangle } from 'lucide-react';
import Link from 'next/link';

import { usePermissions } from '@/shared/hooks/usePermissions';

const CONCEPTS_HREF = '/dashboard/company/accounting/concepts';

interface NoConceptsNoticeProps {
  /** Nombre del uso, de `CONCEPT_USAGE_LABELS` (ej.: "Gastos e impuestos bancarios"). */
  usageLabel: string;
}

/**
 * Aviso de que Contabilidad todavía no creó conceptos para un uso (TSK-791).
 * Sin conceptos no se puede guardar ni confirmar. Si el usuario puede ver la
 * pantalla de Conceptos, el aviso suma un link a ella.
 */
export function _NoConceptsNotice({ usageLabel }: NoConceptsNoticeProps) {
  const { hasPermission } = usePermissions();

  return (
    <div
      className="flex items-start gap-2 rounded-md border border-orange-500/50 bg-orange-500/10 p-3 text-sm text-orange-600"
      role="alert"
    >
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <span>
        No hay conceptos configurados para «{usageLabel}». Pedile a Contabilidad que los cree en
        Empresa → Contabilidad → Conceptos.
        {hasPermission('accounting.concepts', 'view') && (
          <>
            {' '}
            <Link href={CONCEPTS_HREF} className="underline">
              Ir a Conceptos
            </Link>
          </>
        )}
      </span>
    </div>
  );
}
