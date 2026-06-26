# Espacios de Trabajo (Gestión / Contable) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dividir la app en dos Espacios de Trabajo (Gestión / Contable) con selector en el header, filtrado del sidebar por espacio y acceso por permiso RBAC.

**Architecture:** Funciones puras en `src/shared/lib/workspaces/` deciden a qué espacio pertenece cada módulo/ruta y qué espacios puede ver el usuario. La persistencia del espacio activo replica el patrón de `company.ts` sobre `UserPreference`. El layout server resuelve permisos + espacio guardado y los pasa al layout client, que deriva el espacio efectivo de la URL (`usePathname`) y filtra el sidebar. Un selector en el header conmuta el espacio.

**Tech Stack:** Next.js 16 (App Router), React 19, Prisma 7 (`@prisma/adapter-pg`), TypeScript, Vitest (nuevo, solo para lógica pura), Tailwind v4 + shadcn/ui, lucide-react, Sonner.

## Global Constraints

- **Spec de referencia:** `docs/superpowers/specs/2026-06-26-espacios-de-trabajo-design.md`.
- **Sin `:any`** — inferir tipos de Prisma/Zod (regla del proyecto).
- **Logger, no `console.*`** — `import { logger } from '@/shared/lib/logger'`.
- **Server Components por defecto**; Client Components con prefijo `_`.
- **Fechas con moment.js** (no aplica aquí, pero rige).
- **`checkPermission()` en toda server action** que exponga datos.
- **Mapeo de espacios:** módulo o ruta que empiece con `accounting` ⇒ Contable; todo lo demás ⇒ Gestión.
- **Backward-compat:** usuario sin **ningún** permiso `workspace.*` ⇒ ve **ambos** espacios.
- **Permisos nuevos:** `workspace.gestion`, `workspace.contable` (solo acción `view`).
- **Landings:** Gestión ⇒ `/dashboard`; Contable ⇒ `/dashboard/accounting`.
- **Commits frecuentes**, uno por tarea como mínimo. Cerrar mensajes de commit con:
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

---

## File Structure

| Archivo | Responsabilidad |
|---|---|
| `vitest.config.ts` (nuevo) | Runner de tests unitarios, alias `@` → `src/` |
| `src/shared/lib/workspaces/constants.ts` (nuevo) | `WORKSPACES`, tipo `WorkspaceId` |
| `src/shared/lib/workspaces/helpers.ts` (nuevo) | Funciones puras: módulo→espacio, ruta→espacio, accesibles, efectivo |
| `src/shared/lib/workspaces/helpers.test.ts` (nuevo) | Tests Vitest de las funciones puras |
| `src/shared/lib/workspaces/index.ts` (nuevo) | Barrel export |
| `src/shared/lib/permissions/constants.ts` (mod) | + módulos `workspace.*`, labels, grupo |
| `prisma/seed.ts` (mod) | + permisos `workspace.*` a roles owner/developer/admin |
| `prisma/schema.prisma` (mod) | + `UserPreference.activeWorkspaceId` |
| `src/shared/lib/workspace.ts` (nuevo) | `getActiveWorkspace`, `setActiveWorkspace`, `getAccessibleWorkspaces` (server) |
| `src/app/(core)/layout.tsx` (mod) | Resolver espacio guardado + accesibles, pasarlos al layout |
| `src/shared/components/layout/DashboardLayout.tsx` (mod) | Propagar props a sidebar y header |
| `src/shared/components/layout/_AppSidebar.tsx` (mod) | 4ª capa de filtrado por espacio |
| `src/shared/components/layout/_SiteHeader.tsx` (mod) | Montar selector a la derecha |
| `src/shared/components/layout/_WorkspaceSelector.tsx` (nuevo) | UI del selector (client) |
| `docs/...`, `src/modules/help/...` (mod) | Documentación dev + guía de usuario |

---

## Task 1: Vitest + funciones puras de `workspaces/`

