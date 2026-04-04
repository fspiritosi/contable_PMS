'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Printer, Tag } from 'lucide-react';
import JsBarcode from 'jsbarcode';

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
import { Input } from '@/shared/components/ui/input';
import { Label } from '@/shared/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui/select';
import { Separator } from '@/shared/components/ui/separator';
import { logger } from '@/shared/lib/logger';
import { getProductsForLabels } from '../actions.server';

// ============================================================================
// Types
// ============================================================================

type LabelSize = 'small' | 'medium' | 'large';
type PriceType = 'with_tax' | 'without_tax';

interface LabelConfig {
  size: LabelSize;
  copies: number;
  showPrice: boolean;
  priceType: PriceType;
}

const LABEL_SIZES: Record<LabelSize, { label: string; width: number; height: number; columns: number }> = {
  small: { label: 'Pequena (38x25mm)', width: 38, height: 25, columns: 4 },
  medium: { label: 'Mediana (50x30mm)', width: 50, height: 30, columns: 3 },
  large: { label: 'Grande (100x50mm)', width: 100, height: 50, columns: 2 },
};

// ============================================================================
// Barcode Preview Component
// ============================================================================

function BarcodePreview({ value, width, height }: { value: string; width: number; height: number }) {
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (svgRef.current && value) {
      try {
        JsBarcode(svgRef.current, value, {
          format: 'CODE128',
          width: 1.5,
          height: Math.max(20, height * 0.4),
          displayValue: true,
          fontSize: 10,
          margin: 2,
          textMargin: 1,
        });
      } catch {
        logger.warn('No se pudo generar codigo de barras', { data: { value } });
      }
    }
  }, [value, width, height]);

  if (!value) {
    return <span className="text-xs text-muted-foreground italic">Sin codigo</span>;
  }

  return <svg ref={svgRef} />;
}

// ============================================================================
// Main Component
// ============================================================================

