'use client';

import { Briefcase, LineChart } from 'lucide-react';

import { Alert, AlertDescription } from '@/shared/components/ui/alert';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/shared/components/ui/card';

/** Guía de inversiones (TSK-793): brokers, tenencias, compra/venta y valuación al cierre. */
export function _InvestmentsGuide() {
  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Briefcase className="h-5 w-5" />
            Brokers y Tenencias
          </CardTitle>
          <CardDescription>
            Dónde está invertida la plata y cuánto vale en libros
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <p>
            <strong>Brokers:</strong> en{' '}
            <strong>Tesorería → Cuentas Bancarias y Brokers</strong> elegí{' '}
            <strong>Nueva Cuenta</strong> y, como tipo, <strong>Broker</strong>.
            El nombre es obligatorio y no se piden CBU ni alias. El broker tiene
            su propio saldo: para pasarle plata desde un banco usá una{' '}
            <strong>Transferencia entre cuentas</strong> en Movimientos de
            Fondos.
          </p>
          <p>
            <strong>Tenencias:</strong> un instrumento dentro de un banco o
            broker (por ejemplo, el bono AL30 en Balanz). En dos brokers, son dos
            tenencias.
          </p>
          <ol className="list-decimal pl-6 space-y-1 text-muted-foreground">
            <li>
              Ve a <strong>Tesorería → Inversiones</strong> y tocá{' '}
              <strong>Nueva tenencia</strong>.
            </li>
            <li>
              Elegí el banco o broker donde está, el tipo de instrumento
              (acciones, CEDEARs, bonos, opciones, letras, futuros,
              licitaciones, obligaciones negociables, fondos, fideicomisos,
              cauciones o plazo fijo), el nombre o ticker y, si corresponde, el
              vencimiento.
            </li>
            <li>
              Elegí la <strong>cuenta contable del activo</strong> (obligatoria).
            </li>
          </ol>
          <p className="text-muted-foreground">
            El listado muestra las tenencias agrupadas por banco o broker, con
            su valor en libros y sus nominales. Al entrar a una tenencia ves su
            historial de movimientos. Los nominales y el valor en libros no se
            editan a mano: salen de las compras, ventas y valuaciones. Una
            tenencia con movimientos no se puede eliminar, y no se pueden
            cambiar su cuenta, su custodia ni su tipo.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <LineChart className="h-5 w-5" />
            Compra y Venta de Inversión
          </CardTitle>
          <CardDescription>
            Se cargan en Movimientos de Fondos, con su asiento
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <p>
            <strong>Compra de inversión:</strong> en{' '}
            <strong>Tesorería → Movimientos de Fondos</strong> elegí{' '}
            <strong>Compra de inversión</strong>. El origen es un banco, una caja
            o un broker, y el destino es la tenencia.
          </p>
          <ul className="list-disc pl-6 space-y-1 text-muted-foreground">
            <li>
              Si cargás <strong>nominales y precio</strong>, el importe es
              nominales × precio. Si no, cargás el importe directamente. Los
              nominales son opcionales.
            </li>
            <li>
              La <strong>comisión</strong> es opcional y se registra como gasto
              aparte: del origen sale el importe más la comisión.
            </li>
          </ul>
          <p>
            <strong>Venta de inversión:</strong> elegí{' '}
            <strong>Venta de inversión</strong>. El origen es la tenencia y el
            destino un banco, caja o broker. Cargás lo cobrado (importe bruto),
            la comisión si hubo y, si la tenencia lleva nominales, cuántos
            vendés (obligatorio, salvo en la venta total).
          </p>
          <ul className="list-disc pl-6 space-y-1 text-muted-foreground">
            <li>
              <strong>Venta parcial con nominales:</strong> el costo de lo
              vendido es el valor en libros por la parte vendida (precio
              promedio ponderado) y el resultado, cobrado menos costo, se
              registra en ese momento. Lo que queda se valúa al cierre. Si
              volvés a comprar, se suma a la misma tenencia.
            </li>
            <li>
              <strong>Venta parcial sin nominales</strong> (fondos, cauciones,
              fideicomisos, plazo fijo): baja el capital por lo cobrado y el
              resultado aparece al cierre o en la venta total.
            </li>
            <li>
              <strong>Venta total</strong> (o vencimiento): marcá{' '}
              <strong>Venta total</strong>: vende todos los nominales. El
              resultado es lo cobrado menos el valor en libros y la tenencia
              queda cerrada.
            </li>
            <li>
              La comisión de venta se descuenta de lo que entra al destino. Tiene
              que ser menor al importe cobrado.
            </li>
          </ul>
          <Alert>
            <AlertDescription>
              El sistema no deja que una tenencia quede en negativo: no podés
              vender más nominales ni más plata de la que tiene. Una venta total
              tiene que ser el último movimiento de la tenencia, y no se cargan
              compras ni ventas con fecha anterior a una venta ya registrada ni
              movimientos con fecha igual o anterior a una valuación.
            </AlertDescription>
          </Alert>
          <p className="text-muted-foreground">
            Editar, eliminar o anular una compra o venta funciona como en el
            resto de los movimientos (propuesta con vista previa). Si la
            tenencia tiene una <strong>venta posterior</strong>, primero hay que
            anular esa venta; si ya fue <strong>valuada</strong>, hay que
            deshacer la valuación.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <LineChart className="h-5 w-5" />
            Valuación al Cierre
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <ol className="list-decimal pl-6 space-y-1 text-muted-foreground">
            <li>
              Ve a <strong>Tesorería → Inversiones → Valuación al cierre</strong> (pide
              permiso de aprobar).
            </li>
            <li>Elegí el ejercicio: aparecen las tenencias abiertas al cierre.</li>
            <li>
              Por cada una cargá el <strong>valor al cierre</strong> o, si lleva
              nominales, el <strong>precio por nominal</strong> (el sistema
              multiplica).
            </li>
            <li>
              Revisá la <strong>vista previa</strong>: diferencia por tenencia y
              totales de ganancia y pérdida.
            </li>
            <li>
              Tocá <strong>Generar</strong>: se crea un asiento{' '}
              <strong>en Borrador</strong> con fecha de fin del ejercicio, contra
              las cuentas de resultado por tenencia.
            </li>
          </ol>
          <p className="text-muted-foreground">
            El valor cargado pasa a ser el nuevo valor en libros de la tenencia.
            Hay una valuación por ejercicio y se hacen en orden entre
            ejercicios. Se hace antes del cierre contable. Podés{' '}
            <strong>deshacerla</strong> mientras el asiento esté en Borrador (si
            ya lo registraste, volvelo a borrador en Asientos; desde ahí no se
            elimina ni se anula). Si una tenencia tiene ventas posteriores al
            cierre, el sistema no valúa y te dice cuáles son.
          </p>
          <Alert>
            <AlertDescription>
              Antes de usarlo, configurá en <strong>Ajustes contables</strong> las
              cuentas de <em>Resultado por tenencia positivo (inversiones)</em>,{' '}
              <em>Resultado por tenencia negativo (inversiones)</em> y{' '}
              <em>Comisiones de inversiones</em>. Sin ellas, la compra, venta o
              valuación avisa qué falta configurar.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    </>
  );
}
