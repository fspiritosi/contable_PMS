'use client';

import { FileDown } from 'lucide-react';

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/shared/components/ui/card';

/**
 * Guía de Archivos ARCA (TSK-796): el Libro IVA Digital del mes. Separada de
 * `_AccountingGuide` para no hacerla crecer.
 */
export function _FiscalExportsGuide() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileDown className="h-5 w-5" />
          Archivos ARCA
        </CardTitle>
        <CardDescription>Los TXT del Libro IVA Digital del mes para importar en ARCA</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <ol className="list-decimal space-y-2 pl-6 text-muted-foreground">
          <li>
            Andá a <strong>Contabilidad → Archivos ARCA</strong>. Viene elegido el mes anterior,
            que es el que se presenta.
          </li>
          <li>
            Tocá <strong>Generar archivos</strong>. Aparece cada archivo con su cantidad de
            registros y un botón <strong>Descargar</strong>; los que no tienen registros en el mes
            quedan deshabilitados.
          </li>
        </ol>
        <ul className="list-disc space-y-1 pl-6 text-muted-foreground">
          <li>
            Son cuatro archivos: <strong>comprobantes</strong> y <strong>alícuotas</strong> de
            ventas y de compras, con los nombres y el formato que pide ARCA, para importarlos en
            el <strong>Libro IVA Digital</strong> del Portal IVA.
          </li>
          <li>
            Entran las facturas y notas de crédito y débito del mes en cualquier estado salvo{' '}
            <strong>borrador</strong> y <strong>anulada</strong>: también las ya cobradas o
            pagadas, total o parcialmente.
          </li>
          <li>
            Las compras con comprobante <strong>B</strong> o <strong>C</strong> no discriminan
            IVA: van en comprobantes pero no en alícuotas.
          </li>
        </ul>
        <p className="text-sm text-muted-foreground">
          Requiere el permiso de ver Informes contables. Si cambiás el mes, volvé a generar los
          archivos.
        </p>
      </CardContent>
    </Card>
  );
}
