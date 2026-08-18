'use client';

import { useState } from 'react';
import { Button } from '@/shared/components/ui/button';
import { Input } from '@/shared/components/ui/input';
import { Label } from '@/shared/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui/select';
import { Filter, X } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { getWarehouses } from '../../list/actions.server';
import { getProducts } from '@/modules/commercial/features/products/features/list/actions.server';
import { STOCK_MOVEMENT_TYPE_LABELS } from '../../../shared/types';
import moment from 'moment';

export function MovementFilters() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [warehouseId, setWarehouseId] = useState(searchParams.get('warehouseId') || '');
  const [productId, setProductId] = useState(searchParams.get('productId') || '');
  const [type, setType] = useState(searchParams.get('type') || '');
  const [dateFrom, setDateFrom] = useState(searchParams.get('dateFrom') || '');
  const [dateTo, setDateTo] = useState(searchParams.get('dateTo') || '');

  const { data: warehousesData } = useQuery({
    queryKey: ['warehouses-for-filter'],
    queryFn: () => getWarehouses(),
  });

  const { data: productsData } = useQuery({
    queryKey: ['products-for-filter'],
    queryFn: () => getProducts(),
  });

  const warehouses = warehousesData?.data || [];
  const products = productsData?.data || [];

  const handleApplyFilters = () => {
    const params = new URLSearchParams();

    if (warehouseId) params.set('warehouseId', warehouseId);
    if (productId) params.set('productId', productId);
    if (type) params.set('type', type);
    if (dateFrom) params.set('dateFrom', dateFrom);
    if (dateTo) params.set('dateTo', dateTo);

    router.push(`/dashboard/commercial/movements?${params.toString()}`);
  };

  const handleClearFilters = () => {
    setWarehouseId('');
    setProductId('');
    setType('');
    setDateFrom('');
    setDateTo('');
    router.push('/dashboard/commercial/movements');
  };

  const hasFilters = warehouseId || productId || type || dateFrom || dateTo;

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {/* Warehouse Filter */}
        <div className="space-y-2">
          <Label>Almacén</Label>
          <Select value={warehouseId} onValueChange={setWarehouseId}>
            <SelectTrigger>
              <SelectValue placeholder="Todos los almacenes" />
            </SelectTrigger>
            <SelectContent>
              {warehouses.map((warehouse) => (
                <SelectItem key={warehouse.id} value={warehouse.id}>
                  {warehouse.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Product Filter */}
        <div className="space-y-2">
          <Label>Ítem</Label>
          <Select value={productId} onValueChange={setProductId}>
            <SelectTrigger>
              <SelectValue placeholder="Todos los ítems" />
            </SelectTrigger>
            <SelectContent>
              {products.slice(0, 50).map((product) => (
                <SelectItem key={product.id} value={product.id}>
                  {product.code} - {product.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Type Filter */}
        <div className="space-y-2">
          <Label>Tipo de Movimiento</Label>
          <Select value={type} onValueChange={setType}>
            <SelectTrigger>
              <SelectValue placeholder="Todos los tipos" />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(STOCK_MOVEMENT_TYPE_LABELS).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Date From */}
        <div className="space-y-2">
          <Label>Desde</Label>
          <Input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
          />
        </div>

        {/* Date To */}
        <div className="space-y-2">
          <Label>Hasta</Label>
          <Input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
          />
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex gap-2">
        <Button onClick={handleApplyFilters}>
          <Filter className="mr-2 h-4 w-4" />
          Aplicar Filtros
        </Button>
        {hasFilters && (
          <Button variant="outline" onClick={handleClearFilters}>
            <X className="mr-2 h-4 w-4" />
            Limpiar
          </Button>
        )}
      </div>
    </div>
  );
}
