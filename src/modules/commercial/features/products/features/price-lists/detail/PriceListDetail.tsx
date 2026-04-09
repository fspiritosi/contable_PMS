import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PermissionGuard } from '@/shared/components/common/PermissionGuard';
import { getPriceListById, getPriceListItems } from '../list/actions.server';
import { Button } from '@/shared/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/components/ui/card';
import { Badge } from '@/shared/components/ui/badge';
import { Pencil, Star } from 'lucide-react';
import { BackButton } from '@/shared/components/common/BackButton';
import { _PriceListItemsTable } from './components/_PriceListItemsTable';

interface PriceListDetailProps {
  priceListId: string;
}

export async function PriceListDetail({ priceListId }: PriceListDetailProps) {
  const [priceList, items] = await Promise.all([
    getPriceListById(priceListId),
    getPriceListItems(priceListId),
  ]);

  if (!priceList) {
    notFound();
  }

  return (
    <PermissionGuard module="commercial.price-lists" action="view" redirect>
      <div className="flex flex-1 flex-col gap-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <BackButton />
            <div className="flex items-center gap-2">
              {priceList.isDefault && (
                <Star className="h-5 w-5 fill-yellow-400 text-yellow-400" />
              )}
              <h1 className="text-2xl font-bold">{priceList.name}</h1>
            </div>
          </div>
          <Link href={`/dashboard/commercial/price-lists/${priceList.id}/edit`}>
            <Button>
              <Pencil className="mr-2 h-4 w-4" />
              Editar
            </Button>
          </Link>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Información</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Descripción</p>
                <p className="text-sm">{priceList.description || 'Sin descripción'}</p>
              </div>

              <div>
                <p className="text-sm font-medium text-muted-foreground">Estado</p>
                <Badge variant={priceList.isActive ? 'default' : 'secondary'}>
                  {priceList.isActive ? 'Activa' : 'Inactiva'}
                </Badge>
              </div>

              <div>
                <p className="text-sm font-medium text-muted-foreground">Predeterminada</p>
                <Badge variant={priceList.isDefault ? 'default' : 'outline'}>
                  {priceList.isDefault ? 'Sí' : 'No'}
                </Badge>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Estadísticas</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Total de Productos</p>
                <p className="text-3xl font-bold">{priceList._count?.items || 0}</p>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Precios de Productos</CardTitle>
            <CardDescription>
              Gestiona los precios de los productos en esta lista
            </CardDescription>
          </CardHeader>
          <CardContent>
            <_PriceListItemsTable priceListId={priceList.id} items={items} />
          </CardContent>
        </Card>
      </div>
    </PermissionGuard>
  );
}
