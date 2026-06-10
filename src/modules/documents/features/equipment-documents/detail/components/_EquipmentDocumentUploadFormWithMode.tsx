'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { RefreshCw, Replace } from 'lucide-react';

import { _FileDropzone } from '@/shared/components/common/_FileDropzone';
import { Button } from '@/shared/components/ui/button';
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

import { uploadEquipmentDocument } from '../../upload/actions.server';

// ============================================
// SCHEMA
// ============================================

const uploadSchema = z.object({
  expirationDate: z.string().optional(),
  period: z.string().optional(),
});

type UploadFormData = z.infer<typeof uploadSchema>;

// ============================================
// TIPOS
// ============================================

interface DocumentType {
  id: string;
  name: string;
  slug: string;
  hasExpiration: boolean;
  isMonthly: boolean;
  isMandatory: boolean;
  isConditional: boolean;
}

interface Props {
  equipmentId: string;
  documentType: DocumentType;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: 'renew' | 'replace';
  onSuccess?: () => void;
}

// ============================================
// COMPONENT
// ============================================

export function _EquipmentDocumentUploadFormWithMode({
  equipmentId,
  documentType,
  open,
  onOpenChange,
  mode,
  onSuccess,
}: Props) {
  const queryClient = useQueryClient();
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);

  const {
    handleSubmit,
    setValue,
    watch,
    reset,
  } = useForm<UploadFormData>({
    resolver: zodResolver(uploadSchema),
    defaultValues: {
      expirationDate: '',
      period: '',
    },
  });

  const uploadMutation = useMutation({
    mutationFn: uploadEquipmentDocument,
    onSuccess: (result) => {
      if (result.success) {
        queryClient.invalidateQueries({
          queryKey: ['equipmentDocuments', equipmentId],
        });
        queryClient.invalidateQueries({
          queryKey: ['equipmentDocumentsSummary', equipmentId],
        });

        const actionLabel = mode === 'renew' ? 'renovado' : 'reemplazado';
        toast.success(`Documento ${actionLabel} correctamente`);
        handleClose();
        onSuccess?.();
      } else {
        toast.error(result.error || 'Error al subir documento');
      }
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : 'Error al subir documento'
      );
    },
  });

  const handleClose = () => {
    reset();
    setSelectedFile(null);
    setFileError(null);
    onOpenChange(false);
  };

  const handleFileSelect = (file: File) => {
    setSelectedFile(file);
    setFileError(null);
  };

  const handleFileRemove = () => {
    setSelectedFile(null);
    setFileError(null);
  };

  const onSubmit = async (data: UploadFormData) => {
    // Validar que hay archivo
    if (!selectedFile) {
      setFileError('Debes seleccionar un archivo');
      return;
    }

    // Validar campos condicionales
    if (documentType.isMonthly && !data.period) {
      toast.error('Debes seleccionar un periodo');
      return;
    }

    if (documentType.hasExpiration && !data.expirationDate) {
      toast.error('Debes ingresar la fecha de vencimiento');
      return;
    }

    try {
      uploadMutation.mutate({
        vehicleId: equipmentId,
        documentTypeId: documentType.id,
        expirationDate: data.expirationDate
          ? new Date(data.expirationDate)
          : null,
        period: data.period || undefined,
        file: selectedFile,
        fileName: selectedFile.name,
        fileSize: selectedFile.size,
        mimeType: selectedFile.type,
        action: mode === 'renew' ? 'RENEWED' : 'REPLACED',
      });
    } catch {
      toast.error('Error al procesar el archivo');
    }
  };

  // Generate period options (last 12 months + next 3 months)
  const periodOptions = Array.from({ length: 15 }, (_, i) => {
    const date = new Date();
    date.setMonth(date.getMonth() - i + 3);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    return {
      value: `${year}-${month}`,
      label: date.toLocaleDateString('es-AR', {
        year: 'numeric',
        month: 'long',
      }),
    };
  }).reverse();

  const isRenew = mode === 'renew';
  const ModeIcon = isRenew ? RefreshCw : Replace;
  const modeColor = isRenew ? 'text-purple-600' : 'text-blue-600';
  const modeTitle = isRenew ? 'Renovar documento' : 'Reemplazar documento';
  const modeDescription = isRenew
    ? 'Sube una nueva versión. La versión anterior se guardará en el historial.'
    : 'Sube una nueva versión. La versión anterior será eliminada.';

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ModeIcon className={`h-5 w-5 ${modeColor}`} />
            {modeTitle}
          </DialogTitle>
          <DialogDescription>{modeDescription}</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          {/* Tipo de documento (solo lectura) */}
          <div className="space-y-2">
            <Label>Tipo de documento</Label>
            <Input value={documentType.name} disabled />
          </div>

          {/* Periodo (solo para documentos mensuales) */}
          {documentType.isMonthly && (
            <div className="space-y-2">
              <Label>Periodo *</Label>
              <Select
                value={watch('period')}
                onValueChange={(value) => setValue('period', value)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Seleccionar periodo..." />
                </SelectTrigger>
                <SelectContent>
                  {periodOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Fecha de vencimiento (solo para documentos que vencen) */}
          {documentType.hasExpiration && (
            <div className="space-y-2">
              <Label htmlFor="expirationDate">Fecha de vencimiento *</Label>
              <Input
                id="expirationDate"
                type="date"
                value={watch('expirationDate') || ''}
                onChange={(e) => setValue('expirationDate', e.target.value)}
              />
            </div>
          )}

          {/* File Dropzone */}
          <div className="space-y-2">
            <Label>Archivo *</Label>
            <_FileDropzone
              selectedFile={selectedFile}
              onFileSelect={handleFileSelect}
              onFileRemove={handleFileRemove}
              disabled={uploadMutation.isPending}
            />
            {fileError && (
              <p className="text-sm text-destructive">{fileError}</p>
            )}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={handleClose}
              disabled={uploadMutation.isPending}
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              disabled={uploadMutation.isPending || !selectedFile}
            >
              {uploadMutation.isPending ? 'Subiendo...' : isRenew ? 'Renovar' : 'Reemplazar'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
