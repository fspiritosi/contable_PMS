# Cuentas Imputables / No imputables (Ticket #376)

**Fecha de inicio:** 2026-07-01
**Estado:** Implementación completada (5 de 5) — pendiente aplicar migración + normalización en la base y verificar

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
  - [x] Agregar a `Account` el campo de corte de deshabilitado: `disabledFrom DateTime?` (fecha de corte) + `disabledFromFiscalYearId String?` con relación opcional a `FiscalYear` (`AccountDisabledFrom`, `onDelete: SetNull`); `isActive` se mantiene como estado global vigente (backward compatible).
  - [x] Índice para consultas por corte: `@@index([companyId, disabledFromFiscalYearId])`.
  - [x] Confirmar que `isLeaf Boolean @default(true)` se mantiene (no se agrega campo nuevo de imputable — decisión 1.7.1).
  - [x] Crear migración no destructiva en `prisma/migrations/20260701120000_account_disable_by_fiscal_year/migration.sql`:
    - `ALTER TABLE ... ADD COLUMN` para los campos nuevos (nullable) + FK + índice.
    - **Backfill `isLeaf`:** `UPDATE "accounts" a SET "is_leaf" = NOT EXISTS (SELECT 1 FROM "accounts" c WHERE c."parent_id" = a."id")`.
    - **Normalización de `code`:** movida a un script de datos idempotente (`prisma/scripts/normalize-account-codes.ts`) que detecta y reporta colisiones de unicidad sin abortar (decisión 3.2). NO se hace en SQL puro.
  - [x] `npm run db:generate` (client regenerado sin errores). `npm run db:migrate` NO ejecutado — pendiente de correr por el usuario.
- **Archivos:**
  - `prisma/schema.prisma` (modelo `Account`, ~línea 294).
  - `prisma/migrations/<nueva>/migration.sql`.
- **Criterio de completitud:** Migración corre limpia sobre una copia con datos reales; `isLeaf` refleja la jerarquía existente; todos los `code` cumplen `x.x.x/xx/xx`; no hay violación de `@@unique(companyId, code)`; `prisma generate` sin errores.

#### Fase 2: Validaciones y reglas de dominio (server)
- **Objetivo:** Centralizar en el módulo accounting las reglas de negocio: mantener `isLeaf` automático, validar padre mismo-tipo, validar/normalizar `code`, deshabilitar por saldo/ejercicio con cascada, y roll-up de saldos de sumatoria.
- **Tareas:**
  - [x] `validateAccountCodeFormat(code)`: normaliza a `x.x.x/xx/xx` (segmentos vacíos → 0, primer segmento ≠ 0) y devuelve el code normalizado; usar en create/update e import. (Util de Fase 1 en `shared/utils/account-code.ts`, integrado en Fase 2.)
  - [x] Extender validación de padre mismo-tipo: nuevo `validateAccountParentSameType(companyId, parentId, childType, selfId?)` (exige `parent.type === childType`, evita ciclo trivial), sin modificar `validateAccountParent` existente. Ambos se invocan en create/update.
  - [x] Mantenimiento de `isLeaf`:
    - En `createAccount`: la cuenta nueva nace `isLeaf=true`; si tiene `parentId`, poner `parent.isLeaf=false` (transacción).
    - En `updateAccount`: si cambia `parentId`, recomputar `isLeaf` del padre anterior (COUNT de hijas → true si 0) y del nuevo (false).
    - En `deleteAccount`: al soft-borrar, recomputar `isLeaf` del padre (COUNT de hijas → true si 0). Se mantiene el bloqueo de borrado con movimientos/hijas.
  - [x] `disableAccount(companyId, accountId)` (nueva action):
    - Obtiene ejercicio en curso vía `getCurrentFiscalYear(companyId)` (`shared/utils/fiscal-year.ts`).
    - Calcula saldo con `getAccountRollupBalances` (roll-up cubre hojas y sumatorias): saldo 0 → corte en **ejercicio actual**; saldo ≠ 0 → corte en **próximo ejercicio** (`getNextFiscalYear`).
    - Setea `disabledFrom` / `disabledFromFiscalYearId` en consecuencia.
    - **Cascada:** aplica la misma regla, evaluada por cada cuenta según su propio saldo, a todo el subárbol dentro de una `$transaction`.
    - `checkPermission('accounting.accounts', 'update')`; `logger`; devuelve `DisableAccountResult` con Decimal→Number.
  - [x] `getAccountRollupBalances(companyId, upToDate?)` en `shared/utils/balances.ts`: sobre `calculateAllAccountBalances` + jerarquía (parent map), DFS post-orden con memo suma los saldos de las hojas descendientes. Devuelve `Map<accountId, {debit, credit, balance}>` (number) cubriendo hojas y padres.
  - [x] Helper `isAccountEnabled(account, fiscalYearStart)` en `shared/utils/index.ts` (deriva estado vigente por `isActive` + `disabledFrom`).
  - [x] Filtro compartido `buildImputableAccountsWhere` en `src/shared/lib/accounts/imputable-accounts.ts` (puro) + action `getImputableAccounts(companyId, types?)` en accounts. (Adelanto para Fase 3/4; `getAccounts` se mantiene sin cambios.)
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

