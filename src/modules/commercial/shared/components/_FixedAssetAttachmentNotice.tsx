'use client';

import { useMemo } from 'react';
import { useWatch } from 'react-hook-form';
import { Paperclip } from 'lucide-react';

import { Alert, AlertDescription } from '@/shared/components/ui/alert';
import {
  FIXED_ASSET_ATTACHMENT_SUGGESTION,
  buildFixedAssetSuggestionMessage,
  effectiveIsFixedAsset,
  findFixedAssetLines,
} from '../fixed-asset';

/** El ítem del selector, visto desde la sugerencia de adjuntar. */
interface NoticeProduct {
  id: string;
  /**
   * Marca de la cuenta de egresos del ítem. `null` significa "el ítem no tiene
   * cuenta propia" y cae en la de la empresa; `false`, "tiene cuenta y no es
   * Bien de Uso". No son lo mismo (ver `effectiveIsFixedAsset`).
   */
  defaultExpenseAccountIsFixedAsset: boolean | null;
}

interface FixedAssetAttachmentNoticeProps {
  /** Ítems del selector, con la marca de su cuenta de egresos. */
  products: NoticeProduct[];
  /** Marca de la cuenta de compras por defecto de la empresa. */
  defaultAccountIsFixedAsset: boolean;
  /** Ruta del array de líneas en el formulario. */
  name?: string;
}

/**
 * Lo mínimo que el aviso necesita de cada línea. Se declara acá, y no se importa
 * de `PurchaseInvoiceFormInput`, para que el componente viva en
 * `commercial/shared/` sin depender del feature de compras.
 */
interface WatchedLine {
  productId?: string;
  description?: string;
}

/**
 * Sugerencia no bloqueante de adjuntar el comprobante cuando la factura de
 * compra incluye bienes de uso (TSK-618).
 *
 * No valida ni condiciona nada: no entra en `purchaseInvoiceFormSchema` ni en el
 * guardado. Es solo presentación. El adjunto se sube después, desde el detalle,
 * que es justo la pantalla a la que el formulario redirige al guardar.
 *
 * Lee las líneas del contexto del formulario con `useWatch`, el mismo mecanismo
 * de `_LineCostCenterField` y `_CostCenterAllocationField`.
 */
export function _FixedAssetAttachmentNotice({
  products,
  defaultAccountIsFixedAsset,
  name = 'lines',
}: FixedAssetAttachmentNoticeProps) {
  const lines = useWatch({ name }) as WatchedLine[] | undefined;

  const fixedAssetLines = useMemo(() => {
    if (!lines?.length) return [];

    return findFixedAssetLines(
      lines.map((line) => {
        const product = products.find((p) => p.id === line?.productId);

        return {
          description: line?.description ?? '',
          // El ítem puede no tener cuenta propia: en ese caso el asiento igual
          // imputa la línea a la cuenta de compras por defecto de la empresa.
          isFixedAsset: effectiveIsFixedAsset(
            product?.defaultExpenseAccountIsFixedAsset,
            defaultAccountIsFixedAsset
          ),
        };
      })
    );
  }, [lines, products, defaultAccountIsFixedAsset]);

  if (fixedAssetLines.length === 0) return null;

  return (
    <Alert className="border-amber-500/50 bg-amber-50 dark:bg-amber-950/20">
      <Paperclip className="h-4 w-4 text-amber-600" />
      <AlertDescription className="space-y-1 text-amber-800 dark:text-amber-200">
        <p>{FIXED_ASSET_ATTACHMENT_SUGGESTION}</p>
        <p className="text-xs opacity-90">
          {buildFixedAssetSuggestionMessage(fixedAssetLines)}
        </p>
      </AlertDescription>
    </Alert>
  );
}
