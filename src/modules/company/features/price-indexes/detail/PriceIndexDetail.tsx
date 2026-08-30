import { notFound } from 'next/navigation';

import { BackButton } from '@/shared/components/common/BackButton';
import { PermissionGuard } from '@/shared/components/common/PermissionGuard';
import { Badge } from '@/shared/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/components/ui/card';
import { getModulePermissions } from '@/shared/lib/permissions';

import { getPriceIndexWithValues } from './actions.server';
import { _PriceIndexValuesTable } from './components/_PriceIndexValuesTable';

interface Props {
  indexId: string;
}

export async function PriceIndexDetail({ indexId }: Props) {
  const [index, permissions] = await Promise.all([
    getPriceIndexWithValues(indexId),
    getModulePermissions('company.price-indexes'),
  ]);

  if (!index) {
    notFound();
  }

  return (
    <PermissionGuard module="company.price-indexes" action="view" redirect>
      <div className="flex flex-1 flex-col gap-4">
        <div className="flex items-center gap-4">
          <BackButton />
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold" data-testid="price-index-detail-title">
              {index.name}
            </h1>
            <Badge variant={index.isActive ? 'default' : 'secondary'}>
              {index.isActive ? 'Activo' : 'Inactivo'}
            </Badge>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Valores por Período</CardTitle>
            <CardDescription>
              {index.description ||
                'Cargá el porcentaje de variación de cada período (mes/año) para poder aplicarlo a listas de precios'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <_PriceIndexValuesTable
              indexId={index.id}
              values={index.values}
              permissions={permissions}
            />
          </CardContent>
        </Card>
      </div>
    </PermissionGuard>
  );
}
