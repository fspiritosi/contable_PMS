/**
 * Espacios de Trabajo de la aplicación.
 * Son exactamente dos y fijos: Gestión y Contable.
 */
export type WorkspaceId = 'gestion' | 'contable';

interface WorkspaceDef {
  id: WorkspaceId;
  label: string;
  /** Permiso RBAC requerido para acceder al espacio. */
  permission: string;
  /** Ruta de inicio al activar el espacio. */
  landing: string;
}

export const WORKSPACES: Record<WorkspaceId, WorkspaceDef> = {
  gestion: {
    id: 'gestion',
    label: 'Gestión',
    permission: 'workspace.gestion',
    landing: '/dashboard',
  },
  contable: {
    id: 'contable',
    label: 'Contable',
    permission: 'workspace.contable',
    landing: '/dashboard/accounting',
  },
};

export const WORKSPACE_IDS: WorkspaceId[] = ['gestion', 'contable'];
