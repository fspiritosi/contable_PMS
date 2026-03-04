'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Download, Upload, FileSpreadsheet, Loader2 } from 'lucide-react';
import { Button } from '@/shared/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/shared/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog';
import { Label } from '@/shared/components/ui/label';
import { Input } from '@/shared/components/ui/input';
import { Alert, AlertDescription } from '@/shared/components/ui/alert';
import {
  downloadAccountsTemplate,
  exportAccountsToExcel,
  importAccountsFromExcel,
} from '../lib/import-export.server';
import { useRouter } from 'next/navigation';
import { usePermissions } from '@/shared/hooks/usePermissions';

interface ImportExportButtonsProps {
  companyId: string;
}

export function _ImportExportButtons({ companyId }: ImportExportButtonsProps) {
  const router = useRouter();
  const { hasPermission } = usePermissions();
  const [isExporting, setIsExporting] = useState(false);
  const [isDownloadingTemplate, setIsDownloadingTemplate] = useState(false);
  const [isImportDialogOpen, setIsImportDialogOpen] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [importResult, setImportResult] = useState<{
    success: boolean;
    imported: number;
    skipped?: number;
    errors: Array<{ row: number; errors: string[] }>;
    message: string;
  } | null>(null);

  const handleDownloadTemplate = async () => {
    setIsDownloadingTemplate(true);
    try {
      const result = await downloadAccountsTemplate();

      // Convertir array de números a buffer
      const buffer = new Uint8Array(result.buffer);
      const blob = new Blob([buffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });

      // Descargar archivo
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = result.filename;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      toast.success('Plantilla descargada correctamente');
    } catch (error) {
      console.error('Error al descargar plantilla:', error);
      toast.error('Error al descargar la plantilla');
    } finally {
      setIsDownloadingTemplate(false);
    }
  };

  const handleExport = async () => {
    setIsExporting(true);
    try {
      const result = await exportAccountsToExcel(companyId);

      // Convertir array de números a buffer
      const buffer = new Uint8Array(result.buffer);
      const blob = new Blob([buffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });

      // Descargar archivo
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = result.filename;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      toast.success('Plan de cuentas exportado correctamente');
    } catch (error) {
      console.error('Error al exportar:', error);
      toast.error('Error al exportar el plan de cuentas');
    } finally {
      setIsExporting(false);
    }
  };

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      // Validar que sea un archivo Excel
      if (
        !file.name.endsWith('.xlsx') &&
        !file.name.endsWith('.xls')
      ) {
        toast.error('Por favor selecciona un archivo Excel (.xlsx o .xls)');
        return;
      }
      setSelectedFile(file);
      setImportResult(null);
    }
  };

  const handleImport = async () => {
    if (!selectedFile) {
      toast.error('Por favor selecciona un archivo');
      return;
    }

    setIsImporting(true);
    setImportResult(null);

    try {
      // Leer archivo como ArrayBuffer
      const arrayBuffer = await selectedFile.arrayBuffer();
      const buffer = Array.from(new Uint8Array(arrayBuffer));

      // Importar
      const result = await importAccountsFromExcel(companyId, buffer);

      setImportResult(result);

      if (result.success) {
        toast.success(result.message);

        // Esperar un poco y cerrar el diálogo si no hay errores
        if (result.errors.length === 0) {
          setTimeout(() => {
            setIsImportDialogOpen(false);
            setSelectedFile(null);
            setImportResult(null);
            router.refresh();
          }, 2000);
        } else {
          // Si hay errores, refrescar al cerrar el diálogo
          router.refresh();
        }
      } else {
        toast.error(result.message);
      }
    } catch (error) {
      console.error('Error al importar:', error);
      toast.error('Error al importar el plan de cuentas');
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm">
            <FileSpreadsheet className="mr-2 h-4 w-4" />
            Importar/Exportar
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel>Importación/Exportación</DropdownMenuLabel>
          <DropdownMenuSeparator />

          <DropdownMenuItem
            onClick={handleDownloadTemplate}
            disabled={isDownloadingTemplate}
          >
            <Download className="mr-2 h-4 w-4" />
            {isDownloadingTemplate ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Descargando...
              </>
            ) : (
              'Descargar Plantilla Vacía'
            )}
          </DropdownMenuItem>

          <DropdownMenuItem
            onClick={handleExport}
            disabled={isExporting}
          >
            <Download className="mr-2 h-4 w-4" />
            {isExporting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Exportando...
              </>
            ) : (
              'Exportar Plan Actual'
            )}
          </DropdownMenuItem>

          <DropdownMenuSeparator />

          {hasPermission('accounting.accounts', 'create') && (
            <DropdownMenuItem onClick={() => setIsImportDialogOpen(true)}>
              <Upload className="mr-2 h-4 w-4" />
              Importar desde Excel
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Dialog de Importación */}
      <Dialog open={isImportDialogOpen} onOpenChange={setIsImportDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Importar Plan de Cuentas</DialogTitle>
            <DialogDescription>
              Selecciona un archivo Excel con el plan de cuentas. Descarga primero la plantilla
              vacía si no tienes un archivo preparado.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="file">Archivo Excel</Label>
              <Input
                id="file"
                type="file"
                accept=".xlsx,.xls"
                onChange={handleFileSelect}
                disabled={isImporting}
              />
              {selectedFile && (
                <p className="text-sm text-muted-foreground">
                  Archivo seleccionado: {selectedFile.name}
                </p>
              )}
            </div>

            {importResult && (
              <div className="space-y-3">
                <Alert variant={importResult.success ? 'default' : 'destructive'}>
                  <AlertDescription>
                    <strong>{importResult.message}</strong>
                    <div className="mt-2 text-sm">
                      <p>• Cuentas importadas: {importResult.imported}</p>
                      {importResult.skipped !== undefined && (
                        <p>• Cuentas omitidas (ya existían): {importResult.skipped}</p>
                      )}
                      {importResult.errors.length > 0 && (
                        <p>• Errores: {importResult.errors.length}</p>
                      )}
                    </div>
                  </AlertDescription>
                </Alert>

                {importResult.errors.length > 0 && (
                  <div className="space-y-2">
                    <Label>Errores encontrados:</Label>
                    <div className="max-h-40 overflow-y-auto rounded-md border p-3 text-sm">
                      {importResult.errors.map((error, index) => (
                        <div key={index} className="mb-2">
                          <strong>Fila {error.row}:</strong>
                          <ul className="ml-4 list-disc">
                            {error.errors.map((msg, i) => (
                              <li key={i}>{msg}</li>
                            ))}
                          </ul>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  setIsImportDialogOpen(false);
                  setSelectedFile(null);
                  setImportResult(null);
                }}
                disabled={isImporting}
              >
                Cancelar
              </Button>
              <Button
                onClick={handleImport}
                disabled={!selectedFile || isImporting}
              >
                {isImporting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Importar
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
