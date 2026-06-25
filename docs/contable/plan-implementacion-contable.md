# Plan de Implementación Contable — Correcciones y Features Faltantes

> Este documento es la guía de trabajo para llevar el módulo contable del ERP al estado descrito en `guia-implementacion-contable-erp.md`. Cada sección corresponde a un bloque de trabajo independiente, ordenado por prioridad y dependencias.
>
> **Convención**: `[ESTADO]` al inicio de cada bloque indica su progreso: `PENDIENTE`, `EN CURSO`, `COMPLETADO`.

---

## Índice

- [Bloque 0 — Constraints de DB y seguridad de datos](#bloque-0--constraints-de-db-y-seguridad-de-datos)
- [Bloque 1 — Modelo de Ejercicio y Período contable](#bloque-1--modelo-de-ejercicio-y-período-contable)
- [Bloque 2 — Campo `imputable` en cuentas y auxiliares en asientos](#bloque-2--campo-imputable-en-cuentas-y-auxiliares-en-asientos)
- [Bloque 3 — Numeración atómica de asientos](#bloque-3--numeración-atómica-de-asientos)
- [Bloque 4 — IVA discriminado por alícuota](#bloque-4--iva-discriminado-por-alícuota)
- [Bloque 5 — Percepciones en facturas](#bloque-5--percepciones-en-facturas)
- [Bloque 6 — Puente contable: correcciones críticas](#bloque-6--puente-contable-correcciones-críticas)
- [Bloque 7 — Cierre de ejercicio completo](#bloque-7--cierre-de-ejercicio-completo)
- [Bloque 8 — Reportes: correcciones y mejoras](#bloque-8--reportes-correcciones-y-mejoras)
- [Bloque 9 — Retenciones: cálculo automático y certificados](#bloque-9--retenciones-cálculo-automático-y-certificados)
- [Bloque 10 — Multi-moneda](#bloque-10--multi-moneda)
- [Bloque 11 — Puente contable: cruces faltantes](#bloque-11--puente-contable-cruces-faltantes)
- [Bloque 12 — Integración ARCA (WSAA + WSFEv1)](#bloque-12--integración-arca-wsaa--wsfev1)
- [Bloque 13 — Libro IVA Digital y archivos fiscales](#bloque-13--libro-iva-digital-y-archivos-fiscales)
- [Bloque 14 — Ajuste por inflación (RECPAM)](#bloque-14--ajuste-por-inflación-recpam)
- [Dependencias entre bloques](#dependencias-entre-bloques)

---

## Bloque 0 — Constraints de DB y seguridad de datos

`[ESTADO: COMPLETADO]`

**Problema**: Todas las validaciones contables (partida doble, inmutabilidad, montos no negativos) solo existen en la capa de aplicación. Una query directa, un script de migración o un bug en otro módulo podrían violar la integridad contable.

**Objetivo**: Agregar constraints y triggers a nivel de PostgreSQL como red de seguridad.

### 0.1 Migración SQL: CHECK constraints en `journal_entry_lines`

```sql
-- En la migración:
ALTER TABLE journal_entry_lines
  ADD CONSTRAINT chk_debit_non_negative CHECK (debit >= 0),
  ADD CONSTRAINT chk_credit_non_negative CHECK (credit >= 0),
  ADD CONSTRAINT chk_debit_or_credit CHECK (
    (debit > 0 AND credit = 0) OR (credit > 0 AND debit = 0)
  );
```

**Nota de migración**: Antes de aplicar, verificar que no existan filas con `debit = 0 AND credit = 0` o con ambos > 0:

```sql
SELECT COUNT(*) FROM journal_entry_lines WHERE debit = 0 AND credit = 0;
SELECT COUNT(*) FROM journal_entry_lines WHERE debit > 0 AND credit > 0;
```

Si existen, corregirlas antes de aplicar el constraint.

### 0.2 Trigger de inmutabilidad en `journal_entries`

```sql
CREATE OR REPLACE FUNCTION prevent_posted_entry_modification()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'POSTED' THEN
    -- Solo permitir transición POSTED → REVERSED
    IF TG_OP = 'UPDATE' AND NEW.status = 'REVERSED' THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Cannot modify a POSTED journal entry (id=%)', OLD.id;
  END IF;
  IF OLD.status = 'REVERSED' THEN
    RAISE EXCEPTION 'Cannot modify a REVERSED journal entry (id=%)', OLD.id;
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;

CREATE TRIGGER trg_journal_entry_immutable
BEFORE UPDATE OR DELETE ON journal_entries
FOR EACH ROW EXECUTE FUNCTION prevent_posted_entry_modification();
```

### 0.3 Trigger de inmutabilidad en `journal_entry_lines`

```sql
CREATE OR REPLACE FUNCTION prevent_posted_entry_line_modification()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE v_status TEXT;
BEGIN
  SELECT status INTO v_status FROM journal_entries
  WHERE id = COALESCE(OLD.entry_id, NEW.entry_id);

  IF v_status IN ('POSTED', 'REVERSED') THEN
    RAISE EXCEPTION 'Cannot modify lines of a % journal entry', v_status;
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;

CREATE TRIGGER trg_journal_entry_line_immutable
BEFORE UPDATE OR DELETE ON journal_entry_lines
FOR EACH ROW EXECUTE FUNCTION prevent_posted_entry_line_modification();
```

### 0.4 Precisión decimal (de 12,2 a 18,2)

Evaluar si es necesario migrar los campos `Decimal(12,2)` a `Decimal(18,2)` para soportar importes grandes. `Decimal(12,2)` soporta hasta 9.999.999.999,99 (~10 mil millones), que debería ser suficiente para la mayoría de empresas PyME. **Postergar esta migración** salvo que haya un caso de uso real que lo requiera, ya que implica tocar muchas tablas.

### Archivos a modificar

| Archivo | Cambio |
|---|---|
| `prisma/migrations/YYYYMMDD_accounting_constraints/migration.sql` | Nueva migración con CHECKs y triggers |

### Criterio de aceptación

- [ ] `INSERT INTO journal_entry_lines (debit, credit) VALUES (-1, 0)` falla
- [ ] `INSERT INTO journal_entry_lines (debit, credit) VALUES (100, 50)` falla
- [ ] `UPDATE journal_entries SET description='X' WHERE status='POSTED'` falla
- [ ] `DELETE FROM journal_entry_lines WHERE entry_id IN (SELECT id FROM journal_entries WHERE status='POSTED')` falla
- [ ] La transición `POSTED → REVERSED` funciona normalmente
- [ ] Los tests existentes pasan sin cambios

---

## Bloque 1 — Modelo de Ejercicio y Período contable

`[ESTADO: COMPLETADO]`

**Problema**: No existe tabla de ejercicios ni de períodos. El ejercicio fiscal es un par de campos en `AccountingSettings`. No se pueden cerrar meses individualmente ni llevar historial de ejercicios.

**Objetivo**: Crear modelos `FiscalYear` y `AccountingPeriod` que reemplacen los campos sueltos, con cierre mensual y soporte para múltiples ejercicios.

### 1.1 Nuevos modelos Prisma

```prisma
enum AccountingPeriodType {
  MONTHLY
  OPENING    // Asiento de apertura
  CLOSING    // Asiento de cierre/refundición
  ADJUSTMENT // Asiento de ajuste (inflación, etc.)

  @@map("accounting_period_type")
}

model FiscalYear {
  id        String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  companyId String   @map("company_id") @db.Uuid
  number    Int      // Ejercicio Nº 1, 2, 3...
  startDate DateTime @map("start_date")
  endDate   DateTime @map("end_date")
  isClosed  Boolean  @default(false) @map("is_closed")
  closedAt  DateTime? @map("closed_at")
  closedBy  String?  @map("closed_by")

  company   Company  @relation(fields: [companyId], references: [id])
  periods   AccountingPeriod[]
  entries   JournalEntry[]

  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  @@unique([companyId, number])
  @@map("fiscal_years")
}

model AccountingPeriod {
  id           String               @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  fiscalYearId String               @map("fiscal_year_id") @db.Uuid
  year         Int
  month        Int
  type         AccountingPeriodType @default(MONTHLY)
  isClosed     Boolean              @default(false) @map("is_closed")
  closedAt     DateTime?            @map("closed_at")
  closedBy     String?              @map("closed_by")

  fiscalYear   FiscalYear @relation(fields: [fiscalYearId], references: [id])
  entries      JournalEntry[]

  createdAt    DateTime @default(now()) @map("created_at")
  updatedAt    DateTime @updatedAt @map("updated_at")

  @@unique([fiscalYearId, year, month, type])
  @@map("accounting_periods")
}
```

### 1.2 Cambios en `JournalEntry`

Agregar referencia al ejercicio y período:

```prisma
model JournalEntry {
  // ... campos existentes ...
  fiscalYearId String? @map("fiscal_year_id") @db.Uuid
  periodId     String? @map("period_id") @db.Uuid

  fiscalYear   FiscalYear?       @relation(fields: [fiscalYearId], references: [id])
  period       AccountingPeriod? @relation(fields: [periodId], references: [id])
}
```

**Nullable al principio** para compatibilidad con asientos existentes. Una vez migrados los datos, hacer NOT NULL.

### 1.3 Migración de datos

1. Crear un `FiscalYear` por empresa usando `fiscalYearStart`/`fiscalYearEnd` de `AccountingSettings`.
2. Crear 12 `AccountingPeriod` (MONTHLY) + 1 OPENING + 1 CLOSING para ese ejercicio.
3. Asignar cada `JournalEntry` existente al `FiscalYear` y `AccountingPeriod` correspondiente según su fecha.
4. Marcar períodos anteriores a `lockedUntilDate` como `isClosed = true`.

### 1.4 Cambios en validadores

| Validador actual | Cambio |
|---|---|
| `validateJournalEntryDate` | Validar que la fecha caiga dentro del `FiscalYear` Y del `AccountingPeriod` correspondiente. Verificar que ni el período ni el ejercicio estén cerrados. |
| `validatePeriodLock` | Reemplazar lógica de `lockedUntilDate` por `period.isClosed`. Mantener `lockedUntilDate` como fallback durante la transición. |

### 1.5 UI: Cierre mensual

Nueva feature en `src/modules/accounting/features/period-close/`:

- `PeriodClose.tsx` — Server Component con lista de períodos del ejercicio actual.
- `actions.server.ts` — `getPeriodsStatus()`, `closePeriod(periodId)`, `reopenPeriod(periodId)`.
- `_PeriodCloseTable.tsx` — Tabla con estado de cada mes, botón cerrar/reabrir.

### 1.6 UI: Gestión de Ejercicios

Agregar a `src/modules/accounting/features/settings/` o crear feature `fiscal-years/`:

- CRUD de ejercicios fiscales.
- Al crear un ejercicio, generar automáticamente los 12+2 períodos.
- Vista del historial de ejercicios.

### 1.7 Deprecar campos viejos

Los campos `fiscalYearStart`, `fiscalYearEnd` y `lockedUntilDate` en `AccountingSettings` quedan como **deprecated**. Se mantienen por compatibilidad durante la transición pero toda la lógica nueva debe usar los modelos `FiscalYear`/`AccountingPeriod`.

### Archivos a modificar

| Archivo | Cambio |
|---|---|
| `prisma/schema.prisma` | Nuevos modelos `FiscalYear`, `AccountingPeriod`, enum `AccountingPeriodType`. FK en `JournalEntry`. |
| `prisma/migrations/YYYYMMDD_fiscal_years/migration.sql` | Crear tablas, migrar datos desde `AccountingSettings`. |
| `src/modules/accounting/features/entries/validators/index.ts` | `validateJournalEntryDate` y `validatePeriodLock` usan nuevos modelos. |
| `src/modules/accounting/features/entries/actions.server.ts` | `createJournalEntry` y `postJournalEntry` asignan `fiscalYearId`/`periodId`. |
| `src/modules/accounting/features/integrations/commercial/index.ts` | `createJournalEntry` interno asigna período. |
| `src/modules/accounting/features/period-close/` | **Nuevo** — Feature de cierre mensual. |
| `src/modules/accounting/features/settings/` | Agregar gestión de ejercicios o crear feature `fiscal-years/`. |

### Criterio de aceptación

- [ ] Existe al menos un `FiscalYear` por empresa con sus 14 períodos.
- [ ] `createJournalEntry` asigna `fiscalYearId` y `periodId` automáticamente según la fecha.
- [ ] Intentar contabilizar en un período cerrado lanza error visible al usuario.
- [ ] El cierre mensual marca `isClosed = true` y bloquea nuevos asientos en ese mes.
- [ ] Reabrir un período es posible (con permiso especial).
- [ ] Los asientos existentes migran correctamente al nuevo modelo.

---

## Bloque 2 — Campo `imputable` en cuentas y auxiliares en asientos

`[ESTADO: COMPLETADO]`

**Problema**: No hay campo `imputable` en `Account`, permitiendo imputar a cuentas padre. No hay auxiliares (cliente/proveedor) en `JournalEntryLine`, impidiendo generar cuentas corrientes desde el mayor.

### 2.1 Campo `imputable` en `Account`

```prisma
model Account {
  // ... campos existentes ...
  isLeaf  Boolean @default(true) @map("is_leaf")  // solo las hojas reciben asientos
}
```

**Migración de datos**: Calcular `is_leaf` para todas las cuentas existentes:

```sql
UPDATE accounts SET is_leaf = true;  -- default
UPDATE accounts SET is_leaf = false
WHERE id IN (SELECT DISTINCT parent_id FROM accounts WHERE parent_id IS NOT NULL);
```

**Trigger de consistencia** (mantener `is_leaf` actualizado):

```sql
-- Al insertar/eliminar una cuenta con parent_id, actualizar is_leaf del padre
CREATE OR REPLACE FUNCTION update_account_is_leaf()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.parent_id IS NOT NULL THEN
    UPDATE accounts SET is_leaf = false WHERE id = NEW.parent_id;
  ELSIF TG_OP = 'DELETE' AND OLD.parent_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM accounts WHERE parent_id = OLD.parent_id AND id != OLD.id) THEN
      UPDATE accounts SET is_leaf = true WHERE id = OLD.parent_id;
    END IF;
  ELSIF TG_OP = 'UPDATE' AND OLD.parent_id IS DISTINCT FROM NEW.parent_id THEN
    -- Antiguo padre puede volver a ser hoja
    IF OLD.parent_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM accounts WHERE parent_id = OLD.parent_id AND id != OLD.id
    ) THEN
      UPDATE accounts SET is_leaf = true WHERE id = OLD.parent_id;
    END IF;
    -- Nuevo padre deja de ser hoja
    IF NEW.parent_id IS NOT NULL THEN
      UPDATE accounts SET is_leaf = false WHERE id = NEW.parent_id;
    END IF;
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;

CREATE TRIGGER trg_account_is_leaf
AFTER INSERT OR UPDATE OR DELETE ON accounts
FOR EACH ROW EXECUTE FUNCTION update_account_is_leaf();
```

### 2.2 Validación en asientos

En `validateJournalEntryAccounts()`, agregar check:

```typescript
const nonLeafAccounts = accounts.filter(a => !a.isLeaf);
if (nonLeafAccounts.length > 0) {
  throw new Error(
    `Las siguientes cuentas no son imputables (tienen subcuentas): ${nonLeafAccounts.map(a => a.code).join(', ')}`
  );
}
```

### 2.3 Auxiliares en `JournalEntryLine`

```prisma
model JournalEntryLine {
  // ... campos existentes ...
  customerId   String? @map("customer_id") @db.Uuid
  supplierId   String? @map("supplier_id") @db.Uuid
  costCenterId String? @map("cost_center_id") @db.Uuid

  customer     Contractor? @relation(fields: [customerId], references: [id])
  supplier     Supplier?   @relation(fields: [supplierId], references: [id])
  costCenter   CostCenter? @relation(fields: [costCenterId], references: [id])
}
```

### 2.4 Campo `requiresAuxiliary` en `Account`

```prisma
enum AuxiliaryType {
  CUSTOMER
  SUPPLIER
  COST_CENTER

  @@map("auxiliary_type")
}

model Account {
  // ... campos existentes ...
  requiresAuxiliary AuxiliaryType? @map("requires_auxiliary")
}
```

Cuando una cuenta tiene `requiresAuxiliary = 'CUSTOMER'`, la validación de asientos debe exigir que el renglón tenga `customerId` no nulo.

### 2.5 Integración con el puente contable

En `createJournalEntryForSalesInvoice`, al crear la línea de Cuentas por Cobrar:

```typescript
{
  accountId: settings.receivablesAccountId,
  debit: total,
  credit: 0,
  customerId: invoice.customerId,  // ← NUEVO
}
```

Análogamente para compras (`supplierId`), y en recibos/OP.

### 2.6 Vista de cuenta corriente contable

Nueva vista/reporte en `src/modules/accounting/features/reports/`:

```typescript
// getCustomerLedger(companyId, customerId, fromDate, toDate)
// → Filtra JournalEntryLine WHERE customerId = X, calcula saldo acumulado
```

### Archivos a modificar

| Archivo | Cambio |
|---|---|
| `prisma/schema.prisma` | `isLeaf`, `requiresAuxiliary` en `Account`. `customerId`, `supplierId`, `costCenterId` en `JournalEntryLine`. Enum `AuxiliaryType`. |
| `prisma/migrations/YYYYMMDD_account_leaf_and_auxiliaries/migration.sql` | Nuevas columnas + trigger `is_leaf` + migración de datos. |
| `src/modules/accounting/features/entries/validators/index.ts` | Validar `isLeaf` y auxiliar requerido. |
| `src/modules/accounting/features/integrations/commercial/index.ts` | Pasar `customerId`/`supplierId` en las líneas de asiento. |
| `src/modules/accounting/features/integrations/equipment/index.ts` | Idem si aplica. |
| `src/modules/accounting/features/accounts/` | UI para configurar `requiresAuxiliary` en la edición de cuenta. |
| `src/modules/accounting/features/reports/actions.server.ts` | Nuevo reporte de cuenta corriente contable. |

### Criterio de aceptación

- [ ] No se puede contabilizar un asiento con una cuenta no-hoja.
- [ ] Cuentas que requieren auxiliar rechazan renglones sin `customerId`/`supplierId`.
- [ ] El puente contable pasa `customerId`/`supplierId` correctamente.
- [ ] Reporte de cuenta corriente contable muestra movimientos por cliente/proveedor con saldo acumulado.
- [ ] `is_leaf` se recalcula automáticamente al crear/eliminar/mover cuentas.

---

## Bloque 3 — Numeración atómica de asientos

`[ESTADO: COMPLETADO]`

**Problema**: `lastEntryNumber` se lee fuera de la transacción y se incrementa dentro. Bajo concurrencia, dos asientos pueden recibir el mismo número. El unique index lo detecta pero produce un error feo.

**Objetivo**: Garantizar numeración correlativa y sin huecos usando operaciones atómicas.

### 3.1 Opción recomendada: `UPDATE ... RETURNING` dentro de la transacción

Reemplazar el patrón actual en `createJournalEntry` (en `integrations/commercial/index.ts` y `entries/actions.server.ts`):

```typescript
// ANTES (race condition):
const settings = await prisma.accountingSettings.findUnique({ where: { companyId } });
const nextNumber = settings.lastEntryNumber + 1;
// ... crear asiento con number: nextNumber ...
await prisma.accountingSettings.update({ data: { lastEntryNumber: nextNumber } });

// DESPUÉS (atómico):
const [{ last_entry_number: nextNumber }] = await tx.$queryRaw<[{ last_entry_number: number }]>`
  UPDATE accounting_settings
  SET last_entry_number = last_entry_number + 1, updated_at = NOW()
  WHERE company_id = ${companyId}::uuid
  RETURNING last_entry_number
`;
// nextNumber ya es el valor incrementado, usar directamente
```

Este patrón hace `SELECT FOR UPDATE` implícito (el `UPDATE` bloquea la fila) y el `RETURNING` devuelve el valor ya incrementado. Debe ejecutarse **dentro** del `tx.$transaction()`.

### 3.2 Aplicar en todos los puntos que crean asientos

| Archivo | Función |
|---|---|
| `src/modules/accounting/features/entries/actions.server.ts` | `createJournalEntry()` |
| `src/modules/accounting/features/entries/actions.server.ts` | `reverseJournalEntry()` |
| `src/modules/accounting/features/integrations/commercial/index.ts` | `createJournalEntry()` (helper privado) |
| `src/modules/accounting/features/fiscal-year-close/actions.server.ts` | `closeFiscalYear()` |

### Criterio de aceptación

- [ ] 10 asientos creados en paralelo (test de concurrencia) producen 10 números distintos y correlativos.
- [ ] No hay `lastEntryNumber` leído fuera de la transacción en ningún archivo.

---

## Bloque 4 — IVA discriminado por alícuota

`[ESTADO: COMPLETADO]`

**Problema**: El puente contable genera una sola línea de IVA por factura (sumando todas las alícuotas). El Libro IVA pierde las alícuotas 0%, 2.5%, 5%. No se distingue neto gravado / no gravado / exento.

### 4.1 Líneas de factura: agregar tipo de línea

```prisma
enum InvoiceLineType {
  TAXED          // Gravado (IVA > 0%)
  NON_TAXED      // No gravado
  EXEMPT         // Exento

  @@map("invoice_line_type")
}

model SalesInvoiceLine {
  // ... campos existentes ...
  lineType InvoiceLineType @default(TAXED) @map("line_type")
}

model PurchaseInvoiceLine {
  // ... campos existentes ...
  lineType InvoiceLineType @default(TAXED) @map("line_type")
}
```

**Migración de datos**: Las líneas existentes con `vatRate > 0` quedan como `TAXED`. Las que tienen `vatRate = 0` necesitan revisión manual o heurística (basarse en el `description` que dejó el importador AFIP: `'No gravado'` → `NON_TAXED`, `'Operaciones exentas'` → `EXEMPT`, resto → `TAXED`).

### 4.2 Campos `netoNoGravado` y `exento` en facturas

```prisma
model SalesInvoice {
  // ... campos existentes ...
  netTaxed      Decimal @default(0) @map("net_taxed") @db.Decimal(12, 2)
  netNonTaxed   Decimal @default(0) @map("net_non_taxed") @db.Decimal(12, 2)
  netExempt     Decimal @default(0) @map("net_exempt") @db.Decimal(12, 2)
}

model PurchaseInvoice {
  // ... campos existentes ...
  netTaxed      Decimal @default(0) @map("net_taxed") @db.Decimal(12, 2)
  netNonTaxed   Decimal @default(0) @map("net_non_taxed") @db.Decimal(12, 2)
  netExempt     Decimal @default(0) @map("net_exempt") @db.Decimal(12, 2)
}
```

Estos campos se calculan al confirmar la factura sumando las líneas por `lineType`.

### 4.3 Cuentas de IVA por alícuota en `AccountingSettings`

Reemplazar las 2 cuentas actuales (`vatDebitAccountId`, `vatCreditAccountId`) por un sistema de múltiples cuentas:

```prisma
model AccountingVatAccount {
  id         String  @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  settingsId String  @map("settings_id") @db.Uuid
  vatRate    Decimal @map("vat_rate") @db.Decimal(5, 2) // 0, 2.5, 5, 10.5, 21, 27
  side       String  // 'DEBIT' (ventas) o 'CREDIT' (compras)
  accountId  String  @map("account_id") @db.Uuid

  settings   AccountingSettings @relation(fields: [settingsId], references: [id])
  account    Account            @relation(fields: [accountId], references: [id])

  @@unique([settingsId, vatRate, side])
  @@map("accounting_vat_accounts")
}
```

**Alternativa más simple** (si no se quiere una tabla nueva): mantener `vatDebitAccountId` y `vatCreditAccountId` como cuentas "por defecto" y solo crear la tabla de detalle cuando el contador quiera discriminar por alícuota. Si la tabla `AccountingVatAccount` está vacía para una empresa, el puente usa las cuentas globales (comportamiento actual). Si tiene registros, usa las específicas por alícuota.

### 4.4 Puente contable: generar líneas por alícuota

En `createJournalEntryForSalesInvoice` y `createJournalEntryForPurchaseInvoice`:

```typescript
// ANTES: una sola línea IVA
if (hasVat) {
  lines.push({ accountId: settings.vatDebitAccountId, debit: 0, credit: vatAmount });
}

// DESPUÉS: una línea por alícuota
const linesByRate = await tx.salesInvoiceLine.groupBy({
  by: ['vatRate'],
  where: { invoiceId, lineType: 'TAXED' },
  _sum: { vatAmount: true },
});

for (const group of linesByRate) {
  if (Number(group._sum.vatAmount) === 0) continue;
  const vatAccountId = await getVatAccountForRate(settings, group.vatRate, 'DEBIT');
  lines.push({
    accountId: vatAccountId,
    debit: 0,
    credit: Number(group._sum.vatAmount),
  });
}
```

### 4.5 Libro IVA: incluir todas las alícuotas

En `getLibroIVAVentas()` y `getLibroIVACompras()`:

```typescript
// ANTES: hardcoded
const ivaByRate = { 105: 0, 21: 0, 27: 0 };

// DESPUÉS: dinámico
const ivaByRate: Record<string, number> = {};
for (const line of invoice.lines) {
  const rate = Number(line.vatRate);
  const key = rate.toString();
  ivaByRate[key] = (ivaByRate[key] || 0) + Number(line.vatAmount);
}
```

Agregar columnas `netTaxed`, `netNonTaxed`, `netExempt` a la respuesta del reporte.

### Archivos a modificar

| Archivo | Cambio |
|---|---|
| `prisma/schema.prisma` | Enum `InvoiceLineType`, campo `lineType` en líneas de factura, campos `netTaxed`/`netNonTaxed`/`netExempt` en facturas, modelo `AccountingVatAccount` (o cuentas adicionales en settings). |
| `prisma/migrations/YYYYMMDD_iva_alicuotas/migration.sql` | Nuevas columnas + migración de datos. |
| `src/modules/accounting/features/integrations/commercial/index.ts` | Generar líneas IVA por alícuota. |
| `src/modules/accounting/features/settings/` | UI para configurar cuentas IVA por alícuota. |
| `src/modules/commercial/features/reports/actions.server.ts` | Libro IVA: todas las alícuotas + neto gravado/no gravado/exento. |
| `src/modules/commercial/features/sales/features/invoices/` | Formulario: agregar selector de tipo de línea. Cálculo de totales por tipo. |
| `src/modules/commercial/features/purchases/features/invoices/` | Idem para compras. |
| `src/modules/commercial/features/purchases/features/invoices/list/lib/afip-import.server.ts` | Asignar `lineType` correcto al importar. |

### Criterio de aceptación

- [ ] Factura con líneas al 21% y 10.5% genera 2 líneas de IVA en el asiento.
- [ ] Libro IVA muestra columnas para 0%, 2.5%, 5%, 10.5%, 21%, 27%.
- [ ] Libro IVA muestra neto gravado, no gravado y exento por separado.
- [ ] Importación AFIP asigna `lineType` correctamente.
- [ ] La configuración permite mapear cada alícuota a una cuenta contable distinta.

---

## Bloque 5 — Percepciones en facturas

`[ESTADO: COMPLETADO]`

**Problema**: Las percepciones (IIBB, IVA, Municipal) están enterradas en el campo `otherTaxes` de las facturas, sin discriminar. No se puede generar CITI ni depositar percepciones.

### 5.1 Nuevo modelo `InvoicePerception`

```prisma
enum PerceptionType {
  IVA
  IIBB
  MUNICIPAL

  @@map("perception_type")
}

model SalesInvoicePerception {
  id          String         @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  invoiceId   String         @map("invoice_id") @db.Uuid
  type        PerceptionType
  jurisdiction String?       // Provincia (para IIBB)
  rate        Decimal        @db.Decimal(6, 3)
  baseAmount  Decimal        @map("base_amount") @db.Decimal(12, 2)
  amount      Decimal        @db.Decimal(12, 2)

  invoice     SalesInvoice   @relation(fields: [invoiceId], references: [id], onDelete: Cascade)

  @@map("sales_invoice_perceptions")
}

model PurchaseInvoicePerception {
  id          String         @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  invoiceId   String         @map("invoice_id") @db.Uuid
  type        PerceptionType
  jurisdiction String?
  rate        Decimal        @db.Decimal(6, 3)
  baseAmount  Decimal        @map("base_amount") @db.Decimal(12, 2)
  amount      Decimal        @db.Decimal(12, 2)

  invoice     PurchaseInvoice @relation(fields: [invoiceId], references: [id], onDelete: Cascade)

  @@map("purchase_invoice_perceptions")
}
```

### 5.2 Cuentas de percepciones en `AccountingSettings`

```prisma
model AccountingSettings {
  // ... existentes ...
  // Percepciones cobradas (pasivo, a depositar):
  perceptionIvaCollectedAccountId  String? @map("perception_iva_collected_account_id") @db.Uuid
  perceptionIibbCollectedAccountId String? @map("perception_iibb_collected_account_id") @db.Uuid
  // Percepciones sufridas (activo, crédito fiscal):
  perceptionIvaSufferedAccountId   String? @map("perception_iva_suffered_account_id") @db.Uuid
  perceptionIibbSufferedAccountId  String? @map("perception_iibb_suffered_account_id") @db.Uuid
}
```

### 5.3 Puente contable

En `createJournalEntryForSalesInvoice`:

```typescript
// Percepciones cobradas → Haber (pasivo a depositar)
for (const perc of invoice.perceptions) {
  const accountId = getPerceptionAccountId(settings, perc.type, 'collected');
  if (!accountId) continue;
  lines.push({ accountId, debit: 0, credit: Number(perc.amount) });
}
// Ajustar la línea de Cuentas por Cobrar: total ahora incluye percepciones
```

En `createJournalEntryForPurchaseInvoice`:

```typescript
// Percepciones sufridas → Debe (activo, crédito fiscal)
for (const perc of invoice.perceptions) {
  const accountId = getPerceptionAccountId(settings, perc.type, 'suffered');
  if (!accountId) continue;
  lines.push({ accountId, debit: Number(perc.amount), credit: 0 });
}
```

### 5.4 UI: Formulario de facturas

Agregar sección de percepciones en los formularios de factura de venta y compra:

- Grilla editable: tipo, jurisdicción, alícuota, base, importe.
- Recalcular `otherTaxes` como la suma de percepciones (mantener compatibilidad).

### 5.5 Libro IVA

Agregar columnas de percepciones discriminadas por tipo al reporte.

### Archivos a modificar

| Archivo | Cambio |
|---|---|
| `prisma/schema.prisma` | Modelos `SalesInvoicePerception`, `PurchaseInvoicePerception`, enum `PerceptionType`, nuevas cuentas en `AccountingSettings`. |
| `src/modules/accounting/features/integrations/commercial/index.ts` | Leer percepciones y generar líneas contables. |
| `src/modules/accounting/features/settings/` | UI para configurar cuentas de percepciones. |
| `src/modules/commercial/features/sales/features/invoices/` | Formulario: sección de percepciones. |
| `src/modules/commercial/features/purchases/features/invoices/` | Idem. |
| `src/modules/commercial/features/reports/actions.server.ts` | Libro IVA: columnas de percepciones. |

### Criterio de aceptación

- [ ] Una factura puede tener percepciones de IIBB + IVA con jurisdicción y alícuota.
- [ ] El asiento contable genera líneas separadas para cada percepción.
- [ ] El Libro IVA muestra percepciones discriminadas.
- [ ] El campo `otherTaxes` se mantiene como suma de percepciones (backward compatible).

---

## Bloque 6 — Puente contable: correcciones críticas

`[ESTADO: COMPLETADO]`

**Problema**: El puente contable tiene 3 bugs/gaps críticos: (1) período bloqueado retorna `null` silenciosamente, (2) no usa cuenta corriente individual por entidad, y (3) las notas de crédito se incluyen como positivas en el reporte IVA mensual.

### 6.1 Período bloqueado: error explícito en vez de silencio

En `createJournalEntry()` (helper privado en `integrations/commercial/index.ts`):

```typescript
// ANTES:
if (settings.lockedUntilDate && moment(date).isSameOrBefore(settings.lockedUntilDate, 'day')) {
  logger.warn('Período bloqueado, no se genera asiento');
  return null;  // ← SILENCIO PELIGROSO
}

// DESPUÉS:
if (isPeriodLocked(date, settings)) {
  // Opción A: Lanzar error (impide confirmar el documento)
  throw new Error(
    `No se puede generar el asiento contable: el período está cerrado para la fecha ${moment(date).format('DD/MM/YYYY')}. Contacte al contador.`
  );

  // Opción B: Marcar el documento con un flag (si se prefiere no bloquear)
  // → Agregar campo `accountingPending: Boolean` al documento
  // → El contador ve un listado de documentos sin contabilizar
}
```

**Decisión requerida**: Opción A (bloquear) es más segura y la recomendada por la guía. Opción B es más flexible pero requiere un nuevo flag y un listado de pendientes (similar al `evento_contable` de la guía). Evaluar con el equipo.

Si se elige Opción B, implementar un modelo tipo outbox:

```prisma
model AccountingEvent {
  id          String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  companyId   String   @map("company_id") @db.Uuid
  event       String   // 'SALES_INVOICE', 'PURCHASE_INVOICE', 'RECEIPT', etc.
  documentId  String   @map("document_id") @db.Uuid
  status      String   @default("PENDING") // PENDING, PROCESSED, ERROR
  errorMsg    String?  @map("error_msg")
  entryId     String?  @map("entry_id") @db.Uuid
  createdAt   DateTime @default(now()) @map("created_at")

  @@map("accounting_events")
}
```

### 6.2 Cuenta corriente individual por entidad

Este punto se resuelve con los auxiliares del Bloque 2. Adicionalmente, considerar si el plan de cuentas debe tener subcuentas por cliente/proveedor (inmanejable) o si el auxiliar en el renglón es suficiente (recomendado).

Con el auxiliar implementado (Bloque 2), la cuenta corriente contable se extrae directamente:

```sql
-- Cuenta corriente de un cliente desde el mayor
SELECT a.fecha, a.glosa, r.debe, r.haber,
       SUM(r.debe - r.haber) OVER (ORDER BY a.fecha, a.numero) AS saldo
FROM journal_entry_lines r
JOIN journal_entries a ON a.id = r.entry_id AND a.status = 'POSTED'
WHERE r.customer_id = :clienteId
  AND r.account_id = :cuentaDeudoresId
ORDER BY a.fecha, a.numero;
```

### 6.3 Reporte IVA mensual: NC como negativas

En `getMonthlyVATReport()` de `reports/actions.server.ts`:

```typescript
// ANTES: NC se suman como si fueran facturas positivas

// DESPUÉS: Detectar NC e invertir el signo
import { isCreditNote } from '@/modules/commercial/shared/voucher-utils';

for (const invoice of salesInvoices) {
  const sign = isCreditNote(invoice.voucherType) ? -1 : 1;
  totalSubtotal += Number(invoice.subtotal) * sign;
  totalVat += Number(invoice.vatAmount) * sign;
  // ... etc
}
```

### Archivos a modificar

| Archivo | Cambio |
|---|---|
| `src/modules/accounting/features/integrations/commercial/index.ts` | Error explícito en período bloqueado. O implementar outbox. |
| `src/modules/accounting/features/reports/actions.server.ts` | `getMonthlyVATReport`: invertir signo para NC. |
| `prisma/schema.prisma` | (Opcional) modelo `AccountingEvent` si se elige outbox. |

### Criterio de aceptación

- [ ] Confirmar una factura con fecha en período cerrado da error visible (Opción A) o queda como pendiente (Opción B).
- [ ] No existen documentos confirmados sin asiento contable sin que el usuario lo sepa.
- [ ] El reporte IVA mensual con una factura de $1000 + IVA y una NC de $200 + IVA muestra neto $800 e IVA correcto.

---

## Bloque 7 — Cierre de ejercicio completo

`[ESTADO: PENDIENTE]`

**Depende de**: Bloque 1 (modelo de ejercicio/período).

**Problema**: El cierre actual genera la refundición de resultados pero NO genera asiento de apertura, NO actualiza el ejercicio fiscal para el período siguiente, y la detección del cierre se basa en un string match frágil.

### 7.1 Cierre de ejercicio mejorado

Reescribir `closeFiscalYear()` para que haga los 3 pasos:

1. **Refundición de cuentas de resultado** (ya implementado, revisar dirección):
   - Verificar que `resultDiff > 0` (más gastos que ingresos) → pérdida → el resultado va al Debe del `resultAccountId`.
   - `resultDiff < 0` (más ingresos que gastos) → ganancia → el resultado va al Haber del `resultAccountId`.
   - La cuenta `resultAccountId` debe tener naturaleza CREDIT (es patrimonio).

2. **Asiento de cierre**: Lleva a cero TODAS las cuentas patrimoniales (ASSET, LIABILITY, EQUITY). D↔H invertido.

3. **Asiento de apertura**: En el nuevo ejercicio, abre con los saldos patrimoniales del cierre.

### 7.2 Flujo completo

```typescript
async function closeFiscalYear(companyId: string): Promise<void> {
  // 1. Validaciones
  //    - Todos los períodos MONTHLY del ejercicio están cerrados
  //    - No existe ya un asiento de cierre
  //    - Todas las cuentas de resultado tienen saldo (no cerrar si no hubo actividad)

  // 2. Crear período especial CLOSING si no existe

  // 3. Generar asiento de refundición de resultados (ya existe, corregir dirección)
  //    → periodo.type = CLOSING

  // 4. Marcar FiscalYear como cerrado

  // 5. Crear nuevo FiscalYear (número + 1, fechas consecutivas)

  // 6. Crear períodos del nuevo ejercicio (12 MONTHLY + OPENING + CLOSING)

  // 7. Generar asiento de apertura en el período OPENING del nuevo ejercicio
  //    → Para cada cuenta ASSET/LIABILITY/EQUITY con saldo != 0:
  //      - ASSET con saldo deudor → Debe
  //      - LIABILITY/EQUITY con saldo acreedor → Haber
  //    → Debe verificar que SUM(Debe) = SUM(Haber)
}
```

### 7.3 Detección de cierre: usar campo explícito

Agregar `closingEntryId` al `FiscalYear`:

```prisma
model FiscalYear {
  // ... existentes ...
  closingEntryId String? @map("closing_entry_id") @db.Uuid
  openingEntryId String? @map("opening_entry_id") @db.Uuid
}
```

Eliminar la detección por `description.startsWith('Cierre de ejercicio')`.

### Archivos a modificar

| Archivo | Cambio |
|---|---|
| `prisma/schema.prisma` | `closingEntryId`, `openingEntryId` en `FiscalYear`. |
| `src/modules/accounting/features/fiscal-year-close/actions.server.ts` | Reescribir completamente: refundición + cierre + apertura + rollover de ejercicio. |
| `src/modules/accounting/features/fiscal-year-close/` | UI: mostrar estado del cierre con los 3 pasos, permitir preview de cada uno. |

### Criterio de aceptación

- [ ] El cierre genera: refundición de resultados + asiento de cierre.
- [ ] Se crea automáticamente el siguiente `FiscalYear` con sus períodos.
- [ ] Se genera asiento de apertura en el nuevo ejercicio con saldos patrimoniales.
- [ ] Después del cierre, se pueden crear asientos en el nuevo ejercicio.
- [ ] Todas las cuentas de resultado quedan en cero después de la refundición.
- [ ] `FiscalYear.isClosed = true` y `closingEntryId` apunta al asiento de cierre.

---

## Bloque 8 — Reportes: correcciones y mejoras

`[ESTADO: PENDIENTE]`

### 8.1 Libro Mayor: saldo anterior

En `getGeneralLedger()`:

```typescript
// ANTES:
let balance = 0;

// DESPUÉS:
const openingBalance = await calculateOpeningBalance(account.id, companyId, fromDate);
let balance = openingBalance;
// Insertar fila de "Saldo anterior" si openingBalance != 0
```

### 8.2 Balance General: resultado del período en curso

En `getBalanceSheet()`, si el ejercicio NO está cerrado, calcular el resultado del período y sumarlo al PN:

```typescript
const incomeStatement = await getIncomeStatement(companyId, fiscalYearStart, asOfDate);
const periodResult = incomeStatement.netIncome;

// Agregar como línea virtual en EQUITY:
equity.push({
  code: '—',
  name: 'Resultado del ejercicio en curso',
  balance: periodResult,
});
totalEquity += periodResult;
```

### 8.3 Sumas y Saldos: performance (N+1)

Reemplazar `calculateAllAccountBalances()` por una sola query:

```typescript
const balances = await prisma.$queryRaw`
  SELECT r.account_id,
         COALESCE(SUM(r.debit), 0) as total_debit,
         COALESCE(SUM(r.credit), 0) as total_credit
  FROM journal_entry_lines r
  JOIN journal_entries e ON e.id = r.entry_id
  WHERE e.company_id = ${companyId}::uuid
    AND e.status = 'POSTED'
    AND e.date <= ${upToDate}
  GROUP BY r.account_id
`;
```

### 8.4 Conciliación IVA: subdiario vs. mayor

Nuevo reporte en `reports/`:

```typescript
export async function getVATReconciliation(companyId: string, year: number, month: number) {
  // 1. IVA según subdiario (facturas):
  const libroVentas = await getLibroIVAVentas(companyId, fromDate, toDate);
  const libroCompras = await getLibroIVACompras(companyId, fromDate, toDate);

  // 2. IVA según mayor (cuentas contables):
  const vatDebitBalance = await getAccountMovements(settings.vatDebitAccountId, fromDate, toDate);
  const vatCreditBalance = await getAccountMovements(settings.vatCreditAccountId, fromDate, toDate);

  // 3. Diferencias:
  return {
    subdiario: { debito: totalIVAVentas, credito: totalIVACompras },
    mayor: { debito: vatDebitBalance, credito: vatCreditBalance },
    diferencia: { debito: diff1, credito: diff2 },
    concilia: Math.abs(diff1) < 0.01 && Math.abs(diff2) < 0.01,
  };
}
```

### Archivos a modificar

| Archivo | Cambio |
|---|---|
| `src/modules/accounting/features/reports/actions.server.ts` | Corregir Mayor (saldo anterior), Balance (resultado en curso), Sumas y Saldos (query única), nuevo reporte conciliación IVA. |
| `src/modules/accounting/shared/utils/balances.ts` | Optimizar `calculateAllAccountBalances` con query única. |
| `src/modules/accounting/features/reports/components/` | UI del nuevo reporte de conciliación IVA. |

### Criterio de aceptación

- [ ] Libro Mayor con rango parcial muestra "Saldo anterior" correcto.
- [ ] Balance General cuadra en cualquier momento del ejercicio (no solo post-cierre).
- [ ] Sumas y Saldos con 200 cuentas ejecuta en < 2 segundos (una sola query).
- [ ] Reporte de conciliación IVA muestra diferencias entre subdiario y mayor.

---

## Bloque 9 — Retenciones: cálculo automático y certificados

`[ESTADO: PENDIENTE]`

**Depende de**: Bloque 5 (para percepciones completas, aunque retenciones se pueden hacer independientemente).

### 9.1 Modelo de regímenes de retención

```prisma
model WithholdingRegime {
  id             String  @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  companyId      String  @map("company_id") @db.Uuid
  type           String  // 'RETENTION' | 'PERCEPTION'
  tax            WithholdingTaxType  // IVA, GANANCIAS, IIBB, SUSS
  jurisdiction   String? // Provincia (para IIBB)
  regimeCode     String? @map("regime_code") // Código del régimen SIRE/SIRCAR
  accountId      String  @map("account_id") @db.Uuid
  baseCalculation String @map("base_calculation") // 'NET' | 'TOTAL'
  defaultRate    Decimal @map("default_rate") @db.Decimal(6, 3)
  minimumNotSubject Decimal @default(0) @map("minimum_not_subject") @db.Decimal(12, 2)
  minimumRetention  Decimal @default(0) @map("minimum_retention") @db.Decimal(12, 2)
  isActive       Boolean @default(true) @map("is_active")

  company        Company  @relation(fields: [companyId], references: [id])
  account        Account  @relation(fields: [accountId], references: [id])

  createdAt      DateTime @default(now()) @map("created_at")
  updatedAt      DateTime @updatedAt @map("updated_at")

  @@map("withholding_regimes")
}
```

### 9.2 Padrones de alícuotas

```prisma
model TaxRatePadron {
  id           String  @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  companyId    String  @map("company_id") @db.Uuid
  taxId        String  @map("tax_id") // CUIT del sujeto
  tax          WithholdingTaxType
  jurisdiction String?
  perceptionRate Decimal? @map("perception_rate") @db.Decimal(6, 3)
  retentionRate  Decimal? @map("retention_rate") @db.Decimal(6, 3)
  validFrom    DateTime @map("valid_from")
  validTo      DateTime @map("valid_to")

  company      Company @relation(fields: [companyId], references: [id])

  @@unique([companyId, taxId, tax, jurisdiction, validFrom])
  @@map("tax_rate_padrons")
}
```

### 9.3 Cálculo automático

En la UI de orden de pago, al seleccionar un proveedor:

1. Buscar `WithholdingRegime` activos de la empresa.
2. Para cada régimen, buscar la alícuota en `TaxRatePadron` (por CUIT del proveedor, impuesto, jurisdicción, fecha).
3. Si no hay padrón, usar `defaultRate` del régimen.
4. Calcular base imponible según `baseCalculation`.
5. Aplicar `minimumNotSubject` y `minimumRetention`.
6. Pre-llenar la grilla de retenciones.

El usuario puede ajustar manualmente antes de confirmar.

### 9.4 Generación de certificado de retención (PDF)

Crear template PDF para certificado de retención usando el mismo sistema de templates que ya existe para facturas y recibos.

Datos del certificado:
- Datos del agente de retención (empresa)
- Datos del sujeto retenido (proveedor)
- Régimen, impuesto, jurisdicción
- Fecha, base imponible, alícuota, importe retenido
- Número de certificado (correlativo por régimen)

### 9.5 Importación de padrones

Feature para importar archivos de padrones (ARBA, AGIP, etc.):
- Upload de archivo CSV/TXT con el formato del organismo.
- Parser específico por jurisdicción.
- Upsert en `TaxRatePadron`.

### 9.6 Campos adicionales en `Supplier` y `Contractor`

```prisma
model Supplier {
  // ... existentes ...
  incomeTaxCondition String? @map("income_tax_condition") // Condición ante Ganancias
  iibbCondition      String? @map("iibb_condition")       // Inscripto/Exento/No inscripto
  iibbJurisdiction   String? @map("iibb_jurisdiction")    // Jurisdicción principal IIBB
}
```

### Archivos a modificar

| Archivo | Cambio |
|---|---|
| `prisma/schema.prisma` | Modelos `WithholdingRegime`, `TaxRatePadron`. Campos en `Supplier`. |
| `src/modules/accounting/features/withholding-regimes/` | **Nuevo** — CRUD de regímenes. |
| `src/modules/accounting/features/tax-padrons/` | **Nuevo** — Importación de padrones. |
| `src/modules/commercial/features/treasury/features/payment-orders/` | Cálculo automático de retenciones. |
| `src/modules/commercial/features/treasury/features/receipts/` | Pre-llenado de retenciones sufridas (si corresponde). |
| Shared PDF templates | Template de certificado de retención. |

### Criterio de aceptación

- [ ] Al crear una OP, las retenciones se pre-calculan según padrones/regímenes.
- [ ] El usuario puede ajustar las retenciones manualmente.
- [ ] Se genera PDF de certificado de retención con número correlativo.
- [ ] Se pueden importar padrones ARBA/AGIP desde archivo.
- [ ] Reporte de retenciones a depositar por régimen y período.

---

## Bloque 10 — Multi-moneda

`[ESTADO: PENDIENTE]`

**Problema**: No hay soporte de moneda extranjera en asientos. Las facturas en USD se contabilizan sin tipo de cambio ni diferencia de cambio.

### 10.1 Campos en `JournalEntryLine`

```prisma
model JournalEntryLine {
  // ... existentes ...
  currency      String  @default("ARS") @db.Char(3)
  originalAmount Decimal? @map("original_amount") @db.Decimal(18, 2) // importe en moneda origen
  exchangeRate  Decimal? @map("exchange_rate") @db.Decimal(18, 6) // tipo de cambio
}
```

Las columnas `debit` y `credit` SIEMPRE se expresan en moneda funcional (ARS). `originalAmount` y `exchangeRate` son informativos para trazabilidad.

### 10.2 Campo en `Account`

```prisma
model Account {
  // ... existentes ...
  currency String @default("ARS") @db.Char(3) // moneda nativa de la cuenta
}
```

### 10.3 Tabla de tipos de cambio

```prisma
model ExchangeRate {
  id       String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  companyId String  @map("company_id") @db.Uuid
  currency String   @db.Char(3) // 'USD', 'EUR', etc.
  date     DateTime
  buyRate  Decimal  @map("buy_rate") @db.Decimal(18, 6)
  sellRate Decimal  @map("sell_rate") @db.Decimal(18, 6)
  source   String?  // 'BNA', 'BCRA', 'MANUAL'

  company  Company @relation(fields: [companyId], references: [id])

  @@unique([companyId, currency, date])
  @@map("exchange_rates")
}
```

### 10.4 Puente contable

Cuando una factura tiene `currency != 'ARS'`:

1. Obtener tipo de cambio del día (de `ExchangeRate` o manual).
2. Convertir todos los importes a ARS para las líneas del asiento.
3. Guardar `originalAmount` y `exchangeRate` en cada línea.

### 10.5 Diferencia de cambio

Proceso periódico (mensual): para cada cuenta en moneda extranjera con saldo, recalcular al tipo de cambio de cierre del período. La diferencia genera un asiento:

- Diferencia positiva (ganancia): D: Cuenta en ME / H: Diferencia de cambio (ingreso).
- Diferencia negativa (pérdida): D: Diferencia de cambio (gasto) / H: Cuenta en ME.

### Archivos a modificar

| Archivo | Cambio |
|---|---|
| `prisma/schema.prisma` | Campos en `JournalEntryLine`, `Account`, modelo `ExchangeRate`. |
| `src/modules/accounting/features/exchange-rates/` | **Nuevo** — CRUD de tipos de cambio, importación desde BCRA. |
| `src/modules/accounting/features/integrations/commercial/index.ts` | Conversión a ARS con tipo de cambio. |
| `src/modules/accounting/features/exchange-diff/` | **Nuevo** — Proceso de diferencia de cambio mensual. |

### Criterio de aceptación

- [ ] Factura en USD genera asiento en ARS con tipo de cambio registrado.
- [ ] `originalAmount` y `exchangeRate` se persisten en cada línea del asiento.
- [ ] Proceso de diferencia de cambio genera asientos correctos.
- [ ] Reportes muestran importes en moneda funcional (ARS).

---

## Bloque 11 — Puente contable: cruces faltantes

`[ESTADO: PENDIENTE]`

**Depende de**: Bloques 1-4 (modelo de períodos, auxiliares, IVA por alícuota).

### 11.1 CMV — Costo de Mercadería Vendida

Al confirmar una factura de venta con productos que tienen `trackStock = true`:

```
Debe: CMV (Costo de Mercadería Vendida)     → costPrice × quantity
Haber: Mercadería de Reventa                → costPrice × quantity
```

Nuevas cuentas en `AccountingSettings`:

```prisma
cogsAccountId       String? @map("cogs_account_id") @db.Uuid        // CMV
inventoryAccountId  String? @map("inventory_account_id") @db.Uuid   // Mercadería
```

Vincular el `StockMovement` al asiento generado.

### 11.2 Transferencia bancaria

Al crear un `BankMovement` de tipo `TRANSFER_OUT`:

```
Debe: Banco destino
Haber: Banco origen
```

Usar `bankAccount.accountId` de cada banco involucrado.

### 11.3 Cheques — Circuito contable

Asientos según transición de estado del cheque:

| Transición | Asiento |
|---|---|
| Cheque tercero recibido (PORTFOLIO) | D: Valores a depositar / H: (ya incluido en el recibo) |
| Cheque depositado | D: Banco / H: Valores a depositar |
| Cheque rechazado | D: Deudores por cheques rechazados / H: Banco |
| Cheque propio emitido | D: (ya incluido en la OP) / H: Banco (al clearing) |

Nuevas cuentas en `AccountingSettings`:

```prisma
checksReceivedAccountId  String? @map("checks_received_account_id") @db.Uuid   // Valores a depositar
checksRejectedAccountId  String? @map("checks_rejected_account_id") @db.Uuid   // Deudores por cheques rechazados
```

### 11.4 Liquidación IVA (DDJJ mensual)

Asiento al liquidar IVA del mes:

```
Si IVA Débito > IVA Crédito (saldo a pagar):
  Debe: IVA Débito Fiscal          → totalDebito
  Haber: IVA Crédito Fiscal        → totalCredito
  Haber: IVA a Pagar               → diferencia

Si IVA Crédito > IVA Débito (saldo a favor):
  Debe: IVA Débito Fiscal          → totalDebito
  Debe: IVA Saldo a Favor          → diferencia
  Haber: IVA Crédito Fiscal        → totalCredito
```

Nueva cuenta en settings:

```prisma
vatPayableAccountId   String? @map("vat_payable_account_id") @db.Uuid     // IVA a Pagar
vatBalanceAccountId   String? @map("vat_balance_account_id") @db.Uuid     // IVA Saldo a Favor
```

### Archivos a modificar

| Archivo | Cambio |
|---|---|
| `prisma/schema.prisma` | Nuevas cuentas en `AccountingSettings`. |
| `src/modules/accounting/features/integrations/commercial/index.ts` | CMV al confirmar factura de venta con stock. |
| `src/modules/accounting/features/integrations/treasury/` | **Nuevo** — Transferencias, cheques. |
| `src/modules/accounting/features/vat-settlement/` | **Nuevo** — Liquidación IVA con asiento. |
| `src/modules/accounting/features/settings/` | UI para las nuevas cuentas. |

### Criterio de aceptación

- [ ] Venta con productos de stock genera asiento de CMV automático.
- [ ] Transferencia bancaria genera asiento D: Banco destino / H: Banco origen.
- [ ] Depósito de cheque de tercero genera asiento.
- [ ] Liquidación IVA genera asiento de cierre de IVA del mes.

---

## Bloque 12 — Integración ARCA (WSAA + WSFEv1)

`[ESTADO: PENDIENTE]`

### 12.1 Modelo de credenciales

```prisma
model ArcaCredential {
  id          String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  companyId   String   @map("company_id") @db.Uuid
  cuit        String   @db.VarChar(13)
  certificate Bytes    // .crt (cifrado en reposo)
  privateKey  Bytes    @map("private_key") // .key (cifrado en reposo)
  environment String   @default("HOMOLOGACION") // HOMOLOGACION | PRODUCCION
  // Cache WSAA:
  token       String?  @db.Text
  sign        String?  @db.Text
  tokenExpiry DateTime? @map("token_expiry")

  company     Company  @relation(fields: [companyId], references: [id])

  createdAt   DateTime @default(now()) @map("created_at")
  updatedAt   DateTime @updatedAt @map("updated_at")

  @@unique([companyId, environment])
  @@map("arca_credentials")
}

model ArcaRequest {
  id            String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  companyId     String   @map("company_id") @db.Uuid
  invoiceId     String?  @map("invoice_id") @db.Uuid
  service       String   @db.VarChar(15) // 'WSFEv1' | 'WSFEX'
  method        String   @db.VarChar(30) // 'FECAESolicitar', etc.
  request       Json
  response      Json?
  cae           String?  @db.VarChar(14)
  result        String?  @db.Char(1)     // 'A' aprobado / 'R' rechazado
  observations  String?  @db.Text

  company       Company @relation(fields: [companyId], references: [id])

  createdAt     DateTime @default(now()) @map("created_at")

  @@map("arca_requests")
}
```

### 12.2 Servicios ARCA

```
src/modules/commercial/features/arca/
├── services/
│   ├── wsaa.server.ts           — Autenticación (Login Ticket Request, Token/Sign)
│   ├── wsfe.server.ts           — WSFEv1 (mercado interno): FECAESolicitar, FECompUltimoAutorizado
│   ├── wsfex.server.ts          — WSFEX (exportación)
│   └── utils.ts                 — Helpers XML/SOAP
├── features/
│   ├── credentials/             — CRUD de certificados ARCA
│   └── requests/                — Log de solicitudes (auditoría)
├── actions.server.ts            — requestCAE(invoiceId), getLastAuthorizedNumber(ptoVta, tipo)
└── index.ts
```

### 12.3 Flujo de facturación electrónica

1. El usuario confirma la factura (status → CONFIRMED).
2. Si `pointOfSale.afipEnabled = true`:
   a. Obtener/cachear Token+Sign del WSAA.
   b. Llamar `FECompUltimoAutorizado` para verificar correlatividad.
   c. Llamar `FECAESolicitar` con los datos de la factura.
   d. Si aprobado: guardar `cae` y `caeExpiryDate` en la factura.
   e. Si rechazado: guardar observaciones y mostrar error al usuario.
   f. Guardar log en `ArcaRequest`.
3. Generar PDF con QR (código AFIP).

### 12.4 Seguridad

- Los certificados y claves privadas se almacenan cifrados (AES-256).
- Solo usuarios con permiso `company.arca` pueden gestionar credenciales.
- Las claves nunca se exponen al frontend; todo se procesa server-side.

### Criterio de aceptación

- [ ] Se pueden cargar certificado y clave privada por empresa/ambiente.
- [ ] Se obtiene CAE en ambiente de homologación.
- [ ] La correlatividad se respeta (consulta último autorizado antes de solicitar).
- [ ] Se genera PDF con QR válido.
- [ ] Todas las solicitudes quedan logueadas en `ArcaRequest`.

---

## Bloque 13 — Libro IVA Digital y archivos fiscales

`[ESTADO: PENDIENTE]`

**Depende de**: Bloques 4 y 5 (IVA por alícuota, percepciones discriminadas).

### 13.1 Libro IVA Digital (ARCA)

Generador de archivos TXT con el layout vigente para importar en el servicio "Mis Comprobantes" / "Libro IVA Digital" de ARCA.

Archivos a generar:
- **Ventas CABECERA**: un registro por comprobante (tipo, PV, número, fecha, CUIT, neto, exento, no gravado, IVA por alícuota, percepciones, total).
- **Ventas ALICUOTAS**: un registro por alícuota por comprobante.
- **Compras CABECERA**: idem ventas.
- **Compras ALICUOTAS**: idem.

### 13.2 SIRE (Retenciones y Percepciones)

Generador de archivos para el régimen SIRE (ex SICORE) de retenciones nacionales (IVA y Ganancias).

### 13.3 Archivos provinciales IIBB

Generadores para SIRCAR (regímenes de retención/percepción IIBB provinciales) y padrones específicos (ARBA, AGIP, etc.).

### Archivos a crear

```
src/modules/commercial/features/fiscal-exports/
├── libro-iva-digital/
│   ├── actions.server.ts        — generateLibroIVADigital(companyId, year, month)
│   ├── formatters.ts            — Formato TXT según layout ARCA
│   └── types.ts
├── sire/
│   ├── actions.server.ts        — generateSIREFile(companyId, year, month)
│   └── formatters.ts
├── iibb/
│   ├── actions.server.ts
│   └── formatters.ts
└── FiscalExports.tsx             — UI con selección de período y botón de descarga por tipo
```

### Criterio de aceptación

- [ ] Generación de archivo Libro IVA Digital que se importa exitosamente en el servicio de ARCA.
- [ ] Generación de archivo SIRE con retenciones practicadas.
- [ ] Los archivos concilian con los reportes de Libro IVA y retenciones del sistema.

---

## Bloque 14 — Ajuste por inflación (RECPAM)

`[ESTADO: PENDIENTE]`

**Depende de**: Bloques 1 y 2 (ejercicios/períodos, campo `adjustableByInflation` en cuentas).

### 14.1 Campo en `Account`

```prisma
model Account {
  // ... existentes ...
  adjustableByInflation Boolean @default(false) @map("adjustable_by_inflation")
}
```

Las cuentas monetarias (caja, bancos, créditos, deudas en pesos) NO se ajustan.
Las cuentas no monetarias (bienes de uso, capital, resultados) SÍ se ajustan.

### 14.2 Tabla de índices de precios

```prisma
model InflationIndex {
  id    String  @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  year  Int
  month Int
  index Decimal @db.Decimal(18, 6) // IPC según INDEC

  @@unique([year, month])
  @@map("inflation_indices")
}
```

### 14.3 Proceso de ajuste

Para cada cuenta con `adjustableByInflation = true`:

1. Obtener saldo al inicio del período.
2. Reexpresar al IPC de cierre: `saldoAjustado = saldo × (IPCcierre / IPCorigen)`.
3. `RECPAM = saldoAjustado - saldoContable`.
4. Generar asiento: D/H cuenta × D/H RECPAM (según signo).

### 14.4 Cuenta RECPAM en settings

```prisma
model AccountingSettings {
  // ... existentes ...
  recpamAccountId String? @map("recpam_account_id") @db.Uuid // Resultado por exposición a la inflación
}
```

### Archivos a crear

```
src/modules/accounting/features/inflation-adjustment/
├── actions.server.ts     — calculateRECPAM(companyId, year, month), generateAdjustmentEntry()
├── InflationAdjustment.tsx
├── components/
│   ├── _InflationIndicesTable.tsx
│   └── _AdjustmentPreview.tsx
└── index.ts
```

### Criterio de aceptación

- [ ] Se pueden cargar índices IPC mensuales.
- [ ] El proceso calcula RECPAM por cuenta ajustable.
- [ ] Se genera asiento de ajuste balanceado.
- [ ] El Balance reexpresado refleja los ajustes.

---

## Dependencias entre bloques

```
Bloque 0 (Constraints DB)           ← Independiente, hacer PRIMERO
    │
    ├── Bloque 3 (Numeración)       ← Independiente, hacer junto con B0
    │
    ├── Bloque 6 (Puente: bugs)     ← Independiente, hacer junto con B0
    │
Bloque 1 (Ejercicio/Período)        ← Base para B7, B8
    │
    ├── Bloque 2 (Imputable + Aux)  ← Puede hacerse en paralelo con B1
    │       │
    │       └── Bloque 11 (Cruces)  ← Depende de B2, B4
    │
    ├── Bloque 7 (Cierre completo)  ← Depende de B1
    │       │
    │       └── Bloque 14 (RECPAM)  ← Depende de B1, B2, B7
    │
Bloque 4 (IVA por alícuota)         ← Puede arrancar en paralelo con B1
    │
    ├── Bloque 5 (Percepciones)     ← Depende de B4
    │       │
    │       ├── Bloque 9 (Ret. auto)← Depende parcialmente de B5
    │       │
    │       └── Bloque 13 (LID/SIRE)← Depende de B4, B5, B9
    │
    └── Bloque 8 (Reportes)         ← Depende de B4 (conciliación IVA)
    │
Bloque 10 (Multi-moneda)            ← Independiente, baja prioridad
    │
Bloque 12 (ARCA/WSFE)               ← Independiente, alta prioridad de negocio
```

### Orden recomendado de ejecución

| Prioridad | Bloques | Justificación |
|---|---|---|
| **Sprint 1** | B0, B3, B6 | Correcciones de seguridad y bugs críticos. No agregan features, solo estabilizan. |
| **Sprint 2** | B1, B2 | Fundaciones: ejercicios/períodos y cuentas imputables. Todo lo posterior depende de esto. |
| **Sprint 3** | B4, B5 | IVA discriminado y percepciones. Necesarios para cumplimiento fiscal. |
| **Sprint 4** | B7, B8 | Cierre completo y reportes corregidos. Aprovechan los modelos de Sprint 2. |
| **Sprint 5** | B9, B11 | Retenciones automáticas y cruces faltantes (CMV, cheques, transferencias, liquidación IVA). |
| **Sprint 6** | B12 | Integración ARCA. Alto valor de negocio, independiente de los anteriores. |
| **Sprint 7** | B13 | Archivos fiscales. Depende de B4, B5, B9. |
| **Sprint 8** | B10, B14 | Multi-moneda y RECPAM. Baja urgencia, alta complejidad. |

---

## Convenciones para la implementación

- **Migraciones**: Una migración por bloque, nombrada `YYYYMMDD_bloque_N_descripcion`.
- **Backward compatibility**: Los campos nuevos en modelos existentes deben ser nullable o tener default. Migración de datos en la misma migración SQL.
- **Tests**: Cada bloque debe incluir tests E2E en `cypress/e2e/accounting/`.
- **Permisos**: Nuevas features requieren registrar permisos en `src/shared/lib/permissions/constants.ts`.
- **Docs**: Actualizar `docs/contable/` y la guía de usuario al completar cada bloque.

---

*Última actualización: 2026-06-24*
*Referencia: `docs/contable/guia-implementacion-contable-erp.md`*
