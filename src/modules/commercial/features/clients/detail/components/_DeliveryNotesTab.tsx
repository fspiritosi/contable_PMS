'use client';

import Link from 'next/link';
import { Badge } from '@/shared/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card';
import { Button } from '@/shared/components/ui/button';
import { ExternalLink, Package } from 'lucide-react';
import moment from 'moment';
import type { ClientDeliveryNote } from '../actions.server';
import {
  DELIVERY_NOTE_STATUS_LABELS,
  DELIVERY_NOTE_STATUS_VARIANTS,
} from '@/modules/commercial/features/sales/features/delivery-notes/shared/validators';
import type { DeliveryNoteStatus } from '@/generated/prisma/enums';

interface Props {
  deliveryNotes: ClientDeliveryNote[];
}

export function _DeliveryNotesTab({ deliveryNotes }: Props) {
  if (deliveryNotes.length === 0) {
    return (
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
            <Package className="h-8 w-8 mb-2" />
            <p>No hay remitos de entrega para este cliente</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Package className="h-5 w-5" />
          Remitos de Entrega ({deliveryNotes.length})
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b">
              <tr className="text-left">
                <th className="px-3 pb-3">Número</th>
                <th className="px-3 pb-3">Fecha</th>
                <th className="px-3 pb-3">Almacén</th>
                <th className="px-3 pb-3 text-right">Ítems</th>
                <th className="px-3 pb-3">Estado</th>
                <th className="px-3 pb-3">Factura</th>
                <th className="px-3 pb-3 w-10"></th>
              </tr>
            </thead>
            <tbody>
              {deliveryNotes.map((note) => {
                const status = note.status as DeliveryNoteStatus;
                return (
                  <tr key={note.id} className="border-b hover:bg-muted/50">
                    <td className="px-3 py-3 font-mono text-xs">{note.fullNumber}</td>
                    <td className="px-3 py-3">{moment.utc(note.deliveryDate).format('DD/MM/YYYY')}</td>
                    <td className="px-3 py-3">{note.warehouse.name}</td>
                    <td className="px-3 py-3 text-right">{note.lineCount}</td>
                    <td className="px-3 py-3">
                      <Badge
                        variant={DELIVERY_NOTE_STATUS_VARIANTS[status]}
                        className={
                          status === 'ACCEPTED'
                            ? 'bg-green-600 hover:bg-green-700'
                            : status === 'INVOICED'
                              ? 'bg-blue-600 hover:bg-blue-700'
                              : undefined
                        }
                      >
                        {DELIVERY_NOTE_STATUS_LABELS[status]}
                      </Badge>
                    </td>
                    <td className="px-3 py-3">
                      {note.salesInvoice ? (
                        <Link
                          href={`/dashboard/commercial/invoices/${note.salesInvoice.id}`}
                          className="font-mono text-xs text-primary hover:underline"
                        >
                          {note.salesInvoice.fullNumber}
                        </Link>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      <Button variant="ghost" size="sm" className="h-7 w-7 p-0" asChild>
                        <Link href={`/dashboard/commercial/delivery-notes/${note.id}`}>
                          <ExternalLink className="h-3.5 w-3.5" />
                        </Link>
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
