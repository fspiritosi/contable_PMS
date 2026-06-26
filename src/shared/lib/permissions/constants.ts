/**
 * Constantes del sistema de permisos RBAC
 *
 * Los módulos siguen la convención de rutas:
 * - Módulos principales: "employees", "equipment", "documents"
 * - Submódulos: "company.cost-centers", "commercial.clients"
 */

// ============================================
// MÓDULOS DEL SISTEMA
// ============================================

export const MODULES = {
  // Módulos principales
  dashboard: 'dashboard',
  employees: 'employees',
  equipment: 'equipment',
  documents: 'documents',
  accounting: 'accounting',

  // Módulo Comercial
  commercial: 'commercial',
  'commercial.clients': 'commercial.clients',
  'commercial.leads': 'commercial.leads',
  'commercial.contacts': 'commercial.contacts',
  'commercial.quotes': 'commercial.quotes',
  'commercial.suppliers': 'commercial.suppliers',
  'commercial.categories': 'commercial.categories',
  'commercial.products': 'commercial.products',
  'commercial.price-lists': 'commercial.price-lists',
  'commercial.warehouses': 'commercial.warehouses',
  'commercial.stock': 'commercial.stock',
  'commercial.movements': 'commercial.movements',
  'commercial.points-of-sale': 'commercial.points-of-sale',
  'commercial.invoices': 'commercial.invoices',
  'commercial.purchases': 'commercial.purchases',
  'commercial.purchase-orders': 'commercial.purchase-orders',
  'commercial.receiving-notes': 'commercial.receiving-notes',
  'commercial.delivery-notes': 'commercial.delivery-notes',
  'commercial.treasury.cash-registers': 'commercial.treasury.cash-registers',
  'commercial.treasury.bank-accounts': 'commercial.treasury.bank-accounts',
  'commercial.treasury.receipts': 'commercial.treasury.receipts',
  'commercial.treasury.payment-orders': 'commercial.treasury.payment-orders',
  'commercial.treasury.checks': 'commercial.treasury.checks',
  'commercial.treasury.projections': 'commercial.treasury.projections',
  'commercial.treasury.cashflow': 'commercial.treasury.cashflow',
  'commercial.treasury.partners': 'commercial.treasury.partners',
  'commercial.treasury.cards': 'commercial.treasury.cards',
  'commercial.expenses': 'commercial.expenses',
  'commercial.equivalences': 'commercial.equivalences',

  // Configuración de Empresa - General
  'company.general.users': 'company.general.users',
  'company.general.roles': 'company.general.roles',
  'company.general.audit': 'company.general.audit',
  'company.documents': 'company.documents',

  // Configuración de Empresa - Catálogos RRHH
  'company.cost-centers': 'company.cost-centers',
  'company.contract-types': 'company.contract-types',
  'company.job-positions': 'company.job-positions',
  'company.job-categories': 'company.job-categories',
  'company.unions': 'company.unions',
  'company.collective-agreements': 'company.collective-agreements',

  // Configuración de Empresa - Catálogos Equipos
  'company.vehicle-brands': 'company.vehicle-brands',
  'company.vehicle-types': 'company.vehicle-types',
  'company.equipment-owners': 'company.equipment-owners',
  'company.sectors': 'company.sectors',
  'company.type-operatives': 'company.type-operatives',
  'company.contractors': 'company.contractors',

  // Configuración de Empresa - Tipos de Documento
  'company.document-types': 'company.document-types',

  // Configuración de Empresa - Comercial
  'company.discount-presets': 'company.discount-presets',

  // Módulo Contable
  'accounting.accounts': 'accounting.accounts',
  'accounting.entries': 'accounting.entries',
  'accounting.reports': 'accounting.reports',
  'accounting.settings': 'accounting.settings',
  'accounting.fiscal-year-close': 'accounting.fiscal-year-close',
  'accounting.recurring-entries': 'accounting.recurring-entries',
  'accounting.opening-balances': 'accounting.opening-balances',
  'accounting.budgets': 'accounting.budgets',

  // Espacios de Trabajo
  'workspace.gestion': 'workspace.gestion',
  'workspace.contable': 'workspace.contable',
} as const;

