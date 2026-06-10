# Trabajo de Base de Datos — Rebaseline + Alineación Dev/Prod

**Fecha:** 2026-06-10
**Contexto:** No se podía hacer login en local tras la migración Clerk → Better Auth, y `prisma migrate dev` fallaba. Se alineó la BD de desarrollo con producción (fuente de verdad) y se reconstruyó el historial de migraciones.

---

## 1. Diagnóstico (causa raíz)

Eran **dos problemas independientes** que se sumaban:

### a) `prisma migrate dev` fallaba con P3006
```
column je.reversed_by does not exist
Migration `20260506134153_import_clerk_users_and_rewrite_fks` failed to apply
cleanly to the shadow database.
```
- **Drift de migraciones:** el historial del repo solo tenía ~6 migraciones que creaban una fracción del schema. El resto de las ~111 tablas (sales_invoices, budgets, columna `journal_entries.reversed_by`, etc.) se habían aplicado con `prisma db push`, **sin quedar registradas en migraciones**.
- `migrate dev` reconstruye una *shadow database* reproduciendo SOLO los archivos de migración. Como `reversed_by` nunca se creaba en una migración, la migración de import de Clerk (`UPDATE journal_entries SET reversed_by = ...`) explotaba en la shadow.
- El mismo drift existía en prod (111 tablas, 6 migraciones registradas).

### b) Login roto en local
- El `.env` local seguía con variables viejas de **Clerk** (`CLERK_SECRET_KEY`, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `RESEND_API_KEY`) y le **faltaban las de Better Auth**: `AUTH_SECRET` y `NEXT_PUBLIC_APP_URL`.
- Sin `AUTH_SECRET`, Better Auth no puede firmar sesiones → login falla aunque la BD esté perfecta.

---

## 2. Estado de las bases (antes)

| | Dev (`nahuel-boxer-db` @ localhost:5533) | Producción (`baxer` @ 31.97.42.82:5454) |
|---|---|---|
| Postgres | 16.11 | 17.9 |
| Migraciones registradas | 3 (solo las de febrero) | 6 (las 3 de feb + 3 de Better Auth) |
| Tablas | 107 (faltaban las 4 de Better Auth) | 111 |
| Tablas Better Auth (`user`, `account`, `session`, `verification`) | ❌ no existían | ✅ |
| Login | ❌ | ✅ |

**Decisión:** producción es la fuente de verdad. Se clonó prod → dev (schema + datos reales) y se rebaselinó el historial.

---

## 3. Pasos ejecutados

### Paso 0 — Seguridad de credenciales
- La credencial de prod estaba en `.env.example` (archivo **trackeado** por git, en whitelist del `.gitignore`). Se movió a `.env.prod.local` (gitignored).
- `.gitignore`: se agregó `backups/` y se corrigió una línea rota (`.devinbackups/` → `.devin` + `backups/`).

### Paso 1 — Backup de dev actual
```bash
pg_dump "$DEV" -Fp --no-owner --no-privileges -f backups/dev-pre-clone.sql
```

### Paso 2 — Backup de prod (también sirve de respaldo)
> Prod es pg17 y el cliente local es pg16 → se usa Docker `postgres:17`.
```bash
docker run --rm postgres:17 pg_dump "$PROD" -Fp --no-owner --no-privileges > backups/prod.sql
```

### Paso 3 — Backup de la tabla de bookkeeping de prod
```bash
docker run --rm postgres:17 pg_dump "$PROD" -Fp --no-owner --no-privileges \
  -t _prisma_migrations > backups/prod-_prisma_migrations.sql
```

### Paso 4 — Clonar prod → dev
> Se quitó la directiva `SET transaction_timeout = 0;` (pg17-only, no la entiende pg16).
```bash
grep -v "^SET transaction_timeout" backups/prod.sql > backups/prod.pg16.sql
psql "$DEV" -v ON_ERROR_STOP=1 -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
psql "$DEV" -v ON_ERROR_STOP=1 -f backups/prod.pg16.sql
```
Resultado: dev quedó con 111 tablas, 7 usuarios, 7 credenciales, 4 empresas, columna `reversed_by`, y las 6 migraciones de prod.

