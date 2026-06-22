-- AlterTable
ALTER TABLE "payment_order_installments" ADD COLUMN     "paid_at" TIMESTAMP(3),
ADD COLUMN     "partner_id" UUID,
ADD COLUMN     "settled_by_payment_order_id" UUID;

-- AlterTable
ALTER TABLE "payment_orders" ADD COLUMN     "partner_id" UUID;

-- CreateIndex
CREATE INDEX "payment_order_installments_partner_id_status_idx" ON "payment_order_installments"("partner_id", "status");

-- AddForeignKey
ALTER TABLE "payment_orders" ADD CONSTRAINT "payment_orders_partner_id_fkey" FOREIGN KEY ("partner_id") REFERENCES "partners"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_order_installments" ADD CONSTRAINT "payment_order_installments_partner_id_fkey" FOREIGN KEY ("partner_id") REFERENCES "partners"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_order_installments" ADD CONSTRAINT "payment_order_installments_settled_by_payment_order_id_fkey" FOREIGN KEY ("settled_by_payment_order_id") REFERENCES "payment_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
