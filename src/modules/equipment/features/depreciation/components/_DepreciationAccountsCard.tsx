'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Pencil } from 'lucide-react';
import { useState } from 'react';

import { Badge } from '@/shared/components/ui/badge';
import { Button } from '@/shared/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/shared/components/ui/card';
import { usePermissions } from '@/shared/hooks/usePermissions';

import {
  ASSET_ACCOUNT_KEYS,
  ASSET_ACCOUNT_LABELS,
  ASSET_ACCOUNT_SOURCE_LABELS,
  formatAccountLabel,
} from '@/modules/equipment/shared/asset-accounts';
import { getVehicleAssetAccounts } from '../actions.server';
import { _DepreciationAccountsDialog } from './_DepreciationAccountsDialog';

interface Props {
  vehicleId: string;
}

/**
 * Card "Cuentas contables" de la pestaña Depreciación (TSK-724c): qué cuenta
 * se va a usar para cada concepto y de dónde sale (depreciación del equipo,
 * tipo de equipo o por defecto). "Editar cuentas" abre el override.
 */
export function _DepreciationAccountsCard({ vehicleId }: Props) {
  const { hasPermission } = usePermissions();
  const queryClient = useQueryClient();
  const [showDialog, setShowDialog] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['vehicleAssetAccounts', vehicleId],
    queryFn: () => getVehicleAssetAccounts(vehicleId),
  });

  const handleChanged = () => {
    queryClient.invalidateQueries({ queryKey: ['vehicleAssetAccounts', vehicleId] });
    queryClient.invalidateQueries({ queryKey: ['vehicleDepreciation', vehicleId] });
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle>Cuentas contables</CardTitle>
            <CardDescription>
              Cuentas de Bienes de Uso con las que se contabilizan la amortización, los ajustes y la
              baja de este equipo
            </CardDescription>
          </div>
          {data?.hasDepreciation && hasPermission('equipment', 'update') && (
            <Button variant="outline" size="sm" onClick={() => setShowDialog(true)}>
              <Pencil className="mr-2 h-4 w-4" />
              Editar cuentas
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading || !data ? (
          <div className="flex items-center justify-center py-4">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <dl className="divide-y">
            {ASSET_ACCOUNT_KEYS.map((key) => {
              const account = data.accounts[key];
              return (
                <div
                  key={key}
                  className="flex flex-col gap-1 py-2 sm:flex-row sm:items-center sm:justify-between"
                >
                  <dt className="text-sm text-muted-foreground">
                    {ASSET_ACCOUNT_LABELS[key].field}
                  </dt>
                  <dd className="flex flex-wrap items-center gap-2 text-sm">
                    {account ? (
                      <>
                        <span className="font-medium">{formatAccountLabel(account)}</span>
                        <Badge
                          variant={account.source === 'depreciation' ? 'default' : 'secondary'}
                        >
                          {ASSET_ACCOUNT_SOURCE_LABELS[account.source]}
                          {account.source === 'type' ? ` «${data.typeName}»` : ''}
                        </Badge>
                        {!account.imputable && <Badge variant="destructive">no imputable</Badge>}
                      </>
                    ) : (
                      <span className="text-destructive">
                        Sin cuenta — asignala acá, en el tipo de equipo «{data.typeName}» o en
                        Contabilidad → Configuración
                      </span>
                    )}
                  </dd>
                </div>
              );
            })}
          </dl>
        )}

        <p className="text-xs text-muted-foreground">
          La compra del bien se imputa a la cuenta del ítem (Ítems → Imputación contable). Para que
          el rubro cierre, la cuenta de Bienes de Uso del equipo tiene que ser la misma.
        </p>
      </CardContent>

      {data && (
        <_DepreciationAccountsDialog
          data={data}
          open={showDialog}
          onOpenChange={setShowDialog}
          onChanged={handleChanged}
        />
      )}
    </Card>
  );
}
