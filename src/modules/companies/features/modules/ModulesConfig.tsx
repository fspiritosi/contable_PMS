import { PermissionGuard } from '@/shared/components/common/PermissionGuard';
import { getCompanyActiveModules } from './actions.server';
import { _ModulesConfigForm } from './components/_ModulesConfigForm';

/**
 * Configuración de Módulos Activos - Server Component
 *
 * Permite activar/desactivar módulos de la empresa.
 * Módulos desactivados desaparecen del sidebar, permisos y dashboard.
 */
export async function ModulesConfig() {
  return (
    <PermissionGuard module="company.general.users" action="view" redirect>
      <ModulesConfigContent />
    </PermissionGuard>
  );
}

async function ModulesConfigContent() {
  const activeModules = await getCompanyActiveModules();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Módulos Activos</h1>
        <p className="text-muted-foreground">
          Configurá qué módulos están disponibles para tu empresa. Los módulos desactivados no
          aparecerán en el menú lateral ni estarán accesibles.
        </p>
      </div>
      <_ModulesConfigForm initialActiveModules={activeModules} />
    </div>
  );
}
