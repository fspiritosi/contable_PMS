-- TSK-792: corrección en cadena de comprobantes. Migración escrita a mano: trigger de
-- inmutabilidad de asientos (§6 del diseño) y backfill de la trazabilidad de efectos (§4.5).
-- Las columnas, enums, índices y FK las crea la migración anterior (generada).
--
-- Regla de todo el backfill: se vincula solo ante una coincidencia única. Ante la duda no se
-- vincula; el registro queda sin vínculo y la corrección lo trata como impedimento ("es
-- anterior a la trazabilidad"). `prisma/scripts/tsk792-diagnostico-trazabilidad.sql` cuenta
-- lo que quedó sin vincular.

-- =====================================================================================
-- Paso 1: trigger de inmutabilidad. Igual que en 20260624100000_accounting_constraints,
--         más una transición: un POSTED puede volver a DRAFT si no cambian número, fecha,
--         descripción, empresa ni los vínculos de reversión. Las líneas siguen bloqueadas
--         mientras el asiento esté POSTED (`prevent_posted_entry_line_modification` no se
--         toca): se editan recién cuando ya es DRAFT.
-- =====================================================================================
CREATE OR REPLACE FUNCTION "public"."prevent_posted_entry_modification"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  -- Asiento POSTED: solo se permite pasar a REVERSED o volver a DRAFT
  IF OLD.status = 'POSTED' THEN
    IF TG_OP = 'UPDATE' AND NEW.status = 'REVERSED' THEN
      RETURN NEW;
    END IF;
    -- TSK-792: volver a borrador conservando el contenido del asiento. Pueden cambiar el
    -- estado, la fecha de registro y las columnas de trazabilidad (reverted_to_draft_*).
    IF TG_OP = 'UPDATE' AND NEW.status = 'DRAFT'
       AND NEW.number IS NOT DISTINCT FROM OLD.number
       AND NEW.date IS NOT DISTINCT FROM OLD.date
       AND NEW.description IS NOT DISTINCT FROM OLD.description
       AND NEW.company_id IS NOT DISTINCT FROM OLD.company_id
       AND NEW.original_entry_id IS NOT DISTINCT FROM OLD.original_entry_id
       AND NEW.reversal_entry_id IS NOT DISTINCT FROM OLD.reversal_entry_id THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'No se puede modificar ni eliminar un asiento contable registrado (POSTED). Use una reversión. [id=%]', OLD.id;
  END IF;

  -- Asiento REVERSED: no se puede modificar ni eliminar
  IF OLD.status = 'REVERSED' THEN
    RAISE EXCEPTION 'No se puede modificar ni eliminar un asiento contable anulado (REVERSED). [id=%]', OLD.id;
  END IF;

  -- DRAFT: permitir cualquier operación
  RETURN COALESCE(NEW, OLD);
END $$;

-- =====================================================================================
-- Paso 2: journal_entries.process. Solo asientos de usuario (no 'system') que no sean
--         reversiones, por el prefijo de la descripción que arma cada proceso. Los asientos
--         POSTED son inmutables: el trigger se deshabilita SOLO alrededor de este UPDATE.
-- =====================================================================================
ALTER TABLE journal_entries DISABLE TRIGGER trg_journal_entry_immutable;

UPDATE journal_entries
SET process = CASE
      WHEN starts_with(description, 'Liquidación IVA ') THEN 'VAT_SETTLEMENT'::journal_entry_process
      WHEN starts_with(description, 'Ajuste por inflación — RECPAM') THEN 'INFLATION_ADJUSTMENT'::journal_entry_process
      WHEN starts_with(description, 'Diferencia de cambio al ') THEN 'EXCHANGE_DIFFERENCE'::journal_entry_process
    END
WHERE process IS NULL
  AND created_by <> 'system'
  AND original_entry_id IS NULL
  AND (   starts_with(description, 'Liquidación IVA ')
       OR starts_with(description, 'Ajuste por inflación — RECPAM')
       OR starts_with(description, 'Diferencia de cambio al '));

ALTER TABLE journal_entries ENABLE TRIGGER trg_journal_entry_immutable;

-- =====================================================================================
-- Paso 3: bank_movements.document_link para las filas vinculadas a una OP/RC.
--         CREATED_BY_DOCUMENT si la referencia es el número del comprobante y la fila se creó
--         a menos de un minuto de su confirmación (misma transacción de confirmar). Si no,
--         MANUAL_LINK (lo vinculó un usuario con linkBankMovementToDocument). Con los dos
--         vínculos cargados, tienen que cumplir los dos.
-- =====================================================================================
UPDATE bank_movements bm
SET document_link = CASE
      WHEN (bm.receipt_id IS NULL OR EXISTS (
              SELECT 1 FROM receipts r
              WHERE r.id = bm.receipt_id
                AND bm.reference = r.full_number
                AND r.confirmed_at IS NOT NULL
                AND abs(extract(epoch FROM (bm.created_at - r.confirmed_at))) < 60))
       AND (bm.payment_order_id IS NULL OR EXISTS (
              SELECT 1 FROM payment_orders po
              WHERE po.id = bm.payment_order_id
                AND bm.reference = po.full_number
                AND po.confirmed_at IS NOT NULL
                AND abs(extract(epoch FROM (bm.created_at - po.confirmed_at))) < 60))
        THEN 'CREATED_BY_DOCUMENT'::bank_movement_document_link
      ELSE 'MANUAL_LINK'::bank_movement_document_link
    END
WHERE bm.document_link IS NULL
  AND (bm.receipt_id IS NOT NULL OR bm.payment_order_id IS NOT NULL);

-- =====================================================================================
-- Paso 4: cash_movements.receipt_id y payment_order_id. confirmReceipt / confirmPaymentOrder
--         crean el movimiento de caja con reference = full_number y descripción "Cobro de …" /
--         "Pago de …". Se vincula solo si hay un único comprobante de la empresa con ese número.
-- =====================================================================================
UPDATE cash_movements cm
SET receipt_id = r.id
FROM receipts r
WHERE cm.receipt_id IS NULL
  AND cm.type = 'INCOME'
  AND starts_with(cm.description, 'Cobro de ')
  AND r.company_id = cm.company_id
  AND r.full_number = cm.reference
  AND NOT EXISTS (
    SELECT 1 FROM receipts r2
    WHERE r2.company_id = r.company_id AND r2.full_number = r.full_number AND r2.id <> r.id);

UPDATE cash_movements cm
SET payment_order_id = po.id
FROM payment_orders po
WHERE cm.payment_order_id IS NULL
  AND cm.type = 'EXPENSE'
  AND starts_with(cm.description, 'Pago de ')
  AND po.company_id = cm.company_id
  AND po.full_number = cm.reference
  AND NOT EXISTS (
    SELECT 1 FROM payment_orders po2
    WHERE po2.company_id = po.company_id AND po2.full_number = po.full_number AND po2.id <> po.id);

-- =====================================================================================
-- Paso 5: fund_movement_id de bank_movements y cash_movements. Por cada MF CONFIRMED y cada
--         lado que mueve (applyFundSide): sale (OUT) en retiro, gastos bancarios y
--         transferencia; entra (IN) en aporte y transferencia. La fila tiene que coincidir en
--         empresa, cuenta o caja, fecha, importe, tipo y descripción (= la del MF), no estar
--         vinculada a otro comprobante, y la coincidencia tiene que ser única en los dos
--         sentidos: un solo candidato para ese lado del MF y un solo lado de MF para esa fila.
--         Tipo de la fila: banco TRANSFER_IN/TRANSFER_OUT en transferencias y DEPOSIT/
--         WITHDRAWAL en el resto; caja INCOME (IN) / EXPENSE (OUT).
-- =====================================================================================
CREATE TEMP TABLE tsk792_fund_sides AS
SELECT fm.id AS fund_movement_id, fm.company_id, fm.date, fm.amount, fm.description, fm.type,
       'OUT'::text AS direction, fm.fund_out_kind AS kind, fm.fund_out_id AS target_id
FROM fund_movements fm
WHERE fm.status = 'CONFIRMED'
  AND fm.type IN ('PARTNER_WITHDRAWAL', 'BANK_CHARGES', 'ACCOUNT_TRANSFER')
  AND fm.fund_out_kind IS NOT NULL AND fm.fund_out_id IS NOT NULL
UNION ALL
SELECT fm.id, fm.company_id, fm.date, fm.amount, fm.description, fm.type,
       'IN'::text, fm.fund_in_kind, fm.fund_in_id
FROM fund_movements fm
WHERE fm.status = 'CONFIRMED'
  AND fm.type IN ('PARTNER_CONTRIBUTION', 'ACCOUNT_TRANSFER')
  AND fm.fund_in_kind IS NOT NULL AND fm.fund_in_id IS NOT NULL;

WITH candidates AS (
  SELECT s.fund_movement_id, s.direction, bm.id AS row_id
  FROM tsk792_fund_sides s
  JOIN bank_movements bm
    ON bm.company_id = s.company_id
   AND bm.bank_account_id = s.target_id
   AND bm.date = s.date
   AND bm.amount = s.amount
   AND bm.description = s.description
   AND bm.type = (CASE
         WHEN s.type = 'ACCOUNT_TRANSFER' AND s.direction = 'IN' THEN 'TRANSFER_IN'
         WHEN s.type = 'ACCOUNT_TRANSFER' THEN 'TRANSFER_OUT'
         WHEN s.direction = 'IN' THEN 'DEPOSIT'
         ELSE 'WITHDRAWAL'
       END)::bank_movement_type
  WHERE s.kind = 'BANK'
    AND bm.fund_movement_id IS NULL
    AND bm.receipt_id IS NULL
    AND bm.payment_order_id IS NULL
),
unique_matches AS (
  SELECT c.fund_movement_id, c.row_id
  FROM candidates c
  WHERE (SELECT count(*) FROM candidates c2
         WHERE c2.fund_movement_id = c.fund_movement_id AND c2.direction = c.direction) = 1
    AND (SELECT count(*) FROM candidates c3 WHERE c3.row_id = c.row_id) = 1
)
UPDATE bank_movements bm
SET fund_movement_id = u.fund_movement_id
FROM unique_matches u
WHERE bm.id = u.row_id;

WITH candidates AS (
  SELECT s.fund_movement_id, s.direction, cm.id AS row_id
  FROM tsk792_fund_sides s
  JOIN cash_movements cm
    ON cm.company_id = s.company_id
   AND cm.cash_register_id = s.target_id
   AND cm.date = s.date
   AND cm.amount = s.amount
   AND cm.description = s.description
   AND cm.type = (CASE WHEN s.direction = 'IN' THEN 'INCOME' ELSE 'EXPENSE' END)::cash_movement_type
  WHERE s.kind = 'CASH'
    AND cm.fund_movement_id IS NULL
    AND cm.receipt_id IS NULL
    AND cm.payment_order_id IS NULL
),
unique_matches AS (
  SELECT c.fund_movement_id, c.row_id
  FROM candidates c
  WHERE (SELECT count(*) FROM candidates c2
         WHERE c2.fund_movement_id = c.fund_movement_id AND c2.direction = c.direction) = 1
    AND (SELECT count(*) FROM candidates c3 WHERE c3.row_id = c.row_id) = 1
)
UPDATE cash_movements cm
SET fund_movement_id = u.fund_movement_id
FROM unique_matches u
WHERE cm.id = u.row_id;

DROP TABLE tsk792_fund_sides;

-- =====================================================================================
-- Paso 6: cashflow_projections.payment_order_installment_id. confirmPaymentOrder crea una
--         proyección EXPENSE por cuota, con fecha = vencimiento, el importe de la cuota y la
--         descripción "Cuota {n}/{N} {OP} — {tarjeta}" (varias cuotas) o "{OP} — {tarjeta}"
--         (una sola). Coincidencia única en los dos sentidos, como en el paso 5.
-- =====================================================================================
WITH installments AS (
  SELECT i.id, i.company_id, i.number, i.due_date, i.amount,
         -- número de la OP escapado para usarlo dentro de una regex
         regexp_replace(po.full_number, '([.^$*+?()\[\]{}|\\-])', '\\\1', 'g') AS op_pattern
  FROM payment_order_installments i
  JOIN payment_orders po ON po.id = i.payment_order_id
),
candidates AS (
  SELECT i.id AS installment_id, p.id AS projection_id
  FROM installments i
  JOIN cashflow_projections p
    ON p.company_id = i.company_id
   AND p.type = 'EXPENSE'
   AND p.date = i.due_date
   AND p.amount = i.amount
  WHERE p.payment_order_installment_id IS NULL
    AND (   p.description ~ ('^Cuota ' || i.number || '/[0-9]+ ' || i.op_pattern || ' — ')
         OR (i.number = 1 AND p.description ~ ('^' || i.op_pattern || ' — ')))
),
unique_matches AS (
  SELECT c.installment_id, c.projection_id
  FROM candidates c
  WHERE (SELECT count(*) FROM candidates c2 WHERE c2.installment_id = c.installment_id) = 1
    AND (SELECT count(*) FROM candidates c3 WHERE c3.projection_id = c.projection_id) = 1
)
UPDATE cashflow_projections p
SET payment_order_installment_id = u.installment_id
FROM unique_matches u
WHERE p.id = u.projection_id;
