-- AlterTable
ALTER TABLE "accounting_settings" ADD COLUMN     "internal_taxes_account_id" UUID,
ADD COLUMN     "perception_municipal_collected_account_id" UUID,
ADD COLUMN     "perception_municipal_suffered_account_id" UUID;

-- AlterTable
ALTER TABLE "purchase_invoices" ADD COLUMN     "internal_taxes" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "sales_invoices" ADD COLUMN     "internal_taxes" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- AddForeignKey
ALTER TABLE "accounting_settings" ADD CONSTRAINT "accounting_settings_perception_municipal_collected_account_fkey" FOREIGN KEY ("perception_municipal_collected_account_id") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_settings" ADD CONSTRAINT "accounting_settings_perception_municipal_suffered_account__fkey" FOREIGN KEY ("perception_municipal_suffered_account_id") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_settings" ADD CONSTRAINT "accounting_settings_internal_taxes_account_id_fkey" FOREIGN KEY ("internal_taxes_account_id") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
