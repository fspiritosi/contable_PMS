'use client';

import { usePathname } from 'next/navigation';
import { Separator } from '@/shared/components/ui/separator';
import { SidebarTrigger } from '@/shared/components/ui/sidebar';
import type { WorkspaceId } from '@/shared/lib/workspaces';
import { _WorkspaceSelector } from './_WorkspaceSelector';

// Mapeo de rutas a títulos
const routeTitles: Record<string, string> = {
  '/dashboard': 'Dashboard',
  '/dashboard/employees': 'Empleados',
  '/dashboard/teams': 'Equipos',
  '/dashboard/documents': 'Documentos',
  '/dashboard/company/commercial': 'Comercial',
  '/dashboard/operations': 'Operaciones',
  '/dashboard/maintenance': 'Mantenimiento',
  '/dashboard/companies': 'Empresas',
  '/dashboard/company': 'Empresa',
  '/dashboard/settings': 'Configuración',
  '/dashboard/help': 'Ayuda',
};

function getPageTitle(pathname: string): string {
  // Buscar coincidencia exacta primero
  if (routeTitles[pathname]) {
    return routeTitles[pathname];
  }

  // Buscar coincidencia parcial (para rutas dinámicas)
  for (const [route, title] of Object.entries(routeTitles)) {
    if (pathname.startsWith(route) && route !== '/dashboard') {
      return title;
    }
  }

  return 'Dashboard';
}

interface SiteHeaderProps {
  activeWorkspace: WorkspaceId;
  accessibleWorkspaces: WorkspaceId[];
}

/**
 * Header del sitio con trigger del sidebar
 */
export function _SiteHeader({ activeWorkspace, accessibleWorkspaces }: SiteHeaderProps) {
  const pathname = usePathname();
  const pageTitle = getPageTitle(pathname);

  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b transition-[width,height] ease-linear group-has-[[data-collapsible=icon]]/sidebar-wrapper:h-12">
      <div className="flex w-full items-center gap-1 px-4 lg:gap-2 lg:px-6">
        <SidebarTrigger className="-ml-1" />
        <Separator
          orientation="vertical"
          className="mx-2 data-[orientation=vertical]:h-4"
        />
        <h1 className="text-base font-medium">{pageTitle}</h1>
        <div className="ml-auto">
          <_WorkspaceSelector
            activeWorkspace={activeWorkspace}
            accessibleWorkspaces={accessibleWorkspaces}
          />
        </div>
      </div>
    </header>
  );
}