> Diseño basado en las **Decisiones tomadas (1.7)**: imputable = `isLeaf` (mantenido automático), selects de imputación = solo hojas + filtro por `type`, deshabilitar = campo de corte por ejercicio, `code` String validado/normalizado a `x.x.x/xx/xx`.
>
> **Hallazgos de exploración (confirmados en código real):**
> - `Account` (schema:294) ya tiene `isLeaf Boolean @default(true) @map("is_leaf")` (:307) e `isActive` (:306). `@@unique([companyId, code])` (:360). NO existe columna de corte por ejercicio.
> - `FiscalYear` (schema:660) tiene `startDate`, `endDate`, `isClosed`, `@@unique([companyId, number])`. No hay flag "ejercicio activo": el ejercicio en curso se deriva por fecha (`startDate <= X <= endDate`).
> - **NO existe un helper compartido `getCurrentFiscalYear(companyId)`.** Existe un `getCurrentFiscalYear(fiscalYearStart: Date): number` local en `budgets/actions.server.ts:33` (calcula el *número* de ejercicio, no el registro) — no reutilizable. El patrón real de "ejercicio del período en curso" está en `fiscal-year-close/actions.server.ts:62` y `entries/validators/index.ts:181` (`prisma.fiscalYear.findFirst` por rango de fechas). ⇒ Hay que **crear** el helper.
> - `createAccount`/`updateAccount`/`deleteAccount` (actions.server.ts) **no tocan `isLeaf`**, no validan tipo del padre ni formato de code. `validateAccountParent` (validators:25) solo valida existencia/empresa.
> - `calculateAllAccountBalances` (balances.ts:64) devuelve `Map<accountId,{debit,credit,balance}>` solo para cuentas con líneas (imputables). No hay roll-up de sumatoria.
> - Formularios usan **RHF + zodResolver** (`accountSchema` en types/index.ts:5). `_AccountsTable.tsx` es una tabla recursiva manual (no `DataTable`), con columnas Código/Nombre/Tipo/Naturaleza/Acciones.
> - Los selects externos: `getAccountsForProductSelect` (`commercial/.../products/shared/catalog-actions.server.ts`) **ya filtra `isLeaf: true`**. `getAccountsForBankMovement` (`commercial/features/treasury/features/bank-movements/actions.server.ts:496`) trae todo (`isActive`). **treasury vive anidado dentro de `commercial/`**, no es módulo top-level; igual está fuera de `accounting/`, aplica la regla no-cross-module.

### 3.1 Arquitectura de la solución

Flujo por capas (de datos a UI):

```
┌── SCHEMA (prisma) ──────────────────────────────────────────────┐
│ Account: + disabledFromFiscalYearId (FK FiscalYear) + disabledFrom (DateTime?) │
│          isLeaf (ya existe, ahora mantenido automáticamente)     │
│ Migración no destructiva: ADD COLUMN + backfill isLeaf + normalización code │
└─────────────────────────────────────────────────────────────────┘
                              │
┌── DOMINIO (accounting/shared) ──────────────────────────────────┐
│ validators: validateAccountCodeFormat (normaliza), validateAccountParentSameType │
│ utils/fiscal-year.ts: getCurrentFiscalYear(companyId)  ← NUEVO   │
│ utils/balances.ts: getAccountRollupBalances (roll-up sumatoria)  │
│ utils/index.ts: isAccountEnabled(account, fiscalYear)            │
└─────────────────────────────────────────────────────────────────┘
                              │
┌── ACTIONS (accounting/features/accounts) ──────────────────────┐
│ createAccount/updateAccount/deleteAccount → mantienen isLeaf (tx)│
│ disableAccount(companyId, accountId) → corte por saldo/ejercicio + cascada │
│ getAccountsTree(companyId) → árbol + saldos (Number) + estado    │
└─────────────────────────────────────────────────────────────────┘
                    │                              │
┌── UI accounts ────────────────┐   ┌── SELECTS EXTERNOS ─────────┐
│ _CreateAccountModal (padre    │   │ shared/lib/imputable-accounts│
│  filtrado por type, indicador │   │  → buildImputableAccountsWhere│
│  imputable derivado, code)    │   │ Cada action externa usa el    │
│ _AccountsTable (col Saldo/Suma│   │  where compartido: isLeaf:true│
│  + badge estado)              │   │  + isActive + type:{in}       │
│ _DisableAccountDialog (Alert) │   │ (products, bank-mov, settings,│
└───────────────────────────────┘   │  entries, budgets, opening)   │
                                     └──────────────────────────────┘
```

**Fujo de datos de saldos:** `getAccountsTree` → `calculateAllAccountBalances` (saldos de hojas) + `buildAccountTree` → `getAccountRollupBalances` suma en memoria los descendientes hoja de cada sumatoria → se serializan a `Number` → alimentan la columna Saldo/Suma del árbol.

**Flujo de deshabilitado:** `disableAccount` → `getCurrentFiscalYear` (ejercicio en curso por fecha) → saldo (roll-up si sumatoria) → si `balance == 0` corta en el ejercicio actual, si no en el próximo (`FiscalYear` con `number+1` o `startDate` siguiente) → setea `disabledFrom*` en la cuenta y **en cascada** en todo el subárbol, dentro de una transacción.

### 3.2 Modelos de datos

**Diff del modelo `Account`** (agregar tras `isActive`/`isLeaf`, ~línea 307):

```prisma
model Account {
  // ... campos existentes ...
  isActive              Boolean            @default(true) @map("is_active")
  isLeaf                Boolean            @default(true) @map("is_leaf")   // = imputable (hoja). Mantenido automático.

  // NUEVO: corte de deshabilitado por ejercicio
  disabledFrom            DateTime?  @map("disabled_from")                  // fecha efectiva del corte (= startDate del ejercicio de corte)
  disabledFromFiscalYearId String?   @map("disabled_from_fiscal_year_id") @db.Uuid
  disabledFromFiscalYear   FiscalYear? @relation("AccountDisabledFrom", fields: [disabledFromFiscalYearId], references: [id])
  // ... resto ...

  @@index([companyId, disabledFromFiscalYearId])
  @@unique([companyId, code])
  @@map("accounts")
}
```

Y en `FiscalYear` la relación inversa:

```prisma
model FiscalYear {
  // ...
  disabledAccounts Account[] @relation("AccountDisabledFrom")
}
```