**Files:**
- Create: `vitest.config.ts`
- Create: `src/shared/lib/workspaces/constants.ts`
- Create: `src/shared/lib/workspaces/helpers.ts`
- Create: `src/shared/lib/workspaces/index.ts`
- Test: `src/shared/lib/workspaces/helpers.test.ts`
- Modify: `package.json` (scripts + devDependency `vitest`)

**Interfaces:**
- Produces:
  - `type WorkspaceId = 'gestion' | 'contable'`
  - `WORKSPACES: Record<WorkspaceId, { id: WorkspaceId; label: string; permission: string; landing: string }>`
  - `getWorkspaceForModule(module?: string | null): WorkspaceId`
  - `getWorkspaceForRoute(pathname: string): WorkspaceId`
  - `resolveAccessibleWorkspaces(input: { gestion: boolean; contable: boolean }): WorkspaceId[]`
  - `resolveEffectiveWorkspace(pathname: string, accessible: WorkspaceId[], saved: WorkspaceId | null): WorkspaceId`

- [ ] **Step 1: Instalar Vitest**

Run: `npm install -D vitest`
Expected: `vitest` queda en `devDependencies`, sin errores de instalación.

- [ ] **Step 2: Agregar scripts de test a `package.json`**

En el objeto `"scripts"` agregar estas dos líneas (después de `"check-types"`):

```json
    "test": "vitest run",
    "test:watch": "vitest",
```

- [ ] **Step 3: Crear `vitest.config.ts`**

```ts
import { resolve } from 'path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
```

- [ ] **Step 4: Crear `src/shared/lib/workspaces/constants.ts`**

```ts
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
```

- [ ] **Step 5: Escribir los tests (fallan primero)**

Crear `src/shared/lib/workspaces/helpers.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  getWorkspaceForModule,
  getWorkspaceForRoute,
  resolveAccessibleWorkspaces,
  resolveEffectiveWorkspace,
} from './helpers';

describe('getWorkspaceForModule', () => {
  it('mapea módulos accounting a contable', () => {
    expect(getWorkspaceForModule('accounting')).toBe('contable');
    expect(getWorkspaceForModule('accounting.entries')).toBe('contable');
    expect(getWorkspaceForModule('accounting.settings')).toBe('contable');
  });

  it('mapea el resto a gestion', () => {
    expect(getWorkspaceForModule('commercial.invoices')).toBe('gestion');
    expect(getWorkspaceForModule('employees')).toBe('gestion');
    expect(getWorkspaceForModule('company.general.users')).toBe('gestion');
  });

  it('mapea módulo nulo/indefinido (transversal) a gestion', () => {
    expect(getWorkspaceForModule(null)).toBe('gestion');
    expect(getWorkspaceForModule(undefined)).toBe('gestion');
  });
});

describe('getWorkspaceForRoute', () => {
  it('detecta rutas contables', () => {
    expect(getWorkspaceForRoute('/dashboard/accounting')).toBe('contable');
    expect(getWorkspaceForRoute('/dashboard/accounting/reports')).toBe('contable');
    expect(getWorkspaceForRoute('/dashboard/company/accounting/entries')).toBe('contable');
  });

  it('el resto es gestion', () => {
    expect(getWorkspaceForRoute('/dashboard')).toBe('gestion');
    expect(getWorkspaceForRoute('/dashboard/employees')).toBe('gestion');
    expect(getWorkspaceForRoute('/dashboard/company/general/users')).toBe('gestion');
  });
});

describe('resolveAccessibleWorkspaces', () => {
  it('devuelve solo los espacios con permiso explícito', () => {
    expect(resolveAccessibleWorkspaces({ gestion: true, contable: false })).toEqual(['gestion']);
    expect(resolveAccessibleWorkspaces({ gestion: false, contable: true })).toEqual(['contable']);
    expect(resolveAccessibleWorkspaces({ gestion: true, contable: true })).toEqual([
      'gestion',
      'contable',
    ]);
  });

  it('backward-compat: sin ningún permiso devuelve ambos', () => {
    expect(resolveAccessibleWorkspaces({ gestion: false, contable: false })).toEqual([
      'gestion',
      'contable',
    ]);
  });
});

describe('resolveEffectiveWorkspace', () => {
  it('usa el espacio de la ruta si es accesible', () => {
    expect(
      resolveEffectiveWorkspace('/dashboard/accounting', ['gestion', 'contable'], 'gestion'),
    ).toBe('contable');
  });

  it('cae al guardado si la ruta no es accesible', () => {
    expect(resolveEffectiveWorkspace('/dashboard/accounting', ['gestion'], 'gestion')).toBe(
      'gestion',
    );
  });

  it('cae al primer accesible si no hay guardado válido', () => {
    expect(resolveEffectiveWorkspace('/dashboard/employees', ['contable'], null)).toBe('contable');
  });
});
```

