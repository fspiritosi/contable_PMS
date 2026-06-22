import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/components/ui/card';
import { Button } from '@/shared/components/ui/button';
import Link from 'next/link';
import { BarChart3, FileText, Layers, PieChart, Settings } from 'lucide-react';

export default function AccountingPage() {
  return (
    <div className="flex flex-1 flex-col gap-4">
      <div>
        <h1 className="text-2xl font-bold">Contabilidad</h1>
        <p className="text-sm text-muted-foreground">
          Gestión contable de la empresa
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Layers className="h-5 w-5" />
              Plan de Cuentas
            </CardTitle>
            <CardDescription>
              Gestiona el plan de cuentas de tu empresa
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild className="w-full">
              <Link href="/dashboard/company/accounting/accounts">
                Ir al Plan de Cuentas
              </Link>
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Asientos Contables
            </CardTitle>
            <CardDescription>
              Registra y gestiona asientos contables
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild className="w-full">
              <Link href="/dashboard/company/accounting/entries">
                Ir a Asientos
              </Link>
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BarChart3 className="h-5 w-5" />
              Balance del Mes
            </CardTitle>
            <CardDescription>
              Resumen rápido de ingresos, gastos y resultado del mes
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild className="w-full">
              <Link href="/dashboard/company/accounting/monthly-balance">
                Ver Balance del Mes
              </Link>
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <PieChart className="h-5 w-5" />
              Informes
            </CardTitle>
            <CardDescription>
              Genera informes contables
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild className="w-full">
              <Link href="/dashboard/company/accounting/reports">
                Ir a Informes
              </Link>
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Settings className="h-5 w-5" />
              Configuración
            </CardTitle>
            <CardDescription>
              Configura parámetros contables
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild className="w-full">
              <Link href="/dashboard/company/accounting/settings">
                Ir a Configuración
              </Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
