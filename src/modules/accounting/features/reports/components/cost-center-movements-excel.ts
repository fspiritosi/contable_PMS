import moment from 'moment';

import { exportToExcel, type ExcelColumn } from '@/shared/lib/excel-export';
import { formatDateUtc } from '@/shared/utils/formatters';

import { buildExcelRows } from '../../../shared/utils/cost-center-movements';
import type { CostCenterMovementsResult } from '../actions.server';

const amount = (value: unknown) => (value as number).toFixed(2);

const STATUS_LABELS: Record<string, string> = { DRAFT: 'Borrador', POSTED: 'Registrado' };

/**
 * Columnas del Excel del informe de movimientos por centro de costo. Debe y
 * Haber van acá aunque no estén en la tabla: es donde el contador cruza contra
 * el Libro Mayor. Estado solo aparece cuando se incluyeron borradores.
 */
function buildExcelColumns(includeStatus: boolean): ExcelColumn[] {
  const columns: ExcelColumn[] = [
    { key: 'centro', title: 'Centro', width: 22 },
    {
      key: 'fecha',
      title: 'Fecha',
      width: 12,
      formatter: (value) => (value ? formatDateUtc(value as Date) : ''),
    },
    { key: 'asiento', title: 'Asiento', width: 10, formatter: (v) => (v ? String(v) : '') },
    { key: 'codigo', title: 'Codigo', width: 12 },
    { key: 'cuenta', title: 'Cuenta', width: 25 },
    { key: 'descripcion', title: 'Descripcion', width: 30 },
    { key: 'debe', title: 'Debe', width: 14, formatter: amount },
    { key: 'haber', title: 'Haber', width: 14, formatter: amount },
    { key: 'entrada', title: 'Entrada', width: 14, formatter: amount },
    { key: 'salida', title: 'Salida', width: 14, formatter: amount },
    { key: 'saldo', title: 'Saldo', width: 14, formatter: amount },
  ];

  if (includeStatus) {
    columns.push({
      key: 'estado',
      title: 'Estado',
      width: 12,
      formatter: (value) => STATUS_LABELS[value as string] ?? '',
    });
  }

  return columns;
}

/**
 * Exporta el informe tal cual vino de la action: el aplanado y los totales por
 * centro salen del helper puro, el componente no recalcula nada.
 */
export async function exportCostCenterMovements(data: CostCenterMovementsResult): Promise<void> {
  const rows = buildExcelRows(data.groups, { includeStatus: data.includeDrafts });
  if (rows.length === 0) return;

  await exportToExcel(rows, buildExcelColumns(data.includeDrafts), {
    filename: `movimientos-centro-costo-${moment().format('YYYY-MM-DD')}`,
    sheetName: 'Movimientos por Centro',
    title: 'Movimientos por Centro de Costo',
    includeDate: true,
  });
}
