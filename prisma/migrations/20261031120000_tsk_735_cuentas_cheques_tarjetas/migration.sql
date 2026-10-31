-- AlterTable
ALTER TABLE "accounting_settings" ADD COLUMN     "checks_payable_account_id" UUID,
ADD COLUMN     "credit_cards_payable_account_id" UUID,
ADD COLUMN     "partner_debts_account_id" UUID;

-- AlterTable
ALTER TABLE "checks" ADD COLUMN     "account_id" UUID,
ADD COLUMN     "debit_entry_id" UUID,
ADD COLUMN     "deposit_entry_id" UUID,
ADD COLUMN     "rejection_entry_id" UUID,
ADD COLUMN     "void_entry_id" UUID;

-- AlterTable
ALTER TABLE "payment_order_installments" ADD COLUMN     "account_id" UUID;

-- AddForeignKey
ALTER TABLE "accounting_settings" ADD CONSTRAINT "accounting_settings_checks_payable_account_id_fkey" FOREIGN KEY ("checks_payable_account_id") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_settings" ADD CONSTRAINT "accounting_settings_credit_cards_payable_account_id_fkey" FOREIGN KEY ("credit_cards_payable_account_id") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_settings" ADD CONSTRAINT "accounting_settings_partner_debts_account_id_fkey" FOREIGN KEY ("partner_debts_account_id") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checks" ADD CONSTRAINT "checks_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checks" ADD CONSTRAINT "checks_deposit_entry_id_fkey" FOREIGN KEY ("deposit_entry_id") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checks" ADD CONSTRAINT "checks_rejection_entry_id_fkey" FOREIGN KEY ("rejection_entry_id") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checks" ADD CONSTRAINT "checks_debit_entry_id_fkey" FOREIGN KEY ("debit_entry_id") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checks" ADD CONSTRAINT "checks_void_entry_id_fkey" FOREIGN KEY ("void_entry_id") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_order_installments" ADD CONSTRAINT "payment_order_installments_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