**Decisión de firma del corte (resuelta):** se usan **ambos** campos.
- `disabledFromFiscalYearId` es la **fuente de verdad semántica**: "deshabilitada a partir de este ejercicio". Clara, robusta ante renumeración de ejercicios y permite unir con `FiscalYear` para mostrar "deshabilitada desde el ejercicio N".
- `disabledFrom` (DateTime, = `startDate` del ejercicio de corte) es **denormalización de conveniencia** para poder comparar por fecha sin un JOIN en queries de listado/reportes y para robustez si el ejercicio se borrara. Ambos se setean juntos.
- Se descarta `disabledFrom DateTime?` **solo**: perdería la referencia explícita al ejercicio (requisito habla de "ejercicio", no de fecha) y complicaría el texto de UI ("desde el ejercicio N").

**Convivencia con `isActive` (semántica definida):**
- `isActive = false` → **deshabilitación global / soft-delete inmediato** (comportamiento actual de `deleteAccount`), independiente del ejercicio. Se mantiene para no romper `deleteAccount` ni los filtros `isActive: true` existentes.
- `disabledFrom*` → **deshabilitación programada por ejercicio**. La cuenta sigue `isActive: true` pero deja de estar vigente a partir del ejercicio de corte.
- Una cuenta está **vigente en el ejercicio `FY`** si: `isActive == true` **Y** (`disabledFromFiscalYearId == null` **O** `FY.startDate < disabledFrom`). Es decir: sin corte, o el ejercicio consultado es anterior al de corte.

**SQL de migración conceptual** (`prisma/migrations/<ts>_account_disabled_from_and_backfill/migration.sql`, no destructiva):

```sql
-- 1) Columnas nuevas (nullable, sin default destructivo)
ALTER TABLE "accounts" ADD COLUMN "disabled_from" TIMESTAMP(3);
ALTER TABLE "accounts" ADD COLUMN "disabled_from_fiscal_year_id" UUID;
ALTER TABLE "accounts"
  ADD CONSTRAINT "accounts_disabled_from_fiscal_year_id_fkey"
  FOREIGN KEY ("disabled_from_fiscal_year_id") REFERENCES "fiscal_years"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "accounts_company_id_disabled_from_fiscal_year_id_idx"
  ON "accounts"("company_id", "disabled_from_fiscal_year_id");

-- 2) Backfill isLeaf según jerarquía real (una cuenta es hoja si NO es padre de nadie)
UPDATE "accounts" a
SET "is_leaf" = NOT EXISTS (
  SELECT 1 FROM "accounts" c WHERE c."parent_id" = a."id"
);

-- 3) Normalización de code → x.x.x/xx/xx  (ver decisión abajo)
--    Se ejecuta en script de datos idempotente (Node/Prisma), NO en SQL puro.
```

**Decisión sobre normalización de `code` (resuelta): script de datos idempotente, NO UPDATE SQL.**
Motivos: la regla (rellenar segmentos vacíos con 0, primer segmento ≠ 0, dar forma `x.x.x/xx/xx`) es difícil de expresar de forma determinística y segura en SQL puro, y **el mayor riesgo es la colisión con `@@unique(companyId, code)`** (dos códigos distintos podrían normalizar al mismo string). El enfoque de menor riesgo:
1. Script `prisma/scripts/normalize-account-codes.ts` (idempotente): lee todas las cuentas por empresa, aplica `validateAccountCodeFormat(code)` en memoria, agrupa por `(companyId, normalizado)`.
2. **Si detecta colisión**, NO reescribe: **loguea el conflicto** (companyId, ids, codes) y deja esos códigos **sin normalizar** (siguen válidos por unicidad), para resolución manual. El resto se normaliza.
3. Se corre post-migración (documentado en el README de la migración). Es re-ejecutable sin efectos.
Alternativa descartada: forzar normalización en el ALTER podría abortar toda la migración por un `unique_violation`.

### 3.3 Funciones y métodos

**a) Helper de ejercicio en curso** — archivo NUEVO `src/modules/accounting/shared/utils/fiscal-year.ts`:

```typescript
export interface CurrentFiscalYear {
  id: string;
  number: number;
  startDate: Date;
  endDate: Date;
  isClosed: boolean;
}

/** Ejercicio "en curso" = aquel cuyo rango [startDate, endDate] contiene la fecha dada (hoy por defecto).
 *  Fallback a AccountingSettings.fiscalYearStart/End si no hay registro FiscalYear (patrón de entries/validators). */
export async function getCurrentFiscalYear(
  companyId: string,
  atDate?: Date
): Promise<CurrentFiscalYear | null>;

/** Próximo ejercicio respecto de uno dado: por number+1, con fallback a startDate > current.endDate. */
export async function getNextFiscalYear(
  companyId: string,
  currentFiscalYearId: string
): Promise<CurrentFiscalYear | null>;
```

**b) Validadores** — `src/modules/accounting/shared/validators/index.ts`:

```typescript
/** Normaliza y valida el formato x.x.x/xx/xx. Rellena segmentos vacíos con 0,
 *  exige primer segmento ≠ 0. Devuelve el code normalizado (para persistir).
 *  Pura y síncrona (usable en migración, form e import). */
export function validateAccountCodeFormat(code: string): string;

/** Extiende la validación de padre: existencia + empresa (ya existe) + mismo type + sin ciclo. */
export async function validateAccountParentSameType(
  companyId: string,
  parentId: string | undefined,
  childType: AccountType,
  selfAccountId?: string   // para editar: evitar que sea su propio padre / ciclo
): Promise<void>;
```

`validateAccountCodeFormat` — reglas de normalización: separar por `/` (máx 3 grupos: `x.x.x`, `xx`, `xx`), dentro del primer grupo separar por `.` (3 segmentos). Segmentos ausentes/vacíos → `0`. Validar que **todos sean numéricos** y **el primer segmento del primer grupo ≠ 0** (regla 1.7.4). Recomponer canónico `A.B.C/DD/EE`. Lanza `Error` si el primer segmento es 0 o hay no-numéricos.

