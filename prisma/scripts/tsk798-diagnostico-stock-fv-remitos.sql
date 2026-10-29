-- TSK-798: diagnóstico del stock descontado dos veces por facturas de venta generadas desde remitos.
-- SOLO LECTURA. Antes del fix, la FV confirmada descontaba otra vez el stock que ya había descontado
-- el remito al crearse. Por cada FV con efectos aplicados (no borrador ni anulada) y con remitos
-- facturados, compara lo entregado por los remitos con lo que descontó la propia factura
-- (stock_movements SALE con reference_type 'sales_invoice'): lo descontado de más es el menor
-- de los dos. No corrige nada: el ajuste se decide con el cliente (ajuste de inventario por
-- depósito y producto, o anular y volver a confirmar cada FV con el fix desplegado).
--
-- Uso (la imagen runner de producción no tiene tsx):
--   psql "$DATABASE_URL" -f prisma/scripts/tsk798-diagnostico-stock-fv-remitos.sql

\echo '1. Detalle por factura y producto: descontado_de_mas = least(entregado_por_remitos, descontado_por_fv)'
WITH delivered AS (
  SELECT dn.company_id, dn.sales_invoice_id AS invoice_id, dnl.product_id, sum(dnl.quantity) AS qty
  FROM delivery_notes dn
  JOIN delivery_note_lines dnl ON dnl.delivery_note_id = dn.id
  WHERE dn.status = 'INVOICED' AND dn.sales_invoice_id IS NOT NULL
  GROUP BY 1, 2, 3
),
moved AS (
  SELECT sm.reference_id AS invoice_id, sm.product_id, sm.warehouse_id, sum(sm.quantity) AS qty
  FROM stock_movements sm
  WHERE sm.reference_type = 'sales_invoice' AND sm.type = 'SALE'
  GROUP BY 1, 2, 3
)
SELECT c.name AS empresa,
       si.full_number AS factura,
       si.status AS estado,
       p.code AS producto,
       w.name AS deposito,
       d.qty AS entregado_por_remitos,
       m.qty AS descontado_por_fv,
       least(d.qty, m.qty) AS descontado_de_mas
FROM delivered d
JOIN moved m ON m.invoice_id = d.invoice_id AND m.product_id = d.product_id
JOIN sales_invoices si ON si.id = d.invoice_id
JOIN companies c ON c.id = d.company_id
JOIN products p ON p.id = d.product_id
JOIN warehouses w ON w.id = m.warehouse_id
WHERE si.status NOT IN ('DRAFT', 'CANCELLED')
ORDER BY c.name, si.full_number, p.code;

\echo '2. Total a reponer por empresa, depósito y producto'
WITH delivered AS (
  SELECT dn.company_id, dn.sales_invoice_id AS invoice_id, dnl.product_id, sum(dnl.quantity) AS qty
  FROM delivery_notes dn
  JOIN delivery_note_lines dnl ON dnl.delivery_note_id = dn.id
  WHERE dn.status = 'INVOICED' AND dn.sales_invoice_id IS NOT NULL
  GROUP BY 1, 2, 3
),
moved AS (
  SELECT sm.reference_id AS invoice_id, sm.product_id, sm.warehouse_id, sum(sm.quantity) AS qty
  FROM stock_movements sm
  WHERE sm.reference_type = 'sales_invoice' AND sm.type = 'SALE'
  GROUP BY 1, 2, 3
)
SELECT c.name AS empresa,
       w.name AS deposito,
       p.code AS producto,
       count(DISTINCT d.invoice_id) AS facturas,
       sum(least(d.qty, m.qty)) AS a_reponer
FROM delivered d
JOIN moved m ON m.invoice_id = d.invoice_id AND m.product_id = d.product_id
JOIN sales_invoices si ON si.id = d.invoice_id
JOIN companies c ON c.id = d.company_id
JOIN products p ON p.id = d.product_id
JOIN warehouses w ON w.id = m.warehouse_id
WHERE si.status NOT IN ('DRAFT', 'CANCELLED')
GROUP BY c.name, w.name, p.code
ORDER BY c.name, w.name, p.code;