interface LabelPrintModalProps {
  selectedIds: string[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function _LabelPrintModal({ selectedIds, open, onOpenChange }: LabelPrintModalProps) {
  const [config, setConfig] = useState<LabelConfig>({
    size: 'medium',
    copies: 1,
    showPrice: true,
    priceType: 'with_tax',
  });

  const { data: products, isLoading } = useQuery({
    queryKey: ['products-for-labels', selectedIds],
    queryFn: () => getProductsForLabels(selectedIds),
    enabled: open && selectedIds.length > 0,
  });

  const sizeConfig = LABEL_SIZES[config.size];
  const previewProduct = products?.[0];

  const handlePrint = useCallback(() => {
    if (!products?.length) return;

    // Build label entries with copies
    const labelEntries: typeof products = [];
    for (const product of products) {
      for (let i = 0; i < config.copies; i++) {
        labelEntries.push(product);
      }
    }

    const labelWidthMm = sizeConfig.width;
    const labelHeightMm = sizeConfig.height;
    const columns = sizeConfig.columns;
    const barcodeHeight = Math.max(20, labelHeightMm * 0.4);

    // Build print HTML
    const labelsHtml = labelEntries
      .map((product) => {
        const barcodeValue = product.barcode || product.code;
        const price = config.priceType === 'with_tax' ? product.salePriceWithTax : product.salePrice;
        const priceFormatted = new Intl.NumberFormat('es-AR', {
          style: 'currency',
          currency: 'ARS',
        }).format(price);

        // Create SVG barcode string using canvas trick
        const barcodeId = `bc-${product.id}-${Math.random().toString(36).slice(2, 8)}`;

        return `
          <div class="label" style="width:${labelWidthMm}mm;height:${labelHeightMm}mm;">
            <div class="label-name">${escapeHtml(truncate(product.name, config.size === 'small' ? 25 : config.size === 'medium' ? 35 : 60))}</div>
            <div class="label-barcode" id="${barcodeId}">
              <svg class="barcode" data-value="${escapeHtml(barcodeValue)}" data-height="${barcodeHeight}"></svg>
            </div>
            ${config.showPrice ? `<div class="label-price">${priceFormatted}</div>` : ''}
          </div>
        `;
      })
      .join('');

    const printHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>Etiquetas de Productos</title>
        <script src="https://cdn.jsdelivr.net/npm/jsbarcode@3.12.3/dist/JsBarcode.all.min.js"><\/script>
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body { font-family: Arial, Helvetica, sans-serif; }

          .labels-grid {
            display: flex;
            flex-wrap: wrap;
            gap: 2mm;
            padding: 5mm;
          }

          .label {
            border: 0.5px dashed #ccc;
            padding: 1.5mm;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            overflow: hidden;
            page-break-inside: avoid;
          }

          .label-name {
            font-size: ${config.size === 'small' ? '7' : config.size === 'medium' ? '8' : '10'}pt;
            font-weight: bold;
            text-align: center;
            line-height: 1.1;
            max-height: ${config.size === 'small' ? '3' : '4'}mm;
            overflow: hidden;
            width: 100%;
          }

          .label-barcode {
            flex: 1;
            display: flex;
            align-items: center;
            justify-content: center;
            width: 100%;
          }

          .label-barcode svg {
            max-width: 100%;
            max-height: 100%;
          }

          .label-price {
            font-size: ${config.size === 'small' ? '8' : config.size === 'medium' ? '10' : '14'}pt;
            font-weight: bold;
            text-align: center;
          }

          @media print {
            .label { border: none; }
            @page { margin: 5mm; }
          }
        </style>
      </head>
      <body>
        <div class="labels-grid" style="max-width: ${columns * (labelWidthMm + 2) + 10}mm;">
          ${labelsHtml}
        </div>
        <script>
          document.querySelectorAll('.barcode').forEach(function(svg) {
            try {
              JsBarcode(svg, svg.dataset.value, {
                format: 'CODE128',
                width: ${config.size === 'small' ? '1' : '1.5'},
                height: parseInt(svg.dataset.height) || 30,
                displayValue: true,
                fontSize: ${config.size === 'small' ? '8' : '10'},
                margin: 1,
                textMargin: 1,
              });
            } catch(e) {
              svg.parentElement.innerHTML = '<span style="font-size:8pt;color:#999;">Error</span>';
            }
          });
          setTimeout(function() { window.print(); }, 300);
        <\/script>
      </body>
      </html>
    `;

    const printWindow = window.open('', '_blank');
    if (printWindow) {
      printWindow.document.write(printHtml);
      printWindow.document.close();
    }
  }, [products, config, sizeConfig]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Tag className="h-5 w-5" />
            Imprimir Etiquetas
          </DialogTitle>
          <DialogDescription>
            Configura e imprime etiquetas con codigo de barras para {selectedIds.length}{' '}
            {selectedIds.length === 1 ? 'producto' : 'productos'}.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Configuration */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Tamano de etiqueta</Label>
              <Select
                value={config.size}
                onValueChange={(v) => setConfig((prev) => ({ ...prev, size: v as LabelSize }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(LABEL_SIZES).map(([key, val]) => (
                    <SelectItem key={key} value={key}>
                      {val.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Copias por producto</Label>
              <Input
                type="number"
                min={1}
                max={100}
                value={config.copies}
                onChange={(e) =>
                  setConfig((prev) => ({ ...prev, copies: Math.max(1, Math.min(100, parseInt(e.target.value) || 1)) }))
                }
              />
            </div>

            <div className="flex items-center space-x-2">
              <Checkbox
                id="show-price"
                checked={config.showPrice}
                onCheckedChange={(checked) =>
                  setConfig((prev) => ({ ...prev, showPrice: checked === true }))
                }
              />
              <Label htmlFor="show-price">Mostrar precio</Label>
            </div>

            {config.showPrice && (
              <div className="space-y-2">
                <Label>Precio a mostrar</Label>
                <Select
                  value={config.priceType}
                  onValueChange={(v) => setConfig((prev) => ({ ...prev, priceType: v as PriceType }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="with_tax">Con IVA</SelectItem>
                    <SelectItem value="without_tax">Sin IVA</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          <Separator />

          {/* Preview */}
          <div>
            <Label className="text-sm font-medium">Vista previa</Label>
            <div className="mt-2 flex justify-center rounded-md border bg-white p-4">
              {isLoading ? (
                <div className="text-sm text-muted-foreground">Cargando...</div>
              ) : previewProduct ? (
                <div
                  className="flex flex-col items-center justify-center border border-dashed border-gray-300 p-2"
                  style={{
                    width: `${sizeConfig.width * 2.5}px`,
                    height: `${sizeConfig.height * 2.5}px`,
                  }}
                >
                  <div
                    className="text-center font-bold leading-tight"
                    style={{ fontSize: config.size === 'small' ? '8px' : config.size === 'medium' ? '9px' : '11px' }}
                  >
                    {truncate(previewProduct.name, config.size === 'small' ? 25 : config.size === 'medium' ? 35 : 60)}
                  </div>
                  <div className="my-1 flex-1 flex items-center">
                    <BarcodePreview
                      value={previewProduct.barcode || previewProduct.code}
                      width={sizeConfig.width}
                      height={sizeConfig.height}
                    />
                  </div>
                  {config.showPrice && (
                    <div
                      className="font-bold"
                      style={{ fontSize: config.size === 'small' ? '9px' : config.size === 'medium' ? '11px' : '14px' }}
                    >
                      {new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(
                        config.priceType === 'with_tax'
                          ? previewProduct.salePriceWithTax
                          : previewProduct.salePrice
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-sm text-muted-foreground">Sin productos seleccionados</div>
              )}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Se imprimiran {selectedIds.length * config.copies} etiquetas en {sizeConfig.columns} columnas
              ({sizeConfig.width}x{sizeConfig.height}mm).
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={handlePrint} disabled={isLoading || !products?.length}>
            <Printer className="h-4 w-4 mr-2" />
            Imprimir
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================================
// Helpers
// ============================================================================

function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength - 1) + '\u2026';
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
