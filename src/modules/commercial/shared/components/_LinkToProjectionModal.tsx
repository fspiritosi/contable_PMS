'use client';

import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link2, Search, Calendar, DollarSign } from 'lucide-react';
import moment from 'moment';

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/shared/components/ui/dialog';
import { Button } from '@/shared/components/ui/button';
import { Input } from '@/shared/components/ui/input';
import { Badge } from '@/shared/components/ui/badge';
import { Label } from '@/shared/components/ui/label';
import { Textarea } from '@/shared/components/ui/textarea';
import { Separator } from '@/shared/components/ui/separator';
import { MoneyInput } from '@/shared/components/ui/money-input';
import { logger } from '@/shared/lib/logger';
import { formatCurrency } from '@/shared/utils/formatters';

import {
  searchProjectionsForLinking,
  linkDocumentToProjection,
} from '@/modules/commercial/features/treasury/features/cashflow-projections/actions.server';
import type { ProjectionForLinking } from '@/modules/commercial/features/treasury/shared/types';
import {
  PROJECTION_TYPE_LABELS,
  PROJECTION_CATEGORY_LABELS,
} from '@/modules/commercial/features/treasury/shared/validators';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  documentType: 'SALES_INVOICE' | 'PURCHASE_INVOICE' | 'EXPENSE';
  documentId: string;
  documentFullNumber: string;
  documentTotal: number;
  onSuccess?: () => void;
}

