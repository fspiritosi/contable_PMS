'use client';

import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import moment from 'moment';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/shared/components/ui/dialog';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/shared/components/ui/form';
import { Input } from '@/shared/components/ui/input';
import { Textarea } from '@/shared/components/ui/textarea';
import { Button } from '@/shared/components/ui/button';
import { Skeleton } from '@/shared/components/ui/skeleton';
import { businessToday } from '@/shared/utils/date-input';
import { updateCheckSchema, type UpdateCheckFormData } from '../../../../shared/validators';
import { updateCheck, getCheckById } from '../../actions.server';

interface Props {
  checkId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function _EditCheckModal({ checkId, open, onOpenChange }: Props) {
  const router = useRouter();

  const form = useForm<UpdateCheckFormData>({
    resolver: zodResolver(updateCheckSchema),
    defaultValues: {
      checkId,
      checkNumber: '',
      bankName: '',
      branch: null,
      accountNumber: null,
      issueDate: businessToday(),
      dueDate: businessToday(),
      drawerName: '',
      drawerTaxId: null,
      payeeName: null,
      notes: null,
    },
  });

  const { isSubmitting } = form.formState;

  const { data: check, isLoading } = useQuery({
    queryKey: ['check', checkId],
    queryFn: () => getCheckById(checkId),
    enabled: open,
  });

  // Prefijar el formulario cuando se cargan los datos del cheque
  useEffect(() => {
    if (check) {
      form.reset({
        checkId: check.id,
        checkNumber: check.checkNumber,
        bankName: check.bankName,
        branch: check.branch,
        accountNumber: check.accountNumber,
        issueDate: new Date(check.issueDate),
        dueDate: new Date(check.dueDate),
        drawerName: check.drawerName,
        drawerTaxId: check.drawerTaxId,
        payeeName: check.payeeName,
        notes: check.notes,
      });
    }
  }, [check, form]);

  const onSubmit = async (values: UpdateCheckFormData) => {
    try {
      await updateCheck(values);
      toast.success('Cheque actualizado correctamente');
      onOpenChange(false);
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Error al actualizar cheque');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Editar Cheque</DialogTitle>
        </DialogHeader>

        {isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : (
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name="checkNumber"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Número *</FormLabel>
                      <FormControl>
                        <Input placeholder="123456" {...field} value={field.value || ''} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="bankName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Banco emisor *</FormLabel>
                      <FormControl>
                        <Input placeholder="Banco Nación" {...field} value={field.value || ''} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="drawerName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Librador / Emisor *</FormLabel>
                      <FormControl>
                        <Input placeholder="Nombre del emisor" {...field} value={field.value || ''} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="drawerTaxId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>CUIT del emisor (opcional)</FormLabel>
                      <FormControl>
                        <Input placeholder="30-12345678-9" {...field} value={field.value || ''} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="issueDate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Fecha de emisión *</FormLabel>
                      <FormControl>
                        <Input
                          type="date"
                          value={field.value ? moment(field.value).format('YYYY-MM-DD') : ''}
                          onChange={(e) =>
                            field.onChange(e.target.value ? new Date(e.target.value + 'T12:00:00') : null)
                          }
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="dueDate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Fecha de vencimiento *</FormLabel>
                      <FormControl>
                        <Input
                          type="date"
                          value={field.value ? moment(field.value).format('YYYY-MM-DD') : ''}
                          onChange={(e) =>
                            field.onChange(e.target.value ? new Date(e.target.value + 'T12:00:00') : null)
                          }
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="branch"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Sucursal (opcional)</FormLabel>
                      <FormControl>
                        <Input placeholder="Sucursal" {...field} value={field.value || ''} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="accountNumber"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>N° de cuenta (opcional)</FormLabel>
                      <FormControl>
                        <Input placeholder="Cuenta" {...field} value={field.value || ''} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="notes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Notas (opcional)</FormLabel>
                    <FormControl>
                      <Textarea placeholder="Observaciones" {...field} value={field.value || ''} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
                  Cancelar
                </Button>
                <Button type="submit" disabled={isSubmitting}>
                  {isSubmitting ? 'Guardando...' : 'Guardar'}
                </Button>
              </div>
            </form>
          </Form>
        )}
      </DialogContent>
    </Dialog>
  );
}
