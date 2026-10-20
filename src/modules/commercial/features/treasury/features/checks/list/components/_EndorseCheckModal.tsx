'use client';

import { useCallback } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import moment from 'moment';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/shared/components/ui/form';
import { Input } from '@/shared/components/ui/input';
import { Button } from '@/shared/components/ui/button';
import { formatCurrency } from '@/shared/utils/formatters';
import { businessToday } from '@/shared/utils/date-input';
import { endorseCheckSchema, type EndorseCheckFormData } from '../../../../shared/validators';
import { endorseCheck } from '../../actions.server';
import type { CheckListItem } from '../../../../shared/types';

interface Props {
  check: CheckListItem;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function _EndorseCheckModal({ check, open, onOpenChange }: Props) {
  const router = useRouter();

  const form = useForm<EndorseCheckFormData>({
    resolver: zodResolver(endorseCheckSchema),
    defaultValues: {
      checkId: check.id,
      endorsedToName: '',
      endorsedToTaxId: null,
      supplierId: null,
      endorsedDate: businessToday(),
    },
  });

  const { isSubmitting } = form.formState;

  const handleClose = useCallback(() => {
    form.reset({
      checkId: check.id,
      endorsedToName: '',
      endorsedToTaxId: null,
      supplierId: null,
      endorsedDate: businessToday(),
    });
    onOpenChange(false);
  }, [form, check.id, onOpenChange]);

  const onSubmit = async (values: EndorseCheckFormData) => {
    try {
      await endorseCheck(values);
      toast.success('Cheque endosado correctamente');
      handleClose();
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Error al endosar cheque');
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Endosar Cheque</DialogTitle>
        </DialogHeader>

        <div className="mb-2 rounded-md bg-muted p-3 text-sm">
          <p className="font-medium">Cheque N° {check.checkNumber}</p>
          <p className="text-muted-foreground">{check.bankName}</p>
          <p className="mt-1 text-lg font-bold">{formatCurrency(check.amount)}</p>
          <p className="text-muted-foreground">
            Vence: {moment(check.dueDate).format('DD/MM/YYYY')}
          </p>
        </div>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            {/* Beneficiario del endoso */}
            <FormField
              control={form.control}
              name="endorsedToName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Endosado a</FormLabel>
                  <FormControl>
                    <Input placeholder="Nombre del beneficiario" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* CUIT beneficiario */}
            <FormField
              control={form.control}
              name="endorsedToTaxId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>CUIT Beneficiario (opcional)</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="Ej: 20-12345678-9"
                      {...field}
                      value={field.value ?? ''}
                      onChange={(e) => field.onChange(e.target.value || null)}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Fecha de endoso */}
            <FormField
              control={form.control}
              name="endorsedDate"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Fecha de Endoso</FormLabel>
                  <FormControl>
                    <Input
                      type="date"
                      value={field.value ? moment(field.value).format('YYYY-MM-DD') : ''}
                      onChange={(e) =>
                        field.onChange(e.target.value ? new Date(e.target.value) : null)
                      }
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={handleClose} disabled={isSubmitting}>
                Cancelar
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? 'Endosando...' : 'Endosar Cheque'}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
