/*
  Warnings:

  - You are about to drop the column `cost_center_id` on the `purchase_invoice_lines` table. All the data in the column will be lost.

*/
-- DropForeignKey
ALTER TABLE "purchase_invoice_lines" DROP CONSTRAINT "purchase_invoice_lines_cost_center_id_fkey";

-- AlterTable
ALTER TABLE "accounting_settings" ADD COLUMN     "require_cost_center" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "purchase_invoice_line_cost_centers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "line_id" UUID NOT NULL,
    "cost_center_id" UUID NOT NULL,
    "percentage" DECIMAL(5,2) NOT NULL,

    CONSTRAINT "purchase_invoice_line_cost_centers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_invoice_line_cost_centers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "line_id" UUID NOT NULL,
    "cost_center_id" UUID NOT NULL,
    "percentage" DECIMAL(5,2) NOT NULL,

    CONSTRAINT "sales_invoice_line_cost_centers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "purchase_invoice_line_cost_centers_cost_center_id_idx" ON "purchase_invoice_line_cost_centers"("cost_center_id");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_invoice_line_cost_centers_line_id_cost_center_id_key" ON "purchase_invoice_line_cost_centers"("line_id", "cost_center_id");

-- CreateIndex
CREATE INDEX "sales_invoice_line_cost_centers_cost_center_id_idx" ON "sales_invoice_line_cost_centers"("cost_center_id");

-- CreateIndex
CREATE UNIQUE INDEX "sales_invoice_line_cost_centers_line_id_cost_center_id_key" ON "sales_invoice_line_cost_centers"("line_id", "cost_center_id");

-- AddForeignKey
ALTER TABLE "purchase_invoice_line_cost_centers" ADD CONSTRAINT "purchase_invoice_line_cost_centers_line_id_fkey" FOREIGN KEY ("line_id") REFERENCES "purchase_invoice_lines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_invoice_line_cost_centers" ADD CONSTRAINT "purchase_invoice_line_cost_centers_cost_center_id_fkey" FOREIGN KEY ("cost_center_id") REFERENCES "cost_centers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_invoice_line_cost_centers" ADD CONSTRAINT "sales_invoice_line_cost_centers_line_id_fkey" FOREIGN KEY ("line_id") REFERENCES "sales_invoice_lines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_invoice_line_cost_centers" ADD CONSTRAINT "sales_invoice_line_cost_centers_cost_center_id_fkey" FOREIGN KEY ("cost_center_id") REFERENCES "cost_centers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Lo ya imputado con el modelo anterior pasa a ser un reparto al 100%.
-- Inofensivo si la tabla está vacía (la primera entrega no llegó a producción).
INSERT INTO "purchase_invoice_line_cost_centers" ("line_id", "cost_center_id", "percentage")
SELECT "id", "cost_center_id", 100.00
FROM "purchase_invoice_lines"
WHERE "cost_center_id" IS NOT NULL;

-- AlterTable
ALTER TABLE "purchase_invoice_lines" DROP COLUMN "cost_center_id";
