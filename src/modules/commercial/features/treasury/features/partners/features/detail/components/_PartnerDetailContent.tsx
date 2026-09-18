'use client';

import { Edit, Trash2 } from 'lucide-react';
import moment from 'moment';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';

import { BackButton } from '@/shared/components/common/BackButton';
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
import { Badge } from '@/shared/components/ui/badge';
import { Button } from '@/shared/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card';
import { usePermissions } from '@/shared/hooks/usePermissions';
import { logger } from '@/shared/lib/logger';
import type { PartnerWithAccount } from '../../../shared/types';
import { deletePartner } from '../../list/actions.server';

interface PartnerDetailContentProps {
  partner: PartnerWithAccount;
}

export function _PartnerDetailContent({ partner }: PartnerDetailContentProps) {
  const router = useRouter();
  const { hasPermission } = usePermissions();
  const [isDeleting, setIsDeleting] = useState(false);

  const handleDelete = async () => {
    setIsDeleting(true);
    try {
      await deletePartner(partner.id);
      toast.success('Socio eliminado correctamente');
      router.push('/dashboard/commercial/treasury/partners');
      router.refresh();
    } catch (error) {
      logger.error('Error al eliminar socio', { data: { error } });
      toast.error(error instanceof Error ? error.message : 'Error al eliminar socio');
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="flex flex-1 flex-col gap-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <BackButton />
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold">{partner.name}</h1>
              <Badge variant={partner.isActive ? 'default' : 'secondary'}>
                {partner.isActive ? 'Activo' : 'Inactivo'}
              </Badge>
            </div>
            {partner.taxId && (
              <p className="text-sm text-muted-foreground">CUIT/CUIL: {partner.taxId}</p>
            )}
          </div>
        </div>
        <div className="flex gap-2">
          {hasPermission('commercial.treasury.partners', 'update') && (
            <Link href={`/dashboard/commercial/treasury/partners/${partner.id}/edit`}>
              <Button>
                <Edit className="mr-2 h-4 w-4" />
                Editar
              </Button>
            </Link>
          )}
          {hasPermission('commercial.treasury.partners', 'delete') && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" disabled={isDeleting}>
                  <Trash2 className="mr-2 h-4 w-4" />
                  {isDeleting ? 'Eliminando...' : 'Eliminar'}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>¿Estás seguro?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Vas a eliminar el socio &quot;{partner.name}&quot;. Esta acción no se puede
                    deshacer.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancelar</AlertDialogCancel>
                  <AlertDialogAction onClick={handleDelete}>Eliminar</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>
      </div>

      {/* Datos del Socio */}
      <Card>
        <CardHeader>
          <CardTitle>Datos del Socio</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <p className="text-sm font-medium text-muted-foreground">Nombre</p>
              <p className="text-sm">{partner.name}</p>
            </div>
            <div>
              <p className="text-sm font-medium text-muted-foreground">CUIT/CUIL</p>
              <p className="text-sm">{partner.taxId || '-'}</p>
            </div>
            <div>
              <p className="text-sm font-medium text-muted-foreground">Email</p>
              <p className="text-sm">{partner.email || '-'}</p>
            </div>
            <div>
              <p className="text-sm font-medium text-muted-foreground">Teléfono</p>
              <p className="text-sm">{partner.phone || '-'}</p>
            </div>
          </div>

          <div className="mt-4 border-t pt-4">
            <p className="text-sm font-medium text-muted-foreground">Cuenta contable de aportes</p>
            <p className="text-sm">
              {partner.contributionsAccount ? (
                <span className="font-mono">
                  {partner.contributionsAccount.code} - {partner.contributionsAccount.name}
                </span>
              ) : (
                'Por defecto (Ajustes contables)'
              )}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Cambiar esta cuenta no modifica los asientos ya generados.
            </p>
          </div>

          {partner.notes && (
            <>
              <div className="my-4 border-t" />
              <div>
                <p className="text-sm font-medium text-muted-foreground">Notas</p>
                <p className="mt-2 whitespace-pre-wrap text-sm">{partner.notes}</p>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Información del Sistema */}
      <Card>
        <CardHeader>
          <CardTitle>Información del Sistema</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <p className="text-sm font-medium text-muted-foreground">Creado</p>
              <p className="text-sm">{moment(partner.createdAt).format('DD/MM/YYYY HH:mm')}</p>
            </div>
            <div>
              <p className="text-sm font-medium text-muted-foreground">Última Actualización</p>
              <p className="text-sm">{moment(partner.updatedAt).format('DD/MM/YYYY HH:mm')}</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