export type Module = (typeof MODULES)[keyof typeof MODULES];

// ============================================
// ACCIONES DISPONIBLES
// ============================================

export const ACTIONS = {
  view: 'view',
  create: 'create',
  update: 'update',
  delete: 'delete',
  approve: 'approve',
} as const;

export type Action = (typeof ACTIONS)[keyof typeof ACTIONS];

// ============================================
// ETIQUETAS PARA UI
// ============================================

export const MODULE_LABELS: Record<Module, string> = {
  dashboard: 'Dashboard',
  employees: 'Empleados',
  equipment: 'Equipos',
  documents: 'Documentos',
  accounting: 'Contabilidad',

  commercial: 'Comercial',
  'commercial.clients': 'Clientes',
  'commercial.leads': 'Leads',
  'commercial.contacts': 'Contactos',
  'commercial.quotes': 'Presupuestos',
  'commercial.suppliers': 'Proveedores',
  'commercial.categories': 'Categorías',
  'commercial.products': 'Productos',
  'commercial.price-lists': 'Listas de Precios',
  'commercial.warehouses': 'Almacenes',
  'commercial.stock': 'Control de Stock',
  'commercial.movements': 'Movimientos',
  'commercial.points-of-sale': 'Puntos de Venta',
  'commercial.invoices': 'Facturas de Venta',
  'commercial.purchases': 'Facturas de Compra',
  'commercial.purchase-orders': 'Órdenes de Compra',
  'commercial.receiving-notes': 'Remitos de Recepción',
  'commercial.delivery-notes': 'Remitos de Entrega',
  'commercial.treasury.cash-registers': 'Cajas',
  'commercial.treasury.bank-accounts': 'Cuentas',
  'commercial.treasury.receipts': 'Recibos de Cobro',
  'commercial.treasury.payment-orders': 'Órdenes de Pago',
  'commercial.treasury.checks': 'Cheques',
  'commercial.treasury.projections': 'Proyecciones',
  'commercial.treasury.cashflow': 'Flujo de Caja',
  'commercial.treasury.partners': 'Socios',
  'commercial.treasury.cards': 'Tarjetas',
  'commercial.expenses': 'Gastos',
  'commercial.equivalences': 'Equivalencias',

  'company.general.users': 'Usuarios',
  'company.general.roles': 'Roles',
  'company.general.audit': 'Auditoría',
  'company.documents': 'Documentos Empresa',

  'company.cost-centers': 'Centros de Costo',
  'company.contract-types': 'Tipos de Contrato',
  'company.job-positions': 'Puestos de Trabajo',
  'company.job-categories': 'Categorías Laborales',
  'company.unions': 'Sindicatos',
  'company.collective-agreements': 'Convenios',

  'company.vehicle-brands': 'Marcas',
  'company.vehicle-types': 'Tipos de Equipo',
  'company.equipment-owners': 'Titulares',
  'company.sectors': 'Sectores',
  'company.type-operatives': 'Tipos Operativos',
  'company.contractors': 'Contratistas',

  'company.document-types': 'Tipos de Documento',

  'company.discount-presets': 'Descuentos Predefinidos',

  // Módulo Contable
  'accounting.accounts': 'Plan de Cuentas',
  'accounting.entries': 'Asientos',
  'accounting.reports': 'Informes',
  'accounting.settings': 'Configuración Contable',
  'accounting.fiscal-year-close': 'Cierre de Ejercicio',
  'accounting.recurring-entries': 'Asientos Recurrentes',
  'accounting.opening-balances': 'Saldos de Apertura',
  'accounting.budgets': 'Presupuestos Contables',
  // Espacios de Trabajo
  'workspace.gestion': 'Espacio Gestión',
  'workspace.contable': 'Espacio Contable',
};

export const ACTION_LABELS: Record<Action, string> = {
  view: 'Ver',
  create: 'Crear',
  update: 'Editar',
  delete: 'Eliminar',
  approve: 'Aprobar',
};

// ============================================
// GRUPOS DE MÓDULOS (para UI de roles)
// ============================================

