'use client';

import {
  ArrowDownUp,
  ArrowRightLeft,
  BadgeDollarSign,
  CheckSquare,
  Clock,
  Download,
  FileCheck,
  Info,
  Landmark,
  LineChart,
  Receipt,
  Trash2,
  TrendingUp,
  Vault,
} from 'lucide-react';

import { Alert, AlertDescription } from '@/shared/components/ui/alert';
import { Badge } from '@/shared/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/shared/components/ui/card';
import { Separator } from '@/shared/components/ui/separator';

export function _TreasuryGuide() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold">Tesorería</h2>
        <p className="text-muted-foreground">
          Gestión de cuentas bancarias, cobros, pagos y conciliación
        </p>
      </div>

      {/* Cuentas Bancarias */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Landmark className="h-5 w-5" />
            Cuentas Bancarias
          </CardTitle>
          <CardDescription>
            Registra y gestiona tus cuentas en bancos
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <p>
            <strong>Crear una cuenta bancaria:</strong>
          </p>
          <ol className="list-decimal pl-6 space-y-1 text-muted-foreground">
            <li>
              Ve a <strong>Tesorería → Cuentas Bancarias</strong>
            </li>
            <li>
              Haz clic en <strong>Nueva Cuenta</strong>
            </li>
            <li>
              Completa:
              <ul className="list-disc pl-6 mt-1 space-y-1">
                <li>Nombre del banco</li>
                <li>Número de cuenta</li>
                <li>Tipo: Cuenta Corriente, Caja de Ahorro o Crédito</li>
                <li>CBU (22 dígitos) y Alias</li>
                <li>Moneda (por defecto ARS)</li>
                <li>Saldo inicial</li>
                <li>Cuenta contable asociada (opcional, para integración)</li>
              </ul>
            </li>
          </ol>

          <p className="mt-3">
            <strong>KPIs de la lista:</strong>
          </p>
          <ul className="list-disc pl-6 space-y-1 text-muted-foreground">
            <li>Total en bancos (suma de cuentas activas)</li>
            <li>Cantidad de cuentas activas</li>
            <li>Total de movimientos registrados</li>
          </ul>

          <p className="mt-3">
            <strong>Detalle de cuenta:</strong> tiene dos pestañas:
          </p>
          <ul className="list-disc pl-6 space-y-1 text-muted-foreground">
            <li>
              <strong>Movimientos</strong>: historial completo con filtros por
              tipo y fecha
            </li>
            <li>
              <strong>Conciliación</strong>: movimientos pendientes de conciliar
            </li>
          </ul>
        </CardContent>
      </Card>

      {/* Movimientos Bancarios */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ArrowDownUp className="h-5 w-5" />
            Movimientos Bancarios
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p>
            Los movimientos se crean automáticamente al confirmar recibos y
            órdenes de pago, o se pueden registrar manualmente:
          </p>
          <ul className="list-disc pl-6 space-y-1 text-muted-foreground">
            <li>
              <strong>Depósito</strong>: ingreso de dinero
            </li>
            <li>
              <strong>Extracción</strong>: retiro de dinero
            </li>
            <li>
              <strong>Transferencia</strong>: envío o recepción entre cuentas
            </li>
            <li>
              <strong>Cheque</strong>: pago con cheque
            </li>
            <li>
              <strong>Débito Automático</strong>: cargos recurrentes
            </li>
            <li>
              <strong>Comisión / Interés</strong>: cargos o créditos bancarios
            </li>
          </ul>
        </CardContent>
      </Card>

      {/* Exportar Movimientos a Excel */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Download className="h-5 w-5" />
            Exportar Movimientos a Excel
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p>
            Puedes exportar los movimientos bancarios filtrados a un archivo
            Excel para análisis externo o respaldo:
          </p>
          <ol className="list-decimal pl-6 space-y-1 text-muted-foreground">
            <li>
              Ve al <strong>detalle de la cuenta bancaria</strong>
            </li>
            <li>
              Aplica los filtros que necesites (tipo, fecha, conciliación)
            </li>
            <li>
              Haz clic en <strong>Exportar Excel</strong>
            </li>
          </ol>
          <p className="text-sm text-muted-foreground">
            Se exportan todos los registros que coincidan con los filtros
            aplicados, sin importar la paginación de la tabla. El archivo
            incluye fecha, tipo, descripción, referencia, monto, estado de
            conciliación y documento vinculado.
          </p>
        </CardContent>
      </Card>

      {/* Transferencias entre Cuentas */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ArrowRightLeft className="h-5 w-5" />
            Transferencias entre Cuentas Propias
          </CardTitle>
          <CardDescription>
            Mover fondos entre tus cuentas bancarias y cajas
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <p>
            Las transferencias permiten mover fondos entre cuentas propias de
            forma atómica, asegurando que ambos lados se actualicen
            correctamente:
          </p>
          <p>
            <strong>Realizar una transferencia:</strong>
          </p>
          <ol className="list-decimal pl-6 space-y-1 text-muted-foreground">
            <li>
              Ve al <strong>detalle de la cuenta bancaria</strong> origen
            </li>
            <li>
              Haz clic en <strong>Transferir</strong>
            </li>
            <li>
              Selecciona el tipo de destino:
              <ul className="list-disc pl-6 mt-1 space-y-1">
                <li>
                  <strong>Cuenta Bancaria</strong>: otra cuenta de tu empresa
                </li>
                <li>
                  <strong>Caja</strong>: una caja registradora con sesión
                  abierta
                </li>
              </ul>
            </li>
            <li>Indica el monto, fecha y descripción</li>
            <li>
              Haz clic en <strong>Transferir</strong> para confirmar
            </li>
          </ol>
          <p className="text-sm text-muted-foreground">
            La transferencia actualiza los saldos de ambas cuentas y genera
            el asiento contable correspondiente si ambas cuentas tienen
            cuenta contable asociada.
          </p>
        </CardContent>
      </Card>

      {/* Eliminar Movimientos */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Trash2 className="h-5 w-5" />
            Eliminar Movimientos Bancarios
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p>
            Puedes eliminar movimientos bancarios que fueron registrados por
            error, siempre que cumplan estas condiciones:
          </p>
          <ul className="list-disc pl-6 space-y-1 text-muted-foreground">
            <li>El movimiento <strong>no esté conciliado</strong></li>
            <li>
              El movimiento <strong>no esté vinculado</strong> a un recibo u
              orden de pago
            </li>
          </ul>
          <p className="text-sm text-muted-foreground">
            Al eliminar un movimiento, el saldo de la cuenta se actualiza
            automáticamente revirtiendo el efecto del movimiento. Esta acción
            no se puede deshacer.
          </p>
        </CardContent>
      </Card>

      {/* Recibos */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Receipt className="h-5 w-5" />
            Recibos de Cobro
          </CardTitle>
          <CardDescription>
            Registra los cobros de facturas a clientes
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <p>
            <strong>Crear un recibo:</strong>
          </p>
          <ol className="list-decimal pl-6 space-y-2 text-muted-foreground">
            <li>
              Ve a <strong>Tesorería → Recibos</strong> y haz clic en{' '}
              <strong>Nuevo Recibo</strong>
            </li>
            <li>Selecciona el <strong>cliente</strong></li>
            <li>
              Agrega las <strong>facturas a cobrar</strong>: se muestran las
              facturas confirmadas pendientes de cobro con su saldo
            </li>
            <li>Indica el monto a cobrar de cada factura</li>
            <li>
              Agrega las <strong>formas de pago</strong>:
              <ul className="list-disc pl-6 mt-1 space-y-1">
                <li>Efectivo (asociar caja)</li>
                <li>Transferencia (asociar cuenta bancaria)</li>
                <li>
                  Cheque (indicar número, banco emisor, emisor/librador, fecha de
                  emisión y fecha de vencimiento)
                </li>
                <li>
                  E-Cheq (mismos datos del cheque, más la cuenta de depósito donde
                  ingresó el e-cheq)
                </li>
                <li>Tarjeta de débito/crédito (últimos 4 dígitos)</li>
              </ul>
              <p className="text-sm text-muted-foreground mt-1">
                Al confirmar el recibo, los cheques y e-cheq se registran
                automáticamente en <strong>Tesorería → Cheques</strong> en estado
                &quot;En cartera&quot;, con sus fechas reales. Podés corregir sus datos
                desde allí mientras sigan en cartera.
              </p>
            </li>
            <li>
              Agrega <strong>retenciones</strong> si corresponde (IVA,
              Ganancias, IIBB, SUSS) con alícuota y monto
            </li>
            <li>
              El total de pagos + retenciones debe igualar el total de facturas
            </li>
          </ol>

          <p className="mt-3">
            <strong>Estados:</strong>
          </p>
          <div className="flex flex-wrap gap-2">
            <Badge variant="secondary">Borrador</Badge>
            <span>→</span>
            <Badge>Confirmado</Badge>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            Al confirmar, se actualiza el saldo de las facturas y se genera el
            asiento contable.
          </p>
        </CardContent>
      </Card>

      {/* Órdenes de Pago */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BadgeDollarSign className="h-5 w-5" />
            Órdenes de Pago
          </CardTitle>
          <CardDescription>
            Registra los pagos a proveedores
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <p>
            Funcionan de manera similar a los recibos pero para pagos a
            proveedores:
          </p>
          <ol className="list-decimal pl-6 space-y-1 text-muted-foreground">
            <li>Selecciona el <strong>proveedor</strong></li>
            <li>
              Agrega las <strong>facturas o gastos a pagar</strong>
            </li>
            <li>
              Indica las <strong>formas de pago</strong> (mismas opciones que
              recibos)
            </li>
            <li>
              Si pagás con <strong>cheque o e-cheq</strong>, elegí si es:
              <ul className="list-disc pl-6 mt-1 space-y-1">
                <li>
                  <strong>Propio</strong>: se emite un cheque nuevo (cargás número,
                  banco y fechas)
                </li>
                <li>
                  <strong>De terceros</strong>: se <strong>endosa</strong> un cheque
                  recibido que tengas <strong>en cartera</strong>. Elegís el cheque
                  de la lista y el monto se completa solo; al confirmar, ese cheque
                  pasa a estado &quot;Endosado&quot; a nombre del proveedor
                </li>
              </ul>
            </li>
            <li>
              Agrega <strong>retenciones</strong> si corresponde
            </li>
            <li>
              Al confirmar, se registra el pago y se genera el asiento
            </li>
          </ol>
        </CardContent>
      </Card>

      {/* Cheques */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileCheck className="h-5 w-5" />
            Cheques
          </CardTitle>
          <CardDescription>
            Gestión de cheques propios y de terceros
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <p>
            El sistema permite gestionar cheques propios (emitidos por tu
            empresa) y de terceros (recibidos de clientes). Cada cheque tiene un
            ciclo de vida completo con seguimiento de estado.
          </p>
          <p>
            <strong>Registrar un cheque:</strong>
          </p>
          <ol className="list-decimal pl-6 space-y-2 text-muted-foreground">
            <li>
              Ve a <strong>Tesorería → Cheques</strong>
            </li>
            <li>
              Haz clic en <strong>Nuevo Cheque</strong>
            </li>
            <li>
              Completa:
              <ul className="list-disc pl-6 mt-1 space-y-1">
                <li>Tipo: Propio o De Tercero</li>
                <li>Número de cheque</li>
                <li>Banco emisor</li>
                <li>Monto</li>
                <li>Fecha de emisión y fecha de vencimiento</li>
                <li>Librador (quien emite el cheque)</li>
                <li>Beneficiario (a quien se paga)</li>
                <li>Cliente o proveedor asociado (según tipo)</li>
                <li>Cuenta bancaria vinculada (opcional)</li>
              </ul>
            </li>
          </ol>

          <p className="mt-3">
            <strong>Estados de cheques de terceros:</strong>
          </p>
          <div className="flex flex-wrap gap-2">
            <Badge variant="secondary">En Cartera</Badge>
            <span>→</span>
            <Badge>Depositado</Badge>
            <span>→</span>
            <Badge>Acreditado</Badge>
          </div>
          <div className="flex flex-wrap gap-2 mt-2">
            <span className="text-sm text-muted-foreground">También:</span>
            <Badge variant="outline">Endosado</Badge>
            <Badge variant="destructive">Rechazado</Badge>
            <Badge variant="destructive">Anulado</Badge>
          </div>
          <ul className="list-disc pl-6 space-y-1 text-muted-foreground mt-2">
            <li>
              <strong>En Cartera</strong>: cheque recibido, disponible
            </li>
            <li>
              <strong>Depositado</strong>: enviado al banco para su cobro
            </li>
            <li>
              <strong>Acreditado</strong>: el banco acreditó el monto
            </li>
            <li>
              <strong>Endosado</strong>: transferido a un tercero
            </li>
            <li>
              <strong>Rechazado</strong>: el banco rechazó el cheque
            </li>
          </ul>

          <p className="mt-3">
            <strong>Estados de cheques propios:</strong>
          </p>
          <ul className="list-disc pl-6 space-y-1 text-muted-foreground">
            <li>
              <strong>Entregado</strong>: cheque emitido y entregado al
              beneficiario
            </li>
            <li>
              <strong>Cobrado</strong>: el cheque fue debitado de tu cuenta
            </li>
            <li>
              <strong>Anulado</strong>: el cheque fue anulado
            </li>
          </ul>

          <p className="text-sm text-muted-foreground mt-2">
            Desde el detalle del cheque puedes realizar acciones como depositar,
            endosar o marcar como rechazado.
          </p>

          <p className="mt-3">
            <strong>Editar un cheque:</strong>
          </p>
          <p className="text-sm text-muted-foreground">
            Mientras un cheque esté <strong>En Cartera</strong> podés corregir sus
            datos (número, banco emisor, emisor/librador, CUIT, fechas de emisión y
            vencimiento, sucursal, cuenta y notas) desde la acción{' '}
            <strong>Editar</strong> del menú de la fila. Una vez depositado,
            endosado o acreditado, ya no se puede modificar.
          </p>

          <p className="mt-3">
            <strong>E-Cheq:</strong>
          </p>
          <p className="text-sm text-muted-foreground">
            Los e-cheq se identifican con la etiqueta <strong>E-Cheq</strong> en el
            detalle. Se cargan como forma de cobro o pago indicando la cuenta
            bancaria donde ingresan (cobranza) o desde la que se emiten (pago). El
            saldo de la cuenta recién se actualiza cuando el e-cheq se acredita o
            debita, no al confirmar el recibo u orden de pago.
          </p>
        </CardContent>
      </Card>

      {/* Conciliación */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CheckSquare className="h-5 w-5" />
            Conciliación Bancaria
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p>
            La conciliación permite verificar que los movimientos registrados
            coincidan con el extracto bancario:
          </p>
          <ol className="list-decimal pl-6 space-y-2 text-muted-foreground">
            <li>
              Ve al <strong>detalle de la cuenta bancaria</strong>
            </li>
            <li>
              Selecciona la pestaña <strong>Conciliación</strong>
            </li>
            <li>
              Se muestran los movimientos <strong>no conciliados</strong>
            </li>
            <li>
              Marca como conciliado cada movimiento que coincida con el extracto
            </li>
          </ol>
          <p className="text-sm text-muted-foreground">
            La pestaña muestra un badge con la cantidad de movimientos pendientes
            de conciliar.
          </p>
        </CardContent>
      </Card>

      {/* Cajas Registradoras */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Vault className="h-5 w-5" />
            Cajas Registradoras
          </CardTitle>
          <CardDescription>
            Gestión de cajas para operaciones en efectivo
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <p>
            Las cajas registradoras permiten gestionar el efectivo de tu
            negocio. Cada caja tiene sesiones de apertura y cierre con control
            de saldos.
          </p>
          <p>
            <strong>Crear una caja:</strong>
          </p>
          <ol className="list-decimal pl-6 space-y-1 text-muted-foreground">
            <li>
              Ve a <strong>Tesorería → Cajas</strong>
            </li>
            <li>
              Haz clic en <strong>Nueva Caja</strong>
            </li>
            <li>
              Completa:
              <ul className="list-disc pl-6 mt-1 space-y-1">
                <li>Código (único)</li>
                <li>Nombre</li>
                <li>Ubicación (opcional)</li>
                <li>Marcar como caja por defecto si corresponde</li>
              </ul>
            </li>
          </ol>
          <p className="text-sm text-muted-foreground">
            Cada caja puede tener una única sesión abierta a la vez.
          </p>
        </CardContent>
      </Card>

      {/* Sesiones de Caja */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5" />
            Sesiones de Caja
          </CardTitle>
          <CardDescription>
            Apertura, operaciones y cierre de caja
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <p>
            <strong>Abrir una sesión:</strong>
          </p>
          <ol className="list-decimal pl-6 space-y-1 text-muted-foreground">
            <li>
              En la lista de cajas, haz clic en <strong>Abrir Sesión</strong> en
              la caja deseada
            </li>
            <li>
              Indica el <strong>monto de apertura</strong> (efectivo inicial en
              caja)
            </li>
            <li>Agrega notas de apertura si es necesario</li>
          </ol>

          <p className="mt-3">
            <strong>Durante la sesión:</strong>
          </p>
          <ul className="list-disc pl-6 space-y-1 text-muted-foreground">
            <li>
              Se registran automáticamente los movimientos de cobros en efectivo
              (recibos)
            </li>
            <li>
              Se registran automáticamente los pagos en efectivo (órdenes de
              pago)
            </li>
            <li>
              El sistema calcula el <strong>saldo esperado</strong> en base a
              los movimientos
            </li>
          </ul>

          <p className="mt-3">
            <strong>Cerrar la sesión:</strong>
          </p>
          <ol className="list-decimal pl-6 space-y-1 text-muted-foreground">
            <li>
              Haz clic en <strong>Cerrar Sesión</strong>
            </li>
            <li>
              Indica el <strong>monto real</strong> contado en caja (arqueo)
            </li>
            <li>
              El sistema muestra la <strong>diferencia</strong> entre lo
              esperado y lo real
            </li>
            <li>Agrega notas de cierre si hay observaciones</li>
          </ol>
        </CardContent>
      </Card>

      {/* Flujo de Caja */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5" />
            Flujo de Caja
          </CardTitle>
          <CardDescription>
            Visualización de ingresos y egresos
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <p>
            El flujo de caja muestra una visión consolidada de todos los
            ingresos y egresos de tu empresa en un período determinado.
          </p>
          <p>
            Desde <strong>Tesorería → Flujo de Caja</strong> puedes ver:
          </p>
          <ul className="list-disc pl-6 space-y-1 text-muted-foreground">
            <li>
              <strong>Resumen</strong>: tarjetas con total de ingresos, total de
              egresos y saldo neto
            </li>
            <li>
              <strong>Gráfico</strong>: evolución temporal de ingresos y egresos
            </li>
            <li>
              <strong>Tabla detallada</strong>: cada movimiento con fecha, tipo,
              monto y origen
            </li>
          </ul>
          <p className="text-sm text-muted-foreground">
            Puedes cambiar la <strong>granularidad</strong> (diario, semanal,
            mensual) y filtrar por rango de fechas.
          </p>
        </CardContent>
      </Card>

      {/* Proyecciones de Cashflow */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <LineChart className="h-5 w-5" />
            Proyecciones de Cashflow
          </CardTitle>
          <CardDescription>
            Planificación financiera a futuro
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <p>
            Las proyecciones permiten registrar ingresos y egresos esperados a
            futuro para planificar la disponibilidad de fondos.
          </p>
          <p>
            <strong>Crear una proyección:</strong>
          </p>
          <ol className="list-decimal pl-6 space-y-2 text-muted-foreground">
            <li>
              Ve a <strong>Tesorería → Proyecciones</strong>
            </li>
            <li>
              Haz clic en <strong>Nueva Proyección</strong>
            </li>
            <li>
              Completa:
              <ul className="list-disc pl-6 mt-1 space-y-1">
                <li>Tipo: Ingreso o Egreso</li>
                <li>Categoría: Venta, Compra, Gasto, Salario, Impuesto, Otro</li>
                <li>Descripción</li>
                <li>Monto esperado</li>
                <li>Fecha esperada</li>
                <li>Si es recurrente (opcional)</li>
                <li>Notas (opcional)</li>
              </ul>
            </li>
          </ol>
          <p className="text-sm text-muted-foreground">
            Cada proyección puede <strong>vincularse</strong> a documentos
            reales (facturas de venta, facturas de compra, gastos) a medida que
            se concretan, permitiendo comparar lo proyectado vs lo real.
          </p>
          <p className="text-sm text-muted-foreground">
            Las proyecciones ayudan a anticipar necesidades de financiamiento o
            excedentes de liquidez.
          </p>
        </CardContent>
      </Card>

      <Separator />

      <Alert>
        <Info className="h-4 w-4" />
        <AlertDescription>
          <strong>Relación con otros módulos:</strong>
          <ul className="list-disc pl-6 mt-1 space-y-1">
            <li>
              <strong>Comercial → Facturas</strong>: los recibos se aplican a
              facturas de venta; las órdenes de pago a facturas de compra
            </li>
            <li>
              <strong>Contabilidad</strong>: al confirmar recibos y órdenes de
              pago se generan asientos contables automáticos
            </li>
            <li>
              <strong>Dashboard</strong>: los saldos bancarios y totales de
              cobros/pagos alimentan los KPIs del dashboard
            </li>
            <li>
              <strong>Cheques</strong>: los cheques de terceros se reciben en
              recibos de cobro; los cheques propios se entregan en órdenes de
              pago
            </li>
            <li>
              <strong>Cajas</strong>: los cobros y pagos en efectivo se
              registran contra la sesión de caja abierta
            </li>
          </ul>
        </AlertDescription>
      </Alert>

      {/* Movimientos de Fondos */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ArrowRightLeft className="h-5 w-5" />
            Movimientos de Fondos
          </CardTitle>
          <CardDescription>
            Aportes de socios, retiros y transferencias entre cuentas
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-muted-foreground">
            Usá esta sección para movimientos de dinero que no son facturas,
            cobros ni pagos: cuando un socio pone plata en la empresa, cuando se
            le devuelve, o cuando movés fondos de una cuenta a otra. Cada
            movimiento <strong>genera su asiento contable automáticamente</strong>.
          </p>
          <p>
            <strong>Tipos de movimiento:</strong>
          </p>
          <ul className="list-disc pl-6 space-y-1 text-muted-foreground">
            <li>
              <strong>Aporte de socio</strong>: ingresa dinero a una cuenta de
              banco o caja. Contablemente aumenta el activo y el capital (contra
              la cuenta de aportes configurada).
            </li>
            <li>
              <strong>Retiro de socio</strong>: sale dinero de una cuenta hacia
              un socio. Disminuye el capital y el activo.
            </li>
            <li>
              <strong>Transferencia entre cuentas</strong>: mueve fondos de una
              cuenta a otra (por ejemplo, del banco a la caja).
            </li>
          </ul>
          <p>
            <strong>Cómo registrar uno:</strong>
          </p>
          <ol className="list-decimal pl-6 space-y-1 text-muted-foreground">
            <li>
              Ve a <strong>Tesorería → Movimientos de Fondos</strong> y hacé clic
              en <strong>Nuevo Movimiento</strong>
            </li>
            <li>Elegí el tipo, el monto y la fecha</li>
            <li>
              Seleccioná la cuenta de origen y/o destino (según el tipo) y, para
              aportes o retiros, opcionalmente el socio
            </li>
            <li>Escribí una descripción y confirmá</li>
          </ol>
          <Alert>
            <Info className="h-4 w-4" />
            <AlertDescription>
              Para registrar aportes o retiros primero configurá la{' '}
              <strong>Cuenta de aportes de socios</strong> en{' '}
              <strong>Ajustes contables</strong> (es una cuenta de Patrimonio
              Neto).
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    </div>
  );
}
