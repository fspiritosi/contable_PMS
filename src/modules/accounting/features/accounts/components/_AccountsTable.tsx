'use client';

import * as React from 'react';
import { Button } from '@/shared/components/ui/button';
import { AccountType, AccountNature } from '@/generated/prisma/enums';
import { type AccountWithChildren } from '../../../shared/types';
import { ChevronRight, ChevronDown, MoreHorizontal, Edit, Trash, Ban } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/shared/components/ui/dropdown-menu';
import { Badge } from '@/shared/components/ui/badge';
import { useMemo, useRef, useState } from 'react';
import { usePermissions } from '@/shared/hooks/usePermissions';
import { formatCurrency } from '@/shared/utils/formatters';
import { cn } from '@/shared/lib/utils';
import { _EditAccountModal } from './_EditAccountModal';
import { _DeleteAccountDialog } from './_DeleteAccountDialog';
import { _DisableAccountDialog } from './_DisableAccountDialog';
import { _AccountsSearchBar } from './_AccountsSearchBar';
import { accountMatches, filterAccountTree } from '../lib/account-tree-filter';

// Wrappers para manejar props asíncronas
function AsyncEditModalWrapper({ account, companyId, onClose }: { account: AccountWithChildren, companyId: string, onClose: () => void }) {
  return <_EditAccountModal account={account} companyId={companyId} onClose={onClose} />;
}

function AsyncDeleteDialogWrapper({ account, companyId, onClose }: { account: AccountWithChildren, companyId: string, onClose: () => void }) {
  return <_DeleteAccountDialog account={account} companyId={companyId} onClose={onClose} />;
}

interface AccountsTableProps {
  accounts: AccountWithChildren[];
  companyId: string;
  /** Saldos por cuenta (con roll-up para cuentas de sumatoria). */
  balances: Record<string, number>;
  /** Inicio del ejercicio en curso, para determinar el estado vigente. */
  fiscalYearStart: Date | null;
  /** Número del ejercicio en curso (informativo en el estado). */
  fiscalYearNumber: number | null;
}

