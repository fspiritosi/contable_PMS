'use client';

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Upload, FileSpreadsheet, AlertCircle, CheckCircle2, SkipForward, UserPlus } from 'lucide-react';
import { Button } from '@/shared/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/shared/components/ui/dialog';
import { Alert, AlertDescription } from '@/shared/components/ui/alert';
import { importPurchaseInvoicesFromAFIP, type AFIPImportResult } from '../lib/afip-import.server';

export function _ImportAFIPDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [result, setResult] = useState<AFIPImportResult | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const resetState = useCallback(() => {
    setFile(null);
    setResult(null);
    setIsImporting(false);
  }, []);

  const handleOpenChange = useCallback(
    (newOpen: boolean) => {
      setOpen(newOpen);
      if (!newOpen) resetState();
    },
    [resetState]
  );

  const handleFileChange = useCallback((selectedFile: File | null) => {
    if (!selectedFile) return;
    if (
      !selectedFile.name.endsWith('.xlsx') &&
      !selectedFile.name.endsWith('.xls')
    ) {
      toast.error('Solo se aceptan archivos Excel (.xlsx, .xls)');
      return;
    }
    setFile(selectedFile);
    setResult(null);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const droppedFile = e.dataTransfer.files[0];
      handleFileChange(droppedFile);
    },
    [handleFileChange]
  );

  const handleImport = useCallback(async () => {
    if (!file) return;

    setIsImporting(true);
    try {
      const arrayBuffer = await file.arrayBuffer();
      const buffer = Array.from(new Uint8Array(arrayBuffer));
      const importResult = await importPurchaseInvoicesFromAFIP(buffer);
      setResult(importResult);

      if (importResult.imported > 0) {
        toast.success(importResult.message);
        router.refresh();
      } else if (importResult.errors.length > 0) {
        toast.error('La importación falló con errores');
      } else {
        toast.info('No se importaron comprobantes nuevos');
      }
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Error al importar'
      );
    } finally {
      setIsImporting(false);
    }
  }, [file, router]);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Upload className="mr-2 h-4 w-4" />
          Importar AFIP
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5" />
            Importar Comprobantes desde AFIP
          </DialogTitle>
          <DialogDescription>
            Subí el archivo Excel descargado de &quot;Mis Comprobantes Recibidos&quot; en AFIP.
            Los comprobantes se crearán en estado <strong>Borrador</strong>.
            Si un proveedor no existe, se creará automáticamente.
          </DialogDescription>
        </DialogHeader>

        {!result ? (
          <div className="space-y-4">
            <div
              className={`flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-8 transition-colors ${
                dragOver
                  ? 'border-primary bg-primary/5'
                  : 'border-muted-foreground/25'
              }`}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
            >
              {file ? (
                <div className="flex items-center gap-3">
                  <FileSpreadsheet className="h-8 w-8 text-green-600" />
                  <div>
                    <p className="font-medium">{file.name}</p>
                    <p className="text-sm text-muted-foreground">
                      {(file.size / 1024).toFixed(1)} KB
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setFile(null);
                      setResult(null);
                    }}
                  >
                    Cambiar
                  </Button>
                </div>
              ) : (
                <>
                  <Upload className="mb-2 h-8 w-8 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">
                    Arrastrá el archivo aquí o
                  </p>
                  <label className="mt-2 cursor-pointer">
                    <span className="text-sm font-medium text-primary underline">
                      seleccioná un archivo
                    </span>
                    <input
                      type="file"
                      className="hidden"
                      accept=".xlsx,.xls"
                      onChange={(e) => handleFileChange(e.target.files?.[0] || null)}
                    />
                  </label>
                </>
              )}
            </div>

            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                <strong>Formato esperado:</strong> archivo Excel descargado de AFIP → Mis Comprobantes → Comprobantes Recibidos.
                Los comprobantes duplicados (mismo proveedor + número) serán omitidos automáticamente.
              </AlertDescription>
            </Alert>
          </div>
        ) : (
          <div className="space-y-3">
            {result.imported > 0 && (
              <div className="flex items-center gap-2 rounded-lg bg-green-50 p-3 text-green-800 dark:bg-green-950 dark:text-green-200">
                <CheckCircle2 className="h-5 w-5 flex-shrink-0" />
                <span className="text-sm font-medium">
                  {result.imported} comprobantes importados
                </span>
              </div>
            )}
            {result.suppliersCreated > 0 && (
              <div className="flex items-center gap-2 rounded-lg bg-blue-50 p-3 text-blue-800 dark:bg-blue-950 dark:text-blue-200">
                <UserPlus className="h-5 w-5 flex-shrink-0" />
                <span className="text-sm font-medium">
                  {result.suppliersCreated} proveedores nuevos creados
                </span>
              </div>
            )}
            {result.skipped > 0 && (
              <div className="flex items-center gap-2 rounded-lg bg-yellow-50 p-3 text-yellow-800 dark:bg-yellow-950 dark:text-yellow-200">
                <SkipForward className="h-5 w-5 flex-shrink-0" />
                <span className="text-sm font-medium">
                  {result.skipped} comprobantes omitidos (duplicados)
                </span>
              </div>
            )}
            {result.warnings.length > 0 && (
              <div className="space-y-1">
                <p className="text-sm font-medium text-amber-700 dark:text-amber-300">
                  {result.warnings.length} comprobantes con una letra que no corresponde a la condición IVA del
                  proveedor (se importaron igual):
                </p>
                <div className="max-h-40 overflow-auto rounded-lg bg-amber-50 p-3 dark:bg-amber-950">
                  {result.warnings.slice(0, 20).map((warning, i) => (
                    <p key={i} className="text-sm text-amber-800 dark:text-amber-200">
                      Fila {warning.row}: {warning.warning}
                    </p>
                  ))}
                  {result.warnings.length > 20 && (
                    <p className="text-sm text-amber-800 dark:text-amber-200">
                      ...y {result.warnings.length - 20} más
                    </p>
                  )}
                </div>
              </div>
            )}
            {result.errors.length > 0 && (
              <div className="space-y-1">
                <p className="text-sm font-medium text-destructive">
                  {result.errors.length} errores:
                </p>
                <div className="max-h-40 overflow-auto rounded-lg bg-destructive/10 p-3">
                  {result.errors.slice(0, 20).map((err, i) => (
                    <p key={i} className="text-sm text-destructive">
                      {err.row > 0 ? `Fila ${err.row}: ` : ''}{err.error}
                    </p>
                  ))}
                  {result.errors.length > 20 && (
                    <p className="text-sm text-destructive">
                      ...y {result.errors.length - 20} errores más
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          {result ? (
            <Button onClick={() => handleOpenChange(false)}>Cerrar</Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => handleOpenChange(false)}>
                Cancelar
              </Button>
              <Button
                onClick={handleImport}
                disabled={!file || isImporting}
              >
                {isImporting ? 'Importando...' : 'Importar'}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