export const MODULE_GROUPS = {
  principal: {
    label: 'Principal',
    modules: ['dashboard', 'employees', 'equipment', 'documents', 'accounting'] as Module[],
  },
  comercial: {
    label: 'Comercial',
    modules: [
      'commercial',
      'commercial.clients',
      'commercial.leads',
      'commercial.contacts',
      'commercial.quotes',
      'commercial.suppliers',
      'commercial.categories',
      'commercial.products',
      'commercial.price-lists',
      'commercial.warehouses',
      'commercial.stock',
      'commercial.movements',
      'commercial.points-of-sale',
      'commercial.invoices',
      'commercial.purchases',
      'commercial.purchase-orders',
      'commercial.receiving-notes',
      'commercial.treasury.cash-registers',
      'commercial.treasury.bank-accounts',
      'commercial.treasury.receipts',
      'commercial.treasury.payment-orders',
      'commercial.treasury.checks',
      'commercial.treasury.projections',
      'commercial.treasury.cashflow',
      'commercial.treasury.partners',
      'commercial.treasury.cards',
      'commercial.expenses',
      'commercial.equivalences',
    ] as Module[],
  },
  configuracionGeneral: {
    label: 'Configuración - General',
    modules: [
      'company.general.users',
      'company.general.roles',
      'company.general.audit',
      'company.documents',
    ] as Module[],
  },
  configuracionRRHH: {
    label: 'Configuración - RRHH',
    modules: [
      'company.cost-centers',
      'company.contract-types',
      'company.job-positions',
      'company.job-categories',
      'company.unions',
      'company.collective-agreements',
    ] as Module[],
  },
  configuracionEquipos: {
    label: 'Configuración - Equipos',
    modules: [
      'company.vehicle-brands',
      'company.vehicle-types',
      'company.equipment-owners',
      'company.sectors',
      'company.type-operatives',
      'company.contractors',
    ] as Module[],
  },
  configuracionDocumentos: {
    label: 'Configuración - Documentos',
    modules: ['company.document-types'] as Module[],
  },
  configuracionComercial: {
    label: 'Configuración - Comercial',
    modules: ['company.discount-presets'] as Module[],
  },
  configuracionContable: {
    label: 'Contabilidad',
    modules: [
      'accounting.accounts',
      'accounting.entries',
      'accounting.recurring-entries',
      'accounting.opening-balances',
      'accounting.budgets',
      'accounting.reports',
      'accounting.settings',
      'accounting.fiscal-year-close',
    ] as Module[],
  },
  espaciosDeTrabajo: {
    label: 'Espacios de Trabajo',
    modules: ['workspace.gestion', 'workspace.contable'] as Module[],
  },
} as const;

// ============================================
// ROLES DEL SISTEMA
// ============================================

export const SYSTEM_ROLES = {
  owner: {
    slug: 'owner',
    name: 'Propietario',
    description: 'Acceso completo a todas las funcionalidades',
    color: '#7c3aed', // violet-600
    isSystem: true,
    isDefault: false,
  },
  developer: {
    slug: 'developer',
    name: 'Desarrollador',
    description: 'Acceso completo para desarrollo y testing',
    color: '#059669', // emerald-600
    isSystem: true,
    isDefault: false,
  },
  admin: {
    slug: 'admin',
    name: 'Administrador',
    description: 'Acceso administrativo configurable',
    color: '#2563eb', // blue-600
    isSystem: true,
    isDefault: true,
  },
} as const;

// ============================================
// ACCIONES DE AUDITORÍA
// ============================================

export const AUDIT_ACTIONS = {
  // Roles
  role_created: 'role_created',
  role_updated: 'role_updated',
  role_deleted: 'role_deleted',

  // Permisos de rol
  role_permission_granted: 'role_permission_granted',
  role_permission_revoked: 'role_permission_revoked',

  // Miembros
  member_invited: 'member_invited',
  member_role_changed: 'member_role_changed',
  member_deactivated: 'member_deactivated',
  member_reactivated: 'member_reactivated',

  // Permisos individuales
  member_permission_granted: 'member_permission_granted',
  member_permission_revoked: 'member_permission_revoked',

  // Invitaciones
  invitation_accepted: 'invitation_accepted',
  invitation_expired: 'invitation_expired',
  invitation_cancelled: 'invitation_cancelled',
} as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS];
