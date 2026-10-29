'use client';

import { Download } from 'lucide-react';

import { Button } from '@/shared/components/ui/button';

import { downloadArcaTxt } from './download-txt';

export interface FiscalFile {
  label: string;
  description: string;
  filename: string;
  content: string;
  records: number;
}

/** Una fila por archivo generado: qué es, cuántos registros tiene y su descarga. */
export function _FiscalFileRow({ file }: { file: FiscalFile }) {
  return (
    <div className="flex flex-col gap-3 rounded-md border p-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <div className="font-medium">{file.label}</div>
        <div className="text-sm text-muted-foreground">{file.description}</div>
        <div className="mt-1 break-all font-mono text-xs text-muted-foreground">{file.filename}</div>
      </div>
      <div className="flex items-center gap-3 sm:shrink-0">
        <span className="text-sm text-muted-foreground">
          {file.records === 0
            ? 'Sin registros'
            : `${file.records} ${file.records === 1 ? 'registro' : 'registros'}`}
        </span>
        <Button
          size="sm"
          variant="outline"
          disabled={file.records === 0}
          onClick={() => downloadArcaTxt(file.content, file.filename)}
        >
          <Download className="mr-2 h-4 w-4" />
          Descargar
        </Button>
      </div>
    </div>
  );
}
