# Espacios de Trabajo: Gestión / Contable — Diseño

- **Tarea:** TSK-346 — Cambio de UI · Contable
- **Fecha:** 2026-06-26
- **Rama:** `feat/tsk-346-workspace-gestion-contable`

## Problema

La aplicación mezcla en una sola navegación todo: gestión operativa (empleados,
equipos, documentos, comercial) y contabilidad. Se quiere dividir la experiencia
en dos **Espacios de Trabajo** — **Gestión** y **Contable** — para que cada
usuario vea solo lo relevante a su rol, pudiendo tener acceso a uno, al otro o a
ambos, y conmutar entre ellos con un selector.

## Decisiones de diseño (acordadas)

1. **Acceso por permiso RBAC nuevo** por espacio (no derivado, no flag en membresía).
2. **Cambio de espacio = filtrado de sidebar + landing propio** (sin aislamiento
   estricto de rutas).
3. **Mapeo:** Contable = `accounting.*`; Gestión = todo lo demás (incluida toda la
   administración/configuración transversal y Comercial completo).
4. **Selector** en el header superior, alineado a la derecha.

## Alcance

### Incluye
- Dos permisos RBAC nuevos y su integración en la pantalla de roles.
- Persistencia del espacio activo por usuario.
- Cuarta capa de filtrado en el sidebar por espacio.
- Selector de espacio en el header.
- Landing por espacio y auto-ajuste del espacio según la ruta.
- Backward-compatibility para instalaciones existentes.

### No incluye (YAGNI)
- Aislamiento estricto de rutas (bloqueo por URL). El permiso RBAC del módulo ya
  protege cada ruta.
- División fina de Comercial entre espacios.
- Espacios configurables/dinámicos: son exactamente dos, fijos.

## Arquitectura

### 1. Modelo de acceso (RBAC)

Dos módulos de permiso nuevos, únicamente con acción `view`:

- `workspace.gestion`
- `workspace.contable`

Cambios:
- `src/shared/lib/permissions/constants.ts`: agregar ambos a la lista de módulos
  y crear un grupo nuevo (p. ej. `espaciosDeTrabajo`) para que aparezcan agrupados
  en la UI de gestión de roles.
- `prisma/seed.ts`: incluir `workspace.gestion` y `workspace.contable` en
  `allModules` para que owner/developer/admin los reciban.

**Backward-compatibility (crítico):** si un usuario no tiene **ningún** permiso
`workspace.*`, se interpreta como acceso a **ambos** espacios. Esto evita romper
roles existentes en producción que aún no tienen el permiso, replicando el
criterio de `activeModules = []` ⇒ todos los módulos activos. Los `owner` ya ven
todo por el short-circuit `isOwner` en `checkPermission`.

### 2. Definición de espacios — `src/shared/lib/workspaces/`

Módulo nuevo, fuente única de verdad sobre los espacios.

`constants.ts`:

```ts
export const WORKSPACES = {
  gestion:  { id: 'gestion',  label: 'Gestión',  icon: 'LayoutDashboard',
              permission: 'workspace.gestion',  landing: '/dashboard' },
  contable: { id: 'contable', label: 'Contable', icon: 'Calculator',
              permission: 'workspace.contable', landing: '/dashboard/accounting' },
} as const;

export type WorkspaceId = keyof typeof WORKSPACES; // 'gestion' | 'contable'
```

Funciones puras (testeables de forma aislada):

- `getWorkspaceForModule(permissionModule?: string): WorkspaceId`
  - `accounting.*` (o módulo nulo de config contable) ⇒ `'contable'`.
  - cualquier otro, o `undefined` (items transversales) ⇒ `'gestion'`.
- `getWorkspaceForRoute(pathname: string): WorkspaceId`
  - rutas que empiezan con `/dashboard/accounting` o `/dashboard/company/accounting`
    ⇒ `'contable'`; resto ⇒ `'gestion'`.
- `getAccessibleWorkspaces(permissions): WorkspaceId[]`
  - aplica la regla de backward-compat descrita arriba.

> **Nota de implementación:** durante la implementación se verificará si existe
> alguna ruta de "configuración de contabilidad" fuera de `accounting.*` (p. ej.
> bajo `/dashboard/company/...`). Si la hubiera, se mapea a `contable` aquí.
> Hasta donde se exploró, toda la configuración contable vive bajo `accounting.*`.

### 3. Persistencia — `src/shared/lib/workspace.ts`

Espejo del patrón de `src/shared/lib/company.ts`.

- Schema: agregar a `UserPreference` el campo
  `activeWorkspaceId String? @map("active_workspace_id")` + migración Prisma.
- `getActiveWorkspace(): Promise<WorkspaceId>`
  - lee `activeWorkspaceId`; calcula los espacios accesibles del usuario.
  - **Default:** si tiene ambos ⇒ el guardado válido, o `'gestion'`; si solo uno
    ⇒ ese; persiste el fallback de forma lazy (igual que `getActiveCompanyId`).
- `setActiveWorkspace(id: WorkspaceId)`
  - valida que el usuario tenga el permiso correspondiente; `upsert` en
    `UserPreference`.

### 4. Cuarta capa de filtrado del sidebar

- **El espacio guardado/por-defecto se calcula en el servidor** (`DashboardLayout`
  vía `getActiveWorkspace()` + `getAccessibleWorkspaces()`) y se pasa como prop a
  los componentes de layout.
