'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ImageIcon, Loader2, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/shared/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/shared/components/ui/card';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/shared/components/ui/alert-dialog';
import { _FileDropzone } from '@/shared/components/common/_FileDropzone';
import { uploadCompanyLogo, deleteCompanyLogo } from '../actions.server';

interface Props {
  companyId: string;
  logoUrl: string | null;
  canEdit: boolean;
}

const ALLOWED_TYPES = ['image/png', 'image/jpeg'];
const MAX_SIZE_BYTES = 10 * 1024 * 1024; // 10MB
const MAX_SIZE_LABEL = '10MB';

export function _CompanyLogoUpload({ logoUrl, canEdit }: Props) {
  const router = useRouter();
  const [isUploading, setIsUploading] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const handleFileSelect = async (file: File) => {
    setIsUploading(true);
    try {
      const arrayBuffer = await file.arrayBuffer();
      const fileArray = Array.from(new Uint8Array(arrayBuffer));

      await uploadCompanyLogo({
        file: fileArray,
        fileName: file.name,
        mimeType: file.type,
      });

      toast.success('Logo actualizado correctamente');
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Error al subir el logo');
    } finally {
      setIsUploading(false);
    }
  };

  const handleDelete = async () => {
    setIsDeleting(true);
    try {
      await deleteCompanyLogo();
      toast.success('Logo eliminado');
      setShowDeleteConfirm(false);
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Error al eliminar el logo');
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <>
      <Card data-testid="company-logo-card">
        <CardHeader>
          <CardTitle className="text-base">Logo de la Empresa</CardTitle>
          <CardDescription>
            Se mostrará en los comprobantes emitidos (Órdenes de Pago, Recibos, Facturas, etc.)
          </CardDescription>
        </CardHeader>
        <CardContent>
          {logoUrl ? (
            <div className="space-y-4">
              <div className="flex items-center gap-4 rounded-md border bg-muted/20 p-4">
                <div className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-md border bg-background">
                  <img
                    src={logoUrl}
                    alt="Logo"
                    className="h-full w-full object-contain"
                    data-testid="company-logo-preview"
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium flex items-center gap-2">
                    <ImageIcon className="h-4 w-4 text-primary" />
                    Logo configurado
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Aparece en el header de todos los comprobantes
                  </p>
                </div>
                {canEdit && (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setShowDeleteConfirm(true)}
                    title="Eliminar logo"
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                )}
              </div>
              {canEdit && (
                <div className="relative">
                  {isUploading && (
                    <div className="absolute inset-0 flex items-center justify-center bg-background/80 z-10 rounded-lg">
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Subiendo...
                      </div>
                    </div>
                  )}
                  <_FileDropzone
                    onFileSelect={handleFileSelect}
                    allowedTypes={ALLOWED_TYPES}
                    maxSize={MAX_SIZE_BYTES}
                    helpText={`PNG o JPG (max. ${MAX_SIZE_LABEL})`}
                    disabled={isUploading}
                  />
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              {!canEdit ? (
                <div className="flex flex-col items-center justify-center gap-2 py-8 text-muted-foreground">
                  <ImageIcon className="h-10 w-10 opacity-40" />
                  <p className="text-sm">No hay logo configurado</p>
                </div>
              ) : (
                <div className="relative">
                  {isUploading && (
                    <div className="absolute inset-0 flex items-center justify-center bg-background/80 z-10 rounded-lg">
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Subiendo...
                      </div>
                    </div>
                  )}
                  <_FileDropzone
                    onFileSelect={handleFileSelect}
                    allowedTypes={ALLOWED_TYPES}
                    maxSize={MAX_SIZE_BYTES}
                    helpText={`PNG o JPG (max. ${MAX_SIZE_LABEL})`}
                    disabled={isUploading}
                  />
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Eliminar logo</AlertDialogTitle>
            <AlertDialogDescription>
              ¿Está seguro que desea eliminar el logo de la empresa? Dejará de aparecer en
              los comprobantes emitidos.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}