**c) Mantenimiento de `isLeaf`** — `actions.server.ts`, dentro de transacción:

```typescript
// createAccount: la nueva nace isLeaf=true; si parentId, marcar parent.isLeaf=false
await prisma.$transaction(async (tx) => {
  const account = await tx.account.create({ data: { ...input, code: normalizedCode, isLeaf: true } });
  if (input.parentId) await tx.account.update({ where: { id: input.parentId }, data: { isLeaf: false } });
  return account;
});

// updateAccount: si cambia parentId → recomputar isLeaf del padre anterior y del nuevo
async function recomputeIsLeaf(tx, parentId: string) {
  const childCount = await tx.account.count({ where: { parentId } });
  await tx.account.update({ where: { id: parentId }, data: { isLeaf: childCount === 0 } });
}

// deleteAccount (soft): tras marcar isActive=false, si tenía parentId y al padre no le quedan
//   hijos activos → parent.isLeaf=true (recomputeIsLeaf considerando isActive).
```

**d) Deshabilitar por saldo/ejercicio con cascada** — `actions.server.ts`:

```typescript
export interface DisableAccountResult {
  accountId: string;
  cutoffFiscalYearId: string;
  cutoffFiscalYearNumber: number;
  cutoffFrom: Date;          // startDate del ejercicio de corte
  affectedAccountIds: string[]; // subárbol afectado (cascada)
  reason: 'ZERO_BALANCE_CURRENT' | 'NONZERO_BALANCE_NEXT';
}

/** Deshabilita una cuenta (y su subárbol) programando el corte por ejercicio.
 *  Regla: saldo (roll-up) == 0 → corte en ejercicio ACTUAL; != 0 → corte en PRÓXIMO ejercicio.
 *  La cascada aplica la MISMA regla evaluada por cada cuenta hija (cada una según su propio saldo). */
export async function disableAccount(
  companyId: string,
  accountId: string
): Promise<DisableAccountResult>;
```

Detalle: `checkPermission('accounting.accounts','update',{redirect:true})`; obtiene `getCurrentFiscalYear`; calcula `getAccountRollupBalances` una vez para toda la empresa; recorre el subárbol (BFS/DFS con `buildAccountTree`); para cada cuenta decide corte actual vs próximo según **su** saldo; setea `disabledFrom`+`disabledFromFiscalYearId` en una única `prisma.$transaction`. `logger.info` con el resumen. Todo `Decimal → Number` en saldos. (Se prevé también `enableAccount(companyId, accountId)` que limpia `disabledFrom*` — cascada opcional; se documenta como acción inversa mínima.)

**e) Roll-up de saldos** — `src/modules/accounting/shared/utils/balances.ts`:

```typescript
/** Saldos por cuenta cubriendo hojas Y sumatorias: para cada sumatoria suma
 *  (en memoria) los balances de sus hojas descendientes. Reusa calculateAllAccountBalances + buildAccountTree.
 *  upToDate por defecto = hoy; para el árbol usar endDate del ejercicio en curso (ver 3.7). */
export async function getAccountRollupBalances(
  companyId: string,
  upToDate?: Date
): Promise<Map<string, { debit: number; credit: number; balance: number }>>;
```

Implementación: 1) `calculateAllAccountBalances` (hojas). 2) `buildAccountTree` sobre todas las cuentas. 3) DFS post-orden: `balance(nodo) = balanceHoja(nodo) ?? Σ balance(hijos)`; acumular debit/credit igual. Devuelve todo en `number`.

**f) Estado vigente** — `src/modules/accounting/shared/utils/index.ts`:

```typescript
/** True si la cuenta está vigente en el ejercicio dado (o hoy si se pasa fecha). */
export function isAccountEnabled(
  account: Pick<Account, 'isActive' | 'disabledFrom'>,
  fiscalYearStart: Date   // startDate del ejercicio consultado
): boolean;
// return account.isActive && (!account.disabledFrom || fiscalYearStart < account.disabledFrom);
```

**g) Árbol con saldos para la tabla** — `actions.server.ts` (nueva o extendida):

```typescript
export interface AccountTreeNode extends AccountWithChildren {
  isLeaf: boolean;
  balance: number;         // saldo (hoja) o suma de hijas (sumatoria) — Number
  enabled: boolean;        // isAccountEnabled respecto al ejercicio en curso
  disabledFromFiscalYearNumber: number | null;
}

/** Provee el árbol completo con saldos (Number) y estado vigente para _AccountsTable. */
export async function getAccountsTree(companyId: string): Promise<AccountTreeNode[]>;
```

**h) Filtro compartido de imputables** — archivo NUEVO `src/shared/lib/accounts/imputable-accounts.ts`:

```typescript
import type { AccountType } from '@/generated/prisma/enums';
import type { Prisma } from '@/generated/prisma/client';

/** Construye el `where` de Prisma para cuentas imputables (hojas activas y vigentes),
 *  opcionalmente restringido a ciertos types. Función PURA: no toca prisma ni permisos.
 *  Cada action de cada módulo la usa dentro de su propia query → sin imports cross-module. */
export function buildImputableAccountsWhere(params: {
  companyId: string;
  types?: AccountType[];
  atDate?: Date;   // por defecto hoy: excluye cuentas con corte ya efectivo
}): Prisma.AccountWhereInput;
// { companyId, isActive: true, isLeaf: true,
//   ...(types && { type: { in: types } }),
//   OR: [ { disabledFrom: null }, { disabledFrom: { gt: atDate ?? new Date() } } ] }
```

