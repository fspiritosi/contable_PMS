'use server';

import moment from 'moment';
import { getIncomeStatement } from '@/modules/accounting/features/reports/actions.server';
import { getActiveCompanyId } from '@/shared/lib/company';

/**
 * Obtiene el resumen financiero (ingresos/gastos/resultado) para un mes específico.
 * Reutiliza `getIncomeStatement` de reports, acotando el rango al mes completo.
 */
export async function getMonthlyBalance(month: string) {
  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  const start = moment(month, 'YYYY-MM').startOf('month');
  const end = moment(month, 'YYYY-MM').endOf('month');

  return getIncomeStatement(companyId, start.toDate(), end.toDate());
}