-- Sprint 2: Ejercicios fiscales, períodos contables, campo imputable y auxiliares
-- Bloques 1 + 2 del plan de implementación contable

-- ============================================
-- 1. Nuevos enums
-- ============================================

CREATE TYPE "accounting_period_type" AS ENUM ('MONTHLY', 'OPENING', 'CLOSING', 'ADJUSTMENT');
CREATE TYPE "auxiliary_type" AS ENUM ('CUSTOMER', 'SUPPLIER', 'COST_CENTER');

-- ============================================
-- 2. Tabla fiscal_years (Ejercicios Fiscales)
-- ============================================

CREATE TABLE "fiscal_years" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "start_date" TIMESTAMP(3) NOT NULL,
    "end_date" TIMESTAMP(3) NOT NULL,
    "is_closed" BOOLEAN NOT NULL DEFAULT false,
    "closed_at" TIMESTAMP(3),
    "closed_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fiscal_years_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "fiscal_years_company_id_number_key" ON "fiscal_years"("company_id", "number");

ALTER TABLE "fiscal_years"
    ADD CONSTRAINT "fiscal_years_company_id_fkey"
    FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ============================================
-- 3. Tabla accounting_periods (Períodos Contables)
-- ============================================

CREATE TABLE "accounting_periods" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "fiscal_year_id" UUID NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "type" "accounting_period_type" NOT NULL DEFAULT 'MONTHLY',
    "is_closed" BOOLEAN NOT NULL DEFAULT false,
    "closed_at" TIMESTAMP(3),
    "closed_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "accounting_periods_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "accounting_periods_fiscal_year_id_year_month_type_key"
    ON "accounting_periods"("fiscal_year_id", "year", "month", "type");

ALTER TABLE "accounting_periods"
    ADD CONSTRAINT "accounting_periods_fiscal_year_id_fkey"
    FOREIGN KEY ("fiscal_year_id") REFERENCES "fiscal_years"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ============================================
-- 4. Nuevas columnas en journal_entries
-- ============================================

ALTER TABLE "journal_entries" ADD COLUMN "fiscal_year_id" UUID;
ALTER TABLE "journal_entries" ADD COLUMN "period_id" UUID;

ALTER TABLE "journal_entries"
    ADD CONSTRAINT "journal_entries_fiscal_year_id_fkey"
    FOREIGN KEY ("fiscal_year_id") REFERENCES "fiscal_years"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "journal_entries"
    ADD CONSTRAINT "journal_entries_period_id_fkey"
    FOREIGN KEY ("period_id") REFERENCES "accounting_periods"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ============================================
-- 5. Campo is_leaf y requires_auxiliary en accounts
-- ============================================

ALTER TABLE "accounts" ADD COLUMN "is_leaf" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "accounts" ADD COLUMN "requires_auxiliary" "auxiliary_type";

-- Calcular is_leaf para cuentas existentes
UPDATE "accounts" SET "is_leaf" = false
WHERE "id" IN (SELECT DISTINCT "parent_id" FROM "accounts" WHERE "parent_id" IS NOT NULL);

-- ============================================
-- 6. Auxiliares en journal_entry_lines
-- ============================================

ALTER TABLE "journal_entry_lines" ADD COLUMN "customer_id" UUID;
ALTER TABLE "journal_entry_lines" ADD COLUMN "supplier_id" UUID;
ALTER TABLE "journal_entry_lines" ADD COLUMN "cost_center_id" UUID;

ALTER TABLE "journal_entry_lines"
    ADD CONSTRAINT "journal_entry_lines_customer_id_fkey"
    FOREIGN KEY ("customer_id") REFERENCES "contractors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "journal_entry_lines"
    ADD CONSTRAINT "journal_entry_lines_supplier_id_fkey"
    FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "journal_entry_lines"
    ADD CONSTRAINT "journal_entry_lines_cost_center_id_fkey"
    FOREIGN KEY ("cost_center_id") REFERENCES "cost_centers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ============================================
-- 7. Trigger: mantener is_leaf actualizado
-- ============================================

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

-- ============================================
-- 8. Migración de datos: crear FiscalYear y AccountingPeriod
--    desde AccountingSettings existentes
-- ============================================

-- Crear un FiscalYear por cada empresa que tenga accounting_settings
INSERT INTO "fiscal_years" ("id", "company_id", "number", "start_date", "end_date", "updated_at")
SELECT
  gen_random_uuid(),
  s."company_id",
  1,
  s."fiscal_year_start",
  s."fiscal_year_end",
  NOW()
FROM "accounting_settings" s;

-- Crear 12 períodos MONTHLY + 1 OPENING + 1 CLOSING por cada ejercicio
-- OPENING (month=0) para el asiento de apertura
INSERT INTO "accounting_periods" ("id", "fiscal_year_id", "year", "month", "type", "is_closed", "updated_at")
SELECT
  gen_random_uuid(),
  fy."id",
  EXTRACT(YEAR FROM fy."start_date")::int,
  0,
  'OPENING',
  false,
  NOW()
FROM "fiscal_years" fy;

-- 12 meses MONTHLY
INSERT INTO "accounting_periods" ("id", "fiscal_year_id", "year", "month", "type", "is_closed", "updated_at")
SELECT
  gen_random_uuid(),
  fy."id",
  EXTRACT(YEAR FROM (fy."start_date" + (m.n || ' months')::interval))::int,
  EXTRACT(MONTH FROM (fy."start_date" + (m.n || ' months')::interval))::int,
  'MONTHLY',
  CASE
    WHEN s."locked_until_date" IS NOT NULL
      AND (fy."start_date" + (m.n || ' months')::interval) <= s."locked_until_date"
    THEN true
    ELSE false
  END,
  NOW()
FROM "fiscal_years" fy
JOIN "accounting_settings" s ON s."company_id" = fy."company_id"
CROSS JOIN generate_series(0, 11) AS m(n);

-- CLOSING (month=13) para el asiento de cierre
INSERT INTO "accounting_periods" ("id", "fiscal_year_id", "year", "month", "type", "is_closed", "updated_at")
SELECT
  gen_random_uuid(),
  fy."id",
  EXTRACT(YEAR FROM fy."end_date")::int,
  13,
  'CLOSING',
  false,
  NOW()
FROM "fiscal_years" fy;

-- ============================================
-- 9. Backfill: asignar fiscal_year_id y period_id
--    a journal_entries existentes
-- ============================================

UPDATE "journal_entries" je
SET
  "fiscal_year_id" = fy."id",
  "period_id" = (
    SELECT ap."id"
    FROM "accounting_periods" ap
    WHERE ap."fiscal_year_id" = fy."id"
      AND ap."type" = 'MONTHLY'
      AND ap."year" = EXTRACT(YEAR FROM je."date")::int
      AND ap."month" = EXTRACT(MONTH FROM je."date")::int
    LIMIT 1
  )
FROM "fiscal_years" fy
WHERE fy."company_id" = je."company_id"
  AND je."date" >= fy."start_date"
  AND je."date" <= fy."end_date";
