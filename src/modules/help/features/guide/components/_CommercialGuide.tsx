'use client';

import {
  ArrowLeftRight,
  Banknote,
  ClipboardList,
  Contact,
  FileSpreadsheet,
  FileText,
  Info,
  Package,
  PackageCheck,
  Receipt,
  ShoppingBag,
  ShoppingCart,
  Store,
  Tags,
  UserSearch,
  Users,
  Warehouse,
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

export function _CommercialGuide() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold">Comercial</h2>
        <p className="text-muted-foreground">
          CRM, productos, facturación de ventas y compras
        </p>
      </div>

      {/* Clientes y Proveedores */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            Clientes y Proveedores
          </CardTitle>
          <CardDescription>Gestión de tu cartera comercial</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <p>
            <strong>Clientes</strong> y <strong>Proveedores</strong> comparten
            una estructura similar:
          </p>
          <ol className="list-decimal pl-6 space-y-2 text-muted-foreground">
            <li>
              Ve a <strong>Comercial → Clientes</strong> o{' '}
              <strong>Proveedores</strong>
            </li>
            <li>
              Haz clic en <strong>Nuevo</strong>
            </li>
            <li>
              Completa los datos:
              <ul className="list-disc pl-6 mt-1 space-y-1">
                <li>Razón social / nombre (obligatorio)</li>
                <li>CUIT</li>
                <li>Condición ante IVA</li>
                <li>Email, teléfono, dirección</li>
                <li>Plazo de pago (días)</li>
                <li>Límite de crédito</li>
                <li>Lista de precios (clientes)</li>
              </ul>
            </li>
          </ol>
          <p className="mt-2">
            El <strong>detalle</strong> del cliente incluye pestañas:
          </p>
          <ul className="list-disc pl-6 space-y-1 text-muted-foreground">
            <li>
              <strong>General</strong>: datos de contacto y persona de contacto
            </li>
            <li>
              <strong>Vehículos</strong>: equipos asignados al cliente
            </li>
            <li>
              <strong>Empleados</strong>: personal asignado al cliente
            </li>
            <li>
              <strong>Cuenta Corriente</strong>: facturas, cobros/pagos, saldo
            </li>
          </ul>
        </CardContent>
      </Card>

      {/* Productos */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Package className="h-5 w-5" />
            Productos
          </CardTitle>
          <CardDescription>
            Catálogo de productos y servicios
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <ol className="list-decimal pl-6 space-y-2 text-muted-foreground">
            <li>
              Ve a <strong>Comercial → Productos</strong>
            </li>
            <li>
              Haz clic en <strong>Nuevo Producto</strong>
            </li>
            <li>
              Completa:
              <ul className="list-disc pl-6 mt-1 space-y-1">
                <li>Código (único)</li>
                <li>Nombre y descripción</li>
                <li>Categoría (estructura de árbol)</li>
                <li>Unidad de medida</li>
                <li>Precio de venta (sin IVA y con IVA)</li>
                <li>Alícuota de IVA</li>
                <li>Código de barras (opcional)</li>
                <li>¿Controla stock?: activa seguimiento en almacenes</li>
              </ul>
            </li>
          </ol>
          <p className="text-sm text-muted-foreground">
            Si activas el control de stock, el producto se gestiona desde{' '}
            <strong>Almacenes</strong>.
          </p>

          <p className="mt-3">
            <strong>Categorías de Productos:</strong>
          </p>
          <ul className="list-disc pl-6 space-y-1 text-muted-foreground">
            <li>
              Desde <strong>Comercial → Categorías</strong> puedes organizar los
              productos en una estructura de árbol jerárquico
            </li>
            <li>
              Cada categoría puede tener <strong>subcategorías</strong>{' '}
              (categoría padre/hijo)
            </li>
            <li>
              Al crear o editar un producto, selecciona la categoría
              correspondiente
            </li>
          </ul>
        </CardContent>
      </Card>

      {/* Listas de Precios */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Tags className="h-5 w-5" />
            Listas de Precios
          </CardTitle>
          <CardDescription>
            Precios diferenciados para tus clientes
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <p>
            Las listas de precios permiten definir precios especiales por
            producto, que se aplican automáticamente al facturar según el
            cliente.
          </p>
          <p>
            <strong>Crear una lista de precios:</strong>
          </p>
          <ol className="list-decimal pl-6 space-y-2 text-muted-foreground">
            <li>
              Ve a <strong>Comercial → Listas de Precios</strong>
            </li>
            <li>
              Haz clic en <strong>Nueva Lista</strong>
            </li>
            <li>
              Ingresa el <strong>nombre</strong> y opcionalmente una{' '}
              <strong>descripción</strong>
            </li>
            <li>
              Marca como <strong>lista por defecto</strong> si corresponde
            </li>
            <li>
              En el <strong>detalle</strong> de la lista, agrega productos con
              su precio especial
            </li>
          </ol>

          <p className="mt-3">
            Cada ítem de la lista tiene:
          </p>
          <ul className="list-disc pl-6 space-y-1 text-muted-foreground">
            <li>
              <strong>Producto</strong>: selecciona del catálogo
            </li>
            <li>
              <strong>Precio sin IVA</strong>: el precio especial para esta
              lista
            </li>
            <li>
              <strong>Precio con IVA</strong>: se calcula automáticamente según
              la alícuota del producto
            </li>
          </ul>

          <p className="text-sm text-muted-foreground mt-3">
            Al asignar una lista de precios a un cliente, las facturas de venta
            usarán automáticamente los precios de esa lista.
          </p>
        </CardContent>
      </Card>

      {/* Facturas de Venta */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShoppingBag className="h-5 w-5" />
            Facturas de Venta
          </CardTitle>
          <CardDescription>
            Emisión y gestión de comprobantes de venta
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <p>
            <strong>Crear una factura:</strong>
          </p>
          <ol className="list-decimal pl-6 space-y-2 text-muted-foreground">
            <li>
              Ve a <strong>Comercial → Facturas</strong> y haz clic en{' '}
              <strong>Nueva Factura</strong>
            </li>
            <li>Selecciona el <strong>cliente</strong></li>
            <li>
              Selecciona el <strong>punto de venta</strong> y{' '}
              <strong>tipo de comprobante</strong>:
              <ul className="list-disc pl-6 mt-1 space-y-1">
                <li>Factura A, B o C</li>
                <li>Nota de Crédito A, B o C</li>
                <li>Nota de Débito A, B o C</li>
              </ul>
            </li>
            <li>Indica la <strong>fecha de emisión</strong> y opcionalmente el <strong>vencimiento</strong></li>
            <li>
              Agrega <strong>líneas de productos</strong>: producto, cantidad,
              precio unitario, alícuota IVA
            </li>
            <li>
              El sistema calcula automáticamente subtotal, IVA y total
            </li>
            <li>
              Haz clic en <strong>Guardar</strong> (queda en Borrador)
            </li>
          </ol>

          <p className="mt-3">
            <strong>Estados de la factura:</strong>
          </p>
          <div className="flex flex-wrap gap-2">
            <Badge variant="secondary">Borrador</Badge>
            <span>→</span>
            <Badge>Confirmada</Badge>
            <span>→</span>
            <Badge variant="outline">Cobrada / Parcial</Badge>
          </div>
          <ul className="list-disc pl-6 space-y-1 text-muted-foreground mt-2">
            <li>
              <strong>Borrador</strong>: se puede editar y modificar
            </li>
            <li>
              <strong>Confirmada</strong>: ya no se puede editar, genera asiento
              contable automático
            </li>
            <li>
              <strong>Cobrada / Parcialmente cobrada</strong>: según los recibos
              aplicados
            </li>
            <li>
              Se puede <strong>cancelar</strong> una factura confirmada
            </li>
          </ul>

          <p className="mt-3 text-sm text-muted-foreground">
            Para notas de crédito/débito, al seleccionar el tipo se habilita el
            campo <strong>Factura original</strong> que vincula ambos
            comprobantes.
          </p>
        </CardContent>
      </Card>

      {/* Facturas de Compra */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShoppingCart className="h-5 w-5" />
            Facturas de Compra
          </CardTitle>
          <CardDescription>
            Registro de comprobantes de proveedores
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <p>
            Las facturas de compra funcionan de manera similar a las de venta:
          </p>
          <ul className="list-disc pl-6 space-y-1 text-muted-foreground">
            <li>Se vinculan a un <strong>proveedor</strong></li>
            <li>Mismos tipos de comprobante (A, B, C, NC, ND)</li>
            <li>Mismo flujo: Borrador → Confirmada → Pagada</li>
            <li>Se puede indicar el <strong>número de comprobante</strong> del proveedor</li>
            <li>Al confirmar, genera asiento contable automático</li>
          </ul>
          <p className="text-sm text-muted-foreground mt-2">
            Los pagos se registran desde <strong>Tesorería → Órdenes de
            Pago</strong>.
          </p>
        </CardContent>
      </Card>

      {/* Cuenta Corriente */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Receipt className="h-5 w-5" />
            Cuenta Corriente
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p>
            La cuenta corriente muestra el resumen financiero de un cliente o
            proveedor:
          </p>
          <ul className="list-disc pl-6 space-y-1 text-muted-foreground">
            <li>
              <strong>Total facturado</strong>: suma de todas las facturas
              confirmadas
            </li>
            <li>
              <strong>Total cobrado/pagado</strong>: suma de recibos/órdenes de
              pago
            </li>
            <li>
              <strong>Saldo</strong>: diferencia (lo que se debe o nos deben)
            </li>
            <li>Detalle de cada factura con su estado de cobro/pago</li>
            <li>
              Links directos a recibos y notas de crédito aplicadas
            </li>
          </ul>
        </CardContent>
      </Card>

      {/* Reportes */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Reportes de Ventas y Compras
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p>Desde la sección de reportes puedes:</p>
          <ul className="list-disc pl-6 space-y-1 text-muted-foreground">
            <li>
              <strong>Reporte de Ventas</strong>: facturas emitidas por período,
              con totales y filtros
            </li>
            <li>
              <strong>Reporte de Compras</strong>: facturas de compra por
              período
            </li>
            <li>Exportar ambos reportes a Excel</li>
          </ul>
        </CardContent>
      </Card>

      {/* Órdenes de Compra */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ClipboardList className="h-5 w-5" />
            Órdenes de Compra
          </CardTitle>
          <CardDescription>
            Solicitudes de compra a proveedores
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <p>
            Las órdenes de compra (OC) permiten formalizar un pedido a un
            proveedor antes de recibir la mercadería o la factura.
          </p>
          <p>
            <strong>Crear una orden de compra:</strong>
          </p>
          <ol className="list-decimal pl-6 space-y-2 text-muted-foreground">
            <li>
              Ve a <strong>Comercial → Compras → Órdenes de Compra</strong>
            </li>
            <li>
              Haz clic en <strong>Nueva Orden de Compra</strong>
            </li>
            <li>
              Selecciona el <strong>proveedor</strong>
            </li>
            <li>
              Indica la <strong>fecha de emisión</strong> y opcionalmente la{' '}
              <strong>fecha de entrega esperada</strong>
            </li>
            <li>
              Agrega <strong>líneas de productos</strong>: descripción,
              cantidad, costo unitario, alícuota IVA
            </li>
            <li>
              Opcionalmente, configura <strong>cuotas de pago</strong>{' '}
              (semanal, quincenal o mensual)
            </li>
            <li>
              Agrega <strong>condiciones de pago</strong>,{' '}
              <strong>dirección de entrega</strong> y <strong>notas</strong> si
              corresponde
            </li>
            <li>
              Haz clic en <strong>Guardar</strong> (queda en Borrador)
            </li>
          </ol>

          <p className="mt-3">
            <strong>Estados:</strong>
          </p>
          <div className="flex flex-wrap gap-2">
            <Badge variant="secondary">Borrador</Badge>
            <span>→</span>
            <Badge variant="outline">Pendiente de Aprobación</Badge>
            <span>→</span>
            <Badge>Aprobada</Badge>
            <span>→</span>
            <Badge>Recibida Parcialmente</Badge>
            <span>→</span>
            <Badge>Completada</Badge>
          </div>
          <div className="flex flex-wrap gap-2 mt-1">
            <Badge variant="destructive">Cancelada</Badge>
          </div>
          <ul className="list-disc pl-6 space-y-1 text-muted-foreground mt-2">
            <li>
              <strong>Borrador</strong>: se puede editar libremente
            </li>
            <li>
              <strong>Pendiente de Aprobación</strong>: requiere aprobación para
              continuar
            </li>
            <li>
              <strong>Aprobada</strong>: lista para recibir mercadería
            </li>
            <li>
              <strong>Recibida Parcialmente</strong>: se generaron remitos
              parciales
            </li>
            <li>
              <strong>Completada</strong>: toda la mercadería fue recibida
            </li>
            <li>
              <strong>Cancelada</strong>: la OC fue anulada
            </li>
          </ul>

          <p className="text-sm text-muted-foreground mt-3">
            Desde el detalle de la OC puedes vincular facturas de compra y ver
            el estado de facturación (Sin facturar, Parcialmente facturada,
            Totalmente facturada).
          </p>
        </CardContent>
      </Card>

      {/* Remitos de Recepción */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <PackageCheck className="h-5 w-5" />
            Remitos de Recepción
          </CardTitle>
          <CardDescription>
            Registro de mercadería recibida de proveedores
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <p>
            Los remitos registran la recepción física de productos en un
            almacén. Pueden crearse desde una orden de compra o de forma
            independiente.
          </p>
          <p>
            <strong>Crear un remito:</strong>
          </p>
          <ol className="list-decimal pl-6 space-y-2 text-muted-foreground">
            <li>
              Ve a{' '}
              <strong>Comercial → Compras → Remitos de Recepción</strong>
            </li>
            <li>
              Haz clic en <strong>Nuevo Remito</strong>
            </li>
            <li>
              Selecciona el <strong>proveedor</strong>
            </li>
            <li>
              Selecciona el <strong>almacén</strong> donde se recibirá la
              mercadería
            </li>
            <li>
              Opcionalmente, vincula a una{' '}
              <strong>Orden de Compra</strong> o{' '}
              <strong>Factura de Compra</strong> (no ambas)
            </li>
            <li>
              Indica la <strong>fecha de recepción</strong>
            </li>
            <li>
              Agrega las <strong>líneas</strong>: producto, cantidad recibida,
              notas
            </li>
            <li>
              Haz clic en <strong>Guardar</strong> (queda en Borrador)
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
          <div className="flex flex-wrap gap-2 mt-1">
            <Badge variant="destructive">Anulado</Badge>
          </div>
          <ul className="list-disc pl-6 space-y-1 text-muted-foreground mt-2">
            <li>
              <strong>Borrador</strong>: se puede editar
            </li>
            <li>
              <strong>Confirmado</strong>: se actualiza el stock del almacén
              automáticamente
            </li>
            <li>
              <strong>Anulado</strong>: se revierten los movimientos de stock
            </li>
          </ul>

          <p className="text-sm text-muted-foreground mt-3">
            Al confirmar un remito vinculado a una OC, se actualizan las
            cantidades recibidas en la orden y su estado puede pasar a Recibida
            Parcialmente o Completada.
          </p>
        </CardContent>
      </Card>

      {/* Remitos de Entrega */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Package className="h-5 w-5" />
            Remitos de Entrega
          </CardTitle>
          <CardDescription>
            Registro de mercadería entregada a clientes
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <p>
            Los remitos de entrega registran la salida de productos de un
            almacén hacia un cliente. Al crear el remito, se descuenta el
            stock automáticamente.
          </p>
          <p>
            <strong>Crear un remito de entrega:</strong>
          </p>
          <ol className="list-decimal pl-6 space-y-2 text-muted-foreground">
            <li>
              Ve a{' '}
              <strong>Comercial → Ventas → Remitos de Entrega</strong>
            </li>
            <li>
              Haz clic en <strong>Nuevo Remito</strong>
            </li>
            <li>
              Selecciona el <strong>cliente</strong>
            </li>
            <li>
              Selecciona el <strong>almacén</strong> de donde sale la mercadería
            </li>
            <li>
              Indica la <strong>fecha de entrega</strong>
            </li>
            <li>
              Agrega las <strong>líneas</strong>: busca el producto, indica cantidad y notas
            </li>
            <li>
              Haz clic en <strong>Crear Remito</strong> (se descuenta stock inmediatamente)
            </li>
          </ol>

          <p className="mt-3">
            <strong>Estados:</strong>
          </p>
          <div className="flex flex-wrap gap-2">
            <Badge variant="secondary">Pendiente de Entrega</Badge>
            <span>→</span>
            <Badge variant="success">Aceptado</Badge>
            <span>→</span>
            <Badge className="bg-blue-600">Facturado</Badge>
          </div>
          <div className="flex flex-wrap gap-2 mt-1">
            <Badge variant="destructive">Anulado</Badge>
          </div>
          <ul className="list-disc pl-6 space-y-1 text-muted-foreground mt-2">
            <li>
              <strong>Pendiente de Entrega</strong>: se puede editar (ej: si el
              cliente rechaza un producto). Al editar se recalcula el stock
            </li>
            <li>
              <strong>Aceptado</strong>: el cliente aceptó la mercadería. Listo
              para facturar
            </li>
            <li>
              <strong>Facturado</strong>: se generó una factura de venta desde
              este remito
            </li>
            <li>
              <strong>Anulado</strong>: se revierten los movimientos de stock
            </li>
          </ul>

          <p className="mt-3">
            <strong>Facturar remitos:</strong>
          </p>
          <ol className="list-decimal pl-6 space-y-2 text-muted-foreground">
            <li>
              Desde la lista de remitos, haz clic en{' '}
              <strong>Facturar Remitos</strong>
            </li>
            <li>
              Selecciona un <strong>cliente</strong> (solo muestra clientes con
              remitos aceptados)
            </li>
            <li>
              Marca los <strong>remitos a facturar</strong> (pueden ser varios)
            </li>
            <li>
              Haz clic en <strong>Facturar</strong>: se crea una factura de venta
              en borrador con las líneas combinadas
            </li>
          </ol>

          <p className="text-sm text-muted-foreground mt-3">
            También puedes ver los remitos de un cliente desde su ficha en{' '}
            <strong>Clientes → [Cliente] → Remitos</strong>.
          </p>
        </CardContent>
      </Card>

      {/* Almacenes */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Warehouse className="h-5 w-5" />
            Almacenes
          </CardTitle>
          <CardDescription>
            Gestión de depósitos y ubicaciones de stock
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <p>
            <strong>Crear un almacén:</strong>
          </p>
          <ol className="list-decimal pl-6 space-y-2 text-muted-foreground">
            <li>
              Ve a <strong>Comercial → Almacenes</strong>
            </li>
            <li>
              Haz clic en <strong>Nuevo Almacén</strong>
            </li>
            <li>
              Completa:
              <ul className="list-disc pl-6 mt-1 space-y-1">
                <li>Código (único)</li>
                <li>Nombre</li>
                <li>
                  Tipo: Principal, Sucursal, En Tránsito o Virtual
                </li>
                <li>Dirección, ciudad, provincia (opcionales)</li>
              </ul>
            </li>
          </ol>

          <p className="mt-3">
            El <strong>detalle</strong> del almacén muestra:
          </p>
          <ul className="list-disc pl-6 space-y-1 text-muted-foreground">
            <li>
              <strong>Stock</strong>: productos almacenados con cantidad total,
              reservada y disponible
            </li>
            <li>
              <strong>Movimientos</strong>: historial de entradas, salidas,
              transferencias y ajustes
            </li>
          </ul>

          <p className="text-sm text-muted-foreground mt-3">
            Solo los productos con la opción &quot;Controla stock&quot; activada
            aparecen en los almacenes.
          </p>
        </CardContent>
      </Card>

      {/* Stock y Movimientos */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ArrowLeftRight className="h-5 w-5" />
            Stock y Movimientos
          </CardTitle>
          <CardDescription>
            Control de inventario y trazabilidad de movimientos
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <p>
            Desde <strong>Comercial → Stock</strong> puedes consultar el
            inventario global:
          </p>
          <ul className="list-disc pl-6 space-y-1 text-muted-foreground">
            <li>
              <strong>Por Producto</strong>: stock total de un producto en todos
              los almacenes
            </li>
            <li>
              <strong>Por Almacén</strong>: stock de todos los productos en un
              almacén específico
            </li>
          </ul>

          <p className="mt-3">
            <strong>Tipos de movimiento de stock:</strong>
          </p>
          <ul className="list-disc pl-6 space-y-1 text-muted-foreground">
            <li>
              <strong>Compra</strong>: entrada automática al confirmar remitos
              de recepción
            </li>
            <li>
              <strong>Venta</strong>: salida automática al confirmar facturas
              con control de stock
            </li>
            <li>
              <strong>Ajuste</strong>: corrección manual de cantidades (positivo
              o negativo)
            </li>
            <li>
              <strong>Transferencia Salida / Entrada</strong>: mover stock
              entre almacenes
            </li>
            <li>
              <strong>Devolución</strong>: productos devueltos
            </li>
            <li>
              <strong>Pérdida/Merma</strong>: registrar pérdidas de inventario
            </li>
          </ul>

          <p className="text-sm text-muted-foreground mt-3">
            Las <strong>transferencias</strong> y <strong>ajustes</strong>{' '}
            manuales se realizan desde{' '}
            <strong>Comercial → Movimientos de Stock</strong> usando los botones
            correspondientes.
          </p>
        </CardContent>
      </Card>

      {/* Gastos */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Banknote className="h-5 w-5" />
            Gastos
          </CardTitle>
          <CardDescription>
            Registro de gastos operativos del negocio
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <p>
            Los gastos permiten registrar erogaciones del negocio que no se
            vinculan a una factura de compra (alquileres, servicios, viáticos,
            etc.).
          </p>
          <p>
            <strong>Crear un gasto:</strong>
          </p>
          <ol className="list-decimal pl-6 space-y-2 text-muted-foreground">
            <li>
              Ve a <strong>Comercial → Gastos</strong>
            </li>
            <li>
              Haz clic en <strong>Nuevo Gasto</strong>
            </li>
            <li>
              Completa:
              <ul className="list-disc pl-6 mt-1 space-y-1">
                <li>Descripción (obligatorio)</li>
                <li>Monto</li>
                <li>Fecha</li>
                <li>Fecha de vencimiento (opcional)</li>
                <li>Categoría de gasto (obligatorio)</li>
                <li>Proveedor (opcional)</li>
                <li>Notas (opcional)</li>
              </ul>
            </li>
            <li>Puedes adjuntar comprobantes (fotos, PDFs)</li>
          </ol>

          <p className="mt-3">
            <strong>Estados:</strong>
          </p>
          <div className="flex flex-wrap gap-2">
            <Badge variant="secondary">Borrador</Badge>
            <span>→</span>
            <Badge>Confirmado</Badge>
            <span>→</span>
            <Badge variant="outline">Parcialmente pagado</Badge>
            <span>→</span>
            <Badge>Pagado</Badge>
          </div>
          <div className="flex flex-wrap gap-2 mt-1">
            <Badge variant="destructive">Anulado</Badge>
          </div>
          <ul className="list-disc pl-6 space-y-1 text-muted-foreground mt-2">
            <li>
              <strong>Borrador</strong>: se puede editar
            </li>
            <li>
              <strong>Confirmado</strong>: el gasto está registrado, pendiente
              de pago
            </li>
            <li>
              <strong>Parcialmente pagado</strong>: se aplicó un pago parcial
              vía orden de pago
            </li>
            <li>
              <strong>Pagado</strong>: el gasto fue pagado completamente
            </li>
          </ul>

          <p className="text-sm text-muted-foreground mt-3">
            Las <strong>categorías de gasto</strong> se gestionan desde el botón
            de configuración en la lista de gastos. Los pagos se registran desde{' '}
            <strong>Tesorería → Órdenes de Pago</strong> donde puedes
            seleccionar gastos pendientes.
          </p>
        </CardContent>
      </Card>

      {/* Puntos de Venta */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Store className="h-5 w-5" />
            Puntos de Venta
          </CardTitle>
          <CardDescription>
            Configuración de puntos de emisión de comprobantes
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <p>
            Los puntos de venta definen desde dónde se emiten comprobantes de
            venta (facturas, notas de crédito, notas de débito).
          </p>
          <p>
            <strong>Configurar un punto de venta:</strong>
          </p>
          <ol className="list-decimal pl-6 space-y-2 text-muted-foreground">
            <li>
              Ve a <strong>Comercial → Puntos de Venta</strong>
            </li>
            <li>
              Haz clic en <strong>Nuevo Punto de Venta</strong>
            </li>
            <li>
              Completa:
              <ul className="list-disc pl-6 mt-1 space-y-1">
                <li>Número del punto de venta (ej: 0001)</li>
                <li>Nombre descriptivo</li>
                <li>
                  Tipos de comprobante habilitados (Factura A, B, C, NC, ND)
                </li>
              </ul>
            </li>
            <li>
              La <strong>numeración</strong> de comprobantes es automática y
              secuencial por tipo
            </li>
          </ol>

          <p className="text-sm text-muted-foreground mt-3">
            Al crear una factura de venta, debes seleccionar un punto de venta.
            El sistema asigna automáticamente el siguiente número de comprobante
            disponible.
          </p>
        </CardContent>
      </Card>

      {/* CRM - Contactos */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Contact className="h-5 w-5" />
            CRM - Contactos
          </CardTitle>
          <CardDescription>
            Personas de contacto de tu cartera comercial
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <p>
            Los contactos representan personas individuales asociadas a
            clientes, proveedores o leads. Permiten registrar a las personas
            con las que interactúas comercialmente.
          </p>
          <ol className="list-decimal pl-6 space-y-2 text-muted-foreground">
            <li>
              Ve a <strong>Comercial → CRM → Contactos</strong>
            </li>
            <li>
              Haz clic en <strong>Nuevo Contacto</strong>
            </li>
            <li>
              Completa:
              <ul className="list-disc pl-6 mt-1 space-y-1">
                <li>Nombre y apellido (obligatorio)</li>
                <li>Email</li>
                <li>Teléfono</li>
                <li>Cargo/posición</li>
                <li>
                  Vinculación: puede asociarse a un cliente (contratista) o a
                  un lead
                </li>
              </ul>
            </li>
          </ol>
          <p className="text-sm text-muted-foreground">
            Los contactos se vinculan automáticamente al crear leads con
            persona de contacto.
          </p>
        </CardContent>
      </Card>

      {/* CRM - Leads */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <UserSearch className="h-5 w-5" />
            CRM - Leads (Oportunidades)
          </CardTitle>
          <CardDescription>
            Seguimiento de oportunidades comerciales
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <p>
            Los leads representan potenciales clientes que aún no forman parte
            de tu cartera. Puedes hacer seguimiento de cada oportunidad hasta
            su conversión.
          </p>
          <ol className="list-decimal pl-6 space-y-2 text-muted-foreground">
            <li>
              Ve a <strong>Comercial → CRM → Leads</strong>
            </li>
            <li>
              Haz clic en <strong>Nuevo Lead</strong>
            </li>
            <li>
              Completa:
              <ul className="list-disc pl-6 mt-1 space-y-1">
                <li>Nombre de la empresa/persona (obligatorio)</li>
                <li>CUIT</li>
                <li>Email y teléfono</li>
                <li>Dirección</li>
                <li>Notas / observaciones</li>
                <li>Contacto asociado (opcional)</li>
              </ul>
            </li>
          </ol>

          <p className="mt-3">
            <strong>Estados:</strong>
          </p>
          <div className="flex flex-wrap gap-2">
            <Badge variant="secondary">Nuevo</Badge>
            <span>→</span>
            <Badge variant="outline">Contactado</Badge>
            <span>→</span>
            <Badge>En Negociación</Badge>
            <span>→</span>
            <Badge>Convertido</Badge>
          </div>
          <div className="flex flex-wrap gap-2 mt-1">
            <Badge variant="destructive">Rechazado / Inactivo</Badge>
          </div>
          <ul className="list-disc pl-6 space-y-1 text-muted-foreground mt-2">
            <li>
              <strong>Nuevo</strong>: lead recién registrado
            </li>
            <li>
              <strong>Contactado</strong>: se estableció primer contacto
            </li>
            <li>
              <strong>En Negociación</strong>: hay una propuesta o cotización
              en curso
            </li>
            <li>
              <strong>Convertido</strong>: el lead se convirtió en cliente (se
              crea automáticamente el registro de cliente)
            </li>
            <li>
              <strong>Rechazado / Inactivo</strong>: la oportunidad no prosperó
            </li>
          </ul>
          <p className="text-sm text-muted-foreground mt-3">
            Al convertir un lead, el sistema crea automáticamente un registro
            de cliente con los datos del lead.
          </p>
        </CardContent>
      </Card>

      {/* CRM - Cotizaciones */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5" />
            CRM - Cotizaciones
          </CardTitle>
          <CardDescription>
            Propuestas comerciales para clientes y leads
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <p>
            Las cotizaciones están <strong>próximamente disponibles</strong>.
            Permitirán crear propuestas comerciales con líneas de productos,
            enviarlas a clientes o leads, y convertirlas en facturas al ser
            aceptadas.
          </p>
          <p className="text-sm text-muted-foreground">
            Esta funcionalidad se encuentra en desarrollo.
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
              <strong>Tesorería</strong>: los cobros (recibos) y pagos (órdenes
              de pago) se gestionan desde Tesorería
            </li>
            <li>
              <strong>Contabilidad</strong>: al confirmar facturas, recibos y
              órdenes de pago se generan asientos contables automáticamente
              (requiere configurar la integración en Contabilidad → Configuración)
            </li>
            <li>
              <strong>Órdenes de Compra</strong>: el flujo completo es OC →
              Remito de Recepción → Factura de Compra → Orden de Pago
            </li>
            <li>
              <strong>Almacenes</strong>: los remitos de recepción generan
              entradas de stock automáticamente al confirmarse
            </li>
            <li>
              <strong>Empleados / Equipamiento</strong>: se pueden asignar a
              clientes
            </li>
            <li>
              <strong>CRM</strong>: los leads pueden convertirse en clientes,
              vinculando automáticamente el historial comercial
            </li>
          </ul>
        </AlertDescription>
      </Alert>
    </div>
  );
}
