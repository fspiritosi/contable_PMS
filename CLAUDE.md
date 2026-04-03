# CLAUDE.md - Guía del Proyecto NewProject

Este archivo es la **guía principal** del proyecto. Las reglas detalladas están en `.claude/rules/`.

---

## Tech Stack

```
Framework:        Next.js 16.1.3 + React 19 (App Router, Server Components)
Base de Datos:    PostgreSQL + Prisma ORM 7
Estado Global:    Zustand (global) + Jotai (atómico)
Estado Servidor:  React Query (TanStack Query v5)
UI:               shadcn/ui + Tailwind CSS v4 + Lucide Icons
Formularios:      React Hook Form + Zod (validación)
Autenticación:    Clerk
Storage:          MinIO (dev) / Cloudflare R2 (prod) - API S3
Fechas:           moment.js (NUNCA date-fns)
Notificaciones:   Sonner
```

### Versiones Clave

- Node.js: 18+ (recomendado 20+)
- Next.js: 16.1.3
- React: 19.2.3
- TypeScript: 5+
- Prisma: 7.2.0 (con adapter @prisma/adapter-pg)

---

## Comandos

```bash
# Desarrollo
npm run dev              # Servidor con Turbopack
npm run build            # Build producción
npm run start            # Servidor producción

# Calidad
npm run lint             # ESLint
npm run lint:fix         # Corregir ESLint
npm run format           # Prettier
npm run check-types      # TypeScript

# Base de Datos
npm run db:generate      # Generar Prisma
npm run db:push          # Push schema
npm run db:migrate       # Crear migración
npm run db:studio        # Prisma Studio

# Docker
docker-compose up -d db                    # Solo PostgreSQL
docker-compose --profile storage up -d     # PostgreSQL + MinIO

# Testing
npm run cy:open          # Cypress UI
npm run cy:run           # Cypress headless
```

---

## Arquitectura

```
┌─────────────────────────────────────────────────────────────────┐
│                         src/app/                                │
│   Páginas DELGADAS - Solo importan de modules/                  │
│   ├── (auth)/     → sign-in, sign-up                           │
│   ├── (core)/     → dashboard/* (protegido)                    │
│   └── api/        → storage                                    │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                       src/modules/                              │
│   LÓGICA DE NEGOCIO - Server Actions, Componentes, Features    │
│   └── {module}/                                                 │
│       ├── features/     → list, detail, create, edit           │
│       ├── types.ts                                              │
│       └── index.ts                                              │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                        src/shared/                              │
│   CÓDIGO COMPARTIDO - Usado por todos los módulos              │
│   ├── components/   → ui/, layout/, common/                    │
│   ├── hooks/        → useGeography, use-mobile                 │
│   ├── actions/      → geography, storage, catalogs             │
│   ├── lib/          → prisma, logger, utils, company           │
│   └── utils/        → formatters, mappers                      │
└─────────────────────────────────────────────────────────────────┘
```

---

## Reglas Críticas (Referencias)

Todas las reglas detalladas están en `.claude/rules/`. Se cargan automáticamente cada sesión.

| Regla | Archivo | Descripción |
|-------|---------|-------------|
| NO `:any` | `@.claude/rules/typescript-types.md` | Inferir tipos desde Prisma/Zod |
| Server Actions | `@.claude/rules/server-actions.md` | Ubicación por feature, nomenclatura |
| Logger | `@.claude/rules/logger.md` | Reemplazo automático de console.* |
| React Query | `@.claude/rules/react-query.md` | NUNCA useEffect+useState para fetch |
| Server Components | `@.claude/rules/server-components.md` | Server-first, prefijo `_` para client |
| Módulos | `@.claude/rules/module-structure.md` | Features con carpetas, NO archivos sueltos |
| Comunicación | `@.claude/rules/module-communication.md` | NO importar entre módulos, usar shared/ |
| Prisma | `@.claude/rules/prisma.md` | Queries optimizadas, select, getActiveCompanyId |
| UI/shadcn | `@.claude/rules/ui-shadcn.md` | Responsive, DataTable meta.title |
| Formularios | `@.claude/rules/forms.md` | React Hook Form + Zod |
| Storage | `@.claude/rules/storage.md` | MinIO/R2, presigned URLs |
| Nomenclatura | `@.claude/rules/nomenclature.md` | Archivos, imports, moment.js |
| Testing | `@.claude/rules/testing-cypress.md` | Cypress E2E - Tests obligatorios con cada cambio |
| Documentación | `docs/README.md` | Actualizar docs/ con cambios significativos |
| Doc. Usuario | `@.claude/rules/user-documentation.md` | Actualizar guía de usuario con cada cambio visible |
| Permisos | `@.claude/rules/permissions.md` | checkPermission en actions, PermissionGuard en pages, usePermissions en client |
| Industria | `@.claude/rules/industry.md` | Features por tipo de empresa (INDUSTRY_MODULES, INDUSTRY_FEATURES, useIndustry) |

