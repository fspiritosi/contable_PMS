'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Download, History, RefreshCw, Replace, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';

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
import { Button } from '@/shared/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/shared/components/ui/card';
import { Separator } from '@/shared/components/ui/separator';

import { usePermissions } from '@/shared/hooks/usePermissions';

import type { DocumentState } from '@/generated/prisma/enums';
import {
  deleteEmployeeDocument,
  revertToVersionVersion,
} from '../../upload/actions.server';
import { _DocumentUploadForm } from '../../upload/components/_DocumentUploadForm';
import { getDocumentDownloadUrl } from '../actions.server';

interface Props {
  documentId: string;
  employeeId: string;
  documentTypeId: string;
  documentTypeName: string;
  documentTypeHasExpiration: boolean;
  documentTypeIsMonthly: boolean;
  documentState: DocumentState;
  fileName: string | null;
  hasFile: boolean;
  hasPreviousVersions?: boolean;
}

export function _DocumentActions({
  documentId,
  employeeId,
  documentTypeId,
  documentTypeName,
  documentTypeHasExpiration,
  documentTypeIsMonthly,
  documentState,
  fileName,
  hasFile,
  hasPreviousVersions = false,
}: Props) {
  const router = useRouter();
  const queryClient = useQueryClient();

  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [uploadMode, setUploadMode] = useState<'renew' | 'replace'>('replace');
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [revertDialogOpen, setRevertDialogOpen] = useState(false);

  // Mutation para eliminar completamente
  const deleteMutation = useMutation({
    mutationFn: () => deleteEmployeeDocument(documentId, employeeId),
    onSuccess: (result) => {
      if (result.success) {
        queryClient.invalidateQueries({ queryKey: ['employeeDocuments', employeeId] });
        toast.success('Documento eliminado completamente');
        router.push(`/dashboard/employees/${employeeId}?tab=documents`);
      } else {
        toast.error(result.error || 'Error al eliminar documento');
      }
    },
    onError: () => {
      toast.error('Error al eliminar documento');
    },
  });

  // Mutation para revertir a versión anterior
  const revertMutation = useMutation({
    mutationFn: () => revertToVersionVersion(documentId, employeeId),
    onSuccess: (result) => {
      if (result.success) {
        queryClient.invalidateQueries({ queryKey: ['employeeDocuments', employeeId] });
        queryClient.invalidateQueries({ queryKey: ['documentDetail', documentId, employeeId] });
        toast.success('Versión actual eliminada. Se restauró la versión anterior.');
        router.refresh();
      } else {
        toast.error(result.error || 'Error al revertir versión');
      }
    },
    onError: () => {
      toast.error('Error al revertir versión');
    },
  });

  const handleDownload = async () => {
    try {
      const result = await getDocumentDownloadUrl(documentId, employeeId);
      if (result.success && result.url) {
        // Abrir en nueva pestaña (mejor para mobile)
        window.open(result.url, '_blank', 'noopener,noreferrer');
      } else {
        toast.error(result.error || 'Error al descargar documento');
      }
    } catch {
      toast.error('Error al descargar documento');
    }
  };

  const handleRenew = () => {
    setUploadMode('renew');
    setUploadDialogOpen(true);
  };

  const handleReplace = () => {
    setUploadMode('replace');
    setUploadDialogOpen(true);
  };

  const handleUploadSuccess = () => {
    setUploadDialogOpen(false);
    queryClient.invalidateQueries({ queryKey: ['documentDetail', documentId, employeeId] });
    router.refresh();
  };

  const canModify = documentState === 'APPROVED';
  const { hasPermission } = usePermissions();

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Acciones</CardTitle>
          <CardDescription>Gestiona este documento</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 px-4 sm:px-6">
          {/* Descargar */}
          {hasFile && (
            <Button variant="outline" className="w-full justify-start" onClick={handleDownload}>
              <Download className="mr-2 h-4 w-4" />
              Descargar documento
            </Button>
          )}

          {canModify && hasPermission('documents', 'update') && (
            <>
              <Separator />

              {/* Renovar */}
              <Button variant="outline" className="w-full justify-start h-auto py-2" onClick={handleRenew}>
                <RefreshCw className="mr-2 h-4 w-4 text-purple-600 flex-shrink-0" />
                <div className="flex flex-col items-start text-left min-w-0">
                  <span>Renovar documento</span>
                  <span className="text-xs font-normal text-muted-foreground line-clamp-1 sm:line-clamp-none">
                    Sube nueva versión, mantiene el anterior en historial
                  </span>
                </div>
              </Button>

              {/* Reemplazar */}
              <Button variant="outline" className="w-full justify-start h-auto py-2" onClick={handleReplace}>
                <Replace className="mr-2 h-4 w-4 text-blue-600 flex-shrink-0" />
                <div className="flex flex-col items-start text-left min-w-0">
                  <span>Reemplazar documento</span>
                  <span className="text-xs font-normal text-muted-foreground line-clamp-1 sm:line-clamp-none">
                    Sube nueva versión, elimina el archivo anterior
                  </span>
                </div>
              </Button>
            </>
          )}

          <Separator />

          {/* Revertir a versión anterior (solo si hay versiones previas) */}
          {hasPreviousVersions && hasPermission('documents', 'delete') && (
            <Button
              variant="outline"
              className="w-full justify-start h-auto py-2 text-orange-600 hover:text-orange-600"
              onClick={() => setRevertDialogOpen(true)}
            >
              <History className="mr-2 h-4 w-4 flex-shrink-0" />
              <div className="flex flex-col items-start text-left min-w-0">
                <span>Eliminar versión actual</span>
                <span className="text-xs font-normal text-muted-foreground line-clamp-1 sm:line-clamp-none">
                  Restaura la versión anterior del historial
                </span>
              </div>
            </Button>
          )}

          {/* Eliminar completamente */}
          {hasPermission('documents', 'delete') && (
            <Button
              variant="outline"
              className="w-full justify-start h-auto py-2 text-destructive hover:text-destructive"
              onClick={() => setDeleteDialogOpen(true)}
            >
              <Trash2 className="mr-2 h-4 w-4 flex-shrink-0" />
              <div className="flex flex-col items-start text-left min-w-0">
                <span>Eliminar documento</span>
                <span className="text-xs font-normal text-muted-foreground line-clamp-1 sm:line-clamp-none">
                  Elimina el documento y todo su historial
                </span>
              </div>
            </Button>
          )}
        </CardContent>
      </Card>

      {/* Upload Dialog */}
      <_DocumentUploadForm
        employeeId={employeeId}
        documentTypes={[
          {
            id: documentTypeId,
            name: documentTypeName,
            slug: '',
            hasExpiration: documentTypeHasExpiration,
            isMonthly: documentTypeIsMonthly,
            isMandatory: false,
            isConditional: false,
          },
        ]}
        open={uploadDialogOpen}
        onOpenChange={setUploadDialogOpen}
        mode={uploadMode}
        preselectedTypeId={documentTypeId}
        onSuccess={handleUploadSuccess}
      />

      {/* Revert Confirmation Dialog */}
      <AlertDialog open={revertDialogOpen} onOpenChange={setRevertDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Eliminar versión actual</AlertDialogTitle>
            <AlertDialogDescription>
              ¿Estás seguro de que deseas eliminar la versión actual del documento?
              Se restaurará la versión anterior del historial.
              <br />
              <br />
              <strong>Nota:</strong> Si no hay versión anterior disponible, el documento
              se eliminará completamente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => revertMutation.mutate()}
              className="bg-orange-600 text-white hover:bg-orange-700"
            >
              {revertMutation.isPending ? 'Procesando...' : 'Eliminar versión actual'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Eliminar documento completamente</AlertDialogTitle>
            <AlertDialogDescription>
              ¿Estás seguro de que deseas eliminar este documento?
              <br />
              <br />
              Esta acción <strong>no se puede deshacer</strong> y eliminará:
              <ul className="list-disc list-inside mt-2 space-y-1">
                <li>El archivo actual</li>
                <li>Todas las versiones anteriores del historial</li>
                <li>Todo el registro del documento</li>
              </ul>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteMutation.mutate()}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteMutation.isPending ? 'Eliminando...' : 'Eliminar todo'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
