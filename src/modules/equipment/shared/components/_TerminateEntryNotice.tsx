'use client';

import { AlertTriangle, Info } from 'lucide-react';

import type { VehicleTerminationReason } from '@/generated/prisma/enums';
import { Alert, AlertDescription } from '@/shared/components/ui/alert';
import { ASSET_ACCOUNT_LABELS } from '@/shared/lib/assets/asset-account-labels';

import type { VehicleAssetAccounts } from '../../features/depreciation/actions.server';
import { ASSET_ACCOUNT_SOURCE_LABELS } from '../asset-accounts';

interface Props {
  data: VehicleAssetAccounts | undefined;
  isLoading: boolean;
  reason: VehicleTerminationReason;
}

const REQUIRED_KEYS = ['fixedAsset', 'accumulatedDepreciation'] as const;

/**
 * Aviso bajo el motivo de baja (TSK-724c): dice de antemano si la baja va a
 * generar asiento, con qué cuentas y de dónde salen, o por qué va a fallar.
 * El server rechaza igual (`softDeleteVehicle`): esto solo evita la sorpresa.
 */
export function _TerminateEntryNotice({ data, isLoading, reason }: Props) {
  if (isLoading || !data) {
    return <p className="text-sm text-muted-foreground">Verificando cuentas contables…</p>;
  }

  if (!data.hasDepreciation) {
    return (
      <Neutral testId="terminate-notice-no-depreciation">
        Este equipo no tiene depreciación configurada: la baja no genera asiento contable.
      </Neutral>
    );
  }

  if (reason === 'OTHER') {
    return (
      <Neutral testId="terminate-notice-other">
        Baja por otro motivo: no genera asiento contable.
      </Neutral>
    );
  }

  const missingKey = REQUIRED_KEYS.find((key) => data.accounts[key] === null);
  const missingLabel = missingKey
    ? ASSET_ACCOUNT_LABELS[missingKey].field
    : data.assetDisposalGainLoss === null
      ? 'Resultado por venta/baja de Bienes de Uso'
      : null;

  if (missingLabel) {
    return (
      <Alert
        variant="default"
        className="border-orange-300 bg-orange-50 text-orange-900 dark:border-orange-800 dark:bg-orange-950 dark:text-orange-100"
        role="alert"
        data-testid="terminate-notice-missing"
      >
        <AlertTriangle className="h-4 w-4" />
        <AlertDescription>
          La baja va a fallar: falta la cuenta de {missingLabel}. Configurala en la pestaña
          Depreciación, en el tipo «{data.typeName}» o en Contabilidad → Configuración.
        </AlertDescription>
      </Alert>
    );
  }

  const fixedAsset = data.accounts.fixedAsset!;
  const accumulated = data.accounts.accumulatedDepreciation!;
  const result = data.assetDisposalGainLoss!;
  const origin = (source: typeof fixedAsset.source) =>
    source === 'type'
      ? `${ASSET_ACCOUNT_SOURCE_LABELS.type} «${data.typeName}»`
      : ASSET_ACCOUNT_SOURCE_LABELS[source];

  // Una fila por cuenta: AlertDescription es un grid y partiría un párrafo con <code> inline.
  const rows = [
    { label: 'Bienes de Uso', account: fixedAsset, origin: origin(fixedAsset.source) },
    { label: 'Amortización acumulada', account: accumulated, origin: origin(accumulated.source) },
    { label: 'Resultado', account: result, origin: 'por defecto (Ajustes contables)' },
  ];

  return (
    <Neutral testId="terminate-notice-entry">
      <p>La baja genera un asiento con estas cuentas:</p>
      <ul className="mt-1 space-y-1">
        {rows.map((row) => (
          <li key={row.label} className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-muted-foreground">{row.label}:</span>
            <code className="text-xs">
              {row.account.code} - {row.account.name}
            </code>
            <span className="text-xs text-muted-foreground">({row.origin})</span>
          </li>
        ))}
      </ul>
    </Neutral>
  );
}

function Neutral({ children, testId }: { children: React.ReactNode; testId: string }) {
  return (
    <Alert variant="default" data-testid={testId}>
      <Info className="h-4 w-4" />
      <AlertDescription>{children}</AlertDescription>
    </Alert>
  );
}
