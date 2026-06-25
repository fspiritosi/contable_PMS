-- Sprint 3: IVA discriminado por alícuota + Percepciones en facturas
-- Bloques 4 + 5 del plan de implementación contable

-- ============================================
-- 1. Nuevos enums
-- ============================================

CREATE TYPE "invoice_line_type" AS ENUM ('TAXED', 'NON_TAXED', 'EXEMPT');
CREATE TYPE "perception_type" AS ENUM ('IVA', 'IIBB', 'MUNICIPAL');

-- ============================================
-- 2. Campo line_type en líneas de factura
-- ============================================

ALTER TABLE "sales_invoice_lines" ADD COLUMN "line_type" "invoice_line_type" NOT NULL DEFAULT 'TAXED';
ALTER TABLE "purchase_invoice_lines" ADD COLUMN "line_type" "invoice_line_type" NOT NULL DEFAULT 'TAXED';

-- ============================================
-- 3. Campos net_taxed, net_non_taxed, net_exempt en facturas
-- ============================================

ALTER TABLE "sales_invoices" ADD COLUMN "net_taxed" DECIMAL(12, 2) NOT NULL DEFAULT 0;
ALTER TABLE "sales_invoices" ADD COLUMN "net_non_taxed" DECIMAL(12, 2) NOT NULL DEFAULT 0;
ALTER TABLE "sales_invoices" ADD COLUMN "net_exempt" DECIMAL(12, 2) NOT NULL DEFAULT 0;

ALTER TABLE "purchase_invoices" ADD COLUMN "net_taxed" DECIMAL(12, 2) NOT NULL DEFAULT 0;
ALTER TABLE "purchase_invoices" ADD COLUMN "net_non_taxed" DECIMAL(12, 2) NOT NULL DEFAULT 0;
ALTER TABLE "purchase_invoices" ADD COLUMN "net_exempt" DECIMAL(12, 2) NOT NULL DEFAULT 0;

-- ============================================
-- 4. Migración de datos: line_type para líneas existentes
-- ============================================

-- Líneas con vatRate > 0 son TAXED (ya es el default)
-- Líneas con vatRate = 0: usar heurística de description
UPDATE "purchase_invoice_lines"
SET "line_type" = 'NON_TAXED'
WHERE "vat_rate" = 0 AND LOWER("description") LIKE '%no gravad%';

UPDATE "purchase_invoice_lines"
SET "line_type" = 'EXEMPT'
WHERE "vat_rate" = 0 AND (
  LOWER("description") LIKE '%exent%'
  OR LOWER("description") LIKE '%exempt%'
);

UPDATE "sales_invoice_lines"
SET "line_type" = 'NON_TAXED'
WHERE "vat_rate" = 0 AND LOWER("description") LIKE '%no gravad%';

UPDATE "sales_invoice_lines"
SET "line_type" = 'EXEMPT'
WHERE "vat_rate" = 0 AND (
  LOWER("description") LIKE '%exent%'
  OR LOWER("description") LIKE '%exempt%'
);

-- ============================================
-- 5. Migración de datos: calcular net_taxed/net_non_taxed/net_exempt
--    desde las líneas existentes
-- ============================================

UPDATE "sales_invoices" si SET
  "net_taxed" = COALESCE((
    SELECT SUM(sil."subtotal") FROM "sales_invoice_lines" sil
    WHERE sil."invoice_id" = si."id" AND sil."line_type" = 'TAXED'
  ), 0),
  "net_non_taxed" = COALESCE((
    SELECT SUM(sil."subtotal") FROM "sales_invoice_lines" sil
    WHERE sil."invoice_id" = si."id" AND sil."line_type" = 'NON_TAXED'
  ), 0),
  "net_exempt" = COALESCE((
    SELECT SUM(sil."subtotal") FROM "sales_invoice_lines" sil
    WHERE sil."invoice_id" = si."id" AND sil."line_type" = 'EXEMPT'
  ), 0);