**Decisión sobre ubicación del helper (resuelta): función util pura en `src/shared/`.**
Justificación: los consumidores viven fuera de `accounting/` (`commercial/.../products`, `commercial/.../treasury`, y dentro de accounting settings/entries/budgets). Una **Server Action replicada por módulo** duplicaría 5-6 veces la misma query y el criterio se desincronizaría. Un helper **puro que solo arma el `where`** (no ejecuta Prisma, no requiere permisos) es la mínima superficie compartida: cada módulo conserva su propia action (con su `checkPermission` y su `select`) pero comparte el criterio. Cumple no-cross-module (nadie importa de `accounting/`) y evita duplicación. Se descarta poner una action ejecutora en shared/ porque mezclaría permisos de módulos distintos.

### 3.4 Interfaces de usuario

**`_CreateAccountModal.tsx` / `_EditAccountModal.tsx`:**
- **Selector de padre filtrado por `type`**: al elegir/tener un `type`, el `<Select>` de padre solo lista cuentas del **mismo `type`** (filtrar `accounts` en cliente por `account.type === form.watch('type')`). El fetch actual (`getAccounts`) debe traer `type` (hoy solo trae `id,code,name` implícitamente vía tipado del state — ampliar el `select`). Deshabilitar el select de padre hasta que haya `type` elegido.
- **Indicador imputable/sumatoria derivado**: badge de solo lectura "Imputable (hoja)" vs "Sumatoria (agrupa)". Se **deriva**: en creación siempre nace imputable; en edición, `sumatoria` si `account.children.length > 0`. NO es un campo editable (decisión 1.7.1).
- **Campo `code` con validación de formato**: `accountSchema.code` pasa a validar el patrón `x.x.x/xx/xx` con `superRefine` que reutiliza `validateAccountCodeFormat` (o un regex equivalente en Zod) y muestra el formato normalizado como ayuda (placeholder `1.1.1/00/00`). La normalización final ocurre en el server action antes de persistir.
- Estados clave: `type` (dispara filtrado de padre + nature auto), `parentId`, `code`.

**`_AccountsTable.tsx`:**
- Consume `AccountTreeNode[]` (de `getAccountsTree`). Nueva columna **"Saldo / Suma"** (alineada a la derecha, `formatAmount`): para hojas muestra el saldo; para sumatoria la suma de hijas. Encabezado con `meta.title` "Saldo / Suma de hijas".
- Nueva columna/indicador **Estado**: badge "Vigente" (verde) si `enabled`; "Deshabilitada desde ej. N" (gris/ámbar) si tiene corte. Reutiliza la clase `opacity-50` existente para `!isActive`.
- Menú de acciones: agregar ítem **"Deshabilitar"** (icono `Ban`/`PowerOff`) gateado por `hasPermission('accounting.accounts','update')`, que abre `_DisableAccountDialog`. Mantener Editar/Eliminar existentes.
- Mantener < 200 líneas: extraer el badge de estado a un subcomponente `_AccountStatusBadge.tsx` si crece.

**`_DisableAccountDialog.tsx` (NUEVO):** usa `AlertDialog` (NUNCA confirm).
- Props: `{ account: AccountTreeNode; companyId: string; onClose: () => void }`.
- Al abrir, muestra un **preview** del efecto: llama a un action ligero (o usa datos ya en `AccountTreeNode`: `balance`, subárbol) para explicar:
  - Si saldo 0 → "Se deshabilitará a partir del **ejercicio actual** (N)".
  - Si saldo ≠ 0 → "Tiene saldo; se deshabilitará a partir del **próximo ejercicio** (N+1)".
  - Si tiene hijas → advertir "**En cascada** se deshabilitarán también sus M subcuentas, cada una según su propio saldo".
- `AlertDialogAction` → llama `disableAccount(companyId, account.id)`, `toast` con resultado, `router.refresh()`.
- Estados: `isLoading`, resultado del preview.

### 3.5 Rutas y navegación

**Sin rutas nuevas.** Todo ocurre dentro de `/dashboard/company/accounting/accounts` (page + `_AccountsTable` + modales/diálogos). Los selects externos viven en sus rutas actuales. Confirmado: no se agregan `page.tsx`/segmentos nuevos; la page existente ya está protegida por `PermissionGuard('accounting.accounts')`.

### 3.6 Selects externos

Todos pasan a usar `buildImputableAccountsWhere` dentro de su propia query (cada uno conserva su `checkPermission` y `select`). Filtro base: `isActive: true, isLeaf: true` + `type:{in}` según contexto + exclusión de cortes vigentes.

| Ubicación | Archivo | `types` a pasar | Cambio |
|---|---|---|---|
| Artículos Gasto/Ingreso | `commercial/.../products/shared/catalog-actions.server.ts` | `[EXPENSE, REVENUE]` (o sin restricción + filtro cliente por nature ya existente) | Ya usa `isLeaf`; adoptar el where compartido + exclusión de cortes |
| Mov. Bancario (contrapartida) | `commercial/features/treasury/features/bank-movements/actions.server.ts:496` | `[ASSET, LIABILITY, EQUITY]` (patrimoniales, excluye Resultado) | **Agregar `isLeaf:true` + filtro de type** (hoy trae todo) |
| Líneas de Asiento | `accounting/features/accounts/actions.server.ts:getAccounts` (o variante `getImputableAccounts`) | sin restricción de type (cualquier hoja) | Agregar `isLeaf:true`; crear variante para no romper el `getAccounts` usado por el form de padres |
| Config Contable (18+ campos) | `accounting/features/settings/actions.server.ts:getActiveAccounts:188` | el `type` del campo (filtro cliente hoy) | Agregar `isLeaf:true`; idealmente parametrizar `types` por campo |
| Saldos de apertura | `accounting/features/opening-balances/actions.server.ts:~50` | hojas (todas) | Agregar `isLeaf:true` |
| Presupuestos | `accounting/features/budgets/actions.server.ts:getBudgetableAccounts:~414` | `[EXPENSE, REVENUE]` + hojas | Ya excluye sumatoria vía `children none`; **alinear** a `isLeaf:true` (criterio único) |
| Cuenta bancaria vinculada | `commercial/features/treasury/features/bank-accounts/list/actions.server.ts:getAvailableAccounts` | `[ASSET]` | Agregar `isLeaf:true` |