- [ ] **Step 6: Correr los tests para verificar que fallan**

Run: `npm test`
Expected: FAIL — `Cannot find module './helpers'` (aún no existe).

- [ ] **Step 7: Implementar `src/shared/lib/workspaces/helpers.ts`**

```ts
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
```

- [ ] **Step 8: Crear el barrel `src/shared/lib/workspaces/index.ts`**

```ts
export * from './constants';
export * from './helpers';
```

- [ ] **Step 9: Correr los tests para verificar que pasan**

Run: `npm test`
Expected: PASS — todos los `describe` en verde.

- [ ] **Step 10: Verificar tipos**

Run: `npm run check-types`
Expected: sin errores.

- [ ] **Step 11: Commit**

```bash
git add vitest.config.ts package.json package-lock.json src/shared/lib/workspaces/
git commit -m "feat(workspaces): funciones puras de espacios + Vitest

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Permisos RBAC `workspace.*` (constants + seed)

**Files:**
- Modify: `src/shared/lib/permissions/constants.ts:13-89` (MODULES), `:111-180` (MODULE_LABELS), `:194-284` (MODULE_GROUPS)
- Modify: `prisma/seed.ts` (array `allModules`, ~líneas 522-548)

**Interfaces:**
- Consumes: `WorkspaceId` (Task 1, no se importa aquí; los strings se usan literales).
- Produces: módulos `'workspace.gestion'` y `'workspace.contable'` válidos en el tipo `Module`; ambos asignados a roles owner/developer/admin por el seed.

- [ ] **Step 1: Agregar los módulos a `MODULES`**

En `src/shared/lib/permissions/constants.ts`, dentro del objeto `MODULES`, después de la línea `'accounting.budgets': 'accounting.budgets',` (línea 88) y antes del `} as const;`:

```ts
  // Espacios de Trabajo
  'workspace.gestion': 'workspace.gestion',
  'workspace.contable': 'workspace.contable',
```

- [ ] **Step 2: Agregar etiquetas a `MODULE_LABELS`**

En el objeto `MODULE_LABELS`, después de `'accounting.budgets': 'Presupuestos Contables',` (línea 179):

```ts
  'workspace.gestion': 'Espacio Gestión',
  'workspace.contable': 'Espacio Contable',
```

- [ ] **Step 3: Agregar el grupo a `MODULE_GROUPS`**

En el objeto `MODULE_GROUPS`, después del cierre del grupo `configuracionContable` (línea 283, el `},`) y antes del `} as const;`:

```ts
  espaciosDeTrabajo: {
    label: 'Espacios de Trabajo',
    modules: ['workspace.gestion', 'workspace.contable'] as Module[],
  },
```

- [ ] **Step 4: Verificar tipos (las nuevas keys deben tipar)**

Run: `npm run check-types`
Expected: sin errores. (Si `MODULE_LABELS` es `Record<Module, string>`, agregar los módulos sin su label rompería el build; por eso labels van en el mismo cambio.)

- [ ] **Step 5: Agregar los permisos al seed**

En `prisma/seed.ts`, localizar el array `const allModules = [` (~línea 522). Agregar al final del array, antes del `];`:

```ts
      'workspace.gestion',
      'workspace.contable',
```

- [ ] **Step 6: Correr el seed local para validar**

Run: `npm run db:seed`
Expected: termina con `🎉 Seed completado exitosamente!` y el conteo de permisos asignados aumenta (incluye los nuevos módulos). Requiere la BD local levantada (`docker-compose up -d db`).

- [ ] **Step 7: Commit**

```bash
git add src/shared/lib/permissions/constants.ts prisma/seed.ts
git commit -m "feat(permissions): permisos workspace.gestion/contable y grupo de roles

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Migración Prisma + persistencia (`workspace.ts`)

