'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Upload } from 'lucide-react';
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
  DialogTrigger,
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

import { uploadEmployeeDocument } from '../../employee-documents/upload/actions.server';
import { uploadEquipmentDocument } from '../../equipment-documents/upload/actions.server';
import { uploadCompanyDocument } from '../../company-documents/upload/actions.server';
import {
  getDocumentTypesForUpload,
  searchEmployeesForUpload,
  searchEquipmentForUpload,
  type DocumentTypeForUpload,
} from '../actions.server';
import { _DocumentTypeSelector } from './_DocumentTypeSelector';
import {
  _EntitySearchCombobox,
  type SelectedEntity,
} from './_EntitySearchCombobox';
import { _EntityTypeSelector, type EntityType } from './_EntityTypeSelector';
import type { DocumentsTab } from '../DocumentsOverview';

// ============================================
// SCHEMA
// ============================================

const uploadSchema = z.object({
  expirationDate: z.string().optional(),
  period: z.string().optional(),
});

type UploadFormData = z.infer<typeof uploadSchema>;

// ============================================
// PROPS
// ============================================

interface Props {
  currentTab?: DocumentsTab;
  companyId: string;
}

// ============================================
// COMPONENT
// ============================================

export function _UniversalUploadModal({ currentTab, companyId }: Props) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);

  // Determinar tipo de entidad inicial según la tab actual
  const getInitialEntityType = (): EntityType => {
    switch (currentTab) {
      case 'employees':
        return 'EMPLOYEE';
      case 'equipment':
        return 'EQUIPMENT';
      case 'company':
        return 'COMPANY';
      default:
        return 'EMPLOYEE';
    }
  };

  // State
  const [entityType, setEntityType] = useState<EntityType>(getInitialEntityType());
  const [selectedEntity, setSelectedEntity] = useState<SelectedEntity | null>(null);
  const [selectedDocTypeId, setSelectedDocTypeId] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);

  // Form
  const { handleSubmit, setValue, watch, reset } = useForm<UploadFormData>({
    resolver: zodResolver(uploadSchema),
    defaultValues: {
      expirationDate: '',
      period: '',
    },
  });

  // Query para tipos de documento
  const { data: documentTypes = [], isLoading: isLoadingDocTypes } = useQuery({
    queryKey: ['documentTypesForUpload', entityType, selectedEntity?.id],
    queryFn: () =>
      selectedEntity
        ? getDocumentTypesForUpload(entityType, selectedEntity.id)
        : Promise.resolve([]),
    enabled: !!selectedEntity,
  });

  // Obtener el tipo de documento seleccionado
  const selectedDocType = documentTypes.find((dt) => dt.id === selectedDocTypeId);

  // Reset selections when entity type changes
  useEffect(() => {
    setSelectedEntity(null);
    setSelectedDocTypeId(null);
    setSelectedFile(null);
    reset();
  }, [entityType, reset]);

  // Reset doc type when entity changes
  useEffect(() => {
    setSelectedDocTypeId(null);
    setSelectedFile(null);
    reset();
  }, [selectedEntity, reset]);

  // Auto-select company
  useEffect(() => {
    if (entityType === 'COMPANY' && !selectedEntity) {
      setSelectedEntity({ type: 'COMPANY', id: companyId });
    }
  }, [entityType, companyId, selectedEntity]);

  // Mutations
  const uploadEmployeeMutation = useMutation({
    mutationFn: uploadEmployeeDocument,
    onSuccess: handleUploadSuccess,
    onError: handleUploadError,
  });

  const uploadEquipmentMutation = useMutation({
    mutationFn: uploadEquipmentDocument,
    onSuccess: handleUploadSuccess,
    onError: handleUploadError,
  });

  const uploadCompanyMutation = useMutation({
    mutationFn: uploadCompanyDocument,
    onSuccess: handleUploadSuccess,
    onError: handleUploadError,
  });

  function handleUploadSuccess(result: { success: boolean; error?: string }) {
    if (result.success) {
      toast.success('Documento subido correctamente');
      queryClient.invalidateQueries({ queryKey: ['employeeDocuments'] });
      queryClient.invalidateQueries({ queryKey: ['equipmentDocuments'] });
      queryClient.invalidateQueries({ queryKey: ['companyDocuments'] });
      handleClose();
    } else {
      toast.error(result.error || 'Error al subir documento');
    }
  }

  function handleUploadError(error: Error) {
    toast.error(error.message || 'Error al subir documento');
  }

  const handleClose = () => {
    setOpen(false);
    setEntityType(getInitialEntityType());
    setSelectedEntity(null);
    setSelectedDocTypeId(null);
    setSelectedFile(null);
    setFileError(null);
    reset();
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
    if (!selectedEntity) {
      toast.error('Debes seleccionar una entidad');
      return;
    }

    if (!selectedDocTypeId || !selectedDocType) {
      toast.error('Debes seleccionar un tipo de documento');
      return;
    }

    if (!selectedFile) {
      setFileError('Debes seleccionar un archivo');
      return;
    }

    // Validar campos condicionales
    if (selectedDocType.isMonthly && !data.period) {
      toast.error('Debes seleccionar un periodo');
      return;
    }

    if (selectedDocType.hasExpiration && !data.expirationDate) {
      toast.error('Debes ingresar la fecha de vencimiento');
      return;
    }

    try {
      // El archivo se envía como File (binario/multipart). NO convertir a number[]:
      // serializar el binario como array JSON lo infla ~3-4x y supera el límite de body.
      const baseData = {
        documentTypeId: selectedDocTypeId,
        expirationDate: data.expirationDate ? new Date(data.expirationDate) : null,
        period: data.period || undefined,
        file: selectedFile,
        fileName: selectedFile.name,
        fileSize: selectedFile.size,
        mimeType: selectedFile.type,
      };

      if (entityType === 'EMPLOYEE' && selectedEntity.type === 'EMPLOYEE') {
        uploadEmployeeMutation.mutate({
          ...baseData,
          employeeId: selectedEntity.id,
        });
      } else if (entityType === 'EQUIPMENT' && selectedEntity.type === 'EQUIPMENT') {
        uploadEquipmentMutation.mutate({
          ...baseData,
          vehicleId: selectedEntity.id,
        });
      } else if (entityType === 'COMPANY') {
        uploadCompanyMutation.mutate(baseData);
      }
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

  const isUploading =
    uploadEmployeeMutation.isPending ||
    uploadEquipmentMutation.isPending ||
    uploadCompanyMutation.isPending;

  const canSubmit =
    selectedEntity &&
    selectedDocTypeId &&
    selectedFile &&
    (!selectedDocType?.isMonthly || watch('period')) &&
    (!selectedDocType?.hasExpiration || watch('expirationDate'));

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Upload className="mr-2 h-4 w-4" />
          Subir Documento
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Subir Documento</DialogTitle>
          <DialogDescription>
            Selecciona el tipo de entidad, la entidad específica y el tipo de documento.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
          {/* Paso 1: Tipo de entidad */}
          <_EntityTypeSelector
            value={entityType}
            onValueChange={setEntityType}
            disabled={isUploading}
          />

          {/* Paso 2: Buscar entidad (excepto Company) */}
          <_EntitySearchCombobox
            entityType={entityType}
            value={selectedEntity}
            onValueChange={setSelectedEntity}
            searchEmployees={searchEmployeesForUpload}
            searchEquipment={searchEquipmentForUpload}
            companyId={companyId}
            disabled={isUploading}
          />

          {/* Paso 3: Seleccionar tipo de documento */}
          <_DocumentTypeSelector
            documentTypes={documentTypes}
            selectedId={selectedDocTypeId}
            onSelect={setSelectedDocTypeId}
            disabled={isUploading || !selectedEntity}
            isLoading={isLoadingDocTypes}
          />

          {/* Campos condicionales según tipo de documento */}
          {selectedDocType && (
            <>
              {/* Periodo (solo para documentos mensuales) */}
              {selectedDocType.isMonthly && (
                <div className="space-y-2">
                  <Label>Periodo *</Label>
                  <Select
                    value={watch('period')}
                    onValueChange={(value) => setValue('period', value)}
                    disabled={isUploading}
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
              {selectedDocType.hasExpiration && (
                <div className="space-y-2">
                  <Label htmlFor="expirationDate">Fecha de vencimiento *</Label>
                  <Input
                    id="expirationDate"
                    type="date"
                    value={watch('expirationDate') || ''}
                    onChange={(e) => setValue('expirationDate', e.target.value)}
                    disabled={isUploading}
                  />
                </div>
              )}
            </>
          )}

          {/* Paso 4: Subir archivo */}
          {selectedDocTypeId && (
            <div className="space-y-2">
              <Label>Archivo *</Label>
              <_FileDropzone
                selectedFile={selectedFile}
                onFileSelect={handleFileSelect}
                onFileRemove={handleFileRemove}
                disabled={isUploading}
              />
              {fileError && (
                <p className="text-sm text-destructive">{fileError}</p>
              )}
            </div>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={handleClose}
              disabled={isUploading}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={!canSubmit || isUploading}>
              {isUploading ? 'Subiendo...' : 'Subir Documento'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