**Nota crítica sobre `getAccounts` (accounts):** hoy alimenta el **selector de padre** del form (donde SÍ se necesitan cuentas de sumatoria) y potencialmente líneas de asiento. NO agregarle `isLeaf` directamente. Crear una acción separada `getImputableAccounts(companyId, types?)` para imputación y dejar `getAccounts` para el árbol/selector de padre.

**Sin romper datos existentes:** antes de restringir, ejecutar un reporte (script/consulta) que liste registros ya asociados a cuentas de sumatoria (asientos, config, mov. bancarios, presupuestos). El filtro solo afecta la **lista de opciones nuevas**; los valores ya guardados se siguen mostrando (el `<Select>` muestra el valor persistido aunque no esté en las opciones, o se agrega el valor actual a la lista si falta). Documentar el impacto (riesgo 1.6.6).

### 3.7 Consideraciones técnicas

- **Decimal → Number:** `getAccountsTree`, `getAccountRollupBalances`, `disableAccount` retornan saldos ya como `number` (las utils de balances ya hacen `Number()`; el roll-up opera sobre `number`). Ningún `Decimal` cruza a Client Components.
- **Permisos:** `disableAccount`, `getAccountsTree`, `getImputableAccounts` → `checkPermission('accounting.accounts', 'view'|'update')` con `redirect`. Selects externos conservan su propio permiso (`commercial.*`, `accounting.settings`, etc.). En cliente: `usePermissions` para el ítem "Deshabilitar"; `PermissionGuard` en la page (ya existe).
- **Transacciones Prisma:** mantenimiento de `isLeaf` (create/update/delete) y `disableAccount` (cascada) SIEMPRE dentro de `prisma.$transaction` para no dejar la jerarquía o el corte en estado parcial.
- **Migración de datos:** ALTER no destructivo; backfill `isLeaf` por SQL; normalización de `code` por **script idempotente con manejo de colisiones** (no aborta la migración). Documentar en el README de la carpeta de migración que el script debe correrse post-`db:migrate`.
- **Import/Export Excel** (`accounting/.../lib/import-export.server.ts`): aplicar `validateAccountCodeFormat`, mantenimiento de `isLeaf` (marcar padre como no-hoja) y `validateAccountParentSameType` en la importación — es la otra vía de alta y debe respetar las mismas reglas o queda un bypass.
- **Fecha de saldo en el árbol (decisión resuelta):** el árbol muestra saldo **hasta el `endDate` del ejercicio en curso** (`getCurrentFiscalYear().endDate`) como `upToDate`, NO "hasta hoy". Motivo: es la lectura contable natural (saldo del ejercicio en curso) y evita incluir asientos de ejercicios futuros. Si no hay ejercicio en curso, fallback a `new Date()` (hoy). El estado vigente/deshabilitado se muestra respecto del ejercicio en curso (no seleccionable en esta iteración; se puede agregar un selector de ejercicio más adelante).
- **Riesgos residuales para implementación:**
  1. **Colisiones de `code` al normalizar**: pueden quedar cuentas sin normalizar; el form nuevo exigirá formato válido, generando asimetría temporal (datos viejos no-canónicos conviviendo). Mitigar con el reporte de colisiones y resolución manual.
  2. **`getAccounts` compartido**: cambiar su filtro rompería el selector de padre; hay que separar la acción de imputación (ver 3.6).
  3. **Costo del roll-up** en planes de cuentas grandes: `getAccountRollupBalances` hace 1 query + suma en memoria O(n); aceptable, pero si el árbol crece mucho considerar caché o materializar. 
  4. **"Ejercicio en curso" ambiguo** si hay solapamiento o falta de `FiscalYear`: el helper usa fallback a `AccountingSettings` (patrón existente); si tampoco existe, `disableAccount` debe fallar con mensaje claro ("configure el ejercicio fiscal").
  5. **Cascada de deshabilitado**: al deshabilitar un padre con hijas de distinto saldo, cada hija corta en ejercicio distinto (actual vs próximo). El diálogo debe comunicarlo para no sorprender al usuario.
  6. **Selects externos con valores ya guardados en sumatoria**: garantizar que el valor persistido siga visible aunque el filtro lo excluya de las opciones nuevas.

## 4. Implementación

### Fase 1: Schema + migración — **Estado: Completada** (2026-07-01)

**Archivos creados/modificados:**
- `prisma/schema.prisma` — modelo `Account`: agregados `disabledFrom DateTime?`, `disabledFromFiscalYearId String? @db.Uuid` y la relación `disabledFromFiscalYear FiscalYear? @relation("AccountDisabledFrom", ..., onDelete: SetNull)`; nuevo `@@index([companyId, disabledFromFiscalYearId])`. Modelo `FiscalYear`: relación inversa `disabledAccounts Account[] @relation("AccountDisabledFrom")`. (`isLeaf` ya existía; no se duplicó.)
- `prisma/migrations/20260701120000_account_disable_by_fiscal_year/migration.sql` — migración NO destructiva: `ADD COLUMN disabled_from` + `disabled_from_fiscal_year_id`, FK a `fiscal_years` (`ON DELETE SET NULL ON UPDATE CASCADE`), índice `accounts_company_id_disabled_from_fiscal_year_id_idx`, y backfill de `is_leaf` (`NOT EXISTS` sobre hijos).
- `src/modules/accounting/shared/utils/account-code.ts` — **NUEVO** util puro `validateAccountCodeFormat(code)` + `AccountCodeFormatError`. Normaliza al formato canónico `x.x.x/xx/xx` (segmentos vacíos → 0, primer segmento ≠ 0, todos numéricos). Pensado para reutilizarse en runtime (form/import) en Fase 2/3, para que script y runtime coincidan.
- `prisma/scripts/normalize-account-codes.ts` — **NUEVO** script idempotente de datos. Recorre cuentas por empresa, normaliza `code` con el util compartido, detecta colisiones con `@@unique(companyId, code)` (loguea el conflicto y NO reescribe ese registro, sin abortar). Se corre con `npx tsx prisma/scripts/normalize-account-codes.ts` POST-migración.

