'use client';

import { Checkbox } from '@/shared/components/ui/checkbox';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/shared/components/ui/table';
import { Badge } from '@/shared/components/ui/badge';
import { ACTION_LABELS } from '@/shared/lib/permissions';

import type { SystemAction } from '../actions.server';

interface ModuleItem {
  key: string;
  label: string;
}

interface ModuleGroup {
  name: string;
  modules: ModuleItem[];
}

interface PermissionsConfigProps {
  actions: SystemAction[];
  moduleGroups: ModuleGroup[];
  availableActions: string[];
}

interface Props {
  systemActions: SystemAction[];
  permissionsConfig: PermissionsConfigProps;
  selectedPermissions: Array<{ module: string; actionId: string }>;
  onPermissionChange: (module: string, actionId: string, checked: boolean) => void;
  disabled?: boolean;
}

export function _PermissionsMatrix({
  systemActions,
  permissionsConfig,
  selectedPermissions,
  onPermissionChange,
  disabled = false,
}: Props) {
  const { moduleGroups, availableActions } = permissionsConfig;

  // Crear un mapa de actionSlug -> actionId
  const actionMap = new Map(systemActions.map((a) => [a.slug, a.id]));

  // Verificar si un permiso está seleccionado
  const isPermissionSelected = (module: string, actionSlug: string): boolean => {
    const actionId = actionMap.get(actionSlug);
    if (!actionId) return false;
    return selectedPermissions.some((p) => p.module === module && p.actionId === actionId);
  };

  // Manejar cambio de permiso
  const handleChange = (module: string, actionSlug: string, checked: boolean) => {
    const actionId = actionMap.get(actionSlug);
    if (!actionId) return;
    onPermissionChange(module, actionId, checked);
  };

  // Manejar seleccionar todos de una fila
  const handleSelectAllRow = (module: string) => {
    const allSelected = availableActions.every((action) =>
      isPermissionSelected(module, action)
    );

    availableActions.forEach((action) => {
      handleChange(module, action, !allSelected);
    });
  };

  // Manejar seleccionar todos de una columna
  const handleSelectAllColumn = (actionSlug: string) => {
    const allModules = moduleGroups.flatMap((g) => g.modules);
    const allSelected = allModules.every((m) =>
      isPermissionSelected(m.key, actionSlug)
    );

    allModules.forEach((m) => {
      handleChange(m.key, actionSlug, !allSelected);
    });
  };

  // Estado de selección de un grupo/Card completo (todos sus módulos × acciones)
  const isGroupFullySelected = (group: ModuleGroup): boolean =>
    group.modules.length > 0 &&
    group.modules.every((m) =>
      availableActions.every((action) => isPermissionSelected(m.key, action))
    );

  const isGroupPartiallySelected = (group: ModuleGroup): boolean =>
    group.modules.some((m) =>
      availableActions.some((action) => isPermissionSelected(m.key, action))
    );

  // Seleccionar/deseleccionar todos los permisos de un grupo/Card
  const handleSelectAllGroup = (group: ModuleGroup) => {
    const target = !isGroupFullySelected(group);
    group.modules.forEach((m) => {
      availableActions.forEach((action) => {
        if (isPermissionSelected(m.key, action) !== target) {
          handleChange(m.key, action, target);
        }
      });
    });
  };

  return (
    <div className="space-y-6">
      {moduleGroups.map((group) => {
        const groupAllSelected = isGroupFullySelected(group);
        const groupSomeSelected = isGroupPartiallySelected(group);
        return (
        <div key={group.name} className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-sm text-muted-foreground">{group.name}</h3>
            <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer select-none">
              <Checkbox
                checked={groupAllSelected ? true : groupSomeSelected ? 'indeterminate' : false}
                onCheckedChange={() => handleSelectAllGroup(group)}
                disabled={disabled}
                aria-label={`Seleccionar todos los permisos de ${group.name}`}
              />
              Seleccionar todo
            </label>
          </div>
          <div className="border rounded-lg overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[200px]">Módulo</TableHead>
                  {availableActions.map((action) => (
                    <TableHead key={action} className="text-center w-[100px]">
                      <button
                        type="button"
                        onClick={() => handleSelectAllColumn(action)}
                        disabled={disabled}
                        className="hover:text-primary transition-colors disabled:hover:text-current"
                      >
                        {ACTION_LABELS[action as keyof typeof ACTION_LABELS] || action}
                      </button>
                    </TableHead>
                  ))}
                  <TableHead className="w-[60px] text-center">Todos</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {group.modules.map((module) => {
                  const allSelected = availableActions.every((action) =>
                    isPermissionSelected(module.key, action)
                  );
                  const someSelected = availableActions.some((action) =>
                    isPermissionSelected(module.key, action)
                  );

                  return (
                    <TableRow key={module.key}>
                      <TableCell className="font-medium">
                        {module.label}
                      </TableCell>
                      {availableActions.map((action) => (
                        <TableCell key={action} className="text-center">
                          <Checkbox
                            checked={isPermissionSelected(module.key, action)}
                            onCheckedChange={(checked) =>
                              handleChange(module.key, action, !!checked)
                            }
                            disabled={disabled}
                          />
                        </TableCell>
                      ))}
                      <TableCell className="text-center">
                        <Checkbox
                          checked={allSelected}
                          onCheckedChange={() => handleSelectAllRow(module.key)}
                          disabled={disabled}
                          className={someSelected && !allSelected ? 'data-[state=checked]:bg-muted' : ''}
                        />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </div>
        );
      })}

      {/* Resumen de permisos */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Badge variant="outline">{selectedPermissions.length}</Badge>
        <span>permisos seleccionados</span>
      </div>
    </div>
  );
}
