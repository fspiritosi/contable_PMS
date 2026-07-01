# Setup de Desarrollo

## Requisitos

- **Node.js** 18+ (recomendado 20+)
- **Docker** y Docker Compose
- **npm** como package manager

---

## Instalacion Rapida

```bash
# 1. Clonar e instalar
git clone <url-del-repositorio> nombre-proyecto
cd nombre-proyecto
npm install

# 2. Levantar PostgreSQL
docker-compose up -d db

# 3. Configurar variables de entorno
cp .env.example .env.local
# Editar .env.local con credenciales reales (Clerk, etc.)

# 4. Generar Prisma y aplicar schema
npm run db:generate
npm run db:push

# 5. (Opcional) Levantar MinIO para storage
docker-compose --profile storage up -d

# 6. Iniciar servidor de desarrollo
npm run dev
```

---

## Docker Compose

Archivo: `docker-compose.yml`

| Servicio | Imagen | Puerto | Profile |
|----------|--------|--------|---------|
| `db` | postgres:16-alpine | 5533:5432 | siempre |
| `minio` | minio/minio:latest | 9002:9000 (API), 9003:9001 (Console) | `storage` |
| `minio-init` | minio/mc:latest | - | `storage` |

```bash
# Solo PostgreSQL
docker-compose up -d db

# PostgreSQL + MinIO
docker-compose --profile storage up -d

# Detener todo
docker-compose --profile storage down
```

Credenciales por defecto:
- **PostgreSQL:** user `postgres`, password `postgres`, DB segun `instance.config.ts`
- **MinIO:** user `minioadmin`, password `minioadmin123`

El servicio `minio-init` crea automaticamente el bucket y configura el prefijo `public/` como accesible.

---

## Variables de Entorno

Todas las variables necesarias:

```env
# Base de Datos
POSTGRES_PASSWORD=postgres
DATABASE_URL=postgresql://postgres:postgres@localhost:5534/contable_pms?schema=public

# Clerk (autenticacion)
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_SECRET_KEY=sk_test_...

# Resend (emails transaccionales)
RESEND_API_KEY=re_...
EMAIL_FROM=onboarding@resend.dev

# Storage (MinIO/R2)
STORAGE_PROVIDER=s3              # "s3" o "local"
S3_ENDPOINT=http://localhost:9004
S3_REGION=us-east-1
S3_BUCKET=contable
S3_ACCESS_KEY=minioadmin
S3_SECRET_KEY=minioadmin123
S3_FORCE_PATH_STYLE=true         # true para MinIO, false para R2
S3_PUBLIC_URL=http://localhost:9004/contable

# Logging
NEXT_PUBLIC_SHOW_LOGS=true       # false para suprimir logs

# Docker (opcionales, usados por docker-compose)
POSTGRES_USER=postgres
POSTGRES_DB=contable_pms
MINIO_ROOT_USER=minioadmin
MINIO_ROOT_PASSWORD=minioadmin123
```

---

## Prisma

```bash
# Generar tipos TypeScript desde el schema
npm run db:generate

# Aplicar schema sin migraciones (desarrollo rapido)
npm run db:push

# Crear migracion (produccion)
npm run db:migrate

# Aplicar migraciones en produccion
npm run db:migrate:deploy

# Abrir Prisma Studio (UI para explorar datos)
npm run db:studio

# Seed inicial
npm run db:seed
```

El cliente Prisma se genera en `src/generated/prisma/` (no en `node_modules`). Se importa como:

```typescript
import { prisma } from '@/shared/lib/prisma';
import { Gender, VoucherType } from '@/generated/prisma/enums';
```

---

## Scripts npm

### Desarrollo
| Script | Comando | Descripcion |
|--------|---------|-------------|
| `dev` | `next dev --turbopack` | Servidor de desarrollo |
| `build` | `next build` | Build de produccion |
| `start` | `next start` | Servidor de produccion |

### Calidad
| Script | Comando | Descripcion |
|--------|---------|-------------|
| `lint` | `next lint` | Ejecutar ESLint |
| `lint:fix` | `next lint --fix` | Corregir ESLint |
| `format` | `prettier --write ...` | Formatear con Prettier |
| `format:check` | `prettier --check ...` | Verificar formato |
| `check-types` | `tsc --noEmit` | Verificar tipos TypeScript |

### Base de Datos
| Script | Comando | Descripcion |
|--------|---------|-------------|
| `db:generate` | `prisma generate` | Generar tipos Prisma |
| `db:push` | `prisma db push` | Push schema (dev) |
| `db:migrate` | `prisma migrate dev` | Crear migracion |
| `db:migrate:deploy` | `prisma migrate deploy` | Deploy migraciones |
| `db:studio` | `prisma studio` | UI de admin de BD |
| `db:seed` | `prisma db seed` | Seed inicial |

### Testing E2E
| Script | Comando | Descripcion |
|--------|---------|-------------|
| `cy:open` | `cypress open` | Cypress en modo UI |
| `cy:run` | `cypress run` | Todos los tests (headless) |
| `cy:run:dashboard` | `cypress run --spec ...` | Solo tests de dashboard |
| `cy:run:commercial` | `cypress run --spec ...` | Solo tests comerciales |
| `cy:run:accounting` | `cypress run --spec ...` | Solo tests contables |
| `cy:run:company-general` | `cypress run --spec ...` | Solo tests usuarios/roles |
| `test:e2e` | start-server-and-test ... | Servidor + Cypress |

### Setup
| Script | Comando | Descripcion |
|--------|---------|-------------|
| `setup:instance` | `npx tsx scripts/setup-instance.ts` | Configurar nueva instancia |
