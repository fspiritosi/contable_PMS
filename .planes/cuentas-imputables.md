# Cuentas Imputables / No imputables (Ticket #376)

**Fecha de inicio:** 2026-07-01
**Estado:** Planificación completada

---

## 1. Análisis

### 1.1 Problema

En un plan de cuentas jerárquico no todas las cuentas reciben movimientos:

- **Cuentas imputables** (hojas): reciben asientos. Son siempre las **últimas de la rama** (sin hijos). Muestran su **saldo**.
- **Cuentas de sumatoria** (con hijos): agrupan/totalizan a sus imputables. **No** reciben asientos directos; muestran la **suma de sus hijas**. Una cuenta con hijos NUNCA es imputable.

Se pide, además:

1. Selector en la carga/edición de cuenta para determinar su carácter (imputable vs sumatoria/resultado).
2. Selector de **cuenta padre limitado al mismo `type`** (Activo → padres Activo, etc.).
3. Las cuentas de **tipo Resultado** no deben aparecer en los selects de imputación de otras features (Movimiento Bancario, config contable de Artículos, Config Contable).
4. Imputables muestran **saldo**; sumatoria muestran **suma de hijas**.
5. Estructura de código **x.x.x/xx/xx**: todos los segmentos, los vacíos se rellenan con 0, el **primer segmento nunca es 0**.
6. **Deshabilitar** cuentas con reglas por **ejercicio**:
   - Solo imputables en **saldo 0** se deshabilitan para el **ejercicio en curso**.
   - Con saldo, se deshabilita para el **próximo ejercicio**.
   - Deshabilitar un **padre** cascadea a todas las hijas con las mismas reglas.

### 1.2 Contexto actual

#### Modelo `Account` (prisma/schema.prisma:294)
Campos ya existentes que se solapan con los requisitos:
- `code String` — texto libre (ej. "1.1.1"), único por empresa (`@@unique companyId_code`). **No** valida el formato x.x.x/xx/xx hoy.
- `type AccountType` — enum `ASSET | LIABILITY | EQUITY | REVENUE | EXPENSE` (schema:218).
- `nature AccountNature` — `DEBIT | CREDIT` (schema:229). Ya se valida coherencia type↔nature en `validateAccountNature` (ASSET/EXPENSE→DEBIT; LIABILITY/EQUITY/REVENUE→CREDIT).
- `parentId` + relación self `AccountHierarchy` (`parent`/`children`).
- `isActive Boolean @default(true)` — habilitado/deshabilitado (un único booleano, **sin dimensión de ejercicio**).
- **`isLeaf Boolean @default(true)`** — ya existe y conceptualmente ES "imputable" (hoja). **Riesgo:** hoy no se mantiene automáticamente al agregar/quitar hijos (los actions de create/update no lo tocan).
- `requiresAuxiliary AuxiliaryType?`, `adjustableByInflation`, `currency`.

**Mapeo tipo→"Resultado" vs "Patrimonial"** (no existe como campo; se deriva del `type`):
- Resultado (Estado de Resultados): `REVENUE`, `EXPENSE`.
- Patrimoniales (Balance): `ASSET`, `LIABILITY`, `EQUITY`.

#### Ejercicios contables — SÍ existen
- `FiscalYear` (schema:660): `number`, `startDate`, `endDate`, `isClosed`, `closedAt`, entradas de apertura/cierre. `@@unique(companyId, number)`.
- `AccountingPeriod` (schema:687): períodos mensuales por ejercicio.
- ⇒ El requisito 6 **es modelable**. Falta una noción de "cuenta deshabilitada a partir de X ejercicio" (hoy `isActive` es global, sin fecha/ejercicio de corte).

#### Cálculo de saldos — ya resuelto
`src/modules/accounting/shared/utils/balances.ts`:
- `calculateAccountBalance(accountId, companyId, upToDate?)` (:10) — suma `debit`/`credit` de `journalEntryLine` con `entry.status = 'POSTED'`.
- `calculateAllAccountBalances(companyId, upToDate?)` (:64) — **query raw única** que agrega por `account_id` (solo cuentas con líneas = imputables). Devuelve `Map<accountId, {debit, credit, balance}>`.
- El **saldo de una cuenta de sumatoria** NO está: hay que hacer un **roll-up** del árbol (sumar los balances de las imputables descendientes). Se puede construir sobre `calculateAllAccountBalances` + `buildAccountTree`.

