-- TSK-788: diagnóstico de asientos que quedaron vivos de comprobantes anulados.
-- SOLO LECTURA. Antes de TSK-792 (23/10/2026) anular una factura de compra o de venta no tocaba su
-- asiento, y `cancelExpense` hizo lo mismo con los gastos hasta TSK-788. El asiento seguía en
-- borrador o registrado y sumaba en los informes (por ejemplo, Movimientos por Centro de Costo).
--
-- No corrige nada. Con el fix desplegado, cada uno se limpia desde Contabilidad → Asientos:
--   - Borrador   → "Eliminar borrador".
--   - Registrado → "Anular" (la reversión va con fecha de hoy; si el mes de hoy o el del asiento
--                   está cerrado, se reabre antes).
--
-- Uso (la imagen runner de producción no tiene tsx):
--   psql "$DATABASE_URL" -f prisma/scripts/tsk788-diagnostico-asientos-de-anulados.sql

\echo 'Asientos DRAFT o POSTED de comprobantes anulados'
WITH docs AS (
  SELECT 'FC' AS tipo, company_id, full_number AS comprobante, status::text AS estado, journal_entry_id
  FROM purchase_invoices
  UNION ALL SELECT 'FV', company_id, full_number, status::text, journal_entry_id FROM sales_invoices
  UNION ALL SELECT 'Gasto', company_id, full_number, status::text, journal_entry_id FROM expenses
  UNION ALL SELECT 'OP', company_id, full_number, status::text, journal_entry_id FROM payment_orders
  UNION ALL SELECT 'RC', company_id, full_number, status::text, journal_entry_id FROM receipts
  UNION ALL SELECT 'MF', company_id, description, status::text, journal_entry_id FROM fund_movements
)
SELECT c.name AS empresa,
       d.tipo,
       d.comprobante,
       je.number AS asiento,
       je.status::text AS estado_asiento,
       to_char(je.date, 'DD/MM/YYYY') AS fecha,
       (SELECT sum(l.debit) FROM journal_entry_lines l WHERE l.entry_id = je.id) AS importe
FROM docs d
JOIN journal_entries je ON je.id = d.journal_entry_id
JOIN companies c ON c.id = d.company_id
WHERE d.estado = 'CANCELLED'
  AND je.status IN ('DRAFT', 'POSTED')
ORDER BY c.name, je.date, je.number;
