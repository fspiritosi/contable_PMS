-- CreateEnum
CREATE TYPE "investment_instrument_type" AS ENUM ('STOCK', 'CEDEAR', 'BOND', 'OPTION', 'LETTER', 'FUTURE', 'TENDER', 'CORPORATE_BOND', 'MUTUAL_FUND', 'TRUST', 'REPO', 'FIXED_TERM');

-- CreateEnum
CREATE TYPE "investment_holding_status" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "investment_movement_kind" AS ENUM ('PURCHASE', 'SALE', 'VALUATION');

-- AlterEnum
ALTER TYPE "bank_account_type" ADD VALUE 'BROKER';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "fund_movement_type" ADD VALUE 'INVESTMENT_PURCHASE';
ALTER TYPE "fund_movement_type" ADD VALUE 'INVESTMENT_SALE';

-- AlterEnum
ALTER TYPE "journal_entry_process" ADD VALUE 'INVESTMENT_VALUATION';

-- AlterTable
ALTER TABLE "accounting_settings" ADD COLUMN     "holding_gain_account_id" UUID,
ADD COLUMN     "holding_loss_account_id" UUID,
ADD COLUMN     "investment_fees_account_id" UUID;

-- AlterTable
ALTER TABLE "fund_movements" ADD COLUMN     "commission" DECIMAL(15,2),
ADD COLUMN     "holding_id" UUID,
ADD COLUMN     "is_full_sale" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "nominals" DECIMAL(18,6),
ADD COLUMN     "unit_price" DECIMAL(18,6);

-- CreateTable
CREATE TABLE "investment_holdings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "bank_account_id" UUID NOT NULL,
    "instrument_type" "investment_instrument_type" NOT NULL,
    "name" TEXT NOT NULL,
    "maturity_date" DATE,
    "account_id" UUID NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'ARS',
    "status" "investment_holding_status" NOT NULL DEFAULT 'OPEN',
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "investment_holdings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "investment_movements" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "holding_id" UUID NOT NULL,
    "kind" "investment_movement_kind" NOT NULL,
    "date" DATE NOT NULL,
    "book_delta" DECIMAL(15,2) NOT NULL,
    "nominals_delta" DECIMAL(18,6),
    "proceeds" DECIMAL(15,2),
    "result" DECIMAL(15,2),
    "closes_holding" BOOLEAN NOT NULL DEFAULT false,
    "valued_amount" DECIMAL(15,2),
    "unit_price" DECIMAL(18,6),
    "fund_movement_id" UUID,
    "valuation_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "investment_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "investment_valuations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "fiscal_year_id" UUID NOT NULL,
    "closing_date" DATE NOT NULL,
    "journal_entry_id" UUID,
    "journal_entry_number" INTEGER,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "investment_valuations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "investment_holdings_company_id_idx" ON "investment_holdings"("company_id");

-- CreateIndex
CREATE INDEX "investment_holdings_bank_account_id_idx" ON "investment_holdings"("bank_account_id");

-- CreateIndex
CREATE INDEX "investment_movements_holding_id_date_idx" ON "investment_movements"("holding_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "investment_valuations_company_id_fiscal_year_id_key" ON "investment_valuations"("company_id", "fiscal_year_id");

-- CreateIndex
CREATE INDEX "fund_movements_holding_id_idx" ON "fund_movements"("holding_id");

-- AddForeignKey
ALTER TABLE "accounting_settings" ADD CONSTRAINT "accounting_settings_holding_gain_account_id_fkey" FOREIGN KEY ("holding_gain_account_id") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_settings" ADD CONSTRAINT "accounting_settings_holding_loss_account_id_fkey" FOREIGN KEY ("holding_loss_account_id") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_settings" ADD CONSTRAINT "accounting_settings_investment_fees_account_id_fkey" FOREIGN KEY ("investment_fees_account_id") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fund_movements" ADD CONSTRAINT "fund_movements_holding_id_fkey" FOREIGN KEY ("holding_id") REFERENCES "investment_holdings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "investment_holdings" ADD CONSTRAINT "investment_holdings_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "investment_holdings" ADD CONSTRAINT "investment_holdings_bank_account_id_fkey" FOREIGN KEY ("bank_account_id") REFERENCES "bank_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "investment_holdings" ADD CONSTRAINT "investment_holdings_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "investment_movements" ADD CONSTRAINT "investment_movements_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "investment_movements" ADD CONSTRAINT "investment_movements_holding_id_fkey" FOREIGN KEY ("holding_id") REFERENCES "investment_holdings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "investment_movements" ADD CONSTRAINT "investment_movements_fund_movement_id_fkey" FOREIGN KEY ("fund_movement_id") REFERENCES "fund_movements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "investment_movements" ADD CONSTRAINT "investment_movements_valuation_id_fkey" FOREIGN KEY ("valuation_id") REFERENCES "investment_valuations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "investment_valuations" ADD CONSTRAINT "investment_valuations_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "investment_valuations" ADD CONSTRAINT "investment_valuations_fiscal_year_id_fkey" FOREIGN KEY ("fiscal_year_id") REFERENCES "fiscal_years"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
