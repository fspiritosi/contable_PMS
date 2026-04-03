'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Pencil } from 'lucide-react';

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
import { Label } from '@/shared/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui/select';
import { Textarea } from '@/shared/components/ui/textarea';
import {
  PRODUCT_STATUS_LABELS,
  UNIT_OF_MEASURE_OPTIONS,
} from '../../../shared/types';
import { bulkUpdateProducts } from '../actions.server';
import { getCategories } from '../../../features/categories/actions.server';

interface Props {
  selectedIds: string[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

export function _BulkEditModal({ selectedIds, open, onOpenChange, onSuccess }: Props) {
  const queryClient = useQueryClient();

  // Field enable toggles
  const [enableCategory, setEnableCategory] = useState(false);
  const [enableStatus, setEnableStatus] = useState(false);
  const [enableUnit, setEnableUnit] = useState(false);
  const [enableDescription, setEnableDescription] = useState(false);

  // Field values
  const [categoryId, setCategoryId] = useState<string>('');
  const [status, setStatus] = useState<string>('');
  const [unitOfMeasure, setUnitOfMeasure] = useState<string>('');
  const [description, setDescription] = useState<string>('');

  const { data: categories } = useQuery({
    queryKey: ['product-categories-select'],
    queryFn: getCategories,
    enabled: open,
  });

  const mutation = useMutation({
    mutationFn: () => {
      const updates: Record<string, string | null | undefined> = {};
      if (enableCategory) updates.categoryId = categoryId === '__none__' ? null : (categoryId || null);
      if (enableStatus) updates.status = status;
      if (enableUnit) updates.unitOfMeasure = unitOfMeasure;
      if (enableDescription) updates.description = description;

      return bulkUpdateProducts({ productIds: selectedIds, updates });
    },
    onSuccess: (result) => {
      toast.success(`${result.count} producto${result.count !== 1 ? 's' : ''} actualizado${result.count !== 1 ? 's' : ''}`);
      queryClient.invalidateQueries({ queryKey: ['products'] });
      handleReset();
      onOpenChange(false);
      onSuccess();
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : 'Error al actualizar productos';
      toast.error(message);
    },
  });

  const handleReset = () => {
    setEnableCategory(false);
    setEnableStatus(false);
    setEnableUnit(false);
    setEnableDescription(false);
    setCategoryId('');
    setStatus('');
    setUnitOfMeasure('');
    setDescription('');
  };

  const handleSubmit = () => {
    if (!enableCategory && !enableStatus && !enableUnit && !enableDescription) {
      toast.error('Seleccione al menos un campo para modificar');
      return;
    }
    if (enableStatus && !status) {
      toast.error('Seleccione un estado');
      return;
    }
    if (enableUnit && !unitOfMeasure) {
      toast.error('Seleccione una unidad de medida');
      return;
    }
    mutation.mutate();
  };

  const hasChanges = enableCategory || enableStatus || enableUnit || enableDescription;

  return (
    <Dialog open={open} onOpenChange={(val) => { if (!val) handleReset(); onOpenChange(val); }}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Pencil className="h-5 w-5" />
            Edición Masiva
          </DialogTitle>
          <DialogDescription>
            {selectedIds.length} producto{selectedIds.length !== 1 ? 's' : ''} seleccionado{selectedIds.length !== 1 ? 's' : ''}.
            Active los campos que desea modificar.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Category */}
          <div className="flex items-start gap-3">
            <Checkbox
              id="enable-category"
              checked={enableCategory}
              onCheckedChange={(checked) => setEnableCategory(checked === true)}
              className="mt-2"
            />
            <div className="flex-1 space-y-1.5">
              <Label htmlFor="enable-category" className={!enableCategory ? 'text-muted-foreground' : ''}>
                Cambiar categoría a:
              </Label>
              <Select
                disabled={!enableCategory}
                value={categoryId}
                onValueChange={setCategoryId}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Seleccionar categoría" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Sin categoría</SelectItem>
                  {categories?.map((cat) => (
                    <SelectItem key={cat.id} value={cat.id}>
                      {cat.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Status */}
          <div className="flex items-start gap-3">
            <Checkbox
              id="enable-status"
              checked={enableStatus}
              onCheckedChange={(checked) => setEnableStatus(checked === true)}
              className="mt-2"
            />
            <div className="flex-1 space-y-1.5">
              <Label htmlFor="enable-status" className={!enableStatus ? 'text-muted-foreground' : ''}>
                Cambiar estado a:
              </Label>
              <Select
                disabled={!enableStatus}
                value={status}
                onValueChange={setStatus}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Seleccionar estado" />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(PRODUCT_STATUS_LABELS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Unit of Measure */}
          <div className="flex items-start gap-3">
            <Checkbox
              id="enable-unit"
              checked={enableUnit}
              onCheckedChange={(checked) => setEnableUnit(checked === true)}
              className="mt-2"
            />
            <div className="flex-1 space-y-1.5">
              <Label htmlFor="enable-unit" className={!enableUnit ? 'text-muted-foreground' : ''}>
                Cambiar unidad de medida a:
              </Label>
              <Select
                disabled={!enableUnit}
                value={unitOfMeasure}
                onValueChange={setUnitOfMeasure}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Seleccionar unidad" />
                </SelectTrigger>
                <SelectContent>
                  {UNIT_OF_MEASURE_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Description */}
          <div className="flex items-start gap-3">
            <Checkbox
              id="enable-description"
              checked={enableDescription}
              onCheckedChange={(checked) => setEnableDescription(checked === true)}
              className="mt-2"
            />
            <div className="flex-1 space-y-1.5">
              <Label htmlFor="enable-description" className={!enableDescription ? 'text-muted-foreground' : ''}>
                Reemplazar descripción por:
              </Label>
              <Textarea
                disabled={!enableDescription}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Nueva descripción (dejar vacío para limpiar)"
                rows={3}
              />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => { handleReset(); onOpenChange(false); }}
          >
            Cancelar
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={mutation.isPending || !hasChanges}
          >
            {mutation.isPending ? 'Aplicando...' : 'Aplicar Cambios'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