**Files:**
- Modify: `prisma/schema.prisma:760-771` (model `UserPreference`)
- Create: `prisma/migrations/<timestamp>_user_preference_active_workspace/migration.sql` (generada por Prisma)
- Create: `src/shared/lib/workspace.ts`

**Interfaces:**
- Consumes: `getCurrentUserId` de `@/shared/lib/current-user`; `getCurrentUserPermissions` de `@/shared/lib/permissions`; `resolveAccessibleWorkspaces`, `WORKSPACES`, `type WorkspaceId` de `@/shared/lib/workspaces`.
- Produces:
  - `getAccessibleWorkspaces(): Promise<WorkspaceId[]>`
  - `getActiveWorkspace(): Promise<WorkspaceId>`
  - `setActiveWorkspace(workspaceId: WorkspaceId): Promise<{ success: true }>`

- [ ] **Step 1: Agregar el campo al schema**

En `prisma/schema.prisma`, dentro de `model UserPreference`, después de la línea `activeCompanyId  String?  @map("active_company_id") @db.Uuid`:

```prisma
  activeWorkspaceId String? @map("active_workspace_id")
```

- [ ] **Step 2: Crear la migración**

Run: `npm run db:migrate -- --name user_preference_active_workspace`
Expected: crea `prisma/migrations/<timestamp>_user_preference_active_workspace/migration.sql` con un `ALTER TABLE "user_preferences" ADD COLUMN "active_workspace_id" TEXT;` y regenera el client. Requiere BD local levantada.

- [ ] **Step 3: Verificar el SQL generado**

Abrir el `migration.sql` creado y confirmar que contiene únicamente el `ADD COLUMN "active_workspace_id"`. Si Prisma incluyó cambios no relacionados, descartarlos.

- [ ] **Step 4: Implementar `src/shared/lib/workspace.ts`**

```ts
'use server';

import { getCurrentUserId } from '@/shared/lib/current-user';
import { logger } from '@/shared/lib/logger';
import { getCurrentUserPermissions } from '@/shared/lib/permissions';
import { prisma } from '@/shared/lib/prisma';
import {
  resolveAccessibleWorkspaces,
  WORKSPACES,
  type WorkspaceId,
} from '@/shared/lib/workspaces';

/**
 * Espacios de trabajo a los que el usuario tiene acceso.
 * Owners y roles de sistema ven ambos. Backward-compat: sin permisos workspace.* ⇒ ambos.
 */
export async function getAccessibleWorkspaces(): Promise<WorkspaceId[]> {
  const userPermissions = await getCurrentUserPermissions();
  if (!userPermissions) return ['gestion'];

  const isPrivileged =
    userPermissions.isOwner ||
    userPermissions.roleSlug === 'owner' ||
    userPermissions.roleSlug === 'developer';

  if (isPrivileged) {
    return resolveAccessibleWorkspaces({ gestion: true, contable: true });
  }

  return resolveAccessibleWorkspaces({
    gestion: userPermissions.permissions['workspace.gestion']?.view === true,
    contable: userPermissions.permissions['workspace.contable']?.view === true,
  });
}

/**
 * Espacio activo guardado. Si el guardado ya no es accesible, recae al primero
 * accesible y lo persiste de forma lazy (igual que getActiveCompanyId).
 */
export async function getActiveWorkspace(): Promise<WorkspaceId> {
  const accessible = await getAccessibleWorkspaces();
  const userId = await getCurrentUserId();
  if (!userId) return accessible[0] ?? 'gestion';

  try {
    const prefs = await prisma.userPreference.findUnique({
      where: { userId },
      select: { activeWorkspaceId: true },
    });

    const saved = prefs?.activeWorkspaceId as WorkspaceId | null | undefined;
    if (saved && accessible.includes(saved)) return saved;

    const fallback = accessible[0] ?? 'gestion';
    await prisma.userPreference.upsert({
      where: { userId },
      create: { userId, activeWorkspaceId: fallback },
      update: { activeWorkspaceId: fallback },
    });
    return fallback;
  } catch (error) {
    logger.error('Error al obtener espacio de trabajo activo', { data: { error, userId } });
    return accessible[0] ?? 'gestion';
  }
}

/**
 * Cambia el espacio activo del usuario. Valida que tenga acceso al espacio destino.
 */
export async function setActiveWorkspace(workspaceId: WorkspaceId) {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('No autenticado');

  const accessible = await getAccessibleWorkspaces();
  if (!accessible.includes(workspaceId)) {
    throw new Error('No tienes acceso a este espacio de trabajo');
  }

  try {
    await prisma.userPreference.upsert({
      where: { userId },
      create: { userId, activeWorkspaceId: workspaceId },
      update: { activeWorkspaceId: workspaceId },
    });
    logger.info('Espacio de trabajo cambiado', {
      data: { workspaceId, landing: WORKSPACES[workspaceId].landing, userId },
    });
    return { success: true as const };
  } catch (error) {
    logger.error('Error al cambiar espacio de trabajo', { data: { error, workspaceId, userId } });
    throw error;
  }
}
```

