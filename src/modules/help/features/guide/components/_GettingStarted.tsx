'use client';

import {
  Building2,
  Calculator,
  CheckCircle2,
  ClipboardList,
  Info,
  KeyRound,
  LayoutDashboard,
  Settings,
  Users,
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

export function _GettingStarted() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold">Primeros Pasos</h2>
        <p className="text-muted-foreground">
          Sigue estos pasos para configurar tu empresa y comenzar a trabajar
        </p>
      </div>

      {/* Paso 1 */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground text-sm font-bold">
              1
            </div>
            <div>
              <CardTitle className="flex items-center gap-2">
                <Building2 className="h-5 w-5" />
                Crear tu Empresa
              </CardTitle>
              <CardDescription>
                El primer paso es registrar los datos de tu empresa
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <p>
            Al ingresar por primera vez, el sistema te pedirá crear una empresa.
            Completa los datos básicos:
          </p>
          <ul className="list-disc pl-6 space-y-1 text-muted-foreground">
            <li>Razón social y nombre comercial</li>
            <li>CUIT / Identificación fiscal</li>
            <li>Dirección y datos de contacto</li>
            <li>Condición ante IVA</li>
            <li>Logo de la empresa (opcional)</li>
          </ul>
          <p className="text-sm text-muted-foreground">
            Puedes modificar estos datos en cualquier momento desde{' '}
            <strong>Configuración → Empresa</strong>.
          </p>
        </CardContent>
      </Card>

      {/* Paso 2 */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground text-sm font-bold">
              2
            </div>
            <div>
              <CardTitle className="flex items-center gap-2">
                <Users className="h-5 w-5" />
                Invitar Usuarios
              </CardTitle>
              <CardDescription>
                Agrega a tu equipo para trabajar en conjunto
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <p>
            Desde <strong>Empresa → Usuarios</strong>, puedes invitar
            colaboradores por email:
          </p>
          <ul className="list-disc pl-6 space-y-1 text-muted-foreground">
            <li>Ingresa el email del colaborador</li>
            <li>Asígnale un rol (define qué puede ver y hacer)</li>
            <li>El usuario recibirá un email de invitación</li>
            <li>Al aceptar, tendrá acceso según su rol</li>
          </ul>
        </CardContent>
      </Card>

      {/* Paso 3 */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground text-sm font-bold">
              3
            </div>
            <div>
              <CardTitle className="flex items-center gap-2">
                <KeyRound className="h-5 w-5" />
                Configurar Roles y Permisos
              </CardTitle>
              <CardDescription>
                Define qué puede hacer cada tipo de usuario
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <p>
            Desde <strong>Empresa → Roles</strong>, crea roles personalizados
            con permisos granulares:
          </p>
          <ul className="list-disc pl-6 space-y-1 text-muted-foreground">
            <li>
              <strong>Administrador</strong>: acceso completo a todo el sistema
            </li>
            <li>
              <strong>Contador</strong>: acceso a contabilidad y reportes
            </li>
            <li>
              <strong>Vendedor</strong>: acceso a comercial y clientes
            </li>
            <li>
              <strong>RRHH</strong>: acceso a empleados y documentos
            </li>
          </ul>
          <p className="text-sm text-muted-foreground">
            Cada módulo tiene permisos independientes de ver, crear, editar y
            eliminar.
          </p>
        </CardContent>
      </Card>

      {/* Paso 4 */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground text-sm font-bold">
              4
            </div>
            <div>
              <CardTitle className="flex items-center gap-2">
                <ClipboardList className="h-5 w-5" />
                Cargar Catálogos Base
              </CardTitle>
              <CardDescription>
                Configura las opciones que usarás en todo el sistema
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <p>
            Desde <strong>Empresa → Catálogos</strong>, configura las opciones
            base que se usan en distintos módulos:
          </p>
          <ul className="list-disc pl-6 space-y-1 text-muted-foreground">
            <li>
              <strong>Puestos de trabajo</strong> y <strong>categorías</strong>{' '}
              (para empleados)
            </li>
            <li>
              <strong>Tipos de contrato</strong> y <strong>sindicatos</strong>{' '}
              (para RRHH)
            </li>
            <li>
              <strong>Marcas y tipos de vehículos</strong> (para equipamiento)
            </li>
            <li>
              <strong>Centros de costo</strong> y <strong>sectores</strong> (para
              organización)
            </li>
            <li>
              <strong>Contratistas</strong> y{' '}
              <strong>propietarios de equipos</strong>
            </li>
          </ul>
        </CardContent>
      </Card>

      {/* Paso 5 */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground text-sm font-bold">
              5
            </div>
            <div>
              <CardTitle className="flex items-center gap-2">
                <Settings className="h-5 w-5" />
                Configurar Módulos
              </CardTitle>
              <CardDescription>
                Activa y configura los módulos que necesites
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <p>Dependiendo de tu actividad, configura los módulos relevantes:</p>
          <ul className="list-disc pl-6 space-y-1 text-muted-foreground">
            <li>
              <strong>Comercial</strong>: carga clientes, proveedores, productos,
              puntos de venta, almacenes y configura el CRM
            </li>
            <li>
              <strong>Tesorería</strong>: registra tus cuentas bancarias, cajas
              registradoras y configura cheques
            </li>
            <li>
              <strong>Contabilidad</strong>: configura el plan de cuentas, el
              ejercicio fiscal, presupuestos y saldos de apertura
            </li>
            <li>
              <strong>Documentos</strong>: crea los tipos de documento que
              necesitas controlar
            </li>
          </ul>
        </CardContent>
      </Card>

      <Separator />

      {/* Espacios de Trabajo */}
      <div>
        <h3 className="text-xl font-semibold mb-4">Espacios de Trabajo</h3>
        <p className="text-muted-foreground mb-4">
          El sistema organiza los módulos en dos espacios independientes que
          puedes alternar desde el header.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <LayoutDashboard className="h-5 w-5" />
            Espacio Gestión
          </CardTitle>
          <CardDescription>
            Operaciones del día a día de la empresa
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <p>
            Agrupa los módulos operativos y de administración de la empresa:
          </p>
          <ul className="list-disc pl-6 space-y-1 text-muted-foreground">
            <li>Empleados, Equipamiento y Documentos</li>
            <li>Comercial (ventas, compras, stock, tesorería)</li>
            <li>Dashboard con KPIs y alertas</li>
            <li>Configuración de empresa, usuarios y roles</li>
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calculator className="h-5 w-5" />
            Espacio Contable
          </CardTitle>
          <CardDescription>
            Módulos de contabilidad y cierre fiscal
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <p>Agrupa los módulos del área contable:</p>
          <ul className="list-disc pl-6 space-y-1 text-muted-foreground">
            <li>Plan de cuentas y asientos contables</li>
            <li>Reportes contables (balance, estado de resultados)</li>
            <li>Cierre de ejercicio fiscal</li>
            <li>Asientos recurrentes y ajuste por inflación (RECPAM)</li>
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Info className="h-5 w-5" />
            Cómo cambiar de espacio
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p>
            En la parte superior derecha del header encontrarás el selector de
            espacio de trabajo (dos pestañas:{' '}
            <Badge variant="secondary">Gestión</Badge> /{' '}
            <Badge variant="secondary">Contable</Badge>).
          </p>
          <ol className="list-decimal pl-6 space-y-1 text-muted-foreground">
            <li>Haz clic en la pestaña del espacio al que quieras ir</li>
            <li>El sidebar se actualiza mostrando solo los módulos de ese espacio</li>
            <li>El sistema te lleva a la sección de inicio del espacio elegido</li>
            <li>Tu preferencia queda guardada para la próxima vez</li>
          </ol>
          <p className="text-sm text-muted-foreground">
            El selector solo es visible cuando tu rol tiene acceso a ambos
            espacios (también verás ambos espacios si tu rol todavía no tiene
            ningún permiso de espacio configurado). Si solo ves los módulos de
            Gestión o solo los de Contable, consulta con el administrador los
            permisos de tu rol.
          </p>
          <p className="text-sm text-muted-foreground">
            <strong>Importante:</strong> el espacio de trabajo organiza lo que
            ves en el menú; lo que podés abrir y editar depende de los permisos
            de tu rol en cada módulo.
          </p>
        </CardContent>
      </Card>

      <Separator />

      {/* Orden sugerido */}
      <Card className="border-primary/20 bg-primary/5">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-primary" />
            Orden Sugerido de Configuración
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="list-decimal pl-6 space-y-2">
            <li>
              <strong>Empresa</strong>: datos fiscales, usuarios, roles y
              catálogos
            </li>
            <li>
              <strong>Empleados</strong>: cargar la nómina de personal
            </li>
            <li>
              <strong>Equipamiento</strong>: registrar vehículos y equipos
            </li>
            <li>
              <strong>Documentos</strong>: definir tipos y asignar a empleados/equipos
            </li>
            <li>
              <strong>Comercial</strong>: clientes, proveedores, productos y
              puntos de venta
            </li>
            <li>
              <strong>Almacenes</strong>: configurar depósitos para control de
              stock
            </li>
            <li>
              <strong>Tesorería</strong>: cuentas bancarias, cajas y cheques
            </li>
            <li>
              <strong>Contabilidad</strong>: plan de cuentas, ejercicio fiscal,
              integración, presupuestos y saldos de apertura
            </li>
          </ol>
        </CardContent>
      </Card>

      <Alert>
        <AlertDescription>
          Cada sección de esta guía tiene instrucciones detalladas. Navega por
          las pestañas superiores para aprender sobre cada módulo.
        </AlertDescription>
      </Alert>
    </div>
  );
}
