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

import { accountSchema, type CreateAccountInput, type AccountWithChildren } from '../../../shared/types';
import { updateAccount, getAccounts } from '../actions.server';
import { useState, useEffect } from 'react';

interface EditAccountModalProps {
  account: AccountWithChildren;
  companyId: string;
  onClose: () => void;
}

export function _EditAccountModal({ account, companyId, onClose }: EditAccountModalProps) {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [accounts, setAccounts] = useState<
    Array<{ id: string; code: string; name: string; type: AccountType }>
  >([]);
  const isSummatory = account.children.length > 0;

  const form = useForm<CreateAccountInput>({
    resolver: zodResolver(accountSchema),
    defaultValues: {
      code: account.code,
      name: account.name,
      type: account.type,
      nature: account.nature,
      description: account.description || undefined,
      parentId: account.parentId || undefined,
    },
  });

  useEffect(() => {
    const loadAccounts = async () => {
      try {
        // Excluir la cuenta actual y sus hijos para evitar ciclos
        const allAccounts = await getAccounts(companyId);
        const excludeIds = new Set([account.id]);
        const getChildIds = (acc: AccountWithChildren) => {
          acc.children.forEach(child => {
            excludeIds.add(child.id);
            getChildIds(child);
          });
        };
        getChildIds(account);
        
        const filteredAccounts = allAccounts.filter(acc => !excludeIds.has(acc.id));
        setAccounts(filteredAccounts);
      } catch (error) {
        toast.error('Error al cargar las cuentas');
      }
    };
    loadAccounts();
  }, [companyId, account]);

  const handleSubmit = async (data: CreateAccountInput) => {
    setIsLoading(true);
    try {
      await updateAccount(companyId, account.id, data);
      toast.success('Cuenta actualizada correctamente');
      router.refresh();
      onClose();
    } catch (error) {
      toast.error('Error al actualizar la cuenta');
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
          <DialogTitle>Editar Cuenta Contable</DialogTitle>
          <DialogDescription>
            Modifica los datos de la cuenta contable
          </DialogDescription>
        </DialogHeader>

        <p className="text-xs text-muted-foreground">
          Esta cuenta es{' '}
          <strong>{isSummatory ? 'de sumatoria' : 'imputable'}</strong>
          {isSummatory
            ? ' (agrupa a sus hijas y no recibe movimientos directos).'
            : ' (hoja: recibe movimientos).'}
        </p>

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
                  form.setValue('type', value as AccountType);
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
                disabled={isLoading}
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
                <SelectValue placeholder="Seleccionar cuenta padre" />
              </SelectTrigger>
              <SelectContent>
                {accounts
                  .filter((acc) => acc.type === form.watch('type'))
                  .map((acc) => (
                    <SelectItem key={acc.id} value={acc.id}>
                      {acc.code} - {acc.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Solo se listan cuentas del mismo tipo.
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
              Guardar Cambios
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
