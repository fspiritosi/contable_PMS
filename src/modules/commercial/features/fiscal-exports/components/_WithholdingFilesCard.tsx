'use client';

import { AlertTriangle } from 'lucide-react';

import { WITHHOLDING_TAX_TYPE_LABELS } from '@/modules/commercial/features/treasury/shared/validators';
import { jurisdictionLabel } from '@/modules/commercial/shared/convenio-multilateral';
import { Alert, AlertDescription, AlertTitle } from '@/shared/components/ui/alert';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/shared/components/ui/card';

import type { WithholdingFiles } from '../withholdings/build-files';
import { _FiscalFileRow, type FiscalFile } from './_FiscalFileRow';

interface WithholdingFilesCardProps {
  files: WithholdingFiles;
  title: string;
  /** AAAAMM para el nombre de los archivos. */
  period: string;
}

/** Los archivos de las retenciones practicadas en las órdenes de pago del mes (TSK-813). */
export function _WithholdingFilesCard({ files, title, period }: WithholdingFilesCardProps) {
  const rows: FiscalFile[] = [
    {
      label: 'SIRE F.2005: retenciones de IVA',
      description: 'Para emitir los certificados por lote en SIRE (impuesto 216)',
      filename: `SIRE_F2005_IVA_${period}.txt`,
      ...asRow(files.sireIva),
    },
    {
      label: 'SIRE F.2004: retenciones de Seguridad Social',
      description: 'Para emitir los certificados por lote en SIRE (impuesto 353)',
      filename: `SIRE_F2004_SUSS_${period}.txt`,
      ...asRow(files.sireSuss),
    },
    {
      label: 'SICORE: retenciones de Ganancias',
      description: 'Para importar en el aplicativo SICORE (impuesto 217)',
      filename: `SICORE_GANANCIAS_${period}.txt`,
      ...asRow(files.sicore),
    },
    ...(files.sircar.length === 0
      ? [
          {
            label: 'SIRCAR: retenciones de IIBB',
            description: 'Un archivo por jurisdicción',
            filename: `SIRCAR_RETENCIONES_${period}.txt`,
            content: '',
            records: 0,
          },
        ]
      : files.sircar.map((file) => ({
          label: `SIRCAR: retenciones de IIBB de ${jurisdictionLabel(file.jurisdiction)}`,
          description: `Declaración jurada de la jurisdicción ${file.jurisdiction}`,
          filename: `SIRCAR_RETENCIONES_${file.jurisdiction}_${period}.txt`,
          ...asRow(file),
        }))),
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>Retenciones de las órdenes de pago confirmadas del mes</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {files.incomplete.length > 0 && (
          <Alert>
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>
              {files.incomplete.length === 1
                ? '1 retención no entró en los archivos'
                : `${files.incomplete.length} retenciones no entraron en los archivos`}
            </AlertTitle>
            <AlertDescription>
              <p>Completá los datos que faltan en la orden de pago y volvé a generar:</p>
              <ul className="mt-1 list-disc pl-5">
                {files.incomplete.map((item, i) => (
                  <li key={i}>
                    {item.paymentOrder}, {WITHHOLDING_TAX_TYPE_LABELS[item.taxType]}: falta{' '}
                    {item.missing.join(', ')}
                  </li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        )}
        {rows.map((file) => (
          <_FiscalFileRow key={file.filename} file={file} />
        ))}
      </CardContent>
    </Card>
  );
}

function asRow(file: { content: string; registros: number }) {
  return { content: file.content, records: file.registros };
}
