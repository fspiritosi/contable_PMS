'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';

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

import { uploadMultiResourceDocument } from '../actions.server';
import type { MultiResourceDocumentTypeWithStatus } from '../actions.server';

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

interface Props {
  documentType: MultiResourceDocumentTypeWithStatus['documentType'];
  appliesTo: 'EMPLOYEE' | 'EQUIPMENT';
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

// ============================================
// COMPONENT
// ============================================

export function _MultiResourceUploadModal({
  documentType,
  appliesTo,
  open,
  onOpenChange,
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
    mutationFn: uploadMultiResourceDocument,
    onSuccess: (result) => {
      if (result.success) {
        // Invalidar queries según el tipo
        if (appliesTo === 'EMPLOYEE') {
          queryClient.invalidateQueries({
            queryKey: ['multiResourceEmployeeDocTypesWithStatus'],
          });
          queryClient.invalidateQueries({
            queryKey: ['multiResourceEmployeeDocsStats'],
          });
        } else {
          queryClient.invalidateQueries({
            queryKey: ['multiResourceEquipmentDocTypesWithStatus'],
          });
          queryClient.invalidateQueries({
            queryKey: ['multiResourceEquipmentDocsStats'],
          });
        }

        toast.success('Documento multirrecurso subido correctamente');
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
        appliesTo,
        documentTypeId: documentType.id,
        expirationDate: data.expirationDate
          ? new Date(data.expirationDate)
          : null,
        period: data.period || undefined,
        file: selectedFile,
        fileName: selectedFile.name,
        fileSize: selectedFile.size,
        mimeType: selectedFile.type,
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

  const entityLabel = appliesTo === 'EMPLOYEE' ? 'empleados' : 'equipos';

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Subir Documento Multirrecurso</DialogTitle>
          <DialogDescription>
            Este documento aplicará a todos los {entityLabel} de la empresa.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          {/* Tipo de documento (solo lectura) */}
          <div className="space-y-2">
            <Label>Tipo de documento</Label>
            <div className="flex items-center gap-2 rounded-md border bg-muted/50 px-3 py-2">
              <span className="font-medium">{documentType.name}</span>
              {documentType.isMandatory && (
                <span className="text-xs text-destructive">*Obligatorio</span>
              )}
            </div>
          </div>

          {/* Periodo (solo para documentos mensuales) */}
          {documentType.isMonthly && (
            <div className="space-y-2">
              <Label>Periodo *</Label>
              <Select
                value={watch('period')}
                onValueChange={(value) => setValue('period', value)}
              >
                <SelectTrigger data-testid="upload-period-select">
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
                data-testid="upload-expiration-date-input"
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
              data-testid="upload-dropzone"
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
              data-testid="upload-document-submit"
            >
              {uploadMutation.isPending ? 'Subiendo...' : 'Subir documento'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
