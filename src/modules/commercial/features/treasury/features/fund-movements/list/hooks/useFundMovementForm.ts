import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { useForm, type UseFormReturn } from 'react-hook-form';

import type { AccountOption } from '@/shared/components/common/AccountCombobox';

import {
  fundMovementSchema,
  type FundMovementFormInput,
  type FundMovementTypeValue,
} from '../../shared/validators';
import {
  emptyFundMovementFormValues,
  formResetKey,
  formValuesFromMovement,
  needsMovementDetail,
  shouldCleanupFieldsOnTypeChange,
  type FundMovementModalMode,
} from '../../shared/view-mode';
import {
  getFundMovementById,
  getFundMovementLineAccounts,
  type FundMovementListItem,
  type FundMovementRecord,
} from '../actions.server';
import { useFundMovementSubmit } from './useFundMovementSubmit';

export interface UseFundMovementFormParams {
  open: boolean;
  mode: FundMovementModalMode;
  /** Obligatorio en edit/view; ignorado en create. */
  movement: FundMovementListItem | null | undefined;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

export interface UseFundMovementFormResult {
  form: UseFormReturn<FundMovementFormInput>;
  lineAccounts: AccountOption[];
  movementDetail: FundMovementRecord | null | undefined;
  type: FundMovementTypeValue;
  isContribution: boolean;
  isWithdrawal: boolean;
  isTransfer: boolean;
  isBankCharges: boolean;
  isPartnerMovement: boolean;
  isSubmitting: boolean;
  submit: (confirm: boolean) => Promise<void>;
}

/** Estado del modal de Movimientos de Fondos: formulario, queries, precarga y limpieza por tipo. */
export function useFundMovementForm({
  open,
  mode,
  movement,
  onOpenChange,
  onSuccess,
}: UseFundMovementFormParams): UseFundMovementFormResult {
  const form = useForm<FundMovementFormInput>({
    resolver: zodResolver(fundMovementSchema),
    defaultValues: emptyFundMovementFormValues(),
  });

  // Conceptos del movimiento en edición: solo BANK_CHARGES los tiene, y el
  // listado (`movement`) no los trae. Se buscan aparte para no cargar la
  // relación en el listado de los otros tres tipos, que no la usan.
  const { data: movementDetail } = useQuery({
    queryKey: ['fund-movement-detail', movement?.id],
    queryFn: () => getFundMovementById(movement!.id),
    enabled: open && Boolean(movement) && needsMovementDetail(mode, movement?.type),
  });

  // Cuentas imputables para los conceptos (egreso o activo, TSK-579): siempre
  // se piden con el modal abierto, para tenerlas listas apenas se elige el
  // tipo "Gastos e impuestos bancarios". `includeIds` preserva las cuentas ya
  // guardadas en el detalle aunque hoy no cumplan el filtro (mismo patrón que
  // `getAccountsForBankMovement`), para que reabrir un borrador con una cuenta
  // dada de baja no muestre el combo vacío (hallazgo de revisión final, TSK-585).
  const detailAccountIds = movementDetail?.lines.map((line) => line.accountId) ?? [];
  const { data: lineAccounts = [] } = useQuery({
    queryKey: ['fund-movement-line-accounts', detailAccountIds],
    queryFn: () => getFundMovementLineAccounts(detailAccountIds),
    enabled: open,
  });

  // Evita que el `useQuery` de `movementDetail` pise lo que el usuario ya
  // escribió: la cache de React Query no se invalida en ningún otro lado
  // (`router.refresh()` en `_FundMovementsTable` solo refresca el Server
  // Component), así que al reabrir un movimiento recién editado esta query
  // sirve los conceptos viejos al instante y, si después llega un refetch en
  // segundo plano con los datos frescos, `movementDetail` cambia de
  // identidad otra vez. Sin esta guarda el efecto de abajo se disparaba una
  // segunda vez con ese refetch y pisaba lo que el usuario hubiera tecleado
  // en el medio (hallazgo de revisión final, TSK-585). Por eso el reset de
  // los datos del movimiento se aplica una sola vez por apertura del modal
  // para un movimiento dado, en vez de cada vez que cambia la identidad de
  // `movementDetail`. La clave incluye el modo (`formResetKey`, TSK-720a).
  const appliedDetailRef = useRef<string | null>(null);

  // Al abrir en edición (o vista), precargar los datos del movimiento
  useEffect(() => {
    if (!open) {
      appliedDetailRef.current = null;
      return;
    }
    const key = formResetKey(mode, movement?.id);
    if (mode !== 'create') {
      if (!movement) return;
      const needsDetail = needsMovementDetail(mode, movement.type);
      // Para BANK_CHARGES hace falta esperar a que llegue `movementDetail`
      // (aunque sea de cache) antes de resetear con sus conceptos.
      if (needsDetail && !movementDetail) return;
      if (appliedDetailRef.current === key) return;
      appliedDetailRef.current = key;
      form.reset(formValuesFromMovement(movement, needsDetail ? movementDetail?.lines : null));
    } else if (appliedDetailRef.current !== key) {
      appliedDetailRef.current = key;
      form.reset(emptyFundMovementFormValues());
    }
  }, [open, mode, movement, movementDetail, form]);

  const type = form.watch('type') as FundMovementTypeValue;
  const isContribution = type === 'PARTNER_CONTRIBUTION';
  const isWithdrawal = type === 'PARTNER_WITHDRAWAL';
  const isTransfer = type === 'ACCOUNT_TRANSFER';
  const isBankCharges = type === 'BANK_CHARGES';
  const isPartnerMovement = isContribution || isWithdrawal;

  // Al cambiar el tipo de movimiento, los campos que dejan de aplicar no
  // pueden quedar colgados en el formulario: los conceptos se mandarían con
  // un tipo que no los usa, y un destino suelto de un tipo anterior se
  // resolvería igual en el servidor porque no depende de qué campos se
  // muestran en pantalla (TSK-585).
  //
  // "amount" no se toca acá: el schema lo dejó sin ninguna validación para
  // BANK_CHARGES (ni requerido, ni formato, ni "> 0"), así que un valor
  // viejo en ese campo oculto no rompe nada y no hace falta pisarlo con un
  // sentinela. El servidor igual lo ignora y calcula el importe sumando los
  // conceptos (`resolveMovementAmount`). Esto también evita que este efecto
  // le gane al `reset` de más arriba cuando se reabre un borrador
  // BANK_CHARGES para editar: antes, los dos escribían "amount" sin saber
  // uno del otro y el importe que acababa de cargar el reset (el real,
  // útil para mostrarlo si se vuelve a otro tipo) se perdía.
  //
  // El servidor persiste `partnerId` y `sourceFund` sin mirar el tipo, así
  // que faltaba limpiarlos también: antes solo se limpiaban `lines` y
  // `destinationFund`, y un gasto bancario podía guardarse con un socio
  // colgado de un tipo anterior, o un aporte de socio con un origen suelto de
  // una transferencia previa (hallazgo de revisión final, TSK-585).
  //
  // En vista no se limpia nada: mostraría menos de lo guardado (TSK-720a).
  // El tipo se lee del form y no de `type`: con la instancia compartida de
  // edición/vista, al pasar de ver un movimiento a editar otro este efecto
  // corre (cambió `mode`) en el mismo commit que el reset de arriba, y `type`
  // todavía es el del movimiento anterior (TSK-720a, fase 5).
  useEffect(() => {
    if (!shouldCleanupFieldsOnTypeChange(mode)) return;
    const currentType = form.getValues('type');
    const isBankCharges = currentType === 'BANK_CHARGES';
    const isContribution = currentType === 'PARTNER_CONTRIBUTION';
    const isPartnerMovement = isContribution || currentType === 'PARTNER_WITHDRAWAL';
    if (!isBankCharges) {
      if (form.getValues('lines')?.length) form.setValue('lines', []);
    } else {
      if (form.getValues('destinationFund')) form.setValue('destinationFund', '');
    }
    // TSK-717: solo aporte y retiro usan `partnerId` (y ahora define la cuenta
    // del asiento); una transferencia tampoco debe arrastrar un socio elegido
    // en un tipo anterior.
    if (!isPartnerMovement && form.getValues('partnerId')) form.setValue('partnerId', '');
    if (isContribution && form.getValues('sourceFund')) {
      form.setValue('sourceFund', '');
    }
  }, [mode, type, form]);

  const { isSubmitting, submit } = useFundMovementSubmit({
    form,
    mode,
    movement,
    onOpenChange,
    onSuccess,
  });

  return {
    form,
    lineAccounts,
    movementDetail,
    type,
    isContribution,
    isWithdrawal,
    isTransfer,
    isBankCharges,
    isPartnerMovement,
    isSubmitting,
    submit,
  };
}
