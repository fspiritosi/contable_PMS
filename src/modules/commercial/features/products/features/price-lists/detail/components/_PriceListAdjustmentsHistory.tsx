import moment from 'moment';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/shared/components/ui/table';

import type { PriceListAdjustmentHistoryItem } from '../apply-index.server';

interface Props {
  adjustments: PriceListAdjustmentHistoryItem[];
}

export function _PriceListAdjustmentsHistory({ adjustments }: Props) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Historial de actualizaciones por índice</CardTitle>
        <CardDescription>
          Registro de cada vez que se aplicó un índice de precios a esta lista
        </CardDescription>
      </CardHeader>
      <CardContent>
        {adjustments.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Todavía no se aplicó ningún índice a esta lista.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Índice</TableHead>
                  <TableHead>Período</TableHead>
                  <TableHead className="text-right">Porcentaje</TableHead>
                  <TableHead>Fecha</TableHead>
                  <TableHead>Usuario</TableHead>
                  <TableHead className="text-right">Ítems</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {adjustments.map((adjustment) => (
                  <TableRow key={adjustment.id}>
                    <TableCell>{adjustment.indexName}</TableCell>
                    <TableCell>{moment.utc(adjustment.period).format('MM/YYYY')}</TableCell>
                    <TableCell className="text-right">
                      {adjustment.percentage > 0 ? '+' : ''}
                      {adjustment.percentage}%
                    </TableCell>
                    <TableCell>{moment(adjustment.appliedAt).format('DD/MM/YYYY HH:mm')}</TableCell>
                    <TableCell>{adjustment.appliedByName}</TableCell>
                    <TableCell className="text-right">{adjustment.itemsAffected}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
