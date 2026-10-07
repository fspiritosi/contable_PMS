'use client';

import { CalendarCheck, Lock, Undo2 } from 'lucide-react';

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/shared/components/ui/card';

/**
 * Guía de cierre contable (TSK-760): cierre de meses en orden, borradores, cierre anual y
 * anulación de asientos. Separada de `_AccountingGuide` para no hacerla crecer.
 */
export function _AccountingClosingGuide() {
  return (
    <>
      {/* Cierre de meses */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Lock className="h-5 w-5" />
            Cierre de meses (Bloqueo de Períodos)
          </CardTitle>
          <CardDescription>Los meses se cierran de a uno y en orden</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <p>
            Un mes cerrado no admite ningún movimiento con esa fecha: ni asientos manuales, ni
            facturas, recibos, órdenes de pago, egresos, movimientos de fondos o bancarios,
            transferencias, depreciaciones o asientos recurrentes. Tampoco se pueden registrar ni
            anular asientos de ese mes. Si lo intentás, el sistema te dice qué mes está cerrado y
            dónde reabrirlo.
          </p>
          <ol className="list-decimal space-y-2 pl-6 text-muted-foreground">
            <li>
              Andá a <strong>Contabilidad → Configuración</strong>, sección{' '}
              <strong>Bloqueo de Períodos</strong>. Vas a ver los meses del ejercicio con un
              candado: cerrado o abierto.
            </li>
            <li>
              Hacé clic en el <strong>primer mes abierto</strong> (dice &quot;Cerrar&quot;) y
              confirmá. Los demás meses no se pueden elegir: se cierran en orden.
            </li>
            <li>
              Para corregir algo de un mes cerrado, reabrí el <strong>último mes cerrado</strong>{' '}
              (dice &quot;Reabrir&quot;). Si el error está en un mes anterior, hay que reabrir de a
              uno, desde el último hacia atrás.
            </li>
          </ol>
          <p>
            <strong>Borradores:</strong> si el mes que vas a cerrar tiene asientos en borrador (por
            ejemplo, los que generan las facturas al confirmarse), la grilla te muestra cuántos y el
            diálogo te ofrece <strong>Registrar los N borradores y cerrar</strong>. Se registran
            todos juntos y se cierra el mes; si alguno no se puede registrar, no se registra
            ninguno, el mes sigue abierto y el mensaje te dice cuál es y por qué.
          </p>
          <ul className="list-disc space-y-1 pl-6 text-muted-foreground">
            <li>
              Si el borrador trabado es un <strong>asiento manual</strong> que ya no sirve, lo podés
              eliminar desde Asientos (ver más abajo) y volver a cerrar.
            </li>
            <li>
              Si es el borrador de un comprobante, se corrige desde el comprobante o desde
              Configuración (por ejemplo, una cuenta que dejó de ser imputable).
            </li>
            <li>
              Un borrador que queda en un mes cerrado ya no se puede registrar sin reabrir el mes, y
              el cierre del ejercicio no se puede hacer con borradores pendientes.
            </li>
          </ul>
          <p className="text-sm text-muted-foreground">
            Los meses de un ejercicio ya cerrado no se pueden reabrir nunca: la pantalla lo avisa
            con una nota arriba de la grilla.
          </p>
        </CardContent>
      </Card>

      {/* Cierre de ejercicio */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CalendarCheck className="h-5 w-5" />
            Cierre de Ejercicio Fiscal
          </CardTitle>
          <CardDescription>Refundición de resultados y apertura del ejercicio siguiente</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <ol className="list-decimal space-y-2 pl-6 text-muted-foreground">
            <li>
              Andá a <strong>Contabilidad → Cierre de Ejercicio</strong>. Arriba ves el ejercicio
              abierto más antiguo y una lista de requisitos, cada uno con su link para resolverlo:
              la cuenta de <strong>Resultado del Ejercicio</strong> configurada,{' '}
              <strong>todos los meses cerrados</strong> y <strong>ningún borrador</strong> sin
              registrar en el ejercicio.
            </li>
            <li>
              Con los tres en verde se habilita <strong>Cerrar ejercicio N° X</strong>. La vista
              previa muestra ingresos, gastos, el resultado y los asientos que se van a generar.
            </li>
            <li>
              Al confirmar se registran la <strong>refundición</strong> (lleva las cuentas de
              ingresos y gastos a Resultado del Ejercicio, con fecha del último día) y la{' '}
              <strong>apertura</strong> del ejercicio siguiente (con fecha del primer día). El
              ejercicio queda cerrado y <strong>no se puede deshacer</strong>.
            </li>
          </ol>
          <ul className="list-disc space-y-1 pl-6 text-muted-foreground">
            <li>
              Podés operar en el ejercicio nuevo antes de cerrar el anterior (por ejemplo, cargar
              facturas de enero mientras terminás diciembre): el sistema lo crea solo con la primera
              operación.
            </li>
            <li>
              Después del cierre, el Balance y los saldos del ejercicio nuevo arrancan con los del
              cerrado (sin duplicarse) y el Estado de Resultados del ejercicio cerrado sigue
              mostrando sus ingresos y gastos.
            </li>
            <li>
              Las fechas del ejercicio en <strong>Contabilidad → Configuración</strong> ya no se
              editan una vez que hay movimientos: salen del ejercicio abierto y cambian solas al
              cerrarlo.
            </li>
          </ul>
        </CardContent>
      </Card>

      {/* Anular y eliminar asientos */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Undo2 className="h-5 w-5" />
            Anular y eliminar asientos
          </CardTitle>
          <CardDescription>Desde Contabilidad → Asientos, menú de cada fila</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <p>
            <strong>Anular</strong> (asientos registrados): crea un asiento con los importes
            invertidos y deja el original como anulado. La anulación se registra con{' '}
            <strong>fecha de hoy</strong> (el diálogo te la muestra antes de confirmar), así que el
            mes del asiento original y el mes de hoy tienen que estar abiertos.
          </p>
          <ul className="list-disc space-y-1 pl-6 text-muted-foreground">
            <li>
              El asiento de un <strong>comprobante</strong> (factura, recibo, orden de pago, egreso,
              movimiento de fondos, depreciación, revalúo o cierre de ejercicio) no se anula desde
              Asientos: el diálogo dice a qué comprobante pertenece y se anula desde ahí. Varios de
              esos comprobantes todavía no tienen anulación propia; llega en una próxima entrega.
            </li>
            <li>
              Los asientos automáticos sin comprobante (movimientos bancarios, transferencias, baja
              de equipos) se pueden anular, con un aviso: la anulación no revierte el saldo del
              banco ni el estado del equipo.
            </li>
          </ul>
          <p>
            <strong>Eliminar borrador</strong> (asientos en borrador): borra un asiento manual que
            todavía no se registró, por ejemplo uno con un error que traba el cierre de su mes. Su
            número queda sin usar. Los borradores de comprobantes no se eliminan desde acá: se
            corrigen desde el comprobante.
          </p>
        </CardContent>
      </Card>
    </>
  );
}
