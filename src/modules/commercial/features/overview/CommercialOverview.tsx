import Link from 'next/link';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/components/ui/card';
import { Button } from '@/shared/components/ui/button';
import { Package, Users, FolderTree, ArrowRight, DollarSign, Warehouse, ClipboardList, History } from 'lucide-react';
import { PermissionGuard } from '@/shared/components/common/PermissionGuard';

export async function CommercialOverview() {
  const modules = [
    {
      title: 'Proveedores',
      description: 'Gestión de proveedores y datos fiscales',
      icon: Users,
      href: '/dashboard/commercial/suppliers',
      color: 'text-blue-600',
      bgColor: 'bg-blue-50',
    },
    {
      title: 'Ítems',
      description: 'Catálogo de ítems y servicios',
      icon: Package,
      href: '/dashboard/commercial/products',
      color: 'text-green-600',
      bgColor: 'bg-green-50',
    },
    {
      title: 'Categorías',
      description: 'Organización de ítems por categorías',
      icon: FolderTree,
      href: '/dashboard/commercial/categories',
      color: 'text-purple-600',
      bgColor: 'bg-purple-50',
    },
    {
      title: 'Listas de Precios',
      description: 'Gestión de precios por lista',
      icon: DollarSign,
      href: '/dashboard/commercial/price-lists',
      color: 'text-orange-600',
      bgColor: 'bg-orange-50',
    },
    {
      title: 'Almacenes',
      description: 'Gestión de almacenes y depósitos',
      icon: Warehouse,
      href: '/dashboard/commercial/warehouses',
      color: 'text-teal-600',
      bgColor: 'bg-teal-50',
    },
    {
      title: 'Control de Stock',
      description: 'Ajustes y transferencias de inventario',
      icon: ClipboardList,
      href: '/dashboard/commercial/stock',
      color: 'text-indigo-600',
      bgColor: 'bg-indigo-50',
    },
    {
      title: 'Movimientos',
      description: 'Historial y trazabilidad de stock',
      icon: History,
      href: '/dashboard/commercial/movements',
      color: 'text-slate-600',
      bgColor: 'bg-slate-50',
    },
  ];

  return (
    <PermissionGuard module="commercial" action="view" redirect>
    <div className="flex flex-1 flex-col gap-6">
      <div>
        <h1 className="text-3xl font-bold">Módulo Comercial</h1>
        <p className="text-muted-foreground">
          Gestión de proveedores, ítems y catálogos
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {modules.map((module) => {
          const Icon = module.icon;
          return (
            <Card key={module.href} className="hover:shadow-lg transition-shadow">
              <CardHeader>
                <div className={`w-12 h-12 rounded-lg ${module.bgColor} flex items-center justify-center mb-2`}>
                  <Icon className={`h-6 w-6 ${module.color}`} />
                </div>
                <CardTitle>{module.title}</CardTitle>
                <CardDescription>{module.description}</CardDescription>
              </CardHeader>
              <CardContent>
                <Link href={module.href}>
                  <Button variant="ghost" className="w-full justify-between group">
                    Ver módulo
                    <ArrowRight className="h-4 w-4 group-hover:translate-x-1 transition-transform" />
                  </Button>
                </Link>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Quick Stats Section */}
      <div className="mt-6">
        <h2 className="text-xl font-semibold mb-4">Accesos Rápidos</h2>
        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Últimas Acciones</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <Link href="/dashboard/commercial/suppliers/new">
                <Button variant="outline" className="w-full justify-start">
                  <Users className="mr-2 h-4 w-4" />
                  Nuevo Proveedor
                </Button>
              </Link>
              <Link href="/dashboard/commercial/products/new">
                <Button variant="outline" className="w-full justify-start">
                  <Package className="mr-2 h-4 w-4" />
                  Nuevo Ítem
                </Button>
              </Link>
              <Link href="/dashboard/commercial/warehouses/new">
                <Button variant="outline" className="w-full justify-start">
                  <Warehouse className="mr-2 h-4 w-4" />
                  Nuevo Almacén
                </Button>
              </Link>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Información</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              <p>
                El módulo comercial te permite gestionar toda la información de tus
                proveedores, ítems y servicios.
              </p>
              <p className="mt-2">
                Organiza tu catálogo con categorías y mantén actualizada la información
                de precios y stock.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
    </PermissionGuard>
  );
}
