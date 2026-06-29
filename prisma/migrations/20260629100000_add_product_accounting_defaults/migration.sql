-- Ticket #322: Artículos - Conceptos Contables
-- Agregar campos FK de conceptos contables y logísticos al modelo Product
-- Agregar campos de configuración de código auto en AccountingSettings

-- ============================================
-- 1. Nuevos campos FK en products
-- ============================================

ALTER TABLE "products" ADD COLUMN "default_expense_account_id" UUID;
ALTER TABLE "products" ADD COLUMN "default_income_account_id" UUID;
ALTER TABLE "products" ADD COLUMN "default_cost_center_id" UUID;
ALTER TABLE "products" ADD COLUMN "default_warehouse_id" UUID;
ALTER TABLE "products" ADD COLUMN "default_supplier_id" UUID;

-- ============================================
-- 2. Foreign keys
-- ============================================

ALTER TABLE "products"
    ADD CONSTRAINT "products_default_expense_account_id_fkey"
    FOREIGN KEY ("default_expense_account_id") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "products"
    ADD CONSTRAINT "products_default_income_account_id_fkey"
    FOREIGN KEY ("default_income_account_id") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "products"
    ADD CONSTRAINT "products_default_cost_center_id_fkey"
    FOREIGN KEY ("default_cost_center_id") REFERENCES "cost_centers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "products"
    ADD CONSTRAINT "products_default_warehouse_id_fkey"
    FOREIGN KEY ("default_warehouse_id") REFERENCES "warehouses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "products"
    ADD CONSTRAINT "products_default_supplier_id_fkey"
    FOREIGN KEY ("default_supplier_id") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ============================================
-- 3. Campos de configuración de código de producto en accounting_settings
-- ============================================

ALTER TABLE "accounting_settings" ADD COLUMN "product_code_prefix" TEXT NOT NULL DEFAULT 'PROD';
ALTER TABLE "accounting_settings" ADD COLUMN "last_product_number" INTEGER NOT NULL DEFAULT 0;
