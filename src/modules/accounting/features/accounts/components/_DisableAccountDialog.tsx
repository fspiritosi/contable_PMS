'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';

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
import { type AccountWithChildren } from '../../../shared/types';
import { disableAccount } from '../actions.server';

interface DisableAccountDialogProps {
  account: AccountWithChildren;
  companyId: string;
  onClose: () => void;
}

export function _DisableAccountDialog({ account, companyId, onClose }: DisableAccountDialogProps) {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const hasChildren = account.children.length > 0;

  const handleDisable = async () => {
    setIsLoading(true);
    try {
      const result = await disableAccount(companyId, account.id);
      const current = result.cutInCurrentFiscalYear.length;
      const next = result.cutInNextFiscalYear.length;

      const parts: string[] = [];
      if (current > 0) parts.push(`${current} en el ejercicio en curso`);
      if (next > 0) parts.push(`${next} desde el próximo ejercicio`);

      toast.success(
        `Cuenta deshabilitada (${result.affectedAccountIds.length} cuenta(s) afectada(s))` +
          (parts.length ? `: ${parts.join(', ')}.` : '.')
      );
      router.refresh();
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Error al deshabilitar la cuenta');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <AlertDialog open onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            Deshabilitar «{account.code} - {account.name}»
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2 text-sm text-muted-foreground">
              <p>Se aplicará la siguiente regla según el saldo de cada cuenta:</p>
              <ul className="list-disc space-y-1 pl-5">
                <li>
                  Las cuentas con <strong>saldo 0</strong> se deshabilitan en el{' '}
                  <strong>ejercicio en curso</strong>.
                </li>
                <li>
                  Las cuentas <strong>con saldo</strong> se deshabilitan a partir del{' '}
                  <strong>próximo ejercicio</strong> (requiere que exista).
                </li>
              </ul>
              {hasChildren && (
                <p>
                  Esta es una cuenta de <strong>sumatoria</strong>: la baja se aplica{' '}
                  <strong>en cascada</strong> a todas sus cuentas hijas, cada una según su
                  propio saldo.
                </p>
              )}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isLoading}>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              handleDisable();
            }}
            disabled={isLoading}
          >
            {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Deshabilitar
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
