'use client';

import { useState, useCallback } from 'react';
import { useForm } from 'react-hook-form';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Search, Link2 } from 'lucide-react';
import moment from 'moment';

import { Button } from '@/shared/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/shared/components/ui/form';
import { Input } from '@/shared/components/ui/input';
import { Textarea } from '@/shared/components/ui/textarea';
import { Badge } from '@/shared/components/ui/badge';
import { Separator } from '@/shared/components/ui/separator';
import { MoneyInput } from '@/shared/components/ui/money-input';

import { formatCurrency } from '@/shared/utils/formatters';
import { cn } from '@/shared/lib/utils';
import type { ProjectionListItem, DocumentForLinking } from '../../../../shared/types';
import type { ProjectionStatus } from '@/generated/prisma/enums';
import {
  type LinkDocumentFormData,
  PROJECTION_TYPE_LABELS,
  PROJECTION_CATEGORY_LABELS,
  PROJECTION_STATUS_LABELS,
} from '../../../../shared/validators';

const PROJECTION_STATUS_STYLE: Record<
  ProjectionStatus,
  { variant: 'secondary' | 'default' | 'destructive' | 'outline'; className?: string }
> = {
  PENDING: { variant: 'secondary' },
  PARTIAL: { variant: 'outline', className: 'border-yellow-500 text-yellow-700 bg-yellow-50' },
  CONFIRMED: { variant: 'outline', className: 'border-green-600 text-green-700 bg-green-50' },
};
import { searchDocumentsForLinking, linkDocumentToProjection } from '../../actions.server';

const DOC_TYPE_LABELS: Record<DocumentForLinking['documentType'], string> = {
  SALES_INVOICE: 'Factura de Venta',
  PURCHASE_INVOICE: 'Factura de Compra',
  EXPENSE: 'Gasto',
};

const DOC_TYPE_BADGES: Record<DocumentForLinking['documentType'], 'default' | 'secondary' | 'destructive'> = {
  SALES_INVOICE: 'default',
  PURCHASE_INVOICE: 'secondary',
  EXPENSE: 'destructive',
};

interface LinkFormValues {
  amount: string;
  notes: string;
}

interface Props {
  projection: ProjectionListItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

export function _LinkDocumentModal({ projection, open, onOpenChange, onSuccess }: Props) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [searchTimeout, setSearchTimeout] = useState<ReturnType<typeof setTimeout> | null>(null);
  const [selectedDocument, setSelectedDocument] = useState<DocumentForLinking | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const remaining = projection ? projection.amount - projection.confirmedAmount : 0;

  const form = useForm<LinkFormValues>({
    defaultValues: {
      amount: '',
      notes: '',
    },
  });

  const fetchDocuments = useCallback(
    () => searchDocumentsForLinking(projection?.id ?? '', debouncedSearch),
    [projection?.id, debouncedSearch]
  );

  const { data: documents = [], isFetching } = useQuery({
    queryKey: ['projection-link-search', projection?.id, debouncedSearch],
    queryFn: fetchDocuments,
    enabled: open && Boolean(projection?.id),
  });

  const handleSearchChange = (value: string) => {
    setSearch(value);
    if (searchTimeout) clearTimeout(searchTimeout);
    const timeout = setTimeout(() => {
      setDebouncedSearch(value);
    }, 400);
    setSearchTimeout(timeout);
  };

  const handleSelectDocument = (doc: DocumentForLinking) => {
    setSelectedDocument(doc);
    const prefill = Math.min(doc.total, remaining);
    form.setValue('amount', prefill > 0 ? prefill.toFixed(2) : '');
    form.setValue('notes', '');
  };

  const handleClose = () => {
    setSearch('');
    setDebouncedSearch('');
    setSelectedDocument(null);
    form.reset();
    onOpenChange(false);
  };

