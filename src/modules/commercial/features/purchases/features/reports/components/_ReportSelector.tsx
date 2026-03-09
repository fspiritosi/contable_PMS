'use client';

import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui/select';
import { Button } from '@/shared/components/ui/button';
import { Input } from '@/shared/components/ui/input';
import { FileText } from 'lucide-react';
import moment from 'moment';

type ReportType = 'period' | 'supplier' | 'product' | 'vat';

const REPORT_TYPES = {
  period: 'Compras por Período',
  supplier: 'Compras por Proveedor',
  product: 'Compras por Producto',
  vat: 'Libro IVA Compras',
};

interface SupplierOption {
  id: string;
  businessName: string;
  tradeName: string | null;
}

interface Props {
  onGenerate: (type: ReportType, startDate: Date, endDate: Date, supplierId?: string) => void;
  loading: boolean;
  suppliers?: SupplierOption[];
}

export function _ReportSelector({ onGenerate, loading, suppliers = [] }: Props) {
  const [reportType, setReportType] = useState<ReportType>('period');
  const [startDate, setStartDate] = useState<Date>(
    moment().startOf('month').toDate()
  );
  const [endDate, setEndDate] = useState<Date>(moment().endOf('month').toDate());
  const [supplierId, setSupplierId] = useState<string>('');

  const handleGenerate = () => {
    onGenerate(reportType, startDate, endDate, supplierId && supplierId !== 'all' ? supplierId : undefined);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Generar Reporte</CardTitle>
        <CardDescription>Selecciona el tipo de reporte y el período</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-4 md:grid-cols-5">
          {/* Tipo de Reporte */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Tipo de Reporte</label>
            <Select
              value={reportType}
              onValueChange={(value) => setReportType(value as ReportType)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(REPORT_TYPES).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Proveedor (opcional) */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Proveedor (opcional)</label>
            <Select
              value={supplierId}
              onValueChange={setSupplierId}
            >
              <SelectTrigger>
                <SelectValue placeholder="Todos" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos los proveedores</SelectItem>
                {suppliers.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.tradeName || s.businessName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Fecha Desde */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Desde</label>
            <Input
              type="date"
              value={moment(startDate).format('YYYY-MM-DD')}
              onChange={(e) => setStartDate(new Date(e.target.value + 'T12:00:00'))}
            />
          </div>

          {/* Fecha Hasta */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Hasta</label>
            <Input
              type="date"
              value={moment(endDate).format('YYYY-MM-DD')}
              onChange={(e) => setEndDate(new Date(e.target.value + 'T12:00:00'))}
            />
          </div>

          {/* Botón Generar */}
          <div className="space-y-2">
            <label className="text-sm font-medium">&nbsp;</label>
            <Button
              onClick={handleGenerate}
              disabled={loading || !startDate || !endDate}
              className="w-full"
            >
              <FileText className="mr-2 h-4 w-4" />
              {loading ? 'Generando...' : 'Generar'}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
