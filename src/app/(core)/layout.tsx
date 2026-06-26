import { getActiveCompany } from '@/shared/lib/company';
// import { getMyCompanies } from '@/modules/companies/features/list/actions.server';
import { NoCompanyFallback } from '@/modules/companies';
import { getMyCompanies } from '@/modules/companies/features/list';
import { getSidebarPermissions } from '@/shared/actions/sidebar';
import { getIndustryType } from '@/shared/lib/industry';
import { DashboardLayout } from '@/shared/components/layout/DashboardLayout';
import { OnboardingGate } from '@/modules/onboarding/features/company-setup';
import { getActiveWorkspace, getAccessibleWorkspaces } from '@/shared/lib/workspace';

/**
 * Layout del Dashboard
 *
 * Server Component - Verifica company activa y renderiza layout o fallback
 */
export default async function Layout({ children }: { children: React.ReactNode }) {
  const activeCompany = await getActiveCompany();

  // Si no tiene company, mostrar fallback para crear una
  if (!activeCompany) {
    return <NoCompanyFallback />;
  }

  const industryType = getIndustryType(activeCompany.industry);

  // Obtener companies y permisos del sidebar en paralelo
  const [companies, sidebarPermissions, activeWorkspace, accessibleWorkspaces] = await Promise.all([
    getMyCompanies(),
    getSidebarPermissions(activeCompany.industry, activeCompany.activeModules),
    getActiveWorkspace(),
    getAccessibleWorkspaces(),
  ]);

  return (
    <DashboardLayout
      companies={companies}
      activeCompany={activeCompany}
      isSingleMode={activeCompany.isSingleMode}
      sidebarPermissions={sidebarPermissions}
      industryType={industryType}
      activeWorkspace={activeWorkspace}
      accessibleWorkspaces={accessibleWorkspaces}
    >
      {children}
      <OnboardingGate />
    </DashboardLayout>
  );
}