#### Alta/edición de cuentas
- `actions.server.ts`: `createAccount` (:14) y `updateAccount` (:51). Validan code único, parent existe, coherencia type↔nature. **No** setean `isLeaf` ni validan mismo-tipo del padre ni formato de code.
- Validadores en `shared/validators/index.ts`: `validateAccountCode`, `validateAccountParent` (solo valida existencia/empresa, **no** el tipo), `validateAccountNature`.
- Formularios: `components/_CreateAccountModal.tsx`, `_EditAccountModal.tsx`, `_CreateAccountModalContainer.tsx`. Import/export Excel en `lib/import-export.server.ts` (también crea cuentas — hay que aplicarle las mismas reglas).
- Árbol: `components/_AccountsTable.tsx` (recursivo, chevron/indent) + `buildAccountTree` en `shared/utils/index.ts`.

#### Selects de cuentas fuera de accounts (a filtrar) — inventario
Ninguno usa un componente compartido; cada uno arma su propio fetch. Estado actual del filtro:

| Ubicación | Función fetch | Filtra hoy |
|---|---|---|
| Artículos - Gasto/Ingreso | `products/shared/catalog-actions.server.ts:getAccountsForProductSelect` | `isActive`, **`isLeaf`**, + por `nature` en cliente |
| Movimiento Bancario (contrapartida) | `treasury/.../bank-movements/actions.server.ts:getAccountsForBankMovement` (:496) | solo `isActive` (trae TODO) |
| Asientos - líneas | `accounts/actions.server.ts:getAccounts` (:153) | solo `isActive` |
| Config Contable (18+ campos) | `settings/actions.server.ts:getActiveAccounts` (:188) | solo `isActive`, filtra por `type` en cliente |
| Saldos de apertura | `opening-balances/actions.server.ts` (:50) | solo `isActive` |
| Presupuestos | `budgets/actions.server.ts:getBudgetableAccounts` (:414) | `isActive`, `type in (EXPENSE,REVENUE)`, **hojas** (`children none`) |
| Cuenta bancaria vinculada (oculto) | `bank-accounts/list/actions.server.ts:getAvailableAccounts` (:244) | `isActive`, `type=ASSET` |

Solo Artículos y Presupuestos excluyen cuentas de sumatoria. **Asientos, Movimiento Bancario y Config Contable dejan elegir cuentas de sumatoria** — inconsistencia a corregir (una imputación siempre debe ir a una cuenta imputable/hoja).

### 1.3 Archivos involucrados

**Schema / datos**
- `prisma/schema.prisma` — modelo `Account` (posibles campos nuevos, ver 1.6).
- `prisma/migrations/<nueva>/migration.sql` — migración no destructiva + backfill (`isLeaf` según hijos; normalización de `code`).

**Módulo accounts**
- `features/accounts/actions.server.ts` — mantener `isLeaf` en create/update/delete; validar mismo-tipo del padre; formato de code; lógica de deshabilitar en cascada por ejercicio.
- `shared/validators/index.ts` — `validateAccountParent` (agregar mismo-tipo), nuevo `validateAccountCodeFormat`, reglas de imputable.
- `features/accounts/components/_CreateAccountModal.tsx`, `_EditAccountModal.tsx`, `_DeleteAccountDialog.tsx` (o nuevo diálogo de deshabilitar).
- `features/accounts/components/_AccountsTable.tsx` — columna saldo (imputables) / suma (sumatoria) + estado habilitado.
- `shared/utils/balances.ts` — helper de roll-up de saldos por árbol.
- `shared/utils/index.ts` — `buildAccountTree` (reutilizar).
- `lib/import-export.server.ts` — aplicar reglas de code/isLeaf/tipo en importación.

**Selects externos (filtrar a imputables/tipo correcto)**
- `products/shared/catalog-actions.server.ts` (ya ok, revisar).
- `treasury/.../bank-movements/actions.server.ts` (agregar `isLeaf` + excluir Resultado según regla).
- `accounts/actions.server.ts:getAccounts` para asientos (¿variante solo-hojas?).
- `settings/actions.server.ts:getActiveAccounts` (imputables por tipo).
- Idealmente: **componente/acción compartida `getImputableAccounts({types?})`** para unificar.