- **El espacio efectivo se deriva client-side** en `_AppSidebar.tsx` /
  `_WorkspaceSelector.tsx` con `usePathname()`: si la ruta actual pertenece a un
  espacio accesible, ese es el efectivo; en su defecto, el guardado recibido por
  prop. Derivarlo en cliente (no en `getSidebarPermissions`) evita depender del
  pathname en el server y evita escrituras en cada navegación.
- `_AppSidebar.tsx`: en `filterItems` / `filterNavMainItems`, además de
  `canViewItem`, descartar todo item cuyo `getWorkspaceForModule(item.module)` no
  coincida con el espacio efectivo. Items sin `module` (transversales) ⇒ Gestión.

### 5. Selector de espacio — `_WorkspaceSelector.tsx` (client)

- Render en `_SiteHeader.tsx`, alineado a la derecha (`ml-auto`).
- Toggle `[Gestión | Contable]`.
- **Visibilidad:** solo si `accessibleWorkspaces.length === 2`. Con un solo
  espacio accesible no se renderiza.
- Al cambiar: llama a `setActiveWorkspace()` (server action), navega al `landing`
  del espacio destino y hace `router.refresh()` para re-filtrar el sidebar.
- `_SiteHeader` pasa a recibir props (`activeWorkspace`, `accessibleWorkspaces`),
  provistas desde `DashboardLayout.tsx`.

### 6. Landing y auto-ajuste

- Al entrar a una ruta, el espacio mostrado es el de esa ruta
  (`getWorkspaceForRoute`), de modo que abrir por URL un módulo del otro espacio
  "mueve" el selector sin bloquear nada.
- El `landing` guardado/derivado define a dónde lleva el selector al conmutar.

### 7. Permisos en las nuevas server actions

`getActiveWorkspace` / `setActiveWorkspace` verifican el permiso `workspace.*`
del espacio objetivo antes de aplicar (coherente con la regla del proyecto de
`checkPermission` en toda action).

## Flujo de datos

```
DashboardLayout (server)
  ├─ getSidebarPermissions()           → permisos RBAC + industria + módulos activos
  ├─ getAccessibleWorkspaces(perms)    → ['gestion','contable'] | ['gestion'] | ['contable']
  ├─ getActiveWorkspace()              → espacio guardado (default)
  ├─ _SiteHeader  ← (savedWorkspace, accessibleWorkspaces) → _WorkspaceSelector
  └─ _AppSidebar  ← (sidebarPermissions, savedWorkspace, accessibleWorkspaces)

_AppSidebar / _WorkspaceSelector (client)
  ├─ efectivo = getWorkspaceForRoute(usePathname()) si ∈ accesibles, sino savedWorkspace
  └─ filterItems(): canViewItem() && getWorkspaceForModule(item.module) === efectivo
```

## Manejo de errores y casos borde

- **Usuario sin permisos `workspace.*` (datos viejos):** ve ambos (backward-compat).
- **Espacio guardado al que perdió acceso:** se ignora y se recae al default válido.
- **`setActiveWorkspace` a un espacio sin permiso:** rechazado por `checkPermission`.
- **Un solo espacio accesible:** sin selector; landing y filtrado fijos a ese.
- **Ruta no asociable a un espacio:** se usa el espacio guardado como efectivo.

## Pruebas

- **Unitarias (funciones puras de `workspaces/`):** `getWorkspaceForModule`,
  `getWorkspaceForRoute`, `getAccessibleWorkspaces` (incluyendo backward-compat).
- **E2E (Cypress, según reglas del proyecto):**
  - usuario con ambos espacios: ve el selector, conmuta, el sidebar cambia y
    redirige al landing correcto.
  - usuario solo Gestión: no ve selector ni módulos contables.
  - usuario solo Contable: no ve selector ni módulos de gestión; landing en
    `/dashboard/accounting`.
  - backward-compat: rol sin permisos `workspace.*` ve ambos.

## Documentación a actualizar (reglas del proyecto)

- `docs/` desarrollador: arquitectura del sidebar / auth-and-permissions
  (nueva capa y permisos).
- Guía de usuario en `src/modules/help/...`: cómo cambiar de Espacio de Trabajo
  y qué contiene cada uno.

## Archivos afectados (resumen)

| Archivo | Cambio |
|---|---|
| `prisma/schema.prisma` | + `UserPreference.activeWorkspaceId` |
| `prisma/migrations/...` | nueva migración |
| `prisma/seed.ts` | + permisos `workspace.*` a roles |
| `src/shared/lib/permissions/constants.ts` | + módulos y grupo de permisos |
| `src/shared/lib/workspaces/` (nuevo) | constantes + funciones puras |
| `src/shared/lib/workspace.ts` (nuevo) | get/set espacio activo |
| `src/shared/actions/sidebar.ts` | exponer espacio efectivo + accesibles |
| `src/shared/components/layout/DashboardLayout.tsx` | propagar props |
| `src/shared/components/layout/_SiteHeader.tsx` | montar selector a la derecha |
| `src/shared/components/layout/_AppSidebar.tsx` | 4ª capa de filtrado |
| `src/shared/components/layout/_WorkspaceSelector.tsx` (nuevo) | UI del selector |
| `cypress/e2e/...` | specs nuevos/actualizados |
| `docs/...`, `src/modules/help/...` | documentación |
