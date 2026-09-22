'use client';

import { ChevronDown, ChevronRight } from 'lucide-react';
import { Fragment } from 'react';

import { Badge } from '@/shared/components/ui/badge';
import { Button } from '@/shared/components/ui/button';
import { formatDateUtc } from '@/shared/utils/formatters';

import { formatAmount } from '../../../shared/utils';
import type { CostCenterMovementGroup } from '../../../shared/utils/cost-center-movements';

interface CostCenterMovementsTableProps {
  groups: CostCenterMovementGroup[];
  /** Claves de los grupos expandidos (`costCenterId` o `'none'`). */
  expandedRows: Set<string>;
  onToggle: (groupKey: string) => void;
  /** Con borradores incluidos se agrega la columna Estado. */
  includeDrafts: boolean;
}

/** Clase del importe según el signo, igual que el Libro Mayor. */
function amountClass(value: number): string {
  if (value < 0) return 'text-destructive';
  if (value > 0) return 'text-green-600';
  return '';
}

/**
 * Comparativa por centro de costo (una fila por centro) con el detalle de sus
 * movimientos al expandir. Tabla HTML plana, como el resto de los informes.
 */
export function _CostCenterMovementsTable({
  groups,
  expandedRows,
  onToggle,
  includeDrafts,
}: CostCenterMovementsTableProps) {
  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full min-w-[640px] text-sm">
        <thead>
          <tr className="border-b bg-muted/50">
            <th className="py-3 pl-4 text-left" colSpan={3}>
              Centro de costo
            </th>
            <th className="hidden sm:table-cell" />
            {includeDrafts && <th className="text-left">Estado</th>}
            <th className="py-3 text-right">Entradas</th>
            <th className="py-3 text-right">Salidas</th>
            <th className="py-3 pr-4 text-right">Saldo</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((group) => {
            const groupKey = group.costCenterId ?? 'none';
            const isExpanded = expandedRows.has(groupKey);

            return (
              // La key va en el fragmento externo (el Libro Mayor la pone en el
              // <tr> dentro de un <> sin key y React lo advierte).
              <Fragment key={groupKey}>
                <tr className="border-b">
                  <td className="py-2 pl-2" colSpan={3}>
                    <div className="flex items-center">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        onClick={() => onToggle(groupKey)}
                        aria-label={isExpanded ? 'Contraer detalle' : 'Ver detalle'}
                        data-testid={`cost-center-group-${groupKey}`}
                      >
                        {isExpanded ? (
                          <ChevronDown className="h-4 w-4" />
                        ) : (
                          <ChevronRight className="h-4 w-4" />
                        )}
                      </Button>
                      <span className="ml-2 font-medium">{group.costCenterName}</span>
                    </div>
                  </td>
                  <td className="hidden sm:table-cell" />
                  {includeDrafts && <td />}
                  <td className="text-right">{formatAmount(group.totalEntradas)}</td>
                  <td className="text-right">{formatAmount(group.totalSalidas)}</td>
                  <td className="py-2 pr-4 text-right">
                    <span className={amountClass(group.saldo)}>{formatAmount(group.saldo)}</span>
                  </td>
                </tr>

                {isExpanded && (
                  <tr className="bg-muted/50 text-xs text-muted-foreground">
                    <td className="py-2 pl-6">Fecha</td>
                    <td className="py-2">Asiento N°</td>
                    <td className="py-2">Cuenta</td>
                    <td className="hidden py-2 sm:table-cell">Descripción</td>
                    {includeDrafts && <td className="py-2">Estado</td>}
                    <td className="py-2 text-right">Entrada</td>
                    <td className="py-2 text-right">Salida</td>
                    <td className="py-2 pr-4 text-right">Saldo acumulado</td>
                  </tr>
                )}

                {isExpanded &&
                  group.rows.map((row) => (
                    // Las filas se identifican por lineId: dos líneas del mismo
                    // asiento en el mismo centro colisionarían por número.
                    <tr key={row.lineId} className="bg-muted/30">
                      <td className="py-2 pl-6 whitespace-nowrap">{formatDateUtc(row.date)}</td>
                      <td className="py-2">{row.entryNumber}</td>
                      <td className="py-2">
                        <span className="font-mono text-xs">{row.accountCode}</span>
                        <span className="ml-2">{row.accountName}</span>
                      </td>
                      <td className="hidden max-w-[220px] truncate py-2 sm:table-cell">
                        {row.lineDescription || row.entryDescription}
                      </td>
                      {includeDrafts && (
                        <td className="py-2">
                          <Badge variant={row.status === 'DRAFT' ? 'outline' : 'secondary'}>
                            {row.status === 'DRAFT' ? 'Borrador' : 'Registrado'}
                          </Badge>
                        </td>
                      )}
                      <td className="py-2 text-right">
                        {row.entrada !== 0 ? formatAmount(row.entrada) : ''}
                      </td>
                      <td className="py-2 text-right">
                        {row.salida !== 0 ? formatAmount(row.salida) : ''}
                      </td>
                      <td className="py-2 pr-4 text-right">
                        <span className={amountClass(row.saldo)}>{formatAmount(row.saldo)}</span>
                      </td>
                    </tr>
                  ))}

                {isExpanded && group.rows.length === 0 && (
                  <tr className="bg-muted/30">
                    <td className="py-3 pl-6 text-muted-foreground" colSpan={includeDrafts ? 8 : 7}>
                      Sin movimientos en el período.
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
