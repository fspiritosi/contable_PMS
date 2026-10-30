-- AlterTable
ALTER TABLE "payment_order_withholdings" ADD COLUMN     "jurisdiction" TEXT,
ADD COLUMN     "regime_code" TEXT,
ADD COLUMN     "taxable_base" DECIMAL(15,2);
