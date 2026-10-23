'use client';

import Link from 'next/link';

import { Badge } from '@/shared/components/ui/badge';

import type { Impediment } from '../correction/types';

const SEVERITY_LABELS: Record<Impediment['severity'], string> = {
  MANUAL: 'Podés resolverlo',
  BLOCKED: 'No se puede',
};

export function _CorrectionImpediments({ impediments }: { impediments: Impediment[] }) {
  if (impediments.length === 0) return null;
  return (
    <div className="space-y-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 sm:p-4">
      <p className="text-sm font-medium">
        Hay {impediments.length} {impediments.length === 1 ? 'impedimento' : 'impedimentos'}. Hasta
        resolverlos no se aplica ningún cambio. Tus datos editados quedan en el formulario.
      </p>
      <ul className="space-y-2">
        {impediments.map((impediment, index) => (
          <li key={`${impediment.code}-${index}`} className="flex flex-col gap-1 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={impediment.severity === 'BLOCKED' ? 'destructive' : 'outline'}>
                {SEVERITY_LABELS[impediment.severity]}
              </Badge>
              <span>{impediment.message}</span>
            </div>
            {(impediment.action || impediment.href) && (
              <p className="text-muted-foreground text-xs">
                {impediment.action}{' '}
                {impediment.href && (
                  <Link href={impediment.href} className="text-primary underline">
                    Ir a resolverlo
                  </Link>
                )}
              </p>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