- [ ] **Step 5: Verificar tipos**

Run: `npm run check-types`
Expected: sin errores. (Confirma que `getCurrentUserPermissions` expone `isOwner`, `roleSlug` y `permissions[module]?.view`, como usa `src/shared/actions/sidebar.ts:36-46`.)

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/migrations src/shared/lib/workspace.ts src/generated
git commit -m "feat(workspaces): persistencia de espacio activo en UserPreference

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Propagar espacio al layout (server + DashboardLayout + SiteHeader props)

**Files:**
- Modify: `src/app/(core)/layout.tsx`
- Modify: `src/shared/components/layout/DashboardLayout.tsx`
- Modify: `src/shared/components/layout/_SiteHeader.tsx`

**Interfaces:**
- Consumes: `getActiveWorkspace`, `getAccessibleWorkspaces` (Task 3); `type WorkspaceId` (Task 1).
- Produces: `DashboardLayout` y `_AppSidebar`/`_SiteHeader` reciben props `activeWorkspace: WorkspaceId` y `accessibleWorkspaces: WorkspaceId[]`. (El selector real llega en Task 6; aquí solo se cablea el paso de props.)

- [ ] **Step 1: Resolver espacio en el layout server**

En `src/app/(core)/layout.tsx`, ampliar el `Promise.all` (líneas 26-29) y el render:

```tsx
import { getActiveWorkspace, getAccessibleWorkspaces } from '@/shared/lib/workspace';
// ...
  const [companies, sidebarPermissions, activeWorkspace, accessibleWorkspaces] = await Promise.all([
    getMyCompanies(),
    getSidebarPermissions(activeCompany.industry, activeCompany.activeModules),
    getActiveWorkspace(),
    getAccessibleWorkspaces(),
  ]);

  return (
    <DashboardLayout
      companies={companies}
      activeCompany={activeCompany}
      isSingleMode={activeCompany.isSingleMode}
      sidebarPermissions={sidebarPermissions}
      industryType={industryType}
      activeWorkspace={activeWorkspace}
      accessibleWorkspaces={accessibleWorkspaces}
    >
      {children}
      <OnboardingGate />
    </DashboardLayout>
  );
```

- [ ] **Step 2: Aceptar y propagar props en `DashboardLayout`**

En `src/shared/components/layout/DashboardLayout.tsx`, agregar el import y extender props/render:

