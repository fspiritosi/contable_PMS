'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Button } from '@/shared/components/ui/button';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/shared/components/ui/form';
import { Input } from '@/shared/components/ui/input';
import { Textarea } from '@/shared/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui/select';
import { Checkbox } from '@/shared/components/ui/checkbox';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/components/ui/card';
import { createProductSchema, updateProductSchema, type CreateProductFormData, type UpdateProductFormData } from '../../../shared/validators';
import { ProductType, ProductStatus } from '@/generated/prisma/enums';
import type { ProductCategory } from '../../../shared/types';
import {
  PRODUCT_TYPE_LABELS,
  PRODUCT_STATUS_LABELS,
  UNIT_OF_MEASURE_OPTIONS,
  VAT_RATE_OPTIONS,
} from '../../../shared/types';
import { useEffect, useState } from 'react';
import { useIndustry } from '@/providers/IndustryProvider';

interface EquivalenceOption {
  id: string;
  name: string;
}

interface ProductFormProps {
  onSubmit: (data: UpdateProductFormData) => Promise<void>;
  defaultValues?: Partial<UpdateProductFormData>;
  isSubmitting?: boolean;
  submitLabel?: string;
  categories: ProductCategory[];
  showStatus?: boolean;
  equivalences?: EquivalenceOption[];
}

