-- Ticket #376: Cuentas Imputables / No imputables — Fase 1 (Schema + migración no destructiva)
--
-- Objetivo:
--   1) Agregar el corte de deshabilitado por ejercicio en "accounts"
--      (disabled_from + disabled_from_fiscal_year_id -> FK a fiscal_years).
--   2) Backfill de is_leaf según la jerarquía real (una cuenta es hoja si no es padre de nadie).
--
-- Nota: la normalización de "code" al formato x.x.x/xx/xx NO se hace en SQL puro
--       (riesgo de colisión con el unique (company_id, code)). Se ejecuta con el
--       script idempotente prisma/scripts/normalize-account-codes.ts DESPUÉS de aplicar
--       esta migración. Ver ese archivo para instrucciones.
--
-- Migración NO destructiva: solo agrega columnas nullable, una FK con ON DELETE SET NULL,
-- un índice y un UPDATE de backfill sobre is_leaf.

-- ============================================
-- 1. Columnas nuevas (nullable, sin default destructivo)
-- ============================================

ALTER TABLE "accounts" ADD COLUMN "disabled_from" TIMESTAMP(3);
ALTER TABLE "accounts" ADD COLUMN "disabled_from_fiscal_year_id" UUID;

-- ============================================
-- 2. Foreign key hacia fiscal_years
--    ON DELETE SET NULL: si se borra el ejercicio, la cuenta queda sin corte referenciado.
-- ============================================

ALTER TABLE "accounts"
    ADD CONSTRAINT "accounts_disabled_from_fiscal_year_id_fkey"
    FOREIGN KEY ("disabled_from_fiscal_year_id") REFERENCES "fiscal_years"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ============================================
-- 3. Índice para consultas por corte de ejercicio
-- ============================================

CREATE INDEX "accounts_company_id_disabled_from_fiscal_year_id_idx"
    ON "accounts"("company_id", "disabled_from_fiscal_year_id");

-- ============================================
-- 4. Backfill de is_leaf según la jerarquía existente
--    Una cuenta es hoja (imputable) si NO existe ninguna cuenta que la tenga como padre.
-- ============================================

UPDATE "accounts" a
SET "is_leaf" = NOT EXISTS (
    SELECT 1 FROM "accounts" c WHERE c."parent_id" = a."id"
);
