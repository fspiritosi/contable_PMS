import { prisma } from '@/shared/lib/prisma';
import { logger } from '@/shared/lib/logger';
import moment from 'moment';

/**
 * Representación plana y serializable del ejercicio en curso.
 * `number` puede ser `null` cuando el ejercicio se derivó del fallback
 * `AccountingSettings.fiscalYearStart/End` (que no tiene número).
 */
export interface CurrentFiscalYear {
  id: string | null;
  number: number | null;
  startDate: Date;
  endDate: Date;
  isClosed: boolean;
  /** true si el rango proviene de AccountingSettings (no de un registro FiscalYear real). */
  isFallback: boolean;
}

/**
 * Ejercicio "en curso" = aquel cuyo rango [startDate, endDate] contiene la fecha dada
 * (hoy por defecto). Se prefiere un ejercicio no cerrado si hay solapamiento.
 * Fallback a `AccountingSettings.fiscalYearStart/End` si no hay registro `FiscalYear`.
 * Devuelve `null` si no hay forma de determinar el ejercicio.
 */
export async function getCurrentFiscalYear(
  companyId: string,
  atDate?: Date
): Promise<CurrentFiscalYear | null> {
  const date = atDate ?? new Date();

  // Buscar el/los FiscalYear cuyo rango contiene la fecha; preferir no cerrado.
  const fiscalYears = await prisma.fiscalYear.findMany({
    where: {
      companyId,
      startDate: { lte: date },
      endDate: { gte: date },
    },
    select: {
      id: true,
      number: true,
      startDate: true,
      endDate: true,
      isClosed: true,
    },
    orderBy: [{ isClosed: 'asc' }, { number: 'desc' }],
  });

  if (fiscalYears.length > 0) {
    // El orderBy pone primero el no cerrado (isClosed asc) de mayor number.
    const fy = fiscalYears[0];
    return {
      id: fy.id,
      number: fy.number,
      startDate: fy.startDate,
      endDate: fy.endDate,
      isClosed: fy.isClosed,
      isFallback: false,
    };
  }

  // Fallback a AccountingSettings (patrón usado en entries/validators).
  const settings = await prisma.accountingSettings.findUnique({
    where: { companyId },
    select: { fiscalYearStart: true, fiscalYearEnd: true },
  });

  if (
    settings &&
    moment(date).isSameOrAfter(moment(settings.fiscalYearStart)) &&
    moment(date).isSameOrBefore(moment(settings.fiscalYearEnd))
  ) {
    return {
      id: null,
      number: null,
      startDate: settings.fiscalYearStart,
      endDate: settings.fiscalYearEnd,
      isClosed: false,
      isFallback: true,
    };
  }

  logger.warn('No se pudo determinar el ejercicio en curso', {
    data: { companyId, atDate: moment(date).toISOString() },
  });
  return null;
}

/**
 * Próximo ejercicio respecto de uno dado.
 * Estrategia: buscar `number = current.number + 1`; si no existe (o el actual es
 * un fallback sin number), tomar el inmediato posterior por `startDate`.
 * Devuelve `null` si no existe un ejercicio posterior.
 */
export async function getNextFiscalYear(
  companyId: string,
  currentFY?: CurrentFiscalYear
): Promise<CurrentFiscalYear | null> {
  // 1) Por número consecutivo si tenemos un number real.
  if (currentFY?.number != null) {
    const byNumber = await prisma.fiscalYear.findFirst({
      where: { companyId, number: currentFY.number + 1 },
      select: {
        id: true,
        number: true,
        startDate: true,
        endDate: true,
        isClosed: true,
      },
    });
    if (byNumber) {
      return { ...byNumber, isFallback: false };
    }
  }

  // 2) Fallback: el inmediato posterior por startDate.
  const referenceDate = currentFY?.endDate ?? currentFY?.startDate ?? new Date();
  const byDate = await prisma.fiscalYear.findFirst({
    where: { companyId, startDate: { gt: referenceDate } },
    select: {
      id: true,
      number: true,
      startDate: true,
      endDate: true,
      isClosed: true,
    },
    orderBy: { startDate: 'asc' },
  });

  if (byDate) {
    return { ...byDate, isFallback: false };
  }

  return null;
}