**Notas / decisiones:**
- Firma del corte de deshabilitado: se usan **ambos** campos (`disabledFromFiscalYearId` como fuente de verdad semántica + `disabledFrom` denormalizado por conveniencia), según diseño 3.2. `isActive` se mantiene como estado global/soft-delete (sin cambios de comportamiento).
- Normalización de `code`: se resolvió por **script idempotente**, NO por `UPDATE` SQL, para no arriesgar `unique_violation` que abortaría la migración (diseño 3.2).
- `db:generate` regeneró el Prisma Client 7.3.0 sin errores. `check-types` no reporta ningún error en los archivos nuevos (los errores existentes de `check-types` son preexistentes y ajenos a este ticket).

> **⚠️ NO APLICADO A LA BASE.** La migración `20260701120000_account_disable_by_fiscal_year` y el script `normalize-account-codes.ts` **NO fueron ejecutados contra PostgreSQL**. Solo se corrió `prisma generate` (no toca la base). Pendiente de correr por el usuario tras revisión:
> 1. Aplicar la migración: `npm run db:migrate` (o `prisma migrate deploy` en su entorno).
> 2. Correr la normalización de códigos: `npx tsx prisma/scripts/normalize-account-codes.ts` y revisar el reporte de colisiones/inválidos.

### Fase 2: Validaciones y reglas de dominio (server) — **Estado: Completada** (2026-07-01)

**Archivos creados:**
- `src/modules/accounting/shared/utils/fiscal-year.ts` — **NUEVO**. `getCurrentFiscalYear(companyId, atDate?)` (ejercicio cuyo rango contiene la fecha, preferido no cerrado; fallback a `AccountingSettings.fiscalYearStart/End`; `null` con `logger.warn` si no hay). `getNextFiscalYear(companyId, currentFY?)` (por `number+1`, fallback al inmediato posterior por `startDate`). Interfaz plana serializable `CurrentFiscalYear` (fechas `Date`, sin Decimals; `number/id` nullable para el caso fallback).
- `src/shared/lib/accounts/imputable-accounts.ts` — **NUEVO**. `buildImputableAccountsWhere({ companyId, types?, atDate? })` puro → `Prisma.AccountWhereInput` (`isActive:true, isLeaf:true`, `type:{in}` opcional, exclusión de cortes ya vigentes vía `OR[disabledFrom null | > atDate]`). Exporta `BuildImputableAccountsWhereOptions`. No ejecuta Prisma ni permisos → sin imports cross-module.

**Archivos modificados:**
- `src/modules/accounting/features/accounts/actions.server.ts`:
  - `createAccount`: normaliza `code` con `validateAccountCodeFormat`, valida padre mismo-tipo (`validateAccountParentSameType`), y en `$transaction` crea la cuenta `isLeaf:true` y marca `parent.isLeaf=false`.
  - `updateAccount`: normaliza `code` si cambia; valida padre mismo-tipo con el tipo efectivo (`input.type ?? account.type`); en `$transaction` actualiza y, si cambió `parentId`, recomputa `isLeaf` del padre anterior (COUNT) y del nuevo.
  - `deleteAccount`: soft-delete + `recomputeIsLeaf` del padre en `$transaction`.
  - `getImputableAccounts(companyId, types?)` — **NUEVA**. Usa `buildImputableAccountsWhere`, `checkPermission('view')`, `select` acotado (`id, code, name, type, nature`).
  - `disableAccount(companyId, accountId)` — **NUEVA**. `checkPermission('update')`; obtiene ejercicio en curso; recorre subárbol (parent map + DFS); calcula `getAccountRollupBalances`; por cada cuenta corta en ejercicio actual (saldo ~0) o próximo (con saldo, error claro si no existe el próximo); todo en `$transaction`; devuelve `DisableAccountResult` (Decimals→Number).
  - Helpers privados `normalizeAccountCode` (traduce `AccountCodeFormatError` a `Error`) y `recomputeIsLeaf(tx, parentId)`.
- `src/modules/accounting/shared/validators/index.ts` — nuevo `validateAccountParentSameType`. Se mantiene `validateAccountParent` y `validateAccountNature`.
- `src/modules/accounting/shared/utils/balances.ts` — nueva `getAccountRollupBalances` (DFS post-orden con memo sobre parent map, sin usar `buildAccountTree` para evitar ciclo de import con `index.ts`).
- `src/modules/accounting/shared/utils/index.ts` — nueva `isAccountEnabled(account, fiscalYearStart)` + re-export de `getAccountRollupBalances`.
- `src/modules/accounting/features/accounts/lib/import-export.server.ts` — el import Excel normaliza `code` y `parentCode` con `validateAccountCodeFormat` (reporta la fila si falla), valida padre mismo-tipo, crea cuentas `isLeaf:true` y marca padres `isLeaf=false`.

