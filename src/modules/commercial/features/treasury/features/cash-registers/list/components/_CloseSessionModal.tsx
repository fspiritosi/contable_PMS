'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';

import { Button } from '@/shared/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/shared/components/ui/form';
import { Input } from '@/shared/components/ui/input';
import { Textarea } from '@/shared/components/ui/textarea';
import { Alert, AlertDescription } from '@/shared/components/ui/alert';
import { Badge } from '@/shared/components/ui/badge';
import { AlertCircle, TrendingDown, TrendingUp } from 'lucide-react';

import { closeCashSession } from '../../../sessions/actions.server';
import { closeSessionSchema, type CloseSessionFormData } from '../../../../shared/validators';
import { formatCurrency } from '@/shared/utils/formatters';

interface ActiveSession {
  id: string;
  sessionNumber: number;
  expectedBalance: number;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  session: ActiveSession;
  onSuccess: () => void;
}

export function _CloseSessionModal({ open, onOpenChange, session, onSuccess }: Props) {
  const form = useForm<CloseSessionFormData>({
    resolver: zodResolver(closeSessionSchema),
    defaultValues: {
      sessionId: session.id,
      actualBalance: '',
      closingNotes: '',
    },
  });

  // Resetear form cuando cambia el modal
  useEffect(() => {
    if (open) {
      form.reset({
        sessionId: session.id,
        actualBalance: '',
        closingNotes: '',
      });
    }
  }, [open, session.id, form]);

  // Calcular diferencia en tiempo real
  const actualBalanceValue = form.watch('actualBalance');
  const difference = useMemo(() => {
    if (!actualBalanceValue) return null;
    const actual = parseFloat(actualBalanceValue);
    if (isNaN(actual)) return null;
    return actual - session.expectedBalance;
  }, [actualBalanceValue, session.expectedBalance]);

  const onSubmit = async (data: CloseSessionFormData) => {
    try {
      await closeCashSession(data);
      toast.success('Sesión cerrada correctamente');
      onSuccess();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Error al cerrar sesión');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[550px]">
        <DialogHeader>
          <DialogTitle>Cerrar Sesión de Caja</DialogTitle>
          <DialogDescription>Sesión #{session.sessionNumber} - Arqueo de caja</DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            {/* Saldo esperado */}
            <div className="rounded-lg border bg-muted/50 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Saldo Esperado (Sistema)</p>
                  <p className="text-2xl font-bold">{formatCurrency(session.expectedBalance)}</p>
                </div>
              </div>
            </div>

            {/* Saldo real */}
            <FormField
              control={form.control}
              name="actualBalance"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Saldo Real Contado *</FormLabel>
                  <FormControl>
                    <div className="relative">
                      <span className="absolute left-3 top-2.5 text-muted-foreground">$</span>
                      <Input
                        type="text"
                        placeholder="0.00"
                        {...field}
                        value={field.value || ''}
                        className="pl-7 text-lg font-semibold"
                        onChange={(e) => {
                          // Solo permitir números y punto decimal
                          const value = e.target.value.replace(/[^0-9.]/g, '');
                          // Asegurar máximo 2 decimales
                          const parts = value.split('.');
                          if (parts.length > 2) return;
                          if (parts[1] && parts[1].length > 2) return;
                          field.onChange(value);
                        }}
                      />
                    </div>
                  </FormControl>
                  <FormDescription>Monto en efectivo contado físicamente en la caja</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Diferencia */}
            {difference !== null && (
              <Alert variant={difference === 0 ? 'default' : 'destructive'}>
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  <div className="flex items-center justify-between">
                    <span className="font-medium">Diferencia:</span>
                    <div className="flex items-center gap-2">
                      {difference > 0 ? (
                        <>
                          <TrendingUp className="h-4 w-4 text-green-600" />
                          <Badge variant="outline" className="bg-green-50 text-green-700">
                            +{formatCurrency(Math.abs(difference))} (Sobrante)
                          </Badge>
                        </>
                      ) : difference < 0 ? (
                        <>
                          <TrendingDown className="h-4 w-4 text-red-600" />
                          <Badge variant="outline" className="bg-red-50 text-red-700">
                            -{formatCurrency(Math.abs(difference))} (Faltante)
                          </Badge>
                        </>
                      ) : (
                        <Badge variant="outline" className="bg-green-50 text-green-700">
                          $0.00 (Cuadrado)
                        </Badge>
                      )}
                    </div>
                  </div>
                </AlertDescription>
              </Alert>
            )}

            {/* Notas de cierre */}
            <FormField
              control={form.control}
              name="closingNotes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Notas de Cierre</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Observaciones sobre el cierre (opcional)"
                      {...field}
                      value={field.value || ''}
                      rows={3}
                    />
                  </FormControl>
                  <FormDescription>
                    Observaciones, explicación de diferencias o comentarios sobre el cierre
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting ? 'Cerrando...' : 'Cerrar Sesión'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
