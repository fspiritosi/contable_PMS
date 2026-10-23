'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRef } from 'react';
import { Ban, Pencil, Trash2 } from 'lucide-react';

import { Button } from '@/shared/components/ui/button';
import { usePermissions } from '@/shared/hooks/usePermissions';

import { useDocumentCorrection } from '../hooks/useDocumentCorrection';

interface Props {
  kind: 'PURCHASE_INVOICE' | 'SALES_INVOICE';
  id: string;
  /** Ruta de la lista a la que se vuelve al eliminar. */
  listHref: string;
  /** Ruta del formulario de edición. */
  editHref: string;
  /** Muestra Editar (borrador o confirmado corregible). */
  canEdit: boolean;
  /** Muestra Eliminar y Anular (confirmado corregible, no bloqueado por AFIP). */
  canCorrect: boolean;
}

const PERMISSION_MODULE = {
  PURCHASE_INVOICE: 'commercial.purchases',
  SALES_INVOICE: 'commercial.invoices',
} as const;

/**
 * Botones Editar, Eliminar y Anular del detalle de una factura (TSK-792). Eliminar y Anular
 * abren la propuesta de corrección en cadena; Editar lleva al formulario, que la abre al guardar.
 */
export function _DocumentCorrectionButtons({
  kind,
  id,
  listHref,
  editHref,
  canEdit,
  canCorrect,
}: Props) {
  const router = useRouter();
  const { hasPermission } = usePermissions();
  const mod = PERMISSION_MODULE[kind];
  const ref = { kind, id };

  const afterDelete = useRef(false);
  const correction = useDocumentCorrection({
    onApplied: () => (afterDelete.current ? router.push(listHref) : router.refresh()),
  });

  const showEdit = canEdit && hasPermission(mod, 'update');
  const showDelete = canCorrect && hasPermission(mod, 'delete');

  return (
    <>
      {showEdit && (
        <Button variant="outline" asChild>
          <Link href={editHref}>
            <Pencil className="mr-2 h-4 w-4" />
            Editar
          </Link>
        </Button>
      )}
      {showDelete && (
        <>
          <Button
            variant="outline"
            disabled={correction.isPending}
            onClick={() => {
              afterDelete.current = true;
              correction.open({ mode: 'DELETE', ref });
            }}
          >
            <Trash2 className="mr-2 h-4 w-4" />
            Eliminar
          </Button>
          <Button
            variant="outline"
            disabled={correction.isPending}
            onClick={() => {
              afterDelete.current = false;
              correction.open({ mode: 'CANCEL', ref });
            }}
          >
            <Ban className="mr-2 h-4 w-4" />
            Anular
          </Button>
        </>
      )}
      {correction.dialog}
    </>
  );
}
