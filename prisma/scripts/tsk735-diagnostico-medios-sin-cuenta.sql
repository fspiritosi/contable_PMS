-- TSK-735: diagnóstico de regularización de recibos (RC) y órdenes de pago (OP) confirmados antes
-- de que cheques, tarjetas y cuentas tuvieran asiento propio.
-- SOLO LECTURA. Lista los pagos con cheque, e-cheq, tarjeta o cuenta corriente que quedaron fuera
-- del asiento (el saldo quedó abierto en Deudores / Proveedores) y qué va a pasar con cada uno.
-- Solo crea una tabla TEMPORAL (propia de la sesión) para reusar el detalle en los totales; la
-- transacción termina con ROLLBACK y no queda nada. No modifica ningún dato.
--
-- Uso (la imagen runner de producción no tiene tsx):
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -v corte='2026-11-05 18:30' \
--     -f prisma/scripts/tsk735-diagnostico-medios-sin-cuenta.sql
-- `corte` (obligatorio, 'YYYY-MM-DD HH:MI') es la fecha/hora del deploy de TSK-735: solo se listan
-- los RC/OP cuyo asiento (journal_entries.created_at) es anterior al corte, o que no tienen asiento.
-- Los posteriores ya se asientan completos y no son un falso positivo del detalle.
--
-- "Histórico" = el pago no está en el asiento:
--   * cheques: checks.account_id IS NULL (los cargados desde este ticket tienen cuenta);
--   * cuotas de tarjeta: payment_order_installments.account_id IS NULL;
--   * e-cheq recibido con banco: el asiento viejo ya lo mandó a Banco.
-- Las OP de devolución a socio (payment_orders.partner_id no nulo) no generaban asiento: no
-- dejaron saldo abierto en Proveedores, se excluyen del detalle de pagos.
-- Las cuotas de tarjeta de socio se listan una por cuota (importe de la cuota).
--
-- Mapeo del destino (cadenas literales):
--   Cheque de tercero físico (RC)  PORTFOLIO                    -> se regulariza al endosar o depositar
--   Cheque propio físico (OP)      DELIVERED                    -> se regulariza al debitar
--   Cheque, cualquier otro estado (DEPOSITED, CLEARED, ENDORSED, REJECTED, CASHED, VOIDED,
--     o sin cheque asociado)                                     -> regularizar a mano
--   E-cheq (recibido en RC o propio en OP) con banco                        -> e-cheq ya en banco: sin saldo abierto
--   Cuota de tarjeta de socio PENDING sin cuenta                -> se regulariza al devolver al socio
--   Cuota de tarjeta de socio PAID sin cuenta                   -> regularizar a mano
--   CREDIT_CARD en un RC (cobro con tarjeta; sigue omitido)     -> regularizar a mano
--   Tarjeta de la empresa en una OP (o sin tarjeta registrada)  -> regularizar a mano
--   ACCOUNT (RC u OP)                                           -> cuenta corriente: regularizar con NC/ND

\if :{?corte}
\else
  \echo 'Falta -v corte=''YYYY-MM-DD HH:MI'' (fecha/hora del deploy de TSK-735)'
  \quit
\endif

BEGIN;

CREATE TEMP TABLE tsk735_detalle ON COMMIT DROP AS
-- RC: cheques y e-cheqs recibidos
SELECT co.name AS empresa, 'RC' AS tipo, r.full_number AS comprobante, r.date::date AS fecha,
       COALESCE(cu.name, '(sin cliente)') AS tercero,
       CASE rp.payment_method WHEN 'ECHEQ' THEN 'E-cheq' ELSE 'Cheque' END
         || COALESCE(' ' || COALESCE(c.check_number, rp.check_number), '') AS medio,
       rp.amount AS importe,
       CASE
         WHEN rp.payment_method = 'ECHEQ' AND rp.bank_account_id IS NOT NULL
           THEN 'e-cheq ya en banco: sin saldo abierto'
         WHEN c.status = 'PORTFOLIO' AND NOT COALESCE(c.is_electronic, false)
           THEN 'se regulariza al endosar o depositar'
         ELSE 'regularizar a mano'
       END AS destino
FROM receipts r
JOIN companies co ON co.id = r.company_id
LEFT JOIN contractors cu ON cu.id = r.customer_id
LEFT JOIN journal_entries je ON je.id = r.journal_entry_id
JOIN receipt_payments rp ON rp.receipt_id = r.id
LEFT JOIN checks c ON c.receipt_payment_id = rp.id
WHERE r.status = 'CONFIRMED'
  AND (je.id IS NULL OR je.created_at < :'corte'::timestamp)
  AND rp.payment_method IN ('CHECK', 'ECHEQ')
  AND c.account_id IS NULL
UNION ALL
-- RC: tarjeta de crédito y cuenta corriente
SELECT co.name, 'RC', r.full_number, r.date::date, COALESCE(cu.name, '(sin cliente)'),
       CASE rp.payment_method WHEN 'CREDIT_CARD' THEN 'Tarjeta de crédito' ELSE 'Cuenta corriente' END,
       rp.amount,
       CASE rp.payment_method
         WHEN 'CREDIT_CARD' THEN 'regularizar a mano'
         ELSE 'cuenta corriente: regularizar con NC/ND'
       END
