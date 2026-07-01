'use client';

import {
  Calculator,
  FileText,
  Info,
  Loader2,
  RotateCcw,
  Save,
  ShoppingCart,
  Truck,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { useState, useCallback } from 'react';
import { toast } from 'sonner';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/shared/components/ui/alert-dialog';
import { Alert, AlertDescription } from '@/shared/components/ui/alert';
import { Badge } from '@/shared/components/ui/badge';
import { Button } from '@/shared/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/shared/components/ui/card';
import { Switch } from '@/shared/components/ui/switch';
import {
  ACTIVATABLE_MODULES,
  HIDDEN_MODULES,
  MODULE_DEPENDENCIES,
  MODULE_DESCRIPTIONS,
  MODULE_DISPLAY_LABELS,
  getDependentModules,
  type ActivatableModule,
} from '@/shared/lib/modules';
import { usePermissions } from '@/shared/hooks/usePermissions';
import { updateCompanyModules } from '../actions.server';

const ICON_MAP: Record<ActivatableModule, LucideIcon> = {
  employees: Users,
  equipment: Truck,
  documents: FileText,
  commercial: ShoppingCart,
  accounting: Calculator,
};

/** Order for display (se ocultan los módulos de HIDDEN_MODULES en este fork) */
const MODULE_ORDER: ActivatableModule[] = (
  ['employees', 'equipment', 'documents', 'commercial', 'accounting'] as ActivatableModule[]
).filter((m) => !HIDDEN_MODULES.includes(m));

interface Props {
  initialActiveModules: string[];
}

export function _ModulesConfigForm({ initialActiveModules }: Props) {
  const { hasPermission } = usePermissions();
  const canUpdate = hasPermission('company.general.users', 'update');

  // Empty = all active
  const allModules = Object.values(ACTIVATABLE_MODULES);
  const isAllActive = initialActiveModules.length === 0;

  const [activeModules, setActiveModules] = useState<Set<ActivatableModule>>(
    isAllActive ? new Set(allModules) : new Set(initialActiveModules as ActivatableModule[]),
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [deactivateDialog, setDeactivateDialog] = useState<{
    module: ActivatableModule;
    dependents: ActivatableModule[];
  } | null>(null);

  // Track if changes were made
  const hasChanges = (() => {
    if (isAllActive) {
      // Started as "all active" - changed if not all are selected
      return activeModules.size !== allModules.length;
    }
    // Compare sets
    const initialSet = new Set(initialActiveModules);
    if (activeModules.size !== initialSet.size) return true;
    for (const mod of activeModules) {
      if (!initialSet.has(mod)) return true;
    }
    return false;
  })();

  const handleToggle = useCallback(
    (module: ActivatableModule, enabled: boolean) => {
      if (!canUpdate) return;

      if (enabled) {
        // When enabling, auto-enable dependencies
        const newModules = new Set(activeModules);
        newModules.add(module);

        const deps = MODULE_DEPENDENCIES[module];
        if (deps) {
          const addedDeps: string[] = [];
          for (const dep of deps) {
            if (!newModules.has(dep)) {
              newModules.add(dep);
              addedDeps.push(MODULE_DISPLAY_LABELS[dep]);
            }
          }
          if (addedDeps.length > 0) {
            toast.info(`Se activó automáticamente: ${addedDeps.join(', ')}`, {
              description: `${MODULE_DISPLAY_LABELS[module]} requiere estos módulos.`,
            });
          }
        }

        setActiveModules(newModules);
      } else {
        // When disabling, check for dependents
        const dependents = getDependentModules(module).filter((dep) =>
          activeModules.has(dep),
        );

        if (dependents.length > 0) {
          setDeactivateDialog({ module, dependents });
        } else {
          const newModules = new Set(activeModules);
          newModules.delete(module);
          setActiveModules(newModules);
        }
      }
    },
    [activeModules, canUpdate],
  );

  const confirmDeactivate = useCallback(() => {
    if (!deactivateDialog) return;

    const newModules = new Set(activeModules);
    newModules.delete(deactivateDialog.module);

    // Also deactivate dependents
    for (const dep of deactivateDialog.dependents) {
      newModules.delete(dep);
    }

    setActiveModules(newModules);
    setDeactivateDialog(null);
  }, [deactivateDialog, activeModules]);

  const handleSave = async () => {
    setIsSubmitting(true);
    try {
      // If all are selected, save empty array (= all active, default)
      const modulesToSave =
        activeModules.size === allModules.length ? [] : [...activeModules];

      const result = await updateCompanyModules(modulesToSave);
      if (result.success) {
        toast.success('Módulos actualizados correctamente', {
          description: 'Los cambios se reflejarán en el menú lateral.',
        });
      }
    } catch {
      toast.error('Error al actualizar los módulos');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRestoreAll = () => {
    setActiveModules(new Set(allModules));
  };

  return (
    <div className="space-y-6">
      {/* Status indicator */}
      {activeModules.size === allModules.length ? (
        <Alert>
          <Info className="h-4 w-4" />
          <AlertDescription>
            Todos los módulos están activos. Tu empresa tiene acceso a todas las funcionalidades
            disponibles.
          </AlertDescription>
        </Alert>
      ) : (
        <Alert variant="destructive">
          <Info className="h-4 w-4" />
          <AlertDescription>
            Hay {allModules.length - activeModules.size} módulo(s) desactivado(s). Los módulos
            inactivos no aparecen en el menú lateral ni son accesibles.
          </AlertDescription>
        </Alert>
      )}

      {/* Module cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {MODULE_ORDER.map((module) => {
          const Icon = ICON_MAP[module];
          const isActive = activeModules.has(module);
          const deps = MODULE_DEPENDENCIES[module];
          const dependents = getDependentModules(module).filter((dep) =>
            activeModules.has(dep),
          );

          return (
            <Card
              key={module}
              className={`transition-colors ${!isActive ? 'opacity-60 border-dashed' : ''}`}
            >
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <div className="flex items-center gap-3">
                  <div
                    className={`rounded-lg p-2 ${isActive ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'}`}
                  >
                    <Icon className="h-5 w-5" />
                  </div>
                  <div>
                    <CardTitle className="text-base">{MODULE_DISPLAY_LABELS[module]}</CardTitle>
                    {isActive ? (
                      <Badge variant="default" className="mt-1 text-xs">
                        Activo
                      </Badge>
                    ) : (
                      <Badge variant="secondary" className="mt-1 text-xs">
                        Inactivo
                      </Badge>
                    )}
                  </div>
                </div>
                <Switch
                  checked={isActive}
                  onCheckedChange={(checked) => handleToggle(module, checked)}
                  disabled={!canUpdate || isSubmitting}
                  aria-label={`Activar/desactivar ${MODULE_DISPLAY_LABELS[module]}`}
                />
              </CardHeader>
              <CardContent>
                <CardDescription className="text-sm">
                  {MODULE_DESCRIPTIONS[module]}
                </CardDescription>

                {deps && deps.length > 0 && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Requiere:{' '}
                    {deps.map((d) => MODULE_DISPLAY_LABELS[d]).join(', ')}
                  </p>
                )}
                {dependents.length > 0 && isActive && (
                  <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
                    Requerido por:{' '}
                    {dependents.map((d) => MODULE_DISPLAY_LABELS[d]).join(', ')}
                  </p>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Actions */}
      {canUpdate && (
        <div className="flex items-center gap-3">
          <Button onClick={handleSave} disabled={!hasChanges || isSubmitting}>
            {isSubmitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Guardando...
              </>
            ) : (
              <>
                <Save className="mr-2 h-4 w-4" />
                Guardar Cambios
              </>
            )}
          </Button>
          {activeModules.size !== allModules.length && (
            <Button variant="outline" onClick={handleRestoreAll} disabled={isSubmitting}>
              <RotateCcw className="mr-2 h-4 w-4" />
              Restaurar Todos
            </Button>
          )}
        </div>
      )}

      {/* Deactivation confirmation dialog */}
      <AlertDialog
        open={!!deactivateDialog}
        onOpenChange={(open) => !open && setDeactivateDialog(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Desactivar módulo</AlertDialogTitle>
            <AlertDialogDescription>
              Al desactivar{' '}
              <strong>
                {deactivateDialog
                  ? MODULE_DISPLAY_LABELS[deactivateDialog.module]
                  : ''}
              </strong>
              , también se desactivará:
              <span className="mt-2 block font-medium text-foreground">
                {deactivateDialog?.dependents
                  .map((d) => MODULE_DISPLAY_LABELS[d])
                  .join(', ')}
              </span>
              <span className="mt-2 block">
                Estos módulos dependen del módulo que estás desactivando.
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDeactivate}>
              Desactivar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