export function _ProductForm({
  onSubmit,
  defaultValues,
  isSubmitting = false,
  submitLabel = 'Crear Producto',
  categories,
  showStatus = false,
  equivalences = [],
}: ProductFormProps) {
  const [salePriceWithTax, setSalePriceWithTax] = useState<number>(0);
  const { isFeatureAvailable } = useIndustry();

  const schema = showStatus ? updateProductSchema : createProductSchema;
  const form = useForm<UpdateProductFormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: '',
      description: '',
      type: ProductType.PRODUCT,
      categoryId: undefined,
      unitOfMeasure: 'UN',
      costPrice: 0,
      salePrice: 0,
      vatRate: 21,
      trackStock: true,
      minStock: 0,
      maxStock: undefined,
      barcode: '',
      internalCode: '',
      brand: '',
      model: '',
      oemCode: '',
      auxiliaryCode: '',
      productGroupId: undefined,
      ...defaultValues,
    },
  });

  // Calcular precio con IVA cuando cambian el precio o el IVA
  const salePrice = form.watch('salePrice');
  const vatRate = form.watch('vatRate');

  useEffect(() => {
    const price = Number(salePrice) || 0;
    const vat = Number(vatRate) || 0;
    const priceWithTax = price * (1 + vat / 100);
    setSalePriceWithTax(priceWithTax);
  }, [salePrice, vatRate]);

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        {/* Información Básica */}
        <Card>
          <CardHeader>
            <CardTitle>Información Básica</CardTitle>
            <CardDescription>Datos principales del producto o servicio</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Nombre *</FormLabel>
                    <FormControl>
                      <Input placeholder="Nombre del producto" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="type"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Tipo *</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Seleccionar tipo" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {Object.entries(PRODUCT_TYPE_LABELS).map(([value, label]) => (
                          <SelectItem key={value} value={value}>
                            {label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Descripción</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Descripción detallada del producto"
                      className="resize-none"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <FormField
                control={form.control}
                name="categoryId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Categoría</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Seleccionar categoría" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {categories.map((category) => (
                          <SelectItem key={category.id} value={category.id}>
                            {category.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="unitOfMeasure"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Unidad de Medida</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Seleccionar unidad" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {UNIT_OF_MEASURE_OPTIONS.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          </CardContent>
        </Card>

        {/* Precios */}
        <Card>
          <CardHeader>
            <CardTitle>Precios e IVA</CardTitle>
            <CardDescription>Configuración de precios y alícuota de IVA</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <FormField
                control={form.control}
                name="costPrice"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Precio de Costo *</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        placeholder="0.00"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="salePrice"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Precio de Venta *</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        placeholder="0.00"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="vatRate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>IVA (%)</FormLabel>
                    <Select
                      onValueChange={(value) => field.onChange(Number(value))}
                      defaultValue={field.value?.toString()}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Seleccionar IVA" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {VAT_RATE_OPTIONS.map((option) => (
                          <SelectItem key={option.value} value={option.value.toString()}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="rounded-md bg-muted p-4">
              <p className="text-sm font-medium">Precio Final con IVA:</p>
              <p className="text-2xl font-bold">${salePriceWithTax.toFixed(2)}</p>
            </div>
          </CardContent>
        </Card>

        {/* Control de Stock */}
        <Card>
          <CardHeader>
            <CardTitle>Control de Stock</CardTitle>
            <CardDescription>Configuración de inventario y stock</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <FormField
              control={form.control}
              name="trackStock"
              render={({ field }) => (
                <FormItem className="flex flex-row items-start space-x-3 space-y-0 rounded-md border p-4">
                  <FormControl>
                    <Checkbox
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  </FormControl>
                  <div className="space-y-1 leading-none">
                    <FormLabel>Controlar Stock</FormLabel>
                    <FormDescription>
                      Activar para llevar control de inventario de este producto
                    </FormDescription>
                  </div>
                </FormItem>
              )}
            />

            {form.watch('trackStock') && (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <FormField
                  control={form.control}
                  name="minStock"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Stock Mínimo</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          step="1"
                          min="0"
                          placeholder="0"
                          {...field}
                        />
                      </FormControl>
                      <FormDescription>
                        Se notificará cuando el stock sea menor a este valor
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="maxStock"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Stock Máximo</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          step="1"
                          min="0"
                          placeholder="Sin límite"
                          {...field}
                        />
                      </FormControl>
                      <FormDescription>Stock máximo permitido (opcional)</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            )}
          </CardContent>
        </Card>

        {/* Información Adicional */}
        <Card>
          <CardHeader>
            <CardTitle>Información Adicional</CardTitle>
            <CardDescription>Códigos y datos complementarios</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <FormField
                control={form.control}
                name="barcode"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Código de Barras</FormLabel>
                    <FormControl>
                      <Input placeholder="EAN-13, UPC, etc." {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="internalCode"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Código Interno</FormLabel>
                    <FormControl>
                      <Input placeholder="Código interno de la empresa" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="brand"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Marca</FormLabel>
                    <FormControl>
                      <Input placeholder="Marca del producto" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="model"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Modelo</FormLabel>
                    <FormControl>
                      <Input placeholder="Modelo del producto" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {isFeatureAvailable('products.triple-coding') && (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <FormField
                  control={form.control}
                  name="oemCode"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Código OEM</FormLabel>
                      <FormControl>
                        <Input placeholder="Código original del fabricante" {...field} />
                      </FormControl>
                      <FormDescription>
                        Código del fabricante original (OEM)
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="auxiliaryCode"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Código Auxiliar</FormLabel>
                      <FormControl>
                        <Input placeholder="Código del proveedor" {...field} />
                      </FormControl>
                      <FormDescription>
                        Código alternativo del proveedor o aftermarket
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            )}

            {isFeatureAvailable('products.equivalences') && equivalences.length > 0 && (
              <FormField
                control={form.control}
                name="productGroupId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Grupo de Equivalencia</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Seleccionar grupo (opcional)" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {equivalences.map((group) => (
                          <SelectItem key={group.id} value={group.id}>
                            {group.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormDescription>
                      Agrupar con productos equivalentes de otras marcas
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            {showStatus && (
              <FormField
                control={form.control}
                name="status"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Estado</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Seleccionar estado" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {Object.entries(PRODUCT_STATUS_LABELS).map(([value, label]) => (
                          <SelectItem key={value} value={value}>
                            {label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}
          </CardContent>
        </Card>

        <div className="flex justify-end gap-4">
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Guardando...' : submitLabel}
          </Button>
        </div>
      </form>
    </Form>
  );
}
