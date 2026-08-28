'use client';

import { useState, useMemo, useCallback, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import moment from 'moment';
import { Button } from '@/shared/components/ui/button';
import { Input } from '@/shared/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card';
import { MoneyInput } from '@/shared/components/ui/money-input';
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from '@/shared/components/ui/alert';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/shared/components/ui/alert-dialog';
import { CheckCircle, Loader2, Pencil, Search, Info } from 'lucide-react';
import { AccountType } from '@/generated/prisma/enums';
import { usePermissions } from '@/shared/hooks/usePermissions';
import { saveOpeningBalanceEntry } from '../actions.server';
import type { OpeningBalancesPageData } from '../types';
import { formatAmount } from '../../../shared/utils';

type AccountForOpening = OpeningBalancesPageData['accounts'][number];
type ExistingEntry = OpeningBalancesPageData['existingOpeningEntry'];
type AperturaAccount = OpeningBalancesPageData['aperturaAccount'];
type Settings = NonNullable<OpeningBalancesPageData['settings']>;

interface BalanceMap {
  [accountId: string]: { debit: string; credit: string };
}

interface Props {
  accounts: AccountForOpening[];
  settings: Settings;
  existingEntry: ExistingEntry;
  aperturaAccount: AperturaAccount;
}

const TYPE_LABELS: Record<AccountType, string> = {
  ASSET: 'Activo',
  LIABILITY: 'Pasivo',
  EQUITY: 'Patrimonio Neto',
  REVENUE: 'Ingresos',
  EXPENSE: 'Gastos',
};

const TYPE_ORDER: AccountType[] = [
  AccountType.ASSET,
  AccountType.LIABILITY,
  AccountType.EQUITY,
  AccountType.REVENUE,
  AccountType.EXPENSE,
];

export function _AccountBalancesForm({
  accounts,
  settings,
  existingEntry,
  aperturaAccount,
}: Props) {
  const router = useRouter();
  const { hasPermission } = usePermissions();
  const [isPending, startTransition] = useTransition();
  const [searchTerm, setSearchTerm] = useState('');
  const [editMode, setEditMode] = useState(!existingEntry);

  // Inicializar balances desde el asiento existente
  const [balances, setBalances] = useState<BalanceMap>(() => {
    if (!existingEntry) return {};

    const map: BalanceMap = {};
    for (const line of existingEntry.lines) {
      // Excluir la línea de la cuenta Apertura
      if (
        aperturaAccount &&
        line.accountId === aperturaAccount.id
      ) {
        continue;
      }
      if (line.debit > 0 || line.credit > 0) {
        map[line.accountId] = {
          debit: line.debit > 0 ? line.debit.toString() : '',
          credit: line.credit > 0 ? line.credit.toString() : '',
        };
      }
    }
    return map;
  });

  // Filtrar cuentas por búsqueda
  const filteredAccounts = useMemo(() => {
    if (!searchTerm) return accounts;
    const term = searchTerm.toLowerCase();
    return accounts.filter(
      (a) =>
        a.code.toLowerCase().includes(term) ||
        a.name.toLowerCase().includes(term)
    );
  }, [accounts, searchTerm]);

  // Agrupar por tipo
  const groupedAccounts = useMemo(() => {
    const groups = new Map<AccountType, AccountForOpening[]>();
    for (const type of TYPE_ORDER) {
      const typeAccounts = filteredAccounts.filter((a) => a.type === type);
      if (typeAccounts.length > 0) {
        groups.set(type, typeAccounts);
      }
    }
    return groups;
  }, [filteredAccounts]);

  // Calcular totales
  const totals = useMemo(() => {
    let totalDebit = 0;
    let totalCredit = 0;

    for (const { debit, credit } of Object.values(balances)) {
      totalDebit += parseFloat(debit || '0');
      totalCredit += parseFloat(credit || '0');
    }

    return {
      totalDebit,
      totalCredit,
      difference: totalDebit - totalCredit,
    };
  }, [balances]);

  const hasChanges = Object.keys(balances).length > 0;

  const handleDebitChange = useCallback(
    (accountId: string, value: string) => {
      setBalances((prev) => ({
        ...prev,
        [accountId]: {
          debit: value,
          credit: value ? '' : prev[accountId]?.credit || '',
        },
      }));
    },
    []
  );

  const handleCreditChange = useCallback(
    (accountId: string, value: string) => {
      setBalances((prev) => ({
        ...prev,
        [accountId]: {
          debit: value ? '' : prev[accountId]?.debit || '',
          credit: value,
        },
      }));
    },
    []
  );

  const handleSubmit = () => {
    const nonZeroBalances = Object.entries(balances)
      .map(([accountId, { debit, credit }]) => ({
        accountId,
        debit: parseFloat(debit || '0'),
        credit: parseFloat(credit || '0'),
      }))
      .filter((b) => b.debit > 0 || b.credit > 0);

    if (nonZeroBalances.length === 0) {
      toast.error('Ingresá al menos un saldo');
      return;
    }

    startTransition(async () => {
      try {
        const result = await saveOpeningBalanceEntry(
          { balances: nonZeroBalances },
          !!existingEntry
        );

        if (result.success) {
          toast.success(
            existingEntry
              ? `Asiento de apertura N° ${result.entryNumber} actualizado`
              : `Asiento de apertura N° ${result.entryNumber} creado`
          );
          router.refresh();
        }
      } catch (error) {
        const msg =
          error instanceof Error ? error.message : 'Error desconocido';
        toast.error(msg);
      }
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span>Asiento de Apertura</span>
          <span className="text-sm font-normal text-muted-foreground">
            Fecha: {moment(settings.fiscalYearStart).format('DD/MM/YYYY')}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Banner de asiento existente */}
        {existingEntry && !editMode && (
          <Alert>
            <CheckCircle className="h-4 w-4 text-green-500" />
            <AlertTitle>Asiento de Apertura registrado</AlertTitle>
            <AlertDescription className="flex items-center justify-between">
              <span>
                Asiento N° {existingEntry.number} -{' '}
                {existingEntry.lines.length} líneas
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setEditMode(true)}
              >
                <Pencil className="mr-1 h-3.5 w-3.5" />
                Editar
              </Button>
            </AlertDescription>
          </Alert>
        )}

        {editMode && (
          <>
            {/* Buscador */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Buscar cuenta por código o nombre..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-9"
              />
            </div>

            {/* Grilla de cuentas agrupada por tipo */}
            <div className="space-y-4">
              {TYPE_ORDER.map((type) => {
                const typeAccounts = groupedAccounts.get(type);
                if (!typeAccounts || typeAccounts.length === 0) return null;

                return (
                  <div key={type}>
                    <h3 className="mb-2 text-sm font-semibold text-muted-foreground uppercase">
                      {TYPE_LABELS[type]}
                    </h3>

                    {/* Header */}
                    <div className="hidden sm:grid sm:grid-cols-[1fr_120px_120px] gap-2 mb-1 px-2 text-xs font-medium text-muted-foreground">
                      <span>Cuenta</span>
                      <span className="text-right">Debe</span>
                      <span className="text-right">Haber</span>
                    </div>

                    {/* Rows */}
                    <div className="space-y-1">
                      {typeAccounts.map((account) => {
                        const balance = balances[account.id];
                        return (
                          <div
                            key={account.id}
                            className="grid grid-cols-1 sm:grid-cols-[1fr_120px_120px] gap-2 items-center rounded-md px-2 py-1.5 hover:bg-muted/50"
                          >
                            <span className="text-sm min-w-0 truncate">
                              <span className="font-mono text-muted-foreground mr-2">
                                {account.code}
                              </span>
                              {account.name}
                            </span>
                            <div className="flex items-center gap-2 sm:block">
                              <span className="text-xs text-muted-foreground sm:hidden">
                                Debe:
                              </span>
                              <MoneyInput
                                placeholder="0,00"
                                value={balance?.debit || ''}
                                onChange={(raw) => handleDebitChange(account.id, raw)}
                                className="h-8 text-right text-sm"
                              />
                            </div>
                            <div className="flex items-center gap-2 sm:block">
                              <span className="text-xs text-muted-foreground sm:hidden">
                                Haber:
                              </span>
                              <MoneyInput
                                placeholder="0,00"
                                value={balance?.credit || ''}
                                onChange={(raw) => handleCreditChange(account.id, raw)}
                                className="h-8 text-right text-sm"
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Footer con totales */}
            <div className="border-t pt-4 space-y-2">
              <div className="grid grid-cols-1 sm:grid-cols-[1fr_120px_120px] gap-2 px-2">
                <span className="font-semibold text-sm">Totales</span>
                <span className="text-right font-semibold text-sm">
                  {formatAmount(totals.totalDebit)}
                </span>
                <span className="text-right font-semibold text-sm">
                  {formatAmount(totals.totalCredit)}
                </span>
              </div>

              {/* Diferencia / Línea de Apertura */}
              {Math.abs(totals.difference) > 0.001 && (
                <Alert>
                  <Info className="h-4 w-4" />
                  <AlertTitle>Línea de balanceo automática</AlertTitle>
                  <AlertDescription>
                    La diferencia de{' '}
                    <strong>{formatAmount(Math.abs(totals.difference))}</strong>{' '}
                    se imputará automáticamente a la cuenta{' '}
                    <strong>Apertura (Patrimonio Neto)</strong> como{' '}
                    {totals.difference > 0 ? 'Haber' : 'Debe'}.
                  </AlertDescription>
                </Alert>
              )}

              {/* Botón de submit */}
              {hasPermission('accounting.opening-balances', 'create') && (
                <div className="flex justify-end">
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button disabled={!hasChanges || isPending}>
                        {isPending && (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        )}
                        {existingEntry
                          ? 'Actualizar Asiento de Apertura'
                          : 'Registrar Asiento de Apertura'}
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>
                          {existingEntry
                            ? '¿Actualizar asiento de apertura?'
                            : '¿Registrar asiento de apertura?'}
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                          {existingEntry
                            ? 'Se reemplazarán las líneas del asiento existente con los nuevos saldos.'
                            : 'Se creará un asiento contable POSTED con los saldos ingresados. La fecha será el inicio del ejercicio fiscal.'}
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancelar</AlertDialogCancel>
                        <AlertDialogAction onClick={handleSubmit}>
                          Confirmar
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
