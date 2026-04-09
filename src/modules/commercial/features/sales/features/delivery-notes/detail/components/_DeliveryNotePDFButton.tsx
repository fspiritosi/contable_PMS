'use client';

import { FileText } from 'lucide-react';
import type { getDeliveryNoteById } from '../../list/actions.server';
import {
  _PDFOptionsDialog,
  type LinkedRecordGroup,
} from '@/modules/commercial/shared/components/_PDFOptionsDialog';
import type { ReactNode } from 'react';

type Note = NonNullable<Awaited<ReturnType<typeof getDeliveryNoteById>>>;

interface Props {
  note: Note;
  trigger?: ReactNode;
}

export function _DeliveryNotePDFButton({ note, trigger }: Props) {
  const groups: LinkedRecordGroup[] = [];

  if (note.salesInvoice) {
    groups.push({
      key: 'salesInvoice',
      label: 'Factura de Venta',
      icon: FileText,
      items: [
        {
          label: `FV ${note.salesInvoice.fullNumber}`,
          detail: '',
          status: note.salesInvoice.status === 'CONFIRMED' ? 'Confirmada' : note.salesInvoice.status,
          statusVariant: 'outline' as const,
        },
      ],
    });
  }

  return (
    <_PDFOptionsDialog
      documentLabel={`Remito ${note.fullNumber}`}
      pdfUrl={`/api/delivery-notes/${note.id}/pdf`}
      linkedGroups={groups}
      trigger={trigger}
    />
  );
}
