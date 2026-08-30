'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { DollarSign, FileText, Truck } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';

import { Button } from '@/shared/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/shared/components/ui/card';
import { Checkbox } from '@/shared/components/ui/checkbox';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/shared/components/ui/form';
import { Input } from '@/shared/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui/select';
import { Separator } from '@/shared/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/components/ui/tabs';
import { MoneyInput } from '@/shared/components/ui/money-input';

import type {
  CostType,
  Currency,
  VehicleCondition,
  VehicleTitularityType,
} from '@/generated/prisma/enums';
import {
  costTypeLabels,
  currencyLabels,
  vehicleConditionLabels,
  vehicleTitularityTypeLabels,
} from '@/shared/utils/mappers';
import { createVehicle, type CreateVehicleInput } from '../actions.server';

// Catalog Hooks
import {
  useVehicleBrandsWithModels,
  useVehicleTypes,
  useTypesOfVehicle,
  useCostCenters,
  useSectors,
  useTypeOperatives,
  useContractors,
  useEquipmentOwners,
} from '@/shared/hooks';

const currentYear = new Date().getFullYear();

const vehicleSchema = z.object({
  // Identificación
  internNumber: z.string().optional(),
  domain: z.string().optional(),
  chassis: z.string().optional(),
  engine: z.string().min(1, 'El motor es requerido'),
  serie: z.string().optional(),
  year: z
    .string()
    .min(4, 'Año inválido')
    .refine(
      (val) => {
        const year = parseInt(val);
        return year >= 1900 && year <= currentYear + 1;
      },
      { message: `El año debe estar entre 1900 y ${currentYear + 1}` }
    ),
  kilometer: z.string().optional(),

  // Estado
  condition: z.string().optional(),

  // Titularidad
  titularityType: z.string().optional(),
  ownerId: z.string().optional(),
  contractNumber: z.string().optional(),
  contractStartDate: z.string().optional(),
  contractExpirationDate: z.string().optional(),
  currency: z.string().optional(),
  price: z.string().optional(),
  monthlyPrice: z.string().optional(),

  // Tipo de costo
  costType: z.string().optional(),

  // Relaciones
  brandId: z.string().optional(),
  modelId: z.string().optional(),
  typeId: z.string().min(1, 'El tipo es requerido'),
  typeOfVehicleId: z.string().min(1, 'La clasificación es requerida'),
  costCenterId: z.string().optional(),
  sectorId: z.string().optional(),
  typeOperativeId: z.string().optional(),

  // Contratistas
  contractorIds: z.array(z.string()).optional(),
});

type VehicleFormData = z.infer<typeof vehicleSchema>;

interface Props {
  defaultValues?: Partial<VehicleFormData>;
  vehicleId?: string;
  mode?: 'create' | 'edit';
}

