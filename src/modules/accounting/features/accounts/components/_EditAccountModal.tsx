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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/shared/components/ui/alert-dialog';
import { AccountCombobox } from '@/shared/components/common/AccountCombobox';
import { Switch } from '@/shared/components/ui/switch';
import { Textarea } from '@/shared/components/ui/textarea';
import { usePermissions } from '@/shared/hooks/usePermissions';

import { accountSchema, type CreateAccountInput, type AccountWithChildren } from '../../../shared/types';
import { updateAccount, getAccounts } from '../actions.server';
import { useState, useEffect } from 'react';

/** Cantidad de cuentas que cuelgan de esta (todo el subárbol, no solo las hijas directas). */
function countDescendants(account: AccountWithChildren): number {
  return account.children.reduce((total, child) => total + 1 + countDescendants(child), 0);
}

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
  const { hasPermission } = usePermissions();
  const canUpdate = hasPermission('accounting.accounts', 'update');
  const descendantCount = countDescendants(account);
  // TSK-618: datos en espera de confirmación de la cascada de Bien de Uso.
  const [pendingCascadeData, setPendingCascadeData] = useState<CreateAccountInput | null>(null);

  const form = useForm<CreateAccountInput>({
    resolver: zodResolver(accountSchema),
    defaultValues: {
      code: account.code,
      name: account.name,
      type: account.type,
      nature: account.nature,
      description: account.description || undefined,
      parentId: account.parentId || undefined,
      isFixedAsset: account.isFixedAsset,
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

  const saveAccount = async (data: CreateAccountInput) => {
    setIsLoading(true);
    try {
      const result = await updateAccount(companyId, account.id, data);
      toast.success(
        result.fixedAssetCascade.applied && result.fixedAssetCascade.affectedAccountIds.length > 0
          ? `Cuenta actualizada. La marca de Bien de Uso se aplicó a ${result.fixedAssetCascade.affectedAccountIds.length} cuenta(s) del rubro.`
          : 'Cuenta actualizada correctamente'
      );
      router.refresh();
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Error al actualizar la cuenta');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmit = async (data: CreateAccountInput) => {
    // TSK-618: mover el tilde en una cuenta con hijas reescribe todo el rubro,
    // incluidas las excepciones destildadas a mano. Se avisa antes de guardar.
    const fixedAssetChanged = (data.isFixedAsset ?? false) !== account.isFixedAsset;
    if (fixedAssetChanged && descendantCount > 0) {
      setPendingCascadeData(data);
      return;
    }
    await saveAccount(data);
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
            <AccountCombobox
              id="parentId"
              accounts={accounts.filter((acc) => acc.type === form.watch('type'))}
              value={form.watch('parentId')}
              onChange={(accountId) =>
                form.setValue('parentId', accountId ?? '', { shouldValidate: true })
              }
              placeholder="Seleccionar cuenta padre"
              clearLabel={null}
              disabled={isLoading || !form.watch('type')}
            />
            <p className="text-xs text-muted-foreground">
              Solo se listan cuentas del mismo tipo.
            </p>
          </div>

          {canUpdate && (
            <div className="flex items-start justify-between gap-4 rounded-md border p-3">
              <div className="space-y-1">
                <Label htmlFor="isFixedAsset">Bien de Uso</Label>
                <p className="text-xs text-muted-foreground">
                  Marcá las cuentas del rubro Bienes de Uso. Al cargar una factura de compra
                  imputada a ellas, el sistema va a sugerir adjuntar el comprobante.
                </p>
              </div>
              <Switch
                id="isFixedAsset"
                checked={form.watch('isFixedAsset') ?? false}
                onCheckedChange={(checked) => form.setValue('isFixedAsset', checked)}
                disabled={isLoading}
              />
            </div>
          )}

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

        {pendingCascadeData && (
          <AlertDialog open onOpenChange={(open) => !open && setPendingCascadeData(null)}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  {pendingCascadeData.isFixedAsset
                    ? 'Aplicar «Bien de Uso» a todo el rubro'
                    : 'Quitar «Bien de Uso» de todo el rubro'}
                </AlertDialogTitle>
                <AlertDialogDescription asChild>
                  <div className="space-y-2 text-sm text-muted-foreground">
                    <p>
                      «{account.code} — {account.name}» tiene {descendantCount} cuenta(s)
                      debajo.
                    </p>
                    <p>
                      Al guardar, la marca de Bien de Uso se{' '}
                      {pendingCascadeData.isFixedAsset ? 'aplica' : 'quita'} en todas ellas,
                      incluidas las que hayas ajustado a mano (por ejemplo, las Amortizaciones
                      Acumuladas). Después vas a poder volver a cambiarlas una por una.
                    </p>
                  </div>
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={isLoading}>Cancelar</AlertDialogCancel>
                <AlertDialogAction
                  onClick={(e) => {
                    e.preventDefault();
                    const data = pendingCascadeData;
                    setPendingCascadeData(null);
                    saveAccount(data);
                  }}
                  disabled={isLoading}
                >
                  {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  {pendingCascadeData.isFixedAsset
                    ? 'Aplicar a todo el rubro'
                    : 'Quitar de todo el rubro'}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </DialogContent>
    </Dialog>
  );
}
