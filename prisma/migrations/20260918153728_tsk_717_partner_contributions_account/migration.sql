-- AlterTable
ALTER TABLE "partners" ADD COLUMN     "contributions_account_id" UUID;

-- CreateIndex
CREATE INDEX "partners_contributions_account_id_idx" ON "partners"("contributions_account_id");

-- AddForeignKey
ALTER TABLE "partners" ADD CONSTRAINT "partners_contributions_account_id_fkey" FOREIGN KEY ("contributions_account_id") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
