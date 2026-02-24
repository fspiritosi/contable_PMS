# Plan: Depreciación de Equipos e Integración Contable

**Fecha:** 2026-02-24
**Estado:** Pendiente de aprobación
**Módulos afectados:** Equipment, Accounting, Company (Settings)

---

## Objetivo

Incorporar al módulo de Equipos:
1. **Depreciación automática** - Cálculo y programación de depreciación por equipo
2. **Integración contable** - Generación automática de asientos contables para depreciación, alta, baja y ajuste de valor de equipos

---

## Contexto Técnico

### Lo que ya existe
- **Vehicle** tiene campos `price` (valor del equipo) y `currency`
- **AccountingSettings** tiene patrón de cuentas por defecto (ventas, compras, etc.)
- **Integración comercial** (`accounting/features/integrations/commercial/index.ts`) genera asientos automáticos dentro de transacciones Prisma
- **RecurringEntry** existe pero es genérico (no está vinculado a equipos individuales)
- **JournalEntry** soporta estados DRAFT → POSTED → REVERSED

### Lo que falta
- Modelo de depreciación por equipo (método, vida útil, valor residual, schedule)
- Cuentas contables para activos fijos en AccountingSettings
- Integración contable para equipos (similar a `integrations/commercial/`)
- UI para configurar depreciación y ver schedule

---

## Fase 1: Modelo de Datos (Prisma Schema)

### 1.1 Nuevos campos en AccountingSettings

Agregar cuentas contables para activos fijos:

```prisma
// En AccountingSettings, agregar:
fixedAssetAccountId               String? @map("fixed_asset_account_id") @db.Uuid
accumulatedDepreciationAccountId  String? @map("accumulated_depreciation_account_id") @db.Uuid
depreciationExpenseAccountId      String? @map("depreciation_expense_account_id") @db.Uuid
assetDisposalGainLossAccountId    String? @map("asset_disposal_gain_loss_account_id") @db.Uuid

// + relaciones con Account
fixedAssetAccount              Account? @relation("FixedAssetAccount", ...)
accumulatedDepreciationAccount Account? @relation("AccumulatedDepreciationAccount", ...)
depreciationExpenseAccount     Account? @relation("DepreciationExpenseAccount", ...)
assetDisposalGainLossAccount   Account? @relation("AssetDisposalGainLossAccount", ...)
```

**Cuentas necesarias:**
| Campo | Tipo Cuenta | Naturaleza | Descripción |
|-------|-------------|------------|-------------|
| fixedAssetAccount | ASSET | DEBIT | Cuenta de Bienes de Uso (donde se registra el activo) |
| accumulatedDepreciationAccount | ASSET | CREDIT | Depreciación Acumulada (contra-activo) |
| depreciationExpenseAccount | EXPENSE | DEBIT | Gasto de Depreciación (resultado) |
| assetDisposalGainLossAccount | REVENUE/EXPENSE | DEBIT | Resultado por venta/baja de bienes de uso |

### 1.2 Nuevo enum: DepreciationMethod

```prisma
enum DepreciationMethod {
  STRAIGHT_LINE      // Línea recta (más común en Argentina)
  DECLINING_BALANCE  // Saldo decreciente
  @@map("depreciation_method")
}
```

### 1.3 Nuevo enum: DepreciationStatus

```prisma
enum DepreciationStatus {
  ACTIVE       // Depreciación en curso
  COMPLETED    // Vida útil agotada
  SUSPENDED    // Suspendida (equipo en reparación, inactivo)
  @@map("depreciation_status")
}
```

### 1.4 Nuevo modelo: VehicleDepreciation

Configuración de depreciación por equipo:

