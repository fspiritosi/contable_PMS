'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/shared/components/ui/button';
import { usePermissions } from '@/shared/hooks/usePermissions';
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
import { Send, CheckCircle, XCircle, Ban, Trash2, Loader2 } from 'lucide-react';
import type { PurchaseOrderStatus } from '@/generated/prisma/enums';
import {
  submitForApproval,
  approvePurchaseOrder,
  rejectPurchaseOrder,
  cancelPurchaseOrder,
  deletePurchaseOrder,
} from '../../list/actions.server';

interface PurchaseOrderActionsProps {
  orderId: string;
  status: PurchaseOrderStatus;
  fullNumber: string;
}

interface PendingAction {
  title: string;
  description: string;
  action: () => Promise<unknown>;
  successMessage: string;
  redirectToList?: boolean;
  destructive?: boolean;
}

export function _PurchaseOrderActions({ orderId, status, fullNumber }: PurchaseOrderActionsProps) {
  const router = useRouter();
  const { hasPermission } = usePermissions();
  const [loading, setLoading] = useState(false);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);

  const executeAction = async () => {
    if (!pendingAction) return;

    try {
      setLoading(true);
      await pendingAction.action();
      toast.success(pendingAction.successMessage);
      if (pendingAction.redirectToList) {
        router.push('/dashboard/commercial/purchase-orders');
      } else {
        router.refresh();
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Error al procesar la acción');
    } finally {
      setLoading(false);
      setPendingAction(null);
    }
  };

  return (
    <>
      <div className="flex items-center gap-2">
        {status === 'DRAFT' && (
          <>
            {hasPermission('commercial.purchase-orders', 'update') && (
              <Button
                variant="default"
                size="sm"
                disabled={loading}
                onClick={() =>
                  setPendingAction({
                    title: '¿Enviar a aprobación?',
                    description: `La orden ${fullNumber} será enviada a aprobación.`,
                    action: () => submitForApproval(orderId),
                    successMessage: 'Orden enviada a aprobación',
                  })
                }
              >
                <Send className="mr-2 h-4 w-4" />
                Enviar a Aprobación
              </Button>
            )}
            {hasPermission('commercial.purchase-orders', 'delete') && (
              <Button
                variant="destructive"
                size="sm"
                disabled={loading}
                onClick={() =>
                  setPendingAction({
                    title: '¿Eliminar orden?',
                    description: `La orden ${fullNumber} será eliminada permanentemente. Esta acción no se puede deshacer.`,
                    action: () => deletePurchaseOrder(orderId),
                    successMessage: 'Orden eliminada',
                    redirectToList: true,
                    destructive: true,
                  })
                }
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Eliminar
              </Button>
            )}
          </>
        )}

        {status === 'PENDING_APPROVAL' && (
          <>
            {hasPermission('commercial.purchase-orders', 'approve') && (
              <>
                <Button
                  variant="default"
                  size="sm"
                  disabled={loading}
                  onClick={() =>
                    setPendingAction({
                      title: '¿Aprobar orden?',
                      description: `La orden ${fullNumber} será aprobada.`,
                      action: () => approvePurchaseOrder(orderId),
                      successMessage: 'Orden aprobada correctamente',
                    })
                  }
                >
                  <CheckCircle className="mr-2 h-4 w-4" />
                  Aprobar
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={loading}
                  onClick={() =>
                    setPendingAction({
                      title: '¿Rechazar orden?',
                      description: `La orden ${fullNumber} será rechazada y volverá a estado borrador.`,
                      action: () => rejectPurchaseOrder(orderId),
                      successMessage: 'Orden rechazada',
                    })
                  }
                >
                  <XCircle className="mr-2 h-4 w-4" />
                  Rechazar
                </Button>
              </>
            )}
          </>
        )}

        {['DRAFT', 'PENDING_APPROVAL', 'APPROVED'].includes(status) && status !== 'DRAFT' && hasPermission('commercial.purchase-orders', 'delete') && (
          <Button
            variant="destructive"
            size="sm"
            disabled={loading}
            onClick={() =>
              setPendingAction({
                title: '¿Cancelar orden?',
                description: `La orden ${fullNumber} será cancelada.`,
                action: () => cancelPurchaseOrder(orderId),
                successMessage: 'Orden cancelada',
                destructive: true,
              })
            }
          >
            <Ban className="mr-2 h-4 w-4" />
            Cancelar
          </Button>
        )}
      </div>

      <AlertDialog open={!!pendingAction} onOpenChange={(open) => !open && setPendingAction(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{pendingAction?.title}</AlertDialogTitle>
            <AlertDialogDescription>{pendingAction?.description}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={loading}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={executeAction}
              disabled={loading}
              className={pendingAction?.destructive ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90' : ''}
            >
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Confirmar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
