'use client';

import {
  BarChart3,
  BookOpen,
  BookOpenCheck,
  Calculator,
  CalendarCheck,
  Info,
  Link2,
  Lock,
  PiggyBank,
  Receipt,
  RefreshCcw,
  Settings,
  TrendingDown,
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

export function _AccountingGuide() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold">Contabilidad</h2>
        <p className="text-muted-foreground">
          Plan de cuentas, asientos contables, reportes e integración comercial
        </p>
      </div>

      {/* Plan de Cuentas */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BookOpen className="h-5 w-5" />
            Plan de Cuentas
          </CardTitle>
          <CardDescription>
            Estructura jerárquica de cuentas contables
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <p>
            El plan de cuentas organiza las cuentas contables en un árbol
            jerárquico:
          </p>
          <ol className="list-decimal pl-6 space-y-2 text-muted-foreground">
            <li>
              Ve a <strong>Contabilidad → Plan de Cuentas</strong>
            </li>
            <li>
              Haz clic en <strong>Nueva Cuenta</strong>
            </li>
            <li>
              Completa:
              <ul className="list-disc pl-6 mt-1 space-y-1">
                <li>
                  <strong>Código</strong>: formato X.X.X/XX/XX (ej: 1.1.1/00/00).
                  Los segmentos que no completes se rellenan con 0; el primero
                  nunca puede ser 0
                </li>
                <li>
                  <strong>Nombre</strong> de la cuenta
                </li>
                <li>
                  <strong>Tipo</strong>: Activo (1), Pasivo (2), Patrimonio (3),
                  Ingresos (4), Gastos (5)
                </li>
                <li>
                  <strong>Naturaleza</strong>: se asigna automáticamente según
                  el tipo (deudora o acreedora)
                </li>
                <li>
                  <strong>Cuenta padre</strong>: para crear subcuentas. Solo se
                  listan cuentas del <strong>mismo tipo</strong>
                </li>
              </ul>
            </li>
          </ol>
          <p className="mt-2">
            <strong>Cuentas imputables vs. de sumatoria:</strong>
          </p>
          <ul className="list-disc pl-6 space-y-1 text-muted-foreground">
            <li>
              Las <strong>imputables</strong> son las cuentas hoja (sin hijas):
              reciben los movimientos de los asientos y muestran su{' '}
              <strong>saldo</strong>. Son las únicas que aparecen en los
              selectores de imputación (asientos, movimientos bancarios,
              configuración contable, artículos)
            </li>
            <li>
              Las <strong>de sumatoria</strong> son las que tienen hijas: no
              reciben movimientos directos y muestran la <strong>suma</strong>{' '}
              de sus cuentas hijas. Al asignarle una hija a una cuenta, esta
              pasa automáticamente a ser de sumatoria
            </li>
          </ul>
          <p className="mt-2">
            <strong>Deshabilitar una cuenta:</strong> desde el menú de acciones.
            Las cuentas con <strong>saldo 0</strong> se deshabilitan en el
            ejercicio en curso; las que tienen saldo, a partir del{' '}
            <strong>próximo ejercicio</strong>. Si deshabilitas una cuenta de
            sumatoria, la baja se aplica <strong>en cascada</strong> a sus hijas.
          </p>
          <p className="text-sm text-muted-foreground mt-2">
            Puedes <strong>importar</strong> un plan de cuentas desde Excel o{' '}
            <strong>exportar</strong> el actual.
          </p>
        </CardContent>
      </Card>

      {/* Asientos */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calculator className="h-5 w-5" />
            Asientos Contables (Libro Diario)
          </CardTitle>
          <CardDescription>
            Registro de movimientos contables
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <p>
            <strong>Crear un asiento manual:</strong>
          </p>
          <ol className="list-decimal pl-6 space-y-2 text-muted-foreground">
            <li>
              Ve a <strong>Contabilidad → Libro Diario</strong>
            </li>
            <li>
              Haz clic en <strong>Nuevo Asiento</strong>
            </li>
            <li>Indica la <strong>fecha</strong> y <strong>descripción</strong></li>
            <li>
              Agrega <strong>líneas</strong> (mínimo 2):
              <ul className="list-disc pl-6 mt-1 space-y-1">
                <li>Selecciona la cuenta contable</li>
                <li>Indica el monto en Debe o Haber (no ambos)</li>
              </ul>
            </li>
            <li>
              El total del Debe debe ser igual al total del Haber
            </li>
            <li>
              Haz clic en <strong>Guardar</strong> (queda en Borrador)
            </li>
          </ol>

          <p className="mt-3">
            <strong>Estados del asiento:</strong>
          </p>
          <div className="flex flex-wrap gap-2">
            <Badge variant="secondary">Borrador</Badge>
            <span>→</span>
            <Badge>Registrado</Badge>
            <span>→</span>
            <Badge variant="destructive">Reversado</Badge>
          </div>
          <ul className="list-disc pl-6 space-y-1 text-muted-foreground mt-2">
            <li>
              <strong>Registrar</strong>: confirma el asiento (irreversible)
            </li>
            <li>
              <strong>Reversar</strong>: crea un asiento inverso que anula el
              original
            </li>
          </ul>

          <p className="mt-3 text-sm text-muted-foreground">
            Los asientos muestran su <strong>origen</strong>: Manual, Fact.
            Venta, Fact. Compra, Recibo, Orden de Pago o Reversión.
          </p>
        </CardContent>
      </Card>

      {/* Integración Comercial */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Link2 className="h-5 w-5" />
            Integración Comercial
          </CardTitle>
          <CardDescription>
            Generación automática de asientos desde el módulo comercial
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <p>
            El sistema puede generar asientos contables automáticamente al
            confirmar documentos comerciales:
          </p>
          <ol className="list-decimal pl-6 space-y-2 text-muted-foreground">
            <li>
              Ve a <strong>Contabilidad → Configuración</strong>
            </li>
            <li>
              En la sección <strong>Integración Comercial</strong>, mapea las
              cuentas contables:
              <ul className="list-disc pl-6 mt-1 space-y-1">
                <li>Cuenta de Ventas</li>
                <li>Cuenta de Compras</li>
                <li>Deudores por Ventas</li>
                <li>Proveedores</li>
                <li>IVA Débito Fiscal e IVA Crédito Fiscal</li>
                <li>Caja y Banco</li>
                <li>Gastos</li>
                <li>
                  Retenciones (IVA, Ganancias, IIBB, SUSS - emitidas y
                  sufridas)
                </li>
              </ul>
            </li>
            <li>
              Una vez configurado, cada factura, recibo u orden de pago
              confirmado genera su asiento automáticamente
            </li>
          </ol>
        </CardContent>
      </Card>

      {/* Asientos Recurrentes */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <RefreshCcw className="h-5 w-5" />
            Asientos Recurrentes
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p>
            Para asientos que se repiten periódicamente (amortizaciones,
            alquileres, etc.):
          </p>
          <ol className="list-decimal pl-6 space-y-1 text-muted-foreground">
            <li>
              Ve a <strong>Contabilidad → Asientos Recurrentes</strong>
            </li>
            <li>Crea una <strong>plantilla</strong> con nombre, descripción y líneas</li>
            <li>
              Selecciona la <strong>frecuencia</strong>: mensual, bimestral,
              trimestral, semestral o anual
            </li>
            <li>Indica fecha de inicio y opcionalmente fecha de fin</li>
            <li>
              El sistema te notifica cuando hay asientos{' '}
              <strong>pendientes de generar</strong>
            </li>
            <li>
              Puedes generar uno a uno o todos los pendientes de una vez
            </li>
          </ol>
        </CardContent>
      </Card>

      {/* Reportes */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5" />
            Reportes Contables
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p>
            <strong>Reportes financieros:</strong>
          </p>
          <ul className="list-disc pl-6 space-y-1 text-muted-foreground">
            <li>
              <strong>Balance de Sumas y Saldos</strong>: resumen de débitos,
              créditos y saldos por cuenta
            </li>
            <li>
              <strong>Balance General</strong>: Activo, Pasivo y Patrimonio
            </li>
            <li>
              <strong>Estado de Resultados</strong>: Ingresos menos Gastos =
              Resultado neto
            </li>
            <li>
              <strong>Libro Diario</strong>: todos los asientos en orden
              cronológico
            </li>
            <li>
              <strong>Libro Mayor</strong>: movimientos agrupados por cuenta
            </li>
          </ul>

          <p className="mt-3">
            <strong>Reportes de auditoría:</strong>
          </p>
          <ul className="list-disc pl-6 space-y-1 text-muted-foreground">
            <li>
              <strong>Asientos sin respaldo</strong>: asientos manuales no
              vinculados a documentos
            </li>
            <li>
              <strong>Registro de reversiones</strong>: historial de asientos
              reversados
            </li>
            <li>
              <strong>Trazabilidad</strong>: vínculo entre documentos
              comerciales y asientos
            </li>
          </ul>

          <p className="mt-3">
            <strong>Reportes impositivos:</strong>
          </p>
          <ul className="list-disc pl-6 space-y-1 text-muted-foreground">
            <li>
              <strong>Posicion Mensual de IVA</strong>: calcula el IVA Debito
              Fiscal (ventas) menos el IVA Credito Fiscal (compras) para estimar
              el IVA a pagar o a favor del periodo, con detalle por alicuota
            </li>
          </ul>

          <p className="text-sm text-muted-foreground mt-2">
            Todos los reportes permiten filtrar por rango de fechas y exportar a
            Excel.
          </p>
        </CardContent>
      </Card>

      {/* Cierre de Ejercicio */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CalendarCheck className="h-5 w-5" />
            Cierre de Ejercicio Fiscal
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <ol className="list-decimal pl-6 space-y-2 text-muted-foreground">
            <li>
              Configura las fechas del ejercicio en{' '}
              <strong>Contabilidad → Configuración</strong>
            </li>
            <li>
              Asegúrate de que la <strong>cuenta de resultado</strong> esté
              configurada
            </li>
            <li>
              Ve a <strong>Contabilidad → Cierre de Ejercicio</strong>
            </li>
            <li>
              Revisa la vista previa del asiento de cierre (cancela cuentas de
              resultado)
            </li>
            <li>
              Confirma el cierre: se genera el asiento y el ejercicio queda{' '}
              <strong>cerrado</strong>
            </li>
          </ol>
        </CardContent>
      </Card>

      {/* Configuración */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Settings className="h-5 w-5" />
            Configuración Contable
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p>
            En <strong>Contabilidad → Configuración</strong> se establecen:
          </p>
          <ul className="list-disc pl-6 space-y-1 text-muted-foreground">
            <li>
              <strong>Ejercicio fiscal</strong>: fecha de inicio y fin
            </li>
            <li>
              <strong>Cuentas de integración</strong>: mapeo de cuentas para
              asientos automáticos desde el módulo comercial
            </li>
          </ul>
        </CardContent>
      </Card>

      {/* Presupuestos */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <PiggyBank className="h-5 w-5" />
            Presupuestos
          </CardTitle>
          <CardDescription>
            Control presupuestario por cuenta y período
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <p>
            Los presupuestos permiten definir montos planificados por cuenta
            contable y año fiscal, y luego comparar lo ejecutado vs lo
            presupuestado.
          </p>
          <p>
            <strong>Crear un presupuesto:</strong>
          </p>
          <ol className="list-decimal pl-6 space-y-2 text-muted-foreground">
            <li>
              Ve a <strong>Contabilidad → Presupuestos</strong>
            </li>
            <li>
              Haz clic en <strong>Nuevo Presupuesto</strong>
            </li>
            <li>
              Selecciona la <strong>cuenta contable</strong> a presupuestar
            </li>
            <li>
              Selecciona el <strong>año fiscal</strong>
            </li>
            <li>
              Ingresa los <strong>montos mensuales</strong> (12 meses)
            </li>
            <li>Agrega notas opcionales</li>
            <li>
              Guarda (queda en <strong>Borrador</strong>)
            </li>
          </ol>

          <p className="mt-3">
            <strong>Estados:</strong>
          </p>
          <div className="flex flex-wrap gap-2">
            <Badge variant="secondary">Borrador</Badge>
            <span>→</span>
            <Badge>Activo</Badge>
            <span>→</span>
            <Badge variant="outline">Cerrado</Badge>
          </div>
          <ul className="list-disc pl-6 space-y-1 text-muted-foreground mt-2">
            <li>
              <strong>Borrador</strong>: se puede editar libremente los montos
              mensuales
            </li>
            <li>
              <strong>Activo</strong>: el presupuesto está vigente, se compara
              contra la ejecución real
            </li>
            <li>
              <strong>Cerrado</strong>: el presupuesto fue cerrado al finalizar
              el período
            </li>
          </ul>

          <p className="mt-3">
            <strong>Control de ejecución:</strong>
          </p>
          <ul className="list-disc pl-6 space-y-1 text-muted-foreground">
            <li>
              En el detalle del presupuesto puedes ver mes a mes:{' '}
              <strong>monto presupuestado</strong>,{' '}
              <strong>monto ejecutado</strong> y{' '}
              <strong>porcentaje de ejecución</strong>
            </li>
            <li>
              Los montos ejecutados se calculan automáticamente desde los
              asientos contables registrados en la cuenta
            </li>
          </ul>

          <p className="mt-3">
            <strong>Revisiones:</strong>
          </p>
          <ul className="list-disc pl-6 space-y-1 text-muted-foreground">
            <li>
              Un presupuesto activo puede tener <strong>revisiones</strong> si
              necesitas ajustar los montos
            </li>
            <li>
              Cada revisión registra los nuevos montos y el motivo del ajuste
            </li>
            <li>Se mantiene un historial completo de revisiones</li>
          </ul>
        </CardContent>
      </Card>

      {/* Bloqueo de Períodos */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Lock className="h-5 w-5" />
            Bloqueo de Períodos
          </CardTitle>
          <CardDescription>
            Impedir modificaciones en períodos cerrados
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <p>
            El bloqueo de períodos impide que se registren o modifiquen asientos
            contables en meses ya cerrados, protegiendo la integridad de la
            información contable.
          </p>
          <ol className="list-decimal pl-6 space-y-2 text-muted-foreground">
            <li>
              Ve a <strong>Contabilidad → Configuración</strong>
            </li>
            <li>
              En la sección <strong>Bloqueo de Períodos</strong>, verás una
              grilla con los meses del ejercicio fiscal
            </li>
            <li>
              Cada mes muestra un icono de candado (bloqueado) o candado abierto
              (desbloqueado)
            </li>
            <li>
              Haz clic en el <strong>primer mes desbloqueado</strong> para
              bloquearlo
            </li>
            <li>
              Haz clic en el <strong>último mes bloqueado</strong> para
              desbloquearlo
            </li>
            <li>Confirma la acción en el diálogo</li>
          </ol>
          <p className="text-sm text-muted-foreground mt-2">
            Al bloquear un período, cualquier intento de registrar un asiento
            con fecha dentro de ese período será rechazado por el sistema. El
            bloqueo es progresivo: se bloquean todos los meses hasta el
            seleccionado.
          </p>
        </CardContent>
      </Card>

      {/* Saldos de Apertura */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BookOpenCheck className="h-5 w-5" />
            Saldos de Apertura
          </CardTitle>
          <CardDescription>
            Carga inicial de saldos contables y facturas pendientes
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <p>
            Al comenzar a usar el sistema, puedes cargar los saldos iniciales de
            tus cuentas contables y las facturas pendientes de cobro/pago para
            arrancar con datos reales.
          </p>
          <p>
            <strong>La pantalla de apertura tiene tres pestañas:</strong>
          </p>
          <ul className="list-disc pl-6 space-y-1 text-muted-foreground">
            <li>
              <strong>Saldos de Cuentas</strong>: ingresa el debe y haber de
              cada cuenta contable. El sistema valida que el total del debe sea
              igual al total del haber
            </li>
            <li>
              <strong>Facturas de Venta Pendientes</strong>: carga facturas de
              venta que aún no fueron cobradas (cliente, tipo de comprobante,
              número, fecha, total)
            </li>
            <li>
              <strong>Facturas de Compra Pendientes</strong>: carga facturas de
              compra que aún no fueron pagadas (proveedor, tipo de comprobante,
              número, fecha, total)
            </li>
          </ul>
          <p className="mt-3">
            <strong>Cargar saldos:</strong>
          </p>
          <ol className="list-decimal pl-6 space-y-2 text-muted-foreground">
            <li>
              Ve a <strong>Contabilidad → Saldos de Apertura</strong>
            </li>
            <li>
              Selecciona las cuentas y carga los montos en <strong>Debe</strong>{' '}
              y <strong>Haber</strong>
            </li>
            <li>
              Verifica que el total cuadre (<strong>Debe = Haber</strong>)
            </li>
            <li>Confirma para generar el asiento de apertura</li>
          </ol>
          <p className="text-sm text-muted-foreground mt-2">
            Las facturas de apertura se pueden cargar manualmente una por una o
            importar desde un archivo Excel.
          </p>
        </CardContent>
      </Card>

      {/* Depreciación de Activos Fijos */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingDown className="h-5 w-5" />
            Depreciación de Activos Fijos
          </CardTitle>
          <CardDescription>
            Generación automática de asientos de depreciación
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <p>
            El sistema genera automáticamente asientos contables de
            depreciación para los equipos configurados en el módulo de
            Equipamiento.
          </p>
          <p>
            <strong>Cómo funciona:</strong>
          </p>
          <ul className="list-disc pl-6 space-y-1 text-muted-foreground">
            <li>
              Desde el detalle de un equipo (módulo Equipamiento), se configura
              la <strong>depreciación</strong> con valor de origen, vida útil y
              método
            </li>
            <li>
              El sistema calcula el <strong>plan de depreciación</strong> mes a
              mes
            </li>
            <li>
              Desde Contabilidad, puedes <strong>generar los asientos</strong>{' '}
              de depreciación para el período actual
            </li>
            <li>
              Los asientos se crean automáticamente con las cuentas de
              depreciación configuradas en la integración comercial
            </li>
          </ul>
          <p className="text-sm text-muted-foreground mt-2">
            Los métodos de depreciación disponibles son:{' '}
            <strong>Línea recta</strong> (cuotas iguales) y{' '}
            <strong>Saldo decreciente</strong> (cuotas decrecientes). Consulta
            la guía de Equipamiento para configurar la depreciación en cada
            equipo.
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
              <strong>Comercial</strong>: las facturas de venta y compra generan
              asientos automáticos al confirmarse
            </li>
            <li>
              <strong>Tesorería</strong>: los recibos y órdenes de pago generan
              asientos automáticos al confirmarse
            </li>
            <li>
              <strong>Dashboard</strong>: los reportes contables alimentan
              indicadores financieros
            </li>
            <li>
              <strong>Equipamiento</strong>: la depreciación de activos fijos
              genera asientos contables automáticos
            </li>
            <li>
              <strong>Presupuestos</strong>: los asientos registrados alimentan
              la ejecución presupuestaria automáticamente
            </li>
          </ul>
          <p className="mt-2">
            <strong>Requisito previo</strong>: para que la integración funcione,
            debes configurar las cuentas contables de integración en
            Contabilidad → Configuración.
          </p>
        </AlertDescription>
      </Alert>
    </div>
  );
}