```prisma
model VehicleDepreciation {
  id                  String              @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid

  vehicleId           String              @unique @map("vehicle_id") @db.Uuid
  vehicle             Vehicle             @relation(fields: [vehicleId], references: [id], onDelete: Cascade)

  method              DepreciationMethod  @default(STRAIGHT_LINE)
  status              DepreciationStatus  @default(ACTIVE)

  // Valores
  grossValue          Decimal             @map("gross_value") @db.Decimal(15, 2)       // Valor de origen (puede diferir de price)
  salvageValue        Decimal             @default(0) @map("salvage_value") @db.Decimal(15, 2) // Valor residual
  currentBookValue    Decimal             @map("current_book_value") @db.Decimal(15, 2) // Valor libro actual (calculado)

  // Vida útil
  usefulLifeMonths    Int                 @map("useful_life_months")    // Vida útil en meses
  startDate           DateTime            @map("start_date")            // Fecha inicio depreciación
  endDate             DateTime?           @map("end_date")              // Fecha fin estimada (calculada)

  // Para saldo decreciente
  depreciationRate    Decimal?            @map("depreciation_rate") @db.Decimal(5, 2)  // Tasa anual %

  // Tracking
  totalDepreciated    Decimal             @default(0) @map("total_depreciated") @db.Decimal(15, 2)
  lastDepreciationDate DateTime?          @map("last_depreciation_date")

  // Auditoría
  companyId           String              @map("company_id") @db.Uuid
  company             Company             @relation(fields: [companyId], references: [id], onDelete: Cascade)
  createdBy           String              @map("created_by")
  createdAt           DateTime            @default(now()) @map("created_at")
  updatedAt           DateTime            @updatedAt @map("updated_at")

  // Relaciones
  scheduleEntries     DepreciationScheduleEntry[]

  @@map("vehicle_depreciations")
}
```

### 1.5 Nuevo modelo: DepreciationScheduleEntry

Schedule de depreciación (una fila por período):

```prisma
model DepreciationScheduleEntry {
  id                    String               @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid

  depreciationId        String               @map("depreciation_id") @db.Uuid
  depreciation          VehicleDepreciation   @relation(fields: [depreciationId], references: [id], onDelete: Cascade)

  periodNumber          Int                  @map("period_number")        // Nº de período (1, 2, 3...)
  scheduledDate         DateTime             @map("scheduled_date")       // Fecha programada
  amount                Decimal              @map("amount") @db.Decimal(15, 2) // Monto de depreciación del período
  accumulatedAmount     Decimal              @map("accumulated_amount") @db.Decimal(15, 2) // Acumulado hasta este período
  bookValueAfter        Decimal              @map("book_value_after") @db.Decimal(15, 2)   // Valor libro después

  // Contabilización
  isPosted              Boolean              @default(false) @map("is_posted")
  journalEntryId        String?              @map("journal_entry_id") @db.Uuid
  journalEntry          JournalEntry?        @relation(fields: [journalEntryId], references: [id])
  postedDate            DateTime?            @map("posted_date")
  postedBy              String?              @map("posted_by")

  createdAt             DateTime             @default(now()) @map("created_at")
  updatedAt             DateTime             @updatedAt @map("updated_at")

  @@unique([depreciationId, periodNumber])
  @@map("depreciation_schedule_entries")
}
```

### 1.6 Nuevo modelo: AssetValueAdjustment

Para revaluaciones y deterioros:

```prisma
model AssetValueAdjustment {
  id                String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid

  vehicleId         String    @map("vehicle_id") @db.Uuid
  vehicle           Vehicle   @relation(fields: [vehicleId], references: [id], onDelete: Cascade)

  date              DateTime
  previousValue     Decimal   @map("previous_value") @db.Decimal(15, 2)
  newValue          Decimal   @map("new_value") @db.Decimal(15, 2)
  differenceAmount  Decimal   @map("difference_amount") @db.Decimal(15, 2)
  reason            String    // Motivo del ajuste

  // Contabilización
  journalEntryId    String?   @map("journal_entry_id") @db.Uuid
  journalEntry      JournalEntry? @relation(fields: [journalEntryId], references: [id])

  companyId         String    @map("company_id") @db.Uuid
  company           Company   @relation(fields: [companyId], references: [id], onDelete: Cascade)
  createdBy         String    @map("created_by")
  createdAt         DateTime  @default(now()) @map("created_at")

  @@map("asset_value_adjustments")
}
```

### 1.7 Agregar relaciones inversas en Vehicle

```prisma
// En el modelo Vehicle, agregar:
depreciation       VehicleDepreciation?
valueAdjustments   AssetValueAdjustment[]
```

### 1.8 Agregar relación inversa en JournalEntry

```prisma
// En JournalEntry, agregar:
depreciationEntries  DepreciationScheduleEntry[]
valueAdjustments     AssetValueAdjustment[]
```

**Archivos a modificar:**
- `prisma/schema.prisma`

**Comando después:** `npm run db:generate && npm run db:push` (o migración)

---

## Fase 2: Lógica de Cálculo de Depreciación

### 2.1 Utilidades de cálculo

**Nuevo archivo:** `src/modules/equipment/features/depreciation/lib/calculations.ts`

Funciones puras de cálculo:

