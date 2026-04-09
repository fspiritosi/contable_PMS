'use client';

import { Building2, Edit, Power, PowerOff } from 'lucide-react';
import { BackButton } from '@/shared/components/common/BackButton';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';

import { Avatar, AvatarFallback, AvatarImage } from '@/shared/components/ui/avatar';
import { Badge } from '@/shared/components/ui/badge';
import { Button } from '@/shared/components/ui/button';
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

import { deactivateClient, reactivateClient } from '../../list/actions.server';
import type { ClientDetail } from '../actions.server';
import { usePermissions } from '@/shared/hooks/usePermissions';

interface Props {
  client: ClientDetail;
}

export function _ClientHeader({ client }: Props) {
  const router = useRouter();
  const { hasPermission } = usePermissions();
  const [showDeactivateDialog, setShowDeactivateDialog] = useState(false);
  const [showReactivateDialog, setShowReactivateDialog] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const initials = client.name
    .split(' ')
    .map((word) => word[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

  const handleDeactivate = async () => {
    setIsLoading(true);
    try {
      await deactivateClient(client.id);
      toast.success('Cliente dado de baja');
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Error al dar de baja el cliente');
    } finally {
      setIsLoading(false);
      setShowDeactivateDialog(false);
    }
  };

  const handleReactivate = async () => {
    setIsLoading(true);
    try {
      await reactivateClient(client.id);
      toast.success('Cliente reactivado');
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Error al reactivar el cliente');
    } finally {
      setIsLoading(false);
      setShowReactivateDialog(false);
    }
  };

  return (
    <>
      <div className="flex flex-col gap-4">
        {/* Row 1: Back button + Avatar + Info */}
        <div className="flex items-start gap-3 sm:gap-4">
          <BackButton variant="outline" />
          <Avatar className="h-12 w-12 shrink-0 sm:h-16 sm:w-16">
            <AvatarImage src={client.logoUrl || undefined} alt={client.name} />
            <AvatarFallback className="text-base sm:text-lg">
              {client.logoUrl ? initials : <Building2 className="h-6 w-6" />}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            {/* Name and badges */}
            <div className="flex flex-col gap-1 sm:flex-row sm:flex-wrap sm:items-center sm:gap-2">
              <h1 className="truncate text-xl font-bold tracking-tight sm:text-2xl">
                {client.name}
              </h1>
              <div className="flex flex-wrap gap-1">
                <Badge variant={client.isActive ? 'default' : 'destructive'}>
                  {client.isActive ? 'Activo' : 'Inactivo'}
                </Badge>
              </div>
            </div>
            {/* Client details */}
            <div className="mt-1 flex flex-col gap-0.5 text-sm text-muted-foreground sm:flex-row sm:gap-1">
              {client.taxId && (
                <>
                  <span>CUIT: {client.taxId}</span>
                  {client.email && <span className="hidden sm:inline">•</span>}
                </>
              )}
              {client.email && <span>{client.email}</span>}
            </div>
          </div>
        </div>

        {/* Row 2: Action buttons */}
        <div className="flex gap-2 sm:justify-end">
          {hasPermission('commercial.clients', 'update') && (
            <Button variant="outline" className="flex-1 sm:flex-none" asChild>
              <Link href={`/dashboard/company/commercial/clients/${client.id}/edit`}>
                <Edit className="mr-2 h-4 w-4" />
                Editar
              </Link>
            </Button>
          )}
          {hasPermission('commercial.clients', 'update') && (
            client.isActive ? (
              <Button
                variant="destructive"
                className="flex-1 sm:flex-none"
                onClick={() => setShowDeactivateDialog(true)}
              >
                <PowerOff className="mr-2 h-4 w-4" />
                <span className="hidden xs:inline">Dar de </span>Baja
              </Button>
            ) : (
              <Button
                variant="default"
                className="flex-1 sm:flex-none"
                onClick={() => setShowReactivateDialog(true)}
              >
                <Power className="mr-2 h-4 w-4" />
                Reactivar
              </Button>
            )
          )}
        </div>
      </div>

      {/* Deactivate Dialog */}
      <AlertDialog open={showDeactivateDialog} onOpenChange={setShowDeactivateDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Dar de baja a este cliente?</AlertDialogTitle>
            <AlertDialogDescription>
              El cliente &quot;{client.name}&quot; será marcado como inactivo. Esta acción se puede
              revertir reactivando el cliente posteriormente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isLoading}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeactivate}
              disabled={isLoading}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isLoading ? 'Procesando...' : 'Dar de baja'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Reactivate Dialog */}
      <AlertDialog open={showReactivateDialog} onOpenChange={setShowReactivateDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Reactivar este cliente?</AlertDialogTitle>
            <AlertDialogDescription>
              El cliente &quot;{client.name}&quot; será marcado como activo nuevamente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isLoading}>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleReactivate} disabled={isLoading}>
              {isLoading ? 'Procesando...' : 'Reactivar'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
