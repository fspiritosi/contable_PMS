-- CreateEnum
CREATE TYPE "concept_usage" AS ENUM ('FUND_BANK_CHARGES', 'FUND_PARTNER_CONTRIBUTION', 'FUND_PARTNER_WITHDRAWAL', 'BANK_DEPOSIT', 'BANK_WITHDRAWAL', 'BANK_TRANSFER_IN', 'BANK_TRANSFER_OUT', 'BANK_CHECK', 'BANK_DEBIT', 'BANK_FEE', 'BANK_INTEREST');

-- CreateEnum
CREATE TYPE "concept_account_mode" AS ENUM ('OWN_ACCOUNT', 'PARTNER_ACCOUNT');

-- AlterTable
ALTER TABLE "bank_movements" ADD COLUMN     "concept_id" UUID,
ADD COLUMN     "concept_name" TEXT;

-- AlterTable
ALTER TABLE "fund_movement_lines" ADD COLUMN     "concept_id" UUID,
ADD COLUMN     "concept_name" TEXT;

-- AlterTable
ALTER TABLE "fund_movements" ADD COLUMN     "concept_id" UUID,
ADD COLUMN     "concept_name" TEXT;

-- CreateTable
CREATE TABLE "movement_concepts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "usages" "concept_usage"[],
    "account_mode" "concept_account_mode" NOT NULL DEFAULT 'OWN_ACCOUNT',
    "account_id" UUID,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "movement_concepts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "movement_concepts_company_id_is_active_idx" ON "movement_concepts"("company_id", "is_active");

-- AddForeignKey
ALTER TABLE "bank_movements" ADD CONSTRAINT "bank_movements_concept_id_fkey" FOREIGN KEY ("concept_id") REFERENCES "movement_concepts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fund_movements" ADD CONSTRAINT "fund_movements_concept_id_fkey" FOREIGN KEY ("concept_id") REFERENCES "movement_concepts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movement_concepts" ADD CONSTRAINT "movement_concepts_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movement_concepts" ADD CONSTRAINT "movement_concepts_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fund_movement_lines" ADD CONSTRAINT "fund_movement_lines_concept_id_fkey" FOREIGN KEY ("concept_id") REFERENCES "movement_concepts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

