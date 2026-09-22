-- CreateIndex
CREATE INDEX "journal_entry_lines_cost_center_id_idx" ON "journal_entry_lines"("cost_center_id");

-- CreateIndex
CREATE INDEX "journal_entry_lines_entry_id_idx" ON "journal_entry_lines"("entry_id");
