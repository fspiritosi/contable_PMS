'use client';

import { useMemo, useState } from 'react';
import { MoreHorizontal, Pencil, Power, PowerOff, DollarSign, History } from 'lucide-react';
import moment from 'moment';
import { toast } from 'sonner';

import { DataTable, type DataTableFacetedFilterConfig } from '@/shared/components/common/DataTable';
import type { ColumnDef } from '@tanstack/react-table';
import { Badge } from '@/shared/components/ui/badge';
import { Button } from '@/shared/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/shared/components/ui/dropdown-menu';

import { activateCashRegister, deactivateCashRegister } from '../../actions.server';
import type { CashRegisterWithActiveSession } from '../../../../shared/types';
import { usePermissions } from '@/shared/hooks/usePermissions';
import {
  CASH_REGISTER_STATUS_LABELS,
  CASH_REGISTER_STATUS_BADGES,
  SESSION_STATUS_LABELS,
  SESSION_STATUS_BADGES,
} from '../../../../shared/validators';
import { _CashRegisterFormModal } from './_CashRegisterFormModal';
import { _OpenSessionModal } from './_OpenSessionModal';
import { _CloseSessionModal } from './_CloseSessionModal';

interface Props {
  cashRegisters: CashRegisterWithActiveSession[];
  onRefresh: () => void;
}