FROM receipts r
JOIN companies co ON co.id = r.company_id
LEFT JOIN contractors cu ON cu.id = r.customer_id
LEFT JOIN journal_entries je ON je.id = r.journal_entry_id
JOIN receipt_payments rp ON rp.receipt_id = r.id
WHERE r.status = 'CONFIRMED'
  AND (je.id IS NULL OR je.created_at < :'corte'::timestamp)
  AND rp.payment_method IN ('CREDIT_CARD', 'ACCOUNT')
UNION ALL
-- OP a proveedor: cheques propios (cheque creado por el pago) y endosados (cheque de tercero)
SELECT co.name, 'OP', o.full_number, o.date::date, COALESCE(s.business_name, '(sin proveedor)'),
       CASE op.payment_method WHEN 'ECHEQ' THEN 'E-cheq' ELSE 'Cheque' END
         || COALESCE(' ' || COALESCE(c.check_number, op.check_number), ''),
       op.amount,
       CASE
         WHEN op.payment_method = 'ECHEQ' AND op.bank_account_id IS NOT NULL
           THEN 'e-cheq ya en banco: sin saldo abierto'
         WHEN c.type = 'OWN' AND c.status = 'DELIVERED' AND NOT c.is_electronic
           THEN 'se regulariza al debitar'
         ELSE 'regularizar a mano'
       END
FROM payment_orders o
JOIN companies co ON co.id = o.company_id
LEFT JOIN suppliers s ON s.id = o.supplier_id
LEFT JOIN journal_entries je ON je.id = o.journal_entry_id
JOIN payment_order_payments op ON op.payment_order_id = o.id
LEFT JOIN checks c ON c.id = op.endorsed_check_id OR c.payment_order_payment_id = op.id
WHERE o.status = 'CONFIRMED'
  AND (je.id IS NULL OR je.created_at < :'corte'::timestamp)
  AND o.partner_id IS NULL
  AND op.payment_method IN ('CHECK', 'ECHEQ')
  AND c.account_id IS NULL
UNION ALL
-- OP a proveedor: cuenta corriente, y tarjetas que no generan cuotas de socio
SELECT co.name, 'OP', o.full_number, o.date::date, COALESCE(s.business_name, '(sin proveedor)'),
       CASE op.payment_method
         WHEN 'ACCOUNT' THEN 'Cuenta corriente'
         ELSE 'Tarjeta de crédito' || COALESCE(' ' || cd.name, '')
       END,
       op.amount,
       CASE op.payment_method
         WHEN 'ACCOUNT' THEN 'cuenta corriente: regularizar con NC/ND'
         ELSE 'regularizar a mano'
       END
FROM payment_orders o
JOIN companies co ON co.id = o.company_id
LEFT JOIN suppliers s ON s.id = o.supplier_id
LEFT JOIN journal_entries je ON je.id = o.journal_entry_id
JOIN payment_order_payments op ON op.payment_order_id = o.id
LEFT JOIN cards cd ON cd.id = op.card_id
WHERE o.status = 'CONFIRMED'
  AND (je.id IS NULL OR je.created_at < :'corte'::timestamp)
  AND o.partner_id IS NULL
  AND (op.payment_method = 'ACCOUNT'
       OR (op.payment_method = 'CREDIT_CARD'
           AND (cd.id IS NULL OR cd.owner_type = 'COMPANY')))
UNION ALL
-- OP a proveedor: cuotas de tarjeta de socio sin cuenta (deuda con el socio)
SELECT co.name, 'OP', o.full_number, o.date::date, COALESCE(s.business_name, '(sin proveedor)'),
       'Cuota ' || i.number || ' tarjeta socio' || COALESCE(' ' || cd.name, ''),
       i.amount,
       CASE i.status
         WHEN 'PENDING' THEN 'se regulariza al devolver al socio'
         ELSE 'regularizar a mano'
       END
FROM payment_order_installments i
JOIN payment_orders o ON o.id = i.payment_order_id
JOIN companies co ON co.id = o.company_id
LEFT JOIN suppliers s ON s.id = o.supplier_id
LEFT JOIN journal_entries je ON je.id = o.journal_entry_id
LEFT JOIN cards cd ON cd.id = i.card_id
WHERE o.status = 'CONFIRMED'
  AND (je.id IS NULL OR je.created_at < :'corte'::timestamp)
  AND o.partner_id IS NULL
  AND i.partner_id IS NOT NULL
  AND i.account_id IS NULL;

\echo '1. Detalle: pagos fuera del asiento, con su destino'
SELECT empresa, comprobante, fecha, tercero, medio, importe, destino
FROM tsk735_detalle
ORDER BY empresa, fecha, comprobante, medio;

\echo '2. Totales por empresa, tercero y destino'
SELECT empresa, tercero, destino, count(*) AS pagos, sum(importe) AS importe
FROM tsk735_detalle
GROUP BY empresa, tercero, destino
ORDER BY empresa, tercero, destino;

ROLLBACK;
