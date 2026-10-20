# Estructura del Proyecto

## Arbol de Carpetas Raiz

```
proyecto/
├── prisma/
│   └── schema.prisma              # Modelo de datos
│
├── src/
│   ├── app/                       # Routing (paginas delgadas)
│   ├── modules/                   # Logica de negocio por dominio
│   ├── shared/                    # Codigo compartido
│   ├── providers/                 # Context providers (Clerk, Theme, Query)
│   └── generated/prisma/         # Tipos generados por Prisma
│
├── cypress/                       # Tests E2E
├── docs/                          # Documentacion interna
├── scripts/                       # Scripts de setup
│
├── instance.config.ts             # Config de instancia (branding, puertos)
├── cypress.config.ts              # Config de Cypress
├── docker-compose.yml             # PostgreSQL + MinIO
└── CLAUDE.md                      # Guia para asistente AI
```

---

## `src/app/` - Solo Routing

La carpeta `app/` es exclusivamente para routing de Next.js. **No debe contener componentes ni logica de negocio.**

### Archivos permitidos en `app/`
- `page.tsx` - Pagina de la ruta
- `layout.tsx` - Layout de la ruta
- `loading.tsx` - Estado de carga
- `error.tsx` - Manejo de errores
- `not-found.tsx` - 404
- Subcarpetas de rutas (`[id]/`, `new/`)

### Archivos prohibidos en `app/`
- `components/` - NUNCA
- Logica de negocio - NUNCA
- Utilidades - NUNCA

### Ejemplo correcto

```
app/(core)/dashboard/commercial/products/page.tsx
```
```typescript
// page.tsx solo importa y renderiza
import { ProductsList } from '@/modules/commercial/features/products/features/list';

export default function ProductsPage() {
  return <ProductsList />;
}
```

### Estructura de rutas

```
src/app/
├── (auth)/                        # Rutas de autenticacion
│   ├── invite/                    # Aceptar invitacion
│   ├── sign-in/[[...sign-in]]/    # Login (Clerk)
│   └── sign-up/[[...sign-up]]/    # Registro (Clerk)
│
├── (core)/dashboard/              # App principal (protegida)
│   ├── page.tsx                   # Dashboard principal
│   ├── commercial/                # Modulo comercial
│   ├── company/                   # Configuracion de empresa
│   ├── companies/                 # Gestion de empresas (multi-tenant)
│   ├── documents/                 # Documentos
│   ├── employees/                 # Empleados
│   └── equipment/                 # Equipamiento
│
├── api/                           # API Routes
│   ├── active-company/
│   ├── invoices/[id]/pdf/
│   ├── payment-orders/[id]/pdf/
│   ├── receipts/[id]/pdf/
│   └── storage/[...path]/
│
└── eq/[id]/                       # QR publico de equipos
```

---

## `src/modules/` - Logica de Negocio

Cada modulo es un dominio de negocio independiente.

### Modulos existentes

| Modulo | Descripcion |
|--------|-------------|
| `accounting` | Contabilidad (cuentas, asientos, reportes, settings) |
| `auth` | Flujo de aceptar invitacion |
| `commercial` | Comercial (CRM, productos, ventas, compras, tesoreria, almacenes, gastos) |
| `companies` | CRUD de empresas (multi-tenant) |
| `company` | Configuracion de empresa activa (catalogos, usuarios, roles) |
| `dashboard` | Dashboard principal con KPIs |
| `documents` | Gestion documental (tipos, empleados, equipos, empresa) |
| `employees` | Gestion de empleados |
| `equipment` | Gestion de vehiculos/equipos |

### Estructura de un Modulo

```
modules/{modulo}/
├── features/
│   ├── list/                      # Listado
│   │   ├── {Modulo}List.tsx       # Server Component principal
│   │   ├── actions.server.ts      # Server Actions de esta feature
│   │   ├── components/
│   │   │   └── _{Modulo}Table.tsx # Client Component (nota el _)
│   │   ├── columns.tsx            # Definicion de columnas (si usa DataTable)
│   │   └── index.ts               # Barrel export
│   │
│   ├── detail/                    # Detalle individual
│   │   ├── {Modulo}Detail.tsx
│   │   ├── actions.server.ts
│   │   └── components/
│   │
│   ├── create/                    # Creacion
│   │   ├── actions.server.ts
│   │   └── components/
│   │       └── _{Modulo}Form.tsx
│   │
│   └── edit/                      # Edicion
│       ├── actions.server.ts
│       └── components/
│
├── shared/                        # Compartido dentro del modulo
│   ├── types.ts                   # Tipos del modulo
│   ├── validators.ts              # Schemas Zod
│   └── utils.ts                   # Utilidades del modulo
│
├── types.ts                       # Tipos exportados
└── index.ts                       # Barrel export
```

