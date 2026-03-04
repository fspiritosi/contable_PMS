'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Eye, MoreHorizontal, Pencil, Trash2, UserX } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { toast } from 'sonner';

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
import { Badge } from '@/shared/components/ui/badge';
import { Button } from '@/shared/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/shared/components/ui/dropdown-menu';
import { Input } from '@/shared/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/shared/components/ui/table';

import { employeeStatusBadges, getBadgeConfig } from '@/shared/utils/mappers';
import { usePermissions } from '@/shared/hooks/usePermissions';
import { deleteEmployee, getAllEmployees, type EmployeeListItem } from '../actions.server';

interface Props {
  initialData: EmployeeListItem[];
}

export function _EmployeesTable({ initialData }: Props) {
  const queryClient = useQueryClient();
  const { hasPermission } = usePermissions();
  const [search, setSearch] = useState('');
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const { data: employees } = useQuery({
    queryKey: ['employees'],
    queryFn: () => getAllEmployees(),
    initialData,
  });

  const deleteMutation = useMutation({
    mutationFn: deleteEmployee,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['employees'] });
      toast.success('Empleado eliminado exitosamente');
      setDeleteId(null);
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Error al eliminar empleado');
    },
  });

  const handleDelete = () => {
    if (deleteId) {
      deleteMutation.mutate(deleteId);
    }
  };

  // Filtrar localmente por búsqueda
  const filteredEmployees = employees.filter((employee) => {
    if (!search) return true;
    const searchLower = search.toLowerCase();
    return (
      employee.firstName.toLowerCase().includes(searchLower) ||
      employee.lastName.toLowerCase().includes(searchLower) ||
      employee.employeeNumber.toLowerCase().includes(searchLower) ||
      employee.documentNumber.toLowerCase().includes(searchLower) ||
      employee.cuil.toLowerCase().includes(searchLower)
    );
  });

  if (employees.length === 0) {
    return (
      <div
        data-testid="employees-empty-state"
        className="rounded-lg border border-dashed p-8 text-center"
      >
        <p className="text-muted-foreground">No hay empleados registrados</p>
        <Button asChild className="mt-4" data-testid="employees-empty-register-button">
          <Link href="/dashboard/employees/new">Registrar primer empleado</Link>
        </Button>
      </div>
    );
  }

  return (
    <>
      <div className="flex items-center gap-4 mb-4">
        <Input
          data-testid="employees-search-input"
          placeholder="Buscar por nombre, legajo, documento o CUIL..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-sm"
        />
      </div>

      <div className="rounded-md border">
        <Table data-testid="employees-table">
          <TableHeader>
            <TableRow>
              <TableHead>Legajo</TableHead>
              <TableHead>Nombre</TableHead>
              <TableHead>Documento</TableHead>
              <TableHead>CUIL</TableHead>
              <TableHead>Puesto</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead className="w-[70px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredEmployees.map((employee) => {
              const statusBadge = getBadgeConfig(employee.status, employeeStatusBadges);
              return (
                <TableRow key={employee.id} data-testid={`employee-row-${employee.id}`}>
                  <TableCell className="font-medium">{employee.employeeNumber}</TableCell>
                  <TableCell data-testid={`employee-name-${employee.id}`}>
                    {employee.lastName}, {employee.firstName}
                  </TableCell>
                  <TableCell>
                    {employee.identityDocumentType} {employee.documentNumber}
                  </TableCell>
                  <TableCell>{employee.cuil}</TableCell>
                  <TableCell>{employee.jobPosition?.name || '-'}</TableCell>
                  <TableCell>
                    <Badge variant={statusBadge.variant}>{statusBadge.label}</Badge>
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          data-testid={`employee-actions-${employee.id}`}
                        >
                          <MoreHorizontal className="h-4 w-4" />
                          <span className="sr-only">Abrir menú</span>
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem asChild data-testid={`employee-view-${employee.id}`}>
                          <Link href={`/dashboard/employees/${employee.id}`}>
                            <Eye className="mr-2 h-4 w-4" />
                            Ver detalle
                          </Link>
                        </DropdownMenuItem>
                        {hasPermission('employees', 'update') && (
                          <DropdownMenuItem asChild data-testid={`employee-edit-${employee.id}`}>
                            <Link href={`/dashboard/employees/${employee.id}/edit`}>
                              <Pencil className="mr-2 h-4 w-4" />
                              Editar
                            </Link>
                          </DropdownMenuItem>
                        )}
                        {hasPermission('employees', 'delete') && (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              asChild
                              data-testid={`employee-terminate-${employee.id}`}
                            >
                              <Link href={`/dashboard/employees/${employee.id}/terminate`}>
                                <UserX className="mr-2 h-4 w-4" />
                                Dar de baja
                              </Link>
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              className="text-destructive"
                              onClick={() => setDeleteId(employee.id)}
                              data-testid={`employee-delete-${employee.id}`}
                            >
                              <Trash2 className="mr-2 h-4 w-4" />
                              Eliminar
                            </DropdownMenuItem>
                          </>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <AlertDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent data-testid="employee-delete-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle data-testid="employee-delete-dialog-title">
              ¿Eliminar empleado?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Esta acción no se puede deshacer. El empleado será eliminado permanentemente del
              sistema. Si desea mantener el historial, considere usar la opción "Dar de baja" en su
              lugar.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="employee-delete-cancel">Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="employee-delete-confirm"
            >
              {deleteMutation.isPending ? 'Eliminando...' : 'Eliminar'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
