import Link from 'next/link';
import { Settings } from 'lucide-react';

import { Button } from '@/shared/components/ui/button';
import { Card, CardContent } from '@/shared/components/ui/card';

interface ConfigRequiredProps {
  /** Mensaje específico de la pantalla: qué falta y para qué sirve configurarlo. */
  description: string;
  title?: string;
  ctaHref?: string;
  ctaLabel?: string;
}

/**
 * Empty state informativo para pantallas de contabilidad que requieren una
 * configuración previa (ejercicio fiscal, plan de cuentas, etc.).
 *
 * Es una condición ESPERADA (falta de configuración del usuario), no un fallo
 * del sistema: por eso se muestra como guía amable y NO como error boundary ni
 * Alert destructive.
 */
export function ConfigRequired({
  description,
  title = 'Configuración contable requerida',
  ctaHref = '/dashboard/company/accounting/settings',
  ctaLabel = 'Ir a Configuración Contable',
}: ConfigRequiredProps) {
  return (
    <Card className="border-dashed">
      <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
        <div className="bg-primary/10 text-primary flex h-12 w-12 items-center justify-center rounded-full">
          <Settings className="h-6 w-6" />
        </div>
        <div className="space-y-1">
          <h2 className="text-lg font-semibold">{title}</h2>
          <p className="text-muted-foreground mx-auto max-w-md text-sm">{description}</p>
        </div>
        <Button asChild>
          <Link href={ctaHref}>{ctaLabel}</Link>
        </Button>
      </CardContent>
    </Card>
  );
}
