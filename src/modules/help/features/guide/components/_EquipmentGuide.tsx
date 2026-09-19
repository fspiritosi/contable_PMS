'use client';

import {
  AlertTriangle,
  Calculator,
  FileText,
  Info,
  Plus,
  QrCode,
  Trash2,
  TrendingDown,
  Truck,
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

export function _EquipmentGuide() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold">Equipos</h2>
        <p className="text-muted-foreground">
          Gestión de vehículos y equipos de la empresa, con su depreciación y sus cuentas contables
          de Bienes de Uso
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Plus className="h-5 w-5" />
            Registrar un Equipo o Vehículo
          </CardTitle>
          <CardDescription>Cómo dar de alta un nuevo equipo en el sistema</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <ol className="list-decimal pl-6 space-y-2 text-muted-foreground">
            <li>
              Ve a <strong>Equipos</strong> en el menú lateral (grupo Principal)
            </li>
            <li>
              Haz clic en <strong>Nuevo Equipo</strong>
            </li>
            <li>
              Completa los datos:
              <ul className="list-disc pl-6 mt-1 space-y-1">
                <li>Número interno (obligatorio, único)</li>
                <li>Marca y modelo</li>
                <li>
                  <strong>Tipo de equipo</strong> (define las cuentas contables de Bienes de Uso,
                  ver más abajo)
                </li>
                <li>Dominio/patente</li>
                <li>Año de fabricación</li>
                <li>Número de serie / chasis / motor</li>
                <li>Titular del equipo y tipo de titularidad</li>
                <li>Contratistas (si aplica)</li>
              </ul>
            </li>
            <li>
              Haz clic en <strong>Guardar</strong>
            </li>
          </ol>
          <p className="text-sm text-muted-foreground">
            Las marcas, tipos de equipo, titulares, sectores, tipos operativos y contratistas se
            configuran en <strong>Empresa → Equipos</strong>.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Truck className="h-5 w-5" />
            Lista y Detalle
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p>En la lista de equipos puedes:</p>
          <ul className="list-disc pl-6 space-y-1 text-muted-foreground">
            <li>Ver Todos, solo Vehículos o solo Otros equipos</li>
            <li>Buscar por número interno, dominio, chasis o motor</li>
            <li>Filtrar por estado, condición, tipo, marca y activo/inactivo</li>
            <li>Exportar a Excel</li>
            <li>
              <strong>Contabilizar Depreciaciones</strong> de todos los equipos a la vez (ver
              Depreciación)
            </li>
            <li>
              Dar de baja un equipo desde el menú <strong>(…)</strong> de la fila
            </li>
          </ul>
          <p className="mt-2">El detalle del equipo muestra toda su información en pestañas:</p>
          <ul className="list-disc pl-6 space-y-1 text-muted-foreground">
            <li>
              <strong>Información</strong>: datos técnicos y administrativos
            </li>
            <li>
              <strong>Contrato</strong>: titularidad, fechas, moneda y precio
            </li>
            <li>
              <strong>Asignación</strong>: centro de costo, sector y tipo operativo
            </li>
            <li>
              <strong>Contratistas</strong>: contratistas asociados
            </li>
            <li>
              <strong>Documentos</strong>: documentación del equipo
            </li>
            <li>
              <strong>Depreciación</strong>: valor contable, cuentas de Bienes de Uso, cronograma y
              ajustes de valor
            </li>
            <li>
              <strong>QR</strong>: código QR público (solo equipos activos)
            </li>
          </ul>
          <p className="text-sm text-muted-foreground">
            Desde el encabezado del detalle puedes <strong>Editar</strong> el equipo o darlo de{' '}
            <strong>Baja</strong>.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Documentos del Equipo
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p>Cada equipo tiene documentos asociados, por ejemplo:</p>
          <ul className="list-disc pl-6 space-y-1 text-muted-foreground">
            <li>VTV (Verificación Técnica Vehicular)</li>
            <li>Seguro</li>
            <li>Habilitación</li>
            <li>Otros documentos según el tipo de equipo</li>
          </ul>
          <p className="text-sm text-muted-foreground">
            Los tipos de documento y su vigencia se administran en{' '}
            <strong>Empresa → General → Documentos</strong>. El encabezado del detalle muestra si la
            documentación está completa o cuántos documentos faltan o vencieron.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <QrCode className="h-5 w-5" />
            Código QR Público
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p>
            Cada equipo activo tiene un código QR único que permite acceder a su información
            pública:
          </p>
          <ul className="list-disc pl-6 space-y-1 text-muted-foreground">
            <li>El QR se genera automáticamente al crear el equipo</li>
            <li>
              Cualquier persona puede escanear el QR para ver datos básicos del equipo, sin iniciar
              sesión
            </li>
            <li>
              Desde la pestaña <strong>QR</strong> puedes descargarlo como imagen, imprimirlo o
              copiar el enlace
            </li>
            <li>Ideal para identificación en campo</li>
          </ul>
        </CardContent>
      </Card>

      {/* Depreciación de Equipos */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingDown className="h-5 w-5" />
            Depreciación de Equipos
          </CardTitle>
          <CardDescription>Control del valor contable de tus Bienes de Uso</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <p>
            Cada equipo puede configurarse para calcular automáticamente su depreciación
            (amortización) contable, reflejando la pérdida de valor a lo largo del tiempo.
          </p>

          <p>
            <strong>Configurar depreciación:</strong>
          </p>
          <ol className="list-decimal pl-6 space-y-2 text-muted-foreground">
            <li>
              Ve al <strong>detalle del equipo</strong>
            </li>
            <li>
              Selecciona la pestaña <strong>Depreciación</strong>
            </li>
            <li>
              Haz clic en <strong>Configurar Depreciación</strong>
            </li>
            <li>
              Completa:
              <ul className="list-disc pl-6 mt-1 space-y-1">
                <li>
                  <strong>Valor de origen</strong> (costo de adquisición del equipo)
                </li>
                <li>
                  <strong>Valor residual</strong> (valor estimado al final de la vida útil)
                </li>
                <li>
                  <strong>Vida útil</strong> (en meses, máximo 600 meses / 50 años)
                </li>
                <li>
                  <strong>Fecha de inicio</strong> de la depreciación
                </li>
                <li>
                  <strong>Método de depreciación</strong>:
                  <ul className="list-disc pl-6 mt-1 space-y-1">
                    <li>Línea recta: cuota fija mensual</li>
                    <li>Saldo decreciente: cuota decreciente (requiere indicar tasa)</li>
                  </ul>
                </li>
              </ul>
            </li>
          </ol>

          <p className="mt-3">
            <strong>Plan de depreciación:</strong>
          </p>
          <ul className="list-disc pl-6 space-y-1 text-muted-foreground">
            <li>
              Una vez configurado, el sistema genera el <strong>cronograma</strong> completo mes a
              mes
            </li>
            <li>
              Cada línea del plan muestra: período, fecha, monto, acumulado, valor libro y estado
              (Pendiente / Contabilizado)
            </li>
            <li>Puedes ver el progreso con porcentaje de depreciación completada</li>
          </ul>

          <p className="mt-3">
            <strong>Estados de depreciación:</strong>
          </p>
          <div className="flex flex-wrap gap-2">
            <Badge>Activo</Badge>
            <Badge variant="outline">Completado</Badge>
            <Badge variant="secondary">Suspendido</Badge>
          </div>

          <p className="mt-3">
            <strong>Ajustes de valor:</strong>
          </p>
          <ul className="list-disc pl-6 space-y-1 text-muted-foreground">
            <li>
              Si el valor del equipo cambia (revaluación, deterioro), puedes registrar un{' '}
              <strong>ajuste de valor</strong> con el botón <strong>Ajustar Valor</strong>
            </li>
            <li>Cada ajuste requiere fecha, nuevo valor y motivo</li>
            <li>
              El ajuste genera siempre un asiento contable (la diferencia va a la cuenta
              &quot;Resultado por venta/baja de Bienes de Uso&quot;) y el plan de depreciación se
              recalcula desde el período siguiente
            </li>
            <li>
              Si falta alguna cuenta, el ajuste no se guarda y el mensaje te dice cuál falta y dónde
              cargarla
            </li>
          </ul>
        </CardContent>
      </Card>

      {/* Cuentas contables de Bienes de Uso */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calculator className="h-5 w-5" />
            Cuentas contables de Bienes de Uso
          </CardTitle>
          <CardDescription>
            Con qué cuentas se contabilizan la amortización, los ajustes y la baja de cada equipo
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <p>
            Cada equipo usa tres cuentas contables: <strong>Bienes de Uso</strong> (el valor del
            bien), <strong>Amortización acumulada</strong> y <strong>Gasto de amortización</strong>.
            No son una sola cuenta para toda la empresa: el sistema las busca, en este orden, hasta
            encontrar una cargada.
          </p>
          <ol className="list-decimal pl-6 space-y-2 text-muted-foreground">
            <li>
              <strong>Las del equipo</strong>: en la pestaña Depreciación, card{' '}
              <strong>Cuentas contables</strong> → <strong>Editar cuentas</strong>. Solo hace falta
              cargarlas si este equipo tiene que ir a una cuenta distinta de la de su tipo.
            </li>
            <li>
              <strong>Las del Tipo de Equipo</strong>: en{' '}
              <strong>Empresa → Equipos → Tipos de Equipo</strong>, cada tipo (por ejemplo
              &quot;Rodados&quot; o &quot;Maquinaria&quot;) tiene sus tres cuentas. Es el lugar
              normal para configurarlas: todos los equipos de ese tipo las heredan.
            </li>
            <li>
              <strong>Las por defecto</strong>: en <strong>Contabilidad → Configuración</strong>,
              sección &quot;Bienes de Uso (cuentas por defecto)&quot;. Se usan solo para los equipos
              que no tienen cuenta propia ni de tipo.
            </li>
          </ol>
          <p>
            Cada una de las tres cuentas se resuelve por separado: un equipo puede tener propia solo
            la Amortización acumulada y tomar las otras dos de su tipo.
          </p>

          <p className="mt-3">
            <strong>La card &quot;Cuentas contables&quot;:</strong>
          </p>
          <ul className="list-disc pl-6 space-y-1 text-muted-foreground">
            <li>
              Aparece en la pestaña Depreciación apenas configuras la depreciación, entre el resumen
              y el cronograma
            </li>
            <li>
              Muestra las tres cuentas que el sistema va a usar y, al lado de cada una, de dónde
              salió: &quot;de la depreciación del equipo&quot;, &quot;del tipo de equipo
              «Rodados»&quot; o &quot;por defecto (Ajustes contables)&quot;
            </li>
            <li>
              Si alguna no se puede resolver, la fila dice en rojo{' '}
              <em>
                Sin cuenta — asignala acá, en el tipo de equipo «…» o en Contabilidad →
                Configuración
              </em>
            </li>
            <li>
              Con <strong>Editar cuentas</strong> puedes asignar una cuenta propia a este equipo o
              dejar &quot;Sin asignar&quot; para volver a usar la del tipo o la por defecto
            </li>
          </ul>

          <Alert>
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              <strong>Cambiar una cuenta con períodos ya contabilizados.</strong> Si el equipo (o el
              tipo) ya tiene amortizaciones contabilizadas, al cambiar una cuenta aparece un aviso
              naranja: los asientos anteriores <strong>no se modifican</strong>; los próximos
              períodos y la baja usan la cuenta nueva, y el saldo acumulado hasta ese momento queda
              en la anterior. Si hace falta, el contador lo reclasifica con un asiento manual.
            </AlertDescription>
          </Alert>

          <Alert>
            <Info className="h-4 w-4" />
            <AlertDescription>
              <strong>La compra del bien entra por el ítem.</strong> Cuando compras un equipo con
              una factura de compra, el asiento lo imputa a la cuenta del <strong>ítem</strong>{' '}
              (Ítems → Imputación contable). El equipo se carga aparte, y para que el rubro cierre,
              la cuenta de Bienes de Uso del tipo (o del equipo) tiene que ser la misma a la que se
              imputó la compra. El sistema no genera un segundo asiento de alta al configurar la
              depreciación.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>

      {/* Contabilizar la amortización */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calculator className="h-5 w-5" />
            Contabilizar la amortización
          </CardTitle>
          <CardDescription>Cómo se generan los asientos, uno por uno o en lote</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <p>
            <strong>Un período de un equipo:</strong> en la pestaña Depreciación, cada período
            pendiente del cronograma tiene el botón <strong>Contabilizar</strong>. Genera el asiento
            del mes (Debe: Gasto de amortización / Haber: Amortización acumulada) con las cuentas de
            la card &quot;Cuentas contables&quot; y marca el período como Contabilizado. Los
            períodos se contabilizan en orden.
          </p>
          <p>
            <strong>Todos los equipos a la vez:</strong> en el listado de Equipos, el botón{' '}
            <strong>Contabilizar Depreciaciones</strong> abre un diálogo donde eliges hasta qué
            fecha contabilizar. Muestra cuántos períodos y equipos abarca y el monto total.
          </p>
          <ul className="list-disc pl-6 space-y-1 text-muted-foreground">
            <li>
              Si a algún equipo le faltan cuentas, <strong>antes</strong> de confirmar aparece un
              aviso naranja: &quot;Estos equipos se van a omitir por falta de cuentas
              contables&quot;, con el detalle de cada uno
            </li>
            <li>
              Al confirmar, los equipos con cuentas se contabilizan; los que no, se omiten y quedan
              listados en rojo con su motivo. Los demás no se frenan por ellos
            </li>
          </ul>

          <Alert>
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              <strong>Si falta una cuenta, no se contabiliza.</strong> El sistema nunca genera un
              asiento incompleto ni omite el asiento en silencio. El mensaje nombra el equipo, qué
              cuenta falta y los tres lugares donde puedes cargarla (la depreciación del equipo, el
              tipo de equipo o las cuentas por defecto). Carga la cuenta y vuelve a contabilizar. Lo
              mismo pasa si el período contable está cerrado (Contabilidad → Configuración → Bloqueo
              de Períodos).
            </AlertDescription>
          </Alert>

          <p className="text-sm text-muted-foreground">
            Los asientos quedan en <strong>Contabilidad → Asientos</strong> con la descripción
            &quot;Depreciación período N: Equipo …&quot;, en estado Borrador; hay que{' '}
            <strong>Registrarlos</strong> para que sumen en el Mayor y el Balance.
          </p>
        </CardContent>
      </Card>

      {/* Dar de baja */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Trash2 className="h-5 w-5" />
            Dar de baja un equipo
          </CardTitle>
          <CardDescription>Motivos de baja y su asiento contable</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <p>
            La baja se hace desde el botón <strong>Baja</strong> del detalle o desde el menú{' '}
            <strong>(…)</strong> del listado. Se elige el motivo:
          </p>
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline">Venta</Badge>
            <Badge variant="outline">Destrucción Total</Badge>
            <Badge variant="outline">Devolución</Badge>
            <Badge variant="outline">Otro</Badge>
          </div>
          <ul className="list-disc pl-6 space-y-1 text-muted-foreground">
            <li>
              <strong>Venta, Destrucción Total y Devolución</strong> generan un asiento de baja: se
              da de baja el valor del bien (Haber: Bienes de Uso), se cancela lo amortizado (Debe:
              Amortización acumulada) y el valor libro no amortizado va a la cuenta &quot;Resultado
              por venta/baja de Bienes de Uso&quot; de Contabilidad → Configuración
            </li>
            <li>
              <strong>Otro</strong> no genera asiento
            </li>
            <li>
              Un equipo <strong>sin depreciación configurada</strong> se da de baja sin asiento,
              cualquiera sea el motivo
            </li>
          </ul>
          <p>
            El diálogo te avisa <strong>antes</strong> de confirmar qué va a pasar: lista las
            cuentas con las que se va a generar el asiento (y de dónde sale cada una), o dice
            &quot;no genera asiento contable&quot;, o advierte en naranja &quot;La baja va a fallar:
            falta la cuenta de …&quot;. Si falta una cuenta, la baja <strong>no se hace</strong>: el
            equipo sigue activo y el mensaje te dice dónde cargarla.
          </p>
          <p className="text-sm text-muted-foreground">
            Al darlo de baja, el equipo pasa a Inactivo, su depreciación queda Completada y
            desaparece de los períodos pendientes. Un equipo dado de baja puede reactivarse desde el
            listado (filtro Activo → No).
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
              <strong>Empresa → Equipos</strong>: marcas, titulares, sectores, tipos operativos y
              contratistas. <strong>Tipos de Equipo</strong> define además las cuentas contables de
              Bienes de Uso de cada tipo
            </li>
            <li>
              <strong>Empresa → Módulos</strong>: el módulo Equipos se puede activar o desactivar
              por empresa; al desactivarlo desaparecen el menú Equipos y los catálogos de Empresa →
              Equipos
            </li>
            <li>
              <strong>Empresa → Roles</strong>: los permisos de Equipos y de Tipos de Equipo se
              otorgan por rol (Ver, Crear, Editar, Eliminar). Contabilizar y editar cuentas requiere
              Editar; dar de baja requiere Eliminar
            </li>
            <li>
              <strong>Contabilidad</strong>: la amortización, los ajustes de valor y la baja generan
              asientos automáticos en Borrador; las cuentas por defecto y la de Resultado por
              venta/baja se cargan en Contabilidad → Configuración; los informes &quot;Registro de
              Bienes de Uso&quot; y &quot;Depreciaciones del Período&quot; están en Contabilidad →
              Informes
            </li>
            <li>
              <strong>Comercial → Ítems</strong>: la compra del bien entra a Bienes de Uso por la
              cuenta del ítem de la factura de compra
            </li>
          </ul>
        </AlertDescription>
      </Alert>
    </div>
  );
}