**Notas / decisiones / desvíos:**
- **Firma de `getNextFiscalYear`**: el diseño 3.3 proponía `(companyId, currentFiscalYearId: string)`. Se implementó `(companyId, currentFY?: CurrentFiscalYear)` para poder resolver por `number+1` (que requiere el número, no solo el id) y por fecha en el fallback. Desvío justificado por coherencia con la lógica real.
- **Validación de padre**: el diseño mencionaba "extender `validateAccountParent`". Para no romper los ~3 llamadores actuales de `validateAccountParent` se creó `validateAccountParentSameType` aparte y se invocan **ambos** en create/update (existencia/empresa + mismo-tipo). Menor riesgo.
- **`getAccountRollupBalances`**: no reutiliza `buildAccountTree` (vive en `index.ts`, que re-exporta de `balances.ts` → ciclo). Construye el parent map localmente. Mismo resultado, sin ciclo de import.
- **Umbral de saldo cero**: se usa `Math.abs(balance) <= 0.001` para tolerancia de redondeo (consistente con el `< 0.01` de otras validaciones contables).
- **`isAccountEnabled`**: firma final `(account: { isActive; disabledFrom }, fiscalYearStart: Date)` (el diseño usaba `Pick<Account,...>`; se relajó a un objeto estructural para no atar el tipo al modelo Prisma completo).
- **check-types**: 0 errores nuevos en los archivos tocados. Los errores existentes de `check-types` (warehouses, equipment/depreciation, products, opening-balances, bank-movements, etc.) son **preexistentes del branch** y ajenos a este ticket. `db:generate` OK.
- **NO se aplicó nada a la DB** (Fase 1 sigue sin migrar; Fase 2 no toca DB).

### Fase 3: UI del módulo accounts — **Estado: Completada** (2026-07-01)

**Archivos creados/modificados:**
- `src/modules/accounting/shared/types/index.ts` — `AccountWithChildren` extendido con `isLeaf`, `disabledFrom`, `disabledFromFiscalYearId` (ya llegaban en runtime vía `buildAccountTree`, faltaba el tipo).
- `src/modules/accounting/features/accounts/AccountsList.tsx` (server) — obtiene `getCurrentFiscalYear` y `getAccountRollupBalances(companyId, fy.endDate)`, arma `balances: Record<string, number>` (Decimals→Number) y pasa `balances`, `fiscalYearStart`, `fiscalYearNumber` a la tabla.
- `src/modules/accounting/features/accounts/components/_AccountsTable.tsx` — nuevas columnas **Saldo** (con roll-up; imputables muestran su saldo, sumatoria la suma de hijas) y **Estado** (badge Vigente / Baja programada / Deshabilitada según `disabledFrom`/`isActive` vs. inicio del ejercicio). Etiqueta "(sumatoria)" en cuentas con hijas. Nueva acción **Deshabilitar** en el menú (solo si `isActive && !disabledFrom`).
- `src/modules/accounting/features/accounts/components/_DisableAccountDialog.tsx` — **NUEVO** AlertDialog que explica la regla (saldo 0 → ejercicio en curso; con saldo → próximo; cascada en sumatoria), llama `disableAccount` y muestra el desglose de `DisableAccountResult` por toast. Maneja errores (ej. sin próximo ejercicio).
- `_CreateAccountModal.tsx` / `_EditAccountModal.tsx` — selector de **cuenta padre filtrado por el mismo `type`** (se limpia `parentId` al cambiar el tipo), ayuda del formato `x.x.x/xx/xx`, e indicador imputable/sumatoria (en edición, derivado de si tiene hijas).

**Notas:** los saldos se calculan al `endDate` del ejercicio en curso (fallback hoy). 0 errores de tipo/lint nuevos.

### Fase 4: Selects externos (solo imputables) — **Estado: Completada** (2026-07-01)

Todos vía el filtro compartido `buildImputableAccountsWhere` (sin imports cross-module). Se preservan los valores ya guardados con `includeIds`/`OR`.
- `treasury/.../bank-movements/actions.server.ts:getAccountsForBankMovement(includeIds?)` — contrapartida: imputables **patrimoniales** (ASSET/LIABILITY/EQUITY), excluyendo Resultado (ticket req.3).
- `accounting/features/settings/actions.server.ts:getActiveAccounts(companyId, includeIds?)` + `AccountingSettings.tsx` — imputables (todos los tipos; el form filtra por tipo por campo). Se pasan los `*AccountId` ya configurados como `includeIds` para no perder valores guardados.
- `accounting/features/opening-balances/actions.server.ts` — la grilla de saldos de apertura usa `buildImputableAccountsWhere` (solo hojas).
- `accounting/features/entries/components/_CreateEntryModal.tsx` — las líneas de asiento pasan a `getImputableAccounts` (antes `getAccounts`, que traía sumatoria).
- **Sin cambios** (ya cumplían): `products/shared/catalog-actions.server.ts` (ya filtra `isLeaf`) y `budgets/actions.server.ts:getBudgetableAccounts` (ya filtra hojas + EXPENSE/REVENUE).

**Notas:** `getAccounts` (selector de padre) se dejó intacto a propósito (necesita cuentas de sumatoria como posibles padres). 0 errores de tipo nuevos (los de opening-balances/bank-movements son preexistentes del branch).

### Fase 5: Docs, guía y tests — **Estado: Completada** (2026-07-01)

- `docs/architecture/data-model.md` — documentada la semántica imputable/sumatoria (`isLeaf`), el formato de `code`, y la deshabilitación por ejercicio (`disabledFrom`/`disabledFromFiscalYearId`).
- `src/modules/help/features/guide/components/_AccountingGuide.tsx` — guía de usuario del Plan de Cuentas: formato `x.x.x/xx/xx`, imputables vs. sumatoria, saldo, padre mismo-tipo y deshabilitar (regla + cascada).
- `src/modules/accounting/shared/utils/account-code.test.ts` — **NUEVO** test unitario (Vitest) de `validateAccountCodeFormat`: **9/9 pasan**.
- **Cypress E2E:** pendiente de correr con la app levantada + migración aplicada (no ejecutable en esta sesión).

## 5. Verificación
_Pendiente - ejecutar `/verificar cuentas-imputables` (tras aplicar la migración + normalización en la base)_
