import { Button } from '@/shared/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/shared/components/ui/card';
import { ArrowLeft, Building2 } from 'lucide-react';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getCompanyById } from '../detail/actions.server';

const ERROR_CODES = {
  NotFound: 'COMPANY_NOT_FOUND',
  Forbidden: 'COMPANY_FORBIDDEN',
} as const;

import { _CompanyForm } from '../../shared/components';
import { getIndustryType } from '@/shared/lib/industry';

interface CompanyEditPageProps {
  companyId: string;
}

export async function CompanyEdit({ companyId }: CompanyEditPageProps) {
  let company;

  try {
    company = await getCompanyById(companyId);
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === ERROR_CODES.Forbidden) {
        redirect('/dashboard/companies');
      }

      if (error.message === ERROR_CODES.NotFound) {
        notFound();
      }
    }

    throw error;
  }

  if (!company) {
    notFound();
  }

  // Solo el owner puede editar
  if (!company.isOwner) {
    redirect(`/dashboard/companies/${companyId}`);
  }

  return (
    <div className="flex flex-1 flex-col gap-4">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" asChild>
          <Link href={`/dashboard/companies/${companyId}`}>
            <ArrowLeft className="size-4" />
          </Link>
        </Button>
        <div className="flex items-center gap-3">
          <Building2 className="size-8 text-primary" />
          <div>
            <h1 data-testid="company-edit-page-title" className="text-2xl font-bold">
              Editar Empresa
            </h1>
            <p data-testid="company-edit-page-subtitle" className="text-sm text-muted-foreground">
              {company.name}
            </p>
          </div>
        </div>
      </div>

      {/* Form */}
      <Card>
        <CardHeader>
          <CardTitle>Datos de la Empresa</CardTitle>
          <CardDescription>Modifica la información de tu empresa</CardDescription>
        </CardHeader>
        <CardContent>
          <_CompanyForm
            mode="edit"
            companyId={companyId}
            defaultValues={{
              name: company.name,
              taxId: company.taxId ?? undefined,
              taxStatus: company.taxStatus ?? undefined,
              description: company.description ?? undefined,
              email: company.email ?? undefined,
              phone: company.phone ?? undefined,
              address: company.address ?? undefined,
              country: company.country ?? undefined,
              industry: getIndustryType(company.industry),
              provinceId: company.provinceId ?? undefined,
              cityId: company.cityId ?? undefined,
            }}
          />
        </CardContent>
      </Card>
    </div>
  );
}
