import { getReceivingNoteById } from '../list/actions.server';
import { PermissionGuard } from '@/shared/components/common/PermissionGuard';
import { Button } from '@/shared/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card';
import { Badge } from '@/shared/components/ui/badge';
import { Pencil } from 'lucide-react';
import { BackButton } from '@/shared/components/common/BackButton';
import Link from 'next/link';
import moment from 'moment';
import { RECEIVING_NOTE_STATUS_LABELS, RECEIVING_NOTE_STATUS_VARIANTS } from '../shared/validators';
import type { ReceivingNoteStatus } from '@/generated/prisma/enums';
import { cn } from '@/shared/lib/utils';
import { _ReceivingNoteActions } from './components/_ReceivingNoteActions';
import { _ReceivingNotePDFButton } from './components/_ReceivingNotePDFButton';

interface Props {
  noteId: string;
}

export async function ReceivingNoteDetail({ noteId }: Props) {
  const note = await getReceivingNoteById(noteId);

  const status = note.status as ReceivingNoteStatus;
  const statusVariant = RECEIVING_NOTE_STATUS_VARIANTS[status];
  const isDraft = status === 'DRAFT';

  return (
    <PermissionGuard module="commercial.receiving-notes" action="view" redirect>
      <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <BackButton variant="outline" />
          <div>
            <h1 className="text-3xl font-bold tracking-tight">
              {note.fullNumber}
            </h1>
            <p className="text-muted-foreground">Remito de Recepción</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isDraft && (
            <Button variant="outline" asChild>
              <Link href={`/dashboard/commercial/receiving-notes/${noteId}/edit`}>
                <Pencil className="mr-2 h-4 w-4" />
                Editar
              </Link>
            </Button>
          )}
          {status === 'CONFIRMED' && (
            <_ReceivingNotePDFButton note={note} />
          )}
          <_ReceivingNoteActions noteId={note.id} status={status} fullNumber={note.fullNumber} />
          <Badge
            variant={statusVariant}
            className={cn(
              'text-sm px-3 py-1',
              status === 'CONFIRMED' && 'bg-green-600 hover:bg-green-700'
            )}
          >
            {RECEIVING_NOTE_STATUS_LABELS[status]}
          </Badge>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Columna Principal */}
        <div className="lg:col-span-2 space-y-6">
          {/* Datos del Proveedor */}
          <Card>
            <CardHeader>
              <CardTitle>Proveedor</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-muted-foreground">Razón Social</p>
                  <p className="font-medium">{note.supplier.businessName}</p>
                  {note.supplier.tradeName && (
                    <p className="text-sm text-muted-foreground">{note.supplier.tradeName}</p>
                  )}
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">CUIT</p>
                  <p className="font-mono">{note.supplier.taxId}</p>
                </div>
                {note.supplier.address && (
                  <div>
                    <p className="text-sm text-muted-foreground">Dirección</p>
                    <p>{note.supplier.address}</p>
                  </div>
                )}
                {note.supplier.phone && (
                  <div>
                    <p className="text-sm text-muted-foreground">Teléfono</p>
                    <p>{note.supplier.phone}</p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Documento Origen */}
          {(note.purchaseOrder || note.purchaseInvoice) && (
            <Card>
              <CardHeader>
                <CardTitle>Documento Origen</CardTitle>
              </CardHeader>
              <CardContent>
                {note.purchaseOrder && (
                  <div className="flex items-center gap-3">
                    <Badge variant="outline">OC</Badge>
                    <Link
                      href={`/dashboard/commercial/purchase-orders/${note.purchaseOrder.id}`}
                      className="text-primary hover:underline font-medium"
                    >
                      {note.purchaseOrder.fullNumber}
                    </Link>
                    <Badge variant="secondary" className="text-xs">
                      {note.purchaseOrder.status}
                    </Badge>
                  </div>
                )}
                {note.purchaseInvoice && (
                  <div className="flex items-center gap-3">
                    <Badge variant="outline">FC</Badge>
                    <Link
                      href={`/dashboard/commercial/purchases/${note.purchaseInvoice.id}`}
                      className="text-primary hover:underline font-medium"
                    >
                      {note.purchaseInvoice.fullNumber}
                    </Link>
                    <Badge variant="secondary" className="text-xs">
                      {note.purchaseInvoice.status}
                    </Badge>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Líneas */}
          <Card>
            <CardHeader>
              <CardTitle>Productos Recibidos</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-2 pr-4">Producto</th>
                      <th className="text-left py-2 px-4">Descripción</th>
                      <th className="text-right py-2 px-4">Cantidad</th>
                      <th className="text-left py-2 pl-4">Observaciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {note.lines.map((line) => (
                      <tr key={line.id} className="border-b last:border-0">
                        <td className="py-2 pr-4">
                          {line.product && (
                            <p className="text-xs text-muted-foreground font-mono">
                              [{line.product.code}] {line.product.name}
                            </p>
                          )}
                        </td>
                        <td className="py-2 px-4">
                          <p className="font-medium">{line.description}</p>
                          {line.purchaseOrderLine && (
                            <p className="text-xs text-muted-foreground">
                              OC: {line.purchaseOrderLine.receivedQty}/{line.purchaseOrderLine.quantity} recibidos
                            </p>
                          )}
                        </td>
                        <td className="text-right py-2 px-4 font-mono">
                          {line.quantity}
                          {line.product?.unitOfMeasure && (
                            <span className="text-muted-foreground ml-1 text-xs">
                              {line.product.unitOfMeasure}
                            </span>
                          )}
                        </td>
                        <td className="py-2 pl-4 text-muted-foreground">
                          {line.notes || '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Columna Lateral */}
        <div className="space-y-6">
          {/* Fechas */}
          <Card>
            <CardHeader>
              <CardTitle>Fechas</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <p className="text-sm text-muted-foreground">Fecha de Recepción</p>
                <p className="font-medium">{moment.utc(note.receptionDate).format('DD/MM/YYYY')}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Fecha de Creación</p>
                <p className="font-medium">{moment(note.createdAt).format('DD/MM/YYYY HH:mm')}</p>
              </div>
            </CardContent>
          </Card>

          {/* Almacén */}
          <Card>
            <CardHeader>
              <CardTitle>Almacén</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="font-medium">{note.warehouse.name}</p>
            </CardContent>
          </Card>

          {/* Observaciones */}
          {note.notes && (
            <Card>
              <CardHeader>
                <CardTitle>Observaciones</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="whitespace-pre-wrap">{note.notes}</p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
    </PermissionGuard>
  );
}
