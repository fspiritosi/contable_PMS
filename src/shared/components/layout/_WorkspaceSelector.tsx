'use client';

import { Calculator, LayoutDashboard } from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { toast } from 'sonner';

import { Tabs, TabsList, TabsTrigger } from '@/shared/components/ui/tabs';
import { setActiveWorkspace } from '@/shared/lib/workspace';
import {
  getWorkspaceForRoute,
  resolveEffectiveWorkspace,
  WORKSPACES,
  type WorkspaceId,
} from '@/shared/lib/workspaces';

const ICONS: Record<WorkspaceId, typeof LayoutDashboard> = {
  gestion: LayoutDashboard,
  contable: Calculator,
};

interface WorkspaceSelectorProps {
  activeWorkspace: WorkspaceId;
  accessibleWorkspaces: WorkspaceId[];
}

export function _WorkspaceSelector({
  activeWorkspace,
  accessibleWorkspaces,
}: WorkspaceSelectorProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();

  // Solo tiene sentido el selector si el usuario accede a ambos espacios.
  if (accessibleWorkspaces.length < 2) return null;

  const current = resolveEffectiveWorkspace(pathname, accessibleWorkspaces, activeWorkspace);

  const handleChange = (value: string) => {
    const target = value as WorkspaceId;
    if (target === getWorkspaceForRoute(pathname)) return;

    startTransition(async () => {
      try {
        // Persistir primero para que el push fetchee el RSC con el nuevo estado.
        await setActiveWorkspace(target);
        // Solo push: la UI (sidebar y selector) deriva su estado de usePathname,
        // así que cambiar la ruta basta. Un router.refresh() aquí revalida la ruta
        // de origen y aborta la navegación del push (la URL no cambiaría).
        router.push(WORKSPACES[target].landing);
      } catch {
        toast.error('Error al cambiar de espacio de trabajo');
      }
    });
  };

  return (
    <Tabs value={current} onValueChange={handleChange} data-testid="workspace-selector">
      <TabsList>
        {accessibleWorkspaces.map((id) => {
          const Icon = ICONS[id];
          return (
            <TabsTrigger key={id} value={id} disabled={isPending} className="gap-1.5">
              <Icon className="h-4 w-4" />
              {WORKSPACES[id].label}
            </TabsTrigger>
          );
        })}
      </TabsList>
    </Tabs>
  );
}
