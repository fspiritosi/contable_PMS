-- CreateEnum
CREATE TYPE "journal_entry_process" AS ENUM ('VAT_SETTLEMENT', 'INFLATION_ADJUSTMENT', 'EXCHANGE_DIFFERENCE');

-- CreateEnum
CREATE TYPE "bank_movement_document_link" AS ENUM ('CREATED_BY_DOCUMENT', 'MANUAL_LINK');

-- AlterTable
ALTER TABLE "bank_movements" ADD COLUMN     "document_link" "bank_movement_document_link",
ADD COLUMN     "fund_movement_id" UUID;

-- AlterTable
ALTER TABLE "cash_movements" ADD COLUMN     "fund_movement_id" UUID,
ADD COLUMN     "payment_order_id" UUID,
ADD COLUMN     "receipt_id" UUID;

-- AlterTable
ALTER TABLE "cashflow_projections" ADD COLUMN     "payment_order_installment_id" UUID;

-- AlterTable
ALTER TABLE "journal_entries" ADD COLUMN     "process" "journal_entry_process",
ADD COLUMN     "reverted_to_draft_at" TIMESTAMP(3),
ADD COLUMN     "reverted_to_draft_by" TEXT;

-- CreateIndex
CREATE INDEX "bank_movements_fund_movement_id_idx" ON "bank_movements"("fund_movement_id");

-- CreateIndex
CREATE INDEX "cash_movements_receipt_id_idx" ON "cash_movements"("receipt_id");

-- CreateIndex
CREATE INDEX "cash_movements_payment_order_id_idx" ON "cash_movements"("payment_order_id");

-- CreateIndex
CREATE INDEX "cash_movements_fund_movement_id_idx" ON "cash_movements"("fund_movement_id");

-- CreateIndex
CREATE UNIQUE INDEX "cashflow_projections_payment_order_installment_id_key" ON "cashflow_projections"("payment_order_installment_id");

-- AddForeignKey
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_receipt_id_fkey" FOREIGN KEY ("receipt_id") REFERENCES "receipts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_payment_order_id_fkey" FOREIGN KEY ("payment_order_id") REFERENCES "payment_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_fund_movement_id_fkey" FOREIGN KEY ("fund_movement_id") REFERENCES "fund_movements"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_movements" ADD CONSTRAINT "bank_movements_fund_movement_id_fkey" FOREIGN KEY ("fund_movement_id") REFERENCES "fund_movements"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cashflow_projections" ADD CONSTRAINT "cashflow_projections_payment_order_installment_id_fkey" FOREIGN KEY ("payment_order_installment_id") REFERENCES "payment_order_installments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
