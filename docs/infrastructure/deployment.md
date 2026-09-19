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

### Chequeos post-deploy contra la base

La imagen `runner` no incluye `tsx` ni `src/`, asi que los scripts de `prisma/scripts/` no se
corren dentro del contenedor de la app: se abre `psql` en el contenedor de Postgres y se pega el
SQL que cada script documenta en su header.

- **Facturas confirmadas sin asiento** (`prisma/scripts/diagnose-invoices-without-entry.ts`,
  solo lectura). Conviene correrlo despues de deployar TSK-721: hasta ese ticket una factura de
  venta o compra con una linea sin cuenta contable quedaba `CONFIRMED` con `journal_entry_id IS
  NULL` en silencio; desde TSK-721 la confirmacion se bloquea, pero las historicas siguen en la
  base. El header del script trae el SQL (detalle por empresa y fecha, resumen por empresa y
  tipo, y la consulta de items sin cuenta). Si devuelve filas, se le avisa a la clienta: que hacer
  con esos comprobantes (regenerar el asiento o asentarlos a mano) es una decision contable y va
  en un ticket aparte.

- **Equipos y Bienes de Uso** (TSK-724c). Dos chequeos, uno en la UI y otro en la base:
  1. **Permisos de Equipos a roles personalizados.** `equipment` salio de `HIDDEN_MODULES`, y los roles
     personalizados creados mientras estuvo oculto no tienen permisos de `equipment` ni de
     `company.vehicle-types` (la UI de Roles nunca los ofrecio; los roles de sistema si los tienen).
     Entrar a Empresa → Roles y otorgar Ver/Crear/Editar/Eliminar de "Equipos" y de "Tipos de Equipo"
     a los roles que lo necesiten. Sin esto, un usuario que no sea Propietario no ve el modulo.
  2. **Cuantos equipos/depreciaciones/periodos hay y si las globales estan cargadas.** Los campos
     nuevos nacen en NULL y el fallback a las cuentas por defecto mantiene el comportamiento anterior
     para todo equipo que no se toque; los asientos ya contabilizados quedan en la cuenta con la que se
     generaron (no se reasignan). Anotar el resultado en el plan del ticket:

     ```sql
     SELECT c.name,
            (SELECT count(*) FROM vehicles v WHERE v.company_id = c.id)                         AS equipos,
            (SELECT count(*) FROM vehicle_depreciations d WHERE d.company_id = c.id)            AS con_depreciacion,
            (SELECT count(*) FROM depreciation_schedule_entries e
               JOIN vehicle_depreciations d ON d.id = e.depreciation_id
              WHERE d.company_id = c.id AND e.is_posted)                                        AS periodos_contabilizados,
            (SELECT count(*) FROM asset_value_adjustments a WHERE a.company_id = c.id)         AS ajustes,
            s.fixed_asset_account_id IS NOT NULL                                                AS tiene_bu,
            s.accumulated_depreciation_account_id IS NOT NULL                                   AS tiene_aa,
            s.depreciation_expense_account_id IS NOT NULL                                       AS tiene_gasto,
            (SELECT count(*) FROM vehicle_types t WHERE t.company_id = c.id AND t.is_active)   AS tipos_equipo
     FROM companies c LEFT JOIN accounting_settings s ON s.company_id = c.id;
     ```

```bash
sudo docker exec -it $(sudo docker ps -q --filter name=contablemas-contablemas) \
  sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
```

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
