'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { AccountNature, AccountType } from '@/generated/prisma/enums';
import { toast } from 'sonner';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog';
import { Button } from '@/shared/components/ui/button';
import { Input } from '@/shared/components/ui/input';
import { Label } from '@/shared/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui/select';
import { Textarea } from '@/shared/components/ui/textarea';

import { accountSchema, type CreateAccountInput } from '../../../shared/types';
import { createAccountFromForm } from './actions';
import { getAccounts } from '../actions.server';
import { useState, useEffect } from 'react';

interface CreateAccountModalProps {
  companyId: string;
  onClose: () => void;
}

export function _CreateAccountModal({ companyId, onClose }: CreateAccountModalProps) {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [accounts, setAccounts] = useState<
    Array<{ id: string; code: string; name: string; type: AccountType }>
  >([]);

  const form = useForm<CreateAccountInput>({
    resolver: zodResolver(accountSchema),
  });

  useEffect(() => {
    const loadAccounts = async () => {
      try {
        const accounts = await getAccounts(companyId);
        setAccounts(accounts);
      } catch (error) {
        toast.error('Error al cargar las cuentas');
      }
    };
    loadAccounts();
  }, [companyId]);

  const handleSubmit = async (data: CreateAccountInput) => {
    setIsLoading(true);
    try {
      await createAccountFromForm({ companyId, input: data });
      toast.success('Cuenta creada correctamente');
      router.refresh();
      onClose();
    } catch (error) {
      if (error instanceof Error) {
        toast.error(error.message);
      } else {
        toast.error('Error al crear la cuenta');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const accountTypeOptions = [
    { value: AccountType.ASSET, label: 'Activo' },
    { value: AccountType.LIABILITY, label: 'Pasivo' },
    { value: AccountType.EQUITY, label: 'Patrimonio Neto' },
    { value: AccountType.REVENUE, label: 'Ingresos' },
    { value: AccountType.EXPENSE, label: 'Gastos' },
  ];

  const accountNatureOptions = [
    { value: AccountNature.DEBIT, label: 'Deudor' },
    { value: AccountNature.CREDIT, label: 'Acreedor' },
  ];

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nueva Cuenta Contable</DialogTitle>
          <DialogDescription>
            Crea una nueva cuenta en el plan de cuentas
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="code">
              Código <span className="text-destructive">*</span>
            </Label>
            <Input
              id="code"
              placeholder="1.1.1/00/00"
              {...form.register('code')}
              disabled={isLoading}
            />
            <p className="text-xs text-muted-foreground">
              Formato x.x.x/xx/xx. Los segmentos que no completes se rellenan con 0; el
              primero no puede ser 0.
            </p>
            {form.formState.errors.code && (
              <p className="text-sm text-destructive">
                {form.formState.errors.code.message}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="name">
              Nombre <span className="text-destructive">*</span>
            </Label>
            <Input
              id="name"
              {...form.register('name')}
              disabled={isLoading}
            />
            {form.formState.errors.name && (
              <p className="text-sm text-destructive">
                {form.formState.errors.name.message}
              </p>
            )}
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="type">
                Tipo <span className="text-destructive">*</span>
              </Label>
              <Select
                onValueChange={(value) => {
                  const type = value as AccountType;
                  form.setValue('type', type);
                  // Actualizar automáticamente la naturaleza
                  const validNatures: Record<AccountType, AccountNature> = {
                    [AccountType.ASSET]: AccountNature.DEBIT,
                    [AccountType.LIABILITY]: AccountNature.CREDIT,
                    [AccountType.EQUITY]: AccountNature.CREDIT,
                    [AccountType.REVENUE]: AccountNature.CREDIT,
                    [AccountType.EXPENSE]: AccountNature.DEBIT,
                  };
                  form.setValue('nature', validNatures[type]);
                  // El padre debe ser del mismo tipo: limpiar si cambia el tipo.
                  form.setValue('parentId', undefined);
                }}
                value={form.watch('type')}
                disabled={isLoading}
              >
                <SelectTrigger id="type">
                  <SelectValue placeholder="Seleccionar tipo" />
                </SelectTrigger>
                <SelectContent>
                  {accountTypeOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {form.formState.errors.type && (
                <p className="text-sm text-destructive">
                  {form.formState.errors.type.message}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="nature">
                Naturaleza <span className="text-destructive">*</span>
              </Label>
              <Select
                onValueChange={(value) => form.setValue('nature', value as AccountNature)}
                value={form.watch('nature')}
                disabled={isLoading || !form.watch('type')}
              >
                <SelectTrigger id="nature">
                  <SelectValue placeholder="Seleccionar naturaleza" />
                </SelectTrigger>
                <SelectContent>
                  {accountNatureOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {form.formState.errors.nature && (
                <p className="text-sm text-destructive">
                  {form.formState.errors.nature.message}
                </p>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="parentId">Cuenta Padre</Label>
            <Select
              onValueChange={(value) => form.setValue('parentId', value)}
              value={form.watch('parentId')}
              disabled={isLoading || !form.watch('type')}
            >
              <SelectTrigger id="parentId">
                <SelectValue
                  placeholder={
                    form.watch('type')
                      ? 'Seleccionar cuenta padre'
                      : 'Elegí primero el tipo'
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {accounts
                  .filter((account) => account.type === form.watch('type'))
                  .map((account) => (
                    <SelectItem key={account.id} value={account.id}>
                      {account.code} - {account.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Solo se listan cuentas del mismo tipo. Sin padre, la cuenta es imputable
              (recibe movimientos); al asignarle una hija, el padre pasa a ser de
              sumatoria.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Descripción</Label>
            <Textarea
              id="description"
              {...form.register('description')}
              disabled={isLoading}
            />
          </div>

          <div className="flex justify-end gap-2 pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={isLoading}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={isLoading}>
              {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Crear Cuenta
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