```tsx
import type { WorkspaceId } from '@/shared/lib/workspaces';
// ...
interface DashboardLayoutProps {
  children: React.ReactNode;
  companies: CompanyListItem[];
  activeCompany: CompanyListItem;
  isSingleMode?: boolean;
  sidebarPermissions: SidebarPermissions;
  industryType: IndustryType;
  activeWorkspace: WorkspaceId;
  accessibleWorkspaces: WorkspaceId[];
}

export function DashboardLayout({
  children,
  companies,
  activeCompany,
  isSingleMode = false,
  sidebarPermissions,
  industryType,
  activeWorkspace,
  accessibleWorkspaces,
}: DashboardLayoutProps) {
  return (
    <SidebarProvider>
      <_AppSidebar
        companies={companies}
        activeCompany={activeCompany}
        isSingleMode={isSingleMode}
        permissions={sidebarPermissions}
        activeWorkspace={activeWorkspace}
        accessibleWorkspaces={accessibleWorkspaces}
      />
      <SidebarInset>
        <_SiteHeader
          activeWorkspace={activeWorkspace}
          accessibleWorkspaces={accessibleWorkspaces}
        />
        <IndustryProvider industryType={industryType}>
          <div className="flex flex-1 flex-col gap-4 p-4">{children}</div>
        </IndustryProvider>
      </SidebarInset>
    </SidebarProvider>
  );
}
```

- [ ] **Step 3: Aceptar props en `_SiteHeader` (sin render todavía)**

En `src/shared/components/layout/_SiteHeader.tsx`, cambiar la firma del componente para recibir las props (se usarán en Task 6). Agregar el import y los parámetros:

```tsx
import type { WorkspaceId } from '@/shared/lib/workspaces';

interface SiteHeaderProps {
  activeWorkspace: WorkspaceId;
  accessibleWorkspaces: WorkspaceId[];
}

export function _SiteHeader({ activeWorkspace, accessibleWorkspaces }: SiteHeaderProps) {
```

Dejar el resto del cuerpo igual por ahora. Para evitar el error de variables sin usar de ESLint en este paso intermedio, referenciarlas con un descarte temporal justo después de `const pageTitle = getPageTitle(pathname);`:

```tsx
  void activeWorkspace;
  void accessibleWorkspaces;
```

(Estas dos líneas se eliminan en Task 6, cuando el selector las consuma.)

- [ ] **Step 4: Verificar tipos y build**

Run: `npm run check-types`
Expected: sin errores.

Run: `npm run build`
Expected: build OK (las nuevas props están cableadas extremo a extremo).

- [ ] **Step 5: Commit**

```bash
git add src/app/'(core)'/layout.tsx src/shared/components/layout/DashboardLayout.tsx src/shared/components/layout/_SiteHeader.tsx
git commit -m "feat(workspaces): propagar espacio activo y accesibles al layout

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Cuarta capa de filtrado en el sidebar

**Files:**
- Modify: `src/shared/components/layout/_AppSidebar.tsx:55-78` (props), `:519-566` (firma + `canViewItem`)

**Interfaces:**
- Consumes: props `activeWorkspace: WorkspaceId`, `accessibleWorkspaces: WorkspaceId[]` (Task 4); `getWorkspaceForModule`, `resolveEffectiveWorkspace` (Task 1).
- Produces: sidebar filtrado por espacio efectivo. Sin nuevas exportaciones.

- [ ] **Step 1: Importar helpers y tipo**

En `src/shared/components/layout/_AppSidebar.tsx`, junto a los imports existentes (después de la línea 50 `import type { Module } from '@/shared/lib/permissions';`):

```tsx
import {
  getWorkspaceForModule,
  resolveEffectiveWorkspace,
  type WorkspaceId,
} from '@/shared/lib/workspaces';
```

- [ ] **Step 2: Extender `AppSidebarProps`**

En la interfaz `AppSidebarProps` (líneas 512-517), agregar:

```tsx
  activeWorkspace: WorkspaceId;
  accessibleWorkspaces: WorkspaceId[];
```

- [ ] **Step 3: Recibir las props y derivar el espacio efectivo**

En la firma del componente (líneas 519-525) agregar `activeWorkspace` y `accessibleWorkspaces` a la desestructuración. Luego, justo después de `const pathname = usePathname();` (línea 526):

```tsx
  const effectiveWorkspace = resolveEffectiveWorkspace(
    pathname,
    accessibleWorkspaces,
    activeWorkspace,
  );
