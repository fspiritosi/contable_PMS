import { Button } from '@/shared/components/ui/button';
import { Plus } from 'lucide-react';
import Link from 'next/link';
import { getCategories } from './actions.server';
import { CategoriesTable } from './components/_CategoriesTable';
import { PermissionGuard } from '@/shared/components/common/PermissionGuard';

export async function CategoriesList() {
  const categories = await getCategories();

  return (
    <PermissionGuard module="commercial.categories" action="view" redirect>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Categorías</h1>
            <p className="text-muted-foreground">
              Organiza tus artículos por categorías y subcategorías
            </p>
          </div>
          <Button asChild>
            <Link href="/dashboard/commercial/categories/new">
              <Plus className="mr-2 h-4 w-4" />
              Nueva Categoría
            </Link>
          </Button>
        </div>

        <CategoriesTable categories={categories} />
      </div>
    </PermissionGuard>
  );
}
