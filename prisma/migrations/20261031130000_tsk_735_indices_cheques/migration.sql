-- TSK-735 (revisión final): índices de las columnas nuevas de cheques y cuotas.
-- Las FK de cuenta y de asientos se consultan al borrar/anular un asiento o una cuenta
-- (ON DELETE SET NULL) y desde el diagnóstico; sin índice cada una es un barrido de la tabla.
CREATE INDEX "checks_account_id_idx" ON "checks"("account_id");
CREATE INDEX "checks_deposit_entry_id_idx" ON "checks"("deposit_entry_id");
CREATE INDEX "checks_rejection_entry_id_idx" ON "checks"("rejection_entry_id");
CREATE INDEX "checks_debit_entry_id_idx" ON "checks"("debit_entry_id");
CREATE INDEX "checks_void_entry_id_idx" ON "checks"("void_entry_id");
CREATE INDEX "payment_order_installments_account_id_idx" ON "payment_order_installments"("account_id");
