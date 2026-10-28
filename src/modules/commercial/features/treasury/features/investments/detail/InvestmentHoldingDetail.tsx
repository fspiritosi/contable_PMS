import { notFound } from 'next/navigation';

import { BackButton } from '@/shared/components/common/BackButton';
import { PermissionGuard } from '@/shared/components/common/PermissionGuard';
import { Badge } from '@/shared/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/shared/components/ui/card';
import { formatCurrency, formatDateUtc } from '@/shared/utils/formatters';

import { getInvestmentHoldingById } from '../list/actions.server';
import { HOLDING_STATUS_LABELS, INSTRUMENT_TYPE_LABELS } from '../shared/types';
import { _HoldingMovementsTable } from './components/_HoldingMovementsTable';

export async function InvestmentHoldingDetail({ holdingId }: { holdingId: string }) {
  const holding = await getInvestmentHoldingById(holdingId);
  if (!holding) notFound();

  const summary = [
    { label: 'Valor en libros', value: formatCurrency(holding.bookValue) },
    { label: 'Nominales', value: holding.nominals === null ? '—' : String(holding.nominals) },
    {
      label: 'Precio promedio',
      value: holding.averagePrice === null ? '—' : formatCurrency(holding.averagePrice),
    },
    { label: 'Vencimiento', value: formatDateUtc(holding.maturityDate, '—') },
  ];

  return (
    <PermissionGuard module="commercial.treasury.investments" action="view" redirect>
      <div className="space-y-6">
        <div>
          <div className="mb-2">
            <BackButton label="Volver" size="sm" />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-3xl font-bold tracking-tight">{holding.name}</h1>
            <Badge variant={holding.status === 'OPEN' ? 'default' : 'secondary'}>
              {HOLDING_STATUS_LABELS[holding.status]}
            </Badge>
          </div>
          <p className="text-muted-foreground">
            {INSTRUMENT_TYPE_LABELS[holding.instrumentType]} · {holding.bankAccountLabel} · Cuenta{' '}
            {holding.account.code} {holding.account.name}
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {summary.map((item) => (
            <Card key={item.label}>
              <CardHeader className="pb-2">
                <CardDescription>{item.label}</CardDescription>
                <CardTitle className="text-2xl">{item.value}</CardTitle>
              </CardHeader>
            </Card>
          ))}
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Movimientos</CardTitle>
            <CardDescription>
              Compras, ventas y valuaciones. La posición es la suma de estos movimientos.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <_HoldingMovementsTable data={holding.movements} />
          </CardContent>
        </Card>
      </div>
    </PermissionGuard>
  );
}
