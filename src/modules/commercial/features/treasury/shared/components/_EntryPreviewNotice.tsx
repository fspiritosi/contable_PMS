'use client';

import { AlertTriangle, Info, XCircle } from 'lucide-react';

import { Alert, AlertDescription, AlertTitle } from '@/shared/components/ui/alert';

import type { EntryPreflight } from '../entry-preflight';

interface Props {
  preview: EntryPreflight | undefined;
  isLoading: boolean;
}

/**
 * Aviso dentro del diálogo de confirmar un recibo u orden de pago (TSK-728):
 * dice de antemano si la confirmación va a fallar y por qué, qué pagos quedan
 * fuera del asiento, y con qué cuentas se genera. El server rechaza igual
 * (`confirmReceipt`/`confirmPaymentOrder`): esto solo evita la sorpresa.
 */
export function _EntryPreviewNotice({ preview, isLoading }: Props) {
  if (isLoading || !preview) {
    return <p className="text-sm text-muted-foreground">Verificando cuentas contables…</p>;
  }

  if (preview.error) {
    return (
      <Alert variant="destructive" role="alert" data-testid="entry-preview-error">
        <XCircle className="h-4 w-4" />
        <AlertTitle>No se va a poder confirmar</AlertTitle>
        <AlertDescription>{preview.error}</AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-2">
      {preview.warnings.length > 0 && (
        <Alert
          variant="default"
          className="border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100"
          role="alert"
          data-testid="entry-preview-warnings"
        >
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Avisos del asiento contable</AlertTitle>
          <AlertDescription>
            <ul className="list-disc space-y-1 pl-4">
              {preview.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      {preview.accounts.length > 0 && (
        <Alert variant="default" data-testid="entry-preview-accounts">
          <Info className="h-4 w-4" />
          <AlertDescription>
            <p>El asiento contable se genera con estas cuentas:</p>
            {/* Una fila por cuenta: AlertDescription es un grid y partiría un párrafo con <code> inline. */}
            <ul className="mt-1 space-y-1">
              {preview.accounts.map((row) => (
                <li
                  key={`${row.concept}-${row.account}`}
                  className="flex flex-wrap items-baseline gap-x-2"
                >
                  <span className="text-muted-foreground">{row.concept}:</span>
                  <code className="text-xs">{row.account}</code>
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
