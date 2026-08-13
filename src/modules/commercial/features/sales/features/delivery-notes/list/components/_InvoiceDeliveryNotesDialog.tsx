'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import moment from 'moment';
import { Receipt, Loader2 } from 'lucide-react';

import { Button } from '@/shared/components/ui/button';
import { Checkbox } from '@/shared/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui/select';
import { logger } from '@/shared/lib/logger';
import { usePermissions } from '@/shared/hooks/usePermissions';

import {
  getAcceptedDeliveryNotesByCustomer,
  invoiceDeliveryNotes,
} from '../actions.server';

type CustomerGroup = Awaited<
  ReturnType<typeof getAcceptedDeliveryNotesByCustomer>
>[number];

type DeliveryNoteItem = CustomerGroup['notes'][number];

export function _InvoiceDeliveryNotesDialog() {
  const router = useRouter();
  const { hasPermission } = usePermissions();

  const [open, setOpen] = useState(false);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isInvoicing, setIsInvoicing] = useState(false);

  const { data: groups = [], isLoading } = useQuery({
    queryKey: ['accepted-delivery-notes-by-customer'],
    queryFn: getAcceptedDeliveryNotesByCustomer,
    enabled: open,
  });

  const selectedGroup: CustomerGroup | undefined = groups.find(
    (g) => g.customer.id === selectedCustomerId
  );
  const notes: DeliveryNoteItem[] = selectedGroup?.notes ?? [];

  const allSelected = notes.length > 0 && notes.every((n) => selectedIds.has(n.id));

  function handleCustomerChange(customerId: string) {
    setSelectedCustomerId(customerId);
    setSelectedIds(new Set());
  }

  function handleToggleAll(checked: boolean) {
    if (checked) {
      setSelectedIds(new Set(notes.map((n) => n.id)));
    } else {
      setSelectedIds(new Set());
    }
  }

  function handleToggleNote(id: string, checked: boolean) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  }

  function handleOpenChange(value: boolean) {
    if (!value) {
      setSelectedCustomerId('');
      setSelectedIds(new Set());
    }
    setOpen(value);
  }

  async function handleInvoice() {
    if (selectedIds.size === 0) return;

    setIsInvoicing(true);
    try {
      const invoice = await invoiceDeliveryNotes(Array.from(selectedIds));
      toast.success(`Factura ${invoice.fullNumber} creada en borrador`);
      handleOpenChange(false);
      router.refresh();
    } catch (error) {
      logger.error('Error al facturar remitos', { data: { error } });
      toast.error(error instanceof Error ? error.message : 'Error al facturar los remitos');
    } finally {
      setIsInvoicing(false);
    }
  }

  if (!hasPermission('commercial.invoices', 'create')) return null;

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <Receipt className="mr-2 h-4 w-4" />
        Facturar Remitos
      </Button>

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Facturar Remitos Aceptados</DialogTitle>
            <DialogDescription>
              Seleccioná un cliente y los remitos aceptados que querés incluir en la factura.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {/* Customer selector */}
            <div className="space-y-2">
              <label className="text-sm font-medium">Cliente</label>
              {isLoading ? (
                <div className="flex items-center gap-2 text-muted-foreground text-sm">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Cargando clientes...
                </div>
              ) : groups.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No hay remitos aceptados pendientes de facturar.
                </p>
              ) : (
                <Select value={selectedCustomerId} onValueChange={handleCustomerChange}>
                  <SelectTrigger>
                    <SelectValue placeholder="Seleccionar cliente..." />
                  </SelectTrigger>
                  <SelectContent>
                    {groups.map((g) => (
                      <SelectItem key={g.customer.id} value={g.customer.id}>
                        {g.customer.name}
                        {g.customer.taxId ? ` — ${g.customer.taxId}` : ''}
                        {' '}
                        <span className="text-muted-foreground">
                          ({g.notes.length} {g.notes.length === 1 ? 'remito' : 'remitos'})
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            {/* Notes table */}
            {selectedCustomerId && notes.length > 0 && (
              <div className="space-y-2">
                <label className="text-sm font-medium">Remitos aceptados</label>
                <div className="border rounded-md overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50">
                      <tr>
                        <th className="w-10 px-3 py-2 text-left">
                          <Checkbox
                            checked={allSelected}
                            onCheckedChange={(checked) => handleToggleAll(Boolean(checked))}
                            aria-label="Seleccionar todos"
                          />
                        </th>
                        <th className="px-3 py-2 text-left font-medium text-muted-foreground">
                          Número
                        </th>
                        <th className="px-3 py-2 text-left font-medium text-muted-foreground hidden sm:table-cell">
                          Fecha de entrega
                        </th>
                        <th className="px-3 py-2 text-left font-medium text-muted-foreground hidden sm:table-cell">
                          Ítems
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {notes.map((note) => (
                        <tr
                          key={note.id}
                          className="hover:bg-muted/30 cursor-pointer"
                          onClick={() =>
                            handleToggleNote(note.id, !selectedIds.has(note.id))
                          }
                        >
                          <td className="px-3 py-2">
                            <Checkbox
                              checked={selectedIds.has(note.id)}
                              onCheckedChange={(checked) =>
                                handleToggleNote(note.id, Boolean(checked))
                              }
                              onClick={(e) => e.stopPropagation()}
                              aria-label={`Seleccionar remito ${note.fullNumber}`}
                            />
                          </td>
                          <td className="px-3 py-2 font-mono font-medium">
                            {note.fullNumber}
                          </td>
                          <td className="px-3 py-2 text-muted-foreground hidden sm:table-cell">
                            {moment(note.deliveryDate).format('DD/MM/YYYY')}
                          </td>
                          <td className="px-3 py-2 text-muted-foreground hidden sm:table-cell">
                            {note.lines.length}{' '}
                            {note.lines.length === 1 ? 'ítem' : 'ítems'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <p className="text-sm text-muted-foreground">
                  {selectedIds.size > 0
                    ? `${selectedIds.size} ${selectedIds.size === 1 ? 'remito seleccionado' : 'remitos seleccionados'}`
                    : 'Ningún remito seleccionado'}
                </p>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => handleOpenChange(false)}
              disabled={isInvoicing}
            >
              Cancelar
            </Button>
            <Button
              onClick={handleInvoice}
              disabled={selectedIds.size === 0 || isInvoicing}
            >
              {isInvoicing ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Facturando...
                </>
              ) : (
                <>
                  <Receipt className="mr-2 h-4 w-4" />
                  Facturar ({selectedIds.size})
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
