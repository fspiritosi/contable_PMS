import { WORKSPACE_IDS, type WorkspaceId } from './constants';

/** Prefijos de ruta que pertenecen al espacio Contable. */
const CONTABLE_ROUTE_PREFIXES = ['/dashboard/accounting', '/dashboard/company/accounting'];

/**
 * Determina a qué espacio pertenece un módulo de permiso.
 * accounting / accounting.* ⇒ contable; resto o nulo ⇒ gestion.
 */
export function getWorkspaceForModule(module?: string | null): WorkspaceId {
  if (module && module.startsWith('accounting')) return 'contable';
  return 'gestion';
}

/**
 * Determina el espacio al que pertenece una ruta.
 */
export function getWorkspaceForRoute(pathname: string): WorkspaceId {
  if (CONTABLE_ROUTE_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
    return 'contable';
  }
  return 'gestion';
}

/**
 * Resuelve los espacios accesibles según los permisos.
 * Backward-compat: sin ningún permiso ⇒ ambos.
 */
export function resolveAccessibleWorkspaces(input: {
  gestion: boolean;
  contable: boolean;
}): WorkspaceId[] {
  if (!input.gestion && !input.contable) return [...WORKSPACE_IDS];
  return WORKSPACE_IDS.filter((id) => input[id]);
}

/**
 * Resuelve el espacio efectivo a renderizar:
 * 1) el de la ruta actual si es accesible;
 * 2) el guardado si sigue siendo accesible;
 * 3) el primer accesible;
 * 4) 'gestion' como último recurso.
 */
export function resolveEffectiveWorkspace(
  pathname: string,
  accessible: WorkspaceId[],
  saved: WorkspaceId | null,
): WorkspaceId {
  const routeWorkspace = getWorkspaceForRoute(pathname);
  if (accessible.includes(routeWorkspace)) return routeWorkspace;
  if (saved && accessible.includes(saved)) return saved;
  return accessible[0] ?? 'gestion';
}