UPDATE "purchase_invoices" pi SET
  "net_taxed" = COALESCE((
    SELECT SUM(pil."subtotal") FROM "purchase_invoice_lines" pil
    WHERE pil."invoice_id" = pi."id" AND pil."line_type" = 'TAXED'
  ), 0),
  "net_non_taxed" = COALESCE((
    SELECT SUM(pil."subtotal") FROM "purchase_invoice_lines" pil
    WHERE pil."invoice_id" = pi."id" AND pil."line_type" = 'NON_TAXED'
  ), 0),
  "net_exempt" = COALESCE((
    SELECT SUM(pil."subtotal") FROM "purchase_invoice_lines" pil
    WHERE pil."invoice_id" = pi."id" AND pil."line_type" = 'EXEMPT'
  ), 0);

-- ============================================
-- 6. Tabla accounting_vat_accounts (mapeo IVA por alícuota)
-- ============================================

CREATE TABLE "accounting_vat_accounts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "settings_id" UUID NOT NULL,
    "vat_rate" DECIMAL(5, 2) NOT NULL,
    "side" TEXT NOT NULL,
    "account_id" UUID NOT NULL,

    CONSTRAINT "accounting_vat_accounts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "accounting_vat_accounts_settings_id_vat_rate_side_key"
    ON "accounting_vat_accounts"("settings_id", "vat_rate", "side");

ALTER TABLE "accounting_vat_accounts"
    ADD CONSTRAINT "accounting_vat_accounts_settings_id_fkey"
    FOREIGN KEY ("settings_id") REFERENCES "accounting_settings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "accounting_vat_accounts"
    ADD CONSTRAINT "accounting_vat_accounts_account_id_fkey"
    FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================
-- 7. Tablas de percepciones en facturas
-- ============================================

CREATE TABLE "sales_invoice_perceptions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "invoice_id" UUID NOT NULL,
    "type" "perception_type" NOT NULL,
    "jurisdiction" TEXT,
    "rate" DECIMAL(6, 3) NOT NULL,
    "base_amount" DECIMAL(12, 2) NOT NULL,
    "amount" DECIMAL(12, 2) NOT NULL,

    CONSTRAINT "sales_invoice_perceptions_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "sales_invoice_perceptions"
    ADD CONSTRAINT "sales_invoice_perceptions_invoice_id_fkey"
    FOREIGN KEY ("invoice_id") REFERENCES "sales_invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "purchase_invoice_perceptions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "invoice_id" UUID NOT NULL,
    "type" "perception_type" NOT NULL,
    "jurisdiction" TEXT,
    "rate" DECIMAL(6, 3) NOT NULL,
    "base_amount" DECIMAL(12, 2) NOT NULL,
    "amount" DECIMAL(12, 2) NOT NULL,

    CONSTRAINT "purchase_invoice_perceptions_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "purchase_invoice_perceptions"
    ADD CONSTRAINT "purchase_invoice_perceptions_invoice_id_fkey"
    FOREIGN KEY ("invoice_id") REFERENCES "purchase_invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ============================================
-- 8. Cuentas de percepciones en AccountingSettings
-- ============================================

ALTER TABLE "accounting_settings" ADD COLUMN "perception_iva_collected_account_id" UUID;
ALTER TABLE "accounting_settings" ADD COLUMN "perception_iibb_collected_account_id" UUID;
ALTER TABLE "accounting_settings" ADD COLUMN "perception_iva_suffered_account_id" UUID;
ALTER TABLE "accounting_settings" ADD COLUMN "perception_iibb_suffered_account_id" UUID;

ALTER TABLE "accounting_settings"
    ADD CONSTRAINT "accounting_settings_perception_iva_collected_fkey"
    FOREIGN KEY ("perception_iva_collected_account_id") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "accounting_settings"
    ADD CONSTRAINT "accounting_settings_perception_iibb_collected_fkey"
    FOREIGN KEY ("perception_iibb_collected_account_id") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "accounting_settings"
    ADD CONSTRAINT "accounting_settings_perception_iva_suffered_fkey"
    FOREIGN KEY ("perception_iva_suffered_account_id") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "accounting_settings"
    ADD CONSTRAINT "accounting_settings_perception_iibb_suffered_fkey"
    FOREIGN KEY ("perception_iibb_suffered_account_id") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
