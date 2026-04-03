'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/shared/components/ui/dialog';
import { Button } from '@/shared/components/ui/button';
import { Input } from '@/shared/components/ui/input';
import { Checkbox } from '@/shared/components/ui/checkbox';
import { Loader2, FileText, Truck } from 'lucide-react';
import { logger } from '@/shared/lib/logger';
import {
  getQuoteLinesForConversion,
  convertQuoteToInvoiceData,
  convertQuoteToDeliveryData,
} from '../../list/actions.server';
import { _LeadToCustomerForm } from './_LeadToCustomerForm';

type ConversionLine = Awaited<ReturnType<typeof getQuoteLinesForConversion>>['lines'][number];

interface Props {
  quoteId: string;
  type: 'invoice' | 'delivery';
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function _QuoteConversionModal({ quoteId, type, open, onOpenChange }: Props) {
  const router = useRouter();
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [selectAll, setSelectAll] = useState(false);
  const [isConverting, setIsConverting] = useState(false);
  const [showLeadForm, setShowLeadForm] = useState(false);
  const [pendingConversionData, setPendingConversionData] = useState<{
    leadData: { id: string; name: string; email: string | null; phone: string | null } | null;
    quoteId: string;
    invoiceLines: Array<{
      productId: string;
      description: string;
      quantity: string;
      unitPrice: string;
      vatRate: string;
      discountPercent: string;
      discountAmount: string;
    }>;
    quoteLineQuantities: Array<{ lineId: string; quantity: number }>;
  } | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['quote-conversion-lines', quoteId],
    queryFn: () => getQuoteLinesForConversion(quoteId),
    enabled: open,
  });

  const lines = useMemo(() => data?.lines ?? [], [data?.lines]);

  // Reset state when modal opens
  useEffect(() => {
    if (open) {
      setQuantities({});
      setSelectAll(false);
      setShowLeadForm(false);
      setPendingConversionData(null);
    }
  }, [open]);

  const getRemainingForLine = useCallback(
    (line: ConversionLine) => {
      return type === 'invoice' ? line.remainingToInvoice : line.remainingToDeliver;
    },
    [type],
  );

  const handleSelectAll = useCallback(
    (checked: boolean) => {
      setSelectAll(checked);
      if (checked) {
        const newQuantities: Record<string, number> = {};
        for (const line of lines) {
          const remaining = getRemainingForLine(line);
          if (remaining > 0) {
            newQuantities[line.id] = remaining;
          }
        }
        setQuantities(newQuantities);
      } else {
        setQuantities({});
      }
    },
    [lines, getRemainingForLine],
  );

  const handleQuantityChange = useCallback(
    (lineId: string, value: string, maxValue: number) => {
      const numValue = parseFloat(value);
      if (value === '' || isNaN(numValue)) {
        setQuantities((prev) => {
          const next = { ...prev };
          delete next[lineId];
          return next;
        });
        return;
      }
      const clamped = Math.min(Math.max(0, numValue), maxValue);
      setQuantities((prev) => ({ ...prev, [lineId]: clamped }));
    },
    [],
  );

  const selectedLines = Object.entries(quantities)
    .filter(([, qty]) => qty > 0)
    .map(([lineId, quantity]) => ({ lineId, quantity }));

  const handleContinue = async () => {
    if (selectedLines.length === 0) {
      toast.error('Seleccioná al menos una línea con cantidad mayor a 0');
      return;
    }

    setIsConverting(true);
    try {
      if (type === 'invoice') {
        const result = await convertQuoteToInvoiceData(quoteId, selectedLines);

        if (result.needsCustomerCreation) {
          setPendingConversionData({
            leadData: result.leadData,
            quoteId: result.quoteId,
            invoiceLines: result.invoiceLines,
            quoteLineQuantities: result.quoteLineQuantities,
          });
          setShowLeadForm(true);
          setIsConverting(false);
          return;
        }

        // Store data in sessionStorage and redirect
        const storageKey = `quote-conversion-${quoteId}`;
        sessionStorage.setItem(
          storageKey,
          JSON.stringify({
            fromQuoteId: quoteId,
            customerId: result.customerId,
            lines: result.invoiceLines,
            quoteLineQuantities: result.quoteLineQuantities,
          }),
        );

        onOpenChange(false);
        router.push(`/dashboard/commercial/invoices/new?fromQuote=${quoteId}`);
      } else {
        const result = await convertQuoteToDeliveryData(quoteId, selectedLines);

        if (result.needsCustomerCreation) {
          toast.error('El presupuesto está asociado a un lead. Primero generá una factura para crear el cliente.');
          setIsConverting(false);
          return;
        }

        // Store delivery data in sessionStorage
        const storageKey = `quote-delivery-${quoteId}`;
        sessionStorage.setItem(
          storageKey,
          JSON.stringify({
            fromQuoteId: quoteId,
            customerId: result.customerId,
            customerName: result.customerName,
            lines: result.deliveryLines,
            quoteLineQuantities: result.quoteLineQuantities,
          }),
        );

        toast.success('Datos de remito preparados. Funcionalidad de remitos próximamente disponible.');
        onOpenChange(false);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Error al preparar la conversión';
      toast.error(message);
      logger.error('Error en conversión de presupuesto', { data: { quoteId, type, error: err } });
    } finally {
      setIsConverting(false);
    }
  };

  const handleLeadConverted = (customerId: string) => {
    if (!pendingConversionData) return;

    // Store data in sessionStorage and redirect
    const storageKey = `quote-conversion-${quoteId}`;
    sessionStorage.setItem(
      storageKey,
      JSON.stringify({
        fromQuoteId: quoteId,
        customerId,
        lines: pendingConversionData.invoiceLines,
        quoteLineQuantities: pendingConversionData.quoteLineQuantities,
      }),
    );

    onOpenChange(false);
    router.push(`/dashboard/commercial/invoices/new?fromQuote=${quoteId}`);
  };

  const typeLabel = type === 'invoice' ? 'facturar' : 'entregar';
  const TypeIcon = type === 'invoice' ? FileText : Truck;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <TypeIcon className="h-5 w-5" />
            {type === 'invoice' ? 'Generar Factura' : 'Generar Remito'} desde Presupuesto
          </DialogTitle>
          <DialogDescription>
            Seleccioná las líneas y cantidades a {typeLabel}. Podés hacer entregas o facturaciones parciales.
          </DialogDescription>
        </DialogHeader>

        {showLeadForm && pendingConversionData?.leadData ? (
          <_LeadToCustomerForm
            leadId={pendingConversionData.leadData.id}
            quoteId={quoteId}
            leadData={{
              name: pendingConversionData.leadData.name,
              email: pendingConversionData.leadData.email ?? '',
              phone: pendingConversionData.leadData.phone ?? '',
            }}
            onSuccess={handleLeadConverted}
            onCancel={() => setShowLeadForm(false)}
          />
        ) : (
          <>
            {isLoading && (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin" />
                <span className="ml-2 text-sm text-muted-foreground">Cargando líneas...</span>
              </div>
            )}

            {error && (
              <div className="py-8 text-center text-sm text-destructive">
                Error al cargar las líneas del presupuesto.
              </div>
            )}

            {!isLoading && !error && lines.length > 0 && (
              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="select-all"
                    checked={selectAll}
                    onCheckedChange={(checked) => handleSelectAll(!!checked)}
                  />
                  <label htmlFor="select-all" className="text-sm font-medium cursor-pointer">
                    Seleccionar todo (cantidades máximas)
                  </label>
                </div>

                <div className="overflow-x-auto border rounded-md">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50">
                      <tr className="text-left">
                        <th className="px-3 py-2">Producto</th>
                        <th className="px-3 py-2 text-right">Cotizado</th>
                        <th className="px-3 py-2 text-right">
                          {type === 'invoice' ? 'Facturado' : 'Entregado'}
                        </th>
                        <th className="px-3 py-2 text-right">Pendiente</th>
                        <th className="px-3 py-2 text-right">
                          Cantidad a {typeLabel}
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {lines.map((line) => {
                        const remaining = getRemainingForLine(line);
                        const already = type === 'invoice' ? line.invoicedQty : line.deliveredQty;

                        return (
                          <tr key={line.id} className={remaining <= 0 ? 'opacity-50' : ''}>
                            <td className="px-3 py-2">
                              <div className="font-medium">{line.product.name}</div>
                              <div className="text-xs text-muted-foreground">{line.product.code}</div>
                            </td>
                            <td className="px-3 py-2 text-right font-mono">
                              {line.quantity.toFixed(3)}
                            </td>
                            <td className="px-3 py-2 text-right font-mono">
                              {already.toFixed(3)}
                            </td>
                            <td className="px-3 py-2 text-right font-mono">
                              <span
                                className={
                                  remaining <= 0
                                    ? 'text-green-600'
                                    : remaining < line.quantity
                                      ? 'text-orange-600'
                                      : ''
                                }
                              >
                                {remaining.toFixed(3)}
                              </span>
                            </td>
                            <td className="px-3 py-2 text-right">
                              {remaining > 0 ? (
                                <Input
                                  type="number"
                                  step="0.001"
                                  min={0}
                                  max={remaining}
                                  value={quantities[line.id] ?? ''}
                                  onChange={(e) =>
                                    handleQuantityChange(line.id, e.target.value, remaining)
                                  }
                                  className="h-8 w-24 text-right font-mono ml-auto"
                                  placeholder="0"
                                />
                              ) : (
                                <span className="text-xs text-muted-foreground">Completo</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isConverting}>
                Cancelar
              </Button>
              <Button
                onClick={handleContinue}
                disabled={isConverting || isLoading || selectedLines.length === 0}
              >
                {isConverting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Procesando...
                  </>
                ) : (
                  'Continuar'
                )}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
