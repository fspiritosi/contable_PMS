-- AlterTable
ALTER TABLE "vehicle_depreciations" ADD COLUMN     "accumulated_depreciation_account_id" UUID,
ADD COLUMN     "depreciation_expense_account_id" UUID,
ADD COLUMN     "fixed_asset_account_id" UUID;

-- AlterTable
ALTER TABLE "vehicle_types" ADD COLUMN     "accumulated_depreciation_account_id" UUID,
ADD COLUMN     "depreciation_expense_account_id" UUID,
ADD COLUMN     "fixed_asset_account_id" UUID;

-- CreateIndex
CREATE INDEX "vehicle_depreciations_fixed_asset_account_id_idx" ON "vehicle_depreciations"("fixed_asset_account_id");

-- CreateIndex
CREATE INDEX "vehicle_depreciations_accumulated_depreciation_account_id_idx" ON "vehicle_depreciations"("accumulated_depreciation_account_id");

-- CreateIndex
CREATE INDEX "vehicle_depreciations_depreciation_expense_account_id_idx" ON "vehicle_depreciations"("depreciation_expense_account_id");

-- CreateIndex
CREATE INDEX "vehicle_types_fixed_asset_account_id_idx" ON "vehicle_types"("fixed_asset_account_id");

-- CreateIndex
CREATE INDEX "vehicle_types_accumulated_depreciation_account_id_idx" ON "vehicle_types"("accumulated_depreciation_account_id");

-- CreateIndex
CREATE INDEX "vehicle_types_depreciation_expense_account_id_idx" ON "vehicle_types"("depreciation_expense_account_id");

-- AddForeignKey
ALTER TABLE "vehicle_types" ADD CONSTRAINT "vehicle_types_fixed_asset_account_id_fkey" FOREIGN KEY ("fixed_asset_account_id") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_types" ADD CONSTRAINT "vehicle_types_accumulated_depreciation_account_id_fkey" FOREIGN KEY ("accumulated_depreciation_account_id") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_types" ADD CONSTRAINT "vehicle_types_depreciation_expense_account_id_fkey" FOREIGN KEY ("depreciation_expense_account_id") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_depreciations" ADD CONSTRAINT "vehicle_depreciations_fixed_asset_account_id_fkey" FOREIGN KEY ("fixed_asset_account_id") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_depreciations" ADD CONSTRAINT "vehicle_depreciations_accumulated_depreciation_account_id_fkey" FOREIGN KEY ("accumulated_depreciation_account_id") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_depreciations" ADD CONSTRAINT "vehicle_depreciations_depreciation_expense_account_id_fkey" FOREIGN KEY ("depreciation_expense_account_id") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
