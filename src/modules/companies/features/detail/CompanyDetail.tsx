import { Badge } from '@/shared/components/ui/badge';
import { Button } from '@/shared/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/shared/components/ui/card';
import { getActiveCompany } from '@/shared/lib/company';
import { logger } from '@/shared/lib/logger';
import { ArrowLeft, Building2, Pencil } from 'lucide-react';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getCompanyById } from './actions.server';
import { _DeleteCompanyButton } from './components/_DeleteCompanyButton';
import { _SingleModeToggle } from './components/_SingleModeToggle';
import { _CompanyLogoUpload } from './components/_CompanyLogoUpload';

const ERROR_CODES = {
  NotFound: 'COMPANY_NOT_FOUND',
  Forbidden: 'COMPANY_FORBIDDEN',
} as const;

interface CompanyDetailPageProps {
  companyId: string;
}

export async function CompanyDetailPage(props: CompanyDetailPageProps) {
  logger.info('CompanyDetailPage props:', { data: { props } });

  if (!props?.companyId) {
    throw new Error('Company ID is required in CompanyDetailPage');
  }

  let company;

  try {
    company = await getCompanyById(props.companyId);
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === ERROR_CODES.NotFound) {
        notFound();
      }

      if (error.message === ERROR_CODES.Forbidden) {
        redirect('/dashboard/companies');
      }
    }

    throw error;
  }

  if (!company) {
    notFound();
  }

  // Obtener si está en modo single para el botón "volver"
  // Si es single mode, volver a /dashboard en lugar de /dashboard/companies
  // (evita ciclo de redirección)
  const activeCompany = await getActiveCompany();
  const backHref = activeCompany?.isSingleMode ? '/dashboard' : '/dashboard/companies';

  return (
    <div className="flex flex-1 flex-col gap-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" asChild>
            <Link href={backHref}>
              <ArrowLeft className="size-4" />
            </Link>
          </Button>
          <div className="flex items-center gap-3">
            <Building2 className="size-8 text-primary" />
            <div>
              <div className="flex items-center gap-2">
                <h1 data-testid="company-detail-title" className="text-2xl font-bold">
                  {company.name}
                </h1>
                {company.isOwner && (
                  <Badge data-testid="company-owner-badge" variant="secondary">
                    Propietario
                  </Badge>
                )}
              </div>
              <p className="text-sm text-muted-foreground">
                {company.memberCount} miembro{company.memberCount !== 1 ? 's' : ''}
              </p>
            </div>
          </div>
        </div>

        {company.isOwner && (
          <div className="flex gap-2">
            <Button data-testid="company-edit-button" variant="outline" asChild>
              <Link href={`/dashboard/companies/${props.companyId}/edit`}>
                <Pencil className="mr-2 size-4" />
                Editar
              </Link>
            </Button>
            <_DeleteCompanyButton companyId={props.companyId} companyName={company.name} />
          </div>
        )}
      </div>

      {/* Details */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card data-testid="company-general-info-card">
          <CardHeader>
            <CardTitle data-testid="company-general-info-title">Información General</CardTitle>
            <CardDescription>Datos básicos de la empresa</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Nombre</p>
                <p>{company.name}</p>
              </div>
              {company.taxId && (
                <div>
                  <p className="text-sm font-medium text-muted-foreground">CUIT</p>
                  <p>{company.taxId}</p>
                </div>
              )}
              {company.taxStatus && (
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Tipo de Contribuyente</p>
                  <p>{company.taxStatus === 'RESPONSABLE_INSCRIPTO' ? 'Responsable Inscripto'
                     : company.taxStatus === 'MONOTRIBUTO' ? 'Monotributo'
                     : 'Exento'}</p>
                </div>
              )}
              {company.industry && (
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Industria</p>
                  <p>{company.industry}</p>
                </div>
              )}
              {company.country && (
                <div>
                  <p className="text-sm font-medium text-muted-foreground">País</p>
                  <p>{company.country}</p>
                </div>
              )}
            </div>
            {company.description && (
              <div>
                <p className="text-sm font-medium text-muted-foreground">Descripción</p>
                <p className="text-sm">{company.description}</p>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Contacto</CardTitle>
            <CardDescription>Información de contacto</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              {company.email && (
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Email</p>
                  <p>{company.email}</p>
                </div>
              )}
              {company.phone && (
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Teléfono</p>
                  <p>{company.phone}</p>
                </div>
              )}
            </div>
            {company.address && (
              <div>
                <p className="text-sm font-medium text-muted-foreground">Dirección</p>
                <p className="text-sm">{company.address}</p>
              </div>
            )}
            {(company.province || company.city) && (
              <div>
                <p className="text-sm font-medium text-muted-foreground">Ubicación</p>
                <p className="text-sm">
                  {[company.city?.name, company.province?.name].filter(Boolean).join(', ')}
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Single Mode Toggle - Solo visible en DEV */}
      <_SingleModeToggle
        companyId={props.companyId}
        isSingleCompany={company.isSingleCompany}
        isOwner={company.isOwner}
      />

      {/* Logo de la Empresa */}
      <_CompanyLogoUpload
        companyId={props.companyId}
        logoUrl={company.logoUrl}
        canEdit={company.isOwner}
      />
    </div>
  );
}
