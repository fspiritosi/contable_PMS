-- AlterTable
ALTER TABLE "expense_categories" ADD COLUMN     "account_id" UUID;

-- CreateIndex
CREATE INDEX "expense_categories_account_id_idx" ON "expense_categories"("account_id");

-- AddForeignKey
ALTER TABLE "expense_categories" ADD CONSTRAINT "expense_categories_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