---

## Reglas de Oro (Siempre Activas)

### 1. moment.js para Fechas

```typescript
// ✅ SIEMPRE
import moment from 'moment';
moment(date).format('DD/MM/YYYY');

// ❌ NUNCA
import { format } from 'date-fns';
```

### 2. Logger, NO console.*

```typescript
// ✅ SIEMPRE
import { logger } from '@/shared/lib/logger';
logger.info('mensaje');
logger.error('error', { data: { error } });

// ❌ NUNCA
console.log('mensaje');
```

### 3. useQuery para Fetching

```typescript
// ✅ SIEMPRE
const { data } = useQuery({
  queryKey: ['key'],
  queryFn: getData,
});

// ❌ NUNCA
const [data, setData] = useState([]);
useEffect(() => { getData().then(setData); }, []);
```

### 4. Client Components con Prefijo `_`

```typescript
// ✅ Server Component (por defecto)
EmployeesList.tsx

// ✅ Client Component (interactividad)
_EmployeesTable.tsx  // ← Nota el prefijo _
```

### 5. AlertDialog, NUNCA confirm()/alert()

```typescript
// ✅ SIEMPRE - AlertDialog de shadcn/ui
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

// ❌ NUNCA - confirm() / alert() del navegador
if (!confirm('¿Estás seguro?')) return;
alert('Operación completada');
```

### 6. app/ = Solo Rutas, NO Components

```typescript
// ❌ NUNCA crear carpetas de components en app/
app/(auth)/invite/
├── page.tsx
└── components/        // ❌ PROHIBIDO
    └── _MyComponent.tsx

// ✅ SIEMPRE poner components en modules/ o shared/
app/(auth)/invite/
└── page.tsx           // Solo importa de modules/ o shared/

modules/auth/features/accept-invitation/
├── AcceptInvitation.tsx
├── actions.server.ts
├── components/
│   └── _AcceptForm.tsx  // ✅ Componentes van aquí
└── index.ts
```

### 7. Tests E2E con Cada Cambio

```typescript
// Al crear/modificar una feature, SIEMPRE actualizar tests en cypress/e2e/
// Nueva feature → Crear spec nuevo
// Modificar feature → Actualizar tests existentes
// Cambiar textos/UI → Actualizar assertions

// Ejecutar tests del módulo afectado:
npm run cy:run:commercial    // cambios en comercial
npm run cy:run:accounting    // cambios en contabilidad
npm run cy:run:dashboard     // cambios en dashboard
```

### 8. Documentacion del Desarrollador con Cada Cambio

```
// Al hacer cambios significativos, actualizar docs/ correspondiente:
// Nuevo módulo         → docs/modules/{modulo}.md + docs/architecture/data-model.md
// Nuevo modelo Prisma  → docs/architecture/data-model.md
// Cambio en permisos   → docs/architecture/auth-and-permissions.md
// Cambio en infra      → docs/infrastructure/
// Cambio en shared/    → docs/architecture/project-structure.md
// Nueva convención     → docs/conventions/

// Documentación en: docs/README.md (índice principal)
```

### 9. Prisma Decimal → Number() antes de pasar a Client Components

Los campos `Decimal` de Prisma (montos, cantidades, tasas, etc.) NO se pueden serializar a Client Components. SIEMPRE convertir con `Number()` en el Server Action antes de retornar.

```typescript
// ✅ SIEMPRE - Convertir Decimals en el return del Server Action
return {
  ...invoice,
  total: Number(invoice.total),
  lines: invoice.lines.map((line) => ({
    ...line,
    quantity: Number(line.quantity),
    unitCost: Number(line.unitCost),
  })),
};

// ❌ NUNCA - Retornar el resultado directo de Prisma con Decimals
return await prisma.invoice.findFirst({ ... });
// Error: "Only plain objects can be passed to Client Components. Decimal objects are not supported."
```

