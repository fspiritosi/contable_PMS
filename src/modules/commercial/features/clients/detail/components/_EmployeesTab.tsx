'use client';

import { Plus, Trash2, Users } from 'lucide-react';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

import { Button } from '@/shared/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/shared/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/shared/components/ui/table';
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

import { formatDate } from '@/shared/utils/formatters';
import { unassignEmployeeFromClient } from '../actions.server';
import type { ClientDetail } from '../actions.server';
import { _AssignEmployeeDialog } from './_AssignEmployeeDialog';
import { usePermissions } from '@/shared/hooks/usePermissions';

interface Props {
  client: ClientDetail;
}

export function _EmployeesTab({ client }: Props) {
  const router = useRouter();
  const { hasPermission } = usePermissions();
  const [showAssignDialog, setShowAssignDialog] = useState(false);
  const [employeeToUnassign, setEmployeeToUnassign] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleUnassign = async () => {
    if (!employeeToUnassign) return;

    setIsLoading(true);
    try {
      await unassignEmployeeFromClient(client.id, employeeToUnassign);
      toast.success('Empleado desasignado');
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Error al desasignar empleado');
    } finally {
      setIsLoading(false);
      setEmployeeToUnassign(null);
    }
  };

  const employeeToUnassignData = client.employeeAllocations.find(
    (e) => e.employee.id === employeeToUnassign
  );

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Users className="h-5 w-5" />
                Empleados Asignados
              </CardTitle>
              <CardDescription>
                {client.employeeAllocations.length} empleado
                {client.employeeAllocations.length !== 1 ? 's' : ''} asignado
                {client.employeeAllocations.length !== 1 ? 's' : ''}
              </CardDescription>
            </div>
            {hasPermission('commercial.clients', 'update') && (
              <Button onClick={() => setShowAssignDialog(true)}>
                <Plus className="mr-2 h-4 w-4" />
                Asignar Empleado
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {client.employeeAllocations.length > 0 ? (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Legajo</TableHead>
                    <TableHead>Nombre Completo</TableHead>
                    <TableHead className="hidden md:table-cell">Puesto</TableHead>
                    <TableHead className="hidden sm:table-cell">Fecha Asignación</TableHead>
                    <TableHead className="w-[80px]">Acciones</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {client.employeeAllocations.map((allocation) => (
                    <TableRow key={allocation.id}>
                      <TableCell className="font-medium">
                        {allocation.employee.employeeNumber}
                      </TableCell>
                      <TableCell>
                        {allocation.employee.lastName}, {allocation.employee.firstName}
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        {allocation.employee.jobPosition?.name || '-'}
                      </TableCell>
                      <TableCell className="hidden sm:table-cell">
                        {formatDate(allocation.createdAt)}
                      </TableCell>
                      <TableCell>
                        {hasPermission('commercial.clients', 'update') && (
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setEmployeeToUnassign(allocation.employee.id)}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-8 text-center text-muted-foreground">
              <Users className="mb-2 h-12 w-12" />
              <p>No hay empleados asignados</p>
              <p className="text-sm">Haz clic en &quot;Asignar Empleado&quot; para agregar uno</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Dialog para asignar empleado */}
      <_AssignEmployeeDialog
        clientId={client.id}
        open={showAssignDialog}
        onOpenChange={setShowAssignDialog}
      />

      {/* Dialog de confirmación para desasignar */}
      <AlertDialog open={!!employeeToUnassign} onOpenChange={() => setEmployeeToUnassign(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Desasignar empleado?</AlertDialogTitle>
            <AlertDialogDescription>
              El empleado{' '}
              <strong>
                {employeeToUnassignData?.employee.lastName},{' '}
                {employeeToUnassignData?.employee.firstName} (Legajo:{' '}
                {employeeToUnassignData?.employee.employeeNumber})
              </strong>{' '}
              será desasignado de este cliente. Esta acción se puede revertir asignándolo nuevamente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isLoading}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleUnassign}
              disabled={isLoading}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isLoading ? 'Procesando...' : 'Desasignar'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
