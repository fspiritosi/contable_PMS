'use client';

import { Download, Loader2 } from 'lucide-react';

import { Button } from '@/shared/components/ui/button';
import { Input } from '@/shared/components/ui/input';
import { Label } from '@/shared/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui/select';
import { Switch } from '@/shared/components/ui/switch';

import { NO_COST_CENTER_LABEL } from '../../../shared/utils/cost-center-movements';
import type { CostCenterOption } from '../actions.server';

interface CostCenterMovementsFiltersProps {
  costCenters: CostCenterOption[];
  isLoadingCenters: boolean;
  costCenterId: string;
  onCostCenterChange: (value: string) => void;
  fromDate: string;
  onFromDateChange: (value: string) => void;
  toDate: string;
  onToDateChange: (value: string) => void;
  includeDrafts: boolean;
  onIncludeDraftsChange: (value: boolean) => void;
  isLoading: boolean;
  onSubmit: (e: React.FormEvent) => void;
  onExport: () => void;
  canExport: boolean;
}

/**
 * Filtros del informe: centro (uno, todos o las líneas sin centro), período y
 * el switch de borradores. Los centros inactivos con historia se marcan.
 */
export function _CostCenterMovementsFilters({
  costCenters,
  isLoadingCenters,
  costCenterId,
  onCostCenterChange,
  fromDate,
  onFromDateChange,
  toDate,
  onToDateChange,
  includeDrafts,
  onIncludeDraftsChange,
  isLoading,
  onSubmit,
  onExport,
  canExport,
}: CostCenterMovementsFiltersProps) {
  return (
    <form
      onSubmit={onSubmit}
      className="mb-6 flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-end"
    >
      <div className="grid gap-2">
        <Label htmlFor="costCenter">Centro de costo</Label>
        <Select value={costCenterId} onValueChange={onCostCenterChange} disabled={isLoading}>
          <SelectTrigger id="costCenter" className="w-full sm:w-[260px]">
            <SelectValue placeholder={isLoadingCenters ? 'Cargando...' : 'Centro de costo'} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos los centros</SelectItem>
            <SelectItem value="none">{NO_COST_CENTER_LABEL}</SelectItem>
            {costCenters.map((center) => (
              <SelectItem key={center.id} value={center.id}>
                {center.isActive ? center.name : `${center.name} (inactivo)`}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid gap-2">
        <Label htmlFor="fromDate">Desde</Label>
        <Input
          id="fromDate"
          type="date"
          value={fromDate}
          onChange={(e) => onFromDateChange(e.target.value)}
          disabled={isLoading}
        />
      </div>

      <div className="grid gap-2">
        <Label htmlFor="toDate">Hasta</Label>
        <Input
          id="toDate"
          type="date"
          value={toDate}
          onChange={(e) => onToDateChange(e.target.value)}
          disabled={isLoading}
        />
      </div>

      <div className="flex items-center gap-2 pb-2">
        <Switch
          id="includeDrafts"
          checked={includeDrafts}
          onCheckedChange={onIncludeDraftsChange}
          disabled={isLoading}
          data-testid="cost-center-movements-include-drafts"
        />
        <Label htmlFor="includeDrafts">Incluir borradores</Label>
      </div>

      <div className="flex items-center gap-2">
        <Button type="submit" disabled={isLoading}>
          {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Generar
        </Button>
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={onExport}
          disabled={isLoading || !canExport}
          title="Exportar a Excel"
        >
          <Download className="h-4 w-4" />
        </Button>
      </div>
    </form>
  );
}
