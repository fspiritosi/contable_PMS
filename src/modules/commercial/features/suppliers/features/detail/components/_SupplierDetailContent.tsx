'use client';

import { Button } from '@/shared/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card';
import { Badge } from '@/shared/components/ui/badge';
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
import { Edit, Trash2 } from 'lucide-react';
import { BackButton } from '@/shared/components/common/BackButton';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import moment from 'moment';
import type { Supplier } from '../../../shared/types';
import { SUPPLIER_TAX_CONDITION_LABELS, SUPPLIER_STATUS_LABELS } from '../../../shared/types';
import { deleteSupplier } from '../../list/actions.server';
import { logger } from '@/shared/lib/logger';
import { usePermissions } from '@/shared/hooks/usePermissions';

interface SupplierDetailContentProps {
  supplier: Supplier;
}

export function _SupplierDetailContent({ supplier }: SupplierDetailContentProps) {
  const router = useRouter();
  const { hasPermission } = usePermissions();
  const [isDeleting, setIsDeleting] = useState(false);

  // Formatear CUIT con guiones
  const formatTaxId = (taxId: string) => {
    if (taxId.length === 11) {
      return `${taxId.substring(0, 2)}-${taxId.substring(2, 10)}-${taxId.substring(10)}`;
    }
    return taxId;
  };

  const handleDelete = async () => {
    setIsDeleting(true);
    try {
      await deleteSupplier(supplier.id);
      toast.success('Proveedor eliminado correctamente');
      router.push('/dashboard/commercial/suppliers');
      router.refresh();
    } catch (error) {
      logger.error('Error al eliminar proveedor', { data: { error } });
      toast.error('Error al eliminar proveedor');
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
              <h1 className="text-2xl font-bold">{supplier.businessName}</h1>
              <Badge
                variant={
                  supplier.status === 'ACTIVE'
                    ? 'default'
                    : supplier.status === 'BLOCKED'
                    ? 'destructive'
                    : 'secondary'
                }
              >
                {SUPPLIER_STATUS_LABELS[supplier.status]}
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground">
              Código: {supplier.code}
              {supplier.tradeName && ` • ${supplier.tradeName}`}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          {hasPermission('commercial.suppliers', 'update') && (
            <Link href={`/dashboard/commercial/suppliers/${supplier.id}/edit`}>
              <Button>
                <Edit className="mr-2 h-4 w-4" />
                Editar
              </Button>
            </Link>
          )}
          {hasPermission('commercial.suppliers', 'delete') && (
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
                    Vas a eliminar el proveedor &quot;{supplier.businessName}&quot;. Esta acción no se puede deshacer.
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

      {/* Información Fiscal */}
      <Card>
        <CardHeader>
          <CardTitle>Información Fiscal</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <p className="text-sm font-medium text-muted-foreground">Razón Social</p>
              <p className="text-sm">{supplier.businessName}</p>
            </div>
            {supplier.tradeName && (
              <div>
                <p className="text-sm font-medium text-muted-foreground">Nombre de Fantasía</p>
                <p className="text-sm">{supplier.tradeName}</p>
              </div>
            )}
            <div>
              <p className="text-sm font-medium text-muted-foreground">CUIT</p>
              <p className="text-sm">{formatTaxId(supplier.taxId)}</p>
            </div>
            <div>
              <p className="text-sm font-medium text-muted-foreground">Condición IVA</p>
              <p className="text-sm">{SUPPLIER_TAX_CONDITION_LABELS[supplier.taxCondition]}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Información de Contacto */}
      <Card>
        <CardHeader>
          <CardTitle>Información de Contacto</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <p className="text-sm font-medium text-muted-foreground">Email</p>
              <p className="text-sm">{supplier.email || '-'}</p>
            </div>
            <div>
              <p className="text-sm font-medium text-muted-foreground">Teléfono</p>
              <p className="text-sm">{supplier.phone || '-'}</p>
            </div>
            {supplier.website && (
              <div className="md:col-span-2">
                <p className="text-sm font-medium text-muted-foreground">Sitio Web</p>
                <a
                  href={supplier.website}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-primary hover:underline"
                >
                  {supplier.website}
                </a>
              </div>
            )}
          </div>

          {(supplier.contactName || supplier.contactPhone || supplier.contactEmail) && (
            <>
              <div className="my-4 border-t" />
              <h4 className="mb-4 text-sm font-semibold">Persona de Contacto</h4>
              <div className="grid gap-4 md:grid-cols-3">
                {supplier.contactName && (
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Nombre</p>
                    <p className="text-sm">{supplier.contactName}</p>
                  </div>
                )}
                {supplier.contactPhone && (
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Teléfono</p>
                    <p className="text-sm">{supplier.contactPhone}</p>
                  </div>
                )}
                {supplier.contactEmail && (
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Email</p>
                    <p className="text-sm">{supplier.contactEmail}</p>
                  </div>
                )}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Dirección */}
      <Card>
        <CardHeader>
          <CardTitle>Dirección</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <p className="text-sm font-medium text-muted-foreground">Dirección</p>
              <p className="text-sm">{supplier.address || '-'}</p>
            </div>
            <div>
              <p className="text-sm font-medium text-muted-foreground">Ciudad</p>
              <p className="text-sm">{supplier.city || '-'}</p>
            </div>
            <div>
              <p className="text-sm font-medium text-muted-foreground">Provincia</p>
              <p className="text-sm">{supplier.state || '-'}</p>
            </div>
            <div>
              <p className="text-sm font-medium text-muted-foreground">Código Postal</p>
              <p className="text-sm">{supplier.zipCode || '-'}</p>
            </div>
            <div>
              <p className="text-sm font-medium text-muted-foreground">País</p>
              <p className="text-sm">{supplier.country}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Datos Comerciales */}
      <Card>
        <CardHeader>
          <CardTitle>Datos Comerciales</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <p className="text-sm font-medium text-muted-foreground">Plazo de Pago</p>
              <p className="text-sm">
                {supplier.paymentTermDays === 0 ? 'Contado' : `${supplier.paymentTermDays} días`}
              </p>
            </div>
            <div>
              <p className="text-sm font-medium text-muted-foreground">Límite de Crédito</p>
              <p className="text-sm">
                {supplier.creditLimit
                  ? `$${supplier.creditLimit.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                  : 'Sin límite'}
              </p>
            </div>
          </div>

          {supplier.notes && (
            <>
              <div className="my-4 border-t" />
              <div>
                <p className="text-sm font-medium text-muted-foreground">Notas</p>
                <p className="mt-2 whitespace-pre-wrap text-sm">{supplier.notes}</p>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Metadata */}
      <Card>
        <CardHeader>
          <CardTitle>Información del Sistema</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <p className="text-sm font-medium text-muted-foreground">Creado</p>
              <p className="text-sm">{moment(supplier.createdAt).format('DD/MM/YYYY HH:mm')}</p>
            </div>
            <div>
              <p className="text-sm font-medium text-muted-foreground">Última Actualización</p>
              <p className="text-sm">{moment(supplier.updatedAt).format('DD/MM/YYYY HH:mm')}</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
