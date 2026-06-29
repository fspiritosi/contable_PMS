import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/components/ui/card';
import { CategoryForm } from './components/_CategoryForm';
import { PermissionGuard } from '@/shared/components/common/PermissionGuard';

export async function CreateCategory() {
  return (
    <PermissionGuard module="commercial.categories" action="create" redirect>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Nueva Categoría</h1>
          <p className="text-muted-foreground">
            Crea una nueva categoría para organizar tus artículos
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Información de la Categoría</CardTitle>
            <CardDescription>
              Completa los datos de la categoría
            </CardDescription>
          </CardHeader>
          <CardContent>
            <CategoryForm />
          </CardContent>
        </Card>
      </div>
    </PermissionGuard>
  );
}
