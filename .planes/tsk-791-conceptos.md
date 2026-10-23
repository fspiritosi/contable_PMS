# TSK-791 — Conceptos de movimientos: plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Contabilidad define Conceptos (nombre, usos, cuenta). Gestión los elige en Gastos bancarios, en Aporte y Retiro de socio y en el movimiento bancario manual, y deja de elegir cuentas contables.

**Architecture:** Un modelo `MovementConcept` con un array de usos (`ConceptUsage[]`, un enum que abarca las dos familias: movimiento de fondo y movimiento bancario) y un modo de cuenta (`OWN_ACCOUNT` / `PARTNER_ACCOUNT`). Las reglas puras y la resolución "concepto → cuenta" viven en `src/shared/lib/concepts/`, porque las consumen Contabilidad y Comercial y los módulos no se importan entre sí. El ABM vive en `src/modules/accounting/features/concepts/`. Los movimientos guardan `conceptId` y un snapshot `conceptName`. La cuenta se resuelve en el servidor al guardar y al confirmar (o al registrar, en el movimiento bancario).

**Tech Stack:** Next.js 16 (App Router, Server Actions), Prisma 7 + PostgreSQL, React Hook Form + Zod, TanStack Query, shadcn/ui, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-22-tsk-791-conceptos-design.md` (leerlo antes de cada tarea).

Rama: `feat/tsk-791-conceptos` (sale de `main`).

## Global Constraints

- Reglas de `CLAUDE.md` y `.claude/rules/`:
  - Permisos en 3 niveles: `checkPermission` en cada action, `PermissionGuard` en la página y `usePermissions` en el client.
  - Server Components por defecto; los componentes cliente llevan prefijo `_`.
  - Sin `:any`; los enums vienen de `@/generated/prisma/enums`.
  - `Decimal` → `Number()` antes de pasar datos al client.
  - Logger, nunca `console.*`.
  - moment.js, nunca date-fns.
  - Componentes de menos de 200 líneas.
- Los errores de negocio son `BusinessError` y las actions devuelven `ActionResult` (`@/shared/lib/action-result`). Nada de `throw new Error` para mensajes de usuario, porque Next los redacta en producción.
- `modules/commercial` no importa de `modules/accounting`, ni al revés. Lo compartido va en `src/shared/`.
- Tests con **Vitest** (`npm run test`). Los de integración siguen el molde de `fund-movement-lines.integration.test.ts`:
  - `describe.skipIf(!dbAvailable)`;
  - prefijo único por archivo (`TSK791-TEST-`);
  - `vi.mock` solo de `server-only`, `current-user`, `company`, `permissions` y `next/cache`;
  - limpieza y verificación en `afterAll`.
- **Gestión nunca ve una cuenta**: ningún combo ni aviso de Comercial muestra código ni nombre de cuenta de un concepto. Solo el nombre del concepto.
- **Tipos de cuenta admitidos por uso.** Son las reglas que ya existen y no cambian:
  - `FUND_BANK_CHARGES`: `EXPENSE`, `ASSET` (TSK-579).
  - `FUND_PARTNER_*`: `ASSET`, `LIABILITY`, `EQUITY` (TSK-717).
  - `BANK_*`: `ASSET`, `LIABILITY`, `EQUITY` (ticket #376).
  - Un concepto con varios usos admite la **intersección**.
- Mensaje cuando no hay conceptos para un uso (mismo texto en todos lados): `No hay conceptos configurados para «{uso}». Pedile a Contabilidad que los cree en Empresa → Contabilidad → Conceptos.`
- Línea base antes de empezar: `npm run check-types` da **219** errores preexistentes (ninguno de estos archivos). Ninguna tarea puede subir ese número.

## Review Focus

1. **Borrador con un concepto que Contabilidad desactivó o al que le quitó el uso.** Al confirmar se rechaza con un mensaje que nombra el concepto, y no se mueve ningún saldo. Tarea 5 (test `rechaza confirmar con concepto inactivo o sin el uso`).
2. **Concepto con cuenta propia que dejó de ser imputable** (pasó a no-hoja, se desactivó o tiene corte por ejercicio). Al confirmar o registrar se rechaza con un mensaje que nombra concepto y cuenta, y sugiere avisar a Contabilidad. Tarea 2 (test `resolveConceptAccount rechaza cuenta no imputable`).
3. **Empresa sin conceptos para Aporte o Retiro.** El borrador viejo se guarda y se confirma exactamente como antes. Tarea 5 (test `sin conceptos de aporte, confirma como antes con la cuenta del socio`).
4. **Cambio de tipo en el formulario.**
   - En el movimiento bancario, pasar de Comisión a Depósito limpia el concepto si no aplica al nuevo tipo.
   - En el movimiento de fondo, pasar de Gastos bancarios a Aporte no manda las líneas al servidor.
   - Tarea 7 (verificación en navegador) y Tarea 6 (test `buildLinesData ignora líneas fuera de BANK_CHARGES`, que ya existe: mantenerlo verde).
5. **Nombre duplicado con distinta capitalización o espacios** ("Comisión " vs "comisión") entre conceptos activos. Se rechaza. Reactivar un inactivo cuyo nombre ya está ocupado por uno activo también se rechaza. Tarea 3 (test `rechaza nombre duplicado entre activos`).

---

### Tarea 1: Modelo, migración y reglas puras de conceptos

**Files:**
- Modify: `prisma/schema.prisma` (enums nuevos; modelo `MovementConcept`; campos en `FundMovementLine`, `FundMovement`, `BankMovement`; relaciones en `Company` y `Account`)
- Create: `prisma/migrations/<timestamp>_tsk_791_movement_concepts/migration.sql` (con `npm run db:migrate -- --name tsk_791_movement_concepts`)
- Create: `src/shared/lib/concepts/usages.ts`
- Test: `src/shared/lib/concepts/usages.test.ts`

**Interfaces:**
- Produces (Prisma):
  ```prisma
  enum ConceptUsage {
    FUND_BANK_CHARGES
    FUND_PARTNER_CONTRIBUTION
    FUND_PARTNER_WITHDRAWAL
    BANK_DEPOSIT
    BANK_WITHDRAWAL
    BANK_TRANSFER_IN
    BANK_TRANSFER_OUT
    BANK_CHECK
    BANK_DEBIT
    BANK_FEE
    BANK_INTEREST
    @@map("concept_usage")
  }
  enum ConceptAccountMode { OWN_ACCOUNT PARTNER_ACCOUNT  @@map("concept_account_mode") }
  model MovementConcept {
    id, companyId, name String, usages ConceptUsage[],
    accountMode ConceptAccountMode @default(OWN_ACCOUNT),
    accountId String? (FK Account), isActive Boolean @default(true),
    createdBy String, createdAt, updatedAt
    // relaciones inversas: fundMovementLines, fundMovements, bankMovements
    @@index([companyId, isActive])  @@map("movement_concepts")
  }
  ```
  - `FundMovementLine`: `conceptId String? @db.Uuid`, `conceptName String?`.
  - `FundMovement`: `conceptId String? @db.Uuid`, `conceptName String?`.
  - `BankMovement`: `conceptId String? @db.Uuid`, `conceptName String?`.
  - Las tres FK van con `onDelete: SetNull`. Todas las columnas son nullable: los históricos no tienen concepto.
- Produces (`usages.ts`, puro, sin Prisma client):
  - `CONCEPT_USAGE_LABELS: Record<ConceptUsage, string>`:
    - `FUND_BANK_CHARGES` → `'Gastos e impuestos bancarios'`, `FUND_PARTNER_CONTRIBUTION` → `'Aporte de socio'`, `FUND_PARTNER_WITHDRAWAL` → `'Retiro de socio'`.
    - Los `BANK_*` usan las etiquetas de `BANK_MOVEMENT_TYPE_LABELS` (Depósito, Extracción, Transferencia Recibida, Transferencia Enviada, Cheque, Débito Automático, Comisión, Interés), copiadas acá porque ese archivo es de Comercial.
  - `CONCEPT_USAGE_GROUPS: { label: string; usages: ConceptUsage[] }[]`: `'Movimientos de fondo'` y `'Movimientos bancarios'`.
  - `fundMovementUsage(type: FundMovementType): ConceptUsage | null` (`ACCOUNT_TRANSFER` → `null`).
  - `bankMovementUsage(type: BankMovementType): ConceptUsage`.
  - `PARTNER_USAGES: ConceptUsage[]`.
  - `allowedAccountTypes(usages: ConceptUsage[]): AccountType[]`: intersección según Global Constraints; `[]` si `usages` está vacío.
  - `type ConceptConfigError = 'NAME_REQUIRED' | 'NO_USAGES' | 'PARTNER_MODE_NOT_ALLOWED' | 'ACCOUNT_REQUIRED' | 'NO_COMMON_ACCOUNT_TYPE'`.
  - `CONCEPT_CONFIG_ERROR_MESSAGES: Record<ConceptConfigError, string>`.
  - `validateConceptConfig(input: { name: string; usages: ConceptUsage[]; accountMode: ConceptAccountMode; accountId: string | null }): ConceptConfigError | null`.

- [ ] **Step 1: Escribir los tests que fallan** en `usages.test.ts`:
  - `fundMovementUsage('ACCOUNT_TRANSFER')` es `null`; `fundMovementUsage('BANK_CHARGES')` es `'FUND_BANK_CHARGES'`.
  - `bankMovementUsage('FEE')` es `'BANK_FEE'`, y los 8 tipos tienen uso.
  - `allowedAccountTypes(['FUND_BANK_CHARGES'])` es `['EXPENSE','ASSET']` (en cualquier orden).
  - `allowedAccountTypes(['FUND_BANK_CHARGES','BANK_FEE'])` es `['ASSET']`.
  - `allowedAccountTypes(['FUND_PARTNER_CONTRIBUTION','BANK_DEPOSIT'])` es `['ASSET','LIABILITY','EQUITY']`.
  - `validateConceptConfig`:
    - nombre `'  '` → `'NAME_REQUIRED'`;
    - `usages: []` → `'NO_USAGES'`;
    - `PARTNER_ACCOUNT` con `['FUND_PARTNER_CONTRIBUTION','FUND_PARTNER_WITHDRAWAL']` y sin cuenta → `null`;
    - `PARTNER_ACCOUNT` con `['FUND_PARTNER_CONTRIBUTION','FUND_BANK_CHARGES']` → `'PARTNER_MODE_NOT_ALLOWED'`;
    - `OWN_ACCOUNT` sin cuenta → `'ACCOUNT_REQUIRED'`.
- [ ] **Step 2:** `npx vitest run src/shared/lib/concepts/usages.test.ts`. Esperado: FAIL (módulo inexistente).
- [ ] **Step 3:** Editar el schema, correr `npm run db:migrate -- --name tsk_791_movement_concepts` y `npm run db:generate`. Implementar `usages.ts`.
- [ ] **Step 4:** Correr el test (PASS) y `npm run check-types` (219).
- [ ] **Step 5: Commit** — `feat(accounting): modelo de conceptos de movimientos y sus reglas (TSK-791)`.

### Tarea 2: Lectura y resolución de conceptos en `shared`

**Files:**
- Create: `src/shared/lib/concepts/concepts.server.ts` (`import 'server-only'`)
- Create: `src/shared/lib/concepts/index.ts` (reexporta `usages` y los tipos; el server se importa por ruta directa)
- Test: `src/shared/lib/concepts/concepts.integration.test.ts`

**Interfaces:**
- Consumes: Tarea 1; `buildImputableAccountsWhere` (`@/shared/lib/accounts/imputable-accounts`); `BusinessError`.
- Produces:
  - `type ConceptDb`: el cliente Prisma o un `tx` (mismo `Omit<...>` que `PrismaTransactionClient` de `fund-movements/list/actions.server.ts`).
  - `interface ConceptOption { id: string; name: string; accountMode: ConceptAccountMode }`. Sin datos de cuenta, a propósito.
  - `getActiveConceptOptions(db: ConceptDb, companyId: string, usages: ConceptUsage[]): Promise<Record<ConceptUsage, ConceptOption[]>>`. Solo devuelve claves de los `usages` pedidos, con los conceptos ordenados por nombre.
  - `countActiveConcepts(db: ConceptDb, companyId: string, usage: ConceptUsage): Promise<number>`.
  - `interface ResolvedConcept { id: string; name: string; accountMode: ConceptAccountMode; accountId: string | null }`.
  - `resolveConceptForUsage(db: ConceptDb, input: { companyId: string; conceptId: string; usage: ConceptUsage }): Promise<ResolvedConcept>`. Lanza `BusinessError` si:
    - el concepto no existe o es de otra empresa (`'El concepto elegido ya no existe. Elegí otro.'`);
    - está inactivo (`'El concepto «{name}» está desactivado. Elegí otro concepto.'`);
    - no incluye el uso (`'El concepto «{name}» ya no aplica a {label del uso}. Elegí otro concepto.'`);
    - es `OWN_ACCOUNT` y su cuenta no es imputable o no es de `allowedAccountTypes([usage])` (`'La cuenta del concepto «{name}» no está activa o no es imputable. Pedile a Contabilidad que la corrija en Empresa → Contabilidad → Conceptos.'`). Se valida con `buildImputableAccountsWhere({ companyId, types })`.

- [ ] **Step 1: Tests de integración que fallan** (prefijo `TSK791-TEST-`; siembran empresa, cuentas EXPENSE/ASSET/no-hoja y conceptos):
  - `getActiveConceptOptions devuelve solo activos con el uso pedido, ordenados por nombre, sin datos de cuenta`.
  - `countActiveConcepts ignora inactivos`.
  - `resolveConceptForUsage devuelve la cuenta propia`.
  - `resolveConceptForUsage con PARTNER_ACCOUNT devuelve accountId null`.
  - `rechaza concepto inactivo`, `rechaza concepto sin el uso` y `rechaza concepto de otra empresa`: cada uno compara el mensaje exacto.
  - `resolveConceptForUsage rechaza cuenta no imputable` (cuenta con `isLeaf: false`).
- [ ] **Step 2:** `npx vitest run src/shared/lib/concepts`. Esperado: FAIL.
- [ ] **Step 3:** Implementar `concepts.server.ts`.
- [ ] **Step 4:** Tests en PASS y `npm run check-types` (219).
- [ ] **Step 5: Commit** — `feat(accounting): lectura y resolución de conceptos compartida (TSK-791)`.

### Tarea 3: Permiso y ABM de conceptos (server)

**Files:**
- Modify: `src/shared/lib/permissions/constants.ts`:
  - agregar `'accounting.concepts'` en `MODULES`;
  - label `'Conceptos'`;
  - sumarlo al grupo `configuracionContable` después de `'accounting.settings'`.
- Modify: `src/modules/company/features/general/roles/actions.server.ts`: sumar `{ key: MODULES['accounting.concepts'], label: 'Conceptos' }` al grupo Contabilidad. `PERMISSION_MODULE_MAP` ya lo cubre por el prefijo `accounting`: no se toca.
- Create: `src/modules/accounting/features/concepts/shared/validators.ts`
- Create: `src/modules/accounting/features/concepts/actions.server.ts`
- Test: `src/modules/accounting/features/concepts/concepts-crud.integration.test.ts`

**Interfaces:**
- Consumes: Tarea 1 (`validateConceptConfig`, `allowedAccountTypes`, `CONCEPT_CONFIG_ERROR_MESSAGES`).
- Produces:
  - `conceptSchema` (Zod) con los campos `name` (trim, máximo 100), `usages` (array de `ConceptUsage`), `accountMode` y `accountId` (uuid o `''`/`null`). El `superRefine` llama a `validateConceptConfig` y marca el error en el campo que corresponde: `NO_USAGES` → `usages`, `ACCOUNT_REQUIRED` → `accountId`, `PARTNER_MODE_NOT_ALLOWED` → `accountMode`.
  - `type ConceptFormInput` y `type ConceptFormData`.
  - Actions, todas con `checkPermission('accounting.concepts', <acción>)` y `getActiveCompanyId()`:
    - `getConcepts(searchParams: DataTableSearchParams)`: lista paginada. Cada fila incluye `usages`, `accountMode`, `account: { code, name } | null`, `isActive` y `usageCount` (líneas + movimientos + movimientos bancarios que lo referencian).
    - `getConceptById(id: string)`.
    - `getConceptAccountOptions(usages: ConceptUsage[], includeIds?: string[])`: cuentas imputables de `allowedAccountTypes(usages)`. Con `includeIds` preserva la cuenta ya guardada, con el patrón de `getPartnerContributionAccounts`.
    - `createConcept(data: ConceptFormInput): Promise<ActionResult<{ id: string }>>`.
    - `updateConcept(id: string, data: ConceptFormInput): Promise<ActionResult<{ id: string }>>`.
    - `setConceptActive(id: string, isActive: boolean): Promise<ActionResult>`.
    - `deleteConcept(id: string): Promise<ActionResult>`.
  - Reglas del server en create/update:
    - con `PARTNER_ACCOUNT`, `accountId` se guarda en `null`;
    - con `OWN_ACCOUNT`, la cuenta tiene que ser imputable y de `allowedAccountTypes(usages)` (`'La cuenta elegida no sirve para todos los usos marcados: tiene que ser de tipo …'`, con los tipos traducidos);
    - el nombre es único entre los **activos** de la empresa, comparado con `trim` y sin distinguir mayúsculas (`'Ya existe un concepto activo con ese nombre'`). También se valida al reactivar con `setConceptActive(id, true)`.
  - `deleteConcept` solo borra si `usageCount === 0`. Si no, devuelve `'Este concepto ya se usó en movimientos: desactivalo en lugar de borrarlo.'`.

- [ ] **Step 1: Tests de integración que fallan:**
  - `crea concepto de gastos bancarios con cuenta EXPENSE`.
  - `rechaza cuenta EXPENSE si también aplica a BANK_FEE`.
  - `PARTNER_ACCOUNT guarda accountId null`.
  - `rechaza PARTNER_ACCOUNT con uso de gastos bancarios`.
  - `rechaza nombre duplicado entre activos` (`' comisión '` contra `'Comisión'`).
  - `permite el mismo nombre si el otro está inactivo, y rechaza reactivarlo`.
  - `deleteConcept rechaza concepto usado en una línea` y `deleteConcept borra uno sin uso`.
- [ ] **Step 2:** Correr. Esperado: FAIL.
- [ ] **Step 3:** Implementar los permisos, los validators y las actions.
- [ ] **Step 4:** Tests en PASS; `npx vitest run src/shared/lib/workspaces` sigue en verde, y check-types da 219.
- [ ] **Step 5: Commit** — `feat(accounting): ABM de conceptos y permiso accounting.concepts (TSK-791)`.

### Tarea 4: Pantalla de Conceptos en Contabilidad

**Files:**
- Create: `src/modules/accounting/features/concepts/ConceptsList.tsx` (Server; `PermissionGuard module="accounting.concepts" action="view" redirect`; molde: `treasury/features/partners/features/list/PartnersList.tsx`)
- Create: `src/modules/accounting/features/concepts/columns.tsx`. Columnas con `meta.title`:
  - Nombre;
  - Usos: badges con `CONCEPT_USAGE_LABELS`;
  - Cuenta: `code - name`, o `'Cuenta del socio'`;
  - Estado;
  - Acciones.
- Create: `src/modules/accounting/features/concepts/components/_ConceptsTable.tsx` (DataTable + botón "Nuevo concepto" con `hasPermission('accounting.concepts','create')`; las acciones de fila editar, activar/desactivar y eliminar usan `AlertDialog` para eliminar)
- Create: `src/modules/accounting/features/concepts/components/_ConceptFormDialog.tsx`
- Create: `src/modules/accounting/features/concepts/components/_ConceptUsagesField.tsx`: checkboxes agrupados con `CONCEPT_USAGE_GROUPS`. Transferencia no aparece porque no existe en el enum.
- Create: `src/modules/accounting/features/concepts/components/_ConceptAccountField.tsx`:
  - si todos los usos marcados están en `PARTNER_USAGES`, muestra un `RadioGroup` "¿Qué cuenta usa?" con dos opciones: `'Mantener la cuenta del socio'` / `'Usar otra cuenta'`;
  - si no, fuerza `OWN_ACCOUNT` y no muestra el radio;
  - con `OWN_ACCOUNT`, `AccountCombobox` alimentado por `useQuery(['concept-accounts', usages, savedAccountId], () => getConceptAccountOptions(usages, …))`.
- Create: `src/modules/accounting/features/concepts/index.ts`
- Create: `src/app/(core)/dashboard/company/accounting/concepts/page.tsx` (página delgada, igual que `accounts/page.tsx`)
- Modify: `src/shared/components/layout/_AppSidebar.tsx`: ítem `{ title: 'Conceptos', href: '/dashboard/company/accounting/concepts', module: 'accounting.concepts' }` entre "Plan de Cuentas" y "Configuración".

**Interfaces:**
- Consumes: Tareas 1 y 3.

- [ ] **Step 1:** Implementar. Al cambiar los usos, si el modo era `PARTNER_ACCOUNT` y deja de estar permitido, pasa a `OWN_ACCOUNT`. Si la cuenta elegida ya no está entre las opciones, se limpia.
- [ ] **Step 2:** `npm run check-types` (219) y `npx eslint src/modules/accounting/features/concepts`.
- [ ] **Step 3: Verificación en navegador** (dev en `:3010`, ver memoria de capturas) con `scripts/guia-presentacion/capturas-tsk791.mjs` (sección Contabilidad; el script se crea acá y crece en las tareas 6 y 7). Chequeos:
  - el ítem aparece en el sidebar;
  - se crean los conceptos `Impuesto ley 25.413` (Gastos bancarios, cuenta de gasto), `Aporte para obra` (Aporte, cuenta propia de PN) y `Aporte común` (Aporte, cuenta del socio);
  - marcar Gastos bancarios oculta el radio;
  - eliminar uno usado muestra el error.
  - Capturas: `tsk791-01-listado`, `tsk791-02-alta-gasto`, `tsk791-03-alta-aporte-radio`.
- [ ] **Step 4: Commit** — `feat(accounting): pantalla de Conceptos (TSK-791)`.

### Tarea 5: Movimientos de fondo con concepto (server)

**Files:**
- Modify: `src/modules/commercial/features/treasury/features/fund-movements/shared/lines-calc.ts`:
  - `FundMovementLineInput` pasa a `{ conceptId: string; description: string; amount: string }`;
  - `LineError` cambia `MISSING_ACCOUNT` por `MISSING_CONCEPT` (`'Elegí el concepto'`) y elimina `MISSING_DESCRIPTION`, porque el detalle es opcional;
  - se borra `pickDefaultLineAccount`.
- Modify: `.../fund-movements/shared/lines-calc.test.ts`: adaptar a lo anterior.
- Modify: `.../fund-movements/shared/validators.ts`:
  - `lines[].accountId` se reemplaza por `conceptId: z.string().uuid('Elegí el concepto')`;
  - el objeto raíz suma `conceptId: z.string().uuid().optional().or(z.literal(''))`.
- Modify: `.../fund-movements/shared/validators.test.ts`
- Modify: `.../fund-movements/list/actions.server.ts`
- Test: `.../fund-movements/list/fund-movement-concepts.integration.test.ts` (nuevo). Se adaptan `fund-movement-lines.integration.test.ts` y `fund-movement-partner-account.integration.test.ts`: las líneas pasan a sembrar conceptos.

**Interfaces:**
- Consumes: Tarea 2 (`resolveConceptForUsage`, `countActiveConcepts`, `getActiveConceptOptions`); `fundMovementUsage`.
- Produces:
  - `getFundMovementCatalogs()`:
    - deja de devolver `defaultBankChargesAccount`;
    - suma `concepts: Record<'BANK_CHARGES' | 'PARTNER_CONTRIBUTION' | 'PARTNER_WITHDRAWAL', ConceptOption[]>` (indexado por `FundMovementType`).
  - Se eliminan `getFundMovementLineAccounts` y `assertLineAccounts`.
  - `buildLinesData` pasa a ser `async` y recibe `(db, companyId, data)`. Devuelve `FundMovementLineData` con `conceptId`, `conceptName`, `accountId` (resuelto con `resolveConceptForUsage`), `description` (detalle trimmeado, puede ser `''`), `amount` y `position`.
  - Nueva `resolveMovementConcept(db, companyId, data)`, para Aporte y Retiro:
    - si `countActiveConcepts(usage) > 0` y no viene `conceptId`, lanza `BusinessError` con `'Elegí el concepto del movimiento'`;
    - si viene, resuelve y devuelve `{ conceptId, conceptName }`;
    - si no hay conceptos activos, devuelve `{ conceptId: null, conceptName: null }`.
  - `createFundMovement` y `updateFundMovement` persisten `conceptId`/`conceptName` en el movimiento y en las líneas.
  - `confirmFundMovement`, dentro del `tx`:
    - **BANK_CHARGES:** si alguna línea no tiene `conceptId`, lanza `'Hay conceptos sin elegir: editá el movimiento y elegí el concepto de cada línea.'`. Si todas tienen, cada línea se vuelve a resolver con `resolveConceptForUsage` y el asiento usa esa cuenta, actualizando `accountId`/`conceptName` de la línea. La descripción de la línea del asiento es `line.description || conceptName`.
    - **Aporte/Retiro:**
      - si hay conceptos activos para el uso y el movimiento no tiene `conceptId`, lanza `'Este movimiento no tiene concepto. Editalo y elegí uno antes de confirmarlo.'`;
      - con concepto, se vuelve a resolver: `PARTNER_ACCOUNT` usa `resolvePartnerCapitalAccount` como hoy, y `OWN_ACCOUNT` usa la cuenta del concepto. El socio sigue siendo obligatorio en los dos casos;
      - sin conceptos activos, el comportamiento es idéntico al de hoy.
    - La resolución se hace **antes** de `applyFundSide`, para que un rechazo no mueva saldos.

- [ ] **Step 1: Tests que fallan** en `fund-movement-concepts.integration.test.ts`:
  - `gastos bancarios: cada línea imputa a la cuenta de su concepto y la descripción cae al nombre si no hay detalle`.
  - `al confirmar toma la cuenta actual del concepto, no la del borrador` (cambiar `accountId` del concepto entre guardar y confirmar).
  - `rechaza confirmar con concepto inactivo o sin el uso`: verifica que el saldo del banco no cambió y que el movimiento sigue en `DRAFT`.
  - `rechaza guardar gastos bancarios con conceptId de otra empresa`.
  - `aporte con concepto de cuenta propia imputa a esa cuenta aunque el socio no tenga cuenta de aportes`.
  - `aporte con concepto PARTNER_ACCOUNT imputa a la cuenta del socio`.
  - `con conceptos de aporte activos, rechaza guardar y confirmar sin concepto`: el borrador viejo se crea directo con Prisma.
  - `sin conceptos de aporte, confirma como antes con la cuenta del socio`.
- [ ] **Step 2:** `npx vitest run src/modules/commercial/features/treasury/features/fund-movements`. Esperado: FAIL.
- [ ] **Step 3:** Implementar y adaptar los tests existentes.
- [ ] **Step 4:** Toda la carpeta en PASS y check-types en 219. El tipo de los componentes cliente rompe hasta la Tarea 6: **está permitido que check-types suba solo por errores en `fund-movements/list/components` y `hooks`**, y la Tarea 6 los tiene que dejar en 219.
- [ ] **Step 5: Commit** — `feat(commercial): movimientos de fondo imputan por concepto (TSK-791)`.

### Tarea 6: Formulario de movimientos de fondo y ajuste de la cuenta por defecto

**Files:**
- Modify: `.../fund-movements/list/components/_FundMovementLinesField.tsx`:
  - el `AccountCombobox` se reemplaza por un `Select` de conceptos (`concepts.BANK_CHARGES`);
  - "Descripción" pasa a ser "Detalle (opcional)";
  - sin la prop `accounts` ni `defaultAccount`.
- Delete: `.../fund-movements/list/components/_BankChargesDefaultNotice.tsx`
- Create: `.../fund-movements/list/components/_FundMovementConceptField.tsx`: concepto único para Aporte y Retiro. Se muestra solo si `concepts[type].length > 0`.
- Create: `.../fund-movements/list/components/_NoConceptsNotice.tsx`:
  - recibe `usageLabel: string` y muestra el mensaje de Global Constraints;
  - si `hasPermission('accounting.concepts','view')`, agrega un `Link` a `/dashboard/company/accounting/concepts`.
  - Se exporta desde `src/shared/components/common/` para que la reutilice la Tarea 7. Va en `src/shared/components/common/_NoConceptsNotice.tsx`, no en fund-movements.
- Modify: `_CreateFundMovementModal.tsx`, `hooks/useFundMovementForm.ts`, `hooks/useFundMovementSubmit.ts`, `_PartnerAccountNotice.tsx`, `_FundMovementViewSummary.tsx`:
  - con Gastos bancarios sin conceptos, se muestra `_NoConceptsNotice` y los botones Guardar/Confirmar quedan deshabilitados;
  - `_PartnerAccountNotice` recibe el `ConceptOption` elegido. Si es `OWN_ACCOUNT` muestra `'El asiento se imputará según el concepto «{name}».'` y no evalúa la cuenta del socio. Si es `PARTNER_ACCOUNT` o no hay concepto, se comporta como hoy;
  - la vista muestra el concepto de cada línea y del movimiento (snapshot `conceptName`). En las líneas históricas sin concepto muestra la descripción, como hoy.
- Modify: `src/modules/accounting/features/settings/components/_CommercialIntegrationForm.tsx`: sacar el campo `bankChargesAccountId`. La columna y el validator se quedan. Si `validators.test.ts` de settings lo requiere, solo se ajusta para que siga pasando.

**Interfaces:**
- Consumes: Tarea 5 (`getFundMovementCatalogs().concepts`, `ConceptOption`).

- [ ] **Step 1:** Implementar. Al cambiar el tipo se limpia `conceptId`. Se mantiene la regla existente de no mandar líneas fuera de BANK_CHARGES.
- [ ] **Step 2:** `npm run check-types` (219, ahora sí), `npx eslint` de las carpetas tocadas y `npx vitest run src/modules/commercial/features/treasury src/modules/accounting/features/settings`.
- [ ] **Step 3: Verificación en navegador** (extender `capturas-tsk791.mjs`):
  - Gastos bancarios con dos líneas de concepto se confirma, y el asiento tiene las cuentas de los conceptos (chequeo por `psql`);
  - la línea no muestra ninguna cuenta (chequeo: el texto del modal no contiene el código de la cuenta);
  - Aporte muestra el campo Concepto;
  - en una empresa sin conceptos de Gastos bancarios aparece el aviso y Guardar está deshabilitado.
  - Capturas: `tsk791-04-gastos-bancarios-conceptos`, `tsk791-05-aporte-concepto`, `tsk791-06-sin-conceptos`.
- [ ] **Step 4: Commit** — `feat(commercial): formulario de movimientos de fondo con conceptos (TSK-791)`.

### Tarea 7: Movimiento bancario manual con concepto

**Files:**
- Modify: `src/modules/commercial/features/treasury/shared/validators.ts`: en `bankMovementSchema`, `accountId` pasa a ser `conceptId: z.string().uuid('Elegí el concepto')`.
- Modify: `src/modules/commercial/features/treasury/features/bank-movements/actions.server.ts`:
  - `createBankMovement` resuelve `resolveConceptForUsage(tx, { usage: bankMovementUsage(type) })` y usa su `accountId` como contrapartida;
  - guarda `conceptId`/`conceptName` en `BankMovement`;
  - se elimina `getAccountsForBankMovement` y se suma `getBankMovementConcepts(): Promise<Record<BankMovementType, ConceptOption[]>>` con `checkPermission('commercial.treasury.bank-accounts','view')`.
- Modify: `.../bank-accounts/detail/components/_CreateBankMovementDialog.tsx`:
  - "Cuenta Contable (Contrapartida)" pasa a ser "Concepto" (`Select` filtrado por el `type` observado);
  - al cambiar el tipo, si el concepto no aplica se limpia;
  - sin conceptos para el tipo, se muestra `_NoConceptsNotice` y "Registrar" queda deshabilitado.
- Modify: `.../bank-accounts/detail/columns.tsx`: columna opcional "Concepto" (`conceptName ?? '—'`) con `meta.title`.
- Modify: `.../bank-movements/bank-movement-period-lock.integration.test.ts`: sembrar un concepto y mandar `conceptId`.
- Test: `.../bank-movements/bank-movement-concepts.integration.test.ts` (nuevo).

**Interfaces:**
- Consumes: Tareas 1, 2 y 6 (`_NoConceptsNotice`).

- [ ] **Step 1: Tests que fallan:**
  - `registra comisión con la cuenta del concepto como contrapartida y guarda el snapshot`.
  - `rechaza concepto que no aplica al tipo`: un concepto de BANK_FEE usado en un DEPOSIT no deja movimiento ni cambia el saldo.
  - `rechaza concepto inactivo`.
- [ ] **Step 2:** Correr. Esperado: FAIL.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** `npx vitest run src/modules/commercial/features/treasury/features/bank-movements` en PASS; check-types en 219; eslint.
- [ ] **Step 5: Verificación en navegador** (extender el script):
  - "Nuevo Movimiento" no tiene ningún campo de cuenta;
  - cambiar Comisión → Depósito limpia el concepto;
  - se registra una comisión con concepto.
  - Captura: `tsk791-07-movimiento-bancario`.
- [ ] **Step 6: Commit** — `feat(commercial): movimiento bancario manual con concepto (TSK-791)`.

### Tarea 8: Documentación, guías y presentación

**Files:**
- Modify: `src/modules/help/features/guide/components/_AccountingGuide.tsx`: sección "Conceptos" (qué son, usos, modo de cuenta, desactivar vs. eliminar).
- Modify: `src/modules/help/features/guide/components/_TreasuryGuide.tsx`:
  - Gastos bancarios, Aporte/Retiro y movimiento bancario con concepto;
  - qué pasa si no hay conceptos;
  - se saca la mención a la cuenta por defecto de gastos bancarios.
- Modify: `docs/architecture/data-model.md` (`MovementConcept`, campos nuevos), `docs/architecture/auth-and-permissions.md` (`accounting.concepts`), y los docs de módulo de Contabilidad y de Tesorería que describen movimientos de fondo y bancarios (ubicarlos con `grep -rl "fund-movements\|Movimiento de fondos" docs/modules`).
- Create: `scripts/guia-presentacion/tsk-791.html` (molde: `tsk-790.html` / `tsk-782.html`).
- Create: `docs/presentaciones/TSK-791-conceptos.pdf` (`node scripts/guia-presentacion/generar-pdf.mjs …`).

- [ ] **Step 1:** Escribir guías y docs.
- [ ] **Step 2:** PDF de presentación con las capturas de las Tareas 4, 6 y 7. Secciones:
  - qué se pidió;
  - Contabilidad: crear conceptos;
  - Gestión: gastos bancarios, aportes/retiros y movimiento bancario;
  - qué configurar antes de usarlo. Esto es lo crítico: **sin conceptos de Gastos bancarios y de cada tipo bancario, Gestión no puede cargar esos movimientos**;
  - qué no cambia: los históricos, las transferencias y los movimientos de recibos y OP.
- [ ] **Step 3:** `npm run test` completo, `npm run check-types` (219) y `npm run lint` (sin errores nuevos).
- [ ] **Step 4: Commit** — `docs: guías, docs y presentación de Conceptos (TSK-791)`.

## Notas de deploy (para el PR)

- Migración `tsk_791_movement_concepts`. Es aditiva: no borra la columna `bank_charges_account_id`.
- **Antes de que Gestión vuelva a cargar Gastos bancarios o movimientos bancarios manuales, Contabilidad tiene que crear los conceptos.** Avisarle al cliente con la presentación.
- `accounting.concepts` lo tienen siempre Propietario y Desarrollador (`checkPermission.server.ts` les da todo). En las empresas existentes, el rol **Administrador** y los roles personalizados no lo tienen, porque `initializeCompanyRbac` materializa la matriz solo al crear la empresa: otorgarlo desde Roles después de deployar. Las empresas nuevas lo reciben por `MODULE_GROUPS`.
