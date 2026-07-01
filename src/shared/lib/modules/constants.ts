/**
 * Top-level activatable modules and their dependencies.
 * Empty activeModules on company = all modules active.
 */

export const ACTIVATABLE_MODULES = {
  employees: 'employees',
  equipment: 'equipment',
  documents: 'documents',
  commercial: 'commercial',
  accounting: 'accounting',
} as const;

export type ActivatableModule = (typeof ACTIVATABLE_MODULES)[keyof typeof ACTIVATABLE_MODULES];

/**
 * Módulos ocultos en este despliegue (fork contable PMS): no se muestran en el
 * sidebar ni en la pantalla de activación por empresa. Se mantienen en
 * ACTIVATABLE_MODULES y en PERMISSION_MODULE_MAP para no romper el mapeo de
 * permisos ni la compatibilidad con empresas existentes (activeModules).
 */
export const HIDDEN_MODULES: ActivatableModule[] = ['employees', 'equipment', 'documents'];

/** Display labels */
export const MODULE_DISPLAY_LABELS: Record<ActivatableModule, string> = {
  employees: 'Empleados',
  equipment: 'Equipos',
  documents: 'Documentos',
  commercial: 'Comercial',
  accounting: 'Contabilidad',
};

/** Module descriptions */
export const MODULE_DESCRIPTIONS: Record<ActivatableModule, string> = {
  employees: 'Gestión de empleados, legajos, documentación laboral',
  equipment: 'Gestión de equipos, vehículos, mantenimiento',
  documents: 'Gestión documental, tipos de documentos, vencimientos',
  commercial: 'Ventas, compras, productos, stock, tesorería, cotizaciones',
  accounting: 'Plan de cuentas, asientos contables, informes, presupuestos',
};

/** Module icons (lucide icon names for reference) */
export const MODULE_ICONS: Record<ActivatableModule, string> = {
  employees: 'Users',
  equipment: 'Truck',
  documents: 'FileText',
  commercial: 'ShoppingCart',
  accounting: 'Calculator',
};

/**
 * Dependencies: key requires all modules in value array to be active.
 * When activating a module, its dependencies are auto-activated.
 * When deactivating a module, dependents are auto-deactivated.
 */
export const MODULE_DEPENDENCIES: Record<string, ActivatableModule[]> = {
  accounting: ['commercial'], // Accounting needs commercial for journal entries from invoices
};

/**
 * Maps permission modules (from permissions/constants.ts) to their parent activatable module.
 * If a permission module starts with any of these prefixes, it belongs to that activatable module.
 */
export const PERMISSION_MODULE_MAP: Record<string, ActivatableModule> = {
  // Main modules
  employees: 'employees',
  equipment: 'equipment',
  documents: 'documents',
  accounting: 'accounting',

  // Commercial and all sub-modules
  commercial: 'commercial',

  // Company config that depends on parent modules
  'company.cost-centers': 'employees',
  'company.contract-types': 'employees',
  'company.job-positions': 'employees',
  'company.job-categories': 'employees',
  'company.unions': 'employees',
  'company.collective-agreements': 'employees',

  'company.vehicle-brands': 'equipment',
  'company.vehicle-types': 'equipment',
  'company.equipment-owners': 'equipment',
  'company.sectors': 'equipment',
  'company.type-operatives': 'equipment',
  'company.contractors': 'equipment',

  'company.document-types': 'documents',
  'company.discount-presets': 'commercial',
};

/**
 * Check if a permission module is active for a company.
 * Empty activeModules = all active (backward compatible).
 */
export function isModuleActiveForCompany(
  permissionModule: string,
  activeModules: string[],
): boolean {
  // Empty = all active (default for existing companies)
  if (!activeModules || activeModules.length === 0) return true;

  // Find the parent activatable module for this permission module
  // Check exact match first, then prefix match
  const parentModule =
    PERMISSION_MODULE_MAP[permissionModule] ||
    Object.entries(PERMISSION_MODULE_MAP).find(
      ([prefix]) => permissionModule.startsWith(prefix + '.'),
    )?.[1];

  // If no mapping found, module is always active (e.g., dashboard, company.general.*)
  if (!parentModule) return true;

  return activeModules.includes(parentModule);
}

/**
 * Resolve dependencies when toggling modules.
 * Returns the final set of active modules after applying dependency rules.
 */
export function resolveModuleDependencies(modules: ActivatableModule[]): ActivatableModule[] {
  const result = new Set(modules);

  // Add dependencies for active modules
  for (const mod of modules) {
    const deps = MODULE_DEPENDENCIES[mod];
    if (deps) {
      for (const dep of deps) {
        result.add(dep);
      }
    }
  }

  // Remove modules whose dependencies are not met
  let changed = true;
  while (changed) {
    changed = false;
    for (const mod of [...result]) {
      const deps = MODULE_DEPENDENCIES[mod];
      if (deps && !deps.every((d) => result.has(d))) {
        result.delete(mod);
        changed = true;
      }
    }
  }

  return [...result];
}

/**
 * Get modules that depend on the given module (would be deactivated if this one is).
 */
export function getDependentModules(module: ActivatableModule): ActivatableModule[] {
  return Object.entries(MODULE_DEPENDENCIES)
    .filter(([, deps]) => deps.includes(module))
    .map(([mod]) => mod as ActivatableModule);
}
