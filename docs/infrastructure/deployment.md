# Deploy y Multi-instancia

## Migraciones automaticas en el deploy (Docker)

El contenedor de produccion aplica las migraciones de Prisma **automaticamente** al
arrancar, antes de levantar el servidor. No hace falta correr `prisma migrate deploy`
manualmente tras un deploy.

Como funciona:
- El `Dockerfile` copia el CLI de Prisma + engines al stage `runner` (el output
  standalone de Next.js no los incluye).
- El `ENTRYPOINT` es `docker-entrypoint.sh`, que ejecuta
  `node node_modules/prisma/build/index.js migrate deploy` y luego `node server.js`.
- Si las migraciones fallan, el contenedor **no arranca** (fail-fast), evitando servir
  contra una BD con el schema desactualizado.

Seguridad ante multiples replicas (Docker Swarm):
- `prisma migrate deploy` toma un advisory lock en Postgres, asi que aunque varias
  replicas arranquen a la vez, solo una aplica las migraciones y el resto continua
  sin reaplicarlas. No hay condiciones de carrera.

Requisitos:
- `DATABASE_URL` debe estar disponible como variable de entorno en el contenedor.
- Las migraciones versionadas viven en `prisma/migrations/` (se copian a la imagen).

---

## Build de Produccion

```bash
npm run build    # Genera el build optimizado
npm run start    # Inicia el servidor de produccion
```

Antes del build, verificar:
```bash
npm run check-types   # Sin errores de TypeScript
npm run lint          # Sin errores de ESLint
```

---

## Multi-instancia

El proyecto esta disenado para ser clonado y configurado para diferentes clientes. Cada instancia es un deploy independiente con su propia BD, storage y configuracion.

### Archivo de Configuracion

Archivo: `instance.config.ts`

```typescript
export const instanceConfig: InstanceConfig = {
  // Identificador unico (lowercase, sin espacios)
  id: 'mi-cliente',

  // Branding (visible en la UI)
  name: 'Mi Cliente S.A.',
  shortName: 'MC',        // 2-3 caracteres, para el logo
  description: 'Sistema de gestion - Mi Cliente',

  // Puertos (cambiar si hay multiples instancias en la misma maquina)
  ports: {
    app: 3000,             // Next.js
    database: 5432,        // PostgreSQL
    minioApi: 9000,        // MinIO S3 API
    minioConsole: 9001,    // MinIO Web Console
  },

  // Base de datos
  database: {
    name: 'mi-cliente-db',
    user: 'postgres',
  },

  // Storage
  storage: {
    bucket: 'mi-cliente-docs',
    region: 'us-east-1',
  },
};
```

### Setup Automatico

```bash
# Despues de editar instance.config.ts:
npm run setup:instance
```

El script `scripts/setup-instance.ts` actualiza automaticamente:
- `.env` - Variables de entorno con puertos y nombres correctos
- `docker-compose.yml` - Puertos y nombres de servicios
- `package.json` - Nombre del proyecto

**No editar manualmente** los archivos generados, ya que el script los sobrescribe.

### Ejemplo: Multiples Instancias

```
Instancia A:  app=3000, db=5432, minio=9000/9001
Instancia B:  app=3001, db=5533, minio=9002/9003
Instancia C:  app=3002, db=5534, minio=9004/9005
```

Cada instancia tiene su propio `docker-compose.yml` con puertos unicos.

---

## Checklist de Deploy

1. Editar `instance.config.ts` con datos del cliente
2. Ejecutar `npm run setup:instance`
3. Configurar credenciales en `.env`:
   - `CLERK_SECRET_KEY` y `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
   - `RESEND_API_KEY`
   - Credenciales de storage (S3/R2)
4. Levantar servicios: `docker-compose --profile storage up -d`
5. Generar Prisma: `npm run db:generate`
6. Aplicar migraciones: `npm run db:migrate:deploy`
7. Seed inicial: `npm run db:seed`
8. Build: `npm run build`
9. Start: `npm run start`