```typescript
// Línea recta: (grossValue - salvageValue) / usefulLifeMonths
calculateStraightLineMonthly(grossValue, salvageValue, usefulLifeMonths): number

// Saldo decreciente: bookValue * (rate / 12)
calculateDecliningBalanceMonthly(currentBookValue, annualRate): number

// Generar schedule completo
generateDepreciationSchedule(config: {
  method, grossValue, salvageValue, usefulLifeMonths, startDate, depreciationRate?
}): ScheduleEntry[]

// Recalcular schedule desde un punto (para ajustes de valor)
recalculateScheduleFromPeriod(schedule, fromPeriod, newBookValue, salvageValue, remainingMonths): ScheduleEntry[]
```

### 2.2 Validadores

**Nuevo archivo:** `src/modules/equipment/features/depreciation/validators.ts`

Schemas Zod para:
- Configuración de depreciación (grossValue > 0, usefulLifeMonths > 0, salvageValue < grossValue, etc.)
- Ajuste de valor (newValue > 0, reason requerido)

---

## Fase 3: Server Actions de Depreciación

### 3.1 CRUD de Depreciación

**Nuevo archivo:** `src/modules/equipment/features/depreciation/actions.server.ts`

```typescript
// Configurar depreciación para un equipo
createVehicleDepreciation(vehicleId, input): Promise<VehicleDepreciation>
  - Valida que el equipo no tenga ya depreciación configurada
  - Calcula endDate = startDate + usefulLifeMonths
  - Genera schedule completo (DepreciationScheduleEntry[])
  - Crea todo dentro de una transacción
  - Si cuentas contables configuradas, genera asiento de alta del activo

// Obtener depreciación de un equipo
getVehicleDepreciation(vehicleId): Promise<VehicleDepreciation & schedule>

// Actualizar configuración (solo si no hay períodos contabilizados)
updateVehicleDepreciation(depreciationId, input): Promise<VehicleDepreciation>
  - Solo permite cambios si no hay entries posted
  - Regenera schedule

// Suspender/Reactivar depreciación
toggleDepreciationStatus(depreciationId, status): Promise<void>

// Eliminar depreciación (solo si no hay entries posted)
deleteVehicleDepreciation(depreciationId): Promise<void>
```

### 3.2 Contabilización de Períodos

**Mismo archivo o separado:** `actions.server.ts`

```typescript
// Contabilizar un período individual
postDepreciationEntry(scheduleEntryId): Promise<JournalEntry>
  - Valida que el período anterior esté contabilizado (secuencial)
  - Crea asiento contable:
    Debe: Gasto de Depreciación
    Haber: Depreciación Acumulada
  - Marca el scheduleEntry como isPosted = true
  - Actualiza currentBookValue y totalDepreciated en VehicleDepreciation

// Contabilizar todos los períodos pendientes hasta una fecha
postAllPendingDepreciations(companyId, upToDate): Promise<{ posted: number, errors: string[] }>
  - Busca todos los scheduleEntries no posted con scheduledDate <= upToDate
  - Los contabiliza en orden cronológico
  - Retorna resumen
```

### 3.3 Ajuste de Valor

```typescript
// Crear ajuste de valor
createValueAdjustment(vehicleId, input: { date, newValue, reason }): Promise<AssetValueAdjustment>
  - Registra el ajuste
  - Crea asiento contable:
    Si aumento: Debe: Bien de Uso, Haber: Resultado
    Si disminución: Debe: Resultado, Haber: Dep. Acumulada
  - Recalcula schedule de depreciación restante desde la fecha del ajuste
  - Actualiza currentBookValue
```

---

## Fase 4: Integración Contable

### 4.1 Módulo de integración

**Nuevo archivo:** `src/modules/accounting/features/integrations/equipment/index.ts`

Siguiendo el mismo patrón que `integrations/commercial/index.ts`:

