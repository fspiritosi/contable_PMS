'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import ExcelJS from 'exceljs';
import { saveAs } from 'file-saver';
import {
  Download,
  Upload,
  FileSpreadsheet,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Loader2,
} from 'lucide-react';

import { Button } from '@/shared/components/ui/button';
import { Badge } from '@/shared/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/shared/components/ui/table';
import { logger } from '@/shared/lib/logger';
import {
  processProductImport,
  getProductImportColumns,
  type ProductImportRow,
  type ProductImportError,
} from '../actions.server';

/** Colores del tema para la plantilla Excel */
const THEME = {
  primary: '374151',
  headerBg: '6b7280',
  headerText: 'FFFFFF',
  requiredBg: 'fef3c7',
  exampleBg: 'f0f9ff',
  border: 'e5e7eb',
  instructionBg: 'dbeafe',
};

type ImportStep = 'upload' | 'preview' | 'result';

interface ProductImportModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

interface ParsedRow extends ProductImportRow {
  _rowNumber: number;
  _errors: ProductImportError[];
}

export function _ProductImportModal({
  open,
  onOpenChange,
  onSuccess,
}: ProductImportModalProps) {
  const [step, setStep] = useState<ImportStep>('upload');
  const [parsedRows, setParsedRows] = useState<ParsedRow[]>([]);
  const [fileName, setFileName] = useState<string>('');
  const [importResult, setImportResult] = useState<{
    imported: number;
    updated: number;
    errors: ProductImportError[];
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const columns = useMemo(() => getProductImportColumns(), []);

  const validRows = useMemo(
    () => parsedRows.filter((r) => r._errors.length === 0),
    [parsedRows]
  );
  const errorRows = useMemo(
    () => parsedRows.filter((r) => r._errors.length > 0),
    [parsedRows]
  );

  const resetState = useCallback(() => {
    setStep('upload');
    setParsedRows([]);
    setFileName('');
    setImportResult(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, []);

  const handleClose = useCallback(
    (isOpen: boolean) => {
      if (!isOpen) {
        resetState();
      }
      onOpenChange(isOpen);
    },
    [onOpenChange, resetState]
  );

  // Generate & download the Excel template
  const handleDownloadTemplate = useCallback(async () => {
    try {
      const workbook = new ExcelJS.Workbook();
      workbook.creator = 'Baxer ERP';
      workbook.created = new Date();

      // Sheet 1: Template
      const dataSheet = workbook.addWorksheet('Productos', {
        views: [{ state: 'frozen', ySplit: 1 }],
      });

      // Headers
      const headerRow = dataSheet.getRow(1);
      columns.forEach((col, index) => {
        const cell = headerRow.getCell(index + 1);
        cell.value = col.required ? `${col.label} *` : col.label;
        cell.font = {
          bold: true,
          color: { argb: THEME.headerText },
          size: 11,
        };
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: THEME.headerBg },
        };
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
        cell.border = {
          top: { style: 'thin', color: { argb: THEME.border } },
          bottom: { style: 'thin', color: { argb: THEME.border } },
          left: { style: 'thin', color: { argb: THEME.border } },
          right: { style: 'thin', color: { argb: THEME.border } },
        };
      });
      headerRow.height = 25;

      // Example row
      const exampleRow = dataSheet.getRow(2);
      columns.forEach((col, index) => {
        const cell = exampleRow.getCell(index + 1);
        cell.value = col.example;
        cell.alignment = { vertical: 'middle' };
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: THEME.exampleBg },
        };
        cell.font = { italic: true, color: { argb: '6b7280' } };
      });
      exampleRow.height = 20;

      // Column widths
      columns.forEach((col, index) => {
        dataSheet.getColumn(index + 1).width = col.width;
      });

      // Auto filter
      dataSheet.autoFilter = {
        from: { row: 1, column: 1 },
        to: { row: 1, column: columns.length },
      };

      // Sheet 2: Instructions
      const instrSheet = workbook.addWorksheet('Instrucciones');

      let row = 1;
      instrSheet.mergeCells(row, 1, row, 2);
      const titleCell = instrSheet.getCell(row, 1);
      titleCell.value = 'Instrucciones para Importar Productos';
      titleCell.font = { bold: true, size: 16, color: { argb: THEME.primary } };
      titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
      instrSheet.getRow(row).height = 30;
      row += 2;

      const instructions = [
        {
          title: '1. Campos Obligatorios',
          points: [
            'Código: Código único del producto (SKU). Si el código ya existe, se actualizará el producto.',
            'Nombre: Nombre del producto.',
          ],
        },
        {
          title: '2. Campos Opcionales',
          points: [
            'Descripción: Descripción detallada del producto.',
            'Categoría: Nombre de la categoría. Si no existe, se creará automáticamente.',
            'Precio Costo: Precio de costo (sin IVA). Dejar vacío para 0.',
            'Precio Venta (sin IVA): Precio de venta sin IVA. Dejar vacío para 0.',
            'IVA %: Alícuota de IVA (ej: 21, 10.5, 27). Dejar vacío para 21%.',
            'Unidad Medida: UN (unidad), KG, M, L, etc. Dejar vacío para UN.',
            'Código de Barras: Código EAN/UPC del producto.',
            'Marca: Marca del producto.',
            'Modelo: Modelo del producto.',
          ],
        },
        {
          title: '3. Comportamiento',
          points: [
            'Si el código ya existe en el sistema, el producto se ACTUALIZA con los nuevos datos.',
            'Si el código no existe, se CREA un nuevo producto.',
            'Las categorías se buscan por nombre (sin importar mayúsculas/minúsculas).',
            'La fila 2 es un ejemplo; debe eliminarse antes de importar.',
          ],
        },
      ];

      instructions.forEach((section) => {
        instrSheet.mergeCells(row, 1, row, 2);
        const sectionCell = instrSheet.getCell(row, 1);
        sectionCell.value = section.title;
        sectionCell.font = { bold: true, size: 12, color: { argb: THEME.primary } };
        sectionCell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: THEME.instructionBg },
        };
        instrSheet.getRow(row).height = 22;
        row++;

        section.points.forEach((point) => {
          instrSheet.mergeCells(row, 1, row, 2);
          const pointCell = instrSheet.getCell(row, 1);
          pointCell.value = `  • ${point}`;
          pointCell.alignment = { wrapText: true, vertical: 'top' };
          instrSheet.getRow(row).height = 20;
          row++;
        });

        row++;
      });

      instrSheet.getColumn(1).width = 80;
      instrSheet.getColumn(2).width = 20;

      // Download
      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      saveAs(blob, 'plantilla-importacion-productos.xlsx');
    } catch (error) {
      logger.error('Error al generar plantilla', { data: { error } });
      toast.error('Error al generar la plantilla');
    }
  }, [columns]);

  // Parse uploaded file
  const handleFileUpload = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;

      setFileName(file.name);

      try {
        const buffer = await file.arrayBuffer();
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(buffer);

        const worksheet = workbook.worksheets[0];
        if (!worksheet) {
          toast.error('El archivo no contiene hojas de cálculo');
          return;
        }

        // Read headers from row 1
        const headerRow = worksheet.getRow(1);
        const headerMap = new Map<number, string>();

        headerRow.eachCell((cell, colNumber) => {
          const value = String(cell.value || '')
            .trim()
            .replace(/\s*\*$/, ''); // Remove trailing *
          // Match header to column key
          const col = columns.find(
            (c) => c.label.toLowerCase() === value.toLowerCase()
          );
          if (col) {
            headerMap.set(colNumber, col.key);
          }
        });

        if (headerMap.size === 0) {
          toast.error(
            'No se reconocieron las columnas. Descargá la plantilla y usala como base.'
          );
          return;
        }

        // Parse data rows
        const rows: ParsedRow[] = [];
        worksheet.eachRow((row, rowNumber) => {
          if (rowNumber === 1) return; // Skip header

          const rowData: Record<string, unknown> = {};
          let hasData = false;

          headerMap.forEach((key, colNumber) => {
            const cell = row.getCell(colNumber);
            let value: string | number | boolean | Date | null | undefined = undefined;
            const rawValue = cell.value;

            // Handle ExcelJS rich text / formula results
            if (rawValue && typeof rawValue === 'object' && 'result' in rawValue) {
              const result = (rawValue as { result: unknown }).result;
              value = typeof result === 'string' || typeof result === 'number' ? result : undefined;
            } else if (rawValue && typeof rawValue === 'object' && 'richText' in rawValue) {
              value = (rawValue as { richText: Array<{ text: string }> }).richText
                .map((rt) => rt.text)
                .join('');
            } else if (typeof rawValue === 'string' || typeof rawValue === 'number' || typeof rawValue === 'boolean') {
              value = rawValue;
            } else if (rawValue instanceof Date) {
              value = rawValue;
            }

            if (value != null && value !== '') {
              hasData = true;
              rowData[key] = value;
            }
          });

          if (!hasData) return;

          // Build parsed row
          const errors: ProductImportError[] = [];
          const code = String(rowData.code ?? '').trim();
          const name = String(rowData.name ?? '').trim();

          if (!code) {
            errors.push({ row: rowNumber, field: 'code', message: 'Código requerido' });
          }
          if (!name) {
            errors.push({ row: rowNumber, field: 'name', message: 'Nombre requerido' });
          }

          const costPrice = rowData.costPrice != null ? Number(rowData.costPrice) : undefined;
          const salePrice = rowData.salePrice != null ? Number(rowData.salePrice) : undefined;
          const vatRate = rowData.vatRate != null ? Number(rowData.vatRate) : undefined;
          const minStock = rowData.minStock != null ? Number(rowData.minStock) : undefined;
          const maxStock = rowData.maxStock != null ? Number(rowData.maxStock) : undefined;

          if (costPrice != null && isNaN(costPrice)) {
            errors.push({ row: rowNumber, field: 'costPrice', message: 'Precio costo inválido' });
          }
          if (salePrice != null && isNaN(salePrice)) {
            errors.push({ row: rowNumber, field: 'salePrice', message: 'Precio venta inválido' });
          }
          if (vatRate != null && (isNaN(vatRate) || vatRate < 0 || vatRate > 100)) {
            errors.push({ row: rowNumber, field: 'vatRate', message: 'IVA % inválido' });
          }

          rows.push({
            _rowNumber: rowNumber,
            _errors: errors,
            code,
            name,
            description: rowData.description ? String(rowData.description).trim() : undefined,
            categoryName: rowData.categoryName ? String(rowData.categoryName).trim() : undefined,
            costPrice,
            salePrice,
            vatRate,
            unitOfMeasure: rowData.unitOfMeasure ? String(rowData.unitOfMeasure).trim() : undefined,
            barcode: rowData.barcode ? String(rowData.barcode).trim() : undefined,
            brand: rowData.brand ? String(rowData.brand).trim() : undefined,
            model: rowData.model ? String(rowData.model).trim() : undefined,
            trackStock: undefined,
            minStock,
            maxStock,
            oemCode: rowData.oemCode ? String(rowData.oemCode).trim() : undefined,
            auxiliaryCode: rowData.auxiliaryCode ? String(rowData.auxiliaryCode).trim() : undefined,
          });
        });

        if (rows.length === 0) {
          toast.error('El archivo no contiene datos para importar');
          return;
        }

        setParsedRows(rows);
        setStep('preview');
      } catch (error) {
        logger.error('Error al parsear archivo Excel', { data: { error } });
        toast.error('Error al leer el archivo. Verificá que sea un archivo Excel válido.');
      }
    },
    [columns]
  );

  // Import mutation
  const importMutation = useMutation({
    mutationFn: async () => {
      // Send only valid rows (strip internal fields)
      const rowsToImport: ProductImportRow[] = validRows.map((parsed) => ({
        code: parsed.code,
        name: parsed.name,
        description: parsed.description,
        categoryName: parsed.categoryName,
        costPrice: parsed.costPrice,
        salePrice: parsed.salePrice,
        vatRate: parsed.vatRate,
        unitOfMeasure: parsed.unitOfMeasure,
        barcode: parsed.barcode,
        brand: parsed.brand,
        model: parsed.model,
        trackStock: parsed.trackStock,
        minStock: parsed.minStock,
        maxStock: parsed.maxStock,
        oemCode: parsed.oemCode,
        auxiliaryCode: parsed.auxiliaryCode,
      }));
      return processProductImport(rowsToImport);
    },
    onSuccess: (result) => {
      setImportResult({
        imported: result.imported,
        updated: result.updated,
        errors: [...errorRows.flatMap((r) => r._errors), ...result.errors],
      });
      setStep('result');

      if (result.success) {
        toast.success(
          `Importación completada: ${result.imported} creados, ${result.updated} actualizados`
        );
        onSuccess();
      } else {
        toast.error('La importación tuvo errores');
      }
    },
    onError: (error) => {
      logger.error('Error en importación masiva', { data: { error } });
      toast.error(
        error instanceof Error ? error.message : 'Error al importar productos'
      );
    },
  });

  // Preview rows (first 20)
  const previewRows = useMemo(() => parsedRows.slice(0, 20), [parsedRows]);

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5" />
            Importar Productos desde Excel
          </DialogTitle>
          <DialogDescription>
            {step === 'upload' && 'Subí un archivo Excel (.xlsx) con los productos a importar.'}
            {step === 'preview' && 'Revisá los datos antes de confirmar la importación.'}
            {step === 'result' && 'Resultado de la importación.'}
          </DialogDescription>
        </DialogHeader>

        {/* Step 1: Upload */}
        {step === 'upload' && (
          <div className="space-y-6 py-4">
            {/* Download template */}
            <div className="rounded-lg border border-dashed p-6 text-center space-y-4">
              <div className="flex flex-col items-center gap-2">
                <Download className="h-8 w-8 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">
                  Primero descargá la plantilla con el formato correcto
                </p>
              </div>
              <Button variant="outline" onClick={handleDownloadTemplate}>
                <Download className="h-4 w-4 mr-2" />
                Descargar Plantilla
              </Button>
            </div>

            {/* Upload file */}
            <div className="rounded-lg border border-dashed p-6 text-center space-y-4">
              <div className="flex flex-col items-center gap-2">
                <Upload className="h-8 w-8 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">
                  Luego subí el archivo completado con tus productos
                </p>
              </div>
              <div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx,.xls"
                  onChange={handleFileUpload}
                  className="hidden"
                  id="product-import-file"
                />
                <Button
                  variant="default"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Upload className="h-4 w-4 mr-2" />
                  Seleccionar Archivo
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Step 2: Preview */}
        {step === 'preview' && (
          <div className="space-y-4 py-2">
            {/* Summary badges */}
            <div className="flex flex-wrap items-center gap-3">
              <Badge variant="secondary">
                <FileSpreadsheet className="h-3 w-3 mr-1" />
                {fileName}
              </Badge>
              <Badge variant="default">
                {parsedRows.length} filas totales
              </Badge>
              <Badge variant="success">
                <CheckCircle2 className="h-3 w-3 mr-1" />
                {validRows.length} válidos
              </Badge>
              {errorRows.length > 0 && (
                <Badge variant="destructive">
                  <XCircle className="h-3 w-3 mr-1" />
                  {errorRows.length} con errores
                </Badge>
              )}
            </div>

            {/* Preview table */}
            <div className="max-h-[400px] overflow-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">#</TableHead>
                    <TableHead className="w-10">Estado</TableHead>
                    <TableHead>Código</TableHead>
                    <TableHead>Nombre</TableHead>
                    <TableHead>Categoría</TableHead>
                    <TableHead className="text-right">P. Costo</TableHead>
                    <TableHead className="text-right">P. Venta</TableHead>
                    <TableHead className="text-right">IVA %</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {previewRows.map((row) => (
                    <TableRow
                      key={row._rowNumber}
                      className={row._errors.length > 0 ? 'bg-red-50 dark:bg-red-950/20' : ''}
                    >
                      <TableCell className="text-muted-foreground text-xs">
                        {row._rowNumber}
                      </TableCell>
                      <TableCell>
                        {row._errors.length > 0 ? (
                          <XCircle className="h-4 w-4 text-destructive" />
                        ) : (
                          <CheckCircle2 className="h-4 w-4 text-green-600" />
                        )}
                      </TableCell>
                      <TableCell className="font-mono text-sm">{row.code || '—'}</TableCell>
                      <TableCell>{row.name || '—'}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {row.categoryName || '—'}
                      </TableCell>
                      <TableCell className="text-right">
                        {row.costPrice != null ? row.costPrice.toLocaleString('es-AR') : '—'}
                      </TableCell>
                      <TableCell className="text-right">
                        {row.salePrice != null ? row.salePrice.toLocaleString('es-AR') : '—'}
                      </TableCell>
                      <TableCell className="text-right">
                        {row.vatRate != null ? `${row.vatRate}%` : '21%'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {parsedRows.length > 20 && (
              <p className="text-xs text-muted-foreground text-center">
                Mostrando las primeras 20 filas de {parsedRows.length}
              </p>
            )}

            {/* Error details */}
            {errorRows.length > 0 && (
              <div className="rounded-md border border-destructive/50 bg-destructive/5 p-3 space-y-2">
                <div className="flex items-center gap-2 text-sm font-medium text-destructive">
                  <AlertTriangle className="h-4 w-4" />
                  Errores encontrados ({errorRows.length} filas)
                </div>
                <div className="max-h-[120px] overflow-auto space-y-1">
                  {errorRows.slice(0, 20).map((row) =>
                    row._errors.map((err, idx) => (
                      <p
                        key={`${row._rowNumber}-${idx}`}
                        className="text-xs text-muted-foreground"
                      >
                        Fila {err.row}: {err.message} ({err.field})
                      </p>
                    ))
                  )}
                  {errorRows.length > 20 && (
                    <p className="text-xs text-muted-foreground font-medium">
                      ...y {errorRows.length - 20} errores más
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Step 3: Result */}
        {step === 'result' && importResult && (
          <div className="space-y-4 py-4">
            <div className="flex flex-col items-center gap-4 py-6">
              <CheckCircle2 className="h-12 w-12 text-green-600" />
              <div className="text-center space-y-1">
                <p className="text-lg font-medium">Importación completada</p>
                <p className="text-muted-foreground">
                  Se procesaron los productos correctamente.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4 text-center">
              <div className="rounded-lg border p-4">
                <p className="text-2xl font-bold text-green-600">
                  {importResult.imported}
                </p>
                <p className="text-sm text-muted-foreground">Creados</p>
              </div>
              <div className="rounded-lg border p-4">
                <p className="text-2xl font-bold text-blue-600">
                  {importResult.updated}
                </p>
                <p className="text-sm text-muted-foreground">Actualizados</p>
              </div>
              <div className="rounded-lg border p-4">
                <p className="text-2xl font-bold text-destructive">
                  {importResult.errors.length}
                </p>
                <p className="text-sm text-muted-foreground">Errores</p>
              </div>
            </div>

            {importResult.errors.length > 0 && (
              <div className="rounded-md border border-destructive/50 bg-destructive/5 p-3 space-y-1">
                <p className="text-sm font-medium text-destructive">
                  Filas con errores (no importadas):
                </p>
                <div className="max-h-[120px] overflow-auto space-y-1">
                  {importResult.errors.slice(0, 20).map((err, idx) => (
                    <p key={idx} className="text-xs text-muted-foreground">
                      Fila {err.row}: {err.message} ({err.field})
                    </p>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          {step === 'preview' && (
            <div className="flex w-full justify-between">
              <Button variant="outline" onClick={resetState}>
                Volver
              </Button>
              <Button
                onClick={() => importMutation.mutate()}
                disabled={validRows.length === 0 || importMutation.isPending}
              >
                {importMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Importando...
                  </>
                ) : (
                  <>
                    <Upload className="h-4 w-4 mr-2" />
                    Importar {validRows.length} productos
                  </>
                )}
              </Button>
            </div>
          )}
          {step === 'result' && (
            <Button onClick={() => handleClose(false)}>Cerrar</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
