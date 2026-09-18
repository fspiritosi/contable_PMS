-- AlterTable
ALTER TABLE "accounting_settings" ADD COLUMN     "bank_charges_account_id" UUID;

-- AddForeignKey
ALTER TABLE "accounting_settings" ADD CONSTRAINT "accounting_settings_bank_charges_account_id_fkey" FOREIGN KEY ("bank_charges_account_id") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
