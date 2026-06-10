'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
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

import { Filter } from 'lucide-react';

import { uploadEmployeeDocument } from '../actions.server';
import type { AvailableDocumentType } from '../../list/actions.server';

// ============================================
// SCHEMA
// ============================================

const uploadSchema = z.object({
  documentTypeId: z.string().min(1, 'Selecciona un tipo de documento'),
  expirationDate: z.string().optional(),
  period: z.string().optional(),
});

type UploadFormData = z.infer<typeof uploadSchema>;

// ============================================
// TIPOS
// ============================================

type UploadMode = 'new' | 'renew' | 'replace';

interface Props {
  employeeId: string;
  documentTypes: AvailableDocumentType[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode?: UploadMode;
  preselectedTypeId?: string | null;
  onSuccess?: () => void;
}

const modeConfig: Record<
  UploadMode,
  { title: string; description: string; action: 'UPLOADED' | 'RENEWED' | 'REPLACED' }
> = {
  new: {
    title: 'Subir Documento',
    description: 'Selecciona el tipo de documento y adjunta el archivo',
    action: 'UPLOADED',
  },
  renew: {
    title: 'Renovar Documento',
    description: 'El documento anterior se mantendrá en el historial',
    action: 'RENEWED',
  },
  replace: {
    title: 'Reemplazar Documento',
    description: 'El archivo anterior será eliminado',
    action: 'REPLACED',
  },
};

// ============================================
// COMPONENT
// ============================================

export function _DocumentUploadForm({
  employeeId,
  documentTypes,
  open,
  onOpenChange,
  mode = 'new',
  preselectedTypeId = null,
  onSuccess,
}: Props) {
  const queryClient = useQueryClient();
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);

  const config = modeConfig[mode];

  const {
    handleSubmit,
    setValue,
    watch,
    reset,
    formState: { errors },
  } = useForm<UploadFormData>({
    resolver: zodResolver(uploadSchema),
    defaultValues: {
      documentTypeId: '',
      expirationDate: '',
      period: '',
    },
  });

  // Set preselected type when mode is renew/replace
  useEffect(() => {
    if (open && preselectedTypeId) {
      setValue('documentTypeId', preselectedTypeId);
    }
  }, [open, preselectedTypeId, setValue]);

  const selectedTypeId = watch('documentTypeId');
  const selectedType = documentTypes.find((t) => t.id === selectedTypeId);

  const uploadMutation = useMutation({
    mutationFn: uploadEmployeeDocument,
    onSuccess: (result) => {
      if (result.success) {
        queryClient.invalidateQueries({
          queryKey: ['employeeDocuments', employeeId],
        });
        queryClient.invalidateQueries({
          queryKey: ['employeeDocumentsSummary', employeeId],
        });
        queryClient.invalidateQueries({
          queryKey: ['pendingDocumentTypes', employeeId],
        });
        queryClient.invalidateQueries({
          queryKey: ['availableDocumentTypes', employeeId],
        });
        queryClient.invalidateQueries({
          queryKey: ['documentDetail'],
        });

        const successMessage =
          mode === 'renew'
            ? 'Documento renovado correctamente'
            : mode === 'replace'
              ? 'Documento reemplazado correctamente'
              : 'Documento subido correctamente';
        toast.success(successMessage);
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
    if (selectedType?.isMonthly && !data.period) {
      toast.error('Debes seleccionar un periodo');
      return;
    }

    if (selectedType?.hasExpiration && !data.expirationDate) {
      toast.error('Debes ingresar la fecha de vencimiento');
      return;
    }

    try {
      uploadMutation.mutate({
        employeeId,
        documentTypeId: data.documentTypeId,
        expirationDate: data.expirationDate
          ? new Date(data.expirationDate)
          : null,
        period: data.period || undefined,
        file: selectedFile,
        fileName: selectedFile.name,
        fileSize: selectedFile.size,
        mimeType: selectedFile.type,
        action: config.action,
      });
    } catch {
      toast.error('Error al procesar el archivo');
    }
  };

  // Generate period options (last 12 months + next 3 months for documentos futuros)
  const periodOptions = Array.from({ length: 15 }, (_, i) => {
    const date = new Date();
    date.setMonth(date.getMonth() - i + 3); // +3 para incluir meses futuros
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    return {
      value: `${year}-${month}`,
      label: date.toLocaleDateString('es-AR', {
        year: 'numeric',
        month: 'long',
      }),
    };
  }).reverse(); // Orden cronológico

  const isTypeSelectionDisabled = mode !== 'new' && !!preselectedTypeId;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{config.title}</DialogTitle>
          <DialogDescription>{config.description}</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          {/* Tipo de documento */}
          <div className="space-y-2">
            <Label>Tipo de documento *</Label>
            <Select
              value={selectedTypeId}
              onValueChange={(value) => setValue('documentTypeId', value)}
              disabled={isTypeSelectionDisabled}
            >
              <SelectTrigger data-testid="upload-document-type-select">
                <SelectValue placeholder="Seleccionar tipo..." />
              </SelectTrigger>
              <SelectContent>
                {documentTypes.map((type) => (
                  <SelectItem key={type.id} value={type.id}>
                    <span className="flex items-center gap-1.5">
                      {type.isConditional && <Filter className="h-3 w-3 text-muted-foreground" />}
                      {type.name}
                      {type.isMandatory && ' *'}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errors.documentTypeId && (
              <p className="text-sm text-destructive">
                {errors.documentTypeId.message}
              </p>
            )}
          </div>

          {/* Periodo (solo para documentos mensuales) */}
          {selectedType?.isMonthly && (
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
          {selectedType?.hasExpiration && (
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
              disabled={uploadMutation.isPending || !selectedFile || !selectedTypeId}
              data-testid="upload-document-submit"
            >
              {uploadMutation.isPending
                ? mode === 'renew'
                  ? 'Renovando...'
                  : mode === 'replace'
                    ? 'Reemplazando...'
                    : 'Subiendo...'
                : mode === 'renew'
                  ? 'Renovar documento'
                  : mode === 'replace'
                    ? 'Reemplazar documento'
                    : 'Subir documento'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