```

- [ ] **Step 4: Filtrar por espacio en `canViewItem`**

Reemplazar la función `canViewItem` (líneas 556-561) por:

```tsx
  // Verificar si puede ver un item (permiso RBAC + espacio de trabajo)
  const canViewItem = (item: NavItem): boolean => {
    // Items sin módulo (transversales) ⇒ espacio Gestión.
    if (getWorkspaceForModule(item.module) !== effectiveWorkspace) return false;
    if (item.module === null || item.module === undefined) return true;
    return permissions[item.module] === true;
  };
```

- [ ] **Step 5: Verificar build**

Run: `npm run build`
Expected: build OK.

- [ ] **Step 6: Verificación manual en navegador**

Run: `docker-compose up -d db && npm run dev`
Con un usuario owner (ve ambos espacios), abrir `http://localhost:3000/dashboard`:
- En `/dashboard` (espacio Gestión por la ruta), el sidebar muestra Empleados/Equipos/Comercial y **no** muestra Contabilidad.
- Navegar a `/dashboard/accounting`: el sidebar pasa a mostrar Contabilidad y oculta los módulos de Gestión.

Expected: el menú cambia según la sección. (El selector visible llega en Task 6; acá se valida el filtrado por URL.)

- [ ] **Step 7: Commit**

```bash
git add src/shared/components/layout/_AppSidebar.tsx
git commit -m "feat(workspaces): filtrar el sidebar por espacio de trabajo efectivo

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Selector de espacio en el header

**Files:**
- Create: `src/shared/components/layout/_WorkspaceSelector.tsx`
- Modify: `src/shared/components/layout/_SiteHeader.tsx`

**Interfaces:**
- Consumes: `setActiveWorkspace` (Task 3); `WORKSPACES`, `getWorkspaceForRoute`, `resolveEffectiveWorkspace`, `type WorkspaceId` (Tasks 1/3); props del header (Task 4).
- Produces: `_WorkspaceSelector` (client) renderizado a la derecha del header cuando hay 2 espacios accesibles.

- [ ] **Step 1: Crear `_WorkspaceSelector.tsx`**

```tsx
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
        await setActiveWorkspace(target);
        router.push(WORKSPACES[target].landing);
        router.refresh();
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
```

- [ ] **Step 2: Confirmar que existe el componente `tabs` de shadcn**

Run: `ls src/shared/components/ui/tabs.tsx`
Expected: el archivo existe. Si **no** existe, instalarlo: `npx shadcn@latest add tabs` y reintentar.

- [ ] **Step 3: Montar el selector en el header a la derecha**

En `src/shared/components/layout/_SiteHeader.tsx`: eliminar las dos líneas `void activeWorkspace;` / `void accessibleWorkspaces;` agregadas en Task 4, importar el selector y renderizarlo con `ml-auto`.

Import (junto a los demás):

```tsx
import { _WorkspaceSelector } from './_WorkspaceSelector';
```

Reemplazar el `<div className="flex w-full ...">` (líneas 47-54) por:

```tsx
      <div className="flex w-full items-center gap-1 px-4 lg:gap-2 lg:px-6">
        <SidebarTrigger className="-ml-1" />
        <Separator
          orientation="vertical"
          className="mx-2 data-[orientation=vertical]:h-4"
        />
        <h1 className="text-base font-medium">{pageTitle}</h1>
        <div className="ml-auto">
          <_WorkspaceSelector
            activeWorkspace={activeWorkspace}
            accessibleWorkspaces={accessibleWorkspaces}
          />
        </div>
      </div>
```

- [ ] **Step 4: Verificar lint, tipos y build**

Run: `npm run lint && npm run check-types && npm run build`
Expected: todo OK, sin variables sin usar (los `void` fueron eliminados).

- [ ] **Step 5: Verificación manual en navegador**

Run: `npm run dev`
Con usuario owner: en el header, a la derecha, aparece el toggle `[Gestión | Contable]`.
- Click en "Contable" ⇒ navega a `/dashboard/accounting`, el sidebar muestra Contabilidad y el toggle queda en Contable.
- Click en "Gestión" ⇒ navega a `/dashboard`, el sidebar muestra los módulos de gestión.
- Refrescar la página mantiene el espacio (persistido).

Para validar el caso de un solo espacio: con un usuario cuyo rol tenga solo `workspace.gestion`, el toggle **no** aparece y solo se ven módulos de Gestión.

Expected: comportamiento descrito.

- [ ] **Step 6: Commit**

```bash
git add src/shared/components/layout/_WorkspaceSelector.tsx src/shared/components/layout/_SiteHeader.tsx
git commit -m "feat(workspaces): selector de espacio en el header

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Documentación (dev + guía de usuario)

