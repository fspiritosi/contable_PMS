'use client';

import {
  Building2,
  ClipboardList,
  FileText,
  Info,
  KeyRound,
  ScrollText,
  Shield,
  UserPlus,
} from 'lucide-react';

import { Alert, AlertDescription } from '@/shared/components/ui/alert';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/shared/components/ui/card';
import { Separator } from '@/shared/components/ui/separator';

export function _CompanyGuide() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold">Empresa</h2>
        <p className="text-muted-foreground">
          Usuarios, roles, permisos y catálogos del sistema
        </p>
      </div>

      {/* Usuarios */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <UserPlus className="h-5 w-5" />
            Gestión de Usuarios
          </CardTitle>
          <CardDescription>
            Invita y administra los miembros de tu empresa
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <p>
            <strong>Invitar un nuevo usuario:</strong>
          </p>
          <ol className="list-decimal pl-6 space-y-1 text-muted-foreground">
            <li>
              Ve a <strong>Empresa → Usuarios</strong>
            </li>
            <li>
              Haz clic en <strong>Invitar Usuario</strong>
            </li>
            <li>Ingresa el email del colaborador</li>
            <li>Asígnale un rol</li>
            <li>Se envía un email de invitación automáticamente</li>
            <li>
              El usuario acepta la invitación y accede al sistema con los
              permisos de su rol
            </li>
          </ol>
          <p className="text-sm text-muted-foreground mt-2">
            Puedes <strong>cambiar el rol</strong> de un usuario o{' '}
            <strong>desactivarlo</strong> en cualquier momento.
          </p>
        </CardContent>
      </Card>

      {/* Roles */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            Roles y Permisos
          </CardTitle>
          <CardDescription>
            Define qué puede hacer cada tipo de usuario
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <p>
            <strong>Crear un rol:</strong>
          </p>
          <ol className="list-decimal pl-6 space-y-2 text-muted-foreground">
            <li>
              Ve a <strong>Empresa → Roles</strong>
            </li>
            <li>
              Haz clic en <strong>Nuevo Rol</strong>
            </li>
            <li>Ingresa un nombre descriptivo (ej. &quot;Contador&quot;, &quot;Vendedor&quot;)</li>
            <li>
              Asigna permisos por módulo:
              <ul className="list-disc pl-6 mt-1 space-y-1">
                <li>
                  <strong>Ver</strong>: acceso de lectura
                </li>
                <li>
                  <strong>Crear</strong>: puede agregar registros nuevos
                </li>
                <li>
                  <strong>Editar</strong>: puede modificar registros existentes
                </li>
                <li>
                  <strong>Eliminar</strong>: puede dar de baja o eliminar
                </li>
              </ul>
            </li>
          </ol>

          <p className="mt-3">
            <strong>Permisos individuales:</strong>
          </p>
          <p className="text-muted-foreground">
            Además del rol base, puedes otorgar o quitar permisos específicos a
            cada usuario. Los permisos individuales tienen prioridad sobre los
            del rol.
          </p>

          <p className="mt-3">
            <strong>Roles del sistema:</strong>
          </p>
          <ul className="list-disc pl-6 space-y-1 text-muted-foreground">
            <li>
              <strong>Propietario</strong>: acceso total, no se puede modificar
            </li>
            <li>
              <strong>Administrador</strong>: acceso completo configurable
            </li>
            <li>
              Roles personalizados con permisos granulares
            </li>
          </ul>
        </CardContent>
      </Card>

      {/* Módulos de permisos */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="h-5 w-5" />
            Módulos con Permisos
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p>
            Los permisos se organizan por grupos de módulos:
          </p>
          <ul className="list-disc pl-6 space-y-2 text-muted-foreground">
            <li>
              <strong>Recursos Humanos</strong>: Empleados
            </li>
            <li>
              <strong>Equipamiento</strong>: Equipos/Vehículos
            </li>
            <li>
              <strong>Documentos</strong>: Documentación general, de empleados,
              de equipos, tipos de documento
            </li>
            <li>
              <strong>Comercial</strong>: Clientes, Proveedores, Ítems,
              Categorías, Puntos de venta, Facturas de venta, Facturas de
              compra, Gastos, Reportes
            </li>
            <li>
              <strong>Tesorería</strong>: Cuentas bancarias, Movimientos, Recibos,
              Órdenes de pago, Cajas
            </li>
            <li>
              <strong>Almacenes</strong>: Almacenes, Stock, Movimientos de stock
            </li>
            <li>
              <strong>Contabilidad</strong>: Plan de cuentas, Asientos, Reportes,
              Configuración, Cierre de ejercicio, Asientos recurrentes
            </li>
            <li>
              <strong>Empresa</strong>: Configuración, Usuarios, Roles, Catálogos
            </li>
          </ul>
        </CardContent>
      </Card>

      {/* Auditoría del Sistema */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ScrollText className="h-5 w-5" />
            Auditoría del Sistema
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p>
            El sistema registra un log completo de todas las acciones
            administrativas realizadas por los usuarios:
          </p>
          <ul className="list-disc pl-6 space-y-1 text-muted-foreground">
            <li>
              <strong>Acciones de roles</strong>: creación, modificación y
              eliminación de roles
            </li>
            <li>
              <strong>Acciones de permisos</strong>: permisos otorgados o
              revocados (tanto de rol como individuales)
            </li>
            <li>
              <strong>Acciones de miembros</strong>: invitaciones enviadas,
              aceptadas, canceladas o expiradas; cambios de rol;
              activación/desactivación de usuarios
            </li>
          </ul>

          <p className="mt-3">
            <strong>Cada registro muestra:</strong>
          </p>
          <ul className="list-disc pl-6 space-y-1 text-muted-foreground">
            <li>Quién realizó la acción (usuario con nombre y foto)</li>
            <li>Cuándo se realizó</li>
            <li>Qué se modificó (módulo, tipo de acción)</li>
            <li>Valores anterior y nuevo (cuando aplica)</li>
          </ul>
          <p className="text-sm text-muted-foreground">
            La auditoría se encuentra en{' '}
            <strong>Empresa → Auditoría</strong> y permite filtrar por tipo
            de acción.
          </p>
        </CardContent>
      </Card>

      {/* Catálogos */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ClipboardList className="h-5 w-5" />
            Catálogos
          </CardTitle>
          <CardDescription>
            Datos maestros que se usan en todo el sistema
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <p>
            Los catálogos son listas de opciones que se reutilizan en distintos
            módulos. Se gestionan desde{' '}
            <strong>Empresa → Catálogos</strong>:
          </p>

          <div className="grid gap-2 sm:grid-cols-2">
            <div className="space-y-1">
              <p className="font-medium text-sm">Para Empleados:</p>
              <ul className="list-disc pl-6 space-y-1 text-sm text-muted-foreground">
                <li>Puestos de trabajo</li>
                <li>Categorías laborales</li>
                <li>Tipos de contrato</li>
                <li>Sindicatos</li>
                <li>Convenios colectivos</li>
                <li>Centros de costo</li>
                <li>Sectores</li>
                <li>Tipos operativos</li>
              </ul>
            </div>
            <div className="space-y-1">
              <p className="font-medium text-sm">Para Equipamiento:</p>
              <ul className="list-disc pl-6 space-y-1 text-sm text-muted-foreground">
                <li>Marcas de vehículos</li>
                <li>Tipos de vehículos</li>
                <li>Propietarios de equipos</li>
                <li>Contratistas</li>
              </ul>
            </div>
          </div>

          <p className="text-sm text-muted-foreground mt-2">
            Cada catálogo tiene la misma operación: crear, editar, activar y
            desactivar opciones. Se recomienda cargar los catálogos antes de
            empezar a usar los módulos que los necesitan.
          </p>
        </CardContent>
      </Card>

      {/* Gestión de Empresas (Multi-empresa) */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Building2 className="h-5 w-5" />
            Gestión de Empresas
          </CardTitle>
          <CardDescription>
            Administra múltiples empresas desde una misma cuenta
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <p>
            El sistema soporta múltiples empresas. Puedes crear varias empresas
            y alternar entre ellas. Todos los datos (empleados, facturas,
            contabilidad, etc.) son independientes por empresa.
          </p>

          <p>
            <strong>Crear una nueva empresa:</strong>
          </p>
          <ol className="list-decimal pl-6 space-y-2 text-muted-foreground">
            <li>
              Desde el menú superior, haz clic en el{' '}
              <strong>selector de empresa</strong>
            </li>
            <li>
              Haz clic en <strong>Crear nueva empresa</strong>
            </li>
            <li>
              Completa los datos:
              <ul className="list-disc pl-6 mt-1 space-y-1">
                <li>Razón social (obligatorio)</li>
                <li>Nombre comercial</li>
                <li>CUIT</li>
                <li>Condición ante IVA</li>
                <li>Dirección, ciudad, provincia, código postal</li>
                <li>Email y teléfono</li>
                <li>Logo (opcional)</li>
              </ul>
            </li>
            <li>
              Haz clic en <strong>Guardar</strong> para crear la empresa
            </li>
          </ol>

          <p className="mt-3">
            <strong>Cambiar de empresa:</strong>
          </p>
          <ul className="list-disc pl-6 space-y-1 text-muted-foreground">
            <li>
              Desde el menú superior, selecciona la empresa deseada en el
              selector
            </li>
            <li>
              Todos los datos del sistema se actualizan para mostrar la
              información de la empresa seleccionada
            </li>
            <li>
              Cada empresa tiene su propia configuración, usuarios, roles y
              datos independientes
            </li>
          </ul>
          <p className="text-sm text-muted-foreground">
            Cada empresa tiene sus propios datos completamente aislados. Los
            usuarios y roles se gestionan por empresa.
          </p>
        </CardContent>
      </Card>

      {/* Plantillas de PDF */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Plantillas de PDF de Documentos
          </CardTitle>
          <CardDescription>
            Personaliza la apariencia de los comprobantes que emite tu empresa
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <p>
            Podés configurar cómo se ven los PDF de cada tipo de documento que
            emite el sistema: Órdenes de Pago, Recibos, Facturas de Venta y
            Compra, Órdenes de Compra, Remitos de Entrega y Recepción,
            Presupuestos y Transferencias entre Almacenes.
          </p>
          <p>
            <strong>Configurar una plantilla:</strong>
          </p>
          <ol className="list-decimal pl-6 space-y-2 text-muted-foreground">
            <li>
              Ve a <strong>Empresa → Plantillas de PDF</strong>
            </li>
            <li>
              Elegí el tipo de documento que querés personalizar
            </li>
            <li>
              Seleccioná uno de los tres temas visuales:
              <ul className="list-disc pl-6 mt-1 space-y-1">
                <li>
                  <strong>Clásico</strong>: negro y grises, líneas marcadas.
                  Aspecto tradicional de comprobante.
                </li>
                <li>
                  <strong>Moderno</strong>: color de acento y fondo en el
                  encabezado. Aspecto corporativo.
                </li>
                <li>
                  <strong>Minimalista</strong>: espacios amplios y líneas
                  suaves. Aspecto limpio.
                </li>
              </ul>
            </li>
            <li>
              Opcionalmente podés ajustar:
              <ul className="list-disc pl-6 mt-1 space-y-1">
                <li>Color principal de acento (override del tema)</li>
                <li>Texto de encabezado y de pie de página</li>
                <li>Notas por defecto</li>
                <li>
                  Mostrar u ocultar secciones: CAE, notas, retenciones, datos
                  del emisor y del receptor
                </li>
              </ul>
            </li>
            <li>
              Hacé clic en <strong>Guardar</strong>. El próximo PDF que emitas
              usará la nueva configuración
            </li>
          </ol>
          <p className="text-sm text-muted-foreground">
            Si no configurás ninguna plantilla, se usa el tema{' '}
            <strong>Clásico</strong> por defecto. Podés <strong>restablecer</strong>{' '}
            una plantilla a los valores por defecto en cualquier momento. El logo
            de la empresa se incluye automáticamente si lo cargaste en los datos
            de la empresa.
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
              <strong>Todos los módulos</strong>: los permisos definidos aquí
              controlan qué puede ver y hacer cada usuario en todo el sistema
            </li>
            <li>
              <strong>Empleados</strong>: usa catálogos de puestos, categorías,
              contratos, sindicatos, centros de costo y sectores
            </li>
            <li>
              <strong>Equipamiento</strong>: usa catálogos de marcas, tipos de
              vehículo, propietarios y contratistas
            </li>
            <li>
              <strong>Documentos</strong>: las condiciones de aplicación de
              documentos usan los catálogos
            </li>
            <li>
              <strong>Multi-empresa</strong>: al cambiar de empresa, todos los
              módulos muestran los datos correspondientes a la empresa activa
            </li>
          </ul>
        </AlertDescription>
      </Alert>
    </div>
  );
}