**Docs / guía**
- `docs/architecture/data-model.md`, `docs/modules/accounting*.md`.
- `src/modules/help/features/guide/components/_AccountingGuide.tsx`.

### 1.4 Dependencias
- `FiscalYear` / ejercicio en curso (para regla de deshabilitar). Requiere una forma de obtener el ejercicio activo de la empresa.
- `calculateAllAccountBalances` (saldos) para regla de deshabilitar y para la columna de saldo.
- Sistema de permisos (`accounting.accounts`), `getActiveCompanyId`, reglas de Decimal→Number.
- Impacta datos existentes (cuentas ya cargadas con code libre e `isLeaf` posiblemente inconsistente).

### 1.5 Restricciones y reglas (CLAUDE.md)
- `Decimal → Number()` antes de pasar saldos a Client Components.
- `checkPermission` en cada action; `PermissionGuard` en pages; `usePermissions` en cliente.
- moment.js para fechas; `logger` (no console); Server Components por defecto, Client con prefijo `_`.
- No importar entre módulos (treasury/commercial no deben importar de accounting → necesitan su propia action o una compartida en `shared/`).
- Migraciones no destructivas (patrón de `prisma/migrations`).
- DataTable/árbol con `meta.title`; diseño responsive; componentes < 200 líneas.

### 1.6 Riesgos identificados / decisiones de diseño abiertas

1. **¿"Imputable" = `isLeaf` existente o campo nuevo?** Recomendado reutilizar `isLeaf` (ya está y semánticamente es hoja=imputable) y **mantenerlo automáticamente**: una cuenta pasa a `isLeaf=false` cuando adquiere hijos, y no se permite imputar/deshabilitar-con-saldo sobre no-hojas. Alternativa: campo explícito `isImputable`/`accountKind`. **Decisión de negocio pendiente.**

2. **Ambigüedad "imputable vs resultado" (criterio de aceptación 1 vs 3).** El ticket mezcla dos ejes: estructural (imputable/sumatoria = hoja/padre) y por tipo (patrimonial/resultado). Hay que confirmar con el usuario qué debe filtrar cada select "de imputación": ¿solo hojas? ¿hojas excluyendo `REVENUE/EXPENSE`? ¿o depende del contexto (contrapartida bancaria = patrimoniales; línea de asiento = cualquier hoja)? **Bloqueante para requisito 3.**

3. **Deshabilitar por ejercicio.** `isActive` es un booleano global. Para "deshabilitar a partir del próximo ejercicio" hace falta un campo nuevo (ej. `disabledFromFiscalYearId` / `disabledFrom Date`) o una tabla de estado por ejercicio. Definir el alcance mínimo (¿basta con un `disabledFrom` fecha/ejercicio?).

4. **Formato de code x.x.x/xx/xx.** Hoy `code` es libre. Definir: ¿se valida y normaliza el string, o se agregan segmentos numéricos? ¿Se migran los códigos existentes? ¿El primer segmento se relaciona con el `type` (1=Activo, 2=Pasivo…)? Riesgo de **migración de datos** y de romper el `@@unique(companyId, code)`.

5. **Saldo de cuentas de sumatoria** = roll-up del árbol; costo de cálculo en listados grandes (mitigable con `calculateAllAccountBalances` + suma en memoria).

6. **Consistencia en selects externos:** cambiar los filtros puede ocultar cuentas que hoy se eligen (datos ya asociados a cuentas de sumatoria). Revisar impacto antes de restringir.

7. **Import/export Excel** crea cuentas por fuera del form: aplicar las mismas validaciones o quedará una vía para violar las reglas.

### 1.7 Decisiones tomadas (2026-07-01)

