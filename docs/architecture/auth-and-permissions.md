# Autenticacion y Permisos

## Autenticacion (Clerk)

### Middleware

Archivo: `src/proxy.ts`

```typescript
const isPublicRoute = createRouteMatcher([
  '/',           // Landing
  '/sign-in(.*)',  // Login
  '/sign-up(.*)',  // Registro
  '/eq/(.*)'       // QR publico de equipos
]);
```

Todas las rutas no publicas requieren autenticacion via `auth.protect()`.

### Providers

Archivo: `src/providers/SessionProvider.tsx`

Envuelve la app con `ClerkProvider` configurado con localizacion `esES` (espanol).

### Uso en Server Actions

```typescript
import { auth } from '@clerk/nextjs/server';

export async function myAction() {
  const { userId } = await auth();
  if (!userId) throw new Error('No autenticado');
  // ...
}
```

En la practica, se usa `getActiveCompanyId()` que internamente llama a `auth()`:

```typescript
import { getActiveCompanyId } from '@/shared/lib/company';

export async function getItems() {
  const companyId = await getActiveCompanyId();
  if (!companyId) throw new Error('No hay empresa activa');
  return prisma.item.findMany({ where: { companyId } });
}
```

---

## Sistema RBAC (Permisos)

Directorio: `src/shared/lib/permissions/`

### Arquitectura

```
CompanyMember
  ├── role → CompanyRole
  │            └── permissions → CompanyRolePermission[] (module + action)
  │
  └── permissions → CompanyMemberPermission[] (overrides individuales)
                      └── isGranted: true/false (otorga o revoca)
```

### Jerarquia de Resolucion

1. **Owner flag** (`CompanyMember.isOwner = true`) → acceso total, sin verificaciones
2. **Roles sistema** (slug `owner` o `developer`) → acceso total
3. **Permisos de rol** (`CompanyRolePermission`) → permisos base
4. **Overrides individuales** (`CompanyMemberPermission`) → pueden otorgar (`isGranted: true`) o revocar (`isGranted: false`) permisos especificos

### Modulos Registrados

Archivo: `src/shared/lib/permissions/constants.ts`

50+ modulos organizados en grupos:

| Grupo | Modulos |
|-------|---------|
| Principal | `dashboard`, `employees`, `equipment`, `documents`, `accounting` |
| Comercial | `commercial`, `commercial.clients`, `commercial.leads`, `commercial.contacts`, `commercial.quotes`, `commercial.suppliers`, `commercial.categories`, `commercial.products`, `commercial.price-lists`, `commercial.warehouses`, `commercial.stock`, `commercial.movements`, `commercial.points-of-sale`, `commercial.invoices`, `commercial.purchases`, `commercial.treasury.cash-registers`, `commercial.treasury.bank-accounts`, `commercial.treasury.receipts`, `commercial.treasury.payment-orders`, `commercial.expenses` |
| Config General | `company.general.users`, `company.general.roles`, `company.general.audit`, `company.documents` |
| Config RRHH | `company.cost-centers`, `company.contract-types`, `company.job-positions`, `company.job-categories`, `company.unions`, `company.collective-agreements` |
| Config Equipos | `company.vehicle-brands`, `company.vehicle-types`, `company.equipment-owners`, `company.sectors`, `company.type-operatives`, `company.contractors` |
| Config Documentos | `company.document-types` |
| Contabilidad | `accounting.accounts`, `accounting.entries`, `accounting.reports`, `accounting.settings`, `accounting.fiscal-year-close`, `accounting.recurring-entries` |

### Acciones

4 acciones por modulo: `view`, `create`, `update`, `delete`

### Roles del Sistema

| Slug | Nombre | Comportamiento |
|------|--------|----------------|
| `owner` | Propietario | Acceso total (bypass completo) |
| `developer` | Desarrollador | Acceso total (bypass completo) |
| `admin` | Administrador | Rol default, permisos configurables |

### Funciones Principales

#### Server-side