**Regla**: Toda query Prisma que retorne datos consumidos por Client Components debe mapear TODOS los campos `Decimal` a `Number()`, incluyendo relaciones anidadas.

### 10. Documentación de Usuario con Cada Cambio

Al implementar una nueva funcionalidad visible para el usuario o modificar una existente,
SIEMPRE actualizar la guía de usuario en `src/modules/help/features/guide/components/`:

```typescript
// Nueva feature en módulo existente  → Actualizar el _*Guide.tsx correspondiente
// Nuevo módulo                        → Crear nuevo _*Guide.tsx + agregar tab en _HelpGuideTabs.tsx
// Cambio en flujo/UI                  → Actualizar pasos y descripciones en la guía
// Nuevo botón/acción visible          → Documentar en la sección correspondiente
// Eliminación de feature              → Remover de la guía
```

La guía debe describir:
- QUÉ hace la funcionalidad (en lenguaje simple para el usuario final)
- CÓMO usarla paso a paso
- Relación con otros módulos (si aplica)
- Estados y flujos (si aplica)

### 11. Permisos OBLIGATORIOS en TODA Feature

Toda feature debe implementar permisos en 3 niveles:

```typescript
// ✅ 1. Server Actions - checkPermission() al inicio de CADA función
import { checkPermission } from '@/shared/lib/permissions';

export async function getProducts() {
  await checkPermission('commercial.products', 'view', { redirect: true });
  // ... lógica
}

export async function createProduct(data: Input) {
  await checkPermission('commercial.products', 'create', { redirect: true });
  // ... lógica
}

// ✅ 2. Server Components - PermissionGuard con redirect en páginas
import { PermissionGuard } from '@/shared/components/common/PermissionGuard';

export async function ProductsList() {
  return (
    <PermissionGuard module="commercial.products" action="view" redirect>
      {/* contenido */}
      <PermissionGuard module="commercial.products" action="create">
        <Button>Nuevo Producto</Button>
      </PermissionGuard>
    </PermissionGuard>
  );
}

// ✅ 3. Client Components - usePermissions() para botones/acciones
import { usePermissions } from '@/shared/hooks/usePermissions';

const { hasPermission } = usePermissions();
{hasPermission('commercial.products', 'delete') && <Button>Eliminar</Button>}

// ❌ NUNCA - Server action sin checkPermission
export async function createProduct(data: Input) {
  const companyId = await getActiveCompanyId();
  return prisma.product.create({ data }); // SIN VERIFICAR PERMISOS
}
```

**Acciones**: `view` (listar/ver), `create`, `update`, `delete`, `approve`
**Módulos**: Usar nombres de `src/shared/lib/permissions/constants.ts`

**app/ solo puede contener:**
- `page.tsx` - Página de la ruta
- `layout.tsx` - Layout de la ruta
- `loading.tsx` - Estado de carga
- `error.tsx` - Manejo de errores
- `not-found.tsx` - 404
- Subcarpetas de rutas (ej: `[id]/`, `new/`)

### 12. Features por Tipo de Industria

Al crear nuevas features, evaluar si son universales o específicas de industria:

```typescript
// ✅ Feature específica de industria - Registrar en INDUSTRY_MODULES o INDUSTRY_FEATURES
// src/shared/lib/industry/constants.ts
export const INDUSTRY_FEATURES: Record<string, IndustryType[]> = {
  'products.triple-coding': ['AUTO_PARTS'],
};

// ✅ En Server Components
import { getIndustryType, isFeatureAvailableForIndustry } from '@/shared/lib/industry';
const industryType = getIndustryType(company?.industry);
{isFeatureAvailableForIndustry('products.triple-coding', industryType) && <Componente />}

// ✅ En Client Components
import { useIndustry } from '@/providers/IndustryProvider';
const { isFeatureAvailable } = useIndustry();
{isFeatureAvailable('products.triple-coding') && <Componente />}
```

- **Módulos completos** específicos: registrar en `INDUSTRY_MODULES`
- **Features dentro de módulos existentes**: registrar en `INDUSTRY_FEATURES`
- Features **universales** (mayoría): no requieren configuración

