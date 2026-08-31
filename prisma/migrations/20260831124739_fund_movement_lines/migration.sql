-- AlterEnum
ALTER TYPE "fund_movement_type" ADD VALUE 'BANK_CHARGES';

-- CreateTable
CREATE TABLE "fund_movement_lines" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "movement_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,
    "position" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fund_movement_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "fund_movement_lines_movement_id_idx" ON "fund_movement_lines"("movement_id");

-- AddForeignKey
ALTER TABLE "fund_movement_lines" ADD CONSTRAINT "fund_movement_lines_movement_id_fkey" FOREIGN KEY ("movement_id") REFERENCES "fund_movements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fund_movement_lines" ADD CONSTRAINT "fund_movement_lines_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