export function _CashRegistersTable({ cashRegisters, onRefresh }: Props) {
  const [selectedRegister, setSelectedRegister] = useState<CashRegisterWithActiveSession | null>(null);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isOpenSessionModalOpen, setIsOpenSessionModalOpen] = useState(false);
  const [isCloseSessionModalOpen, setIsCloseSessionModalOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const { hasPermission } = usePermissions();

  const handleEdit = (register: CashRegisterWithActiveSession) => {
    setSelectedRegister(register);
    setIsEditModalOpen(true);
  };

  const handleOpenSession = (register: CashRegisterWithActiveSession) => {
    setSelectedRegister(register);
    setIsOpenSessionModalOpen(true);
  };

  const handleCloseSession = (register: CashRegisterWithActiveSession) => {
    setSelectedRegister(register);
    setIsCloseSessionModalOpen(true);
  };

  const handleToggleStatus = async (register: CashRegisterWithActiveSession) => {
    try {
      setIsLoading(true);
      if (register.status === 'ACTIVE') {
        await deactivateCashRegister(register.id);
        toast.success('Caja desactivada correctamente');
      } else {
        await activateCashRegister(register.id);
        toast.success('Caja activada correctamente');
      }
      onRefresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Error al cambiar estado');
    } finally {
      setIsLoading(false);
    }
  };

  const columns: ColumnDef<CashRegisterWithActiveSession>[] = [
    {
      accessorKey: 'code',
      header: 'Código',
      meta: { title: 'Código' },
      cell: ({ row }: { row: { original: CashRegisterWithActiveSession } }) => {
        const register = row.original;
        return (
          <div className="flex items-center gap-2">
            <span className="font-medium">{register.code}</span>
            {register.isDefault && <Badge variant="outline">Por Defecto</Badge>}
          </div>
        );
      },
    },
    {
      accessorKey: 'name',
      header: 'Nombre',
      meta: { title: 'Nombre' },
    },
    {
      accessorKey: 'location',
      header: 'Ubicación',
      meta: { title: 'Ubicación' },
      cell: ({ row }: { row: { original: CashRegisterWithActiveSession } }) => {
        return row.original.location || '-';
      },
    },
    {
      accessorKey: 'status',
      header: 'Estado',
      meta: { title: 'Estado' },
      cell: ({ row }: { row: { original: CashRegisterWithActiveSession } }) => {
        const register = row.original;
        return (
          <Badge variant={CASH_REGISTER_STATUS_BADGES[register.status]}>
            {CASH_REGISTER_STATUS_LABELS[register.status]}
          </Badge>
        );
      },
    },
    {
      accessorKey: 'activeSession',
      header: 'Sesión Activa',
      meta: { title: 'Sesión Activa' },
      cell: ({ row }: { row: { original: CashRegisterWithActiveSession } }) => {
        const register = row.original;
        if (!register.activeSession) {
          return <Badge variant="secondary">Sin sesión</Badge>;
        }
        return (
          <div className="flex flex-col gap-1">
            <Badge variant={SESSION_STATUS_BADGES[register.activeSession.status]}>
              Sesión #{register.activeSession.sessionNumber}
            </Badge>
            <span className="text-xs text-muted-foreground">
              Saldo: ${register.activeSession.expectedBalance.toFixed(2)}
            </span>
          </div>
        );
      },
    },
    {
      accessorKey: 'createdAt',
      header: 'Creada',
      meta: { title: 'Creada' },
      cell: ({ row }: { row: { original: CashRegisterWithActiveSession } }) => {
        return moment(row.original.createdAt).format('DD/MM/YYYY');
      },
    },
    {
      id: 'actions',
      header: 'Acciones',
      meta: { title: 'Acciones' },
      cell: ({ row }: { row: { original: CashRegisterWithActiveSession } }) => {
        const register = row.original;
        const hasActiveSession = !!register.activeSession;
        const isActive = register.status === 'ACTIVE';

        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="h-8 w-8 p-0">
                <span className="sr-only">Abrir menú</span>
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Acciones</DropdownMenuLabel>
              {hasPermission('commercial.treasury.cash-registers', 'update') && (
                <DropdownMenuItem onClick={() => handleEdit(register)}>
                  <Pencil className="mr-2 h-4 w-4" />
                  Editar
                </DropdownMenuItem>
              )}

              {hasPermission('commercial.treasury.cash-registers', 'update') && isActive && !hasActiveSession && (
                <DropdownMenuItem onClick={() => handleOpenSession(register)}>
                  <DollarSign className="mr-2 h-4 w-4" />
                  Abrir Sesión
                </DropdownMenuItem>
              )}

              {hasPermission('commercial.treasury.cash-registers', 'update') && hasActiveSession && (
                <DropdownMenuItem onClick={() => handleCloseSession(register)}>
                  <PowerOff className="mr-2 h-4 w-4" />
                  Cerrar Sesión
                </DropdownMenuItem>
              )}

              <DropdownMenuSeparator />

              {hasPermission('commercial.treasury.cash-registers', 'update') && (
                <DropdownMenuItem onClick={() => handleToggleStatus(register)} disabled={isLoading || hasActiveSession}>
                  {isActive ? (
                    <>
                      <PowerOff className="mr-2 h-4 w-4" />
                      Desactivar
                    </>
                  ) : (
                    <>
                      <Power className="mr-2 h-4 w-4" />
                      Activar
                    </>
                  )}
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        );
      },
    },
  ];

  const facetedFilters: DataTableFacetedFilterConfig[] = useMemo(
    () => [
      {
        columnId: 'code',
        title: 'Código',
        type: 'text' as const,
        placeholder: 'Buscar por código...',
      },
      {
        columnId: 'name',
        title: 'Nombre',
        type: 'text' as const,
        placeholder: 'Buscar por nombre...',
      },
      {
        columnId: 'location',
        title: 'Ubicación',
        type: 'text' as const,
        placeholder: 'Buscar por ubicación...',
      },
      {
        columnId: 'status',
        title: 'Estado',
        options: Object.entries(CASH_REGISTER_STATUS_LABELS).map(([value, label]) => ({
          label,
          value,
        })),
      },
    ],
    []
  );

  return (
    <>
      <DataTable<CashRegisterWithActiveSession>
        columns={columns}
        data={cashRegisters}
        totalRows={cashRegisters.length}
        showSearch={false}
        facetedFilters={facetedFilters}
        tableId="commercial-cash-registers"
        showFilterToggle
      />

      {selectedRegister && (
        <>
          <_CashRegisterFormModal
            open={isEditModalOpen}
            onOpenChange={setIsEditModalOpen}
            cashRegister={selectedRegister}
            onSuccess={() => {
              setIsEditModalOpen(false);
              onRefresh();
            }}
          />

          <_OpenSessionModal
            open={isOpenSessionModalOpen}
            onOpenChange={setIsOpenSessionModalOpen}
            cashRegister={selectedRegister}
            onSuccess={() => {
              setIsOpenSessionModalOpen(false);
              onRefresh();
            }}
          />

          {selectedRegister.activeSession && (
            <_CloseSessionModal
              open={isCloseSessionModalOpen}
              onOpenChange={setIsCloseSessionModalOpen}
              session={selectedRegister.activeSession}
              onSuccess={() => {
                setIsCloseSessionModalOpen(false);
                onRefresh();
              }}
            />
          )}
        </>
      )}
    </>
  );
}
