'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';

import { Button } from '@/shared/components/ui/button';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui/select';
import { Switch } from '@/shared/components/ui/switch';
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card';
import { MoneyInput } from '@/shared/components/ui/money-input';
import { CardType, CardOwnerType } from '@/generated/prisma/enums';
import { CARD_TYPE_LABELS, CARD_OWNER_TYPE_LABELS } from '../../../shared/types';
import { cardSchema, type CardFormData } from '../../../shared/validators';
import { getPartnersForSelect } from '../../list/actions.server';

interface CardFormProps {
  defaultValues?: Partial<CardFormData>;
  onSubmit: (data: CardFormData) => Promise<void>;
  isSubmitting?: boolean;
  submitLabel?: string;
}

export function _CardForm({
  defaultValues,
  onSubmit,
  isSubmitting = false,
  submitLabel = 'Crear Tarjeta',
}: CardFormProps) {
  const form = useForm<CardFormData>({
    resolver: zodResolver(cardSchema),
    defaultValues: {
      name: '',
      cardType: CardType.DEBIT,
      brand: '',
      lastFour: '',
      ownerType: CardOwnerType.COMPANY,
      partnerId: '',
      creditLimit: undefined,
      closingDay: undefined,
      dueDay: undefined,
      isActive: true,
      ...defaultValues,
    },
  });

  const cardType = form.watch('cardType');
  const ownerType = form.watch('ownerType');
  const isCredit = cardType === CardType.CREDIT;
  const isPartner = ownerType === CardOwnerType.PARTNER;

  const { data: partners = [] } = useQuery({
    queryKey: ['cards', 'partners-select'],
    queryFn: getPartnersForSelect,
    enabled: isPartner,
  });

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Datos de la Tarjeta</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Alias *</FormLabel>
                    <FormControl>
                      <Input placeholder="Ej: Visa Galicia Empresa" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="cardType"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Tipo de Tarjeta *</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Seleccionar tipo" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {Object.values(CardType).map((type) => (
                          <SelectItem key={type} value={type}>
                            {CARD_TYPE_LABELS[type]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <FormField
                control={form.control}
                name="brand"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Marca (opcional)</FormLabel>
                    <FormControl>
                      <Input placeholder="Ej: Visa, Mastercard" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="lastFour"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Últimos 4 dígitos (opcional)</FormLabel>
                    <FormControl>
                      <Input placeholder="1234" maxLength={4} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Titular</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <FormField
                control={form.control}
                name="ownerType"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Tipo de Titular *</FormLabel>
                    <Select
                      onValueChange={(value) => {
                        field.onChange(value);
                        if (value !== CardOwnerType.PARTNER) {
                          form.setValue('partnerId', '');
                        }
                      }}
                      value={field.value}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Seleccionar titular" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {Object.values(CardOwnerType).map((type) => (
                          <SelectItem key={type} value={type}>
                            {CARD_OWNER_TYPE_LABELS[type]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {isPartner && (
                <FormField
                  control={form.control}
                  name="partnerId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Socio *</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value || undefined}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Seleccionar socio" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {partners.map((partner) => (
                            <SelectItem key={partner.id} value={partner.id}>
                              {partner.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}
            </div>
          </CardContent>
        </Card>

        {isCredit && (
          <Card>
            <CardHeader>
              <CardTitle>Datos de Crédito</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 md:grid-cols-3">
                <FormField
                  control={form.control}
                  name="creditLimit"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Límite de Crédito (opcional)</FormLabel>
                      <FormControl>
                        <MoneyInput
                          placeholder="0,00"
                          value={field.value ?? ''}
                          onChange={(raw) => field.onChange(raw === '' ? undefined : Number(raw))}
                          onBlur={field.onBlur}
                          name={field.name}
                          ref={field.ref}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="closingDay"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Día de Cierre (opcional)</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          min={1}
                          max={31}
                          placeholder="1-31"
                          {...field}
                          value={field.value ?? ''}
                          onChange={(e) => {
                            const value = e.target.value;
                            field.onChange(value === '' ? undefined : Number(value));
                          }}
                        />
                      </FormControl>
                      <FormDescription>Día del mes (1-31)</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="dueDay"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Día de Vencimiento (opcional)</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          min={1}
                          max={31}
                          placeholder="1-31"
                          {...field}
                          value={field.value ?? ''}
                          onChange={(e) => {
                            const value = e.target.value;
                            field.onChange(value === '' ? undefined : Number(value));
                          }}
                        />
                      </FormControl>
                      <FormDescription>Día del mes (1-31)</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Estado</CardTitle>
          </CardHeader>
          <CardContent>
            <FormField
              control={form.control}
              name="isActive"
              render={({ field }) => (
                <FormItem className="flex items-center justify-between rounded-lg border p-4">
                  <div className="space-y-0.5">
                    <FormLabel>Tarjeta activa</FormLabel>
                    <FormDescription>
                      Las tarjetas inactivas no aparecen disponibles para nuevos pagos
                    </FormDescription>
                  </div>
                  <FormControl>
                    <Switch checked={field.value ?? true} onCheckedChange={field.onChange} />
                  </FormControl>
                </FormItem>
              )}
            />
          </CardContent>
        </Card>

        <div className="flex justify-end gap-4">
          <Button type="button" variant="outline" onClick={() => window.history.back()}>
            Cancelar
          </Button>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {submitLabel}
          </Button>
        </div>
      </form>
    </Form>
  );
}
