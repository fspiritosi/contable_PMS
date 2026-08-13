-- CreateEnum
CREATE TYPE "fund_movement_type" AS ENUM ('PARTNER_CONTRIBUTION', 'PARTNER_WITHDRAWAL', 'ACCOUNT_TRANSFER');

-- AlterTable
ALTER TABLE "accounting_settings" ADD COLUMN     "partner_contributions_account_id" UUID;

-- CreateTable
CREATE TABLE "fund_movements" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "type" "fund_movement_type" NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,
    "description" TEXT NOT NULL,
    "source_account_id" UUID,
    "source_account_label" TEXT,
    "destination_account_id" UUID,
    "destination_account_label" TEXT,
    "partner_id" UUID,
    "partner_name" TEXT,
    "journal_entry_id" UUID,
    "journal_entry_number" INTEGER,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fund_movements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "fund_movements_company_id_idx" ON "fund_movements"("company_id");

-- AddForeignKey
ALTER TABLE "accounting_settings" ADD CONSTRAINT "accounting_settings_partner_contributions_account_id_fkey" FOREIGN KEY ("partner_contributions_account_id") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fund_movements" ADD CONSTRAINT "fund_movements_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
