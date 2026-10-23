-- TSK-792: diagnóstico del backfill de trazabilidad (migración 20261023100100_tsk_792_trigger_and_backfill).
-- SOLO LECTURA. Una consulta por regla del backfill: cuántas filas quedaron vinculadas y cuántas
-- sin vincular. Lo que quedó sin vincular no se corrige automáticamente: la corrección en cadena
-- lo muestra como impedimento ("es anterior a la trazabilidad").
--
-- Uso (la imagen runner de producción no tiene tsx):
--   psql "$DATABASE_URL" -f prisma/scripts/tsk792-diagnostico-trazabilidad.sql

\echo '1. journal_entries.process: asientos con descripción de un proceso (sin_vincular = system o reversión)'
SELECT CASE
         WHEN starts_with(description, 'Liquidación IVA ') THEN 'VAT_SETTLEMENT'
         WHEN starts_with(description, 'Ajuste por inflación — RECPAM') THEN 'INFLATION_ADJUSTMENT'
         ELSE 'EXCHANGE_DIFFERENCE'
       END AS proceso,
       count(*) FILTER (WHERE process IS NOT NULL) AS vinculados,
       count(*) FILTER (WHERE process IS NULL) AS sin_vincular
FROM journal_entries
WHERE starts_with(description, 'Liquidación IVA ')
   OR starts_with(description, 'Ajuste por inflación — RECPAM')
   OR starts_with(description, 'Diferencia de cambio al ')
GROUP BY 1
ORDER BY 1;

\echo '2. bank_movements.document_link: movimientos bancarios vinculados a una OP/RC'
SELECT count(*) FILTER (WHERE document_link = 'CREATED_BY_DOCUMENT') AS creados_por_comprobante,
       count(*) FILTER (WHERE document_link = 'MANUAL_LINK') AS vinculados_a_mano,
       count(*) FILTER (WHERE document_link IS NULL) AS sin_marca
FROM bank_movements
WHERE receipt_id IS NOT NULL OR payment_order_id IS NOT NULL;

\echo '3. cash_movements.receipt_id: movimientos de caja INCOME "Cobro de …"'
SELECT count(*) FILTER (WHERE receipt_id IS NOT NULL) AS vinculados,
       count(*) FILTER (WHERE receipt_id IS NULL) AS sin_vincular
FROM cash_movements
WHERE type = 'INCOME' AND starts_with(description, 'Cobro de ');

\echo '4. cash_movements.payment_order_id: movimientos de caja EXPENSE "Pago de …"'
SELECT count(*) FILTER (WHERE payment_order_id IS NOT NULL) AS vinculados,
       count(*) FILTER (WHERE payment_order_id IS NULL) AS sin_vincular
FROM cash_movements
WHERE type = 'EXPENSE' AND starts_with(description, 'Pago de ');

\echo '5. fund_movement_id: lados de MF CONFIRMED con su movimiento de banco o caja'
WITH sides AS (
  SELECT fm.id, 'OUT'::text AS direction, fm.fund_out_kind AS kind, fm.fund_out_id AS target_id
  FROM fund_movements fm
  WHERE fm.status = 'CONFIRMED'
    AND fm.type IN ('PARTNER_WITHDRAWAL', 'BANK_CHARGES', 'ACCOUNT_TRANSFER')
    AND fm.fund_out_kind IS NOT NULL AND fm.fund_out_id IS NOT NULL
  UNION ALL
  SELECT fm.id, 'IN'::text, fm.fund_in_kind, fm.fund_in_id
  FROM fund_movements fm
  WHERE fm.status = 'CONFIRMED'
    AND fm.type IN ('PARTNER_CONTRIBUTION', 'ACCOUNT_TRANSFER')
    AND fm.fund_in_kind IS NOT NULL AND fm.fund_in_id IS NOT NULL
),
linked AS (
  SELECT s.*,
         CASE s.kind
           WHEN 'BANK' THEN EXISTS (
             SELECT 1 FROM bank_movements bm
             WHERE bm.fund_movement_id = s.id AND bm.bank_account_id = s.target_id
               AND bm.type IN (CASE WHEN s.direction = 'IN' THEN 'DEPOSIT' ELSE 'WITHDRAWAL' END::bank_movement_type,
                               CASE WHEN s.direction = 'IN' THEN 'TRANSFER_IN' ELSE 'TRANSFER_OUT' END::bank_movement_type))
           WHEN 'CASH' THEN EXISTS (
             SELECT 1 FROM cash_movements cm
             WHERE cm.fund_movement_id = s.id AND cm.cash_register_id = s.target_id
               AND cm.type = CASE WHEN s.direction = 'IN' THEN 'INCOME' ELSE 'EXPENSE' END::cash_movement_type)
           ELSE false
         END AS is_linked
  FROM sides s
)
SELECT kind AS lado,
       count(*) FILTER (WHERE is_linked) AS vinculados,
       count(*) FILTER (WHERE NOT is_linked) AS sin_vincular
FROM linked
GROUP BY kind
ORDER BY kind;

\echo '6. cashflow_projections.payment_order_installment_id: cuotas de tarjeta con su proyección'
SELECT count(*) FILTER (WHERE p.id IS NOT NULL) AS vinculadas,
       count(*) FILTER (WHERE p.id IS NULL) AS sin_vincular
FROM payment_order_installments i
LEFT JOIN cashflow_projections p ON p.payment_order_installment_id = i.id;
