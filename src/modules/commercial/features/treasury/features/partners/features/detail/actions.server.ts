'use server';

import { revalidatePath } from 'next/cache';
import { getCurrentUserId } from '@/shared/lib/current-user';
import { prisma } from '@/shared/lib/prisma';
import { logger } from '@/shared/lib/logger';
import { checkPermission } from '@/shared/lib/permissions';
import { getActiveCompanyId } from '@/shared/lib/company';
import { PartnerMovementType } from '@/generated/prisma/enums';
import {
  partnerMovementSchema,
  type PartnerMovementFormData,
} from '../../shared/validators';
import type { PartnerAccountStatement, PartnerMovement } from '../../shared/types';

/**
 * Obtiene la cuenta corriente de un socio: sus movimientos y el balance calculado.
 * balance = Σ(OWED) + Σ(ADJUSTMENT) − Σ(REPAYMENT)
 * El balance representa lo que la EMPRESA le debe al socio.
 */
export async function getPartnerAccountStatement(
  partnerId: string
): Promise<PartnerAccountStatement> {
  await checkPermission('commercial.treasury.partners', 'view', { redirect: true });
  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');

  try {
    const [movements, installments] = await Promise.all([
      prisma.partnerAccountMovement.findMany({
        where: { companyId, partnerId },
        orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      }),
      // Cuotas de tarjetas del socio: las PENDING son la deuda principal (se saldan con
      // una OP de devolución); las PAID quedan como historial.
      prisma.paymentOrderInstallment.findMany({
        where: { companyId, partnerId },
        select: {
          id: true,
          number: true,
          dueDate: true,
          amount: true,
          status: true,
          card: { select: { name: true } },
          paymentOrder: { select: { fullNumber: true } },
          settledBy: { select: { fullNumber: true } },
        },
        orderBy: [{ dueDate: 'asc' }],
      }),
    ]);

    let totalOwed = 0;
    let totalRepayment = 0;
    let totalAdjustment = 0;

    const mappedMovements: PartnerMovement[] = movements.map((movement) => {
      const amount = Number(movement.amount);
      if (movement.type === PartnerMovementType.OWED) totalOwed += amount;
      else if (movement.type === PartnerMovementType.REPAYMENT) totalRepayment += amount;
      else if (movement.type === PartnerMovementType.ADJUSTMENT) totalAdjustment += amount;

      return {
        id: movement.id,
        companyId: movement.companyId,
        partnerId: movement.partnerId,
        date: movement.date,
        type: movement.type,
        amount,
        description: movement.description,
        paymentOrderId: movement.paymentOrderId,
        createdBy: movement.createdBy,
        createdAt: movement.createdAt,
      };
    });

    const mappedInstallments = installments.map((inst) => ({
      id: inst.id,
      number: inst.number,
      dueDate: inst.dueDate,
      amount: Number(inst.amount),
      status: inst.status,
      cardName: inst.card?.name ?? '',
      originFullNumber: inst.paymentOrder.fullNumber,
      settledByFullNumber: inst.settledBy?.fullNumber ?? null,
    }));

    const pendingInstallments = mappedInstallments
      .filter((i) => i.status === 'PENDING')
      .reduce((sum, i) => sum + i.amount, 0);

    // Saldo a favor del socio = cuotas pendientes (deuda por tarjetas) + ajustes manuales
    const balance = pendingInstallments + totalOwed + totalAdjustment - totalRepayment;

    return {
      movements: mappedMovements,
      installments: mappedInstallments,
      balance,
      pendingInstallments,
      totalOwed,
      totalRepayment,
      totalAdjustment,
    };
  } catch (error) {
    logger.error('Error al obtener cuenta corriente del socio', {
      data: { error, partnerId },
    });
    throw new Error('Error al obtener cuenta corriente del socio');
  }
}

/**
 * Registra un movimiento manual en la cuenta corriente del socio.
 * Solo permite REPAYMENT (devolución) o ADJUSTMENT (ajuste).
 * OWED se genera automáticamente al pagar con la tarjeta del socio (otra fase).
 */
export async function createPartnerMovement(
  partnerId: string,
  data: PartnerMovementFormData
): Promise<PartnerMovement> {
  await checkPermission('commercial.treasury.partners', 'update', { redirect: true });
  try {
    const userId = await getCurrentUserId();
    if (!userId) throw new Error('No autenticado');

    const companyId = await getActiveCompanyId();
    if (!companyId) throw new Error('No se encontró empresa activa');

    const validatedData = partnerMovementSchema.parse(data);

    // Defensa adicional: nunca permitir OWED desde la UI
    if (
      validatedData.type !== PartnerMovementType.REPAYMENT &&
      validatedData.type !== PartnerMovementType.ADJUSTMENT
    ) {
      throw new Error('Tipo de movimiento no permitido');
    }

    const partner = await prisma.partner.findFirst({
      where: { id: partnerId, companyId },
      select: { id: true },
    });
    if (!partner) throw new Error('Socio no encontrado');

    const movement = await prisma.partnerAccountMovement.create({
      data: {
        companyId,
        partnerId,
        date: new Date(validatedData.date),
        type: validatedData.type,
        amount: validatedData.amount,
        description: validatedData.description,
        createdBy: userId,
      },
    });

    logger.info('Movimiento de socio creado', {
      data: { movementId: movement.id, partnerId, type: movement.type, companyId },
    });

    revalidatePath(`/dashboard/commercial/treasury/partners/${partnerId}`);
    revalidatePath('/dashboard/commercial/treasury/partners');

    return {
      id: movement.id,
      companyId: movement.companyId,
      partnerId: movement.partnerId,
      date: movement.date,
      type: movement.type,
      amount: Number(movement.amount),
      description: movement.description,
      paymentOrderId: movement.paymentOrderId,
      createdBy: movement.createdBy,
      createdAt: movement.createdAt,
    };
  } catch (error) {
    logger.error('Error al registrar movimiento de socio', {
      data: { error, partnerId, data },
    });
    if (error instanceof Error) throw error;
    throw new Error('Error al registrar movimiento de socio');
  }
}
