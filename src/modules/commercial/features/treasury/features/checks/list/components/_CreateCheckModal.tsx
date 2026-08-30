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
import { Textarea } from '@/shared/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui/select';
import { Button } from '@/shared/components/ui/button';
import { MoneyInput } from '@/shared/components/ui/money-input';
import { createCheckSchema, type CreateCheckFormData, CHECK_TYPE_LABELS } from '../../../../shared/validators';
import { createCheck } from '../../actions.server';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function _CreateCheckModal({ open, onOpenChange }: Props) {
  const router = useRouter();

  const form = useForm<CreateCheckFormData>({
    resolver: zodResolver(createCheckSchema),
    defaultValues: {
      type: 'THIRD_PARTY',
      checkNumber: '',
      bankName: '',
      branch: null,
      accountNumber: null,
      amount: '',
      issueDate: new Date(),
      dueDate: new Date(),
      drawerName: '',
      drawerTaxId: null,
      payeeName: null,
      customerId: null,
      supplierId: null,
      notes: null,
    },
  });

  const { isSubmitting } = form.formState;

  const handleClose = useCallback(() => {
    form.reset();
    onOpenChange(false);
  }, [form, onOpenChange]);

  const onSubmit = async (values: CreateCheckFormData) => {
    try {
      await createCheck(values);
      toast.success('Cheque creado correctamente');
      handleClose();
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Error al crear cheque');
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Nuevo Cheque</DialogTitle>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {/* Tipo */}
              <FormField
                control={form.control}
                name="type"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Tipo de Cheque</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Seleccionar tipo" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {(Object.keys(CHECK_TYPE_LABELS) as Array<keyof typeof CHECK_TYPE_LABELS>).map(
                          (key) => (
                            <SelectItem key={key} value={key}>
                              {CHECK_TYPE_LABELS[key]}
                            </SelectItem>
                          )
                        )}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Número de cheque */}
              <FormField
                control={form.control}
                name="checkNumber"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Número de Cheque</FormLabel>
                    <FormControl>
                      <Input placeholder="Ej: 00001234" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Banco */}
              <FormField
                control={form.control}
                name="bankName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Banco</FormLabel>
                    <FormControl>
                      <Input placeholder="Ej: Banco Nación" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Sucursal */}
              <FormField
                control={form.control}
                name="branch"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Sucursal (opcional)</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="Ej: Suc. Centro"
                        {...field}
                        value={field.value ?? ''}
                        onChange={(e) => field.onChange(e.target.value || null)}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Monto */}
              <FormField
                control={form.control}
                name="amount"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Monto</FormLabel>
                    <FormControl>
                      <MoneyInput
                        placeholder="0,00"
                        value={field.value}
                        onChange={field.onChange}
                        onBlur={field.onBlur}
                        name={field.name}
                        ref={field.ref}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Librador */}
              <FormField
                control={form.control}
                name="drawerName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Librador</FormLabel>
                    <FormControl>
                      <Input placeholder="Nombre del librador" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* CUIT Librador */}
              <FormField
                control={form.control}
                name="drawerTaxId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>CUIT Librador (opcional)</FormLabel>
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

              {/* Beneficiario */}
              <FormField
                control={form.control}
                name="payeeName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Beneficiario (opcional)</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="Nombre del beneficiario"
                        {...field}
                        value={field.value ?? ''}
                        onChange={(e) => field.onChange(e.target.value || null)}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Fecha de Emisión */}
              <FormField
                control={form.control}
                name="issueDate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Fecha de Emisión</FormLabel>
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

              {/* Fecha de Vencimiento */}
              <FormField
                control={form.control}
                name="dueDate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Fecha de Vencimiento</FormLabel>
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
            </div>

            {/* Notas */}
            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Notas (opcional)</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Observaciones adicionales..."
                      rows={3}
                      {...field}
                      value={field.value ?? ''}
                      onChange={(e) => field.onChange(e.target.value || null)}
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
                {isSubmitting ? 'Creando...' : 'Crear Cheque'}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