1. **Imputable = `isLeaf`.** Se reutiliza el campo existente. Se mantiene automáticamente: una cuenta pasa a `isLeaf=false` cuando adquiere hijas (y no puede recibir imputaciones ni deshabilitarse con saldo). No se agrega campo nuevo.
2. **Selects de imputación = solo hojas + tipo según contexto.** Todos los selects de imputación muestran únicamente cuentas imputables (hojas). Además cada select filtra por el/los `type` que le corresponden a su contexto (ej: contrapartida bancaria → patrimoniales; línea de asiento → cualquier hoja; config contable → el tipo del campo). Se corrige la inconsistencia de Asientos/Mov. Bancario/Config Contable que hoy dejan elegir cuentas de sumatoria.
3. **Deshabilitar = campo `disabledFrom`.** Corte "deshabilitada desde ejercicio/fecha X": saldo 0 → corte en ejercicio actual; con saldo → corte en próximo ejercicio; deshabilitar padre cascadea a hijas con las mismas reglas. No se crea tabla por-ejercicio.
4. **Código = validar/normalizar String.** `code` sigue siendo String; se valida el formato x.x.x/xx/xx y se rellenan segmentos vacíos con 0 al guardar (primer segmento nunca 0). La migración solo normaliza los códigos existentes. No se descompone en columnas numéricas.

---

## 2. Planificación

> Basada en las **Decisiones tomadas (1.7)**: imputable = `isLeaf` mantenido automáticamente; selects de imputación = solo hojas + filtro por `type` según contexto; deshabilitar mediante nuevo campo `disabledFrom`; `code` sigue String validado/normalizado a formato `x.x.x/xx/xx`.

### 2.1 Fases de implementación

#### Fase 1: Schema + migración
- **Objetivo:** Preparar el modelo de datos para soportar deshabilitado por ejercicio y dejar consistentes los datos existentes (`isLeaf` real según hijos y `code` normalizado), sin destruir información.
- **Tareas:**
  - [ ] Agregar a `Account` el campo de corte de deshabilitado. Propuesta: `disabledFrom DateTime?` (fecha de corte) + `disabledFromFiscalYearId String?` con relación opcional a `FiscalYear` (para saber "a partir de qué ejercicio"). Se define la firma final en Diseño; mantener `isActive` como estado global vigente (backward compatible).
  - [ ] Índice para consultas por corte (`@@index([companyId, disabledFrom])`) si el listado lo requiere.
  - [ ] Confirmar que `isLeaf Boolean @default(true)` se mantiene (no se agrega campo nuevo de imputable — decisión 1.7.1).
  - [ ] Crear migración no destructiva en `prisma/migrations/<timestamp>_account_disabled_from_and_backfill/migration.sql`:
    - `ALTER TABLE ... ADD COLUMN` para los campos nuevos (nullable, sin default destructivo).
    - **Backfill `isLeaf`:** `UPDATE ... SET is_leaf = false WHERE id IN (SELECT DISTINCT parent_id FROM ... WHERE parent_id IS NOT NULL)` y `is_leaf = true` para el resto.
    - **Normalización de `code`:** rellenar segmentos vacíos con 0 y validar primer segmento ≠ 0, respetando `@@unique(companyId, code)`. Si la normalización SQL resulta compleja, hacerla en un script de datos idempotente invocado post-migración (documentar en Diseño). Detectar y reportar colisiones de unicidad antes de aplicar.
  - [ ] `npm run db:migrate` local + `npm run db:generate`.
- **Archivos:**
  - `prisma/schema.prisma` (modelo `Account`, ~línea 294).
  - `prisma/migrations/<nueva>/migration.sql`.
- **Criterio de completitud:** Migración corre limpia sobre una copia con datos reales; `isLeaf` refleja la jerarquía existente; todos los `code` cumplen `x.x.x/xx/xx`; no hay violación de `@@unique(companyId, code)`; `prisma generate` sin errores.

