'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { toast } from 'sonner';

import { getContractorsForSelect } from '@/modules/company/features/contractors/list/actions.server';
import { Button } from '@/shared/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/shared/components/ui/dialog';
import { Form } from '@/shared/components/ui/form';
import { businessToday } from '@/shared/utils/date-input';

import { createReceiptSchema, type CreateReceiptFormData } from '../../../../shared/validators';
import {
  createReceipt,
  getAvailableBankAccounts,
  getAvailableCashRegisters,
  getPendingInvoices,
  updateReceipt,
} from '../../actions.server';
import { _ReceiptBasicDataCard } from './_ReceiptBasicDataCard';
import { _ReceiptInvoicesCard } from './_ReceiptInvoicesCard';
import { _ReceiptPaymentsCard } from './_ReceiptPaymentsCard';
import { _ReceiptSummaryCard } from './_ReceiptSummaryCard';
import { _ReceiptWithholdingsCard } from './_ReceiptWithholdingsCard';
import { emptyReceiptValues, receiptTotals, type ReceiptFormInput } from './receipt-form-utils';

interface CreateReceiptModalProps {
  onSuccess: () => void;
  /** Si se pasa, el modal se controla desde afuera y no muestra el botón "Nuevo Recibo". */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Modo edición (lo abre `_EditReceiptModal`): guarda con `updateReceipt(editReceiptId, data)`. */
  editReceiptId?: string;
  editReceiptNumber?: string;
  initialValues?: CreateReceiptFormData;
  /** Número de cada factura ya imputada, por si dejó de figurar como pendiente. */
  initialInvoiceLabels?: Record<string, string>;
}

export function CreateReceiptModal({
  onSuccess,
  open: controlledOpen,
  onOpenChange,
  editReceiptId,
  editReceiptNumber,
  initialValues,
  initialInvoiceLabels = {},
}: CreateReceiptModalProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : internalOpen;
  const setOpen = (next: boolean) => (isControlled ? onOpenChange?.(next) : setInternalOpen(next));
  const isEdit = Boolean(editReceiptId);

  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(
    initialValues?.customerId ?? null
  );
  const queryClient = useQueryClient();

  const form = useForm<ReceiptFormInput, unknown, CreateReceiptFormData>({
    resolver: zodResolver(createReceiptSchema),
    defaultValues: initialValues ?? emptyReceiptValues(businessToday()),
  });

  // Lo que este borrador ya imputa a cada factura: el pendiente informado lo descuenta.
  const ownAmounts = Object.fromEntries(
    (initialValues?.items ?? []).map((item) => [item.invoiceId, Number(item.amount)])
  );

  const { data: customers = [] } = useQuery({
    queryKey: ['contractors'],
    queryFn: getContractorsForSelect,
    enabled: open,
  });
  const { data: pendingInvoices = [], isLoading: loadingInvoices } = useQuery({
    queryKey: ['pendingInvoices', selectedCustomerId],
    queryFn: () => getPendingInvoices(selectedCustomerId!),
    enabled: Boolean(selectedCustomerId),
  });
  const { data: cashRegisters = [] } = useQuery({
    queryKey: ['availableCashRegisters'],
    queryFn: getAvailableCashRegisters,
    enabled: open,
  });
  const { data: bankAccounts = [] } = useQuery({
    queryKey: ['availableBankAccounts'],
    queryFn: getAvailableBankAccounts,
    enabled: open,
  });

  const handleCustomerChange = (customerId: string) => {
    setSelectedCustomerId(customerId);
    form.setValue('customerId', customerId);
    form.setValue('items', []); // las facturas son del cliente anterior
  };

  const onSubmit = async (data: CreateReceiptFormData) => {
    try {
      if (editReceiptId) {
        const result = await updateReceipt(editReceiptId, data);
        if (!result.success) {
          toast.error(result.error);
          return;
        }
        // Que la próxima apertura cargue el recibo actualizado y no el de la caché
        queryClient.removeQueries({ queryKey: ['receipt', editReceiptId] });
        toast.success('Recibo actualizado correctamente');
      } else {
        await createReceipt(data);
        toast.success('Recibo creado correctamente');
      }
      await queryClient.invalidateQueries({ queryKey: ['receipts'] });
      await queryClient.invalidateQueries({ queryKey: ['pendingInvoices'] });

      setOpen(false);
      if (!isEdit) {
        form.reset(emptyReceiptValues(businessToday()));
        setSelectedCustomerId(null);
      }
      onSuccess();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Error al guardar el recibo');
    }
  };

  const values = useWatch({ control: form.control });
  const { difference } = receiptTotals(values);
  const hasFunds = (values.payments ?? []).length > 0 || (values.withholdings ?? []).length > 0;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {!isControlled && (
        <DialogTrigger asChild>
          <Button>
            <Plus className="mr-2 h-4 w-4" />
            Nuevo Recibo
          </Button>
        </DialogTrigger>
      )}
      <DialogContent className="md:min-w-[800px]">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? `Editar Recibo ${editReceiptNumber ?? ''}`.trim() : 'Crear Recibo de Cobro'}
          </DialogTitle>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            <_ReceiptBasicDataCard
              form={form}
              customers={customers}
              onCustomerChange={handleCustomerChange}
              customerLocked={isEdit}
            />
            <_ReceiptInvoicesCard
              form={form}
              customerId={selectedCustomerId}
              pendingInvoices={pendingInvoices}
              loading={loadingInvoices}
              ownAmounts={ownAmounts}
              invoiceLabels={initialInvoiceLabels}
            />
            <_ReceiptPaymentsCard
              form={form}
              cashRegisters={cashRegisters}
              bankAccounts={bankAccounts}
            />
            <_ReceiptWithholdingsCard form={form} />
            <_ReceiptSummaryCard values={values} />

            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancelar
              </Button>
              <Button
                type="submit"
                disabled={form.formState.isSubmitting || (hasFunds && difference !== 0)}
              >
                {isEdit ? 'Guardar Cambios' : 'Crear Recibo'}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
