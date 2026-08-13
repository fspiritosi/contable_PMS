/*
  Warnings:

  - You are about to drop the column `destination_account_id` on the `fund_movements` table. All the data in the column will be lost.
  - You are about to drop the column `destination_account_label` on the `fund_movements` table. All the data in the column will be lost.
  - You are about to drop the column `source_account_id` on the `fund_movements` table. All the data in the column will be lost.
  - You are about to drop the column `source_account_label` on the `fund_movements` table. All the data in the column will be lost.

*/
-- CreateEnum
CREATE TYPE "fund_movement_status" AS ENUM ('DRAFT', 'CONFIRMED', 'CANCELLED');

-- AlterTable
ALTER TABLE "fund_movements" DROP COLUMN "destination_account_id",
DROP COLUMN "destination_account_label",
DROP COLUMN "source_account_id",
DROP COLUMN "source_account_label",
ADD COLUMN     "confirmed_at" TIMESTAMP(3),
ADD COLUMN     "fund_in_id" UUID,
ADD COLUMN     "fund_in_kind" TEXT,
ADD COLUMN     "fund_in_label" TEXT,
ADD COLUMN     "fund_out_id" UUID,
ADD COLUMN     "fund_out_kind" TEXT,
ADD COLUMN     "fund_out_label" TEXT,
ADD COLUMN     "status" "fund_movement_status" NOT NULL DEFAULT 'DRAFT';