#### Fase 2: Validaciones y reglas de dominio (server)
- **Objetivo:** Centralizar en el módulo accounting las reglas de negocio: mantener `isLeaf` automático, validar padre mismo-tipo, validar/normalizar `code`, deshabilitar por saldo/ejercicio con cascada, y roll-up de saldos de sumatoria.
- **Tareas:**
  - [ ] `validateAccountCodeFormat(code)`: normaliza a `x.x.x/xx/xx` (segmentos vacíos → 0, primer segmento ≠ 0) y devuelve el code normalizado; usar en create/update e import.
  - [ ] Extender `validateAccountParent(companyId, parentId, childType)`: además de existencia/empresa, exigir `parent.type === childType` (mismo tipo). Rechazar como padre a cuentas que serían ciclos.
  - [ ] Mantenimiento de `isLeaf`:
    - En `createAccount`: la cuenta nueva nace `isLeaf=true`; si tiene `parentId`, poner `parent.isLeaf=false` (transacción).
    - En `updateAccount`: si cambia `parentId`, recomputar `isLeaf` del padre anterior (¿le quedan hijos? → true si no) y del nuevo (false).
    - En `deleteAccount`: al borrar la última hija de un padre, recomputar `parent.isLeaf=true`. Bloquear borrado de cuenta con movimientos/hijas según reglas actuales.
  - [ ] `disableAccount(companyId, accountId)` (nueva action):
    - Obtiene ejercicio en curso vía `FiscalYear` (helper `getCurrentFiscalYear(companyId)` en `accounting/shared`).
    - Calcula saldo con `calculateAllAccountBalances` (o roll-up si es sumatoria): saldo 0 → corte en **ejercicio actual**; saldo ≠ 0 → corte en **próximo ejercicio**.
    - Setea `disabledFrom` / `disabledFromFiscalYearId` en consecuencia.
    - **Cascada:** aplica la misma regla a todas las hijas descendientes (recorrer subárbol) dentro de una transacción.
    - `checkPermission('accounting.accounts', 'update')`; `logger`; Decimal→Number en cualquier saldo retornado.
  - [ ] `getAccountRollupBalances(companyId, upToDate?)` en `shared/utils/balances.ts`: sobre `calculateAllAccountBalances` + `buildAccountTree`, suma en memoria los saldos de las hojas descendientes para cada cuenta de sumatoria. Devuelve `Map<accountId, {debit, credit, balance}>` cubriendo hojas y padres.
  - [ ] Helper `isAccountEnabled(account, fiscalYear)` para derivar estado vigente considerando `disabledFrom` vs ejercicio consultado.
- **Archivos:**
  - `src/modules/accounting/features/accounts/actions.server.ts` (create/update/delete + nueva `disableAccount`).
  - `src/modules/accounting/shared/validators/index.ts` (`validateAccountParent`, `validateAccountCodeFormat`).
  - `src/modules/accounting/shared/utils/balances.ts` (`getAccountRollupBalances`).
  - `src/modules/accounting/shared/utils/index.ts` (reutilizar `buildAccountTree`); helper `getCurrentFiscalYear` (ubicación a definir en Diseño).
- **Criterio de completitud:** Tests/pruebas manuales muestran: crear hija marca al padre no-hoja; borrar última hija vuelve al padre hoja; padre debe ser del mismo tipo; codes se normalizan; `disableAccount` respeta la regla saldo/ejercicio y cascadea; `getAccountRollupBalances` devuelve la suma correcta para sumatoria. `npm run check-types` + `lint` OK.

#### Fase 3: UI del módulo accounts
- **Objetivo:** Reflejar las reglas en alta/edición, árbol y deshabilitado, e Import/Export Excel.
- **Tareas:**
  - [ ] Form crear/editar: selector de padre limitado al **mismo `type`** (deshabilitar/ocultar los de otro tipo); indicador derivado imputable (hoja) vs sumatoria (con hijas) — no editable, se deriva; validación de `code` con feedback del formato normalizado.
  - [ ] Árbol `_AccountsTable.tsx`: nueva columna **Saldo** para imputables y **Suma de hijas** para sumatoria (usando `getAccountRollupBalances`, Decimal→Number en el server action que alimenta la tabla); columna/indicador de **estado habilitado** (vigente / deshabilitada desde ejercicio N). `meta.title` en todas las columnas.
  - [ ] Diálogo de deshabilitar con **AlertDialog** (NUNCA confirm): explica el efecto según saldo (corte en ejercicio actual vs próximo) y advierte de la **cascada a hijas**; muestra a partir de qué ejercicio quedará deshabilitada.
  - [ ] Import/Export Excel (`lib/import-export.server.ts`): aplicar `validateAccountCodeFormat`, mantenimiento de `isLeaf`, y validación de padre mismo-tipo en la importación (misma vía que el form).
  - [ ] Permisos: `PermissionGuard` en la page, `usePermissions` para botones (crear/editar/deshabilitar) en client components (`_` prefix).