### Paso 5 — Generar baseline y archivar migraciones viejas
```bash
mkdir -p prisma/migrations/0_init
DATABASE_URL="$DEV" npx prisma migrate diff \
  --from-empty --to-config-datasource --script > prisma/migrations/0_init/migration.sql
```
- `0_init` = realidad actual (110 `CREATE TABLE`, excluye `_prisma_migrations`).
- Se movieron las 6 migraciones viejas + 2 `.sql` sueltos a `prisma/_migrations_archive/`.
- Quedó además `20260610130000_add_echeq_and_check_metadata` (migración nueva hecha a mano con: enum `payment_method` += `ECHEQ`, `checks.is_electronic`, columnas `check_*` en `receipt_payments` y `payment_order_payments`).

### Paso 6 — Marcar baseline aplicado en DEV
```bash
psql "$DEV" -c "DELETE FROM _prisma_migrations;"
DATABASE_URL="$DEV" npx prisma migrate resolve --applied 0_init
DATABASE_URL="$DEV" npx prisma migrate dev      # aplicó echeq + validó shadow OK
```
Resultado: `Database schema is up to date!` — el bloqueo P3006 quedó resuelto.

### Paso 7 — Marcar baseline aplicado en PROD (solo bookkeeping)
> No toca datos ni estructura, solo la tabla interna `_prisma_migrations`. Backup previo en paso 3.
```bash
docker run --rm postgres:17 psql "$PROD" -c "DELETE FROM _prisma_migrations;"
DATABASE_URL="$PROD" npx prisma migrate resolve --applied 0_init
```
Resultado: prod con `_prisma_migrations = [0_init]`, `echeq` queda **pendiente** (se deploya cuando se quiera).

### Paso 8 — Arreglar login (`.env`)
- Se generó `AUTH_SECRET` con `openssl rand -hex 32`.
- Se agregaron: `AUTH_SECRET`, `NEXT_PUBLIC_APP_URL="http://localhost:3000"`, `SMTP_*` (vacías).
- `npx prisma generate` para regenerar el cliente con los campos de `echeq`.

---

## 4. Verificación

| Prueba | Resultado |
|--------|-----------|
| `prisma migrate status` (dev) | `Database schema is up to date!` |
| `prisma migrate status` (prod) | `0_init` aplicado, `echeq` pendiente, sin drift |
| Home `http://localhost:3000/` | `200` |
| `GET /api/auth/get-session` | `200` → `null` |
| `POST /api/auth/sign-in/email` (password incorrecta) | `401 INVALID_EMAIL_OR_PASSWORD` (no 500) |
| Login real del usuario | ✅ entró correctamente |

---

## 5. Estado final del historial de migraciones

```
prisma/migrations/
├── 0_init/                                      # baseline (= realidad de prod)
├── 20260610130000_add_echeq_and_check_metadata/ # primera migración post-baseline
└── migration_lock.toml

prisma/_migrations_archive/                       # migraciones viejas (referencia)
├── 20240204_add_tax_status.sql
├── 20260204154454_add_company_tax_status/
├── 20260205130844_add_accounting_module/
├── 20260206105011_add_vat_fields/
├── 20260316_add_delivery_notes.sql
├── 20260506125559_better_auth_init/
├── 20260506125600_company_add_onboarding_completed/
└── 20260506134153_import_clerk_users_and_rewrite_fks/
```

---

## 6. Pendientes / Recordatorios

- [ ] **Commitear** los cambios de `prisma/migrations/` y `.gitignore` (los hace el usuario después).
- [ ] **Deploy de `echeq` a prod** cuando esté listo: `npx prisma migrate deploy`.
- [ ] **Rotar la contraseña de prod** (se compartió en el chat).
- [ ] (Opcional) Decidir si `prisma/_migrations_archive/` se versiona o se borra.

## 7. Notas operativas para el futuro

- **Prod es la fuente de verdad** de la BD. Para re-alinear dev, clonar de prod.
- Prod es **Postgres 17**, el cliente local es **pg16** → usar siempre `docker run --rm postgres:17 pg_dump/psql` contra prod.
- La credencial de prod vive en `.env.prod.local` (gitignored), NO en `.env.example`.
- `next dev` corre en el puerto **3000** (no 3001 como sugería `.env.example`).
- Archivos de backup en `backups/` (gitignored): `dev-pre-clone.sql`, `prod.sql`, `prod.pg16.sql`, `prod-_prisma_migrations.sql`.