```typescript
// Asiento de alta de activo fijo
createJournalEntryForAssetCapitalization(vehicleId, companyId, tx?)
  // Debe: Bienes de Uso (fixedAssetAccount)
  // Haber: Cuentas por Pagar o contrapartida configurable
  // Descripción: "Alta de activo fijo: [internNumber] [brand] [model]"

// Asiento de depreciación periódica
createJournalEntryForDepreciation(scheduleEntryId, companyId, tx?)
  // Debe: Gasto de Depreciación (depreciationExpenseAccount)
  // Haber: Depreciación Acumulada (accumulatedDepreciationAccount)
  // Descripción: "Depreciación [mes/año]: [internNumber] [brand] [model]"

// Asiento de baja por venta
createJournalEntryForAssetSale(vehicleId, saleAmount, companyId, tx?)
  // 1. Reversar activo:
  //    Debe: Depreciación Acumulada (total acumulado)
  //    Debe: Resultado venta bienes de uso (si pérdida)
  //    Haber: Bienes de Uso (valor bruto)
  //    Haber: Resultado venta bienes de uso (si ganancia)
  // 2. Registrar ingreso por venta (se haría vía factura de venta)

// Asiento de baja por pérdida total / devolución
createJournalEntryForAssetDisposal(vehicleId, companyId, tx?)
  // Debe: Depreciación Acumulada
  // Debe: Resultado por baja de bienes de uso (valor libro restante)
  // Haber: Bienes de Uso (valor bruto)

// Asiento de ajuste de valor
createJournalEntryForValueAdjustment(adjustmentId, companyId, tx?)
  // Según el signo del ajuste
```

### 4.2 Hookear baja de equipo

Modificar el flujo de baja de equipo existente (`equipment/features/edit/actions.server.ts` o donde se maneje la terminación) para:
- Si `terminationReason === SALE`: llamar `createJournalEntryForAssetSale`
- Si `terminationReason === TOTAL_LOSS` o `RETURN`: llamar `createJournalEntryForAssetDisposal`
- Marcar depreciación como `status = COMPLETED`
- Solo generar asientos si las cuentas están configuradas (degradación graceful)

---

## Fase 5: UI - Configuración Contable

### 5.1 Ampliar AccountingSettings

**Modificar:** `src/modules/accounting/features/settings/`

Agregar sección "Cuentas de Activos Fijos" al formulario de settings:
- Cuenta de Bienes de Uso
- Cuenta de Depreciación Acumulada
- Cuenta de Gasto de Depreciación
- Cuenta de Resultado por Venta/Baja

Seguir el mismo patrón del formulario existente (`_AccountingSettingsForm.tsx` y `_CommercialIntegrationForm.tsx`).

**Archivos a modificar:**
- `accounting/features/settings/actions.server.ts` - Agregar campos al save
- `accounting/features/settings/components/` - Nuevo form o sección

---

## Fase 6: UI - Depreciación en Detalle de Equipo

### 6.1 Nueva tab "Depreciación" en el detalle

**Modificar:** `src/modules/equipment/features/detail/`

Agregar tab "Depreciación" al `_EquipmentDetailTabs.tsx` que muestre:

**Si no tiene depreciación configurada:**
- Botón "Configurar Depreciación" → abre dialog

**Si tiene depreciación configurada:**
- **Resumen**: Valor bruto, valor residual, valor libro actual, % depreciado, método, vida útil
- **Barra de progreso visual**: % de vida útil consumida
- **Schedule (DataTable)**:
  - Columnas: Período, Fecha, Monto, Acumulado, Valor Libro, Estado (Pendiente/Contabilizado), Asiento
  - Acción: "Contabilizar" por período (si es el siguiente pendiente)
- **Botones de acción**:
  - "Contabilizar períodos pendientes" (bulk)
  - "Ajustar valor" → abre dialog
  - "Suspender/Reactivar"
  - "Eliminar configuración" (solo si nada contabilizado)

### 6.2 Dialog de configuración de depreciación

**Nuevo:** `src/modules/equipment/features/depreciation/components/_DepreciationConfigDialog.tsx`

Campos del formulario:
- Método (select: Línea Recta / Saldo Decreciente)
- Valor de Origen (pre-poblado con `price` del equipo)
- Valor Residual
- Vida Útil (meses) - con helper que muestre años
- Fecha de Inicio
- Tasa de Depreciación % (solo visible para Saldo Decreciente)

Preview: Mostrar tabla resumen del schedule antes de confirmar.

### 6.3 Dialog de ajuste de valor

**Nuevo:** `src/modules/equipment/features/depreciation/components/_ValueAdjustmentDialog.tsx`

Campos:
- Fecha del ajuste
- Valor actual (readonly)
- Nuevo valor
- Diferencia (calculada)
- Motivo

---

## Fase 7: UI - Contabilización Masiva

### 7.1 Acción masiva desde el listado de equipos

Agregar botón "Contabilizar Depreciaciones" en el listado:
- Abre dialog que muestra períodos pendientes hasta la fecha seleccionada
- Preview de cuántos asientos se generarán
- Botón confirmar → ejecuta `postAllPendingDepreciations`