export function _EquipmentForm({ defaultValues, vehicleId, mode = 'create' }: Props) {
  const router = useRouter();
  const [selectedBrandId, setSelectedBrandId] = useState<string | undefined>(
    defaultValues?.brandId
  );
  const [selectedTitularityType, setSelectedTitularityType] = useState<string | undefined>(
    defaultValues?.titularityType
  );

  // ============================================
  // CATALOG HOOKS (Client-side fetching)
  // ============================================
  const { data: brands = [], isLoading: loadingBrands } = useVehicleBrandsWithModels();
  const { data: vehicleTypes = [], isLoading: loadingVehicleTypes } = useVehicleTypes();
  const { data: typesOfVehicles = [], isLoading: loadingTypesOfVehicles } = useTypesOfVehicle();
  const { data: costCenters = [], isLoading: loadingCostCenters } = useCostCenters();
  const { data: sectors = [], isLoading: loadingSectors } = useSectors();
  const { data: typeOperatives = [], isLoading: loadingTypeOperatives } = useTypeOperatives();
  const { data: contractors = [], isLoading: loadingContractors } = useContractors();
  const { data: equipmentOwners = [], isLoading: loadingOwners } = useEquipmentOwners();

  // Filtrar owners según el tipo de titularidad seleccionado
  const filteredOwners = equipmentOwners.filter((owner) =>
    owner.titularityTypes.some((t) => t.titularityType === selectedTitularityType)
  );

  // Mostrar campos de contrato solo si NO es OWNED
  const showContractFields = selectedTitularityType && selectedTitularityType !== 'OWNED';

  const form = useForm<VehicleFormData>({
    resolver: zodResolver(vehicleSchema),
    defaultValues: {
      internNumber: '',
      domain: '',
      chassis: '',
      engine: '',
      serie: '',
      year: '',
      kilometer: '0',
      condition: 'OPERATIVE',
      titularityType: '',
      ownerId: '',
      contractNumber: '',
      contractStartDate: '',
      contractExpirationDate: '',
      currency: '',
      price: '',
      monthlyPrice: '',
      costType: '',
      brandId: '',
      modelId: '',
      typeId: '',
      typeOfVehicleId: '',
      costCenterId: '',
      sectorId: '',
      typeOperativeId: '',
      contractorIds: [],
      ...defaultValues,
    },
  });

  const createMutation = useMutation({
    mutationFn: createVehicle,
    onSuccess: () => {
      toast.success(
        mode === 'create' ? 'Equipo creado correctamente' : 'Equipo actualizado correctamente'
      );
      router.push('/dashboard/equipment');
    },
    onError: (error) => {
      toast.error(error.message || 'Error al guardar el equipo');
    },
  });

  // Obtener modelos filtrados por marca seleccionada
  const selectedBrand = brands.find((b) => b.id === selectedBrandId);
  const availableModels = selectedBrand?.models || [];

  const onSubmit = (data: VehicleFormData) => {
    const input: CreateVehicleInput = {
      internNumber: data.internNumber || undefined,
      domain: data.domain || undefined,
      chassis: data.chassis || undefined,
      engine: data.engine,
      serie: data.serie || undefined,
      year: data.year,
      kilometer: data.kilometer || '0',
      condition: (data.condition as VehicleCondition) || undefined,
      titularityType: (data.titularityType as VehicleTitularityType) || undefined,
      ownerId: data.ownerId || undefined,
      contractNumber: data.contractNumber || undefined,
      contractStartDate: data.contractStartDate || undefined,
      contractExpirationDate: data.contractExpirationDate || undefined,
      currency: (data.currency as Currency) || undefined,
      price: data.price ? parseFloat(data.price) : undefined,
      monthlyPrice: data.monthlyPrice ? parseFloat(data.monthlyPrice) : undefined,
      costType: (data.costType as CostType) || undefined,
      brandId: data.brandId || undefined,
      modelId: data.modelId || undefined,
      typeId: data.typeId,
      typeOfVehicleId: data.typeOfVehicleId,
      costCenterId: data.costCenterId || undefined,
      sectorId: data.sectorId || undefined,
      typeOperativeId: data.typeOperativeId || undefined,
      contractorIds: data.contractorIds,
    };

    createMutation.mutate(input);
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        <Tabs defaultValue="info" className="space-y-4" data-testid="equipment-form-tabs">
          <TabsList>
            <TabsTrigger value="info" className="gap-2" data-testid="equipment-tab-info">
              <Truck className="h-4 w-4" />
              Información
            </TabsTrigger>
            <TabsTrigger value="contract" className="gap-2" data-testid="equipment-tab-contract">
              <FileText className="h-4 w-4" />
              Contrato
            </TabsTrigger>
            <TabsTrigger
              value="assignment"
              className="gap-2"
              data-testid="equipment-tab-assignment"
            >
              <DollarSign className="h-4 w-4" />
              Asignación
            </TabsTrigger>
          </TabsList>

          {/* Tab: Información */}
          <TabsContent value="info" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Clasificación</CardTitle>
                <CardDescription>Define el tipo de equipo</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4 md:grid-cols-2">
                <FormField
                  control={form.control}
                  name="typeOfVehicleId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Clasificación *</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Vehículos u Otros equipos" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {typesOfVehicles.map((type) => (
                            <SelectItem key={type.id} value={type.id}>
                              {type.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {/*<FormDescription>Vehículos u Otros equipos</FormDescription>*/}
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="typeId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Tipo de equipo *</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Seleccionar tipo" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {vehicleTypes.map((type) => (
                            <SelectItem key={type.id} value={type.id}>
                              {type.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Identificación</CardTitle>
                <CardDescription>Datos de identificación del equipo</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                <FormField
                  control={form.control}
                  name="internNumber"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>N° Interno</FormLabel>
                      <FormControl>
                        <Input placeholder="Ej: 001" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="domain"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Dominio/Patente</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="Ej: AB123CD"
                          {...field}
                          onChange={(e) => field.onChange(e.target.value.toUpperCase())}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="chassis"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Chasis</FormLabel>
                      <FormControl>
                        <Input placeholder="Número de chasis" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="engine"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Motor *</FormLabel>
                      <FormControl>
                        <Input
                          data-testid="equipment-engine-input"
                          placeholder="Número de motor"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="serie"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Serie</FormLabel>
                      <FormControl>
                        <Input placeholder="Número de serie" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="year"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Año *</FormLabel>
                      <FormControl>
                        <Input
                          data-testid="equipment-year-input"
                          type="number"
                          placeholder="Ej: 2024"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="kilometer"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Kilometraje</FormLabel>
                      <FormControl>
                        <Input type="number" placeholder="0" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Marca y Modelo</CardTitle>
                <CardDescription>Información del fabricante</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4 md:grid-cols-2">
                <FormField
                  control={form.control}
                  name="brandId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Marca</FormLabel>
                      <Select
                        onValueChange={(value) => {
                          field.onChange(value);
                          setSelectedBrandId(value);
                          form.setValue('modelId', '');
                        }}
                        value={field.value}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Seleccionar marca" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {brands.map((brand) => (
                            <SelectItem key={brand.id} value={brand.id}>
                              {brand.name}
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
                  name="modelId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Modelo</FormLabel>
                      <Select
                        onValueChange={field.onChange}
                        value={field.value}
                        disabled={!selectedBrandId}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue
                              placeholder={
                                selectedBrandId
                                  ? 'Seleccionar modelo'
                                  : 'Primero selecciona una marca'
                              }
                            />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {availableModels.map((model) => (
                            <SelectItem key={model.id} value={model.id}>
                              {model.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Estado</CardTitle>
                <CardDescription>Condición actual del equipo</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4 md:grid-cols-2">
                <FormField
                  control={form.control}
                  name="condition"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Condición</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Seleccionar condición" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {(
                            Object.entries(vehicleConditionLabels) as [VehicleCondition, string][]
                          ).map(([value, label]) => (
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
              </CardContent>
            </Card>
          </TabsContent>

          {/* Tab: Contrato/Titularidad */}
          <TabsContent value="contract" className="space-y-4">
            {/* Titularidad */}
            <Card>
              <CardHeader>
                <CardTitle>Titularidad</CardTitle>
                <CardDescription>Tipo de propiedad del equipo</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4 md:grid-cols-2">
                <FormField
                  control={form.control}
                  name="titularityType"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Tipo de Titularidad</FormLabel>
                      <Select
                        onValueChange={(value) => {
                          field.onChange(value);
                          setSelectedTitularityType(value);
                          // Reset owner si cambia tipo
                          form.setValue('ownerId', '');
                        }}
                        value={field.value}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Seleccionar tipo" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {(
                            Object.entries(vehicleTitularityTypeLabels) as [
                              VehicleTitularityType,
                              string,
                            ][]
                          ).map(([value, label]) => (
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

                {/* Titular - solo si NO es OWNED */}
                {showContractFields && (
                  <FormField
                    control={form.control}
                    name="ownerId"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Titular</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value}>
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="Seleccionar titular" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {filteredOwners.length > 0 ? (
                              filteredOwners.map((owner) => (
                                <SelectItem key={owner.id} value={owner.id}>
                                  {owner.name} ({owner.cuit})
                                </SelectItem>
                              ))
                            ) : (
                              <SelectItem value="" disabled>
                                No hay titulares para este tipo
                              </SelectItem>
                            )}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}
              </CardContent>
            </Card>

            {/* Información de Contrato - solo si NO es OWNED */}
            {showContractFields && (
              <Card>
                <CardHeader>
                  <CardTitle>Información de Contrato</CardTitle>
                  <CardDescription>Datos del contrato con el titular</CardDescription>
                </CardHeader>
                <CardContent className="grid gap-4 md:grid-cols-2">
                  <FormField
                    control={form.control}
                    name="contractNumber"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>N° de Contrato</FormLabel>
                        <FormControl>
                          <Input
                            data-testid="equipment-contract-number-input"
                            placeholder="Número de contrato"
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="contractStartDate"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Fecha Inicio</FormLabel>
                        <FormControl>
                          <Input type="date" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="contractExpirationDate"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Fecha Vencimiento</FormLabel>
                        <FormControl>
                          <Input type="date" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="monthlyPrice"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Valor Mensual</FormLabel>
                        <FormControl>
                          <MoneyInput
                            placeholder="0,00"
                            value={field.value}
                            onChange={field.onChange}
                            onBlur={field.onBlur}
                            name={field.name}
                            ref={field.ref}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </CardContent>
              </Card>
            )}

            {/* Valor del equipo - siempre visible */}
            <Card>
              <CardHeader>
                <CardTitle>Valor del Equipo</CardTitle>
                <CardDescription>Valor comercial del equipo</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4 md:grid-cols-2">
                <FormField
                  control={form.control}
                  name="currency"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Moneda</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Seleccionar moneda" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {(Object.entries(currencyLabels) as [Currency, string][]).map(
                            ([value, label]) => (
                              <SelectItem key={value} value={value}>
                                {label}
                              </SelectItem>
                            )
                          )}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="price"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Valor del Equipo</FormLabel>
                      <FormControl>
                        <MoneyInput
                          placeholder="0,00"
                          value={field.value}
                          onChange={field.onChange}
                          onBlur={field.onBlur}
                          name={field.name}
                          ref={field.ref}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </CardContent>
            </Card>
          </TabsContent>

          {/* Tab: Asignación */}
          <TabsContent value="assignment" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Centro de Costo y Sector</CardTitle>
                <CardDescription>Asignación contable y operativa</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                <FormField
                  control={form.control}
                  name="costCenterId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Centro de Costo</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Seleccionar" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {costCenters.map((cc) => (
                            <SelectItem key={cc.id} value={cc.id}>
                              {cc.name}
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
                  name="costType"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Tipo de Costo</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Seleccionar" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {(Object.entries(costTypeLabels) as [CostType, string][]).map(
                            ([value, label]) => (
                              <SelectItem key={value} value={value}>
                                {label}
                              </SelectItem>
                            )
                          )}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="sectorId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Sector</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Seleccionar" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {sectors.map((sector) => (
                            <SelectItem key={sector.id} value={sector.id}>
                              {sector.name}
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
                  name="typeOperativeId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Tipo Operativo</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Seleccionar" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {typeOperatives.map((to) => (
                            <SelectItem key={to.id} value={to.id}>
                              {to.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Contratistas Asignados</CardTitle>
                <CardDescription>
                  Selecciona los contratistas a los que está asignado este equipo
                </CardDescription>
              </CardHeader>
              <CardContent>
                <FormField
                  control={form.control}
                  name="contractorIds"
                  render={() => (
                    <FormItem>
                      <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
                        {contractors.length > 0 ? (
                          contractors.map((contractor) => (
                            <FormField
                              key={contractor.id}
                              control={form.control}
                              name="contractorIds"
                              render={({ field }) => (
                                <FormItem className="flex items-center space-x-3 space-y-0">
                                  <FormControl>
                                    <Checkbox
                                      checked={field.value?.includes(contractor.id)}
                                      onCheckedChange={(checked) => {
                                        const current = field.value || [];
                                        if (checked) {
                                          field.onChange([...current, contractor.id]);
                                        } else {
                                          field.onChange(
                                            current.filter((id) => id !== contractor.id)
                                          );
                                        }
                                      }}
                                    />
                                  </FormControl>
                                  <FormLabel className="font-normal cursor-pointer">
                                    {contractor.name}
                                  </FormLabel>
                                </FormItem>
                              )}
                            />
                          ))
                        ) : (
                          <p className="text-sm text-muted-foreground col-span-full">
                            No hay contratistas registrados
                          </p>
                        )}
                      </div>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        <Separator />

        <div className="flex justify-end gap-4">
          <Button
            type="button"
            variant="outline"
            onClick={() => router.push('/dashboard/equipment')}
            data-testid="equipment-cancel-button"
          >
            Cancelar
          </Button>
          <Button
            type="submit"
            disabled={createMutation.isPending}
            data-testid="equipment-submit-button"
          >
            {createMutation.isPending
              ? 'Guardando...'
              : mode === 'create'
                ? 'Crear Equipo'
                : 'Guardar Cambios'}
          </Button>
        </div>
      </form>
    </Form>
  );
}