### Convenciones de Nombres

| Patron | Tipo | Ejemplo |
|--------|------|---------|
| `ComponentName.tsx` | Server Component | `ProductsList.tsx`, `EmployeeDetail.tsx` |
| `_ComponentName.tsx` | Client Component | `_ProductsTable.tsx`, `_InvoiceForm.tsx` |
| `actions.server.ts` | Server Actions | Siempre este nombre, uno por feature |
| `columns.tsx` | Columnas DataTable | Definicion de columnas separada |
| `validators.ts` | Schemas Zod | Validacion de formularios |
| `index.ts` | Barrel export | Re-exporta el componente principal |

### Regla de comunicacion entre modulos

```typescript
// PROHIBIDO - Importar de otro modulo
import { utils } from '@/modules/commercial/shared/utils';

// CORRECTO - Usar shared/
import { formatCurrency } from '@/shared/utils/formatters';
```

---

## `src/shared/` - Codigo Compartido

```
src/shared/
├── components/
│   ├── ui/                        # shadcn/ui (40+ componentes)
│   ├── layout/                    # Sidebar, Header, CompanySelector
│   └── common/                    # DataTable, FileDropzone, PermissionGuard, _DateInput
│
├── hooks/
│   ├── useCatalogs.ts             # React Query para catalogos
│   ├── useDebounce.ts             # Debounce
│   ├── useGeography.ts            # Paises/provincias/ciudades
│   ├── usePermissions.ts          # RBAC en cliente
│   └── use-mobile.ts             # Deteccion de mobile
│
├── actions/
│   ├── catalogs.ts                # Fetch de catalogos
│   ├── catalogSearch.server.ts    # Busqueda server-side
│   ├── email.ts                   # Envio de emails
│   ├── geography.ts               # Datos geograficos
│   ├── sidebar.ts                 # Estado del sidebar
│   └── storage.ts                 # Upload/download de archivos
│
├── lib/
│   ├── prisma.ts                  # Cliente Prisma singleton
│   ├── company.ts                 # Multi-tenancy (getActiveCompanyId)
│   ├── logger.ts                  # Logger (reemplaza console.*)
│   ├── storage.ts                 # S3 presigned URLs
│   ├── utils.ts                   # cn() y utilidades generales
│   ├── email.ts                   # Servicio Resend
│   ├── excel-export.ts            # Exportacion a Excel
│   ├── permissions/               # Sistema RBAC completo
│   ├── documentConditions.ts      # Evaluacion de condiciones de documentos
│   ├── employeeStatus.ts          # Computacion de estado de empleado
│   └── vehicleStatus.ts           # Computacion de estado de vehiculo
│
├── utils/
│   ├── formatters.ts              # formatDate, formatCurrency, etc.
│   ├── business-day.ts            # "Hoy" en Argentina (zona del negocio)
│   ├── date-input.ts              # Date ↔ valor de <input type="date"> (local / UTC), businessToday
│   ├── mappers.ts                 # Labels y badges para enums
│   ├── documentPaths.ts           # Path builders para storage
│   └── slugify.ts                 # Slugificacion de strings
│
├── config/
│   ├── instance.ts                # Config de instancia
│   ├── storage.config.ts          # Config S3/MinIO
│   └── documentConditions.ts      # Config de condiciones de docs
│
├── emails/
│   └── InvitationEmail.tsx        # Template de email (React Email)
│
├── types/
│   └── index.ts                   # Tipos compartidos
│
└── zodSchemas/                    # Schemas Zod compartidos
```

---

## `src/generated/prisma/`

Codigo generado automaticamente por Prisma. Contiene:

- `client/` - PrismaClient
- `enums/` - Enums de TypeScript exportados (Gender, Status, VoucherType, etc.)

Se regenera con `npm run db:generate`. **Nunca editar manualmente.**

Importar enums:
```typescript
import { Gender, VoucherType } from '@/generated/prisma/enums';
```