**Nuevo:** `src/modules/equipment/features/list/components/_BulkDepreciationDialog.tsx`

---

## Fase 8: Reportes

### 8.1 Reporte de Bienes de Uso

Agregar al módulo de reportes contables:

**Nuevo reporte:** "Registro de Bienes de Uso"
- Columnas: Equipo, Tipo, Valor Bruto, Dep. Acumulada, Valor Libro, Método, Vida Útil, % Depreciado
- Filtros: Tipo de equipo, Estado de depreciación, Rango de fechas
- Totales por tipo y general

**Nuevo reporte:** "Depreciaciones del Período"
- Detalle de depreciaciones contabilizadas en un rango de fechas
- Columnas: Equipo, Período, Monto, Asiento Contable, Fecha Contabilización

**Archivos a modificar:**
- `accounting/features/reports/actions.server.ts` - Agregar queries
- `accounting/features/reports/components/` - Nuevos componentes de reporte

---

## Fase 9: Tests E2E

### 9.1 Tests nuevos

**Nuevo:** `cypress/e2e/equipment/depreciation.cy.ts`

Tests a cubrir:
1. Configurar cuentas de activos fijos en settings contables
2. Configurar depreciación en un equipo (ambos métodos)
3. Ver schedule generado
4. Contabilizar un período → verificar asiento creado
5. Contabilizar períodos masivamente
6. Ajustar valor → verificar recálculo
7. Suspender/Reactivar depreciación
8. Baja de equipo con depreciación → verificar asiento de baja
9. Verificar reportes de bienes de uso

---

## Fase 10: Documentación

### 10.1 Archivos a actualizar

- `docs/modules/equipment.md` - Sección de depreciación
- `docs/architecture/data-model.md` - Nuevos modelos
- `docs/modules/accounting.md` - Integración con equipos

---

## Dependencias entre Fases

```
Fase 1 (Schema) ──────┬──→ Fase 2 (Cálculos)
                       │
                       ├──→ Fase 3 (Server Actions) ──→ Fase 4 (Integración Contable)
                       │                                        │
                       └──→ Fase 5 (UI Settings)                │
                                                                 │
                            Fase 6 (UI Detail) ←────────────────┘
                                    │
                                    ▼
                            Fase 7 (UI Bulk)
                                    │
                                    ▼
                            Fase 8 (Reportes)
                                    │
                                    ▼
                            Fase 9 (Tests) ──→ Fase 10 (Docs)
```

**Orden de implementación sugerido:**
1. Fase 1 → Fase 2 → Fase 3 → Fase 4 (backend completo)
2. Fase 5 (settings UI)
3. Fase 6 → Fase 7 (equipment UI)
4. Fase 8 (reportes)
5. Fase 9 → Fase 10 (calidad y docs)

---

## Decisiones de Diseño

| Decisión | Elección | Justificación |
|----------|----------|---------------|
| Schedule pre-generado vs. calculado on-the-fly | **Pre-generado** | Permite tracking de contabilización por período, historial, y es más predecible |
| Depreciación mensual fija | **Sí (por defecto)** | Estándar argentino, simplifica cálculos |
| Cuentas por equipo vs. globales | **Globales** (AccountingSettings) | Simplifica configuración; si en el futuro se necesita por categoría, se puede agregar en VehicleType |
| Contabilización automática vs. manual | **Manual con opción bulk** | Más control para el usuario, evita asientos no deseados |
| Modelo separado vs. campos en Vehicle | **Modelo separado** (VehicleDepreciation) | Separación de responsabilidades, no todos los equipos se deprecian |
| Ajuste de valor como modelo separado | **Sí** (AssetValueAdjustment) | Trazabilidad de ajustes, vinculación con asientos |

---

## Estimación de Archivos

| Fase | Archivos nuevos | Archivos modificados |
|------|----------------|---------------------|
| 1. Schema | 0 | 1 (schema.prisma) |
| 2. Cálculos | 1 | 0 |
| 3. Actions | 2 | 0 |
| 4. Integración | 1 | 2 (equipment actions de baja, JournalEntry relations) |
| 5. Settings UI | 0 | 2-3 (settings form/actions) |
| 6. Detail UI | 3-4 | 2 (detail tabs, actions) |
| 7. Bulk UI | 1 | 1 (list components) |
| 8. Reportes | 2 | 1 (reports actions) |
| 9. Tests | 1 | 0 |
| 10. Docs | 0 | 2-3 |
| **Total** | **~12-14** | **~12-15** |