- **Archivos:**
  - `src/modules/accounting/features/accounts/components/_CreateAccountModal.tsx`, `_EditAccountModal.tsx`, `_CreateAccountModalContainer.tsx`.
  - `src/modules/accounting/features/accounts/components/_AccountsTable.tsx`.
  - `src/modules/accounting/features/accounts/components/_DisableAccountDialog.tsx` (nuevo) — o extender `_DeleteAccountDialog.tsx`.
  - `src/modules/accounting/features/accounts/lib/import-export.server.ts`.
  - Server action que provee saldos a la tabla (en `actions.server.ts`).
- **Criterio de completitud:** En la UI el selector de padre solo muestra mismo tipo; el árbol muestra saldo/suma y estado; el diálogo de deshabilitar explica correctamente el corte y la cascada; import de Excel respeta las reglas; botones respetan permisos. Responsive y componentes < 200 líneas.

#### Fase 4: Selects de imputación externos
- **Objetivo:** Que todos los selects de imputación muestren **solo cuentas imputables (hojas)** filtradas por `type` según contexto, corrigiendo la inconsistencia actual (Asientos / Mov. Bancario / Config Contable dejan elegir sumatoria).
- **Tareas:**
  - [ ] Definir el mecanismo compartido respetando **no-imports-cross-module**: helper en `src/shared/` que arme el filtro (`{ isActive: true, isLeaf: true, type: { in } }`) reutilizable, **o** una action propia por módulo que aplique el mismo criterio. Decidir en Diseño (preferible helper de filtro en `shared/` para no duplicar la query Prisma). Los que consumen cuentas viven fuera de accounting (treasury, commercial/products, settings), por eso no pueden importar de accounting.
  - [ ] Movimiento Bancario (`getAccountsForBankMovement`, treasury): agregar `isLeaf: true` y filtrar por tipos patrimoniales (excluir Resultado) según contexto contrapartida.
  - [ ] Líneas de Asiento (`getAccounts` en accounts, o variante `getImputableAccounts`): solo hojas; cualquier tipo.
  - [ ] Config Contable (`getActiveAccounts`, settings, 18+ campos): solo hojas, filtradas por el `type` del campo.
  - [ ] Revisar Artículos (`getAccountsForProductSelect` — ya usa `isLeaf`, confirmar) y Presupuestos (`getBudgetableAccounts` — ya excluye sumatoria vía `children none`; alinear al criterio único).
  - [ ] Verificar impacto: reportar/registrar datos existentes hoy asociados a cuentas de sumatoria antes de restringir (riesgo 1.6.6).
- **Archivos:**
  - `src/modules/treasury/.../bank-movements/actions.server.ts` (~:496).
  - `src/modules/accounting/features/accounts/actions.server.ts` (`getAccounts` ~:153).
  - `src/modules/accounting/features/settings/actions.server.ts` (`getActiveAccounts` ~:188).
  - `src/modules/products/shared/catalog-actions.server.ts` (`getAccountsForProductSelect`), `budgets/actions.server.ts` (`getBudgetableAccounts` ~:414), `opening-balances/actions.server.ts` (~:50), `bank-accounts/list/actions.server.ts` (`getAvailableAccounts` ~:244).
  - Helper compartido en `src/shared/` (nombre a definir, p. ej. `imputable-accounts-filter.ts`).
- **Criterio de completitud:** Ningún select de imputación muestra cuentas de sumatoria; cada uno filtra por el/los tipos correctos; no se rompen imports cross-module; documentado el impacto sobre datos previos.

#### Fase 5: Docs, guía de usuario y tests
- **Objetivo:** Documentar el nuevo comportamiento y cubrir con tests.
- **Tareas:**
  - [ ] Actualizar `docs/architecture/data-model.md` (campos nuevos de `Account`, semántica de `isLeaf`/imputable y `disabledFrom`).
  - [ ] Actualizar `docs/modules/accounting*.md` si aplica (reglas de imputación, deshabilitado por ejercicio, selects).
  - [ ] Actualizar la guía de usuario `src/modules/help/features/guide/components/_AccountingGuide.tsx`: qué es imputable vs sumatoria, cómo se ve el saldo/suma, cómo deshabilitar una cuenta y su efecto por ejercicio + cascada, formato de código.
  - [ ] Actualizar/crear specs Cypress afectados (plan de cuentas: crear con padre mismo-tipo, ver saldo/suma, deshabilitar con AlertDialog; selects de imputación filtrados). Ejecutar `npm run cy:run:accounting`.
