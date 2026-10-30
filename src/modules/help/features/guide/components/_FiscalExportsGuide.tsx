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
 * Guía de Archivos ARCA: el Libro IVA Digital (TSK-796, TSK-814) y las retenciones de SIRE,
 * SICORE y SIRCAR (TSK-813) del mes. Separada de
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
        <CardDescription>
          Los TXT del mes para ARCA: Libro IVA Digital y retenciones (SIRE, SICORE y SIRCAR)
        </CardDescription>
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
          <li>
            Una venta a un <strong>consumidor final</strong> sin CUIT ni DNI sale como
            &quot;CONSUMIDOR FINAL&quot;, sin documento. Los <strong>gastos bancarios</strong> salen
            con el comprobante 099 (otros comprobantes), con su IVA como crédito fiscal.
          </li>
        </ul>
        <p className="font-medium text-foreground">Retenciones</p>
        <ul className="list-disc space-y-1 pl-6 text-muted-foreground">
          <li>
            Salen de las <strong>órdenes de pago confirmadas</strong> del mes, un archivo por
            sistema: <strong>SIRE F.2005</strong> (IVA) y <strong>SIRE F.2004</strong> (Seguridad
            Social) para emitir los certificados por lote, <strong>SICORE</strong> (Ganancias) para
            importar en el aplicativo y <strong>SIRCAR</strong> (IIBB), uno por cada jurisdicción.
          </li>
          <li>
            Cada retención necesita el <strong>régimen</strong> y la <strong>base imponible</strong>{' '}
            (en IIBB, la <strong>jurisdicción</strong>), que se cargan en la orden de pago. Si
            falta alguno, la retención no entra y la pantalla avisa en qué orden completarla.
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