export function _LinkToProjectionModal({
  open,
  onOpenChange,
  documentType,
  documentId,
  documentFullNumber,
  documentTotal,
  onSuccess,
}: Props) {
  const router = useRouter();
  const queryClient = useQueryClient();

  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [selectedProjection, setSelectedProjection] = useState<ProjectionForLinking | null>(null);
  const [amount, setAmount] = useState('');
  const [notes, setNotes] = useState('');
  const [isLinking, setIsLinking] = useState(false);

  // Debounce search
  const debounceTimer = useMemo(() => {
    let timer: NodeJS.Timeout;
    return (value: string) => {
      clearTimeout(timer);
      timer = setTimeout(() => setDebouncedSearch(value), 400);
    };
  }, []);

  const handleSearchChange = (value: string) => {
    setSearch(value);
    debounceTimer(value);
  };

  const { data: projections = [], isLoading } = useQuery({
    queryKey: ['projections-for-linking', documentType, debouncedSearch],
    queryFn: () => searchProjectionsForLinking(documentType, debouncedSearch),
    enabled: open,
  });

  const handleSelectProjection = (projection: ProjectionForLinking) => {
    setSelectedProjection(projection);
    const suggestedAmount = Math.min(documentTotal, projection.remainingAmount);
    setAmount(suggestedAmount.toFixed(2));
  };

  const handleLink = async () => {
    if (!selectedProjection) return;

    const linkAmount = parseFloat(amount);
    if (isNaN(linkAmount) || linkAmount <= 0) {
      toast.error('El monto debe ser mayor a 0');
      return;
    }
    if (linkAmount > selectedProjection.remainingAmount + 0.01) {
      toast.error(`El monto no puede exceder el saldo disponible (${formatCurrency(selectedProjection.remainingAmount)})`);
      return;
    }

    setIsLinking(true);
    try {
      await linkDocumentToProjection({
        projectionId: selectedProjection.id,
        amount: linkAmount.toFixed(2),
        salesInvoiceId: documentType === 'SALES_INVOICE' ? documentId : null,
        purchaseInvoiceId: documentType === 'PURCHASE_INVOICE' ? documentId : null,
        expenseId: documentType === 'EXPENSE' ? documentId : null,
        notes: notes || null,
      });

      toast.success('Documento vinculado a proyección correctamente');
      queryClient.invalidateQueries({ queryKey: ['projections-for-linking'] });
      router.refresh();
      onSuccess?.();
      handleReset();
      onOpenChange(false);
    } catch (error) {
      logger.error('Error al vincular documento a proyección', { data: { error } });
      toast.error(error instanceof Error ? error.message : 'Error al vincular');
    } finally {
      setIsLinking(false);
    }
  };

  const handleReset = () => {
    setSearch('');
    setDebouncedSearch('');
    setSelectedProjection(null);
    setAmount('');
    setNotes('');
  };

  const docTypeLabel =
    documentType === 'SALES_INVOICE'
      ? 'Factura de Venta'
      : documentType === 'PURCHASE_INVOICE'
        ? 'Factura de Compra'
        : 'Gasto';

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) handleReset();
        onOpenChange(v);
      }}
    >
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Link2 className="h-5 w-5" />
            Vincular a Proyección
          </DialogTitle>
          <DialogDescription>
            Vincular {docTypeLabel} {documentFullNumber} (Total: {formatCurrency(documentTotal)}) a una
            proyección de cashflow existente.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Búsqueda */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar proyección por descripción..."
              value={search}
              onChange={(e) => handleSearchChange(e.target.value)}
              className="pl-9"
            />
          </div>

          {/* Resultados */}
          {!selectedProjection && (
            <div className="max-h-[300px] overflow-y-auto space-y-2">
              {isLoading ? (
                <p className="text-sm text-muted-foreground text-center py-4">Buscando proyecciones...</p>
              ) : projections.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">
                  No se encontraron proyecciones compatibles
                </p>
              ) : (
                projections.map((proj) => (
                  <button
                    key={proj.id}
                    type="button"
                    onClick={() => handleSelectProjection(proj)}
                    className="w-full text-left p-3 border rounded-lg hover:bg-accent transition-colors"
                  >
                    <div className="flex items-start justify-between">
                      <div className="space-y-1">
                        <p className="font-medium text-sm">{proj.description}</p>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <Badge variant="outline" className="text-xs">
                            {PROJECTION_TYPE_LABELS[proj.type]}
                          </Badge>
                          <span>{PROJECTION_CATEGORY_LABELS[proj.category]}</span>
                          <span className="flex items-center gap-1">
                            <Calendar className="h-3 w-3" />
                            {moment(proj.date).format('DD/MM/YYYY')}
                          </span>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="font-medium text-sm">{formatCurrency(proj.amount)}</p>
                        <p className="text-xs text-green-600">
                          Disponible: {formatCurrency(proj.remainingAmount)}
                        </p>
                      </div>
                    </div>
                  </button>
                ))
              )}
            </div>
          )}

          {/* Proyección seleccionada */}
          {selectedProjection && (
            <>
              <div className="p-3 border rounded-lg bg-muted/50">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="font-medium">{selectedProjection.description}</p>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground mt-1">
                      <Badge variant="outline" className="text-xs">
                        {PROJECTION_TYPE_LABELS[selectedProjection.type]}
                      </Badge>
                      <span>{PROJECTION_CATEGORY_LABELS[selectedProjection.category]}</span>
                      <span>{moment(selectedProjection.date).format('DD/MM/YYYY')}</span>
                    </div>
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => setSelectedProjection(null)}>
                    Cambiar
                  </Button>
                </div>
                <div className="flex items-center gap-4 mt-2 text-sm">
                  <span className="text-muted-foreground">
                    Total: {formatCurrency(selectedProjection.amount)}
                  </span>
                  <span className="text-muted-foreground">
                    Confirmado: {formatCurrency(selectedProjection.confirmedAmount)}
                  </span>
                  <span className="text-green-600 font-medium">
                    Disponible: {formatCurrency(selectedProjection.remainingAmount)}
                  </span>
                </div>
              </div>

              <Separator />

              <div className="space-y-3">
                <div>
                  <Label htmlFor="link-amount" className="flex items-center gap-2">
                    <DollarSign className="h-4 w-4" />
                    Monto a vincular
                  </Label>
                  <MoneyInput
                    id="link-amount"
                    value={amount}
                    onChange={(raw) => setAmount(raw)}
                    className="mt-1"
                    placeholder="0,00"
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Máximo: {formatCurrency(selectedProjection.remainingAmount)}
                  </p>
                </div>

                <div>
                  <Label htmlFor="link-notes">Notas (opcional)</Label>
                  <Textarea
                    id="link-notes"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    className="mt-1"
                    placeholder="Notas sobre esta vinculación..."
                    rows={2}
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isLinking}>
                  Cancelar
                </Button>
                <Button onClick={handleLink} disabled={isLinking || !amount}>
                  <Link2 className="mr-2 h-4 w-4" />
                  {isLinking ? 'Vinculando...' : 'Vincular'}
                </Button>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