---

## Estructura del Proyecto

```
newproject/
├── prisma/
│   └── schema.prisma
│
├── src/
│   ├── app/                       # Routing (páginas delgadas)
│   │   ├── (auth)/                # Login, Register
│   │   ├── (core)/dashboard/      # App principal (protegido)
│   │   └── api/                   # API Routes (storage)
│   │
│   ├── modules/                   # Dominios de negocio
│   │   ├── dashboard/
│   │   ├── employees/
│   │   ├── teams/
│   │   ├── documents/
│   │   ├── commercial/
│   │   ├── operations/
│   │   ├── maintenance/
│   │   └── company/
│   │
│   ├── shared/                    # Código compartido
│   │   ├── components/
│   │   │   ├── ui/                # shadcn components
│   │   │   ├── layout/            # Sidebar, Header
│   │   │   └── common/            # DataTable, etc.
│   │   ├── hooks/
│   │   ├── actions/
│   │   ├── lib/
│   │   ├── utils/
│   │   ├── types/
│   │   └── zodSchemas/
│   │
│   ├── providers/
│   └── generated/prisma/
│
├── cypress/                       # Tests E2E
└── CLAUDE.md
```

---

## Estructura de un Módulo

```
modules/{module-name}/
├── features/
│   ├── list/
│   │   ├── {Module}List.tsx       # Server Component
│   │   ├── actions.server.ts      # Actions de ESTA feature
│   │   ├── components/
│   │   │   └── _{Module}Table.tsx # Client Component
│   │   └── index.ts
│   ├── detail/
│   ├── create/
│   └── edit/
│
├── types.ts
├── hooks/
└── index.ts
```

---

## Checklist antes de Commit

- [ ] `npm run check-types` pasa
- [ ] `npm run lint` pasa
- [ ] No hay `console.*` (solo `logger`)
- [ ] No hay `:any` en tipos
- [ ] Server Components por defecto
- [ ] Client Components tienen `_` en nombre
- [ ] Módulos no importan de otros módulos
- [ ] Enums usan tipos de Prisma
- [ ] No hay mapeos inline (usar `shared/utils/mappers.ts`)
- [ ] Componentes < 200 líneas
- [ ] Features tienen su carpeta (no archivos sueltos)
- [ ] Queries usan `select` para campos necesarios
- [ ] Server actions usan `getActiveCompanyId()`
- [ ] Columnas de DataTable tienen `meta.title`
- [ ] Campos `Decimal` de Prisma convertidos a `Number()` antes de pasar a Client Components
- [ ] Diseño responsive implementado
- [ ] Tests E2E actualizados/creados para los cambios (`cypress/e2e/`)
- [ ] Documentación del desarrollador actualizada si aplica (`docs/`)
- [ ] Guía de usuario actualizada si hay cambios visibles para el usuario (`src/modules/help/`)
- [ ] Permisos implementados: `checkPermission()` en actions, `PermissionGuard` en pages, `hasPermission` en client

---

## Referencias Rápidas

### Archivos Clave

```
src/shared/lib/prisma.ts            # Cliente Prisma
src/shared/lib/logger.ts            # Logger personalizado
src/shared/lib/company.ts           # getActiveCompany(), getActiveCompanyId()
src/shared/lib/storage.ts           # S3 presigned URLs
src/shared/lib/permissions/         # Sistema RBAC (checkPermission, constants, etc.)
src/shared/utils/formatters.ts      # formatDate, calculateAge
src/shared/utils/mappers.ts         # genderLabels, statusBadges
```

### Imports Comunes

```typescript
import { prisma } from '@/shared/lib/prisma';
import { logger, Logger } from '@/shared/lib/logger';
import { getActiveCompanyId } from '@/shared/lib/company';
import { checkPermission } from '@/shared/lib/permissions';
import { PermissionGuard } from '@/shared/components/common/PermissionGuard';
import { usePermissions } from '@/shared/hooks/usePermissions'; // Client Components
import { Button } from '@/shared/components/ui/button';
import { DataTable } from '@/shared/components/common/DataTable';
import { cn } from '@/shared/lib/utils';
import moment from 'moment';
```

---

**Las reglas detalladas están en `.claude/rules/`. Los skills de creación están en `.claude/skills/`.**