export function _AccountsTable({
  accounts,
  companyId,
  balances,
  fiscalYearStart,
  fiscalYearNumber,
}: AccountsTableProps) {
  const { hasPermission } = usePermissions();
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [editAccount, setEditAccount] = useState<AccountWithChildren | null>(null);
  const [deleteAccount, setDeleteAccount] = useState<AccountWithChildren | null>(null);
  const [disableAccountTarget, setDisableAccountTarget] = useState<AccountWithChildren | null>(null);
  const [query, setQuery] = useState('');
  // Lo que estaba abierto antes de buscar, para devolverlo al limpiar la búsqueda.
  const expandedBeforeSearch = useRef<Set<string> | null>(null);
  const searching = query.trim() !== '';
  const filtered = useMemo(() => filterAccountTree(accounts, query), [accounts, query]);
  const canUpdate = hasPermission('accounting.accounts', 'update');
  const canDelete = hasPermission('accounting.accounts', 'delete');

  const fyStart = fiscalYearStart ? new Date(fiscalYearStart) : null;

  // Estado de la cuenta respecto del ejercicio en curso.
  const getAccountStatus = (
    account: AccountWithChildren
  ): { label: string; variant: 'secondary' | 'outline' | 'destructive' } => {
    if (!account.isActive) {
      return { label: 'Deshabilitada', variant: 'destructive' };
    }
    if (account.disabledFrom) {
      const cut = new Date(account.disabledFrom);
      const alreadyCut = fyStart ? cut <= fyStart : cut <= new Date();
      if (alreadyCut) {
        return { label: 'Deshabilitada', variant: 'destructive' };
      }
      return { label: 'Baja programada', variant: 'outline' };
    }
    return { label: 'Vigente', variant: 'secondary' };
  };

  // Al buscar se abren las sumatorias que llevan a cada coincidencia; al limpiar,
  // vuelve la expansión que había. Después el usuario puede abrir y cerrar a mano.
  const handleQueryChange = (value: string) => {
    if (value.trim() === '') {
      setExpandedRows(expandedBeforeSearch.current ?? new Set());
      expandedBeforeSearch.current = null;
    } else {
      if (expandedBeforeSearch.current === null) expandedBeforeSearch.current = expandedRows;
      setExpandedRows(filterAccountTree(accounts, value).expandedIds);
    }
    setQuery(value);
  };

  const toggleRow = (accountId: string) => {
    const newExpanded = new Set(expandedRows);
    if (newExpanded.has(accountId)) {
      newExpanded.delete(accountId);
    } else {
      newExpanded.add(accountId);
    }
    setExpandedRows(newExpanded);
  };

  const renderAccountRow = (account: AccountWithChildren, level = 0): React.ReactNode => {
    const hasChildren = account.children.length > 0;
    const isExpanded = expandedRows.has(account.id);
    const paddingLeft = `${level * 2}rem`;

    const getAccountTypeLabel = (type: AccountType) => {
      const labels = {
        [AccountType.ASSET]: 'Activo',
        [AccountType.LIABILITY]: 'Pasivo',
        [AccountType.EQUITY]: 'Patrimonio',
        [AccountType.REVENUE]: 'Ingresos',
        [AccountType.EXPENSE]: 'Gastos',
      };
      return labels[type];
    };

    const getAccountNatureLabel = (nature: AccountNature) => {
      return nature === AccountNature.DEBIT ? 'Deudor' : 'Acreedor';
    };

    return (
      <>
        <tr
          key={account.id}
          className={cn(
            !account.isActive && 'opacity-50',
            searching && accountMatches(account, query) && 'bg-primary/5 font-medium'
          )}
        >
          <td className="py-2">
            <div className="flex items-center" style={{ paddingLeft }}>
              {hasChildren ? (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={() => toggleRow(account.id)}
                >
                  {isExpanded ? (
                    <ChevronDown className="h-4 w-4" />
                  ) : (
                    <ChevronRight className="h-4 w-4" />
                  )}
                </Button>
              ) : (
                <div className="w-6" />
              )}
              <span className="ml-2">{account.code}</span>
            </div>
          </td>
          <td>
            {account.name}
            {hasChildren && (
              <span className="ml-2 text-xs text-muted-foreground">(sumatoria)</span>
            )}
            {/* TSK-618: marca de Bien de Uso. `title` en vez de Tooltip para no
                meter un provider en una tabla que renderiza cientos de filas. */}
            {account.isFixedAsset && (
              <Badge variant="outline" className="ml-2" title="Bien de Uso">
                BU
              </Badge>
            )}
          </td>
          <td>{getAccountTypeLabel(account.type)}</td>
          <td>{getAccountNatureLabel(account.nature)}</td>
          <td className="text-right tabular-nums">{formatCurrency(balances[account.id] ?? 0)}</td>
          <td>
            {(() => {
              const status = getAccountStatus(account);
              return <Badge variant={status.variant}>{status.label}</Badge>;
            })()}
          </td>
          <td className="text-right">
            {(canUpdate || canDelete) && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon">
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {canUpdate && (
                    <DropdownMenuItem onClick={() => setEditAccount(account)}>
                      <Edit className="mr-2 h-4 w-4" />
                      Editar
                    </DropdownMenuItem>
                  )}
                  {canUpdate && account.isActive && !account.disabledFrom && (
                    <DropdownMenuItem onClick={() => setDisableAccountTarget(account)}>
                      <Ban className="mr-2 h-4 w-4" />
                      Deshabilitar
                    </DropdownMenuItem>
                  )}
                  {canDelete && (
                    <DropdownMenuItem
                      onClick={() => setDeleteAccount(account)}
                      className="text-destructive"
                    >
                      <Trash className="mr-2 h-4 w-4" />
                      Eliminar
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </td>
        </tr>
        {isExpanded &&
          account.children.map((child) => renderAccountRow(child, level + 1))}
      </>
    );
  };

  return (
    <div className="space-y-3">
      <_AccountsSearchBar
        value={query}
        onChange={handleQueryChange}
        matchCount={filtered.matchCount}
      />
      <div className="rounded-md border">
        <table className="w-full">
          <thead>
            <tr className="border-b bg-muted/50">
              <th className="py-3 pl-4 text-left">Código</th>
              <th className="py-3 text-left">Nombre</th>
              <th className="py-3 text-left">Tipo</th>
              <th className="py-3 text-left">Naturaleza</th>
              <th className="py-3 text-right">
                Saldo{fiscalYearNumber ? ` (Ej. ${fiscalYearNumber})` : ''}
              </th>
              <th className="py-3 text-left">Estado</th>
              <th className="py-3 pr-4 text-right">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {filtered.tree.map((account) => renderAccountRow(account))}
            {searching && filtered.tree.length === 0 && (
              <tr>
                <td colSpan={7} className="py-8 text-center text-sm text-muted-foreground">
                  No hay cuentas que coincidan con «{query.trim()}».
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {editAccount && (
        <AsyncEditModalWrapper
          account={editAccount}
          companyId={companyId}
          onClose={() => setEditAccount(null)}
        />
      )}

      {deleteAccount && (
        <AsyncDeleteDialogWrapper
          account={deleteAccount}
          companyId={companyId}
          onClose={() => setDeleteAccount(null)}
        />
      )}

      {disableAccountTarget && (
        <_DisableAccountDialog
          account={disableAccountTarget}
          companyId={companyId}
          onClose={() => setDisableAccountTarget(null)}
        />
      )}
    </div>
  );
}
