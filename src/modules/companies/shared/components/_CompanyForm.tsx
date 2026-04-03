'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Controller } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { TaxStatus } from '@/generated/prisma/enums';
import { INDUSTRY_TYPES, INDUSTRY_LABELS } from '@/shared/lib/industry';

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
import { Textarea } from '@/shared/components/ui/textarea';

import { useProvinces, useCitiesByProvince } from '@/shared/hooks/useGeography';

import { createCompany } from '../../features/create/actions.server';
import { updateCompany } from '../../features/edit/actions.server';

const companySchema = z.object({
  name: z.string().min(2, 'El nombre debe tener al menos 2 caracteres'),
  taxId: z.string().optional(),
  taxStatus: z.nativeEnum(TaxStatus).optional(),
  description: z.string().optional(),
  email: z.string().email('Email inválido').optional().or(z.literal('')),
  phone: z.string().optional(),
  address: z.string().optional(),
  country: z.string().optional(),
  industry: z.enum([INDUSTRY_TYPES.GENERAL, INDUSTRY_TYPES.AUTO_PARTS]).optional(),
  provinceId: z.union([z.coerce.number().int(), z.undefined()]),
  cityId: z.union([z.coerce.number().int(), z.undefined()]),
});

type CompanyFormData = z.infer<typeof companySchema>;

type FormValues = z.infer<typeof companySchema>;

interface CompanyFormProps {
  mode?: 'create' | 'edit';
  companyId?: string;
  defaultValues?: Partial<CompanyFormData>;
  submitLabel?: string;
  showCancelButton?: boolean;
}

