'use client';

import type { CompanyListItem } from '@/modules/companies/features/list/actions.server';
import { IndustryProvider } from '@/providers/IndustryProvider';
import type { SidebarPermissions } from '@/shared/actions/sidebar';
import type { IndustryType } from '@/shared/lib/industry';
import type { WorkspaceId } from '@/shared/lib/workspaces';
import { SidebarInset, SidebarProvider } from '@/shared/components/ui/sidebar';
import { _AppSidebar } from './_AppSidebar';
import { _SiteHeader } from './_SiteHeader';

interface DashboardLayoutProps {
  children: React.ReactNode;
  companies: CompanyListItem[];
  activeCompany: CompanyListItem;
  isSingleMode?: boolean;
  sidebarPermissions: SidebarPermissions;
  industryType: IndustryType;
  activeWorkspace: WorkspaceId;
  accessibleWorkspaces: WorkspaceId[];
}

/**
 * Layout del Dashboard con Sidebar colapsable
 *
 * Usa el patrón SidebarProvider de shadcn/ui
 * IndustryProvider expone el tipo de industria a todos los client components hijos
 */
export function DashboardLayout({
  children,
  companies,
  activeCompany,
  isSingleMode = false,
  sidebarPermissions,
  industryType,
  activeWorkspace,
  accessibleWorkspaces,
}: DashboardLayoutProps) {
  return (
    <SidebarProvider>
      <_AppSidebar
        companies={companies}
        activeCompany={activeCompany}
        isSingleMode={isSingleMode}
        permissions={sidebarPermissions}
        activeWorkspace={activeWorkspace}
        accessibleWorkspaces={accessibleWorkspaces}
      />
      <SidebarInset>
        <_SiteHeader
          activeWorkspace={activeWorkspace}
          accessibleWorkspaces={accessibleWorkspaces}
        />
        <IndustryProvider industryType={industryType}>
          <div className="flex flex-1 flex-col gap-4 p-4">{children}</div>
        </IndustryProvider>
      </SidebarInset>
    </SidebarProvider>
  );
}