- **Archivos:**
  - `docs/architecture/data-model.md`, `docs/modules/accounting*.md`.
  - `src/modules/help/features/guide/components/_AccountingGuide.tsx`.
  - `cypress/e2e/` (specs de accounting).
- **Criterio de completitud:** Docs y guía reflejan el comportamiento nuevo; specs Cypress pasan; checklist de commit de CLAUDE.md verde.

### 2.2 Orden de ejecución

Ejecución secuencial por dependencias:

1. **Fase 1 (Schema + migración)** — base para todo lo demás; sin `disabledFrom` y sin `isLeaf` consistente las reglas no funcionan.
2. **Fase 2 (Dominio server)** — depende de los campos y del backfill de Fase 1; provee las funciones (`disableAccount`, `getAccountRollupBalances`, validadores) que consumen las UIs.
3. **Fase 3 (UI accounts)** y **Fase 4 (Selects externos)** — ambas dependen de Fase 2 y son **independientes entre sí**, pueden hacerse en paralelo. Fase 4 depende de que `isLeaf` esté consistente (Fase 1) más que de la UI de Fase 3.
4. **Fase 5 (Docs/guía/tests)** — al final, una vez estabilizado el comportamiento de Fases 2–4 (algunos specs pueden escribirse antes, pero se validan al cierre).

### 2.3 Estimación de complejidad
- **Fase 1 (Schema + migración):** media — el ALTER es simple, pero el backfill de `code` (normalización + riesgo de colisión con `@@unique`) y de `isLeaf` requiere cuidado con datos reales.
- **Fase 2 (Dominio server):** alta — mantenimiento automático de `isLeaf` en 3 operaciones + transacciones, lógica de deshabilitar con saldo/ejercicio y cascada, roll-up de saldos. Núcleo de riesgo del ticket.
- **Fase 3 (UI accounts):** media/alta — varios componentes (form, árbol con nueva columna de saldo/suma, AlertDialog de deshabilitar) e import/export Excel; mantener < 200 líneas por componente.
- **Fase 4 (Selects externos):** media — mecánicamente repetitiva (7 fetches) y con restricción no-cross-module; el riesgo real es de datos previos asociados a sumatoria.
- **Fase 5 (Docs/guía/tests):** baja/media — sin lógica nueva; el esfuerzo está en cobertura Cypress.

### 2.4 Riesgos / decisiones abiertas para la etapa de Diseño
- **Firma exacta del corte de deshabilitado:** `disabledFrom DateTime?` solo, vs. `disabledFrom` + `disabledFromFiscalYearId` (relación a `FiscalYear`). Definir en Diseño cómo se resuelve "próximo ejercicio" y cómo interactúa con el `isActive` global existente.
- **Origen del "ejercicio en curso":** confirmar la fuente de verdad para `getCurrentFiscalYear(companyId)` (por fecha actual dentro de `FiscalYear.startDate/endDate`, o un flag de ejercicio activo) y su ubicación (accounting/shared).
- **Mecanismo compartido de Fase 4:** helper de filtro en `shared/` vs action por módulo — decidir para no violar no-imports-cross-module ni duplicar queries.
- **Normalización de `code` en la migración:** si el UPDATE SQL es viable o conviene un script de datos idempotente; manejo de colisiones de unicidad al rellenar segmentos con 0.
- **Semántica de saldo con corte por ejercicio:** el árbol muestra saldo "hasta hoy"; definir si el estado habilitado/deshabilitado se muestra respecto del ejercicio en curso o es seleccionable.

## 3. Diseño
_Pendiente - ejecutar `/disenar cuentas-imputables`_

## 4. Implementación
_Pendiente - ejecutar `/implementar cuentas-imputables`_

## 5. Verificación
_Pendiente - ejecutar `/verificar cuentas-imputables`_