**Files:**
- Modify: `docs/architecture/auth-and-permissions.md` (o el doc de sidebar/arquitectura que exista)
- Modify: la guía de usuario en `src/modules/help/features/guide/components/` (el `_*Guide.tsx` correspondiente)

**Interfaces:**
- Consumes: comportamiento final de Tasks 1-6.
- Produces: documentación coherente con la feature (regla del proyecto).

- [ ] **Step 1: Localizar los docs a actualizar**

Run: `ls docs/architecture/ && ls src/modules/help/features/guide/components/`
Expected: identificar el doc de permisos/sidebar y el `_*Guide.tsx` general/dashboard.

- [ ] **Step 2: Documentar la 4ª capa y los permisos (dev)**

En el doc de arquitectura de auth/sidebar, agregar una sección "Espacios de Trabajo" describiendo: los permisos `workspace.gestion`/`workspace.contable`, la regla de mapeo (`accounting*` ⇒ Contable; resto ⇒ Gestión), la 4ª capa de filtrado del sidebar (derivada de la ruta vía `usePathname`), la persistencia en `UserPreference.activeWorkspaceId` y la backward-compat (sin permisos ⇒ ambos).

- [ ] **Step 3: Documentar para el usuario final**

En el `_*Guide.tsx` correspondiente, agregar una sección "Espacios de Trabajo": qué son (Gestión y Contable), cómo cambiar con el selector del header (arriba a la derecha), qué contiene cada espacio, y que la disponibilidad depende de los permisos del rol.

- [ ] **Step 4: Verificar build (los guides son TSX)**

Run: `npm run check-types`
Expected: sin errores.

- [ ] **Step 5: Commit**

```bash
git add docs src/modules/help
git commit -m "docs(workspaces): arquitectura de espacios y guía de usuario

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review (resultado)

**Spec coverage:**
- Permiso RBAC nuevo por espacio → Task 2 (constants) + Task 3 (seed/persistencia) + `getAccessibleWorkspaces`.
- Backward-compat → `resolveAccessibleWorkspaces` (Task 1, testeado) + `getAccessibleWorkspaces` (Task 3).
- Mapeo Contable=`accounting.*` / Gestión=resto → `getWorkspaceForModule` / `getWorkspaceForRoute` (Task 1, testeado).
- Persistencia `activeWorkspaceId` + default → Task 3.
- 4ª capa de filtrado del sidebar (derivada de la ruta) → Task 5.
- Selector en header a la derecha, visible solo con 2 espacios → Task 6.
- Landing por espacio + auto-ajuste por URL → `resolveEffectiveWorkspace` (Task 1) + Task 5/6.
- Sin aislamiento de rutas → no se añade guard; documentado.
- Tests de lógica pura (Vitest) → Task 1. Verificación manual UI → Tasks 5/6.
- Docs dev + guía usuario → Task 7.

**Placeholder scan:** sin TBD/TODO; cada step de código incluye el código.

**Type consistency:** `WorkspaceId`, `WORKSPACES`, `getWorkspaceForModule`, `getWorkspaceForRoute`, `resolveAccessibleWorkspaces`, `resolveEffectiveWorkspace`, `getAccessibleWorkspaces`, `getActiveWorkspace`, `setActiveWorkspace` se usan con la misma firma en las tareas que los consumen.

**Riesgo conocido / verificación:** Task 6 Step 2 verifica la existencia de `ui/tabs.tsx` antes de usarlo (instala si falta). Task 3 Step 5 confirma la forma de `getCurrentUserPermissions` contra el uso real en `sidebar.ts`.
