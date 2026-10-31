'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import moment from 'moment';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog';
import { Badge } from '@/shared/components/ui/badge';
import { Button } from '@/shared/components/ui/button';
import { Skeleton } from '@/shared/components/ui/skeleton';
import { Separator } from '@/shared/components/ui/separator';
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
import { Input } from '@/shared/components/ui/input';
import { CheckCircle, XCircle } from 'lucide-react';
import { formatCurrency } from '@/shared/utils/formatters';
import { logger } from '@/shared/lib/logger';
import { getCheckById, clearCheck, rejectCheck } from '../../actions.server';
import {
  CHECK_TYPE_LABELS,
  CHECK_STATUS_LABELS,
  CHECK_STATUS_BADGES,
} from '../../../../shared/validators';
import type { CheckWithDetails } from '../../../../shared/types';
import { notifyCheckActionResult } from '../check-action-result';

interface Props {
  checkId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function _CheckDetailModal({ checkId, open, onOpenChange }: Props) {
  const router = useRouter();
  const [check, setCheck] = useState<CheckWithDetails | null>(null);
  const [loading, setLoading] = useState(false);
  const [clearDialogOpen, setClearDialogOpen] = useState(false);
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false);
  const [rejectionReason, setRejectionReason] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);

  const loadCheck = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getCheckById(checkId);
      setCheck(data);
    } catch (error) {
      logger.error('Error al cargar cheque', { data: { error } });
      toast.error('Error al cargar detalle del cheque');
    } finally {
      setLoading(false);
    }
  }, [checkId]);

  useEffect(() => {
    if (open && checkId) {
      loadCheck();
    }
  }, [open, checkId, loadCheck]);

  const handleClear = async () => {
    setIsProcessing(true);
    try {
      await clearCheck(checkId);
      toast.success('Cheque acreditado correctamente');
      setClearDialogOpen(false);
      onOpenChange(false);
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Error al acreditar cheque');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleReject = async () => {
    if (!rejectionReason.trim()) {
      toast.error('Debe ingresar un motivo de rechazo');
      return;
    }
    setIsProcessing(true);
    try {
      const result = await rejectCheck(checkId, rejectionReason.trim());
      if (notifyCheckActionResult(result, 'Cheque rechazado correctamente')) {
        setRejectDialogOpen(false);
        setRejectionReason('');
        onOpenChange(false);
        router.refresh();
      }
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Detalle de Cheque</DialogTitle>
          </DialogHeader>

          {loading ? (
            <div className="space-y-4">
              <Skeleton className="h-6 w-40" />
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-24 w-full" />
            </div>
          ) : check ? (
            <div className="space-y-6">
              {/* Estado y tipo */}
              <div className="flex items-center gap-3">
                <Badge variant={CHECK_STATUS_BADGES[check.status]}>
                  {CHECK_STATUS_LABELS[check.status]}
                </Badge>
                <span className="text-sm text-muted-foreground">
                  {CHECK_TYPE_LABELS[check.type]}
                </span>
                {check.isElectronic && <Badge variant="outline">E-Cheq</Badge>}
              </div>

              {/* Datos del cheque */}
              <div className="grid grid-cols-2 gap-x-6 gap-y-3">
                <div>
                  <p className="text-sm text-muted-foreground">Número</p>
                  <p className="font-medium">{check.checkNumber}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Monto</p>
                  <p className="text-lg font-bold">{formatCurrency(check.amount)}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Banco</p>
                  <p className="font-medium">{check.bankName}</p>
                </div>
                {check.branch && (
                  <div>
                    <p className="text-sm text-muted-foreground">Sucursal</p>
                    <p className="font-medium">{check.branch}</p>
                  </div>
                )}
                {check.accountNumber && (
                  <div>
                    <p className="text-sm text-muted-foreground">Número de Cuenta</p>
                    <p className="font-medium">{check.accountNumber}</p>
                  </div>
                )}
                <div>
                  <p className="text-sm text-muted-foreground">Librador</p>
                  <p className="font-medium">{check.drawerName}</p>
                </div>
                {check.drawerTaxId && (
                  <div>
                    <p className="text-sm text-muted-foreground">CUIT Librador</p>
                    <p className="font-medium">{check.drawerTaxId}</p>
                  </div>
                )}
                {check.payeeName && (
                  <div>
                    <p className="text-sm text-muted-foreground">Beneficiario</p>
                    <p className="font-medium">{check.payeeName}</p>
                  </div>
                )}
                <div>
                  <p className="text-sm text-muted-foreground">Fecha de Emisión</p>
                  <p className="font-medium">{moment(check.issueDate).format('DD/MM/YYYY')}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Fecha de Vencimiento</p>
                  <p className="font-medium">{moment(check.dueDate).format('DD/MM/YYYY')}</p>
                </div>
              </div>

              {/* Vinculación */}
              {(check.customer || check.supplier) && (
                <>
                  <Separator />
                  <div>
                    <p className="text-sm font-medium mb-2">Vinculado a</p>
                    {check.customer && (
                      <p className="text-sm">
                        <span className="text-muted-foreground">Cliente: </span>
                        {check.customer.name}
                      </p>
                    )}
                    {check.supplier && (
                      <p className="text-sm">
                        <span className="text-muted-foreground">Proveedor: </span>
                        {check.supplier.businessName}
                      </p>
                    )}
                  </div>
                </>
              )}

              {/* Cuenta bancaria (si está depositado) */}
              {check.bankAccount && (
                <>
                  <Separator />
                  <div>
                    <p className="text-sm font-medium mb-2">Cuenta Bancaria</p>
                    <p className="text-sm">
                      {check.bankAccount.bankName} — {check.bankAccount.accountNumber}
                    </p>
                    {check.depositedAt && (
                      <p className="text-sm text-muted-foreground">
                        Depositado: {moment(check.depositedAt).format('DD/MM/YYYY')}
                      </p>
                    )}
                  </div>
                </>
              )}

              {/* Endoso */}
              {check.endorsedToName && (
                <>
                  <Separator />
                  <div>
                    <p className="text-sm font-medium mb-2">Endosado a</p>
                    <p className="text-sm">{check.endorsedToName}</p>
                    {check.endorsedToTaxId && (
                      <p className="text-sm text-muted-foreground">
                        CUIT: {check.endorsedToTaxId}
                      </p>
                    )}
                    {check.endorsedAt && (
                      <p className="text-sm text-muted-foreground">
                        Fecha: {moment(check.endorsedAt).format('DD/MM/YYYY')}
                      </p>
                    )}
                  </div>
                </>
              )}

              {/* Rechazo */}
              {check.rejectionReason && (
                <>
                  <Separator />
                  <div>
                    <p className="text-sm font-medium mb-1 text-destructive">Motivo de Rechazo</p>
                    <p className="text-sm">{check.rejectionReason}</p>
                    {check.rejectedAt && (
                      <p className="text-sm text-muted-foreground">
                        Fecha: {moment(check.rejectedAt).format('DD/MM/YYYY')}
                      </p>
                    )}
                  </div>
                </>
              )}

              {/* Notas */}
              {check.notes && (
                <>
                  <Separator />
                  <div>
                    <p className="text-sm font-medium mb-1">Notas</p>
                    <p className="text-sm text-muted-foreground">{check.notes}</p>
                  </div>
                </>
              )}

              {/* Acciones para cheques depositados */}
              {check.status === 'DEPOSITED' && (
                <>
                  <Separator />
                  <div className="flex gap-2 justify-end">
                    <Button
                      variant="outline"
                      className="text-destructive border-destructive hover:bg-destructive/10"
                      onClick={() => setRejectDialogOpen(true)}
                    >
                      <XCircle className="mr-2 h-4 w-4" />
                      Rechazar
                    </Button>
                    <Button onClick={() => setClearDialogOpen(true)}>
                      <CheckCircle className="mr-2 h-4 w-4" />
                      Acreditar
                    </Button>
                  </div>
                </>
              )}
            </div>
          ) : (
            <p className="text-muted-foreground text-sm">No se encontró el cheque.</p>
          )}
        </DialogContent>
      </Dialog>

      {/* Acreditar dialog */}
      <AlertDialog open={clearDialogOpen} onOpenChange={setClearDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Acreditar cheque?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta acción marcará el cheque como acreditado y actualizará el saldo de la cuenta
              bancaria. Esta acción no se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isProcessing}>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleClear} disabled={isProcessing}>
              {isProcessing ? 'Acreditando...' : 'Acreditar'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Rechazar dialog */}
      <AlertDialog open={rejectDialogOpen} onOpenChange={setRejectDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Rechazar cheque</AlertDialogTitle>
            <AlertDialogDescription>
              Ingrese el motivo del rechazo. Se eliminará el movimiento bancario asociado y se
              generará el asiento del rechazo.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="px-6 pb-2">
            <Input
              placeholder="Motivo del rechazo..."
              value={rejectionReason}
              onChange={(e) => setRejectionReason(e.target.value)}
              disabled={isProcessing}
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel
              disabled={isProcessing}
              onClick={() => setRejectionReason('')}
            >
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleReject}
              disabled={isProcessing || !rejectionReason.trim()}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isProcessing ? 'Rechazando...' : 'Rechazar'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