  const handleSubmit = async (values: LinkFormValues) => {
    if (!projection || !selectedDocument) return;

    const linkAmount = parseFloat(values.amount);
    if (isNaN(linkAmount) || linkAmount <= 0) {
      form.setError('amount', { message: 'El monto debe ser mayor a 0' });
      return;
    }
    if (linkAmount > remaining + 0.01) {
      form.setError('amount', {
        message: `El monto supera el saldo disponible (${formatCurrency(remaining)})`,
      });
      return;
    }

    const payload: LinkDocumentFormData = {
      projectionId: projection.id,
      amount: values.amount,
      notes: values.notes || null,
      salesInvoiceId:
        selectedDocument.documentType === 'SALES_INVOICE' ? selectedDocument.id : null,
      purchaseInvoiceId:
        selectedDocument.documentType === 'PURCHASE_INVOICE' ? selectedDocument.id : null,
      expenseId:
        selectedDocument.documentType === 'EXPENSE' ? selectedDocument.id : null,
    };

    setIsSubmitting(true);
    try {
      await linkDocumentToProjection(payload);
      toast.success('Documento vinculado correctamente');
      void queryClient.invalidateQueries({ queryKey: ['projection-link-search'] });
      void queryClient.invalidateQueries({ queryKey: ['projection-links', projection.id] });
      handleClose();
      onSuccess();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Error al vincular el documento');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!projection) return null;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="md:min-w-[800px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Link2 className="h-5 w-5" />
            Vincular Documento a Proyección
          </DialogTitle>
        </DialogHeader>

        {/* Resumen de la proyección */}
        <div className="rounded-lg border bg-muted/40 p-4 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-muted-foreground">Proyección</span>
            <Badge
              variant={PROJECTION_STATUS_STYLE[projection.status].variant}
              className={cn(PROJECTION_STATUS_STYLE[projection.status].className)}
            >
              {PROJECTION_STATUS_LABELS[projection.status]}
            </Badge>
          </div>
          <p className="text-sm font-semibold">{projection.description}</p>
          <div className="grid grid-cols-3 gap-2 text-xs text-muted-foreground">
            <div>
              <span className="block font-medium text-foreground">Tipo</span>
              {PROJECTION_TYPE_LABELS[projection.type]} · {PROJECTION_CATEGORY_LABELS[projection.category]}
            </div>
            <div>
              <span className="block font-medium text-foreground">Monto total</span>
              {formatCurrency(projection.amount)}
            </div>
            <div>
              <span className="block font-medium text-foreground">Saldo disponible</span>
              <span className={cn('font-semibold', remaining > 0 ? 'text-green-600' : 'text-muted-foreground')}>
                {formatCurrency(remaining)}
              </span>
            </div>
          </div>
        </div>

        <Separator />

        {/* Búsqueda de documentos */}
        <div className="space-y-3">
          <p className="text-sm font-medium">Buscar documento a vincular</p>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Buscar por número o entidad..."
              className="pl-9"
              value={search}
              onChange={(e) => handleSearchChange(e.target.value)}
            />
          </div>
          
          {/* TODO: Agregar un select de tipo de documento */}

          {/* Lista de resultados */}
          <div className="max-h-[60vh] overflow-y-auto rounded-md border">
            {isFetching ? (
              <div className="flex items-center justify-center py-6 text-sm text-muted-foreground">
                Buscando...
              </div>
            ) : documents.length === 0 ? (
              <div className="flex items-center justify-center py-6 text-sm text-muted-foreground">
                {debouncedSearch ? 'No se encontraron documentos' : 'Escriba para buscar documentos'}
              </div>
            ) : (
              <ul className="divide-y">
                {documents.map((doc) => (
                  <li key={`${doc.documentType}-${doc.id}`}>
                    <button
                      type="button"
                      onClick={() => handleSelectDocument(doc)}
                      className={cn(
                        'w-full px-3 py-2 text-left text-sm hover:bg-muted/60 transition-colors',
                        selectedDocument?.id === doc.id &&
                          selectedDocument?.documentType === doc.documentType &&
                          'bg-muted'
                      )}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <Badge variant={DOC_TYPE_BADGES[doc.documentType]} className="shrink-0 text-xs">
                            {DOC_TYPE_LABELS[doc.documentType]}
                          </Badge>
                          <span className="font-medium truncate">{doc.fullNumber}</span>
                          {doc.entityName && (
                            <span className="text-muted-foreground truncate hidden sm:block">
                              · {doc.entityName}
                            </span>
                          )}
                        </div>
                        <div className="shrink-0 text-right">
                          <span className="font-medium">{formatCurrency(doc.total)}</span>
                          <span className="block text-xs text-muted-foreground">
                            {moment.utc(doc.date).format('DD/MM/YYYY')}
                          </span>
                        </div>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* Formulario de vinculación (aparece cuando hay documento seleccionado) */}
        {selectedDocument && (
          <>
            <Separator />
            <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 text-sm">
              <p className="text-muted-foreground">Documento seleccionado:</p>
              <p className="font-semibold mt-0.5">
                {DOC_TYPE_LABELS[selectedDocument.documentType]} —{' '}
                {selectedDocument.fullNumber}
                {selectedDocument.entityName && ` · ${selectedDocument.entityName}`}
              </p>
              <p className="text-muted-foreground mt-0.5">
                Total: {formatCurrency(selectedDocument.total)} · {moment.utc(selectedDocument.date).format('DD/MM/YYYY')}
              </p>
            </div>

            <Form {...form}>
              <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <FormField
                    control={form.control}
                    name="amount"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Monto a confirmar</FormLabel>
                        <FormControl>
                          <MoneyInput
                            placeholder="0,00"
                            value={field.value}
                            onChange={field.onChange}
                            onBlur={field.onBlur}
                            name={field.name}
                            ref={field.ref}
                          />
                        </FormControl>
                        <p className="text-xs text-muted-foreground">
                          Máximo disponible: {formatCurrency(remaining)}
                        </p>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="notes"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Notas (opcional)</FormLabel>
                        <FormControl>
                          <Textarea
                            placeholder="Notas sobre el vínculo..."
                            className="resize-none"
                            rows={2}
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <div className="flex justify-end gap-2 pt-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleClose}
                    disabled={isSubmitting}
                  >
                    Cancelar
                  </Button>
                  <Button type="submit" disabled={isSubmitting}>
                    <Link2 className="mr-2 h-4 w-4" />
                    {isSubmitting ? 'Vinculando...' : 'Vincular'}
                  </Button>
                </div>
              </form>
            </Form>
          </>
        )}

        {/* Footer cuando no hay documento seleccionado */}
        {!selectedDocument && (
          <div className="flex justify-end pt-2">
            <Button type="button" variant="outline" onClick={handleClose}>
              Cerrar
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