export function _CompanyForm({
  mode = 'create',
  companyId,
  defaultValues,
  submitLabel,
  showCancelButton = true,
}: CompanyFormProps) {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const { data: provinces = [], isLoading: isLoadingProvinces } = useProvinces();

  const form = useForm({
    resolver: zodResolver(companySchema),
    defaultValues: {
      country: 'Argentina',
      ...defaultValues,
    },
  });

  const provinceId = form.watch('provinceId');
  const { data: cities = [], isLoading: isLoadingCities } = useCitiesByProvince(typeof provinceId === 'number' ? provinceId : null);

  useEffect(() => {
    if (!provinceId) {
      form.setValue('cityId', null as any);
    }
  }, [provinceId, form.setValue]);

  const handleFormSubmit = async (formData: z.infer<typeof companySchema>) => {
    setIsLoading(true);

    try {
      const input = {
        name: formData.name,
        taxId: formData.taxId || undefined,
        taxStatus: formData.taxStatus as TaxStatus | undefined,
        description: formData.description || undefined,
        email: formData.email || undefined,
        phone: formData.phone || undefined,
        address: formData.address || undefined,
        country: formData.country || undefined,
        industry: formData.industry || undefined,
        provinceId: formData.provinceId || undefined,
        cityId: formData.cityId || undefined,
      };

      if (mode === 'edit' && companyId) {
        await updateCompany(companyId, input);
        toast.success('Empresa actualizada correctamente');
        router.push(`/dashboard/companies/${companyId}`);
      } else {
        const company = await createCompany(input);
        toast.success('Empresa creada correctamente');
        router.push(`/dashboard/companies/${company.id}`);
      }

      router.refresh();
    } catch (error) {
      toast.error(mode === 'edit' ? 'Error al actualizar la empresa' : 'Error al crear la empresa');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <form onSubmit={form.handleSubmit(handleFormSubmit)} className="space-y-6" data-testid="company-form">
      <div className="grid gap-4 md:grid-cols-2">
        {/* Nombre */}
        <div className="space-y-2 md:col-span-2">
          <Label htmlFor="name">
            Nombre de la empresa <span className="text-destructive">*</span>
          </Label>
          <Input
            id="name"
            data-testid="company-name-input"
            {...form.register('name')}
            disabled={isLoading}
          />
          {form.formState.errors.name && (
            <p data-testid="company-name-error" className="text-sm text-destructive">
              {form.formState.errors.name.message}
            </p>
          )}
        </div>

        {/* CUIT/Tax ID */}
        <div className="space-y-2">
          <Label htmlFor="taxId">CUIT / Identificación Fiscal</Label>
          <Input
            id="taxId"
            data-testid="company-taxid-input"
            {...form.register('taxId')}
            disabled={isLoading}
          />
        </div>

        {/* Tipo de Contribuyente */}
        <div className="space-y-2">
          <Label htmlFor="taxStatus">Tipo de Contribuyente</Label>
          <Controller
            control={form.control}
            name="taxStatus"
            render={({ field }) => (
              <Select
                onValueChange={field.onChange}
                value={field.value}
                disabled={isLoading}
              >
                <SelectTrigger id="taxStatus" data-testid="company-tax-status-select">
                  <SelectValue placeholder="Seleccionar tipo" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={TaxStatus.RESPONSABLE_INSCRIPTO}>Responsable Inscripto</SelectItem>
                  <SelectItem value={TaxStatus.MONOTRIBUTO}>Monotributo</SelectItem>
                  <SelectItem value={TaxStatus.EXENTO}>Exento</SelectItem>
                </SelectContent>
              </Select>
            )}
          />
        </div>

        {/* Industria / Rubro */}
        <div className="space-y-2">
          <Label htmlFor="industry">Industria / Rubro</Label>
          <Controller
            control={form.control}
            name="industry"
            render={({ field }) => (
              <Select
                onValueChange={field.onChange}
                value={field.value}
                disabled={isLoading}
              >
                <SelectTrigger id="industry" data-testid="company-industry-select">
                  <SelectValue placeholder="Seleccionar tipo de industria" />
                </SelectTrigger>
                <SelectContent>
                  {Object.values(INDUSTRY_TYPES).map((type) => (
                    <SelectItem key={type} value={type}>
                      {INDUSTRY_LABELS[type]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
        </div>

        {/* Email */}
        <div className="space-y-2">
          <Label htmlFor="email">Email de contacto</Label>
          <Input
            id="email"
            data-testid="company-email-input"
            placeholder="contacto@miempresa.com"
            {...form.register('email')}
            disabled={isLoading}
          />
          {form.formState.errors.email && (
            <p data-testid="company-email-error" className="text-sm text-destructive">
              {form.formState.errors.email.message}
            </p>
          )}
        </div>

        {/* Teléfono */}
        <div className="space-y-2">
          <Label htmlFor="phone">Teléfono</Label>
          <Input
            id="phone"
            data-testid="company-phone-input"
            {...form.register('phone')}
            disabled={isLoading}
          />
        </div>

        {/* País */}
        <div className="space-y-2">
          <Label htmlFor="country">País</Label>
          <Input
            id="country"
            data-testid="company-country-input"
            {...form.register('country')}
            disabled={isLoading}
          />
        </div>

        {/* Dirección */}
        <div className="space-y-2">
          <Label htmlFor="address">Dirección</Label>
          <Input
            id="address"
            data-testid="company-address-input"
            {...form.register('address')}
            disabled={isLoading}
          />
        </div>

        {/* Provincia */}
        <div className="space-y-2">
          <Label htmlFor="province">Provincia</Label>
          <Controller
            control={form.control}
            name="provinceId"
            render={({ field }) => (
              <Select
                onValueChange={(value) =>
                  field.onChange(value ? Number(value) : undefined)
                }
                value={field.value ? String(field.value) : undefined}
                disabled={isLoading || isLoadingProvinces}
              >
                <SelectTrigger id="province" data-testid="company-province-select">
                  <SelectValue placeholder={
                    isLoadingProvinces ? 'Cargando provincias...' : 'Seleccionar provincia'
                  } />
                </SelectTrigger>
                <SelectContent>
                  {provinces.map((province) => (
                    <SelectItem key={province.id} value={province.id.toString()}>
                      {province.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
          {form.formState.errors.provinceId && (
            <p className="text-sm text-destructive">{form.formState.errors.provinceId.message}</p>
          )}
        </div>

        {/* Ciudad */}
        <div className="space-y-2">
          <Label htmlFor="city">Ciudad</Label>
          <Controller
            control={form.control}
            name="cityId"
            render={({ field }) => (
              <Select
                onValueChange={(value) =>
                  field.onChange(value ? Number(value) : undefined)
                }
                value={field.value ? String(field.value) : undefined}
                disabled={
                  isLoading || !provinceId || isLoadingCities || cities.length === 0
                }
              >
                <SelectTrigger id="city" data-testid="company-city-select">
                  <SelectValue
                    placeholder={
                      !provinceId
                        ? 'Selecciona una provincia'
                        : isLoadingCities
                        ? 'Cargando ciudades...'
                        : cities.length === 0
                        ? 'No hay ciudades'
                        : 'Seleccionar ciudad'
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {cities.map((city) => (
                    <SelectItem key={city.id} value={city.id.toString()}>
                      {city.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
          {form.formState.errors.cityId && (
            <p className="text-sm text-destructive">{form.formState.errors.cityId.message}</p>
          )}
        </div>

        {/* Descripción */}
        <div className="space-y-2 md:col-span-2">
          <Label htmlFor="description">Descripción</Label>
          <Textarea
            id="description"
            data-testid="company-description-input"
            placeholder="Breve descripción de la empresa..."
            {...form.register('description')}
            disabled={isLoading}
          />
        </div>
      </div>

      <div className="flex justify-end gap-2 pt-4">
        {showCancelButton && (
          <Button
            data-testid="company-cancel-button"
            type="button"
            variant="outline"
            onClick={() => router.back()}
            disabled={isLoading}
          >
            Cancelar
          </Button>
        )}
        <Button
          data-testid="company-submit-button"
          type="submit"
          disabled={isLoading}
        >
          {isLoading && <Loader2 className="mr-2 size-4 animate-spin" />}
          {submitLabel || (mode === 'edit' ? 'Guardar cambios' : 'Crear empresa')}
        </Button>
      </div>
    </form>
  );
}
