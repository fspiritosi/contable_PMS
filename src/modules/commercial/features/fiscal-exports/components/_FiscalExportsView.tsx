'use client';

import { useMutation } from '@tanstack/react-query';
import { FileText, Loader2 } from 'lucide-react';
import moment from 'moment';
import { useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/shared/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/shared/components/ui/card';
import { Label } from '@/shared/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui/select';
import { logger } from '@/shared/lib/logger';
import { todayBusinessDay } from '@/shared/utils/business-day';

import { generateLibroIVADigital } from '../libro-iva-digital/actions.server';
import { generateWithholdingFiles } from '../withholdings/actions.server';
import type { WithholdingFiles } from '../withholdings/build-files';
import { _FiscalFileRow, type FiscalFile } from './_FiscalFileRow';
import { _WithholdingFilesCard } from './_WithholdingFilesCard';
import { countRecords } from './download-txt';

const MONTH_NAMES = [
  'Enero',
  'Febrero',
  'Marzo',
  'Abril',
  'Mayo',
  'Junio',
  'Julio',
  'Agosto',
  'Septiembre',
  'Octubre',
  'Noviembre',
  'Diciembre',
];
interface Period {
  year: number;
  month: number; // 1-12
}

const periodCode = ({ year, month }: Period) => `${year}${String(month).padStart(2, '0')}`;

/** Libro IVA Digital (TSK-796) y archivos de retenciones (TSK-813) del mes. */
async function generateFiles(
  period: Period
): Promise<{ libro: FiscalFile[]; withholdings: WithholdingFiles }> {
  const [libro, withholdings] = await Promise.all([
    generateLibroIVADigital(period.year, period.month),
    generateWithholdingFiles(period.year, period.month),
  ]);
  const name = (file: string) => `LIBRO_IVA_DIGITAL_${file}_${periodCode(period)}.txt`;
  return {
    withholdings,
    libro: [
      {
        label: 'Ventas: comprobantes',
        description: 'Facturas, notas de crédito y de débito emitidas',
        filename: name('VENTAS_CBTE'),
        content: libro.ventas.cabecera,
        records: libro.ventas.registros,
      },
      {
        label: 'Ventas: alícuotas',
        description: 'Una línea por comprobante y alícuota de IVA',
        filename: name('VENTAS_ALICUOTAS'),
        content: libro.ventas.alicuotas,
        records: countRecords(libro.ventas.alicuotas),
      },
      {
        label: 'Compras: comprobantes',
        description: 'Facturas, notas de crédito y de débito recibidas',
        filename: name('COMPRAS_CBTE'),
        content: libro.compras.cabecera,
        records: libro.compras.registros,
      },
      {
        label: 'Compras: alícuotas',
        description: 'Una línea por comprobante y alícuota de IVA (las B y C no llevan)',
        filename: name('COMPRAS_ALICUOTAS'),
        content: libro.compras.alicuotas,
        records: countRecords(libro.compras.alicuotas),
      },
    ],
  };
}

export function _FiscalExportsView() {
  // Por defecto, el mes anterior: es el que se presenta.
  const previousMonth = moment(todayBusinessDay(), 'YYYY-MM-DD').subtract(1, 'month');
  const [period, setPeriod] = useState<Period>({
    year: previousMonth.year(),
    month: previousMonth.month() + 1,
  });
  const yearOptions = Array.from({ length: 6 }, (_, i) => previousMonth.year() + 1 - i);

  const generate = useMutation({
    mutationFn: generateFiles,
    onError: (error) => {
      logger.error('Error al generar los archivos para ARCA', { data: { error } });
      toast.error('No se pudieron generar los archivos');
    },
  });
  const update = (patch: Partial<Period>) => {
    setPeriod((current) => ({ ...current, ...patch }));
    generate.reset();
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Archivos ARCA</h1>
        <p className="text-sm text-muted-foreground">
          Generá los archivos TXT del mes para importar en ARCA: Libro IVA Digital, SIRE, SICORE y
          SIRCAR
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Período</CardTitle>
          <CardDescription>
            Entran los comprobantes del mes en cualquier estado salvo borrador y anulado, y las
            órdenes de pago confirmadas
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-4">
          <div className="grid gap-2">
            <Label>Mes</Label>
            <Select
              value={String(period.month)}
              onValueChange={(v) => update({ month: Number(v) })}
            >
              <SelectTrigger className="w-[160px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MONTH_NAMES.map((name, idx) => (
                  <SelectItem key={name} value={String(idx + 1)}>
                    {name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label>Año</Label>
            <Select value={String(period.year)} onValueChange={(v) => update({ year: Number(v) })}>
              <SelectTrigger className="w-[100px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {yearOptions.map((y) => (
                  <SelectItem key={y} value={String(y)}>
                    {y}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button onClick={() => generate.mutate(period)} disabled={generate.isPending}>
            {generate.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <FileText className="mr-2 h-4 w-4" />
            )}
            Generar archivos
          </Button>
        </CardContent>
      </Card>

      {generate.data && (
        <>
          <Card>
            <CardHeader>
              <CardTitle>
                Libro IVA Digital de {MONTH_NAMES[period.month - 1]} {period.year}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {generate.data.libro.map((file) => (
                <_FiscalFileRow key={file.filename} file={file} />
              ))}
            </CardContent>
          </Card>
          <_WithholdingFilesCard
            files={generate.data.withholdings}
            title={`Retenciones de ${MONTH_NAMES[period.month - 1]} ${period.year}`}
            period={periodCode(period)}
          />
        </>
      )}
    </div>
  );
}