```typescript
// Verificar un permiso (redirige si no tiene acceso)
import { checkPermission } from '@/shared/lib/permissions';
await checkPermission('employees', 'create', { redirect: true });

// Verificar cualquiera de varios permisos (OR)
await checkAnyPermission([
  { module: 'commercial.invoices', action: 'view' },
  { module: 'commercial.purchases', action: 'view' },
]);

// Verificar todos los permisos (AND)
await checkAllPermissions([...]);

// Obtener permisos de un modulo (usa React cache())
import { getModulePermissions } from '@/shared/lib/permissions';
const { canView, canCreate, canUpdate, canDelete } = await getModulePermissions('commercial.invoices');

// Batch: multiples modulos en 1 query
const perms = await getMultipleModulePermissions([
  'commercial.invoices',
  'commercial.purchases',
]);

// Obtener todos los permisos del usuario
import { getCurrentUserPermissions } from '@/shared/lib/permissions';
const { isOwner, permissions } = await getCurrentUserPermissions();
```

`getModulePermissions()` usa `React.cache()` para deduplicar queries dentro del mismo request. Es seguro llamarlo desde multiples Server Components en paralelo.

#### Client-side

```typescript
import { usePermissions } from '@/shared/hooks/usePermissions';

function MyComponent() {
  const { hasPermission, isOwner } = usePermissions();

  if (!hasPermission('commercial.invoices', 'create')) {
    return null;
  }
  // ...
}
```

### Componentes de Guarda

#### Server Component

```typescript
import { PermissionGuard } from '@/shared/components/common';

<PermissionGuard module="employees" action="create">
  <CreateEmployeeButton />
</PermissionGuard>
```

#### Client Component

```typescript
import { PermissionGuardClient } from '@/shared/components/common';

<PermissionGuardClient module="employees" action="create">
  <CreateEmployeeButton />
</PermissionGuardClient>
```

---

## Espacios de Trabajo

### Concepto

La aplicacion tiene dos espacios fijos: **Gestion** y **Contable**. Cada espacio agrupa un subconjunto de modulos del sidebar. El usuario puede cambiar de espacio mediante el selector de tabs en el header (arriba a la derecha), visible unicamente cuando tiene acceso a ambos.

### Permisos RBAC

Archivo: `src/shared/lib/permissions/constants.ts` — grupo **"Espacios de Trabajo"**

| Modulo RBAC       | Accion | Efecto                                         |
|-------------------|--------|------------------------------------------------|
| `workspace.gestion`  | `view` | Acceso al espacio Gestion                    |
| `workspace.contable` | `view` | Acceso al espacio Contable                   |

Solo se usa la accion `view`. No existe `create`, `update` ni `delete` para estos modulos.

### Regla de Mapeo (modulos ⇒ espacio)

Archivo: `src/shared/lib/workspaces/helpers.ts`

```typescript
// Por modulo de permiso:
accounting / accounting.* ⇒ contable
(todo lo demas)           ⇒ gestion

// Por ruta:
/dashboard/accounting     ⇒ contable
/dashboard/company/accounting ⇒ contable
(todo lo demas)           ⇒ gestion
```

Los items de administracion y configuracion transversal (sin `module` explicito en el nav) pertenecen a Gestion.

### 4a Capa de Filtrado del Sidebar

El sidebar aplica 4 capas en orden:

1. **RBAC** — Permisos del usuario/rol (`checkPermission`)
2. **Industria** — Tipo de empresa (`INDUSTRY_MODULES`, `INDUSTRY_FEATURES`)
3. **Modulos activos** — Activacion por empresa (`activeModules`)
4. **Espacio de trabajo** — Derivado de la URL via `usePathname` en `_AppSidebar.tsx`

La capa 4 usa `resolveEffectiveWorkspace(pathname, accessibleWorkspaces, saved)` para determinar el espacio efectivo y **oculta** cada `NavItem` donde `getWorkspaceForModule(item.module) !== effectiveWorkspace`.

### Persistencia

El espacio activo se persiste en `UserPreference.activeWorkspaceId`. Se accede via:

```typescript
import { getActiveWorkspace, setActiveWorkspace } from '@/shared/lib/workspace';
```

Al guardar, `setActiveWorkspace` valida que el usuario tenga acceso al espacio destino antes de persistir.

**Navegación al cambiar de espacio:** al conmutar, el usuario es redirigido al inicio del espacio destino — Gestión ⇒ `/dashboard`, Contable ⇒ `/dashboard/accounting` (definido en `WORKSPACES[id].landing`).

### Backward-Compatibility

Un usuario **sin ningun permiso** `workspace.*` asignado (por ejemplo, empresas anteriores al sprint que no configuraron roles para esto) ve **ambos** espacios. La funcion `resolveAccessibleWorkspaces` aplica esta logica:

```typescript
// Sin ningun permiso workspace.* ⇒ ambos espacios accesibles
if (!input.gestion && !input.contable) return [...WORKSPACE_IDS];
```

Los propietarios de la empresa (`CompanyMember.isOwner`) y los roles de sistema `owner` y `developer` ven siempre ambos espacios (short-circuit en `getAccessibleWorkspaces`), independientemente de los permisos `workspace.*`.

### Visibilidad vs. Seguridad (importante)

Los permisos `workspace.gestion` y `workspace.contable` controlan **únicamente la visibilidad**: qué espacios aparecen en el selector del header y qué ítems se muestran en el sidebar. **No son un límite de seguridad sobre los datos.**

El acceso real a los datos de cada módulo lo controla el RBAC del módulo correspondiente (por ejemplo, `accounting.entries`). Esto significa que:

- Un usuario con permiso `accounting.entries` pero **sin** permiso `workspace.contable` **no verá** el espacio Contable en el sidebar ni en el selector.
- Sin embargo, si ese usuario accede directamente a `/dashboard/accounting/entries` por URL, la página lo permitirá, porque el guard de la página verifica `accounting.entries`, no `workspace.contable`.
- Por el contrario, un usuario con `workspace.contable` pero **sin** `accounting.entries` verá el espacio Contable en el menú, pero las páginas del módulo le denegarán el acceso.

Este diseño es **intencional** (ver spec: "Sin aislamiento estricto de rutas"). Los permisos de espacio son una herramienta de UX/organización, no una barrera de autorización.

### Sin Aislamiento Estricto de Rutas

No existe un guard de ruta que redirija al usuario si accede por URL directa a un modulo del otro espacio. En cambio, al navegar a una URL, el selector del header y el sidebar se auto-ajustan para reflejar el espacio de esa ruta (la capa 4 usa `usePathname`).

### Archivos Clave

```
src/shared/lib/workspaces/
  constants.ts     # WorkspaceId, WORKSPACES, WORKSPACE_IDS
  helpers.ts       # getWorkspaceForModule, getWorkspaceForRoute,
                   # resolveAccessibleWorkspaces, resolveEffectiveWorkspace
  index.ts         # re-exports

src/shared/lib/workspace.ts              # getAccessibleWorkspaces, getActiveWorkspace, setActiveWorkspace (server actions)
src/shared/components/layout/_WorkspaceSelector.tsx  # UI del selector (Tabs en el header)
src/shared/components/layout/_AppSidebar.tsx         # canViewItem — capa 4 de filtrado
```

---

### Auditoria

Archivo: `src/shared/lib/permissions/audit.server.ts`

Acciones auditadas automaticamente:
- Creacion/edicion/eliminacion de roles
- Cambio de permisos de rol
- Invitacion de miembros
- Cambio de rol de miembro
- Activacion/desactivacion de miembro
- Otorgamiento/revocacion de permisos individuales

```typescript
import { createAuditLog } from '@/shared/lib/permissions';

await createAuditLog({
  companyId,
  action: 'role_created',
  performedBy: userId,
  targetId: roleId,
  details: { roleName: 'Vendedor' },
});
```

Consulta de logs:

```typescript
const { logs, total } = await getAuditLogs({
  companyId,
  page: 1,
  perPage: 20,
  search: 'vendedor',
});
```
