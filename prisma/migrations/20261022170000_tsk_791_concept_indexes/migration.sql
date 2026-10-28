-- CreateIndex
CREATE INDEX "bank_movements_concept_id_idx" ON "bank_movements"("concept_id");

-- CreateIndex
CREATE INDEX "fund_movements_concept_id_idx" ON "fund_movements"("concept_id");

-- CreateIndex
CREATE INDEX "fund_movement_lines_concept_id_idx" ON "fund_movement_lines"("concept_id");
